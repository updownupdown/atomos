// The element picker: the element list (elementlist.ts) in a drawer. Each element is a roomy
// row with its number, symbol, name, category, place in the table and weight; the rows sort
// by number, name, group, period, block or category, and the search box finds any element by
// name, symbol or number. The current element is marked and scrolled into view.

import type { Element } from '../gallery/data';
import { openDrawer, type Drawer } from './components';
import { createElementList } from './elementlist';
import './picker.css';

export { searchElements } from './search';

export interface PickerOptions {
  /** The element on screen now; it is marked in the list. */
  current?: number;
  /** Elements to mark as not collected yet. They can still be picked. */
  locked?: (z: number) => boolean;
}

/** Row and column (both 1-based) of an element in the 18-column table with the f block
 *  split out: rows 1-7 are the periods, row 9 the lanthanides, row 10 the actinides. */
export function tableCell(e: Element): { row: number; col: number } {
  if (e.z >= 57 && e.z <= 71) return { row: 9, col: 3 + (e.z - 57) };
  if (e.z >= 89 && e.z <= 103) return { row: 10, col: 3 + (e.z - 89) };
  return { row: e.period, col: e.group ?? 3 };
}

/** Opens the picker. `onPick` gets the chosen atomic number, after the drawer starts closing. */
export function openElementPicker(onPick: (z: number) => void, opts: PickerOptions = {}): Drawer {
  let drawer: Drawer | null = null;
  const list = createElementList({
    current: opts.current,
    locked: opts.locked,
    storageKey: 'atomos.picker.sort',
    onPick: (z) => {
      drawer?.close();
      onPick(z);
    },
  });
  list.el.classList.add('pk');
  drawer = openDrawer({ label: 'Choose an element', content: list.el });
  return drawer;
}
