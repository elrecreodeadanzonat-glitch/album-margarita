import { useSyncExternalStore } from 'react';
import {
  moveInOrder,
  type AlbumApi, type AlbumMeta, type CloudComment, type CloudOrder, type CloudPhoto, type NewCloudPhoto,
  type NewCloudVideo, type PhotoChange,
} from './cloud';
import type { Photo } from './types';

export interface LocalComment extends CloudComment {
  /** sent from this device, waiting for the server */
  status?: 'sending' | 'failed';
}

export interface CloudState {
  /** the first load finished (well or not) */
  ready: boolean;
  /** the photos and the shared order have been read from the server at least once */
  loaded: boolean;
  /** the last request reached the server */
  online: boolean;
  /** the album's name and texts (null until they arrive) */
  meta: AlbumMeta | null;
  /** everything, hidden ones included, oldest first */
  photos: CloudPhoto[];
  comments: LocalComment[];
  /** full-size data: URLs loaded so far (for videos: the still shown before playing) */
  images: Record<string, string>;
  /** images that could not be loaded (the thumbnail is shown instead) */
  imageErrors: Record<string, true>;
  /** videos ready to play (object URLs), and how far along the ones on their way are (0..1) */
  videos: Record<string, string>;
  videoProgress: Record<string, number>;
  videoErrors: Record<string, true>;
  /** how someone last arranged the pages (null: in the order they were added) */
  order: CloudOrder | null;
}

const POLL_MS = 20_000;
/** videos kept in memory at once (each one a few MB) */
const VIDEO_CACHE = 4;

function mergeById<T extends { id: string; createdAt: string }>(cur: T[], incoming: T[]): T[] {
  if (!incoming.length) return cur;
  const map = new Map(cur.map((x) => [x.id, x]));
  for (const x of incoming) map.set(x.id, x);
  return [...map.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/**
 * The album in memory. One instance per open album:
 * loads everything once, then asks every 20 s (while the page is visible) only for what is new.
 */
export class CloudStore {
  readonly api: AlbumApi;
  private state: CloudState = {
    ready: false, loaded: false, online: true, meta: null, photos: [], comments: [], images: {}, imageErrors: {},
    videos: {}, videoProgress: {}, videoErrors: {}, order: null,
  };
  /** arrangements made here that are still being saved: meanwhile the server cannot replace ours */
  private savingOrder = 0;
  /** the newest arrangement started here; an older save that finishes late must not win */
  private orderSeq = 0;
  /** saves leave one at a time, in the order people made them, so the server's newest is the last one made */
  private orderQueue: Promise<unknown> = Promise.resolve();
  /** the last arrangement the server is known to have (to go back to if saving fails) */
  private confirmedOrder: CloudOrder | null = null;
  private gotPhotos = false;
  private gotOrder = false;
  private subs = new Set<() => void>();
  private timer: number | undefined;
  private started = false;
  private inflight: Promise<void> | null = null;
  private imageLoads = new Map<string, Promise<string>>();
  private videoLoads = new Map<string, Promise<string>>();
  private videoLru: string[] = [];
  /** cursors come only from server listings, so a comment written here never hides one written elsewhere just before */
  private cursor: { photos?: string; comments?: string } = {};

  constructor(api: AlbumApi) {
    this.api = api;
  }

  getState = (): CloudState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };

  private set(patch: Partial<CloudState>) {
    this.state = { ...this.state, ...patch };
    this.subs.forEach((fn) => fn());
  }

  start(): void {
    if (this.started || typeof document === 'undefined') return;
    this.started = true;
    void this.refresh();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.schedule();
  }

  stop(): void {
    this.started = false;
    window.clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const url of Object.values(this.state.videos)) URL.revokeObjectURL(url);
  }

  private onVisibility = () => {
    if (document.visibilityState === 'visible') {
      void this.refresh();
      this.schedule();
    }
  };

  private schedule() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (!this.started) return;
      if (document.visibilityState === 'visible') void this.refresh();
      this.schedule();
    }, POLL_MS);
  }

  /** load what is new since the last listing (everything the first time); each part on its own */
  refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      const [meta, photos, comments, order] = await Promise.allSettled([
        this.api.fetchMeta(),
        this.api.fetchPhotos(this.cursor.photos),
        this.api.fetchComments(this.cursor.comments),
        this.api.fetchLatestOrder(),
      ]);
      const patch: Partial<CloudState> = { ready: true };
      if (meta.status === 'fulfilled') patch.meta = meta.value;
      if (photos.status === 'fulfilled') {
        if (photos.value.length) this.cursor.photos = photos.value[photos.value.length - 1].createdAt;
        patch.photos = mergeById(this.state.photos, photos.value);
        this.gotPhotos = true;
      }
      if (comments.status === 'fulfilled') {
        if (comments.value.length) this.cursor.comments = comments.value[comments.value.length - 1].createdAt;
        patch.comments = mergeById(this.state.comments, comments.value);
      }
      if (order.status === 'fulfilled') {
        this.gotOrder = true;
        if (this.acceptsOrder(order.value)) {
          patch.order = order.value;
          this.confirmedOrder = order.value;
        }
      }
      patch.online = [meta, photos, comments, order].every((r) => r.status === 'fulfilled');
      patch.loaded = this.gotPhotos && this.gotOrder;
      this.set(patch);
      this.inflight = null;
    })();
    return this.inflight;
  }

  /** a listing never replaces an arrangement being saved here, nor a newer one we already have */
  private acceptsOrder(o: CloudOrder | null): boolean {
    const cur = this.state.order;
    if (this.savingOrder > 0) return false;
    if (!o) return false; // arrangements are never deleted, so «none» just means the listing is behind
    if (!cur || cur.id.startsWith('local-')) return true; // never let an unsaved local copy hide the server's
    if (o.id === cur.id) return false;
    return Date.parse(o.createdAt) >= Date.parse(cur.createdAt);
  }

  loadImage(id: string): Promise<string> {
    const have = this.state.images[id];
    if (have) return Promise.resolve(have);
    let p = this.imageLoads.get(id);
    if (!p) {
      p = this.api.fetchPhotoImage(id)
        .then((data) => {
          this.set({ images: { ...this.state.images, [id]: data } });
          return data;
        })
        .catch((e: unknown) => {
          this.set({ imageErrors: { ...this.state.imageErrors, [id]: true } });
          throw e;
        })
        .finally(() => this.imageLoads.delete(id));
      this.imageLoads.set(id, p);
    }
    return p;
  }

  /** a video ready to play (object URL); only the last few are kept in memory */
  loadVideo(id: string): Promise<string> {
    const have = this.state.videos[id];
    if (have) {
      this.videoLru = [...this.videoLru.filter((x) => x !== id), id];
      return Promise.resolve(have);
    }
    const photo = this.state.photos.find((p) => p.id === id);
    if (!photo?.video) return Promise.reject(new Error('No es un video'));
    let p = this.videoLoads.get(id);
    if (!p) {
      const { [id]: _failed, ...videoErrors } = this.state.videoErrors;
      void _failed;
      this.set({ videoErrors, videoProgress: { ...this.state.videoProgress, [id]: 0 } });
      p = this.api.fetchVideo(photo, (f) => this.set({ videoProgress: { ...this.state.videoProgress, [id]: f } }))
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          this.videoLru = [...this.videoLru.filter((x) => x !== id), id];
          const videos = { ...this.state.videos, [id]: url };
          while (this.videoLru.length > VIDEO_CACHE) {
            const old = this.videoLru.shift()!;
            URL.revokeObjectURL(videos[old]);
            delete videos[old];
          }
          this.set({ videos });
          return url;
        })
        .catch((e: unknown) => {
          this.set({ videoErrors: { ...this.state.videoErrors, [id]: true } });
          throw e;
        })
        .finally(() => this.videoLoads.delete(id));
      this.videoLoads.set(id, p);
    }
    return p;
  }

  /** shows the comment right away; marks it «failed» (retryable) if the server does not take it */
  async addComment(photoId: string, text: string, author: string, retryId?: string): Promise<void> {
    const tempId = retryId ?? `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const temp: LocalComment = { id: tempId, photoId, text: text.trim(), author: author.trim(), createdAt: new Date().toISOString(), hidden: false, status: 'sending' };
    this.set({ comments: [...this.state.comments.filter((c) => c.id !== tempId), temp] });
    try {
      const saved = await this.api.addComment({ photoId, text, author });
      this.set({ online: true, comments: mergeById(this.state.comments.filter((c) => c.id !== tempId), [saved]) });
    } catch (e) {
      this.set({ comments: this.state.comments.map((c) => (c.id === tempId ? { ...c, status: 'failed' } : c)) });
      throw e;
    }
  }

  async addPhoto(p: NewCloudPhoto): Promise<CloudPhoto> {
    const saved = await this.api.addPhoto(p);
    this.set({
      online: true,
      photos: mergeById(this.state.photos, [saved]),
      images: { ...this.state.images, [saved.id]: p.image },
    });
    return saved;
  }

  async addVideo(v: NewCloudVideo, onProgress?: (f: number) => void): Promise<CloudPhoto> {
    const saved = await this.api.addVideo(v, onProgress);
    const url = URL.createObjectURL(v.blob);
    this.videoLru = [...this.videoLru, saved.id];
    this.set({
      online: true,
      photos: mergeById(this.state.photos, [saved]),
      images: { ...this.state.images, [saved.id]: v.image },
      videos: { ...this.state.videos, [saved.id]: url },
    });
    return saved;
  }

  /** rotate, hide or bring back a photo or video */
  async updatePhoto(id: string, change: PhotoChange): Promise<void> {
    await this.api.updatePhoto(id, change);
    this.set({ photos: this.state.photos.map((p) => (p.id === id ? { ...p, ...change } : p)) });
  }

  async updateComment(id: string, change: { hidden: boolean }): Promise<void> {
    await this.api.updateComment(id, change);
    this.set({ comments: this.state.comments.map((c) => (c.id === id ? { ...c, ...change } : c)) });
  }

  async updateMeta(meta: AlbumMeta): Promise<void> {
    await this.api.updateMeta(meta);
    this.set({ meta });
  }

  /** everyone sees the new arrangement right away; on failure the previous one comes back */
  async saveOrder(ids: string[], author = ''): Promise<void> {
    const seq = ++this.orderSeq;
    if (this.savingOrder === 0) this.confirmedOrder = this.state.order?.id.startsWith('local-') ? this.confirmedOrder : this.state.order;
    this.savingOrder++;
    this.set({ order: { id: `local-${seq}`, ids, author, createdAt: new Date().toISOString() } });
    const run = this.orderQueue.then(async () => {
      // a newer arrangement is already waiting (it includes this one's move): skip this obsolete save
      if (seq !== this.orderSeq) return;
      const saved = await this.api.saveOrder(ids, author);
      this.confirmedOrder = saved;
      if (seq === this.orderSeq) this.set({ online: true, order: saved });
    });
    this.orderQueue = run.catch(() => undefined);
    try {
      await run;
    } catch (e) {
      // only the newest one decides; it goes back to what the server really has
      if (seq === this.orderSeq) {
        this.set({ order: this.confirmedOrder });
        throw e;
      }
    } finally {
      this.savingOrder--;
    }
  }

  /**
   * Someone dragged a thumbnail: move that page in the shared arrangement (pages this device does not
   * show keep their places). Returns the arrangement before the move, for «Deshacer».
   */
  move(shown: string[], from: number, to: number, author = ''): { before: string[]; done: Promise<void> } {
    const base = this.state.order?.ids ?? [];
    const before = base.length ? base : shown;
    return { before, done: this.saveOrder(moveInOrder(base, shown, from, to), author) };
  }
}

const NO_SUBSCRIBE = () => () => undefined;
const NO_STATE = () => null;

export function useCloudState(store: CloudStore | undefined): CloudState | null {
  return useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIBE, store?.getState ?? NO_STATE);
}

/** a photo or video of the album as a page of the book */
export function cloudPhotoAsPage(c: CloudPhoto, s: Pick<CloudState, 'images' | 'imageErrors'>, order: number): Photo {
  const image = s.images[c.id];
  const who = c.author || 'la familia';
  return {
    id: c.id,
    order,
    src: image ?? c.thumb,
    thumb: c.thumb,
    width: c.width,
    height: c.height,
    color: c.color,
    originalFilename: '',
    caption: c.caption,
    alt: c.kind === 'video' ? `Video compartido por ${who}` : `Foto compartida por ${who}`,
    fitMode: 'contain',
    rotation: c.rotation,
    focalPoint: { x: 0.5, y: 0.5 },
    hidden: c.hidden,
    createdAt: c.createdAt,
    addedBy: c.author || 'la familia',
    pending: !image && !s.imageErrors[c.id],
    ...(c.video ? { kind: 'video' as const, video: c.video } : { kind: 'photo' as const }),
  };
}

/** visible comments grouped by photo, oldest first */
export function commentsByPhoto(comments: LocalComment[], includeHidden = false): Map<string, LocalComment[]> {
  const m = new Map<string, LocalComment[]>();
  for (const c of comments) {
    if (c.hidden && !includeHidden) continue;
    const list = m.get(c.photoId);
    if (list) list.push(c);
    else m.set(c.photoId, [c]);
  }
  return m;
}
