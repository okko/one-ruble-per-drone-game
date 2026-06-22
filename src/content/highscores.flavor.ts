/**
 * Cheerful-but-grim flavor lines for the highscore entry/list screens (docs/areas/08-highscores.md
 * §3.9/§5). DATA, not logic — kept relentlessly upbeat over a bleak premise (docs/game-design.md §2),
 * and clear of any framing that pins a trait on a people (docs/compliance.md §2).
 */
export const FLAVOR_LINES: readonly string[] = [
  'A ruble a drone — what a deal!',
  'The motherland thanks you.',
  'Glory is its own pension.',
  'Your name in lights — and ledgers.',
  'Another shift survived, comrade!',
  'Heroes of the 23rd floor.',
];

/** Shown on a brand-new personal best (§3.9). */
export const NEW_BEST_LINE = 'NEW PERSONAL BEST, COMRADE!';

/** Shown when a finished run misses the table (§3.4). */
export const NO_CUT_LINE = 'No medal today — but what a shift!';
