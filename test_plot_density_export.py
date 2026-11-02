"""출력 농도(H24)는 DXF 에서 객체 투명도로 나간다. 농도 없는 객체는 투명도를 붙이지 않는다."""
import os,tempfile,unittest
import ezdxf
from ezdxf import colors
import exchange

def model():
    return {'version':2,'units':'mm','linetypeScale':1,'blocks':[],
        'layers':[{'id':'L0','name':'0','color':'#ffffff','visible':True,'locked':False}],
        'entities':[{'id':'a','type':'line','layer':'L0','plotDensity':60,'points':[{'x':0,'y':0},{'x':1000,'y':0}]},
                    {'id':'b','type':'line','layer':'L0','points':[{'x':0,'y':100},{'x':1000,'y':100}]},
                    {'id':'c','type':'line','layer':'L0','plotDensity':None,'points':[{'x':0,'y':200},{'x':1000,'y':200}]}]}

class PlotDensityExportTests(unittest.TestCase):
    def test_density_becomes_transparency(self):
        raw,_=exchange.export_dxf(model())
        handle=tempfile.NamedTemporaryFile(suffix='.dxf',delete=False);handle.write(raw);handle.close()
        try:doc=ezdxf.readfile(handle.name)
        finally:os.unlink(handle.name)
        lines=sorted((e for e in doc.modelspace() if e.dxftype()=='LINE'),key=lambda e:e.dxf.start.y)
        self.assertAlmostEqual(colors.transparency2float(lines[0].dxf.transparency),0.4,places=2)
        self.assertFalse(lines[1].dxf.hasattr('transparency'))
        self.assertFalse(lines[2].dxf.hasattr('transparency'))

if __name__=='__main__':unittest.main()
