import * as THREE from 'three';
import { noise } from './shaders.js';

/*
 * Final full-screen pass. Composites up to two scenes so they can be
 * crossed with a liquid wipe, and adds speed blur, a splash distortion
 * when the camera breaks the surface, and a soft vignette.
 */
const frag = /* glsl */ `
  uniform sampler2D tA;
  uniform sampler2D tB;
  uniform float uMix;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uSplash;
  uniform vec2 uRes;
  varying vec2 vUv;
  ${noise}

  vec3 blurSample(sampler2D t, vec2 uv) {
    vec2 dir = (uv - 0.5) * uSpeed * 0.07;
    vec3 c = vec3(0.0);
    for (int i = 0; i < 8; i++) c += texture2D(t, uv - dir * float(i) / 7.0).rgb;
    return c / 8.0;
  }

  void main() {
    vec2 uv = vUv;
    vec2 asp = vec2(uRes.x / uRes.y, 1.0);

    // water sheeting across the lens as the camera goes under
    if (uSplash > 0.001) {
      vec2 q = uv * vec2(3.0, 5.0) + vec2(0.0, uTime * 0.8);
      vec2 warp = vec2(fbm(q), fbm(q + 7.3)) - 0.5;
      uv += warp * 0.06 * uSplash;
    }

    // liquid wipe: B grows out from the centre along a noisy, refracting edge
    float d = length((vUv - 0.5) * asp);
    float n = fbm(vUv * 3.5 + uTime * 0.15);
    float front = uMix * 1.45;
    float m = 1.0 - smoothstep(front - 0.16, front, d + (n - 0.5) * 0.45);
    if (uMix <= 0.0) m = 0.0;
    if (uMix >= 1.0) m = 1.0;
    float edge = m * (1.0 - m) * 4.0;
    vec2 off = (vec2(n, fbm(vUv * 3.5 - 4.0)) - 0.5) * 0.12 * edge;

    vec3 a = m < 1.0 ? blurSample(tA, uv + off) : vec3(0.0);
    vec3 b = m > 0.0 ? blurSample(tB, uv - off) : vec3(0.0);
    vec3 col = mix(a, b, m);
    col += vec3(0.35, 0.7, 0.9) * edge * 0.18;
    col *= 1.0 + uSplash * 0.15;

    float vig = smoothstep(1.15, 0.35, length((vUv - 0.5) * vec2(1.0, 1.15)));
    col *= mix(1.0, vig, 0.38);

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const vert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export class Post {
  constructor(renderer, shared) {
    this.renderer = renderer;
    const opts = { type: THREE.HalfFloatType, samples: 4 };
    this.a = new THREE.WebGLRenderTarget(1, 1, opts);
    this.b = new THREE.WebGLRenderTarget(1, 1, opts);
    this.uniforms = {
      tA: { value: this.a.texture },
      tB: { value: this.b.texture },
      uMix: { value: 0 },
      uTime: shared.uTime,
      uSpeed: { value: 0 },
      uSplash: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
    };
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, depthTest: false, depthWrite: false }),
    );
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h, dpr) {
    this.a.setSize(Math.round(w * dpr), Math.round(h * dpr));
    this.b.setSize(Math.round(w * dpr), Math.round(h * dpr));
    this.uniforms.uRes.value.set(w, h);
  }

  /** Render scene A and/or B, then composite to the screen. */
  render(sceneA, camA, sceneB, camB, mix) {
    const r = this.renderer;
    const m = THREE.MathUtils.clamp(mix, 0, 1);
    if (m < 1 && sceneA) { r.setRenderTarget(this.a); r.render(sceneA, camA); }
    if (m > 0 && sceneB) { r.setRenderTarget(this.b); r.render(sceneB, camB); }
    r.setRenderTarget(null);
    this.uniforms.uMix.value = m;
    r.render(this.scene, this.camera);
  }
}
