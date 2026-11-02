// ACAD200 영역 8: 파일·호환·복구·자동화 — 항목별로 로직이 깨지면 실패하는 작은 시험
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createImportAssembler,receiveImportStream,indexSummary} from './import-stream.js';
import {createRecordCache,entityFingerprint} from './gpu-record-reuse.js';
import {needsVersionPreview,versionLossMessage,recoveryCandidate,recoverySummary,shouldAutoAudit,autoAuditNote,drawingThumbnail,parseScript,runScript,
  pdfLayerName,pdfLayerGroups,learnAutoCorrect,autoCorrected,createTypoLearner,mapServerPath,learnPathMapping,missingWindowsFolders,packManifest,packManifestText,readPathMap,writePathMap} from './file-care.js';
import {planAudit,auditReportText} from './drawing-cleanup.js';
import {largeRecoveryPlan,MAX_BRIDGE_ENTITIES,LARGE_RECOVERY_INTERVAL_MS} from './bridge-client.js';
import {usedFonts} from './file-care-commands.js';
import {runCli,parseCliScript} from './tools/barun-cad-cli.mjs';

const ndjson=records=>new TextEncoder().encode(records.map(r=>JSON.stringify(r)).join('\n')+'\n');
function stream(records){
  const lines=records.filter(r=>r.kind!=='end');
  const bytes=lines.reduce((sum,r)=>sum+new TextEncoder().encode(JSON.stringify(r)).length+1,0);
  return [...lines,{kind:'end',lines:lines.length,bytes,counts:{entities:lines.filter(r=>r.kind==='entities').reduce((n,r)=>n+r.items.length,0),blocks:0,sharedBlocks:0,preservationParts:0}}];
}

test('801 색인 줄은 객체보다 먼저 와서 바로 알리고, 색인 없는 옛 캐시도 그대로 받는다',async()=>{
  const index={kind:'index',entities:2,layers:{'0':1,'A-WALL':1},types:{line:2},bounds:[0,0,12000,8000],grid:{cols:8,rows:8,cells:Array(64).fill(0)}};
  const records=stream([{kind:'header',version:1,report:{},document:{units:'mm',layers:[]},counts:{entities:2,blocks:0,sharedBlocks:0}},index,{kind:'entities',items:[{id:'a'},{id:'b'}]}]);
  const seen=[];const assembler=createImportAssembler({onIndex:i=>seen.push(['index',i.entities])});
  const bytes=ndjson(records);
  assembler.push(bytes.subarray(0,bytes.indexOf(0x0a,bytes.indexOf(0x0a)+1)+1));   // 머리 + 색인까지만
  assert.deepEqual(seen,[['index',2]],'객체 줄이 오기 전에 색인을 알린다');
  assert.equal(assembler.progress.index,'객체 2개 · 레이어 2개 · 범위 약 12 × 8 m');
  assembler.push(bytes.subarray(bytes.indexOf(0x0a,bytes.indexOf(0x0a)+1)+1));
  const result=assembler.finish();assert.equal(result.document.entities.length,2);assert.equal(result.index.types.line,2);
  const old=createImportAssembler();old.push(ndjson(stream([records[0],records[2]])));assert.equal(old.finish().document.entities.length,2);
  const stages=[];const response={headers:new Map([['Content-Type','application/x-ndjson']]),body:{getReader(){let sent=false;return {read:async()=>sent?{done:true}:(sent=true,{done:false,value:bytes})};}}};
  response.headers.get=k=>response.headers.has(k)?Map.prototype.get.call(response.headers,k):null;
  const received=await receiveImportStream(response,{onProgress:p=>stages.push(p.stage)});
  assert.equal(received.report.transfer.indexed,true);assert.ok(stages[0].startsWith('도면 색인을 받았습니다'),stages[0]);
  assert.equal(indexSummary(null),'');
});

test('805 판 지문이 같으면 핸들+내용이 같은 객체만 다시 쓰고, 바뀐 것·핸들 없는 것만 새로 만든다',()=>{
  const cache=createRecordCache({rendererVersion:'gpu-1'});
  const a={id:'1',handle:'A1',type:'line',points:[{x:0,y:0},{x:1,y:0}]},b={id:'2',handle:'B2',type:'circle',center:{x:0,y:0},radius:5},c={id:'3',type:'line',points:[]};
  let plan=cache.plan([a,b,c]);assert.equal(plan.compile.length,3);
  for(const e of plan.compile)cache.store(e,'rec-'+e.id);
  assert.equal(cache.size,2,'핸들 없는 객체는 저장하지 않는다');
  const reopened=[{...a,id:'x1'},{...b,id:'x2',radius:6},{...c,id:'x3'}];   // 다시 열면 id 는 새로, b 만 바뀜
  plan=cache.plan(reopened);
  assert.deepEqual([...plan.reuse],[['x1','rec-1']]);assert.deepEqual(plan.compile.map(e=>e.id),['x2','x3']);
  assert.equal(entityFingerprint({...a,id:'zz'}),entityFingerprint(a),'id 는 지문에 들어가지 않는다');
  plan=cache.plan(reopened,{version:'gpu-2'});assert.equal(plan.reuse.size,0,'렌더러 판이 바뀌면 모두 버린다');assert.equal(cache.size,0);
});

test('806 구버전 저장만 미리 보고, 잃는 것이 있을 때만 한 번 더 묻는다',()=>{
  assert.equal(needsVersionPreview({format:'dxf',version:'2018'}),false);
  assert.equal(needsVersionPreview({format:'dxf',version:'2004'}),true);
  assert.equal(needsVersionPreview({format:'dwg',version:'2000',large:true}),false,'큰 도면은 변환을 두 번 돌리지 않는다');
  assert.equal(needsVersionPreview({format:'bcad',version:'2004'}),false);
  assert.equal(versionLossMessage({ok:true,lost:[]},{format:'dxf',version:'2004'}),'');
  assert.match(versionLossMessage({ok:true,lost:['구버전(2004) 저장: MULTILEADER 3개를 기본 객체로 바꿨습니다.']},{format:'dxf',version:'2004'}),/DXF 2004 로 저장하면 .*MULTILEADER 3개.*한 번 더/);
  assert.match(versionLossMessage({ok:false,blocked:'3DSOLID'},{format:'dwg',version:'2000'}),/DWG 2000 로는 저장할 수 없습니다: 3DSOLID/);
});

test('809 손상일 수 있는 실패만 복구 열기를 권하고, 결과를 한 줄로 알린다',()=>{
  assert.equal(recoveryCandidate('a.dwg',Error('DXF 구조를 읽거나 복구할 수 없습니다.')),true);
  assert.equal(recoveryCandidate('a.dwg',Error('1 GB 이하의 도면 파일만 열 수 있습니다.')),false);
  assert.equal(recoveryCandidate('a.bcad',Error('JSON')),false);
  assert.equal(recoveryCandidate('a.dxf',Error('Failed to fetch')),false);
  const line=recoverySummary({converter:'내장 DWG 엔진',imported:1200,skipped:{PROXY:3},recovery:{mode:'salvage',engine:'내장 DWG 엔진',imported:1200,auditErrors:4,auditFixes:2,skipped:{PROXY:3}}});
  assert.equal(line,'DWGRECOVER · 내장 DWG 엔진 · 살림 1,200개 · 감사 오류 4건 · 고침 2건 · 버림 PROXY 3개 · 원본 파일은 바꾸지 않았습니다');
  assert.equal(recoverySummary({}),'');
});

test('810 감사 보고서 글과 열 때 자동 감사(작은 도면만)',()=>{
  const doc={layers:[{id:'0',name:'0'}],blocks:[],entities:[{id:'a',type:'line',layer:'zz',points:[{x:0,y:0},{x:1,y:0}]},{id:'b',type:'line',layer:'0',points:[{x:2,y:2},{x:2,y:2}]},{id:'c',type:'block',name:'없는블록',layer:'0',entities:[]}]};
  const plan=planAudit(doc),text=auditReportText(plan,{name:'평면',when:new Date(2026,9,14)});
  assert.match(text,/바른 CAD 감사 보고서 · 평면/);assert.match(text,/없는 레이어 참조: 1개/);assert.match(text,/길이 0 선: 1개/);assert.match(text,/정의 없는 블록 없는블록: 1곳/);assert.match(text,/합계 2건/);
  assert.ok(text.includes('\r\n'),'메모장에서도 줄이 나뉘게 CRLF');
  assert.equal(shouldAutoAudit(10),true);assert.equal(shouldAutoAudit(50001),false);assert.equal(shouldAutoAudit(0),false);
  assert.match(autoAuditNote(plan),/고칠 문제 2건 · AUDIT/);assert.equal(autoAuditNote({problems:0}),'');
});

test('811 큰 도면 복구 전송은 명령 중·입력 직후면 미루고, 간격이 지난 뒤 첫 한가한 순간에 보낸다',()=>{
  const base={count:MAX_BRIDGE_ENTITIES+1,revision:2,sentRevision:1,now:LARGE_RECOVERY_INTERVAL_MS,lastSentAt:0};
  assert.deepEqual(largeRecoveryPlan(base),{send:true});
  assert.deepEqual(largeRecoveryPlan({...base,commandIdle:false}),{send:false,reason:'command'});
  assert.deepEqual(largeRecoveryPlan({...base,quiet:false}),{send:false,reason:'input'});
  assert.deepEqual(largeRecoveryPlan({...base,now:1000,quiet:false}),{send:false},'간격 전이면 이유 없이 그냥 안 보냄');
  assert.deepEqual(largeRecoveryPlan({...base,lastSentAt:-1,now:0}),{send:true},'처음 한 번은 바로');
});

test('815 미리보기 그림: 1비트 DIB, 선이 찍히고, 20만 객체도 2만 5천 개만 훑는다',()=>{
  const doc={entities:[{type:'line',points:[{x:0,y:0},{x:1000,y:1000}]},{type:'circle',center:{x:500,y:500},radius:200},{type:'text',position:{x:0,y:900},height:50,text:'평면'}]};
  const dib=drawingThumbnail(doc),view=new DataView(dib.buffer);
  assert.equal(view.getUint32(0,true),40);assert.equal(view.getInt32(4,true),256);assert.equal(view.getInt32(8,true),192);assert.equal(view.getUint16(14,true),1);
  assert.equal(dib.length,40+8+32*192);assert.ok(dib.subarray(48).some(byte=>byte!==0),'선 픽셀이 있다');
  let touched=0;const many={entities:Array.from({length:200000},(_,i)=>({get type(){touched++;return 'line';},points:[{x:i,y:0},{x:i,y:10}]}))};
  drawingThumbnail(many);assert.ok(touched<=25000*2,String(touched));
  assert.equal(drawingThumbnail({entities:[]}).subarray(48).every(byte=>byte===0),true,'빈 도면은 흰 그림');
});

test('818 스크립트: 공백·줄바꿈 하나가 Enter 하나, 주석·끝 빈 줄 처리, 멈춤·시간 초과',async()=>{
  assert.deepEqual(parseScript('; 주석\r\nLINE 0,0 100,0 \r\nZOOM E\r\n\r\n'),['LINE','0,0','100,0','','ZOOM','E']);
  assert.deepEqual(parseScript('\uFEFFCIRCLE 0,0 50\n\nERASE'),['CIRCLE','0,0','50','','ERASE'],'가운데 빈 줄은 Enter');
  const sent=[];await runScript(['A','','B'],{submit:t=>sent.push(t),waitIdle:()=>Promise.resolve()});assert.deepEqual(sent,['A','','B']);
  const controller=new AbortController();const out=[];
  await assert.rejects(runScript(['A','B','C'],{submit:t=>{out.push(t);if(t==='A')controller.abort();},waitIdle:()=>true,signal:controller.signal}),/중지했습니다 \(1\/3\)/);
  assert.deepEqual(out,['A']);
  await assert.rejects(runScript(['X'],{submit:()=>{},waitIdle:()=>new Promise(()=>{}),timeoutMs:20}),/1번째 입력 "X"/);
});

test('819 리습: 명령에 필요한 파일만(꼬리 물기·따옴표·문자열·최상위 식 파일), autoload 는 처음 부를 때 읽는다',async()=>{
  const {inspectFile,planRun,lispFilesFor,runNative}=await import('./lisp-panel.js');
  const {DrawingEngine}=await import('./engine.js');
  const files=[
    {name:'main.lsp',source:'(defun c:AA () (helper) (mapcar \'quoted (list 1)) (eval (read "(viastring)")) (princ "AA"))'},
    {name:'help.lsp',source:'(defun helper () (deeper))'},
    {name:'deep.lsp',source:'(defun deeper () 1)'},
    {name:'quote.lsp',source:'(defun quoted (x) x)'},
    {name:'str.lsp',source:'(defun viastring () 2)'},
    {name:'unrelated.lsp',source:'(defun c:ZZ () (princ "ZZ")) (defun other () 3)'},
    {name:'acaddoc.lsp',source:'(setq *mine* 1) (autoload "later.lsp" \'("LATER"))'},
    {name:'later.lsp',source:'(defun c:LATER () (princ "늦게 불림"))'},
  ].map(inspectFile);
  const plan=planRun(files,'AA');
  assert.deepEqual(lispFilesFor(plan.files,'AA').map(f=>f.name).sort(),['acaddoc.lsp','deep.lsp','help.lsp','main.lsp','quote.lsp','str.lsp']);
  assert.equal(lispFilesFor(plan.files,null).length,plan.files.length,'식 실행은 전부');
  assert.equal(lispFilesFor(plan.files,'NOPE').length,plan.files.length,'정의를 못 찾으면 전부');
  const model={...new DrawingEngine().doc},sources=files.map(({name,source})=>({name,source}));
  const later=planRun(files,'LATER');
  // LATER 는 later.lsp 를 싣지 않아도(acaddoc 의 autoload 만) 처음 부를 때 읽어 돈다
  const picked=lispFilesFor(later.files,'LATER').filter(f=>f.name!=='later.lsp');
  const r=runNative({files:picked,command:'LATER',snapshot:JSON.stringify(model),activeLayer:model.layers[0].name,sources});
  assert.match(r.output,/늦게 불림/);
  const ok=runNative({files:lispFilesFor(plan.files,'AA'),command:'AA',snapshot:JSON.stringify(model),activeLayer:model.layers[0].name,sources});
  assert.match(ok.output,/AA/);
});

test('820 PDF 레이어 이름: OCG 이름을 PDF- 레이어로, 없으면 PDF-IMPORT',()=>{
  assert.equal(pdfLayerName('벽체'),'PDF-벽체');assert.equal(pdfLayerName(''),'PDF-IMPORT');assert.equal(pdfLayerName('a/b:c'),'PDF-a_b_c');
  assert.deepEqual([...pdfLayerGroups([{pdfLayer:'벽'},{pdfLayer:'벽'},{}])],[['PDF-벽',2],['PDF-IMPORT',1]]);
});

test('821 같은 오타 뒤 같은 추천 명령을 3번 고르면 그다음부터 바로 고친다',()=>{
  let state={};let clock=0;const learner=createTypoLearner({now:()=>clock});
  for(let i=0;i<3;i++){learner.unknown('lien',['LINE','LIST']);clock+=1000;state=learner.ran('LINE',state);}
  assert.equal(autoCorrected(state,'LIEN'),'LINE');assert.equal(autoCorrected(state,' lien '),'LINE');
  learner.unknown('cirlce',['CIRCLE']);clock+=20000;state=learner.ran('CIRCLE',state);assert.equal(state.autoCorrectCounts['CIRLCE>CIRCLE'],undefined,'15초 넘으면 배우지 않는다');
  learner.unknown('xx',['LINE']);state=learner.ran('ZOOM',state);assert.equal(state.autoCorrectCounts['XX>ZOOM'],undefined,'추천에 없던 명령은 배우지 않는다');
  assert.equal(learnAutoCorrect({},'(+ 1 2)','LINE').autoCorrect,undefined,'식·공백 든 입력은 배우지 않는다');
});

test('822 경로 대응: 가장 긴 앞부분, 구분자 맞춤, 손으로 고친 경로에서 배우기, 깨진 윈도우 경로 모으기',()=>{
  const table={'\\\\192.168.0.10\\개발':'/Volumes/개발','\\\\192.168.0.10\\개발\\도면':'N:\\도면','D:\\어플':'/Users/me/dev'};
  assert.equal(mapServerPath('\\\\192.168.0.10\\개발\\현장\\참조',table),'/Volumes/개발/현장/참조');
  assert.equal(mapServerPath('\\\\192.168.0.10\\개발\\도면\\A동',table),'N:\\도면\\A동');
  assert.equal(mapServerPath('d:\\어플\\x',table),'/Users/me/dev/x');
  assert.equal(mapServerPath('E:\\없음',table),null);
  assert.deepEqual(learnPathMapping('\\\\192.168.0.10\\개발\\현장\\참조','N:\\현장\\참조'),['\\\\192.168.0.10\\개발','N:']);
  assert.equal(learnPathMapping('C:\\a','C:\\a'),null);
  const ents=[{xref:{folder:'D:\\참조'}},{xref:{folder:'d:\\참조'}},{xref:{folder:'/Volumes/개발'}},{xref:{folder:'..\\참조',relative:true}},{xref:{folder:'C:\\있음'}}];
  assert.deepEqual(missingWindowsFolders(ents,f=>f==='C:\\있음'),['d:\\참조']);
  const store=new Map();const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
  writePathMap({'X:':'Y:'},storage);assert.deepEqual(readPathMap(storage),{'X:':'Y:'});store.set('barun-xref-path-map','망가짐');assert.deepEqual(readPathMap(storage),{});
});

test('824 묶어 보내기 목록: 참조·그림·글꼴·리습과 빠진 것',()=>{
  const doc={entities:[{type:'block',xref:{name:'배치.dwg',folder:'N:\\현장'},entities:[{type:'image',source:'C:\\사진\\a.jpg'}]},{type:'text',sourceFont:'whgtxt.shx'}],blocks:[{entities:[{type:'image',path:'D:\\b.png'}]}]};
  assert.deepEqual(usedFonts(doc),['whgtxt.shx']);
  const m=packManifest(doc,{fonts:[{font:'whgtxt.shx'},{font:'회사체.ttf',fallback:true}],lispFiles:[{id:'1',name:'벽.lsp'}],drawingName:'평면'});
  assert.deepEqual(m.files.map(f=>f.to).sort(),['fonts/whgtxt.shx','images/a.jpg','images/b.png','lisp/벽.lsp','xref/배치.dwg']);
  assert.equal(m.missing.length,1);const text=packManifestText(m,{when:new Date(2026,9,14)});
  assert.match(text,/\[외부 참조 1개\]/);assert.match(text,/\[빠진 것 1개\]/);
});

test('817 화면 없는 실행: bcad 를 읽어 엔진 명령·건축 명령을 차례로 돌리고 저장한다',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'barun-cli-'));
  const input=path.join(dir,'in.bcad'),script=path.join(dir,'s.txt'),out=path.join(dir,'out.bcad');
  fs.copyFileSync('예제_6000x4000.bcad',input);
  fs.writeFileSync(script,'; 선 하나 추가\n!{"type":"add","entity":{"type":"line","points":[{"x":0,"y":0},{"x":100,"y":0}]}}\n\n');
  const before=JSON.parse(fs.readFileSync(input,'utf8')).entities.length;
  const logs=[];const summary=await runCli(['--in',input,'--script',script,'--out',out],{log:m=>logs.push(m)});
  assert.equal(summary.steps,1);assert.equal(JSON.parse(fs.readFileSync(out,'utf8')).entities.length,before+1);assert.match(logs[0],/2줄 !add: \+1/);
  assert.deepEqual(parseCliScript('D1 {"points":[[0,0]]}\n; x\n'),[{line:1,command:'D1',inputs:{points:[[0,0]]}}]);
  fs.writeFileSync(script,'NOSUCHCMD {}\n');
  await assert.rejects(runCli(['--script',script],{log:()=>{}}),/1줄 NOSUCHCMD 실패/);
  await assert.rejects(runCli(['--in','a.dwg','--script',script]),/\.bcad·\.json 도면만/);
});
