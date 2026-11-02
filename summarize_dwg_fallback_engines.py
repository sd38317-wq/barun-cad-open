"""audit_dwg_fallback_engines.py 결과(results.json)를 쉬운 말 요약(요약.md)으로. 사용: python summarize_dwg_fallback_engines.py <보고서 폴더>"""
import json
import statistics
import sys
from collections import Counter
from pathlib import Path

ENGINES = {"primary": "기본(ACadSharp)", "libre": "이전 보조(과거 비교)", "rust": "acadrust(MPL)"}


def main(folder: Path) -> None:
    data = json.loads((folder / "results.json").read_text(encoding="utf-8"))
    rows = data["rows"]
    engines = {key: label for key, label in ENGINES.items() if any(key in row for row in rows)}
    ok = lambda r, e: bool((r.get(e) or {}).get("ok")) and (r.get(e) or {}).get("read") == "성공"
    lines = [f"# DWG 보조 엔진 비교 — {folder.name}", "", f"표본 {len(rows)}개 (전체 DWG {data['found']}개에서 이름순 등간격)", ""]
    lines += ["## 1. 열린 도면 수", "", "| 엔진 | 변환 성공 | 다시 읽기 성공 | 중간 시간(초) | 합계 시간(초) |", "|---|---|---|---|---|"]
    for e, name in engines.items():
        conv = [r for r in rows if (r.get(e) or {}).get("ok")]
        times = [(r.get(e) or {}).get("seconds") or 0 for r in rows]
        lines.append(f"| {name} | {len(conv)} | {sum(ok(r, e) for r in rows)} | {statistics.median(times):.2f} | {sum(times):.0f} |")
    # 보조 엔진이 실제로 쓰이는 경우 = 기본 엔진 실패
    fallback = [r for r in rows if not ok(r, "primary")]
    lines += ["", f"## 2. 기본 엔진이 못 연 도면 {len(fallback)}개 (보조 엔진이 실제로 쓰이는 곳)", "",
              "| # | 파일 | 버전 | acadrust | 모형 객체 | 바른 불러오기 |", "|---|---|---|---|---|---|"]
    for r in fallback:
        auxiliary = r.get("rust") or {}
        lines.append(f"| {r['index']} | {Path(r['source']).name} | {r.get('version')} | {'O' if ok(r, 'rust') else 'X'} | {auxiliary.get('ms', '-')} | {auxiliary.get('barun', '-')} |")
    # 같은 결과인지: 모형 객체 수·바른 불러오기 수·종류별 수
    def compare(a, b):
        both = [r for r in rows if ok(r, a) and ok(r, b)]
        same_ms = sum(r[a]["ms"] == r[b]["ms"] for r in both)
        same_barun = sum(r[a].get("barun") == r[b].get("barun") for r in both)
        kind_gap = Counter()
        for r in both:
            for k in set(r[a]["kinds"]) | set(r[b]["kinds"]):
                d = r[b]["kinds"].get(k, 0) - r[a]["kinds"].get(k, 0)
                if d:
                    kind_gap[k] += d
        return both, same_ms, same_barun, kind_gap
    lines += ["", "## 3. 둘 다 연 도면에서 결과가 같은가", ""]
    for a, b in (("primary", "rust"), ("libre", "rust"), ("primary", "libre")):
        if a not in engines or b not in engines:
            continue
        both, same_ms, same_barun, gap = compare(a, b)
        lines.append(f"- {ENGINES[a]} vs {ENGINES[b]}: 둘 다 연 {len(both)}개 중 모형 객체 수 같음 {same_ms}개, 바른 불러오기 객체 수 같음 {same_barun}개")
        if gap:
            lines.append("  - 종류별 차이 합계(뒤 엔진 − 앞 엔진): " + ", ".join(f"{k} {v:+d}" for k, v in gap.most_common(12)))
    lines += ["", "## 4. 한글·특수 객체", "", "| 엔진 | 깨진 레이어 이름 | 깨진 글자 객체 | 한글 글자 객체 | 해치 | 치수 | 블록 참조 | 블록 정의 |", "|---|---|---|---|---|---|---|---|"]
    for e, name in engines.items():
        good = [r[e] for r in rows if ok(r, e)]
        s = lambda k: sum(g.get(k) or 0 for g in good)
        lines.append(f"| {name} | {s('layers_broken')} | {s('texts_broken')} | {s('texts_hangul')} | {s('hatch')} | {s('dims')} | {s('inserts')} | {s('blocks')} |")
    lines += ["", "(합계는 각 엔진이 연 도면만 더한 값이라 연 도면 수가 다르면 직접 비교하지 말 것)", "", "## 5. acadrust 가 못 연 도면", ""]
    for r in rows:
        if not ok(r, "rust"):
            s = r.get("rust") or {}
            lines.append(f"- {r['index']} {Path(r['source']).name} ({r.get('version')}, {r['source_mb']} MB): {s.get('read_error') or s.get('log', '')[:200]} · 기본 {'O' if ok(r, 'primary') else 'X'}")
    (folder / "요약.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(folder / "요약.md")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
