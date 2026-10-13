// The Atlas maps: where each of the 118 atoms sits in each arrangement, drawn as one continuous
// shape (cells that touch, like a mosaic or a ribbon) instead of a scatter of tiles. Each cell is
// an SVG path in map units, with the box its label may use; the map (atlasmap.ts) scales the
// whole shape to the screen and shows symbols, numbers and names as the cells grow.
//
// The Table stands up on a portrait screen (periods across, groups down) so every symbol is
// readable without pinching, and lies flat in landscape. The Ribbon follows J. F. Hyde's curled
// ribbon of 1975: the groups run round one loop, the periods go from the inside out, and the f
// block curls out as a loop of its own.

import { ELEMENTS, elementAt, type Element } from './data';

export type LayoutId = 'table' | 'ribbon' | 'spiral' | 'circle';
export const LAYOUTS: { id: LayoutId; label: string; note: string }[] = [
  { id: 'table', label: 'Table', note: 'Periods and groups, with the f block beside them' },
  { id: 'ribbon', label: 'Ribbon', note: "Hyde's curled ribbon: groups run round the loop, periods from the inside out" },
  { id: 'spiral', label: 'Spiral', note: 'One turn per period; each turn ends with a noble gas' },
  { id: 'circle', label: 'Circle', note: 'One ring per period, groups along the spokes' },
];
/** The longer story of each arrangement, behind the microscope on the Atlas. */
export const LAYOUT_STORY: Record<LayoutId, string[]> = {
  table: [
    'The standard periodic table. Each period is one row of the usual table; each group gathers elements with the same arrangement of outer electrons, which is why they behave alike.',
    'On a phone held upright the table stands on its side: periods run across and groups run down, so every symbol is large enough to read. Turn the phone sideways and it lies flat again.',
    'The f block (cerium to lutetium, thorium to lawrencium) belongs between groups 3 and 4 of periods 6 and 7; it sits beside the table only to keep it compact.',
  ],
  ribbon: [
    "After J. F. Hyde's chart of 1975. The groups run round one continuous ribbon instead of breaking into rows, so the end of each period flows straight into the next.",
    'Across the ribbon, periods go from the inside out. The band is narrower where the d block runs, because the d block only starts in period 4. Hydrogen and helium curl up in the middle.',
    'The f block rises from the ribbon as a loop of its own, cerium to lutetium inside and thorium to lawrencium outside, between groups 3 and 4 where it belongs.',
  ],
  spiral: [
    'Each turn of the spiral is one period: a row of the periodic table. A new turn starts when electrons begin filling a new shell, with an alkali metal.',
    'Every turn ends with a noble gas, whose outer shell is full, so the noble gases line up along the seam at the top.',
    'Later turns hold more elements because the d and f orbitals open up, which is why the spiral widens as it grows.',
  ],
  circle: [
    'One ring per period, from hydrogen and helium in the middle outward. Each spoke is a group, so elements that behave alike line up from the center out.',
    'The s and p groups take wider spokes than the d groups. Periods 2 and 3 have no d block, so their rings stay open on that side.',
    'The f block hangs below as two arcs: cerium to lutetium on the inner one, thorium to lawrencium on the outer.',
  ],
};
export const isLayoutId = (id: string | null): id is LayoutId => LAYOUTS.some((l) => l.id === id);

export interface Cell {
  z: number;
  /** The cell's outline, in map units. */
  d: string;
  /** Where its label sits, and the box the label may fill. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapLabel {
  x: number;
  y: number;
  text: string;
  /** 'axis': a period or group number; 'title': a caption such as "f block". */
  kind: 'axis' | 'title';
}

export interface Layout {
  id: LayoutId;
  cells: Cell[];
  labels: MapLabel[];
}

export type Orientation = 'portrait' | 'landscape';

/** The 28 elements of the f block drawn apart from the groups: cerium to lutetium, thorium to
 *  lawrencium. Lanthanum and actinium stay in group 3, as the dataset has them. */
export const isF = (e: Element): boolean => e.group === null;
const fIndex = (e: Element) => (e.period === 6 ? e.z - 58 : e.z - 90);

const f1 = (v: number) => (Math.round(v * 100) / 100).toString();
function poly(pts: [number, number][]): string {
  return 'M' + pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join('L') + 'Z';
}
function rect(x: number, y: number, w: number, h: number, r: number): string {
  return `M${f1(x + r)} ${f1(y)}H${f1(x + w - r)}Q${f1(x + w)} ${f1(y)} ${f1(x + w)} ${f1(y + r)}V${f1(y + h - r)}Q${f1(x + w)} ${f1(y + h)} ${f1(x + w - r)} ${f1(y + h)}H${f1(x + r)}Q${f1(x)} ${f1(y + h)} ${f1(x)} ${f1(y + h - r)}V${f1(y + r)}Q${f1(x)} ${f1(y)} ${f1(x + r)} ${f1(y)}Z`;
}

/** A band cell between two radii and two angles round a center (or along any curve given by
 *  `at(t, r)`), as a polygon fine enough to look smooth. */
function band(at: (t: number, r: number) => [number, number], t0: number, t1: number, r0: number, r1: number, steps = 8): string {
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) pts.push(at(t0 + ((t1 - t0) * i) / steps, r0));
  for (let i = steps; i >= 0; i--) pts.push(at(t0 + ((t1 - t0) * i) / steps, r1));
  return poly(pts);
}

// ---------------------------------------------------------------------------
// Table. Cells touch with a small seam, like a mosaic.

const SEAM = 0.06;

function table(o: Orientation): Layout {
  const stand = o === 'portrait';
  // Standing, a cell is wider than tall so names fit when zoomed; flat, a little taller than wide.
  const cw = stand ? 1.45 : 1, ch = stand ? 1 : 1.15;
  const cells: Cell[] = [];
  const labels: MapLabel[] = [];
  const place = (e: Element, col: number, row: number) => {
    const x = col * cw, y = row * ch;
    cells.push({ z: e.z, d: rect(x + SEAM / 2, y + SEAM / 2, cw - SEAM, ch - SEAM, 0.14), x: x + cw / 2, y: y + ch / 2, w: cw - SEAM, h: ch - SEAM });
  };
  for (const e of ELEMENTS) {
    if (isF(e)) {
      const i = fIndex(e), k = e.period === 6 ? 0 : 1;
      // Beside the table: two more columns standing, two more rows flat, starting level with group 4.
      if (stand) place(e, 7.3 + k, 3 + i); else place(e, 3 + i, 7.3 + k);
    } else if (stand) place(e, e.period - 1, e.group! - 1);
    else place(e, e.group! - 1, e.period - 1);
  }
  const axis = (x: number, y: number, text: string, kind: MapLabel['kind'] = 'axis') => labels.push({ x, y, text, kind });
  if (stand) {
    for (let p = 1; p <= 7; p++) axis((p - 0.5) * cw, -0.45, String(p));
    axis(7.8 * cw, 2.55 * ch, '4f');
    axis(8.8 * cw, 2.55 * ch, '5f');
    for (let g = 1; g <= 18; g++) axis(-0.45, (g - 0.5) * ch, String(g));
  } else {
    const topRow = (g: number) => (g === 1 || g === 18 ? 0 : g === 2 || g >= 13 ? 1 : 3);
    for (let g = 1; g <= 18; g++) axis((g - 0.5) * cw, topRow(g) * ch - 0.4, String(g));
    for (let p = 1; p <= 7; p++) axis(-0.45, (p - 0.5) * ch, String(p));
    axis(2.55 * cw, 7.8 * ch, '4f');
    axis(2.55 * cw, 8.8 * ch, '5f');
  }
  return { id: 'table', cells, labels };
}

// ---------------------------------------------------------------------------
// Ribbon. A peanut-shaped loop: R(θ) = a(1 + k cos 2θ) is the inner edge, and each period from
// 2 to 7 is one band further out. Groups run anticlockwise from the right: 1 and 2, then 3, the
// f loop, 4 to 12 round the far lobe (the d block, four bands deep), 13 to 17, and 18 closing
// back where 1 began. Hydrogen and helium curl in the near lobe's heart.

const RIB_A = 4.4;
const RIB_K = 0.5;
const ribR = (th: number) => RIB_A * (1 + RIB_K * Math.cos(2 * th));
/** Degrees each group spans: s and p groups wider than d groups. */
const ribSpan = (g: number) => (g <= 2 || g >= 13 ? 21 : 17);
const RIB_START = 7;
const RIB_F_GAP = 8;
const ribAngles: Record<number, [number, number]> = (() => {
  const out: Record<number, [number, number]> = {};
  let t = RIB_START;
  for (let g = 1; g <= 18; g++) {
    out[g] = [t, t + ribSpan(g)];
    t += ribSpan(g);
    if (g === 3) t += RIB_F_GAP;
  }
  return out;
})();
const rad = (d: number) => (d * Math.PI) / 180;

function ribbon(o: Orientation): Layout {
  // Upright on a portrait screen: the lobes stack top and bottom and the f loop leans left.
  const P = (th: number, r: number): [number, number] => {
    const x = Math.cos(th) * r, y = Math.sin(th) * r;
    return o === 'portrait' ? [-y, -x] : [x, -y];
  };
  const at = (deg: number, slot: number) => P(rad(deg), ribR(rad(deg)) + slot);
  const cells: Cell[] = [];
  const labels: MapLabel[] = [];
  for (const e of ELEMENTS) {
    if (isF(e) || e.period === 1) continue;
    const [d0, d1] = ribAngles[e.group!];
    const s0 = e.period - 2;
    const mid = (d0 + d1) / 2;
    const [x, y] = at(mid, s0 + 0.5);
    const len = rad(d1 - d0) * (ribR(rad(mid)) + s0 + 0.5);
    cells.push({ z: e.z, d: band(at, d0 + 0.35, d1 - 0.35, s0 + 0.03, s0 + 0.97), x, y, w: len * 0.86, h: 0.9 });
  }
  for (let g = 1; g <= 18; g++) {
    const [d0, d1] = ribAngles[g];
    const [x, y] = at((d0 + d1) / 2, 6.55);
    labels.push({ x, y, text: String(g), kind: 'axis' });
  }
  // Hydrogen and helium in the near lobe.
  const [hx, hy] = P(0, RIB_A * 0.75);
  for (const [z, s] of [[1, -1], [2, 1]] as const) {
    const x = o === 'portrait' ? hx + s * 0.75 : hx, y = o === 'portrait' ? hy : hy + s * 0.75;
    cells.push({ z, d: rect(x - 0.6, y - 0.6, 1.2, 1.2, 0.2), x, y, w: 1.2, h: 1.2 });
  }
  // The f loop: an annulus standing off the ribbon between groups 3 and 4, open where it joins.
  const midDeg = (ribAngles[3][1] + ribAngles[4][0]) / 2;
  const base = at(midDeg, 6.2);
  const out = at(midDeg, 7.2);
  const dir = [out[0] - base[0], out[1] - base[1]];
  const rIn = 1.7, gap = 0.9;
  const cx = base[0] + dir[0] * (rIn + 2.4), cy = base[1] + dir[1] * (rIn + 2.4);
  const open = Math.atan2(-dir[1], -dir[0]);
  const loopAt = (q: number, r: number): [number, number] => [cx + Math.cos(q) * r, cy + Math.sin(q) * r];
  for (const e of ELEMENTS.filter(isF)) {
    const i = fIndex(e), k = e.period === 6 ? 0 : 1;
    const q0 = open + gap / 2 + ((2 * Math.PI - gap) * i) / 14, q1 = open + gap / 2 + ((2 * Math.PI - gap) * (i + 1)) / 14;
    const r0 = rIn + k, qm = (q0 + q1) / 2;
    const [x, y] = loopAt(qm, r0 + 0.5);
    cells.push({ z: e.z, d: band(loopAt, q0 + 0.015, q1 - 0.015, r0 + 0.03, r0 + 0.97, 5), x, y, w: (q1 - q0) * (r0 + 0.5) * 0.86, h: 0.9 });
  }
  labels.push({ x: cx, y: cy, text: 'f', kind: 'title' });
  return { id: 'ribbon', cells, labels };
}

// ---------------------------------------------------------------------------
// Spiral: one turn per period, clockwise from the top. Each turn starts with an alkali metal
// just right of twelve o'clock and ends with a noble gas just left of it.

const SPIRAL_RADII = [0.9, 2.0, 3.1, 4.2, 5.4, 6.6, 7.9, 9.2];
const PERIOD_RANGE: [number, number][] = [[1, 2], [3, 10], [11, 18], [19, 36], [37, 54], [55, 86], [87, 118]];

function spiral(): Layout {
  const cells: Cell[] = [];
  const labels: MapLabel[] = [];
  for (const e of ELEMENTS) {
    const [a, b] = PERIOD_RANGE[e.period - 1];
    const n = b - a + 1, i = e.z - a;
    const pi = e.period - 1;
    const at = (t: number, off: number): [number, number] => {
      const r = SPIRAL_RADII[pi] + (SPIRAL_RADII[pi + 1] - SPIRAL_RADII[pi]) * t + off;
      const th = Math.PI / 2 - t * Math.PI * 2;
      return [Math.cos(th) * r, -Math.sin(th) * r];
    };
    const t0 = i / n, t1 = (i + 1) / n;
    const pad = 0.025 / Math.max(1, SPIRAL_RADII[pi]) * 2;
    const [x, y] = at((t0 + t1) / 2, 0);
    const r = SPIRAL_RADII[pi] + (SPIRAL_RADII[pi + 1] - SPIRAL_RADII[pi]) * ((t0 + t1) / 2);
    cells.push({ z: e.z, d: band(at, t0 + pad, t1 - pad, -0.5, 0.5, Math.max(3, Math.round(24 / n * 4))), x, y, w: Math.min(1.6, (t1 - t0) * 2 * Math.PI * r * 0.86), h: 0.94 });
  }
  for (let p = 1; p <= 7; p++) labels.push({ x: -0.28, y: -SPIRAL_RADII[p - 1], text: String(p), kind: 'axis' });
  return { id: 'spiral', cells, labels };
}

// ---------------------------------------------------------------------------
// Circle: one ring per period, groups along the spokes, s and p spokes wider than d ones.

const ringR = (period: number) => 1.0 + period * 1.1;
const SP_W = 24;
const D_W = (360 - 8 * SP_W) / 10;
const spokeW = (g: number) => (g >= 3 && g <= 12 ? D_W : SP_W);
const SPOKE: number[] = (() => {
  const out: number[] = [];
  let a = 270;
  out[1] = a;
  for (let g = 2; g <= 18; g++) { a += (spokeW(g - 1) + spokeW(g)) / 2; out[g] = a; }
  return out;
})();
const F_R = [11.0, 12.1];

function circle(): Layout {
  const cells: Cell[] = [];
  const labels: MapLabel[] = [];
  const at = (deg: number, r: number): [number, number] => [Math.cos(rad(deg)) * r, -Math.sin(rad(deg)) * r];
  for (const e of ELEMENTS) {
    if (isF(e)) continue;
    const r = ringR(e.period), w = spokeW(e.group!), m = SPOKE[e.group!];
    const [x, y] = at(m, r);
    cells.push({ z: e.z, d: band(at, m - w / 2 + 0.3, m + w / 2 - 0.3, r - 0.53, r + 0.53), x, y, w: Math.min(1.5, rad(w) * r * 0.86), h: 0.98 });
  }
  // The f block: two arcs under the rings, centered at the bottom.
  for (const e of ELEMENTS.filter(isF)) {
    const i = fIndex(e), r = F_R[e.period === 6 ? 0 : 1];
    const step = (1.2 / r) * (180 / Math.PI);
    const m = 270 + (i - 6.5) * step;
    const [x, y] = at(m, r);
    cells.push({ z: e.z, d: band(at, m - step / 2 + 0.2, m + step / 2 - 0.2, r - 0.53, r + 0.53, 4), x, y, w: 1.05, h: 0.98 });
  }
  for (let p = 1; p <= 7; p++) {
    const [x, y] = at(SPOKE[18] + SP_W / 2 + 4, ringR(p));
    labels.push({ x, y, text: String(p), kind: 'axis' });
  }
  for (let g = 1; g <= 18; g++) {
    const [x, y] = at(SPOKE[g], ringR(7) + 1.05);
    labels.push({ x, y, text: String(g), kind: 'axis' });
  }
  return { id: 'circle', cells, labels };
}

const cache = new Map<string, Layout>();
/** A map's cells and labels, standing or flat for the screen's shape. */
export function layout(id: LayoutId, o: Orientation = 'landscape'): Layout {
  const key = `${id}:${id === 'table' || id === 'ribbon' ? o : ''}`;
  let l = cache.get(key);
  if (!l) {
    l = id === 'table' ? table(o) : id === 'ribbon' ? ribbon(o) : id === 'spiral' ? spiral() : circle();
    cache.set(key, l);
  }
  return l;
}

/** The element at the center of a cell, for tests. */
export const cellElement = (c: Cell): Element => elementAt(c.z);
