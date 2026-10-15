// The Atlas map: one arrangement of the 118 atoms (layouts.ts) drawn as an SVG shape that
// fills its box. Drag to move, pinch or wheel to zoom; a double tap opens the atom. The labels follow
// the zoom: at a glance only the colors show, then each cell's symbol once it is large enough,
// then its number, then its name. Tapping a cell picks it (the animated border, in the accent);
// tapping empty space lets it go. A search dims every cell it does not match.
//
//   const map = new AtlasMap(host, { onPick: (z) => peek(z), onOpen: (z) => openPage(z) });
//   map.setLayout('ribbon');
//   map.setColors((e) => placeColour(e));

import { ELEMENTS, elementAt, type Element } from './data';
import { layout, type Cell, type Layout, type LayoutId } from './layouts';
import { inkOn } from './looks';

const NS = 'http://www.w3.org/2000/svg';
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/** Screen pixels: the label sizes, and what a cell needs before each label shows. */
const SYM_PX = 13;
const NUM_PX = 13;
const NAME_PX = 13;
const MAX_ZOOM = 9;
/** Kept clear when the whole shape is shown: at the top for "About this shape" and the legend,
 *  at the foot for the peek strip, which float there. */
const TOP_ROOM = 52;
const FOOT_ROOM = 84;

interface Pointer { x: number; y: number }

export class AtlasMap {
  readonly el: SVGSVGElement;
  private world = svg('g');
  private decorG = svg('g', { class: 'am-decor' });
  private cellsG = svg('g', { class: 'am-cells' });
  private labelsG = svg('g', { class: 'am-labels' });
  private axisG = svg('g', { class: 'am-axis' });
  private ringG = svg('g', { class: 'am-ring' });
  private id: LayoutId = 'table';
  private lay: Layout | null = null;
  private paths = new Map<number, SVGPathElement>();
  private texts = new Map<number, { sym: SVGTextElement; num: SVGTextElement; name: SVGTextElement; cell: Cell }>();
  private colors: (e: Element) => string = () => '#444';
  private matches: Set<number> | null = null;
  private picked: number | null = null;
  // The view: world units to pixels, and the world point at the box's top left.
  private scale = 1;
  private fit = 1;
  private tx = 0;
  private ty = 0;
  private w = 1;
  private h = 1;
  private bounds = { x: 0, y: 0, w: 1, h: 1 };
  private pointers = new Map<number, Pointer>();
  private gesture: { moved: boolean; start: Pointer; pinch?: { d: number; scale: number; cx: number; cy: number } } | null = null;
  private lastTap = 0;
  private frame = 0;

  constructor(host: HTMLElement, private opts: { onPick: (z: number | null) => void; onOpen: (z: number) => void }) {
    this.el = svg('svg', { class: 'am', role: 'img' });
    this.el.append(this.world);
    this.world.append(this.decorG, this.cellsG, this.ringG, this.labelsG, this.axisG);
    host.append(this.el);
    new ResizeObserver(() => this.resize()).observe(host);
    this.bind();
  }

  setLayout(id: LayoutId): void {
    this.id = id;
    this.build();
  }

  /** Each element's fill. */
  setColors(fn: (e: Element) => string): void {
    this.colors = fn;
    for (const e of ELEMENTS) {
      const fill = fn(e);
      this.paths.get(e.z)?.setAttribute('fill', fill);
      const t = this.texts.get(e.z);
      if (t) for (const x of [t.sym, t.num, t.name]) x.setAttribute('fill', inkOn(fill));
    }
  }

  /** Dim every cell but these (null: none dimmed). */
  setMatches(zs: number[] | null): void {
    this.matches = zs ? new Set(zs) : null;
    for (const [z, p] of this.paths) p.classList.toggle('is-dim', Boolean(this.matches && !this.matches.has(z)));
    for (const [z, t] of this.texts) t.sym.parentElement!.classList.toggle('is-dim', Boolean(this.matches && !this.matches.has(z)));
    // One match: bring it into view.
    if (zs && zs.length === 1) this.reveal(zs[0]);
  }

  /** Pick an atom (the animated border round its cell), or none. */
  select(z: number | null): void {
    this.picked = z;
    this.ringG.replaceChildren();
    const cell = z == null ? null : this.lay?.cells.find((c) => c.z === z);
    if (!cell) return;
    this.ringG.append(svg('path', { d: cell.d, class: 'am-pick' }), svg('path', { d: cell.d, class: 'am-pick-glow' }));
  }

  /** Move the view so an atom's cell is on screen, zooming in until its symbol shows. */
  reveal(z: number): void {
    const c = this.lay?.cells.find((x) => x.z === z);
    if (!c) return;
    const need = this.symbolScale(c);
    if (this.scale < need) this.scale = Math.min(this.fit * MAX_ZOOM, need * 1.1);
    const sx = (c.x - this.tx) * this.scale, sy = (c.y - this.ty) * this.scale;
    const m = 40;
    if (sx < m || sx > this.w - m || sy < TOP_ROOM + m || sy > this.h - FOOT_ROOM - m) {
      this.tx = c.x - this.w / 2 / this.scale;
      this.ty = c.y - (TOP_ROOM + (this.h - TOP_ROOM - FOOT_ROOM) / 2) / this.scale;
    }
    this.clampView();
    this.apply();
  }

  /** Back to the whole shape. */
  reset(): void {
    this.scale = this.fit;
    this.center();
    this.apply();
  }

  private build(): void {
    this.lay = layout(this.id);
    this.paths.clear();
    this.texts.clear();
    this.cellsG.replaceChildren();
    this.decorG.replaceChildren(...(this.lay.decor ?? []).map((d) => svg('path', { d: d.d, class: `am-${d.kind}` })));
    this.labelsG.replaceChildren();
    this.axisG.replaceChildren();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (x: number, y: number, r = 0) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
    this.lay.cells.forEach((c, i) => {
      const e = elementAt(c.z);
      const p = svg('path', { d: c.d, 'data-z': c.z, class: 'am-cell', style: `--i:${i}` });
      const fill = this.colors(e);
      p.setAttribute('fill', fill);
      this.cellsG.append(p);
      this.paths.set(c.z, p);
      const g = svg('g', { class: 'am-label', 'data-z': c.z });
      const ink = inkOn(fill);
      const sym = svg('text', { class: 'am-sym', fill: ink });
      sym.textContent = e.symbol;
      const num = svg('text', { class: 'am-num', fill: ink });
      num.textContent = String(e.z);
      const name = svg('text', { class: 'am-name', fill: ink });
      name.textContent = e.name;
      g.append(num, sym, name);
      this.labelsG.append(g);
      this.texts.set(c.z, { sym, num, name, cell: c });
      grow(c.x, c.y, Math.max(c.w, c.h) * 0.75);
    });
    for (const l of this.lay.labels) {
      const t = svg('text', { class: `am-${l.kind}`, x: l.x, y: l.y });
      t.textContent = l.text;
      this.axisG.append(t);
      grow(l.x, l.y, 0.5);
    }
    this.bounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    this.select(this.picked);
    if (this.matches) this.setMatches([...this.matches]);
    this.measure();
    this.reset();
  }

  private measure(): void {
    const r = this.el.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.fit = Math.min(this.w / this.bounds.w, (this.h - TOP_ROOM - FOOT_ROOM) / this.bounds.h) * 0.96;
  }

  private resize(): void {
    const r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (!this.lay) { this.build(); return; }
    const zoomed = this.scale > this.fit * 1.02;
    this.measure();
    if (zoomed) { this.clampView(); this.apply(); } else this.reset();
  }

  private center(): void {
    this.tx = this.bounds.x + this.bounds.w / 2 - this.w / 2 / this.scale;
    this.ty = this.bounds.y + this.bounds.h / 2 - (TOP_ROOM + (this.h - TOP_ROOM - FOOT_ROOM) / 2) / this.scale;
  }

  /** Keep some of the shape on screen however far it is dragged. */
  private clampView(): void {
    this.scale = Math.max(this.fit, Math.min(this.fit * MAX_ZOOM, this.scale));
    // The shape's edges can scroll clear of the tools above and the peek strip below.
    const vw = this.w / this.scale, vh = (this.h - TOP_ROOM - FOOT_ROOM) / this.scale;
    const b = this.bounds;
    const fx = (lo: number, hi: number, v: number, span: number) => (span >= hi - lo ? (lo + hi) / 2 - span / 2 : Math.max(lo, Math.min(hi - span, v)));
    this.tx = fx(b.x, b.x + b.w, this.tx, vw);
    const top = TOP_ROOM / this.scale;
    this.ty = fx(b.y, b.y + b.h, this.ty + top, vh) - top;
  }

  /** The atom whose cell center is within half a cell of a screen point: a tap just off a small
   *  circle on Sizes, or in a seam, still finds it. */
  private near(p: Pointer): number | null {
    const x = this.tx + p.x / this.scale, y = this.ty + p.y / this.scale;
    let best: number | null = null, d = 0.6;
    for (const c of this.lay?.cells ?? []) {
      const k = Math.hypot(c.x - x, c.y - y);
      if (k < d) { d = k; best = c.z; }
    }
    return best;
  }

  /** The zoom at which a cell's symbol fits. */
  private symbolScale(c: Cell): number {
    const e = elementAt(c.z);
    const symW = SYM_PX * 0.62 * Math.max(2, e.symbol.length) + 6;
    return Math.max(symW / c.w, (SYM_PX + 4) / c.h);
  }

  private apply(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const s = this.scale;
      this.world.setAttribute('transform', `scale(${s}) translate(${-this.tx} ${-this.ty})`);
      this.el.style.setProperty('--u', String(1 / s));
      // Labels: each one at its screen size, shown once its cell has room for it.
      for (const { sym, num, name, cell } of this.texts.values()) {
        const pw = cell.w * s, ph = cell.h * s;
        const e = elementAt(cell.z);
        // Room for two letters or none: a lone H or K among blank cells reads as a mistake.
        const showSym = pw >= SYM_PX * 0.62 * Math.max(2, e.symbol.length) + 6 && ph >= SYM_PX + 4;
        const symPx = Math.min(30, Math.max(SYM_PX, ph * 0.34));
        const showNum = showSym && ph >= symPx + NUM_PX + 12;
        const nameW = NAME_PX * 0.56 * e.name.length + 8;
        const showName = showNum && ph >= symPx + NUM_PX + NAME_PX + 18 && pw >= nameW;
        const lines = [showNum ? NUM_PX : 0, showSym ? symPx : 0, showName ? NAME_PX : 0];
        const gap = 3;
        const total = lines.reduce((a, b) => a + b, 0) + gap * (lines.filter(Boolean).length - 1);
        let y = cell.y - total / 2 / s;
        const put = (t: SVGTextElement, on: boolean, px: number) => {
          t.style.display = on ? '' : 'none';
          if (!on) return;
          t.setAttribute('x', String(cell.x));
          t.setAttribute('y', String(y + (px * 0.8) / s));
          t.setAttribute('font-size', String(px / s));
          y += (px + gap) / s;
        };
        put(num, showNum, NUM_PX);
        put(sym, showSym, symPx);
        put(name, showName, NAME_PX);
      }
      // Period and group numbers only once the cells are big enough to keep them apart.
      this.axisG.style.display = (this.lay?.unit ?? this.lay?.cells[0]?.h ?? 1) * s >= 16 ? '' : 'none';
      for (const t of this.axisG.querySelectorAll<SVGTextElement>('text')) t.setAttribute('font-size', String(13 / s));
    });
  }

  private bind(): void {
    const el = this.el;
    const at = (ev: PointerEvent | WheelEvent): Pointer => { const r = el.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    const zoomAt = (p: Pointer, scale: number) => {
      const wx = this.tx + p.x / this.scale, wy = this.ty + p.y / this.scale;
      this.scale = Math.max(this.fit, Math.min(this.fit * MAX_ZOOM, scale));
      this.tx = wx - p.x / this.scale;
      this.ty = wy - p.y / this.scale;
      this.clampView();
      this.apply();
    };
    el.addEventListener('pointerdown', (ev) => {
      el.setPointerCapture(ev.pointerId);
      const p = at(ev);
      this.pointers.set(ev.pointerId, p);
      if (this.pointers.size === 1) this.gesture = { moved: false, start: p };
      if (this.pointers.size === 2 && this.gesture) {
        const [a, b] = [...this.pointers.values()];
        this.gesture.moved = true;
        this.gesture.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: this.scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      }
    });
    el.addEventListener('pointermove', (ev) => {
      const prev = this.pointers.get(ev.pointerId);
      if (!prev || !this.gesture) return;
      const p = at(ev);
      this.pointers.set(ev.pointerId, p);
      const g = this.gesture;
      if (g.pinch && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        // Pan with the fingers' midpoint, zoom about it.
        this.tx -= (cx - g.pinch.cx) / this.scale;
        this.ty -= (cy - g.pinch.cy) / this.scale;
        g.pinch.cx = cx; g.pinch.cy = cy;
        zoomAt({ x: cx, y: cy }, g.pinch.scale * (d / Math.max(1, g.pinch.d)));
        return;
      }
      if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) < 8) return;
      g.moved = true;
      this.tx -= (p.x - prev.x) / this.scale;
      this.ty -= (p.y - prev.y) / this.scale;
      this.clampView();
      this.apply();
    });
    const end = (ev: PointerEvent) => {
      this.pointers.delete(ev.pointerId);
      const g = this.gesture;
      if (this.pointers.size) { if (g?.pinch) g.pinch = undefined; return; }
      this.gesture = null;
      if (!g || g.moved || ev.type === 'pointercancel') return;
      const now = performance.now();
      const p = at(ev);
      const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-z]');
      const z = hit ? Number(hit.getAttribute('data-z')) : this.near(p);
      // A double tap opens the atom's page; pinch is the way to zoom.
      if (now - this.lastTap < 300) {
        this.lastTap = 0;
        if (z != null) this.opts.onOpen(z);
        return;
      }
      this.lastTap = now;
      this.opts.onPick(z);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      zoomAt(at(ev), this.scale * Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0022)));
    }, { passive: false });
  }
}
