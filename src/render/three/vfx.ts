/**
 * The particle simulation behind every explosion, spark and puff of smoke.
 *
 * Kept entirely free of three.js so it can be proven rather than watched. What matters about a
 * particle system is not how it looks in one frame but the promises it makes over thousands of
 * them — that it never allocates, never grows, never leaks a slot, and produces the same frame
 * twice — and every one of those is a statement a test can make and a screenshot cannot.
 *
 * The design is a **fixed-capacity slab, allocated once**. `docs/compatibility.md` §7 forbids
 * allocation in the render loop, and the honest way to keep that promise is to have nothing left to
 * allocate: the arrays below are sized at construction and every particle is a slot that is either
 * live or free. A burst that would overflow overwrites the oldest live particles instead of growing,
 * which is the right failure: the newest explosion is the one the player is looking at.
 *
 * Randomness is a counter, not `Math.random`. The whole renderer is reproducible and this is the one
 * place that would casually give that up.
 */

/**
 * What a particle is, which decides how it is drawn and how it moves.
 *
 * Numbers rather than strings because these are read once per particle per frame and compared in the
 * inner loop of the emitter; the parallel arrays below exist for the same reason.
 */
export const SPARK = 0;
export const SMOKE = 1;
export const EMBER = 2;

export interface ParticleField {
  readonly capacity: number;
  /** 1 while alive, 0 while free. */
  readonly alive: Uint8Array;
  readonly kind: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  /** Seconds remaining, and the value it started at — the two give the 0..1 fade. */
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly size: Float32Array;
  /** Next slot the round-robin allocator will try. Internal, but part of the state so it can be read. */
  cursor: number;
  /** Advanced once per drawn value. The whole source of variation. */
  seed: number;
}

export interface BurstOptions {
  x: number;
  y: number;
  z: number;
  count: number;
  kind: number;
  /** Metres per second at the centre of the spread. */
  speed: number;
  /** Seconds a particle of this burst lives, before the per-particle jitter. */
  life: number;
  size: number;
  /** Upward bias, so an explosion rises and debris does not. 0 is a perfect sphere. */
  rise: number;
}

export function createField(capacity: number): ParticleField {
  const n = Math.max(1, Math.floor(capacity));
  return {
    capacity: n,
    alive: new Uint8Array(n),
    kind: new Uint8Array(n),
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    vx: new Float32Array(n),
    vy: new Float32Array(n),
    vz: new Float32Array(n),
    life: new Float32Array(n),
    maxLife: new Float32Array(n),
    size: new Float32Array(n),
    cursor: 0,
    seed: 1,
  };
}

/** One deterministic value in [0, 1), advancing the field's own sequence. */
function next(field: ParticleField): number {
  // A 32-bit xorshift. Cheap, has no short cycles at these counts, and is exactly reproducible.
  let s = field.seed | 0;
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  field.seed = s | 0;
  return ((s >>> 0) % 100000) / 100000;
}

/**
 * Emit `count` particles at a point. Returns how many slots were taken — always `count`, since the
 * allocator overwrites rather than refusing, but stated so a caller can assert on it.
 */
export function emitBurst(field: ParticleField, options: BurstOptions): number {
  const wanted = Math.max(0, Math.floor(options.count));
  for (let i = 0; i < wanted; i += 1) {
    const slot = field.cursor;
    field.cursor = (field.cursor + 1) % field.capacity;

    // A direction on the sphere, biased upward by `rise`. Not a perfect distribution — it does not
    // need to be, and the cheap version has no trigonometry in it beyond two calls.
    const theta = next(field) * Math.PI * 2;
    const u = next(field) * 2 - 1;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    const spread = 0.35 + next(field) * 0.65;
    const v = options.speed * spread;

    field.alive[slot] = 1;
    field.kind[slot] = options.kind;
    field.x[slot] = options.x;
    field.y[slot] = options.y;
    field.z[slot] = options.z;
    field.vx[slot] = Math.cos(theta) * r * v;
    field.vy[slot] = (u + options.rise) * v;
    field.vz[slot] = Math.sin(theta) * r * v;
    const life = options.life * (0.6 + next(field) * 0.8);
    field.life[slot] = life;
    field.maxLife[slot] = life;
    field.size[slot] = options.size * (0.6 + next(field) * 0.8);
  }
  return wanted;
}

/**
 * Advance every live particle by `dt` seconds.
 *
 * Smoke rises and drags; sparks and embers fall. Both are the same integration with a different
 * sign, which is why they share a field: one pass over one slab, whatever is in it.
 */
export function advanceField(field: ParticleField, dt: number, gravity: number): void {
  if (!(dt > 0)) return;
  // Frame-rate independent drag. `pow` once, not once per particle.
  const drag = Math.pow(0.12, dt);
  const smokeDrag = Math.pow(0.02, dt);
  // `noUncheckedIndexedAccess` types every read below as possibly-undefined. It cannot be: `i` is
  // bounded by `capacity`, which IS the length of every slab. The assertions say so. A `?? 0` would
  // read as more careful and be strictly worse — it would add a branch that can never be taken, and
  // an unreachable branch is a hole in the branch gate, which is the one thing keeping this file
  // honest.
  const { alive, kind, x, y, z, vx, vy, vz, life } = field;
  for (let i = 0; i < field.capacity; i += 1) {
    if (alive[i] === 0) continue;
    const remaining = (life[i] as number) - dt;
    if (remaining <= 0) {
      alive[i] = 0;
      life[i] = 0;
      continue;
    }
    life[i] = remaining;
    const smoke = kind[i] === SMOKE;
    const d = smoke ? smokeDrag : drag;
    vx[i] = (vx[i] as number) * d;
    vz[i] = (vz[i] as number) * d;
    // Smoke is buoyant and keeps climbing; anything hot enough to be a spark is also heavy enough
    // to fall, and the arc it falls on is most of what makes a burst read as debris.
    vy[i] = (vy[i] as number) * d + (smoke ? gravity * dt * 0.35 : -gravity * dt);
    x[i] = (x[i] as number) + (vx[i] as number) * dt;
    y[i] = (y[i] as number) + (vy[i] as number) * dt;
    z[i] = (z[i] as number) + (vz[i] as number) * dt;
  }
}

/** How many slots are live. Linear, and only for tests and the render-cost gate. */
export function liveCount(field: ParticleField): number {
  let n = 0;
  for (let i = 0; i < field.capacity; i += 1) if (field.alive[i] === 1) n += 1;
  return n;
}

/** Fade of a slot, 1 at birth falling to 0 at death. 0 for a free slot. */
export function fadeOf(field: ParticleField, i: number): number {
  if (field.alive[i] !== 1) return 0;
  return (field.life[i] as number) / (field.maxLife[i] as number);
}

/**
 * Expanding shockwave rings, the beat that says a kill landed.
 *
 * A separate, much smaller pool: a ring is one quad, it always expands and fades the same way, and
 * there are never many. Folding it into the particle field would have meant a branch per particle
 * for the sake of four of them.
 */
export interface RingField {
  readonly capacity: number;
  readonly alive: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly reach: Float32Array;
  cursor: number;
}

export function createRings(capacity: number): RingField {
  const n = Math.max(1, Math.floor(capacity));
  return {
    capacity: n,
    alive: new Uint8Array(n),
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    life: new Float32Array(n),
    maxLife: new Float32Array(n),
    reach: new Float32Array(n),
    cursor: 0,
  };
}

export function emitRing(
  rings: RingField,
  x: number,
  y: number,
  z: number,
  reach: number,
  life: number,
): void {
  const slot = rings.cursor;
  rings.cursor = (rings.cursor + 1) % rings.capacity;
  rings.alive[slot] = 1;
  rings.x[slot] = x;
  rings.y[slot] = y;
  rings.z[slot] = z;
  rings.reach[slot] = reach;
  rings.life[slot] = life;
  rings.maxLife[slot] = life;
}

export function advanceRings(rings: RingField, dt: number): void {
  if (!(dt > 0)) return;
  for (let i = 0; i < rings.capacity; i += 1) {
    if (rings.alive[i] === 0) continue;
    const remaining = (rings.life[i] as number) - dt;
    if (remaining <= 0) {
      rings.alive[i] = 0;
      rings.life[i] = 0;
      continue;
    }
    rings.life[i] = remaining;
  }
}

/**
 * A ring's radius now.
 *
 * Eased out, hard: a shockwave is almost its full size immediately and then creeps. Linear growth
 * reads as a bubble inflating, which is the opposite of the snap this is here to provide.
 */
export function ringRadius(rings: RingField, i: number): number {
  if (rings.alive[i] !== 1) return 0;
  const t = 1 - (rings.life[i] as number) / (rings.maxLife[i] as number);
  return (rings.reach[i] as number) * (1 - (1 - t) * (1 - t) * (1 - t));
}

/** A ring's opacity now: full at birth, gone at death, falling faster than it grows. */
export function ringFade(rings: RingField, i: number): number {
  if (rings.alive[i] !== 1) return 0;
  const t = (rings.life[i] as number) / (rings.maxLife[i] as number);
  return t * t;
}
