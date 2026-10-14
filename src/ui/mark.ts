// The Atomos mark: a lithium ion. Seven nucleons packed in a honeycomb (solid protons,
// hollow neutrons) inside one closed shell, with both electrons sitting in gaps cut in the
// ring. Li⁺ is the one honest way to draw that core with a single shell. Everything is
// drawn on a 100-unit grid in one colour, so the same geometry serves the app icon, the
// favicon and the gallery title. scripts/gen-icons.mjs renders the PNGs.

export const MARK = {
  core: 0.66,     // nucleus size as a share of the grid
  space: 1.2,     // nucleon spacing, 1.0 = touching
  ring: 41,       // shell radius
  stroke: 7.5,    // shell stroke
  gap: 40,        // degrees of ring removed for each electron
  electron: 6,    // electron radius
  angle: 45,      // first electron's bearing; the second sits opposite
};

const D = Math.PI / 180;
const f = (n: number) => +n.toFixed(2);
const pt = (r: number, a: number): [number, number] => [f(50 + r * Math.cos(a * D)), f(50 + r * Math.sin(a * D))];

const arc = (r: number, a0: number, a1: number, sw: number) => {
  const [x0, y0] = pt(r, a0), [x1, y1] = pt(r, a1);
  return `<path d="M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}" pathLength="1" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round"/>`;
};

/** Nucleon centres and kinds: centre first, then the six around it clockwise from the top right. */
export function nucleons(): { x: number; y: number; proton: boolean }[] {
  const k = MARK.core, d = 21 * MARK.space * k;
  return [
    { x: 50, y: 50, proton: true },
    ...[0, 1, 2, 3, 4, 5].map((i) => ({
      x: f(50 + d * Math.cos((i * 60 + 30) * D)),
      y: f(50 + d * Math.sin((i * 60 + 30) * D)),
      proton: i % 2 === 0,
    })),
  ];
}

export function nucleonRadius(): number { return f(9.6 * MARK.core); }

/** The ring's two arcs, each ending short of an electron. */
export function shellArcs(): string[] {
  const { ring, gap, stroke, angle: a } = MARK;
  return [arc(ring, a + gap / 2, a + 180 - gap / 2, stroke), arc(ring, a + 180 + gap / 2, a + 360 - gap / 2, stroke)];
}

export function electrons(): [number, number][] {
  return [pt(MARK.ring, MARK.angle), pt(MARK.ring, MARK.angle + 180)];
}

/**
 * The mark as SVG inner markup in `currentColor`, classed so each part can be styled:
 * parts: .nucleon (with .proton or .neutron), .shell, .orbit > .electron.
 * With `nu`, it is the header's mark, where Nu rests (nu.ts): every nucleon is numbered
 * data-nu-dot (0 the centre, then clockwise from the top right) and is one of Nu's home slots
 * (.nu-home-slot): each time Nu comes home it picks one of them at random.
 */
export function markInner(o: { nu?: boolean } = {}): string {
  const r = nucleonRadius();
  const core = nucleons().map(({ x, y, proton }, i) => {
    const nu = o.nu ? ` data-nu-dot="${i}"` : '';
    const cls = o.nu ? ' nu-home-slot' : '';
    return proton
      ? `<circle class="nucleon proton${cls}"${nu} cx="${x}" cy="${y}" r="${r}" fill="currentColor"/>`
      : `<circle class="nucleon neutron${cls}"${nu} cx="${x}" cy="${y}" r="${f(r * 0.83)}" fill="none" stroke="currentColor" stroke-width="${f(r * 0.36)}"/>`;
  }).join('');
  const shell = shellArcs().map((p) => p.replace('<path ', '<path class="shell" ')).join('');
  // Each electron sits in its own group, so it can be turned round the ring on its own.
  const el = electrons().map(([x, y]) => `<g class="orbit"><circle class="electron" cx="${x}" cy="${y}" r="${MARK.electron}" fill="currentColor"/></g>`).join('');
  return core + shell + el;
}

/** A complete inline SVG of the mark, sized by CSS, in the current text colour. */
export function markSvg(attrs = '', o: { nu?: boolean } = {}): string {
  return `<svg viewBox="0 0 100 100" aria-hidden="true" ${attrs}>${markInner(o)}</svg>`;
}
