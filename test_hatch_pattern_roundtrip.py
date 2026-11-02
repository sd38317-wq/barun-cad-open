"""해치 무늬 보존(2026-09-26): DWG/DXF 의 표준·사용자 무늬를 단선으로 바꾸지 않고 가져오고, 저장·PDF 에서도 같은 무늬 줄을 쓴다."""
import math,os,tempfile,unittest
import ezdxf
import exchange,hatch_patterns,pdf_service


def _dxf_with_hatch(path,name='ANSI31',scale=10,angle=30):
    doc=ezdxf.new('R2018',setup=True);doc.units=ezdxf.units.MM;doc.header['$INSUNITS']=4
    hatch=doc.modelspace().add_hatch(color=3)
    hatch.set_pattern_fill(name,color=3,angle=angle,scale=scale)
    hatch.paths.add_polyline_path([(0,0),(1000,0),(1000,800),(0,800)],is_closed=True)
    doc.saveas(path)
    return [(l.angle,tuple(l.base_point),tuple(l.offset),list(l.dash_length_items)) for l in hatch.pattern.lines]


def _read_back(raw):
    handle=tempfile.NamedTemporaryFile(suffix='.dxf',delete=False);handle.write(raw);handle.close()
    try:return ezdxf.readfile(handle.name)
    finally:os.unlink(handle.name)


class HatchPatternRoundtripTests(unittest.TestCase):
    def test_imported_pattern_is_kept_and_exported_with_the_same_lines(self):
        with tempfile.TemporaryDirectory() as folder:
            source=os.path.join(folder,'hatch.dxf')
            original=_dxf_with_hatch(source,'AR-CONC',scale=2,angle=15)
            doc=exchange.import_file_path(source,'.dxf')['document']
        hatch=next(e for e in doc['entities'] if e['type']=='hatch')
        self.assertEqual(hatch['patternName'],'AR-CONC')
        self.assertEqual(hatch['patternScale'],2)
        self.assertEqual(len(hatch['patternLines']),len(original))
        for got,(angle,base,offset,dashes) in zip(hatch['patternLines'],original):
            self.assertAlmostEqual(got['angle'],angle,6)
            self.assertAlmostEqual(got['offset']['x'],offset[0],6);self.assertAlmostEqual(got['offset']['y'],offset[1],6)
            self.assertEqual(len(got['dashes']),len(dashes))
        raw,warnings=exchange.export_dxf(doc)
        back=next(e for e in _read_back(raw).modelspace() if e.dxftype()=='HATCH')
        self.assertEqual(back.dxf.pattern_name,'AR-CONC')
        self.assertAlmostEqual(back.dxf.pattern_scale,2,6);self.assertAlmostEqual(back.dxf.pattern_angle,15,6)
        for line,(angle,base,offset,dashes) in zip(back.pattern.lines,original):
            self.assertAlmostEqual(line.angle,angle,5)
            self.assertAlmostEqual(line.offset[0],offset[0],5);self.assertAlmostEqual(line.offset[1],offset[1],5)
            for a,b in zip(line.dash_length_items,dashes):self.assertAlmostEqual(a,b,5)

    def test_legacy_barun_lines_still_roundtrip(self):
        model={'version':2,'units':'mm','linetypeScale':1,'blocks':[],'layers':[{'id':'L0','name':'0','color':'#ffffff','visible':True,'locked':False}],
               'entities':[{'id':'h','type':'hatch','layer':'L0','points':[{'x':0,'y':0},{'x':1000,'y':0},{'x':1000,'y':1000},{'x':0,'y':1000}],'spacing':200,'angle':45,'pattern':'cross','solid':False}]}
        back=next(e for e in _read_back(exchange.export_dxf(model)[0]).modelspace() if e.dxftype()=='HATCH')
        self.assertEqual(back.dxf.pattern_name,'BARUN_CROSS')
        self.assertEqual(len(back.pattern.lines),2)

    def test_python_segments_match_legacy_and_pattern_rules(self):
        legacy={'type':'hatch','spacing':100,'angle':0,'pattern':'cross'}
        segments,dots,dense=hatch_patterns.hatch_segments(hatch_patterns.hatch_families(legacy),(0,0,1000,1000))
        self.assertFalse(dense);self.assertEqual(len(segments),22)
        fine={'type':'hatch','patternLines':[{'angle':0,'base':{'x':0,'y':0},'offset':{'x':0,'y':0.001},'dashes':[]}]}
        self.assertTrue(hatch_patterns.hatch_segments(hatch_patterns.hatch_families(fine),(0,0,1000,1000),max_segments=1000)[2])

    def test_pdf_draws_pattern_hatch(self):
        entity={'id':'h','type':'hatch','layer':'L0','points':[{'x':0,'y':0},{'x':1000,'y':0},{'x':1000,'y':1000},{'x':0,'y':1000}],'solid':False,'color':'#00ff00',
                'patternName':'ANSI37','patternScale':20,'angle':0,
                'patternLines':[{'angle':45,'base':{'x':0,'y':0},'offset':{'x':-44.9,'y':44.9},'dashes':[]},{'angle':135,'base':{'x':0,'y':0},'offset':{'x':-44.9,'y':-44.9},'dashes':[]}]}
        data=pdf_service.render_plot({'size':[297,210],'margin':5,'denominator':100,'bounds':{'minX':0,'minY':0,'maxX':1000,'maxY':1000},'entities':[entity]})
        self.assertTrue(data.startswith(b'%PDF'))


if __name__=='__main__':unittest.main()
