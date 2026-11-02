"""225: 다른 프로그램이 저장한 도면 알림(AutoCAD DWGCHECK 대응)과 R2018 기본 형식."""
import ezdxf

import exchange


def test_saved_by_info_names_foreign_producer():
    info = exchange.saved_by_info('AC1032', {'$LASTSAVEDBY': 'kim'}, ['ACAD', 'BRICSYS_BricsCAD'])
    assert info['producer'] == 'BricsCAD'
    assert info['release'] == 'R2018'
    assert info['lastSavedBy'] == 'kim'
    notice = exchange.saved_by_notice(info, kept=3, skipped=2)
    assert 'BricsCAD' in notice and '원본 보존 3개' in notice and '미지원 2개' in notice and 'R2018' in notice


def test_saved_by_notice_silent_for_autocad_and_barun():
    assert exchange.saved_by_notice(exchange.saved_by_info('AC1032', {}, ['ACAD', 'AcAecLayerStandard'])) is None
    assert exchange.saved_by_notice(exchange.saved_by_info('AC1027', {}, ['ACAD', 'BARUN_CAD'])) is None
    assert exchange.saved_by_info('AC1015', {}, [])['release'] == 'R2000'


def test_import_reports_saved_by_for_ezdxf_file(tmp_path):
    doc = ezdxf.new('R2018')
    doc.appids.add('BRICSCAD_DATA')
    doc.modelspace().add_line((0, 0), (1000, 0))
    path = tmp_path / 'foreign.dxf'
    doc.saveas(path)
    info = exchange.import_file_path(str(path), '.dxf')['report']
    assert info['savedBy']['producer'] == 'BricsCAD'
    assert info['savedBy']['release'] == 'R2018'
    assert any('다른 프로그램(BricsCAD)' in w for w in info['warnings'])


def test_barun_own_dxf_is_not_foreign(tmp_path):
    doc = ezdxf.new('R2018')
    doc.modelspace().add_line((0, 0), (1000, 0))
    path = tmp_path / 'own.dxf'
    doc.saveas(path)
    info = exchange.import_file_path(str(path), '.dxf')['report']
    assert info['savedBy']['lastSavedBy'] == 'ezdxf'
    assert info['savedBy']['producer'] == ''
    assert not any('다른 프로그램' in w for w in info['warnings'])
    assert exchange.saved_by_info('AC1032', {}, ['BRICSCAD'], ['BARUN_CAD_V2'])['producer'] == '바른 CAD'
