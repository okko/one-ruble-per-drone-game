import { test, expect, type Page } from '@playwright/test';

/**
 * The render cost gate (docs/compatibility.md §7).
 *
 * §7's rules — bounded draw calls, no allocations in the render loop, tier down rather than drop
 * frames — used to be prose that only a careful reviewer enforced. These read `window.__render`,
 * which mirrors `renderer.info` plus the tier actually in force, and make the rules machine-checked.
 *
 * The assertions are deliberately **tier-independent**, because the four engines in this matrix do
 * not agree on what hardware they are: headless Chromium rasterises in software, while Playwright's
 * WebKit reports a real Apple GPU. A tier that turns the post chain on renders the scene more than
 * once per frame (GTAO needs depth and normals), so draw calls are not comparable across engines.
 * Geometry count is: it is a function of the content tables alone, on every tier, which is exactly
 * what §7 says the scene graph must be.
 */

interface RenderStats {
  tier: 'low' | 'medium' | 'high';
  composited: boolean;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
}

type RenderWindow = Window & { __render?: { stats: RenderStats | null }; __scene?: { id: string } };

/**
 * Geometries the Playing scene may hold. One per skyline slab, per lit window, per floor of the
 * cut-away tower, plus the pooled drones and tracers. Lower it when instancing makes the scene
 * cheaper — that is the ratchet. A per-frame `new Geometry` blows through it within seconds.
 */
const GEOMETRY_CEILING = 600;

/** A runaway guard only. Not comparable across tiers; the growth checks below are the real gate. */
const DRAW_CALL_CEILING = 2000;

/** Start a run and settle into the Playing scene, where the world is at its most expensive. */
async function startRun(page: Page): Promise<void> {
  await page.goto('/');
  const start = page.locator('#ui .ui-menu-item').first();
  await expect(start).toBeVisible({ timeout: 5000 });
  await start.click();
  await expect
    .poll(() => page.evaluate(() => (window as RenderWindow).__scene?.id), { timeout: 5000 })
    .toBe('Playing');
}

function readStats(page: Page): Promise<RenderStats | null> {
  return page.evaluate(() => (window as RenderWindow).__render?.stats ?? null);
}

/**
 * Wait until the renderer has settled into its steady shape, then return that baseline.
 *
 * Two things arrive after the Playing scene does, and neither is instant under a loaded machine
 * running four browser engines at once:
 *
 *  - **The first drawn frame.** `renderer.info` reads all-zero until a frame has actually been
 *    rendered, so an eager baseline measures nothing at all and `drawCalls > 0` fails. This is how
 *    the gate first broke: it passed when run alone and failed in the full matrix.
 *  - **The post chain.** It is a lazily-imported chunk, so on tiers that use it the composer's
 *    render targets and full-screen quads appear later still. Baselining before they land counts a
 *    one-off, expected allocation as a leak.
 *
 * Waiting for both is not slack in the gate — if the scene genuinely never draws, this times out and
 * the test fails, which is the outcome §7 wants anyway.
 */
async function settledStats(page: Page): Promise<RenderStats> {
  await expect
    .poll(
      async () => {
        const s = await readStats(page);
        return s ? s.drawCalls > 0 && s.composited === (s.tier !== 'low') : null;
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  const settled = await readStats(page);
  expect(settled).not.toBeNull();
  if (!settled) throw new Error('unreachable: polled for stats above');
  return settled;
}

test('the scene graph is bounded: it does not grow with elapsed time (§7)', async ({ page }) => {
  test.setTimeout(45_000);
  await startRun(page);

  if ((await readStats(page)) === null) {
    test.skip(true, 'no WebGL on this engine — nothing is drawn to bound');
    return;
  }

  const first = await settledStats(page);

  expect(first.geometries, `geometries at rest: ${first.geometries}`).toBeLessThan(GEOMETRY_CEILING);
  expect(first.drawCalls, `draw calls at rest: ${first.drawCalls}`).toBeLessThan(DRAW_CALL_CEILING);

  // Long enough for drones, tracers and skyline damage to come and go many times over. Pools may
  // reach a high-water mark early; what must NOT happen is steady growth.
  await page.waitForTimeout(8000);
  const later = await readStats(page);
  expect(later).not.toBeNull();
  if (!later) return;

  expect(later.geometries, `geometries after 8s: ${later.geometries}`).toBeLessThan(GEOMETRY_CEILING);
  expect(later.drawCalls, `draw calls after 8s: ${later.drawCalls}`).toBeLessThan(DRAW_CALL_CEILING);
  // The sharpest leak detector there is: pooling means these are allocated once and reused. A small
  // allowance covers pools still filling toward their high-water mark during the window.
  expect(later.geometries, `${first.geometries} → ${later.geometries}`).toBeLessThanOrEqual(
    first.geometries + 8,
  );
  expect(later.textures, `${first.textures} → ${later.textures}`).toBeLessThanOrEqual(first.textures + 4);
});

test('the post chain exists exactly when the tier affords it (§7 tier down)', async ({ page }) => {
  await startRun(page);
  if ((await readStats(page)) === null) {
    test.skip(true, 'no WebGL on this engine — there is no tier to choose');
    return;
  }

  // The invariant §7 states: the low tier disables post-processing outright, and no tier that can
  // afford the chain is left rendering directly.
  const settled = await settledStats(page);
  expect(settled.composited).toBe(settled.tier !== 'low');
});

test('an emulated phone is never handed the high tier (§7)', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'desktop engine — nothing to assert');
  await startRun(page);
  const stats = await readStats(page);
  test.skip(stats === null, 'no WebGL on this engine — there is no tier to choose');

  // A phone reports a flattering core count and then thermally throttles minutes into a shift, far
  // longer than any boot-time probe can see. Mobile is capped whatever the numbers say.
  expect(stats?.tier).not.toBe('high');
});
