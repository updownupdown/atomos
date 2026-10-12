// Which puzzle builds each atom's nucleus and each atom's electrons (option A of the puzzle
// variety plan). Each step draws from its own pool: the nucleus from the hands-on "rote" games,
// the electrons from the thinking games. The choice is made once by `assignAtomGames` and
// committed to src/data/atom-games.json, so a retune never reshuffles what players see; run
// `npm run atoms:assign` after changing a pool or a weight, and the test checks the committed
// table still matches.
//
// How it spreads them: a weighted round robin. Walking the table from hydrogen up, each step
// goes to the game furthest behind its fair share (its weight over the pool's total weight, times
// the plays dealt so far). Plays a game already has elsewhere, the lasting isotopes it builds,
// count toward its share at half weight, so Tessera and Chroma, which build 72 isotopes each,
// get fewer atoms. A game never builds both parts of one atom, never builds the same part
// of two neighbors, and waits until the element it starts at. Hydrogen's electrons are always
// Quanta and helium's nucleus always Tokamak, so a new player meets the two games the tour
// explains first.
//
// Kept free of imports so the script can run it with plain Node.

export type AtomStep = 'nucleus' | 'shells';

export interface PoolGame {
  /** Catalog id. */
  id: string;
  /** How often it should come up, relative to the others in its pool: James's fun scores. */
  weight: number;
  /** The first element it may build (its easiest boards are too hard below that). */
  from?: number;
}

/**
 * The live pools. Reserve games join by moving into these lists once they are promoted; the
 * comments carry the slot each was planned for and its weight.
 *   nucleus, later: fission 7, sort 7, bond 8, planar 7, drop 6, collide 7, annihil 6, shells 6, push 7
 *   shells, later:  spin 7, solo 7, valence 7, blocks 6, emit 6, dipole 6, circuit 7, trace 6
 */
export const POOLS: Record<AtomStep, PoolGame[]> = {
  nucleus: [
    { id: 'merge', weight: 5 },
    { id: 'slideStop', weight: 5 },
    { id: 'packing', weight: 7 },
    { id: 'sliding', weight: 6, from: 27 },
  ],
  shells: [
    { id: 'orbitalGrid', weight: 6 },
    { id: 'lines', weight: 6 },
    { id: 'colorCharge', weight: 7 },
    { id: 'rutherford', weight: 4 },
  ],
};

/** Steps whose game is fixed whatever the pools say. */
export const PINNED: Record<string, string> = { '1:shells': 'orbitalGrid', '2:nucleus': 'merge' };

export type AtomGames = Record<string, { nucleus?: string; shells: string }>;

/** A small fixed hash, so ties break the same way on every run. */
function hash(z: number, id: string): number {
  let h = 2166136261 ^ z;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

/** The whole table, element 1 to `maxZ`. Hydrogen has no nucleus step. `load` is the plays each
 *  game already has outside the atom steps (lasting isotopes). */
export function assignAtomGames(load: Record<string, number> = {}, pools: Record<AtomStep, PoolGame[]> = POOLS, maxZ = 118): AtomGames {
  const out: AtomGames = {};
  const count: Record<string, number> = {};
  const dealt: Record<AtomStep, number> = { nucleus: 0, shells: 0 };
  for (let z = 1; z <= maxZ; z++) {
    const row: { nucleus?: string; shells?: string } = {};
    for (const step of ['nucleus', 'shells'] as const) {
      if (step === 'nucleus' && z === 1) continue;
      const pinned = PINNED[`${z}:${step}`];
      let pick = pinned;
      if (!pick) {
        const pool = pools[step];
        const open = pool.filter((g) => (g.from ?? 1) <= z);
        const weight = open.reduce((s, o) => s + o.weight, 0);
        // The other plays are spread over the table too, so they count in step with it: a
        // game's isotopes weigh on its share a little at hydrogen and in full at oganesson.
        const k = (dealt[step] + 1) / (step === 'nucleus' ? maxZ - 1 : maxZ);
        const before = open.reduce((s, o) => s + (load[o.id] ?? 0), 0) * k;
        const fair = (g: PoolGame) => (g.weight / weight) * (dealt[step] + 1 + before) - (count[g.id] ?? 0) - (load[g.id] ?? 0) * k;
        const prev = out[z - 1]?.[step];
        const other = step === 'shells' ? row.nucleus : undefined;
        let ok = open.filter((g) => g.id !== prev && g.id !== other);
        if (!ok.length) ok = open.filter((g) => g.id !== other);
        if (!ok.length) ok = open;
        ok.sort((a, b) => fair(b) - fair(a) || hash(z, a.id) - hash(z, b.id));
        pick = ok[0].id;
      }
      row[step] = pick;
      count[pick] = (count[pick] ?? 0) + 1;
      dealt[step]++;
    }
    out[z] = row as { nucleus?: string; shells: string };
  }
  return out;
}

/** Plays per game in a committed isotope table ({"z-a": game}), each counted as `share` of a
 *  play: isotopes come after their atom and only for players going for 100%, so they weigh less
 *  than the steps every player takes. */
export function loadOf(isotopes: Record<string, string>, share = 1): Record<string, number> {
  const n: Record<string, number> = {};
  for (const g of Object.values(isotopes)) n[g] = (n[g] ?? 0) + share;
  return n;
}

/** How many steps each game builds in a table. */
export function tally(t: AtomGames): Record<string, number> {
  const n: Record<string, number> = {};
  for (const row of Object.values(t)) for (const g of [row.nucleus, row.shells]) if (g) n[g] = (n[g] ?? 0) + 1;
  return n;
}
