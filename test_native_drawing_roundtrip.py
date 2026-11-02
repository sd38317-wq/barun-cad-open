import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import ezdxf
import exchange


def drawing():
    walls=[{'id':'wall-'+str(i),'type':'wall','layer':'default','points':[{'x':0,'y':i*1000},{'x':6000,'y':i*1000}],'thickness':200,'openings':[[.3,.5]]} for i in range(6)]
    for entity in walls:entity['drawingSet']={'id':'plan','entity':entity['id']}
    return {'version':2,'units':'mm','layers':[{'id':'default','name':'벽체','color':'#79d4ff','visible':True,'locked':False,'lineweight':.25,'linetype':'CONTINUOUS'}],
            'entities':walls,'blocks':[],
            'drawingSets':{'plan':{'kind':'plan','model':{'stories':[{'id':'1층'}],'elements':[{'id':'w1','kind':'wall'}]},'baseline':{entity['id']:['hash',3000,i*1000] for i,entity in enumerate(walls)}},
                           'section':{'kind':'section','model':{'elements':[]}},'windows':{'kind':'schedule','model':{'elements':[]}}}}


class NativeDrawingRoundtrip(unittest.TestCase):
    def test_six_walls_and_all_drawing_sets_roundtrip(self):
        original=drawing();raw,_=exchange.export_dxf(original);opened=exchange.import_file(raw,'.dxf')
        self.assertTrue(opened['report']['nativeMetadata'])
        self.assertEqual(opened['document']['entities'],original['entities'])
        self.assertEqual(opened['document']['drawingSets'],original['drawingSets'])

    def test_large_metadata_uses_compact_record_without_readback_or_global_fingerprint(self):
        original=drawing();original['largeUnrelatedCache']='x'*19_000_001
        with patch('exchange.ezdxf.readfile',side_effect=AssertionError('large export must not read back')),patch('exchange.geometry_fingerprint',side_effect=AssertionError('no whole drawing fingerprint')):
            raw,_=exchange.export_dxf(original)
        self.assertIn(exchange.NATIVE_EXTENSION_RECORD.encode(),raw)
        opened=exchange.import_file(raw,'.dxf');self.assertTrue(opened['report']['nativeExtensions'])
        self.assertEqual(opened['document']['entities'],original['entities'])
        self.assertEqual(opened['document']['drawingSets'],original['drawingSets'])
        self.assertTrue(all(e['layer'] in {layer['id'] for layer in opened['document']['layers']} for e in opened['document']['entities']))

    def test_repeated_compact_roundtrip_keeps_wall_ids_without_duplicate_geometry(self):
        original=drawing()
        with patch('exchange.NATIVE_FULL_LIMIT',1):
            for _ in range(3):
                raw,_=exchange.export_dxf(original);original=exchange.import_file(raw,'.dxf')['document']
                self.assertEqual(len(original['entities']),6)
                self.assertEqual([e['type'] for e in original['entities']],['wall']*6)
                self.assertEqual(original['drawingSets'],drawing()['drawingSets'])

    def test_shared_definition_detection_is_memoized_across_many_references(self):
        class CountedChildren(list):
            visits=0
            def __iter__(self):
                self.visits+=1
                return super().__iter__()
        children=CountedChildren([{'type':'line','id':'ordinary'}]*1000)
        model={'drawingSets':{},'sharedBlocks':{'symbol':{'entities':children}}}
        detect=exchange._native_extension_filter(model)
        references=[{'type':'block','id':str(i),'sharedBlock':'symbol'} for i in range(5000)]
        self.assertFalse(any(detect(entity) for entity in references))
        self.assertEqual(children.visits,1)

    def test_nested_regular_block_wall_keeps_parametric_type(self):
        original=drawing();original.pop('drawingSets');wall=original['entities'][0];wall.pop('drawingSet');wall['openings']=[]
        original['entities']=[{'id':'outer','type':'block','layer':'default','name':'nested','entities':[{'id':'inner','type':'block','layer':'default','entities':[wall]}]}]
        with patch('exchange.NATIVE_FULL_LIMIT',1):
            for _ in range(2):
                raw,_=exchange.export_dxf(original);result=exchange.import_file(raw,'.dxf')
                self.assertTrue(result['report']['nativeExtensions'])
                self.assertEqual(result['document']['entities'],original['entities'])
                original=result['document']

    def test_repeated_shared_block_wall_uses_one_definition_and_restores_links(self):
        original=drawing();original.pop('drawingSets');wall=original['entities'][0];wall.pop('drawingSet')
        original['sharedBlocks']={'wall-symbol':{'origin':{'x':0,'y':0},'entities':[wall]}};original['version']=3
        original['entities']=[{'id':'ref-'+str(i),'type':'block','layer':'default','sharedBlock':'wall-symbol','position':{'x':i*10000,'y':0},'scale':1,'rotation':0,'entities':[]} for i in range(3)]
        with patch('exchange.NATIVE_FULL_LIMIT',1):
            for _ in range(2):
                raw,_=exchange.export_dxf(original);result=exchange.import_file(raw,'.dxf')
                self.assertTrue(result['report']['nativeExtensions'])
                self.assertEqual(result['document']['entities'],original['entities'])
                self.assertEqual(result['document']['sharedBlocks']['wall-symbol'],original['sharedBlocks']['wall-symbol'])
                original=result['document']

    def test_external_owned_block_geometry_edit_does_not_restore_stale_walls(self):
        with patch('exchange.NATIVE_FULL_LIMIT',1):raw,_=exchange.export_dxf(drawing())
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'edited.dxf';path.write_bytes(raw);doc=ezdxf.readfile(path)
            ref=next(iter(doc.modelspace()));line=next(iter(doc.blocks.get(ref.dxf.name)));line.dxf.end=(99999,99999,0);doc.saveas(path)
            result=exchange.import_file(path.read_bytes(),'.dxf')
        self.assertFalse(result['report'].get('nativeExtensions'))
        self.assertNotIn('drawingSets',result['document'])
        self.assertTrue(any('외부 수정' in warning for warning in result['report']['warnings']))

    def test_corrupt_extensions_fall_back_to_current_dxf(self):
        with patch('exchange.NATIVE_FULL_LIMIT',1):raw,_=exchange.export_dxf(drawing())
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'corrupt.dxf';path.write_bytes(raw);doc=ezdxf.readfile(path)
            doc.rootdict[exchange.NATIVE_EXTENSION_RECORD].reset([(1,'not compressed')]);doc.saveas(path)
            result=exchange.import_file(path.read_bytes(),'.dxf')
        self.assertEqual(len(result['document']['entities']),6)
        self.assertFalse(result['report'].get('nativeExtensions'))

    def test_plain_large_drawing_keeps_single_write_without_extensions(self):
        original=drawing();original.pop('drawingSets');original['entities']=[{'id':'l1','layer':'default','type':'line','points':[{'x':0,'y':0},{'x':100,'y':0}]}]
        with patch('exchange.NATIVE_FULL_LIMIT',1),patch('exchange.ezdxf.readfile',side_effect=AssertionError('large export must not read back')):raw,_=exchange.export_dxf(original)
        self.assertNotIn(exchange.NATIVE_EXTENSION_RECORD.encode(),raw)

    def test_large_roundtrip_preserves_linked_door_window_openings(self):
        original=drawing();wall=original['entities'][0];wall.pop('drawingSet')
        door={'id':'door-1','type':'block','category':'DOOR','layer':'default','hostWall':wall['id'],'hostOffset':.25,'openingWidth':900,'position':{'x':1500,'y':0},'parameters':{'width':900,'height':2100},'entities':[{'type':'line','layer':'default','points':[{'x':0,'y':0},{'x':900,'y':0}]}]}
        window={'id':'window-1','type':'block','category':'WINDOW','layer':'default','hostWall':wall['id'],'hostOffset':.65,'openingWidth':1500,'position':{'x':3900,'y':0},'parameters':{'width':1500,'height':1200,'sill':900},'entities':[{'type':'line','layer':'default','points':[{'x':0,'y':0},{'x':1500,'y':0}]}]}
        original['entities']=[wall,door,window];wall['openingLinks']={'door-1':[.25,.4],'window-1':[.65,.9]};original['largeUnrelatedCache']='x'*19_000_001
        with patch('exchange.ezdxf.readfile',side_effect=AssertionError('large export must not read back')):
            raw,_=exchange.export_dxf(original)
        self.assertIn(exchange.NATIVE_EXTENSION_RECORD.encode(),raw)
        opened=exchange.import_file(raw,'.dxf')
        self.assertTrue(opened['report']['nativeExtensions'])
        by_id={e['id']:e for e in opened['document']['entities']}
        # Verify the restored wall is interpreted by the real geometry engine with two faces (one door and one window hole).
        script="import {DrawingEngine} from './engine.js'; import {wallPolygons} from './geometry.js'; let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{const raw=JSON.parse(d); const document={...raw,blocks:[],entities:raw.entities.filter(e=>e.id==='wall-0'||e.hostWall).map(e=>e.hostWall?({...e,name:e.name||e.category||'OPENING',entities:[{type:'line',layer:e.layer,points:[{x:0,y:0},{x:e.openingWidth,y:0}]}]}):e)}; const engine=new DrawingEngine(); engine.execute({type:'load',document}); const w=engine.doc.entities.find(e=>e.id==='wall-0'); const openings=engine.doc.entities.filter(e=>e.hostWall===w.id); process.stdout.write(JSON.stringify({faces:wallPolygons(w).length,openings:openings.map(e=>[e.id,e.hostWall,e.openingWidth])}));});"
        check=subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(opened['document']).encode(),cwd=Path(__file__).parent,capture_output=True)
        self.assertEqual(check.returncode,0,check.stderr.decode())
        self.assertEqual(json.loads(check.stdout), {'faces':3,'openings':[['door-1','wall-0',900],['window-1','wall-0',1500]]})
        self.assertEqual(by_id['door-1']['hostWall'],'wall-0')
        self.assertEqual(by_id['door-1']['openingWidth'],900)
        self.assertEqual(by_id['window-1']['hostWall'],'wall-0')
        self.assertEqual(by_id['window-1']['openingWidth'],1500)

    def test_review_metadata_roundtrip_full_and_compact(self):
        for compact in (False,True):
            original=drawing();original['reviewObjectSeq']={'door':12};original['reviewHistory']=[{'at':'now','targetId':'doc:D-12','prevStatus':'revise','nextStatus':'satisfied'}];original['reviewInput']={'road':{'measured':None,'assumed':True}}
            original['entities'].append({'id':'review-line','type':'line','layer':'default','points':[{'x':0,'y':0},{'x':100,'y':0}],'reviewObjectId':'EW-01','reviewInput':{'riseMm':None}})
            with patch('exchange.NATIVE_FULL_LIMIT',1 if compact else 19_000_000):
                raw,_=exchange.export_dxf(original);opened=exchange.import_file(raw,'.dxf')['document']
            for key in ('reviewObjectSeq','reviewHistory','reviewInput'):self.assertEqual(opened[key],original[key])
            restored=next(e for e in opened['entities'] if e['id']=='review-line');self.assertEqual(restored['reviewObjectId'],'EW-01');self.assertEqual(restored['reviewInput'],{'riseMm':None})

if __name__=='__main__':unittest.main()
