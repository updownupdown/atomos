// The microscope in the header: "tell me more about what I am looking at". It sits left of
// Settings on every screen. Whatever screen is showing registers what the microscope opens;
// with nothing registered the button stays in place, dimmed, so the header never shifts.
// A screen clears its handler when it is put away.
//
//   setScienceHandler(() => openMyDetails());   // when the screen shows
//   setScienceHandler(null);                     // when it hides

import { icon } from './icons';

let handler: (() => void) | null = null;
let bound = false;

function button(): HTMLButtonElement | null {
  return document.getElementById('nav-science') as HTMLButtonElement | null;
}

function bind(b: HTMLButtonElement): void {
  if (bound) return;
  bound = true;
  b.innerHTML = icon('microscope');
  b.addEventListener('click', () => handler?.());
}

/** Set (or clear, with null) what the header microscope opens. */
export function setScienceHandler(fn: (() => void) | null, label = 'More about what is on screen'): void {
  handler = fn;
  const b = button();
  if (!b) return;
  bind(b);
  b.disabled = !fn;
  b.setAttribute('aria-label', label);
  b.title = label;
}

/** Mark the microscope as open or closed while its details are showing. */
export function setScienceOpen(open: boolean): void {
  button()?.setAttribute('aria-expanded', String(open));
}
