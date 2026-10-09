// Drawing and touch for Field Lines: press the start node and drag along the
// grid; release on the end node to check the path.

import { adjacent, check, clearPath, cloneLines, edgeOf, extend, pathEdges, retract, same, solved, verdict, type LinesState, type Pt } from './lines';
import { ease, MONO, SUBSHELL_COLOURS, type Area, type Point, type PuzzleView } from './view';

const FLASH_MS = 600;
const GRAB = 0.45;

export class LinesView implements PuzzleView {
  private state: LinesState;
  private history: LinesState[] = [];
  private drawing = false;
  private pointer: Point | null = null;
  private flash = 0;
  private wonAt = 0;
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
  get clean(): boolean { return this.state.moves <= 1; }

  hint(): string {
    const s = this.state;
    if (this.won) return 'The line obeys every mark.';
    if (!s.path.length && s.moves === 0) return 'Press the <span class="hl">circle</span> and drag one line along the grid to the <span class="hl">tail</span>. Pass over every dot; keep each colour on its own side.';
    if (!s.path.length) return 'That line broke a rule. Draw again from the circle: every dot covered, colours never sharing a pocket.';
    const v = verdict(s, s.path);
    if (v.complete) return 'Release on the tail to check the line. Drag back along it to change it.';
    if (s.moves > 0) return 'Pick the line up where it ends, or press the circle to start over.';
    return 'Keep going to the tail. Dragging back over the line retracts it.';
  }

  restart(): void {
    this.state = cloneLines(this.initial);
    this.history = [];
    this.drawing = false;
    this.pointer = null;
    this.flash = 0;
    this.wonAt = 0;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.drawing = false;
    this.flash = 0;
    return true;
  }

  private remember(): void {
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
  }

  private judge(): void {
    this.remember();
    this.state = check(this.state);
    if (this.state.won) this.wonAt = performance.now();
    else this.flash = performance.now();
  }

  // ---- geometry ---------------------------------------------------------------------

  private layout(area: Area): void {
    const s = this.state;
    const c = Math.max(30, Math.min(90, Math.floor(Math.min((area.w - 56) / s.cols, (area.h - 64) / s.rows))));
    this.grid = { x: Math.round(area.x + (area.w - c * s.cols) / 2), y: Math.round(area.y + (area.h - c * s.rows) / 2 + 6), c };
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

  private tailDir(): Pt {
    const { end, cols, rows } = this.state;
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
    const last = s.path[s.path.length - 1];
    if (last && same(n, last)) {
      // Pick the line up where it ends.
      this.remember();
      this.drawing = true;
      this.pointer = p;
      return;
    }
    if (same(n, s.start)) {
      this.remember();
      this.state = { ...cloneLines(s), path: [{ ...s.start }] };
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
    const s = this.state;
    const last = s.path[s.path.length - 1];
    if (last && same(last, s.end)) this.judge();
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
      if (!st.path.length) st = extend(st, st.start) ?? st;
      const last = st.path[st.path.length - 1];
      const next = extend(st, { x: last.x + d.x, y: last.y + d.y });
      if (next) { this.remember(); this.state = next; }
      else this.flash = performance.now();
      return true;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      const last = s.path[s.path.length - 1];
      if (last && same(last, s.end)) this.judge();
      else this.flash = performance.now();
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
    const flashT = this.reduced ? 0 : Math.max(0, 1 - (now - this.flash) / FLASH_MS);
    const red = flashT > 0 || (this.reduced && now - this.flash < FLASH_MS);
    const path = s.path;
    const covered = pathEdges(path);
    const v = verdict(s, path);
    const live = v.complete;

    // Grid lines.
    ctx.strokeStyle = 'rgba(226, 220, 207, 0.18)';
    ctx.lineWidth = Math.max(1.5, c * 0.04);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let x = 0; x <= s.cols; x++) { const a = this.px({ x, y: 0 }), b = this.px({ x, y: s.rows }); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    for (let y = 0; y <= s.rows; y++) { const a = this.px({ x: 0, y }), b = this.px({ x: s.cols, y }); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    ctx.stroke();

    // Nodes.
    ctx.fillStyle = 'rgba(226, 220, 207, 0.3)';
    for (let x = 0; x <= s.cols; x++) for (let y = 0; y <= s.rows; y++) {
      const q = this.px({ x, y });
      ctx.beginPath();
      ctx.arc(q.x, q.y, Math.max(2, c * 0.05), 0, Math.PI * 2);
      ctx.fill();
    }

    // Coloured cells.
    const clash = new Set(red ? v.clashes : []);
    for (let i = 0; i < s.colours.length; i++) {
      const k = s.colours[i];
      if (!k) continue;
      const x = i % s.cols, y = Math.floor(i / s.cols);
      const q = this.px({ x, y });
      const side = c * 0.3;
      const lit = won || (live && !v.clashes.includes(i));
      ctx.save();
      ctx.globalAlpha = lit ? 1 : 0.45;
      if (lit && !this.reduced) { ctx.shadowColor = SUBSHELL_COLOURS[k]; ctx.shadowBlur = c * 0.2; }
      ctx.fillStyle = SUBSHELL_COLOURS[k];
      roundRect(ctx, q.x + (c - side) / 2, q.y + (c - side) / 2, side, side, side * 0.25);
      ctx.fill();
      ctx.restore();
      if (clash.has(i)) {
        ctx.strokeStyle = `rgba(224, 80, 58, ${0.9 * (this.reduced ? 1 : flashT)})`;
        ctx.lineWidth = 2;
        roundRect(ctx, q.x + c * 0.18, q.y + c * 0.18, c * 0.64, c * 0.64, c * 0.1);
        ctx.stroke();
      }
    }

    // Edge dots: small hexagons.
    for (const k of s.dots) {
      const [a, b] = edgeOf(k).map((p) => this.px(p));
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const on = covered.has(k);
      const miss = red && !on;
      ctx.fillStyle = miss ? `rgba(224, 80, 58, ${0.5 + 0.5 * (this.reduced ? 1 : flashT)})` : on ? 'rgba(248, 245, 238, 0.95)' : 'rgba(226, 220, 207, 0.4)';
      hexagon(ctx, m.x, m.y, Math.max(4, c * 0.1));
      ctx.fill();
    }

    // Start circle and end tail.
    const st = this.px(s.start);
    const begun = path.length > 0;
    ctx.fillStyle = begun ? 'rgba(248, 245, 238, 0.95)' : 'rgba(226, 220, 207, 0.4)';
    ctx.beginPath();
    ctx.arc(st.x, st.y, Math.max(8, c * 0.2), 0, Math.PI * 2);
    ctx.fill();
    const en = this.px(s.end);
    const td = this.tailDir();
    const reached = path.length > 0 && same(path[path.length - 1], s.end);
    ctx.strokeStyle = reached ? 'rgba(248, 245, 238, 0.95)' : 'rgba(226, 220, 207, 0.4)';
    ctx.lineWidth = Math.max(4, c * 0.13);
    ctx.beginPath();
    ctx.moveTo(en.x, en.y);
    ctx.lineTo(en.x + td.x * c * 0.32, en.y + td.y * c * 0.32);
    ctx.stroke();

    // The path: a soft glow under a bright core.
    if (path.length) {
      const pts = path.map((p) => this.px(p));
      const tip = this.drawing && this.pointer ? this.tipPoint(pts[pts.length - 1], path[path.length - 1]) : null;
      const trace = () => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y);
        if (tip) ctx.lineTo(tip.x, tip.y);
      };
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const wonT = won && !this.reduced ? ease((now - this.wonAt) / 500) : won ? 1 : 0;
      const core = red ? `rgba(224, 80, 58, ${0.6 + 0.4 * (this.reduced ? 1 : flashT)})` : 'rgba(248, 245, 238, 0.95)';
      ctx.save();
      ctx.strokeStyle = red ? 'rgba(224, 80, 58, 0.25)' : `rgba(243, 238, 226, ${0.18 + 0.2 * wonT})`;
      ctx.lineWidth = c * (0.3 + 0.1 * wonT);
      trace();
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = core;
      ctx.lineWidth = Math.max(4, c * 0.13);
      trace();
      ctx.stroke();
      if (reached && !won) {
        ctx.strokeStyle = core;
        ctx.beginPath();
        ctx.moveTo(en.x, en.y);
        ctx.lineTo(en.x + td.x * c * 0.32, en.y + td.y * c * 0.32);
        ctx.stroke();
      }
    }

    // A small count of marks still to meet, typed under the grid.
    if (!won) {
      ctx.font = `11px ${MONO}`;
      ctx.fillStyle = 'rgba(226, 220, 207, 0.45)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const dotsLeft = s.dots.filter((k) => !covered.has(k)).length;
      ctx.fillText(`${s.dots.length - dotsLeft}/${s.dots.length} dots`, area.x + area.w / 2, this.grid.y + c * s.rows + c * 0.4);
    }
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

function hexagon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
