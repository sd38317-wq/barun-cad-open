"""Standard drawing documents, mapping and all generated layer tables must agree."""
import json
import re
import unittest
from pathlib import Path

import generate_layer_standards as generator

ROOT = Path(__file__).resolve().parent


def read_json(name):
    return json.loads((ROOT / name).read_bytes())


class StandardDrawingLayersTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mapping = read_json('rules/knowledge/layer-map-standard-drawings.json')
        cls.layers = {x['name']: x for x in generator.records()}
        cls.entries = {x['source']: x for x in cls.mapping['layers']}

    def test_sources_targets_counts_and_contexts(self):
        self.assertEqual(len(self.entries), len(self.mapping['layers']))
        added = set(self.mapping['addedLayerNames'])
        normalized = {}
        for entry in self.entries.values():
            self.assertEqual(set(entry), {'source', 'barun', 'purpose', 'added', 'note'})
            self.assertIn(entry['barun'], self.layers)
            self.assertEqual(entry['added'], entry['barun'] in added)
            self.assertRegex(entry['purpose'], '[가-힣]')
            self.assertTrue(entry['note'])
            name = entry['source'].rsplit('$', 1)[-1].rsplit('|', 1)[-1]
            if name in normalized:
                self.assertEqual(entry['barun'], normalized[name]['barun'])
            normalized[name] = entry
        counts = self.mapping['counts']
        self.assertEqual(counts['sourceRecords'], len(self.entries))
        self.assertEqual(counts['normalizedSources'], len(normalized))
        self.assertEqual(counts['mappedToExisting'], sum(not x['added'] for x in normalized.values()))
        self.assertEqual(counts['mappedToAdded'], sum(x['added'] for x in normalized.values()))
        self.assertEqual(counts['addedLayers'], len(added))
        for rule in self.mapping['contextOverrides']:
            self.assertIn(rule['source'], self.entries)
            self.assertIn(rule['barun'], self.layers)
            text = (ROOT / rule['document']).read_bytes().decode('utf8')
            for section in rule['sections']:
                part = re.split(r'^## ', text, flags=re.M)
                matching = [s for s in part if s.startswith(section + ' ') or s.startswith(section + '.')]
                self.assertEqual(len(matching), 1, (rule['source'], section))
                self.assertIn(rule['barun'], matching[0])

    def test_shorthand_ranges_xrefs_and_unusual_sources_are_retained(self):
        for prefix, suffixes in {
            'A-ST-AXIS-': ['CEN', 'BUB', 'DIM'],
            'A-DETL-PEN': [*map(str, range(1, 10)), '251', '253'],
            'A-ELEV-MATR': list(map(str, range(1, 5))),
            'A-ELEV-OUT': ['1', '2', '3', '4', '6'],
            'A-SITE-UTIL-': ['MECH', 'ELEC', 'FIRE'],
            'A-FLOR-TOIL-': ['PFIX', 'WALL', 'SPCL'],
            'A-WIN': ['', '-GLAS', '-SILL'],
            'A-DOOR': ['', '-JAMB', '-SWNG', '-SILL'],
        }.items():
            for suffix in suffixes:
                self.assertIn(prefix + suffix, self.entries)
        for name in ['0', '8', 'Defpoints', 'WALL-INSU', 'HDR', 'COMM', 'ALUM',
                     'Catwalk', 'WELD', 'CL', 'SHBD', 'FIN1', 'FUR', 'WALL',
                     'COLU', 'DR', 'CONCRETE SOLIDE', 'C02-AA$0$A-SECT-CLNG']:
            self.assertIn(name, self.entries)
        for pattern in self.mapping['sourcePatterns']:
            for name in pattern['expanded']:
                self.assertIn(name, self.entries)
        # These two names denote blocks in the source, not layer records.
        self.assertNotIn('A-ST-AXIS-BUB-1', self.entries)
        self.assertNotIn('A-DOOR-IDEN', self.entries)

    def test_documents_only_use_canonical_names_and_exact_layer_properties(self):
        notation = re.compile(r'\b([AS]-[A-Z][A-Z0-9-]*)\((#[0-9a-f]{6})·([A-Z]+)·([0-9.]+) mm(·비출력)?\)')
        for filename in self.mapping['sourceDocuments']:
            text = (ROOT / filename).read_bytes().decode('utf8')
            self.assertIn('레이어는 바른 CAD 표준 레이어 세트, 원본 대응은 layer-map-standard-drawings.json', text.splitlines()[:3])
            names = set(re.findall(r'\b[ASG]-[A-Z][A-Z0-9-]*', text))
            self.assertFalse(names - self.layers.keys(), (filename, names - self.layers.keys()))
            for name, color, linetype, weight, nonplot in notation.findall(text):
                layer = self.layers[name]
                self.assertEqual((color, linetype, float(weight), bool(nonplot)),
                                 (layer['color'], layer['linetype'], layer['lineweight'], not layer['plot']), name)
            in_table = False
            for line in text.splitlines():
                if line.startswith('| 무리 |'):
                    in_table = True
                elif in_table and not line.startswith('|'):
                    in_table = False
                elif in_table and not line.startswith('|---'):
                    cell = line.split('|')[2]
                    self.assertTrue(notation.search(cell), (filename, line))
                    self.assertEqual(set(re.findall(r'\b[AS]-[A-Z][A-Z0-9-]*', cell)),
                                     {x[0] for x in notation.findall(cell)})
            self.assertNotRegex(text, r'157번|STD_PROPERTY|STD_CENTER|STD_SHAFT|STD_WIREMESH|251~254|TEXT[12]|C02-AA\$0\$')
            self.assertIn('BYLAYER', text)

    def test_added_layers_reach_usage_ui_and_every_lisp_table(self):
        self.assertEqual((ROOT / 'layer-standards-data.js').read_bytes(), generator.rendered().encode('utf8'))
        usage = read_json('rules/knowledge/layer-usage.json')['elements']
        used = {x['layer'] for x in usage}
        table = generator.lisp_table().encode('utf8')
        files = list((ROOT / 'examples/architecture-lisp').glob('*.lsp'))
        self.assertTrue(files)
        for name in self.mapping['addedLayerNames']:
            self.assertIn(name, used)
            self.assertTrue(name.startswith('A-'))
            self.assertTrue(set(self.layers[name]['groups']) & {'template', 'sitePlan', 'onDemand'})
        for path in files:
            self.assertIn(table, path.read_bytes().replace(b'\r\n', b'\n'), path.name)

    def test_axes_dimension_text_and_nonprinting_guide_roles(self):
        expected = {'A-ST-AXIS-CEN': 'A-GRID', 'A-ST-AXIS-BUB': 'A-GRID-IDEN',
                    'A-ST-AXIS-DIM': 'A-DIM', 'A-ANNO-DIM': 'A-DIM',
                    'A-ANNO-TEXT1': 'A-TEXT', 'A-ANNO-TEXT2': 'A-TEXT',
                    'A-FLOR-INSL': 'A-WALL-INSL', 'A-SITE-LINE-BLIM': 'A-SITE-BLINE'}
        for source, target in expected.items():
            self.assertEqual(self.entries[source]['barun'], target)
            self.assertFalse(self.entries[source]['added'])
        guide = self.entries['A-ANNO-NPLT']['barun']
        self.assertFalse(self.layers[guide]['plot'])
        self.assertNotEqual(guide, 'A-PLOT')
        self.assertNotEqual(self.entries['A-CODE-FIRL']['barun'], 'A-FIRE')
        self.assertEqual([n for n in self.layers if n.startswith('S-')],
                         ['S-GRID', 'S-COLS', 'S-BEAM', 'S-SLAB', 'S-WALL', 'S-BRCE', 'S-FNDN', 'S-ANNO'])

    def test_normalized_names_sets_and_inventory(self):
        expected = {
            'template': {'A-FLOR-FNSH'},
            'sitePlan': {'A-ENV-LIMT', 'A-BLDG-DN', 'A-SITE-PAVE', 'A-SITE-UTIL'},
            'onDemand': {'A-SECT', 'A-SECT-GRND', 'A-CLNG', 'A-GUIDE',
                         'A-WPRO', 'A-FIRE-COMP', 'A-SECT-FIRE', 'A-GLAZ-OPEN', 'A-REF'},
        }
        self.assertEqual(set(self.mapping['addedLayerNames']), set.union(*expected.values()))
        for group, names in expected.items():
            for name in names:
                self.assertEqual(self.layers[name]['groups'], [group], name)
        self.assertEqual(len(self.layers), 99)   # + A-DIM-MAJR(평면 큰 치수)·A-SITE-BND(검토 대지 경계)
        self.assertEqual({g: sum(g in l['groups'] for l in self.layers.values()) for g in expected},
                         {'template': 45, 'sitePlan': 26, 'onDemand': 35})
        for retired in ['A-SECT-SOIL', 'A-ELEV-BACK', 'A-ANNO-LEVL', 'A-ANNO-KEYP', 'A-BLDG-BELO']:
            self.assertNotIn(retired, self.layers)
        for source, target in {'A-SECT-SOIL-PAT1': 'A-HATCH', 'A-ANNO-KEY': 'A-SYM',
                               'A-ANNO-PONT': 'A-SYM'}.items():
            self.assertEqual(self.entries[source]['barun'], target)
            self.assertFalse(self.entries[source]['added'])
        inventory = (ROOT / 'docs/바른레이어_전체_2026-10-23.md').read_bytes().decode('utf8')
        rows = [line.split('|') for line in inventory.splitlines() if line.startswith('| A-') or line.startswith('| S-')]
        actual = [row for row in rows if len(row) == 9]
        self.assertEqual(len(actual), 45 + 26 + 35)
        for name, layer in self.layers.items():
            matches = [row for row in actual if row[1].strip() == name]
            self.assertEqual(len(matches), sum(g in expected for g in layer['groups']), name)
            for row in matches:
                self.assertEqual(row[2].strip(), layer['description'])
                self.assertEqual(row[3].strip(), layer['color'])
                self.assertEqual(row[4].strip(), layer['linetype'])
                self.assertEqual(float(row[5].strip()), layer['lineweight'])
                self.assertEqual(row[6].strip(), '예' if layer['plot'] else '아니오')
                self.assertEqual(bool(row[7].strip()), name in self.mapping['addedLayerNames'] or name == 'A-GRID-IDEN')

    def test_lisp_loads_every_required_linetype_before_creating_layers(self):
        table = generator.lisp_table()
        prelude = table.split('(foreach x', 1)[0]
        required = {x['linetype'] for x in self.layers.values() if 'template' in x['groups']} - {'CONTINUOUS'}
        for name in required:
            self.assertIn('"' + name + '"', prelude)
        self.assertIn('(tblsearch "LTYPE" lt)', prelude)
        self.assertIn('(command "_.-linetype" "_load" lt "acad.lin" "")', prelude)
        for source in ['A-FLOR-GRID', 'A-FLOR-ROOF-FIN', 'A-FLOR-ROOF-EJ', 'A-FLOR-FLIN-TYP1', 'A-FLOR-FLIN-TYP2']:
            self.assertEqual(self.entries[source]['barun'], 'A-FLOR-FNSH')


if __name__ == '__main__':
    unittest.main()
