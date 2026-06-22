import { describe, it, expect } from 'vitest';
import { createRng } from '../../core/rng';
import { combatBalance } from '../../content/balance';
import { DRONES } from '../../content/drones';
import type { DroneDef } from '../../content/drones';
import { hpScale, speedScale, materialize, advanceDrone, reachedTarget, offArena } from './drone';

function def(kind: string): DroneDef {
  const d = DRONES.find((x) => x.kind === kind);
  if (!d) throw new Error(`no drone ${kind}`);
  return d;
}

describe('drone: difficulty scaling (§8.8)', () => {
  it('hpScale rises with D and stays an integer hit-count', () => {
    expect(hpScale(5, 0, combatBalance)).toBe(5);
    expect(hpScale(5, 10, combatBalance)).toBeGreaterThan(5);
    expect(Number.isInteger(hpScale(5, 3, combatBalance))).toBe(true);
  });

  it('speedScale rises with D', () => {
    expect(speedScale(40, 0, combatBalance)).toBe(40);
    expect(speedScale(40, 10, combatBalance)).toBeGreaterThan(40);
  });

  it('materialize sets hp from hpScale and starts at the origin', () => {
    const rng = createRng(1);
    const d = materialize(7, def('heavy'), { x: 10, y: -8 }, 5, rng, combatBalance);
    expect(d.id).toBe(7);
    expect(d.hp).toBe(hpScale(def('heavy').baseHp, 5, combatBalance));
    expect(d.maxHp).toBe(d.hp);
    expect(d.pos).toEqual({ x: 10, y: -8 });
  });
});

describe('drone: movement & resolution', () => {
  it('a straight drone advances toward the post and eventually reaches it (escape)', () => {
    const rng = createRng(2);
    const origin = { x: combatBalance.postTarget.x, y: 20 };
    const d = materialize(1, def('scout'), origin, 0, rng, combatBalance);
    expect(reachedTarget(d, combatBalance)).toBe(false);
    for (let i = 0; i < 600 && !reachedTarget(d, combatBalance); i++) advanceDrone(d, 1 / 60, combatBalance);
    expect(reachedTarget(d, combatBalance)).toBe(true);
  });

  it('a wandering decoy never reaches the post and drifts off-arena', () => {
    const rng = createRng(3);
    const d = materialize(1, def('decoy_bird'), { x: 4, y: 40 }, 0, rng, combatBalance);
    let off = false;
    for (let i = 0; i < 2000 && !off; i++) {
      advanceDrone(d, 1 / 60, combatBalance);
      expect(reachedTarget(d, combatBalance)).toBe(false); // decoys never escape
      off = offArena(d.pos, combatBalance);
    }
    expect(off).toBe(true);
  });

  it('a kamikaze accelerates: it covers more ground in the second second than the first', () => {
    const rng = createRng(4);
    const d = materialize(1, def('kamikaze'), { x: combatBalance.postTarget.x, y: 0 }, 3, rng, combatBalance);
    let dist = 0;
    const step = (n: number): number => {
      let acc = 0;
      for (let i = 0; i < n; i++) {
        const before = { ...d.pos };
        advanceDrone(d, 1 / 60, combatBalance);
        acc += Math.hypot(d.pos.x - before.x, d.pos.y - before.y);
      }
      return acc;
    };
    const first = step(60);
    const second = step(60);
    dist = first + second;
    expect(second).toBeGreaterThan(first);
    expect(dist).toBeGreaterThan(0);
  });
});
