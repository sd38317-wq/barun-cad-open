"""Measure cold and warm desktop import cache with response decompression/JSON parsing."""
from pathlib import Path
import argparse
import gzip
import json
import statistics
import tempfile
import time

import server
from benchmark_dwg_open import representative_files, sha256


def timed_open(path):
    started = time.perf_counter()
    body, hit = server.cached_import_path_body(path, ".dwg")
    backend = time.perf_counter()
    result = json.loads(gzip.decompress(body))
    finished = time.perf_counter()
    return {
        "cache_hit": hit,
        "backend_ms": round((backend - started) * 1000, 3),
        "client_decompress_parse_ms": round((finished - backend) * 1000, 3),
        "total_ms": round((finished - started) * 1000, 3),
        "entity_count": result["report"]["imported"],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("reports/dxf-dwg-roundtrip-20260914-141211/dwg"))
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--warm-repeat", type=int, default=5)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit(f"refusing to overwrite {args.output}")
    records = []
    with tempfile.TemporaryDirectory(prefix="barun_cache_benchmark_") as folder:
        cache = Path(folder)
        original = server.import_cache_dir
        server.import_cache_dir = lambda: cache
        try:
            for index, path in enumerate(representative_files(args.root, args.limit), 1):
                print(f"[{index}/{args.limit}] {path.name}", flush=True)
                source_hash = sha256(path)
                cold = timed_open(path)
                warm = [timed_open(path) for _ in range(args.warm_repeat)]
                records.append({
                    "file": path.name,
                    "bytes": path.stat().st_size,
                    "source_sha256": source_hash,
                    "source_unchanged": sha256(path) == source_hash,
                    "cold": cold,
                    "warm": warm,
                    "cold_ms": cold["total_ms"],
                    "warm_median_ms": round(statistics.median(item["total_ms"] for item in warm), 3),
                    "improvement_percent": round((cold["total_ms"] - statistics.median(item["total_ms"] for item in warm)) / cold["total_ms"] * 100, 3),
                })
        finally:
            server.import_cache_dir = original
    payload = {
        "sample_count": len(records),
        "warm_repeat": args.warm_repeat,
        "cold_success": sum(not item["cold"]["cache_hit"] for item in records),
        "warm_hit_count": sum(item["cache_hit"] for record in records for item in record["warm"]),
        "file_median_warm_improvement_percent": round(statistics.median(item["improvement_percent"] for item in records), 3),
        "source_hash_changes": [item["file"] for item in records if not item["source_unchanged"]],
        "records": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: payload[key] for key in ("sample_count", "cold_success", "warm_hit_count", "file_median_warm_improvement_percent", "source_hash_changes")}, ensure_ascii=False))
    return 0 if payload["cold_success"] == len(records) and payload["warm_hit_count"] == len(records) * args.warm_repeat and not payload["source_hash_changes"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
