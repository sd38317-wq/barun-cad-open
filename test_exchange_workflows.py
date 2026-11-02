import unittest,io,json,base64,zipfile,tempfile
from pathlib import Path
FIXTURES = Path(__file__).resolve().parent / 'test-fixtures' / 'exchange'
OUT = Path(tempfile.mkdtemp(prefix='barun-cad-exchange-'))   # 검사 산출물은 소스 트리(examples)가 아니라 임시 폴더에 쓴다
import ezdxf,shapefile
from pyproj import CRS
import exchange,excel_service,gis_service,region_service
from pdf_service import render
from pypdf import PdfReader

class WorkflowsTest(unittest.TestCase):
 def test_xlsx_roundtrip_and_formulas(self):
    payload=json.loads((FIXTURES / 'workflows-table.json').read_text(encoding='utf8'));result=excel_service.process(payload);raw=base64.b64decode(result['data']);rows=excel_service.read_xlsx(raw)['rows'];self.assertEqual(rows[9][1],42);self.assertEqual(rows[0][0],'항목');(OUT/'거푸집_산출.xlsx').write_bytes(raw)
    payload['rows'][1][1]=20;payload.pop('preview',None);changed=excel_service.process(payload);self.assertAlmostEqual(excel_service.read_xlsx(base64.b64decode(changed['data']))['rows'][9][1],81.375)
 def test_sheets_dxf_pdf_and_lower_versions(self):
    doc=json.loads(Path('examples/전체업무_예제.bcad').read_text(encoding='utf8'))
    raw,warnings=exchange.export_dxf(doc);(OUT/'전체업무_예제.dxf').write_bytes(raw)
    self.assertEqual(len(exchange.import_file(raw,'.dxf')['document']['entities']),len(doc['entities']))
    low,_=exchange.export_dxf(doc,'R2010');(OUT/'전체업무_R2010.dxf').write_bytes(low)
    with tempfile.NamedTemporaryFile(suffix='.dxf',delete=False) as f:f.write(low);name=f.name
    try:self.assertEqual(ezdxf.readfile(name).dxfversion,'AC1024')
    finally:Path(name).unlink()
    pdf=render(json.loads((FIXTURES / 'workflows-job.json').read_text(encoding='utf8')));(OUT/'전체업무_도곽.pdf').write_bytes(pdf);reader=PdfReader(io.BytesIO(pdf));self.assertEqual(len(reader.pages),3);self.assertIn('구조 제도',reader.pages[2].extract_text())
 def test_native_attributes_survive_without_metadata(self):
    doc=json.loads(Path('examples/전체업무_예제.bcad').read_text(encoding='utf8'));raw,_=exchange.export_dxf(doc)
    with tempfile.TemporaryDirectory() as td:
      p=Path(td)/'a.dxf';p.write_bytes(raw);d=ezdxf.readfile(p);del d.rootdict['BARUN_CAD_V2'];d.saveas(p);result=exchange.import_file(p.read_bytes(),'.dxf')['document'];self.assertTrue(any(e.get('attributes',{}).get('mark')=='COLUMN' for e in result['entities']))
 def test_native_block_references_use_shared_document_version(self):
    self.assertEqual(exchange.imported_document_version({'ROOM':{'origin':{'x':0,'y':0},'entities':[]}}),3)
    self.assertEqual(exchange.imported_document_version({}),2)
 def test_curve_simplification_keeps_tolerance_endpoints_and_spikes(self):
    import math
    arc=[(10*math.cos(t/50),10*math.sin(t/50),0) for t in range(300)]
    out=exchange.simplify_polyline(arc,.05);self.assertLess(len(out),len(arc)//3);self.assertEqual((out[0],out[-1]),(arc[0],arc[-1]))
    loop=arc[:100]+[arc[0]];out=exchange.simplify_polyline(loop,.05);self.assertEqual((out[0],out[-1]),(loop[0],loop[-1]))
    spike=[(0,0,0),(10,0,0),(-5,0,0)];self.assertEqual(exchange.simplify_polyline(spike,.05),spike)   # doubles back on the chord: must stay
    self.assertEqual(len(exchange.simplify_polyline([(0,0,0),(1,0,0)],5)),2)
    from ezdxf.entities import Spline
    from ezdxf import path as dxfpath
    spline=Spline.new(dxfattribs={'degree':3});spline.fit_points=[(0,0,0),(30,10,0),(60,-10,0),(90,0,0)]
    curve=dxfpath.make_path(spline);dense=list(curve.flattening(.001))
    ps=exchange.flatten_curve_path(curve,.1);self.assertLess(len(ps),len(list(curve.flattening(.1))))
    for x,y,_ in dense:
        self.assertLess(min(math.dist((x,y),(px,py)) for px,py,_ in ps) if len(ps)<3 else min(
            abs((qx-px)*(py-y)-(px-x)*(qy-py))/max(math.dist((px,py),(qx,qy)),1e-12) if 0<=((x-px)*(qx-px)+(y-py)*(qy-py))<=math.dist((px,py),(qx,qy))**2 else min(math.dist((x,y),(px,py)),math.dist((x,y),(qx,qy)))
            for (px,py,_),(qx,qy,_) in zip(ps,ps[1:])),.1)
 def test_shp_projected_coordinate_and_attributes(self):
    shp,shx,dbf=io.BytesIO(),io.BytesIO(),io.BytesIO();w=shapefile.Writer(shp=shp,shx=shx,dbf=dbf);w.field('name','C');w.poly([[[200000,500000],[200010,500000],[200010,500010],[200000,500000]]]);w.record('SITE');w.close();zbytes=io.BytesIO()
    with zipfile.ZipFile(zbytes,'w')as z:
      for ext,data in [('shp',shp.getvalue()),('shx',shx.getvalue()),('dbf',dbf.getvalue()),('prj',CRS.from_epsg(5186).to_wkt().encode())]:z.writestr('site.'+ext,data)
    result=gis_service.process({'data':base64.b64encode(zbytes.getvalue()).decode(),'targetCRS':'EPSG:5186','originX':200000,'originY':500000});self.assertEqual(result['entities'][0]['points'][1]['x'],10000);self.assertEqual(result['entities'][0]['attributes']['name'],'SITE')
 def test_hatch_union_removes_double_count(self):
    rect=lambda x:{'points':[{'x':x,'y':0},{'x':x+10,'y':0},{'x':x+10,'y':10},{'x':x,'y':10}]}
    result=region_service.process({'regions':[rect(0),rect(5)]});self.assertEqual(result['area'],150);self.assertEqual(len(result['regions']),1)

if __name__=='__main__':unittest.main(verbosity=2)
