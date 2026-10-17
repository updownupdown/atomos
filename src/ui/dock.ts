// The bar on Home: a dark pill at the foot holding Collect, Atlas, Play and Nu (its park, to play
// with it), each an icon over its name, and in the middle Next, a rose button raised out of the
// pill that opens the next step (design 3, James 2026-10-17). Off Home the header's trail (crumbs.ts) says where you
// are instead, so the bar hides.
// Nu rests in the mark (src/ui/mark.ts), not here.

import { icon, type IconName } from './icons';
import { startNu } from './nu';
import { NU_BAR_ICON } from '../nu/icon';

export type Section = 'home' | 'collect' | 'learn' | 'play' | 'nu';

const SECTIONS: { id: Exclude<Section, 'home'>; button: string; icon: IconName | 'nu'; label: string }[] = [
  { id: 'collect', button: 'nav-collect', icon: 'collect', label: 'Collect' },
  { id: 'learn', button: 'nav-gallery', icon: 'atlas', label: 'Atlas' },
  { id: 'play', button: 'nav-puzzles', icon: 'puzzles', label: 'Play' },
  { id: 'nu', button: 'nav-nu', icon: 'nu', label: 'Nu' },
];

export class Dock {
  constructor(private el: HTMLElement, o: { onSection: (s: Section) => void; onNext: () => void }) {
    for (const s of SECTIONS) {
      const b = document.getElementById(s.button)!;
      b.querySelector('.nav-ico')!.innerHTML = s.icon === 'nu' ? NU_BAR_ICON : icon(s.icon);
      b.querySelector('.nav-lab')!.textContent = s.label;
      b.onclick = () => o.onSection(s.id);
    }
    const next = document.getElementById('nav-next')!;
    next.querySelector('.nav-ico')!.innerHTML = icon('build', { size: 24 });
    next.setAttribute('aria-label', 'Next step');
    next.onclick = () => o.onNext();
    startNu();
  }

  /** Shown on Home only. */
  paint(home: boolean): void {
    this.el.hidden = !home;
  }
}
