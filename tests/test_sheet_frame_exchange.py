import tempfile
from pathlib import Path
import sys
import json
import subprocess

import ezdxf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import exchange


def _frame_model():
    return {
        'version': 3, 'units': 'mm',
        'layers': [{'id': 'G-BORD-FORM', 'name': 'G-BORD-FORM', 'color': '#ffffff'},
                   {'id': 'G-BORD-TEXT', 'name': 'G-BORD-TEXT', 'color': '#ffffff'}],
        'sharedBlocks': {
            '바른도곽_A3': {'origin': {'x': 0, 'y': 0}, 'entities': [
                {'type': 'line', 'layer': 'G-BORD-FORM', 'points': [{'x': 0, 'y': 0}, {'x': 100, 'y': 0}]},
                {'type': 'text', 'layer': 'G-BORD-TEXT', 'position': {'x': 5, 'y': 5},
                 'text': '', 'height': 2.5, 'align': 'right', 'widthFactor': .5,
                 'attdef': {'tag': 'PROJECT', 'default': '',
                 'prompt': '공사명', 'verify': True, 'preset': True}},
            ]}},
        'entities': [{'id': 'sheet', 'type': 'block', 'name': '바른도곽_A3',
                      'sharedBlock': '바른도곽_A3', 'layer': 'G-BORD-FORM',
                      'position': {'x': 10, 'y': 20}, 'scale': 1, 'rotation': 0,
                      'entities': [{'type': 'text', 'layer': 'G-BORD-TEXT',
                                    'position': {'x': 5, 'y': 5}, 'text': '학교 증축',
                                    'height': 2.5, 'attributeTag': 'PROJECT'}],
                      'attributes': {'PROJECT': '학교 증축'}}],
    }


def test_attdef_and_attrib_survive_dxf_roundtrip():
    raw, warnings = exchange.export_dxf(_frame_model())
    assert not warnings
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / 'frame.dxf'
        source.write_bytes(raw)
        native = ezdxf.readfile(source)
        assert len(native.modelspace().query('INSERT')) == 1
        ref = native.modelspace().query('INSERT')[0]
        assert [(a.dxf.tag, a.dxf.text) for a in ref.attribs] == [('PROJECT', '학교 증축')]
        native_attdef = native.blocks.get('바른도곽_A3').query('ATTDEF')[0]
        assert native_attdef.dxf.halign == 2 and native_attdef.dxf.width == .5
        imported = exchange.import_file(raw, '.dxf')['document']
        definition = imported['sharedBlocks']['바른도곽_A3']
        attdef = next(e for e in definition['entities'] if e.get('attdef'))
        assert attdef['attdef']['tag'] == 'PROJECT'
        assert attdef['attdef']['prompt'] == '공사명'
        assert attdef['attdef']['verify'] and attdef['attdef']['preset']
        assert imported['entities'][0]['attributes'] == {'PROJECT': '학교 증축'}


def test_generated_sheet_frame_exports_as_one_insert(tmp_path):
    script = r"""
import {blankDocument} from './engine.js';
import {makePen} from './drawing-generator.js';
import {drawSheetFrame} from './sheet-layout.js';
const p=makePen(blankDocument());
drawSheetFrame(p.at(0,0),{at:{x:1000,y:-2000},k:100,fields:{project:'학교 증축',title:'평면도',number:'A-101',sheetIndex:1,sheetCount:1}});
console.log(JSON.stringify((await p.result()).document));
"""
    result = subprocess.run(['node', '--input-type=module', '-e', script], cwd=Path(__file__).resolve().parents[1],
                            check=True, capture_output=True, text=True, encoding='utf-8')
    document = json.loads(result.stdout)
    entities = document['entities']
    inserts = [e for e in entities if e.get('type') == 'block']
    assert len(inserts) == 1
    assert len(document.get('sharedBlocks', {})) == 1
    assert inserts[0]['attributes']['PROJECT'] == '학교 증축'
    raw, warnings = exchange.export_dxf(document)
    assert not warnings
    source = tmp_path / 'generated.dxf'; source.write_bytes(raw)
    native = ezdxf.readfile(source)
    assert len(native.modelspace().query('INSERT')) == 1
    ref = native.modelspace().query('INSERT')[0]
    assert {a.dxf.tag: a.dxf.text for a in ref.attribs}['PROJECT'] == '학교 증축'
    block = next(b for b in native.blocks if b.name.startswith('바른도곽'))
    assert len(block.query('ATTDEF')) >= 1
    # Force the ordinary DXF parser path instead of any private BARUN metadata
    # shortcut, which is the path used by external CAD files.
    for key in list(native.rootdict.keys()):
        if key.startswith('BARUN_CAD'):
            del native.rootdict[key]
    stripped = tmp_path / 'generated-stripped.dxf'; native.saveas(stripped)
    roundtrip = exchange.import_file(stripped.read_bytes(), '.dxf')['document']
    definition = roundtrip['sharedBlocks'][roundtrip['entities'][0]['sharedBlock']]
    assert 'sheetSignature' not in definition
    definitions = [e for e in definition['entities'] if e.get('attdef')]
    assert len(definitions) == len(inserts[0]['attributes'])
    assert next(e for e in definitions if e['attdef']['tag'] == 'SHEET_COUNT')['align'] == 'right'
    reuse_script = r"""
import {makePen} from './drawing-generator.js';
import {drawSheetFrame} from './sheet-layout.js';
import {materializeSharedDrawingReference} from './geometry.js';
let data='';for await(const chunk of process.stdin)data+=chunk;
const doc=JSON.parse(data), p=makePen(doc);
drawSheetFrame(p.at(0,0),{at:{x:50000,y:0},k:50,fields:{project:'새 공사',title:'입면도',number:'A-201'}});
const result=(await p.result()).document;
const old=materializeSharedDrawingReference(result,result.entities[0]);
console.log(JSON.stringify({definitions:Object.keys(result.sharedBlocks).length,keys:result.entities.map(e=>e.sharedBlock),project:old.entities.filter(e=>e.attributeTag==='PROJECT').map(e=>e.text)}));
"""
    reused = subprocess.run(['node', '--input-type=module', '-e', reuse_script],
                            cwd=Path(__file__).resolve().parents[1], input=json.dumps(roundtrip),
                            capture_output=True, text=True, encoding='utf8', check=True)
    reuse = json.loads(reused.stdout)
    assert reuse['definitions'] == 1
    assert len(set(reuse['keys'])) == 1
    assert reuse['project'] == ['학교 증축']
    raw2, warnings2 = exchange.export_dxf(roundtrip)
    assert isinstance(raw2, bytes)
    with tempfile.TemporaryDirectory() as tmp:
        path2 = Path(tmp) / 'roundtrip.dxf'; path2.write_bytes(raw2)
        reopened = ezdxf.readfile(path2)
    ref2 = reopened.modelspace().query('INSERT')[0]
    assert {a.dxf.tag: a.dxf.text for a in ref2.attribs}['PROJECT'] == '학교 증축'
