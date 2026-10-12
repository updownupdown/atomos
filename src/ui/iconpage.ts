// The icon library page: every icon in src/icons/, by name, at the sizes the app uses, on the
// dark ground and on a light tile. Reached from the bottom of Settings (or #icons); Back
// returns to the gallery.

import { backButton } from './components';
import { ICON_NAMES, icon } from './icons';
import { markSvg } from './mark';

/** Fill the page. `onBack` runs when the player taps Back. */
export function renderIconPage(page: HTMLElement, onBack: () => void): void {
  page.innerHTML = `
    <div class="ip-head"></div>
    <h1 class="ip-title">Icons</h1>
    <p class="ip-lede">Every icon in the library, ${ICON_NAMES.length} in all, at 24 and 48 px. Drop a 24 × 24 SVG in <span class="ip-path">src/icons/</span> and it shows up here.</p>
    <div class="ip-grid">
      <figure class="ip-card ip-card--mark">
        <div class="ip-swatches"><span class="ip-dark">${markSvg()}</span><span class="ip-light">${markSvg()}</span></div>
        <figcaption>Logo mark</figcaption>
      </figure>
      ${ICON_NAMES.map((n) => `
      <figure class="ip-card">
        <div class="ip-swatches">
          <span class="ip-dark">${icon(n)}${icon(n, { size: 48 })}</span>
          <span class="ip-light">${icon(n)}</span>
        </div>
        <figcaption>${n}</figcaption>
      </figure>`).join('')}
    </div>`;
  page.querySelector('.ip-head')!.append(backButton('Tables', onBack));
}
