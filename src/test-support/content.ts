/**
 * Test-only content factory. Returns a fully-validated `Content` built from the real balance tables
 * (via the real `loadContent`) so system tests run against the shipped numbers, with an optional
 * per-slice override for tests that need tuned values. Lives outside `src/content` so it is excluded
 * from coverage/mutation and never scanned by the content-lint.
 */
import { loadContent } from '../content/loader';
import type { Content } from '../content/loader';

export function createTestContent(overrides: Partial<Content> = {}): Content {
  return { ...loadContent(), ...overrides };
}
