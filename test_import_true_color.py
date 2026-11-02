"""DXF 420(true color) 위 8비트(투명도)가 실린 음수 값도 #rrggbb 로 읽는다(netDxf 가 쓴 BUILDIT 샘플 도면)."""
import io,re,unittest
import ezdxf
from pathlib import Path
import tempfile

class TrueColorImportTest(unittest.TestCase):
    def test_negative_true_color_becomes_valid_hex(self):
        import exchange
        doc=ezdxf.new('R2007');msp=doc.modelspace()
        line=msp.add_line((0,0),(1000,0));line.dxf.true_color=-0x3e000000+0x123456   # 0xC2123456 를 부호 있는 정수로
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'tc.dxf';doc.saveas(path)
            result=exchange.import_file(path.read_bytes(),'.dxf')
        colors=[e.get('color') for e in result['document']['entities'] if e.get('type')=='line']
        self.assertTrue(colors and all(re.fullmatch(r'#[0-9a-f]{6}',c) for c in colors),colors)
        self.assertEqual(colors[0],'#123456')

if __name__=='__main__':unittest.main()
