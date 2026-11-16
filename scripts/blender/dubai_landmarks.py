"""Second set of hand-built landmarks (decision #127): the Dubai Mall rebuilt, One Za'abeel with The Link, Address Sky
View, Address Downtown, Coca-Cola Arena and Burj Al Arab. Loaded by build_models.py, which passes itself in as `h`
(its helpers: material, join, cyl, box, beam).

Each model stands on its mapped footprint (scripts/blender/landmark_sites.json, from scripts/landmark_sites.py; the
mall's is in r8b_sites.json) at the map's own heights; what the map does not hold (setbacks, skylights, bands, the
sail) is drawn from public photographs as an approximation. No logos, signage or text.

Every piece is a closed or capped solid built with a known winding, so a roof can never end up facing down (the first
Dubai Mall was one open 158-sided cap, and it was culled: the mall looked missing from above).

Material slots added here, mapped to materials by apps/web/src/components/twin/Landmarks.tsx:
    stone     sandstone cladding (floodlit warm after dark)        roof      flat roof membrane (dark after dark)
    skylight  glazed vaults and domes (glow from inside)           white     white cladding, slab edges, steel
    sail      Burj Al Arab's fabric wall (colour wash after dark)  dark      dark metal panels
    led       the arena's light bands (colour cycle after dark)    glow      warm architectural light lines
    water     roof pools
"""
import json
import math
import os

import bpy
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

SITES2 = os.path.join(os.path.dirname(__file__), "landmark_sites.json")
COLOURS = {"stone": (0.82, 0.74, 0.6, 0.0, 0.85), "skylight": (0.55, 0.72, 0.8, 0.5, 0.15), "white": (0.93, 0.93, 0.91, 0.0, 0.5),
           "sail": (0.96, 0.96, 0.95, 0.0, 0.6), "dark": (0.18, 0.2, 0.23, 0.6, 0.45), "led": (0.85, 0.2, 0.2, 0.0, 0.4),
           "glow": (1.0, 0.9, 0.7, 0.0, 0.4), "water": (0.2, 0.5, 0.65, 0.3, 0.1)}


# ---------------------------------------------------------------- geometry helpers (plan coordinates: Blender x, y)
def ccw(ring):
    """A scene ring [(x, z), …] as Blender plan points [(x, y)], y = −z, anticlockwise seen from above."""
    pts = [(x, -z) for x, z in ring]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts if area(pts) > 0 else pts[::-1]


def area(pts):
    return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2


def centroid(pts):
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def offset(pts, d):
    """The anticlockwise ring moved outwards by d metres (inwards if negative), mitred at the corners."""
    n, out = len(pts), []
    for i in range(n):
        (x0, y0), (x1, y1), (x2, y2) = pts[i - 1], pts[i], pts[(i + 1) % n]
        a, b = Vector((y1 - y0, x0 - x1)), Vector((y2 - y1, x1 - x2))            # outward normals of the two edges
        a, b = (a.normalized() if a.length > 1e-9 else b.normalized()), (b.normalized() if b.length > 1e-9 else a.normalized())
        m = a + b
        if m.length < 1e-6:
            m = a
        m.normalize()
        k = d / max(0.5, m.dot(a))                                                # mitre, at most twice the offset
        out.append((x1 + m.x * k, y1 + m.y * k))
    return out


def clean(pts):
    """Remove the small loops an inward offset leaves where an edge was shorter than the offset: wherever two nearby
    edges cross, the points between them are replaced by the crossing point."""
    def cross(a, b, c, e):
        r, q = (b[0] - a[0], b[1] - a[1]), (e[0] - c[0], e[1] - c[1])
        den = r[0] * q[1] - r[1] * q[0]
        if abs(den) < 1e-9:
            return None
        t = ((c[0] - a[0]) * q[1] - (c[1] - a[1]) * q[0]) / den
        u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den
        return (a[0] + r[0] * t, a[1] + r[1] * t) if 0 < t < 1 and 0 < u < 1 else None
    pts = list(pts)
    for _ in range(len(pts)):
        n, hit = len(pts), None
        for i in range(n):
            for span in (2, 3, 4, 5):
                j = (i + span) % n
                x = cross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])
                if x:
                    hit = (i, span, x)
                    break
            if hit:
                break
        if not hit or n < 8:
            break
        i, span, x = hit
        drop = {(i + k) % n for k in range(1, span + 1)}
        pts = [x if k == (i + 1) % n else q for k, q in enumerate(pts) if k not in drop or k == (i + 1) % n]
    return pts


def scaled(pts, k, about=None):
    cx, cy = about or centroid(pts)
    return [(cx + (x - cx) * k, cy + (y - cy) * k) for x, y in pts]


def inside(p, pts):
    c = False
    for i in range(len(pts)):
        (x0, y0), (x1, y1) = pts[i - 1], pts[i]
        if (y0 > p[1]) != (y1 > p[1]) and p[0] < (x1 - x0) * (p[1] - y0) / (y1 - y0) + x0:
            c = not c
    return c


def depth(p, pts):
    """How far inside the ring a point is, in metres (negative outside)."""
    best = 1e9
    for i in range(len(pts)):
        a, b = Vector(pts[i - 1]), Vector(pts[i])
        ab, ap = b - a, Vector(p) - a
        t = max(0.0, min(1.0, ap.dot(ab) / max(1e-9, ab.length_squared)))
        best = min(best, (ap - ab * t).length)
    return best if inside(p, pts) else -best


def simplify(pts, tol):
    """Douglas–Peucker on a closed ring."""
    def dp(seg):
        if len(seg) < 3:
            return seg
        a, b = Vector(seg[0]), Vector(seg[-1])
        ab = b - a
        far, at = 0.0, 0
        for i in range(1, len(seg) - 1):
            ap = Vector(seg[i]) - a
            d = (ap - ab * max(0.0, min(1.0, ap.dot(ab) / max(1e-9, ab.length_squared)))).length
            if d > far:
                far, at = d, i
        return dp(seg[:at + 1])[:-1] + dp(seg[at:]) if far > tol else [seg[0], seg[-1]]
    k = max(range(len(pts)), key=lambda i: pts[i][0])                         # split at two far-apart points
    j = min(range(len(pts)), key=lambda i: pts[i][0])
    lo, hi = min(k, j), max(k, j)
    return dp(pts[lo:hi + 1])[:-1] + dp(pts[hi:] + pts[:lo + 1])[:-1]


def principal(pts):
    """Unit vector along the ring's long axis, and its half length."""
    cx, cy = centroid(pts)
    sxx = sum((x - cx) ** 2 for x, _ in pts); syy = sum((y - cy) ** 2 for _, y in pts); sxy = sum((x - cx) * (y - cy) for x, y in pts)
    ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
    ux, uy = math.cos(ang), math.sin(ang)
    return (ux, uy), max(abs((x - cx) * ux + (y - cy) * uy) for x, y in pts)


class Kit:
    """Mesh builders bound to build_models.py's material table."""

    def __init__(self, h, lite=False):
        """`lite`: the far-distance version of a model. It is built again without the fine parts (slab edges, piers,
        roof plant), because Blender's decimator, which makes the other models' far versions, collapses these models'
        few large wall faces first and leaves the bands floating."""
        self.h, self.lite = h, lite
        h.COLOURS.update(COLOURS)

    def join(self, parts, name):
        """build_models.join, and the ambient-occlusion bake told to sample inside each face (see bake_ao)."""
        o = self.h.join([q for q in parts if q is not None], name)
        o["ao_inset"] = 0.22
        return o

    def mesh(self, verts, faces):
        """One connected mesh from (vertex indices, slot name) faces: shared vertices, a material per face."""
        me = bpy.data.meshes.new("m")
        me.from_pydata([tuple(v) for v in verts], [], [f for f, _ in faces])
        me.update()
        slots = []
        for poly, (_, slot) in zip(me.polygons, faces):
            if slot not in slots:
                slots.append(slot)
                me.materials.append(self.h.material(slot))
            poly.material_index = slots.index(slot)
            poly.use_smooth = False
        o = bpy.data.objects.new("o", me)
        bpy.context.collection.objects.link(o)
        return o

    def solid(self, pts, z0, z1, wall, roof, bottom=None):
        """An anticlockwise plan ring extruded from z0 to z1: walls, a triangulated cap, and a soffit if `bottom`."""
        n = len(pts)
        verts = [(x, y, z0) for x, y in pts] + [(x, y, z1) for x, y in pts]
        faces = [((i, (i + 1) % n, n + (i + 1) % n, n + i), wall) for i in range(n)]
        for a, b, c in tessellate_polygon([[Vector((x, y, 0.0)) for x, y in pts]]):
            (ax, ay), (bx, by), (cx, cy) = pts[a], pts[b], pts[c]
            if (bx - ax) * (cy - ay) - (cx - ax) * (by - ay) < 0:
                b, c = c, b
            faces.append(((n + a, n + b, n + c), roof))
            if bottom:
                faces.append(((a, c, b), bottom))
        return self.mesh(verts, faces)

    def band(self, pts, z0, z1, slot, out=0.45, inner=0.0):
        """A closed ring standing proud of the wall by `out` metres (a slab edge, light line, cornice or parapet). It is
        a ring, not a lid: the roof inside it stays visible. `inner` moves its inside face in from the wall line."""
        if self.lite and z1 - z0 < 2.6 and slot not in ("led", "glow"):          # far version: only the bands that carry light
            return None
        a, b = offset(pts, out), (offset(pts, -inner) if inner else list(pts))
        n = len(pts)
        verts = [(x, y, z0) for x, y in a] + [(x, y, z1) for x, y in a] + [(x, y, z0) for x, y in b] + [(x, y, z1) for x, y in b]
        faces = []
        for i in range(n):
            j = (i + 1) % n
            faces += [((i, j, n + j, n + i), slot),                          # outer face
                      ((n + i, n + j, 3 * n + j, 3 * n + i), slot),          # top
                      ((2 * n + i, 2 * n + j, j, i), slot),                  # underside
                      ((2 * n + j, 2 * n + i, 3 * n + i, 3 * n + j), slot)]  # inner face
        return self.mesh(verts, faces)

    def slab(self, p0, p1, z0, z1, thick, slot):
        """A closed upright box along a wall line from p0 to p1 (shop fronts, canopies)."""
        a, b = Vector(p0), Vector(p1)
        d = (b - a).normalized()
        s = Vector((-d.y, d.x)) * (thick / 2)
        ring = [tuple(a - s), tuple(b - s), tuple(b + s), tuple(a + s)]
        return self.solid(ring if area(ring) > 0 else ring[::-1], z0, z1, slot, slot, bottom=slot)

    def vault(self, p0, p1, z, r, slot, seg=8, rise=1.0):
        """A glazed barrel vault (half cylinder, closed) from p0 to p1 with its springing at height z."""
        seg = 3 if self.lite else seg
        a, b = Vector(p0), Vector(p1)
        d = (b - a).normalized()
        s = Vector((-d.y, d.x))
        verts = []
        for e in (a, b):
            for k in range(seg + 1):
                t = math.pi * k / seg
                verts.append((e.x + s.x * r * math.cos(t), e.y + s.y * r * math.cos(t), z + r * rise * math.sin(t)))
        m = seg + 1
        faces = [((k, m + k, m + k + 1, k + 1), slot) for k in range(seg)]
        faces += [(tuple(range(m - 1, -1, -1)), slot), (tuple(range(m, 2 * m)), slot), ((0, m - 1, 2 * m - 1, m), slot)]
        o = self.mesh(verts, faces)
        for p in o.data.polygons[:seg]:
            p.use_smooth = True
        return o

    def dome(self, c, z, r, slot, seg=16, rings=5, rise=0.55):
        """A shallow glazed dome (closed underneath)."""
        seg, rings = (8, 2) if self.lite else (seg, rings)
        verts, faces = [], []
        for j in range(rings):
            t = (math.pi / 2) * j / rings
            for k in range(seg):
                a = 2 * math.pi * k / seg
                verts.append((c[0] + r * math.cos(t) * math.cos(a), c[1] + r * math.cos(t) * math.sin(a), z + r * rise * math.sin(t)))
        verts.append((c[0], c[1], z + r * rise))
        for j in range(rings - 1):
            faces += [((j * seg + k, j * seg + (k + 1) % seg, (j + 1) * seg + (k + 1) % seg, (j + 1) * seg + k), slot) for k in range(seg)]
        top = (rings - 1) * seg
        faces += [((top + k, top + (k + 1) % seg, len(verts) - 1), slot) for k in range(seg)]
        faces.append((tuple(range(seg - 1, -1, -1)), slot))
        o = self.mesh(verts, faces)
        for p in o.data.polygons[:-1]:
            p.use_smooth = True
        return o

    def loft(self, sections, slots, cap):
        """Rings with the same number of points, one above the other: side faces take `slots[i]` for the edge that
        starts at point i, the top ring is capped, the bottom is closed."""
        n = len(sections[0][1])
        verts = [(x, y, z) for z, pts in sections for x, y in pts]
        faces = []
        for j in range(len(sections) - 1):
            faces += [((j * n + i, j * n + (i + 1) % n, (j + 1) * n + (i + 1) % n, (j + 1) * n + i), slots[i]) for i in range(n)]
        top = (len(sections) - 1) * n
        faces.append((tuple(range(top, top + n)), cap))
        faces.append((tuple(range(n - 1, -1, -1)), cap))
        return self.mesh(verts, faces)


# ---------------------------------------------------------------- the Dubai Mall
def dubai_mall(kit, site):
    """The Dubai Mall on its mapped footprint (158 points) at its mapped height: sandstone walls with a cornice and
    piers, glazed fronts on the lake promenade, a set-back upper level, the glazed vaults over the main malls in the
    loop a visitor walks, a dome over the central court and smaller ones where the malls meet, and roof plant.
    The vault layout is a plausible loop inside the footprint, not a survey of the real roof."""
    h = kit.h
    q = site["prisms"][0]
    ring = ccw(q["ring"])
    H = q["h"] or 20.0
    parts = [kit.solid(ring, 0, H, "stone", "roof"), kit.band(ring, H - 1.6, H + 1.4, "stone", 0.7, 0.5)]  # body, cornice and parapet
    parts.append(kit.band(ring, 0, 1.2, "stone", 0.5))                                                    # plinth
    cx, cy = centroid(ring)
    lake = max(p[0] for p in ring)                                                                        # the lake lies on the +x side
    n = len(ring)
    for i in range(n):
        a, b = Vector(ring[i]), Vector(ring[(i + 1) % n])
        length = (b - a).length
        mid = (a + b) / 2
        if mid.x > lake - 95 and length > 6:                                                              # promenade: glazed restaurant fronts
            parts.append(kit.slab(tuple(a), tuple(b), 1.2, 9.5, 1.3, "glass"))
        elif length > 22 and not kit.lite:                                                                # long blank walls: piers every ~11 m
            k = int(length // 11)
            for j in range(1, k):
                p = a + (b - a) * (j / k)
                d = (b - a).normalized()
                parts.append(kit.slab(tuple(p - d * 0.7), tuple(p + d * 0.7), 1.2, H - 1.6, 1.5, "stone"))
    # upper level: the outline simplified and moved in, kept only where it stays well inside the real footprint
    up = clean([p for p in offset(simplify(ring, 14.0), -24.0) if depth(p, ring) > 14.0])
    U = H + 6.5
    if len(up) >= 3 and area(up) > 0:
        parts += [kit.solid(up, H, U, "stone", "roof"), kit.band(up, U - 0.9, U + 0.9, "stone", 0.5, 0.5)]
    else:
        up, U = ring, H
    # glazed vaults: two long malls, three cross malls; each run is clipped to where the upper level is wide enough
    xs, ys = [p[0] for p in up], [p[1] for p in up]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    lx = [x0 + (x1 - x0) * f for f in (0.3, 0.7)]
    ly = [y0 + (y1 - y0) * f for f in (0.16, 0.5, 0.84)]
    R = 7.5

    def runs(p, q_, step=6.0, margin=R + 5.0):
        a, b = Vector(p), Vector(q_)
        m = max(2, int((b - a).length / step))
        out, start, prev = [], None, None
        for k in range(m + 1):
            pt = a + (b - a) * (k / m)
            ok = depth(tuple(pt), up) > margin
            if ok and start is None:
                start = pt
            if not ok and start is not None:
                if (prev - start).length > 30:
                    out.append((tuple(start), tuple(prev)))
                start = None
            prev = pt if ok else prev
        if start is not None and (prev - start).length > 30:
            out.append((tuple(start), tuple(prev)))
        return out
    lines = [((x, y0), (x, y1)) for x in lx] + [((x0, y), (x1, y)) for y in ly]
    spans = [r for p, q_ in lines for r in runs(p, q_)]
    for a, b in spans:
        parts.append(kit.vault(a, b, U, R, "skylight"))
        if not kit.lite:
            parts.append(kit.slab(a, b, U, U + 0.8, 2 * R + 2.4, "white"))                               # the vault's kerb
    domes = [((cx if depth((cx, cy), up) > 40 else (lx[0] + lx[1]) / 2, ly[1]), 24.0)]
    domes += [((x, y), 12.5) for x in lx for y in (ly[0], ly[2])]
    for c, r in domes:
        if depth(c, up) > r + 4:
            parts.append(kit.dome(c, U, r, "skylight"))
            parts.append(kit.band([(c[0] + r * math.cos(2 * math.pi * k / 20), c[1] + r * math.sin(2 * math.pi * k / 20)) for k in range(20)], U, U + 1.0, "white", 1.6))
    # roof plant: fixed pseudo-random boxes on both roof levels, clear of the glazing
    seed = 7

    def rnd():
        nonlocal seed
        seed = (seed * 1103515245 + 12345) % 2147483648
        return seed / 2147483648
    placed = 0
    for _ in range(0 if kit.lite else 900):
        if placed >= 90:
            break
        p = (min(p_[0] for p_ in ring) + rnd() * (lake - min(p_[0] for p_ in ring)), min(p_[1] for p_ in ring) + rnd() * (max(p_[1] for p_ in ring) - min(p_[1] for p_ in ring)))
        on_up = depth(p, up) > 8 if up is not ring else False
        if not on_up and not (depth(p, ring) > 7 and depth(p, up) < -5):
            continue
        if any((Vector(p) - Vector(c)).length < r + 9 for c, r in domes):
            continue
        if any(abs((Vector(p) - Vector(a)).cross(Vector(b) - Vector(a))) / max(1e-6, (Vector(b) - Vector(a)).length) < R + 6
               and -8 < (Vector(p) - Vector(a)).dot((Vector(b) - Vector(a)).normalized()) < (Vector(b) - Vector(a)).length + 8 for a, b in spans):
            continue
        w, d_, t = 5 + rnd() * 9, 4 + rnd() * 6, 1.8 + rnd() * 2.6
        z = (U if on_up else H) + t / 2
        parts.append(h.box((w, d_, t), (p[0], p[1], z), "steel" if rnd() < 0.6 else "white", rot_z=rnd() * 0.3))
        placed += 1
    return kit.join(parts, site["model"]), {"name": site["name"], "height_m": H, "source": site["height_source"],
                                          "note": "footprint and height from the map; vaults, domes and upper level are an approximation"}


# ---------------------------------------------------------------- One Za'abeel
def one_zaabeel(kit, site):
    """One Za'abeel: the two towers on their mapped footprints and The Link, the 230 m building that hangs between them
    100 m up and cantilevers past the taller one, drawn from its mapped part (100 → 123 m)."""
    h = kit.h
    parts = []
    for q in site["prisms"]:
        r, top, low = ccw(q["ring"]), q["h"], q["min_h"]
        if low >= 60:                                                            # The Link
            parts.append(kit.solid(r, low, top, "glass", "roof", bottom="steel"))
            parts.append(kit.band(r, low - 0.7, low + 0.5, "glow", 0.5))         # the light line round its underside
            parts.append(kit.band(r, top - 0.4, top + 0.9, "white", 0.4))        # roof edge
            (ux, uy), half = principal(r)
            c = centroid(r)
            pool = [(c[0] + ux * a + -uy * b, c[1] + uy * a + ux * b) for a, b in ((-half * 0.55, -3.5), (half * 0.55, -3.5), (half * 0.55, 3.5), (-half * 0.55, 3.5))]
            if all(depth(p, r) > 2 for p in pool):
                parts.append(kit.solid(pool if area(pool) > 0 else pool[::-1], top, top + 0.5, "white", "water"))
        elif top >= 150:                                                         # a tower
            crown = top - 6.0
            parts.append(kit.solid(r, 0, crown, "glass", "steel"))
            parts.append(kit.band(r, crown - 0.6, crown + 0.6, "steel", 0.35))
            parts.append(kit.solid(offset(r, -2.2), crown, top, "steel", "steel"))               # recessed plant screen
            for z in range(60, int(crown) - 20, 60):                                             # refuge / plant floors read as dark bands
                parts.append(kit.band(r, z, z + 3.6, "steel", 0.25))
            parts.append(kit.band(r, 0, 16, "concrete", 1.6))                                    # base
        else:                                                                    # the podium the towers stand on
            parts.append(kit.solid(r, 0, top, "concrete", "roof"))
    return kit.join(parts, site["model"]), {"name": site["name"], **site["facts"], "source": site["source"]}


# ---------------------------------------------------------------- Address Sky View
def address_sky_view(kit, site):
    """Address Sky View: two rounded towers joined by a sky bridge near the top, from their mapped parts. The white
    slab edges that wrap every few floors are the building's look from any distance."""
    h = kit.h
    parts = []
    shafts = sorted((q for q in site["prisms"] if q["min_h"] == 0 and q["area"] >= 300 and q["h"] >= 150), key=lambda q: (q["h"], -q["area"]))
    groups = []
    for q in shafts:
        c = centroid(ccw(q["ring"]))
        g = next((g for g in groups if (Vector(g["c"]) - Vector(c)).length < 40), None)
        if g is None:
            groups.append({"c": c, "parts": [q]})
        else:
            g["parts"].append(q)
    for g in groups:
        base = 0.0
        for q in g["parts"]:                                                     # the widest part from the ground, the others stacked above it
            if q["h"] <= base:
                continue
            r = ccw(q["ring"])
            parts.append(kit.solid(r, base, q["h"], "glass", "white"))
            z = max(base, 18.0) + 5.4
            while z < q["h"] - 2:                                                # slab edges every third floor
                parts.append(kit.band(r, z, z + 0.9, "white", 0.5))
                z += 10.8
            parts.append(kit.band(r, q["h"] - 1.2, q["h"] + 0.8, "white", 0.6))
            if base == 0.0:
                parts.append(kit.band(r, 0, 18, "white", 2.5))
            base = q["h"]
    for q in site["prisms"]:
        r = ccw(q["ring"])
        if q["min_h"] > 60:                                                      # the sky bridge and its cantilever
            parts.append(kit.solid(r, q["min_h"], q["h"], "glass", "white", bottom="white"))
            parts.append(kit.band(r, q["min_h"] - 0.6, q["min_h"] + 0.5, "glow", 0.4))
        elif q["min_h"] == 0 and q["area"] < 300 and q["h"] >= 150:              # the stepped crown beside the bridge
            parts.append(kit.solid(r, 214.0, q["h"], "glass", "white"))
        elif q["h"] < 60 and q["min_h"] == 0:                                    # podium under the towers
            parts.append(kit.solid(r, 0, q["h"], "concrete", "roof"))
    return kit.join(parts, site["model"]), {"name": site["name"], **site["facts"], "source": site["source"]}


# ---------------------------------------------------------------- Address Downtown
def address_downtown(kit, site):
    """Address Downtown: its mapped footprint stepped back in tiers towards one end, to a lit crown and a spire at the
    mapped height. The tiers are an approximation of the tower's stepped silhouette."""
    h = kit.h
    q = max(site["prisms"], key=lambda q_: q_["h"])
    r, top = ccw(q["ring"]), q["h"]
    (ux, uy), half = principal(r)
    c = centroid(r)
    pivot = (c[0] + ux * half * 0.28, c[1] + uy * half * 0.28)
    parts = [kit.band(r, 0, 15, "concrete", 3.0)]
    tiers = [(0.0, 0.50, 1.0), (0.50, 0.68, 0.84), (0.68, 0.82, 0.66), (0.82, 0.91, 0.48)]
    for a, b, k in tiers:
        ring = scaled(r, k, pivot)
        parts.append(kit.solid(ring, a * top, b * top, "glass", "steel"))
        parts.append(kit.band(ring, b * top - 1.5, b * top + 1.2, "white", 0.5))
        z = a * top + 28.8
        while z < b * top - 6:
            parts.append(kit.band(ring, z, z + 1.1, "white", 0.3))
            z += 28.8
    crown = scaled(r, 0.34, pivot)
    parts.append(kit.solid(crown, 0.91 * top, 0.955 * top, "glow", "steel"))                     # the lit crown
    parts.append(h.cyl(2.4, 0.3, top * 0.045 + 6, (pivot[0], pivot[1], top * 0.955 + (top * 0.045 + 6) / 2 - 6), "steel", 8))
    for p in site["prisms"]:
        if p is not q and p["h"] < 60 and p["min_h"] == 0:
            parts.append(kit.solid(ccw(p["ring"]), 0, p["h"], "concrete", "roof"))
    return kit.join(parts, site["model"]), {"name": site["name"], "height_m": top, **site["facts"], "source": site["source"]}


# ---------------------------------------------------------------- Coca-Cola Arena
def coca_cola_arena(kit, site):
    """Coca-Cola Arena at City Walk: its mapped oval, dark panelled walls wrapped in bands of light (the real façade
    is a skin of LED strips that changes colour), and a stepped roof. No name, logo or sign is drawn."""
    h = kit.h
    q = max(site["prisms"], key=lambda q_: q_["area"])
    r, H = ccw(q["ring"]), max(q["h"], 20.0)
    parts = [kit.solid(r, 0, H, "dark", "roof"), kit.band(r, 0, 5.0, "glass", 0.6)]               # concourse glazing at the foot
    for z in (7.5, 11.0, 14.5, 18.0):
        parts.append(kit.band(r, z, z + 0.9, "led", 0.5))
    parts.append(kit.band(r, H - 0.5, H + 1.0, "dark", 0.9))
    r2, r3 = clean(offset(simplify(r, 2.0), -9.0)), clean(offset(simplify(r, 2.0), -24.0))
    parts.append(kit.solid(r2, H, H + 4.5, "dark", "roof"))
    parts.append(kit.band(r2, H + 3.6, H + 4.6, "led", 0.4))
    parts.append(kit.solid(r3, H + 4.5, H + 7.5, "white", "roof"))
    for p in site["prisms"]:
        if p is not q and p["min_h"] == 0:
            parts.append(kit.solid(ccw(p["ring"]), 0, p["h"], "concrete", "roof"))
    return kit.join(parts, site["model"]), {"name": site["name"], "height_m": H + 7.5, **site["facts"], "source": site["source"]}


# ---------------------------------------------------------------- Burj Al Arab
def burj_al_arab(kit, site):
    """Burj Al Arab on its island, about 280 m off the beach: a V-shaped plan with the mast at the sea end, the white
    fabric wall bowed towards the shore between the two wings, the steel bows up each side to the mast, the helipad
    and the restaurant pod near the top, and the causeway to the shore. 321 m to the top of the mast (public figure);
    every other dimension is an approximation from photographs. Built at the island's place in the scene frame."""
    h = kit.h
    ox, oy = site["centre"][0], -site["centre"][1]
    TOP, BODY, BACK = site["facts"]["height_m"], 205.0, -34.0
    parts = []

    def section(z):
        g = math.sqrt(max(0.0, 1 - (z / BODY) ** 2))
        g = max(g, 0.06)
        w, yw, yf = 44.0 * g, BACK + 60.0 * g, BACK + 82.0 * g ** 0.9
        front = [(w * math.cos(t), yw + (yf - yw) * math.sin(t)) for t in (math.pi * k / 8 for k in range(9))]      # right tip → front → left tip
        return [(0.0, BACK)] + front
    zs = [0.0, 6.0] + [BODY * math.sin(math.radians(a)) for a in range(8, 88, 6)]
    secs = [(z, [(ox + x, oy + y) for x, y in section(z)]) for z in zs]
    n = len(secs[0][1])
    slots = ["glass"] + ["sail"] * (n - 2) + ["glass"]                            # apex→right tip, the sail, left tip→apex
    parts.append(kit.loft(secs, slots, "white"))
    for sgn in (1, -1):                                                           # the steel bows and their braces
        pts = []
        for z in zs[1:]:
            g = max(0.06, math.sqrt(max(0.0, 1 - (z / BODY) ** 2)))
            pts.append((ox + sgn * (44.0 * g + 2.6), oy + BACK + 60.0 * g, z))
        pts.append((ox, oy + BACK, 262.0))
        for a, b in zip(pts, pts[1:]):
            parts.append(h.beam(a, b, 3.4, 3.4, "white"))
        for i in (2, 6, 10):
            if i + 3 < len(pts) and not kit.lite:
                parts.append(h.beam((ox, oy + BACK - 1.0, zs[1 + i]), pts[i + 3], 2.0, 2.0, "white"))
                parts.append(h.beam((ox, oy + BACK - 1.0, zs[1 + i + 3]), pts[i], 2.0, 2.0, "white"))
    parts.append(h.cyl(3.6, 2.4, 262.0, (ox, oy + BACK - 1.5, 131.0), "white", 10))                    # the mast up the back
    parts.append(h.cyl(2.4, 0.5, TOP - 262.0, (ox, oy + BACK - 1.5, 262.0 + (TOP - 262.0) / 2), "white", 8))
    parts.append(h.box((56.0, 10.0, 7.0), (ox, oy + BACK - 7.5, 198.0), "glass"))                       # restaurant pod over the sea
    parts.append(h.box((60.0, 11.0, 1.2), (ox, oy + BACK - 7.5, 202.1), "white"))
    pad = (ox - 9.0, oy + BACK + 44.0, 210.0)                                                           # helipad towards the shore
    parts.append(h.cyl(12.0, 12.0, 1.4, pad, "white", 20))
    parts.append(h.cyl(10.4, 10.4, 0.3, (pad[0], pad[1], pad[2] + 0.85), "green", 20))
    for dx in (-6.0, 6.0):
        parts.append(h.beam((ox + dx, oy + BACK + 12.0, 192.0), (pad[0] + dx * 0.6, pad[1], pad[2] - 0.7), 1.6, 1.6, "white"))
    # the island and the causeway to the shore (+y in Blender = towards the beach)
    island = [(ox + 78 * math.cos(a) * (1.0 + 0.16 * math.cos(3 * a + 0.5)), oy + 4 + 70 * math.sin(a) * (1.0 + 0.1 * math.cos(2 * a))) for a in (2 * math.pi * k / 28 for k in range(28))]
    parts.append(kit.solid(island, -2.0, 3.0, "stone", "stone"))
    parts.append(kit.solid(offset(island, -9.0), 3.0, 3.6, "green", "green"))
    parts.append(kit.solid([(ox + x, oy + y) for x, y in section(0.0)[::1]] and offset([(ox + x, oy + y) for x, y in section(0.0)], 5.0), 3.0, 9.0, "white", "white"))
    path = [(ox + 10 * math.sin(t * math.pi), oy + 66 + t * 300, 3.4) for t in (k / 10 for k in range(11))]
    for a, b in zip(path, path[1:]):
        parts.append(h.beam(a, b, 11.0, 1.4, "concrete"))
    for a in ([] if kit.lite else path[1:-1:2]):
        parts.append(h.cyl(1.6, 1.6, 6.0, (a[0], a[1], 0.4), "concrete", 8))
    return kit.join(parts, site["model"]), {"name": site["name"], **site["facts"], "source": site["source"],
                                          "note": "placed on the island seen in the satellite overview; proportions from photographs"}


BUILDERS = {"one_zaabeel": one_zaabeel, "address_sky_view": address_sky_view, "address_downtown": address_downtown,
            "coca_cola_arena": coca_cola_arena, "burj_al_arab": burj_al_arab}


def lite_site(site):
    return {**site, "model": site["model"] + "_lod1"}


def models(h):
    """(build, args, triangle budget, far-version build) entries for build_models.py's MODELS list."""
    kit, far = Kit(h), Kit(h, lite=True)
    try:
        with open(SITES2, encoding="utf-8") as f:
            sites = json.load(f)["sites"]
    except OSError:
        return []
    return [((lambda s_=s_: BUILDERS[s_["model"]](kit, s_)), (), 30000, (lambda s_=s_: BUILDERS[s_["model"]](far, lite_site(s_))[0]))
            for s_ in sites if s_["model"] in BUILDERS]
