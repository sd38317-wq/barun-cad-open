"""미리 그림 보기(2026-10-30): 그림을 돌려준 도구 호출은 화면 이벤트에 그림 참조({id,caption})만 싣고, 그림은 파일로 남아 번호로 다시 읽힌다."""
import base64,os,tempfile,threading,unittest
from pathlib import Path
from unittest.mock import Mock,patch
import chat_images,chat_router,codex_chat,claude_chat,miri_chat

PNG=base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode()

class ChatImagesTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();patcher=patch.object(chat_images,'FOLDER',Path(self.folder.name)/'chat-images')
        patcher.start();self.addCleanup(patcher.stop);self.addCleanup(self.folder.cleanup);chat_images._jobs.clear()

    def codex(self):
        with patch.object(codex_chat,'DATA',Path(self.folder.name)):c=codex_chat.Client()
        c.active_threads.add('t');c.allow['t']=False;c.event=Mock();return c

    def test_codex_image_tool_emits_reference_event_and_file_is_readable(self):
        c=self.codex()
        with patch.object(codex_chat.bridge,'call_app',return_value={'view':'iso-ne','boundsMm':{},'image':{'mimeType':'image/png','data':PNG}}),patch.object(c,'send') as send:
            c.server_request({'id':'1','method':'item/tool/call','params':{'tool':'cad_view_3d','arguments':{},'threadId':'t'}})
        items=send.call_args.args[0]['result']['contentItems']
        self.assertEqual(items[1],{'type':'inputImage','imageUrl':'data:image/png;base64,'+PNG})   # 미리에게는 예전처럼 그림째
        method,params=c.event.call_args.args
        self.assertEqual(method,'cad/tool');self.assertNotIn('image',params['result'])
        ref=params['image'];self.assertEqual(ref['caption'],'건물 전체');self.assertNotIn('data',ref)
        self.assertEqual(chat_router.process({'action':'image','id':ref['id']}),{'id':ref['id'],'mimeType':'image/png','data':PNG})

    def test_job_result_keeps_original_tool_caption(self):
        c=self.codex()
        running={'status':'running','job_id':'job-1'}
        done={'status':'completed','job_id':'job-1','result':{'eye':{},'floorLevelMm':9000,'image':{'mimeType':'image/png','data':PNG}}}
        with patch.object(codex_chat.bridge,'call_app',side_effect=[running,done]),patch.object(c,'send'):
            c.server_request({'id':'1','method':'item/tool/call','params':{'tool':'cad_view_interior','arguments':{'floor':'4F','x':1,'y':2},'threadId':'t'}})
            self.assertNotIn('image',c.event.call_args.args[1])
            c.server_request({'id':'2','method':'item/tool/call','params':{'tool':'cad_get_job','arguments':{'job_id':'job-1'},'threadId':'t'}})
        self.assertEqual(c.event.call_args.args[1]['image']['caption'],'4F 실내')

    def test_tool_without_image_or_bad_image_has_no_reference(self):
        self.assertIsNone(chat_images.from_tool('cad_get_document',{},{'ok':True})[2])
        shown,image,ref=chat_images.from_tool('cad_view_3d',{},{'image':{'mimeType':'image/png','data':'not base64!'}})
        self.assertIsNone(ref);self.assertIsNotNone(image);self.assertNotIn('image',shown)

    def test_missing_file_and_bad_id(self):
        self.assertEqual(chat_images.read('0'*32),{'id':'0'*32,'missing':True})
        with self.assertRaises(ValueError):chat_images.read('../x')

    def test_old_images_are_pruned(self):
        with patch.object(chat_images,'KEEP',2):
            ids=[chat_images.store({'mimeType':'image/png','data':PNG},'그림')['id'] for _ in range(3)]
        self.assertTrue(chat_images.read(ids[0]).get('missing') or chat_images.read(ids[1]).get('missing'))
        self.assertEqual(len(list(chat_images.FOLDER.glob('*.png'))),2)

    def test_claude_and_miri_events_carry_reference_not_base64(self):
        out={'status':'completed','job_id':'j','result':{'dayLabel':'동지','time':'12:00','image':{'mimeType':'image/png','data':PNG}}}
        for module,call in ((claude_chat,lambda st,ev:claude_chat._invoke('cad_sun_study',{},st,'review','t',ev)),
                            (miri_chat,lambda st,ev:miri_chat._invoke('c1','cad_sun_study',{},st,'review','t',ev))):
            state={'epoch':1,'origin':'o','login_epoch':None,'cancelled':threading.Event()};events=[]
            with patch.object(module.bridge,'call_app',return_value=out),patch('miri_account_service.validate_ai_epoch',new=lambda epoch:None):call(state,events)
            params=events[-1]['params']
            self.assertEqual(params['image']['caption'],'일조 동지 12:00',module.__name__)
            self.assertNotIn(PNG,str(params['result']),module.__name__)

    def test_safe_save_path_accepts_picture_formats(self):
        import server
        folder=Path(self.folder.name)
        self.assertEqual(server.validate_save_path(str(folder/'상가_건물 전체.png'),'png').suffix,'.png')
        self.assertEqual(server.validate_save_path(str(folder/'사진.jpg'),'jpg').suffix,'.jpg')
        with self.assertRaises(ValueError):server.validate_save_path(str(folder/'a.png'),'jpg')

if __name__=='__main__':unittest.main()
