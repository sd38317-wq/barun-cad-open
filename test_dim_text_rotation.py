"""가져온 세로 치수 글자 방향(10/23): DXF 53=0 은 '기본 방향'이라 치수선 따라 세우고, DIMTIH·DIMTOH=1 스타일만 가로로 눕힌다."""
import io,unittest,ezdxf
import exchange

def imported(tih):
    doc=ezdxf.new();st=doc.dimstyles.new('T');st.dxf.dimtih=tih;st.dxf.dimtoh=tih
    d=doc.modelspace().add_linear_dim(base=(500,0),p1=(0,0),p2=(0,3000),angle=90,dimstyle='T');d.render()
    d.dimension.dxf.text_rotation=0
    s=io.StringIO();doc.write(s)
    r=exchange.import_file(s.getvalue().encode(),'.dxf');r=r[0] if isinstance(r,tuple) else r
    return [e for e in r.get('document',r)['entities'] if e.get('type')=='dimension'][0]

class DimTextRotation(unittest.TestCase):
    def test_zero_rotation_keeps_default_aligned(self):self.assertNotIn('textRotation',imported(0))
    def test_horizontal_style_forces_horizontal(self):self.assertEqual(imported(1).get('textRotation'),0.0)

if __name__=='__main__':unittest.main()
