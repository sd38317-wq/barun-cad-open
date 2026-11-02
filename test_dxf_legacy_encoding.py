"""A11(10-20 K19): 코드페이지 표시 없는(또는 기본 ANSI_1252) UTF-8 R12 DXF 의 한글 이름이 깨지지 않는다."""
import io,re,unittest
import ezdxf
import exchange

def r12(text_codec='utf-8',codepage=None):
    d=ezdxf.new('R12');d.layers.add('글씨');d.modelspace().add_line((0,0),(10,0),dxfattribs={'layer':'글씨'})
    s=io.StringIO();d.write(s);t=s.getvalue()
    t=re.sub(r'  9\n\$DWGCODEPAGE\n  3\n\S+\n','' if codepage is None else f'  9\n$DWGCODEPAGE\n  3\n{codepage}\n',t)
    return t.encode(text_codec)

def layers(raw):return [l['name'] for l in exchange.import_file(raw,'.dxf')['document']['layers']]

class LegacyUtf8Test(unittest.TestCase):
    def test_utf8_without_codepage(self):self.assertIn('글씨',layers(r12()))
    def test_utf8_with_default_ansi_1252(self):self.assertIn('글씨',layers(r12(codepage='ANSI_1252')))
    def test_cp949_marked_file_still_reads_cp949(self):self.assertIn('글씨',layers(r12('cp949','ANSI_949')))
    def test_helper_leaves_ascii_and_cp949_alone(self):
        self.assertIsNone(exchange._legacy_utf8_encoding(b'0\nSECTION\n'))
        self.assertIsNone(exchange._legacy_utf8_encoding('글씨'.encode('cp949')))

if __name__=='__main__':unittest.main()
