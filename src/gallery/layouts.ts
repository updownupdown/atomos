// Where each of the 118 atoms sits in the gallery, for each arrangement, and
// the guide lines and captions that explain why it is arranged that way.
// Positions are in scene units with roughly one unit between neighbours; the
// camera fits whatever the layout spans.

import * as THREE from 'three';
import { ELEMENTS, type Block, type Element } from './data';

export type LayoutId = 'spiral' | 'table' | 'ribbon' | 'circle';
export const LAYOUTS: { id: LayoutId; label: string; note: string }[] = [
  { id: 'spiral', label: 'Spiral', note: 'One turn per period, starting at the top; each turn ends with a noble gas' },
  { id: 'table', label: 'Table', note: 'Rows are periods, columns are groups; lanthanides and actinides sit below' },
  { id: 'ribbon', label: 'Ribbon', note: "Hyde's curled ribbon: groups run round the loop, periods from the inside out" },
  { id: 'circle', label: 'Circle', note: 'One ring per period, groups lined up along the spokes' },
];
export const isLayoutId = (id: string | null): id is LayoutId => LAYOUTS.some((l) => l.id === id);

export interface Placed {
  z: number;
  x: number;
  y: number;
  zz: number;
}

/** Colour of a guide: a plain rule, a fainter rule, or an orbital block's colour. */
export type Tone = 'rule' | 'faint' | Block;

export interface Guide {
  pts: [number, number][];
  tone: Tone;
  dashed?: boolean;
}

export interface Marker {
  x: number;
  y: number;
  zz: number;
  text: string;
  /** axis: small numbers; title: spaced capitals; block: a block's name in its colour. */
  kind: 'axis' | 'title' | 'block';
  tone?: Tone;
}

export interface Layout {
  id: LayoutId;
  atoms: Placed[];
  markers: Marker[];
  guides: Guide[];
  /** Whether sideways drags turn the layout instead of panning it. */
  rotates: boolean;
}

const PERIOD_RANGE: [number, number][] = [[1, 2], [3, 10], [11, 18], [19, 36], [37, 54], [55, 86], [87, 118]];
const BLOCK_LABEL: Record<Block, string> = { s: 's block', p: 'p block', d: 'd block', f: 'f block' };
const isF = (z: number) => (z >= 58 && z <= 71) || (z >= 90 && z <= 103);

function arc(cx: number, cy: number, r: number, a0: number, a1: number, steps = 24): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Spiral: one turn per period, clockwise from the top. Every turn starts with
// an alkali metal just right of twelve o'clock and ends with a noble gas just
// left of it, so the seam at the top is where each shell closes.

const SPIRAL_RADII = [0.6, 1.7, 2.8, 3.9, 5.15, 6.35, 7.65, 8.9];
function spiralPoint(period: number, t: number, inset = 0): [number, number] {
  const pi = period - 1;
  const r = SPIRAL_RADII[pi] + (SPIRAL_RADII[pi + 1] - SPIRAL_RADII[pi]) * t - inset;
  const th = Math.PI / 2 - t * Math.PI * 2;
  return [Math.cos(th) * r, Math.sin(th) * r];
}

function spiral(): Layout {
  const atoms: Placed[] = [];
  const guides: Guide[] = [];
  const markers: Marker[] = [];
  for (const e of ELEMENTS) {
    const [a, b] = PERIOD_RANGE[e.period - 1];
    const n = b - a + 1;
    const t = (e.z - a + 0.5) / n;
    const [x, y] = spiralPoint(e.period, t);
    atoms.push({ z: e.z, x, y, zz: 0 });
    // A coloured rail inside each atom: which orbital block it is filling.
    const pts: [number, number][] = [];
    for (let i = 0; i <= 6; i++) pts.push(spiralPoint(e.period, t + ((i / 6 - 0.5) * 0.92) / n, 0.5));
    guides.push({ pts, tone: e.block });
  }
  // The seam: every turn closes here.
  guides.push({ pts: [[0, 0.25], [0, SPIRAL_RADII[7] + 0.5]], tone: 'faint', dashed: true });
  markers.push({ x: 0, y: SPIRAL_RADII[7] + 1.0, zz: 0, text: 'noble gases close each turn', kind: 'title' });
  for (let p = 1; p <= 7; p++) markers.push({ x: 0, y: SPIRAL_RADII[p - 1] - 0.12, zz: 0, text: String(p), kind: 'axis' });
  const legendY = -SPIRAL_RADII[7] - 1.3;
  (['s', 'f', 'd', 'p'] as Block[]).forEach((b, i) => markers.push({ x: (i - 1.5) * 2.2, y: legendY, zz: 0, text: BLOCK_LABEL[b], kind: 'block', tone: b }));
  return { id: 'spiral', atoms, markers, guides, rotates: false };
}

// ---------------------------------------------------------------------------
// Table.

const TABLE_DX = 1.05;
const TABLE_DY = 1.3;
function tableXY(col: number, row: number): [number, number] {
  return [(col - 8.5) * TABLE_DX, -(row - 4.75) * TABLE_DY];
}
function tableCell(e: Element): { col: number; row: number } {
  if (e.z >= 57 && e.z <= 71) return { col: 2 + (e.z - 57), row: 8.5 };
  if (e.z >= 89 && e.z <= 103) return { col: 2 + (e.z - 89), row: 9.5 };
  return { col: (e.group ?? 3) - 1, row: e.period - 1 };
}

function table(): Layout {
  const atoms = ELEMENTS.map((e) => {
    const { col, row } = tableCell(e);
    const [x, y] = tableXY(col, row);
    return { z: e.z, x, y, zz: 0 };
  });
  const markers: Marker[] = [];
  const guides: Guide[] = [];
  // Group numbers above the top cell of each column.
  const topRow = (g: number) => (g === 1 || g === 18 ? 0 : g === 2 || g >= 13 ? 1 : 3);
  for (let g = 1; g <= 18; g++) {
    const [x, y] = tableXY(g - 1, topRow(g) - 0.62);
    markers.push({ x, y, zz: 0, text: String(g), kind: 'axis' });
  }
  for (let p = 1; p <= 7; p++) {
    const [x, y] = tableXY(-0.85, p - 1);
    markers.push({ x, y: y + 0.1, zz: 0, text: String(p), kind: 'axis' });
  }
  // Block rails over the columns they cover, with the block named once.
  const rail = (b: Block, c0: number, c1: number, row: number) => {
    const [x0, y] = tableXY(c0 - 0.42, row - 0.9);
    const [x1] = tableXY(c1 + 0.42, row - 0.9);
    guides.push({ pts: [[x0, y], [x1, y]], tone: b });
    markers.push({ x: (x0 + x1) / 2, y: y + 0.32, zz: 0, text: BLOCK_LABEL[b], kind: 'block', tone: b });
  };
  rail('s', 0, 1, 0);
  rail('d', 2, 11, 3);
  rail('p', 12, 17, 1);
  const [fx0, fy] = tableXY(2 - 0.42, 8.5 - 0.9);
  const [fx1] = tableXY(16 + 0.42, 8.5 - 0.9);
  guides.push({ pts: [[fx0, fy], [fx1, fy]], tone: 'f' });
  // Where the f rows belong: they open between groups 2 and 3 of periods 6 and 7.
  for (const [row, label] of [[8.5, 'lanthanides'], [9.5, 'actinides']] as [number, string][]) {
    const [x, y] = tableXY(-0.1, row);
    markers.push({ x: x + 0.2, y: y + 0.1, zz: 0, text: label, kind: 'title' });
  }
  const [gx, gy6] = tableXY(2, 5);
  const [, gy7] = tableXY(2, 6);
  const [, fyTop] = tableXY(2, 8.5 - 0.9);
  guides.push({ pts: [[gx - 0.55, gy6 + 0.5], [gx - 0.55, fyTop - 0.1]], tone: 'faint', dashed: true });
  guides.push({ pts: [[gx - 0.55, gy7 - 0.4], [fx0 + 0.2, fy]], tone: 'faint', dashed: true });
  markers.push({ x: (fx0 + fx1) / 2, y: fy + 0.32, zz: 0, text: BLOCK_LABEL.f, kind: 'block', tone: 'f' });
  return { id: 'table', atoms, markers, guides, rotates: false };
}

// ---------------------------------------------------------------------------
// Curled ribbon, after J. F. Hyde's chart (1975). The groups run round a
// closed band, anticlockwise from the top: 4 to 12 round the left lobe, 13 to
// 17 along the bottom, 18, 1 and 2 round the right lobe, 3 back at the top.
// Across the band, periods run from the inside out. The f block rises from
// the top of the band as a loop of its own, lanthanides inside, actinides out.

const RIBBON_ROW = 0.9;
const RIBBON_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2, 3];
const RIBBON_SLOTS = 19.5;
let ribbonCurve: THREE.CatmullRomCurve3 | null = null;
function ribbonSpine(): THREE.CatmullRomCurve3 {
  if (!ribbonCurve) {
    const c: [number, number][] = [
      [0, 2.0], [-3, 3.5], [-6.5, 5.0], [-10.4, 3.4], [-11.6, 0], [-10.4, -3.4], [-6.5, -5.0], [-3, -4.5],
      [0, -3.4], [3, -4.5], [6.5, -5.0], [10.4, -3.4], [11.6, 0], [10.4, 3.4], [6.5, 5.0], [3, 3.5],
    ];
    ribbonCurve = new THREE.CatmullRomCurve3(c.map(([x, y]) => new THREE.Vector3(x, y, 0)), true, 'centripetal');
  }
  return ribbonCurve;
}
/** A point on the band: u runs anticlockwise round the spine from the top; row 0 is the spine, positive rows outward. */
function ribbonPoint(u: number, row: number): [number, number] {
  const c = ribbonSpine();
  const uu = ((u % 1) + 1) % 1;
  const p = c.getPointAt(uu);
  const t = c.getTangentAt(uu);
  // Anticlockwise, the inside of the loop is on the left of the tangent.
  return [p.x + t.y * row, p.y - t.x * row];
}
const ribbonU = (group: number) => (0.75 + RIBBON_ORDER.indexOf(group)) / RIBBON_SLOTS;
const ribbonRow = (period: number) => (period - 4) * RIBBON_ROW;

const LOOP_CY = 10.0;
const LOOP_R = [2.35, 3.4];
const loopAngle = (i: number) => ((-50 + (i * 280) / 13) * Math.PI) / 180;

function ribbon(): Layout {
  const atoms: Placed[] = [];
  const guides: Guide[] = [];
  const markers: Marker[] = [];
  for (const e of ELEMENTS) {
    if (isF(e.z)) {
      const i = e.z >= 90 ? e.z - 90 : e.z - 58;
      const a = loopAngle(i);
      const r = LOOP_R[e.z >= 90 ? 1 : 0];
      atoms.push({ z: e.z, x: Math.cos(a) * r, y: LOOP_CY + Math.sin(a) * r, zz: 0 });
      continue;
    }
    const [x, y] = ribbonPoint(ribbonU(e.group!), ribbonRow(e.period));
    atoms.push({ z: e.z, x, y, zz: 0 });
  }
  // The band's outer edge, broken where the f loop rises.
  const edge = (row: number) => {
    const pts: [number, number][] = [];
    const u0 = 0.3 / RIBBON_SLOTS, u1 = 1 - 0.3 / RIBBON_SLOTS;
    for (let i = 0; i <= 160; i++) pts.push(ribbonPoint(u0 + ((u1 - u0) * i) / 160, row));
    return pts;
  };
  const outerRow = ribbonRow(7) + 0.62;
  guides.push({ pts: edge(outerRow), tone: 'faint' });
  // Each group is a column across the band: a divider on each side, and an inner
  // edge at its first period, so the band narrows where the d block starts at period 4.
  const firstPeriod = (g: number) => (g === 1 || g === 18 ? 1 : g === 2 || g >= 13 ? 2 : 4);
  const half = 0.5 / RIBBON_SLOTS;
  for (const g of RIBBON_ORDER) {
    const u = ribbonU(g);
    const inner = ribbonRow(firstPeriod(g)) - 0.55;
    const seg: [number, number][] = [];
    for (let i = 0; i <= 8; i++) seg.push(ribbonPoint(u - half + (2 * half * i) / 8, inner));
    guides.push({ pts: seg, tone: 'faint' });
    for (const side of [-half, half]) guides.push({ pts: [ribbonPoint(u + side, inner), ribbonPoint(u + side, outerRow)], tone: 'faint' });
    // Block rail along the outer edge, and the group number beyond it.
    const b: Block = g <= 2 ? 's' : g <= 12 ? 'd' : 'p';
    const rail: [number, number][] = [];
    for (let i = 0; i <= 8; i++) rail.push(ribbonPoint(u - half * 0.92 + (1.84 * half * i) / 8, outerRow + 0.14));
    guides.push({ pts: rail, tone: b });
    const [x, y] = ribbonPoint(u, outerRow + 0.6);
    markers.push({ x, y, zz: 0, text: String(g), kind: 'axis' });
  }
  // The f loop rises between groups 3 and 4: its rails, its stem and its names.
  guides.push({ pts: arc(0, LOOP_CY, LOOP_R[0] - 0.55, loopAngle(0) - 0.12, loopAngle(13) + 0.12, 48), tone: 'f' });
  guides.push({ pts: arc(0, LOOP_CY, LOOP_R[1] + 0.55, loopAngle(0) - 0.1, loopAngle(13) + 0.1, 48), tone: 'faint' });
  for (const a of [loopAngle(0) - 0.1, loopAngle(13) + 0.1]) {
    const top: [number, number] = [Math.cos(a) * (LOOP_R[1] + 0.55), LOOP_CY + Math.sin(a) * (LOOP_R[1] + 0.55)];
    const foot = ribbonPoint(a < 0 ? ribbonU(3) + half : ribbonU(4) - half, outerRow);
    guides.push({ pts: [top, foot], tone: 'faint', dashed: true });
  }
  markers.push({ x: 0, y: LOOP_CY + 0.3, zz: 0, text: 'lanthanides', kind: 'title' });
  markers.push({ x: 0, y: LOOP_CY - 0.3, zz: 0, text: 'actinides outside', kind: 'title' });
  const blockAt = (b: Block, g: number) => {
    const [x, y] = ribbonPoint(ribbonU(g), outerRow + 1.35);
    markers.push({ x, y, zz: 0, text: BLOCK_LABEL[b], kind: 'block', tone: b });
  };
  blockAt('d', 8);
  blockAt('p', 15);
  blockAt('s', 1);
  return { id: 'ribbon', atoms, markers, guides, rotates: false };
}

// ---------------------------------------------------------------------------
// Circle: one ring per period, the groups lined up along spokes. The s and p
// groups take wider spokes than the d groups, so periods 2 and 3, which have
// no d block, fill only part of their rings. Groups run anticlockwise from
// group 1 at the bottom; the seam between group 18 and group 1 is where each
// ring closes and the next one starts.

const CIRCLE_R = (period: number) => 1.0 + period * 1.1;
const SP_W = 24;
const D_W = (360 - 8 * SP_W) / 10;
const CIRCLE_ANGLE: number[] = (() => {
  const out: number[] = [];
  let a = 270;
  out[1] = a;
  for (let g = 2; g <= 18; g++) {
    const prev = g - 1 >= 3 && g - 1 <= 12 ? D_W : SP_W;
    const cur = g >= 3 && g <= 12 ? D_W : SP_W;
    a += (prev + cur) / 2;
    out[g] = a;
  }
  return out;
})();
const rad = (deg: number) => (deg * Math.PI) / 180;
const F_R = [11.5, 12.6];

function circle(): Layout {
  const atoms: Placed[] = [];
  const guides: Guide[] = [];
  const markers: Marker[] = [];
  const fStep = 1.15 / F_R[0];
  for (const e of ELEMENTS) {
    if (isF(e.z)) {
      const i = e.z >= 90 ? e.z - 90 : e.z - 58;
      const a = rad(270) + (6.5 - i) * fStep;
      const r = F_R[e.z >= 90 ? 1 : 0];
      atoms.push({ z: e.z, x: Math.cos(a) * r, y: Math.sin(a) * r, zz: 0 });
      continue;
    }
    const a = rad(CIRCLE_ANGLE[e.group!]);
    const r = CIRCLE_R(e.period);
    atoms.push({ z: e.z, x: Math.cos(a) * r, y: Math.sin(a) * r, zz: 0 });
  }
  // Faint rings for the periods, broken where a short period has no atoms.
  for (let p = 1; p <= 7; p++) {
    const r = CIRCLE_R(p) - 0.5;
    if (p <= 3) {
      // Periods 1 to 3: only the s and p spokes.
      guides.push({ pts: arc(0, 0, r, rad(CIRCLE_ANGLE[13] - SP_W / 2), rad(CIRCLE_ANGLE[2] + SP_W / 2 + 360), 40), tone: 'faint' });
    } else guides.push({ pts: arc(0, 0, r, 0, Math.PI * 2, 96), tone: 'faint' });
    const sa = rad(CIRCLE_ANGLE[18] + SP_W / 2);
    markers.push({ x: Math.cos(sa) * CIRCLE_R(p), y: Math.sin(sa) * CIRCLE_R(p) - 0.1, zz: 0, text: String(p), kind: 'axis' });
  }
  // The seam between group 18 and group 1.
  const sa = rad(CIRCLE_ANGLE[18] + SP_W / 2);
  guides.push({ pts: [[Math.cos(sa) * 1.0, Math.sin(sa) * 1.0], [Math.cos(sa) * (CIRCLE_R(7) + 0.5), Math.sin(sa) * (CIRCLE_R(7) + 0.5)]], tone: 'faint', dashed: true });
  // Block rails and group numbers round the outside.
  const outer = CIRCLE_R(7) + 0.62;
  for (let g = 1; g <= 18; g++) {
    const w = g >= 3 && g <= 12 ? D_W : SP_W;
    const b: Block = g <= 2 ? 's' : g <= 12 ? 'd' : 'p';
    guides.push({ pts: arc(0, 0, outer, rad(CIRCLE_ANGLE[g] - w * 0.44), rad(CIRCLE_ANGLE[g] + w * 0.44), 8), tone: b });
    const a = rad(CIRCLE_ANGLE[g]);
    const lr = outer + 0.42;
    markers.push({ x: Math.cos(a) * lr, y: Math.sin(a) * lr - 0.12, zz: 0, text: String(g), kind: 'axis' });
  }
  const label = (b: Block, deg: number, r: number) => markers.push({ x: Math.cos(rad(deg)) * r, y: Math.sin(rad(deg)) * r, zz: 0, text: BLOCK_LABEL[b], kind: 'block', tone: b });
  label('d', 30, outer + 1.3);
  label('p', 192, outer + 1.4);
  // The f block hangs below as two arcs.
  const f0 = rad(270) + 6.5 * fStep + 0.06, f1 = rad(270) - 6.5 * fStep - 0.06;
  guides.push({ pts: arc(0, 0, F_R[0] - 0.55, f0, f1, 40), tone: 'f' });
  markers.push({ x: 0, y: -(F_R[1] + 1.0), zz: 0, text: 'lanthanides inside, actinides outside', kind: 'title' });
  return { id: 'circle', atoms, markers, guides, rotates: false };
}

const builders: Record<LayoutId, () => Layout> = { spiral, table, ribbon, circle };
const cache = new Map<LayoutId, Layout>();

export function layout(id: LayoutId): Layout {
  let l = cache.get(id);
  if (!l) {
    l = builders[id]();
    cache.set(id, l);
  }
  return l;
}
