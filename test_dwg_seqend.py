"""A21(10-20 K46): 속성 있는 블록(문·창 카드)이 하나라도 있으면 DWG 저장이 'Entity not implemented: Seqend' 로 실패했다."""
import io,unittest
import ezdxf
import exchange,batch_converter
from pathlib import Path
import tempfile

def door_model():
    layer={'id':'L','name':'A-DOOR','visible':True,'color':'#ffffff'}
    door={'id':'d','type':'block','name':'D1 간단문','category':'DOOR','layer':'L','position':{'x':0,'y':0},
          'attributes':{'mark':'D1 간단문','width':900,'height':2100},
          'entities':[{'type':'line','layer':'L','points':[{'x':0,'y':0},{'x':900,'y':0}]}]}
    return {'version':2,'units':'mm','blocks':[],'layers':[layer],'entities':[door]}

class SeqendOwnerTest(unittest.TestCase):
    def test_exported_seqend_belongs_to_its_insert(self):
        raw,_=exchange.export_dxf(door_model(),'R2018')
        doc=ezdxf.read(io.StringIO(raw.decode('utf8').replace('\r','')))
        inserts=[i for i in doc.modelspace().query('INSERT') if i.attribs]
        self.assertTrue(inserts)
        text=raw.decode('utf8').replace('\r','').split('\n')
        seqend_owners=[text[k+4].strip() for k,line in enumerate(text) if line=='SEQEND']
        self.assertTrue(set(i.dxf.handle for i in inserts)<=set(seqend_owners),seqend_owners)

    def test_door_drawing_saves_as_dwg(self):
        raw,_=exchange.export_dxf(door_model(),'R2018')
        try:dwg,report=batch_converter.dxf_to_dwg(raw,'2018')
        except ValueError as error:
            if '엔진 파일이 없습니다' in str(error):self.skipTest('DWG 엔진 없음')
            raise
        self.assertGreater(len(dwg),1000);self.assertEqual(report['lost'],0)

    def test_old_app_dxf_with_model_space_seqend_converts(self):
        # 이 수정 전에 저장한 DXF(SEQEND 주인=모형 공간)도 CONVERT 로 DWG 가 된다.
        raw,_=exchange.export_dxf(door_model(),'R2018')
        doc=ezdxf.read(io.StringIO(raw.decode('utf8').replace('\r','')))
        for insert in doc.modelspace().query('INSERT'):
            if insert.seqend is not None:insert.seqend.dxf.owner=insert.dxf.owner
        with tempfile.TemporaryDirectory() as folder:
            source=Path(folder)/'old.dxf';doc.saveas(source);out=Path(folder)/'out';out.mkdir()
            result=batch_converter.process({'action':'convert','name':source.name,'direction':'dxf-dwg','version':'2018','folder':str(out),'_source_path':str(source)})
            if result.get('code')=='ENGINE_MISSING':self.skipTest('DWG 엔진 없음')
            self.assertFalse(result.get('failed'),result)

if __name__=='__main__':unittest.main()
