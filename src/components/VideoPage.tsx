import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Volume2, VolumeX, RotateCcw, Loader2 } from 'lucide-react';
import type { Photo } from '../lib/types';
import { clock } from '../lib/video';

interface Props {
  photo: Photo;
  /** ready to play (object URL), or null while it arrives */
  url: string | null;
  /** 0..1 while it arrives */
  progress: number;
  failed: boolean;
  onRetry: () => void;
  /** it is the page on screen and the album is playing: start by itself */
  autoplay: boolean;
  /** inner size of the page and the rotation, like a photo */
  style: React.CSSProperties;
  onEnded: () => void;
  /** changes on every tap in the middle of the page (swipes still turn pages): play / pause */
  tapSignal: number;
  /** lower the background music while the video plays with sound */
  onDuck: (on: boolean) => void;
}

/**
 * A short video as a page of the album: big simple buttons (play, sound, start again) instead of the tiny
 * native ones. It starts by itself with sound when the album is playing; if the phone does not allow sound
 * without a tap, it plays muted and offers «Toca para oír el sonido».
 */
export function VideoPage({ photo, url, progress, failed, onRetry, autoplay, style, onEnded, onDuck, tapSignal }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [time, setTime] = useState(0);
  const total = photo.video?.duration ?? 0;

  useEffect(() => {
    const v = ref.current;
    if (!v || !url) return;
    if (!autoplay) {
      v.pause();
      return;
    }
    v.muted = false;
    v.play().catch(() => {
      // no sound without a tap on this phone: play muted and offer the sound
      v.muted = true;
      setMuted(true);
      setSoundBlocked(true);
      v.play().catch(() => undefined);
    });
  }, [autoplay, url]);

  useEffect(() => {
    onDuck(playing && !muted);
  }, [playing, muted, onDuck]);
  useEffect(() => () => onDuck(false), [onDuck]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused || v.ended) {
      if (v.ended) v.currentTime = 0;
      void v.play().catch(() => undefined);
    } else v.pause();
  };

  const unmute = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    setSoundBlocked(false);
    if (v.paused) void v.play().catch(() => undefined);
  };

  // a tap in the middle of the page plays or pauses (the page itself takes care of swipes)
  const lastTap = useRef(tapSignal);
  useEffect(() => {
    if (tapSignal === lastTap.current) return;
    lastTap.current = tapSignal;
    toggle();
  }, [tapSignal]);

  const restart = () => {
    const v = ref.current;
    if (!v) return;
    v.currentTime = 0;
    setEnded(false);
    void v.play().catch(() => undefined);
  };

  return (
    <div className="video-page" data-testid="video-page">
      {url ? (
        <video
          ref={ref}
          src={url}
          poster={photo.src}
          playsInline
          preload="auto"
          style={style}
          data-photo-id={photo.id}
          data-testid="video"
          onPlay={() => { setPlaying(true); setEnded(false); }}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setEnded(true); onEnded(); }}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
        />
      ) : (
        <img src={photo.src} alt={photo.alt} style={style} draggable={false} className={photo.pending ? 'is-pending' : undefined} data-photo-id={photo.id} />
      )}

      {!url && !failed ? (
        <div className="video-wait" aria-live="polite">
          <Loader2 className="spin" aria-hidden="true" />
          <span>Cargando el video… {Math.round(progress * 100)} %</span>
        </div>
      ) : null}
      {failed ? (
        <div className="video-wait is-error" role="alert">
          <span>No se pudo cargar el video.</span>
          <button onClick={onRetry}>Intentar otra vez</button>
        </div>
      ) : null}

      {url && !playing ? (
        <button className="video-big" onClick={ended ? restart : toggle} aria-label={ended ? 'Ver el video otra vez' : 'Reproducir el video'} data-testid="video-play">
          {ended ? <RotateCcw /> : <Play />}
        </button>
      ) : null}

      {url && soundBlocked ? (
        <button className="video-sound" onClick={unmute} data-testid="video-unmute">
          <VolumeX aria-hidden="true" /> Toca para oír el sonido
        </button>
      ) : null}

      {url ? (
        <div className="video-bar" data-no-gesture>
          <button onClick={toggle} aria-label={playing ? 'Pausar el video' : 'Reproducir el video'}>{playing ? <Pause /> : <Play />}</button>
          <div className="video-track" aria-hidden="true"><div style={{ width: `${total ? Math.min(100, (time / total) * 100) : 0}%` }} /></div>
          <span className="video-time">{clock(time)} / {clock(total)}</span>
          <button onClick={unmute} aria-label={muted ? 'Activar el sonido del video' : 'Silenciar el video'} data-testid="video-mute">{muted ? <VolumeX /> : <Volume2 />}</button>
        </div>
      ) : null}
    </div>
  );
}
