/**
 * The per-frame view model the Playing scene hands to its renderers (the Three.js world view and the
 * DOM HUD overlay). It is a pure projection of `GameState` + the scene's interaction state — the scene
 * builds it each frame; the renderers only read it. Kept dependency-light (types only) so both the
 * `render/three` view and the `ui` overlay can import it without a cycle.
 */
import type { MenuOption } from '../ui/hud/types';

/** Shooting at the sky, or walked down inside the tower visiting residents. */
export type PlayMode = 'shooting' | 'interior';

/** One selectable resident interaction on the current interior floor (BUY a service / BEG a favor). */
export interface InteriorOption {
  residentId: string;
  kind: 'service' | 'favor';
  option: MenuOption;
}

/** A floor of the soldier's tower that is home to a resident (top 12 floors, ≤ 1 each). */
export interface Occupant {
  floor: number;
  id: string;
  name: string;
}

export interface PlayingViewState {
  mode: PlayMode;
  /** Current interior floor (equals `topFloor` whenever shooting — the soldier stands on the roof). */
  floor: number;
  topFloor: number; // 32 (roof / firing post)
  bottomFloor: number; // 21 (lowest visitable floor)
  storeys: number; // total stories in the soldier's tower (32)
  /** Residents by floor, for the cut-away tower's labelled interiors. */
  occupants: Occupant[];
  /** The resident on the current floor (null on an empty floor or while shooting). */
  currentResidentId: string | null;
  currentResidentName: string | null;
  /** Interaction options for the current floor's resident (only meaningful in interior mode). */
  options: InteriorOption[];
  selected: number;
  /** Wave heads-up: the siren is wailing, and how long until the drones arrive (null once they have). */
  siren: { active: boolean; secondsUntilWave: number | null };
}
