"""현장 기록함 — 임시 폴더에서 보관·복원·이동·경로 검사를 확인한다."""
import base64
import csv
import functools
import hashlib
import io
import json
import os
import tempfile
import subprocess
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import field_records as records

JPEG=b'\xff\xd8\xff\xe0test-jpeg'
PDF=b'%PDF-1.7\n%%EOF\n'


class FieldRecordsTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve();self.home=self.root/'기록함'
        self.env=patch.dict(os.environ,{'BARUN_FIELD_RECORDS_HOME':str(self.home),'BARUN_FIELD_RECORDS_PC':'시험PC','BARUN_FIELD_RECORDS_SPOOL':str(self.root/'대기')})
        self.env.start();self.addCleanup(self.env.stop)
        self.redirects=patch.dict(records._MOVED_FOLDERS,{},clear=True);self.redirects.start();self.addCleanup(self.redirects.stop)
        self.routes=patch.dict(records._QUEUED_FOLDERS,{},clear=True);self.routes.start();self.addCleanup(self.routes.stop)
        self.base={'drawingName':'현장 도면'}

    def call(self,action,**data):
        return records.process({**self.base,'action':action,**data})

    def pin(self,eid='e1',pid='p1',link='link1',at='2026-10-16T10:00:00+09:00',**fields):
        pin={'id':pid,'no':3,'title':'천장 확인','kind':'누수','prio':'높음','status':'미해결','assignee':'설비팀',
             'due':'2026-10-20','note':'배관 확인','at':{'x':1200,'y':3400},'photos':[]}
        pin.update(fields)
        return {'id':eid,'kind':'pin','link':link,'at':at,'by':'현장','pin':pin}

    def append(self,*events):
        return self.call('append',events=list(events))

    def photo(self,**data):
        return self.call('photo',**{'id':'photo1','link':'link1','pinId':'p1','pinNo':3,'pinKind':'누수',
                                  'takenAt':'2026-10-16T14:32:00+09:00','data':base64.b64encode(JPEG).decode(),**data})

    def test_drawing_folder(self):
        for suffix in ('.dwg','.DXF','.bcad'):
            with self.subTest(suffix=suffix):
                drawing=self.root/('101동'+suffix);drawing.write_bytes(b'drawing')
                result=self.call('folder',drawingPath=str(drawing))
                self.assertFalse(result['fallback']);self.assertEqual(Path(result['folder']),self.root/'101동_현장기록')

    @unittest.skipIf(os.name=='nt','POSIX 절대 경로는 macOS 에서만')
    def test_mac_absolute_paths_use_drawing_side_folder(self):
        for value,folder in (('/Volumes/개발/현장/101동.dwg','/Volumes/개발/현장/101동_현장기록'),('/Users/me/작업 a:b/평면.dxf','/Users/me/작업 a:b/평면_현장기록')):
            with self.subTest(path=value):
                result=records.folder_for({**self.base,'drawingPath':value},_check_parent=False)
                self.assertFalse(result['fallback']);self.assertEqual(result['folder'],folder)
        for value in ('/Users/me/../a.dwg','/Users/me/./a.dwg','/Users/me/a.txt','relative/a.dwg'):
            with self.subTest(path=value):self.assertTrue(records.folder_for({**self.base,'drawingPath':value},_check_parent=False)['fallback'])

    @unittest.skipUnless(os.name=='nt','NAS 주소(UNC)는 Windows 경로다. 맥 NAS 는 /Volumes/… 로 test_posix 쪽에서 본다')
    def test_nas_address_uses_drawing_side_folder(self):
        # 사용자 결정(10/16): NAS 주소(UNC)로 연 도면도 도면 옆 — 다른 PC 도 같은 기록을 본다
        for value,folder in ((r'\\nas\share\현장\101동.dwg',r'\\nas\share\현장\101동_현장기록'),('//nas/share/a.dxf',r'\\nas\share\a_현장기록')):
            with self.subTest(path=value):
                result=records.folder_for({**self.base,'drawingPath':value},_check_parent=False)
                self.assertFalse(result['fallback']);self.assertEqual(result['folder'],folder)
        # 장치 주소·조각 모자람·상대 조각은 대체 폴더
        for value in (r'\\?\C:\a.dwg',r'\\.\pipe\a.dwg',r'\\nas\a.dwg',r'\\nas\share\..\a.dwg',r'\\nas\share\a.dwg:stream'):
            with self.subTest(path=value):self.assertTrue(records.folder_for({**self.base,'drawingPath':value},_check_parent=False)['fallback'])

    def test_invalid_paths_use_fallback(self):
        bad=['','relative.dwg',r'C:\x.dwg:stream',r'C:\..\x.dwg',r'C:\NUL.dwg',r'C:\bad?\a.dwg']
        for value in bad:
            with self.subTest(path=value):
                result=records.folder_for({**self.base,'drawingPath':value})
                self.assertTrue(result['fallback']);self.assertEqual(Path(result['folder']),self.home/'현장 도면_현장기록')
        for value in ('CON','NUL.txt',' . ','a<>:"/\\|?*\x01','x'*100):
            result=records.folder_for({'drawingName':value})
            self.assertTrue(Path(result['folder']).is_relative_to(self.home));self.assertNotIn(':',Path(result['folder']).name)
        self.assertEqual(Path(records.folder_for({'drawingName':'CON'})['folder']).name,'_CON_현장기록')
        self.assertEqual(Path(records.folder_for({'drawingName':' . '})['folder']).name,'도면_현장기록')
        self.assertEqual(len(Path(records.folder_for({'drawingName':'x'*100})['folder']).name),len('_현장기록')+60)

    def test_fallback_draft_keys_separate_unsaved_drawings(self):
        first=records.folder_for({**self.base,'drawingPath':'','draftKey':'문서칸-1'})
        same=records.folder_for({**self.base,'draftKey':'문서칸-1'})
        second=records.folder_for({**self.base,'draftKey':'문서칸-2'})
        digest=hashlib.sha256('문서칸-1'.encode('utf-8')).hexdigest()[:6]
        self.assertTrue(first['fallback']);self.assertEqual(first['folder'],same['folder'])
        self.assertNotEqual(first['folder'],second['folder'])
        self.assertEqual(Path(first['folder']),self.home/('현장 도면_'+digest+'_현장기록'))
        for key in ('',None,123):
            self.assertEqual(Path(records.folder_for({**self.base,'draftKey':key})['folder']),self.home/'현장 도면_현장기록')

    def test_missing_drawing_with_existing_parent_uses_adjacent_folder(self):
        for suffix in ('.dwg','.DXF','.bcad'):
            with self.subTest(suffix=suffix):
                drawing=self.root/('없는'+suffix);self.assertFalse(drawing.exists())
                result=self.call('folder',drawingPath=str(drawing),draftKey='문서칸-1')
                self.assertFalse(result['fallback']);self.assertEqual(Path(result['folder']),self.root/'없는_현장기록')

    def test_missing_drawing_parent_is_retryable(self):
        drawing=self.root/'끊긴 폴더'/'없는.dwg'
        with self.assertRaises(FileNotFoundError) as error:
            self.call('folder',drawingPath=str(drawing))
        self.assertEqual(str(error.exception),'도면 폴더에 닿을 수 없습니다: '+str(drawing.parent))
        self.assertFalse(drawing.parent.exists());self.assertFalse(self.home.exists())

    def test_default_documents_folder(self):
        with patch.dict(os.environ,{'USERPROFILE':str(self.root)}):
            os.environ.pop('BARUN_FIELD_RECORDS_HOME')
            self.assertEqual(Path(records.folder_for({})['folder']),self.root/'Documents'/'바른 CAD'/'현장기록'/'도면_현장기록')
            os.environ.pop('USERPROFILE')
            with patch.object(Path,'home',return_value=self.root):
                self.assertEqual(Path(records.folder_for({})['folder']),self.root/'Documents'/'바른 CAD'/'현장기록'/'도면_현장기록')

    def test_read_missing_does_not_create(self):
        result=self.call('read');self.assertEqual(result['events'],[]);self.assertEqual(result['pins'],[])
        self.assertFalse(Path(result['folder']).exists())

    def test_duplicate_and_server_metadata(self):
        event=self.pin();event.update(pc='다른PC',savedAt='거짓')
        self.assertEqual(self.append(event)['added'],1)
        before=(Path(self.call('read')['folder'])/'기록장부_시험PC.jsonl').read_bytes()
        result=self.append(event,event);self.assertEqual((result['added'],result['skipped']),(0,2))
        after=(Path(result['folder'])/'기록장부_시험PC.jsonl').read_bytes();self.assertEqual(before,after)
        self.assertEqual(len(after.splitlines()),1);self.assertTrue(after.endswith(b'\n'));self.assertNotIn(b'\r',after)
        saved=self.call('read')['events'][0];self.assertEqual(saved['pc'],'시험PC')
        self.assertIsNotNone(datetime.fromisoformat(saved['savedAt']).tzinfo)
        self.append({'id':'m','kind':'measure','measure':{'id':'m1','text':'4000'}})
        saved=self.call('read')['events'][-1];self.assertEqual(saved['at'],saved['savedAt'])
        self.assertEqual(saved['kind'],'measure.received');self.assertEqual(saved['data'],{'id':'m1','text':'4000'})

    def test_append_without_changes_does_not_rewrite_csv(self):
        event=self.pin();self.append(event)
        with patch.object(records,'_write_csv') as write_csv:
            self.assertEqual(self.append(event,event)['added'],0)
            self.assertEqual(self.append(self.pin('unchanged'))['added'],0)
            self.assertEqual(self.append()['added'],0)
        write_csv.assert_not_called()

    def test_pin_changes_only_changed_fields(self):
        self.append(self.pin(photos=[{'id':'a','name':'원본'}]))
        result=self.append(self.pin('same',photos=[{'id':'a','name':'이름만'}]))
        self.assertEqual((result['added'],result['skipped']),(0,1))
        self.append(self.pin('changed',at='2026-10-16T11:00:00+09:00',title='천장 누수',photos=[{'id':'a'},{'id':'b'}]))
        events=self.call('read')['events'];self.assertEqual(events[-1]['kind'],'pin.changed')
        self.assertEqual(events[-1]['changes'],{'title':{'from':'천장 확인','to':'천장 누수'},'photos':{'from':['a'],'to':['a','b']}})
        self.assertEqual(self.call('read')['pins'][0]['title'],'천장 누수')
        self.assertEqual(self.call('read')['pins'][0]['photos'],[],'실제 저장된 사진만 돌려준다')
        self.assertEqual(self.append(self.pin('changed'))['skipped'],1)

    def test_pin_identity_includes_link_and_batch_changes(self):
        result=self.append(self.pin(),self.pin('e2',title='수정'),self.pin('e3',link='other'))
        self.assertEqual(result['added'],3);self.assertEqual(len(self.call('read')['pins']),2)
        self.assertEqual([e['kind'] for e in self.call('read')['events']],['pin.received','pin.changed','pin.received'])

    def test_office_status_replies_and_history(self):
        self.append(self.pin())
        self.append({'id':'office','kind':'pin.status','link':'link1','pin':'p1','at':'2026-10-16T11:00:00+09:00','to':'진행 중'})
        self.append({'id':'r1','kind':'reply.sent','link':'link1','pin':'p1','at':'2026-10-16T11:01:00+09:00','by':'사무실','text':'확인합니다','delivered':True},
                    {'id':'r2','kind':'reply.sent','link':'link1','pin':'p1','at':'2026-10-16T11:02:00+09:00','by':'사무실','text':'내일 방문','delivered':False})
        self.assertEqual(self.append(self.pin('poll'))['skipped'],1,'사무실 상태를 현장 변경과 혼동하지 않는다')
        pin=self.call('read')['pins'][0];self.assertEqual(pin['status'],'진행 중')
        self.assertEqual([r['text'] for r in pin['replies']],['확인합니다','내일 방문'])
        self.assertEqual([r['delivered'] for r in pin['replies']],[True,False]);self.assertEqual(len(pin['history']),4)
        self.append(self.pin('later',at='2026-10-16T12:00:00+09:00',status='해결'))
        pin=self.call('read')['pins'][0];self.assertEqual(pin['status'],'해결')
        self.assertEqual(pin['firstAt'],'2026-10-16T10:00:00+09:00');self.assertEqual(pin['lastAt'],'2026-10-16T12:00:00+09:00')

    def test_two_pc_ledgers_external_append_and_broken_lines(self):
        folder=Path(self.append(self.pin())['folder'])
        with patch.dict(os.environ,{'BARUN_FIELD_RECORDS_PC':'다른PC'}):
            self.append({'id':'second','kind':'link.created','at':'2026-10-16T10:00:00+09:00'})
        other=folder/'기록장부_다른PC.jsonl'
        with other.open('ab') as stream:
            stream.write(b'broken\n\xff\n[]\n{}\n')
            stream.write(records._json_bytes({'id':'external','kind':'link.created','at':'2026-10-16T12:00:00+09:00'})+b'\n')
        self.assertEqual(self.append({'id':'external','kind':'link.created'})['skipped'],1)
        events=self.call('read')['events'];self.assertEqual(len(events),3)
        expected=['second','e1'] if other.name<'기록장부_시험PC.jsonl' else ['e1','second']
        self.assertEqual([e['id'] for e in events],expected+['external'])
        self.assertTrue((folder/'기록장부_시험PC.jsonl').is_file())

    def test_timestamp_offsets_sort_chronologically(self):
        self.append({'id':'late','kind':'link.created','at':'2026-10-16T04:00:00Z'},
                    {'id':'early','kind':'link.created','at':'2026-10-16T12:00:00+09:00'})
        self.assertEqual([e['id'] for e in self.call('read')['events']],['early','late'])

    def test_photo_filename_bytes_hash_and_duplicate(self):
        self.append(self.pin(photos=[{'id':'photo1'}]))
        result=self.photo();self.assertFalse(result['existed'])
        stamp=datetime.fromisoformat('2026-10-16T14:32:00+09:00').astimezone().strftime('%Y-%m-%d_%H%M')
        self.assertEqual(result['file'],f'사진/{stamp}_핀03_누수_photo1.jpg')
        path=Path(result['folder'])/result['file'];self.assertEqual(path.read_bytes(),JPEG)
        with patch.object(records,'_write_csv') as write_csv:duplicate=self.photo(data='invalid')
        write_csv.assert_not_called();self.assertTrue(duplicate['existed']);self.assertEqual(duplicate['file'],result['file'])
        second=self.photo(id='photo2');self.assertTrue(second['file'].endswith('_photo2.jpg'))
        events=self.call('read')['events'];saved=next(e for e in events if e['id']=='photo1')
        self.assertEqual(saved['bytes'],len(JPEG));self.assertEqual(saved['sha256'],hashlib.sha256(JPEG).hexdigest())
        pin=self.call('read')['pins'][0];self.assertEqual(len(pin['photos']),2)
        self.assertEqual(base64.b64decode(self.call('photo-get',file=result['file'])['data']),JPEG)
        self.assertEqual(list(path.parent.glob('*.tmp')),[])

    def test_two_pc_photos_keep_separate_files_and_hashes(self):
        self.append(self.pin())
        first=self.photo(id='pc-one-photo')
        other_body=JPEG+b'other-pc'
        with patch.dict(os.environ,{'BARUN_FIELD_RECORDS_PC':'다른PC'}):
            second=self.photo(id='pc-two-photo',data=base64.b64encode(other_body).decode())
        folder=Path(first['folder']);self.assertNotEqual(first['file'],second['file'])
        self.assertEqual(len(list((folder/'사진').glob('*.jpg'))),2)
        saved={event['id']:event for event in self.call('read')['events'] if event['kind']=='photo.saved'}
        for eid,body in (('pc-one-photo',JPEG),('pc-two-photo',other_body)):
            event=saved[eid];actual=(folder/event['file']).read_bytes()
            self.assertEqual(actual,body);self.assertEqual(event['sha256'],hashlib.sha256(actual).hexdigest())
        self.assertNotEqual(saved['pc-one-photo']['pc'],saved['pc-two-photo']['pc'])

    def test_same_photo_name_and_content_reuses_file(self):
        first=self.photo(id='shared-a')
        with patch.dict(os.environ,{'BARUN_FIELD_RECORDS_PC':'다른PC'}):second=self.photo(id='shared-b')
        self.assertEqual(first['file'],second['file']);self.assertFalse(second['existed'])
        self.assertEqual(len(list((Path(first['folder'])/'사진').glob('*.jpg'))),1)
        self.assertEqual(len(self.call('read')['events']),2)

    def test_same_photo_name_with_different_content_uses_next_number(self):
        first=self.photo(id='shared-a');other_body=JPEG+b'other'
        second=self.photo(id='shared-b',data=base64.b64encode(other_body).decode())
        self.assertTrue(second['file'].endswith('_shared_2.jpg'))
        folder=Path(first['folder']);self.assertEqual((folder/first['file']).read_bytes(),JPEG)
        self.assertEqual((folder/second['file']).read_bytes(),other_body)

    def test_photo_rename_race_preserves_winner_and_cleans_temp(self):
        rename=os.rename
        for label,winner in (('different',JPEG+b'winner'),('same',JPEG)):
            with self.subTest(content=label):
                calls=[]
                def race(temp,target):
                    self.assertEqual(temp.suffix,'.tmp');self.assertEqual(temp.read_bytes(),JPEG)
                    calls.append(target)
                    if len(calls)==1:
                        target.write_bytes(winner);raise FileExistsError('다른 PC가 먼저 저장함')
                    return rename(temp,target)
                with patch.object(records.os,'rename',side_effect=race):result=self.photo(id='race-'+label)
                folder=Path(result['folder']);self.assertEqual(calls[0].read_bytes(),winner)
                self.assertEqual((folder/result['file']).read_bytes(),JPEG)
                self.assertEqual(len(calls),2 if label=='different' else 1)
                self.assertEqual(result['file'].endswith('_2.jpg'),label=='different')
                self.assertEqual(list((folder/'사진').glob('*.tmp')),[])

    def test_photo_rename_failure_leaves_no_event_or_temp(self):
        with patch.object(records.os,'rename',side_effect=PermissionError('쓰기 금지')):
            result=self.photo()
        self.assertTrue(result['spooled']);self.assertEqual(result['spoolPending'],1)
        folder=Path(records.folder_for(self.base)['folder'])
        self.assertEqual(list((folder/'사진').iterdir()),[]);self.assertEqual(records._read_events(folder),[])
        restored=self.call('read');self.assertEqual(restored['spoolPending'],0)
        self.assertEqual([event['id'] for event in restored['events']],['photo1'])

    def test_photo_id_is_safe_in_filename(self):
        result=self.photo(id='../:*?unsafe')
        self.assertNotRegex(Path(result['file']).name,r'[<>:"/\\|?*]')
        self.assertEqual(base64.b64decode(self.call('photo-get',id='../:*?unsafe')['data']),JPEG)

    def test_photo_rejects_bad_data_and_size(self):
        for body in (b'PNG',JPEG+b'x'*(8*1024*1024)):
            with self.subTest(size=len(body)),self.assertRaises(ValueError):self.photo(data=base64.b64encode(body).decode())
        with self.assertRaises(ValueError):self.photo(data='%%%')
        self.assertFalse(Path(records.folder_for(self.base)['folder']).exists())

    def test_photo_get_rejects_escape(self):
        for value in ('../x.jpg',r'C:\x.jpg','사진/../../a.jpg','사진/sub/a.jpg','링크/a.jpg','사진/a.png','/사진/a.jpg',r'사진\a.jpg:stream'):
            with self.subTest(file=value),self.assertRaises(ValueError):self.call('photo-get',file=value)

    def test_photo_get_rejects_symlink_escape(self):
        folder=Path(self.call('folder')['folder']);outside=self.root/'바깥';outside.mkdir();(outside/'x.jpg').write_bytes(JPEG)
        try:(folder/'사진').symlink_to(outside,target_is_directory=True)
        except OSError as error:
            if os.name!='nt':self.skipTest('심볼릭 링크를 만들 수 없음: '+str(error))
            subprocess.run(['cmd','/c','mklink','/J',str(folder/'사진'),str(outside)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        with self.assertRaises(ValueError):self.call('photo-get',file='사진/x.jpg')
        with self.assertRaises(ValueError):self.photo()

    def test_link_omits_tokens_and_overwrites_state(self):
        link={'id':'abcdef123456','name':'현장 방문','scope':'pin','hours':24,'createdAt':'2026-10-16T14:00:00+09:00',
              'expiresAt':'2026-10-17T14:00:00+09:00','key':'비밀1','writeToken':'비밀2','ownerToken':'비밀3'}
        result=self.call('link',link=link);path=Path(result['folder'])/result['file']
        public=json.loads(path.read_bytes());self.assertTrue({'key','writeToken','ownerToken'}.isdisjoint(public))
        for secret in ('비밀1','비밀2','비밀3'):self.assertNotIn(secret,path.read_bytes().decode())
        link['revokedAt']='2026-10-16T16:00:00+09:00';self.call('link',link=link)
        self.assertEqual(json.loads(path.read_bytes())['revokedAt'],link['revokedAt']);self.assertEqual(len(list(path.parent.glob('*.json'))),1)
        self.assertEqual(self.call('read')['events'],[])

    def test_move_to_new_folder(self):
        before=Path(self.append(self.pin())['folder']);photo=self.photo()
        drawing=self.root/'저장 도면.dwg';drawing.write_bytes(b'dwg')
        result=self.call('move',fromName='현장 도면',toPath=str(drawing),toName='저장 도면')
        self.assertTrue(result['moved']);self.assertFalse(before.exists())
        after=Path(result['folder']);self.assertEqual((after/photo['file']).read_bytes(),JPEG)
        events=records.process({'action':'read','drawingPath':str(drawing)})['events']
        self.assertEqual(events[-1]['kind'],'folder.moved');self.assertTrue((after/'현장기록_목록.csv').is_file())

    def test_move_from_draft_key_to_saved_drawing(self):
        source=Path(self.call('append',draftKey='문서칸-1',events=[self.pin()])['folder'])
        photo=self.photo(draftKey='문서칸-1')
        drawing=self.root/'저장 도면.dwg'
        result=self.call('move',fromName='현장 도면',fromDraftKey='문서칸-1',toPath=str(drawing),toName='저장 도면')
        self.assertTrue(result['moved']);self.assertFalse(source.exists())
        self.assertFalse(result['fallback']);self.assertEqual(Path(result['folder']),self.root/'저장 도면_현장기록')
        self.assertEqual((Path(result['folder'])/photo['file']).read_bytes(),JPEG)
        self.assertFalse(drawing.exists())

    def test_move_between_draft_keys(self):
        source=Path(self.call('append',draftKey='문서칸-1',events=[self.pin()])['folder'])
        result=self.call('move',fromName='현장 도면',fromDraftKey='문서칸-1',toName='현장 도면',toDraftKey='문서칸-2')
        expected=records.folder_for({**self.base,'draftKey':'문서칸-2'})
        self.assertTrue(result['moved']);self.assertFalse(source.exists());self.assertEqual(result['folder'],expected['folder'])
        self.assertEqual(len(self.call('read',draftKey='문서칸-2')['pins']),1)

    def test_move_photo_merge_preserves_concurrent_photo(self):
        photo=self.photo();destination=Path(self.call('folder',drawingName='목적')['folder'])
        winner=JPEG+b'other-pc';rename=os.rename;calls=[]
        def race(temp,target):
            calls.append(target)
            if len(calls)==1:
                target.write_bytes(winner)
                event=records._stamp({'id':'other-photo','kind':'photo.saved','file':target.relative_to(destination).as_posix(),
                                      'sha256':hashlib.sha256(winner).hexdigest(),'bytes':len(winner)})
                records._append_events(destination,[event])
                raise FileExistsError('다른 PC가 먼저 저장함')
            return rename(temp,target)
        with patch.object(records.os,'rename',side_effect=race):
            result=self.call('move',fromName='현장 도면',toName='목적')
        self.assertTrue(result['moved']);self.assertEqual(len(calls),2)
        self.assertEqual(calls[0].read_bytes(),winner)
        self.assertEqual((destination/photo['file']).read_bytes(),winner)
        events=self.call('read',drawingName='목적')['events']
        for eid,body in (('photo1',JPEG),('other-photo',winner)):
            event=next(event for event in events if event['id']==eid)
            actual=(destination/event['file']).read_bytes()
            self.assertEqual(actual,body);self.assertEqual(event['sha256'],hashlib.sha256(actual).hexdigest())
        self.assertEqual(list((destination/'사진').glob('*.tmp')),[])

    def test_move_merge_preserves_source_and_remaps_collisions(self):
        source=Path(self.append(self.pin())['folder']);original=self.photo()
        self.call('report',name='보고서',data=base64.b64encode(PDF).decode())
        self.call('link',link={'id':'link1','createdAt':'2026-10-16T10:00:00+09:00'})
        other={**self.base,'drawingName':'목적'}
        records.process({**other,'action':'append','events':[self.pin('dest-pin',pid='dest')]})
        dest_photo=records.process({**other,'action':'photo','id':'photo1-dest','link':'link1','pinId':'dest','pinNo':3,'pinKind':'누수',
                                   'takenAt':'2026-10-16T14:32:00+09:00','data':base64.b64encode(JPEG+b'dest').decode()})
        records.process({**other,'action':'report','name':'보고서','data':base64.b64encode(PDF+b'dest').decode()})
        records.process({**other,'action':'link','link':{'id':'link1','createdAt':'2026-10-16T10:00:00+09:00'}})
        records.process({**other,'action':'append','events':[{'id':'common','kind':'link.created'}]})
        self.append({'id':'common','kind':'link.created'})
        result=self.call('move',fromName='현장 도면',toName='목적');self.assertTrue(result['moved']);self.assertTrue(source.is_dir())
        merged=records.process({**other,'action':'read'});events=merged['events'];ids=[e['id'] for e in events]
        self.assertEqual(ids.count('common'),1)
        copied=next(e for e in events if e['id']=='photo1');self.assertNotEqual(copied['file'],dest_photo['file'])
        self.assertEqual((Path(result['folder'])/copied['file']).read_bytes(),JPEG)
        self.assertEqual((Path(result['folder'])/dest_photo['file']).read_bytes(),JPEG+b'dest')
        self.assertEqual((source/original['file']).read_bytes(),JPEG)
        # 화면은 사진을 id 로 찾는다 — 합치며 이름이 바뀌어도 각자 맞는 사진
        get=lambda pid:base64.b64decode(records.process({**other,'action':'photo-get','id':pid})['data'])
        self.assertEqual(get('photo1'),JPEG);self.assertEqual(get('photo1-dest'),JPEG+b'dest')
        with self.assertRaises(ValueError):records.process({**other,'action':'photo-get','id':'없음'})
        self.assertEqual(len(list((Path(result['folder'])/'펀치리스트').glob('*.pdf'))),2)
        self.assertEqual(len(list((Path(result['folder'])/'링크').glob('*.json'))),2)
        self.assertEqual(next(p for p in merged['pins'] if p['id']=='p1')['photos'][0]['file'],copied['file'])

    def test_move_missing_or_same_folder(self):
        result=self.call('move',fromName='없는',toName='목적');self.assertFalse(result['moved']);self.assertFalse(Path(result['folder']).exists())
        self.append(self.pin());self.assertFalse(self.call('move',fromName='현장 도면',toName='현장 도면')['moved'])

    def test_csv_bom_columns_order_and_last_reply(self):
        self.append(self.pin(no=10),self.pin('e2',pid='p2',no=2,title='쉼표,\n줄바꿈'))
        self.append({'id':'reply','kind':'reply.sent','pin':'p1','link':'link1','text':'마지막 답'})
        self.photo();path=Path(self.call('read')['folder'])/'현장기록_목록.csv';body=path.read_bytes()
        self.assertTrue(body.startswith(b'\xef\xbb\xbf'));self.assertIn(b'\r\n',body)
        rows=list(csv.reader(io.StringIO(body.decode('utf-8-sig'),newline='')))
        self.assertEqual(rows[0],list(records.CSV_COLUMNS));self.assertEqual([row[0] for row in rows[1:]],['2','10'])
        self.assertEqual(rows[-1][9:12],['1','마지막 답','link1'])
        self.assertEqual(rows[1][1],'쉼표,\n줄바꿈')
        self.assertRegex(rows[1][7],r'^\d{4}-\d\d-\d\d \d\d:\d\d$','엑셀용 시각은 이 PC 시각 YYYY-MM-DD HH:MM')

    def test_csv_permission_error_does_not_lose_journal(self):
        original=records._atomic_write
        def locked(path,body):
            if path.suffix=='.csv':raise PermissionError('엑셀에서 사용 중')
            return original(path,body)
        with patch.object(records,'_atomic_write',side_effect=locked):self.assertEqual(self.append(self.pin())['added'],1)
        self.assertEqual(len(self.call('read')['events']),1)
        self.append({'id':'csv-retry','kind':'link.created'})
        self.assertTrue((Path(self.call('read')['folder'])/'현장기록_목록.csv').exists())

    def test_reports_validate_pdf_and_keep_old_versions(self):
        for body in (b'JPEG',PDF+b'x'*(30*1024*1024)):
            with self.subTest(size=len(body)),self.assertRaises(ValueError):self.call('report',data=base64.b64encode(body).decode())
        first=self.call('report',name='../최종.pdf',data=base64.b64encode(PDF).decode())
        second=self.call('report',name='../최종.pdf',data=base64.b64encode(PDF).decode())
        self.assertNotEqual(first['file'],second['file']);self.assertTrue(second['file'].endswith('_2.pdf'))
        self.assertTrue(first['file'].startswith('펀치리스트/'));self.assertEqual((Path(first['folder'])/first['file']).read_bytes(),PDF)
        self.assertEqual([e['kind'] for e in self.call('read')['events']],['report.made','report.made'])

    def test_unknown_kind_invalid_id_and_limits_are_atomic(self):
        for event in ({'id':'bad','kind':'unknown'},{'id':'','kind':'link.created'},{'id':1,'kind':'link.created'},
                      {'id':'large','kind':'reply.sent','text':'가'*30000},{'id':'pin','kind':'pin','pin':{}}):
            with self.subTest(event=str(event)[:80]),self.assertRaises(ValueError):self.append(self.pin(),event)
        with self.assertRaises(ValueError):self.call('append',events=[self.pin()]*501)
        self.assertEqual(self.call('read')['events'],[])
        for value in (None,[],{'action':'other'}):
            with self.assertRaises(ValueError):records.process(value)

    def test_partial_last_line_is_preserved_and_next_event_readable(self):
        folder=Path(self.call('folder')['folder']);path=folder/'기록장부_시험PC.jsonl';path.write_bytes(b'{broken')
        self.append(self.pin());self.assertTrue(path.read_bytes().startswith(b'{broken\n'))
        self.assertEqual(len(self.call('read')['events']),1)

    def test_concurrent_duplicate_requests(self):
        def add(_):return self.append(self.pin())['added']
        with ThreadPoolExecutor(max_workers=6) as pool:counts=list(pool.map(add,range(12)))
        self.assertEqual(sum(counts),1);self.assertEqual(len(self.call('read')['events']),1)

    def test_bad_references_rejected_before_writing_and_bad_external_rows_skipped(self):
        for event in ({'id':'a','kind':'pin.status','link':'link1','pin':[]},
                      {'id':'b','kind':'reply.sent','pin':{'id':[]}},
                      {'id':'c','kind':[]},{'id':'d','kind':'link.created','link':[]}):
            with self.subTest(event=event),self.assertRaises(ValueError):self.append(self.pin(),event)
        self.assertEqual(self.call('read')['events'],[])
        for value in ({'pinId':[]},{'link':[]}):
            with self.subTest(value=value),self.assertRaises(ValueError):self.photo(**value)
        folder=Path(self.append(self.pin())['folder'])
        bad={'id':'external-bad','kind':'pin.status','link':'link1','pin':[]}
        with (folder/'기록장부_other.jsonl').open('ab') as stream:stream.write(records._json_bytes(bad)+b'\n')
        self.assertEqual(len(self.call('read')['events']),1);self.assertEqual(self.append(self.pin('same'))['skipped'],1)

    def test_csv_formula_neutralized_without_changing_pin(self):
        self.append(self.pin(title='=1+1',assignee='  @SUM(1)',note='원문'))
        self.append({'id':'formula','kind':'reply.sent','pin':'p1','text':'+1+1'})
        result=self.call('read');self.assertEqual(result['pins'][0]['title'],'=1+1')
        path=Path(result['folder'])/'현장기록_목록.csv'
        row=list(csv.reader(io.StringIO(path.read_bytes().decode('utf-8-sig'))))[1]
        self.assertEqual(row[1],"'=1+1");self.assertEqual(row[5],"'  @SUM(1)");self.assertEqual(row[10],"'+1+1")

    def test_generated_photo_name_with_internal_dots_can_be_read(self):
        result=self.photo(pinKind='누수..확인')
        self.assertEqual(base64.b64decode(self.call('photo-get',file=result['file'])['data']),JPEG)

    def test_windows_extended_path_prefix_uses_same_lock(self):
        if os.name!='nt':self.skipTest('Windows 경로 시험')
        folder=Path(records.folder_for(self.base)['folder']);normal=folder.resolve();prefix=chr(92)*2+'?'+chr(92)
        extended=Path(prefix+str(normal))
        with patch.object(Path,'resolve',side_effect=[normal,extended]):
            self.assertIs(records._lock(folder),records._lock(folder))

    def test_delayed_pin_snapshot_does_not_overwrite_newer_fields(self):
        self.append(self.pin(at='2026-10-16T10:00:00+09:00',title='A',status='미해결'))
        self.append(self.pin('newer',at='2026-10-16T12:00:00+09:00',title='B',status='미해결'))
        self.append(self.pin('delayed',at='2026-10-16T11:00:00+09:00',title='B',status='해결'))
        pin=self.call('read')['pins'][0]
        self.assertEqual((pin['title'],pin['status']),('B','미해결'))
        self.assertEqual(pin['lastAt'],'2026-10-16T12:00:00+09:00')
        self.assertEqual(self.append(self.pin('poll',at='2026-10-16T12:00:00+09:00',title='B',status='미해결'))['added'],0)

    def test_delayed_pin_in_batch_uses_latest_state(self):
        self.append(self.pin(at='2026-10-16T10:00:00+09:00',title='A'))
        result=self.append(self.pin('newer',at='2026-10-16T12:00:00+09:00',title='B'),
                           self.pin('delayed',at='2026-10-16T11:00:00+09:00',title='B',status='해결'),
                           self.pin('latest-poll',at='2026-10-16T12:00:00+09:00',title='B'))
        self.assertEqual((result['added'],result['skipped']),(2,1))
        self.assertEqual(self.call('read')['pins'][0]['status'],'미해결')

    def test_spool_default_location_and_override(self):
        self.assertEqual(records._spool_folder(),self.root/'대기')
        with patch.dict(os.environ,{'LOCALAPPDATA':str(self.root/'local')}):
            os.environ.pop('BARUN_FIELD_RECORDS_SPOOL')
            self.assertEqual(records._spool_folder(),self.root/'local'/'BarunCAD'/'field-records-spool')
            os.environ.pop('LOCALAPPDATA')
            with patch.object(records.tempfile,'gettempdir',return_value=str(self.root/'temp')):
                self.assertEqual(records._spool_folder(),self.root/'temp'/'BarunCAD'/'field-records-spool')

    def test_append_storage_failure_spools_original_and_drains_before_new_append(self):
        event={'id':'old','kind':'link.created'};data={**self.base,'action':'append','events':[event],'extra':'원본 유지'}
        with patch.object(records,'_append_events',side_effect=OSError('디스크 가득')):
            result=records.process(data)
        self.assertTrue(result['spooled']);self.assertEqual(result['error'],'디스크 가득')
        self.assertEqual(result['spoolPending'],1);self.assertTrue(result['fallback'])
        files=list((self.root/'대기').glob('*.json'));self.assertEqual(len(files),1)
        self.assertEqual(json.loads(files[0].read_bytes()),data);self.assertEqual(list(files[0].parent.glob('*.tmp')),[])
        added=self.append({'id':'new','kind':'link.created'})
        self.assertEqual(added['added'],1);self.assertEqual(added['spoolPending'],0)
        self.assertEqual([row['id'] for row in self.call('read')['events']],['old','new'])

    def test_photo_storage_failure_spools_and_next_read_restores_bytes(self):
        self.append(self.pin())
        with patch.object(records,'_write_photo',side_effect=PermissionError('파일 사용 중')):
            result=self.photo()
        self.assertTrue(result['spooled']);self.assertEqual(result['spoolPending'],1)
        queued=json.loads(next((self.root/'대기').glob('*.json')).read_bytes())
        self.assertEqual(queued['action'],'photo');self.assertEqual(base64.b64decode(queued['data']),JPEG)
        restored=self.call('read');self.assertEqual(restored['spoolPending'],0)
        self.assertEqual([row['id'] for row in restored['events']],['e1','photo1'])
        photo=restored['pins'][0]['photos'][0]
        self.assertEqual((Path(restored['folder'])/photo['file']).read_bytes(),JPEG)

    def test_missing_drawing_parent_spools_write_and_recovers_without_fallback(self):
        drawing=self.root/'끊긴 공유 폴더'/'현장.dwg'
        result=self.call('append',drawingPath=str(drawing),events=[self.pin()])
        self.assertTrue(result['spooled']);self.assertFalse(result['fallback'])
        self.assertEqual(Path(result['folder']),drawing.parent/'현장_현장기록')
        self.assertFalse(drawing.parent.exists());self.assertFalse(self.home.exists())
        drawing.parent.mkdir()
        restored=self.call('read',drawingPath=str(drawing))
        self.assertEqual(restored['spoolPending'],0);self.assertEqual(len(restored['pins']),1)
        self.assertFalse(self.home.exists())

    def test_all_write_actions_spool_one_original_request(self):
        payloads={
            'append':{'events':[self.pin()]},
            'photo':{'id':'photo','pinId':'p1','data':base64.b64encode(JPEG).decode()},
            'link':{'link':{'id':'l1'}},
            'report':{'data':base64.b64encode(PDF).decode()},
            'move':{'fromName':'현장 도면','toName':'목적'},
        }
        for action,payload in payloads.items():
            with self.subTest(action=action),patch.dict(os.environ,{'BARUN_FIELD_RECORDS_SPOOL':str(self.root/action)}):
                data={**self.base,'action':action,**payload}
                with patch.object(records,'_process',side_effect=OSError('NAS 끊김')):result=records.process(data)
                self.assertTrue(result['spooled']);self.assertEqual(result['spoolPending'],1)
                expected=records.folder_for({'drawingName':'목적'} if action=='move' else self.base)
                self.assertEqual(result['folder'],expected['folder'])
                files=list((self.root/action).glob('*.json'));self.assertEqual(len(files),1)
                self.assertEqual(json.loads(files[0].read_bytes()),data)

    def test_spool_blocks_new_writes_in_order_even_when_clock_goes_back(self):
        first={'id':'first','kind':'link.created'};second={'id':'second','kind':'link.created'}
        with patch.object(records,'_append_events',side_effect=OSError('연결 끊김')) as append_events:
            self.append(first)
            with patch.object(records.time,'time_ns',return_value=1):result=self.append(second)
            self.assertTrue(result['spooled']);self.assertEqual(result['spoolPending'],2)
            files=records._spool_files()
            self.assertEqual([json.loads(file.read_bytes())['events'][0]['id'] for file in files],['first','second'])
            self.assertEqual([call.args[1][0]['id'] for call in append_events.call_args_list],['first','first'])
            pending=self.call('read');self.assertEqual(pending['spoolPending'],2);self.assertEqual(pending['events'],[])
        restored=self.call('read');self.assertEqual(restored['spoolPending'],0)
        self.assertEqual([event['id'] for event in restored['events']],['first','second'])

    def test_invalid_spool_files_go_to_bad_and_drain_continues(self):
        spool=self.root/'대기';spool.mkdir()
        invalid=[b'\xff',b'{broken',records._json_bytes({'action':'append','events':[{'id':'bad','kind':'bad'}]}),b'[]']
        for index,body in enumerate(invalid):(spool/f'{index:020d}_bad.json').write_bytes(body)
        good={**self.base,'action':'append','events':[{'id':'good','kind':'link.created'}]}
        (spool/'00000000000000000005_good.json').write_bytes(records._json_bytes(good))
        restored=self.call('read');self.assertEqual(restored['spoolPending'],0)
        self.assertEqual([event['id'] for event in restored['events']],['good'])
        self.assertEqual([item.read_bytes() for item in sorted((spool/'bad').glob('*.json'))],invalid)
        self.assertEqual(list(spool.glob('*.json')),[])

    def test_invalid_new_queued_request_is_rejected_without_spooling(self):
        with patch.object(records,'_append_events',side_effect=OSError('끊김')):self.append(self.pin())
        with self.assertRaises(ValueError):self.call('append',events=[{'id':'bad','kind':'bad'}])
        self.assertFalse((self.root/'대기'/'bad').exists())
        self.assertEqual(len(records._spool_files()),1)
        self.assertEqual(len(self.call('read')['pins']),1)

    def test_concurrent_spool_drains_replay_each_request_once(self):
        for index in range(6):records._enqueue({**self.base,'action':'append','events':[{'id':str(index),'kind':'link.created'}]})
        with patch.object(records,'_append',wraps=records._append) as append:
            with ThreadPoolExecutor(max_workers=6) as pool:list(pool.map(lambda _:records.drain_spool(),range(6)))
        self.assertEqual(append.call_count,6);self.assertEqual(self.call('read')['spoolPending'],0)
        self.assertEqual([event['id'] for event in self.call('read')['events']],[str(index) for index in range(6)])

    def test_spool_survives_failed_atomic_rename_without_false_success(self):
        with patch.object(records,'_append_events',side_effect=OSError('NAS 끊김')):
            with patch.object(records.os,'replace',side_effect=PermissionError('대기 폴더도 잠김')),self.assertRaises(PermissionError):
                self.append(self.pin())
        self.assertEqual(list((self.root/'대기').iterdir()),[])

    def test_move_redirects_append_for_ten_minutes_for_rename_and_merge(self):
        for merge in (False,True):
            with self.subTest(merge=merge),patch.object(records.time,'monotonic',return_value=100) as clock:
                source={'drawingName':'원본-'+str(merge)};dest={'drawingName':'목적-'+str(merge)}
                original=records.process({**source,'action':'append','events':[self.pin()]})
                if merge:records.process({**dest,'action':'folder'})
                moved=records.process({'action':'move','fromName':source['drawingName'],'toName':dest['drawingName']})
                self.assertTrue(moved['moved']);clock.return_value=699
                late=records.process({**source,'action':'append','events':[self.pin('late',title='이동 중 들어온 기록')]})
                self.assertEqual(late['folder'],moved['folder'])
                self.assertEqual(Path(original['folder']).exists(),merge)
                clock.return_value=700
                fresh=records.process({**source,'action':'append','events':[self.pin('fresh',title='원본 도면 새 기록')]})
                self.assertEqual(fresh['folder'],original['folder']);self.assertTrue(Path(original['folder']).exists())
                old_ids=[event['id'] for event in records.process({**source,'action':'read'})['events']]
                new_ids=[event['id'] for event in records.process({**dest,'action':'read'})['events']]
                self.assertIn('fresh',old_ids);self.assertNotIn('late',old_ids)
                self.assertIn('late',new_ids);self.assertNotIn('fresh',new_ids)

    def test_move_redirects_photo_link_report_and_chained_moves(self):
        self.append(self.pin())
        with patch.object(records.time,'monotonic',return_value=100):
            first=self.call('move',fromName='현장 도면',toName='중간')
            second=self.call('move',fromName='중간',toName='목적')
            self.assertTrue(first['moved']);self.assertTrue(second['moved'])
            results=[self.photo(),self.call('link',link={'id':'l1'}),self.call('report',data=base64.b64encode(PDF).decode())]
            for result in results:
                self.assertEqual(result['folder'],second['folder'])
                self.assertTrue((Path(result['folder'])/result['file']).is_file())
        self.assertFalse(Path(records.folder_for(self.base)['folder']).exists())

    def test_move_redirect_is_installed_before_post_move_write_failure(self):
        self.append(self.pin())
        with patch.object(records,'_append_events',side_effect=OSError('장부 잠김')):
            result=self.call('move',fromName='현장 도면',toName='목적')
        self.assertTrue(result['spooled'])
        late=self.append(self.pin('late',title='이동 뒤 도착'))
        self.assertEqual(late['folder'],result['folder']);self.assertEqual(late['spoolPending'],0)
        self.assertFalse(Path(records.folder_for(self.base)['folder']).exists())

    def test_reply_delivered_updates_only_referenced_reply_and_keeps_csv(self):
        self.append(self.pin(),self.pin('other-pin',link='other'))
        self.append({'id':'r1','kind':'reply.sent','pin':'p1','link':'link1','text':'첫 답'},
                    {'id':'r2','kind':'reply.sent','pin':'p1','link':'link1','text':'마지막 답','delivered':False},
                    {'id':'r3','kind':'reply.sent','pin':'p1','link':'other','text':'다른 링크','delivered':True})
        rows=self.call('read');before=(Path(rows['folder'])/'현장기록_목록.csv').read_bytes()
        self.assertEqual([reply['delivered'] for reply in rows['pins'][0]['replies']],[False,False])
        self.append({'id':'wrong-link','kind':'reply.delivered','pin':'p1','link':'other','ref':'r2','delivered':True},
                    {'id':'unknown-ref','kind':'reply.delivered','pin':'p1','link':'link1','ref':'missing','delivered':True},
                    {'id':'delivered','kind':'reply.delivered','pin':'p1','link':'link1','ref':'r1','delivered':True})
        rows=self.call('read');first=next(pin for pin in rows['pins'] if pin['link']=='link1')
        self.assertEqual([reply['delivered'] for reply in first['replies']],[True,False])
        self.assertTrue(next(pin for pin in rows['pins'] if pin['link']=='other')['replies'][0]['delivered'])
        self.assertEqual((Path(rows['folder'])/'현장기록_목록.csv').read_bytes(),before)

    def test_append_accepts_exactly_five_hundred_events(self):
        result=self.call('append',events=[{'id':str(index),'kind':'link.created'} for index in range(500)])
        self.assertEqual(result['added'],500);self.assertEqual(result['spoolPending'],0)
        with self.assertRaises(ValueError):self.call('append',events=[self.pin()]*501)

    def test_server_spool_worker_retries_every_sixty_seconds(self):
        import server
        with patch.object(records,'drain_spool',side_effect=[OSError('대기 폴더 잠김'),({},'')]) as drain:
            with patch.object(server.time,'sleep',side_effect=[None,RuntimeError('시험 종료')]) as sleep:
                with self.assertRaisesRegex(RuntimeError,'시험 종료'):server.drain_field_records_spool()
        self.assertEqual(drain.call_count,2);self.assertEqual([call.args for call in sleep.call_args_list],[(60,),(60,)])

    def test_invalid_requests_and_append_limit_still_rejected_during_outage(self):
        with patch.object(records,'_process',side_effect=OSError('NAS 끊김')):
            self.append(self.pin())
            invalid=[{'action':'append','events':[self.pin()]*501},
                     {'action':'append','events':[{'id':'bad','kind':'bad'}]},
                     {'action':'photo','id':'p','pinId':'p1','data':'invalid'},
                     {'action':'link','link':{'id':''}},
                     {'action':'report','data':'invalid'}]
            for data in invalid:
                with self.subTest(action=data['action']),self.assertRaises(ValueError):records.process({**self.base,**data})
            self.assertEqual(len(records._spool_files()),1)
        self.assertEqual(self.call('read')['spoolPending'],0)
        with self.assertRaises(ValueError):
            self.call('append',drawingPath=str(self.root/'없는 폴더'/'a.dwg'),events=[self.pin()]*501)
        self.assertEqual(records._spool_files(),[])

    def test_spool_repairs_csv_after_append_or_photo_was_already_saved(self):
        for action in ('append','photo'):
            with self.subTest(action=action),patch.dict(os.environ,{'BARUN_FIELD_RECORDS_SPOOL':str(self.root/('대기-'+action))}):
                self.base={'drawingName':action}
                if action=='photo':self.append(self.pin())
                with patch.object(records,'_write_csv',side_effect=OSError('CSV 잠김')):
                    result=self.append(self.pin()) if action=='append' else self.photo()
                self.assertTrue(result['spooled']);self.assertEqual(result['spoolPending'],1)
                restored=self.call('read');self.assertEqual(restored['spoolPending'],0)
                self.assertEqual([event['id'] for event in restored['events']],['e1'] if action=='append' else ['e1','photo1'])
                csv_path=Path(restored['folder'])/'현장기록_목록.csv'
                rows=list(csv.reader(io.StringIO(csv_path.read_bytes().decode('utf-8-sig'))))
                self.assertEqual(rows[1][9],'0' if action=='append' else '1')

    def test_report_spool_reuses_saved_report_and_recovers_after_module_reload(self):
        with patch.object(records,'_write_csv',side_effect=OSError('CSV 잠김')):
            result=self.call('report',name='재시도',data=base64.b64encode(PDF).decode())
        self.assertTrue(result['spooled']);folder=Path(result['folder'])
        self.assertEqual(len(list((folder/'펀치리스트').glob('*.pdf'))),1)
        # 메모리 캐시가 없는 새 엔진에서도 파일 이름의 요청 id로 중복 없이 복구한다.
        import importlib.util
        spec=importlib.util.spec_from_file_location('field_records_fresh',records.__file__)
        fresh=importlib.util.module_from_spec(spec);spec.loader.exec_module(fresh)
        restored=fresh.process({**self.base,'action':'read'})
        self.assertEqual(restored['spoolPending'],0)
        self.assertEqual([event['kind'] for event in restored['events']],['report.made'])
        self.assertEqual(len(list((folder/'펀치리스트').glob('*.pdf'))),1)
        self.assertTrue((folder/'현장기록_목록.csv').is_file())
        second=self.call('report',name='재시도',data=base64.b64encode(PDF).decode())
        self.assertTrue(second['file'].endswith('_2.pdf'))

    def test_move_spool_repairs_csv_after_folder_was_already_renamed(self):
        self.append(self.pin())
        with patch.object(records,'_write_csv',side_effect=OSError('CSV 잠김')):
            result=self.call('move',fromName='현장 도면',toName='목적')
        self.assertTrue(result['spooled']);folder=Path(result['folder'])
        (folder/'현장기록_목록.csv').unlink()
        self.call('read');self.assertEqual(records._spool_files(),[])
        self.assertTrue((folder/'현장기록_목록.csv').is_file())
        self.assertFalse(Path(records.folder_for(self.base)['folder']).exists())

    def test_http_write_outages_are_200_and_all_actions_drain_in_order(self):
        import server
        class QuietHandler(server.Handler):
            def log_message(self,*args):pass
        httpd=server.LocalServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(server.ROOT)))
        thread=threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
        try:
            origin=f'http://127.0.0.1:{httpd.server_port}'
            headers={'Content-Type':'application/json','X-CAD-Token':server.TOKEN,'Origin':origin}
            payloads=[{'action':'append','events':[self.pin()]},
                      {'action':'photo','id':'photo1','pinId':'p1','link':'link1','data':base64.b64encode(JPEG).decode()},
                      {'action':'link','link':{'id':'l1'}},
                      {'action':'report','data':base64.b64encode(PDF).decode()},
                      {'action':'move','fromName':'현장 도면','toName':'목적'}]
            with patch.object(records,'_process',side_effect=OSError('NAS 끊김')):
                for index,data in enumerate(payloads,1):
                    with self.subTest(action=data['action']):
                        body=json.dumps({**self.base,**data}).encode()
                        with urlopen(Request(origin+'/api/field-records',body,headers),timeout=5) as response:
                            result=json.loads(response.read());self.assertEqual(response.status,200)
                            self.assertTrue(result['spooled']);self.assertEqual(result['spoolPending'],index)
            body=json.dumps({'action':'read','drawingName':'목적'}).encode()
            with urlopen(Request(origin+'/api/field-records',body,headers),timeout=5) as response:restored=json.loads(response.read())
            self.assertEqual(restored['spoolPending'],0)
            self.assertEqual([event['kind'] for event in restored['events']],['pin.received','photo.saved','report.made','folder.moved'])
            self.assertEqual(len(restored['pins'][0]['photos']),1)
        finally:httpd.shutdown();httpd.server_close();thread.join(timeout=3)

    def test_moved_request_keeps_accepted_destination_when_spool_outlasts_ttl(self):
        self.append(self.pin())
        with patch.object(records.time,'monotonic',return_value=100) as clock:
            moved=self.call('move',fromName='현장 도면',toName='목적')
            with patch.object(records,'_append_events',side_effect=OSError('NAS 끊김')):
                accepted=self.append(self.pin('late',title='유예 중 접수'))
            self.assertTrue(accepted['spooled']);self.assertEqual(accepted['folder'],moved['folder'])
            original=json.loads(records._spool_files()[0].read_bytes())
            self.assertEqual(original,{**self.base,'action':'append','events':[self.pin('late',title='유예 중 접수')]})
            clock.return_value=701
            restored=self.call('read',drawingName='목적')
            self.assertEqual(restored['spoolPending'],0);self.assertIn('late',[event['id'] for event in restored['events']])
            fresh=self.append(self.pin('fresh',title='유예 뒤 새 요청'))
            self.assertEqual(fresh['folder'],records.folder_for(self.base)['folder'])
            self.assertNotEqual(fresh['folder'],moved['folder']);self.assertEqual(records._QUEUED_FOLDERS,{})

    def test_queued_destination_follows_later_move_even_after_its_ttl_expires(self):
        self.append(self.pin())
        with patch.object(records.time,'monotonic',return_value=100) as clock:
            middle=self.call('move',fromName='현장 도면',toName='중간')
            with patch.object(records,'_process',side_effect=OSError('NAS 끊김')):
                self.call('move',fromName='중간',toName='목적')
                self.assertTrue(self.append(self.pin('late',title='두 번째 이동 중 접수'))['spooled'])
            with patch.object(records,'_append',side_effect=OSError('장부 잠김')):
                self.call('read',drawingName='목적')
            self.assertEqual(len(records._spool_files()),1)
            self.assertFalse(Path(middle['folder']).exists())
            clock.return_value=701
            restored=self.call('read',drawingName='목적')
            self.assertEqual(restored['spoolPending'],0)
            self.assertIn('late',[event['id'] for event in restored['events']])
            self.assertFalse(Path(middle['folder']).exists())

    def test_http_storage_errors_are_503_and_input_errors_are_400(self):
        import server
        class QuietHandler(server.Handler):
            def log_message(self,*args):pass
        httpd=server.LocalServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(server.ROOT)))
        thread=threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
        try:
            origin=f'http://127.0.0.1:{httpd.server_port}';body=json.dumps({**self.base,'action':'read'}).encode()
            headers={'Content-Type':'application/json','X-CAD-Token':server.TOKEN,'Origin':origin}
            errors=[OSError('디스크 가득'),PermissionError('사용 중'),FileNotFoundError('NAS 끊김'),ConnectionError('연결 끊김'),ValueError('잘못된 입력')]
            for failure in errors:
                with self.subTest(error=type(failure).__name__),patch.object(records,'process',side_effect=failure):
                    with self.assertRaises(HTTPError) as error:urlopen(Request(origin+'/api/field-records',body,headers),timeout=5)
                    self.assertEqual(error.exception.code,503 if isinstance(failure,OSError) else 400)
                    message=json.loads(error.exception.read())['error'];error.exception.close()
                    self.assertEqual(message,('현장 기록 폴더에 쓰지 못했습니다: ' if isinstance(failure,OSError) else '')+str(failure))
            missing={**self.base,'action':'folder','drawingPath':str(self.root/'끊긴 폴더'/'없는.dwg')}
            with self.assertRaises(HTTPError) as error:
                urlopen(Request(origin+'/api/field-records',json.dumps(missing).encode(),headers),timeout=5)
            self.assertEqual(error.exception.code,503)
            self.assertIn('도면 폴더에 닿을 수 없습니다',json.loads(error.exception.read())['error']);error.exception.close()
            with patch('exchange.import_file',side_effect=OSError('다른 경로 오류')),patch.object(server.sys,'stderr',io.StringIO()):
                other=json.dumps({'data':base64.b64encode(b'dxf').decode(),'extension':'.dxf'}).encode()
                with self.assertRaises(HTTPError) as error:urlopen(Request(origin+'/api/import',other,headers),timeout=5)
                self.assertEqual(error.exception.code,400);error.exception.close()
        finally:httpd.shutdown();httpd.server_close();thread.join(timeout=3)

    def test_http_route_and_authentication(self):
        import server
        class QuietHandler(server.Handler):
            def log_message(self,*args):pass
        httpd=server.LocalServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(server.ROOT)))
        thread=threading.Thread(target=httpd.serve_forever,daemon=True);thread.start()
        try:
            origin=f'http://127.0.0.1:{httpd.server_port}';body=json.dumps({**self.base,'action':'read'}).encode()
            headers={'Content-Type':'application/json','X-CAD-Token':server.TOKEN,'Origin':origin}
            with urlopen(Request(origin+'/api/field-records',body,headers),timeout=5) as response:
                self.assertEqual(json.loads(response.read())['pins'],[])
            headers.pop('X-CAD-Token')
            with self.assertRaises(HTTPError) as error:urlopen(Request(origin+'/api/field-records',body,headers),timeout=5)
            self.assertEqual(error.exception.code,403)
        finally:httpd.shutdown();httpd.server_close();thread.join(timeout=3)


if __name__=='__main__':unittest.main()
