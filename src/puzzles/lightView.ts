// Drawing and touch for Light Routing: tap a mirror to flip it; the beam
// redraws at once. Arrows move a cursor, space or Enter flips under it.

import { cloneLight, differing, flip, solved, trace, type Dir, type LightState } from './light';
import { pebble } from './slideStopView';
import { MONO, type Area, type Point, type PuzzleView } from './view';

const GROW_MS = 220;
const DELTA: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export class LightView implements PuzzleView {
  private state: LightState;
  private history: LightState[] = [];
  private pressed: Point | null = null;
  private cursor: number;
  private flashAt = 0;
  private origin: Point = { x: 0, y: 0 };
  private cell = 40;
  private reduced: boolean;

  constructor(private readonly initial: LightState, reducedMotion: boolean) {
    this.state = cloneLight(initial);
    this.reduced = reducedMotion;
    this.cursor = initial.cells.findIndex((c) => c === '/' || c === '\\');
    if (this.cursor < 0) this.cursor = 0;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    if (this.won) return 'Every ring is lit.';
    if (this.state.moves === 0) return `<span class="hl">Tap a mirror</span> to flip it. The beam must cross every <span class="hl">red ring</span>; dark pebbles stop it.`;
    const n = differing(this.state).length;
    const on = new Set(trace(this.state).cells);
    const dark = this.state.targets.filter((t) => !on.has(t)).length;
    return `${dark} ring${dark === 1 ? '' : 's'} still dark. ${n === 1 ? 'One mirror is' : `${n} mirrors are`} off the planned route.`;
  }

  restart(): void {
    this.state = cloneLight(this.initial);
    this.history = [];
    this.flashAt = 0;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.flashAt = performance.now();
    return true;
  }

  private tryFlip(i: number): void {
    if (this.won) return;
    const next = flip(this.state, i);
    if (!next) return;
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.state = next;
    this.cursor = i;
    this.flashAt = performance.now();
  }

  private cellAt(p: Point): number {
    const cx = Math.floor((p.x - this.origin.x) / this.cell), cy = Math.floor((p.y - this.origin.y) / this.cell);
    if (cx < 0 || cy < 0 || cx >= this.state.size || cy >= this.state.size) return -1;
    return cy * this.state.size + cx;
  }

  down(p: Point): void { this.pressed = p; }
  move(): void { /* taps only */ }
  cancel(): void { this.pressed = null; }

  up(p: Point): void {
    const s = this.pressed;
    this.pressed = null;
    if (!s || Math.hypot(p.x - s.x, p.y - s.y) > 14) return;
    const i = this.cellAt(p);
    if (i >= 0) this.tryFlip(i);
  }

  key(e: KeyboardEvent): boolean {
    const n = this.state.size;
    const d: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (d[e.key]) {
      const x = Math.max(0, Math.min(n - 1, (this.cursor % n) + d[e.key][0]));
      const y = Math.max(0, Math.min(n - 1, Math.floor(this.cursor / n) + d[e.key][1]));
      this.cursor = y * n + x;
      return true;
    }
    if (e.key === ' ' || e.key === 'Enter') { this.tryFlip(this.cursor); return true; }
    if (e.key === 'Tab') {
      const mirrors = this.state.cells.map((c, i) => (c === '/' || c === '\\' ? i : -1)).filter((i) => i >= 0);
      if (mirrors.length) this.cursor = mirrors[(mirrors.indexOf(this.cursor) + 1) % mirrors.length];
      return true;
    }
    return false;
  }

  // ---- drawing --------------------------------------------------------------------

  private centre(i: number): Point {
    const n = this.state.size;
    return { x: this.origin.x + ((i % n) + 0.5) * this.cell, y: this.origin.y + (Math.floor(i / n) + 0.5) * this.cell };
  }

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const side = Math.min(area.w, area.h) * 0.84;
    this.cell = side / s.size;
    this.origin = { x: area.x + (area.w - side) / 2, y: area.y + (area.h - side) / 2 };
    const half = this.cell / 2;

    ctx.strokeStyle = 'rgba(226, 220, 207, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 1; k < s.size; k++) {
      ctx.moveTo(this.origin.x + k * this.cell, this.origin.y);
      ctx.lineTo(this.origin.x + k * this.cell, this.origin.y + side);
      ctx.moveTo(this.origin.x, this.origin.y + k * this.cell);
      ctx.lineTo(this.origin.x + side, this.origin.y + k * this.cell);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(226, 220, 207, 0.28)';
    ctx.strokeRect(this.origin.x, this.origin.y, side, side);

    // The source, a small lamp just outside the entry cell.
    const e = this.centre(s.entry);
    const [edx, edy] = DELTA[s.entryDir];
    const lamp = { x: e.x - edx * this.cell * 0.9, y: e.y - edy * this.cell * 0.9 };

    // The beam: a bright line with a soft glow, growing after a flip.
    const beam = trace(s);
    const pts: Point[] = [lamp];
    for (const i of beam.cells) pts.push(this.centre(i));
    const lastDir = beam.dirs[beam.dirs.length - 1] ?? s.entryDir;
    const lastCell = beam.cells[beam.cells.length - 1];
    if (beam.exits) {
      const last = lastCell === undefined ? e : this.centre(lastCell);
      const [dx, dy] = DELTA[lastDir];
      pts.push({ x: last.x + dx * this.cell * 0.9, y: last.y + dy * this.cell * 0.9 });
    } else if (lastCell !== undefined) {
      // Stopped at a blocker: reach to its edge.
      const last = this.centre(lastCell);
      const [dx, dy] = DELTA[lastDir];
      pts.push({ x: last.x + dx * half * 0.7, y: last.y + dy * half * 0.7 });
    } else {
      const [dx, dy] = DELTA[s.entryDir];
      pts.push({ x: lamp.x + dx * this.cell * 0.3, y: lamp.y + dy * this.cell * 0.3 });
    }
    const total = pts.reduce((acc, p, k) => (k ? acc + Math.hypot(p.x - pts[k - 1].x, p.y - pts[k - 1].y) : 0), 0);
    const t = this.reduced ? 1 : Math.min(1, (now - this.flashAt) / GROW_MS);
    const shown = polyline(pts, total * t);
    for (const [w, c, blur] of [[7, 'rgba(243, 238, 226, 0.14)', 10], [2.5, 'rgba(243, 238, 226, 0.95)', 0]] as [number, string, number][]) {
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(243, 238, 226, 0.8)';
      ctx.shadowBlur = blur;
      ctx.beginPath();
      shown.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.lineCap = 'butt';

    // The lamp itself.
    ctx.fillStyle = 'rgba(243, 238, 226, 0.95)';
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y, 4, 0, Math.PI * 2);
    ctx.fill();

    const on = new Set(beam.cells);
    const mirrorLen = half * 0.78;
    for (let i = 0; i < s.cells.length; i++) {
      const c = s.cells[i];
      const p = this.centre(i);
      if (c === '#') pebble(ctx, p.x, p.y, this.cell * 0.34, i * 3 + 11);
      else if (c === '/' || c === '\\') {
        const sign = c === '/' ? -1 : 1;
        if (i === this.cursor) {
          ctx.fillStyle = 'rgba(226, 220, 207, 0.07)';
          ctx.fillRect(p.x - half + 1, p.y - half + 1, this.cell - 2, this.cell - 2);
        }
        ctx.strokeStyle = on.has(i) ? 'rgba(243, 238, 226, 0.95)' : 'rgba(226, 220, 207, 0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x - mirrorLen, p.y - sign * mirrorLen);
        ctx.lineTo(p.x + mirrorLen, p.y + sign * mirrorLen);
        ctx.stroke();
      }
    }

    // Target rings: red, filled with a glow once lit.
    for (const tIdx of s.targets) {
      const p = this.centre(tIdx);
      const litNow = on.has(tIdx);
      ctx.strokeStyle = '#e0503a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, half * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      if (litNow) {
        ctx.fillStyle = 'rgba(224, 80, 58, 0.22)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, half * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.font = `11px ${MONO}`;
    ctx.fillStyle = 'rgba(226, 220, 207, 0.5)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${s.targets.filter((i) => on.has(i)).length}/${s.targets.length} lit`, this.origin.x, this.origin.y - 8);
  }
}

/** The first `len` pixels of a polyline. */
function polyline(pts: Point[], len: number): Point[] {
  const out: Point[] = [pts[0]];
  let left = len;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d <= left) { out.push(b); left -= d; continue; }
    const f = d ? left / d : 0;
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
    break;
  }
  return out;
}
