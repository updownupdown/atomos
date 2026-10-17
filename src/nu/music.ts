// Nu's music: a small composer for the park's games, so their sounds make tunes rather than the
// same few notes over and over. Each game, each time it opens, gets a theme of its own: a key, a
// mode (major, Dorian, Mixolydian, Lydian or minor), an instrument and two motifs. The games'
// sounds are events (a catch, a bounce, a miss), so the events play the music: each catch plays
// the melody's next note over the chord it falls on, with the harmony layered under it.
//
// Harmony: periods of eight chords, walking the usual ways (I to IV or V, ii to V, V home...),
// with sevenths on the chords that lean somewhere, secondary dominants (the V of the chord that
// follows, its third raised), a chord borrowed from the parallel key now and then, and cadences
// that vary: half (on V), whole (V-I), plagal (IV-I) or deceptive (V-vi, and the phrase goes on).
// A chord lasts one or two notes, so the harmonic rhythm moves.
//
// Melody: sixteen notes a period, in four small phrases: the first motif, the first again moved
// onto the new chord (or upside down, or back to front), the second motif (a contrast), and a
// close onto the cadence. Strong notes lean to the chord's notes, passing notes fill thirds,
// a leap is followed by a step back. Every period the motifs change a little and every few the
// key moves to a near one, so a long run keeps going somewhere.
//
// Layers: the bass on each new chord, a soft strum of the chord, and now and then a second voice
// a third or sixth under the tune. The sound is dry and crisp: short notes, a light room only.

import { audioContext, buzz as haptic } from '../audio';

type Voice = 'bell' | 'pluck' | 'marimba' | 'glass' | 'reed';

const MODES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};
const MINOR = new Set(['dorian', 'minor']);

/** Where each chord (by its root's degree) may go next: the common functional moves. */
const NEXT: number[][] = [
  [3, 4, 5, 1, 3, 5, 2], // I: to IV, V, vi, ii, iii
  [4, 4, 6, 4], // ii: to V
  [5, 3, 5], // iii: to vi, IV
  [4, 0, 1, 4, 6], // IV: to V, I, ii
  [0, 0, 5, 3], // V: home, or vi
  [3, 1, 4, 1], // vi: to IV, ii, V
  [0, 2], // vii
];

/** A chord: its root (a scale degree), its notes (degrees), and the semitones any of them is
 *  moved by (a secondary dominant's raised third, a borrowed chord's lowered one). */
interface Chord { root: number; tones: number[]; alt: Record<number, number> }

interface Theme {
  root: number; // MIDI note of the key's tonic (the melody plays an octave up)
  home: number; // the tonic the theme started on (Echo's notes stay there)
  mode: number[];
  minor: boolean;
  voice: Voice;
  a: number[]; // the first motif: steps between its notes, in scale degrees
  b: number[]; // the second, a contrast
  phrase: number[]; // the period being played, in degrees
  chords: Chord[]; // the chord under each of its notes
  at: number; // the next note in it
  count: number; // periods played
  last: number; // the last degree played
}

const R = (n: number): number => Math.floor(Math.random() * n);
const pick = <T>(a: T[]): T => a[R(a.length)];
const chance = (p: number): boolean => Math.random() < p;
const clampD = (d: number): number => Math.max(-3, Math.min(11, d));
const mod7 = (d: number): number => ((d % 7) + 7) % 7;
/** Notes in a period. */
const LEN = 16;

let lastAt = 0;

function semis(t: Theme, d: number, c?: Chord): number {
  const o = Math.floor(d / 7), k = mod7(d);
  return t.mode[k] + 12 * o + (c?.alt[k] ?? 0);
}

const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/** A motif: three to five steps, mostly by step, sometimes a leap, with a turn in it. */
function motif(leaps: number): number[] {
  const n = 3 + R(3), m: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = chance(leaps) ? 2 + R(3) : chance(0.15) ? 0 : 1 + R(2);
    m.push(s * (chance(0.5) ? -1 : 1));
  }
  if (m.every((s) => Math.sign(s) === Math.sign(m[0]))) m[m.length - 1] = -m[m.length - 1];
  return m;
}

/** A triad, or with a seventh, on `root`, in the key. */
function triad(t: Theme, root: number, seventh = false): Chord {
  return { root, tones: seventh ? [root, root + 2, root + 4, root + 6] : [root, root + 2, root + 4], alt: {} };
}

/** The V7 of the chord on `target`: a major triad with a minor seventh, a fifth above it. */
function dominantOf(t: Theme, target: number): Chord {
  const root = target + 4, c = triad(t, root, true), base = semis(t, root);
  const want = [0, 4, 7, 10];
  c.tones.forEach((d, i) => {
    const have = semis(t, d) - base, k = mod7(d);
    if (have !== want[i]) c.alt[k] = want[i] - have;
  });
  return c;
}

/** The iv (minor) borrowed into a major key, or the IV (major) into a minor one. */
function borrowed(t: Theme): Chord {
  const c = triad(t, 3), base = semis(t, 3), have = semis(t, 5) - base;
  c.alt[mod7(5)] = (t.minor ? 4 : 3) - have;
  return c;
}

/** Eight chords for a period, ending on a cadence. */
function progression(t: Theme): Chord[] {
  const roots = [t.count % 2 === 0 ? 0 : pick([0, 5, 3])];
  while (roots.length < 8) roots.push(pick(NEXT[roots[roots.length - 1]]));
  // The middle (fourth chord) rests on V, a half cadence, most times.
  if (chance(0.6)) roots[3] = 4;
  // The end: whole (ii-V-I), plagal (IV-I) or deceptive (V-vi).
  const end = pick(['whole', 'whole', 'plagal', 'deceptive']);
  if (end === 'whole') { roots[5] = pick([1, 3]); roots[6] = 4; roots[7] = 0; }
  if (end === 'plagal') { roots[6] = 3; roots[7] = 0; }
  if (end === 'deceptive') { roots[6] = 4; roots[7] = 5; }
  const chords = roots.map((r) => triad(t, r, (r === 1 || r === 4) && chance(0.55) || (r === 3 && chance(0.25))));
  // Colour: a secondary dominant before a chord that isn't home, and a borrowed chord.
  for (let i = 1; i < 7; i++) {
    if ([1, 3, 4, 5].includes(roots[i + 1]) && roots[i] !== 4 && chance(0.28)) chords[i] = dominantOf(t, roots[i + 1]);
  }
  if (chance(0.3)) { const i = pick([1, 2, 5]); if (roots[i] === 3 || chance(0.4)) chords[i] = borrowed(t); }
  return chords;
}

/** The nearest degree to `d` that is one of the chord's notes (in any octave, in the tune's range). */
function nearestTone(d: number, c: Chord): number {
  let best = d, gap = 99;
  for (const tn of c.tones) for (let o = -14; o <= 14; o += 7) {
    if (tn + o < -3 || tn + o > 11) continue;
    const g = Math.abs(tn + o - d);
    if (g < gap) { gap = g; best = tn + o; }
  }
  return best;
}

/** A motif varied: as it is, upside down, back to front, or stretched. */
function vary(m: number[], kind: number): number[] {
  if (kind === 1) return m.map((s) => -s);
  if (kind === 2) return m.slice().reverse().map((s) => -s);
  if (kind === 3) return m.map((s) => (Math.abs(s) === 1 ? s * 2 : s));
  return m.slice();
}

/** The next period: eight chords (one or two notes each) and sixteen notes. */
function compose(t: Theme): void {
  const prog = progression(t);
  // Harmonic rhythm: which chord is under each note. Eight chords over sixteen notes, mostly two
  // notes each, but some chords take one and the next three.
  const under: Chord[] = [];
  const lens = prog.map(() => 2);
  for (let k = 0; k < 2; k++) { const i = R(6); if (lens[i] > 1) { lens[i]--; lens[i + 1]++; } }
  prog.forEach((c, i) => { for (let j = 0; j < lens[i]; j++) under.push(c); });
  // Melody, four small phrases of four: A, A varied, B, and a close.
  const parts = [t.a, vary(t.a, t.count === 0 ? 0 : 1 + R(3)), t.b, vary(t.b, R(4))];
  const notes: number[] = [];
  let d = nearestTone(t.last || pick([2, 4, 7]), under[0]);
  for (let q = 0; q < 4; q++) {
    const m = parts[q];
    for (let j = 0; j < 4; j++) {
      const i = q * 4 + j;
      if (i > 0) {
        // Each small phrase starts on a note of its chord, near where the last left off.
        const s = j === 0 ? 0 : m[(j - 1) % m.length];
        d = j === 0 ? nearestTone(d + (chance(0.5) ? 1 : -1), under[i]) : clampD(d + s);
        // A leap is followed by a step back.
        const p = notes[i - 1], pp = notes[i - 2];
        if (i > 1 && Math.abs(p - pp) > 2 && Math.sign(d - p) === Math.sign(p - pp)) d = p - Math.sign(p - pp);
        // A third filled in now and then: a passing note.
        if (Math.abs(d - p) === 2 && j % 2 === 1 && chance(0.4)) d = p + Math.sign(d - p);
        // Strong notes lean to the chord's notes.
        if (j % 2 === 0) d = nearestTone(d, under[i]);
      }
      notes.push(clampD(d));
    }
  }
  // The close: the last notes settle onto the cadence chord's root or third.
  const last = under[LEN - 1];
  notes[LEN - 1] = nearestTone(notes[LEN - 2], { ...last, tones: [last.root, last.root + 2] });
  if (Math.abs(notes[LEN - 2] - notes[LEN - 1]) > 3) notes[LEN - 2] = notes[LEN - 1] + (notes[LEN - 2] > notes[LEN - 1] ? 1 : -1);
  // The halfway note rests on its chord, a breath.
  notes[7] = nearestTone(notes[7], under[7]);
  t.phrase = notes;
  t.chords = under;
  t.at = 0;
}

function make(): Theme {
  const name = pick(Object.keys(MODES));
  const root = 55 + R(8);
  const t: Theme = {
    root, home: root, mode: MODES[name], minor: MINOR.has(name),
    voice: pick<Voice>(['bell', 'pluck', 'marimba', 'glass', 'reed']),
    a: motif(0.15), b: motif(0.35),
    phrase: [], chords: [], at: 0, count: 0, last: 0,
  };
  compose(t);
  return t;
}

let theme: Theme = make();

// ---- Sound ------------------------------------------------------------------------------------

let bus: { a: AudioContext; out: AudioNode; send: AudioNode } | null = null;

/** The output: a gentle limiter, and a light, short room (one quick, quiet reflection). */
function out(): typeof bus {
  const a = audioContext();
  if (!a) return null;
  if (bus && bus.a === a) return bus;
  const comp = a.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 3;
  comp.connect(a.destination);
  const delay = a.createDelay(0.2), fb = a.createGain(), lp = a.createBiquadFilter(), send = a.createGain();
  delay.delayTime.value = 0.045; fb.gain.value = 0.12; lp.type = 'lowpass'; lp.frequency.value = 2600; send.gain.value = 0.1;
  send.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(comp);
  bus = { a, out: comp, send };
  return bus;
}

/** One note on an instrument. */
function play(midi: number, dur: number, gain: number, voice: Voice = theme.voice, delay = 0, pan = 0): void {
  const b = out();
  if (!b) return;
  const { a } = b, t = a.currentTime + delay, f = hz(midi);
  const g = a.createGain(), p = a.createStereoPanner();
  p.pan.value = pan;
  g.connect(p); p.connect(b.out); p.connect(b.send);
  const env = (node: GainNode, peak: number, len: number, attack = 0.005): void => {
    node.gain.setValueAtTime(0, t);
    node.gain.linearRampToValueAtTime(peak, t + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t + len);
  };
  const osc = (type: OscillatorType, freq: number, peak: number, len: number, attack?: number): void => {
    const o = a.createOscillator(), og = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    env(og, peak, len, attack);
    o.connect(og); og.connect(g);
    o.start(t); o.stop(t + len + 0.05);
  };
  g.gain.value = gain;
  switch (voice) {
    case 'bell': osc('sine', f, 1, dur); osc('sine', f * 2, 0.3, dur * 0.45); osc('sine', f * 3.01, 0.1, dur * 0.2); break;
    case 'marimba': osc('sine', f, 1, dur * 0.7, 0.003); osc('sine', f * 4, 0.22, 0.06, 0.002); break;
    case 'glass': osc('sine', f, 0.85, dur * 0.85, 0.008); osc('triangle', f * 2, 0.2, dur * 0.5, 0.008); break;
    case 'reed': {
      const lp = a.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 1.5;
      lp.frequency.setValueAtTime(f * 5, t); lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + dur);
      const o = a.createOscillator(), og = a.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(f, t);
      env(og, 0.4, dur * 0.8, 0.012);
      o.connect(lp); lp.connect(og); og.connect(g);
      o.start(t); o.stop(t + dur + 0.05);
      break;
    }
    default: { // pluck: a bright attack that dulls quickly
      const lp = a.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(Math.min(8000, f * 8), t); lp.frequency.exponentialRampToValueAtTime(f * 1.2, t + dur * 0.5);
      const o = a.createOscillator(), og = a.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(f, t);
      env(og, 1, dur * 0.8, 0.002);
      o.connect(lp); lp.connect(og); og.connect(g);
      o.start(t); o.stop(t + dur + 0.05);
      osc('sine', f, 0.35, dur * 0.9);
    }
  }
}

/** The layers under a melody note: on a new chord, its bass and a quick soft strum of it. */
function layers(i: number, d: number): void {
  const t = theme, c = t.chords[i], fresh = i === 0 || t.chords[i - 1] !== c;
  if (fresh) {
    play(t.root - 12 + semis(t, c.root, c), 0.55, 0.05, 'pluck', 0, -0.25);
    c.tones.slice(1).forEach((tn, k) => play(t.root + semis(t, tn, c), 0.32, 0.016, 'glass', 0.012 + k * 0.018, 0.25));
  } else if (chance(0.35)) {
    // A second voice: a note of the chord a third or sixth under the tune.
    const h = nearestTone(d - pick([2, 5]), c);
    if (h < d) play(t.root + 12 + semis(t, h, c), 0.3, 0.03, t.voice, 0.01, -0.15);
  }
}

/** On to the next period: the motifs change a little; every third, a near key. */
function moveOn(): void {
  const t = theme;
  t.count++;
  const i = R(t.a.length);
  t.a[i] = (1 + R(2)) * (chance(0.5) ? -1 : 1);
  if (chance(0.5)) t.b = motif(0.35);
  if (t.count % 3 === 0) {
    t.root = t.home + pick([0, 5, 7, -5, t.minor ? 3 : -3, 2]);
    while (t.root > 64) t.root -= 12;
    while (t.root < 52) t.root += 12;
  }
  compose(t);
}

// ---- What the games play ---------------------------------------------------------------------

/** A new theme, for a game that just opened. */
export function newTheme(): void { theme = make(); out(); }

/** The melody's next note (a catch, a hit, a point). */
export function melody(): void {
  const now = performance.now();
  // Catches in a burst would smear: closer than a short note apart, only the first sounds.
  if (now - lastAt < 55) return;
  lastAt = now;
  const t = theme, i = t.at, d = t.phrase[i], c = t.chords[i];
  const long = i === 7 || i === LEN - 1;
  play(t.root + 12 + semis(t, d, c), long ? 0.6 : 0.3, 0.075, t.voice, 0, (mod7(d) - 3) * 0.06);
  layers(i, d);
  t.last = d;
  t.at++;
  if (t.at >= LEN) moveOn();
}

let hits = 0;

/** A hit whose pitch says something about it: `x` (0..1, how near, how fast, where) picks one
 *  of the current chord's notes over two octaves, low to high, so a run of hits is never the
 *  same few notes in turn. Every few hits the harmony moves on a chord, and a new chord brings
 *  its bass. */
export function hit(x: number): void {
  const now = performance.now();
  if (now - lastAt < 45) return;
  lastAt = now;
  const t = theme, i = Math.min(LEN - 1, t.at), c = t.chords[i];
  const notes: number[] = [];
  for (let o = 0; o < 2; o++) for (const tn of c.tones) notes.push(tn + 7 * o);
  const d = notes[Math.max(0, Math.min(notes.length - 1, Math.floor(x * notes.length)))];
  play(t.root + 12 + semis(t, d, c), 0.22, 0.06, t.voice, 0, (x - 0.5) * 0.5);
  if (++hits % 3 === 0) {
    t.at++;
    if (t.at >= LEN) moveOn();
    else if (t.chords[t.at] !== c) play(t.root - 12 + semis(t, t.chords[t.at].root, t.chords[t.at]), 0.45, 0.04, 'pluck', 0.05, -0.25);
  }
}

/** A small tick in the key: the current chord's `n`th note up (higher n, higher). */
export function tick(n: number): void {
  const t = theme, c = t.chords[Math.min(LEN - 1, t.at)];
  const k = ((n % c.tones.length) + c.tones.length) % c.tones.length;
  const d = c.tones[k] + 7 * Math.floor(n / c.tones.length);
  play(t.root + 12 + semis(t, d, c), 0.08, 0.04, 'marimba');
}

/** One of five notes, the same five for the whole theme (Echo's tune, Nu's chirps): the key's
 *  pentatonic, from its first tonic. */
export function chime(i: number): void {
  const pent = theme.minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  const k = ((i % 5) + 5) % 5;
  play(theme.home + 12 + pent[k], 0.45, 0.07, 'bell', 0, (k - 2) * 0.15);
}

/** A level done: a cadence home, ii-V-I, the tonic chord rolled up over its bass. */
export function cadence(): void {
  const t = theme, base = t.root + 12, v = dominantOf(t, 0);
  [1, 3, 5].forEach((d, k) => play(base + semis(t, d) - 12, 0.25, 0.035, t.voice, k * 0.02));
  v.tones.forEach((d, k) => play(base + semis(t, d, v) - 12, 0.3, 0.035, t.voice, 0.14 + k * 0.02));
  play(t.root - 12 + semis(t, 4), 0.35, 0.045, 'pluck', 0.14);
  [0, 2, 4, 7].forEach((d, k) => play(base + semis(t, d), 0.8, 0.06, t.voice, 0.32 + k * 0.06, (k - 1.5) * 0.2));
  play(t.root - 12, 0.9, 0.055, 'pluck', 0.32);
  haptic([30, 60, 30, 60, 80]);
  t.last = 0;
  moveOn();
}

/** A miss: a soft falling sigh, a step down onto a note of the chord, low. */
export function sigh(): void {
  const t = theme, c = t.chords[Math.min(LEN - 1, t.at)], to = nearestTone(c.root + 2, c);
  play(t.root + semis(t, to + 1, c), 0.2, 0.05, t.voice);
  play(t.root + semis(t, to, c), 0.4, 0.045, t.voice, 0.12);
  // The tune goes back to the start of its small phrase.
  t.at = t.at - (t.at % 4);
}

/** The period being played, in degrees, and the root of the chord under each note (for the
 *  tests). */
export const phraseNow = (): { notes: number[]; chords: number[] } => ({ notes: theme.phrase.slice(), chords: theme.chords.map((c) => c.root) });
