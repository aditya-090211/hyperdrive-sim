// The Viora page (viora.html): the indicator-ink hero, the strip demo and the "how it works" drawings.
// The colour maths is the Viora app's (js/color.js on the Viora site), cut down to what the demo needs.
import { startInk } from './viora-ink.js';

startInk(document.getElementById('hero'), document.querySelector('#hero .ink'));

// ----- the strip demo: hours without water -> pad colour -> hue -> score, band and pH
// Reference colours from the saliva trial (tube pairs averaged, white-balanced against the bench)
const REFS = [{ hex: '#735a78', score: 15 }, { hex: '#5b4963', score: 55 }, { hex: '#7a7698', score: 85 }];
const BANDS = [{ max: 30, name: 'Dehydrated' }, { max: 50, name: 'Mildly dehydrated' }, { max: 75, name: 'Hydrated' }, { max: 101, name: 'Well hydrated' }];
// anthocyanin hue -> pH, an approximation from typical red-cabbage indicator behaviour nudged to the trial hues
const PH_CURVE = [[345, 4.5], [320, 5.4], [300, 6.0], [288, 6.6], [255, 7.3], [230, 7.7], [180, 8.5], [120, 9.5], [70, 11]];
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hexOf = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const hueOf = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (!d) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
};
const unwrap = (h) => (h < 30 ? h + 360 : h);           // reds just past 0 belong to the acidic end
const clamp = (v) => Math.max(0, Math.min(100, v));
const scoreOf = (hue) => {
  const h = unwrap(hue), pts = REFS.map((r) => [unwrap(hueOf(rgbOf(r.hex))), r.score]).sort((a, b) => b[0] - a[0]);
  if (h >= pts[0][0]) return clamp(pts[0][1] - (h - pts[0][0]) * 1.5);
  const last = pts[pts.length - 1];
  if (h <= last[0]) return clamp(last[1] + (last[0] - h) * 0.6);
  for (let i = 0; i < pts.length - 1; i++) {
    const [h1, s1] = pts[i], [h2, s2] = pts[i + 1];
    if (h <= h1 && h >= h2) return clamp(h1 === h2 ? (s1 + s2) / 2 : s1 + (s2 - s1) * (h1 - h) / (h1 - h2));
  }
  return 50;
};
const phOf = (hue) => {
  const h = unwrap(hue);
  if (h >= PH_CURVE[0][0]) return PH_CURVE[0][1];
  for (let i = 0; i < PH_CURVE.length - 1; i++) {
    const [h1, p1] = PH_CURVE[i], [h2, p2] = PH_CURVE[i + 1];
    if (h <= h1 && h >= h2) return p1 + (p2 - p1) * (h1 - h) / (h1 - h2);
  }
  return PH_CURVE[PH_CURVE.length - 1][1];
};

const v = Object.fromEntries([...document.querySelectorAll('[data-v]')].map((el) => [el.dataset.v, el]));
const hours = document.getElementById('hours');
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const dry = rgbOf(REFS[2].hex), wet = rgbOf(REFS[0].hex);
let lastWick = 0;
const setHours = (hrs) => {
  const t = Math.min(1, Math.max(0, hrs / 12)), e = t * t * (3 - 2 * t) * 0.6 + t * 0.4;
  const rgb = dry.map((c, i) => c + (wet[i] - c) * e), hex = hexOf(rgb), hue = hueOf(rgb), score = Math.round(scoreOf(hue));
  v.pad.setAttribute('fill', hex);
  v.hours.textContent = `${hrs.toFixed(1)} h`;
  v.band.textContent = (BANDS.find((b) => score < b.max) || BANDS[3]).name;
  v.pin.style.setProperty('--s', score);
  v.score.textContent = score;
  v.ph.textContent = phOf(hue).toFixed(1);
  v.hex.textContent = hex;
  const now = performance.now();
  if (!reduce.matches && now - lastWick > 500) { lastWick = now; v.wick.classList.remove('wick'); void v.wick.getBBox(); v.wick.classList.add('wick'); }
};
hours.addEventListener('input', () => setHours(Number(hours.value)));
setHours(Number(hours.value));

// ----- how it works: each drawing sketches itself once, when it comes into view
const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('on'); io.unobserve(e.target); } }), { threshold: 0.35 });
document.querySelectorAll('.pipe li').forEach((li) => io.observe(li));
