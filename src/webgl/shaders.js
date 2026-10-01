export const noise = /* glsl */ `
  vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 6; i++) { v += a * vnoise(p); p = r * p * 2.03; a *= 0.5; }
    return v;
  }
`;

/* Sky dome with drifting procedural clouds */
export const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w;
  }
`;

export const skyFrag = /* glsl */ `
  uniform float uTime;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform sampler2D uSky;
  uniform float uHasSky;
  varying vec3 vDir;
  ${noise}
  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.y, 0.0);
    vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));

    vec2 uv = d.xz / (d.y + 0.08) * 1.4 + vec2(uTime * 0.012, uTime * 0.004);
    float c = fbm(uv);
    c = smoothstep(0.42, 0.78, c + 0.08 * fbm(uv * 3.0 - uTime * 0.02));
    float shade = fbm(uv * 1.7 + 4.0);
    vec3 cloud = mix(vec3(0.62, 0.72, 0.82), vec3(0.97, 0.98, 1.0), shade);
    float fade = smoothstep(0.0, 0.25, h);
    col = mix(col, cloud, c * fade * 0.92);
    col = mix(col, uHorizon * 1.08, (1.0 - smoothstep(0.0, 0.05, h)) * 0.6);

    if (uHasSky > 0.5) {
      // photo covers the front half of the dome and is mirrored behind
      float t = atan(d.x, -d.z) / 3.14159265 + uTime * 0.0015;
      float u = 0.5 + t;
      u = u > 1.0 ? 2.0 - u : (u < 0.0 ? -u : u);
      float e = asin(clamp(d.y, 0.0, 1.0)) / 1.5707963;
      float v = min(0.045 + pow(e, 0.85) * 1.1, 0.995);
      vec3 photo = texture2D(uSky, vec2(u, v)).rgb;
      col = mix(uHorizon * 1.05, photo, smoothstep(0.0, 0.03, h));
    }
    gl_FragColor = vec4(col, 1.0);
    gl_FragColor.rgb = toLinear(gl_FragColor.rgb);
  }
`;

/* Ocean surface — summed travelling waves with analytic normals */
const waves = /* glsl */ `
  uniform float uTime;
  const int N = 6;
  vec3 wave(vec2 p, out vec3 n) {
    vec4 W[N];
    W[0] = vec4(normalize(vec2(1.0, 0.25)), 0.050, 0.55);
    W[1] = vec4(normalize(vec2(0.7, 1.0)),  0.085, 0.32);
    W[2] = vec4(normalize(vec2(-0.4, 1.0)), 0.140, 0.18);
    W[3] = vec4(normalize(vec2(1.0, -0.7)), 0.230, 0.10);
    W[4] = vec4(normalize(vec2(-1.0, 0.3)), 0.370, 0.06);
    W[5] = vec4(normalize(vec2(0.2, -1.0)), 0.610, 0.035);
    float h = 0.0; vec2 g = vec2(0.0);
    for (int i = 0; i < N; i++) {
      float k = W[i].z, a = W[i].w;
      float ph = dot(W[i].xy, p) * k + uTime * sqrt(9.8 * k) * 0.9;
      h += a * sin(ph);
      g += a * k * cos(ph) * W[i].xy;
    }
    n = normalize(vec3(-g.x, 1.0, -g.y));
    return vec3(p.x, h, p.y);
  }
`;

export const oceanVert = /* glsl */ `
  ${waves}
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec3 n;
    vec3 p = wave(wp.xz, n);
    vWorld = p;
    vNormal = n;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const volumeColor = /* glsl */ `
  vec3 volumeColor(vec3 d, vec3 water, vec3 abyss, float depth) {
    float up = d.y * 0.5 + 0.5;
    vec3 top = mix(water * 1.5, water, smoothstep(0.0, 1.0, depth));
    return mix(abyss, top, pow(up, 1.6));
  }
`;

export const oceanFrag = /* glsl */ `
  uniform float uTime;
  uniform vec3 uAbyss;
  uniform float uDepth;
  ${volumeColor}
  uniform vec3 uSun;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uWater;
  varying vec3 vWorld;
  varying vec3 vNormal;
  ${noise}
  vec3 detail(vec2 p) {
    float e = 0.15;
    vec2 q = p * 0.9 + vec2(uTime * 0.35, uTime * 0.2);
    float a = fbm(q), b = fbm(q + vec2(e, 0.0)), c = fbm(q + vec2(0.0, e));
    return vec3(a - b, 0.0, a - c) * 1.6;
  }
  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    float dist = length(cameraPosition - vWorld);
    vec3 N = normalize(vNormal + detail(vWorld.xz) * exp(-dist * 0.012));

    if (gl_FrontFacing) {
      float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
      vec3 R = reflect(-V, N);
      vec3 sky = mix(uHorizon, uZenith, pow(max(R.y, 0.0), 0.5));
      float sss = pow(max(dot(V, -uSun) * 0.5 + 0.5, 0.0), 3.0) * max(vWorld.y + 0.6, 0.0);
      vec3 water = mix(uDeep, uShallow, clamp(sss * 0.6 + 0.15, 0.0, 1.0));
      vec3 col = mix(water, sky, clamp(fres * 1.15, 0.0, 1.0));
      float spec = pow(max(dot(R, uSun), 0.0), 220.0);
      col += vec3(1.0, 0.97, 0.9) * spec * 2.5;
      float haze = 1.0 - exp(-dist * 0.0035);
      col = mix(col, uHorizon, haze * 0.85);
      gl_FragColor = vec4(col, 1.0);
      gl_FragColor.rgb = toLinear(gl_FragColor.rgb);
    } else {
      // seen from below: bright Snell's window, total internal reflection outside it
      vec3 Nd = -N;
      float c = max(dot(V, Nd), 0.0);
      float window = smoothstep(0.62, 0.8, c);
      vec3 tir = uWater * 1.35;
      vec3 through = mix(uShallow * 1.6, vec3(0.75, 0.92, 1.0), 0.55);
      float ripple = fbm(vWorld.xz * 0.6 + uTime * 0.25);
      vec3 col = mix(tir, through, window) + ripple * 0.12 * window;
      float fog = 1.0 - exp(-dist * 0.02);
      col = mix(col, volumeColor(-V, uWater, uAbyss, uDepth), fog);
      gl_FragColor = vec4(col, 1.0);
      gl_FragColor.rgb = toLinear(gl_FragColor.rgb);
    }
  }
`;

/* Water volume surrounding the camera once submerged */
export const volumeVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w;
  }
`;

export const volumeFrag = /* glsl */ `
  uniform vec3 uWater;
  uniform vec3 uAbyss;
  uniform float uDepth;
  uniform float uTime;
  varying vec3 vDir;
  ${noise}
  ${volumeColor}
  void main() {
    vec3 d = normalize(vDir);
    float up = d.y * 0.5 + 0.5;
    vec3 col = volumeColor(d, uWater, uAbyss, uDepth);
    float shafts = fbm(vec2(atan(d.x, d.z) * 6.0, uTime * 0.05)) * smoothstep(0.45, 1.0, up);
    col += shafts * 0.08 * (1.0 - uDepth * 0.7);
    gl_FragColor = vec4(col, 1.0);
    gl_FragColor.rgb = toLinear(gl_FragColor.rgb);
  }
`;

/* Particle currents: flowing ribbons evaluated analytically on the GPU */
export const currentVert = /* glsl */ `
  uniform float uTime;
  uniform float uPixel;
  uniform float uReveal;
  uniform vec3 uMouse;
  attribute vec4 aSeed;    // t, band, depth jitter, speed
  attribute float aRibbon;
  varying float vAlpha;
  varying float vTint;

  vec3 path(float t, float r) {
    float ph = r * 2.17;
    float x = mix(-140.0, 140.0, t);
    float y = sin(t * 5.2 + ph + uTime * 0.12) * (9.0 + r * 3.0) + sin(t * 11.0 - uTime * 0.2 + r) * 3.0;
    float z = cos(t * 3.4 + ph * 1.3 + uTime * 0.08) * 22.0 - 55.0 - r * 12.0;
    return vec3(x, y + (r - 1.5) * 6.0, z);
  }

  void main() {
    float t = fract(aSeed.x + uTime * aSeed.w);
    vec3 p = path(t, aRibbon);
    vec3 ahead = path(t + 0.002, aRibbon);
    vec3 tng = normalize(ahead - p);
    vec3 side = normalize(cross(tng, vec3(0.0, 0.2, 1.0)));
    vec3 up = normalize(cross(side, tng));
    float twist = t * 9.0 + uTime * 0.3 + aRibbon;
    float w = aSeed.y * (5.0 + 3.0 * sin(t * 7.0 + aRibbon));
    p += (side * cos(twist) + up * sin(twist)) * w;
    p += up * aSeed.z * 0.6;

    vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz;
    vec3 away = wp - uMouse;
    float md = length(away);
    wp += normalize(away) * smoothstep(14.0, 0.0, md) * 4.0;

    vec4 mv = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mv;
    float edge = smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.92, t);
    float core = 1.0 - abs(aSeed.y);
    vAlpha = edge * (0.25 + 0.75 * core) * uReveal;
    vTint = aSeed.z;
    gl_PointSize = uPixel * (0.8 + core * 1.6) * (48.0 / -mv.z);
  }
`;

export const currentFrag = /* glsl */ `
  vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
  varying float vAlpha;
  varying float vTint;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    vec3 col = mix(vec3(0.35, 0.75, 1.0), vec3(0.6, 1.0, 0.95), vTint * 0.5 + 0.5);
    gl_FragColor = vec4(col, a * vAlpha);
    gl_FragColor.rgb = toLinear(gl_FragColor.rgb);
  }
`;

/* Ambient suspended particles */
export const dustVert = /* glsl */ `
  uniform float uTime;
  uniform float uPixel;
  uniform float uReveal;
  attribute vec3 aRand;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.y += mod(uTime * aRand.x * 0.6 + aRand.y * 40.0, 40.0) - 20.0;
    p.x += sin(uTime * 0.3 + aRand.z * 6.28) * 1.5;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uPixel * (0.6 + aRand.z) * (30.0 / -mv.z);
    vAlpha = uReveal * (0.3 + 0.5 * aRand.y) * smoothstep(120.0, 20.0, -mv.z);
  }
`;

export const dustFrag = /* glsl */ `
  vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(0.75, 0.92, 1.0, smoothstep(0.5, 0.1, d) * vAlpha);
    gl_FragColor.rgb = toLinear(gl_FragColor.rgb);
  }
`;

/* Light shafts from the surface */
export const rayVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const rayFrag = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform float uReveal;
  varying vec2 vUv;
  ${noise}
  void main() {
    float x = vUv.x;
    float streak = smoothstep(0.0, 0.5, x) * smoothstep(1.0, 0.5, x);
    float flick = 0.55 + 0.45 * vnoise(vec2(uTime * 0.4 + uSeed * 10.0, x * 4.0));
    float fall = pow(vUv.y, 1.6);
    gl_FragColor = vec4(vec3(0.6, 0.88, 1.0), streak * flick * fall * 0.16 * uReveal);
    gl_FragColor.rgb = toLinear(gl_FragColor.rgb);
  }
`;

/* Bubbles that stream upward past the camera during a dive */
export const bubbleVert = /* glsl */ `
  uniform float uTime;
  uniform float uPixel;
  uniform float uAmount;
  attribute vec3 aRand;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    float h = 16.0;
    p.y = mod(aRand.x * h + uTime * (3.0 + aRand.y * 5.0), h) - h * 0.5;
    p.x += sin(uTime * 3.0 + aRand.z * 20.0) * 0.15;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uPixel * (2.0 + aRand.z * 6.0) * (12.0 / -mv.z);
    vAlpha = uAmount * (0.4 + 0.6 * aRand.y);
  }
`;

export const bubbleFrag = /* glsl */ `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float ring = smoothstep(0.5, 0.42, d) * (0.35 + smoothstep(0.25, 0.45, d));
    float glint = smoothstep(0.14, 0.0, length(gl_PointCoord - vec2(0.35, 0.32)));
    gl_FragColor = vec4(vec3(0.75, 0.95, 1.0), (ring + glint) * vAlpha);
  }
`;
