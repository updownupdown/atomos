// Drawing and touch for Field Lines: press a start bead and drag along the
// channels between the tiles; let go on an end to check the line. Arrows draw
// from the keyboard, Enter checks, Backspace steps back, Escape clears.

import { adjacent, check, clearPath, cloneLines, edgeKey, edgeOf, extend, isEnd, isStart, pathEdges, retract, same, solved, verdict, type LinesState, type Mark, type Pt } from './lines';
import { bead, C, fitGrid, tile } from './palette';
import { ease, type Area, type Point, type PuzzleView } from './view';

const FLASH_MS = 700;
const GRAB = 0.45;

interface Failure {
  /** The state the failure belongs to; any edit retires it. */
  state: LinesState;
  failed: number[];
  missed: string[];
  at: number;
}

export const INSTRUCTIONS = `
<h3>How to play</h3>
<p>Press a <b>start bead</b> and drag one unbroken line along the channels between the tiles. Let go on a red <b>end tail</b> at the rim and the line is checked against every mark on the board. The line can never touch itself.</p>
<p>Your line cuts the board into <b>pockets</b>: groups of tiles it walls off from each other (the rim counts as a wall). Most marks are about pockets.</p>
<ul>
  <li><b>Beads on a channel</b>: the line must run over every one.</li>
  <li><b>Broken channels</b>: the line cannot cross the break.</li>
  <li><b>Colored tiles</b>: no pocket may hold tiles of two colors. Wall the colors apart.</li>
  <li><b>Droplets</b> (one to three): the line runs along exactly that many of that tile's four sides.</li>
  <li><b>Colored rings</b>: a ring's pocket holds exactly two marks of its color, counting rings and colored tiles alike. Two blue rings together are happy; a blue ring with a blue tile is happy; a blue ring alone, or with two other blue marks, is not.</li>
  <li><b>Bead shapes</b>: the pocket holding a shape must be exactly that shape, the same way up, no rotating. Two shapes in one pocket must fit together to fill it exactly.</li>
</ul>
<p>Some boards have two starts or two ends; use whichever you like. Broken marks flash red after a check, and the line stays so you can fix it: drag back along it to retract, or press any point on it to carry on from there.</p>
<p>Keyboard: arrows draw from a start (Tab picks between two starts), Backspace steps back, Escape clears, Enter checks once the line reaches an end.</p>
<h3>In the game</h3>
<p>A facet puzzle. Grids grow from 4×4 tiles (H to K, z 1–19) to 5×5 (Ca to Cs, 20–55) and 6×6 (from Ba, 56). Rules arrive in bands so each one gets introduced on its own terms: beads and colors from H; droplets from Mg (12); breaks from Cr (24); rings from Kr (36); shapes from Sn (50). From Gd (64) every level draws one of the heavier rules (droplets, rings, shapes) plus one or two partners, with three-rule levels growing more common toward the end of the table; from Hg (80) about half the boards get a second start or a second end. Mark counts rise gently with the element.</p>
<p>Every level is read off a hidden random walk, so it always has an answer; any line that meets every mark wins, not only the hidden one. Par is one check: a line that wins the first time it is checked counts as clean. Each release on an end is one check (one move).</p>
`;

export class LinesView implements PuzzleView {
  private state: LinesState;
  private history: LinesState[] = [];
  private drawing = false;
  private pointer: Point | null = null;
  private failure: Failure | null = null;
  private wonAt = 0;
  private bumpAt = 0;
  private startPick = 0;
  private grid = { x: 0, y: 0, c: 40 };
  private reduced: boolean;

  constructor(private readonly initial: LinesState, reducedMotion: boolean) {
    this.state = cloneLines(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    if (this.won) return 'Every mark is met';
    const f = this.liveFailure();
    if (f) {
      const n = f.failed.length + f.missed.length;
      return n ? `${n} mark${n === 1 ? '' : 's'} broken` : 'Not a lawful line';
    }
    return '';
  }

  restart(): void {
    this.state = cloneLines(this.initial);
    this.history = [];
    this.drawing = false;
    this.pointer = null;
    this.failure = null;
    this.wonAt = 0;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.drawing = false;
    this.pointer = null;
    return true;
  }

  private remember(): void {
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
  }

  private liveFailure(): Failure | null {
    return this.failure && this.failure.state === this.state ? this.failure : null;
  }

  private judge(): void {
    const v = verdict(this.state, this.state.path);
    this.remember();
    this.state = check(this.state);
    if (this.state.won) this.wonAt = performance.now();
    else this.failure = { state: this.state, failed: v.failed, missed: v.missed, at: performance.now() };
  }

  // ---- geometry ---------------------------------------------------------------------

  private layout(area: Area): void {
    const s = this.state;
    // Room for the end tails and start beads round the rim: about 0.45 of a cell each side.
    const fit = fitGrid(area, s.cols + 0.9, s.rows + 0.9, { margin: 8, maxCell: 72 });
    const c = fit.cell;
    this.grid = { x: fit.x + 0.45 * c, y: fit.y + 0.45 * c, c };
  }

  private px(p: Pt): Point {
    return { x: this.grid.x + p.x * this.grid.c, y: this.grid.y + p.y * this.grid.c };
  }

  /** The node under a point, when close enough to grab. */
  private nodeAt(p: Point): Pt | null {
    const { x, y, c } = this.grid;
    const n = { x: Math.round((p.x - x) / c), y: Math.round((p.y - y) / c) };
    if (n.x < 0 || n.y < 0 || n.x > this.state.cols || n.y > this.state.rows) return null;
    const q = this.px(n);
    return Math.hypot(p.x - q.x, p.y - q.y) <= c * GRAB ? n : null;
  }

  private tailDir(end: Pt): Pt {
    const { cols, rows } = this.state;
    if (end.x === 0) return { x: -1, y: 0 };
    if (end.x === cols) return { x: 1, y: 0 };
    if (end.y === 0) return { x: 0, y: -1 };
    if (end.y === rows) return { x: 0, y: 1 };
    return { x: 0, y: -1 };
  }

  // ---- input ----------------------------------------------------------------------

  down(p: Point): void {
    if (this.won) return;
    const s = this.state;
    const n = this.nodeAt(p);
    if (!n) return;
    const at = s.path.findIndex((q) => same(q, n));
    if (at >= 0) {
      // Pick the line up at any point on it: the rest is lifted off.
      this.remember();
      if (at < s.path.length - 1) this.state = { ...cloneLines(s), path: s.path.slice(0, at + 1).map((q) => ({ ...q })) };
      this.drawing = true;
      this.pointer = p;
      return;
    }
    if (isStart(s, n)) {
      this.remember();
      this.state = { ...cloneLines(s), path: [{ ...n }] };
      this.drawing = true;
      this.pointer = p;
    }
  }

  move(p: Point): void {
    if (!this.drawing) return;
    this.pointer = p;
    const { c } = this.grid;
    // Step toward the pointer one node at a time, so a quick flick still lays a continuous line.
    for (let guard = 0; guard < 4; guard++) {
      const last = this.state.path[this.state.path.length - 1];
      if (!last) return;
      const q = this.px(last);
      const dx = p.x - q.x, dy = p.y - q.y;
      if (Math.abs(dx) < c * 0.55 && Math.abs(dy) < c * 0.55) return;
      const step = Math.abs(dx) > Math.abs(dy) ? { x: last.x + Math.sign(dx), y: last.y } : { x: last.x, y: last.y + Math.sign(dy) };
      const next = extend(this.state, step);
      if (!next) {
        // Blocked straight ahead: allow the other axis if the pointer has clearly left the line.
        const alt = Math.abs(dx) > Math.abs(dy) ? { x: last.x, y: last.y + Math.sign(dy) } : { x: last.x + Math.sign(dx), y: last.y };
        const alternative = (Math.abs(dx) > Math.abs(dy) ? Math.abs(dy) : Math.abs(dx)) > c * 0.55 ? extend(this.state, alt) : null;
        if (!alternative) return;
        this.state = alternative;
        continue;
      }
      this.state = next;
    }
  }

  up(p: Point): void {
    if (!this.drawing) return;
    this.move(p);
    this.drawing = false;
    this.pointer = null;
    const last = this.state.path[this.state.path.length - 1];
    if (last && this.state.path.length > 1 && isEnd(this.state, last)) this.judge();
  }

  cancel(): void {
    this.drawing = false;
    this.pointer = null;
  }

  key(e: KeyboardEvent): boolean {
    if (this.won) return false;
    const s = this.state;
    const dir: Record<string, Pt> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
    const d = dir[e.key];
    if (d) {
      e.preventDefault();
      let st = s;
      if (!st.path.length) st = extend(st, st.starts[this.startPick % st.starts.length]) ?? st;
      const last = st.path[st.path.length - 1];
      const next = extend(st, { x: last.x + d.x, y: last.y + d.y });
      if (next) { this.remember(); this.state = next; }
      else this.bumpAt = performance.now();
      return true;
    }
    if (e.key === 'Tab' && s.starts.length > 1 && !s.path.length) {
      e.preventDefault();
      this.startPick = (this.startPick + 1) % s.starts.length;
      return true;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const last = s.path[s.path.length - 1];
      if (last && s.path.length > 1 && isEnd(s, last)) this.judge();
      else this.bumpAt = performance.now();
      return true;
    }
    if (e.key === 'Backspace') {
      const next = retract(s);
      if (next) { this.remember(); this.state = next; }
      return true;
    }
    if (e.key === 'Escape') {
      const next = clearPath(s);
      if (next) { this.remember(); this.state = next; }
      return true;
    }
    return false;
  }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    this.layout(area);
    const s = this.state;
    const { c } = this.grid;
    const won = this.won;
    const path = s.path;
    const covered = pathEdges(path);
    const fail = this.liveFailure();
    // Broken marks flash, then settle to a steady red until the line changes.
    const pulse = fail ? (this.reduced ? 1 : 0.55 + 0.45 * Math.max(0, 1 - (now - fail.at) / FLASH_MS) * (0.5 + 0.5 * Math.cos(((now - fail.at) / 120) * Math.PI))) : 0;
    const failed = new Set(fail?.failed ?? []);
    const missed = new Set(fail?.missed ?? []);
    const wonT = won ? (this.reduced ? 1 : ease((now - this.wonAt) / 500)) : 0;
    const lw = Math.max(4, c * 0.12);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Tiles, with channels between them where the line runs.
    const inset = c * 0.1;
    for (let i = 0; i < s.cols * s.rows; i++) {
      const q = this.px({ x: i % s.cols, y: Math.floor(i / s.cols) });
      tile(ctx, q.x + inset, q.y + inset, c - inset * 2, c - inset * 2, c * 0.18, C.surface, null);
    }

    // Channels, broken where there is a gap.
    const gaps = new Set(s.gaps);
    ctx.strokeStyle = C.line2;
    ctx.lineWidth = Math.max(1.5, c * 0.045);
    ctx.beginPath();
    const channel = (a: Pt, b: Pt) => {
      const p = this.px(a), q = this.px(b);
      if (gaps.has(edgeKey(a, b))) {
        const f = 0.3; // the middle 40% is missing
        ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f);
        ctx.moveTo(q.x, q.y); ctx.lineTo(q.x + (p.x - q.x) * f, q.y + (p.y - q.y) * f);
      } else {
        ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
      }
    };
    for (let y = 0; y <= s.rows; y++) for (let x = 0; x <= s.cols; x++) {
      if (x < s.cols) channel({ x, y }, { x: x + 1, y });
      if (y < s.rows) channel({ x, y }, { x, y: y + 1 });
    }
    ctx.stroke();
    // Gap ends get small caps so the break reads as deliberate.
    ctx.fillStyle = C.line3;
    for (const k of s.gaps) {
      const [a, b] = edgeOf(k).map((p) => this.px(p));
      for (const [p, q] of [[a, b], [b, a]]) {
        ctx.beginPath();
        ctx.arc(p.x + (q.x - p.x) * 0.3, p.y + (q.y - p.y) * 0.3, Math.max(2, c * 0.045), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Cell marks.
    for (let i = 0; i < s.marks.length; i++) {
      const m = s.marks[i];
      if (!m) continue;
      const q = this.px({ x: i % s.cols + 0.5, y: Math.floor(i / s.cols) + 0.5 });
      if (failed.has(i)) {
        ctx.save();
        ctx.globalAlpha = pulse;
        tile(ctx, q.x - c * 0.36, q.y - c * 0.36, c * 0.72, c * 0.72, c * 0.16, null, C.bad, Math.max(1.5, c * 0.035));
        ctx.restore();
      }
      this.mark(ctx, m, q.x, q.y, c, won);
    }

    // Edge beads.
    for (const k of s.dots) {
      const [a, b] = edgeOf(k).map((p) => this.px(p));
      const on = covered.has(k);
      const r = Math.max(4, c * 0.09);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (missed.has(k)) bead(ctx, mx, my, r * 1.15, C.bad, { alpha: 0.5 + 0.5 * pulse, glow: this.reduced ? undefined : C.bad });
      else bead(ctx, mx, my, r, on ? C.silver : C.silverDim, { rim: on ? undefined : C.pewter, glow: on && !this.reduced ? C.silver : undefined });
    }

    // End tails: the goal, in the target red.
    const last = path[path.length - 1];
    for (const end of s.ends) {
      const en = this.px(end);
      const td = this.tailDir(end);
      const reached = !!last && same(last, end);
      ctx.strokeStyle = reached ? C.silver : C.target;
      ctx.globalAlpha = reached || won ? 1 : 0.85;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(en.x, en.y);
      ctx.lineTo(en.x + td.x * c * 0.32, en.y + td.y * c * 0.32);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Start beads.
    s.starts.forEach((st, k) => {
      const q = this.px(st);
      const begun = path.length > 0 && same(path[0], st);
      const picked = !path.length && s.starts.length > 1 && k === this.startPick % s.starts.length;
      bead(ctx, q.x, q.y, Math.max(8, c * 0.17), begun ? C.silver : C.silverDim, { rim: C.pewter, glow: begun && !this.reduced ? C.silver : undefined });
      // A halo ring marks it as a start, apart from the smaller beads on the channels.
      ctx.strokeStyle = picked ? C.accent : C.line3;
      ctx.lineWidth = Math.max(1, c * 0.025);
      ctx.beginPath();
      ctx.arc(q.x, q.y, Math.max(8, c * 0.17) + Math.max(3, c * 0.06), 0, Math.PI * 2);
      ctx.stroke();
    });

    // The line: a soft halo under a bright core.
    if (path.length) {
      const pts = path.map((p) => this.px(p));
      const tip = this.drawing && this.pointer ? this.tipPoint(pts[pts.length - 1], path[path.length - 1]) : null;
      const reached = !!last && isEnd(s, last) && path.length > 1;
      const trace = () => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y);
        if (tip) ctx.lineTo(tip.x, tip.y);
        if (reached && !tip) {
          const td = this.tailDir(last);
          const q = pts[pts.length - 1];
          ctx.lineTo(q.x + td.x * c * 0.32, q.y + td.y * c * 0.32);
        }
      };
      const red = !!fail;
      ctx.save();
      ctx.strokeStyle = red ? C.bad : C.silver;
      ctx.globalAlpha = red ? 0.22 : 0.12 + 0.18 * wonT;
      ctx.lineWidth = c * (0.28 + 0.1 * wonT);
      trace();
      ctx.stroke();
      ctx.restore();
      ctx.save();
      if (won && !this.reduced) { ctx.shadowColor = C.silver; ctx.shadowBlur = c * 0.25 * wonT; }
      ctx.strokeStyle = red ? C.bad : C.silver;
      ctx.globalAlpha = red ? 0.55 + 0.45 * pulse : 1;
      ctx.lineWidth = lw;
      trace();
      ctx.stroke();
      ctx.restore();
      // A nudge at the pen tip when a keyboard step was refused.
      const bump = this.reduced ? 0 : Math.max(0, 1 - (now - this.bumpAt) / 300);
      if (bump > 0) {
        const q = pts[pts.length - 1];
        ctx.strokeStyle = C.bad;
        ctx.globalAlpha = 0.8 * bump;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(q.x, q.y, c * (0.2 + 0.1 * (1 - bump)), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  /** One cell symbol, centerd on (x, y). */
  private mark(ctx: CanvasRenderingContext2D, m: Mark, x: number, y: number, c: number, won: boolean): void {
    const glow = won && !this.reduced;
    ctx.save();
    switch (m.type) {
      case 'color': {
        const side = c * 0.3;
        if (glow) { ctx.shadowColor = C[m.c]; ctx.shadowBlur = c * 0.2; }
        tile(ctx, x - side / 2, y - side / 2, side, side, side * 0.28, C[m.c]);
        break;
      }
      case 'pair': {
        if (glow) { ctx.shadowColor = C[m.c]; ctx.shadowBlur = c * 0.2; }
        ctx.strokeStyle = C[m.c];
        ctx.lineWidth = Math.max(2, c * 0.06);
        ctx.beginPath();
        ctx.arc(x, y, c * 0.13, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'count': {
        // Droplets: a bead with a drawn-up tip, in a row.
        const r = Math.max(2.5, c * 0.055);
        const gap = r * 2.9;
        for (let k = 0; k < m.n; k++) {
          const dx = x + (k - (m.n - 1) / 2) * gap, dy = y + r * 0.45;
          ctx.fillStyle = C.silver;
          ctx.beginPath();
          ctx.moveTo(dx, dy - r * 2.3);
          ctx.quadraticCurveTo(dx + r * 1.1, dy - r * 0.9, dx + r, dy);
          ctx.arc(dx, dy, r, 0, Math.PI);
          ctx.quadraticCurveTo(dx - r * 1.1, dy - r * 0.9, dx, dy - r * 2.3);
          ctx.fill();
        }
        break;
      }
      case 'shape': {
        // Beads joined by bonds, the shape's own outline in miniature.
        const w = Math.max(...m.cells.map((p) => p.x)) + 1, h = Math.max(...m.cells.map((p) => p.y)) + 1;
        const pitch = Math.min(c * 0.2, (c * 0.62) / Math.max(w, h));
        const ox = x - ((w - 1) * pitch) / 2, oy = y - ((h - 1) * pitch) / 2;
        const has = new Set(m.cells.map((p) => `${p.x},${p.y}`));
        ctx.strokeStyle = C.pewter;
        ctx.lineWidth = Math.max(1.5, pitch * 0.22);
        ctx.beginPath();
        for (const p of m.cells) {
          if (has.has(`${p.x + 1},${p.y}`)) { ctx.moveTo(ox + p.x * pitch, oy + p.y * pitch); ctx.lineTo(ox + (p.x + 1) * pitch, oy + p.y * pitch); }
          if (has.has(`${p.x},${p.y + 1}`)) { ctx.moveTo(ox + p.x * pitch, oy + p.y * pitch); ctx.lineTo(ox + p.x * pitch, oy + (p.y + 1) * pitch); }
        }
        ctx.stroke();
        for (const p of m.cells) bead(ctx, ox + p.x * pitch, oy + p.y * pitch, Math.max(2, pitch * 0.32), C.silverDim, { glow: glow ? C.silver : undefined });
        break;
      }
    }
    ctx.restore();
  }

  /** Where the live segment from the pen's last node should end: toward the pointer, along one axis. */
  private tipPoint(last: Point, node: Pt): Point | null {
    const p = this.pointer!;
    const c = this.grid.c;
    const dx = p.x - last.x, dy = p.y - last.y;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    const step = horizontal ? { x: node.x + Math.sign(dx), y: node.y } : { x: node.x, y: node.y + Math.sign(dy) };
    if (!adjacent(node, step) || !extend(this.state, step)) return null;
    const len = Math.min(c * 0.5, horizontal ? Math.abs(dx) : Math.abs(dy));
    return horizontal ? { x: last.x + Math.sign(dx) * len, y: last.y } : { x: last.x, y: last.y + Math.sign(dy) * len };
  }
}
