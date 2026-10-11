// Drawing and touch for Codebreaker: tap a slot in the guess row to choose it,
// tap a symbol in the palette to fill it, then tap Guess. Tapping the chosen
// slot again clears it. Keys 1-6 type symbols, arrows move, Backspace clears,
// Enter guesses.

import { bestGuess, candidates, cloneCodebreaker, cycleSlot, decided, draftComplete, EMPTY, MAX_ROWS, setSlot, SLOTS, solved, stuck, submit, SYMBOLS, type CodebreakerState } from './codebreaker';
import { C, font, socket, tile } from './palette';
import { drawHelpMark, ease, type Area, type Help, type Point, type PuzzleView, type RuleCard, type Stat } from './view';

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
  /** Look here: the guess slots, palette symbols and Guess button to ring, for the board it was asked on. */
  private mark: { state: CodebreakerState; slots: number[]; keys: number[]; submit: boolean } | null = null;

  constructor(private readonly initial: CodebreakerState, reducedMotion: boolean) {
    this.state = cloneCodebreaker(initial);
    this.reduced = reducedMotion;
  }

  get won(): boolean { return solved(this.state); }
  get stuck(): boolean { return stuck(this.state); }
  get failed(): boolean { return stuck(this.state); }
  get moves(): number { return this.state.moves; }
  get par(): number | null { return this.state.par; }
  stats(): { progress: Stat } { return { progress: { label: 'Guesses', value: `${this.state.rows.length}/${MAX_ROWS}` } }; }
  get clean(): boolean { return this.state.moves <= this.state.par; }

  hint(): string {
    const n = this.state.moves;
    if (this.won) return `Cracked in ${n} guess${n === 1 ? '' : 'es'}`;
    if (this.stuck) return 'Out of guesses';
    return `Guess ${this.state.rows.length + 1} of ${MAX_ROWS}`;
  }

  help(level: 1 | 2): Help | null {
    const s = this.state;
    if (this.won) return null;
    if (this.stuck) return { text: 'Restart to try this code again.' };
    const codes = candidates(s);
    const { can, fixed, inCode, outCode } = decided(codes);
    const show = (slots: number[], keys: number[] = [], submit = false) => { this.mark = { state: s, slots, keys, submit }; };
    // A symbol in the guess row the clues rule out comes first, or one used twice in a code that has no repeats.
    const twice = (k: number) => s.distinct && s.draft.indexOf(s.draft[k]) < k;
    const wrong = s.draft.findIndex((v, k) => v !== EMPTY && (!can[k][v] || twice(k)));
    if (wrong >= 0) {
      const v = s.draft[wrong];
      if (level === 2) {
        // The symbol the best fitting code keeps there, holding on to the rest of the row.
        const g = bestGuess({ ...s, draft: s.draft.map((x, k) => (k === wrong ? EMPTY : x)) }, codes)!;
        this.cursor = wrong;
        this.put(g[wrong]);
        return { text: 'Swapped out a symbol the clues rule out.', moved: true };
      }
      show([wrong], [v]);
      this.cursor = wrong;
      return { text: twice(wrong) ? 'No symbol appears twice in this code.' : outCode[v] ? "This symbol can't be in the code." : "This symbol can't go in this slot." };
    }
    // Show me: one guess, the unit moves are counted in. It fills the row, keeping what fits, and guesses.
    if (level === 2) {
      const g = bestGuess(s, codes)!;
      for (let k = 0; k < SLOTS; k++) {
        if (this.state.draft[k] === g[k]) continue;
        this.cursor = k;
        this.put(g[k]);
      }
      this.trySubmit();
      return { text: codes.length === 1 ? 'Guessed the only code left.' : 'Guessed a code that fits every clue so far.', moved: true };
    }
    const blanks = s.draft.flatMap((v, k) => (v === EMPTY ? [k] : []));
    if (draftComplete(s)) {
      if (codes.some((c) => c.every((k, slot) => k === s.draft[slot]))) {
        show([], [], true);
        return { text: s.rows.length ? 'This guess fits every clue, so try it.' : 'There are no clues yet, so any guess is a good start.' };
      }
      show([...s.draft.keys()]);
      return { text: "This guess breaks a clue, so it can't be the code." };
    }
    if (!s.rows.length) {
      show(blanks);
      return { text: 'There are no clues yet, so any guess is a good start.' };
    }
    const slot = fixed.findIndex((v, k) => v !== EMPTY && s.draft[k] !== v);
    if (slot >= 0) {
      show([slot], [fixed[slot]]);
      this.cursor = slot;
      return { text: 'The clues put this symbol in this slot.' };
    }
    const sure = inCode.findIndex((x, v) => x && !s.draft.includes(v));
    if (sure >= 0) {
      show([], [sure]);
      return { text: 'The clues say this symbol is in the code.' };
    }
    // A symbol ruled out, one already guessed first: that is the one a player might try again.
    const guessed = (v: number) => s.rows.some((r) => r.guess.includes(v));
    const out = [...outCode.keys()].filter((v) => outCode[v]).sort((a, b) => Number(guessed(b)) - Number(guessed(a)))[0];
    if (out !== undefined) {
      show([], [out]);
      return { text: 'The clues rule this symbol out.' };
    }
    // A symbol that may be in the code but no longer in a slot it was guessed in.
    for (const r of s.rows) {
      const k = r.guess.findIndex((v, slot) => !can[slot][v] && !outCode[v]);
      if (k < 0) continue;
      show([k], [r.guess[k]]);
      this.cursor = k;
      return { text: "The clues say this symbol can't go in this slot." };
    }
    show(blanks);
    return { text: 'Any code that fits every clue so far is a good guess.' };
  }

  restart(): void {
    this.state = cloneCodebreaker(this.initial);
    this.history = [];
    this.cursor = 0;
    this.mark = null;
  }

  canUndo(): boolean { return this.history.length > 0; }

  undo(): boolean {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = prev;
    this.mark = null;
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

    // Look here: the slots, symbols or button the clues point at.
    const m = this.mark?.state === s && live ? this.mark : null;
    if (m) {
      for (const r of [...m.slots.map((k) => L.slots[k]), ...m.keys.map((k) => L.keys[k]), ...(m.submit ? [L.submit] : [])]) {
        drawHelpMark(ctx, r.x, r.y, r.w, r.h, now, this.reduced, Math.min(r.w, r.h) * 0.18);
      }
    }
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

/** An amber dashed outline: the thing that is missing or has run out. */
function demoWarn(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rad: number, alpha: number): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.setLineDash([4, 3]);
  tile(ctx, x, y, w, h, rad, null, C.warn, 2);
  ctx.restore();
}

/** A code and one guess under it, with a link from each scoring symbol of the code to the one in the guess. */
function scoring(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, code: number[], guess: number[], links: [number, number][], exact: number, near: number): void {
  const rh = compactRow(w, h);
  const y0 = h / 2 - rh - 3, y1 = h / 2 + 3;
  demoSealed(ctx, w, y0, rh, code, 1, false);
  const R = demoRow(w, rh, false);
  links.forEach(([a, b], i) => demoLink(ctx, R.symX(a), y0 + rh * 0.82, R.symX(b), y1 + rh * 0.18, clamp01((t - 0.3 - i * 0.5) / 0.5)));
  demoGuess(ctx, w, y1, rh, 0, guess, exact, near, clamp01((t - 0.4 - links.length * 0.5) / 0.4));
}

/** A short history: the sealed row and three played guesses, numbered from `first`. */
function history(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, first: number, played: { g: number[]; e: number; n: number }[], open: number): { y0: number; rh: number } {
  const rows = played.length + 1;
  const rh = Math.min(h / (rows + 0.5), (w - 8) / 8.2);
  const y0 = (h - rh * rows) / 2;
  demoSealed(ctx, w, y0, rh, CODE, open);
  played.forEach((p, r) => {
    const k = clamp01((t - 0.2 - r * 0.5) / 0.3);
    if (k > 0) demoGuess(ctx, w, y0 + rh * (r + 1), rh, first + r, p.g, p.e, p.n, k);
  });
  return { y0, rh };
}

export const RULES: RuleCard[] = [
  {
    title: 'The sealed code',
    text: 'Four symbols, drawn from the six in the palette, are sealed in the top row. Crack the code in ten guesses or fewer and the padlock opens.',
    good: {
      duration: 1.8,
      caption: 'Cracked: the padlock opens',
      draw: (ctx, w, h, t) => {
        const rh = compactRow(w, h);
        demoSealed(ctx, w, (h - rh) / 2, rh, CODE, clamp01((t - 0.7) / 0.5), false);
      },
    },
  },
  {
    title: 'Make a guess',
    text: 'Tap a slot, then a symbol in the palette to fill it; the next empty slot is chosen for you, and tapping the chosen slot again empties it. With all four full, tap Guess.',
    good: {
      duration: 2.8,
      caption: 'All four filled, then Guess',
      draw: (ctx, w, h, t) => guessPicture(ctx, w, h, t, [1, 0, 3, 2]),
    },
    bad: {
      duration: 2.4,
      caption: 'Guess waits for all four',
      draw: (ctx, w, h, t) => guessPicture(ctx, w, h, t, [1, 0, 3]),
    },
  },
  {
    title: 'Filled dot',
    text: 'Each filled dot is one symbol that is right and in the right place. Faint dots score nothing, and no dot says which symbol it means.',
    good: {
      duration: 1.8,
      caption: 'Right symbol, right place',
      draw: (ctx, w, h, t) => scoring(ctx, w, h, t, CODE, [0, 4, 5, 4], [[0, 0]], 1, 0),
    },
  },
  {
    title: 'Hollow dot',
    text: 'Each hollow dot is one symbol that is in the code but in another place.',
    good: {
      duration: 1.8,
      caption: 'Right symbol, wrong place',
      draw: (ctx, w, h, t) => scoring(ctx, w, h, t, CODE, [4, 0, 5, 5], [[0, 1]], 0, 1),
    },
  },
  {
    title: 'Six symbols',
    text: 'Each of the six symbols has its own shape as well as its color, so color alone never carries the code.',
    good: {
      duration: 1.6,
      caption: 'A shape and a color each',
      draw: (ctx, w, h, t) => {
        const key = Math.min(28, (w - 8 - 5 * 4) / 6);
        const x0 = (w - key * 6 - 20) / 2, y = (h - key) / 2;
        for (let k = 0; k < SYMBOLS; k++) {
          const x = x0 + k * (key + 4), s = ease(clamp01((t - 0.1 - k * 0.2) / 0.3));
          tile(ctx, x, y, key, key, key * 0.18, C.surface2, C.line2, 1);
          if (s > 0) symbol(ctx, x + key / 2, y + key / 2, key * 0.28 * s, k);
        }
      },
    },
  },
  {
    title: 'Repeats',
    text: 'On the last few elements a symbol may appear more than once in the code, and each copy scores on its own.',
    good: {
      duration: 2,
      caption: 'Each copy scores on its own',
      draw: (ctx, w, h, t) => scoring(ctx, w, h, t, [1, 3, 1, 0], [1, 1, 4, 4], [[0, 0], [2, 1]], 1, 1),
    },
  },
  {
    title: 'Ten guesses',
    text: 'Guesses fill the numbered rows from 1 to 10. Run out without cracking the code and only a restart helps; it deals the same code.',
    good: {
      duration: 2.2,
      caption: 'Cracked on guess 3',
      draw: (ctx, w, h, t) => {
        history(ctx, w, h, t, 1, [
          { g: [4, 5, 0, 1], e: 0, n: 2 },
          { g: [0, 1, 5, 4], e: 2, n: 0 },
          { g: [0, 1, 2, 3], e: 4, n: 0 },
        ], clamp01((t - 1.5) / 0.4));
      },
    },
    bad: {
      duration: 2.2,
      caption: 'Ten used, still sealed',
      draw: (ctx, w, h, t) => {
        const { y0, rh } = history(ctx, w, h, t, 8, [
          { g: [0, 1, 5, 4], e: 2, n: 0 },
          { g: [0, 1, 3, 2], e: 2, n: 2 },
          { g: [0, 2, 1, 3], e: 2, n: 2 },
        ], 0);
        const R = demoRow(w, rh);
        demoWarn(ctx, R.hx - 1, y0 + 1, R.hw + 2, rh - 2, rh * 0.28, clamp01((t - 1.6) / 0.3));
      },
    },
  },
  {
    title: 'Keyboard',
    text: 'Keys 1 to 6 type a symbol, left and right move between slots, up and down change the symbol in a slot, Backspace clears and Enter guesses.',
  },
];

/**
 * The guess row filling: each symbol tapped in turn, then a tap on Guess. With all four
 * symbols, Guess lights and takes the guess; with a slot still empty, it stays dim and the
 * empty slot is flagged.
 */
function guessPicture(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, symbols: number[]): void {
  const step = 0.45, start = 0.25;
  const filled = Math.max(0, Math.min(symbols.length, Math.floor((t - start) / step)));
  const draft = [0, 1, 2, 3].map((i) => (i < filled ? symbols[i] : EMPTY));
  const all = filled === SLOTS;
  const L = demoControls(ctx, w, h, draft, Math.min(3, filled), all);
  const tapping = t > start && filled < symbols.length && ((t - start) % step) > step * 0.35;
  if (tapping) {
    const r = L.keys[symbols[filled]];
    demoFinger(ctx, r.x + r.w * 0.66, r.y + r.h * 0.7, r.w * 0.2);
  }
  const press = start + symbols.length * step + 0.2;
  if (t > press) demoFinger(ctx, L.button.x + L.button.w * 0.86, L.button.y + L.button.h * 0.78, L.button.h * 0.18);
  if (!all) {
    const r = L.slots[filled];
    demoWarn(ctx, r.x - 2, r.y - 2, r.w + 4, r.h + 4, r.w * 0.2, clamp01((t - press - 0.3) / 0.3));
  }
}
