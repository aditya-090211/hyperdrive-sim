# Step 2 of the robot spec sheet: turn the STEP solid dump into assets/robot/specs.json (not deployed).
#   python tools/robot_specs.py robot_solids.json assets/robot/specs.json
# robot_solids.json comes from tools/robot_step_dump.py (FreeCAD). Simulator constants are read from js/config.js
# and the Space Station ramp from assets/field.json, so re-running this keeps the page in step with both.
#
# Robot frame used for every output: mm, x forward, y left, z up; origin on the floor midway between the four
# wheel centres. The STEP's own frame is X = left, -Y = forward, Z = up.
#
# Mass and centre of mass: each solid's volume (from the B-rep) times a density for its material, or a catalogue
# mass placed at the solid's centre where the CAD solid is not the real part (motors, battery, servos, payload).
# Every material and catalogue value is listed in MATERIALS / CATALOGUE below with where it comes from.
import json, math, os, re, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src, out = sys.argv[1], sys.argv[2]
STEP_NAME = 'OVERDRIVE_009_FINAL_ROBOT_v3.step'
rows = json.load(open(src))
G = 9.81

# ---------------------------------------------------------------- inputs from the simulator and the field CAD
cfg = open(os.path.join(ROOT, 'js', 'config.js'), encoding='utf-8').read()
def block(name):
    m = re.search(r'export const ' + name + r' = \{(.*?)\n\};', cfg, re.S)
    return m.group(1)
def num(blk, key):
    m = re.search(r'\b' + key + r':\s*([-0-9.eE]+)', blk)
    return float(m.group(1))
RB, CB, SB = block('ROBOT'), block('CORE'), block('STATION')
config = {k: num(RB, k) for k in ('mass', 'wheelR', 'motorFreeRPM', 'motorStallTorque', 'gearHold', 'mu', 'muKinetic', 'rollCrr', 'armMin', 'armMax')}
core_mass = num(CB, 'mass')
max_tilt = float(re.search(r'maxTilt:\s*([0-9.]+)\s*\*', SB).group(1))

field = json.load(open(os.path.join(ROOT, 'assets', 'field.json')))
def ramp_angle(key):            # slope of the ramp's top surface in the field CAD pose (deck level)
    p = field['hulls'][key]; top = {}
    for i in range(0, len(p), 3):
        z, y = round(abs(p[i + 2]), 3), p[i + 1]
        top[z] = max(top.get(z, -9), y)
    zs = sorted(top); n = len(zs)
    mz = sum(zs) / n; my = sum(top[z] for z in zs) / n
    s = sum((z - mz) * (top[z] - my) for z in zs) / sum((z - mz) ** 2 for z in zs)
    return math.degrees(math.atan(abs(s)))
ramp_deg = sum(ramp_angle(k) for k in ('rampN_red', 'rampS_red', 'rampN_blue', 'rampS_blue')) / 4

# ---------------------------------------------------------------- materials
# densities in g/cm^3. Only the printed-part density is from team data; the rest are textbook values for an
# assumed material, because the STEP carries names but no material properties.
MATERIALS = {
    'aluminium': (2.70, 'assumption: kit plates, arm links and standoffs taken as aluminium'),
    'acrylic': (1.18, 'STEP part name says ACRYLIC; textbook density'),
    'polycarbonate': (1.20, 'assumption: PC cover is polycarbonate (name "PC")'),
    'printed': (1.03, 'Engineering book 6: PETG fork, 43.6 cm3 solid prints at 45 g (walls + 40 percent gyroid)'),
    'moulded plastic': (1.15, 'assumption: wheel hubs and number plate are moulded or printed plastic at full density'),
    'rubber': (1.10, 'assumption: wheel grip is rubber or TPU'),
    'steel': (7.85, 'assumption: M2/M3 screws and nuts are steel'),
    'electronics': (1.85, 'assumption: PCBs and components at FR4 density'),
}
RULES = [  # (regex on label or parent label, material); first match wins
    (r'^ACRYLIC', 'acrylic'), (r'^PC cover', 'polycarbonate'), (r'^PRINTED', 'printed'),
    (r'^M[23] (screw|bolt|nyloc)', 'steel'), (r'^Wheel Grip', 'rubber'), (r'^(wheel_base|NUMBER PLATE|COMPOUND)', 'moulded plastic'),
    (r'^(top|bottom) holder|^new mid|^Battery Holder|^Base Block|^DC Motor Mount|^Connector|^New Number Plate|^Middle Support|^(Driving|Follower) Gear|^Gear Spacer|^Servo.?Horn|^Gripper (Base|Servo Holder)|^new_finger', 'printed'),
    (r'^(SIDE PLATE|Chassis Back|Servo Mount|Triangular Mount|Arm|Connecting Rod|Wheel insert|\d+(\.\d+)?mm [Ss]pacer)', 'aluminium'),
]
# real parts the CAD only stands in for: grams each, and the source of the number
CATALOGUE = {
    'DC Motor': (170.0, 'assumption: typical JGB37-520 gearmotor listing (motor model from the Engineering book, mass not weighed)'),
    'Battery': (200.0, 'robot.html spec sheet: 3S LiPo, about 200 g (team estimate)'),
    'MG90S micro servo': (13.4, 'TowerPro MG90S datasheet'),
    'PAYLOAD game piece': (180.0, 'robot.html cargo card: payload about 180 g (team estimate)'),
    'AT-1224-TWT-5V-2-R': (2.0, 'assumption: a 12 mm buzzer; the CAD solid with this name fills a 73 x 74 x 82 mm box, so its volume is not used'),
}
# the two standard-size servos have no body in the STEP (only three tiny marker solids each): added as point masses
SERVO = {'model': 'MG996R', 'mass_g': 55.0, 'stall_kgcm_4v8': 9.4, 'stall_kgcm_6v': 11.0,
         'source': 'assumption: STEP shows a standard-size servo (49 x 10 mm mounting-hole pattern, shaft 10 mm off centre) but no model; numbers are the TowerPro MG996R datasheet'}

ELECTRONIC = re.compile(r'^(R_0|C_0|BSS|LSM|MCP|QRE|BxB|DT10|XT30|DLM|B6B|=_|2171|403AC|ECA|LED_|Fuse|SOT|TSSOP|Pin_|FilletPin|2\.54mm|SOLID[-.]|Part [0-9]|Array|Body|JST|SW_Cap|TL11|FZ28|Chamfer\.step|[0-9]\.step|PTS|ESP32|PinHeader|HEXA_COMMAND|Board\.STEP|1\.3 inch display)')

def name_of(r):              # product name: parent product for OCC-exported solids, else the label without feature suffixes
    if r['parents'] and r['label'].startswith(('SOLID', 'COMPOUND')):
        return re.sub(r'\d{3}$', '', r['parents'][-1])
    return re.sub(r'__.*$', '', r['label'])

def material(n):
    if ELECTRONIC.match(n): return 'electronics'
    for rx, m in RULES:
        if re.search(rx, n): return m
    raise SystemExit('no material rule for ' + n)

# ---------------------------------------------------------------- frame: wheels set the origin and the floor
wheels = [r for r in rows if r['label'].startswith('Wheel Grip')]
R_wheel = max(c[0] for w in wheels for c in w['cyl'])
wc = [w['com'] for w in wheels]
Xm = sum(c[0] for c in wc) / 4; Ym = sum(c[1] for c in wc) / 4; Zc = sum(c[2] for c in wc) / 4
Zg = Zc - R_wheel
def P(p):                    # STEP mm -> robot frame mm
    return (-(p[1] - Ym), p[0] - Xm, p[2] - Zg)
def bbox_robot(b):
    a, c = P(b[:3]), P(b[3:])
    return [min(a[0], c[0]), min(a[1], c[1]), min(a[2], c[2]), max(a[0], c[0]), max(a[1], c[1]), max(a[2], c[2])]

front_axle = [w for w in wheels if P(w['com'])[0] > 0]; rear_axle = [w for w in wheels if P(w['com'])[0] < 0]
wheelbase = sum(P(w['com'])[0] for w in front_axle) / 2 - sum(P(w['com'])[0] for w in rear_axle) / 2
left = [w for w in wheels if P(w['com'])[1] > 0]; right = [w for w in wheels if P(w['com'])[1] < 0]
track = sum(P(w['com'])[1] for w in left) / 2 - sum(P(w['com'])[1] for w in right) / 2
grip_w = sum(w['bbox'][3] - w['bbox'][0] for w in wheels) / 4
hub_w = sum(r['bbox'][3] - r['bbox'][0] for r in rows if r['label'].startswith('wheel_base')) / 4

# ---------------------------------------------------------------- arm: pivots and link length from the hole axes
def holes(r, rad=(1.5, 1.55)):
    return [(c[2][1], c[2][2]) for c in r['cyl'] if c[0] in rad and abs(c[1][0]) == 1]
def same(a, b): return abs(a[0] - b[0]) < 0.3 and abs(a[1] - b[1]) < 0.3
side_plate_holes = [h for r in rows if r['label'].startswith('Arm side plate') for h in holes(r)]
mount_holes = [h for r in rows if r['label'].startswith(('Servo Mount', 'Triangular Mount')) for h in holes(r)]
links = []
for r in [r for r in rows if r['label'].startswith('Arm___')]:
    hs = holes(r)
    distal = next(h for h in hs if any(same(h, s) for s in side_plate_holes))
    pivot = next(h for h in hs if any(same(h, m) for m in mount_holes))
    links.append((r, pivot, distal))
def to_xz(h): return (-(h[0] - Ym), h[1] - Zg)
lower = [l for l in links if to_xz(l[1])[1] < 80]; upper = [l for l in links if to_xz(l[1])[1] >= 80]
pv_lo, pv_up = to_xz(lower[0][1]), to_xz(upper[0][1])
d0 = to_xz(lower[0][2])
L = math.hypot(d0[0] - pv_lo[0], d0[1] - pv_lo[1])
theta0 = math.degrees(math.atan2(d0[1] - pv_lo[1], d0[0] - pv_lo[0]))
servo_driven = 'lower' if any(r['label'].startswith('Servo_Horn') and same((r['com'][1], r['com'][2]), lower[0][1]) for r in rows) else 'upper'

# what moves with the arm: the four link plates and the standoffs bolted along them (links), and the gripper
# carriage on the far end (end)
link_holes = [(to_xz(h), l) for l in links for h in holes(l[0]) if not same(h, l[1])]
def on_link(r):
    c = P(r['com'])
    return re.match(r'^\d+(\.\d+)?mm [Ss]pacer', r['label']) and any(abs(c[0] - h[0][0]) < 1 and abs(c[2] - h[0][1]) < 1 for h in link_holes)
END_NAMES = r'^(Arm side plate|Gripper Base|Gripper Servo Holder|Middle Support|Connector|Driving Gear|Follower Gear|Gear Spacer|Servo Horn|new_finger|PRINTED TOP FINGER)'
def group(r, n):
    if n.startswith('Arm') and not n.startswith('Arm side plate'): return 'links'
    if on_link(r): return 'links'
    b = bbox_robot(r['bbox'])
    if re.match(END_NAMES, n) or (re.match(r'^\d+(\.\d+)?mm [Ss]pacer', n) and b[2] > 125 and b[0] > 70): return 'end'
    return 'chassis'

# ---------------------------------------------------------------- masses
items = []                   # (name, group, material, grams, com robot-frame mm, source)
for r in rows:
    n = name_of(r)
    if re.match(r'^(Gripper )?Servo Motor', n): continue              # marker solids, real servo added below
    key = next((k for k in CATALOGUE if re.match(re.escape(k) + r'(\.step)?$', n)), None)
    if key:                                                            # one catalogue part per solid
        g, s = CATALOGUE[key]
        items.append((n, group(r, n), 'catalogue', g, P(r['com']), s)); continue
    m = material(n)
    items.append((n, group(r, n), m, r['volume'] / 1000 * MATERIALS[m][0], P(r['com']), MATERIALS[m][1]))

def marker_centre(prefix):
    ms = [r for r in rows if r['label'].startswith(prefix)]
    return [sum(r['com'][i] for r in ms) / len(ms) for i in range(3)]
def pattern_centre(part):     # centre of the 49 x 10 mm hole rectangle on a servo plate (STEP coords)
    r = next(r for r in rows if r['label'].startswith(part))
    pts = [c[2] for c in r['cyl'] if c[0] == 1.5]
    pairs = [(a, b) for a in pts for b in pts if a < b and abs(math.dist(a, b) - 49.0) < 0.3
             and sum(abs(a[i] - b[i]) < 0.05 for i in range(3)) == 2]       # the long side runs along one axis
    corners = [p for ab in pairs for p in ab]
    return [sum(p[i] for p in corners) / len(corners) for i in range(3)]
arm_servo_c = marker_centre('Servo Motor__')
pc = pattern_centre('Servo Mount'); arm_servo_c[1], arm_servo_c[2] = pc[1], pc[2]
grip_servo_c = marker_centre('Gripper Servo Motor__')
pc = pattern_centre('Gripper Servo Holder'); grip_servo_c[0], grip_servo_c[1] = pc[0], pc[1]
items.append(('Arm servo (standard size)', 'chassis', 'catalogue', SERVO['mass_g'], P(arm_servo_c), SERVO['source']))
items.append(('Gripper servo (standard size)', 'end', 'catalogue', SERVO['mass_g'], P(grip_servo_c), SERVO['source']))

def com_of(sel, arm_deg=None):
    M = 0; S = [0, 0, 0]
    d = 0 if arm_deg is None else math.radians(arm_deg - theta0)
    t0 = math.radians(theta0)
    for n, g, m, grams, c, s in sel:
        x, y, z = c
        if arm_deg is not None and g == 'links':     # rotate about its own pivot
            pv = min((pv_lo, pv_up), key=lambda q: abs((z - q[1]) * math.cos(t0) - (x - q[0]) * math.sin(t0)))
            dx, dz = x - pv[0], z - pv[1]
            x, z = pv[0] + dx * math.cos(d) - dz * math.sin(d), pv[1] + dx * math.sin(d) + dz * math.cos(d)
        elif arm_deg is not None and g == 'end':     # parallelogram: the carriage translates
            th = math.radians(arm_deg)
            x += L * (math.cos(th) - math.cos(t0)); z += L * (math.sin(th) - math.sin(t0))
        M += grams; S[0] += grams * x; S[1] += grams * y; S[2] += grams * z
    return M, [S[i] / M for i in range(3)]

no_payload = [i for i in items if not i[0].startswith('PAYLOAD')]
M_all, com_cad = com_of(items)
M_np, com_np = com_of(no_payload)
_, com_floor = com_of(items, config['armMin'])
_, com_floor_np = com_of(no_payload, config['armMin'])
m_links = sum(i[3] for i in items if i[1] == 'links'); m_end = sum(i[3] for i in items if i[1] == 'end')
x_links = sum(i[3] * i[4][0] for i in items if i[1] == 'links') / m_links

# ---------------------------------------------------------------- dimensions
solid_boxes = [(name_of(r), bbox_robot(r['bbox'])) for r in rows if not re.match(r'^(Gripper )?Servo Motor', name_of(r))]
ext = lambda sel, i, f: f(b[i] for n, b in sel)
length_front, length_back = ext(solid_boxes, 3, max), ext(solid_boxes, 0, min)
width_l, width_r = ext(solid_boxes, 4, max), ext(solid_boxes, 1, min)
height = ext(solid_boxes, 5, max)
height_np = max(b[5] for n, b in solid_boxes if not n.startswith('PAYLOAD'))
not_wheel = [(n, b) for n, b in solid_boxes if not re.match(r'^(Wheel Grip|wheel_base|Wheel insert)', n)]
low = min(not_wheel, key=lambda nb: nb[1][2])
base = next(b for n, b in solid_boxes if n.startswith('ACRYLIC Chassis Base'))
fingers = [b for n, b in solid_boxes if re.match(r'^(new_finger|PRINTED TOP FINGER)', n)]
finger_tip = max(b[3] for b in fingers)
finger_low = min(b[2] for b in fingers)
th_f = math.radians(config['armMin']); t0 = math.radians(theta0)
reach_floor = finger_tip + L * (math.cos(th_f) - math.cos(t0))
reach_max = finger_tip + L * (1 - math.cos(t0))
tyre_front = sum(P(w['com'])[0] for w in front_axle) / 2 + R_wheel

# side-view outline boxes for the diagrams (x0, z0, x1, z1 in the robot frame, CAD pose)
def union(rx, sel=None):
    bs = [b for n, b in solid_boxes if re.match(rx, n)] if sel is None else sel
    return [round(min(b[0] for b in bs), 1), round(min(b[2] for b in bs), 1), round(max(b[3] for b in bs), 1), round(max(b[5] for b in bs), 1)]
end_boxes = [bbox_robot(r['bbox']) for r in rows if group(r, name_of(r)) == 'end' and not re.match(r'^(Gripper )?Servo Motor', name_of(r))]
outline = {'source': 'STEP bounding boxes, CAD pose', 'side_plates': union(r'^SIDE PLATE'), 'top': union(r'^(PC cover|ACRYLIC Top Plate)'),
           'cargo_bay': union(r'^PRINTED CARGO BAY'), 'payload': union(r'^PAYLOAD'), 'aligner': union(r'^PRINTED ALIGNER'),
           'gripper': union(None, end_boxes), 'base': union(r'^ACRYLIC Chassis Base')}
fb = union(r'^new_finger')
outline['core_hold'] = [round((fb[0] + fb[2]) / 2, 1), round((fb[1] + fb[3]) / 2, 1)]    # CORE centre: middle of the finger plates

# ---------------------------------------------------------------- part list
counts = Counter(); mass_by = defaultdict(float); mat_by = {}
for n, g, m, grams, c, s in items:
    key = 'Electronics (PCBs, connectors, components)' if m == 'electronics' and not n.startswith(('HEXA_COMMAND_CONTROLLER_PCB', 'Board', '1.3 inch')) else n
    key = re.sub(r'(_\d+)+$', '', re.sub(r'\.(step|STEP)$', '', key))
    key = re.sub(r'\d{3}$', '', key).strip()
    counts[key] += 1; mass_by[key] += grams; mat_by[key] = m
# products modelled as several solids count once per copy
SOLIDS_PER_COPY = {'1.3 inch display': 10, 'HEXA_COMMAND_CONTROLLER_PCB': 1}
parts = []
for k in sorted(counts):
    c = counts[k] // SOLIDS_PER_COPY.get(k, 1) if k in SOLIDS_PER_COPY else counts[k]
    if k.startswith('Electronics'): c = counts[k]
    parts.append({'name': k, 'count': c, 'material': mat_by[k], 'mass_g': round(mass_by[k], 1),
                  'counted': 'solids' if k.startswith('Electronics') else 'copies'})

def v(value, unit, source, note=None, nd=1):
    d = {'value': round(value, nd) if isinstance(value, float) else value, 'unit': unit, 'source': source}
    if note: d['note'] = note
    return d

STEP = 'STEP'
spec = {
    'generated_by': 'tools/robot_step_dump.py (FreeCAD 1.0) + tools/robot_specs.py',
    'step_file': STEP_NAME,
    'solid_count': len(rows),
    'frame': 'mm; x forward, y left, z up; origin on the floor midway between the four wheel centres. CAD pose: arm at the angle below.',
    'values': {
        'length': v(length_front - length_back, 'mm', STEP, 'overall, gripper fingers to cargo bay, arm in the CAD pose'),
        'width': v(width_l - width_r, 'mm', STEP, 'overall, across the outer faces of the wheel hubs'),
        'height': v(height, 'mm', STEP, 'top of the payload in the cargo bay, arm in the CAD pose'),
        'height_no_payload': v(height_np, 'mm', STEP, 'top of the robot without the payload, arm in the CAD pose'),
        'front_x': v(length_front, 'mm', STEP, 'gripper finger tips ahead of the origin'),
        'rear_x': v(length_back, 'mm', STEP, 'rear-most point (cargo bay) behind the origin'),
        'wheel_diameter': v(2 * R_wheel, 'mm', STEP, 'outer cylinder of Wheel Grip'),
        'wheel_width': v(grip_w, 'mm', STEP, 'Wheel Grip tread; the wheel_base hub is ' + str(round(hub_w, 1)) + ' mm wide'),
        'wheelbase': v(wheelbase, 'mm', STEP, 'front to rear wheel centres'),
        'track': v(track, 'mm', STEP, 'left to right tyre centre planes'),
        'tyre_front_x': v(tyre_front, 'mm', STEP, 'front tyre leading edge'),
        'ground_clearance': v(low[1][2], 'mm', STEP, 'lowest point that is not a wheel: ' + low[0]),
        'base_clearance': v(base[2], 'mm', STEP, 'underside of the acrylic chassis base'),
        'arm_pivot_lower': v([round(pv_lo[0], 1), round(pv_lo[1], 1)], 'mm (x, z)', STEP, 'lower link pivot; the arm servo horn is on this axis' if servo_driven == 'lower' else 'lower link pivot'),
        'arm_pivot_upper': v([round(pv_up[0], 1), round(pv_up[1], 1)], 'mm (x, z)', STEP, 'upper link pivot' + ('; the arm servo horn is on this axis' if servo_driven == 'upper' else '')),
        'arm_link_length': v(L, 'mm', STEP, 'pivot hole to carriage hole, both link pairs'),
        'arm_cad_angle': v(theta0, 'deg', STEP, 'link angle above horizontal in the CAD pose'),
        'arm_floor_angle': v(config['armMin'], 'deg', 'config.js', 'gripper plates 0.5 mm above the floor', 2),
        'arm_max_angle': v(config['armMax'], 'deg', 'config.js'),
        'claw_reach_cad': v(finger_tip, 'mm', STEP, 'finger tips ahead of the origin in the CAD pose'),
        'claw_reach_floor': v(reach_floor, 'mm', 'STEP + parallelogram geometry', 'finger tips ahead of the origin with the arm on the floor'),
        'claw_reach_max': v(reach_max, 'mm', 'STEP + parallelogram geometry', 'finger tips ahead of the origin with the links horizontal'),
        'claw_past_tyre_floor': v(reach_floor - tyre_front, 'mm', 'STEP + parallelogram geometry', 'how far the finger tips reach past the front tyres with the arm on the floor'),
        'mass': v(M_all / 1000, 'kg', 'STEP volumes x densities (assumed materials) + catalogue masses', 'with the payload; ' + str(round(M_np / 1000, 3)) + ' kg without. Simulator uses ' + str(config['mass']) + ' kg (config.js, assumption).', 3),
        'mass_no_payload': v(M_np / 1000, 'kg', 'STEP volumes x densities (assumed materials) + catalogue masses', None, 3),
        'com_cad': v([round(c, 1) for c in com_cad], 'mm (x, y, z)', 'STEP volumes x densities (assumed materials)', 'with the payload, arm in the CAD pose'),
        'com_floor': v([round(c, 1) for c in com_floor], 'mm (x, y, z)', 'STEP volumes x densities (assumed materials)', 'with the payload, arm on the floor (lowest CoM, used on the Space Station)'),
        'com_cad_no_payload': v([round(c, 1) for c in com_np], 'mm (x, y, z)', 'STEP volumes x densities (assumed materials)'),
        'com_floor_no_payload': v([round(c, 1) for c in com_floor_np], 'mm (x, y, z)', 'STEP volumes x densities (assumed materials)'),
        'arm_links_mass': v(m_links / 1000, 'kg', 'STEP volumes x densities (assumed materials)', 'four link plates and the standoffs along them', 3),
        'arm_links_com_frac': v((x_links - pv_lo[0]) / (math.cos(t0) * L), '', STEP, 'link CoM position along the link, 0 = pivot, 1 = carriage', 3),
        'arm_end_mass': v(m_end / 1000, 'kg', 'STEP volumes x densities (assumed materials) + servo catalogue mass', 'gripper carriage incl. its servo, fingers and gears', 3),
        'core_mass': v(core_mass, 'kg', 'game manual 3.4.1 (via config.js)', None, 3),
        'servo_model': v(SERVO['model'], '', 'assumption', SERVO['source']),
        'servo_stall_torque': v(SERVO['stall_kgcm_4v8'] * G / 100, 'N m', 'assumption: MG996R datasheet, 9.4 kgf cm at 4.8 V', 'about ' + str(round(SERVO['stall_kgcm_6v'] * G / 100, 2)) + ' N m at 6 V', 3),
        'mu': v(config['mu'], '', 'config.js (rubber on EVA foam, static)', None, 2),
        'mu_kinetic': v(config['muKinetic'], '', 'config.js', None, 2),
        'roll_crr': v(config['rollCrr'], '', 'config.js', None, 3),
        'motor_stall_torque': v(config['motorStallTorque'], 'N m', 'config.js (assumption: at the wheel, 12 V)', None, 2),
        'motor_free_rpm': v(config['motorFreeRPM'], 'rpm', 'config.js (assumption: 37 mm 12 V 300 RPM gearmotor)', None, 0),
        'motor_count': v(4, '', STEP, 'four DC Motor solids, one per wheel'),
        'gear_hold': v(config['gearHold'], 'N per wheel', 'config.js (assumption: gearbox back-drive resistance)', None, 2),
        'station_tilt': v(max_tilt, 'deg', 'arena sheet via config.js (STATION.maxTilt hard stop)', None, 1),
        'ramp_angle': v(ramp_deg, 'deg', 'field CAD (assets/field.json ramp hulls, deck level)', None, 1),
        'limit_mass': v(8.0, 'kg', 'game manual R1.2 (via config.js comment)'),
        'limit_footprint': v(457.2, 'mm', 'game manual (18 in, per robot.html)'),
        'g': v(G, 'm/s^2', 'standard gravity', None, 2),
    },
    'materials': {k: {'density_g_cm3': d, 'source': s} for k, (d, s) in MATERIALS.items()},
    'catalogue': {**{k: {'mass_g': g, 'source': s} for k, (g, s) in CATALOGUE.items()}, 'standard servo (x2)': {'mass_g': SERVO['mass_g'], 'source': SERVO['source']}},
    'outline': outline,
    'parts': parts,
    'mass_by_group_g': {g: round(sum(i[3] for i in items if i[1] == g), 1) for g in ('chassis', 'links', 'end')},
}
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(spec, open(out, 'w'), indent=1)
print(json.dumps({k: spec['values'][k]['value'] for k in spec['values']}, indent=0))
print('mass by group', spec['mass_by_group_g'], 'servo-driven link pair:', servo_driven)
