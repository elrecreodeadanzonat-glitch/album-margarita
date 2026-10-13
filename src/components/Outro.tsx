import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Play } from 'lucide-react';
import { Book, type BookHandle } from './Book';
import { Confetti } from './Confetti';
import { Floaters } from './Floaters';
import { MUSIC_CREDIT } from '../config';

interface Props {
  title: string;
  text: string;
  lastThumb?: string;
  onRestart: () => void;
  onReplay: () => void;
  onSwell?: (level: number) => void;
}

export function Outro({ title, text, lastThumb, onRestart, onReplay, onSwell }: Props) {
  const book = useRef<BookHandle>(null);
  const [stage, setStage] = useState<'closing' | 'done'>('closing');
  const [burst, setBurst] = useState(0);
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    book.current?.setOpen();
    onSwell?.(1.35);
    const t = window.setTimeout(async () => {
      await book.current?.close();
      if (!alive) return;
      setStage('done');
      setBurst((b) => b + 1);
    }, 450);
    return () => {
      alive = false;
      window.clearTimeout(t);
      onSwell?.(1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (stage === 'done') primary.current?.focus({ preventScroll: true });
  }, [stage]);

  return (
    <main className={`outro-screen stage-${stage}`} data-testid="outro">
      <Floaters />
      <div className="outro-stage">
        <Book ref={book} title={title} pagePhoto={lastThumb} />
        <div className="sparkles" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} style={{ ['--i' as string]: i, left: `${6 + ((i * 41) % 88)}%`, top: `${8 + ((i * 37) % 80)}%` }} />
          ))}
        </div>
      </div>
      <Confetti burstKey={burst} />
      <div className="outro-copy">
        <p className="outro-text" data-testid="outro-text">{text}</p>
        <div className="outro-actions">
          <button className="open-btn" onClick={onReplay} ref={primary} data-testid="replay">
            <Play aria-hidden="true" /><span>Ver de nuevo</span>
          </button>
          <button className="ghost-btn" onClick={onRestart} data-testid="restart">
            <RotateCcw aria-hidden="true" /><span>Volver al comienzo</span>
          </button>
        </div>
      </div>
      <p className="credit">{MUSIC_CREDIT}</p>
    </main>
  );
}
