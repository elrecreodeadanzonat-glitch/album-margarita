import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { SHOTS, currentPhoto, dataUrl, login, mediaFile, openAlbum } from './helpers';

const seed4 = (cloud: import('./fakeFirestore').FakeFirestore) =>
  [1, 2, 3, 4].map((i) => cloud.seedPhoto({ thumb: dataUrl(`miniatura-${i}.webp`), image: dataUrl(`muestra-${i}.webp`), author: `Persona ${i}`, width: 1200, height: 800 }));

const thumbIds = (page: Page) => page.locator('.tray-list .thumb:not(.add)').evaluateAll((els) => els.map((e) => e.getAttribute('data-photo-id')));

async function centre(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test('álbum vacío: «Agregar fotos o videos» desde la portada → ¡Listo! → se ven', async ({ page, cloud }, info) => {
  await login(page);
  await expect(page.getByTestId('cover-text')).toHaveText('Tu álbum está listo. Agrega las primeras fotos o videos.');
  await expect(page.getByTestId('open-book')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/portada-vacia-${info.project.name}.png` });

  await page.getByTestId('cover-add-input').setInputFiles([mediaFile('muestra-1.webp', 'image/webp'), mediaFile('muestra-2.webp', 'image/webp')]);
  const sheet = page.getByTestId('add-photos');
  await expect(sheet.locator('.add-grid img')).toHaveCount(2, { timeout: 20_000 });
  await page.getByTestId('add-name').fill('Margarita');
  await expect(page.getByTestId('add-publish')).toHaveText('Agregar 2 fotos al álbum');
  await page.getByTestId('add-publish').click();
  await expect(page.getByTestId('add-done')).toContainText('Tus 2 fotos ya están en el álbum.', { timeout: 20_000 });
  const saved = cloud.list('photos');
  expect(saved).toHaveLength(2);
  expect(saved[0]).toMatchObject({ kind: 'photo', author: 'Margarita', hidden: false });

  await page.getByTestId('add-see').click();
  await expect(page.getByTestId('counter')).toHaveText('Foto 1 de 2');
  expect(saved.map((p) => p.id)).toContain(await currentPhoto(page));
  await expect(page.locator('.shared-by')).toHaveText('Compartida por Margarita');
});

test('comentar, reordenar arrastrando y el historial del orden', async ({ page, cloud }, info) => {
  test.skip(info.project.name !== 'desktop', 'arrastre con el mouse; el táctil se prueba en el libro');
  const ids = seed4(cloud);
  await login(page);
  await openAlbum(page);
  expect(await currentPhoto(page)).toBe(ids[0]);

  // a note on the photo
  await page.getByTestId('comments-open').click();
  await page.getByTestId('comment-name').fill('Tía Rosa');
  await page.getByTestId('comment-input').fill('¡Qué recuerdo tan lindo!');
  await page.getByTestId('comment-send').click();
  await expect(page.getByTestId('comment')).toContainText('¡Qué recuerdo tan lindo!');
  expect(cloud.list('comments')).toMatchObject([{ photoId: ids[0], author: 'Tía Rosa' }]);
  await page.getByTestId('comments-close').click();
  await expect(page.getByTestId('comments-count')).toHaveText('1');

  // drag the first photo to the third place
  await page.getByTestId('thumbs-toggle').click();
  await expect(page.locator('.tray-hint')).toBeVisible();
  await page.waitForTimeout(600);
  const a = await centre(page.locator(`.tray-list .thumb[data-photo-id="${ids[0]}"]`));
  const b = await centre(page.locator(`.tray-list .thumb[data-photo-id="${ids[2]}"]`));
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 12, a.y, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 18 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect(page.getByTestId('tray-toast')).toContainText(/quedó en el lugar \d/);
  await expect.poll(() => cloud.latestOrder()?.indexOf(ids[0])).toBeGreaterThan(0);
  const moved = await thumbIds(page);
  expect(moved.indexOf(ids[0])).toBeGreaterThan(0);

  // the order history can bring back the previous arrangement
  await page.getByRole('button', { name: 'Cerrar miniaturas' }).click();
  await page.getByTestId('settings-ctl').click();
  await page.getByTestId('open-history').click();
  await expect(page.getByTestId('history-item')).toHaveCount(1);
  await page.getByTestId('order-history').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(page.getByTestId('order-history')).toHaveCount(0);
});

test('Opciones: cambiar el nombre y los textos del álbum', async ({ page, cloud }) => {
  seed4(cloud);
  await login(page);
  await page.getByTestId('cover-settings').click();
  await expect(page.getByTestId('meta-title')).toHaveValue('Álbum de Prueba');
  await page.getByTestId('meta-title').fill('Álbum de la Familia');
  await page.getByTestId('meta-intro').fill('Lo mejor de nuestra vida…');
  await page.getByTestId('meta-save').click();
  await expect(page.getByTestId('meta-save')).toHaveText(/Guardado/);
  expect(cloud.meta()).toMatchObject({ title: 'Álbum de la Familia', intro: 'Lo mejor de nuestra vida…' });
  await page.getByRole('button', { name: 'Cerrar opciones' }).click();
  await expect(page.getByTestId('cover-text')).toHaveText('Lo mejor de nuestra vida…');
  await expect(page.locator('.cover-title')).toHaveText('Álbum de la Familia');
  await expect.poll(() => page.title()).toBe('Álbum de la Familia');
});

test('Organizar: quitar una foto (no se borra) y devolverla; ocultar un comentario', async ({ page, cloud }, info) => {
  const ids = seed4(cloud);
  cloud.seedComment(ids[1], 'compra aquí', 'Spam');
  await login(page);
  await page.getByTestId('cover-settings').click();
  await page.getByTestId('open-organizer').click();
  const cards = page.getByTestId('photo-card');
  await expect(cards).toHaveCount(4);
  await page.screenshot({ path: `${SHOTS}/organizar-${info.project.name}.png` });

  await cards.nth(1).getByTestId('card-hide').click();
  await page.getByTestId('confirm-yes').click();
  await expect(cards).toHaveCount(3);
  expect(cloud.list('photos').find((p) => p.id === ids[1])).toMatchObject({ hidden: true });
  await page.getByTestId('tab-out').click();
  await expect(cards).toHaveCount(1);
  await cards.first().getByTestId('card-comments').click();
  await page.getByTestId('comment-moderate').click();
  await expect(page.getByTestId('comment')).toContainText('Oculto');
  await page.getByTestId('comments-close').click();
  await cards.first().getByTestId('card-show').click();
  await expect(cards).toHaveCount(0);
  expect(cloud.list('photos').find((p) => p.id === ids[1])).toMatchObject({ hidden: false });
  expect(cloud.list('comments')).toMatchObject([{ hidden: true }]);
});
