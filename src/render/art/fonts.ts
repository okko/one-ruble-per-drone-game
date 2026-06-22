/**
 * Bitmap font (docs/areas/11-art-visual-style.md §3.7). A 5×7 retro face: contiguous codepoints
 * 32..90 (space through 'Z' — uppercase, digits, common punctuation), then the non-ASCII customs the
 * renderer maps by name (`₽ × → ← ↑ ↓ — ©`). Lowercase is mapped to uppercase by the renderer, and
 * any uncovered char falls back to the monospace path — so authoring stays tractable while the look
 * is real pixels. Glyphs are monochrome (one opaque key); the renderer tints the strip per `color`.
 * Both `font.display` and `font.hud` use this face (see `art/index.ts`).
 */
import type { PixelGrid } from './types';

/** Build a 5-wide × 7-tall glyph from up to-5-char rows (padded). `x` = opaque, space = transparent. */
function g(r0: string, r1: string, r2: string, r3: string, r4: string, r5: string, r6: string): PixelGrid {
  return {
    rows: [r0, r1, r2, r3, r4, r5, r6].map((r) => (r + '     ').slice(0, 5)),
    legend: { x: 'cream' },
  };
}

const BLANK = g('', '', '', '', '', '', '');

// Codepoints 32..90 in order. Unused punctuation slots are BLANK (rendered as a gap if ever shown).
const CONTIGUOUS: PixelGrid[] = [
  BLANK, // 32 space
  g(' x ', ' x ', ' x ', ' x ', ' x ', '   ', ' x '), // 33 !
  BLANK, // 34 "
  g(' x x', ' x x', 'xxxxx', ' x x', 'xxxxx', ' x x', '    '), // 35 #
  BLANK, // 36 $
  g('xx  x', 'xx x ', '  x  ', ' x xx', 'x  xx', '     ', '     '), // 37 %
  g(' xx ', 'x  x', ' xx ', 'x x ', 'x  x', 'x x ', ' x x'), // 38 &
  g(' x ', ' x ', '   ', '   ', '   ', '   ', '   '), // 39 '
  g('  x', ' x ', ' x ', ' x ', ' x ', ' x ', '  x'), // 40 (
  g('x  ', ' x ', ' x ', ' x ', ' x ', ' x ', 'x  '), // 41 )
  BLANK, // 42 *
  g('   ', '   ', ' x ', 'xxx', ' x ', '   ', '   '), // 43 +
  g('   ', '   ', '   ', '   ', ' x ', ' x ', 'x  '), // 44 ,
  g('   ', '   ', '   ', 'xxxx', '   ', '   ', '   '), // 45 -
  g('   ', '   ', '   ', '   ', '   ', ' x ', ' x '), // 46 .
  g('   x', '   x', '  x ', '  x ', ' x  ', 'x   ', 'x   '), // 47 /
  g(' xx ', 'x  x', 'x  x', 'x  x', 'x  x', 'x  x', ' xx '), // 48 0
  g('  x ', ' xx ', '  x ', '  x ', '  x ', '  x ', ' xxx'), // 49 1
  g(' xx ', 'x  x', '   x', '  x ', ' x  ', 'x   ', 'xxxx'), // 50 2
  g('xxx ', '   x', '   x', ' xx ', '   x', '   x', 'xxx '), // 51 3
  g('   x', '  xx', ' x x', 'x  x', 'xxxx', '   x', '   x'), // 52 4
  g('xxxx', 'x   ', 'x   ', 'xxx ', '   x', '   x', 'xxx '), // 53 5
  g(' xx ', 'x   ', 'x   ', 'xxx ', 'x  x', 'x  x', ' xx '), // 54 6
  g('xxxx', '   x', '  x ', '  x ', ' x  ', ' x  ', ' x  '), // 55 7
  g(' xx ', 'x  x', 'x  x', ' xx ', 'x  x', 'x  x', ' xx '), // 56 8
  g(' xx ', 'x  x', 'x  x', ' xxx', '   x', '   x', ' xx '), // 57 9
  g('   ', '   ', ' x ', '   ', '   ', ' x ', '   '), // 58 :
  g('   ', '   ', ' x ', '   ', ' x ', ' x ', 'x  '), // 59 ;
  g('   x', '  x ', ' x  ', 'x   ', ' x  ', '  x ', '   x'), // 60 <
  g('    ', '    ', 'xxxx', '    ', 'xxxx', '    ', '    '), // 61 =
  g('x   ', ' x  ', '  x ', '   x', '  x ', ' x  ', 'x   '), // 62 >
  g(' xx ', 'x  x', '   x', '  x ', ' x  ', '   ', ' x  '), // 63 ?
  g(' xxx ', 'x   x', 'x xxx', 'x x x', 'x xxx', 'x    ', ' xxx '), // 64 @
  g(' xx ', 'x  x', 'x  x', 'xxxx', 'x  x', 'x  x', 'x  x'), // 65 A
  g('xxx ', 'x  x', 'x  x', 'xxx ', 'x  x', 'x  x', 'xxx '), // 66 B
  g(' xxx', 'x   ', 'x   ', 'x   ', 'x   ', 'x   ', ' xxx'), // 67 C
  g('xxx ', 'x  x', 'x  x', 'x  x', 'x  x', 'x  x', 'xxx '), // 68 D
  g('xxxx', 'x   ', 'x   ', 'xxx ', 'x   ', 'x   ', 'xxxx'), // 69 E
  g('xxxx', 'x   ', 'x   ', 'xxx ', 'x   ', 'x   ', 'x   '), // 70 F
  g(' xxx', 'x   ', 'x   ', 'x xx', 'x  x', 'x  x', ' xxx'), // 71 G
  g('x  x', 'x  x', 'x  x', 'xxxx', 'x  x', 'x  x', 'x  x'), // 72 H
  g('xxx', ' x ', ' x ', ' x ', ' x ', ' x ', 'xxx'), // 73 I
  g('  xx', '   x', '   x', '   x', 'x  x', 'x  x', ' xx '), // 74 J
  g('x  x', 'x x ', 'xx  ', 'xx  ', 'x x ', 'x x ', 'x  x'), // 75 K
  g('x   ', 'x   ', 'x   ', 'x   ', 'x   ', 'x   ', 'xxxx'), // 76 L
  g('x   x', 'xx xx', 'x x x', 'x   x', 'x   x', 'x   x', 'x   x'), // 77 M
  g('x  x', 'xx x', 'xx x', 'x xx', 'x xx', 'x  x', 'x  x'), // 78 N
  g(' xx ', 'x  x', 'x  x', 'x  x', 'x  x', 'x  x', ' xx '), // 79 O
  g('xxx ', 'x  x', 'x  x', 'xxx ', 'x   ', 'x   ', 'x   '), // 80 P
  g(' xx ', 'x  x', 'x  x', 'x  x', 'x x ', ' xx ', '   x'), // 81 Q
  g('xxx ', 'x  x', 'x  x', 'xxx ', 'x x ', 'x  x', 'x  x'), // 82 R
  g(' xxx', 'x   ', 'x   ', ' xx ', '   x', '   x', 'xxx '), // 83 S
  g('xxxxx', '  x  ', '  x  ', '  x  ', '  x  ', '  x  ', '  x  '), // 84 T
  g('x  x', 'x  x', 'x  x', 'x  x', 'x  x', 'x  x', ' xx '), // 85 U
  g('x   x', 'x   x', 'x   x', ' x x ', ' x x ', '  x  ', '  x  '), // 86 V
  g('x   x', 'x   x', 'x   x', 'x x x', 'x x x', 'xx xx', 'x   x'), // 87 W
  g('x  x', 'x  x', ' xx ', ' xx ', ' xx ', 'x  x', 'x  x'), // 88 X
  g('x   x', 'x   x', ' x x ', '  x  ', '  x  ', '  x  ', '  x  '), // 89 Y
  g('xxxx', '   x', '  x ', ' xx ', ' x  ', 'x   ', 'xxxx'), // 90 Z
];

// Customs, in renderer CUSTOM_GLYPHS offset order: ₽ × → ← ↑ ↓ — ©
const CUSTOM: PixelGrid[] = [
  g('xxx ', 'x  x', 'xxx ', 'xx  ', 'x   ', 'x   ', '    '), // ₽
  g('    ', 'x  x', ' xx ', '  x ', ' xx ', 'x  x', '    '), // ×
  g('     ', '  x  ', '   x ', 'xxxxx', '   x ', '  x  ', '     '), // →
  g('     ', '  x  ', ' x   ', 'xxxxx', ' x   ', '  x  ', '     '), // ←
  g('  x  ', ' xxx ', 'x x x', '  x  ', '  x  ', '  x  ', '     '), // ↑
  g('  x  ', '  x  ', '  x  ', 'x x x', ' xxx ', '  x  ', '     '), // ↓
  g('     ', '     ', '     ', 'xxxxx', '     ', '     ', '     '), // —
  g(' xxx ', 'x   x', 'x xx ', 'x x  ', 'x xx ', 'x   x', ' xxx '), // ©
];

export const FONT_5x7 = {
  glyphW: 5,
  glyphH: 7,
  firstCharCode: 32,
  glyphs: [...CONTIGUOUS, ...CUSTOM],
};
