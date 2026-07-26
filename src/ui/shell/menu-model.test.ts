import { describe, expect, it } from 'vitest';

import { clampSelection, moveSelection, type MenuModel } from './menu-model';

/** Builds a model whose enabled/disabled pattern is given as a boolean list. */
function model(enabled: boolean[], index: number): MenuModel {
  return {
    count: enabled.length,
    index,
    isEnabled: (i) => enabled[i] === true,
  };
}

const allOf = (n: number): boolean[] => new Array<boolean>(n).fill(true);

describe('moveSelection', () => {
  it('advances and retreats by one regardless of delta magnitude', () => {
    const m = model(allOf(5), 2);
    expect(moveSelection(m, 1)).toBe(3);
    expect(moveSelection(m, -1)).toBe(1);
    // Larger deltas are still a single step: the model is a list, not a scrollbar.
    expect(moveSelection(m, 7)).toBe(3);
    expect(moveSelection(m, -7)).toBe(1);
  });

  it('wraps around both ends', () => {
    expect(moveSelection(model(allOf(4), 3), 1)).toBe(0);
    expect(moveSelection(model(allOf(4), 0), -1)).toBe(3);
  });

  it('skips disabled entries in both directions', () => {
    // index:        0      1      2      3      4
    const enabled = [true, false, false, true, false];
    expect(moveSelection(model(enabled, 0), 1)).toBe(3);
    expect(moveSelection(model(enabled, 3), 1)).toBe(0);
    expect(moveSelection(model(enabled, 3), -1)).toBe(0);
    expect(moveSelection(model(enabled, 0), -1)).toBe(3);
  });

  it('stays put when every entry is disabled', () => {
    const m = model([false, false, false], 1);
    expect(moveSelection(m, 1)).toBe(1);
    expect(moveSelection(m, -1)).toBe(1);
  });

  it('lands back on the only enabled entry rather than looping forever', () => {
    const m = model([false, true, false, false], 1);
    expect(moveSelection(m, 1)).toBe(1);
    expect(moveSelection(m, -1)).toBe(1);
  });

  it('returns the current index for an empty list', () => {
    expect(moveSelection(model([], 0), 1)).toBe(0);
  });

  it('clamps rather than moving when delta is zero', () => {
    expect(moveSelection(model(allOf(3), 1), 0)).toBe(1);
    expect(moveSelection(model([true, false, true], 1), 0)).toBe(2);
  });

  it('normalises an out-of-range starting index before stepping', () => {
    expect(moveSelection(model(allOf(3), 7), 1)).toBe(2);
    expect(moveSelection(model(allOf(3), -1), 1)).toBe(0);
  });
});

describe('clampSelection', () => {
  it('leaves a valid enabled selection alone', () => {
    expect(clampSelection(model(allOf(4), 2))).toBe(2);
  });

  it('wraps an out-of-range index into the list', () => {
    expect(clampSelection(model(allOf(4), 9))).toBe(1);
    expect(clampSelection(model(allOf(4), -1))).toBe(3);
  });

  it('drifts forward off a newly disabled entry', () => {
    // An option that became unaffordable while the panel was open: the
    // selection should move down the list, not jump backwards.
    expect(clampSelection(model([true, false, true], 1))).toBe(2);
  });

  it('wraps forward past the end when searching for an enabled entry', () => {
    expect(clampSelection(model([true, false, false], 2))).toBe(0);
  });

  it('returns the starting index when nothing is enabled', () => {
    expect(clampSelection(model([false, false], 1))).toBe(1);
  });

  it('returns 0 for an empty list', () => {
    expect(clampSelection(model([], 3))).toBe(0);
  });
});
