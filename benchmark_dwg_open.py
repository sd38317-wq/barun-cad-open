"""Repeatable, local-only benchmark for the Barun CAD DWG import pipeline."""
from __future__ import annotations

from pathlib import Path
import argparse
import gc
import gzip
import hashlib
import json
import os
import platform
import statistics
import time

import exchange
import server


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def representative_files(root: Path, limit: int) -> list[Path]:
    files = sorted(root.glob("*.dwg"), key=lambda item: (item.stat().st_size, item.name))
    if len(files) <= limit:
        return files
    if limit == 1:
        return [files[len(files) // 2]]
    indexes = [round(index * (len(files) - 1) / (limit - 1)) for index in range(limit)]
    return [files[index] for index in indexes]


def benchmark_one(path: Path, route: str, repetition: int) -> dict:
    source_hash = sha256(path)
    started = time.perf_counter()
    try:
        result = exchange.import_file_path(path, ".dwg")
        imported_at = time.perf_counter()
        encoded = server.json_bytes(result, compact=True)
        serialized_at = time.perf_counter()
        compressed = gzip.compress(encoded, compresslevel=1)
        finished = time.perf_counter()
        report = result["report"]
        status = "completed"
        error = None
        record = {
            "entity_count": report.get("imported"),
            "skipped": report.get("skipped"),
            "converted": report.get("converted"),
            "warning_count": len(report.get("warnings") or []),
            "engine": report.get("converterDetails"),
            "timings_ms": {
                **(report.get("timings_ms") or {}),
                "import_wall": round((imported_at - started) * 1000, 3),
                "serialize": round((serialized_at - imported_at) * 1000, 3),
                "gzip": round((finished - serialized_at) * 1000, 3),
                "backend_total": round((finished - started) * 1000, 3),
            },
            "json_bytes": len(encoded),
            "gzip_bytes": len(compressed),
        }
    except Exception as exc:
        finished = time.perf_counter()
        status = "failed"
        error = f"{type(exc).__name__}: {exc}"
        record = {"timings_ms": {"backend_total": round((finished - started) * 1000, 3)}}
    unchanged = sha256(path) == source_hash
    return {
        "file": path.name,
        "bytes": path.stat().st_size,
        "source_sha256": source_hash,
        "source_unchanged": unchanged,
        "route": route,
        "repetition": repetition,
        "status": status,
        "error": error,
        **record,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("reports/dxf-dwg-roundtrip-20260914-141211/dwg"))
    parser.add_argument("--route", choices=("legacy", "deferred"), required=True)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--runtime", type=Path)
    parser.add_argument("--engine-version", default="ACadSharp 3.8.0")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit(f"refusing to overwrite existing result: {args.output}")
    files = representative_files(args.root, args.limit)
    if not files:
        raise SystemExit("no DWG files found")
    os.environ["BARUN_DWG_IMPORT_ROUTE"] = args.route
    os.environ["BARUN_DWG_ENGINE_VERSION"] = args.engine_version
    if args.runtime:
        os.environ["BARUN_DWG_RUNTIME"] = str(args.runtime.resolve())
    records = []
    for repetition in range(1, args.repeat + 1):
        for index, path in enumerate(files, 1):
            print(f"[{repetition}/{args.repeat} {index}/{len(files)}] {args.route}: {path.name}", flush=True)
            records.append(benchmark_one(path, args.route, repetition))
            gc.collect()
    completed = [item for item in records if item["status"] == "completed"]
    totals = [item["timings_ms"]["backend_total"] for item in completed]
    payload = {
        "schema_version": 1,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "environment": {
            "os": platform.platform(),
            "python": platform.python_version(),
            "machine": platform.machine(),
            "os_file_cache": "UNCONTROLLED",
            "app_cache": "BYPASSED_DIRECT_PIPELINE",
        },
        "route": args.route,
        "engine_version": args.engine_version,
        "runtime": str(args.runtime.resolve()) if args.runtime else "bundled",
        "repeat": args.repeat,
        "sample_count": len(files),
        "completed": len(completed),
        "failed": len(records) - len(completed),
        "backend_total_median_ms": round(statistics.median(totals), 3) if totals else None,
        "records": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: payload[key] for key in ("route", "sample_count", "completed", "failed", "backend_total_median_ms")}, ensure_ascii=False))
    return 0 if len(completed) == len(records) and all(item["source_unchanged"] for item in records) else 1


if __name__ == "__main__":
    raise SystemExit(main())
