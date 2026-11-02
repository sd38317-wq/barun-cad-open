"""리습 먼저: 라이브러리 명령이 있는 건축 요소는 기본 도형·AI 리습으로 그리면 거절된다. 실제 계정·서버는 쓰지 않는다."""
import unittest
from unittest.mock import patch
import bridge,library_first,mcp_server
from test_mcp_3d import Mcp3DTest

LINE={'type':'line','points':[{'x':0,'y':0},{'x':1000,'y':0}]}


@patch('miri_account_service.require_ai_login',new=lambda:None)
class LibraryFirstTest(unittest.TestCase):
    setUp_base=Mcp3DTest.setUp
    clear_state=Mcp3DTest.clear_state

    def setUp(self):
        self.setUp_base()
        with library_first._lock:library_first._seen.clear()
        self.addCleanup(library_first._seen.clear)
        with bridge.lock:bridge.clients[self.session]['document']['layers']=[{'id':'L-glaz','name':'A-GLAZ'},{'id':'L-user','name':'내 레이어'}]

    def execute(self,command,**extra):
        return bridge.call('cad_execute',{'target':self.target,'expectedRevision':0,'command':command,**extra})

    def refused(self,command,**extra):
        with patch.object(bridge,'dispatch') as dispatch,self.assertRaises(bridge.CADToolError) as caught:
            self.execute(command,**extra)
        dispatch.assert_not_called()
        self.assertEqual(caught.exception.code,'library_first')
        return caught.exception

    def passes(self,command,**extra):
        with patch.object(bridge,'dispatch',return_value={'applied':True}) as dispatch:
            self.execute(command,**extra)
        dispatch.assert_called_once()
        self.assertNotIn('library_check',dispatch.call_args.args[1])
        return dispatch

    def test_candidates_are_tested_library_commands(self):
        # 표에 적은 명령이 라이브러리에서 빠지거나 시험 미통과로 바뀌면 문지기가 조용히 풀린다 — 여기서 잡는다.
        for intent,(label,names) in library_first.INTENTS.items():
            self.assertEqual([c['command'] for c in library_first.candidates(intent)],list(names))

    def test_wall_by_primitive_points_to_library(self):
        error=self.refused({'type':'add','entity':{'type':'wall','points':[{'x':0,'y':0},{'x':3000,'y':0}],'thickness':200}},layer='A-WALL')
        self.assertEqual([c['command'] for c in error.details['blocked'][0]['candidates']],['WALDRAW'])
        self.assertIn('WALDRAW',str(error));self.assertIn('cad_run_command',str(error))

    def test_intent_from_layer_purpose_and_layer_id(self):
        for extra,intent in [({'layer':'A-WALL-CONC'},'wall'),({'purpose':'문'},'door'),({'purpose':'벽체'},'wall'),({'layer':'A-DIM'},'dimension')]:
            with self.subTest(extra=extra):
                self.assertEqual(self.refused({'type':'add','entity':LINE},**extra).details['blocked'][0]['intent'],intent)
        # cad_get_document 가 준 레이어 ID 도 이름으로 풀어 본다
        error=self.refused({'type':'add','entity':{**LINE,'layer':'L-glaz'}})
        self.assertEqual(error.details['blocked'][0]['intent'],'window')

    def test_batch_and_add_many_are_checked(self):
        self.refused({'type':'batch','commands':[{'type':'add','entity':{**LINE,'layer':'A-TEXT'}},{'type':'addMany','entities':[{**LINE,'layer':'A-COL'}]}]})

    def test_unlabelled_new_shape_refused(self):
        self.assertEqual(self.refused({'type':'add','entity':LINE}).details['unlabelled'],1)

    def test_other_shapes_and_edits_pass(self):
        self.passes({'type':'add','entity':{**LINE,'layer':'A-SYM'}})
        self.passes({'type':'add','entity':LINE},purpose='text')
        self.passes({'type':'add','entity':{**LINE,'layer':'L-user'}})  # 사용자 레이어는 존중
        for command in [{'type':'move','ids':['a'],'dx':1,'dy':0},{'type':'delete','ids':['a']},{'type':'update','ids':['a'],'changes':{'layer':'A-WALL'}}]:
            self.passes(command)

    def test_escape_needs_real_lookup_of_a_candidate(self):
        wall={'type':'add','entity':LINE}
        check={'command':'WAL','reason':'단면 상세의 벽 마감선이라 평면 벽 명령이 맞지 않음'}
        self.refused(wall,layer='A-WALL',library_check=check)  # 말로만은 안 된다
        bridge.call('cad_get_command',{'name':'D1'})
        self.refused(wall,layer='A-WALL',library_check={**check,'command':'D1'})  # 벽 후보가 아닌 명령
        bridge.call('cad_get_command',{'name':'waldraw'})
        self.passes(wall,layer='A-WALL',library_check=check)  # 별칭으로 이유를 대도 된다
        with patch('time.monotonic',return_value=library_first._seen['WALDRAW']+library_first.EVIDENCE_SECONDS+1):
            self.refused(wall,layer='A-WALL',library_check=check)  # 30분 지나면 다시 써 봐야 한다
        for bad in [{'command':'WAL'},{'command':'WAL','reason':'x'},{'command':'WAL','reason':'긴 이유입니다','extra':1},[]]:
            with self.subTest(bad=bad),patch.object(bridge,'dispatch') as dispatch,self.assertRaises(ValueError):
                self.execute(wall,layer='A-WALL',library_check=bad)
            dispatch.assert_not_called()

    def test_each_blocked_kind_needs_its_own_check(self):
        both={'type':'batch','commands':[{'type':'add','entity':{**LINE,'layer':'A-WALL'}},{'type':'add','entity':{**LINE,'layer':'A-DOOR'}}]}
        with patch.object(bridge,'dispatch',return_value={'created':0}):bridge.call('cad_describe_command',{'name':'WALDRAW'})
        wall={'command':'WALDRAW','reason':'곡선 벽이라 못 그림'}
        self.assertEqual([b['intent'] for b in self.refused(both,library_check=wall).details['blocked']],['door'])
        with patch.object(bridge,'dispatch',side_effect=bridge.CADToolError('입력 부족',{'code':'input_required'})):
            with self.assertRaises(ValueError):bridge.call('cad_run_command',{'target':self.target,'expectedRevision':0,'name':'D1'})
        self.passes(both,library_check=[wall,{'command':'D1','reason':'벽선이 평행하지 않아 실패'}])  # 엔진이 돌려준 실행 실패도 써 본 기록

    def test_call_refused_at_the_door_is_not_evidence(self):
        with patch.object(bridge,'dispatch') as dispatch,self.assertRaises(ValueError):
            bridge.call('cad_run_command',{'target':self.target,'expectedRevision':0,'name':'WALDRAW'},allow_edit=False)
        dispatch.assert_not_called()
        self.refused({'type':'add','entity':LINE},layer='A-WALL',library_check={'command':'WALDRAW','reason':'검토 모드에서 실행 못 함'})

    def test_layer_made_in_same_batch_and_block_insides_are_checked(self):
        # cad_preview 의 normalized_command 처럼 layer.add 뒤 그 ID 로 그리는 batch
        self.refused({'type':'batch','commands':[{'type':'layer.add','id':'new-1','name':'A-WALL'},{'type':'add','entity':{**LINE,'layer':'new-1'}}]})
        block={'type':'block','layer':'A-SYM','entities':[{'type':'wall','points':[],'thickness':200},{**LINE,'layer':'A-DOOR'}]}
        self.assertEqual({b['intent'] for b in self.refused({'type':'add','entity':block}).details['blocked']},{'wall','door'})
        self.passes({'type':'add','entity':{'type':'block','layer':'A-SYM','entities':[LINE]}})  # 안쪽 미지정은 바깥 레이어

    def test_ai_lisp_load_checked_bundled_lisp_run_not(self):
        base={'target':self.target,'expectedRevision':0}
        with patch.object(bridge,'dispatch') as dispatch,self.assertRaises(bridge.CADToolError) as caught:
            bridge.call('cad_lisp_load',{**base,'source':'(defun c:MYW () (entmake (list (cons 0 "LINE") (cons 8 "A-WALL"))))','command':'MYW'})
        dispatch.assert_not_called();self.assertEqual(caught.exception.details['blocked'][0]['intent'],'wall')
        with patch.object(bridge,'dispatch',return_value={'created':1}) as dispatch:
            bridge.call('cad_lisp_load',{**base,'source':'(defun c:MYT () (entmake (list (cons 0 "TEXT") (cons 8 "A-TEXT"))))'})
            bridge.call('cad_lisp_run',{**base,'command':'WALL2'})
            # 기존 벽을 고르기만 하는 리습은 새로 그리는 것이 아니다
            bridge.call('cad_lisp_load',{**base,'source':'(defun c:MVW () (command "_.MOVE" (ssget "X" \'((8 . "A-WALL"))) "" "0,0" "100,0"))'})
        self.assertEqual(dispatch.call_count,3)

    def test_preview_hints_without_refusing(self):
        args={'command':{'type':'add','entity':LINE},'layer':'A-WALL'}
        with patch.object(bridge,'dispatch',return_value={'changes':[]}) as dispatch:
            result=bridge.call('cad_preview',args)
        dispatch.assert_called_once_with('cad_preview',args)
        self.assertEqual(result['library_first']['blocked'][0]['candidates'][0]['command'],'WALDRAW')

    def test_app_ai_goes_through_same_gate(self):
        with patch.object(bridge,'dispatch') as dispatch,self.assertRaises(bridge.CADToolError):
            bridge._call_app('cad_execute',{'target':self.target,'expectedRevision':0,'command':{'type':'add','entity':LINE},'layer':'A-WALL'},allow_edit=True)
        dispatch.assert_not_called()

    def test_app_old_actions_use_same_table_and_evidence(self):
        # ai-actions.js libraryFirstRequest 가 보내는 모양(ai-actions.test.js 의 같은 예와 짝)
        import chat_router
        ask=lambda **request:chat_router.process({'action':'libraryFirst',**request})
        wall=[{'type':'wall','layer':'0'}];door_line=[{'type':'line','layer':'A-DOOR'}]
        self.assertEqual([b['intent'] for b in ask(entities=wall)['blocked']],['wall'])  # 도형 종류로
        self.assertEqual([c['command'] for c in ask(entities=door_line)['blocked'][0]['candidates']],['D1'])  # 레이어로
        self.assertEqual(ask(entities=[{'type':'text','layer':'A-AREA'}])['blocked'][0]['intent'],'room')
        self.assertEqual(ask(entities=[{'type':'line','layer':'0'},{'type':'circle','layer':'내 레이어'}])['blocked'],[])
        check={'command':'WALDRAW','reason':'곡선 벽이라 직선 벽 명령으로 못 그림'}
        self.assertTrue(ask(entities=wall,library_check=[check])['blocked'])  # 써 본 기록 없으면 안 된다
        with patch.object(bridge,'dispatch',return_value={'created':0}):bridge.call('cad_describe_command',{'name':'WALDRAW'})
        self.assertEqual(ask(entities=wall,library_check=[check]),{'blocked':[],'checks':[check]})
        self.assertTrue(ask(entities=wall+door_line,library_check=[check])['blocked'])  # 문은 따로 써 봐야
        for bad in [{},{'entities':[]},{'entities':[{'type':'line'}]},{'entities':[{'type':'line','layer':'0','x':1}]}]:
            with self.subTest(bad=bad),self.assertRaises(ValueError):ask(**bad)

    def test_schema_and_instructions_tell_the_rule(self):
        import codex_chat,miri_chat
        self.assertIn(library_first.ACTIONS_RULE,codex_chat.ACTION_INSTRUCTIONS)
        self.assertIn(library_first.ACTIONS_RULE,miri_chat.CAD_ACTION_INSTRUCTIONS)
        tools={t['name']:t for t in bridge.mcp_tools()}
        for name in ('cad_execute','cad_lisp_load'):
            self.assertIn('library_check',tools[name]['inputSchema']['properties'])
            self.assertIn('library_first',tools[name]['description'])
        self.assertIn('library_first',bridge.CAD_DRAWING_INSTRUCTIONS)
        self.assertIn('library_first',mcp_server.CAD_DRAWING_INSTRUCTIONS)


if __name__=='__main__':unittest.main()
