// Drawing and touch for Codebreaker: tap a slot to cycle its symbol, or tap a
// symbol on the key row to set the chosen slot; the arrow mark submits. Keys
// 1–6 type symbols, Enter submits, Backspace clears.

import { cloneCodebreaker, cycleSlot, draftComplete, EMPTY, MAX_ROWS, setSlot, SLOTS, solved, stuck, submit, SYMBOLS, type CodebreakerState } from './codebreaker';
import { ease, MONO, SUBSHELL_COLOURS, type Area, type Point, type PuzzleView } from './view';

const REVEAL_MS = 260;
const COLOURS = [SUBSHELL_COLOURS.s, SUBSHELL_COLOURS.p, SUBSHELL_COLOURS.d, SUBSHELL_COLOURS.f, '#e4dfd2', '#8a857a'];

interface Hit { kind: 'slot' | 'key' | 'submit'; index: number }

export class CodebreakerView implements PuzzleView {
  private state: CodebreakerState;
  private history: CodebreakerState[] = [];
  private pressed: Point | null = null;
  private cursor = 0;
  private submittedAt = 0;
  private hits: { hit: Hit; x: number; y: number; r: number }[] = [];
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
    if (this.won) return `Cracked in ${this.state.moves} guess${this.state.moves === 1 ? '' : 'es'}.`;
    if (this.stuck) return 'Ten guesses used. Restart for the same code.';
    if (this.state.moves === 0) return `<span class="hl">Tap the slots</span> to pick four symbols, then the <span class="hl">arrow</span> to guess. A filled dot: right symbol, right place. A hollow dot: right symbol, wrong place.`;
    const last = this.state.rows[this.state.rows.length - 1];
    return `Last guess: ${last.exact} in place, ${last.near} out of place. ${MAX_ROWS - this.state.rows.length} guesses left.`;
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

  private trySubmit(): void {
    const next = submit(this.state);
    if (!next) return;
    this.history.push(this.state);
    if (this.history.length > 50) this.history.shift();
    this.state = next;
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
    if (!s || Math.hypot(p.x - s.x, p.y - s.y) > 14 || this.over()) return;
    for (const h of this.hits) {
      if (Math.hypot(p.x - h.x, p.y - h.y) > h.r) continue;
      if (h.hit.kind === 'slot') {
        if (this.cursor === h.hit.index || this.state.draft[h.hit.index] === EMPTY) this.state = cycleSlot(this.state, h.hit.index);
        this.cursor = h.hit.index;
      } else if (h.hit.kind === 'key') {
        this.state = setSlot(this.state, this.cursor, h.hit.index);
        this.cursor = (this.cursor + 1) % SLOTS;
      } else this.trySubmit();
      return;
    }
  }

  key(e: KeyboardEvent): boolean {
    if (this.over()) return false;
    if (/^[1-6]$/.test(e.key)) {
      this.state = setSlot(this.state, this.cursor, Number(e.key) - 1);
      this.cursor = (this.cursor + 1) % SLOTS;
      return true;
    }
    if (e.key === 'ArrowLeft') { this.cursor = (this.cursor + SLOTS - 1) % SLOTS; return true; }
    if (e.key === 'ArrowRight') { this.cursor = (this.cursor + 1) % SLOTS; return true; }
    if (e.key === 'ArrowUp') { this.state = cycleSlot(this.state, this.cursor, 1); return true; }
    if (e.key === 'ArrowDown') { this.state = cycleSlot(this.state, this.cursor, -1); return true; }
    if (e.key === ' ') { this.state = cycleSlot(this.state, this.cursor, 1); return true; }
    if (e.key === 'Backspace') { this.state = setSlot(this.state, this.cursor, EMPTY); return true; }
    if (e.key === 'Enter') { this.trySubmit(); return true; }
    return false;
  }

  // ---- drawing --------------------------------------------------------------------

  draw(ctx: CanvasRenderingContext2D, area: Area, now: number): void {
    const s = this.state;
    this.hits = [];
    const rows = MAX_ROWS + 2;
    const rowH = Math.max(34, Math.min(50, area.h / (rows + 0.8)));
    const slot = Math.min(rowH * 0.86, area.w / 9);
    const labelW = slot * 7.4;
    const x0 = area.x + (area.w - labelW) / 2;
    const y0 = area.y + (area.h - rowH * rows - 8) / 2;
    const slotX = (k: number) => x0 + slot * 0.6 + (k + 0.5) * slot;
    const symR = slot * 0.3;

    // The secret, a sealed label until the code is cracked.
    const secretY = y0 + rowH / 2;
    label(ctx, x0, secretY - rowH * 0.42, labelW, rowH * 0.84, this.won ? 0.14 : 0.06);
    for (let k = 0; k < SLOTS; k++) {
      if (this.won) symbol(ctx, slotX(k), secretY, symR, s.secret[k]);
      else {
        ctx.strokeStyle = 'rgba(226, 220, 207, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.arc(slotX(k), secretY, symR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.font = `11px ${MONO}`;
    ctx.fillStyle = 'rgba(226, 220, 207, 0.5)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.won ? 'code' : 'sealed', x0 + labelW - 10, secretY);

    // Guess rows: the submitted ones, then the draft, then blanks.
    for (let r = 0; r < MAX_ROWS; r++) {
      const y = y0 + rowH * (r + 1.3) + rowH / 2;
      const row = s.rows[r];
      const isDraft = r === s.rows.length && !this.over();
      ctx.font = `11px ${MONO}`;
      ctx.fillStyle = 'rgba(226, 220, 207, 0.4)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(r + 1), x0 + slot * 0.45, y);
      if (row) {
        const justNow = r === s.rows.length - 1 && !this.reduced ? ease((now - this.submittedAt) / REVEAL_MS) : 1;
        label(ctx, x0, y - rowH * 0.42, labelW, rowH * 0.84, 0.08 * justNow + 0.02);
        for (let k = 0; k < SLOTS; k++) symbol(ctx, slotX(k), y, symR, row.guess[k], 0.5 + 0.5 * justNow);
        clues(ctx, x0 + labelW - slot * 1.1, y, symR * 0.5, row.exact, row.near, justNow);
      } else if (isDraft) {
        label(ctx, x0, y - rowH * 0.42, labelW, rowH * 0.84, 0.12);
        for (let k = 0; k < SLOTS; k++) {
          const cx = slotX(k);
          this.hits.push({ hit: { kind: 'slot', index: k }, x: cx, y, r: Math.max(20, slot / 2) });
          if (k === this.cursor) {
            ctx.strokeStyle = 'rgba(226, 220, 207, 0.7)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cx, y, symR + 5, 0, Math.PI * 2);
            ctx.stroke();
          }
          if (s.draft[k] === EMPTY) {
            ctx.strokeStyle = 'rgba(226, 220, 207, 0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(cx, y, symR, 0, Math.PI * 2);
            ctx.stroke();
          } else symbol(ctx, cx, y, symR, s.draft[k]);
        }
        // The submit mark: an arrow, red once the row is full.
        const ax = x0 + labelW - slot * 0.9;
        const ready = draftComplete(s);
        this.hits.push({ hit: { kind: 'submit', index: 0 }, x: ax, y, r: Math.max(20, slot / 2) });
        ctx.strokeStyle = ready ? '#e0503a' : 'rgba(226, 220, 207, 0.3)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ax - 8, y);
        ctx.lineTo(ax + 8, y);
        ctx.moveTo(ax + 2, y - 6);
        ctx.lineTo(ax + 8, y);
        ctx.lineTo(ax + 2, y + 6);
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(226, 220, 207, 0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x0 + slot * 0.6, y);
        ctx.lineTo(x0 + labelW - slot * 0.5, y);
        ctx.stroke();
      }
    }

    // The key row: all six symbols, tap to set the chosen slot.
    const ky = y0 + rowH * (MAX_ROWS + 1.6) + rowH / 2;
    const keyStep = labelW / (SYMBOLS + 0.5);
    for (let k = 0; k < SYMBOLS; k++) {
      const cx = x0 + keyStep * (k + 0.75);
      symbol(ctx, cx, ky, symR * 0.85, k, this.over() ? 0.4 : 0.85);
      ctx.font = `10px ${MONO}`;
      ctx.fillStyle = 'rgba(226, 220, 207, 0.4)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(String(k + 1), cx, ky + symR + 3);
      this.hits.push({ hit: { kind: 'key', index: k }, x: cx, y: ky, r: Math.max(20, keyStep / 2) });
    }
  }
}

/** A strip of typed paper. */
function label(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha: number): void {
  ctx.fillStyle = `rgba(226, 220, 207, ${alpha})`;
  ctx.strokeStyle = 'rgba(226, 220, 207, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();
}

/** One of the six symbols: a colour and a shape, so colour alone never carries the code. */
export function symbol(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, k: number, alpha = 1): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLOURS[k];
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  switch (k) {
    case 0: ctx.arc(x, y, r, 0, Math.PI * 2); break;
    case 1: ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.8); ctx.lineTo(x - r, y + r * 0.8); ctx.closePath(); break;
    case 2: ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7); break;
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
  ctx.stroke();
  ctx.restore();
}

/** The clue dots: filled for right place, hollow for right symbol elsewhere. */
function clues(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, exact: number, near: number, alpha: number): void {
  const step = r * 2.6;
  for (let i = 0; i < SLOTS; i++) {
    const cx = x - (SLOTS - 1 - i) * step;
    ctx.beginPath();
    ctx.arc(cx, y, r, 0, Math.PI * 2);
    if (i < exact) {
      ctx.fillStyle = `rgba(243, 238, 226, ${0.95 * alpha})`;
      ctx.fill();
    } else if (i < exact + near) {
      ctx.strokeStyle = `rgba(243, 238, 226, ${0.9 * alpha})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = `rgba(226, 220, 207, ${0.12 * alpha})`;
      ctx.fill();
    }
  }
}
