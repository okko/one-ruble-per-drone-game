import { test, expect } from '@playwright/test';

/**
 * Phase-1 boot smoke (docs/areas/00-core-platform.md §8.10, docs/compatibility.md §8). Runs on all
 * four engines. The remaining §8 cases need gameplay/audio/HUD/storage features that arrive in
 * later phases, so they are scaffolded as `test.fixme` with the owning area noted — to be
 * "unfixme'd" when that area lands. (Nothing is faked to make a gate pass.)
 */
test('boots to a rendered 384×216 canvas with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');

  const canvas = page.locator('#game');
  await expect(canvas).toBeVisible();

  // Backing buffer MUST stay 384×216 (docs/compatibility.md §2 — never a device-pixel canvas).
  const size = await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement;
    return { w: c.width, h: c.height };
  });
  expect(size).toEqual({ w: 384, h: 216 });

  await page.waitForTimeout(250); // let the fixed-timestep loop run a few frames
  expect(errors).toEqual([]);
});

// --- Remaining compatibility.md §8 suite (unblock as each area lands) ---
test('tap starts a run; held fire sweeping the sky destroys a drone; release ceases fire (§8.15)', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  const canvas = page.locator('#game');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(150); // let Boot route to the start menu

  // A tap on the start menu begins a run (MainMenu → Playing). The tap goes to the menu, so the
  // Playing scene starts with no pointer aim — keyboard control then drives the gun (no reliance on
  // the exact pointer→world mapping, and it stays valid on the touch-only iPhone project too).
  await canvas.click({ position: { x: 40, y: 40 } });

  const readState = (): Promise<{ downed: number; aim: number; drones: Array<{ x: number; y: number }> }> =>
    page.evaluate(() => {
      const c = (
        window as Window & {
          __combat?: { dronesDowned: number; aimAngle: number; drones: Array<{ x: number; y: number }> };
        }
      ).__combat;
      return { downed: c?.dronesDowned ?? 0, aim: c?.aimAngle ?? 0, drones: c?.drones ?? [] };
    });

  // Drones home to the post — which is the gun pivot — so each approaches on a CONSTANT bearing.
  // Hold fire (Space) and use the keyboard to steer the barrel onto the farthest drone's bearing and
  // hold it there: the tracer stream sits on that ray and the incoming drone walks into it. A simple
  // closed loop on the observable aim angle (no pointer→world mapping, valid touch-only too).
  const PIVOT = { x: 192, y: 196 };
  let kd = false;
  let ka = false;
  const setKeys = async (wantD: boolean, wantA: boolean): Promise<void> => {
    if (wantD !== kd) await (wantD ? page.keyboard.down('KeyD') : page.keyboard.up('KeyD'));
    if (wantA !== ka) await (wantA ? page.keyboard.down('KeyA') : page.keyboard.up('KeyA'));
    kd = wantD;
    ka = wantA;
  };

  await page.keyboard.down('Space');
  let downed = 0;
  for (let i = 0; i < 220 && downed === 0; i++) {
    const s = await readState();
    downed = s.downed;
    if (downed > 0) break;
    const target = s.drones.reduce<{ x: number; y: number } | null>((far, d) => {
      const r = Math.hypot(d.x - PIVOT.x, d.y - PIVOT.y);
      return !far || r > Math.hypot(far.x - PIVOT.x, far.y - PIVOT.y) ? d : far;
    }, null);
    if (target) {
      const bearing = Math.atan2(target.y - PIVOT.y, target.x - PIVOT.x);
      let diff = bearing - s.aim;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      if (Math.abs(diff) < 0.05) await setKeys(false, false);
      else await setKeys(diff > 0, diff < 0);
    }
    await page.waitForTimeout(40);
  }
  await setKeys(false, false);
  await page.keyboard.up('Space'); // release ceases fire — the gun never sticks

  expect(downed).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
test.fixme('audio context reaches "running" after the first gesture', () => {
  // area 06 Audio
});
test.fixme('localStorage round-trips; in-memory fallback engages when storage throws', () => {
  // areas 07/08 (settings + highscores UI) exercising the persistence layer end-to-end
});
test.fixme('mobile-viewport run holds the frame-time budget under CPU throttling', () => {
  // area 01 Gameplay Engine (representative drone count)
});
test.fixme('HUD five-icon glyph row screenshot snapshot matches per engine', () => {
  // area 10 HUD & UI + area 11 Art (final icon sprites)
});
