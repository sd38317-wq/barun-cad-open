"""Compare legacy and optimized DWG imports without relying only on object counts."""
from pathlib import Path
from collections import Counter
import argparse
import hashlib
import json
import os

import exchange
from benchmark_dwg_open import representative_files, sha256


def canonical_document(document):
    layer_names = {item["id"]: item["name"] for item in document.get("layers", [])}

    def clean(value, key=None):
        if isinstance(value, dict):
            return {
                item_key: clean(item_value, item_key)
                for item_key, item_value in sorted(value.items())
                if item_key not in ("id", "sourceFingerprint", "dxfPreservation")
            }
        if isinstance(value, list):
            return [clean(item) for item in value]
        if key == "layer":
            return layer_names.get(value, value)
        return value

    cleaned = clean(document)
    cleaned["layers"] = sorted((clean(layer) for layer in document.get("layers", [])), key=lambda layer: layer.get("name", ""))
    return cleaned


def semantic_summary(document):
    def walk(items):
        for item in items:
            yield item
            yield from walk(item.get("entities") or [])
    entities = list(walk(document.get("entities") or []))
    shared = document.get("sharedBlocks") or {}
    for definition in shared.values():
        entities.extend(walk(definition.get("entities") or []))
    texts = [item.get("text", "") for item in entities if item.get("type") in ("text", "mtext")]
    dimensions = [item for item in entities if str(item.get("type", "")).startswith("dimension")]
    return {
        "types": dict(sorted(Counter(item.get("type", "UNKNOWN") for item in entities).items())),
        "text_count": len(texts),
        "text_sha256": hashlib.sha256(json.dumps(texts, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest(),
        "dimension_count": len(dimensions),
        "block_reference_count": sum(1 for item in entities if item.get("type") == "block"),
        "shared_block_definition_count": len(shared),
        "hatch_count": sum(1 for item in entities if item.get("type") == "hatch"),
        "layer_names": sorted(layer["name"] for layer in document.get("layers", [])),
    }


def import_route(path, route):
    os.environ["BARUN_DWG_IMPORT_ROUTE"] = route
    result = exchange.import_file_path(path, ".dwg")
    canonical = canonical_document(result["document"])
    payload = json.dumps(canonical, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode()
    exported, warnings = exchange.export_dxf(result["document"])
    return {
        "canonical_sha256": hashlib.sha256(payload).hexdigest(),
        "semantic": semantic_summary(result["document"]),
        "report": {
            "imported": result["report"]["imported"],
            "skipped": result["report"]["skipped"],
            "converted": result["report"]["converted"],
            "layoutsPreserved": result["report"]["layoutsPreserved"],
        },
        "export_dxf_bytes": len(exported),
        "export_warning_count": len(warnings),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("reports/dxf-dwg-roundtrip-20260914-141211/dwg"))
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit(f"refusing to overwrite {args.output}")
    records = []
    for index, path in enumerate(representative_files(args.root, args.limit), 1):
        print(f"[{index}/{args.limit}] {path.name}", flush=True)
        source = sha256(path)
        try:
            legacy = import_route(path, "legacy")
            candidate = import_route(path, "deferred")
            equivalent = (
                legacy["canonical_sha256"] == candidate["canonical_sha256"]
                and legacy["semantic"] == candidate["semantic"]
                and legacy["report"] == candidate["report"]
            )
            error = None
        except Exception as exc:
            legacy = candidate = None
            equivalent = False
            error = f"{type(exc).__name__}: {exc}"
        records.append({
            "file": path.name,
            "bytes": path.stat().st_size,
            "source_sha256": source,
            "source_unchanged": sha256(path) == source,
            "equivalent": equivalent,
            "error": error,
            "legacy": legacy,
            "candidate": candidate,
        })
    payload = {
        "sample_count": len(records),
        "equivalent_count": sum(item["equivalent"] for item in records),
        "failed_or_different": [item["file"] for item in records if not item["equivalent"]],
        "source_hash_changes": [item["file"] for item in records if not item["source_unchanged"]],
        "independent_cad_reopen": "NOT_TESTED",
        "records": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: payload[key] for key in ("sample_count", "equivalent_count", "failed_or_different", "source_hash_changes")}, ensure_ascii=False))
    return 0 if payload["equivalent_count"] == payload["sample_count"] and not payload["source_hash_changes"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
