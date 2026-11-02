"""Compare recovered DXFs: a=acadrust, b=ACadSharp; no rendering equivalence claim.

Numeric tolerance is 1e-6 relative; discrete integers compare exactly.
Counts are differing fields (including individual vertices), not unique entities.
Handle matches take priority; remaining entities pair in order within their owner.
Only the requested properties and common geometry are checked, not all DXF data.
"""

import argparse
from collections import Counter, defaultdict
import json
import math
from pathlib import Path
import re
import subprocess
import tempfile

from ezdxf import recover

ROOT = Path(__file__).resolve().parent
ACADRUST = ROOT / "converter-rs/target/release/barun-dwg2dxf.exe"
ACADSHARP = ROOT / "dwg-runtime/BarunConverter.exe"
TOL = 1e-6
LIMIT = 20


def plain(value):
    if isinstance(value, dict):
        return {str(k): plain(v) for k, v in value.items()}
    if isinstance(value, (str, int, bool)) or value is None:
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    return [plain(v) for v in value]


def text_flags(value):
    return {"replacement_character": "\ufffd" in value,
            "question_runs": re.findall(r"\?+", value)}


def kind(entity):
    t = entity.dxftype()
    return "POLYLINE_2D" if t == "LWPOLYLINE" or (
        t == "POLYLINE" and entity.is_2d_polyline) else t


def fields(e):
    """Map property names to (mismatch category, JSON-compatible value)."""
    d, t = e.dxf, e.dxftype()
    out = {"dxftype": ("type", kind(e))}

    def put(category, name, value):
        out[name] = (category, plain(value))

    for name, default in (("layer", "0"), ("color", 256),
                          ("true_color", None), ("linetype", "BYLAYER"),
                          ("lineweight", -1)):
        put("appearance", name, d.get(name, default))
    geometry = ("start end center radius start_angle end_angle major_axis ratio "
                "start_param end_param insert location vtx0 vtx1 vtx2 vtx3 "
                "extrusion thickness defpoint defpoint2 defpoint3 defpoint4 "
                "defpoint5 text_midpoint angle horizontal_direction").split()
    for name in geometry:
        if d.is_supported(name):
            put("geometry", name, getattr(d, name))
    if kind(e) == "POLYLINE_2D":
        if t == "LWPOLYLINE":
            width, z = d.const_width, d.elevation
            vertices = [(x, y, z, s, w, b) for x, y, s, w, b in e.get_points()]
        else:
            s, w = d.default_start_width, d.default_end_width
            width = s if s == w else 0.0
            z = d.elevation.z
            vertices = [(v.dxf.location.x, v.dxf.location.y, z,
                         v.dxf.get("start_width", 0.0 if width else s),
                         v.dxf.get("end_width", 0.0 if width else w),
                         v.dxf.get("bulge", 0.0)) for v in e.vertices]
        put("polyline", "const_width", width)
        put("polyline", "closed", bool(e.closed if t == "LWPOLYLINE" else e.is_closed))
        put("polyline", "vertices", [dict(point=v[:3], start_width=v[3],
                                          end_width=v[4], bulge=v[5],
                                          effective_start_width=(width or v[3]) if t == "LWPOLYLINE"
                                          else e.vertices[i].dxf.get("start_width", s),
                                          effective_end_width=(width or v[4]) if t == "LWPOLYLINE"
                                          else e.vertices[i].dxf.get("end_width", w))
                                     for i, v in enumerate(vertices)])
    elif t == "POLYLINE":
        put("geometry", "vertices", [v.dxf.location for v in e.vertices])
        for name in ("flags", "m_count", "n_count"):
            put("geometry", name, getattr(d, name))
    if t == "SPLINE":
        for name in ("degree", "flags", "start_tangent", "end_tangent"):
            put("spline", name, getattr(d, name))
        for name in ("control_points", "fit_points", "knots", "weights"):
            put("spline", name, getattr(e, name))
    if t in ("TEXT", "MTEXT", "ATTRIB", "ATTDEF"):
        put("text", "text", e.text if t == "MTEXT" else d.text)
        put("text", "height", d.char_height if t == "MTEXT" else d.height)
        put("text", "style", d.style)
        put("text", "rotation", e.get_rotation() % 360 if t == "MTEXT" else d.rotation % 360)
        if t == "MTEXT":
            # MTEXT width is its column width; inline width factors remain in text.
            put("text", "column_width", d.width)
        else:
            for name in ("width", "halign", "valign", "oblique", "text_generation_flag"):
                put("text", name, getattr(d, name))
            if d.halign or d.valign:
                put("geometry", "align_point", d.get("align_point", d.insert))
        if t in ("ATTRIB", "ATTDEF"):
            put("text", "tag", d.tag)
    if t == "INSERT":
        for name in ("name", "xscale", "yscale", "zscale", "rotation",
                     "row_count", "column_count", "row_spacing", "column_spacing"):
            put("insert", name, getattr(d, name))
    if t == "HATCH":
        for name in ("pattern_name", "solid_fill", "pattern_angle", "pattern_scale"):
            put("hatch", name, getattr(d, name))
        put("hatch", "loop_count", len(e.paths))
        put("geometry", "elevation", d.elevation)
    if t == "DIMENSION":
        put("dimension", "block_name", d.get("geometry", ""))
        put("dimension", "measurement", d.actual_measurement
            if d.get("actual_measurement") is not None else e.get_measurement())
        put("dimension", "dimtype", e.dimtype)
        put("dimension", "dimstyle", d.dimstyle)
    if t in ("LEADER", "MESH"):
        put("geometry", "vertices", e.vertices)
    return out


def pairs(a, b, key, fallback=False):
    """Reserve all exact keys before pairing remaining items by owner order."""
    indexed = {key(e): i for i, e in enumerate(b) if key(e)}
    used, pending = set(), []
    for e in a:
        i = indexed.get(key(e)) if key(e) else None
        if i is not None and i not in used:
            used.add(i)
            yield e, b[i], "handle"
        else:
            pending.append(e)
    remaining = [e for i, e in enumerate(b) if i not in used]
    n = min(len(pending), len(remaining)) if fallback else 0
    for x, y in zip(pending[:n], remaining[:n]):
        yield x, y, "order"
    for x in pending[n:]:
        yield x, None, "only_a"
    for y in remaining[n:]:
        yield None, y, "only_b"


def compare(a_dxf, b_dxf):
    """Return counts and at most 20 examples/category; strings compare exactly."""
    docs, audits = zip(*(recover.readfile(str(p)) for p in (a_dxf, b_dxf)))
    counts, examples, matching = Counter(), defaultdict(list), Counter()
    field_counts = defaultdict(Counter)
    only = {"a": Counter(), "b": Counter()}

    def diff(category, handle, field, a, b, owner):
        a, b = plain(a), plain(b)
        if isinstance(a, dict) and isinstance(b, dict):
            for k in sorted(a.keys() | b.keys()):
                diff(category, handle, field + "." + k, a.get(k), b.get(k), owner)
            return
        if isinstance(a, list) and isinstance(b, list):
            if len(a) != len(b):
                diff(category, handle, field + ".count", len(a), len(b), owner)
            for i, (x, y) in enumerate(zip(a, b)):
                diff(category, handle, f"{field}[{i}]", x, y, owner)
            return
        numeric = (isinstance(a, (int, float)) and isinstance(b, (int, float))
                   and (isinstance(a, float) or isinstance(b, float)))
        if (math.isclose(a, b, rel_tol=TOL, abs_tol=0.0) if numeric else a == b):
            return
        counts[category] += 1
        field_counts[category][re.sub(r"\[\d+\]", "[]", field)] += 1
        if len(examples[category]) < LIMIT:
            item = dict(handle=handle, owner=owner, field=field, a=a, b=b)
            if isinstance(a, str) or isinstance(b, str):
                item["text_flags"] = {s: text_flags(v) for s, v in (("a", a), ("b", b))
                                      if isinstance(v, str)}
            examples[category].append(item)

    def missing(e, side, owner):
        only[side][e.dxftype()] += 1
        diff("entities_only_" + side, e.dxf.handle, "dxftype",
             e.dxftype() if side == "a" else None,
             e.dxftype() if side == "b" else None, owner)
        if e.dxftype() == "INSERT":
            for attr in e.attribs:
                missing(attr, side, owner + "/INSERT:" + str(e.dxf.handle))

    def entities(a, b, owner):
        for x, y, method in pairs(list(a), list(b), lambda e: e.dxf.handle, True):
            if x is None or y is None:
                missing(x if x is not None else y, "a" if y is None else "b", owner)
                continue
            matching[method] += 1
            handle = x.dxf.handle
            if method == "order":
                matching["order_different_handles"] += int(handle != y.dxf.handle)
            xf, yf = fields(x), fields(y)
            for name in sorted(xf.keys() | yf.keys()):
                category = xf.get(name, yf.get(name))[0]
                diff(category, handle, name, xf.get(name, (None, None))[1],
                     yf.get(name, (None, None))[1], owner)
            if x.dxftype() == y.dxftype() == "INSERT":
                entities(x.attribs, y.attribs, owner + "/INSERT:" + str(handle))
            else:
                for entity, side in ((x, "a"), (y, "b")):
                    if entity.dxftype() == "INSERT":
                        for attr in entity.attribs:
                            missing(attr, side, owner + "/INSERT:" + str(entity.dxf.handle))

    def table(collections, category, properties):
        tables = [{e.dxf.name: e for e in c} for c in collections]
        for name in sorted(tables[0].keys() | tables[1].keys()):
            x, y = (t.get(name) for t in tables)
            handle = (x if x is not None else y).dxf.handle
            if x is None or y is None:
                diff(category, handle, "name", name if x is not None else None,
                     name if y is not None else None, category)
            else:
                for field, getter in properties.items():
                    diff(category, handle, field, getter(x), getter(y), name)

    table([d.layers for d in docs], "layers", {
        "color": lambda e: abs(e.dxf.color), "true_color": lambda e: e.dxf.get("true_color"),
        "linetype": lambda e: e.dxf.linetype, "on": lambda e: e.is_on(),
        "frozen": lambda e: e.is_frozen()})
    table([d.styles for d in docs], "styles", {
        name: lambda e, n=name: getattr(e.dxf, n) for name in ("font", "bigfont", "width")})
    blocks = [{b.name: b for b in d.blocks if not b.is_any_layout} for d in docs]
    refs = [Counter(e.dxf.name.casefold() for b in d.blocks for e in b if e.dxftype() == "INSERT")
            for d in docs]
    block_only = {"a": [], "b": []}
    for name in sorted(blocks[0].keys() | blocks[1].keys()):
        x, y = (t.get(name) for t in blocks)
        if x is None or y is None:
            side = "a" if y is None else "b"
            block_only[side].append(dict(name=name, entity_count=len(x if x is not None else y),
                                        inserts_a=refs[0][name.casefold()], inserts_b=refs[1][name.casefold()]))
            diff("blocks", (x if x is not None else y).block_record_handle, "name",
                 name if x is not None else None, name if y is not None else None, "blocks")
        else:
            diff("blocks", x.block_record_handle, "entity_count", len(x), len(y), name)
            diff("blocks", x.block_record_handle, "base_point",
                 x.block.dxf.base_point, y.block.dxf.base_point, name)
    # Every layout also appears in doc.blocks; compare it exactly once.
    scopes = [list(d.blocks) for d in docs]
    by_handle = list(pairs(*scopes, lambda b: b.block_record_handle))
    matched = [(a, b) for a, b, _ in by_handle if a is not None and b is not None]
    left = [[a for a, b, _ in by_handle if a is not None and b is None],
            [b for a, b, _ in by_handle if a is None and b is not None]]
    named = list(pairs(*left, lambda b: b.name))
    matched.extend((a, b) for a, b, _ in named if a is not None and b is not None)
    for a, b in matched:
        owner = ("layout:" if a.is_any_layout else "block:") + a.name
        entities(a, b, owner)
    for a, b, _ in named:
        if a is None or b is None:
            block = a if a is not None else b
            if block.is_any_layout:
                diff("layouts", block.block_record_handle, "presence",
                     block.name if a is not None else None,
                     block.name if b is not None else None, "layouts")
            for e in block:
                missing(e, "a" if b is None else "b", "block:" + block.name)
    # Layout names can differ even when the underlying block names match.
    layouts = [{l.block_record_handle: l.name for l in d.layouts} for d in docs]
    for a, b in matched:
        if a.is_any_layout or b.is_any_layout:
            diff("layouts", a.block_record_handle, "name",
                 layouts[0].get(a.block_record_handle), layouts[1].get(b.block_record_handle), a.name)
    return dict(a=str(a_dxf), b=str(b_dxf), equal=not counts,
                tolerance=dict(relative=TOL, absolute=0.0), matching=dict(matching),
                counts=dict(sorted(counts.items())), field_counts=dict(field_counts), examples=dict(examples),
                entities_only={s: dict(c) for s, c in only.items()}, blocks_only=block_only,
                inventory={s: dict(Counter(e.dxftype() for block in d.blocks for e in block))
                           for s, d in zip(("a", "b"), docs)},
                recovery={s: dict(errors=len(a.errors), fixes=len(a.fixes))
                          for s, a in zip(("a", "b"), audits)})


def conversion_command(engine, dwg, target):
    """현재 worktree의 두 엔진을 각자 정해진 인자로 실행한다."""
    if engine == "acadsharp":
        return [str(ACADSHARP), str(dwg), str(target), "2018", "--defer-verify"]
    if engine == "acadrust":
        return [str(ACADRUST), "-v0", "--as", "r2018", "-o", str(target), str(dwg)]
    raise ValueError("알 수 없는 변환 엔진: " + engine)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dwg", nargs="+", required=True, type=Path)
    parser.add_argument("--json", type=Path, default=Path("compare_dxf_by_handle.json"))
    args = parser.parse_args()
    results = []
    with tempfile.TemporaryDirectory(prefix="compare-dxf-") as tmp:
        for i, dwg in enumerate(args.dwg):
            row = dict(dwg=str(dwg.resolve()), converters={})
            paths = []
            try:
                for label in ("acadrust", "acadsharp"):
                    cwd = Path(tmp) / f"{i}-{label}"
                    cwd.mkdir()
                    target = cwd / "out.dxf"
                    command = conversion_command(label, dwg.resolve(), target)
                    proc = subprocess.run(command, cwd=cwd, capture_output=True, timeout=180)
                    row["converters"][label] = dict(returncode=proc.returncode,
                        stdout=proc.stdout.decode("utf-8", "backslashreplace"),
                        stderr=proc.stderr.decode("utf-8", "backslashreplace"))
                    if proc.returncode or not target.is_file():
                        raise RuntimeError(f"{label}: conversion failed (exit {proc.returncode})")
                    paths.append(target)
                row["comparison"] = compare(*paths)
            except Exception as exc:
                row["error"] = str(exc)
            results.append(row)
    # UTF-8 details never go to a cp949 console; summaries are ASCII escaped.
    args.json.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n",
                         encoding="utf-8", newline="\n")
    for row in results:
        result = row.get("comparison", {})
        print(json.dumps(dict(dwg=row["dwg"], error=row.get("error"),
                              equal=result.get("equal"), counts=result.get("counts")), ensure_ascii=True))
    print("Details: " + ascii(str(args.json.resolve())))
    return 2 if any("error" in r for r in results) else int(any(not r["comparison"]["equal"] for r in results))


if __name__ == "__main__":
    raise SystemExit(main())
