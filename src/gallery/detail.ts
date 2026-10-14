// The app's 3D atom, on the Build page and in View. One canvas, one WebGL context.
//
// Build ('build'): settings fixed; a tap sets the whole atom twinkling, fast, for a moment.
// Nothing is drawn until the nucleus is built (the page shows "Nucleus not built" instead and
// no frame runs); then the nucleus as opaque balls in inferno colors (nucleus.ts); once the
// electrons are built, the whole atom as its Atom fingerprint (render/spotlight.ts): each
// orbital its own twinkling cloud, lit one at a time from the largest in to the smallest and
// then the largest again, easing between them and resting on each, its name under the atom,
// the rest tinted. The camera keeps the whole atom in view, with the size circles turning
// slowly like the rings of a gyroscope. The canvas reaches below its stage, under the page,
// and fades out there, so the atom is not cut off at the bottom.
//
// View ('view'): the Orbital explorer (render/explorer.ts). Swipe up and down to glide through
// the orbitals (on release it settles on one), sideways for more or less focus (solo, ghost,
// all), pinch to zoom, twist to turn the colors, two fingers to turn it, double-tap for solo or
// all. Auto-play steps along the ladder, easing from one orbital to the next and resting on
// each, and eases the focus to ghost, until a touch, and again after five quiet seconds. The
// scale circles and the dive to the nucleus (a hundred thousand times closer, at the true ratio
// of sizes) stay.
//
// Both hold a steady 60 fps where they can: a quality governor (render/governor.ts) draws a
// coarser layer and fewer points while frames are missed, and steps back up with care. Heavy
// atoms are sampled a slice per frame, so changing atoms never stalls the page.

import * as THREE from 'three';
import { fillOrder, type AtomLit } from './atom';
import { CLOUD_RINGS, type Element } from './data';
import { token } from './tokens';
import { NUCLEUS_RINGS, NucleusView, nucleusExtent } from './nucleus';
import { atomFingerprint } from '../render/fingerprint';
import { worldPerA0 } from '../render/model';
import { OrbitalCloud, orbitalSetBuilder, type OrbitalSet, type OrbitalSetBuilder } from '../render/orbitalCloud';
import { ExplorerHud, OrbitalExplorer, type ExplorerCamera } from '../render/explorer';
import { Nebula, type NebulaOptions } from '../render/nebula';
import { QualityGovernor } from '../render/governor';
import { RayLooks, type ViewLook } from '../render/rayLooks';

export type DetailVariant = 'view' | 'build';

/** The dive's readout: the width of the view, and a scale bar of a round length under it. */
export interface DiveScale { across: string; barPx: number; barLabel: string }

export interface DetailOptions {
  variant: DetailVariant;
  /** View: the layer the explorer's ladder, orbital name and context control go in. */
  hud?: HTMLElement;
  /** Build: shown in place of the atom while the nucleus is not built. */
  empty?: HTMLElement;
  /** Build: a list for the size circles' legend (filled here), shown with the electrons. */
  legend?: HTMLElement;
}

/** Scene units are 100 pm, as everywhere in the app; a femtometre is 1e-5 of one. */
const UNITS_PER_FM = 1e-5;
/** View frames every nucleus on the same 9.9 fm, so its 8 fm circle sits where the atom's
 *  300 pm one does (the atom view fits 370 pm). */
const NUCLEUS_VIEW_FM = 9.9;
const DIVE_S = 2.6;
/** The base set: every orbital a modest share, enough for ghosts and the whole atom. The orbital
 *  in focus (or lit) gets a dense set of its own on top: View 400k points. Build shows the whole
 *  atom rather than one orbital, so its budget leans the other way: a bigger base set, most of
 *  it drawn for every orbital, and only 80k extra for the lit one. */
const BASE_POINTS = { per: 30_000, budget: 600_000 };
const BUILD_POINTS = { per: 45_000, budget: 900_000 };
const DENSE_VIEW = 400_000;
const DENSE_BUILD = 80_000;
/** Sampling work per frame while an atom's points come in: 5 ms at 60 fps, more where frames
 *  are slow anyway (a quarter of the frame, up to 30 ms), so a slow device still fills in. */
const sampleSlice = (frameMs: number) => Math.max(5, Math.min(30, frameMs * 0.25));
/** Auto-play: seconds on each orbital, the focus it eases to (ghost), and the quiet after a
 *  touch before it resumes. */
const PLAY_DWELL_S = 3.6;
const PLAY_CONTEXT = 0.5;
const PLAY_RESUME_MS = 5000;
/** Build: each size circle turns once in 4 s (the smallest) to 8 s (the largest), about its
 *  own axis, a touch fainter than in View. */
const GYRO_S = [4, 8];
const BUILD_RING_FADE = 0.94;

/** The Build page's look: the nebula (render/nebula.ts), as the Collect gem draws it, the
 *  light walking the orbitals built so far. */
const BUILD_LOOK: NebulaOptions = { sat: 1, bright: 1.1, halo: 0.4, walk: true };
/** View's particles: the same mist and point size, a lighter halo. */
const VIEW_HALO = 0.3;
/** Build's point layer: this share of the screen's resolution at most (see applyQuality). */
const NEBULA_PIXEL = 0.5;
const BUILD_ROOM = 1.12;

/** An orbit camera that frames a radius, easing in powers of ten (so a dive of five decades
 *  glides evenly), with the explorer's pinch and turn. */
class Rig implements ExplorerCamera {
  theta = 0.7;
  phi = 1.25;
  zoom = 1;
  autoRotate = true;
  private idleAt = -1e9;
  private target = 1;
  private logR = 0;
  private fresh = true;

  constructor(private camera: THREE.PerspectiveCamera, private el: HTMLElement) {}

  /** Frame a sphere of this radius (scene units), easing there. */
  fit(r: number): void { this.target = Math.max(1e-9, r); }
  /** Jump to the framed radius on the next update. */
  snap(): void { this.fresh = true; }
  /** Set the framed radius now (the dive drives it directly). */
  setRadius(r: number): void { this.target = r; this.logR = Math.log(r); this.fresh = false; }
  get radius(): number { return Math.exp(this.logR); }

  /** Pinch limits; below `min` (at the nucleus: past its widest) `onBelow` runs instead. */
  minZoom = 0.35;
  maxZoom = 10;
  onBelow: (() => void) | null = null;

  setZoom(z: number): void {
    if (z < this.minZoom && this.onBelow) { this.onBelow(); return; }
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, z));
    this.idleAt = performance.now();
  }

  rotateBy(dx: number, dy: number): void {
    const s = 5 / Math.max(300, Math.min(this.el.clientWidth, this.el.clientHeight));
    this.theta -= dx * s;
    this.phi = Math.max(0.05, Math.min(Math.PI - 0.05, this.phi - dy * s));
    this.idleAt = performance.now();
  }

  /** Half the shorter side of the view, in scene units. */
  get halfView(): number {
    const vfov = (this.camera.fov * Math.PI) / 360;
    return (this.radius / this.zoom) / Math.cos(vfov);
  }

  update(dt: number, turning: boolean, spin: number): void {
    const want = Math.log(this.target);
    if (this.fresh) { this.logR = want; this.fresh = false; }
    else this.logR += (want - this.logR) * (1 - Math.exp(-dt * 5));
    if (this.autoRotate && !turning && performance.now() - this.idleAt > 1200) this.theta += dt * spin;
    const c = this.camera;
    const vfov = (c.fov * Math.PI) / 360;
    const half = Math.min(vfov, Math.atan(Math.tan(vfov) * c.aspect));
    const dist = this.radius / Math.sin(half) / this.zoom;
    const sp = Math.sin(this.phi);
    c.position.set(dist * sp * Math.sin(this.theta), dist * Math.cos(this.phi), dist * sp * Math.cos(this.theta));
    c.near = dist * 0.01;
    c.far = dist * 12 + this.radius * 4;
    c.lookAt(0, 0, 0);
    c.updateProjectionMatrix();
  }
}

export class Detail {
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
  private rig: Rig;
  private variant: DetailVariant;
  private cloud: OrbitalCloud;
  private nucleus: NucleusView;
  private builder: OrbitalSetBuilder | null = null;
  private set: OrbitalSet | null = null;
  private wpa0 = 1;
  private explorer: OrbitalExplorer | null = null;
  private hud: ExplorerHud | null = null;
  private hudEl: HTMLElement | null;
  private nebula = new Nebula();
  private governor = new QualityGovernor();
  private ringScene = new THREE.Scene();
  private atomRings = new THREE.Group();
  private nucleusRings = new THREE.Group();
  /** Scale circles a power of ten apart, shown only during a dive (no legend): each grows out of
   *  the middle and off the edge in turn, so the hundred-thousandfold zoom reads as steady steps. */
  private diveRings: { line: THREE.Line; r: number; base: number }[] = [];
  private diveRingGroup = new THREE.Group();
  private ringsOn = true;
  private element: Element | null = null;
  private lit: AtomLit = { nucleus: true, electrons: Infinity };
  /** How lit each orbital is (0 to 1), easing toward its target. */
  private litNow = new Float32Array(64);
  private litTo = new Float32Array(64);
  private empty: HTMLElement | null;
  private legend: HTMLElement | null;
  /** Build: the lit orbital's name, and the size circles' turns. */
  private orbitalEl: HTMLParagraphElement | null = null;
  private shownOrbital = -1;
  private gyro: { line: THREE.Line; r: number; period: number; axis: THREE.Vector3; base: number }[] = [];
  /** Build: how far the canvas reaches below its stage (CSS px), and the fit's correction for it. */
  private bleed = 0;
  private fitScale = 1;
  private nucleusOn = false;
  /** Where the dive stands: 0 the whole atom, 1 the nucleus; the dive's progress (1 = done). */
  private dive = 0;
  private diveFrom = 0;
  private diveT = 1;
  /** The atom's framed radius when the dive began (scene units). */
  private diveAtomR = 1;
  private atomR = 1;
  private width = 1;
  private height = 1;
  private raf = 0;
  private last = 0;
  private time = 0;
  private wanted = false;
  private running = false;
  private reducedMotion = false;
  private userPaused = false;
  private heldUntil = 0;
  private shownPlaying: boolean | null = null;
  private nextStepAt = 0;
  private playDir = 1;
  private fpsFrames = 0;
  private fpsStart = 0;
  /** During a dive, the true width of the view ("74 pm across") and a scale bar under it: a
   *  power of ten that fits, its length on screen (CSS px) and its label; null when it ends. */
  onDive: ((dive: DiveScale | null) => void) | null = null;
  /** A pinch out at the nucleus went past its widest: back to the whole atom (the caller
   *  flips its Nucleus chip and calls setNucleus(false, true)). */
  onLeaveNucleus: (() => void) | null = null;
  /** Auto-play started or stopped (a touch holds it; five quiet seconds resume it). */
  onPlay: ((playing: boolean) => void) | null = null;
  /** Frames per second, about twice a second while drawing. */
  onFps: ((fps: number) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, opts: DetailOptions = { variant: 'view' }) {
    this.variant = opts.variant;
    this.hudEl = opts.hud ?? null;
    this.empty = opts.empty ?? null;
    this.legend = opts.legend ?? null;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.variant === 'view', alpha: false, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const halfFloat = this.renderer.extensions.has('EXT_color_buffer_float') || this.renderer.extensions.has('EXT_color_buffer_half_float');
    this.cloud = new OrbitalCloud({ halfFloat, halo: true });
    this.cloud.background = null;
    this.nucleus = new NucleusView();
    this.rig = new Rig(this.camera, canvas);
    if (this.variant === 'view') {
      const ex = new OrbitalExplorer(this.rig);
      ex.opts = { hard: true, finger: 'nav', palette: 'mono', twinkle: 0, brightness: 1.3 };
      ex.onInteract = () => this.touched();
      ex.attach(canvas);
      canvas.style.touchAction = 'none';
      this.explorer = ex;
      if (this.hudEl) this.hud = new ExplorerHud(this.hudEl, ex, { prefix: 'ax', row: 26, reach: 4.5 });
      for (const r of NUCLEUS_RINGS) this.nucleusRings.add(ring(r.fm * UNITS_PER_FM, r.style));
      for (const d of DIVE_RING_PM) {
        const line = ring(1, d.style);
        this.diveRingGroup.add(line);
        // Mid-dive the circles are the only sense of scale: drawn stronger than the fixed ones.
        this.diveRings.push({ line, r: d.pm / 100, base: d.style === 'solid' ? 0.85 : 0.75 });
      }
      this.ringScene.add(this.nucleusRings, this.diveRingGroup);
    }
    // The size circles round the whole atom, in View and (with their legend) in Build.
    for (const r of CLOUD_RINGS) this.atomRings.add(ring(r.pm / 100, r.style));
    this.ringScene.add(this.atomRings);
    if (this.legend) {
      const line = (style: string) => `<svg width="16" height="4" aria-hidden="true"><line x1="1" y1="2" x2="15" y2="2" stroke="currentColor" stroke-width="1.5"${style === 'dashed' ? ' stroke-dasharray="3 2.5"' : ''}/></svg>`;
      this.legend.innerHTML = CLOUD_RINGS.map((r) => `<li>${line(r.style)}<span>${r.pm * 2} pm</span></li>`).join('');
    }
    if (this.variant === 'build') {
      this.bindTap(canvas);
      // The orbital the light rests on, named at the bottom of the stage.
      this.orbitalEl = document.createElement('p');
      this.orbitalEl.className = 'atom-orbital';
      this.orbitalEl.setAttribute('aria-hidden', 'true');
      canvas.parentElement?.append(this.orbitalEl);
      this.atomRings.children.forEach((ln, i, all) => {
        const k = all.length > 1 ? i / (all.length - 1) : 0;
        // Each turns about its own axis in the picture's plane, a quarter turn apart in step.
        const line = ln as THREE.Line;
        this.gyro.push({ line, r: CLOUD_RINGS[i].pm / 100, period: GYRO_S[0] + (GYRO_S[1] - GYRO_S[0]) * k, axis: new THREE.Vector3(Math.cos(i * 1.9), Math.sin(i * 1.9), 0), base: (line.material as THREE.LineBasicMaterial).opacity * BUILD_RING_FADE });
      });
    }
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  // ---- what to show -------------------------------------------------------------------------

  show(e: Element, _animate = false): void {
    const fresh = this.element?.z !== e.z;
    this.element = e;
    this.wpa0 = worldPerA0(e);
    if (this.nucleusOn || this.variant === 'build') this.nucleus.show(e);
    if (fresh) {
      const pts = this.variant === 'build' ? BUILD_POINTS : BASE_POINTS;
      this.builder = orbitalSetBuilder(e, pts.per, pts.budget);
      this.rig.zoom = 1;
      this.computeLitTargets();
      this.litNow.set(this.litTo);
      this.playDir = 1;
      this.nextStepAt = performance.now() + PLAY_DWELL_S * 1000;
    }
    this.paintMode();
  }

  /** How much of the atom is built: the nucleus, and how many electrons (in the order they
   *  fill). Build shows only what is built; View shows all of it, unbuilt electrons gray. */
  setLit(lit: AtomLit, animate = false): void {
    this.lit = { ...lit };
    this.nucleus.setVivid(lit.nucleus, animate && !this.reducedMotion);
    this.computeLitTargets();
    if (!animate || this.reducedMotion) this.litNow.set(this.litTo);
    this.paintMode();
  }

  /** Kept for callers of the old API: the whole atom lit, or none of it. */
  setCollected(collected: boolean): void {
    this.setLit({ nucleus: collected, electrons: collected ? Infinity : 0 });
  }

  /** Each orbital's lit target: the share of its subshell's electrons built, in Aufbau order. */
  private computeLitTargets(): void {
    const set = this.set, e = this.element;
    this.litTo.fill(0);
    if (!set || !e) return;
    const share = new Map<string, number>();
    let before = 0;
    for (const k of fillOrder(e)) {
      const sub = e.subshells.find((x) => x.key === k)!;
      share.set(k, Math.max(0, Math.min(1, (this.lit.electrons - before) / sub.count)));
      before += sub.count;
    }
    for (const o of set.orbitals) this.litTo[o.index] = share.get(o.key) ?? 0;
  }

  /** Build: what is drawn follows what is built. */
  private get buildMode(): 'empty' | 'nucleus' | 'cloud' {
    if (this.lit.electrons > 0) return 'cloud';
    return this.lit.nucleus ? 'nucleus' : 'empty';
  }

  private paintMode(): void {
    if (this.variant === 'build') {
      const mode = this.buildMode;
      if (this.empty) this.empty.hidden = mode !== 'empty';
      if (this.legend) this.legend.hidden = mode !== 'cloud';
      if (this.orbitalEl) this.orbitalEl.hidden = mode !== 'cloud';
      this.canvas.style.visibility = mode === 'empty' ? 'hidden' : '';
      if (mode === 'nucleus' && this.element) this.nucleus.show(this.element);
    }
    this.syncLoop();
  }

  setReducedMotion(on: boolean): void {
    // Calm: no auto-play unless asked for (and back on when the setting goes off).
    if (on !== this.reducedMotion) this.userPaused = on;
    this.reducedMotion = on;
    this.nucleus.jiggle = on ? 0 : 0.05;
    this.rig.autoRotate = !on;
    if (this.explorer) this.explorer.opts.twinkle = on ? 0 : 0.25;
    this.paintPlay();
  }

  /** Show or hide the reference circles drawn round the atom. */
  setRings(on: boolean): void {
    this.ringsOn = on;
  }

  /** View's render style: the particle cloud, or one of the ray-marched styles
   *  (render/rayLooks.ts), made on first use. */
  setLook(look: ViewLook): void {
    this.look = look;
    if (look === 'particles' || this.variant !== 'view') return;
    const r = this.renderer;
    this.rays ??= new RayLooks(r.extensions.has('EXT_color_buffer_float') || r.extensions.has('EXT_color_buffer_half_float'));
    this.rays.look = look;
  }
  private look: ViewLook = 'particles';
  private rays: RayLooks | null = null;

  /** The ray styles frame what they draw (the whole atom by its own 80% region). */
  private rayFrame(frameA0: number): number {
    const ex = this.explorer;
    if (this.look === 'particles' || !this.rays || !this.set || !ex?.fp) return frameA0;
    this.rays.setSet(this.set, ex.fp);
    return this.rays.frame(ex, frameA0);
  }

  /** Swap the whole atom for its nucleus up close, or back. With `animate`, dive there at the
   *  true ratio of sizes; otherwise cut straight to it. */
  setNucleus(on: boolean, animate = false): void {
    this.nucleusOn = on;
    if (this.explorer) this.explorer.turnOnly = on;
    this.hudEl?.classList.toggle('is-nucleus', on);
    // At the nucleus a pinch reaches in to 30% of its framed size, and a pinch out past its
    // widest goes back to the whole atom.
    this.rig.maxZoom = on ? 1 / 0.3 : 10;
    this.rig.minZoom = on ? 0.7 : 0.35;
    this.rig.onBelow = on ? () => { if (this.diveT >= 1) this.onLeaveNucleus?.(); } : null;
    if (on && this.element) this.nucleus.show(this.element);
    this.rig.zoom = 1;
    if (animate && !this.reducedMotion) {
      this.diveFrom = this.dive;
      this.diveT = 0;
      this.diveAtomR = this.atomR;
    } else {
      this.dive = on ? 1 : 0;
      this.diveT = 1;
      this.rig.snap();
      this.onDive?.(null);
    }
  }

  // ---- auto-play (View) -----------------------------------------------------------------------

  /** Auto-play is on: not paused by the player, and no touch in the last five seconds. */
  get playing(): boolean {
    return !this.userPaused && performance.now() >= this.heldUntil;
  }

  /** The Play/Pause button: pausing stays paused; playing starts at once. */
  setPlaying(on: boolean): void {
    this.userPaused = !on;
    this.heldUntil = 0;
    if (on) this.nextStepAt = performance.now() + 600;
    this.paintPlay();
  }

  /** A touch, wheel or key on the atom holds auto-play for a while. */
  private touched(): void {
    this.heldUntil = performance.now() + PLAY_RESUME_MS;
    this.paintPlay();
  }

  private paintPlay(): void {
    const p = this.playing;
    if (p === this.shownPlaying) return;
    this.shownPlaying = p;
    this.onPlay?.(p);
  }

  /** Auto-play: a step to the next orbital every few seconds (back and forth along the
   *  ladder, eased onto each), and the focus easing toward ghost. */
  private autoplay(now: number, dt: number): void {
    const ex = this.explorer;
    this.paintPlay();
    if (!ex || !ex.set || this.nucleusOn || !this.playing || ex.touching) {
      this.nextStepAt = Math.max(this.nextStepAt, now + 1200);
      return;
    }
    ex.contextGoal += (PLAY_CONTEXT - ex.contextGoal) * (1 - Math.exp(-dt * 0.6));
    if (now < this.nextStepAt) return;
    this.nextStepAt = now + PLAY_DWELL_S * 1000;
    if (ex.last < 1) return;
    let next = Math.round(ex.goal) + this.playDir;
    if (next > ex.last || next < 0) { this.playDir = -this.playDir; next = Math.round(ex.goal) + this.playDir; }
    ex.goTo(next, true);
  }

  /** Arrow keys up and down walk the ladder (View); true when used. */
  key(ev: KeyboardEvent): boolean {
    return this.explorer?.key(ev, false) ?? false;
  }

  // ---- the loop --------------------------------------------------------------------------------

  start(): void {
    this.wanted = true;
    this.syncLoop();
  }

  stop(): void {
    this.wanted = false;
    this.syncLoop();
  }

  private syncLoop(): void {
    const on = this.wanted && !(this.variant === 'build' && this.buildMode === 'empty');
    if (on === this.running) return;
    this.running = on;
    if (on) {
      this.last = performance.now();
      this.fpsStart = this.last;
      this.fpsFrames = 0;
      this.governor.reset(this.last);
      this.raf = requestAnimationFrame((t) => this.frame(t));
    } else cancelAnimationFrame(this.raf);
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.setSize(r.width, r.height, false);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.width = size.x;
    this.height = size.y;
    this.camera.aspect = size.x / size.y;
    this.camera.clearViewOffset();
    this.fitScale = 1;
    const stage = this.variant === 'build' ? this.canvas.parentElement : null;
    this.bleed = stage ? Math.max(0, r.height - stage.clientHeight) : 0;
    if (this.bleed > 0) {
      // The canvas runs `bleed` below the stage: draw it as the top of a view `bleed` taller
      // still, so the atom stays centered on the stage, and frame the atom as the stage alone
      // would have.
      const k = size.y / r.height;
      const H = r.height - this.bleed;
      const fullH = (H + 2 * this.bleed) * k;
      this.camera.aspect = size.x / fullH;
      this.camera.setViewOffset(size.x, fullH, 0, this.bleed * k, size.x, size.y);
      this.fitScale = Math.min(r.width, H + 2 * this.bleed) / Math.min(r.width, H);
    }
    this.camera.updateProjectionMatrix();
    this.cloud.resize({ width: size.x, height: size.y });
  }

  /** Take on the governor's level: the point layer's resolution and the share of points. The
   *  layer never drops below 0.6 of a CSS pixel, however few device pixels there are. Build's
   *  nebula is drawn at half resolution at best, as the Collect gem is: its points melt into
   *  mist there, where a full-resolution layer shows them as grain. */
  private applyQuality(): void {
    const q = this.governor.spec;
    const pr = this.renderer.getPixelRatio();
    const pixel = Math.min(this.variant === 'build' ? NEBULA_PIXEL : 1, Math.max(q.pixel, 0.6 / pr));
    this.cloud.pixelScale = pixel;
    this.cloud.density = q.density;
    this.cloud.denseShare = q.dense;
  }

  /** Hold the quality at one level (0 best), or let the governor choose again (null). For
   *  screenshots and tuning from the console. */
  pinQuality(level: number | null): void {
    this.pinned = level;
    if (level != null) this.governor.level = level;
    this.applyQuality();
  }
  private pinned: number | null = null;
  /** The base set is still coming in (dense sets wait for it), and this frame's sampling time. */
  private sampling = false;
  private slice = 5;

  /** Take what sampling has made so far: a new atom's set appears once its pilots are done
   *  and thickens as the rest comes in. */
  private takeSet(frameMs: number): void {
    const b = this.builder;
    if (!b) return;
    if (!b.done) b.step(sampleSlice(frameMs));
    if (b.set && b.set !== this.set) {
      const set = b.set;
      this.set = set;
      const fp = atomFingerprint(set.element, set);
      this.cloud.setSet(set, this.wpa0);
      const fresh = this.nebula.set?.element.z !== set.element.z;
      this.nebula.setSet(set);
      // Build: a new atom comes up in its own first pose.
      if (fresh && this.variant === 'build') this.rig.theta = this.nebula.theta0;
      this.explorer?.setSet(set, fp);
      this.explorer?.setMono(this.nebula.restColors, this.nebula.litColors);
      this.computeLitTargets();
      this.litNow.set(this.litTo);
      this.rig.snap();
    }
  }

  private frame(now: number): void {
    if (!this.running) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dtMs = now - this.last;
    const dt = Math.min(0.1, dtMs / 1000);
    this.last = now;
    this.time += dt;
    const sampling = Boolean(this.builder && !this.builder.done);
    this.sampling = sampling;
    this.slice = sampleSlice(dtMs);
    const mode = this.variant === 'build' ? this.buildMode : 'cloud';
    // Build samples the electrons while it shows the nucleus too, so they are ready to light up.
    this.takeSet(dtMs);
    // Sampling costs its slice on purpose: judge the frames only once it is done.
    if (sampling || this.pinned != null) this.governor.reset(now);
    else if (this.governor.frame(dtMs, now)) this.applyQuality();
    this.fps(now);
    if (this.width < 2) return;

    // Ease each orbital's color toward what is built.
    const k = dt / (this.reducedMotion ? 0.2 : 0.45);
    for (let i = 0; i < this.litNow.length; i++) {
      const a = this.litNow[i], b = this.litTo[i];
      this.litNow[i] = a < b ? Math.min(b, a + k) : Math.max(b, a - k);
    }

    const r = this.renderer;
    r.setRenderTarget(null);
    r.setClearColor(BG(), 1);
    r.clear();
    if (this.variant === 'build') this.frameBuild(mode, dt);
    else this.frameView(now, dt);
  }

  /** Build: a tap on the atom (not a scroll of the page over it) moves the light on to the
   *  next orbital. */
  private bindTap(canvas: HTMLCanvasElement): void {
    let down: { x: number; y: number; t: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    canvas.addEventListener('pointercancel', () => { down = null; });
    canvas.addEventListener('pointerup', (e) => {
      const d = down;
      down = null;
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10 && performance.now() - d.t < 400) this.nebula.advance();
    });
  }
  private frameBuild(mode: 'empty' | 'nucleus' | 'cloud', dt: number): void {
    const r = this.renderer;
    if (mode === 'nucleus' && this.element) {
      this.rig.fit(nucleusExtent(this.element) * 1.2 * UNITS_PER_FM * this.fitScale);
      this.rig.update(dt, false, 0.22);
      this.nucleus.group.scale.setScalar(UNITS_PER_FM);
      this.nucleus.intensity = 1;
      this.nucleus.render(r, this.camera, this.time, dt);
      return;
    }
    if (!this.set) return;
    // Reduced motion: the light stays where it is (a tap still moves it on).
    const o: NebulaOptions = this.reducedMotion ? { ...BUILD_LOOK, walk: false } : BUILD_LOOK;
    const nb = this.nebula;
    nb.step(this.cloud, dt, this.time, o, DENSE_BUILD, this.litNow);
    if (!this.sampling) this.cloud.sampleDense(this.slice);
    // A little more room than the gem gives, so a lit outer lobe clears the page's header.
    this.rig.fit(nb.frameA0 * BUILD_ROOM * this.wpa0 * this.fitScale);
    this.rig.update(dt, false, nb.spinSpeed * nb.spinDir);
    this.cloud.renderLayer(this.ctx, this.time);
    this.cloud.draw(r);
    this.paintGyro();
    r.render(this.ringScene, this.camera);
    this.paintOrbital();
  }

  /** Build: the size circles face the camera, each turning about its own axis in the picture's
   *  plane like the rings of a gyroscope. One that would run well off the sides fades away. */
  private paintGyro(): void {
    this.ringScene.quaternion.copy(this.camera.quaternion);
    // Half the canvas's width at the atom, in scene units.
    const c = this.camera;
    const halfW = c.position.length() * Math.tan((c.fov * Math.PI) / 360) * c.aspect;
    const still = this.reducedMotion;
    for (const g of this.gyro) {
      const r = g.r;
      g.line.quaternion.setFromAxisAngle(g.axis, still ? 0 : (this.time / g.period) * Math.PI * 2);
      const a = 1 - step(1.02, 1.12, r / halfW);
      g.line.visible = a > 0.01;
      (g.line.material as THREE.LineBasicMaterial).opacity = g.base * a;
    }
    // The legend lists only the circles on show.
    this.legend?.querySelectorAll('li').forEach((li, i) => { const on = this.gyro[i]?.line.visible ?? true; if (li.hidden === on) li.hidden = !on; });
  }

  /** Build: the name of the orbital the light rests on, under the atom. */
  private paintOrbital(): void {
    const el = this.orbitalEl, set = this.set;
    const i = this.nebula.litOrbital;
    if (!el || !set || i === null || i === this.shownOrbital) return;
    this.shownOrbital = i;
    el.textContent = set.orbitals[i]?.label ?? '';
  }

  private get ctx() {
    return { renderer: this.renderer, camera: this.camera, width: this.width, height: this.height };
  }

  private frameView(now: number, dt: number): void {
    const r = this.renderer;
    const ex = this.explorer!;
    this.autoplay(now, dt);
    const frameA0 = this.rayFrame(ex.update(dt));
    this.atomR = frameA0 * this.wpa0;
    const nucleusR = NUCLEUS_VIEW_FM * UNITS_PER_FM;
    // The dive: from the atom's frame to the nucleus's, evenly in powers of ten.
    if (this.diveT < 1) {
      this.diveT = Math.min(1, this.diveT + dt / DIVE_S);
      const to = this.nucleusOn ? 1 : 0;
      this.dive = this.diveFrom + (to - this.diveFrom) * this.diveT;
      const s = smooth(this.dive);
      const from = this.nucleusOn ? this.diveAtomR : this.atomR;
      this.rig.setRadius(Math.exp(Math.log(from) * (1 - s) + Math.log(nucleusR) * s));
      this.onDive?.(this.diveT < 1 ? this.diveScale() : null);
    } else this.rig.fit(this.nucleusOn ? nucleusR : this.atomR);
    this.rig.update(dt, ex.turning, 0.22);
    const R = this.rig.radius;

    // The cloud fades as the camera passes into it (ten times closer and it is gone); the
    // nucleus grows out of a point and lights up over the last decade and a half.
    const cloudFade = Math.max(0, Math.min(1, 1 - Math.log10(Math.max(1, this.atomR / R)) / 1.1));
    const nucleusLight = Math.max(0, Math.min(1, 1 - Math.log10(Math.max(1, R / nucleusR)) / 1.5));
    if (this.set && cloudFade > 0 && this.rays && this.look !== 'particles' && ex.fp) {
      // A ray style instead of the points (unbuilt parts are not grayed): fades as they would.
      this.rays.hue = ex.hue;
      this.rays.opacity = cloudFade;
      this.rays.quality(this.governor.spec, r.getPixelRatio());
      this.rays.renderLayer(this.ctx, ex, this.time);
      this.rays.draw(r);
    } else if (this.set && cloudFade > 0) {
      ex.applyLooks(this.cloud, frameA0, this.litNow);
      this.nebula.dress(this.cloud, VIEW_HALO);
      this.cloud.wantDense(this.nucleusOn ? [] : ex.denseWants, DENSE_VIEW);
      if (ex.settled && !this.sampling && this.diveT >= 1) this.cloud.sampleDense(this.slice);
      this.cloud.material.uniforms.uAlpha.value *= cloudFade;
      this.cloud.renderLayer(this.ctx, this.time);
      this.cloud.draw(r);
    }
    // The circles go under the nucleus: its balls are opaque and cover what is behind them.
    this.paintRings(R);
    r.render(this.ringScene, this.camera);
    if (nucleusLight > 0 && this.element) {
      this.nucleus.show(this.element);
      this.nucleus.group.scale.setScalar(UNITS_PER_FM);
      this.nucleus.intensity = nucleusLight;
      this.nucleus.render(r, this.camera, this.time, dt);
    }
    this.hud?.paint();
  }

  /** The readout for the view's true width, and the largest power of ten that fits in about
   *  half of it as a bar: it shrinks as the camera closes in, then jumps to the next decade
   *  down, so the steps of ten read as they go by. */
  private diveScale(): DiveScale {
    const units = this.rig.halfView * 2;
    const pm = units * 100;
    const L = 10 ** Math.floor(Math.log10(pm * 0.55));
    const px = Math.min(this.canvas.clientWidth, this.canvas.clientHeight) * (L / pm);
    const label = L >= 1 ? `${L.toLocaleString('en-US')} pm` : `${(L * 1000).toLocaleString('en-US', { maximumFractionDigits: 3 })} fm`;
    return { across: across(units), barPx: px, barLabel: label };
  }

  /** The fixed circles face the camera; mid-dive they give way to the dive's own. */
  private paintRings(R: number): void {
    this.ringScene.quaternion.copy(this.camera.quaternion);
    const diving = this.diveT < 1;
    this.atomRings.visible = this.ringsOn && !this.nucleusOn && !diving && R > 0.1;
    this.nucleusRings.visible = this.ringsOn && this.nucleusOn && !diving;
    const on = diving ? Math.min(1, this.diveT / 0.12, (1 - this.diveT) / 0.12) : 0;
    this.diveRingGroup.visible = on > 0;
    if (!on) return;
    const half = this.rig.halfView;
    for (const d of this.diveRings) {
      const u = d.r / half;
      d.line.scale.setScalar(d.r);
      const a = on * step(0.04, 0.16, u) * (1 - step(0.75, 1.25, u));
      d.line.visible = a > 0.01;
      (d.line.material as THREE.LineBasicMaterial).opacity = d.base * a;
    }
  }

  private fps(now: number): void {
    this.fpsFrames++;
    const span = now - this.fpsStart;
    if (span < 500) return;
    this.onFps?.((this.fpsFrames * 1000) / span);
    this.fpsFrames = 0;
    this.fpsStart = now;
  }

  /** For checks and tuning from the console. */
  get stats(): { level: number; fps: number; points: number; layer: string; sampling: boolean } {
    return { level: this.governor.level, fps: 1000 / this.governor.ema, points: this.set ? this.cloud.drawn : 0, layer: this.cloud.size, sampling: Boolean(this.builder && !this.builder.done) };
  }
}

const BG = (() => {
  let c: THREE.Color | null = null;
  return () => (c ??= new THREE.Color(token('--c-bg', '#000000')));
})();

function ring(r: number, style: 'solid' | 'dashed'): THREE.Line {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 160; i++) {
    const a = (i / 160) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
  }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const m = style === 'solid'
    ? new THREE.LineBasicMaterial({ color: token('--c-text', '#e4e8ea'), transparent: true, opacity: 0.4, depthTest: false })
    : new THREE.LineDashedMaterial({ color: token('--c-text', '#e4e8ea'), transparent: true, opacity: 0.45, dashSize: r * 0.09, gapSize: r * 0.06, depthTest: false });
  const line = new THREE.Line(g, m);
  line.frustumCulled = false;
  if (style === 'dashed') line.computeLineDistances();
  return line;
}

/** The true width of the view (scene units across), in pm or fm. */
function across(units: number): string {
  const pm = units * 100;
  const fmt = (v: number) => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v >= 10 ? v.toFixed(0) : v.toFixed(1));
  return pm >= 1 ? `${fmt(pm)} pm across` : `${fmt(pm * 1000)} fm across`;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const step = (a: number, b: number, x: number) => smooth(clamp((x - a) / (b - a), 0, 1));
/** The dive's circles, by radius: every power of ten from 1 nm down to 1 fm, solid, with a dashed
 *  one at three times each between, so about one new circle appears per half step of ten. */
const DIVE_RING_PM: { pm: number; style: 'solid' | 'dashed' }[] = [];
for (let e = 3; e >= -3; e--) {
  DIVE_RING_PM.push({ pm: 10 ** e, style: 'solid' });
  if (e > -3) DIVE_RING_PM.push({ pm: 3 * 10 ** (e - 1), style: 'dashed' });
}
