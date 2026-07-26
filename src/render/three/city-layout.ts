/**
 * The shape of a Stalinist skyline, derived from nothing but the numbers the balance table already
 * carries (docs/areas/11-art-visual-style.md §3.1).
 *
 * `content.combat.skyline.buildings` gives each tower an `{ id, x, width, height, stories }` and
 * nothing else, because those are the only numbers the *simulation* needs — a drone dives at a roof
 * and shears slabs off it. This module turns that into a silhouette: stepped setbacks, the cornice
 * that caps each step, and a crown. No content change is needed or wanted; the sim's idea of a
 * building must stay as small as it is.
 *
 * ## Why the layout is a list of boxes rather than a mesh
 *
 * Everything here is plain data — no three.js, no geometry — so the whole silhouette is provable by
 * test and sits inside the coverage and mutation gates. `./city` turns the boxes into instances.
 *
 * ## The constraint that shapes everything: damage must stay addressable
 *
 * Skyline damage works by removing storeys from the top. That makes the drawing order load-bearing:
 * every box records the storey it dies with, and the lists are ordered by that storey, so "this
 * building has lost four floors" is a *count*, not a search. `./city` leans on exactly that — the
 * storey masses become one instanced mesh per building whose `count` is the number still standing.
 * Anything that breaks the ordering breaks destruction, so `boxesAlive` and its tests are the
 * contract, not a convenience.
 */

/** One box in a building. Positions are relative to the building's own base and centre line. */
export interface CityBox {
  /** Centre height above the building's base. */
  readonly y: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  /**
   * The storey this box belongs to, 0 at the base. It is drawn while that storey is standing and
   * removed with it, which is what lets a cornice fall with the setback it caps.
   */
  readonly storey: number;
}

/** What tops the building off. Domes are why a Moscow skyline is not an American one. */
export type CrownKind = 'spire' | 'dome' | 'block';

export interface CityCrown {
  readonly kind: CrownKind;
  /** Height of the crown's underside above the building's base. */
  readonly base: number;
  readonly height: number;
  readonly radius: number;
  /** 0, 1 or 2 — picks one of the three dome colours so the skyline is not monochrome. */
  readonly hue: number;
  /** Roof furniture: tanks, vents and housings. Dies with the crown. */
  readonly clutter: readonly CityBox[];
}

export interface CityLayout {
  readonly id: number;
  readonly storeys: number;
  readonly storeyHeight: number;
  /** Footprint of the widest (base) tier. */
  readonly width: number;
  readonly depth: number;
  /** Total height of the storey masses, crown excluded. */
  readonly height: number;
  /** Exactly one per storey, bottom to top: box `i` is storey `i`. */
  readonly bands: readonly CityBox[];
  /** The overhanging caps, bottom to top. Fewer than there are storeys. */
  readonly cornices: readonly CityBox[];
  readonly crown: CityCrown;
}

/** Depth as a share of width. Matches the proportion the skyline was drawn at before setbacks. */
const DEPTH_RATIO = 0.7;

/** How much narrower each tier is than the one below it. */
const SETBACK = 0.17;

/** How far a cornice oversails the tier it caps, and how tall it is in storeys. */
const CORNICE_OVERSAIL = 1.09;
const CORNICE_HEIGHT = 0.28;

/**
 * Relative share of the storeys given to each tier, tallest first. A wedding cake is bottom-heavy:
 * an even split reads as a staircase, which is a different building entirely.
 */
const TIER_WEIGHTS = [3, 1.9, 1.3, 1];

/**
 * Deterministic hash of a small integer into [0, 1).
 *
 * The skyline must look the same on every machine and in every run — it is scenery the player
 * learns the shape of — so variety comes from the building's own id rather than from an RNG that
 * anything else could advance.
 */
function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Split `storeys` across `tiers`, bottom-heavy, with every tier getting at least one. */
function splitStoreys(storeys: number, tiers: number): number[] {
  const weights = TIER_WEIGHTS.slice(0, tiers);
  const total = weights.reduce((a, b) => a + b, 0);
  const out: number[] = [];
  let assigned = 0;
  // Filled from the top down, and the base tier takes whatever is left. That keeps the total exact
  // however the rounding falls, and it keeps the cake bottom-heavy without a correction pass: the
  // clamp only ever has to reserve one storey for each tier still unfilled.
  for (let t = tiers - 1; t > 0; t -= 1) {
    const want = Math.round((storeys * (weights[t] as number)) / total);
    out[t] = Math.max(1, Math.min(storeys - assigned - t, want));
    assigned += out[t] as number;
  }
  out[0] = storeys - assigned;
  return out;
}

/**
 * How many boxes of an ordered list are still standing when `surviving` storeys remain.
 *
 * The lists are ordered by the storey each box dies with, so this is the count of a prefix — which
 * is exactly what an `InstancedMesh.count` wants. Returning a count rather than a filtered list is
 * the point: it costs no allocation and it is applied per frame.
 */
export function boxesAlive(boxes: readonly CityBox[], surviving: number): number {
  let n = 0;
  while (n < boxes.length && (boxes[n] as CityBox).storey < surviving) n += 1;
  return n;
}

/**
 * Derive a building's silhouette from the four numbers the balance table gives it.
 *
 * `width` and `height` are world units; `storeys` is the damage granularity the sim already uses,
 * so the storey masses line up exactly with what `cut` removes.
 */
export function cityLayoutFor(id: number, width: number, height: number, storeys: number): CityLayout {
  const n = Math.max(1, Math.floor(storeys));
  const storeyHeight = height / n;
  // Two to four steps. One would not be a wedding cake, and five on an eighteen-storey block leaves
  // tiers a single floor tall, which reads as a glitch rather than as architecture.
  const tiers = Math.min(n, 2 + Math.floor(hash(id) * 3));
  const split = splitStoreys(n, tiers);

  const bands: CityBox[] = [];
  const cornices: CityBox[] = [];
  let storey = 0;
  let topWidth = width;
  for (let t = 0; t < tiers; t += 1) {
    // Never below a third of the base: past that the top tier is a pole, and the windows on it are
    // narrower than the frames between them.
    const w = width * Math.max(0.34, 1 - t * SETBACK);
    const d = w * DEPTH_RATIO;
    topWidth = w;
    const count = split[t] as number;
    for (let s = 0; s < count; s += 1) {
      bands.push({
        y: (storey + 0.5) * storeyHeight,
        width: w,
        depth: d,
        // A hairline gap between storeys, so damage reads as floors coming off rather than as a
        // solid block getting shorter.
        height: storeyHeight * 0.94,
        storey,
      });
      storey += 1;
    }
    const capStorey = storey - 1;
    cornices.push({
      y: storey * storeyHeight,
      width: w * CORNICE_OVERSAIL,
      depth: d * CORNICE_OVERSAIL,
      height: storeyHeight * CORNICE_HEIGHT,
      storey: capStorey,
    });
  }

  const pick = Math.floor(hash(id + 977) * 3);
  const crownKind: CrownKind = pick === 0 ? 'spire' : pick === 1 ? 'dome' : 'block';
  const radius = topWidth * 0.34;
  const crownHeight =
    crownKind === 'spire' ? storeyHeight * 5.5 : crownKind === 'dome' ? radius * 2.1 : storeyHeight * 1.4;

  // Roof furniture, laid out across the top tier. Deterministic from the id like everything else.
  const clutter: CityBox[] = [];
  const pieces = 2 + Math.floor(hash(id + 5381) * 3);
  for (let i = 0; i < pieces; i += 1) {
    const r = hash(id * 31 + i * 7 + 101);
    const boxHeight = storeyHeight * (0.35 + r * 0.6);
    clutter.push({
      y: height + boxHeight / 2,
      width: topWidth * (0.14 + r * 0.12),
      depth: topWidth * DEPTH_RATIO * (0.16 + r * 0.14),
      height: boxHeight,
      storey: n - 1,
    });
  }

  return {
    id,
    storeys: n,
    storeyHeight,
    width,
    depth: width * DEPTH_RATIO,
    height,
    bands,
    cornices,
    crown: { kind: crownKind, base: height, height: crownHeight, radius, hue: Math.floor(hash(id + 7919) * 3), clutter },
  };
}

/**
 * Where a piece of roof clutter sits along the top tier, as a share of its width from the centre.
 *
 * Kept out of `CityBox` because it is the only field that is about *placement across* the building
 * rather than about the box itself, and `./city` is the only thing that needs it.
 */
export function clutterOffset(id: number, index: number, pieces: number): number {
  const spread = pieces === 1 ? 0 : index / (pieces - 1) - 0.5;
  return spread * 0.62 + (hash(id * 13 + index) - 0.5) * 0.1;
}
