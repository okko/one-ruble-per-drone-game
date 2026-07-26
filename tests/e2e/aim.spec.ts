import { test, expect, type Page } from '@playwright/test';
import * as THREE from 'three';
import { ACTION_Z, ARENA_CX, ax, ay, POST_Y } from '../../src/render/three/mapping';
import { createCameraDirector } from '../../src/render/three/camera-director';

/**
 * The aim gate: the barrel goes where the player points.
 *
 * This is the one promise the shooting scene makes, and it turned out to be the one thing nothing
 * checked. `screenToWorld` casts a ray from a camera that is deliberately kept OUT of the scene, so
 * that no framing change can disturb it — which also means the renderer never walks it and nothing
 * ever refreshed its world matrix. `Raycaster.setFromCamera` reads exactly that matrix, both for the
 * ray's origin and for unprojecting its direction, so every pointer aim was cast from the world
 * origin instead of from the soldier's eye. Every unit test passed throughout: the mapping module
 * was right, the camera pose was right, and the defect lived in the single line joining them.
 *
 * It has to be an end-to-end test, because that join only exists in a browser. And it has to be
 * about the ANGLE rather than about kills: a gun firing ten rounds a second into a sky full of
 * drones will eventually hit one however badly it is aimed, and the first draft of this file — which
 * only asked for a kill — passed against the bug.
 *
 * The projection below is written from scratch against three's own camera. Reusing the view's
 * would have agreed with the fault.
 */

type CombatWindow = Window & { __combat?: { aimAngle: number }; __scene?: { id: string } };

/** The shooting pose, straight from the director — the same one the view must aim through. */
const pose = createCameraDirector('shooting', { floor: 1, time: 0 }).aimPose;

/** Arena position → canvas pixel, for whatever viewport the run actually got. */
function project(arenaX: number, arenaY: number, w: number, h: number): { x: number; y: number } {
  const camera = new THREE.PerspectiveCamera(pose.fov, w / h, 0.1, 400);
  camera.position.set(pose.eye.x, pose.eye.y, pose.eye.z);
  camera.lookAt(pose.look.x, pose.look.y, pose.look.z);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const ndc = new THREE.Vector3(ax(arenaX), ay(arenaY), ACTION_Z).project(camera);
  return { x: ((ndc.x + 1) / 2) * w, y: ((1 - ndc.y) / 2) * h };
}

function viewport(page: Page): { width: number; height: number } {
  const size = page.viewportSize();
  expect(size, 'the projection needs a known viewport').not.toBeNull();
  return size ?? { width: 1280, height: 720 };
}

async function startRun(page: Page): Promise<void> {
  await page.goto('/');
  const start = page.locator('#ui .ui-menu-item').first();
  await expect(start).toBeVisible({ timeout: 5000 });
  await start.click();
  await expect
    .poll(() => page.evaluate(() => (window as CombatWindow).__scene?.id), { timeout: 5000 })
    .toBe('Playing');
}

const readAim = (page: Page): Promise<number | null> =>
  page.evaluate(() => (window as CombatWindow).__combat?.aimAngle ?? null);

test('the barrel points where the pointer points', async ({ page }) => {
  await startRun(page);
  const { width, height } = viewport(page);

  // Spread across the arena — left, right, and straight up the middle. One sample can agree with a
  // broken mapping by coincidence; three that bracket the playfield cannot.
  for (const [arenaX, arenaY] of [
    [120, 90],
    [280, 60],
    [ARENA_CX, 100],
  ] as const) {
    const at = project(arenaX, arenaY, width, height);
    const want = Math.atan2(arenaY - POST_Y, arenaX - ARENA_CX);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    // Polled rather than sampled once after a fixed wait. The barrel slews at a finite rate and the
    // meters put a slow sway on top of it, so any single sample is really a measurement of how many
    // frames this engine managed while three others ran beside it. Waiting for the barrel to pass
    // through the mark instead is indifferent to that, and still fatal to the fault being guarded
    // against: an aim cast from the wrong origin sits tens of degrees off and never arrives.
    await expect
      .poll(async () => Math.abs(((await readAim(page)) ?? 0) - want), { timeout: 4000 })
      // A degree and a half — pointer coordinates land on whole pixels, so this is not exact.
      .toBeLessThan(0.025);
    await page.mouse.up();
  }
});

/*
 * There is no companion test here asserting that a tracked drone actually dies, and that is a
 * deliberate omission rather than an oversight. It was written, and it was thrown away twice over:
 * it passed with the defect still in place — a gun putting ten rounds a second into a sky this busy
 * clips something however it is aimed — and it then failed on whichever engine happened to be
 * starved by the three running beside it, because a real-time closed loop over a software rasteriser
 * measures the machine as much as the game. A check that is blind to the bug and sensitive to load
 * is worse than none. The angle above is exact, is the actual quantity that broke, and holds on all
 * four engines.
 */
