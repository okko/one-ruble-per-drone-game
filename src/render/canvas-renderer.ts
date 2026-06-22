/**
 * Concrete Canvas 2D renderer (Core/Render). Wraps the 384×216 backing context and resolves sprites
 * through a SpriteProvider, blitting from the in-memory art atlas (`render/atlas`). Applies
 * rotation/flip/alpha about the pivot, and a flat colour TINT via a small cache of re-coloured
 * offscreen canvases keyed by `(id,frame,tint)` (read back from the atlas, recoloured with
 * `tintRGBA`). `text()` blits the bitmap font from the atlas, tinting the whole glyph strip once per
 * colour; it falls back to the system monospace font for any id without atlas art (placeholder).
 * DOM edge — not unit-tested; exercised by the Playwright matrix.
 */
import type { Renderer, DrawOpts, TextOpts } from './renderer';
import { PALETTE, type PaletteKey } from './palette';
import type { SpriteProvider } from './sprite-provider';
import type { SpriteId } from '../content/sprite-ids';
import type { Rect } from '../content/assets';
import type { Vec2 } from '../core/math';
import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from './scaler';
import { tintRGBA } from './atlas/rasterize';

const HUD_GLYPH = 8; // px per glyph for the monospace fallback (no atlas font yet)

// Non-contiguous codepoints placed after the contiguous ASCII run in the font strip (docs/areas/11
// §3.7). Index = (firstCharCode + ASCII_SPAN) + offset; see `glyphIndex`.
const ASCII_SPAN = 'Z'.charCodeAt(0) - 32 + 1; // space(32)..'Z'(90) inclusive
const CUSTOM_GLYPHS: Record<string, number> = { '₽': 0, '×': 1, '→': 2, '←': 3, '↑': 4, '↓': 5, '—': 6, '©': 7 };

export interface CanvasRenderer extends Renderer {
  setAlpha(a: number): void;
}

export function createCanvasRenderer(
  ctx: CanvasRenderingContext2D,
  sprites: SpriteProvider,
  atlasImage?: HTMLCanvasElement,
): CanvasRenderer {
  let alpha = 0;
  ctx.imageSmoothingEnabled = false;

  // Lazy 2D context of the atlas, used to read pixels back for tinting.
  let readCtx: CanvasRenderingContext2D | null = null;
  function atlasCtx(): CanvasRenderingContext2D | null {
    if (!atlasImage) return null;
    if (!readCtx) readCtx = atlasImage.getContext('2d');
    return readCtx;
  }

  // Cache of recoloured offscreen canvases (whole sprite rect or whole font strip), keyed by intent.
  const tintCache = new Map<string, HTMLCanvasElement>();
  function tinted(key: string, rect: Rect, color: PaletteKey): HTMLCanvasElement | null {
    const hit = tintCache.get(key);
    if (hit) return hit;
    const src = atlasCtx();
    if (!src) return null;
    const srcData = src.getImageData(rect.x, rect.y, rect.w, rect.h);
    const out = tintRGBA({ width: rect.w, height: rect.h, data: srcData.data }, PALETTE[color]);
    const c = document.createElement('canvas');
    c.width = rect.w;
    c.height = rect.h;
    const cctx = c.getContext('2d');
    if (!cctx) return null;
    cctx.imageSmoothingEnabled = false;
    cctx.putImageData(new ImageData(out.data, rect.w, rect.h), 0, 0);
    tintCache.set(key, c);
    return c;
  }

  // Blit a source rect at the sprite's pivot, applying rotation/flip/alpha when present.
  function blit(img: CanvasImageSource, rect: Rect, pos: Vec2, pivotX: number, pivotY: number, opts?: DrawOpts): void {
    const a = opts?.alpha ?? 1;
    const rot = opts?.rotation ?? 0;
    const flip = opts?.flipX ?? false;
    if (a === 1 && rot === 0 && !flip) {
      ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, Math.round(pos.x - pivotX), Math.round(pos.y - pivotY), rect.w, rect.h);
      return;
    }
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(pos.x, pos.y); // rotate/flip about the pivot point
    if (rot !== 0) ctx.rotate(rot);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, -pivotX, -pivotY, rect.w, rect.h);
    ctx.restore();
  }

  function glyphIndex(ch: string, firstCharCode: number): number {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= firstCharCode && code < firstCharCode + ASCII_SPAN) return code - firstCharCode;
    if (code >= 97 && code <= 122) return code - 32 - firstCharCode; // lowercase → uppercase glyph
    const custom = CUSTOM_GLYPHS[ch];
    return custom === undefined ? -1 : ASCII_SPAN + custom;
  }

  function fallbackText(str: string, x: number, y: number, opts?: TextOpts): void {
    ctx.fillStyle = PALETTE[opts?.color ?? 'cream'];
    ctx.font = `${HUD_GLYPH}px monospace`;
    ctx.textBaseline = 'top';
    const width = str.length * HUD_GLYPH;
    const dx = opts?.align === 'center' ? x - width / 2 : opts?.align === 'right' ? x - width : x;
    ctx.fillText(str, dx, y);
  }

  return {
    width: INTERNAL_WIDTH,
    height: INTERNAL_HEIGHT,
    get alpha(): number {
      return alpha;
    },
    setAlpha(a: number): void {
      alpha = a;
    },
    clear(color: PaletteKey = 'ink'): void {
      ctx.fillStyle = PALETTE[color];
      ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
    },
    fillRect(x: number, y: number, w: number, h: number, color: PaletteKey): void {
      ctx.fillStyle = PALETTE[color];
      ctx.fillRect(x, y, w, h);
    },
    drawSprite(id: SpriteId, pos: Vec2, opts?: DrawOpts): void {
      const r = sprites.resolve(id, opts?.frame);
      const [px, py] = r.pivot;
      if (r.source === 'glyph' && r.glyph !== undefined) {
        ctx.font = `${r.rect.h}px sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(r.glyph, pos.x - px, pos.y - py);
        return;
      }
      if (r.source === 'atlas' && atlasImage) {
        if (opts?.tint) {
          const tc = tinted(`${id}|${opts.frame ?? 0}|${opts.tint}`, r.rect, opts.tint);
          if (tc) {
            blit(tc, { x: 0, y: 0, w: tc.width, h: tc.height }, pos, px, py, opts);
            return;
          }
        }
        blit(atlasImage, r.rect, pos, px, py, opts);
        return;
      }
      // Placeholder fallback (unfinished id, or no atlas wired): a tinted box.
      ctx.fillStyle = PALETTE[opts?.tint ?? 'panelLite'];
      ctx.fillRect(pos.x - px, pos.y - py, r.rect.w, r.rect.h);
    },
    text(str: string, x: number, y: number, opts?: TextOpts): void {
      const fontId = (opts?.font ?? 'font.hud') as SpriteId;
      const rf = sprites.resolve(fontId);
      if (rf.source !== 'atlas' || !rf.font || !atlasImage) {
        fallbackText(str, x, y, opts);
        return;
      }
      const color = opts?.color ?? 'cream';
      const { glyphW, glyphH, firstCharCode } = rf.font;
      const strip = tinted(`${fontId}|strip|${color}`, rf.rect, color);
      if (!strip) {
        fallbackText(str, x, y, opts);
        return;
      }
      const width = str.length * glyphW;
      let dx = opts?.align === 'center' ? Math.round(x - width / 2) : opts?.align === 'right' ? x - width : x;
      for (const ch of str) {
        const idx = glyphIndex(ch, firstCharCode);
        const sx = idx * glyphW;
        if (idx >= 0 && sx + glyphW <= strip.width) {
          ctx.drawImage(strip, sx, 0, glyphW, glyphH, Math.round(dx), Math.round(y), glyphW, glyphH);
        }
        dx += glyphW;
      }
    },
  };
}
