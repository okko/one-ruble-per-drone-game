import { describe, it, expect } from 'vitest';
import { sweptHit, segmentPointDistanceSq } from './collision';

describe('collision: swept segment vs circle (§8.3)', () => {
  it('registers a hit when the swept segment crosses the drone circle', () => {
    expect(sweptHit({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 1 }, 2, 1)).toBe(true);
  });

  it('misses when the segment stays outside the combined radius', () => {
    expect(sweptHit({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 20 }, 2, 1)).toBe(false);
  });

  it('does not tunnel: a fast bullet whose endpoints straddle a thin drone still hits', () => {
    // Neither endpoint is within the radius, but the segment passes through the circle.
    expect(sweptHit({ x: -100, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0.5 }, 1, 0.5)).toBe(true);
  });

  it('a long segment that passes far from the circle misses', () => {
    expect(sweptHit({ x: -100, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 50 }, 1, 0.5)).toBe(false);
  });

  it('degenerate (zero-length) segment falls back to point distance', () => {
    expect(segmentPointDistanceSq({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 8, y: 9 })).toBeCloseTo(25, 5);
  });
});
