import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, X, Check, PartyPopper, RotateCcw, Play } from 'lucide-react';
import { prepareCloudImage, type CloudImage } from '../lib/images';
import { VIDEO, clock, closePipe, isVideoFile, openPipe, probeVideo, rerecord, type VideoPipe, type VideoProbe } from '../lib/video';
import type { CloudStore } from '../lib/cloudStore';
import { loadName, saveName } from '../lib/prefs';
import { LIMITS } from '../lib/cloud';
import { describe } from '../lib/words';
import '../styles/dialog.css';

interface Props {
  files: File[];
  store: CloudStore;
  /** closes the sheet; with the id of the first page added, the album jumps to it */
  onClose: (firstNewId?: string) => void;
}

type Item = CloudImage & {
  key: string;
  kind: 'photo' | 'video';
  file?: File;
  probe?: VideoProbe;
  state: 'ready' | 'working' | 'done' | 'failed';
  /** what a video is doing now, and how far (0..1) */
  step?: 'prepare' | 'upload';
  progress?: number;
  id?: string;
  createdAt?: string;
};
type Phase = 'preparing' | 'ready' | 'uploading' | 'done' | 'failed';

let audioCtx: AudioContext | null = null;
/** one sound mixer for re-recording videos, started inside the tap (phones require it) */
function soundMixer(): AudioContext | null {
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    audioCtx ??= new AC();
    void audioCtx.resume().catch(() => undefined);
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Adding photos and short videos. Made for everyone, grandparents included:
 * pick them → one big button → «¡Listo!». Videos are made lighter first (it takes about as long as the video).
 */
export default function AddMedia({ files, store, onClose }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [phase, setPhase] = useState<Phase>('preparing');
  const [preparing, setPreparing] = useState({ done: 0, total: files.length });
  const [errors, setErrors] = useState<string[]>([]);
  const [name, setName] = useState(loadName);
  const moreRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const patch = (key: string, p: Partial<Item>) => setItems((cur) => cur.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const prepare = async (list: File[]) => {
    setPhase('preparing');
    setPreparing({ done: 0, total: list.length });
    const errs: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      const key = `${Date.now()}-${i}-${Math.random()}`;
      try {
        if (isVideoFile(file)) {
          const probe = await probeVideo(file);
          setItems((cur) => [...cur, { ...probe, key, kind: 'video', file, probe, state: 'ready' }]);
        } else {
          const img = await prepareCloudImage(file);
          setItems((cur) => [...cur, { ...img, key, kind: 'photo', state: 'ready' }]);
        }
      } catch (e) {
        errs.push((e as Error).message);
      }
      setPreparing({ done: i + 1, total: list.length });
    }
    setErrors((cur) => [...cur, ...errs]);
    setPhase('ready');
  };

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // decoding and resizing runs asynchronously (canvas), then stores the results
    void prepare(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** runs inside the tap: videos that must be re-recorded get their player now, so they can play with sound */
  const upload = () => {
    const ctx = soundMixer();
    const pipes = new Map<string, VideoPipe>();
    for (const it of itemsRef.current) {
      if (it.kind === 'video' && it.state !== 'done' && it.file && !it.probe?.keep) pipes.set(it.key, openPipe(it.file, ctx));
    }
    void send(pipes);
  };

  const send = async (pipes: Map<string, VideoPipe>) => {
    saveName(name);
    setErrors([]);
    setPhase('uploading');
    let failed = 0;
    const errs: string[] = [];
    for (const it of itemsRef.current) {
      if (it.state === 'done') continue;
      patch(it.key, { state: 'working', progress: 0, step: it.kind === 'video' && !it.probe?.keep ? 'prepare' : 'upload' });
      try {
        let saved;
        if (it.kind === 'photo') {
          saved = await store.addPhoto({ image: it.image, thumb: it.thumb, width: it.width, height: it.height, color: it.color, author: name });
        } else {
          const probe = it.probe!;
          const pipe = pipes.get(it.key);
          const ready = probe.keep || !pipe
            ? { blob: it.file! as Blob, mime: 'video/mp4' as const, width: probe.width, height: probe.height, duration: probe.duration }
            : await rerecord(pipe, probe, (f) => patch(it.key, { progress: f }));
          patch(it.key, { step: 'upload', progress: 0 });
          saved = await store.addVideo(
            { image: probe.image, thumb: probe.thumb, width: ready.width, height: ready.height, color: probe.color, author: name, blob: ready.blob, mime: ready.mime, duration: ready.duration },
            (f) => patch(it.key, { progress: f }),
          );
        }
        patch(it.key, { state: 'done', id: saved.id, createdAt: saved.createdAt, step: undefined });
      } catch (e) {
        failed++;
        const msg = (e as Error).message;
        if (msg && !/^(Error \d+|Sin conexión)/.test(msg)) errs.push(msg);
        patch(it.key, { state: 'failed', step: undefined });
      } finally {
        const pipe = pipes.get(it.key);
        if (pipe) closePipe(pipe);
      }
    }
    setErrors(errs);
    setPhase(failed ? 'failed' : 'done');
  };

  const n = items.length;
  const photosN = items.filter((x) => x.kind === 'photo').length;
  const videosN = n - photosN;
  const doneItems = items.filter((x) => x.state === 'done');
  const donePhotos = doneItems.filter((x) => x.kind === 'photo').length;
  const doneVideos = doneItems.length - donePhotos;
  // the one that comes first in the album (after a retry, upload order and pick order differ)
  const firstNew = [...doneItems].sort((x, y) => Date.parse(x.createdAt ?? '') - Date.parse(y.createdAt ?? ''))[0]?.id;
  const working = items.find((x) => x.state === 'working');
  const sending = items.findIndex((x) => x.state === 'working') + 1 || doneItems.length;
  const locked = phase === 'uploading';
  const slowVideos = items.some((x) => x.kind === 'video' && !x.probe?.keep && x.state !== 'done');

  if (phase === 'done') {
    const one = doneItems.length === 1;
    const pronoun = one ? (doneVideos ? 'lo' : 'la') : doneVideos ? 'los' : 'las';
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-title" data-testid="add-photos">
        <div className="modal add-sheet done-sheet">
          <div className="done-mark" aria-hidden="true"><PartyPopper /></div>
          <h2 id="add-title">¡Listo!</h2>
          <p className="big-text" data-testid="add-done">
            {one ? (doneVideos ? 'Tu video ya está en el álbum.' : 'Tu foto ya está en el álbum.') : `Tus ${describe(donePhotos, doneVideos)} ya están en el álbum.`}
            <br />Todos {pronoun} pueden ver desde ahora.
          </p>
          <ul className="add-grid done" aria-hidden="true">
            {doneItems.slice(0, 6).map((it) => <li key={it.key}><img src={it.thumb} alt="" />{it.kind === 'video' ? <span className="add-video"><Play /></span> : null}</li>)}
          </ul>
          <button className="btn primary huge" onClick={() => onClose(firstNew)} autoFocus data-testid="add-see">Ver en el álbum</button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-title" data-testid="add-photos">
      <div className="modal add-sheet">
        <button className="modal-x" onClick={() => onClose(firstNew)} disabled={locked} aria-label="Cerrar"><X /></button>
        <h2 id="add-title">Agregar al álbum</h2>

        <ul className="add-grid big">
          {items.map((it) => (
            <li key={it.key} className={`is-${it.state}`} data-testid={it.kind === 'video' ? 'add-item-video' : 'add-item-photo'}>
              <img src={it.thumb} alt="" />
              {it.kind === 'video' ? (
                <span className="add-video">
                  <Play aria-hidden="true" />
                  <b>{clock(Math.min(it.probe?.duration ?? 0, VIDEO.maxSeconds))}</b>
                </span>
              ) : null}
              {it.state === 'working' ? (
                <span className="add-state">
                  <Loader2 className="spin" />
                  {it.kind === 'video' ? <small>{it.step === 'prepare' ? 'Preparando' : 'Subiendo'} {Math.round((it.progress ?? 0) * 100)} %</small> : null}
                </span>
              ) : null}
              {it.state === 'done' ? <span className="add-state ok"><Check /></span> : null}
              {it.state === 'failed' ? <span className="add-state bad">!</span> : null}
              {it.state === 'ready' && !locked ? (
                <button className="add-remove" onClick={() => setItems((cur) => cur.filter((x) => x.key !== it.key))} aria-label={`Quitar ${it.name}`}>
                  <X />
                </button>
              ) : null}
            </li>
          ))}
          {phase === 'preparing' ? (
            <li className="add-busy" aria-live="polite"><Loader2 className="spin" /><span>Preparando {preparing.done + 1 > preparing.total ? preparing.total : preparing.done + 1} de {preparing.total}…</span></li>
          ) : !locked ? (
            <li>
              <button className="add-more" onClick={() => moreRef.current?.click()} aria-label="Elegir más fotos o videos"><ImagePlus /><span>Más</span></button>
              <input
                ref={moreRef}
                type="file"
                accept="image/*,video/*"
                multiple
                hidden
                onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ''; if (l.length) void prepare(l); }}
              />
            </li>
          ) : null}
        </ul>

        {items.some((x) => x.kind === 'video' && (x.probe?.duration ?? 0) > VIDEO.maxSeconds + 0.5) ? (
          <p className="note">Los videos de más de un minuto se guardan hasta el minuto 1:00.</p>
        ) : null}
        {slowVideos && phase !== 'failed' ? (
          <p className="note" data-testid="add-video-note">
            Antes de subir, los videos se preparan para que pesen menos: tarda más o menos lo que dura cada video. No cierres esta pantalla mientras tanto.
          </p>
        ) : null}

        {errors.length ? <div className="error" role="alert">{errors.map((e, i) => <p key={i}>{e}</p>)}</div> : null}

        {phase === 'uploading' ? (
          <div className="upload-progress" aria-live="polite" data-testid="add-progress">
            <p>
              {working?.kind === 'video' && working.step === 'prepare'
                ? `Preparando el video (${sending} de ${n})…`
                : `Subiendo ${Math.min(sending, n)} de ${n}…`}
            </p>
            <div className="bar"><div style={{ width: `${((doneItems.length + (working?.progress ?? 0)) / Math.max(1, n)) * 100}%` }} /></div>
          </div>
        ) : phase === 'failed' ? (
          <div className="error" role="alert" data-testid="add-failed">
            <p>
              {doneItems.length ? `Se ${doneItems.length === 1 ? 'subió' : 'subieron'} ${describe(donePhotos, doneVideos)}, pero ${n - doneItems.length === 1 ? 'falta 1' : `faltan ${n - doneItems.length}`}.` : 'No se pudieron subir.'}
              {' '}Revisa tu conexión a internet e inténtalo otra vez.
            </p>
          </div>
        ) : (
          <label className="who-field">
            <span>Tu nombre <small>(opcional)</small></span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Tía Rosa" maxLength={LIMITS.author} autoComplete="name" data-testid="add-name" />
          </label>
        )}

        <div className="add-actions">
          {phase === 'failed' ? (
            <button className="btn primary huge" onClick={upload} data-testid="add-retry"><RotateCcw /> Intentar otra vez</button>
          ) : (
            <button className="btn primary huge" onClick={upload} disabled={phase !== 'ready' || !n} data-testid="add-publish">
              {phase === 'uploading' ? <><Loader2 className="spin" /> Subiendo…</> : phase === 'preparing' ? 'Preparando…' : n ? `Agregar ${describe(photosN, videosN)} al álbum` : 'Elige al menos una foto o video'}
            </button>
          )}
          <button className="btn ghost" onClick={() => onClose(firstNew)} disabled={locked}>
            {phase === 'failed' && doneItems.length ? 'Cerrar' : 'Cancelar'}
          </button>
        </div>
      </div>
    </div>
  );
}
