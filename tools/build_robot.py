# robot CAD -> hyperdrive-sim/assets/robot.{json,bin}
#   python tools/build_robot.py robot_meshes.json motion.json assets
# robot_meshes.json: FreeCAD tessellation in the normalised CAD frame (mm, X fwd, Y left, Z up, ground z=0) from
# tools/cad_tessellate.py; motion.json: the pivots measured on the CAD by tools/cad_normalize_robot.py
import json, sys, re, numpy as np
src, motion, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
parts = json.load(open(src))
M = json.load(open(motion))['meta']
PAL = [  # (regex on label, colour, metalness, roughness, opacity)
  (r'^Wheel Grip', '#16181b', 0.0, 0.92, 1),
  (r'^wheel_base', '#d6dbe1', 0.35, 0.45, 1),
  (r'^Wheel insert', '#8f98a4', 0.6, 0.35, 1),
  (r'^Arm___', '#3d4652', 0.45, 0.4, 1),
  (r'^new_finger', '#2a2f37', 0.4, 0.45, 1),
  (r'^(Driving|Follower) Gear|^Gear Spacer|^Servo.?Horn', '#4a515c', 0.5, 0.4, 1),
  (r'^PC cover', '#a9bdd2', 0.1, 0.12, 0.38),
  (r'^HEXA_COMMAND_CONTROLLER_PCB', '#1d5f4a', 0.1, 0.5, 1),
  (r'^Board', '#0f6a35', 0.1, 0.5, 1),
  (r'^1\.3 inch', '#0b0c0e', 0.2, 0.3, 1),
  (r'^DC Motor__', '#c8ced7', 0.75, 0.3, 1),
  (r'^DC Motor Mount|^Base Block|^Connector|^New Number Plate', '#2c3037', 0.3, 0.5, 1),
  (r'^Battery__', '#26303c', 0.1, 0.6, 1),
  (r'^(Gripper )?Servo Motor|^MG90S', '#1f2227', 0.1, 0.55, 1),
  (r'^ACRYLIC', '#16181c', 0.15, 0.25, 1),
  (r'^PRINTED', '#2a2f37', 0.05, 0.7, 1),
  (r'^Connecting Rod', '#d3d8de', 0.8, 0.25, 1),
  (r'^(top|bottom) holder', '#1a1c20', 0.1, 0.6, 1),
  (r'^\d+(\.\d+)?mm [Ss]pacer', '#a7afb9', 0.7, 0.3, 1),
  (r'.', '#9aa3ae', 0.55, 0.38, 1),
]
def style(label):
  for rx, c, me, ro, op in PAL:
    if re.search(rx, label): return c, me, ro, op
def box(b):
  (x0,y0,z0),(x1,y1,z1)=b
  v=[[x,y,z] for x in (x0,x1) for y in (y0,y1) for z in (z0,z1)]
  f=[[0,1,3],[0,3,2],[4,6,7],[4,7,5],[0,4,5],[0,5,1],[2,3,7],[2,7,6],[0,2,6],[0,6,4],[1,5,7],[1,7,3]]
  return v,f
buckets = {}
for p in parts:
  v = np.array(p['v'], float); f = np.array(p['f'], int)
  if re.match(r'^(HEXA_COMMAND_CONTROLLER_PCB|Board)', p['label']):   # thousands of drill holes: draw the board as a slab
    bv, bf = box((v.min(0), v.max(0))); v = np.array(bv, float); f = np.array(bf)
  c, me, ro, op = style(p['label'])
  key = (p['group'], c, me, ro, op)
  b = buckets.setdefault(key, {'v': [], 'f': [], 'names': set()})
  off = sum(len(x) for x in b['v'])
  # CAD (X fwd, Y left, Z up, mm) -> sim (x fwd, y up, z right, m)
  b['v'].append(np.stack([v[:,0], v[:,2], -v[:,1]], 1) / 1000.0)
  b['f'].append(f[:, [0, 2, 1]] + off)          # mirror axis swap flips winding
  b['names'].add(re.sub(r'(__.*)$', '', p['label']))
bin_ = bytearray(); meta_parts = []
SCALE = 0.5 / 32767
for (g, c, me, ro, op), b in buckets.items():
  V = np.concatenate(b['v']); F = np.concatenate(b['f']).astype(np.uint32).ravel()
  q = np.round(V / SCALE).astype(np.int16).ravel()
  while len(bin_) % 4: bin_ += b'\0'
  pOff = len(bin_); bin_ += q.tobytes()
  i16 = V.shape[0] < 65536
  while len(bin_) % 4: bin_ += b'\0'
  iOff = len(bin_); bin_ += (F.astype(np.uint16) if i16 else F).tobytes()
  meta_parts.append(dict(group=g, names=sorted(b['names']), color=c, metalness=me, roughness=ro, opacity=op,
                         pOff=pOff, pLen=len(q), iOff=iOff, iLen=len(F), i16=bool(i16)))
mm = lambda p: [round(p[0] / 1000, 5) + 0.0, round(p[2] / 1000, 5) + 0.0, round(-p[1] / 1000, 5) + 0.0]   # + 0.0: no -0.0 in the JSON
meta = {
  'source': M['source'] + " (the team's final CAD): electronics detail, fasteners, the payload and the moulded 009 digits dropped, meshes decimated",
  'frame': 'meters; +X forward, +Y up, +Z right; origin on the ground midway between the axles',
  'format': 'int16', 'posScale': SCALE,
  'pivots': {
    'armLower': mm(M['armLower']), 'armUpper': mm(M['armUpper']),
    'fingerL': mm(M['fingerL']), 'fingerR': mm(M['fingerR']),
    **{k: mm(v) for k, v in M['wheels'].items()},
    'holdPoint': mm(M['holdPoint']), 'tray': mm(M['tray']),
  },
  'wheelRadius': round(M['wheelRadius'] / 1000, 5), 'armAngle0Deg': M['armAngle0Deg'],
  'armLinkLength': round(M['armLinkLength'] / 1000, 6), 'armFloorDeg': M['armFloorDeg'], 'parts': meta_parts,
}
open(outdir + '/robot.bin', 'wb').write(bytes(bin_))
json.dump(meta, open(outdir + '/robot.json', 'w'), separators=(',', ':'))
print('parts', len(meta_parts), 'bytes', len(bin_), 'tris', sum(p['iLen'] for p in meta_parts)//3)
