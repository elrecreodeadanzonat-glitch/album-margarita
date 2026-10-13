import { useState } from 'react';
import { MessageCircle, RotateCw, EyeOff, Eye, Loader2, Film } from 'lucide-react';
import type { CloudPhoto, PhotoChange } from '../lib/cloud';
import { rotateBy90 } from '../lib/gallery';
import { timeAgo } from '../lib/timeAgo';
import { clock } from '../lib/video';

interface Props {
  photo: CloudPhoto;
  /** page number in the album, or null when it was taken out */
  page: number | null;
  comments: number;
  onComments: (p: CloudPhoto) => void;
  /** resolves when done; throws with a message to show */
  onChange: (p: CloudPhoto, change: PhotoChange) => Promise<void>;
  onAskHide: (p: CloudPhoto) => void;
}

/** One photo or video in «Organizar»: rotate it, take it out of the album or bring it back. Nothing is deleted. */
export function PhotoCard({ photo, page, comments, onComments, onChange, onAskHide }: Props) {
  const [busy, setBusy] = useState<'rotate' | 'show' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isVideo = photo.kind === 'video';

  const run = async (kind: 'rotate' | 'show', change: PhotoChange) => {
    setBusy(kind);
    setError(null);
    try {
      await onChange(photo, change);
    } catch {
      setError('No se pudo guardar. Revisa tu conexión.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className={`card${photo.hidden ? ' is-hidden' : ''}`} data-testid="photo-card" data-photo-id={photo.id}>
      <div className="card-top">
        <span className="num">{page ? `${page}` : 'Quitada'}</span>
        {isVideo ? <span className="badge video"><Film aria-hidden="true" /> {clock(photo.video?.duration ?? 0)}</span> : null}
        <button className={`card-comments${comments ? ' has' : ''}`} onClick={() => onComments(photo)} aria-label={`Comentarios (${comments})`} data-testid="card-comments">
          <MessageCircle aria-hidden="true" /> {comments}
        </button>
      </div>
      <div className="card-img">
        <img src={photo.thumb} alt="" loading="lazy" style={{ transform: `rotate(${photo.rotation}deg)`, objectFit: 'contain' }} />
      </div>
      <p className="card-meta">
        {isVideo ? 'Compartido' : 'Compartida'} por <b>{photo.author || 'alguien de la familia'}</b> · {timeAgo(photo.createdAt)}
      </p>
      {error ? <p className="card-error" role="alert">{error}</p> : null}
      <div className="card-actions">
        <button onClick={() => void run('rotate', { rotation: rotateBy90(photo.rotation) })} disabled={!!busy} aria-label="Girar 90 grados" title="Girar">
          {busy === 'rotate' ? <Loader2 className="spin" /> : <RotateCw />}
        </button>
        {photo.hidden ? (
          <button className="restore" onClick={() => void run('show', { hidden: false })} disabled={!!busy} data-testid="card-show">
            {busy === 'show' ? <Loader2 className="spin" /> : <Eye />} Devolver al álbum
          </button>
        ) : (
          <button className="danger wide" onClick={() => onAskHide(photo)} disabled={!!busy} data-testid="card-hide">
            <EyeOff /> Quitar del álbum
          </button>
        )}
      </div>
    </li>
  );
}
