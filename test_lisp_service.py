"""Actual AutoCAD engine integration plus library and result-preservation checks."""
import base64,copy,json,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
import lisp_service as service

MODEL={'units':'mm','layers':[{'id':'default','name':'기본','color':'#ffffff','visible':True,'locked':False,'building':True}], 'entities':[{'id':'line','type':'line','layer':'default','points':[{'x':0,'y':0},{'x':1000,'y':0}]},{'id':'wall','type':'wall','layer':'default','points':[{'x':0,'y':2000},{'x':3000,'y':2000}],'thickness':200,'openings':[]}]}
class LibraryTest(unittest.TestCase):
 def setUp(self):
  self.enterContext(patch('miri_account_service.require_ai_login',return_value=None))
  self.temp=tempfile.TemporaryDirectory(prefix='barun_lisp_tests_');self.oldroot=service.ROOT;service.ROOT=Path(self.temp.name);service.JOBS.clear()
 def tearDown(self):
  for job in service.JOBS.values():
   job['cancel'].set()
  service.ROOT=self.oldroot;self.temp.cleanup()
 def upload(self,name,source):return service.process({'action':'upload','name':name,'data':base64.b64encode(source.encode('utf8') if isinstance(source,str) else source).decode()})['file']
 def test_encoding_comments_and_management(self):
  raw='; (defun c:FAKE ())\n(defun c:진짜 () (princ "(defun c:NO ())"))'.encode('cp949');f=self.upload('한글.lsp',raw);self.assertEqual(f['commands'],['진짜']);self.assertEqual(f['encoding'],'cp949')
  g=self.upload('second.lsp','(defun c:B () (princ))');service.process({'action':'reorder','ids':[g['id'],f['id']]});self.assertEqual(service.read_library()[0]['id'],g['id'])
  service.process({'action':'update','id':f['id'],'source':'(defun c:EDITED () (princ))'});self.assertEqual(service.read_library()[1]['commands'],['EDITED']);self.assertTrue((service.ROOT/(f['id']+'.previous')).exists())
  service.process({'action':'remove','id':g['id']});self.assertEqual(len(service.read_library()),1)
 def test_renamed_bundled_copies_are_retired_only_when_unmodified(self):
  # 2026-10-06 이름을 바꾼 동봉 리습: 옛 이름 사본은 고친 흔적(.previous)이 없으면 지우고, 사용자가 고쳤으면 남긴다.
  service.ROOT.mkdir(parents=True,exist_ok=True)
  items=[{'id':'a'*32,'name':'07_COL_기둥.lsp','size':1,'bundled':True,'commands':['COL']},{'id':'b'*32,'name':'16_PC_닫기.lsp','size':1,'bundled':True,'commands':['PC']}]
  (service.ROOT/('a'*32+'.bin')).write_bytes('(defun C:COL () (princ))'.encode());(service.ROOT/('b'*32+'.bin')).write_bytes('(defun C:PC () (princ)) ; 사용자 수정'.encode());(service.ROOT/('b'*32+'.previous')).write_bytes('(defun C:PC () (princ))'.encode())
  service.save_library(items)
  names={i['name'] for i in service.ensure_architecture_library()}
  self.assertNotIn('07_COL_기둥.lsp',names);self.assertFalse((service.ROOT/('a'*32+'.bin')).exists())
  self.assertIn('16_PC_닫기.lsp',names);self.assertNotIn('07_COL2_기둥.lsp',names,'동봉 리습은 더 등록하지 않는다(2026-10-27)')
 def test_bundled_copies_are_retired_unless_user_edited(self):
  # 동봉 건축 리습은 2026-10-27 뺐다: 자동 등록됐던 사본 중 고치지 않은 것은 지우고, 편집기로 고친 것(.previous)은 사용자 파일로 남긴다.
  items=[{'id':'c'*32,'name':'04_WALL2_직선이중벽.lsp','size':1,'bundled':True,'commands':['WALL2']},{'id':'d'*32,'name':'22_TITLE2_도각.lsp','size':1,'bundled':True,'commands':['TITLE2']}]
  for item in items:(service.ROOT/(item['id']+'.bin')).write_bytes(b'(defun c:X () (princ))')
  (service.ROOT/('d'*32+'.previous')).write_bytes(b'x')
  service.save_library(items)
  files=service.ensure_architecture_library()
  self.assertEqual([f['name'] for f in files],['22_TITLE2_도각.lsp']);self.assertFalse(files[0]['bundled'])
  self.assertFalse((service.ROOT/('c'*32+'.bin')).exists());self.assertTrue((service.ROOT/('d'*32+'.bin')).exists())
  self.assertNotIn('bundled',service.read_library()[0])
 def test_toggle_keeps_file_and_block_comments_are_ignored(self):
  f=self.upload('주석.lsp','#| (defun c:FAKE ()) |#\n;| (defun c:FAKE2 ()) |;\n(defun c:REAL () (princ))');self.assertEqual(f['commands'],['REAL'])
  service.process({'action':'toggle','id':f['id'],'enabled':False});self.assertTrue(service.read_library()[0]['disabled'])
  service.process({'action':'toggle','id':f['id'],'enabled':True});self.assertNotIn('disabled',service.read_library()[0])
  with self.assertRaises(ValueError):service.process({'action':'toggle','id':'missing','enabled':False})
 def test_compiled_lisp_is_registered_with_clear_note(self):
  f=self.upload('tool.fas',b'\x00FAS4-FILE')
  self.assertTrue(f['compiled']);self.assertEqual(f['commands'],[]);self.assertIn('자체 엔진에서 실행할 수 없습니다',f['note'])
 def test_core_console_prologue_sets_secureload_explicitly(self):
  lines=service.console_prologue(Path('C:/tmp/code'),Path('C:/tmp/error.txt'))
  self.assertIn('(setvar "SECURELOAD" 1)',lines);self.assertLess(lines.index('(setvar "TRUSTEDPATHS" "C:/tmp/code")'),lines.index('(setvar "SECURELOAD" 1)'))
  self.assertFalse(any('SECURELOAD" 0' in line for line in lines))
 def test_invalid_names_and_duplicate(self):
  for name in ['../a.lsp','a.exe','CON.lsp','x/y.lsp']:
   with self.assertRaises(ValueError):self.upload(name,'(princ)')
  self.upload('a.lsp','(princ)')
  with self.assertRaises(ValueError):self.upload('A.lsp','(princ)')
 def test_status_lists_only_user_files_without_login(self):
  user=self.upload('user-tool.lsp','(defun c:USERTOOL () (princ))')
  with patch.object(service.parcel_service,'cookie',return_value=None),patch.object(service.parcel_service,'account_token',return_value=''):result=service.process({'action':'status'})
  self.assertFalse(result['loginRequired']);self.assertEqual(result['bundledCount'],0);self.assertEqual([f['id'] for f in result['files']],[user['id']])

@unittest.skipUnless(service.exchange.autocad_console(),'Installed AutoCAD required')
class RuntimeTest(LibraryTest):
 def run_lisp(self,source,command,inputs='',selected=None,expression=''):
  f=self.upload('실행.lsp',source);j=service.process({'action':'start','files':[f['id']],'command':command,'expression':expression,'inputs':inputs,'selected':selected or [],'activeLayer':'default','document':copy.deepcopy(MODEL)})
  end=time.monotonic()+30
  while time.monotonic()<end:
   time.sleep(.1);r=service.process({'action':'poll','id':j['id']})
   if r['state']!='running':return r
  service.process({'action':'cancel','id':j['id']});self.fail('Runtime did not complete')
 def test_real_circle_prompt_native_wall_and_layer_preserved(self):
  r=self.run_lisp('(defun c:TEST (/ p r) (setq p (getpoint "Center: ") r (getreal "Radius: ")) (entmakex (list (cons 0 "CIRCLE") (cons 10 p) (cons 40 r))) (princ))','TEST','100,200\n50')
  self.assertEqual(r['state'],'completed',r.get('error','')+'\n'+r['log']);d=r['result']['document'];self.assertEqual(r['result']['counts'],{'preserved':2,'changed':0,'added':1,'deleted':0});self.assertEqual(d['entities'][:2],MODEL['entities']);self.assertEqual(d['entities'][2]['center'],{'x':100,'y':200});self.assertEqual(next(l['name'] for l in d['layers'] if l['id']==d['entities'][2]['layer']),'LISP-TEST-CIRCLE');self.assertTrue(d['layers'][0]['building'])
 def test_preselection_entmod_and_command(self):
  r=self.run_lisp('(defun c:TEST (/ ss en ed) (setq ss (ssget "_I") en (ssname ss 0) ed (entget en)) (entmod (subst (cons 11 (list 2500 0 0)) (assoc 11 ed) ed)) (command "_.CIRCLE" (list 0 0) 100) (princ))','TEST',selected=['line'])
  self.assertEqual(r['state'],'completed',r.get('error','')+'\n'+r['log']);self.assertEqual(r['result']['counts']['changed'],1);e=r['result']['document']['entities'][0];self.assertEqual(e['id'],'line');self.assertEqual(e['points'][1]['x'],2500)
 def test_failed_lisp_does_not_return_applyable_result(self):
  r=self.run_lisp('(defun c:TEST () (undefined-function))','TEST');self.assertEqual(r['state'],'failed');self.assertNotIn('result',r)
 def test_unsupported_output_is_not_silently_applied(self):
  r=self.run_lisp('(defun c:TEST () (entmakex (list (cons 0 "3DFACE") (cons 10 (list 0 0 0)) (cons 11 (list 100 0 0)) (cons 12 (list 0 100 100)) (cons 13 (list 0 100 100)))) (princ))','TEST')
  self.assertEqual(r['state'],'completed',r.get('error','')+'\n'+r['log']);self.assertFalse(r['result']['canApply']);self.assertTrue(r['result']['skipped'])
 def test_real_lisp_expression(self):
  r=self.run_lisp('(princ)','',expression='(princ (+ 40 2))');self.assertEqual(r['state'],'completed',r.get('error'));self.assertIn('42',r['log']);self.assertEqual(r['result']['document'],MODEL);self.assertFalse(r['result']['canApply'])
 def test_layer_only_command_is_retained(self):
  r=self.run_lisp('(defun c:TEST () (command "_.-LAYER" "_M" "LISP_NEW" "") (princ))','TEST');self.assertEqual(r['state'],'completed',r.get('error'));self.assertTrue(r['result']['canApply']);self.assertTrue(any(l['name']=='LISP_NEW' for l in r['result']['document']['layers']))
 def test_new_block_is_individual_objects_on_dedicated_layers(self):
  source='(defun c:TEST () (entmake (list (cons 0 "BLOCK") (cons 2 "RESULT") (cons 70 0) (cons 10 (list 0 0 0)))) (entmake (list (cons 0 "LINE") (cons 10 (list 0 0 0)) (cons 11 (list 500 0 0)))) (entmake (list (cons 0 "CIRCLE") (cons 10 (list 200 200 0)) (cons 40 50))) (entmake (list (cons 0 "ENDBLK"))) (entmake (list (cons 0 "INSERT") (cons 2 "RESULT") (cons 10 (list 0 0 0)))) (princ))'
  r=self.run_lisp(source,'TEST');self.assertEqual(r['state'],'completed',r.get('error'));d=r['result']['document'];new=[e for e in d['entities'] if e['id'] not in {x['id'] for x in MODEL['entities']}];self.assertEqual({e['type'] for e in new},{'line','circle'});names={x['id']:x['name'] for x in d['layers']};self.assertEqual({names[e['layer']] for e in new},{'LISP-TEST-LINE','LISP-TEST-CIRCLE'});self.assertEqual(r['result']['counts']['added'],2)
 def test_cancel_infinite_loop(self):
  f=self.upload('loop.lsp','(defun c:LOOP () (while T))');j=service.process({'action':'start','files':[f['id']],'command':'LOOP','document':copy.deepcopy(MODEL)})
  time.sleep(1);service.process({'action':'cancel','id':j['id']})
  for i in range(100):
   time.sleep(.1);r=service.process({'action':'poll','id':j['id']})
   if r['state']!='running':break
  self.assertEqual(r['state'],'cancelled');self.assertNotIn('result',r)
if __name__=='__main__':unittest.main()
