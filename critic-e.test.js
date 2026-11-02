// 검토자(Opus) 지적 재현 · 실제 동작 검사 (t7 재시도 중복, 요청 스트림 왕복, 복구 세대 정책, 감시자, 대기열 안내)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createEngineApi,RETRY_ROUTES} from './studio.js';
import {documentRequestBody,createImportAssembler,watchImportQueue,receiveImportStream} from './import-stream.js';
import {createRecoveryStore,recoveryOffer,SESSION_GENERATIONS} from './drawing-tabs.js';
import {largeRecoveryPlan,MAX_BRIDGE_ENTITIES,LARGE_RECOVERY_INTERVAL_MS} from './bridge-client.js';
const require=createRequire(import.meta.url);
const {EngineSupervisor}=require('./desktop-lifecycle.cjs');

const statusResponse={ok:true,status:200,headers:{get:k=>k==='X-Barun-CAD'?'2':null},json:async()=>({token:'t'})};
test('t7: non-idempotent routes are never resent after a connection drop; idempotent ones are',async()=>{
 for(const route of ['miriboda','account','lisp','parcel','chat','project','tablet','convert','auto-plan']){
  const sent=[];let first=true;
  const fetch=async(url,opts)=>{if(url==='/api/status')return statusResponse;sent.push(url);if(first){first=false;throw new TypeError('Failed to fetch');}return {ok:true,status:200,headers:{get:()=>null},json:async()=>({ok:true})};};
  await assert.rejects(createEngineApi({fetch,sleep:async()=>{}}).api(route,{action:'send'}));
  assert.equal(sent.length,1,route+' was resent');assert.ok(!RETRY_ROUTES.has(route));
 }
 for(const route of ['restore','export','pdf','bridge','recovery']){
  const sent=[];let first=true;
  const fetch=async(url,opts)=>{if(url==='/api/status')return statusResponse;sent.push(url);if(first){first=false;throw new TypeError('Failed to fetch');}return {ok:true,status:200,headers:{get:()=>null},json:async()=>({ok:true})};};
  assert.deepEqual(await createEngineApi({fetch,sleep:async()=>{}}).api(route,{}),{ok:true});assert.equal(sent.length,2);
 }
});
test('large documents go out as NDJSON blobs that both the JS assembler and the Python engine rebuild',async()=>{
 const document={version:2,units:'mm',layers:[{id:'0'}],blocks:[{name:'B',entities:[{type:'line'}]}],entities:Array.from({length:5000},(_,i)=>({id:'e'+i,type:'line',layer:'0',points:[{x:i,y:0},{x:1,y:1}],text:'한글'})),sharedBlocks:{DOOR:{origin:{x:0,y:0},entities:[{type:'arc'}]}},dxfPreservation:{format:'dxf-zlib-v1',handles:['1'],version:'AC1032',data:'QUJD'.repeat(1000)}};
 const small=documentRequestBody({document:{entities:[{id:'a'}]},version:'R2018'});assert.equal(small.contentType,'application/json');assert.equal(small.streamed,false);
 const encoded=documentRequestBody({document,version:'R2018',targetPath:'C:/x.dxf'},{limit:100});
 assert.equal(encoded.streamed,true);assert.match(encoded.contentType,/x-ndjson/);
 const bytes=new Uint8Array(await encoded.body.arrayBuffer());
 const assembler=createImportAssembler();for(let i=0;i<bytes.length;i+=777)assembler.push(bytes.subarray(i,i+777));
 const result=assembler.finish();assert.equal(result.document.entities.length,5000);assert.deepEqual(result.report,{version:'R2018',targetPath:'C:/x.dxf'});assert.equal(result.document.dxfPreservation.data.length,4000);assert.equal(result.document.sharedBlocks.DOOR.entities.length,1);
 const tmp=path.join(os.tmpdir(),'barun-ndjson-'+process.pid+'.bin');fs.writeFileSync(tmp,bytes);
 try{
  const py=spawnSync(process.platform==='win32'?'python':'python3',['-c',`import import_stream,sys,json\nwith open(sys.argv[1],'rb') as f: r=import_stream.read_request(f,${bytes.length})\nprint(json.dumps({'n':len(r['document']['entities']),'blocks':len(r['document']['blocks']),'report':r['report'],'pres':len(r['document']['dxfPreservation']['data']),'text':r['document']['entities'][0]['text']},ensure_ascii=False))`,tmp],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  assert.equal(py.status,0,py.stderr);const parsed=JSON.parse(py.stdout.trim());
  assert.equal(parsed.n,5000);assert.equal(parsed.blocks,1);assert.deepEqual(parsed.report,{version:'R2018',targetPath:'C:/x.dxf'});assert.equal(parsed.pres,4000);assert.equal(parsed.text,'한글');
 }finally{fs.rmSync(tmp,{force:true});}
});
test('assembler rejects a stream whose end counts do not match (missing page)',()=>{
 const enc=new TextEncoder();
 const lines=[JSON.stringify({kind:'header',version:1,report:{},document:{},counts:{entities:20,blocks:0,sharedBlocks:0}}),JSON.stringify({kind:'entities',items:Array.from({length:10},(_,i)=>({id:i}))}),JSON.stringify({kind:'entities',items:Array.from({length:10},(_,i)=>({id:10+i}))})];
 const bytes=lines.reduce((sum,l)=>sum+enc.encode(l+'\n').length,0);
 const end=(count,n)=>JSON.stringify({kind:'end',lines:n,bytes,counts:{entities:count,blocks:0,sharedBlocks:0,preservationParts:0}});
 const good=createImportAssembler();good.push(enc.encode(lines.join('\n')+'\n'+end(20,3)+'\n'));assert.equal(good.finish().document.entities.length,20);
 const missing=createImportAssembler();missing.push(enc.encode([lines[0],lines[2]].join('\n')+'\n'+end(20,3)+'\n'));assert.throws(()=>missing.finish(),/불완전/);
});
test('engine api assembles an NDJSON restore response into {document,...fields}',async()=>{
 const enc=new TextEncoder();const text=[JSON.stringify({kind:'header',version:1,report:{folder:'F',commandSettings:{a:1}},document:{version:2},counts:{entities:1,blocks:0,sharedBlocks:0}}),JSON.stringify({kind:'entities',items:[{id:'z'}]})].join('\n')+'\n';
 const bytes=enc.encode(text);const endLine=JSON.stringify({kind:'end',lines:2,bytes:bytes.length,counts:{entities:1,blocks:0,sharedBlocks:0,preservationParts:0}})+'\n';
 const body=new Blob([bytes,enc.encode(endLine)]);
 const fetch=async(url)=>url==='/api/status'?statusResponse:{ok:true,status:200,headers:{get:k=>k==='Content-Type'?'application/x-ndjson; charset=utf-8':null},body:body.stream()};
 const saved=await createEngineApi({fetch,sleep:async()=>{}}).api('restore',{});
 assert.equal(saved.document.entities[0].id,'z');assert.equal(saved.folder,'F');assert.deepEqual(saved.commandSettings,{a:1});
});
test('t4 (IndexedDB policy): unsaved W1 survives a later launch that only viewed F2; only dirty sessions become generations; cap 3',async()=>{
 const memory=new Map();const store=createRecoveryStore({get:async k=>memory.get(k),put:async(k,v)=>{if(v===undefined)memory.delete(k);else memory.set(k,v);},keys:async()=>[...memory.keys()]},{now:(()=>{let t=0;return ()=>new Date(1000*(++t));})()});
 const ws=(name,dirty,n=1)=>({version:1,tabs:[{name,dirty,doc:{entities:Array.from({length:n},(_,i)=>({id:name+i}))}}]});
 // run1: W1 dirty then crash (current=W1)
 await store.write(ws('W1',true));
 // run2 fresh launch: preserve current (dirty) then user opens F2 (not dirty) and exits cleanly
 assert.equal(await store.preserveLastSession(await store.read()),true);await store.write(ws('F2',false));
 // run3 fresh launch: current=F2 not dirty → no generation, W1 stays
 assert.equal(recoveryOffer({saved:await store.read(),startFresh:true,closedCleanly:false}).action,'none');
 assert.equal(await store.preserveLastSession(await store.read()),false);
 assert.equal((await store.readLastSession()).tabs[0].name,'W1');
 for(const name of ['W2','W3','W4']){await store.write(ws(name,true));await store.preserveLastSession(await store.read());}
 const sessions=await store.listSessions();assert.equal(sessions.length,SESSION_GENERATIONS);
 assert.deepEqual(await Promise.all(sessions.map(async k=>memory.get(k).tabs[0].name)),['W4','W3','W2']);
 assert.equal((await store.readLastSession()).tabs[0].name,'W4');
});
test('supervisor watches an adopted engine and does not announce a restart for a failed first start',async()=>{
 const spawned=[];const spawn=()=>{const handlers=[];const worker={pid:500+spawned.length,exitCode:null,onExit:h=>handlers.push(h),kill(){},die(code){worker.exitCode=code;handlers.forEach(h=>h(code));}};spawned.push(worker);return worker;};
 const notices=[];const timers=[];
 let alive=true;
 const supervisor=new EngineSupervisor({spawn,waitReady:async()=>true,notify:n=>notices.push(n.state),delay:async()=>{},now:()=>1,setInterval:(fn,ms)=>{timers.push(fn);return 1;},clearInterval:()=>{timers.length=0;}});
 supervisor.adopt({pid:42,probe:async()=>({state:alive?'engine':'free'})});
 assert.equal(supervisor.pid,42);assert.equal(supervisor.ready,true);
 await timers[0]();assert.equal(spawned.length,0);   // 살아 있으면 그대로
 alive=false;await timers[0]();await supervisor.restarting;
 assert.equal(spawned.length,1);assert.equal(supervisor.pid,500);assert.deepEqual(notices,['restarting','ready']);
 // 첫 기동 실패: 종료 이벤트가 와도 재시작 알림을 내지 않고 start() 가 false 를 돌려준다
 const failNotices=[];const failing=new EngineSupervisor({spawn,waitReady:async worker=>{worker.die(3);return false;},notify:n=>failNotices.push(n.state),delay:async()=>{},now:()=>1});
 assert.equal(await failing.start(),false);await new Promise(r=>setImmediate(r));assert.deepEqual(failNotices,[]);
});
test('queue watcher reports waiting conversions and large-recovery plan respects interval/dirty/limit',async()=>{
 const seen=[];let calls=0;
 const stop=watchImportQueue({fetch:async()=>{calls++;return {json:async()=>({importQueue:{active:1,waiting:1,largeActive:1}})};},onProgress:p=>seen.push(p),intervalMs:5});
 await new Promise(r=>setTimeout(r,60));stop();
 assert.ok(calls>=2);assert.match(seen[0].stage,/서버 전체 처리 중 1건 · 대기 1건/);assert.doesNotMatch(seen[0].stage,/다른 도면.*기다리고/);assert.equal(seen[0].queue.waiting,1);
 assert.deepEqual(largeRecoveryPlan({count:10,revision:1,sentRevision:0,now:0,lastSentAt:-1}),{send:false});
 assert.deepEqual(largeRecoveryPlan({count:MAX_BRIDGE_ENTITIES+1,revision:1,sentRevision:0,now:0,lastSentAt:-1}),{send:true});
 assert.deepEqual(largeRecoveryPlan({count:MAX_BRIDGE_ENTITIES+1,revision:1,sentRevision:1,now:0,lastSentAt:-1}),{send:false});
 assert.deepEqual(largeRecoveryPlan({count:MAX_BRIDGE_ENTITIES+1,revision:2,sentRevision:1,now:1000,lastSentAt:0}),{send:false});
 assert.deepEqual(largeRecoveryPlan({count:MAX_BRIDGE_ENTITIES+1,revision:2,sentRevision:1,now:LARGE_RECOVERY_INTERVAL_MS,lastSentAt:0}),{send:true});
 assert.deepEqual(largeRecoveryPlan({count:MAX_BRIDGE_ENTITIES+1,revision:2,sentRevision:1,now:LARGE_RECOVERY_INTERVAL_MS,lastSentAt:0,dirty:false}),{send:false});
});
