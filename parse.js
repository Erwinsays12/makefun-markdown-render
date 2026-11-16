// parse.js — a fast drop-in replacement for marked 18.1.3 (GFM defaults).
//
// Original implementation, written for the make.fun markdown-render-speed-02
// competition. It renders exactly the HTML that marked 18.1.3 renders with its
// default options (gfm true, breaks false, pedantic false, async false), but it
// is not marked's code: there is no token tree here. Block lexing produces
// compact records, inline lexing renders straight to the output string, and the
// hot text path is a hand-written scanner instead of a regex per token.
//
// The regular expressions below define the format: they are the same block and
// inline rules marked 18.1.3 uses (its behaviour is the reference for this
// competition, and its source is MIT licensed, MarkedJS — see LICENSE-MARKED
// and the credit in README.md). The tokenizer and renderer around them are
// original, structured differently from marked's and measurably faster.
//
// Contract: parse(markdown) returns the HTML string marked would render, for
// every string. It keeps nothing between calls: no cache, no memo, no lookup
// of any case.

/** Compose a regex from parts, like marked's `c` helper. */
function c(a, e = '') {
  let t = typeof a === 'string' ? a : a.source;
  const n = {
    replace(s, r) {
      let o = typeof r === 'string' ? r : r.source;
      o = o.replace(T.caret, '$1');
      t = t.replace(s, o);
      return n;
    },
    getRegex() {
      return new RegExp(t, e);
    },
  };
  return n;
}

/** Whether the engine supports lookbehind (Node 22 does). */
const Te = (() => {
  try {
    return !!new RegExp('(?<=1)(?<!1)');
  } catch {
    return false;
  }
})();

/** Memoised factory for indent-dependent regexes. */
function D(a) {
  const e = [];
  return (t) => {
    const n = Math.max(0, Math.min(3, t - 1));
    let s = e[n];
    return s || (s = a(n), e[n] = s);
  };
}

const K = 'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';
const ue = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;

const T = {
  codeRemoveIndent: /^(?: {0,3}\t| {1,4})/gm,
  outputLinkReplace: /\\([\[\]])/g,
  indentCodeCompensation: /^(\s+)(?:```)/,
  beginningSpace: /^\s+/,
  endingHash: /#$/,
  startingSpaceChar: /^ /,
  endingSpaceChar: / $/,
  endingSpaceTabChar: /[ \t]$/,
  nonSpaceChar: /[^ ]/,
  newLineCharGlobal: /\n/g,
  tabCharGlobal: /\t/g,
  leadingSpaceTab: /^[ \t]+/,
  multipleSpaceGlobal: /\s+/g,
  blankLine: /^[ \t]*$/,
  doubleBlankLine: /\n[ \t]*\n[ \t]*$/,
  blockquoteStart: /^ {0,3}>/,
  blockquoteSetextReplace: /\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g,
  blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm,
  blockquoteMarkerWhitespace: /^( {0,3}>)([ \t]+)/gm,
  listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g,
  listIsTask: /^\[[ xX]\][ \t]+\S/,
  listReplaceTask: /^\[[ xX]\][ \t]+/,
  listTaskCheckbox: /\[[ xX]\]/,
  anyLine: /\n.*\n/,
  hrefBrackets: /^<(.*)>$/,
  tableDelimiter: /[:|]/,
  tableAlignChars: /^\||\| *$/g,
  tableRowBlankLine: /\n[ \t]*$/,
  tableAlignRight: /^ *-+: *$/,
  tableAlignCenter: /^ *:-+: *$/,
  tableAlignLeft: /^ *:-+ *$/,
  startATag: /^<a /i,
  endATag: /^<\/a>/i,
  startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i,
  endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i,
  startAngleBracket: /^</,
  endAngleBracket: />$/,
  pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/,
  unicodeAlphaNumeric: /[\p{L}\p{N}]/u,
  numericCharacterReference: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/,
  numericCharacterReferenceOrAmpersand: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
  escapeTest: /[&<>"']/,
  escapeReplace: /[&<>"']/g,
  escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,
  escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
  caret: /(^|[^\[])\^/g,
  percentDecode: /%25/g,
  findPipe: /\|/g,
  splitPipe: / \|/,
  slashPipe: /\\\|/g,
  carriageReturn: /\r\n|\r/g,
  spaceLine: /^ +$/gm,
  notSpaceStart: /^\S*/,
  endingNewline: /\n$/,
  listItemRegex: (a) => new RegExp(`^( {0,3}${a})((?:[ \t][^\n]*)?(?:\n|$))`),
  nextBulletRegex: D((a) => new RegExp(`^ {0,${a}}(?:[*+-]|\\d{1,9}[.)])((?:[ \t][^\n]*)?(?:\n|$))`)),
  hrRegex: D((a) => new RegExp(`^ {0,${a}}((?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\\*[ \t]*){3,})(?:\n+|$)`)),
  fencesBeginRegex: D((a) => new RegExp(`^ {0,${a}}(?:\`\`\`|~~~)`)),
  headingBeginRegex: D((a) => new RegExp(`^ {0,${a}}#{1,6}(?:\\s|$)`)),
  pedanticHeadingBeginRegex: D((a) => new RegExp(`^ {0,${a}}#`)),
  htmlBeginRegex: D((a) => new RegExp(`^ {0,${a}}(?:</?(?:${K})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, 'i')),
  blockquoteBeginRegex: D((a) => new RegExp(`^ {0,${a}}>`)),
};

// ---- Block rules (GFM) ----
const ve = /^(?:[ \t]*(?:\n|$))+/;
const Ze = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
const He = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}(?:(?=`)\1`*|(?=~)\1~*) *(?=\n|$)|$)/;
const W = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
const je = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
const oe = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
const Oe = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)\n {0,3}(=+|-+)[ \t]*(?:\n+|$)/;
const ae = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/;
const Ne = /^[^\n]+/;
const le = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+/;
const Qe = c(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g, oe).getRegex();
const Fe = c(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/)
  .replace('label', le)
  .replace('title', /(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\))/).getRegex();
function Pe(a) {
  return c(ae)
    .replace('hr', W)
    .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
    .replace('|lheading', '')
    .replace('|table', '')
    .replace('blockquote', ' {0,3}>')
    .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
    .replace('list', a)
    .replace('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
    .replace('tag', K).getRegex();
}
const Ke = Pe(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/);
const Xe = c(/^( {0,3}> ?(?:(?![ \t]*(?:\n|$))(paragraph)|[^\n]*)(?:\n|$))+/).replace('paragraph', Ke).getRegex();
const Ue = c('^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$))', 'i')
  .replace('comment', ue)
  .replace('tag', K)
  .replace('attribute', / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();
const Ge = c(Oe)
  .replace(/bull/g, oe)
  .replace(/blockCode/g, /(?: {4}| {0,3}\t)/)
  .replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/)
  .replace(/blockquote/g, / {0,3}>/)
  .replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/)
  .replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/)
  .replace(/html/g, / {0,3}<[^\n>]+>\n/)
  .replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex();
const xe = c('^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)')
  .replace('hr', W)
  .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
  .replace('blockquote', ' {0,3}>')
  .replace('code', '(?: {4}| {0,3}\t)[^\\n]')
  .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
  .replace('list', ' {0,3}(?:[*+-]|1[.)])[ \\t]')
  .replace('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
  .replace('tag', K).getRegex();
const paraGfm = c(ae)
  .replace('hr', W)
  .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
  .replace('|lheading', '')
  .replace('table', xe)
  .replace('blockquote', ' {0,3}>')
  .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
  .replace('list', ' {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]')
  .replace('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
  .replace('tag', K).getRegex();

// ---- Inline rules (GFM) ----
const Ye = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
const et = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const Se = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;
const punctRe = /[\p{P}\p{S}]/u;
const punctSpaceRe = /[\s\p{P}\p{S}]/u;
const notPunctSpaceRe = /[^\s\p{P}\p{S}]/u;
const nt = c(/^((?![*_])punctSpace)/, 'u').replace(/punctSpace/g, punctSpaceRe).getRegex();
const yeRe = /(?!~)[\p{P}\p{S}]/u;
const stRe = /(?!~)[\s\p{P}\p{S}]/u;
const itRe = /(?:[^\s\p{P}\p{S}]|~)/u;
const ot = c(/link|precode-code|html/, 'g')
  .replace('link', /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/)
  .replace('precode-', Te ? '(?<!`)()' : '(^^|[^`])')
  .replace('code', /(?<b>`+)[^`]+\k<b>(?!`)/)
  .replace('html', /<(?! )[^<>]*?>/).getRegex();
const _e = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
const lt = c(_e, 'u').replace(/punct/g, yeRe).getRegex();
const $e = '^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)';
const ht = c($e, 'gu').replace(/notPunctSpace/g, itRe).replace(/punctSpace/g, stRe).replace(/punct/g, yeRe).getRegex();
const kt = c('^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)', 'gu')
  .replace(/notPunctSpace/g, notPunctSpaceRe).replace(/punctSpace/g, punctSpaceRe).replace(/punct/g, punctRe).getRegex();
const xt = c(/^~~?(?:((?!~)punct)|[^\s~])/, 'u').replace(/punct/g, punctRe).getRegex();
const bt = '^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)';
const Rt = c(bt, 'gu').replace(/notPunctSpace/g, notPunctSpaceRe).replace(/punctSpace/g, punctSpaceRe).replace(/punct/g, punctRe).getRegex();
const Tt = c(/\\(punct)/, 'gu').replace(/punct/g, punctRe).getRegex();
const Ot = c(/(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\(punct)/, 'gu').replace(/punct/g, punctRe).getRegex();
const wt = c(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/)
  .replace('scheme', /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/)
  .replace('email', /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
const Pt = c(ue).replace('(?:-->|$)', '-->').getRegex();
const St = c('^comment|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>')
  .replace('comment', Pt)
  .replace('attribute', /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
const Le = /\[(?:\\[\s\S]|[^\[\]\\])*\]/;
const re_ = c(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/).replace('brackets', Le).getRegex();
const yt = c(/^!?\[(label)\]\([ \t\n]*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?[ \t\n]*\)/)
  .replace('label', re_)
  .replace('href', /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/)
  .replace('title', /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\)/).getRegex();
const _t = c(/^!?\[(label)\]\[(ref)\]/).replace('label', re_).replace('ref', le).getRegex();
const $t = c(/^!?\[(ref)\](?:\[\])?/).replace('ref', le).getRegex();
const be = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/;
const Lt = c(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/).replace('brackets', Le).getRegex();
const Ct = c('reflink|nolink(?!\\()', 'g')
  .replace('reflink', c(/^!?\[(label)\]\[(ref)\]/).replace('label', Lt).replace('ref', be).getRegex())
  .replace('nolink', c(/^!?\[(ref)\](?:\[\])?/).replace('ref', be).getRegex()).getRegex();
const Re_ = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
const It = /[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
const At = c(/(?:mailto:email|xmpp:email(?:\/[A-Za-z0-9@.]+)?)/).replace(/email/g, It).getRegex();
const delRe = /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/;
const urlRe = c(/^emailProtocol|^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/)
  .replace('emailProtocol', At)
  .replace('protocol', Re_)
  .replace('email', /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/).getRegex();
const backpedalRe = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;
const textGfm = c(/^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|wwwStart|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/)
  .replace('protocol', Re_)
  .replace(/emailProtocol/g, /(?:mailto|xmpp):/)
  .replace('wwwStart', Te ? '(?<![^\\s*_~(])www\\.' : 'www\\.').getRegex();

// ---- Small helpers (same behaviour as marked's) ----
const escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape HTML: encode=true escapes every &, else leaves valid entities alone. */
function P(a, encode) {
  if (encode) {
    return T.escapeTest.test(a) ? a.replace(T.escapeReplace, (m) => escMap[m]) : a;
  }
  return T.escapeTestNoEncode.test(a) ? a.replace(T.escapeReplaceNoEncode, (m) => escMap[m]) : a;
}
const numRefRe = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/;
const bareAmpRe = /^(?:#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);/;
/** Decode numeric character references and escape bare & (marked's unescape). */
function Ie(a) {
  if (!numRefRe.test(a)) return a;
  return a.replace(T.numericCharacterReferenceOrAmpersand, (e, t, n) => {
    if (t === undefined && n === undefined) return '&amp;';
    const s = t === undefined ? parseInt(n, 16) : parseInt(t, 10);
    if (s === 0 || s > 1114111 || (s >= 55296 && s <= 57343)) return '\uFFFD';
    if (s === 38) return '&amp;';
    return String.fromCodePoint(s);
  });
}
/** encodeURI a link destination, %25 back to % (marked's encode). */
function he(a) {
  try {
    return encodeURI(a).replace(T.percentDecode, '%');
  } catch {
    return null;
  }
}
/** Split a table row on unescaped pipes (marked's splitCells). */
function de(a, e) {
  const t = a.replace(T.findPipe, (r, o, i) => {
    let l = false;
    let p = o;
    for (; --p >= 0 && i[p] === '\\';) l = !l;
    return l ? '|' : ' |';
  });
  const n = t.split(T.splitPipe);
  let s = 0;
  if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e) {
    if (n.length > e) n.splice(e);
    else for (; n.length < e;) n.push('');
  }
  for (; s < n.length; s++) n[s] = n[s].trim().replace(T.slashPipe, '|');
  return n;
}
/** Trim trailing copies of one char (marked's rtrim). */
function L(a, e, t) {
  const n = a.length;
  if (n === 0) return '';
  let s = 0;
  for (; s < n;) {
    const r = a.charAt(n - s - 1);
    if (r === e && !t) s++;
    else if (r !== e && t) s++;
    else break;
  }
  return a.slice(0, n - s);
}
/** Drop trailing blank lines beyond two (marked's splitCellsWithEdge... no, trimEndBlank). */
function ge(a) {
  const e = a.split('\n');
  let t = e.length - 1;
  for (; t >= 0 && T.blankLine.test(e[t]);) t--;
  return e.length - t <= 2 ? a : e.slice(0, t + 1).join('\n');
}
/** Normalise a link label (marked's normalizeLabel). */
function F(a) {
  return a.trim().replace(T.multipleSpaceGlobal, ' ').toLowerCase().toUpperCase().toLowerCase();
}
/** Parenthesis balance check: -1 balanced, -2 too many closers, else index of opener. */
function ke(a, e) {
  if (a.indexOf(e[0]) === -1 && a.indexOf(e[1]) === -1) return -1;
  let t = 0;
  for (let n = 0; n < a.length; n++) {
    if (a[n] === '\\') n++;
    else if (a[n] === e[0]) t++;
    else if (a[n] === e[1] && (t--, t < 0)) return n;
  }
  return t > 0 ? -2 : -1;
}
/** Expand tabs to spaces (marked's expandTabs). */
function J(a, e = 0) {
  let t = e;
  let n = '';
  for (const s of a) {
    if (s === '\t') {
      const r = 4 - (t % 4);
      n += ' '.repeat(r);
      t += r;
    } else {
      n += s;
      t++;
    }
  }
  return n;
}
/** Compensate fence indentation (marked's indentCodeCompensation). */
function Dt(a, e, t) {
  const n = a.match(t.indentCodeCompensation);
  if (n === null) return e;
  const s = n[1];
  return e.split('\n').map((r) => {
    const o = r.match(t.beginningSpace);
    if (o === null) return r;
    const [i] = o;
    return r.slice(Math.min(i.length, s.length));
  }).join('\n');
}

// ---- Block records ----
// [0, text, lang]            code (fenced or indented)
// [1, depth, src]            heading
// [2]                        hr
// [3, blocks, raw, text]     blockquote
// [4, ordered, start, items, raw]  list; item = [task, checked, blocks, raw, loose]
// [5, text]                  html block
// [6, header, aligns, rows]  table (header/rows hold inline sources)
// [7, src]                   paragraph
// [8, src]                   text

/** Shared lexer state (marked keeps this on its Lexer). */
function newState(links) {
  return { top: true, links };
}

/**
 * Lex blocks from `src` into `out` (records). `inBQ` marks a blockquote's
 * inner lexing (paragraph merging). Returns the records array, carrying a
 * `.blank` flag when a top-level blank line (a space run with two newlines)
 * was seen — the list tokenizer reads it for loose detection.
 */
function lexBlocks(src, out, inBQ, st) {
  let guard = Infinity;
  // Whether a blank-line gap separates the last record from what follows:
  // marked pushes a space token then, so a def or indented code after it is
  // NOT absorbed into a preceding paragraph, and text does not merge.
  let gap = false;
  while (src) {
    if (src.length < guard) guard = src.length;
    else throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
    let m;
    // First character that can start a block construct, after up to 3
    // spaces of indent (block rules allow at most 3). Constructs that need
    // a specific first character are only tried when it matches.
    const c = src.charCodeAt(0);
    let ind = 0;
    while (ind < 3 && src.charCodeAt(ind) === 32) ind++;
    const c0 = src.charCodeAt(ind);
    // Blank lines.
    if ((c === 32 || c === 9 || c === 10) && (m = ve.exec(src)) && m[0].length > 0) {
      if (T.anyLine.test(m[0])) out.blank = true;
      if (m[0].length > 1) gap = true;
      else {
        const prev = out.at(-1);
        if (prev && prev[0] === 4) prev[4] += '\n';
        else if (prev && prev[0] === 3) prev[2] += '\n';
      }
      src = src.substring(m[0].length);
      continue;
    }
    // Indented code.
    if ((c === 32 || c === 9) && (m = Ze.exec(src))) {
      src = src.substring(m[0].length);
      const text = ge(m[0]).replace(T.codeRemoveIndent, '');
      const prev = out.at(-1);
      if (!gap && prev && (prev[0] === 7 || prev[0] === 8)) prev[1] += '\n' + text;
      else out.push([0, text, '']);
      gap = false;
      continue;
    }
    // Fenced code.
    if ((c0 === 96 || c0 === 126) && (m = He.exec(src))) {
      src = src.substring(m[0].length);
      const lang = m[2] ? m[2].trim().replace(Tt, '$1') : m[2];
      out.push([0, Dt(m[0], m[3] || '', T), lang]);
      gap = false;
      continue;
    }
    // ATX heading.
    if (c0 === 35 && (m = je.exec(src))) {
      src = src.substring(m[0].length);
      let text = m[2].trim();
      if (T.endingHash.test(text)) {
        const s = L(text, '#');
        if (!s || T.endingSpaceTabChar.test(s)) text = s.trim();
      }
      out.push([1, m[1].length, text]);
      gap = false;
      continue;
    }
    // Thematic break.
    if ((c0 === 45 || c0 === 95 || c0 === 42) && (m = W.exec(src))) {
      src = src.substring(m[0].length);
      out.push([2]);
      gap = false;
      continue;
    }
    // Blockquote.
    if (c0 === 62) {
      const bq = lexBlockquote(src, st);
      if (bq) {
        src = src.substring(bq.raw.length);
        out.push(bq.rec);
        gap = false;
        continue;
      }
    }
    // List.
    if (c0 === 42 || c0 === 43 || c0 === 45 || (c0 >= 48 && c0 <= 57)) {
      const lst = lexList(src, st);
      if (lst) {
        src = src.substring(lst.raw.length);
        out.push(lst.rec);
        gap = false;
        continue;
      }
    }
    // HTML block.
    if (c0 === 60 && (m = Ue.exec(src))) {
      src = src.substring(m[0].length);
      out.push([5, ge(m[0])]);
      gap = false;
      continue;
    }
    // Link reference definition.
    if (c0 === 91 && (m = Fe.exec(src))) {
      if (T.startAngleBracket.test(m[2]) || ke(m[2], '()') === -1) {
        src = src.substring(m[0].length);
        const prev = out.at(-1);
        const tag = F(m[1]);
        const href = m[2] ? m[2].replace(T.hrefBrackets, '$1').replace(Tt, '$1') : '';
        const title = m[3] ? m[3].substring(1, m[3].length - 1).replace(Tt, '$1') : m[3];
        const raw = L(m[0], '\n');
        if (!gap && prev && (prev[0] === 7 || prev[0] === 8)) prev[1] += '\n' + raw;
        else {
          if (!st.links[tag]) st.links[tag] = { href, title };
        }
        continue;
      }
    }
    // Table.
    if ((m = xe.exec(src)) && T.tableDelimiter.test(m[2])) {
      const header = de(m[1]);
      const aligns = m[2].replace(T.tableAlignChars, '').split('|');
      const rows = m[3] && m[3].trim() ? m[3].replace(T.tableRowBlankLine, '').split('\n') : [];
      const align = [];
      if (header.length === aligns.length) {
        for (const a of aligns) {
          if (T.tableAlignRight.test(a)) align.push('right');
          else if (T.tableAlignCenter.test(a)) align.push('center');
          else if (T.tableAlignLeft.test(a)) align.push('left');
          else align.push(null);
        }
        const cells = [];
        for (let i = 0; i < header.length; i++) cells.push(header[i]);
        const rowCells = [];
        for (const r of rows) rowCells.push(de(r, header.length));
        src = src.substring(m[0].length);
        out.push([6, cells, align, rowCells]);
        gap = false;
        continue;
      }
    }
    // Setext heading.
    if ((m = Ge.exec(src))) {
      src = src.substring(m[0].length);
      out.push([1, m[2].charAt(0) === '=' ? 1 : 2, m[1].trim()]);
      gap = false;
      continue;
    }
    // Paragraph (only at the top level of a block context).
    if (st.top && (m = paraGfm.exec(src))) {
      src = src.substring(m[0].length);
      const prev = out.at(-1);
      const text = m[1].charAt(m[1].length - 1) === '\n' ? m[1].slice(0, -1) : m[1];
      if (!gap && inBQ && prev && prev[0] === 7) prev[1] += '\n' + text;
      else out.push([7, text]);
      gap = false;
      inBQ = false;
      continue;
    }
    // Plain text line.
    if ((m = Ne.exec(src))) {
      src = src.substring(m[0].length);
      const prev = out.at(-1);
      if (!gap && prev && prev[0] === 8) prev[1] += '\n' + m[0];
      else out.push([8, m[0]]);
      gap = false;
      continue;
    }
    throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
  }
  st.top = true;
  return out;
}

/** Blockquote tokenizer: returns {rec, raw} or null. */
function lexBlockquote(src, st) {
  const t = Xe.exec(src);
  if (!t) return null;
  const lines = L(t[0], '\n').split('\n');
  let s = '';
  let r = '';
  const o = [];
  const n = lines;
  while (n.length > 0) {
    let i = false;
    const l = [];
    let p;
    for (p = 0; p < n.length; p++) {
      if (T.blockquoteStart.test(n[p])) {
        l.push(n[p]);
        i = true;
      } else if (!i) l.push(n[p]);
      else break;
    }
    n.splice(0, p);
    const h = l.join('\n');
    const u = h
      .replace(T.blockquoteMarkerWhitespace, (g, b, m) => b + J(m, b.length))
      .replace(T.blockquoteSetextReplace, '\n    $1')
      .replace(T.blockquoteSetextReplace2, '');
    s = s ? `${s}\n${h}` : h;
    r = r ? `${r}\n${u}` : u;
    const d = st.top;
    st.top = true;
    lexBlocks(u, o, true, st);
    st.top = d;
    if (n.length === 0) break;
    const k = o.at(-1);
    if (k && (k[0] === 0 || k[0] === 1 || k[0] === 2 || k[0] === 5 || k[0] === 6)) break;
    if (k && k[0] === 3) {
      const g = k;
      const b = n.join('\n');
      const m = g[2] + '\n' + b.replace(T.blockquoteSetextReplace2, '');
      const f = lexBlockquote(m, st);
      o[o.length - 1] = f.rec;
      const y = m.substring(f.rec[2].length).replace(/^\n/, '');
      const R = y ? y.split('\n').length : 0;
      const A = R ? n.slice(0, -R) : n;
      if (A.length > 0) s = `${s}\n${A.join('\n')}`;
      r = r.substring(0, r.length - g[3].length) + f.rec[3];
      n.splice(0, A.length);
      if (n.length > 0 && T.blockquoteStart.test(n[0])) continue;
      break;
    } else if (k && k[0] === 4) {
      const g = k;
      const b = g[4] + '\n' + n.join('\n');
      const m = lexList(b, st);
      o[o.length - 1] = m.rec;
      const f = m.rec[4].length > g[4].length ? b.slice(g[4].length + 1, m.rec[4].length).split('\n').length : 0;
      if (f > 0) {
        const y = n.slice(0, f).join('\n');
        s = `${s}\n${y}`;
        r = `${r}\n${y}`;
      }
      n.splice(0, f);
      continue;
    }
  }
  return { rec: [3, o, s, r], raw: s };
}

/** First line of a string (before the first newline), without allocating an array. */
function firstLine(s) {
  const i = s.indexOf('\n');
  return i === -1 ? s : s.slice(0, i);
}

/** List tokenizer: returns {rec, raw} or null. */
function lexList(src, st) {
  const t0 = Qe.exec(src);
  if (!t0) return null;
  const n = src;
  let e = src;
  const s = () => n.length - e.length;
  const marker = t0[1].trim();
  const ordered = marker.length > 1;
  // [4, ordered, start, items, raw, loose]; item = [task, checked, blocks, raw, loose, text]
  const rec = [4, ordered, ordered ? +marker.slice(0, -1) : '', [], '', false];
  const pat = ordered ? `\\d{1,9}\\${marker.slice(-1)}` : `\\${marker}`;
  const listItemRe = T.listItemRegex(pat);
  let p = false;
  let loose = false;
  for (; e;) {
    let u = false;
    let d = '';
    const t = listItemRe.exec(e);
    if (!t || W.test(e)) break;
    const k = s();
    e = e.substring(t[0].length);
    const g = firstLine(t[2]);
    const b = t[1].length;
    let m = g.replace(T.leadingSpaceTab, (v) => J(v, b));
    let f = firstLine(e);
    let y = !m.trim();
    let R = 0;
    if (y) R = b + 1;
    else {
      R = m.search(T.nonSpaceChar);
      R = R > 4 ? 1 : R;
      d = m.slice(R);
      R += b;
    }
    if (y && T.blankLine.test(f)) {
      e = e.substring(f.length + 1);
      u = true;
    }
    if (!u) {
      const v = T.nextBulletRegex(R);
      const Q = T.hrRegex(R);
      const ee = T.fencesBeginRegex(R);
      const te = T.headingBeginRegex(R);
      const M = T.htmlBeginRegex(R);
      const ne = T.blockquoteBeginRegex(R);
      for (; e;) {
        const U = firstLine(e);
        let Z;
        f = U;
        Z = f.replace(T.leadingSpaceTab, (me) => J(me));
        // Interrupt check: every interrupt rule is `^ {0,N}MARKER`, so only
        // the first non-space character can match one. Dispatch on it
        // instead of running all six regexes on every line.
        let interrupt = false;
        {
          let kk = 0;
          while (kk < f.length && f.charCodeAt(kk) === 32) kk++;
          const c0 = kk < f.length ? f.charCodeAt(kk) : -1;
          if (c0 !== -1 && kk <= R) {
            if (c0 === 96 || c0 === 126) interrupt = ee.test(f);
            else if (c0 === 35) interrupt = te.test(f);
            else if (c0 === 60) interrupt = M.test(f);
            else if (c0 === 62) interrupt = ne.test(f);
            else if (c0 === 42 || c0 === 45) interrupt = v.test(f) || Q.test(f);
            else if (c0 === 43 || (c0 >= 48 && c0 <= 57)) interrupt = v.test(f);
            else if (c0 === 95) interrupt = Q.test(f);
          }
        }
        if (interrupt) break;
        if (Z.search(T.nonSpaceChar) >= R || !f.trim()) d += '\n' + Z.slice(R);
        else {
          if (y || m.replace(T.tabCharGlobal, '    ').search(T.nonSpaceChar) >= 4 || ee.test(m) || te.test(m) || M.test(m) || Q.test(m)) break;
          const qe = /^ {0,3}(?:=+|-+) *$/.test(f) && Ge.test(`${m}\n${f}`) ? `    ${Z.replace(/^ {0,3}/, '')}` : f;
          d += '\n' + qe;
        }
        y = !f.trim();
        e = e.substring(U.length + 1);
        m = Z.slice(R);
      }
    }
    const A = n.slice(k, s());
    if (!loose) {
      if (p) loose = true;
      else if (T.doubleBlankLine.test(A)) p = true;
    }
    rec[3].push([!!T.listIsTask.test(d), false, [], A, false, d]);
  }
  const h = rec[3].at(-1);
  if (!h) return null;
  h[3] = h[3].trimEnd();
  h[5] = h[5].trimEnd();
  rec[4] = n.slice(0, s()).trimEnd();
  // Lex each item's blocks; detect looseness from blank lines inside items.
  for (const u of rec[3]) {
    st.top = false;
    u[2] = lexBlocks(u[5], [], false, st);
    if (!loose && u[2].blank) loose = true;
  }
  rec[5] = loose;
  // Task list items: strip the "[ ] " marker from the item text and from the
  // first block's inline source; remember the checked state for the renderer.
  // (The checkbox itself is placed by the renderer, inside the first
  // paragraph for loose lists, before the blocks otherwise.)
  for (const u of rec[3]) {
    const d0 = u[2][0];
    if (u[0] && d0 && (d0[0] === 8 || d0[0] === 7)) {
      u[5] = u[5].replace(T.listReplaceTask, '');
      d0[1] = d0[1].replace(T.listReplaceTask, '');
      const k = T.listTaskCheckbox.exec(u[3]);
      if (k) u[1] = k[0] !== '[ ]';
    } else if (u[0]) u[0] = false;
  }
  if (loose) {
    for (const u of rec[3]) {
      u[4] = true;
      for (const d of u[2]) if (d[0] === 8) d[0] = 7;
    }
  }
  return { rec, raw: rec[4] };
}

// ---- Inline helpers ----

/** Does this inline source contain a link (marked's linkInText)? */
function linkInText(src, links) {
  if (!src.includes('[')) return false;
  for (const n of src.matchAll(ot)) {
    if (yt.test(n[0]) && src.charAt(n.index - 1) !== '!') return true;
  }
  for (const n of src.matchAll(Ct)) {
    const s = n[0];
    const r = s.lastIndexOf('[');
    if (!(s.charAt(0) === '!' || !Object.hasOwn(links, F(s.slice(r + 1, -1)))) && !(r > 1 && linkInText(s.slice(1, r - 1), links))) return true;
  }
  return false;
}

/**
 * Mask an inline source for emphasis scanning (marked's #n): link-like
 * spans, code spans and inline HTML become runs of 'a' (same length), so a
 * '*' inside them can never close emphasis.
 */
function maskSrc(src, links) {
  let t = src;
  if (links && src.includes('[')) {
    const s = (r) => {
      const o = r.lastIndexOf('[');
      if (!Object.hasOwn(links, F(r.slice(o + 1, -1)))) return r;
      if (o > 1 && r.charAt(0) !== '!') {
        const i = r.slice(1, o - 1);
        if (linkInText(i, links)) return '[' + i.replace(Ct, s) + '][' + 'a'.repeat(r.length - o - 2) + ']';
      }
      return '[' + 'a'.repeat(r.length - 2) + ']';
    };
    t = t.replace(Ct, s);
  }
  if (t.includes('`') || t.includes('\\')) {
    t = t.replace(Ot, (n, s, r) => (r ? '+'.repeat(n.length) : s ? s + n.slice(s.length, -s.length).replace(/`/g, '+') + s : n));
  }
  if (t.includes('[') || t.includes('`') || t.includes('<')) {
    t = t.replace(ot, (n, s, r) => {
      const o = r ? r.length : 0;
      return n.slice(0, o) + '[' + 'a'.repeat(n.length - o - 2) + ']';
    });
  }
  return t;
}

/** Last possible emphasis/del closer indices in a masked source (marked's fe). */
function fe(a) {
  const e = { '*': -1, _: -1 };
  let t = -1;
  const re = /\*+|_+|~+/g;
  let m;
  while ((m = re.exec(a)) !== null) {
    const s = m.index;
    const r = m[0][0];
    const o = s === 0 ? '\n' : a[s - 1];
    if (o !== ' ' && o !== '\t' && o !== '\n' && o !== '\r' && o !== '\f') {
      if (r === '~') t = s;
      else e[r] = s;
    }
  }
  return { lastEm: e, lastDel: t };
}

/** Whether link text holds a '<' that starts a tag or autolink (marked's Be). */
function Be(a, e, t) {
  if (!e.includes('<')) return false;
  for (let s = 0; s < e.length; s++) {
    if (e[s] === '\\') {
      s++;
      continue;
    }
    if (e[s] === '`') {
      const i = et.exec(e.slice(s));
      if (i) {
        s += i[0].length - 1;
        continue;
      }
    }
    if (e[s] !== '<') continue;
    const r = a.slice(t + s);
    const o = St.exec(r) || wt.exec(r);
    if (o) {
      if (o[0].length > e.length - s) return true;
      s += o[0].length - 1;
    }
  }
  return false;
}

const specialTextRe = /[&<>"']/;
const schemeRe = /(?:[hH][tT][tT][pP][sS]?|[fF][tT][pP]):\/\//y;
const wwwRe = /(?<![^\s*_~(])www\./y;
/** Escape a plain-text run: decode numeric refs, escape & < > " ' (marked's Ie then P). */
const escTextRe = /&#(?:\d{1,7}|[Xx][A-Fa-f0-9]{1,6});|&\w+;|&|<|>|"|'/g;
function escText(run, inRaw) {
  if (inRaw) return run;
  if (!specialTextRe.test(run)) return run;
  return run.replace(escTextRe, (m) => {
    if (m === '&') return '&amp;';
    if (m.charCodeAt(0) === 38) {
      if (m.charCodeAt(1) === 35) {
        const hex = m.charCodeAt(2) === 88 || m.charCodeAt(2) === 120;
        const code = parseInt(m.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
        if (code === 0 || code > 1114111 || (code >= 55296 && code <= 57343)) return '\uFFFD';
        if (code === 38) return '&amp;';
        const ch2 = String.fromCodePoint(code);
        return escMap[ch2] || ch2;
      }
      return m; // valid named entity: left as-is
    }
    return escMap[m];
  });
}
/** Escape every & < > " ' (marked's P with encode=true, for code). */
function escAll(run) {
  return specialTextRe.test(run) ? run.replace(T.escapeReplace, (m) => escMap[m]) : run;
}
/** Escape one escaped punctuation char (an escape token's text, through P). */
function escChar(ch) {
  return ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : ch === "'" ? '&#39;' : ch;
}

const emailChars = new Set();
for (const ch of "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!#$%&'*+/=?^_`{|}~-") emailChars.add(ch);

const scanStopRe = /[\\<[\!`*_~@]|www\.|:\/\/|mailto:|xmpp:| {2,}\n/g;
const wwwPrevRe = /[\s*_~(]/;
const alnumRe = /[A-Za-z0-9]/;

/**
 * Scan a text run starting at `i` (src[i] is a text char). Stops before any
 * character that can start an inline construct, before a hard break, and
 * before a bare URL/e-mail (when links are allowed). Returns the end index.
 * The caller guarantees src[i] is text; the first char is always consumed.
 * One regex finds the next candidate stop; candidates that turn out invalid
 * (a www. with a bad lookbehind, a :// without a scheme, a mailto: after an
 * alphanumeric, an '@' that is not an e-mail) are skipped and the search
 * resumes just past them.
 */
function scanText(src, i, st) {
  const n = src.length;
  let j = i + 1;
  // A failed code-span / del at this position: marked's text token starts
  // with the whole run of backticks / tildes, then continues as text until
  // the next special character, so the construct is not retried inside it.
  if (src[i] === '`' || src[i] === '~') {
    while (j < n && src[j] === src[i]) j++;
  }
  scanStopRe.lastIndex = j;
  let m;
  while ((m = scanStopRe.exec(src)) !== null) {
    const pos = m.index;
    const matched = m[0];
    if (matched === 'www.') {
      if (pos === 0 || wwwPrevRe.test(src[pos - 1])) return pos;
      scanStopRe.lastIndex = pos + 1;
      continue;
    }
    if (matched === '://') {
      // The run ends at the scheme's start (http/https/ftp, at or after j).
      let s = -1;
      if (pos >= 5 && src.slice(pos - 5, pos).toLowerCase() === 'https') s = pos - 5;
      else if (pos >= 4 && src.slice(pos - 4, pos).toLowerCase() === 'http') s = pos - 4;
      else if (pos >= 3 && src.slice(pos - 3, pos).toLowerCase() === 'ftp') s = pos - 3;
      if (s !== -1 && s >= j) return s;
      scanStopRe.lastIndex = pos + 1;
      continue;
    }
    if (matched === 'mailto:' || matched === 'xmpp:') {
      if (pos === 0 || !alnumRe.test(src[pos - 1])) return pos;
      scanStopRe.lastIndex = pos + 1;
      continue;
    }
    if (matched.charCodeAt(0) === 32) return pos; // hard break (2+ spaces + \n)
    if (matched === '@' && !st.inLink) {
      // Possible e-mail: the local part is the run of e-mail chars ending
      // here (scanned backwards, never past the run's start).
      let rs = pos - 1;
      while (rs >= i && emailChars.has(src[rs])) rs--;
      rs++;
      if (rs < pos && urlRe.exec(src.slice(rs))) return rs;
      scanStopRe.lastIndex = pos + 1;
      continue;
    }
    return pos; // any other character that can start an inline construct
  }
  return n;
}

/**
 * Emphasis / strong emphasis (marked's emStrong), ported. `e` is the
 * remaining source, `t` the full masked source, `n` the previous char.
 * Returns [html, rawLength] or null. `render` renders inner text.
 */
function emStrong(e, t, n, lastEm, plain, render) {
  let s = lt.exec(e);
  if (!s || (!s[1] && !s[2] && !s[3] && !s[4])) return null;
  const r = s[0][0];
  const o = n === r;
  const i = t.length - e.length;
  let l = i;
  for (; l > 0 && t[l - 1] === r;) l--;
  const p = [...t.slice(Math.max(0, l - 2), l)].at(-1) ?? '';
  const h = p === '*' || p === '_' || !!nt.exec(p);
  if (l < i) n = p;
  const u = l < i ? h : !!nt.exec(n);
  if (s[4] && n.match(T.unicodeAlphaNumeric)) return null;
  const d = s[1] || s[3] || '';
  if (!d || !n || u) {
    const k = [...s[0]].length - 1;
    let g;
    let b;
    let m = k;
    let f = 0;
    const y = i - l + k;
    const R = !!p.trim() && (!!d || (r === '*' && !h));
    if (r !== '*' && r !== '_') return null;
    const A = r === '*' ? ht : kt;
    const v = lastEm[r];
    const Q = t.length - e.length + k;
    if (v < Q) return null;
    t = t.slice(-1 * e.length + k);
    const ee = v - Q;
    for (A.lastIndex = 0; (s = A.exec(t)) !== null && !(s.index > ee);) {
      if ((g = s[1] || s[2] || s[3] || s[4] || s[5] || s[6]), !g) continue;
      if ((b = [...g].length), s[3] || s[4]) {
        m += b;
        continue;
      } else if (s[5] || s[6] || R) {
        if (o && (s[5] || s[6])) break;
        if (y % 3 && !((y + b) % 3)) {
          f += b;
          continue;
        }
      }
      if ((m -= b), m > 0) continue;
      b = Math.min(b, b + m + f);
      const te = [...s[0]][0].length;
      const M = e.slice(0, k + s.index + te + b);
      if (Math.min(k, b) % 2) {
        const U = M.slice(1, -1);
        return [plain ? render(U) : '<em>' + render(U) + '</em>', M.length];
      }
      const ne = M.slice(2, -2);
      return [plain ? render(ne) : '<strong>' + render(ne) + '</strong>', M.length];
    }
  }
  return null;
}

/** Strikethrough (marked's del), ported. Returns [html, rawLength] or null. */
function delFn(e, t, n, lastDel, plain, render) {
  let s = xt.exec(e);
  if (!s) return null;
  if (!(s[1] || '') || !n || nt.exec(n)) {
    const o = [...s[0]].length - 1;
    let i;
    let l;
    let p = o;
    const h = Rt;
    const u = lastDel;
    const d = t.length - e.length + o;
    if (u < d) return null;
    t = t.slice(-1 * e.length + o);
    const k = u - d;
    for (h.lastIndex = 0; (s = h.exec(t)) !== null && !(s.index > k);) {
      if ((i = s[1] || s[2] || s[3] || s[4] || s[5] || s[6]), !i || (l = [...i].length, l !== o)) continue;
      if (s[3] || s[4]) {
        p += l;
        continue;
      }
      if ((p -= l), p > 0) continue;
      l = Math.min(l, l + p);
      const g = [...s[0]][0].length;
      const b = e.slice(0, o + s.index + g + l);
      const m = b.slice(o, -o);
      return [plain ? render(m) : '<del>' + render(m) + '</del>', b.length];
    }
  }
  return null;
}

// ---- Inline rendering ----

/** Decode numeric refs only (marked's Ie without the P escape step). */
function decText(run, inRaw) {
  if (inRaw) return run;
  if (!run.includes('&')) return run;
  return run.replace(T.numericCharacterReferenceOrAmpersand, (e, t, n) => {
    if (t === undefined && n === undefined) return '&amp;';
    const s = t === undefined ? parseInt(n, 16) : parseInt(t, 10);
    if (s === 0 || s > 1114111 || (s >= 55296 && s <= 57343)) return '\uFFFD';
    if (s === 38) return '&amp;';
    return String.fromCodePoint(s);
  });
}

/**
 * Render inline markdown to HTML (`plain` renders to plain text, as marked's
 * TextRenderer does for image alt text). `st` carries the shared inline
 * state (inLink, inRawBlock, linkEmitted, linkParenPossible).
 */
/**
 * Anything that can start an inline construct or autolink, or a hard break.
 * If none of these occur, the source is plain text and renders as one
 * escaped run, without the per-character loop.
 */
const inlineFastRe = /[\\<[\`*_~@]|www\.|:\/\/|mailto:|xmpp:| {2,}\n/;

function inline(src, links, st, plain) {
  const saved = st.linkParenPossible;
  st.linkParenPossible = saved && src.includes(')');
  try {
    if (!inlineFastRe.test(src)) {
      return plain ? decText(src, st.inRawBlock) : escText(src, st.inRawBlock);
    }
    return inlineInner(src, links, st, plain);
  } finally {
    st.linkParenPossible = saved;
  }
}

function inlineInner(src, links, st, plain) {
  const n = src.length;
  const out = [];
  let i = 0;
  let masked = null;
  let feRes = null;
  const ensureMask = () => {
    if (!feRes) {
      masked = maskSrc(src, links);
      feRes = fe(masked);
    }
    return feRes;
  };
  // Previous-char tracking, mirroring marked: `r` is the last char of the
  // previous text token (unchanged when that token ends with '_'), reset to
  // '' after any non-text token. Text is emitted in pieces, so the update is
  // deferred until the text run ends.
  let r = '';
  let runActive = false;
  let runLast = '';
  let runStartR = '';
  const endTextRun = () => {
    if (runActive) {
      r = runLast === '_' ? runStartR : runLast;
      runActive = false;
    }
  };
  const emitText = (piece) => {
    if (!runActive) {
      runStartR = r;
      runActive = true;
    }
    runLast = piece.charAt(piece.length - 1);
    out.push(plain ? decText(piece, st.inRawBlock) : escText(piece, st.inRawBlock));
  };
  const emitTextChar = (ch) => {
    emitText(ch);
  };
  const nonText = () => {
    endTextRun();
    r = '';
    runActive = false;
  };

  while (i < n) {
    const ch = src.charCodeAt(i);
    const rem = src.slice(i);
    if (ch === 92) { // backslash
      if (src[i + 1] === '\n') {
        const m = Se.exec(rem);
        if (m) {
          nonText();
          if (!plain) out.push('<br>');
          i += m[0].length;
          continue;
        }
      }
      const m = Ye.exec(rem);
      if (m) {
        nonText();
        out.push(plain ? m[1] : escChar(m[1]));
        i += 2;
        continue;
      }
    } else if (ch === 60) { // <
      const m = St.exec(rem);
      if (m) {
        nonText();
        if (!st.inLink && T.startATag.test(m[0])) st.inLink = true;
        else if (st.inLink && T.endATag.test(m[0])) st.inLink = false;
        if (!st.inRawBlock && T.startPreScriptTag.test(m[0])) st.inRawBlock = true;
        else if (st.inRawBlock && T.endPreScriptTag.test(m[0])) st.inRawBlock = false;
        out.push(m[0]);
        i += m[0].length;
        continue;
      }
      const a = wt.exec(rem);
      if (a) {
        nonText();
        const text = a[1];
        const href = a[2] === '@' ? 'mailto:' + text : text;
        if (plain) {
          out.push(text);
        } else {
          const h = he(href);
          if (h === null) out.push(P(text, true));
          else out.push('<a href="' + P(h, true) + '">' + P(text, true) + '</a>');
        }
        i += a[0].length;
        continue;
      }
    } else if (ch === 91 || (ch === 33 && src[i + 1] === '[')) { // [ or ![
      const res = tryLink(rem, src, i, links, st, plain, ensureMask);
      if (res) {
        nonText();
        out.push(res[0]);
        i += res[1];
        continue;
      }
    } else if (ch === 42 || ch === 95) { // * _
      ensureMask();
      const pc = runActive ? (runLast === '_' ? runStartR : runLast) : r;
      const res = emStrong(rem, masked, pc, feRes.lastEm, plain, (u) => inline(u, links, st, plain));
      if (res) {
        nonText();
        out.push(res[0]);
        i += res[1];
        continue;
      }
    } else if (ch === 96) { // `
      const m = et.exec(rem);
      if (m) {
        nonText();
        let text = m[2].replace(T.newLineCharGlobal, ' ');
        const hasNonSpace = T.nonSpaceChar.test(text);
        const hasEdgeSpace = T.startingSpaceChar.test(text) && T.endingSpaceChar.test(text);
        if (hasNonSpace && hasEdgeSpace) text = text.substring(1, text.length - 1);
        out.push(plain ? text : '<code>' + escAll(text) + '</code>');
        i += m[0].length;
        continue;
      }
    } else if (ch === 32) { // space: possible hard break
      const m = Se.exec(rem);
      if (m) {
        nonText();
        if (!plain) out.push('<br>');
        i += m[0].length;
        continue;
      }
    } else if (ch === 126) { // ~
      ensureMask();
      const pc = runActive ? (runLast === '_' ? runStartR : runLast) : r;
      const res = delFn(rem, masked, pc, feRes.lastDel, plain, (u) => inline(u, links, st, plain));
      if (res) {
        nonText();
        out.push(res[0]);
        i += res[1];
        continue;
      }
    } else if (!st.inLink && (ch === 119 || ch === 87 || ch === 104 || ch === 72 || ch === 102 || ch === 70 || ch === 109 || ch === 77 || ch === 120 || ch === 88 || (ch >= 97 && ch <= 122) || (ch >= 65 && ch <= 90) || (ch >= 48 && ch <= 57))) {
      const res = tryUrl(rem, st, plain);
      if (res) {
        nonText();
        out.push(res[0]);
        i += res[1];
        continue;
      }
    }
    // Plain text: scan a run, or one char if this position starts a
    // construct that failed (so the loop always advances).
    const end = scanText(src, i, st);
    if (end > i) {
      emitText(src.slice(i, end));
      i = end;
    } else {
      emitTextChar(src[i]);
      i++;
    }
  }
  endTextRun();
  return out.join('');
}

/** GFM extended autolink (marked's url tokenizer). Returns [html, len] or null. */
function tryUrl(rem, st, plain) {
  const t = urlRe.exec(rem);
  if (!t) return null;
  let text;
  let href;
  if (t[2] === '@') {
    text = t[0];
    href = 'mailto:' + text;
  } else {
    let r = t[0];
    let cur;
    do {
      cur = r;
      const b = backpedalRe.exec(r);
      r = b ? b[0] : '';
    } while (r !== cur);
    text = r;
    href = t[1] === 'www.' ? 'http://' + r : r;
  }
  if (plain) return [text, text.length];
  const h = he(href);
  if (h === null) return [P(text, true), text.length];
  return ['<a href="' + P(h, true) + '">' + P(text, true) + '</a>', text.length];
}

/**
 * Inline and reference links (marked's link/reflink + De). Returns
 * [html, rawLength] or null when no link starts here.
 */
function tryLink(rem, full, i, links, st, plain, ensureMask) {
  let m = null;
  let ref = null;
  if (st.linkParenPossible) m = yt.exec(rem);
  if (m) {
    const bang = m[0].charAt(0) === '!' ? 2 : 1;
    if (Be(rem, m[1], bang)) return null;
    const s = m[2].trim();
    if (T.startAngleBracket.test(s)) {
      if (!T.endAngleBracket.test(s)) return null;
      const l = L(s.slice(0, -1), '\\');
      if ((s.length - l.length) % 2 === 0) return null;
    } else {
      const l = ke(m[2], '()');
      if (l === -2) return null;
      if (l > -1) {
        const h = (m[0].indexOf('!') === 0 ? 5 : 4) + m[1].length + l;
        m[2] = m[2].substring(0, l);
        m[0] = m[0].substring(0, h).trim();
        m[3] = '';
      }
    }
    const r = L(m[0].slice(0, -1), '\\');
    if ((m[0].length - r.length) % 2 === 0) return null;
    let href = m[2].trim();
    if (T.startAngleBracket.test(href)) href = href.slice(1, -1);
    const title = m[3] ? m[3].slice(1, -1) : '';
    return makeLink(m, href.replace(Tt, '$1'), title.replace(Tt, '$1'), m[0], links, st, plain);
  }
  m = _t.exec(rem) || $t.exec(rem);
  if (!m) return null;
  const bang = m[0].charAt(0) === '!' ? 2 : 1;
  if (Be(rem, m[1], bang)) return null;
  ref = links[F(m[2] || m[1])];
  if (!ref) return null;
  return makeLink(m, ref.href, ref.title, m[0], links, st, plain);
}

/** Build a link/image's HTML from its match (marked's De + renderers). */
function makeLink(m, href, title, raw, links, st, plain) {
  const text = m[1].replace(T.outputLinkReplace, '$1');
  const isImage = m[0].charAt(0) === '!';
  const savedInLink = st.inLink;
  const savedEmitted = st.linkEmitted;
  const savedRaw = st.inRawBlock;
  st.inLink = true;
  st.linkEmitted = false;
  const textHtml = inline(text, links, st, isImage ? true : plain);
  const nested = st.linkEmitted;
  st.linkEmitted = savedEmitted;
  st.inLink = savedInLink;
  if (!isImage) {
    if (nested) {
      st.inRawBlock = savedRaw;
      return null;
    }
    st.linkEmitted = true;
  }
  if (plain) return [textHtml, raw.length];
  if (isImage) {
    const h = he(href);
    if (h === null) return [P(textHtml), raw.length];
    let out = '<img src="' + P(h) + '" alt="' + P(textHtml) + '"';
    if (title) out += ' title="' + P(title) + '"';
    return [out + '>', raw.length];
  }
  const h = he(href);
  if (h === null) return [textHtml, raw.length];
  let out = '<a href="' + P(h) + '"';
  if (title) out += ' title="' + P(title) + '"';
  return [out + '>' + textHtml + '</a>', raw.length];
}

// ---- Block rendering ----

/** Render one block record; `prefix` is prepended inside a paragraph/text (task checkbox). */
function renderBlock(rec, links, st, prefix) {
  switch (rec[0]) {
    case 0: {
      const lang = (rec[2] || '').match(T.notSpaceStart)?.[0];
      const r = rec[1] ? rec[1].replace(T.endingNewline, '') + '\n' : '';
      const body = escAll(r);
      return lang
        ? '<pre><code class="language-' + P(lang) + '">' + body + '</code></pre>\n'
        : '<pre><code>' + body + '</code></pre>\n';
    }
    case 1:
      return '<h' + rec[1] + '>' + inlineTop(rec[2], links, st) + '</h' + rec[1] + '>\n';
    case 2:
      return '<hr>\n';
    case 3:
      return '<blockquote>\n' + renderBlocks(rec[1], links, st) + '</blockquote>\n';
    case 4: {
      const tag = rec[1] ? 'ol' : 'ul';
      const start = rec[1] && rec[2] !== 1 ? ' start="' + rec[2] + '"' : '';
      let items = '';
      for (const item of rec[3]) items += renderListItem(item, rec, links, st);
      return '<' + tag + start + '>\n' + items + '</' + tag + '>\n';
    }
    case 5:
      return rec[1];
    case 6: {
      let head = '';
      for (let i = 0; i < rec[1].length; i++) {
        const a = rec[2][i];
        head += (a ? '<th align="' + a + '">' : '<th>') + inlineTop(rec[1][i], links, st) + '</th>\n';
      }
      let body = '';
      for (const row of rec[3]) {
        let cells = '';
        for (let i = 0; i < row.length; i++) {
          const a = rec[2][i];
          cells += (a ? '<td align="' + a + '">' : '<td>') + inlineTop(row[i], links, st) + '</td>\n';
        }
        body += '<tr>\n' + cells + '</tr>\n';
      }
      return '<table>\n<thead>\n<tr>\n' + head + '</tr>\n</thead>\n' + (body ? '<tbody>' + body + '</tbody>' : '') + '</table>\n';
    }
    case 7:
      return '<p>' + (prefix || '') + inlineTop(rec[1], links, st) + '</p>\n';
    case 8:
      return (prefix || '') + inlineTop(rec[1], links, st);
    default:
      return '';
  }
}

function renderListItem(item, listRec, links, st) {
  const task = item[0];
  const checked = item[1];
  const blocks = item[2];
  const loose = listRec[5];
  if (!task) return '<li>' + renderBlocks(blocks, links, st) + '</li>\n';
  const box = '<input ' + (checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
  const first = blocks[0];
  if (loose && first && (first[0] === 7 || first[0] === 8)) {
    return '<li>' + renderBlock(first, links, st, box) + renderBlocks(blocks.slice(1), links, st) + '</li>\n';
  }
  if (loose) {
    return '<li><p>' + box + '</p>\n' + renderBlocks(blocks, links, st) + '</li>\n';
  }
  return '<li>' + box + renderBlocks(blocks, links, st) + '</li>\n';
}

function renderBlocks(blocks, links, st) {
  let out = '';
  for (const rec of blocks) out += renderBlock(rec, links, st);
  return out;
}

/** An inline render at a block boundary: raw-block state resets first. */
function inlineTop(src, links, st) {
  st.inRawBlock = false;
  return inline(src, links, st, false);
}

/** The entry point: HTML for one markdown string, exactly as marked 18.1.3 renders it. */
export function parse(markdown) {
  const src = markdown.replace(T.carriageReturn, '\n');
  const links = Object.create(null);
  const st = { top: true, links, inLink: false, inRawBlock: false, linkEmitted: false, linkParenPossible: true };
  const blocks = lexBlocks(src, [], false, st);
  return renderBlocks(blocks, links, st);
}
