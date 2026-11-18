# FreeCAD step 0 of the robot asset pipeline (run with freecadcmd; not deployed).
#   set CAD_IN=C:\Users\adity\Downloads\OVERDRIVE_009_FINAL_ROBOT_v3.step
#   set CAD_OUT=robot_normalized.FCStd      (the STEP re-posed into the robot frame)
#   set CAD_MOTION=motion.json              (which solids move with what, plus the measured pivots)
#   "C:\Program Files\FreeCAD 1.0\bin\freecadcmd.exe" tools\cad_normalize_robot.py
# then tools/cad_tessellate.py (CAD_KIND=robot, CAD_IN=robot_normalized.FCStd) and tools/build_robot.py.
#
# Robot frame: mm, X forward, Y left, Z up, Z = 0 on the floor, origin midway between the four wheel centres.
# The v3 STEP's own frame is X = left, -Y = forward, Z = up, so the re-pose is a 90 degree turn about Z plus a shift.
import FreeCAD as App, Import, Part, json, math, os, re

src, out, motion_out = os.environ['CAD_IN'], os.environ['CAD_OUT'], os.environ['CAD_MOTION']
doc = App.newDocument('step')
Import.insert(src, doc.Name)

def product(o):                 # solids exported as SOLID/COMPOUND carry their real name on the parent product
    if o.Label.startswith(('SOLID', 'COMPOUND')):
        ins = [x for x in o.InList if x.TypeId in ('App::Part', 'Part::Compound', 'App::DocumentObjectGroup')]
        if ins: return re.sub(r'\d{3}$', '', ins[0].Label)
    return o.Label

leaves = []
for o in doc.Objects:
    if o.TypeId != 'Part::Feature' or o.Shape.isNull() or not o.Shape.Solids: continue
    leaves.append((product(o), Part.getShape(o, '', needSubElement=False, refine=False, transform=True)))

# frame from the four tyres: their axis centres give the origin, their outer cylinder the floor
grips = [s for n, s in leaves if n.startswith('Wheel Grip')]
R = max(f.Surface.Radius for s in grips for f in s.Faces if isinstance(f.Surface, Part.Cylinder))
cs = [s.BoundBox.Center for s in grips]
Xm = sum(c.x for c in cs) / 4; Ym = sum(c.y for c in cs) / 4; Zc = sum(c.z for c in cs) / 4
M = App.Placement(App.Vector(Ym, -Xm, -(Zc - R)), App.Rotation(App.Vector(0, 0, 1), 90)).toMatrix()

# drop what the old pipeline dropped (electronics detail, fasteners), plus the loose game piece, the moulded
# 009 digits (the site draws its own number plate there) and the servo marker bodies (no real servo body in the CAD)
SKIP = re.compile(r'^(R_0|C_0|BSS|LSM|MCP|QRE|BxB|DT10|XT30|DLM|B6B|=_|2171|403AC|ECA|LED_|Fuse|SOT|TSSOP|Pin_|FilletPin|2\.54mm|SOLID|Part [0-9]|Array|Body|JST|SW_Cap|TL11|FZ28|AT-12|Chamfer|[0-9]\.step|PTS|ESP32|HEXA_COMMAND_CONTROLLER_0|HEXA_COMMAND_CONTROLLER_pad|PinHeader|M[23] (screw|bolt|nyloc)|NUMBER PLATE|PAYLOAD|(Gripper )?Servo Motor)')
out_doc = App.newDocument('robot')
rows = []
for i, (n, s) in enumerate(leaves):
    if SKIP.match(n): continue
    s = s.copy(); s.transformShape(M)
    o = out_doc.addObject('Part::Feature', 'S%04d' % i); o.Label = n; o.Shape = s
    rows.append((o, n, s.BoundBox))

def cyls(s, r=None, axis=None):
    out = []
    for f in s.Faces:
        c = f.Surface
        if isinstance(c, Part.Cylinder) and (r is None or abs(c.Radius - r) < 0.01) and (axis is None or abs(abs(c.Axis[axis]) - 1) < 1e-6):
            out.append((c.Radius, c.Center))
    return out

# ---- arm: four link plates; pivot = the hole shared with the chassis mounts, far end = the hole shared with the
# gripper's side plates. Link holes run along Y (axis 1) in this frame.
by = lambda pre: [(o, n, b) for o, n, b in rows if n.startswith(pre)]
mount = [c for o, n, b in by('Servo Mount') + by('Triangular Mount') for r_, c in cyls(o.Shape, axis=1) if r_ in (1.5, 1.55)]
side = [c for o, n, b in by('Arm side plate') for r_, c in cyls(o.Shape, 1.5, 1)]
near = lambda a, b: abs(a.x - b.x) < 0.3 and abs(a.z - b.z) < 0.3
links = []
for o, n, b in by('Arm___'):
    hs = [c for r_, c in cyls(o.Shape, 1.5, 1)]
    pivot = next(c for c in hs if any(near(c, m) for m in mount))
    tip = next(c for c in hs if any(near(c, s) for s in side))
    links.append((o, pivot, tip))
links.sort(key=lambda l: l[1].z)
lower, upper = links[:2], links[2:]
P0, T0 = lower[0][1], lower[0][2]
P1 = upper[0][1]
L = math.hypot(T0.x - P0.x, T0.z - P0.z)
th0 = math.degrees(math.atan2(T0.z - P0.z, T0.x - P0.x))

def on_link(b, link):            # a standoff bolted to one of this link's holes (not on its pivot axis)
    holes = [c for r_, c in cyls(link[0].Shape, 1.5, 1) if not near(c, link[1])]
    return any(abs(b.Center.x - c.x) < 1.0 and abs(b.Center.z - c.z) < 1.0 for c in holes)

groups = {'lower': [], 'upper': [], 'grab': [], 'fingerL': [], 'fingerR': [], 'tray': []}
SPACER = re.compile(r'^\d+(\.\d+)?mm [Ss]pacer')
GRAB = re.compile(r'^(Arm side plate|Gripper Base|Gripper Servo Holder|Middle Support|Connector|Gear Spacer)')
FINGER = re.compile(r'^(new_finger|PRINTED TOP FINGER)')
for o, n, b in rows:
    if n.startswith('Arm___'): groups['lower' if any(o is l[0] for l in lower) else 'upper'].append(o.Name)
    elif SPACER.match(n) and any(on_link(b, l) for l in lower): groups['lower'].append(o.Name)
    elif SPACER.match(n) and any(on_link(b, l) for l in upper): groups['upper'].append(o.Name)
    elif n.startswith('Driving Gear') or (n.startswith('Servo Horn') and b.ZMin > 150): groups['fingerL'].append(o.Name)
    elif n.startswith('Follower Gear'): groups['fingerR'].append(o.Name)
    elif FINGER.match(n): groups['fingerL' if b.Center.y > 0 else 'fingerR'].append(o.Name)
    elif GRAB.match(n) or (SPACER.match(n) and b.ZMin > 125 and b.XMin > 70): groups['grab'].append(o.Name)
    elif n.startswith('PRINTED GATE LIP'): groups['tray'].append(o.Name)

gL = next(c for o, n, b in by('Driving Gear') for r_, c in cyls(o.Shape, 16.05, 2))
gR = next(c for o, n, b in by('Follower Gear') for r_, c in cyls(o.Shape, 16.05, 2))
# CORE centre: the closed fingers' 43 mm inner arcs, at mid height between the two finger plates
arcs = [c for o, n, b in by('new_finger') for r_, c in cyls(o.Shape, 43.0, 2)]
plates = [b for o, n, b in by('new_finger')]
hold = (sum(c.x for c in arcs) / len(arcs), 0.0, (min(b.ZMax for b in plates) + max(b.ZMin for b in plates)) / 2)
hinge = next(c for o, n, b in by('PRINTED GATE HINGE ROD') for r_, c in cyls(o.Shape, 6.0, 1))
plate = next(b for o, n, b in by('New Number Plate'))
# lowest arm angle: the gripper carriage and fingers come down to 0.5 mm above the floor
grip_low = min(b.ZMin for o, n, b in rows if o.Name in groups['grab'] + groups['fingerL'] + groups['fingerR'])
floor_deg = math.degrees(math.asin(math.sin(math.radians(th0)) + (0.5 - grip_low) / L))
wheels = {}
for s in grips:
    c = s.copy(); c.transformShape(M); c = c.BoundBox.Center
    wheels['wheel' + ('F' if c.x > 0 else 'R') + ('L' if c.y > 0 else 'R')] = [round(c.x, 2), round(c.y, 2), round(c.z, 2)]

r3 = lambda v: [round(v[0], 3), round(v[1], 3), round(v[2], 3)]
meta = {
    'source': os.path.basename(src),
    'wheelRadius': round(R, 3), 'wheels': wheels,
    'armLower': [round(P0.x, 3), 0.0, round(P0.z, 3)], 'armUpper': [round(P1.x, 3), 0.0, round(P1.z, 3)],
    'armLinkLength': round(L, 3), 'armAngle0Deg': round(th0, 3), 'armFloorDeg': round(floor_deg, 2),
    'fingerL': [round(gL.x, 3), round(gL.y, 3), 0.0], 'fingerR': [round(gR.x, 3), round(gR.y, 3), 0.0],
    'holdPoint': r3(hold), 'tray': [round(hinge.x, 3), 0.0, round(hinge.z, 3)],
    'numberPlate': {'rearX': round(plate.XMin, 2), 'centreY': round(plate.Center.y, 2), 'centreZ': round(plate.Center.z, 2)},
}
out_doc.saveAs(out)
json.dump({**groups, 'meta': meta}, open(motion_out, 'w'), indent=1)
print('DONE', len(rows), {k: len(v) for k, v in groups.items()}, json.dumps(meta))
