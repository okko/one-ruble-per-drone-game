// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createStartScene } from './start-scene';
import type { Renderer } from '../render/renderer';

function fakeRenderer(): Renderer & { calls: number } {
  const rec = {
    width: 384 as const,
    height: 216 as const,
    alpha: 0,
    calls: 0,
    clear: () => void rec.calls++,
    drawSprite: () => void rec.calls++,
    fillRect: () => void rec.calls++,
    text: () => void rec.calls++,
  };
  return rec;
}

describe('StartScene', () => {
  it('renders the title without throwing', () => {
    const scene = createStartScene(() => {});
    const r = fakeRenderer();
    scene.render(r);
    expect(r.calls).toBeGreaterThan(0);
  });

  it('starts on fireDown, pointer-down, and key-down', () => {
    for (const e of [
      { type: 'fireDown' } as const,
      { type: 'pointer', world: { x: 1, y: 2 }, down: true } as const,
      { type: 'key', code: 'Space', down: true } as const,
    ]) {
      const onStart = vi.fn();
      createStartScene(onStart).onInput(e);
      expect(onStart).toHaveBeenCalledTimes(1);
    }
  });

  it('does not start on release/aim events', () => {
    const onStart = vi.fn();
    const scene = createStartScene(onStart);
    scene.onInput({ type: 'fireUp' });
    scene.onInput({ type: 'aim', world: { x: 1, y: 2 } });
    scene.onInput({ type: 'pointer', world: { x: 1, y: 2 }, down: false });
    scene.onInput({ type: 'key', code: 'Space', down: false });
    expect(onStart).not.toHaveBeenCalled();
  });
});
