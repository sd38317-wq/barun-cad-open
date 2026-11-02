import tempfile
import unittest
from pathlib import Path
import vault
import layer_standards_asset as asset
import json
import re
import generate_layer_standards as generator

class LayerStandardsAssetTests(unittest.TestCase):
    def test_missing_pack_returns_none(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertIsNone(asset.read_layer_standards(Path(d) / 'missing.pack'))

    def test_lisp_table_matches_canonical_template_records(self):
        records = generator.records()
        expected = {r['name'] for r in records if 'template' in r['groups']}
        text = (Path(__file__).parent / 'examples' / 'architecture-lisp' / '01_LAYSTD_레이어표준.lsp').read_text(encoding='utf8')
        block = text.split('(defun ARCH:표준레이어 ()', 1)[1].split('(defun ARCH:실수', 1)[0]
        actual = set(re.findall(r'\("([^"]+)"\s+\d+\s+"[^"]+"', block))
        self.assertEqual(actual, expected)

    def test_corrupt_pack_returns_none(self):
        with tempfile.TemporaryDirectory() as d:
            pack = Path(d) / 'layer-standards.pack'
            pack.write_bytes(b'BCV2' + b'corrupt')
            self.assertIsNone(asset.read_layer_standards(pack))

    def test_default_key_pack_returns_source_bytes(self):
        source = (Path(__file__).parent / 'layer-standards-data.js').read_bytes()
        with tempfile.TemporaryDirectory() as d:
            pack = Path(d) / 'layer-standards.pack'
            pack.write_bytes(vault.pack({'layer-standards-data.js': source}))
            self.assertEqual(asset.read_layer_standards(pack), source)
            self.assertEqual(asset.screen_file('layer-standards-data.js', pack), source)
            self.assertIsNone(asset.screen_file('other.js', pack))

if __name__ == '__main__': unittest.main()
