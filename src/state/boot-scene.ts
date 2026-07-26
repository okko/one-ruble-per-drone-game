/**
 * Boot scene (docs/areas/00-core-platform.md §3.10, docs/areas/09-state-and-persistence.md §3.3).
 * On enter it marks the intro as seen and routes to MainMenu. (A real splash/intro can live here
 * later; Phase 1 boots straight through.) Content is already validated by the time the scene runs.
 */
import type { Scene } from './scene';
import type { SceneManager } from './scene-manager';
import type { MetaStatsRepo } from '../persistence/meta-stats-repo';

export function createBootScene(manager: SceneManager, meta: MetaStatsRepo): Scene {
  return {
    enter(): void {
      meta.markIntroSeen();
      manager.transition('MainMenu');
    },
    update(): void {},
    // Boot routes straight through on enter, so there is never a frame to show.
    render(): void {},
    onInput(): void {},
    exit(): void {},
  };
}
