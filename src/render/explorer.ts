// Orbital explorer: walk through an atom's orbitals with nothing but touch. Used by the app's
// atom View and by the lab's "Orbital explorer (touch)".
//   swipe up / down     climb or descend the ladder of orbitals (up climbs outward); hard
//                       stops snap to one orbital, gradual lets the light spread to its
//                       neighbours and glide;
//   swipe right / left  orbital focus, more or less: solo (only the focused orbital), ghost
//                       (the rest in gray), all (everything in color, the "Total" view);
//   pinch               zoom (the view also follows the focused orbital's size on its own);
//   twist               turn the colors round the wheel;
//   two fingers drag    turn the atom (one finger turns it instead in "Turn" mode, where
//                       two fingers move along the ladder);
//   double-tap          solo ↔ all.
// With a mouse: wheel climbs the ladder, shift + wheel sets the focus, drag turns the atom
// (or, in Navigate mode, works like a finger), ctrl + wheel zooms; arrow keys work too.

import * as THREE from 'three';
import type { Fingerprint } from './fingerprint';
import { balancedGain, BLOCK_RGB, PHASE, veilScale, type DenseWant, type OrbitalCloud, type OrbitalSet } from './orbitalCloud';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

/** What the explorer turns and zooms: the lab's Orbit, or the app's camera rig. */
export interface ExplorerCamera {
  zoom: number;
  setZoom(z: number): void;
  rotateBy(dx: number, dy: number): void;
}

export interface ExplorerOptions {
  /** Hard stops snap to one orbital; gradual glides. */
  hard: boolean;
  /** What one finger does: walk the ladder and set the context, or turn the atom. */
  finger: 'nav' | 'turn';
  palette: 'phase' | 'print' | 'block';
  /** 0 steady to 1.5. */
  twinkle: number;
  brightness: number;
}

export const EXPLORER_DEFAULTS: ExplorerOptions = { hard: true, finger: 'nav', palette: 'phase', twinkle: 0.35, brightness: 1 };

interface Finger { x: number; y: number; x0: number; y0: number; t0: number }

export class OrbitalExplorer {
  opts: ExplorerOptions = { ...EXPLORER_DEFAULTS };
  set: OrbitalSet | null = null;
  fp: Fingerprint | null = null;
  /** Position on the ladder (orbital index, fractional), its target and velocity. */
  focus = 0;
  goal = 0;
  private vel = 0;
  /** 0 solo, 0.5 ghost, 1 all. */
  context = 0.35;
  contextGoal = 0.35;
  hue = 0;
  /** How fast hard stops spring onto their orbital (per second); soft for auto-play. */
  private spring = 10;
  /** Gliding to `goal` (a tap on the ladder, a key) rather than coasting (gradual mode). */
  private seeking = false;
  /** Auto-play: orbitals per second to drift along the ladder (0 off), and which way. */
  drift = 0;
  private driftDir = 1;
  /** Gestures only turn and zoom (the ladder and context stay put), e.g. at the nucleus. */
  turnOnly = false;
  /** The orbitals near the focus, by emphasis: the ones to give dense points (applyLooks). */
  denseWants: DenseWant[] = [];
  /** Called on any gesture, wheel or key the explorer acts on. */
  onInteract: (() => void) | null = null;
  private fingers = new Map<number, Finger>();
  private axis: 'v' | 'h' | null = null;
  private two: { d: number; a: number; cx: number; cy: number; zoom: number; hue: number } | null = null;
  private lastTap = 0;
  private lastMove = { t: 0, f: 0 };
  private wheelIdle = 0;

  constructor(private camera: ExplorerCamera) {}

  /** Show a new set; a new atom starts on its outermost orbital with a shape (the valence). */
  setSet(set: OrbitalSet, fp: Fingerprint): void {
    const fresh = this.set?.element.z !== set.element.z;
    this.set = set;
    this.fp = fp;
    if (fresh) {
      const shaped = set.orbitals.filter((o) => o.l > 0);
      const start = (shaped.length ? shaped[shaped.length - 1] : set.orbitals[set.orbitals.length - 1]).index;
      this.focus = this.goal = start;
      this.vel = 0;
    }
    this.focus = clamp(this.focus, 0, this.last);
    this.goal = clamp(this.goal, 0, this.last);
  }

  get last(): number { return Math.max(0, (this.set?.orbitals.length ?? 1) - 1); }
  /** A finger is down on the atom. */
  get touching(): boolean { return this.fingers.size > 0; }
  /** Resting on one orbital: no finger down, the spring nearly home. Dense points are sampled
   *  only then, so a swipe through the ladder never pays for orbitals it passes. */
  get settled(): boolean { return !this.touching && Math.abs(this.focus - this.goal) < 0.2; }
  /** Two fingers are down (turning, pinching): the atom's own spin waits. */
  get turning(): boolean { return this.fingers.size >= 2; }

  /** Glide to an orbital: snappy for a tap on the ladder, soft (`soft`) for auto-play. */
  goTo(i: number, soft = false): void {
    this.goal = clamp(Math.round(i), 0, this.last);
    this.vel = 0;
    this.spring = soft ? 2.2 : this.opts.hard ? 10 : 4;
    this.seeking = true;
  }

  setContext(v: number): void {
    this.contextGoal = clamp(v, 0, 1);
  }

  private touched(): void {
    this.spring = this.opts.hard ? 10 : 4;
    this.onInteract?.();
  }

  // ---- gestures ----

  /** Read gestures from `el`; returns a function that stops. Keys are left to the caller
   *  (key()), since the app gives the arrows other jobs too. */
  attach(el: HTMLElement): () => void {
    const list: [string, EventListener, AddEventListenerOptions?][] = [];
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, o);
      list.push([type, fn as EventListener, o]);
    };
    on('pointerdown', (e) => this.down(e));
    on('pointermove', (e) => this.move(e));
    on('pointerup', (e) => this.up(e));
    on('pointercancel', (e) => this.up(e));
    on('wheel', (e) => this.wheel(e), { passive: false });
    return () => {
      for (const [type, fn, o] of list) el.removeEventListener(type, fn, o);
      window.clearTimeout(this.wheelIdle);
    };
  }

  private down(e: PointerEvent): void {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
    this.axis = null;
    this.vel = 0;
    this.seeking = false;
    this.touched();
    if (this.fingers.size === 2) {
      const [a, b] = [...this.fingers.values()];
      this.two = {
        d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), a: Math.atan2(b.y - a.y, b.x - a.x),
        cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, zoom: this.camera.zoom, hue: this.hue,
      };
    }
  }

  private move(e: PointerEvent): void {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    const dx = e.clientX - f.x, dy = e.clientY - f.y;
    f.x = e.clientX;
    f.y = e.clientY;
    this.onInteract?.();
    const turnMode = this.turnOnly || this.opts.finger === 'turn';
    if (this.fingers.size >= 2 && this.two) {
      const [a, b] = [...this.fingers.values()];
      const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      this.camera.setZoom(this.two.zoom * (d / this.two.d));
      let turn = ang - this.two.a;
      if (turn > Math.PI) turn -= 2 * Math.PI;
      if (turn < -Math.PI) turn += 2 * Math.PI;
      if (!this.turnOnly) this.hue = this.two.hue + turn;
      const mx = cx - this.two.cx, my = cy - this.two.cy;
      this.two.cx = cx;
      this.two.cy = cy;
      if (!this.turnOnly && this.opts.finger === 'turn') this.climb(my);
      else this.camera.rotateBy(mx, my);
      return;
    }
    if (turnMode) { this.camera.rotateBy(dx, dy); return; }
    // One finger navigates: lock to the first clear direction.
    if (!this.axis) {
      const tx = f.x - f.x0, ty = f.y - f.y0;
      if (Math.hypot(tx, ty) < 8) return;
      this.axis = Math.abs(ty) >= Math.abs(tx) ? 'v' : 'h';
    }
    if (this.axis === 'v') this.climb(dy);
    else this.contextGoal = clamp(this.contextGoal - dx / 240, 0, 1);
  }

  /** Move along the ladder by a vertical drag of dy pixels (up climbs). */
  private climb(dy: number): void {
    const step = -dy / 64;
    this.focus = clamp(this.focus + step, 0, this.last);
    this.goal = this.focus;
    const now = performance.now();
    const dt = Math.max(1, now - this.lastMove.t) / 1000;
    this.vel = this.vel * 0.6 + (step / dt) * 0.4;
    this.lastMove = { t: now, f: this.focus };
  }

  private up(e: PointerEvent): void {
    const f = this.fingers.get(e.pointerId);
    this.fingers.delete(e.pointerId);
    if (this.fingers.size < 2) this.two = null;
    if (!f) return;
    const moved = Math.hypot(f.x - f.x0, f.y - f.y0);
    const now = performance.now();
    if (moved < 8 && now - f.t0 < 300 && !this.fingers.size) {
      // A double-tap swaps solo and all.
      if (this.turnOnly) return;
      if (now - this.lastTap < 320) { this.contextGoal = this.contextGoal > 0.5 ? 0 : 1; this.lastTap = 0; }
      else this.lastTap = now;
      return;
    }
    if (this.axis === 'v' && now - this.lastMove.t > 90) this.vel = 0;
    if (this.opts.hard) this.goal = clamp(Math.round(this.focus + clamp(this.vel, -12, 12) * 0.12), 0, this.last);
    this.axis = null;
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    this.touched();
    if (e.ctrlKey || this.turnOnly) { this.camera.setZoom(this.camera.zoom * Math.exp(-e.deltaY * 0.01)); return; }
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      this.contextGoal = clamp(this.contextGoal - (e.deltaX || e.deltaY) / 600, 0, 1);
      return;
    }
    this.focus = clamp(this.focus - e.deltaY / 140, 0, this.last);
    this.goal = this.focus;
    this.vel = 0;
    this.seeking = false;
    // Hard stops: settle on the nearest orbital once the wheel rests.
    window.clearTimeout(this.wheelIdle);
    if (this.opts.hard) this.wheelIdle = window.setTimeout(() => { this.goal = Math.round(this.focus); }, 140);
  }

  /** Arrow keys: up and down climb the ladder; with `sideways`, right and left focus more or less.
   *  True when the key was used. */
  key(e: KeyboardEvent, sideways = true): boolean {
    if ((e.target as HTMLElement)?.closest?.('input, select, textarea')) return false;
    if (this.turnOnly) return false;
    if (e.key === 'ArrowUp') this.goal = clamp(Math.round(this.goal) + 1, 0, this.last);
    else if (e.key === 'ArrowDown') this.goal = clamp(Math.round(this.goal) - 1, 0, this.last);
    else if (sideways && e.key === 'ArrowRight') this.contextGoal = clamp(this.contextGoal - 0.25, 0, 1);
    else if (sideways && e.key === 'ArrowLeft') this.contextGoal = clamp(this.contextGoal + 0.25, 0, 1);
    else return false;
    this.touched();
    this.seeking = true;
    this.vel = 0;
    e.preventDefault();
    return true;
  }

  // ---- motion and looks ----

  /** Advance the ladder and the context by `dt` seconds; returns the radius (a0) to frame:
   *  close on a small inner orbital, out to the whole atom as the context opens up. */
  update(dt: number): number {
    const set = this.set;
    if (!set) return 1;
    const dragging = this.fingers.size > 0 && this.axis === 'v';
    if (!dragging) {
      if (this.drift > 0 && !this.touching) {
        // Auto-play: drift along the ladder, easing to a stop at either end and back.
        const ahead = this.driftDir > 0 ? this.last - this.focus : this.focus;
        if (ahead < 0.02) this.driftDir = -this.driftDir;
        const want = this.driftDir * this.drift * Math.min(1, 0.12 + Math.max(0, ahead) / 0.7);
        this.vel += (want - this.vel) * (1 - Math.exp(-dt * 1.5));
        this.focus = clamp(this.focus + this.vel * dt, 0, this.last);
        this.goal = this.focus;
        this.seeking = false;
      } else if (this.opts.hard || this.seeking) {
        // A spring onto the chosen orbital.
        const k = 1 - Math.exp(-dt * this.spring);
        this.focus += (this.goal - this.focus) * k;
        if (Math.abs(this.goal - this.focus) < 0.002) this.seeking = false;
      } else {
        // Gradual: glide on, slowing down.
        this.focus = clamp(this.focus + this.vel * dt, 0, this.last);
        this.vel *= Math.exp(-dt * 2.5);
        if (this.focus <= 0 || this.focus >= this.last) this.vel = 0;
        this.goal = this.focus;
      }
    }
    this.context += (this.contextGoal - this.context) * (1 - Math.exp(-dt * 8));
    const i0 = Math.floor(this.focus), i1 = Math.min(this.last, i0 + 1), fr = this.focus - i0;
    const rFocus = set.orbitals[i0].r90 * (1 - fr) + set.orbitals[i1].r90 * fr;
    const reach = smooth((this.context - 0.5) * 2);
    return rFocus * 1.25 * (1 - reach) + set.r90 * 1.12 * reach;
  }

  /** Set every orbital's look on `cloud` for a view framed on `frame` (a0). `lit` (optional,
   *  per orbital, 0 to 1) turns parts not built yet gray and fainter. */
  applyLooks(cloud: OrbitalCloud, frame: number, lit?: ArrayLike<number>): void {
    const set = this.set, fp = this.fp, o = this.opts;
    if (!set || !fp) return;
    const sigma = o.hard ? 0.32 : 0.85;
    const solo = clamp(this.context * 2, 0, 1); // 0 → 1 over solo → ghost
    const all = clamp((this.context - 0.5) * 2, 0, 1); // ghost → all
    this.denseWants = [];
    for (const x of set.orbitals) {
      const d = x.index - this.focus;
      const e = Math.exp(-(d * d) / (2 * sigma * sigma));
      const [pos, neg] = o.palette === 'print' ? fp.colors[x.index] : o.palette === 'block' ? BLOCK_RGB[x.block] : PHASE;
      // The rest: hidden (solo), a thin gray veil (ghost), or all of it in color.
      // Small inner orbitals always thin out (they would pile into a white core); big outer
      // ones only while they are a veil.
      const v = veilScale(x, frame);
      const restShare = (0.12 * solo + 0.88 * all) * (x.r90 < frame ? v : v * (1 - all) + all);
      const share = Math.max(e, restShare);
      const on = lit ? lit[x.index] : 1;
      // The focus gets dense points, fading as it moves on (none in the all-color view, where
      // every orbital shares the light).
      if (e > 0.05 && all < 0.5) this.denseWants.push({ index: x.index, weight: e * (1 - all * 2) });
      cloud.setLook(x.index, {
        pos, neg,
        share,
        // The focus keeps its full light; the rest join at a little over half (ghost), a third
        // when all of them are in (so the whole atom doesn't flare into one white blob).
        gain: share > 0.004 ? balancedGain(x, set, frame) * (e + (1 - e) * (0.55 - 0.22 * all)) * (0.5 + 0.5 * on) : 0,
        sat: (e + (1 - e) * all) * on,
        twinkle: 0.7 + 0.5 * e,
        breath: 0,
        flash: 0,
      });
    }
    const u = cloud.material.uniforms;
    u.uTwinkle.value = o.twinkle;
    u.uAlpha.value = 0.55 * o.brightness;
    u.uHue.value = this.hue;
    (u.uPulse.value as THREE.Vector4).set(-1, 1, 0, 0);
  }
}

/** Class names for the HUD's parts, so the lab and the app can style it each their own way. */
export interface ExplorerHudOptions {
  /** Prefix for the class names: `${prefix}-ladder`, `-focus`. */
  prefix: string;
  /** Pixels between the ladder's rows, and how many rows either side of the focus show. */
  row?: number;
  reach?: number;
}

/**
 * The explorer's HUD: the ladder of orbitals (outer ones below, so the list moves with the
 * finger that climbs it; tap one to go there), and "− Orbital focus +", whose ends step the
 * focus as a sideways swipe does: solo, ghost, all.
 */
export class ExplorerHud {
  readonly ladderEl: HTMLElement;
  readonly focusEl: HTMLElement;
  private ladder: HTMLButtonElement[] = [];
  private shownSet: OrbitalSet | null = null;
  private opts: Required<ExplorerHudOptions>;

  constructor(private host: HTMLElement, private ex: OrbitalExplorer, opts: ExplorerHudOptions) {
    this.opts = { row: 24, reach: 7, ...opts };
    const p = this.opts.prefix;
    this.ladderEl = document.createElement('div');
    this.ladderEl.className = `${p}-ladder`;
    this.ladderEl.setAttribute('role', 'group');
    this.ladderEl.setAttribute('aria-label', 'Orbitals, inner to outer');
    this.focusEl = document.createElement('div');
    this.focusEl.className = `${p}-focus`;
    this.focusEl.setAttribute('role', 'group');
    this.focusEl.setAttribute('aria-label', 'Orbital focus');
    const step = (sign: string, label: string, by: number) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = sign;
      b.setAttribute('aria-label', label);
      b.onclick = () => { this.ex.setContext(this.ex.contextGoal + by); this.ex.onInteract?.(); };
      return b;
    };
    const name = document.createElement('span');
    name.textContent = 'Orbital focus';
    this.focusEl.append(step('−', 'Less focus: bring in the rest of the atom', 0.25), name, step('+', 'More focus: only this orbital', -0.25));
    host.append(this.ladderEl, this.focusEl);
  }

  /** Repaint for the current frame (cheap: only transforms). */
  paint(): void {
    const set = this.ex.set;
    if (!set) return;
    if (set !== this.shownSet) {
      this.shownSet = set;
      this.ladderEl.replaceChildren();
      this.ladder = set.orbitals.map((o) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = o.label;
        b.onclick = () => { this.ex.goTo(o.index); this.ex.onInteract?.(); };
        this.ladderEl.append(b);
        return b;
      });
    }
    const { row, reach } = this.opts;
    const focus = this.ex.focus;
    this.ladder.forEach((b, i) => {
      const d = i - focus;
      const a = Math.max(0, 1 - Math.abs(d) / reach);
      b.style.transform = `translateY(${(d * row).toFixed(1)}px) scale(${(0.82 + 0.3 * Math.exp(-d * d * 2)).toFixed(3)})`;
      b.style.opacity = a.toFixed(2);
      b.style.pointerEvents = a > 0.15 ? 'auto' : 'none';
      b.tabIndex = a > 0.15 ? 0 : -1;
      b.classList.toggle('on', Math.abs(d) < 0.5);
    });
  }

  dispose(): void {
    this.ladderEl.remove();
    this.focusEl.remove();
  }
}
