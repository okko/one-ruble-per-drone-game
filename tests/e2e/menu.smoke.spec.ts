import { test, expect } from '@playwright/test';

/**
 * Phase-5 shell smoke (docs/areas/07-main-menu.md §9, docs/areas/08-highscores.md §8, docs/
 * compatibility.md §9). Runs on the full matrix (Chromium + WebKit + Firefox + emulated iPhone):
 * Boot routes to the Main Menu, "Start New Shift" begins a run, and the menu navigates to a sibling
 * scene (Highscores) and back. The active scene is read from the harmless `window.__scene` mirror.
 */
const sceneId = (): string =>
  (window as Window & { __scene?: { id: string } }).__scene?.id ?? '';

test('boots to the Main Menu, starts a run, and navigates to Highscores and back', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  const canvas = page.locator('#game');
  await expect(canvas).toBeVisible();

  // Boot routes straight to the Main Menu.
  await expect.poll(() => page.evaluate(sceneId), { timeout: 5000 }).toBe('MainMenu');

  // Navigate down to "Highscores" (option #2) and open it, then return to the menu.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(sceneId), { timeout: 5000 }).toBe('Highscores');
  await page.keyboard.press('Enter'); // back
  await expect.poll(() => page.evaluate(sceneId), { timeout: 5000 }).toBe('MainMenu');

  // "Start New Shift" is the first option; Enter begins a run.
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(sceneId), { timeout: 5000 }).toBe('Playing');

  expect(errors).toEqual([]);
});
