// Drawing and touch for Codebreaker: tap a slot in the guess row to choose it,
// tap a symbol in the palette to fill it, then tap Guess. Tapping the chosen
// slot again clears it. Keys 1-6 type symbols, arrows move, Backspace clears,
// Enter guesses.

import { cloneCodebreaker, cycleSlot, draftComplete, EMPTY, MAX_ROWS, setSlot, SLOTS, solved, stuck, submit, SYMBOLS, type CodebreakerState } from './codebreaker';
import { C, font, socket, tile } from './palette';
import { ease, type Area, type Point, type PuzzleView, type RuleCard } from './view';

const REVEAL_MS = 260;
/** The six symbol colors, read at draw time. */
const colorOf = (k: number): string => [C.s, C.p, C.d, C.f, C.silverDim, C.pewter][k];
const GAP = 6;

export const INSTRUCTIONS = `
<h3>In the game</h3>
<p class="meta">A gate for the 15 synthetic elements, z 104-118. Up to z 111 the four symbols of the code are all different; from z 112 a symbol may repeat. Par is 5 guesses and clean means cracking it within par. Ten guesses without cracking it is stuck, and a restart deals the same code. Undo takes back changes to the guess row, but a guess once made stays made.</p>`;

interface Rect { x: number; y: number; w: number; h: number }

interface Layout {
  rowH: number;
  /** Left edge and width of the history column. */
  hx: number;
  hw: number;
  /** Top of the sealed row; the history rows follow it. */
  hy: number;
  slots: Rect[];
  submit: Rect;
  keys: Rect[];
}

export class CodebreakerView implements PuzzleView {
  private state: CodebreakerState;
  /** Draft edits since the last guess; a guess clears it. */
  private history: CodebreakerState[] = [];
  private pressed: Point | null = null;
  private cursor = 0;
  private submittedAt = 0;
  private lay: Layout | null = null;
  private reduced: boolean;

  constructor(private readonly initial: CodebreakerState, reducedMotion: boolean) {
    this.state = cloneCodebreaker(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return stuck(this.state); }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    const n = this.state.moves;
    if (this.won) return `Cracked in ${n} guess${n === 1 ? '' : 'es'}`;
    if (this.stuck) return 'Out of guesses';
    return `Guess ${this.state.rows.length + 1} of ${MAX_ROWS}`;
  }

  restart(): void {
    this.state = cloneCodebreaker(this.initial);
    this.history = [];
    this.cursor = 0;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    return true;
  }

  private over(): boolean { return this.won || this.stuck; }

  private edit(next: CodebreakerState): void {
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.state = next;
  }

  private put(symbol: number): void {
    if (this.over()) return;
    this.edit(setSlot(this.state, this.cursor, symbol));
    // On to the next empty slot, if there is one.
    for (let k = 1; k <= SLOTS; k++) {
      const j = (this.cursor + k) % SLOTS;
      if (this.state.draft[j] === EMPTY) { this.cursor = j; return; }
    }
  }

  private clear(slot: number): void {
    if (this.state.draft[slot] !== EMPTY) this.edit(setSlot(this.state, slot, EMPTY));
  }

  private trySubmit(): void {
    const next = submit(this.state);
    if (!next) return;
    this.state = next;
    this.history = [];
    this.cursor = 0;
    this.submittedAt = performance.now();
  }

  // ---- input ----------------------------------------------------------------------

  down(p: Point): void { this.pressed = p; }
  move(): void { /* taps only */ }
  cancel(): void { this.pressed = null; }

  up(p: Point): void {
    const s = this.pressed;
    this.pressed = null;
    if (!s || Math.hypot(p.x - s.x, p.y - s.y) > 16 || this.over() || !this.lay) return;
    const L = this.lay;
    const inside = (r: Rect, pad: number) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
    const slot = L.slots.findIndex((r) => inside(r, GAP / 2));
    if (slot >= 0) {
      if (slot === this.cursor) this.clear(slot);
      this.cursor = slot;
      return;
    }
    const key = L.keys.findIndex((r) => inside(r, GAP / 2));
    if (key >= 0) { this.put(key); return; }
    if (inside(L.submit, GAP / 2)) this.trySubmit();
  }

  key(e: KeyboardEvent): boolean {
    if (this.over()) return false;
    if (/^[1-6]$/.test(e.key)) { this.put(Number(e.key) - 1); return true; }
    if (e.key === 'ArrowLeft') { this.cursor = (this.cursor + SLOTS - 1) % SLOTS; return true; }
    if (e.key === 'ArrowRight') { this.cursor = (this.cursor + 1) % SLOTS; return true; }
    if (e.key === 'ArrowUp') { this.edit(cycleSlot(this.state, this.cursor, 1)); return true; }
    if (e.key === 'ArrowDown') { this.edit(cycleSlot(this.state, this.cursor, -1)); return true; }
    if (e.key === 'Backspace' || e.key === 'Delete') { this.clear(this.cursor); return true; }
    if (e.key === 'Enter') { this.trySubmit(); return true; }
    return false;
  }

  // ---- layout ---------------------------------------------------------------------

  private layout(area: Area): Layout {
    const m = 8;
    const aw = Math.max(1, area.w - m * 2), ah = Math.max(1, area.h - m * 2);
    // The controls for a given width: a guess row (four slots and a wider Guess button) and the palette.
    const controls = (bw: number) => {
      const slot = Math.max(30, Math.min(60, (bw - 5 * GAP) / 5.5));
      const btnW = Math.max(slot * 1.5, 72);
      const rowW = slot * 4 + GAP * 5 + btnW;
      let keyCols = SYMBOLS;
      let key = Math.min(60, (bw - GAP * (SYMBOLS - 1)) / SYMBOLS);
      if (key < 44) { keyCols = 3; key = Math.min(60, (bw - GAP * 2) / 3); }
      const keyRows = Math.ceil(SYMBOLS / keyCols);
      const palW = keyCols * key + (keyCols - 1) * GAP, palH = keyRows * key + (keyRows - 1) * GAP;
      return { slot, btnW, rowW, key, keyCols, palW, palH, w: Math.max(rowW, palW), h: slot + 14 + palH };
    };
    const rows = MAX_ROWS + 1;
    const histW = (rh: number) => Math.min(aw, rh * 8.2);

    // Stacked (history above the controls) unless that squeezes the rows and they fit side by side.
    let ctrl = controls(aw);
    let rowH = Math.min(34, (ah - ctrl.h - 14) / rows);
    let side = false;
    if (rowH < 22) {
      const sideRowH = Math.min(34, ah / rows);
      const sc = controls(aw - histW(sideRowH) - 24);
      if (sideRowH > rowH && sc.slot >= 44 && sc.key >= 40 && sc.h <= ah) { side = true; rowH = sideRowH; ctrl = sc; }
    }
    rowH = Math.max(14, rowH);
    const hw = histW(rowH), hh = rowH * rows;

    let hx: number, hy: number, cx: number, cy: number;
    if (side) {
      const total = hw + 24 + ctrl.w;
      hx = area.x + (area.w - total) / 2;
      hy = area.y + (area.h - hh) / 2;
      cx = hx + hw + 24;
      cy = area.y + (area.h - ctrl.h) / 2;
    } else {
      const total = hh + 14 + ctrl.h;
      hy = area.y + (area.h - total) / 2;
      hx = area.x + (area.w - hw) / 2;
      cx = area.x + (area.w - ctrl.w) / 2;
      cy = hy + hh + 14;
    }
    const { slot, btnW, key, keyCols } = ctrl;
    const rx = cx + (ctrl.w - ctrl.rowW) / 2;
    const slots = Array.from({ length: SLOTS }, (_, k) => ({ x: rx + k * (slot + GAP), y: cy, w: slot, h: slot }));
    const submitRect = { x: rx + 4 * slot + 5 * GAP, y: cy, w: btnW, h: slot };
    const px = cx + (ctrl.w - ctrl.palW) / 2, py = cy + slot + 14;
    const keys = Array.from({ length: SYMBOLS }, (_, k) => ({
      x: px + (k % keyCols) * (key + GAP), y: py + Math.floor(k / keyCols) * (key + GAP), w: key, h: key,
    }));
    return { rowH, hx, hw, hy, slots, submit: submitRect, keys };
  }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    const L = (this.lay = this.layout(area));
    const rh = L.rowH, sr = rh * 0.3;
    const symX = (k: number) => L.hx + rh * 1.15 + (k + 0.5) * rh * 0.98;
    const clueX = L.hx + L.hw - rh * 0.9;

    // The sealed code, opened once cracked.
    const sy = L.hy + rh / 2;
    tile(ctx, L.hx, L.hy + 2, L.hw, rh - 4, rh * 0.25, this.won ? C.surface2 : C.surface, this.won ? C.line3 : C.line2, 1);
    for (let k = 0; k < SLOTS; k++) {
      if (this.won) symbol(ctx, symX(k), sy, sr, s.secret[k]);
      else {
        ctx.save();
        ctx.setLineDash([2, 3]);
        ctx.strokeStyle = C.line3;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(symX(k), sy, sr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    lock(ctx, clueX, sy, rh * 0.22, this.won);

    // The guesses so far, compact.
    for (let r = 0; r < MAX_ROWS; r++) {
      const y = L.hy + rh * (r + 1) + rh / 2;
      const row = s.rows[r];
      ctx.fillStyle = row ? C.text2 : C.text3;
      ctx.font = font(Math.max(9, rh * 0.38), 500);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(r + 1), L.hx + rh * 0.8, y + 1);
      if (row) {
        const t = r === s.rows.length - 1 && !this.reduced ? ease((now - this.submittedAt) / REVEAL_MS) : 1;
        tile(ctx, L.hx + rh, y - rh / 2 + 2, L.hw - rh, rh - 4, rh * 0.25, null, C.line, 1);
        for (let k = 0; k < SLOTS; k++) symbol(ctx, symX(k), y, sr, row.guess[k], 0.5 + 0.5 * t);
        clues(ctx, clueX, y, rh * 0.1, row.exact, row.near, t);
      } else {
        ctx.strokeStyle = C.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(L.hx + rh * 1.15, y);
        ctx.lineTo(L.hx + L.hw - rh * 0.3, y);
        ctx.stroke();
      }
    }

    // The guess row: four big slots and the Guess button.
    const live = !this.over();
    L.slots.forEach((r, k) => {
      const v = s.draft[k];
      const rad = r.w * 0.18;
      if (v === EMPTY || !live) socket(ctx, r.x, r.y, r.w, r.h, rad, C.line2);
      else tile(ctx, r.x, r.y, r.w, r.h, rad, C.surface2, C.line2, 1);
      if (v !== EMPTY && live) symbol(ctx, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.3, v);
      if (live && k === this.cursor) tile(ctx, r.x - 2, r.y - 2, r.w + 4, r.h + 4, rad * 1.1, null, C.accent, 2);
    });
    const b = L.submit;
    const ready = live && draftComplete(s);
    tile(ctx, b.x, b.y, b.w, b.h, b.h * 0.22, ready ? C.accent : C.surface, ready ? null : C.line2, 1);
    ctx.fillStyle = ready ? C.tileInk : C.text3;
    ctx.font = font(Math.min(17, b.h * 0.34), 600);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Guess', b.x + b.w / 2, b.y + b.h / 2 + 1);

    // The palette.
    L.keys.forEach((r, k) => {
      ctx.save();
      ctx.globalAlpha = live ? 1 : 0.4;
      tile(ctx, r.x, r.y, r.w, r.h, r.w * 0.18, C.surface2, C.line2, 1);
      symbol(ctx, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.28, k);
      ctx.fillStyle = C.text3;
      ctx.font = font(10, 500);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(String(k + 1), r.x + r.w - 5, r.y + 4);
      ctx.restore();
    });
  }
}

/** One of the six symbols: a color and a shape, so color alone never carries the code. */
export function symbol(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, k: number, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colorOf(k);
  ctx.beginPath();
  switch (k) {
    case 0: ctx.arc(x, y, r, 0, Math.PI * 2); break;
    case 1: ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.8); ctx.lineTo(x - r, y + r * 0.8); ctx.closePath(); break;
    case 2: ctx.roundRect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7, r * 0.25); break;
    case 3: ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); break;
    case 4:
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.42 : r;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      break;
    default:
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

/** The clue: four dots in a square, filled for right place, hollow for right symbol elsewhere. */
function clues(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, exact: number, near: number, alpha: number): void {
  const step = r * 2.8;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let i = 0; i < SLOTS; i++) {
    const cx = x + (i % 2 ? step / 2 : -step / 2), cy = y + (i < 2 ? -step / 2 : step / 2);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    if (i < exact) {
      ctx.fillStyle = C.silver;
      ctx.fill();
    } else if (i < exact + near) {
      ctx.strokeStyle = C.silver;
      ctx.lineWidth = 1.25;
      ctx.stroke();
    } else {
      ctx.fillStyle = C.line;
      ctx.fill();
    }
  }
  ctx.restore();
}

/** A small padlock on the sealed row, open once the code is cracked. */
function lock(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, open: boolean): void {
  ctx.save();
  ctx.strokeStyle = open ? C.good : C.text3;
  ctx.fillStyle = open ? C.good : C.text3;
  ctx.lineWidth = Math.max(1.25, r * 0.22);
  ctx.beginPath();
  ctx.arc(x + (open ? r * 0.9 : 0), y - r * 0.2, r * 0.55, Math.PI, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(x - r * 0.8, y - r * 0.2, r * 1.6, r * 1.2, r * 0.2);
  ctx.fill();
  ctx.restore();
}

// ---- rules ------------------------------------------------------------------------

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * A history row as the board draws it, fitted across a demo box: where its
 * symbols and its clue go. Unnumbered rows drop the number column so the
 * symbols can be larger.
 */
function demoRow(w: number, rh: number, numbered = true): { hx: number; hw: number; lead: number; symX: (k: number) => number; clueX: number } {
  const lead = numbered ? rh : 0;
  const hw = Math.min(w - 8, numbered ? rh * 8.2 : rh * 6.3);
  const hx = (w - hw) / 2;
  return { hx, hw, lead, symX: (k) => hx + lead + rh * 0.15 + (k + 0.5) * rh * 0.98, clueX: hx + hw - rh * 0.9 };
}

/** The tallest unnumbered row that fits a demo box. */
const compactRow = (w: number, h: number): number => Math.min(h * 0.3, (w - 8) / 6.3);

/** The sealed row: dashed rings and a padlock, or the code and an open padlock once cracked. */
function demoSealed(ctx: CanvasRenderingContext2D, w: number, y: number, rh: number, code: number[], open: number, numbered = true): void {
  const R = demoRow(w, rh, numbered), cy = y + rh / 2, sr = rh * 0.3;
  const cracked = open >= 1;
  tile(ctx, R.hx, y + 2, R.hw, rh - 4, rh * 0.25, cracked ? C.surface2 : C.surface, cracked ? C.line3 : C.line2, 1);
  for (let k = 0; k < SLOTS; k++) {
    if (open > 0) symbol(ctx, R.symX(k), cy, sr, code[k], open);
    if (open < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - open;
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = C.line3;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(R.symX(k), cy, sr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
  lock(ctx, R.clueX, cy, rh * 0.22, cracked);
}

/** A played guess as the board lists it: its number, its symbols and its clue. */
function demoGuess(ctx: CanvasRenderingContext2D, w: number, y: number, rh: number, n: number, guess: number[], exact: number, near: number, clue = 1): void {
  const R = demoRow(w, rh, n > 0), cy = y + rh / 2, sr = rh * 0.3;
  if (n > 0) {
    ctx.fillStyle = C.text2;
    ctx.font = font(Math.max(9, rh * 0.38), 500);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), R.hx + rh * 0.8, cy + 1);
  }
  tile(ctx, R.hx + R.lead, y + 2, R.hw - R.lead, rh - 4, rh * 0.25, null, C.line, 1);
  for (let k = 0; k < SLOTS; k++) symbol(ctx, R.symX(k), cy, sr, guess[k], 0.5 + 0.5 * clue);
  clues(ctx, R.clueX, cy, rh * (n > 0 ? 0.1 : 0.12), exact, near, clue);
}

/** A thin accent link between a symbol in the code and the one in a guess that scores against it. */
function demoLink(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, k: number): void {
  if (k <= 0) return;
  ctx.save();
  ctx.globalAlpha = k;
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k);
  ctx.stroke();
  ctx.restore();
}

/** A fingertip, for the demos only. */
function demoFinger(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.fillStyle = C.text;
  ctx.strokeStyle = C.bg;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(4, r), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** The guess row and palette as the board draws them, scaled into a demo box. */
function demoControls(ctx: CanvasRenderingContext2D, w: number, h: number, draft: number[], cursor: number, ready: boolean): { slots: Area[]; keys: Area[]; button: Area } {
  const g = 4;
  const slot = Math.min(26, (w - 8 - 5 * g) / 5.6, h * 0.36);
  const btnW = slot * 1.6;
  const rowW = slot * 4 + g * 4 + btnW;
  const key = Math.min(slot * 0.9, (w - 8 - 5 * g) / 6);
  const palW = key * 6 + g * 5;
  const top = (h - (slot + 8 + key)) / 2;
  const rx = (w - rowW) / 2, px = (w - palW) / 2, py = top + slot + 8;
  const slots = Array.from({ length: SLOTS }, (_, k) => ({ x: rx + k * (slot + g), y: top, w: slot, h: slot }));
  const button = { x: rx + 4 * (slot + g), y: top, w: btnW, h: slot };
  const keys = Array.from({ length: SYMBOLS }, (_, k) => ({ x: px + k * (key + g), y: py, w: key, h: key }));
  slots.forEach((r, k) => {
    const v = draft[k], rad = r.w * 0.18;
    if (v === EMPTY) socket(ctx, r.x, r.y, r.w, r.h, rad, C.line2);
    else {
      tile(ctx, r.x, r.y, r.w, r.h, rad, C.surface2, C.line2, 1);
      symbol(ctx, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.3, v);
    }
    if (k === cursor) tile(ctx, r.x - 2, r.y - 2, r.w + 4, r.h + 4, rad * 1.1, null, C.accent, 2);
  });
  tile(ctx, button.x, button.y, button.w, button.h, button.h * 0.22, ready ? C.accent : C.surface, ready ? null : C.line2, 1);
  ctx.fillStyle = ready ? C.tileInk : C.text3;
  ctx.font = font(Math.min(13, button.h * 0.36), 600);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Guess', button.x + button.w / 2, button.y + button.h / 2 + 1);
  keys.forEach((r, k) => {
    tile(ctx, r.x, r.y, r.w, r.h, r.w * 0.18, C.surface2, C.line2, 1);
    symbol(ctx, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.28, k);
  });
  return { slots, keys, button };
}

const CODE = [0, 1, 2, 3];

export const RULES: RuleCard[] = [
  {
    title: 'The sealed code',
    text: 'Four symbols, drawn from the six in the palette, are sealed in the top row. Crack the code in ten guesses or fewer and the padlock opens.',
    demo: (ctx, w, h, t) => {
      const k = t % 4.5;
      const rh = compactRow(w, h);
      demoSealed(ctx, w, (h - rh) / 2, rh, CODE, clamp01((k - 1.8) / 0.4) * (k < 4 ? 1 : clamp01((4.4 - k) / 0.4)), false);
    },
  },
  {
    title: 'Make a guess',
    text: 'Tap a slot, then a symbol in the palette to fill it; the next empty slot is chosen for you, and tapping the chosen slot again empties it. With all four full, tap Guess.',
    demo: (ctx, w, h, t) => {
      const k = t % 5;
      const guess = [1, 0, 3, 2];
      const filled = Math.max(0, Math.min(4, Math.floor((k - 0.4) / 0.5) + 1));
      const draft = guess.map((v, i) => (i < filled ? v : EMPTY));
      const sent = k > 3.4;
      const L = demoControls(ctx, w, h, sent ? [EMPTY, EMPTY, EMPTY, EMPTY] : draft, sent ? 0 : Math.min(3, filled), !sent && filled === 4);
      if (k > 0.25 && filled < 4 && !sent) {
        const r = L.keys[guess[filled]];
        const near = ((k - 0.4) % 0.5) > 0.2;
        if (near) demoFinger(ctx, r.x + r.w * 0.66, r.y + r.h * 0.7, r.w * 0.2);
      }
      if (filled === 4 && k > 2.6 && k < 3.4) demoFinger(ctx, L.button.x + L.button.w * 0.6, L.button.y + L.button.h * 0.7, L.button.h * 0.2);
    },
  },
  {
    title: 'Filled dot',
    text: 'Each filled dot is one symbol that is right and in the right place. Faint dots score nothing, and no dot says which symbol it means.',
    demo: (ctx, w, h, t) => {
      const k = t % 4;
      const rh = compactRow(w, h);
      const y0 = h / 2 - rh - 3, y1 = h / 2 + 3;
      const guess = [0, 4, 5, 4];
      demoSealed(ctx, w, y0, rh, CODE, 1, false);
      const R = demoRow(w, rh, false);
      demoLink(ctx, R.symX(0), y0 + rh * 0.82, R.symX(0), y1 + rh * 0.18, clamp01((k - 0.6) / 0.5));
      demoGuess(ctx, w, y1, rh, 0, guess, 1, 0, clamp01((k - 1.2) / 0.4));
    },
  },
  {
    title: 'Hollow dot',
    text: 'Each hollow dot is one symbol that is in the code but in another place.',
    demo: (ctx, w, h, t) => {
      const k = t % 4;
      const rh = compactRow(w, h);
      const y0 = h / 2 - rh - 3, y1 = h / 2 + 3;
      const guess = [4, 0, 5, 5];
      demoSealed(ctx, w, y0, rh, CODE, 1, false);
      const R = demoRow(w, rh, false);
      demoLink(ctx, R.symX(0), y0 + rh * 0.82, R.symX(1), y1 + rh * 0.18, clamp01((k - 0.6) / 0.5));
      demoGuess(ctx, w, y1, rh, 0, guess, 0, 1, clamp01((k - 1.2) / 0.4));
    },
  },
  {
    title: 'Six symbols',
    text: 'Each of the six symbols has its own shape as well as its color, so color alone never carries the code.',
    demo: (ctx, w, h, t) => {
      const lit = Math.floor((t % 3) * 2);
      const key = Math.min(28, (w - 8 - 5 * 4) / 6);
      const x0 = (w - key * 6 - 20) / 2, y = (h - key) / 2;
      for (let k = 0; k < SYMBOLS; k++) {
        const x = x0 + k * (key + 4);
        tile(ctx, x, y, key, key, key * 0.18, C.surface2, k === lit ? C.line3 : C.line2, 1);
        symbol(ctx, x + key / 2, y + key / 2, key * (k === lit ? 0.34 : 0.28), k);
      }
    },
  },
  {
    title: 'Repeats',
    text: 'On the last few elements a symbol may appear more than once in the code, and each copy scores on its own.',
    demo: (ctx, w, h, t) => {
      const k = t % 4.5;
      const rh = compactRow(w, h);
      const y0 = h / 2 - rh - 3, y1 = h / 2 + 3;
      const code = [1, 3, 1, 0], guess = [1, 1, 4, 4];
      demoSealed(ctx, w, y0, rh, code, 1, false);
      const R = demoRow(w, rh, false);
      demoLink(ctx, R.symX(0), y0 + rh * 0.82, R.symX(0), y1 + rh * 0.18, clamp01((k - 0.6) / 0.5));
      demoLink(ctx, R.symX(2), y0 + rh * 0.82, R.symX(1), y1 + rh * 0.18, clamp01((k - 1.1) / 0.5));
      demoGuess(ctx, w, y1, rh, 0, guess, 1, 1, clamp01((k - 1.7) / 0.4));
    },
  },
  {
    title: 'Ten guesses',
    text: 'Guesses fill the numbered rows from 1 to 10. Run out without cracking the code and only a restart helps; it deals the same code.',
    demo: (ctx, w, h, t) => {
      const k = t % 5;
      const rows = 5;
      const rh = Math.min(h / (rows + 0.4), (w - 8) / 8.2);
      const y0 = (h - rh * rows) / 2;
      const R = demoRow(w, rh);
      const played = [
        { g: [4, 5, 0, 1], e: 0, n: 2 },
        { g: [0, 1, 5, 4], e: 2, n: 0 },
        { g: [0, 1, 3, 2], e: 2, n: 2 },
        { g: [0, 1, 2, 3], e: 4, n: 0 },
      ];
      const shown = Math.min(played.length, Math.floor(k / 0.8));
      demoSealed(ctx, w, y0, rh, CODE, shown === played.length ? clamp01((k - 3.2) / 0.3) : 0);
      for (let r = 0; r < played.length; r++) {
        const y = y0 + rh * (r + 1);
        if (r < shown) demoGuess(ctx, w, y, rh, r + 1, played[r].g, played[r].e, played[r].n, clamp01((k - (r + 1) * 0.8) / 0.3));
        else {
          ctx.fillStyle = C.text3;
          ctx.font = font(Math.max(9, rh * 0.38), 500);
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(r + 1), R.hx + rh * 0.8, y + rh / 2 + 1);
          ctx.strokeStyle = C.line;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(R.hx + rh * 1.15, y + rh / 2);
          ctx.lineTo(R.hx + R.hw - rh * 0.3, y + rh / 2);
          ctx.stroke();
        }
      }
    },
  },
  {
    title: 'Keyboard',
    text: 'Keys 1 to 6 type a symbol, left and right move between slots, up and down change the symbol in a slot, Backspace clears and Enter guesses.',
    demo: (ctx, w, h, t) => {
      const k = t % 4;
      const cursor = Math.min(3, Math.floor(k / 0.8));
      const draft = [2, cursor >= 1 ? 4 : EMPTY, cursor >= 2 ? 0 : EMPTY, cursor >= 3 ? (Math.floor(k * 2.5) % SYMBOLS) : EMPTY];
      demoControls(ctx, w, h, draft, cursor, draft.every((v) => v !== EMPTY));
    },
  },
];
