import { FIREBASE, VAULT } from '../config';
import type { Rotation } from './types';

/**
 * Tiny Firestore REST client for the album.
 *
 * Privacy: everything lives under albums/{albumKey}, a long random key nobody can list or guess. The password
 * only unlocks that key: it is turned into a long code (PBKDF2, in the browser) that names a «lock» document,
 * vault/{code} → { albumKey }. firestore.rules decides what is allowed; the API key is public by design.
 */

export interface CloudPhoto {
  id: string;
  kind: 'photo' | 'video';
  createdAt: string;
  author: string;
  caption: string;
  width: number;
  height: number;
  color: string;
  /** small data: URL (≈ 320 px); for a video, a still of it */
  thumb: string;
  rotation: Rotation;
  hidden: boolean;
  /** videos only */
  video?: { duration: number; chunks: number; mime: VideoMime };
}

export type VideoMime = 'video/mp4' | 'video/webm';

/** the order of the pages, as last arranged by someone (history is kept: every change is a new document) */
export interface CloudOrder {
  id: string;
  ids: string[];
  author: string;
  createdAt: string;
}

export interface CloudComment {
  id: string;
  photoId: string;
  text: string;
  author: string;
  createdAt: string;
  hidden: boolean;
}

export interface AlbumMeta {
  title: string;
  intro: string;
  outro: string;
}

export class CloudError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CloudError';
    this.status = status;
  }
}

export const LIMITS = {
  comment: 1000, author: 60, caption: 300, image: 1_000_000, thumb: 60_000,
  title: 80, text: 300, chunk: 950_000, maxChunks: 40,
} as const;

const ROOT = `projects/${FIREBASE.projectId}/databases/(default)/documents`;
const API = `https://firestore.googleapis.com/v1/${ROOT}`;

type Value =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { bytesValue: string }
  | { arrayValue: { values?: Value[] } }
  | { nullValue: null };
type Fields = Record<string, Value>;
interface Doc { name: string; fields?: Fields }
interface Write {
  update: Doc;
  currentDocument?: { exists: boolean };
  updateMask?: { fieldPaths: string[] };
  updateTransforms?: { fieldPath: string; setToServerValue: 'REQUEST_TIME' }[];
}
type Plain = string | number | boolean | string[] | null;
type Input = string | number | boolean | string[] | { bytes: string };

export function encodeFields(obj: Record<string, Input>): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) out[k] = { arrayValue: { values: v.map((s) => ({ stringValue: s })) } };
    else if (typeof v === 'object') out[k] = { bytesValue: v.bytes };
    else if (typeof v === 'string') out[k] = { stringValue: v };
    else if (typeof v === 'boolean') out[k] = { booleanValue: v };
    else if (Number.isInteger(v)) out[k] = { integerValue: String(v) };
    else out[k] = { doubleValue: v };
  }
  return out;
}

export function decodeFields(fields: Fields = {}): Record<string, Plain> {
  const out: Record<string, Plain> = {};
  for (const [k, v] of Object.entries(fields)) {
    if ('stringValue' in v) out[k] = v.stringValue;
    else if ('integerValue' in v) out[k] = Number(v.integerValue);
    else if ('doubleValue' in v) out[k] = v.doubleValue;
    else if ('booleanValue' in v) out[k] = v.booleanValue;
    else if ('timestampValue' in v) out[k] = v.timestampValue;
    else if ('bytesValue' in v) out[k] = v.bytesValue;
    else if ('arrayValue' in v) out[k] = (v.arrayValue.values ?? []).flatMap((x) => ('stringValue' in x ? [x.stringValue] : []));
    else out[k] = null;
  }
  return out;
}

const str = (v: Plain | undefined, fallback = '') => (typeof v === 'string' ? v : fallback);
const num = (v: Plain | undefined, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const idOf = (name: string) => name.slice(name.lastIndexOf('/') + 1);

/** only raster images we produced ourselves are ever put into an <img> */
export const isImageDataUrl = (s: string) => /^data:image\/(webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s);

export function toCloudPhoto(doc: Doc): CloudPhoto | null {
  const d = decodeFields(doc.fields);
  const thumb = str(d.thumb);
  if (!isImageDataUrl(thumb)) return null;
  const rot = num(d.rotation);
  const color = str(d.color);
  const kind = d.kind === 'video' ? 'video' : 'photo';
  const mime = d.mime === 'video/webm' ? 'video/webm' : 'video/mp4';
  const chunks = Math.round(num(d.chunks));
  if (kind === 'video' && (chunks < 1 || chunks > LIMITS.maxChunks)) return null;
  return {
    id: idOf(doc.name),
    kind,
    createdAt: str(d.createdAt),
    author: str(d.author).slice(0, LIMITS.author),
    caption: str(d.caption).slice(0, LIMITS.caption),
    width: Math.max(1, num(d.width, 1)),
    height: Math.max(1, num(d.height, 1)),
    color: /^#[0-9a-f]{6}$/.test(color) ? color : '#8a6f5c',
    thumb,
    rotation: ([0, 90, 180, 270].includes(rot) ? rot : 0) as Rotation,
    hidden: d.hidden === true,
    ...(kind === 'video' ? { video: { duration: Math.max(0, num(d.duration)), chunks, mime } } : {}),
  };
}

export function toCloudComment(doc: Doc): CloudComment | null {
  const d = decodeFields(doc.fields);
  const text = str(d.text);
  if (!text) return null;
  return {
    id: idOf(doc.name),
    photoId: str(d.photoId),
    text: text.slice(0, LIMITS.comment),
    author: str(d.author).slice(0, LIMITS.author),
    createdAt: str(d.createdAt),
    hidden: d.hidden === true,
  };
}

export function newId(prefix: 'c' | 'k' | 'o' | 'a', length = 20): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (x) => '0123456789abcdefghijklmnopqrstuvwxyz'[x % 36]).join('');
}

async function request<T>(path: string, init?: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown }): Promise<T> {
  const method = init?.method ?? (init?.body === undefined ? 'GET' : 'POST');
  let res: Response;
  try {
    res = await fetch(`${API}${path}?key=${FIREBASE.apiKey}`, {
      method,
      cache: 'no-store',
      ...(init?.body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }),
    });
  } catch {
    throw new CloudError('Sin conexión a internet', 0);
  }
  if (!res.ok) {
    let message = `Error ${res.status}`;
    try {
      message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      /* not JSON */
    }
    throw new CloudError(message, res.status);
  }
  return (await res.json()) as T;
}

const created = (path: string, fields: Record<string, Input>): Write => ({
  update: { name: `${ROOT}/${path}`, fields: encodeFields(fields) },
  currentDocument: { exists: false },
  updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
});

const changed = (path: string, change: Record<string, Input>): Write => ({
  update: { name: `${ROOT}/${path}`, fields: encodeFields(change) },
  updateMask: { fieldPaths: Object.keys(change) },
  currentDocument: { exists: true },
});

interface CommitResult { commitTime: string; writeResults?: { transformResults?: Value[] }[] }

async function commit(writes: Write[]): Promise<CommitResult> {
  return request<CommitResult>(':commit', { body: { writes } });
}

const createdAtOf = (r: CommitResult, i = 0) => {
  const v = r.writeResults?.[i]?.transformResults?.[0];
  return v && 'timestampValue' in v ? v.timestampValue : r.commitTime;
};

// ---------------------------------------------------------------- the password and the album's lock

/** how the password is typed does not matter: capitals, accents and spaces are ignored */
export const normalizePassword = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '');

export const MIN_PASSWORD = 6;

/** the long code (64 hex characters) that a password turns into; the same everywhere, never sent as is */
export async function lockCode(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(normalizePassword(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(VAULT.salt), iterations: VAULT.iterations },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** the album key behind a lock, or null when that password does not open anything */
export async function openLock(code: string): Promise<string | null> {
  try {
    const doc = await request<Doc>(`/vault/${code}`);
    return str(decodeFields(doc.fields).albumKey) || null;
  } catch (e) {
    if (e instanceof CloudError && (e.status === 404 || e.status === 403)) return null;
    throw e;
  }
}

/**
 * Change the password: a new lock for the same album, then the old one goes away
 * (devices still using the old one are asked for the new password next time).
 */
export async function replaceLock(albumKey: string, oldCode: string, newCode: string): Promise<void> {
  try {
    await commit([created(`vault/${newCode}`, { albumKey })]);
  } catch (e) {
    // that lock already exists (same new password typed twice): fine if it opens this album
    if (!(e instanceof CloudError && e.status === 409) || (await openLock(newCode)) !== albumKey) throw e;
  }
  if (oldCode !== newCode) await request(`/vault/${oldCode}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------- one album

export interface NewCloudPhoto {
  image: string;
  thumb: string;
  width: number;
  height: number;
  color: string;
  author: string;
}

export interface NewCloudVideo extends NewCloudPhoto {
  /** the video file to keep (mp4 or webm) */
  blob: Blob;
  mime: VideoMime;
  duration: number;
}

export type PhotoChange = { hidden: boolean } | { rotation: Rotation } | { caption: string };

/** the order travels as one text: «c…,c…» (the rules can check it whole: size and characters) */
export const MAX_ORDER_CHARS = 60_000;
const PAGE_ID = /^[A-Za-z0-9_-]{1,48}$/;

function toOrder(doc: Doc): CloudOrder {
  const d = decodeFields(doc.fields);
  const raw = typeof d.ids === 'string' ? d.ids.split(',') : Array.isArray(d.ids) ? d.ids : [];
  const ids = [...new Set(raw.filter((x) => PAGE_ID.test(x)))];
  return { id: idOf(doc.name), ids, author: str(d.author), createdAt: str(d.createdAt) };
}

/** base64 of a slice of a file, without its «data:…;base64,» prefix */
function sliceToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error ?? new Error('No se pudo leer el video'));
    r.readAsDataURL(blob);
  });
}

async function base64ToBytes(b64: string): Promise<ArrayBuffer> {
  return (await fetch(`data:application/octet-stream;base64,${b64}`)).arrayBuffer();
}

/** in how many pieces a video is kept (each one fits in one database document) */
export const chunkCount = (bytes: number) => Math.max(1, Math.ceil(bytes / LIMITS.chunk));

/** Everything about one album; its key is the only way in. */
export function albumApi(albumKey: string) {
  const base = `albums/${albumKey}`;

  /** every document of a collection created after `after` (oldest first), page by page */
  async function queryAfter(collectionId: string, after: string | undefined, pageSize: number): Promise<Doc[]> {
    const out: Doc[] = [];
    let cursor = after;
    for (let page = 0; page < 50; page++) {
      const rows = await request<{ document?: Doc }[]>(`/${base}:runQuery`, {
        body: {
          structuredQuery: {
            from: [{ collectionId }],
            ...(cursor
              ? { where: { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN', value: { timestampValue: cursor } } } }
              : {}),
            orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }],
            limit: pageSize,
          },
        },
      });
      const docs = rows.flatMap((r) => (r.document ? [r.document] : []));
      out.push(...docs);
      if (docs.length < pageSize) break;
      cursor = str(decodeFields(docs[docs.length - 1].fields).createdAt);
    }
    return out;
  }

  async function fetchOrders(limit: number): Promise<CloudOrder[]> {
    const rows = await request<{ document?: Doc }[]>(`/${base}:runQuery`, {
      body: {
        structuredQuery: {
          from: [{ collectionId: 'orders' }],
          orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
          limit,
        },
      },
    });
    return rows.flatMap((r) => (r.document ? [toOrder(r.document)] : [])).filter((o) => o.ids.length > 0);
  }

  return {
    albumKey,

    async fetchMeta(): Promise<AlbumMeta> {
      const d = decodeFields((await request<Doc>(`/${base}`)).fields);
      return { title: str(d.title), intro: str(d.intro), outro: str(d.outro) };
    },

    async updateMeta(meta: AlbumMeta): Promise<void> {
      await commit([changed(base, {
        title: meta.title.trim().slice(0, LIMITS.title),
        intro: meta.intro.trim().slice(0, LIMITS.text),
        outro: meta.outro.trim().slice(0, LIMITS.text),
      })]);
    },

    async fetchPhotos(after?: string): Promise<CloudPhoto[]> {
      return (await queryAfter('photos', after, 60)).flatMap((d) => toCloudPhoto(d) ?? []);
    },

    async fetchComments(after?: string): Promise<CloudComment[]> {
      return (await queryAfter('comments', after, 300)).flatMap((d) => toCloudComment(d) ?? []);
    },

    async fetchPhotoImage(id: string): Promise<string> {
      const doc = await request<Doc>(`/${base}/photoImages/${encodeURIComponent(id)}`);
      const data = str(decodeFields(doc.fields).data);
      if (!isImageDataUrl(data)) throw new CloudError('Imagen no válida', 422);
      return data;
    },

    /** the whole video file, piece by piece (`onProgress` 0..1) */
    async fetchVideo(p: CloudPhoto, onProgress?: (f: number) => void): Promise<Blob> {
      if (!p.video) throw new CloudError('No es un video', 422);
      const { chunks, mime } = p.video;
      const parts: ArrayBuffer[] = new Array(chunks);
      let done = 0;
      let next = 0;
      const worker = async () => {
        while (next < chunks) {
          const n = next++;
          const doc = await request<Doc>(`/${base}/videoChunks/${p.id}_${n}`);
          parts[n] = await base64ToBytes(str(decodeFields(doc.fields).data));
          onProgress?.(++done / chunks);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      return new Blob(parts, { type: mime });
    },

    async addComment(input: { photoId: string; text: string; author: string }): Promise<CloudComment> {
      const id = newId('k');
      const fields = {
        photoId: input.photoId,
        text: input.text.trim().slice(0, LIMITS.comment),
        author: input.author.trim().slice(0, LIMITS.author),
        hidden: false,
      };
      const res = await commit([created(`${base}/comments/${id}`, fields)]);
      return { id, ...fields, createdAt: createdAtOf(res) };
    },

    /** photo + its image in one commit (the rules require both together) */
    async addPhoto(p: NewCloudPhoto): Promise<CloudPhoto> {
      const id = newId('c');
      const fields = {
        kind: 'photo',
        width: Math.round(p.width),
        height: Math.round(p.height),
        color: p.color,
        thumb: p.thumb,
        author: p.author.trim().slice(0, LIMITS.author),
        caption: '',
        rotation: 0,
        hidden: false,
      };
      const res = await commit([created(`${base}/photos/${id}`, fields), created(`${base}/photoImages/${id}`, { data: p.image })]);
      return { ...fields, id, kind: 'photo', rotation: 0, createdAt: createdAtOf(res) };
    },

    /**
     * A video: its pieces first (one document each), then its page with a still of it — so the page only
     * appears once the whole video is there. `onProgress` goes 0..1.
     */
    async addVideo(v: NewCloudVideo, onProgress?: (f: number) => void): Promise<CloudPhoto> {
      const id = newId('c');
      const chunks = chunkCount(v.blob.size);
      if (chunks > LIMITS.maxChunks) throw new CloudError('El video es demasiado grande', 413);
      for (let n = 0; n < chunks; n++) {
        const bytes = await sliceToBase64(v.blob.slice(n * LIMITS.chunk, (n + 1) * LIMITS.chunk));
        await commit([created(`${base}/videoChunks/${id}_${n}`, { data: { bytes }, n })]);
        onProgress?.((n + 1) / (chunks + 1));
      }
      const duration = Math.round(v.duration * 10) / 10;
      const fields = {
        kind: 'video',
        width: Math.round(v.width),
        height: Math.round(v.height),
        color: v.color,
        thumb: v.thumb,
        author: v.author.trim().slice(0, LIMITS.author),
        caption: '',
        rotation: 0,
        hidden: false,
        duration: duration > 0 ? duration : 0.1,
        chunks,
        mime: v.mime,
      };
      const res = await commit([created(`${base}/photos/${id}`, fields), created(`${base}/photoImages/${id}`, { data: v.image })]);
      onProgress?.(1);
      return {
        ...fields,
        id,
        kind: 'video',
        rotation: 0,
        createdAt: createdAtOf(res),
        video: { duration: fields.duration, chunks, mime: v.mime },
      };
    },

    /** rotate, hide or bring back (nothing is ever deleted) */
    async updatePhoto(id: string, change: PhotoChange): Promise<void> {
      await commit([changed(`${base}/photos/${id}`, change)]);
    },

    async updateComment(id: string, change: { hidden: boolean }): Promise<void> {
      await commit([changed(`${base}/comments/${id}`, change)]);
    },

    fetchOrders,

    /** the most recent order of the album, or null if nobody has rearranged it yet */
    async fetchLatestOrder(): Promise<CloudOrder | null> {
      return (await fetchOrders(1))[0] ?? null;
    },

    /** a new arrangement of the pages (never overwrites: the previous ones stay as history) */
    async saveOrder(ids: string[], author: string): Promise<CloudOrder> {
      const clean = [...new Set(ids.filter((x) => PAGE_ID.test(x)))];
      let text = clean.join(',');
      if (text.length > MAX_ORDER_CHARS) text = text.slice(0, text.lastIndexOf(',', MAX_ORDER_CHARS));
      const id = newId('o');
      const who = author.trim().slice(0, LIMITS.author);
      const res = await commit([created(`${base}/orders/${id}`, { ids: text, author: who })]);
      return { id, ids: text.split(','), author: who, createdAt: createdAtOf(res) };
    },
  };
}

export type AlbumApi = ReturnType<typeof albumApi>;

/**
 * Someone dragged the page at `from` to `to` in the list they see (`shown`). Apply that move to the
 * shared arrangement (`base`) without disturbing pages this device does not show (added elsewhere,
 * hidden for now…): the moved page lands right before the page that follows it on screen.
 */
export function moveInOrder(base: string[], shown: string[], from: number, to: number): string[] {
  const moved = shown[from];
  if (moved === undefined || from === to) return base.length ? base : shown;
  const onScreen = [...shown];
  onScreen.splice(from, 1);
  onScreen.splice(to, 0, moved);
  const full = [...base.filter((id) => id !== moved), ...shown.filter((id) => id !== moved && !base.includes(id))];
  const next = onScreen[to + 1];
  const prev = onScreen[to - 1];
  let at = next !== undefined ? full.indexOf(next) : -1;
  if (at < 0) at = prev !== undefined ? full.indexOf(prev) + 1 : 0;
  full.splice(at, 0, moved);
  return full;
}

/**
 * Put pages in the saved order: those listed first (in that order), then any page the list
 * does not know yet (added later) in its natural order.
 */
export function applyOrder<T extends { id: string }>(pages: T[], ids: string[] | null | undefined): T[] {
  if (!ids?.length) return pages;
  const byId = new Map(pages.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (p && !seen.has(id)) {
      out.push(p);
      seen.add(id);
    }
  }
  for (const p of pages) if (!seen.has(p.id)) out.push(p);
  return out;
}
