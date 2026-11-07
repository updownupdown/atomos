# Atomos

**A puzzle game about building atoms and completing the periodic table, one element at a time.**

▶ **Play it at [buildatomos.app](https://buildatomos.app)** — runs in any browser, and can be added to your phone's home screen to play full screen and offline.

Each element is earned by solving puzzles inspired by real physics: fuse light nuclei into the right isotope, fill electron shells in the order nature does, and more. Finished atoms join a gallery of all 118 elements that you can browse as a spiral, the standard table and other arrangements, and each one opens as a live 3D atom drawn as a true quantum probability cloud, alongside its facts, structure, isotopes and discovery story. Unstable isotopes you collect decay in real time while you're away. Nu, a small neutrino, is your guide, with a daily game and daily questions.

The science is taken seriously: orbital clouds are sampled from the real hydrogen-like wave functions, puzzles only make nuclides that actually exist, and shells follow their true capacities and filling order. There are no reflex-timing challenges, and everything is keyboard-playable with reduced-motion, sound and vibration options.

## Built with

TypeScript, Vite and Three.js, packaged as a progressive web app, with Vitest suites for the rules and puzzle generators. The element dataset is generated from scientific sources by Python scripts in `scripts/`. Every push to `main` deploys to GitHub Pages.

There's also a standalone companion app for Wear OS watches: [atomos-watch](https://github.com/updownupdown/atomos-watch).

## Running locally

```sh
npm install
npm run dev      # http://localhost:5173, also reachable from a phone on the same network
npm test
npm run build
```

Architecture and design notes are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
