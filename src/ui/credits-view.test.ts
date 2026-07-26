// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  createCreditsView,
  updateCredits,
  creditsLines,
  scrubCredits,
  pageCredits,
  creditsContentHeight,
  SCRUB_MIN,
  SCRUB_MAX,
} from './credits-view';
import { CREDITS } from '../content/credits';

describe('credits-view', () => {
  it('flattens every section heading, entry title, and name, in roster order', () => {
    const texts = creditsLines(CREDITS).map((l) => l.text);
    for (const section of CREDITS) {
      expect(texts).toContain(section.heading);
      for (const e of section.entries) {
        expect(texts).toContain(e.title);
        for (const name of e.names) expect(texts).toContain(name);
      }
    }
    // A heading always precedes the entries it introduces.
    const first = CREDITS[0];
    if (first?.entries[0]) {
      expect(texts.indexOf(first.heading)).toBeLessThan(texts.indexOf(first.entries[0].title));
    }
  });

  it('tags each line with the kind the panel styles it by', () => {
    const kinds = new Set(creditsLines(CREDITS).map((l) => l.kind));
    expect(kinds).toEqual(new Set(['heading', 'title', 'name', 'spacer']));
  });

  it('advances scrollY by exactly dt * speed and is reproducible', () => {
    const a = createCreditsView(10);
    const b = createCreditsView(10);
    updateCredits(a, 0.5, CREDITS);
    updateCredits(b, 0.5, CREDITS);
    expect(a.scrollY).toBe(5);
    expect(a.scrollY).toBe(b.scrollY);
    updateCredits(a, 0.5, CREDITS);
    expect(a.scrollY).toBe(10);
  });

  it('scrub clamps the speed to its bounds', () => {
    const v = createCreditsView(10);
    scrubCredits(v, 1000);
    expect(v.speed).toBe(SCRUB_MAX);
    scrubCredits(v, -10000);
    expect(v.speed).toBe(SCRUB_MIN);
  });

  it('loops seamlessly at the end (finished stays false)', () => {
    const total = creditsContentHeight(CREDITS);
    const v = createCreditsView(10);
    v.scrollY = total - 1;
    updateCredits(v, 1, CREDITS, { endBehavior: 'loop' });
    expect(v.scrollY).toBeLessThan(total);
    expect(v.finished).toBe(false);
  });

  it('finishes at the end when end behavior is return', () => {
    const total = creditsContentHeight(CREDITS);
    const v = createCreditsView(10);
    v.scrollY = total - 1;
    updateCredits(v, 1, CREDITS, { endBehavior: 'return' });
    expect(v.finished).toBe(true);
    expect(v.scrollY).toBe(total);
  });

  it('reduced-motion disables auto-scroll; paging advances instead', () => {
    const v = createCreditsView(10);
    updateCredits(v, 1, CREDITS, { reducedMotion: true });
    expect(v.scrollY).toBe(0);
    pageCredits(v, 1, CREDITS);
    expect(v.scrollY).toBeGreaterThan(0);
  });

  it('does not mutate the roster while updating or flattening', () => {
    const before = JSON.stringify(CREDITS);
    const v = createCreditsView(10);
    updateCredits(v, 0.5, CREDITS);
    creditsLines(CREDITS);
    expect(JSON.stringify(CREDITS)).toBe(before);
  });
});
