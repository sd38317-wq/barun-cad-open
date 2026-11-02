"""Round-trip the 182 accepted DXFs through DWG and verify the returned DXFs."""
from __future__ import annotations

import csv
import datetime as dt
import json
from collections import Counter
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import ezdxf

import batch_converter
import exchange


ROOT = Path(__file__).resolve().parent
SOURCE_REPORT = ROOT / "reports" / "dwg-dxf-qa-20260914-132635" / "최종_결과.json"


def save(report: Path, rows: list[dict]) -> None:
    report.mkdir(parents=True, exist_ok=True)
    fields = [
        "index", "original_dwg", "source_dxf", "source_mb", "status", "seconds",
        "dwg", "dwg_mb", "returned_dxf", "returned_mb", "source_entities",
        "returned_entities", "source_layouts", "returned_layouts", "audit_errors",
        "audit_fixes", "barun_entities", "engine_to_dwg", "engine_back_to_dxf",
        "warning_count", "difference", "error_code", "error", "hint",
    ]
    with (report / "results.csv").open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader(); writer.writerows(rows)
    summary = {
        "tested": len(rows),
        "passed": sum(r["status"] == "통과" for r in rows),
        "failed": sum(r["status"] == "실패" for r in rows),
        "auditErrors": sum(int(r.get("audit_errors") or 0) for r in rows),
        "auditFixes": sum(int(r.get("audit_fixes") or 0) for r in rows),
        "rows": rows,
    }
    (report / "results.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")


def audit_one(job: tuple[dict, str, str]) -> dict:
    item, dwg_dir_text, returned_dir_text = job
    source = Path(item["output"])
    row = {
        "index": item["index"], "original_dwg": item["source"], "source_dxf": str(source),
        "source_mb": round(source.stat().st_size / 1048576, 2),
    }
    try:
        source_doc = ezdxf.readfile(source)
        source_types = Counter(e.dxftype() for e in source_doc.modelspace())
        source_layouts = max(0, len(source_doc.layouts) - 1)
        to_dwg = batch_converter.process({
            "action": "convert", "name": source.name, "direction": "dxf-dwg",
            "folder": dwg_dir_text, "version": "2018", "_raw": source.read_bytes(),
        })
        if to_dwg.get("failed"):
            raise RuntimeError(json.dumps(to_dwg, ensure_ascii=False))
        dwg = Path(to_dwg["path"])
        back = batch_converter.process({
            "action": "convert", "name": dwg.name, "direction": "dwg-dxf",
            "folder": returned_dir_text, "version": "2018", "_raw": dwg.read_bytes(),
        })
        if back.get("failed"):
            raise RuntimeError(json.dumps(back, ensure_ascii=False))
        returned = Path(back["path"])
        returned_doc = ezdxf.readfile(returned)
        auditor = returned_doc.audit()
        returned_types = Counter(e.dxftype() for e in returned_doc.modelspace())
        returned_layouts = max(0, len(returned_doc.layouts) - 1)
        imported = exchange.import_file(returned.read_bytes(), ".dxf")
        differences = {
            kind: {"before": source_types.get(kind, 0), "after": returned_types.get(kind, 0)}
            for kind in sorted(set(source_types) | set(returned_types))
            if source_types.get(kind, 0) != returned_types.get(kind, 0)
        }
        if differences:
            raise ValueError("객체 종류별 개수 불일치: " + json.dumps(differences, ensure_ascii=False))
        if source_layouts != returned_layouts:
            raise ValueError(f"배치 개수 불일치: {source_layouts} → {returned_layouts}")
        if auditor.errors:
            raise ValueError(f"왕복 DXF 감사 오류 {len(auditor.errors)}건")
        row.update(
            status="통과", seconds=round(float(to_dwg.get("seconds", 0)) + float(back.get("seconds", 0)), 2),
            dwg=str(dwg), dwg_mb=round(dwg.stat().st_size / 1048576, 2),
            returned_dxf=str(returned), returned_mb=round(returned.stat().st_size / 1048576, 2),
            source_entities=sum(source_types.values()), returned_entities=sum(returned_types.values()),
            source_layouts=source_layouts, returned_layouts=returned_layouts,
            audit_errors=len(auditor.errors), audit_fixes=len(auditor.fixes),
            barun_entities=imported["report"]["imported"], engine_to_dwg=to_dwg.get("engine"),
            engine_back_to_dxf=back.get("engine"),
            warning_count=int(to_dwg.get("warningCount", 0)) + int(back.get("warningCount", 0)),
            difference="",
        )
    except Exception as error:
        detail = str(error)
        try: parsed = json.loads(detail)
        except Exception: parsed = {}
        row.update(status="실패", error_code=parsed.get("code", type(error).__name__),
                   error=parsed.get("message", detail)[:4000], hint=parsed.get("hint", ""))
    return row


def main() -> None:
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    report = ROOT / "reports" / f"dxf-dwg-roundtrip-{stamp}"
    dwg_dir, returned_dir = report / "dwg", report / "returned-dxf"
    dwg_dir.mkdir(parents=True); returned_dir.mkdir(parents=True)
    data = json.loads(SOURCE_REPORT.read_text(encoding="utf-8"))
    accepted = [r for r in data["rows"] if r.get("판정") == "통과"]
    jobs = [(r, str(dwg_dir), str(returned_dir)) for r in accepted]
    rows: list[dict] = []
    with ProcessPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(audit_one, job): job for job in jobs}
        for future in as_completed(futures):
            row = future.result(); rows.append(row); rows.sort(key=lambda r: r["index"])
            save(report, rows)
            print(f"[{len(rows):03d}/{len(jobs)}] {row['status']} {Path(row['source_dxf']).name}", flush=True)
    print(str(report), flush=True)


if __name__ == "__main__":
    main()
