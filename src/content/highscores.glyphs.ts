/**
 * Allowed glyphs for retro highscore name entry (docs/areas/08-highscores.md §3.6/§5). DATA only:
 * the on-screen character picker and `validateName` (ui/highscores/table.ts) consume this set.
 * Uppercase retro feel — letters, digits, space, and a little punctuation. `PLACEHOLDER_NAME` is
 * the `AAA` default substituted when a submitted name is empty/whitespace-only (§3.1).
 */
export const NAME_GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .-!';

export const PLACEHOLDER_NAME = 'AAA';
