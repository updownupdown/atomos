// Dev-only page (open /kit.html on the dev server) showing every shared component working.

import '@fontsource-variable/outfit';
import { ICON_CHEVRON, closeButton, createHoldButton, createSlider, createSwitch, createTabs, iconButton, showToast } from './components';
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

const holdOut = out('hold it');
let n = 0;
const restart = createHoldButton({
  label: 'Restart',
  doneLabel: 'Restarted',
  icon: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12a7 7 0 1 0 2-4.9"/><path d="M5 4v4h4"/></svg>`,
  onConfirm: () => (holdOut.textContent = `restarted ×${++n}`),
});
section('Hold to confirm', restart, holdOut);

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
