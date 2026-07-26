/**
 * Render quality tiers (docs/areas/11-art-visual-style.md §3.10).
 *
 * The rule the docs set is "tier down, don't drop frames": the fixed-timestep simulation is never
 * traded away for visuals, so when a device cannot afford the picture it is the picture that gives.
 * This module owns both halves of that decision and is deliberately free of three.js — it takes
 * numbers in and gives a policy out, so every branch is provable by test rather than by squinting at
 * a phone.
 *
 * Two decisions live here:
 *
 *  - `pickTier` — a one-off guess from what the platform will admit about itself, made before a
 *    single frame has been drawn. It is conservative on purpose: starting too high and falling back
 *    is a visible stutter, while starting a notch low and staying there is not.
 *  - `createTierGovernor` — the correction, from frames actually observed. It only ever goes DOWN;
 *    see the note on the governor for why.
 */

export type Tier = 'low' | 'medium' | 'high';

/** Ordered worst → best, so a tier can be stepped without a lookup table of special cases. */
export const TIERS: readonly Tier[] = ['low', 'medium', 'high'] as const;

/**
 * What the platform admits about itself. Every field is something a browser will answer without a
 * permission prompt; `deviceMemoryGb` and `hardwareConcurrency` are absent on some engines (Safari
 * reports neither `deviceMemory` nor a useful concurrency), so 0 means "wouldn't say".
 */
export interface DeviceProbe {
  /** True for phones and tablets. A mobile GPU never gets the high tier, whatever else it claims. */
  mobile: boolean;
  /**
   * True when the "GPU" is a software rasteriser (SwiftShader, llvmpipe, Microsoft Basic Render).
   * This is the one signal nothing else can stand in for: a CI container or a machine with no
   * working driver reports a fast CPU and plenty of memory, and would otherwise be handed the full
   * post chain to run on cores that are already busy with the simulation.
   */
  softwareRenderer: boolean;
  /** `navigator.hardwareConcurrency`, or 0 when unavailable. */
  cores: number;
  /** `navigator.deviceMemory` in GB, or 0 when unavailable. */
  memoryGb: number;
  /** `gl.getParameter(gl.MAX_TEXTURE_SIZE)`. The bluntest "is this GPU ancient" signal there is. */
  maxTextureSize: number;
}

/** Renderer strings that mean "there is no real GPU behind this context". */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render|generic renderer/i;

/**
 * Read a WebGL context's renderer string and decide whether it is a software rasteriser.
 *
 * `WEBGL_debug_renderer_info` is the unmasked source where it exists; where it does not, the plain
 * `RENDERER` parameter is usually still specific enough (Chromium reports SwiftShader inside its
 * ANGLE string either way). Anything unreadable is treated as real hardware — the governor will
 * catch a genuinely slow device from its frame times, whereas guessing "software" from silence would
 * strip the picture from every browser that simply declines to answer.
 */
export function isSoftwareRenderer(renderer: string | null | undefined): boolean {
  return typeof renderer === 'string' && SOFTWARE_RENDERER.test(renderer);
}

/** What a tier is allowed to spend. Consumed by `post.ts` and the renderer setup in `view.ts`. */
export interface TierPolicy {
  /** Run the EffectComposer at all. False means a direct `renderer.render`. */
  post: boolean;
  /** Ground-truth ambient occlusion — the most expensive pass in the chain. */
  ambientOcclusion: boolean;
  bloom: boolean;
  /** Post-resolve antialiasing (SMAA). Off-tier still gets the context's own MSAA. */
  antialias: boolean;
  shadows: boolean;
  /** Square shadow-map edge. 0 when shadows are off. */
  shadowMapSize: number;
  /**
   * Prefilter the sky into an environment map for image-based lighting.
   *
   * Cheap to *sample* and expensive to *bake* — a cube render plus a roughness mip chain, which a
   * software rasteriser pays for in whole frames. It is the ambient response that makes metal read
   * as metal, so it is worth real money on hardware and worth none at all without it.
   */
  environment: boolean;
  /**
   * Stars and the sun's halo in the sky shader.
   *
   * The dome covers most of the frame, so anything per-pixel in it is paid for on almost every pixel
   * on the screen. The gradient and the sun's disc are free enough to keep everywhere; the two
   * transcendental terms are not, and were measured tripling frame time on a software rasteriser.
   */
  richSky: boolean;
  /** Upper bound on `devicePixelRatio`; the dominant cost lever on a phone. */
  pixelRatioCap: number;
}

const POLICIES: Readonly<Record<Tier, TierPolicy>> = Object.freeze({
  high: {
    post: true,
    ambientOcclusion: true,
    bloom: true,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    environment: true,
    richSky: true,
    pixelRatioCap: 3,
  },
  medium: {
    post: true,
    ambientOcclusion: false,
    bloom: true,
    antialias: true,
    shadows: true,
    shadowMapSize: 1024,
    environment: true,
    richSky: true,
    pixelRatioCap: 2,
  },
  low: {
    post: false,
    ambientOcclusion: false,
    bloom: false,
    antialias: false,
    shadows: false,
    shadowMapSize: 0,
    environment: false,
    richSky: false,
    pixelRatioCap: 1,
  },
});

/**
 * A first guess at what this device can afford, from what it will admit about itself.
 *
 * Mobile is capped at `medium` regardless of how good the numbers look. A recent phone will happily
 * report eight cores and then thermally throttle two minutes into a shift, and a shift is long — the
 * governor below would catch it, but only after the player had already watched it happen.
 */
export function pickTier(p: DeviceProbe): Tier {
  // No real GPU: every pass would be drawn on the CPU, next to the simulation that has to hold a
  // fixed timestep. Nothing else in the probe can see this.
  if (p.softwareRenderer) return 'low';
  // A GPU that cannot hold a 4K texture is far too old for a post chain, whatever the CPU claims.
  if (p.maxTextureSize > 0 && p.maxTextureSize < 4096) return 'low';
  // 0 means the engine declined to answer, which is not the same as "one core".
  if (p.cores > 0 && p.cores <= 2) return 'low';
  if (p.memoryGb > 0 && p.memoryGb <= 2) return 'low';

  if (p.mobile) {
    const roomy = (p.cores === 0 || p.cores >= 6) && (p.memoryGb === 0 || p.memoryGb >= 4);
    return roomy ? 'medium' : 'low';
  }

  const strong = (p.cores === 0 || p.cores >= 8) && (p.memoryGb === 0 || p.memoryGb >= 8);
  return strong ? 'high' : 'medium';
}

/**
 * The spending limit for a tier. `reducedFlash` hard-disables the whole post chain on every tier —
 * bloom is by definition a brightness bloom, and the accessibility setting exists precisely to stop
 * that (docs §3.6). It does not touch shadows, which flash at nobody.
 */
export function policyFor(tier: Tier, opts: { reducedFlash: boolean }): TierPolicy {
  const base = POLICIES[tier];
  if (!opts.reducedFlash) return base;
  return { ...base, post: false, ambientOcclusion: false, bloom: false, antialias: false };
}

/** The pixel ratio to actually render at. */
export function pixelRatioFor(tier: Tier, devicePixelRatio: number): number {
  const cap = POLICIES[tier].pixelRatioCap;
  return Math.max(1, Math.min(devicePixelRatio, cap));
}

/** One step worse, or the same tier if already at the bottom. */
export function stepDown(tier: Tier): Tier {
  const i = TIERS.indexOf(tier);
  return TIERS[Math.max(0, i - 1)] ?? 'low';
}

/** Sustained frame time above this is taken as "this device cannot afford the current tier". */
export const FRAME_BUDGET_MS = 22;
/** Frames per verdict. ~1.5 s at 60 fps — long enough that one bad frame cannot demote anything. */
export const SAMPLE_WINDOW = 90;

export interface TierGovernor {
  /** The tier in force right now. */
  readonly tier: Tier;
  /**
   * Feed one frame's wall-clock cost. Returns true on the frames where the tier changed, so the
   * caller can rebuild the render chain without diffing state itself.
   */
  sample(frameMs: number): boolean;
}

/**
 * Watches real frame times and tiers down when they miss budget.
 *
 * **It never tiers back up.** Recovering would restore the very cost that caused the demotion, so
 * the frame time would rise again and the tier would flap — and a picture that visibly changes
 * quality every few seconds is worse than one that is quietly a notch conservative. A player who
 * wants the pretty version back can reload; a player mid-shift wants a steady frame.
 *
 * The verdict uses the MEDIAN of the window, not the mean. Shader compilation, texture upload and
 * GC produce isolated spikes an order of magnitude above the norm, and a mean would let a handful of
 * those condemn a device that is otherwise comfortable.
 */
export function createTierGovernor(initial: Tier): TierGovernor {
  let tier = initial;
  // Preallocated: the render loop calls this every frame and must not allocate (compatibility.md §7).
  const window = new Float64Array(SAMPLE_WINDOW);
  const scratch = new Float64Array(SAMPLE_WINDOW);
  let filled = 0;

  return {
    get tier(): Tier {
      return tier;
    },
    sample(frameMs: number): boolean {
      if (tier === 'low') return false; // nothing left to give up
      if (!Number.isFinite(frameMs) || frameMs < 0) return false;

      window[filled] = frameMs;
      filled += 1;
      if (filled < SAMPLE_WINDOW) return false;

      filled = 0;
      scratch.set(window);
      scratch.sort();
      const median = scratch[SAMPLE_WINDOW >> 1] ?? 0;
      if (median <= FRAME_BUDGET_MS) return false;

      tier = stepDown(tier);
      return true;
    },
  };
}
