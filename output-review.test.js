import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {runOutputCommand,installOutputTools,handleOutputRequest,createOutputCloseReservation} from './output-tools.js';

function setup(windows=[{id:1,drawings:[{id:'a',name:'가',active:true,dirty:false}]},{id:2,drawings:[{id:'b',name:'나',dirty:false}]}]){
 const calls=[],forms=[],after=[];
 const state={self:1,windows};
 const ctx={toast(){},userErrorMessage:e=>e.message,beforeOutput:async()=>calls.push('authorize'),form:(title,fields,apply,cancel)=>forms.push({title,fields,apply,cancel}),deferOutputClose:fn=>after.push(fn)};
 const desk={outputWindows:async()=>(calls.push('list'),state),cleanOutputWindows:async(ids,opts)=>(calls.push(['clean',ids,opts]),{results:[],failures:[]}),closeOutputWindows:async(ids,defer,options)=>(calls.push(['close',ids,defer,options]),{closed:['b'],dirty:[],failed:[],deferred:[]})};
 return {ctx,calls,forms,after,state,desk,window:{cadDesktop:desk,cad:{drawings:{list:()=>state.windows[0].drawings,active:()=>'a'}}}};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
const values=form=>Object.fromEntries(form.fields.map(f=>[f.name,f.value??'']));

test('AI의 MSL 전체와 QQ는 confirmAll 입력으로 화면 확인을 대신할 수 없다',async()=>{
 const saved=globalThis.window;
 try{for(const name of ['MSL','QQ']){
  const s=setup();globalThis.window=s.window;let done=false;
  const pending=runOutputCommand(s.ctx,name,{form:{scope:name==='MSL'?'all':'includeCurrent',confirmAll:true}}).then(r=>(done=true,r));
  await tick();assert.equal(s.forms.length,1,'실제 화면 확인창');assert.equal(done,false);assert.ok(!s.calls.some(c=>Array.isArray(c)));
  const form=s.forms[0];if(name==='MSL')assert.equal(form.fields.find(f=>f.name==='confirmAll').value,false);
  form.cancel();const result=await pending;assert.equal(result.applied,false);assert.equal(result.cancelled,true);
 }}finally{globalThis.window=saved;}
});

test('AI 권한이 없으면 도면 목록도 요청하지 않는다',async()=>{
 const saved=globalThis.window,s=setup();globalThis.window=s.window;s.ctx.beforeOutput=async()=>{throw Error('로그인 필요');};
 try{for(const name of ['MSL','QQ'])await assert.rejects(runOutputCommand(s.ctx,name),/로그인/);assert.deepEqual(s.calls,[]);}finally{globalThis.window=saved;}
});

test('한 칸의 두 도면도 MSL 전체 대상에 표시하고 다른 칸 확인을 요구하지 않는다',async()=>{
 const saved=globalThis.window,s=setup([{id:1,drawings:[{id:'a',name:'가',active:true},{id:'b',name:'나'}]}]);globalThis.window=s.window;
 try{await installOutputTools({...s.ctx,scripted:true}).MSL();const f=s.forms[0];assert.match(JSON.stringify(f.fields),/열린 도면 모두\(2장\)/);assert.ok(!f.fields.some(f=>f.name==='confirmAll'));await f.apply({...values(f),scope:'all'});assert.deepEqual(s.calls.find(c=>c[0]==='clean')[1],[1]);}finally{globalThis.window=saved;}
});

test('QQ 기본 범위는 현재 칸의 다른 탭도 대상으로 삼는다',async()=>{
 const saved=globalThis.window,s=setup([{id:1,drawings:[{id:'a',name:'가',active:true},{id:'b',name:'나'},{id:'c',name:'다',dirty:true}]}]);globalThis.window=s.window;
 try{await installOutputTools({...s.ctx,scripted:true}).QQ();assert.equal(s.forms.length,1);await s.forms[0].apply({scope:'excludeCurrent'});const c=s.calls.find(c=>c[0]==='close');assert.deepEqual(c[1],[1]);assert.deepEqual(c[3].targets.map(t=>t.id),['b','c']);}finally{globalThis.window=saved;}
});

test('QQ 지연 자기 닫기는 재인증 실패 후 닫기를 실행하지 않는다',async()=>{
 const saved=globalThis.window,s=setup();globalThis.window=s.window;let allowed=true;
 s.ctx.beforeOutput=async()=>{if(!allowed)throw Error('로그아웃');};
 s.desk.closeOutputWindows=async(ids,defer,options)=>{s.calls.push(['close',ids,defer,options]);return {closed:['b'],dirty:[],failed:[],deferred:[1],token:'lease'};};
 try{const pending=runOutputCommand(s.ctx,'QQ',{form:{scope:'includeCurrent'}});await tick();assert.equal(s.forms.length,1);s.forms[0].apply({scope:'includeCurrent'});const r=await pending;assert.equal(r.applied,true);assert.equal(s.after.length,1);allowed=false;await assert.rejects(s.after[0](),/로그아웃/);assert.equal(s.calls.filter(c=>c[0]==='close'&&c[1].length).length,1);assert.ok(s.calls.some(c=>c[0]==='close'&&c[3]?.cancel));}finally{globalThis.window=saved;}
});

test('QQ 최종 닫기 확인은 살아 있는 예약과 같은 도면·저장 상태가 필요하다',()=>{
 let timer;const engine={execute(){}},reservation=createOutputCloseReservation({engine,hold(){},release(){},schedule:fn=>(timer=fn),unschedule(){}});
 let state={busy:false,drawings:[{id:'a',dirty:false}]};
 const ctx={outputState:()=>state,outputReserve:r=>reservation.acquire(r),outputReservation:reservation};
 const r=handleOutputRequest(ctx,{id:7,operation:'can-close',options:{reserve:true,ids:['a']},expiresAt:Date.now()+1000});
 const confirm=()=>handleOutputRequest(ctx,{operation:'confirm-close',options:{lease:r.lease,ids:['a']},expiresAt:Date.now()+1000});
 assert.equal(confirm().safe,true);state={busy:false,drawings:[{id:'replacement',dirty:false}]};assert.equal(confirm().safe,false);
 state={busy:false,drawings:[{id:'a',dirty:true}]};assert.equal(confirm().safe,false);timer();state.drawings[0].dirty=false;assert.equal(confirm().safe,false);
});

test('앱 AI 출력 명령은 옵션을 전달하고 실제 적용 콜백을 승인 경계 안에서 실행한다',async()=>{
 const source=await readFile(new URL('./app.js',import.meta.url),'utf8');const a=source.indexOf('studio.context.runAICommand=async');const b=source.indexOf('studio.context.refreshLispLibrary',a);
 const seen=[],request={id:'request',args:{inputs:{form:{scope:'current',points:'no'}}}};
 const context={busy:false,restoringTabs:false,sceneRevision:1,documents:{activeId:'a'},engine:{doc:{}},resolveCommand:c=>c,settings:{},studio:{handlers:{},context:{authorizeAIRequest:async()=>seen.push('authorize')}},window:{cadDesktop:{}},commitAIChange:async(_c,_r,check,apply)=>{seen.push('commit');check();return apply();}};
 context.studio.context.runOutputCommand=async(_name,inputs,options)=>{assert.deepEqual(inputs,request.args.inputs);assert.equal(seen.length,0,'빈 사전 적용을 만들지 않는다');return options.commitOutput(()=>{seen.push('edit');return {applied:true};});};
 vm.runInNewContext(source.slice(a,b),context);const result=await context.studio.context.runAICommand('MSL',{request});assert.equal(result.applied,true);assert.deepEqual(seen,['commit','edit']);
});


test('MSL·QQ에서 실제 적용이 없으면 MCP 응답도 applied false이다',async()=>{
 const {createCommandRequestHandler}=await import('./bridge-client.js');const target={revision:1};
 const h=createCommandRequestHandler({engine:{doc:{entities:[]}},authorizeAIRequest:async()=>{},runOutputCommand:async()=>({applied:false,messages:[]})},{assert(){},current:()=>target},{});
 const result=await h({id:crypto.randomUUID(),expires_at:Date.now()+1000,action:'cad_run_command',args:{name:'QQ',target}});assert.equal(result.result.applied,false);
});


test('AI 현재 도면 MSL은 확인창 없이 옵션대로 편집하고 한 번에 되돌릴 수 있다',async()=>{
 const {DrawingEngine}=await import('./engine.js');const engine=new DrawingEngine(),layer=engine.doc.layers[0].id;engine.execute({type:'add',entity:{type:'point',layer,position:{x:0,y:0}}});const before=JSON.stringify(engine.doc),saved=globalThis.window,s=setup();globalThis.window=s.window;
 const ctx={...s.ctx,entities:()=>engine.doc.entities,layers:()=>engine.doc.layers,blocks:()=>[],activeLayer:()=>layer,execute:c=>engine.execute(c),refresh(){},commitOutput:async apply=>apply(),outputBatch:apply=>{engine.beginTransaction();try{const v=apply();engine.endTransaction();return v;}catch(e){engine.rollbackTransaction();throw e;}}};
 try{const result=await runOutputCommand(ctx,'MSL',{form:{scope:'current',purgeLayers:'no'}});assert.equal(result.applied,true);assert.equal(s.forms.length,0);assert.equal(engine.doc.entities.length,0);engine.execute({type:'undo'});assert.equal(JSON.stringify(engine.doc),before);}finally{globalThis.window=saved;}
});

test('서버가 결과를 거절하면 지연 닫기 승인을 요청하지 않고 대기를 취소한다',async()=>{
 const saved=globalThis.window,s=setup();globalThis.window=s.window;let authorized=0;s.ctx.beforeOutputClose=async()=>authorized++;
 s.desk.closeOutputWindows=async(ids,defer,options)=>{s.calls.push(['close',ids,defer,options]);return {closed:[],dirty:[],failed:[],deferred:[1],token:'one'};};
 try{const pending=runOutputCommand(s.ctx,'QQ',{form:{scope:'onlyCurrent'}});await tick();s.forms[0].apply({scope:'onlyCurrent'});const result=await pending;assert.equal(result.pending,1);assert.match(result.messages.at(-1),/닫기 대기 1개/);await s.after[0]({rejected:true});assert.equal(authorized,0);assert.equal(s.calls.filter(c=>c[0]==='close'&&c[1].length).length,1);assert.equal(s.calls.at(-1)[3].cancel,true);}finally{globalThis.window=saved;}
});

test('QQ 지연 닫기는 완료 후 전용 승인과 원래 대상 목록을 사용한다',async()=>{
 const saved=globalThis.window,s=setup();globalThis.window=s.window;let authorized=0;s.ctx.beforeOutputClose=async()=>authorized++;
 s.desk.closeOutputWindows=async(ids,defer,options)=>{s.calls.push(['close',ids,defer,options]);return {closed:[],dirty:[],failed:[],deferred:defer?[1]:[],token:'one'};};
 try{const pending=runOutputCommand(s.ctx,'QQ',{form:{scope:'includeCurrent'}});await tick();s.forms[0].apply({scope:'includeCurrent'});await pending;await s.after[0]();assert.equal(authorized,1);const closes=s.calls.filter(c=>c[0]==='close');assert.deepEqual(closes[1][3].targets,closes[0][3].targets);assert.equal(closes[1][3].previous.token,'one');}finally{globalThis.window=saved;}
});

test('실제 앱의 닫기 예약은 자기 예약을 작업중으로 오인하지 않고 기존 busy를 보존한다',async()=>{
 const source=await readFile(new URL('./app.js',import.meta.url),'utf8'),start=source.indexOf('const outputCloseReservation=createOutputCloseReservation'),end=source.indexOf('window.cadDesktop?.onOutputClosed',start);
 const state={engine:{execute(){}},busy:false,outputCloseHeld:false,restoringTabs:false,fileImportQueue:[],mode:'SELECT',document:{querySelector:()=>null},studio:{context:{isAIWorking:()=>true}},cardContext:{refresh(){}},documents:{tabs:[{id:'a',name:'가',dirty:false}],activeId:'a'},drawingOpenState:()=>({busy:true,drawings:[]}),createOutputCloseReservation,handleOutputRequest};
 state.window={cadDesktop:{onOutputReleased:fn=>state.release=fn,onOutputRequested:fn=>state.handle=fn}};
 vm.runInNewContext(source.slice(start,end),state);
 const request={id:31,operation:'can-close',options:{reserve:true,ids:['a']},allowAI:true,expiresAt:Date.now()+1000};const result=state.handle(request);assert.equal(result.safe,true);assert.equal(state.outputCloseHeld,true);assert.equal(state.busy,false);
 assert.equal(state.handle({...request,operation:'confirm-close',options:{lease:31,ids:['a']}}).safe,true);
 state.busy=true;state.release(31);assert.equal(state.busy,true);assert.equal(state.outputCloseHeld,false);
});


test('지연 QQ 뒤 자기 칸이 남아도 누적 최종 결과로 닫기 대기 안내를 바꾼다',async()=>{
 const saved=globalThis.window,s=setup(),toasts=[];globalThis.window=s.window;s.ctx.toast=text=>toasts.push(text);s.ctx.beforeOutputClose=async()=>{};
 s.desk.closeOutputWindows=async(_ids,defer)=>defer?{closed:['b'],dirty:[],failed:[],deferred:[1],token:'one'}:{requested:2,closed:['a','b'],dirty:[],failed:[],deferred:[]};
 try{const pending=runOutputCommand(s.ctx,'QQ',{form:{scope:'includeCurrent'}});await tick();s.forms[0].apply({scope:'includeCurrent'});await pending;assert.match(toasts.at(-1),/닫기 대기/);await s.after[0]();assert.match(toasts.at(-1),/2개를 닫았습니다/);assert.doesNotMatch(toasts.at(-1),/대기/);}finally{globalThis.window=saved;}
});


test('도면 목록이 아직 없는 칸 때문에 QQ의 준비된 도면까지 막히지 않는다',async()=>{
 const saved=globalThis.window,s=setup();s.state.windows.push({id:3,state:'loading',drawings:[]});globalThis.window=s.window;
 try{await installOutputTools({...s.ctx,scripted:true}).QQ();await s.forms[0].apply({scope:'includeCurrent'});const close=s.calls.find(c=>c[0]==='close');assert.deepEqual(close[1],[1,2]);assert.deepEqual(close[3].targets.map(t=>t.id),['a','b']);}finally{globalThis.window=saved;}
});


test('실제 폼에서 확인 오류 뒤 취소해도 AI 확인 대기가 끝난다',async()=>{
 const source=await readFile(new URL('./app.js',import.meta.url),'utf8'),start=source.indexOf('$('+'"property-form"'+').onsubmit ='),end=source.indexOf('function openArchitecturalDetail',start);
 const closeStart=source.indexOf("$('form-dialog').addEventListener('close',()=>{"),closeEnd=source.indexOf('function askLispInput',closeStart);
 const form={session:1,onCancel:()=>{cancelled=true;}},nodes={'property-form':{},'form-dialog':{open:true,addEventListener(_event,fn){this.onclose=fn;}},'form-error':{}};let cancelled=false;
 const context={form,$:id=>nodes[id],formApply(){throw Error('확인 필요');},FormData:class{*[Symbol.iterator](){}},userErrorMessage:e=>e.message,refresh(){},lispQuestions:{onDialogClose(){}},engine:{inTransaction:()=>false},safe:fn=>fn()};
 vm.runInNewContext(source.slice(start,end),context);vm.runInNewContext(source.slice(closeStart,closeEnd),context);
 await nodes['property-form'].onsubmit({preventDefault(){},target:{}});assert.equal(nodes['form-error'].textContent,'확인 필요');nodes['form-dialog'].open=false;nodes['form-dialog'].onclose();assert.equal(cancelled,true);
});

test('target 없는 앱 QQ도 전달 대기 중 현재 도면이 바뀌면 닫지 않는다',async()=>{
 const source=await readFile(new URL('./app.js',import.meta.url),'utf8'),a=source.indexOf('studio.context.runAICommand=async'),b=source.indexOf('studio.context.refreshLispLibrary',a);let options;
 const context={busy:false,restoringTabs:false,sceneRevision:1,documents:{activeId:'a'},engine:{doc:{}},resolveCommand:c=>c,settings:{},studio:{handlers:{},context:{authorizeAIRequest:async()=>{},authorizeOutputClose:async()=>{},runOutputCommand:async(_name,_inputs,o)=>{options=o;return {applied:true};}}},window:{cadDesktop:{}}};
 vm.runInNewContext(source.slice(a,b),context);await context.studio.context.runAICommand('QQ',{request:{id:'q',args:{}}});context.documents.activeId='b';await assert.rejects(options.beforeOutputClose(),/도면/);
});
