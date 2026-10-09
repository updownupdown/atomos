import { AtomScene, type ScreenPoint } from './render/scene';
import {
  applyPlacement, axisOrbital, band, cascade, captureLadder, configuration, electronCount,
  isGroundState, newAtom, nextSubshell, reachableLines, removeLastElectron, resolvePlacement,
  type Atom, type Axis, type OrbitalId, type Spin,
} from './core/physics';
import { ELEMENTS, FAMILY_COLOURS, FAMILY_NAMES, MAX_Z, element } from './core/elements';
import {
  ISOTOPES, MODE_LABEL, decayProducts, findIsotope, formatDuration, isFleeting, isStable,
  isotopeKey, isotopesOf, sampleLifetime, type Isotope,
} from './core/isotopes';
import { clearSave, defaultSave, frontier, loadSave, writeSave, type LaunchStyle, type SaveData } from './core/save';
import { judgePhrase, phraseCloses, TEMPOS } from './core/pulse';
import { DIAL_MAX, dialAngle, dialLines, readDial, resonance, turnDial, type DialLine } from './core/dial';
import { bandLabel, wavelengthToHex } from './render/colour';
import { bandCentre, captureBands, CENTRE, FREE, readPull, type Band, type PullReading } from './core/tuning';
import { drawSpiral, hitSpiral, layoutSpiral, type SpiralNode } from './ui/spiral';
import { buildTracks, drawWitness, slowFactor } from './ui/witness';
import * as sfx from './audio';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Droplet silver: the default electron colour until the player tints an element. */
const SILVER = '#e8e2d4';
const MONO = "'Courier Prime', 'Courier New', monospace";
/** A charge held this far past the top of the ladder breaks free on its own. */
const OVERFLOW = 1.12;
const STYLES: { id: LaunchStyle; label: string }[] = [
  { id: 'charge', label: 'Charge' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'tune', label: 'Tune' },
];

type Mode = 'build' | 'slice' | 'done';

/** A held press in Charge style: the electron climbs the ladder until it is let go. */
interface Charge {
  at: ScreenPoint;
  cur: ScreenPoint;
  t0: number;
  power: number;
  bands: Band[];
  reading: PullReading;
  keyboard: boolean;
  /** Recent finger heights, to read a flick up or down at release as spin. */
  recent: { t: number; y: number }[];
}

/** Where a launched electron is headed and what the atom will make of it. */
interface Shot {
  from: ScreenPoint;
  toward: ScreenPoint;
  reading: PullReading;
  onTarget: boolean;
  axis: Axis | null;
  spin: Spin | null;
  power: number;
  /** Why an uncaught or over-energetic shot failed, worded for the launch style that made it. */
  note?: (bare: boolean) => string;
}

export class Game {
  private save: SaveData = loadSave();
  private scene: AtomScene;
  private z = 1;
  private atom: Atom = newAtom(1);
  private neutrons = 0;
  private mode: Mode = 'build';
  private busy = false;
  private slicePath: ScreenPoint[] | null = null;
  private charge: Charge | null = null;
  /** Taps so far in Pulse style, as performance.now() times, where the first landed, and any swiped spin. */
  private phrase: { taps: number[]; at: ScreenPoint; spin: Spin | null } | null = null;
  private pulsePhase = performance.now();
  private pulseBeat = -1;
  private pulseShown = -1;
  private pulseTouch: { start: ScreenPoint; cur: ScreenPoint } | null = null;
  /** Dial setting in Tune style, as a fraction of the ionisation energy. */
  private dial = 0;
  private dialDrag: { last: ScreenPoint; t0: number; moved: number } | null = null;
  private dialShown = '';
  private pointers = new Set<number>();
  private overlay = $<HTMLCanvasElement>('overlay');
  private assistLevel = 0;
  private assistAxis: Axis = 'x';
  private assistSpin: Spin | null = null;
  private modalCleanup: (() => void) | null = null;
  /** Electrons lost and undos used in the current build; either spoils a flawless build. */
  private lost = 0;
  private undos = 0;

  constructor(private onGallery: () => void = () => {}) {
    this.scene = new AtomScene($<HTMLCanvasElement>('atom'));
    this.applySettings();
    this.bindInput();
    this.z = frontier(this.save, MAX_Z);
    this.start(this.z);
    this.processDecays(true);
    window.setInterval(() => this.processDecays(false), 1000);
    window.addEventListener('resize', () => this.resizeOverlay());
    this.resizeOverlay();
    if (Object.keys(this.save.built).length === 0) this.showIntro();
  }

  // ---- lifecycle --------------------------------------------------------------

  /** Open the builder on an element, from the gallery. */
  openElement(z: number): void {
    this.start(Math.min(MAX_Z, Math.max(1, z)));
    this.resizeOverlay();
    window.dispatchEvent(new Event('resize'));
  }


  private start(z: number): void {
    this.z = z;
    this.atom = newAtom(z);
    this.neutrons = element(z).commonA - z;
    this.mode = 'build';
    this.busy = false;
    this.assistLevel = 0;
    this.lost = 0;
    this.undos = 0;
    this.charge = null;
    this.phrase = null;
    this.dial = 0;
    this.pulseShown = -1;
    this.dialShown = '';
    const colour = this.colourFor(z);
    this.scene.setColour(colour);
    document.documentElement.style.setProperty('--el', colour);
    let note = '';
    if (z >= 3 && this.save.settings.autoCore && (this.save.built[2] || this.save.settings.unlockAll)) {
      for (let i = 0; i < 2; i++) {
        const r = resolvePlacement(this.atom);
        if (r?.kind === 'placed') this.atom = applyPlacement(this.atom, r.orbital, r.spin);
      }
      note = 'Your helium core fills the inner 1s shell, written [He]. ';
    }
    this.refresh();
    this.say(`${note}${this.guidance()}`);
  }

  private colourFor(z: number): string {
    return this.save.built[z]?.colour ?? SILVER;
  }

  private pDiscovered(): boolean {
    return this.save.discoveredShapes.includes('p') || this.save.settings.unlockAll;
  }

  private targetOrbital(axis: Axis | null): OrbitalId | null {
    const sub = nextSubshell(this.atom);
    if (!sub) return null;
    if (sub.id !== '2p') return sub.orbitals[0];
    if (!this.pDiscovered()) return null;
    const r = resolvePlacement(this.atom, { axis });
    return r?.kind === 'placed' ? r.orbital : axis ? axisOrbital(axis) : null;
  }

  private refresh(): void {
    const el = element(this.z);
    $('badge-z').textContent = String(el.z);
    $('badge-sym').textContent = el.symbol;
    $('badge-name').textContent = el.name;
    $('badge-config').textContent = configuration(this.atom);
    $('edge').textContent = `ATOMOS 400 \u25b8 ${el.symbol.toUpperCase()} ${el.z} \u25b8 PLATE ${String(el.z).padStart(4, '0')}`;
    const dots = $('electrons');
    const k = electronCount(this.atom);
    dots.innerHTML = Array.from({ length: el.z }, (_, i) => `<span class="${i < k ? 'on' : ''}"></span>`).join('');
    if (this.lost + this.undos > 0) dots.innerHTML += `<em class="lost">${[this.lost ? `${this.lost} lost` : '', this.undos ? `${this.undos} undone` : ''].filter(Boolean).join(' · ')}</em>`;
    dots.setAttribute('aria-label', `${k} of ${el.z} electrons placed${this.lost ? `, ${this.lost} lost` : ''}`);
    this.scene.setAtom(this.atom, this.neutrons, { pDiscovered: this.pDiscovered(), target: this.targetOrbital(null) });
    this.scene.setGhost(null);
    this.renderLadder(null);
    this.renderSpectrum();
    this.renderAssist();
    ($('btn-undo') as HTMLButtonElement).disabled = this.atom.history.length === 0 || this.busy;
    this.renderSwitch();
    this.ensureLoop();
  }

  private style(): LaunchStyle {
    return this.save.settings.launch;
  }

  private renderSwitch(): void {
    const box = $('launch-switch');
    box.innerHTML = `<span class="label">Launch</span>${STYLES.map((st) => `<button data-launch="${st.id}" aria-pressed="${this.style() === st.id}">${st.label}</button>`).join('')}`;
    box.querySelectorAll<HTMLButtonElement>('[data-launch]').forEach((b) => (b.onclick = () => this.setStyle(b.dataset.launch as LaunchStyle)));
  }

  private setStyle(style: LaunchStyle): void {
    if (this.style() === style) return;
    this.save.settings.launch = style;
    writeSave(this.save);
    this.charge = null;
    this.phrase = null;
    this.dialDrag = null;
    this.pulseShown = -1;
    this.dialShown = '';
    sfx.stopHum();
    this.clearOverlay();
    this.refresh();
    if (this.mode === 'build') this.say(this.guidance());
  }

  private guidance(): string {
    const sub = nextSubshell(this.atom);
    const k = electronCount(this.atom);
    if (!sub) return '';
    const style = this.style();
    const assist = this.save.settings.assist;
    const levels = captureLadder(this.atom)?.levels.map((l) => l.n) ?? [];
    const range = levels.length ? `n=${levels[0]} to n=${levels[levels.length - 1]}` : '';
    const how = assist
      ? 'Choose an energy level, then press <span class="hl">Launch</span>.'
      : style === 'charge'
        ? `Press and hold: the electron climbs the ladder. <span class="hl">Let go while the rung you want is lit</span> (${range}). Hold on too long and it breaks free. Flick up or down as you let go to set spin.`
        : style === 'pulse'
          ? `Tap along with the beat: <span class="hl">n beats in a row</span> send the electron to level n (${range}). The first beat you leave silent ends the phrase. Swipe up or down on a tap to set spin.`
          : `Drag round the atom to turn the dial. The atom glows and hums near an energy it can absorb at. <span class="hl">Tap the atom</span> to fire at the dial's setting.`;
    if (k === 0 && this.z === 1 && !assist) {
      if (style === 'charge') return `A lone proton waits. An atom only holds electrons at its allowed energy levels, the rungs on the ladder. <span class="hl">Press and hold</span> to send the electron climbing, and <span class="hl">let go while a rung is lit</span>.`;
      if (style === 'pulse') return `A lone proton waits. A bound electron is a wave that must join up with itself round the nucleus, so only whole numbers of waves fit: level n holds n. <span class="hl">Tap 2 to 5 beats in time with the pulse</span>, then leave one silent.`;
      return `A lone proton waits. It only absorbs an electron at certain energies, the lines on the dial. <span class="hl">Drag round the atom</span> to tune until it glows, then <span class="hl">tap it</span> to fire.`;
    }
    if (sub.id === '2p' && !this.pDiscovered()) return 'This electron needs a shape no atom of yours has had yet.';
    if (sub.id === '2p') {
      const lobe = assist ? 'Pick the lobe you want' : style === 'charge' ? 'Hold on the lobe you want' : 'Tap on the lobe you want';
      return `Electron ${k + 1} goes into a 2p lobe. ${lobe}; spreading out sounds sweeter. ${how}`;
    }
    return `Electron ${k + 1} will settle into the ${sub.id} orbital. ${how}`;
  }

  private say(html: string): void {
    $('message').innerHTML = html;
  }

  // ---- energy ladder and spectrum --------------------------------------------

  private renderLadder(active: number | 'ionise' | null): void {
    const box = $('ladder');
    const ladder = captureLadder(this.atom);
    if (!ladder || this.mode !== 'build') {
      box.innerHTML = '';
      return;
    }
    const fmt = (e: number) => (Math.abs(e) >= 100 ? e.toFixed(0) : Math.abs(e) >= 10 ? e.toFixed(1) : e.toFixed(2));
    const rows = [`<div class="ladder-title">Energy, eV</div>`];
    if (!this.save.settings.assist) rows.push(`<div class="rung danger ${active === 'ionise' ? 'active' : ''}"><b>free</b><span>knocks one out</span></div>`);
    for (const l of [...ladder.levels].reverse()) {
      rows.push(`<div class="rung ${active === l.n ? 'active' : ''}"><b>n=${l.n}</b><span>${fmt(l.energy)}</span></div>`);
    }
    rows.push(`<div class="rung ground"><b>${ladder.groundLabel}</b><span>${fmt(ladder.groundEnergy)}</span></div>`);
    box.innerHTML = rows.join('');
  }

  private renderSpectrum(): void {
    const c = $<HTMLCanvasElement>('spectrum');
    const dpr = Math.min(2, window.devicePixelRatio);
    const w = c.clientWidth, h = c.clientHeight;
    if (!w) return;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const x = (nm: number) => spectrumX(nm) * w;
    // Visible band as a faint rainbow.
    for (let nm = 380; nm <= 750; nm += 2) {
      ctx.fillStyle = wavelengthToHex(nm) + '30';
      ctx.fillRect(x(nm), 0, Math.max(1, x(nm + 2) - x(nm)), h);
    }
    const lines = this.save.photons[this.z] ?? [];
    // Lines this element can still release, as faint gaps waiting to be filled.
    ctx.fillStyle = 'rgba(226, 220, 207, 0.28)';
    for (const nm of reachableLines(this.z)) {
      if (lines.includes(nm)) continue;
      for (let y = 3; y < h - 3; y += 4) ctx.fillRect(x(nm) - 0.5, y, 1, 2);
    }
    for (const nm of lines) {
      const visible = band(nm) === 'visible';
      ctx.fillStyle = visible ? wavelengthToHex(nm) : 'rgba(240, 234, 220, 0.8)';
      ctx.fillRect(x(nm) - 1, 3, 2, h - 6);
      if (visible) {
        ctx.fillStyle = wavelengthToHex(nm) + '55';
        ctx.fillRect(x(nm) - 3, 3, 6, h - 6);
      }
    }
  }

  // ---- assist panel --------------------------------------------------------------

  private renderAssist(): void {
    const box = $('assist');
    const on = this.save.settings.assist;
    document.body.classList.toggle('assist-on', on);
    box.hidden = !on;
    if (!on) return;
    if (this.mode === 'slice') {
      box.innerHTML = `<div class="label">Cut the cloud with one swipe through the nucleus, or let the game cut it for you.</div>
        <button class="primary" id="as-cut">Cut through the nucleus</button>`;
      $('as-cut').onclick = () => this.performCut(this.scene.screenPerpAxis(0, 1));
      return;
    }
    const ladder = captureLadder(this.atom);
    if (!ladder || this.mode !== 'build') {
      box.innerHTML = '';
      box.hidden = true;
      return;
    }
    this.assistLevel = Math.min(this.assistLevel, ladder.levels.length - 1);
    const level = ladder.levels[this.assistLevel].n;
    const sub = nextSubshell(this.atom);
    const showAxis = sub?.id === '2p' && this.pDiscovered();
    box.innerHTML = `
      <div class="row"><span class="label">Energy</span>
        <span class="seg"><button id="as-down" aria-label="Lower energy">−</button><button disabled>n=${level}</button><button id="as-up" aria-label="Higher energy">+</button></span></div>
      ${showAxis ? `<div class="row"><span class="label">Lobe</span><span class="seg">${(['x', 'y', 'z'] as Axis[]).map((a) => `<button data-axis="${a}" aria-pressed="${this.assistAxis === a}">${a}</button>`).join('')}</span></div>` : ''}
      <div class="row"><span class="label">Spin</span><span class="seg">
        <button data-spin="0" aria-pressed="${this.assistSpin === null}">auto</button>
        <button data-spin="1" aria-pressed="${this.assistSpin === 1}" aria-label="Spin up">↑</button>
        <button data-spin="-1" aria-pressed="${this.assistSpin === -1}" aria-label="Spin down">↓</button></span></div>
      <button class="primary" id="as-launch" ${this.busy ? 'disabled' : ''}>Launch electron</button>`;
    $('as-down').onclick = () => { this.assistLevel = Math.max(0, this.assistLevel - 1); this.renderAssist(); this.renderLadder(ladder.levels[this.assistLevel].n); };
    $('as-up').onclick = () => { this.assistLevel = Math.min(ladder.levels.length - 1, this.assistLevel + 1); this.renderAssist(); this.renderLadder(ladder.levels[this.assistLevel].n); };
    box.querySelectorAll<HTMLButtonElement>('[data-axis]').forEach((b) => (b.onclick = () => {
      this.assistAxis = b.dataset.axis as Axis;
      this.scene.setGhost(this.targetOrbital(this.assistAxis));
      this.renderAssist();
    }));
    box.querySelectorAll<HTMLButtonElement>('[data-spin]').forEach((b) => (b.onclick = () => {
      const v = Number(b.dataset.spin);
      this.assistSpin = v === 0 ? null : (v as Spin);
      this.renderAssist();
    }));
    $('as-launch').onclick = () => this.assistLaunch();
    this.renderLadder(level);
  }

  private assistLaunch(): void {
    if (this.busy || this.mode === 'done') return;
    const ladder = captureLadder(this.atom);
    if (!ladder) return;
    if (this.needsSlice()) return this.enterSlice();
    const level = ladder.levels[Math.min(this.assistLevel, ladder.levels.length - 1)].n;
    const sub = nextSubshell(this.atom);
    const axis = sub?.id === '2p' ? this.assistAxis : null;
    const n = this.scene.nucleusScreen();
    const r = this.scene.extentScreenRadius();
    const power = bandCentre(level, captureBands(ladder.levels.map((l) => l.n)));
    void this.fire({ from: { x: n.x + r * 1.8, y: n.y + r * 0.9 }, toward: n, reading: { kind: 'level', n: level, precision: 1 }, onTarget: true, axis, spin: this.assistSpin, power });
  }

  // ---- input -----------------------------------------------------------------

  private bindInput(): void {
    const canvas = $<HTMLCanvasElement>('atom');
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onCancel(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    $('btn-undo').onclick = () => this.undo();
    $('btn-restart').onclick = () => !this.busy && this.start(this.z);
    $('btn-map').onclick = () => this.showMap();
    $('btn-gallery').onclick = () => { this.closeModal(); this.onGallery(); };
    $('btn-settings').onclick = () => this.showSettings();
    $('badge').onclick = () => this.showCard(this.z, false);
    $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) this.closeModal(); });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.onCancel(null));
  }

  /** Where a keyboard launch comes from: just right of the atom. */
  private keyPoint(): ScreenPoint {
    const n = this.scene.nucleusScreen();
    return { x: n.x + this.scene.extentScreenRadius() * 1.6, y: n.y };
  }

  private onKey(e: KeyboardEvent): void {
    if (!$('modal').hidden) {
      if (e.key === 'Escape') this.closeModal();
      return;
    }
    const ladder = captureLadder(this.atom);
    const assist = this.save.settings.assist;
    const style = this.style();
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (this.mode === 'slice') this.performCut(this.scene.screenPerpAxis(0, 1));
      else if (assist) this.assistLaunch();
      else if (style === 'pulse') this.tap(this.keyPoint(), performance.now());
      else if (style === 'tune') this.fireDial(this.keyPoint());
      else if (!e.repeat && !this.charge) this.beginCharge(this.keyPoint(), true);
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && style === 'tune' && !assist) {
      e.preventDefault();
      const step = (e.shiftKey ? 0.02 : 0.004) * (e.key === 'ArrowRight' ? 1 : -1);
      this.dial = Math.max(0, Math.min(DIAL_MAX, this.dial + step));
      this.ensureLoop();
    } else if (e.key === 'ArrowUp' && ladder) {
      this.assistLevel = Math.min(ladder.levels.length - 1, this.assistLevel + 1);
      this.renderAssist();
      this.renderLadder(ladder.levels[this.assistLevel].n);
    } else if (e.key === 'ArrowDown' && ladder) {
      this.assistLevel = Math.max(0, this.assistLevel - 1);
      this.renderAssist();
      this.renderLadder(ladder.levels[this.assistLevel].n);
    } else if (['x', 'y', 'z'].includes(e.key)) {
      this.assistAxis = e.key as Axis;
      this.scene.setGhost(this.targetOrbital(this.assistAxis));
      this.renderAssist();
    } else if (e.key === 'u' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) {
      this.undo();
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if ((e.key === ' ' || e.key === 'Enter') && this.charge?.keyboard) this.releaseCharge(null);
  }

  private needsSlice(): boolean {
    return nextSubshell(this.atom)?.id === '2p' && !this.pDiscovered();
  }

  private onDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointers.add(e.pointerId);
    if (this.pointers.size > 1) {
      // Two fingers rotate the view instead. A charge in progress is simply let go of.
      this.charge = null;
      this.slicePath = null;
      this.dialDrag = null;
      this.pulseTouch = null;
      sfx.stopHum();
      this.clearOverlay();
      return;
    }
    if (this.busy || this.mode === 'done') return;
    const p = { x: e.clientX, y: e.clientY };
    if (this.needsSlice() && this.mode !== 'slice') this.enterSlice();
    if (this.mode === 'slice') {
      this.slicePath = [p];
      return;
    }
    if (this.save.settings.assist) return;
    switch (this.style()) {
      case 'charge': this.beginCharge(p, false); break;
      case 'pulse':
        this.pulseTouch = { start: p, cur: p };
        this.tap(p, performance.now());
        break;
      case 'tune':
        this.dialDrag = { last: p, t0: performance.now(), moved: 0 };
        sfx.startHum();
        this.updateHum();
        break;
    }
  }

  private onMove(e: PointerEvent): void {
    const p = { x: e.clientX, y: e.clientY };
    if (this.slicePath) {
      this.slicePath.push(p);
      this.drawSlice();
      return;
    }
    if (this.charge && !this.charge.keyboard) {
      const c = this.charge;
      c.cur = p;
      const now = performance.now();
      c.recent.push({ t: now, y: p.y });
      while (c.recent.length && c.recent[0].t < now - 160) c.recent.shift();
      return;
    }
    if (this.pulseTouch) {
      this.pulseTouch.cur = p;
      return;
    }
    if (this.dialDrag) {
      const d = this.dialDrag;
      const n = this.scene.nucleusScreen();
      const a0 = Math.atan2(d.last.y - n.y, d.last.x - n.x);
      const a1 = Math.atan2(p.y - n.y, p.x - n.x);
      let da = a1 - a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      d.moved += Math.hypot(p.x - d.last.x, p.y - d.last.y);
      d.last = p;
      const before = readDial(this.dial, this.dialLines());
      this.dial = turnDial(this.dial, da, Math.hypot(p.x - n.x, p.y - n.y), this.ringRadius());
      const after = readDial(this.dial, this.dialLines());
      if (after.kind === 'level' && (before.kind !== 'level' || before.n !== after.n)) sfx.tickSound(after.n);
      this.updateHum();
    }
  }

  private onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.slicePath) {
      const path = this.slicePath;
      this.slicePath = null;
      this.checkSlice(path);
      return;
    }
    if (this.charge && !this.charge.keyboard) {
      const r = this.charge.recent;
      const dy = r.length > 1 ? r[r.length - 1].y - r[0].y : 0;
      this.releaseCharge(dy < -18 ? 1 : dy > 18 ? -1 : null);
      return;
    }
    if (this.pulseTouch) {
      const dy = this.pulseTouch.cur.y - this.pulseTouch.start.y;
      if (this.phrase && Math.abs(dy) > 24) this.phrase.spin = dy < 0 ? 1 : -1;
      this.pulseTouch = null;
      return;
    }
    if (this.dialDrag) {
      const d = this.dialDrag;
      this.dialDrag = null;
      sfx.stopHum();
      if (d.moved < 10 && performance.now() - d.t0 < 400) this.fireDial({ x: e.clientX, y: e.clientY });
    }
  }

  private onCancel(e: PointerEvent | null): void {
    if (e) this.pointers.delete(e.pointerId);
    this.charge = null;
    this.slicePath = null;
    this.dialDrag = null;
    this.pulseTouch = null;
    sfx.stopHum();
    this.clearOverlay();
    this.renderLadder(null);
  }

  // ---- overlay drawing ------------------------------------------------------------

  private resizeOverlay(): void {
    const dpr = Math.min(2, window.devicePixelRatio);
    this.overlay.width = window.innerWidth * dpr;
    this.overlay.height = window.innerHeight * dpr;
    this.renderSpectrum();
  }

  private clearOverlay(): void {
    const ctx = this.overlay.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    $('aim').style.display = 'none';
  }

  private overlayCtx(): CanvasRenderingContext2D {
    const ctx = this.overlay.getContext('2d')!;
    const dpr = this.overlay.width / window.innerWidth;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    return ctx;
  }

  private showTip(html: string): void {
    const tip = $('aim');
    tip.innerHTML = html;
    tip.style.display = 'block';
    // A fixed spot under the header, clear of the finger and the ladder.
    const ladderLeft = $('ladder').getBoundingClientRect().left || window.innerWidth;
    tip.style.left = `${Math.max(tip.offsetWidth / 2 + 12, Math.min(window.innerWidth / 2, ladderLeft - tip.offsetWidth / 2 - 8))}px`;
    tip.style.top = `${$('electrons').getBoundingClientRect().bottom + 44}px`;
  }

  private levels(): number[] {
    return captureLadder(this.atom)?.levels.map((l) => l.n) ?? [];
  }

  /** The guide ring round the atom, in screen pixels. */
  private ringRadius(): number {
    return Math.min(this.scene.extentScreenRadius() * 1.05, Math.min(window.innerWidth, window.innerHeight) * 0.36);
  }

  private drawRing(ctx: CanvasRenderingContext2D, c: ScreenPoint, r: number): void {
    ctx.strokeStyle = 'rgba(226, 220, 207, 0.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** Faint guides showing which direction fills which lobe. */
  private drawAxisGuides(ctx: CanvasRenderingContext2D, chosen: Axis): void {
    const o = this.scene.nucleusScreen();
    const r = Math.min(this.scene.extentScreenRadius() * 0.9, Math.min(window.innerWidth, window.innerHeight) * 0.38);
    const dirs = this.scene.axisDirections();
    const maxLen = Math.max(dirs.x.len, dirs.y.len, dirs.z.len);
    ctx.font = `700 13px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const axis of ['x', 'y', 'z'] as Axis[]) {
      const d = dirs[axis];
      if (d.len < maxLen * 0.2) continue;
      const on = axis === chosen;
      ctx.strokeStyle = on ? 'rgba(224, 80, 58, 0.85)' : 'rgba(226, 220, 207, 0.22)';
      ctx.lineWidth = on ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(o.x - d.x * r, o.y - d.y * r);
      ctx.lineTo(o.x + d.x * r, o.y + d.y * r);
      ctx.stroke();
      ctx.fillStyle = on ? '#e0503a' : 'rgba(226, 220, 207, 0.6)';
      ctx.fillText(axis, o.x + d.x * (r + 14), o.y + d.y * (r + 14));
    }
  }

  /** A glowing droplet: the electron waiting to be launched. */
  private drawDroplet(ctx: CanvasRenderingContext2D, p: ScreenPoint, tone: 'cool' | 'lit' | 'hot', r = 16): void {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, tone === 'hot' ? 'rgba(224, 80, 58, 1)' : tone === 'lit' ? 'rgba(255, 252, 245, 1)' : 'rgba(200, 194, 182, 0.9)');
    g.addColorStop(1, tone === 'hot' ? 'rgba(224, 80, 58, 0)' : 'rgba(226, 220, 207, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawSlice(): void {
    const path = this.slicePath!;
    const ctx = this.overlayCtx();
    ctx.strokeStyle = 'rgba(243, 238, 226, 0.9)';
    ctx.shadowColor = '#f3eee2';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    ctx.beginPath();
    path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /** The lobe a launch from screen point p would fill, when the next electron is a 2p one. */
  private axisFrom(p: ScreenPoint): Axis | null {
    const n = this.scene.nucleusScreen();
    if (nextSubshell(this.atom)?.id !== '2p' || Math.hypot(p.x - n.x, p.y - n.y) < 18) return null;
    return this.scene.screenDirToAxis(p.x - n.x, p.y - n.y);
  }

  // ---- the animation loop behind Charge, Pulse and Tune ------------------------------

  private loopRaf = 0;

  private needsLoop(): boolean {
    if (this.mode !== 'build' || this.save.settings.assist || this.slicePath) return false;
    return this.charge !== null || this.style() === 'pulse' || this.style() === 'tune';
  }

  private ensureLoop(): void {
    if (!this.loopRaf && this.needsLoop()) this.loopRaf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number): void {
    this.loopRaf = 0;
    if (!this.needsLoop()) {
      this.phrase = null;
      this.clearOverlay();
      return;
    }
    if (this.charge) this.chargeFrame(now);
    else if (this.style() === 'pulse') this.pulseFrame(now);
    else this.drawDial(now);
    this.loopRaf = requestAnimationFrame((t) => this.frame(t));
  }

  // ---- Charge: hold to climb the ladder, let go on a rung ----------------------------

  private climbMs(): number {
    return this.save.settings.climb === 'slow' ? 4400 : 2800;
  }

  private beginCharge(p: ScreenPoint, keyboard: boolean): void {
    if (this.busy || this.mode !== 'build' || !captureLadder(this.atom)) return;
    if (this.needsSlice()) return this.enterSlice();
    this.charge = { at: p, cur: p, t0: performance.now(), power: 0, bands: captureBands(this.levels()), reading: { kind: 'none' }, keyboard, recent: [] };
    this.ensureLoop();
  }

  private chargeFrame(now: number): void {
    const c = this.charge!;
    c.power = (now - c.t0) / this.climbMs();
    const before = c.reading;
    c.reading = readPull(Math.min(c.power, 1.2), c.bands);
    if (c.reading.kind === 'level' && (before.kind !== 'level' || before.n !== c.reading.n)) sfx.tickSound(c.reading.n);
    if (c.reading.kind === 'free' && before.kind !== 'free') sfx.buzz(30);
    if (c.power >= OVERFLOW) {
      // Held on past the top of the ladder: the electron breaks free on its own.
      this.releaseCharge(null);
      return;
    }
    const axis = this.axisFrom(c.at);
    this.scene.setGhost(this.targetOrbital(axis));
    this.renderLadder(c.reading.kind === 'level' ? c.reading.n : c.reading.kind === 'free' ? 'ionise' : null);
    this.drawCharge(c, axis);
  }

  private releaseCharge(spin: Spin | null): void {
    const c = this.charge;
    this.charge = null;
    this.clearOverlay();
    this.scene.setGhost(null);
    this.renderLadder(null);
    if (!c || this.busy || this.mode !== 'build') return;
    // Read the climb at the moment of release, not at the last drawn frame.
    c.power = Math.min(OVERFLOW, (performance.now() - c.t0) / this.climbMs());
    c.reading = readPull(Math.min(c.power, 1.2), c.bands);
    if (c.reading.kind === 'none') {
      this.say(`A tap launches nothing. <span class="hl">Press and hold</span> to send the electron up the ladder, and let go on the rung you want.`);
      return;
    }
    const reading = c.reading;
    const ev = (p: number) => this.powerToEv(p, c.bands);
    const between = reading.kind === 'between'
      ? reading.below === null ? `short of n=${reading.above}` : reading.above === null ? `past n=${reading.below}` : `between n=${reading.below} and n=${reading.above}`
      : '';
    void this.fire({
      from: c.at, toward: this.scene.nucleusScreen(), reading, onTarget: true, axis: this.axisFrom(c.at), spin, power: Math.min(1, c.power),
      note: (bare) => reading.kind === 'free'
        ? bare
          ? `<span class="bad">Too fast to catch.</span> You held on past the top of the ladder, and a bare nucleus cannot hold an electron with more energy than its ionisation energy. Let go while a rung is lit.`
          : `<span class="bad">Too much energy.</span> You held on past the top of the ladder. The electron struck hard enough to knock one free, so both are lost. Let go while a rung is lit.`
        : `<span class="warn">Not caught.</span> Let go at about ${ev(c.power)} eV, ${between}. An atom only holds electrons at its allowed levels, so it passed straight through. Let go while the rung is lit.`,
    });
  }

  /** Rough energy, in eV above the ground state, that a point on the climb corresponds to. */
  private powerToEv(power: number, bands: Band[]): string {
    const ladder = captureLadder(this.atom);
    if (!ladder) return '?';
    const ie = -ladder.groundEnergy;
    const pts = [{ p: 0, e: 0 }, ...bands.map((b) => ({ p: b.centre, e: ie + ladder.levels.find((l) => l.n === b.n)!.energy })), { p: FREE, e: ie }];
    for (let i = 1; i < pts.length; i++) {
      if (power <= pts[i].p) {
        const f = (power - pts[i - 1].p) / (pts[i].p - pts[i - 1].p);
        return (pts[i - 1].e + f * (pts[i].e - pts[i - 1].e)).toFixed(ie >= 100 ? 0 : 1);
      }
    }
    return `over ${ie.toFixed(ie >= 100 ? 0 : 1)}`;
  }

  /** The climbing electron is drawn on a track beside the energy ladder, so the rungs are the real targets. */
  private drawCharge(c: Charge, axis: Axis | null): void {
    const ctx = this.overlayCtx();
    const box = $('ladder');
    const rect = box.getBoundingClientRect();
    const rows = [...box.querySelectorAll<HTMLElement>('.rung')];
    const mid = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
    const ground = rows.find((r) => r.classList.contains('ground'));
    const free = rows.find((r) => r.classList.contains('danger'));
    if (!ground || !free) return;
    const stops: { p: number; y: number }[] = [{ p: 0, y: mid(ground) }];
    for (const b of c.bands) {
      const row = rows.find((r) => r.querySelector('b')?.textContent === `n=${b.n}`);
      if (row) stops.push({ p: b.centre, y: mid(row) });
    }
    const fr = free.getBoundingClientRect();
    stops.push({ p: FREE, y: fr.bottom }, { p: OVERFLOW, y: fr.top - 4 });
    const yAt = (p: number): number => {
      for (let i = 1; i < stops.length; i++) {
        if (p <= stops[i].p) {
          const f = (p - stops[i - 1].p) / (stops[i].p - stops[i - 1].p);
          return stops[i - 1].y + f * (stops[i].y - stops[i - 1].y);
        }
      }
      return stops[stops.length - 1].y;
    };
    const x = rect.left - 14;
    const seg = (p0: number, p1: number, colour: string, width: number) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, yAt(p0));
      ctx.lineTo(x, yAt(p1));
      ctx.stroke();
    };
    seg(0, FREE, 'rgba(226, 220, 207, 0.22)', 2);
    seg(FREE, OVERFLOW, 'rgba(224, 80, 58, 0.6)', 6);
    for (const b of c.bands) {
      const on = c.reading.kind === 'level' && c.reading.n === b.n;
      seg(b.lo, b.hi, on ? 'rgba(243, 238, 226, 1)' : 'rgba(226, 220, 207, 0.5)', on ? 10 : 7);
    }
    // The electron: it sits where the finger is and its energy shows on the track.
    const tone = c.reading.kind === 'free' ? 'hot' : c.reading.kind === 'level' ? 'lit' : 'cool';
    const y = yAt(Math.min(c.power, OVERFLOW));
    ctx.strokeStyle = 'rgba(226, 220, 207, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    ctx.beginPath();
    ctx.moveTo(c.cur.x, c.cur.y);
    ctx.lineTo(x - 8, y);
    ctx.stroke();
    ctx.setLineDash([]);
    this.drawDroplet(ctx, { x, y }, tone, 12);
    if (!c.keyboard) this.drawDroplet(ctx, c.cur, tone);
    if (axis) this.drawAxisGuides(ctx, axis);

    const parts: string[] = [];
    if (c.reading.kind === 'free') parts.push('<span style="color:var(--bad)">too much energy · breaking free</span>');
    else if (c.reading.kind === 'level') parts.push(`let go now · n=${c.reading.n}${c.reading.precision >= 1 - CENTRE ? ' · centre' : ''}`);
    else parts.push('<span style="color:var(--muted)">climbing · not on a rung</span>');
    if (axis) parts.push(`2p<sub>${axis}</sub>`);
    parts.push('flick ↑ or ↓ to set spin');
    this.showTip(parts.join(' · '));
  }

  // ---- Pulse: a beat that never stops; n taps in a row go to level n ------------------

  private period(): number {
    return TEMPOS[this.save.settings.tempo];
  }

  private tap(p: ScreenPoint, t: number): void {
    if (this.busy || this.mode !== 'build' || !captureLadder(this.atom)) return;
    if (this.needsSlice()) return this.enterSlice();
    if (!this.phrase) this.phrase = { taps: [t], at: p, spin: null };
    else this.phrase.taps.push(t);
    sfx.tickSound(Math.min(7, this.phrase.taps.length + 1));
    const levels = this.levels();
    if (this.phrase.taps.length > levels[levels.length - 1]) this.evaluatePhrase();
    this.ensureLoop();
  }

  private pulseFrame(now: number): void {
    const period = this.period();
    const beat = Math.floor((now - this.pulsePhase) / period);
    if (beat !== this.pulseBeat) {
      this.pulseBeat = beat;
      sfx.beatSound(this.phrase !== null);
    }
    const ph = this.phrase;
    if (ph && !this.busy && now >= phraseCloses(ph.taps[ph.taps.length - 1], period, this.pulsePhase)) this.evaluatePhrase();
    this.drawPulse(now);
  }

  private evaluatePhrase(): void {
    const ph = this.phrase;
    this.phrase = null;
    this.pulseTouch = null;
    if (!ph || this.busy) return;
    const levels = this.levels();
    const v = judgePhrase(ph.taps, this.period(), this.pulsePhase, levels);
    const toward = this.scene.nucleusScreen();
    const base = { from: ph.at, toward, axis: this.axisFrom(ph.at), spin: ph.spin, onTarget: true };
    const beats = (k: number) => `${k} beat${k === 1 ? '' : 's'}`;
    let shot: Shot;
    switch (v.kind) {
      case 'level':
        shot = { ...base, reading: { kind: 'level', n: v.n, precision: v.precision }, power: v.n / (levels[levels.length - 1] + 1) };
        break;
      case 'free':
        shot = {
          ...base, reading: { kind: 'free' }, power: 1,
          note: (bare) => `<span class="bad">${bare ? 'Too fast to catch.' : 'Too much energy.'}</span> ${beats(v.n)} would be level n=${v.n}, past the highest level on offer (n=${v.highest}). ${bare ? 'A bare nucleus cannot hold an electron with that much energy.' : 'The electron struck hard enough to knock one free, so both are lost.'}`,
        };
        break;
      case 'off':
        shot = {
          ...base, reading: { kind: 'between', below: null, above: null }, power: 0.5,
          note: () => `<span class="warn">Out of step.</span> ${beats(v.n)}, but one landed off the beat, so the wave did not join up with itself and nothing held the electron. Tap on the pulse: each beat is one crest of the wave.`,
        };
        break;
      case 'low':
        shot = {
          ...base, reading: { kind: 'between', below: null, above: null }, power: 0.5,
          note: () => `<span class="warn">Not caught.</span> ${beats(v.n)} would be level n=${v.n}, below the levels open to this electron. The lowest here is n=${v.lowest}; it falls further on its own once caught.`,
        };
        break;
    }
    void this.fire(shot);
  }

  private drawPulse(now: number): void {
    const ctx = this.overlayCtx();
    const c = this.scene.nucleusScreen();
    const R = this.ringRadius();
    const period = this.period();
    const f = (((now - this.pulsePhase) / period) % 1 + 1) % 1;
    this.drawRing(ctx, c, R);
    // The beat: a ring of light that leaves the nucleus on every beat and fades as it reaches the guide ring.
    ctx.strokeStyle = `rgba(243, 238, 226, ${0.55 * (1 - f)})`;
    ctx.lineWidth = 2 + 4 * (1 - f);
    ctx.beginPath();
    ctx.arc(c.x, c.y, R * (0.25 + 0.75 * f), 0, Math.PI * 2);
    ctx.stroke();
    const ph = this.phrase;
    const k = ph ? ph.taps.length : 0;
    const axis = ph ? this.axisFrom(ph.at) : null;
    if (axis) this.drawAxisGuides(ctx, axis);
    this.scene.setGhost(ph ? this.targetOrbital(axis) : null);
    if (ph) {
      // The standing wave so far: k crests round the ring, breathing in time with the beat.
      const A = R * 0.09 * Math.cos(2 * Math.PI * f);
      const a0 = Math.atan2(ph.at.y - c.y, ph.at.x - c.x);
      ctx.strokeStyle = 'rgba(243, 238, 226, 0.9)';
      ctx.shadowColor = '#f3eee2';
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i <= 240; i++) {
        const t = (i / 240) * 2 * Math.PI;
        const r = R + A * Math.cos(k * t);
        const x = c.x + Math.cos(a0 + t) * r, y = c.y + Math.sin(a0 + t) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.shadowBlur = 0;
      this.drawDroplet(ctx, ph.at, 'lit', 14);
    }
    const levels = this.levels();
    const top = levels[levels.length - 1];
    if (k !== this.pulseShown) {
      this.pulseShown = k;
      if (!ph) {
        $('aim').style.display = 'none';
        this.renderLadder(null);
      } else {
        const parts = [`${k} beat${k === 1 ? '' : 's'}`, levels.includes(k) ? `n=${k}` : k > top ? '<span style="color:var(--bad)">too many</span>' : `<span style="color:var(--muted)">below n=${levels[0]}</span>`];
        if (axis) parts.push(`2p<sub>${axis}</sub>`);
        parts.push(ph.spin === null ? 'spin auto' : ph.spin === 1 ? 'spin ↑' : 'spin ↓');
        parts.push('<span style="color:var(--muted)">a silent beat ends it</span>');
        this.showTip(parts.join(' · '));
        this.renderLadder(levels.includes(k) ? k : k > top ? 'ionise' : null);
      }
    }
  }

  // ---- Tune: turn a dial to a level the atom can absorb at, then tap to fire ------------

  private dialLines(): DialLine[] {
    const ladder = captureLadder(this.atom);
    return ladder ? dialLines(ladder.groundEnergy, ladder.levels) : [];
  }

  private updateHum(): void {
    const lines = this.dialLines();
    sfx.setHum(180 * Math.pow(2, this.dial * 2.2), resonance(this.dial, lines));
  }

  private fireDial(p: ScreenPoint): void {
    if (this.busy || this.mode !== 'build' || !captureLadder(this.atom)) return;
    if (this.needsSlice()) return this.enterSlice();
    const lines = this.dialLines();
    const reading = readDial(this.dial, lines);
    if (reading.kind === 'none') {
      this.say('The dial is at zero. <span class="hl">Drag round the atom</span> to turn it up until the atom glows, then tap to fire.');
      return;
    }
    const ladder = captureLadder(this.atom)!;
    const ev = (-ladder.groundEnergy * this.dial).toFixed(-ladder.groundEnergy >= 100 ? 0 : 1);
    const between = reading.kind === 'between'
      ? reading.below === null ? `short of n=${reading.above}` : reading.above === null ? `past n=${reading.below}` : `between n=${reading.below} and n=${reading.above}`
      : '';
    void this.fire({
      from: p, toward: this.scene.nucleusScreen(), reading, onTarget: true, axis: this.axisFrom(p), spin: null, power: this.dial / DIAL_MAX,
      note: (bare) => reading.kind === 'free'
        ? `<span class="bad">${bare ? 'Too fast to catch.' : 'Too much energy.'}</span> The dial is past the ionisation limit (${(-ladder.groundEnergy).toFixed(1)} eV), so ${bare ? 'a bare nucleus cannot hold the electron' : 'the electron struck hard enough to knock one free, and both are lost'}. Turn it back below the red arc.`
        : `<span class="warn">Passed straight through.</span> ${ev} eV is ${between}, and the atom has no level there to absorb at. Turn the dial until the atom glows and hums.`,
    });
  }

  private drawDial(now: number): void {
    const ctx = this.overlayCtx();
    const c = this.scene.nucleusScreen();
    const R = this.ringRadius();
    const lines = this.dialLines();
    const reading = readDial(this.dial, lines);
    const res = resonance(this.dial, lines);
    const at = (a: number, r: number) => ({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
    const arc = (v0: number, v1: number, r: number, colour: string, width: number) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, dialAngle(v0), dialAngle(v1));
      ctx.stroke();
    };
    // Resonance: the cloud brightens as the dial nears a line, shimmering a little on it.
    if (res > 0) {
      const glow = res * (0.9 + 0.1 * Math.sin(now / 90));
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R * 0.8);
      g.addColorStop(0, `rgba(243, 238, 226, ${0.22 * glow})`);
      g.addColorStop(1, 'rgba(243, 238, 226, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, R * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    // The dial: a scale of energy from zero to just past the ionisation limit.
    arc(0, 1, R, 'rgba(226, 220, 207, 0.22)', 2);
    arc(1, DIAL_MAX, R, 'rgba(224, 80, 58, 0.6)', 6);
    ctx.font = `700 11px ${MONO}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (const l of lines) {
      const on = reading.kind === 'level' && reading.n === l.n;
      arc(l.v - l.half, l.v + l.half, R, on ? 'rgba(243, 238, 226, 1)' : 'rgba(226, 220, 207, 0.5)', on ? 10 : 7);
      const a = dialAngle(l.v);
      const p0 = at(a, R - 9), p1 = at(a, R + 9);
      ctx.strokeStyle = on ? '#0c0b0a' : 'rgba(226, 220, 207, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
      // Labels step outward where lines crowd together, so they stay readable.
      const prev = lines[lines.indexOf(l) - 1];
      const crowded = prev && dialAngle(l.v) - dialAngle(prev.v) < 0.22;
      const lp = at(a, R + (crowded && lines.indexOf(l) % 2 ? 40 : 22));
      ctx.fillStyle = on ? '#f3eee2' : 'rgba(226, 220, 207, 0.75)';
      ctx.fillText(`n=${l.n}`, lp.x, lp.y);
    }
    const zero = at(dialAngle(0), R + 22), top = at(dialAngle(DIAL_MAX), R + 22);
    ctx.fillStyle = 'rgba(226, 220, 207, 0.5)';
    ctx.fillText('0', zero.x, zero.y);
    ctx.fillStyle = '#e0503a';
    ctx.fillText('free', top.x, top.y);
    // The needle.
    const a = dialAngle(this.dial);
    const n0 = at(a, R * 0.55), n1 = at(a, R + 2);
    ctx.strokeStyle = reading.kind === 'free' ? 'rgba(224, 80, 58, 0.9)' : 'rgba(243, 238, 226, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(n0.x, n0.y);
    ctx.lineTo(n1.x, n1.y);
    ctx.stroke();
    this.drawDroplet(ctx, n1, reading.kind === 'free' ? 'hot' : reading.kind === 'level' ? 'lit' : 'cool', 12);
    if (this.dialDrag) {
      const axis = this.axisFrom(this.dialDrag.last);
      if (axis) this.drawAxisGuides(ctx, axis);
    }
    const key = `${reading.kind}:${reading.kind === 'level' ? reading.n : ''}:${this.dialDrag !== null}`;
    if (key !== this.dialShown) {
      this.dialShown = key;
      this.renderLadder(reading.kind === 'level' ? reading.n : reading.kind === 'free' ? 'ionise' : null);
      const parts: string[] = [];
      if (reading.kind === 'free') parts.push('<span style="color:var(--bad)">past the ionisation limit</span>');
      else if (reading.kind === 'level') parts.push(`on the n=${reading.n} line${reading.precision >= 1 - CENTRE ? ' · centre' : ''} · tap the atom to fire`);
      else if (reading.kind === 'none') parts.push('<span style="color:var(--muted)">dial at zero · drag round the atom</span>');
      else parts.push('<span style="color:var(--muted)">no line here · keep tuning</span>');
      this.showTip(parts.join(' · '));
    }
  }

  private spinHint(): string {
    if (this.style() === 'charge') return 'Flick the other way as you let go.';
    if (this.style() === 'pulse') return 'Swipe the other way on one of your taps.';
    return 'Let the atom choose.';
  }

  // ---- slice the wave ----------------------------------------------------------------

  private enterSlice(): void {
    this.mode = 'slice';
    this.scene.showUncut(true);
    this.renderLadder(null);
    this.renderAssist();
    this.say(this.save.settings.assist
      ? 'This electron needs a new shape. A <span class="hl">p orbital</span> is a cloud cut in two by a flat sheet through the nucleus where the electron is never found. Press <span class="hl">Cut</span>, or swipe through the nucleus yourself.'
      : 'This electron needs a new shape. A <span class="hl">p orbital</span> is a cloud cut in two by a flat sheet through the nucleus where the electron is never found. <span class="hl">Swipe straight through the nucleus</span> to cut the cloud.');
  }

  private checkSlice(path: ScreenPoint[]): void {
    this.clearOverlay();
    if (path.length < 2) return;
    const a = path[0], b = path[path.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = this.scene.nucleusScreen();
    const reach = Math.max(36, this.scene.extentScreenRadius() * 0.35);
    const d = segmentDistance(n, a, b);
    if (len < Math.min(window.innerWidth, window.innerHeight) * 0.18) {
      this.say('Make the cut longer: one confident swipe right across the cloud.');
      return;
    }
    if (d > reach) {
      this.say('Close. A p orbital\'s flat node runs <span class="hl">through the nucleus itself</span>, so the cut has to as well.');
      return;
    }
    this.performCut(this.scene.screenPerpAxis(b.x - a.x, b.y - a.y));
  }

  private async performCut(axis: Axis): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    sfx.sliceSound();
    await this.scene.cut(axis);
    if (!this.save.discoveredShapes.includes('p')) this.save.discoveredShapes.push('p');
    writeSave(this.save);
    this.mode = 'build';
    this.busy = false;
    this.assistAxis = axis;
    this.refresh();
    this.scene.setGhost(axisOrbital(axis));
    this.say(`You discovered the <span class="hl">2p orbital</span>: one flat node splits the cloud into two lobes. There are three of them, along x, y and z, and each holds two electrons. Now launch the electron; the lobe you aim along is the one it fills.`);
  }

  // ---- firing electrons --------------------------------------------------------------

  private async fire(shot: Shot): Promise<void> {
    if (this.busy) return;
    if (this.needsSlice()) return this.enterSlice();
    const { from, reading, axis, spin, power } = shot;
    this.busy = true;
    this.renderAssist();

    if (!shot.onTarget || reading.kind === 'between') {
      this.lost++;
      sfx.missSound();
      await this.scene.flyby(from, shot.toward);
      if (shot.note) {
        this.say(shot.note(false));
      } else if (!shot.onTarget) {
        this.say('<span class="warn">Missed.</span> The electron flew past the atom and is lost.');
      } else if (reading.kind === 'between') {
        const where = reading.below === null ? `short of the n=${reading.above} band`
          : reading.above === null ? `past the n=${reading.below} band`
          : `between n=${reading.below} and n=${reading.above}`;
        this.say(`<span class="warn">Not caught.</span> Its energy fell ${where}, and an atom only holds electrons at its allowed levels, so it passed straight through.`);
      }
      this.busy = false;
      this.refresh();
      return;
    }

    if (reading.kind === 'free') {
      this.lost++;
      if (electronCount(this.atom) === 0) {
        sfx.bounceSound();
        await this.scene.bounce(from);
        this.say(shot.note?.(true) ?? '<span class="bad">Too fast to catch.</span> A bare nucleus cannot hold an electron moving that quickly.');
      } else {
        await this.scene.launch(from, power);
        sfx.ioniseSound();
        void this.scene.ionise();
        this.atom = removeLastElectron(this.atom);
        this.say(shot.note?.(false) ?? '<span class="bad">Too much energy.</span> The electron struck the atom hard enough to knock one free, so both are lost.');
      }
      this.busy = false;
      this.refresh();
      return;
    }

    const outcome = resolvePlacement(this.atom, { axis, spin });
    if (!outcome) {
      this.busy = false;
      return;
    }
    if (outcome.kind === 'bounced') {
      this.lost++;
      sfx.bounceSound();
      await this.scene.bounce(from);
      this.say(outcome.reason === 'pauli'
        ? '<span class="warn">Refused.</span> This orbital already holds an electron spinning that way, and two electrons in one orbital must spin opposite ways. ' + this.spinHint()
        : '<span class="warn">That lobe is full.</span> Each orbital holds two electrons at most. Aim along another axis.');
      this.busy = false;
      this.refresh();
      return;
    }

    if (reading.kind !== 'level') {
      this.busy = false;
      return;
    }
    const level = reading.n;
    const centred = reading.precision >= 1 - CENTRE;
    await this.scene.launch(from, power);
    sfx.captureSound();
    if (centred) sfx.centreSound();
    const photons = cascade(this.atom, level);
    const lines = (this.save.photons[this.z] ??= []);
    const before = new Set(lines);
    const parts: string[] = [];
    for (const [i, ph] of photons.entries()) {
      const hex = wavelengthToHex(ph.nm);
      const visible = band(ph.nm) === 'visible';
      void this.scene.photon(hex, visible);
      sfx.photonSound(ph.ev);
      const rounded = Math.round(ph.nm * 10) / 10;
      if (!lines.includes(rounded)) lines.push(rounded);
      this.renderSpectrum();
      parts.push(`<span style="color:${visible ? hex : 'var(--muted)'}">${formatNm(ph.nm)}${visible ? '' : ` ${bandLabel(ph.nm)}`}</span>`);
      if (i < photons.length - 1) await wait(this.save.settings.reducedMotion ? 80 : 220);
    }
    this.atom = applyPlacement(this.atom, outcome.orbital, outcome.spin);
    writeSave(this.save);
    this.busy = false;
    this.refresh();

    const fresh = photons.filter((ph) => !before.has(Math.round(ph.nm * 10) / 10)).length;
    const light = `${centred ? '<span class="hl">Dead centre.</span> ' : ''}Caught at n=${level}. Light released: ${parts.join(', ')}${fresh ? ` <span class="hl">(${fresh} new)</span>` : ''}.`;
    if (outcome.sour === 'hund-pair') {
      sfx.sourSound();
      this.say(`<span class="warn">A sour note.</span> You paired electrons while an empty lobe was free. Electrons repel, so in the lowest-energy state they spread out first (Hund\'s rule). Undo to try another lobe. ${light}`);
    } else if (outcome.sour === 'hund-spin') {
      sfx.sourSound();
      this.say(`<span class="warn">A sour note.</span> Lone electrons in a sub-shell line their spins up in the lowest-energy state (Hund\'s rule). Undo, then ${this.spinHint().charAt(0).toLowerCase()}${this.spinHint().slice(1)} ${light}`);
    } else {
      if (outcome.orbital.startsWith('2p')) sfx.harmonySound();
      if (electronCount(this.atom) < this.z) this.say(`${light} ${this.guidance()}`);
    }
    if (electronCount(this.atom) === this.z) this.finish();
  }

  private undo(): void {
    if (this.busy || this.atom.history.length === 0 || this.mode === 'slice') return;
    this.atom = removeLastElectron(this.atom);
    this.undos++;
    this.mode = 'build';
    this.refresh();
    this.say(`Electron removed. Undoing is free, but a flawless build uses none. ${this.guidance()}`);
  }

  private finish(): void {
    this.mode = 'done';
    const ground = isGroundState(this.atom);
    const prev = this.save.built[this.z];
    const flawless = ground && this.lost === 0 && this.undos === 0;
    this.save.built[this.z] = { perfect: (prev?.perfect ?? false) || ground, flawless: (prev?.flawless ?? false) || flawless, colour: prev?.colour };
    const stableA = element(this.z).commonA;
    const key = isotopeKey(this.z, stableA);
    this.save.isotopes[key] = { ...this.save.isotopes[key], collected: true };
    writeSave(this.save);
    this.scene.celebrate();
    sfx.completeSound();
    this.refresh();
    const name = element(this.z).name;
    this.say(flawless
      ? `<span class="hl">${name} complete and flawless:</span> ground state, nothing lost, nothing undone.`
      : ground
        ? `<span class="hl">${name} complete, in its true ground state.</span> ${this.lost ? `${this.lost} electron${this.lost === 1 ? '' : 's'} lost` : 'Undo used'}, so not flawless this time.`
        : `<span class="hl">${name} complete.</span> It is in an excited state; rebuild it with spread-out, aligned 2p electrons for a perfect build.`);
    window.setTimeout(() => this.showCard(this.z, true), this.save.settings.reducedMotion ? 300 : 1200);
  }

  // ---- isotopes and decay ----------------------------------------------------------

  private processDecays(initial: boolean): void {
    const now = Date.now();
    const due = this.save.specimens.filter((s) => s.decayAt <= now);
    if (!due.length) {
      if (!$('modal').hidden && this.modalCleanup === null) this.refreshBenchTimers();
      return;
    }
    this.save.specimens = this.save.specimens.filter((s) => s.decayAt > now);
    for (const s of due) {
      const iso = findIsotope(s.z, s.a)!;
      const res = decayProducts(iso)!;
      const d = res.daughter;
      const daughter = findIsotope(d.z, d.a);
      const life = formatDuration((s.decayAt - s.createdAt) / 1000);
      let extra = '';
      if (daughter && isStable(daughter)) {
        const key = isotopeKey(d.z, d.a);
        const fresh = !this.save.isotopes[key]?.collected;
        this.save.isotopes[key] = { ...this.save.isotopes[key], collected: true };
        extra = fresh ? ` ${isoName(d.z, d.a)} joins your collection.` : '';
      }
      const text = `${initial ? 'While you were away, your' : 'Your'} ${isoName(s.z, s.a)} atom decayed into ${isoName(d.z, d.a)} after ${life} (${MODE_LABEL[iso.mode!]}).${extra}`;
      this.save.log.unshift({ at: s.decayAt, text });
      this.toast(text);
      sfx.decaySound();
    }
    this.save.log = this.save.log.slice(0, 50);
    writeSave(this.save);
    if (this.benchZ !== null) this.showBench(this.benchZ);
  }

  private benchZ: number | null = null;

  private refreshBenchTimers(): void {
    document.querySelectorAll<HTMLElement>('[data-born]').forEach((el) => {
      const born = Number(el.dataset.born);
      el.textContent = `Alive for ${formatDuration(Math.max(1, (Date.now() - born) / 1000))}. It could decay at any moment.`;
    });
  }

  private buildIsotope(iso: Isotope): void {
    const key = isotopeKey(iso.z, iso.a);
    if (isStable(iso)) {
      this.save.isotopes[key] = { ...this.save.isotopes[key], collected: true };
      writeSave(this.save);
      sfx.harmonySound();
      this.showBench(iso.z);
      return;
    }
    if (isFleeting(iso)) {
      this.showWitness(iso);
      return;
    }
    const now = Date.now();
    const life = sampleLifetime(iso.halfLife!) * 1000;
    this.save.specimens.push({ id: `${key}-${now}`, z: iso.z, a: iso.a, createdAt: now, decayAt: now + life });
    this.save.isotopes[key] = { ...this.save.isotopes[key], collected: true };
    writeSave(this.save);
    sfx.captureSound();
    this.showBench(iso.z);
  }

  // ---- modals -----------------------------------------------------------------

  private openModal(html: string, cleanup: (() => void) | null = null): HTMLElement {
    this.modalCleanup?.();
    this.modalCleanup = cleanup;
    const sheet = $('sheet');
    sheet.innerHTML = html;
    $('modal').hidden = false;
    sheet.scrollTop = 0;
    return sheet;
  }

  private closeModal(): void {
    this.modalCleanup?.();
    this.modalCleanup = null;
    this.benchZ = null;
    $('modal').hidden = true;
  }

  private showIntro(): void {
    const sheet = this.openModal(`
      <h2>Atomos</h2>
      <p class="muted">Feel prototype · hydrogen to neon</p>
      <p>Every atom here is built from real rules. Electrons are not little planets: each one is a cloud of probability, and its shape comes from the maths of waves.</p>
      <p><b>Catch electrons.</b> An atom only holds electrons at its allowed energy levels. A bound electron is a wave that has to join up with itself round the nucleus, so only whole numbers of waves fit: level n holds n. Caught electrons fall inward, releasing real light. Hydrogen caught at n=3 gives its true red line.</p>
      <p><b>Three ways to launch</b>, switchable at the bottom of the screen: <b>Charge</b> (hold, and let go on a rung of the ladder), <b>Pulse</b> (tap n beats in time to reach level n), or <b>Tune</b> (turn a dial to a line the atom absorbs at, then tap to fire).</p>
      <p><b>Miss and it is lost.</b> Let go off a rung, tap off the beat or fire off a line and the electron passes through. Too much energy knocks an electron out. Higher levels release more light but are harder to hit.</p>
      <p><b>Three goals per element:</b> build it; build it <b>flawlessly</b> (ground state, nothing lost, no undo); and find <b>every line</b> of its light, shown as gaps in the spectrum strip.</p>
      <p class="muted">Two fingers (or the right mouse button) turn the atom. If dragging is hard, switch on <b>Assisted controls</b> in Settings to play with buttons only.</p>
      <div class="actions"><button class="primary" id="intro-go">Build hydrogen</button><button class="secondary" id="intro-assist">Use assisted controls</button></div>`);
    sheet.querySelector<HTMLButtonElement>('#intro-go')!.onclick = () => this.closeModal();
    sheet.querySelector<HTMLButtonElement>('#intro-assist')!.onclick = () => {
      this.save.settings.assist = true;
      writeSave(this.save);
      this.applySettings();
      this.closeModal();
      this.say(this.guidance());
    };
  }

  private showCard(z: number, justBuilt: boolean): void {
    const el = element(z);
    const built = this.save.built[z];
    const colour = this.colourFor(z);
    const lines = this.save.photons[z] ?? [];
    const stable = isotopesOf(z).filter(isStable);
    const stableHave = stable.filter((i) => this.save.isotopes[isotopeKey(z, i.a)]?.collected).length;
    const visibleLines = lines.filter((nm) => band(nm) === 'visible').length;
    const reachable = reachableLines(z);
    const found = reachable.filter((nm) => lines.includes(nm)).length;
    const atom = this.atomForCard(z);
    const next = z < MAX_Z ? element(z + 1) : null;
    const palette = this.palette(z);
    const sheet = this.openModal(`
      <div class="card-head" style="--el:${colour}">
        <div class="card-sym"><small>${z}</small>${el.symbol}</div>
        <div>
          <h2>${el.name}</h2>
          <div class="muted">${FAMILY_NAMES[el.family]} · ${configuration(atom)}</div>
        </div>
      </div>
      <div class="tiers">
        <span class="tier ${built ? 'on' : ''}">Discovered</span>
        <span class="tier ${built?.perfect ? 'on' : ''}">Perfect ground state</span>
        <span class="tier ${built?.flawless ? 'on' : ''}">Flawless build</span>
        <span class="tier ${stableHave === stable.length && stable.length ? 'on' : ''}">Stable isotopes ${stableHave}/${stable.length}</span>
        <span class="tier ${found === reachable.length ? 'on' : ''}">Light ${found}/${reachable.length} lines</span>
      </div>
      ${justBuilt && built && !built.perfect ? '<p class="muted">Not yet perfect: in the ground state, lone 2p electrons sit in separate lobes with matching spins.</p>' : ''}
      ${built && found < reachable.length ? `<p class="muted">${reachable.length - found} line${reachable.length - found === 1 ? '' : 's'} still to find. Each electron caught higher up cascades through more levels, so the narrow top bands hold the rarest light.</p>` : ''}
      ${built && !built.flawless ? '<p class="muted">Flawless: the ground state with no electron lost and no undo.</p>' : ''}
      <h3>Facts</h3>
      <ul class="facts">${el.facts.map((f) => `<li>${f}</li>`).join('')}</ul>
      ${el.famousLine ? `<h3>Signature light</h3><div class="line-row"><span class="swatch" style="background:${wavelengthToHex(el.famousLine.nm)};color:${wavelengthToHex(el.famousLine.nm)}"></span><span>${el.famousLine.nm} nm · ${el.famousLine.label}</span></div>
        <p class="muted">This line comes from the neutral atom's outer electron hopping between excited states. The lines you collect while building come from capturing electrons one at a time${visibleLines ? '' : ', and most of them are invisible ultraviolet or X-rays'}.</p>` : ''}
      <h3>Colour</h3>
      <p class="muted">Atoms have no colour at this scale, so paint yours. Your palette is the visible light you have released while building.</p>
      <div class="palette">${palette.map((c) => `<button style="--c:${c}" data-c="${c}" aria-label="Colour ${c}" aria-pressed="${c.toLowerCase() === colour.toLowerCase()}"></button>`).join('')}</div>
      <div class="actions">
        ${built && next && next.z <= MAX_Z ? `<button class="primary" id="card-next">${this.save.built[next.z] ? 'Rebuild' : 'Build'} ${next.name}</button>` : ''}
        ${built ? `<button class="secondary" id="card-iso">Isotopes</button>` : ''}
        ${built ? `<button class="secondary" id="card-rebuild">Rebuild ${el.name}</button>` : ''}
        <button class="secondary" id="card-close">Close</button>
      </div>`);
    sheet.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => (b.onclick = () => {
      if (!this.save.built[z]) return;
      this.save.built[z].colour = b.dataset.c;
      writeSave(this.save);
      if (z === this.z) {
        this.scene.setColour(b.dataset.c!);
        document.documentElement.style.setProperty('--el', b.dataset.c!);
      }
      this.showCard(z, false);
    }));
    sheet.querySelector<HTMLButtonElement>('#card-next')?.addEventListener('click', () => { this.closeModal(); this.start(z + 1); });
    sheet.querySelector<HTMLButtonElement>('#card-rebuild')?.addEventListener('click', () => { this.closeModal(); this.start(z); });
    sheet.querySelector<HTMLButtonElement>('#card-iso')?.addEventListener('click', () => this.showBench(z));
    sheet.querySelector<HTMLButtonElement>('#card-close')!.onclick = () => this.closeModal();
  }

  private atomForCard(z: number): Atom {
    if (z === this.z) return this.atom.history.length === z ? this.atom : this.groundAtom(z);
    return this.groundAtom(z);
  }

  private groundAtom(z: number): Atom {
    let a = newAtom(z);
    for (let i = 0; i < z; i++) {
      const r = resolvePlacement(a);
      if (r?.kind === 'placed') a = applyPlacement(a, r.orbital, r.spin);
    }
    return a;
  }

  private palette(z: number): string[] {
    const set = new Set<string>([SILVER, FAMILY_COLOURS[element(z).family], '#ffffff']);
    for (const lines of Object.values(this.save.photons)) {
      for (const nm of lines) if (band(nm) === 'visible') set.add(wavelengthToHex(Math.round(nm / 4) * 4));
    }
    return [...set].slice(0, 24);
  }

  private showBench(z: number): void {
    this.benchZ = z;
    const el = element(z);
    const rows = isotopesOf(z).map((iso) => {
      const key = isotopeKey(z, iso.a);
      const rec = this.save.isotopes[key];
      const live = this.save.specimens.filter((s) => s.z === z && s.a === iso.a);
      const n = iso.a - z;
      const life = iso.halfLife === undefined ? 'stable' : `half-life ${formatDuration(iso.halfLife)} · ${MODE_LABEL[iso.mode!]}`;
      let status = '';
      let btn = '';
      if (isStable(iso)) {
        status = rec?.collected ? '<span class="status good">In your collection, for good.</span>' : '';
        btn = rec?.collected ? '' : `<button class="secondary" data-build="${iso.a}">Build</button>`;
      } else if (isFleeting(iso)) {
        const w = rec?.witnessed ?? [];
        status = w.length ? `<span class="status good">Witnessed ${w.length}×. Shortest life: ${formatDuration(Math.min(...w.map((x) => x.lifetime)))}.</span>` : '<span class="status muted">Lives less than a second: it can only be witnessed, never kept.</span>';
        btn = `<button class="secondary" data-build="${iso.a}">${w.length ? 'Witness again' : 'Witness'}</button>`;
      } else {
        status = live.length
          ? live.map((s) => `<span class="status live" data-born="${s.createdAt}">Alive for ${formatDuration(Math.max(1, (Date.now() - s.createdAt) / 1000))}. It could decay at any moment.</span>`).join('')
          : rec?.collected ? '<span class="status muted">Decayed. Build another to keep one on display.</span>' : '';
        btn = live.length ? '' : `<button class="secondary" data-build="${iso.a}">Build</button>`;
      }
      return `<div class="iso"><span class="name">${el.name}-${iso.a}</span>${btn}<span class="meta">${z} p, ${n} n · ${life}</span>${iso.note ? `<span class="meta">${iso.note}</span>` : ''}${status}</div>`;
    }).join('');
    const sheet = this.openModal(`
      <h2>${el.name} isotopes</h2>
      <p class="muted">Same element, different numbers of neutrons. Unstable ones decay in real time: each atom you build has its own random lifetime, and the half-life is only the odds.</p>
      <div class="iso-list">${rows}</div>
      <p class="muted">In this prototype, isotopes build with one tap. In the full game you assemble each nucleus from protons and neutrons.</p>
      <div class="actions"><button class="secondary" id="bench-back">Back to ${el.name}</button></div>`);
    sheet.querySelectorAll<HTMLButtonElement>('[data-build]').forEach((b) => (b.onclick = () => this.buildIsotope(findIsotope(z, Number(b.dataset.build))!)));
    sheet.querySelector<HTMLButtonElement>('#bench-back')!.onclick = () => { this.benchZ = null; this.showCard(z, false); };
  }

  private showWitness(iso: Isotope): void {
    this.benchZ = null;
    const el = element(iso.z);
    const seed = Math.floor(Math.random() * 2 ** 31);
    const lifetime = sampleLifetime(iso.halfLife!);
    const factor = slowFactor(lifetime);
    const res = decayProducts(iso)!;
    const tracks = buildTracks(iso, seed);
    let raf = 0;
    const sheet = this.openModal(`
      <h2>Witnessing ${el.name}-${iso.a}</h2>
      <p class="muted">Half-life ${formatDuration(iso.halfLife!)}. It will never stay in your collection, but you can record its end.</p>
      <canvas class="witness-canvas" id="w-canvas"></canvas>
      <div class="witness-clock" id="w-clock"></div>
      <div id="w-result"></div>
      <div class="actions"><button class="secondary" id="w-back">Back to isotopes</button></div>`, () => cancelAnimationFrame(raf));
    const canvas = sheet.querySelector<HTMLCanvasElement>('#w-canvas')!;
    const dpr = Math.min(2, window.devicePixelRatio);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    const clock = sheet.querySelector<HTMLElement>('#w-clock')!;
    sheet.querySelector<HTMLButtonElement>('#w-back')!.onclick = () => this.showBench(iso.z);

    const shown = Math.min(lifetime * factor, 8); // seconds of screen time before it decays
    const t0 = performance.now();
    const trackTime = this.save.settings.reducedMotion ? 0.01 : 1.4;
    let decayed = false;
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t < shown) {
        drawWitness(canvas, tracks, 0, seed, true, t);
        const real = (t / shown) * lifetime;
        clock.textContent = factor > 1
          ? `Time since it formed: ${formatDuration(Math.max(real, 1e-30))} · slowed down 10${superscriptNum(Math.log10(factor))} times`
          : `Time since it formed: ${formatDuration(Math.max(real, 0.001))} · real time`;
      } else {
        const p = Math.min(1, (t - shown) / trackTime);
        drawWitness(canvas, tracks, p, seed, false, t);
        if (!decayed) {
          decayed = true;
          sfx.decaySound();
          clock.textContent = `It lived ${formatDuration(lifetime)}${factor > 1 ? ` (shown 10${superscriptNum(Math.log10(factor))} times slower)` : ''}.`;
          const key = isotopeKey(iso.z, iso.a);
          const rec = this.save.isotopes[key] ?? {};
          rec.witnessed = [...(rec.witnessed ?? []), { at: Date.now(), seed, lifetime }].slice(-20);
          this.save.isotopes[key] = rec;
          const d = res.daughter;
          const daughter = findIsotope(d.z, d.a);
          if (daughter && isStable(daughter)) this.save.isotopes[isotopeKey(d.z, d.a)] = { ...this.save.isotopes[isotopeKey(d.z, d.a)], collected: true };
          writeSave(this.save);
          const chain = daughter && !isStable(daughter) && daughter.halfLife! < 1e-9 ? `, which itself split apart almost instantly` : '';
          sheet.querySelector<HTMLElement>('#w-result')!.innerHTML = `<span class="stamp">Witnessed</span>
            <p>${MODE_LABEL[iso.mode!]} into ${isoName(d.z, d.a)}${chain}. Charged particles leave curling trails of bubbles in the magnetic field; neutral ones leave nothing at all. This trace is saved to your record.</p>`;
        }
        if (p >= 1) return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  private showMap(): void {
    let raf = 0;
    let selected: number | null = null;
    const front = frontier(this.save, MAX_Z);
    const sheet = this.openModal(`
      <h2>Your table</h2>
      <p class="muted">All 118 elements on one spiral, in order of proton number. This prototype covers the first ten.</p>
      <canvas class="map-canvas" id="map"></canvas>
      <div class="map-info" id="map-info"></div>
      <div class="actions"><button class="secondary" id="map-close">Close</button></div>`, () => cancelAnimationFrame(raf));
    const canvas = sheet.querySelector<HTMLCanvasElement>('#map')!;
    const dpr = Math.min(2, window.devicePixelRatio);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientWidth * dpr;
    const size = canvas.clientWidth;
    const nodes: SpiralNode[] = layoutSpiral(
      size,
      (z) => (this.save.built[z] ? 'built' : (z === front || this.save.settings.unlockAll) && z <= MAX_Z ? 'frontier' : z <= MAX_Z ? 'locked' : 'future'),
      (z) => (z <= MAX_Z ? this.colourFor(z) : SILVER),
    );
    const info = sheet.querySelector<HTMLElement>('#map-info')!;
    const describe = (n: SpiralNode) => {
      if (n.z > MAX_Z) {
        info.innerHTML = `<p><b>${n.symbol}</b>, element ${n.z}. Beyond this prototype.</p>`;
        return;
      }
      const el = element(n.z);
      if (n.state === 'built') {
        info.innerHTML = `<p><b>${el.name}</b>${this.save.built[n.z].perfect ? ', perfect' : ''}.</p><button class="primary" id="map-open">Open card</button>`;
        info.querySelector<HTMLButtonElement>('#map-open')!.onclick = () => this.showCard(n.z, false);
      } else if (n.state === 'frontier') {
        info.innerHTML = `<p><b>${n.z === front ? 'Next' : 'Unlocked for testing'}:</b> “${el.hint}”</p><button class="primary" id="map-build">Build ${el.name}</button>`;
        info.querySelector<HTMLButtonElement>('#map-build')!.onclick = () => { this.closeModal(); this.start(n.z); };
      } else {
        info.innerHTML = `<p>A silhouette, element ${n.z}. Build the elements before it first.</p>`;
      }
    };
    describe(nodes[front - 1]);
    selected = front;
    canvas.onclick = (e) => {
      const r = canvas.getBoundingClientRect();
      const hit = hitSpiral(nodes, e.clientX - r.left, e.clientY - r.top);
      if (hit) {
        selected = hit.z;
        describe(hit);
      }
    };
    const loop = (t: number) => {
      drawSpiral(canvas, nodes, t / 1000, selected);
      if (!this.save.settings.reducedMotion) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    sheet.querySelector<HTMLButtonElement>('#map-close')!.onclick = () => this.closeModal();
  }

  private showSettings(): void {
    const s = this.save.settings;
    const toggle = (key: keyof typeof s, title: string, help: string) => `
      <label class="toggle"><span>${title}<small>${help}</small></span><input type="checkbox" data-key="${key}" ${s[key] ? 'checked' : ''}></label>`;
    const choice = (key: keyof typeof s, title: string, help: string, options: [string, string][]) => `
      <div class="toggle"><span>${title}<small>${help}</small></span><span class="seg">${options.map(([v, label]) => `<button data-choice="${key}" data-value="${v}" aria-pressed="${s[key] === v}">${label}</button>`).join('')}</span></div>`;
    const sheet = this.openModal(`
      <h2>Settings</h2>
      ${toggle('assist', 'Assisted controls', 'Play with buttons and keys instead of dragging. Every launch lands dead centre in the band you choose.')}
      ${toggle('reducedMotion', 'Reduce motion', 'Calmer clouds, shorter animations, no auto-rotation.')}
      ${toggle('sound', 'Sound', 'Tones for captures, light and harmony.')}
      ${toggle('haptics', 'Vibration', 'Taps on supported phones.')}
      ${toggle('autoCore', 'Auto-fill cores', 'After building helium, heavier atoms start with its filled 1s shell.')}
      <h3>Launch feel</h3>
      ${choice('climb', 'Charge climb', 'How long a held press takes to reach the top of the ladder.', [['normal', 'normal'], ['slow', 'slow']])}
      ${choice('tempo', 'Pulse tempo', 'Beats per minute for the Pulse style.', [['slow', '75'], ['medium', '94'], ['brisk', '120']])}
      <h3>Testing</h3>
      ${toggle('unlockAll', 'Unlock every element', 'Build any element from the map without earning it, with the p orbital already discovered. For trying the launch styles on later atoms.')}
      <h3>How accurate is this?</h3>
      <p class="muted">Orbital shapes are sampled from the exact hydrogen-like wavefunctions, scaled for each atom with Slater's rules. Each capture releases the real ionisation energy (NIST data). Higher levels use the Rydberg formula, which is exact for one-electron atoms and approximate otherwise. Sub-shell splitting in the cascade is not modelled yet, and the cascade steps down one level at a time. Capture bands are a game rule: a real atom can catch a free electron at any energy and send the excess away as light, but here capture only happens near an allowed level, so you can feel that the levels are discrete. The nucleus is drawn about 10,000 times too large; at true scale it would be invisible.</p>
      <p class="muted">Pulse uses de Broglie's 1924 picture: a bound electron is a wave that must join up with itself round the nucleus, so level n holds n whole waves. It explains why levels are discrete and gives hydrogen's energies exactly, but it is the Bohr model: real orbitals are 3D clouds, not waves on a ring. Tune's dial shows the levels at their true spacing as fractions of the ionisation energy, which is why they crowd toward the top; the glow near a line stands in for resonance, the reason an atom absorbs only at its lines. Charge's ladder spaces the rungs evenly for playability, so it is not to scale. Flicks and swipes for spin are a game convention; spin is not literally rotation.</p>
      <h3>Progress</h3>
      <p class="muted">${Object.keys(this.save.built).length} of ${MAX_Z} elements built · ${ISOTOPES.filter((i) => this.save.isotopes[isotopeKey(i.z, i.a)]?.collected || this.save.isotopes[isotopeKey(i.z, i.a)]?.witnessed?.length).length} of ${ISOTOPES.length} isotopes found</p>
      <div class="actions"><button class="secondary" id="set-reset">Reset all progress</button><button class="primary" id="set-close">Done</button></div>`);
    sheet.querySelectorAll<HTMLInputElement>('input[data-key]').forEach((inp) => (inp.onchange = () => {
      (s as unknown as Record<string, boolean>)[inp.dataset.key!] = inp.checked;
      writeSave(this.save);
      this.applySettings();
      this.renderAssist();
      this.renderLadder(null);
      if (this.mode !== 'slice') this.say(this.guidance());
    }));
    sheet.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((b) => (b.onclick = () => {
      (s as unknown as Record<string, string>)[b.dataset.choice!] = b.dataset.value!;
      writeSave(this.save);
      this.showSettings();
    }));
    sheet.querySelector<HTMLButtonElement>('#set-close')!.onclick = () => this.closeModal();
    sheet.querySelector<HTMLButtonElement>('#set-reset')!.onclick = (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      if (b.dataset.confirm) {
        clearSave();
        this.save = defaultSave();
        this.closeModal();
        this.start(1);
        this.applySettings();
        this.showIntro();
      } else {
        b.dataset.confirm = '1';
        b.textContent = 'Tap again to erase everything';
      }
    };
  }

  private applySettings(): void {
    const s = this.save.settings;
    sfx.setSound(s.sound);
    sfx.setHaptics(s.haptics);
    this.scene.setReducedMotion(s.reducedMotion);
    this.renderAssist();
    this.ensureLoop();
  }

  private toast(text: string): void {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    $('toasts').appendChild(t);
    window.setTimeout(() => t.remove(), 7000);
  }
}

// ---- helpers -----------------------------------------------------------------

function segmentDistance(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Position on the spectrum strip: log scale from 0.5 nm (X-ray) to 2000 nm (infrared). */
function spectrumX(nm: number): number {
  const lo = Math.log10(0.5), hi = Math.log10(2000);
  const v = Math.log10(Math.min(2000, Math.max(0.5, nm)));
  // Stretch the visible band so its colours are readable.
  const segs: [number, number, number, number][] = [
    [lo, Math.log10(10), 0, 0.2],
    [Math.log10(10), Math.log10(380), 0.2, 0.45],
    [Math.log10(380), Math.log10(750), 0.45, 0.85],
    [Math.log10(750), hi, 0.85, 1],
  ];
  for (const [a, b, x0, x1] of segs) if (v <= b) return x0 + ((v - a) / (b - a)) * (x1 - x0);
  return 1;
}

function formatNm(nm: number): string {
  return nm >= 100 ? `${Math.round(nm)} nm` : nm >= 1 ? `${nm.toFixed(1)} nm` : `${nm.toFixed(3)} nm`;
}

function isoName(z: number, a: number): string {
  return z >= 1 && z <= ELEMENTS.length ? `${element(z).name.toLowerCase()}-${a}` : `element ${z}-${a}`;
}

function superscriptNum(n: number): string {
  const map: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  return String(Math.round(n)).split('').map((c) => map[c] ?? c).join('');
}

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

