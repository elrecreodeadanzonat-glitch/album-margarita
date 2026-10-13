import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MessageCircleHeart, SendHorizontal, X, EyeOff, Eye, Loader2 } from 'lucide-react';
import type { Photo } from '../lib/types';
import { assetUrl } from '../lib/gallery';
import { LIMITS } from '../lib/cloud';
import { useCloudState, type CloudStore, type LocalComment } from '../lib/cloudStore';
import { loadName, saveName } from '../lib/prefs';
import { timeAgo } from '../lib/timeAgo';
import '../styles/dialog.css';

interface Props {
  photo: Photo;
  /** position in the book, 1-based */
  number: number;
  store: CloudStore;
  onClose: () => void;
  /** editor only: hide / show a comment (asks for the family code) */
  onModerate?: (c: LocalComment, hidden: boolean) => Promise<void>;
}

const PALETTE = ['#C4553F', '#2F8C86', '#C98A1B', '#8E4A6B', '#4F6FA8', '#6B8E3A'];

function colorFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const initialOf = (name: string) => (name.trim()[0] ?? '♥').toUpperCase();

/** keeps the sheet above the on-screen keyboard (iOS does not resize the layout viewport) */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    return () => {
      vv.removeEventListener('resize', on);
      vv.removeEventListener('scroll', on);
    };
  }, []);
  return inset;
}

export function Comments({ photo, number, store, onClose, onModerate }: Props) {
  const state = useCloudState(store);
  const all = state?.comments ?? [];
  const list = all.filter((c) => c.photoId === photo.id && (onModerate || !c.hidden));
  const [name, setName] = useState(loadName);
  const [editingName, setEditingName] = useState(() => !loadName());
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const kb = useKeyboardInset();

  // newest at the bottom, like a chat: keep it in view
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [list.length]);

  // nothing to read yet: go straight to writing
  const emptyAtOpen = useRef(list.length === 0);
  useEffect(() => {
    if (emptyAtOpen.current) inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const send = (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t) return;
    const who = name.trim();
    saveName(who);
    if (who) setEditingName(false);
    setText('');
    setError(null);
    store.addComment(photo.id, t, who).catch(() => setError('No se pudo publicar. Revisa tu conexión y toca «Reintentar».'));
  };

  const retry = (c: LocalComment) => {
    setError(null);
    store.addComment(c.photoId, c.text, c.author, c.id).catch(() => setError('Sigue sin conexión. Inténtalo en un momento.'));
  };

  const moderate = async (c: LocalComment) => {
    if (!onModerate) return;
    setBusy(c.id);
    setError(null);
    try {
      await onModerate(c, !c.hidden);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const shown = list.filter((c) => !c.hidden).length;

  return (
    <div
      className="sheet-backdrop"
      style={{ ['--kb' as string]: `${kb}px` }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <section className="sheet comments" role="dialog" aria-modal="true" aria-labelledby="comments-title" data-testid="comments">
        <header className="sheet-head">
          <img className="sheet-thumb" src={assetUrl(photo.thumb)} alt="" style={{ transform: `rotate(${photo.rotation}deg)` }} />
          <div>
            <h2 id="comments-title">Comentarios y notas{shown ? ` (${shown})` : ''}</h2>
            <p>{photo.kind === 'video' ? 'Video' : 'Foto'} {number}{photo.addedBy ? ` · ${photo.kind === 'video' ? 'compartido' : 'compartida'} por ${photo.addedBy}` : ''}</p>
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Cerrar comentarios" data-testid="comments-close"><X /></button>
        </header>

        <ol className="comment-list" ref={listRef} aria-live="polite">
          {list.length === 0 ? (
            <li className="comment-empty">
              <MessageCircleHeart aria-hidden="true" />
              <p>{state?.ready === false ? 'Cargando comentarios…' : <>Todavía no hay comentarios ni notas.<br />Escribe un recuerdo, un saludo o una nota.</>}</p>
            </li>
          ) : (
            list.map((c) => (
              <li key={c.id} className={`comment${c.hidden ? ' is-hidden' : ''}${c.status ? ` is-${c.status}` : ''}`} data-testid="comment">
                <span className="avatar" style={{ background: colorFor(c.author || '?') }} aria-hidden="true">{initialOf(c.author)}</span>
                <div className="bubble">
                  <p className="who">
                    <b>{c.author || 'Alguien de la familia'}</b>
                    <time dateTime={c.createdAt}>{c.status === 'sending' ? 'enviando…' : timeAgo(c.createdAt)}</time>
                  </p>
                  <p className="text">{c.text}</p>
                  {c.status === 'failed' ? (
                    <p className="state">No se envió. <button type="button" onClick={() => retry(c)}>Reintentar</button></p>
                  ) : null}
                  {c.hidden ? <p className="state">Oculto: nadie más lo ve.</p> : null}
                  {onModerate && !c.status ? (
                    <button type="button" className="mod" onClick={() => void moderate(c)} disabled={busy === c.id} data-testid="comment-moderate">
                      {busy === c.id ? <Loader2 className="spin" /> : c.hidden ? <Eye /> : <EyeOff />}
                      {c.hidden ? 'Mostrar de nuevo' : 'Ocultar'}
                    </button>
                  ) : null}
                </div>
              </li>
            ))
          )}
        </ol>

        <form className="composer" onSubmit={send}>
          {editingName ? (
            <label className="name-field">
              <span>Tu nombre</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej.: Tía Rosa"
                maxLength={LIMITS.author}
                autoComplete="name"
                enterKeyHint="next"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); inputRef.current?.focus(); } }}
                data-testid="comment-name"
              />
            </label>
          ) : (
            <p className="as">
              Comentas como <b>{name}</b> · <button type="button" onClick={() => setEditingName(true)}>cambiar</button>
            </p>
          )}
          <div className="composer-row">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); }}
              placeholder="Escribe un comentario o una nota…"
              rows={2}
              maxLength={LIMITS.comment}
              aria-label="Tu comentario"
              data-testid="comment-input"
            />
            <button className="send" type="submit" disabled={!text.trim()} data-testid="comment-send">
              <SendHorizontal aria-hidden="true" />
              <span>Publicar</span>
            </button>
          </div>
          {error ? <p className="composer-error" role="alert">{error}</p> : null}
        </form>
      </section>
    </div>
  );
}
