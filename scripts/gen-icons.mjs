// Renders the app icons from the mark in src/ui/mark.ts.
//   node --experimental-strip-types scripts/gen-icons.mjs
// Writes public/icons/{atomos.svg,favicon.svg,icon-192.png,icon-512.png,maskable-512.png,apple-touch-icon.png}.
// Uses the Playwright Chromium that the dev container ships; no extra install.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { markInner } from '../src/ui/mark.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'icons');

const PLATE = '#0c0b0a';
const SILVER = '#d9d6cf';

// The mark fills `share` of the canvas; the rest is plate black, with a faint grain so an
// enlarged icon still reads as the Cloud Chamber ground rather than flat black.
const icon = (share, { grain = true } = {}) => {
  const s = 100 * share, o = (100 - s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.06 0"/></filter></defs>
  <rect width="100" height="100" fill="${PLATE}"/>
  ${grain ? '<rect width="100" height="100" filter="url(#n)"/>' : ''}
  <svg x="${o}" y="${o}" width="${s}" height="${s}" viewBox="0 0 100 100" color="${SILVER}">${markInner()}</svg>
</svg>`;
};

// Favicon: the mark on a rounded plate-black tile, so it reads on pale and dark browser tabs alike.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" fill="${PLATE}"/>
  <svg x="11" y="11" width="78" height="78" viewBox="0 0 100 100" color="${SILVER}">${markInner()}</svg>
</svg>`;

writeFileSync(join(out, 'atomos.svg'), icon(0.78));
writeFileSync(join(out, 'favicon.svg'), favicon);

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }

const { chromium } = playwright;
const browser = await chromium.launch();
const render = async (svg, size, file) => {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}body>svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: join(out, file), omitBackground: true });
  await page.close();
};
await render(icon(0.78), 192, 'icon-192.png');
await render(icon(0.78), 512, 'icon-512.png');
// Maskable icons are cropped to a circle or squircle; the mark stays inside the safe 80%.
await render(icon(0.58), 512, 'maskable-512.png');
// iOS rounds the corners itself and ignores transparency.
await render(icon(0.78, { grain: false }), 180, 'apple-touch-icon.png');
await browser.close();
console.log('icons written to', out);
