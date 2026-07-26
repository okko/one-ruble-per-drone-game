/**
 * The sky dome, the sun/moon disc, the stars and the image-based lighting they produce
 * (docs/areas/11-art-visual-style.md §3.5).
 *
 * The sky used to be one flat `MeshBasicMaterial` on a sphere, which is why the world read as a
 * diorama on a coloured card: a real sky is a gradient, and the eye reads that gradient as distance.
 * Everything here is a shader over that one sphere — no textures, no assets, one draw call — and
 * every part of it is driven by the same `LightRig` that drives the actual lights, so the painted sun
 * and the light casting the shadows are the same object by construction and cannot drift apart.
 *
 * This module needs a GL context, so it is out of the coverage gate by the standing rule. All of its
 * arithmetic lives in the pure `./lighting`, which is gated.
 */
import * as THREE from 'three';

import { envStepFor, type LightRig } from './lighting';
import type { TierPolicy } from './quality';
import { colorOf, mixInto, type WorldColorKey } from './theme';

/** Radius of the dome. Inside the camera's far plane (400) and well outside anything in the world. */
const SKY_RADIUS = 220;

/** Angular radius of the sun/moon disc, in radians. Roughly four times life size — it is a character. */
const DISC_SIZE = 0.035;

/**
 * The three vertical stops, horizon → zenith, for each end of the day.
 *
 * Night runs violet → deep blue → near-black rather than simply dimming the day stops, because a
 * darkened blue sky reads as an overcast afternoon, not as night. `ink` at the zenith is the same
 * colour the world's outlines use, so the top of the sky and the darkest thing in the scene agree.
 */
const DAY_STOPS: readonly WorldColorKey[] = ['skyDayLow', 'skyDayMid', 'skyDayTop'];
const NIGHT_STOPS: readonly WorldColorKey[] = ['skyNightMid', 'skyNightTop', 'ink'];

const SKY_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * The dome's fragment shader.
 *
 * Note it writes LINEAR colour and never tone maps: the composer's `OutputPass` owns that, once, at
 * the end. Values above 1 are deliberate — the sun's core is an HDR value so that bloom has
 * something real to bleed, rather than the flat white a clamped buffer would give it.
 */
const SKY_FRAG = /* glsl */ `
varying vec3 vWorld;

uniform vec3 uLow;
uniform vec3 uMid;
uniform vec3 uTop;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uNight;
uniform float uDiscInner;
uniform float uDiscOuter;

// Cheap hash for the star field. Not a good random number generator; it does not need to be, it
// needs to be stable per direction so stars hold still while the camera moves.
#ifdef RICH_SKY
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
#endif

void main() {
  vec3 dir = normalize(vWorld);

  // Vertical ramp. h is 0 at the horizon and 1 overhead; the sqrt shapes it so most of the gradient
  // happens in the lower sky, which is where a real one puts it. sqrt rather than pow(h, 0.55): the
  // curve is indistinguishable and it is one hardware instruction instead of two transcendentals,
  // which on a software rasteriser is the difference between a sky and a slideshow.
  float h = clamp(dir.y, 0.0, 1.0);
  float shaped = sqrt(h);
  vec3 sky = shaped < 0.5
    ? mix(uLow, uMid, shaped * 2.0)
    : mix(uMid, uTop, (shaped - 0.5) * 2.0);

  // The disc, straight from the key light's own direction. The two edge cosines are computed on the
  // CPU: they depend only on uniforms, and a fragment shader is the wrong place to pay for a cos.
  // Every tier gets this much — it is a dot and a smoothstep, and a sky with no sun in it is a wall.
  float cosAngle = dot(dir, uSunDir);
  sky += uSunColor * smoothstep(uDiscOuter, uDiscInner, cosAngle) * 3.0;

#ifdef RICH_SKY
  // Stars. Quantising the direction gives a fixed cell per patch of sky; only a few cells light up,
  // and they fade out entirely before dawn so they can never be seen in daylight.
  float starFade = smoothstep(0.35, 0.85, uNight);
  if (starFade > 0.0) {
    vec3 cell = floor(dir * 260.0);
    float n = hash(cell);
    float star = smoothstep(0.9955, 1.0, n) * (0.4 + hash(cell + 3.7) * 0.6);
    sky += star * starFade * (0.35 + h * 0.65);
  }

  // A wide, faint halo. This is what actually sells a sun — the disc alone reads as a sticker. It is
  // also the one genuinely expensive line in here, so it is the first thing a weak machine loses.
  sky += uSunColor * pow(max(cosAngle, 0.0), 12.0) * 0.06;
#endif

  gl_FragColor = vec4(sky, 1.0);

  // The same two chunks every built-in material ends with. three switches both off automatically
  // when the destination is a render target, so this one shader is correct on BOTH paths: linear
  // into the composer, where OutputPass resolves it, and tone mapped straight to the canvas on the
  // low tier, where there is no composer to do it. Without them the sky is the one object in the
  // scene rendering in the wrong colour space, and only on the machines least able to spare it.
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface Sky {
  /**
   * Feed the same rig the lights get, plus the key light's world direction and the live tier policy.
   *
   * The policy is passed per frame rather than fixed at construction because the frame-time governor
   * can demote a machine mid-run: a device that turns out not to afford the sky it was given has to
   * be able to hand it back.
   */
  update(rig: LightRig, sunDir: THREE.Vector3, policy: TierPolicy): void;
  dispose(): void;
}

/** Build the dome and its environment lighting, and add both to `scene`. */
export function createSky(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Sky {
  const uniforms = {
    uLow: { value: colorOf('skyDayLow').clone() },
    uMid: { value: colorOf('skyDayMid').clone() },
    uTop: { value: colorOf('skyDayTop').clone() },
    uSunColor: { value: colorOf('sunNoon').clone() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uNight: { value: 0 },
    uDiscInner: { value: Math.cos(DISC_SIZE) },
    uDiscOuter: { value: Math.cos(DISC_SIZE * 1.6) },
  };

  const geometry = new THREE.SphereGeometry(SKY_RADIUS, 32, 20);
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  // Depth state is left entirely alone, and that is load-bearing. Forcing the dome to draw first
  // with depth writes off makes it shade every pixel on the screen and then be overdrawn by the
  // world; sorted normally it is depth-rejected wherever anything stands in front of it. On a
  // software rasteriser that difference was measured costing whole frames.
  scene.add(mesh);

  // ---- Image-based lighting -----------------------------------------------------------------
  // A cube-camera bake of the dome itself, prefiltered into a roughness mip chain. Without it every
  // `MeshStandardMaterial` gets its ambient from the hemisphere light alone, which is a single flat
  // term: metal has nothing to reflect and reads as grey plastic whatever its roughness says.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  // The bake reads the same dome, so the light in the scene is the light in the sky by construction.
  const envDome = new THREE.Mesh(geometry, material);
  envDome.frustumCulled = false;
  envScene.add(envDome);

  let envTarget: THREE.WebGLRenderTarget | null = null;
  let bakedStep = -1;
  let rich = false;

  function bakeEnvironment(step: number): void {
    const next = pmrem.fromScene(envScene);
    // Dispose only AFTER the new one exists: `scene.environment` must never point at a freed
    // texture, not even for the length of a statement.
    envTarget?.dispose();
    envTarget = next;
    scene.environment = next.texture;
    bakedStep = step;
  }

  function dropEnvironment(): void {
    if (!envTarget) return;
    scene.environment = null;
    envTarget.dispose();
    envTarget = null;
    bakedStep = -1;
  }

  function update(rig: LightRig, sunDir: THREE.Vector3, policy: TierPolicy): void {
    const night = rig.night;
    // `mixInto` writes into the uniform's own colour, so a frame allocates nothing (§7).
    for (const [i, uniform] of [uniforms.uLow, uniforms.uMid, uniforms.uTop].entries()) {
      const day = DAY_STOPS[i];
      const dark = NIGHT_STOPS[i];
      if (day && dark) mixInto(uniform.value, day, dark, night);
    }
    mixInto(uniforms.uSunColor.value, rig.keyColor.from, rig.keyColor.to, rig.keyColor.t);
    uniforms.uSunDir.value.copy(sunDir);
    uniforms.uNight.value = night;

    if (policy.richSky !== rich) {
      rich = policy.richSky;
      material.defines = rich ? { RICH_SKY: '' } : {};
      material.needsUpdate = true; // recompiles; only ever on a tier change, never per frame
    }

    if (!policy.environment) {
      dropEnvironment();
      return;
    }
    const step = envStepFor(rig.sunElevation);
    if (step !== bakedStep) bakeEnvironment(step);
  }

  function dispose(): void {
    scene.remove(mesh);
    envScene.remove(envDome);
    dropEnvironment();
    pmrem.dispose();
    geometry.dispose();
    material.dispose();
  }

  return { update, dispose };
}
