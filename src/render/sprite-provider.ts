/**
 * Sprite resolution (docs/areas/11-art-visual-style.md §4, §7). Two implementations conform to
 * one `SpriteProvider` contract:
 *  - `createPlaceholderProvider` covers 100% of SpriteIds with palette-keyed shapes / emoji
 *    glyphs, so no area is ever blocked on final pixels;
 *  - `createManifestProvider` resolves ids present in the atlas manifest and DELEGATES any
 *    missing id to a placeholder — giving per-id real-vs-placeholder selection.
 * Both return draw-SPECS (rect/pivot/glyph); the actual canvas blit is the renderer's job.
 */
import type { SpriteId } from '../content/sprite-ids';
import type { AssetManifest, FontDescriptor, Rect } from '../content/assets';

export interface ResolvedSprite {
  source: 'atlas' | 'placeholder' | 'glyph';
  rect: Rect;
  pivot: [number, number];
  glyph?: string;
  /** Present for bitmap-font sprites so the renderer can index glyph cells within `rect`. */
  font?: FontDescriptor;
}

export interface SpriteProvider {
  has(id: SpriteId): boolean;
  /** Never throws for a registered id; the placeholder covers everything. */
  resolve(id: SpriteId, frame?: number): ResolvedSprite;
}

// Default pivot is center-bottom; airborne/effect sprites pivot at their center (§3.3).
const CENTER_PIVOT_PREFIXES = ['drone.', 'fx.', 'pickup.', 'decoy.'];

function computePivot(
  id: SpriteId,
  w: number,
  h: number,
  defPivot?: [number, number],
): [number, number] {
  if (defPivot) return defPivot;
  if (CENTER_PIVOT_PREFIXES.some((p) => id.startsWith(p))) return [w / 2, h / 2];
  return [w / 2, h];
}

// Emoji fallbacks for the placeholder provider (the poo icon reads as 💩; §3.4).
const GLYPHS: Partial<Record<string, string>> = {
  'icon.sleep': '😴',
  'icon.poo': '💩',
  'icon.hunger': '🍞',
  'icon.thirst': '💧',
  'icon.vice': '🚬',
  'icon.ruble': '₽',
};

// Source-pixel sizes from §3.3, used to size placeholder shapes.
const SIZES: Partial<Record<string, [number, number]>> = {
  'soldier.idle': [32, 40],
  'soldier.fire': [32, 40],
  'soldier.tired': [32, 40],
  'soldier.crisis': [32, 40],
  'gun.base': [28, 16],
  'gun.flash': [16, 16],
  'drone.scout': [16, 16],
  'drone.bomber': [24, 24],
  'drone.swarm': [12, 12],
  'drone.armored': [24, 20],
  'drone.special': [16, 16],
  'drone.boss': [48, 48],
  'decoy.bird': [16, 12],
  'fx.tracer': [4, 4],
  'fx.explosion': [32, 32],
  'fx.spark': [8, 8],
  'fx.drip': [8, 8],
  'pickup.ruble': [8, 8],
  'ui.panel': [16, 16],
  'ui.panel.corner': [8, 8],
  'ui.meter.frame': [48, 8],
  'ui.meter.fill': [48, 8],
  'ui.btn': [32, 16],
  'ui.btn.hover': [32, 16],
  'ui.btn.press': [32, 16],
  'icon.sleep': [12, 12],
  'icon.poo': [12, 12],
  'icon.hunger': [12, 12],
  'icon.thirst': [12, 12],
  'icon.vice': [12, 12],
  'icon.ruble': [12, 12],
  'bg.sun': [16, 16],
  'bg.moon': [16, 16],
  'font.display': [8, 8],
  'font.hud': [5, 7],
};
const PORTRAIT_SIZE: [number, number] = [64, 64];
const DEFAULT_SIZE: [number, number] = [16, 16];

function placeholderSize(id: SpriteId): [number, number] {
  if (id.startsWith('portrait.')) return PORTRAIT_SIZE;
  return SIZES[id] ?? DEFAULT_SIZE;
}

export function createPlaceholderProvider(): SpriteProvider {
  return {
    has: () => true,
    resolve(id) {
      const [w, h] = placeholderSize(id);
      const rect: Rect = { x: 0, y: 0, w, h };
      const pivot = computePivot(id, w, h);
      const glyph = GLYPHS[id];
      if (glyph !== undefined) return { source: 'glyph', rect, pivot, glyph };
      return { source: 'placeholder', rect, pivot };
    },
  };
}

export function createManifestProvider(
  manifest: AssetManifest,
  placeholder: SpriteProvider,
): SpriteProvider {
  return {
    has: (id) => id in manifest.sprites || placeholder.has(id),
    resolve(id, frame) {
      const def = manifest.sprites[id];
      if (!def) return placeholder.resolve(id, frame);
      const f = frame ?? 0;
      let rect: Rect = { x: def.x, y: def.y, w: def.w, h: def.h };
      if (def.anim) {
        if (def.anim.layout === 'rects' && def.anim.rects) {
          rect = def.anim.rects[f] ?? rect;
        } else {
          rect = { x: def.x + f * def.w, y: def.y, w: def.w, h: def.h };
        }
      }
      return {
        source: 'atlas',
        rect,
        pivot: computePivot(id, def.w, def.h, def.pivot),
        ...(def.font ? { font: def.font } : {}),
      };
    },
  };
}

/** Width of a string in the (monospace) bitmap font (docs/areas/11-art-visual-style.md §3.7). */
export function measureText(font: Pick<FontDescriptor, 'glyphW'>, text: string): number {
  return text.length * font.glyphW;
}
