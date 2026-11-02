import base64
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import field_records as fr
import field_records_ai as ai


class FieldRecordsAITest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.ctx = {'drawingPath': str(self.root / '시험.dwg'), 'drawingName': '시험', 'draftKey': 'test'}
        self.env = patch.dict('os.environ', {'BARUN_FIELD_RECORDS_HOME': str(self.root / 'home'),
                                           'BARUN_FIELD_RECORDS_SPOOL': str(self.root / 'spool'),
                                           'BARUN_FIELD_RECORDS_PC': 'ai-test'})
        self.env.start()
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(self.env.stop)
        self.folder = Path(fr.folder_for(self.ctx)['folder'])
        self.pin('p1', 'l1', 3)

    def pin(self, pid, link, no, at='2020-10-16T09:00:00+09:00', **values):
        pin = {'id': pid, 'no': no, 'title': '누수', 'status': '미해결', 'note': '창가 확인',
               'at': {'x': 12.5, 'y': -8}, 'photos': [], **values}
        return fr.process({**self.ctx, 'action': 'append', 'events': [
            {'id': 'receive:' + link + ':' + pid + ':' + at, 'kind': 'pin', 'link': link, 'pin': pin, 'at': at}]})

    def call(self, action, args=None, **kwargs):
        return ai.call('cad_field_records_' + action, args or {}, self.ctx, **kwargs)

    def ledger(self):
        return {p.name: p.read_bytes() for p in self.folder.glob('기록장부*.jsonl')}

    def test_list_get_update_preserves_history_and_no_delete(self):
        before = self.ledger()
        listed = self.call('list')['records'][0]
        self.assertEqual((listed['no'], listed['status'], listed['photo_count']), (3, '열림', 0))
        self.assertEqual(listed['at'], {'x': 12.5, 'y': -8})
        record = self.call('get', {'pin_no': 3})['record']
        self.assertEqual(record['note'], '창가 확인')
        result = self.call('update', {'pin_no': 3, 'status': '처리됨', 'reply': '조치했습니다'})
        self.assertEqual((result['deleted'], result['added']), (0, 2))
        after = self.ledger()
        for name, body in before.items():
            self.assertTrue(after[name].startswith(body))
        record = self.call('get', {'pin_id': 'p1'})['record']
        self.assertEqual((record['status'], record['field_status']), ('처리됨', '해결'))
        self.assertEqual(len(record['history']), 3)
        self.assertEqual(record['replies'][0]['text'], '조치했습니다')
        self.assertFalse(record['replies'][0]['delivered'])
        event = next(e for e in record['history'] if e['kind'] == 'pin.status')
        self.assertEqual((event['from'], event['to'], event['by']), ('미해결', '해결', '사무실 AI'))
        self.assertEqual(record['lastAt'], max(e['at'] for e in record['history']))
        self.assertEqual(record['summary']['lastAt'], record['lastAt'])
        self.call('update', {'pin_id': 'p1', 'status': '열림'})
        self.assertEqual(self.call('get', {'pin_id': 'p1'})['record']['status'], '열림')
        self.assertEqual(len(self.call('get', {'pin_id': 'p1'})['record']['history']), 4)

    def test_filters_include_both_boundary_dates(self):
        self.pin('p2', 'l1', 4, '2020-10-17T23:59:59+09:00', status='해결')
        self.pin('p3', 'l1', 5, '2020-10-18T00:00:00+09:00')
        self.assertEqual(self.call('list', {'date_from': '2020-10-16', 'date_to': '2020-10-17'})['count'], 2)
        self.assertEqual(self.call('list', {'status': '처리됨'})['records'][0]['id'], 'p2')
        self.assertEqual(self.call('list', {'date_from': '2020-10-17', 'date_to': '2020-10-17'})['count'], 1)

    def test_invalid_filters_before_read(self):
        for args in [{'date_from': '20200201'}, {'date_from': '2020-02-30'}, {'date_from': '2020-W01-1'},
                     {'date_from': '2020-10-18', 'date_to': '2020-10-16'}, {'status': '닫힘'}]:
            with self.subTest(args=args), patch.object(fr, 'process') as process:
                with self.assertRaises(ValueError): self.call('list', args)
                process.assert_not_called()

    def test_selector_validation_and_ambiguity(self):
        self.pin('p1', 'l2', 3)
        for args in [{}, {'pin_no': True}, {'pin_no': 0}, {'pin_no': 3.0}, {'pin_id': ''}, {'pin_no': 3},
                     {'pin_id': 'p1'}, {'pin_no': 3, 'link_id': 9}, {'pin_id': 'missing'}]:
            with self.subTest(args=args), self.assertRaises(ValueError): self.call('get', args)
        self.assertEqual(self.call('get', {'pin_no': 3, 'link_id': 'l2'})['record']['link_id'], 'l2')

    def test_invalid_update_atomic_and_before_read(self):
        before = self.ledger()
        for args in [{'pin_no': 3}, {'pin_no': 3, 'status': '닫힘', 'reply': '답'},
                     {'pin_no': 3, 'status': '처리됨', 'reply': ''}, {'pin_no': 3, 'reply': 9},
                     {'pin_no': 3, 'reply': 'x' * 8001}]:
            with self.subTest(args=args), patch.object(fr, 'process') as process:
                with self.assertRaises(ValueError): self.call('update', args)
                process.assert_not_called()
        self.assertEqual(self.ledger(), before)

    def test_unsaved_update_rejected_before_read(self):
        with patch.object(fr, 'process') as process:
            with self.assertRaisesRegex(ValueError, '먼저 저장'):
                ai.call('cad_field_records_update', {'pin_no': 3, 'status': '처리됨'}, {'drawingPath': '', 'drawingName': '초안'})
            process.assert_not_called()

    def test_locate_uses_saved_coordinates(self):
        result = self.call('locate', {'pin_no': 3, 'x': 999, 'y': 999})
        self.assertEqual((result['x'], result['y']), (12.5, -8))

    def test_locate_rejects_invalid_coordinates(self):
        for at in [None, {}, {'x': True, 'y': 0}, {'x': '12', 'y': 0}, {'x': float('inf'), 'y': 0}]:
            with self.subTest(at=at), patch.object(fr, 'process', return_value={'folder': str(self.folder), 'pins': [
                    {'id': 'p1', 'no': 3, 'link': 'l1', 'at': at}]}):
                with self.assertRaises(ValueError): self.call('locate', {'pin_no': 3})

    def test_photos_path_and_one_small_preview(self):
        from PIL import Image
        buf = io.BytesIO()
        Image.new('RGB', (1200, 800), 'red').save(buf, 'JPEG')
        for pid in ['photo1', 'photo2']:
            fr.process({**self.ctx, 'action': 'photo', 'id': pid, 'pinId': 'p1', 'pinNo': 3, 'link': 'l1',
                        'data': base64.b64encode(buf.getvalue()).decode('ascii')})
        result = self.call('get', {'pin_no': 3, 'include_preview': True, 'photo_id': 'photo2'})
        self.assertEqual(result['record']['photo_count'], 2)
        self.assertEqual(result['image']['mimeType'], 'image/jpeg')
        self.assertNotIn('image', result['record'])
        for photo in result['record']['photos']:
            self.assertFalse(Path(photo['file']).is_absolute())
            self.assertEqual(Path(photo['path']), fr._inside(self.folder, photo['file']))
        with Image.open(io.BytesIO(base64.b64decode(result['image']['data']))) as preview:
            self.assertLessEqual(max(preview.size), 512)
        for args in [{'pin_no': 3, 'include_preview': 'yes'}, {'pin_no': 3, 'include_preview': True, 'photo_id': 'missing'}]:
            with self.subTest(args=args), self.assertRaises(ValueError): self.call('get', args)

    def test_photo_escape_rejected_without_preview(self):
        with patch.object(fr, 'process', return_value={'folder': str(self.folder), 'pins': [
                {'id': 'p1', 'no': 3, 'link': 'l1', 'photos': [{'id': 'bad', 'file': '../secret.jpg'}]}]}):
            with self.assertRaises(ValueError): self.call('get', {'pin_no': 3})

    def test_assert_current_blocks_append(self):
        before = self.ledger()
        def changed(): raise ValueError('도면이 바뀌었습니다.')
        with self.assertRaisesRegex(ValueError, '바뀌'): self.call('update', {'pin_no': 3, 'status': '처리됨'}, assert_current=changed)
        self.assertEqual(self.ledger(), before)

    def test_read_and_append_share_lock_and_queued_result_is_truthful(self):
        real = fr.process
        actions = []
        def process(data):
            self.assertTrue(fr._SPOOL_LOCK._is_owned())
            actions.append(data['action'])
            if data['action'] == 'append':
                return {'folder': str(self.folder), 'spooled': True, 'spoolPending': 1, 'error': '연결 끊김'}
            return real(data)
        with patch.object(fr, 'process', side_effect=process):
            result = self.call('update', {'pin_no': 3, 'status': '처리됨'})
        self.assertEqual(actions, ['read', 'append'])
        self.assertTrue(result['queued'])
        self.assertEqual(result['spoolPending'], 1)
        self.assertEqual(result['record']['status'], '열림')
        self.assertEqual(result['deleted'], 0)


    def test_reply_only_keeps_note_changes_and_updates_last_time(self):
        self.pin('p1', 'l1', 3, '2020-10-17T09:00:00+09:00', note='현장 메모 수정')
        result = self.call('update', {'pin_no': 3, 'reply': '확인 중입니다'})
        self.assertFalse(result['queued'])
        record = self.call('get', {'pin_no': 3})['record']
        self.assertEqual(record['status'], '열림')
        self.assertEqual(record['note'], '현장 메모 수정')
        changed = next(event for event in record['history'] if event['kind'] == 'pin.changed')
        self.assertEqual(changed['changes']['note'], {'from': '창가 확인', 'to': '현장 메모 수정'})
        self.assertEqual(record['lastAt'], record['replies'][0]['at'])

    def test_real_spool_preserves_ledger_until_retry(self):
        before = self.ledger()
        with patch.object(fr, '_append', side_effect=OSError('저장 위치 연결 끊김')):
            result = self.call('update', {'pin_no': 3, 'status': '처리됨'})
        self.assertTrue(result['queued'])
        self.assertTrue(result['spooled'])
        self.assertEqual(result['spoolPending'], 1)
        self.assertEqual(result['record']['status'], '열림')
        self.assertEqual(self.ledger(), before)
        completed, error = fr.drain_spool()
        self.assertEqual(error, '')
        self.assertEqual(len(completed), 1)
        self.assertEqual(self.call('get', {'pin_no': 3})['record']['status'], '처리됨')


if __name__ == '__main__':
    unittest.main()
