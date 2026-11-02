import json
import importlib.util
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

HERE = Path(__file__).resolve().parent


class PreparedDocumentTests(unittest.TestCase):
    def test_process_timeout_keeps_last_renderer_checkpoint(self):
        spec = importlib.util.spec_from_file_location('quality_inspect', HERE/'inspect-drawing.py')
        inspection = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(inspection)
        with tempfile.TemporaryDirectory(dir=HERE, prefix='timeout-test-') as temporary:
            folder = Path(temporary)
            source = folder/'source.json'
            source.write_text('{"entities":[]}', encoding='utf-8')
            out = folder/'case'
            def fake_process(command, env, log, timeout):
                if '--import-child' in command:
                    (out/'prepared.json').write_text('{"entities":[]}', encoding='utf-8')
                    return 0
                (out/'renderer.json').write_text(json.dumps({'lastCheck':'MOVE_API','checks':[
                    {'name':'OPEN','status':'passed'}]}), encoding='utf-8')
                raise subprocess.TimeoutExpired(command, timeout)
            with mock.patch.object(sys, 'argv', ['inspect-drawing.py','--file',str(source),'--out',str(out)]), \
                 mock.patch.object(inspection, 'bounded', side_effect=fake_process), \
                 mock.patch('builtins.print'):
                inspection.main()
            result = json.loads((out/'result.json').read_text(encoding='utf-8'))
            self.assertEqual(result['status'], 'timeout')
            self.assertEqual(result['renderer']['lastCheck'], 'MOVE_API')
            self.assertEqual(result['renderer']['checks'][0]['status'], 'passed')
            self.assertTrue(result['originalUnchanged'])

    def test_unicode_and_isolated_surrogates_round_trip_without_source_edits(self):
        with tempfile.TemporaryDirectory(dir=HERE, prefix='serialization-test-') as temporary:
            folder = Path(temporary)
            source = folder/'source.json'
            document = {'entities': [], 'text': '한글\ud800 x \udfff🙂'}
            original = json.dumps(document).encode('utf-8')
            source.write_bytes(original)
            process = subprocess.run([sys.executable, str(HERE/'inspect-drawing.py'),
                                      '--import-child', '--prepared-json', '--file', str(source),
                                      '--out', str(folder)], capture_output=True, timeout=20)
            self.assertEqual(process.returncode, 0)
            prepared = (folder/'prepared.json').read_text(encoding='utf-8')
            self.assertEqual(json.loads(prepared), document)
            self.assertEqual(source.read_bytes(), original)

    def test_invalid_document_is_rejected(self):
        with tempfile.TemporaryDirectory(dir=HERE, prefix='serialization-test-') as temporary:
            folder = Path(temporary)
            source = folder/'source.json'
            source.write_text('{"entities":null}', encoding='utf-8')
            process = subprocess.run([sys.executable, str(HERE/'inspect-drawing.py'),
                                      '--import-child', '--prepared-json', '--file', str(source),
                                      '--out', str(folder)], capture_output=True, timeout=20)
            self.assertNotEqual(process.returncode, 0)
            self.assertFalse((folder/'prepared.json').exists())


if __name__ == '__main__':
    unittest.main()
