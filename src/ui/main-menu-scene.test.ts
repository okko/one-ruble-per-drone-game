// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createMainMenuScene } from './main-menu-scene';
import { createRecordingRenderer } from '../test-support/recording-renderer';
import { MENU_ITEMS } from '../content/menu';
import { DEFAULT_TABLE } from '../content/highscores.defaults';
import { DEFAULT_SETTINGS, type Settings } from '../persistence/schemas';
import type { SceneManager } from '../state/scene-manager';
import type { SystemContext } from '../core/system-context';
import type { SettingsRepo } from '../persistence/settings-repo';
import type { HighscoresRepo } from '../persistence/highscores-repo';
import type { AudioEngineImpl } from '../audio/engine';

const ctx = {} as unknown as SystemContext;
// itemY(i) = OPTIONS_Y0(100) + i * ITEM_H(18); option #2 sits at y = 136, centred on x = 192.

function fakeSettings(o: { muted?: boolean; reducedMotion?: boolean } = {}): SettingsRepo {
  const s: Settings = {
    ...DEFAULT_SETTINGS,
    muted: o.muted ?? false,
    accessibility: { ...DEFAULT_SETTINGS.accessibility, reducedMotion: o.reducedMotion ?? false },
  };
  return { get: () => s, patch: vi.fn(() => s), reset: vi.fn(() => s) };
}

function fakeHighscores(): HighscoresRepo {
  return { list: () => DEFAULT_TABLE, qualifies: () => true, rankFor: () => 1, add: vi.fn(() => ({ rank: 1 })), clear: vi.fn() };
}

function makeScene(o: { muted?: boolean; reducedMotion?: boolean; idleTimeoutS?: number } = {}) {
  const transition = vi.fn();
  const playSfx = vi.fn();
  const setScene = vi.fn();
  const audio = { playSfx, setScene } as unknown as Pick<AudioEngineImpl, 'playSfx' | 'setScene'>;
  const scene = createMainMenuScene({
    sceneManager: { transition } as unknown as SceneManager,
    audio,
    settings: fakeSettings(o),
    highscores: fakeHighscores(),
    ...(o.idleTimeoutS !== undefined ? { idleTimeoutS: o.idleTimeoutS } : {}),
  });
  scene.enter(undefined, ctx);
  return { scene, transition, playSfx, setScene };
}

describe('Main Menu scene', () => {
  it('renders all five option labels', () => {
    const { scene } = makeScene();
    const r = createRecordingRenderer();
    scene.render(r);
    for (const item of MENU_ITEMS) expect(r.textsContaining(item.label).length).toBeGreaterThan(0);
  });

  it('keyboard navigation moves the selection', () => {
    const { scene } = makeScene();
    scene.onInput({ type: 'key', code: 'ArrowDown', down: true });
    expect(scene.selectedIndex).toBe(1);
    scene.onInput({ type: 'key', code: 'ArrowUp', down: true });
    expect(scene.selectedIndex).toBe(0);
  });

  it('wraps around and skips disabled items', () => {
    const { scene } = makeScene();
    scene.onInput({ type: 'key', code: 'ArrowUp', down: true });
    expect(scene.selectedIndex).toBe(MENU_ITEMS.length - 1); // wrapped to last
    scene.selectedIndex = 0;
    const disabled = scene.items[1];
    if (disabled) disabled.enabled = false;
    scene.onInput({ type: 'key', code: 'ArrowDown', down: true });
    expect(scene.selectedIndex).toBe(2); // skipped the disabled #1
  });

  it('pointer hover sets the selection; disabled is a no-op', () => {
    const { scene } = makeScene();
    scene.onInput({ type: 'aim', world: { x: 192, y: 136 } });
    expect(scene.selectedIndex).toBe(2);
    scene.selectedIndex = 0;
    const it = scene.items[2];
    if (it) it.enabled = false;
    scene.selectAt(2);
    expect(scene.selectedIndex).toBe(0);
  });

  it('Start New Shift routes to Playing exactly once', () => {
    const { scene, transition } = makeScene();
    scene.confirm(0);
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith('Playing');
  });

  it('routes the sibling menu options to their scenes', () => {
    const { scene, transition } = makeScene();
    scene.confirm(1);
    expect(transition).toHaveBeenCalledWith('Highscores', {});
    scene.confirm(2);
    expect(transition).toHaveBeenCalledWith('Settings');
  });

  it('opens and closes the How-to-Play and Credits panels', () => {
    const { scene } = makeScene();
    scene.confirm(3);
    expect(scene.panel).toBe('howto');
    scene.onInput({ type: 'key', code: 'Escape', down: true });
    expect(scene.panel).toBe('none');
    scene.confirm(4);
    expect(scene.panel).toBe('credits');
    scene.onInput({ type: 'key', code: 'Escape', down: true });
    expect(scene.panel).toBe('none');
  });

  it('engages attract mode after the idle timeout and wakes without acting', () => {
    const { scene, transition } = makeScene({ idleTimeoutS: 1 });
    scene.update(1.1, ctx);
    expect(scene.panel).toBe('attract');
    scene.onInput({ type: 'key', code: 'ArrowDown', down: true });
    expect(scene.panel).toBe('none');
    expect(transition).not.toHaveBeenCalled();
  });

  it('fires the move and confirm audio cues', () => {
    const { scene, playSfx, setScene } = makeScene();
    expect(setScene).toHaveBeenCalledWith('MainMenu');
    scene.moveSelection(1);
    expect(playSfx).toHaveBeenCalledWith('uiSelect');
    scene.confirm(0);
    expect(playSfx).toHaveBeenCalledWith('uiConfirm');
  });

  it('is settings-aware: muted shows a glyph; reduced-motion suppresses attract', () => {
    const muted = makeScene({ muted: true });
    const r = createRecordingRenderer();
    muted.scene.render(r);
    expect(r.textsContaining('MUTE').length).toBeGreaterThan(0);

    const plain = makeScene();
    const r2 = createRecordingRenderer();
    plain.scene.render(r2);
    expect(r2.textsContaining('MUTE').length).toBe(0);

    const reduced = makeScene({ reducedMotion: true, idleTimeoutS: 1 });
    reduced.scene.update(2, ctx);
    expect(reduced.scene.panel).toBe('none'); // no attract animation under reduced motion
  });
});
