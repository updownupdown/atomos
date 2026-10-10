// Drawing and touch for Rutherford Probe: tap a cell to probe it; long-press,
// or switch the tool under the plate to Mark, to flag a suspected nucleus.
// Tapping a probed cell whose count is met by marks probes the rest it covers.
// Keys: arrows move, Space or Enter probes, F or M marks, Tab switches tool.

import { chord, cloneRutherford, probe, remaining, scope, solved, toggleMark, type RutherfordState } from './rutherford';
import { C, fitGrid, font, tile } from './palette';
import type { Area, Point, PuzzleView } from './view';

const LONG_MS = 380;
const BAR_H = 48;

export const INSTRUCTIONS = `
<h3>How to play</h3>
<p>Nuclei are hidden under some cells of the plate. Find them all by probing every other cell.</p>
<ul>
  <li><b>Tap</b> a cell to probe it. The number it shows is how many nuclei sit in the <b>eight cells around it</b>. A blank probed cell has none around it, and its neighbors open by themselves.</li>
  <li><b>Scatter cells</b>, drawn with small ticks pointing out, count differently: their number is every nucleus in the <b>whole row and column</b> they sit in.</li>
  <li><b>Quiet cells</b> show <b>?</b> and give no count at all.</li>
  <li><b>Mark</b> a suspected nucleus with a long press, or switch the tool under the plate to Mark and tap. Marks are notes for you; tap again to clear one.</li>
  <li>Tap a probed number whose nuclei are all marked to probe the rest of the cells it counts in one go.</li>
  <li>Probe a nucleus and it is a <b>direct hit</b>: it is shown with a red outline and the game goes on, but the run is no longer flawless.</li>
</ul>
<p>The plate opens with a region already probed, and from there every cell can be worked out without guessing. The counter under the plate is how many nuclei are still unmarked.</p>
<p>Keyboard: arrows move, Space or Enter probes, F or M marks, Tab switches the tool.</p>
<h3>In the game</h3>
<p>A gate: played once, it opens the nucleus view.</p>
<ul>
  <li>The plate is 7x7 up to z 20, 8x8 to z 50, 9x9 to z 85 and 10x10 beyond, with nuclei on 15% of cells rising to 20%.</li>
  <li>Scatter cells are about 6% of empty cells at z 1 and 12% at z 118; quiet cells 4% rising to 10%.</li>
  <li>No par: moves count probe taps. Undo is free and takes back a probe or a mark, a direct hit included, but a hit still spoils a flawless run.</li>
  <li>Each plate is checked by a solver that only uses single clues, two overlapping clues and the nuclei count, so a careful player never has to guess.</li>
</ul>
<p>Science: Rutherford found the nucleus by firing alpha particles at gold foil and watching how they scattered; nobody probes atoms cell by cell. The method of mapping the unseen from what probes report is his.</p>`;

interface Layout {
  cell: number;
  x: number;
  y: number;
  bar: { x: number; y: number; w: number; h: number; seg: number };
}

export class RutherfordView implements PuzzleView {
  private state: RutherfordState;
  private history: RutherfordState[] = [];
  private marking = false;
  private press: { p: Point; at: number; cell: number; fired: boolean } | null = null;
  private cursor = -1;
  private lay: Layout | null = null;
  private wonAt = 0;
  private reduced: boolean;

  constructor(private readonly initial: RutherfordState, reducedMotion: boolean) {
    this.state = cloneRutherford(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return null; }
  get clean(): boolean { return this.state.hits === 0; }

  hint(): string {
    if (this.won) return this.state.hits ? `All found, ${this.state.hits} direct hit${this.state.hits === 1 ? '' : 's'}` : 'All nuclei found';
    const left = remaining(this.state);
    return `${left} nucle${left === 1 ? 'us' : 'i'} unmarked${this.state.hits ? ` · ${this.state.hits} hit` : ''}`;
  }

  restart(): void {
    this.state = cloneRutherford(this.initial);
    this.history = [];
    this.marking = false;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    // Undo is free (the probe count goes back too), but a direct hit stays on the record for a flawless run.
    this.state = { ...cloneRutherford(prev), hits: this.state.hits };
    return true;
  }

  private commit(next: RutherfordState | null): void {
    if (!next || this.won) return;
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.state = next;
    if (solved(next)) this.wonAt = performance.now();
  }

  private act(i: number, mark: boolean): void {
    const s = this.state;
    if (s.probed[i]) this.commit(chord(s, i));
    else if (mark) this.commit(toggleMark(s, i));
    else this.commit(probe(s, i));
  }

  // ---- input ----------------------------------------------------------------------

  private cellAt(p: Point): number {
    const L = this.lay;
    if (!L) return -1;
    const n = this.state.size;
    const c = Math.floor((p.x - L.x) / L.cell), r = Math.floor((p.y - L.y) / L.cell);
    return c >= 0 && r >= 0 && c < n && r < n ? r * n + c : -1;
  }

  private barAt(p: Point): number {
    const b = this.lay?.bar;
    if (!b || p.y < b.y || p.y > b.y + b.h || p.x < b.x || p.x > b.x + b.seg * 2) return -1;
    return p.x < b.x + b.seg ? 0 : 1;
  }

  down(p: Point): void {
    this.press = { p, at: performance.now(), cell: this.cellAt(p), fired: false };
  }

  move(p: Point): void {
    if (this.press && Math.hypot(p.x - this.press.p.x, p.y - this.press.p.y) > 12) this.press.cell = -1;
  }

  up(p: Point): void {
    const pr = this.press;
    this.press = null;
    if (!pr || pr.fired || Math.hypot(p.x - pr.p.x, p.y - pr.p.y) > 12) return;
    const seg = this.barAt(p);
    if (seg >= 0) { this.marking = seg === 1; return; }
    if (pr.cell >= 0 && !this.won) {
      this.cursor = pr.cell;
      this.act(pr.cell, this.marking);
    }
  }

  cancel(): void { this.press = null; }

  key(e: KeyboardEvent): boolean {
    const n = this.state.size;
    const go = (dr: number, dc: number) => {
      if (this.cursor < 0) { this.cursor = Math.floor(n / 2) * n + Math.floor(n / 2); return; }
      const r = (Math.floor(this.cursor / n) + dr + n) % n, c = ((this.cursor % n) + dc + n) % n;
      this.cursor = r * n + c;
    };
    if (e.key === 'ArrowUp') { go(-1, 0); return true; }
    if (e.key === 'ArrowDown') { go(1, 0); return true; }
    if (e.key === 'ArrowLeft') { go(0, -1); return true; }
    if (e.key === 'ArrowRight') { go(0, 1); return true; }
    if (e.key === 'Tab') { this.marking = !this.marking; return true; }
    if (this.cursor < 0 || this.won) return false;
    if (e.key === ' ' || e.key === 'Enter') { this.act(this.cursor, false); return true; }
    if (e.key === 'f' || e.key === 'm') { this.act(this.cursor, true); return true; }
    return false;
  }

  // ---- drawing --------------------------------------------------------------------

  private layout(area: Area): Layout {
    const n = this.state.size;
    const g = fitGrid(area, n, n, { margin: 8, bottom: BAR_H + 10, maxCell: 64 });
    const w = Math.min(area.w - 16, Math.max(g.w, 260));
    const seg = Math.min(110, (w - 90) / 2);
    const bx = area.x + (area.w - w) / 2;
    return { cell: g.cell, x: g.x, y: g.y, bar: { x: bx, y: g.y + g.h + 10, w, h: BAR_H, seg } };
  }

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const L = (this.lay = this.layout(area));
    const n = s.size, c = L.cell;
    const pad = Math.max(1.5, c * 0.05), w = c - pad * 2, rad = c * 0.18;

    // A long press marks without waiting for the finger to lift.
    const pr = this.press;
    if (pr && !pr.fired && pr.cell >= 0 && now - pr.at >= LONG_MS && !this.won && !s.probed[pr.cell]) {
      pr.fired = true;
      this.cursor = pr.cell;
      this.act(pr.cell, true);
    }

    const won = this.won;
    const glow = won ? (this.reduced ? 1 : Math.min(1, (now - this.wonAt) / 700)) : 0;
    const focus = this.cursor >= 0 && s.probed[this.cursor] && s.kind[this.cursor] === 'scatter' ? new Set(scope(s, this.cursor)) : null;

    for (let i = 0; i < n * n; i++) {
      const x = L.x + (i % n) * c + pad, y = L.y + Math.floor(i / n) * c + pad;
      const cx = x + w / 2, cy = y + w / 2;
      if (!s.probed[i]) {
        tile(ctx, x, y, w, w, rad, C.surface2, focus?.has(i) ? C.line3 : C.line2, 1);
        if (won && s.nuclei[i]) nucleusGlyph(ctx, cx, cy, w * 0.3, glow);
        if (s.marked[i]) reticle(ctx, cx, cy, w * 0.3);
        continue;
      }
      if (s.nuclei[i]) {
        tile(ctx, x, y, w, w, rad, C.plate, C.bad, 1.5);
        nucleusGlyph(ctx, cx, cy, w * 0.3, 1);
        continue;
      }
      tile(ctx, x, y, w, w, rad, focus?.has(i) ? C.surface : C.plate);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (s.kind[i] === 'quiet') {
        ctx.fillStyle = C.text3;
        ctx.font = font(w * 0.46, 500);
        ctx.fillText('?', cx, cy + w * 0.02);
        continue;
      }
      if (s.kind[i] === 'scatter') ticks(ctx, x, y, w, i === this.cursor ? C.silver : C.text2);
      if (s.clue[i] > 0 || s.kind[i] === 'scatter') {
        ctx.fillStyle = s.kind[i] === 'scatter' ? C.silver : C.text;
        ctx.font = font(w * 0.48, s.kind[i] === 'scatter' ? 600 : 500);
        ctx.fillText(String(s.clue[i]), cx, cy + w * 0.03);
      }
    }
    if (this.cursor >= 0 && !won) {
      const x = L.x + (this.cursor % n) * c + pad, y = L.y + Math.floor(this.cursor / n) * c + pad;
      tile(ctx, x - 1.5, y - 1.5, w + 3, w + 3, rad, null, C.accent, 1.5);
    }

    // The tool switch and the nuclei counter.
    const b = L.bar;
    const segs: [string, boolean][] = [['Probe', !this.marking], ['Mark', this.marking]];
    segs.forEach(([label, on], k) => {
      const sx = b.x + k * b.seg;
      tile(ctx, sx + 2, b.y + 2, b.seg - 4, b.h - 4, (b.h - 4) * 0.3, on ? C.surface2 : null, on ? C.line3 : C.line, 1);
      const ix = sx + b.seg * 0.28, iy = b.y + b.h / 2;
      if (k === 0) {
        ctx.fillStyle = on ? C.silver : C.text3;
        ctx.beginPath();
        ctx.arc(ix, iy, 4, 0, Math.PI * 2);
        ctx.fill();
      } else reticle(ctx, ix, iy, 7, on ? 1 : 0.45);
      ctx.fillStyle = on ? C.text : C.text2;
      ctx.font = font(14, 500);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, ix + 12, iy + 1);
    });
    const left = remaining(s);
    ctx.fillStyle = C.text2;
    ctx.font = font(13, 500);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const tx = b.x + b.w - 4;
    ctx.fillText(String(won ? 0 : left), tx, b.y + b.h / 2 + 1);
    const tw = ctx.measureText(String(won ? 0 : left)).width;
    nucleusGlyph(ctx, tx - tw - 14, b.y + b.h / 2, 7, 1);
  }
}

/** A small nucleus: a knot of protons and neutrons. */
function nucleusGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number): void {
  const beads: [number, number, string][] = [[-0.45, -0.3, C.proton], [0.45, -0.3, C.neutron], [0, 0.42, C.proton], [-0.05, -0.02, C.neutron]];
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const [dx, dy, col] of beads) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x + dx * r, y + dy * r, r * 0.52, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = C.plate;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

/** The mark for a suspected nucleus: a ring with four ticks, in the selection color. */
function reticle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = Math.max(1.5, r * 0.18);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.75, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(x + dx * r * 0.45, y + dy * r * 0.45);
    ctx.lineTo(x + dx * r * 1.15, y + dy * r * 1.15);
  }
  ctx.stroke();
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1.5, r * 0.14), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Four small outward ticks on a scatter cell's edges: it counts along its row and column. */
function ticks(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, color: string): void {
  const m = w * 0.1, len = w * 0.12;
  const cx = x + w / 2, cy = y + w / 2;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  const tri = (ax: number, ay: number, dx: number, dy: number) => {
    // A small triangle pointing along (dx, dy) with its tip at (ax, ay).
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - dx * len + dy * len * 0.7, ay - dy * len + dx * len * 0.7);
    ctx.lineTo(ax - dx * len - dy * len * 0.7, ay - dy * len - dx * len * 0.7);
    ctx.closePath();
  };
  tri(cx, y + m * 0.4, 0, -1);
  tri(cx, y + w - m * 0.4, 0, 1);
  tri(x + m * 0.4, cy, -1, 0);
  tri(x + w - m * 0.4, cy, 1, 0);
  ctx.fill();
  ctx.restore();
}
