// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { CREDITS } from './credits';

describe('credits roster', () => {
  it('has at least one section, each with a heading and ≥1 entry', () => {
    expect(CREDITS.length).toBeGreaterThan(0);
    for (const section of CREDITS) {
      expect(section.heading.trim().length).toBeGreaterThan(0);
      expect(section.entries.length).toBeGreaterThan(0);
    }
  });

  it('every entry has a non-empty title and ≥1 non-empty name', () => {
    for (const section of CREDITS) {
      for (const e of section.entries) {
        expect(e.title.trim().length).toBeGreaterThan(0);
        expect(e.names.length).toBeGreaterThan(0);
        for (const name of e.names) expect(name.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
