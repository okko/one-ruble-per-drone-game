/**
 * Minimal "press to start" entry scene — a temporary stand-in for the real Main Menu (area 07, a
 * later phase) so Phase 3 is actually playable: it shows the title and starts a run on the first
 * input (tap, click, or key). Kept tiny and decoupled via an `onStart` callback so it is trivially
 * testable and carries no transition/persistence knowledge of its own.
 */
import type { Scene } from './scene';
import type { InputEvent } from '../input/input';
import type { Renderer } from '../render/renderer';

export function createStartScene(onStart: () => void): Scene {
  return {
    enter(): void {},
    update(): void {},
    render(r: Renderer): void {
      r.clear('skyDayTop');
      r.text('ONE RUBLE PER DRONE', r.width / 2, r.height / 2 - 10, { align: 'center', color: 'cream' });
      r.text('tap or press a key to start', r.width / 2, r.height / 2 + 6, { align: 'center', color: 'cream' });
    },
    onInput(e: InputEvent): void {
      const start = e.type === 'fireDown' || (e.type === 'pointer' && e.down) || (e.type === 'key' && e.down);
      if (start) onStart();
    },
    exit(): void {},
  };
}
