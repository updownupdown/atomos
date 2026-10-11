// Full screen for one element (the View's 3D atom): the Fullscreen API where there is one, and
// where there isn't (iPhone Safari), the element pinned over the whole window instead. Either
// way the element carries `is-full` while it is full screen, so its CSS can drop the chrome.

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export interface FullScreen {
  readonly on: boolean;
  toggle(): void;
  exit(): void;
}

export function fullScreen(el: HTMLElement, onChange: (on: boolean) => void): FullScreen {
  const doc = document as FsDoc;
  const api = () => doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
  let pinned = false;
  const paint = () => {
    const on = pinned || api() === el;
    el.classList.toggle('is-full', on);
    onChange(on);
  };
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(ev, paint);
  const enter = async () => {
    const f = el as FsEl;
    try {
      if (document.fullscreenEnabled && f.requestFullscreen) { await f.requestFullscreen({ navigationUI: 'hide' }); return; }
      if (f.webkitRequestFullscreen) { await f.webkitRequestFullscreen(); return; }
    } catch { /* refused: pin it instead */ }
    pinned = true;
    paint();
  };
  const exit = () => {
    if (pinned) { pinned = false; paint(); return; }
    if (api() === el) void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
  };
  return {
    get on() { return pinned || api() === el; },
    toggle: () => { if (pinned || api() === el) exit(); else void enter(); },
    exit,
  };
}
