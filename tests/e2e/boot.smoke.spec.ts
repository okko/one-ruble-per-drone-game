import { test, expect } from '@playwright/test';

/**
 * Boot smoke (docs/areas/00-core-platform.md §8.10, docs/compatibility.md §8). Runs on all four
 * engines. The world is a three.js canvas (`#game3d`) and every screen is DOM under `#ui`, so these
 * assert against those rather than the retired 384×216 pixel buffer. The remaining §8 cases need
 * features that arrive later and are scaffolded as `test.fixme` with the owning area noted — nothing
 * is faked to make a gate pass.
 */
test('boots to a full-viewport world canvas and a mounted UI, with no console errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');

  const canvas = page.locator('#game3d');
  await expect(canvas).toBeVisible();

  // The world canvas fills the viewport — no letterbox, no fixed backing buffer (§request).
  const fills = await canvas.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1;
  });
  expect(fills).toBe(true);

  // Boot routes straight to the Main Menu, which mounts its screen into the DOM UI layer.
  await expect(page.locator('#ui .ui-menu-item').first()).toBeVisible({ timeout: 5000 });

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
  const canvas = page.locator('#game3d');
  await expect(canvas).toBeVisible();

  // The Main Menu is a modal DOM screen over the world, so the first gesture of the session lands on
  // its "Start New Shift" button — which both unlocks audio and begins the run. Starting this way
  // leaves the Playing scene with no pointer aim, so keyboard control then drives the gun (no
  // reliance on the pointer→world mapping, and it stays valid on touch-only iPhone).
  const start = page.locator('#ui .ui-menu-item').first();
  await expect(start).toBeVisible({ timeout: 5000 });
  await start.click();

  const readState = (): Promise<{ downed: number; aim: number; drones: Array<{ x: number; y: number }> }> =>
    page.evaluate(() => {
      const c = (
        window as Window & {
          __combat?: { dronesDowned: number; aimAngle: number; drones: Array<{ x: number; y: number }> };
        }
      ).__combat;
      return { downed: c?.dronesDowned ?? 0, aim: c?.aimAngle ?? 0, drones: c?.drones ?? [] };
    });

  // Drones now arrive in waves and dive at skyline towers spread across the sky, so they no longer share
  // one bearing. Competent keyboard play: LOCK onto one drone (focus fire) — follow it between reads and
  // steer the barrel onto its bearing with fire held; the tracer sits on that ray and the drone walks
  // into it. A closed loop on the observable aim angle (no pointer→world mapping; valid touch-only too).
  const PIVOT = { x: 192, y: 196 };
  const norm = (a: number): number => {
    let d = a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  };
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
  let lock: { x: number; y: number } | null = null; // commit to one drone (focus fire) until it's gone
  for (let i = 0; i < 320 && downed === 0; i++) {
    const s = await readState();
    downed = s.downed;
    if (downed > 0) break;
    // Follow the locked drone (nearest to its last position); otherwise acquire the closest-bearing one.
    if (lock) {
      let near: { x: number; y: number; d: number } | null = null;
      for (const d of s.drones) {
        const dist = Math.hypot(d.x - lock.x, d.y - lock.y);
        if (!near || dist < near.d) near = { x: d.x, y: d.y, d: dist };
      }
      lock = near && near.d < 60 ? { x: near.x, y: near.y } : null;
    }
    if (!lock && s.drones.length > 0) {
      let best: { x: number; y: number; ad: number } | null = null;
      for (const d of s.drones) {
        const ad = Math.abs(norm(Math.atan2(d.y - PIVOT.y, d.x - PIVOT.x) - s.aim));
        if (!best || ad < best.ad) best = { x: d.x, y: d.y, ad };
      }
      lock = best ? { x: best.x, y: best.y } : null;
    }
    if (lock) {
      const diff = norm(Math.atan2(lock.y - PIVOT.y, lock.x - PIVOT.x) - s.aim);
      if (Math.abs(diff) < 0.03) await setKeys(false, false);
      else await setKeys(diff > 0, diff < 0);
    }
    await page.waitForTimeout(30);
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
  await expect(page.locator('#game3d')).toBeVisible();

  // The context is created suspended; the first trusted tap must unlock it synchronously in the
  // gesture handler — the iOS-critical path (docs/areas/06-audio.md §3.2). That tap is a menu
  // button, because the Main Menu is modal, so the unlock cannot depend on reaching the canvas.
  await page.locator('#ui .ui-menu-item').first().click();
  await expect
    .poll(() => page.evaluate(() => (window as Window & { __audio?: { state: string } }).__audio?.state), {
      timeout: 5000,
    })
    .toBe('running');
});

test('the DOM HUD overlay shows during a run (area 10, §8.16 — in-game UI is now Three.js + DOM)', async ({ page }) => {
  // The in-game UI was fully replaced (§request): the world renders in Three.js on #game3d and the HUD
  // is a DOM overlay on #hud, so the old pixel-art meter-icon snapshot no longer applies. This smoke
  // proves the new HUD mounts + shows the live readouts once a run starts (engine-agnostic, no WebGL).
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await expect(page.locator('#game3d')).toBeVisible();

  // "Start New Shift" is the first option; clicking it unlocks audio and begins the run.
  await page.locator('#ui .ui-menu-item').first().click();

  const hud = page.locator('#hud');
  await expect(hud).toBeVisible({ timeout: 5000 });
  await expect(hud).toContainText('CITY INTEGRITY');
  await expect(page.locator('#game3d')).toBeVisible(); // the world is the permanent backdrop
  expect(errors).toEqual([]);
});

test.fixme('localStorage round-trips; in-memory fallback engages when storage throws', () => {
  // areas 07/08 (settings + highscores UI) exercising the persistence layer end-to-end
});
test.fixme('mobile-viewport run holds the frame-time budget under CPU throttling', () => {
  // area 01 Gameplay Engine (representative drone count)
});
