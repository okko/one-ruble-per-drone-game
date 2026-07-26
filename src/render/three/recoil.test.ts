import { describe, expect, it } from 'vitest';
import {
  FLASH_LIFE,
  advanceRecoil,
  createRecoil,
  flashRoll,
  flashScale,
  kickRecoil,
  type RecoilState,
} from './recoil';

/** Run `seconds` of recoil in steps of `dt`, returning the peak displacement seen along the way. */
function run(state: RecoilState, seconds: number, dt: number): number {
  let peak = state.offset;
  for (let t = 0; t < seconds; t += dt) {
    advanceRecoil(state, dt);
    peak = Math.max(peak, state.offset);
  }
  return peak;
}

describe('recoil', () => {
  it('starts at rest, with nothing lit', () => {
    const s = createRecoil();
    expect(s.offset).toBe(0);
    expect(s.velocity).toBe(0);
    expect(s.flash).toBe(0);
    expect(s.shots).toBe(0);
  });

  it('a shot drives the barrel back, then brings it home', () => {
    const s = createRecoil();
    kickRecoil(s);
    const peak = run(s, 0.05, 1 / 240);
    expect(peak).toBeGreaterThan(0.05);
    // Quarter of a second is a long time between shots; by then it must be visually at rest.
    run(s, 0.25, 1 / 240);
    expect(Math.abs(s.offset)).toBeLessThan(0.01);
    expect(Math.abs(s.velocity)).toBeLessThan(0.2);
  });

  it('overshoots past rest on the way back, so a burst reads as a machine gun', () => {
    const s = createRecoil();
    kickRecoil(s);
    let lowest = 0;
    for (let t = 0; t < 0.3; t += 1 / 240) {
      advanceRecoil(s, 1 / 240);
      lowest = Math.min(lowest, s.offset);
    }
    expect(lowest).toBeLessThan(-0.005);
  });

  it('never walks out of the receiver, however long the burst', () => {
    const s = createRecoil();
    // Far faster than any fire rate the sim can produce: a shot every render frame for two seconds.
    for (let t = 0; t < 2; t += 1 / 120) {
      kickRecoil(s);
      advanceRecoil(s, 1 / 120);
      expect(s.offset).toBeLessThanOrEqual(1);
      expect(s.offset).toBeGreaterThan(-1);
    }
  });

  it('agrees with itself across frame rates, because it is solved rather than stepped', () => {
    const fast = createRecoil();
    const slow = createRecoil();
    kickRecoil(fast);
    kickRecoil(slow);
    for (let i = 0; i < 12; i += 1) advanceRecoil(fast, 1 / 240);
    advanceRecoil(slow, 12 / 240);
    expect(slow.offset).toBeCloseTo(fast.offset, 9);
    expect(slow.velocity).toBeCloseTo(fast.velocity, 7);
  });

  it('survives the gap after a restored tab without exploding', () => {
    const s = createRecoil();
    kickRecoil(s);
    advanceRecoil(s, 2);
    expect(Number.isFinite(s.offset)).toBe(true);
    expect(Math.abs(s.offset)).toBeLessThan(0.01);
  });

  it('ignores a zero or backwards step', () => {
    const s = createRecoil();
    kickRecoil(s);
    advanceRecoil(s, 0);
    advanceRecoil(s, -1);
    expect(s.offset).toBe(0);
    expect(s.flash).toBe(1);
  });

  it('lights the flash on the shot and fades it out over its life', () => {
    const s = createRecoil();
    kickRecoil(s);
    expect(s.flash).toBe(1);
    advanceRecoil(s, FLASH_LIFE / 2);
    expect(s.flash).toBeCloseTo(0.5, 5);
    advanceRecoil(s, FLASH_LIFE);
    expect(s.flash).toBe(0);
  });

  it('counts shots, so the flash can differ from one to the next', () => {
    const s = createRecoil();
    kickRecoil(s);
    kickRecoil(s);
    expect(s.shots).toBe(2);
  });

  it('is deterministic: the same shots give the same barrel', () => {
    const a = createRecoil();
    const b = createRecoil();
    for (const s of [a, b]) {
      kickRecoil(s);
      advanceRecoil(s, 1 / 60);
      kickRecoil(s);
      advanceRecoil(s, 1 / 60);
    }
    expect(a).toEqual(b);
  });
});

describe('flash variation', () => {
  it('rolls the flash differently from one shot to the next', () => {
    expect(flashRoll(0)).not.toBeCloseTo(flashRoll(1), 3);
    expect(flashRoll(1)).not.toBeCloseTo(flashRoll(2), 3);
  });

  it('never repeats within a short burst', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 12; i += 1) seen.add(Math.round(flashRoll(i) * 1000));
    expect(seen.size).toBeGreaterThan(8);
  });

  it('varies the size around one, without ever inverting or vanishing it', () => {
    for (let i = 0; i < 40; i += 1) {
      expect(flashScale(i)).toBeGreaterThan(0.5);
      expect(flashScale(i)).toBeLessThan(1.4);
    }
    expect(flashScale(0)).not.toBeCloseTo(flashScale(1), 3);
  });
});
