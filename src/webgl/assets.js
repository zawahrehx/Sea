import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/*
 * Optional generated assets. Every scene falls back to its procedural
 * version when a file is missing, so the site works without them.
 */
const MODELS = {
  fishYellow: { file: 'models/fish-yellow.json', size: 1, axis: 'length', flip: true },
  fishBlue: { file: 'models/fish-blue.json', size: 1, axis: 'length', flip: false },
  manta: { file: 'models/manta.json', size: 5.5, axis: 'span', pca: true, rotY: -2.55 },
  coralBranch: { file: 'models/coral-branch.json', size: 1.4, axis: 'height' },
  coralBrain: { file: 'models/coral-brain.json', size: 1.6, axis: 'width' },
};

const TEXTURES = {
  sky: 'tex/sky.jpg',
  sandColor: 'tex/sand-color.jpg',
  sandNormal: 'tex/sand-normal.jpg',
  sandRough: 'tex/sand-rough.jpg',
  rockColor: 'tex/rock-color.jpg',
  rockNormal: 'tex/rock-normal.jpg',
  rockRough: 'tex/rock-rough.jpg',
};

export const assets = { models: {}, tex: {} };

/** Principal axes of a point cloud (Jacobi eigen-solve), largest first. */
function principalAxes(pos) {
  const n = pos.count, m = [0, 0, 0];
  for (let i = 0; i < n; i++) { m[0] += pos.getX(i); m[1] += pos.getY(i); m[2] += pos.getZ(i); }
  m.forEach((_, k) => { m[k] /= n; });
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const d = [pos.getX(i) - m[0], pos.getY(i) - m[1], pos.getZ(i) - m[2]];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) A[r][c] += d[r] * d[c];
  }
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(A[p][q]) < 1e-12) continue;
      const th = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]);
      const c = Math.cos(th), s = Math.sin(th);
      for (let k = 0; k < 3; k++) {
        const akp = A[k][p], akq = A[k][q];
        A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = A[p][k], aqk = A[q][k];
        A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return [0, 1, 2]
    .map((i) => ({ val: A[i][i], vec: new THREE.Vector3(V[0][i], V[1][i], V[2][i]) }))
    .sort((a, b) => b.val - a.val)
    .map((e) => e.vec);
}

/** Bake a glTF scene into one geometry + material, normalised for instancing. */
function bake(gltf, cfg) {
  const geos = [];
  let material = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    geos.push(g.index ? g.toNonIndexed() : g);
    material ||= o.material;
  });
  if (!geos.length) return null;
  const geo = geos.length > 1 ? mergeGeometries(geos) : geos[0];

  if (cfg.pca) {
    // flat animals: widest axis -> x, length -> z, thinnest -> y
    const [a, b] = principalAxes(geo.attributes.position);
    const c = new THREE.Vector3().crossVectors(a, b);
    const basis = new THREE.Matrix4().makeBasis(a, c, b).invert();
    geo.applyMatrix4(basis);
  }
  if (cfg.rotX) geo.rotateX(cfg.rotX);
  if (cfg.rotY) geo.rotateY(cfg.rotY);
  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox.getSize(size);
  // animals: put the long (or wide) axis on x so the shader motion lines up
  if ((cfg.axis === 'length' || cfg.axis === 'span') && size.z > size.x) geo.rotateY(Math.PI / 2);
  if (cfg.flip) geo.rotateY(Math.PI);

  geo.computeBoundingBox();
  const box = geo.boundingBox;
  box.getSize(size);
  const c = new THREE.Vector3();
  box.getCenter(c);
  const ground = cfg.axis === 'height' || cfg.axis === 'width';
  geo.translate(-c.x, ground ? -box.min.y : -c.y, -c.z);
  const ref = cfg.axis === 'height' ? size.y : size.x;
  geo.scale(cfg.size / ref, cfg.size / ref, cfg.size / ref);
  if (!geo.attributes.normal) geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map: material?.map || null,
    color: material?.map ? 0xffffff : material?.color || 0xcccccc,
    roughness: 0.75,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
  return { geo, mat };
}

export async function loadAssets(onProgress = () => {}) {
  const gltf = new GLTFLoader();
  const tex = new THREE.TextureLoader();
  const jobs = [
    ...Object.entries(MODELS).map(([k, cfg]) => () =>
      gltf.loadAsync(cfg.file).then((g) => { const b = bake(g, cfg); if (b) assets.models[k] = b; })),
    ...Object.entries(TEXTURES).map(([k, file]) => () =>
      tex.loadAsync(file).then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 8;
        if (k.endsWith('Color')) t.colorSpace = THREE.SRGBColorSpace;
        assets.tex[k] = t;
      })),
  ];
  let done = 0;
  await Promise.all(jobs.map((job) => job().catch(() => {}).finally(() => onProgress(++done / jobs.length))));
  return assets;
}
