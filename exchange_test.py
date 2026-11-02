import base64, copy, io, json, math, tempfile, unittest, zlib
from pathlib import Path
import ezdxf
import exchange

def model():
    p=lambda x,y:{'x':x,'y':y}
    es=[{'type':'line','points':[p(0,0),p(6000,0)]}, {'type':'circle','center':p(1000,1000),'radius':500}, {'type':'arc','center':p(3000,2000),'radius':900,'startAngle':0,'endAngle':90}, {'type':'text','position':p(100,200),'text':'거실 COPY C','height':150,'rotation':0}, {'type':'text','position':p(100,500),'text':'첫 줄\n둘째 줄','height':150,'rotation':0}, {'type':'hatch','points':[p(0,0),p(1000,0),p(1000,1000),p(0,1000)],'loops':[[p(200,200),p(400,200),p(400,400),p(200,400)]],'spacing':100,'angle':45,'solid':False}, {'type':'dimension','points':[p(0,0),p(6000,0),p(0,-500)],'mode':'horizontal','textHeight':150}, {'type':'dimension','points':[p(0,0),p(3000,4000),p(-500,100)],'mode':'aligned','textHeight':150}, {'type':'dimension','points':[p(1000,1000),p(1500,1000),p(2000,1000)],'mode':'radius','textHeight':150}, {'type':'dimension','points':[p(1000,1000),p(1500,1000),p(2000,1000)],'mode':'diameter','textHeight':150}, {'type':'wall','points':[p(0,5000),p(6000,5000)],'thickness':200,'openings':[[.3,.5]]}]
    for i,e in enumerate(es):e.update(id=str(i),layer='default')
    return {'version':2,'units':'mm','layers':[{'id':'default','name':'건축','color':'#79d4ff','visible':True,'locked':False,'lineweight':.25,'linetype':'CONTINUOUS'}],'blocks':[],'entities':es}

def standard_bytes(doc):
    stream=io.StringIO();doc.write(stream);return stream.getvalue().encode('utf8')


def table_sample(doc,geometry='*T1',scale=(1,1),cached=True):
    from ezdxf.entities import factory
    from ezdxf.lldxf.extendedtags import ExtendedTags
    if cached:
        block=doc.blocks.new(geometry)
        for a,b in (((0,0),(40,0)),((40,0),(40,-20)),((40,-20),(0,-20)),((0,-20),(0,0)),((20,0),(20,-20))):block.add_line(a,b)
        block.add_text('Cell',dxfattribs={'insert':(2,-5),'height':3})
        block.add_mtext('two\\Prows',dxfattribs={'insert':(22,-5),'char_height':3})
        block.add_solid([(0,0),(40,0),(0,-20),(40,-20)])  # cell background is not imported
    raw=f'0\nACAD_TABLE\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockReference\n2\n{geometry}\n10\n100\n20\n200\n30\n0\n41\n{scale[0]}\n42\n{scale[1]}\n100\nAcDbTable\n11\n0\n21\n1\n31\n0\n91\n1\n92\n2\n141\n20\n142\n20\n142\n20\n171\n1\n1\nLeft\n171\n1\n1\nRight\n'
    table=factory.load(ExtendedTags.from_text(raw),doc=doc);doc.modelspace().add_entity(table)
    return table


def region_sample(doc,holes=False):
    from ezdxf.acis.api import body_from_mesh, export_dxf
    from ezdxf.acis.entities import NONE_REF
    from ezdxf.render import MeshBuilder
    mesh=MeshBuilder();mesh.add_face([(10,20,0),(50,20,0),(50,60,0),(10,60,0)])
    if holes:mesh.add_face([(20,30,0),(20,40,0),(30,40,0),(30,30,0)])
    body=body_from_mesh(mesh)
    if holes:
        outer=body.lump;inner=outer.next_lump
        outer.shell.face.append_loop(inner.shell.face.loop);outer.next_lump=NONE_REF
    region=doc.modelspace().add_region();export_dxf(region,[body])
    return region,body

class ExchangeTest(unittest.TestCase):
    def test_meter_dxf_with_foreign_xdata_refuses_instead_of_dropping(self):
        # 검토 A7: mm 가 아닌 도면은 보존 없이 다시 쓰므로, 다른 프로그램의 XDATA 가 있으면 조용히 버리지 않고 멈춘다(ACAD 자체 XDATA 는 통과).
        def meter(app):
            doc=ezdxf.new('R2018');doc.units=6;line=doc.modelspace().add_line((0,0),(10,0))
            if app:
                if app not in doc.appids:doc.appids.new(app)
                line.set_xdata(app,[(1000,'keep me')])
            return exchange.import_file(standard_bytes(doc),'.dxf')['document']
        with self.assertRaisesRegex(ValueError,'확장 자료'):exchange.export_dxf(meter('SURVEYAPP'))
        self.assertTrue(exchange.export_dxf(meter('ACAD'))[0])
        self.assertTrue(exchange.export_dxf(meter(None))[0])

    def test_meter_dxf_edit_save_keeps_one_unit(self):
        # 감사 1: 미터 DXF 를 고쳐 저장하면 안 건드린 객체(원본 복사)와 고친 객체(mm)가 섞이면 안 된다.
        doc=ezdxf.new('R2018');doc.units=6;msp=doc.modelspace();msp.add_line((0,0),(10,0));msp.add_line((0,5),(10,5))
        m=exchange.import_file(standard_bytes(doc),'.dxf')['document']
        m['entities'][1]['points'][1]['x']=12000.0
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'out.dxf';path.write_bytes(exchange.export_dxf(m)[0]);out=ezdxf.readfile(path)
        scale={4:1,6:1000}[out.header.get('$INSUNITS')]
        ends=sorted(round(e.dxf.end.x*scale) for e in out.modelspace().query('LINE'))
        self.assertEqual(ends,[10000,12000])

    def test_table_cached_geometry_keeps_transform_and_removes_fill(self):
        d=ezdxf.new('R2018');d.units=4;table_sample(d,scale=(2,2))
        before=standard_bytes(d);result=exchange.import_file(before,'.dxf')
        block=result['document']['entities'][0];definition=result['document']['sharedBlocks'][block['sharedBlock']]
        self.assertEqual(block['position'],{'x':100,'y':200});self.assertEqual(block['rotation'],90);self.assertEqual(block['scale'],2)
        self.assertEqual([e['type'] for e in definition['entities']],['line']*5+['text']*2)
        self.assertEqual([e['text'] for e in definition['entities'] if e['type']=='text'],['Cell','two\nrows'])
        self.assertEqual(result['report']['decomposed'],{'ACAD_TABLE':1});self.assertIn('표 1개 → 선·글자로 바꿈',result['report']['warnings'])
        self.assertFalse(result['report']['skipped']);self.assertEqual(len(d.blocks.get('*T1')),8)

    def test_table_nonuniform_mirror_transform_is_baked_into_one_block(self):
        d=ezdxf.new('R2018');d.units=4;table_sample(d,scale=(-2,3))
        result=exchange.import_file(standard_bytes(d),'.dxf');block=result['document']['entities'][0]
        self.assertEqual(block['type'],'block');self.assertEqual(block['entities'][0]['points'],[{'x':100,'y':200},{'x':100,'y':120}])
        self.assertEqual(block['entities'][1]['points'][1],{'x':160,'y':120})
        self.assertFalse(any(e['type']=='hatch' for e in block['entities']))

    def test_table_cached_block_base_point_survives_rotation(self):
        d=ezdxf.new('R2018');d.units=4;table_sample(d,scale=(2,3))
        d.blocks.get('*T1').block.dxf.base_point=(5,7,0)
        result=exchange.import_file(standard_bytes(d),'.dxf')
        first=result['document']['entities'][0]['entities'][0]
        self.assertEqual(first['points'],[{'x':121,'y':190},{'x':121,'y':270}])

    def test_table_without_display_block_builds_cell_lines_and_text(self):
        d=ezdxf.new('R2018');d.units=4;table_sample(d,cached=False)
        result=exchange.import_file(standard_bytes(d),'.dxf');block=result['document']['entities'][0]
        children=result['document']['sharedBlocks'][block['sharedBlock']]['entities']
        self.assertEqual(sum(e['type']=='line' for e in children),5)
        self.assertEqual([e['text'] for e in children if e['type']=='text'],['Left','Right'])
        self.assertFalse(result['report']['skipped'])

    def test_region_sat_and_sab_keep_outer_and_inner_closed_rings_without_hatch(self):
        for version in ('R2010','R2018'):
            with self.subTest(version=version):
                d=ezdxf.new(version);d.units=4;region_sample(d,holes=True)
                result=exchange.import_file(standard_bytes(d),'.dxf');block=result['document']['entities'][0]
                self.assertEqual(block['type'],'block');self.assertEqual(len(block['entities']),2)
                for child in block['entities']:self.assertEqual(child['type'],'polyline');self.assertTrue(child['closed'])
                self.assertEqual(block['entities'][0]['points'],[{'x':10,'y':20},{'x':50,'y':20},{'x':50,'y':60},{'x':10,'y':60}])
                self.assertEqual(result['report']['decomposed'],{'REGION':1});self.assertFalse(result['report']['skipped'])

    def test_region_in_nonuniform_block_applies_ocs_and_deferred_transform(self):
        for sidecar in (False,True):
            with self.subTest(sidecar=sidecar):
                d=ezdxf.new('R2010');d.units=4;region,body=region_sample(d)
                nested=d.blocks.new('NESTED');d.modelspace().unlink_entity(region);nested.add_entity(region)
                d.modelspace().add_blockref('NESTED',(100,200),dxfattribs={'xscale':2,'yscale':3,'rotation':30})
                if sidecar:
                    region._barun_region_loops=exchange.region_boundary_loops([body]);region._barun_generated_region=True;region.sat=[]
                    with tempfile.TemporaryDirectory() as folder:
                        source=Path(folder)/'source.dxf';source.write_bytes(standard_bytes(d))
                        from unittest.mock import patch
                        with patch('exchange.read_dxf_preserving_unicode',return_value=d):result=exchange.import_file_path(source,'.dxf')
                else:result=exchange.import_file(standard_bytes(d),'.dxf')
                outline=result['document']['entities'][0]['entities'][0]
                self.assertAlmostEqual(outline['points'][0]['x'],100+20*math.cos(math.pi/6)-60*math.sin(math.pi/6))
                self.assertAlmostEqual(outline['points'][0]['y'],200+20*math.sin(math.pi/6)+60*math.cos(math.pi/6))
                self.assertTrue(outline['closed']);self.assertFalse(result['report']['skipped'])

    def test_unreadable_region_is_named_and_other_entities_still_open(self):
        d=ezdxf.new('R2010');d.units=4;d.modelspace().add_region().sat=['invalid ACIS'];d.modelspace().add_line((0,0),(10,0))
        result=exchange.import_file(standard_bytes(d),'.dxf')
        self.assertEqual(result['report']['skipped'],{'REGION ACIS 경계 읽기 불가':1})
        self.assertEqual([e['type'] for e in result['document']['entities']],['line'])

    def test_actual_dwg_table_merged_cells_and_split_lines(self):
        from unittest.mock import patch
        fixture=Path(__file__).parent/'tests/fixtures/dwg-import/table-merged.dwg'
        for minimum in ('1','20000'):
            with self.subTest(split_min=minimum),patch.dict('os.environ',{'BARUN_DWG_IMPORT_ROUTE':'deferred','BARUN_DWG_SPLIT_MIN':minimum}):
                result=exchange.import_file_path(fixture,'.dwg')
            self.assertEqual(result['report']['converterDetails']['engine'],'ACadSharp 3.8.0')
            self.assertEqual(result['report']['decomposed'],{'ACAD_TABLE':1})
            block=next(e for e in result['document']['entities'] if e['type']=='block')
            self.assertEqual(block['entities'][0]['points'][0],{'x':100,'y':200})
            self.assertAlmostEqual(block['entities'][0]['points'][1]['x'],100+40*math.cos(math.pi/6))
            self.assertAlmostEqual(block['entities'][0]['points'][1]['y'],220)
            self.assertEqual(sum(e['type']=='line' for e in block['entities']),11)
            self.assertEqual([e['text'] for e in block['entities'] if e['type']=='text'],['R1 C1','R2 C1','R2 C2'])
            self.assertEqual(sum(e['type']=='line' for e in result['document']['entities']),1)
            self.assertFalse(result['report']['skipped'])
            if minimum=='1':self.assertEqual(result['report']['converterDetails']['splitLines'],1)

    def test_actual_converter_passes_region_sat_and_sab_to_boundary_import(self):
        import subprocess
        from ezdxf.acis.api import load
        for version in ('R2010','R2018'):
            with self.subTest(version=version),tempfile.TemporaryDirectory() as folder:
                d=ezdxf.new(version);d.units=4;region_sample(d,True)
                source=Path(folder)/'region.dxf';target=Path(folder)/'out.dxf';d.saveas(source)
                run=subprocess.run([str(Path(__file__).parent/'dwg-runtime/BarunConverter.exe'),str(source),str(target),'2018','--defer-verify'],capture_output=True,timeout=30)
                self.assertEqual(run.returncode,0,run.stdout.decode(errors='replace'))
                report=json.loads(run.stdout.decode());record=report['acisRegions'][0]
                self.assertEqual(record['binary'],version=='R2018')
                data=base64.b64decode(record['data']);bodies=load(data if record['binary'] else data.decode().splitlines())
                self.assertEqual(len(exchange.region_boundary_loops(bodies)),2)
                self.assertEqual(report['expectedOutputTypes'],{'REGION':1})

    def test_dwg_region_sidecar_keeps_nested_boundaries_on_repeated_save(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        from ezdxf.acis.api import export_sat,export_sab
        for binary in (False,True):
            with self.subTest(binary=binary):
                source=ezdxf.new('R2018');source.units=4
                source.blocks.new('NESTED').add_line((0,0),(10,0));source.modelspace().add_blockref('NESTED',(100,200))
                region_doc=ezdxf.new('R2010');_,body=region_sample(region_doc,True)
                raw=export_sab([body]) if binary else '\n'.join(export_sat([body])).encode()
                records=[{'handle':'FFFF1','ownerBlock':'*Model_Space','layer':'0','color':256,'lineweight':-1,'linetype':'ByLayer','data':base64.b64encode(raw).decode(),'binary':binary},
                         {'handle':'FFFF2','ownerBlock':'NESTED','layer':'0','color':1,'lineweight':25,'linetype':'ByLayer','data':base64.b64encode(raw).decode(),'binary':binary}]
                payload={'inputTypes':{'Insert':1,'Region':1},'expectedOutputTypes':{'INSERT':1,'REGION':1},'acisRegions':records,'warnings':[]}
                def run(args,**kwargs):
                    source.saveas(args[2]);return SimpleNamespace(returncode=0,stdout=json.dumps(payload).encode())
                with patch('batch_converter.subprocess.Popen',side_effect=OSError),patch('batch_converter.subprocess.run',side_effect=run) as invoked:
                    result=exchange.import_file(b'AC10-test','.dwg')
                self.assertEqual(invoked.call_count,1);self.assertEqual(result['report']['decomposed'],{'REGION':2})
                for _ in range(2):
                    data,_=exchange.export_dxf(result['document']);saved=ezdxf.read(io.StringIO(data.decode(),newline=None))
                    self.assertEqual(len(saved.blocks.get('NESTED').query('LWPOLYLINE')),2)
                    self.assertEqual(len(saved.modelspace().query('INSERT')),2)
                    outlines=saved.blocks.get('NESTED').query('LWPOLYLINE')
                    self.assertEqual([e.dxf.color for e in outlines],[1,1]);self.assertTrue(all(e.closed for e in outlines))
                    self.assertEqual(list(outlines[0].get_points('xy')),[(10,20),(50,20),(50,60),(10,60)])
                    result=exchange.import_file(data,'.dxf')

    def test_dwg_missing_objects_inside_nonuniform_block_are_reported_as_lost(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        source=ezdxf.new('R2018');source.units=4
        source.blocks.new('NESTED').add_line((0,0),(10,0))
        source.modelspace().add_blockref('NESTED',(100,200),dxfattribs={'xscale':2,'yscale':3})
        record={'handle':'FFFF','ownerBlock':'NESTED','data':base64.b64encode(b'invalid ACIS').decode(),'binary':False}
        payload={'inputTypes':{'Insert':1},'expectedOutputTypes':{'INSERT':1},'acisRegions':[record],
                 'unresolvedDecompositions':[{'ownerBlock':'NESTED','type':'ACAD_TABLE','count':2}],'warnings':[]}
        def run(args,**kwargs):source.saveas(args[2]);return SimpleNamespace(returncode=0,stdout=json.dumps(payload).encode())
        with patch('batch_converter.subprocess.Popen',side_effect=OSError),patch('batch_converter.subprocess.run',side_effect=run):
            result=exchange.import_file(b'AC10-test','.dwg')
        self.assertEqual(result['report']['unpreserved'],{'REGION':1,'ACAD_TABLE':2})
        warnings=result['report']['warnings']
        self.assertTrue(any('표(TABLE) 2개' in w and '영역(REGION) 1개' in w and '원본 보존 계층에도 없' in w for w in warnings))
        self.assertFalse(any('미지원 객체 3개를 원본 보존' in w for w in warnings))

    def test_truncated_dxf_is_repaired_without_touching_source(self):
        d=ezdxf.new('R2018');d.modelspace().add_line((0,0),(10,20))
        data=standard_bytes(d)
        truncated=data.rsplit(b'0\nEOF',1)[0].rstrip()+b'\n'
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'broken.dxf';path.write_bytes(truncated);before=path.read_bytes()
            result=exchange.import_file_path(path,'.dxf')
            self.assertEqual(path.read_bytes(),before)
        self.assertTrue(any('복구' in w for w in result['report']['warnings']))
        self.assertEqual(result['document']['entities'][0]['type'],'line')

    def test_dxf_encoding_metadata_is_reported_and_source_folder_stays_clean(self):
        d=ezdxf.new('R2018');d.header['$DWGCODEPAGE']='ANSI_949';d.styles.add('korean',font='custom.shx')
        d.modelspace().add_text('한글',dxfattribs={'style':'korean'})
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'meta.dxf';path.write_bytes(standard_bytes(d));exchange.import_file_path(path,'.dxf')
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()),['meta.dxf'])
        report=exchange.import_file(standard_bytes(d),'.dxf')['report']
        self.assertEqual(report['encoding']['codepage'],'ANSI_1252')
        self.assertIn('custom.shx',report['encoding']['fonts'])

    def test_path_import_matches_byte_import(self):
        d=ezdxf.new('R2018');d.units=4;d.modelspace().add_line((0,0),(1234,5678))
        data=standard_bytes(d)
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'large-path.dxf';path.write_bytes(data)
            direct=exchange.import_file_path(path,'.dxf')
        copied=exchange.import_file(data,'.dxf')
        direct_line=direct['document']['entities'][0];copied_line=copied['document']['entities'][0]
        self.assertEqual((direct_line['type'],direct_line['points']),(copied_line['type'],copied_line['points']))
        self.assertEqual(direct['report']['imported'],1)

    def test_path_import_rejects_extension_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'drawing.dxf';path.write_bytes(b'not used')
            with self.assertRaises(ValueError):exchange.import_file_path(path,'.dwg')

    def test_missing_font_keeps_korean_position_size_width_and_alignment(self):
        d=ezdxf.new('R2018');d.units=4
        d.styles.add('missing',font='not-installed.shx')
        right=d.modelspace().add_text('한글 위치 크기',dxfattribs={'style':'missing','height':250,'width':1.25})
        right.set_placement((1234,5678),align=ezdxf.enums.TextEntityAlignment.RIGHT)
        center=d.modelspace().add_text('가운데',dxfattribs={'style':'missing','height':180,'width':.8})
        center.set_placement((4000,5000),align=ezdxf.enums.TextEntityAlignment.CENTER)
        result=exchange.import_file(standard_bytes(d),'.dxf')['document']['entities']
        self.assertEqual(result[0]['text'],'한글 위치 크기');self.assertEqual(result[0]['position'],{'x':1234,'y':5678})
        self.assertEqual((result[0]['height'],result[0]['widthFactor'],result[0]['align']),(250,1.25,'right'))
        self.assertEqual((result[1]['position'],result[1]['height'],result[1]['widthFactor'],result[1]['align']),({'x':4000,'y':5000},180,.8,'center'))

    def test_text_background_mask_roundtrips_as_mtext_canvas_fill(self):
        original=model();original['entities']=[{'id':'mask','layer':'default','type':'text','position':{'x':100,'y':200},'text':'가려진 문자','height':200,'rotation':0,'backgroundMask':True,'maskPadding':50}]
        data,_=exchange.export_dxf(original)
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'mask.dxf';path.write_bytes(data);doc=ezdxf.readfile(path)
        mtext=doc.modelspace().query('MTEXT')[0];self.assertTrue(int(mtext.dxf.bg_fill));self.assertAlmostEqual(mtext.dxf.box_fill_scale,1.5)
        del doc.rootdict['BARUN_CAD_V2'];restored=exchange.import_file(standard_bytes(doc),'.dxf')['document']['entities'][0]
        self.assertTrue(restored['backgroundMask']);self.assertAlmostEqual(restored['maskPadding'],50)

    def test_xclip_native_and_standard_dxf_roundtrip(self):
        from ezdxf.xclip import XClip
        original=model();original['entities']=[{'id':'clip','type':'block','name':'CLIP','layer':'default','clip':{'enabled':True,'points':[{'x':100,'y':-100},{'x':500,'y':-100},{'x':500,'y':100},{'x':100,'y':100}]},'entities':[{'type':'line','layer':'default','points':[{'x':0,'y':0},{'x':1000,'y':0}]}]}]
        data,_=exchange.export_dxf(original)
        self.assertEqual(exchange.import_file(data,'.dxf')['document'],original)
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'clip.dxf';path.write_bytes(data);doc=ezdxf.readfile(path)
        ref=doc.modelspace().query('INSERT')[0]
        self.assertTrue(XClip(ref).has_clipping_path);self.assertTrue(XClip(ref).is_clipping_enabled)
        del doc.rootdict['BARUN_CAD_V2']
        standard=exchange.import_file(standard_bytes(doc),'.dxf')['document'];restored=standard['entities'][0]
        self.assertEqual(restored['clip'],original['entities'][0]['clip'])
        # A clipped standard INSERT shares its definition (children live there); the world clip rides on the reference.
        children=standard['sharedBlocks'][restored['sharedBlock']]['entities'] if restored.get('sharedBlock') else restored['entities']
        self.assertEqual(children[0]['points'][1]['x'],1000)
        XClip(ref).disable_clipping();restored=exchange.import_file(standard_bytes(doc),'.dxf')['document']['entities'][0];self.assertFalse(restored['clip']['enabled'])
    def test_r12_source_upgrades_to_r2000_for_new_polyline(self):
        # R12 원본에 벽(LWPOLYLINE)을 그린 뒤 저장하면 'LWPOLYLINE requires DXF R2000' 으로 실패하던 문제.
        doc=ezdxf.new('R12');doc.encoding='cp949';doc.header['$DWGCODEPAGE']='ANSI_949';doc.modelspace().add_text('안방',dxfattribs={'height':200})
        stream=io.StringIO();doc.write(stream);source=exchange.import_file(stream.getvalue().encode('cp949'),'.dxf')['document']
        source['entities'].append({'id':'wall','type':'polyline','layer':source['entities'][0]['layer'],'closed':True,'points':[{'x':0,'y':0},{'x':1000,'y':0},{'x':1000,'y':1000}]})
        data,warnings=exchange.export_dxf(source)
        self.assertTrue(any('R2000 형식으로 올려' in w for w in warnings),warnings)
        self.assertFalse(any('처음 DXF 버전' in w for w in warnings),warnings)
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'r12.dxf';path.write_bytes(data);saved=ezdxf.readfile(path)
        self.assertEqual(saved.dxfversion,'AC1015')
        self.assertEqual(saved.modelspace().query('TEXT')[0].dxf.text,'안방')
        self.assertEqual(len(saved.modelspace().query('LWPOLYLINE')),1)
    def check_legacy_korean_roundtrip(self,version,acadver):
        original=model();original['entities']=original['entities'][3:5]
        original['entities'].append({'id':'block','type':'block','name':'한글블록','sharedBlock':'korean','layer':'default','position':{'x':0,'y':0},'entities':[]})
        original['sharedBlocks']={'korean':{'name':'한글블록','origin':{'x':0,'y':0},'entities':[{'id':'child','type':'line','layer':'default','points':[{'x':0,'y':0},{'x':100,'y':100}]}]}}
        data,warnings=exchange.export_dxf(original,version)
        self.assertFalse(warnings)
        self.assertEqual(exchange.import_file(data,'.dxf')['document'],original)
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'korean.dxf';path.write_bytes(data);doc=ezdxf.readfile(path)
            self.assertEqual(doc.header['$ACADVER'],acadver)
            self.assertEqual(doc.header['$DWGCODEPAGE'],'ANSI_949')
            self.assertEqual(doc.modelspace().query('TEXT')[0].dxf.text,'거실 COPY C')
            self.assertEqual(doc.modelspace().query('MTEXT')[0].plain_text(),'첫 줄\n둘째 줄')
            self.assertIn('건축',doc.layers)
            self.assertTrue(all(e.dxf.layer=='건축' for e in doc.modelspace()))
            self.assertEqual(doc.modelspace().query('INSERT')[0].dxf.name,'한글블록')
            self.assertIn('한글블록',doc.blocks)
            # 내장 모델 없이도 실제 DXF 문자·레이어·블록의 한글을 읽어야 한다.
            del doc.rootdict['BARUN_CAD_V2'];doc.saveas(path)
            foreign=exchange.import_file(path.read_bytes(),'.dxf')
        self.assertFalse(foreign['report']['nativeMetadata'])
        restored=foreign['document']
        self.assertEqual([e['text'] for e in restored['entities'] if e['type']=='text'],['거실 COPY C','첫 줄\n둘째 줄'])
        self.assertIn('건축',[l['name'] for l in restored['layers']])
        self.assertEqual(next(e['name'] for e in restored['entities'] if e['type']=='block'),'한글블록')

    def test_r2000_korean_text_mtext_layer_block_roundtrip(self):
        self.check_legacy_korean_roundtrip('R2000','AC1015')

    def test_r2004_korean_text_mtext_layer_block_roundtrip(self):
        self.check_legacy_korean_roundtrip('R2004','AC1018')

    def check_modern_korean_block_name(self,source_version):
        # R2007+ UTF-8 DXF 는 \U+XXXX 로 바꿔 읽는다 — 블록 이름·속성도 한글로 되돌려야 한다.
        source=ezdxf.new(source_version);source.units=4;source.blocks.new('창호').add_line((0,0),(10,0))
        plate=source.blocks.new('문패');plate.add_line((0,0),(100,0));plate.add_blockref('창호',(5,5));plate.add_attdef('호수',(0,0),text='101호')
        msp=source.modelspace();msp.add_blockref('문패',(0,0)).add_attrib('호수','101호',(0,0));msp.add_blockref('문패',(500,0))
        def blocks(document):
            return [(e['name'],e.get('sharedBlock'),e.get('attributes')) for e in document['entities'] if e['type']=='block'],sorted(document.get('sharedBlocks') or {})
        expected=([('문패','문패',{'호수':'101호'}),('문패','문패',None)],['문패','창호'])
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'source.dxf';source.saveas(path)
            imported=exchange.import_file(path.read_bytes(),'.dxf')['document']
            self.assertEqual(blocks(imported),expected)
            fresh={key:value for key,value in imported.items() if key not in ('dxfPreservation','sourceCoverage')}
            for label,document in (('preserved',imported),('fresh',fresh)):
                for version in ('R2018','R2000'):
                    with self.subTest(source=source_version,model=label,version=version):
                        data,_=exchange.export_dxf(copy.deepcopy(document),version)
                        saved=Path(tmp)/'saved.dxf';saved.write_bytes(data)
                        self.assertTrue({'문패','창호'}<={b.name for b in ezdxf.readfile(saved).blocks})
                        self.assertEqual(blocks(exchange.import_file(data,'.dxf')['document']),expected)

    def test_r2010_korean_block_name_roundtrip(self):
        self.check_modern_korean_block_name('R2010')

    def test_r2018_korean_block_name_roundtrip(self):
        self.check_modern_korean_block_name('R2018')

    def test_legacy_special_characters_are_replaced_and_bmp_is_preserved(self):
        for version in ('R2000','R2004','R2007'):
            with self.subTest(version=version):
                original=model();original['entities']=original['entities'][3:5]
                original['entities'][0]['text']='Café Noël 😀𠀀';original['entities'][1]['text']='Café\nNoël'
                data,warnings=exchange.export_dxf(original,version)
                with tempfile.TemporaryDirectory() as tmp:
                    path=Path(tmp)/'special.dxf';path.write_bytes(data);saved=ezdxf.readfile(path)
                legacy=version!='R2007'
                self.assertEqual(exchange.dxf_unicode(saved.modelspace().query('TEXT')[0].dxf.text),'Café Noël ??' if legacy else 'Café Noël 😀𠀀')
                self.assertEqual(exchange.dxf_unicode(saved.modelspace().query('MTEXT')[0].plain_text()),'Café\nNoël')
                self.assertNotIn(b'\\U+0001f600',data);self.assertNotIn(b'\\U+00020000',data)
                if legacy:
                    self.assertIn(b'\\U+00E9',data)
                    self.assertEqual(warnings,['2000·2004 DXF 에는 일부 특수 문자(2자)를 담을 수 없습니다. 2007 이상으로 저장하세요.'])
                else:self.assertFalse(warnings)
                self.assertEqual(exchange.import_file(data,'.dxf')['document'],original)
                del saved.rootdict['BARUN_CAD_V2']
                foreign=exchange.import_file(standard_bytes(saved),'.dxf')['document']
                self.assertEqual([e['text'] for e in foreign['entities'] if e['type']=='text'],['Café Noël ??' if legacy else 'Café Noël 😀𠀀','Café\nNoël'])

    def test_legacy_special_layer_name_is_valid_and_warned(self):
        for version in ('R2000','R2004','R2007'):
            with self.subTest(version=version):
                original=model();original['layers'][0]['name']='layer😀';original['entities']=original['entities'][:1]
                original['layers'].append({**original['layers'][0],'id':'other','name':'layer_0'})
                original['entities'].append({**original['entities'][0],'id':'other','layer':'other'})
                data,warnings=exchange.export_dxf(original,version)
                with tempfile.TemporaryDirectory() as tmp:
                    path=Path(tmp)/'layer.dxf';path.write_bytes(data);saved=ezdxf.readfile(path)
                self.assertFalse(saved.audit().errors)
                self.assertEqual([e.dxf.layer for e in saved.modelspace().query('LINE')],['layer😀' if version=='R2007' else 'LAYER_0_','layer_0'])
                if version=='R2007':self.assertFalse(warnings)
                else:self.assertIn('2000·2004 DXF 에는 일부 특수 문자(1자)를 담을 수 없습니다. 2007 이상으로 저장하세요.',warnings)

    def test_legacy_special_shared_block_names_stay_distinct(self):
        for version in ('R2000','R2004','R2007'):
            with self.subTest(version=version):
                original=model();original['entities']=[];original['sharedBlocks']={}
                for i,name in enumerate(('b𠀀','b𠀁'),1):
                    key=str(i);original['entities'].append({'id':key,'type':'block','name':name,'sharedBlock':key,'layer':'default','position':{'x':0,'y':0},'entities':[]})
                    original['sharedBlocks'][key]={'name':name,'entities':[{'id':'line','type':'line','layer':'default','points':[{'x':0,'y':0},{'x':i*100,'y':0}]}]}
                data,warnings=exchange.export_dxf(original,version)
                with tempfile.TemporaryDirectory() as tmp:
                    path=Path(tmp)/'blocks.dxf';path.write_bytes(data);saved=ezdxf.readfile(path)
                refs=list(saved.modelspace().query('INSERT'));self.assertNotEqual(refs[0].dxf.name,refs[1].dxf.name)
                self.assertEqual([saved.blocks.get(ref.dxf.name).query('LINE')[0].dxf.end.x for ref in refs],[100,200])
                self.assertFalse(saved.audit().errors)
                if version=='R2007':self.assertFalse(warnings)
                else:self.assertIn('2000·2004 DXF 에는 일부 특수 문자(2자)를 담을 수 없습니다. 2007 이상으로 저장하세요.',warnings)

    def test_native_roundtrip_and_real_dxf_entities(self):
        original=model();data,warnings=exchange.export_dxf(original);result=exchange.import_file(data,'.dxf')
        self.assertEqual(result['document'],original);self.assertTrue(result['report']['nativeMetadata'])
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'test.dxf';p.write_bytes(data);d=ezdxf.readfile(p)
            self.assertEqual(d.units,4);self.assertEqual(len(d.modelspace().query('DIMENSION')),4)
            self.assertEqual(len(d.modelspace().query('HATCH')),1);self.assertEqual(len(d.modelspace().query('INSERT')),1)
            self.assertFalse(d.audit().has_errors)
            del d.rootdict['BARUN_CAD_V2'];foreign=exchange.import_file(standard_bytes(d),'.dxf')
            self.assertFalse(foreign['report']['nativeMetadata']);self.assertFalse(foreign['report']['skipped'])
            self.assertEqual(len(foreign['document']['entities']),len(original['entities']))
            h=next(e for e in foreign['document']['entities'] if e['type']=='hatch');self.assertEqual(len(h['loops']),1)

    def test_linetype_scale_import_and_export(self):
        d=ezdxf.new('R2018',setup=True);d.units=4;d.header['$LTSCALE']=2.5
        line=d.modelspace().add_line((0,0),(1000,0),dxfattribs={'linetype':'CENTER','ltscale':3})
        imported=exchange.import_file(standard_bytes(d),'.dxf')['document']
        self.assertEqual(imported['linetypeScale'],2.5);self.assertEqual(imported['entities'][0]['linetypeScale'],3)
        data,_=exchange.export_dxf(imported)
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'scale.dxf';p.write_bytes(data);restored=ezdxf.readfile(p)
        self.assertEqual(restored.header['$LTSCALE'],2.5);self.assertEqual(restored.modelspace().query('LINE')[0].dxf.ltscale,3)

    def test_external_edit_invalidates_embedded_model(self):
        data,_=exchange.export_dxf(model())
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'test.dxf';p.write_bytes(data);doc=ezdxf.readfile(p);doc.modelspace().query('CIRCLE')[0].dxf.radius=750
            result=exchange.import_file(standard_bytes(doc),'.dxf');self.assertFalse(result['report']['nativeMetadata']);self.assertEqual(next(e for e in result['document']['entities'] if e['type']=='circle')['radius'],750)

    def test_hatch_origin_survives_external_edit_and_autocad_base_point(self):
        # 2026-09-24(비평 4): HP 로 바꾼 해치 기준점이 외부 편집(내장 모델 무효) 뒤에도 무늬 기준점(base_point)에서 되살아난다.
        doc_model={'units':'mm','layers':[{'id':'L0','name':'0','color':'#ffffff'}],'entities':[
            {'id':'h1','type':'hatch','layer':'L0','points':[{'x':0,'y':0},{'x':1000,'y':0},{'x':1000,'y':1000},{'x':0,'y':1000}],'loops':[],'pattern':'lines','spacing':100,'angle':45,'origin':{'x':12,'y':34}},
            {'id':'c1','type':'circle','layer':'L0','center':{'x':5000,'y':0},'radius':500}]}
        data,_=exchange.export_dxf(doc_model)
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'hp.dxf';p.write_bytes(data);doc=ezdxf.readfile(p);doc.modelspace().query('CIRCLE')[0].dxf.radius=750
            base=doc.modelspace().query('HATCH')[0].pattern.lines[0].base_point
            self.assertAlmostEqual(base[0],12,6);self.assertAlmostEqual(base[1],34,6)
            m=doc.modelspace();h=m.add_hatch();h.set_pattern_fill('ANSI31',scale=1);h.paths.add_polyline_path([(0,0),(10,0),(10,10)],is_closed=True)
            h.set_pattern_definition([[45,(7,3),(0,3.175),[]]])
            result=exchange.import_file(standard_bytes(doc),'.dxf')
        self.assertFalse(result['report']['nativeMetadata'])
        hatches=[e for e in result['document']['entities'] if e['type']=='hatch']
        self.assertAlmostEqual(hatches[0]['origin']['x'],12,6);self.assertAlmostEqual(hatches[0]['origin']['y'],34,6)
        self.assertAlmostEqual(hatches[1]['origin']['x'],7,6);self.assertAlmostEqual(hatches[1]['origin']['y'],3,6)

    def test_units_unsupported_and_bulges_are_reported(self):
        d=ezdxf.new('R2018');d.units=6;m=d.modelspace();m.add_line((0,0),(6,0));m.add_lwpolyline([(0,0,1),(1,0,0)],format='xyb');m.add_spline([(0,0),(1,2),(2,0)]);m.add_ray((0,0),(1,1))
        result=exchange.import_file(standard_bytes(d),'.dxf');self.assertAlmostEqual(result['document']['entities'][0]['points'][1]['x'],6000);self.assertNotIn('RAY',result['report']['skipped']);self.assertTrue(result['report']['converted'])
        d.units=0;result=exchange.import_file(standard_bytes(d),'.dxf');self.assertTrue(result['report']['unitless'])

    def test_external_linear_dimensions_keep_defining_points(self):
        d=ezdxf.new('R2018');d.units=4;m=d.modelspace()
        m.add_line((0,0),(1000,0))
        a=m.add_linear_dim(base=(0,200),p1=(0,0),p2=(1000,0),override={'dimtxt':100,'dimlfac':.001,'dimpost':'<> m','dimdec':3});a.render()
        b=m.add_aligned_dim(p1=(0,0),p2=(300,400),distance=200);b.render();b.dimension.dxf.dimtype=33
        r=exchange.import_file(standard_bytes(d),'.dxf');dims=[e for e in r['document']['entities'] if e['type']=='dimension']
        self.assertEqual(len(dims),2);self.assertEqual(dims[0]['points'][:2],[{'x':0,'y':0},{'x':1000,'y':0}])
        self.assertEqual(dims[0]['measurementScale'],.001);self.assertEqual(dims[0]['textTemplate'],'<> m');self.assertNotIn('text',dims[0]);self.assertEqual(dims[1]['mode'],'aligned')

    def test_non_ascii_dimension_text_and_attributes_are_not_escaped(self):
        # 치수 글자 대체값·dimpost·블록 속성의 한글/Ø 가 \U+C124… 꼴로 남으면 안 된다(TEXT 는 원래 정상).
        # R2007+ UTF-8 DXF 는 read_dxf_preserving_unicode 가 \U+XXXX 로 바꿔 읽으므로 이 판들에서 확인한다.
        for version in ('R2010','R2018'):
            with self.subTest(version=version):
                d=ezdxf.new(version);d.units=4;m=d.modelspace()
                m.add_linear_dim(base=(200,0),p1=(0,0),p2=(0,1000),angle=90,text='설계치수').render()
                m.add_linear_dim(base=(0,200),p1=(0,0),p2=(1000,0),text='Ø<>',override={'dimpost':'<> 높이'}).render()
                block=d.blocks.new('문패');block.add_attdef('호실',(0,0))
                m.add_blockref('문패',(0,0)).add_attrib('호실','101호 Ø',(0,0))
                r=exchange.import_file(standard_bytes(d),'.dxf');es=r['document']['entities']
                dims=[e for e in es if e['type']=='dimension']
                self.assertEqual([e.get('text') for e in dims],['설계치수','Ø<>'])
                self.assertEqual(dims[1]['textTemplate'],'<> 높이')
                block=next(e for e in es if e['type']=='block')
                self.assertEqual(block['attributes'],{'호실':'101호 Ø'})
                self.assertNotIn('\\U+',json.dumps([dims,block['attributes'],block['entities']],ensure_ascii=False))

    def test_bad_files_fail_explicitly(self):
        with self.assertRaises(ValueError):exchange.import_file(b'not a DXF','.dxf')
        with self.assertRaises(ValueError):exchange.import_file(b'bad','.dxg')

    def test_ellipse_and_curved_hatch_import(self):
        d=ezdxf.new('R2018');d.units=4;m=d.modelspace();m.add_ellipse((100,200),major_axis=(1000,0),ratio=.5)
        hatch=m.add_hatch();edge=hatch.paths.add_edge_path();edge.add_arc((0,0),500,0,360)
        result=exchange.import_file(standard_bytes(d),'.dxf');self.assertFalse(result['report']['skipped']);self.assertEqual(result['document']['entities'][0]['type'],'ellipse');self.assertEqual(result['document']['entities'][0]['ratio'],.5);self.assertGreater(len(result['document']['entities'][1]['points']),10);self.assertTrue(result['report']['converted'])

    def test_dwg_bundled_converter_without_autocad(self):
        from batch_converter import process
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as folder:
            doc=ezdxf.new('R2018',setup=True);doc.units=4
            doc.modelspace().add_line((0,0),(1700,0))
            doc.modelspace().add_circle((300,400),75)
            source=Path(folder)/'source.dxf';doc.saveas(source)
            dwg=process({'action':'convert','name':'source.dxf','direction':'dxf-dwg',
                         'folder':folder,'data':base64.b64encode(source.read_bytes()).decode()})
            raw=Path(dwg['path']).read_bytes()
            with patch.dict('os.environ',{'ProgramFiles':str(Path(folder)/'no-autocad')}):
                self.assertTrue(exchange.converters()['bundled'])
                result=exchange.import_file(raw,'.dwg')
            entities=result['document']['entities']
            self.assertEqual(len(entities),2)
            line=next(e for e in entities if e['type']=='line')
            self.assertEqual(line['points'][1]['x'],1700)
            self.assertEqual(next(e for e in entities if e['type']=='circle')['radius'],75)
            self.assertEqual(result['report']['converter'],'내장 DWG 엔진')
            self.assertTrue(result['report']['warnings'])
            self.assertEqual(Path(dwg['path']).read_bytes(),raw)

    def test_missing_bundled_engine_does_not_use_autocad(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as folder:
            with patch('batch_converter.RUNTIME',Path(folder)), patch('batch_converter.subprocess.run') as run:
                self.assertFalse(exchange.converters()['bundled'])
                with self.assertRaisesRegex(ValueError,'내장 변환 엔진'):
                    exchange.import_file(b'AC1032'+bytes(200),'.dwg')
                run.assert_not_called()

    def test_foreign_layout_and_unsupported_entities_survive_edit(self):
        d=ezdxf.new('R2018',setup=True);d.units=4;m=d.modelspace()
        m.add_line((0,0),(1000,0));m.add_xline((50,50),(1,1))
        paper=d.layouts.new('출력도면');paper.add_line((10,20),(30,40))
        imported=exchange.import_file(standard_bytes(d),'.dxf')
        self.assertEqual(imported['report']['layoutsPreserved'],2)
        line=next(e for e in imported['document']['entities'] if e['type']=='line' and e.get('sourceHandle')==m.query('LINE')[0].dxf.handle)
        line['points'][1]['x']=2000
        output,warnings=exchange.export_dxf(imported['document'])
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'preserved.dxf';path.write_bytes(output);saved=ezdxf.readfile(path)
        self.assertEqual(len(saved.modelspace().query('XLINE')),1)
        self.assertEqual(saved.paperspace('출력도면').query('LINE')[0].dxf.end.x,30)
        self.assertEqual(saved.modelspace().query('LINE')[0].dxf.end.x,2000)
        self.assertTrue(any('원본 보존' in item for item in warnings))

    def test_preserved_legacy_codepage_and_names_survive_one_edit(self):
        for version in ('R2000','R2004'):
            for encoding,name,codepage in (('cp1252','Café Noël','ANSI_1252'),('cp932','日本語','ANSI_932')):
                with self.subTest(version=version,encoding=encoding):
                    d=ezdxf.new(version);d.encoding=encoding;d.units=4;m=d.modelspace()
                    d.layers.new(name);block=d.blocks.new(name);block.add_text(name)
                    m.add_text(name,dxfattribs={'layer':name});m.add_blockref(name,(0,0));m.add_line((0,0),(1000,0))
                    with tempfile.TemporaryDirectory() as tmp:
                        path=Path(tmp)/'source.dxf';d.saveas(path);source=path.read_bytes()
                        imported=exchange.import_file(source,'.dxf')['document']
                        line=next(e for e in imported['entities'] if e['type']=='line');line['points'][1]['x']=2000
                        output,_=exchange.export_dxf(imported,version)
                        self.assertEqual(path.read_bytes(),source)
                        path=Path(tmp)/'saved.dxf';path.write_bytes(output);saved=ezdxf.readfile(path)
                    self.assertEqual(saved.encoding,encoding);self.assertEqual(saved.header['$DWGCODEPAGE'],codepage)
                    self.assertEqual(saved.modelspace().query('TEXT')[0].dxf.text,name)
                    self.assertEqual(saved.modelspace().query('TEXT')[0].dxf.layer,name);self.assertIn(name,saved.layers)
                    self.assertEqual(saved.modelspace().query('INSERT')[0].dxf.name,name)
                    self.assertEqual(saved.blocks.get(name).query('TEXT')[0].dxf.text,name)
                    self.assertEqual(saved.modelspace().query('LINE')[0].dxf.end.x,2000)

    def test_preserved_dxf_downgrade_roundtrip(self):
        from ezdxf.math import Vec2
        from ezdxf.render.mleader import ConnectionSide
        for version,acadver in (('R2000','AC1015'),('R2004','AC1018')):
            with self.subTest(version=version):
                d=ezdxf.new('R2018');d.units=4;m=d.modelspace();d.layers.new('RGB',dxfattribs={'true_color':0x123456})
                m.add_line((0,0),(100,0));m.add_text('한글 문자',dxfattribs={'height':10,'layer':'RGB'});m.add_mtext(r'여러 줄\P한글')
                builder=m.add_multileader_mtext();builder.set_content('지시선 한글',char_height=10);builder.add_leader_line(ConnectionSide.right,[Vec2(30,40)]);builder.build(Vec2(80,40))
                hatch=m.add_hatch(color=3);hatch.paths.add_polyline_path([(0,0),(10,0),(10,10),(0,10)],is_closed=True)
                block=d.blocks.new('한글 블록');block.add_text('블록 안 문자');m.add_blockref('한글 블록',(50,50))
                paper=d.layouts.new('배치 도면');paper.add_text('배치 문자');paper.add_line((1,2),(3,4))
                imported=exchange.import_file(standard_bytes(d),'.dxf')['document']
                next(e for e in imported['entities'] if e['type']=='line')['points'][1]['x']=200
                snapshot=json.dumps(imported,ensure_ascii=False);output,warnings=exchange.export_dxf(imported,version)
                self.assertEqual(json.dumps(imported,ensure_ascii=False),snapshot)
                self.assertTrue(any('MULTILEADER 1개' in w and w.startswith('구버전(') for w in warnings));self.assertFalse(any('처음 DXF 버전' in w for w in warnings))
                body=output.decode('cp949');self.assertIn(acadver,body);self.assertIn('ANSI_949',body)
                for text in ('한글 문자','여러 줄','지시선 한글','블록 안 문자','배치 문자'):self.assertIn(text,body)
                for name in ('MULTILEADER','MLEADERSTYLE','MATERIAL'):self.assertNotRegex(body,r'(?m)^ *0\r?\n'+name+r'\r?$')
                exchange.check_downgrade_bytes(output,acadver)
                with tempfile.TemporaryDirectory() as tmp:
                    path=Path(tmp)/'saved.dxf';path.write_bytes(output);saved=ezdxf.readfile(path)
                self.assertEqual(saved.dxfversion,acadver);self.assertEqual(saved.encoding,'cp949');self.assertFalse(saved.audit().errors)
                self.assertEqual(saved.modelspace().query('LINE')[0].dxf.end.x,200);self.assertEqual(len(saved.modelspace().query('HATCH')),1)
                self.assertEqual(list(saved.modelspace().query('HATCH')[0].paths[0].vertices),[(0,0,0),(10,0,0),(10,10,0),(0,10,0)])
                self.assertEqual(saved.blocks.get('한글 블록').query('TEXT')[0].dxf.text,'블록 안 문자');self.assertEqual(saved.paperspace('배치 도면').query('TEXT')[0].dxf.text,'배치 문자')
                returned=exchange.import_file(output,'.dxf');self.assertTrue(returned['report']['nativeMetadata'])
                self.assertEqual(returned['document']['dxfPreservation']['version'],acadver);self.assertTrue(returned['document']['dxfPreservation']['downgraded'])
                for e in returned['document']['entities']:self.assertEqual(e['sourceFingerprint'],exchange.editable_fingerprint(e))
                again,_=exchange.export_dxf(returned['document'],version);exchange.check_downgrade_bytes(again,acadver)
                self.assertIn(acadver,again.decode('cp949'));self.assertNotIn('AC1032',again.decode('cp949'))

    def test_downgrade_converts_every_block_and_layout(self):
        from ezdxf.math import Vec2
        from ezdxf.render.mleader import ConnectionSide
        d=ezdxf.new('R2018');d.units=4;block=d.blocks.new('UNUSED');paper=d.layouts.new('도면')
        for layout in (d.modelspace(),block,paper):
            builder=layout.add_multileader_mtext();builder.set_content('지시선',char_height=2);builder.add_leader_line(ConnectionSide.right,[Vec2(1,2)]);builder.build(Vec2(3,2))
            mesh=layout.add_mesh()
            with mesh.edit_data() as data:data.vertices=[(0,0,1),(10,0,2),(0,10,3)];data.faces=[(0,1,2)]
        output,warnings=exchange.export_dxf(exchange.import_file(standard_bytes(d),'.dxf')['document'],'R2000')
        self.assertTrue(any('MULTILEADER 3개' in w and 'MESH 3개' in w for w in warnings))
        exchange.check_downgrade_bytes(output,'AC1015')
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'saved.dxf';path.write_bytes(output);saved=ezdxf.readfile(path)
        for layout in (saved.modelspace(),saved.blocks.get('UNUSED'),saved.paperspace('도면')):
            self.assertEqual(len(layout.query('MULTILEADER MESH')),0);self.assertEqual(len(layout.query('MTEXT')),1);self.assertEqual(len(layout.query('POLYLINE')),1)
            self.assertEqual(layout.query('POLYLINE')[0].vertices[0].dxf.location.z,1)
        self.assertFalse(saved.audit().errors)

    def test_downgrade_final_bytes_reject_entities_and_classes(self):
        for section,record in (('ENTITIES','  0\nMULTILEADER\n'),('ENTITIES','  0\n3DSOLID\n'),('OBJECTS','  0\nMATERIAL\n'),('CLASSES','  0\nCLASS\n  1\nMLEADERSTYLE\n  2\nAcDbMLeaderStyle\n')):
            with self.subTest(section=section):
                raw=('  0\nSECTION\n  2\n'+section+'\n'+record+'  0\nENDSEC\n  0\nEOF\n').encode()
                with self.assertRaisesRegex(ValueError,'구버전 DXF로 바꿀 수 없는 객체'):exchange.check_downgrade_bytes(raw,'AC1015')

    def test_downgrade_refuses_acis_dynamic_xref_and_table_without_display(self):
        from ezdxf.entities import factory
        from ezdxf.lldxf.extendedtags import ExtendedTags
        for name in ('ACAD_TABLE','3DSOLID','REGION','BODY','SURFACE','동적 블록','외부 참조'):
            with self.subTest(name=name):
                d=ezdxf.new('R2018');d.units=4;d.modelspace().add_line((0,0),(1,0))
                if name=='ACAD_TABLE':
                    table=factory.load(ExtendedTags.from_text('0\nACAD_TABLE\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockReference\n2\nmissing\n10\n0\n20\n0\n30\n0\n100\nAcDbTable\n'),doc=d);d.modelspace().add_entity(table)
                elif name=='동적 블록':
                    d.appids.add('AcDbDynamicBlockGUID');block=d.blocks.new('DYNAMIC');block.block_record.set_xdata('AcDbDynamicBlockGUID',[(1000,'id')]);block.add_line((0,0),(1,1));d.modelspace().add_blockref('DYNAMIC',(0,0))
                elif name=='외부 참조':d.add_xref_def('source.dxf','XREF');d.modelspace().add_blockref('XREF',(0,0))
                else:
                    acis=d.modelspace().new_entity(name,{});acis.sab=b'test'
                imported=exchange.import_file(standard_bytes(d),'.dxf')['document'];snapshot=json.dumps(imported,ensure_ascii=False)
                with self.assertRaisesRegex(ValueError,'구버전 DXF로 바꿀 수 없는 객체.*원본은 변경되지 않았습니다'):exchange.export_dxf(imported,'R2000')
                self.assertEqual(json.dumps(imported,ensure_ascii=False),snapshot)

    def test_downgrade_table_with_display_block_becomes_insert(self):
        from ezdxf.entities import factory
        from ezdxf.lldxf.extendedtags import ExtendedTags
        d=ezdxf.new('R2018');d.units=4;display=d.blocks.new('*T1');display.add_text('표 안 한글');display.add_line((0,0),(10,0))
        for layout in (d.modelspace(),d.blocks.new('표 정의'),d.layouts.new('표 배치')):
            table=factory.load(ExtendedTags.from_text('0\nACAD_TABLE\n100\nAcDbEntity\n8\n0\n100\nAcDbBlockReference\n2\n*T1\n10\n20\n20\n30\n30\n0\n100\nAcDbTable\n'),doc=d);layout.add_entity(table)
        output,warnings=exchange.export_dxf(exchange.import_file(standard_bytes(d),'.dxf')['document'],'R2000')
        self.assertTrue(any('ACAD_TABLE 3개' in w for w in warnings));exchange.check_downgrade_bytes(output,'AC1015')
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'table.dxf';path.write_bytes(output);saved=ezdxf.readfile(path)
        for layout in (saved.modelspace(),saved.blocks.get('표 정의'),saved.paperspace('표 배치')):
            ref=layout.query('INSERT')[0];self.assertEqual(ref.dxf.name,'*T1');self.assertEqual(tuple(ref.dxf.insert),(20,30,0))
        self.assertEqual(saved.blocks.get('*T1').query('TEXT')[0].dxf.text,'표 안 한글');self.assertFalse(saved.audit().errors)

    def test_downgrade_rgb_uses_nearest_aci_and_keeps_explicit_aci(self):
        d=ezdxf.new('R2018');d.units=4;d.layers.new('색 번호',dxfattribs={'color':3,'true_color':0x123456})
        d.modelspace().add_line((0,0),(1,0),dxfattribs={'true_color':0x123456})
        d.modelspace().add_line((0,1),(1,1),dxfattribs={'color':2,'true_color':0x123456})
        d.modelspace().add_text('BMP Ω / 😀',dxfattribs={'height':2})
        output,warnings=exchange.export_dxf(exchange.import_file(standard_bytes(d),'.dxf')['document'],'R2000')
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'colors.dxf';path.write_bytes(output);saved=ezdxf.readfile(path)
        self.assertEqual([line.dxf.color for line in saved.modelspace().query('LINE')],[146,2]);self.assertEqual(saved.layers.get('색 번호').dxf.color,3)
        self.assertFalse(any(e.dxf.hasattr('true_color') for e in saved.modelspace()));self.assertIn('BMP Ω / ?',output.decode('cp949'))
        self.assertTrue(any(w.startswith('2000·2004 DXF 에는 일부 특수 문자(') for w in warnings))

    def test_downgrade_keeps_local_wall_parameters_and_ids(self):
        d=ezdxf.new('R2018');d.units=4;d.modelspace().add_line((0,0),(100,0))
        original=exchange.import_file(standard_bytes(d),'.dxf')['document'];wall=model()['entities'][-1];wall['layer']=original['layers'][0]['id'];original['entities'].append(wall)
        output,_=exchange.export_dxf(original,'R2000');returned=exchange.import_file(output,'.dxf')['document']
        self.assertEqual([e['id'] for e in returned['entities']],[e['id'] for e in original['entities']])
        saved_wall=next(e for e in returned['entities'] if e['id']==wall['id']);self.assertEqual(saved_wall['type'],'wall');self.assertEqual(saved_wall['thickness'],wall['thickness']);self.assertEqual(saved_wall['openings'],wall['openings'])
        saved_wall['thickness']=300
        again,_=exchange.export_dxf(returned,'R2000');exchange.check_downgrade_bytes(again,'AC1015')
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'walls.dxf';path.write_bytes(again);saved=ezdxf.readfile(path)
        self.assertEqual(len(saved.modelspace().query('INSERT')),1);self.assertFalse(saved.audit().errors)

    def test_downgrade_without_native_payload_keeps_cleanup_on_resave(self):
        d=ezdxf.new('R2018');d.units=4;d.modelspace().add_text('큰 도면 한글')
        original=exchange.import_file(standard_bytes(d),'.dxf')['document'];original['padding']='x'*19_000_001
        output,_=exchange.export_dxf(original,'R2000');returned=exchange.import_file(output,'.dxf')
        self.assertFalse(returned['report']['nativeMetadata']);self.assertTrue(returned['document']['dxfPreservation']['downgraded'])
        again,_=exchange.export_dxf(returned['document'],'R2000');exchange.check_downgrade_bytes(again,'AC1015')
        self.assertIn('큰 도면 한글',again.decode('cp949'))

    def test_downgrade_multiple_outputs_do_not_duplicate_after_edit(self):
        for inverted in (False,True):
            with self.subTest(inverted=inverted):
                d=ezdxf.new('R2018');d.units=4;d.modelspace().add_line((0,0),(100,0))
                original=exchange.import_file(standard_bytes(d),'.dxf')['document'];layer=original['layers'][0]['id'];p=lambda x,y:{'x':x,'y':y}
                if inverted:
                    entity={'id':'clip','type':'block','name':'CLIP','layer':layer,'entities':[{'id':'outline','type':'rectangle','layer':layer,'points':[p(0,0),p(10,0),p(10,10),p(0,10)],'closed':True}],'clip':{'points':[p(2,2),p(8,2),p(8,8),p(2,8)],'enabled':True,'inverted':True}}
                else:
                    original['sharedBlocks']={'k':{'name':'SHARED','origin':p(0,0),'entities':[{'id':'child','type':'line','layer':layer,'points':[p(0,0),p(2,0)]}]}}
                    entity={'id':'shared','type':'block','sharedBlock':'k','layer':layer,'position':p(0,0),'entities':[{'id':'overlay','type':'text','layer':layer,'text':'덧글','height':1,'position':p(2,2)}]}
                original['entities'].append(entity);output,_=exchange.export_dxf(original,'R2000');returned=exchange.import_file(output,'.dxf')['document'];edited=next(e for e in returned['entities'] if e['id']==entity['id'])
                self.assertGreater(len(edited['sourceHandles']),1)
                if inverted:edited['clip']['points'][0]['x']=1
                else:edited['position']['x']=10
                again,_=exchange.export_dxf(returned,'R2000');third,_=exchange.export_dxf(exchange.import_file(again,'.dxf')['document'],'R2000')
                with tempfile.TemporaryDirectory() as tmp:
                    path=Path(tmp)/'parts.dxf';path.write_bytes(again);saved=ezdxf.readfile(path);path.write_bytes(third);resaved=ezdxf.readfile(path)
                self.assertEqual(len(saved.modelspace()),len(resaved.modelspace()));self.assertFalse(saved.audit().errors);self.assertFalse(resaved.audit().errors)
                if not inverted:self.assertEqual(len(saved.modelspace().query('TEXT')),1);self.assertEqual(len(saved.modelspace().query('INSERT')),1)

    def test_downgrade_resave_rgb_edit_updates_aci_and_preservation(self):
        d=ezdxf.new('R2018');d.units=4;d.modelspace().add_line((0,0),(10,0))
        output,_=exchange.export_dxf(exchange.import_file(standard_bytes(d),'.dxf')['document'],'R2000');returned=exchange.import_file(output,'.dxf')['document']
        line=returned['entities'][0];line.update(colorMode='truecolor',color='#123456')
        again,_=exchange.export_dxf(returned,'R2000');latest=exchange.import_file(again,'.dxf')['document'];self.assertEqual(latest['entities'][0]['aci'],146)
        third,_=exchange.export_dxf(latest,'R2000')
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'color-edit.dxf';path.write_bytes(third);saved=ezdxf.readfile(path)
        self.assertEqual(saved.modelspace().query('LINE')[0].dxf.color,146);self.assertEqual(len(saved.modelspace().query('LINE')),1)

    def test_preserved_older_dxf_version_is_not_a_save_warning(self):
        d=ezdxf.new('R2013');d.units=4;d.modelspace().add_line((0,0),(1000,0))
        _,warnings=exchange.export_dxf(exchange.import_file(standard_bytes(d),'.dxf')['document'],'R2018')
        self.assertIn('원본 보존을 위해 처음 DXF 버전(2013)을 유지했습니다.',warnings)
        self.assertFalse(any('고른 버전으로 저장되지 않았습니다' in w for w in warnings))

    def test_extended_entities_have_editable_xy_preview(self):
        d=ezdxf.new('R2018',setup=True);d.units=4;m=d.modelspace()
        m.add_leader([(0,0),(100,100),(200,100)])
        m.add_mline([(0,0),(500,0)])
        m.add_xline((0,0),(1,0));m.add_ray((0,0),(0,1))
        m.add_3dface([(0,0,10),(100,0,20),(100,100,30),(0,100,40)])
        m.add_wipeout([(0,0),(100,0),(100,100),(0,100)])
        result=exchange.import_file(standard_bytes(d),'.dxf')
        self.assertFalse(result['report']['skipped'])
        self.assertEqual([e['type'] for e in result['document']['entities']],['block','block','line','line','polyline','hatch'])
        self.assertTrue(result['document']['entities'][-1].get('wipeout'))   # ACAD200-411: WIPEOUT 은 가리기 해치로 읽는다
        self.assertTrue(all(e.get('sourceHandle') and e.get('sourceFingerprint') for e in result['document']['entities']))

    def test_unchanged_mtext_and_pattern_hatch_keep_native_properties(self):
        d=ezdxf.new('R2018',setup=True);d.units=4;m=d.modelspace()
        mt=m.add_mtext(r'{\\fArial|b1|i0;원본 문자}',dxfattribs={'char_height':37,'rotation':17,'attachment_point':5})
        hatch=m.add_hatch(color=3);hatch.set_pattern_fill('ANSI31',scale=2.5,angle=33)
        hatch.paths.add_polyline_path([(0,0),(100,0),(100,100),(0,100)],is_closed=True)
        imported=exchange.import_file(standard_bytes(d),'.dxf')
        output,warnings=exchange.export_dxf(imported['document'])
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'native-properties.dxf';path.write_bytes(output);saved=ezdxf.readfile(path)
        saved_mt=saved.modelspace().query('MTEXT')[0];saved_hatch=saved.modelspace().query('HATCH')[0]
        self.assertEqual(saved_mt.text,mt.text);self.assertEqual(saved_mt.dxf.char_height,37)
        self.assertEqual(saved_hatch.dxf.pattern_name,'ANSI31');self.assertAlmostEqual(saved_hatch.dxf.pattern_scale,2.5)
        self.assertTrue(any('원본 보존' in item for item in warnings))

    def test_compact_shared_blocks_export_one_definition_and_many_inserts(self):
        original=model();original['version']=3;original['entities']=[
            {'id':'r1','type':'block','name':'UNIT','sharedBlock':'unit','layer':'default','position':{'x':100,'y':200},'scale':2,'rotation':30,'entities':[]},
            {'id':'r2','type':'block','name':'UNIT','sharedBlock':'unit','layer':'default','position':{'x':900,'y':1200},'scale':1,'rotation':0,'entities':[]},
        ];original['sharedBlocks']={'unit':{'name':'UNIT','origin':{'x':10,'y':20},'entities':[{'id':'shared-line','type':'line','layer':'default','points':[{'x':10,'y':20},{'x':110,'y':20}]}]}}
        data,warnings=exchange.export_dxf(original)
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'shared.dxf';path.write_bytes(data);saved=ezdxf.readfile(path)
        refs=list(saved.modelspace().query('INSERT'));self.assertEqual(len(refs),2)
        self.assertEqual(refs[0].dxf.name,refs[1].dxf.name);self.assertAlmostEqual(refs[0].dxf.xscale,2);self.assertAlmostEqual(refs[0].dxf.rotation,30)
        definition=saved.blocks.get(refs[0].dxf.name);self.assertEqual(len(definition.query('LINE')),1);self.assertEqual(tuple(definition.base_point),(10,20,0))
        self.assertEqual(exchange.import_file(data,'.dxf')['document'],original);self.assertFalse(warnings)

    def test_one_hatch_with_several_picked_cells_is_one_dxf_hatch_with_many_loops(self):
        # 2026-09-30 대표 지적: 한 번의 HATCH 로 표 칸 4개를 찍으면 해치 하나(경계 루프 4개)여야 한다 — DXF 에도 HATCH 하나로 적고 다시 읽어도 하나.
        r=lambda x0,y0,x1,y1:[{'x':x0,'y':y0},{'x':x1,'y':y0},{'x':x1,'y':y1},{'x':x0,'y':y1}]
        cells=[r(0,0,1000,500),r(1000,0,2000,500),r(0,500,1000,1000),r(1000,500,2000,1000)]
        hole=r(400,200,600,300)  # 첫 칸 안의 섬(구멍)
        doc_model={'units':'mm','layers':[{'id':'L0','name':'0','color':'#ffffff'}],'entities':[
            {'id':'h1','type':'hatch','layer':'L0','points':cells[0],'loops':[cells[1],hole,cells[2],cells[3]],'pattern':'lines','spacing':100,'angle':45}]}
        self.assertEqual(exchange.hatch_loop_flags([cells[0],cells[1],hole,cells[2],cells[3]]),[1,1,0,1,1])
        data,_=exchange.export_dxf(doc_model)
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'cells.dxf';p.write_bytes(data);d=ezdxf.readfile(p)
        hs=d.modelspace().query('HATCH');self.assertEqual(len(hs),1)
        paths=list(hs[0].paths);self.assertEqual(len(paths),5)
        self.assertEqual([bool(path.path_type_flags&1) for path in paths],[True,True,False,True,True])
        self.assertFalse(d.audit().has_errors)
        native=exchange.import_file(data,'.dxf')['document']['entities']
        self.assertEqual([e['type'] for e in native],['hatch']);self.assertEqual(len(native[0]['loops']),4)
        del d.rootdict['BARUN_CAD_V2'];foreign=exchange.import_file(standard_bytes(d),'.dxf')['document']['entities']
        self.assertEqual([e['type'] for e in foreign],['hatch']);self.assertEqual(len(foreign[0]['loops']),4)
        rings=[foreign[0]['points'],*foreign[0]['loops']]
        self.assertEqual(sorted(round(abs(sum(a['x']*b['y']-b['x']*a['y'] for a,b in zip(g,g[1:]+g[:1]))/2)) for g in rings),[20000,500000,500000,500000,500000])
        # 예전처럼 따로 만든 해치(루프 하나씩)는 그대로 따로 나간다.
        separate={**doc_model,'entities':[{'id':f'h{i}','type':'hatch','layer':'L0','points':c,'loops':[],'solid':True} for i,c in enumerate(cells)]}
        data,_=exchange.export_dxf(separate)
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'separate.dxf';p.write_bytes(data);d=ezdxf.readfile(p)
        self.assertEqual(len(d.modelspace().query('HATCH')),4)

    def test_korean_block_name_keeps_native_record_and_furniture_3d(self):
        # 한글 이름 블록이 있으면 읽을 때 이름이 \U+XXXX 로 바뀌어 지문이 어긋났고, 바른 CAD 기록(가구 3D 높이 등)을 통째로 버렸다.
        original=model();original['layers'].append({**original['layers'][0],'id':'furn','name':'A-FURN'})
        rect=[{'x':1000,'y':1000},{'x':2400,'y':1000},{'x':2400,'y':3000},{'x':1000,'y':3000}]
        original['entities'].append({'id':'bed','type':'block','name':'가구-더블 침대','category':'LIBRARY','layer':'furn','position':{'x':1000,'y':1000},'rotation':0,
            'attributes':{'libraryId':'bed-double','width':1400,'length':2000},'model3d':{'height':600,'elevation':100,'color':'#abcdef'},'entities':[{'id':'bed-r','type':'rectangle','layer':'furn','points':rect}]})
        result=exchange.import_file(exchange.export_dxf(original)[0],'.dxf')
        self.assertTrue(result['report'].get('nativeMetadata'))
        bed=next(e for e in result['document']['entities'] if e.get('id')=='bed')
        self.assertEqual(bed['model3d'],{'height':600,'elevation':100,'color':'#abcdef'});self.assertEqual(bed['category'],'LIBRARY')
        # 옛 판 지문(이름을 풀지 않고 정렬)으로 기록된 파일도 그대로 열린다
        original['entities'].append({**original['entities'][-1],'id':'bed2','name':'a-bed','position':{'x':5000,'y':1000}})
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'legacy.dxf';path.write_bytes(exchange.export_dxf(original)[0])
            escaped=exchange.read_dxf_preserving_unicode(path,Path(tmp));self.assertTrue(any(b.name!=exchange.dxf_unicode(b.name) for b in escaped.blocks))
            legacy=exchange.geometry_fingerprint(escaped,decoded_order=False);self.assertNotEqual(legacy,exchange.geometry_fingerprint(escaped))
            doc=ezdxf.readfile(path);record=doc.rootdict['BARUN_CAD_V2']
            payload=json.loads(zlib.decompress(base64.b64decode(''.join(str(t.value) for t in record.tags if t.code==1))));payload['fingerprint']=legacy
            packed=base64.b64encode(zlib.compress(json.dumps(payload).encode())).decode('ascii');record.reset([(1,packed[i:i+240]) for i in range(0,len(packed),240)])
            doc.saveas(path);result=exchange.import_file(path.read_bytes(),'.dxf')
        self.assertTrue(result['report'].get('nativeMetadata'))

if __name__=='__main__':unittest.main(verbosity=2)


