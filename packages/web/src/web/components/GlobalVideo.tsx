import { useEffect, useRef, type CSSProperties } from 'react';

const VIDEO_MAIN = 'https://storage.googleapis.com/runable-templates/cli-uploads%2Fakml8BZagPXLqtY8WBfg4mvZMy0Co8eL%2Fmrw0XTryKvOlmMP7taZoY%2Fsynaps-bg.mp4';

// Dark: white dunes → warm beige dunes
const DARK_FILTER = 'none';
const DARK_OPACITY = '1';

function applyTheme(v: HTMLVideoElement) {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  v.style.filter = isLight ? 'invert(1)' : DARK_FILTER;
  v.style.opacity = isLight ? '1' : DARK_OPACITY;
}

function createVideo(src: string): HTMLVideoElement {
  const v = document.createElement('video');
  v.src = src;
  v.loop = true;
  v.muted = true;
  v.playsInline = true;
  v.autoplay = true;
  v.preload = 'auto';
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.setAttribute('muted', '');
  // Purely decorative background — must never be selectable, draggable, or
  // clickable (no text-selection highlight, no "save video as" drag-out, no
  // right-click-and-drag selection box around it).
  v.setAttribute('disablePictureInPicture', '');
  v.setAttribute('controlsList', 'nodownload noplaybackrate nofullscreen');
  v.draggable = false;
  Object.assign(v.style, {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    willChange: 'transform',
    transform: 'translateZ(0)',
    backfaceVisibility: 'hidden',
    transition: 'none',
    pointerEvents: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitUserDrag: 'none',
  } as CSSStyleDeclaration);
  return v;
}

let mainVideo: HTMLVideoElement | null = null;
let mainReady = false;

// ── Readiness subscription ──
// Lets React components reveal the page only once the background video is
// actually ready to play, so the site never appears "loaded" before the video.
const readySubscribers = new Set<() => void>();

export function isMainVideoReady(): boolean {
  return mainReady;
}

export function subscribeMainVideoReady(cb: () => void): () => void {
  if (mainReady) {
    // Fire on next tick so callers can rely on unsubscribe being returned first.
    Promise.resolve().then(cb);
    return () => {};
  }
  readySubscribers.add(cb);
  return () => readySubscribers.delete(cb);
}

function markReady(v: HTMLVideoElement) {
  if (mainReady) return;
  mainReady = true;
  applyTheme(v);
  readySubscribers.forEach((cb) => cb());
  readySubscribers.clear();
}

// ── Keep-alive ──
// iOS/Safari pauses background videos when the tab is backgrounded, when the
// device enters Low Power Mode, after a DOM move, or when the element scrolls
// off-screen — and never resumes on its own. This watchdog resumes playback
// whenever the video is unexpectedly paused/stalled so it never stays frozen.
let keepAliveStarted = false;

function tryResume(v: HTMLVideoElement) {
  if (document.hidden) return;
  if (v.paused || v.ended) {
    // ended shouldn't happen (loop=true) but guard anyway
    if (v.ended) { try { v.currentTime = 0; } catch { /* noop */ } }
    v.play().catch(() => {});
  }
}

function startKeepAlive(v: HTMLVideoElement) {
  if (keepAliveStarted) return;
  keepAliveStarted = true;

  const resume = () => tryResume(v);

  // The video itself signalling it stopped or stalled.
  v.addEventListener('pause', resume);
  v.addEventListener('stalled', resume);
  v.addEventListener('waiting', resume);
  v.addEventListener('suspend', resume);
  v.addEventListener('ended', resume);

  // App/tab returns to foreground (very common cause on mobile).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resume();
  });
  window.addEventListener('focus', resume);
  window.addEventListener('pageshow', resume);

  // Any user interaction is a valid gesture to re-kick playback on iOS.
  window.addEventListener('touchstart', resume, { passive: true });
  window.addEventListener('scroll', resume, { passive: true });

  // Periodic safety net for cases with no event at all (Low Power Mode).
  window.setInterval(resume, 1500);
}

function getMainVideo(): HTMLVideoElement {
  if (mainVideo) return mainVideo;

  const v = createVideo(VIDEO_MAIN);
  v.style.opacity = '0';

  v.addEventListener('canplaythrough', () => {
    markReady(v);
  }, { once: true });

  const fallback = () => {
    if (v.currentTime > 0.05) {
      markReady(v);
      v.removeEventListener('timeupdate', fallback);
    }
  };
  v.addEventListener('timeupdate', fallback);

  // Safety net: never block the page reveal forever if the video stalls.
  window.setTimeout(() => markReady(v), 6000);

  const observer = new MutationObserver(() => {
    if (mainReady) applyTheme(v);
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  v.load();
  v.play().catch(() => {});
  startKeepAlive(v);
  mainVideo = v;
  return v;
}

export function GlobalVideoSlot({ visible }: { visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const v = getMainVideo();
    if (v.parentElement !== el) el.appendChild(v);
    if (mainReady) applyTheme(v);
    if (v.paused) v.play().catch(() => {});
  }, [visible]);

  return (
    <div
      ref={ref}
      className="absolute inset-0"
      style={{
        zIndex: 1,
        position: 'relative',
        pointerEvents: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      } as CSSProperties}
    />
  );
}
