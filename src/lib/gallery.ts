import type { Photo, Rotation } from './types';

/** Resolve a path relative to the site root (music, icons) against the page base; data: and blob: URLs pass through. */
export function assetUrl(path: string): string {
  if (/^(blob:|data:|https?:)/.test(path)) return path;
  return import.meta.env.BASE_URL + path.replace(/^\//, '');
}

export function rotateBy90(r: Rotation): Rotation {
  return (((r + 90) % 360) as Rotation);
}

/** width/height as displayed, taking rotation into account */
export function displayAspect(p: Pick<Photo, 'width' | 'height' | 'rotation'>): number {
  const sideways = p.rotation === 90 || p.rotation === 270;
  return sideways ? p.height / p.width : p.width / p.height;
}
