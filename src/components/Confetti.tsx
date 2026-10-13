import { useEffect, useRef } from 'react';

const COLORS = ['#D9553F', '#EFA43C', '#E98E80', '#2F8C86', '#9DB58E', '#7FB6D1', '#F6D38A'];

interface Piece { x: number; y: number; vx: number; vy: number; r: number; vr: number; s: number; c: string; k: number; f: number; p: number }

/** Lightweight paper-confetti burst on a canvas (~4 s). Skipped when the user prefers reduced motion. */
export function Confetti({ burstKey, count = 90 }: { burstKey: number; count?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!burstKey) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const pieces: Piece[] = Array.from({ length: count }, (_, i) => {
      const side = i % 2 ? 1 : -1;
      const a = -Math.PI / 2 + side * (0.25 + Math.random() * 0.55);
      const sp = 9 + Math.random() * 9;
      return {
        x: W / 2 + side * W * 0.18, y: H * 0.62,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.3,
        s: 7 + Math.random() * 9, c: COLORS[i % COLORS.length], k: i % 3, f: 0.6 + Math.random() * 1.2, p: Math.random() * 6,
      };
    });
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      for (const q of pieces) {
        q.vx *= 0.985; q.vy = q.vy * 0.985 + 0.28;
        q.x += q.vx + Math.sin(t * 3 * q.f + q.p) * 0.8; q.y += q.vy; q.r += q.vr;
        const flip = Math.abs(Math.cos(t * 4 * q.f + q.p));
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(q.r);
        ctx.scale(1, Math.max(0.2, flip));
        ctx.globalAlpha = Math.max(0, Math.min(1, 4.2 - t));
        ctx.fillStyle = q.c;
        ctx.strokeStyle = q.c;
        if (q.k === 0) ctx.fillRect(-q.s / 2, -q.s / 3, q.s, q.s / 1.6);
        else if (q.k === 1) { ctx.beginPath(); ctx.arc(0, 0, q.s / 2.6, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.lineWidth = q.s / 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-q.s / 2, 0); ctx.quadraticCurveTo(0, -q.s / 2, q.s / 2, 0); ctx.stroke(); }
        ctx.restore();
      }
      if (t < 4.4) raf = requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [burstKey, count]);

  return <canvas ref={ref} className="confetti" aria-hidden="true" />;
}
