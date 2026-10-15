// The bar on Home: a pill at the foot holding Collect, Atlas and Play, each an icon over its
// name. Off Home the header's trail (crumbs.ts) says where you are instead, so the bar hides.
// Nu rests in the mark (src/ui/mark.ts), not here.

import { icon, type IconName } from './icons';
import { startNu } from './nu';

export type Section = 'home' | 'collect' | 'learn' | 'play';

const SECTIONS: { id: Exclude<Section, 'home'>; button: string; icon: IconName; label: string }[] = [
  { id: 'collect', button: 'nav-collect', icon: 'collect', label: 'Collect' },
  { id: 'learn', button: 'nav-gallery', icon: 'atlas', label: 'Atlas' },
  { id: 'play', button: 'nav-puzzles', icon: 'puzzles', label: 'Play' },
];

export class Dock {
  constructor(private el: HTMLElement, o: { onSection: (s: Section) => void }) {
    for (const s of SECTIONS) {
      const b = document.getElementById(s.button)!;
      b.querySelector('.nav-ico')!.innerHTML = icon(s.icon);
      b.querySelector('.nav-lab')!.textContent = s.label;
      b.onclick = () => o.onSection(s.id);
    }
    startNu();
  }

  /** Shown on Home only. */
  paint(home: boolean): void {
    this.el.hidden = !home;
  }
}
