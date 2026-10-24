# Contributing to Aven

Thanks for looking. Aven is small on purpose: static files, plain ES modules, no build step, no backend. Changes
that keep it that way are the easiest to take.

## Reporting

- **A number that doesn't match its source** (a mark, a funding rate, a pool price, a liquidation that should or
  shouldn't have happened): use the *Data mismatch* issue template and include the market, the time with its time
  zone, what Aven showed and what the source showed. These are the most valuable reports.
- **Bugs**: the *Bug report* template. Browser, device and the steps help most.
- **Ideas**: the *Feature request* template. Say what question a trader is trying to answer.

## Working on it

```bash
npm run dev      # http://localhost:8792
npm test         # node --test test/*.test.mjs
```

Before opening a pull request:

1. `npm test` passes, and new engine rules come with a test in `test/engine.test.mjs`.
2. Every number on screen comes from a source listed in [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md), or from the
   engine. Nothing invented, nothing hard-coded to look nice. If something is simulated, say so in that file.
3. Nothing on screen shows a bare `0`, `0.00`, `$0` or a dash placeholder: loading values stay empty (the CSS
   shimmer covers them), real zeros become words. `node dev/zeros.mjs` checks it.
4. Nothing sticks out past the edge at 360 px: `node dev/overflow.mjs out/`.
5. Black and white only. Long is solid white, short is hatched or outlined.

## Style

Two-space indentation, single quotes, semicolons, ES modules. Comments say *why*, at the top of a module or above a
non-obvious rule; the code says what. Keep functions pure where the engine is concerned: `engine.js` must stay
usable from Node with no DOM.

## Licence

By contributing you agree that your work is released under the [MIT license](LICENSE).
