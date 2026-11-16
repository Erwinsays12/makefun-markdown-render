// Inline parser: tokenizes inline Markdown into nodes, resolves emphasis with
// the CommonMark delimiter-stack algorithm, then renders to HTML.
import { decodeEntity, escapeText, escapeAttr, cleanUrl } from './entities.js';

const PUNCT_RE = /^\p{P}$/u;
const SPACE_RE = /^\s$/;
function isAsciiPunct(code) {
  return (code >= 33 && code <= 47) || (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) || (code >= 123 && code <= 126);
}
// CommonMark punctuation = ASCII punctuation + Unicode punctuation.
// (Note: `<`, `>`, `=`, `+` are Unicode symbols, not \p{P}, so the ASCII
// range must be checked explicitly.)
export function isPunct(ch) { return ch.length === 1 && (isAsciiPunct(ch.charCodeAt(0)) || PUNCT_RE.test(ch)); }
export function isSpace(ch) { return ch.length === 1 && SPACE_RE.test(ch); }

// Flanking info for a delimiter run at [start, end) in src.
function flanking(src, start, end) {
  const before = start > 0 ? src[start - 1] : '';
  const after = end < src.length ? src[end] : '';
  const beforeSpace = before === '' ? true : isSpace(before);
  const afterSpace = after === '' ? true : isSpace(after);
  const beforePunct = before !== '' && isPunct(before);
  const afterPunct = after !== '' && isPunct(after);
  const left = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
  const right = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
  return { left, right };
}

// Plain-text rendering of a link label, for image alt attributes: backslash
// escapes and entities are resolved, code spans become their literal text,
// everything else stays literal (no emphasis or links).
export function plainText(s) {
  let out = '', i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === '\\' && i + 1 < n && isAsciiPunct(s.charCodeAt(i + 1))) { out += s[i + 1]; i += 2; continue; }
    if (c === '`') {
      let j = i, run = 0;
      while (j < n && s[j] === '`') { j++; run++; }
      let k = j, found = -1;
      while (k < n) {
        if (s[k] === '`') {
          let m = k, r2 = 0;
          while (m < n && s[m] === '`') { m++; r2++; }
          if (r2 === run) { found = k; break; }
          k = m;
        } else k++;
      }
      if (found >= 0) {
        let content = s.slice(j, found).replace(/\n/g, ' ');
        if (content.length > 2 && content[0] === ' ' && content[content.length - 1] === ' ' &&
            content.trim() !== '') content = content.slice(1, -1);
        out += content; i = found + run; continue;
      }
      out += '`'; i++; continue;
    }
    if (c === '&') {
      const d = decodeEntity(s, i);
      if (d) { out += d[0]; i = d[1]; continue; }
      out += '&'; i++; continue;
    }
    out += c; i++;
  }
  return out;
}

// Scan an inline HTML tag starting at s[i] === '<'.
// Returns the end index (exclusive) or -1 when it is not a valid tag.
export function scanHtmlTag(s, i) {
  const n = s.length;
  if (s.startsWith('<!--', i)) {
    // `<!-->` and `<!--->` are empty comments ending at their own `>`.
    if (s[i + 4] === '>') return i + 5;
    if (s[i + 4] === '-' && s[i + 5] === '>') return i + 6;
    const e = s.indexOf('-->', i + 4);
    return e >= 0 ? e + 3 : -1;
  }
  if (s.startsWith('<?', i)) {
    const e = s.indexOf('?>', i + 2);
    return e >= 0 ? e + 2 : -1;
  }
  if (s.startsWith('<![CDATA[', i)) {
    const e = s.indexOf(']]>', i + 9);
    return e >= 0 ? e + 3 : -1;
  }
  if (s.startsWith('<!', i) && i + 2 < n && /[A-Za-z]/.test(s[i + 2])) {
    const e = s.indexOf('>', i + 2);
    return e >= 0 ? e + 1 : -1;
  }
  let j = i + 1, closing = false;
  if (s[j] === '/') { closing = true; j++; }
  if (j >= n || !/[A-Za-z]/.test(s[j])) return -1;
  while (j < n && /[A-Za-z0-9-]/.test(s[j])) j++;
  if (closing) {
    while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
    return (j < n && s[j] === '>') ? j + 1 : -1;
  }
  while (j < n) {
    const c = s[j];
    if (c === '>') return j + 1;
    if (c === '/') {
      if (j + 1 < n && s[j + 1] === '>') return j + 2;
      return -1;
    }
    if (c === ' ' || c === '\t' || c === '\n') { j++; continue; }
    // An attribute name must be preceded by whitespace; a ':' (or other
    // name char) directly after the tag name is not a valid tag.
    if (j === i + 1 + (closing ? 1 : 0) || !/[ \t\n]/.test(s[j - 1])) return -1;
    if (!/[A-Za-z_:]/.test(c) && !(c.charCodeAt(0) >= 128)) return -1;
    while (j < n && /[A-Za-z0-9_.:-]/.test(s[j])) j++;
    while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
    if (j < n && s[j] === '=') {
      j++;
      while (j < n && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n')) j++;
      if (j < n && (s[j] === '"' || s[j] === "'")) {
        const q = s[j]; j++;
        while (j < n && s[j] !== q) j++;
        if (j >= n) return -1;
        j++;
      } else {
        let m = 0;
        while (j < n && !/[\s"'=<>`]/.test(s[j])) { j++; m++; }
        if (m === 0) return -1;
      }
    }
  }
  return -1;
}

// Try to parse a <...> autolink at s[i] === '<'. Returns {href, text, end}
// or null. Scheme autolinks and email autolinks.
export function scanAngleAutolink(s, i) {
  const n = s.length;
  let j = i + 1;
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/.exec(s.slice(i + 1, i + 34));
  if (scheme) {
    j = i + 1 + scheme[0].length;
    while (j < n && s[j] !== '>' && s[j] !== ' ' && s[j] !== '\n' && s[j] !== '\t' && s[j] !== '<') j++;
    if (j < n && s[j] === '>') {
      const url = s.slice(i + 1, j);
      return { href: url, text: url, end: j + 1 };
    }
    return null;
  }
  const email = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*/.exec(s.slice(i + 1));
  if (email) {
    j = i + 1 + email[0].length;
    if (j < n && s[j] === '>') {
      const addr = email[0];
      return { href: 'mailto:' + addr, text: addr, end: j + 1 };
    }
  }
  return null;
}

// Trim trailing punctuation off a GFM extended autolink candidate.
function trimAutolinkTail(u) {
  let end = u.length;
  while (end > 0) {
    const c = u[end - 1];
    if (c === ')' ) {
      let open = 0, close = 0;
      for (let k = 0; k < end; k++) { if (u[k] === '(') open++; else if (u[k] === ')') close++; }
      if (close > open) { end--; continue; }
      break;
    }
    if (c === '?' || c === '!' || c === '.' || c === ',' || c === ':' || c === ';' || c === '*' || c === '_' || c === '~') { end--; continue; }
    break;
  }
  return u.slice(0, end);
}

// GFM extended autolink starting at s[i] (www., http(s)://, ftp://, email).
// before is the character before i ('' at start). Returns {href, text, end} or null.
export function scanGfmAutolink(s, i, before) {
  if (before !== '' && !isSpace(before) && !isPunct(before)) return null;
  const rest = s.slice(i);
  // `www.` must be lowercase; the scheme (https?/ftp) is case-insensitive.
  let m = /^www\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*[^\s<>]*/.exec(rest);
  let kind = 'www';
  if (!m) {
    m = /^(?:https?|ftp):\/\/[^\s<>]*/i.exec(rest);
    kind = 'scheme';
  }
  if (m) {
    let url = trimAutolinkTail(m[0]);
    if (kind === 'www') {
      // Validate the domain only (before any / ? # path/query).
      const cut = url.search(/[\/?#]/);
      const domain = cut >= 0 ? url.slice(0, cut) : url;
      const labels = domain.split('.');
      const last = labels[labels.length - 1];
      if (labels.length < 2 || !/^[A-Za-z]{2,}$/.test(last)) return null;
      return { href: 'http://' + url, text: url, end: i + url.length };
    }
    const sm = /^(https?|ftp):\/\//i.exec(url);
    if (!sm || url.length <= sm[0].length) return null;
    return { href: url, text: url, end: i + url.length };
  }
  // mailto: scheme autolink (the whole `mailto:addr` is the link text).
  m = /^mailto:[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*/i.exec(rest);
  if (m) {
    const addr = trimAutolinkTail(m[0].slice(7));
    if (addr.includes('@') && addr.slice(addr.lastIndexOf('@') + 1).includes('.')) {
      const url = 'mailto:' + addr;
      return { href: url, text: url, end: i + url.length };
    }
    return null;
  }
  m = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*/.exec(rest);
  if (m) {
    let addr = trimAutolinkTail(m[0]);
    const at = addr.lastIndexOf('@');
    if (at < 1 || !addr.slice(at + 1).includes('.')) return null;
    // If the next char would continue the domain label (alphanumeric,
    // hyphen, or underscore — a word character), the address is part of
    // a longer invalid token: no autolink.
    const nx = s[i + m[0].length];
    if (nx !== undefined && /[A-Za-z0-9_-]/.test(nx)) return null;
    return { href: 'mailto:' + addr, text: addr, end: i + addr.length };
  }
  return null;
}

function skipSpaces(s, i) {
  while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n')) i++;
  return i;
}

// Find the index of the ']' matching the '[' at s[i]; -1 if none.
// Skips code spans and backslash-escaped brackets.
export function findMatchingBracket(s, i) {
  const n = s.length;
  let depth = 0, j = i;
  while (j < n) {
    const c = s[j];
    if (c === '\\' && j + 1 < n && isAsciiPunct(s.charCodeAt(j + 1))) { j += 2; continue; }
    if (c === '`') {
      let k = j, run = 0;
      while (k < n && s[k] === '`') { k++; run++; }
      let m = k, found = -1;
      while (m < n) {
        if (s[m] === '`') {
          let p = m, r2 = 0;
          while (p < n && s[p] === '`') { p++; r2++; }
          if (r2 === run) { found = m; break; }
          m = p;
        } else m++;
      }
      // No matching closer: the backticks are literal text; keep scanning
      // past the run instead of failing the whole bracket match.
      if (found < 0) { j = k; continue; }
      j = found + run; continue;
    }
    // Skip an angle-bracket autolink `<...>` so a ']' inside its URL is
    // not mistaken for the label's closing bracket.
    if (c === '<') {
      let k = j + 1;
      while (k < n && s[k] !== '>' && s[k] !== '\n' && s[k] !== ' ' && s[k] !== '\t') k++;
      if (k < n && s[k] === '>' && k > j + 1) { j = k + 1; continue; }
    }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return j;
    }
    j++;
  }
  return -1;
}

// Parse a link destination starting at s[i] (after '(' and spaces).
// Returns {dest, end} or null.
function parseLinkDest(s, i) {
  const n = s.length;
  if (i < n && s[i] === '<') {
    let j = i + 1, out = '';
    while (j < n && s[j] !== '>') {
      const c = s[j];
      if (c === '\n' || c === '<') return null;
      if (c === '\\' && j + 1 < n && isAsciiPunct(s.charCodeAt(j + 1))) { out += s[j + 1]; j += 2; continue; }
      out += c; j++;
    }
    if (j >= n) return null;
    return { dest: out, end: j + 1 };
  }
  let j = i, depth = 0, out = '';
  while (j < n) {
    const c = s[j];
    if (c === ' ' || c === '\t' || c === '\n' || c.charCodeAt(0) < 32) break;
    if (c === '\\' && j + 1 < n && isAsciiPunct(s.charCodeAt(j + 1))) { out += s[j + 1]; j += 2; continue; }
    if (c === '(') { depth++; out += c; j++; continue; }
    if (c === ')') {
      if (depth === 0) break;
      depth--; out += c; j++; continue;
    }
    out += c; j++;
  }
  return { dest: out, end: j };
}

// Parse a link title starting at s[i] (after spaces). Returns {title, end} or null.
function parseTitle(s, i) {
  const n = s.length;
  if (i >= n) return null;
  const q = s[i];
  if (q === '"' || q === "'") {
    let j = i + 1, out = '';
    while (j < n && s[j] !== q) {
      if (s[j] === '\\' && j + 1 < n && isAsciiPunct(s.charCodeAt(j + 1))) { out += s[j + 1]; j += 2; continue; }
      out += s[j]; j++;
    }
    if (j >= n) return null;
    return { title: out, end: j + 1 };
  }
  if (q === '(') {
    let j = i + 1, depth = 1, out = '';
    while (j < n && depth > 0) {
      const c = s[j];
      if (c === '\\' && j + 1 < n && isAsciiPunct(s.charCodeAt(j + 1))) { out += s[j + 1]; j += 2; continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) break; }
      out += c; j++;
    }
    if (depth !== 0) return null;
    return { title: out, end: j + 1 };
  }
  return null;
}

// Normalize a link label: collapse whitespace, trim, lowercase with
// Unicode case folding (ß/ẞ fold to "ss", per CommonMark).
export function normalizeLabel(s) {
  return s.replace(/\s+/g, ' ').trim().toLowerCase().replace(/ß/g, 'ss').replace(/ẞ/g, 'ss');
}

// Does the label text contain a link (a `[` that forms a link)? Skips
// images (`![`), escaped brackets, and code spans. Used to block an outer
// link whose text contains a link (CommonMark).
function labelHasLink(label, refs) {
  const n = label.length;
  let i = 0;
  while (i < n) {
    const c = label[i];
    if (c === '\\' && i + 1 < n && isAsciiPunct(label.charCodeAt(i + 1))) { i += 2; continue; }
    if (c === '`') {
      let run = 0, j = i;
      while (j < n && label[j] === '`') { j++; run++; }
      let k = j, found = -1;
      while (k < n) {
        if (label[k] === '`') {
          let p = k, r2 = 0;
          while (p < n && label[p] === '`') { p++; r2++; }
          if (r2 === run) { found = k; break; }
          k = p;
        } else k++;
      }
      // No matching closer: literal backticks; keep scanning the label.
      if (found < 0) { i = j; continue; }
      i = found + run; continue;
    }
    if (c === '[' && !(i > 0 && label[i - 1] === '!')) {
      const lk = tryLink(label, i, refs, true);
      if (lk) return true;
    }
    i++;
  }
  return false;
}

// Try to parse a link or image starting at s[i] === '['.
// Returns {dest, title, end, labelText} or null.
// isImage: true when called for an image (alt text may contain a link
// pattern without blocking the image).
export function tryLink(s, i, refs, isImage = false) {
  const close = findMatchingBracket(s, i);
  if (close < 0) return null;
  const labelText = s.slice(i + 1, close);
  // A link's text cannot contain a link: if the label itself forms a link,
  // the outer link is not formed (the inner one wins). Images are exempt.
  if (!isImage && labelHasLink(labelText, refs)) return null;
  const n = s.length;
  let j = close + 1;
  if (j < n && s[j] === '(') {
    let k = skipSpaces(s, j + 1);
    const d = parseLinkDest(s, k);
    if (d) {
      k = skipSpaces(s, d.end);
      let title = null, ok = true;
      if (k < n && (s[k] === '"' || s[k] === "'" || s[k] === '(')) {
        const t = parseTitle(s, k);
        if (!t) ok = false;
        else { title = t.title; k = skipSpaces(s, t.end); }
      }
      if (ok && k < n && s[k] === ')') {
        return { dest: d.dest, title, end: k + 1, labelText };
      }
    }
    // Inline link failed: fall through to the shortcut reference link.
  }
  if (j < n && s[j] === '[') {
    const close2 = findMatchingBracket(s, j);
    if (close2 < 0) return null;
    let label = s.slice(j + 1, close2);
    if (label === '') label = labelText;
    if (label.length > 999) return null;
    const ref = refs.get(normalizeLabel(label));
    if (!ref) return null;
    return { dest: ref.dest, title: ref.title, end: close2 + 1, labelText };
  }
  if (labelText.length === 0 || labelText.length > 999) return null;
  const ref = refs.get(normalizeLabel(labelText));
  if (!ref) return null;
  return { dest: ref.dest, title: ref.title, end: close + 1, labelText };
}

// Tokenize inline Markdown into nodes. Node kinds:
// 0 text {s, raw?}, 1 code {s}, 2 html {s}, 3 link {href, title, ch},
// 4 image {src, title, alt}, 5 hard break, 6 delimiter {c, n, open, close},
// 7 emphasis {tag, ch}.
const SPECIAL_RE = /[\\`*_~\[!&<\n]/g;

// marked's GFM strikethrough (del) rule, verbatim.
const DEL_RE = /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/;

export function tokenize(src, refs, allowLinks) {
  const nodes = [];
  const n = src.length;
  let buf = '';
  const flush = () => {
    if (buf !== '') { nodes.push({ k: 0, s: escapeText(buf) }); buf = ''; }
  };
  let i = 0;
  const re = SPECIAL_RE;
  const autoRe = /(?:www\.|https?:\/\/|ftp:\/\/|mailto:|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@)/gi;
  while (i < n) {
    re.lastIndex = i;
    const m = re.exec(src);
    const p1 = m ? m.index : n;
    // Earliest valid GFM extended autolink starting before the next special.
    let auto = null, p2 = -1;
    autoRe.lastIndex = i;
    let am;
    while ((am = autoRe.exec(src)) !== null) {
      if (am.index >= p1) break;
      const cand = scanGfmAutolink(src, am.index, am.index > 0 ? src[am.index - 1] : '');
      if (cand) { p2 = am.index; auto = cand; break; }
    }
    if (auto) {
      if (p2 > i) buf += src.slice(i, p2);
      flush();
      const href = cleanUrl(auto.href);
      if (href !== null) {
        nodes.push({ k: 3, href, title: null, html: escapeText(auto.text) });
      } else {
        nodes.push({ k: 0, s: escapeText(auto.text) });
      }
      i = auto.end;
      continue;
    }
    const p = p1;
    if (p > i) buf += src.slice(i, p);
    if (!m) { i = n; break; }
    const c = src[p];
    i = p + 1;
    if (c === '\\') {
      if (i < n && isAsciiPunct(src.charCodeAt(i))) { buf += src[i]; i++; }
      else if (i < n && src[i] === '\n') {
        flush(); nodes.push({ k: 5 }); i++;
        while (i < n && (src[i] === ' ' || src[i] === '\t')) i++;
      }
      else buf += '\\';
      continue;
    }
    if (c === '`') {
      let run = 1;
      while (i < n && src[i] === '`') { i++; run++; }
      let k = i, found = -1;
      while (k < n) {
        if (src[k] === '`') {
          let q = k, r2 = 0;
          while (q < n && src[q] === '`') { q++; r2++; }
          if (r2 === run) { found = k; break; }
          k = q;
        } else k++;
      }
      if (found >= 0) {
        let content = src.slice(i, found).replace(/\n/g, ' ');
        if (content.length >= 2 && content[0] === ' ' && content[content.length - 1] === ' ' &&
            content.trim() !== '') content = content.slice(1, -1);
        flush();
        nodes.push({ k: 1, s: escapeText(content) });
        i = found + run;
      } else {
        buf += '`'.repeat(run);
      }
      continue;
    }
    if (c === '*' || c === '_') {
      let run = 1;
      while (i < n && src[i] === c) { i++; run++; }
      const fl = flanking(src, p, i);
      let open, close;
      if (c === '*') {
        open = fl.left; close = fl.right;
      }
      else {
        const before = p > 0 ? src[p - 1] : '';
        const after = i < n ? src[i] : '';
        open = fl.left && (!fl.right || (before !== '' && isPunct(before)));
        close = fl.right && (!fl.left || (after !== '' && isPunct(after)));
      }
      if (open || close) { flush(); nodes.push({ k: 6, c, n: run, open, close }); }
      else buf += c.repeat(run);
      continue;
    }
    if (c === '~') {
      // GFM strikethrough as a delimiter (like emphasis) so it can nest:
      // runs of 1-2 tildes; opens when followed by a non-space non-tilde,
      // closes when preceded by a non-space non-tilde and not followed by
      // a tilde. Runs of 3+ stay literal (marked: `~~~not~~~` is literal).
      let run = 1;
      while (i < n && src[i] === '~') { i++; run++; }
      if (run > 2) { buf += '~'.repeat(run); continue; }
      const nextCh = i < n ? src[i] : '';
      const prevCh = p > 0 ? src[p - 1] : '';
      const isWs = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
      const open = nextCh !== '' && nextCh !== '~' && !isWs(nextCh);
      const close = prevCh !== '' && prevCh !== '~' && !isWs(prevCh) && nextCh !== '~';
      if (open || close) { flush(); nodes.push({ k: 6, c: '~', n: run, open, close }); }
      else buf += '~'.repeat(run);
      continue;
    }
    if (c === '[') {
      if (allowLinks) {
        const lk = tryLink(src, p, refs);
        if (lk) {
          flush();
          const href = cleanUrl(lk.dest);
          if (href === null) {
            buf += '[';
          } else {
            const html = parseInline(lk.labelText, refs, false);
            nodes.push({ k: 3, href, title: lk.title, html });
            i = lk.end;
          }
          continue;
        }
      }
      buf += '[';
      continue;
    }
    if (c === '!') {
      if (i < n && src[i] === '[') {
        const lk = tryLink(src, i, refs, true);
        if (lk) {
          flush();
          const href = cleanUrl(lk.dest);
          if (href === null) {
            buf += '!';
          } else {
            nodes.push({ k: 4, src: href, title: lk.title, alt: altText(lk.labelText, refs) });
            i = lk.end;
          }
          continue;
        }
      }
      buf += '!';
      continue;
    }
    if (c === '&') {
      const d = decodeEntity(src, p);
      if (d) {
        if (src[p + 1] === '#') buf += d[0];
        else { flush(); nodes.push({ k: 0, s: d[0], raw: true }); }
        i = d[1];
      } else buf += '&';
      continue;
    }
    if (c === '<') {
      const auto = scanAngleAutolink(src, p);
      if (auto) {
        const href = cleanUrl(auto.href);
        if (href !== null) {
          flush();
          nodes.push({ k: 3, href, title: null, html: escapeText(auto.text) });
          i = auto.end;
          continue;
        }
      }
      const tagEnd = scanHtmlTag(src, p);
      if (tagEnd > 0) {
        flush();
        nodes.push({ k: 2, s: src.slice(p, tagEnd) });
        i = tagEnd;
        continue;
      }
      buf += '<';
      continue;
    }
    if (c === '\n') {
      let k = buf.length, spaces = 0;
      while (k > 0 && buf[k - 1] === ' ') { k--; spaces++; }
      if (spaces >= 2) {
        buf = buf.slice(0, k);
        flush();
        nodes.push({ k: 5 });
        // A hard break strips the next line's leading whitespace.
        while (i < n && (src[i] === ' ' || src[i] === '\t')) i++;
      } else {
        buf += '\n';
      }
      continue;
    }
    buf += c;
  }
  flush();
  return nodes;
}

// Resolve emphasis/strong/strikethrough delimiters with the CommonMark
// delimiter-stack algorithm.
function resolveEmphasis(nodes) {
  const openers = [];
  let i = 0;
  while (i < nodes.length) {
    const nd = nodes[i];
    if (nd.k !== 6) { i++; continue; }
    if (nd.close) {
      let matchIdx = -1;
      for (let j = openers.length - 1; j >= 0; j--) {
        const op = openers[j];
        if (op.c !== nd.c) continue;
        if (op.c !== '~' && op.open && op.close && nd.open && nd.close && (op.n + nd.n) % 3 === 0) continue;
        matchIdx = j; break;
      }
      if (matchIdx >= 0) {
        const op = openers[matchIdx];
        // marked's strikethrough accepts a single tilde; consume the
        // smaller side so symmetric runs (1, 2, 3) are fully consumed.
        const use = op.c === '~' ? Math.min(op.n, nd.n) : ((op.n >= 2 && nd.n >= 2) ? 2 : 1);
        const oi = nodes.indexOf(op);
        const children = nodes.slice(oi + 1, i);
        const tag = op.c === '~' ? 'del' : (use === 2 ? 'strong' : 'em');
        const wrap = { k: 7, tag, ch: children };
        op.n -= use;
        nd.n -= use;
        const rep = [];
        if (op.n > 0) rep.push({ k: 6, c: op.c, n: op.n, open: op.open, close: op.close });
        rep.push(wrap);
        if (nd.n > 0) rep.push({ k: 6, c: nd.c, n: nd.n, open: nd.open, close: nd.close });
        nodes.splice(oi, i - oi + 1, ...rep);
        openers.length = matchIdx;
        if (op.n > 0) openers.push(rep[0]);
        if (nd.n > 0) { i = oi + rep.length - 1; continue; }
        i = oi + (op.n > 0 ? 1 : 0) + 1;
        continue;
      }
      if (nd.open) openers.push(nd);
      i++;
      continue;
    }
    if (nd.open) openers.push(nd);
    i++;
  }
}

function renderNodes(nodes, out) {
  for (const nd of nodes) {
    switch (nd.k) {
      case 0: out.push(nd.s); break;
      case 1: out.push('<code>', nd.s, '</code>'); break;
      case 2: out.push(nd.s); break;
      case 3:
        out.push('<a href="', escapeAttr(nd.href), '"');
        if (nd.title !== null && nd.title !== undefined) out.push(' title="', escapeAttr(nd.title), '"');
        out.push('>', nd.html, '</a>');
        break;
      case 4:
        out.push('<img src="', escapeAttr(nd.src), '" alt="', escapeAttr(nd.alt), '"');
        if (nd.title) out.push(' title="', escapeAttr(nd.title), '"');
        out.push('>');
        break;
      case 5: out.push('<br>'); break;
      case 6: out.push(nd.c.repeat(nd.n)); break;
      case 7:
        out.push('<', nd.tag, '>');
        renderNodes(nd.ch, out);
        out.push('</', nd.tag, '>');
        break;
      case 8:
        out.push('<', nd.tag, '>', nd.html, '</', nd.tag, '>');
        break;
    }
  }
}

export function parseInline(src, refs, allowLinks = true) {
  const nodes = tokenize(src, refs, allowLinks);
  resolveEmphasis(nodes);
  const out = [];
  renderNodes(nodes, out);
  return out.join('');
}

// Unescape HTML entities back to plain text.
function unescapeHtml(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => { const cp = +d; return (cp === 0 || cp > 0x10FFFF) ? '\uFFFD' : String.fromCodePoint(cp); })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => { const cp = parseInt(h, 16); return (cp === 0 || cp > 0x10FFFF) ? '\uFFFD' : String.fromCodePoint(cp); });
}

// Strip HTML tags, keeping an <img>'s alt text.
function stripTags(html) {
  const withAlt = html.replace(/<img\b[^>]*\salt="([^"]*)"[^>]*>/g, '$1');
  return unescapeHtml(withAlt.replace(/<[^>]*>/g, ''));
}

function extractText(nodes) {
  let out = '';
  for (const nd of nodes) {
    switch (nd.k) {
      case 0: case 1: out += unescapeHtml(nd.s); break;
      case 2: out += nd.s; break;
      case 3: out += stripTags(nd.html); break;
      case 4: out += unescapeHtml(nd.alt); break;
      case 5: out += ' '; break;
      case 6: out += nd.c.repeat(nd.n); break;
      case 7: out += extractText(nd.ch); break;
      case 8: out += stripTags(nd.html); break;
    }
  }
  return out;
}

// Image alt text: the label parsed as inline, reduced to plain text
// (emphasis/links/images resolve to their text; code spans keep their
// literal text), then escaped for the alt attribute.
export function altText(label, refs) {
  const nodes = tokenize(label, refs, true);
  resolveEmphasis(nodes);
  return escapeAttr(extractText(nodes));
}
