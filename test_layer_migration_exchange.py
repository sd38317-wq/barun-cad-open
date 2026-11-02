"""Browser migration -> actual DXF save/reopen, including source preservation."""
import io, json, subprocess, unittest
from pathlib import Path
import ezdxf
import exchange

ROOT = Path(__file__).parent
OLD = '_'.join(['바른', '벽체'])

def migrate(document):
    script = "import fs from 'node:fs'; import {prepareLegacyLayerMigration} from './layer-migration.js'; console.log(JSON.stringify(prepareLegacyLayerMigration(JSON.parse(fs.readFileSync(0,'utf8'))).doc));"
    result = subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(document), text=True, encoding='utf8', capture_output=True, cwd=ROOT, timeout=30)
    if result.returncode: raise AssertionError(result.stderr)
    return json.loads(result.stdout)

def raw_dxf(drawing):
    stream = io.StringIO(); drawing.write(stream)
    return stream.getvalue().encode('utf8')

class LayerMigrationExchangeTests(unittest.TestCase):
    def check_saved(self, drawing):
        original = raw_dxf(drawing)
        imported = exchange.import_file(original, '.dxf')['document']
        before = json.dumps(imported, sort_keys=True)
        migrated = migrate(imported)
        self.assertEqual(json.dumps(imported, sort_keys=True), before)
        saved, _ = exchange.export_dxf(migrated)
        native = ezdxf.read(io.StringIO(saved.decode('utf8'), newline=None))
        self.assertNotIn(OLD, native.layers)
        self.assertIn('A-WALL', native.layers)
        reopened = exchange.import_file(saved, '.dxf')['document']
        self.assertEqual(reopened['layers'], migrated['layers'])
        self.assertEqual(reopened.get('layerNameMigrations'), migrated.get('layerNameMigrations'))
        return native, migrated

    def test_preserved_source_rename_moves_unchanged_handle_and_paperspace(self):
        d = ezdxf.new('R2018'); d.units = 4
        d.layers.new(OLD, dxfattribs={'color': 1, 'lineweight': 50})
        e = d.modelspace().add_line((0, 0), (100, 20), dxfattribs={'layer': OLD})
        handle = e.dxf.handle
        d.layouts.get('Layout1').add_circle((5, 5), 2, dxfattribs={'layer': OLD})
        native, _ = self.check_saved(d)
        self.assertEqual(native.entitydb[handle].dxf.layer, 'A-WALL')
        self.assertEqual(native.layouts.get('Layout1')[0].dxf.layer, 'A-WALL')

    def test_preserved_merge_keeps_styles_and_archived_properties(self):
        d = ezdxf.new('R2018'); d.units = 4
        d.layers.new(OLD, dxfattribs={'color': 1, 'lineweight': 50, 'linetype': 'CONTINUOUS'})
        d.layers.new('A-WALL', dxfattribs={'color': 5, 'lineweight': 13})
        d.modelspace().add_line((0, 0), (100, 20), dxfattribs={'layer': OLD})
        d.layouts.get('Layout1').add_circle((5, 5), 2, dxfattribs={'layer': OLD})
        native, migrated = self.check_saved(d)
        circle = native.layouts.get('Layout1')[0]
        self.assertEqual(circle.dxf.layer, 'A-WALL')
        self.assertEqual(circle.dxf.color, 1)
        self.assertEqual(circle.dxf.lineweight, 50)
        target = next(l for l in migrated['layers'] if l['name'] == 'A-WALL')
        self.assertEqual(target['mergedLayerSources'][0]['name'], OLD)

    def test_layout_shared_zero_layer_block_keeps_color_and_reuses_variant(self):
        from ezdxf.addons.drawing.properties import RenderContext
        d = ezdxf.new('R2018'); d.units = 4
        d.layers.new(OLD, dxfattribs={'color': 1, 'lineweight': 50})
        d.layers.new('A-WALL', dxfattribs={'color': 5, 'lineweight': 13})
        block = d.blocks.new('SHARED')
        block.add_line((0, 0), (10, 10))
        block.add_circle((5, 5), 2, dxfattribs={'color': 0})
        d.modelspace().add_line((0, 0), (100, 20), dxfattribs={'layer': OLD})
        layout = d.layouts.get('Layout1')
        for x in (0, 20): layout.add_blockref('SHARED', (x, 0), dxfattribs={'layer': OLD})
        layout.add_blockref('SHARED', (40, 0), dxfattribs={'layer': 'A-WALL'})
        native, _ = self.check_saved(d)
        refs = list(native.layouts.get('Layout1').query('INSERT'))
        self.assertEqual(refs[0].dxf.name, refs[1].dxf.name)
        self.assertNotEqual(refs[0].dxf.name, refs[2].dxf.name)
        context = RenderContext(native)
        for ref, expected in zip(refs, ['#ff0000', '#ff0000', '#0000ff']):
            context.push_state(context.resolve_all(ref))
            for child in native.blocks.get(ref.dxf.name):
                self.assertEqual(context.resolve_color(child), expected)
            context.pop_state()

    def test_viewport_frozen_layers_are_remapped_and_deduplicated(self):
        d = ezdxf.new('R2018'); d.units = 4
        d.layers.new(OLD); d.layers.new('A-WALL')
        d.modelspace().add_line((0, 0), (100, 20), dxfattribs={'layer': OLD})
        vp = d.layouts.get('Layout1').add_viewport(center=(5, 5), size=(10, 10), view_center_point=(0, 0), view_height=10)
        vp.frozen_layers = [OLD, 'A-WALL']
        native, _ = self.check_saved(d)
        saved_vp = list(native.layouts.get('Layout1').query('VIEWPORT'))[0]
        self.assertEqual(saved_vp.frozen_layers, ['A-WALL'])

    def test_unique_rename_preserves_viewport_overrides_and_handle(self):
        d = ezdxf.new('R2018'); d.units = 4
        layer = d.layers.new(OLD)
        d.modelspace().add_line((0, 0), (100, 20), dxfattribs={'layer': OLD})
        vp = d.layouts.get('Layout1').add_viewport(center=(5, 5), size=(10, 10), view_center_point=(0, 0), view_height=10)
        overrides = layer.get_vp_overrides(); overrides.set_color(vp.dxf.handle, 3); overrides.set_lineweight(vp.dxf.handle, 50); overrides.commit()
        native, _ = self.check_saved(d)
        saved = native.layers.get('A-WALL')
        self.assertEqual(saved.dxf.handle, layer.dxf.handle)
        overrides = saved.get_vp_overrides()
        self.assertEqual(overrides.get_color(vp.dxf.handle), 3)
        self.assertEqual(overrides.get_lineweight(vp.dxf.handle), 50)

    def test_conflicting_viewport_override_keeps_old_layer_and_saves_other_migrations(self):
        d = ezdxf.new('R2018'); d.units = 4
        layer = d.layers.new(OLD); d.layers.new('A-WALL')
        d.layers.new('B_Door')
        wall = d.modelspace().add_line((0, 0), (100, 20), dxfattribs={'layer': OLD})
        door = d.modelspace().add_line((0, 30), (100, 30), dxfattribs={'layer': 'B_Door'})
        vp = d.layouts.get('Layout1').add_viewport(center=(5, 5), size=(10, 10), view_center_point=(0, 0), view_height=10)
        vp.frozen_layers = [OLD]
        overrides = layer.get_vp_overrides(); overrides.set_color(vp.dxf.handle, 3); overrides.commit()
        original = exchange.import_file(raw_dxf(d), '.dxf')['document']
        migrated = migrate(original)
        self.assertIn(OLD, [l['name'] for l in migrated['layers']])
        self.assertEqual(migrated['layerNameMigrations'], [{'from': 'B_Door', 'to': 'A-DOOR'}])
        saved, _ = exchange.export_dxf(migrated)
        native = ezdxf.read(io.StringIO(saved.decode('utf8'), newline=None))
        self.assertIn(OLD, native.layers)
        self.assertEqual(native.entitydb[wall.dxf.handle].dxf.layer, OLD)
        self.assertEqual(native.layers.get(OLD).get_vp_overrides().get_color(vp.dxf.handle), 3)
        self.assertEqual(native.entitydb[vp.dxf.handle].frozen_layers, [OLD])
        self.assertEqual(native.entitydb[door.dxf.handle].dxf.layer, 'A-DOOR')
        reopened = exchange.import_file(saved, '.dxf')['document']
        saved_again, _ = exchange.export_dxf(migrate(reopened))
        self.assertIn(OLD, ezdxf.read(io.StringIO(saved_again.decode('utf8'), newline=None)).layers)

    def test_multiple_sources_without_target_merge_at_save(self):
        d = ezdxf.new('R2018'); d.units = 4
        for name, color in [(OLD, 1), ('B_Wall', 5)]:
            d.layers.new(name, dxfattribs={'color': color})
            d.modelspace().add_line((0, 0), (100, 20), dxfattribs={'layer': name})
        native, _ = self.check_saved(d)
        self.assertNotIn('B_Wall', native.layers)
        self.assertEqual(len(list(native.modelspace().query('LINE'))), 2)

    def test_target_only_viewport_override_keeps_old_layer_and_saves(self):
        d = ezdxf.new('R2018'); d.units = 4
        d.layers.new(OLD, dxfattribs={'color': 1})
        target = d.layers.new('A-WALL', dxfattribs={'color': 1})
        wall = d.modelspace().add_line((0, 0), (100, 20), dxfattribs={'layer': OLD})
        vp = d.layouts.get('Layout1').add_viewport(center=(5, 5), size=(10, 10), view_center_point=(0, 0), view_height=10)
        overrides = target.get_vp_overrides(); overrides.set_color(vp.dxf.handle, 3); overrides.commit()
        original = exchange.import_file(raw_dxf(d), '.dxf')['document']
        migrated = migrate(original)
        self.assertEqual(migrated, original)
        saved, _ = exchange.export_dxf(migrated)
        native = ezdxf.read(io.StringIO(saved.decode('utf8'), newline=None))
        self.assertIn(OLD, native.layers)
        self.assertEqual(native.entitydb[wall.dxf.handle].dxf.layer, OLD)
        self.assertEqual(native.layers.get('A-WALL').get_vp_overrides().get_color(vp.dxf.handle), 3)

    def test_uncopyable_affected_block_keeps_legacy_layer_and_saves(self):
        from unittest import mock
        from ezdxf.entities import Line
        d = ezdxf.new('R2018'); d.units = 4
        d.layers.new(OLD, dxfattribs={'color': 1}); d.layers.new('A-WALL', dxfattribs={'color': 5})
        d.layers.new('B_Door')
        block = d.blocks.new('UNCOPYABLE')
        part = block.add_line((0, 0), (10, 10))
        layout = d.layouts.get('Layout1')
        ref = layout.add_blockref('UNCOPYABLE', (0, 0), dxfattribs={'layer': OLD})
        door = d.modelspace().add_circle((0, 0), 10, dxfattribs={'layer': 'B_Door'})
        with mock.patch.object(Line, 'copy', side_effect=TypeError('unsupported preserved entity')):
            original = exchange.import_file(raw_dxf(d), '.dxf')['document']
            migrated = migrate(original)
            self.assertIn(OLD, [l['name'] for l in migrated['layers']])
            saved, _ = exchange.export_dxf(migrated)
        native = ezdxf.read(io.StringIO(saved.decode('utf8'), newline=None))
        self.assertEqual(native.entitydb[ref.dxf.handle].dxf.layer, OLD)
        self.assertEqual(native.entitydb[ref.dxf.handle].dxf.name, 'UNCOPYABLE')
        self.assertEqual(native.entitydb[part.dxf.handle].dxf.layer, '0')
        self.assertEqual(native.entitydb[door.dxf.handle].dxf.layer, 'A-DOOR')
        self.assertFalse(any('_A_LAYER_' in b.name for b in native.blocks))

    def test_metadata_free_uncopyable_modelspace_block_keeps_original_handles(self):
        from unittest import mock
        from ezdxf.entities import Line
        for merge in (False, True):
            with self.subTest(merge=merge):
                d = ezdxf.new('R2018'); d.units = 4
                d.layers.new(OLD, dxfattribs={'color': 1})
                if merge:d.layers.new('A-WALL', dxfattribs={'color': 5})
                block = d.blocks.new('UNCOPYABLE')
                child = block.add_line((0, 0), (10, 10))
                ref = d.modelspace().add_blockref('UNCOPYABLE', (0, 0), dxfattribs={'layer': OLD})
                imported = exchange.import_file(raw_dxf(d), '.dxf')['document']; imported.pop('legacyLayerSafety')
                migrated = migrate(imported)
                with mock.patch.object(Line, 'copy', side_effect=TypeError('cannot copy block')):
                    saved, warnings = exchange.export_dxf(migrated)
                native = ezdxf.read(io.StringIO(saved.decode('utf8'), newline=None))
                self.assertEqual(native.entitydb[ref.dxf.handle].dxf.layer, OLD)
                self.assertEqual(native.entitydb[ref.dxf.handle].dxf.name, 'UNCOPYABLE')
                self.assertEqual(native.entitydb[child.dxf.handle].dxf.layer, '0')
                self.assertTrue(any('블록을 복제할 수 없어 그대로 두었습니다' in w for w in warnings))
                if not merge:self.assertNotIn('A-WALL', native.layers)
                reopened = exchange.import_file(saved, '.dxf')['document']
                self.assertIn(OLD, [l['name'] for l in reopened['layers']])
                if not merge:self.assertNotIn('A-WALL', [l['name'] for l in reopened['layers']])

    def test_old_metadata_free_migration_saves_conflicts_and_preserves_later_edits(self):
        d = ezdxf.new('R2018'); d.units = 4
        layer = d.layers.new(OLD, dxfattribs={'color': 1})
        d.layers.new('A-WALL', dxfattribs={'color': 5}); d.layers.new('B_Door')
        wall = d.modelspace().add_line((0, 0), (100, 20), dxfattribs={'layer': OLD})
        d.modelspace().add_circle((0, 0), 10, dxfattribs={'layer': 'B_Door'})
        vp = d.layouts.get('Layout1').add_viewport(center=(5, 5), size=(10, 10), view_center_point=(0, 0), view_height=10)
        overrides = layer.get_vp_overrides(); overrides.set_color(vp.dxf.handle, 3); overrides.commit()
        imported = exchange.import_file(raw_dxf(d), '.dxf')['document']
        imported.pop('legacyLayerSafety')
        migrated = migrate(imported)
        current = next(e for e in migrated['entities'] if e['sourceHandle'] == wall.dxf.handle)
        current['points'][1]['x'] = 120
        current.update(color='#abcdef', colorMode='truecolor'); current.pop('aci', None)
        before = json.dumps(migrated, sort_keys=True)
        saved, warnings = exchange.export_dxf(migrated)
        self.assertEqual(json.dumps(migrated, sort_keys=True), before)
        self.assertTrue(any(OLD + ' 레이어는 뷰포트 속성이 달라 그대로 두었습니다' in w for w in warnings))
        native = ezdxf.read(io.StringIO(saved.decode('utf8'), newline=None))
        self.assertIn(OLD, native.layers); self.assertIn('A-DOOR', native.layers)
        saved_wall = list(native.modelspace().query('LINE'))[0]
        self.assertEqual(saved_wall.dxf.layer, OLD)
        self.assertEqual(saved_wall.dxf.end.x, 120)
        self.assertEqual(tuple(saved_wall.rgb), (171, 205, 239))
        reopened = exchange.import_file(saved, '.dxf')['document']
        retained = next(l for l in reopened['layers'] if l['name'] == OLD)
        self.assertEqual(reopened['entities'][0]['layer'], retained['id'])
        self.assertNotIn(OLD, [r['from'] for r in reopened['layerNameMigrations']])
        again, _ = exchange.export_dxf(migrate(reopened))
        self.assertIn(OLD, ezdxf.read(io.StringIO(again.decode('utf8'), newline=None)).layers)

    def test_metadata_free_skipped_merge_restores_target_state(self):
        d = ezdxf.new('R2018'); d.units = 4
        source = d.layers.new(OLD); source.freeze()
        d.layers.new('A-WALL')
        d.modelspace().add_line((0, 0), (10, 10), dxfattribs={'layer': OLD})
        d.modelspace().add_line((20, 0), (30, 10), dxfattribs={'layer': 'A-WALL'})
        vp = d.layouts.get('Layout1').add_viewport(center=(5, 5), size=(10, 10), view_center_point=(0, 0), view_height=10)
        overrides = source.get_vp_overrides(); overrides.set_color(vp.dxf.handle, 3); overrides.commit()
        original = exchange.import_file(raw_dxf(d), '.dxf')['document']; original.pop('legacyLayerSafety')
        saved, _ = exchange.export_dxf(migrate(original))
        native = ezdxf.read(io.StringIO(saved.decode('utf8'), newline=None))
        self.assertTrue(native.layers.get(OLD).is_frozen())
        self.assertFalse(native.layers.get('A-WALL').is_frozen())

    def test_metadata_free_first_rename_restores_state_after_skipping_later_source(self):
        d = ezdxf.new('R2018'); d.units = 4
        d.layers.new(OLD, dxfattribs={'color': 1})
        skipped = d.layers.new('B_Wall', dxfattribs={'color': 5}); skipped.freeze()
        d.modelspace().add_line((0, 0), (10, 10), dxfattribs={'layer': OLD})
        d.modelspace().add_line((20, 0), (30, 10), dxfattribs={'layer': 'B_Wall'})
        vp = d.layouts.get('Layout1').add_viewport(center=(5, 5), size=(10, 10), view_center_point=(0, 0), view_height=10)
        overrides = skipped.get_vp_overrides(); overrides.set_color(vp.dxf.handle, 3); overrides.commit()
        original = exchange.import_file(raw_dxf(d), '.dxf')['document']; original.pop('legacyLayerSafety')
        saved, _ = exchange.export_dxf(migrate(original))
        native = ezdxf.read(io.StringIO(saved.decode('utf8'), newline=None))
        self.assertNotIn(OLD, native.layers)
        self.assertTrue(native.layers.get('B_Wall').is_frozen())
        self.assertFalse(native.layers.get('A-WALL').is_frozen())

    def test_metadata_free_shared_blocks_keep_reference_styles_and_edits_isolated(self):
        from ezdxf.addons.drawing.properties import RenderContext
        for edit in (False, True):
            with self.subTest(edit=edit):
                d = ezdxf.new('R2018'); d.units = 4
                source = d.layers.new(OLD, dxfattribs={'color': 1})
                d.layers.new('A-WALL', dxfattribs={'color': 5})
                d.blocks.new('SHARED').add_line((0, 0), (10, 10))
                old_ref = d.modelspace().add_blockref('SHARED', (0, 0), dxfattribs={'layer': OLD})
                d.modelspace().add_blockref('SHARED', (20, 0), dxfattribs={'layer': 'A-WALL'})
                vp = d.layouts.get('Layout1').add_viewport(center=(5, 5), size=(10, 10), view_center_point=(0, 0), view_height=10)
                overrides = source.get_vp_overrides(); overrides.set_color(vp.dxf.handle, 3); overrides.commit()
                original = exchange.import_file(raw_dxf(d), '.dxf')['document']; original.pop('legacyLayerSafety')
                migrated = migrate(original)
                if edit:
                    ref = next(e for e in migrated['entities'] if e['sourceHandle'] == old_ref.dxf.handle)
                    migrated['sharedBlocks'][ref['sharedBlock']]['entities'][0]['points'][1]['x'] = 12
                saved, _ = exchange.export_dxf(migrated)
                native = ezdxf.read(io.StringIO(saved.decode('utf8'), newline=None))
                context = RenderContext(native)
                for ref in native.modelspace().query('INSERT'):
                    color, end = ('#ff0000', 12 if edit else 10) if ref.dxf.layer == OLD else ('#0000ff', 10)
                    context.push_state(context.resolve_all(ref))
                    child = native.blocks.get(ref.dxf.name)[0]
                    self.assertEqual(context.resolve_color(child), color)
                    self.assertEqual(child.dxf.end.x, end)
                    context.pop_state()
                reopened = exchange.import_file(saved, '.dxf')['document']
                refs = reopened['entities']
                for ref, end in zip(refs, [12 if edit else 10, 10]):
                    child = reopened['sharedBlocks'][ref['sharedBlock']]['entities'][0]
                    self.assertEqual(child['points'][1]['x'], end)
                    self.assertIsNone(child.get('color'))
                if edit:self.assertNotEqual(refs[0]['sharedBlock'], refs[1]['sharedBlock'])

    def test_unrelated_cycle_does_not_skip_standalone_legacy_layers(self):
        d = ezdxf.new('R2018'); d.layers.new('B_Door')
        d.blocks.new('UNRELATED_CYCLE').add_blockref('UNRELATED_CYCLE', (0, 0))
        self.assertEqual(exchange._layer_migration_safety(d)['uncopyableLayers'], [])

    def test_modern_layer_definitions_are_not_copy_checked(self):
        from unittest import mock
        from ezdxf.entities import Line
        d = ezdxf.new('R2018'); d.layers.new('B_Door'); d.layers.new('A-WALL')
        d.blocks.new('MODERN').add_line((0, 0), (10, 10), dxfattribs={'layer': 'A-WALL'})
        with mock.patch.object(Line, 'copy', side_effect=AssertionError('unrelated modern geometry copied')) as copy:
            safety = exchange._layer_migration_safety(d)
            copy.assert_not_called()
        self.assertEqual(safety['uncopyableLayers'], [])

    def test_rename_and_merge_do_not_copy_unaffected_preserved_definitions(self):
        from unittest import mock
        from ezdxf.entities import Line
        for merge in (False, True):
            with self.subTest(merge=merge):
                d = ezdxf.new('R2018'); d.units = 4
                d.layers.new(OLD, dxfattribs={'color': 1})
                if merge: d.layers.new('A-WALL', dxfattribs={'color': 5})
                block = d.blocks.new('UNAFFECTED')
                block.add_line((0, 0), (10, 10), dxfattribs={'layer': 'Defpoints'})
                d.layouts.get('Layout1').add_blockref('UNAFFECTED', (0, 0))
                d.modelspace().add_circle((0, 0), 10, dxfattribs={'layer': OLD})
                with mock.patch.object(Line, 'copy', side_effect=AssertionError('unaffected geometry copied')):
                    self.check_saved(d)

if __name__ == '__main__': unittest.main()
