/**
 * The post-processing chain (docs/areas/11-art-visual-style.md §3.6).
 *
 * The scene is rendered into a half-float linear buffer, worked on while it is still HDR, and only
 * converted to sRGB at the very end by `OutputPass` — which is also where `renderer.toneMapping`
 * is applied. That ordering is the whole point: bloom and grading on already-clamped, already-
 * gamma-encoded pixels is what makes a stylised game look like a screenshot with a filter on it.
 *
 * Order: `RenderPass` → GTAO (high tier only) → bloom → grade/vignette → SMAA → `OutputPass`.
 *
 * This module is **loaded on demand** by `view.ts` and is deliberately the only place the
 * post-processing addons are imported. They are bulky — SMAA alone carries two base64 lookup
 * textures — and a device on the low tier, or a player who has asked for `reducedFlash`, must never
 * pay to download a chain it will not run. Until (or unless) the chunk arrives, the view renders
 * directly; nothing waits on it.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { TierPolicy } from './quality';

/**
 * The permanent grade: a gentle vignette, a touch of saturation, and a soft shoulder.
 *
 * Everything here is deliberately small. §3.6 is explicit that the grade is subtle and permanent,
 * and §3.1 that readability beats fidelity — a drone is a small dark shape against a bright sky, and
 * a heavy vignette would hide the ones that matter most, the ones coming in from the edges. So the
 * vignette does not begin until well outside the action, and never reaches black.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    vignetteStart: { value: 0.55 },
    vignetteStrength: { value: 0.22 },
    saturation: { value: 1.06 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float vignetteStart;
    uniform float vignetteStrength;
    uniform float saturation;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = texel.rgb;

      // Saturation about Rec.709 luma, so the boost does not shift brightness.
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, saturation);

      // Vignette measured from the frame centre in aspect-independent UV. It starts outside the
      // region drones are fought in, and bottoms out at a multiplier, never at zero.
      float d = distance(vUv, vec2(0.5));
      float v = smoothstep(vignetteStart, 0.85, d);
      c *= 1.0 - v * vignetteStrength;

      gl_FragColor = vec4(c, texel.a);
    }
  `,
};

export interface PostChain {
  /** True when a composer is in use; false when this is the direct pass-through. */
  readonly composited: boolean;
  /** Draw one frame. */
  render(): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  dispose(): void;
}

export function createPostChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  policy: TierPolicy,
  size: { width: number; height: number; pixelRatio: number },
): PostChain {
  const width = Math.max(1, size.width);
  const height = Math.max(1, size.height);

  // Half-float so the buffer can carry values above 1.0 all the way to OutputPass. Without this,
  // every highlight clips at white before bloom ever sees it and the threshold has nothing to find.
  const target = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    samples: policy.antialias ? 0 : 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(size.pixelRatio);
  composer.setSize(width, height);

  composer.addPass(new RenderPass(scene, camera));

  let gtao: GTAOPass | null = null;
  if (policy.ambientOcclusion) {
    gtao = new GTAOPass(scene, camera, width, height);
    // Tuned against the world's scale, where a man is SOLDIER_H = 0.58 units tall: the radius is
    // about a sandbag, so the effect settles into creases and under the parapet instead of drawing a
    // dark halo around the whole rooftop.
    gtao.updateGtaoMaterial({ radius: 0.25, distanceExponent: 1, thickness: 1, scale: 1, samples: 16 });
    gtao.blendIntensity = 0.65;
    composer.addPass(gtao);
  }

  let bloom: UnrealBloomPass | null = null;
  if (policy.bloom) {
    // Restrained (§3.6): a high threshold so only genuinely hot things — the muzzle flash, tracers,
    // lit windows at night — bloom at all, and the sky does not turn to soup.
    bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.35, 0.6, 0.9);
    composer.addPass(bloom);
  }

  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);

  let smaa: SMAAPass | null = null;
  if (policy.antialias) {
    smaa = new SMAAPass();
    composer.addPass(smaa);
  }

  // Last, always: tone maps from the linear HDR buffer and encodes to the canvas's sRGB.
  const output = new OutputPass();
  composer.addPass(output);

  return {
    composited: true,
    render() {
      composer.render();
    },
    setSize(w: number, h: number, pixelRatio: number) {
      const cw = Math.max(1, w);
      const ch = Math.max(1, h);
      composer.setPixelRatio(pixelRatio);
      composer.setSize(cw, ch);
      bloom?.setSize(cw, ch);
      gtao?.setSize(cw, ch);
      smaa?.setSize(cw, ch);
    },
    dispose() {
      // Passes hold render targets and materials of their own; the composer only owns its two
      // buffers. Leaking these is how a tier change quietly doubles GPU memory.
      gtao?.dispose();
      bloom?.dispose();
      smaa?.dispose();
      grade.dispose();
      output.dispose();
      composer.dispose();
      target.dispose();
    },
  };
}
