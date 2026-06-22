// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createPlayingScene } from './playing-scene';
import { createTestContext } from '../test-support/context';
import type { Renderer } from '../render/renderer';

/** A no-op Renderer that records draw calls so we can assert the scene drew without a real canvas. */
function fakeRenderer(): Renderer & { calls: number } {
  const rec = {
    width: 384 as const,
    height: 216 as const,
    alpha: 0,
    calls: 0,
    clear(): void {
      rec.calls++;
    },
    drawSprite(): void {
      rec.calls++;
    },
    fillRect(): void {
      rec.calls++;
    },
    text(): void {
      rec.calls++;
    },
  };
  return rec;
}

describe('PlayingScene', () => {
  it('enters, fires via keyboard, renders, and exits cleanly', () => {
    const ctx = createTestContext({ seed: 1 });
    const scene = createPlayingScene();
    const shots: number[] = [];
    ctx.events.on('shotFired', () => shots.push(1));

    scene.enter(undefined, ctx);
    scene.onInput({ type: 'key', code: 'Space', down: true });
    scene.onInput({ type: 'key', code: 'KeyD', down: true });
    for (let i = 0; i < 60; i++) scene.update(1 / 60, ctx);
    expect(shots.length).toBeGreaterThan(0); // keyboard Space fired the gun through the engine

    const r = fakeRenderer();
    scene.render(r);
    expect(r.calls).toBeGreaterThan(0);

    scene.exit();
    // After exit the engine is disposed: further shots are no longer produced.
    const before = shots.length;
    scene.update(1 / 60, ctx);
    expect(shots.length).toBe(before);
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

    scene.onInput({ type: 'fireUp' }); // release / pointercancel
    for (let i = 0; i < 24; i++) scene.update(1 / 60, ctx);
    expect(shots.length).toBe(held); // gun never sticks

    scene.exit();
  });

  it('render is a no-op before enter (no GameState yet)', () => {
    const scene = createPlayingScene();
    const r = fakeRenderer();
    scene.render(r);
    expect(r.calls).toBe(0);
  });
});
