"""Chunked NDJSON transfer for large drawings (S1 · 5.0.4 안정성 검토).

약 100 MB DXF 를 열면 결과 JSON 이 600 MB 를 넘어 V8 문자열 한도(약 512M 문자)를
넘겼다.  결과를 한 줄짜리 JSON 대신 줄 단위(NDJSON)로 쪼개 보내면 화면 쪽은 줄마다
따로 해석하므로 어떤 문자열도 SAFE_LINE_BYTES 를 넘지 않는다.  같은 형식을 화면 →
엔진 방향(저장·내보내기·대용량 복구)에도 쓴다.

줄 형식(각 줄은 JSON 객체 하나, '\\n' 종료):
  {"kind":"header","version":1,"report":{...},"document":{entities/blocks/sharedBlocks/dxfPreservation 를 뺀 나머지},
   "counts":{"entities":N,"blocks":B,"sharedBlocks":S},"preservation":true|false}
  {"kind":"index","entities":N,"layers":{이름:개수},"types":{종류:개수},"bounds":[x0,y0,x1,y1],"grid":{"cols":8,"rows":8,"cells":[...]}}
                                             # ACAD200-801: 객체 앞에 오는 색인 줄 — 화면은 이것만으로 범위·레이어·분포를 먼저 안다
  {"kind":"entities","items":[...]}          # 여러 줄
  {"kind":"blocks","items":[...]}            # 여러 줄
  {"kind":"sharedBlock","name":..,"origin":..,"entities":[...],"part":i,"last":bool}
  {"kind":"preservationMeta","format":..,"handles":[...],"version":..}
  {"kind":"preservation","data":"<base64 조각>"}  # 여러 줄
  {"kind":"end","lines":n,"bytes":b,"counts":{"entities":N,"blocks":B,"sharedBlocks":S,"preservationParts":P}}
end 의 lines/bytes/counts 는 무결성 검사용이다: 받는 쪽은 페이지가 빠졌는지 대조한다.
"""
import gzip
import io
import json
import math
import os
import queue
import threading
import uuid
from collections import Counter
from itertools import repeat

STREAM_VERSION = 1
SAFE_LINE_BYTES = 32 * 1024 * 1024      # 페이지 상한 (V8 문자열 한도의 1/16)
HARD_LINE_BYTES = 256 * 1024 * 1024     # 객체 하나가 이보다 크면 전송 불가 (그 아래면 경고만 하고 보낸다)
PAGE_TARGET_BYTES = 6 * 1024 * 1024     # 객체 페이지 목표 크기
PRESERVATION_PART_CHARS = 8 * 1024 * 1024
CONTENT_TYPE = 'application/x-ndjson; charset=utf-8'
CACHE_SUFFIX = '.ndjson.gz'
BIG_KEYS = ('entities', 'blocks', 'sharedBlocks', 'dxfPreservation')
_OPTIONS = {'ensure_ascii': False, 'allow_nan': False, 'separators': (',', ':')}


class StreamError(ValueError):
    """잘못된/불완전한 스트림."""


def _json_safe(value):
    if isinstance(value, str):
        return ''.join('�' if 0xD800 <= ord(char) <= 0xDFFF else char for char in value)
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {_json_safe(key): _json_safe(item) for key, item in value.items()}
    return value


def dumps(value):
    """UTF-8 bytes; damaged surrogate text is repaired only when encoding fails."""
    rendered = json.dumps(value, **_OPTIONS)
    try:
        return rendered.encode('utf-8')
    except UnicodeEncodeError:
        return json.dumps(_json_safe(value), **_OPTIONS).encode('utf-8')


def _pages(items, prefix, target=None):
    """Yield NDJSON lines holding a list under `prefix` without exceeding the page target."""
    target = PAGE_TARGET_BYTES if target is None else target
    parts = []
    size = 0
    for item in items:
        encoded = dumps(item)
        if parts and size + len(encoded) + 1 > target:
            yield prefix + b','.join(parts) + b']}\n'
            parts = []
            size = 0
        parts.append(encoded)
        size += len(encoded) + 1
    if parts or not items:
        yield prefix + b','.join(parts) + b']}\n'


def counts_of(document):
    document = document or {}
    return {'entities': len(document.get('entities') or []), 'blocks': len(document.get('blocks') or []), 'sharedBlocks': len(document.get('sharedBlocks') or {}),
            'preservationParts': 0 if document.get('dxfPreservation') is None else max(1, -(-len(str(document['dxfPreservation'].get('data') or '')) // PRESERVATION_PART_CHARS))}


INDEX_GRID = 8


def _anchor(entity):
    points = entity.get('points')
    point = points[0] if isinstance(points, list) and points else entity.get('center') or entity.get('position')
    if isinstance(point, dict):
        x, y = point.get('x'), point.get('y')
        if isinstance(x, (int, float)) and isinstance(y, (int, float)) and math.isfinite(x) and math.isfinite(y):
            return float(x), float(y)
    return None


def drawing_index(document, grid=INDEX_GRID, sample=20000):
    """ACAD200-801 색인 줄: 레이어·종류별 개수, 대략 범위, 8x8 격자별 개수.
    개수는 전부 세고, 범위·격자는 객체가 많으면 고르게 sample 개만 본다(대표점 기준·대략 값, 20만 객체 약 0.06초)."""
    document = document or {}
    entities = [entity for entity in document.get('entities') or [] if isinstance(entity, dict)]
    names = {layer.get('id'): layer.get('name') for layer in document.get('layers') or [] if isinstance(layer, dict)}
    by_layer = Counter(map(dict.get, entities, repeat('layer')))   # map(dict.get) 은 C 안에서 돈다(생성식보다 몇 배 빠름)
    layers = Counter()
    for key, count in by_layer.items():
        layers[names.get(key, str(key))] += count
    types = Counter()
    for key, count in Counter(map(dict.get, entities, repeat('type'))).items():
        types[str(key)] += count
    step = max(1, len(entities) // sample) if sample else 1
    anchors = [anchor for anchor in map(_anchor, entities[::step]) if anchor is not None]
    bounds = None
    cells = [0] * (grid * grid)
    if anchors:
        xs = [a[0] for a in anchors]
        ys = [a[1] for a in anchors]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        bounds = [x0, y0, x1, y1]
        sx = grid / (x1 - x0) if x1 > x0 else 0.0
        sy = grid / (y1 - y0) if y1 > y0 else 0.0
        last = grid - 1
        for x, y in anchors:
            cells[min(last, int((y - y0) * sy)) * grid + min(last, int((x - x0) * sx))] += step
    return {'kind': 'index', 'entities': len(entities), 'layers': dict(layers), 'types': dict(types), 'bounds': bounds,
            'grid': {'cols': grid, 'rows': grid, 'cells': cells, 'sampled': step > 1}}


def iter_lines(result):
    """Yield the NDJSON byte lines of a result ({'document':..,'report':..}); the last line carries integrity counts."""
    document = result.get('document') or {}
    report = result.get('report') or {}
    entities = document.get('entities') or []
    blocks = document.get('blocks') or []
    shared = document.get('sharedBlocks') or {}
    preservation = document.get('dxfPreservation')
    header = {key: value for key, value in document.items() if key not in BIG_KEYS}
    counts = counts_of(document)
    total = {'lines': 0, 'bytes': 0}

    def emit(line):
        total['lines'] += 1
        total['bytes'] += len(line)
        return line
    yield emit(dumps({'kind': 'header', 'version': STREAM_VERSION, 'report': report, 'document': header,
                      'counts': {key: counts[key] for key in ('entities', 'blocks', 'sharedBlocks')}, 'preservation': preservation is not None}) + b'\n')
    if entities:
        yield emit(dumps(drawing_index(document)) + b'\n')
    for line in _pages(entities, b'{"kind":"entities","items":['):
        yield emit(line)
    if blocks:
        for line in _pages(blocks, b'{"kind":"blocks","items":['):
            yield emit(line)
    for name, definition in shared.items():
        children = definition.get('entities') or []
        meta = {key: value for key, value in definition.items() if key != 'entities'}
        head = dumps({'kind': 'sharedBlock', 'name': name, **meta})[:-1]  # strip closing brace
        pages = list(_pages(children, b'')) if children else [b']}\n']
        for index, page in enumerate(pages):
            items = page[:-3] if page.endswith(b']}\n') else page
            yield emit(head + b',"part":' + str(index).encode() + b',"last":' + (b'true' if index == len(pages) - 1 else b'false') + b',"entities":[' + items + b']}\n')
    if preservation is not None:
        yield emit(dumps({'kind': 'preservationMeta', **{key: value for key, value in preservation.items() if key != 'data'}}) + b'\n')
        data = str(preservation.get('data') or '')
        for start in range(0, len(data), PRESERVATION_PART_CHARS):
            yield emit(b'{"kind":"preservation","data":"' + data[start:start + PRESERVATION_PART_CHARS].encode('ascii') + b'"}\n')
        if not data:
            yield emit(b'{"kind":"preservation","data":""}\n')
    yield dumps({'kind': 'end', 'lines': total['lines'], 'bytes': total['bytes'], 'counts': counts}) + b'\n'


def check_line(line):
    """페이지 상한을 넘는 줄: 객체 하나가 큰 경우는 HARD 한도까지 허용하고 경고를 돌려준다."""
    if len(line) > HARD_LINE_BYTES:
        raise StreamError(f'도면 객체 하나가 전송 한도({HARD_LINE_BYTES // (1024 * 1024)} MB)를 넘습니다. 원본 CAD에서 해당 객체를 나눈 뒤 다시 여세요.')
    return len(line) > SAFE_LINE_BYTES


class PipelinedGzip:
    """ACAD200-803: 줄 만들기(JSON, GIL 필요)와 gzip 압축(zlib 은 GIL 을 놓는다)을 겹쳐 돌린다.
    줄은 약 1 MB 묶음으로 압축 스레드에 넘기고, 대기열은 몇 묶음만 두어 메모리가 늘지 않게 한다. 풀린 내용은 순서대로 같다."""
    CHUNK = 1024 * 1024

    def __init__(self, raw, compresslevel=1, depth=4):
        self.stream = gzip.GzipFile(fileobj=raw, mode='wb', compresslevel=compresslevel)
        self.queue = queue.Queue(maxsize=depth)
        self.parts = []
        self.size = 0
        self.error = None
        self.thread = threading.Thread(target=self._run, name='barun-gzip', daemon=True)
        self.thread.start()

    def _run(self):
        while True:
            block = self.queue.get()
            if block is None:
                return
            if self.error is None:
                try:
                    self.stream.write(block)
                except BaseException as error:   # 디스크 가득 등은 write()·close() 에서 다시 던진다
                    self.error = error

    def write(self, line):
        if self.error is not None:
            raise self.error
        self.parts.append(line)
        self.size += len(line)
        if self.size >= self.CHUNK:
            self.queue.put(b''.join(self.parts))
            self.parts = []
            self.size = 0

    def close(self):
        try:
            if self.parts and self.error is None:
                self.queue.put(b''.join(self.parts))
            self.parts = []
        finally:
            self.queue.put(None)
            self.thread.join()
            self.stream.close()
        if self.error is not None:
            raise self.error


def write_stream(result, target, compresslevel=1):
    """Write the gzip NDJSON stream atomically and return {'lines','maxLineBytes','bytes','oversized'}."""
    target = os.fspath(target)
    temp = target + '.' + uuid.uuid4().hex + '.tmp'
    lines = 0
    max_line = 0
    oversized = 0
    try:
        with open(temp, 'wb') as raw:
            stream = PipelinedGzip(raw, compresslevel)
            try:
                for line in iter_lines(result):
                    lines += 1
                    max_line = max(max_line, len(line))
                    if check_line(line):
                        oversized += 1
                    stream.write(line)
            finally:
                stream.close()          # gzip 꼬리(CRC·크기)까지 쓴 뒤에 fsync 한다
            raw.flush()
            os.fsync(raw.fileno())      # S15: 바꿔치기 전에 디스크까지 내려쓴다
        os.replace(temp, target)
    finally:
        try:
            os.unlink(temp)
        except OSError:
            pass
    return {'lines': lines, 'maxLineBytes': max_line, 'bytes': os.path.getsize(target), 'oversized': oversized}


def _iter_stream_lines(stream, chunk_size=4 * 1024 * 1024, limit=None):
    """Yield complete lines (without '\\n') from a binary stream without holding more than one line."""
    pending = []
    pending_bytes = 0
    consumed = 0
    while True:
        chunk = stream.read(chunk_size if limit is None else min(chunk_size, limit - consumed))
        if not chunk:
            break
        consumed += len(chunk)
        start = 0
        while True:
            index = chunk.find(b'\n', start)
            if index < 0:
                break
            piece = chunk[start:index]
            if pending:
                pending.append(piece)
                line = b''.join(pending)
                pending = []
                pending_bytes = 0
            else:
                line = piece
            if line.strip():
                yield line
            start = index + 1
        if start < len(chunk):
            rest = chunk[start:]
            pending_bytes += len(rest)
            if pending_bytes > HARD_LINE_BYTES:
                raise StreamError('전송 한 줄이 허용 크기를 초과했습니다.')
            pending.append(rest)
        if limit is not None and consumed >= limit:
            break
    if pending:
        line = b''.join(pending)
        if line.strip():
            yield line


def stream_is_complete(path, chunk_size=4 * 1024 * 1024):
    """True when the gzip NDJSON file decompresses fully, ends with an end record and its line/byte counts match."""
    lines = 0
    total = 0
    last = None
    try:
        with gzip.open(path, 'rb') as stream:
            for line in _iter_stream_lines(stream, chunk_size):
                if last is not None:
                    lines += 1
                    total += len(last) + 1
                last = line
    except (OSError, EOFError, gzip.BadGzipFile, ValueError):
        return False
    if last is None or not last.startswith(b'{"kind":"end"'):
        return False
    try:
        end = json.loads(last)
    except ValueError:
        return False
    return end.get('lines') == lines and end.get('bytes') == total


class Assembler:
    """Rebuild {'document','report'} from NDJSON records and verify the end counts."""
    def __init__(self):
        self.document = None
        self.report = None
        self.entities = []
        self.blocks = []
        self.shared = {}
        self.meta = None
        self.index = None
        self.parts = []
        self.end = None
        self.lines = 0
        self.bytes = 0

    def feed(self, line):
        if isinstance(line, (bytes, bytearray)):
            raw_len = len(line) + 1
            try:
                record = json.loads(line)
            except ValueError:
                raise StreamError('도면 엔진 응답이 중간에 끊겼거나 형식이 손상되었습니다.')
        elif isinstance(line, str):
            raw_len = len(line.encode('utf-8')) + 1
            record = json.loads(line)
        else:
            record = line
            raw_len = 0
        kind = record.get('kind')
        if kind != 'end':
            self.lines += 1
            self.bytes += raw_len
        if kind == 'index':
            self.index = record
        elif kind == 'header':
            self.document = dict(record['document'])
            self.report = record.get('report')
        elif kind == 'entities':
            self.entities.extend(record['items'])
        elif kind == 'blocks':
            self.blocks.extend(record['items'])
        elif kind == 'sharedBlock':
            definition = self.shared.setdefault(record['name'], {key: value for key, value in record.items() if key not in ('kind', 'name', 'part', 'last', 'entities')})
            definition.setdefault('entities', []).extend(record.get('entities') or [])
        elif kind == 'preservationMeta':
            self.meta = {key: value for key, value in record.items() if key != 'kind'}
        elif kind == 'preservation':
            self.parts.append(record['data'])
        elif kind == 'end':
            self.end = record
        else:
            raise StreamError('도면 엔진 응답 형식을 알 수 없습니다.')

    def finish(self):
        if self.document is None or self.end is None:
            raise StreamError('도면 엔진 응답이 중간에 끊겼습니다.')
        counts = self.end.get('counts') or {}
        got = {'entities': len(self.entities), 'blocks': len(self.blocks), 'sharedBlocks': len(self.shared), 'preservationParts': len(self.parts)}
        for key, expected in counts.items():
            if key in got and got[key] != expected:
                raise StreamError(f'전송된 도면 자료가 불완전합니다 ({key} {got[key]:,}/{expected:,}). 다시 여세요.')
        if 'lines' in self.end and self.end['lines'] != self.lines:
            raise StreamError(f"전송된 도면 자료가 불완전합니다 (줄 {self.lines:,}/{self.end['lines']:,}). 다시 여세요.")
        self.document['entities'] = self.entities
        self.document['blocks'] = self.blocks
        if self.shared:
            self.document['sharedBlocks'] = self.shared
        if self.meta is not None:
            self.document['dxfPreservation'] = {**self.meta, 'data': ''.join(self.parts)}
        return {'document': self.document, 'report': self.report}


def assemble(lines):
    """Rebuild {'document','report'} from decoded NDJSON records (server side · tests)."""
    assembler = Assembler()
    for line in lines:
        assembler.feed(line)
    return assembler.finish()


def read_stream(path):
    """Decode a gzip NDJSON cache file back into a result (tests / diagnostics)."""
    with gzip.open(path, 'rb') as stream:
        return assemble(_iter_stream_lines(stream))


def read_request(stream, size):
    """화면이 보낸 NDJSON 요청 본문(Content-Length=size)을 조립해 {'document':..,'report':..} 로 돌려준다.
    한 줄씩 해석하므로 600 MB 급 문서도 파이썬 문자열 하나로 만들지 않는다."""
    if size <= 0:
        raise StreamError('요청 본문이 비어 있습니다.')
    return assemble(_iter_stream_lines(stream, limit=size))


def save_request_stream(stream, size, target, compresslevel=1):
    """대용량 복구용: 요청 본문 줄을 해석·검증하면서 그대로 gzip NDJSON 파일로 저장한다(메모리에 문서를 올리지 않는다)."""
    target = os.fspath(target)
    temp = target + '.' + uuid.uuid4().hex + '.tmp'
    lines = 0
    total = 0
    header = None
    end = None
    try:
        with open(temp, 'wb') as raw:
            out = PipelinedGzip(raw, compresslevel)
            try:
                for line in _iter_stream_lines(stream, limit=size):
                    check_line(line)
                    if line.startswith(b'{"kind":"header"'):
                        header = json.loads(line)
                    elif line.startswith(b'{"kind":"end"'):
                        end = json.loads(line)
                    if end is None:
                        lines += 1
                        total += len(line) + 1
                    out.write(line + b'\n')
            finally:
                out.close()
            raw.flush()
            os.fsync(raw.fileno())
        if header is None or end is None or end.get('lines') != lines or end.get('bytes') != total:
            raise StreamError('전송된 도면 자료가 불완전해 복구본으로 저장하지 않았습니다.')
        os.replace(temp, target)
    finally:
        try:
            os.unlink(temp)
        except OSError:
            pass
    return {'lines': lines, 'bytes': total, 'header': header, 'end': end}
