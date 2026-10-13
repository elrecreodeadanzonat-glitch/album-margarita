import { useEffect, useRef, useState } from 'react';

/**
 * Accumulates time only while `running` is true (paused, zoomed, tray open, image loading or a hidden tab
 * all stop the clock) and calls `onDone` once `durationMs` has elapsed. Changing `resetKey` restarts it.
 * Returns progress 0..1 (updated ~12x per second, enough for a smooth ring without re-rendering every frame).
 */
export function useAutoplay(running: boolean, durationMs: number, resetKey: unknown, onDone: () => void): number {
  const [state, setState] = useState<{ key: unknown; p: number }>({ key: resetKey, p: 0 });
  const elapsed = useRef(0);
  const done = useRef(onDone);
  const fired = useRef(false);
  const lastKey = useRef<unknown>(resetKey);

  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (lastKey.current !== resetKey) {
      lastKey.current = resetKey;
      elapsed.current = 0;
      fired.current = false;
    }
    if (!running) return;
    const setProgress = (p: number) => setState({ key: resetKey, p });
    let last = performance.now();
    let lastUi = 0;
    let raf = 0;
    const tick = (now: number) => {
      if (document.visibilityState === 'visible') {
        elapsed.current += Math.min(now - last, 250);
      }
      last = now;
      if (now - lastUi > 80) {
        lastUi = now;
        setProgress(Math.min(1, elapsed.current / durationMs));
      }
      if (elapsed.current >= durationMs && !fired.current) {
        fired.current = true;
        setProgress(1);
        done.current();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, durationMs, resetKey]);

  return state.key === resetKey ? state.p : 0;
}
