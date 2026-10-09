// Drawing and touch for the Merge puzzle: a swipe slides the board.

import { ALL_SYMBOLS } from '../core/elements';
import { cloneMerge, jammed, sameNucleus, slide, tileLabel, won, type Dir, type MergeState, type Nucleus, type Tile } from './merge';
import { droplet, ease, MONO, type Area, type Point, type PuzzleView } from './view';

const SLIDE_MS = 150;
const POP_MS = 260;
const SWIPE = 22;

const symbolOf = (z: number) => ALL_SYMBOLS[z - 1] ?? '?';

export class MergeView implements PuzzleView {
  private state: MergeState;
  private history: MergeState[] = [];
  private pressed: Point | null = null;
  private animAt = 0;
  private area: Area = { x: 0, y: 0, w: 1, h: 1 };
  private reduced: boolean;

  constructor(private readonly initial: MergeState, reducedMotion: boolean) {
    this.state = cloneMerge(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return won(this.state); }
  get stuck(): boolean { return !this.won && jammed(this.state); }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return null; }
  get clean(): boolean { return this.state.spoils === 0; }
  get target(): Nucleus { return this.state.target; }

  hint(): string {
    const t = tileLabel(this.state.target, symbolOf);
    if (this.won) return `That is ${sup(t.mass)}${t.name}: the nucleus is made.`;
    if (this.stuck) return 'Jammed: nothing can move. Restart the board.';
    if (this.state.moves === 0) return `<span class="hl">Swipe</span> to slide everything. Light nuclei fuse when they meet and add up. Make <span class="hl">${sup(t.mass)}${t.name}</span>.`;
    if (this.state.spoils && this.state.cells.some((c) => c?.spoiled)) return 'Too heavy: that one cracks. It crumbles on your next swipe.';
    return `Make ${sup(t.mass)}${t.name}: ${this.state.target.z} protons, ${this.state.target.a - this.state.target.z} neutrons.`;
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
    const side = Math.min(area.w, area.h - 70) * 0.94;
    const cell = side / n;
    const x0 = area.x + (area.w - side) / 2;
    const y0 = area.y + 60 + (area.h - 60 - side) / 2;
    const centre = (i: number): Point => ({ x: x0 + (i % n) * cell + cell / 2, y: y0 + Math.floor(i / n) * cell + cell / 2 });
    const r = cell * 0.4;

    // The goal, pinned above the board like a specimen label.
    this.drawGoal(ctx, x0 + side / 2, y0 - 34, r * 0.62);

    // The board: a faint ruled grid.
    ctx.strokeStyle = 'rgba(226, 220, 207, 0.16)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    for (let i = 0; i < n * n; i++) {
      const c = centre(i);
      ctx.strokeRect(c.x - cell / 2 + 3, c.y - cell / 2 + 3, cell - 6, cell - 6);
    }
    ctx.setLineDash([]);

    const t = this.reduced ? 1 : (now - this.animAt) / SLIDE_MS;
    const pop = this.reduced ? 1 : (now - this.animAt) / POP_MS;
    const sliding = t < 1;
    const byId = new Map<number, number>();
    this.state.cells.forEach((tile, i) => tile && byId.set(tile.id, i));

    if (sliding) {
      // Tiles in flight: each journey from last move, drawn where it is now on the way.
      for (const j of this.state.last) {
        const a = centre(j.from), b = centre(j.to);
        const p = { x: a.x + (b.x - a.x) * ease(t), y: a.y + (b.y - a.y) * ease(t) };
        const tile = j.into ? this.ghostOf(j.id) : this.state.cells[byId.get(j.id)!];
        if (tile) this.drawTile(ctx, tile, p.x, p.y, r, 1, false);
      }
    }
    for (const [i, tile] of this.state.cells.entries()) {
      if (!tile) continue;
      const inFlight = sliding && this.state.last.some((j) => j.id === tile.id || j.into === tile.id);
      if (inFlight) continue;
      const c = centre(i);
      const fresh = this.state.spawned.includes(tile.id);
      const scale = fresh ? ease(Math.min(1, pop)) : 1;
      const made = this.state.last.some((j) => j.into === tile.id) && pop < 1;
      this.drawTile(ctx, tile, c.x, c.y, r * (made ? 1 + 0.18 * Math.sin(Math.PI * pop) : scale), 1, sameNucleus(tile, this.state.target) && !tile.spoiled);
    }
  }

  /** Tiles that fused last move are gone from the board; remember what they looked like for the slide. */
  private ghosts = new Map<number, Tile>();

  private ghostOf(id: number): Tile | undefined {
    if (this.ghosts.has(id)) return this.ghosts.get(id);
    const prev = this.history[this.history.length - 1];
    const tile = prev?.cells.find((c) => c?.id === id) ?? undefined;
    if (tile) this.ghosts.set(id, tile);
    return tile;
  }

  private drawGoal(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
    const t = this.state.target;
    ctx.font = `13px ${MONO}`;
    ctx.fillStyle = 'rgba(226, 220, 207, 0.7)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('make', x - r - 10, y);
    this.drawTile(ctx, { ...t, id: 0, spoiled: false }, x, y, r, this.won ? 1 : 0.9, this.won);
    ctx.textAlign = 'left';
    ctx.fillText(`${t.z} p · ${t.a - t.z} n`, x + r + 10, y);
  }

  private drawTile(ctx: CanvasRenderingContext2D, tile: Tile, x: number, y: number, r: number, alpha: number, isTarget: boolean): void {
    const proton = tile.z === 1 && tile.a === 1;
    const neutron = tile.z === 0;
    ctx.save();
    ctx.globalAlpha = alpha * (tile.spoiled ? 0.55 : 1);
    if (isTarget) {
      ctx.shadowColor = 'rgba(224, 80, 58, 0.9)';
      ctx.shadowBlur = r * 0.9;
    }
    // The body: a warm proton, a grey neutron, or a silver droplet for anything bigger.
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    if (proton) { g.addColorStop(0, '#f2c56c'); g.addColorStop(1, '#a8701e'); }
    else if (neutron) { g.addColorStop(0, '#b3ab9c'); g.addColorStop(1, '#5f5a50'); }
    else { g.addColorStop(0, '#fbf8f0'); g.addColorStop(0.75, '#d3cdbf'); g.addColorStop(1, '#8f8879'); }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (!proton && !neutron) this.drawNucleons(ctx, tile, x, y, r);
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
    if (isTarget) {
      ctx.strokeStyle = '#e0503a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    const label = tileLabel(tile, symbolOf);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = proton || neutron ? '#1b1813' : '#1b1813';
    ctx.font = `700 ${Math.round(r * (label.name.length > 1 ? 0.62 : 0.78))}px ${MONO}`;
    if (!proton && !neutron) {
      ctx.fillStyle = 'rgba(251, 248, 240, 0.82)';
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.62, r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1b1813';
    }
    ctx.fillText(label.name, x + (label.mass ? r * 0.12 : 0), y);
    if (label.mass) {
      ctx.font = `700 ${Math.round(r * 0.36)}px ${MONO}`;
      ctx.textAlign = 'right';
      ctx.fillText(label.mass, x - r * 0.18, y - r * 0.3);
    }
    ctx.restore();
  }

  /** The nucleons packed inside a tile: protons warm, neutrons grey, in a sunflower spiral. */
  private drawNucleons(ctx: CanvasRenderingContext2D, tile: Tile, x: number, y: number, r: number): void {
    const count = tile.a;
    const dot = Math.max(2.2, (r * 0.95) / Math.sqrt(count + 2));
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const k = (i + 0.5) / count;
      const rr = Math.sqrt(k) * (r - dot - 1);
      const a = i * golden;
      const isProton = i % 2 === 0 ? i / 2 < tile.z : tile.z > Math.ceil(count / 2) && (i - 1) / 2 < tile.z - Math.ceil(count / 2);
      ctx.fillStyle = isProton ? 'rgba(214, 150, 60, 0.9)' : 'rgba(120, 114, 104, 0.9)';
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

export { droplet };
