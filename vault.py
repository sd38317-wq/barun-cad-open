"""배포본에 싣는 자료를 그대로 읽히지 않게 한 덩어리로 묶는다.

BCV2: AES-256-GCM 인증 암호화. 한 바이트라도 바뀐 묶음은 풀리지 않는다(위변조 검출).
BCV1(예전 SHA-256 키스트림, 인증 없음)은 읽기만 한다. 새 묶음은 늘 BCV2 로 만든다.

정직하게 말해 둘 것: 기본 열쇠(KEY)는 프로그램 안에 같이 들어 있으므로 작정한 사람은 결국 풀 수 있다.
목적은 설치 폴더를 열어 본 사람이 메모장으로 바로 읽어 가거나 몰래 고쳐 넣는 것을 막는 데 있다.
핵심 자산(pro.pack: 지식·레이어 정리·법규 검사, 동봉 리습·미리보기 묶음)은 기본 열쇠가 아니라 서버 열쇠(key=…)로 잠근다 — vault_gate.py.
기본 열쇠 묶음은 로그인 없이 쓰는 레이어 세트(layer-standards.pack)뿐이다.
"""
import hashlib
import os
import secrets
import zlib
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

MAGIC = b'BCV2'
LEGACY_MAGIC = b'BCV1'
# 공개판에는 실제 열쇠가 없다. 공식 빌드는 BARUN_VAULT_KEY(64자리 hex)를 넣어 만든다.
KEY = bytes.fromhex(os.environ.get('BARUN_VAULT_KEY', '00' * 32))
NONCE = 12
MAX_BODY = 512 * 1024 * 1024


INFO = b'Barun CAD vault BCV2 AES-256-GCM'
PRO_INFO = b'Barun CAD pro vault BCV2 AES-256-GCM'


def _aead_key(key=KEY, info=INFO):
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=info).derive(key)


_AEAD = AESGCM(_aead_key())


def _aead(key):
    """key 가 없으면 기본 열쇠, 있으면 서버 열쇠(32바이트)로 pro 묶음을 연다."""
    if key is None:
        return _AEAD
    if len(key) != 32:
        raise ValueError('열쇠 길이가 올바르지 않습니다.')
    return AESGCM(_aead_key(bytes(key), PRO_INFO))


def _stream(length, salt):
    out = bytearray()
    counter = 0
    while len(out) < length:
        out += hashlib.sha256(KEY + salt + counter.to_bytes(8, 'big')).digest()
        counter += 1
    return bytes(out[:length])


def _mask(data, salt):
    if not data:
        return b''
    stream = _stream(len(data), salt)
    return (int.from_bytes(data, 'big') ^ int.from_bytes(stream, 'big')).to_bytes(len(data), 'big')


def _inflate(data):
    inflater = zlib.decompressobj()
    body = inflater.decompress(data, MAX_BODY)
    if inflater.unconsumed_tail or not inflater.eof:
        raise ValueError('묶음이 손상되었거나 너무 큽니다.')
    return body


def _valid_name(name):
    if not isinstance(name, str) or not name or '\\' in name or name.startswith('/') or ':' in name:
        return False
    parts = name.split('/')
    return all(part not in ('', '.', '..') for part in parts)


def pack(files, key=None):
    """{이름: 바이트} 를 묶음 한 덩어리로. key 를 주면 그 열쇠(서버 열쇠)로 잠근다."""
    body = bytearray()
    for name in sorted(files):
        if not _valid_name(name):
            raise ValueError('묶음 파일 이름이 올바르지 않습니다.')
        raw = files[name]
        encoded = name.encode('utf8')
        body += len(encoded).to_bytes(2, 'big') + encoded + len(raw).to_bytes(4, 'big') + raw
    nonce = secrets.token_bytes(NONCE)
    return MAGIC + nonce + _aead(key).encrypt(nonce, zlib.compress(bytes(body), 9), MAGIC)


def unpack(blob, key=None):
    """묶음 한 덩어리를 {이름: 바이트} 로. 위변조됐거나 열쇠가 틀리면 ValueError."""
    blob = bytes(blob)
    try:
        if blob[:4] == MAGIC and len(blob) >= 4 + NONCE + 16:
            body = _inflate(_aead(key).decrypt(blob[4:4 + NONCE], blob[4 + NONCE:], MAGIC))
        elif key is None and blob[:4] == LEGACY_MAGIC and len(blob) >= 12:
            body = _inflate(_mask(blob[12:], blob[4:12]))
        else:
            raise ValueError('묶음 형식이 아닙니다.')
    except ValueError:
        raise
    except Exception as error:
        raise ValueError('묶음이 손상되었거나 변조되었습니다.') from error
    files = {}
    at = 0
    while at < len(body):
        if at + 2 > len(body):
            raise ValueError('묶음 목록이 손상되었습니다.')
        size = int.from_bytes(body[at:at + 2], 'big')
        at += 2
        if at + size + 4 > len(body):
            raise ValueError('묶음 목록이 손상되었습니다.')
        name = body[at:at + size].decode('utf8')
        at += size
        size = int.from_bytes(body[at:at + 4], 'big')
        at += 4
        if at + size > len(body) or not _valid_name(name):
            raise ValueError('묶음 목록이 손상되었습니다.')
        files[name] = bytes(body[at:at + size])
        at += size
    return files


def pack_folder(folder, pattern='*', key=None):
    folder = Path(folder)
    return pack({p.name: p.read_bytes() for p in sorted(folder.glob(pattern)) if p.is_file()}, key)

