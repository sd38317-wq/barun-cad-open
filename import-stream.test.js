import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import {createImportAssembler,receiveImportStream,importSizeNotice,SAFE_LINE_BYTES,HARD_LINE_BYTES,watchImportQueue} from './import-stream.js';

test('queue status does not call the current active import an earlier drawing',async()=>{
 let stop;
 try{
  const progress=await new Promise(resolve=>{stop=watchImportQueue({intervalMs:1,fetch:async()=>({json:async()=>({importQueue:{active:1,waiting:0,largeActive:1}})}),onProgress:resolve});});
  // 내 도면 하나만 변환 중이면 대기 현황을 붙이지 않는다(대기가 있을 때만 critic-e 가 보는 개수 표시).
  assert.equal(progress.stage,'도면을 읽고 변환하고 있습니다.');
  assert.doesNotMatch(progress.stage,/다른 도면|앞선 변환|기다리고/);
 }finally{stop?.();}
});

test('stopping queue watch suppresses progress from an in-flight status response',async()=>{
 let finish,started;
 const active=new Promise(resolve=>{started=resolve;});
 const response=new Promise(resolve=>{finish=resolve;});
 const messages=[];
 const stop=watchImportQueue({intervalMs:1,fetch:async()=>{started();return response;},onProgress:p=>messages.push(p)});
 await active;stop();finish({json:async()=>({importQueue:{active:1,waiting:0,largeActive:1}})});
 await new Promise(resolve=>setTimeout(resolve,5));
 assert.deepEqual(messages,[]);
});

const encoder=new TextEncoder();
function lines(entities,{pageSize=1000,preservationParts=3}={}){
 const out=[JSON.stringify({kind:'header',version:1,report:{imported:entities},document:{version:2,units:'mm',layers:[{id:'a'}]},counts:{entities,blocks:1,sharedBlocks:1},preservation:true})];
 for(let start=0;start<entities;start+=pageSize)out.push(JSON.stringify({kind:'entities',items:Array.from({length:Math.min(pageSize,entities-start)},(_,i)=>({id:'e'+(start+i),type:'line',layer:'a',points:[{x:start+i,y:0},{x:1,y:1}],text:'한글'}))}));
 out.push(JSON.stringify({kind:'blocks',items:[{name:'B',entities:[]}]}));
 out.push(JSON.stringify({kind:'sharedBlock',name:'DOOR',origin:{x:0,y:0},part:0,last:false,entities:[{type:'line'}]}));
 out.push(JSON.stringify({kind:'sharedBlock',name:'DOOR',origin:{x:0,y:0},part:1,last:true,entities:[{type:'arc'}]}));
 out.push(JSON.stringify({kind:'preservationMeta',format:'dxf-zlib-v1',handles:['1'],version:'AC1032'}));
 for(let i=0;i<preservationParts;i++)out.push(JSON.stringify({kind:'preservation',data:'AB'.repeat(500)}));
 out.push(JSON.stringify({kind:'end'}));
 return out.join('\n')+'\n';
}
test('assembler rebuilds the document from lines split at arbitrary byte boundaries',()=>{
 const text=lines(2500,{pageSize:700}),bytes=encoder.encode(text);
 for(const chunk of [1,7,64,1000,bytes.length]){
  const assembler=createImportAssembler();
  for(let start=0;start<bytes.length;start+=chunk)assembler.push(bytes.subarray(start,start+chunk));
  const result=assembler.finish();
  assert.equal(result.document.entities.length,2500);assert.equal(result.document.entities[2499].id,'e2499');assert.equal(result.document.entities[0].text,'한글');
  assert.deepEqual(result.document.blocks,[{name:'B',entities:[]}]);assert.deepEqual(result.document.sharedBlocks.DOOR.entities,[{type:'line'},{type:'arc'}]);
  assert.equal(result.document.dxfPreservation.data.length,3000);assert.equal(result.document.dxfPreservation.version,'AC1032');
  assert.equal(result.report.imported,2500);assert.ok(result.stats.maxLineBytes<SAFE_LINE_BYTES);assert.equal(result.document.layers[0].id,'a');
 }
});
test('assembler refuses cut streams and oversized lines',()=>{
 const cut=createImportAssembler();cut.push(encoder.encode(lines(10).split('\n').slice(0,2).join('\n')+'\n'));
 assert.throws(()=>cut.finish(),/중간에 끊겼/);
 const big=createImportAssembler();
 assert.throws(()=>{for(let i=0;i<HARD_LINE_BYTES/(8*1024*1024)+1;i++)big.push(new Uint8Array(8*1024*1024).fill(0x41));},/허용 크기/);
});
test('receiveImportStream reads a gzip NDJSON HTTP response and reports progress; JSON errors still parse',async()=>{
 const server=http.createServer((request,response)=>{
  if(request.url==='/error'){response.writeHead(400,{'Content-Type':'application/json'});response.end(JSON.stringify({error:'변환 실패'}));return;}
  const body=zlib.gzipSync(Buffer.from(lines(3000,{pageSize:250})));
  response.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Content-Encoding':'gzip','Content-Length':body.length,'X-Barun-Import-Cache':'miss'});
  let offset=0;const tick=()=>{if(offset>=body.length){response.end();return;}response.write(body.subarray(offset,offset+4096));offset+=4096;setImmediate(tick);};tick();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base=`http://127.0.0.1:${server.address().port}`,progress=[];
  const result=await receiveImportStream(await fetch(base+'/import'),{onProgress:p=>progress.push(p)});
  assert.equal(result.document.entities.length,3000);assert.equal(result.report.transfer.format,'ndjson');assert.ok(result.report.transfer.maxLineBytes<SAFE_LINE_BYTES);
  assert.equal(progress.at(-1).percent,1);assert.equal(progress.at(-1).expected,3000);
  const failure=await receiveImportStream(await fetch(base+'/error'));assert.equal(failure.error,'변환 실패');
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('size notice warns before large drawings open',()=>{
 assert.match(importSizeNotice({bytes:104*1048576}),/대용량 도면 104 MB/);
 assert.match(importSizeNotice({entities:231813}),/231,813/);
 assert.equal(importSizeNotice({bytes:1048576}),'');
});

test('document weight counts objects inside blocks so a 44k-top / 210k-total drawing is heavy',async()=>{
 const {documentWeight,isHeavyDocument}=await import('./import-stream.js');
 const child=n=>Array.from({length:n},(_,i)=>({id:'c'+i,type:'line'}));
 const doc={entities:[...child(40000),{id:'blk',type:'block',entities:child(30000)}],sharedBlocks:{s:{entities:child(20000)}},blocks:[]};
 assert.equal(documentWeight(doc),90001);
 assert.equal(isHeavyDocument(doc),true);
 assert.equal(isHeavyDocument({entities:child(40000)}),false);
 assert.ok(documentWeight(doc,50000)>50000&&documentWeight(doc,50000)<90001,'stops counting past the cap');
 const {documentSendPlan,largeRecoveryPlan}=await import('./bridge-client.js');
 const weight=documentWeight(doc,50001);
 assert.equal(documentSendPlan({changed:true,count:weight,now:10000,lastSentAt:0}).send,'omitted');
 assert.equal(largeRecoveryPlan({count:weight,revision:2,sentRevision:1,now:200000,lastSentAt:0}).send,true);
});
