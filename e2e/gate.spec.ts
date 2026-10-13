import { expect, test } from './fixtures';
import { SHOTS, login } from './helpers';
import { TEST_PASSWORD, lockCode } from './fakeFirestore';

test('la contraseña abre el álbum; una equivocada no; mayúsculas y espacios no importan', async ({ page }, info) => {
  await page.goto('./');
  await expect(page.getByTestId('gate')).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.getByTestId('gate')).toContainText('Este álbum es privado');
  await page.screenshot({ path: `${SHOTS}/contrasena-${info.project.name}.png` });

  await page.getByTestId('gate-password').fill('otra cosa');
  await page.getByTestId('gate-enter').click();
  await expect(page.getByTestId('gate-error')).toContainText('Esa no es la contraseña');

  await page.getByTestId('gate-password').fill(`  ${TEST_PASSWORD.toUpperCase().replace(/ /g, '   ')} `);
  await page.getByTestId('gate-enter').click();
  await expect(page.getByTestId('cover')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.title()).toBe('Álbum de Prueba');
  // nothing about the password stays on the device: only the album key and the lock's code
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored.toLowerCase()).not.toContain('feliz');
});

test('«Recordarme»: al volver a abrir entra directo; «Cerrar sesión» vuelve a pedirla', async ({ page, context }) => {
  await login(page);
  await page.reload();
  await expect(page.getByTestId('cover')).toBeVisible({ timeout: 15_000 });
  const other = await context.newPage();
  await other.goto('./');
  await expect(other.getByTestId('cover')).toBeVisible({ timeout: 15_000 });
  await other.close();

  await page.getByTestId('cover-settings').click();
  await page.getByTestId('logout').click();
  await expect(page.getByTestId('gate')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('gate')).toBeVisible();
});

test('sin «Recordarme», otra pestaña vuelve a pedir la contraseña', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop', 'basta en un tamaño');
  await login(page, TEST_PASSWORD, false);
  const other = await context.newPage();
  await other.goto('./');
  await expect(other.getByTestId('gate')).toBeVisible();
});

test('si la contraseña cambió en otro aparato, la vuelve a pedir y lo dice', async ({ page, cloud }) => {
  await login(page);
  cloud.docs.delete(`vault/${lockCode(TEST_PASSWORD)}`);
  await page.reload();
  await expect(page.getByTestId('gate')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('gate')).toContainText('La contraseña del álbum cambió');
});

test('«¿Olvidaste la contraseña?» dice a quién escribirle', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: '¿Olvidaste la contraseña?' }).click();
  const help = page.getByTestId('gate-help');
  await expect(help).toContainText('andresserrano5@gmail.com');
  await expect(help.getByRole('link', { name: 'Escribirle un correo' })).toHaveAttribute('href', /^mailto:andresserrano5@gmail\.com\?subject=/);
});
