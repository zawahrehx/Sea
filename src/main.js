import gsap from 'gsap';
import * as THREE from 'three';
import { World, SURFACE_Y, DEEP_Y } from './webgl/World.js';
import { Sound } from './ui/audio.js';
import { scramble, bindScrambleHover } from './ui/scramble.js';
import { initCursor } from './ui/cursor.js';
import { journeys, pages } from './content.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const world = new World($('#gl'));
const sound = new Sound();
let view = 'loader';
const discovered = new Set();

// keep animations on real time even when frames are slow
gsap.ticker.lagSmoothing(0);
gsap.ticker.add(() => world.render());
initCursor($('#cursor'));
bindScrambleHover();

/* ---------- UI sounds ---------- */
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-sfx]');
  if (t && !t.contains(e.relatedTarget)) sound.hover();
});
document.addEventListener('click', (e) => { if (e.target.closest('[data-sfx]')) sound.click(); });

/* ---------- Audio button ---------- */
const bars = $('#bars');
for (let i = 0; i < 13; i++) {
  const b = document.createElement('i');
  b.style.setProperty('--i', (i * 7) % 5);
  bars.appendChild(b);
}
$('#audio-btn').addEventListener('click', () => $('#audio-btn').classList.toggle('on', sound.toggle()));

/* ---------- HUD globe ---------- */
const grid = $('#globe-grid');
const meridians = Array.from({ length: 6 }, () => {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  grid.appendChild(p);
  return p;
});
[-24, 0, 24].forEach((y) => {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const rx = Math.sqrt(1600 - y * y);
  p.setAttribute('d', `M${60 - rx} ${60 + y} A${rx} ${rx * 0.18} 0 0 0 ${60 + rx} ${60 + y}`);
  grid.appendChild(p);
});
gsap.ticker.add((time) => {
  meridians.forEach((p, i) => {
    const a = ((time * 0.25 + (i * Math.PI) / 6) % Math.PI);
    const rx = Math.abs(Math.cos(a)) * 40;
    p.setAttribute('d', `M60 20 A${rx} 40 0 0 ${a < Math.PI / 2 ? 1 : 0} 60 100`);
  });
});

function updateHud() {
  if (world.journey) {
    const j = journeys[world.journey.index];
    const d = j.depth + Math.max(0, chapter) * 2 + Math.sin(performance.now() * 0.0004) * 0.4;
    $('#hud-depth').textContent = `${Math.round(d)}m`;
    $('#hud-temp').textContent = `${j.temp}°c`;
    sound.setDepth(0.45);
    return;
  }
  const d = world.depth;
  $('#hud-depth').textContent = `${Math.round(Math.max(0, SURFACE_Y - world.state.y) * 0.75)}m`;
  $('#hud-temp').textContent = `${Math.round(24 - d * 9)}°c`;
  sound.setDepth(d);
}
gsap.ticker.add(updateHud);

/* ---------- Loader ---------- */
const ticks = $('#ticks');
ticks.classList.add('loader__ticks');
const TICKS = 120;
for (let i = 0; i < TICKS; i++) {
  const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  l.setAttribute('x1', 150); l.setAttribute('x2', 150);
  l.setAttribute('y1', 26); l.setAttribute('y2', 38);
  l.setAttribute('transform', `rotate(${(i / TICKS) * 360} 150 150)`);
  ticks.appendChild(l);
}
const tickEls = [...ticks.children];
const marks = $$('.loader__mark');

const progress = { v: 0 };
const orbit = { a: 0 };
gsap.to(orbit, {
  a: Math.PI * 2, duration: 6, repeat: -1, ease: 'none',
  onUpdate() {
    const pts = [[orbit.a, '#node-a'], [orbit.a + Math.PI, '#node-b']];
    pts.forEach(([a, id]) => {
      $(id).setAttribute('cx', 150 + Math.cos(a) * 112);
      $(id).setAttribute('cy', 150 + Math.sin(a) * 112);
    });
  },
});

function renderProgress() {
  const on = Math.round(progress.v * TICKS);
  tickEls.forEach((t, i) => t.classList.toggle('on', i < on));
  marks.forEach((m) => m.classList.toggle('on', progress.v * 100 >= +m.textContent));
}

const readout = $$('#readout p');
async function runLoader() {
  const tl = gsap.timeline();
  readout.forEach((p, i) => tl.to(p, { opacity: 1, duration: 0.3 }, 0.3 + i * 0.35));

  const fontReady = document.fonts.ready;
  gsap.to(progress, { v: 0.55, duration: 1.8, ease: 'power1.out', onUpdate: renderProgress });
  await fontReady;
  await new Promise((r) => setTimeout(r, 1900));
  world.warmup();
  await gsap.to(progress, { v: 1, duration: 1.4, ease: 'power2.inOut', onUpdate: renderProgress });

  readout.forEach((p, i) => setTimeout(() => scramble(p, p.dataset.value, 0.7), i * 180));
  const swap = gsap.timeline();
  swap.to('#loader-status-a', { opacity: 0, y: -8, duration: 0.4 })
    .fromTo('#loader-status-b', { y: 8 }, { opacity: 1, y: 0, duration: 0.4 })
    .to('#dial', { opacity: 0, scale: 0.92, duration: 0.8, ease: 'power2.in' }, '+=0.7')
    .to('.loader__bg', { opacity: 0, duration: 1.6, ease: 'power2.inOut' }, '-=0.3')
    .add(showIntro, '-=0.6');
}

/* Wrap each character in a span, grouped by word so lines only break between words. */
function splitChars(el) {
  const words = el.textContent.trim().split(/\s+/);
  el.textContent = '';
  const chars = [];
  words.forEach((w, i) => {
    const word = document.createElement('span');
    word.className = 'word';
    for (const c of w) {
      const s = document.createElement('span');
      s.textContent = c;
      s.style.display = 'inline-block';
      word.appendChild(s);
      chars.push(s);
    }
    el.appendChild(word);
    if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
  });
  return chars;
}

function showIntro() {
  gsap.set('#intro', { visibility: 'visible' });
  const tl = gsap.timeline();
  tl.to('.intro__logo', { opacity: 1, duration: 1 })
    .from(splitChars($$('[data-split]')[0]), { yPercent: 110, duration: 1.1, stagger: 0.035, ease: 'expo.out' }, 0.1)
    .from(splitChars($$('[data-split]')[1]), { yPercent: 110, duration: 1.1, stagger: 0.035, ease: 'expo.out' }, 0.25)
    .from('.intro__tag span', { yPercent: 110, duration: 0.9, ease: 'expo.out' }, 0.7)
    .from('#begin', { opacity: 0, scale: 0.85, duration: 0.8, ease: 'expo.out' }, 0.9);
}

$('#begin').addEventListener('click', () => {
  sound.start();
  $('#audio-btn').classList.add('on');
  const tl = gsap.timeline();
  tl.to('#intro', { opacity: 0, duration: 0.7 })
    .to('.loader__readout, .corner', { opacity: 0, duration: 0.5 }, 0)
    .set('#loader', { display: 'none' })
    .to(world.state, { pitch: -0.02, duration: 2, ease: 'power2.inOut' }, 0)
    .add(revealChrome, 0.4)
    .add(enterSurface, 0.6);
});

function revealChrome() {
  gsap.to('.brand, .nav > *, .menu-toggle', { opacity: 1, duration: 0.8, stagger: 0.06 });
  gsap.fromTo('#hud', { x: -20 }, { opacity: 1, x: 0, duration: 1, ease: 'expo.out' });
  gsap.fromTo('#audio-btn', { x: 20 }, { opacity: 1, x: 0, duration: 1, ease: 'expo.out' });
  $$('.nav [data-scramble]').forEach((el, i) => setTimeout(() => scramble(el, el.dataset.text), i * 90));
}

/* ---------- Surface: breathe + narration ---------- */
const breathTl = gsap.timeline({ paused: true, repeat: -1 });
const [inhale, exhale] = $$('#breath span');
breathTl
  .fromTo(inhale, { opacity: 0, letterSpacing: '0.15em' }, { opacity: 1, letterSpacing: '0.3em', duration: 1, ease: 'sine.out' }, 0)
  .to(world.state, { breath: 1, duration: 4, ease: 'sine.inOut', onUpdate: () => sound.setBreath(world.state.breath) }, 0)
  .to(inhale, { opacity: 0, duration: 0.8 }, 3.2)
  .fromTo(exhale, { opacity: 0, letterSpacing: '0.3em' }, { opacity: 1, letterSpacing: '0.6em', duration: 1.4, ease: 'sine.out' }, 4)
  .to(world.state, { breath: 0, duration: 4, ease: 'sine.inOut', onUpdate: () => sound.setBreath(world.state.breath) }, 4)
  .to(exhale, { opacity: 0, duration: 0.8 }, 7.2);

const lines = $$('#narration h2');
const lineChars = lines.map(splitChars);
let narrTl;
function playNarration() {
  narrTl = gsap.timeline({ repeat: -1 });
  lines.forEach((l, i) => {
    const at = i * 8;
    narrTl.set(l, { opacity: 1 }, at)
      .fromTo(lineChars[i], { opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0px)', duration: 0.8, stagger: 0.018 }, at + 0.2)
      .to(lineChars[i], { opacity: 0, filter: 'blur(6px)', duration: 0.6, stagger: 0.01 }, at + 6.6)
      .set(l, { opacity: 0 }, at + 7.8);
  });
}

function enterSurface() {
  view = 'surface';
  const v = $('#view-surface');
  gsap.set(v, { visibility: 'visible', opacity: 1 });
  v.classList.add('is-active');
  breathTl.play(0);
  playNarration();
  gsap.fromTo('#dive', { opacity: 0 }, { opacity: 1, duration: 1, delay: 1.5 });
}

/* ---------- Dive to journeys ---------- */
function dive() {
  if (view !== 'surface') return;
  view = 'diving';
  const v = $('#view-surface');
  v.classList.remove('is-active');
  narrTl?.kill();
  breathTl.pause();
  const tl = gsap.timeline();
  tl.to(v, { opacity: 0, duration: 0.6 })
    .set(v, { visibility: 'hidden' })
    .to(world.state, { breath: 0, duration: 0.6 }, 0)
    .to(world.state, { pitch: -0.25, duration: 1.4, ease: 'power2.in' }, 0.2)
    .to(world.state, { y: -4, duration: 1.6, ease: 'power2.in' }, 0.6)
    .to(world.state, { y: DEEP_Y, duration: 3.2, ease: 'power3.inOut' }, 2.1)
    .to(world.state, { pitch: 0.04, duration: 3, ease: 'power2.inOut' }, 2.3)
    .to(world.state, { reveal: 1, duration: 2.5, ease: 'power1.out' }, 3.8)
    .add(showJourneys, 4.6);
}
$('#dive').addEventListener('click', dive);

function showJourneys() {
  view = 'journeys';
  const v = $('#view-journeys');
  gsap.set(v, { visibility: 'visible', opacity: 1 });
  v.classList.add('is-active');
  const tl = gsap.timeline();
  tl.from('.jhead__mark', { opacity: 0, y: 14, duration: 0.8 })
    .from('.jhead__title span', { opacity: 0, yPercent: 40, duration: 1, stagger: 0.12, ease: 'expo.out' }, 0.1)
    .from('.jhead__copy', { opacity: 0, y: 12, duration: 0.8 }, 0.4)
    .from('.journey', { opacity: 0, y: 24, duration: 1, stagger: 0.12, ease: 'expo.out' }, 0.6)
    .from('.hint', { opacity: 0, duration: 0.8 }, 1.1);
  $$('.journey [data-scramble]').forEach((el) => scramble(el, el.dataset.text, 0.9));
}

/* ---------- Back to the surface ---------- */
function surface() {
  if (view !== 'journeys') return;
  view = 'rising';
  closeModal();
  const v = $('#view-journeys');
  v.classList.remove('is-active');
  gsap.timeline()
    .to(v, { opacity: 0, duration: 0.6 })
    .set(v, { visibility: 'hidden' })
    .to(world.state, { reveal: 0, duration: 1 }, 0)
    .to(world.state, { y: SURFACE_Y, duration: 3.4, ease: 'power3.inOut' }, 0.3)
    .to(world.state, { pitch: -0.02, duration: 3, ease: 'power2.inOut' }, 0.5)
    .add(enterSurface, 3.6);
}

$('#brand').addEventListener('click', (e) => {
  e.preventDefault();
  if (view === 'journey') exitJourney();
  else surface();
});
$('[data-go="journeys"]').addEventListener('click', (e) => {
  e.preventDefault();
  closeMenu();
  closeModal();
  if (view === 'journey') exitJourney();
  else dive();
});

/* ---------- Modal ---------- */
const modal = $('#modal');
let orbRaf;
function openModal(data) {
  $('#m-code').textContent = data.code;
  $('#m-eyebrow').textContent = data.eyebrow;
  $('#m-title').textContent = data.title;
  $('#m-copy').innerHTML = data.copy
    .map((c) => (Array.isArray(c) ? `<h4>${c[0]}</h4><p>${c[1]}</p>` : `<p>${c}</p>`))
    .join('');
  $('#m-stats').innerHTML = data.stats.map((s) => `<li>${s}</li>`).join('');

  modal.setAttribute('aria-hidden', 'false');
  gsap.set(modal, { visibility: 'visible' });
  gsap.timeline()
    .fromTo(modal, { opacity: 0 }, { opacity: 1, duration: 0.4 })
    .fromTo('.modal__edge', { scaleX: 0 }, { scaleX: 1, duration: 1, ease: 'expo.inOut' }, 0)
    .fromTo('.modal__panel', { clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)', duration: 1, ease: 'expo.inOut' }, 0.1)
    .fromTo('.modal__title, .modal__eyebrow', { yPercent: 30, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.9, stagger: 0.08, ease: 'expo.out' }, 0.6)
    .fromTo('.modal__body > * > *', { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.04, ease: 'expo.out' }, 0.7);
  scramble($('#m-kicker'), 'Field Report', 0.8);
  scramble($('#m-code'), data.code, 1);
  startOrb();
}

function closeModal() {
  if (modal.getAttribute('aria-hidden') === 'true') return;
  modal.setAttribute('aria-hidden', 'true');
  gsap.to(modal, { opacity: 0, duration: 0.4, onComplete: () => { gsap.set(modal, { visibility: 'hidden' }); cancelAnimationFrame(orbRaf); } });
}

$('#modal-close').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

$$('[data-open]').forEach((b) => b.addEventListener('click', () => startJourney(+b.dataset.open)));
$$('[data-modal]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    closeMenu();
    openModal(pages[a.dataset.modal]);
  }),
);

/* Dotted globe drawn on a 2D canvas for the modal */
function startOrb() {
  const c = $('#orb');
  const ctx = c.getContext('2d');
  const pts = [];
  for (let i = 0; i < 900; i++) {
    const y = 1 - (i / 899) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = i * 2.39996;
    pts.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  const t0 = performance.now();
  cancelAnimationFrame(orbRaf);
  const draw = (now) => {
    const a = (now - t0) * 0.00025;
    ctx.clearRect(0, 0, 320, 320);
    const g = ctx.createRadialGradient(130, 130, 10, 160, 160, 130);
    g.addColorStop(0, 'rgba(143,227,255,.22)');
    g.addColorStop(1, 'rgba(143,227,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(160, 160, 130, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(143,227,255,.35)';
    ctx.beginPath(); ctx.arc(160, 160, 148, 0, Math.PI * 2); ctx.stroke();
    for (const [x, y, z] of pts) {
      const rx = x * Math.cos(a) - z * Math.sin(a);
      const rz = x * Math.sin(a) + z * Math.cos(a);
      const k = (rz + 1) / 2;
      ctx.fillStyle = `rgba(160,230,255,${0.12 + k * 0.75})`;
      ctx.fillRect(160 + rx * 120, 160 - y * 120, 1.2 + k * 1.4, 1.2 + k * 1.4);
    }
    orbRaf = requestAnimationFrame(draw);
  };
  orbRaf = requestAnimationFrame(draw);
}

/* ---------- Header bits ---------- */
$('#lang-btn').addEventListener('click', () => $('#lang-list').classList.toggle('open'));
$$('#lang-list li').forEach((li) => li.addEventListener('click', () => $('#lang-list').classList.remove('open')));

function closeMenu() {
  $('#nav').classList.remove('open');
  $('#menu-toggle').classList.remove('open');
}
$('#menu-toggle').addEventListener('click', () => {
  const open = $('#nav').classList.toggle('open');
  $('#menu-toggle').classList.toggle('open', open);
});

/* ---------- Single journey ---------- */
let chapter = -1;
let busy = false;
const spot = $('#spot');
const spotPos = new THREE.Vector3();
let spotOn = false;

function veil(fn) {
  return gsap.timeline()
    .to('#veil', { opacity: 1, duration: 0.9, ease: 'power2.in' })
    .add(fn)
    .to('#veil', { opacity: 0, duration: 1.2, ease: 'power2.out' }, '+=0.15');
}

function startJourney(i) {
  if (view !== 'journeys') return;
  view = 'entering';
  discovered.add(i);
  scramble($('#hud-progress'), `${Math.round((discovered.size / journeys.length) * 100)}%`, 0.6);
  const hub = $('#view-journeys');
  hub.classList.remove('is-active');
  veil(() => {
    gsap.set(hub, { visibility: 'hidden' });
    world.openJourney(i);
    const j = journeys[i];
    chapter = -1;
    $('#ji-place').textContent = j.place;
    $('#ji-a').textContent = j.intro[0];
    $('#ji-b').textContent = j.intro[1];
    scramble($('#hud-loc'), j.place, 0.8);
    const v = $('#view-journey');
    gsap.set(v, { visibility: 'visible', opacity: 1 });
    gsap.set('#jintro', { autoAlpha: 1 });
    gsap.set('#chapter', { autoAlpha: 0 });
    v.classList.add('is-active');
    view = 'journey';
    gsap.timeline({ delay: 0.6 })
      .from('.jintro__eyebrow', { opacity: 0, y: 10, duration: 0.8 })
      .from('.jintro__title span', { opacity: 0, yPercent: 40, duration: 1.1, stagger: 0.12, ease: 'expo.out' }, 0.1)
      .from('.jintro__tag, #journey-start', { opacity: 0, duration: 0.8, stagger: 0.1 }, 0.6)
      .fromTo('#journey-exit', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6 }, 0.8);
  });
}

function goChapter(c) {
  const j = world.journey && journeys[world.journey.index];
  if (!j || busy || c < 0 || c >= j.chapters.length || c === chapter) return;
  busy = true;
  const first = chapter < 0;
  chapter = c;
  spotOn = false;
  gsap.to(spot, { autoAlpha: 0, duration: 0.3 });
  const panel = $('#chapter');
  const tl = gsap.timeline({ onComplete: () => { busy = false; } });
  if (first) tl.to('#jintro', { autoAlpha: 0, y: -20, duration: 0.7 });
  else tl.to(panel, { autoAlpha: 0, x: -16, duration: 0.5 });

  const pose = world.journey.poses[c + 1];
  tl.to(world.journey.pose, {
    px: pose.cam[0], py: pose.cam[1], pz: pose.cam[2],
    tx: pose.tgt[0], ty: pose.tgt[1], tz: pose.tgt[2],
    duration: 3.2, ease: 'power2.inOut',
  }, first ? 0.2 : 0.1);

  tl.add(() => {
    const ch = j.chapters[c];
    $('#ch-num').textContent = String(c + 1).padStart(2, '0');
    $('#ch-title').textContent = ch.title;
    $('#ch-text').textContent = ch.text;
    $('#ch-prev').disabled = c === 0;
    $('#ch-next-label').textContent = c === j.chapters.length - 1 ? 'Finish' : 'Next';
    $('#ch-bar').style.transform = `scaleX(${(c + 1) / j.chapters.length})`;
    $('#spot-label').textContent = ch.spot.label;
    spotPos.copy(world.journey.hotspot(c + 1));
  }, first ? 0.7 : 0.5);
  tl.fromTo(panel, { autoAlpha: 0, x: -16 }, { autoAlpha: 1, x: 0, duration: 0.8, ease: 'expo.out' }, '-=1.2');
  tl.add(() => {
    scramble($('#ch-title'), j.chapters[c].title, 0.7);
    spotOn = true;
    gsap.to(spot, { autoAlpha: 1, duration: 0.6 });
  }, '-=0.9');
}

function step(dir) {
  if (view !== 'journey' || chapter < 0 || modal.getAttribute('aria-hidden') === 'false') return;
  const total = journeys[world.journey.index].chapters.length;
  if (dir > 0 && chapter === total - 1) exitJourney();
  else goChapter(chapter + dir);
}

function exitJourney() {
  if (view !== 'journey') return;
  view = 'leaving';
  closeModal();
  spotOn = false;
  const v = $('#view-journey');
  v.classList.remove('is-active');
  veil(() => {
    gsap.set([v, spot, '#journey-exit', '#chapter'], { autoAlpha: 0 });
    gsap.set(v, { visibility: 'hidden' });
    world.closeJourney();
    chapter = -1;
    busy = false;
    scramble($('#hud-loc'), 'South Pacific', 0.8);
    const hub = $('#view-journeys');
    gsap.set(hub, { visibility: 'visible', opacity: 1 });
    hub.classList.add('is-active');
    view = 'journeys';
  });
}

$('#journey-start').addEventListener('click', () => goChapter(0));
$('#ch-next').addEventListener('click', () => step(1));
$('#ch-prev').addEventListener('click', () => step(-1));
$('#journey-exit').addEventListener('click', exitJourney);
spot.addEventListener('click', () => {
  const j = journeys[world.journey.index];
  const s = j.chapters[chapter].spot;
  openModal({ code: j.code, eyebrow: s.label, title: s.title, copy: s.copy, stats: s.stats });
});

let wheelLock = 0;
addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaY) < 12 || performance.now() < wheelLock) return;
  if (view !== 'journey' || chapter < 0 || busy) return;
  wheelLock = performance.now() + 1400;
  step(Math.sign(e.deltaY));
}, { passive: true });
let touchY = null;
addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
addEventListener('touchend', (e) => {
  if (touchY === null) return;
  const dy = touchY - e.changedTouches[0].clientY;
  touchY = null;
  if (Math.abs(dy) > 50 && !e.target.closest('.modal')) step(Math.sign(dy));
});
addEventListener('keydown', (e) => {
  if (['ArrowDown', 'ArrowRight', 'PageDown'].includes(e.key)) step(1);
  if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) step(-1);
});

const ndc = new THREE.Vector3();
gsap.ticker.add(() => {
  if (!spotOn || !world.journey) return;
  ndc.copy(spotPos).project(world.journey.camera);
  const hidden = ndc.z > 1 || Math.abs(ndc.x) > 1.1 || Math.abs(ndc.y) > 1.1;
  spot.style.visibility = hidden ? 'hidden' : 'visible';
  const x = (ndc.x * 0.5 + 0.5) * innerWidth;
  const y = (-ndc.y * 0.5 + 0.5) * innerHeight;
  spot.style.transform = `translate3d(${Math.min(x, innerWidth - 170)}px, ${y}px, 0)`;
});

runLoader();
