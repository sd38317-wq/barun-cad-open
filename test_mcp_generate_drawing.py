"""MCP cad_generate_drawing: 도구가 목록에 있고, 브리지가 도면 기준·구성표를 실어 화면에 보낸다."""
import io,json,unittest
from unittest.mock import patch
import bridge

@patch('miri_account_service.require_ai_login', new=lambda: None)
class GenerateDrawingToolTest(unittest.TestCase):
    def test_tool_is_listed_with_bound_target(self):
        tool=next(t for t in bridge.TOOLS if t['name']=='cad_generate_drawing')
        self.assertEqual(tool['inputSchema']['required'],['target'])   # model 또는 setId(다시 그리기)
        self.assertIn('setId',tool['inputSchema']['properties'])
        self.assertEqual(bridge.BOUND_ALIASES['cad_generate_drawing_bound'],'cad_generate_drawing')
        self.assertNotIn('cad_generate_drawing_bound',[t['name'] for t in bridge.TOOLS])
        self.assertIn('cad_generate_drawing',bridge.MUTATING_TOOLS)

    def test_bridge_sends_standard_and_assemblies(self):
        model=json.load(open('test-fixtures/drawing/buildit-5f.json',encoding='utf8'))
        sent={}
        with patch.object(bridge,'validate_target'),patch.object(bridge,'_bound_state_locked',return_value={'document':{}}),patch.object(bridge,'dispatch',side_effect=lambda name,args:sent.update(name=name,args=args) or {'applied':True}):
            bridge.call('cad_generate_drawing',{'model':model,'kind':'plan','target':{'protocol_version':1}})
        request=sent['args']['request']
        self.assertEqual(sent['name'],'cad_generate_drawing')
        self.assertEqual(request['standard']['materials']['concrete']['hatch']['color'],'#808080')
        self.assertIn('walls',request['assemblies'])
        self.assertEqual(request['kind'],'plan')

    def test_set_id_must_exist_and_model_is_optional(self):
        state={'document':{'drawingSets':{'ds-1':{'kind':'plan','model':{'stories':[],'elements':[]},'options':{},'revision':1}}}}
        sent={}
        with patch.object(bridge,'JOB_RESPONSE_SECONDS',30),patch.object(bridge,'validate_target'),patch.object(bridge,'_bound_state_locked',return_value=state),patch.object(bridge,'dispatch',side_effect=lambda name,args:sent.update(args=args) or {'applied':True}):
            bridge.call('cad_generate_drawing',{'setId':'ds-1','target':{'protocol_version':1}})
            self.assertEqual(sent['args']['request']['setId'],'ds-1');self.assertNotIn('model',sent['args']['request'])
            with self.assertRaises(ValueError):bridge.call('cad_generate_drawing',{'setId':'ds-9','target':{}})
            bridge.call('cad_generate_drawing',{'kind':'section','target':{}})
            self.assertNotIn('model',sent['args']['request'])

    def test_get_drawing_sets(self):
        doc={'drawingSets':{'ds-1':{'kind':'set','model':{'stories':[1]},'options':{'origin':{'x':0,'y':0}},'revision':2}}}
        with patch.object(bridge,'snapshot',return_value={'document':doc}):
            full=bridge.call('cad_get_drawing_sets',{});short=bridge.call('cad_get_drawing_sets',{'include_model':False})
        self.assertEqual(full['sets'][0]['setId'],'ds-1');self.assertEqual(full['sets'][0]['model'],{'stories':[1]})
        self.assertNotIn('model',short['sets'][0]);self.assertEqual(short['sets'][0]['revision'],2)

    def test_rejects_non_model(self):
        with patch.object(bridge,'validate_target'),patch.object(bridge,'_bound_state_locked',return_value={'document':{}}):
            with self.assertRaises(ValueError):bridge.call('cad_generate_drawing',{'model':{'x':1},'target':{}})

    def test_current_plan_routes_and_options_are_shared_with_app_ai(self):
        tool=next(t for t in bridge.mcp_tools() if t['name']=='cad_generate_drawing')
        self.assertTrue({'set','all','elevation','section','schedule'} <= set(tool['inputSchema']['properties']['kind']['enum']))
        self.assertIn('planOptions',tool['inputSchema']['properties'])
        app=next(t for t in bridge.app_tools(True) if t['name']=='cad_generate_drawing')
        self.assertEqual(app['inputSchema'],tool['inputSchema'])
        for kind in ('section','schedule','set','all','elevation'):
            sent={}
            opts={'floors':[{'name':'1F','height':3200}],'windowHeight':1600}
            with patch.object(bridge,'validate_target'),patch.object(bridge,'_bound_state_locked',return_value={'document':{}}),patch.object(bridge,'dispatch',side_effect=lambda name,args:sent.update(args=args) or {'applied':True}):
                bridge.call('cad_generate_drawing',{'kind':kind,'planOptions':opts,'occt':True,'sectionAt':2500,'face':'south','target':{}})
            request=sent['args']['request']
            self.assertEqual(request['kind'],kind)
            self.assertEqual(request['planOptions'],opts)
            self.assertTrue(request['occt'])
            self.assertEqual(request['sectionAt'],2500)
            self.assertEqual(request['face'],'south')
            self.assertNotIn('model',request)

    def test_scripted_command_inputs_are_explicit_and_shared_with_app(self):
        for name in ('cad_run_command','cad_preview_command','cad_describe_command'):
            tool=next(t for t in bridge.mcp_tools() if t['name']==name)
            app=next(t for t in bridge.app_tools(True) if t['name']==name)
            schema=tool['inputSchema']['properties']['inputs']
            self.assertEqual(schema,app['inputSchema']['properties']['inputs'])
            self.assertTrue({'form','points','paths','entities','numbers','selection','slot','method','shared'} <= set(schema['properties']))
            for word in ('WALDRAW','slot','lines','D1/W1','PLANSET'):
                self.assertIn(word,schema['properties']['form']['description'])
            self.assertEqual(schema['properties']['slot']['type'],'integer')
            self.assertIn({'type':'null'},schema['properties']['paths']['items']['anyOf'])

    def test_long_work_timeout_covers_worker_and_http(self):
        import mcp_server
        for action,args in [('cad_generate_drawing',{}),('cad_generate_details',{}),('cad_generate_drawing_bound',{}),('cad_run_command_bound',{'name':'PLANSET'}),('cad_run_command',{'name':'PLANSET'}),('cad_run_command',{'name':'WSL'}),('cad_run_command',{'name':'OCCTSECTION'})]:
            self.assertGreater(bridge.dispatch_timeout(action,args),180)
            self.assertIs(mcp_server.dispatch_timeout,bridge.dispatch_timeout)
        self.assertEqual(bridge.dispatch_timeout('cad_run_command',{'name':'D1'}),bridge.DISPATCH_TIMEOUT)
        self.assertEqual(bridge.dispatch_timeout('cad_get_document',{}),bridge.DISPATCH_TIMEOUT)
        self.assertLess(bridge.JOB_RESPONSE_SECONDS,2)

    def test_mcp_http_waits_past_long_worker_for_aliases_and_details(self):
        import mcp_server
        for name,args in [('cad_generate_drawing',{}),('cad_generate_details',{}),('cad_generate_drawing_bound',{}),('cad_run_command_bound',{'name':'PLANSET'})]:
            with patch.object(mcp_server,'_grant',return_value='test-grant'),patch.object(mcp_server,'find_connection',return_value={'url':'http://127.0.0.1:1','token':'test'}),patch.object(mcp_server,'_alive',return_value=True),patch.object(mcp_server.urllib.request,'urlopen') as opening:
                opening.return_value.__enter__.return_value=io.BytesIO(b'{}')
                out=mcp_server.call(name,args)
                self.assertEqual({k:v for k,v in out.items() if k!='destination'},{})
                self.assertEqual(out['destination']['engine_url'],'http://127.0.0.1:1')
                self.assertEqual(opening.call_args.kwargs['timeout'],30)

if __name__=='__main__':unittest.main()
