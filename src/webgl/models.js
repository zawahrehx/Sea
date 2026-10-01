import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/* ---------- small deterministic helpers ---------- */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
const fade = (t) => t * t * (3 - 2 * t);
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}
export function fbm3(x, y, z, oct = 4) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += a * noise3(x * f, y * f, z * f); f *= 2.03; a *= 0.5; }
  return v;
}

/* ---------- shared shader patch: caustics + optional vertex motion ---------- */
const causticGLSL = /* glsl */ `
  float caustic(vec2 p) {
    float t = uTime * 0.55;
    vec2 q = p * 0.55;
    float a = sin(q.x + sin(q.y * 1.3 + t) + t) * sin(q.y * 0.9 + sin(q.x * 1.7 - t * 0.8));
    float b = sin(q.x * 1.6 + sin(q.y * 2.1 - t * 1.2)) * sin(q.y * 1.4 + sin(q.x * 1.1 + t * 0.7));
    return pow(max(1.0 - abs(a + b), 0.0), 7.0);
  }
`;

/**
 * Adds animated caustic light to a standard material, plus optional
 * vertex motion code that edits `transformed` in local space.
 */
export function underwater(material, shared, { key = 'base', head = '', motion = '', strength = 0.5, tri = null, triScale = 0.25 } = {}) {
  material.customProgramCacheKey = () => `uw-${key}${tri ? '-tri' : ''}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    if (tri) shader.uniforms.tTri = { value: tri };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        varying vec3 vCWorld;
        varying float vCUp;
        varying vec3 vCN;
        ${head}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${motion}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 cw = vec4(transformed, 1.0);
        vec3 cn = objectNormal;
        #ifdef USE_INSTANCING
          cw = instanceMatrix * cw;
          cn = mat3(instanceMatrix) * cn;
        #endif
        vCWorld = (modelMatrix * cw).xyz;
        vCN = normalize(mat3(modelMatrix) * cn);
        vCUp = vCN.y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        varying vec3 vCWorld;
        varying float vCUp;
        varying vec3 vCN;
        ${tri ? 'uniform sampler2D tTri;' : ''}
        ${causticGLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${tri ? `
        vec3 bw = pow(abs(vCN), vec3(4.0));
        bw /= bw.x + bw.y + bw.z;
        vec3 tp = vCWorld * ${triScale.toFixed(3)};
        vec3 triCol = texture2D(tTri, tp.yz).rgb * bw.x + texture2D(tTri, tp.xz).rgb * bw.y + texture2D(tTri, tp.xy).rgb * bw.z;
        diffuseColor.rgb *= triCol * 2.2;` : ''}`)
      .replace('#include <fog_fragment>', `
        gl_FragColor.rgb += vec3(0.55, 0.88, 1.0) * caustic(vCWorld.xz) * smoothstep(-0.2, 0.9, vCUp) * ${strength.toFixed(2)};
        #include <fog_fragment>`);
  };
  return material;
}

/* ---------- terrain ---------- */
export const pathX = (z) => Math.sin(z * 0.03) * 4;

export function terrainHeight(x, z) {
  const off = Math.abs(x - pathX(z));
  const walls = THREE.MathUtils.smoothstep(off, 9, 28) * 8;
  const dunes = (fbm3(x * 0.07, 0, z * 0.07, 4) - 0.5) * 2.4;
  const ripples = Math.sin(x * 0.9 + z * 0.35 + Math.sin(z * 0.2)) * 0.08;
  return walls + dunes + ripples;
}

export function makeSeabed(tint = '#b6b29b') {
  const geo = new THREE.PlaneGeometry(320, 320, 220, 220);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -30);
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  const base = new THREE.Color(tint);
  const dark = base.clone().multiplyScalar(0.62);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, terrainHeight(x, z));
    const n = fbm3(x * 0.05, 3, z * 0.05, 3);
    c.copy(base).lerp(dark, THREE.MathUtils.smoothstep(n, 0.45, 0.75));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/* ---------- rocks ---------- */
export function makeRock(seed, detail = 4, moss = '#3e6b4f', stone = '#4a6670') {
  let geo = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = mergeVertices(geo);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const big = fbm3(v.x * 1.4 + seed, v.y * 1.4, v.z * 1.4, 4);
    const small = fbm3(v.x * 5 + seed, v.y * 5, v.z * 5, 3);
    const pits = Math.pow(noise3(v.x * 7 + seed * 2, v.y * 7, v.z * 7), 4) * 0.35;
    v.multiplyScalar(0.7 + big * 0.7 + small * 0.18 - pits);
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.25;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const n = geo.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const a = new THREE.Color(stone), b = new THREE.Color(moss), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const up = n.getY(i);
    const m = noise3(p.getX(i) * 3 + seed, p.getY(i) * 3, p.getZ(i) * 3);
    c.copy(a).lerp(b, THREE.MathUtils.smoothstep(up * 0.8 + m * 0.6, 0.45, 0.95));
    c.multiplyScalar(0.8 + m * 0.35);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/* ---------- coral ---------- */
const UP = new THREE.Vector3(0, 1, 0);

function segment(a, b, r0, r1, sides = 6) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, false);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

/** Branching coral; `planar` keeps branches in one plane for sea fans. */
export function makeBranchCoral(seed, { planar = false, depth = 4, radius = 0.11, length = 0.75 } = {}) {
  const r = rng(seed);
  const parts = [];
  const grow = (start, dir, len, rad, d) => {
    const end = start.clone().addScaledVector(dir, len);
    parts.push(segment(start, end, rad, rad * 0.72));
    if (d === 0) {
      const tip = new THREE.SphereGeometry(rad * 0.85, 6, 4);
      tip.translate(end.x, end.y, end.z);
      parts.push(tip);
      return;
    }
    const kids = r() < 0.35 ? 3 : 2;
    for (let k = 0; k < kids; k++) {
      const nd = dir.clone();
      const spread = 0.35 + r() * 0.45;
      if (planar) nd.applyAxisAngle(new THREE.Vector3(0, 0, 1), (k - (kids - 1) / 2) * spread * 1.3);
      else nd.applyAxisAngle(new THREE.Vector3(r() - 0.5, 0, r() - 0.5).normalize(), spread);
      nd.lerp(UP, 0.25).normalize();
      grow(end, nd, len * (0.7 + r() * 0.15), rad * 0.72, d - 1);
    }
  };
  grow(new THREE.Vector3(), UP.clone(), length, radius, depth);
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

export function makeBrainCoral(seed) {
  const geo = new THREE.SphereGeometry(1, 64, 32, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const warp = fbm3(v.x * 2 + seed, v.y * 2, v.z * 2, 3) * 6;
    const ridge = Math.abs(Math.sin((v.x + v.z) * 9 + warp));
    v.multiplyScalar(1 + ridge * 0.05);
    v.y *= 0.75;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function makeTubeCluster(seed) {
  const r = rng(seed);
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const h = 0.6 + r() * 1.1, rad = 0.09 + r() * 0.07;
    const g = new THREE.CylinderGeometry(rad * 1.25, rad, h, 10, 4, true);
    g.translate(0, h / 2, 0);
    g.rotateZ((r() - 0.5) * 0.5);
    g.rotateX((r() - 0.5) * 0.5);
    g.translate((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

/* ---------- plants ---------- */
export function makeKelpBlade(height = 1) {
  const geo = new THREE.PlaneGeometry(1, height, 1, 32);
  geo.translate(0, height / 2, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / height;
    const w = (0.18 + Math.sin(y * Math.PI) * 0.42) * (1 + Math.sin(y * 40) * 0.12);
    p.setX(i, p.getX(i) * w);
    p.setZ(i, Math.sin(y * 9) * 0.12);
  }
  geo.computeVertexNormals();
  return geo;
}

export function makeGrassBlade() {
  const geo = new THREE.PlaneGeometry(0.07, 1, 1, 5);
  geo.translate(0, 0.5, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) * (1 - y * 0.85));
  }
  return geo;
}

/* ---------- animals ---------- */
export function makeFish() {
  const body = new THREE.SphereGeometry(0.5, 14, 10);
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const taper = x < 0 ? 1 - Math.pow(-x / 0.5, 1.5) * 0.78 : 1 - Math.pow(x / 0.5, 2) * 0.3;
    p.setXYZ(i, x, y * 0.44 * taper, z * 0.17 * taper);
  }
  body.computeVertexNormals();

  const tailShape = new THREE.Shape();
  tailShape.moveTo(-0.4, 0);
  tailShape.lineTo(-0.8, 0.22);
  tailShape.quadraticCurveTo(-0.68, 0, -0.8, -0.22);
  tailShape.lineTo(-0.4, 0);
  const finShape = new THREE.Shape();
  finShape.moveTo(-0.2, 0.17);
  finShape.lineTo(0.08, 0.18);
  finShape.lineTo(-0.24, 0.34);
  finShape.lineTo(-0.2, 0.17);
  const tail = new THREE.ShapeGeometry(tailShape);
  const fin = new THREE.ShapeGeometry(finShape);
  return mergeGeometries([body.toNonIndexed(), tail.toNonIndexed(), fin.toNonIndexed()]);
}

/** Manta ray body as a deformed grid; wings flap in the vertex shader. */
export function makeManta() {
  const geo = new THREE.PlaneGeometry(1, 1, 48, 24);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) * 2;          // -1..1 across the span
    const v = p.getZ(i) + 0.5;        // 0 nose .. 1 tail
    const span = Math.pow(Math.sin(Math.PI * Math.min(1, v * 1.15)), 0.75) * (1 - v * 0.35) * 2.6 + 0.25;
    const sweep = Math.abs(u) * Math.abs(u) * 0.55;
    const x = u * span;
    const z = (v - 0.5) * 2.2 + sweep;
    const y = 0.18 * (1 - u * u) * Math.sin(Math.PI * v);
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  const tail = new THREE.CylinderGeometry(0.01, 0.05, 2.4, 5);
  tail.rotateX(Math.PI / 2);
  tail.translate(0, 0, 2.3);
  return mergeGeometries([geo.toNonIndexed(), tail.toNonIndexed()]);
}
