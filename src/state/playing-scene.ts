/**
 * The Playing scene (docs/areas/01-gameplay-engine.md §3.1). A THIN shell over the pure engine: it
 * owns the run's `GameState`, buffers input into a `PlayerIntent`, and drives `engine.step` each tick.
 * All gameplay logic lives in `src/systems/combat/*`; this file only adapts the Scene/Input/Renderer
 * edges and composes the Phase-4 presentation overlays:
 *  - the HUD (area 10) is drawn over the world, gets first crack at input (so the resident panel can
 *    consume nav/intercom taps before the gun sees them), and can request a sim pause while open;
 *  - the audio engine (area 06) is advanced each tick (difficulty → music intensity) and told the
 *    active scene. SFX themselves are driven by the event bus inside the engine, not from here.
 * It does NOT handle `gameOver` (the global `wireGameOver` routes to the GameOver scene).
 */
import { createGameState } from './create-game-state';
import { createEngine } from '../systems/combat/engine';
import { createHud } from '../ui/hud/hud';
import type { Engine } from '../systems/combat/engine';
import type { HudImpl } from '../ui/hud/hud';
import type { SettingsView, HudEconomy } from '../ui/hud/types';
import type { AudioEngineImpl } from '../audio/engine';
import type { Scene } from './scene';
import type { SystemContext } from '../core/system-context';
import type { InputEvent } from '../input/input';
import type { Renderer } from '../render/renderer';
import type { SpriteId } from '../content/sprite-ids';
import type { DifficultyRamp } from '../core/difficulty';
import { daylightAt } from '../core/difficulty';
import { drawSkyline } from '../render/backdrop';
import { drawIncidentOverlays } from '../render/overlays';
import type { GameState } from './game-state';
import type { Vec2 } from '../core/math';

/** Engine drone `kind` → atlas sprite id (jackpot-tagged drones use the tintable `drone.special`). */
function droneSprite(kind: string, tagged: boolean): SpriteId {
  if (tagged) return 'drone.special';
  switch (kind) {
    case 'scout':
      return 'drone.scout';
    case 'heavy':
      return 'drone.armored';
    case 'kamikaze':
      return 'drone.bomber';
    case 'frenzy':
      return 'drone.swarm';
    case 'boss':
      return 'drone.boss';
    case 'decoy_bird':
      return 'decoy.bird';
    default:
      return 'drone.scout';
  }
}

/** Soldier sprite for the current state (crisis > firing > drowsy > idle). */
function soldierState(gs: GameState): SpriteId {
  if (Object.values(gs.meters.inCrisis).some(Boolean)) return 'soldier.crisis';
  if (gs.combat.gun.firing) return 'soldier.fire';
  if (gs.meters.values.sleep > 60) return 'soldier.tired';
  return 'soldier.idle';
}

/** Optional hooks for the host (main.ts). `onState` is a per-tick diagnostic sink used by the e2e. */
export interface PlayingSceneOptions {
  onState?: (gs: GameState) => void;
  /** HUD overlay deps (area 10). Omitted in tests that drive the bare engine. */
  hud?: { settings: SettingsView; economy: HudEconomy };
  /** Audio engine (area 06): advanced per tick + told the active scene. */
  audio?: Pick<AudioEngineImpl, 'update' | 'setScene'>;
}

export function createPlayingScene(opts: PlayingSceneOptions = {}): Scene {
  let gs: GameState | null = null;
  let engine: Engine | null = null;
  let hud: HudImpl | null = null;
  let dayRamp: DifficultyRamp | null = null;

  // Buffered input intent (translated from the typed InputEvent stream).
  let aimTarget: Vec2 | null = null;
  let fireHeld = false;
  let left = false;
  let right = false;

  return {
    enter(_params: void, ctx: SystemContext): void {
      gs = createGameState(ctx.content, ctx.rng.getState().seed);
      engine = createEngine(gs, ctx);
      dayRamp = ctx.content.combat.difficulty;
      if (opts.hud) hud = createHud(ctx, opts.hud.settings, opts.hud.economy);
      opts.audio?.setScene('Playing');
    },

    update(dt: number): void {
      if (!gs || !engine) return;
      // The HUD may request a pause while the resident panel is open (accessibility setting); the sim
      // freezes but HUD animations + audio keep advancing so the panel stays responsive.
      if (!hud?.wantsPause()) {
        engine.step(dt, { aimTarget, rotateDir: (right ? 1 : 0) - (left ? 1 : 0), fireHeld });
      }
      hud?.update(dt, gs);
      opts.audio?.update(gs, dt);
      opts.onState?.(gs);
    },

    onInput(e: InputEvent): void {
      // The HUD gets first crack: if it consumes the event (panel nav/intercom), the gun never sees it.
      if (gs && hud?.onInput(e, gs)) return;
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
      // Parallax Moscow skyline + day/night (real sun/moon sprites) behind the action.
      const daylight = dayRamp ? daylightAt(gs.time.shiftSeconds, dayRamp) : 1;
      drawSkyline(r, { phase: gs.time.phase, daylight });

      // Incoming drones as their per-type sprites.
      for (const d of c.drones) {
        const tagged = d.colorTag !== undefined;
        r.drawSprite(droneSprite(d.kind, tagged), d.pos, tagged ? { tint: 'accentPink' } : undefined);
      }
      // Projectiles stay code-drawn tracer dots.
      for (const p of c.projectiles) {
        r.fillRect(Math.round(p.pos.x), Math.round(p.pos.y), 1, 1, 'flash');
      }

      // Soldier at the post (state from meters), machine gun rotated to the effective aim.
      r.drawSprite(soldierState(gs), { x: c.gun.pivot.x, y: r.height });
      r.drawSprite('gun.base', c.gun.pivot, { rotation: c.aim.effectiveAngle });
      if (c.gun.firing && !c.gun.overheated) {
        const mx = c.gun.pivot.x + Math.cos(c.aim.effectiveAngle) * 18;
        const my = c.gun.pivot.y + Math.sin(c.aim.effectiveAngle) * 18;
        const frame = Math.floor(gs.time.shiftSeconds * 30) % 3;
        r.drawSprite('gun.flash', { x: mx, y: my }, { frame, rotation: c.aim.effectiveAngle });
      }

      // Incident overlays (blackout/drip) darken the world; the HUD draws on top, still readable.
      drawIncidentOverlays(r, gs);
      hud?.render(r, gs);
    },

    exit(): void {
      hud?.dispose();
      hud = null;
      engine?.dispose();
      engine = null;
      opts.audio?.setScene('MainMenu');
      gs = null;
    },
  };
}
