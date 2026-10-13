import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Photo } from './lib/types';
import { assetUrl } from './lib/gallery';
import { MusicPlayer, type MusicState } from './lib/music';
import { loadLastTitle, loadName, loadPrefs, saveLastTitle, savePrefs, type Session } from './lib/prefs';
import { ALBUM_DEFAULTS, PLAYLIST } from './config';
import { CloudStore, cloudPhotoAsPage, useCloudState } from './lib/cloudStore';
import { albumApi, applyOrder, type CloudPhoto } from './lib/cloud';
import { Cover } from './components/Cover';
import { Viewer, type Reorder } from './components/Viewer';
import { Outro } from './components/Outro';
import { Settings } from './components/Settings';
import { Organizer } from './components/Organizer';
import { OrderHistory } from './components/OrderHistory';
import { Comments } from './components/Comments';

const AddMedia = lazy(() => import('./components/AddMedia'));

type Phase = 'cover' | 'viewer' | 'outro';
type Panel = 'settings' | 'organizer' | 'history' | null;

interface Props {
  session: Session;
  onLogout: () => void;
  onLockChanged: (lock: string) => void;
}

export default function App({ session, onLogout, onLockChanged }: Props) {
  const [phase, setPhase] = useState<Phase>('cover');
  const [run, setRun] = useState(0);
  const [startIndex, setStartIndex] = useState(0);
  const [adding, setAdding] = useState<File[] | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [commentsFor, setCommentsFor] = useState<CloudPhoto | null>(null);
  const player = useMemo(() => {
    const p = loadPrefs();
    return new MusicPlayer(PLAYLIST, p.volume, p.muted);
  }, []);
  const [music, setMusic] = useState<MusicState>(player.getState());
  const store = useMemo(() => new CloudStore(albumApi(session.albumKey)), [session.albumKey]);
  const cloudState = useCloudState(store);
  const coverPreloaded = useRef(false);

  useEffect(() => player.subscribe(setMusic), [player]);
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  useEffect(() => savePrefs({ volume: music.volume, muted: music.muted }), [music.volume, music.muted]);

  // the album's name and texts (editable in «Opciones»); remembered to greet people next time
  const meta = cloudState?.meta;
  const title = meta?.title || loadLastTitle() || ALBUM_DEFAULTS.title;
  const intro = meta ? meta.intro : ALBUM_DEFAULTS.intro;
  const outro = meta ? meta.outro : ALBUM_DEFAULTS.outro;
  useEffect(() => {
    if (meta?.title) saveLastTitle(meta.title);
    document.title = title;
  }, [meta?.title, title]);

  // the album: photos and videos in the order someone last left them (new ones at the end)
  const photos: Photo[] = useMemo(() => {
    if (!cloudState) return [];
    const pages = cloudState.photos.filter((c) => !c.hidden).map((c, i) => cloudPhotoAsPage(c, cloudState, i + 1));
    return applyOrder(pages, cloudState.order?.ids);
  }, [cloudState]);
  const bookIds = useMemo(() => photos.map((p) => p.id), [photos]);

  // rearranging is only offered once the photos and the shared order are known,
  // so nobody can save an arrangement built from half the album
  const loaded = !!cloudState?.loaded;
  const reorder: Reorder | undefined = useMemo(
    () => (loaded
      ? { move: (shown, from, to) => store.move(shown, from, to, loadName()), restore: (ids) => store.saveOrder(ids, loadName()) }
      : undefined),
    [store, loaded],
  );

  const ready = !!cloudState?.ready;
  const empty = ready && loaded && photos.length === 0;
  const error = ready && !cloudState?.online && !photos.length ? 'No pudimos cargar el álbum. Revisa tu conexión y vuelve a intentarlo.' : null;

  // warm up only the first page while the cover is on screen
  useEffect(() => {
    if (!photos.length || coverPreloaded.current) return;
    coverPreloaded.current = true;
    if (photos[0].pending) store.loadImage(photos[0].id).catch(() => undefined);
  }, [photos, store]);

  const start = useCallback(() => {
    void player.start();
  }, [player]);

  const toggleMute = useCallback(() => {
    const s = player.getState();
    if (!s.started) void player.start();
    player.setMuted(!s.muted);
  }, [player]);

  // the background music steps back while a video plays with its sound
  const duck = useCallback((on: boolean) => player.swell(on ? 0.12 : 1, 0.6), [player]);

  const last = photos[photos.length - 1];

  // the «+» sheet closed: if something was added, open the album on the first of them
  const closeAdding = (firstNewId?: string) => {
    setAdding(null);
    const i = firstNewId ? photos.findIndex((p) => p.id === firstNewId) : -1;
    if (i >= 0) {
      if (phase !== 'viewer') start(); // still inside the tap on «Ver en el álbum»: the music may start
      setStartIndex(i);
      setRun((r) => r + 1);
      setPhase('viewer');
    }
  };

  const commentsPage = commentsFor && cloudState ? cloudPhotoAsPage(commentsFor, cloudState, bookIds.indexOf(commentsFor.id) + 1) : null;

  return (
    <>
      {phase === 'cover' && (
        <Cover
          title={title}
          intro={intro}
          ready={ready && (photos.length > 0 || loaded)}
          empty={empty}
          error={error}
          firstPhoto={photos[0] ? assetUrl(photos[0].src) : undefined}
          onStart={start}
          onOpened={() => { setStartIndex(0); setRun((r) => r + 1); setPhase('viewer'); }}
          onAddFiles={setAdding}
          onSettings={() => setPanel('settings')}
        />
      )}
      {phase === 'viewer' && (
        <Viewer
          key={run}
          photos={photos}
          music={music}
          onToggleMute={toggleMute}
          onVolume={(v) => player.setVolume(v)}
          onFinish={() => setPhase('outro')}
          startIndex={startIndex}
          onAddFiles={setAdding}
          blocked={!!adding || !!panel || !!commentsFor}
          cloud={store}
          reorder={reorder}
          onDuck={duck}
          onSettings={() => setPanel('settings')}
        />
      )}
      {adding ? (
        <Suspense fallback={null}>
          <AddMedia files={adding} store={store} onClose={closeAdding} />
        </Suspense>
      ) : null}
      {phase === 'outro' && (
        <Outro
          title={title}
          text={outro}
          lastThumb={last ? assetUrl(last.src) : undefined}
          onSwell={(l) => player.swell(l)}
          onRestart={() => setPhase('cover')}
          onReplay={() => { setStartIndex(0); setRun((r) => r + 1); setPhase('viewer'); }}
        />
      )}

      {panel === 'settings' ? (
        <Settings
          store={store}
          lock={session.lock}
          onLockChanged={onLockChanged}
          onOrganize={() => setPanel('organizer')}
          onHistory={() => setPanel('history')}
          onLogout={() => { player.setMuted(true); onLogout(); }}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel === 'organizer' ? (
        <Organizer store={store} bookIds={bookIds} onComments={setCommentsFor} onClose={() => setPanel(null)} />
      ) : null}
      {panel === 'history' ? (
        <OrderHistory
          load={store.api.fetchOrders}
          thumbFor={(id) => cloudState?.photos.find((c) => c.id === id)?.thumb}
          onRestore={(o) => store.saveOrder(o.ids, loadName() || 'Historial')}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {commentsPage && commentsFor ? (
        <Comments
          photo={commentsPage}
          number={bookIds.indexOf(commentsFor.id) + 1}
          store={store}
          onClose={() => setCommentsFor(null)}
          onModerate={(c, hidden) => store.updateComment(c.id, { hidden })}
        />
      ) : null}
    </>
  );
}
