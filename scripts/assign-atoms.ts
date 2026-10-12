// Writes src/data/atom-games.json from the pools in src/core/assign.ts. Run with
// `npm run atoms:assign` after changing a pool or a weight; it prints the plays each game gets,
// atoms and lasting isotopes together.
import { writeFileSync } from 'node:fs';
import ISOTOPES from '../src/data/isotope-games.json' with { type: 'json' };
import { assignAtomGames, loadOf, tally } from '../src/core/assign.ts';

const load = loadOf(ISOTOPES, 0.5);
const table = assignAtomGames(load);
const rows = Object.entries(table).map(([z, r]) => `  "${z}": ${JSON.stringify(r)}`);
writeFileSync(new URL('../src/data/atom-games.json', import.meta.url), `{\n${rows.join(',\n')}\n}\n`);
const atoms = tally(table);
for (const g of Object.keys({ ...atoms, ...load }).sort()) console.log(g.padEnd(12), 'atoms', String(atoms[g] ?? 0).padStart(3), ' isotopes', String(2 * (load[g] ?? 0)).padStart(3), ' total', (atoms[g] ?? 0) + 2 * (load[g] ?? 0));
