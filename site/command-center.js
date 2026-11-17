// BeatBots "Command Center" chrome: clock, spectrum + VU bars, HUD ring ticks, active console module.
// Purely visual; does not touch any game, audio or mint logic.
(function () {
  const $ = (s) => document.querySelector(s);

  function bars(el, n, a, b) {
    if (!el) return;
    let h = '';
    for (let i = 0; i < n; i++) {
      h += `<i style="animation-duration:${(a + Math.random() * (b - a)).toFixed(2)}s;animation-delay:${(-Math.random() * 2).toFixed(2)}s"></i>`;
    }
    el.innerHTML = h;
  }

  function ticks() {
    const g = $('#cc-ticks');
    if (!g) return;
    let tk = '';
    for (let i = 0; i < 120; i++) {
      const a = (i * 3 * Math.PI) / 180, l = i % 10 ? 6 : 14, r1 = 180, r2 = r1 + l;
      tk += `<line x1="${(250 + r1 * Math.cos(a)).toFixed(1)}" y1="${(250 + r1 * Math.sin(a)).toFixed(1)}" x2="${(250 + r2 * Math.cos(a)).toFixed(1)}" y2="${(250 + r2 * Math.sin(a)).toFixed(1)}" stroke="${i % 10 ? '#24396B' : '#00E5FF'}"/>`;
    }
    g.innerHTML = tk;
  }

  function clock() {
    const c = $('#cc-clock');
    if (!c) return;
    const tick = () => { c.textContent = new Date().toLocaleTimeString('en-GB') + ' LOCAL'; };
    tick();
    setInterval(tick, 1000);
  }

  function bpmMirror() {
    const src = $('#bpm-val'), dst = $('#cc-bpm');
    if (!src || !dst) return;
    const sync = () => { dst.textContent = (src.textContent || '').trim() || dst.textContent; };
    sync();
    new MutationObserver(sync).observe(src, { childList: true, characterData: true, subtree: true });
  }

  function activeModule() {
    const mods = [...document.querySelectorAll('.console .mod')];
    if (!mods.length || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) mods.forEach((m) => m.classList.toggle('on', m.getAttribute('href') === '#' + e.target.id));
    }), { rootMargin: '-45% 0px -50% 0px' });
    document.querySelectorAll('main section[id]').forEach((s) => io.observe(s));
  }

  function init() {
    bars($('#cc-spectrum'), innerWidth < 760 ? 40 : 96, 0.35, 1.1);
    bars($('#cc-vu'), 14, 0.3, 0.9);
    ticks();
    clock();
    bpmMirror();
    activeModule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
