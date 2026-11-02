"""현장 기록 AI 도구. 로그인과 현재 도면 확인은 공통 도구 입구에서 맡는다."""
import base64
import copy
import datetime as dt
import math
import re
import uuid
from pathlib import Path, PureWindowsPath

import field_records as fr


_NAMES = {'cad_field_records_list', 'cad_field_records_get',
          'cad_field_records_update', 'cad_field_records_locate'}


def _data(context):
    return {key: context.get(key, '') for key in ('drawingPath', 'drawingName', 'draftKey')}


def _date(value):
    if value is None:
        return None
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', value):
        raise ValueError('날짜는 YYYY-MM-DD 형식이어야 합니다.')
    try:
        return dt.date.fromisoformat(value)
    except ValueError as error:
        raise ValueError('실제로 있는 날짜를 YYYY-MM-DD 형식으로 입력하세요.') from error


def _received_date(value):
    # 가져온 기록의 손상된 날짜는 알 수 없는 날짜로 취급하고 사용자 필터 검사는 엄격하게 유지한다.
    if not isinstance(value, str) or not value:
        return None
    try:
        return _date(value[:10])
    except ValueError:
        return None


def _summary(pin):
    times = [event.get('at') or event.get('savedAt') for event in pin.get('history', [])]
    times = [value for value in times + [pin.get('lastAt')] if value]
    return {'id': pin.get('id'), 'link_id': pin.get('link', ''), 'no': pin.get('no'),
            'at': copy.deepcopy(pin.get('at')), 'title': pin.get('title', ''),
            'status': '처리됨' if pin.get('status') in ('해결', '처리됨') else '열림',
            'field_status': pin.get('status'), 'firstAt': pin.get('firstAt', ''),
            'lastAt': max(times, key=fr._at_key) if times else '',
            'photo_count': len(pin.get('photos', []))}


def _validate_selector(args):
    pid, no, link = (args.get(key) for key in ('pin_id', 'pin_no', 'link_id'))
    if pid is None and no is None:
        raise ValueError('핀 이름(pin_id) 또는 핀 번호(pin_no)가 필요합니다.')
    if pid is not None and (not isinstance(pid, str) or not pid.strip()):
        raise ValueError('핀 이름(pin_id)은 비어 있지 않은 글자여야 합니다.')
    if no is not None and (not isinstance(no, int) or isinstance(no, bool) or no <= 0):
        raise ValueError('핀 번호(pin_no)는 1 이상의 정수여야 합니다.')
    if link is not None and not isinstance(link, str):
        raise ValueError('링크 이름(link_id)은 글자여야 합니다.')


def _select(pins, args):
    pid, no, link = (args.get(key) for key in ('pin_id', 'pin_no', 'link_id'))
    hits = [pin for pin in pins
            if (pid is None or pin.get('id') == pid)
            and (no is None or pin.get('no') == no)
            and (link is None or pin.get('link', '') == link)]
    if not hits:
        raise ValueError('현장 기록을 찾을 수 없습니다.')
    if len(hits) != 1:
        raise ValueError('같은 핀이 여러 링크에 있습니다. 링크 이름(link_id)도 지정하세요.')
    return hits[0]


def _validate_update(args):
    status, reply = args.get('status'), args.get('reply')
    if status is not None and status not in ('열림', '처리됨'):
        raise ValueError('상태는 열림 또는 처리됨이어야 합니다.')
    if reply is not None and (not isinstance(reply, str) or not reply.strip() or len(reply) > 8000):
        raise ValueError('답은 비어 있지 않은 8000자 이하 글자여야 합니다.')
    if status is None and reply is None:
        raise ValueError('바꿀 상태 또는 답을 입력하세요.')


def _photos(pin, folder):
    photos = copy.deepcopy(pin.get('photos', []))
    for photo in photos:
        relative = photo.get('file')
        if not isinstance(relative, str) or not relative or PureWindowsPath(relative).drive or PureWindowsPath(relative).root:
            raise ValueError('사진은 기록함 안의 상대 경로여야 합니다.')
        photo['path'] = str(fr._inside(Path(folder), relative.replace(chr(92), '/')))
    return photos


def _preview(photos, photo_id):
    photo = next((item for item in photos if item.get('id') == photo_id), None) if photo_id is not None else next(iter(photos), None)
    if photo is None:
        raise ValueError('미리보기 사진을 찾을 수 없습니다.')
    try:
        from PIL import Image
        import io
    except ImportError as error:
        raise ValueError('사진 미리보기를 사용할 수 없습니다.') from error
    try:
        with Image.open(photo['path']) as image:
            image.thumbnail((512, 512))
            buffer = io.BytesIO()
            image.convert('RGB').save(buffer, 'JPEG')
        return {'mimeType': 'image/jpeg', 'data': base64.b64encode(buffer.getvalue()).decode('ascii')}
    except OSError as error:
        raise ValueError('저장된 사진을 열 수 없습니다.') from error


def call(name, args, context, *, assert_current=lambda: None):
    """인자를 먼저 검사하고 같은 장부 잠금 안에서 읽기와 덧붙이기를 수행한다."""
    if name not in _NAMES:
        raise ValueError('지원하지 않는 현장 기록 도구입니다.')
    if not isinstance(args, dict) or not isinstance(context, dict):
        raise ValueError('도구 인자와 도면 정보가 필요합니다.')
    data = _data(context)
    if name == 'cad_field_records_update':
        if fr.folder_for(data, _check_parent=False)['fallback']:
            raise ValueError('도면을 먼저 저장하세요.')
        _validate_update(args)
    if name == 'cad_field_records_list':
        lo, hi = _date(args.get('date_from')), _date(args.get('date_to'))
        if lo and hi and lo > hi:
            raise ValueError('시작 날짜는 끝 날짜보다 늦을 수 없습니다.')
        status = args.get('status')
        if status is not None and status not in ('열림', '처리됨'):
            raise ValueError('상태는 열림 또는 처리됨이어야 합니다.')
    else:
        _validate_selector(args)
    if name == 'cad_field_records_get':
        if 'include_preview' in args and not isinstance(args['include_preview'], bool):
            raise ValueError('미리보기 여부(include_preview)는 참 또는 거짓이어야 합니다.')
        if args.get('photo_id') is not None and (not isinstance(args['photo_id'], str) or not args['photo_id']):
            raise ValueError('사진 이름(photo_id)은 비어 있지 않은 글자여야 합니다.')
    with fr._SPOOL_LOCK:
        assert_current()
        result = fr.process({**data, 'action': 'read'})
        assert_current()
        if name == 'cad_field_records_list':
            records = []
            for pin in result.get('pins', []):
                summary = _summary(pin)
                received = _received_date(summary['firstAt']) if lo or hi else None
                if status and summary['status'] != status:
                    continue
                if lo and (received is None or received < lo) or hi and (received is None or received > hi):
                    continue
                records.append(summary)
            return {'records': records, 'count': len(records), 'folder': result['folder'],
                    'drawingPath': data['drawingPath'], 'spoolPending': result.get('spoolPending', 0)}
        pin = _select(result.get('pins', []), args)
        if name == 'cad_field_records_locate':
            at = pin.get('at')
            if not isinstance(at, dict) or not all(
                    isinstance(at.get(axis), (int, float)) and not isinstance(at[axis], bool)
                    and math.isfinite(at[axis]) for axis in ('x', 'y')):
                raise ValueError('핀에 올바른 도면 위치가 없습니다.')
            return {'record': _summary(pin), 'x': at['x'], 'y': at['y']}
        if name == 'cad_field_records_get':
            record = copy.deepcopy(pin)
            record.update(_summary(pin))
            record['summary'] = _summary(pin)
            record['photos'] = _photos(pin, result['folder'])
            answer = {'record': record}
            if args.get('include_preview', False):
                answer['image'] = _preview(record['photos'], args.get('photo_id'))
            return answer
        events, now = [], fr._now()
        common = {'link': pin.get('link', ''), 'pin': pin['id'], 'at': now, 'by': '사무실 AI'}
        if args.get('status') is not None:
            events.append({**common, 'id': 'ai-status:' + uuid.uuid4().hex, 'kind': 'pin.status',
                           'from': pin.get('status'), 'to': '해결' if args['status'] == '처리됨' else '미해결'})
        if args.get('reply') is not None:
            events.append({**common, 'id': 'ai-reply:' + uuid.uuid4().hex, 'kind': 'reply.sent',
                           'text': args['reply'], 'delivered': False})
        assert_current()
        written = fr.process({**data, 'action': 'append', 'events': events})
        queued = bool(written.get('spooled'))
        # 대기 중인 쓰기는 완료로 표시하지 않고 마지막으로 확인한 장부 상태를 돌려준다.
        current = pin if queued else _select(fr._pins(result['events'] + events), args)
        return {**written, 'queued': queued, 'delivered': False, 'deleted': 0, 'record': _summary(current)}
