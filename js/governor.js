// Render quality for every 3D view. The GPU decides a starting tier once; after that the resolution only ever steps
// down, and only after a sustained slowdown. Stepping up and down with the frame rate reallocates the canvas each time
// and shows as a pop, which reads as a glitch, so it never climbs back during a visit.
const LOW_GPU = /intel|uhd|iris|mali|adreno|powervr|swiftshader|llvmpipe|basic render/i;

export function gpuTier(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (LOW_GPU.test(name) || /Mobi|Android/i.test(navigator.userAgent)) return 'low';
  } catch { /* no renderer info: assume a capable GPU and let the governor step down if needed */ }
  return 'high';
}

// the device-pixel-ratio cap for a tier: integrated GPUs render at CSS resolution, others at up to 1.5x
export const prCap = (tier) => Math.min(window.devicePixelRatio || 1, tier === 'low' ? 1 : 1.5);

// call frame(dt) every frame; onChange(scale) fires when the render scale drops. hold(s) ignores the next s seconds
// (loading, shader compiles) so a one-off hitch never counts as a slow device. The threshold sits just under 60 fps:
// a frame that takes 17-20 ms is shown alternately for one and two refreshes, which reads as judder, so a little
// resolution is traded for even pacing as soon as the average settles below ~54 fps.
// key: remember the settled scale on this device, so the next visit starts there instead of finding it again.
// start: the scale to begin at (a decorative backdrop on an integrated GPU starts a little lower)
export function createGovernor({ min = 0.6, step = 0.15, slowFps = 54, windows = 3, key = null, start = 1, onChange } = {}) {
  const store = key && `od.render.${key}`;
  let scale = start, t = 0, n = 0, bad = 0, hold = 1.5, dts = [];
  try { const v = Number(localStorage.getItem(store)); if (store && v >= min && v <= 1) scale = v; } catch { /* storage unavailable */ }
  return {
    get scale() { return scale; },
    hold(s) { hold = Math.max(hold, s); t = 0; n = 0; dts = []; },
    // forget the stored scale (the player changed the graphics setting)
    reset() { scale = start; bad = 0; t = 0; n = 0; dts = []; try { if (store) localStorage.removeItem(store); } catch { /* storage unavailable */ } onChange?.(scale); },
    frame(dt) {
      if (hold > 0) { hold -= dt; return; }
      t += dt; n++; dts.push(dt);
      if (t < 2) return;
      const avg = t / n;
      // the display's own frame interval (a 50 Hz panel, or a browser capped at 30 fps) is not a slow GPU: only
      // count a window as slow when frames take clearly longer than the screen's refresh
      const refresh = dts.sort((a, b) => a - b)[Math.floor(dts.length * 0.1)] || avg;
      t = 0; n = 0; dts = [];
      bad = avg > Math.max(1 / slowFps, refresh * 1.2) ? bad + 1 : 0;
      if (bad >= windows && scale > min + 1e-3) {
        scale = Math.max(min, +(scale - step).toFixed(2)); bad = 0; hold = 2;
        try { if (store) localStorage.setItem(store, String(scale)); } catch { /* storage unavailable */ }
        onChange?.(scale);
      }
    },
  };
}

// compile every shader the scene can need, hidden objects included, without blocking the page. three's compileAsync
// skips invisible objects, so anything shown later (the heat map, banners, game pieces) would otherwise compile on the
// frame it first appears, which is a visible hitch
export async function compileAll(renderer, scene, camera) {
  const hidden = [];
  scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  try { await renderer.compileAsync(scene, camera); } catch { /* compiles on first draw instead */ } finally { for (const o of hidden) o.visible = false; }
}
