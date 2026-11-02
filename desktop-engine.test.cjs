// 5.0.4 안정성 검토 S1/S3/S4/S10/S12/S13/S15 · 데스크톱 셸 엔진 감시·포트 식별·스트림 조립
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const zlib=require('node:zlib');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {requestJson,createImportAssembler,probeEngine,selectEnginePort,SAFE_LINE_BYTES,HARD_LINE_BYTES}=require('./desktop-http.cjs');
const {EngineSupervisor,RotatingLog}=require('./desktop-lifecycle.cjs');

async function fixture(handler,run){
 const server=http.createServer(handler);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{return await run(`http://127.0.0.1:${server.address().port}`);}
 finally{await new Promise(resolve=>server.close(resolve));}
}
function ndjson(entities){
 const out=[JSON.stringify({kind:'header',version:1,report:{imported:entities},document:{version:2,units:'mm'},counts:{entities}})];
 for(let start=0;start<entities;start+=300)out.push(JSON.stringify({kind:'entities',items:Array.from({length:Math.min(300,entities-start)},(_,i)=>({id:'e'+(start+i),type:'line'}))}));
 out.push(JSON.stringify({kind:'preservationMeta',format:'dxf-zlib-v1'}),JSON.stringify({kind:'preservation',data:'AAAA'}),JSON.stringify({kind:'preservation',data:'BBBB'}),JSON.stringify({kind:'end'}));
 return Buffer.from(out.join('\n')+'\n');
}
test('main-process client assembles gzip NDJSON import streams line by line',async()=>{
 await fixture((_request,response)=>{const body=zlib.gzipSync(ndjson(2000));response.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Content-Encoding':'gzip','Content-Length':body.length});
  let offset=0;const tick=()=>{if(offset>=body.length)return response.end();response.write(body.subarray(offset,offset+777));offset+=777;setImmediate(tick);};tick();},
  async url=>{const result=await requestJson(url+'/api/import-path',{method:'POST',body:'{}'});assert.equal(result.ok,true);assert.equal(result.value.document.entities.length,2000);assert.equal(result.value.document.dxfPreservation.data,'AAAABBBB');assert.equal(result.value.report.imported,2000);});
 const assembler=createImportAssembler();const bytes=ndjson(50);for(let i=0;i<bytes.length;i+=3)assembler.push(bytes.subarray(i,i+3));assert.equal(assembler.finish().document.entities.length,50);
 assert.throws(()=>{const a=createImportAssembler();a.push(Buffer.alloc(HARD_LINE_BYTES+1,0x41));},/허용 크기/);
});
// 2026-10-27 맥판에서 ON·OPA·STL 로 DXF 를 고르면 '응답 형식을 알 수 없습니다' 로 멈췄다: 엔진이 맨 앞에 보내는 목차(index) 줄을 본체 쪽 조립기가 몰랐다.
test('main-process assembler accepts the engine index line',()=>{
 const out=[JSON.stringify({kind:'index',entities:1,layers:{},types:{line:1},bounds:null}),JSON.stringify({kind:'header',version:1,report:{imported:1},document:{version:2,units:'mm'}}),JSON.stringify({kind:'entities',items:[{id:'e0',type:'line'}]})];
 out.push(JSON.stringify({kind:'end',lines:3}));
 const a=createImportAssembler();a.push(Buffer.from(out.join('\n')+'\n'));
 assert.equal(a.finish().document.entities.length,1);
});
test('main-process client rejects a cut NDJSON stream',async()=>{
 await fixture((_request,response)=>{response.writeHead(200,{'Content-Type':'application/x-ndjson'});response.write(ndjson(10).subarray(0,120));response.end();},
  async url=>assert.rejects(requestJson(url,{timeoutMs:1000}),/중간에 끊겼|응답 형식/));
});
test('engine probe tells our engine apart from a foreign app answering 200',async()=>{
 await fixture((_request,response)=>{response.writeHead(200,{'Content-Type':'application/json'});response.end('{"foreign":true}');},async url=>assert.equal((await probeEngine(url)).state,'foreign'));
 await fixture((_request,response)=>{response.writeHead(200,{'Content-Type':'application/json','X-Barun-CAD':'2'});response.end(JSON.stringify({token:'t',pid:42}));},async url=>assert.deepEqual(await probeEngine(url),{state:'engine',status:200,token:'t',pid:42,version:undefined}));
 // 데스크톱 엔진은 토큰 없이 tokenPolicy 만 알린다 — 그래도 우리 엔진이다(토큰은 셸이 따로 안다).
 await fixture((_request,response)=>{response.writeHead(200,{'Content-Type':'application/json','X-Barun-CAD':'2'});response.end(JSON.stringify({tokenPolicy:'desktop',pid:7,version:3}));},async url=>assert.deepEqual(await probeEngine(url),{state:'engine',status:200,token:null,pid:7,version:3}));
 await fixture((_request,response)=>{response.writeHead(200,{'Content-Type':'application/json','X-Barun-CAD':'2'});response.end(JSON.stringify({pid:7}));},async url=>assert.equal((await probeEngine(url)).state,'foreign'));
 await fixture((_request,response)=>{response.writeHead(404);response.end();},async url=>assert.equal((await probeEngine(url)).state,'foreign'));
 assert.equal((await probeEngine('http://127.0.0.1:1')).state,'free');
});
test('port selection skips occupied ports, adopts a running engine and explains conflicts in Korean',async()=>{
 const states={18765:{state:'foreign',status:200},18865:{state:'free'},18965:{state:'engine',pid:7,token:'x'}};
 const probe=async port=>states[port];
 assert.deepEqual(await selectEnginePort([18765,18865,18965],{probe,isFree:async()=>true}),{port:18865,state:'free',conflicts:[{port:18765,state:'foreign',status:200}]});
 assert.equal((await selectEnginePort([18965,18865],{probe,isFree:async()=>true})).state,'engine');
 await assert.rejects(selectEnginePort([18765,18865],{probe,isFree:async()=>false}),error=>error.code==='PORT_CONFLICT'&&/포트 18765, 18865를 다른 프로그램이 사용 중/.test(error.message));
});
function fakeEngine(){const spawned=[];const spawn=()=>{const handlers=[];const worker={pid:100+spawned.length,exitCode:null,onExit:h=>handlers.push(h),kill(){},die(code){worker.exitCode=code;handlers.forEach(h=>h(code));}};spawned.push(worker);return worker;};return {spawned,spawn};}
test('engine supervisor restarts a crashed engine and tells the renderer',async()=>{
 const {spawned,spawn}=fakeEngine(),notices=[];
 const supervisor=new EngineSupervisor({spawn,waitReady:async()=>true,notify:n=>notices.push(n),delay:async()=>{},now:()=>1000});
 assert.equal(await supervisor.start(),true);assert.equal(supervisor.pid,100);
 spawned[0].die(1);await supervisor.restarting;
 assert.equal(spawned.length,2);assert.equal(supervisor.pid,101);assert.equal(supervisor.ready,true);
 assert.deepEqual(notices.map(n=>n.state),['restarting','ready']);assert.match(notices[1].message,/다시 시작했습니다/);
});
test('engine supervisor stops restarting after the limit and does not restart after stop()',async()=>{
 const {spawned,spawn}=fakeEngine(),notices=[];let clock=0;
 const supervisor=new EngineSupervisor({spawn,waitReady:async()=>true,notify:n=>notices.push(n),delay:async()=>{},now:()=>clock,maxRestarts:2,windowMs:1000});
 await supervisor.start();
 for(let i=0;i<3;i++){clock+=10;spawned.at(-1).die(9);await supervisor.restarting;}
 assert.equal(spawned.length,3);assert.equal(notices.at(-1).state,'failed');assert.match(notices.at(-1).message,/2번 연속/);
 assert.equal(supervisor.stop(),null);
 const fresh=new EngineSupervisor({spawn,waitReady:async()=>true,notify:n=>notices.push(n),delay:async()=>{},now:()=>clock});
 await fresh.start();fresh.stop();spawned.at(-1).die(1);await Promise.resolve();assert.equal(spawned.length,4);
});
test('rotating log keeps a bounded number of files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'barun-log-')),target=path.join(root,'logs','backend.log');
 try{const log=new RotatingLog({path:target,maxBytes:100,keep:2});for(let i=0;i<50;i++)log.line('line '+i+' '+'x'.repeat(20));
  assert.ok(fs.existsSync(target));assert.ok(fs.existsSync(target+'.1'));assert.ok(fs.existsSync(target+'.2'));assert.ok(!fs.existsSync(target+'.3'));assert.ok(fs.statSync(target).size<=140);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('desktop shell kills by PID only, logs the backend, handles renderer/main failures and fsyncs saves',()=>{
 const desktop=fs.readFileSync('desktop.cjs','utf8'),preload=fs.readFileSync('desktop-preload.cjs','utf8');
 assert.doesNotMatch(desktop,/taskkill',\['\/IM'/);assert.match(desktop,/'\/PID',String\(pid\)/);
 assert.match(desktop,/stdio:\['ignore','pipe','pipe'\]/);assert.match(desktop,/backend\.log/);
 assert.match(desktop,/render-process-gone/);assert.match(desktop,/unhandledRejection/);assert.match(desktop,/uncaughtException/);assert.match(desktop,/then\(watchUpdates\)\.catch/);
 // 임시 파일 동기화는 서버 한 곳에서 한다. 쓰기·닫기 뒤 요청하고, 백업·교체 전 동기화해야 한다.
 const save=desktop.slice(desktop.indexOf("ipcMain.handle('cad:save-file'"),desktop.indexOf('/* N1/1:'));
 const write=save.indexOf('handle.writeFile('),close=save.indexOf('handle.close()'),commit=save.indexOf("action:'commit'");
 assert.ok(write>=0&&close>write&&commit>close,'write and close must precede the server commit');
 const server=fs.readFileSync('server.py','utf8'),commitBranch=server.slice(server.indexOf("if action=='commit':"),server.indexOf("if action!='register':"));
 assert.match(commitBranch,/transaction'\]\.commit_temp\(/);
 const shared=fs.readFileSync('safe_writes.py','utf8'),start=shared.indexOf('    def _commit_temp('),transaction=shared.slice(start,shared.indexOf('    @_serialized',start));
 const opened=transaction.indexOf("temporary.open('r+b')"),sync=transaction.indexOf('os.fsync('),backup=transaction.indexOf('file_care.keep_previous('),replace=transaction.indexOf('os.replace(');
 assert.ok(opened>=0&&sync>opened&&backup>sync&&replace>backup,'temporary must be synced before backup and atomic replace');
 assert.match(desktop,/selectEnginePort\(portCandidates\(\)/);assert.match(desktop,/cad:engine-status/);assert.match(preload,/onEngineStatus/);
 assert.match(desktop,/found\.state==='engine'/);   // S4: 200 만으로 엔진이라 믿지 않는다
 assert.match(desktop,/maxBytes:2_000_000_000/);      // S1: 메인 경로도 600 MB 급 결과를 받는다
});
