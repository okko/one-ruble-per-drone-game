/**
 * The camera director — the single owner of where the camera is and where it is
 * looking, for every part of the game (docs/areas/11-art-visual-style.md §3.7).
 *
 * Two rules make this module worth its own file:
 *
 * 1. **One state machine.** Menu orbit, opening crane, shooting, interior, and
 *    pause are all *states of one director*. Scattering pose maths across the
 *    scenes is how cameras start cutting instead of moving.
 * 2. **Aiming is decoupled from framing.** `aimPose` is always the shooting
 *    pose, whatever the camera is currently doing. `screenToWorld` raycasts
 *    through a camera built from `aimPose`, so opening a menu, walking inside,
 *    or pausing cannot shift where the player's shots land.
 *
 * It is deliberately free of three.js: poses are plain numbers, so the maths is
 * unit-testable in the default node environment and reachable by mutation
 * testing.
 */
import {
  ACTION_Z,
  floorCentreY,
  GROUND_Y,
  ROOF_Y,
  TOWER_X,
  TOWER_Z,
} from './mapping';

export type CameraState = 'menu' | 'intro' | 'shooting' | 'interior' | 'pause';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CameraPose {
  /** Where the camera is. */
  readonly eye: Vec3;
  /** What it is pointed at. */
  readonly look: Vec3;
  /** Vertical field of view, degrees. Narrowing it is how a shot gets tense. */
  readonly fov: number;
}

/** Everything a pose can depend on. Kept tiny so poses stay pure functions. */
export interface PoseContext {
  /** Which storey the interior camera should be looking at (1-based). */
  readonly floor: number;
  /** Seconds since the view was created; drives the idle menu orbit. */
  readonly time: number;
}

const BASE_FOV = 60;

/** How fast the camera settles into each state, in units of 1/second. */
const BLEND_RATE: Record<CameraState, number> = {
  // Slow and cinematic: the menu is where the player looks around.
  menu: 1.4,
  // The crane is a deliberate, unhurried reveal of the tower.
  intro: 0.9,
  // Snappy enough that coming back from a menu feels responsive.
  shooting: 3.2,
  // Dropping inside should feel like a decision, not a teleport.
  interior: 2.6,
  // Pause pulls back promptly — the player wants the menu, not a flourish.
  pause: 4.5,
};

/** Radius and height of the slow menu orbit around the tower. */
const MENU_ORBIT_RADIUS = 34;
const MENU_ORBIT_PERIOD_S = 48;

/**
 * The resting pose for a state. Pure: same inputs, same pose, no allocation of
 * anything the caller can mutate behind our back.
 */
export function poseFor(state: CameraState, ctx: PoseContext): CameraPose {
  switch (state) {
    case 'menu': {
      // A slow orbit of the tower, high enough to show the skyline behind it.
      // The player sees exactly where they are about to be standing.
      const angle = (ctx.time / MENU_ORBIT_PERIOD_S) * Math.PI * 2;
      return {
        eye: {
          x: TOWER_X + Math.sin(angle) * MENU_ORBIT_RADIUS,
          y: ROOF_Y + 6,
          z: TOWER_Z + Math.cos(angle) * MENU_ORBIT_RADIUS,
        },
        look: { x: TOWER_X, y: ROOF_Y - 6, z: TOWER_Z },
        fov: 55,
      };
    }

    case 'intro':
      // Low at the tower's foot, looking up the cut-away. The director cranes
      // from here to `shooting`, so the run opens on the building the player is
      // about to defend rather than on the gun.
      return {
        eye: { x: TOWER_X, y: GROUND_Y + 3, z: TOWER_Z + 22 },
        look: { x: TOWER_X, y: GROUND_Y + 13, z: TOWER_Z },
        fov: 68,
      };

    case 'shooting':
      // Over the soldier's shoulder: he sits in the near foreground on his roof,
      // the grounded skyline fills the mid-frame, drones dive from the sky.
      return {
        eye: { x: 1.6, y: ROOF_Y + 4.2, z: ACTION_Z + 11 },
        look: { x: 0, y: ROOF_Y + 2.2, z: -14 },
        fov: BASE_FOV,
      };

    case 'interior':
      // Inside, level with the floor being visited.
      return {
        eye: { x: TOWER_X, y: floorCentreY(ctx.floor) + 0.7, z: TOWER_Z + 9 },
        look: { x: TOWER_X, y: floorCentreY(ctx.floor), z: TOWER_Z },
        fov: 52,
      };

    case 'pause':
      // Pull back and up from the post: the action is still visible, but the
      // player is clearly no longer behind the gun.
      return {
        eye: { x: 8, y: ROOF_Y + 9, z: ACTION_Z + 20 },
        look: { x: 0, y: ROOF_Y + 1, z: -10 },
        fov: 50,
      };
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: lerp(a.z, b.z, t),
  };
}

/** Linear blend between two poses. `t = 0` gives `a`, `t = 1` gives `b`. */
export function blendPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  return {
    eye: lerpVec3(a.eye, b.eye, t),
    look: lerpVec3(a.look, b.look, t),
    fov: lerp(a.fov, b.fov, t),
  };
}

/**
 * Frame-rate-independent damping factor.
 *
 * The naive `x += (target - x) * rate * dt` moves further per second at high
 * frame rates than at low ones, which makes the camera feel different on a
 * 120 Hz phone than on a 60 Hz laptop. The exponential form does not
 * (docs/areas/11-art-visual-style.md §3.9).
 */
export function damping(rate: number, dt: number): number {
  if (dt <= 0) return 0;
  return 1 - Math.exp(-rate * dt);
}

export interface CameraDirector {
  /** The state the camera is heading toward. */
  readonly state: CameraState;
  /** The current, blended pose. This is what the render camera follows. */
  readonly pose: CameraPose;
  /**
   * The pose the aim raycast must use — always `shooting`, regardless of what
   * the camera is doing. Menus, interiors, and pause must not move the player's
   * point of aim.
   */
  readonly aimPose: CameraPose;
  /** Head for `state`. Pass `immediate` to cut rather than blend. */
  setState(state: CameraState, opts?: { immediate?: boolean }): void;
  /** Advance the blend by `dt` seconds. */
  update(dt: number, ctx: PoseContext): void;
}

export function createCameraDirector(
  initial: CameraState = 'menu',
  initialCtx: PoseContext = { floor: 1, time: 0 },
): CameraDirector {
  let state: CameraState = initial;
  let pose: CameraPose = poseFor(initial, initialCtx);
  // The shooting pose is fixed, so the aim pose is computed once. Deriving it
  // from the live camera — or recomputing it from a changing context — is
  // exactly the coupling this module exists to prevent.
  const aimPose = poseFor('shooting', initialCtx);

  return {
    get state() {
      return state;
    },
    get pose() {
      return pose;
    },
    get aimPose() {
      return aimPose;
    },
    setState(next, opts) {
      state = next;
      if (opts?.immediate === true) pose = poseFor(next, initialCtx);
    },
    update(dt, ctx) {
      const target = poseFor(state, ctx);
      pose = blendPose(pose, target, damping(BLEND_RATE[state], dt));
    },
  };
}
