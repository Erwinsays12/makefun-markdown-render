// Entity handling, matching marked 18.1.3 exactly (verified against the
// practice set's expected outputs):
// - A named reference &name; (letter first, then alphanumerics) is kept
//   literally in the output, whether or not the name is a known entity.
// - A numeric reference &#123; (1-7 decimal digits) or &#x1F600; (1-6 hex
//   digits) decodes to the character; 0, surrogates and > 0x10FFFF become
//   U+FFFD. Longer digit runs are not references at all.
// - Anything else starting with & is plain text: the & is escaped.
export function decodeEntity(s, i) {
  const n = s.length;
  if (i + 1 >= n) return null;
  if (s[i + 1] === '#') {
    let j = i + 2, hex = false, num = 0, digits = 0;
    if (j < n && (s[j] === 'x' || s[j] === 'X')) { hex = true; j++; }
    const limit = hex ? 6 : 7;
    while (j < n && digits < limit) {
      const c = s.charCodeAt(j);
      if (hex ? (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70)
              : (c >= 48 && c <= 57)) {
        num = num * (hex ? 16 : 10) + (c <= 57 ? c - 48 : (c | 32) - 87);
        digits++; j++;
      } else break;
    }
    if (digits === 0 || j >= n || s[j] !== ';') return null;
    if (num === 0 || num > 0x10FFFF || (num >= 0xD800 && num <= 0xDFFF)) return ['\uFFFD', j + 1];
    return [String.fromCodePoint(num), j + 1];
  }
  const c0 = s.charCodeAt(i + 1);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return null;
  let j = i + 2;
  while (j < n) {
    const c = s.charCodeAt(j);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) j++;
    else break;
  }
  if (j >= n || s[j] !== ';') return null;
  return [s.slice(i, j + 1), j + 1];
}

// Escape text for HTML output: & < > " ' (marked escapes all five in text).
const ESC_RE = /[&<>"']/g;
export function escapeText(s) {
  if (!ESC_RE.test(s)) return s;
  ESC_RE.lastIndex = 0;
  return s.replace(ESC_RE, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;');
}

// Escape for href/title attributes: & is escaped only when it does NOT start
// a valid entity reference (marked preserves entities in URLs and titles).
const ESC_ATTR_RE = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
export function escapeAttr(s) {
  return s.replace(ESC_ATTR_RE, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : c === "'" ? '&#39;' : '&amp;');
}

// marked's cleanUrl: percent-encode the URL, keep literal % intact.
export function cleanUrl(href) {
  if (typeof href !== 'string') return null;
  let prot;
  try {
    prot = decodeURIComponent(href.replace(/%20/g, ' ')).replace(/[^A-Za-z0-9/:]/g, '').toLowerCase();
  } catch (e) { prot = ''; }
  if (prot.startsWith('javascript:') || prot.startsWith('vbscript:') || prot.startsWith('data:')) return null;
  try { return encodeURI(href).replace(/%25/g, '%'); } catch (e) { return null; }
}
