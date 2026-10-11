// 2D slice: the density on a plane through the nucleus, facing the camera, so turning the atom
// turns the cut (moppel's Slice mode). One field evaluation per pixel, so it renders at full
// resolution. Thin contour lines mark the 50/75/90/99% regions, the chosen one brightest; the
// Cutaway slider slides the plane off the nucleus.

import * as THREE from 'three';
import { FIELD_GLSL } from '../glsl';
import type { AtomModel } from '../model';
import { THRESHOLDS } from '../model';
import type { QualitySpec, Settings } from '../types';
import { RayExperiment } from './base';

const FRAG = /* glsl */ `
precision highp float;
${FIELD_GLSL}
in vec2 vUv;
uniform vec3 uSliceN;       // plane normal (toward the camera)
uniform float uSliceOffset; // a0 along the normal
uniform float uLogLevel;
uniform float uLogPeak;
uniform vec4 uLogLevels;    // the four thresholds
uniform float uExposure;
uniform float uPhase;
out vec4 fragColor;

void main() {
  vec3 ro, rd;
  cameraRay(vUv, ro, rd);
  float denom = dot(rd, uSliceN);
  float t = (uSliceOffset - dot(ro, uSliceN)) / (abs(denom) < 1e-6 ? -1e-6 : denom);
  vec3 p = ro + rd * t;
  float r = length(p);
  if (t < 0.0 || r > uBound) { fragColor = vec4(0.0); return; }
  vec3 col;
  float d = uPhase > 0.5 ? fieldColor(toPhys(p), col) : fieldDensity(toPhys(p));
  float lg = log(max(d, 1e-30)) * 0.4342945;
  float span = max(uLogPeak - uLogLevel, 1e-3);
  // Shown from a decade below the edge, so the region's surroundings fade in rather than cut.
  float norm = clamp((lg - uLogLevel + 1.0) / (span + 1.0), 0.0, 1.0);
  vec3 c;
  if (uPhase > 0.5) {
    vec3 hue = col / max(d, 1e-30);
    c = hue * pow(norm, 1.6) * 1.25 * uExposure;
  } else {
    c = inferno(pow(norm, 1.0 / max(uExposure, 0.1)));
  }
  // Contours: thin anti-aliased lines where log density crosses each threshold.
  float fw = max(fwidth(lg), 1e-4);
  float lines = 0.0;
  // No lines where the log density swings wildly between pixels (at the nodes).
  for (int k = 0; k < 4; k++) {
    if (fw > 0.25) break;
    float lv = uLogLevels[k];
    float a = 1.0 - smoothstep(0.6, 1.6, abs(lg - lv) / fw);
    lines = max(lines, a * (abs(lv - uLogLevel) < 1e-4 ? 0.9 : 0.28));
  }
  c = mix(c, vec3(1.0), lines * 0.85);
  // Fade the disc's rim into the background.
  // Empty space shows the background rather than the colormap's black.
  float a = clamp(norm * 6.0, 0.0, 1.0) * (1.0 - smoothstep(0.92, 1.0, r / uBound));
  a = max(a, lines * 0.85);
  fragColor = vec4(c * a, a);
}`;

export class Slice extends RayExperiment {
  id = 'slice';
  name = '2D slice';
  description = 'A cut through the nucleus facing you: log density (inferno) or signed ψ, with the 50/75/90/99% contours. Cutaway slides the plane.';
  options = [{ id: 'color', label: 'Color', choices: [{ id: 'block', label: 'Density (inferno)' }, { id: 'phase', label: 'Phase (sign of ψ)' }] }];
  private n = new THREE.Vector3();

  protected fragment(): string { return FRAG; }
  protected extraUniforms() {
    return {
      uSliceN: { value: new THREE.Vector3(0, 0, 1) }, uSliceOffset: { value: 0 }, uLogLevel: { value: -3 }, uLogPeak: { value: 0 },
      uLogLevels: { value: new THREE.Vector4() }, uExposure: { value: 1 }, uPhase: { value: 0 },
    };
  }
  protected volumeOptions() { return { smooth: false }; }
  protected resFor(q: QualitySpec): number { return Math.min(1, q.res * 2); }
  protected stepsFor(): number { return 1; }

  protected refresh(model: AtomModel, s: Settings): void {
    const u = this.uniforms;
    u.uLogLevel.value = Math.log10(model.levels[s.threshold]);
    u.uLogPeak.value = Math.min(Math.log10(model.peak), u.uLogLevel.value + 4);
    (u.uLogLevels.value as THREE.Vector4).set(...(THRESHOLDS.map((t) => Math.log10(model.levels[t])) as [number, number, number, number]));
    u.uExposure.value = s.brightness;
    u.uPhase.value = this.colorMode(s) === 'phase' ? 1 : 0;
    u.uSliceOffset.value = s.cutaway * model.bound * 0.9;
  }

  protected beforeRender(): void {
    this.n.copy(this.ctx.camera.position).normalize();
    (this.uniforms.uSliceN.value as THREE.Vector3).copy(this.n);
  }

  // The slider moves the plane here; it does not cut a wedge.
  protected wedge(): number { return 0; }

  stats(): string { return `1 sample/px · ${this.pass.width}×${this.pass.height}`; }
}
