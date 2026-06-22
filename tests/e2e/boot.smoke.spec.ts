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
  await page.waitForTimeout(150); // let Boot route to the Main Menu

  // The Main Menu opens with "Start New Shift" pre-selected. The tap is the first gesture (it unlocks
  // audio; it lands on empty menu space, not an option), then Enter begins a run (MainMenu → Playing).
  // Starting from the keyboard leaves the Playing scene with no pointer aim, so keyboard control then
  // drives the gun (no reliance on the pointer→world mapping, and it stays valid on touch-only iPhone).
  await canvas.click({ position: { x: 40, y: 40 } });
  await page.keyboard.press('Enter');

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
test('audio context reaches "running" after the first gesture (area 06, §8.13)', async ({ page, browserName }) => {
  // §8.13 scopes the unlock smoke to the WebKit/iPhone path — the iOS-critical case. browserName
  // 'webkit' covers both the `webkit` and `mobile-webkit` projects. (Headless Firefox never transitions
  // AudioContext on a synthetic gesture, and Chromium is not the documented target.)
  test.skip(browserName !== 'webkit', 'unlock smoke targets the WebKit/iPhone path (§8.13)');

  await page.goto('/');
  const canvas = page.locator('#game');
  await expect(canvas).toBeVisible();

  // The context is created suspended; the first trusted tap (which also starts a run) must unlock it
  // synchronously in the gesture handler — the iOS-critical path (docs/areas/06-audio.md §3.2).
  await canvas.click({ position: { x: 40, y: 40 } });
  await expect
    .poll(() => page.evaluate(() => (window as Window & { __audio?: { state: string } }).__audio?.state), {
      timeout: 5000,
    })
    .toBe('running');
});

test('HUD meter-icon row matches the committed snapshot per engine (area 10, §8.16)', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#game');
  await expect(canvas).toBeVisible();

  // Start a run so the HUD overlay renders, then snapshot IMMEDIATELY — before the first drone spawns —
  // so only the static, procedural meter icons (😴🍞💧🚬💩) sit in the clipped column (no live bars/drones).
  // "Start New Shift" is pre-selected on the Main Menu; Enter begins the run (the tap just unlocks audio).
  await canvas.click({ position: { x: 40, y: 40 } });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(120);

  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const scale = Math.round(box.width / 384); // integer-scaled (compatibility.md §2)
  // Internal x:[0,13) is the icon column (bars start at x=14); y:[0,46) covers the five stacked icons.
  const clip = { x: box.x, y: box.y, width: 13 * scale, height: 46 * scale };
  await expect(page).toHaveScreenshot('hud-icon-row.png', { clip, maxDiffPixelRatio: 0.02 });
});

test.fixme('localStorage round-trips; in-memory fallback engages when storage throws', () => {
  // areas 07/08 (settings + highscores UI) exercising the persistence layer end-to-end
});
test.fixme('mobile-viewport run holds the frame-time budget under CPU throttling', () => {
  // area 01 Gameplay Engine (representative drone count)
});
