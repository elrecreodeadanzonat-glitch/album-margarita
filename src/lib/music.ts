import { assetUrl } from './gallery';

export interface Track {
  src: string;
  title: string;
  artist: string;
}

export interface MusicState {
  started: boolean;
  playing: boolean;
  muted: boolean;
  volume: number;
  trackTitle: string;
  error: string | null;
}

type Listener = (s: MusicState) => void;

const CROSSFADE = 3; // seconds between tracks
const FADE_IN = 2.5;

/**
 * Playlist player. Uses Web Audio gain nodes (so volume and fades also work on iOS, where
 * HTMLMediaElement.volume is read-only), crossfades between tracks and loops the playlist.
 * Must be started from a user gesture ("Abrir el libro").
 */
export class MusicPlayer {
  private tracks: Track[];
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private els: HTMLAudioElement[] = [];
  private gains: GainNode[] = [];
  private current = -1;
  private listeners = new Set<Listener>();
  private state: MusicState;
  private swellLevel = 1;
  private fading = false;

  constructor(tracks: Track[], volume: number, muted: boolean) {
    this.tracks = tracks;
    this.state = { started: false, playing: false, muted, volume, trackTitle: '', error: null };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  getState(): MusicState {
    return this.state;
  }

  private emit(patch: Partial<MusicState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  private target(): number {
    return this.state.muted ? 0 : this.state.volume * this.swellLevel;
  }

  private ensureGraph() {
    if (this.els.length) return;
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AC) {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
    }
    this.tracks.forEach((t, i) => {
      const el = new Audio();
      el.src = assetUrl(t.src);
      el.preload = i === 0 ? 'auto' : 'none';
      el.loop = this.tracks.length === 1;
      el.addEventListener('timeupdate', () => this.onTime(i));
      el.addEventListener('ended', () => {
        if (i === this.current && this.tracks.length > 1) this.playIndex((i + 1) % this.tracks.length, 0.3);
      });
      el.addEventListener('error', () => this.emit({ error: 'No se pudo cargar la música' }));
      this.els.push(el);
      if (this.ctx && this.master) {
        const src = this.ctx.createMediaElementSource(el);
        const g = this.ctx.createGain();
        g.gain.value = 0;
        src.connect(g).connect(this.master);
        this.gains.push(g);
      }
    });
  }

  /** Call from a click/touch handler. Resolves once playback has been requested. */
  async start(): Promise<void> {
    if (!this.tracks.length) return;
    this.ensureGraph();
    try {
      await this.ctx?.resume();
    } catch {
      /* ignore */
    }
    this.emit({ started: true });
    if (this.current < 0) await this.playIndex(0, 0.05);
    this.applyMaster(FADE_IN);
  }

  private async playIndex(i: number, fadeIn: number) {
    const prev = this.current;
    this.current = i;
    const el = this.els[i];
    el.currentTime = 0;
    el.preload = 'auto';
    const next = this.els[(i + 1) % this.els.length];
    if (next && next !== el) next.preload = 'auto';
    if (this.ctx) {
      const now = this.ctx.currentTime;
      const g = this.gains[i].gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(0, now);
      g.linearRampToValueAtTime(1, now + fadeIn);
      if (prev >= 0 && prev !== i) {
        const pg = this.gains[prev].gain;
        pg.cancelScheduledValues(now);
        pg.setValueAtTime(pg.value, now);
        pg.linearRampToValueAtTime(0, now + fadeIn);
        const old = this.els[prev];
        window.setTimeout(() => old.pause(), (fadeIn + 0.2) * 1000);
      }
    } else {
      if (prev >= 0 && prev !== i) this.els[prev].pause();
    }
    this.emit({ trackTitle: `${this.tracks[i].title} — ${this.tracks[i].artist}` });
    try {
      await el.play();
      this.emit({ playing: true, error: null });
    } catch {
      this.emit({ playing: false });
    }
  }

  private onTime(i: number) {
    if (i !== this.current || this.tracks.length < 2 || this.fading) return;
    const el = this.els[i];
    if (el.duration && el.duration - el.currentTime < CROSSFADE) {
      this.fading = true;
      this.playIndex((i + 1) % this.tracks.length, CROSSFADE).finally(() => {
        this.fading = false;
      });
    }
  }

  private applyMaster(seconds = 0.6) {
    const v = this.target();
    if (this.ctx && this.master) {
      const now = this.ctx.currentTime;
      const g = this.master.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(v, now + seconds);
    } else {
      for (const el of this.els) el.volume = v;
    }
  }

  setMuted(muted: boolean) {
    this.emit({ muted });
    if (!muted && this.state.started && !this.state.playing && this.current >= 0) {
      this.els[this.current].play().then(() => this.emit({ playing: true })).catch(() => undefined);
    }
    this.applyMaster(0.5);
  }

  setVolume(volume: number) {
    const v = Math.min(1, Math.max(0, volume));
    this.emit({ volume: v, muted: v === 0 ? true : this.state.muted && v > 0 ? false : this.state.muted });
    this.applyMaster(0.15);
  }

  /** Temporarily raise/lower the level (e.g. a gentle swell for the closing of the book). */
  swell(level: number, seconds = 1.5) {
    this.swellLevel = level;
    this.applyMaster(seconds);
  }
}
