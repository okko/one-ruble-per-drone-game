/**
 * The app state machine (docs/areas/09-state-and-persistence.md §3.1). One active scene plus an
 * optional overlay (Pause/modal). Enforces the legal transition graph, throwing on illegal edges
 * with `active` left unchanged.
 *
 * Key semantics:
 *  - Pause is an OVERLAY (`pushOverlay('Paused')`), not a transition: it does NOT exit the active
 *    scene, which stays mounted and frozen (rendered behind, but not updated).
 *  - `update` dispatches to the TOPMOST scene only — so a Paused overlay (whose update is a no-op)
 *    automatically freezes Playing; `render` draws active-then-overlay; input routes overlay-first.
 *  - "Abandon run" is `transition('MainMenu')` while Paused: validated from the overlay id, it
 *    exits BOTH the overlay and the active scene.
 *  - The initial scene (Boot) is entered lazily on the first update/render/transition, using the
 *    SystemContext captured at construction (the interface's transition() carries no ctx).
 */
import type { Scene, SceneId } from './scene';
import type { SystemContext } from '../core/system-context';
import type { InputEvent } from '../input/input';

export interface SceneManager {
  register<P>(id: SceneId, factory: () => Scene<P>): void;
  transition<P>(to: SceneId, params?: P): void;
  pushOverlay<P>(to: SceneId, params?: P): void;
  popOverlay(): void;
  readonly active: SceneId;
  readonly overlay: SceneId | null;
  update(dt: number, ctx: SystemContext): void;
  render(alpha: number): void;
  routeInput(e: InputEvent): void;
}

/** Legal active-scene transitions; anything not listed is rejected. */
export const TRANSITIONS: Record<SceneId, SceneId[]> = {
  Boot: ['MainMenu'],
  MainMenu: ['Playing', 'Highscores', 'Settings'],
  Playing: ['GameOver'], // Paused is reached via pushOverlay, not transition
  Paused: ['Playing', 'MainMenu'], // resume is popOverlay; MainMenu is "abandon run"
  GameOver: ['HighscoreEntry', 'Highscores', 'MainMenu'],
  HighscoreEntry: ['Highscores'],
  Highscores: ['MainMenu'],
  Settings: ['MainMenu'],
};

/** Legal overlays per active scene. */
export const OVERLAYS: Partial<Record<SceneId, SceneId[]>> = {
  Playing: ['Paused'],
};

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: SceneId,
    public readonly to: SceneId,
  ) {
    super(`Illegal scene transition: ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export function createSceneManager(ctx: SystemContext, initial: SceneId = 'Boot'): SceneManager {
  // Scenes are stored type-erased as Scene<never>: any Scene<P> is assignable to Scene<never>
  // (enter's param is contravariant, and never is the bottom type), so registration accepts any
  // P while a single internal type drives the FSM. enter() params are cast back at the one call
  // site below.
  const factories = new Map<SceneId, () => Scene<never>>();
  let context = ctx;
  let activeId: SceneId = initial;
  let activeScene: Scene<never> | null = null;
  let overlayId: SceneId | null = null;
  let overlayScene: Scene<never> | null = null;

  function instantiate(id: SceneId): Scene<never> {
    const factory = factories.get(id);
    if (!factory) throw new Error(`SceneManager: no factory registered for "${id}"`);
    return factory();
  }

  function enterScene(scene: Scene<never>, params: unknown): void {
    // The erased scene's enter expects `never`; the caller's params are validated by the typed
    // transition<P> / SceneParams contract at the call site.
    scene.enter(params as never, context);
  }

  function ensureStarted(): void {
    if (activeScene) return;
    activeScene = instantiate(activeId);
    enterScene(activeScene, undefined);
  }

  return {
    register<P>(id: SceneId, factory: () => Scene<P>): void {
      // Scene<P> is assignable to Scene<never> (enter's param is contravariant), so a single
      // erased factory type drives the FSM while registration stays type-safe per scene.
      factories.set(id, factory);
    },

    transition<P>(to: SceneId, params?: P): void {
      ensureStarted();
      const from = overlayId ?? activeId;
      if (!(TRANSITIONS[from] ?? []).includes(to)) throw new IllegalTransitionError(from, to);
      const next = instantiate(to); // construct before tearing down (and before any mutation)
      if (overlayScene) {
        overlayScene.exit();
        overlayScene = null;
        overlayId = null;
      }
      activeScene?.exit();
      activeId = to;
      activeScene = next;
      enterScene(next, params);
    },

    pushOverlay<P>(to: SceneId, params?: P): void {
      ensureStarted();
      if (overlayId) throw new Error(`SceneManager: overlay "${overlayId}" already active`);
      if (!(OVERLAYS[activeId] ?? []).includes(to)) throw new IllegalTransitionError(activeId, to);
      overlayId = to;
      overlayScene = instantiate(to);
      enterScene(overlayScene, params); // active scene stays mounted (frozen)
    },

    popOverlay(): void {
      if (!overlayScene) return;
      overlayScene.exit();
      overlayScene = null;
      overlayId = null;
    },

    get active(): SceneId {
      return activeId;
    },
    get overlay(): SceneId | null {
      return overlayId;
    },

    update(dt: number, c: SystemContext): void {
      context = c;
      ensureStarted();
      // Topmost-only: an overlay freezes the active scene's update.
      if (overlayScene) overlayScene.update(dt, c);
      else activeScene?.update(dt, c);
    },

    render(alpha: number): void {
      ensureStarted();
      activeScene?.render(alpha);
      overlayScene?.render(alpha);
    },

    routeInput(e: InputEvent): void {
      ensureStarted();
      if (overlayScene) overlayScene.onInput(e);
      else activeScene?.onInput(e);
    },
  };
}
