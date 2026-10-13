import { useState } from 'react';
import { X } from 'lucide-react';
import type { CloudPhoto } from '../lib/cloud';
import { commentsByPhoto, useCloudState, type CloudStore } from '../lib/cloudStore';
import { PhotoCard } from './PhotoCard';
import '../styles/dialog.css';

interface Props {
  store: CloudStore;
  /** the album's pages in the order everyone sees them (to number the cards) */
  bookIds: string[];
  onComments: (p: CloudPhoto) => void;
  onClose: () => void;
}

/** «Organizar fotos y videos»: what is in the album and what was taken out (and can come back). */
export function Organizer({ store, bookIds, onComments, onClose }: Props) {
  const state = useCloudState(store);
  const [tab, setTab] = useState<'in' | 'out'>('in');
  const [confirm, setConfirm] = useState<CloudPhoto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const photos = state?.photos ?? [];
  const counts = commentsByPhoto(state?.comments ?? []);
  const shown = photos.filter((p) => !p.hidden).sort((a, b) => bookIds.indexOf(a.id) - bookIds.indexOf(b.id));
  const out = photos.filter((p) => p.hidden);
  const list = tab === 'in' ? shown : out;

  const hide = async (p: CloudPhoto) => {
    setConfirm(null);
    setError(null);
    try {
      await store.updatePhoto(p.id, { hidden: true });
    } catch {
      setError('No se pudo quitar. Revisa tu conexión.');
    }
  };

  return (
    <div className="modal-backdrop organizer-backdrop" role="dialog" aria-modal="true" aria-labelledby="organizer-title" data-testid="organizer">
      <div className="modal organizer">
        <button className="modal-x" onClick={onClose} aria-label="Cerrar"><X /></button>
        <h2 id="organizer-title">Organizar fotos y videos</h2>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'in'} onClick={() => setTab('in')} data-testid="tab-in">En el álbum ({shown.length})</button>
          <button role="tab" aria-selected={tab === 'out'} onClick={() => setTab('out')} data-testid="tab-out">Quitadas ({out.length})</button>
        </div>
        <p className="note">
          {tab === 'in'
            ? 'Para cambiar el orden, arrastra las miniaturas dentro del álbum. Aquí puedes girar o quitar.'
            : 'Lo que se quita no se borra: aquí está, y puedes devolverlo al álbum cuando quieras.'}
        </p>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <ol className="grid">
          {list.length === 0 ? <li className="empty">{tab === 'in' ? 'Todavía no hay fotos ni videos.' : 'No hay nada quitado.'}</li> : null}
          {list.map((p) => (
            <PhotoCard
              key={p.id}
              photo={p}
              page={p.hidden ? null : bookIds.indexOf(p.id) + 1 || null}
              comments={counts.get(p.id)?.length ?? 0}
              onComments={onComments}
              onChange={(ph, change) => store.updatePhoto(ph.id, change)}
              onAskHide={setConfirm}
            />
          ))}
        </ol>
      </div>
      {confirm ? (
        <div className="modal-backdrop" role="alertdialog" aria-modal="true">
          <div className="modal small">
            <p>¿Quitar {confirm.kind === 'video' ? 'este video' : 'esta foto'} del álbum? Nadie {confirm.kind === 'video' ? 'lo' : 'la'} verá, pero no se borra: podrás devolver{confirm.kind === 'video' ? 'lo' : 'la'} desde «Quitadas».</p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setConfirm(null)} autoFocus>Cancelar</button>
              <button className="btn danger" onClick={() => void hide(confirm)} data-testid="confirm-yes">Sí, quitar</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
