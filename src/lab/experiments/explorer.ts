// Orbital explorer: walk through an atom's orbitals with nothing but touch.
//   swipe up / down     climb or descend the ladder of orbitals (inner at the bottom, outer at
//                       the top, like an energy diagram); hard stops snap to one orbital,
//                       gradual lets the light spread to its neighbours and glide;
//   swipe left / right  context: solo (only the focused orbital), ghost (the rest in gray),
//                       all (everything in color, the "Total" view);
//   pinch               zoom (the view also follows the focused orbital's size on its own);
//   twist               turn the colors round the wheel;
//   two fingers drag    turn the atom (one finger turns it instead in "Turn" mode, where
//                       two fingers move along the ladder);
//   double-tap          solo ↔ all.
// With a mouse: wheel climbs the ladder, shift + wheel sets the context, drag turns the atom
// (or, in Navigate mode, works like a finger), ctrl + wheel zooms; arrow keys work too.

import * as THREE from 'three';
import { atomFingerprint, type Fingerprint } from '../fingerprint';
import type { AtomModel } from '../model';
import { balancedGain, BLOCK_RGB, OrbitalCloud, orbitalSet, PHASE, veilScale, type OrbitalSet } from '../orbitalCloud';
import type { Experiment, ExperimentOption, LabContext, Settings } from '../types';
import { ORBITAL_POINTS, TWINKLE_OPTION } from './fingerprint';

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

interface Finger { x: number; y: number; x0: number; y0: number; t0: number }

export class ExplorerView implements Experiment {
  id = 'explorer';
  name = 'Orbital explorer (touch)';
  description = 'Swipe up and down to walk the orbitals, left and right to bring in the rest of the atom (solo, ghost, all). Pinch to zoom, twist to turn the colors, two fingers to turn the atom, double-tap for solo or all.';
  uses = { brightness: true, orbital: false };
  options: ExperimentOption[] = [
    TWINKLE_OPTION,
    { id: 'stops', label: 'Ladder', choices: [{ id: 'hard', label: 'Hard stops' }, { id: 'soft', label: 'Gradual' }] },
    { id: 'finger', label: 'One finger', choices: [{ id: 'nav', label: 'Navigate' }, { id: 'turn', label: 'Turn' }] },
    { id: 'palette', label: 'Colors', choices: [{ id: 'phase', label: 'Phase' }, { id: 'print', label: 'Fingerprint' }, { id: 'block', label: 'Subshell' }] },
  ];
  private ctx!: LabContext;
  private cloud!: OrbitalCloud;
  private set: OrbitalSet | null = null;
  private model: AtomModel | null = null;
  private fp: Fingerprint | null = null;
  private settings: Settings | null = null;
  /** Position on the ladder (orbital index, fractional), its target and velocity. */
  private focus = 0;
  private goal = 0;
  private vel = 0;
  /** 0 solo, 0.5 ghost, 1 all. */
  private context = 0.35;
  private contextGoal = 0.35;
  private hue = 0;
  private fingers = new Map<number, Finger>();
  private axis: 'v' | 'h' | null = null;
  private two: { d: number; a: number; cx: number; cy: number; zoom: number; hue: number } | null = null;
  private lastTap = 0;
  private lastMove = { t: 0, f: 0 };
  private wheelIdle = 0;
  private hud: HTMLElement | null = null;
  private ladder: HTMLElement[] = [];
  private listeners: [string, EventListener, AddEventListenerOptions?][] = [];

  wantsSign(): boolean { return true; }

  frame(model: AtomModel): number {
    const set = this.set ?? this.build(model);
    return set.r90 * model.worldPerA0 * 1.12;
  }

  init(ctx: LabContext): void {
    this.ctx = ctx;
    this.cloud = new OrbitalCloud(ctx);
    if (ctx.orbit) ctx.orbit.input = false;
    const c = ctx.canvas;
    if (c) {
      const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => {
        c.addEventListener(type, fn as EventListener, o);
        this.listeners.push([type, fn as EventListener, o]);
      };
      on('pointerdown', (e) => this.down(e));
      on('pointermove', (e) => this.move(e));
      on('pointerup', (e) => this.up(e));
      on('pointercancel', (e) => this.up(e));
      on('wheel', (e) => this.wheel(e), { passive: false });
    }
    window.addEventListener('keydown', this.onKey);
    if (ctx.ui) {
      this.hud = document.createElement('div');
      this.hud.className = 'lab-ex';
      ctx.ui.append(this.hud);
    }
  }

  private build(model: AtomModel): OrbitalSet {
    const q = ORBITAL_POINTS[this.settings?.quality ?? 'medium'];
    return orbitalSet(model.element, q.per, q.budget);
  }

  private rebuild(): void {
    if (!this.model || !this.settings) return;
    const set = this.build(this.model);
    if (set === this.set) return;
    const fresh = this.set?.element.z !== set.element.z;
    this.set = set;
    this.fp = atomFingerprint(set.element, set);
    this.cloud.setSet(set, this.model.worldPerA0);
    if (fresh) {
      // Start on the outermost orbital with a shape (the valence), else the last one.
      const shaped = set.orbitals.filter((o) => o.l > 0);
      const start = (shaped.length ? shaped[shaped.length - 1] : set.orbitals[set.orbitals.length - 1]).index;
      this.focus = this.goal = start;
      this.vel = 0;
    }
    this.focus = clamp(this.focus, 0, set.orbitals.length - 1);
    this.goal = clamp(this.goal, 0, set.orbitals.length - 1);
    this.paintHud(true);
  }

  setAtom(model: AtomModel): void { this.model = model; this.rebuild(); }
  setSettings(s: Settings): void { this.settings = s; this.rebuild(); }
  resize(ctx: LabContext): void { this.ctx = ctx; this.cloud.resize(ctx); }

  private opt(id: string, fallback: string): string { return this.settings?.options[id] ?? fallback; }
  private get hard(): boolean { return this.opt('stops', 'hard') === 'hard'; }
  private get last(): number { return Math.max(0, (this.set?.orbitals.length ?? 1) - 1); }

  // ---- gestures ----

  private down(e: PointerEvent): void {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
    this.axis = null;
    this.vel = 0;
    if (this.fingers.size === 2) {
      const [a, b] = [...this.fingers.values()];
      this.two = {
        d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), a: Math.atan2(b.y - a.y, b.x - a.x),
        cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, zoom: this.ctx.orbit?.zoom ?? 1, hue: this.hue,
      };
    }
  }

  private move(e: PointerEvent): void {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    const dx = e.clientX - f.x, dy = e.clientY - f.y;
    f.x = e.clientX;
    f.y = e.clientY;
    const orbit = this.ctx.orbit;
    if (this.fingers.size >= 2 && this.two) {
      const [a, b] = [...this.fingers.values()];
      const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      orbit?.setZoom(this.two.zoom * (d / this.two.d));
      let turn = ang - this.two.a;
      if (turn > Math.PI) turn -= 2 * Math.PI;
      if (turn < -Math.PI) turn += 2 * Math.PI;
      this.hue = this.two.hue + turn;
      const mx = cx - this.two.cx, my = cy - this.two.cy;
      this.two.cx = cx;
      this.two.cy = cy;
      if (this.opt('finger', 'nav') === 'turn') this.climb(my);
      else orbit?.rotateBy(mx, my);
      return;
    }
    if (this.opt('finger', 'nav') === 'turn') { orbit?.rotateBy(dx, dy); return; }
    // One finger navigates: lock to the first clear direction.
    if (!this.axis) {
      const tx = f.x - f.x0, ty = f.y - f.y0;
      if (Math.hypot(tx, ty) < 8) return;
      this.axis = Math.abs(ty) >= Math.abs(tx) ? 'v' : 'h';
    }
    if (this.axis === 'v') this.climb(dy);
    else this.contextGoal = clamp(this.contextGoal + dx / 240, 0, 1);
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
      if (now - this.lastTap < 320) { this.contextGoal = this.contextGoal > 0.5 ? 0 : 1; this.lastTap = 0; }
      else this.lastTap = now;
      return;
    }
    if (this.axis === 'v' && now - this.lastMove.t > 90) this.vel = 0;
    if (this.hard) this.goal = clamp(Math.round(this.focus + clamp(this.vel, -12, 12) * 0.12), 0, this.last);
    this.axis = null;
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.ctrlKey) { this.ctx.orbit?.setZoom((this.ctx.orbit.zoom) * Math.exp(-e.deltaY * 0.01)); return; }
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      this.contextGoal = clamp(this.contextGoal + (e.deltaX || e.deltaY) / 600, 0, 1);
      return;
    }
    this.focus = clamp(this.focus - e.deltaY / 140, 0, this.last);
    this.goal = this.focus;
    this.vel = 0;
    // Hard stops: settle on the nearest orbital once the wheel rests.
    window.clearTimeout(this.wheelIdle);
    if (this.hard) this.wheelIdle = window.setTimeout(() => { this.goal = Math.round(this.focus); }, 140);
  }

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
    if (e.key === 'ArrowUp') this.goal = clamp(Math.round(this.goal) + 1, 0, this.last);
    else if (e.key === 'ArrowDown') this.goal = clamp(Math.round(this.goal) - 1, 0, this.last);
    else if (e.key === 'ArrowRight') this.contextGoal = clamp(this.contextGoal + 0.25, 0, 1);
    else if (e.key === 'ArrowLeft') this.contextGoal = clamp(this.contextGoal - 0.25, 0, 1);
    else return;
    e.preventDefault();
  };

  // ---- drawing ----

  render(dt: number, time: number): void {
    const set = this.set, fp = this.fp;
    if (!set || !fp) return;
    const dragging = this.fingers.size > 0 && this.axis === 'v';
    if (!dragging) {
      if (this.hard) {
        // A soft spring onto the chosen orbital.
        const k = 1 - Math.exp(-dt * 10);
        this.focus += (this.goal - this.focus) * k;
      } else {
        // Gradual: glide on, slowing down.
        this.focus = clamp(this.focus + this.vel * dt, 0, this.last);
        this.vel *= Math.exp(-dt * 2.5);
        if (this.focus <= 0 || this.focus >= this.last) this.vel = 0;
        this.goal = this.focus;
      }
    }
    this.context += (this.contextGoal - this.context) * (1 - Math.exp(-dt * 8));

    // The view follows the focused orbital's size: close on a small inner one, out to the
    // whole atom as the context opens up.
    const i0 = Math.floor(this.focus), i1 = Math.min(this.last, i0 + 1), fr = this.focus - i0;
    const rFocus = set.orbitals[i0].r90 * (1 - fr) + set.orbitals[i1].r90 * fr;
    const reach = smooth((this.context - 0.5) * 2);
    const frame = rFocus * 1.25 * (1 - reach) + set.r90 * 1.12 * reach;
    this.ctx.orbit?.fit(frame * (this.model?.worldPerA0 ?? 1));

    const sigma = this.hard ? 0.32 : 0.85;
    const solo = clamp(this.context * 2, 0, 1); // 0 → 1 over solo → ghost
    const all = clamp((this.context - 0.5) * 2, 0, 1); // ghost → all
    const palette = this.opt('palette', 'phase');
    for (const o of set.orbitals) {
      const d = o.index - this.focus;
      const e = Math.exp(-(d * d) / (2 * sigma * sigma));
      const [pos, neg] = palette === 'print' ? fp.colors[o.index] : palette === 'block' ? BLOCK_RGB[o.block] : PHASE;
      // The rest: hidden (solo), a thin gray veil (ghost), or all of it in color.
      // Small inner orbitals always thin out (they would pile into a white core); big outer
      // ones only while they are a veil.
      const v = veilScale(o, frame);
      const restShare = (0.12 * solo + 0.88 * all) * (o.r90 < frame ? v : v * (1 - all) + all);
      const share = Math.max(e, restShare);
      this.cloud.setLook(o.index, {
        pos, neg,
        share,
        // The focus keeps its full light; the rest join at a little over half (ghost), a third
        // when all of them are in (so the whole atom doesn't flare into one white blob).
        gain: share > 0.004 ? balancedGain(o, set, frame) * (e + (1 - e) * (0.55 - 0.22 * all)) : 0,
        sat: e + (1 - e) * all,
        twinkle: 0.4 + 0.8 * e,
        breath: 0,
        glint: 0.6 * e,
        flash: 0,
      });
    }
    const u = this.cloud.material.uniforms;
    u.uTwinkle.value = Number(this.opt('twinkle', '0.35'));
    u.uAlpha.value = 0.55 * (this.settings?.brightness ?? 1);
    u.uFire.value = 0.25;
    u.uHue.value = this.hue;
    (u.uPulse.value as THREE.Vector4).set(-1, 1, 0, 0);
    this.cloud.render(this.ctx, time);
    this.paintHud(false);
  }

  /** The ladder at the right edge (inner at the bottom), the focused orbital's name, the
   *  context meter and the gesture hints. */
  private paintHud(full: boolean): void {
    const set = this.set, hud = this.hud;
    if (!set || !hud) return;
    if (full || !hud.firstChild) {
      hud.innerHTML = `<div class="lab-ex-ladder"></div>
        <div class="lab-ex-focus"><b></b><span></span></div>
        <div class="lab-ex-ctx"><i></i><span>Solo</span><span>Ghost</span><span>All</span></div>
        <p class="lab-ex-hint">↕ orbitals · ↔ context · pinch zoom · twist colors · two fingers turn · double-tap solo/all</p>`;
      const lad = hud.querySelector<HTMLElement>('.lab-ex-ladder')!;
      this.ladder = set.orbitals.map((o) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = o.label;
        b.onclick = () => { this.goal = o.index; this.vel = 0; if (!this.hard) this.focus = o.index; };
        lad.append(b);
        return b;
      });
    }
    const row = 24;
    this.ladder.forEach((b, i) => {
      const d = i - this.focus;
      const a = Math.max(0, 1 - Math.abs(d) / 7);
      b.style.transform = `translateY(${(-d * row).toFixed(1)}px) scale(${(0.82 + 0.3 * Math.exp(-d * d * 2)).toFixed(3)})`;
      b.style.opacity = a.toFixed(2);
      b.style.pointerEvents = a > 0.15 ? 'auto' : 'none';
      b.classList.toggle('on', Math.abs(d) < 0.5);
    });
    const o = set.orbitals[Math.round(this.focus)];
    const name = hud.querySelector<HTMLElement>('.lab-ex-focus b')!;
    if (name.textContent !== o.label) {
      name.textContent = o.label;
      hud.querySelector<HTMLElement>('.lab-ex-focus span')!.textContent =
        `n ${o.n} · l ${o.l} · ${o.electrons} electron${o.electrons === 1 ? '' : 's'} · ${Math.round(this.focus) + 1} of ${set.orbitals.length}`;
    }
    hud.querySelector<HTMLElement>('.lab-ex-ctx i')!.style.left = `${(this.context * 100).toFixed(1)}%`;
  }

  stats(): string {
    return `${Math.round(this.cloud.drawn / 1000)}k of ${Math.round((this.set?.total ?? 0) / 1000)}k pts · ${this.set?.orbitals.length ?? 0} orbitals · ${this.cloud.size}`;
  }

  dispose(): void {
    const c = this.ctx.canvas;
    for (const [type, fn, o] of this.listeners) c?.removeEventListener(type, fn, o);
    window.removeEventListener('keydown', this.onKey);
    window.clearTimeout(this.wheelIdle);
    if (this.ctx.orbit) this.ctx.orbit.input = true;
    this.hud?.remove();
    this.cloud.dispose();
  }
}
