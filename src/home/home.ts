// Home: where the app opens for a returning player, and the Home button in the dock. A feed of
// cards on black, each saying what it is in small caps and built round one thing to look at
// (design 3, "Today", James 2026-10-17), in groups set apart by a wide black gap:
//   Collect — atoms built and a track per period in a strip at the top; the next step on a card
//             with the atom itself, live, over its plate and what the step builds, and the rose
//             Build button; then a row for the fleeting isotope to build next.
//   Atlas   — the atom of the day to find among four plates; a row into the Atlas.
//   Play    — today's puzzle beside the game playing itself; a row into all the games.
//   Nu      — Nu's three questions with their streak; a row into the game Nu wants to play.
// The shell mounts it on every visit and puts it away on leaving (the atom and the game stop
// drawing):
//
//   renderHome($('home-body'), (to, at) => ...);   // at: { z } opens an atom in Learn, { game } a game
//   hideHome();

import { loadSave, type SaveData } from '../core/save';
import { nextStep, openStep, type NextStep } from '../core/next';
import { atomBuilt, fleetingIsotopes, isotopeCollected, rowOpen, segmentsOf } from '../core/progress';
import { formatDuration } from '../core/isotopes';
import { factsOf } from '../core/facts';
import { MAX_Z, elementAt, placeColour, type Element } from '../gallery/data';
import { inkOn } from '../gallery/looks';
import { seriesOne } from '../gallery/table';
import { periodShares } from '../gallery/atomlist';
import { fleetingOpen } from '../gallery/locks';
import { earnables } from '../gallery/earn';
import { GemAtom } from '../gallery/gem';
import { atomSlice } from '../gallery/scaffold';
import { PUZZLES, puzzleIcon } from '../puzzles/catalog';
import { GameDemo } from '../puzzles/demo';
import { dailyPuzzle, dailyStreak } from '../puzzles/daily';
import { difficultyLevel, levelWord } from '../puzzles/difficulty';
import { icon } from '../ui/icons';
import { nuEnabled, nuIconHtml, nuShow, reducedMotion } from '../ui/nu';
import { nuPick } from '../nu/games';
import { finds, foundToday, hideDue, treats } from '../nu/bond';
import {
  atomOfDay, candidates, clues, finishQuiz, headlineOf, liveStreak, quizOf, readDay, today, writeDay,
  type DayState, type QuizOption,
} from './daily';
import './home.css';

export type HomeTarget = 'collect' | 'learn' | 'play' | 'nu';
export type HomeGo = (to: HomeTarget, at?: { z?: number; game?: string; daily?: boolean }) => void;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pct = (f: number) => `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
const fmt = (n: number) => n.toLocaleString('en-US');
const CHEVRON = () => icon('chevron-right', { size: 20 });

function plate(e: Element, cls = ''): string {
  const bg = placeColour(e);
  return `<span class="home-plate ${cls}" style="background:${bg};color:${inkOn(bg)}" aria-hidden="true"><small>${e.z}</small>${e.symbol}</span>`;
}

/** What draws while Home shows: the next step's atom and today's puzzle playing itself. Made
 *  once and kept; each visit points them at the day's things. */
let gem: GemAtom | null | undefined;
let demo: GameDemo | null = null;

function homeGem(): GemAtom | null {
  if (gem === undefined) {
    try { gem = new GemAtom(); } catch { gem = null; }
    if (gem && !gem.ok) gem = null;
  }
  return gem;
}

/** Leaving Home: everything that draws stops. */
export function hideHome(): void {
  gem?.stop();
  demo?.stop();
}

export function renderHome(host: HTMLElement, go: HomeGo): void {
  hideHome();
  const save = loadSave();
  const group = (body: string) => `<div class="home-group">${body}</div>`;
  host.innerHTML = group(strip(save) + nextCard(save) + fleetRow(save))
    + group('<div class="home-guess"></div>' + learnRow(save))
    + group('<div class="home-game"></div>' + gamesRow())
    + group('<div class="home-quiz"></div>' + (nuEnabled() ? nuCard() : ''));
  host.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go as HomeTarget); });
  host.querySelectorAll<HTMLButtonElement>('[data-nu-game]').forEach((b) => { b.onclick = () => go('nu', { game: b.dataset.nuGame }); });
  wireCollect(host, save);
  const day = today();
  paintGuess(host.querySelector<HTMLElement>('.home-guess')!, day.index, go);
  paintQuiz(host.querySelector<HTMLElement>('.home-quiz')!, day.index);
  paintGame(host.querySelector<HTMLElement>('.home-game')!, go);
  // Nu comes out to circle the next step for a moment; once a minute at most for the same one.
  const step = nextStep(save);
  if (step && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => askNu(host, `home:${step.z}:${step.stage}`));
}

/** Nu circles Collect's next steps: on arriving at Home, and whenever the lit Home icon is tapped
 *  ("what now?"), which skips the once-a-minute limit (no `key`). Its orbit circles the
 *  stable and fleeting picks together, centred on the gap between them. */
export function askNu(host: HTMLElement, key?: string): void {
  const picks = [...host.querySelectorAll<HTMLElement>('[data-step="stable"], [data-step="fleeting"]')];
  if (!picks.length) return;
  nuShow(() => {
    const rs = picks.filter((e) => e.isConnected && e.getClientRects().length).map((e) => e.getBoundingClientRect());
    if (!rs.length) return null;
    const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
    const w = Math.max(...rs.map((r) => r.right)) - x, h = Math.max(...rs.map((r) => r.bottom)) - y;
    // Centred on the gap between the two picks (one pick: its own middle).
    const cy = rs.length > 1 ? (rs[0].bottom + rs[1].top) / 2 : y + h / 2;
    return new DOMRect(x, cy - h / 2, w, h);
  }, { key });
}

// ---------- Collect ----------

/** The strip at the top: a track per period as wide as it is long, filled by its stable share
 *  (green once done, darker while the period is shut), then atoms built. Into Collect. */
function strip(save: SaveData): string {
  let built = 0;
  for (let z = 1; z <= MAX_Z; z++) if (atomBuilt(z, save)) built++;
  let pers = '';
  for (let p = 1; p <= 7; p++) {
    const s = periodShares(p, save);
    const open = rowOpen(p, save);
    pers += `<i class="home-trk${open ? '' : ' is-locked'}${s.stable >= 1 ? ' is-done' : ''}" style="flex:${s.atoms}"><b style="width:${open ? pct(s.stable) : '0%'}"></b></i>`;
  }
  return `<button type="button" class="home-strip" data-go="collect" aria-label="Collect: ${built} of ${MAX_Z} atoms built">`
    + `<span class="home-pers" aria-hidden="true">${pers}</span><span class="home-strip-n"><b>${built}</b>/${MAX_Z} atoms</span></button>`;
}

/** The fleeting isotope to offer: on the atom the next step is on if it is built, else on the
 *  highest atom built; the longest-lived one not built yet, so the easiest board. */
function fleetingPick(save: SaveData, step: NextStep | null): { z: number; a: number; halfLife: number | null } | null {
  const order: number[] = [];
  if (step && atomBuilt(step.z, save)) order.push(step.z);
  for (let z = MAX_Z; z >= 1; z--) if (atomBuilt(z, save) && z !== step?.z) order.push(z);
  for (const z of order) {
    const left = fleetingIsotopes(z).filter((i) => !isotopeCollected(save, z, i.a));
    if (!left.length) continue;
    const best = left.reduce((x, y) => ((y.halfLife ?? 0) > (x.halfLife ?? 0) ? y : x));
    return { z, a: best.a, halfLife: best.halfLife };
  }
  return null;
}

/** The step's title ("Build Silver", "Build Silver-107") and the line under it: what it builds
 *  and with which game ("Build electrons with Flux"). */
function stepTitle(s: NextStep): string {
  const name = s.a !== undefined ? `${elementAt(s.z).name}-${s.a}` : elementAt(s.z).name;
  return s.kind === 'resume' ? `Resume ${name}` : s.kind === 'discovery' ? s.label : `Build ${name}`;
}
function stepLine(s: NextStep): string {
  const what = s.kind === 'nucleus' ? 'Build the nucleus' : s.kind === 'electrons' ? 'Build electrons' : s.kind === 'lasting' ? 'Build the isotope' : s.kind === 'discovery' ? 'Find the shape' : 'Carry on';
  return s.gameName ? `${what} with ${s.gameName}` : what;
}

/** The next step: the atom, live, over its plate and what the step builds; Build at the foot. */
function nextCard(save: SaveData): string {
  const step = nextStep(save);
  if (!step) {
    return `<section class="home-feed home-next" aria-label="Next step"><span class="home-caps">Next step</span>`
      + `<p class="home-alldone">${icon('check', { size: 22 })}Every atom is built</p>`
      + `<button type="button" class="home-go is-white" data-go="collect">${icon('collect', { size: 22 })}Open Collect</button></section>`;
  }
  const e = elementAt(step.z);
  return `<section class="home-feed home-next" aria-label="Next step"><span class="home-caps">Next step</span>`
    + `<div class="home-gem" aria-hidden="true"></div>`
    + `<div class="home-nextrow">${plate(e, 'is-big')}<span class="home-grow"><b class="home-big">${esc(stepTitle(step))}</b>`
    + `<small>${esc(stepLine(step))}</small></span></div>`
    + `<button type="button" class="home-go is-next" data-step="stable" aria-label="${esc(`${stepTitle(step)}: ${step.gameName}`)}">`
    + `${icon('build', { size: 22 })}${step.kind === 'resume' ? 'Resume' : 'Build'}</button></section>`;
}

/** Under the next step, a row for the fleeting isotope to build next (the player picks the game),
 *  beside how many fleeting isotopes are built. */
function fleetRow(save: SaveData): string {
  if (!fleetingOpen(save)) {
    return `<div class="home-line is-locked">${icon('lock', { size: 20 })}<span class="home-grow"><b>Fleeting isotopes</b><small>They open once an atom is built</small></span></div>`;
  }
  let done = 0, all = 0;
  for (let z = 1; z <= MAX_Z; z++) {
    for (const i of fleetingIsotopes(z)) { all++; if (isotopeCollected(save, z, i.a)) done++; }
  }
  const f = fleetingPick(save, nextStep(save));
  const count = `<span class="home-muted home-num">${fmt(done)}/${fmt(all)}</span>`;
  if (!f) return `<div class="home-line is-done">${icon('check', { size: 20 })}<span class="home-grow"><b>Every fleeting isotope so far</b><small>Fleeting</small></span>${count}</div>`;
  const e = elementAt(f.z);
  return `<button type="button" class="home-line" data-step="fleeting" aria-label="${esc(`Fleeting: ${e.name}-${f.a}, ${f.halfLife === null ? 'half-life unknown' : formatDuration(f.halfLife)}; you pick the game. ${done} of ${all} built`)}">`
    + `${plate(e, 'is-fleet')}<span class="home-grow"><b>${esc(e.name)}-${f.a}</b><small>Fleeting · you pick the game</small></span>${count}${CHEVRON()}</button>`;
}

function wireCollect(host: HTMLElement, save: SaveData): void {
  const step = nextStep(save);
  const s = host.querySelector<HTMLButtonElement>('[data-step="stable"]');
  if (s && step) s.onclick = () => openStep(step);
  const f = host.querySelector<HTMLButtonElement>('[data-step="fleeting"]');
  const pick = fleetingPick(save, step);
  if (f && pick) {
    f.onclick = () => openStep({ z: pick.z, kind: 'resume', a: pick.a, game: '', gameName: '', label: `${elementAt(pick.z).name}-${pick.a}`, stage: `fl-${pick.a}` });
  }
  // The atom itself, live, as Collect draws it: as far as it is collected, turning once its
  // stable parts are built. Without WebGL the card goes without it.
  const box = host.querySelector<HTMLElement>('.home-gem');
  if (!box || !step) return;
  const g = homeGem();
  if (!g) { box.remove(); return; }
  box.append(g.canvas);
  g.show(step.z, atomSlice(step.z, save), reducedMotion());
  g.start();
}

// ---------- Atlas ----------

/** The atom of the day: the clues so far over four plates to tap; once found, the atom and what
 *  it is known for. */
function paintGuess(box: HTMLElement, index: number, go: HomeGo): void {
  const z = atomOfDay(index);
  const cands = candidates(z, index);
  const st = readDay();
  // Wrong guesses from a different set of cards (an older version of the game) don't count.
  const g = { ...st.guess, wrong: st.guess.wrong.filter((w) => cands.includes(w)) };
  const e = elementAt(z);
  if (g.done) {
    const won = !g.wrong.length || g.wrong.length < cands.length - 1;
    const extra = factsOf(z).filter((f) => f !== headlineOf(z)).slice(0, 2);
    box.innerHTML = `<section class="home-feed home-reveal" aria-label="Atom of the day">`
      + `<div class="home-reveal-top">${plate(e, 'is-big')}<div><span class="home-caps">Atom of the day</span><b class="home-reveal-name">${esc(e.name)}</b>`
      + `<small class="${won ? 'home-ok' : ''}">${won ? `${icon('check', { size: 14 })} Got it with ${g.clues} clue${g.clues === 1 ? '' : 's'}` : `Period ${e.period} · ${esc(seriesOne(e))}`}</small></div></div>`
      + `<p class="home-reveal-h">${esc(headlineOf(z))}</p>`
      + (extra.length ? `<ul class="home-facts">${extra.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '')
      + `<div class="home-row"><button type="button" class="home-btn" data-more>${icon('atlas', { size: 18 })}Read more</button><span class="home-muted">A new atom tomorrow</span></div></section>`;
    box.querySelector<HTMLButtonElement>('[data-more]')!.onclick = () => go('learn', { z });
    return;
  }
  const shown = clues(z, index).slice(0, g.clues);
  box.innerHTML = `<section class="home-feed home-aotd" aria-label="Atom of the day">`
    + `<span class="home-caps">Atom of the day · Clue ${g.clues} of 3</span>`
    + `<div class="home-clues">${shown.map((c, i) => `<p class="${i === shown.length - 1 ? 'is-now' : ''}">${esc(c)}</p>`).join('')}</div>`
    + `<div class="home-four">${cands.map((c) => {
      const n = esc(elementAt(c).name);
      return g.wrong.includes(c)
        ? `<button type="button" class="home-aplate is-out" disabled aria-label="Not ${n}">${plate(elementAt(c), 'is-big')}</button>`
        : `<button type="button" class="home-aplate" data-z="${c}" aria-label="Guess ${n}">${plate(elementAt(c), 'is-big')}</button>`;
    }).join('')}</div>`
    + '<p class="home-muted home-c">Tap the atom. A wrong guess shows the next clue.</p></section>';
  const save = (next: DayState['guess']) => { const s = readDay(); writeDay({ ...s, guess: next }); paintGuess(box, index, go); };
  box.querySelectorAll<HTMLButtonElement>('.home-aplate[data-z]').forEach((b) => {
    b.onclick = () => {
      const pick = Number(b.dataset.z);
      if (pick === z) { save({ ...g, done: true }); return; }
      const wrong = [...g.wrong, pick];
      // A wrong guess shows the next clue; once only the answer is left, it is shown.
      save({ wrong, clues: Math.min(3, g.clues + 1), done: wrong.length >= cands.length - 1 });
    };
  });
}

function learnRow(save: SaveData): string {
  const all = earnables(save);
  const open = all.filter((e) => e.open).length + 1; // the plain table is always open
  return `<button type="button" class="home-line is-minor" data-go="learn" aria-label="Explore all atoms: ${open} of ${all.length + 1} ways to see them open">${icon('atlas', { size: 24 })}`
    + `<span class="home-grow"><b>Explore all atoms</b></span>${CHEVRON()}</button>`;
}

// ---------- Play ----------

/** Five pips, the first `level` lit in the level's color. */
function pips(level: number): string {
  return `<span class="home-pips lvl-${level}" aria-hidden="true">${Array.from({ length: 5 }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('')}</span>`;
}

/** Today's puzzle: what it is on the left, the game playing itself on the right (its icon kept
 *  small by its name), and Play (Replay once solved) at the foot. */
function paintGame(box: HTMLElement, go: HomeGo): void {
  const d = dailyPuzzle();
  const p = PUZZLES.find((g) => g.id === d.game);
  if (!p) return;
  const s = dailyStreak();
  const level = difficultyLevel(d.dial);
  const word = levelWord(level);
  const status = s.today ? `Solved today${s.flawless ? ', flawless' : ''}` : s.streak ? `Streak: ${s.streak} day${s.streak === 1 ? '' : 's'}` : 'Same board for everyone';
  box.innerHTML = `<section class="home-feed home-today" aria-label="Today's puzzle"><div class="home-todayrow">`
    + `<div class="home-todayinfo"><span class="home-caps">Today's puzzle</span>`
    + `<b class="home-big home-gname"><span class="home-gsmall" aria-hidden="true">${puzzleIcon(p.id, 16)}</span>${esc(p.name)}</b>`
    + `<span class="home-lvl">${pips(level)}${word}</span><small class="home-muted${s.today ? ' home-ok' : ''}">${s.today ? `${icon('check', { size: 14 })} ` : ''}${status}</small></div>`
    + `<span class="home-shot" aria-hidden="true"><canvas></canvas></span></div>`
    + `<button type="button" class="home-go ${s.today ? 'is-ring' : 'is-play'}" data-daily aria-label="${s.today ? 'Replay' : 'Play'} today's ${esc(p.name)}, ${word}">`
    + `${icon(s.today ? 'restart' : 'play', { size: 22 })}${s.today ? 'Replay' : `Play · ${word}`}</button></section>`;
  box.querySelector<HTMLButtonElement>('[data-daily]')!.onclick = () => go('play', { game: p.id, daily: true });
  if (p.makeAt) {
    demo = new GameDemo(box.querySelector('canvas')!, () => reducedMotion());
    demo.show(p);
    demo.start();
  }
}

function gamesRow(): string {
  const n = PUZZLES.filter((g) => g.make).length;
  return `<button type="button" class="home-line is-minor" data-go="play" aria-label="Explore all ${n} games">${icon('puzzles', { size: 24 })}`
    + `<span class="home-grow"><b>Explore all games</b></span>${CHEVRON()}</button>`;
}

// ---------- Nu ----------

/** How long an answer stays up before the next question; a note gets time to be read. */
const QUIZ_SHOW_MS = 2200, QUIZ_NOTE_MS = 3600;

/** Nu's questions. One card that keeps its shape from question to answer: the values under the
 *  atom cards and the line under them are laid out from the start and only shown on answering,
 *  and the bar at the foot (a segment a question) fills its segment as the countdown to the
 *  next one. */
function paintQuiz(box: HTMLElement, index: number): void {
  const qs = quizOf(index);
  const st = readDay();
  const n = st.quiz.length;
  const streak = liveStreak(st);
  const bar = `<div class="home-qbar" aria-hidden="true">${qs.map((_, i) => `<i class="${i < n ? (st.quiz[i] ? 'is-right' : 'is-wrong') : ''}"><b></b></i>`).join('')}</div>`;
  const head = `<div class="home-row home-qhead"><span class="home-nu">${nuIconHtml(20)}</span><span class="home-caps home-grow">Nu asks${n < qs.length ? ` · ${n + 1} of ${qs.length}` : ''}</span>`
    + `<span class="home-muted">${streak ? `Streak: ${streak} day${streak === 1 ? '' : 's'}` : 'Start a streak'}</span></div>`;
  if (n >= qs.length) {
    // Done for today: Nu leaves the quiz.
    delete box.dataset.nuPerch;
    const right = st.quiz.filter(Boolean).length;
    box.innerHTML = `<section class="home-feed home-quizcard" aria-label="Nu asks">${head}`
      + `<div class="home-qdone"><b>${right}/${qs.length}</b><span><b>right today</b><small>Three more tomorrow</small></span></div>${bar}</section>`;
    return;
  }
  const q = qs[n];
  const choice = (o: QuizOption, i: number) => {
    if (!('z' in o)) return `<button type="button" class="home-tile" data-ans="${i}">${esc(o.text)}</button>`;
    const e = elementAt(o.z);
    return `<button type="button" class="home-acard" data-ans="${i}" aria-label="${esc(e.name)}">${plate(e)}<span class="home-acard-txt"><b>${esc(e.name)}</b>`
      + `<small>${esc(q.after[i] || ' ')}</small></span></button>`;
  };
  const atoms = 'z' in q.options[0];
  // "Not quite." is the longer verdict, so the line is laid out at its widest.
  box.innerHTML = `<section class="home-feed home-quizcard" aria-label="Nu asks">${head}<p class="home-ask">${esc(q.text)}</p>`
    + `<div class="${atoms ? 'home-acards' : 'home-tiles'}">${q.options.map(choice).join('')}</div>`
    + `<p class="home-qline"><span class="home-qnow">Question ${n + 1} of ${qs.length}</span>`
    + `<span class="home-qafter" aria-live="polite"><b>Not quite.</b>${q.note ? ` ${esc(q.note)}` : ''}</span></p>${bar}</section>`;
  const card = box.firstElementChild as HTMLElement;
  box.querySelectorAll<HTMLButtonElement>('[data-ans]').forEach((b) => {
    b.onclick = () => {
      // Once the player is answering, Nu sits in the quiz's icon (nu.ts) until it's done.
      box.dataset.nuPerch = '2';
      const right = Number(b.dataset.ans) === q.answer;
      const all = box.querySelectorAll<HTMLButtonElement>('[data-ans]');
      all.forEach((x) => { x.disabled = true; });
      all[q.answer].classList.add('is-right');
      all[q.answer].insertAdjacentHTML('beforeend', `<span class="home-mark">${icon('check', { size: 16 })}</span>`);
      if (!right) {
        b.classList.add('is-wrong');
        b.insertAdjacentHTML('beforeend', `<span class="home-mark">${icon('close', { size: 16 })}</span>`);
      }
      card.querySelector('.home-qafter b')!.textContent = right ? 'Right.' : 'Not quite.';
      const ms = q.note ? QUIZ_NOTE_MS : QUIZ_SHOW_MS;
      const seg = card.querySelectorAll<HTMLElement>('.home-qbar i')[n];
      seg.classList.add(right ? 'is-right' : 'is-wrong', 'is-timing');
      seg.style.setProperty('--ms', `${ms}ms`);
      card.classList.add('is-answered');
      let s = readDay();
      s = { ...s, quiz: [...s.quiz, right] };
      if (s.quiz.length >= qs.length) s = finishQuiz(s);
      writeDay(s);
      setTimeout(() => paintQuiz(box, index), ms);
    };
  });
}

/** The game Nu wants to play today, a row like the others, into Nu's park. */
function nuCard(): string {
  const g = nuPick();
  const notes: string[] = [];
  const n = treats(), f = finds();
  if (n) notes.push(`${n} ${n === 1 ? 'treat' : 'treats'} waiting`);
  if (hideDue()) notes.push('Nu is hiding somewhere today');
  else if (foundToday()) notes.push(`Found ${f === 1 ? 'once' : `${f} times`} today`);
  return `<button type="button" class="home-line is-minor" data-nu-game="${g.id}"${notes.length ? ` aria-description="${esc(notes.join('. '))}"` : ''}>`
    + `<span class="home-nu" aria-hidden="true">${nuIconHtml(24)}</span>`
    + `<span class="home-grow"><b>Play ${esc(g.label)} with Nu</b></span>${CHEVRON()}</button>`;
}
