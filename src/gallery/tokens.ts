// Colours for the WebGL scenes, read from the design tokens in src/ui/tokens.css so a restyle
// there reaches the canvases too. Orbital colours stay in data.ts: they never change.

const cache = new Map<string, string>();

/** A CSS custom property's value as a colour string, or the fallback when it is not set. */
export function token(name: string, fallback: string): string {
  let v = cache.get(name);
  if (v === undefined) {
    v = typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    cache.set(name, v);
  }
  return v || fallback;
}
