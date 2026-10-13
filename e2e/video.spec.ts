import { expect, test } from './fixtures';
import { SHOTS, login, mediaFile } from './helpers';

test('un video corto de celular (mp4) se agrega tal cual y se ve en el álbum', async ({ page, cloud }, info) => {
  await login(page);
  await page.getByTestId('cover-add-input').setInputFiles(mediaFile('corto.mp4', 'video/mp4'));
  const tile = page.getByTestId('add-item-video');
  await expect(tile).toBeVisible({ timeout: 20_000 });
  await expect(tile).toContainText('0:03');
  await expect(page.getByTestId('add-video-note')).toHaveCount(0); // small mp4: no waiting
  await expect(page.getByTestId('add-publish')).toHaveText('Agregar 1 video al álbum');
  await page.screenshot({ path: `${SHOTS}/agregar-video-${info.project.name}.png` });
  await page.getByTestId('add-publish').click();
  await expect(page.getByTestId('add-done')).toContainText('Tu video ya está en el álbum.', { timeout: 30_000 });

  const [v] = cloud.list('photos');
  expect(v).toMatchObject({ kind: 'video', mime: 'video/mp4', chunks: 1 });
  expect(Number(v.duration)).toBeGreaterThan(2.5);
  expect(cloud.list('videoChunks').map((c) => c.id)).toEqual([`${v.id}_0`]);

  await page.getByTestId('add-see').click();
  await expect(page.getByTestId('counter')).toHaveText('Video 1 de 1');
  const video = page.getByTestId('video');
  await expect(video).toHaveAttribute('src', /^blob:/);
  // it plays by itself (the album is playing); muted only if the browser refused sound
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.5);
  await page.screenshot({ path: `${SHOTS}/video-${info.project.name}.png` });
  // when it ends, the album moves on (here: to the closing page)
  await expect(page.getByTestId('outro')).toBeVisible({ timeout: 15_000 });
});

test('un video que no es mp4 se prepara (más liviano) antes de subirse, y se reproduce', async ({ page, cloud }, info) => {
  test.skip(info.project.name !== 'desktop', 'grabar de nuevo toma lo que dura el video: una vez basta');
  await login(page);
  await page.getByTestId('cover-add-input').setInputFiles(mediaFile('grande.webm', 'video/webm'));
  await expect(page.getByTestId('add-item-video')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('add-video-note')).toContainText('se preparan');
  await page.getByTestId('add-publish').click();
  await expect(page.getByTestId('add-progress')).toContainText('Preparando el video', { timeout: 10_000 });
  await expect(page.getByTestId('add-done')).toContainText('Tu video ya está en el álbum.', { timeout: 60_000 });
  const [v] = cloud.list('photos');
  expect(v.kind).toBe('video');
  expect(['video/mp4', 'video/webm']).toContain(v.mime);
  expect(Number(v.duration)).toBeGreaterThan(2);

  await page.getByTestId('add-see').click();
  const video = page.getByTestId('video');
  await expect(video).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.5);
  // a tap in the middle pauses it; the big button plays it again
  const box = (await page.getByTestId('stage').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('video-play')).toBeVisible({ timeout: 5000 });
  expect(await video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);
});

test('fotos y videos juntos: «Agregar 1 foto y 1 video»; la miniatura del video lleva ▶', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'basta en un tamaño');
  await login(page);
  await page.getByTestId('cover-add-input').setInputFiles([mediaFile('muestra-3.webp', 'image/webp'), mediaFile('corto.mp4', 'video/mp4')]);
  await expect(page.getByTestId('add-publish')).toHaveText('Agregar 1 foto y 1 video al álbum', { timeout: 20_000 });
  await page.getByTestId('add-publish').click();
  await expect(page.getByTestId('add-done')).toContainText('Tus 1 foto y 1 video ya están en el álbum.', { timeout: 30_000 });
  await page.getByTestId('add-see').click();
  await page.getByTestId('thumbs-toggle').click();
  await expect(page.locator('.tray-list .thumb .thumb-video')).toHaveCount(1);
});
