// Where each of the 118 atoms sits in the gallery, for each arrangement.
// Positions are in scene units with roughly one unit between neighbours; the
// camera fits whatever the layout spans. Helix is the only one that uses depth.

import { ELEMENTS, type Element } from './data';

export type LayoutId = 'spiral' | 'table' | 'leftstep' | 'helix' | 'timeline';
export const LAYOUTS: { id: LayoutId; label: string; note: string }[] = [
  { id: 'spiral', label: 'Spiral', note: 'One turn per period; the noble gases close each turn' },
  { id: 'table', label: 'Table', note: 'The standard table, lanthanides and actinides below' },
  { id: 'leftstep', label: 'Left step', note: "Janet's table: rows end where a shell's s orbital fills" },
  { id: 'helix', label: 'Helix', note: "De Chancourtois's screw: drag sideways to turn it" },
  { id: 'timeline', label: 'Timeline', note: 'By year of discovery, the ancient metals first' },
];

export interface Placed {
  z: number;
  x: number;
  y: number;
  zz: number;
}

export interface Marker {
  x: number;
  y: number;
  zz: number;
  text: string;
}

export interface Layout {
  id: LayoutId;
  atoms: Placed[];
  /** Captions placed in the scene, such as years on the timeline. */
  markers: Marker[];
  /** Whether sideways drags turn the layout instead of panning it. */
  rotates: boolean;
}

const PERIOD_RANGE: [number, number][] = [[1, 2], [3, 10], [11, 18], [19, 36], [37, 54], [55, 86], [87, 118]];

function spiral(): Layout {
  const radii = [0.6, 1.7, 2.8, 3.9, 5.15, 6.35, 7.65, 8.9];
  const atoms = ELEMENTS.map((e) => {
    const pi = e.period - 1;
    const [a, b] = PERIOD_RANGE[pi];
    const t = (e.z - a + 0.5) / (b - a + 1);
    const r = radii[pi] + (radii[pi + 1] - radii[pi]) * t;
    const th = Math.PI / 2 - t * Math.PI * 2;
    return { z: e.z, x: Math.cos(th) * r, y: Math.sin(th) * r, zz: 0 };
  });
  return { id: 'spiral', atoms, markers: [], rotates: false };
}

function tableCell(e: Element): { col: number; row: number } {
  if (e.z >= 57 && e.z <= 71) return { col: 2 + (e.z - 57), row: 8.5 };
  if (e.z >= 89 && e.z <= 103) return { col: 2 + (e.z - 89), row: 9.5 };
  return { col: (e.group ?? 3) - 1, row: e.period - 1 };
}

function table(): Layout {
  const atoms = ELEMENTS.map((e) => {
    const { col, row } = tableCell(e);
    return { z: e.z, x: (col - 8.5) * 1.05, y: -(row - 4.75) * 1.3, zz: 0 };
  });
  return { id: 'table', atoms, markers: [], rotates: false };
}

/** Janet's left-step table: 32 columns, f d p then s, rows ending at each s2. */
function leftStep(): Layout {
  // Janet's blocks by atomic number: lanthanum and actinium open the f rows, lutetium and lawrencium the d rows.
  const runs: { block: 'f' | 'd' | 'p' | 's'; from: number; to: number }[] = [
    { block: 'f', from: 57, to: 70 }, { block: 'f', from: 89, to: 102 },
    { block: 'd', from: 21, to: 30 }, { block: 'd', from: 39, to: 48 }, { block: 'd', from: 71, to: 80 }, { block: 'd', from: 103, to: 112 },
    { block: 'p', from: 5, to: 10 }, { block: 'p', from: 13, to: 18 }, { block: 'p', from: 31, to: 36 },
    { block: 'p', from: 49, to: 54 }, { block: 'p', from: 81, to: 86 }, { block: 'p', from: 113, to: 118 },
  ];
  const blockStart = { f: 0, d: 14, p: 24, s: 30 };
  const atoms = ELEMENTS.map((e) => {
    const run = runs.find((r) => e.z >= r.from && e.z <= r.to);
    const block = run ? run.block : 's';
    // s elements sit in the last two columns; period 1 is H then He.
    const col = run ? blockStart[run.block] + (e.z - run.from) : blockStart.s + ((e.z + 1) % 2);
    // The s block closes each row, so the s elements of period p sit in row p and everything else in row p + 1.
    const row = block === 's' ? e.period : e.period + 1;
    return { z: e.z, x: (col - 15.5) * 1.05, y: -(row - 4.5) * 1.3, zz: 0 };
  });
  return { id: 'leftstep', atoms, markers: [], rotates: false };
}

/** A screw: each period one turn, Z climbing down the axis. */
function helix(): Layout {
  const R = 3.2;
  const atoms = ELEMENTS.map((e) => {
    const [a, b] = PERIOD_RANGE[e.period - 1];
    const t = (e.z - a + 0.5) / (b - a + 1);
    const th = -t * Math.PI * 2 + Math.PI / 2;
    return { z: e.z, x: Math.cos(th) * R, y: 9 - (e.z - 1) * 0.155, zz: Math.sin(th) * R };
  });
  return { id: 'helix', atoms, markers: [], rotates: true };
}

/** Discovery timeline: ancient elements on the left, then a linear axis from 1650. */
function timeline(): Layout {
  const xOf = (year: number | null) => (year == null || year < 1650 ? -1.3 : ((year - 1650) / 380) * 14);
  const buckets = new Map<number, Element[]>();
  for (const e of ELEMENTS) {
    const bx = Math.round(xOf(e.discoveryYear) / 0.75);
    if (!buckets.has(bx)) buckets.set(bx, []);
    buckets.get(bx)!.push(e);
  }
  const atoms: Placed[] = [];
  for (const [bx, list] of buckets) {
    list.sort((a, b) => a.z - b.z);
    list.forEach((e, i) => atoms.push({ z: e.z, x: bx * 0.75 - 6.5, y: i * 0.95 - ((list.length - 1) * 0.95) / 2, zz: 0 }));
  }
  atoms.sort((a, b) => a.z - b.z);
  const tallest = Math.max(...[...buckets.values()].map((l) => l.length));
  const base = -((tallest - 1) * 0.95) / 2 - 1.1;
  const markers: Marker[] = [{ x: -1.3 - 6.5, y: base, zz: 0, text: 'ancient' }];
  for (let y = 1700; y <= 2000; y += 50) markers.push({ x: xOf(y) - 6.5, y: base, zz: 0, text: String(y) });
  return { id: 'timeline', atoms, markers, rotates: false };
}

const builders: Record<LayoutId, () => Layout> = { spiral, table, leftstep: leftStep, helix, timeline };
const cache = new Map<LayoutId, Layout>();

export function layout(id: LayoutId): Layout {
  let l = cache.get(id);
  if (!l) {
    l = builders[id]();
    cache.set(id, l);
  }
  return l;
}
