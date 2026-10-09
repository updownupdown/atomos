// Drawing and touch for the Merge puzzle: a swipe slides the board; a cluster
// of the wanted size flies up into the nucleus.

import { ALL_SYMBOLS } from '../core/elements';
import { cloneMerge, jammed, slide, wanted, won, type Dir, type MergeState, type Tile } from './merge';
import { ease, MONO, type Area, type Point, type PuzzleView } from './view';

const SLIDE_MS = 150;
const POP_MS = 260;
const FLY_MS = 520;
const SWIPE = 22;

const symbolOf = (z: number) => ALL_SYMBOLS[z - 1] ?? '?';

export class MergeView implements PuzzleView {
  private state: MergeState;
  private history: MergeState[] = [];
  private pressed: Point | null = null;
  private animAt = 0;
  private area: Area = { x: 0, y: 0, w: 1, h: 1 };
  private reduced: boolean;
  /** Where each socket sits on screen, for the flight animation. */
  private socketAt: Point[] = [];

  constructor(private readonly initial: MergeState, reducedMotion: boolean) {
    this.state = cloneMerge(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return won(this.state); }
  get stuck(): boolean { return jammed(this.state); }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.spoils === 0; }

  hint(): string {
    const t = this.state.target;
    const name = `${sup(String(t.a))}${symbolOf(t.z)}`;
    const want = wanted(this.state);
    if (this.won) return `That is ${name}: ${t.a} nucleons, all gathered.`;
    if (this.stuck) return 'Jammed: nothing can move. Restart the board.';
    if (this.state.moves === 0) return `<span class="hl">Swipe</span> to slide everything. Two clusters of the same size merge into one. Build a <span class="hl">${want}</span> and it joins the nucleus.`;
    if (this.state.cells.some((c) => c?.spoiled)) return 'Too big for what is left: that one cracks. It crumbles on your next swipe.';
    if (this.state.flown.length) return `A ${this.state.flown[0].tile.v} joins ${name}. Next: a <span class="hl">${want}</span>.`;
    return `${name} needs a <span class="hl">${want}</span> next.`;
  }

  restart(): void {
    this.state = cloneMerge(this.initial);
    this.history = [];
    this.animAt = 0;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.animAt = 0;
    return true;
  }

  private swipe(dir: Dir): void {
    if (this.won) return;
    const next = slide(this.state, dir);
    if (!next) return;
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.state = next;
    this.animAt = performance.now();
  }

  down(p: Point): void { this.pressed = p; }
  move(): void { /* a swipe is read on release */ }
  cancel(): void { this.pressed = null; }

  up(p: Point): void {
    const s = this.pressed;
    this.pressed = null;
    if (!s) return;
    const dx = p.x - s.x, dy = p.y - s.y;
    if (Math.hypot(dx, dy) < SWIPE) return;
    this.swipe(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
  }

  key(e: KeyboardEvent): boolean {
    const map: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
    const dir = map[e.key];
    if (!dir) return false;
    this.swipe(dir);
    return true;
  }

  // ---- drawing ---------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    this.area = area;
    const n = this.state.size;
    const goalH = 84;
    const side = Math.min(area.w, area.h - goalH) * 0.94;
    const cell = side / n;
    const x0 = area.x + (area.w - side) / 2;
    const y0 = area.y + goalH + (area.h - goalH - side) / 2;
    const centre = (i: number): Point => ({ x: x0 + (i % n) * cell + cell / 2, y: y0 + Math.floor(i / n) * cell + cell / 2 });
    const r = cell * 0.4;

    this.drawGoal(ctx, x0, y0 - goalH + 10, side, r);

    // The board: a faint ruled grid.
    ctx.strokeStyle = 'rgba(226, 220, 207, 0.16)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    for (let i = 0; i < n * n; i++) {
      const c = centre(i);
      ctx.strokeRect(c.x - cell / 2 + 3, c.y - cell / 2 + 3, cell - 6, cell - 6);
    }
    ctx.setLineDash([]);

    const since = now - this.animAt;
    const t = this.reduced ? 1 : since / SLIDE_MS;
    const pop = this.reduced ? 1 : since / POP_MS;
    const sliding = t < 1;
    const byId = new Map<number, number>();
    this.state.cells.forEach((tile, i) => tile && byId.set(tile.id, i));

    if (sliding) {
      for (const j of this.state.last) {
        const a = centre(j.from), b = centre(j.to);
        const p = { x: a.x + (b.x - a.x) * ease(t), y: a.y + (b.y - a.y) * ease(t) };
        const tile = j.into ? this.ghostOf(j.id) : this.state.cells[byId.get(j.id)!];
        if (tile) this.drawTile(ctx, tile, p.x, p.y, r, 1, false);
      }
    }
    const want = wanted(this.state);
    for (const [i, tile] of this.state.cells.entries()) {
      if (!tile) continue;
      const inFlight = sliding && this.state.last.some((j) => j.id === tile.id || j.into === tile.id);
      if (inFlight) continue;
      const c = centre(i);
      const fresh = this.state.spawned.includes(tile.id);
      const scale = fresh ? ease(Math.min(1, pop)) : 1;
      const made = this.state.last.some((j) => j.into === tile.id) && pop < 1;
      this.drawTile(ctx, tile, c.x, c.y, r * (made ? 1 + 0.18 * Math.sin(Math.PI * pop) : scale), 1, want !== null && tile.v === want / 2 && !tile.spoiled);
    }

    // Clusters flying into the nucleus.
    const fly = this.reduced ? 1 : Math.max(0, since - SLIDE_MS) / FLY_MS;
    if (fly < 1) {
      this.state.flown.forEach((f, k) => {
        const a = centre(f.from);
        const b = this.socketAt[this.state.filled - this.state.flown.length + k] ?? a;
        const e = ease(fly);
        const p = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e - Math.sin(Math.PI * e) * 30 };
        this.drawTile(ctx, f.tile, p.x, p.y, r * (1 - 0.5 * e), 1, true);
      });
    }
  }

  /** Tiles that merged last move are gone from the board; remember what they looked like for the slide. */
  private ghosts = new Map<number, Tile>();

  private ghostOf(id: number): Tile | undefined {
    if (this.ghosts.has(id)) return this.ghosts.get(id);
    const prev = this.history[this.history.length - 1];
    const tile = prev?.cells.find((c) => c?.id === id) ?? undefined;
    if (tile) this.ghosts.set(id, tile);
    return tile;
  }

  /** The nucleus being gathered: its name, and a socket per wanted cluster. */
  private drawGoal(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, r: number): void {
    const s = this.state;
    const t = s.target;
    const sr = Math.min(r * 0.7, 26);
    ctx.font = `13px ${MONO}`;
    ctx.fillStyle = 'rgba(226, 220, 207, 0.7)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const label = `${sup(String(t.a))}${symbolOf(t.z)}`;
    ctx.font = `700 22px ${MONO}`;
    ctx.fillStyle = this.won ? '#e0503a' : 'rgba(226, 220, 207, 0.9)';
    ctx.fillText(label, x + 4, y + 22);
    ctx.font = `12px ${MONO}`;
    ctx.fillStyle = 'rgba(226, 220, 207, 0.55)';
    ctx.fillText(`${t.a} nucleons · ${t.z} p · ${t.a - t.z} n`, x + 4, y + 46);
    // Sockets, right-aligned, largest first.
    const gap = sr * 2 + 14;
    const total = s.sockets.length * gap;
    let cx = x + w - total + sr + 4;
    const cy = y + 34;
    this.socketAt = [];
    s.sockets.forEach((v, i) => {
      this.socketAt.push({ x: cx, y: cy });
      const filled = i < s.filled;
      const next = i === s.filled;
      if (filled) this.drawTile(ctx, { id: 0, v, spoiled: false }, cx, cy, sr, 1, false);
      else {
        ctx.strokeStyle = next ? '#e0503a' : 'rgba(226, 220, 207, 0.35)';
        ctx.lineWidth = next ? 2 : 1;
        ctx.setLineDash(next ? [] : [3, 4]);
        ctx.beginPath();
        ctx.arc(cx, cy, sr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = next ? '#e0503a' : 'rgba(226, 220, 207, 0.5)';
        ctx.font = `700 ${Math.round(sr * 0.8)}px ${MONO}`;
        ctx.textAlign = 'center';
        ctx.fillText(String(v), cx, cy + 1);
      }
      cx += gap;
    });
  }

  private drawTile(ctx: CanvasRenderingContext2D, tile: Tile, x: number, y: number, r: number, alpha: number, lit: boolean): void {
    ctx.save();
    ctx.globalAlpha = alpha * (tile.spoiled ? 0.55 : 1);
    if (lit) {
      ctx.shadowColor = 'rgba(224, 80, 58, 0.8)';
      ctx.shadowBlur = r * 0.8;
    }
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    const tone = Math.min(1, Math.log2(tile.v) / 6);
    if (tile.v === 1) { g.addColorStop(0, '#b3ab9c'); g.addColorStop(1, '#5f5a50'); }
    else { g.addColorStop(0, '#fbf8f0'); g.addColorStop(0.75, `rgb(${211 + 30 * tone}, ${205 + 10 * tone}, ${191 - 60 * tone})`); g.addColorStop(1, `rgb(${143 + 40 * tone}, ${136}, ${121 - 50 * tone})`); }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (tile.v > 1) this.drawNucleons(ctx, tile, x, y, r);
    if (tile.spoiled) {
      ctx.strokeStyle = 'rgba(224, 80, 58, 0.95)';
      ctx.lineWidth = Math.max(1.5, r * 0.08);
      ctx.beginPath();
      ctx.moveTo(x - r * 0.7, y - r * 0.5);
      ctx.lineTo(x - r * 0.15, y - r * 0.05);
      ctx.lineTo(x - r * 0.35, y + r * 0.35);
      ctx.lineTo(x + r * 0.25, y + r * 0.75);
      ctx.moveTo(x + r * 0.1, y - r * 0.85);
      ctx.lineTo(x + r * 0.35, y - r * 0.2);
      ctx.lineTo(x + r * 0.8, y + r * 0.1);
      ctx.stroke();
    }
    if (lit) {
      ctx.strokeStyle = '#e0503a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    const label = String(tile.v);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (tile.v > 1) {
      ctx.fillStyle = 'rgba(251, 248, 240, 0.85)';
      ctx.beginPath();
      ctx.ellipse(x, y, r * (label.length > 1 ? 0.56 : 0.42), r * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#1b1813';
    ctx.font = `700 ${Math.round(r * (label.length > 1 ? 0.6 : 0.78))}px ${MONO}`;
    ctx.fillText(label, x, y + 1);
    ctx.restore();
  }

  /** The nucleons packed inside a cluster, in a sunflower spiral. */
  private drawNucleons(ctx: CanvasRenderingContext2D, tile: Tile, x: number, y: number, r: number): void {
    const count = Math.min(tile.v, 64);
    const dot = Math.max(1.6, (r * 0.95) / Math.sqrt(count + 2));
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const k = (i + 0.5) / count;
      const rr = Math.sqrt(k) * (r - dot - 1);
      const a = i * golden;
      ctx.fillStyle = i % 2 ? 'rgba(120, 114, 104, 0.9)' : 'rgba(214, 150, 60, 0.9)';
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, dot, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
export function sup(s: string): string {
  return s.split('').map((c) => SUP[c] ?? c).join('');
}
