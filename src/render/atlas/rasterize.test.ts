// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { rasterizeGrid, tintRGBA, planAtlasLayout, type RasterImage } from './rasterize';
import { PALETTE } from '../palette';
import { ART } from '../art/index';
import type { ArtEntry, PixelGrid } from '../art/types';
import type { SpriteId } from '../../content/sprite-ids';

const px = (img: RasterImage, x: number, y: number): [number, number, number, number] => {
  const i = (y * img.width + x) * 4;
  return [img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0, img.data[i + 3] ?? 0];
};

describe('rasterizeGrid', () => {
  it('maps legend chars to palette RGB and spaces to transparent', () => {
    const grid: PixelGrid = { rows: ['a ', ' a'], legend: { a: 'ink' } }; // ink = #1a1c2c
    const img = rasterizeGrid(grid, PALETTE);
    expect(img.width).toBe(2);
    expect(img.height).toBe(2);
    expect(px(img, 0, 0)).toEqual([0x1a, 0x1c, 0x2c, 255]);
    expect(px(img, 1, 0)).toEqual([0, 0, 0, 0]); // space → transparent
    expect(px(img, 0, 1)).toEqual([0, 0, 0, 0]);
    expect(px(img, 1, 1)).toEqual([0x1a, 0x1c, 0x2c, 255]);
  });

  it('throws on a ragged row', () => {
    expect(() => rasterizeGrid({ rows: ['aa', 'a'], legend: { a: 'ink' } }, PALETTE)).toThrow(/ragged/);
  });

  it('throws on a char missing from the legend', () => {
    expect(() => rasterizeGrid({ rows: ['ab'], legend: { a: 'ink' } }, PALETTE)).toThrow(/legend/);
  });
});

describe('tintRGBA', () => {
  it('recolours opaque pixels and leaves transparent ones alone', () => {
    const base = rasterizeGrid({ rows: ['a '], legend: { a: 'ink' } }, PALETTE);
    const tinted = tintRGBA(base, PALETTE.meterCrit); // #ff3b3b
    expect(px(tinted, 0, 0)).toEqual([0xff, 0x3b, 0x3b, 255]);
    expect(px(tinted, 1, 0)).toEqual([0, 0, 0, 0]);
    // original untouched (fresh image)
    expect(px(base, 0, 0)).toEqual([0x1a, 0x1c, 0x2c, 255]);
  });
});

describe('planAtlasLayout', () => {
  it('packs the icon art into non-overlapping, in-bounds slots', () => {
    const layout = planAtlasLayout(ART);
    expect(layout.slots.length).toBe(Object.keys(ART).length);
    for (const slot of layout.slots) {
      expect(slot.def.x).toBeGreaterThanOrEqual(0);
      expect(slot.def.y).toBeGreaterThanOrEqual(0);
      // a single-frame icon footprint must lie within the atlas
      expect(slot.def.x + slot.def.w).toBeLessThanOrEqual(layout.width);
      expect(slot.def.y + slot.def.h).toBeLessThanOrEqual(layout.height);
    }
    // no two footprints overlap
    const defs = layout.slots.map((s) => s.def);
    for (let i = 0; i < defs.length; i++) {
      for (let j = i + 1; j < defs.length; j++) {
        const a = defs[i];
        const b = defs[j];
        if (!a || !b) continue;
        const disjoint = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(disjoint).toBe(true);
      }
    }
  });

  it('emits a horizontal anim for multi-frame sprites and a font descriptor for fonts', () => {
    const synthetic: Partial<Record<SpriteId, ArtEntry>> = {
      'drone.scout': { kind: 'sprite', w: 4, h: 4, fps: 12, frames: [blank(4), blank(4), blank(4)] },
      'gun.base': { kind: 'sprite', w: 6, h: 3, pivot: [4, 8], frames: [blank(6, 3)] },
      'font.hud': { kind: 'font', glyphW: 5, glyphH: 7, firstCharCode: 32, glyphs: [blank(5, 7), blank(5, 7)] },
    };
    const { slots } = planAtlasLayout(synthetic);
    const byId = (id: SpriteId) => slots.find((s) => s.id === id)?.def;
    const scout = byId('drone.scout');
    expect(scout?.anim).toEqual({ frames: 3, fps: 12, layout: 'horizontal' });
    const gun = byId('gun.base');
    expect(gun?.pivot).toEqual([4, 8]);
    expect(gun?.anim).toBeUndefined(); // single frame
    const font = byId('font.hud');
    expect(font?.font).toEqual({ glyphW: 5, glyphH: 7, firstCharCode: 32 });
    expect(font?.w).toBe(10); // 2 glyphs × 5px strip
  });
});

function blank(w: number, h = w): PixelGrid {
  return { rows: Array.from({ length: h }, () => ' '.repeat(w)), legend: {} };
}
