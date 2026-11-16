// Overdrive 009 landing page. The first view is plain HTML over a still poster of the robot; this module wires up the
// page (entrances, the arm drawing, the field legend, the tools list) and, once the page has loaded and gone idle,
// fetches the 3D stage (js/landing-3d.js, which pulls in three.js and the robot CAD) and cross-fades it in.
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

// ----- entrances: each block settles in once, when it first comes into view
const io = 'IntersectionObserver' in window
  ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.12 })
  : null;
document.querySelectorAll('.reveal, .rise').forEach((el) => (io ? io.observe(el) : el.classList.add('in')));

// ----- which side the stage copy is on (the ink wash follows it) and whether the hero is behind us
const stages = [...document.querySelectorAll('.stage')];
const onScroll = () => {
  const mid = window.innerHeight / 2;
  const here = stages.find((s) => { const r = s.getBoundingClientRect(); return r.top <= mid && r.bottom >= mid; });
  if (here) document.body.classList.toggle('at-right', here.classList.contains('right'));
  document.body.classList.toggle('past-hero', window.scrollY > window.innerHeight * 0.6);
};
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ----- side view: the arm is a parallelogram, so the claw translates and stays level as the links turn.
// Link angle = arm angle; the CAD pose is 52.098° with the claw centre 176 mm ahead of the axles and 171.2 mm up.
const LINK = 145.715, POSE = 52.098, CLAW = [176, 171.2], PIVOTS = { lower: [-9.5, 62.76], upper: [-9.5, 102.76] };
const STAR_TOP = 105.2, HIGH_TOP = 130.3, RING_HALF = 15;
const arm = document.getElementById('arm');
if (arm) {
  const g = Object.fromEntries([...document.querySelectorAll('[data-arm]')].map((el) => [el.dataset.arm, el]));
  const out = Object.fromEntries([...document.querySelectorAll('[data-o]')].map((el) => [el.dataset.o, el]));
  const rad = (d) => d * Math.PI / 180;
  const set = () => {
    const a = Number(arm.value), d = a - POSE;
    // SVG y points down, so a raise is a negative rotation about each pivot
    for (const k of ['lower', 'upper']) g[k].setAttribute('transform', `rotate(${(-d).toFixed(2)} ${PIVOTS[k][0]} ${-PIVOTS[k][1]})`);
    const dx = LINK * (Math.cos(rad(a)) - Math.cos(rad(POSE))), dy = LINK * (Math.sin(rad(a)) - Math.sin(rad(POSE)));
    g.end.setAttribute('transform', `translate(${dx.toFixed(2)} ${(-dy).toFixed(2)})`);
    const h = CLAW[1] + dy, under = h - RING_HALF;
    out.deg.textContent = `${a.toFixed(1)}°`;
    out.h.textContent = Math.round(h);
    out.clear.textContent = under > HIGH_TOP ? 'Clears the HIGH pole top' : under > STAR_TOP ? 'Clears the STAR pole top' : h < RING_HALF + 2 ? 'On the floor: pick-up' : 'Below the pole tops';
  };
  arm.addEventListener('input', set);
  set();
}

// ----- field legend: pick a scoring row to light it up on the field
const field = document.querySelector('.field-svg');
const rows = [...document.querySelectorAll('.score-list button')];
if (field && rows.length) {
  const parts = [...field.querySelectorAll('[data-k]')];
  let pinned = null;
  const show = (k) => {
    field.classList.toggle('dim', !!k);
    for (const p of parts) p.classList.toggle('lit', !!k && p.dataset.k.split(' ').includes(k));
  };
  for (const b of rows) {
    b.addEventListener('click', () => {
      pinned = pinned === b.dataset.k ? null : b.dataset.k;
      for (const r of rows) r.setAttribute('aria-pressed', String(r.dataset.k === pinned));
      show(pinned);
    });
    b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') show(b.dataset.k); });
    b.addEventListener('focus', () => show(b.dataset.k));
  }
  const list = rows[0].closest('ol');
  list.addEventListener('pointerleave', () => show(pinned));
  list.addEventListener('focusout', (e) => { if (!list.contains(e.relatedTarget)) show(pinned); });
}

// ----- team tools: one open at a time (a list of tabs beside one preview on wide screens, an accordion on phones)
const tools = [...document.querySelectorAll('.tool')];
for (const t of tools) {
  t.querySelector('.tool-tab').addEventListener('click', () => {
    for (const o of tools) { o.classList.toggle('on', o === t); o.querySelector('.tool-tab').setAttribute('aria-expanded', String(o === t)); }
  });
}

// ----- the 3D stage (three.js, the robot CAD and the venue, about 2.5 MB): on desktops once the page has loaded and gone
// quiet; on phones only when the reader scrolls toward the robot section, so a phone that reads the top never pays
// for it. Never on a data-saver connection. Until it is ready the poster and the venue still stand in for it.
const phone = window.matchMedia('(max-width: 767px)').matches || /Mobi|Android/i.test(navigator.userAgent);
if (!navigator.connection?.saveData) {
  const go = () => import('./landing-3d.js').then((m) => m.start({ reduce })).catch((e) => console.warn('3D stage', e));
  if (phone && 'IntersectionObserver' in window) {
    const near = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { near.disconnect(); go(); } }, { rootMargin: `${window.innerHeight}px 0px` });
    near.observe(document.getElementById('robot'));
  } else {
    const idle = () => ('requestIdleCallback' in window ? requestIdleCallback(go, { timeout: 2500 }) : setTimeout(go, 600));
    if (document.readyState === 'complete') idle(); else window.addEventListener('load', idle, { once: true });
  }
}
