import { AtomScene, type ScreenPoint } from './render/scene';
import { applyPlacement, configuration, electronCount, newAtom, resolvePlacement, type Atom } from './core/physics';
import { FAMILY_COLOURS, MAX_Z, element } from './core/elements';
import {
  MODE_LABEL, decayProducts, findIsotope, formatDuration, isFleeting, isStable,
  isotopeKey, isotopesOf, sampleLifetime, type Isotope,
} from './core/isotopes';
import { frontier, loadSave, writeSave, type SaveData, type StepId } from './core/save';
import { buildTracks, drawWitness, slowFactor } from './ui/witness';
import { MERGE_UP_TO, mergeLevel, orbitalGridLevel, slidingLevel } from './puzzles/levels';
import { MergeView } from './puzzles/mergeView';
import { OrbitalGridView } from './puzzles/orbitalGridView';
import { SlidingView } from './puzzles/slidingView';
import { type Area, type PuzzleView } from './puzzles/view';
import { puzzleType, type PuzzleType } from './puzzles/catalog';
import { openRules } from './puzzles/rulesModal';
import { showWin } from './puzzles/winPanel';
import { closeModal, modalOpen, openModal } from './ui/modal';
import { createHoldButton, iconButton } from './ui/components';
import { icon } from './ui/icons';
import { setScienceHandler } from './ui/science';
import { elementAt, shortConfiguration } from './gallery/data';
import * as sfx from './audio';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Droplet silver: the default electron colour until the player tints an element. */
const SILVER = '#e8e2d4';
/** Paint choices for a built atom. */
const PAINTS = [SILVER, '#ffffff', '#9fd0ff', '#5f8ae0', '#2ea57a', '#9fc98a', '#e6b04a', '#e0503a', '#d68ad8', '#a865d6'];

/** 'home' is the atom's Build page; the other two are its puzzles. */
type Stage = 'home' | StepId;

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
  private suspended: Partial<Record<StepId, PuzzleView>> = {};
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
    this.registerScience();
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
      this.puzzle = this.suspended[stage] ?? this.makePuzzle(stage);
      delete this.suspended[stage];
      if (stage === 'shells' && !this.suspended.shells) {
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
    this.registerScience();
    this.refresh();
    this.ensureLoop();
  }

  private makePuzzle(step: StepId): PuzzleView {
    const reduced = this.save.settings.reducedMotion;
    if (step === 'shells') return new OrbitalGridView(orbitalGridLevel(this.z), reduced);
    return this.z <= MERGE_UP_TO ? new MergeView(mergeLevel(this.z), reduced) : new SlidingView(slidingLevel(this.z), reduced);
  }

  /** Back to the Build page, keeping a puzzle that is under way. */
  private toHome(): void {
    if (this.busy) return;
    if (this.stage !== 'home' && this.puzzle && this.puzzle.moves > 0 && !this.puzzle.won) this.suspended[this.stage] = this.puzzle;
    this.enter('home');
  }

  /** The header microscope: how building works on the Build page, the science of a puzzle inside it. */
  private registerScience(): void {
    if (this.paused) return;
    if (this.stage === 'home') setScienceHandler(() => this.showBuildScience(), `How ${element(this.z).name} is built`);
    else setScienceHandler(() => this.showWhy(), 'The science behind this puzzle');
  }

  /** Where a Build step stands. Hydrogen's nucleus is a lone proton, so it is done from the start. */
  private stepState(z: number, id: StepId): { done: boolean; flawless: boolean; best?: number } {
    if (id === 'nucleus' && z === 1) return { done: true, flawless: true };
    const r = this.save.steps[z]?.[id];
    if (r) return { done: true, ...r };
    const b = this.save.built[z];
    return b ? { done: true, flawless: b.flawless } : { done: false, flawless: false };
  }

  private recordStep(id: StepId, p: PuzzleView): void {
    const steps = (this.save.steps[this.z] ??= {});
    const prev = steps[id];
    steps[id] = { flawless: (prev?.flawless ?? false) || p.clean, best: Math.min(prev?.best ?? Infinity, p.moves) };
    writeSave(this.save);
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

  /** The header inside a puzzle: Back to the Build page, the puzzle's name, and which step it is. */
  private renderHead(): void {
    const step = this.stage as StepId;
    const t = this.stepPuzzle(step);
    const head = $('build-head');
    head.innerHTML = `
      <button class="back-plate" id="build-back" aria-label="Back to ${element(this.z).name}">${icon('chevron-left', { size: 20 })}<span>Back</span></button>
      <h2 class="pg-title">${t.name}</h2>
      <span class="pg-use">Step ${step === 'nucleus' ? 1 : 2} of 2 · ${STEP_LABEL[step]}</span>`;
    head.querySelector<HTMLButtonElement>('#build-back')!.onclick = () => this.toHome();
  }

  /** The catalog entry for a Build step's puzzle on this atom. */
  private stepPuzzle(step: StepId, z = this.z): PuzzleType {
    return puzzleType(step === 'nucleus' ? (z <= MERGE_UP_TO ? 'merge' : 'sliding') : 'orbitalGrid');
  }

  /** What a Build step adds to this atom, in a sentence. */
  private stepContribution(step: StepId): string {
    const el = element(this.z);
    if (step === 'shells') return `Settles ${el.z} electron${el.z === 1 ? '' : 's'} into ${el.name.toLowerCase()}'s orbitals: ${shortConfiguration(elementAt(this.z))}.`;
    if (this.z === 1) return 'Hydrogen\'s nucleus is a single proton, so there is nothing to gather.';
    return `Gathers ${el.z} protons and ${this.neutrons} neutrons into ${el.name.toLowerCase()}'s nucleus.`;
  }

  // ---- the Build page ---------------------------------------------------------------

  /** The atom's Build page: its two puzzles, how far each has got, and what is still to come. */
  private renderHome(): void {
    const z = this.z;
    const el = element(z);
    const built = this.save.built[z];
    const colour = this.colourFor(z);
    const steps: StepId[] = ['nucleus', 'shells'];
    const state = steps.map((id) => this.stepState(z, id));
    // Hydrogen's nucleus needs no puzzle, so it has one step to count.
    const counted = z === 1 ? state.slice(1) : state;
    const doneCount = counted.filter((s) => s.done).length;
    const status = built ? (built.flawless ? 'Built, flawless' : 'Built') : doneCount ? `${doneCount} of ${counted.length} steps done` : 'Not built yet';

    const cards = steps.map((id, i) => {
      const st = state[i];
      const t = this.stepPuzzle(id);
      const nothing = id === 'nucleus' && z === 1;
      const locked = id === 'shells' && !state[0].done;
      const paused = this.suspended[id];
      const cls = nothing ? 'is-done' : st.done ? (st.flawless ? 'is-flawless' : 'is-done') : locked ? 'is-locked' : 'is-next';
      const mark = nothing ? icon('check', { size: 20 }) : st.done ? icon(st.flawless ? 'star' : 'check', { size: 20 }) : String(i + 1);
      const best = st.best !== undefined ? ` · best ${st.best} move${st.best === 1 ? '' : 's'}` : '';
      const where = nothing ? 'Ready from the start' : paused ? `In progress · ${paused.moves} move${paused.moves === 1 ? '' : 's'}`
        : st.done ? `${st.flawless ? 'Flawless' : 'Done'}${best}`
        : locked ? 'Opens once the nucleus is done' : 'Not played yet';
      const play = nothing || locked ? ''
        : `<button class="${st.done && !paused ? 'secondary' : 'primary'} bh-play" data-step="${id}">${paused ? 'Resume' : st.done ? 'Replay' : 'Play'}</button>`;
      return `
        <li class="bh-step ${cls}">
          <span class="bh-mark" aria-hidden="true">${mark}</span>
          <div class="bh-step-body">
            <p class="bh-kicker">Step ${i + 1} · ${STEP_LABEL[id]}</p>
            <h2 class="bh-step-name">${nothing ? 'A lone proton' : t.name}${nothing ? '' : `<button class="bh-info" data-rules="${t.id}" aria-label="How ${t.name} works">${icon('info', { size: 18 })}</button>`}</h2>
            <p class="bh-adds">${this.stepContribution(id)}</p>
            <p class="bh-where">${where}</p>
          </div>
          ${play}
        </li>`;
    }).join('');

    const stable = isotopesOf(z).filter(isStable);
    const stableHave = stable.filter((iso) => this.save.isotopes[isotopeKey(z, iso.a)]?.collected).length;
    const next = z < MAX_Z ? element(z + 1) : null;
    const builtBlock = built ? `
      <section class="bh-section">
        <h3>Paint</h3>
        <p class="muted">Atoms have no color at this scale, so choose how yours glows.</p>
        <div class="palette">${PAINTS.map((c) => `<button style="--c:${c}" data-c="${c}" aria-label="Color ${c}" aria-pressed="${c.toLowerCase() === colour.toLowerCase()}"></button>`).join('')}</div>
      </section>
      <section class="bh-section">
        <h3>Isotopes</h3>
        <p class="muted">${stable.length ? `${stableHave} of ${stable.length} stable isotope${stable.length === 1 ? '' : 's'} collected.` : `${el.name} has no stable isotope; its atoms decay in real time.`} The same element with different numbers of neutrons.</p>
        <button class="secondary" id="bh-iso">Open the isotope bench</button>
      </section>` : '';

    const later = this.laterFor(z);
    const laterBlock = later.length ? `
      <section class="bh-section bh-later">
        <h3>Coming later</h3>
        <p class="muted">Planned for ${el.name.toLowerCase()}, not in the game yet.</p>
        <ul>${later.map((l) => `<li><b>${l.what}</b><span class="bh-later-by">${l.by}</span><span class="bh-later-text">${l.text}</span></li>`).join('')}</ul>
      </section>` : '';

    $('bh-in').innerHTML = `
      <div class="bh-hero">
        <div class="bh-sym" style="--el:${colour}"><small>${z}</small>${el.symbol}</div>
        <div class="bh-id">
          <h1>${el.name}</h1>
          <p class="bh-status${built ? ' is-built' : ''}">${status}</p>
        </div>
      </div>
      <p class="bh-lede">${z === 1 ? 'Hydrogen takes one puzzle: its nucleus is a lone proton, so you only settle its electron. Solve it to add hydrogen to your collection.' : `Two puzzles build ${el.name.toLowerCase()}: the first gathers its nucleus, the second settles its electrons around it. Solve both to add it to your collection.`}</p>
      <ol class="bh-steps">${cards}</ol>
      ${builtBlock}
      ${built && next ? `<button class="primary bh-next" id="bh-next">${this.save.built[next.z] ? 'Rebuild' : 'Build'} ${next.name}</button>` : ''}
      ${laterBlock}`;

    const root = $('bh-in');
    root.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => (b.onclick = () => this.enter(b.dataset.step as StepId)));
    root.querySelectorAll<HTMLButtonElement>('[data-rules]').forEach((b) => (b.onclick = () => this.openRulesFor(puzzleType(b.dataset.rules!))));
    root.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => (b.onclick = () => this.paint(b.dataset.c!)));
    root.querySelector<HTMLButtonElement>('#bh-iso')?.addEventListener('click', () => this.showBench(z));
    root.querySelector<HTMLButtonElement>('#bh-next')?.addEventListener('click', () => this.start(z + 1));
  }

  /** Puzzles on the progression map for this atom that the game does not have yet. */
  private laterFor(z: number): { what: string; by: string; text: string }[] {
    const el = element(z);
    const out: { what: string; by: string; text: string }[] = [];
    if (isotopesOf(z).length > 1) out.push({ what: 'Isotope vault', by: 'Packing', text: `Builds ${el.name.toLowerCase()}'s other isotopes, one board each.` });
    if (NEW_SHAPE[z]) out.push({ what: `The ${NEW_SHAPE[z]} orbital shape`, by: 'Field Lines', text: `${el.name} is the first atom with an electron in a ${NEW_SHAPE[z]} orbital; this puzzle discovers its shape.` });
    if (PERIOD_START[z]) out.push({ what: `Period ${PERIOD_START[z]}`, by: 'Slide Until Stop', text: `${el.name} starts a new row of the table; this puzzle opens it.` });
    return out;
  }

  private paint(c: string): void {
    const built = this.save.built[this.z];
    if (!built) return;
    built.colour = c;
    writeSave(this.save);
    this.scene.setColour(c);
    document.documentElement.style.setProperty('--el', c);
    this.renderHome();
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
      this.recordStep('nucleus', p);
      sfx.harmonySound();
      this.puzzle = null;
      document.body.classList.remove('puzzling', 'stage-nucleus');
      this.clearOverlay();
      this.scene.setAtom(this.atom, this.neutrons, { pDiscovered: true });
      this.busy = false;
      this.stepWon('nucleus', p);
      return;
    }
    this.recordStep('shells', p);
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
      this.say(electronCount(this.atom) >= this.z ? shortConfiguration(elementAt(this.z)) : configuration(this.atom));
      await wait(reduced ? 60 : 220);
    }
    this.busy = false;
    if (this.stepState(this.z, 'nucleus').done) this.finish(p);
    else this.stepWon('shells', p);
  }

  /** Moves and par for the win panel. */
  private winStats(p: PuzzleView, step: StepId): { label: string; value: string }[] {
    const best = this.save.steps[this.z]?.[step]?.best;
    return [
      { label: 'Moves', value: String(p.moves) },
      ...(p.par !== null ? [{ label: 'Par', value: p.moves <= p.par ? `${p.par} ✓` : String(p.par) }] : []),
      ...(best !== undefined && best < p.moves ? [{ label: 'Best', value: String(best) }] : []),
    ];
  }

  /** One step solved, the atom not yet whole: say what it added and offer the other step. */
  private stepWon(step: StepId, p: PuzzleView): void {
    const el = element(this.z);
    const other: StepId = step === 'nucleus' ? 'shells' : 'nucleus';
    const otherDone = this.stepState(this.z, other).done;
    const note = step === 'nucleus'
      ? `${el.z} protons and ${this.neutrons} neutrons, held together. ${otherDone ? 'Its electrons are already in place.' : 'Next, its electrons.'}`
      : `${el.z} electrons in their orbitals. ${el.name} still needs its nucleus.`;
    this.closeWin = showWin($('app'), {
      kicker: p.clean ? 'Flawless' : `Step ${step === 'nucleus' ? 1 : 2} done`,
      title: `${el.name}'s ${step === 'nucleus' ? 'nucleus' : 'electrons'}`,
      flawless: p.clean,
      stats: this.winStats(p, step),
      note,
      actions: [
        ...(!otherDone ? [{ label: `Next: ${STEP_LABEL[other].toLowerCase()}`, primary: true, onClick: () => this.enter(other) }] : []),
        { label: `Back to ${el.name.toLowerCase()}`, primary: otherDone, onClick: () => this.enter('home') },
      ],
    }, this.save.settings.reducedMotion);
  }

  /** Both steps done: the atom joins the collection. */
  private finish(p: PuzzleView): void {
    const prev = this.save.built[this.z];
    const flawless = this.stepState(this.z, 'nucleus').flawless && this.stepState(this.z, 'shells').flawless;
    this.save.built[this.z] = { flawless: (prev?.flawless ?? false) || flawless, colour: prev?.colour };
    const el = element(this.z);
    const key = isotopeKey(this.z, el.commonA);
    this.save.isotopes[key] = { ...this.save.isotopes[key], collected: true };
    writeSave(this.save);
    this.scene.celebrate();
    sfx.completeSound();
    this.say('');
    const next = this.z < MAX_Z ? element(this.z + 1) : null;
    const nucleus = this.stepState(this.z, 'nucleus');
    const note = prev
      ? `${el.name} rebuilt.${flawless && !prev.flawless ? ' Flawless at last: nothing spoiled, electrons at par.' : ''}`
      : `${el.name} joins your collection, with ${el.name.toLowerCase()}-${el.commonA}, its most common isotope. Paint it or build its isotopes from its Build page.`;
    window.setTimeout(() => {
      this.closeWin = showWin($('app'), {
        kicker: flawless ? 'Flawless' : 'Built',
        title: `${el.name} is built`,
        flawless,
        stats: [
          ...this.winStats(p, 'shells'),
          ...(this.z > 1 ? [{ label: 'Nucleus', value: nucleus.flawless ? 'Flawless' : 'Done' }] : []),
        ],
        note: flawless ? note : `${note} For a flawless one: no fusion past the target, and the electrons in par or fewer moves.`,
        actions: [
          ...(next ? [{ label: `${this.save.built[next.z] ? 'Rebuild' : 'Build'} ${next.name.toLowerCase()}`, primary: true, onClick: () => this.start(next.z) }] : []),
          ...(this.hooks.onView ? [{ label: `Look at ${el.name.toLowerCase()}`, onClick: () => { this.enter('home'); this.hooks.onView!(this.z); } }] : []),
          { label: `Back to ${el.name.toLowerCase()}`, onClick: () => this.enter('home') },
        ],
      }, this.save.settings.reducedMotion);
    }, this.save.settings.reducedMotion ? 200 : 900);
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
    $('build-actions').append(undo, restart, how);
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
      <p>Every atom is built from puzzles: one gathers its <b>nucleus</b>, the other settles its <b>electrons</b>. Each atom's Build page shows its puzzles, what each one adds, and how far you have got.</p>
      <p>No timers. The <b>i</b> explains how a puzzle works, and the microscope the science behind it, whenever you want them.</p>
      <div class="actions"><button class="primary" id="intro-go">Start with hydrogen</button></div>`);
    sheet.querySelector<HTMLButtonElement>('#intro-go')!.onclick = () => this.closeModal();
  }

  private showWhy(): void {
    const t = this.stepPuzzle(this.stage === 'home' ? 'nucleus' : this.stage);
    this.openModal(t.science?.(this.z) ?? `<h2>${t.name}</h2><p>${t.blurb}</p>`);
  }

  /** The microscope on the Build page: what each step stands for in a real atom. */
  private showBuildScience(): void {
    const el = element(this.z);
    const nucleus = this.stepPuzzle('nucleus');
    const sheet = this.openModal(`
      <h2>How ${el.name.toLowerCase()} is built</h2>
      <p>An atom is a tiny, dense <b>nucleus</b> of protons and neutrons, wrapped in a far larger cloud of <b>electrons</b>. ${el.name} has ${el.z} proton${el.z === 1 ? '' : 's'}, ${this.neutrons} neutron${this.neutrons === 1 ? '' : 's'} in its most common form, and ${el.z} electron${el.z === 1 ? '' : 's'}.</p>
      <p>The number of protons decides which element it is. The electrons decide how it behaves: how it bonds, its color in a flame, whether it conducts.</p>
      <div class="actions">
        ${this.z > 1 ? `<button class="secondary" id="sci-nucleus">The science of ${nucleus.name}</button>` : ''}
        <button class="secondary" id="sci-shells">The science of Orbital Grid</button>
      </div>`);
    const open = (step: StepId) => { const t = this.stepPuzzle(step); this.openModal(t.science?.(this.z) ?? `<h2>${t.name}</h2><p>${t.blurb}</p>`); };
    sheet.querySelector<HTMLButtonElement>('#sci-nucleus')?.addEventListener('click', () => open('nucleus'));
    sheet.querySelector<HTMLButtonElement>('#sci-shells')!.onclick = () => open('shells');
  }

  private showHow(): void {
    if (this.stage === 'home') return;
    const t = this.stepPuzzle(this.stage);
    openRules(t, {
      reducedMotion: this.save.settings.reducedMotion,
      footer: `<h3>What it adds</h3><p class="meta">${this.stepContribution(this.stage)}</p>`,
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
    if (this.stage === 'nucleus') {
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

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));


export { FAMILY_COLOURS, electronCount };
