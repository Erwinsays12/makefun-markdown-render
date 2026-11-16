[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/Erwinsays12/makefun-markdown-render/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/Erwinsays12/makefun-markdown-render/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

Built for the [markdown-render-speed-02 bounty on make.fun](https://make.fun/bounty/markdown-render-speed-02).

# Fast Markdown renderer

A dependency-free, from-scratch Markdown renderer that returns exactly the
HTML marked 18.1.3 returns with its default options, but faster.

- `parse.js` — the block parser and the `parse(markdown)` entry point.
- `inline.js` — the inline parser (emphasis, links, code spans, autolinks).
- `entities.js` — HTML entity decoding.
- `main.ts` — the driver: reads `/input/cases.json`, writes `/output/html.json`.

Direct rendering, no token objects, no caching across calls.
