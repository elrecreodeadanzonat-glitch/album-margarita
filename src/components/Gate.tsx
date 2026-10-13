import { useState } from 'react';
import { Eye, EyeOff, LockKeyhole, Loader2, Mail } from 'lucide-react';
import { lockCode, normalizePassword, openLock } from '../lib/cloud';
import { HELP_CONTACT } from '../config';
import { Floaters } from './Floaters';

interface Props {
  title: string;
  /** something to tell before asking (e.g. the password changed) */
  notice?: string | null;
  onOpen: (s: { albumKey: string; lock: string }, remember: boolean) => void;
}

/** The album is private: the password opens it. Big, plain and forgiving (capitals and spaces do not matter). */
export function Gate({ title, notice, onOpen }: Props) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!normalizePassword(password)) {
      setError('Escribe la contraseña.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const lock = await lockCode(password);
      const albumKey = await openLock(lock);
      if (!albumKey) {
        setError('Esa no es la contraseña. Revísala e inténtalo de nuevo.');
        return;
      }
      onOpen({ albumKey, lock }, remember);
    } catch {
      setError('No hay conexión a internet. Inténtalo en un momento.');
    } finally {
      setBusy(false);
    }
  };

  const mailto = `mailto:${HELP_CONTACT.email}?subject=${encodeURIComponent(`Olvidé la contraseña del ${title}`)}`;

  return (
    <main className="gate-screen" data-testid="gate">
      <Floaters />
      <form className="gate-card" onSubmit={submit}>
        <div className="gate-lock" aria-hidden="true"><LockKeyhole /></div>
        <h1>{title}</h1>
        <p className="gate-lead">Este álbum es privado. Escribe la contraseña para entrar.</p>
        {notice ? <p className="gate-notice" role="status">{notice}</p> : null}

        <label className="gate-field">
          <span>Contraseña</span>
          <span className="gate-input">
            <input
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              autoFocus
              data-testid="gate-password"
            />
            <button type="button" className="gate-eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}>
              {show ? <EyeOff /> : <Eye />}
            </button>
          </span>
          <small>No importan las mayúsculas ni los espacios.</small>
        </label>

        <label className="gate-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} data-testid="gate-remember" />
          <span>Recordarme en este aparato</span>
        </label>

        {error ? <p className="gate-error" role="alert" data-testid="gate-error">{error}</p> : null}

        <button className="open-btn gate-enter" disabled={busy} data-testid="gate-enter">
          {busy ? <Loader2 className="spin" aria-hidden="true" /> : null}
          <span>{busy ? 'Abriendo…' : 'Entrar'}</span>
        </button>

        <button type="button" className="gate-help-toggle" onClick={() => setHelp((h) => !h)} aria-expanded={help}>
          ¿Olvidaste la contraseña?
        </button>
        {help ? (
          <div className="gate-help" data-testid="gate-help">
            <p>Escríbele a {HELP_CONTACT.name} ({HELP_CONTACT.email}) y él te ayuda a poner una nueva.</p>
            <a className="ghost-btn" href={mailto}><Mail aria-hidden="true" /><span>Escribirle un correo</span></a>
          </div>
        ) : null}
      </form>
    </main>
  );
}
