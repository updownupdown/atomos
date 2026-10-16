// A picture of the atom to keep or send: the View's atom drawn square, with its number and
// name at the foot and the ATOMOS mark. Shared through the system share sheet where there is
// one (phones), saved as a PNG otherwise.

import { placeColour, type Element } from './data';
import { inkOn } from './looks';

const SIZE = 1080;
const FONT = '"Outfit Variable", Outfit, ui-sans-serif, system-ui, sans-serif';

/** Compose the picture: the atom as drawn, the plate and name at the foot. */
export async function atomPicture(e: Element, atom: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  try { await Promise.all([document.fonts.load(`600 64px ${FONT}`), document.fonts.load(`700 40px ${FONT}`)]); } catch { /* the fallback font */ }
  const out = document.createElement('canvas');
  out.width = out.height = SIZE;
  const c = out.getContext('2d')!;
  c.fillStyle = '#000';
  c.fillRect(0, 0, SIZE, SIZE);
  c.drawImage(atom, 0, 0, SIZE, SIZE);
  // The plate: the atom's number over its symbol on its place color, as on Collect.
  const pad = 72, plate = 104, y = SIZE - pad - plate;
  const blk = placeColour(e);
  c.fillStyle = blk;
  c.beginPath();
  c.roundRect(pad, y, plate, plate, 22);
  c.fill();
  c.fillStyle = inkOn(blk);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `600 26px ${FONT}`;
  c.fillText(String(e.z), pad + plate / 2, y + 30);
  c.font = `700 44px ${FONT}`;
  c.fillText(e.symbol, pad + plate / 2, y + 68);
  // The name beside it, and the mark at the right.
  c.fillStyle = '#fff';
  c.textAlign = 'left';
  c.font = `600 64px ${FONT}`;
  c.fillText(e.name, pad + plate + 28, y + plate / 2);
  c.textAlign = 'right';
  c.font = `700 28px ${FONT}`;
  if ('letterSpacing' in c) (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0.3em';
  c.fillStyle = 'rgba(255,255,255,0.7)';
  c.fillText('ATOMOS', SIZE - pad + 8, y + plate / 2);
  return out;
}

/** Share the picture, or save it where sharing files is not offered. Says which happened. */
export async function sharePicture(e: Element, picture: HTMLCanvasElement): Promise<'shared' | 'saved' | 'cancelled' | 'failed'> {
  const blob = await new Promise<Blob | null>((res) => picture.toBlob(res, 'image/png'));
  if (!blob) return 'failed';
  const name = `atomos-${e.name.toLowerCase()}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean; share?: (d: ShareData) => Promise<void> };
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try { await nav.share({ files: [file], title: e.name, text: `${e.name}, built in ATOMOS` }); return 'shared'; }
    catch (err) { if ((err as Error).name === 'AbortError') return 'cancelled'; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}
