"""에너지절약계획서 건물 외피 자료(JSON) — 바른 홈페이지 서버에 저장·불러오기.

외피 자료는 평면에서 뽑는다(tools/energy_envelope.py, 형식 docs/energy-envelope-json.md, schema barun.energy.envelope/1).
[계정 연결] 토큰(parcel_service.account_token)으로 홈페이지 /api/public/cad-energy/envelopes 를 부른다.
  save(envelope, name=None, project=None, id=None)  새로 저장(id 주면 그 자료를 바꿈) → 요약
  listing(project=None)                              내 자료 목록(본문 없이, 최근 것부터)
  load(id)                                           요약 + envelope 본문
  delete(id)
서버가 계산이 안 맞는 자료(구간 합 ≠ 변 길이 등)를 422 로 돌려보내면 그 이유를 그대로 올린다.
명령줄: python energy_envelope_service.py save <envelope.json> [--name 이름] [--project 일] | list [--project 일] | load <id> [out.json] | delete <id>
주소는 BARUN_CAD_ENERGY_URL 로 바꿀 수 있다(로컬 시험).
"""
import json, os, re, sys, urllib.parse, urllib.request

DEFAULT_URL = 'https://barunarc.co.kr/api/public/cad-energy/envelopes'
SCHEMA = 'barun.energy.envelope/1'
ID = re.compile(r'^[A-Za-z0-9_-]{22}$')
MAX_BYTES = 1024 * 1024


class EnvelopeError(Exception):
    def __init__(self, status, message, code=None):
        super().__init__(message); self.status = status; self.code = code


def base_url():
    value = (os.environ.get('BARUN_CAD_ENERGY_URL') or DEFAULT_URL).rstrip('/')
    return value if value.endswith('/cad-energy/envelopes') else value + '/api/public/cad-energy/envelopes'


def _token(token):
    if token is None:
        try:
            import parcel_service
            token = parcel_service.account_token()
        except Exception:
            token = ''
    if not token:
        raise EnvelopeError(401, '바른 계정 로그인([계정 연결])이 필요합니다.', 'LOGIN_REQUIRED')
    return token


def _request(method, url, token, body=None, opener=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode('utf-8')
    if data is not None and len(data) > MAX_BYTES:
        raise EnvelopeError(413, '외피 자료가 너무 큽니다(1MB까지).', 'TOO_LARGE')
    req = urllib.request.Request(url, data=data, method=method, headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
    try:
        with (opener or urllib.request.urlopen)(req, timeout=20) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as error:
        try:
            payload = json.loads(error.read().decode('utf-8'))
        except Exception:
            payload = {}
        raise EnvelopeError(error.code, payload.get('error') or f'서버 오류 {error.code}', payload.get('code')) from None
    except urllib.error.URLError as error:
        raise EnvelopeError(0, f'서버에 닿지 않습니다: {error.reason}', 'OFFLINE') from None


def _check_id(env_id):
    if not isinstance(env_id, str) or not ID.match(env_id):
        raise EnvelopeError(400, 'id 가 올바르지 않습니다(목록에서 받은 22자 id).', 'BAD_ID')


def save(envelope, name=None, project=None, id=None, *, token=None, opener=None):
    if not isinstance(envelope, dict) or envelope.get('schema') != SCHEMA:
        raise EnvelopeError(400, f'외피 자료가 아닙니다(schema {SCHEMA}).', 'BAD_ENVELOPE')
    body = {'envelope': envelope}
    if name is not None: body['name'] = name
    if project is not None: body['project'] = project
    tok = _token(token)
    if id is None:
        return _request('POST', base_url(), tok, body, opener)
    _check_id(id)
    return _request('PUT', base_url() + '/' + id, tok, body, opener)


def listing(project=None, *, token=None, opener=None):
    url = base_url() + ('?' + urllib.parse.urlencode({'project': project}) if project is not None else '')
    return _request('GET', url, _token(token), None, opener).get('items', [])


def load(env_id, *, token=None, opener=None):
    _check_id(env_id)
    return _request('GET', base_url() + '/' + env_id, _token(token), None, opener)


def delete(env_id, *, token=None, opener=None):
    _check_id(env_id)
    return _request('DELETE', base_url() + '/' + env_id, _token(token), None, opener)


def _main(argv):
    def opt(flag):
        if flag in argv:
            i = argv.index(flag); value = argv[i + 1]; del argv[i:i + 2]; return value
        return None
    token = os.environ.get('BARUN_CAD_TOKEN') or None   # 시험용: 없으면 [계정 연결] 토큰
    name, project = opt('--name'), opt('--project')
    cmd = argv[0] if argv else ''
    try:
        if cmd == 'save':
            with open(argv[1], encoding='utf-8') as f:
                out = save(json.load(f), name=name, project=project, id=opt('--id'), token=token)
        elif cmd == 'list':
            out = listing(project, token=token)
        elif cmd == 'load':
            out = load(argv[1], token=token)
            if len(argv) > 2:
                with open(argv[2], 'w', encoding='utf-8') as f:
                    json.dump(out['envelope'], f, ensure_ascii=False, indent=1)
                out = {k: v for k, v in out.items() if k != 'envelope'}
        elif cmd == 'delete':
            out = delete(argv[1], token=token)
        else:
            print(__doc__); return 2
    except EnvelopeError as error:
        print(f'실패({error.status} {error.code}): {error}', file=sys.stderr); return 1
    print(json.dumps(out, ensure_ascii=False, indent=1)); return 0


if __name__ == '__main__':
    sys.exit(_main(sys.argv[1:]))
