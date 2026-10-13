// Small per-device conveniences (volume, mute). Storage can be unavailable (private mode) — never throw.
const KEY = 'album-margarita:prefs';

export interface Prefs {
  volume: number;
  muted: boolean;
}

const DEFAULTS: Prefs = { volume: 0.4, muted: false };

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      volume: typeof p.volume === 'number' && p.volume >= 0 && p.volume <= 1 ? p.volume : DEFAULTS.volume,
      muted: typeof p.muted === 'boolean' ? p.muted : DEFAULTS.muted,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

// The name people sign comments and photos with, remembered on this device only.
const NAME_KEY = 'album-margarita:nombre';

export function loadName(): string {
  try {
    return (localStorage.getItem(NAME_KEY) ?? '').slice(0, 60);
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    if (name.trim()) localStorage.setItem(NAME_KEY, name.trim().slice(0, 60));
    else localStorage.removeItem(NAME_KEY);
  } catch {
    /* ignore */
  }
}

// The open album on this device: its key and the lock it was opened with (to notice a password change).
// «Recordarme» keeps it in localStorage; otherwise only for this tab (sessionStorage).
const SESSION_KEY = 'album-margarita:sesion';

export interface Session {
  albumKey: string;
  lock: string;
  /** last known name of the album, to greet people before it loads */
  title?: string;
}

function readSession(store: Storage): Session | null {
  const raw = store.getItem(SESSION_KEY);
  if (!raw) return null;
  const s = JSON.parse(raw) as Partial<Session>;
  if (typeof s.albumKey !== 'string' || !/^a[a-z0-9]{20,40}$/.test(s.albumKey)) return null;
  if (typeof s.lock !== 'string' || !/^[0-9a-f]{64}$/.test(s.lock)) return null;
  return { albumKey: s.albumKey, lock: s.lock, title: typeof s.title === 'string' ? s.title.slice(0, 80) : undefined };
}

export function loadSession(): Session | null {
  try {
    return readSession(localStorage) ?? readSession(sessionStorage);
  } catch {
    return null;
  }
}

export function saveSession(s: Session, remember: boolean): void {
  try {
    (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(s));
    (remember ? sessionStorage : localStorage).removeItem(SESSION_KEY);
  } catch {
    /* private mode: it lasts while the page is open */
  }
}

/** keep the session where it is, with new details (new lock after a password change, album name) */
export function updateSession(patch: Partial<Session>): void {
  try {
    for (const store of [localStorage, sessionStorage]) {
      const cur = readSession(store);
      if (cur) store.setItem(SESSION_KEY, JSON.stringify({ ...cur, ...patch }));
    }
  } catch {
    /* ignore */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** the album name seen last on this device, even after closing the session (for the welcome screen) */
const TITLE_KEY = 'album-margarita:titulo';

export function loadLastTitle(): string {
  try {
    return (localStorage.getItem(TITLE_KEY) ?? '').slice(0, 80);
  } catch {
    return '';
  }
}

export function saveLastTitle(title: string): void {
  try {
    if (title.trim()) localStorage.setItem(TITLE_KEY, title.trim().slice(0, 80));
  } catch {
    /* ignore */
  }
}
