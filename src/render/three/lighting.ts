/**
 * The day/night light ramp (docs/areas/11-art-visual-style.md §3.5).
 *
 * One input — `daylight ∈ [0,1]` from `core/difficulty` — drives every light in the world. This
 * module is the whole of that decision, kept free of three.js so the numbers are readable and
 * provable rather than scattered through the render loop as literals.
 *
 * The governing rule is §3.5's "**exposure, not paint**": night is not made by darkening material
 * colours, it is made by turning the lights down and stopping the camera down with them. That is why
 * nothing here returns a colour for anything but the *lights* — concrete is the same concrete at
 * midnight, it is simply less lit.
 */
import type { WorldColorKey } from './theme';

/** A blend between two theme colours; feed straight to `mixInto`. */
export interface ColorRamp {
  from: WorldColorKey;
  to: WorldColorKey;
  /** 0 = `from`, 1 = `to`. */
  t: number;
}

export interface LightRig {
  /** `renderer.toneMappingExposure`. The camera stop. */
  exposure: number;
  /** Fill from sky and bounce off the city below. */
  hemisphere: number;
  /** The key light. */
  key: number;
  /** Colour temperature of the key light: moonlight → low sun → noon. */
  keyColor: ColorRamp;
  /**
   * Emissive multiplier for lit windows. Rises as the light falls — §3.5's "windows carry the
   * night", and the reason the skyline stays legible after dusk without the sky being faked.
   */
  windowGlow: number;
  /** How far the key light has swung round; 0 at midnight, 1 at noon. Drives the shadow direction. */
  sunElevation: number;
  /**
   * How far the sky has turned toward its night stops: 0 at noon, 1 at midnight. The sky dome and
   * the star field both read this, so the horizon and the stars can never disagree about the hour.
   */
  night: number;
  /** Haze at the horizon — the colour distance fades everything toward. */
  fogColor: ColorRamp;
}

/** Clamp into [0,1]; `daylight` is documented as normalised but this module is the last line. */
function unit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * The complete lighting state for a moment of the day.
 *
 * The key-light colour is a two-segment ramp rather than a single lerp, because a day is not
 * symmetric about "bright": the interesting colour is at the *ends* of daylight, not at the bottom.
 * Below the halfway point the key is the moon (cold, faint); above it, the sun warms from low-angle
 * orange to a near-neutral noon. A single moonlight→noon lerp would skip golden hour entirely, which
 * is the one hour of the day this game most wants to look like.
 */
export function rigFor(daylight: number): LightRig {
  const d = unit(daylight);

  const keyColor: ColorRamp =
    d >= 0.5
      ? { from: 'sunLow', to: 'sunNoon', t: (d - 0.5) * 2 }
      : { from: 'moonlight', to: 'sunLow', t: d * 2 };

  return {
    // Stopped down at night, open at noon — a narrow range on purpose. ACES already does the heavy
    // lifting; a wide exposure swing here would crush the night to unplayable black.
    exposure: 0.9 + d * 0.35,
    hemisphere: 0.35 + d * 0.75,
    key: 0.3 + d * 0.9,
    keyColor,
    // Daylight leaves only a trace: a lit office at noon is invisible from across a city, and the
    // facades now carry a real window mask, so anything more turned every tower into a gold brick.
    windowGlow: 0.08 + (1 - d) * 1.27,
    sunElevation: d,
    night: 1 - d,
    // The haze is the horizon's own colour, so distance dissolves into the sky rather than into a
    // grey wall. Pale gold by day, the sky's own violet by night.
    fogColor: { from: 'skyNightMid', to: 'skyDayLow', t: d },
  };
}

// ---- Sun travel -------------------------------------------------------------------------------

/** A unit vector pointing from the scene toward the key light. */
export interface SunDirection {
  x: number;
  y: number;
  z: number;
}

const TAU = Math.PI * 2;
/**
 * The key light never drops below this, ~10°, even at midnight — because at midnight it *is* the
 * moon, and a key light on the horizon rakes the rooftop into unreadable stripes. §3.1: readability
 * beats fidelity.
 */
const MIN_ELEVATION = 0.18;
/** ~66°. Deliberately short of overhead: a vertical sun flattens everything and casts no shadow. */
const MAX_ELEVATION = 1.15;

/** Wrap into [0,1); the cycle is periodic, so out-of-range input is meaningful rather than an error. */
function wrap(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const m = v % 1;
  return m < 0 ? m + 1 : m;
}

/**
 * Where the key light stands at a moment of the day+night cycle (`core/difficulty.dayCycleAt`:
 * 0 is midnight, 0.5 is midday).
 *
 * Bearing turns through a full circle once per cycle, so shadows sweep across the roof over a shift
 * instead of being painted on — §3.5's whole point, and the cheapest cue that time is passing.
 * Elevation rides the same cosine as `daylight`, which keeps the light high at noon and low at
 * midnight without ever letting it set: this scene has one key light playing both sun and moon, and
 * a key below the horizon would simply switch the world off.
 */
export function sunDirectionFor(cycle: number): SunDirection {
  const c = wrap(cycle);
  const height = (1 - Math.cos(c * TAU)) / 2; // 0 at midnight, 1 at noon — same curve as `daylight`
  const elevation = MIN_ELEVATION + (MAX_ELEVATION - MIN_ELEVATION) * height;
  const bearing = c * TAU;
  const horizontal = Math.cos(elevation);
  return {
    x: horizontal * Math.sin(bearing),
    y: Math.sin(elevation),
    z: horizontal * Math.cos(bearing),
  };
}

// ---- Environment lighting ---------------------------------------------------------------------

/**
 * How many distinct skies an environment map is baked for across one cycle.
 *
 * Image-based lighting has to be *generated*, which is far too expensive to do per frame and utterly
 * pointless to: between one frame and the next the sky moves by nothing a player could see. Sixteen
 * steps is roughly one bake every 45 seconds of a ten-minute cycle, and the seams do not read
 * because the direct lights ramp continuously through them.
 */
export const ENV_STEPS = 16;

/** The environment-map bucket for a daylight value. Regenerate only when this changes. */
export function envStepFor(daylight: number): number {
  const d = unit(daylight);
  // `min` guards the top edge: d = 1 would otherwise land in a seventeenth bucket of its own.
  return Math.min(ENV_STEPS - 1, Math.floor(d * ENV_STEPS));
}

// ---- Aerial perspective -----------------------------------------------------------------------

/**
 * Where the haze starts, in world units from the camera.
 *
 * Bounded deliberately: the shooting camera sits at `TOWER_Z + 3`, so the action plane the drones and
 * tracers fly on is 16 units away and stays *completely* clear of fog. §3.1 requires drone-vs-sky
 * contrast to survive, and a target dissolving into haze is the one thing this effect must never do.
 * The far skyline at ~32 units gets a fifth of the way to the horizon colour, which is the whole
 * intent: depth behind the fight, nothing in it.
 */
export const FOG_NEAR = 20;
/** Full haze. The ground plane runs to the horizon and melts into the sky, as it should. */
export const FOG_FAR = 75;
