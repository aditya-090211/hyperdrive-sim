# Step 1 of the robot spec sheet: read the robot STEP with FreeCAD and dump every solid (not deployed).
#   set CAD_IN=C:\Users\adity\Downloads\OVERDRIVE_009_FINAL_ROBOT_v3.step
#   set CAD_OUT=robot_solids.json
#   "C:\Program Files\FreeCAD 1.0\bin\freecadcmd.exe" tools\robot_step_dump.py
# then: python tools/robot_specs.py robot_solids.json assets/robot/specs.json
#
# One row per leaf solid, in the STEP's own frame (mm): label, the labels of its parent assemblies,
# volume (mm^3), centre of volume, bounding box, and the radii and axes of its cylindrical faces
# (used for wheel diameter and the arm's pivot holes).
import FreeCAD as App, Import, Part, json, os

src, out = os.environ['CAD_IN'], os.environ['CAD_OUT']
doc = App.newDocument('robot')
Import.insert(src, doc.Name)

def parents(o):
    chain, p = [], o
    while True:
        ins = [x for x in p.InList if x.TypeId in ('App::Part', 'Part::Compound', 'App::DocumentObjectGroup')]
        if not ins: return chain
        p = ins[0]; chain.append(p.Label)

r3 = lambda v: [round(v.x, 3), round(v.y, 3), round(v.z, 3)]
rows = []
for o in doc.Objects:
    if o.TypeId != 'Part::Feature' or o.Shape.isNull(): continue
    shp = Part.getShape(o, '', needSubElement=False, refine=False, transform=True)   # global placement
    for k, s in enumerate(shp.Solids):
        b = s.BoundBox
        cyl = []
        for f in s.Faces:
            srf = f.Surface
            if isinstance(srf, Part.Cylinder) and f.Area > 1.0:
                cyl.append([round(srf.Radius, 3), r3(srf.Axis), r3(srf.Center)])
        rows.append(dict(label=o.Label, solid=k, parents=parents(o), volume=round(s.Volume, 2),
                         com=r3(s.CenterOfMass), bbox=[round(b.XMin, 2), round(b.YMin, 2), round(b.ZMin, 2),
                                                       round(b.XMax, 2), round(b.YMax, 2), round(b.ZMax, 2)],
                         cyl=cyl[:40]))
json.dump(rows, open(out, 'w'))
print('DONE', len(rows))
