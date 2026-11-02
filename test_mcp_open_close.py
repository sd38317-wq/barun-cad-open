"""MCP cad_open_file / cad_close_document: 자동 검사가 도면 창을 쌓지 않게 열고 닫는다(2026-10-13)."""
import os,tempfile,threading,time,unittest,uuid
from pathlib import Path
from unittest.mock import patch
import bridge

def pulse(client,**data):return bridge.pulse({'client':client,'active':True,**data})

@patch('miri_account_service.require_ai_login', new=lambda: None)
class OpenCloseTest(unittest.TestCase):
    def setUp(self):
        self.clear()
        self.addCleanup(self.clear)
        recovery=patch.object(bridge,'schedule_recovery');recovery.start();self.addCleanup(recovery.stop)  # 실제 복구 폴더에 쓰지 않는다
        folder=tempfile.TemporaryDirectory();self.addCleanup(folder.cleanup)
        self.path=os.path.join(folder.name,'상세 A.dxf');Path(self.path).write_text('0\nEOF\n',encoding='ascii')
        self.editor=str(uuid.uuid4());pulse(self.editor,document={'entities':[]},drawingPath='',drawingName='새 도면 1')

    def clear(self):
        with bridge.lock:
            for table in (bridge.clients,bridge.queue,bridge.results,bridge.pending_requests,bridge.closing_sessions):table.clear()
            bridge.active=None

    def call_async(self,name,args):
        box={}
        def run():
            try:box['result']=bridge.call(name,args)
            except Exception as error:box['error']=error
        thread=threading.Thread(target=run);thread.start();return thread,box

    def answer(self,client,reply):
        """편집 창 흉내: 요청을 받아 reply(request) 로 답을 다음 신호에 싣는다."""
        for _ in range(200):
            requests=pulse(client)['requests']
            if requests:break
            time.sleep(.01)
        else:self.fail('no request reached the editor')
        request=requests[0];self.assertIsNone(request['args']['target'])
        pulse(client,results=[{'id':request['id'],'target':None,**reply(request)}])
        return request

    def test_rejects_bad_paths_without_asking_the_editor(self):
        for path in ('상대.dxf',self.path[:-4]+'.txt',self.path[:-4]+'없음.dxf'):
            with self.assertRaises(ValueError):bridge.call('cad_open_file',{'path':path})
        with self.assertRaises(ValueError):bridge.call('cad_open_file',{'path':self.path,'timeout_seconds':1})
        self.assertFalse(bridge.queue.get(self.editor))

    def test_already_open_file_returns_its_window(self):
        other=str(uuid.uuid4());pulse(other,document={'entities':[]},drawingPath=self.path.upper().replace('\\','/'),drawingName='상세 A')
        result=bridge.call('cad_open_file',{'path':self.path})
        self.assertEqual((result['editor_session'],result['already_open']),(other,True))
        self.assertFalse(bridge.queue.get(self.editor))

    def test_open_waits_for_the_new_window(self):
        thread,box=self.call_async('cad_open_file',{'path':self.path,'timeout_seconds':10})
        request=self.answer(self.editor,lambda r:{'result':{'requested':True}})
        self.assertEqual((request['action'],request['args']['path']),('cad_open_file',self.path))
        time.sleep(.05);self.assertTrue(thread.is_alive(),'returns only once the drawing window is attached')
        opened=str(uuid.uuid4())
        pulse(opened,drawingPath=self.path,drawingName='상세 A')  # 본문이 오기 전에는 아직 열림이 아니다
        time.sleep(.05);self.assertTrue(thread.is_alive())
        pulse(opened,document={'entities':[]},drawingPath=self.path,drawingName='상세 A')
        thread.join(5);self.assertNotIn('error',box)
        self.assertEqual(box['result']['editor_session'],opened);self.assertFalse(box['result']['already_open'])

    def nas(self,stored):
        """NAS 흉내: 폴더 목록에는 stored 꼴 이름만 있다(SMB 가 다른 꼴을 가끔 '있다'고 하는 것은 흉내 낼 필요 없다 — 목록만 본다)."""
        children={}
        for parent,child in zip(Path(stored).parents,reversed(Path(stored).parts[1:])):children.setdefault(str(parent),[]).append(child)
        return patch.object(bridge.os,'listdir',lambda folder:children.get(str(folder),[]))

    def test_opens_nas_file_whose_korean_name_is_decomposed(self):
        import unicodedata
        stored=unicodedata.normalize('NFD',self.path)
        with self.nas(stored),patch.object(bridge.os.path,'isfile',lambda p:p==stored):
            thread,box=self.call_async('cad_open_file',{'path':unicodedata.normalize('NFC',self.path),'timeout_seconds':10})
            request=self.answer(self.editor,lambda r:{'result':{'requested':True}})
        self.assertEqual(request['args']['path'],stored)
        pulse(str(uuid.uuid4()),document={'entities':[]},drawingPath=stored,drawingName='상세 A')
        thread.join(5);self.assertNotIn('error',box)

    def test_on_disk_path_uses_the_name_written_in_the_folder(self):
        import unicodedata
        nfc,nfd=(unicodedata.normalize(f,self.path) for f in ('NFC','NFD'))
        for stored,given in ((nfd,nfc),(nfc,nfd)):   # 엔진 도면 읽기(/api/import-path)·PDF 저장 폴더도 이것으로 찾는다
            with self.nas(stored):self.assertEqual(bridge.on_disk_path(given),stored)
        with self.nas(nfd):self.assertEqual(bridge.on_disk_path(os.path.dirname(nfc)),os.path.dirname(nfd))
        with patch.object(bridge.os,'listdir',lambda folder:[]):self.assertEqual(bridge.on_disk_path(nfc),nfc)

    def test_vector_pdf_opens_as_a_temporary_dxf_without_touching_its_folder(self):
        folder=os.path.dirname(self.path);pdf=os.path.join(folder,'평면.pdf')
        stream=b'0 0 m 283.46 0 l S BT /F1 12 Tf 10 20 Td (3600) Tj ET'
        objects=[b'<</Type/Catalog/Pages 2 0 R>>',b'<</Type/Pages/Kids[3 0 R]/Count 1>>',
                 b'<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
                 b'<</Length %d>>stream\n'%len(stream)+stream+b'\nendstream',b'<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>']
        body=b'%PDF-1.4\n';offsets=[]
        for number,obj in enumerate(objects,1):offsets.append(len(body));body+=b'%d 0 obj\n'%number+obj+b'\nendobj\n'
        xref=len(body);body+=b'xref\n0 %d\n0000000000 65535 f \n'%(len(objects)+1)+b''.join(b'%010d 00000 n \n'%o for o in offsets)
        Path(pdf).write_bytes(body+b'trailer<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF\n'%(len(objects)+1,xref))
        before=sorted(os.listdir(folder))
        with tempfile.TemporaryDirectory() as cache,patch.object(bridge,'PDF_OPEN_ROOT',cache):
            thread,box=self.call_async('cad_open_file',{'path':pdf,'timeout_seconds':10})
            request=self.answer(self.editor,lambda r:{'result':{'requested':True}})
            opened=request['args']['path'];self.assertTrue(opened.startswith(cache) and opened.endswith('평면.dxf'))
            import ezdxf;doc=ezdxf.readfile(opened)
            self.assertEqual(len(doc.modelspace().query('LINE')),1);self.assertIn('3600',[e.dxf.text for e in doc.modelspace().query('TEXT')])
            pulse(str(uuid.uuid4()),document={'entities':[]},drawingPath=opened,drawingName='평면')
            thread.join(5);self.assertNotIn('error',box)
        self.assertEqual(sorted(os.listdir(folder)),before,'PDF 옆에 아무것도 쓰지 않는다')

    def test_close_refuses_unsaved_changes_and_keeps_the_window(self):
        thread,box=self.call_async('cad_close_document',{'editor_session':self.editor})
        self.answer(self.editor,lambda r:{'error':'저장되지 않은 변경이 있어 닫지 않았습니다.'})
        thread.join(5);self.assertRegex(str(box['error']),'저장되지 않은')
        self.assertIn(self.editor,bridge.clients)

    def test_closing_the_last_drawing_forgets_the_window(self):
        thread,box=self.call_async('cad_close_document',{'editor_session':self.editor})
        self.answer(self.editor,lambda r:{'result':{'closed':True,'session_closed':True,'drawingPath':self.path,'drawingName':'상세 A'}})
        thread.join(5);self.assertTrue(box['result']['session_closed'])
        self.assertNotIn(self.editor,bridge.clients);self.assertIsNone(bridge.active)
        # 창이 실제로 닫히기 전의 마지막 신호가 그 창을 되살리지 않는다 → 같은 파일을 다시 열면 새 창을 연다.
        with self.assertRaises(ValueError):pulse(self.editor,document={'entities':[]},drawingPath=self.path)
        with self.assertRaisesRegex(ValueError,'편집 창'):bridge.call('cad_get_document',{'editor_session':self.editor})
        with bridge.lock:bridge.closing_sessions[self.editor]-=bridge.CLOSING_SECONDS
        pulse(self.editor,document={'entities':[]})  # 닫기가 취소된 창은 다시 붙는다
        self.assertIn(self.editor,bridge.clients)

    def test_close_needs_an_explicit_live_session(self):
        for args in ({},{'editor_session':'active'},{'editor_session':str(uuid.uuid4())}):
            with self.assertRaises(ValueError):bridge.call('cad_close_document',args)
        tools={t['name']:t for t in bridge.TOOLS}
        self.assertEqual(tools['cad_close_document']['inputSchema']['required'],['editor_session'])
        self.assertEqual(tools['cad_open_file']['inputSchema']['required'],['path'])

if __name__=='__main__':
    unittest.main()


class UserFolderTest(unittest.TestCase):
    """미리가 사용자 말("문서/캐드참고자료/…")과 폴더로도 도면을 찾는다(2026-10-30 괴정 시험)."""
    def test_user_words_become_home_folders(self):
        home=os.path.expanduser('~')
        self.assertEqual(bridge.user_path('문서/캐드참고자료/a.pdf'),os.path.join(home,'Documents','캐드참고자료/a.pdf'))
        self.assertEqual(bridge.user_path('바탕화면/x.dwg'),os.path.join(home,'Desktop','x.dwg'))
        self.assertEqual(bridge.user_path('/abs/문서/x.dxf'),'/abs/문서/x.dxf')

    def test_folder_returns_drawing_files_without_opening(self):
        with tempfile.TemporaryDirectory() as folder:
            for name in ('A1 평면.pdf','b.dwg','note.txt','.hidden.pdf'):Path(folder,name).write_bytes(b'x')
            with patch.object(bridge,'_send_locked') as send:
                out=bridge.open_file({'path':folder})
            send.assert_not_called()
            self.assertEqual([Path(f).name for f in out['files']],['A1 평면.pdf','b.dwg'])
            self.assertIn('cad_open_file',out['next'])
