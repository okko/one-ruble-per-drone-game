/**
 * The three.js world's colour theme (docs/areas/11-art-visual-style.md §3.2). Bright, saturated
 * hues for materials, lights and the sky; code references theme KEYS, never raw hex literals.
 *
 * This is the WORLD only. Everything in the DOM — screens and HUD alike — takes its colours from
 * `src/ui/styles/tokens.css`, so the two never fight over one constant.
 *
 * Values are authored in sRGB hex and converted once, on first use, by `colorOf`. Mood comes from
 * light intensity and tone mapping, never from pre-darkened paint (§3.2): there is no "night" variant
 * of a material colour in here, only a night *sky* and a warmer *sun*.
 */
import * as THREE from 'three';

export const WORLD = Object.freeze({
  // Line/shadow
  ink: '#1a1c2c',
  shadow: '#2b2f4a',
  // Sky (day)
  skyDayTop: '#4fc3ff',
  skyDayMid: '#8be9fd',
  skyDayLow: '#fff3b0', // shares `flash`
  // Sky (night)
  skyNightTop: '#1b1f5c',
  skyNightMid: '#3a2f7a',
  // Clouds
  cloud: '#ffffff',
  // Domes
  domeGold: '#ffcb3d',
  domeTeal: '#2ec4b6',
  domeRed: '#e84a5f',
  // Buildings
  concrete: '#9aa0b5',
  concreteDk: '#6b7088',
  windowLit: '#ffd23f', // shares `explYellow`
  windowDark: '#3b4a6b',
  // Soldier
  uniform: '#6e7d3b',
  uniformDk: '#4a5526',
  skin: '#f2c79a',
  skinDk: '#c98e63',
  // Gun / FX
  gunmetal: '#5a6172',
  gunmetalDk: '#353a4a',
  flash: '#fff3b0',
  flashHot: '#ff9f1c',
  // Drones
  droneBody: '#5a6172', // shares `gunmetal`
  droneScout: '#4fc3ff', // shares `skyDayTop`
  droneBomber: '#ff3b3b', // shares `meterCrit`
  droneSwarm: '#b06cff',
  droneBoss: '#ff2e63',
  // Explosion / smoke
  explYellow: '#ffd23f',
  explOrange: '#ff7b00',
  smoke: '#c7ccd6',
  // Economy
  rubleGold: '#ffcb3d', // shares `domeGold`
  // UI
  panel: '#2440a0',
  panelLite: '#4f7cff',
  cream: '#fff6e6',
  accentPink: '#ff5db1',
  // Meters
  meterGood: '#3ddc84',
  meterWarn: '#ff9f1c', // shares `flashHot`
  meterCrit: '#ff3b3b',
  // Light rig. The key light's colour temperature swings across the day (§3.5); the hemisphere's
  // lower half stands in for bounce off the city below.
  sunNoon: '#fff4e0',
  sunLow: '#ffb367',
  moonlight: '#9fb6ff',
  bounce: '#223044',
} as const);

export type WorldColorKey = keyof typeof WORLD;

// One THREE.Color per key, built on first use and shared thereafter. The render loop reads colours
// every frame, and `docs/compatibility.md` §7 is explicit that allocating a `new THREE.Color()` per
// frame is a regression — so the cache is the only supported way to get one.
const cache = new Map<WorldColorKey, THREE.Color>();

/**
 * The shared colour for a key. **Treat the result as immutable**: it is the same object on every
 * call, so mutating it repaints every material that ever read that key. To derive a colour, copy it
 * into your own instance, or use `mixInto`.
 */
export function colorOf(key: WorldColorKey): THREE.Color {
  let c = cache.get(key);
  if (!c) {
    c = new THREE.Color(WORLD[key]);
    cache.set(key, c);
  }
  return c;
}

/**
 * Write the blend of two theme colours into `target`, allocating nothing. `t = 0` is `a`, `t = 1`
 * is `b`. This is the day/night ramp's workhorse.
 */
export function mixInto(
  target: THREE.Color,
  a: WorldColorKey,
  b: WorldColorKey,
  t: number,
): THREE.Color {
  return target.copy(colorOf(a)).lerp(colorOf(b), t);
}
