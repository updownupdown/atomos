// Drawing and touch for Shell Rings: drag round a ring to turn it, tap the
// electron at the gate to hop it inward, or drag it outward to hop out.

import { applyMove, canHop, cloneRings, inverse, solved, topSlot, type RingMove, type RingsState } from './rings';
import { droplet, ease, MONO, SUBSHELL_COLOURS, type Area, type Point, type PuzzleView } from './view';

const SNAP_MS = 140;
const TAP = 9;

interface Drag {
  ring: number;
  start: Point;
  a0: number;
  r0: number;
  /** Accumulated turn in radians since the press. */
  turn: number;
  last: number;
  moved: number;
  onGate: boolean;
}

export class RingsView implements PuzzleView {
  private state: RingsState;
  private history: RingsState[] = [];
  private drag: Drag | null = null;
  private selected = 0;
  /** Visual rotation per ring in slot units; eases toward the state's rot after a snap. */
  private shown: { from: number; to: number; at: number }[];
  private centre: Point = { x: 0, y: 0 };
  private radii: number[] = [];
  private flash = 0;
  private reduced: boolean;

  constructor(private readonly initial: RingsState, reducedMotion: boolean) {
    this.state = cloneRings(initial);
    this.shown = initial.rings.map((r) => ({ from: r.rot, to: r.rot, at: 0 }));
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    if (this.won) return 'Every socket lit: this is the ground state.';
    const gate = this.state.rings.findIndex((r) => r.cells[topSlot(r)]);
    if (this.state.moves === 0) return '<span class="hl">Drag round a ring</span> to turn it. An electron at the <span class="hl">gate</span> on top can hop to the next ring: tap to hop in, drag out to hop out.';
    if (gate >= 0 && (canHop(this.state, gate, false) || canHop(this.state, gate, true))) return 'An electron is at the gate. Tap it to hop inward, or drag it outward.';
    return 'Fill the lit sockets. Spare electrons wait on the outer ring.';
  }

  restart(): void {
    this.state = cloneRings(this.initial);
    this.history = [];
    this.shown = this.state.rings.map((r) => ({ from: r.rot, to: r.rot, at: 0 }));
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.snapAll();
    return true;
  }

  private apply(m: RingMove): boolean {
    const next = applyMove(this.state, m);
    if (!next) {
      this.flash = performance.now();
      return false;
    }
    this.history.push(this.state);
    if (this.history.length > 80) this.history.shift();
    this.state = next;
    return true;
  }

  private snapAll(): void {
    const now = performance.now();
    this.state.rings.forEach((r, i) => {
      const cur = this.visualRot(i, now);
      this.shown[i] = { from: cur, to: nearestEquivalent(cur, r.rot, r.slots), at: now };
    });
  }

  /** The rotation drawn for a ring right now, in slot units. */
  private visualRot(i: number, now: number): number {
    const s = this.shown[i];
    if (this.drag && this.drag.ring === i) return s.to + (this.drag.turn * this.state.rings[i].slots) / (2 * Math.PI);
    const t = this.reduced ? 1 : (now - s.at) / SNAP_MS;
    return s.from + (s.to - s.from) * ease(t);
  }

  private hop(ring: number, outward: boolean | null): void {
    if (outward === null) {
      if (canHop(this.state, ring, false)) outward = false;
      else if (canHop(this.state, ring, true)) outward = true;
      else { this.flash = performance.now(); return; }
    }
    this.apply({ kind: 'hop', ring, outward });
  }

  // ---- geometry ---------------------------------------------------------------------

  private layout(area: Area): void {
    const n = this.state.rings.length;
    const R = (Math.min(area.w, area.h) / 2) * 0.9;
    this.centre = { x: area.x + area.w / 2, y: area.y + area.h / 2 + 6 };
    this.radii = this.state.rings.map((_, i) => (n === 1 ? R : R * (0.3 + (0.7 * i) / (n - 1))));
  }

  private slotPoint(ring: number, slot: number, now: number): Point {
    const r = this.state.rings[ring];
    const a = -Math.PI / 2 + ((this.visualRot(ring, now) + slot) * 2 * Math.PI) / r.slots;
    return { x: this.centre.x + Math.cos(a) * this.radii[ring], y: this.centre.y + Math.sin(a) * this.radii[ring] };
  }

  private nearestRing(p: Point): number {
    const d = Math.hypot(p.x - this.centre.x, p.y - this.centre.y);
    let best = 0;
    this.radii.forEach((r, i) => { if (Math.abs(d - r) < Math.abs(d - this.radii[best])) best = i; });
    return best;
  }

  private gateElectronAt(p: Point, now: number): number | null {
    for (let i = 0; i < this.state.rings.length; i++) {
      const r = this.state.rings[i];
      if (!r.cells[topSlot(r)]) continue;
      const q = this.slotPoint(i, topSlot(r), now);
      if (Math.hypot(p.x - q.x, p.y - q.y) < 26) return i;
    }
    return null;
  }

  // ---- input ----------------------------------------------------------------------

  down(p: Point): void {
    if (this.won) return;
    const now = performance.now();
    const gate = this.gateElectronAt(p, now);
    const ring = gate ?? this.nearestRing(p);
    this.selected = ring;
    this.drag = {
      ring, start: p, a0: Math.atan2(p.y - this.centre.y, p.x - this.centre.x), r0: Math.hypot(p.x - this.centre.x, p.y - this.centre.y),
      turn: 0, last: Math.atan2(p.y - this.centre.y, p.x - this.centre.x), moved: 0, onGate: gate !== null,
    };
  }

  move(p: Point): void {
    const d = this.drag;
    if (!d) return;
    d.moved = Math.max(d.moved, Math.hypot(p.x - d.start.x, p.y - d.start.y));
    const a = Math.atan2(p.y - this.centre.y, p.x - this.centre.x);
    let da = a - d.last;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    d.last = a;
    // A press on the gate electron is a hop until it clearly travels round the ring.
    const radial = Math.abs(Math.hypot(p.x - this.centre.x, p.y - this.centre.y) - d.r0);
    if (d.onGate && radial > d.moved * 0.6) return;
    d.turn += da;
  }

  up(p: Point): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const now = performance.now();
    const ring = this.state.rings[d.ring];
    const steps = Math.round((d.turn * ring.slots) / (2 * Math.PI));
    if (d.onGate) {
      const dr = Math.hypot(p.x - this.centre.x, p.y - this.centre.y) - d.r0;
      if (d.moved < TAP) this.hop(d.ring, null);
      else if (Math.abs(dr) > 16 && Math.abs(steps) === 0) this.hop(d.ring, dr > 0);
      else if (steps) this.apply({ kind: 'rotate', ring: d.ring, steps });
    } else if (steps) {
      this.apply({ kind: 'rotate', ring: d.ring, steps });
    }
    this.state.rings.forEach((r, i) => {
      const cur = i === d.ring ? this.shown[i].to + (d.turn * r.slots) / (2 * Math.PI) : this.visualRot(i, now);
      this.shown[i] = { from: cur, to: nearestEquivalent(cur, r.rot, r.slots), at: now };
    });
  }

  cancel(): void {
    this.drag = null;
    this.snapAll();
  }

  key(e: KeyboardEvent): boolean {
    const n = this.state.rings.length;
    if (/^[1-9]$/.test(e.key) && Number(e.key) <= n) { this.selected = Number(e.key) - 1; return true; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      this.apply({ kind: 'rotate', ring: this.selected, steps: e.key === 'ArrowRight' ? 1 : -1 });
      this.snapAll();
      return true;
    }
    if (e.key === 'ArrowUp') { this.hop(this.selected, true); return true; }
    if (e.key === 'ArrowDown') { this.hop(this.selected, false); return true; }
    if (e.key === ' ' || e.key === 'Enter') { this.hop(this.selected, null); return true; }
    if (e.key === 'Tab') { this.selected = (this.selected + 1) % n; return true; }
    return false;
  }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    this.layout(area);
    const rings = this.state.rings;
    const outer = this.radii[this.radii.length - 1];
    const inner = this.radii[0];
    const dot = Math.max(6, Math.min(11, (2 * Math.PI * inner) / rings[0].slots / 4));

    // The gate: a notch running through every ring at the top.
    const flash = now - this.flash < 220;
    ctx.strokeStyle = flash ? 'rgba(224, 80, 58, 0.9)' : 'rgba(226, 220, 207, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.centre.x, this.centre.y - inner + dot + 8);
    ctx.lineTo(this.centre.x, this.centre.y - outer - dot - 10);
    ctx.stroke();
    ctx.fillStyle = flash ? '#e0503a' : 'rgba(226, 220, 207, 0.7)';
    ctx.beginPath();
    ctx.moveTo(this.centre.x - 5, this.centre.y - outer - dot - 18);
    ctx.lineTo(this.centre.x + 5, this.centre.y - outer - dot - 18);
    ctx.lineTo(this.centre.x, this.centre.y - outer - dot - 11);
    ctx.closePath();
    ctx.fill();

    rings.forEach((r, i) => {
      const rad = this.radii[i];
      const held = (this.drag && this.drag.ring === i) || (!this.drag && this.selected === i);
      ctx.strokeStyle = held ? 'rgba(226, 220, 207, 0.45)' : 'rgba(226, 220, 207, 0.18)';
      ctx.lineWidth = held ? 1.5 : 1;
      ctx.setLineDash(r.sockets.some(Boolean) ? [] : [2, 6]);
      ctx.beginPath();
      ctx.arc(this.centre.x, this.centre.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Shell number, typed at the ring's lower left.
      ctx.font = `11px ${MONO}`;
      ctx.fillStyle = 'rgba(226, 220, 207, 0.5)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const la = Math.PI * 0.75;
      ctx.fillText(`n=${r.n}`, this.centre.x + Math.cos(la) * (rad + 12), this.centre.y + Math.sin(la) * (rad + 12));

      // Empty slots as faint ticks, sockets as coloured rings, electrons as droplets.
      for (let s = 0; s < r.slots; s++) {
        const p = this.slotPoint(i, s, now);
        const kind = r.sockets[s];
        if (kind) {
          ctx.strokeStyle = SUBSHELL_COLOURS[kind];
          ctx.lineWidth = 1.5;
          ctx.setLineDash(r.cells[s] ? [] : [2, 3]);
          ctx.beginPath();
          ctx.arc(p.x, p.y, dot + 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          if (!r.cells[s]) {
            ctx.fillStyle = SUBSHELL_COLOURS[kind] + '33';
            ctx.beginPath();
            ctx.arc(p.x, p.y, dot + 4, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (!r.cells[s]) {
          ctx.fillStyle = 'rgba(226, 220, 207, 0.22)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
        if (r.cells[s]) {
          const atGate = s === topSlot(r) && !this.drag;
          droplet(ctx, p.x, p.y, dot, atGate);
          if (atGate && !this.won) {
            // Which way it can hop.
            const arrow = (dir: -1 | 1) => {
              const y = p.y + dir * (dot + 9);
              ctx.fillStyle = 'rgba(243, 238, 226, 0.85)';
              ctx.beginPath();
              ctx.moveTo(p.x - 4, y - dir * 4);
              ctx.lineTo(p.x + 4, y - dir * 4);
              ctx.lineTo(p.x, y + dir * 2);
              ctx.closePath();
              ctx.fill();
            };
            if (canHop(this.state, i, false)) arrow(1);
            if (canHop(this.state, i, true)) arrow(-1);
          }
        }
      }
    });

    // The nucleus at the centre: a warm point, bigger as the atom grows.
    const g = ctx.createRadialGradient(this.centre.x, this.centre.y, 0, this.centre.x, this.centre.y, 10);
    g.addColorStop(0, 'rgba(240, 190, 120, 0.95)');
    g.addColorStop(1, 'rgba(240, 190, 120, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.centre.x, this.centre.y, 10, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The copy of `target` (mod slots) closest to `cur`, so a snap never spins the long way round. */
function nearestEquivalent(cur: number, target: number, slots: number): number {
  let t = target;
  while (t - cur > slots / 2) t -= slots;
  while (cur - t > slots / 2) t += slots;
  return t;
}

export { inverse };
