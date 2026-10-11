// Small GL pieces shared by the app's atom renderers and the visualization lab: the
// full-screen vertex shader, pure additive blending, the soft point sprite and the neon skins
// of "Probability shells (neon)".

import * as THREE from 'three';

export const FULLSCREEN_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** Pure additive blending (ONE, ONE): shaders write premultiplied light and alpha 0, so the
 *  background is never darkened. three's AdditiveBlending scales by source alpha instead. */
export const ADD_BLEND = {
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;

/** A round, soft point: a Gaussian falloff inside the sprite, light only (alpha 0). */
export const POINT_FRAG = /* glsl */ `
precision highp float;
in vec3 vColor;
in float vAlpha;
out vec4 fragColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c, c) * 4.0;
  if (d2 > 1.0) discard;
  float a = exp(-d2 * 3.5) * vAlpha;
  fragColor = vec4(vColor * a, 0.0);
}`;

/**
 * Neon skins: light only near a few boundaries of a density, in log10 density, so a blob
 * reads as nested glowing skins, brightest where a ray grazes them (edge-on the path through
 * a skin is longest: a soap-bubble Fresnel for free). `levels` are the log10 densities of the
 * skins, `weights` their strengths, `width` their thickness in decades.
 */
export const NEON_GLSL = /* glsl */ `
float neonSkins(float lg, vec4 levels, vec4 weights, float width) {
  vec4 z = (vec4(lg) - levels) / width;
  vec4 g = exp(-z * z) * weights;
  return g.x + g.y + g.z + g.w;
}`;

/**
 * The same neon skins for a round Gaussian blob, integrated along a ray in closed form, so a
 * small sphere (a nucleon) needs no ray march. For a Gaussian, log density falls with r², so a
 * skin is exp(-((r² - k²) / w)²) for a skin at radius k (units of the blob's radius) and a
 * thickness w (in r²). Along a ray passing the center at distance b, r² = b² + s², and the
 * light through one skin is the integral over s: about √π w / √q for q = k² - b² well above w,
 * peaking at q = 0 where the ray grazes the skin (edge-on), and gone once it misses.
 * `neonChord(b2, k, weights, w)` sums four skins at radii k.xyzw for a ray at b² = b2.
 */
export const NEON_CHORD_GLSL = /* glsl */ `
float neonSkinChord(float q, float w) {
  // Exact at q = 0 (w^½ Γ(¼) / 2), the √π w / √q tail above, a Gaussian falloff below.
  return q >= 0.0 ? 1.7725 * w / sqrt(q + 0.956 * w) : 1.8128 * sqrt(w) * exp(-(q * q) / (w * w));
}
float neonChord(float b2, vec4 k, vec4 weights, float w) {
  vec4 q = k * k - vec4(b2);
  return weights.x * neonSkinChord(q.x, w) + weights.y * neonSkinChord(q.y, w)
       + weights.z * neonSkinChord(q.z, w) + weights.w * neonSkinChord(q.w, w);
}`;
