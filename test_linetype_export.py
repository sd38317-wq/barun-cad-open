"""DXF 저장 때 선종류가 빠지지 않는다(2026-09-26 수정: ezdxf 기본 도면에 HIDDEN·BORDER 계열이 없어 조용히 실선이 됐다)."""
import os,tempfile,unittest
import ezdxf
import exchange

def model():
    return {'version':2,'units':'mm','linetypeScale':1,'blocks':[],
        'layers':[{'id':'L0','name':'0','color':'#ffffff','visible':True,'locked':False,'linetype':'CONTINUOUS'},
                  {'id':'LH','name':'A-HIDDEN','color':'#ffff00','visible':True,'locked':False,'linetype':'HIDDEN'}],
        'entities':[{'id':'a','type':'line','layer':'LH','points':[{'x':0,'y':0},{'x':1000,'y':0}]},
                    {'id':'b','type':'line','layer':'L0','linetype':'BORDER2','points':[{'x':0,'y':100},{'x':1000,'y':100}]},
                    {'id':'c','type':'line','layer':'L0','linetype':'DASHDOT','points':[{'x':0,'y':200},{'x':1000,'y':200}]},
                    {'id':'d','type':'line','layer':'L0','linetype':'NOT_A_REAL_TYPE','points':[{'x':0,'y':300},{'x':1000,'y':300}]}]}

class LinetypeExportTests(unittest.TestCase):
    def test_layer_and_entity_linetypes_survive_dxf_export(self):
        raw,warnings=exchange.export_dxf(model())
        handle=tempfile.NamedTemporaryFile(suffix='.dxf',delete=False);handle.write(raw);handle.close()
        try:doc=ezdxf.readfile(handle.name)
        finally:os.unlink(handle.name)
        self.assertEqual(doc.layers.get('A-HIDDEN').dxf.linetype.upper(),'HIDDEN')
        self.assertIn('HIDDEN',doc.linetypes);self.assertIn('BORDER2',doc.linetypes)
        types=[e.dxf.linetype.upper() for e in doc.modelspace() if e.dxftype()=='LINE']
        self.assertIn('BORDER2',types);self.assertIn('DASHDOT',types)
        self.assertNotIn('NOT_A_REAL_TYPE',types)
        self.assertTrue(any('NOT_A_REAL_TYPE' in w for w in warnings),warnings)

if __name__=='__main__':unittest.main()
