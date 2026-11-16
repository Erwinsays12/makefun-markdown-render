// Block parser: direct-render CommonMark + GFM renderer matching marked 18.1.3.
// Two passes: first collect all link reference definitions (so a link may use
// a definition that appears later in the document), then render.
import { parseInline, normalizeLabel } from './inline.js';
import { escapeText } from './entities.js';

// A line is {s: text without the line ending, t: whether it was terminated}.
export function splitLines(src) {
  const parts = src.split('\n');
  const lines = [];
  const endsWithNl = src.length === 0 || src.endsWith('\n');
  const count = endsWithNl && parts.length > 0 ? parts.length - 1 : parts.length;
  for (let i = 0; i < count; i++) lines.push({ s: parts[i], t: true });
  if (!endsWithNl && parts.length > 0) {
    lines[lines.length - 1].t = false;
  }
  return lines;
}

export function isBlank(L) {
  return /^[ \t]*$/.test(L.s);
}

// Indent of a line in columns (tabs expand to the next multiple of 4),
// and the string index where the content starts.
export function indentInfo(s) {
  let col = 0, i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { col++; i++; }
    else if (c === '\t') { col += 4 - (col % 4); i++; }
    else break;
  }
  return { col, idx: i };
}

// Remove `cols` columns of indent from a line string (tab-aware).
// When any indent is actually stripped (cols > 0), tabs in the leading
// whitespace are expanded to spaces first, so a tab that survives the
// strip keeps its original tab-stop alignment (a tab at original col 13
// is 3 spaces, not a tab at new col 0). When cols is 0 the line is
// returned unchanged (a leading tab stays a literal tab, e.g. fenced
// code block content).
export function stripColumns(s, cols) {
  if (cols <= 0) return s;
  let col = 0, i = 0;
  // Expand leading whitespace tabs to spaces (original columns).
  let expanded = null;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { col++; i++; }
    else if (c === '\t') { col += 4 - (col % 4); i++; }
    else break;
  }
  if (i > 0 && s.slice(0, i).indexOf('\t') >= 0) {
    // Rebuild the leading whitespace as spaces.
    let out = '', c2 = 0;
    for (let k = 0; k < i; k++) {
      if (s[k] === ' ') { out += ' '; c2++; }
      else { const w = 4 - (c2 % 4); out += ' '.repeat(w); c2 += w; }
    }
    expanded = out + s.slice(i);
    s = expanded;
  }
  col = 0; i = 0;
  while (i < s.length && col < cols) {
    const c = s[i];
    if (c === ' ') { col++; i++; }
    else if (c === '\t') {
      const w = 4 - (col % 4);
      if (col + w <= cols) { col += w; i++; }
      else {
        const keep = col + w - cols;
        return ' '.repeat(keep) + s.slice(i + 1);
      }
    } else break;
  }
  return s.slice(i);
}

// Remove the first `cols` columns of a string, whatever the characters are
// (a tab advances to the next multiple of 4; a straddling tab becomes spaces).
// Used for a list item's first line, where the marker itself must be removed.
// Tabs in the leading whitespace are expanded to spaces first (same
// tab-stop alignment fix as stripColumns); cols <= 0 returns the line as-is.
export function removeColumns(s, cols) {
  if (cols <= 0) return s;
  let col = 0, i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { col++; i++; }
    else if (c === '\t') { col += 4 - (col % 4); i++; }
    else break;
  }
  if (i > 0 && s.slice(0, i).indexOf('\t') >= 0) {
    let out = '', c2 = 0;
    for (let k = 0; k < i; k++) {
      if (s[k] === ' ') { out += ' '; c2++; }
      else { const w = 4 - (c2 % 4); out += ' '.repeat(w); c2 += w; }
    }
    s = out + s.slice(i);
  }
  col = 0; i = 0;
  while (i < s.length && col < cols) {
    const c = s[i];
    if (c === '\t') {
      const w = 4 - (col % 4);
      if (col + w <= cols) { col += w; i++; }
      else {
        // Straddling tab: expand its remainder AND all following leading
        // whitespace to spaces (original columns), so later strips see
        // the true tab-stop alignment instead of a shifted raw tab.
        const keep = col + w - cols;
        let j = i + 1, ccol = col + w, extra = '';
        while (j < s.length && (s[j] === ' ' || s[j] === '\t')) {
          if (s[j] === ' ') { extra += ' '; ccol++; j++; }
          else { const w2 = 4 - (ccol % 4); extra += ' '.repeat(w2); ccol += w2; j++; }
        }
        return ' '.repeat(keep) + extra + s.slice(j);
      }
    } else {
      col++;
      i++;
    }
  }
  return s.slice(i);
}

export function parse(src) {
  const norm = src.replace(/\r\n?/g, '\n');
  const lines = splitLines(norm);
  const refs = new Map();
  parseBlocks(lines, 0, lines.length, refs, null, true, false, false, true);
  const out = [];
  parseBlocks(lines, 0, lines.length, refs, out, false, false, false, true);
  return out.join('');
}

// Parse blocks in lines[start..end). When collect is true, only link reference
// definitions are gathered (no output, no inline parsing). When tight is true,
// top-level paragraphs render without <p> wrappers (tight list items).
// inList is true when parsing a list item's content: inside it, an ordered
// list marker interrupts a paragraph regardless of its start number
// (a nested list at the content column always starts a new block).
// isTop is true only for the top-level document call.
function parseBlocks(lines, start, end, refs, out, collect, tight = false, inList = false, isTop = false) {
  let i = start;
  while (i < end) {
    const L = lines[i];
    if (isBlank(L)) { i++; continue; }
    const ind = indentInfo(L.s);
    const content = L.s.slice(ind.idx);
    // ATX heading
    if (ind.col <= 3 && content[0] === '#') {
      const m = /^(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/.exec(content);
      if (m && (m[2] !== undefined || content.length === m[1].length || /[ \t]/.test(content[m[1].length] || ''))) {
        const level = m[1].length;
        let text = m[2] ?? '';
        text = text.replace(/[ \t]+#+[ \t]*$/, '').replace(/[ \t]+$/, '');
        if (!collect) out.push('<h', String(level), '>', parseInline(text, refs), '</h', String(level), '>\n');
        i++;
        continue;
      }
    }
    // Fenced code block
    if (ind.col <= 3 && (content.startsWith('```') || content.startsWith('~~~'))) {
      const fence = content[0];
      let k = 0;
      while (k < content.length && content[k] === fence) k++;
      if (k >= 3 && !(fence === '`' && content.slice(k).includes('`'))) {
        const info = content.slice(k).trim();
        const lang = info.split(/\s+/)[0] ?? '';
        const codeLines = [];
        let j = i + 1;
        let closed = false;
        while (j < end) {
          const lj = lines[j];
          const indj = indentInfo(lj.s);
          const cj = lj.s.slice(indj.idx);
          if (indj.col <= 3 && cj[0] === fence) {
            let k2 = 0;
            while (k2 < cj.length && cj[k2] === fence) k2++;
            if (k2 >= k && cj.slice(k2).trim() === '') { closed = true; j++; break; }
          }
          codeLines.push(lj);
          j++;
        }
        if (!collect) {
          let code = '';
          for (const cl of codeLines) code += stripColumns(cl.s, ind.col) + (cl.t ? '\n' : '');
          out.push('<pre><code' + (lang ? ' class="language-' + escapeText(lang) + '"' : '') + '>' +
            escapeText(code) + '</code></pre>\n');
        }
        i = j;
        continue;
      }
    }
    // Thematic break
    if (ind.col <= 3 && /^(?:\*[ \t]*){3,}$|^(?:-[ \t]*){3,}$|^(?:_[ \t]*){3,}$/.test(content)) {
      if (!collect) out.push('<hr>\n');
      i++;
      continue;
    }
    // Indented code block (only when not interrupting a paragraph; here we are
    // at a block boundary, so it is code)
    if (ind.col >= 4) {
      const codeLines = [];
      let j = i;
      while (j < end) {
        const lj = lines[j];
        if (isBlank(lj)) {
          // blank line: include only if a code line follows
          let k = j + 1;
          while (k < end && isBlank(lines[k])) k++;
          if (k < end && indentInfo(lines[k].s).col >= 4) { codeLines.push(lj); j++; continue; }
          break;
        }
        if (indentInfo(lj.s).col >= 4) { codeLines.push(lj); j++; continue; }
        break;
      }
      // drop trailing blank lines
      while (codeLines.length > 0 && isBlank(codeLines[codeLines.length - 1])) codeLines.pop();
      if (!collect) {
        let code = '';
        for (const cl of codeLines) {
          if (isBlank(cl)) code += '\n';
          else code += stripColumns(cl.s, 4) + (cl.t ? '\n' : '');
        }
        out.push('<pre><code>' + escapeText(code) + '</code></pre>\n');
      }
      i = j;
      continue;
    }
    // HTML block (marked emits the lines joined by newlines; a trailing
    // newline is added for types 1-5 when followed by another block or at
    // the top-level end, and for types 6-7 only at the top-level end).
    const htmlKind = htmlBlockKind(L.s, ind);
    if (htmlKind > 0) {
      const j = htmlBlockEnd(lines, i, end, htmlKind);
      if (!collect) {
        let html = '';
        for (let k = i; k < j; k++) {
          if (k > i) html += '\n';
          html += lines[k].s;
        }
        const lastT = j > i && lines[j - 1].t;
        if (htmlKind <= 5) {
          // Trailing newline only when the next block follows immediately
          // (no blank line between) or at the top-level end.
          if (lastT && ((j < end && !isBlank(lines[j])) || (isTop && j === end))) html += '\n';
        } else {
          if (isTop && j === end && lastT) html += '\n';
        }
        out.push(html);
      }
      i = j;
      continue;
    }
    // Blockquote
    if (ind.col <= 3 && content[0] === '>') {
      const inner = [];
      let j = i;
      let lastWasPara = false;
      // Track a fenced code block opened inside the quote: a line without
      // `>` cannot be code content, so it ends the blockquote (and the
      // fence) instead of becoming a lazy continuation.
      let inFence = false, fenceChar = '', fenceLen = 0;
      while (j < end) {
        const lj = lines[j];
        const indj = indentInfo(lj.s);
        const cj = lj.s.slice(indj.idx);
        if (indj.col <= 3 && cj[0] === '>') {
          let rest = cj.slice(1);
          if (rest[0] === ' ') rest = rest.slice(1);
          else if (rest[0] === '\t') {
            // The tab after `>` counts as the optional space: consume 1
            // column of it, and expand it plus any following leading
            // whitespace tabs to spaces (original columns), so a later
            // indented-code strip sees the true tab-stop alignment.
            const tabCol = indj.col + 1;
            const w = 4 - (tabCol % 4);
            let expanded = ' '.repeat(w - 1);
            let j = 1, ccol = tabCol + w;
            while (j < rest.length && (rest[j] === ' ' || rest[j] === '\t')) {
              if (rest[j] === ' ') { expanded += ' '; ccol++; j++; }
              else { const w2 = 4 - (ccol % 4); expanded += ' '.repeat(w2); ccol += w2; j++; }
            }
            rest = expanded + rest.slice(j);
          }
          inner.push({ s: rest, t: lj.t });
          // A `>`-only line is a blank line inside the quote: it ends the
          // paragraph, so a following line without `>` is not a lazy
          // continuation.
          lastWasPara = rest.trim() !== '';
          // Fence open/close detection on the `>`-stripped line.
          const f = rest[0];
          if ((f === '`' || f === '~')) {
            let run = 0;
            while (run < rest.length && rest[run] === f) run++;
            if (!inFence && run >= 3 && !(f === '`' && rest.slice(run).includes('`'))) {
              inFence = true; fenceChar = f; fenceLen = run;
            } else if (inFence && f === fenceChar && run >= fenceLen && /^[ \t]*$/.test(rest.slice(run))) {
              inFence = false; fenceChar = ''; fenceLen = 0;
            }
          }
          j++;
          continue;
        }
        // A blank line without a `>` marker ends the blockquote (a `>`-only
        // line is caught by the marker branch above and continues it).
        if (isBlank(lj)) break;
        // Lazy continuation: only a paragraph line (indent < 4, and not a
        // line that would start a new block interrupting the paragraph).
        // Never inside a fenced code block. (A line at indent >= 4 is an
        // indented code block outside the quote, not a continuation.)
        if (!inFence && lastWasPara && indj.col < 4 && !interruptsParagraph(lj.s, indj)) { inner.push(lj); j++; continue; }
        break;
      }
      if (!collect) out.push('<blockquote>\n');
      parseBlocks(inner, 0, inner.length, refs, out, collect, false, inList);
      if (!collect) out.push('</blockquote>\n');
      i = j;
      continue;
    }
    // List
    const listStart = matchListStart(L.s, ind);
    if (listStart) {
      i = parseList(lines, i, end, refs, out, collect, listStart);
      continue;
    }
    // Paragraph (with setext heading, table and link reference definitions)
    i = parseParagraph(lines, i, end, refs, out, collect, tight, inList);
  }
}

// Find the index of the ']' closing the bracketed label starting at `start`
// ('[' at start). Returns -1 if none. Handles escapes and nested brackets.
export function findClosingBracket(s, start) {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Parse a link reference definition starting at line i. Returns {next} (the
// line after the definition) or null. The definition may span up to 3 lines.
function tryParseDef(lines, i, end, refs) {
  const L = lines[i];
  const ind = indentInfo(L.s);
  if (ind.col > 3) return null;
  const s0 = L.s.slice(ind.idx);
  if (s0[0] !== '[') return null;
  // Gather the definition text from up to 5 lines (non-blank). The label
  // itself may span lines, so find the closing bracket in the combined
  // text rather than on the first line only. Continuation lines may be
  // indented arbitrarily (destination/title may sit on their own lines).
  const parts = [s0];
  for (let k = 1; k <= 4 && i + k < end; k++) {
    const lk = lines[i + k];
    if (isBlank(lk)) break;
    parts.push(lk.s);
  }
  const combined = parts.join('\n');
  const lb = findClosingBracket(combined, 0);
  if (lb < 0) return null;
  const rawLabel = combined.slice(1, lb);
  // A label must not contain unescaped '[' or ']' (nested brackets).
  if (/(^|[^\\])[\[\]]/.test(rawLabel)) return null;
  const label = normalizeLabel(rawLabel);
  if (!label || label.length > 999) return null;
  if (combined[lb + 1] !== ':') return null;
  const text = combined.slice(lb + 2);
  let p = 0;
  const n = text.length;
  const skipInlineWs = () => {
    while (p < n && (text[p] === ' ' || text[p] === '\t')) p++;
  };
  // Skip whitespace, possibly crossing to the next line for the destination.
  const skipWsLines = () => {
    for (;;) {
      skipInlineWs();
      if (p < n && text[p] === '\n') {
        p++;
        skipInlineWs();
        continue;
      }
      return;
    }
  };
  skipWsLines();
  if (p >= n) return null;
  // Destination.
  let dest = null;
  if (text[p] === '<') {
    let q = p + 1;
    while (q < n && text[q] !== '>' && text[q] !== '\n' && text[q] !== '<') {
      if (text[q] === '\\') q++;
      q++;
    }
    if (q >= n || text[q] !== '>') return null;
    dest = text.slice(p + 1, q);
    p = q + 1;
  } else {
    let depth = 0;
    const start = p;
    while (p < n) {
      const c = text[p];
      if (c === ' ' || c === '\t' || c === '\n') break;
      if (c === '\\') { p += 2; continue; }
      if (c === '(') { depth++; p++; continue; }
      if (c === ')') {
        if (depth === 0) break;
        depth--; p++; continue;
      }
      p++;
    }
    if (p === start || depth !== 0) return null;
    dest = text.slice(start, p);
    // Unescape backslash escapes in the destination.
    dest = dest.replace(/\\([!"#$%&'()*+,.\/:;<=>?@\[\]\\^_`{|}~-])/g, '$1');
  }
  // Optional title (same line, or the next line). A title must be
  // preceded by whitespace; without it the definition is invalid.
  const destEnd = p;
  skipInlineWs();
  const hadWs = p > destEnd;
  let title = null;
  const tryTitle = () => {
    if (p >= n) return true;
    const q0 = text[p];
    if (q0 === '"' || q0 === "'") {
      let q = p + 1;
      while (q < n && text[q] !== q0) {
        if (text[q] === '\\') q++;
        q++;
      }
      if (q >= n) return false;
      title = text.slice(p + 1, q).replace(/\\([!"#$%&'()*+,.\/:;<=>?@\[\]\\^_`{|}~-])/g, '$1');
      p = q + 1;
      return true;
    }
    if (q0 === '(') {
      let q = p + 1;
      while (q < n && text[q] !== ')' && text[q] !== '(') {
        if (text[q] === '\\') q++;
        q++;
      }
      if (q >= n || text[q] !== ')') return false;
      title = text.slice(p + 1, q).replace(/\\([!"#$%&'()*+,.\/:;<=>?@\[\]\\^_`{|}~-])/g, '$1');
      p = q + 1;
      return true;
    }
    return false;
  };
  if (p < n && text[p] === '\n') {
    // Peek at the next line for a title; if none, or if the title is
    // followed by garbage on its line, the definition ends here (without
    // a title) and the line is left as a separate block.
    const save = p;
    p++;
    skipInlineWs();
    if (p < n && (text[p] === '"' || text[p] === "'" || text[p] === '(')) {
      if (!tryTitle()) return null;
      skipInlineWs();
      if (p < n && text[p] !== '\n') { p = save; title = null; }
    } else {
      p = save;
    }
  } else if (p < n) {
    if (!hadWs) return null;
    if (!tryTitle()) return null;
  }
  // After the title/destination only whitespace may follow on this line.
  skipInlineWs();
  if (p < n && text[p] !== '\n') return null;
  const consumed = 1 + (combined.slice(0, lb + 2 + p).split('\n').length - 1);
  if (!refs.has(label)) refs.set(label, { dest, title });
  return { next: i + consumed };
}

// Parse a paragraph starting at line i (after any link reference definitions).
// Returns the index of the next line after the paragraph.
function parseParagraph(lines, i, end, refs, out, collect, tight = false, inList = false) {
  let j = i;
  while (j < end && !isBlank(lines[j])) {
    const def = tryParseDef(lines, j, end, refs);
    if (!def) break;
    j = def.next;
  }
  if (j >= end || isBlank(lines[j])) return j;
  const para = [];
  let k = j;
  while (k < end) {
    const lk = lines[k];
    if (isBlank(lk)) break;
    const indk = indentInfo(lk.s);
    const ck = lk.s.slice(indk.idx);
    if (indk.col <= 3) {
      // Setext underline (level 1 '=' or level 2 '-'); checked before HR
      // because `---` after paragraph text is a setext underline, not an HR.
      if (para.length > 0 && /^(=+|-+)[ \t]*$/.test(ck)) {
        const level = ck[0] === '=' ? 1 : 2;
        // A setext heading's text has leading/trailing whitespace stripped.
        const text = para.map(x => x.s).join('\n').replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
        if (!collect) out.push('<h', String(level), '>', parseInline(text, refs), '</h', String(level), '>\n');
        return k + 1;
      }
      if (ck[0] === '#') {
        const m = /^(#{1,6})(?:[ \t]+|[ \t]*$)/.exec(ck);
        if (m) break;
      }
      if (ck.startsWith('```') || ck.startsWith('~~~')) {
        const f = ck[0];
        let n2 = 0;
        while (n2 < ck.length && ck[n2] === f) n2++;
        if (n2 >= 3 && !(f === '`' && ck.slice(n2).includes('`'))) break;
      }
      if (/^(?:\*[ \t]*){3,}$|^(?:-[ \t]*){3,}$|^(?:_[ \t]*){3,}$/.test(ck)) break;
      // HTML blocks of types 1-6 can interrupt a paragraph; type 7 cannot.
      const hk = htmlBlockKind(lk.s, indk);
      if (hk > 0 && hk < 7) break;
      if (ck[0] === '>') break;
      const lm = matchListStart(lk.s, indk);
      // A list interrupts a paragraph only if its first item is non-empty
      // and (for ordered lists) it starts with 1 — except inside a list
      // item, where any ordered marker starts a nested list.
      if (lm && lm.hasContent && (lm.type === 'bullet' || lm.start === 1 || inList)) break;
    }
    para.push(lk);
    k++;
  }
  if (para.length === 0) return k;
  // GFM table: second line must be a delimiter row (indent <= 3).
  if (para.length >= 2 && indentInfo(para[1].s).col <= 3) {
    const aligns = parseTableDelimiter(para[1].s);
    if (aligns) {
      renderTable(para, aligns, refs, out, collect);
      return k;
    }
  }
  const text = para.map(x => x.s).join('\n');
  if (!collect) {
    if (tight) out.push(parseInline(text, refs));
    else out.push('<p>', parseInline(text, refs), '</p>\n');
  }
  return k;
}

const BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul').split(' '));

// Return the HTML block type (1-7) if the line starts one, else 0.
function htmlBlockKind(s, ind) {
  if (ind.col > 3) return 0;
  const c = s.slice(ind.idx);
  const low = c.toLowerCase();
  if (/^<(script|pre|style|textarea)(?:[ \t\n>\/]|$)/.test(low)) return 1;
  if (low.startsWith('<!--')) return 2;
  if (low.startsWith('<?')) return 3;
  if (/^<![a-z]/i.test(c)) return 4;
  if (low.startsWith('<![cdata[')) return 5;
  const m = /^<\/?([a-z][a-z0-9-]*)(?:[ \t\n\/>]|$)/i.exec(c);
  if (m && BLOCK_TAGS.has(m[1].toLowerCase())) return 6;
  // Type 7: a complete open or closing tag alone on the line. A closing
  // tag must not carry attributes.
  if (c.startsWith('</')) {
    if (/^<\/[a-z][a-z0-9-]*[ \t]*>[ \t]*$/i.test(c)) return 7;
  } else if (/^<[a-z][a-z0-9-]*(?:[ \t]+[a-z_:][a-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*[ \t]*\/?>[ \t]*$/i.test(c)) return 7;
  return 0;
}

// Return the index of the first line after the HTML block starting at i.
function htmlBlockEnd(lines, i, end, kind) {
  const enders = { 1: /<\/(script|pre|style|textarea)>/i, 2: /-->/, 3: /\?>/, 4: />/, 5: /\]\]>/ };
  if (kind >= 1 && kind <= 5) {
    const re = enders[kind];
    for (let j = i; j < end; j++) {
      if (re.test(lines[j].s)) return j + 1;
    }
    return end;
  }
  // Types 6-7 end at the first blank line.
  for (let j = i + 1; j < end; j++) {
    if (isBlank(lines[j])) return j;
  }
  return end;
}

// Column where a list item's content starts, given the marker length.
// `c` starts with the marker; `col0` is the marker's column.
function markerContentCol(c, col0, markerLen) {
  let col = col0 + markerLen;
  let i = markerLen;
  let spaces = 0;
  while (i < c.length && (c[i] === ' ' || c[i] === '\t')) {
    if (c[i] === ' ') { col++; spaces++; i++; }
    else { const w = 4 - (col % 4); col += w; spaces += w; i++; }
  }
  const hasContent = i < c.length;
  let contentCol;
  if (!hasContent) contentCol = col0 + markerLen + 1;
  else if (spaces >= 5) contentCol = col0 + markerLen + 1;
  else contentCol = col;
  return { contentCol, hasContent };
}

// Match a list marker at the start of `s` (indent `ind`). Returns null or
// {type, delim, start, markerLen, contentCol, hasContent}.
function matchListStart(s, ind) {
  if (ind.col > 3) return null;
  const c = s.slice(ind.idx);
  let m = /^([*+-])/.exec(c);
  if (m) {
    if (c.length > 1 && c[1] !== ' ' && c[1] !== '\t') return null;
    const r = markerContentCol(c, ind.col, 1);
    return { type: 'bullet', delim: null, start: null, bullet: m[1], markerLen: 1, contentCol: r.contentCol, hasContent: r.hasContent };
  }
  m = /^(\d{1,9})([.)])/.exec(c);
  if (m) {
    const afterIdx = m[0].length;
    if (c.length > afterIdx && c[afterIdx] !== ' ' && c[afterIdx] !== '\t') return null;
    const r = markerContentCol(c, ind.col, m[0].length);
    return { type: 'ordered', delim: m[2], start: parseInt(m[1], 10), markerLen: m[0].length, contentCol: r.contentCol, hasContent: r.hasContent };
  }
  return null;
}

// Would this line (with indent `ind`) start a block that interrupts a paragraph?
function interruptsParagraph(s, ind) {
  const c = s.slice(ind.idx);
  if (ind.col > 3) return false;
  if (c[0] === '#') {
    const m = /^(#{1,6})(?:[ \t]+|[ \t]*$)/.exec(c);
    if (m) return true;
  }
  if (c.startsWith('```') || c.startsWith('~~~')) {
    const f = c[0];
    let n2 = 0;
    while (n2 < c.length && c[n2] === f) n2++;
    if (n2 >= 3 && !(f === '`' && c.slice(n2).includes('`'))) return true;
  }
  if (/^(?:\*[ \t]*){3,}$|^(?:-[ \t]*){3,}$|^(?:_[ \t]*){3,}$/.test(c)) return true;
  // HTML blocks of types 1-6 can interrupt a paragraph; type 7 cannot.
  const hk = htmlBlockKind(s, ind);
  if (hk > 0 && hk < 7) return true;
  if (c[0] === '>') return true;
  if (matchListStart(s, ind)) return true;
  return false;
}

// Is this (already content-stripped) line a paragraph line?
function isParagraphLine(s) {
  const ind = indentInfo(s);
  if (ind.col >= 4) return false;
  return !interruptsParagraph(s, ind);
}

// Collect one list item starting at line j (a marker line). Returns
// {item, internalBlank, trailingBlank, next}.
function collectItem(lines, j, end, marker, markerIndent) {
  const contentCol = marker.contentCol;
  const itemLines = [];
  const L0 = lines[j];
  itemLines.push({ s: removeColumns(L0.s, contentCol), t: L0.t });
  let seenContent = marker.hasContent;
  let internalBlank = false;
  let trailingBlank = false;
  let openPara = marker.hasContent && isParagraphLine(itemLines[0].s);
  let k = j + 1;
  const pending = [];
  // Last content line, if it was a list marker (for the loose rule).
  // All indents here are relative to the item's content (the line already
  // stripped of contentCol), because matchListStart only sees markers at
  // indent <= 3.
  let lastMarker = null;
  // Innermost active nested list: its marker indent and content column
  // (both relative to the item's content). Content indented to its content
  // column is inside the nested list.
  let nestedCol = -1, nestedMarkerIndent = -1;
  const noteLine = (stripped) => {
    const ind2 = indentInfo(stripped);
    const mm = matchListStart(stripped, ind2);
    if (mm) {
      lastMarker = { type: mm.type, indent: ind2.col, bullet: mm.bullet, delim: mm.delim };
      nestedCol = mm.contentCol; nestedMarkerIndent = ind2.col;
    } else {
      lastMarker = null;
      if (nestedMarkerIndent >= 0 && ind2.col < nestedMarkerIndent) {
        nestedCol = -1; nestedMarkerIndent = -1;
      }
    }
  };
  // A blank line makes the list loose only if it separates two top-level
  // blocks of this item. A blank line inside a nested list (before a deeper
  // sub-list, before another item of the same nested list, or before content
  // indented into the nested list) does not count (marked: only top-level
  // `space` tokens make it loose). A blank line before a new nested list
  // or a top-level non-list block (paragraph, indented code block) DOES count.
  const blankMakesLoose = (stripped) => {
    const ind2 = indentInfo(stripped);
    const nm = matchListStart(stripped, ind2);
    if (nm) {
      if (lastMarker) {
        if (ind2.col > lastMarker.indent) return false;
        if (ind2.col === lastMarker.indent && nm.type === lastMarker.type &&
            (nm.type === 'bullet' ? nm.bullet === lastMarker.bullet : nm.delim === lastMarker.delim)) return false;
      }
      return true;
    }
    if (nestedCol >= 0 && ind2.col >= nestedCol) return false;
    return true;
  };
  while (k < end) {
    const lk = lines[k];
    if (isBlank(lk)) {
      // An empty item followed by a blank line is closed; a blank line also
      // closes the open paragraph (no lazy continuation past it).
      if (!seenContent) break;
      openPara = false;
      pending.push(lk); k++; continue;
    }
    const indk = indentInfo(lk.s);
    const ck = lk.s.slice(indk.idx);
    // A thematic break line is not a list item. Exception: a line of only
    // `-` after an open paragraph is a setext heading underline, not an HR,
    // so it stays part of the item.
    if (indk.col <= 3 && /^(?:\*[ \t]*){3,}$|^(?:-[ \t]*){3,}$|^(?:_[ \t]*){3,}$/.test(ck) &&
        !(openPara && /^-+[ \t]*$/.test(ck))) {
      trailingBlank = pending.length > 0;
      break;
    }
    const m = matchListStart(lk.s, indk);
    // A new item of the same list: same marker, indent below this item's
    // content column (at or above it, the line is nested content instead).
    if (m && indk.col < contentCol && m.type === marker.type &&
        (marker.type === 'bullet' ? m.bullet === marker.bullet : m.delim === marker.delim)) {
      trailingBlank = pending.length > 0;
      break;
    }
    if (indk.col >= contentCol) {
      const s2 = stripColumns(lk.s, contentCol);
      if (pending.length > 0) {
        if (seenContent && blankMakesLoose(s2)) internalBlank = true;
        for (const b of pending) itemLines.push({ s: '', t: b.t });
        pending.length = 0;
      }
      itemLines.push({ s: s2, t: lk.t });
      seenContent = true;
      openPara = isParagraphLine(s2);
      noteLine(s2);
      k++;
      continue;
    }
    // Lazy continuation of the open paragraph: any line not indented
    // enough to be regular item content, as long as it does not interrupt
    // the paragraph. (Indent >= contentCol is caught by the branch above,
    // so a line reaching here cannot be an indented code block.)
    if (openPara && !interruptsParagraph(lk.s, indk)) {
      const s2 = stripColumns(lk.s, contentCol);
      if (pending.length > 0) {
        if (seenContent && blankMakesLoose(s2)) internalBlank = true;
        for (const b of pending) itemLines.push({ s: '', t: b.t });
        pending.length = 0;
      }
      // A lazy continuation loses leading whitespace up to the content column.
      itemLines.push({ s: s2, t: lk.t });
      seenContent = true;
      openPara = true;
      noteLine(s2);
      k++;
      continue;
    }
    trailingBlank = pending.length > 0;
    break;
  }
  if (k >= end) trailingBlank = pending.length > 0;
  return { item: { lines: itemLines }, internalBlank, trailingBlank, next: k };
}

function parseList(lines, i, end, refs, out, collect, first) {
  const listType = first.type;
  const listDelim = first.delim;
  const listBullet = first.bullet;
  const markerIndent = indentInfo(lines[i].s).col;
  const startNum = first.start;
  const items = [];
  let j = i;
  let loose = false;
  let lastContentCol = first.contentCol;
  while (j < end) {
    const Lj = lines[j];
    const indj = indentInfo(Lj.s);
    const cj = Lj.s.slice(indj.idx);
    if (indj.col <= 3 && /^(?:\*[ \t]*){3,}$|^(?:-[ \t]*){3,}$|^(?:_[ \t]*){3,}$/.test(cj)) break;
    const m = matchListStart(Lj.s, indj);
    // A new item: same marker, indent 0-3 and below the previous item's
    // content column (at or above it, the line belongs to that item).
    if (!m || indj.col > 3 || indj.col >= lastContentCol || m.type !== listType ||
        (listType === 'bullet' ? m.bullet !== listBullet : m.delim !== listDelim)) break;
    const res = collectItem(lines, j, end, m, markerIndent);
    items.push(res.item);
    if (res.internalBlank) loose = true;
    const nextJ = res.next;
    lastContentCol = m.contentCol;
    // A blank line before the next item makes the list loose.
    if (res.trailingBlank && nextJ < end) {
      const indn = indentInfo(lines[nextJ].s);
      const mn = matchListStart(lines[nextJ].s, indn);
      if (mn && indn.col <= 3 && indn.col < m.contentCol && mn.type === listType &&
          (listType === 'bullet' ? mn.bullet === listBullet : mn.delim === listDelim)) loose = true;
    }
    j = nextJ;
  }
  if (!collect) {
    const tag = listType === 'bullet' ? 'ul' : 'ol';
    out.push('<', tag, (listType === 'ordered' && startNum !== 1) ? ' start="' + startNum + '"' : '', '>\n');
    for (const item of items) {
      out.push('<li>');
      // GFM task list: `[ ] ` / `[x] ` at the start of the item's content.
      // The checkbox is prepended to the first line so it lands inside the
      // item's paragraph (loose lists wrap content in `<p>`).
      const fl = item.lines[0];
      if (fl) {
        const tm = /^\[( |x|X)\](?:[ \t]+|$)/.exec(fl.s);
        if (tm) {
          const checked = tm[1] === 'x' || tm[1] === 'X';
          const box = checked
            ? '<input checked="" disabled="" type="checkbox">'
            : '<input disabled="" type="checkbox">';
          fl.s = fl.s.slice(tm[0].length);
          fl.s = fl.s.length > 0 ? box + ' ' + fl.s : box;
        }
      }
      const itemOut = [];
      parseBlocks(item.lines, 0, item.lines.length, refs, itemOut, false, !loose, true);
      out.push(itemOut.join(''));
      out.push('</li>\n');
    }
    out.push('</', tag, '>\n');
  }
  return j;
}

// Parse a GFM table delimiter row. Returns an array of alignments
// ('left'|'right'|'center'|null) or null if the line is not a delimiter row.
function parseTableDelimiter(s) {
  let t = s.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  const cells = splitTableCells(t);
  if (cells.length === 0) return null;
  const aligns = [];
  for (const cell of cells) {
    const m = /^ *:?-+:? *$/.exec(cell);
    if (!m) return null;
    const c = cell.trim();
    if (c.startsWith(':') && c.endsWith(':')) aligns.push('center');
    else if (c.startsWith(':')) aligns.push('left');
    else if (c.endsWith(':')) aligns.push('right');
    else aligns.push(null);
  }
  return aligns;
}

// Split a table row into cells on unescaped pipes; `\|` becomes `|`.
function splitTableCells(t) {
  const cells = [];
  let cur = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '\\' && i + 1 < t.length && t[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '|') { cells.push(cur); cur = ''; continue; }
    cur += c;
  }
  cells.push(cur);
  return cells.map(x => x.trim());
}

function renderTable(para, aligns, refs, out, collect) {
  if (collect) return;
  const ncols = aligns.length;
  const adjust = (cells) => {
    const r = cells.slice(0, ncols);
    while (r.length < ncols) r.push('');
    return r;
  };
  const header = adjust(splitTableCells(stripEdgePipes(para[0].s)));
  out.push('<table>\n<thead>\n<tr>\n');
  for (let i = 0; i < ncols; i++) {
    const a = aligns[i];
    out.push('<th', a ? ' align="' + a + '"' : '', '>', parseInline(header[i], refs), '</th>\n');
  }
  out.push('</tr>\n</thead>\n<tbody>');
  for (let r = 2; r < para.length; r++) {
    const cells = adjust(splitTableCells(stripEdgePipes(para[r].s)));
    out.push('<tr>\n');
    for (let i = 0; i < ncols; i++) {
      const a = aligns[i];
      out.push('<td', a ? ' align="' + a + '"' : '', '>', parseInline(cells[i], refs), '</td>\n');
    }
    out.push('</tr>\n');
  }
  out.push('</tbody></table>\n');
}

function stripEdgePipes(s) {
  let t = s.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t;
}
