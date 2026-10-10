// The microscope: "tell me more about what I am looking at". It used to sit in the header; it
// now lives in the body of each screen. Whatever screen is showing registers what the
// microscope opens; the shell clears it on every screen change.
//
//   setScienceHandler(() => openMyDetails(), 'The science of iron');   // when the screen shows
//   setScienceHandler(null);                                            // when it hides
//
// A screen places the button where it wants it with scienceButton(). Until a screen does, a
// round microscope floats at the top right of the screen whenever there is something to open,
// so nothing is lost while screens move it into place. With nothing registered, placed buttons
// stay put but dim, and the floating one hides.

import { icon } from './icons';

const DEFAULT_LABEL = 'More about what is on screen';

let handler: (() => void) | null = null;
let label = DEFAULT_LABEL;
let open = false;
const placed = new Set<HTMLButtonElement>();
let fab: HTMLButtonElement | null = null;

function make(className: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.innerHTML = icon('microscope');
  b.addEventListener('click', () => handler?.());
  return b;
}

function paint(b: HTMLButtonElement): void {
  b.disabled = !handler;
  b.setAttribute('aria-label', label);
  b.title = label;
  b.setAttribute('aria-expanded', String(open));
}

/** A placed button is "in use" when it is in the page and not inside something hidden. */
const showing = (b: HTMLButtonElement) => b.isConnected && b.getClientRects().length > 0;

function sync(): void {
  placed.forEach(paint);
  if (!fab) {
    fab = make('science-fab');
    fab.id = 'science-fab';
    document.body.append(fab);
  }
  paint(fab);
  fab.hidden = !handler || [...placed].some(showing);
}

/** A microscope button for a screen to place in its own layout. It always opens whatever is
 *  registered at the time it is tapped. Pass a class to size it; it defaults to a 44 px icon
 *  button from the shared kit. */
export function scienceButton(className = 'ui-icon-btn ui-icon-btn--ghost science-btn'): HTMLButtonElement {
  const b = make(className);
  placed.add(b);
  paint(b);
  // Let the floating one step aside once this button is on screen.
  queueMicrotask(sync);
  return b;
}

/** Set (or clear, with null) what the microscope opens. */
export function setScienceHandler(fn: (() => void) | null, text = DEFAULT_LABEL): void {
  handler = fn;
  label = text;
  if (!fn) open = false;
  sync();
}

/** Mark the microscope as open or closed while its details are showing. */
export function setScienceOpen(isOpen: boolean): void {
  open = isOpen;
  sync();
}
