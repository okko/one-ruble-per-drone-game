/**
 * The Playing scene (docs/areas/01-gameplay-engine.md §3.1). A THIN shell over the pure engine: it
 * owns the run's `GameState`, buffers input into a `PlayerIntent`, and drives `engine.step` each tick.
 * All gameplay logic lives in `src/systems/combat/*`; this file only adapts the Scene/Input/Renderer
 * edges. It does NOT handle `gameOver` (the global `wireGameOver` routes to the GameOver scene) — it
 * just lets the engine emit it. Render is placeholder rectangles until the Art area lands.
 */
import { createGameState } from './create-game-state';
import { createEngine } from '../systems/combat/engine';
import type { Engine } from '../systems/combat/engine';
import type { Scene } from './scene';
import type { SystemContext } from '../core/system-context';
import type { InputEvent } from '../input/input';
import type { Renderer } from '../render/renderer';
import type { PaletteKey } from '../render/palette';
import type { GameState } from './game-state';
import type { Vec2 } from '../core/math';

function droneColor(kind: string): PaletteKey {
  switch (kind) {
    case 'scout':
      return 'droneScout';
    case 'heavy':
      return 'droneBody';
    case 'kamikaze':
      return 'droneBomber';
    case 'frenzy':
      return 'droneSwarm';
    case 'boss':
      return 'droneBoss';
    case 'decoy_bird':
      return 'cream';
    default:
      return 'droneBody';
  }
}

/** Optional hooks for the host (main.ts). `onState` is a per-tick diagnostic sink used by the e2e. */
export interface PlayingSceneOptions {
  onState?: (gs: GameState) => void;
}

export function createPlayingScene(opts: PlayingSceneOptions = {}): Scene {
  let gs: GameState | null = null;
  let engine: Engine | null = null;
  let maxIntegrity = 100;

  // Buffered input intent (translated from the typed InputEvent stream).
  let aimTarget: Vec2 | null = null;
  let fireHeld = false;
  let left = false;
  let right = false;

  return {
    enter(_params: void, ctx: SystemContext): void {
      gs = createGameState(ctx.content, ctx.rng.getState().seed);
      maxIntegrity = ctx.content.combat.postIntegrityMax;
      engine = createEngine(gs, ctx);
    },

    update(dt: number): void {
      engine?.step(dt, { aimTarget, rotateDir: (right ? 1 : 0) - (left ? 1 : 0), fireHeld });
      if (gs) opts.onState?.(gs);
    },

    onInput(e: InputEvent): void {
      switch (e.type) {
        case 'aim':
          aimTarget = e.world;
          break;
        case 'pointer':
          if (e.down) aimTarget = e.world;
          break;
        case 'fireDown':
          fireHeld = true;
          break;
        case 'fireUp':
          fireHeld = false;
          break;
        case 'key':
          if (e.code === 'Space') fireHeld = e.down;
          else if (e.code === 'ArrowLeft' || e.code === 'KeyA') left = e.down;
          else if (e.code === 'ArrowRight' || e.code === 'KeyD') right = e.down;
          break;
      }
    },

    render(r: Renderer): void {
      if (!gs) return;
      const c = gs.combat;
      r.clear(gs.time.phase === 'night' ? 'skyNightTop' : 'skyDayTop');

      for (const d of c.drones) {
        const s = Math.max(2, Math.round(d.radius * 2));
        r.fillRect(Math.round(d.pos.x - d.radius), Math.round(d.pos.y - d.radius), s, s, droneColor(d.kind));
      }
      for (const p of c.projectiles) {
        r.fillRect(Math.round(p.pos.x), Math.round(p.pos.y), 1, 1, 'flash');
      }

      // Gun base + a muzzle pip along the effective aim.
      r.fillRect(Math.round(c.gun.pivot.x - 3), Math.round(c.gun.pivot.y - 3), 6, 6, 'gunmetal');
      const mx = c.gun.pivot.x + Math.cos(c.aim.effectiveAngle) * 12;
      const my = c.gun.pivot.y + Math.sin(c.aim.effectiveAngle) * 12;
      r.fillRect(Math.round(mx) - 1, Math.round(my) - 1, 2, 2, c.gun.overheated ? 'meterCrit' : 'flash');

      // Post Integrity bar + ruble readout (placeholder HUD; the real HUD is area 10).
      const frac = Math.max(0, Math.min(1, c.postIntegrity / maxIntegrity));
      r.fillRect(4, r.height - 8, 60, 4, 'meterCrit');
      r.fillRect(4, r.height - 8, Math.round(60 * frac), 4, 'meterGood');
      r.text(`₽ ${gs.economy.rubles}`, 4, 4, { color: 'cream' });
    },

    exit(): void {
      engine?.dispose();
      engine = null;
      gs = null;
    },
  };
}
