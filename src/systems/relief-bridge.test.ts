import { describe, it, expect } from 'vitest';
import { createReliefSink } from './relief-bridge';
import { createMetersState } from './meters';
import { createTestContext } from '../test-support/context';

describe('relief-bridge', () => {
  it('applies the primary relief scaled by quality', () => {
    const ctx = createTestContext();
    const m = createMetersState();
    m.values.thirst = 80;
    const sink = createReliefSink(m, ctx);
    sink({ meter: 'thirst', amount: 40 }, 0.5); // 40 * 0.5 = 20
    expect(m.values.thirst).toBeCloseTo(60, 5);
  });

  it('applies a secondary as a signed delta (negative relieves, positive worsens), unscaled by quality', () => {
    const ctx = createTestContext();
    const m = createMetersState();
    m.values.sleep = 50;
    m.values.poo = 10;
    const sink = createReliefSink(m, ctx);
    // tea-like: relieve thirst, also soothe sleep (negative secondary).
    sink({ meter: 'thirst', amount: 20, secondary: { meter: 'sleep', amount: -10 } }, 1);
    expect(m.values.sleep).toBeCloseTo(40, 5);
    // degraded-food-like: positive secondary worsens poo, regardless of quality.
    sink({ meter: 'hunger', amount: 27, secondary: { meter: 'poo', amount: 12 } }, 0.5);
    expect(m.values.poo).toBeCloseTo(22, 5);
  });

  it("routes effect:'drunk' to the drunk timer and effect:'coffee' to the coffee timer", () => {
    const ctx = createTestContext();
    const m = createMetersState();
    const sink = createReliefSink(m, ctx);
    sink({ meter: 'vice', amount: 70, effect: 'drunk' }, 1);
    expect(m.drunkTimer).toBeGreaterThan(0);
    sink({ meter: 'sleep', amount: 30, effect: 'coffee' }, 1);
    expect(m.coffeeTimer).toBeGreaterThan(0);
  });
});
