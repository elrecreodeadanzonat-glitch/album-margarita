import { useEffect, useState } from 'react';
import { openLock } from './lib/cloud';
import { clearSession, loadLastTitle, loadSession, saveSession, updateSession, type Session } from './lib/prefs';
import { ALBUM_DEFAULTS } from './config';
import { Gate } from './components/Gate';
import App from './App';

/** The album is private: the password screen first, the album once it opens (remembered on this device if wanted). */
export default function Root() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [notice, setNotice] = useState<string | null>(null);

  // the password may have been changed on another device: this device's lock must still open the album
  useEffect(() => {
    if (!session) return;
    let alive = true;
    openLock(session.lock)
      .then((key) => {
        if (!alive || key === session.albumKey) return;
        clearSession();
        setSession(null);
        setNotice('La contraseña del álbum cambió. Escribe la nueva para entrar.');
      })
      .catch(() => undefined); // no connection: carry on, the album will say so
    return () => {
      alive = false;
    };
  }, [session]);

  if (!session) {
    return (
      <Gate
        title={loadLastTitle() || ALBUM_DEFAULTS.title}
        notice={notice}
        onOpen={(s, remember) => {
          saveSession(s, remember);
          setNotice(null);
          setSession(s);
        }}
      />
    );
  }

  return (
    <App
      key={session.albumKey}
      session={session}
      onLogout={() => {
        clearSession();
        setNotice(null);
        setSession(null);
      }}
      onLockChanged={(lock) => {
        updateSession({ lock });
        setSession({ ...session, lock });
      }}
    />
  );
}
