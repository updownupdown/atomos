// Drawing and touch for Orbital Grid: tap a cell, then a symbol in the palette
// under the grid; tapping the chosen cell again cycles it. Keys: arrows move,
// 1-8 or s/p/d/f place, Backspace clears.

import { conflicts, cycleValue, EMPTY, filledCount, place, solved, symbolOf, type OrbitalGridState } from './orbitalGrid';
import { C, font, tile } from './palette';
import type { Area, Point, PuzzleView } from './view';

/** Read at draw time, so a palette change reaches the grid. */
const orbitalColor = (o: 's' | 'p' | 'd' | 'f'): string => C[o];

export const INSTRUCTIONS = `
<h3>How to play</h3>
<p>Fill every empty cell with a symbol so that <b>each row, each column and each outlined block</b> holds every symbol exactly once.</p>
<ul>
  <li>Tap an empty cell, then tap a symbol in the palette under the grid. Tapping the chosen cell again steps it through the symbols.</li>
  <li>Tap the symbol a cell already holds to clear it.</li>
  <li>Solid cells were dealt to you and cannot change.</li>
  <li>If a symbol appears twice in a line or block, both copies get an amber ring.</li>
  <li>On the bigger grids a symbol is an orbital letter plus an arrow: <b>s↑</b> and <b>s↓</b> are different symbols, so a 6x6 row holds s↑ s↓ p↑ p↓ d↑ d↓.</li>
</ul>
<p>Every grid can be finished by pure deduction: there is always a cell with only one possible symbol, or a symbol with only one possible cell in some line or block.</p>
<p>Keyboard: arrows move, 1-8 or s p d f place (press the letter twice for the down arrow), Backspace clears.</p>
<h3>In the game</h3>
<p>The electron-shell stage of building every element, z 1 to 118 (it replaces Shell Rings).</p>
<ul>
  <li>z 1-18 (periods 1-3): 4x4, symbols s p d f, 6 to 10 empty cells.</li>
  <li>z 19-54 (periods 4-5): 6x6 with 2x3 blocks, s p d with spin up and down, 14 to 22 empty cells.</li>
  <li>z 55-118 (periods 6-7, where the f block arrives): 8x8 with 2x4 blocks, s p d f with spin up and down, 24 to 36 empty cells.</li>
</ul>
<p>Par is the number of empty cells: one placement each. Editing the same cell several times in a row counts as one placement, so cycling is free; going back to change a cell later costs another. Undo is free: it takes the placement back too. Clean means finishing within par.</p>
<p>Levels are carved from a random full grid, removing givens only while the grid still solves by singles, so the answer is unique and never needs a guess.</p>
<p>The symbols are orbital labels only: a cell is not a place in the atom and the grid does not say where electrons are.</p>`;

interface Layout {
  cell: number;
  gx: number;
  gy: number;
  key: number;
  keyCols: number;
  keyGap: number;
  px: number;
  py: number;
}

export class OrbitalGridView implements PuzzleView {
  private state: OrbitalGridState;
  private history: OrbitalGridState[] = [];
  private selected = -1;
  private pressed: Point | null = null;
  private lay: Layout | null = null;
  private wonAt = 0;
  private reduced: boolean;

  constructor(private readonly initial: OrbitalGridState, reducedMotion: boolean) {
    this.state = initial;
    this.reduced = reducedMotion;
    this.selected = initial.cells.indexOf(EMPTY);
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    if (this.won) return 'Grid complete';
    const clash = conflicts(this.state).filter(Boolean).length;
    if (clash) return `${clash} cells clash`;
    return `${filledCount(this.state)} / ${this.state.par} placed`;
  }

  restart(): void {
    this.state = this.initial;
    this.history = [];
    this.selected = this.initial.cells.indexOf(EMPTY);
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    // Undo is free: the board and the placement count both go back.
    this.state = { ...prev };
    return true;
  }

  private set(i: number, v: number): void {
    if (this.won) return;
    const next = place(this.state, i, v);
    if (!next) return;
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.state = next;
    if (solved(next)) this.wonAt = performance.now();
  }

  /** Places a palette symbol in the chosen cell, or clears it when it already holds that symbol. */
  private choose(v: number): void {
    const i = this.selected;
    if (i < 0 || this.state.givens[i]) return;
    this.set(i, this.state.cells[i] === v ? EMPTY : v);
  }

  // ---- input ----------------------------------------------------------------------

  down(p: Point): void { this.pressed = p; }
  move(): void { /* taps only */ }
  cancel(): void { this.pressed = null; }

  up(p: Point): void {
    const s = this.pressed;
    this.pressed = null;
    if (!s || Math.hypot(p.x - s.x, p.y - s.y) > 16 || !this.lay) return;
    const L = this.lay, n = this.state.size;
    const c = Math.floor((p.x - L.gx) / L.cell), r = Math.floor((p.y - L.gy) / L.cell);
    if (c >= 0 && r >= 0 && c < n && r < n) {
      const i = r * n + c;
      if (i === this.selected && !this.state.givens[i]) this.set(i, cycleValue(this.state, i));
      this.selected = i;
      return;
    }
    const k = this.keyAt(p);
    if (k >= 0) this.choose(k);
  }

  private keyAt(p: Point): number {
    const L = this.lay!;
    for (let k = 0; k < this.state.size; k++) {
      const { x, y } = this.keyPos(k);
      if (p.x >= x - L.keyGap / 2 && p.x < x + L.key + L.keyGap / 2 && p.y >= y - L.keyGap / 2 && p.y < y + L.key + L.keyGap / 2) return k;
    }
    return -1;
  }

  key(e: KeyboardEvent): boolean {
    const n = this.state.size;
    const moveBy = (dr: number, dc: number) => {
      const i = this.selected < 0 ? 0 : this.selected;
      const r = (Math.floor(i / n) + dr + n) % n, c = ((i % n) + dc + n) % n;
      this.selected = r * n + c;
    };
    if (e.key === 'ArrowUp') { moveBy(-1, 0); return true; }
    if (e.key === 'ArrowDown') { moveBy(1, 0); return true; }
    if (e.key === 'ArrowLeft') { moveBy(0, -1); return true; }
    if (e.key === 'ArrowRight') { moveBy(0, 1); return true; }
    if (this.selected < 0) return false;
    const i = this.selected;
    if (/^[1-8]$/.test(e.key) && Number(e.key) <= n) {
      const v = Number(e.key) - 1;
      if (!this.state.givens[i] && this.state.cells[i] !== v) this.set(i, v);
      return true;
    }
    const letter = 'spdf'.indexOf(e.key.toLowerCase());
    if (letter >= 0 && e.key.length === 1) {
      let v = letter;
      if (this.state.spin) {
        v = letter * 2;
        if (this.state.cells[i] === v) v += 1;
      }
      if (v < n && !this.state.givens[i] && this.state.cells[i] !== v) this.set(i, v);
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { this.set(i, EMPTY); return true; }
    if (e.key === ' ') { if (!this.state.givens[i]) this.set(i, cycleValue(this.state, i)); return true; }
    return false;
  }

  // ---- layout and drawing ---------------------------------------------------------

  private layout(area: Area): Layout {
    const n = this.state.size;
    const margin = 8, gap = 14, keyGap = 4;
    const availW = Math.max(1, area.w - margin * 2), availH = Math.max(1, area.h - margin * 2);
    let best: Layout | null = null;
    let bestScore = -1;
    // The palette goes under the grid in one or two rows, or beside it in one or two columns.
    for (const side of [false, true]) {
      for (const lines of [1, 2]) {
        const across = Math.ceil(n / lines);
        const cols = side ? lines : across, rows = side ? across : lines;
        let key = side ? (availH - (rows - 1) * keyGap) / rows : (availW - (cols - 1) * keyGap) / cols;
        key = Math.min(64, key);
        const palW = cols * key + (cols - 1) * keyGap, palH = rows * key + (rows - 1) * keyGap;
        const cell = Math.min(72, side ? (availW - palW - gap) / n : availW / n, side ? availH / n : (availH - palH - gap) / n);
        if (cell <= 0) continue;
        key = Math.min(key, Math.max(44, cell * 1.15));
        const score = Math.min(cell, key * 1.1) + (side ? 0 : 0.5);
        if (score <= bestScore) continue;
        bestScore = score;
        const kW = cols * key + (cols - 1) * keyGap, kH = rows * key + (rows - 1) * keyGap;
        const g = cell * n;
        const totalW = side ? g + gap + kW : Math.max(g, kW), totalH = side ? Math.max(g, kH) : g + gap + kH;
        const ox = area.x + (area.w - totalW) / 2, oy = area.y + (area.h - totalH) / 2;
        best = side
          ? { cell, gx: ox, gy: oy + (totalH - g) / 2, key, keyCols: cols, keyGap, px: ox + g + gap, py: oy + (totalH - kH) / 2 }
          : { cell, gx: area.x + (area.w - g) / 2, gy: oy, key, keyCols: cols, keyGap, px: area.x + (area.w - kW) / 2, py: oy + g + gap };
      }
    }
    return best!;
  }

  private keyPos(k: number): { x: number; y: number } {
    const L = this.lay!;
    const row = Math.floor(k / L.keyCols), col = k % L.keyCols;
    // A short last row is centerd under the first.
    const inRow = Math.min(L.keyCols, this.state.size - row * L.keyCols);
    const shift = ((L.keyCols - inRow) * (L.key + L.keyGap)) / 2;
    return { x: L.px + shift + col * (L.key + L.keyGap), y: L.py + row * (L.key + L.keyGap) };
  }

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const L = (this.lay = this.layout(area));
    const n = s.size, c = L.cell;
    const pad = Math.max(2, c * 0.06);
    const rad = c * 0.18;
    const clash = conflicts(s);
    const won = this.won;
    const glow = won ? (this.reduced ? 1 : Math.min(1, (now - this.wonAt) / 600)) : 0;

    // Blocks: a fine outline round each region.
    for (let br = 0; br < n; br += s.rh) {
      for (let bc = 0; bc < n; bc += s.rw) {
        const x = L.gx + bc * c, y = L.gy + br * c;
        tile(ctx, x + 1, y + 1, s.rw * c - 2, s.rh * c - 2, rad, C.plate, won ? C.good : C.line3, 1.25);
      }
    }

    for (let i = 0; i < n * n; i++) {
      const x = L.gx + (i % n) * c + pad, y = L.gy + Math.floor(i / n) * c + pad;
      const w = c - pad * 2;
      const v = s.cells[i];
      if (v === EMPTY) tile(ctx, x, y, w, w, rad * 0.8, C.surface2, C.line, 1);
      else {
        const color = orbitalColor(symbolOf(s.spin, v).orbital);
        if (s.givens[i]) {
          tile(ctx, x, y, w, w, rad * 0.8, color);
          drawSymbol(ctx, x + w / 2, y + w / 2, w, s.spin, v, C.tileInk);
        } else {
          ctx.save();
          ctx.globalAlpha = 0.3 + 0.2 * glow;
          tile(ctx, x, y, w, w, rad * 0.8, color);
          ctx.restore();
          tile(ctx, x + 0.75, y + 0.75, w - 1.5, w - 1.5, rad * 0.8, null, color, 1.5);
          drawSymbol(ctx, x + w / 2, y + w / 2, w, s.spin, v, C.text);
        }
      }
      if (clash[i] && !s.givens[i]) {
        ctx.save();
        ctx.globalAlpha = 0.85;
        tile(ctx, x - 1, y - 1, w + 2, w + 2, rad * 0.9, null, C.warn, 2);
        ctx.restore();
      }
      if (i === this.selected && !won) tile(ctx, x - 2, y - 2, w + 4, w + 4, rad, null, C.accent, 2);
    }

    // The palette.
    const sel = this.selected;
    const live = !won && sel >= 0 && !s.givens[sel];
    for (let k = 0; k < n; k++) {
      const { x, y } = this.keyPos(k);
      const color = orbitalColor(symbolOf(s.spin, k).orbital);
      ctx.save();
      ctx.globalAlpha = live ? 1 : 0.4;
      tile(ctx, x, y, L.key, L.key, L.key * 0.18, color);
      drawSymbol(ctx, x + L.key / 2, y + L.key / 2, L.key, s.spin, k, C.tileInk);
      ctx.restore();
      if (live && s.cells[sel] === k) tile(ctx, x - 3, y - 3, L.key + 6, L.key + 6, L.key * 0.22, null, C.silver, 1.5);
    }
  }
}

/** A symbol: its orbital letter and, on spin grids, an up or down arrow beside it. */
function drawSymbol(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, spin: boolean, k: number, color: string): void {
  const { orbital, up } = symbolOf(spin, k);
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(size * (up === null ? 0.5 : 0.44), 600);
  const lx = up === null ? cx : cx - size * 0.12;
  ctx.fillText(orbital, lx, cy - size * 0.03);
  if (up !== null) {
    const ax = cx + size * 0.2, h = size * 0.34, head = size * 0.09;
    const top = cy - h / 2, bot = cy + h / 2;
    ctx.lineWidth = Math.max(1.5, size * 0.05);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(ax, top);
    ctx.lineTo(ax, bot);
    const tip = up ? top : bot, dir = up ? 1 : -1;
    ctx.moveTo(ax - head, tip + head * dir);
    ctx.lineTo(ax, tip);
    ctx.lineTo(ax + head, tip + head * dir);
    ctx.stroke();
  }
  ctx.restore();
}
