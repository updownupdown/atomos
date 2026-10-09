# Atomos

A game about building atoms and completing the periodic table, for the web and Android (iOS later).

This repository holds the **feel prototype**: hydrogen to neon, built to answer one question before anything else is built on it: does launching electrons feel good on a phone?

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

- **Three launch styles**, switchable at the bottom of the screen, all under evaluation:
  - **Charge** (`src/core/tuning.ts`): press and hold anywhere and the electron climbs the energy ladder beside the atom; let go while a rung is lit. Rungs higher up have narrower bands. Hold on past the top and the electron breaks free, knocking one out of the atom. A flick up or down as you let go sets spin. Climb speed is a setting.
  - **Pulse** (`src/core/pulse.ts`): a beat runs continuously. Tap n beats in a row, in time, and the electron goes to level n; the first silent beat ends the phrase. A tap off the beat loses the electron. Swipe up or down on a tap for spin. Tempo is a setting.
  - **Tune** (`src/core/dial.ts`): drag round the atom to turn a dial of energy from zero to the ionisation limit. The atom's allowed levels are marks on the dial at their true spacing, crowding toward the top; the cloud glows and hums as the needle nears one. Tap the atom to fire at the dial's setting. A finger further from the centre turns the dial more finely.
  The atom only catches an electron whose energy sits in a band around an allowed level (n). Higher bands cascade through more levels and release more light. Off a band the electron passes through and is lost; past the top it knocks an electron out.
- **Three goals per element.** Build it; build it flawlessly (ground state, no electron lost, no undo); and find every line it can release, shown as gaps in the spectrum strip.
- **Aim the lobe.** For 2p electrons, where you hold or tap relative to the nucleus picks the x, y or z lobe (guides appear). Pairing early or misaligning spins is allowed but sounds sour and costs the perfect ground-state badge (Hund's rule).
- **Testing aid.** Settings has an "Unlock every element" switch that makes any element buildable from the map, with the p orbital already discovered, so later atoms can be tried without earning them.
- **Slice the Wave.** Boron's fifth electron needs a shape you have never made. Swipe through the nucleus to cut the spherical cloud into the first p orbital.
- **Core auto-fill.** After helium is built, heavier atoms start with its 1s shell.
- **Spiral map** of all 118 elements, with the next one glowing and a riddle hint.
- **Element cards** with facts, signature spectral lines, completion tiers, and a paint palette made from the visible light you have released.
- **Isotopes in real time.** Stable isotopes join the collection for good. Unstable ones get a randomly sampled real lifetime (the half-life is the median) and decay while you are away. Isotopes that live under a second are **witnessed**: you watch the decay as bubble-chamber tracks, slowed down by a stated factor when needed, and the record is kept.
- **Accessibility.** Assisted controls replace every gesture with buttons and keys (Space to launch, arrows for energy, x/y/z for lobes, U to undo); assisted energy never reaches the knock-out zone. Without assist, Space holds a charge, taps a beat, or fires the dial, and left/right arrows turn the dial. Reduced motion, sound and vibration toggles.
- **Installable.** The build is a progressive web app (`vite-plugin-pwa`): add it to a phone's home screen from the browser menu and it opens full screen and works offline. Each new deploy is picked up on the next launch.

## Accuracy

- Orbital clouds are point samples of the exact hydrogen-like probability densities, scaled per atom with Slater's rules.
- The last step of every cascade releases the real ionisation energy of the ion being formed (NIST values). Higher levels use the Rydberg formula for the ion's charge, exact for one-electron systems (hydrogen shows its true Lyman and Balmer lines) and approximate otherwise. Sub-shell splitting in the cascade is not modelled yet.
- Element and isotope data in `src/core` were transcribed by hand and must be replaced by generated datasets (NIST, IAEA) before release.
- The nucleus is drawn about 10,000 times too large; at true scale it would be invisible.

## Layout

```
src/core/      rules and data with no rendering: physics.ts, elements.ts, isotopes.ts, save.ts
src/render/    Three.js scene, orbital sampling, light colours
src/ui/        spiral map, witness (bubble chamber) renderer
src/main.ts    game controller and screens
tests/         vitest suites for the core
```

The stack follows the agreed concept: TypeScript and Three.js now, Capacitor for Android and iOS, React when the menus grow, native watch companions later.
