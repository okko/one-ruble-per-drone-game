/**
 * The Scene contract every scene implements (docs/areas/09-state-and-persistence.md §4).
 *
 * **A scene does not draw.** Presentation belongs to the three.js view (the world) and to the DOM
 * screens (the UI); a scene decides *what* should be on screen and pushes a view-model to them.
 * `render(alpha)` therefore carries only the interpolation factor for the current frame, which the
 * 3D view needs to tween between the last two fixed-timestep states.
 */
import type { SystemContext } from '../core/system-context';
import type { InputEvent } from '../input/input';

export type SceneId =
  | 'Boot'
  | 'MainMenu'
  | 'Playing'
  | 'Paused'
  | 'GameOver'
  | 'HighscoreEntry'
  | 'Highscores'
  | 'Settings';

export interface Scene<P = void> {
  /** Called once when the scene becomes active or is pushed as an overlay. */
  enter(params: P, ctx: SystemContext): void;
  /** Fixed-timestep logic tick. NOT called while this scene is frozen beneath an overlay. */
  update(dt: number, ctx: SystemContext): void;
  /** Push the current frame to the view + UI. `alpha` ∈ [0,1] is the tween factor between the two
   *  most recent fixed steps. May be called while frozen (shown behind an overlay). */
  render(alpha: number): void;
  onInput(e: InputEvent): void;
  exit(): void;
}
