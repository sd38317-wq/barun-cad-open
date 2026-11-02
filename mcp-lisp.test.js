import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Worker} from 'node:worker_threads';
import {DrawingEngine} from './engine.js';
import {standardLayerForName} from './layer-standards.js';
import {createBridgeBinding} from './bridge-client.js';
import {createLispWorkerClient,createLispRequestHandler} from './mcp-lisp.js';
import {ARCHITECTURE_TOOL_GUIDE} from './ai-layer-policy.js';
import {EXAMPLE_LISP_NAME,EXAMPLE_LISP} from './lisp-panel.js';
// 동봉 리습은 2026-10-27 뺐다 — 예제(BCIRCLE 등)는 사용자가 등록한 파일로만 돈다.
const EXAMPLE={id:'example',name:EXAMPLE_LISP_NAME,source:EXAMPLE_LISP};

function harness(t,{library=[],runner:custom,lispContext={}}={}){
 const engine=new DrawingEngine(),selection=new Set();
 let drawing='A';
 const context={authorizeAIRequest:async()=>{},engine,selected:()=>selection,getDrawingId:()=>drawing,getActiveLayer:()=>engine.doc.layers[0].id,execute:c=>engine.execute(c),refresh(){}};
 const binding=createBridgeBinding(context),backend=crypto.randomUUID();
 const target=()=>{const v=binding.current(),target={...v,backend_generation:backend,snapshot_id:crypto.randomUUID()};binding.receive({protocol_version:1,backend_generation:backend,target});return target;};
 const runner=custom||createLispWorkerClient({makeWorker:()=>{
  const worker=new Worker(new URL('./test-fixtures/mcp-lisp/worker.mjs',import.meta.url));
  const adapter={postMessage:m=>worker.postMessage(m),terminate:()=>worker.terminate()};
  worker.on('message',data=>adapter.onmessage?.({data}));worker.on('error',error=>adapter.onerror?.(error));return adapter;
 }});
 t.after(()=>runner.reset());
 const api=async(_,{action,id})=>action==='status'?{files:library.map(({source,...f})=>f)}:action==='read'?{source:library.find(f=>f.id===id).source}:lispContext;
 const handler=createLispRequestHandler(context,binding,{api,runner});
 const request=(action,args={})=>{const bound=target();return {id:crypto.randomUUID(),action,args:{...args,target:bound,expectedRevision:bound.revision},expires_at:Date.now()+20000};};
 const call=(action,args)=>handler(request(action,args));
 return {engine,selection,binding,context,handler,request,call,switchDrawing:()=>{drawing='B';engine.execute({type:'new'});}};
}

test('외부 MCP 리습 계산 후 로그아웃·재로그인한 이전 세대 결과는 객체와 세션을 적용하지 않는다',async t=>{
 let release,commits=0,discarded=0,loggedIn=true;
 const runner={reset(){},run:()=>new Promise(r=>release=r),commit(){commits++;},discard(){discarded++;}};
 const h=harness(t,{runner});h.context.authorizeAIRequest=async()=>{if(!loggedIn)throw Error('로그인 세대가 바뀌었습니다.');};
 const pending=h.call('cad_lisp_run',{command:'BCIRCLE',inputs:[[0,0],10]});
 while(!release)await new Promise(r=>setTimeout(r,0));
 loggedIn=false;const document=structuredClone(h.engine.doc);document.entities.push({id:'stale',type:'circle',layer:document.layers[0].id,center:{x:0,y:0},radius:10});
 release({result:{document,changed:true}});const result=await pending;
 assert.match(result.error,/로그인 세대/);assert.equal(h.engine.doc.entities.length,0);assert.equal(h.engine.undoStack.length,0);assert.equal(commits,0);assert.equal(discarded,1);
});

test('등록한 BCIRCLE 예제를 기존 Worker로 실행하고 한 번에 되돌린다',async t=>{
 const h=harness(t,{library:[EXAMPLE]}),before=h.engine.undoStack.length;
 const result=await h.call('cad_lisp_run',{command:'BCIRCLE',inputs:[[100,200],50]});
 assert.equal(result.error,undefined,JSON.stringify(result));
 assert.equal(result.result.created,1);assert.equal(result.result.before_revision,0);assert.equal(result.result.after_revision,1);
 const circle=h.engine.doc.entities[0];assert.equal(circle.type,'circle');assert.deepEqual(circle.center,{x:100,y:200});assert.equal(circle.radius,50);
 assert.equal(h.engine.undoStack.length,before+1);h.engine.execute({type:'undo'});assert.equal(h.engine.doc.entities.length,0);
});

test('건축 도구 안내는 실제 대응 명령이 있는 리습에만 붙인다',async t=>{
 const dir=new URL('./examples/architecture-lisp/',import.meta.url);
 const library=fs.readdirSync(dir).filter(n=>n.endsWith('.lsp')).sort().map(name=>({id:name,name,source:fs.readFileSync(new URL(name,dir),'utf8')})).concat(EXAMPLE);
 const lispContext={rooms:"(setq br:rooms '((((0 0 0) (4000 0 0) (4000 3000 0) (0 3000 0)) 12000000 ())))"};
 const h=harness(t,{library,lispContext});
 for(const [command,inputs] of [['ROOM2',['거실','2000,1500']],['BCIRCLE',['0,0','100']]]){
  const out=await h.call('cad_lisp_run',{command,inputs});
  assert.equal(out.error,undefined,JSON.stringify(out));assert.ok(out.result.created>0);
  assert.ok(!out.result.warnings.includes(ARCHITECTURE_TOOL_GUIDE));
 }
 const layer=h.engine.doc.layers[0].id;
 h.engine.execute({type:'add',entity:{id:'wall',type:'line',layer,points:[{x:0,y:0},{x:4000,y:0}]}});
 const out=await h.call('cad_lisp_run',{command:'DOOR2',inputs:['900','2000,0','2000,0','왼쪽']});
 assert.equal(out.error,undefined,JSON.stringify(out));assert.ok(out.result.created>0);
 assert.ok(out.result.warnings.includes(ARCHITECTURE_TOOL_GUIDE));
});

test('등록 LSP·선택·순서 입력과 princ 출력',async t=>{
 const source=`(defun c:MARK (/ ss p) (setq ss (ssget) p (getpoint)) (princ (sslength ss)) (entmake (list '(0 . "POINT") (cons 10 p))))`;
 const h=harness(t,{library:[{id:'registered',name:'mark.lsp',source}]});
 h.engine.execute({type:'add',entity:{id:'chosen',type:'circle',layer:h.engine.doc.layers[0].id,center:{x:0,y:0},radius:10}});
 h.selection.add('chosen');
 const out=await h.call('cad_lisp_run',{command:'MARK',inputs:[[10,20]]});
 assert.equal(out.error,undefined,JSON.stringify(out));assert.equal(out.result.created,1);assert.match(out.result.output,/1/);
});

test('source만 로드하고 다음 호출에서 정의·전역 상태를 유지하며 최상위 그리기를 반복하지 않는다',async t=>{
 const h=harness(t),source=`(setq n 0) (entmake '((0 . "POINT") (10 1 2 0))) (defun c:COUNT () (setq n (1+ n)) (princ n))`;
 const loaded=await h.call('cad_lisp_load',{name:'counter.lsp',source});
 assert.equal(loaded.error,undefined,JSON.stringify(loaded));assert.equal(loaded.result.created,1);assert.deepEqual(loaded.result.commands,['COUNT']);
 for(const n of [1,2]){
  const out=await h.call('cad_lisp_run',{command:'COUNT'});
  assert.equal(out.error,undefined,JSON.stringify(out));assert.equal(out.result.output,String(n));assert.equal(out.result.created,0);
 }
 assert.equal(h.engine.doc.entities.length,1);
});

test('입력 부족과 로드 중 입력은 즉시 오류로 끝내며 부분 도형을 적용하지 않는다',async t=>{
 const h=harness(t),source=`(defun c:NEED () (princ "before") (entmake '((0 . "POINT") (10 0 0 0))) (getpoint "Pick second"))`;
 let out=await h.call('cad_lisp_load',{source,command:'NEED'});
 assert.match(out.error,/입력 필요:/);assert.equal(out.error_data.code,'input_required');assert.match(out.error_data.output,/before/);assert.equal(out.error_data.created,0);
 assert.equal(h.engine.doc.entities.length,0);assert.equal(h.engine.undoStack.length,0);
 out=await h.call('cad_lisp_load',{source:`(getpoint "Load point")`});
 assert.match(out.error,/입력 필요:/);assert.equal(h.engine.undoStack.length,0);
});

test('실행 오류 원문·출력을 보존하고 함수/전역 상태도 원상복구한다',async t=>{
 const h=harness(t);
 await h.call('cad_lisp_load',{name:'ok.lsp',source:`(setq n 5) (defun c:READN () (princ n))`});
 const out=await h.call('cad_lisp_load',{name:'bad.lsp',source:`(setq n 99) (defun c:BAD () (princ "raw") (/ 1 0))`,command:'BAD'});
 assert.match(out.error,/0으로 나눌/);assert.equal(out.error_data.output,'raw');assert.equal(out.error_data.before_revision,out.error_data.after_revision);
 const next=await h.call('cad_lisp_run',{command:'READN'});assert.equal(next.result.output,'5');
 const absent=await h.call('cad_lisp_run',{command:'BAD'});assert.match(absent.error,/정의한 리습 파일이 없습니다/);
});

test('파일·셸·외부 실행을 허용하지 않는다',async t=>{
 const h=harness(t);
 for(const expr of ['(open "C:/secret.txt" "w")','(startapp "cmd.exe")','(command "SHELL" "cmd.exe")']){
  const out=await h.call('cad_lisp_load',{source:'(defun c:ESCAPE () '+expr+')',command:'ESCAPE'});
  assert.ok(out.error,expr);assert.equal(h.engine.doc.entities.length,0);
 }
});

test('무한 반복은 기존 엔진 시간 제한으로 끊고 도면을 보존한다',async t=>{
 const h=harness(t),before=Date.now();
 const out=await h.call('cad_lisp_load',{source:`(defun c:LOOP () (entmake '((0 . "POINT") (10 0 0 0))) (while T))`,command:'LOOP',timeout_ms:100});
 assert.match(out.error,/시간|반복/);assert.ok(Date.now()-before<3000);assert.equal(h.engine.doc.entities.length,0);
});

test('응답 없는 Worker를 종료하고 세션을 재설정한다',async()=>{
 let terminated=0;
 const runner=createLispWorkerClient({makeWorker:()=>{const w={postMessage(){},terminate(){terminated++;}};queueMicrotask(()=>w.onmessage({data:{ready:true}}));return w;}});
 await assert.rejects(runner.run({id:crypto.randomUUID(),timeLimitMs:1}),e=>e.sessionReset&&e.code==='lisp_timeout');
 assert.equal(terminated,1);
});

test('중복 요청은 재실행하지 않고 같은 ID의 다른 내용은 거절한다',async t=>{
 const h=harness(t,{library:[EXAMPLE]}),req=h.request('cad_lisp_run',{command:'BCIRCLE',inputs:[[0,0],20]});
 const first=await h.handler(req),again=await h.handler(req);assert.deepEqual(again,first);assert.equal(h.engine.doc.entities.length,1);
 const altered=await h.handler({...req,args:{...req.args,inputs:[[0,0],50]}});assert.match(altered.error,/reused/);assert.equal(h.engine.doc.entities.length,1);
});

test('계산 중 도면 전환·리비전 변경·만료는 결과와 정의를 적용하지 않는다',async t=>{
 let finish;
 const runner={reset(){},commit(){assert.fail('must not commit');},discard(){},run:()=>new Promise(resolve=>finish=resolve)};
 const h=harness(t,{runner}),req=h.request('cad_lisp_load',{source:`(defun c:X () (princ))`});
 const pending=h.handler(req);
 while(!finish)await new Promise(r=>setImmediate(r));
 h.engine.execute({type:'add',entity:{type:'circle',layer:h.engine.doc.layers[0].id,center:{x:0,y:0},radius:1}});
 finish({id:req.id,result:{document:h.engine.doc,changed:false}});
 const out=await pending;assert.match(out.error,/target changed/);assert.equal(h.engine.doc.entities.length,1);
});

test('도면을 바꾸면 이전 도면의 세션 리습은 보이지 않는다',async t=>{
 const h=harness(t);
 await h.call('cad_lisp_load',{source:`(defun c:ONLYHERE () (princ "here"))`});
 h.switchDrawing();
 const out=await h.call('cad_lisp_run',{command:'ONLYHERE'});assert.match(out.error,/정의한 리습 파일이 없습니다/);
});

test('BRX 함수 호환: 닫힌 직교·회전 사각 LWPOLYLINE마다 중앙 X 두 선, 전체 한 Undo',async t=>{
 const h=harness(t),layer=h.engine.doc.layers[0].id;
 const rings=[
  {id:'r1',points:[[0,0],[40,0],[40,20],[0,20]],closed:true},
  {id:'r2',points:[[100,100],[140,140],[120,160],[80,120]],closed:true},
  {id:'open',points:[[200,0],[240,0],[240,20],[200,20]],closed:false},
  {id:'skew',points:[[300,0],[340,0],[350,20],[300,20]],closed:true}
 ];
 for(const ring of rings)h.engine.execute({type:'add',entity:{...ring,type:'polyline',layer,points:ring.points.map(([x,y])=>({x,y}))}});
 const before=h.engine.undoStack.length,source=fs.readFileSync(new URL('./test-fixtures/mcp-lisp/brx-compat.lsp',import.meta.url),'utf8');
 const out=await h.call('cad_lisp_load',{name:'brx.lsp',source,command:'BRX',selection:rings.map(r=>r.id)});
 assert.equal(out.error,undefined,JSON.stringify(out));assert.equal(out.result.created,4);assert.match(out.result.output,/4/);
 const lines=h.engine.doc.entities.filter(e=>e.type==='line');assert.equal(lines.length,4);
 for(const [i,center] of [[0,[20,10]],[2,[110,130]]]){
  for(const line of lines.slice(i,i+2)){
   assert.ok(Math.abs((line.points[0].x+line.points[1].x)/2-center[0])<1e-6);
   assert.ok(Math.abs((line.points[0].y+line.points[1].y)/2-center[1])<1e-6);
  }
 }
 assert.equal(h.engine.undoStack.length,before+1);h.engine.execute({type:'undo'});assert.equal(h.engine.doc.entities.length,4);
});

test('세션의 긴 Cons 전역 목록도 스택 넘침 없이 다음 호출에 유지된다',async t=>{
 const h=harness(t);
 const loaded=await h.call('cad_lisp_load',{source:'(setq xs nil) (repeat 10000 (setq xs (cons 1 xs))) (defun c:CNT () (princ (length xs)))'});
 assert.equal(loaded.error,undefined,JSON.stringify(loaded));
 const out=await h.call('cad_lisp_run',{command:'CNT'});
 assert.equal(out.error,undefined,JSON.stringify(out));assert.equal(out.result.output,'10000');
});

test('BridgeSuspend 건축 명령도 입력 부족의 종류와 앞선 출력을 보존한다',async t=>{
 const h=harness(t);
 const out=await h.call('cad_lisp_load',{source:'(defun c:NEEDCARD () (princ "before") (command "D1"))',command:'NEEDCARD'});
 assert.match(out.error,/입력 필요:/);assert.equal(out.error_data.code,'input_required');assert.equal(out.error_data.output,'before');
 assert.ok(out.error_data.ask.what);assert.equal(h.engine.doc.entities.length,0);
});

test('같은 이름 소스를 명시적으로 다시 로드하면 초기화 식도 다시 실행된다',async t=>{
 const h=harness(t),source='(setq n 0) (defun c:TICK () (setq n (1+ n)) (princ n))';
 await h.call('cad_lisp_load',{name:'reload.lsp',source});
 assert.equal((await h.call('cad_lisp_run',{command:'TICK'})).result.output,'1');
 await h.call('cad_lisp_load',{name:'reload.lsp',source});
 assert.equal((await h.call('cad_lisp_run',{command:'TICK'})).result.output,'1');
});

// 앱 요청만 중지 epoch를 검사하며 외부 MCP 요청은 영향을 받지 않는다.
test('앱 중지 뒤 늦게 완료된 리습은 도면에 적용하지 않는다',async t=>{
 let finish,started;const ready=new Promise(r=>started=r),runner={reset(){},discard(){},commit(){},run:async()=>{started();return new Promise(r=>finish=r);}};
 const h=harness(t,{runner});let cancelled=false;
 h.context.assertAIRequest=request=>{if(request.args._app_epoch!==undefined&&cancelled)throw Error('AI 요청 중지');};
 const r=h.request('cad_lisp_load',{source:'(princ)',_app_epoch:1}),pending=h.handler(r);await ready;cancelled=true;
 const document=structuredClone(h.engine.doc);document.entities.push({id:'late',type:'circle',layer:document.layers[0].id,center:{x:0,y:0},radius:10});
 finish({result:{document,changed:true}});const result=await pending;
 assert.match(result.error,/중지/);assert.equal(h.engine.doc.entities.length,0);assert.equal(h.engine.undoStack.length,0);
});

const freePoint="(defun c:FREEPOINT () (entmake '((0 . \"POINT\") (10 10 20 0))))";
test('AI 작성 리습 미지정은 현재 0/기본에 그리며 경고하고 자동 변경하지 않는다',async t=>{
 for(const name of ['0','기본']){
  const h=harness(t);h.engine.doc.layers[0].name=name;
  const out=await h.call('cad_lisp_load',{source:freePoint,command:'FREEPOINT'});
  assert.equal(out.error,undefined,JSON.stringify(out));assert.equal(h.engine.doc.entities[0].layer,h.engine.doc.layers[0].id);
  assert.match(out.result.warnings.join(' '),/세트 밖/);assert.ok(!out.result.warnings.includes(ARCHITECTURE_TOOL_GUIDE));
 }
});
test('cad_lisp_load/run의 layer와 purpose는 Worker 현재 레이어에 전달되고 생성·Undo 된다',async t=>{
 const h=harness(t),before=structuredClone(h.engine.doc);
 let out=await h.call('cad_lisp_load',{source:freePoint,command:'FREEPOINT',layer:'A-DETL'});
 assert.equal(out.error,undefined,JSON.stringify(out));
 const layer=h.engine.doc.layers.find(l=>l.name==='A-DETL'),standard=standardLayerForName('A-DETL');
 for(const key of ['color','label','description','linetype','lineweight'])assert.deepEqual(layer[key],standard[key]);
 assert.equal(h.engine.doc.entities[0].layer,layer.id);assert.ok(!out.result.warnings.some(w=>w.includes('세트 밖')));
 h.engine.execute({type:'undo'});assert.deepEqual(h.engine.doc,before);
 out=await h.call('cad_lisp_run',{command:'FREEPOINT',purpose:'wall'});assert.equal(out.error,undefined,JSON.stringify(out));
 assert.equal(h.engine.doc.layers.find(l=>l.id===h.engine.doc.entities[0].layer).name,'A-WALL');
});
test('setvar CLAYER와 entmake 그룹 8은 없는 A- 표준을 표준 속성으로 만들고 명시적 그룹 8은 보존한다',async t=>{
 const h=harness(t),source="(setvar \"CLAYER\" \"A-DETL\") (entmake '((0 . \"POINT\") (10 1 2 0))) (entmake '((0 . \"POINT\") (8 . \"A-SITE-TEXT\") (10 3 4 0)))";
 const out=await h.call('cad_lisp_load',{source,layer:'A-DOOR'});assert.equal(out.error,undefined,JSON.stringify(out));
 assert.deepEqual(h.engine.doc.entities.map(e=>h.engine.doc.layers.find(l=>l.id===e.layer).name),['A-DETL','A-SITE-TEXT']);
 for(const name of ['A-DETL','A-SITE-TEXT']){const layer=h.engine.doc.layers.find(l=>l.name===name),standard=standardLayerForName(name);for(const key of ['color','label','description','linetype'])assert.deepEqual(layer[key],standard[key]);}
});
test('리습 실패는 요청한 새 표준 레이어도 도면에 남기지 않는다',async t=>{
 const h=harness(t),before=structuredClone(h.engine.doc);
 const out=await h.call('cad_lisp_load',{source:'(setvar "CLAYER" "A-DETL") (/ 1 0)',layer:'A-SITE-TEXT'});
 assert.ok(out.error);assert.deepEqual(h.engine.doc,before);assert.equal(h.engine.undoStack.length,0);
});

test('선택집합 조회 색인은 MCP 세션 사본과 연속 호출 사이에 안전하게 다시 만든다',async t=>{
 const h=harness(t);h.engine.execute({type:'add',entity:{id:'saved',type:'circle',layer:h.engine.doc.layers[0].id,center:{x:0,y:0},radius:1}});
 const loaded=await h.call('cad_lisp_load',{source:'(setq s (ssget "_X") a (ssname s 0)) (ssmemb a s) (defun c:HAS () (princ (if (ssmemb a s) "ok" "missing")))'});
 assert.equal(loaded.error,undefined,JSON.stringify(loaded));
 for(let n=0;n<3;n++){const out=await h.call('cad_lisp_run',{command:'HAS'});assert.equal(out.error,undefined,JSON.stringify(out));assert.equal(out.result.output,'ok');}
});
