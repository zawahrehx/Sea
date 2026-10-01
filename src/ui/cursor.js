export function initCursor(el) {
  const pos = { x: innerWidth / 2, y: innerHeight / 2 };
  const target = { ...pos };
  addEventListener('pointermove', (e) => {
    target.x = e.clientX;
    target.y = e.clientY;
    el.classList.toggle('is-hover', !!e.target.closest('a, button, [data-open]'));
  });
  const loop = () => {
    pos.x += (target.x - pos.x) * 0.2;
    pos.y += (target.y - pos.y) * 0.2;
    el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
    requestAnimationFrame(loop);
  };
  loop();
}
