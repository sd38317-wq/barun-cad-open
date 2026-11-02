"""Safe local raster access for IMAGE entities."""
from pathlib import Path
import mimetypes
import base64
from io import BytesIO

ALLOWED_EXTENSIONS = frozenset({'.jpg', '.jpeg', '.png', '.bmp'})
MAX_BYTES = 50 * 1024 * 1024
MAX_PIXELS = 25_000_000

def _office_network_only(text):
    r"""검토 B7: 링크·연결 드라이브가 \\바깥주소\공유 로 풀리면 거절(열면 윈도우 로그인 정보가 나감). 사무실 NAS(사설·Tailscale IP, 점 없는 이름)는 허락.
    shortcut: fix/audit-7024 의 project.network_path 와 같은 규칙을 따로 둠(두 가지를 합친 뒤 그것 하나로)."""
    if not text.startswith(('\\\\', '//')):
        return
    import ipaddress, re
    host = re.split(r'[\\/]', text[2:], maxsplit=1)[0]
    try:
        ip = ipaddress.ip_address(host)
        office = ip.is_private or ip in ipaddress.ip_network('100.64.0.0/10')
    except ValueError:
        office = bool(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,62}', host))
    if not office:
        raise ValueError('바깥 네트워크 주소의 공유 폴더 이미지는 쓸 수 없습니다.')

def validate_image_path(value, *, max_bytes=MAX_BYTES):
    if not isinstance(value, str) or not value.strip() or '\x00' in value:
        raise ValueError('이미지 경로가 올바르지 않습니다.')
    if value.startswith(('\\\\','//')) or ':' in value[2:]:
        raise ValueError('UNC·장치·대체 데이터 스트림 경로는 사용할 수 없습니다.')
    raw_parts = value.replace('\\','/').split('/')
    if '..' in raw_parts:
        raise ValueError('경로 우회는 사용할 수 없습니다.')
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise ValueError('이미지 경로는 절대 경로여야 합니다.')
    try:
        resolved = path.resolve(strict=True)
    except (FileNotFoundError, OSError):
        raise ValueError('이미지 파일을 찾을 수 없습니다.')
    _office_network_only(str(resolved))
    if path.suffix.lower() != resolved.suffix.lower() or resolved.suffix.lower() not in ALLOWED_EXTENSIONS or not resolved.is_file():
        raise ValueError('jpg, png, bmp 이미지 파일만 사용할 수 있습니다.')
    try:
        size = resolved.stat().st_size
    except OSError:
        raise ValueError('이미지 파일을 읽을 수 없습니다.')
    if size <= 0 or size > max_bytes:
        raise ValueError('이미지 파일 크기는 50MB 이하이어야 합니다.')
    return resolved

def image_bytes(value):
    path = validate_image_path(value)
    with path.open('rb') as stream:
        content = stream.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise ValueError('이미지 파일 크기는 50MB 이하이어야 합니다.')
    try:
        from PIL import Image
        with Image.open(BytesIO(content)) as image:
            image.verify()
            if image.format not in ('JPEG','PNG','BMP'):
                raise ValueError('jpg, png, bmp 이미지 파일만 사용할 수 있습니다.')
            if image.width * image.height > MAX_PIXELS:
                raise ValueError('이미지 해상도가 너무 큽니다.')
    except ValueError:
        raise
    except Exception as error:
        raise ValueError('이미지 형식을 읽을 수 없습니다.') from error
    return content, mimetypes.guess_type(path.name)[0] or 'application/octet-stream'

def image_read(value):
    content, mime = image_bytes(value)
    try:
        from PIL import Image
        with Image.open(BytesIO(content)) as image:
            image.verify()
        with Image.open(BytesIO(content)) as image:
            width, height = image.size
            if width <= 0 or height <= 0 or width * height > MAX_PIXELS:
                raise ValueError('이미지 해상도가 너무 큽니다.')
            if image.format not in ('JPEG','PNG','BMP'):
                raise ValueError('jpg, png, bmp 이미지 파일만 사용할 수 있습니다.')
    except Exception as error:
        raise ValueError('이미지 형식을 읽을 수 없습니다.') from error
    return {'data':'data:%s;base64,%s' % (mime, base64.b64encode(content).decode('ascii')),
            'pixelWidth':width,'pixelHeight':height,'path':str(validate_image_path(value))}
