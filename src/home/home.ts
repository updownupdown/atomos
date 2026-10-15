// Home: where the app opens for a returning player, and the Home button in the dock. A jumping
// point to the three sections, each under its heading (design H11, James 2026-10-14) with a round
// button into the section, set apart by a small orbit Nu can play around:
//   Collect — atoms built, then a track per period (stable thick, fleeting thin), then one
//             stable step and one fleeting isotope to build next, each beside its total.
//   Learn   — the atom of the day to find among four atom cards, Nu's three two-choice questions
//             with their streak, and a row into Learn itself.
//   Play    — the game played last, then a game picked at random for the day, on their cards.
// The shell mounts it on every visit:
//
//   renderHome($('home-body'), (to, at) => ...);   // at: { z } opens an atom in Learn, { game } a game

import { loadSave, type SaveData } from '../core/save';
import { nextStep, openStep, type NextStep } from '../core/next';
import { atomBuilt, fleetingIsotopes, isotopeCollected, rowOpen, segmentsOf } from '../core/progress';
import { formatDuration } from '../core/isotopes';
import { lastPlayed, playsOf } from '../core/plays';
import { lastDial, pinnedGames } from '../core/wins';
import { factsOf } from '../core/facts';
import { MAX_Z, elementAt, placeColour, type Element } from '../gallery/data';
import { inkOn } from '../gallery/looks';
import { seriesOne } from '../gallery/table';
import { periodShares } from '../gallery/atomlist';
import { fleetingOpen } from '../gallery/locks';
import { earnables } from '../gallery/earn';
import { PUZZLES, puzzleIcon } from '../puzzles/catalog';
import { gameCard } from '../puzzles/gameCard';
import { icon, type IconName } from '../ui/icons';
import { nuIconHtml, nuShow } from '../ui/nu';
import {
  atomOfDay, candidates, clues, finishQuiz, headlineOf, liveStreak, quizOf, readDay, today, writeDay,
  type DayState, type QuizOption,
} from './daily';
import './home.css';

export type HomeTarget = 'collect' | 'learn' | 'play';
export type HomeGo = (to: HomeTarget, at?: { z?: number; game?: string }) => void;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pct = (f: number) => `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
const fmt = (n: number) => n.toLocaleString('en-US');

function plate(e: Element, cls = ''): string {
  const bg = placeColour(e);
  return `<span class="home-plate ${cls}" style="background:${bg};color:${inkOn(bg)}" aria-hidden="true"><small>${e.z}</small>${e.symbol}</span>`;
}

function panel(to: HomeTarget, title: string, ico: IconName, body: string): string {
  return `<section class="home-sec" aria-labelledby="home-h-${to}">`
    + `<div class="home-head"><span class="home-ico">${icon(ico, { size: 26 })}</span><h2 class="home-h" id="home-h-${to}">${title}</h2>`
    + `<button type="button" class="home-round" data-go="${to}" aria-label="Open ${title}">${icon('chevron-right', { size: 22 })}</button></div>`
    + body + '</section>';
}

/** The break between two sections: a round orbit around its nucleus (an <ellipse>, which is what
 *  Nu flies along when it plays here). */
const SEP = '<div class="home-sep" data-nu-toy aria-hidden="true"><svg viewBox="0 0 40 40">'
  + '<ellipse cx="20" cy="20" rx="16" ry="16" fill="none" stroke="currentColor" stroke-width="2"/>'
  + '<circle cx="20" cy="20" r="3.5" fill="currentColor"/></svg></div>';

export function renderHome(host: HTMLElement, go: HomeGo): void {
  const save = loadSave();
  host.innerHTML = panel('collect', 'Collect', 'collect', collectBody(save)) + SEP
    + panel('learn', 'Atlas', 'atlas', '<div class="home-guess"></div><div class="home-quiz"></div>' + learnRow(save)) + SEP
    + panel('play', 'Play', 'puzzles', '<div class="home-game"></div>');
  host.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go as HomeTarget); });
  wireCollect(host, save);
  const day = today();
  const guess = host.querySelector<HTMLElement>('.home-guess')!;
  const quiz = host.querySelector<HTMLElement>('.home-quiz')!;
  paintGuess(guess, day.index, go);
  paintQuiz(quiz, day.index);
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

interface Tally { built: number; stDone: number; stAll: number; flDone: number; flAll: number }

function tally(save: SaveData): Tally {
  const t: Tally = { built: 0, stDone: 0, stAll: 0, flDone: 0, flAll: 0 };
  for (let z = 1; z <= MAX_Z; z++) {
    if (atomBuilt(z, save)) t.built++;
    const segs = segmentsOf(z, save);
    t.stAll += segs.length;
    t.stDone += segs.filter((s) => s.done).length;
    for (const i of fleetingIsotopes(z)) {
      t.flAll++;
      if (isotopeCollected(save, z, i.a)) t.flDone++;
    }
  }
  return t;
}

/** One column per period, as wide as it is long: the stable track, the fleeting track under it
 *  and the period's number, or an amber lock while it is shut. */
function tracks(save: SaveData, fleetOn: boolean): string {
  let out = '';
  for (let p = 1; p <= 7; p++) {
    const s = periodShares(p, save);
    const open = rowOpen(p, save);
    const bar = (f: number, cls: string) => `<i class="home-trk ${cls}${f >= 1 ? ' is-done' : ''}"><b style="width:${open ? pct(f) : '0%'}"></b></i>`;
    out += `<div class="home-per${open ? '' : ' is-locked'}" style="flex:${s.atoms}">${bar(s.stable, 'is-stable')}${bar(fleetOn ? s.fleeting : 0, 'is-fleeting')}`
      + `<span class="home-per-n">${open ? p : icon('lock', { size: 14 })}<span class="sr-only">${open ? `Period ${p}: ${pct(s.stable)} stable, ${pct(s.fleeting)} fleeting` : `Period ${p} is locked`}</span></span></div>`;
  }
  return `<div class="home-pers">${out}</div>`;
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

function laneRow(kind: 'stable' | 'fleeting', done: number, all: number, choice: string): string {
  const name = kind === 'stable' ? 'Stable' : 'Fleeting';
  return `<div class="home-lane is-${kind}"><div class="home-lane-sum">${icon(kind === 'stable' ? 'isotope-stable' : 'isotope-fleeting', { size: 22 })}`
    + `<span><b>${name}</b><small>${fmt(done)}/${fmt(all)}</small></span></div>${choice}</div>`;
}

/** The stable step: the atom (or isotope) on the card; the part and its game for screen readers. */
const pickTitle = (s: NextStep): string => (s.a !== undefined ? `${elementAt(s.z).name}-${s.a}` : elementAt(s.z).name);
const pickPart = (s: NextStep): string => (s.kind === 'nucleus' ? 'Nucleus · ' : s.kind === 'electrons' ? 'Electrons · ' : s.kind === 'discovery' ? 'Orbital shape · ' : s.kind === 'resume' && s.a === undefined ? 'Resume · ' : '');

function collectBody(save: SaveData): string {
  const t = tally(save);
  const fleetOn = fleetingOpen(save);
  const step = nextStep(save);
  const stableChoice = step
    ? `<button type="button" class="home-pick" data-step="stable" aria-label="${esc(`${pickTitle(step)}: ${pickPart(step)}${step.gameName}`)}">${plate(elementAt(step.z))}<span class="home-pick-txt"><b>${esc(pickTitle(step))}</b></span><span class="home-gi">${puzzleIcon(step.game, 20)}</span></button>`
    : `<span class="home-pick is-done">${icon('check', { size: 22 })}<span class="home-pick-txt"><b>All built</b></span></span>`;
  const f = fleetOn ? fleetingPick(save, step) : null;
  const fleetChoice = !fleetOn
    ? `<span class="home-pick is-fleet is-locked">${icon('lock', { size: 20 })}<span class="home-pick-txt"><b>Build an atom first</b></span></span>`
    : f
      ? `<button type="button" class="home-pick is-fleet" data-step="fleeting" aria-label="${esc(`${elementAt(f.z).name}-${f.a}, ${f.halfLife === null ? 'half-life unknown' : formatDuration(f.halfLife)}: pick a game`)}">${plate(elementAt(f.z), 'is-fleet')}<span class="home-pick-txt"><b>${esc(elementAt(f.z).name)}-${f.a}</b></span><span class="home-gi is-ask">?</span></button>`
      : `<span class="home-pick is-fleet is-done">${icon('check', { size: 22 })}<span class="home-pick-txt"><b>All built so far</b></span></span>`;
  return `<p class="home-count"><b>${t.built}</b> of ${MAX_Z} atoms built</p>`
    + tracks(save, fleetOn)
    + `<div class="home-lanes">${laneRow('stable', t.stDone, t.stAll, stableChoice)}`
    + `${laneRow('fleeting', fleetOn ? t.flDone : 0, t.flAll, fleetChoice)}</div>`;
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
}

// ---------- Learn ----------

/** An atom as a card to tap: its plate and name, with a line under it once there is one. */
function atomCard(z: number, attrs: string, cls = '', sub = ''): string {
  const e = elementAt(z);
  return `<button type="button" class="home-acard ${cls}" ${attrs}>${plate(e)}<span class="home-acard-txt"><b>${esc(e.name)}</b>`
    + `${sub ? `<small>${sub}</small>` : ''}</span></button>`;
}

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
    box.innerHTML = `<div class="home-card home-reveal">`
      + `<div class="home-reveal-top">${plate(e, 'is-big')}<div><span class="home-caps">Atom of the day</span><b class="home-reveal-name">${esc(e.name)}</b>`
      + `<small class="${won ? 'home-ok' : ''}">${won ? `${icon('check', { size: 14 })} Got it with ${g.clues} clue${g.clues === 1 ? '' : 's'}` : `Period ${e.period} · ${esc(seriesOne(e))}`}</small></div></div>`
      + `<p class="home-reveal-h">${esc(headlineOf(z))}</p>`
      + (extra.length ? `<ul class="home-facts">${extra.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '')
      + `<div class="home-row"><button type="button" class="home-btn" data-more>${icon('atlas', { size: 18 })}Read more</button><span class="home-muted">A new atom tomorrow</span></div></div>`;
    box.querySelector<HTMLButtonElement>('[data-more]')!.onclick = () => go('learn', { z });
    return;
  }
  const shown = clues(z, index).slice(0, g.clues);
  box.innerHTML = `<div class="home-card">`
    + `<div class="home-row"><span class="home-caps">Atom of the day</span><span class="home-muted">Clue ${g.clues} of 3</span></div>`
    + `<p class="home-q">Which atom is it?</p>`
    + `<ol class="home-clues">${shown.map((c) => `<li>${esc(c)}</li>`).join('')}</ol>`
    + `<div class="home-acards">${cands.map((c) => (g.wrong.includes(c)
      ? atomCard(c, `disabled aria-label="Not ${esc(elementAt(c).name)}"`, 'is-out', 'Not this one')
      : atomCard(c, `data-z="${c}" aria-label="Guess ${esc(elementAt(c).name)}"`))).join('')}</div>`
    + (g.clues < 3 ? '<div class="home-row"><span class="home-muted">A wrong guess shows the next clue.</span><button type="button" class="home-btn" data-clue>Another clue</button></div>' : '')
    + '</div>';
  const save = (next: DayState['guess']) => { const s = readDay(); writeDay({ ...s, guess: next }); paintGuess(box, index, go); };
  box.querySelector<HTMLButtonElement>('[data-clue]')?.addEventListener('click', () => save({ ...g, clues: Math.min(3, g.clues + 1) }));
  box.querySelectorAll<HTMLButtonElement>('.home-acard[data-z]').forEach((b) => {
    b.onclick = () => {
      const pick = Number(b.dataset.z);
      if (pick === z) { save({ ...g, done: true }); return; }
      const wrong = [...g.wrong, pick];
      // A wrong guess shows the next clue; once only the answer is left, it is shown.
      save({ wrong, clues: Math.min(3, g.clues + 1), done: wrong.length >= cands.length - 1 });
    };
  });
}

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
  const head = `<div class="home-row"><span class="home-nu">${nuIconHtml(20)}</span><b class="home-q home-grow">Nu asks</b>`
    + `<span class="home-muted">${streak ? `Streak ${streak} day${streak === 1 ? '' : 's'}` : 'Start a streak'}</span></div>`;
  if (n >= qs.length) {
    // Done for today: Nu leaves the quiz.
    delete box.dataset.nuPerch;
    const right = st.quiz.filter(Boolean).length;
    box.innerHTML = `<div class="home-card home-quizcard">${head}`
      + `<div class="home-qdone"><b>${right}/${qs.length}</b><span><b>right today</b><small>Three more tomorrow</small></span></div>${bar}</div>`;
    return;
  }
  const q = qs[n];
  const choice = (o: QuizOption, i: number) => ('z' in o
    ? atomCard(o.z, `data-ans="${i}" aria-label="${esc(elementAt(o.z).name)}"`, '', esc(q.after[i] || '\u00a0'))
    : `<button type="button" class="home-tile" data-ans="${i}">${esc(o.text)}</button>`);
  const atoms = 'z' in q.options[0];
  // "Not quite." is the longer verdict, so the line is laid out at its widest.
  box.innerHTML = `<div class="home-card home-quizcard">${head}<p class="home-ask">${esc(q.text)}</p>`
    + `<div class="${atoms ? 'home-acards' : 'home-tiles'}">${q.options.map(choice).join('')}</div>`
    + `<p class="home-qline"><span class="home-qnow">Question ${n + 1} of ${qs.length}</span>`
    + `<span class="home-qafter" aria-live="polite"><b>Not quite.</b>${q.note ? ` ${esc(q.note)}` : ''}</span></p>${bar}</div>`;
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

function learnRow(save: SaveData): string {
  const all = earnables(save);
  const open = all.filter((e) => e.open).length + 1; // the plain table is always open
  return `<button type="button" class="home-card home-link" data-go="learn">${icon('atlas', { size: 22 })}`
    + `<span class="home-grow"><b>Explore all ${MAX_Z} atoms</b><small>${open} of ${all.length + 1} ways to see them open</small></span>${icon('chevron-right', { size: 20 })}</button>`;
}

// ---------- Play ----------

/** The day's random game: any playable game but the one above it, the same all day; one not
 *  played yet when there is one. */
function randomGame(ids: string[], not: string, index: number): string {
  const others = ids.filter((g) => g !== not);
  const fresh = others.filter((g) => playsOf(g) === 0);
  const pool = fresh.length ? fresh : others;
  return pool[((index * 7919) % pool.length + pool.length) % pool.length];
}

function paintGame(box: HTMLElement, go: HomeGo): void {
  const ids = PUZZLES.filter((g) => g.make).map((g) => g.id);
  const id = [lastPlayed(), ...pinnedGames(), 'merge'].find((g): g is string => Boolean(g) && ids.includes(g!)) ?? ids[0];
  const card = (gid: string, extra: string) => {
    const p = PUZZLES.find((g) => g.id === gid)!;
    const dial = lastDial(gid);
    return gameCard({
      id: gid, name: p.name,
      ...(dial !== null ? { difficulty: dial } : {}),
      extra,
      action: { label: 'Play', ariaLabel: `Play ${p.name}`, onClick: () => go('play', { game: gid }) },
    });
  };
  box.append(card(id, lastPlayed() === id ? 'Played last' : 'Pick up a game'));
  const other = randomGame(ids, id, today().index);
  if (other) box.append(card(other, playsOf(other) ? 'Random pick' : 'Random pick · new to you'));
}
