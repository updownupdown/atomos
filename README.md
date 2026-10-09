# Atomos

A game about building atoms and completing the periodic table, for the web and Android (iOS later).

This repository holds the **prototype**: hydrogen to neon. Each atom is unlocked by solving puzzles, one for its nucleus and one for its electron shells, with the finished atom rendered as a real probability cloud.

## Run it

```sh
npm install
npm run dev          # http://localhost:5173, also reachable from a phone on the same network
npm test             # core rules and data checks
npm run typecheck
npm run build        # dist/, the bundle Capacitor will wrap for Android
npm run build:single # dist-single/index.html, one self-contained file for sharing previews
```

## Deployment

Every push to `main` builds the app and publishes it to GitHub Pages at https://updownupdown.github.io/atomos/ (`.github/workflows/pages.yml`). Pull requests run the typecheck, tests and build without deploying. Pages must be set to deploy from GitHub Actions in the repository settings.

## What is in the prototype

- **Two puzzles per element.** Building atoms directly by touch was tried in earlier versions (launch styles called Charge, Pulse and Tune) and abandoned; atoms are now earned by solving puzzles, following the plan in the project's Progression Map.
  - **Merge** (`src/puzzles/merge.ts`): a 4×4 board of light nuclei. Swipe to slide everything; two nuclei fuse when at least one is light (mass 4 or under) and their sum is a real nuclide. Make the element's most common nucleus. Fusing past it spoils the tile, which crumbles on the next swipe. Hydrogen skips this puzzle: a lone proton has nothing to fuse. Past iron the plan swaps Merge for a sliding-block puzzle, not built yet.
  - **Shell Rings** (`src/puzzles/rings.ts`): one ring per shell with 2n² slots, plus a spare ring outside. Sockets mark where the element's electrons belong, coloured by sub-shell (s blue, p green, d amber, f violet). Drag round a ring to turn it; an electron at the gate on top can hop to the ring inside (tap) or outside (drag out). Levels are the solved atom scrambled by a seeded generator, and par is the cost of the plan a careful player would follow (`solveGreedy`).
  - Both puzzles have unlimited undo and a restart, no timers, and keyboard controls. **Flawless** means no spoiled fusion and the shells settled at or under par.
- **Why?** opens a short note on the science behind the current puzzle; it is never required reading.
- **Testing aid.** Settings has an "Unlock every element" switch that makes any of the ten elements buildable from the map.
- **Spiral map** of all 118 elements, with the next one glowing and a riddle hint.
- **Element cards** with facts, signature spectral lines, completion tiers, and a paint palette.
- **Isotopes in real time.** Stable isotopes join the collection for good. Unstable ones get a randomly sampled real lifetime (the half-life is the median) and decay while you are away. Isotopes that live under a second are **witnessed**: you watch the decay as bubble-chamber tracks, slowed down by a stated factor when needed, and the record is kept. Isotope puzzles come next.
- **Accessibility.** No reflex timing anywhere. Keyboard: arrows swipe the Merge board; 1, 2, 3 pick a ring, left and right turn it, space hops at the gate; U undoes, R restarts. Reduced motion, sound and vibration toggles.
- **Installable.** The build is a progressive web app (`vite-plugin-pwa`): add it to a phone's home screen from the browser menu and it opens full screen and works offline. Each new deploy is picked up on the next launch.

## Accuracy

- Orbital clouds are point samples of the exact hydrogen-like probability densities, scaled per atom with Slater's rules.
- Merge fuses only to real nuclides (the isotope table in `src/core/isotopes.ts`); beryllium-8 cracks because the real one splits back into two alphas. Nuclei sliding about and fusing at a swipe is a game rule.
- Shell Rings uses the true shell capacities (2n²), sub-shell sizes and Madelung filling order; beads, sockets and the gate are a game rule.
- Element and isotope data in `src/core` were transcribed by hand and must be replaced by generated datasets (NIST, IAEA) before release.
- The nucleus is drawn about 10,000 times too large; at true scale it would be invisible.

## Layout

```
src/core/      rules and data with no rendering: physics.ts, elements.ts, isotopes.ts, save.ts
src/puzzles/   puzzle rules and generators (merge.ts, rings.ts, levels.ts) and their canvas views
src/render/    Three.js scene, orbital sampling, light colours
src/ui/        spiral map, witness (bubble chamber) renderer
src/main.ts    game controller and screens
tests/         vitest suites for the core and the puzzles
```

The stack follows the agreed concept: TypeScript and Three.js now, Capacitor for Android and iOS, React when the menus grow, native watch companions later.
