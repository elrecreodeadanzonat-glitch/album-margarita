import { useCallback, useEffect, useRef, useState } from 'react';

export interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

interface Options {
  /** size of the content box (the photo frame) so panning can be clamped */
  contentSize: { w: number; h: number };
  onSwipe: (dir: 1 | -1) => void;
  /** tap position as a fraction of the stage width (0..1) */
  onTap: (fx: number) => void;
  onInteract?: () => void;
  enabled: boolean;
  /** when this changes (new photo, new fit mode) the zoom returns to 1 */
  resetKey?: string;
}

const MIN = 1;
const MAX = 5;
const IDENTITY: ZoomState = { scale: 1, x: 0, y: 0 };

function clampState(s: ZoomState, w: number, h: number): ZoomState {
  const scale = Math.min(MAX, Math.max(MIN, s.scale));
  if (scale <= 1.001) return IDENTITY;
  const mx = (w * (scale - 1)) / 2;
  const my = (h * (scale - 1)) / 2;
  return { scale, x: Math.min(mx, Math.max(-mx, s.x)), y: Math.min(my, Math.max(-my, s.y)) };
}

/**
 * Touch + mouse gestures for the photo stage: pinch-zoom, pan when zoomed, double-tap/double-click zoom,
 * wheel zoom, swipe left/right and edge taps when not zoomed. All via Pointer Events (stage uses touch-action:none).
 */
export function useGestures(opts: Options) {
  const [zoom, setZoom] = useState<ZoomState>(IDENTITY);
  const [zoomKey, setZoomKey] = useState(opts.resetKey);
  if (zoomKey !== opts.resetKey) {
    // adjust state while rendering (React-recommended pattern for resetting on a prop change)
    setZoomKey(opts.resetKey);
    setZoom(IDENTITY);
  }
  const [dragX, setDragX] = useState(0);
  const [active, setActive] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const optsRef = useRef(opts);
  const zoomRef = useRef(zoom);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ x: number; y: number; t: number; zx: number; zy: number } | null>(null);
  const pinch = useRef<{ d: number; mx: number; my: number; s: number; x: number; y: number } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const tapTimer = useRef<number | undefined>(undefined);
  const moved = useRef(false);

  useEffect(() => {
    optsRef.current = opts;
  });
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const apply = useCallback((s: ZoomState) => {
    const { w, h } = optsRef.current.contentSize;
    const c = clampState(s, w, h);
    zoomRef.current = c;
    setZoom(c);
  }, []);

  const centre = () => {
    const r = stageRef.current?.getBoundingClientRect();
    return r ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, left: r.left } : { cx: 0, cy: 0, w: 1, left: 0 };
  };

  /** zoom to `scale` keeping the screen point (px, py) fixed */
  const zoomAt = useCallback(
    (scale: number, px?: number, py?: number) => {
      const z = zoomRef.current;
      const { cx, cy } = centre();
      const mx = (px ?? cx) - cx;
      const my = (py ?? cy) - cy;
      const k = Math.min(MAX, Math.max(MIN, scale)) / z.scale;
      apply({ scale: z.scale * k, x: mx - (mx - z.x) * k, y: my - (my - z.y) * k });
    },
    [apply],
  );

  const zoomIn = useCallback(() => zoomAt(zoomRef.current.scale * 1.5), [zoomAt]);
  const zoomOut = useCallback(() => zoomAt(zoomRef.current.scale / 1.5), [zoomAt]);
  const reset = useCallback(() => apply(IDENTITY), [apply]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!optsRef.current.enabled) return;
      e.preventDefault();
      optsRef.current.onInteract?.();
      zoomAt(zoomRef.current.scale * Math.exp(-e.deltaY * 0.0018), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!optsRef.current.enabled) return;
    if ((e.target as HTMLElement).closest('button, input, a, [data-no-gesture]')) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setActive(true);
    const z = zoomRef.current;
    if (pointers.current.size === 1) {
      start.current = { x: e.clientX, y: e.clientY, t: performance.now(), zx: z.x, zy: z.y };
      moved.current = false;
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const { cx, cy } = centre();
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - cx, my: (a.y + b.y) / 2 - cy, s: z.scale, x: z.x, y: z.y };
      setDragX(0);
      moved.current = true;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const { cx, cy } = centre();
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2 - cx;
      const my = (a.y + b.y) / 2 - cy;
      const p = pinch.current;
      const s = Math.min(MAX, Math.max(MIN * 0.8, (p.s * d) / p.d));
      const k = s / p.s;
      apply({ scale: s, x: mx - (p.mx - p.x) * k, y: my - (p.my - p.y) * k });
      optsRef.current.onInteract?.();
      return;
    }
    const st = start.current;
    if (!st) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (Math.hypot(dx, dy) > 8) moved.current = true;
    if (zoomRef.current.scale > 1.001) {
      apply({ scale: zoomRef.current.scale, x: st.zx + dx, y: st.zy + dy });
      optsRef.current.onInteract?.();
    } else if (Math.abs(dx) > Math.abs(dy)) {
      setDragX(dx);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 1) {
      // one finger left after a pinch: continue as a pan from here
      const [p] = [...pointers.current.values()];
      const z = zoomRef.current;
      start.current = { x: p.x, y: p.y, t: performance.now(), zx: z.x, zy: z.y };
      pinch.current = null;
      return;
    }
    if (pointers.current.size > 0) return;
    setActive(false);
    pinch.current = null;
    const st = start.current;
    start.current = null;
    setDragX(0);
    if (!st) return;
    if (zoomRef.current.scale < 1.05) apply(IDENTITY);
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    const dt = performance.now() - st.t;
    const zoomed = zoomRef.current.scale > 1.001;
    if (!zoomed && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      optsRef.current.onSwipe(dx < 0 ? 1 : -1);
      return;
    }
    if (moved.current || dt > 450) return;
    // tap / double-tap
    const now = performance.now();
    const lt = lastTap.current;
    if (lt && now - lt.t < 300 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 40) {
      window.clearTimeout(tapTimer.current);
      lastTap.current = null;
      optsRef.current.onInteract?.();
      if (zoomed) apply(IDENTITY);
      else zoomAt(2.5, e.clientX, e.clientY);
      return;
    }
    lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    const { w, left } = centre();
    const fx = (e.clientX - left) / w;
    tapTimer.current = window.setTimeout(() => {
      lastTap.current = null;
      if (zoomRef.current.scale <= 1.001) optsRef.current.onTap(fx);
    }, 260);
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      setActive(false);
      start.current = null;
      pinch.current = null;
      setDragX(0);
    }
  };

  useEffect(() => () => window.clearTimeout(tapTimer.current), []);

  return {
    stageRef,
    zoom,
    dragX,
    zoomIn,
    zoomOut,
    reset,
    isZoomed: zoom.scale > 1.001,
    active,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}
