import re
import time
import unittest
import uuid

import bridge


class StaleBridgeClients(unittest.TestCase):
    def setUp(self):
        with bridge.lock:
            bridge.clients.clear();bridge.queue.clear();bridge.active=None

    def test_closed_editor_copies_are_dropped_after_two_minutes(self):
        closed,open_=str(uuid.uuid4()),str(uuid.uuid4())
        bridge.pulse({'client':closed,'active':True})
        bridge.pulse({'client':open_,'active':False})
        with bridge.lock:bridge.clients[closed]['seen']=time.monotonic()-bridge.STALE_CLIENT_SECONDS-1
        bridge.pulse({'client':open_,'active':True})
        self.assertNotIn(closed,bridge.clients)
        self.assertEqual(bridge.active,open_)

    def test_recent_hidden_editor_is_kept(self):
        hidden,front=str(uuid.uuid4()),str(uuid.uuid4())
        bridge.pulse({'client':hidden,'active':False})
        with bridge.lock:bridge.clients[hidden]['seen']=time.monotonic()-30
        bridge.pulse({'client':front,'active':True})
        self.assertIn(hidden,bridge.clients)


class ToolList(unittest.TestCase):
    def test_bound_aliases_are_hidden_but_still_routed(self):
        names={t['name'] for t in bridge.TOOLS}
        self.assertFalse([n for n in names if n.endswith('_bound')])
        self.assertLessEqual(set(bridge.BOUND_ALIASES.values()),names)

    def test_property_keys_follow_api_name_rule(self):
        bad=[(t['name'],k) for t in bridge.TOOLS for k in t['inputSchema'].get('properties',{}) if not re.fullmatch(r'[a-zA-Z0-9_.-]{1,64}',k)]
        self.assertEqual(bad,[])


class LargeDocumentQueries(unittest.TestCase):
    def setUp(self):
        from unittest.mock import patch
        self.patch=patch
        with bridge.lock:
            bridge.clients.clear();bridge.queue.clear();bridge.results.clear();bridge.pending_requests.clear();bridge.active=None
        self.enterContext(patch.object(bridge,'schedule_recovery'))
        self.enterContext(patch('miri_account_service.require_ai_login',new=lambda:None))
        self.enterContext(patch('miri_account_service.capture_ai_epoch',return_value=None))
        self.client=str(uuid.uuid4());self.generation=str(uuid.uuid4())
        self.body={'client':self.client,'editor_session':self.client,'protocol_version':1,'document_generation':self.generation,
                   'revision':3,'document_revision':3,'documentOmitted':True,'entityCount':46525,'active':True}
        self.response=bridge.pulse(self.body)

    def test_omitted_body_has_stable_revision_bound_target(self):
        target=self.response['target']
        self.assertEqual(target,bridge.pulse(self.body)['target'])
        self.assertEqual(target['revision'],3)
        self.assertFalse(self.response['needDocument'])
        self.assertNotIn('document',bridge.clients[self.client])
        changed=bridge.pulse({**self.body,'revision':4,'document_revision':4})['target']
        self.assertNotEqual(target['snapshot_id'],changed['snapshot_id'])
        with self.patch.object(bridge,'_send_locked',return_value={'mode':'summary'}) as send:
            bridge.dispatch('cad_get_document',{'target':target,'mode':'summary'})
            self.assertEqual(send.call_args.args[2]['target'],changed)
            self.assertEqual(send.call_args.args[3],4)

    def test_omitted_body_rejects_revision_mismatch(self):
        with self.assertRaisesRegex(ValueError,'revision mismatch'):
            bridge.pulse({**self.body,'revision':4,'document_revision':3})

    def test_default_large_read_and_each_explicit_mode_dispatch_without_document_copy(self):
        def answer(client,action,args,revision):
            self.assertEqual((client,action,revision),(self.client,'cad_get_document',3))
            self.assertEqual(args['target'],self.response['target'])
            return {'mode':args.get('mode','summary'),'target':args['target']}
        with self.patch.object(bridge,'_send_locked',side_effect=answer),self.patch.object(bridge.copy,'deepcopy',side_effect=lambda value: value if 'document' not in value else self.fail('full document copied')):
            self.assertEqual(bridge._call('cad_get_document',{})['mode'],'summary')
            for args in ({'mode':'summary'},{'mode':'window','window':{'x0':0,'y0':0,'x1':10,'y1':10},'limit':2},{'mode':'selection','ids':['one']}):
                self.assertEqual(bridge._call('cad_get_document',args)['mode'],args['mode'])

    def test_query_arguments_are_validated_before_dispatch(self):
        bridge.pulse({**self.body,'documentOmitted':False,'document':{'entities':[],'layers':[]}})
        invalid=[{'mode':'all'},{'mode':'window'},{'mode':'window','window':{'x0':0,'y0':0,'x1':float('nan'),'y1':1}},
                 {'mode':'window','window':{'x0':10,'y0':0,'x1':0,'y1':1}},{'mode':'selection','ids':'one'},
                 {'mode':'selection','ids':['one']*1001},{'mode':'summary','limit':0},{'mode':'summary','limit':True},
                 {'mode':'summary','limit':1001},{'mode':'summary','window':{'x0':0,'y0':0,'x1':1,'y1':1}}]
        with self.patch.object(bridge,'_send_locked') as send:
            for args in invalid:
                with self.subTest(args=args),self.assertRaises(ValueError):bridge._call('cad_get_document',args)
            send.assert_not_called()

    def test_large_target_cannot_be_used_for_editing_or_full_body_reads(self):
        target=self.response['target']
        with self.assertRaisesRegex(ValueError,'조회 전용'):bridge.dispatch('cad_undo',{'target':target})
        with self.assertRaisesRegex(ValueError,'mode=window'):bridge.snapshot(self.client)

    def test_small_default_read_keeps_full_snapshot_and_explicit_query_uses_renderer(self):
        bridge.pulse({**self.body,'documentOmitted':False,'document':{'entities':[],'layers':[]}})
        self.assertEqual(bridge._call('cad_get_document',{})['document']['entities'],[])
        with self.patch.object(bridge,'_send_locked',return_value={'mode':'summary'}) as send:
            self.assertEqual(bridge._call('cad_get_document',{'mode':'summary'})['mode'],'summary')
            self.assertEqual(send.call_args.args[1],'cad_get_document')

    def test_tool_schema_exposes_bounded_query_modes(self):
        props=next(t for t in bridge.TOOLS if t['name']=='cad_get_document')['inputSchema']['properties']
        self.assertEqual(props['mode']['enum'],['summary','window','selection'])
        self.assertEqual(props['limit']['maximum'],1000)


    def test_renderer_result_is_accepted_and_delivered_without_a_document_body(self):
        import threading
        output=[]
        def query():
            try:output.append(bridge._call('cad_get_document',{'editor_session':self.client,'mode':'summary'}))
            except Exception as error:output.append(error)
        with self.patch.object(bridge,'DISPATCH_TIMEOUT',2):
            thread=threading.Thread(target=query);thread.start()
            with bridge.lock:
                self.assertTrue(bridge.lock.wait_for(lambda:bridge.queue.get(self.client),timeout=1))
                request=bridge.queue[self.client][0]
            target=request['args']['target']
            result={'target':target,'before_revision':3,'after_revision':3,'revision':3,'applied':False,'mode':'summary','summary':{'entityCount':46525}}
            response=bridge.pulse({**self.body,'results':[{'id':request['id'],'target':target,'result':result}]})
            thread.join(2)
        self.assertFalse(thread.is_alive());self.assertEqual(response['rejected_results'],[])
        self.assertEqual(output[0]['summary']['entityCount'],46525)
        self.assertNotIn('document',bridge.clients[self.client]);self.assertFalse(bridge.pending_requests)

    def test_small_legacy_editor_default_read_still_works(self):
        bridge.pulse({'client':'legacy','revision':0,'active':True,'document':{'entities':[]}})
        self.assertEqual(bridge._call('cad_get_document',{})['document']['entities'],[])


if __name__=='__main__':
    unittest.main()
