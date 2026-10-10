// The icon library. Every SVG in src/icons/ is available here by its file name; drop a new
// 24×24 file in and `npm run dev` / `npm run build` pick it up (see scripts/icons.mjs).
// Icons draw in currentColor, so they take the colour of the text around them.
//
//   button.innerHTML = icon('close');                        // decorative, 24 px
//   button.innerHTML = icon('settings', { size: 20 });
//   el.append(iconEl('info', { label: 'Instructions' }));    // announced to screen readers

import { ICONS, type IconName } from './icons.gen';

export type { IconName };
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconOptions {
  /** Rendered width and height in CSS pixels. Default 24. */
  size?: number;
  /** Accessible name. Without one the icon is hidden from assistive tech. */
  label?: string;
  /** Extra classes, added after `icon icon-<name>`. */
  className?: string;
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The icon as an SVG string, ready for innerHTML or a template. */
export function icon(name: IconName, opts: IconOptions = {}): string {
  const { size = 24, label, className } = opts;
  const cls = `icon icon-${name}${className ? ` ${className}` : ''}`;
  const a11y = label ? `role="img" aria-label="${escape(label)}"` : 'aria-hidden="true" focusable="false"';
  return ICONS[name].replace('<svg ', `<svg class="${cls}" width="${size}" height="${size}" ${a11y} `);
}

/** The icon as an element. */
export function iconEl(name: IconName, opts: IconOptions = {}): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = icon(name, opts);
  return t.content.firstElementChild as SVGSVGElement;
}

/** The microscope means "dig into the science" everywhere in the app. */
export const MICROSCOPE = icon('microscope', { size: 22 });
