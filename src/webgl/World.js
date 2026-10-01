import * as THREE from 'three';
import * as S from './shaders.js';
import { Journey } from './Journey.js';
import { Post } from './Post.js';
import { assets } from './assets.js';

const COLORS = {
  zenith: new THREE.Color('#2275c4'),
  horizon: new THREE.Color('#a3d9ee'),
  deep: new THREE.Color('#0b3f6e'),
  shallow: new THREE.Color('#2f9ccf'),
  water: new THREE.Color('#0d4f7c'),
  abyss: new THREE.Color('#021627'),
};

export const SURFACE_Y = 3;
export const DEEP_Y = -60;

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
    this.timer = new THREE.Timer();

    // Driven from outside by GSAP
    this.state = { y: SURFACE_Y, z: 0, pitch: 0.02, breath: 0, reveal: 0, boost: 0, bubbles: 0 };
    this.mix = 0;
    this.speed = 0;
    this.lastCam = new THREE.Vector3();
    this.lastCamRef = null;
    this.pointer = new THREE.Vector2();
    this.look = new THREE.Vector2();

    this.sun = new THREE.Vector3(0.2, 0.35, -1).normalize();
    this.shared = { uTime: { value: 0 } };

    this.buildSky();
    this.buildOcean();
    this.buildVolume();
    this.buildRays();
    this.buildCurrents();
    this.buildDust();
    this.buildBubbles();
    this.post = new Post(this.renderer, this.shared);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('pointermove', (e) => {
      this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    });
  }

  buildSky() {
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: S.skyVert,
        fragmentShader: S.skyFrag,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTime: this.shared.uTime,
          uZenith: { value: COLORS.zenith },
          uHorizon: { value: COLORS.horizon },
          uSky: { value: null },
          uHasSky: { value: 0 },
        },
      }),
    );
    this.sky.renderOrder = -2;
    this.scene.add(this.sky);
  }

  buildOcean() {
    const geo = new THREE.PlaneGeometry(1400, 1400, 320, 320);
    geo.rotateX(-Math.PI / 2);
    // concentrate vertices near the camera
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / 700, z = pos.getZ(i) / 700;
      pos.setXYZ(i, Math.sign(x) * x * x * 700, 0, Math.sign(z) * z * z * 700);
    }
    this.ocean = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: S.oceanVert,
        fragmentShader: S.oceanFrag,
        side: THREE.DoubleSide,
        uniforms: {
          uTime: this.shared.uTime,
          uSun: { value: this.sun },
          uDeep: { value: COLORS.deep },
          uShallow: { value: COLORS.shallow },
          uHorizon: { value: COLORS.horizon },
          uZenith: { value: COLORS.zenith },
          uWater: { value: COLORS.water },
          uAbyss: { value: COLORS.abyss },
          uDepth: { value: 0 },
        },
      }),
    );
    this.ocean.frustumCulled = false;
    this.scene.add(this.ocean);
  }

  buildVolume() {
    this.volume = new THREE.Mesh(
      new THREE.SphereGeometry(600, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: S.volumeVert,
        fragmentShader: S.volumeFrag,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTime: this.shared.uTime,
          uWater: { value: COLORS.water },
          uAbyss: { value: COLORS.abyss },
          uDepth: { value: 0 },
        },
      }),
    );
    this.volume.renderOrder = -1;
    this.volume.visible = false;
    this.scene.add(this.volume);
  }

  buildRays() {
    this.rays = new THREE.Group();
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, -0.5, 0);
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(
        geo,
        new THREE.ShaderMaterial({
          vertexShader: S.rayVert,
          fragmentShader: S.rayFrag,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          uniforms: { uTime: this.shared.uTime, uSeed: { value: Math.random() }, uReveal: { value: 0 } },
        }),
      );
      const w = 6 + Math.random() * 14;
      m.scale.set(w, 90 + Math.random() * 40, 1);
      m.position.set((Math.random() - 0.5) * 160, -1, -30 - Math.random() * 90);
      m.rotation.z = (Math.random() - 0.5) * 0.35;
      this.rays.add(m);
    }
    this.scene.add(this.rays);
  }

  buildCurrents() {
    const ribbons = 4;
    const per = window.innerWidth < 800 ? 7000 : 14000;
    const seed = new Float32Array(ribbons * per * 4);
    const rib = new Float32Array(ribbons * per);
    for (let r = 0; r < ribbons; r++) {
      for (let i = 0; i < per; i++) {
        const k = r * per + i;
        // band offset biased to the ribbon core
        const b = (Math.random() + Math.random() + Math.random()) / 1.5 - 1;
        seed.set([Math.random(), b, Math.random() * 2 - 1, 0.004 + Math.random() * 0.01], k * 4);
        rib[k] = r;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ribbons * per * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    geo.setAttribute('aRibbon', new THREE.BufferAttribute(rib, 1));
    this.currentsMat = new THREE.ShaderMaterial({
      vertexShader: S.currentVert,
      fragmentShader: S.currentFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: this.shared.uTime,
        uPixel: { value: 1 },
        uReveal: { value: 0 },
        uMouse: { value: new THREE.Vector3(0, 0, -999) },
      },
    });
    this.currents = new THREE.Points(geo, this.currentsMat);
    this.currents.position.y = DEEP_Y;
    this.currents.frustumCulled = false;
    this.scene.add(this.currents);
  }

  buildDust() {
    const n = 2500;
    const p = new Float32Array(n * 3);
    const r = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      p.set([(Math.random() - 0.5) * 160, (Math.random() - 0.5) * 40, -Math.random() * 120 + 10], i * 3);
      r.set([Math.random(), Math.random(), Math.random()], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(r, 3));
    this.dustMat = new THREE.ShaderMaterial({
      vertexShader: S.dustVert,
      fragmentShader: S.dustFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.shared.uTime, uPixel: { value: 1 }, uReveal: { value: 0 } },
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  buildBubbles() {
    const n = 700;
    const p = new Float32Array(n * 3), r = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, rad = 1.5 + Math.random() * 10;
      p.set([Math.cos(a) * rad, 0, -Math.abs(Math.sin(a) * rad) - 1], i * 3);
      r.set([Math.random(), Math.random(), Math.random()], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('aRand', new THREE.BufferAttribute(r, 3));
    this.bubbleMat = new THREE.ShaderMaterial({
      vertexShader: S.bubbleVert,
      fragmentShader: S.bubbleFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.shared.uTime, uPixel: { value: 1 }, uAmount: { value: 0 } },
    });
    this.bubbles = new THREE.Points(geo, this.bubbleMat);
    this.bubbles.frustumCulled = false;
    this.scene.add(this.bubbles);
  }

  /** Compile every program up front so the loader reflects real work. */
  warmup() {
    if (assets.tex.sky) {
      this.sky.material.uniforms.uSky.value = assets.tex.sky;
      this.sky.material.uniforms.uHasSky.value = 1;
    }
    this.camera.position.set(0, DEEP_Y, 0);
    this.volume.visible = true;
    this.renderer.compile(this.scene, this.camera);
    this.volume.visible = false;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1 ? 70 : 55;
    this.camera.updateProjectionMatrix();
    this.journey?.resize(w / h);
    const px = this.renderer.getPixelRatio();
    this.currentsMat.uniforms.uPixel.value = px;
    this.dustMat.uniforms.uPixel.value = px;
    this.bubbleMat.uniforms.uPixel.value = px;
    this.post.setSize(w, h, px);
  }

  /** 0 at the surface, 1 at the journeys depth */
  get depth() {
    return THREE.MathUtils.clamp((SURFACE_Y - this.state.y) / (SURFACE_Y - DEEP_Y), 0, 1);
  }

  openJourney(i) {
    this.closeJourney();
    this.journey = new Journey(this.renderer, this.shared, i);
    this.journey.resize(window.innerWidth / window.innerHeight);
    this.renderer.compile(this.journey.scene, this.journey.camera);
    return this.journey;
  }

  closeJourney() {
    this.journey?.dispose();
    this.journey = null;
  }

  render() {
    this.timer.update();
    const t = this.timer.getElapsed();
    this.shared.uTime.value = t;
    const showHub = !this.journey || this.mix < 1;
    if (showHub) this.updateHub();
    if (this.journey) this.journey.update(t, this.pointer);

    // speed blur follows whichever camera dominates the frame
    const active = this.journey && this.mix >= 0.5 ? this.journey.camera : this.camera;
    if (this.lastCamRef === active) {
      const v = active.position.distanceTo(this.lastCam);
      this.speed += (Math.min(v * 0.5, 1) - this.speed) * 0.08;
    }
    this.lastCamRef = active;
    this.lastCam.copy(active.position);
    const u = this.post.uniforms;
    u.uSpeed.value = Math.min(1.2, this.speed + this.state.boost);
    u.uSplash.value = showHub ? Math.max(0, 1 - Math.abs(this.camera.position.y + 0.3) / 2.2) : 0;

    this.post.render(this.scene, this.camera, this.journey?.scene, this.journey?.camera, this.journey ? this.mix : 0);
  }

  updateHub() {
    const s = this.state;

    this.look.lerp(this.pointer, 0.04);
    const cam = this.camera;
    cam.position.set(this.look.x * 1.5, s.y + s.breath * 0.6, s.z);
    cam.rotation.set(s.pitch + this.look.y * 0.04 + s.breath * 0.015, -this.look.x * 0.06, 0, 'YXZ');

    const under = cam.position.y < 0.4;
    const d = this.depth;
    this.volume.visible = under;
    this.volume.position.copy(cam.position);
    this.volume.material.uniforms.uDepth.value = d;
    this.ocean.material.uniforms.uDepth.value = d;
    this.sky.visible = !under || d < 0.15;
    this.sky.position.copy(cam.position);

    this.currentsMat.uniforms.uReveal.value = s.reveal;
    this.dustMat.uniforms.uReveal.value = Math.min(1, d * 2.5);
    this.dust.position.set(0, cam.position.y, s.z);
    this.bubbles.position.copy(cam.position);
    this.bubbleMat.uniforms.uAmount.value = s.bubbles;
    const rayA = under ? Math.min(1, d * 4) * (1 - d * 0.55) : 0;
    this.rays.children.forEach((m) => { m.material.uniforms.uReveal.value = rayA; });

    // project pointer onto the current plane so ribbons part around it
    const v = new THREE.Vector3(this.pointer.x, this.pointer.y, 0.5).unproject(cam).sub(cam.position).normalize();
    const k = (-60 - cam.position.z) / v.z;
    this.currentsMat.uniforms.uMouse.value.copy(cam.position).addScaledVector(v, k);
  }
}
