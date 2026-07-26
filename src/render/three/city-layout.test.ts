import { describe, expect, it } from 'vitest';

import { boxesAlive, cityLayoutFor, clutterOffset, type CityBox, type CrownKind } from './city-layout';

/** The real table's shape: eight towers of 16–25 storeys. Ids are what drive the variety. */
const IDS = [1, 2, 3, 4, 5, 6, 7, 8];

function layout(id: number, storeys = 20) {
  return cityLayoutFor(id, 3.2, 10, storeys);
}

describe('cityLayoutFor', () => {
  it('gives every storey exactly one band, bottom to top', () => {
    for (const id of IDS) {
      const l = layout(id);
      expect(l.bands).toHaveLength(l.storeys);
      l.bands.forEach((band, i) => expect(band.storey).toBe(i));
    }
  });

  it('stacks the bands without gaps or overlaps beyond the storey joint', () => {
    const l = layout(4);
    l.bands.forEach((band, i) => {
      expect(band.y).toBeCloseTo((i + 0.5) * l.storeyHeight);
      expect(band.height).toBeLessThan(l.storeyHeight);
    });
    const top = l.bands[l.bands.length - 1] as CityBox;
    expect(top.y + top.height / 2).toBeLessThanOrEqual(l.height);
  });

  it('steps in as it rises and never widens again', () => {
    for (const id of IDS) {
      const widths = layout(id).bands.map((b) => b.width);
      for (let i = 1; i < widths.length; i += 1) {
        expect(widths[i]).toBeLessThanOrEqual(widths[i - 1] as number);
      }
    }
  });

  it('keeps the base tier at the width the balance table asked for', () => {
    const l = cityLayoutFor(3, 4, 12, 18);
    expect(l.width).toBe(4);
    expect((l.bands[0] as CityBox).width).toBe(4);
    expect(l.depth).toBeLessThan(l.width); // a skyline tower is a slab, not a cube
  });

  it('never lets a setback whittle the top tier down to a pole', () => {
    for (const id of IDS) {
      const l = layout(id, 25);
      const top = l.bands[l.bands.length - 1] as CityBox;
      expect(top.width).toBeGreaterThanOrEqual(l.width * 0.34);
    }
  });

  it('caps every tier with an oversailing cornice', () => {
    for (const id of IDS) {
      const l = layout(id);
      expect(l.cornices.length).toBeGreaterThanOrEqual(2);
      expect(l.cornices.length).toBeLessThanOrEqual(4);
      for (const cornice of l.cornices) {
        const band = l.bands[cornice.storey] as CityBox;
        expect(cornice.width).toBeGreaterThan(band.width);
        expect(cornice.height).toBeLessThan(l.storeyHeight);
        // It sits on top of the storey it caps, which is what makes it fall with it.
        expect(cornice.y).toBeGreaterThan(band.y);
      }
    }
  });

  it('orders both lists by the storey each box dies with, which is what damage relies on', () => {
    for (const id of IDS) {
      const l = layout(id);
      for (const list of [l.bands, l.cornices, l.crown.clutter]) {
        for (let i = 1; i < list.length; i += 1) {
          expect((list[i] as CityBox).storey).toBeGreaterThanOrEqual((list[i - 1] as CityBox).storey);
        }
      }
    }
  });

  it('crowns the top storey, so any damage at all takes the crown off', () => {
    for (const id of IDS) {
      const l = layout(id);
      expect(l.crown.base).toBe(l.height);
      expect(l.crown.height).toBeGreaterThan(0);
      for (const piece of l.crown.clutter) expect(piece.storey).toBe(l.storeys - 1);
    }
  });

  it('varies the crown across the skyline rather than repeating one silhouette', () => {
    const kinds = new Set<CrownKind>(IDS.map((id) => layout(id).crown.kind));
    expect(kinds.size).toBeGreaterThan(1);
    // All three must be reachable, or two of the three branches are dead scenery.
    const wide = new Set<CrownKind>();
    for (let id = 0; id < 60; id += 1) wide.add(layout(id).crown.kind);
    expect(wide).toEqual(new Set<CrownKind>(['spire', 'dome', 'block']));
  });

  it('picks a dome colour in range', () => {
    const hues = new Set<number>();
    for (let id = 0; id < 60; id += 1) hues.add(layout(id).crown.hue);
    expect(hues).toEqual(new Set([0, 1, 2]));
  });

  it('dresses the roof with two to four pieces of furniture', () => {
    for (const id of IDS) {
      const pieces = layout(id).crown.clutter;
      expect(pieces.length).toBeGreaterThanOrEqual(2);
      expect(pieces.length).toBeLessThanOrEqual(4);
      for (const piece of pieces) {
        expect(piece.width).toBeGreaterThan(0);
        expect(piece.depth).toBeGreaterThan(0);
        expect(piece.y - piece.height / 2).toBeCloseTo(layout(id).height);
      }
    }
  });

  it('is deterministic: the same id always describes the same building', () => {
    expect(layout(5)).toEqual(layout(5));
  });

  it('gives neighbouring towers different silhouettes', () => {
    expect(new Set(IDS.map((id) => JSON.stringify(layout(id)))).size).toBeGreaterThan(1);
  });

  it('survives degenerate towers rather than producing a building with no floors', () => {
    const one = cityLayoutFor(2, 1, 1, 1);
    expect(one.bands).toHaveLength(1);
    expect(one.cornices).toHaveLength(1);
    expect(cityLayoutFor(2, 1, 1, 0).bands).toHaveLength(1); // a zero-storey tower is still a tower
    for (const storeys of [2, 3, 4, 5, 6]) {
      const l = cityLayoutFor(4, 2, 4, storeys);
      expect(l.bands).toHaveLength(storeys);
      expect(new Set(l.bands.map((b) => b.storey)).size).toBe(storeys);
    }
  });
});

describe('boxesAlive', () => {
  it('counts the prefix still standing, so damage is a count and not a search', () => {
    const l = layout(4, 20);
    expect(boxesAlive(l.bands, 20)).toBe(20);
    expect(boxesAlive(l.bands, 13)).toBe(13);
    expect(boxesAlive(l.bands, 0)).toBe(0);
  });

  it('drops a cornice exactly when the storey it caps goes', () => {
    const l = layout(4, 20);
    for (const cornice of l.cornices) {
      const s = cornice.storey;
      const kept = l.cornices.filter((c) => c.storey < s + 1).length;
      expect(boxesAlive(l.cornices, s + 1)).toBe(kept);
      expect(boxesAlive(l.cornices, s)).toBeLessThan(kept);
    }
  });

  it('never returns more than the list holds', () => {
    const l = layout(1);
    expect(boxesAlive(l.cornices, 999)).toBe(l.cornices.length);
    expect(boxesAlive([], 4)).toBe(0);
  });
});

describe('clutterOffset', () => {
  it('spreads pieces across the roof without hanging them off the edge', () => {
    for (let i = 0; i < 4; i += 1) {
      expect(Math.abs(clutterOffset(3, i, 4))).toBeLessThan(0.4);
    }
  });

  it('centres a lone piece rather than pushing it to one side', () => {
    expect(Math.abs(clutterOffset(3, 0, 1))).toBeLessThan(0.06);
  });

  it('separates neighbours, so the pieces do not stack into one lump', () => {
    const a = clutterOffset(3, 0, 3);
    const b = clutterOffset(3, 1, 3);
    expect(Math.abs(a - b)).toBeGreaterThan(0.15);
  });
});
