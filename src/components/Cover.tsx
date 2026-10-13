import { useRef, useState } from 'react';
import { BookOpen, ImagePlus, Settings2 } from 'lucide-react';
import { Book, type BookHandle } from './Book';
import { Floaters } from './Floaters';

interface Props {
  title: string;
  intro: string;
  /** starts the music; called synchronously inside the click so browsers allow audio */
  onStart: () => void;
  /** called once the book has opened and the camera has flown into the page */
  onOpened: () => void;
  ready: boolean;
  /** the album has nothing yet: invite to add the first photos instead of opening it */
  empty: boolean;
  error: string | null;
  /** first photo, shown on the right-hand page as the book opens */
  firstPhoto?: string;
  onAddFiles: (files: File[]) => void;
  onSettings: () => void;
}

export function Cover({ title, intro, onStart, onOpened, ready, empty, error, firstPhoto, onAddFiles, onSettings }: Props) {
  const book = useRef<BookHandle>(null);
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'opening' | 'entering'>('idle');

  const open = async () => {
    if (state !== 'idle' || !ready || empty) return;
    onStart();
    setState('opening');
    await book.current?.open();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    await new Promise((r) => window.setTimeout(r, reduced ? 0 : 380));
    setState('entering');
    window.setTimeout(onOpened, reduced ? 50 : 700);
  };

  return (
    <main className={`cover-screen state-${state}`} data-testid="cover">
      <Floaters />
      <button className="cover-settings" onClick={onSettings} aria-label="Opciones del álbum" data-testid="cover-settings">
        <Settings2 aria-hidden="true" /><span>Opciones</span>
      </button>
      <div className="cover-stage">
        <Book ref={book} title={title} pagePhoto={firstPhoto} />
      </div>
      <div className="cover-copy">
        <h1 className="sr-only">{title}</h1>
        <p className="cover-text" data-testid="cover-text">{ready && empty ? 'Tu álbum está listo. Agrega las primeras fotos o videos.' : intro}</p>
        {ready && empty ? (
          <button className="open-btn" onClick={() => input.current?.click()} data-testid="cover-add">
            <ImagePlus aria-hidden="true" />
            <span>Agregar fotos o videos</span>
          </button>
        ) : (
          <>
            <button className="open-btn" onClick={open} disabled={state !== 'idle' || !ready} data-testid="open-book">
              <BookOpen aria-hidden="true" />
              <span>{ready ? 'Abrir el álbum' : 'Preparando…'}</span>
            </button>
            {ready ? (
              <button className="ghost-btn cover-add" onClick={() => input.current?.click()} disabled={state !== 'idle'} data-testid="cover-add">
                <ImagePlus aria-hidden="true" />
                <span>Agregar fotos o videos</span>
              </button>
            ) : null}
          </>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          data-testid="cover-add-input"
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (list.length) onAddFiles(list);
          }}
        />
        {error ? <p className="cover-error" role="alert">{error}</p> : null}
      </div>
    </main>
  );
}
