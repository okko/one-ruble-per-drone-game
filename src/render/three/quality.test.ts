import { describe, it, expect } from 'vitest';
import {
  createTierGovernor,
  FRAME_BUDGET_MS,
  isSoftwareRenderer,
  pickTier,
  pixelRatioFor,
  policyFor,
  SAMPLE_WINDOW,
  stepDown,
  TIERS,
  type DeviceProbe,
  type Tier,
} from './quality';

/** A comfortable desktop; each test overrides only the field it is about. */
function probe(over: Partial<DeviceProbe> = {}): DeviceProbe {
  return { mobile: false, softwareRenderer: false, cores: 8, memoryGb: 8, maxTextureSize: 8192, ...over };
}

describe('tier ordering', () => {
  it('runs worst to best', () => {
    expect(TIERS).toEqual(['low', 'medium', 'high']);
  });

  it('steps down one notch and bottoms out at low', () => {
    expect(stepDown('high')).toBe('medium');
    expect(stepDown('medium')).toBe('low');
    expect(stepDown('low')).toBe('low');
  });
});

describe('picking a tier from the device probe', () => {
  it('gives a roomy desktop the high tier', () => {
    expect(pickTier(probe())).toBe('high');
  });

  it('never gives a phone the high tier, however good its numbers look', () => {
    expect(pickTier(probe({ mobile: true, cores: 16, memoryGb: 16 }))).toBe('medium');
  });

  it('drops a modest phone to low', () => {
    expect(pickTier(probe({ mobile: true, cores: 4, memoryGb: 4 }))).toBe('low');
    expect(pickTier(probe({ mobile: true, cores: 8, memoryGb: 3 }))).toBe('low');
  });

  it('drops an ancient GPU to low on texture size alone', () => {
    expect(pickTier(probe({ maxTextureSize: 2048 }))).toBe('low');
  });

  it('pins a software rasteriser to low however fast the CPU looks', () => {
    // The case that matters: a CI container reports plenty of cores and memory, and would otherwise
    // be handed the full chain to draw on the same cores the simulation is running on.
    expect(pickTier(probe({ softwareRenderer: true, cores: 32, memoryGb: 64 }))).toBe('low');
  });

  it('drops a starved machine to low on cores or memory', () => {
    expect(pickTier(probe({ cores: 2 }))).toBe('low');
    expect(pickTier(probe({ memoryGb: 2 }))).toBe('low');
  });

  it('gives a mid desktop the medium tier', () => {
    expect(pickTier(probe({ cores: 4 }))).toBe('medium');
    expect(pickTier(probe({ memoryGb: 4 }))).toBe('medium');
  });

  it('treats an unanswered probe field as unknown, not as zero', () => {
    // Safari reports neither deviceMemory nor a useful concurrency; it must not be condemned for it.
    expect(pickTier(probe({ cores: 0, memoryGb: 0 }))).toBe('high');
    expect(pickTier(probe({ maxTextureSize: 0 }))).toBe('high');
    expect(pickTier(probe({ mobile: true, cores: 0, memoryGb: 0 }))).toBe('medium');
  });

  it('holds the boundaries exactly where they are documented', () => {
    expect(pickTier(probe({ cores: 3 }))).toBe('medium'); // <=2 is low
    expect(pickTier(probe({ memoryGb: 3 }))).toBe('medium'); // <=2 is low
    expect(pickTier(probe({ maxTextureSize: 4096 }))).toBe('high'); // <4096 is low
    expect(pickTier(probe({ mobile: true, cores: 6, memoryGb: 4 }))).toBe('medium');
    expect(pickTier(probe({ mobile: true, cores: 5, memoryGb: 4 }))).toBe('low');
  });
});

describe('recognising a software rasteriser', () => {
  it('spots the renderers that mean there is no GPU', () => {
    for (const s of [
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))',
      'Mesa/X.org, llvmpipe (LLVM 15.0.7, 256 bits)',
      'Microsoft Basic Render Driver',
      'Software Rasterizer',
    ]) {
      expect(isSoftwareRenderer(s), s).toBe(true);
    }
  });

  it('leaves real hardware alone', () => {
    for (const s of [
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)',
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'Apple GPU',
      'Adreno (TM) 740',
    ]) {
      expect(isSoftwareRenderer(s), s).toBe(false);
    }
  });

  it('treats an unreadable renderer as hardware, and lets the governor decide instead', () => {
    expect(isSoftwareRenderer(null)).toBe(false);
    expect(isSoftwareRenderer(undefined)).toBe(false);
    expect(isSoftwareRenderer('')).toBe(false);
  });
});

describe('what a tier is allowed to spend', () => {
  const plain = { reducedFlash: false };

  it('spends most at high and nothing at low', () => {
    const high = policyFor('high', plain);
    expect(high).toMatchObject({ post: true, ambientOcclusion: true, bloom: true, shadows: true });

    const low = policyFor('low', plain);
    expect(low).toMatchObject({
      post: false,
      bloom: false,
      shadows: false,
      shadowMapSize: 0,
      environment: false,
    });
  });

  it('drops only ambient occlusion between high and medium', () => {
    const medium = policyFor('medium', plain);
    expect(medium.post).toBe(true);
    expect(medium.bloom).toBe(true);
    expect(medium.ambientOcclusion).toBe(false);
    expect(medium.shadows).toBe(true);
    expect(medium.environment).toBe(true);
    expect(medium.shadowMapSize).toBeLessThan(policyFor('high', plain).shadowMapSize);
  });

  it('bakes an environment map only where there is a GPU to bake it', () => {
    // The bake is a cube render plus a mip chain. On a software rasteriser it costs whole frames,
    // and it was measured doing exactly that: the low tier goes without.
    expect(policyFor('high', plain).environment).toBe(true);
    expect(policyFor('low', plain).environment).toBe(false);
  });

  it('gives the low tier a plain sky, because the sky is most of the screen', () => {
    // Measured, not guessed: the full sky shader tripled the low tier's frame time. The gradient and
    // the sun's disc survive on every tier; the stars and the halo are what get spent here.
    expect(policyFor('high', plain).richSky).toBe(true);
    expect(policyFor('medium', plain).richSky).toBe(true);
    expect(policyFor('low', plain).richSky).toBe(false);
  });

  it('downloads the generated surface maps only where they will not cost frames', () => {
    // Three extra samplers per surface, and a download the low tier would only use to slow itself.
    expect(policyFor('high', plain).detailTextures).toBe(true);
    expect(policyFor('medium', plain).detailTextures).toBe(true);
    expect(policyFor('low', plain).detailTextures).toBe(false);
  });

  it('keeps surface detail under reducedFlash, which is about flashing and not about texture', () => {
    expect(policyFor('high', { reducedFlash: true }).detailTextures).toBe(true);
  });

  it('keeps the environment map when reducedFlash is set, because ambient light does not flash', () => {
    expect(policyFor('high', { reducedFlash: true }).environment).toBe(true);
  });

  it('caps the pixel ratio harder as the tier falls', () => {
    expect(policyFor('high', plain).pixelRatioCap).toBeGreaterThan(policyFor('medium', plain).pixelRatioCap);
    expect(policyFor('medium', plain).pixelRatioCap).toBeGreaterThan(policyFor('low', plain).pixelRatioCap);
  });

  it('kills the whole post chain when reducedFlash is set, on every tier', () => {
    for (const tier of TIERS) {
      const p = policyFor(tier, { reducedFlash: true });
      expect(p.post, tier).toBe(false);
      expect(p.bloom, tier).toBe(false);
      expect(p.ambientOcclusion, tier).toBe(false);
      expect(p.antialias, tier).toBe(false);
    }
  });

  it('leaves shadows alone when reducedFlash is set, because shadows do not flash', () => {
    expect(policyFor('high', { reducedFlash: true }).shadows).toBe(true);
    expect(policyFor('high', { reducedFlash: true }).shadowMapSize).toBe(
      policyFor('high', { reducedFlash: false }).shadowMapSize,
    );
  });

  it('does not let reducedFlash mutate the shared policy table', () => {
    policyFor('high', { reducedFlash: true });
    expect(policyFor('high', { reducedFlash: false }).post).toBe(true);
  });
});

describe('pixel ratio', () => {
  it('honours the tier cap', () => {
    expect(pixelRatioFor('high', 4)).toBe(3);
    expect(pixelRatioFor('medium', 4)).toBe(2);
    expect(pixelRatioFor('low', 4)).toBe(1);
  });

  it('never renders above the display density it was given', () => {
    expect(pixelRatioFor('high', 1.5)).toBe(1.5);
    expect(pixelRatioFor('medium', 1)).toBe(1);
  });

  it('never renders below 1, even if the display claims to', () => {
    expect(pixelRatioFor('high', 0.5)).toBe(1);
  });
});

/** Feed the governor `n` frames that each cost `ms`; returns how many times the tier changed. */
function feed(gov: ReturnType<typeof createTierGovernor>, n: number, ms: number): number {
  let changes = 0;
  for (let i = 0; i < n; i++) if (gov.sample(ms)) changes += 1;
  return changes;
}

describe('the adaptive tier governor', () => {
  it('leaves a comfortable device alone', () => {
    const gov = createTierGovernor('high');
    expect(feed(gov, SAMPLE_WINDOW * 4, 12)).toBe(0);
    expect(gov.tier).toBe('high');
  });

  it('does not judge before it has a full window', () => {
    const gov = createTierGovernor('high');
    expect(feed(gov, SAMPLE_WINDOW - 1, 100)).toBe(0);
    expect(gov.tier).toBe('high');
  });

  it('tiers down once a full window misses budget', () => {
    const gov = createTierGovernor('high');
    expect(feed(gov, SAMPLE_WINDOW, 40)).toBe(1);
    expect(gov.tier).toBe('medium');
  });

  it('keeps falling while the frames stay bad, then stops at low', () => {
    const gov = createTierGovernor('high');
    feed(gov, SAMPLE_WINDOW * 2, 40);
    expect(gov.tier).toBe('low');
    // Nothing left to give up: no further changes, however bad it gets.
    expect(feed(gov, SAMPLE_WINDOW * 3, 500)).toBe(0);
    expect(gov.tier).toBe('low');
  });

  it('never tiers back up once it has fallen', () => {
    const gov = createTierGovernor('high');
    feed(gov, SAMPLE_WINDOW, 40);
    expect(gov.tier).toBe('medium');
    feed(gov, SAMPLE_WINDOW * 5, 4);
    expect(gov.tier).toBe('medium');
  });

  it('shrugs off isolated spikes, because it judges on the median', () => {
    const gov = createTierGovernor('high');
    // A third of the frames are catastrophic; the median is still comfortable.
    for (let i = 0; i < SAMPLE_WINDOW * 3; i++) gov.sample(i % 3 === 0 ? 400 : 10);
    expect(gov.tier).toBe('high');
  });

  it('is decided by the median sitting either side of the budget', () => {
    const under = createTierGovernor('high');
    feed(under, SAMPLE_WINDOW, FRAME_BUDGET_MS);
    expect(under.tier).toBe('high');

    const over = createTierGovernor('high');
    feed(over, SAMPLE_WINDOW, FRAME_BUDGET_MS + 1);
    expect(over.tier).toBe('medium');
  });

  it('ignores nonsense timings rather than acting on them', () => {
    const gov = createTierGovernor('high');
    expect(feed(gov, SAMPLE_WINDOW * 2, Number.NaN)).toBe(0);
    expect(feed(gov, SAMPLE_WINDOW * 2, -5)).toBe(0);
    expect(feed(gov, SAMPLE_WINDOW * 2, Number.POSITIVE_INFINITY)).toBe(0);
    expect(gov.tier).toBe('high');
  });

  it('starts wherever it is told', () => {
    for (const tier of TIERS) {
      expect(createTierGovernor(tier as Tier).tier).toBe(tier);
    }
  });
});
