// The atom visualization lab (lab.html): one full-screen WebGL canvas, many experimental ways
// to draw an atom's orbitals, a control panel and an always-on FPS readout, so looks and their
// cost can be compared side by side on a phone and on a desktop. The winners move into the
// app's atom view later; nothing here changes the app.

import '@fontsource-variable/outfit';
import '../ui/tokens.css';
import './lab.css';
import * as THREE from 'three';
import { elementAt } from '../gallery/data';
import { EXPERIMENTS } from './experiments';
import { Fps } from './fps';
import { buildModel, orbitalChoices, type AtomModel } from './model';
import { Orbit } from './orbit';
import { Panel } from './panel';
import { loadState, saveState, type LabState } from './state';
import type { Experiment, LabContext, Settings } from './types';

const canvas = document.getElementById('lab-canvas') as HTMLCanvasElement;
const ui = document.getElementById('lab-ui')!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
renderer.autoClear = false;
const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
const orbit = new Orbit(canvas, camera);
const halfFloat = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');

const ctx: LabContext = { renderer, camera, width: 1, height: 1, halfFloat, orbit, canvas, ui };
let state: LabState = loadState();
let exp: Experiment | null = null;
let model: AtomModel | null = null;

const fps = new Fps(ui);
const panel = new Panel(
  ui, EXPERIMENTS,
  (patch, soft) => update(patch, soft),
  (id, value, soft) => {
    const o = { ...(state.options[state.exp] ?? {}) };
    o[id] = value;
    update({ options: { ...state.options, [state.exp]: o } }, soft);
  },
);

function optionValues(e: Experiment): Record<string, string> {
  const chosen = state.options[e.id] ?? {};
  const out: Record<string, string> = {};
  for (const o of e.options ?? []) {
    if (o.range) {
      const v = Number(chosen[o.id] ?? o.default ?? o.range.min);
      out[o.id] = String(Number.isFinite(v) ? Math.max(o.range.min, Math.min(o.range.max, v)) : o.range.min);
    } else {
      const choices = o.choices ?? [];
      out[o.id] = choices.some((c) => c.id === chosen[o.id]) ? chosen[o.id] : choices[0]?.id ?? '';
    }
  }
  return out;
}

function settings(e: Experiment): Settings {
  return { quality: state.quality, brightness: state.brightness, threshold: state.threshold, cutaway: state.cutaway, options: optionValues(e) };
}

/** Center the atom in the space the open panel leaves: above it on phones (a bottom sheet),
 *  to its right on wider screens. */
function frameAroundPanel(): void {
  const w = window.innerWidth, h = window.innerHeight;
  const el = ui.querySelector<HTMLElement>('.lab-panel');
  const r = el && !el.classList.contains('closed') ? el.getBoundingClientRect() : null;
  let dx = 0, dy = 0;
  orbit.viewFrac = 1;
  orbit.viewFracX = 1;
  if (r && w <= 560) {
    const visible = Math.max(h * 0.3, Math.min(h, r.top));
    orbit.viewFrac = visible / h;
    dy = (h - visible) / 2;
  } else if (r && w > 560 && r.right < w * 0.5) {
    const visible = w - r.right;
    orbit.viewFracX = visible / w;
    dx = -r.right / 2;
  }
  if (dx || dy) camera.setViewOffset(w, h, dx, dy, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}

function resize(): void {
  const pr = Math.min(2, window.devicePixelRatio || 1);
  renderer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  ctx.width = size.x;
  ctx.height = size.y;
  camera.aspect = size.x / size.y;
  camera.updateProjectionMatrix();
  frameAroundPanel();
  exp?.resize(ctx);
}

/** Build the model for the current selection and hand it over when it changed (or `force`). */
function refreshModel(force: boolean): void {
  if (!exp) return;
  const next = buildModel({ z: state.z, orbital: state.orbital, full: state.full, m: state.m }, exp.wantsSign(settings(exp)));
  if (next === model && !force) return;
  const first = !model;
  model = next;
  exp.setAtom(model);
  orbit.fit(exp.frame ? exp.frame(model) : model.frame * model.worldPerA0);
  if (first) orbit.snap();
}

let modelTimer = 0;

/** Apply a change: swap the experiment, push settings, rebuild the model; save. A soft change
 *  (a slider moving) applies settings now and rebuilds the model once the slider rests. */
function update(patch: Partial<LabState>, soft = false): void {
  const before = state;
  state = { ...state, ...patch };
  const e = elementAt(state.z);
  if (!orbitalChoices(e).some((o) => o.id === state.orbital)) state.orbital = 'total';
  let swapped = false;
  if (!exp || exp.id !== state.exp) {
    exp?.dispose();
    exp = (EXPERIMENTS.find((x) => x.id === state.exp) ?? EXPERIMENTS[0]).make();
    state.exp = exp.id;
    exp.init(ctx);
    exp.resize(ctx);
    model = null;
    swapped = true;
  }
  exp.setSettings(settings(exp));
  window.clearTimeout(modelTimer);
  if (soft) modelTimer = window.setTimeout(() => refreshModel(false), 90);
  else refreshModel(swapped || before.options !== state.options);
  orbit.autoRotate = state.autoRotate;
  if (soft) panel.header(state);
  else panel.render(state, exp, optionValues(exp));
  frameAroundPanel();
  saveState(state);
}

let last = performance.now();
let time = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;
  orbit.update(dt);
  if (exp) {
    exp.render(dt, time);
    fps.tick(now, exp.stats(), ctx);
  }
  requestAnimationFrame(frame);
}

window.addEventListener('resize', resize);
resize();
update({});
orbit.snap();
requestAnimationFrame(frame);

// For scripted screenshots and quick experiments from the console.
declare global {
  interface Window { lab: { set(patch: Partial<LabState>): void; state(): LabState; experiments: string[] } }
}
window.lab = {
  set: (patch) => { update(patch); orbit.snap(); },
  state: () => state,
  experiments: EXPERIMENTS.map((e) => e.id),
};
