/**
 * Typed, synchronous event bus (docs/architecture.md §5, docs/areas/00-core-platform.md §3.5).
 * Decouples systems: audio/scoring/HUD react to events without hard coupling. Adding a new
 * event is fine; changing an existing payload needs lead sign-off.
 */
import type { Vec2 } from './math';
import type { MeterKey } from '../types/meter-key';

export interface GameEvents {
  droneSpawned: { id: number; kind: string };
  // `colorTag` (optional) marks a "special" coloured drone for the Scoring jackpot sequence
  // (docs/areas/04-scoring.md §3.3); ordinary drones omit it. Additive, lead-approved.
  droneDestroyed: { id: number; kind: string; byPlayer: boolean; pos: Vec2; colorTag?: string };
  droneEscaped: { id: number; damage: number }; // hit the building
  shotFired: { from: Vec2; angle: number };
  // Opens the Scoring skill-shot window at the start of a wave (docs/areas/04-scoring.md §3.5).
  waveStarted: Record<string, never>;
  rublesChanged: { delta: number; total: number };
  meterCrisis: { meter: MeterKey; entered: boolean };
  serviceBought: { residentId: string; service: string; cost: number };
  favorBegged: { residentId: string; favor: string; consequence: string };
  incidentStart: { id: string };
  // Area 05 (Random Incidents) lead-approved extension: `survived` lets Scoring award the
  // incident-survival bonus only on a clean completion (docs/areas/05-random-incidents.md §4).
  incidentEnd: { id: string; survived: boolean };
  scoreChanged: { delta: number; total: number; reason: string };
  comboChanged: { multiplier: number };
  // Poo-crisis "accident" spectacle hook (docs/areas/02-meters-and-status.md §3.4). Emitted by the
  // Meters area on poo-crisis ENTRY; Scoring/Economy may react (penalty / reputation hit). Carries
  // no payload — the magnitudes live in their respective balance tables.
  pooAccident: Record<string, never>;
  // Extends the architecture §5 baseline ({score, cause}) with the run stats the persistence
  // layer needs to build a RunSummary on game over (Gameplay Engine, area 01, supplies them).
  gameOver: { score: number; cause: string; shiftSeconds: number; dronesDowned: number };
}

export type Handler<T> = (payload: T) => void;

export interface EventBus {
  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof GameEvents>(k: K, h: Handler<GameEvents[K]>): () => void;
  off<K extends keyof GameEvents>(k: K, h: Handler<GameEvents[K]>): void;
  emit<K extends keyof GameEvents>(k: K, payload: GameEvents[K]): void;
}

export function createEventBus(): EventBus {
  // Handlers are stored type-erased (indexing a mapped type with a generic key collapses to
  // `never`); the public on/off/emit signatures keep callers fully type-checked, and the casts
  // at this boundary are sound because each list only ever holds handlers for its own key.
  const handlers = new Map<keyof GameEvents, Array<Handler<unknown>>>();

  function off<K extends keyof GameEvents>(k: K, h: Handler<GameEvents[K]>): void {
    const list = handlers.get(k);
    if (!list) return;
    const idx = list.indexOf(h as Handler<unknown>);
    if (idx !== -1) list.splice(idx, 1);
  }

  return {
    on<K extends keyof GameEvents>(k: K, h: Handler<GameEvents[K]>): () => void {
      let list = handlers.get(k);
      if (!list) {
        list = [];
        handlers.set(k, list);
      }
      list.push(h as Handler<unknown>);
      return () => off(k, h);
    },

    off,

    emit<K extends keyof GameEvents>(k: K, payload: GameEvents[K]): void {
      const list = handlers.get(k);
      if (!list) return;
      // Snapshot so handlers added/removed during dispatch don't affect the in-flight event,
      // and a throwing handler can't abort the rest.
      for (const h of [...list]) {
        try {
          h(payload);
        } catch (err) {
          console.error(`[events] handler for "${String(k)}" threw`, err);
        }
      }
    },
  };
}
