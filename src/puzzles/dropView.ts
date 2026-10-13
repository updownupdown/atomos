// Drawing and touch for Drop: the current cluster hangs over an open well; drag it (or tap a
// column) and let go, and it falls straight down. Tap the hanging cluster to turn it. The next
// few clusters wait in a row above. A cluster is a dark rounded blob with one nucleon in each
// cell: protons red with a plus, neutrons blue-gray. A dotted outline shows where the hanging
// cluster would land, in amber when that would seal a gap. Sealed gaps are outlined in amber.
//
// The board is painted by `paintDrop`, which the rule cards' pictures share.

import { boxH, boxW, cloneDrop, current, drop, DropSolver, landing, rotate, sealed, slide, solved, turned, type Cell, type DropState, type Piece } from './drop';
import { bead, C, font, socket } from './palette';
import { drawFrame, framePad, frameWidth } from './frame';
import { drawHelpMark, ease, undoHelp, type Area, type Help, type Illustration, type Point, type PuzzleView, type RuleCard, type Stat, type ViewAction } from './view';

export const INSTRUCTIONS = `
<section class="how-specs"><h3>Specs</h3><ul>
<li><b>Flawless:</b> Fill the well in par moves or fewer, where every drop and every quarter turn is a move and par is one drop per cluster plus the fewest turns any answer needs, and without Show me.</li>
<li><b>Board:</b> The well grows from 4 wide and 3 deep on Very easy to 6 by 6 on Hard and 7 wide by 5 deep on Expert, and the clusters from mostly ones, twos and threes to mostly fours.</li>
<li><b>Queue:</b> On Very easy boards the whole queue is in view and every cluster comes the right way up. From Easy on, clusters come turned at random and the queue shows four ahead, then three, then two.</li>
<li><b>Built:</b> Every deal is built by filling the well with clusters that each land flush, so it can always be filled.</li>
<li><b>Difficulty:</b> Harder deals are kept only when they hold enough drops that look fine but leave the well impossible to finish.</li>
<li><b>Par:</b> One move per drop plus the fewest turns any answer needs, found by searching every way the surface of the well can grow.</li>
<li><b>Where it's played:</b> Well is a reserve game, played from the Puzzles screen.</li>
</ul></section>
`;

const PROTON = '#e0583f';
const NEUTRON = '#6f87a3';
const BODY = '#2b3035';
const BODY_LIVE = '#2f4a52';

/** Where everything sits: the cell size, the well's top-left, the hanging row and the queue. */
interface Layout { c: number; x: number; y: number; hang: number; queueY: number; pc: number; queueX: number }

/** The tallest a cluster of the deal stands, any way up: the room the hanging row needs. */
function reach(s: DropState): number {
  return Math.max(1, ...s.pieces.map((p) => Math.max(boxW(p.cells), boxH(p.cells))));
}

/** The pieces the queue shows after the current one. */
function queued(s: DropState): number[] {
  const out: number[] = [];
  for (let i = s.next + 1; i < s.pieces.length && out.length < s.preview; i++) out.push(i);
  return out;
}

export function layoutDrop(area: Area, s: DropState, o: { queue: boolean; margin?: number }): Layout {
  const margin = o.margin ?? 8;
  const rows = s.depth + reach(s) + 0.35 + (o.queue ? 2.1 : 0);
  // The frame's stroke and padding stand outside the well's cells.
  let c = Math.min((area.w - margin * 2) / (s.width + 0.6), (area.h - margin * 2) / (rows + 0.4), 64);
  c = Math.min(c, (area.w - margin * 2 - 2 * (framePad(c) + frameWidth(c))) / s.width, (area.h - margin * 2 - framePad(c) - frameWidth(c)) / rows);
  c = Math.max(4, c);
  const totalH = rows * c + framePad(c) + frameWidth(c) / 2;
  const top = area.y + (area.h - totalH) / 2;
  const x = area.x + (area.w - s.width * c) / 2;
  const queueY = top;
  const hang = top + (o.queue ? 2.1 * c : 0) + reach(s) * c;
  const y = hang + 0.35 * c;
  // The queue's cells: small enough that every shown cluster fits across the area.
  const shown = queued(s);
  const span = shown.reduce((a, i) => a + boxW(s.pieces[i].cells) + 0.8, 0);
  const pc = Math.max(3, Math.min((c * 1.7) / Math.max(2, reach(s)), (area.w - margin * 2) / Math.max(1, span)));
  const queueX = area.x + (area.w - span * pc + 0.8 * pc) / 2;
  return { c, x, y, hang, queueY, pc, queueX };
}

/** One cluster: a blob over its cells with a nucleon in each. `live` tints the blob as the one
 *  in hand. Cells are drawn at (x + cx * c, y + cy * c). */
export function cluster(ctx: CanvasRenderingContext2D, piece: Piece, cells: Cell[], x: number, y: number, c: number, o: { live?: boolean; alpha?: number; glow?: boolean; squash?: number } = {}): void {
  const inset = Math.max(1, c * 0.06);
  const r = c * 0.24;
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.fillStyle = o.live ? BODY_LIVE : BODY;
  const set = new Set(cells.map(([cx, cy]) => `${cx},${cy}`));
  ctx.beginPath();
  for (const [cx, cy] of cells) ctx.roundRect(x + cx * c + inset, y + cy * c + inset, c - inset * 2, c - inset * 2, r);
  ctx.fill();
  // Bridges where two cells of the cluster meet, so it reads as one piece.
  ctx.beginPath();
  for (const [cx, cy] of cells) {
    if (set.has(`${cx + 1},${cy}`)) ctx.rect(x + (cx + 0.5) * c, y + cy * c + c * 0.22, c, c * 0.56);
    if (set.has(`${cx},${cy + 1}`)) ctx.rect(x + cx * c + c * 0.22, y + (cy + 0.5) * c, c * 0.56, c);
  }
  ctx.fill();
  ctx.restore();
  const sq = o.squash ?? 0;
  cells.forEach(([cx, cy], i) => {
    const px = x + (cx + 0.5) * c, py = y + (cy + 0.5) * c + sq * c * 0.06;
    const proton = piece.protons[i];
    const rr = c * 0.27;
    bead(ctx, px, py, rr, proton ? PROTON : NEUTRON, { alpha: o.alpha, glow: o.glow ? (proton ? PROTON : NEUTRON) : undefined });
    if (proton && c >= 10) {
      ctx.save();
      ctx.globalAlpha = o.alpha ?? 1;
      ctx.strokeStyle = 'rgba(16, 17, 18, 0.75)';
      ctx.lineWidth = Math.max(1.2, c * 0.06);
      ctx.lineCap = 'round';
      const k = rr * 0.5;
      ctx.beginPath();
      ctx.moveTo(px - k, py); ctx.lineTo(px + k, py);
      ctx.moveTo(px, py - k); ctx.lineTo(px, py + k);
      ctx.stroke();
      ctx.restore();
    }
  });
}

/** A laid piece: its cells the way it fell, and the well cell its box's corner sits on. */
function laidPiece(s: DropState, i: number): { cells: Cell[]; x: number; y: number } {
  let mx = Infinity, my = Infinity;
  for (let k = 0; k < s.grid.length; k++) {
    if (s.grid[k] !== i) continue;
    mx = Math.min(mx, k % s.width);
    my = Math.min(my, Math.floor(k / s.width));
  }
  return { cells: turned(s.pieces[i].cells, s.turns[i] ?? 0), x: mx, y: my };
}

interface Paint {
  /** Show the queue row above the hanging cluster. */
  queue: boolean;
  /** The hanging cluster's left edge, in columns (fractional while it glides). */
  hangCol?: number;
  /** A piece falling into place: how many cells above its rest it is drawn, and its landing. */
  fall?: { piece: number; above: number; squash: number; ripple: number };
  /** Show where the hanging cluster would land. */
  ghost?: boolean;
  /** Every nucleon lit (a full well). */
  glow?: boolean;
  /** Say "Last one" where the queue was, once it is empty. */
  label?: boolean;
  /** Rule pictures draw no hanging cluster once all are down; neither does a won board. */
  now: number;
}

/** Paints the queue, the hanging cluster, the well and everything in it. */
export function paintDrop(ctx: CanvasRenderingContext2D, s: DropState, L: Layout, o: Paint): void {
  const { c, x, y } = L;
  const W = s.width, H = s.depth;
  // The well: the frame round three sides, open at the top.
  const pad = framePad(c), lw = frameWidth(c);
  const box = { x: x - pad, y: y - pad, w: W * c + pad * 2, h: H * c + pad * 2 };
  const radius = c * 0.2 + pad;
  drawFrame(ctx, box, { width: lw, radius, color: C.frame, gaps: [{ side: 'top', at: box.x + box.w / 2, size: box.w - radius * 2 }] });
  // Empty cells: a faint dot each.
  ctx.fillStyle = C.surface3;
  for (let k = 0; k < W * H; k++) {
    if (s.grid[k] >= 0) continue;
    ctx.beginPath();
    ctx.arc(x + ((k % W) + 0.5) * c, y + (Math.floor(k / W) + 0.5) * c, Math.max(1.5, c * 0.04), 0, Math.PI * 2);
    ctx.fill();
  }
  // Full rows glow faintly, so progress shows.
  for (let r = 0; r < H; r++) {
    let full = true;
    for (let k = 0; k < W && full; k++) full = s.grid[r * W + k] >= 0;
    if (!full) continue;
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = C.accent;
    ctx.fillRect(x, y + r * c, W * c, c);
    ctx.restore();
  }
  // Laid clusters, the falling one drawn from where it is in its fall.
  for (let i = 0; i < s.next; i++) {
    const lp = laidPiece(s, i);
    const f = o.fall?.piece === i ? o.fall : null;
    cluster(ctx, s.pieces[i], lp.cells, x + lp.x * c, y + (lp.y - (f?.above ?? 0)) * c, c, { glow: o.glow, squash: f?.squash });
    if (f && f.ripple > 0) {
      // A soft flash along the cluster's underside as it lands.
      ctx.save();
      ctx.globalAlpha = 0.5 * f.ripple;
      ctx.strokeStyle = C.silver;
      ctx.lineWidth = Math.max(2, c * 0.06);
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const [cx, cy] of lp.cells) {
        if (lp.cells.some(([ox, oy]) => ox === cx && oy === cy + 1)) continue;
        const spread = (1 - f.ripple) * c * 0.25;
        const by = y + (lp.y + cy + 1) * c - 1;
        ctx.moveTo(x + (lp.x + cx) * c + c * 0.12 - spread, by);
        ctx.lineTo(x + (lp.x + cx + 1) * c - c * 0.12 + spread, by);
      }
      ctx.stroke();
      ctx.restore();
    }
  }
  // Sealed gaps, outlined in amber.
  for (const k of sealed(s)) {
    ctx.save();
    ctx.strokeStyle = C.warn;
    ctx.lineWidth = Math.max(2, c * 0.07);
    ctx.beginPath();
    ctx.roundRect(x + (k % W) * c + c * 0.12, y + Math.floor(k / W) * c + c * 0.12, c * 0.76, c * 0.76, c * 0.18);
    ctx.stroke();
    ctx.restore();
  }
  const cells = current(s);
  if (cells) {
    const col = o.hangCol ?? s.col;
    const hx = x + col * c, hy = L.hang - boxH(cells) * c;
    // Where it would land, dotted; amber when that would seal a gap. A faint lane shows the way
    // down from the hanging cluster.
    if (o.ghost) {
      const at = landing(s, cells, s.col);
      if (at !== null) {
        ctx.save();
        ctx.globalAlpha = 0.07;
        ctx.fillStyle = C.accent;
        for (let cx = 0; cx < boxW(cells); cx++) {
          const top = Math.min(...cells.filter(([px]) => px === cx).map(([, py]) => py));
          ctx.fillRect(x + (s.col + cx) * c + c * 0.08, L.hang, c * 0.84, Math.max(0, y + (at + top) * c - L.hang));
        }
        ctx.restore();
        const after = drop(s);
        const bad = !!after && sealed(after).length > sealed(s).length;
        for (const [cx, cy] of cells) {
          if (bad) {
            ctx.save();
            ctx.strokeStyle = C.warn;
            ctx.globalAlpha = 0.85;
            ctx.lineWidth = Math.max(2, c * 0.05);
            ctx.setLineDash([c * 0.12, c * 0.1]);
            ctx.beginPath();
            ctx.roundRect(x + (s.col + cx) * c + c * 0.1, y + (at + cy) * c + c * 0.1, c * 0.8, c * 0.8, c * 0.18);
            ctx.stroke();
            ctx.restore();
          } else socket(ctx, x + (s.col + cx) * c + c * 0.1, y + (at + cy) * c + c * 0.1, c * 0.8, c * 0.8, c * 0.18, C.line3);
        }
      }
    }
    cluster(ctx, s.pieces[s.next], cells, hx, hy, c, { live: true });
  }
  if (o.queue) {
    const shown = queued(s);
    let qx = L.queueX;
    const pc = L.pc;
    shown.forEach((i, n) => {
      const p = s.pieces[i];
      const h = boxH(p.cells);
      cluster(ctx, p, p.cells, qx, L.queueY + (1.7 * c - h * pc) / 2, pc, { alpha: n === 0 ? 1 : Math.max(0.45, 0.85 - n * 0.1) });
      qx += (boxW(p.cells) + 0.8) * pc;
    });
    if (shown.length && o.label && L.queueX - L.c * 1.4 > 0) {
      ctx.save();
      ctx.fillStyle = C.text2;
      ctx.font = font(Math.max(13, Math.min(16, L.c * 0.3)));
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('Next', L.queueX - pc * 0.8, L.queueY + 0.85 * c);
      ctx.restore();
    }
    if (!shown.length && cells && o.label) {
      ctx.save();
      ctx.fillStyle = C.text2;
      ctx.font = font(Math.max(13, Math.min(16, c * 0.3)));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Last one', x + (W * c) / 2, L.queueY + c * 0.85);
      ctx.restore();
    }
  }
}

/** A drop playing out: the piece, how far it falls in cells, and when. */
interface Fall { piece: number; rows: number; at: number }

const FALL_MS_PER_ROW = 55;
const SQUASH_MS = 160;

export class DropView implements PuzzleView {
  private state: DropState;
  private history: DropState[] = [];
  private reduced: boolean;
  private solver: DropSolver;
  private L: Layout | null = null;
  private press: { at: Point; onPiece: boolean; dragged: boolean } | null = null;
  private fall: Fall | null = null;
  private glide: { from: number; at: number } | null = null;
  private mark: { state: DropState; cells: Cell[] } | null = null;

  constructor(private readonly initial: DropState, reducedMotion: boolean) {
    this.state = cloneDrop(initial);
    this.reduced = reducedMotion;
    this.solver = new DropSolver(initial);
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }
  stats(): { progress: Stat } {
    const s = this.state;
    return { progress: { label: 'Dropped', value: `${s.next}/${s.pieces.length}` } };
  }

  hint(): string {
    const s = this.state;
    if (this.won) return 'The well is full';
    if (sealed(s).length) return 'A gap is sealed in';
    const c = current(s);
    let fits = false;
    for (let col = 0; c && col + boxW(c) <= s.width && !fits; col++) fits = landing(s, c, col) !== null;
    if (c && !fits) return 'No room for this one';
    const left = s.pieces.length - s.next;
    return left === 1 ? '1 cluster to drop' : `${left} clusters to drop`;
  }

  help(level: 1 | 2): Help | null {
    if (this.won) return null;
    const s = this.state;
    const p = this.solver.plan(s);
    if (!p) {
      // Back through the history to the latest board that can still be filled.
      for (let k = this.history.length - 1; k >= 0; k--) {
        if (this.solver.plan(this.history[k])) return undoHelp(this.history.length - k);
      }
      return { text: 'Restart to try again.' };
    }
    const step = p.steps[0];
    const taps = (step.rot - s.rot + 4) % 4;
    const cells = turned(s.pieces[s.next].cells, step.rot);
    if (level === 2) {
      const before = s;
      let t = s;
      for (let k = 0; k < taps; k++) t = rotate(t)!;
      t = { ...t, col: step.col };
      const after = drop(t)!;
      this.history.push(before);
      this.animateDrop(t, after);
      this.state = after;
      return { text: taps ? `Turned it ${times(taps)} and dropped it.` : 'Dropped it.', moved: true };
    }
    const at = landing({ ...s, rot: step.rot, col: step.col }, cells, step.col)!;
    this.mark = { state: s, cells: cells.map(([cx, cy]) => [step.col + cx, at + cy] as Cell) };
    return { text: taps ? `Turn it ${times(taps)}, then drop it here.` : 'Drop it here.' };
  }

  /** The Turn button beside the message line: the same as tapping the hanging cluster. */
  action(): ViewAction | null {
    if (this.won || !current(this.state)) return null;
    return { label: 'Turn', ariaLabel: 'Turn the cluster a quarter', run: () => this.turnPiece() };
  }

  private turnPiece(): void {
    const next = rotate(this.state);
    if (!next) return;
    this.push(next);
  }

  private push(next: DropState): void {
    this.history.push(this.state);
    if (this.history.length > 300) this.history.shift();
    this.state = next;
  }

  private animateDrop(before: DropState, after: DropState): void {
    if (this.reduced || !this.L) { this.fall = null; return; }
    const cells = current(before)!;
    const at = landing(before, cells, before.col)!;
    // From the hanging row (its bottom just above the well) down to where it rests.
    const rows = at + boxH(cells) + 0.35;
    this.fall = { piece: before.next, rows, at: performance.now() };
    void after;
  }

  private dropHere(): void {
    const next = drop(this.state);
    if (!next) return;
    this.animateDrop(this.state, next);
    this.push(next);
    this.glide = null;
  }

  restart(): void {
    this.state = cloneDrop(this.initial);
    this.history = [];
    this.fall = null;
    this.glide = null;
    this.press = null;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.fall = null;
    this.glide = null;
    return true;
  }

  // ---- input ----------------------------------------------------------------------

  private onPiece(p: Point): boolean {
    const L = this.L, cells = current(this.state);
    if (!L || !cells) return false;
    const hx = L.x + this.state.col * L.c, hy = L.hang - boxH(cells) * L.c;
    const m = L.c * 0.3;
    return p.x >= hx - m && p.x <= hx + boxW(cells) * L.c + m && p.y >= hy - m && p.y <= L.hang + m;
  }

  private inDropZone(p: Point): boolean {
    const L = this.L;
    if (!L) return false;
    const s = this.state;
    return p.x >= L.x - L.c && p.x <= L.x + (s.width + 1) * L.c && p.y >= L.hang - reach(s) * L.c - L.c * 0.3 && p.y <= L.y + (s.depth + 0.6) * L.c;
  }

  /** Hangs the cluster centered under the pointer's column. */
  private follow(p: Point): void {
    const L = this.L, cells = current(this.state);
    if (!L || !cells) return;
    const col = Math.round((p.x - L.x) / L.c - boxW(cells) / 2);
    const prev = this.state.col;
    const next = slide(this.state, col);
    if (next) {
      this.state = next;
      this.glide = this.reduced ? null : { from: this.shownCol(performance.now(), prev), at: performance.now() };
    }
  }

  down(p: Point): void {
    if (this.won || !current(this.state)) return;
    this.press = { at: p, onPiece: this.onPiece(p), dragged: false };
    if (!this.press.onPiece && this.inDropZone(p)) this.follow(p);
  }

  move(p: Point): void {
    const pr = this.press;
    if (!pr) return;
    if (!pr.dragged && Math.hypot(p.x - pr.at.x, p.y - pr.at.y) > 8) pr.dragged = true;
    if (pr.dragged || !pr.onPiece) this.follow(p);
  }

  up(p: Point): void {
    const pr = this.press;
    this.press = null;
    if (!pr || this.won) return;
    if (pr.onPiece && !pr.dragged) { this.turnPiece(); return; }
    if (!this.inDropZone(p)) return;
    this.follow(p);
    this.dropHere();
  }

  cancel(): void { this.press = null; }

  key(e: KeyboardEvent): boolean {
    if (this.won || !current(this.state)) return false;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const next = slide(this.state, this.state.col + (e.key === 'ArrowLeft' ? -1 : 1));
      if (next) { this.glide = this.reduced ? null : { from: this.state.col, at: performance.now() }; this.state = next; }
      return true;
    }
    if (e.key === 'ArrowUp') { this.turnPiece(); return true; }
    if (e.key === 'ArrowDown' || e.key === ' ' || e.key === 'Enter') { this.dropHere(); return true; }
    return false;
  }

  // ---- drawing --------------------------------------------------------------------

  /** The hanging cluster's column as drawn: gliding toward where it hangs. */
  private shownCol(now: number, fallback = this.state.col): number {
    const g = this.glide;
    if (!g) return fallback;
    const t = (now - g.at) / 120;
    if (t >= 1) { this.glide = null; return this.state.col; }
    return g.from + (this.state.col - g.from) * ease(t);
  }

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const L = layoutDrop(area, s, { queue: true });
    this.L = L;
    let fall: Paint['fall'];
    const f = this.fall;
    if (f && f.piece === s.next - 1) {
      const dur = Math.sqrt(f.rows) * FALL_MS_PER_ROW * 2;
      const t = now - f.at;
      if (t < dur) {
        const k = t / dur;
        fall = { piece: f.piece, above: f.rows * (1 - k * k), squash: 0, ripple: 0 };
      } else if (t < dur + SQUASH_MS) {
        const k = (t - dur) / SQUASH_MS;
        fall = { piece: f.piece, above: 0, squash: Math.sin(k * Math.PI), ripple: 1 - k };
      } else this.fall = null;
    } else this.fall = null;
    paintDrop(ctx, s, L, { queue: true, hangCol: this.shownCol(now), ghost: !this.fall, glow: this.won, label: true, now });
    const m = this.mark?.state === s && !this.won && !this.fall ? this.mark : null;
    if (m) {
      for (const [cx, cy] of m.cells) drawHelpMark(ctx, L.x + cx * L.c + L.c * 0.08, L.y + cy * L.c + L.c * 0.08, L.c * 0.84, L.c * 0.84, now, this.reduced, L.c * 0.2);
    }
  }
}

const times = (n: number): string => (n === 1 ? 'once' : n === 2 ? 'twice' : 'three times');

// ---- rule pictures ---------------------------------------------------------------------

/** A picture board: a well, its clusters in order, and any already laid as [x, y] cells. */
function board(width: number, depth: number, pieces: { cells: Cell[]; protons: boolean[] }[], laid: Cell[][] = []): DropState {
  const s: DropState = { width, depth, grid: Array(width * depth).fill(-1), pieces: [], next: 0, rot: 0, col: 0, preview: 3, turns: [], moves: 0, par: 0 };
  // Laid clusters come first in the queue, already down.
  laid.forEach((cells) => {
    const i = s.pieces.length;
    const mx = Math.min(...cells.map(([x]) => x)), my = Math.min(...cells.map(([, y]) => y));
    s.pieces.push({ cells: cells.map(([x, y]) => [x - mx, y - my] as Cell), protons: cells.map((_, k) => k % 2 === 0) });
    for (const [x, y] of cells) s.grid[y * width + x] = i;
    s.next++;
  });
  s.pieces.push(...pieces);
  s.turns = s.pieces.map(() => 0);
  return s;
}

const P = (cells: Cell[], protons: string): Piece => ({ cells, protons: [...protons].map((ch) => ch === 'p') });

/** A script step: turn the hanging cluster, slide it to a column, or drop it. */
type Act = { turn: true } | { col: number } | { drop: true };

const LEAD = 0.35;
const BEAT = 0.42;
const FALL = 0.32;
const REST = 0.6;

/** One rule picture: the script played beat by beat; drops fall and land. A `bad` picture flags
 *  the sealed gaps it leaves (always drawn in amber). */
function picture(s0: DropState, script: Act[], caption: string, queue = false): Illustration {
  // The board after each act, and when each act starts.
  const frames: { before: DropState; after: DropState; act: Act; at: number }[] = [];
  let cur = s0, clock = LEAD;
  for (const act of script) {
    let next: DropState | null = cur;
    if ('turn' in act) next = rotate(cur);
    else if ('col' in act) next = { ...cur, col: act.col };
    else next = drop(cur);
    frames.push({ before: cur, after: next ?? cur, act, at: clock });
    clock += 'drop' in act ? BEAT + FALL : BEAT;
    cur = next ?? cur;
  }
  const raw = clock + REST;
  const duration = Math.min(4, Math.max(1.5, raw));
  const pace = raw / duration;
  return {
    caption,
    duration,
    draw: (ctx, w, h, t0) => {
      const t = t0 * pace;
      let st = s0;
      let hangCol: number | undefined;
      let fall: Paint['fall'];
      for (const fr of frames) {
        if (t < fr.at) break;
        const k = (t - fr.at) / BEAT;
        st = fr.after;
        hangCol = undefined;
        fall = undefined;
        if ('col' in fr.act && k < 1) hangCol = fr.before.col + (fr.act.col - fr.before.col) * ease(k);
        if ('drop' in fr.act) {
          const cells = current(fr.before)!;
          const rows = landing(fr.before, cells, fr.before.col)! + boxH(cells) + 0.35;
          const u = (t - fr.at) / FALL;
          if (u < 1) fall = { piece: fr.before.next, above: rows * (1 - u * u), squash: 0, ripple: 0 };
          else if (u < 1.6) fall = { piece: fr.before.next, above: 0, squash: Math.sin(((u - 1) / 0.6) * Math.PI), ripple: 1 - (u - 1) / 0.6 };
        }
      }
      const L = layoutDrop({ x: 0, y: 0, w, h }, s0, { queue, margin: 3 });
      paintDrop(ctx, st, L, { queue, hangCol, fall, now: t * 1000 });
    },
  };
}

const DOMINO: Cell[] = [[0, 0], [1, 0]];
const MONO: Cell[] = [[0, 0]];
const GAMMA: Cell[] = [[0, 0], [1, 0], [0, 1]];
const OH: Cell[] = [[0, 0], [1, 0], [0, 1], [1, 1]];

export const RULES: RuleCard[] = [
  {
    title: 'Drop',
    text: 'Drag the hanging cluster over the well, or tap a column, and let go: it **falls straight down** until it lands on something. Clusters come in the order dealt.',
    good: picture(board(3, 2, [P(DOMINO, 'pn'), P(GAMMA, 'pnn'), P(MONO, 'p')]), [{ col: 1 }, { drop: true }, { col: 0 }, { drop: true }, { col: 2 }, { drop: true }], 'Straight down'),
  },
  {
    title: 'Turn',
    text: 'Tap the hanging cluster, or Turn, to **turn it a quarter**. Every turn and every drop is a move, and par is one drop per cluster plus the fewest turns.',
    good: picture(board(3, 2, [P([[0, 0], [1, 0], [0, 1], [0, 2]], 'pnpn')], [[[0, 1], [1, 1]]]), [{ turn: true }, { col: 0 }, { drop: true }], 'Turned to fit'),
  },
  {
    title: 'No gaps',
    text: 'A gap sealed under a cluster **can never be filled**, and the clusters add up to exactly the well. Fill it to the brim.',
    good: picture(board(3, 2, [P(DOMINO, 'np'), P(DOMINO, 'pn')], [[[0, 1]], [[0, 0]]]), [{ col: 1 }, { drop: true }, { drop: true }], 'Flush every time'),
    bad: picture(board(3, 2, [P(DOMINO, 'np')], [[[0, 1]]]), [{ col: 0 }, { drop: true }], 'A gap sealed in'),
  },
  {
    title: 'Look ahead',
    text: 'The row above shows the clusters still to come. **Leave room for them**: a drop that fits now can leave no place for the next.',
    good: picture(board(4, 3, [P(DOMINO, 'pn'), P(OH, 'pnnp'), P(OH, 'npnp'), P(DOMINO, 'np')]), [{ col: 0 }, { drop: true }, { col: 2 }, { drop: true }, { col: 0 }, { drop: true }, { col: 2 }, { drop: true }], 'Room for the next one', true),
    bad: picture(board(4, 3, [P(DOMINO, 'pn'), P(OH, 'pnnp'), P(OH, 'npnp'), P(DOMINO, 'np')]), [{ col: 1 }, { drop: true }, { col: 2 }, { drop: true }], 'No room for the next', true),
  },
];
