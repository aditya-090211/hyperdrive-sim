// Viora's indicator ink, as on the Viora site: anthocyanin from purple cabbage shifts from pink through violet to blue
// as a strip takes up water, so here the ink turns blue under the pointer and where you tap (a ripple soaks outward).
// One full-screen WebGL triangle. Started by js/landing.js when the Viora section comes near; it renders only while
// the section is on screen and the tab is visible, at a capped resolution that drops further on slow GPUs. With
// reduced motion it draws a still frame and redraws only when you move or tap.
const FRAG = `
precision mediump float;
uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse; uniform float uMouseOn; uniform vec4 uRip[6]; uniform float uSide;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0., a = .5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 5; i++){ v += a * n(p); p = m * p; a *= .5; } return v; }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes, p = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
  float t = uTime, wet = 0.;
  for (int i = 0; i < 6; i++){
    vec4 r = uRip[i]; if (r.z < 0.) continue;
    float age = t - r.z; if (age > 6.) continue;
    vec2 d = p - r.xy; float L = length(d), front = age * .42;
    float ring = exp(-abs(L - front) * 14.) * exp(-age * .7);
    p += normalize(d + 1e-4) * sin(L * 38. - age * 9.) * ring * .035;
    wet += smoothstep(front + .05, front - .25, L) * exp(-age * .35);
  }
  vec2 m = (uMouse - .5 * uRes) / uRes.y;
  float near = uMouseOn * exp(-length(p - m) * 2.6);
  p += (p - m) * near * .06;
  vec2 q = vec2(fbm(p * 1.5 + t * .045), fbm(p * 1.5 + vec2(5.2, 1.3) - t * .04));
  vec2 r = vec2(fbm(p * 1.5 + 3.6 * q + vec2(1.7, 9.2) + t * .06), fbm(p * 1.5 + 3.6 * q + vec2(8.3, 2.8) - t * .05));
  float f = fbm(p * 1.5 + 3.6 * r);
  float hyd = clamp(.22 + .55 * r.x - .25 * q.y + near * 1.7 + wet * 1.3, 0., 1.);
  vec3 col = mix(vec3(.80, .33, .52), vec3(.60, .30, .60), smoothstep(0., .35, hyd));
  col = mix(col, vec3(.43, .30, .66), smoothstep(.3, .62, hyd));
  col = mix(col, vec3(.30, .46, .95), smoothstep(.58, .95, hyd));
  vec3 bg = vec3(.043, .035, .063);
  float dens = clamp(f * 1.55 - .28 + .35 * length(r) - .12 * length(q), 0., 1.);
  vec3 c = mix(bg, col, dens);
  c += pow(max(f - .56, 0.) * 2.3, 3.) * vec3(1., .93, 1.) * .85;
  c += vec3(.35, .5, 1.) * near * .24 * (.35 + dens);
  // the Viora page fades the ink into its foot as the Viora site does; a band with copy on its left darkens that side
  c *= 1. - .55 * pow(length(uv - mix(vec2(.5, .45), vec2(.62, .5), uSide)) * 1.15, 2.2);
  c = mix(c, bg, mix(smoothstep(.22, 0., uv.y) * .9, smoothstep(.55, 0., uv.x) * .55, uSide));
  c += (h(gl_FragCoord.xy + fract(t) * 91.) - .5) * .035;
  gl_FragColor = vec4(c, 1.);
}`;

export function startInk(section, canvas, { side = false } = {}) {
  const gl = canvas.getContext('webgl', { antialias: false, powerPreference: 'low-power' });
  if (!gl) { canvas.remove(); return; }
  const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }'));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); return; }
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const U = (k) => gl.getUniformLocation(prog, k);
  const uRes = U('uRes'), uTime = U('uTime'), uMouse = U('uMouse'), uMouseOn = U('uMouseOn'), uRip = U('uRip');
  gl.uniform1f(U('uSide'), side ? 1 : 0);

  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rip = new Float32Array(24).fill(-1);
  const t0 = performance.now(), now = () => (performance.now() - t0) / 1000;
  let W = 2, H = 2, scale = 0.6, mx = 0, my = 0, smx = 0, smy = 0, mOn = 0, mTarget = 0, ripI = 0;
  let raf = 0, onScreen = false, frames = 0, slow = 0;

  const draw = (t) => {
    smx += (mx - smx) * 0.12; smy += (my - smy) * 0.12; mOn += (mTarget - mOn) * 0.06;
    gl.uniform2f(uRes, W, H); gl.uniform1f(uTime, t); gl.uniform2f(uMouse, smx, smy); gl.uniform1f(uMouseOn, mOn); gl.uniform4fv(uRip, rip);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const resize = () => {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = Math.max(2, Math.round(r.width * dpr * scale)); H = Math.max(2, Math.round(r.height * dpr * scale));
    canvas.width = W; canvas.height = H; gl.viewport(0, 0, W, H);
    if (still) draw(8);
  };
  const loop = () => {
    const s = performance.now();
    draw(now());
    frames++; slow += performance.now() - s;
    if (frames === 40) { if (slow / 40 > 12 && scale > 0.3) { scale -= 0.15; resize(); } frames = 0; slow = 0; }
    raf = onScreen && !document.hidden ? requestAnimationFrame(loop) : 0;
  };
  const wake = () => { if (!still && !raf && onScreen && !document.hidden) raf = requestAnimationFrame(loop); };
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (1 - (e.clientY - r.top) / r.height) * H]; };

  // the pointer is tracked over the whole section, so the ink answers under the copy as well
  section.addEventListener('pointermove', (e) => { [mx, my] = at(e); mTarget = 1; if (still) { smx = mx; smy = my; mOn = 1; draw(8); } });
  section.addEventListener('pointerleave', () => { mTarget = 0; if (still) { mOn = 0; draw(8); } });
  section.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a, button')) return;
    const [x, y] = at(e), k = ripI++ % 6;
    rip[k * 4] = (x - 0.5 * W) / H; rip[k * 4 + 1] = (y - 0.5 * H) / H; rip[k * 4 + 2] = still ? 7.4 : now();
    if (still) draw(8);
  });
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver((es) => { onScreen = es[0].isIntersecting; wake(); }).observe(section);
  document.addEventListener('visibilitychange', wake);
  resize();
  section.classList.add('ink-on');
}
