# Field Assembly Final.step -> hyperdrive-sim/assets/field.{json,bin}
# input: field_meshes.json (FreeCAD tessellation, raw CAD frame: mm, Z up). Tiles, floor markings and COREs are drawn by the sim.
import json, sys, re, numpy as np
src, outdir = sys.argv[1], sys.argv[2]
parts = json.load(open(src))
IN = 25.4
XC, YC, ZT = (-2114.5 + 1544.5) / 2, (-2940 + 713) / 2, -1073.0     # field centre and tile-top height in the CAD frame
def to_diag(v):   # CAD mm -> field diagram inches (X right, Y down from the red wall, Z up from the tiles)
  return np.stack([72 + (v[:, 0] - XC) / IN, 72 - (v[:, 1] - YC) / IN, (v[:, 2] - ZT) / IN], 1)
def to_world(v):  # CAD mm -> sim metres (x right, y up, z toward blue)
  return np.stack([(v[:, 0] - XC) / 1000, (v[:, 2] - ZT) / 1000, -(v[:, 1] - YC) / 1000], 1)
RED, BLUE = '#c4202b', '#1d48c8'
def style(label, squad):
  sq = RED if squad == 'red' else BLUE
  L = [
    (r'^Wall', ('#1b1e23', 0.2, 0.55, 1, 0)),
    (r'^LED', ('#eaf2ff', 0.0, 0.3, 1, 1)),
    (r'^(122mm|cone insert|vert pole base 1|angle pole insert|Ramp scoring Pipe|Silo PIPE insert)', (sq, 0.15, 0.4, 1, 0)),
    (r'^100mm pole', ('#d9dee6', 0.7, 0.25, 1, 0)),
    (r'^vert pole insert', ('#8a929c', 0.6, 0.35, 1, 0)),
    (r'^(150mm|65mm|85mm|400mm) pipe$|^(150mm|65mm|85mm|400mm) pipe|^(45 deg|90 dec) connectors|^t connectore', (sq, 0.05, 0.45, 1, 0)),
    (r'^Part104', (sq, 0.05, 0.35, 0.55, 0)),
    (r'^(full bent top poly|ramp v2v3|ramp side bend|Ramp covering|ramp bottom poly|Base_2v3v2|acrylic silo|SOLID)', ('#dfe7f1', 0.05, 0.08, 0.32, 0)),
    (r'^400mm speed breaker|^ramp bumper', ('#1d2025', 0.1, 0.7, 1, 0)),
    (r'^3ft pole', ('#16181b', 0.35, 0.45, 1, 0)),
    (r'^buzzer', (sq, 0.1, 0.3, 1, 1)),
    (r'.', ('#3a4048', 0.6, 0.35, 1, 0)),
  ]
  for rx, s in L:
    if re.search(rx, label): return s
DECK = re.compile(r'^(full bent top poly|ramp v2v3|Part104|12 deg_[12]|12 deg support|MirrorPart33|Bumper_support|hard stop)')
DECK_HULL = re.compile(r'^(full bent top poly|ramp v2v3)')
RAMP = re.compile(r'^(ramp side bend|400mm speed breaker|ramp bumper new)')
POLE_FAM = re.compile(r'^(122mm|100mm|cone insert|vert pole base 1|vert pole insert)')
# station anchors (diagram inches): pivot axis along X through the pivot bearings, ramp hinges at the deck ends
anchor = {}
for sq, (lo, hi) in (('red', (0, 30)), ('blue', (114, 150))):
  pv = [to_diag(np.array(p['v'], float)) for p in parts if p['label'].startswith('Pivot mech 2')]
  pv = [d for d in pv if lo < d[:, 0].mean() < hi]
  allp = np.concatenate(pv)
  px = (allp[:, 0].min() + allp[:, 0].max()) / 2; pz = (allp[:, 2].min() + allp[:, 2].max()) / 2
  deck = np.concatenate([to_diag(np.array(p['v'], float)) for p in parts if DECK_HULL.match(p['label']) and lo < to_diag(np.array(p['v'], float))[:, 0].mean() < hi])
  y0, y1 = deck[:, 1].min(), deck[:, 1].max()
  anchor[sq] = {'pivot': [px, (y0 + y1) / 2, pz], 'hingeN': [px, y0, 8.9], 'hingeS': [px, y1, 8.9], 'deckX': [deck[:, 0].min(), deck[:, 0].max()], 'deckY': [y0, y1]}
def w_of(d):  # diagram inches -> world metres
  return np.array([(d[0] - 72) * IN / 1000, d[2] * IN / 1000, (d[1] - 72) * IN / 1000])
groups = {}
hulls = {}
for p in parts:
  v = np.array(p['v'], float); f = np.array(p['f'], int); lab = p['label']
  dg = to_diag(v); cx, cy = dg[:, 0].mean(), dg[:, 1].mean()
  squad = ('red' if cy < 72 else 'blue') if POLE_FAM.match(lab) else ('red' if cx < 72 else 'blue')
  g, origin = 'static', np.zeros(3)
  if DECK.match(lab) and 0 < cx < 30 or DECK.match(lab) and 114 < cx < 150:
    g, origin = 'deck_' + squad, w_of(anchor[squad]['pivot'])
  elif RAMP.match(lab):
    side = 'N' if cy < 72 else 'S'
    g, origin = 'ramp' + side + '_' + squad, w_of(anchor[squad]['hinge' + side])
  w = to_world(v) - origin
  st = style(lab, squad)
  b = groups.setdefault((g,) + st, {'v': [], 'f': [], 'n': 0})
  b['v'].append(w); b['f'].append(f[:, [0, 2, 1]] + b['n']); b['n'] += len(w)
  hk = None
  if g.startswith('deck') and DECK_HULL.match(lab): hk = g
  elif g.startswith('ramp') and lab.startswith('ramp side bend'): hk = g
  elif lab.startswith('Ramp covering'): hk = 'cover_' + squad
  elif re.match(r'^(acrylic silo|SOLID)', lab) and dg[:, 2].max() < 3.3 and np.ptp(dg[:, 0]) < 3.6 and np.ptp(dg[:, 1]) > 2: hk = 'wing_%s_%d' % (squad, len([k for k in hulls if k.startswith('wing_' + squad)]))
  if hk:
    hulls.setdefault(hk, []).append(w)
# deck and ramps: collide on the driving surface itself. The panels have raised side guards (deck) and bent side
# flanges (ramps) whose convex hull would lift the surface or blunt the ramp toe, so the surface profile is taken
# from the centre strip and swept across the full width; the deck's side guards get hulls of their own.
def slab(pts, thick=0.008, step=0.01):
  x0, x1 = pts[:, 0].min(), pts[:, 0].max(); xc = (x0 + x1) / 2
  inner = pts[np.abs(pts[:, 0] - xc) < (x1 - x0) / 2 - 0.035]
  bins = np.round(inner[:, 2] / step).astype(int)
  out = []
  for b in np.unique(bins):
    yt = inner[bins == b, 1].max(); z = b * step
    for x in (x0, x1):
      out += [[x, yt, z], [x, yt - thick, z]]
  return np.array(out)
for k in list(hulls):
  if not (k.startswith('deck') or k.startswith('ramp')): continue
  pts = np.concatenate(hulls[k])
  if k.startswith('deck'):
    x0, x1 = pts[:, 0].min(), pts[:, 0].max()
    hulls[k.replace('deck', 'guardL')] = [pts[pts[:, 0] < x0 + 0.03]]
    hulls[k.replace('deck', 'guardR')] = [pts[pts[:, 0] > x1 - 0.03]]
  sl = slab(pts)
  if k.startswith('ramp'):
    # the CAD plate stops 1.5 in short of the floor; the arena sheet's ramp is 16 in long at 147° to the deck,
    # so extend the plate along its own slope to 16 in (it then rests on its toe at ~33°)
    zf = sl[np.abs(sl[:, 2]).argmax(), 2]; yf = sl[np.abs(sl[:, 2] - zf) < 1e-6, 1].max()
    L = np.hypot(zf, yf); ext = 16 * IN / 1000 / L
    tip = [[x, y * ext, zf * ext] for x in (sl[:, 0].min(), sl[:, 0].max()) for y in (yf, yf - 0.008)]
    sl = np.concatenate([sl, np.array(tip)])
  hulls[k] = [sl]
hulls = {k: [np.unique(np.round(np.concatenate(v) / 0.002) * 0.002, axis=0)] for k, v in hulls.items()}
bin_ = bytearray(); meta_parts = []
SCALE = 2.6 / 32767
for (g, col, me, ro, op, em), b in groups.items():
  V = np.concatenate(b['v']); F = np.concatenate(b['f']).astype(np.uint32).ravel()
  q = np.round(V / SCALE).astype(np.int16).ravel()
  while len(bin_) % 4: bin_ += b'\0'
  pOff = len(bin_); bin_ += q.tobytes()
  i16 = V.shape[0] < 65536
  while len(bin_) % 4: bin_ += b'\0'
  iOff = len(bin_); bin_ += (F.astype(np.uint16) if i16 else F).tobytes()
  meta_parts.append(dict(group=g, color=col, metalness=me, roughness=ro, opacity=op, emissive=em, pOff=pOff, pLen=len(q), iOff=iOff, iLen=len(F), i16=bool(i16)))
r5 = lambda a: [round(float(x), 5) for x in a]
meta = {
  'source': 'Field Assembly Final.step (Onshape export): tiles, floor markings and COREs omitted, meshes decimated',
  'frame': 'metres; x right (red station side = -x), y up from the tile surface, z toward the blue wall; field centre at the origin',
  'format': 'int16', 'posScale': SCALE,
  'stations': {s: {'pivot': r5(w_of(a['pivot'])), 'hingeN': r5(w_of(a['hingeN'])), 'hingeS': r5(w_of(a['hingeS'])),
                   'deckX': r5([(x - 72) * IN / 1000 for x in a['deckX']]), 'deckZ': r5([(y - 72) * IN / 1000 for y in a['deckY']])} for s, a in anchor.items()},
  'hulls': {k: [round(float(x), 4) for x in np.unique(np.concatenate(v), axis=0).ravel()] for k, v in hulls.items()},
  'parts': meta_parts,
}
open(outdir + '/field.bin', 'wb').write(bytes(bin_))
json.dump(meta, open(outdir + '/field.json', 'w'), separators=(',', ':'))
print('parts', len(meta_parts), 'bytes', len(bin_), 'tris', sum(p['iLen'] for p in meta_parts) // 3)
print(json.dumps(meta['stations'], indent=1)); print({k: len(v) // 3 for k, v in meta['hulls'].items()})
