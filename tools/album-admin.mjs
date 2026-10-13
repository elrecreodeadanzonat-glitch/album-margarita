// Owner tool for the album (Node 20+). Nothing secret lives in this file.
//
//   Someone forgot the password → give the album a new one (the old ones keep working until changed):
//     ALBUM_KEY=a…  NEW_PASSWORD="…"  node tools/album-admin.mjs nueva-contrasena
//
// The album key is in the private file «Album de Margarita - llave interna.txt» (not in this repository).
// The password is turned into the same long code the browser computes (PBKDF2, see src/config.ts → VAULT).
import { readFileSync } from 'node:fs';
import { pbkdf2Sync } from 'node:crypto';

const config = readFileSync(new URL('../src/config.ts', import.meta.url), 'utf8');
const pick = (re) => {
  const m = config.match(re);
  if (!m) throw new Error(`config.ts: ${re}`);
  return m[1];
};
const PROJECT = pick(/projectId: '([^']+)'/);
const API_KEY = pick(/apiKey: '([^']+)'/);
const SALT = pick(/salt: '([^']+)'/);
const ITERATIONS = Number(pick(/iterations: ([\d_]+)/).replace(/_/g, ''));

export const normalizePassword = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '');
export const lockCode = (password) => pbkdf2Sync(normalizePassword(password), SALT, ITERATIONS, 32, 'sha256').toString('hex');

const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const API = `https://firestore.googleapis.com/v1/${ROOT}`;

export async function commit(writes) {
  const res = await fetch(`${API}:commit?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export const created = (path, fields) => ({
  update: { name: `${ROOT}/${path}`, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { stringValue: v }])) },
  currentDocument: { exists: false },
  updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
});

async function newPassword() {
  const albumKey = process.env.ALBUM_KEY;
  const password = process.env.NEW_PASSWORD;
  if (!albumKey || !/^a[a-z0-9]{20,40}$/.test(albumKey)) throw new Error('Falta ALBUM_KEY (está en el archivo privado de la llave).');
  if (!password || normalizePassword(password).length < 6) throw new Error('Falta NEW_PASSWORD (al menos 6 letras o números).');
  await commit([created(`vault/${lockCode(password)}`, { albumKey })]);
  console.log('Listo: el álbum ya abre con la contraseña nueva.');
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('album-admin.mjs')) {
  const cmd = process.argv[2];
  if (cmd === 'nueva-contrasena') await newPassword();
  else console.log('Uso: ALBUM_KEY=… NEW_PASSWORD="…" node tools/album-admin.mjs nueva-contrasena');
}
