import { AtomScene, type ScreenPoint } from './render/scene';
import { applyPlacement, configuration, electronCount, newAtom, resolvePlacement, type Atom } from './core/physics';
import { FAMILY_COLOURS, MAX_Z, element } from './core/elements';
import {
  MODE_LABEL, decayProducts, findIsotope, formatDuration, isFleeting, isStable,
  isotopeKey, isotopesOf, sampleLifetime, type Isotope,
} from './core/isotopes';
import { frontier, loadSave, writeSave, type SaveData, type StepId } from './core/save';
import { atomProgress, isotopeCollected, segmentsOf, stepState, stepsOf, vaultIsotopes, type StepState } from './core/progress';
import { Detail } from './gallery/detail';
import { refreshModeProgress } from './ui/modebar';
import { buildTracks, drawWitness, slowFactor } from './ui/witness';
import { MERGE_UP_TO, mergeLevel, orbitalGridLevel, slidingLevel } from './puzzles/levels';
import { MergeView } from './puzzles/mergeView';
import { OrbitalGridView } from './puzzles/orbitalGridView';
import { SlidingView } from './puzzles/slidingView';
import { PackingView } from './puzzles/packingView';
import { newPacking, solvedState, type PackingState } from './puzzles/packing';
import { type Area, type PuzzleView } from './puzzles/view';
import { dealSeed, puzzleIcon, puzzleType, type PuzzleType } from './puzzles/catalog';
import { openRules } from './puzzles/rulesModal';
import { showWin } from './puzzles/winPanel';
import { closeModal, modalOpen, openModal } from './ui/modal';
import { createHoldButton, iconButton } from './ui/components';
import { icon } from './ui/icons';
import { scienceButton, setScienceHandler } from './ui/science';
import { elementAt, shortConfiguration } from './gallery/data';
import * as sfx from './audio';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Droplet silver: the default electron colour until the player tints an element. */
const SILVER = '#e8e2d4';
/** 'home' is the atom's Build page; the others are its puzzles: the nucleus, the electrons, and
 *  one Packing board per isotope in its vault ('iso-7' builds the isotope with mass number 7). */
type IsoStage = `iso-${number}`;
type Stage = 'home' | StepId | IsoStage;

const isIso = (s: Stage): s is IsoStage => s.startsWith('iso-');
const isoA = (s: IsoStage): number => Number(s.slice(4));

const STEP_LABEL: Record<StepId, string> = { nucleus: 'Nucleus', shells: 'Electrons' };

/** Where an atom first meets a new orbital shape: Field Lines will discover it there. */
const NEW_SHAPE: Record<number, string> = { 5: 'p', 21: 'd', 58: 'f' };
/** The first element of each period after the first: Slide Until Stop will open it. */
const PERIOD_START: Record<number, number> = { 3: 2, 11: 3, 19: 4, 37: 5, 55: 6, 87: 7 };

export class Game {
  private save: SaveData = loadSave();
  private scene: AtomScene;
  private z = 1;
  private atom: Atom = newAtom(1);
  private neutrons = 0;
  private stage: Stage = 'home';
  private puzzle: PuzzleView | null = null;
  /** A puzzle left part-way through for the Build page, to pick up again. */
  private suspended: Partial<Record<Stage, PuzzleView>> = {};
  /** The atom at the top of the Build page, drawn by the same view as the Atom screen's 3D tab. */
  private detail: Detail;
  private detailOn = false;
  private closeWin: () => void = () => {};
  private busy = false;
  private overlay = $<HTMLCanvasElement>('overlay');
  private modalCleanup: (() => void) | null = null;
  private loopRaf = 0;
  private pointerId: number | null = null;
  private shownHint = '';
  private paused = false;

  constructor(private hooks: { onElement?: (z: number) => void; onView?: (z: number) => void } = {}) {
    this.scene = new AtomScene($<HTMLCanvasElement>('atom'));
    this.detail = new Detail($<HTMLCanvasElement>('bh-atom'));
    this.detail.setRings(false);
    $('bh-sci').append(scienceButton());
    $('bh-paint').onclick = () => this.openPaint();
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
    this.syncDetail();
  }

  resume(): void {
    this.paused = false;
    this.registerScience();
    this.syncDetail();
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
    this.closeWin();
    this.z = z;
    this.neutrons = element(z).commonA - z;
    // A built atom shows with all its electrons; one still to build, as a bare nucleus.
    this.atom = this.save.built[z] ? fullAtom(z) : newAtom(z);
    this.busy = false;
    this.suspended = {};
    this.hooks.onElement?.(z);
    const colour = this.colourFor(z);
    this.scene.setColour(colour);
    document.documentElement.style.setProperty('--el', colour);
    this.scene.setAtom(this.atom, this.neutrons, { pDiscovered: true });
    this.detail.show(elementAt(z), false);
    this.tintDetail();
    $('build-home').scrollTop = 0;
    this.enter('home');
  }

  /** Shows the Build page or one of the atom's puzzles. A puzzle left part-way picks up where it was. */
  private enter(stage: Stage): void {
    this.closeWin();
    this.stage = stage;
    this.shownHint = '';
    if (stage === 'home') {
      this.puzzle = null;
    } else {
      const resumed = this.suspended[stage];
      this.puzzle = resumed ?? this.makePuzzle(stage);
      delete this.suspended[stage];
      if (stage === 'shells' && !resumed) {
        // The electrons go on fresh each time they are played.
        this.atom = newAtom(this.z);
        this.scene.setAtom(this.atom, this.neutrons, { pDiscovered: true });
      }
    }
    const home = stage === 'home';
    document.body.classList.toggle('puzzling', !home);
    document.body.classList.toggle('stage-nucleus', stage === 'nucleus');
    document.body.classList.toggle('build-home', home);
    $('build-home').hidden = !home;
    $('build-head').hidden = home;
    if (home) {
      this.clearOverlay();
      this.renderHome();
    } else {
      this.renderHead();
    }
    this.syncDetail();
    this.registerScience();
    this.refresh();
    this.ensureLoop();
  }

  /** The 3D atom on the Build page runs only while the page shows. */
  private syncDetail(): void {
    const on = !this.paused && this.stage === 'home';
    if (on === this.detailOn) return;
    this.detailOn = on;
    if (on) this.detail.start(); else this.detail.stop();
  }

  /** The player's paint on the 3D atom, once the gallery's view can take a tint. */
  private tintDetail(): void {
    const d = this.detail as Detail & { setTint?: (c: string | null) => void };
    d.setCollected(Boolean(this.save.built[this.z]));
    d.setTint?.(this.save.built[this.z]?.colour ?? null);
  }

  private makePuzzle(stage: Exclude<Stage, 'home'>): PuzzleView {
    const reduced = this.save.settings.reducedMotion;
    if (isIso(stage)) return new PackingView(newPacking(this.z, dealSeed('isotope', this.z, isoA(stage))), reduced);
    if (stage === 'shells') return new OrbitalGridView(orbitalGridLevel(this.z), reduced);
    return this.z <= MERGE_UP_TO ? new MergeView(mergeLevel(this.z), reduced) : new SlidingView(slidingLevel(this.z), reduced);
  }

  /** Back to the Build page, keeping a puzzle that is under way. */
  private toHome(): void {
    if (this.busy) return;
    if (this.stage !== 'home' && this.puzzle && this.puzzle.moves > 0 && !this.puzzle.won) this.suspended[this.stage] = this.puzzle;
    this.enter('home');
  }

  /** The microscope: how building works on the Build page, the science of a puzzle inside it. */
  private registerScience(): void {
    if (this.paused) return;
    if (this.stage === 'home') setScienceHandler(() => this.showBuildScience(), `How ${element(this.z).name} is built`);
    else setScienceHandler(() => this.showWhy(), 'The science behind this puzzle');
  }

  private stepState(z: number, id: StepId): StepState {
    return stepState(this.save, z, id);
  }

  private recordStep(id: StepId, p: PuzzleView): void {
    const steps = (this.save.steps[this.z] ??= {});
    const prev = steps[id];
    steps[id] = { flawless: (prev?.flawless ?? false) || p.clean, best: Math.min(prev?.best ?? Infinity, p.moves) };
    this.saveProgress();
  }

  /** Saves, and tells the rest of the app (the mode row, the gallery) that progress changed. */
  private saveProgress(): void {
    writeSave(this.save);
    refreshModeProgress();
    window.dispatchEvent(new CustomEvent('atomos:progress', { detail: { z: this.z } }));
  }

  private colourFor(z: number): string {
    return this.save.built[z]?.colour ?? SILVER;
  }

  private refresh(): void {
    const el = element(this.z);
    $('edge').textContent = `ATOMOS 400 ▸ ${el.symbol.toUpperCase()} ${el.z} ▸ PLATE ${String(el.z).padStart(4, '0')}`;
    this.renderStage();
    ($('btn-undo') as HTMLButtonElement).disabled = !this.puzzle?.canUndo() || this.busy;
    ($('btn-restart') as HTMLButtonElement).disabled = this.puzzle === null || this.busy;
    this.sayHint();
  }

  private renderStage(): void {
    const p = this.puzzle;
    const text = p ? `${p.moves} move${p.moves === 1 ? '' : 's'}${p.par !== null ? ` · par ${p.par}` : ''}` : '';
    const box = $('stage');
    if (box.textContent !== text) box.textContent = text;
  }

  /** The header inside a puzzle: Back to the Build page, the puzzle's name, and what it builds. */
  private renderHead(): void {
    const stage = this.stage as Exclude<Stage, 'home'>;
    const t = this.stagePuzzle(stage);
    const head = $('build-head');
    head.innerHTML = `
      <button class="back-plate" id="build-back" aria-label="Back to ${element(this.z).name}">${icon('chevron-left', { size: 20 })}<span>Back</span></button>
      <h2 class="pg-title">${t.name}</h2>
      <span class="pg-use">${this.stageLabel(stage)}</span>`;
    head.querySelector<HTMLButtonElement>('#build-back')!.onclick = () => this.toHome();
  }

  /** What a puzzle builds, for the header: "Nucleus", "Electrons" or "Isotope · Li-6". */
  private stageLabel(stage: Exclude<Stage, 'home'>): string {
    if (isIso(stage)) return `Isotope · ${element(this.z).symbol}-${isoA(stage)}`;
    return stage === 'nucleus' ? 'Nucleus' : 'Electrons';
  }

  /** The catalog entry for a puzzle on this atom. */
  private stagePuzzle(stage: Exclude<Stage, 'home'>, z = this.z): PuzzleType {
    if (isIso(stage)) return puzzleType('packing');
    return puzzleType(stage === 'nucleus' ? (z <= MERGE_UP_TO ? 'merge' : 'sliding') : 'orbitalGrid');
  }

  /** What a puzzle adds to this atom, in a sentence. */
  private contribution(stage: Exclude<Stage, 'home'>): string {
    const el = element(this.z);
    const name = el.name.toLowerCase();
    if (isIso(stage)) {
      const a = isoA(stage);
      return `Builds ${name}-${a}: ${el.z} proton${el.z === 1 ? '' : 's'} with ${a - el.z} neutron${a - el.z === 1 ? '' : 's'}.`;
    }
    if (stage === 'shells') return `Settles ${el.z} electron${el.z === 1 ? '' : 's'} into ${name}'s orbitals: ${shortConfiguration(elementAt(this.z))}.`;
    if (this.z === 1) return 'Hydrogen\'s nucleus is a single proton, so there is nothing to gather.';
    return `Gathers ${el.z} protons and ${this.neutrons} neutrons into ${name}'s nucleus.`;
  }

  // ---- the Build page ---------------------------------------------------------------

  /** The atom's Build page: the atom up top with a bar of everything there is to build, then
   *  its two puzzles (in any order), then its isotope vault, then what is still to come. */
  private renderHome(): void {
    const z = this.z;
    const el = element(z);
    const built = this.save.built[z];
    const name = el.name.toLowerCase();
    this.renderProgress();
    this.renderPaintButton();

    const steps = stepsOf(z);
    const noneDone = steps.every((id) => !this.stepState(z, id).done);
    const stepCards = steps.map((id) => {
      const st = this.stepState(z, id);
      const suggested = noneDone && id === steps[0] && steps.length > 1;
      return this.card({
        stage: id,
        kicker: `${STEP_LABEL[id]}${suggested ? ' · suggested first' : ''}`,
        title: this.stagePuzzle(id).name,
        text: this.contribution(id),
        done: st.done,
        flawless: st.flawless,
        best: st.best,
      });
    }).join('');

    const vault = vaultIsotopes(z);
    const isoCards = vault.map((iso) => {
      const have = isotopeCollected(this.save, z, iso.a);
      const life = iso.stable ? `stable${iso.abundance ? `, ${formatPercent(iso.abundance)} of ${name} on Earth` : ''}` : `half-life ${formatDuration(iso.halfLife ?? 0)}`;
      return this.card({
        stage: `iso-${iso.a}`,
        kicker: 'Isotope',
        title: `${el.name}-${iso.a}`,
        text: `${el.z} proton${el.z === 1 ? '' : 's'}, ${iso.a - el.z} neutron${iso.a - el.z === 1 ? '' : 's'}. ${life[0].toUpperCase()}${life.slice(1)}.`,
        done: have,
        flawless: false,
        locked: built ? undefined : `Opens once ${name} is built`,
      });
    }).join('');
    const live = this.save.specimens.some((sp) => sp.z === z);

    const later = this.laterFor(z);
    const laterBlock = later.length ? `
      <section class="bh-section bh-later">
        <h3>Coming later</h3>
        <ul>${later.map((l) => `<li><b>${l.what}</b><span class="bh-later-by">${l.by}</span><span class="bh-later-text">${l.text}</span></li>`).join('')}</ul>
      </section>` : '';

    $('bh-in').innerHTML = `
      <section class="bh-group">
        <div class="bh-group-head">
          <h3>Build ${name}</h3>
          <p>${built ? 'Built. Replay either puzzle any time to beat your best.' : z === 1 ? 'One puzzle: its nucleus is a lone proton, so you only settle its electron.' : 'Two puzzles, in any order. Solve both and it joins your collection.'}</p>
        </div>
        <ol class="bh-steps">${z === 1 ? this.hydrogenNucleus() : ''}${stepCards}</ol>
      </section>
      ${vault.length ? `
      <section class="bh-group">
        <div class="bh-group-head">
          <h3>Isotope vault</h3>
          <p>The same atom with other numbers of neutrons. ${built ? `Each one is a Packing board.` : `Build ${name} first; then each isotope is a Packing board.`}</p>
        </div>
        <ol class="bh-steps">${isoCards}</ol>
        ${live ? `<button class="text-btn bh-bench" id="bh-bench">Watch your unstable isotopes</button>` : ''}
      </section>` : ''}
      ${laterBlock}`;

    const root = $('bh-in');
    root.querySelectorAll<HTMLButtonElement>('[data-stage]').forEach((b) => (b.onclick = () => this.enter(b.dataset.stage as Stage)));
    root.querySelectorAll<HTMLButtonElement>('[data-rules]').forEach((b) => (b.onclick = () => this.openRulesFor(puzzleType(b.dataset.rules!))));
    root.querySelector<HTMLButtonElement>('#bh-bench')?.addEventListener('click', () => this.showBench(z));
  }

  /** One puzzle on the Build page: its icon, what it builds, how far it has got, and Play on the right. */
  private card(o: { stage: Exclude<Stage, 'home'>; kicker: string; title: string; text: string; done: boolean; flawless: boolean; best?: number; locked?: string }): string {
    const t = this.stagePuzzle(o.stage);
    const paused = this.suspended[o.stage];
    const cls = o.locked ? 'is-locked' : o.done ? (o.flawless ? 'is-flawless' : 'is-done') : 'is-next';
    const best = o.best !== undefined ? ` · best ${o.best} move${o.best === 1 ? '' : 's'}` : '';
    const where = o.locked ? o.locked
      : paused ? `In progress · ${paused.moves} move${paused.moves === 1 ? '' : 's'}`
      : o.done ? `${isIso(o.stage) ? 'Built' : o.flawless ? 'Flawless' : 'Done'}${best}`
      : 'Not built yet';
    const badge = o.done ? `<span class="bh-badge">${icon(o.flawless ? 'star' : 'check', { size: 14 })}</span>` : '';
    const play = o.locked ? ''
      : `<button class="${o.done && !paused ? 'secondary' : 'primary'} bh-play" data-stage="${o.stage}" aria-label="${paused ? 'Resume' : o.done ? 'Replay' : 'Play'} ${o.title}">${paused ? 'Resume' : o.done ? 'Replay' : 'Play'}</button>`;
    return `
      <li class="bh-step ${cls}">
        <span class="bh-mark" aria-hidden="true">${puzzleIcon(t.id, 24)}${badge}</span>
        <div class="bh-step-body">
          <p class="bh-kicker">${o.kicker}</p>
          <h4 class="bh-step-name">${o.title}<button class="bh-info" data-rules="${t.id}" aria-label="How ${t.name} works" title="${t.name}: how it works">${icon('info', { size: 18 })}</button></h4>
          <p class="bh-adds">${o.text}</p>
          <p class="bh-where">${where}</p>
        </div>
        ${play}
      </li>`;
  }

  /** Hydrogen's nucleus, ready from the start. */
  private hydrogenNucleus(): string {
    return `
      <li class="bh-step is-done">
        <span class="bh-mark" aria-hidden="true">${icon('atom', { size: 24 })}<span class="bh-badge">${icon('check', { size: 14 })}</span></span>
        <div class="bh-step-body">
          <p class="bh-kicker">Nucleus</p>
          <h4 class="bh-step-name">A lone proton</h4>
          <p class="bh-adds">${this.contribution('nucleus')}</p>
          <p class="bh-where">Ready from the start</p>
        </div>
      </li>`;
  }

  /** The bar under the atom: one segment per thing to build, filled as each is done. */
  private renderProgress(): void {
    const segs = segmentsOf(this.z, this.save);
    const done = segs.filter((g) => g.done).length;
    const pct = Math.round(atomProgress(this.z, this.save) * 100);
    const built = this.save.built[this.z];
    const groups = [segs.filter((g) => g.kind === 'step'), segs.filter((g) => g.kind === 'isotope')].filter((g) => g.length);
    $('bh-progress').innerHTML = `
      <div class="bh-bar" role="img" aria-label="${done} of ${segs.length} built, ${pct}%">
        ${groups.map((g) => `<span class="bh-bar-group" style="flex:${g.length}">${g.map((x) => `<span class="bh-seg${x.done ? ' is-done' : ''}${x.kind === 'isotope' ? ' is-iso' : ''}" title="${x.label}${x.done ? ': built' : ''}"></span>`).join('')}</span>`).join('')}
      </div>
      <div class="bh-bar-caption">
        <span>${built ? (built.flawless ? 'Built, flawless' : 'Built') : 'Not built yet'}</span>
        <span class="bh-bar-count">${done} of ${segs.length} · ${pct}%</span>
      </div>`;
  }

  // ---- paint ---------------------------------------------------------------------

  private renderPaintButton(): void {
    const b = $<HTMLButtonElement>('bh-paint');
    const built = Boolean(this.save.built[this.z]);
    b.style.setProperty('--paint', this.colourFor(this.z));
    b.innerHTML = `<span class="bh-paint-dot"></span><span class="bh-paint-brush">${icon('paint', { size: 14 })}</span>`;
    b.disabled = !built;
    const label = built ? 'Paint this atom' : 'Paint it once it is built';
    b.setAttribute('aria-label', label);
    b.title = label;
  }

  /** A small panel under the paint button: a hue slider and a way back to silver. */
  private openPaint(): void {
    if (!this.save.built[this.z]) return;
    const old = document.getElementById('bh-paint-pop');
    if (old) { old.remove(); return; }
    const current = this.colourFor(this.z);
    const pop = document.createElement('div');
    pop.className = 'bh-paint-pop';
    pop.id = 'bh-paint-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Paint');
    const hue = current.toLowerCase() === SILVER ? 190 : Math.round(hexToHue(current));
    pop.innerHTML = `
      <p class="bh-paint-title">Paint</p>
      <input class="bh-hue" type="range" min="0" max="359" step="1" value="${hue}" aria-label="Hue">
      <div class="bh-paint-row">
        <button class="text-btn" data-silver>Silver</button>
        <span class="bh-paint-note">Atoms have no color at this scale.</span>
      </div>`;
    $('bh-stage').append(pop);
    const range = pop.querySelector<HTMLInputElement>('.bh-hue')!;
    range.oninput = () => this.paint(hueToHex(Number(range.value)));
    pop.querySelector<HTMLButtonElement>('[data-silver]')!.onclick = () => this.paint(SILVER);
    const away = (e: PointerEvent) => {
      if (pop.contains(e.target as Node) || $('bh-paint').contains(e.target as Node)) return;
      pop.remove();
      window.removeEventListener('pointerdown', away, true);
    };
    window.addEventListener('pointerdown', away, true);
    range.focus({ preventScroll: true });
  }

  private paint(c: string): void {
    const built = this.save.built[this.z];
    if (!built) return;
    built.colour = c;
    writeSave(this.save);
    this.scene.setColour(c);
    document.documentElement.style.setProperty('--el', c);
    this.tintDetail();
    this.renderPaintButton();
  }

  /** Puzzles on the progression map for this atom that the game does not have yet. */
  private laterFor(z: number): { what: string; by: string; text: string }[] {
    const el = element(z);
    const out: { what: string; by: string; text: string }[] = [];
    if (NEW_SHAPE[z]) out.push({ what: `The ${NEW_SHAPE[z]} orbital shape`, by: 'Field Lines', text: `${el.name} is the first atom with an electron in a ${NEW_SHAPE[z]} orbital; this puzzle will discover its shape.` });
    if (PERIOD_START[z]) out.push({ what: `Period ${PERIOD_START[z]}`, by: 'Slide Until Stop', text: `${el.name} starts a new row of the table; this puzzle will open it.` });
    return out;
  }

  private openRulesFor(t: PuzzleType): void {
    openRules(t, { reducedMotion: this.save.settings.reducedMotion });
  }

  private sayHint(): void {
    const p = this.puzzle;
    // A short status only; how-to text lives behind the i.
    const raw = p ? p.hint().replace(/<[^>]+>/g, '') : '';
    const text = raw.length > 60 ? '' : raw;
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
    const stage = this.stage as Exclude<Stage, 'home'>;
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
    this.puzzle = null;
    document.body.classList.remove('puzzling', 'stage-nucleus');
    this.clearOverlay();
    if (isIso(stage)) {
      this.collectIsotope(isoA(stage));
      sfx.harmonySound();
      this.busy = false;
      this.isotopeWon(isoA(stage), p);
      return;
    }
    const wasBuilt = Boolean(this.save.built[this.z]);
    this.recordStep(stage, p);
    if (stage === 'nucleus') {
      sfx.harmonySound();
      this.scene.setAtom(this.atom, this.neutrons, { pDiscovered: true });
    } else {
      // Each electron settles into its orbital in order.
      for (let i = 0; i < this.z; i++) {
        const r = resolvePlacement(this.atom);
        if (r?.kind !== 'placed') break;
        this.atom = applyPlacement(this.atom, r.orbital, r.spin);
        this.scene.setAtom(this.atom, this.neutrons, { pDiscovered: true });
        sfx.captureSound();
        this.say(electronCount(this.atom) >= this.z ? shortConfiguration(elementAt(this.z)) : configuration(this.atom));
        await wait(reduced ? 60 : 220);
      }
    }
    this.busy = false;
    const bothDone = stepsOf(this.z).every((id) => this.stepState(this.z, id).done);
    if (bothDone) this.finish(p, stage, wasBuilt);
    else this.stepWon(stage, p);
  }

  /** Moves and par for the win panel. */
  private winStats(p: PuzzleView, step?: StepId): { label: string; value: string }[] {
    const best = step ? this.save.steps[this.z]?.[step]?.best : undefined;
    return [
      { label: 'Moves', value: String(p.moves) },
      ...(p.par !== null ? [{ label: 'Par', value: p.moves <= p.par ? `${p.par} ✓` : String(p.par) }] : []),
      ...(best !== undefined && best < p.moves ? [{ label: 'Best', value: String(best) }] : []),
    ];
  }

  /** The way back to this atom, which every win panel leads with: the player picks what is next. */
  private backAction(primary = true) {
    return { label: `Back to ${element(this.z).name.toLowerCase()}`, primary, onClick: () => this.enter('home') };
  }

  /** One of the two puzzles solved, the atom not yet whole: say what it added. */
  private stepWon(step: StepId, p: PuzzleView): void {
    const el = element(this.z);
    const other: StepId = step === 'nucleus' ? 'shells' : 'nucleus';
    const note = step === 'nucleus'
      ? `${el.z} protons and ${this.neutrons} neutrons, held together. ${el.name} still needs its electrons.`
      : `${el.z} electrons in their orbitals. ${el.name} still needs its nucleus.`;
    this.closeWin = showWin($('app'), {
      kicker: p.clean ? 'Flawless' : 'Solved',
      title: `${el.name}'s ${step === 'nucleus' ? 'nucleus' : 'electrons'}`,
      flawless: p.clean,
      stats: this.winStats(p, step),
      note,
      actions: [
        this.backAction(),
        { label: `Play its ${other === 'nucleus' ? 'nucleus' : 'electrons'}`, onClick: () => this.enter(other) },
      ],
    }, this.save.settings.reducedMotion);
  }

  /** Both puzzles done: the atom joins the collection (or is rebuilt). */
  private finish(p: PuzzleView, step: StepId, wasBuilt: boolean): void {
    const prev = this.save.built[this.z];
    const flawless = stepsOf(this.z).every((id) => this.stepState(this.z, id).flawless);
    this.save.built[this.z] = { flawless: (prev?.flawless ?? false) || flawless, colour: prev?.colour };
    const el = element(this.z);
    const key = isotopeKey(this.z, el.commonA);
    this.save.isotopes[key] = { ...this.save.isotopes[key], collected: true };
    this.saveProgress();
    if (step === 'nucleus' && electronCount(this.atom) < this.z) {
      this.atom = fullAtom(this.z);
      this.scene.setAtom(this.atom, this.neutrons, { pDiscovered: true });
    }
    this.tintDetail();
    this.scene.celebrate();
    sfx.completeSound();
    this.say('');
    const vault = vaultIsotopes(this.z).length;
    const note = wasBuilt
      ? `${el.name} rebuilt.${flawless && !prev?.flawless ? ' Flawless at last.' : ''}`
      : `${el.name} joins your collection, with ${el.name.toLowerCase()}-${el.commonA}, its most common isotope.${vault ? ` Its isotope vault is open: ${vault} more to build.` : ''}`;
    window.setTimeout(() => {
      this.closeWin = showWin($('app'), {
        kicker: wasBuilt ? (flawless ? 'Flawless' : 'Rebuilt') : flawless ? 'Built, flawless' : 'Built',
        title: wasBuilt ? `${el.name}'s ${step === 'nucleus' ? 'nucleus' : 'electrons'}` : `${el.name} is built`,
        flawless,
        stats: this.winStats(p, step),
        note: flawless || wasBuilt ? note : `${note} For a flawless one: no fusion past the target, and the electrons in par or fewer moves.`,
        actions: [
          this.backAction(),
          ...(this.hooks.onView && !wasBuilt ? [{ label: `Look at ${el.name.toLowerCase()}`, onClick: () => { this.enter('home'); this.hooks.onView!(this.z); } }] : []),
        ],
      }, this.save.settings.reducedMotion);
    }, this.save.settings.reducedMotion ? 200 : 900);
  }

  /** An isotope's Packing board solved: it joins the collection. A known unstable isotope also
   *  starts its own life on the bench, decaying in real time. */
  private collectIsotope(a: number): void {
    const z = this.z;
    const key = isotopeKey(z, a);
    this.save.isotopes[key] = { ...this.save.isotopes[key], collected: true };
    const known = findIsotope(z, a);
    if (known && !isStable(known) && !isFleeting(known) && !this.save.specimens.some((sp) => sp.z === z && sp.a === a)) {
      const now = Date.now();
      this.save.specimens.push({ id: `${key}-${now}`, z, a, createdAt: now, decayAt: now + sampleLifetime(known.halfLife!) * 1000 });
    }
    this.saveProgress();
  }

  private isotopeWon(a: number, p: PuzzleView): void {
    const el = element(this.z);
    const next = vaultIsotopes(this.z).find((i) => i.a !== a && !isotopeCollected(this.save, this.z, i.a));
    this.closeWin = showWin($('app'), {
      kicker: 'Isotope built',
      title: `${el.name}-${a}`,
      flawless: false,
      stats: this.winStats(p),
      note: `${el.z} proton${el.z === 1 ? '' : 's'} and ${a - el.z} neutron${a - el.z === 1 ? '' : 's'}, now in your collection.`,
      actions: [
        this.backAction(),
        ...(next ? [{ label: `Next isotope: ${el.symbol}-${next.a}`, onClick: () => this.enter(`iso-${next.a}`) }] : []),
      ],
    }, this.save.settings.reducedMotion);
  }

  // ---- input -----------------------------------------------------------------

  private bindInput(): void {
    const canvas = this.overlay;
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', () => this.onCancel());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    const undo = iconButton({ icon: icon('undo'), label: 'Undo', onClick: () => this.undo() });
    undo.id = 'btn-undo';
    const restart = createHoldButton({ icon: icon('restart'), label: 'Restart', doneLabel: 'Restarted', onConfirm: () => this.restartPuzzle() });
    restart.id = 'btn-restart';
    const how = iconButton({ icon: icon('info'), label: 'Instructions', onClick: () => this.showHow() });
    $('build-actions').append(undo, restart, how, scienceButton('ui-icon-btn science-btn'));
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
    if (this.paused || $('app').hidden || modalOpen() || $('app').querySelector('.win')) return;
    if (e.key === 'Escape' && this.stage !== 'home') { this.toHome(); e.preventDefault(); return; }
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
      <p class="muted">Prototype</p>
      <p>Every atom is built from two puzzles, in any order: one gathers its <b>nucleus</b>, the other settles its <b>electrons</b>. Then its isotopes open. Each atom's Build page shows its puzzles, what each one adds, and how far you have got.</p>
      <p>No timers. The <b>i</b> explains how a puzzle works, and the microscope the science behind it, whenever you want them.</p>
      <div class="actions"><button class="primary" id="intro-go">Start with hydrogen</button></div>`);
    sheet.querySelector<HTMLButtonElement>('#intro-go')!.onclick = () => this.closeModal();
  }

  private showWhy(): void {
    const t = this.stagePuzzle(this.stage === 'home' ? 'nucleus' : this.stage);
    this.openModal(t.science?.(this.z) ?? `<h2>${t.name}</h2><p>${t.blurb}</p>`);
  }

  /** The microscope on the Build page: what each step stands for in a real atom. */
  private showBuildScience(): void {
    const el = element(this.z);
    const nucleus = this.stagePuzzle('nucleus');
    const sheet = this.openModal(`
      <h2>How ${el.name.toLowerCase()} is built</h2>
      <p>An atom is a tiny, dense <b>nucleus</b> of protons and neutrons, wrapped in a far larger cloud of <b>electrons</b>. ${el.name} has ${el.z} proton${el.z === 1 ? '' : 's'}, ${this.neutrons} neutron${this.neutrons === 1 ? '' : 's'} in its most common form, and ${el.z} electron${el.z === 1 ? '' : 's'}.</p>
      <p>The number of protons decides which element it is. The electrons decide how it behaves: how it bonds, its color in a flame, whether it conducts. The same element with a different number of neutrons is another <b>isotope</b> of it.</p>
      <div class="actions">
        ${this.z > 1 ? `<button class="secondary" id="sci-nucleus">The science of ${nucleus.name}</button>` : ''}
        <button class="secondary" id="sci-shells">The science of Orbital Grid</button>
        <button class="secondary" id="sci-iso">The science of Packing</button>
      </div>`);
    const open = (step: StepId) => { const t = this.stagePuzzle(step); this.openModal(t.science?.(this.z) ?? `<h2>${t.name}</h2><p>${t.blurb}</p>`); };
    sheet.querySelector<HTMLButtonElement>('#sci-nucleus')?.addEventListener('click', () => open('nucleus'));
    sheet.querySelector<HTMLButtonElement>('#sci-shells')!.onclick = () => open('shells');
    sheet.querySelector<HTMLButtonElement>('#sci-iso')!.onclick = () => { const t = puzzleType('packing'); this.openModal(t.science?.(this.z) ?? `<h2>${t.name}</h2><p>${t.blurb}</p>`); };
  }

  private showHow(): void {
    if (this.stage === 'home') return;
    const t = this.stagePuzzle(this.stage);
    openRules(t, {
      reducedMotion: this.save.settings.reducedMotion,
      footer: `<h3>What it adds</h3><p class="meta">${this.contribution(this.stage)}</p>`,
    });
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
      <div class="actions"><button class="secondary" id="bench-back">Back to ${el.name.toLowerCase()}</button></div>`);
    sheet.querySelectorAll<HTMLButtonElement>('[data-build]').forEach((b) => (b.onclick = () => this.buildIsotope(findIsotope(z, Number(b.dataset.build))!)));
    sheet.querySelector<HTMLButtonElement>('#bench-back')!.onclick = () => { this.benchZ = null; this.closeModal(); if (this.stage === 'home') this.renderHome(); };
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
    if (isIso(this.stage)) {
      p.state = solvedState(p.state as PackingState);
    } else if (this.stage === 'nucleus') {
      const s = p.state as { sockets?: number[]; filled?: number; blocks?: { x: number; len: number }[]; w?: number };
      if (s.sockets) s.filled = s.sockets.length;
      else if (s.blocks) s.blocks[0] = { ...s.blocks[0], x: s.w! - s.blocks[0].len };
    } else {
      const s = p.state as { cells: number[]; solution: number[] };
      s.cells = [...s.solution];
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

/** An atom with every electron in place, as a finished build shows it. */
function fullAtom(z: number): Atom {
  let atom = newAtom(z);
  for (let i = 0; i < z; i++) {
    const r = resolvePlacement(atom);
    if (r?.kind !== 'placed') break;
    atom = applyPlacement(atom, r.orbital, r.spin);
  }
  return atom;
}

/** "7.59%", "0.011%": a share of the element found on Earth. */
function formatPercent(p: number): string {
  return `${p >= 10 ? Math.round(p) : p >= 1 ? p.toFixed(1) : Number(p.toPrecision(2))}%`;
}

/** A paint color from a hue: bright enough to glow against the dark, never garish. */
function hueToHex(h: number): string {
  const s = 0.62, l = 0.66;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHue(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));


export { FAMILY_COLOURS, electronCount };
