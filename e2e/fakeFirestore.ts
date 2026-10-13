import type { Page, Route } from '@playwright/test';
import { pbkdf2Sync } from 'node:crypto';

/** the test album: its key, and the password that opens it (the real ones never appear in the tests) */
export const TEST_KEY = 'a' + 'test'.repeat(8);
export const TEST_PASSWORD = 'Prueba Feliz 2026';

const SALT = 'album-margarita/v1';
const ITERATIONS = 150_000;
export const normalizePassword = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '');
export const lockCode = (pw: string) => pbkdf2Sync(normalizePassword(pw), SALT, ITERATIONS, 32, 'sha256').toString('hex');

type Value = Record<string, unknown>;
type Fields = Record<string, Value>;
interface Write {
  update: { name: string; fields: Fields };
  currentDocument?: { exists: boolean };
  updateMask?: { fieldPaths: string[] };
  updateTransforms?: { fieldPath: string }[];
}

const ROOT = 'projects/album-margarita/databases/(default)/documents';
const CORS = { 'Access-Control-Allow-Origin': '*' };

/**
 * In-memory stand-in for the Firestore REST API the album uses (commit, runQuery, get, delete), so the browser
 * tests never touch the real database. It mimics the parts of the rules the screens depend on.
 */
export class FakeFirestore {
  readonly docs = new Map<string, Fields>();
  private clock = 0;
  /** make the next N commits fail as if the network were down */
  failNext = 0;
  commits = 0;

  constructor() {
    this.seedAlbum(TEST_KEY, { title: 'Álbum de Prueba', intro: 'Recuerdos de prueba…', outro: 'Fin de la prueba.' });
    this.docs.set(`vault/${lockCode(TEST_PASSWORD)}`, { albumKey: { stringValue: TEST_KEY }, createdAt: { timestampValue: this.tick() } });
  }

  async install(page: Page) {
    // every tab of this test (a second tab too) talks to this fake, never to the real database
    await page.context().route('https://firestore.googleapis.com/**', (route) => this.handle(route));
  }

  private tick() {
    this.clock = Math.max(this.clock + 1000, Date.now());
    return new Date(this.clock).toISOString().replace('Z', '123Z'); // microseconds, like Firestore
  }

  private async handle(route: Route) {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    const url = new URL(req.url());
    const path = decodeURIComponent(url.pathname).split('/documents').slice(1).join('/documents');
    const json = (status: number, body: unknown) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === ':commit') {
      if (this.failNext > 0) {
        this.failNext--;
        return route.abort('internetdisconnected');
      }
      const r = this.commit(req.postDataJSON().writes as Write[]);
      return json(r.status, r.body);
    }
    if (path.endsWith(':runQuery')) {
      const parent = path.slice(0, -':runQuery'.length).replace(/^\//, '');
      return json(200, this.runQuery(parent, req.postDataJSON().structuredQuery));
    }
    const key = path.replace(/^\//, '');
    if (req.method() === 'DELETE') {
      this.docs.delete(key);
      return json(200, {});
    }
    const fields = this.docs.get(key);
    return fields ? json(200, { name: `${ROOT}/${key}`, fields }) : json(404, { error: { message: 'not found' } });
  }

  private commit(writes: Write[]) {
    const t = this.tick();
    const keyOf = (w: Write) => w.update.name.slice(ROOT.length + 1);
    const deny = { status: 403, body: { error: { message: 'Missing or insufficient permissions.' } } };
    for (const w of writes) {
      const key = keyOf(w);
      const parts = key.split('/');
      if (w.currentDocument?.exists === false && this.docs.has(key)) return { status: 409, body: { error: { message: 'exists' } } };
      if (w.currentDocument?.exists === true && !this.docs.has(key)) return { status: 404, body: { error: { message: 'missing' } } };
      if (parts[0] === 'vault' && !this.docs.has(`albums/${(w.update.fields.albumKey as { stringValue?: string })?.stringValue}`)) return deny;
      if (parts[0] === 'albums' && parts.length === 2 && w.currentDocument?.exists === false) return deny;
      if (parts[0] === 'albums' && parts[2] === 'photos' && w.currentDocument?.exists === false) {
        const kind = (w.update.fields.kind as { stringValue?: string })?.stringValue;
        if (kind === 'video') {
          const chunks = Number((w.update.fields.chunks as { integerValue?: string })?.integerValue);
          if (!this.docs.has(`albums/${parts[1]}/videoChunks/${parts[3]}_${chunks - 1}`)) return deny;
        }
      }
    }
    this.commits++;
    for (const w of writes) {
      const key = keyOf(w);
      const next: Fields = w.updateMask ? { ...this.docs.get(key) } : {};
      for (const [k, v] of Object.entries(w.update.fields)) if (!w.updateMask || w.updateMask.fieldPaths.includes(k)) next[k] = v;
      for (const tr of w.updateTransforms ?? []) next[tr.fieldPath] = { timestampValue: t };
      this.docs.set(key, next);
    }
    return { status: 200, body: { commitTime: t, writeResults: writes.map((w) => ({ updateTime: t, transformResults: w.updateTransforms ? [{ timestampValue: t }] : undefined })) } };
  }

  private runQuery(parent: string, q: { from: { collectionId: string }[]; where?: { fieldFilter: { value: { timestampValue: string } } }; orderBy?: { direction?: string }[]; limit?: number }) {
    const col = parent ? `${parent}/${q.from[0].collectionId}` : q.from[0].collectionId;
    const depth = col.split('/').length + 1;
    const after = q.where?.fieldFilter.value.timestampValue;
    const desc = q.orderBy?.[0]?.direction === 'DESCENDING';
    const time = (f: Fields) => Date.parse(String((f.createdAt as { timestampValue?: string })?.timestampValue ?? ''));
    const rows = [...this.docs.entries()]
      .filter(([k]) => k.startsWith(`${col}/`) && k.split('/').length === depth)
      .filter(([, f]) => !after || time(f) > Date.parse(after))
      .sort(([, a], [, b]) => (time(a) - time(b)) * (desc ? -1 : 1))
      .slice(0, q.limit ?? 1000)
      .map(([k, fields]) => ({ document: { name: `${ROOT}/${k}`, fields }, readTime: 'now' }));
    return rows.length ? rows : [{ readTime: 'now' }];
  }

  // ---- helpers for the tests ----
  private plain(f: Fields): Record<string, unknown> {
    return Object.fromEntries(Object.entries(f).map(([n, v]) => {
      const x = v as { stringValue?: string; booleanValue?: boolean; integerValue?: string; doubleValue?: number; timestampValue?: string; bytesValue?: string };
      return [n, x.stringValue ?? x.booleanValue ?? (x.integerValue !== undefined ? Number(x.integerValue) : x.doubleValue ?? x.timestampValue ?? x.bytesValue)];
    }));
  }

  /** documents of a collection of the test album (or a top-level one, like «vault») */
  list(col: 'photos' | 'photoImages' | 'videoChunks' | 'comments' | 'orders' | 'vault') {
    const prefix = col === 'vault' ? 'vault/' : `albums/${TEST_KEY}/${col}/`;
    return [...this.docs.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, f]) => ({ id: k.slice(prefix.length), ...this.plain(f) }));
  }

  meta() {
    return this.plain(this.docs.get(`albums/${TEST_KEY}`) ?? {});
  }

  latestOrder(): string[] | null {
    const all = this.list('orders').sort((a, b) => Date.parse(String(b.createdAt)) - Date.parse(String(a.createdAt)));
    const ids = all[0]?.ids;
    return typeof ids === 'string' ? ids.split(',') : null;
  }

  seedAlbum(key: string, meta: { title: string; intro: string; outro: string }) {
    this.docs.set(`albums/${key}`, {
      title: { stringValue: meta.title }, intro: { stringValue: meta.intro }, outro: { stringValue: meta.outro }, createdAt: { timestampValue: this.tick() },
    });
  }

  seedPhoto(opts: { thumb: string; image: string; author: string; width?: number; height?: number; hidden?: boolean }) {
    const id = `cseed${this.docs.size}${Math.random().toString(36).slice(2, 10)}`;
    const t = this.tick();
    const base = `albums/${TEST_KEY}`;
    this.docs.set(`${base}/photos/${id}`, {
      kind: { stringValue: 'photo' }, width: { integerValue: String(opts.width ?? 1280) }, height: { integerValue: String(opts.height ?? 853) },
      color: { stringValue: '#9a7a5c' }, thumb: { stringValue: opts.thumb }, author: { stringValue: opts.author },
      caption: { stringValue: '' }, rotation: { integerValue: '0' }, hidden: { booleanValue: !!opts.hidden }, createdAt: { timestampValue: t },
    });
    this.docs.set(`${base}/photoImages/${id}`, { data: { stringValue: opts.image }, createdAt: { timestampValue: t } });
    return id;
  }

  seedComment(photoId: string, text: string, author: string, hidden = false) {
    const id = `kseed${this.docs.size}${Math.random().toString(36).slice(2, 10)}`;
    this.docs.set(`albums/${TEST_KEY}/comments/${id}`, {
      photoId: { stringValue: photoId }, text: { stringValue: text }, author: { stringValue: author },
      hidden: { booleanValue: hidden }, createdAt: { timestampValue: this.tick() },
    });
    return id;
  }

  seedOrder(ids: string[], author = 'Alguien') {
    const id = `oseed${this.docs.size}${Math.random().toString(36).slice(2, 10)}`;
    this.docs.set(`albums/${TEST_KEY}/orders/${id}`, {
      ids: { stringValue: ids.join(',') }, author: { stringValue: author }, createdAt: { timestampValue: this.tick() },
    });
    return id;
  }
}
