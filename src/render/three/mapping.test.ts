import { describe, expect, it } from 'vitest';

import {
  ACTION_Z,
  ARENA_CX,
  ARENA_H,
  ARENA_W,
  AS,
  ax,
  ay,
  floorCentreY,
  floorSlabY,
  GROUND_Y,
  POST_Y,
  ROOF_DECK_THICKNESS,
  ROOF_DECK_TOP_Y,
  ROOF_DECK_Y,
  ROOF_Y,
  SKYLINE_Z,
  STOREYS,
  STORY_H,
  TOWER_Z,
  toArena,
} from './mapping';

describe('arena ↔ world round-trip', () => {
  it('is the exact inverse across the arena', () => {
    const points = [
      { x: 0, y: 0 },
      { x: ARENA_CX, y: POST_Y },
      { x: ARENA_W, y: ARENA_H },
      { x: 17, y: 203 },
      { x: 383.5, y: 0.25 },
      // Outside the arena: drones spawn off-screen, so the mapping must not
      // clamp or wrap.
      { x: -40, y: -12 },
      { x: 500, y: 400 },
    ];

    for (const p of points) {
      const back = toArena(ax(p.x), ay(p.y));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });
});

describe('anchors', () => {
  it('puts the firing post at the tower roof, on the centre line', () => {
    expect(ax(ARENA_CX)).toBeCloseTo(0, 12);
    expect(ay(POST_Y)).toBeCloseTo(ROOF_Y, 12);
  });

  it('maps decreasing arena y to increasing world height', () => {
    // Arena y points down; world y points up. Getting this backwards would put
    // the drones underground.
    expect(ay(POST_Y - 100)).toBeGreaterThan(ay(POST_Y));
    expect(ay(0)).toBeGreaterThan(ay(ARENA_H));
  });

  it('maps increasing arena x to increasing world x', () => {
    expect(ax(ARENA_CX + 10)).toBeGreaterThan(ax(ARENA_CX));
    expect(ax(ARENA_CX - 10)).toBeLessThan(ax(ARENA_CX));
  });

  it('scales by exactly one arena unit per AS world units', () => {
    expect(ax(ARENA_CX + 1) - ax(ARENA_CX)).toBeCloseTo(AS, 12);
    expect(ay(POST_Y - 1) - ay(POST_Y)).toBeCloseTo(AS, 12);
  });
});

describe('tower geometry', () => {
  it('stands the tower on the ground and reaches the roof in whole storeys', () => {
    expect(ROOF_Y).toBeCloseTo(GROUND_Y + STOREYS * STORY_H, 12);
    expect(floorSlabY(1)).toBe(GROUND_Y);
    expect(floorSlabY(STOREYS)).toBeCloseTo(ROOF_Y - STORY_H, 12);
  });

  it('derives the roof deck top face from the deck slab, not a literal', () => {
    // The soldier's boots rest on this. If the deck's thickness or the tower's
    // height changes, this must move with it — that is the whole point of
    // deriving it (docs/areas/11-art-visual-style.md §3.4).
    expect(ROOF_DECK_TOP_Y).toBeCloseTo(ROOF_Y + ROOF_DECK_THICKNESS, 12);
    expect(ROOF_DECK_Y).toBeCloseTo(ROOF_DECK_TOP_Y - ROOF_DECK_THICKNESS / 2, 12);
    expect(ROOF_DECK_TOP_Y).toBeGreaterThan(ROOF_Y);
  });

  it('centres each storey between its slab and the one above', () => {
    expect(floorCentreY(1)).toBeCloseTo(GROUND_Y + STORY_H / 2, 12);
    expect(floorCentreY(5) - floorCentreY(4)).toBeCloseTo(STORY_H, 12);
  });

  it('keeps the tower behind the action plane and in front of the skyline', () => {
    // The soldier stands in front of his tower, and the skyline is further out
    // still. Collapsing this ordering flattens the whole shot.
    expect(TOWER_Z).toBeLessThan(ACTION_Z);
    expect(SKYLINE_Z).toBeLessThan(TOWER_Z);
  });
});
