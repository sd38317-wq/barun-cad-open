from unittest.mock import patch
import json
import unittest
from pathlib import Path
import drawing_knowledge as knowledge
import bridge


@patch('miri_account_service.require_ai_login', new=lambda: None)
class KnowledgeTests(unittest.TestCase):
    def test_missing_is_unknown(self):
        result = knowledge.evaluate({})
        self.assertEqual(result['status'], 'unknown')
        self.assertTrue(all(r['status'] == 'unknown' for r in result['results']))
        self.assertFalse(result['designApproval'])

    def test_explicit_failure_and_partial_evidence(self):
        result = knowledge.evaluate({'scaleVerified': True, 'doorConnectivityVerified': False})
        self.assertEqual(result['status'], 'fail')
        by_id = {r['ruleId']: r for r in result['results']}
        self.assertEqual(by_id['evidence.scale']['status'], 'pass')
        self.assertIn('traversable_connection', by_id['evidence.connectivity']['blockedClaims'])
        self.assertEqual(by_id['evidence.dwelling']['status'], 'unknown')

    def test_invalid_flags_rejected(self):
        for value in ('true', 1, [], {}):
            with self.assertRaises(ValueError): knowledge.evaluate({'scaleVerified': value})
        with self.assertRaises(ValueError): knowledge.evaluate({'invented': True})

    def test_observation_coverage(self):
        root = Path(__file__).parent/'data/aihub-71465/full-catalog'
        summary = json.loads((root/'summary.json').read_text(encoding='utf-8'))
        spatial = json.loads((root/'spatial-patterns.json').read_text(encoding='utf-8'))
        rules = knowledge.bundle()['observations']
        self.assertEqual(len(rules), len(summary['classCounts']) + len(spatial['patterns']))
        self.assertEqual(sum(r['count'] for r in rules if r['kind']=='proximity'), spatial['proximityCandidates'])
        self.assertTrue(all(r['mandatory'] is False for r in rules))

    def test_bridge_readonly_and_no_false_approval(self):
        facts = {r['fact']: True for r in knowledge.bundle()['gates']}
        result = bridge.call('cad_evaluate_drawing_evidence', {'facts': facts}, allow_edit=False)
        self.assertEqual(result['status'], 'pass')
        self.assertFalse(result['designApproval'])

    def test_real_context_has_rules(self):
        import design_case_service
        result = design_case_service.planning_context('단독주택 방 3개')
        self.assertEqual(len(result['judgmentKnowledge']['gates']), 7)
        self.assertTrue(result['references'])
        for ref in result['references']:
            self.assertFalse(ref['evidenceReadiness']['designApproval'])


if __name__ == '__main__': unittest.main()
