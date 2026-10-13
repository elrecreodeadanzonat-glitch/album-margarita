import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX, ZoomIn, ZoomOut, Minimize2, Maximize, Minimize,
  LayoutGrid, X, Expand, Shrink, Plus, MessageCircleHeart, Undo2, Settings2,
} from 'lucide-react';
import type { FitMode, Photo } from '../lib/types';
import { assetUrl, displayAspect } from '../lib/gallery';
import { useAutoplay } from '../lib/useAutoplay';
import { useGestures } from '../lib/useGestures';
import type { MusicState } from '../lib/music';
import { commentsByPhoto, useCloudState, type CloudStore, type LocalComment } from '../lib/cloudStore';
import { Comments } from './Comments';
import { TrayList } from './TrayList';
import { VideoPage } from './VideoPage';

export const PHOTO_SECONDS = 15;
const TRANSITION_MS = 700;

interface Props {
  photos: Photo[];
  music: MusicState;
  onToggleMute: () => void;
  onVolume: (v: number) => void;
  onFinish: () => void;
  startIndex?: number;
  /** used by the admin preview: no fullscreen hand-off to the document */
  embedded?: boolean;
  /** «+» at the end of the thumbnails tray; omitted in the admin preview */
  onAddFiles?: (files: File[]) => void;
  /** a dialog is open on top: stop autoplay, gestures and keyboard */
  blocked?: boolean;
  /** comments (and family photos' full images); omitted → no comment button */
  cloud?: CloudStore;
  /** editor only: hide / show comments */
  onModerateComment?: (c: LocalComment, hidden: boolean) => Promise<void>;
  /** drag thumbnails to rearrange the book (saved for everyone); omitted → fixed order */
  reorder?: Reorder;
  /** lower the background music while a video plays with sound */
  onDuck?: (on: boolean) => void;
  /** «Opciones del álbum» */
  onSettings?: () => void;
}

const noDuck = () => undefined;

export interface Reorder {
  /** the page at `from` was dropped at `to` (positions in `shown`); `before` is what «Deshacer» restores */
  move: (shown: string[], from: number, to: number) => { before: string[]; done: Promise<void> };
  restore: (ids: string[]) => Promise<void>;
}

interface Layer { photo: Photo; key: number; dir: 1 | -1 | 0; leaving?: boolean }

const mdWidth = (p: Photo) => Math.round(p.width * Math.min(1, 1280 / Math.max(p.width, p.height)));

function srcSetFor(p: Photo): string | undefined {
  if (!p.srcMd || p.srcMd === p.src) return undefined;
  return `${assetUrl(p.srcMd)} ${mdWidth(p)}w, ${assetUrl(p.src)} ${p.width}w`;
}

function preload(p: Photo | undefined, sizes: string) {
  if (!p) return;
  const img = new Image();
  const ss = srcSetFor(p);
  if (ss) {
    img.sizes = sizes;
    img.srcset = ss;
  }
  img.src = assetUrl(p.src);
}

export function Viewer({ photos, music, onToggleMute, onVolume, onFinish, startIndex = 0, embedded = false, onAddFiles, blocked: blockedFromOutside = false, cloud, onModerateComment, reorder, onDuck = noDuck, onSettings }: Props) {
  const n = photos.length;
  const [index, setIndex] = useState(() => Math.min(Math.max(0, startIndex), Math.max(0, n - 1)));
  const [playing, setPlaying] = useState(true);
  const [fitOverride, setFitOverride] = useState<FitMode | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [layers, setLayers] = useState<Layer[]>(() => (n ? [{ photo: photos[Math.min(startIndex, n - 1)], key: 0, dir: 0 }] : []));
  const [transitioning, setTransitioning] = useState(false);
  const [interactKey, setInteractKey] = useState(0);
  const [isFs, setIsFs] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);
  const [volOpen, setVolOpen] = useState(false);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: string[] } | null>(null);
  const [videoTap, setVideoTap] = useState(0);
  const endedTimer = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  // the photo on screen, by id: if the book is rearranged (here or by someone else), stay on it —
  // unless nobody has turned a page yet: then the book simply starts with its (new) first page
  const [shownId, setShownId] = useState<string | undefined>(() => photos[Math.min(Math.max(0, startIndex), Math.max(0, n - 1))]?.id);
  const [navigated, setNavigated] = useState(startIndex > 0);
  if (n && photos[index]?.id !== shownId) {
    const j = shownId && navigated ? photos.findIndex((p) => p.id === shownId) : -1;
    if (j >= 0) setIndex(j);
    else {
      const k = Math.min(index, n - 1);
      if (k !== index) setIndex(k);
      setShownId(photos[k].id);
    }
  }
  const blocked = blockedFromOutside || commentsOpen;
  const cloudState = useCloudState(cloud);
  const comments = useMemo(() => (cloudState ? commentsByPhoto(cloudState.comments) : null), [cloudState]);
  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const layerKey = useRef(0);
  const hideTimer = useRef<number | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const addInput = useRef<HTMLInputElement>(null);

  const photo = photos[index];
  const fit: FitMode = fitOverride ?? photo?.fitMode ?? 'contain';

  // ---- frame geometry (album page around the photo) ----
  const frame = useMemo(() => {
    if (!photo || !stage.w) return { w: 0, h: 0, pad: 0 };
    const pad = stage.w < 600 ? 7 : 12;
    const margin = stage.w < 600 ? 10 : 22;
    const aw = Math.max(40, stage.w - margin * 2);
    const ah = Math.max(40, stage.h - margin * 2);
    if (fit === 'cover') return { w: aw, h: ah, pad };
    const a = displayAspect(photo);
    let w = aw;
    let h = (w - pad * 2) / a + pad * 2;
    if (h > ah) {
      h = ah;
      w = (h - pad * 2) * a + pad * 2;
    }
    return { w, h, pad };
  }, [photo, stage, fit]);

  const sizes = `${Math.max(1, Math.round(frame.w))}px`;

  const bumpInteraction = useCallback(() => setInteractKey((k) => k + 1), []);

  const go = useCallback(
    (target: number, dir: 1 | -1) => {
      if (target < 0 || target >= n || target === index) return;
      layerKey.current += 1;
      const key = layerKey.current;
      setLayers((ls) => [...ls.filter((l) => !l.leaving).map((l) => ({ ...l, leaving: true })), { photo: photos[target], key, dir }]);
      setIndex(target);
      setShownId(photos[target].id);
      setNavigated(true);
      setTransitioning(true);
      window.setTimeout(() => {
        setLayers((ls) => ls.filter((l) => l.key === key || !l.leaving));
        setTransitioning(false);
      }, TRANSITION_MS);
    },
    [index, n, photos],
  );

  // ---- fullscreen + controls auto-hide (only while in fullscreen) ----
  const fsSupported = typeof document !== 'undefined' && !!document.documentElement.requestFullscreen && !embedded;
  const fullscreenOn = isFs || immersive;
  const hideUi = fullscreenOn && uiHidden;
  const scheduleHide = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setUiHidden(true), 3200);
  }, []);
  const revealUi = useCallback(() => {
    setUiHidden(false);
    if (fullscreenOn) scheduleHide();
  }, [fullscreenOn, scheduleHide]);
  const toggleUi = useCallback(() => {
    if (!fullscreenOn) return;
    if (uiHidden) revealUi();
    else setUiHidden(true);
  }, [fullscreenOn, uiHidden, revealUi]);
  useEffect(() => {
    const onFs = () => {
      const on = !!document.fullscreenElement;
      setIsFs(on);
      setUiHidden(false);
      if (on) scheduleHide();
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      window.clearTimeout(hideTimer.current);
    };
  }, [scheduleHide]);
  const toggleFullscreen = useCallback(async () => {
    if (fsSupported) {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await (rootRef.current ?? document.documentElement).requestFullscreen();
        return;
      } catch {
        /* fall through to immersive mode */
      }
    }
    const on = !immersive;
    setImmersive(on);
    setUiHidden(false);
    if (on) scheduleHide();
  }, [fsSupported, immersive, scheduleHide]);

  // ---- navigation ----
  const next = useCallback(() => {
    revealUi();
    if (index >= n - 1) onFinish();
    else go(index + 1, 1);
  }, [index, n, go, onFinish, revealUi]);

  const prev = useCallback(() => {
    revealUi();
    go(index - 1, -1);
  }, [index, go, revealUi]);

  const jump = (i: number) => {
    setTrayOpen(false);
    go(i, i > index ? 1 : -1);
  };

  // zoom resets by itself whenever the photo or the fit mode changes
  const { stageRef, zoom: z, dragX, zoomIn, zoomOut, reset: resetZoom, isZoomed, active: gesturing, handlers } = useGestures({
    contentSize: { w: frame.w, h: frame.h },
    enabled: !trayOpen && !blocked,
    resetKey: `${photo?.id}:${fit}`,
    onSwipe: (dir) => (dir > 0 ? next() : prev()),
    onTap: (fx) => {
      if (fx < 0.3) prev();
      else if (fx > 0.7) next();
      else if (photo?.kind === 'video') setVideoTap((t) => t + 1);
      else toggleUi();
    },
    onInteract: revealUi,
  });

  // ---- 15 s autoplay ----
  const isVideo = photo?.kind === 'video';
  const running = playing && !blocked && !trayOpen && !isZoomed && !isVideo && !!(photo && loaded[photo.id] && !photo.pending) && !transitioning && n > 0;
  const autoNext = useCallback(() => {
    if (index >= n - 1) onFinish();
    else go(index + 1, 1);
  }, [index, n, go, onFinish]);
  const progress = useAutoplay(running, PHOTO_SECONDS * 1000, `${photo?.id}:${interactKey}`, autoNext);

  // when a zoom ends, give the photo a fresh 15 s
  const wasZoomed = useRef(false);
  useEffect(() => {
    if (wasZoomed.current && !isZoomed) bumpInteraction();
    wasZoomed.current = isZoomed;
  }, [isZoomed, bumpInteraction]);

  // ---- preload current + next only ----
  useEffect(() => {
    preload(photos[index + 1], sizes);
  }, [index, photos, sizes]);

  // family photos: fetch the full image of the current and the next two
  useEffect(() => {
    if (!cloud) return;
    for (const p of [photos[index], photos[index + 1], photos[index + 2]]) {
      if (p?.pending) cloud.loadImage(p.id).catch(() => undefined);
    }
  }, [cloud, index, photos]);

  // videos: fetch the one on screen; when it ends, go on (if the album is playing)
  useEffect(() => {
    if (cloud && photo?.kind === 'video') cloud.loadVideo(photo.id).catch(() => undefined);
  }, [cloud, photo]);
  useEffect(() => () => window.clearTimeout(endedTimer.current), [index]);
  const onVideoEnded = () => {
    window.clearTimeout(endedTimer.current);
    if (!playing || blocked) return;
    endedTimer.current = window.setTimeout(autoNext, 1500);
  };

  const closeComments = useCallback(() => {
    setCommentsOpen(false);
    bumpInteraction();
  }, [bumpInteraction]);

  // ---- stage size ----
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [stageRef]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (blocked) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      switch (e.key) {
        case 'ArrowRight': e.preventDefault(); next(); break;
        case 'ArrowLeft': e.preventDefault(); prev(); break;
        case ' ':
        case 'Spacebar':
          if (t && t.tagName === 'BUTTON') return;
          e.preventDefault(); setPlaying((p) => !p); revealUi(); break;
        case 'Escape':
          if (trayOpen) setTrayOpen(false);
          else if (isZoomed) resetZoom();
          else if (immersive) setImmersive(false);
          break;
        case '+': case '=': zoomIn(); break;
        case '-': case '_': zoomOut(); break;
        case '0': resetZoom(); break;
        case 'f': case 'F': void toggleFullscreen(); break;
        case 'm': case 'M': onToggleMute(); break;
        case 't': case 'T': setTrayOpen((o) => !o); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [blocked, next, prev, trayOpen, isZoomed, resetZoom, zoomIn, zoomOut, immersive, toggleFullscreen, onToggleMute, revealUi]);

  // ---- rearrange by dragging a thumbnail ----
  const showToast = useCallback((t: { text: string; undo?: string[] }) => {
    window.clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = window.setTimeout(() => setToast(null), 9000);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  const move = (from: number, to: number) => {
    if (!reorder) return;
    setNavigated(true); // from now on, stay with the photo on screen wherever it goes
    const { before, done } = reorder.move(photos.map((p) => p.id), from, to);
    showToast({ text: `Listo: la foto quedó en el lugar ${to + 1}.`, undo: before });
    done.catch(() => showToast({ text: 'No se pudo guardar el nuevo orden. Revisa tu conexión e inténtalo otra vez.' }));
  };
  const undoMove = (ids: string[]) => {
    if (!reorder) return;
    showToast({ text: 'Orden anterior restaurado.' });
    reorder.restore(ids).catch(() => showToast({ text: 'No se pudo deshacer. Revisa tu conexión.' }));
  };

  // keep the current thumbnail in view
  useEffect(() => {
    if (!trayOpen) return;
    trayRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [trayOpen, shownId]);

  if (!n || !photo) return <div className="viewer-empty">No hay fotos para mostrar.</div>;

  const bg = photo.color ?? '#8a6f5c';

  return (
    <div
      ref={rootRef}
      className={`viewer${fullscreenOn ? ' is-fullscreen' : ''}${hideUi ? ' ui-hidden' : ''}`}
      style={{ ['--photo-color' as string]: bg }}
      onMouseMove={fullscreenOn ? revealUi : undefined}
      data-testid="viewer"
      data-index={index}
      data-music={music.playing ? (music.muted ? 'muted' : 'playing') : 'stopped'}
      data-playing={playing ? 'yes' : 'no'}
    >
      <div className="viewer-bg" aria-hidden="true" />

      <header className="viewer-top">
        <div className="progress" role="progressbar" aria-label="Avance del libro" aria-valuemin={1} aria-valuemax={n} aria-valuenow={index + 1}>
          <div className="progress-fill" style={{ transform: `scaleX(${(index + (playing ? progress : 0)) / n})` }} />
        </div>
        <p className="counter" aria-live="polite" data-testid="counter">{isVideo ? 'Video' : 'Foto'} {index + 1} de {n}</p>
      </header>

      <div
        className={`stage${isZoomed ? ' is-zoomed' : ''}${gesturing ? ' is-gesturing' : ''}`}
        ref={stageRef}
        {...handlers}
        role="region"
        aria-roledescription="carrusel"
        aria-label="Fotografías del libro"
        data-testid="stage"
      >
        {layers.map((l) => {
          const isCur = !l.leaving;
          const p = isCur ? photo : byId.get(l.photo.id) ?? l.photo;
          const pf: FitMode = fitOverride ?? p.fitMode ?? 'contain';
          const sideways = p.rotation === 90 || p.rotation === 270;
          const innerW = frame.w - frame.pad * 2;
          const innerH = frame.h - frame.pad * 2;
          const imgStyle: React.CSSProperties = {
            width: sideways ? innerH : innerW,
            height: sideways ? innerW : innerH,
            transform: `translate(-50%, -50%) rotate(${p.rotation}deg)`,
            objectFit: pf,
            objectPosition: `${p.focalPoint.x * 100}% ${p.focalPoint.y * 100}%`,
          };
          return (
            <div
              key={l.key}
              className={`layer ${l.leaving ? 'is-leaving' : 'is-current'} dir-${l.dir}`}
              style={isCur ? { transform: `translateX(${dragX}px)` } : undefined}
              aria-hidden={!isCur}
            >
              <figure
                className={`page fit-${pf}`}
                style={{
                  width: frame.w,
                  height: frame.h,
                  padding: frame.pad,
                  transform: isCur ? `translate(${z.x}px, ${z.y}px) scale(${z.scale})` : undefined,
                }}
              >
                <div className="page-inner">
                  {(!loaded[p.id] || p.pending) && <div className="page-loading" aria-hidden="true" />}
                  {isCur && p.kind === 'video' ? (
                    <VideoPage
                      photo={p}
                      url={cloudState?.videos[p.id] ?? null}
                      progress={cloudState?.videoProgress[p.id] ?? 0}
                      failed={!!cloudState?.videoErrors[p.id]}
                      onRetry={() => cloud?.loadVideo(p.id).catch(() => undefined)}
                      autoplay={playing && !blocked && !trayOpen && !transitioning}
                      style={imgStyle}
                      onEnded={onVideoEnded}
                      onDuck={onDuck}
                      tapSignal={videoTap}
                    />
                  ) : null}
                  <img
                    hidden={isCur && p.kind === 'video'}
                    src={assetUrl(p.src)}
                    srcSet={srcSetFor(p)}
                    sizes={sizes}
                    alt={p.alt}
                    width={p.width}
                    height={p.height}
                    draggable={false}
                    decoding="async"
                    className={p.pending ? 'is-pending' : undefined}
                    style={imgStyle}
                    data-photo-id={p.id}
                    onLoad={() => setLoaded((m) => (m[p.id] ? m : { ...m, [p.id]: true }))}
                    onError={() => setLoaded((m) => ({ ...m, [p.id]: true }))}
                  />
                </div>
                {isCur && cloud && !isZoomed ? (
                  <NoteButton count={comments?.get(p.id)?.length ?? 0} onOpen={() => setCommentsOpen(true)} />
                ) : null}
              </figure>
            </div>
          );
        })}
      </div>

      {photo.caption || photo.addedBy ? (
        <div className="photo-meta">
          {photo.caption ? <p className="caption">{photo.caption}</p> : null}
          {photo.addedBy ? <span className="shared-by">{photo.kind === 'video' ? 'Compartido' : 'Compartida'} por {photo.addedBy}</span> : null}
        </div>
      ) : null}

      <nav className="controls" aria-label="Controles del libro">
        <div className="controls-row main">
          <button className="ctl" onClick={prev} disabled={index === 0} aria-label="Anterior" title="Anterior (←)"><ChevronLeft /></button>
          <button
            className="ctl play"
            onClick={() => { setPlaying((p) => !p); revealUi(); }}
            aria-label={playing ? 'Pausar' : 'Reanudar'}
            aria-pressed={!playing}
            title={playing ? 'Pausar (espacio)' : 'Reanudar (espacio)'}
            data-testid="play"
            style={{ ['--p' as string]: playing ? progress : 0 }}
          >
            {playing ? <Pause /> : <Play />}
          </button>
          <button className="ctl" onClick={next} aria-label="Siguiente" title="Siguiente (→)"><ChevronRight /></button>
          <span className="spacer" />
          {onAddFiles ? (
            <button className="ctl add-ctl" onClick={() => addInput.current?.click()} aria-label="Agregar fotos o videos" title="Agregar fotos o videos" data-testid="add-ctl"><Plus /><span>Agregar</span></button>
          ) : null}
          <button className="ctl" onClick={() => setTrayOpen((o) => !o)} aria-label="Ver miniaturas" aria-expanded={trayOpen} title="Miniaturas (T)" data-testid="thumbs-toggle"><LayoutGrid /></button>
        </div>
        <div className="controls-row tools">
          <div className="vol">
            <button className="ctl" onClick={onToggleMute} aria-label={music.muted ? 'Activar música' : 'Silenciar música'} aria-pressed={music.muted} title="Música (M)" data-testid="mute">
              {music.muted ? <VolumeX /> : <Volume2 />}
            </button>
            <button className="ctl vol-more" onClick={() => setVolOpen((o) => !o)} aria-label="Volumen" aria-expanded={volOpen}>
              <span className="vol-level" style={{ ['--v' as string]: music.muted ? 0 : music.volume }} />
            </button>
            <input
              className={`vol-slider${volOpen ? ' open' : ''}`}
              type="range" min={0} max={1} step={0.05}
              value={music.muted ? 0 : music.volume}
              onChange={(e) => onVolume(Number(e.target.value))}
              aria-label="Volumen de la música"
              data-testid="volume"
            />
          </div>
          <button className="ctl" onClick={zoomOut} disabled={!isZoomed} aria-label="Alejar" title="Alejar (−)"><ZoomOut /></button>
          <button className="ctl" onClick={zoomIn} aria-label="Acercar" title="Acercar (+)" data-testid="zoom-in"><ZoomIn /></button>
          <button className="ctl" onClick={resetZoom} disabled={!isZoomed} aria-label="Tamaño normal" title="Tamaño normal (0)" data-testid="zoom-reset"><Minimize2 /></button>
          <button
            className="ctl fit"
            onClick={() => { setFitOverride(fit === 'contain' ? 'cover' : 'contain'); resetZoom(); }}
            aria-label={fit === 'contain' ? 'Llenar la pantalla' : 'Encajar la foto completa'}
            title={fit === 'contain' ? 'Llenar' : 'Encajar'}
            data-testid="fit"
          >
            {fit === 'contain' ? <Expand /> : <Shrink />}<span>{fit === 'contain' ? 'Llenar' : 'Encajar'}</span>
          </button>
          {onSettings ? (
            <button className="ctl" onClick={onSettings} aria-label="Opciones del álbum" title="Opciones" data-testid="settings-ctl"><Settings2 /></button>
          ) : null}
          <button className="ctl" onClick={toggleFullscreen} aria-label={fullscreenOn ? 'Salir de pantalla completa' : 'Pantalla completa'} title="Pantalla completa (F)" data-testid="fullscreen">
            {fullscreenOn ? <Minimize /> : <Maximize />}
          </button>
        </div>
      </nav>

      {immersive && hideUi ? null : immersive ? (
        <button className="exit-immersive" onClick={() => setImmersive(false)} aria-label="Salir de pantalla completa"><X /></button>
      ) : null}

      <div className={`tray${trayOpen ? ' open' : ''}`} aria-hidden={!trayOpen} data-testid="tray">
        <div className="tray-head">
          <p className="tray-title">
            <b>Todas las fotos y videos</b>
            {reorder ? (
              <span className="tray-hint">
                <span className="hint-mouse">Para cambiar el orden, arrastra una foto a su nuevo lugar.</span>
                <span className="hint-touch">Para cambiar el orden, deja el dedo sobre una foto y arrástrala.</span>
              </span>
            ) : null}
          </p>
          <button className="ctl" onClick={() => setTrayOpen(false)} aria-label="Cerrar miniaturas" tabIndex={trayOpen ? 0 : -1}><X /></button>
        </div>
        <div className="tray-list" ref={trayRef}>
          {trayOpen ? (
            <TrayList photos={photos} index={index} comments={comments} onJump={jump} onMove={reorder ? move : undefined}>
              {onAddFiles ? (
                <button className="thumb add" onClick={() => addInput.current?.click()} aria-label="Agregar fotos o videos al álbum" data-testid="add-photo-tile">
                  <Plus aria-hidden="true" />
                  <span>Agregar</span>
                </button>
              ) : null}
            </TrayList>
          ) : null}
        </div>
        {onAddFiles ? (
          <input
            ref={addInput}
            aria-hidden="true"
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            data-testid="add-input"
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (list.length) {
                setTrayOpen(false);
                // the «Agregar» sheet lives outside the viewer: leave fullscreen so it can be seen
                if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
                setImmersive(false);
                onAddFiles(list);
              }
            }}
          />
        ) : null}
      </div>

      {toast ? (
        <div className="book-toast" role="status" data-testid="tray-toast">
          <span>{toast.text}</span>
          {toast.undo ? <button onClick={() => undoMove(toast.undo!)} data-testid="tray-undo"><Undo2 aria-hidden="true" /> Deshacer</button> : null}
          <button className="toast-x" onClick={() => setToast(null)} aria-label="Cerrar aviso"><X aria-hidden="true" /></button>
        </div>
      ) : null}

      {commentsOpen && cloud ? (
        <Comments photo={photo} number={index + 1} store={cloud} onClose={closeComments} onModerate={onModerateComment} />
      ) : null}
    </div>
  );
}

/** the little note button in the corner of the photo: comments and notes about the photo on screen */
function NoteButton({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button
      className={`note-btn${count ? ' has' : ''}`}
      onClick={onOpen}
      aria-label={count === 1 ? 'Ver el comentario de esta foto o escribir otro' : count ? `Ver los ${count} comentarios de esta foto o escribir otro` : 'Escribir un comentario o una nota sobre esta foto'}
      title="Comentar o dejar una nota"
      data-testid="comments-open"
    >
      <MessageCircleHeart aria-hidden="true" />
      {count ? <span className="note-count" data-testid="comments-count">{count}</span> : null}
    </button>
  );
}
