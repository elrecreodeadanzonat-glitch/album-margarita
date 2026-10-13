import type { Track } from './lib/music';

/**
 * Firestore project of this album (its own project: nothing here touches «Libro de mamá»).
 * The web API key only identifies the project (it is public by design); what anyone may read or write is
 * decided by firestore.rules on Google's side.
 */
export const FIREBASE = { projectId: 'album-margarita', apiKey: 'AIzaSyBQMm0bsJitAtvExupzOG_rXwvVJMHpIjI' } as const;

/** Texts until the album's own (editable in «Opciones») arrive. */
export const ALBUM_DEFAULTS = {
  title: 'Álbum de Margarita',
  intro: 'Los recuerdos que más queremos, guardados en un solo lugar…',
  outro: 'Gracias por cada momento… y por todos los que vienen.',
} as const;

/** who to write to when someone forgets the password (only the owner can set a new one) */
export const HELP_CONTACT = { name: 'Andrés', email: 'andresserrano5@gmail.com' } as const;

/**
 * The password never leaves the browser: it is turned into a long code (PBKDF2) that names the album's «lock»
 * in the database. Changing these values would lock everyone out.
 */
export const VAULT = { salt: 'album-margarita/v1', iterations: 150_000 } as const;

/** Background music (instrumental, verifiable reuse licence — see MUSIC_LICENSE.txt). Played in order, looping. */
export const PLAYLIST: Track[] = [
  { src: 'audio/01-uplifting-piano-pop-flow.mp3', title: 'Uplifting Piano Pop Flow Music', artist: 'JuliusH' },
  { src: 'audio/02-neon-piano-lane.mp3', title: 'Neon Piano Lane', artist: 'Turning Pages' },
  { src: 'audio/03-upbeat-happy-indie-pop.mp3', title: 'Upbeat Happy Indie Pop', artist: 'Vivaleum' },
  { src: 'audio/04-my-happy-dance.mp3', title: 'My Happy Dance', artist: 'melodyayresgriffiths' },
];

export const MUSIC_CREDIT = 'Música: JuliusH, Turning Pages, Vivaleum y melodyayresgriffiths (Pixabay)';
