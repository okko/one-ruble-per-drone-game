// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ART } from './index';
import { PALETTE, type PaletteKey } from '../palette';
import { SPRITE_IDS } from '../../content/sprite-ids';
import { createPlaceholderProvider } from '../sprite-provider';

describe('art data validity', () => {
  it('every art entry is internally consistent (rectangular, legend-complete, valid palette keys)', () => {
    for (const [id, entry] of Object.entries(ART)) {
      if (!entry) continue;
      const grids = entry.kind === 'font' ? entry.glyphs : entry.frames;
      const [w, h] = entry.kind === 'font' ? [entry.glyphW, entry.glyphH] : [entry.w, entry.h];
      expect(grids.length, `${id} has frames`).toBeGreaterThan(0);
      for (const grid of grids) {
        expect(grid.rows.length, `${id} grid height`).toBe(h);
        for (const row of grid.rows) {
          expect(row.length, `${id} grid width`).toBe(w); // rectangular + matches declared size
          for (const ch of row) {
            if (ch === ' ') continue;
            const key = grid.legend[ch];
            expect(key, `${id} legend has '${ch}'`).toBeDefined();
            expect(key as PaletteKey in PALETTE, `${id} '${ch}' → valid PaletteKey`).toBe(true);
          }
        }
      }
    }
  });

  it('authored sprites match their §3.3 source sizes', () => {
    const EXPECTED: Partial<Record<string, [number, number]>> = {
      'soldier.idle': [32, 40], 'soldier.fire': [32, 40], 'soldier.tired': [32, 40], 'soldier.crisis': [32, 40],
      'gun.base': [28, 16], 'gun.flash': [16, 16],
      'drone.scout': [16, 16], 'drone.bomber': [24, 24], 'drone.swarm': [12, 12], 'drone.armored': [24, 20],
      'drone.special': [16, 16], 'drone.boss': [48, 48], 'decoy.bird': [16, 12],
      'fx.tracer': [4, 4], 'fx.explosion': [32, 32], 'fx.spark': [8, 8], 'fx.drip': [8, 8], 'pickup.ruble': [8, 8],
      'ui.panel': [16, 16], 'ui.panel.corner': [8, 8], 'ui.meter.frame': [48, 8], 'ui.meter.fill': [48, 8],
      'ui.btn': [32, 16], 'ui.btn.hover': [32, 16], 'ui.btn.press': [32, 16], 'bg.sun': [16, 16], 'bg.moon': [16, 16],
    };
    for (const [id, entry] of Object.entries(ART)) {
      const want = EXPECTED[id];
      if (!want || !entry || entry.kind !== 'sprite') continue;
      expect([entry.w, entry.h], `${id} size`).toEqual(want);
    }
  });

  it('the meter/ruble icons are authored at 8×8 (matches the live HUD + §8.16 snapshot)', () => {
    for (const id of ['icon.sleep', 'icon.hunger', 'icon.thirst', 'icon.vice', 'icon.poo', 'icon.ruble'] as const) {
      const entry = ART[id];
      expect(entry, `${id} present`).toBeDefined();
      if (entry && entry.kind === 'sprite') {
        expect([entry.w, entry.h]).toEqual([8, 8]);
      }
    }
  });

  it('no sprite id is unrenderable — the placeholder covers everything not yet in ART', () => {
    const placeholder = createPlaceholderProvider();
    for (const id of SPRITE_IDS) {
      expect(id in ART || placeholder.has(id)).toBe(true);
      expect(() => placeholder.resolve(id)).not.toThrow();
    }
  });
});
