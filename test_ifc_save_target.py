"""A9(10-20 K24): 3D 화면 'IFC 저장' 이 셸·엔진 저장 형식 목록에 .ifc 가 없어 '저장 형식 또는 크기 오류' 로 실패했다."""
import re,tempfile,unittest
from pathlib import Path
import server

class IfcSaveTargetTest(unittest.TestCase):
    def test_engine_accepts_ifc_target(self):
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'model.ifc'
            self.assertEqual(server.validate_save_path(str(target),'ifc'),target)
            with self.assertRaises(ValueError):server.validate_save_path(str(Path(folder)/'model.dxf'),'ifc')
    def test_shell_save_file_accepts_ifc_name(self):
        source=(Path(__file__).parent/'desktop.cjs').read_text('utf8')
        pattern=re.search(r"!/(\^\.\+\\\.\([a-z|]+\)\$)/i\.test\(payload\.name\)\)throw Error\('저장 형식 또는 크기 오류'\)",source)
        self.assertIsNotNone(pattern)
        self.assertRegex('바른CAD.ifc',re.compile(pattern.group(1).replace('\\.','\\.'),re.I))

if __name__=='__main__':unittest.main()
