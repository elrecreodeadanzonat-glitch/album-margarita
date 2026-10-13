# Álbum de Margarita

Un álbum familiar **privado**: se entra con contraseña, se abre como un libro, pasan las fotos y los videos cortos con
música, y al final el libro se cierra. Es el mismo diseño del «Libro de mamá», en un sitio y una base de datos aparte
(nada de aquí toca el libro de mamá).

**Link:** https://elrecreodeadanzonat-glitch.github.io/album-margarita/

> La contraseña **no está en este repositorio** (es público). La tiene la familia.
> El sitio lleva `noindex` para que los buscadores no lo muestren.

## Cómo se usa

- **Entrar:** escribir la contraseña. No importan las mayúsculas, los acentos ni los espacios. «Recordarme en este
  aparato» evita escribirla cada vez.
- **Agregar fotos o videos:** el botón grande de la portada, el **+** de los controles o el **+ Agregar** al final de las
  miniaturas. Se eligen, se toca **«Agregar … al álbum»** y aparece **«¡Listo!»**. El nombre de quien comparte es opcional.
- **Videos cortos:** hasta 1 minuto (de uno más largo se guarda el primer minuto). Un mp4 liviano (por ejemplo, de
  WhatsApp) se guarda tal cual, sin esperar. Uno pesado se prepara antes de subirse, en el mismo celular o computador:
  tarda más o menos lo que dura el video y no hay que cerrar la pantalla mientras tanto. En el álbum, el video arranca
  solo, la música baja mientras suena y, cuando termina, sigue la siguiente página. Tocar en el centro lo pausa;
  deslizar sigue pasando de página.
- **Comentarios y notas:** el botoncito redondo en la esquina de cada foto o video.
- **Cambiar el orden:** en las miniaturas, arrastrar una foto (en el celular, dejar el dedo un momento sobre ella y
  arrastrarla). Sale «Listo: la foto quedó en el lugar N» con **Deshacer**. Lo ven todos.
- **Opciones** (botón de la portada y de los controles): nombre y textos del álbum, **cambiar la contraseña**,
  **Organizar fotos y videos** (girar, quitar del álbum y devolver; nada se borra), **Historial del orden**
  (volver a un orden anterior) y **Cerrar sesión en este aparato**.

### Si alguien olvida la contraseña

La pantalla de entrada dice a quién escribirle. El álbum tiene una **llave interna** guardada fuera de este repositorio,
en `Documentos\Album de Margarita - llave interna.txt`. Con ella se le pone una contraseña nueva:

```bash
ALBUM_KEY=<la llave>  NEW_PASSWORD="la nueva"  node tools/album-admin.mjs nueva-contrasena
```

## Cómo funciona por dentro

- React + TypeScript + Vite; GitHub Pages (cada cambio en `main` se revisa —lint, pruebas— y se publica solo).
- Datos en **Cloud Firestore** (proyecto `album-margarita`, plan gratuito): todo vive en `albums/{llave}`, una llave
  larga y al azar que nadie puede listar. La contraseña **nunca sale del navegador**: se convierte allí en un código largo
  (PBKDF2, 150.000 vueltas) que nombra un «candado», `vault/{código} → { llave }`. Cambiar la contraseña crea un candado
  nuevo y quita el viejo; los aparatos que entraron con la vieja la piden de nuevo.
- `firestore.rules`: dentro del álbum se puede agregar (fotos, videos, comentarios, órdenes) con límites de tamaño y
  formato, girar, quitar y devolver; **nada se puede borrar ni editar** desde la web. Las fechas las pone el servidor.
- Fotos: hasta 1600 px, en un documento (≤ 1 MB) más la miniatura. Videos: en pedazos de ≤ 950 KB
  (`videoChunks`), y su página se crea cuando ya están todos.
- Cambiar las reglas: editar `firestore.rules` y `firebase deploy --only firestore:rules` (desde esta carpeta; el
  `.firebaserc` apunta a `album-margarita`).

## Desarrollo

```bash
npm install
npm run dev          # http://localhost:5173/album-margarita/
npm run lint
npm test             # pruebas unitarias (Vitest)
npm run build && npx playwright test     # pruebas de interfaz en Chrome (celular + computador)
BASE_URL=https://elrecreodeadanzonat-glitch.github.io/album-margarita/ npx playwright test   # contra el sitio publicado
```

Las pruebas de interfaz usan una base de datos simulada en memoria (`e2e/fakeFirestore.ts`) con un álbum y una
contraseña de prueba: nunca tocan la base real.

Música: 4 pistas de Pixabay (licencia en `MUSIC_LICENSE.txt`).
