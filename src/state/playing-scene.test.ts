// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createPlayingScene } from './playing-scene';
import { createHudEconomy } from '../ui/hud/economy-adapter';
import { createTestContext } from '../test-support/context';
import type { GameOverlay } from '../ui/game-overlay';
import type { GameState } from './game-state';
import type { PlayingViewState } from './playing-view';
import type { HudEconomy, ResidentMenuModel } from '../ui/hud/types';
import type { ResidentIntent } from '../core/events';

/** A stub economy offering one buyable service for the penthouse resident (floor 32 = oligarch). */
function stubEconomy(): HudEconomy {
  const model: ResidentMenuModel = {
    residents: [
      {
        residentId: 'oligarch',
        name: 'Mr. Volkov',
        floor: 32,
        reputation: 60,
        services: [{ id: 'water', label: 'Imported Mineral Water', costRubles: 5, affordable: true }],
        favors: [],
      },
    ],
  };
  return { getAvailableInteractions: () => model };
}

/** A capturing overlay: records the last `PlayingViewState` the scene rendered, for feedback assertions. */
function capturingOverlay(): { overlay: GameOverlay; last: () => PlayingViewState | null } {
  let last: PlayingViewState | null = null;
  return {
    overlay: {
      update: (_gs: GameState, vs: PlayingViewState): void => {
        last = vs;
      },
      setVisible: (): void => {},
      dispose: (): void => {},
    },
    last: () => last,
  };
}

describe('PlayingScene', () => {
  it('enters, fires via keyboard, renders without a view, and exits cleanly', () => {
    const ctx = createTestContext({ seed: 1 });
    const scene = createPlayingScene();
    const shots: number[] = [];
    ctx.events.on('shotFired', () => shots.push(1));

    scene.enter(undefined, ctx);
    scene.onInput({ type: 'key', code: 'Space', down: true });
    scene.onInput({ type: 'key', code: 'KeyD', down: true });
    for (let i = 0; i < 60; i++) scene.update(1 / 60, ctx);
    expect(shots.length).toBeGreaterThan(0); // keyboard Space fired the gun through the engine

    expect(() => scene.render(0)).not.toThrow(); // no view injected → no-op, no crash

    scene.exit();
    const before = shots.length;
    scene.update(1 / 60, ctx);
    expect(shots.length).toBe(before); // engine disposed: no further shots
  });

  it('handles pointer aim + hold-to-fire and release without throwing', () => {
    const ctx = createTestContext({ seed: 2 });
    const scene = createPlayingScene();
    const shots: number[] = [];
    ctx.events.on('shotFired', () => shots.push(1));

    scene.enter(undefined, ctx);
    scene.onInput({ type: 'pointer', world: { x: 200, y: 40 }, down: true });
    scene.onInput({ type: 'aim', world: { x: 210, y: 40 } });
    scene.onInput({ type: 'fireDown' });
    for (let i = 0; i < 24; i++) scene.update(1 / 60, ctx);
    const held = shots.length;
    expect(held).toBeGreaterThan(0);

    scene.onInput({ type: 'fireUp' });
    for (let i = 0; i < 24; i++) scene.update(1 / 60, ctx);
    expect(shots.length).toBe(held); // gun never sticks

    scene.exit();
  });

  it('render is a no-op before enter (no GameState yet)', () => {
    const scene = createPlayingScene();
    expect(() => scene.render(0)).not.toThrow();
  });

  it('E enters the building; ↑/↓ walk floors; stepping up off the roof returns to shooting (no fire inside)', () => {
    const ctx = createTestContext({ seed: 3 });
    const scene = createPlayingScene({ settings: { reducedFlash: false, largeHudText: false, pauseWhilePanelOpen: false, residentPanelKey: 'KeyE' } });
    const shots: number[] = [];
    ctx.events.on('shotFired', () => shots.push(1));
    scene.enter(undefined, ctx);

    // Hold fire, then step inside: the trigger drops and the gun goes quiet while walking.
    scene.onInput({ type: 'fireDown' });
    scene.onInput({ type: 'key', code: 'KeyE', down: true }); // shooting → interior (floor 32)
    const beforeInside = shots.length;
    for (let i = 0; i < 30; i++) scene.update(1 / 60, ctx);
    expect(shots.length).toBe(beforeInside); // inside ⇒ IDLE intent, no shots

    // Arrow-down two floors, then arrow up three times: floor 30 → 31 → 32 → roof (shooting).
    scene.onInput({ type: 'key', code: 'ArrowDown', down: true });
    scene.onInput({ type: 'key', code: 'ArrowDown', down: true });
    scene.onInput({ type: 'key', code: 'ArrowUp', down: true });
    scene.onInput({ type: 'key', code: 'ArrowUp', down: true });
    scene.onInput({ type: 'key', code: 'ArrowUp', down: true }); // off the roof → shooting

    // Back to shooting: holding fire again resumes shots.
    scene.onInput({ type: 'fireDown' });
    for (let i = 0; i < 30; i++) scene.update(1 / 60, ctx);
    expect(shots.length).toBeGreaterThan(beforeInside);

    scene.exit();
  });

  it('inside, ENTER on a resident option emits a residentIntent (buyService)', () => {
    const ctx = createTestContext({ seed: 4 });
    const intents: ResidentIntent[] = [];
    ctx.events.on('residentIntent', (p) => intents.push(p));
    const scene = createPlayingScene({ economy: stubEconomy() });
    scene.enter(undefined, ctx);

    scene.onInput({ type: 'key', code: 'KeyE', down: true }); // enter at floor 32 (oligarch)
    scene.render(0); // builds the option list for the current floor
    scene.onInput({ type: 'key', code: 'Enter', down: true }); // confirm the first option

    expect(intents).toContainEqual({ kind: 'buyService', residentId: 'oligarch', serviceId: 'water' });
    scene.exit();
  });

  it('buying an affordable service pops a result dialog with the rubles spent + what it produced', () => {
    const ctx = createTestContext({ seed: 5 });
    const cap = capturingOverlay();
    const scene = createPlayingScene({ economy: createHudEconomy(ctx.content), overlay: cap.overlay });
    scene.enter(undefined, ctx);

    // Bank rubles the real way (player kills award income), so the penthouse water becomes affordable.
    for (let i = 0; i < 6; i++) {
      ctx.events.emit('droneDestroyed', { id: i, kind: 'scout', byPlayer: true, pos: { x: 0, y: 0 } });
    }

    scene.onInput({ type: 'key', code: 'KeyE', down: true }); // interior at floor 32 (oligarch)
    scene.render(0); // build the option list (water is option 0)
    scene.onInput({ type: 'key', code: 'Enter', down: true }); // buy it
    scene.render(0); // project the result into the view model

    const fb = cap.last()?.feedback;
    expect(fb?.ok).toBe(true);
    expect(fb?.kind).toBe('service');
    expect(fb?.title).toBe('Imported Mineral Water');
    expect(fb?.lines.some((l) => l.tone === 'cost' && l.text.includes('₽5'))).toBe(true); // money reduced
    expect(fb?.lines.some((l) => l.text.includes('Thirst'))).toBe(true); // what it produced (relief)
    scene.exit();
  });

  it('confirming an unaffordable service explains why, instead of doing nothing', () => {
    const ctx = createTestContext({ seed: 6 });
    const cap = capturingOverlay();
    const scene = createPlayingScene({ economy: createHudEconomy(ctx.content), overlay: cap.overlay });
    scene.enter(undefined, ctx); // broke: rubles start at 0

    scene.onInput({ type: 'key', code: 'KeyE', down: true }); // interior at floor 32 (oligarch)
    scene.render(0);
    scene.onInput({ type: 'key', code: 'Enter', down: true }); // try to buy the ₽5 water with ₽0
    scene.render(0); // project the result into the view model

    const fb = cap.last()?.feedback;
    expect(fb?.ok).toBe(false);
    expect(fb?.lines[0]?.text).toContain('₽5'); // tells the player the price they can't meet
    scene.exit();
  });
});
