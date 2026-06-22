/**
 * Credits view — PURE scroll + render (docs/areas/12-credits.md §3/§4). Deterministic: `scrollY` is
 * advanced only by injected `dt` (no clock, no RNG), so the same `dt` sequence yields the same
 * scroll. Rendered as the Main Menu's Credits panel (loop end-behavior); the `return` end-behavior +
 * `pageCredits` (reduced-motion paging) are implemented and tested for completeness. View state is
 * local — viewing credits mutates no gameplay state (§7).
 */
import type { Renderer } from '../render/renderer';
import type { PaletteKey } from '../render/palette';
import type { SpriteId } from '../content/sprite-ids';
import type { CreditsRoster } from '../content/credits';

export const SCROLL_PX_PER_SEC = 14;
export const SCRUB_MIN = 4;
export const SCRUB_MAX = 60;
const LINE_H = 9;
const PAGE_PX = 180; // ~ one viewport for reduced-motion paging

export type CreditsEndBehavior = 'loop' | 'return';

export interface CreditsViewState {
  scrollY: number; // px scrolled; advanced by dt * speed
  speed: number; // current scroll px/sec (scrubbable)
  finished: boolean;
}

export interface CreditsUpdateOpts {
  endBehavior?: CreditsEndBehavior;
  reducedMotion?: boolean;
}

export function createCreditsView(speed = SCROLL_PX_PER_SEC): CreditsViewState {
  return { scrollY: 0, speed, finished: false };
}

interface Line {
  text: string;
  kind: 'heading' | 'title' | 'name' | 'spacer';
}

function flatten(roster: CreditsRoster): Line[] {
  const lines: Line[] = [];
  for (const section of roster) {
    lines.push({ text: section.heading, kind: 'heading' });
    for (const entry of section.entries) {
      lines.push({ text: entry.title, kind: 'title' });
      for (const name of entry.names) lines.push({ text: name, kind: 'name' });
    }
    lines.push({ text: '', kind: 'spacer' });
  }
  return lines;
}

/** Total scrollable height of the roll (px). */
export function creditsContentHeight(roster: CreditsRoster): number {
  return flatten(roster).length * LINE_H;
}

/** Advance the roll. Reduced-motion disables auto-scroll (the scene pages instead). */
export function updateCredits(
  v: CreditsViewState,
  dt: number,
  roster: CreditsRoster,
  opts: CreditsUpdateOpts = {},
): void {
  if (opts.reducedMotion) return;
  v.scrollY += dt * v.speed;
  const total = creditsContentHeight(roster);
  if (v.scrollY >= total) {
    if ((opts.endBehavior ?? 'loop') === 'loop') {
      v.scrollY -= total; // seamless wrap
    } else {
      v.scrollY = total;
      v.finished = true;
    }
  }
}

/** Scrub the scroll speed within clamped bounds (§3.3). */
export function scrubCredits(v: CreditsViewState, delta: number): void {
  v.speed = Math.max(SCRUB_MIN, Math.min(SCRUB_MAX, v.speed + delta));
}

/** Reduced-motion paging: jump by ~a viewport, clamped to the roll (§3.6). */
export function pageCredits(v: CreditsViewState, dir: number, roster: CreditsRoster): void {
  const total = creditsContentHeight(roster);
  v.scrollY = Math.max(0, Math.min(total, v.scrollY + dir * PAGE_PX));
}

/** Draw the roll centered over whatever backdrop the caller already painted. */
export function renderCredits(r: Renderer, v: CreditsViewState, roster: CreditsRoster): void {
  const lines = flatten(roster);
  const cx = Math.floor(r.width / 2);
  lines.forEach((line, i) => {
    if (line.kind === 'spacer') return;
    const y = r.height + i * LINE_H - v.scrollY; // scrolls up from the bottom edge
    const color: PaletteKey =
      line.kind === 'heading' ? 'accentPink' : line.kind === 'title' ? 'rubleGold' : 'cream';
    const font: SpriteId = line.kind === 'name' ? 'font.display' : 'font.hud';
    r.text(line.text, cx, Math.round(y), { align: 'center', color, font });
  });
}
