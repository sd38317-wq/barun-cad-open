"""빌드 마지막 암호화 검사."""
import os
import gzip
import io
import json
import struct
import zipfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import release_encryption_check as check_module
import vault
import vault_gate

MASTER = '11' * 32


def preview_files():
    from PIL import Image
    from tools.asset_preview_render import thumbnail
    rows = [{'kind': 'detail', 'id': 'TEST-1', 'name': '시험', 'ids': {'1': ['TEST-1']},
             'scenes': [{'n': 1, 'title': '장면', 'scale': 10}], 'has_glb': False}]
    return {'catalog': json.dumps(rows).encode(), 'thumb/detail/TEST-1.webp': thumbnail(Image.new('RGB', (320, 200), 'white'))}



SCREEN_PHRASE = '노출형 주각 베이스플레이트 앵커 그라우트'


def screen_files():
    manifest = {'order': ['chunk-LOCK1.js', 'drawing-generator.js'], 'entries': ['drawing-generator.js'], 'fingerprints': [SCREEN_PHRASE]}
    return {'chunk-LOCK1.js': ('export const n="' + check_module._escaped(SCREEN_PHRASE) + '";').encode(),
            'drawing-generator.js': b'import{n}from"barun-vault:chunk-LOCK1.js";export{n};',
            'manifest.json': json.dumps(manifest, ensure_ascii=False).encode()}


def pack_for(relative, files=None):
    files = check_module.PACKS[relative]() if files is None else files
    key = vault_gate.derive_screen_key(MASTER) if relative == 'rules/screen.pack' else None if relative in check_module.DEFAULT_KEY_PACKS else vault_gate.derive_key(MASTER)
    return vault.pack(files, key)


def make_resources(root):
    internal = Path(root) / 'backend' / '_internal'
    for relative in check_module.PACKS:
        target = internal / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(pack_for(relative))
    return Path(root)


def original_asset(kind='detail'):
    return json.dumps({'format': 'barun-asset/1', 'kind': kind, 'id': 'TEST-001',
                       'scenes': [{'n': 1, 'scale': 10, 'entities': [{'type': 'line', 'start': [0, 0], 'end': [1, 1]}]}]}).encode()


def write_asar(target, name, payload):
    tree = {'files': {}}
    node = tree
    parts = name.split('/')
    for part in parts[:-1]:
        node = node['files'].setdefault(part, {'files': {}})
    node['files'][parts[-1]] = {'size': len(payload), 'offset': '0'}
    raw = json.dumps(tree).encode()
    padded = raw + b'\0' * (-len(raw) % 4)
    target.write_bytes(struct.pack('<4I', 4, 8 + len(padded), 4 + len(padded), len(raw)) + padded + payload)


class ReleaseEncryptionCheckTests(unittest.TestCase):
    def setUp(self):
        preview_patcher = mock.patch.dict(check_module.PACKS, {'rules/asset-preview.pack': preview_files, 'rules/screen.pack': screen_files})
        preview_patcher.start()
        self.addCleanup(preview_patcher.stop)
        patcher = mock.patch.dict(os.environ, {'BARUN_VAULT_MASTER': MASTER})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_encrypted_build_passes(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(check_module.check(make_resources(root)), [])

    def test_plain_lisp_left_in_build_fails(self):
        with tempfile.TemporaryDirectory() as root:
            resources = make_resources(root)
            (resources / 'backend' / '_internal' / 'examples').mkdir(parents=True, exist_ok=True)
            (resources / 'backend' / '_internal' / 'examples' / 'house.lsp').write_text('(defun c:A ())')
            problems = check_module.check(resources)
            self.assertTrue(any('평문 리습' in p for p in problems), problems)
            self.assertTrue(any('암호화되지 않은 파일' in p for p in problems), problems)

    def test_plain_knowledge_json_fails(self):
        with tempfile.TemporaryDirectory() as root:
            resources = make_resources(root)
            (resources / 'backend' / '_internal' / 'rules' / 'layers.json').write_text('{}')
            self.assertTrue(check_module.check(resources))

    def test_recipe_knowledge_is_in_protected_source_set(self):
        sources = vault_gate.source_files()
        self.assertIn('drawing-recipes.json', sources)
        self.assertIn('drawing-recipes.schema.json', sources)

    def test_unencrypted_or_missing_pack_fails(self):
        with tempfile.TemporaryDirectory() as root:
            resources = make_resources(root)
            internal = resources / 'backend' / '_internal'
            (internal / 'rules' / 'pro.pack').write_bytes(b'BCV1' + b'x' * 32)
            (internal / 'rules' / 'asset-preview.pack').unlink()
            problems = check_module.check(resources)
            self.assertTrue(any('BCV2' in p for p in problems), problems)
            self.assertTrue(any('묶음이 없습니다' in p for p in problems), problems)

    def test_stale_pack_missing_source_files_fails(self):
        with tempfile.TemporaryDirectory() as root:
            resources = make_resources(root)
            internal = resources / 'backend' / '_internal'
            for relative in check_module.PACKS:
                files = check_module.PACKS[relative]()
                files.pop(sorted(files)[-1])
                (internal / relative).write_bytes(pack_for(relative, files))
            problems = check_module.check(resources)
            self.assertEqual(sum('소스와 다릅니다' in p for p in problems), len(check_module.PACKS), problems)

    def test_pro_pack_with_default_key_fails(self):
        with tempfile.TemporaryDirectory() as root:
            resources = make_resources(root)
            (resources / 'backend' / '_internal' / 'rules' / 'pro.pack').write_bytes(vault.pack(vault_gate.source_files()))
            problems = check_module.check(resources)
            self.assertTrue(any('기본 열쇠로 열립니다' in p for p in problems), problems)

    def test_locked_screen_js_plain_fails(self):
        # 잠근 JS 평문 0개: 이름이 같거나(조각·입구·소스), 지문 문구가 다른 파일에 섞이면(한글 그대로든 \u 꼴이든) 실패.
        with tempfile.TemporaryDirectory() as root:
            resources = make_resources(root)
            internal = resources / 'backend' / '_internal'
            (internal / 'chunk-LOCK1.js').write_text('x')
            (internal / 'drawing-generator.js').write_text('x')
            (internal / 'livecheck-engine.js').write_text('x')
            (internal / 'drawing-details').mkdir()
            (internal / 'drawing-details' / 'wall.js').write_text('x')
            (internal / 'chunk-OTHER.js').write_text('const a="' + SCREEN_PHRASE + '"', encoding='utf-8')
            (internal / 'chunk-ESC.js').write_bytes(screen_files()['chunk-LOCK1.js'])
            problems = check_module.check(resources)
            self.assertEqual(sum('잠근 화면 코드가 평문으로' in p for p in problems), 4, problems)
            self.assertEqual(sum('잠근 화면 코드가 섞여' in p for p in problems), 2, problems)

    def test_screen_pack_must_need_server_screen_key(self):
        with tempfile.TemporaryDirectory() as root:
            resources = make_resources(root)
            target = resources / 'backend' / '_internal' / 'rules' / 'screen.pack'
            for key, message in ((None, '기본 열쇠로 열립니다'), (vault_gate.derive_key(MASTER), 'pro.pack 열쇠로 열립니다')):
                target.write_bytes(vault.pack(screen_files(), key))
                problems = check_module.check(resources)
                self.assertTrue(any(message in p for p in problems), problems)

    def test_plain_screen_knowledge_fails(self):
        with tempfile.TemporaryDirectory() as root:
            resources = make_resources(root)
            (resources / 'app').mkdir()
            (resources / 'app' / 'layer-ranking-data.js').write_text('x')
            (resources / 'app' / 'bundle.js').write_bytes(b'const catalogRows = []')
            problems = check_module.check(resources)
            self.assertTrue(any('화면 코드가 평문' in p for p in problems), problems)
            self.assertTrue(any('섞여 들어갔습니다' in p for p in problems), problems)

    def test_external_layer_import_is_allowed_but_data_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            resources = make_resources(root)
            app = resources / 'app'
            app.mkdir()
            importer = app / 'bundle.js'
            importer.write_text('import{LAYER_STANDARDS as o}from"./layer-standards-data.js";console.log(o)', encoding='utf8')
            self.assertEqual(check_module.check(resources), [])
            importer.write_bytes((Path(__file__).parent / 'layer-standards-data.js').read_bytes())
            self.assertTrue(any('섞여 들어갔습니다' in p for p in check_module.check(resources)))
            importer.unlink()
            (app / 'layer-standards-data.js').write_text('x')
            self.assertTrue(any('평문' in p for p in check_module.check(resources)))

    def test_build_creates_each_included_standard_asset(self):
        import ast
        tree = ast.parse((Path(__file__).parent / 'build_desktop.py').read_text(encoding='utf8'))
        packs = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == 'write_bytes' and 'layer-standards.pack' in ast.unparse(n.func)]
        self.assertEqual(len(packs), 1)
        self.assertIn('vault.pack', ast.unparse(packs[0]))
        self.assertIn('layer-standards-data.js', ast.unparse(packs[0]))

    def test_build_ships_wait_screens_without_example_records(self):
        script = (Path(__file__).parent / 'build_desktop.py').read_text(encoding='utf-8')
        code = '\n'.join(line for line in script.splitlines() if not line.lstrip().startswith('#'))
        for name in ('apartment.html', 'apartment-embed.js', 'site.html', 'drafting.html', 'wait-screens/site-wait-frame.js', 'wait-screens/drafting-main.js'):
            self.assertIn(name, code)
        for name in check_module.WAIT_EXAMPLE_NAMES:
            self.assertNotIn(name, code)

    def test_build_script_runs_check_last(self):
        script = (Path(__file__).parent / 'build_desktop.py').read_text(encoding='utf-8')
        self.assertIn('release_encryption_check.check(', script)
        self.assertGreater(script.index('release_encryption_check.check('), script.index('subprocess.run(builder'))

    def test_plain_details_json_fails(self):
        with tempfile.TemporaryDirectory() as root:
            resources = make_resources(root)
            target = resources / 'backend' / '_internal' / 'details' / 'wall.json'
            target.parent.mkdir(parents=True)
            target.write_text('{}', encoding='utf8')
            problems = check_module.check(resources)
            self.assertTrue(any('상세 기준 JSON' in p for p in problems), problems)

    def test_plain_country_pack_json_fails_anywhere(self):
        with tempfile.TemporaryDirectory() as root:
            resources = make_resources(root)
            target = resources / 'app' / 'country' / 'kor' / 'details' / 'wall.json'
            target.parent.mkdir(parents=True)
            target.write_text('{}', encoding='utf8')
            problems = check_module.check(resources)
            self.assertTrue(any('상세 기준 JSON' in p for p in problems), problems)

    def test_wait_screen_example_records_fail_and_screens_pass(self):
        # 대기화면 예시 기록은 이름을 바꾸거나 묶음에 섞여도 실패, 화면 파일 자체는 통과.
        with tempfile.TemporaryDirectory() as root:
            resources = make_resources(root)
            screens = resources / 'backend' / '_internal' / 'wait-screens'
            screens.mkdir(parents=True)
            (screens / 'site.html').write_text('<script>if (!window.ENGINE_RUN) throw 0</script>', encoding='utf8')
            (screens / 'site-wait-frame.js').write_text('const example=Boolean(window.ENGINE_RUN);', encoding='utf8')
            self.assertEqual(check_module.check(resources), [])
            for name, body in (('site_example.js', 'x'), ('renamed.js', 'window.APT_RUN={"steps":[]}'), ('chunk.js', 'window.DETAIL = {"details":[]}')):
                with self.subTest(name=name):
                    (screens / name).write_text(body, encoding='utf8')
                    self.assertTrue(any('대기화면 예시 기록' in p for p in check_module.check(resources)), name)
                    (screens / name).unlink()

    def test_plain_protected_names_and_external_data_fail(self):
        for relative in ('app/law-changes.json', 'app/generation-layer-standards.json', 'backend/data/example.txt'):
            with self.subTest(path=relative), tempfile.TemporaryDirectory() as root:
                resources = make_resources(root)
                target = resources / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text('{}')
                self.assertTrue(check_module.check(resources))

    def test_asar_protected_files_fail_and_ui_file_passes(self):
        import json, struct
        for name, fails in [('law-changes.json', True), ('rules/knowledge/details/steel.json', True), ('data/example.dxf', True), ('app.js', False)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as root:
                resources = make_resources(root)
                tree = {'files': {}}
                node = tree
                parts = name.split('/')
                for part in parts[:-1]:
                    node = node['files'].setdefault(part, {'files': {}})
                node['files'][parts[-1]] = {'size': 2, 'offset': '0'}
                raw = json.dumps(tree).encode()
                padded = raw + b'\0' * (-len(raw) % 4)
                (resources / 'app.asar').write_bytes(struct.pack('<4I', 4, 8 + len(padded), 4 + len(padded), len(raw)) + padded + b'{}')
                self.assertEqual(bool(check_module.check(resources)), fails)

    def test_malformed_asar_fails(self):
        with tempfile.TemporaryDirectory() as root:
            resources = make_resources(root)
            (resources / 'app.asar').write_bytes(b'broken')
            self.assertTrue(check_module.check(resources))

    def test_pro_pack_missing_country_data_fails(self):
        with tempfile.TemporaryDirectory() as root:
            resources = make_resources(root)
            files = {name: value for name, value in vault_gate.source_files().items() if not name.startswith('country/')}
            target = resources / 'backend' / '_internal' / 'rules' / 'pro.pack'
            target.write_bytes(vault.pack(files, vault_gate.derive_key(MASTER)))
            problems = check_module.check(resources)
            self.assertTrue(any('내용이 소스와 다릅니다' in p and 'country/kor/details/' in p for p in problems), problems)


    def test_server_asset_paths_fail_even_for_empty_original_files(self):
        for relative in ('app/cad-assets/catalog.json.gz', 'backend/_바른표준/FLOOR-072/meta.json',
                         'backend/단위세대/index.json', 'backend/동평면/index.json', 'backend/주동/index.json',
                         'backend/unit-library/index.json', 'backend/jutong-library/index.json'):
            with self.subTest(path=relative), tempfile.TemporaryDirectory() as root:
                resources = make_resources(root)
                target = resources / relative
                target.parent.mkdir(parents=True)
                target.write_bytes(b'{}')
                self.assertTrue(any('원본' in p for p in check_module.check(resources)))

    def test_renamed_plain_and_gzip_originals_fail_for_all_kinds(self):
        for kind in ('detail', 'unit', 'jutong'):
            for compressed in (False, True):
                with self.subTest(kind=kind, gzip=compressed), tempfile.TemporaryDirectory() as root:
                    resources = make_resources(root)
                    raw = original_asset(kind)
                    (resources / ('innocent.json.gz' if compressed else 'innocent.json')).write_bytes(gzip.compress(raw) if compressed else raw)
                    self.assertTrue(any('원본 내용' in p for p in check_module.check(resources)))

    def test_imported_geometry_and_server_catalog_fail_without_format_marker(self):
        for value in ({'geometry': {'units': 'mm', 'entities': [{'type': 'line'}]}},
                      [{'kind': 'unit', 'id': 'UN-1', 'scenes': [{'n': 1, 'title': 'A', 'scale': 1}], 'has_glb': False}]):
            with self.subTest(value=value), tempfile.TemporaryDirectory() as root:
                resources = make_resources(root)
                (resources / 'renamed.json').write_text(json.dumps(value), encoding='utf8')
                self.assertTrue(any('원본 내용' in p for p in check_module.check(resources)))

    def test_existing_encrypted_packs_cannot_hide_original_assets(self):
        for relative in check_module.PACKS:
            with self.subTest(pack=relative), tempfile.TemporaryDirectory() as root:
                resources = make_resources(root)
                files = check_module.PACKS[relative]()
                files['innocent.json.gz'] = gzip.compress(original_asset('unit'))
                (resources / 'backend' / '_internal' / relative).write_bytes(pack_for(relative, files))
                problems = check_module.check(resources)
                self.assertTrue(any('원본 내용' in p or '원본 기하' in p for p in problems), problems)
                self.assertTrue(any('소스와 다릅니다' in p for p in problems), problems)

    def test_new_opaque_encrypted_pack_fails(self):
        with tempfile.TemporaryDirectory() as root:
            resources = make_resources(root)
            # An unknown key must never let a hidden original evade the checker.
            (resources / 'innocent.pack').write_bytes(vault.pack({'a.json': original_asset()}, b'3' * 32))
            self.assertTrue(any('허용 목록 밖' in p for p in check_module.check(resources)))

    def test_asar_original_contents_and_original_paths_fail(self):
        for name, raw in (('innocent.json', original_asset()), ('innocent.json.gz', gzip.compress(original_asset('unit'))),
                          ('cad-assets/catalog.json.gz', b'{}'), ('innocent.glb', b'glTF')):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as root:
                resources = make_resources(root)
                write_asar(resources / 'app.asar', name, raw)
                self.assertTrue(check_module.check(resources))

    def test_zip_original_contents_and_nested_gzip_fail(self):
        for name, raw in (('innocent.json', original_asset('jutong')), ('nested.json.gz', gzip.compress(original_asset())),
                          ('cad-assets/catalog.json.gz', b'{}'), ('_바른표준/meta.json', b'{}')):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as root:
                resources = make_resources(root)
                with zipfile.ZipFile(resources / 'library.zip', 'w') as archive:
                    archive.writestr(name, raw)
                self.assertTrue(check_module.check(resources))

    def test_code_references_and_existing_knowledge_are_not_original_geometry(self):
        references = b'const format="barun-asset/1";const kinds=["detail","unit","jutong"];'
        check_module.assert_no_server_assets({'cad_asset_client.py': references, **vault_gate.source_files()})
        # JSON schema fields named kind/type may themselves be dictionaries/lists.
        check_module.assert_no_server_assets({'schema.json': b'{"kind":{"type":"string"},"entities":[{"type":["line"]}]}'})

    def test_source_guard_blocks_original_before_any_release_pack_is_written(self):
        with self.assertRaisesRegex(ValueError, '원본'):
            check_module.assert_no_server_assets({'innocent.json': original_asset()})
        script = (Path(__file__).parent / 'build_desktop.py').read_text(encoding='utf8')
        self.assertLess(script.index('assert_no_server_assets(pro_sources)'), script.index("(pack_dir/'pro.pack').write_bytes"))
        # 기계어 판은 이 모듈들을 .pyd 로, --no-native 판은 hidden import 로 싣는다. 둘 다 hidden 목록에서 나온다.
        hidden_line = next(line for line in script.splitlines() if line.startswith('hidden=['))
        for module in ('cad_asset_client', 'asset_preview'):
            self.assertIn("'%s'" % module, hidden_line)


    def test_preview_pack_is_allowed_only_with_metadata_and_small_webp(self):
        check_module.assert_no_server_assets({'rules/asset-preview.pack': vault.pack(preview_files())})
        for files in ({**preview_files(), 'original.json': original_asset()},
                      {**preview_files(), 'catalog': original_asset()},
                      {**preview_files(), 'catalog': json.dumps([{'kind': 'detail', 'id': 'TEST-1', 'name': '시험',
                        'scenes': [{'n': 1, 'title': 'x', 'scale': 10, 'entities': []}]}]).encode()}):
            with self.subTest(files=list(files)), tempfile.TemporaryDirectory() as root:
                resources = make_resources(root)
                (resources / 'backend/_internal/rules/asset-preview.pack').write_bytes(vault.pack(files, vault_gate.derive_key(MASTER)))
                self.assertTrue(any('원본 기하' in p for p in check_module.check(resources)))
                with self.assertRaises(ValueError):
                    check_module.assert_no_server_assets({'rules/asset-preview.pack': vault.pack(files)})


if __name__ == '__main__':
    unittest.main()
