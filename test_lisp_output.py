import copy,unittest
from lisp_output import normalize

class LispOutputTest(unittest.TestCase):
 def test_new_block_and_multiline_are_separate_with_unique_layers(self):
  original={'layers':[{'id':'zero','name':'0','color':'#abcdef'}],'entities':[{'id':'old','type':'line','layer':'zero','points':[{'x':0,'y':0},{'x':1,'y':0}]}]}
  d=copy.deepcopy(original);d['entities'].append({'id':'block','type':'block','layer':'zero','entities':[{'id':'a','type':'circle','layer':'zero','center':{'x':1,'y':2},'radius':3},{'id':'b','type':'text','layer':'zero','position':{'x':10,'y':20},'height':10,'rotation':90,'text':'A\nB'}]})
  result,count=normalize(d,original,'TOOL');self.assertEqual(count,3);self.assertEqual(result['entities'][0],original['entities'][0]);self.assertEqual(len({e['id'] for e in result['entities']}),4);self.assertFalse(any(e['type']=='block' for e in result['entities']))
  names={l['id']:l['name'] for l in result['layers']};self.assertEqual(names[result['entities'][1]['layer']],'LISP-TOOL-CIRCLE');self.assertEqual(names[result['entities'][2]['layer']],'LISP-TOOL-TEXT');self.assertAlmostEqual(result['entities'][3]['position']['x'],23.5)
 def test_old_blocks_and_explicit_layers_are_preserved(self):
  original={'layers':[{'id':'a','name':'0'}],'entities':[{'id':'old','type':'block','layer':'a','entities':[]}]};d=copy.deepcopy(original);d['layers'].append({'id':'purpose','name':'CUSTOM-OUTPUT'});d['entities'].append({'id':'new','type':'line','layer':'purpose','points':[]});r,n=normalize(d,original,'X');self.assertEqual(r['entities'][0],original['entities'][0]);self.assertEqual(r['entities'][1]['layer'],'purpose')
 def test_clipped_output_is_not_silently_unclipped(self):
  original={'layers':[{'id':'a','name':'0'}],'entities':[]};d=copy.deepcopy(original);d['entities'].append({'id':'b','type':'block','layer':'a','clip':{'enabled':True},'entities':[]})
  with self.assertRaises(ValueError):normalize(d,original,'X')
if __name__=='__main__':unittest.main()
