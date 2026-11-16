# Fast Markdown renderer

A dependency-free, from-scratch Markdown renderer that returns exactly the
HTML marked 18.1.3 returns with its default options, but faster.

- `parse.js` — the block parser and the `parse(markdown)` entry point.
- `inline.js` — the inline parser (emphasis, links, code spans, autolinks).
- `entities.js` — HTML entity decoding.
- `main.ts` — the driver: reads `/input/cases.json`, writes `/output/html.json`.

Direct rendering, no token objects, no caching across calls.
