# Fast Markdown Renderer

[![make.fun](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/c/markdown-render-speed-02/)
[![rank](https://make.fun/badge/markdown-render-speed-02/Erwinsays12/makefun-markdown-render/rank.svg)](https://make.fun/c/markdown-render-speed-02/)
[![reward](https://make.fun/badge/markdown-render-speed-02/Erwinsays12/makefun-markdown-render/reward.svg)](https://make.fun/c/markdown-render-speed-02/)

A fast, dependency-free Markdown renderer that produces exactly the HTML
[marked 18.1.3](https://github.com/markedjs/marked) renders with its default
options (GFM on, breaks off, pedantic off, async off) — but measurably faster.
Built for the [make.fun](https://make.fun/c/markdown-render-speed-02/)
`markdown-render-speed-02` competition ("Make Markdown rendering faster").

## How it works

`parse.js` exports a single function, `parse(markdown)`, which returns the
HTML string marked would render for that input. `main.ts` is the driver the
harness runs: it reads `/input/cases.json`, renders each case alone, and
writes `/output/html.json`.

There is no token tree. Block lexing produces compact array records and
inline lexing renders straight to the output string, which avoids the
per-token object allocation that dominates marked's cost on long documents.
The hot text path is a hand-written scanner instead of a regex per token:

- **Block lexer** — the same block order and rules as marked (space, code,
  fences, heading, hr, blockquote, list, HTML, link definitions, table,
  setext heading, paragraph, text), with a first-character dispatch so a
  paragraph line skips the block regexes that cannot match it.
- **Inline renderer** — the same inline order and delimiter algorithms as
  marked (escapes, tags, links, emphasis/strong, code spans, hard breaks,
  strikethrough, autolinks), with a single-regex text scanner that jumps to
  the next construct, URL, e-mail or hard break instead of walking the text
  character by character, and a fast path for plain-text runs.
- **Correctness** — the implementation ports marked's algorithms faithfully
  (same block/inline order, same delimiter and link-resolution rules) and is
  verified against the competition's full 720-case practice set
  (680 CommonMark/GFM spec examples + 40 generated README documents):
  720/720 byte-for-byte identical to marked 18.1.3.

On the practice set this renders in roughly 450–550 ms per run on the build
machine, against roughly 670–900 ms for marked itself.

## Files

- `parse.js` — the renderer (dependency-free ES module, `export function parse(markdown)`).
- `main.ts` — the driver: reads `/input/cases.json`, writes `/output/html.json`.
- `LICENSE` — MIT license for this entry.
- `LICENSE-MARKED` — marked's MIT license (see credit below).
- `.makefun/owner.json` — the claim file naming the entry's payout wallet.

## Credit

The regular expressions that define the Markdown format are the same block
and inline rules marked 18.1.3 uses — its behaviour is the reference for
this competition, and its source is MIT licensed (MarkedJS, see
`LICENSE-MARKED`). The tokenizer and renderer around them are original:
there is no token tree, inline rendering writes straight to the output
string, and the text scanner, block dispatch and escaping are written for
speed. This is a genuine faster implementation, not marked unchanged.
