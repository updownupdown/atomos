import { AtomScene, type ScreenPoint } from './render/scene';
import { applyPlacement, electronCount, newAtom, resolvePlacement, type Atom } from './core/physics';
import { FAMILY_COLOURS, MAX_Z, element } from './core/elements';
import {
  MODE_LABEL, decayProducts, findIsotope, formatDuration, isFleeting, isStable,
  isotopeKey, isotopesOf, sampleLifetime, type Isotope,
} from './core/isotopes';
import { frontier, loadSave, writeSave, type OrbitalShape, type SaveData, type StepId } from './core/save';
// The gallery's gate puzzles (lenses, nucleus view, looks); loaded here so they are ready.
import './puzzles/unlock';
import { atomProgress, fleetingCount, fleetingDealZ, fleetingIsotopes, isotopeCollected, isotopeGame, ISOTOPE_GAMES_LIST, lastingIsotopes, rowNeed, rowOf, rowOpen, rowSpan, segmentsOf, shapeAt, stepState, stepsOf, type IsotopeGame, type StepState } from './core/progress';
import { SHAPE_GLYPH_Z } from './core/unlocks';
import { nextLabel, nextStep, notePaused, type NextStep } from './core/next';
import { firstTimeLine } from './ui/nu';
import { tableColour } from './core/paint';
import { Detail } from './gallery/detail';
import type { AtomLit } from './gallery/atom';
import { createAtomBar, type AtomBar } from './gallery/atombar';
import { refreshModeProgress } from './ui/modebar';
import { buildTracks, drawWitness, slowFactor } from './ui/witness';
import { mergeLevel, orbitalGridLevel } from './puzzles/levels';
import { MergeView } from './puzzles/mergeView';
import { OrbitalGridView } from './puzzles/orbitalGridView';
import { solvedState, type PackingState } from './puzzles/packing';
import { type Area, type PuzzleView } from './puzzles/view';
import { dealSeed, puzzleIcon, puzzleType, type PuzzleType } from './puzzles/catalog';
import { difficulty, difficultyWord } from './puzzles/difficulty';
import { openRules } from './puzzles/rulesModal';
import { showWin, type WinAction } from './puzzles/winPanel';
import { closeModal, modalOpen, openModal } from './ui/modal';
import { createTabs, iconButton, nextButton, playButton } from './ui/components';
import { askRestart, confirming, restartButton } from './puzzles/restart';
import { HintControl } from './puzzles/hints';
import { clearOffers, createGameBar, offerRules, type GameBar } from './puzzles/gamebar';
import { fleetingRing, pipsHtml, progressRings } from './ui/progress';
import { countPlay, GOAL_PLAYS } from './core/plays';
import { icon, type IconName } from './ui/icons';
import { scienceButton, setScienceHandler } from './ui/science';
import { elementAt, shortConfiguration } from './gallery/data';
import * as sfx from './audio';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Droplet silver: the default electron colour until the player tints an element. */
/** 'home' is the atom's Build page; the others are its puzzles: the nucleus, the electrons, the
 *  orbital shape discovered on this atom, a lasting isotope with its fixed puzzle ('iso-7' builds
 *  the isotope with mass number 7), or a fleeting isotope with the puzzle the player picked
 *  ('fl-8-packing' builds the isotope with mass number 8 with Tessera). */
type IsoStage = `iso-${number}`;
type FleetStage = `fl-${number}-${IsotopeGame}`;
type Stage = 'home' | StepId | 'shape' | IsoStage | FleetStage;

const isIso = (s: Stage): s is IsoStage => s.startsWith('iso-');
const isoA = (s: IsoStage): number => Number(s.slice(4));
const isFleet = (s: Stage): s is FleetStage => s.startsWith('fl-');
const fleetA = (s: FleetStage): number => Number(s.split('-')[1]);
const fleetGame = (s: FleetStage): IsotopeGame => s.split('-')[2] as IsotopeGame;

const STEP_LABEL: Record<StepId, string> = { nucleus: 'Nucleus', shells: 'Electrons' };

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
  /** The navigator along the foot of the Build page, the same one View uses. */
  private bar: AtomBar;
  private closeWin: () => void = () => {};
  /** The next step, as of the last time the Build page was drawn. */
  private nextHere: NextStep | null = null;
  private busy = false;
  private overlay = $<HTMLCanvasElement>('overlay');
  private modalCleanup: (() => void) | null = null;
  private loopRaf = 0;
  private pointerId: number | null = null;
  private shownHint = '';
  private paused = false;
  /** The game's goal, shown before the first move of its first plays. */
  private goal = '';
  /** The Hint button: Look here, then Show me. */
  private hints = new HintControl(() => (this.busy ? null : this.puzzle), () => { this.refresh(); this.ensureLoop(); });
  /** The frame of a puzzle: stats, Back and the tools on top, the message line under it. */
  private gbar!: GameBar;

  constructor(private hooks: { onElement?: (z: number) => void; onView?: (z: number) => void } = {}) {
    this.scene = new AtomScene($<HTMLCanvasElement>('atom'));
    this.detail = new Detail($<HTMLCanvasElement>('bh-atom'));
    this.detail.setRings(false);
    this.bar = createAtomBar({ onChange: (z) => this.start(z), locked: (z) => !rowOpen(rowOf(z), this.save) });
    $('build-bar').append(this.bar.el);
    this.applySettings();
    this.bindInput();
    this.z = frontier(this.save, MAX_Z);
    this.start(this.z);
    this.processDecays(true);
    window.setInterval(() => this.processDecays(false), 1000);
    window.addEventListener('resize', () => this.resizeOverlay());
    this.resizeOverlay();
  }

  // ---- lifecycle --------------------------------------------------------------

  /** Open the puzzles for an element, from the app shell. */
  openElement(z: number): void {
    this.start(Math.min(MAX_Z, Math.max(1, z)));
    this.resizeOverlay();
    window.dispatchEvent(new Event('resize'));
  }

  get currentZ(): number { return this.z; }

  /** Opens one of an atom's puzzles, from the Next button anywhere in the app. A puzzle under way
   *  is kept to pick up later; a stage that isn't open yet leaves the player on the Build page. */
  play(z: number, stage: string): void {
    if (this.busy) return;
    if (z !== this.z) this.start(Math.min(MAX_Z, Math.max(1, z)));
    else this.suspend();
    const s = stage as Stage;
    if (s === this.stage) return;
    if (this.canPlay(s)) this.enter(s);
    else if (this.stage !== 'home') this.enter('home');
  }

  /** Whether a stage can be played on this atom now. */
  private canPlay(s: Stage): boolean {
    const z = this.z;
    if (s === 'home') return true;
    if (s === 'nucleus' || s === 'shells') return stepsOf(z).includes(s) && rowOpen(rowOf(z), this.save);
    if (s === 'shape') return shapeAt(z) !== undefined;
    const built = Boolean(this.save.built[z]);
    if (isIso(s)) return built && lastingIsotopes(z).some((i) => i.a === isoA(s));
    if (isFleet(s)) return built && fleetingIsotopes(z).some((i) => i.a === fleetA(s)) && (ISOTOPE_GAMES_LIST as readonly string[]).includes(fleetGame(s));
    return false;
  }

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
    if (this.stage === 'home') this.showNextCard();
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
    this.syncPaused();
    this.hooks.onElement?.(z);
    const colour = this.colourFor(z);
    this.scene.setColour(colour);
    document.documentElement.style.setProperty('--el', colour);
    this.scene.setAtom(this.atom, this.neutrons, { pDiscovered: true });
    this.detail.show(elementAt(z), false);
    this.detail.setLit(this.litState());
    this.bar.set(z);
    $('build-home').scrollTop = 0;
    this.enter('home');
    this.showNextCard();
  }

  /** Brings the card with the Next button into view, if it is below the fold. */
  private showNextCard(): void {
    const row = $('bh-in').querySelector<HTMLElement>('.bh-row.is-go');
    if (!row || this.paused) return;
    requestAnimationFrame(() => row.scrollIntoView({ block: 'nearest', behavior: this.save.settings.reducedMotion ? 'auto' : 'smooth' }));
  }

  /** Shows the Build page or one of the atom's puzzles. A puzzle left part-way picks up where it was. */
  private enter(stage: Stage): void {
    this.closeWin();
    this.stage = stage;
    this.shownHint = '';
    if (stage === 'home') {
      this.puzzle = null;
      clearOffers(this.gbar);
    } else {
      const resumed = this.suspended[stage];
      this.puzzle = resumed ?? this.makePuzzle(stage);
      if (!resumed) this.firstPlays(stage);
      delete this.suspended[stage];
      this.syncPaused();
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

  /** The 3D atom in the orbital colors, the same as in View: dimmed until it is built. */
  private makePuzzle(stage: Exclude<Stage, 'home'>): PuzzleView {
    const reduced = this.save.settings.reducedMotion;
    const z = this.z;
    if (isIso(stage)) {
      const a = isoA(stage);
      const game = isotopeGame(z, a) ?? 'packing';
      return puzzleType(game).deal!(z, dealSeed(`isotope:${game}`, z, a), reduced, a);
    }
    if (isFleet(stage)) {
      const a = fleetA(stage);
      const game = fleetGame(stage);
      const dz = game === 'merge' ? z : this.fleetDealZ(a);
      return puzzleType(game).deal!(dz, dealSeed(`fleeting:${game}`, z, a), reduced, a);
    }
    if (stage === 'shape') return puzzleType('codebreaker').make!(SHAPE_GLYPH_Z[shapeAt(z)!], 0, reduced);
    if (stage === 'shells') return new OrbitalGridView(orbitalGridLevel(z), reduced);
    return new MergeView(mergeLevel(z), reduced);
  }

  /** A game's first plays: Nu offers its rules the first time, and its goal leads the message
   *  line for the first three, until the first move. */
  private firstPlays(stage: Exclude<Stage, 'home'>): void {
    const t = this.stagePuzzle(stage);
    const before = countPlay(t.id);
    this.goal = before < GOAL_PLAYS ? t.goal : '';
    offerRules(this.gbar, t, () => this.openRulesFor(t));
  }

  /** The element a fleeting isotope's board is dealt for: harder the shorter it lives. */
  private fleetDealZ(a: number): number {
    const iso = fleetingIsotopes(this.z).find((i) => i.a === a);
    return iso ? fleetingDealZ(this.z, iso) : this.z;
  }

  /** Back to the Build page, keeping a puzzle that is under way. */
  private toHome(): void {
    if (this.busy) return;
    this.suspend();
    this.enter('home');
  }

  /** Keeps the puzzle on screen, if it is under way, to pick up later. */
  private suspend(): void {
    if (this.stage !== 'home' && this.puzzle && this.puzzle.moves > 0 && !this.puzzle.won) {
      this.suspended[this.stage] = this.puzzle;
      this.syncPaused();
    }
  }

  /** Tells nextStep about the puzzle kept half done, so Next everywhere offers to resume it. */
  private syncPaused(): void {
    const stage = Object.keys(this.suspended)[0] as Exclude<Stage, 'home'> | undefined;
    notePaused(stage ? { z: this.z, stage, game: this.stagePuzzle(stage).id } : null);
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
    steps[id] = { flawless: (prev?.flawless ?? false) || this.cleanRun(p), best: Math.min(prev?.best ?? Infinity, p.moves) };
    this.saveProgress();
  }

  /** Solved cleanly and without Show me: a hinted run is never flawless. */
  private cleanRun(p: PuzzleView): boolean {
    return p.clean && !this.hints.used(p);
  }

  /** The win panel's word on a run that used Show me. */
  private hintNote(p: PuzzleView): string {
    return this.hints.used(p) ? ' Built with a hint.' : '';
  }

  /** Saves, and tells the rest of the app (the mode row, the gallery) that progress changed. */
  private saveProgress(): void {
    writeSave(this.save);
    refreshModeProgress();
    window.dispatchEvent(new CustomEvent('atomos:progress', { detail: { z: this.z } }));
  }

  /** The atom's own color from its place in the table, for the faint atom behind a puzzle. */
  private colourFor(z: number): string {
    return tableColour(z);
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
    this.sayHint();
  }

  /** The header inside a puzzle: Back to the Build page, the puzzle's name, and what it builds. */
  private renderHead(): void {
    const stage = this.stage as Exclude<Stage, 'home'>;
    const t = this.stagePuzzle(stage);
    this.gbar.setTitle(t.name);
    this.gbar.setBack(element(this.z).name);
    this.gbar.setDifficulty(difficulty(t.id, this.dealtFor(stage)));
  }

  /** The catalog entry for a puzzle on this atom. */
  private stagePuzzle(stage: Exclude<Stage, 'home'>, z = this.z): PuzzleType {
    if (isIso(stage)) return puzzleType(isotopeGame(z, isoA(stage)) ?? 'packing');
    if (isFleet(stage)) return puzzleType(fleetGame(stage));
    if (stage === 'shape') return puzzleType('codebreaker');
    return puzzleType(stage === 'nucleus' ? 'merge' : 'orbitalGrid');
  }

  /** What a puzzle adds to this atom, in a sentence. */
  private contribution(stage: Exclude<Stage, 'home'>): string {
    const el = element(this.z);
    const name = el.name.toLowerCase();
    if (isIso(stage) || isFleet(stage)) {
      const a = isIso(stage) ? isoA(stage) : fleetA(stage);
      return `Builds ${name}-${a}: ${el.z} proton${el.z === 1 ? '' : 's'} with ${a - el.z} neutron${a - el.z === 1 ? '' : 's'}.`;
    }
    if (stage === 'shape') return `Discovers the shape of ${shapeAt(this.z)} orbitals, so the 3D Shapes view can draw them in every atom.`;
    if (stage === 'shells') return `Settles ${el.z} electron${el.z === 1 ? '' : 's'} into ${name}'s orbitals: ${shortConfiguration(elementAt(this.z))}.`;
    if (this.z === 1) return 'Hydrogen\'s nucleus is a single proton, so there is nothing to gather.';
    return `Gathers ${el.z} protons and ${this.neutrons} neutrons into ${name}'s nucleus.`;
  }

  // ---- the Build page ---------------------------------------------------------------

  /** The atom's Build page: the atom up top, the bar of everything there is to build (which
   *  stays in view), then a section per part, each under a full-width heading: Nucleus and
   *  Electrons (in any order), then the stable and unstable isotopes once the atom is built. */
  private renderHome(): void {
    const z = this.z;
    const el = element(z);
    const built = this.save.built[z];
    const name = el.name.toLowerCase();
    this.renderProgress();

    const row = rowOf(z);
    const open = rowOpen(row, this.save);
    const need = rowNeed(row, this.save);
    const more = need.need - need.built;
    const shut = `Build ${more} more atom${more === 1 ? '' : 's'} in row ${row - 1}`;
    const step = (id: StepId) => {
      const st = this.stepState(z, id);
      return this.card({ stage: id, text: this.adds(id), done: st.done, flawless: st.flawless, best: st.best, locked: open ? undefined : shut });
    };

    const lasting = lastingIsotopes(z);
    const isoCard = (iso: (typeof lasting)[number]) => {
      const life = iso.stable ? `stable${iso.abundance ? `, ${formatPercent(iso.abundance)} on Earth` : ''}` : `half-life ${formatDuration(iso.halfLife ?? 0)}`;
      const n = iso.a - el.z;
      return this.card({
        stage: `iso-${iso.a}`,
        iso: `${el.symbol}-${iso.a}`,
        text: `${n} neutron${n === 1 ? '' : 's'} · ${life}`,
        done: isotopeCollected(this.save, z, iso.a),
        flawless: false,
        locked: built ? undefined : `Opens once ${name} is built`,
      });
    };
    const stable = lasting.filter((i) => i.stable);
    const longLived = lasting.filter((i) => !i.stable);
    const got = (list: typeof lasting) => list.filter((i) => isotopeCollected(this.save, z, i.a)).length;
    const live = this.save.specimens.some((sp) => sp.z === z);
    const later = built ? '' : ` They open once ${name} is built.`;
    const fleeting = fleetingIsotopes(z);
    const fc = fleetingCount(z, this.save);

    // Where an orbital shape first appears, Glyph discovers it: until then it is a locked extra.
    const shape = shapeAt(z);
    const shapeCard = shape ? this.card({
      stage: 'shape',
      text: `The shape of ${shape} orbitals, for the 3D Shapes view`,
      done: Boolean(this.save.shapes[shape]),
      flawless: false,
      best: this.save.shapes[shape]?.best,
      gate: `${el.name} is the first atom with ${shape} orbitals. Crack the code to see their shape.`,
    }) : '';

    const steps = stepsOf(z);
    this.nextHere = nextStep(this.save, z);
    $('bh-in').innerHTML = [
      open ? '' : this.section('lock', `Row ${row} is locked`, `${need.built} of ${need.need}`, '',
        `Row ${row} opens once you've built ${need.need} of the ${this.rowSize(row - 1)} atoms in row ${row - 1}. ${shut} to open it.`),
      this.section('nucleus', STEP_LABEL.nucleus, '', z === 1 ? this.hydrogenNucleus() : step('nucleus'), '', '', z === 1 || this.stepState(z, 'nucleus').done),
      steps.includes('shells') ? this.section('electrons', STEP_LABEL.shells, '', step('shells'), '', '', this.stepState(z, 'shells').done) : '',
      stable.length ? this.section('isotope-stable', 'Stable isotopes', `${got(stable)} of ${stable.length}`, stable.map(isoCard).join(''),
        `${el.name} with other numbers of neutrons that never decay.${later}`, '', got(stable) === stable.length) : '',
      longLived.length ? this.section('isotope-unstable', 'Long-lived isotopes', `${got(longLived)} of ${longLived.length}`, longLived.map(isoCard).join(''),
        `Ones that decay, but slowly: a year or more.${later}`,
        live ? `<button class="text-btn bh-bench" id="bh-bench">Watch your unstable isotopes</button>` : '', got(longLived) === longLived.length) : '',
      fleeting.length ? this.section('isotope-fleeting', 'Fleeting isotopes', `${fc.built} of ${fc.total}`, '',
        `Gone in under a year. Pick any isotope puzzle for each: the shorter it lives, the harder the board. They don't count toward ${name}'s 100%.${later}`,
        this.fleetingGrid(fleeting, Boolean(built)), fc.total > 0 && fc.built === fc.total) : '',
      shapeCard ? this.section('unlock', 'Discoveries', '', shapeCard, '', '', Boolean(shape && this.save.shapes[shape])) : '',
      // The microscope, on its own row at the foot of the page.
      `<div class="bh-sci-row" id="bh-sci-row"></div>`,
    ].join('');
    $('bh-sci-row').append(scienceButton());

    const root = $('bh-in');
    const verbIcon: Record<string, IconName> = { Replay: 'restart', Unlock: 'unlock', Resume: 'play', Play: 'play' };
    root.querySelectorAll<HTMLElement>('.bh-slot').forEach((slot) => {
      const stage = slot.dataset.slot as Stage;
      const go = () => this.enter(stage);
      const verb = slot.dataset.verb!;
      const b = slot.dataset.next === '1'
        ? nextButton({ label: verb, onClick: go, compact: true, landKey: `build:${z}`, className: 'bh-go' })
        : playButton({ label: verb, ariaLabel: `${verb} ${slot.dataset.what}`, onClick: go, compact: true, className: 'bh-plain', icon: verbIcon[verb], locked: slot.dataset.locked === '1' });
      slot.replaceWith(b);
    });
    root.querySelector<HTMLButtonElement>('#bh-bench')?.addEventListener('click', () => this.showBench(z));
    this.firstLines();
    root.querySelectorAll<HTMLElement>('[data-fleet]').forEach((r) => {
      r.onclick = () => this.pickFleeting(Number(r.dataset.fleet));
      r.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.pickFleeting(Number(r.dataset.fleet)); } };
    });
  }

  /** Nu's lines the first time: on the first Build page, and once an atom is built, above its
   *  isotopes. Not while a win panel is up, whose tap would dismiss them unseen. */
  private firstLines(): void {
    if (this.paused || $('app').querySelector('.win')) return;
    const root = $('bh-in');
    const first = root.querySelector('.bh-sec');
    if (first) firstTimeLine('build-page', 'Each atom is two puzzles: its nucleus and its electrons. Play either one.', first);
    const iso = this.save.built[this.z] ? root.querySelector('[aria-label="Stable isotopes"], [aria-label="Long-lived isotopes"], [aria-label="Fleeting isotopes"]') : null;
    if (iso) firstTimeLine('first-built', "Its isotopes are open. They're optional, for when you want more.", iso);
  }

  /** How many atoms a row of the table holds. */
  private rowSize(row: number): number {
    const [first, last] = rowSpan(row);
    return last - first + 1;
  }

  /** Whether a built fleeting isotope has decayed by now: two half-lives after it was built
   *  (at once when its half-life is unknown, or it was built before builds were dated). */
  private fleetDecayed(a: number, halfLife: number | null): boolean {
    const rec = this.save.isotopes[isotopeKey(this.z, a)];
    if (!rec?.collected) return false;
    if (!rec.at || halfLife === null) return true;
    return Date.now() - rec.at > 2 * halfLife * 1000;
  }

  /** The fleeting isotopes as a table, one row per isotope: its name, neutrons, half-life, its
   *  status (built, decayed) as two marks, and a chevron; a legend for the marks under it. A row
   *  opens the choice of puzzle. */
  private fleetingGrid(list: ReturnType<typeof fleetingIsotopes>, open: boolean): string {
    const el = element(this.z);
    return `<table class="bh-fleet${open ? '' : ' is-shut'}" aria-label="${el.name}'s fleeting isotopes">
      <thead><tr><th scope="col">Isotope</th><th scope="col" class="n">Neutrons</th><th scope="col" class="n">Half-life</th><th scope="col" class="c">Status</th><th scope="col"><span class="sr-only">Open</span></th></tr></thead>
      <tbody>${list.map((i) => {
        const done = isotopeCollected(this.save, this.z, i.a);
        const gone = done && this.fleetDecayed(i.a, i.halfLife);
        const life = i.halfLife === null ? 'unknown' : formatDuration(i.halfLife);
        const state = done ? (gone ? ', built, decayed' : ', built') : '';
        return `<tr class="${done ? 'is-built' : ''}"${open ? ` data-fleet="${i.a}" tabindex="0" role="button" aria-label="${el.symbol}-${i.a}, half-life ${life}${state}"` : ''}>
          <th scope="row">${el.symbol}-${i.a}</th><td class="n">${i.a - el.z}</td><td class="n">${life}</td>
          <td class="c"><span class="bh-fleet-st"><i class="bh-st-done${done ? ' on' : ''}">${icon('done', { size: 18 })}</i><i class="bh-st-gone${gone ? ' on' : ''}">${icon('decayed', { size: 18 })}</i></span></td>
          <td class="bh-fleet-go">${icon('chevron-right', { size: 18 })}</td>
        </tr>`;
      }).join('')}</tbody></table>
      <p class="bh-fleet-legend"><span><i class="bh-st-done on">${icon('done', { size: 16 })}</i>Built</span><span><i class="bh-st-gone on">${icon('decayed', { size: 16 })}</i>Decayed</span></p>`;
  }

  /** A fleeting isotope's sheet: what it is, and the puzzles it can be built with, each at the
   *  difficulty its half-life deals. */
  private pickFleeting(a: number): void {
    const el = element(this.z);
    const iso = fleetingIsotopes(this.z).find((i) => i.a === a);
    if (!iso) return;
    const n = a - el.z;
    const done = isotopeCollected(this.save, this.z, a);
    const used = this.save.isotopes[isotopeKey(this.z, a)]?.game;
    const life = iso.halfLife === null ? 'Its half-life has never been measured' : `Half-life ${formatDuration(iso.halfLife)}`;
    const dz = fleetingDealZ(this.z, iso);
    const rows = ISOTOPE_GAMES_LIST.map((g) => {
      const t = puzzleType(g);
      const rating = difficulty(g, g === 'merge' ? this.z : dz);
      return `<li><button class="bh-pick" data-game="${g}">
        <span class="bh-mark" aria-hidden="true">${puzzleIcon(g, 32)}</span>
        <span class="bh-pick-body"><b>${t.name}</b><span class="bh-diff">${pipsHtml(rating)}${difficultyWord(rating)}</span></span>
        ${icon('play', { size: 18 })}
      </button></li>`;
    }).join('');
    const sheet = this.openModal(`
      <h2>${el.name}-${a}</h2>
      <p>${n} neutron${n === 1 ? '' : 's'}. ${life}.${done ? ` Built${used ? ` with ${puzzleType(used).name}` : ''}; ${this.fleetDecayed(a, iso.halfLife) ? 'it has long since decayed, but stays in your collection' : 'it is decaying now, and stays in your collection after'}.` : ''}</p>
      <p class="muted">Pick a puzzle to build it${done ? ' again' : ''}. The shorter an isotope lives, the harder its board.</p>
      <ul class="bh-picks">${rows}</ul>`);
    sheet.querySelectorAll<HTMLButtonElement>('[data-game]').forEach((b) => (b.onclick = () => {
      this.closeModal();
      this.enter(`fl-${a}-${b.dataset.game as IsotopeGame}`);
    }));
  }

  /** One part of the Build page under a full-width heading: its name, how far it has got on the
   *  right with a check once it is complete, a line on what it is, then its puzzles. */
  private section(_glyph: IconName, title: string, count: string, cards: string, blurb = '', after = '', done = false): string {
    return `
      <section class="bh-sec${done ? ' is-done' : ''}" aria-label="${title}">
        <div class="bh-sec-head">
          <h3>${title}</h3>
          ${count ? `<span class="bh-sec-count">${count}</span>` : ''}
          ${done ? `<span class="bh-sec-done" role="img" aria-label="Complete">${icon('done', { size: 22 })}</span>` : ''}
        </div>
        ${blurb ? `<p class="bh-sec-blurb">${blurb}</p>` : ''}
        ${cards ? `<ol class="bh-steps">${cards}</ol>` : ''}
        ${after}
      </section>`;
  }

  /** What a step adds, in a few words: the heading above says which part it builds. */
  private adds(stage: StepId): string {
    const el = element(this.z);
    if (stage === 'shells') return `${el.z} electron${el.z === 1 ? '' : 's'}`;
    return `${el.z} proton${el.z === 1 ? '' : 's'}, ${this.neutrons} neutron${this.neutrons === 1 ? '' : 's'}`;
  }

  /** The element a stage's board is dealt for, which sets how hard it is. */
  private dealtFor(stage: Exclude<Stage, 'home'>): number {
    if (isFleet(stage)) return fleetGame(stage) === 'merge' ? this.z : this.fleetDealZ(fleetA(stage));
    return stage === 'shape' ? SHAPE_GLYPH_Z[shapeAt(this.z)!] : this.z;
  }

  /** One puzzle card: the puzzle's icon on its own at the left; then, in one column, its name
   *  (or, for an isotope, the isotope's), a rough difficulty, what it adds and a note; on the
   *  right its button, every kind the same pill (Play, Replay, Unlock, Locked), with Built or
   *  Flawless above it once it is done. Everything is centred vertically. */
  private card(o: { stage: Exclude<Stage, 'home'>; title?: string; iso?: string; text: string; done: boolean; flawless: boolean; best?: number; locked?: string; gate?: string }): string {
    const t = this.stagePuzzle(o.stage);
    const paused = this.suspended[o.stage];
    const gated = Boolean(o.gate) && !o.done;
    const cls = o.locked ? 'is-locked' : gated ? 'is-gate is-next' : o.done ? (o.flawless ? 'is-flawless' : 'is-done') : 'is-next';
    const flawless = o.done && o.flawless && !isIso(o.stage);
    const state = paused ? 'In progress'
      : o.done ? `${icon(flawless ? 'star' : 'check', { size: 14 })}${o.gate ? 'Discovered' : flawless ? 'Flawless' : 'Built'}`
      : '';
    const note = o.locked ? o.locked
      : gated && !paused ? o.gate
      : paused ? `${paused.moves} move${paused.moves === 1 ? '' : 's'} so far`
      : '';
    const verb = paused ? 'Resume' : o.done ? 'Replay' : gated ? 'Unlock' : 'Play';
    const isNext = !o.locked && this.nextHere?.z === this.z && this.nextHere.stage === o.stage;
    // The button is mounted after render: Next on the next step, the gray pill on the rest.
    const play = `<span class="bh-slot" data-slot="${o.stage}" data-next="${isNext ? 1 : 0}" data-verb="${o.locked ? 'Locked' : verb}" data-what="${t.name}${o.iso ? `: ${o.iso}` : ''}"${o.locked ? ' data-locked="1"' : ''}></span>`;
    const rating = difficulty(t.id, this.dealtFor(o.stage));

    return `
      <li class="bh-row ${cls}${isNext ? ' is-go' : ''}">
        <div class="bh-step">
          <span class="bh-mark" aria-hidden="true">${puzzleIcon(t.id, 32)}</span>
          <div class="bh-step-body">
            <h4 class="bh-step-name">${o.title ?? t.name}</h4>
            <p class="bh-diff">${pipsHtml(rating)}${difficultyWord(rating)}</p>
            ${o.iso ? `<p class="bh-iso">${o.iso}</p>` : ''}
            <p class="bh-adds">${o.text}</p>
            ${note ? `<p class="bh-where">${note}</p>` : ''}
          </div>
          <div class="bh-side">
            ${state ? `<span class="bh-state">${state}</span>` : ''}
            ${play}
          </div>
        </div>
      </li>`;
  }

  /** Hydrogen's nucleus, ready from the start. */
  private hydrogenNucleus(): string {
    return `
      <li class="bh-row is-done">
        <div class="bh-step">
          <span class="bh-mark" aria-hidden="true">${icon('atom', { size: 32 })}</span>
          <div class="bh-step-body">
            <h4 class="bh-step-name">A lone proton</h4>
            <p class="bh-adds">Ready from the start</p>
          </div>
          <div class="bh-side"><span class="bh-state">${icon('check', { size: 14 })}Built</span></div>
        </div>
      </li>`;
  }

  /** The rings at the foot of the atom: a disc for the nucleus and a ring for the electrons, lit
   *  once built, and an outer ring for the isotopes, if any: an arc for the lasting ones and one
   *  for the fleeting ones, sized by how many of each there are, each filling as they are built.
   *  Beside them, the atom's share built (nucleus, electrons and lasting isotopes) and, smaller,
   *  the fleeting isotopes' share. */
  private renderProgress(): void {
    const z = this.z;
    const pct = Math.round(atomProgress(z, this.save) * 100);
    const nucleus = stepState(this.save, z, 'nucleus').done;
    const shells = stepState(this.save, z, 'shells').done;
    const lasting = lastingIsotopes(z);
    const lastingDone = lasting.filter((i) => isotopeCollected(this.save, z, i.a)).length;
    const fleet = fleetingCount(z, this.save);
    const fleetPct = fleet.total ? Math.round((fleet.built / fleet.total) * 100) : 0;
    // Left: the rings of what counts toward the atom (nucleus, electrons, lasting isotopes) and
    // its share, "Stable". Right, mirrored: the fleeting isotopes' own ring and count.
    $('bh-progress').innerHTML = `
      <div class="bh-prog-main">
        ${progressRings({ nucleus, shells, lasting: { built: lastingDone, total: lasting.length }, fleeting: { built: 0, total: 0 } })}
        <div class="bh-rings-text">
          <b${pct >= 100 ? ' class="is-done"' : ''}>${pct}%</b>
          <span>Stable</span>
        </div>
      </div>
      ${fleet.total ? `<div class="bh-prog-fleet">
        <div class="bh-rings-text">
          <b${fleet.built >= fleet.total ? ' class="is-done"' : ''}>${fleet.built} of ${fleet.total}</b>
          <span>Fleeting</span>
        </div>
        ${fleetingRing(fleet.built, fleet.total)}
      </div>` : ''}`;
    $('bh-progress').setAttribute('aria-label', `${pct}% built${fleet.total ? `, ${fleet.built} of ${fleet.total} fleeting isotopes (${fleetPct}%)` : ''}`);
  }

  private openRulesFor(t: PuzzleType): void {
    openRules(t, { reducedMotion: this.save.settings.reducedMotion });
  }

  private sayHint(): void {
    const p = this.puzzle;
    // The Hint button's line while its board is on screen; otherwise a short status only (how-to
    // text lives behind the i).
    const help = this.hints.line(p);
    const raw = p ? p.hint().replace(/<[^>]+>/g, '') : '';
    const goal = p && this.goal && p.moves === 0 ? this.goal : '';
    const text = help ?? (goal || (raw.length > 60 ? '' : raw));
    this.shownHint = text;
    this.gbar.update(p, text);
  }

  private say(text: string): void {
    this.shownHint = text;
    this.gbar.msg.textContent = text;
  }

  // ---- the puzzle loop --------------------------------------------------------------

  private area(): Area {
    const top = $('build-head').getBoundingClientRect().bottom + 8;
    const bottom = $('build-foot').getBoundingClientRect().top - 8;
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
    const area = this.area();
    if (area.w <= 0 || area.h <= 0) {
      this.loopRaf = requestAnimationFrame((t) => this.frame(t));
      return;
    }
    const ctx = this.overlayCtx();
    p.draw(ctx, area, now);
    this.drawSweep(ctx);
    this.hints.watch(p, now);
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
    if (stage === 'shape') {
      this.discoverShape(p);
      return;
    }
    if (isIso(stage) || isFleet(stage)) {
      const a = isIso(stage) ? isoA(stage) : fleetA(stage);
      this.collectIsotope(a, isFleet(stage) ? fleetGame(stage) : undefined);
      sfx.harmonySound();
      this.busy = false;
      this.isotopeWon(a, p, isFleet(stage));
      return;
    }
    const wasBuilt = Boolean(this.save.built[this.z]);
    this.recordStep(stage, p);
    if (stage === 'shells') this.atom = fullAtom(this.z);
    this.scene.setAtom(this.atom, this.neutrons, { pDiscovered: true });
    // Back on the Build page, the part just solved lights up in the 3D atom before the win shows.
    this.enter('home');
    $('build-home').scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    await this.lightUp(stage);
    this.busy = false;
    const bothDone = stepsOf(this.z).every((id) => this.stepState(this.z, id).done);
    if (bothDone) this.finish(p, stage, wasBuilt);
    else this.stepWon(stage, p);
  }

  /** The 3D atom's parts in color as far as they are solved: the nucleus once its puzzle is
   *  solved, the electrons once Quanta is. Gray until then. */
  private litState(): AtomLit {
    return {
      nucleus: this.stepState(this.z, 'nucleus').done,
      electrons: this.stepState(this.z, 'shells').done ? this.z : 0,
    };
  }

  /** A step just solved comes alive in the 3D atom: the nucleus all at once, the electrons one
   *  subshell at a time, each in its orbital color as it fills. */
  private async lightUp(stage: StepId): Promise<void> {
    const reduced = this.save.settings.reducedMotion;
    const lit = this.litState();
    if (stage === 'nucleus') {
      sfx.harmonySound();
      this.detail.setLit(lit, true);
      await wait(reduced ? 150 : 700);
      return;
    }
    let electrons = 0;
    this.detail.setLit({ ...lit, electrons });
    await wait(reduced ? 100 : 400);
    for (const sub of elementAt(this.z).subshells) {
      electrons += sub.count;
      this.detail.setLit({ ...lit, electrons }, true);
      sfx.captureSound();
      await wait(reduced ? 60 : 350);
    }
    await wait(reduced ? 100 : 400);
  }

  /** Glyph solved on the atom where an orbital shape first appears: the shape is discovered, and
   *  the 3D Shapes view draws it in every atom from now on. */
  private discoverShape(p: PuzzleView): void {
    const l = shapeAt(this.z)!;
    const prev = this.save.shapes[l];
    const best = prev?.best === undefined ? p.moves : Math.min(prev.best, p.moves);
    this.save.shapes[l] = { at: prev?.at ?? Date.now(), best };
    this.saveProgress();
    sfx.completeSound();
    this.busy = false;
    this.closeWin = showWin($('app'), {
      kicker: prev ? 'Solved again' : 'Discovered',
      title: `The ${l} orbital shape`,
      flawless: false,
      stats: this.winStats(p),
      note: prev ? `Your best is ${best} move${best === 1 ? '' : 's'}.` : `The Shapes view in 3D now draws ${l} orbitals in every atom that has them.`,
      actions: this.winActions(),
    }, this.save.settings.reducedMotion);
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

  /** The way back to this atom's Build page. */
  private backAction(primary = false): WinAction {
    return { label: `Back to ${element(this.z).name.toLowerCase()}`, primary, onClick: () => this.enter('home') };
  }

  /** What every win panel offers: the Next step first (or Back, once everything is done), then
   *  a look at the atom once it is built, or the way back to its Build page. */
  private winActions(): WinAction[] {
    const step = nextStep(this.save, this.z);
    const el = element(this.z);
    const look: WinAction = this.save.built[this.z] && this.hooks.onView
      ? { label: `Look at ${el.name.toLowerCase()}`, onClick: () => { this.enter('home'); this.hooks.onView!(this.z); } }
      : this.backAction();
    if (!step) return [{ ...look, primary: true }, ...(look.label.startsWith('Back') ? [] : [this.backAction()])];
    return [{ label: nextLabel(step), next: true, onClick: () => this.goTo(step) }, look];
  }

  /** Takes the player to a step, on this atom or another. */
  private goTo(step: NextStep): void {
    this.play(step.z, step.stage);
  }

  /** One of the two puzzles solved, the atom not yet whole: say what it added. */
  private stepWon(step: StepId, p: PuzzleView): void {
    const el = element(this.z);
    const note = step === 'nucleus'
      ? `${el.z} protons and ${this.neutrons} neutrons, held together. ${el.name} still needs its electrons.`
      : `${el.z} electrons in their orbitals. ${el.name} still needs its nucleus.`;
    const clean = this.cleanRun(p);
    this.closeWin = showWin($('app'), {
      kicker: clean ? 'Flawless' : 'Solved',
      title: `${el.name}'s ${step === 'nucleus' ? 'nucleus' : 'electrons'}`,
      flawless: clean,
      stats: this.winStats(p, step),
      note: note + this.hintNote(p),
      actions: this.winActions(),
    }, this.save.settings.reducedMotion);
  }

  /** Both puzzles done: the atom joins the collection (or is rebuilt). */
  private finish(p: PuzzleView, step: StepId, wasBuilt: boolean): void {
    const prev = this.save.built[this.z];
    // Saved from every step's best run; this run itself is flawless only without Show me.
    const flawless = stepsOf(this.z).every((id) => this.stepState(this.z, id).flawless) && !this.hints.used(p);
    this.save.built[this.z] = { flawless: (prev?.flawless ?? false) || flawless, colour: prev?.colour };
    const el = element(this.z);
    const key = isotopeKey(this.z, el.commonA);
    this.save.isotopes[key] = { ...this.save.isotopes[key], collected: true };
    this.saveProgress();
    if (step === 'nucleus' && electronCount(this.atom) < this.z) {
      this.atom = fullAtom(this.z);
      this.scene.setAtom(this.atom, this.neutrons, { pDiscovered: true });
    }
    this.detail.setLit(this.litState());
    this.scene.celebrate();
    sfx.completeSound();
    this.say('');
    const lasting = lastingIsotopes(this.z).length;
    const fleeting = fleetingIsotopes(this.z).length;
    const opened = [lasting ? `${lasting} lasting` : '', fleeting ? `${fleeting} fleeting` : ''].filter(Boolean).join(' and ');
    const note = wasBuilt
      ? `${el.name} rebuilt.${flawless && !prev?.flawless ? ' Flawless at last.' : ''}`
      : `${el.name} joins your collection, with ${el.name.toLowerCase()}-${el.commonA}, its most common isotope.${opened ? ` Its other isotopes are open: ${opened}.` : ''}`;
    window.setTimeout(() => {
      this.closeWin = showWin($('app'), {
        kicker: wasBuilt ? (flawless ? 'Flawless' : 'Rebuilt') : flawless ? 'Built, flawless' : 'Built',
        title: wasBuilt ? `${el.name}'s ${step === 'nucleus' ? 'nucleus' : 'electrons'}` : `${el.name} is built`,
        flawless,
        stats: this.winStats(p, step),
        note: this.hints.used(p) ? note + this.hintNote(p)
          : flawless || wasBuilt ? note : `${note} For a flawless one: no fusion past the target, and the electrons in par or fewer moves.`,
        actions: this.winActions(),
      }, this.save.settings.reducedMotion);
    }, this.save.settings.reducedMotion ? 200 : 900);
  }

  /** An isotope's board solved: it joins the collection (a fleeting one with the puzzle it was
   *  built with, for display). A known unstable isotope also starts its own life on the bench,
   *  decaying in real time. */
  private collectIsotope(a: number, game?: IsotopeGame): void {
    const z = this.z;
    const key = isotopeKey(z, a);
    this.save.isotopes[key] = { ...this.save.isotopes[key], collected: true, ...(game ? { game, at: Date.now() } : {}) };
    const known = findIsotope(z, a);
    if (known && !isStable(known) && !isFleeting(known) && !this.save.specimens.some((sp) => sp.z === z && sp.a === a)) {
      const now = Date.now();
      this.save.specimens.push({ id: `${key}-${now}`, z, a, createdAt: now, decayAt: now + sampleLifetime(known.halfLife!) * 1000 });
    }
    this.saveProgress();
  }

  private isotopeWon(a: number, p: PuzzleView, fleeting = false): void {
    const el = element(this.z);
    const parts = `${el.z} proton${el.z === 1 ? '' : 's'} and ${a - el.z} neutron${a - el.z === 1 ? '' : 's'}`;
    if (fleeting) {
      const iso = fleetingIsotopes(this.z).find((i) => i.a === a);
      const life = iso?.halfLife ? ` Half of it would be gone in ${formatDuration(iso.halfLife)};` : ' It decays almost at once;';
      const c = fleetingCount(this.z, this.save);
      this.closeWin = showWin($('app'), {
        kicker: 'Fleeting isotope built',
        title: `${el.name}-${a}`,
        flawless: false,
        stats: this.winStats(p),
        note: `${parts}.${life} it stays in your collection, marked decayed. ${c.built} of ${c.total} of ${el.name.toLowerCase()}'s fleeting isotopes built.${this.hintNote(p)}`,
        actions: this.winActions(),
      }, this.save.settings.reducedMotion);
      return;
    }
    this.closeWin = showWin($('app'), {
      kicker: 'Isotope built',
      title: `${el.name}-${a}`,
      flawless: false,
      stats: this.winStats(p),
      note: `${parts}, now in your collection.${this.hintNote(p)}`,
      actions: this.winActions(),
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
    const restart = restartButton(this.restartOptions());
    restart.id = 'btn-restart';
    this.hints.button.id = 'btn-hint';
    const how = iconButton({ icon: icon('info'), label: 'Instructions', onClick: () => this.showHow() });
    this.gbar = createGameBar([undo, restart, this.hints.button, how, scienceButton('ui-icon-btn science-btn')], { label: element(this.z).name, onClick: () => this.toHome() });
    $('build-head').append(this.gbar.el);
    $('build-foot').append(this.gbar.foot);
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
    this.hints.touched();
    this.ensureLoop();
  }

  private onCancel(): void {
    this.pointerId = null;
    this.puzzle?.cancel();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.paused || $('app').hidden || modalOpen() || confirming() || $('app').querySelector('.win')) return;
    if (e.key === 'Escape' && this.stage !== 'home') { this.toHome(); e.preventDefault(); return; }
    if (e.key === 'u' || (e.key === 'z' && (e.ctrlKey || e.metaKey))) return this.undo();
    if (e.key === 'r' && !e.ctrlKey && !e.metaKey) { void askRestart(this.restartOptions()); return; }
    if (e.key === 'h' && !e.ctrlKey && !e.metaKey && this.puzzle) { this.hints.ask(); return; }
    if (this.puzzle && !this.busy && this.puzzle.key(e)) {
      this.hints.touched();
      e.preventDefault();
      this.ensureLoop();
    }
  }

  private undo(): void {
    if (this.busy || !this.puzzle?.undo()) return;
    this.hints.undone();
    this.refresh();
    this.ensureLoop();
  }

  private restartPuzzle(): void {
    if (this.busy || !this.puzzle) return;
    this.puzzle.restart();
    this.hints.restarted(this.puzzle);
    this.refresh();
    this.ensureLoop();
  }

  /** Restart asks first; on yes Nu streaks across the board and the old moves fade behind it. */
  private restartOptions() {
    return {
      canRestart: () => !this.busy && this.puzzle !== null && this.puzzle.moves > 0,
      sweepOver: () => this.overlay,
      restart: () => {
        // Keep a picture of the old board to wipe away along Nu's trail.
        const snap = document.createElement('canvas');
        snap.width = this.overlay.width;
        snap.height = this.overlay.height;
        snap.getContext('2d')?.drawImage(this.overlay, 0, 0);
        this.sweep = { snap, p: 0 };
        this.restartPuzzle();
      },
      onSweep: (p: number) => {
        if (this.sweep) this.sweep.p = p;
        if (p >= 1) this.sweep = null;
        this.ensureLoop();
      },
    };
  }

  /** The old board, wiped from left to right as Nu crosses it after a restart. */
  private sweep: { snap: HTMLCanvasElement; p: number } | null = null;

  /** Draws what is left of the old board, right of Nu, fading as it goes. */
  private drawSweep(ctx: CanvasRenderingContext2D): void {
    const sw = this.sweep;
    if (!sw) return;
    const w = window.innerWidth, h = window.innerHeight;
    const x = sw.p * w;
    ctx.clearRect(x, 0, w - x, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, 0, w - x, h);
    ctx.clip();
    ctx.globalAlpha = 1 - sw.p * 0.5;
    ctx.drawImage(sw.snap, 0, 0, w, h);
    ctx.restore();
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

  private showWhy(): void {
    const t = this.stagePuzzle(this.stage === 'home' ? 'nucleus' : this.stage);
    this.openModal(t.science?.(this.z) ?? `<h2>${t.name}</h2><p>${t.blurb}</p>`);
  }

  /** The microscope on the Build page: what each step stands for in a real atom. */
  /** The Build page's microscope: what the atom is made of, one short tab per part, each with a
   *  way into the science of the puzzle that builds it (where the longer story lives). */
  private showBuildScience(): void {
    const z = this.z;
    const el = element(z);
    const n = this.neutrons;
    const vault = lastingIsotopes(z);
    const fleet = fleetingIsotopes(z);
    const games = [...new Set(vault.map((i) => isotopeGame(z, i.a) ?? 'packing'))];
    const word = (k: number, w: string) => (k === 1 ? w : `${w}s`);
    const stat = (value: string, label: string) => `<div class="bs-stat"><b>${value}</b><span>${label}</span></div>`;
    const more = (id: string) => { const t = puzzleType(id); return `<button class="secondary bs-more" data-sci="${id}">${puzzleIcon(id, 20)}<span>The science of ${t.name}</span></button>`; };
    const nucleusId = this.stagePuzzle('nucleus').id;
    const tabs: { id: string; label: string; html: () => string }[] = [
      { id: 'atom', label: 'Atom', html: () => `
        <div class="bs-stats">${stat(String(z), word(z, 'proton'))}${stat(String(n), word(n, 'neutron'))}${stat(String(z), word(z, 'electron'))}</div>
        <p>Protons decide which element it is. Electrons decide how it behaves.</p>` },
      { id: 'nucleus', label: 'Nucleus', html: () => `
        <div class="bs-stats">${stat(String(z), word(z, 'proton'))}${stat(String(n), word(n, 'neutron'))}</div>
        <p>${z === 1 ? 'A single proton: nothing to gather.' : 'Packed into a core 100,000 times smaller than the atom.'}</p>
        ${z === 1 ? '' : more(nucleusId)}` },
      { id: 'electrons', label: 'Electrons', html: () => `
        <div class="bs-stats">${stat(shortConfiguration(elementAt(z)), `${z} ${word(z, 'electron')}`)}</div>
        <p>They fill orbitals from the lowest energy up.</p>
        ${more('orbitalGrid')}` },
      ...(vault.length || fleet.length ? [{ id: 'isotopes', label: 'Isotopes', html: () => `
        <div class="bs-stats">${stat(String(vault.length), 'lasting')}${stat(String(fleet.length), 'fleeting')}</div>
        <p>The same protons with a different number of neutrons. Lasting ones are stable or live over a year; fleeting ones are gone sooner.</p>
        ${games.map(more).join('')}` }] : []),
    ];
    const sheet = this.openModal(`<h2>How ${el.name.toLowerCase()} is built</h2><div class="bs-tabs"></div><div class="bs-body"></div>`);
    const body = sheet.querySelector<HTMLElement>('.bs-body')!;
    const show = (id: string) => {
      body.innerHTML = tabs.find((t) => t.id === id)!.html();
      body.querySelectorAll<HTMLButtonElement>('[data-sci]').forEach((b) => (b.onclick = () => {
        const t = puzzleType(b.dataset.sci!);
        this.openModal(t.science?.(z) ?? `<h2>${t.name}</h2><p>${t.blurb}</p>`);
      }));
    };
    const tabRow = createTabs(tabs.map(({ id, label }) => ({ id, label })), { active: 'atom', onChange: show, label: 'Parts of the atom' });
    tabRow.el.classList.add('ui-tabs--fill');
    sheet.querySelector('.bs-tabs')!.append(tabRow.el);
    show('atom');
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
    const p = this.puzzle as unknown as { state: Record<string, unknown> };
    const st = p.state;
    if (this.puzzle instanceof MergeView) {
      st.filled = (st.sockets as number[]).length;
    } else if (this.stage === 'shells') {
      st.cells = [...(st.solution as number[])];
    } else if ('pieces' in st && 'outline' in st) {
      p.state = solvedState(st as unknown as PackingState) as unknown as Record<string, unknown>;
    } else {
      // Any other board: count it as won, for testing the flow.
      Object.defineProperty(this.puzzle, 'won', { get: () => true, configurable: true });
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

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));


export { FAMILY_COLOURS, electronCount };


