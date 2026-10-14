// The component library page: every shared button, choice, overlay and mark in the app, working,
// each with a line on where it is used, so they can be tuned in one place. Reached from the
// bottom of Settings (or #components), like the icon library; Back returns to Settings.
// Everything here is the real component (components.ts, gamebar.ts, progress.ts and the
// stylesheets), never a copy, so a change to one shows here and in the app at once.

import {
  backButton, closeButton, confirmDialog, createCallout, createPills, createSegments, createSlider, createSwitch, createTabs,
  disclosureHTML, iconButton, nextButton, playButton, ringOn, showToast, textButton,
} from './components';
import { icon, MICROSCOPE } from './icons';
import { openModal } from './modal';
import { firstTimeLine, nuShow } from './nu';
import { openElementPicker } from './picker';
import { progressHtml } from './modebar';
import { pipsHtml, progressRings } from './progress';
import { createGameBar, offerRules, type GameBar } from '../puzzles/gamebar';
import { puzzleIcon } from '../puzzles/catalog';
import { showWin } from '../puzzles/winPanel';
import type { PuzzleView } from '../puzzles/view';

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

/** A labeled specimen: the component, with its name and where it is used under it. */
function spec(name: string, where: string, ...nodes: (Node | string)[]): HTMLElement {
  const fig = h('figure', 'cl-spec');
  const stage = h('div', 'cl-stage');
  for (const n of nodes) stage.append(typeof n === 'string' ? h('span', '', n) : n);
  const cap = h('figcaption', '', `<b></b><span></span>`);
  cap.querySelector('b')!.textContent = name;
  cap.querySelector('span')!.textContent = where;
  fig.append(stage, cap);
  return fig;
}

function section(page: HTMLElement, title: string, lede: string, ...specs: HTMLElement[]): void {
  const s = h('section', 'cl-sec');
  s.append(h('h2', 'cl-h', title), h('p', 'cl-lede', lede));
  const grid = h('div', 'cl-grid');
  grid.append(...specs);
  s.append(grid);
  page.append(s);
}

const out = (text = '') => Object.assign(h('span', 'cl-out'), { textContent: text });

/** A stand-in game for the game frame: just enough of a PuzzleView for the bar. */
function fakeView(moves: number): PuzzleView {
  return {
    won: false, stuck: false, moves, par: 12, clean: true,
    draw: () => {}, down: () => {}, move: () => {}, up: () => {}, cancel: () => {}, key: () => false,
    undo: () => false, canUndo: () => moves > 0, restart: () => {}, hint: () => `${moves} / 12 placed`, help: () => null,
    action: () => ({ label: 'Test', run: () => showToast('Test pressed') }),
  };
}

/** Fill the page. `onBack` runs when the player taps Back. */
export function renderComponentPage(page: HTMLElement, onBack: () => void): void {
  page.replaceChildren();
  const head = h('div', 'ip-head');
  head.append(backButton('Settings', onBack));
  page.append(head, h('h1', 'ip-title', 'Components'), h('p', 'ip-lede', 'Every shared button, choice, overlay and mark, working. They are the real components, so tuning one here tunes it everywhere it is used. Icons have their own <a href="#icons">library</a>.'));

  // ---- Buttons ----
  const primary = h('button', 'primary', 'Done');
  const secondary = h('button', 'secondary', 'New deal');
  const danger = h('button', 'secondary danger', 'Reset everything');
  const nudge = iconButton({ icon: icon('buoy'), label: 'Hint, nudging', className: 'hint-btn is-nudge' });
  const pressed = iconButton({ icon: icon('scale'), label: 'Pressed' });
  pressed.setAttribute('aria-pressed', 'true');
  const disabled = iconButton({ icon: icon('undo'), label: 'Disabled' });
  disabled.disabled = true;
  const gluon = textButton('', () => gluon.setAttribute('aria-pressed', String(gluon.getAttribute('aria-pressed') !== 'true')), 'gbar-act gbar-act--pill');
  gluon.innerHTML = `${icon('gluon', { size: 18 })}<span>Gluon ×2</span>`;
  gluon.setAttribute('aria-pressed', 'false');
  // The animated border: blue for the thing in focus, magenta for the way forward.
  const ringFocus = h('span', 'cl-ring-demo', 'In focus');
  ringOn(ringFocus, 'focus');
  const ringGo = h('span', 'cl-ring-demo', 'The way forward');
  ringOn(ringGo, 'go');
  const filter = iconButton({ icon: icon('filter', { size: 22 }), label: 'Filter', className: 'el-filter' });
  filter.onclick = () => filter.setAttribute('aria-expanded', String(filter.getAttribute('aria-expanded') !== 'true'));
  const go = h('button', 'ui-callout-go', 'Rules');
  const skip = h('button', 'ui-callout-skip', 'Not now');
  section(page, 'Buttons', 'Actions, from the one way forward (rose) to quiet tools.',
    spec('Next', 'The one way forward on a screen: Up next, the next step on a Build page, Build on View. One per screen.', nextButton({ label: 'Build hydrogen', onClick: () => showToast('Next') }), nextButton({ label: 'Next', compact: true, onClick: () => showToast('Next'), landKey: 'cl-next-compact' })),
    spec('Play, Replay, Unlock, Locked', 'Every other step on a Build page: one pill, an icon and a word.',
      playButton({ label: 'Play', compact: true, onClick: () => showToast('Play') }),
      playButton({ label: 'Replay', icon: 'restart', compact: true, onClick: () => showToast('Replay') }),
      playButton({ label: 'Unlock', icon: 'unlock', compact: true, onClick: () => showToast('Unlock') }),
      playButton({ label: 'Locked', compact: true, locked: true })),
    spec('Play, full size', 'Larger contexts; the icon-only round form for tight rows.', playButton({ label: 'Play', onClick: () => showToast('Play') }), playButton({ ariaLabel: 'Play', onClick: () => showToast('Play') })),
    spec('Primary and secondary', 'Win panels, sheets and settings.', primary, secondary, danger),
    spec('Back', 'Top left in every game: where it goes, in a word or two.', backButton('Gallium', () => showToast('Back')), backButton('All games', () => showToast('Back'))),
    spec('Icon buttons', 'Game tools (on a gray plate), corner tools; pressed, disabled, and the Hint nudge (pink icon).',
      iconButton({ icon: icon('restart'), label: 'Restart' }), iconButton({ icon: icon('info'), label: 'Instructions' }), iconButton({ icon: MICROSCOPE, label: 'The science' }),
      pressed, disabled, nudge, iconButton({ icon: icon('chevron-left'), label: 'Ghost', className: 'ui-icon-btn--ghost' }), (() => { const c = closeButton(() => undefined); c.style.position = 'static'; return c; })()),
    spec('Text and pill actions', 'Beside a game\'s message line: Test (Quanta, Chroma), and Chroma\'s Gluon toggle.', textButton('Test', () => showToast('Test')), gluon),
    spec('Callout buttons', 'Inside Learn to Play: the pink one forward, the pale one to wave it off.', go, skip),
    spec('Animated border', 'ringOn(el, tone): the top game card on Puzzles and its Play, the rules card in focus (blue); Up next and Nu\'s cards (magenta).', ringFocus, ringGo),
    spec('Filter', 'Right of the Collection search: unfolds the stage pills.', filter),
  );

  // ---- Choices ----
  const segOut = out('build');
  const seg = createSegments([{ id: 'build', label: 'Build' }, { id: 'view', label: 'View' }], { label: 'Atom mode', onChange: (id) => (segOut.textContent = id) });
  const seg3 = createSegments([{ id: 'collection', label: 'Collection' }, { id: 'map', label: 'Map' }, { id: 'details', label: 'Details' }], { label: 'Gallery view' });
  const segRow = h('div', 'mode-seg cl-wide');
  segRow.append(seg.el);
  const segRow3 = h('div', 'mode-seg cl-wide');
  segRow3.append(seg3.el);
  const pillOut = out('all');
  const pills = createPills([{ id: 'all', label: 'All' }, { id: 'new', label: 'Not started' }, { id: 'started', label: 'In progress' }, { id: 'done', label: 'Completed' }], { label: 'Show', onChange: (id) => (pillOut.textContent = id) });
  const tool = h('div', 'tool-group', `<span class="tool-cap">Draw as</span><div class="tool-seg" role="radiogroup" aria-label="Draw as">${[['view-cloud', 'Cloud'], ['view-shapes', 'Shapes'], ['view-hybrid', 'Both']].map(([i, l], k) => `<button role="radio" aria-checked="${k === 0}">${icon(i as 'view-cloud', { size: 18 })}<span>${l}</span></button>`).join('')}</div>`);
  tool.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => tool.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)))));
  const chip = h('button', 'tool-chip', `${icon('nucleus', { size: 18 })}<span>Nucleus</span>`);
  chip.setAttribute('aria-pressed', 'false');
  chip.onclick = () => chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
  const chipWrap = h('div', 'style-switch cl-static');
  chipWrap.append(chip);
  const tabs = createTabs([{ id: 'model', label: '3D' }, { id: 'overview', label: 'Overview' }, { id: 'structure', label: 'Structure' }, { id: 'isotopes', label: 'Isotopes' }], { label: 'Sections' });
  tabs.el.classList.add('cl-wide');
  const sortBox = h('div', 'el-menu cl-static', ['Number', 'Name', 'Progress', 'Group'].map((l, k) => `<button type="button" role="menuitemradio" class="el-opt" aria-checked="${k === 0}"><span>${l}</span>${icon('check', { size: 20 })}</button>`).join(''));
  sortBox.querySelectorAll<HTMLButtonElement>('.el-opt').forEach((b) => (b.onclick = () => sortBox.querySelectorAll('.el-opt').forEach((x) => x.setAttribute('aria-checked', String(x === b)))));
  section(page, 'Choices', 'Radio groups: exactly one picked. Each menu can be its own, but these are the shapes they take.',
    spec('Segments', 'Mode rows under the header: Build or View, Collection, Map or Details; the isotope filter.', segRow, segOut),
    spec('Segments, three', 'The gallery views row.', segRow3),
    spec('Pills', 'The Collection\'s stage filter, behind Filter.', pills.el, pillOut),
    spec('Compact radio', 'Corner tools over the 3D atom: Draw as.', tool),
    spec('Tool chip', 'A corner toggle: Nucleus, the scale circles, Color.', chipWrap),
    spec('Tabs', 'The atom\'s View pages; sheets with sections.', tabs.el),
    spec('Menu of choices', 'The Collection\'s sort dropdown.', sortBox),
  );

  // ---- Controls ----
  const sliderOut = out('Z 6');
  const slider = createSlider({ min: 1, max: 118, value: 6, label: 'Element', format: (v) => `Z ${v}`, onInput: (v) => (sliderOut.textContent = `Z ${v}`) });
  slider.el.classList.add('cl-wide');
  const sw = h('div', 'cl-wide');
  sw.append(createSwitch({ label: 'Reduce motion', help: 'Calmer clouds, shorter animations.', checked: false }).el, createSwitch({ label: 'Sound', checked: true }).el);
  const disc = h('div', 'cl-wide', disclosureHTML({ title: 'How to read this', hint: '3 notes', body: '<p>Detail folds away in expand and collapse cards.</p>' }));
  const search = h('div', 'el-searchrow cl-wide', `<label class="el-search"><span class="el-search-icon">${icon('search', { size: 22 })}</span><input type="search" placeholder="Search by name, symbol or number" aria-label="Search"></label>`);
  section(page, 'Controls', 'Inputs that hold a value.',
    spec('Slider', 'Practice\'s board maker; settings.', slider.el, sliderOut),
    spec('Switches', 'Settings rows.', sw),
    spec('Disclosure', 'Folding cards on the atom\'s pages.', disc),
    spec('Search', 'Collection, Details and the element picker.', search),
  );

  // ---- Overlays ----
  const upNext = createCallout({ kicker: 'Up next: Quanta', title: "Gallium's electrons", pic: '<span class="up-tile">Ga</span>', actions: [nextButton({ label: 'Next', compact: true, onClick: () => showToast('Next'), landKey: 'cl-callout' })], className: 'up-next' });
  const learn = createCallout({ kicker: 'Learn to Play', title: 'Quanta', actions: [h('button', 'ui-callout-go', 'Rules'), h('button', 'ui-callout-skip', 'Not now')] });
  const ask = (label: string, run: () => Promise<unknown> | unknown) => {
    const b = h('button', 'secondary', label);
    b.onclick = () => void run();
    return b;
  };
  const sayRow = h('div', 'cl-col');
  let lines = 0;
  const sayBtn = ask('First-time line', () => firstTimeLine(`cl-${Date.now()}-${++lines}`, 'Each atom is two puzzles: its nucleus and its electrons. Play either one.', sayBtn));
  sayRow.append(sayBtn);
  const flyTarget = nextButton({ label: 'Next: helium', onClick: () => undefined, landKey: 'cl-fly' });
  const flyBtn = ask('Nu circles this', () => nuShow(flyTarget));
  const winBox = h('div', 'cl-winbox');
  const winBtn = ask('Show win panel', () => {
    const close = showWin({ outcome: 'flawless', headline: 'Flawless', title: 'Quanta · Carbon', game: 'orbitalGrid', stats: [{ label: 'Moves', value: '7' }, { label: 'Par', value: '7 ✓' }], actions: [{ label: 'Done', primary: true, onClick: () => close() }], explore: { name: 'carbon', fact: 'Every living thing on Earth is built around carbon.', actions: [{ label: 'View', onClick: () => close() }, { label: 'Learn', onClick: () => close() }] } }, true, winBox);
  });
  section(page, 'Overlays', 'What floats over a screen. Callouts float at the foot without pushing anything about.',
    spec('Callout: Up next', 'The Collection\'s next step, floating at its foot.', upNext),
    spec('Callout: Learn to Play', 'A game\'s first play, floating above its message line.', learn),
    spec('Modal', 'Rules, the science, sheets. Closes with X, a tap outside or Escape.', ask('Open a modal', () => {
      const sheet = openModal('<h2>Carbon</h2><div id="cl-tabs"></div><p>The card floats with the page showing all round it.</p>');
      sheet.querySelector('#cl-tabs')!.replaceWith(createTabs([{ id: 'a', label: 'Overview' }, { id: 'b', label: 'Isotopes' }]).el);
    })),
    spec('Confirm', 'Restart and reset: Nu circles the action while it waits.', ask('Restart?', () => confirmDialog({ title: 'Restart this board?', body: 'Your moves so far are cleared.', confirmLabel: 'Restart', nu: 'restart' })), ask('Reset everything?', () => confirmDialog({ title: 'Reset everything?', body: 'This can\'t be undone.', confirmLabel: 'Reset everything', tone: 'problem', nu: 'reset' }))),
    spec('Toasts', 'Short news at the bottom.', ...(['good', 'info', 'warn', 'bad'] as const).map((t) => ask(t, () => showToast(`A ${t} toast`, { tone: t })))),
    spec('Drawer', 'The element picker, sliding from under the header.', ask('Choose an element', () => openElementPicker((z) => showToast(`Z ${z}`), { current: 8, locked: (z) => z > 20 }))),
    spec('Nu', 'First-time lines and Nu\'s flight to the next thing to do.', sayRow, flyBtn, flyTarget),
    spec('Win panel', 'Over a board once it is solved.', winBtn, winBox),
  );

  // ---- Marks ----
  const state = (txt: string, ico: 'check' | 'star') => h('span', 'cl-state', `<span class="bh-state">${icon(ico, { size: 14 })}${txt}</span>`);
  section(page, 'Progress and marks', 'How far something has got.',
    spec('Progress figures', 'Mode rows: the ring and percentage (green at 100%); the gallery shows figures alone.',
      h('span', 'mode-prog', progressHtml(0.33, { label: 'fleeting', pct: 0.1 })), h('span', 'mode-prog', progressHtml(1, null)), h('span', 'gal-prog', '<span>Stable: <b>15%</b></span><span>Fleeting: <b>0%</b></span>')),
    spec('Atom rings', 'The Build page: nucleus disc, electron ring, isotope arcs; green when complete.',
      progressRings({ nucleus: true, shells: false, lasting: { built: 1, total: 3 }, fleeting: { built: 0, total: 20 } }),
      progressRings({ nucleus: true, shells: true, lasting: { built: 3, total: 3 }, fleeting: { built: 8, total: 20 } })),
    spec('Built and Flawless', 'Over Replay on a finished step.', h('span', 'is-done', state('Built', 'check').outerHTML), h('span', 'is-flawless', state('Flawless', 'star').outerHTML)),
    spec('Difficulty pips', 'Game cards and the game bar: five pips, twenty dial points each.', h('span', 'bh-diff', `${pipsHtml(30)} Easy`), h('span', 'bh-diff', `${pipsHtml(70)} Hard`)),
  );

  // ---- Game frame ----
  const frame = h('div', 'cl-frame');
  const bar: GameBar = createGameBar([
    iconButton({ icon: icon('undo'), label: 'Undo' }),
    iconButton({ icon: icon('restart'), label: 'Restart' }),
    iconButton({ icon: icon('buoy'), label: 'Hint' }),
    iconButton({ icon: icon('info'), label: 'Instructions' }),
  ], { label: 'Gallium', onClick: () => showToast('Back') }, [iconButton({ icon: MICROSCOPE, label: 'The science' })]);
  bar.setTitle('Quanta', puzzleIcon('orbitalGrid', 22));
  bar.setDifficulty(30);
  bar.update(fakeView(4), '4 / 12 placed');
  const board = h('div', 'cl-board', '<span>The board</span>');
  frame.append(bar.el, board);
  const offer = ask('Show Learn to Play', () => { const s = loadSeen(); offerRules(bar, { id: `cl-${s}`, name: 'Quanta' }, () => showToast('Rules')); });
  section(page, 'Game frame', 'The same around every game: name and stats on gray; Back and the tools on black; the status line (the microscope, the message, the game\'s action); then the board.',
    spec('Game bar and status line', 'Build, Practice and the gate puzzles.', frame),
    spec('Learn to Play', 'Floats under the status line the first time a game is played.', offer),
  );
}

let seen = 0;
const loadSeen = () => `${Date.now()}-${++seen}`;
