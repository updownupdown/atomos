// The quality governor: holds the atom at a steady 60 frames a second by trading detail for
// time. It watches frame times and steps down a ladder of levels (each draws a coarser layer
// and fewer points) when frames are missed, and steps back up only after a long clean stretch.
// Frame times alone cannot show headroom (a 60 Hz screen paces every frame at 16.7 ms however
// little it costs), so stepping up is a cautious experiment: if the better level misses frames
// again soon after, the governor steps back down and waits twice as long before the next try,
// which keeps it from oscillating between two levels.
//
// Pure logic, no DOM: feed it every frame's duration with frame() (see tests/governor.test.ts).

/** What a level costs: the share of the dense orbital's extra points drawn (the focused or lit
 *  orbital's), the share of the screen's resolution (each side) the point layer draws at, and
 *  the share of every orbital's base points drawn. */
export interface QualityLevel {
  dense: number;
  pixel: number;
  density: number;
}

/** Best first. Level 0 is "High": the dense orbital in full, every base point, full resolution.
 *  The dense orbital's extra points go first; only then does the base look thin out. */
export const QUALITY_LEVELS: QualityLevel[] = [
  { dense: 1, pixel: 1, density: 1 },
  { dense: 0.6, pixel: 1, density: 1 },
  { dense: 0.3, pixel: 1, density: 1 },
  { dense: 0, pixel: 1, density: 1 },
  { dense: 0, pixel: 0.85, density: 0.8 },
  { dense: 0, pixel: 0.72, density: 0.64 },
  { dense: 0, pixel: 0.6, density: 0.5 },
  { dense: 0, pixel: 0.5, density: 0.4 },
  { dense: 0, pixel: 0.42, density: 0.3 },
  { dense: 0, pixel: 0.35, density: 0.22 },
];

export interface GovernorOptions {
  /** How many levels (0 best). */
  levels: number;
  /** The frame budget (ms): 60 fps. */
  targetMs: number;
  /** A frame longer than this missed its slot. */
  slowMs: number;
  /** Frames are judged in windows this long (ms). */
  windowMs: number;
  /** A window with more than this share of missed frames steps down. */
  downMiss: number;
  /** A window with at most this share of missed frames counts as clean. */
  upMiss: number;
  /** Clean time (ms) before trying the next better level; it doubles each time a try fails. */
  upAfterMs: number;
  maxUpAfterMs: number;
  /** No two changes closer than this (ms). */
  cooldownMs: number;
  /** Frames longer than this (a hidden tab, a one-off stall) are not judged at all. */
  ignoreMs: number;
}

export const GOVERNOR_DEFAULTS: GovernorOptions = {
  levels: QUALITY_LEVELS.length,
  targetMs: 1000 / 60,
  slowMs: 21,
  windowMs: 1000,
  downMiss: 0.25,
  upMiss: 0.03,
  upAfterMs: 4000,
  maxUpAfterMs: 32000,
  cooldownMs: 2000,
  ignoreMs: 250,
};

export class QualityGovernor {
  readonly opts: GovernorOptions;
  /** The current level (0 best). */
  level: number;
  /** Smoothed frame time (ms). */
  ema: number;
  private winStart = -1;
  private frames = 0;
  private misses = 0;
  private clean = 0;
  private lastChange = -Infinity;
  private lastUp = -Infinity;
  /** How long to stay clean before the next step up (ms); doubles after a failed try. */
  upWait: number;

  constructor(opts: Partial<GovernorOptions> = {}, start = 0) {
    this.opts = { ...GOVERNOR_DEFAULTS, ...opts };
    this.level = Math.max(0, Math.min(this.opts.levels - 1, start));
    this.ema = this.opts.targetMs;
    this.upWait = this.opts.upAfterMs;
  }

  /** Forget the current window (after a pause, or while something else is known to stall). */
  reset(now: number): void {
    this.winStart = now;
    this.frames = 0;
    this.misses = 0;
  }

  /** One frame took `dt` ms, ending at `now` (ms). True when the level changed. */
  frame(dt: number, now: number): boolean {
    const o = this.opts;
    if (this.winStart < 0) this.reset(now - dt);
    if (dt > o.ignoreMs) { this.reset(now); return false; }
    this.ema += (dt - this.ema) * 0.1;
    this.frames++;
    if (dt > o.slowMs) this.misses++;
    const span = now - this.winStart;
    if (span < o.windowMs) return false;
    const miss = this.misses / Math.max(1, this.frames);
    this.reset(now);
    const settled = now - this.lastChange >= o.cooldownMs;
    if (miss > o.downMiss) {
      this.clean = 0;
      // A try of a better level that misses frames is undone at once; other steps down wait
      // out the cooldown, so one slow window doesn't cascade.
      const trying = this.lastUp === this.lastChange;
      if (!(settled || trying) || this.level >= o.levels - 1) return false;
      // A step up that failed soon after: wait twice as long before trying again.
      if (now - this.lastUp < this.upWait + o.windowMs * 2) this.upWait = Math.min(o.maxUpAfterMs, this.upWait * 2);
      // Far too slow: take two steps.
      const steps = this.ema > o.targetMs * 2.2 ? 2 : 1;
      this.level = Math.min(o.levels - 1, this.level + steps);
      this.lastChange = now;
      return true;
    }
    this.clean = miss <= o.upMiss ? this.clean + span : 0;
    // Long clean at this level since the last try: the try held, so trust the next one sooner.
    if (now - this.lastUp > this.upWait * 3) this.upWait = Math.max(o.upAfterMs, this.upWait / 2);
    if (this.level > 0 && settled && this.clean >= this.upWait) {
      this.level--;
      this.clean = 0;
      this.lastChange = now;
      this.lastUp = now;
      return true;
    }
    return false;
  }

  get spec(): QualityLevel {
    return QUALITY_LEVELS[Math.min(QUALITY_LEVELS.length - 1, this.level)];
  }
}
