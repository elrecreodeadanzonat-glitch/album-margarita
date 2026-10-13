import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext, DragOverlay, closestCenter, MouseSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent, type Modifier, type Announcements,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MessageCircle, Play } from 'lucide-react';
import type { Photo } from '../lib/types';
import { assetUrl } from '../lib/gallery';

interface Props {
  photos: Photo[];
  index: number;
  comments: Map<string, unknown[]> | null;
  onJump: (i: number) => void;
  /** drag a thumbnail to a new place; omitted → the strip cannot be rearranged */
  onMove?: (from: number, to: number) => void;
  /** the «+ Agregar» tile, after the last photo */
  children?: ReactNode;
}

/** the strip only scrolls sideways: the dragged thumbnail stays in its row */
const sidewaysOnly: Modifier = ({ transform }) => ({ ...transform, y: 0 });

const place = (photos: Photo[], id: string | number | undefined) => photos.findIndex((p) => p.id === id) + 1;

/**
 * The thumbnails strip. Drag a photo to put it somewhere else in the book:
 * with the mouse, just drag; on a phone, hold the finger on it for a moment, then drag (quick swipes still scroll).
 * Picking a photo up and putting it back where it was simply opens it, like a tap.
 */
export function TrayList({ photos, index, comments, onJump, onMove, children }: Props) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 450, tolerance: 8 } }),
  );
  const [active, setActive] = useState<Photo | null>(null);
  // a drag ends with a click on the thumbnail: don't let that click do anything else
  const quietUntil = useRef(0);

  const onDragStart = (e: DragStartEvent) => {
    quietUntil.current = Number.POSITIVE_INFINITY;
    setActive(photos.find((p) => p.id === e.active.id) ?? null);
    try {
      navigator.vibrate?.(25); // a little «picked up» nudge on phones that can
    } catch {
      /* not allowed */
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    quietUntil.current = performance.now() + 400;
    setActive(null);
    const from = photos.findIndex((p) => p.id === e.active.id);
    const to = e.over ? photos.findIndex((p) => p.id === e.over!.id) : -1;
    if (from < 0) return;
    if (to < 0 || to === from) {
      onJump(from); // held a bit long, or put back in place: it was a tap
      return;
    }
    onMove?.(from, to);
  };

  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Foto ${place(photos, a.id)} levantada.`,
    onDragOver: ({ active: a, over }) => (over ? `La foto ${place(photos, a.id)} irá al lugar ${place(photos, over.id)}.` : undefined),
    onDragEnd: ({ active: a, over }) => (over ? `La foto ${place(photos, a.id)} quedó en el lugar ${place(photos, over.id)}.` : 'La foto volvió a su lugar.'),
    onDragCancel: () => 'Se canceló el cambio de lugar.',
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[sidewaysOnly]}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => { quietUntil.current = performance.now() + 400; setActive(null); }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: 'Para ver esta foto, tócala. Para cambiarla de lugar, mantenla presionada y arrástrala.',
        },
      }}
    >
      <SortableContext items={photos.map((p) => p.id)} strategy={horizontalListSortingStrategy} disabled={!onMove}>
        {photos.map((p, i) => (
          <Thumb
            key={p.id}
            photo={p}
            position={i + 1}
            current={i === index}
            comments={comments?.get(p.id)?.length ?? 0}
            sortable={!!onMove}
            onClick={() => { if (performance.now() > quietUntil.current) onJump(i); }}
          />
        ))}
      </SortableContext>
      {children}
      {/* the thumbnail under the finger floats above everything: never clipped, never lagging. It is rendered
          outside the tray (whose blur would otherwise become its frame), inside the fullscreen element if any */}
      {createPortal(
        <DragOverlay dropAnimation={{ duration: 180, easing: 'ease-out' }} zIndex={60}>
          {active ? <ThumbFace photo={active} position={place(photos, active.id)} comments={comments?.get(active.id)?.length ?? 0} lifted /> : null}
        </DragOverlay>,
        (document.fullscreenElement as HTMLElement | null) ?? document.body,
      )}
    </DndContext>
  );
}

function ThumbFace({ photo, position, comments, lifted }: { photo: Photo; position: number; comments: number; lifted?: boolean }) {
  return (
    <span className={`thumb-face${lifted ? ' is-lifted' : ''}`}>
      <img src={assetUrl(photo.thumb)} alt="" loading="lazy" decoding="async" draggable={false} style={{ transform: `rotate(${photo.rotation}deg)` }} />
      <span className="thumb-num">{position}</span>
      {photo.kind === 'video' ? <i className="thumb-video" aria-label="video"><Play aria-hidden="true" /></i> : null}
      {comments ? (
        <i className="thumb-comments" aria-label={`${comments} comentarios`}><MessageCircle aria-hidden="true" />{comments}</i>
      ) : null}
    </span>
  );
}

function Thumb({ photo, position, current, comments, sortable, onClick }: { photo: Photo; position: number; current: boolean; comments: number; sortable: boolean; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: photo.id, disabled: !sortable });
  return (
    <button
      ref={setNodeRef}
      {...(sortable ? { ...attributes, ...listeners } : {})}
      className={`thumb${isDragging ? ' is-placeholder' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onClick={onClick}
      onContextMenu={(e) => e.preventDefault()}
      aria-current={current}
      aria-label={`Ir a la foto ${position}`}
      aria-roledescription={sortable ? 'miniatura que se puede mover' : undefined}
      data-photo-id={photo.id}
    >
      <ThumbFace photo={photo} position={position} comments={comments} />
    </button>
  );
}
