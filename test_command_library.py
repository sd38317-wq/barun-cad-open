from unittest.mock import patch
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
import bridge
import command_library

ROOT = Path(__file__).resolve().parent


@patch('miri_account_service.require_ai_login', new=lambda: None)
class CommandLibraryTests(unittest.TestCase):
    def test_cards_in_library_are_the_ones_the_runner_can_call(self):
        # 'card' 표시는 화면 없는 실행기(cad_run_command)가 부를 수 있는 이름과 같아야 한다.
        names = json.loads(subprocess.run(
            ['node', '--input-type=module', '-e',
             "import {scriptedCommandNames} from './command-runner.js';console.log(JSON.stringify(scriptedCommandNames()))"],
            cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True).stdout)
        cards = [e['command'] for e in command_library.bundle()['commands'] if e['runner'] == 'card']
        self.assertTrue(cards)
        self.assertEqual(sorted(set(cards) - set(names)), [])

    def test_no_bundled_lisp_entries(self):
        # 동봉 건축 리습은 2026-10-27 뺐다(기본 건축 명령과 같은 일). 명령 라이브러리에 lisp 항목이 없어야 한다.
        self.assertEqual([e['command'] for e in command_library.bundle()['commands'] if e['kind'] == 'lisp'], [])

    def test_mcp_tools(self):
        names = {t['name'] for t in bridge.TOOLS}
        self.assertTrue({'cad_list_commands', 'cad_get_command'} <= names)
        found = bridge.call('cad_list_commands', {'query': 'D1'})
        self.assertEqual(found['commands'][0]['command'], 'D1')
        # 구현 불가로 삭제한 명령(2026-10-10)은 라이브러리에도 없다
        self.assertEqual(command_library.get({'name': 'VPP'})['matches'], [])
        with self.assertRaises(ValueError):
            bridge.call('cad_get_command', {})


    def test_preferred_building_commands_match_current_runner(self):
        for name in ('WALDRAW', 'D1', 'W1'):
            with self.subTest(name=name):
                entry = bridge.call('cad_get_command', {'name': name})['matches'][0]
                self.assertEqual((entry['runner'], entry['status'], entry['recommend']), ('card', 'passed', True))
                self.assertIn('example', entry)
                self.assertEqual(bridge.call('cad_list_commands', {'query': name, 'runner': 'card'})['commands'][0]['command'], name)

    def test_library_contains_no_internal_stack_or_local_address(self):
        for entry in command_library.bundle()['commands']:
            text = json.dumps(entry, ensure_ascii=False)
            self.assertNotRegex(text, r'page\.evaluate|UtilityScript|127\.0\.0\.1|localhost|app\.js\?v=')
        self.assertIn('점을 2개 이상', command_library.get({'name': 'FT'})['matches'][0]['reason'])

    def test_dimension_search_prefers_dimension_commands(self):
        found = bridge.call('cad_list_commands', {'query': '치수'})['commands']
        self.assertEqual(found[0]['category'], '치수')
        self.assertIn(found[0]['command'], ('DIMSEQ', 'DQ'))
        self.assertEqual({e['command'] for e in found[:2]}, {'DIMSEQ', 'DQ'})
        for name in ('DIMSEQ', 'DIMCHAIN', 'QUICKDIM', 'DQ'):
            with self.subTest(name=name):
                entry = command_library.get({'name': name})['matches'][0]
                self.assertTrue(entry['inputs'])
                self.assertTrue(entry['example']['inputs'])
        self.assertEqual(command_library.search({'query': 'COL'})['commands'][0]['command'], 'COL')
        self.assertEqual(command_library.search({'query': '자동치수'})['commands'][0]['command'], 'DQ')


    def test_import_sanitizes_legacy_errors_and_checks_current_examples(self):
        error = 'page.evaluate: Error: 점을 2개 이상 찍으세요.\n    at Object.finish (http://localhost:65098/app.js?v=old:1:2)'
        entry = {'id': 'legacy-ft', 'kind': 'command', 'command': 'FT', 'aliases': ['FT'], 'label': 'T형 벽체 정리',
                 'when_to_use': [], 'how_to_use': {'steps': [error], 'inputs': []},
                 'verification': {'status': 'needs_review'}, 'recommendation': {'eligible': False, 'reason': error},
                 'exclusion': {'candidate': True, 'type': 'review', 'reason': 'http://127.0.0.1:65098/app.js?v=old'}}
        with tempfile.TemporaryDirectory(dir=ROOT / 'tmp') as directory:
            src, dest = Path(directory) / 'legacy.json', Path(directory) / 'library.json'
            src.write_text(json.dumps({'entries': [entry], 'created_at': 'fixture', 'source_version': 'fixture'}), encoding='utf-8')
            subprocess.run(['node', 'tools/command-library/import.mjs', str(src), str(dest)], cwd=ROOT,
                           capture_output=True, text=True, encoding='utf-8', check=True)
            generated = json.loads(dest.read_text(encoding='utf-8'))
        self.assertNotRegex(json.dumps(generated), r'page\.evaluate|localhost|127\.0\.0\.1|app\.js\?v=')
        self.assertEqual(generated['commands'][0]['reason'], '점을 2개 이상 찍으세요.')
        sequence = next(e for e in generated['commands'] if e['command'] == 'DIMSEQ')
        self.assertEqual((sequence['status'], sequence['recommend']), ('passed', True))


if __name__ == '__main__':
    unittest.main()
