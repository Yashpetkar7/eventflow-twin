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
RAIL_Z = 12.2                       # top of rail above ground, as in apps/web/src/components/twin/Metro.tsx
COLOURS = {                         # preview colours only; the web app supplies the real materials by slot name
    "glass": (0.45, 0.6, 0.72, 0.9, 0.2), "steel": (0.6, 0.65, 0.7, 0.85, 0.3), "concrete": (0.86, 0.84, 0.8, 0.0, 0.75),
    "gold": (0.83, 0.68, 0.33, 0.9, 0.28), "green": (0.36, 0.56, 0.28, 0.0, 0.9), "mof": (0.88, 0.89, 0.9, 0.7, 0.3),
    "dwtc": (0.9, 0.87, 0.8, 0.0, 0.65), "shell": (0.83, 0.7, 0.42, 0.82, 0.3), "red": (0.85, 0.06, 0.06, 0.0, 0.5),
    "body": (0.95, 0.96, 0.97, 0.4, 0.3), "win": (0.1, 0.15, 0.22, 0.6, 0.2),
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
def burj_khalifa():
    """828 m. Y-shaped plan: a hexagonal core and three wings that step back one after another, 27 setbacks in an
    upward spiral to about 585 m, then the pinnacle and spire. Public dimensions: height 828 m, roof about 585 m."""
    parts, tiers, steps = [], 585.0, 27
    step_h = tiers / steps
    for i in range(9):
        z0, z1 = i * tiers / 9, (i + 1) * tiers / 9
        parts.append(cyl(24 - i * 2.05, 24 - (i + 1) * 2.05, z1 - z0, (0, 0, (z0 + z1) / 2), "glass", verts=6))
    for w in range(3):
        ang, prev = w * 2 * math.pi / 3, 0.0
        for k in range(9):
            top = min(tiers, (w + 1 + k * 3) * step_h)
            length, width, h = 66 * (1 - k / 9.6) ** 1.1 + 7, 31 - k * 2.5, top - prev
            if h <= 0:
                continue
            for o in (box((length, width, h), (length / 2 + 6, 0, prev + h / 2), "glass"),
                      cyl(width / 2, width / 2, h, (length + 6, 0, prev + h / 2), "glass", verts=14),
                      box((length + 4, width + 0.8, 1.2), (length / 2 + 6, 0, top - 0.6), "steel")):      # ledge at each setback
                rotate_about_z(o, ang)
                parts.append(o)
            prev = top
    parts += [cyl(8.4, 5.2, 70, (0, 0, tiers + 35), "steel", 10), cyl(5.2, 2.6, 70, (0, 0, tiers + 105), "steel", 10),
              cyl(2.6, 0.5, 103, (0, 0, tiers + 140 + 51.5), "steel", 8)]
    return join(parts, "burj_khalifa"), {"height_m": 828, "source": "https://en.wikipedia.org/wiki/Burj_Khalifa"}


def emirates_tower(name, h, side):
    """Jumeirah Emirates Towers: equilateral-triangle plan, a crown that slopes up to one corner, a spire from that
    corner; cylindrical corner columns, band lines, a drum podium. 355 m (office) and 309 m (hotel)."""
    r, shaft, crown = side / math.sqrt(3), h * 0.74, h * 0.9
    corner = lambda i, k=1.0: (math.cos(i * 2 * math.pi / 3) * r * k, math.sin(i * 2 * math.pi / 3) * r * k)        # noqa: E731
    base = [corner(i) for i in range(3)]
    top = [corner(0, 0.5), corner(1, 0.86), corner(2, 0.86)]
    top_z = [crown, shaft + (crown - shaft) * 0.18, shaft + (crown - shaft) * 0.18]
    verts = [(x, y, 0) for x, y in base] + [(x, y, shaft) for x, y in base] + [(x, y, z) for (x, y), z in zip(top, top_z)]
    faces = []
    for i in range(3):
        j = (i + 1) % 3
        faces += [(i, j, 3 + j, 3 + i), (3 + i, 3 + j, 6 + j, 6 + i)]
    faces.append((6, 7, 8))
    parts = [from_faces(verts, faces, "glass")]
    for i in range(3):                                                # corner columns
        x, y = corner(i, 0.985)
        parts.append(cyl(2.6, 2.6, shaft, (x, y, shaft / 2), "steel", 10))
    z = 28.0
    while z < shaft - 10:                                             # band lines every eight storeys, on the shaft's own triangle
        ring = [corner(i, 1.012) for i in range(3)]
        parts.append(from_faces([(x, y, z) for x, y in ring] + [(x, y, z + 1.1) for x, y in ring],
                                [(0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5), (0, 2, 1), (3, 4, 5)], "steel"))
        z += 28.0
    parts.append(cyl(r * 1.25, r * 1.2, 14, (0, 0, 7), "concrete", 24))
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
    drawn by the web app on these UVs), corner piers, a stepped crown and a mast."""
    shaft = box((40, 40, 132), (0, 0, 66), "dwtc")
    bpy.context.view_layer.objects.active = shaft
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.reset()                                                # every face gets the full 0–1 square
    bpy.ops.object.mode_set(mode="OBJECT")
    parts = [shaft]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(box((4.5, 4.5, 136), (sx * 20, sy * 20, 68), "concrete"))
    for z in (0.6, 132.4):
        parts.append(box((46, 46, 1.2), (0, 0, z), "concrete"))
    parts += [box((44, 44, 5), (0, 0, 136.5), "concrete"), box((24, 24, 9), (0, 0, 143.5), "concrete"),
              cyl(0.9, 0.5, 14, (0, 0, 155), "steel", 8)]
    return join(parts, "trade_centre_tower"), {"height_m": 149, "source": "https://en.wikipedia.org/wiki/Dubai_World_Trade_Centre"}


def dubai_frame():
    """150 m high, 93 m wide: two towers joined by a bridge at the top, on a low base."""
    w, h, t, d = 93.0, 150.0, 9.0, 14.0
    parts = [box((t, d, h), (-(w - t) / 2, 0, h / 2), "gold"), box((t, d, h), ((w - t) / 2, 0, h / 2), "gold"),
             box((w, d, t), (0, 0, h - t / 2), "gold"), box((w, d + 8, 6), (0, 0, 3), "concrete")]
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


MODELS = [
    (burj_khalifa, (), 60000), (lambda: emirates_tower("emirates_office_tower", 355.0, 54.0), (), 25000),
    (lambda: emirates_tower("emirates_hotel_tower", 309.0, 48.0), (), 25000), (museum_of_the_future, (), 25000),
    (trade_centre_tower, (), 25000), (dubai_frame, (), 25000), (metro_station, (), 15000), (viaduct_segment, (), 15000), (metro_car, (), 8000),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(PREVIEW, exist_ok=True)
    report = {}
    for build, args, budget in MODELS:
        reset()
        obj, info = build(*args)
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
