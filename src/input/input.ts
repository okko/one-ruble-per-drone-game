/**
 * Input contract (docs/areas/00-core-platform.md §3.9). The typed `InputEvent` union and `Input`
 * interface are the stable surface scenes consume; the Pointer-Events implementation
 * (`createInput`) is appended in the DOM-edge step. Defined here so the Scene contract can
 * reference `InputEvent` without pulling in any DOM code.
 */
import type { Vec2 } from '../core/math';

export type InputEvent =
  | { type: 'aim'; world: Vec2 }
  | { type: 'fireDown' }
  | { type: 'fireUp' }
  | { type: 'key'; code: string; down: boolean }
  | { type: 'pointer'; world: Vec2; down: boolean };

export interface Input {
  /** Whether a keyboard code is currently held (e.g. 'Space', 'KeyA'). */
  isDown(code: string): boolean;
  /** Detach all listeners. */
  dispose(): void;
}

export interface CreateInputOptions {
  /** Receives every typed input event. */
  onEvent: (e: InputEvent) => void;
  /** Called once, synchronously, on the first user gesture (for iOS audio unlock). */
  onFirstGesture?: () => void;
  /** Attach the window keyboard listeners (default true). Set false for a second pointer-only input
   *  (e.g. the 3D canvas) so keystrokes are not delivered twice. */
  keyboard?: boolean;
}

/**
 * Pointer-Events input (docs/compatibility.md §4). Touch-to-aim / hold-to-fire: a primary
 * `pointerdown` in the play area aims and starts firing, `pointermove` re-aims, `pointerup`
 * stops. `pointercancel` MUST also stop firing (iOS fires it on call/notification/system-gesture
 * interruption — otherwise the gun sticks). Only the primary pointer aims/fires. Keyboard
 * (A/D + Space) is retained for desktop. World mapping uses `getBoundingClientRect()` +
 * `clientX/clientY` (never `offsetX/offsetY`, which differ across browsers).
 */
export function createInput(
  canvas: HTMLElement,
  scaler: { screenToWorld(sx: number, sy: number): Vec2 },
  opts: CreateInputOptions,
): Input {
  const held = new Set<string>();
  let primaryId: number | null = null;
  let unlocked = false;

  function maybeUnlock(): void {
    if (unlocked) return;
    unlocked = true;
    opts.onFirstGesture?.();
  }

  function worldOf(e: PointerEvent): Vec2 {
    const rect = canvas.getBoundingClientRect();
    return scaler.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  }

  function onPointerDown(e: PointerEvent): void {
    maybeUnlock();
    if (!e.isPrimary || primaryId !== null) return; // secondary pointers don't hijack aim/fire
    primaryId = e.pointerId;
    e.preventDefault();
    opts.onEvent({ type: 'aim', world: worldOf(e) });
    opts.onEvent({ type: 'fireDown' });
  }

  function onPointerMove(e: PointerEvent): void {
    if (e.pointerId !== primaryId) return;
    e.preventDefault();
    opts.onEvent({ type: 'aim', world: worldOf(e) });
  }

  function endPrimary(e: PointerEvent): void {
    if (e.pointerId !== primaryId) return;
    e.preventDefault();
    primaryId = null;
    opts.onEvent({ type: 'fireUp' });
  }

  function onKeyDown(e: KeyboardEvent): void {
    maybeUnlock();
    held.add(e.code);
    opts.onEvent({ type: 'key', code: e.code, down: true });
  }

  function onKeyUp(e: KeyboardEvent): void {
    held.delete(e.code);
    opts.onEvent({ type: 'key', code: e.code, down: false });
  }

  const wantsKeyboard = opts.keyboard ?? true;
  canvas.addEventListener('pointerdown', onPointerDown as EventListener);
  canvas.addEventListener('pointermove', onPointerMove as EventListener);
  canvas.addEventListener('pointerup', endPrimary as EventListener);
  canvas.addEventListener('pointercancel', endPrimary as EventListener); // cancel ⇒ fire-up
  if (wantsKeyboard) {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
  }

  return {
    isDown: (code) => held.has(code),
    dispose(): void {
      canvas.removeEventListener('pointerdown', onPointerDown as EventListener);
      canvas.removeEventListener('pointermove', onPointerMove as EventListener);
      canvas.removeEventListener('pointerup', endPrimary as EventListener);
      canvas.removeEventListener('pointercancel', endPrimary as EventListener);
      if (wantsKeyboard) {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
      }
    },
  };
}
