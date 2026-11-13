"""Hero landmarks and metro models for the realism scene (docs/13_REALISM_FABLE_TASKS.md, R4), built in Blender.

Runs headless — no add-on, no open Blender window, nothing downloaded:

    "C:/Program Files/Blender Foundation/Blender 5.3/blender.exe" --background --python scripts/blender/build_models.py
    (macOS: /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/build_models.py)

Writes, per model:  apps/web/public/models/<name>.glb        full detail, Draco-compressed
                    apps/web/public/models/<name>_lod1.glb   about 25 % of the triangles
                    eval/results/ui/realism/blender/<name>.png   preview render
and apps/web/public/models/models.json (triangle counts, sizes, the public dimensions used).

Stylised but proportioned from public dimensions; approximations, not survey models. No logos, signage or text.
Blender is Z-up: +X is the model's length, +Z is up; the glTF exporter turns that into three.js's Y-up.
Every mesh carries ambient occlusion in its vertex colours (ray-cast in this script, so it needs no render engine);
material slots are named (glass, steel, concrete, gold, green, mof, dwtc, shell, red, body, win) and the web app
maps those names onto its own materials, which already handle sky reflections and night lighting.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "apps", "web", "public", "models")
PREVIEW = os.path.join(ROOT, "eval", "results", "ui", "realism", "blender")
ONLY = [a.split("=", 1)[1].split(",") for a in sys.argv if a.startswith("--only=")]      # blender … --python build_models.py -- --only=burj_khalifa,dubai_frame
RAIL_Z = 12.2                       # top of rail above ground, as in apps/web/src/components/twin/Metro.tsx
COLOURS = {                         # preview colours only; the web app supplies the real materials by slot name
    "glass": (0.45, 0.6, 0.72, 0.9, 0.2), "steel": (0.6, 0.65, 0.7, 0.85, 0.3), "concrete": (0.86, 0.84, 0.8, 0.0, 0.75),
    "gold": (0.83, 0.68, 0.33, 0.9, 0.28), "green": (0.36, 0.56, 0.28, 0.0, 0.9), "mof": (0.88, 0.89, 0.9, 0.7, 0.3),
    "dwtc": (0.9, 0.87, 0.8, 0.0, 0.65), "shell": (0.83, 0.7, 0.42, 0.82, 0.3), "red": (0.85, 0.06, 0.06, 0.0, 0.5),
    "body": (0.95, 0.96, 0.97, 0.4, 0.3), "win": (0.1, 0.15, 0.22, 0.6, 0.2),
    "trunk": (0.5, 0.39, 0.26, 0.0, 0.9), "leaf": (0.27, 0.46, 0.2, 0.0, 0.8), "roof": (0.9, 0.9, 0.9, 0.3, 0.4),
}


# ---------------------------------------------------------------- helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name):
    m = bpy.data.materials.get(name)
    if m is None:
        r, g, b, metal, rough = COLOURS[name]
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bsdf.inputs["Base Color"].default_value = (r, g, b, 1)
        bsdf.inputs["Metallic"].default_value = metal
        bsdf.inputs["Roughness"].default_value = rough
    return m


def finish(obj, mat, smooth=False):
    obj.data.materials.append(material(mat))
    for p in obj.data.polygons:
        p.use_smooth = smooth
    return obj


def box(size, loc, mat, rot_z=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=(0, 0, rot_z))
    o = bpy.context.active_object
    o.scale = size
    return finish(o, mat)


def cyl(r_bottom, r_top, depth, loc, mat, verts=12, rot=(0, 0, 0), smooth=False):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r_bottom, radius2=r_top, depth=depth, location=loc, rotation=rot)
    return finish(bpy.context.active_object, mat, smooth)


def from_faces(verts, faces, mat, uvs=None, smooth=False):
    me = bpy.data.meshes.new("m")
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    if uvs:
        layer = me.uv_layers.new(name="UVMap")
        for loop in me.loops:
            layer.data[loop.index].uv = uvs[loop.vertex_index]
    o = bpy.data.objects.new("o", me)
    bpy.context.collection.objects.link(o)
    return finish(o, mat, smooth)


def rotate_about_z(obj, ang):
    """Rotate an object about the world Z axis through the origin (for the Burj Khalifa's three wings)."""
    c, s = math.cos(ang), math.sin(ang)
    x, y = obj.location.x, obj.location.y
    obj.location.x, obj.location.y = x * c - y * s, x * s + y * c
    obj.rotation_euler.z += ang


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(o.data)
    bm.free()
    return o


RAYS = []
for i in range(20):                 # fixed directions on the upper hemisphere (golden-angle spiral): the bake is reproducible
    z = 0.15 + 0.85 * (i + 0.5) / 20
    r, a = math.sqrt(1 - z * z), i * 2.399963
    RAYS.append(Vector((r * math.cos(a), r * math.sin(a), z)))


def bake_ao(obj, reach=None):
    """Ambient occlusion into the vertex colours: per face corner, the share of rays around its normal that escape."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    tree = BVHTree.FromBMesh(bm)
    reach = reach or min(40.0, 0.25 * max(obj.dimensions))        # occlusion from nearby geometry only
    layer = me.color_attributes.get("Col") or me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="CORNER")      # linear values: glTF vertex colours are linear
    bm.free()
    for poly in me.polygons:
        n = poly.normal
        t = n.orthogonal().normalized()
        b = n.cross(t)
        for li in poly.loop_indices:
            p = me.vertices[me.loops[li].vertex_index].co + n * (0.002 * reach + 0.02)
            free = 0
            for r in RAYS:
                d = t * r.x + b * r.y + n * r.z
                hit = tree.ray_cast(p, d, reach)
                free += 1 if hit[0] is None else min(1.0, hit[3] / reach) * 0.6
            v = 0.6 + 0.4 * (free / len(RAYS)) ** 0.8                 # gentle: it multiplies materials that are already shaded
            layer.data[li].color = (v, v, v, 1.0)
    me.color_attributes.active_color = layer
    me.color_attributes.render_color_index = list(me.color_attributes).index(layer)


def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def make_lod(obj, ratio=0.25):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.duplicate()
    lod = bpy.context.active_object
    lod.name = obj.name + "_lod1"
    mod = lod.modifiers.new("decimate", "DECIMATE")
    mod.ratio = ratio
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return lod


def export(obj, path):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    want = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                export_draco_position_quantization=14, export_draco_color_quantization=8,
                export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
                export_materials="EXPORT", export_cameras=False, export_lights=False, export_animations=False)
    known = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()          # option names differ between Blender versions
    bpy.ops.export_scene.gltf(**{k: v for k, v in want.items() if k in known})


def render(obj, path):
    scene = bpy.context.scene
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.78, 0.84, 0.92, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    scene.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(52), 0, math.radians(35))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    lo = Vector((min(v.co.x for v in obj.data.vertices), min(v.co.y for v in obj.data.vertices), min(v.co.z for v in obj.data.vertices)))
    hi = Vector((max(v.co.x for v in obj.data.vertices), max(v.co.y for v in obj.data.vertices), max(v.co.z for v in obj.data.vertices)))
    mid, size = (lo + hi) / 2, max(hi - lo)
    cam.location = mid + Vector((0.95, -1.35, 0.45)).normalized() * size * 1.75
    cam.rotation_euler = (mid - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.clip_end = size * 20
    cam.data.clip_start = max(0.05, size / 500)
    for m in obj.data.materials:                     # show the baked AO in the preview
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        if not bsdf.inputs["Base Color"].is_linked:
            col, mix = nt.nodes.new("ShaderNodeVertexColor"), nt.nodes.new("ShaderNodeMix")
            mix.data_type, mix.blend_type = "RGBA", "MULTIPLY"
            mix.inputs[0].default_value = 1.0
            mix.inputs[6].default_value = bsdf.inputs["Base Color"].default_value
            nt.links.new(col.outputs["Color"], mix.inputs[7])
            nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    scene.render.resolution_x, scene.render.resolution_y = 1200, 900
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = path
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "BLENDER_WORKBENCH"):
        try:
            scene.render.engine = engine
            bpy.ops.render.render(write_still=True)
            return engine
        except Exception as ex:                      # no GPU context in this session: try the next engine
            print("render with", engine, "failed:", ex)
    return None


# ---------------------------------------------------------------- models
def beam(p0, p1, w, t, mat):
    """A closed box from p0 to p1, `w` wide across the run and `t` thick: louvres, bands and fins at any angle."""
    a, b = Vector(p0), Vector(p1)
    d = (b - a).normalized()
    side = Vector((-d.y, d.x, 0.0))
    if side.length < 1e-6:
        side = Vector((1.0, 0.0, 0.0))
    side.normalize()
    up = d.cross(side).normalized()
    hw, ht = side * (w / 2), up * (t / 2)
    v = [a - hw - ht, a + hw - ht, a + hw + ht, a - hw + ht, b - hw - ht, b + hw - ht, b + hw + ht, b - hw + ht]
    return from_faces(v, [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], mat)


def burj_khalifa():
    """828 m. Y-shaped plan: a hexagonal core and three wings that step back one after another, 27 setbacks in an
    upward spiral to about 585 m, then a telescoping pinnacle and the spire. R8: each wing tier is tri-lobed (a nose
    and two lower shoulders, as on the real tower), with a ledge at every setback, vertical steel fins up the glass,
    service bands round the core and a low podium. Public dimensions: height 828 m, roof about 585 m."""
    parts, tiers, steps = [], 585.0, 27
    step_h = tiers / steps
    for i in range(9):
        z0, z1 = i * tiers / 9, (i + 1) * tiers / 9
        r0 = 24 - i * 2.05
        parts.append(cyl(r0, 24 - (i + 1) * 2.05, z1 - z0, (0, 0, (z0 + z1) / 2), "glass", verts=6))
        parts.append(cyl(r0 + 0.7, r0 + 0.7, 2.6, (0, 0, z0 + 1.3), "steel", verts=6))                 # service band
    for w in range(3):
        ang, prev = w * 2 * math.pi / 3, 0.0
        for k in range(9):
            top = min(tiers, (w + 1 + k * 3) * step_h)
            length, width, h = 66 * (1 - k / 9.6) ** 1.1 + 7, 31 - k * 2.5, top - prev
            if h <= 0:
                continue
            zc = prev + h / 2
            objs = [box((length, width, h), (length / 2 + 6, 0, zc), "glass"),
                    cyl(width / 2, width / 2, h, (length + 6, 0, zc), "glass", verts=18),
                    box((length + 4, width + 0.8, 1.2), (length / 2 + 6, 0, top - 0.6), "steel"),              # ledge at each setback
                    cyl(width / 2 + 0.6, width / 2 + 0.6, 1.2, (length + 6, 0, top - 0.6), "steel", verts=18)]
            sh_len, sh_w, sh_h = length * 0.6, width * 0.26, h * 0.84
            if k < 8:                                                 # shoulders either side of the nose, a little lower
                for sy in (-1, 1):
                    y = sy * (width / 2 + sh_w / 2 - 0.4)
                    objs += [box((sh_len, sh_w, sh_h), (sh_len / 2 + 6, y, prev + sh_h / 2), "glass"),
                             cyl(sh_w / 2, sh_w / 2, sh_h, (sh_len + 6, y, prev + sh_h / 2), "glass", verts=10),
                             box((sh_len + 1.5, sh_w + 0.6, 1.0), (sh_len / 2 + 6, y, prev + sh_h - 0.5), "steel")]
            n = max(2, int(length // 7))                              # vertical fins up the curtain wall
            for j in range(n):
                x = 6 + (j + 0.5) * length / n
                on_shoulder = k < 8 and x < 6 + sh_len
                fy, fh = (width / 2 + sh_w - 0.4 + 0.35, sh_h - 1.0) if on_shoulder else (width / 2 + 0.35, h - 1.2)
                for sy in (-1, 1):
                    objs.append(box((0.45, 0.7, fh), (x, sy * fy, prev + fh / 2), "steel"))
            for o in objs:
                rotate_about_z(o, ang)
                parts.append(o)
            prev = top
    parts.append(cyl(44, 41, 9, (0, 0, 4.5), "concrete", 36))                                          # podium
    z = tiers                                                                                          # telescoping pinnacle
    for r0, r1, hh in ((8.4, 7.0, 30), (6.6, 5.4, 34), (5.0, 3.8, 36), (3.4, 2.2, 40)):
        parts.append(cyl(r0, r1, hh, (0, 0, z + hh / 2), "steel", 12))
        parts.append(cyl(r0 + 0.5, r0 + 0.5, 1.4, (0, 0, z + 0.7), "steel", 12))
        z += hh
    parts.append(cyl(1.8, 0.3, 828 - z, (0, 0, z + (828 - z) / 2), "steel", 8))
    return join(parts, "burj_khalifa"), {"height_m": 828, "source": "https://en.wikipedia.org/wiki/Burj_Khalifa"}


def emirates_tower(name, h, side):
    """Jumeirah Emirates Towers: equilateral-triangle plan, a crown that slopes up to one corner, a spire from that
    corner. R8: every face is two aluminium wings with a recessed glass panel between them, mullion fins on the glass,
    band lines every four storeys, louvres across the sloped crown, three legs and a canopied drum at the foot.
    355 m (office) and 309 m (hotel)."""
    r, shaft, crown = side / math.sqrt(3), h * 0.74, h * 0.9
    corner = lambda i, k=1.0: (math.cos(i * 2 * math.pi / 3) * r * k, math.sin(i * 2 * math.pi / 3) * r * k)        # noqa: E731
    base = [corner(i, 0.955) for i in range(3)]                       # the inner shell: nothing is see-through behind the panels
    top = [corner(0, 0.5), corner(1, 0.86), corner(2, 0.86)]
    top_z = [crown, shaft + (crown - shaft) * 0.18, shaft + (crown - shaft) * 0.18]
    verts = [(x, y, 0) for x, y in base] + [(x, y, shaft) for x, y in base] + [(x, y, z) for (x, y), z in zip(top, top_z)]
    faces = []
    for i in range(3):
        j = (i + 1) % 3
        faces += [(i, j, 3 + j, 3 + i), (3 + i, 3 + j, 6 + j, 6 + i)]
    faces.append((6, 7, 8))
    parts = [from_faces(verts, faces, "glass")]
    z0 = 16.0
    for i in range(3):
        (ax, ay), (bx, by) = corner(i), corner((i + 1) % 3)
        ex, ey = bx - ax, by - ay
        length = math.hypot(ex, ey)
        ux, uy = ex / length, ey / length
        nx, ny = uy, -ux
        if nx * (ax + bx) + ny * (ay + by) < 0:
            nx, ny = -nx, -ny                                         # outward
        rot = math.atan2(ey, ex)
        at = lambda t, off: (ax + ex * t + nx * off, ay + ey * t + ny * off)      # noqa: E731
        # The scene's own extruded footprint stands exactly on the face plane (offset 0), so everything here sits on
        # or outside it: the glass a hand's width proud, the wings 0.6 m further out — the panel still reads as recessed.
        for t in (0.11, 0.89):                                        # aluminium wings
            x, y = at(t, 0.0)
            parts.append(box((length * 0.22, 1.2, shaft - z0), (x, y, (shaft + z0) / 2), "steel", rot))
        x, y = at(0.5, -0.45)                                         # glass panel between them
        parts.append(box((length * 0.56, 1.0, shaft - z0), (x, y, (shaft + z0) / 2), "glass", rot))
        for q in range(1, 6):                                         # mullion fins on the glass
            x, y = at(0.22 + 0.56 * q / 6, 0.2)
            parts.append(box((0.35, 0.5, shaft - z0), (x, y, (shaft + z0) / 2), "steel", rot))
        z = z0 + 14.0
        while z < shaft - 6:                                          # band lines every four storeys
            parts.append(beam((*at(0.0, 0.75), z), (*at(1.0, 0.75), z), 0.7, 0.9, "steel"))
            z += 14.0
        j = (i + 1) % 3                                               # louvres across the sloped crown
        for q in range(1, 8):
            f = q / 8
            p0 = (base[i][0] / 0.955 + (top[i][0] - base[i][0] / 0.955) * f, base[i][1] / 0.955 + (top[i][1] - base[i][1] / 0.955) * f, shaft + (top_z[i] - shaft) * f)
            p1 = (base[j][0] / 0.955 + (top[j][0] - base[j][0] / 0.955) * f, base[j][1] / 0.955 + (top[j][1] - base[j][1] / 0.955) * f, shaft + (top_z[j] - shaft) * f)
            parts.append(beam(p0, p1, 1.0, 0.6, "steel"))
    for i in range(3):                                                # the three legs
        x, y = corner(i, 0.985)
        parts.append(cyl(3.3, 3.3, shaft, (x, y, shaft / 2), "steel", 14))
        parts.append(cyl(3.9, 3.9, 2.0, (x, y, shaft - 1.0), "steel", 14))
    parts.append(cyl(r * 1.25, r * 1.2, 14, (0, 0, 7), "concrete", 28))
    parts.append(cyl(r * 1.5, r * 1.5, 1.1, (0, 0, 14.6), "steel", 28))                                 # canopy
    parts.append(cyl(1.9, 0.45, h - crown + 6, (top[0][0], top[0][1], crown - 6 + (h - crown + 6) / 2), "steel", 8))
    return join(parts, name), {"height_m": h, "footprint_side_m": side, "source": "https://en.wikipedia.org/wiki/Emirates_Towers"}


def museum_of_the_future():
    """An elliptical torus standing on a green mound, about 77 m high in all. The façade pattern is a texture the
    web app draws itself (abstract strokes that spell nothing); here the ring carries the UVs for it."""
    bpy.ops.mesh.primitive_torus_add(major_radius=25, minor_radius=10.5, major_segments=72, minor_segments=24, generate_uvs=True,
                                     location=(0, 0, 45), rotation=(math.radians(90), 0, 0))
    ring = finish(bpy.context.active_object, "mof", smooth=True)
    ring.scale = (1.1, 0.9, 0.86)             # local axes: after the 90° turn local Y is world Z (height), local Z is depth; top at 77 m
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=36, ring_count=18, location=(0, 0, 0))
    mound = finish(bpy.context.active_object, "green", smooth=True)
    mound.scale = (58, 46, 15)
    bm = bmesh.new()
    bm.from_mesh(mound.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.01], context="VERTS")
    bm.to_mesh(mound.data)
    bm.free()
    podium = cyl(34, 30, 5, (0, 0, 13.5), "concrete", 32, smooth=True)
    podium.scale = (1.0, 0.72, 1.0)
    return join([ring, mound, podium], "museum_of_the_future"), {"height_m": 77, "source": "https://en.wikipedia.org/wiki/Museum_of_the_Future"}


def trade_centre_tower():
    """Sheikh Rashid Tower (Dubai World Trade Centre), 149 m: a square shaft behind a deep window lattice (texture
    drawn by the web app on these UVs). R8: the lattice has real depth — eight piers a side standing proud of the
    windows and a ledge every fourth floor — with corner piers, a flared cornice, a stepped crown, a mast and a podium."""
    shaft = box((40, 40, 132), (0, 0, 66), "dwtc")
    bpy.context.view_layer.objects.active = shaft
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.reset()                                                # every face gets the full 0–1 square
    bpy.ops.object.mode_set(mode="OBJECT")
    parts = [shaft]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(box((4.8, 4.8, 138), (sx * 20, sy * 20, 69), "concrete"))
    for q in range(8):                                                # piers between the window columns
        p = -15.75 + q * 4.5
        for s in (-1, 1):
            parts += [box((1.0, 1.5, 124), (p, s * 20.6, 70), "concrete"), box((1.5, 1.0, 124), (s * 20.6, p, 70), "concrete")]
    z = 20.0
    while z < 130:                                                    # a ledge every fourth floor
        parts.append(box((42.6, 42.6, 0.7), (0, 0, z), "concrete"))
        z += 13.8
    parts += [box((58, 58, 8), (0, 0, 4), "concrete"), box((62, 62, 1.0), (0, 0, 8.5), "concrete"),      # podium and its canopy
              box((46, 46, 1.4), (0, 0, 132.7), "concrete"), box((48.5, 48.5, 2.2), (0, 0, 134.5), "concrete"),
              box((44, 44, 3.4), (0, 0, 137.3), "concrete"), box((28, 28, 8), (0, 0, 143.0), "concrete"),
              box((14, 14, 3), (0, 0, 148.5), "concrete"), cyl(0.9, 0.4, 12, (0, 0, 156), "steel", 8)]
    return join(parts, "trade_centre_tower"), {"height_m": 149, "source": "https://en.wikipedia.org/wiki/Dubai_World_Trade_Centre"}


def dubai_frame():
    """150 m high, 93 m wide: two towers joined by a bridge at the top, on a stepped base. R8: the gold cladding is
    panelled — raised plates in rows on every outer face, as the real ring-patterned skin reads from a distance."""
    w, h, t, d = 93.0, 150.0, 9.0, 14.0
    parts = [box((t, d, h), (-(w - t) / 2, 0, h / 2), "gold"), box((t, d, h), ((w - t) / 2, 0, h / 2), "gold"),
             box((w, d, t), (0, 0, h - t / 2), "gold"), box((w, d + 8, 6), (0, 0, 3), "concrete"), box((w + 12, d + 18, 2.4), (0, 0, 1.2), "concrete")]
    rows = 26
    for sx in (-1, 1):
        cx = sx * (w - t) / 2
        for r_ in range(rows):
            z = 9 + (r_ + 0.5) * (h - t - 9) / rows
            for col in (-1, 1):                                       # front and back faces: two plates across
                for sy in (-1, 1):
                    parts.append(box((3.3, 0.5, 4.2), (cx + col * 2.1, sy * (d / 2 + 0.2), z), "gold"))
            for col in (-1, 0, 1):                                    # outer side face: three plates across
                parts.append(box((0.5, 3.4, 4.2), (cx + sx * (t / 2 + 0.2), col * 4.2, z), "gold"))
    for q in range(20):                                               # the bridge
        x = -w / 2 + (q + 0.5) * w / 20
        for sy in (-1, 1):
            parts.append(box((3.6, 0.5, 3.3), (x, sy * (d / 2 + 0.2), h - t / 2 - 1.9), "gold"))
            parts.append(box((3.6, 0.5, 3.3), (x, sy * (d / 2 + 0.2), h - t / 2 + 1.9), "gold"))
        parts.append(box((3.6, 3.4, 0.5), (x, 0, h + 0.2), "gold"))
    for sx in (-1, 1):                                                # glazed strip on the inner faces
        parts.append(box((0.6, d - 3, h - 2 * t), (sx * ((w - 2 * t) / 2 - 0.2), 0, h / 2), "glass"))
    parts.append(box((w - 2 * t, d - 3, 0.6), (0, 0, h - t - 0.2), "glass"))
    return join(parts, "dubai_frame"), {"height_m": 150, "width_m": 93, "source": "https://en.wikipedia.org/wiki/Dubai_Frame"}


def shell(length, width, height, seg_u=44, seg_v=16, z0=0.0):
    """Elongated shell, pinched at both ends and arched across: the Dubai Metro station roof silhouette."""
    verts, uvs, faces = [], [], []
    for i in range(seg_u + 1):
        u = i / seg_u
        taper = math.sin(math.pi * u) ** 0.5
        ridge = 1 + 0.1 * math.sin(math.pi * u * 2 - 0.6)
        for j in range(seg_v + 1):
            th = math.pi * j / seg_v
            verts.append(((u - 0.5) * length, math.cos(th) * (width / 2) * (0.1 + 0.9 * taper), z0 + math.sin(th) * height * (0.12 + 0.88 * taper) * ridge))
            uvs.append((u, j / seg_v))
    for i in range(seg_u):
        for j in range(seg_v):
            a = i * (seg_v + 1) + j
            b = a + seg_v + 1
            faces.append((a, b, b + 1, a + 1))
    return from_faces(verts, faces, "shell", uvs, smooth=True)


def metro_station():
    """Red Line elevated station: shell roof over the platforms, glazed concourse below, on piers. The footbridges
    across Sheikh Zayed Road differ per station, so the web app keeps drawing those."""
    parts = [shell(134, 30, 16.5, z0=RAIL_Z - 1.2), box((128, 20, 2.4), (0, 0, RAIL_Z - 0.9), "concrete"), box((92, 17, 4.6), (0, 0, 6.3), "glass")]
    for x in (-52, -26, 0, 26, 52):                                   # piers under the platform
        for y in (-6.5, 6.5):
            parts.append(cyl(1.3, 1.1, RAIL_Z - 2.1, (x, y, (RAIL_Z - 2.1) / 2), "concrete", 10))
    for sx in (-1, 1):
        parts.append(box((1.0, 20, 3.4), (sx * 63.5, 0, RAIL_Z + 1.2), "glass"))       # platform end screens
    parts.append(box((96, 18.5, 0.5), (0, 0, 3.75), "concrete"))
    return join(parts, "metro_station"), {"length_m": 134, "rail_height_m": RAIL_Z, "source": "https://en.wikipedia.org/wiki/Dubai_Metro"}


def viaduct_segment():
    """30 m of the elevated viaduct: U-shaped deck with parapets, red side stripes, one pier with a flared head."""
    prof = [(-4.9, RAIL_Z + 0.9), (-4.9, RAIL_Z - 0.5), (-2.5, RAIL_Z - 2.3), (2.5, RAIL_Z - 2.3), (4.9, RAIL_Z - 0.5), (4.9, RAIL_Z + 0.9),
            (4.45, RAIL_Z + 0.9), (4.45, RAIL_Z), (-4.45, RAIL_Z), (-4.45, RAIL_Z + 0.9)]
    n = len(prof)
    verts = [(-15, y, z) for y, z in prof] + [(15, y, z) for y, z in prof]
    faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    parts = [from_faces(verts, faces, "concrete")]
    for sy in (-1, 1):
        parts.append(box((30, 0.06, 0.7), (0, sy * 4.94, RAIL_Z + 0.1), "red"))
        parts.append(box((30, 0.18, 0.12), (0, sy * 0.72, RAIL_Z + 0.06), "steel"))      # rails
        parts.append(box((30, 0.18, 0.12), (0, sy * 2.2 + sy * 0.72 - sy * 0.72, RAIL_Z + 0.06), "steel"))
    parts += [cyl(1.35, 1.15, RAIL_Z - 3.3, (0, 0, (RAIL_Z - 3.3) / 2), "concrete", 12, smooth=True),
              cyl(1.2, 2.6, 1.1, (0, 0, RAIL_Z - 2.85), "concrete", 12, smooth=True)]
    return join(parts, "viaduct_segment"), {"length_m": 30, "rail_height_m": RAIL_Z, "source": "https://en.wikipedia.org/wiki/Dubai_Metro"}


def metro_car():
    """One car of the five-car driverless train (the web app instances it five times per train): rounded body,
    a dark window band, a red stripe, roof equipment and bogies. Origin at the body centre; length along X."""
    length = 17.2
    body = box((length, 2.8, 3.5), (0, 0, 0), "body")
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)      # bevel in metres, not in the unit cube
    mod = body.modifiers.new("bevel", "BEVEL")
    mod.width, mod.segments = 0.38, 2
    bpy.ops.object.modifier_apply(modifier=mod.name)
    parts = [body, box((length - 0.7, 2.86, 1.05), (0, 0, 0.55), "win"), box((length - 0.2, 2.88, 0.34), (0, 0, -0.95), "red")]
    for x in (-4.6, 0, 4.6):
        parts.append(box((2.6, 1.7, 0.32), (x, 0, 1.86), "body"))                       # roof air-conditioning units
    for x in (-5.6, 5.6):
        parts.append(box((2.6, 2.3, 0.7), (x, 0, -2.0), "steel"))                       # bogies
    for sx in (-1, 1):
        parts.append(box((0.08, 2.0, 1.5), (sx * (length / 2 + 0.01), 0, 0.5), "win"))  # end windows
    return join(parts, "metro_car"), {"length_m": length, "cars_per_train": 5, "source": "https://en.wikipedia.org/wiki/Dubai_Metro"}


def date_palm(name, height, fronds, lean, seed):
    """Date palm (R5): a leaning, tapering trunk and a crown of drooping fronds. Origin at the foot of the trunk."""
    import random
    rnd = random.Random(seed)
    parts, segs = [], 6
    for i in range(segs):                                             # trunk: stacked frusta that drift sideways
        z0, z1 = height * i / segs, height * (i + 1) / segs
        r0, r1 = 0.42 - 0.16 * i / segs, 0.42 - 0.16 * (i + 1) / segs
        o = cyl(r0, r1, z1 - z0, (lean * ((i + 0.5) / segs) ** 2, 0, (z0 + z1) / 2), "trunk", 7, smooth=True)
        parts.append(o)
    top = (lean, 0.0, height)
    parts.append(cyl(0.5, 0.3, 0.9, (lean, 0, height + 0.1), "trunk", 7, smooth=True))       # crown boss
    for f in range(fronds):
        ang = 2 * math.pi * f / fronds + rnd.uniform(-0.2, 0.2)
        length, rise, droop = rnd.uniform(3.6, 4.8), rnd.uniform(0.6, 2.0), rnd.uniform(2.4, 3.8)
        dx, dy = math.cos(ang), math.sin(ang)
        verts, faces, n = [], [], 6
        for k in range(n + 1):
            t = k / n
            cx, cy, cz = top[0] + dx * length * t, top[1] + dy * length * t, top[2] + rise * t - droop * t * t
            w = 0.55 * (1 - t) ** 0.7 + 0.04
            verts += [(cx - dy * w, cy + dx * w, cz - 0.25 * w), (cx, cy, cz + 0.1), (cx + dy * w, cy - dx * w, cz - 0.25 * w)]
        for k in range(n):
            a = k * 3
            faces += [(a, a + 3, a + 4, a + 1), (a + 1, a + 4, a + 5, a + 2)]
        parts.append(from_faces(verts, faces, "leaf", smooth=True))
    return join(parts, name), {"height_m": height, "source": "https://en.wikipedia.org/wiki/Date_palm"}


def car():
    """A generic saloon, 4.5 m, no badge or logo: body (the web app colours it per car), cabin glass, roof panel
    (cream cars get a coloured roof = Dubai taxi livery), wheels. Origin on the road under the centre; length along X."""
    lower = box((4.5, 1.8, 0.62), (0, 0, 0.62), "body")
    bpy.context.view_layer.objects.active = lower
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mod = lower.modifiers.new("bevel", "BEVEL")
    mod.width, mod.segments = 0.12, 1
    bpy.ops.object.modifier_apply(modifier=mod.name)
    parts = [lower, box((2.5, 1.62, 0.5), (-0.15, 0, 1.17), "win"), box((2.3, 1.52, 0.07), (-0.15, 0, 1.45), "roof")]
    for x in (-1.45, 1.45):
        for y in (-0.9, 0.9):
            parts.append(cyl(0.33, 0.33, 0.24, (x, y, 0.33), "win", 8, rot=(math.radians(90), 0, 0)))
    return join(parts, "car"), {"length_m": 4.5, "source": "generic vehicle, no real model"}


def bus():
    """A generic 12 m city bus, no livery or logo: body, window band, roof unit, wheels."""
    parts = [box((12.0, 2.55, 2.75), (0, 0, 1.75), "body"), box((11.4, 2.59, 1.0), (0, 0, 2.15), "win"), box((4.0, 1.8, 0.3), (-1.5, 0, 3.27), "body")]
    for x in (-3.9, 3.6):
        for y in (-1.28, 1.28):
            parts.append(cyl(0.5, 0.5, 0.3, (x, y, 0.5), "win", 8, rot=(math.radians(90), 0, 0)))
    return join(parts, "bus"), {"length_m": 12.0, "source": "generic vehicle, no real model"}


MODELS = [
    (burj_khalifa, (), 60000), (lambda: emirates_tower("emirates_office_tower", 355.0, 54.0), (), 25000),
    (lambda: emirates_tower("emirates_hotel_tower", 309.0, 48.0), (), 25000), (museum_of_the_future, (), 25000),
    (trade_centre_tower, (), 25000), (dubai_frame, (), 25000), (metro_station, (), 15000), (viaduct_segment, (), 15000), (metro_car, (), 8000),
    (lambda: date_palm("palm_a", 9.0, 15, 0.6, 1), (), 1500), (lambda: date_palm("palm_b", 11.0, 17, -0.9, 2), (), 1500),
    (lambda: date_palm("palm_c", 7.2, 13, 0.3, 3), (), 1500), (car, (), 1500), (bus, (), 1500),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PREVIEW, exist_ok=True)
    report = {}
    if ONLY:                                             # a partial run keeps the other models' entries
        try:
            with open(os.path.join(OUT, "models.json"), encoding="utf-8") as f:
                report = json.load(f)["models"]
        except (OSError, ValueError, KeyError):
            report = {}
    for build, args, budget in MODELS:
        reset()
        obj, info = build(*args)
        if ONLY and obj.name not in ONLY[0]:
            continue
        bake_ao(obj)
        lod = make_lod(obj)
        bake_ao(lod)
        n, n1 = tris(obj), tris(lod)
        if n > budget:
            raise SystemExit(f"{obj.name}: {n} triangles is over its budget of {budget}")
        export(obj, os.path.join(OUT, obj.name + ".glb"))
        export(lod, os.path.join(OUT, obj.name + "_lod1.glb"))
        lod.hide_render = True
        engine = render(obj, os.path.join(PREVIEW, obj.name + ".png"))
        report[obj.name] = {**info, "triangles": n, "triangles_lod1": n1, "budget": budget,
                            "bytes": os.path.getsize(os.path.join(OUT, obj.name + ".glb")),
                            "bytes_lod1": os.path.getsize(os.path.join(OUT, obj.name + "_lod1.glb")),
                            "size_m": [round(v, 1) for v in obj.dimensions], "materials": [m.name for m in obj.data.materials],
                            "preview_engine": engine}
        print("MODEL", obj.name, report[obj.name])
    with open(os.path.join(OUT, "models.json"), "w", encoding="utf-8") as f:
        json.dump({"blender": bpy.app.version_string, "note": "Approximations from public dimensions, not survey models.", "models": report}, f, indent=1)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(1)
