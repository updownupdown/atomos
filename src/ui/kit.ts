// Dev-only page (open /kit.html on the dev server) showing every shared component working.

import '@fontsource-variable/outfit';
import { ICON_CHEVRON, closeButton, confirmDialog, createSlider, createSwitch, createTabs, iconButton, nextButton, playButton, showToast } from './components';
import { openModal } from './modal';
import { openElementPicker } from './picker';
import { MICROSCOPE } from './icons';

const kit = document.getElementById('kit')!;
const section = (title: string, ...nodes: Node[]) => {
  const s = document.createElement('section');
  s.innerHTML = `<h2>${title}</h2>`;
  const row = document.createElement('div');
  row.className = 'row';
  row.append(...nodes);
  s.append(row);
  kit.append(s);
  return s;
};
const out = (text = '') => Object.assign(document.createElement('span'), { className: 'out', textContent: text });

const tabOut = out('overview');
const tabs = createTabs(
  [{ id: 'overview', label: 'Overview' }, { id: 'structure', label: 'Structure' }, { id: 'isotopes', label: 'Isotopes' }, { id: 'properties', label: 'Properties' }, { id: 'story', label: 'Story' }],
  { label: 'Sections', onChange: (id) => (tabOut.textContent = id) },
);
section('Tabs', tabs.el).append(tabOut);
tabs.el.style.flex = '1';

const sliderOut = out();
const slider = createSlider({ min: 1, max: 118, value: 6, label: 'Element', format: (v) => `Z ${v}`, onInput: (v) => (sliderOut.textContent = `Z ${v}`) });
sliderOut.textContent = `Z ${slider.value}`;
section('Slider', slider.el, sliderOut);

const sw = document.createElement('div');
sw.style.flex = '1';
sw.append(
  createSwitch({ label: 'Reduce motion', help: 'Calmer clouds, shorter animations.', checked: false }).el,
  createSwitch({ label: 'Sound', help: 'Tones for fusions and finished atoms.', checked: true }).el,
);
section('Switches', sw);

const goOut = out();
section('Next and Play',
  nextButton({ label: 'Build hydrogen', onClick: () => (goOut.textContent = 'next') }),
  playButton({ label: 'Play', onClick: () => (goOut.textContent = 'play') }),
  playButton({ ariaLabel: 'Play Tessera', compact: true, onClick: () => (goOut.textContent = 'play') }),
  goOut,
);

const confirmOut = out();
const board = document.createElement('div');
board.className = 'kit-board';
board.innerHTML = Array.from({ length: 24 }, () => '<i></i>').join('');
const ask = (label: string, run: () => Promise<boolean>) => {
  const b = document.createElement('button');
  b.className = 'secondary';
  b.textContent = label;
  b.onclick = async () => (confirmOut.textContent = String(await run()));
  return b;
};
const tiles = [...board.children] as HTMLElement[];
const fade = (p: number) => tiles.forEach((t, i) => (t.style.opacity = String((i % 8) / 8 < p ? 0.15 : 1)));
section('Confirm',
  ask('Restart', () => confirmDialog({ title: 'Restart this board?', body: 'Your moves so far are cleared.', confirmLabel: 'Restart', nu: 'restart', sweepOver: board, onSweep: fade })
    .then((yes) => { setTimeout(() => fade(-1), 400); return yes; })),
  ask('Reset everything', () => confirmDialog({ title: 'Reset everything?', body: 'Every atom, isotope and discovery goes back to locked. This can\'t be undone.', confirmLabel: 'Reset everything', tone: 'problem', nu: 'reset' })),
  confirmOut,
).append(board);

const toastBtn = (text: string, tone: 'info' | 'good' | 'warn' | 'bad') => {
  const b = document.createElement('button');
  b.className = 'secondary';
  b.textContent = tone;
  b.onclick = () => showToast(text, { tone });
  return b;
};
section('Toasts',
  toastBtn('New isotope found: carbon-13', 'good'),
  toastBtn('Saved', 'info'),
  toastBtn('Only 3 moves left', 'warn'),
  toastBtn('That block can\'t move there', 'bad'),
);

section('Icon buttons',
  iconButton({ icon: MICROSCOPE, label: 'The science' }),
  iconButton({ icon: ICON_CHEVRON, label: 'Expand', className: 'ui-icon-btn--ghost' }),
  closeButton(() => undefined),
);
kit.querySelector<HTMLElement>('section:last-child .ui-close')!.style.position = 'static';

const open = document.createElement('button');
open.className = 'secondary';
open.textContent = 'Open a modal';
open.onclick = () => {
  const sheet = openModal('<h2>Carbon</h2><div id="kit-tabs"></div><p>The card floats with the page showing all round it, and closes with the X, a tap outside, or Escape.</p>');
  sheet.querySelector('#kit-tabs')!.replaceWith(createTabs([{ id: 'a', label: 'Overview' }, { id: 'b', label: 'Isotopes' }, { id: 'c', label: 'Story' }]).el);
};
section('Modal', open);

const pickOut = out('Z 8');
const pickBtn = document.createElement('button');
pickBtn.className = 'secondary';
pickBtn.textContent = 'Choose an element';
let pickedZ = 8;
pickBtn.onclick = () => openElementPicker((z) => { pickedZ = z; pickOut.textContent = `Z ${z}`; }, { current: pickedZ, locked: (z) => z > 20 });
section('Drawer: element picker', pickBtn, pickOut);
