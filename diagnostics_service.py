"""바른 CAD 진단 기록 보내기(사용자 2026-10-21 "설치는 되고 안 되는 부분은 로그 기록했다가 로그인하면 홈페이지 오류 기록으로").

설치 전 기능 검사가 이 PC 에서 통과하지 못해도 설치는 된다(build/installer-official6.nsh). 그 기록
(ProgramData\\Barun\\CAD6Quality\\last-install-check.json)을 [계정 연결] 로그인이 있을 때 한 번 홈페이지
POST /api/public/cad-diagnostics 로 보내고, 보낸 기록은 .sent 로 표시한다. 도면·경로 같은 개인 내용은 보내지 않는다(검사 ID·상태·짧은 메시지만).
"""
import hashlib, json, os, sys, threading, time, urllib.request
from pathlib import Path

DEFAULT_URL = 'https://barunarc.co.kr/api/public/cad-diagnostics'
INTERVAL = 600  # 10분마다 확인(로그인을 나중에 해도 보낸다)


def report_paths():
    base = Path(os.environ.get('PROGRAMDATA') or r'C:\ProgramData')
    return [base / 'Barun' / 'CAD6Quality' / 'last-install-check.json']


def _text(value, limit):
    if not isinstance(value, str):
        return None
    value = ''.join(ch for ch in value if ch >= ' ' or ch in '\t').strip()
    return value[:limit] or None


def payload_from_report(raw, app_version, platform=sys.platform):
    """설치 검사 기록(envelope 또는 실패 기록) → 보낼 칸. 실패 항목만, 메시지는 짧게."""
    report = raw.get('report') if isinstance(raw.get('report'), dict) else raw
    checks = []
    for check in report.get('checks') or []:
        if isinstance(check, dict) and check.get('status') not in ('passed', 'superseded'):
            checks.append({'id': _text(check.get('id'), 100) or '?', 'status': _text(check.get('status'), 20) or '?',
                           'message': _text(check.get('error') if isinstance(check.get('error'), str) else (check.get('error') or {}).get('message') if isinstance(check.get('error'), dict) else check.get('message'), 300)})
    errors = [e for e in (report.get('errors') or []) if e]
    gate = report.get('gateError') or report.get('error') or {}
    first = (errors[0] if errors else None)
    summary = _text((gate.get('message') if isinstance(gate, dict) else None) or (first.get('message') if isinstance(first, dict) else first) or (f"검사 실패 {len(checks)}건: " + ', '.join(c['id'] for c in checks[:5]) if checks else '설치 전 기능 검사 실패'), 500)
    version = report.get('version') or (raw.get('candidate') or {}).get('version') or app_version
    out = {'kind': 'install-check', 'appVersion': version, 'platform': platform, 'summary': summary, 'checks': checks[:50]}
    if isinstance(gate, dict) and (gate.get('code') or gate.get('message')):
        out['error'] = {'code': _text(gate.get('code'), 60), 'message': _text(gate.get('message'), 500)}
    return out


def send_pending(app_version='0.0.0', *, token=None, post=None, url=None):
    """보낼 기록이 있고 로그인돼 있으면 한 번 보낸다. 보낸 개수를 돌려준다."""
    if token is None:
        try:
            import parcel_service
            token = parcel_service.account_token()
        except Exception:
            token = ''
    if not token:
        return 0
    sent = 0
    for path in report_paths():
        try:
            data = path.read_bytes()
        except OSError:
            continue
        digest = hashlib.sha256(data).hexdigest()
        marker = path.with_suffix('.sent')
        try:
            if marker.read_text(encoding='utf-8').strip() == digest:
                continue
        except OSError:
            pass
        try:
            body = json.dumps(payload_from_report(json.loads(data.decode('utf-8-sig')), app_version), ensure_ascii=False).encode('utf-8')
        except (ValueError, UnicodeDecodeError, AttributeError):
            continue
        status = (post or _post)(url or os.environ.get('BARUN_CAD_DIAGNOSTICS_URL', DEFAULT_URL), body, token)
        if status == 200:
            try:
                marker.write_text(digest, encoding='utf-8')
            except OSError:
                pass
            sent += 1
    return sent


def _post(url, body, token):
    request = urllib.request.Request(url, data=body, method='POST', headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status
    except Exception as error:
        return getattr(error, 'code', 0)


def start(app_version='0.0.0'):
    """백엔드가 켜져 있는 동안 10분마다 확인하는 뒤 일꾼. 실패해도 CAD 사용에는 영향 없음."""
    def loop():
        time.sleep(30)
        while True:
            try:
                send_pending(app_version)
            except Exception:
                pass
            time.sleep(INTERVAL)
    threading.Thread(target=loop, daemon=True, name='cad-diagnostics').start()
