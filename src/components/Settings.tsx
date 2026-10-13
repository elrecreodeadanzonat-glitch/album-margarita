import { useState } from 'react';
import { X, Save, KeyRound, LayoutGrid, History, LogOut, Loader2, Check } from 'lucide-react';
import { LIMITS, MIN_PASSWORD, lockCode, normalizePassword, replaceLock, type AlbumMeta } from '../lib/cloud';
import type { CloudStore } from '../lib/cloudStore';
import { useCloudState } from '../lib/cloudStore';
import { ALBUM_DEFAULTS } from '../config';
import '../styles/dialog.css';

interface Props {
  store: CloudStore;
  /** the lock this device opened the album with */
  lock: string;
  onLockChanged: (lock: string) => void;
  onOrganize: () => void;
  onHistory: () => void;
  onLogout: () => void;
  onClose: () => void;
}

/** «Opciones del álbum»: its name and texts, the password, organizing photos, the order history, signing out. */
export function Settings({ store, lock, onLockChanged, onOrganize, onHistory, onLogout, onClose }: Props) {
  const state = useCloudState(store);
  const meta = state?.meta;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settings-title" data-testid="settings">
      <div className="modal settings">
        <button className="modal-x" onClick={onClose} aria-label="Cerrar opciones"><X /></button>
        <h2 id="settings-title">Opciones del álbum</h2>

        <section className="settings-block">
          <h3>Fotos y videos</h3>
          <div className="settings-row">
            <button className="btn" onClick={onOrganize} data-testid="open-organizer"><LayoutGrid /> Organizar fotos y videos</button>
            <button className="btn" onClick={onHistory} data-testid="open-history"><History /> Historial del orden</button>
          </div>
          <p className="note">Girar, quitar del álbum o devolver una foto. Nada se borra.</p>
        </section>

        <MetaForm key={meta ? 'loaded' : 'waiting'} initial={meta ?? { ...ALBUM_DEFAULTS }} onSave={(m) => store.updateMeta(m)} />

        <PasswordForm albumKey={store.api.albumKey} lock={lock} onChanged={onLockChanged} />

        <section className="settings-block">
          <h3>Este aparato</h3>
          <button className="btn" onClick={onLogout} data-testid="logout"><LogOut /> Cerrar sesión en este aparato</button>
          <p className="note">La próxima vez que lo abran aquí, les va a pedir la contraseña.</p>
        </section>
      </div>
    </div>
  );
}

function MetaForm({ initial, onSave }: { initial: AlbumMeta; onSave: (m: AlbumMeta) => Promise<void> }) {
  const [m, setM] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!m.title.trim()) {
      setError('El álbum necesita un nombre.');
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await onSave(m);
      setSaved(true);
    } catch {
      setError('No se pudo guardar. Revisa tu conexión.');
    } finally {
      setBusy(false);
    }
  };
  const field = (k: keyof AlbumMeta) => ({
    value: m[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setSaved(false); setM({ ...m, [k]: e.target.value }); },
  });
  return (
    <form className="settings-block" onSubmit={save}>
      <h3>Nombre y textos del álbum</h3>
      <label className="settings-field">
        <span>Nombre (sale en la portada)</span>
        <input {...field('title')} maxLength={LIMITS.title} data-testid="meta-title" />
      </label>
      <label className="settings-field">
        <span>Texto de la portada</span>
        <textarea {...field('intro')} maxLength={LIMITS.text} rows={2} data-testid="meta-intro" />
      </label>
      <label className="settings-field">
        <span>Texto del final</span>
        <textarea {...field('outro')} maxLength={LIMITS.text} rows={2} data-testid="meta-outro" />
      </label>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button className="btn primary" disabled={busy} data-testid="meta-save">
        {busy ? <Loader2 className="spin" /> : saved ? <Check /> : <Save />} {saved ? 'Guardado' : 'Guardar'}
      </button>
    </form>
  );
}

function PasswordForm({ albumKey, lock, onChanged }: { albumKey: string; lock: string; onChanged: (lock: string) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (normalizePassword(next).length < MIN_PASSWORD) return setError(`La contraseña nueva es muy corta: usa al menos ${MIN_PASSWORD} letras o números.`);
    if (normalizePassword(next) !== normalizePassword(again)) return setError('Las dos contraseñas nuevas no son iguales.');
    setBusy(true);
    try {
      if ((await lockCode(current)) !== lock) return setError('La contraseña actual no es correcta.');
      const newLock = await lockCode(next);
      if (newLock === lock) return setError('La contraseña nueva es igual a la actual.');
      await replaceLock(albumKey, lock, newLock);
      onChanged(newLock);
      setDone(true);
      setCurrent('');
      setNext('');
      setAgain('');
    } catch {
      setError('No se pudo cambiar. Revisa tu conexión e inténtalo otra vez.');
    } finally {
      setBusy(false);
    }
  };
  const input = (value: string, set: (v: string) => void, testid: string, autoComplete: string) => (
    <input type="password" value={value} onChange={(e) => set(e.target.value)} autoComplete={autoComplete} autoCapitalize="none" spellCheck={false} data-testid={testid} />
  );
  return (
    <form className="settings-block" onSubmit={change}>
      <h3>Contraseña</h3>
      <label className="settings-field"><span>Contraseña actual</span>{input(current, setCurrent, 'pw-current', 'current-password')}</label>
      <label className="settings-field"><span>Contraseña nueva</span>{input(next, setNext, 'pw-new', 'new-password')}</label>
      <label className="settings-field"><span>Repite la contraseña nueva</span>{input(again, setAgain, 'pw-again', 'new-password')}</label>
      <p className="note">Mínimo {MIN_PASSWORD} letras o números. No importan las mayúsculas ni los espacios.</p>
      {error ? <p className="error" role="alert" data-testid="pw-error">{error}</p> : null}
      {done ? (
        <p className="settings-done" role="status" data-testid="pw-done">
          Listo, la contraseña cambió. Avísale a la familia: en los otros aparatos les va a pedir la nueva.
        </p>
      ) : null}
      <button className="btn primary" disabled={busy || !current || !next || !again} data-testid="pw-change">
        {busy ? <Loader2 className="spin" /> : <KeyRound />} Cambiar la contraseña
      </button>
    </form>
  );
}
