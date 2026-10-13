/** «2 fotos y 1 video» */
export function describe(photos: number, videos: number): string {
  const p = photos === 1 ? '1 foto' : `${photos} fotos`;
  const v = videos === 1 ? '1 video' : `${videos} videos`;
  if (photos && videos) return `${p} y ${v}`;
  return videos ? v : p;
}
