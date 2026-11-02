"""Create deterministic per-file and aggregate reports from two raw benchmark logs."""
from pathlib import Path
import argparse
import csv
import json
import statistics


def grouped(payload):
    values = {}
    for record in payload["records"]:
        values.setdefault(record["file"], []).append(record)
    return values


def median(records, key):
    values = [item["timings_ms"][key] for item in records if item["status"] == "completed" and key in item["timings_ms"]]
    return statistics.median(values) if values else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
    candidate = json.loads(args.candidate.read_text(encoding="utf-8"))
    before, after = grouped(baseline), grouped(candidate)
    rows = []
    for name in sorted(before):
        old, new = median(before[name], "backend_total"), median(after[name], "backend_total")
        improvement = (old - new) / old * 100 if old else None
        stable = all(
            (left.get("entity_count"), left.get("skipped"), left.get("converted"), left.get("source_sha256"))
            == (right.get("entity_count"), right.get("skipped"), right.get("converted"), right.get("source_sha256"))
            for left, right in zip(before[name], after[name])
        )
        rows.append({
            "file": name,
            "bytes": before[name][0]["bytes"],
            "baseline_median_ms": round(old, 3),
            "candidate_median_ms": round(new, 3),
            "improvement_percent": round(improvement, 3),
            "entity_count": after[name][0].get("entity_count"),
            "result_equivalent": stable,
            "source_unchanged": all(item["source_unchanged"] for item in before[name] + after[name]),
        })
    stage_keys = sorted(set.intersection(*[
        {key for item in payload["records"] for key in item.get("timings_ms", {})}
        for payload in (baseline, candidate)
    ]))
    stage_medians = {
        key: {
            "baseline_ms": round(statistics.median(item["timings_ms"][key] for item in baseline["records"] if item["status"] == "completed" and key in item["timings_ms"]), 3),
            "candidate_ms": round(statistics.median(item["timings_ms"][key] for item in candidate["records"] if item["status"] == "completed" and key in item["timings_ms"]), 3),
        }
        for key in stage_keys
    }
    improvements = [row["improvement_percent"] for row in rows]
    summary = {
        "baseline": str(args.baseline),
        "candidate": str(args.candidate),
        "sample_files": len(rows),
        "runs_per_route": len(baseline["records"]),
        "baseline_completed": baseline["completed"],
        "candidate_completed": candidate["completed"],
        "file_median_improvement_percent": round(statistics.median(improvements), 3),
        "minimum_file_improvement_percent": round(min(improvements), 3),
        "maximum_file_improvement_percent": round(max(improvements), 3),
        "material_regressions": [row for row in rows if row["candidate_median_ms"] - row["baseline_median_ms"] > 500 and row["improvement_percent"] < -10],
        "result_mismatches": [row["file"] for row in rows if not row["result_equivalent"]],
        "source_hash_changes": [row["file"] for row in rows if not row["source_unchanged"]],
        "stage_medians": stage_medians,
        "files": rows,
    }
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "comparison-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    with (args.output / "comparison-by-file.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=rows[0].keys())
        writer.writeheader(); writer.writerows(rows)
    print(json.dumps({key: summary[key] for key in ("sample_files", "runs_per_route", "file_median_improvement_percent", "result_mismatches", "source_hash_changes")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
