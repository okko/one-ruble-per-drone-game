/**
 * Settings scene — a minimal stub (Settings is not a Phase-5 area, but the Main Menu lists it and
 * `TRANSITIONS.MainMenu` allows routing here). It shows a "coming soon" card over the skyline and
 * returns to the Main Menu on any input, so the menu option works end-to-end without the full
 * Settings area. Replace with the real Settings scene when that area lands.
 */
import type { Scene } from './scene';
import type { SceneManager } from './scene-manager';
import type { InputEvent } from '../input/input';
import type { Renderer } from '../render/renderer';
import { drawSkyline } from '../render/backdrop';

export function createSettingsScene(manager: SceneManager): Scene {
  return {
    enter(): void {},
    update(): void {},
    render(r: Renderer): void {
      drawSkyline(r, { dim: true });
      r.text('SETTINGS', r.width / 2, 40, { align: 'center', color: 'cream', font: 'font.display' });
      r.text('Coming soon, comrade.', r.width / 2, 96, { align: 'center', color: 'cream' });
      r.text('Press any key to go back', r.width / 2, 150, { align: 'center', color: 'cream' });
    },
    onInput(e: InputEvent): void {
      const back =
        e.type === 'fireDown' || (e.type === 'pointer' && e.down) || (e.type === 'key' && e.down);
      if (back) manager.transition('MainMenu');
    },
    exit(): void {},
  };
}
