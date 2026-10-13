/** Decode honouring EXIF orientation (createImageBitmap 'from-image', falling back to an <img>, which also applies it). */
async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall back */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function dims(src: ImageBitmap | HTMLImageElement) {
  return 'naturalWidth' in src ? { w: src.naturalWidth, h: src.naturalHeight } : { w: src.width, h: src.height };
}

/** high-quality downscale: halve repeatedly, then one final smooth step */
export function resize(src: CanvasImageSource, w: number, h: number, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  let cur: CanvasImageSource = src;
  let cw = w;
  let ch = h;
  while (cw / 2 > tw && ch / 2 > th) {
    const c = document.createElement('canvas');
    c.width = Math.round(cw / 2);
    c.height = Math.round(ch / 2);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, c.width, c.height);
    cur = c;
    cw = c.width;
    ch = c.height;
  }
  const out = document.createElement('canvas');
  out.width = tw;
  out.height = th;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tw, th);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, tw, th);
  return out;
}

function toBlob(c: HTMLCanvasElement, type: string, q: number): Promise<Blob | null> {
  return new Promise((resolve) => c.toBlob(resolve, type, q));
}

async function encode(c: HTMLCanvasElement, q: number): Promise<Blob> {
  const webp = await toBlob(c, 'image/webp', q);
  if (webp && webp.type === 'image/webp') return webp;
  const jpg = await toBlob(c, 'image/jpeg', Math.min(0.9, q + 0.04));
  if (!jpg) throw new Error('No se pudo comprimir la imagen');
  return jpg;
}

function averageColor(c: HTMLCanvasElement): string {
  const s = document.createElement('canvas');
  s.width = s.height = 16;
  const ctx = s.getContext('2d')!;
  ctx.drawImage(c, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

async function open(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.name)) {
    throw new Error(`«${file.name}» no es una foto ni un video`);
  }
  try {
    return await decode(file);
  } catch {
    throw new Error(`No se pudo abrir «${file.name}». Si es HEIC, conviértela a JPG primero.`);
  }
}

export function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error('No se pudo leer la imagen'));
    r.readAsDataURL(b);
  });
}

export interface CloudImage {
  /** data: URL, <= 1600 px, small enough for one Firestore document */
  image: string;
  thumb: string;
  width: number;
  height: number;
  color: string;
  name: string;
}

const CLOUD_IMAGE_MAX = 950_000;
const CLOUD_THUMB_MAX = 55_000;

/**
 * Any picture (a photo, or a still taken from a video) as what the album keeps: one version up to 1600 px
 * plus a thumbnail, as data: URLs. Pixels are only resized and compressed.
 */
export async function stills(src: CanvasImageSource, w: number, h: number, name: string): Promise<CloudImage> {
  let canvas: HTMLCanvasElement | null = null;
  let image = '';
  for (const [side, q] of [[1600, 0.82], [1600, 0.72], [1400, 0.68], [1200, 0.64], [1000, 0.6]] as const) {
    if (!canvas || Math.max(canvas.width, canvas.height) !== Math.min(side, Math.max(w, h))) canvas = resize(src, w, h, side);
    image = await blobToDataUrl(await encode(canvas, q));
    if (image.length <= CLOUD_IMAGE_MAX) break;
  }
  if (!canvas || image.length > CLOUD_IMAGE_MAX) throw new Error(`«${name}» es demasiado grande`);
  const small = resize(canvas, canvas.width, canvas.height, 320);
  let thumb = await blobToDataUrl(await encode(small, 0.7));
  if (thumb.length > CLOUD_THUMB_MAX) thumb = await blobToDataUrl(await encode(small, 0.45));
  return { image, thumb, width: canvas.width, height: canvas.height, color: averageColor(canvas), name };
}

/** A picked photo, ready to be added to the album. */
export async function prepareCloudImage(file: File): Promise<CloudImage> {
  const bmp = await open(file);
  try {
    const { w, h } = dims(bmp);
    return await stills(bmp, w, h, file.name);
  } finally {
    if ('close' in bmp) bmp.close();
  }
}
