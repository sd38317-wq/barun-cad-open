"""3D MCP contracts and server routing, with no network or outside-workspace writes."""
import base64,copy,io,json,struct,tempfile,time,unittest,uuid
from pathlib import Path
from unittest.mock import patch
import bridge,mcp_server

def glb():
    chunk=b'{"asset":{"version":"2.0"}}  '
    chunk+=b' '*(-len(chunk)%4)
    return b'glTF'+struct.pack('<II',2,20+len(chunk))+struct.pack('<II',len(chunk),0x4e4f534a)+chunk

@patch('miri_account_service.require_ai_login', new=lambda: None)
class Mcp3DTest(unittest.TestCase):
    def setUp(self):
        login=patch('parcel_service.signed_in',return_value=True)
        login.start();self.addCleanup(login.stop)
        self.session=str(uuid.uuid4())
        temporary_root=Path(__file__).resolve().parent/'tmp'/'ai3d';temporary_root.mkdir(parents=True,exist_ok=True)
        self.folder=tempfile.TemporaryDirectory(dir=temporary_root)
        self.addCleanup(self.folder.cleanup)
        self.document={'entities':[]}
        with bridge.lock:
            bridge.clients.clear();bridge.queue.clear();bridge.results.clear();bridge.pending_requests.clear()
            bridge.clients[self.session]={'protocol_version':1,'document_generation':str(uuid.uuid4()),'snapshot_id':str(uuid.uuid4()),'revision':0,'document_revision':0,'document':copy.deepcopy(self.document),'folder':self.folder.name,'drawingName':'drawing','seen':time.monotonic()}
            bridge.active=self.session
        self.target=bridge.snapshot()['target']
        self.addCleanup(self.clear_state)
        self.network=patch('urllib.request.urlopen',side_effect=AssertionError('Unexpected network'))
        self.network.start();self.addCleanup(self.network.stop)

    def clear_state(self):
        with bridge.lock:
            bridge.clients.clear();bridge.queue.clear();bridge.results.clear();bridge.pending_requests.clear();bridge.active=None

    def test_push_pull_schema_binding_revision_and_payload(self):
        schema=next(t['inputSchema'] for t in bridge.TOOLS if t['name']=='cad_push_pull')
        self.assertEqual(set(schema['required']),{'target','expectedRevision','setId','element','distance'})
        with bridge.lock:bridge.clients[self.session]['document']['drawingSets']={'ds-1':{'model':{'stories':[],'elements':[]}}}
        args={'target':self.target,'expectedRevision':0,'setId':'ds-1','element':{'type':'story','id':'s'},'distance':200}
        with patch('vault_gate.knowledge',return_value=b'{}'),patch.object(bridge,'dispatch',return_value={'applied':True}) as dispatch:
            self.assertTrue(bridge.call('cad_push_pull',args)['applied'])
            sent=dispatch.call_args.args[1]
            self.assertEqual(sent['element'],args['element']);self.assertEqual(sent['target'],self.target)
            self.assertEqual(sent['request'],{'standard':{},'assemblies':{}})
        for changes in ({'target':None},{'expectedRevision':1},{'setId':'missing'},{'element':{'type':'roof','id':'s'}},{'distance':float('nan')},{'distance':True}):
            with patch.object(bridge,'dispatch') as dispatch,self.assertRaises(ValueError):bridge.call('cad_push_pull',{**args,**changes})
            dispatch.assert_not_called()
        with self.assertRaisesRegex(ValueError,'대화/검토 모드'):bridge.call('cad_push_pull',args,allow_edit=False)

    def test_design_set_selection_accepted_for_3d_view_and_glb(self):
        tools={t['name']:t for t in bridge.TOOLS}
        for name in ('cad_view_3d','cad_export_glb'):self.assertIn('setId',tools[name]['inputSchema']['properties'])
        with patch.object(bridge,'dispatch',return_value={}) as dispatch:bridge.call('cad_view_3d',{'setId':'ds-2'})
        self.assertEqual(dispatch.call_args.args[1]['setId'],'ds-2')
        for name in ('cad_view_3d','cad_export_glb'):
            with patch.object(bridge,'dispatch') as dispatch,self.assertRaises(ValueError):bridge.call(name,{'setId':False})
            dispatch.assert_not_called()

    def test_tool_schemas_flat_and_bound(self):
        tools={t['name']:t for t in bridge.TOOLS}
        for name in ('cad_view_3d','cad_export_glb','cad_set_floor_heights','cad_set_model3d'):
            schema=tools[name]['inputSchema'];self.assertEqual(schema['type'],'object')
            for forbidden in ('oneOf','anyOf','allOf'):self.assertNotIn(forbidden,schema)
            self.assertIn('target',schema['properties'])
            self.assertEqual('target' in schema['required'],name in bridge.MUTATING_TOOLS)
        for name in ('cad_set_floor_heights','cad_set_model3d'):self.assertIn('expectedRevision',tools[name]['inputSchema']['required'])
        self.assertEqual(tools['cad_view_3d']['inputSchema']['properties']['size']['maximum'],1600)

    def test_edit_dispatch_requires_exact_target_and_expected_revision(self):
        for name,args in [('cad_set_floor_heights',{'floorHeights':{'1F':4500}}),('cad_set_model3d',{'ids':['one'],'changes':{'height':200,'color':'#abcdef'}})]:
            with patch.object(bridge,'dispatch',return_value={'applied':True}) as dispatch:
                self.assertTrue(bridge.call(name,{**args,'target':self.target,'expectedRevision':0})['applied'])
                self.assertEqual(dispatch.call_args.args,(name,{**args,'target':self.target,'expectedRevision':0}))
            for invalid in ({**args},{**args,'target':self.target},{**args,'target':self.target,'expectedRevision':1}):
                with patch.object(bridge,'dispatch') as dispatch,self.assertRaises(ValueError):bridge.call(name,invalid)
                dispatch.assert_not_called()
            with patch.object(bridge,'dispatch') as dispatch,self.assertRaisesRegex(ValueError,'대화/검토 모드'):bridge.call(name,{**args,'target':self.target,'expectedRevision':0},allow_edit=False)
            dispatch.assert_not_called()

    def test_stale_target_refused_before_edit_dispatch(self):
        with bridge.lock:bridge.clients[self.session].update(revision=1,document_revision=1,snapshot_id=str(uuid.uuid4()))
        with patch.object(bridge,'dispatch') as dispatch,self.assertRaisesRegex(ValueError,'target changed'):bridge.call('cad_set_floor_heights',{'target':self.target,'expectedRevision':0,'floorHeights':{}})
        dispatch.assert_not_called()

    def test_invalid_tables_and_model_changes_rejected(self):
        args={'target':self.target,'expectedRevision':0}
        cases=[('cad_set_floor_heights',{'floorHeights':{'1F':0}}),('cad_set_floor_heights',{'floorHeights':{'0F':3000}}),('cad_set_floor_heights',{'floorHeights':{'1F':True}}),('cad_set_floor_heights',{'floorHeights':{'1F':float('inf')}}),('cad_set_model3d',{'ids':[],'changes':{'height':100}}),('cad_set_model3d',{'ids':['one'],'changes':{}}),('cad_set_model3d',{'ids':['one'],'changes':{'kind':'bad'}}),('cad_set_model3d',{'ids':['one'],'changes':{'color':'red'}}),('cad_set_model3d',{'ids':['one'],'changes':{'roofRise':-1}})]
        for name,values in cases:
            with self.subTest(values=values),patch.object(bridge,'dispatch') as dispatch,self.assertRaises(ValueError):bridge.call(name,{**args,**values})
            dispatch.assert_not_called()

    def test_view_readonly_dispatch_and_input_validation(self):
        image={'image':{'mimeType':'image/png','data':'png'},'width':900,'view':'iso-se'}
        with patch.object(bridge,'dispatch',return_value=image) as dispatch:
            out=bridge.call('cad_view_3d',{},allow_edit=False)
            self.assertEqual({k:v for k,v in out.items() if k!='destination'},image)
            self.assertEqual(out['destination']['editor_session'],self.session)
            dispatch.assert_called_once_with('cad_view_3d',{})
        for args in ({'view':'bad'},{'size':255},{'size':1601},{'size':900.5},{'floors':['bad']}):
            with patch.object(bridge,'dispatch') as dispatch,self.assertRaises(ValueError):bridge.call('cad_view_3d',args)
            dispatch.assert_not_called()

    def test_export_saves_real_glb_in_explicit_path_preserving_metadata(self):
        raw=glb();path=Path(self.folder.name)/'model.glb'
        response={'data':base64.b64encode(raw).decode(),'size':len(raw),'target':self.target,'applied':False,'revision':0}
        with patch.object(bridge,'dispatch',return_value=response) as dispatch:out=bridge.call('cad_export_glb',{'path':str(path)},allow_edit=False)
        self.assertEqual(path.read_bytes(),raw);self.assertEqual(out['size'],len(raw));self.assertEqual(out['target'],self.target);self.assertNotIn('data',out);self.assertFalse(out['applied']);self.assertEqual(dispatch.call_args.args[1]['target'],self.target)

    def test_export_default_beside_drawing_and_never_overwrites(self):
        raw=glb();folder=Path(self.folder.name);drawing=folder/'source.dxf';existing=folder/'source.glb';existing.write_bytes(b'old')
        with bridge.lock:bridge.clients[self.session]['drawingPath']=str(drawing)
        with patch.object(bridge,'dispatch',return_value={'data':base64.b64encode(raw).decode()}):out=bridge.call('cad_export_glb',{})
        self.assertEqual(Path(out['path']),folder/'source-1.glb');self.assertEqual(existing.read_bytes(),b'old')
        with patch.object(bridge,'dispatch') as dispatch,self.assertRaisesRegex(ValueError,'이미 있습니다'):bridge.call('cad_export_glb',{'path':str(existing)})
        dispatch.assert_not_called()

    def test_export_falls_back_to_documents_without_a_drawing_folder(self):
        raw=glb()
        with bridge.lock:bridge.clients[self.session]['folder']=''
        with patch.object(Path,'home',return_value=Path(self.folder.name)),patch.object(bridge,'dispatch',return_value={'data':base64.b64encode(raw).decode()}):out=bridge.call('cad_export_glb',{})
        self.assertEqual(Path(out['path']).parent,Path(self.folder.name)/'Documents')

    def test_export_invalid_bytes_and_paths_do_not_write(self):
        path=Path(self.folder.name)/'model.glb'
        for data in ('bad!',base64.b64encode(b'glTF bad').decode(),base64.b64encode(b'nope'+glb()[4:]).decode(),base64.b64encode(glb()[:-1]).decode()):
            with patch.object(bridge,'dispatch',return_value={'data':data}),self.assertRaises(ValueError):bridge.call('cad_export_glb',{'path':str(path)})
            self.assertFalse(path.exists())
        for requested in ('relative.glb','',str(path.with_suffix('.txt'))):
            with patch.object(bridge,'dispatch') as dispatch,self.assertRaises(ValueError):bridge.call('cad_export_glb',{'path':requested})
            dispatch.assert_not_called()

    def test_stdio_returns_text_plus_png_image_like_2d_eye(self):
        request={'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'cad_view_3d','arguments':{}}}
        out={'view':'iso-se','width':900,'image':{'mimeType':'image/png','data':'png'}};stdout=io.StringIO()
        with patch.object(mcp_server,'call',return_value=out),patch('sys.stdin',io.StringIO(json.dumps(request)+'\n')),patch('sys.stdout',stdout):mcp_server.serve()
        content=json.loads(stdout.getvalue())['result']['content'];self.assertEqual([c['type'] for c in content],['text','image']);self.assertEqual(content[1]['data'],'png');self.assertNotIn('image',json.loads(content[0]['text']))

    def test_native_dxf_save_load_preserves_floor_table_and_model_properties(self):
        import exchange
        doc={'version':2,'units':'mm','layers':[{'id':'a','name':'1F','color':'#abcdef','visible':True,'locked':False}],'blocks':[],'model3d':{'floorHeights':{'1F':4500,'2F':3000},'autoSlabs':False,'autoRoof':True},'entities':[{'id':'wall','type':'wall','layer':'a','thickness':200,'openings':[],'points':[{'x':0,'y':0},{'x':4000,'y':0}],'model3d':{'height':4500,'color':'#fedcba','kind':'solid'}}]}
        with patch.object(tempfile,'tempdir',self.folder.name):
            data,_=exchange.export_dxf(doc);loaded=exchange.import_file(data,'.dxf')['document']
        self.assertEqual(loaded['model3d'],doc['model3d']);self.assertEqual(loaded['entities'][0]['model3d'],doc['entities'][0]['model3d'])

if __name__=='__main__':unittest.main()
