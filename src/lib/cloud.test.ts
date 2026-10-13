import { afterEach, describe as group, expect, it, vi } from 'vitest';
import { pbkdf2Sync } from 'node:crypto';
import {
  albumApi, applyOrder, chunkCount, decodeFields, encodeFields, isImageDataUrl, lockCode, moveInOrder, normalizePassword,
  openLock, replaceLock, toCloudComment, toCloudPhoto, LIMITS,
} from './cloud';
import { CloudStore, cloudPhotoAsPage, commentsByPhoto } from './cloudStore';
import { timeAgo } from './timeAgo';
import { describe } from './words';
import { VAULT } from '../config';

const KEY = 'a' + 'x'.repeat(32);
const IMG = 'data:image/webp;base64,UklGRiQAAABXRUJQ';
const doc = (name: string, fields: Record<string, unknown>) => ({
  name: `projects/p/databases/(default)/documents/${name}`,
  fields: encodeFields(fields as Record<string, string | number | boolean>),
});

afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; method: string; body: unknown };
function mockFetch(handler: (url: string, body: unknown, method: string) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('data:')) return new Response(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body });
    const r = handler(url, body, method);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }));
  return calls;
}
const okCommit = (t = '2026-10-12T12:00:00Z') => ({ json: { commitTime: t, writeResults: [{ transformResults: [{ timestampValue: t }] }] } });
type Writes = { writes: { update: { name: string; fields: Record<string, unknown> }; updateMask?: { fieldPaths: string[] }; currentDocument?: unknown }[] };

group('Firestore values', () => {
  it('round-trips strings, numbers, booleans, lists and bytes', () => {
    const f = encodeFields({ a: 'x', b: 3, c: 1.5, d: true, e: ['p', 'q'], g: { bytes: 'AAEC' } });
    expect(f.g).toEqual({ bytesValue: 'AAEC' });
    expect(decodeFields(f)).toEqual({ a: 'x', b: 3, c: 1.5, d: true, e: ['p', 'q'], g: 'AAEC' });
  });

  it('only accepts raster data: URLs for images', () => {
    expect(isImageDataUrl(IMG)).toBe(true);
    expect(isImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isImageDataUrl('javascript:alert(1)')).toBe(false);
  });

  it('turns documents into photos, videos and comments, dropping bad ones', () => {
    const base = { thumb: IMG, width: 1600, height: 1200, color: '#aabbcc', author: 'Rosa', caption: '', rotation: 90, hidden: false, createdAt: 'T' };
    expect(toCloudPhoto(doc('albums/k/photos/c1', { ...base, kind: 'photo' }))).toMatchObject({ id: 'c1', kind: 'photo', rotation: 90 });
    const v = toCloudPhoto(doc('albums/k/photos/c2', { ...base, kind: 'video', duration: 12.5, chunks: 3, mime: 'video/webm' }))!;
    expect(v).toMatchObject({ kind: 'video', video: { duration: 12.5, chunks: 3, mime: 'video/webm' } });
    expect(toCloudPhoto(doc('albums/k/photos/c3', { ...base, kind: 'video', duration: 2, chunks: 0, mime: 'video/mp4' }))).toBeNull();
    expect(toCloudPhoto(doc('albums/k/photos/c4', { ...base, thumb: 'data:image/svg+xml;base64,AAAA' }))).toBeNull();
    expect(toCloudComment(doc('albums/k/comments/k1', { photoId: 'c1', text: 'Hola', author: 'Tío', hidden: false }))).toMatchObject({ id: 'k1', text: 'Hola' });
  });
});

group('the password', () => {
  it('capitals, accents and spaces do not matter', () => {
    expect(normalizePassword('  Clave De Prueba 12 ')).toBe('clavedeprueba12');
    expect(normalizePassword('ÑANDÚ  azúcar')).toBe('nanduazucar');
  });

  it('turns into the same long code here and in the owner tool (PBKDF2)', async () => {
    const code = await lockCode('Clave de Prueba 12');
    expect(code).toMatch(/^[0-9a-f]{64}$/);
    expect(code).toBe(pbkdf2Sync('clavedeprueba12', VAULT.salt, VAULT.iterations, 32, 'sha256').toString('hex'));
    expect(await lockCode('clavedePRUEBA12')).toBe(code);
    expect(await lockCode('clave de prueba 12!')).not.toBe(code);
  });

  it('a wrong password opens nothing; a right one gives the album key', async () => {
    mockFetch((url) => (url.includes('/vault/good') ? { json: doc('vault/good', { albumKey: KEY }) } : { status: 404, json: {} }));
    expect(await openLock('good')).toBe(KEY);
    expect(await openLock('bad')).toBeNull();
  });

  it('changing it makes a new lock first, then removes the old one', async () => {
    const calls = mockFetch((url, _b, method) => (method === 'DELETE' ? { json: {} } : okCommit()));
    await replaceLock(KEY, 'old', 'new');
    expect(calls.map((c) => c.method)).toEqual(['POST', 'DELETE']);
    const w = (calls[0].body as Writes).writes[0];
    expect(w.update.name).toMatch(/\/documents\/vault\/new$/);
    expect(w.update.fields).toEqual({ albumKey: { stringValue: KEY } });
    expect(calls[1].url).toMatch(/\/vault\/old\?key=/);
  });
});

group('one album', () => {
  it('everything goes under albums/{key}', async () => {
    const calls = mockFetch(() => okCommit());
    const api = albumApi(KEY);
    const c = await api.addComment({ photoId: 'c1', text: ' ¡Qué linda! ', author: ' Rosa ' });
    expect(c).toMatchObject({ photoId: 'c1', text: '¡Qué linda!', author: 'Rosa' });
    expect((calls[0].body as Writes).writes[0].update.name).toMatch(new RegExp(`/documents/albums/${KEY}/comments/k[a-z0-9]{20}$`));
    await api.updatePhoto('c1', { hidden: true });
    const w = (calls[1].body as Writes).writes[0];
    expect(w.update.name).toMatch(new RegExp(`/albums/${KEY}/photos/c1$`));
    expect(w.updateMask).toEqual({ fieldPaths: ['hidden'] });
  });

  it('reads its photos with a query on the album', async () => {
    const calls = mockFetch(() => ({ json: [{ readTime: 'x' }] }));
    await albumApi(KEY).fetchPhotos();
    expect(calls[0].url).toContain(`/documents/albums/${KEY}:runQuery?key=`);
  });

  it('a video goes in pieces first, then its page', async () => {
    const calls = mockFetch(() => okCommit());
    const blob = new Blob([new Uint8Array(LIMITS.chunk * 2 + 10)], { type: 'video/mp4' });
    expect(chunkCount(blob.size)).toBe(3);
    const progress: number[] = [];
    const v = await albumApi(KEY).addVideo({ image: IMG, thumb: IMG, width: 854, height: 480, color: '#112233', author: 'Ana', blob, mime: 'video/mp4', duration: 12.34 }, (f) => progress.push(f));
    expect(v).toMatchObject({ kind: 'video', video: { chunks: 3, duration: 12.3, mime: 'video/mp4' } });
    const names = calls.map((c) => (c.body as Writes).writes.map((w) => w.update.name.split(`/albums/${KEY}/`)[1]));
    expect(names.slice(0, 3).map((n) => n[0])).toEqual([`videoChunks/${v.id}_0`, `videoChunks/${v.id}_1`, `videoChunks/${v.id}_2`]);
    expect(names[3]).toEqual([`photos/${v.id}`, `photoImages/${v.id}`]);
    const chunk0 = (calls[0].body as Writes).writes[0].update.fields as { data: { bytesValue: string }; n: unknown };
    expect(Buffer.from(chunk0.data.bytesValue, 'base64').length).toBe(LIMITS.chunk);
    expect(progress.at(-1)).toBe(1);
  });

  it('a video comes back whole, from its pieces', async () => {
    const parts = [Buffer.from('hola '), Buffer.from('mundo')];
    mockFetch((url) => {
      const n = Number(url.match(/_(\d+)\?key/)![1]);
      return { json: { name: 'x', fields: { data: { bytesValue: parts[n].toString('base64') } } } };
    });
    const p = toCloudPhoto(doc('albums/k/photos/cv', { kind: 'video', thumb: IMG, width: 10, height: 10, color: '#000000', author: '', caption: '', rotation: 0, hidden: false, duration: 1, chunks: 2, mime: 'video/mp4', createdAt: 'T' }))!;
    const blob = await albumApi(KEY).fetchVideo(p);
    expect(blob.type).toBe('video/mp4');
    expect(await blob.text()).toBe('hola mundo');
  });

  it('an arrangement is saved as one text', async () => {
    const calls = mockFetch(() => okCommit());
    const o = await albumApi(KEY).saveOrder(['c2', 'c1', 'c2', 'mal id!'], 'Ana');
    expect(o.ids).toEqual(['c2', 'c1']);
    expect((calls[0].body as Writes).writes[0].update.fields.ids).toEqual({ stringValue: 'c2,c1' });
  });
});

group('order of the pages', () => {
  it('applies a saved order, pages it does not know go at the end', () => {
    const pages = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
    expect(applyOrder(pages, ['c', 'a']).map((p) => p.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(applyOrder(pages, null)).toBe(pages);
  });

  it('moving one page keeps the pages this device does not show in place', () => {
    expect(moveInOrder([], ['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveInOrder(['n1', 'a', 'h', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'], 0, 2)).toEqual(['n1', 'h', 'b', 'c', 'a', 'd']);
  });
});

group('CloudStore', () => {
  it('shows a comment at once and marks it failed (retryable) when offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const s = new CloudStore(albumApi(KEY));
    const p = s.addComment('c1', 'Hola', 'Ana');
    expect(s.getState().comments).toMatchObject([{ text: 'Hola', status: 'sending' }]);
    await expect(p).rejects.toBeTruthy();
    expect(s.getState().comments[0].status).toBe('failed');
  });

  it('loads the name, photos, comments and order; each part on its own', async () => {
    mockFetch((url, body) => {
      if (!url.includes(':runQuery')) return { json: doc(`albums/${KEY}`, { title: 'Álbum', intro: 'Hola', outro: 'Chao' }) };
      const col = (body as { structuredQuery: { from: { collectionId: string }[] } }).structuredQuery.from[0].collectionId;
      if (col === 'orders') return { status: 500, json: {} };
      return { json: [{ readTime: 'x' }] };
    });
    const s = new CloudStore(albumApi(KEY));
    await s.refresh();
    expect(s.getState()).toMatchObject({ ready: true, online: false, loaded: false, meta: { title: 'Álbum', intro: 'Hola' } });
  });

  it('saves leave one at a time; a stale one is skipped; failure goes back to the server order', async () => {
    let release: () => void = () => undefined;
    const sent: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)).writes[0].update.fields.ids.stringValue);
      if (sent.length === 1) await new Promise<void>((r) => { release = r; });
      return new Response(JSON.stringify({ commitTime: 'T' + sent.length }));
    }));
    const s = new CloudStore(albumApi(KEY));
    const one = s.saveOrder(['1']);
    await new Promise((r) => setTimeout(r, 10));
    const saves = [one, s.saveOrder(['2']), s.saveOrder(['3'])];
    release();
    await Promise.all(saves);
    expect(sent).toEqual(['1', '3']);
    expect(s.getState().order?.ids).toEqual(['3']);
  });

  it('a video page shows its still until played', () => {
    const c = toCloudPhoto(doc('albums/k/photos/cv', { kind: 'video', thumb: IMG, width: 10, height: 10, color: '#000000', author: 'Ana', caption: '', rotation: 0, hidden: false, duration: 3, chunks: 1, mime: 'video/mp4', createdAt: 'T' }))!;
    expect(cloudPhotoAsPage(c, { images: {}, imageErrors: {} }, 1)).toMatchObject({ kind: 'video', src: IMG, pending: true, alt: 'Video compartido por Ana', video: { chunks: 1 } });
  });

  it('groups visible comments by photo', () => {
    const m = commentsByPhoto([
      { id: 'a', photoId: 'p1', text: 'x', author: '', createdAt: '1', hidden: false },
      { id: 'b', photoId: 'p1', text: 'y', author: '', createdAt: '2', hidden: true },
    ]);
    expect(m.get('p1')?.map((c) => c.id)).toEqual(['a']);
  });
});

group('words', () => {
  it('speaks Spanish', () => {
    const now = Date.parse('2026-10-12T12:00:00Z');
    expect(timeAgo('2026-10-12T11:55:00Z', now)).toBe('hace 5 minutos');
    expect(timeAgo('2026-10-11T11:00:00Z', now)).toBe('ayer');
    expect(describe(2, 1)).toBe('2 fotos y 1 video');
    expect(describe(0, 3)).toBe('3 videos');
    expect(describe(1, 0)).toBe('1 foto');
  });
});
