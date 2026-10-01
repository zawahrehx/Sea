const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#/<>_';

/** Resolve text left-to-right through random glyphs. */
export function scramble(el, text = el.dataset.text || el.textContent, duration = 0.6) {
  el.dataset.text = text;
  cancelAnimationFrame(el._scr);
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - start) / (duration * 1000));
    const fixed = Math.floor(p * text.length);
    let out = text.slice(0, fixed);
    for (let i = fixed; i < text.length; i++) {
      out += text[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }
    el.textContent = out;
    if (p < 1) el._scr = requestAnimationFrame(tick);
  };
  el._scr = requestAnimationFrame(tick);
}

export function bindScrambleHover(root = document) {
  root.querySelectorAll('[data-scramble]').forEach((el) => {
    el.dataset.text = el.textContent.trim();
    const host = el.closest('a, button') || el;
    host.addEventListener('mouseenter', () => scramble(el, el.dataset.text, 0.45));
  });
}
