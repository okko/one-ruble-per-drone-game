/**
 * Credits roster (docs/areas/12-credits.md §5) — the data answer to "who made the game, with what
 * title." Source of truth for the Credits panel (rendered inside the Main Menu). This game is built
 * by Claude under the human creator's direction; the roster reflects that truthfully — keep it
 * accurate as real contributors are added, never invent fictitious people. Per-area titles map 1:1
 * to the areas in docs/README.md.
 */
export interface CreditEntry {
  title: string;
  names: string[];
}
export interface CreditSection {
  heading: string;
  entries: CreditEntry[];
}
export type CreditsRoster = CreditSection[];

export const CREDITS: CreditsRoster = [
  {
    heading: 'Concept & Creative Direction',
    entries: [{ title: 'Creator · Concept & Creative Direction', names: ['Okko Ojala'] }],
  },
  {
    heading: 'Production',
    entries: [
      { title: 'Executive Associate Producer', names: ['Tuomas Vehmainen'] },
      { title: 'Associate Producer', names: ['Mika Viljanen'] },
    ],
  },
  {
    heading: 'Lead Development & Game Design',
    entries: [{ title: 'Lead Developer & Game Designer', names: ['Claude'] }],
  },
  {
    heading: 'Area Engineering',
    entries: [
      { title: 'Core Platform & Build Engineer', names: ['Claude'] },
      { title: 'Gameplay Engine Engineer', names: ['Claude'] },
      { title: 'Gameplay Status / Meters Engineer', names: ['Claude'] },
      { title: 'Economy & Residents Engineer', names: ['Claude'] },
      { title: 'Scoring (Pinball) Engineer', names: ['Claude'] },
      { title: 'Random Incidents — Designer & Engineer', names: ['Claude'] },
      { title: 'Audio Engineer (Music & SFX)', names: ['Claude'] },
      { title: 'Main Menu Engineer', names: ['Claude'] },
      { title: 'Highscores Engineer', names: ['Claude'] },
      { title: 'State & Persistence Engineer', names: ['Claude'] },
      { title: 'HUD & In-game UI Engineer', names: ['Claude'] },
      { title: 'Art & Visual Style / Pixel Artist', names: ['Claude'] },
      { title: 'Credits Engineer', names: ['Claude'] },
    ],
  },
  {
    heading: 'Tools & Technology',
    entries: [
      { title: 'Built with', names: ['TypeScript', 'Vite', 'Canvas 2D', 'Web Audio API', 'Vitest'] },
      { title: 'AI development', names: ['Claude'] },
    ],
  },
  {
    heading: 'Special Thanks',
    entries: [
      { title: 'For the favors', names: ['The residents of the skyscraper'] },
      { title: 'For your service, soldier', names: ['₽1'] },
    ],
  },
];
