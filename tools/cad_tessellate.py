# FreeCAD step 1 of the CAD -> asset pipeline (run with FreeCAD's freecadcmd; not deployed).
#   set CAD_KIND=field CAD_IN="...\Field Assembly Final.step" CAD_OUT=field_meshes.json
#   set CAD_KIND=robot CAD_IN="...\Robot_normalized.FCStd"    CAD_OUT=robot_meshes.json  CAD_MOTION=motion.json
#   freecadcmd tools\cad_tessellate.py
# then: python tools/build_field.py field_meshes.json assets   /   python tools/build_robot.py robot_meshes.json assets
#
# The robot input is the STEP re-posed into the robot frame (mm, X forward, Y left, Z up, ground at Z = 0);
# motion.json lists the arm-link solids (`lower`, `upper`) and the gripper solids (`grab`) by FreeCAD object name.
import FreeCAD as App, Import, MeshPart, json, os, re

kind, src, out = os.environ['CAD_KIND'], os.environ['CAD_IN'], os.environ['CAD_OUT']
if src.lower().endswith('.fcstd'):
    doc = App.openDocument(src)
else:
    doc = App.newDocument('cad'); Import.insert(src, doc.Name)

def mesh(o, fine, coarse, big_limit, targets):
    b = o.Shape.BoundBox; big = max(b.XLength, b.YLength, b.ZLength)
    m = MeshPart.meshFromShape(Shape=o.Shape, LinearDeflection=fine if big < big_limit else coarse, AngularDeflection=0.45)
    tgt = targets(o.Label, big)
    if m.CountFacets > tgt:
        try: m.decimate(0.6, 1 - tgt / m.CountFacets)
        except Exception: pass
    return [[round(p.x, 3), round(p.y, 3), round(p.z, 3)] for p in m.Points], [list(f.PointIndices) for f in m.Facets]

rows = []
if kind == 'field':
    skip = re.compile(r'^(NRL mate|Field base|95x55 30h ring|vert pole base-|vert pole base$|Taping|tape silo|ring marker)')
    for o in doc.Objects:
        if o.TypeId != 'Part::Feature' or o.Shape.isNull() or not o.Shape.Solids or skip.match(o.Label): continue
        v, f = mesh(o, 1.0, 2.0, 200, lambda lab, big: 2000 if big > 800 else (700 if big > 150 else 220))
        rows.append(dict(label=o.Label, v=v, f=f))
else:
    mo = json.load(open(os.environ['CAD_MOTION']))
    lower, upper, grab = set(mo['lower']), set(mo['upper']), set(mo['grab'])
    skip = re.compile(r'^(R_0|C_0|BSS|LSM|MCP|QRE|BxB|DT10|XT30|DLM|B6B|=_|2171|403AC|ECA|LED_|Fuse|SOT|TSSOP|Pin_|FilletPin|2.54mm|SOLID|Part [123]\.|Array|Body|JST|SW_Cap|TL11|FZ28|AT-12|Chamfer|[123]\.step|PTS|ESP32|HEXA_COMMAND_CONTROLLER_0|HEXA_COMMAND_CONTROLLER_pad|PinHeader|Part [456]\.step)')
    # claw plates and the gears they are bolted to (left = +Y)
    fingerL = {'Part__Feature284', 'Part__Feature652', 'Part__Feature130', 'Part__Feature635'}
    fingerR = {'Part__Feature232', 'Part__Feature702', 'Part__Feature275'}
    for o in doc.Objects:
        if o.TypeId != 'Part::Feature' or o.Shape.isNull() or not o.Shape.Solids or skip.match(o.Label): continue
        b, n = o.Shape.BoundBox, o.Name
        if n in fingerL: g = 'fingerL'
        elif n in fingerR: g = 'fingerR'
        elif n in lower: g = 'armLower'
        elif n in upper: g = 'armUpper'
        elif n in grab or (b.ZMin > 150 and b.XMin > 60): g = 'end'
        elif re.match(r'^(wheel_base|Wheel Grip|Wheel insert)', o.Label):
            g = 'wheel' + ('F' if (b.XMin + b.XMax) > 0 else 'R') + ('L' if (b.YMin + b.YMax) > 0 else 'R')
        else: g = 'chassis'
        v, f = mesh(o, 0.35, 0.6, 40, lambda lab, big: 1400 if 'Wheel Grip' in lab else (900 if big > 100 else 300))
        rows.append(dict(name=n, label=o.Label, group=g, v=v, f=f))
json.dump(rows, open(out, 'w'))
print('DONE', len(rows), sum(len(r['f']) for r in rows))
