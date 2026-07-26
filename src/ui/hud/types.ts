/**
 * HUD public contract (docs/areas/10-hud-ui.md §4). The HUD is a DOM overlay driven by the
 * `Playing` scene: it READS `GameState` and reflects it, but never mutates gameplay state.
 * `SettingsView` is the accessibility/keybind projection the HUD reads (sourced from the Settings
 * repo by the host). `ResidentMenuModel` is the read-only view the Economy area supplies for the
 * resident panel.
 *
 * There is no `Hud` interface any more: the overlay is `src/ui/game-overlay.ts`, it draws nothing,
 * and the Playing scene owns the interaction state it used to hold.
 */
import type { GameState } from '../../state/game-state';

export interface SettingsView {
  reducedFlash: boolean;
  largeHudText: boolean;
  pauseWhilePanelOpen: boolean;
  residentPanelKey: string; // default 'KeyE'
}

/** Read-only menu view the HUD consumes from the Economy area (Economy computes it). */
export interface ResidentMenuModel {
  residents: ResidentMenuEntry[];
}

export interface ResidentMenuEntry {
  residentId: string;
  name: string;
  floor: number;
  reputation: number;
  services: MenuOption[]; // BUY — already filtered to currently available
  favors: MenuOption[]; // BEG — present (typically) only when broke
}

export interface MenuOption {
  id: string;
  label: string;
  costRubles?: number; // services only
  affordable?: boolean; // services only
  consequencePreview?: string; // favors only
  disabledReason?: string; // if set, render greyed; selection blocked
}

/** The economy selector the HUD depends on (the host supplies an adapter over the Economy area). */
export interface HudEconomy {
  getAvailableInteractions(state: GameState): ResidentMenuModel;
}
