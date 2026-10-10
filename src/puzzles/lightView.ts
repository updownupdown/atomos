// Drawing and touch for Lumen: the tray of mirrors (and a splitter) sits under
// the grid. Tap an empty cell to set a piece there; tap it again to turn it, a
// third time to take it back. Pieces can also be dragged: from the tray onto a
// cell, from one cell to another, or off the board back to the tray. The beam
// redraws at once, growing from the lamp. Keyboard: arrows move a cursor, Space
// or Enter taps under it, Tab switches between mirrors and splitters.

import { applyFix, cloneLight, DELTA, filterHue, isSplitter, left, lift, nextFix, open, place, relocate, slant, status, tap, targetLit, trace, turnable, type Cell, type Dir, type Hue, type LightState, type PieceKind, type Target } from './light';
import { drawFrame, framePad, frameWidth, type FrameGap } from './frame';
import { bead, C, fitGrid, font, tile } from './palette';
import { drawHelpMark, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

/** Milliseconds for the light to cross one cell as it grows after a change. */
const STEP_MS = 40;
/** Height of the tray under the grid, and of the counter line above it. */
const TRAY_H = 52;
const COUNT_H = 20;

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">Builds fleeting isotopes: pick Lumen when you build one. Every board has exactly one answer, and it uses every piece in the tray, so par is the tray's size. Only placing a piece from the tray counts as a move; turning a piece, dragging it to another square or taking it back is free.</p>
<p class="meta">The tray grows with the atom: one mirror (H to B), two (C to Mn, sometimes with fixed mirrors on the board), three with dark sensors (Fe to Zr), a splitter and two mirrors (Nb to Nd), color filters fixed on the board with colored rings (Pm to Hg), four pieces (Tl to Fm), and 7×7 boards from Md. Keyboard: arrows move a cursor, Space or Enter taps under it, Tab switches between mirrors and splitters.</p>
`;

const hueColor = (h: Hue): string => (h === 'w' ? C.silver : C[h]);

export class LightView implements PuzzleView {
  private state: LightState;
  private history: LightState[] = [];
  private pressed: Point | null = null;
  private cursor: number;
  private showCursor = false;
  private flashAt = -1e9;
  private bump: { cell: number; at: number } | null = null;
  private origin: Point = { x: 0, y: 0 };
  private cell = 40;
  private reduced: boolean;
  /** The kind a tap on an empty cell places. */
  private kind: PieceKind;
  /** Where the tray's chips were drawn, for taps. */
  private chips: { kind: PieceKind; x: number; y: number; w: number; h: number }[] = [];
  /** Look here: the cell to ring, for the board it was asked on. */
  private mark: { state: LightState; cell: number } | null = null;
  /** A piece under the finger: picked up from a cell, or from the tray (from = -1). It counts as
   *  a drag once the finger has moved past the slop; until then the press is still a tap. */
  private grab: { from: number; kind: PieceKind; cell: Cell; start: Point; at: Point; active: boolean } | null = null;

  constructor(private readonly initial: LightState, reducedMotion: boolean) {
    this.state = cloneLight(initial);
    this.reduced = reducedMotion;
    this.kind = initial.tray.mirrors ? 'mirror' : 'splitter';
    this.cursor = Math.max(0, initial.cells.findIndex((_, i) => open(initial, i)));
  }

  get won(): boolean { return status(this.state).won; }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  stats(): { progress: Stat } { const st = status(this.state); return { progress: { label: 'Lit', value: `${st.lit}/${st.total}` } }; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    const st = status(this.state);
    if (st.won) return 'Every ring is lit';
    if (st.darkLit.length) return st.darkLit.length === 1 ? 'A dark sensor is lit' : `${st.darkLit.length} dark sensors are lit`;
    if (st.wrongHue.length) return st.wrongHue.length === 1 ? 'A ring has the wrong color' : `${st.wrongHue.length} rings have the wrong color`;
    return '';
  }

  help(level: 1 | 2): Help | null {
    if (this.won) return null;
    const s = this.state;
    const f = nextFix(s);
    if (!f) return null;
    const name = isSplitter(f.kind === 'place' ? f.want : s.cells[f.cell]) ? 'splitter' : 'mirror';
    if (level === 2) {
      this.commit(applyFix(s, f), f.cell);
      const text = f.kind === 'place' ? `Placed a ${name}.` : f.kind === 'turn' ? `Turned the ${name}.` : `Took the ${name} back.`;
      return { text, moved: true };
    }
    this.mark = { state: s, cell: f.cell };
    const text = f.kind === 'place' ? `This cell needs a ${name}.`
      : f.kind === 'turn' ? `This ${name} faces the wrong way.`
      : turnable(f.want) ? `This cell needs a ${name === 'mirror' ? 'splitter' : 'mirror'}, not a ${name}.`
      : `This ${name} doesn't belong here.`;
    return { text };
  }

  restart(): void {
    this.state = cloneLight(this.initial);
    this.history = [];
    this.kind = this.initial.tray.mirrors ? 'mirror' : 'splitter';
    this.flashAt = performance.now();
    this.bump = null;
    this.grab = null;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.grab = null;
    this.flashAt = performance.now();
    return true;
  }

  private tryTap(i: number): void {
    if (this.won || i < 0) return;
    const next = tap(this.state, i, this.kind);
    if (!next) {
      this.bump = { cell: i, at: performance.now() };
      return;
    }
    this.commit(next, i);
  }

  /** Takes a tap's (or Show me's) new board: one undo step, the beam regrown from the lamp. */
  private commit(next: LightState | null, i: number): void {
    if (!next) return;
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.state = next;
    this.cursor = i;
    this.flashAt = performance.now();
    // Once a kind is used up, an empty cell takes the other.
    const l = left(this.state);
    if (l[this.kind] <= 0 && l[this.other()] > 0) this.kind = this.other();
  }

  private other(): PieceKind { return this.kind === 'mirror' ? 'splitter' : 'mirror'; }

  private choose(kind: PieceKind): void {
    if (this.initial.tray[kind === 'mirror' ? 'mirrors' : 'splitters'] > 0) this.kind = kind;
  }

  // ---- geometry ---------------------------------------------------------------------

  private layout(area: Area): { statusY: number } {
    const n = this.state.size;
    // Half a cell round the grid for the lamp and the beam's exit stubs; the counter and tray below.
    const fit = fitGrid(area, n + 1.1, n + 1.1, { margin: 6, bottom: COUNT_H + TRAY_H, maxCell: 72 });
    this.cell = fit.cell;
    this.origin = { x: fit.x + 0.55 * fit.cell, y: fit.y + 0.55 * fit.cell };
    return { statusY: fit.y + fit.h + 2 };
  }

  private cellAt(p: Point): number {
    const cx = Math.floor((p.x - this.origin.x) / this.cell), cy = Math.floor((p.y - this.origin.y) / this.cell);
    if (cx < 0 || cy < 0 || cx >= this.state.size || cy >= this.state.size) return -1;
    return cy * this.state.size + cx;
  }

  private center(i: number): Point {
    const n = this.state.size;
    return { x: this.origin.x + ((i % n) + 0.5) * this.cell, y: this.origin.y + (Math.floor(i / n) + 0.5) * this.cell };
  }

  private chipAt(p: Point): { kind: PieceKind; x: number; y: number; w: number; h: number } | undefined {
    return this.chips.find((c) => p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h);
  }

  /** Clearly off the board: more than half a cell past its rim, or on the tray. A drop just past
   *  the rim is a near miss, not a throw back to the tray. */
  private offBoard(p: Point): boolean {
    const span = this.state.size * this.cell, slack = this.cell * 0.5;
    const x = p.x - this.origin.x, y = p.y - this.origin.y;
    return !!this.chipAt(p) || x < -slack || y < -slack || x > span + slack || y > span + slack;
  }

  // ---- input ----------------------------------------------------------------------

  /** How far a press may wander and still be a tap. */
  private tapSlop(): number { return Math.max(14, this.cell * 0.35); }
  /** How far a press on a piece moves before it becomes a drag. */
  private dragSlop(): number { return Math.max(9, this.cell * 0.18); }

  down(p: Point): void {
    this.pressed = p;
    this.grab = null;
    if (this.won) return;
    const chip = this.chipAt(p);
    if (chip) {
      if (left(this.state)[chip.kind] > 0) this.grab = { from: -1, kind: chip.kind, cell: chip.kind === 'mirror' ? '/' : 'H/', start: p, at: p, active: false };
      return;
    }
    const i = this.cellAt(p);
    const c = i >= 0 ? this.state.cells[i] : '.';
    if (turnable(c)) this.grab = { from: i, kind: isSplitter(c) ? 'splitter' : 'mirror', cell: c, start: p, at: p, active: false };
  }

  move(p: Point): void {
    const g = this.grab;
    if (!g) return;
    g.at = p;
    if (!g.active && Math.hypot(p.x - g.start.x, p.y - g.start.y) > this.dragSlop()) {
      g.active = true;
      this.showCursor = false;
    }
  }

  cancel(): void {
    this.pressed = null;
    this.grab = null;
  }

  up(p: Point): void {
    const s = this.pressed;
    const g = this.grab;
    this.pressed = null;
    this.grab = null;
    if (g?.active) { this.drop(g, p); return; }
    if (!s || Math.hypot(p.x - s.x, p.y - s.y) > this.tapSlop()) return;
    this.showCursor = false;
    const chip = this.chipAt(s);
    if (chip) { this.choose(chip.kind); return; }
    this.tryTap(this.cellAt(s));
  }

  /** Where a carried piece would land at p: a cell it can go on, or -1. */
  private dropCell(g: { from: number; kind: PieceKind }, p: Point): number {
    const to = this.cellAt(p);
    if (to < 0 || to === g.from || !open(this.state, to)) return -1;
    return g.from < 0 && left(this.state)[g.kind] <= 0 ? -1 : to;
  }

  /**
   * Lets go of a carried piece. On an open cell it lands there: from the tray that is a placement
   * (one move), from another cell a free move. Dropped off the board it goes back to the tray (a
   * tray piece simply stays there). Dropped on a cell that cannot take it, it snaps back where it
   * came from, with the refused cell nudged. Every change is one undo step.
   */
  private drop(g: NonNullable<LightView['grab']>, p: Point): void {
    if (this.won) return;
    const s = this.state;
    const to = this.dropCell(g, p);
    if (g.from < 0) {
      this.choose(g.kind);
      if (to >= 0) this.commit(place(s, to, g.kind), to);
      else if (!this.offBoard(p)) this.refuse(this.cellAt(p));
      return;
    }
    if (to >= 0) { this.commit(relocate(s, g.from, to), to); return; }
    const at = this.cellAt(p);
    // A short wobble that ends on its own cell is still a tap.
    if (at === g.from) { if (Math.hypot(p.x - g.start.x, p.y - g.start.y) <= this.tapSlop()) this.tryTap(at); return; }
    if (this.offBoard(p)) { this.commit(lift(s, g.from), g.from); return; }
    this.refuse(at);
  }

  private refuse(i: number): void {
    if (i >= 0) this.bump = { cell: i, at: performance.now() };
  }

  key(e: KeyboardEvent): boolean {
    const n = this.state.size;
    const d: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (d[e.key]) {
      e.preventDefault();
      if (this.showCursor) {
        const x = Math.max(0, Math.min(n - 1, (this.cursor % n) + d[e.key][0]));
        const y = Math.max(0, Math.min(n - 1, Math.floor(this.cursor / n) + d[e.key][1]));
        this.cursor = y * n + x;
      }
      this.showCursor = true;
      return true;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this.showCursor = true;
      this.tryTap(this.cursor);
      return true;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      this.choose(this.other());
      return true;
    }
    return false;
  }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const { statusY } = this.layout(area);
    const s = this.state;
    const c = this.cell;
    const half = c / 2;
    const st = status(s);
    const g = this.grab?.active ? this.grab : null;
    ctx.save();
    paintLight(ctx, s, { x: this.origin.x, y: this.origin.y, c, rows: s.size }, this.reduced ? Infinity : (now - this.flashAt) / STEP_MS, now, !this.reduced, g ? g.from : -1);

    // A carried piece: the cell it would land on, lit in the accent.
    const to = g ? this.dropCell(g, g.at) : -1;
    if (to >= 0) {
      const p = this.center(to);
      ctx.save();
      ctx.globalAlpha = 0.16;
      tile(ctx, p.x - half + 1.5, p.y - half + 1.5, c - 3, c - 3, c * 0.18, C.accent, null);
      ctx.restore();
      tile(ctx, p.x - half + 1.5, p.y - half + 1.5, c - 3, c - 3, c * 0.18, null, C.accent, 2);
    }

    // Keyboard cursor and a nudge where a tap does nothing.
    if (this.showCursor && !st.won) {
      const p = this.center(this.cursor);
      tile(ctx, p.x - half + 1.5, p.y - half + 1.5, c - 3, c - 3, c * 0.18, null, C.accent, 2);
    }
    // Look here: the cell to change.
    if (this.mark?.state === s && !st.won) {
      const p = this.center(this.mark.cell);
      drawHelpMark(ctx, p.x - half + 2, p.y - half + 2, c - 4, c - 4, now, this.reduced, c * 0.18);
    }
    const bumpT = this.bump ? Math.max(0, 1 - (now - this.bump.at) / 350) : 0;
    if (this.bump && bumpT > 0) nudge(ctx, this.center(this.bump.cell), c, bumpT, !this.reduced);

    // One small counter under the grid, then the tray.
    ctx.font = font(13);
    ctx.fillStyle = C.text2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${st.lit} / ${st.total} lit`, area.x + area.w / 2, statusY);
    this.drawTray(ctx, area.x + area.w / 2, statusY + COUNT_H, g);

    // The carried piece itself, lifted, under the finger.
    if (g) {
      const side = c * 0.9;
      ctx.save();
      ctx.globalAlpha = 0.92;
      if (!this.reduced) { ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'; ctx.shadowBlur = c * 0.3; ctx.shadowOffsetY = c * 0.06; }
      tile(ctx, g.at.x - side / 2, g.at.y - side / 2, side, side, c * 0.18, C.surface3, null);
      ctx.restore();
      tile(ctx, g.at.x - side / 2, g.at.y - side / 2, side, side, c * 0.18, null, to >= 0 ? C.accent : C.line2, 1.5);
      piece(ctx, g.cell, g.at, c, true);
    }
    ctx.restore();
  }

  /** The tray: a chip per piece kind, a drawing of the piece and how many are left; the kind an
   *  empty cell takes is raised. */
  private drawTray(ctx: CanvasRenderingContext2D, cx: number, y: number, g: LightView['grab']): void {
    const l = left(this.state);
    // A piece carried out of the tray is not in it; one carried off the board is on its way back.
    if (g && g.from < 0) l[g.kind] -= 1;
    const home = g && g.from >= 0 && this.offBoard(g.at) ? g.kind : null;
    const kinds = (['mirror', 'splitter'] as PieceKind[]).filter((k) => this.state.tray[k === 'mirror' ? 'mirrors' : 'splitters'] > 0);
    const w = 92, h = 44, gap = 10;
    let x = cx - (kinds.length * w + (kinds.length - 1) * gap) / 2;
    this.chips = [];
    for (const k of kinds) {
      const on = k === this.kind && kinds.length > 1;
      const empty = l[k] <= 0;
      ctx.save();
      ctx.globalAlpha = empty ? 0.45 : 1;
      tile(ctx, x, y, w, h, 8, on ? C.surface3 : C.surface, home === k ? C.accent : null, 2);
      const pc = 30;
      piece(ctx, k === 'mirror' ? '/' : 'H/', { x: x + 8 + pc / 2, y: y + h / 2 }, pc * 1.3, true);
      ctx.font = font(15, 600);
      ctx.fillStyle = empty ? C.text3 : C.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`× ${l[k]}`, x + 8 + pc + 10, y + h / 2 + 1);
      ctx.restore();
      this.chips.push({ kind: k, x, y, w, h });
      x += w + gap;
    }
  }
}

// ---- the shared painter ----------------------------------------------------------------

/** Where the grid sits: its top-left corner, the cell size and how many rows show. */
interface Geo { x: number; y: number; c: number; rows: number }

/** A refused tap: a faint outline that wobbles and fades. */
function nudge(ctx: CanvasRenderingContext2D, p: Point, c: number, k: number, motion: boolean): void {
  const half = c / 2;
  const wob = motion ? Math.sin(k * Math.PI * 4) * c * 0.04 : 0;
  ctx.save();
  ctx.globalAlpha = k;
  tile(ctx, p.x - half + 2 + wob, p.y - half + 2, c - 4, c - 4, c * 0.18, null, C.text3, 1.5);
  ctx.restore();
}

/**
 * Paints the tiles, the beam grown `progress` cells out from the lamp, the
 * pieces, the sensors and the lamp. Rows past `g.rows` are hidden (the rule
 * cards' boards are cut short): light running into them leaves as at the rim.
 * The piece on cell `ghost` (one being carried) shows faintly, still in place.
 */
function paintLight(ctx: CanvasRenderingContext2D, s: LightState, g: Geo, progress: number, now: number, motion: boolean, ghost = -1): void {
  const n = s.size;
  const c = g.c;
  const half = c / 2;
  const shown = (i: number) => Math.floor(i / n) < g.rows;
  const center = (i: number): Point => ({ x: g.x + ((i % n) + 0.5) * c, y: g.y + (Math.floor(i / n) + 0.5) * c });
  const beam = trace(s);
  ctx.save();

  boardFrame(ctx, s, g);

  // A placed piece stands on a raised tile; a square that can take one shows a faint dot. The
  // rest (the lamp's own cell, fixed pieces, sensors) are bare: what is on them says what they are.
  for (let i = 0; i < n * g.rows; i++) {
    const p = center(i);
    if (turnable(s.cells[i]) && i !== ghost) {
      const inset = c * 0.05;
      tile(ctx, p.x - half + inset, p.y - half + inset, c - inset * 2, c - inset * 2, c * 0.18, C.surface3, C.line2, 1);
    } else if (open(s, i) || i === ghost) {
      ctx.fillStyle = C.surface3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(1.5, c * 0.035), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The beam, grown out from the lamp by steps since the last change: per color, runs of
  // (from, to, distance along the beam at `from`, 1 where the beam ends at `to`). The distance
  // keeps the photon pulses in step through every turn and split.
  const segs = new Map<Hue, number[]>();
  const seg = (h: Hue, a: Point, bx: number, by: number, f: number, d: number, end: boolean) => {
    if (f <= 0) return;
    const k = Math.min(1, f);
    (segs.get(h) ?? segs.set(h, []).get(h)!).push(a.x, a.y, a.x + (bx - a.x) * k, a.y + (by - a.y) * k, d, end && k >= 1 ? 1 : 0);
  };
  for (const v of beam.visits) {
    const f = progress - v.depth;
    if (f <= 0 || !shown(v.cell)) continue;
    const p = center(v.cell);
    const [dx, dy] = DELTA[v.dir];
    const edge = { x: p.x - dx * half, y: p.y - dy * half };
    const d = v.depth * c;
    if (v.stop === 'edge') { seg(v.hue, edge, edge.x + dx * c * 0.12, edge.y + dy * c * 0.12, f * 2, d, true); continue; }
    seg(v.hue, edge, p.x, p.y, f * 2, d, v.outs.length === 0);
    for (const o of v.outs) {
      const [ox, oy] = DELTA[o];
      const out = v.exits.includes(o) || !shown(v.cell + oy * n + ox);
      const reach = out ? half + c * 0.4 : half;
      seg(v.outHue, p, p.x + ox * reach, p.y + oy * reach, f * 2 - 1, d + half, out);
    }
  }
  const t = now / 1000;
  drawBeam(ctx, segs, c, motion ? t : null);

  // Pieces.
  const lit = beam.lit;
  for (let i = 0; i < n * g.rows; i++) {
    if (i !== ghost) { piece(ctx, s.cells[i], center(i), c, lit.has(i)); continue; }
    ctx.save();
    ctx.globalAlpha = 0.3;
    piece(ctx, s.cells[i], center(i), c, false);
    ctx.restore();
  }

  // Sensors: target rings and dark discs.
  for (const tg of s.targets) {
    if (!shown(tg.cell)) continue;
    const on = targetLit(tg, lit);
    // A lit ring brightens softly each time a photon pulse reaches it.
    let flare = 0;
    if (on && motion) {
      for (const v of beam.visits) {
        if (v.cell !== tg.cell || (tg.hue !== 'w' && v.hue !== tg.hue) || progress - v.depth < 0.5) continue;
        flare = Math.max(flare, pulseAt(v.depth * c + half, c, t));
      }
    }
    targetRing(ctx, tg, center(tg.cell), c, on, motion, flare);
  }
  for (const d of s.darks) if (shown(d)) darkSensor(ctx, center(d), c, lit.has(d), now, motion);

  lamp(ctx, center(s.entry), s.entryDir, c, motion);
  ctx.restore();
}

/**
 * The frame round the grid's shown rows, with the lamp's barrel passing in through a gap in it.
 * drawFrame's path starts at the top-left corner, so a gap on the top or left side is cut on the
 * frame turned half round (the box maps onto itself), where it can never reach that start. The
 * gap is named by its distance along the path, as a top-side gap: drawFrame places those at
 * (at - x - r) along the path, which holds round every side.
 */
function boardFrame(ctx: CanvasRenderingContext2D, s: LightState, g: Geo): void {
  const c = g.c, n = s.size;
  const p = framePad(c), lw = frameWidth(c);
  const box = { x: g.x - p, y: g.y - p, w: n * c + p * 2, h: g.rows * c + p * 2 };
  const r = Math.min(c * 0.2 + p, box.w / 2, box.h / 2);
  const gaps: FrameGap[] = [];
  const [dx, dy] = DELTA[s.entryDir];
  // The lamp sits off the side the beam comes in from: the left side for a beam running right.
  const turn = dx > 0 || dy > 0;
  if (Math.floor(s.entry / n) < g.rows) {
    let e = { x: g.x + ((s.entry % n) + 0.5) * c, y: g.y + (Math.floor(s.entry / n) + 0.5) * c };
    if (turn) e = { x: 2 * box.x + box.w - e.x, y: 2 * box.y + box.h - e.y };
    // Now on the right side (a beam running left) or the bottom (running up).
    const sw = box.w - 2 * r, sh = box.h - 2 * r, q = (Math.PI * r) / 2;
    const d = dx ? sw + q + (e.y - box.y - r) : sw + sh + 2 * q + (box.x + box.w - r - e.x);
    gaps.push({ side: 'top', at: box.x + r + d, size: c * 0.36 + lw * 2 });
  }
  ctx.save();
  if (turn) {
    ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
    ctx.rotate(Math.PI);
    ctx.translate(-box.x - box.w / 2, -box.y - box.h / 2);
  }
  drawFrame(ctx, box, { width: lw, radius: r, gaps });
  ctx.restore();
}

/** Photon pulses on the beam: cells apart, and cells travelled per second. Calm on purpose. */
const PULSE_GAP = 2.6;
const PULSE_SPEED = 1.7;

/**
 * How strongly a pulse is arriving at distance `d` along the beam at time `t` (seconds): 1 as one
 * reaches it, falling to 0 over a quarter of the gap to the next.
 */
function pulseAt(d: number, c: number, t: number): number {
  const gap = PULSE_GAP * c;
  const u = ((((t * PULSE_SPEED * c - d) % gap) + gap) % gap) / gap;
  return Math.max(0, 1 - u * 4);
}

/**
 * The laser: per color a soft wide glow, the beam in its color and a hot thin core. While motion
 * is on (`t` is the time in seconds, null when still), small bright photon pulses run along it
 * from the lamp at a calm pace, a few cells apart, keeping step through every mirror and split
 * (the distance along the beam sets where they are), and fade out where the beam ends. Each pulse
 * is a short tail and a dot in the beam's color with a white center, so a tinted beam keeps its
 * color. `segs` holds runs as from x, y, to x, y, the distance along the beam at the start, and 1
 * where the beam ends at the run's end.
 */
function drawBeam(ctx: CanvasRenderingContext2D, segs: Map<Hue, number[]>, c: number, t: number | null): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [h, pts] of segs) {
    const col = hueColor(h);
    const white = h === 'w';
    const path = () => {
      ctx.beginPath();
      for (let q = 0; q < pts.length; q += 6) { ctx.moveTo(pts[q], pts[q + 1]); ctx.lineTo(pts[q + 2], pts[q + 3]); }
    };
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.1;
    ctx.lineWidth = Math.max(8, c * 0.26);
    path();
    ctx.stroke();
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = Math.max(4, c * 0.12);
    ctx.stroke();
    ctx.globalAlpha = white ? 0.75 : 1;
    ctx.lineWidth = Math.max(1.8, c * 0.038);
    ctx.stroke();
    // The hot core: white, fainter on a tinted beam so its color holds.
    ctx.strokeStyle = C.silver;
    ctx.globalAlpha = white ? 1 : 0.45;
    ctx.lineWidth = Math.max(1, c * 0.016);
    ctx.stroke();
  }
  if (t !== null) {
    const gap = PULSE_GAP * c, head = t * PULSE_SPEED * c;
    const tail = c * 0.55, fade = c * 0.45;
    const halo = Math.max(4.5, c * 0.12), core = Math.max(2, c * 0.05);
    for (const [h, pts] of segs) {
      const col = hueColor(h);
      for (let q = 0; q < pts.length; q += 6) {
        const ax = pts[q], ay = pts[q + 1], len = Math.hypot(pts[q + 2] - ax, pts[q + 3] - ay);
        if (len < 0.5) continue;
        const ux = (pts[q + 2] - ax) / len, uy = (pts[q + 3] - ay) / len, d0 = pts[q + 4], end = pts[q + 5] === 1;
        // The first pulse at or past this run's start, then every gap after it.
        for (let d = head - Math.floor((head - d0) / gap) * gap; d <= d0 + len; d += gap) {
          if (d < 0) continue;
          const sd = d - d0;
          // Fade in out of the lamp, and out where the beam ends.
          const k = Math.min(1, d / fade, end ? (len - sd) / fade : 1);
          if (k <= 0) continue;
          const x = ax + ux * sd, y = ay + uy * sd;
          // A tail thinning back along the beam: two strokes, the nearer half brighter.
          const back = Math.min(sd, tail);
          ctx.strokeStyle = col;
          ctx.lineWidth = core * 1.5;
          ctx.globalAlpha = 0.25 * k;
          ctx.beginPath();
          ctx.moveTo(x - ux * back, y - uy * back);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.globalAlpha = 0.45 * k;
          ctx.beginPath();
          ctx.moveTo(x - ux * back * 0.5, y - uy * back * 0.5);
          ctx.lineTo(x, y);
          ctx.stroke();
          // The photon: a soft halo in the beam's color, then a bright dot with a white heart.
          ctx.fillStyle = col;
          ctx.globalAlpha = 0.28 * k;
          ctx.beginPath();
          ctx.arc(x, y, halo, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.5 * k;
          ctx.beginPath();
          ctx.arc(x, y, halo * 0.62, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = k;
          ctx.beginPath();
          ctx.arc(x, y, core, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(x, y, core * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  ctx.restore();
}

/**
 * The lamp: a short barrel outside the grid that reaches a little way into the cell the beam
 * enters, its lens glowing where the light comes out. That cell is part of the lamp, not a slot.
 */
function lamp(ctx: CanvasRenderingContext2D, e: Point, dir: Dir, c: number, motion: boolean): void {
  const [dx, dy] = DELTA[dir];
  // Along the beam, from the barrel's back (0.45 of a cell outside the grid) to its lens, most of
  // the way across the cell.
  const back = -c * 0.95, front = -c * 0.14, w = c * 0.36;
  const x0 = e.x + dx * back, y0 = e.y + dy * back, x1 = e.x + dx * front, y1 = e.y + dy * front;
  const bx = Math.min(x0, x1) - (dx ? 0 : w / 2), by = Math.min(y0, y1) - (dy ? 0 : w / 2);
  const bw = dx ? Math.abs(x1 - x0) : w, bh = dy ? Math.abs(y1 - y0) : w;
  ctx.save();
  tile(ctx, bx, by, bw, bh, c * 0.09, C.surface3, C.line2, 1);
  // A ridge across the barrel, two thirds of the way back.
  ctx.strokeStyle = C.line2;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const r = back + (front - back) * 0.38;
  const rx = e.x + dx * r, ry = e.y + dy * r;
  ctx.moveTo(rx - dy * w * 0.32, ry - dx * w * 0.32);
  ctx.lineTo(rx + dy * w * 0.32, ry + dx * w * 0.32);
  ctx.stroke();
  ctx.restore();
  bead(ctx, x1, y1, Math.max(3, c * 0.09), C.silver, { glow: motion ? C.silver : undefined });
}

/** A target ring: red, or its light's color with a small red heart; filled while lit, and a
 *  little brighter for a moment (`flare`, 0 to 1) as each photon pulse arrives. */
function targetRing(ctx: CanvasRenderingContext2D, t: Target, p: Point, c: number, on: boolean, motion: boolean, flare = 0): void {
  const col = t.hue === 'w' ? C.target : C[t.hue];
  const r = c * 0.22;
  ctx.save();
  if (on) {
    if (motion) { ctx.shadowColor = col; ctx.shadowBlur = c * (0.3 + 0.25 * flare); }
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.5 + 0.25 * flare;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(2, c * 0.05);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  // A colored ring keeps a small red heart, so it still reads as a goal.
  if (t.hue !== 'w') bead(ctx, p.x, p.y, Math.max(2, c * 0.05), C.target, { alpha: on ? 1 : 0.7 });
}

/** A dark sensor: a dark disc with a bar, flaring amber while light reaches it. */
function darkSensor(ctx: CanvasRenderingContext2D, p: Point, c: number, bad: boolean, now: number, motion: boolean): void {
  const r = c * 0.2;
  const pulse = motion ? 0.7 + 0.3 * Math.sin(now / 160) : 1;
  ctx.save();
  ctx.fillStyle = C.bg;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  if (bad) {
    if (motion) { ctx.shadowColor = C.warn; ctx.shadowBlur = c * 0.3; }
    ctx.fillStyle = C.warn;
    ctx.globalAlpha = 0.3 * pulse;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = bad ? C.warn : C.line3;
  ctx.lineWidth = Math.max(1.5, c * 0.04);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = bad ? C.warn : C.text3;
  ctx.lineWidth = Math.max(2, c * 0.05);
  ctx.beginPath();
  ctx.moveTo(p.x - r * 0.45, p.y);
  ctx.lineTo(p.x + r * 0.45, p.y);
  ctx.stroke();
  ctx.restore();
}

/** One piece, centered on p. */
function piece(ctx: CanvasRenderingContext2D, cell: Cell, p: Point, c: number, lit: boolean): void {
  const half = c / 2;
  if (cell === '.') return;
  ctx.save();
  if (cell === '#') {
    const side = c * 0.56;
    tile(ctx, p.x - side / 2, p.y - side / 2, side, side, c * 0.14, C.neutron, null);
    tile(ctx, p.x - side / 2 + c * 0.06, p.y - side / 2 + c * 0.06, side - c * 0.12, side - c * 0.12, c * 0.1, null, C.line, 1);
    ctx.restore();
    return;
  }
  const hue = filterHue(cell);
  if (hue) {
    const side = c * 0.58;
    ctx.globalAlpha = lit ? 0.38 : 0.24;
    tile(ctx, p.x - side / 2, p.y - side / 2, side, side, c * 0.14, C[hue], null);
    ctx.globalAlpha = 1;
    tile(ctx, p.x - side / 2, p.y - side / 2, side, side, c * 0.14, null, C[hue], Math.max(1.5, c * 0.04));
    ctx.restore();
    return;
  }
  const sl = slant(cell);
  if (!sl) { ctx.restore(); return; }
  const sign = sl === '/' ? -1 : 1;
  const len = half * 0.74;
  const a = { x: p.x - len, y: p.y - sign * len }, b = { x: p.x + len, y: p.y + sign * len };
  if (cell[0] === 'F') {
    // Fixed: a heavier pewter bar, hatched on its back, no pivot.
    const nx = sign / Math.SQRT2, ny = -1 / Math.SQRT2; // a normal to the bar
    ctx.strokeStyle = C.text3;
    ctx.lineWidth = Math.max(1, c * 0.025);
    ctx.beginPath();
    for (let k = -2; k <= 2; k++) {
      const t = k / 2.6;
      const q = { x: p.x + (b.x - p.x) * t, y: p.y + (b.y - p.y) * t };
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x + nx * c * 0.12 - (b.x - a.x) * 0.04, q.y + ny * c * 0.12 - (b.y - a.y) * 0.04);
    }
    ctx.stroke();
    ctx.strokeStyle = lit ? C.silverDim : C.pewter;
    ctx.lineWidth = Math.max(3.5, c * 0.085);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.lineCap = 'round';
  if (isSplitter(cell)) {
    // Half-silvered: a faint pane under a dashed silver face.
    ctx.strokeStyle = C.line2;
    ctx.lineWidth = Math.max(3, c * 0.07);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([c * 0.07, c * 0.06]);
    ctx.strokeStyle = lit ? C.silver : C.silverDim;
    ctx.lineWidth = Math.max(2, c * 0.05);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.strokeStyle = lit ? C.silver : C.silverDim;
    ctx.lineWidth = Math.max(2.5, c * 0.06);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  // The pivot: this one turns.
  bead(ctx, p.x, p.y, Math.max(2.5, c * 0.06), C.surface3, { rim: lit ? C.silver : C.silverDim });
  ctx.restore();
}

// ---- rule pictures ---------------------------------------------------------------------

/**
 * A picture board three cells wide and two high: rows of cells as written, a
 * lamp on cell (x, y) shining `dir`, and its sensors. A hidden third row pads
 * the grid square so the real beam tracing runs unchanged.
 */
function board(cells: Cell[][], lamp: [number, number, Dir], targets: [number, number, Hue][] = [], darks: [number, number][] = []): LightState {
  const n = 3;
  const flat: Cell[] = Array(n * n).fill('.');
  cells.forEach((row, y) => row.forEach((c, x) => { flat[y * n + x] = c; }));
  return {
    size: n, cells: flat, entry: lamp[1] * n + lamp[0], entryDir: lamp[2],
    targets: targets.map(([x, y, hue]) => ({ cell: y * n + x, hue })), darks: darks.map(([x, y]) => y * n + x),
    solution: [...flat], tray: { mirrors: 1, splitters: 1 }, features: [], moves: 0, par: 0,
  };
}

/** Seconds: the beam's first growth, a tap (if any) and the beam regrowing, the verdict coming in, a last rest. */
const GROW = 0.75;
const TAP = 0.25;
const VERDICT = 0.4;
const REST = 0.45;
/** Cells the beam grows per second in a picture. */
const SPEED = 10;

/**
 * One rule picture: the beam grows out from the lamp as on the board; then,
 * if there is a tap, an accent ripple lands on that cell and the piece `to`
 * appears there (or, where a tap does nothing, the board's nudge) and the beam
 * regrows. When the light has settled, the cell `flag` names is flagged in
 * amber. The last frame is that finished state.
 */
function picture(s0: LightState, caption: string, o: { tap?: [number, number]; to?: Cell; flag?: [number, number] } = {}): Illustration {
  const tapAt = o.tap ? GROW : -1;
  let s1: LightState | null = null;
  if (o.tap && o.to) {
    s1 = cloneLight(s0);
    s1.cells[o.tap[1] * s0.size + o.tap[0]] = o.to;
  }
  const changed = !!s1;
  const settle = o.tap ? GROW + TAP + (changed ? GROW : 0.2) : GROW;
  const duration = Math.min(4, Math.max(1.5, settle + (o.flag ? VERDICT : 0) + REST));
  const flag = o.flag ? o.flag[1] * s0.size + o.flag[0] : -1;
  return {
    caption,
    duration,
    draw: (ctx, w, h, t) => {
      const fit = fitGrid({ x: 0, y: 0, w, h }, 3 + 1.1, 2 + 1.1, { margin: 2, maxCell: 999 });
      const c = fit.cell;
      const g = { x: fit.x + 0.55 * c, y: fit.y + 0.55 * c, c, rows: 2 };
      const after = changed && t >= tapAt + TAP;
      const s = after ? s1! : s0;
      const since = after ? t - tapAt - TAP : t;
      paintLight(ctx, s, g, since * SPEED, t * 1000, true);
      if (o.tap && t >= tapAt) {
        const p = { x: g.x + (o.tap[0] + 0.5) * c, y: g.y + (o.tap[1] + 0.5) * c };
        const d = t - tapAt;
        if (!changed && d < 0.4) nudge(ctx, p, c, 1 - d / 0.4, true);
        if (d < 0.5) {
          ctx.save();
          ctx.strokeStyle = C.accent;
          ctx.globalAlpha = 1 - d / 0.5;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, c * (0.25 + 0.3 * d / 0.5), 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
      if (flag >= 0 && t > settle) {
        const k = Math.min(1, (t - settle) / VERDICT);
        const p = { x: g.x + ((flag % s0.size) + 0.5) * c, y: g.y + (Math.floor(flag / s0.size) + 0.5) * c };
        ctx.save();
        ctx.globalAlpha = 1 - (1 - k) ** 3;
        tile(ctx, p.x - c * 0.45, p.y - c * 0.45, c * 0.9, c * 0.9, c * 0.18, null, C.warn, Math.max(2, c * 0.06));
        ctx.restore();
      }
    },
  };
}

const RINGS = board([['.', '.', '.'], ['.', '.', '.']], [0, 0, 'right'], [[1, 0, 'w'], [2, 1, 'w']]);
const DARKS = board([['.', '.', '.'], ['.', '.', '.']], [1, 0, 'down'], [[0, 1, 'w']], [[2, 1]]);

export const RULES: RuleCard[] = [
  {
    title: 'Mirrors',
    text: 'Tap an empty square, or drag a mirror there from the tray; it turns the beam through a right angle. Tap it to turn it, tap again to put it back, or drag it to another square.',
    good: picture(board([['.', '.', '.'], ['.', '.', '.']], [0, 1, 'right'], [[1, 0, 'w']]), 'Set a mirror', { tap: [1, 1], to: '/' }),
  },
  {
    title: 'Rings',
    text: 'Light every red ring to win. A red ring takes light of any color.',
    good: picture(RINGS, 'Every ring lit', { tap: [2, 0], to: '\\' }),
    bad: picture(RINGS, 'A ring left dark', { tap: [2, 0], to: '/', flag: [2, 1] }),
  },
  {
    title: 'The tray',
    text: 'The tray under the board holds exactly the pieces the answer needs. Only setting a piece down from the tray counts as a move; turning, moving or putting it back is free.',
    good: picture(board([['.', '.', '.'], ['.', '.', '.']], [0, 0, 'right'], [[2, 1, 'w']]), 'Every piece used', { tap: [2, 0], to: '\\' }),
  },
  {
    title: 'Fixed mirrors',
    text: 'Darker and hatched on the back, they are part of the board: they turn the beam too, but never move.',
    good: picture(board([['.', '.', 'F\\'], ['.', '.', '.']], [0, 0, 'right'], [[2, 1, 'w']]), 'Turns the beam'),
    bad: picture(board([['.', '.', 'F/'], ['.', '.', '.']], [0, 0, 'right'], [[2, 1, 'w']]), 'A tap does nothing', { tap: [2, 0], flag: [2, 0] }),
  },
  {
    title: 'Splitters',
    text: 'Half-silvered glass, dashed: the beam goes straight through and also turns, so one beam becomes two. Pick it in the tray, then tap a square.',
    good: picture(board([['.', '.', '.'], ['.', '.', '.']], [0, 1, 'right'], [[1, 0, 'w'], [2, 1, 'w']]), 'One beam becomes two', { tap: [1, 1], to: 'H/' }),
  },
  {
    title: 'Filters',
    text: 'White light leaves a filter tinted its color. Light of that color passes; any other color is absorbed.',
    good: picture(board([['Cs', 'Cs', 'F\\'], ['.', '.', '.']], [0, 0, 'right'], [[2, 1, 's']]), 'Same color passes'),
    bad: picture(board([['Cs', 'Cp', 'F\\'], ['.', '.', '.']], [0, 0, 'right'], [[2, 1, 's']]), 'Other color stops', { flag: [1, 0] }),
  },
  {
    title: 'Colored rings',
    text: 'A colored ring, with a small red heart, needs light of its own color.',
    good: picture(board([['.', 'Cp', 'F\\'], ['.', '.', '.']], [0, 0, 'right'], [[2, 1, 'p']]), 'Its own color'),
    bad: picture(board([['.', 'Cs', 'F\\'], ['.', '.', '.']], [0, 0, 'right'], [[2, 1, 'p']]), 'Wrong color: unlit', { flag: [2, 1] }),
  },
  {
    title: 'Dark sensors',
    text: 'Dark discs with a bar must stay unlit. A lit one flares amber and the puzzle is not solved.',
    good: picture(DARKS, 'Sensor stays dark', { tap: [1, 1], to: '/' }),
    bad: picture(DARKS, 'A sensor is lit', { tap: [1, 1], to: '\\', flag: [2, 1] }),
  },
  {
    title: 'Blockers',
    text: 'Gray blocks stop the beam.',
    good: picture(board([['.', '.', '.'], ['.', '#', '.']], [0, 1, 'right']), 'Stops the beam'),
  },
];
