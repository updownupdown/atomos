// Drawing and touch for Codebreaker: tap a slot in the guess row to choose it,
// tap a symbol in the palette to fill it, then tap Guess. Tapping the chosen
// slot again clears it. Keys 1-6 type symbols, arrows move, Backspace clears,
// Enter guesses.

import { cloneCodebreaker, cycleSlot, draftComplete, EMPTY, MAX_ROWS, setSlot, SLOTS, solved, stuck, submit, SYMBOLS, type CodebreakerState } from './codebreaker';
import { C, font, socket, tile } from './palette';
import { ease, type Area, type Point, type PuzzleView } from './view';

const REVEAL_MS = 260;
/** The six symbol colours, read at draw time. */
const colourOf = (k: number): string => [C.s, C.p, C.d, C.f, C.silverDim, C.pewter][k];
const GAP = 6;

export const INSTRUCTIONS = `
<h3>How to play</h3>
<p>A sealed code of <b>four symbols</b> hides at the top, drawn from the six in the palette. Work it out in ten guesses or fewer.</p>
<ul>
  <li>Tap a slot in the big guess row, then tap a symbol in the palette to fill it; the next empty slot is chosen for you. Tap the chosen slot again to empty it.</li>
  <li>When all four slots are full, tap <b>Guess</b>.</li>
  <li>Each guess moves up into the list with its clue: a <b>filled dot</b> for every symbol in the right place, a <b>hollow dot</b> for every right symbol in the wrong place. The dots do not say which symbols they mean.</li>
  <li>Each symbol has its own shape as well as its colour.</li>
</ul>
<p>Keyboard: 1-6 type a symbol, arrows move between slots, Backspace clears, Enter guesses.</p>
<h3>In the game</h3>
<p>A gate for the 15 synthetic elements, z 104-118.</p>
<ul>
  <li>Up to z 111 the four symbols are all different; from z 112 a symbol may repeat.</li>
  <li>Par is 5 guesses; clean means cracking it within par. Ten guesses without cracking it is stuck, and a restart deals the same code.</li>
  <li>Undo takes back changes to the guess row, but a guess once made stays made.</li>
</ul>`;

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

/** One of the six symbols: a colour and a shape, so colour alone never carries the code. */
export function symbol(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, k: number, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = colourOf(k);
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
