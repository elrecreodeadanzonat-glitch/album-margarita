import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { TEST_PASSWORD } from './fakeFirestore';

export const SHOTS = 'tests/screenshots';

/** a test file (photos and videos made for the tests, see e2e/media) */
export const media = (name: string) => readFileSync(new URL(`./media/${name}`, import.meta.url));
export const mediaFile = (name: string, mimeType: string) => ({ name, mimeType, buffer: media(name) });
/** a test photo as the data: URL the album keeps */
export const dataUrl = (name: string) => `data:image/webp;base64,${media(name).toString('base64')}`;

/** the password screen → the album's cover */
export async function login(page: Page, password = TEST_PASSWORD, remember = true) {
  await page.goto('./');
  await expect(page.getByTestId('gate')).toBeVisible();
  await page.getByTestId('gate-password').fill(password);
  if (!remember) await page.getByTestId('gate-remember').uncheck();
  await page.getByTestId('gate-enter').click();
  await expect(page.getByTestId('cover')).toBeVisible({ timeout: 15_000 });
}

/** from the cover into the album */
export async function openAlbum(page: Page) {
  const btn = page.getByTestId('open-book');
  await expect(btn).toBeEnabled({ timeout: 15_000 });
  await btn.click();
  await expect(page.getByTestId('viewer')).toBeVisible({ timeout: 8000 });
}

export const viewer = (page: Page) => page.getByTestId('viewer');

export async function currentIndex(page: Page): Promise<number> {
  return Number(await viewer(page).getAttribute('data-index'));
}

/** id of the photo in the current page, once its image has decoded */
export async function currentPhoto(page: Page): Promise<string> {
  const img = page.locator('.layer.is-current img[data-photo-id]').first();
  await expect.poll(async () => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), { timeout: 15_000 }).toBe(true);
  return (await img.getAttribute('data-photo-id'))!;
}
