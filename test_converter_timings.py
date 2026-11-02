import unittest
from unittest.mock import patch
from pathlib import Path

import batch_converter


class ConverterTimingContractTests(unittest.TestCase):
    def test_success_report_exposes_structured_timings(self):
        report = {
            'path': 'out.dxf', 'bytes': 10, 'warnings': [],
            'engineWarnings': [], 'warningCount': 0, 'before': 1, 'after': 1,
            'engine': 'ACadSharp 3.7.1', 'engine_version': 'ACadSharp 3.7.1',
            'route': 'acadsharp',
            'timings_ms': {'engine_prepare': 1.0, 'process_start': 2.0,
                           'dwg_parse': 3.0, 'dxf_write': 4.0,
                           'dxf_verify_read': 5.0},
        }
        with patch.object(batch_converter, '_process', return_value=report):
            result = batch_converter.process({'action': 'convert'})
        self.assertEqual(result['engine_version'], 'ACadSharp 3.7.1')
        self.assertEqual(result['route'], 'acadsharp')
        self.assertEqual(result['timings_ms']['dxf_verify_read'], 5.0)

    def test_deferred_validation_flag_is_internal_and_explicit(self):
        source = Path('batch_converter.py').read_text(encoding='utf-8')
        self.assertIn("data.get('_defer_dxf_validation')", source)
        self.assertIn("'deferred_validation':defer_dxf_validation", source)


if __name__ == '__main__':
    unittest.main()
