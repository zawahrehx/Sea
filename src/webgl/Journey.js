import * as THREE from 'three';
import * as S from './shaders.js';
import * as M from './models.js';
import { assets } from './assets.js';

/* Per-journey look */
const LOOKS = [
  { top: '#3fb2d6', mid: '#126a95', low: '#06304d', fog: '#14709b', density: 0.022, sand: '#bdb59a' },
  { top: '#2f8fd0', mid: '#0b4d86', low: '#041f3d', fog: '#0d538c', density: 0.017, sand: '#a9adaa' },
  { top: '#5fbfa8', mid: '#1b6a6f', low: '#082c33', fog: '#1d6d70', density: 0.026, sand: '#a8a283' },
];

const gradientFrag = /* glsl */ `
  uniform vec3 uTop, uMid, uLow;
  uniform float uTime;
  varying vec3 vDir;
  ${S.noise}
  void main() {
    vec3 d = normalize(vDir);
    vec3 col = d.y > 0.0 ? mix(uMid, uTop, pow(d.y, 0.7)) : mix(uMid, uLow, pow(-d.y, 0.6));
    float shafts = fbm(vec2(atan(d.x, d.z) * 7.0, uTime * 0.06)) * smoothstep(0.1, 0.9, d.y);
    col += shafts * 0.09;
    gl_FragColor = vec4(col, 1.0);
    gl_FragColor.rgb = toLinear(gl_FragColor.rgb);
  }
`;

const tmp = new THREE.Object3D();
const X = new THREE.Vector3(1, 0, 0);

/** A school of instanced fish orbiting a moving centre. */
class School {
  constructor(geo, mat, count, { center, radius = 4, height = 1.5, speed = 0.35, size = [0.35, 0.6], colors, seed = 1 }) {
    const r = M.rng(seed);
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.center = center;
    this.p = Array.from({ length: count }, () => ({
      a: r() * Math.PI * 2,
      rad: radius * (0.35 + r() * 0.65),
      h: (r() - 0.5) * height,
      w: speed * (0.8 + r() * 0.4) * (radius > 10 ? 0.5 : 1),
      s: size[0] + r() * (size[1] - size[0]),
      wob: r() * 6.28,
    }));
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) this.mesh.setColorAt(i, c.set(colors[(r() * colors.length) | 0]).multiplyScalar(0.85 + r() * 0.3));
    this.a = new THREE.Vector3();
    this.b = new THREE.Vector3();
  }

  pos(o, t, out) {
    const c = this.center(t);
    const ang = o.a + t * o.w;
    return out.set(
      c.x + Math.cos(ang) * o.rad,
      c.y + o.h + Math.sin(ang * 2 + o.wob) * 0.4,
      c.z + Math.sin(ang) * o.rad * 0.75,
    );
  }

  update(t) {
    this.p.forEach((o, i) => {
      this.pos(o, t, this.a);
      this.pos(o, t + 0.06, this.b);
      tmp.position.copy(this.a);
      tmp.quaternion.setFromUnitVectors(X, this.b.sub(this.a).normalize());
      tmp.scale.setScalar(o.s);
      tmp.updateMatrix();
      this.mesh.setMatrixAt(i, tmp.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Journey {
  constructor(renderer, shared, index) {
    this.renderer = renderer;
    this.shared = shared;
    this.index = index;
    this.look = LOOKS[index];
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 600);
    this.schools = [];
    this.movers = [];
    this.pose = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 };
    this.smooth = new THREE.Vector2();

    const L = this.look;
    this.scene.fog = new THREE.FogExp2(L.fog, L.density);
    this.scene.add(new THREE.HemisphereLight('#bff0ff', '#1d3b48', 1.5));
    const sun = new THREE.DirectionalLight('#e6f8ff', 1.8);
    sun.position.set(10, 40, 10);
    this.scene.add(sun);

    this.buildBackdrop();
    this.buildFloor();
    this.buildRocks();
    [this.buildReef, this.buildOpenBlue, this.buildForest][index].call(this);
    this.buildRays();
    this.buildDust();

    this.poses = this.makePoses();
    this.setPose(0);
  }

  /* ---------- environment ---------- */
  buildBackdrop() {
    const L = this.look;
    this.backdrop = new THREE.Mesh(
      new THREE.SphereGeometry(400, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: S.volumeVert,
        fragmentShader: gradientFrag,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTime: this.shared.uTime,
          uTop: { value: new THREE.Color(L.top) },
          uMid: { value: new THREE.Color(L.fog) },
          uLow: { value: new THREE.Color(L.low) },
        },
      }),
    );
    this.backdrop.renderOrder = -1;
    this.scene.add(this.backdrop);
  }

  buildFloor() {
    const T = assets.tex;
    const params = { vertexColors: true, roughness: 1 };
    if (T.sandColor) {
      for (const t of [T.sandColor, T.sandNormal, T.sandRough]) t?.repeat.set(56, 56);
      Object.assign(params, { map: T.sandColor, normalMap: T.sandNormal || null, roughnessMap: T.sandRough || null, normalScale: new THREE.Vector2(1.4, 1.4) });
    }
    const mat = M.underwater(new THREE.MeshStandardMaterial(params), this.shared, { key: 'sand', strength: 0.7 });
    this.scene.add(new THREE.Mesh(M.makeSeabed(this.look.sand), mat));
  }

  buildRocks() {
    const r = M.rng(10 + this.index);
    const tri = assets.tex.rockColor || null;
    const kinds = Array.from({ length: 7 }, (_, i) =>
      tri ? M.makeRock(i * 3.7 + this.index * 11, 4, '#b9d0b4', '#c3d3d8') : M.makeRock(i * 3.7 + this.index * 11, 4));
    const mat = M.underwater(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), this.shared, { key: 'rock', tri, triScale: 0.22 });
    this.rockSpots = [];
    const place = (x, z, s, sink = 0.5) => {
      const m = new THREE.Mesh(kinds[(r() * kinds.length) | 0], mat);
      m.position.set(x, M.terrainHeight(x, z) - s.y * sink * 0.4, z);
      m.scale.copy(s);
      m.rotation.y = r() * Math.PI * 2;
      this.scene.add(m);
      return m;
    };
    const wallGap = this.index === 1 ? 17 : 12;
    for (let z = 60; z > -130; z -= 7 + r() * 5) {
      for (const side of [-1, 1]) {
        const x = M.pathX(z) + side * (wallGap + r() * 7);
        place(x, z, new THREE.Vector3(5 + r() * 5, 4 + r() * 6, 5 + r() * 4), 0.3);
      }
    }
    const mids = this.index === 1 ? 6 : 16;
    for (let i = 0; i < mids; i++) {
      const z = 40 - r() * 150;
      const side = r() < 0.5 ? -1 : 1;
      const x = M.pathX(z) + side * (3.5 + r() * 6);
      const s = 0.8 + r() * 1.8;
      place(x, z, new THREE.Vector3(s * 1.3, s, s * 1.1));
      this.rockSpots.push(new THREE.Vector3(x, M.terrainHeight(x, z), z));
    }
  }

  /** Scatter instances of `geo` at the given points. */
  scatter(geo, color, points, { scale = [0.6, 1.2], key, motion = '', side = THREE.FrontSide, rough = 0.8, emissive = 0, map = null }) {
    const c = new THREE.Color(color);
    const mat = M.underwater(
      new THREE.MeshStandardMaterial({ color: c, map, roughness: rough, side, emissive: map ? 0x000000 : c, emissiveIntensity: emissive }),
      this.shared,
      { key, motion },
    );
    const mesh = new THREE.InstancedMesh(geo, mat, points.length);
    const r = M.rng(points.length * 7 + this.index);
    const tint = new THREE.Color();
    points.forEach((p, i) => {
      tmp.position.copy(p);
      tmp.rotation.set((r() - 0.5) * 0.2, r() * Math.PI * 2, (r() - 0.5) * 0.2);
      tmp.scale.setScalar(scale[0] + r() * (scale[1] - scale[0]));
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
      mesh.setColorAt(i, tint.setRGB(1, 1, 1).multiplyScalar(0.75 + r() * 0.45));
    });
    this.scene.add(mesh);
    return mesh;
  }

  /** Random floor points in a band either side of the path. */
  floorPoints(n, { near = 3, far = 14, z0 = 45, z1 = -120, seed = 1, around = null, spread = 3 } = {}) {
    const r = M.rng(seed + this.index * 100);
    const pts = [];
    for (let i = 0; i < n; i++) {
      let x, z;
      if (around && r() < 0.6) {
        const a = around[(r() * around.length) | 0];
        x = a.x + (r() - 0.5) * spread * 2;
        z = a.z + (r() - 0.5) * spread * 2;
      } else {
        z = z0 + (z1 - z0) * r();
        x = M.pathX(z) + (r() < 0.5 ? -1 : 1) * (near + r() * (far - near));
      }
      pts.push(new THREE.Vector3(x, M.terrainHeight(x, z) - 0.1, z));
    }
    return pts;
  }

  fishMaterial(key, map = null) {
    return M.underwater(new THREE.MeshStandardMaterial({ map, roughness: map ? 0.55 : 0.45, metalness: map ? 0.05 : 0.25, side: THREE.DoubleSide }), this.shared, {
      key,
      strength: 0.25,
      motion: `
        float ph = float(gl_InstanceID) * 1.37;
        transformed.z += sin(uTime * 7.0 + ph - transformed.x * 4.5) * 0.09 * smoothstep(0.35, -0.7, transformed.x);`,
    });
  }

  addSchool(opts) {
    if (!this.fishGeo) this.fishGeo = M.makeFish();
    if (!this.fishMat) this.fishMat = this.fishMaterial('fish');
    let geo = this.fishGeo, mat = this.fishMat;
    const model = opts.model && assets.models[opts.model];
    if (model) {
      geo = model.geo;
      this.modelMats ||= {};
      mat = this.modelMats[opts.model] ||= this.fishMaterial(`fish-${opts.model}`, model.mat.map);
      opts = { ...opts, colors: ['#ffffff', '#f2f2f2', '#e6e6e6'] };
    }
    const s = new School(geo, mat, opts.count, opts);
    this.scene.add(s.mesh);
    this.schools.push(s);
  }

  /* ---------- journey-specific dressing ---------- */
  buildReef() {
    const around = this.rockSpots;
    const branch = [M.makeBranchCoral(1), M.makeBranchCoral(2, { depth: 3, radius: 0.14 })];
    const fan = M.makeBranchCoral(5, { planar: true, depth: 5, radius: 0.05, length: 0.55 });
    const CB = assets.models.coralBranch, CR = assets.models.coralBrain;
    if (CB) this.scatter(CB.geo, '#ffffff', this.floorPoints(80, { seed: 1, around }), { key: 'm1', scale: [0.8, 2.0], map: CB.mat.map, side: THREE.DoubleSide });
    else this.scatter(branch[0], '#ff7d8f', this.floorPoints(130, { seed: 1, around }), { key: 'c1', scale: [0.7, 1.6] });
    this.scatter(branch[1], '#ffa04d', this.floorPoints(90, { seed: 2, around }), { key: 'c2', scale: [0.6, 1.3] });
    this.scatter(fan, '#b071d8', this.floorPoints(60, { seed: 3, around, far: 16 }), { key: 'c3', scale: [1.4, 2.6], side: THREE.DoubleSide });
    if (CR) this.scatter(CR.geo, '#ffffff', this.floorPoints(60, { seed: 4, around }), { key: 'm2', scale: [0.5, 1.3], map: CR.mat.map });
    else this.scatter(M.makeBrainCoral(4), '#d9bf5f', this.floorPoints(70, { seed: 4, around }), { key: 'c4', scale: [0.5, 1.2] });
    this.scatter(M.makeTubeCluster(6), '#e4609f', this.floorPoints(50, { seed: 6, around }), { key: 'c5', scale: [0.7, 1.4], side: THREE.DoubleSide });
    this.scatter(M.makeBrainCoral(8), '#8fcf6a', this.floorPoints(60, { seed: 8, around }), { key: 'c6', scale: [0.4, 0.9] });

    const yellow = ['#ffd84a', '#ffc93a'], blue = ['#3f8cff', '#2c6fe0'], mixed = ['#ff8a5b', '#ffffff', '#ffd84a'];
    const C = (x, y, z, ax, az, w) => (t) => new THREE.Vector3(x + Math.sin(t * w) * ax, y + Math.sin(t * w * 1.7) * 0.6, z + Math.cos(t * w) * az);
    this.addSchool({ count: 60, model: 'fishYellow', center: C(-7, M.terrainHeight(-7, 4) + 3, 4, 3, 4, 0.12), radius: 3, colors: yellow, seed: 1, size: [0.45, 0.6] });
    this.addSchool({ count: 110, model: 'fishBlue', center: C(4, 6, -24, 4, 6, 0.1), radius: 5, colors: blue, seed: 2, size: [0.3, 0.45] });
    this.addSchool({ count: 90, center: C(-3, 8, -58, 6, 5, 0.08), radius: 6, colors: mixed, seed: 3, size: [0.35, 0.6] });
    this.addSchool({ count: 30, model: 'fishYellow', center: C(6, 4, 14, 2, 2, 0.15), radius: 2, colors: yellow, seed: 4, size: [0.35, 0.5] });
  }

  buildOpenBlue() {
    const CR = assets.models.coralBrain;
    if (CR) this.scatter(CR.geo, '#cfd9d0', this.floorPoints(40, { seed: 2, near: 5, far: 18 }), { key: 'm2', scale: [0.6, 1.5], map: CR.mat.map });
    else this.scatter(M.makeBrainCoral(3), '#9fb39a', this.floorPoints(40, { seed: 2, near: 5, far: 18 }), { key: 'c1', scale: [0.6, 1.4] });
    this.scatter(M.makeBranchCoral(9, { depth: 3 }), '#c58a9c', this.floorPoints(40, { seed: 4, near: 5, far: 18 }), { key: 'c2', scale: [0.8, 1.6] });

    const silver = ['#dfe9f0', '#c5d6e2', '#aebfcc'];
    this.addSchool({
      count: 900, center: (t) => new THREE.Vector3(M.pathX(-58), 13 + Math.sin(t * 0.3), -60),
      radius: 9, height: 9, speed: 0.45, colors: silver, seed: 7, size: [0.4, 0.6],
    });
    this.addSchool({
      count: 120, center: (t) => new THREE.Vector3(Math.sin(t * 0.07) * 10, 7, -20 + Math.cos(t * 0.07) * 14),
      radius: 4, colors: ['#5d7f9a', '#3e5c74'], seed: 8, size: [0.9, 1.3],
    });

    const MT = assets.models.manta;
    const manta = new THREE.Mesh(
      MT ? MT.geo : M.makeManta(),
      M.underwater(new THREE.MeshStandardMaterial({ color: MT ? '#ffffff' : '#22323d', map: MT?.mat.map || null, roughness: 0.7, side: THREE.DoubleSide }), this.shared, {
        key: 'manta',
        strength: 0.3,
        motion: `transformed.y += sin(uTime * 1.3 - abs(transformed.x) * 0.9) * pow(abs(transformed.x), 1.5) * 0.22;`,
      }),
    );
    manta.scale.setScalar(2.2);
    this.scene.add(manta);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    const path = (t, out) => out.set(M.pathX(-30) + Math.cos(t * 0.09) * 16, 13 + Math.sin(t * 0.18) * 2, -32 + Math.sin(t * 0.09) * 18);
    this.movers.push((t) => {
      path(t, a); path(t + 0.1, b);
      manta.position.copy(a);
      // the body's nose points down -z
      manta.lookAt(a.clone().multiplyScalar(2).sub(b));
      manta.rotateZ(Math.sin(t * 0.18) * 0.2);
    });
  }

  buildForest() {
    const kelpGeo = M.makeKelpBlade(1);
    const pts = [];
    const r = M.rng(99);
    for (let i = 0; i < 360; i++) {
      const z = 40 - r() * 160;
      const off = (r() < 0.5 ? -1 : 1) * (2.6 + Math.pow(r(), 0.7) * 16);
      const x = M.pathX(z) + off;
      pts.push(new THREE.Vector3(x, M.terrainHeight(x, z) - 0.2, z));
    }
    const kelpMat = M.underwater(new THREE.MeshStandardMaterial({ color: '#7c7a2e', roughness: 0.7, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }), this.shared, {
      key: 'kelp',
      strength: 0.35,
      motion: `
        float ph = float(gl_InstanceID) * 0.73;
        float k = pow(transformed.y, 1.4);
        transformed.x += sin(uTime * 0.7 + ph + transformed.y * 3.0) * k * 0.12;
        transformed.z += cos(uTime * 0.5 + ph + transformed.y * 2.0) * k * 0.08;`,
    });
    const kelp = new THREE.InstancedMesh(kelpGeo, kelpMat, pts.length);
    const tint = new THREE.Color();
    pts.forEach((p, i) => {
      const h = 9 + r() * 16;
      tmp.position.copy(p);
      tmp.rotation.set(0, r() * Math.PI, 0);
      tmp.scale.set(1.2 + r() * 0.8, h, 1);
      tmp.updateMatrix();
      kelp.setMatrixAt(i, tmp.matrix);
      kelp.setColorAt(i, tint.set(r() < 0.5 ? '#8a7d2c' : '#6d7d34').multiplyScalar(0.8 + r() * 0.4));
    });
    this.scene.add(kelp);

    this.scatter(M.makeGrassBlade(), '#6f9a4a', this.floorPoints(5000, { seed: 3, near: 1.5, far: 20 }), {
      key: 'grass', scale: [0.6, 1.5], side: THREE.DoubleSide,
      motion: `transformed.x += sin(uTime * 1.2 + float(gl_InstanceID) * 0.37) * transformed.y * 0.15;`,
    });
    const CR = assets.models.coralBrain;
    if (CR) this.scatter(CR.geo, '#b8b08a', this.floorPoints(26, { seed: 5, around: this.rockSpots }), { key: 'm2', scale: [0.4, 1.0], map: CR.mat.map });
    else this.scatter(M.makeBrainCoral(12), '#9b8a62', this.floorPoints(30, { seed: 5, around: this.rockSpots }), { key: 'c1', scale: [0.4, 0.9] });

    this.addSchool({ count: 260, center: (t) => new THREE.Vector3(M.pathX(-20) + Math.sin(t * 0.1) * 5, 6, -20 + Math.cos(t * 0.1) * 6), radius: 5, colors: ['#cfd8d2', '#b7c3bb'], seed: 3, size: [0.25, 0.4] });
    this.addSchool({ count: 30, center: (t) => new THREE.Vector3(M.pathX(-60) + Math.sin(t * 0.06) * 6, 9, -62), radius: 6, colors: ['#e07a3a', '#c9662c'], seed: 5, size: [0.7, 1.0] });
    this.addSchool({ count: 60, center: (t) => new THREE.Vector3(M.pathX(10) + 4, 3, 10), radius: 2.5, colors: ['#d8c25a', '#9fb36a'], seed: 6, size: [0.3, 0.45] });
  }

  buildRays() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, -0.5, 0);
    const r = M.rng(5);
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(
        geo,
        new THREE.ShaderMaterial({
          vertexShader: S.rayVert,
          fragmentShader: S.rayFrag,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          uniforms: { uTime: this.shared.uTime, uSeed: { value: r() }, uReveal: { value: 1.4 } },
        }),
      );
      m.scale.set(4 + r() * 10, 60, 1);
      const z = 40 - r() * 150;
      m.position.set(M.pathX(z) + (r() - 0.5) * 40, 45, z);
      m.rotation.set(0, r() * Math.PI, (r() - 0.5) * 0.3);
      this.scene.add(m);
    }
  }

  buildDust() {
    const n = 1800;
    const p = new Float32Array(n * 3), rr = new Float32Array(n * 3);
    const r = M.rng(2);
    for (let i = 0; i < n; i++) {
      p.set([(r() - 0.5) * 60, (r() - 0.5) * 30, -r() * 60 + 10], i * 3);
      rr.set([r(), r(), r()], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rr, 3));
    this.dustMat = new THREE.ShaderMaterial({
      vertexShader: S.dustVert,
      fragmentShader: S.dustFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.shared.uTime, uPixel: { value: this.renderer.getPixelRatio() }, uReveal: { value: 0.8 } },
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  /* ---------- camera path ---------- */
  makePoses() {
    const at = (z, dx, dy) => [M.pathX(z) + dx, M.terrainHeight(M.pathX(z) + dx, z) + dy, z];
    const p = (cam, tgt) => ({ cam, tgt });
    const base = [
      p(at(36, 0, 3.4), at(0, 0, 5)),
      p(at(14, -2, 2.6), at(2, -8, 1.5)),
      p(at(-12, 3, 3.2), at(-28, 9, 2.5)),
      p(at(-38, 0, 5), at(-60, 0, 13)),
      p(at(-66, -1, 3), at(-90, 3, 2)),
    ];
    if (this.index === 1) base[2] = p(at(-10, 0, 6), at(-32, 0, 13));
    return base;
  }

  setPose(i) {
    const { cam, tgt } = this.poses[i];
    Object.assign(this.pose, { px: cam[0], py: cam[1], pz: cam[2], tx: tgt[0], ty: tgt[1], tz: tgt[2] });
  }

  /** Start further back and higher, so the camera can glide in. */
  setEntry() {
    const { cam, tgt } = this.poses[0];
    Object.assign(this.pose, { px: cam[0], py: cam[1] + 9, pz: cam[2] + 30, tx: tgt[0], ty: tgt[1] + 3, tz: tgt[2] });
  }

  /** World anchor for chapter i's info point (just off the target). */
  hotspot(i) {
    const { tgt } = this.poses[i];
    return new THREE.Vector3(tgt[0] + 1.5, tgt[1] + 1.2, tgt[2] + 4);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 1 ? 72 : 55;
    this.camera.updateProjectionMatrix();
  }

  update(t, pointer) {
    this.smooth.lerp(pointer, 0.04);
    const P = this.pose;
    const cam = this.camera;
    cam.position.set(P.px + this.smooth.x * 0.8, P.py + Math.sin(t * 0.5) * 0.15 + this.smooth.y * 0.4, P.pz);
    cam.lookAt(P.tx + this.smooth.x * 2, P.ty + this.smooth.y * 1.2, P.tz);
    this.backdrop.position.copy(cam.position);
    this.dust.position.copy(cam.position);
    this.schools.forEach((s) => s.update(t));
    this.movers.forEach((m) => m(t));
  }

  dispose() {
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) [].concat(o.material).forEach((m) => m.dispose());
    });
  }
}
