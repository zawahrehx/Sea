import * as THREE from 'three';
import * as S from './shaders.js';

const COLORS = {
  zenith: new THREE.Color('#2f86c4'),
  horizon: new THREE.Color('#8fd2ea'),
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
    this.state = { y: SURFACE_Y, pitch: 0.02, breath: 0, reveal: 0 };
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
        uniforms: { uTime: this.shared.uTime, uZenith: { value: COLORS.zenith }, uHorizon: { value: COLORS.horizon } },
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

  /** Compile every program up front so the loader reflects real work. */
  warmup() {
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
    const px = this.renderer.getPixelRatio();
    this.currentsMat.uniforms.uPixel.value = px;
    this.dustMat.uniforms.uPixel.value = px;
  }

  /** 0 at the surface, 1 at the journeys depth */
  get depth() {
    return THREE.MathUtils.clamp((SURFACE_Y - this.state.y) / (SURFACE_Y - DEEP_Y), 0, 1);
  }

  render() {
    this.timer.update();
    const t = this.timer.getElapsed();
    this.shared.uTime.value = t;
    const s = this.state;

    this.look.lerp(this.pointer, 0.04);
    const cam = this.camera;
    cam.position.set(this.look.x * 1.5, s.y + s.breath * 0.6, 0);
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
    this.dust.position.y = cam.position.y;
    const rayA = under ? Math.min(1, d * 4) * (1 - d * 0.55) : 0;
    this.rays.children.forEach((m) => { m.material.uniforms.uReveal.value = rayA; });

    // project pointer onto the current plane so ribbons part around it
    const v = new THREE.Vector3(this.pointer.x, this.pointer.y, 0.5).unproject(cam).sub(cam.position).normalize();
    const k = (-60 - cam.position.z) / v.z;
    this.currentsMat.uniforms.uMouse.value.copy(cam.position).addScaledVector(v, k);

    this.renderer.render(this.scene, cam);
  }
}
