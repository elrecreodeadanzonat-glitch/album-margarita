export type FitMode = 'contain' | 'cover';
export type Rotation = 0 | 90 | 180 | 270;

export interface FocalPoint {
  /** 0..1 from the left */
  x: number;
  /** 0..1 from the top */
  y: number;
}

export interface Photo {
  id: string;
  order: number;
  /** full-size web version (<= 2200 px long side), path relative to the site root */
  src: string;
  /** medium version for phones (<= 1280 px) */
  srcMd?: string;
  thumb: string;
  width: number;
  height: number;
  /** average colour, used for the page background */
  color?: string;
  originalFilename: string;
  caption: string;
  alt: string;
  fitMode: FitMode;
  rotation: Rotation;
  focalPoint: FocalPoint;
  hidden: boolean;
  createdAt: string;
  /** photos added from the book (Firestore): who shared it */
  addedBy?: string;
  /** only the thumbnail is here yet; the full image is on its way */
  pending?: boolean;
  /** a page can be a short video (its still is in src/thumb) */
  kind?: 'photo' | 'video';
  video?: { duration: number; chunks: number; mime: 'video/mp4' | 'video/webm' };
}
