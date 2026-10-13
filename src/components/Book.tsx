import { forwardRef, useImperativeHandle, useRef } from 'react';

export interface BookHandle {
  /** closed -> open spread; resolves when finished */
  open(): Promise<void>;
  /** open spread -> closed with a little bounce */
  close(): Promise<void>;
  /** jump to the open state without animating */
  setOpen(): void;
}

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const EASE = 'cubic-bezier(.62,.04,.24,1)';

/** scale so that the open two-page spread fits the viewport width */
function spreadScale(book: HTMLElement | null): number {
  if (!book) return 1;
  return Math.min(1, (window.innerWidth * 0.94) / (book.offsetWidth * 2));
}

/**
 * Run a Web Animation and resolve when it ends. Browsers pause animations in hidden tabs, so a timer
 * guarantees the sequence never gets stuck: if the animation hasn't finished in time it jumps to its end.
 */
function run(el: Element | null, frames: Keyframe[], opts: KeyframeAnimationOptions): Promise<void> {
  if (!el || !('animate' in el)) return Promise.resolve();
  const a = el.animate(frames, { fill: 'forwards', ...opts });
  const budget = (Number(opts.duration) || 0) + (Number(opts.delay) || 0) + 450;
  return Promise.race([
    a.finished.then(() => undefined).catch(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(() => {
      try { a.finish(); } catch { /* already finished */ }
      resolve();
    }, budget)),
  ]);
}

/** A 3D hard-cover photo album built with CSS transforms; animated with the Web Animations API. */
export const Book = forwardRef<BookHandle, { title?: string; pagePhoto?: string }>(function Book({ title = 'Álbum', pagePhoto }, ref) {
  const bookRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const leafRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];

  useImperativeHandle(ref, () => ({
    async open() {
      const r = reduced();
      const s = spreadScale(bookRef.current);
      const jobs: Promise<void>[] = [];
      jobs.push(run(bookRef.current, [{ transform: 'translateX(0) rotateX(8deg) scale(1)' }, { transform: `translateX(50%) rotateX(4deg) scale(${s})` }], { duration: r ? 1 : 1300, easing: EASE }));
      jobs.push(run(coverRef.current, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-172deg)' }], { duration: r ? 1 : 1300, easing: EASE }));
      leafRefs.forEach((lr, i) => {
        jobs.push(run(lr.current, [{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${-166 + i * 3}deg)` }], { duration: r ? 1 : 900, delay: r ? 0 : 560 + i * 160, easing: EASE }));
      });
      await Promise.all(jobs);
    },
    async close() {
      const r = reduced();
      const s = spreadScale(bookRef.current);
      const jobs: Promise<void>[] = [];
      leafRefs.slice().reverse().forEach((lr, i) => {
        jobs.push(run(lr.current, [{ transform: `rotateY(${-160}deg)` }, { transform: 'rotateY(0deg)' }], { duration: r ? 1 : 700, delay: r ? 0 : i * 140, easing: EASE }));
      });
      jobs.push(run(coverRef.current, [
        { transform: 'rotateY(-172deg)', offset: 0 },
        { transform: 'rotateY(-172deg)', offset: 0.35 },
        { transform: 'rotateY(4deg)', offset: 0.88 },
        { transform: 'rotateY(0deg)', offset: 1 },
      ], { duration: r ? 1 : 1500, easing: 'ease-in-out' }));
      jobs.push(run(bookRef.current, [
        { transform: `translateX(50%) rotateX(4deg) scale(${s})`, offset: 0 },
        { transform: `translateX(50%) rotateX(4deg) scale(${s})`, offset: 0.35 },
        { transform: 'translateX(0) rotateX(8deg) scale(1.03)', offset: 0.88 },
        { transform: 'translateX(0) rotateX(8deg) scale(1)', offset: 1 },
      ], { duration: r ? 1 : 1500, easing: 'ease-in-out' }));
      await Promise.all(jobs);
    },
    setOpen() {
      const s = spreadScale(bookRef.current);
      bookRef.current?.animate([{ transform: `translateX(50%) rotateX(4deg) scale(${s})` }], { fill: 'forwards', duration: 0 });
      coverRef.current?.animate([{ transform: 'rotateY(-172deg)' }], { fill: 'forwards', duration: 0 });
      leafRefs.forEach((lr, i) => lr.current?.animate([{ transform: `rotateY(${-160 + i * 3}deg)` }], { fill: 'forwards', duration: 0 }));
    },
  }));

  return (
    <div className="book-scene" aria-hidden="true">
      <div className="book" ref={bookRef}>
        <div className="book-back" />
        <div className="book-block">
          <div className="book-page-right">
            {pagePhoto ? <img src={pagePhoto} alt="" className="book-page-photo" /> : <div className="book-page-lines" />}
          </div>
        </div>
        {leafRefs.map((lr, i) => (
          <div className={`book-leaf leaf-${i + 1}`} ref={lr} key={i}>
            <div className="leaf-face leaf-front" />
            <div className="leaf-face leaf-back" />
          </div>
        ))}
        <div className="book-cover" ref={coverRef}>
          <div className="cover-face cover-front">
            <div className="cover-frame">
              <svg className="cover-ornament" viewBox="0 0 64 64" aria-hidden="true">
                <g fill="none" strokeLinecap="round" strokeWidth="3.2">
                  {Array.from({ length: 8 }, (_, i) => {
                    const a = (i * Math.PI) / 4;
                    const x0 = 32 + Math.cos(a) * 9, y0 = 32 + Math.sin(a) * 9;
                    const x2 = 32 + Math.cos(a + 0.7) * 24, y2 = 32 + Math.sin(a + 0.7) * 24;
                    const xc = 32 + Math.cos(a + 0.05) * 25, yc = 32 + Math.sin(a + 0.05) * 25;
                    return <path key={i} d={`M${x0} ${y0} Q${xc} ${yc} ${x2} ${y2}`} stroke={i % 2 ? '#F2C572' : '#FFF4E3'} />;
                  })}
                  <circle cx="32" cy="32" r="6" stroke="#FFF4E3" />
                </g>
              </svg>
              <span className="cover-title">{title}</span>
              <span className="cover-sub">recuerdos</span>
            </div>
            <div className="cover-stripes" />
          </div>
          <div className="cover-face cover-inside" />
        </div>
        <div className="book-ribbon" />
      </div>
      <div className="book-shadow" />
    </div>
  );
});
