/**
 * Recoil and muzzle-flash timing for the rooftop gun.
 *
 * docs/areas/11-art-visual-style.md §3.9 asks for "a kick that decays out" — the single cue that
 * separates a weapon from a rotating stick. It did not exist: the barrel was rigid and the flash was
 * a sphere toggled on for fifty milliseconds. This module is the whole of that behaviour, and it is
 * pure so it can be proven rather than eyeballed.
 *
 * The kick is a damped spring, deliberately UNDER-damped: the barrel snaps back a little past rest
 * before settling, which is what makes a burst feel like a machine gun rather than a pump. That
 * overshoot is the interesting part and it is what the tests pin.
 *
 * It is integrated ANALYTICALLY rather than stepped. A spring this stiff goes unstable under forward
 * Euler once `stiffness * dt²` nears 4, and the first version answered that with substepping — which
 * only traded instability for a kick whose size depended on the frame rate, because the substep
 * error does. The equation is linear and its closed form is six lines, so there is no reason to
 * approximate it: a 30 Hz frame, a 144 Hz frame and the several-hundred-millisecond gap after a
 * restored tab all give exactly the same barrel.
 */

/** Spring constant. Sets how fast the barrel returns — the pitch of the kick, not its size. */
const STIFFNESS = 900;

/**
 * Damping. Critical damping here would be `2 * sqrt(STIFFNESS)` = 60; sitting under it leaves one
 * visible bounce, which is the whole point.
 */
const DAMPING = 38;

/** Decay rate and ringing frequency of the closed form below. Underdamped ⇒ `OMEGA` is real. */
const ALPHA = DAMPING / 2;
const OMEGA = Math.sqrt(STIFFNESS - ALPHA * ALPHA);

/** Impulse a single shot adds to the barrel's velocity. */
const KICK_IMPULSE = 9;

/**
 * Ceiling on displacement, in the same units the caller scales by.
 *
 * Sustained fire adds an impulse per shot, and shots arrive faster than the spring returns; without
 * a ceiling a long burst walks the barrel backwards out of the receiver. Real guns have a buffer at
 * the back of their travel, and so does this one.
 */
const MAX_OFFSET = 1;

/** Seconds a muzzle flash stays visible. Short enough to strobe under fire, long enough to see. */
export const FLASH_LIFE = 0.055;

export interface RecoilState {
  /** Displacement back along the barrel, 0 at rest, in caller-chosen units. Can go slightly negative. */
  offset: number;
  /** Rate of change of `offset`. Exposed only so the whole state is one plain, copyable object. */
  velocity: number;
  /** Muzzle flash brightness, 1 at the shot and falling to 0 over `FLASH_LIFE`. */
  flash: number;
  /** Increments once per shot. Drives the flash's roll and scale so no two look identical. */
  shots: number;
}

export function createRecoil(): RecoilState {
  return { offset: 0, velocity: 0, flash: 0, shots: 0 };
}

/** Register a shot: kick the spring and light the flash. */
export function kickRecoil(state: RecoilState): void {
  state.velocity += KICK_IMPULSE;
  state.flash = 1;
  state.shots += 1;
}

/** Advance the spring and fade the flash by `dt` seconds. */
export function advanceRecoil(state: RecoilState, dt: number): void {
  if (!(dt > 0)) return;
  const decay = Math.exp(-ALPHA * dt);
  const c = Math.cos(OMEGA * dt);
  const s = Math.sin(OMEGA * dt);
  const x = state.offset;
  const v = state.velocity;
  state.offset = decay * (x * c + ((v + ALPHA * x) / OMEGA) * s);
  state.velocity = decay * (v * c - ((STIFFNESS * x + ALPHA * v) / OMEGA) * s);
  if (state.offset > MAX_OFFSET) {
    // Hit the buffer: stop dead rather than bouncing, which is what a stop does.
    state.offset = MAX_OFFSET;
    if (state.velocity > 0) state.velocity = 0;
  }
  state.flash = Math.max(0, state.flash - dt / FLASH_LIFE);
}

/**
 * A shot's flash roll, in radians.
 *
 * A muzzle flash is a burning gas cloud, not a shape; drawing the same cross-billboard at the same
 * angle every shot turns a burst into a flickering logo. Derived from the shot count rather than a
 * random number so the frame stays reproducible — the golden tests can still be trusted.
 */
export function flashRoll(shots: number): number {
  return (shots % 8) * (Math.PI / 8) + (shots % 3) * 0.21;
}

/** A shot's flash scale multiplier — the same argument as `flashRoll`, applied to size. */
export function flashScale(shots: number): number {
  return 0.82 + (shots % 5) * 0.09;
}
