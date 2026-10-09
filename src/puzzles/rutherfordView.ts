// Drawing and touch for Rutherford Probe: a ring of 24 slots round a dark
// box. Tap a slot to fire; the result lands on the slot as a mark. Tap cells
// to mark the nucleus you deduce, then tap the submit chip (or press Enter).
// Tracks are only shown in full once the nucleus is found.

import { canSubmit, cloneRutherford, fire, markedCount, SIZE, SLOTS, slotEntry, slotUsed, submit, toggle, type Cell, type Probe, type RutherfordState } from './rutherford';
import { droplet, ease, MONO, type Area, type Point, type PuzzleView } from './view';

const FIRE_MS = 320;
const FLASH_MS = 420;
const TAP = 12;

export class RutherfordView implements PuzzleView {
  private state: RutherfordState;
  private history: RutherfordState[] = [];
  private pressed: Point | null = null;
  private cursor: Cell = { r: 0, c: 0 };
  private firedAt = 0;
  private flash = 0;
  private reduced: boolean;
  // Layout, refreshed every frame.
  private origin: Point = { x: 0, y: 0 };
  private cell = 40;
  private submitBox = { x: 0, y: 0, w: 0, h: 0 };

  constructor(private readonly initial: RutherfordState, reducedMotion: boolean) {
    this.state = cloneRutherford(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return this.state.won; }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.wrong === 0; }

  hint(): string {
    const s = this.state;
    const n = s.nucleus.length;
    if (this.won) return `Found: the nucleus is ${n} cells. The tracks show how every probe scattered.`;
    if (s.probes.length === 0) return `Tap a <span class="hl">slot</span> on the edge to fire a probe. A filled mark is a hit, a ring is a probe turned back, a pair of matching labels is where it went in and came out. The nucleus is <span class="hl">${n} joined cells</span>.`;
    if (canSubmit(s)) return `${n} cells marked. Tap <span class="hl">submit</span> or press Enter.`;
    if (s.wrong > 0 && markedCount(s) === 0) return 'Not that. Fire more probes, then mark again.';
    return `A probe turns 90° away from a nucleus cell on its diagonal. Tap cells to mark your guess: ${n} in all.`;
  }

  restart(): void {
    this.state = cloneRutherford(this.initial);
    this.history = [];
    this.firedAt = 0;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.firedAt = 0;
    return true;
  }

  private commit(next: RutherfordState | null): boolean {
    if (!next) {
      this.flash = performance.now();
      return false;
    }
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.state = next;
    return true;
  }

  private fireAt(slot: number): void {
    if (this.commit(fire(this.state, slot))) this.firedAt = performance.now();
  }

  private submitGuess(): void {
    const before = this.state.wrong;
    if (this.commit(submit(this.state)) && this.state.wrong > before) this.flash = performance.now();
  }

  // ---- geometry ---------------------------------------------------------------------

  private layout(area: Area): void {
    const units = SIZE + 2;
    const cell = Math.floor(Math.min(area.w - 16, area.h - 70) / units);
    this.cell = Math.max(24, cell);
    const side = this.cell * units;
    this.origin = { x: area.x + (area.w - side) / 2 + this.cell, y: area.y + 14 + (area.h - 56 - side) / 2 + this.cell };
    const w = Math.max(96, this.cell * 2.4), h = Math.max(36, this.cell * 0.9);
    this.submitBox = { x: area.x + (area.w - w) / 2, y: this.origin.y + side - this.cell + 10, w, h };
  }

  private cellCentre(c: Cell): Point {
    return { x: this.origin.x + (c.c + 0.5) * this.cell, y: this.origin.y + (c.r + 0.5) * this.cell };
  }

  /** Slots sit on the ring of cells just outside the box. */
  private slotCentre(slot: number): Point {
    return this.cellCentre(slotEntry(slot).pos);
  }

  private slotAt(p: Point): number | null {
    for (let s = 0; s < SLOTS; s++) {
      const q = this.slotCentre(s);
      if (Math.abs(p.x - q.x) <= this.cell / 2 && Math.abs(p.y - q.y) <= this.cell / 2) return s;
    }
    return null;
  }

  private cellAt(p: Point): Cell | null {
    const c = Math.floor((p.x - this.origin.x) / this.cell), r = Math.floor((p.y - this.origin.y) / this.cell);
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null;
    return { r, c };
  }

  private onSubmit(p: Point): boolean {
    const b = this.submitBox;
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  }

  // ---- input ----------------------------------------------------------------------

  down(p: Point): void { this.pressed = p; }
  move(): void { /* taps only */ }
  cancel(): void { this.pressed = null; }

  up(p: Point): void {
    const s = this.pressed;
    this.pressed = null;
    if (!s || this.won) return;
    if (Math.hypot(p.x - s.x, p.y - s.y) > TAP) return;
    const cell = this.cellAt(p);
    if (cell) { this.cursor = cell; this.commit(toggle(this.state, cell)); return; }
    const slot = this.slotAt(p);
    if (slot !== null) { this.fireAt(slot); return; }
    if (this.onSubmit(p)) this.submitGuess();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === 'Enter') { this.submitGuess(); return true; }
    if (e.key === ' ') { this.commit(toggle(this.state, this.cursor)); return true; }
    const d: Record<string, Cell> = { ArrowUp: { r: -1, c: 0 }, ArrowDown: { r: 1, c: 0 }, ArrowLeft: { r: 0, c: -1 }, ArrowRight: { r: 0, c: 1 } };
    if (d[e.key]) {
      this.cursor = { r: Math.max(0, Math.min(SIZE - 1, this.cursor.r + d[e.key].r)), c: Math.max(0, Math.min(SIZE - 1, this.cursor.c + d[e.key].c)) };
      return true;
    }
    return false;
  }

  // ---- drawing --------------------------------------------------------------------

  /** The full path of a probe as points: entry slot, every cell crossed, and where it ended. */
  private trackPoints(p: Probe): Point[] {
    const pts = [this.slotCentre(p.slot), ...p.track.map((c) => this.cellCentre(c))];
    const o = p.outcome;
    if (o.kind === 'pass') pts.push(this.slotCentre(o.exit));
    else if (o.kind === 'reflect') pts.push(this.slotCentre(p.slot));
    return pts;
  }

  private strokePath(ctx: CanvasRenderingContext2D, pts: Point[], upTo: number): void {
    if (pts.length < 2) return;
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    let left = total * upTo;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length && left > 0; i++) {
      const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      const f = Math.min(1, left / Math.max(1e-6, len));
      ctx.lineTo(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f);
      left -= len;
    }
    ctx.stroke();
  }

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    this.layout(area);
    const s = this.state;
    const cs = this.cell;
    const flash = now - this.flash < FLASH_MS;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // The box: faint dashed cells.
    ctx.strokeStyle = 'rgba(226, 220, 207, 0.16)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        ctx.strokeRect(this.origin.x + c * cs + 0.5, this.origin.y + r * cs + 0.5, cs - 1, cs - 1);
      }
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(226, 220, 207, 0.3)';
    ctx.strokeRect(this.origin.x + 0.5, this.origin.y + 0.5, SIZE * cs - 1, SIZE * cs - 1);

    // Slots: a small tick on each unused one.
    for (let slot = 0; slot < SLOTS; slot++) {
      if (slotUsed(s, slot)) continue;
      const q = this.slotCentre(slot);
      ctx.fillStyle = 'rgba(226, 220, 207, 0.3)';
      ctx.beginPath();
      ctx.arc(q.x, q.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tracks: a streak at the ends of each probe while playing, the whole path once found.
    const last = s.probes[s.probes.length - 1];
    s.probes.forEach((p) => {
      const pts = this.trackPoints(p);
      const fresh = p === last && !this.reduced && now - this.firedAt < FIRE_MS;
      const t = fresh ? ease((now - this.firedAt) / FIRE_MS) : 1;
      ctx.lineWidth = 1;
      if (this.won) {
        ctx.strokeStyle = 'rgba(226, 220, 207, 0.45)';
        this.strokePath(ctx, pts, 1);
        return;
      }
      // Entry streak: from the slot into the first cell; for a pass, the same at the exit.
      const streak = (a: Point, b: Point, f: number) => {
        ctx.strokeStyle = `rgba(226, 220, 207, ${0.35 + 0.4 * (fresh ? 1 - t : 0)})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
        ctx.stroke();
      };
      const entry = this.slotCentre(p.slot);
      const inward = this.cellCentre(slotEntry(p.slot).pos);
      const dir = slotEntry(p.slot).dir;
      const into = { x: inward.x + dir.c * cs * 0.9, y: inward.y + dir.r * cs * 0.9 };
      streak(entry, into, Math.min(1, t * 2));
      if (p.outcome.kind === 'pass' && t > 0.5) {
        const ex = this.slotCentre(p.outcome.exit);
        const ed = slotEntry(p.outcome.exit).dir;
        const from = { x: ex.x + ed.c * cs * 0.9, y: ex.y + ed.r * cs * 0.9 };
        streak(from, ex, (t - 0.5) * 2);
      }
    });

    // Marks on the slots.
    for (const p of s.probes) {
      const q = this.slotCentre(p.slot);
      const r = Math.max(7, cs * 0.22);
      if (p.outcome.kind === 'hit') {
        ctx.fillStyle = 'rgba(226, 220, 207, 0.9)';
        ctx.beginPath();
        ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.outcome.kind === 'reflect') {
        ctx.strokeStyle = 'rgba(226, 220, 207, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        for (const at of [q, this.slotCentre(p.outcome.exit)]) {
          ctx.fillStyle = 'rgba(16, 16, 16, 0.9)';
          ctx.strokeStyle = 'rgba(226, 220, 207, 0.6)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(at.x, at.y, r + 1, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.font = `${Math.max(10, Math.round(cs * 0.3))}px ${MONO}`;
          ctx.fillStyle = 'rgba(243, 238, 226, 0.95)';
          ctx.fillText(String(p.label), at.x, at.y + 1);
        }
      }
    }

    // The player's marks, and the keyboard cursor.
    const mr = Math.max(5, cs * 0.18);
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const q = this.cellCentre({ r, c });
        if (s.marks[r * SIZE + c] && !this.won) {
          ctx.strokeStyle = flash ? 'rgba(224, 80, 58, 0.95)' : 'rgba(226, 220, 207, 0.85)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(q.x, q.y, mr, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = flash ? 'rgba(224, 80, 58, 0.5)' : 'rgba(226, 220, 207, 0.25)';
          ctx.fill();
        }
        if (r === this.cursor.r && c === this.cursor.c && !this.won) {
          ctx.strokeStyle = 'rgba(226, 220, 207, 0.35)';
          ctx.lineWidth = 1;
          ctx.strokeRect(this.origin.x + c * cs + 3.5, this.origin.y + r * cs + 3.5, cs - 7, cs - 7);
        }
      }
    }

    // The nucleus, once found: warm droplets.
    if (this.won) {
      for (const n of s.nucleus) {
        const q = this.cellCentre(n);
        const g = ctx.createRadialGradient(q.x - cs * 0.1, q.y - cs * 0.1, 0, q.x, q.y, cs * 0.34);
        g.addColorStop(0, 'rgba(250, 215, 160, 1)');
        g.addColorStop(0.7, 'rgba(240, 190, 120, 0.95)');
        g.addColorStop(1, 'rgba(190, 130, 70, 0.9)');
        ctx.shadowColor = 'rgba(240, 190, 120, 0.8)';
        ctx.shadowBlur = cs * 0.4;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(q.x, q.y, cs * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    } else {
      // Submit chip, lit when the count is right.
      const b = this.submitBox;
      const ready = canSubmit(s);
      ctx.strokeStyle = ready ? '#e0503a' : 'rgba(226, 220, 207, 0.25)';
      ctx.lineWidth = ready ? 1.5 : 1;
      ctx.beginPath();
      ctx.roundRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, b.h / 2);
      ctx.stroke();
      ctx.font = `12px ${MONO}`;
      ctx.fillStyle = ready ? 'rgba(243, 238, 226, 0.95)' : 'rgba(226, 220, 207, 0.4)';
      ctx.fillText(`submit ${markedCount(s)}/${s.nucleus.length}`, b.x + b.w / 2, b.y + b.h / 2 + 1);
      if (ready) droplet(ctx, b.x + 14, b.y + b.h / 2, 4, true);
    }
  }
}
