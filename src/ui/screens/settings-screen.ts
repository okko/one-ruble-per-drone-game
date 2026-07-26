/**
 * Settings screen — still the placeholder the Main Menu routes to, now built from
 * the shared primitives so it looks like part of the game rather than debug text
 * (docs/areas/10-hud-ui.md §3.3). Replace the body when the Settings area lands.
 */
import '../styles/screens.css';
import type { UiScreen } from '../shell/ui-shell';
import { el } from './dom';

export function createSettingsScreen(): UiScreen<void> {
  const root = el(
    'div',
    { class: 'screen-body' },
    el('h1', { class: 'ui-title', text: 'SETTINGS' }),
    el('p', { class: 'ui-tagline', text: 'Coming soon, comrade.' }),
    el('div', { class: 'screen-footer', text: 'Any key to go back' }),
  );

  return {
    mount(host) {
      host.append(root);
    },
    update() {},
    unmount() {
      root.remove();
    },
  };
}
