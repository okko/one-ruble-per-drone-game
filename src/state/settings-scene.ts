/**
 * Settings scene — a minimal stub (Settings is not a Phase-5 area, but the Main Menu lists it and
 * `TRANSITIONS.MainMenu` allows routing here). It shows a "coming soon" card over the live 3D menu
 * backdrop and returns to the Main Menu on any input, so the menu option works end-to-end without
 * the full Settings area. Replace with the real Settings scene when that area lands.
 */
import type { Scene } from './scene';
import type { SceneManager } from './scene-manager';
import type { InputEvent } from '../input/input';
import type { UiShell } from '../ui/shell/ui-shell';
import { createSettingsScreen } from '../ui/screens/settings-screen';

export interface SettingsDeps {
  sceneManager: SceneManager;
  /** Absent in node tests, where the scene's routing is the only thing under test. */
  shell?: UiShell | undefined;
}

export function createSettingsScene(deps: SettingsDeps): Scene {
  return {
    enter(): void {
      deps.shell?.show('settings', createSettingsScreen(), { scrim: true });
    },
    update(): void {},
    render(): void {},
    onInput(e: InputEvent): void {
      const back =
        e.type === 'fireDown' || (e.type === 'pointer' && e.down) || (e.type === 'key' && e.down);
      if (back) deps.sceneManager.transition('MainMenu');
    },
    exit(): void {
      deps.shell?.hide('settings');
    },
  };
}
