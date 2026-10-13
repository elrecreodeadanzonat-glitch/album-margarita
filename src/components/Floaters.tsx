// Slowly drifting paper shapes behind the book (pure CSS animation, a handful of elements).
const SHAPES = [
  { k: 'dot', c: 'var(--mustard)', x: 8, y: 14, s: 18, d: 0 },
  { k: 'tri', c: 'var(--coral)', x: 84, y: 10, s: 26, d: -3 },
  { k: 'squig', c: 'var(--teal)', x: 12, y: 72, s: 44, d: -6 },
  { k: 'dot', c: 'var(--sky)', x: 90, y: 64, s: 14, d: -2 },
  { k: 'rect', c: 'var(--sage)', x: 74, y: 86, s: 22, d: -8 },
  { k: 'dot', c: 'var(--terracotta)', x: 30, y: 90, s: 12, d: -4 },
  { k: 'tri', c: 'var(--mustard)', x: 60, y: 6, s: 16, d: -9 },
  { k: 'squig', c: 'var(--coral)', x: 86, y: 38, s: 34, d: -5 },
  { k: 'rect', c: 'var(--sky)', x: 6, y: 42, s: 16, d: -7 },
];

export function Floaters() {
  return (
    <div className="floaters" aria-hidden="true">
      {SHAPES.map((s, i) => (
        <svg
          key={i}
          className={`floater f-${s.k}`}
          viewBox="0 0 40 40"
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, animationDelay: `${s.d}s`, color: s.c }}
        >
          {s.k === 'dot' && <circle cx="20" cy="20" r="18" fill="currentColor" />}
          {s.k === 'tri' && <path d="M20 3 L37 35 L3 35 Z" fill="currentColor" />}
          {s.k === 'rect' && <rect x="4" y="10" width="32" height="20" rx="4" fill="currentColor" />}
          {s.k === 'squig' && <path d="M3 22 q8.5 -14 17 0 t17 0" stroke="currentColor" strokeWidth="6" strokeLinecap="round" fill="none" />}
        </svg>
      ))}
    </div>
  );
}
