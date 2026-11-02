"""AI jobs, restart recovery and constant-size window discovery regressions."""
import copy,os,tempfile,threading,time,unittest,uuid,json
from pathlib import Path
from unittest.mock import patch
import bridge,server

@patch('miri_account_service.require_ai_login',new=lambda:None)
class BridgeJobsTest(unittest.TestCase):
    def setUp(self):
        with bridge.lock:
            bridge.clients.clear();bridge.queue.clear();bridge.results.clear();bridge.pending_requests.clear();bridge.closing_sessions.clear();bridge.active=None
        with bridge._jobs_lock:bridge._jobs.clear()
        self.enterContext(patch.object(bridge,'schedule_recovery'))
        self.enterContext(patch.object(bridge,'recovery_has_content',return_value=False))
        self.enterContext(patch.object(bridge,'recovery_error',return_value=None))
        self.client=str(uuid.uuid4());self.generation=str(uuid.uuid4())
        self.body={'client':self.client,'editor_session':self.client,'protocol_version':1,'document_generation':self.generation,
                   'revision':0,'document_revision':0,'document':{'entities':[],'layers':[]},'active':True,'drawingName':'original','drawingPath':'C:/original.dxf'}
        self.target=bridge.pulse(self.body)['target']

    def test_restart_reuses_pulse_and_requires_body_then_returns_new_target(self):
        self.enterContext(patch.object(bridge,'BACKEND_GENERATION',str(uuid.uuid4())))
        with bridge.lock:bridge.clients.clear();bridge.active=None
        head={k:v for k,v in self.body.items() if k not in ('document','document_revision')}
        first=bridge.pulse(head)
        self.assertTrue(first['needDocument'])
        with self.assertRaises(bridge.CADToolError) as error:bridge.snapshot(self.client)
        self.assertEqual(error.exception.code,'reconnecting')
        response=bridge.pulse(self.body)
        self.assertNotEqual(response['target']['backend_generation'],self.target['backend_generation'])
        self.assertEqual(response['target']['editor_session'],self.client)
        with self.assertRaises(ValueError):bridge.dispatch('cad_redo',{'target':self.target})
        self.assertTrue(bridge.observation_head(self.client)['available'])

    def test_background_pulse_cannot_steal_last_active_window(self):
        hidden=copy.deepcopy(self.body);hidden['client']=hidden['editor_session']=str(uuid.uuid4());hidden['active']=False;hidden['drawingName']='empty'
        bridge.pulse(hidden)
        self.assertEqual(bridge.active,self.client)
        bridge.pulse({**hidden,'active':True})
        bridge.pulse({**self.body,'active':False})
        out=bridge.call('cad_get_document',{})
        self.assertEqual(out['target']['editor_session'],hidden['client'])
        self.assertEqual(out['destination']['drawingName'],'empty')
        self.assertEqual(len(out['windows']),2)
        self.assertIn('editor_session',out['selection_help'])

    def test_long_edit_returns_one_job_and_completes_on_original_window(self):
        done=[]
        with patch.object(bridge,'JOB_RESPONSE_SECONDS',.01):
            out=bridge.call('cad_redo',{'target':self.target})
        self.assertEqual(out['status'],'running')
        self.assertTrue(out['job_id'].startswith(bridge.BACKEND_GENERATION+':'))
        queued=bridge.pulse(self.body)['requests']
        self.assertEqual(len(queued),1);request=queued[0]
        self.assertGreater(request['expires_at']-time.time()*1000,300_000)
        result={'target':self.target,'before_revision':0,'after_revision':1,'revision':1,'applied':True,'redone':True}
        next_body={**self.body,'revision':1,'document_revision':1,'results':[{'id':request['id'],'target':self.target,'result':result}]}
        bridge.pulse(next_body)
        completed=bridge.call('cad_get_job',{'job_id':out['job_id'],'wait_seconds':1})
        self.assertEqual(completed['status'],'completed');self.assertTrue(completed['result']['redone'])
        self.assertEqual(completed['destination']['editor_session'],self.client)
        self.assertEqual(bridge.pulse(next_body)['requests'],[])
        self.assertFalse(bridge.pending_requests)
        self.assertEqual(bridge.call('cad_get_job',{'job_id':out['job_id']})['result'],completed['result'])

    def test_cancelled_job_drops_request_and_cannot_be_read_by_other_app(self):
        cancelled=threading.Event()
        with patch.object(bridge,'JOB_RESPONSE_SECONDS',.01):
            out=bridge.call_app('cad_undo',{'target':self.target},True,request_epoch=7,request_origin=self.client,cancelled=cancelled.is_set)
        cancelled.set()
        with self.assertRaisesRegex(ValueError,'중지'):bridge.call_app('cad_get_job',{'job_id':out['job_id'],'wait_seconds':1},False,request_origin=self.client)
        with self.assertRaisesRegex(ValueError,'다른 앱'):bridge.call_app('cad_get_job',{'job_id':out['job_id']},False,request_origin=str(uuid.uuid4()))
        self.assertFalse(bridge.pending_requests)

    def test_connection_file_publishes_windows_and_avoids_repeated_writes(self):
        with tempfile.TemporaryDirectory() as folder,patch.object(server,'CONNECTION_FILE',None),patch.object(server,'_connection_signature',None),patch.object(server,'_connection_updated',0),patch.dict(os.environ,{'LOCALAPPDATA':folder}):
            path=server.write_connection_file(12345,'http://127.0.0.1:12345','test-only')
            server.refresh_connection_file();before=path.stat().st_mtime_ns
            data=json.loads(path.read_text(encoding='utf8'))
            self.assertEqual(data['backend_generation'],bridge.BACKEND_GENERATION)
            self.assertEqual(data['windows'][0]['editor_session'],self.client)
            self.assertEqual(data['windows'][0]['drawingName'],'original')
            server.refresh_connection_file();self.assertEqual(path.stat().st_mtime_ns,before)
            bridge.pulse({**self.body,'drawingName':'renamed'})
            server.refresh_connection_file();self.assertEqual(json.loads(path.read_text(encoding='utf8'))['windows'][0]['drawingName'],'renamed')

    @unittest.skipUnless(os.name=='nt','윈도우 파일 잠금')
    def test_connection_file_write_waits_for_a_reader_holding_it(self):
        # MCP 다리가 연결 파일을 열고 있는 순간 바꿔 쓰기가 거부돼 엔진이 켜지다 죽었다 — 잠깐 기다려 다시 쓴다.
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'connection-1.json';path.write_text('{}',encoding='utf8')
            reader=open(path,'rb');threading.Timer(0.3,reader.close).start()
            server._write_connection(path,'{"ok":1}')
            self.assertEqual(path.read_text(encoding='utf8'),'{"ok":1}')

    @unittest.skipUnless(os.name=='nt','Windows 스토어 앱 전용')
    def test_connection_file_is_mirrored_outside_appdata_and_removed_on_exit(self):
        # 스토어 앱(Codex)이 돌리지 않는 ~/.barun-cad 에도 같은 연결 파일을 쓰고, 끝날 때 둘 다 지운다.
        with tempfile.TemporaryDirectory() as home,patch.object(server,'CONNECTION_FILE',None),patch.object(server,'_connection_signature',None),patch.object(server,'_connection_updated',0),patch('mcp_server.Path.home',return_value=Path(home)),patch.dict(os.environ,{'LOCALAPPDATA':str(Path(home)/'AppData'/'Local')}):
            path=server.write_connection_file(12346,'http://127.0.0.1:12346','test-only')
            mirror=Path(home)/'.barun-cad'/path.name
            self.assertEqual(json.loads(mirror.read_text(encoding='utf8'))['token'],'test-only')
            bridge.pulse({**self.body,'drawingName':'renamed'});server.refresh_connection_file()
            self.assertEqual(json.loads(mirror.read_text(encoding='utf8'))['windows'][0]['drawingName'],'renamed')
            server.remove_connection_file()
            self.assertFalse(path.exists());self.assertFalse(mirror.exists())

    def test_redo_is_common_mutating_tool_with_required_target(self):
        for tools in (bridge.mcp_tools(),bridge.app_tools(True)):
            redo=next(t for t in tools if t['name']=='cad_redo')
            self.assertIn('target',redo['inputSchema']['required'])
        self.assertNotIn('cad_redo',{t['name'] for t in bridge.app_tools(False)})
        self.assertEqual(bridge.BOUND_ALIASES['cad_redo_bound'],'cad_redo')
        with self.assertRaises(ValueError):bridge.call('cad_get_job',{'job_id':str(uuid.uuid4())+':unknown'})

    def test_document_settings_are_opt_in_but_recovery_keeps_them(self):
        settings={'aliases':{'C':'CIRCLE'}}
        bridge.pulse({**self.body,'commandSettings':settings})
        self.assertNotIn('commandSettings',bridge.call('cad_get_document',{}))
        self.assertEqual(bridge.call('cad_get_document',{'include_command_settings':True})['commandSettings'],settings)
        self.assertEqual(bridge.snapshot()['commandSettings'],settings)
        self.assertEqual(bridge.schedule_recovery.call_args.args[0]['commandSettings'],settings)
        tool=next(t for t in bridge.mcp_tools() if t['name']=='cad_get_document')
        self.assertFalse(tool['inputSchema']['properties']['include_command_settings']['default'])
        with self.assertRaises(ValueError):bridge.call('cad_get_document',{'include_command_settings':'yes'})

    def _pending_redo(self):
        with patch.object(bridge,'JOB_RESPONSE_SECONDS',.01):out=bridge.call('cad_redo',{'target':self.target})
        request=bridge.pulse(self.body)['requests'][0]
        result={'target':self.target,'before_revision':0,'after_revision':1,'revision':1,'applied':True}
        return out,{'id':request['id'],'target':self.target,'result':result}

    def test_edit_waits_for_real_post_edit_snapshot_target(self):
        out,result=self._pending_redo()
        head={k:v for k,v in self.body.items() if k not in ('document','document_revision')}
        bridge.pulse({**head,'revision':1,'results':[result]})
        self.assertEqual(bridge.get_job({'job_id':out['job_id'],'wait_seconds':.02})['status'],'running')
        pulse=bridge.pulse({**self.body,'revision':1,'document_revision':1})
        done=bridge.get_job({'job_id':out['job_id'],'wait_seconds':1})['result']
        self.assertEqual(done['target'],pulse['target']);self.assertNotEqual(done['target'],self.target)
        self.assertEqual(done['target']['revision'],done['after_revision'])
        with bridge.lock:bridge._bound_state_locked(done['target'])

    def test_missing_post_edit_snapshot_explicitly_requires_reread(self):
        with patch.object(bridge,'POST_EDIT_SNAPSHOT_SECONDS',.03,create=True):
            out,result=self._pending_redo()
            head={k:v for k,v in self.body.items() if k not in ('document','document_revision')}
            bridge.pulse({**head,'revision':1,'results':[result]})
            done=bridge.get_job({'job_id':out['job_id'],'wait_seconds':1})['result']
        self.assertIsNone(done['target']);self.assertTrue(done['target_refresh_required'])
        self.assertIn('target 다시 읽기 필요',done['message']);self.assertTrue(done['applied'])

    def test_post_edit_target_does_not_bind_another_drawing(self):
        out,result=self._pending_redo()
        bridge.pulse({**self.body,'revision':1,'document_revision':1,'document_generation':str(uuid.uuid4()),'results':[result]})
        done=bridge.get_job({'job_id':out['job_id'],'wait_seconds':1})['result']
        self.assertIsNone(done['target']);self.assertTrue(done['target_refresh_required'])

    def test_next_view_uses_edit_target_without_reading_document_again(self):
        out,result=self._pending_redo()
        pulse=bridge.pulse({**self.body,'revision':1,'document_revision':1,'results':[result]})
        target=bridge.get_job({'job_id':out['job_id'],'wait_seconds':1})['result']['target']
        with patch.object(bridge,'JOB_RESPONSE_SECONDS',.01):view=bridge.call('cad_view_drawing',{'target':target})
        request=bridge.pulse({**self.body,'revision':1,'document_revision':1})['requests'][0]
        self.assertEqual(request['action'],'cad_view_drawing');self.assertEqual(request['args']['target'],pulse['target'])
        reply={'id':request['id'],'target':target,'result':{'target':target,'before_revision':1,'after_revision':1,'revision':1,'applied':False,'image':'checked'}}
        bridge.pulse({**self.body,'revision':1,'document_revision':1,'results':[reply]})
        self.assertEqual(bridge.get_job({'job_id':view['job_id'],'wait_seconds':1})['result']['image'],'checked')

    def test_edit_response_still_requires_the_original_bound_target(self):
        out,result=self._pending_redo()
        body={**self.body,'revision':1,'document_revision':1}
        target=bridge.pulse(body)['target']
        forged={**result,'result':{**result['result'],'target':target}}
        rejected=bridge.pulse({**body,'results':[forged]})
        self.assertEqual(rejected['rejected_results'],[result['id']])
        self.assertEqual(bridge.get_job({'job_id':out['job_id']})['status'],'running')
        bridge.pulse({**body,'results':[result]})
        self.assertEqual(bridge.get_job({'job_id':out['job_id'],'wait_seconds':1})['result']['target'],target)

    def test_post_edit_target_does_not_bind_a_later_user_edit(self):
        out,result=self._pending_redo()
        bridge.pulse({**self.body,'revision':2,'document_revision':2,'results':[result]})
        done=bridge.get_job({'job_id':out['job_id'],'wait_seconds':1})['result']
        self.assertIsNone(done['target']);self.assertTrue(done['target_refresh_required'])

    def test_document_query_waits_for_current_snapshot(self):
        head={k:v for k,v in self.body.items() if k not in ('document','document_revision')}
        bridge.pulse({**head,'revision':1})
        with patch.object(bridge,'JOB_RESPONSE_SECONDS',.01):out=bridge.call('cad_get_document',{'mode':'summary'})
        self.assertEqual(out['status'],'running');self.assertFalse(bridge.queue.get(self.client))
        body={**self.body,'revision':1,'document_revision':1}
        target=bridge.pulse(body)['target']
        with bridge.lock:
            self.assertTrue(bridge.lock.wait_for(lambda:bridge.queue.get(self.client),timeout=1))
            request=bridge.queue[self.client][0]
        self.assertEqual(request['args']['target'],target)
        result={'target':target,'before_revision':1,'after_revision':1,'revision':1,'applied':False,'summary':{'entityCount':0}}
        bridge.pulse({**body,'results':[{'id':request['id'],'target':target,'result':result}]})
        self.assertEqual(bridge.get_job({'job_id':out['job_id'],'wait_seconds':1})['result']['target'],target)

    def test_document_query_never_dispatches_stale_snapshot(self):
        head={k:v for k,v in self.body.items() if k not in ('document','document_revision')}
        bridge.pulse({**head,'revision':1})
        with patch.object(bridge,'POST_EDIT_SNAPSHOT_SECONDS',.02),patch.object(bridge,'_send_locked') as send:
            with self.assertRaisesRegex(ValueError,'snapshot is stale'):bridge._call('cad_get_document',{'mode':'summary'})
            send.assert_not_called()

    def test_document_query_does_not_follow_a_switched_drawing_while_waiting(self):
        head={k:v for k,v in self.body.items() if k not in ('document','document_revision')}
        bridge.pulse({**head,'revision':1})
        with patch.object(bridge,'JOB_RESPONSE_SECONDS',.01):out=bridge.call('cad_get_document',{'mode':'summary'})
        bridge.pulse({**self.body,'revision':2,'document_revision':2,'document_generation':str(uuid.uuid4())})
        with self.assertRaisesRegex(ValueError,'changed'):bridge.get_job({'job_id':out['job_id'],'wait_seconds':1})
        self.assertFalse(bridge.queue.get(self.client))

    def test_edit_crossing_size_limit_returns_query_only_target(self):
        out,result=self._pending_redo()
        pulse=bridge.pulse({**self.body,'documentOmitted':True,'entityCount':3,'revision':1,'document_revision':1,'results':[result]})
        done=bridge.get_job({'job_id':out['job_id'],'wait_seconds':1})['result']
        self.assertEqual(done['target'],pulse['target']);self.assertTrue(done['applied'])
        self.assertTrue(done['documentOmitted']);self.assertFalse(done['capabilities']['editing'])
        self.assertTrue(done['capabilities']['document_query']);self.assertIn('조회 전용',done['message'])
        with bridge.lock:bridge._bound_state_locked(done['target'],allow_omitted=True)
        with self.assertRaisesRegex(ValueError,'조회 전용'):bridge.dispatch('cad_redo',{'target':done['target']})

    def test_save_dotted_stems_get_dxf_suffix_for_mcp_app_and_alias(self):
        import exchange
        for app in (False,True):
            for tool in (('cad_save',) if app else ('cad_save','cad_save_bound')):
                for name in ('2026.10.17_평면','plan_v1.2','plan_v1.2.DXF'):
                    with self.subTest(app=app,tool=tool,name=name),tempfile.TemporaryDirectory() as folder,patch.object(exchange,'export_dxf',return_value=(b'dxf',[])),patch.object(bridge,'dispatch',return_value={'applied':True}):
                        args={'target':self.target,'folder':folder,'name':name}
                        out=bridge.call_app(tool,args,True) if app else bridge.call(tool,args)
                        self.assertEqual(Path(out['path']).name,name if name.endswith('.DXF') else name+'.dxf')
                        self.assertEqual(Path(out['path']).read_bytes(),b'dxf');self.assertEqual(args['name'],name)

    def test_save_adds_dxf_suffix_for_mcp_and_app(self):
        import exchange
        for app in (False,True):
            with self.subTest(app=app),tempfile.TemporaryDirectory() as folder,patch.object(exchange,'export_dxf',return_value=(b'dxf',[])),patch.object(bridge,'dispatch',return_value={'applied':True}):
                args={'target':self.target,'folder':folder,'name':'주택'}
                out=bridge.call_app('cad_save',args,True) if app else bridge.call('cad_save',args)
                self.assertEqual(Path(out['path']).name,'주택.dxf');self.assertEqual(Path(out['path']).read_bytes(),b'dxf')
                self.assertEqual(args['name'],'주택')

    def test_save_rejects_other_suffixes_before_export(self):
        import exchange
        with tempfile.TemporaryDirectory() as folder,patch.object(exchange,'export_dxf') as export:
            for name in ('주택.pdf','주택.bcad'):
                with self.subTest(name=name),self.assertRaisesRegex(ValueError,r'\.dxf 또는 \.dwg'):bridge.call('cad_save',{'target':self.target,'folder':folder,'name':name})
            export.assert_not_called()

    def test_save_dwg_uses_the_same_converter_as_screen_save(self):
        # 기록(10/16): AI 가 .dwg 로 저장하면 '저장 파일은 DXF여야 합니다'로 거절 — 화면 저장은 DWG 를 지원한다
        import exchange,batch_converter
        with tempfile.TemporaryDirectory() as folder,patch.object(exchange,'export_dxf',return_value=(b'dxf',['w1'])),             patch.object(batch_converter,'dxf_to_dwg',return_value=(b'dwg',{'warnings':['w2']})) as convert,patch.object(bridge,'dispatch',return_value={'applied':True}):
            out=bridge.call('cad_save',{'target':self.target,'folder':folder,'name':'주택.dwg','dwgVersion':'2013'})
        convert.assert_called_once_with(b'dxf','2013')
        self.assertEqual(Path(out['path']).name,'주택.dwg');self.assertEqual(out['warnings'],['w1','w2'])

if __name__=='__main__':unittest.main()
