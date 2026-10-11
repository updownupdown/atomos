// A full-screen ray-march pass rendered into a reduced-resolution target and upscaled onto the
// screen. Cost scales with the target's pixel count, so a quarter of the pixels is roughly a
// quarter of the time; the upscale uses a 4-tap B-spline filter (bicubic-smooth from bilinear
// fetches) so a soft volume shows no blocky pixels. An optional halo blurs the pass at half its
// size again and adds it back: a cheap stand-in for bloom.

import * as THREE from 'three';
import { FULLSCREEN_VERT } from './gl';

const quadGeometry = new THREE.PlaneGeometry(2, 2);
const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new THREE.Mesh(quadGeometry);
quad.frustumCulled = false;

/** Draw a material over the whole current target. */
export function drawFullscreen(renderer: THREE.WebGLRenderer, material: THREE.Material): void {
  quad.material = material;
  renderer.render(quad, orthoCamera);
}

const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uHalo;
uniform vec2 uTexSize;
uniform float uHaloAmount;
uniform float uSmooth;
uniform float uExposure;
uniform float uTone;
out vec4 fragColor;

// Cubic B-spline upsampling from four bilinear taps.
vec4 bspline(sampler2D tex, vec2 uv, vec2 size) {
  vec2 st = uv * size - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (w1 / g0 - 1.0 + i + 0.5) / size;
  vec2 h1 = (w3 / g1 + 1.0 + i + 0.5) / size;
  return g0.y * (g0.x * texture(tex, vec2(h0.x, h0.y)) + g1.x * texture(tex, vec2(h1.x, h0.y)))
       + g1.y * (g0.x * texture(tex, vec2(h0.x, h1.y)) + g1.x * texture(tex, vec2(h1.x, h1.y)));
}

void main() {
  vec4 c = uSmooth > 0.5 ? bspline(uTex, vUv, uTexSize) : texture(uTex, vUv);
  if (uHaloAmount > 0.0) c.rgb += texture(uHalo, vUv).rgb * uHaloAmount;
  c.rgb *= uExposure;
  // Soft shoulder for additive emission: bright cores roll off instead of clipping flat.
  if (uTone > 0.5) c.rgb = 1.0 - exp(-c.rgb);
  // Dither below one 8-bit step against banding in smooth gradients.
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  c.rgb += (n - 0.5) / 255.0;
  fragColor = vec4(max(c.rgb, 0.0), clamp(c.a, 0.0, 1.0));
}`;

const BLUR_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir; // one texel along the blur axis
out vec4 fragColor;
void main() {
  // 9-tap Gaussian folded into 5 bilinear fetches.
  vec4 c = texture(uTex, vUv) * 0.2270270270;
  c += texture(uTex, vUv + uDir * 1.3846153846) * 0.3162162162;
  c += texture(uTex, vUv - uDir * 1.3846153846) * 0.3162162162;
  c += texture(uTex, vUv + uDir * 3.2307692308) * 0.0702702703;
  c += texture(uTex, vUv - uDir * 3.2307692308) * 0.0702702703;
  fragColor = c;
}`;

export interface VolumeOptions {
  halfFloat: boolean;
  /** Add a blurred halo (bloom-like). */
  halo?: boolean;
  /** B-spline upscale (soft); off for crisp surfaces. */
  smooth?: boolean;
  /** Roll bright emission off with 1 - exp(-x). */
  tone?: boolean;
}

export class VolumePass {
  readonly material: THREE.ShaderMaterial | null;
  private target: THREE.WebGLRenderTarget;
  private haloA: THREE.WebGLRenderTarget | null = null;
  private haloB: THREE.WebGLRenderTarget | null = null;
  private composite: THREE.ShaderMaterial;
  private blur: THREE.ShaderMaterial | null = null;
  scale = 0.5;
  width = 1;
  height = 1;

  /** With no fragment shader the pass is an off-screen layer that scenes render into
   *  (renderScene), still upscaled, haloed and tone-mapped on the way to the screen. */
  constructor(fragmentShader: string | null, uniforms: Record<string, THREE.IUniform>, private opts: VolumeOptions) {
    this.material = fragmentShader == null ? null : new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    const type = opts.halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const make = () => new THREE.WebGLRenderTarget(1, 1, {
      type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
    });
    this.target = make();
    if (opts.halo) {
      this.haloA = make();
      this.haloB = make();
      this.blur = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3, vertexShader: FULLSCREEN_VERT, fragmentShader: BLUR_FRAG,
        uniforms: { uTex: { value: null }, uDir: { value: new THREE.Vector2() } },
        depthTest: false, depthWrite: false,
      });
    }
    this.composite = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        uTex: { value: this.target.texture },
        uHalo: { value: this.haloB?.texture ?? null },
        uTexSize: { value: new THREE.Vector2(1, 1) },
        uHaloAmount: { value: opts.halo ? 0.8 : 0 },
        uSmooth: { value: opts.smooth === false ? 0 : 1 },
        uExposure: { value: 1 },
        uTone: { value: opts.tone ? 1 : 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // The pass writes premultiplied color: emission adds, opacity hides the background.
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
  }

  set haloAmount(v: number) { this.composite.uniforms.uHaloAmount.value = this.opts.halo ? v : 0; }
  set exposure(v: number) { this.composite.uniforms.uExposure.value = v; }
  /** B-spline (soft) or bilinear (crisp) upscaling. */
  set smooth(v: boolean) { this.composite.uniforms.uSmooth.value = v ? 1 : 0; }

  /** Size the target for a screen of w x h device pixels at the current scale. */
  resize(w: number, h: number): void {
    this.width = Math.max(1, Math.round(w * this.scale));
    this.height = Math.max(1, Math.round(h * this.scale));
    this.target.setSize(this.width, this.height);
    (this.composite.uniforms.uTexSize.value as THREE.Vector2).set(this.width, this.height);
    if (this.haloA && this.haloB) {
      const hw = Math.max(1, Math.round(this.width / 2)), hh = Math.max(1, Math.round(this.height / 2));
      this.haloA.setSize(hw, hh);
      this.haloB.setSize(hw, hh);
    }
  }

  /** Ray-march into the low-resolution target (and blur the halo). */
  render(renderer: THREE.WebGLRenderer): void {
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    if (this.material) drawFullscreen(renderer, this.material);
    this.finish(renderer);
  }

  /** Render a scene (points, meshes) into the target instead of the ray-march. */
  renderScene(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera): void {
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    this.finish(renderer);
  }

  private finish(renderer: THREE.WebGLRenderer): void {
    if (this.blur && this.haloA && this.haloB) {
      const b = this.blur.uniforms;
      const pass = (src: THREE.Texture, dst: THREE.WebGLRenderTarget, dx: number, dy: number) => {
        b.uTex.value = src;
        (b.uDir.value as THREE.Vector2).set(dx / dst.width, dy / dst.height);
        renderer.setRenderTarget(dst);
        drawFullscreen(renderer, this.blur!);
      };
      // Downsample while blurring, then widen twice.
      pass(this.target.texture, this.haloA, 1, 0);
      pass(this.haloA.texture, this.haloB, 0, 1);
      pass(this.haloB.texture, this.haloA, 2.2, 0);
      pass(this.haloA.texture, this.haloB, 0, 2.2);
    }
    renderer.setRenderTarget(null);
  }

  /** Composite the pass over whatever is on the screen. */
  draw(renderer: THREE.WebGLRenderer): void {
    renderer.setRenderTarget(null);
    drawFullscreen(renderer, this.composite);
  }

  dispose(): void {
    this.material?.dispose();
    this.composite.dispose();
    this.blur?.dispose();
    this.target.dispose();
    this.haloA?.dispose();
    this.haloB?.dispose();
  }
}

/** The scene's background, a near black with a faint warmth (as lisyarus' #121314). */
export const LAB_BG = 0x0b0b0c;
