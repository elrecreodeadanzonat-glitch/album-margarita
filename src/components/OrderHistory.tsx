import { useEffect, useState } from 'react';
import { History, Loader2, RotateCcw, X } from 'lucide-react';
import type { CloudOrder } from '../lib/cloud';
import { timeAgo } from '../lib/timeAgo';

interface Props {
  /** the latest arrangements, newest first */
  load: (limit: number) => Promise<CloudOrder[]>;
  /** thumbnail for a page id, if it still exists */
  thumbFor: (id: string) => string | undefined;
  onRestore: (o: CloudOrder) => Promise<void>;
  onClose: () => void;
}

/**
 * Every time someone rearranges the book a new arrangement is saved (nothing is overwritten).
 * If the book got mixed up, bring back an earlier one.
 */
export function OrderHistory({ load, thumbFor, onRestore, onClose }: Props) {
  const [orders, setOrders] = useState<CloudOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    load(15)
      .then((o) => { if (alive) setOrders(o); })
      .catch(() => { if (alive) setError('No hay conexión. Inténtalo en un momento.'); });
    return () => { alive = false; };
  }, [reload, load]);

  const restore = async (o: CloudOrder) => {
    setBusy(o.id);
    setError(null);
    try {
      await onRestore(o);
      setDone(o.id);
      setReload((r) => r + 1); // the restored version is now the newest one
    } catch {
      setError('No se pudo restaurar. Revisa tu conexión.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="history-title" data-testid="order-history">
      <div className="modal">
        <button className="modal-x" onClick={onClose} aria-label="Cerrar"><X /></button>
        <h2 id="history-title"><History aria-hidden="true" /> Historial del orden</h2>
        <p>Cada vez que alguien cambia el orden arrastrando una miniatura, se guarda una versión nueva. Si el álbum quedó desordenado, restaura una anterior.</p>
        {error ? <p className="error" role="alert">{error}</p> : null}
        {done ? <p className="history-done" role="status" data-testid="history-done">Listo: el álbum volvió a ese orden. Ahora es el que ve todo el mundo.</p> : null}
        {!orders && !error ? <p><Loader2 className="spin" /> Cargando…</p> : null}
        {orders && orders.length === 0 ? <p>Nadie ha cambiado el orden todavía: las fotos están en el orden en que se agregaron.</p> : null}
        <ol className="history-list">
          {orders?.map((o, i) => (
            <li key={o.id} className={i === 0 ? 'is-current' : undefined} data-testid="history-item">
              <div className="history-meta">
                <b>{timeAgo(o.createdAt)}</b>
                <span>{o.author ? `por ${o.author}` : 'por alguien de la familia'}</span>
                {i === 0 ? <span className="history-now">el que se ve ahora</span> : null}
              </div>
              <div className="history-thumbs" aria-hidden="true">
                {o.ids.slice(0, 8).map((id) => {
                  const t = thumbFor(id);
                  return t ? <img key={id} src={t} alt="" /> : null;
                })}
              </div>
              {i > 0 ? (
                <button className="btn" onClick={() => void restore(o)} disabled={!!busy} data-testid="history-restore">
                  {busy === o.id ? <Loader2 className="spin" /> : <RotateCcw />} Restaurar este orden
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
