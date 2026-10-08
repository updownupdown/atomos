// Small synthesised sound and haptic palette. No audio files, so the build stays tiny.

let ctx: AudioContext | null = null;
let enabled = true;
let haptics = true;

export function setSound(on: boolean): void { enabled = on; }
export function setHaptics(on: boolean): void { haptics = on; }

function audio(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, gain = 0.08, type: OscillatorType = 'sine', delay = 0): void {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export function buzz(pattern: number | number[]): void {
  if (haptics && 'vibrate' in navigator) navigator.vibrate(pattern);
}

/** Higher-energy light plays higher: pitch rises with the log of photon energy. */
export function photonSound(ev: number, delay = 0): void {
  const f = 330 * Math.pow(2, Math.log10(Math.max(0.5, ev)) * 1.1);
  tone(Math.min(f, 3000), 0.5, 0.06, 'sine', delay);
}

export function captureSound(): void {
  tone(880, 0.12, 0.05, 'triangle');
  buzz(12);
}

export function bounceSound(): void {
  tone(196, 0.18, 0.08, 'square');
  tone(185, 0.18, 0.05, 'square', 0.02);
  buzz([20, 40, 20]);
}

export function sourSound(): void {
  tone(440, 0.6, 0.05, 'sawtooth');
  tone(466, 0.6, 0.05, 'sawtooth');
}

export function harmonySound(): void {
  tone(523.25, 0.9, 0.05);
  tone(659.25, 0.9, 0.04, 'sine', 0.05);
  tone(783.99, 0.9, 0.04, 'sine', 0.1);
}

export function completeSound(): void {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 1.4, 0.05, 'sine', i * 0.09));
  buzz([30, 60, 30, 60, 80]);
}

export function sliceSound(): void {
  tone(1200, 0.4, 0.04, 'triangle');
  tone(600, 0.8, 0.04, 'sine', 0.1);
  buzz(40);
}

export function decaySound(): void {
  tone(150, 0.4, 0.07, 'triangle');
  buzz([10, 30, 10]);
}

export function ioniseSound(): void {
  tone(300, 0.3, 0.07, 'sawtooth');
  buzz(60);
}

/** A soft tick as the pull crosses into a capture band; higher bands tick higher. */
export function tickSound(n: number): void {
  tone(600 + 120 * n, 0.06, 0.04, 'sine');
  buzz(6);
}

export function missSound(): void {
  tone(260, 0.35, 0.05, 'triangle');
  tone(196, 0.45, 0.04, 'triangle', 0.12);
  buzz([15, 50, 15]);
}

export function centreSound(): void {
  tone(1318.5, 0.5, 0.035, 'sine', 0.05);
}
