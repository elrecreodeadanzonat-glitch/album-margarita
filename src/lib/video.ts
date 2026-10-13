import { stills, type CloudImage } from './images';
import type { VideoMime } from './cloud';

/**
 * Short videos for the album. A phone video is far too heavy to keep as it is, so it is replayed once
 * in the background (real time: a 40 s video takes about 40 s) and recorded again smaller, sound included.
 * Small mp4 files (WhatsApp ones, for example) are kept as they are, with no wait at all.
 */
export const VIDEO = {
  /** longer videos keep their first minute */
  maxSeconds: 60,
  keepMaxBytes: 7_500_000,
  /** about what one re-recorded minute weighs */
  targetBytes: 7_000_000,
  maxBytes: 12_000_000,
  maxSide: 854,
  audioBps: 96_000,
} as const;

export const isVideoFile = (f: File) => f.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|3gp|mkv|avi)$/i.test(f.name);

export interface VideoProbe extends CloudImage {
  /** of the original file, in seconds */
  duration: number;
  videoWidth: number;
  videoHeight: number;
  /** small enough and in a format every phone plays: kept as it is */
  keep: boolean;
}

function waitFor(el: HTMLMediaElement, event: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (ok: boolean) => {
      window.clearTimeout(t);
      el.removeEventListener(event, onOk);
      el.removeEventListener('error', onErr);
      if (ok) resolve();
      else reject(new Error(`video: ${event}`));
    };
    const onOk = () => done(true);
    const onErr = () => done(false);
    const t = window.setTimeout(() => done(false), ms);
    el.addEventListener(event, onOk);
    el.addEventListener('error', onErr);
  });
}

/** some recordings do not say how long they are until you look at their end */
async function realDuration(v: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(v.duration) && v.duration > 0) return v.duration;
  v.currentTime = 1e7;
  await waitFor(v, 'seeked', 8000).catch(() => undefined);
  const d = v.duration;
  return Number.isFinite(d) && d > 0 ? d : v.currentTime || 1;
}

/** what the album shows of a video before it plays: a still of it, its size and length */
export async function probeVideo(file: File): Promise<VideoProbe> {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  try {
    await waitFor(v, 'loadeddata', 30_000);
    if (!v.videoWidth || !v.videoHeight) throw new Error('sin imagen');
    const duration = await realDuration(v);
    v.currentTime = Math.min(0.6, duration / 3);
    await waitFor(v, 'seeked', 10_000);
    const still = await stills(v, v.videoWidth, v.videoHeight, file.name);
    const keep = file.type === 'video/mp4' && file.size <= VIDEO.keepMaxBytes && duration <= VIDEO.maxSeconds + 0.5;
    return { ...still, duration, videoWidth: v.videoWidth, videoHeight: v.videoHeight, keep };
  } catch {
    throw new Error(`No se pudo abrir el video «${file.name}» en este aparato. Prueba con otro video.`);
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

/** the best format this browser can record in (mp4 plays everywhere; webm where mp4 is not possible) */
export function recorderFormat(): { mime: string; type: VideoMime } | null {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null;
  for (const mime of [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, type: mime.startsWith('video/mp4') ? 'video/mp4' : 'video/webm' };
  }
  return null;
}

/**
 * A video ready to be re-recorded with its sound. Create it INSIDE the tap on «Agregar»: phones only let
 * a video play with sound if that started from a tap. Its sound goes into the recording, never to the speaker.
 */
export interface VideoPipe {
  el: HTMLVideoElement;
  sound: MediaStreamAudioDestinationNode | null;
  url: string;
}

export function openPipe(file: File, ctx: AudioContext | null): VideoPipe {
  const url = URL.createObjectURL(file);
  const el = document.createElement('video');
  el.playsInline = true;
  el.preload = 'auto';
  el.src = url;
  let sound: MediaStreamAudioDestinationNode | null = null;
  if (ctx) {
    try {
      sound = ctx.createMediaStreamDestination();
      ctx.createMediaElementSource(el).connect(sound);
    } catch {
      sound = null;
    }
  }
  if (!sound) el.muted = true;
  el.play().then(() => el.pause()).catch(() => undefined);
  return { el, sound, url };
}

export function closePipe(p: VideoPipe): void {
  p.el.pause();
  p.el.removeAttribute('src');
  p.el.load();
  URL.revokeObjectURL(p.url);
}

export interface PreparedVideo {
  blob: Blob;
  mime: VideoMime;
  width: number;
  height: number;
  duration: number;
}

/** record the video again, smaller (≤ 854 px, about 1 Mbit/s), at most its first minute; `onProgress` 0..1 */
export async function rerecord(pipe: VideoPipe, probe: VideoProbe, onProgress: (f: number) => void): Promise<PreparedVideo> {
  const format = recorderFormat();
  if (!format) throw new Error('Este navegador no puede preparar videos. Prueba desde Chrome o desde el celular.');
  const { el } = pipe;
  if (el.readyState < 2) await waitFor(el, 'loadeddata', 30_000);
  const limit = Math.min(probe.duration, VIDEO.maxSeconds);
  const scale = Math.min(1, VIDEO.maxSide / Math.max(probe.videoWidth, probe.videoHeight));
  const w = Math.max(2, Math.round((probe.videoWidth * scale) / 2) * 2);
  const h = Math.max(2, Math.round((probe.videoHeight * scale) / 2) * 2);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  const stream = canvas.captureStream(30);
  pipe.sound?.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const videoBitsPerSecond = Math.round(Math.min(1_200_000, Math.max(350_000, (VIDEO.targetBytes * 8) / limit - VIDEO.audioBps)));
  const rec = new MediaRecorder(stream, { mimeType: format.mime, videoBitsPerSecond, audioBitsPerSecond: VIDEO.audioBps });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) parts.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    rec.onstop = () => resolve();
  });

  if (el.currentTime > 0) {
    el.currentTime = 0;
    await waitFor(el, 'seeked', 10_000).catch(() => undefined);
  }

  let finished = false;
  let lastTime = -1;
  let lastMove = performance.now();
  const finish = () => {
    if (finished) return;
    finished = true;
    el.pause();
    if (rec.state !== 'inactive') rec.stop();
  };
  const draw = () => {
    if (finished) return;
    g.drawImage(el, 0, 0, w, h);
    onProgress(Math.min(1, el.currentTime / limit));
    if (el.ended || el.currentTime >= limit - 0.04) {
      finish();
      return;
    }
    next();
  };
  const next = () => {
    if ('requestVideoFrameCallback' in el) el.requestVideoFrameCallback(draw);
    else requestAnimationFrame(draw);
  };
  // phones stop drawing while the screen is off or another app is in front: wait instead of recording a frozen picture
  const onVisibility = () => {
    if (finished) return;
    if (document.hidden) {
      el.pause();
      if (rec.state === 'recording') rec.pause();
    } else {
      if (rec.state === 'paused') rec.resume();
      void el.play().catch(() => undefined);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  el.addEventListener('ended', finish);
  // nothing moves for a long while (a broken file): stop with what we have
  const stall = window.setInterval(() => {
    if (document.hidden || finished) return;
    if (el.currentTime !== lastTime) {
      lastTime = el.currentTime;
      lastMove = performance.now();
    } else if (performance.now() - lastMove > 15_000) finish();
  }, 1000);

  try {
    rec.start(500);
    g.drawImage(el, 0, 0, w, h);
    try {
      await el.play();
    } catch {
      // the phone refused to play it with sound: keep the pictures at least
      el.muted = true;
      await el.play();
    }
    next();
    await stopped;
  } finally {
    window.clearInterval(stall);
    document.removeEventListener('visibilitychange', onVisibility);
    el.removeEventListener('ended', finish);
    stream.getTracks().forEach((t) => t.stop());
  }
  const blob = new Blob(parts, { type: format.type });
  if (!blob.size) throw new Error('No se pudo preparar el video. Inténtalo otra vez.');
  if (blob.size > VIDEO.maxBytes) throw new Error('El video quedó muy pesado. Prueba con uno más corto.');
  onProgress(1);
  return { blob, mime: format.type, width: w, height: h, duration: Math.min(limit, el.currentTime || limit) };
}

/** «0:42» */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
