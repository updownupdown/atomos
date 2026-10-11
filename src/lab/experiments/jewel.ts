// Jewel: the X% boundary surface as cut glass. Fresnel reflection of a soft studio (two
// softboxes on a dark gradient, fixed to the camera so the highlights stay put as it turns),
// a sharp specular glint, and through the surface a refracted ray that marches the inside of
// the orbital and gathers its glow, tinted by the body color. A bloom halo from the bright
// glints finishes it.

import * as THREE from 'three';
import { FIELD_GLSL } from '../glsl';
import type { AtomModel } from '../model';
import type { QualitySpec, Settings } from '../types';
import { COLOR_OPTION, RayExperiment } from './base';
import { SURFACE_GLSL, cameraLight } from './surface';

const FRAG = /* glsl */ `
precision highp float;
${FIELD_GLSL}
${SURFACE_GLSL}
in vec2 vUv;
uniform int uSteps;
uniform int uInner;
uniform vec3 uLight;
uniform mat3 uViewRot; // world to view rotation
uniform float uBrightness;
out vec4 fragColor;

vec3 studio(vec3 d) {
  vec3 c = mix(vec3(0.012, 0.013, 0.016), vec3(0.07, 0.075, 0.09), smoothstep(-0.4, 1.0, d.y));
  c += vec3(1.0, 0.98, 0.95) * smoothstep(0.8, 0.96, dot(d, normalize(vec3(-0.35, 0.8, 0.5)))) * 1.6;
  c += vec3(0.7, 0.82, 1.0) * smoothstep(0.88, 0.99, dot(d, normalize(vec3(0.95, 0.05, 0.3)))) * 0.9;
  c += vec3(1.0, 0.85, 0.7) * smoothstep(0.9, 0.995, dot(d, normalize(vec3(0.2, -0.7, 0.6)))) * 0.35;
  return c;
}

void main() {
  vec3 ro, rd;
  cameraRay(vUv, ro, rd);
  float t0, t1;
  if (!sphereHit(ro, rd, uBound, t0, t1)) { fragColor = vec4(0.0); return; }
  bool cutFace;
  float glow;
  float t = findSurface(ro, rd, t0, t1, uSteps, cutFace, glow);
  if (t < 0.0) {
    // A faint breath of the cloud around the stone.
    float h = 1.0 - exp(-glow * 0.6 / uBound);
    fragColor = vec4(vec3(0.5, 0.55, 0.6) * h * 0.25 * uBrightness, 0.0);
    return;
  }
  vec3 p = ro + rd * t;
  vec3 col;
  float d = fieldColor(toPhys(p), col);
  vec3 body = col / max(d, 1e-30);
  vec3 n = cutFace ? cutNormal(p) : densityNormal(p, max(uBound * 0.002, length(p) * 0.004));
  vec3 v = -rd;
  float cosT = max(dot(n, v), 0.0);
  float F = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
  vec3 refl = studio(uViewRot * reflect(rd, n));
  // Inside: follow the refracted ray and gather the orbital's own glow.
  vec3 rr = refract(rd, n, 1.0 / 1.55);
  if (dot(rr, rr) < 1e-6) rr = rd;
  float e0, e1;
  vec3 inner = vec3(0.0);
  if (sphereHit(p, rr, uBound, e0, e1)) {
    float len = min(e1, uBound * 1.2);
    float dt = len / float(uInner);
    vec3 T = vec3(1.0);
    float j = ign(gl_FragCoord.xy);
    for (int i = 0; i < 128; i++) {
      if (i >= uInner) break;
      vec3 q = p + rr * dt * (float(i) + j);
      vec3 c;
      float dd = fieldColor(toPhys(q), c);
      if (dd <= 0.0) continue;
      vec3 hue = c / dd;
      float x = dd / uLevel;
      // Fire: light from the dense heart of each lobe, not its skin.
      float fire = smoothstep(1.2, 5.0, x) * x / (1.0 + 0.2 * x);
      inner += T * hue * fire * dt * (0.45 / uBound);
      // Inside the stone light is absorbed by color, deepening the hue with depth.
      T *= exp(-(1.0 - hue * 0.9) * step(1.0, x) * dt * (2.5 / uBound));
      if (max(T.r, max(T.g, T.b)) < 0.02) break;
    }
  }
  vec3 h = normalize(uLight + v);
  float glint = pow(max(dot(n, h), 0.0), 160.0) * 3.0;
  // Light piping round the silhouette, in the stone's own color.
  vec3 rim = body * pow(1.0 - cosT, 2.5) * 0.9;
  // A breath of dispersion in the reflections.
  vec3 prism = 0.75 + 0.25 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + cosT * 1.7));
  vec3 c = inner * (1.0 - F) + refl * F * 1.4 * prism + vec3(glint) + rim + body * 0.035;
  if (cutFace) c = body * 0.2 + inner * 0.9;
  fragColor = vec4(c * uBrightness, 1.0);
}`;

export class Jewel extends RayExperiment {
  id = 'jewel';
  name = 'Jewel (glass isosurface)';
  description = 'The X% surface as cut glass: Fresnel reflections of a soft studio, a sharp glint, and the orbital glowing inside through refraction, with a bloom halo.';
  options = [COLOR_OPTION];
  private light = new THREE.Vector3();
  protected autoSmooth = true;
  private rot = new THREE.Matrix3();

  protected fragment(): string { return FRAG; }
  protected extraUniforms() {
    return {
      uLevel: { value: 1 }, uInner: { value: 24 }, uLight: { value: new THREE.Vector3(0, 1, 0) },
      uViewRot: { value: new THREE.Matrix3() }, uBrightness: { value: 1 },
    };
  }
  protected volumeOptions() { return { smooth: false, halo: true, tone: false }; }
  protected resFor(q: QualitySpec): number { return Math.min(1, q.res * 1.2); }
  protected stepsFor(q: QualitySpec): number { return Math.round(q.steps * 1.5); }

  protected refresh(model: AtomModel, s: Settings): void {
    this.uniforms.uLevel.value = model.levels[s.threshold];
    this.uniforms.uBrightness.value = s.brightness;
    this.uniforms.uInner.value = Math.max(12, Math.round(QUALITY_INNER[s.quality]));
    this.pass.haloAmount = 0.35;
  }

  protected beforeRender(): void {
    const cam = this.ctx.camera;
    cameraLight(cam, this.light);
    (this.uniforms.uLight.value as THREE.Vector3).copy(this.light);
    cam.updateMatrixWorld();
    (this.uniforms.uViewRot.value as THREE.Matrix3).copy(this.rot.setFromMatrix4(cam.matrixWorldInverse));
  }

  stats(): string {
    return `${this.steps}+${this.uniforms.uInner.value} steps · ${this.pass.width}×${this.pass.height}`;
  }
}

const QUALITY_INNER: Record<Settings['quality'], number> = { low: 14, medium: 24, high: 36, ultra: 56 };
