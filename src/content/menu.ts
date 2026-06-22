/**
 * Main Menu content (docs/areas/07-main-menu.md §3/§5). DATA: the ordered option list, title/tagline/
 * footer copy, the one-screen How-to-Play text, and the attract-teaser card. Order/labels live here
 * so they are easy to tune; the id→action routing stays in `ui/main-menu-scene.ts`. Tone is cheerful-
 * but-grim and compliance-clean (docs/game-design.md §2, docs/compliance.md §2).
 */
export type MenuItemId = 'start' | 'highscores' | 'settings' | 'howto' | 'credits';

export interface MenuItemDef {
  id: MenuItemId;
  label: string;
}

export const MENU_ITEMS: readonly MenuItemDef[] = [
  { id: 'start', label: 'START NEW SHIFT' },
  { id: 'highscores', label: 'HIGHSCORES' },
  { id: 'settings', label: 'SETTINGS' },
  { id: 'howto', label: 'HOW TO PLAY' },
  { id: 'credits', label: 'CREDITS' },
];

export const TITLE = 'ONE RUBLE PER DRONE';
export const TAGLINE = 'A ruble a drone — what a deal!';
export const FOOTER = '© residents of the 23rd floor';

export const HOW_TO_PLAY: readonly string[] = [
  'Aim and fire to down drones.',
  'Each drone downed pays you 1 RUBLE.',
  'Keep your five needs out of the red:',
  'sleep, hunger, thirst, vice, hygiene.',
  'Buy services with your rubles.',
  'Out of rubles? Beg a neighbor a favor.',
  'Survive the incidents. Chase the score!',
];

export const ATTRACT_TEASER: readonly string[] = [
  'ONE RUBLE PER DRONE',
  'A ruble a drone — what a deal!',
  'Press any key to enlist.',
];
