// Nu's music: a small composer for the park's games, so their sounds make tunes rather than the
// same few notes over and over. Each game, each time it opens, gets a theme of its own: a key, a
// mode (major, Dorian, Mixolydian, Lydian or minor), an instrument, an echo and a motif of four or
// five notes. The games' sounds are events (a catch, a bounce, a miss), so the events play the
// music: each catch plays the melody's next note, over the chord it falls on.
//
// The melody comes in phrases of eight notes over four chords, the chords walking the usual ways
// (I to IV or V, ii to V, V home...). Each phrase is the motif and an answer to it: moved onto
// the chord, turned upside down, played back to front or stretched. Notes on the strong beats
// lean to the chord's notes, a leap is followed by a step back, and a phrase ends on a cadence,
// half (on the fifth) and then whole (home). Every few phrases the theme moves to a near key and
// the motif changes a note, so a long run keeps going somewhere. A level done plays a cadence; a
// miss a soft sigh, in the key.

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
  [3, 4, 5, 1, 3, 4], // I: to IV, V, vi, ii
  [4, 4, 6], // ii: to V
  [5, 3], // iii
  [4, 0, 1, 4], // IV: to V, I, ii
  [0, 0, 5, 3], // V: home, or vi
  [3, 1, 4], // vi
  [0, 2], // vii
];

interface Theme {
  root: number; // MIDI note of the key's tonic (the melody plays an octave up)
  home: number; // the tonic the theme started on (Echo's notes stay there)
  mode: number[];
  minor: boolean;
  voice: Voice;
  motif: number[]; // steps between the motif's notes, in scale degrees
  echo: number; // the echo's delay, s
  phrase: number[]; // the phrase being played, in degrees
  chords: number[]; // its four chords, by root degree
  at: number; // the next note in it
  count: number; // phrases played
  last: number; // the last degree played
}

const R = (n: number): number => Math.floor(Math.random() * n);
const pick = <T>(a: T[]): T => a[R(a.length)];
const clampD = (d: number): number => Math.max(-3, Math.min(11, d));

let lastAt = 0;

function make(): Theme {
  const name = pick(Object.keys(MODES));
  const root = 55 + R(8);
  const t: Theme = {
    root, home: root, mode: MODES[name], minor: MINOR.has(name),
    voice: pick<Voice>(['bell', 'pluck', 'marimba', 'glass', 'reed']),
    motif: motif(), echo: 0.16 + Math.random() * 0.16,
    phrase: [], chords: [], at: 0, count: 0, last: 0,
  };
  compose(t);
  return t;
}

/** Four or five notes: mostly steps, now and then a leap, and not all one way. */
function motif(): number[] {
  const n = 3 + R(2), m: number[] = [];
  for (let i = 0; i < n; i++) {
    const leap = Math.random() < 0.22;
    m.push((leap ? 2 + R(3) : 1 + R(2)) * (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.12 ? 0 : 1));
  }
  if (m.every((s) => Math.sign(s) === Math.sign(m[0]))) m[m.length - 1] = -m[m.length - 1];
  return m;
}

const chordTones = (c: number): number[] => [c, c + 2, c + 4];

/** The nearest degree to `d` that is one of the chord's notes (in any octave). */
function nearestTone(d: number, c: number): number {
  let best = d, gap = 99;
  for (const t of chordTones(c)) for (let o = -14; o <= 14; o += 7) {
    const g = Math.abs(t + o - d);
    if (g < gap) { gap = g; best = t + o; }
  }
  return best;
}

/** The next phrase: four chords, and eight notes made from the motif. */
function compose(t: Theme): void {
  const whole = t.count % 2 === 1;
  // Chords: start home on the first phrase, then walk; end on V (a half cadence) or V-I (home).
  const ch = [t.count % 2 === 0 ? 0 : pick(NEXT[0])];
  while (ch.length < 4) ch.push(pick(NEXT[ch[ch.length - 1]]));
  if (whole) { ch[2] = pick([3, 1, 5]); ch[3] = 4; } else ch[3] = 4;
  t.chords = ch;
  // Variations of the motif: as it is, moved, upside down, back to front, or stretched.
  const kind = t.count === 0 ? 0 : R(5);
  let m = t.motif.slice();
  if (kind === 2) m = m.map((s) => -s);
  if (kind === 3) m = m.slice().reverse().map((s) => -s);
  if (kind === 4) m = m.map((s) => (Math.abs(s) === 1 ? s * 2 : s));
  const notes: number[] = [];
  let d = nearestTone(t.last || 4, ch[0]);
  notes.push(d);
  for (let i = 1; i < 8; i++) {
    // The first half is the motif; the second answers it, a step or two the other way.
    const s = i < 4 ? m[(i - 1) % m.length] : (i === 4 ? -Math.sign(notes[3] - notes[0] || 1) * (1 + R(2)) : m[(i - 4) % m.length] * (kind === 1 ? -1 : 1));
    d = clampD(d + s);
    // A leap is followed by a step back.
    if (i > 1 && Math.abs(notes[i - 1] - notes[i - 2]) > 2) d = notes[i - 1] - Math.sign(notes[i - 1] - notes[i - 2]);
    // Strong beats lean to the chord's notes.
    if (i % 2 === 0) d = nearestTone(d, ch[i >> 1]);
    notes.push(clampD(d));
  }
  // The cadence: the last note settles on the fifth (half) or the tonic (whole).
  const end = whole ? (notes[6] > 5 ? 7 : 0) : (notes[6] > 2 ? 4 : 1);
  notes[7] = end;
  if (Math.abs(notes[6] - end) > 3) notes[6] = end + Math.sign(notes[6] - end) * 1;
  t.phrase = notes;
  t.at = 0;
}

function semis(t: Theme, d: number): number {
  const o = Math.floor(d / 7), k = ((d % 7) + 7) % 7;
  return t.mode[k] + 12 * o;
}

const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

let theme: Theme = make();

// ---- Sound ------------------------------------------------------------------------------------

let bus: { a: AudioContext; out: AudioNode; send: AudioNode; delay: DelayNode } | null = null;

/** The output: a gentle limiter, and an echo (a delay fed back through a soft filter). */
function out(): typeof bus {
  const a = audioContext();
  if (!a) return null;
  if (bus && bus.a === a) { bus.delay.delayTime.setTargetAtTime(theme.echo, a.currentTime, 0.1); return bus; }
  const comp = a.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 3;
  comp.connect(a.destination);
  const delay = a.createDelay(1), fb = a.createGain(), lp = a.createBiquadFilter(), wet = a.createGain(), send = a.createGain();
  delay.delayTime.value = theme.echo; fb.gain.value = 0.32; lp.type = 'lowpass'; lp.frequency.value = 2200; wet.gain.value = 0.5; send.gain.value = 0.35;
  send.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(wet); wet.connect(comp);
  bus = { a, out: comp, send, delay };
  return bus;
}

/** One note on the theme's instrument. */
function play(midi: number, dur: number, gain: number, voice: Voice = theme.voice, delay = 0, pan = 0): void {
  const b = out();
  if (!b) return;
  const { a } = b, t = a.currentTime + delay, f = hz(midi);
  const g = a.createGain(), p = a.createStereoPanner();
  p.pan.value = pan;
  g.connect(p); p.connect(b.out); p.connect(b.send);
  const env = (node: GainNode, peak: number, len: number, attack = 0.008): void => {
    node.gain.setValueAtTime(0, t);
    node.gain.linearRampToValueAtTime(peak, t + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t + len);
  };
  const osc = (type: OscillatorType, freq: number, peak: number, len: number, attack?: number): OscillatorNode => {
    const o = a.createOscillator(), og = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    env(og, peak, len, attack);
    o.connect(og); og.connect(g);
    o.start(t); o.stop(t + len + 0.05);
    return o;
  };
  g.gain.value = gain;
  switch (voice) {
    case 'bell': osc('sine', f, 1, dur * 1.6); osc('sine', f * 2, 0.35, dur * 0.7); osc('sine', f * 3.01, 0.12, dur * 0.3); break;
    case 'marimba': osc('sine', f, 1, dur * 0.9, 0.004); osc('sine', f * 4, 0.25, 0.08, 0.002); break;
    case 'glass': osc('sine', f, 0.8, dur * 1.4, 0.02); osc('triangle', f * 2, 0.25, dur, 0.02); osc('sine', f * 1.5, 0.08, dur * 0.8, 0.03); break;
    case 'reed': {
      const lp = a.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 2;
      lp.frequency.setValueAtTime(f * 5, t); lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + dur);
      const o = a.createOscillator(), og = a.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(f, t);
      env(og, 0.45, dur, 0.02);
      o.connect(lp); lp.connect(og); og.connect(g);
      o.start(t); o.stop(t + dur + 0.05);
      break;
    }
    default: { // pluck: a bright attack that dulls quickly
      const lp = a.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(Math.min(8000, f * 8), t); lp.frequency.exponentialRampToValueAtTime(f * 1.2, t + dur * 0.6);
      const o = a.createOscillator(), og = a.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(f, t);
      env(og, 1, dur, 0.003);
      o.connect(lp); lp.connect(og); og.connect(g);
      o.start(t); o.stop(t + dur + 0.05);
      osc('sine', f, 0.4, dur * 1.2);
    }
  }
}

/** The chord under a note: its root low and soft, and on the first beat of a chord its fifth. */
function under(chord: number, full: boolean): void {
  const r = theme.root - 12 + semis(theme, chord);
  play(r, 0.9, 0.035, 'glass', 0, -0.2);
  if (full) play(theme.root + semis(theme, chord + 4) - 12, 0.8, 0.018, 'glass', 0.02, 0.2);
}

/** Every few phrases, on to a near key (a fourth or fifth away, or the relative), and a new note
 *  in the motif. */
function moveOn(): void {
  theme.count++;
  if (theme.count % 4 === 0) {
    theme.root = theme.home + pick([0, 5, 7, -5, theme.minor ? 3 : -3]);
    while (theme.root > 64) theme.root -= 12;
    while (theme.root < 52) theme.root += 12;
    const i = R(theme.motif.length);
    theme.motif[i] = (1 + R(2)) * (Math.random() < 0.5 ? -1 : 1);
  }
  compose(theme);
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
  const t = theme, i = t.at, d = t.phrase[i];
  play(t.root + 12 + semis(t, d), i === 7 ? 0.9 : 0.42, 0.075, t.voice, 0, ((d % 7) - 3) * 0.06);
  if (i % 2 === 0) under(t.chords[i >> 1], i % 4 === 0);
  t.last = d;
  t.at++;
  if (t.at >= 8) moveOn();
}

/** A small tick in the key: the current chord's `n`th note up (higher n, higher). */
export function tick(n: number): void {
  const t = theme, c = t.chords[Math.min(3, t.at >> 1)] ?? 0;
  const d = chordTones(c)[((n % 3) + 3) % 3] + 7 * Math.floor(n / 3);
  play(t.root + 12 + semis(t, d), 0.09, 0.04, 'marimba');
}

/** One of five notes, the same five for the whole theme (Echo's tune, Nu's chirps): the key's
 *  pentatonic, from its first tonic. */
export function chime(i: number): void {
  const pent = theme.minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  const k = ((i % 5) + 5) % 5;
  play(theme.home + 12 + pent[k], 0.55, 0.07, 'bell', 0, (k - 2) * 0.15);
}

/** A level done: a cadence home, V then I, the tonic chord rolled up. */
export function cadence(): void {
  const t = theme, base = t.root + 12;
  [4, 6, 8].forEach((d, k) => play(base + semis(t, d) - 12, 0.5, 0.04, t.voice, k * 0.03));
  [0, 2, 4, 7].forEach((d, k) => play(base + semis(t, d), 1.3, 0.06, t.voice, 0.22 + k * 0.08, (k - 1.5) * 0.2));
  play(t.root - 12, 1.6, 0.05, 'glass', 0.22);
  haptic([30, 60, 30, 60, 80]);
  t.count = t.count % 2 === 0 ? t.count + 1 : t.count;
  t.last = 0;
  moveOn();
}

/** A miss: a soft falling sigh, a step down onto a note of the chord, low. */
export function sigh(): void {
  const t = theme, c = t.chords[Math.min(3, t.at >> 1)] ?? 0, to = nearestTone(c + 2, c);
  play(t.root + semis(t, to + 1), 0.25, 0.05, t.voice);
  play(t.root + semis(t, to), 0.5, 0.045, t.voice, 0.14);
  // The tune starts its phrase again, from the top.
  t.at = 0;
}

/** The phrase being played, in degrees, and its chords (for the tests). */
export const phraseNow = (): { notes: number[]; chords: number[] } => ({ notes: theme.phrase.slice(), chords: theme.chords.slice() });
