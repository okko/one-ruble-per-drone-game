/**
 * Game Over screen (docs/areas/08-highscores.md §3.4, docs/areas/10-hud-ui.md §3.4).
 * The shift summary: what happened, what it was worth, and where the player is
 * about to be sent. Qualification is decided by the scene; this only says so.
 */
import '../styles/screens.css';
import type { UiScreen } from '../shell/ui-shell';
import { el, setText } from './dom';

export interface GameOverVM {
  cause: string;
  score: string;
  drones: string;
  shift: string;
  prompt: string;
  qualified: boolean;
}

function stat(label: string): { root: HTMLElement; value: HTMLElement } {
  const value = el('span', { class: 'stat-value' });
  return {
    root: el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: label }), value),
    value,
  };
}

export function createGameOverScreen(): UiScreen<GameOverVM> {
  const cause = el('p', { class: 'ui-eyebrow' });
  const score = stat('Score');
  const drones = stat('Drones');
  const shift = stat('Shift');
  // The prompt changes what it says on qualification, so it is announced rather
  // than silently swapped under a player using a screen reader.
  const prompt = el('p', { class: 'ui-tagline', role: 'status', 'aria-live': 'polite' });

  const root = el(
    'div',
    { class: 'screen-body' },
    el('h1', { class: 'ui-title', text: 'SHIFT OVER' }),
    cause,
    el('div', { class: 'stat-grid' }, score.root, drones.root, shift.root),
    prompt,
  );

  return {
    mount(host) {
      host.append(root);
    },
    update(vm) {
      setText(cause, vm.cause);
      setText(score.value, vm.score);
      setText(drones.value, vm.drones);
      setText(shift.value, vm.shift);
      setText(prompt, vm.prompt);
      score.value.setAttribute('data-accent', String(vm.qualified));
    },
    unmount() {
      root.remove();
    },
  };
}
