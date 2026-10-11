// The always-on performance readout, top right: smoothed frames per second and frame time,
// plus what the current experiment is spending (steps, particles, render resolution).

import type { LabContext } from './types';

export class Fps {
  private el: HTMLElement;
  private frames = 0;
  private windowStart = performance.now();
  private prev = performance.now();
  private ms = 16.7;
  private fps = 60;
  private worst = 0;

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'lab-fps';
    this.el.setAttribute('aria-live', 'off');
    host.appendChild(this.el);
  }

  tick(now: number, stats: string, ctx: LabContext): void {
    const dt = now - this.prev;
    this.prev = now;
    // Frame time: exponential average (~0.5 s), plus the worst frame in the window.
    this.ms += (dt - this.ms) * 0.08;
    this.worst = Math.max(this.worst, dt);
    this.frames++;
    const span = now - this.windowStart;
    if (span >= 500) {
      this.fps = (this.frames * 1000) / span;
      this.el.innerHTML = `<b>${this.fps.toFixed(this.fps < 10 ? 1 : 0)}</b> fps · ${this.ms.toFixed(1)} ms <span class="lab-fps-worst">max ${this.worst.toFixed(0)}</span>`
        + `<br><span>${stats}</span><br><span>canvas ${ctx.width}×${ctx.height}</span>`;
      this.el.classList.toggle('slow', this.fps < 30);
      this.frames = 0;
      this.worst = 0;
      this.windowStart = now;
    }
  }
}
