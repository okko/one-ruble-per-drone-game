/**
 * Swept projectile-vs-drone collision (docs/areas/01-gameplay-engine.md §4 "Projectiles vs hitscan").
 * Pure geometry, no state: tests the segment a projectile travelled this tick (previous→current)
 * against a drone's circle, so a fast bullet can never tunnel through a thin drone between frames.
 */
import type { Vec2 } from '../../core/math';

/** Squared distance from point `c` to the segment `a`→`b`. */
export function segmentPointDistanceSq(a: Vec2, b: Vec2, c: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  // Degenerate segment (a == b): fall back to point distance.
  let t = lenSq === 0 ? 0 : ((c.x - a.x) * abx + (c.y - a.y) * aby) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = a.x + t * abx;
  const py = a.y + t * aby;
  const dx = c.x - px;
  const dy = c.y - py;
  return dx * dx + dy * dy;
}

/**
 * True if a projectile of radius `projRadius` sweeping from `prev` to `pos` touches a drone circle
 * of radius `droneRadius` centered at `center`. Uses the Minkowski-sum radius so both radii count.
 */
export function sweptHit(
  prev: Vec2,
  pos: Vec2,
  center: Vec2,
  droneRadius: number,
  projRadius: number,
): boolean {
  const r = droneRadius + projRadius;
  return segmentPointDistanceSq(prev, pos, center) <= r * r;
}
