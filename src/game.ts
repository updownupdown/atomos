import { AtomScene, type ScreenPoint } from './render/scene';
import { applyPlacement, configuration, electronCount, newAtom, resolvePlacement, type Atom } from './core/physics';
import { FAMILY_COLOURS, FAMILY_NAMES, MAX_Z, element } from './core/elements';
import {
  MODE_LABEL, decayProducts, findIsotope, formatDuration, isFleeting, isStable,
  isotopeKey, isotopesOf, sampleLifetime, type Isotope,
} from './core/isotopes';
import { frontier, loadSave, writeSave, type SaveData } from './core/save';
import { wavelengthToHex } from './render/colour';
import { buildTracks, drawWitness, slowFactor } from './ui/witness';
import { MERGE_UP_TO, mergeLevel, ringsLevel, slidingLevel } from './puzzles/levels';
import { MergeView } from './puzzles/mergeView';
import { RingsView } from './puzzles/ringsView';
import { SlidingView } from './puzzles/slidingView';
import { type Area, type PuzzleView } from './puzzles/view';
import { puzzleType } from './puzzles/catalogue';
import { closeModal, modalOpen, openModal } from './ui/modal';
import * as sfx from './audio';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Droplet silver: the default electron colour until the player tints an element. */
const SILVER = '#e8e2d4';
/** Paint choices for a built atom. */
const PAINTS = [SILVER, '#ffffff', '#9fd0ff', '#5f8ae0', '#2ea57a', '#9fc98a', '#e6b04a', '#e0503a', '#d68ad8', '#a865d6'];

type Stage = 'nucleus' | 'shells' | 'done';

const STAGES: { id: Stage; label: string }[] = [
  { id: 'nucleus', label: 'Nucleus' },
  { id: 'shells', label: 'Shells' },
];

export class Game {
  private save: SaveData = loadSave();
  private scene: AtomScene;
  private z = 1;
  private atom: Atom = newAtom(1);
  private neutrons = 0;
  private stage: Stage = 'nucleus';
  private puzzle: PuzzleView | null = null;
  private busy = false;
  private overlay = $<HTMLCanvasElement>('overlay');
  private modalCleanup: (() => void) | null = null;
  private loopRaf = 0;
  private pointerId: number | null = null;
  /** Whether the nucleus puzzle was solved without a spoiled fusion. */
  private nucleusClean = true;
  private ringsClean = true;
  private shownHint = '';
  private paused = false;

  constructor(private hooks: { onElement?: (z: number) => void } = {}) {
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

  /** Open the puzzles for an element, from the app shell. */
  openElement(z: number): void {
    this.start(Math.min(MAX_Z, Math.max(1, z)));
    this.resizeOverlay();
    window.dispatchEvent(new Event('resize'));
  }

  get currentZ(): number { return this.z; }

  /** The screen is hidden: stop drawing until resume(). */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    window.dispatchEvent(new Event('resize'));
    this.resizeOverlay();
    this.ensureLoop();
  }

  /** Settings changed in the global sheet: re-read them. */
  reloadSettings(): void {
    this.save.settings = loadSave().settings;
    this.applySettings();
  }


  private start(z: number): void {
    this.z = z;
    this.atom = newAtom(z);
    this.neutrons = element(z).commonA - z;
    this.busy = false;
    this.nucleusClean = true;
    this.ringsClean = true;
    this.hooks.onElement?.(z);
    const colour = this.colourFor(z);
    this.scene.setColour(colour);
    document.documentElement.style.setProperty('--el', colour);
    this.scene.setAtom(this.atom, this.neutrons, { pDiscovered: true });
    // A lone proton has nothing to fuse: hydrogen starts at its shells.
    this.enter(z === 1 ? 'shells' : 'nucleus');
  }

  private enter(stage: Stage): void {
    this.stage = stage;
    this.shownHint = '';
    const reduced = this.save.settings.reducedMotion;
    if (stage === 'nucleus') this.puzzle = this.z <= MERGE_UP_TO ? new MergeView(mergeLevel(this.z), reduced) : new SlidingView(slidingLevel(this.z), reduced);
    else if (stage === 'shells') this.puzzle = new RingsView(ringsLevel(this.z), reduced);
    else this.puzzle = null;
    document.body.classList.toggle('puzzling', this.puzzle !== null);
    document.body.classList.toggle('stage-nucleus', stage === 'nucleus');
    this.refresh();
    this.ensureLoop();
  }

  private colourFor(z: number): string {
    return this.save.built[z]?.colour ?? SILVER;
  }

  private refresh(): void {
    const el = element(this.z);
    $('badge-z').textContent = String(el.z);
    $('badge-sym').textContent = el.symbol;
    $('badge-name').textContent = el.name;
    $('badge-config').textContent = this.stage === 'nucleus' ? `${el.z} p · ${this.neutrons} n` : configuration(this.atom);
    $('edge').textContent = `ATOMOS 400 ▸ ${el.symbol.toUpperCase()} ${el.z} ▸ PLATE ${String(el.z).padStart(4, '0')}`;
    this.renderStage();
    ($('btn-undo') as HTMLButtonElement).disabled = !this.puzzle?.canUndo() || this.busy;
    ($('btn-restart') as HTMLButtonElement).disabled = this.puzzle === null || this.busy;
    this.sayHint();
  }

  private renderStage(): void {
    const box = $('stage');
    const p = this.puzzle;
    const pips = STAGES.map((s, i) => {
      const done = this.stage === 'done' || i < STAGES.findIndex((x) => x.id === this.stage);
      const on = s.id === this.stage;
      return `<span class="pip ${done ? 'done' : on ? 'on' : ''}" title="${s.label}"></span>`;
    }).join('');
    const label = this.stage === 'done' ? 'Built' : STAGES.find((s) => s.id === this.stage)!.label;
    const count = p ? `${p.moves} move${p.moves === 1 ? '' : 's'}${p.par !== null ? ` · par ${p.par}` : ''}` : '';
    box.innerHTML = `${pips}<span class="stage-name">${label}</span><span class="stage-count">${count}</span>`;
  }

  private sayHint(): void {
    const p = this.puzzle;
    const text = p ? p.hint() : '';
    if (text === this.shownHint) return;
    this.shownHint = text;
    $('message').innerHTML = text;
  }

  private say(html: string): void {
    this.shownHint = html;
    $('message').innerHTML = html;
  }

  // ---- the puzzle loop --------------------------------------------------------------

  private area(): Area {
    const top = $('stage').getBoundingClientRect().bottom + 8;
    const bottom = $('message').getBoundingClientRect().top - 8;
    const w = window.innerWidth;
    const narrow = w < 900;
    // On wide screens the puzzle keeps to a column so the atom can sit beside it.
    const colW = narrow ? w - 24 : Math.min(560, w * 0.5);
    const x = narrow ? 12 : (w - colW) / 2;
    return { x, y: top, w: colW, h: Math.max(200, bottom - top) };
  }

  private ensureLoop(): void {
    if (!this.loopRaf && this.puzzle) this.loopRaf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number): void {
    this.loopRaf = 0;
    if (this.paused) return;
    const p = this.puzzle;
    if (!p) {
      this.clearOverlay();
      return;
    }
    const ctx = this.overlayCtx();
    p.draw(ctx, this.area(), now);
    this.renderStage();
    ($('btn-undo') as HTMLButtonElement).disabled = !p.canUndo() || this.busy;
    this.sayHint();
    if (p.won && !this.busy) {
      void this.stageSolved();
      return;
    }
    this.loopRaf = requestAnimationFrame((t) => this.frame(t));
  }

  private async stageSolved(): Promise<void> {
    const p = this.puzzle!;
    this.busy = true;
    const reduced = this.save.settings.reducedMotion;
    // Let the winning board show for a beat.
    const hold = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (t: number) => {
        p.draw(this.overlayCtx(), this.area(), t);
        if (t - hold > (reduced ? 200 : 900)) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    if (this.stage === 'nucleus') {
      this.nucleusClean = p.clean;
      sfx.harmonySound();
      this.puzzle = null;
      document.body.classList.remove('puzzling', 'stage-nucleus');
      this.clearOverlay();
      this.scene.setAtom(this.atom, this.neutrons, { pDiscovered: true });
      this.say(`<span class="hl">${element(this.z).name}'s nucleus:</span> ${this.z} proton${this.z === 1 ? '' : 's'} and ${this.neutrons} neutron${this.neutrons === 1 ? '' : 's'}. Now its electrons.`);
      await wait(reduced ? 400 : 1600);
      this.busy = false;
      this.enter('shells');
      return;
    }
    this.ringsClean = p.clean;
    this.puzzle = null;
    document.body.classList.remove('puzzling');
    this.clearOverlay();
    // Each electron settles into its orbital in order.
    for (let i = 0; i < this.z; i++) {
      const r = resolvePlacement(this.atom);
      if (r?.kind !== 'placed') break;
      this.atom = applyPlacement(this.atom, r.orbital, r.spin);
      this.scene.setAtom(this.atom, this.neutrons, { pDiscovered: true });
      sfx.captureSound();
      $('badge-config').textContent = configuration(this.atom);
      await wait(reduced ? 60 : 220);
    }
    this.busy = false;
    this.finish();
  }

  private finish(): void {
    this.stage = 'done';
    const prev = this.save.built[this.z];
    const flawless = this.nucleusClean && this.ringsClean;
    this.save.built[this.z] = { flawless: (prev?.flawless ?? false) || flawless, colour: prev?.colour };
    const key = isotopeKey(this.z, element(this.z).commonA);
    this.save.isotopes[key] = { ...this.save.isotopes[key], collected: true };
    writeSave(this.save);
    this.scene.celebrate();
    sfx.completeSound();
    this.refresh();
    const name = element(this.z).name;
    this.say(flawless
      ? `<span class="hl">${name}, flawless:</span> nothing spoiled, shells settled at par.`
      : `<span class="hl">${name} complete.</span> ${!this.nucleusClean ? 'A fusion overshot along the way' : 'The shells took more turns than par'}; rebuild for a flawless one.`);
    window.setTimeout(() => this.showCard(this.z, true), this.save.settings.reducedMotion ? 300 : 1200);
  }

  // ---- input -----------------------------------------------------------------

  private bindInput(): void {
    const canvas = this.overlay;
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', () => this.onCancel());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    $('btn-undo').onclick = () => this.undo();
    $('btn-restart').onclick = () => this.restartPuzzle();
    $('btn-why').onclick = () => this.showWhy();
    $('badge').onclick = () => this.showCard(this.z, false);
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('blur', () => this.onCancel());
  }

  private point(e: PointerEvent): ScreenPoint {
    return { x: e.clientX, y: e.clientY };
  }

  private onDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!this.puzzle || this.busy || this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.overlay.setPointerCapture(e.pointerId);
    this.puzzle.down(this.point(e));
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId || !this.puzzle) return;
    this.puzzle.move(this.point(e));
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.puzzle?.up(this.point(e));
    this.ensureLoop();
  }

  private onCancel(): void {
    this.pointerId = null;
    this.puzzle?.cancel();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.paused || $('app').hidden || modalOpen()) return;
    if (e.key === 'u' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) return this.undo();
    if (e.key === 'r' && !e.ctrlKey && !e.metaKey) return this.restartPuzzle();
    if (this.puzzle && !this.busy && this.puzzle.key(e)) {
      e.preventDefault();
      this.ensureLoop();
    }
  }

  private undo(): void {
    if (this.busy || !this.puzzle?.undo()) return;
    this.refresh();
    this.ensureLoop();
  }

  private restartPuzzle(): void {
    if (this.busy || !this.puzzle) return;
    this.puzzle.restart();
    this.refresh();
    this.ensureLoop();
  }

  // ---- overlay drawing ------------------------------------------------------------

  private resizeOverlay(): void {
    const dpr = Math.min(2, window.devicePixelRatio);
    this.overlay.width = window.innerWidth * dpr;
    this.overlay.height = window.innerHeight * dpr;
    this.ensureLoop();
  }

  private clearOverlay(): void {
    const ctx = this.overlay.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  private overlayCtx(): CanvasRenderingContext2D {
    const ctx = this.overlay.getContext('2d')!;
    const dpr = this.overlay.width / window.innerWidth;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    return ctx;
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
    this.modalCleanup = cleanup;
    return openModal(html, () => { this.modalCleanup = null; this.benchZ = null; cleanup?.(); });
  }

  private closeModal(): void {
    closeModal();
  }

  private showIntro(): void {
    const sheet = this.openModal(`
      <h2>Atomos</h2>
      <p class="muted">Prototype · hydrogen to neon</p>
      <p>Every atom is two puzzles. <b>Merge</b> the nucleus: swipe to slide light nuclei together until they add up to the one you need. Then settle the <b>Shells</b>: turn the rings and hop electrons through the gate until every socket is lit.</p>
      <p>No timers, no reading required. The microscope explains the science behind each puzzle, if you want it.</p>
      <div class="actions"><button class="primary" id="intro-go">Build hydrogen</button></div>`);
    sheet.querySelector<HTMLButtonElement>('#intro-go')!.onclick = () => this.closeModal();
  }

  private showWhy(): void {
    const html = puzzleType(this.stage === 'nucleus' ? (this.z <= MERGE_UP_TO ? 'merge' : 'sliding') : 'rings').science!(this.z);
    const sheet = this.openModal(`${html}<div class="actions"><button class="primary" id="why-close">Back to the puzzle</button></div>`);
    sheet.querySelector<HTMLButtonElement>('#why-close')!.onclick = () => this.closeModal();
  }

  private showCard(z: number, justBuilt: boolean): void {
    const el = element(z);
    const built = this.save.built[z];
    const colour = this.colourFor(z);
    const stable = isotopesOf(z).filter(isStable);
    const stableHave = stable.filter((i) => this.save.isotopes[isotopeKey(z, i.a)]?.collected).length;
    const atom = this.groundAtom(z);
    const next = z < MAX_Z ? element(z + 1) : null;
    const sheet = this.openModal(`
      <div class="card-head" style="--el:${colour}">
        <div class="card-sym"><small>${z}</small>${el.symbol}</div>
        <div>
          <h2>${el.name}</h2>
          <div class="muted">${FAMILY_NAMES[el.family]} · ${configuration(atom)}</div>
        </div>
      </div>
      <div class="tiers">
        <span class="tier ${built ? 'on' : ''}">Built</span>
        <span class="tier ${built?.flawless ? 'on' : ''}">Flawless</span>
        <span class="tier ${stableHave === stable.length && stable.length ? 'on' : ''}">Stable isotopes ${stableHave}/${stable.length}</span>
      </div>
      ${justBuilt && built && !built.flawless ? '<p class="muted">Flawless: no fusion past the target, and the shells settled in par or fewer turns.</p>' : ''}
      <h3>Facts</h3>
      <ul class="facts">${el.facts.map((f) => `<li>${f}</li>`).join('')}</ul>
      ${el.famousLine ? `<h3>Signature light</h3><div class="line-row"><span class="swatch" style="background:${wavelengthToHex(el.famousLine.nm)};color:${wavelengthToHex(el.famousLine.nm)}"></span><span>${el.famousLine.nm} nm · ${el.famousLine.label}</span></div>` : ''}
      <h3>Colour</h3>
      <p class="muted">Atoms have no colour at this scale, so paint yours.</p>
      <div class="palette">${PAINTS.map((c) => `<button style="--c:${c}" data-c="${c}" aria-label="Colour ${c}" aria-pressed="${c.toLowerCase() === colour.toLowerCase()}"></button>`).join('')}</div>
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

  private groundAtom(z: number): Atom {
    let a = newAtom(z);
    for (let i = 0; i < z; i++) {
      const r = resolvePlacement(a);
      if (r?.kind === 'placed') a = applyPlacement(a, r.orbital, r.spin);
    }
    return a;
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
      <p class="muted">In this prototype, isotopes build with one tap. Their own puzzles come next.</p>
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

  private applySettings(): void {
    const s = this.save.settings;
    sfx.setSound(s.sound);
    sfx.setHaptics(s.haptics);
    this.scene.setReducedMotion(s.reducedMotion);
  }

  private toast(text: string): void {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    $('toasts').appendChild(t);
    window.setTimeout(() => t.remove(), 7000);
  }

  // ---- hooks for automated checks ------------------------------------------------------

  /** Solves the current puzzle outright, for testing the flow from the console. */
  skipPuzzle(): void {
    if (!this.puzzle || this.busy) return;
    const p = this.puzzle as unknown as { state: unknown };
    if (this.stage === 'nucleus') {
      const s = p.state as { sockets?: number[]; filled?: number; blocks?: { x: number; len: number }[]; size?: number };
      if (s.sockets) s.filled = s.sockets.length;
      else if (s.blocks) s.blocks[0] = { ...s.blocks[0], x: s.size! - s.blocks[0].len };
    } else {
      const s = p.state as { rings: { cells: boolean[]; sockets: (string | null)[] }[] };
      for (const r of s.rings) r.cells = r.sockets.map((k) => k !== null);
    }
    this.ensureLoop();
  }
}

// ---- helpers -----------------------------------------------------------------

function isoName(z: number, a: number): string {
  return z >= 1 && z <= MAX_Z ? `${element(z).name.toLowerCase()}-${a}` : `element ${z}-${a}`;
}

function superscriptNum(n: number): string {
  const map: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  return String(Math.round(n)).split('').map((c) => map[c] ?? c).join('');
}

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));


export { FAMILY_COLOURS, electronCount };
