# -*- coding: utf-8 -*-
"""2026-10-30 exchange._compiled_dxf_tags 가 ezdxf 의 tag_compiler(ascii_tags_loader(...)) 와 같은 태그 열을 만드는지,
_readfile 이 ezdxf.readfile 과 같은 문서를 주는지 본다. BARUN_FAST_DXF_EXTRA 에 경로(os.pathsep 구분)를 주면 큰 실제 도면도 맞춰 본다."""
import io, os
from pathlib import Path
import pytest
import ezdxf
from ezdxf.lldxf.tagger import ascii_tags_loader, tag_compiler
from ezdxf.lldxf.types import DXFVertex
from ezdxf.filemanagement import dxf_file_info
import exchange

ROOT = Path(__file__).resolve().parent
FILES = sorted(p for p in ROOT.glob('**/*.dxf') if 'node_modules' not in p.parts and '.claude' not in p.parts) + \
    [Path(p) for p in os.environ.get('BARUN_FAST_DXF_EXTRA', '').split(os.pathsep) if p]

def key(tag):
    value = tuple(tag.value) if isinstance(tag, DXFVertex) else tag.value
    return type(tag), tag.code, type(value), value

def stock(text):
    try: return [key(t) for t in tag_compiler(ascii_tags_loader(io.StringIO(text)))]
    except ezdxf.DXFStructureError: return 'error'

def fast(text, chunk=1 << 24):
    try: return [key(t) for t in exchange._compiled_dxf_tags(io.StringIO(text), chunk)]
    except ezdxf.DXFStructureError: return 'error'

EDGE = [
    '0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n1\n20\n2\n30\n3\n11\n4\n21\n5\n31\n6\n0\nENDSEC\n0\nEOF\n',
    '0\nLINE\n10\n1.5\n20\n2\n62\n7\n0\nEOF\n',            # 2D 점 뒤 태그 되돌림
    '  0\nLINE\n999\ncomment\n 10\n1\n999\nx\n 20\n2\n 30\n3\n  0\nEOF\n',  # 주석은 건너뜀(점 사이도)
    '0\nLINE\n10\n1\n20\n2\n0\nEOF\n',                     # 2D 점 뒤가 EOF
    '0\nLINE\n10\n1\n20\n2',                               # z 를 기다리다 끝
    '0\nLINE\n10\n1',                                      # y 없이 끝
    '0\nLINE\n62\n7.0\n70\n1e2\n0\nEOF\n',                 # 정수 자리 실수
    '0\nLINE\n62\nabc\n0\nEOF\n',                          # 틀린 정수
    '0\nLINE\n40\nabc\n0\nEOF\n',                          # 틀린 실수
    '0\nLINE\n10\n1\n30\n2\n0\nEOF\n',                     # y 빠진 점
    'x\nLINE\n',                                           # 틀린 코드
    '0\nEOF\n0\nLINE\n',                                   # EOF 뒤는 읽지 않음
    '0\n  SECTION  \n1\n  text  \n0\nEOF',                 # 코드 0 은 공백 정리, 나머지 값은 그대로
    '0\nLINE\n310\n0A0B\n310\nzz\n0\nEOF\n',               # 이진(틀린 16진)
    '0\nLINE\n310\n0A0B\n1004\nFF\n0\nEOF\n',
    '0\nLINE\n1\n\n2\n\n0\nEOF\n\n\n',                     # 빈 값·끝 빈 줄
    '0\nLINE\n8\n',                                        # 값 없는 코드
    '',
    '0\nLINE\n8\n0\n8\n0\n62\n1\n62\n1\n0\nEOF\n',         # 같이 쓰는 태그
]

@pytest.mark.parametrize('text', EDGE)
@pytest.mark.parametrize('chunk', [1, 3, 7, 1 << 24])
def test_edge_cases_match_ezdxf(text, chunk):
    expected = stock(text)
    got = fast(text, chunk)
    # 더 엄격한 쪽(오류)은 _readfile 이 ezdxf.readfile 로 다시 읽으니 괜찮다. 오류가 아니면 똑같아야 한다.
    assert got == expected or got == 'error'
    if expected == 'error': assert got == 'error'

@pytest.mark.parametrize('path', FILES, ids=lambda p: p.name)
def test_drawings_match_ezdxf(path):
    if not path.is_file(): pytest.skip('없는 파일')
    if ezdxf.lldxf.validator.is_binary_dxf_file(str(path)): pytest.skip('이진 DXF 는 ezdxf 그대로')
    encoding = dxf_file_info(str(path)).encoding
    with open(path, 'rt', encoding=encoding, errors='surrogateescape') as fp: a = [key(t) for t in tag_compiler(ascii_tags_loader(fp))]
    with open(path, 'rt', encoding=encoding, errors='surrogateescape') as fp: b = [key(t) for t in exchange._compiled_dxf_tags(fp, 1 << 16)]
    assert a == b
    stock_doc = ezdxf.readfile(path); fast_doc = exchange._readfile(path)
    assert (fast_doc.dxfversion, fast_doc.encoding, fast_doc.filename) == (stock_doc.dxfversion, stock_doc.encoding, stock_doc.filename)
    assert [e.dxftype() for e in fast_doc.entitydb.values()] == [e.dxftype() for e in stock_doc.entitydb.values()]
    assert [(e.dxf.handle, sorted(e.dxf.all_existing_dxf_attribs().items(), key=str)) for e in fast_doc.modelspace()] == \
        [(e.dxf.handle, sorted(e.dxf.all_existing_dxf_attribs().items(), key=str)) for e in stock_doc.modelspace()]

def test_crlf_and_lone_cr_are_read_like_ezdxf(tmp_path):
    path = tmp_path / 'crlf.dxf'
    path.write_bytes(b'  0\r\nSECTION\r\n  2\r\nENTITIES\r\n  0\r\nLINE\r\n  8\r\n0\r\n 10\r\n1\r 20\r\n2\r\n 30\r\n0\r\n 11\r\n4\r\n 21\r\n5\r\n 31\r\n0\r\n  0\r\nENDSEC\r\n  0\r\nEOF\r\n')
    a = ezdxf.readfile(path); b = exchange._readfile(path)
    assert [(e.dxftype(), e.dxf.start, e.dxf.end) for e in a.modelspace()] == [(e.dxftype(), e.dxf.start, e.dxf.end) for e in b.modelspace()]

def test_structure_error_falls_back_to_ezdxf(tmp_path):
    path = tmp_path / 'bad.dxf'
    path.write_text('  0\nSECTION\n  2\nENTITIES\n  0\nLINE\n 62\nabc\n  0\nENDSEC\n  0\nEOF\n')
    with pytest.raises(ezdxf.DXFError): ezdxf.readfile(path)
    with pytest.raises(ezdxf.DXFError): exchange._readfile(path)
