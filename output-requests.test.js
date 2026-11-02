import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngineApi} from './studio.js';
import {createOutputObservers,xhrResponse} from './output-requests.js';
const response=(data,status=200)=>({ok:status<300,status,headers:{get:()=>null},json:async()=>data});
const id='a'.repeat(32);
function monitor(events){return {upload:(...v)=>events.push(['upload',...v]),progress:v=>events.push(['progress',v]),ready:()=>events.push(['ready']),finish:v=>events.push(['finish',v]),fail:e=>events.push(['fail',e.message]),destroy:()=>events.push(['destroy'])};}

test('disabled presentation sends the original body once without registration or polling',async()=>{
 const calls=[],payload=new Blob(['original request bytes']);
 const observers=createOutputObservers({begin:()=>null});
 const client=createEngineApi({observeOutput:observers.observe,encode:async()=>({body:payload,contentType:'application/x-ndjson'}),fetch:async(url,options)=>{calls.push([url,options]);return response(url==='/api/status'?{token:'screen'}:{data:'file bytes'});}});
 const {timings_ms,...result}=await client.api('export',{document:{}});assert.deepEqual(result,{data:'file bytes'});assert.ok(timings_ms.client_serialize>=0);  // 저장은 시간 기록(timings_ms)을 덧붙인다
 assert.deepEqual(calls.map(c=>c[0]),['/api/status','/api/export']);
 assert.equal(calls[1][1].body,payload);
});

test('ordinary saves keep their original preparation while studio exports can prepare',async()=>{
 let prepared=0;const seen=[];
 const client=createEngineApi({prepare:async(_route,data)=>{prepared++;return {...data,marker:'live-check'};},encode:async data=>{seen.push(data);return {body:'body',contentType:'application/json'};},fetch:async url=>response(url==='/api/status'?{token:'t'}:{data:'bytes'})});
 await client.api('export',{format:'bcad',document:{entities:[]}},{prepare:false});
 assert.equal(prepared,0);assert.equal(seen[0].marker,undefined);
 await client.api('export',{format:'bcad',document:{entities:[]}});
 assert.equal(prepared,1);assert.equal(seen[1].marker,'live-check');
});

test('observer headers and events never change upload or output bytes; disk completion owns finish',async()=>{
 const events=[],calls=[],body=new Blob(['도면\n원본 bytes']);let sent;
 const xhrFactory=()=>({upload:{},open(){},setRequestHeader(k,v){calls.push([k,v]);},getResponseHeader(){return 'application/json';},send(v){sent=v;this.upload.onprogress({loaded:3,total:9,lengthComputable:true});this.upload.onprogress({loaded:9,total:9,lengthComputable:true});this.status=200;this.responseText=JSON.stringify({data:'unchanged file bytes',_outputProgress:{events:[{phase:'render',current:1,total:1,completed:true}]}});queueMicrotask(()=>this.onload());},abort(){this.onabort?.();}});
 const observers=createOutputObservers({begin:()=>monitor(events),xhrFactory,pollMs:2});
 const api=createEngineApi({observeOutput:observers.observe,encode:async()=>({body,contentType:'application/x-ndjson'}),fetch:async url=>response(url==='/api/status'?{token:'t'}:{job_id:id})}).api;
 const result=await api('pdf',{});
 assert.equal(sent,body);assert.equal(result.data,'unchanged file bytes');assert.equal('_outputProgress' in result,false);
 assert.ok(calls.some(([k,v])=>k==='X-CAD-Output-Job'&&v===id));
 assert.deepEqual(events.filter(e=>e[0]==='upload'),[['upload',3,9],['upload',9,9]]);
 assert.ok(events.some(e=>e[0]==='progress'));assert.ok(events.some(e=>e[0]==='ready'));assert.ok(!events.some(e=>e[0]==='finish'));
 const wait=observers.consume(result.data);wait.finish('actual.dwg');assert.deepEqual(events.at(-1),['finish','actual.dwg']);assert.equal(observers.consume(result.data),null);
});

test('stalled registration falls back to the actual request within a short deadline',async()=>{
 const events=[];let sends=0;
 const observers=createOutputObservers({begin:()=>monitor(events),xhrFactory:()=>({upload:{},open(){},setRequestHeader(){},getResponseHeader(){return null;},send(){sends++;this.status=200;this.responseText='{"path":"actual.dxf"}';queueMicrotask(()=>this.onload());},abort(){}})});
 const start=Date.now();
 const client=createEngineApi({observeOutput:observers.observe,fetch:async(url,options)=>url==='/api/status'?response({token:'t'}):new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})))),timeouts:{default:5000}});
 assert.deepEqual(await client.api('export',{}),{path:'actual.dxf'});assert.equal(sends,1);assert.ok(Date.now()-start<3000);assert.deepEqual(events.at(-1),['finish','actual.dxf']);
});

test('unknown upload total stays unknown and abort cleans up the active transport',async()=>{
 const controller=new AbortController();let xhr,seen=[];
 const request=xhrResponse('/api/export',{body:'body',signal:controller.signal},{xhrFactory:()=>xhr={upload:{},open(){},setRequestHeader(){},send(){this.upload.onprogress({loaded:7,lengthComputable:false});},abort(){this.onabort?.();}},onUpload:(...v)=>seen.push(v)});
 controller.abort();await assert.rejects(request,{name:'AbortError'});assert.deepEqual(seen,[[7,null]]);
});
