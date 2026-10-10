// Drawing and touch for Rutherford Probe. The plate is a sheet of foil in a
// detector frame: tap a cell to probe it; long-press, or switch the tool under
// the plate to Mark, to flag a suspected nucleus. Tapping a probed cell whose
// count is met by marks probes the rest it covers. Ports line the frame at the
// end of every row and column: tap one to aim, tap it again to fire a beam.
// Keys: arrows move (out onto the frame to reach a port), Space or Enter probes
// or fires, F or M marks, Tab switches tool, Escape lowers an aimed port.

import { chord, cloneRutherford, fire, nextLead, portLine, probe, remaining, scope, solved, toggleMark, traceBeam, type CellKind, type RutherfordState, type Side } from './rutherford';
import { C, font, tile } from './palette';
import { drawHelpMark, type Area, type Help, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

const LONG_MS = 380;
const BAR_H = 48;
/** The port band on each side of the foil, in cells. */
const BAND = 0.62;
/** Animation pace, ms. */
const PROBE_IN = 150;
const RIPPLE = 28;
const BEAM_STEP = 55;

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">A gate: played once, it opens the nucleus view. The plate is 7x7 up to z 20, 8x8 to z 50, 9x9 to z 85 and 10x10 beyond, with nuclei on 15% of cells rising to 20%, and scatter and quiet cells growing from about 6% and 4% of empty cells to 12% and 10%. The opening region is small, so beams are part of every plate: par is 2 beams up to z 50 and 3 beyond, the number a solver needed when it chose each beam only from what it could see. Flawless means no direct hit and no more beams than par. There is no move par; moves count probes, clears and beams, and undo refunds them, though an undone hit or beam still counts against flawless. Every plate is checked so a careful player never has to guess.</p>`;

interface Layout {
  cell: number;
  /** The foil's top-left corner. */
  x: number;
  y: number;
  band: number;
  frame: { x: number; y: number; w: number };
  bar: { x: number; y: number; w: number; h: number; seg: number };
}

/** A cell (r, c inside the plate) or a port (one of r, c is -1 or size). */
interface Spot { r: number; c: number }

type Fx =
  | { type: 'probe'; at: number; cell: number; hit: boolean }
  | { type: 'beam'; at: number; port: number; path: number; stop: boolean };

export class RutherfordView implements PuzzleView {
  private state: RutherfordState;
  private history: RutherfordState[] = [];
  private marking = false;
  private press: { p: Point; at: number; cell: number; fired: boolean } | null = null;
  private cursor: Spot | null = null;
  private armed = -1;
  private lay: Layout | null = null;
  private wonAt = 0;
  private reduced: boolean;
  /** Spoilers that undo does not take back: nuclei ever hit and ports ever fired. */
  private everHit = new Set<number>();
  private everFired = new Set<number>();
  private fx: Fx[] = [];
  /** Cells shown as foil until this time, while a particle is on its way. */
  private reveal = new Map<number, number>();
  /** Look here: the cells (the one decided first) and the port to ring, for the plate it was asked on. */
  private mark: { state: RutherfordState; cells: number[]; port: number } | null = null;

  constructor(private readonly initial: RutherfordState, reducedMotion: boolean) {
    this.state = cloneRutherford(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return false; }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return null; }
  stats(): { progress: Stat; par: Stat } {
    const s = this.state;
    return {
      progress: { label: 'Found', value: `${s.total - remaining(s)}/${s.total}` },
      par: { label: 'Beams', value: `${this.beamsUsed}/${s.beamPar}` },
    };
  }
  get clean(): boolean { return this.everHit.size === 0 && this.everFired.size <= this.state.beamPar; }

  /** Beams that count against the par: every port fired, undone or not. */
  get beamsUsed(): number { return this.everFired.size; }

  hint(): string {
    const hits = this.everHit.size;
    const beams = `beams ${this.beamsUsed}/${this.state.beamPar}`;
    const hitText = hits ? ` · ${hits} hit${hits === 1 ? '' : 's'}` : '';
    if (this.won) return `All nuclei found · ${beams}${hitText}`;
    const left = remaining(this.state);
    return `${left} nucle${left === 1 ? 'us' : 'i'} left · ${beams}${hitText}`;
  }

  help(level: 1 | 2): Help | null {
    const s = this.state;
    if (this.won) return null;
    const n = s.size;
    const show = (cells: number[], port = -1) => {
      this.mark = { state: s, cells, port };
      if (cells.length) this.cursor = { r: Math.floor(cells[0] / n), c: cells[0] % n };
    };
    // A mark on a safe cell comes first: it blocks the cell and misleads every number around it.
    const wrong = s.marked.findIndex((m, i) => m && !s.nuclei[i]);
    if (wrong >= 0) {
      if (level === 2) {
        this.cursor = { r: Math.floor(wrong / n), c: wrong % n };
        this.act(wrong, true);
        return { text: 'Removed a mark from a safe cell.', moved: true };
      }
      show([wrong]);
      return { text: 'This mark is on a safe cell.' };
    }
    const lead = nextLead(s);
    if (!lead) {
      // Nothing left to prove or learn from a beam (the solver never gets here on a dealt plate): point at a safe cell.
      const i = s.nuclei.findIndex((x, j) => !x && !s.probed[j]);
      if (level === 2) {
        this.cursor = { r: Math.floor(i / n), c: i % n };
        this.act(i, false);
        return { text: 'Probed a safe cell.', moved: true };
      }
      show([i]);
      return { text: 'This cell is safe to probe.' };
    }
    if (lead.kind === 'beam') {
      if (level === 2) {
        this.shoot(lead.port);
        return { text: 'Fired a beam to learn more.', moved: true };
      }
      show([], lead.port);
      return { text: 'No cell is certain yet, so a beam from this port will tell you more.' };
    }
    const { cell, nucleus, clues, pair } = lead;
    if (level === 2) {
      this.cursor = { r: Math.floor(cell / n), c: cell % n };
      this.act(cell, nucleus);
      return { text: nucleus ? 'Marked a cell that must hold a nucleus.' : 'Probed a cell the numbers prove safe.', moved: true };
    }
    show([cell, ...clues]);
    const verdict = nucleus ? 'this cell holds a nucleus' : 'this cell is safe';
    const text = pair ? (clues.length === 2 ? `Comparing these two numbers shows ${verdict}.` : `Comparing that number with the nuclei left shows ${verdict}.`)
      : clues.length ? (nucleus ? `That number needs every cell it has left, so ${verdict}.` : `That number's nuclei are all marked or found, so ${verdict}.`)
      : nucleus ? 'The nuclei left fill every unknown cell, so this one holds a nucleus.'
      : `Every nucleus is marked or found, so ${verdict}.`;
    return { text };
  }

  restart(): void {
    this.state = cloneRutherford(this.initial);
    this.history = [];
    this.mark = null;
    this.marking = false;
    this.armed = -1;
    this.everHit.clear();
    this.everFired.clear();
    this.fx = [];
    this.reveal.clear();
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    // Undo is free (the move count goes back too), but a hit or a fired beam stays on the record for a flawless run.
    this.state = prev;
    this.armed = -1;
    this.mark = null;
    this.fx = [];
    this.reveal.clear();
    return true;
  }

  private commit(next: RutherfordState | null, effect?: (prev: RutherfordState, next: RutherfordState, now: number) => void): void {
    if (!next || this.won) return;
    const prev = this.state;
    this.history.push(prev);
    if (this.history.length > 50) this.history.shift();
    this.state = next;
    for (let i = 0; i < next.nuclei.length; i++) if (next.probed[i] && next.nuclei[i] && !prev.probed[i]) this.everHit.add(i);
    const now = performance.now();
    if (!this.reduced && effect) effect(prev, next, now);
    if (solved(next)) {
      let last = now;
      for (const t of this.reveal.values()) last = Math.max(last, t);
      this.wonAt = last;
    }
  }

  /** Cells newly opened by a move appear in a ripple outward from where it landed. */
  private ripple(prev: RutherfordState, next: RutherfordState, from: number[], at: number): void {
    const n = next.size;
    for (let i = 0; i < next.nuclei.length; i++) {
      if (!next.probed[i] || prev.probed[i] || this.reveal.has(i)) continue;
      let d = Infinity;
      for (const f of from) d = Math.min(d, Math.max(Math.abs(Math.floor(i / n) - Math.floor(f / n)), Math.abs((i % n) - (f % n))));
      this.reveal.set(i, at + RIPPLE * (Number.isFinite(d) ? d : 0));
    }
  }

  private act(i: number, mark: boolean): void {
    const s = this.state;
    if (s.probed[i]) {
      this.commit(chord(s, i), (a, b, now) => this.ripple(a, b, [i], now));
    } else if (mark) {
      this.commit(toggleMark(s, i));
    } else {
      this.commit(probe(s, i), (a, b, now) => {
        this.fx.push({ type: 'probe', at: now, cell: i, hit: b.nuclei[i] });
        this.reveal.set(i, now + PROBE_IN);
        this.ripple(a, b, [i], now + PROBE_IN);
      });
    }
  }

  private shoot(port: number): void {
    this.armed = -1;
    const next = fire(this.state, port);
    if (!next) return;
    this.everFired.add(port);
    this.commit(next, (a, b, now) => {
      const { path, stop } = traceBeam(b, port);
      path.forEach((cell, k) => { if (!a.probed[cell]) this.reveal.set(cell, now + BEAM_STEP * (k + 1)); });
      const end = now + BEAM_STEP * (path.length + 1);
      if (stop !== null && b.found[stop] && !a.found[stop]) this.reveal.set(stop, end);
      this.ripple(a, b, path, end);
      this.fx.push({ type: 'beam', at: now, port, path: path.length, stop: stop !== null });
    });
  }

  /** Tapping a port aims it; tapping the aimed port again fires. */
  private tapPort(port: number): void {
    if (this.state.fired[port] || this.won) { this.armed = -1; return; }
    if (this.armed === port) this.shoot(port);
    else this.armed = port;
  }

  // ---- input ----------------------------------------------------------------------

  private spotAt(p: Point): Spot | null {
    const L = this.lay;
    if (!L) return null;
    const n = this.state.size;
    const c = Math.floor((p.x - L.x) / L.cell), r = Math.floor((p.y - L.y) / L.cell);
    if (c >= 0 && r >= 0 && c < n && r < n) return { r, c };
    // Ports: anywhere in the band beside a row or column, with some slack beyond the frame.
    const reach = L.band + 10;
    const inRow = r >= 0 && r < n, inCol = c >= 0 && c < n;
    if (inCol && p.y < L.y && p.y >= L.y - reach) return { r: -1, c };
    if (inCol && p.y >= L.y + n * L.cell && p.y < L.y + n * L.cell + reach) return { r: n, c };
    if (inRow && p.x < L.x && p.x >= L.x - reach) return { r, c: -1 };
    if (inRow && p.x >= L.x + n * L.cell && p.x < L.x + n * L.cell + reach) return { r, c: n };
    return null;
  }

  private cellOf(s: Spot | null): number {
    const n = this.state.size;
    return s && s.r >= 0 && s.c >= 0 && s.r < n && s.c < n ? s.r * n + s.c : -1;
  }

  private portOf(s: Spot | null): number {
    const n = this.state.size;
    if (!s) return -1;
    if (s.r === -1 && s.c >= 0 && s.c < n) return s.c;
    if (s.c === n && s.r >= 0 && s.r < n) return n + s.r;
    if (s.r === n && s.c >= 0 && s.c < n) return 2 * n + s.c;
    if (s.c === -1 && s.r >= 0 && s.r < n) return 3 * n + s.r;
    return -1;
  }

  private barAt(p: Point): number {
    const b = this.lay?.bar;
    if (!b || p.y < b.y || p.y > b.y + b.h || p.x < b.x || p.x > b.x + b.seg * 2) return -1;
    return p.x < b.x + b.seg ? 0 : 1;
  }

  down(p: Point): void {
    this.press = { p, at: performance.now(), cell: this.cellOf(this.spotAt(p)), fired: false };
  }

  move(p: Point): void {
    if (this.press && Math.hypot(p.x - this.press.p.x, p.y - this.press.p.y) > 12) this.press.cell = -1;
  }

  up(p: Point): void {
    const pr = this.press;
    this.press = null;
    if (!pr || pr.fired || Math.hypot(p.x - pr.p.x, p.y - pr.p.y) > 12) return;
    const seg = this.barAt(p);
    if (seg >= 0) { this.marking = seg === 1; this.armed = -1; return; }
    const spot = this.spotAt(p);
    const port = this.portOf(spot);
    if (port >= 0) { this.cursor = spot; this.tapPort(port); return; }
    this.armed = -1;
    const cell = this.cellOf(spot);
    if (cell >= 0 && cell === pr.cell && !this.won) {
      this.cursor = spot;
      this.act(cell, this.marking);
    }
  }

  cancel(): void { this.press = null; }

  key(e: KeyboardEvent): boolean {
    const n = this.state.size;
    const go = (dr: number, dc: number) => {
      if (!this.cursor) { this.cursor = { r: Math.floor(n / 2), c: Math.floor(n / 2) }; return; }
      const r = Math.max(-1, Math.min(n, this.cursor.r + dr)), c = Math.max(-1, Math.min(n, this.cursor.c + dc));
      const corner = (r === -1 || r === n) && (c === -1 || c === n);
      if (!corner) this.cursor = { r, c };
      if (this.portOf(this.cursor) !== this.armed) this.armed = -1;
    };
    if (e.key === 'ArrowUp') { go(-1, 0); return true; }
    if (e.key === 'ArrowDown') { go(1, 0); return true; }
    if (e.key === 'ArrowLeft') { go(0, -1); return true; }
    if (e.key === 'ArrowRight') { go(0, 1); return true; }
    if (e.key === 'Tab') { this.marking = !this.marking; return true; }
    if (e.key === 'Escape' && this.armed >= 0) { this.armed = -1; return true; }
    if (!this.cursor || this.won) return false;
    const port = this.portOf(this.cursor), cell = this.cellOf(this.cursor);
    if (e.key === ' ' || e.key === 'Enter') {
      if (port >= 0) this.tapPort(port);
      else if (cell >= 0) this.act(cell, false);
      return true;
    }
    if ((e.key === 'f' || e.key === 'm') && cell >= 0) { this.act(cell, true); return true; }
    return false;
  }

  // ---- drawing --------------------------------------------------------------------

  private layout(area: Area): Layout {
    const n = this.state.size;
    const unit = n + 2 * BAND;
    const availW = Math.max(1, area.w - 16), availH = Math.max(1, area.h - 16 - BAR_H - 10);
    const cell = Math.max(4, Math.min(availW / unit, availH / unit, 58));
    const band = cell * BAND, fw = cell * unit;
    const fx = area.x + (area.w - fw) / 2, fy = area.y + 8 + (availH - fw) / 2;
    const w = Math.min(area.w - 16, Math.max(fw, 300));
    const seg = Math.min(100, (w - 130) / 2);
    return {
      cell, band, x: fx + band, y: fy + band,
      frame: { x: fx, y: fy, w: fw },
      bar: { x: area.x + (area.w - w) / 2, y: fy + fw + 10, w, h: BAR_H, seg },
    };
  }

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const L = (this.lay = this.layout(area));
    const n = s.size, c = L.cell;

    // A long press marks without waiting for the finger to lift.
    const pr = this.press;
    if (pr && !pr.fired && pr.cell >= 0 && now - pr.at >= LONG_MS && !this.won && !s.probed[pr.cell] && !s.found[pr.cell]) {
      pr.fired = true;
      this.cursor = { r: Math.floor(pr.cell / n), c: pr.cell % n };
      this.act(pr.cell, true);
    }
    for (const [i, t] of this.reveal) if (t <= now) this.reveal.delete(i);
    const hidden = (i: number) => (this.reveal.get(i) ?? 0) > now;

    const won = this.won;
    const glow = won ? (this.reduced ? 1 : Math.max(0, Math.min(1, (now - this.wonAt) / 700))) : 0;
    const cur = this.cellOf(this.cursor);
    const focus = cur >= 0 && s.probed[cur] && s.kind[cur] === 'scatter' ? new Set(scope(s, cur)) : null;

    // The detector frame, then the foil.
    tile(ctx, L.frame.x, L.frame.y, L.frame.w, L.frame.w, L.band * 0.7, C.surface, C.line2, 1);
    foilSheet(ctx, L.x, L.y, n, n, c);

    for (let i = 0; i < n * n; i++) {
      const x = L.x + (i % n) * c, y = L.y + Math.floor(i / n) * c;
      const open = s.probed[i] && !hidden(i);
      const found = s.found[i] && !hidden(i);
      if (!open && !found) {
        if (focus?.has(i)) cellHighlight(ctx, x, y, c);
        if (won && s.nuclei[i]) nucleusGlyph(ctx, x + c / 2, y + c / 2, c * 0.3, glow);
        if (s.marked[i]) reticle(ctx, x + c / 2, y + c / 2, c * 0.27);
        continue;
      }
      if (s.nuclei[i]) {
        nucleusCell(ctx, x, y, c, found ? 'found' : 'hit');
        continue;
      }
      well(ctx, x, y, c, focus?.has(i) ? C.surface : C.plate);
      cellFace(ctx, x, y, c, s.kind[i], s.clue[i], cur === i);
    }

    // Spent beams leave their track; the aimed one shows where it would go.
    for (let p = 0; p < s.fired.length; p++) {
      if (!s.fired[p] || this.fx.some((f) => f.type === 'beam' && f.port === p)) continue;
      const { path, stop } = traceBeam(s, p);
      track(ctx, L, n, p, path.length, stop !== null);
    }
    if (this.armed >= 0 && !won) aimLine(ctx, L, n, this.armed, now);
    for (let p = 0; p < 4 * n; p++) {
      const { x, y, side } = portPoint(L, n, p);
      portGlyph(ctx, x, y, side, c, s.fired[p] ? 'spent' : this.armed === p ? 'armed' : 'idle', won);
    }

    // Look here: the cell the numbers decide and the numbers that decide it, or the port to fire.
    const m = this.mark?.state === s && !won ? this.mark : null;
    if (m) {
      for (const i of m.cells) drawHelpMark(ctx, L.x + (i % n) * c + 2, L.y + Math.floor(i / n) * c + 2, c - 4, c - 4, now, this.reduced, c * 0.2);
      if (m.port >= 0) {
        const q = portPoint(L, n, m.port);
        drawHelpMark(ctx, q.x - c * 0.34, q.y - c * 0.34, c * 0.68, c * 0.68, now, this.reduced, c * 0.16);
      }
    }

    // The long-press ring, then the cursor.
    if (pr && !pr.fired && pr.cell >= 0 && !s.probed[pr.cell] && now - pr.at > 120) {
      const k = Math.min(1, (now - pr.at - 120) / (LONG_MS - 120));
      const x = L.x + (pr.cell % n) * c + c / 2, y = L.y + Math.floor(pr.cell / n) * c + c / 2;
      pressRing(ctx, x, y, c * 0.36, k);
    }
    if (this.cursor && !won) {
      const port = this.portOf(this.cursor);
      if (port >= 0) {
        const q = portPoint(L, n, port);
        tile(ctx, q.x - c * 0.34, q.y - c * 0.34, c * 0.68, c * 0.68, c * 0.16, null, C.accent, 1.5);
      } else {
        const x = L.x + this.cursor.c * c, y = L.y + this.cursor.r * c;
        tile(ctx, x + 1, y + 1, c - 2, c - 2, c * 0.2, null, C.accent, 1.5);
      }
    }

    this.drawFx(ctx, L, now);
    this.drawBar(ctx, L, won);
  }

  private drawFx(ctx: CanvasRenderingContext2D, L: Layout, now: number): void {
    const n = this.state.size, c = L.cell;
    this.fx = this.fx.filter((f) => {
      const t = now - f.at;
      if (f.type === 'probe') {
        const x = L.x + (f.cell % n) * c + c / 2, y = L.y + Math.floor(f.cell / n) * c + c / 2;
        probeFx(ctx, x, y, c, t, f.hit);
        return t < PROBE_IN + 260;
      }
      const { x, y, side } = portPoint(L, n, f.port);
      const [dx, dy] = DIRS[side];
      return beamFx(ctx, x, y, dx, dy, c, L.band, n, f.path, f.stop, t);
    });
  }

  private drawBar(ctx: CanvasRenderingContext2D, L: Layout, won: boolean): void {
    const s = this.state, b = L.bar;
    const segs: [string, boolean][] = [['Probe', !this.marking], ['Mark', this.marking]];
    segs.forEach(([label, on], k) => {
      const sx = b.x + k * b.seg;
      tile(ctx, sx + 2, b.y + 2, b.seg - 4, b.h - 4, (b.h - 4) * 0.3, on ? C.surface2 : null, on ? C.line3 : C.line, 1);
      const ix = sx + Math.min(26, b.seg * 0.26), iy = b.y + b.h / 2;
      if (k === 0) alphaGlyph(ctx, ix, iy, 5, on ? 1 : 0.45);
      else reticle(ctx, ix, iy, 7, on ? 1 : 0.45);
      ctx.fillStyle = on ? C.text : C.text2;
      ctx.font = font(14, 500);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, ix + 12, iy + 1);
    });
    counters(ctx, b.x + b.w - 4, b.y + b.h / 2, won ? 0 : remaining(s), this.beamsUsed, s.beamPar);
  }
}

// ---- drawing helpers, shared by the board and the rule demos ---------------------------

const DIRS: Record<Side, [number, number]> = { 0: [0, 1], 1: [-1, 0], 2: [0, -1], 3: [1, 0] };

/** The center of a port in the frame band. */
function portPoint(L: Pick<Layout, 'x' | 'y' | 'cell' | 'band'>, n: number, port: number): { x: number; y: number; side: Side } {
  const side = Math.floor(port / n) as Side, k = port % n, c = L.cell, h = L.band / 2;
  if (side === 0) return { x: L.x + (k + 0.5) * c, y: L.y - h, side };
  if (side === 1) return { x: L.x + n * c + h, y: L.y + (k + 0.5) * c, side };
  if (side === 2) return { x: L.x + (k + 0.5) * c, y: L.y + n * c + h, side };
  return { x: L.x - h, y: L.y + (k + 0.5) * c, side };
}

/** The foil: one flat sheet with fine seams and a faint brushed grain. */
function foilSheet(ctx: CanvasRenderingContext2D, x: number, y: number, cols: number, rows: number, c: number): void {
  tile(ctx, x, y, cols * c, rows * c, c * 0.14, C.surface3, null);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, cols * c, rows * c, c * 0.14);
  ctx.clip();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = -rows; k < cols; k += 0.5) {
    ctx.moveTo(x + k * c, y + rows * c);
    ctx.lineTo(x + (k + rows) * c, y);
  }
  ctx.globalAlpha = 0.35;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = C.surface;
  ctx.beginPath();
  for (let k = 1; k < cols; k++) { ctx.moveTo(x + k * c, y); ctx.lineTo(x + k * c, y + rows * c); }
  for (let k = 1; k < rows; k++) { ctx.moveTo(x, y + k * c); ctx.lineTo(x + cols * c, y + k * c); }
  ctx.stroke();
  ctx.restore();
}

function inset(c: number): { pad: number; w: number; rad: number } {
  const pad = Math.max(1.5, c * 0.06);
  return { pad, w: c - pad * 2, rad: c * 0.16 };
}

/** A probed cell: punched through the foil to the dark plate beneath. */
function well(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, fill: string = C.plate, stroke: string | null = null, lw = 1): void {
  const { pad, w, rad } = inset(c);
  tile(ctx, x + pad, y + pad, w, w, rad, fill, stroke, lw);
}

/** A foil cell lit up because the count under the cursor covers it. */
function cellHighlight(ctx: CanvasRenderingContext2D, x: number, y: number, c: number): void {
  ctx.fillStyle = C.line;
  ctx.fillRect(x + 0.5, y + 0.5, c - 1, c - 1);
}

/** What an open, safe cell shows: its count, scatter ticks, or a quiet "?". */
function cellFace(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, kind: CellKind, clue: number, active = false, alpha = 1): void {
  const { pad, w } = inset(c);
  const cx = x + c / 2, cy = y + c / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (kind === 'quiet') {
    ctx.fillStyle = C.text3;
    ctx.font = font(w * 0.46, 500);
    ctx.fillText('?', cx, cy + w * 0.02);
  } else {
    if (kind === 'scatter') ticks(ctx, x + pad, y + pad, w, active ? C.silver : C.text2);
    if (clue > 0 || kind === 'scatter') {
      ctx.fillStyle = kind === 'scatter' ? C.silver : C.text;
      ctx.font = font(w * 0.48, kind === 'scatter' ? 600 : 500);
      ctx.fillText(String(clue), cx, cy + w * 0.03);
    }
  }
  ctx.restore();
}

/** A nucleus out in the open: found by a beam (quiet rim) or hit by a probe (red rim). */
function nucleusCell(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, how: 'found' | 'hit', alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (how === 'hit') well(ctx, x, y, c, C.plate, C.bad, 1.5);
  else well(ctx, x, y, c, C.plate, C.line3, 1);
  ctx.restore();
  nucleusGlyph(ctx, x + c / 2, y + c / 2, c * 0.3, alpha);
}

/** A nucleus: a tight knot of protons and neutrons. */
function nucleusGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number): void {
  if (alpha <= 0) return;
  const br = r * 0.38;
  const beads: [number, number, string][] = [[0, 0, C.proton]];
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 6 + (k * Math.PI) / 3;
    beads.push([Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, k % 2 ? C.proton : C.neutron]);
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = Math.max(0.75, br * 0.18);
  ctx.strokeStyle = C.plate;
  // Back beads first, the center one on top.
  for (const [dx, dy, col] of [...beads.slice(1), beads[0]]) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** An alpha particle: two protons and two neutrons. */
function alphaGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha = 1): void {
  if (alpha <= 0) return;
  const br = r * 0.56, o = r * 0.46;
  const beads: [number, number, string][] = [[-o, -o, C.proton], [o, -o, C.neutron], [-o, o, C.neutron], [o, o, C.proton]];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = Math.max(0.6, br * 0.2);
  ctx.strokeStyle = C.plate;
  for (const [dx, dy, col] of beads) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, br, 0, Math.PI * 2);
    ctx.fill();
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

/** The long-press ring filling toward a mark. */
function pressRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, k: number): void {
  ctx.save();
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
  ctx.stroke();
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

/** A beam port in the frame: a slit with a chevron pointing into the foil. */
function portGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, side: Side, c: number, how: 'idle' | 'armed' | 'spent', dim = false): void {
  const [dx, dy] = DIRS[side];
  const half = c * 0.2, back = c * 0.1;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (how === 'spent') {
    ctx.strokeStyle = C.line2;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - back * dx - half * dy, y - back * dy - half * dx);
    ctx.lineTo(x - back * dx + half * dy, y - back * dy + half * dx);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const col = how === 'armed' ? C.accent : C.pewter;
  if (how === 'armed') {
    tile(ctx, x - c * 0.3, y - c * 0.3, c * 0.6, c * 0.6, c * 0.14, C.surface2, C.accent, 1);
  }
  ctx.globalAlpha = dim ? 0.4 : 1;
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(1.5, c * 0.05);
  ctx.beginPath();
  ctx.moveTo(x - back * dx - half * dy, y - back * dy - half * dx);
  ctx.lineTo(x - back * dx + half * dy, y - back * dy + half * dx);
  ctx.stroke();
  const tip = c * 0.16, wing = c * 0.1;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(x + tip * dx, y + tip * dy);
  ctx.lineTo(x + wing * 0.2 * dx - wing * dy, y + wing * 0.2 * dy - wing * dx);
  ctx.lineTo(x + wing * 0.2 * dx + wing * dy, y + wing * 0.2 * dy + wing * dx);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * A spent beam's track: fine dots on the seams it crossed, ending in a small
 * bar where it bounced, or running out through the far side.
 */
function track(ctx: CanvasRenderingContext2D, L: Pick<Layout, 'x' | 'y' | 'cell' | 'band'>, n: number, port: number, cells: number, stop: boolean, alpha = 1): void {
  const { x, y, side } = portPoint(L, n, port);
  const [dx, dy] = DIRS[side];
  const c = L.cell, h = L.band / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = C.line3;
  // Distance from the port to the seam before cell k is h + k * c.
  for (let k = 0; k <= cells; k++) {
    if (k === cells && stop) break;
    if (k === n) break;
    ctx.beginPath();
    ctx.arc(x + dx * (h + k * c), y + dy * (h + k * c), Math.max(1.2, c * 0.04), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = C.line3;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (stop) {
    // The bounce: a short bar on the near face of the nucleus's cell.
    const d = h + cells * c - 1.5, half = c * 0.22;
    ctx.moveTo(x + dx * d - dy * half, y + dy * d - dx * half);
    ctx.lineTo(x + dx * d + dy * half, y + dy * d + dx * half);
  } else {
    // Out through the far side.
    const d0 = h + n * c, d1 = d0 + h * 0.8;
    ctx.moveTo(x + dx * d0, y + dy * d0);
    ctx.lineTo(x + dx * d1, y + dy * d1);
  }
  ctx.stroke();
  ctx.restore();
}

/** The aimed port's line across the foil, breathing in the selection color. */
function aimLine(ctx: CanvasRenderingContext2D, L: Layout, n: number, port: number, now: number): void {
  const { x, y, side } = portPoint(L, n, port);
  const [dx, dy] = DIRS[side];
  const len = L.band / 2 + n * L.cell;
  ctx.save();
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 5]);
  ctx.lineDashOffset = -now / 40;
  ctx.globalAlpha = 0.55 + 0.25 * Math.sin(now / 260);
  ctx.beginPath();
  ctx.moveTo(x + dx * L.cell * 0.2, y + dy * L.cell * 0.2);
  ctx.lineTo(x + dx * len, y + dy * len);
  ctx.stroke();
  ctx.restore();
}

/** A probe: an alpha particle streaks into the cell, then passes through or bounces off a nucleus. */
function probeFx(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, t: number, hit: boolean): void {
  const ax = -0.55, ay = -0.83; // where it comes from: up and to the left
  const far = c * 1.3, r = Math.max(3, c * 0.12);
  let d: number, alpha = 1;
  if (t < PROBE_IN) d = far * (1 - t / PROBE_IN);
  else {
    const k = Math.min(1, (t - PROBE_IN) / 260);
    d = (hit ? 1 : -1) * far * 0.9 * k;
    alpha = 1 - k;
    ctx.save();
    ctx.strokeStyle = hit ? C.bad : C.line3;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = (1 - k) * 0.9;
    ctx.beginPath();
    ctx.arc(x, y, c * (0.2 + 0.35 * k), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  const px = x + ax * d, py = y + ay * d;
  streak(ctx, px, py, -ax * (t < PROBE_IN || !hit ? 1 : -1), -ay * (t < PROBE_IN || !hit ? 1 : -1), c * 0.5, alpha);
  alphaGlyph(ctx, px, py, r, alpha);
}

/** A fading tail behind a moving particle heading along (dx, dy). */
function streak(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, len: number, alpha: number): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.strokeStyle = C.silverDim;
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    ctx.globalAlpha = alpha * (0.45 - k * 0.13);
    ctx.lineWidth = 2 - k * 0.5;
    ctx.beginPath();
    ctx.moveTo(x - dx * len * (k / 3), y - dy * len * (k / 3));
    ctx.lineTo(x - dx * len * ((k + 1) / 3), y - dy * len * ((k + 1) / 3));
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A beam in flight from the port at (x, y): out along the line, one cell per
 * step, then back from a nucleus or out the far side. False once it is over.
 */
function beamFx(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, c: number, band: number, n: number, cells: number, stop: boolean, t: number): boolean {
  const h = band / 2;
  const out = h + cells * c - (stop ? c * 0.12 : -h * 1.6); // where it turns or leaves
  const tOut = BEAM_STEP * (cells + 1);
  const tBack = stop ? BEAM_STEP * 0.6 * (cells + 1) : 180;
  const r = Math.max(3, c * 0.12);
  let d: number, dir = 1, alpha = 1;
  if (t < tOut) d = (out * t) / tOut;
  else if (stop) {
    const k = Math.min(1, (t - tOut) / tBack);
    d = out * (1 - k);
    dir = -1;
    alpha = 1 - k * 0.7;
    // The flash where it bounced.
    const ring = Math.min(1, (t - tOut) / 300);
    ctx.save();
    ctx.strokeStyle = C.silver;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 1 - ring;
    ctx.beginPath();
    ctx.arc(x + dx * (out + c * 0.5), y + dy * (out + c * 0.5), c * (0.25 + 0.3 * ring), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  } else {
    const k = Math.min(1, (t - tOut) / tBack);
    d = out + h * k;
    alpha = 1 - k;
  }
  streak(ctx, x + dx * d, y + dy * d, dx * dir, dy * dir, c * 1.1, alpha);
  alphaGlyph(ctx, x + dx * d, y + dy * d, r, alpha);
  return t < tOut + tBack;
}

/** The counters under the plate, right-aligned at x: beams used of par, then nuclei left. Returns the left edge. */
function counters(ctx: CanvasRenderingContext2D, x: number, y: number, left: number, used: number, par: number, draw = true): number {
  ctx.save();
  ctx.font = font(13, 500);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = C.text2;
  const nt = String(left);
  const bt = `${used}/${par}`;
  const cx = x - ctx.measureText(nt).width - 12;
  const bx = cx - 22, ax = bx - ctx.measureText(bt).width - 10;
  if (draw) {
    ctx.fillText(nt, x, y + 1);
    nucleusGlyph(ctx, cx, y, 7, 1);
    ctx.fillStyle = used > par ? C.warn : C.text2;
    ctx.fillText(bt, bx, y + 1);
    streak(ctx, ax - 3, y, 1, 0, 9, 1);
    alphaGlyph(ctx, ax, y, 5, 1);
  }
  ctx.restore();
  return ax - 14;
}

// ---- rule cards -----------------------------------------------------------------------

/** A small piece of plate centered in the demo box, with room for a port band when asked. */
function mini(w: number, h: number, cols: number, rows: number, bands = 0): { c: number; x: number; y: number } {
  const c = Math.min((w * 0.92) / (cols + 2 * bands * BAND), (h * 0.9) / (rows + 2 * bands * BAND));
  return { c, x: (w - cols * c) / 2, y: (h - rows * c) / 2 };
}

const at = (g: { c: number; x: number; y: number }, col: number, row: number) => ({ x: g.x + col * g.c, y: g.y + row * g.c });
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** A 1 x len row with a port on the left, for the beam pictures; `bands` widens the margin for a beam that leaves through the far side. Returns its layout. */
function beamRow(ctx: CanvasRenderingContext2D, w: number, h: number, len: number, opened: number, stopAt: number | null, foundAlpha: number, bands = 1): Pick<Layout, 'x' | 'y' | 'cell' | 'band'> {
  const g = mini(w, h, len, 1.6, bands);
  const L = { x: g.x, y: g.y + g.c * 0.3, cell: g.c, band: g.c * BAND };
  foilSheet(ctx, L.x, L.y, len, 1, g.c);
  for (let k = 0; k < len; k++) {
    const x = L.x + k * g.c;
    if (k === stopAt) { if (foundAlpha > 0) nucleusCell(ctx, x, L.y, g.c, 'found', foundAlpha); continue; }
    if (k < opened) { well(ctx, x, L.y, g.c); cellFace(ctx, x, L.y, g.c, 'plain', DEMO_ROW[k]); }
  }
  return L;
}

const DEMO_ROW = [0, 1, 2];
/** When a picture's probe lands, in seconds. */
const TAP = 0.4;
const opened = (t: number) => t > TAP + PROBE_IN / 1000;
const probing = (t: number) => t > TAP && t < TAP + (PROBE_IN + 260) / 1000;

/** An open, safe cell of a demo plate. */
function openCell(ctx: CanvasRenderingContext2D, g: { c: number; x: number; y: number }, col: number, row: number, kind: CellKind, clue: number, active = false): void {
  const q = at(g, col, row);
  well(ctx, q.x, q.y, g.c);
  cellFace(ctx, q.x, q.y, g.c, kind, clue, active);
}

/** An amber dashed square around a block of cells: what was misread or wrongly marked. */
function warnCells(ctx: CanvasRenderingContext2D, g: { c: number; x: number; y: number }, col: number, row: number, cols: number, rows: number, alpha: number): void {
  if (alpha <= 0) return;
  const q = at(g, col, row);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.setLineDash([4, 3]);
  tile(ctx, q.x + 1.5, q.y + 1.5, cols * g.c - 3, rows * g.c - 3, g.c * 0.2, null, C.warn, 2);
  ctx.restore();
}

/** Draws clipped to the picture's box: a beam's tail trails behind its port as it sets off, and a probe flies in from outside its cell. */
function inBox(ctx: CanvasRenderingContext2D, w: number, h: number, draw: () => void): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  draw();
  ctx.restore();
}

/** The counters under the plate, scaled up and centered in a demo box. */
function demoCounters(ctx: CanvasRenderingContext2D, w: number, h: number, left: number, used: number, par: number): void {
  const k = Math.min(1.5, w / 110);
  const span = -counters(ctx, 0, 0, left, 3, par, false);
  ctx.save();
  ctx.translate(w / 2 + (span * k) / 2, h / 2);
  ctx.scale(k, k);
  counters(ctx, 0, 0, left, used, par);
  ctx.restore();
}

/** Clear around: a 1 with one mark in its eight, tapped. The mark is right (good) or on the wrong cell (bad). */
function clearPicture(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, markAt: number): void {
  const g = mini(w, h, 3, 3);
  foilSheet(ctx, g.x, g.y, 3, 3, g.c);
  const faces = [0, 1, 1, 0, 1, 1, 0, 1, 0];
  const nucleus = 8, cleared = t > 1.1;
  for (let k = 0; k < 9; k++) {
    const col = k % 3, row = Math.floor(k / 3), q = at(g, col, row);
    if (k === markAt) { reticle(ctx, q.x + g.c / 2, q.y + g.c / 2, g.c * 0.27); continue; }
    const d = Math.max(Math.abs(col - 1), Math.abs(row - 1));
    if (k !== 4 && !(cleared && t > 1.1 + d * 0.08)) continue;
    if (k === nucleus) nucleusCell(ctx, q.x, q.y, g.c, 'hit');
    else openCell(ctx, g, col, row, 'plain', faces[k]);
  }
  const ctr = at(g, 1, 1);
  if (t > 0.6 && t < 1.2) tile(ctx, ctr.x + 1, ctr.y + 1, g.c - 2, g.c - 2, g.c * 0.2, null, C.accent, 1.5);
  if (markAt !== nucleus) warnCells(ctx, g, markAt % 3, Math.floor(markAt / 3), 1, 1, clamp01((t - 1.5) / 0.3));
}

/** A scatter 2 on a 5 x 5 plate, read along its row and column (good) or, wrongly, as its eight neighbors (bad). */
function scatterPicture(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, lines: boolean): void {
  const g = mini(w, h, 5, 5);
  foilSheet(ctx, g.x, g.y, 5, 5, g.c);
  const reach = Math.min(2, Math.floor(clamp01((t - 0.3) / 1) * 3));
  if (lines) {
    for (let k = 1; k <= reach; k++) {
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = at(g, 2 + dc * k, 2 + dr * k); cellHighlight(ctx, q.x, q.y, g.c); }
    }
  } else if (reach >= 1) {
    for (let k = 0; k < 9; k++) if (k !== 4) { const q = at(g, 1 + (k % 3), 1 + Math.floor(k / 3)); cellHighlight(ctx, q.x, q.y, g.c); }
  }
  const lit = lines ? (reach >= 2 ? 0.8 : 0.25) : 0.25;
  for (const [cc, rr] of [[0, 2], [2, 4]]) { const q = at(g, cc, rr); nucleusGlyph(ctx, q.x + g.c / 2, q.y + g.c / 2, g.c * 0.3, lit); }
  // The nucleus off its lines, on a diagonal: it does not count.
  const off = at(g, 1, 1);
  nucleusGlyph(ctx, off.x + g.c / 2, off.y + g.c / 2, g.c * 0.3, lines ? 0.25 : reach >= 1 ? 0.8 : 0.25);
  openCell(ctx, g, 2, 2, 'scatter', 2, true);
  if (!lines) warnCells(ctx, g, 1, 1, 3, 3, clamp01((t - 1.4) / 0.3));
}

export const RULES: RuleCard[] = [
  {
    title: 'Probe',
    text: 'Tap a cell of foil to probe it. An alpha particle passes through, and the cell opens to show its count.',
    good: {
      duration: 1.6,
      caption: 'It opens to show its count',
      draw: (ctx, w, h, t) => {
        const g = mini(w, h, 3, 3);
        foilSheet(ctx, g.x, g.y, 3, 3, g.c);
        const p = at(g, 1, 1);
        if (opened(t)) openCell(ctx, g, 1, 1, 'plain', 2);
        if (probing(t)) inBox(ctx, w, h, () => probeFx(ctx, p.x + g.c / 2, p.y + g.c / 2, g.c, (t - TAP) * 1000, false));
      },
    },
  },
  {
    title: 'Counts',
    text: 'A number is how many nuclei sit in the eight cells around it. A blank cell has none around it, so its neighbors open by themselves.',
    good: {
      duration: 2,
      caption: 'Two nuclei in the eight around',
      draw: (ctx, w, h, t) => {
        const g = mini(w, h, 3, 3);
        foilSheet(ctx, g.x, g.y, 3, 3, g.c);
        if (t > 0.5) for (let k = 0; k < 9; k++) if (k !== 4) cellHighlight(ctx, g.x + (k % 3) * g.c, g.y + Math.floor(k / 3) * g.c, g.c);
        const shown = 0.75 * clamp01((t - 0.9) / 0.5);
        for (const [cc, rr] of [[0, 0], [2, 1]]) { const q = at(g, cc, rr); nucleusGlyph(ctx, q.x + g.c / 2, q.y + g.c / 2, g.c * 0.3, shown); }
        openCell(ctx, g, 1, 1, 'plain', 2);
      },
    },
  },
  {
    title: 'Marks',
    text: 'Long-press a cell, or switch the tool under the plate to Mark, to flag a suspected nucleus. A mark is a note and keeps the cell from being probed.',
    good: {
      duration: 1.8,
      caption: 'A long press marks it',
      draw: (ctx, w, h, t) => {
        const g = mini(w, h, 3, 2);
        foilSheet(ctx, g.x, g.y, 3, 2, g.c);
        for (let k = 0; k < 3; k++) openCell(ctx, g, k, 1, 'plain', 1);
        const q = at(g, 1, 0), x = q.x + g.c / 2, y = q.y + g.c / 2;
        if (t > 0.4 && t < 1.2) pressRing(ctx, x, y, g.c * 0.36, clamp01((t - 0.4) / 0.7));
        if (t >= 1.1) reticle(ctx, x, y, g.c * 0.27);
      },
    },
  },
  {
    title: 'Clear around',
    text: 'Tap a number whose nuclei are all marked to probe every other cell it counts in one go.',
    good: {
      duration: 2,
      caption: 'Its nucleus marked: the rest opens',
      draw: (ctx, w, h, t) => clearPicture(ctx, w, h, t, 8),
    },
    bad: {
      duration: 2,
      caption: 'A wrong mark: a direct hit',
      draw: (ctx, w, h, t) => clearPicture(ctx, w, h, t, 6),
    },
  },
  {
    title: 'Scatter cells',
    text: 'A number with four outward ticks counts every nucleus in its whole row and column, not just its neighbors. The ticks point along the lines it counts.',
    good: {
      duration: 1.8,
      caption: 'Its row and column hold 2',
      draw: (ctx, w, h, t) => scatterPicture(ctx, w, h, t, true),
    },
    bad: {
      duration: 1.8,
      caption: 'Not the eight around it',
      draw: (ctx, w, h, t) => scatterPicture(ctx, w, h, t, false),
    },
  },
  {
    title: 'Quiet cells',
    text: 'A cell showing ? holds no nucleus but gives no count. Work out the cells around it from other numbers.',
    good: {
      duration: 1.6,
      caption: 'Safe, but no count',
      draw: (ctx, w, h, t) => {
        const g = mini(w, h, 3, 1);
        foilSheet(ctx, g.x, g.y, 3, 1, g.c);
        openCell(ctx, g, 0, 0, 'plain', 1);
        openCell(ctx, g, 2, 0, 'plain', 2);
        const q = at(g, 1, 0);
        if (opened(t)) openCell(ctx, g, 1, 0, 'quiet', 0);
        if (probing(t)) inBox(ctx, w, h, () => probeFx(ctx, q.x + g.c / 2, q.y + g.c / 2, g.c, (t - TAP) * 1000, false));
      },
    },
  },
  {
    title: 'Alpha beams',
    text: 'Ports line the frame at the end of every row and column. Tap one to aim, tap it again to fire: the beam opens every cell it crosses, and passes straight through a line with no nucleus.',
    good: {
      duration: 2.2,
      caption: 'Fired down a clear line',
      draw: (ctx, w, h, t) => {
        const len = 3, tFire = 0.9, ms = (t - tFire) * 1000;
        const open = t < tFire ? 0 : Math.min(len, Math.floor(ms / BEAM_STEP));
        const L = beamRow(ctx, w, h, len, open, null, 0, 1.6);
        const fired = t >= tFire, over = ms > BEAM_STEP * (len + 1) + 180;
        if (over) track(ctx, L, len, 3 * len, len, false);
        const { x: px, y: py } = portPoint(L, len, 3 * len);
        portGlyph(ctx, px, py, 3, L.cell, fired ? 'spent' : t > 0.3 ? 'armed' : 'idle');
        if (!fired && t > 0.3) {
          ctx.save();
          ctx.strokeStyle = C.accent;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 5]);
          ctx.globalAlpha = 0.6;
          ctx.beginPath();
          ctx.moveTo(px + L.cell * 0.2, py);
          ctx.lineTo(L.x + len * L.cell, py);
          ctx.stroke();
          ctx.restore();
        }
        if (fired && !over) inBox(ctx, w, h, () => beamFx(ctx, px, py, 1, 0, L.cell, L.band, len, len, false, ms));
      },
    },
  },
  {
    title: 'Bounce back',
    text: 'A beam bounces straight back off the first nucleus in its way, which then shows as found. Its track stays on the plate.',
    good: {
      duration: 1.8,
      caption: 'Back off the nucleus, now found',
      draw: (ctx, w, h, t) => {
        const len = 3, stop = 2, tFire = 0.4, ms = (t - tFire) * 1000;
        const open = t < tFire ? 0 : Math.min(stop, Math.floor(ms / BEAM_STEP));
        const foundAt = BEAM_STEP * (stop + 1);
        const L = beamRow(ctx, w, h, len, open, stop, ms >= foundAt ? 1 : 0);
        const { x: px, y: py } = portPoint(L, len, 3 * len);
        const done = ms > foundAt + BEAM_STEP * 0.6 * (stop + 1);
        if (done) track(ctx, L, len, 3 * len, stop, true);
        portGlyph(ctx, px, py, 3, L.cell, t >= tFire ? 'spent' : 'armed');
        if (t >= tFire && !done) inBox(ctx, w, h, () => beamFx(ctx, px, py, 1, 0, L.cell, L.band, len, stop, true, ms));
      },
    },
  },
  {
    title: 'Beam par',
    text: 'Under the plate, beams used / granted. Firing more than granted costs the flawless run; undo reopens a port but the beam still counts.',
    good: {
      duration: 1.6,
      caption: 'Two of two granted: flawless',
      draw: (ctx, w, h, t) => demoCounters(ctx, w, h, 6, t < 0.5 ? 0 : t < 1 ? 1 : 2, 2),
    },
    bad: {
      duration: 2,
      caption: 'Three of two: not flawless',
      draw: (ctx, w, h, t) => demoCounters(ctx, w, h, 6, t < 0.5 ? 0 : t < 1 ? 1 : t < 1.5 ? 2 : 3, 2),
    },
  },
  {
    title: 'Direct hit',
    text: 'Probe a nucleus and it is a direct hit, outlined in red. Play goes on, but the run is no longer flawless, even after undo.',
    good: {
      duration: 1.8,
      caption: 'Marked, and the safe cells probed',
      draw: (ctx, w, h, t) => {
        const g = mini(w, h, 3, 2);
        foilSheet(ctx, g.x, g.y, 3, 2, g.c);
        for (let k = 0; k < 3; k++) openCell(ctx, g, k, 1, 'plain', 1);
        const q = at(g, 1, 0);
        reticle(ctx, q.x + g.c / 2, q.y + g.c / 2, g.c * 0.27);
        // The cells either side are safe: probed one after the other.
        [0, 2].forEach((col, i) => {
          const s = t - i * 0.6, p = at(g, col, 0);
          if (opened(s)) openCell(ctx, g, col, 0, 'plain', 1);
          if (probing(s)) inBox(ctx, w, h, () => probeFx(ctx, p.x + g.c / 2, p.y + g.c / 2, g.c, (s - TAP) * 1000, false));
        });
      },
    },
    bad: {
      duration: 1.6,
      caption: 'Probed: a direct hit',
      draw: (ctx, w, h, t) => {
        const g = mini(w, h, 3, 2);
        foilSheet(ctx, g.x, g.y, 3, 2, g.c);
        for (let k = 0; k < 3; k++) openCell(ctx, g, k, 1, 'plain', 1);
        const q = at(g, 1, 0);
        if (opened(t)) nucleusCell(ctx, q.x, q.y, g.c, 'hit');
        if (probing(t)) inBox(ctx, w, h, () => probeFx(ctx, q.x + g.c / 2, q.y + g.c / 2, g.c, (t - TAP) * 1000, true));
      },
    },
  },
  {
    title: 'Nuclei left',
    text: 'The counter under the plate shows how many nuclei are still neither marked nor found. Probe every other cell to finish.',
    good: {
      duration: 1.8,
      caption: 'Each mark takes one off',
      draw: (ctx, w, h, t) => {
        const marks = t < 0.5 ? 0 : t < 1.1 ? 1 : 2;
        const g = mini(w, h * 0.62, 3, 1);
        foilSheet(ctx, g.x, g.y, 3, 1, g.c);
        for (let k = 0; k < marks; k++) { const q = at(g, k * 2, 0); reticle(ctx, q.x + g.c / 2, q.y + g.c / 2, g.c * 0.27); }
        openCell(ctx, g, 1, 0, 'plain', 2);
        ctx.save();
        ctx.font = font(14, 500);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = C.text2;
        const y = h * 0.8;
        ctx.fillText(String(5 - marks), w / 2 + 16, y + 1);
        nucleusGlyph(ctx, w / 2 - 4, y, 8, 1);
        ctx.restore();
      },
    },
  },
];
