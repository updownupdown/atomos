// Finding the boundary surface {rho = level} along a ray, shared by the lab's solid and jewel
// experiments and the app's Solid style (render/rayLooks.ts): a coarse march whose step shrinks
// near the nucleus (structure there is finer, as moppel's solid mode does), then bisection to
// sub-step precision. The cutaway counts as outside, and a hit whose last outside point lies in
// the cut is reported as a cut face.

import * as THREE from 'three';

export const SURFACE_GLSL = /* glsl */ `
uniform float uLevel;

bool insideAt(vec3 p) { return !cutAway(p) && fieldDensity(toPhys(p)) >= uLevel; }

// First entry into the region along the ray, or -1. cutFace: entered through the cutaway.
// glow collects the density seen on the way in (relative to the level), for a soft halo.
float findSurface(vec3 ro, vec3 rd, float t0, float t1, int steps, out bool cutFace, out float glow) {
  cutFace = false;
  glow = 0.0;
  float dtMax = (t1 - t0) / float(steps);
  float dtMin = dtMax * 0.06;
  float t = t0 + dtMin * ign(gl_FragCoord.xy);
  float prevT = t0;
  for (int i = 0; i < 1200; i++) {
    if (t > t1 || i >= steps * 4) break;
    vec3 p = ro + rd * t;
    bool cut = cutAway(p);
    float d = cut ? 0.0 : fieldDensity(toPhys(p));
    float stepLen = clamp(0.05 * length(p), dtMin, dtMax);
    if (d >= uLevel) {
      float lo = prevT, hi = t;
      for (int b = 0; b < 10; b++) {
        float mid = 0.5 * (lo + hi);
        if (insideAt(ro + rd * mid)) hi = mid; else lo = mid;
      }
      cutFace = cutAway(ro + rd * lo);
      return hi;
    }
    glow += d / uLevel * stepLen;
    prevT = t;
    t += stepLen;
  }
  return -1.0;
}

vec3 densityNormal(vec3 p, float eps) {
  vec3 e = vec3(eps, 0.0, 0.0);
  float dx = fieldDensity(toPhys(p + e.xyy)) - fieldDensity(toPhys(p - e.xyy));
  float dy = fieldDensity(toPhys(p + e.yxy)) - fieldDensity(toPhys(p - e.yxy));
  float dz = fieldDensity(toPhys(p + e.yyx)) - fieldDensity(toPhys(p - e.yyx));
  vec3 g = vec3(dx, dy, dz);
  return length(g) > 0.0 ? -normalize(g) : -normalize(p);
}

// Outward normal of the cut face at p (pointing into the removed wedge).
vec3 cutNormal(vec3 p) {
  vec2 h = normalize(p.xz + 1e-6);
  vec2 n = uCutDir.xz - dot(uCutDir.xz, h) * h;
  return length(n) > 1e-4 ? vec3(normalize(n), 0.0).xzy : uCutDir;
}
`;

/** A key light fixed to the camera (upper right, a little in front), in scene space. */
export function cameraLight(camera: THREE.Camera, out: THREE.Vector3): THREE.Vector3 {
  return out.set(0.55, 0.7, 0.45).normalize().applyQuaternion(camera.quaternion);
}
