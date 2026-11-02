"""Run a bounded, sequential recent-file sample from a private local inventory."""
import argparse, collections, datetime, heapq, json, os, shutil, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def write_json(path, value):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    # Windows readers/antivirus can briefly hold the destination without delete sharing.
    for attempt in range(100):
        try:
            os.replace(temp, path)
            return
        except PermissionError:
            if attempt == 99:
                raise
            time.sleep(0.05)

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--inventory', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--count', type=int, default=300)
    a = p.parse_args()
    out = Path(a.out).resolve()
    if not out.is_relative_to(ROOT/'tools'/'quality'/'runs') or not 1 <= a.count <= 300:
        raise ValueError('Invalid run boundary')
    out.mkdir(parents=True, exist_ok=False)
    state = dict(schemaVersion=1, status='selecting', requested=a.count, completed=0,
                 pid=os.getpid(), startedAt=datetime.datetime.now().isoformat(),
                 selection='latest modification time; distinct paths, no content deduplication',
                 selectionErrors=0, results=[])
    def save(): write_json(out/'summary.json', state)
    save()
    inventory = json.loads(Path(a.inventory).read_text(encoding='utf-8'))
    def candidates():
        for i, entry in enumerate(inventory, 1):
            path = Path(entry['path'])
            try:
                stat = path.stat()
                if path.suffix.lower() in {'.dwg', '.dxf', '.bcad'} and path.is_file() and not path.is_symlink():
                    yield (-stat.st_mtime_ns, str(path).casefold(), str(path))
            except OSError:
                state['selectionErrors'] += 1
            if i % 2000 == 0:
                state['inventoryChecked'] = i
                save()
    selected = heapq.nsmallest(a.count, candidates())
    manifest = [dict(caseId=f'case-{i:04d}', path=row[2]) for i, row in enumerate(selected, 1)]
    write_json(out/'manifest.private.json', manifest)
    state.update(status='running', selected=len(manifest), inventoryChecked=len(inventory))
    save()
    for entry in manifest:
        if (out/'STOP').exists():
            state['status'] = 'stopped'; break
        if shutil.disk_usage(out).free < 2_000_000_000:
            state['status'] = 'blocked_low_disk'; break
        state['currentCase'] = entry['caseId']; save()
        case = out/entry['caseId']
        command = [sys.executable, str(ROOT/'tools/quality/inspect-drawing.py'),
                   '--file', entry['path'], '--out', str(case), '--compact']
        with (out/'runner.private.log').open('a', encoding='utf-8') as log:
            child = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=log)
            try:
                child.wait(timeout=360)
            except subprocess.TimeoutExpired:
                # Kill only the child tree created for this particular case.
                subprocess.run(['taskkill', '/PID', str(child.pid), '/T', '/F'],
                               stdout=log, stderr=log, timeout=20)
                child.wait(timeout=20)
        try:
            result = json.loads((case/'result.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            result = dict(caseId=entry['caseId'], status='failed', code='NO_CASE_RESULT')
        state['results'].append(result); state['completed'] += 1
        save()
        if result.get('originalUnchanged') is False:
            state['status'] = 'stopped_original_changed'; break
    else:
        state['status'] = 'finished'
    state.pop('currentCase', None)
    state['finishedAt'] = datetime.datetime.now().isoformat()
    save()
    counts = dict(collections.Counter(r['status'] for r in state['results']))
    failures, timings = [], []
    for r in state['results']:
        renderer = r.get('renderer', {})
        for check in renderer.get('checks', []):
            if check['status'] == 'failed':
                failures.append(dict(caseId=r['caseId'], check=check['name'], code=check.get('code')))
            if 'scenarioMs' in check:
                timings.append(dict(caseId=r['caseId'], check=check['name'],
                                    scenarioMs=round(check['scenarioMs'], 1),
                                    buildMs=round(check.get('gpu', {}).get('buildMs', 0), 1)))
        if r['status'] != 'completed':
            failures.append(dict(caseId=r['caseId'], status=r['status'], code=r.get('code'),
                                 errors=renderer.get('errors', [])))
    evidence = dict(selected=len(manifest), completed=state['completed'], counts=counts,
                    originalsUnchanged=sum(r.get('originalUnchanged') is True for r in state['results']),
                    exceptions=sum(len(r.get('renderer', {}).get('errors', [])) for r in state['results']),
                    failedChecks=failures[:100],
                    slowestScenarios=sorted(timings, key=lambda x:x['scenarioMs'], reverse=True)[:30])
    write_json(out/'analysis-evidence.json', evidence)
    report = ('# 도면 자동 검사 결과\n\n'
              f'- 작업 상태: {state["status"]}\n- 대상: {len(manifest)}개 / 처리: {state["completed"]}개\n'
              f'- 결과별 수: {json.dumps(counts, ensure_ascii=False)}\n'
              f'- 원본 해시 일치: {evidence["originalsUnchanged"]}개\n\n'
              'completed는 실행한 assertion 완료이며 도면 전체 품질 합격이 아닙니다. '
              '숨겨진 창, 합성 포인터, 앱 명령 API와 임시 LINE을 사용했습니다. '
              'SNAP 기하 정확성, 화면 원본 비교, 모든 객체 종류 편집 및 저장/닫기 대화상자는 미검증입니다. '
              'scenarioMs는 검증/문서 복제/임시 객체 정리 비용을 포함합니다.\n\n'
              '파일별 상세 결과는 summary.json 및 각 case/result.json, '
              '원본 경로는 로컬 전용 manifest.private.json에 있습니다.\n')
    (out/'report.md').write_text(report, encoding='utf-8')
    # Collection ends here. User policy: interpretation belongs to Astra,
    # never automatically send the evidence to the local model for analysis.
    state['localAnalysis'] = 'disabled_by_user'
    state['analysisOwner'] = 'Astra'
    state['analysisStatus'] = 'pending'
    save()

if __name__ == '__main__':
    main()
