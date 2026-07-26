/**
 * Arena ↔ world mapping for the 3D presentation layer.
 *
 * The simulation runs in a fixed 384×216 "arena" coordinate space (arena y points
 * DOWN, screen-style). The 3D world is metres with y pointing UP. This module is
 * the single, pure translation between them — no three.js, no DOM, no state — so
 * the coordinate maths can be proven by unit test rather than by squinting at a
 * running game (docs/areas/11-art-visual-style.md §4).
 *
 * Every dimension the world is built from is derived here. Nothing downstream may
 * re-derive a position from a literal: if the tower gets taller, the roof deck,
 * the gun, and the soldier's feet must all move together.
 */
import type { Vec2 } from '../../core/math';

// ---- Arena space ----------------------------------------------------------
/** Simulation arena width. NOT a resolution — see docs/architecture.md §1. */
export const ARENA_W = 384;
/** Simulation arena height. */
export const ARENA_H = 216;
/** Arena x of the tower's centre line, and of the firing column. */
export const ARENA_CX = ARENA_W / 2;
/** Arena y of the firing post. Maps to the tower roof in world space. */
export const POST_Y = 196;

// ---- World space ----------------------------------------------------------
/** Arena pixels → world units. */
export const AS = 0.09;
/** World height of one storey of the soldier's tower. */
export const STORY_H = 0.95;
/** Storeys in the soldier's tower. */
export const STOREYS = 32;
/** Every tower stands on this world y. */
export const GROUND_Y = 0;
/** Top of the soldier's tower's structure — where the roof deck sits. */
export const ROOF_Y = GROUND_Y + STOREYS * STORY_H;

/** Thickness of the roof-deck slab that caps the top floor. */
export const ROOF_DECK_THICKNESS = 0.4;
/** Centre y of the roof-deck slab. */
export const ROOF_DECK_Y = ROOF_Y + ROOF_DECK_THICKNESS / 2;
/**
 * The world y of the roof deck's TOP FACE — the surface the soldier's boots rest
 * on. Derived from the deck's own geometry so it can never drift out of step
 * with it (docs/areas/11-art-visual-style.md §3.4 requirement 1).
 */
export const ROOF_DECK_TOP_Y = ROOF_Y + ROOF_DECK_THICKNESS;

/** Depth of the plane the drones, projectiles, and aim raycast live on. */
export const ACTION_Z = 0;
/** Depth of the far Moscow skyline. */
export const SKYLINE_Z = -16;
/**
 * Depth of the soldier's tower. Behind the action plane, so the soldier stands
 * in front of it on the roof and the cut-away face still opens to the camera.
 */
export const TOWER_Z = -3.5;

/** Footprint of the soldier's tower. */
export const TOWER_W = 60 * AS;
export const TOWER_D = 26 * AS;

/** World x of the tower's centre line. */
export const TOWER_X = 0;

// ---- Conversions ----------------------------------------------------------

/** Arena x → world x. */
export function ax(x: number): number {
  return (x - ARENA_CX) * AS;
}

/** Arena y (down-positive) → world y (up-positive). */
export function ay(y: number): number {
  return ROOF_Y + (POST_Y - y) * AS;
}

/**
 * World (x, y) → arena coordinates. The exact inverse of `ax`/`ay`; used to turn
 * an aim raycast hit back into the arena point the simulation understands.
 */
export function toArena(worldX: number, worldY: number): Vec2 {
  return {
    x: worldX / AS + ARENA_CX,
    y: POST_Y - (worldY - ROOF_Y) / AS,
  };
}

/** World y of the floor slab of storey `floor` (1-based). */
export function floorSlabY(floor: number): number {
  return GROUND_Y + (floor - 1) * STORY_H;
}

/** World y of the middle of storey `floor` (1-based) — eye height for interiors. */
export function floorCentreY(floor: number): number {
  return floorSlabY(floor) + STORY_H / 2;
}
