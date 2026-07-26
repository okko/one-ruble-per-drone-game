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
    windowGlow: 0.25 + (1 - d) * 1.1,
    sunElevation: d,
  };
}
