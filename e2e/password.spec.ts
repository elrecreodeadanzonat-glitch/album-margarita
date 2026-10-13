import { expect, test } from './fixtures';
import { SHOTS, login } from './helpers';
import { TEST_PASSWORD, lockCode } from './fakeFirestore';

test('cambiar la contraseña: la vieja deja de servir, la nueva abre el álbum', async ({ page, cloud }, info) => {
  await login(page);
  await page.getByTestId('cover-settings').click();
  const settings = page.getByTestId('settings');
  await expect(settings).toBeVisible();

  await page.getByTestId('pw-current').fill('no es esta');
  await page.getByTestId('pw-new').fill('Nueva Clave 70');
  await page.getByTestId('pw-again').fill('Nueva Clave 70');
  await page.getByTestId('pw-change').click();
  await expect(page.getByTestId('pw-error')).toHaveText('La contraseña actual no es correcta.');

  await page.getByTestId('pw-current').fill(TEST_PASSWORD);
  await page.getByTestId('pw-again').fill('Nueva Clave 71');
  await page.getByTestId('pw-change').click();
  await expect(page.getByTestId('pw-error')).toHaveText('Las dos contraseñas nuevas no son iguales.');

  await page.getByTestId('pw-new').fill('abc');
  await page.getByTestId('pw-again').fill('abc');
  await page.getByTestId('pw-change').click();
  await expect(page.getByTestId('pw-error')).toContainText('muy corta');

  await page.getByTestId('pw-new').fill('Nueva Clave 70');
  await page.getByTestId('pw-again').fill('nueva clave 70');
  await page.getByTestId('pw-change').click();
  await expect(page.getByTestId('pw-done')).toContainText('la contraseña cambió');
  await page.screenshot({ path: `${SHOTS}/opciones-${info.project.name}.png` });
  expect(cloud.docs.has(`vault/${lockCode('Nueva Clave 70')}`)).toBe(true);
  expect(cloud.docs.has(`vault/${lockCode(TEST_PASSWORD)}`)).toBe(false);

  // this device stays inside
  await page.reload();
  await expect(page.getByTestId('cover')).toBeVisible({ timeout: 15_000 });

  // the old password no longer opens it; the new one does
  await page.getByTestId('cover-settings').click();
  await page.getByTestId('logout').click();
  await page.getByTestId('gate-password').fill(TEST_PASSWORD);
  await page.getByTestId('gate-enter').click();
  await expect(page.getByTestId('gate-error')).toBeVisible();
  await page.getByTestId('gate-password').fill('NUEVA CLAVE 70');
  await page.getByTestId('gate-enter').click();
  await expect(page.getByTestId('cover')).toBeVisible({ timeout: 15_000 });
});
