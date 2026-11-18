# FreeCAD step 1 of the CAD -> asset pipeline (run with FreeCAD's freecadcmd; not deployed).
#   set CAD_KIND=field CAD_IN="...\Field Assembly Final.step" CAD_OUT=field_meshes.json
#   set CAD_KIND=robot CAD_IN=robot_normalized.FCStd           CAD_OUT=robot_meshes.json  CAD_MOTION=motion.json
#   freecadcmd tools\cad_tessellate.py
# then: python tools/build_field.py field_meshes.json assets   /   python tools/build_robot.py robot_meshes.json motion.json assets
#
# The robot input is the STEP re-posed into the robot frame (mm, X forward, Y left, Z up, ground at Z = 0) by
# tools/cad_normalize_robot.py, which also writes motion.json: the FreeCAD object names of the solids that move
# with each arm link (`lower`, `upper`), the gripper carriage (`grab`), each claw finger (`fingerL`, `fingerR`)
# and the cargo-bay gate (`tray`). Everything else is chassis, except the wheels, which are found by name.
import FreeCAD as App, Import, MeshPart, Part, json, os, re

kind, src, out = os.environ['CAD_KIND'], os.environ['CAD_IN'], os.environ['CAD_OUT']
if src.lower().endswith('.fcstd'):
    doc = App.openDocument(src)
else:
    doc = App.newDocument('cad'); Import.insert(src, doc.Name)

def mesh(o, fine, coarse, big_limit, targets, shape=None):
    shape = shape or o.Shape
    b = shape.BoundBox; big = max(b.XLength, b.YLength, b.ZLength)
    m = MeshPart.meshFromShape(Shape=shape, LinearDeflection=fine if big < big_limit else coarse, AngularDeflection=0.45)
    tgt = targets(o.Label, big)
    if m.CountFacets > tgt:
        try: m.decimate(0.6, 1 - tgt / m.CountFacets)
        except Exception: pass
    return [[round(p.x, 3), round(p.y, 3), round(p.z, 3)] for p in m.Points], [list(f.PointIndices) for f in m.Facets]

# a laser-cut plate with thousands of small holes does not survive decimation (whole areas of its faces vanish), so
# it is rebuilt as its top outline with only the larger cut-outs (> min_hole mm^2) and extruded to its thickness
def plate(s, min_hole=150.0):
    zt, t = s.BoundBox.ZMax, s.BoundBox.ZLength
    out = []
    for f in s.Faces:
        if not isinstance(f.Surface, Part.Plane) or abs(f.CenterOfMass.z - zt) > 0.3: continue
        holes = [w for w in f.Wires if not w.isSame(f.OuterWire) and Part.Face(w).Area > min_hole]
        out.append(Part.makeFace([f.OuterWire] + holes, 'Part::FaceMakerBullseye').extrude(App.Vector(0, 0, -t)))
    return Part.makeCompound(out)

rows = []
if kind == 'field':
    skip = re.compile(r'^(NRL mate|Field base|95x55 30h ring|vert pole base-|vert pole base$|Taping|tape silo|ring marker)')
    for o in doc.Objects:
        if o.TypeId != 'Part::Feature' or o.Shape.isNull() or not o.Shape.Solids or skip.match(o.Label): continue
        v, f = mesh(o, 1.0, 2.0, 200, lambda lab, big: 2000 if big > 800 else (700 if big > 150 else 220))
        rows.append(dict(label=o.Label, v=v, f=f))
else:
    mo = json.load(open(os.environ['CAD_MOTION']))
    member = {n: g for g, key in (('armLower', 'lower'), ('armUpper', 'upper'), ('end', 'grab'), ('fingerL', 'fingerL'),
                                  ('fingerR', 'fingerR'), ('tray', 'tray')) for n in mo[key]}
    for o in doc.Objects:
        if o.TypeId != 'Part::Feature' or o.Shape.isNull() or not o.Shape.Solids: continue
        b, n = o.Shape.BoundBox, o.Name
        if n in member: g = member[n]
        elif re.match(r'^(wheel_base|Wheel Grip|Wheel insert)', o.Label):
            g = 'wheel' + ('F' if (b.XMin + b.XMax) > 0 else 'R') + ('L' if (b.YMin + b.YMax) > 0 else 'R')
        else: g = 'chassis'
        lasercut = o.Label.startswith('ACRYLIC')
        v, f = mesh(o, 0.35, 0.6, 40, lambda lab, big: 20000 if lasercut else (3000 if 'CARGO BAY' in lab else (1400 if 'Wheel Grip' in lab else (900 if big > 100 else 300))),   # the bay is a lattice
                    shape=plate(o.Shape) if lasercut else None)
        rows.append(dict(name=n, label=o.Label, group=g, v=v, f=f))
json.dump(rows, open(out, 'w'))
print('DONE', len(rows), sum(len(r['f']) for r in rows))
