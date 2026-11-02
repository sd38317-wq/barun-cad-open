"""Review real drawings one at a time: import (own process) -> JSON -> e2e harness checks. Waits for free memory; never runs two at once."""
import json, os, subprocess, sys, time
from pathlib import Path
ROOT = Path(r'D:\어플\캐드'); OUT = ROOT / 'tmp' / 'review'; OUT.mkdir(parents=True, exist_ok=True)
RESULTS = OUT / 'results.jsonl'
files = [l.strip() for l in open(sys.argv[1], encoding='utf-8') if l.strip()]
need_mb = int(sys.argv[2]) if len(sys.argv) > 2 else 4000

def available_mb():
    out = subprocess.run(['powershell', '-NoProfile', '-Command', "(Get-Counter '\\Memory\\Available MBytes').CounterSamples[0].CookedValue"], capture_output=True, text=True)
    try: return float(out.stdout.strip())
    except ValueError: return 0

IMPORT = r'''
import sys, json, time, os
sys.path.insert(0, r'D:\어플\캐드')
import exchange
src, dst = sys.argv[1], sys.argv[2]; t = time.perf_counter()
r = exchange.import_file_path(src, os.path.splitext(src)[1].lower())
doc = r['document']
with open(dst, 'w', encoding='utf-8') as f: json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
print(json.dumps({'seconds': round(time.perf_counter() - t, 1), 'entities': len(doc['entities']), 'warnings': (r.get('report') or {}).get('warnings')}, ensure_ascii=False, default=str)[:1500])
'''
for index, src in enumerate(files):
    row = {'file': src, 'mb': round(os.path.getsize(src) / 2**20, 1)}
    waited = 0
    while available_mb() < need_mb and waited < 1800:
        time.sleep(30); waited += 30
    row['availableMB'] = available_mb()
    if row['availableMB'] < need_mb:
        row['skipped'] = f'free memory below {need_mb} MB after 30 min'; open(RESULTS, 'a', encoding='utf-8').write(json.dumps(row, ensure_ascii=False) + '\n'); continue
    dst = OUT / f'{index:02d}.json'
    p = subprocess.run([sys.executable, '-c', IMPORT, src, str(dst)], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=1800)
    if p.returncode != 0:
        row['importError'] = (p.stderr or p.stdout)[-400:]; open(RESULTS, 'a', encoding='utf-8').write(json.dumps(row, ensure_ascii=False) + '\n'); continue
    row['import'] = json.loads(p.stdout.strip().splitlines()[-1])
    env = {**os.environ, 'E2E_DRAWING': str(dst), 'E2E_TIMEOUT': '900000'}
    label = f'review-{index:02d}'
    h = subprocess.run([str(ROOT / 'node_modules' / '.bin' / 'electron.cmd'), 'tmp/e2e-large/run.cjs', f'--label={label}', '--only=zoom,plotcheck,bigmove,interact,edit'],
                       cwd=ROOT, env=env, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=1200)
    runs = sorted((ROOT / 'tmp' / 'e2e-large' / 'runs').glob(f'*-{label}'), key=lambda p: p.stat().st_mtime)
    if not runs:
        row['harnessError'] = (h.stderr or h.stdout)[-400:]
    else:
        rep = json.loads((runs[-1] / 'report.json').read_text(encoding='utf-8'))
        res = rep.get('result', {}); phases = {p['name']: p.get('summary', {}) for p in rep.get('phases', [])}
        row['status'] = rep.get('status'); row['run'] = runs[-1].name
        row['open'] = {k: phases.get('OPEN_TO_SETTLED', {}).get(k) for k in ('durationMs', 'longMax')}
        row['plot'] = res.get('plotcheck'); row['bigmove'] = res.get('bigmove'); row['errors'] = res.get('errors')
        row['clickTarget'] = res.get('clickTarget'); row['windowSelected'] = res.get('windowSelected')
        row['worst'] = sorted(((k, v.get('longMax', 0), v.get('busyAfterLastInput', 0)) for k, v in phases.items() if k != 'OPEN_TO_SETTLED'), key=lambda x: -x[1])[:3]
    try: dst.unlink()
    except OSError: pass
    open(RESULTS, 'a', encoding='utf-8').write(json.dumps(row, ensure_ascii=False, default=str) + '\n')
    print(index, row.get('status') or row.get('importError') or row.get('harnessError'), flush=True)
