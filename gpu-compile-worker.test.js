import test from 'node:test';
import assert from 'node:assert/strict';
import { GpuCompileClient } from './gpu-compile-client.js';
import { compileGpuJob, gpuJobDocument, isHeavyGpuJob } from './gpu-compile-job.js';

const line=(id,x)=>({id,type:'line',layer:'0',points:[{x,y:0},{x:x+10,y:10}]});
const doc={entities:[{id:'block',type:'block',layer:'0',entities:[line('inner',1)]}],layers:[{id:'0',name:'0',visible:true,color:'#ff0000'}]};

test('worker job survives actual structured cloning and keeps resolved block styles and source IDs',()=>{
  const job={doc:gpuJobDocument(structuredClone(doc)),scale:2,origin:{x:5,y:6}};
  const result=structuredClone(compileGpuJob(structuredClone(job)));
  assert.equal(result.compiled.items[0].sourceId,'block');assert.equal(result.compiled.items[0].color,'#ff0000');
  assert.deepEqual(result.compiled.items[0].points,[{x:-4,y:-6},{x:6,y:4}]);assert.deepEqual(result.compiled.unsupported,[]);
  assert.equal(isHeavyGpuJob(doc.entities),false);assert.equal(isHeavyGpuJob(Array.from({length:1000},(_,i)=>line(i,i))),true);
});

const reference=(id,name,overrides={})=>({id,type:'block',name,sharedBlock:name,layer:'0',position:{x:0,y:0},scale:1,rotation:0,entities:[],...overrides});
const compileComparable=job=>{
  const {compileMs,...result}=compileGpuJob(structuredClone(job));
  // Shared expansion assigns fresh internal child IDs. Rendering uses the
  // stable top-level sourceId; compare every other compiled field exactly.
  return JSON.parse(JSON.stringify(result,(key,value)=>key==='id'?undefined:value));
};

test('edit jobs include only reachable nested definitions and compile like the complete table',()=>{
  const definitions={
    outer:{origin:{x:2,y:3},metadata:{preserved:true},entities:[line('a',1),{type:'block',layer:'0',entities:[reference('nested','inner',{position:{x:20,y:30},scale:2})]}]},
    inner:{origin:{x:1,y:0},entities:[line('b',4),{...line('hidden',9),layer:'hidden'}]},
    attached:{origin:{x:0,y:0},entities:[line('c',50)]},
    unused:{origin:{x:0,y:0},entities:[line('unrelated',100000)]},
  };
  const selected=[reference('source','outer',{color:'#00ff00',position:{x:100,y:200},rotation:90,entities:[reference('attachment','attached')]}),line('last',500)];
  const full={entities:[...selected,reference('not-selected','unused')],layers:[...doc.layers,{id:'hidden',name:'Hidden',visible:false,color:'#fff'}],linetypeScale:3,sharedBlocks:definitions};
  const subset=gpuJobDocument(full,selected);
  assert.deepEqual(Object.keys(subset.sharedBlocks).sort(),['attached','inner','outer']);
  assert.equal(subset.entities,selected);assert.equal(subset.layers,full.layers);
  assert.equal(subset.sharedBlocks.outer,definitions.outer,'retain definition metadata and identity before worker cloning');
  assert.equal(subset.sharedBlocks.inner,definitions.inner);
  const options={scale:2,origin:{x:5,y:6}};
  const expected=compileComparable({doc:{...full,entities:selected},...options});
  const actual=compileComparable({doc:subset,...options});
  assert.deepEqual(actual,expected);
  assert.deepEqual(actual.compiled.items.map(item=>item.sourceId),['source','source','source','last'],'hidden children omitted and source painter order retained');
});

test('plain edit payload does not enumerate or read unrelated shared definitions',()=>{
  let reads=0;const definitions={};
  Object.defineProperty(definitions,'unrelated',{enumerable:true,get(){reads++;throw Error('unrelated definition touched');}});
  const full={...doc,sharedBlocks:definitions},selected=[line('new',0)];
  const payload=gpuJobDocument(full,selected);
  assert.deepEqual(payload.sharedBlocks,{});assert.equal(reads,0);
  assert.doesNotThrow(()=>structuredClone(payload));
  assert.equal(compileGpuJob({doc:payload,scale:1}).compiled.items[0].sourceId,'new');
  assert.equal(gpuJobDocument(doc).sharedBlocks,undefined,'documents without definitions keep their prior shape');
});

test('reachable definition cycles terminate payload discovery and preserve compiler rejection',()=>{
  const full={...doc,entities:[reference('source','a')],sharedBlocks:{
    a:{entities:[reference('nested-a','b')]},b:{entities:[reference('nested-b','a')]},unused:{entities:[]},
  }};
  const payload=gpuJobDocument(full);
  assert.deepEqual(Object.keys(payload.sharedBlocks).sort(),['a','b']);
  assert.throws(()=>compileGpuJob({doc:structuredClone(full),scale:1}),/순환 또는 누락/);
  assert.throws(()=>compileGpuJob({doc:structuredClone(payload),scale:1}),/순환 또는 누락/);
});

test('missing nested definitions retain the original compiler error',()=>{
  const full={...doc,entities:[reference('source','outer')],sharedBlocks:{outer:{entities:[reference('nested','missing')]},unused:{entities:[]}}};
  const payload=gpuJobDocument(full);
  assert.deepEqual(Object.keys(payload.sharedBlocks),['outer']);
  const message=job=>{let caught;try{compileGpuJob({doc:structuredClone(job),scale:1});}catch(error){caught=error;}assert.ok(caught,'missing reference must reject');return caught.message;};
  assert.equal(message(payload),message(full));
});

function harness(){
  const workers=[];let ready=0;
  const client=new GpuCompileClient({onReady:()=>ready++,createWorker:()=>{
    const worker={postMessage(message){this.message=structuredClone(message);},terminate(){this.terminated=true;}};workers.push(worker);return worker;
  }});
  return {client,workers,get ready(){return ready;}};
}
test('a superseding command/undo terminates old work and ignores late results',()=>{
  const h=harness(),a={},b={};
  try {
    assert.deepEqual(h.client.request(a,1,'edit',{}),{pending:true});const old=h.workers[0],oldHandler=old.onmessage;
    h.client.select(b,2);assert.equal(old.terminated,true);
    h.client.request(b,2,'edit',{});const current=h.workers[1];
    oldHandler({data:{id:old.message.id,result:{wrong:true}}});assert.equal(h.ready,0);
    current.onmessage({data:{id:current.message.id,result:{right:true}}});assert.equal(h.ready,1);
    assert.deepEqual(h.client.request(b,2,'edit',{}),{result:{right:true}});
    h.client.consume();assert.equal(h.client.pending,null);
  }finally{h.client.dispose();}
});
test('worker error and structured-clone failure disable offload and request synchronous redraw',()=>{
  const h=harness();h.client.request({},1,'full',{});h.workers[0].onerror();
  assert.equal(h.ready,1);assert.equal(h.client.request({},2,'full',{}),null);assert.equal(h.workers[0].terminated,true);
  let ready=0;const broken=new GpuCompileClient({onReady:()=>ready++,createWorker:()=>({postMessage(){throw Error('clone');},terminate(){}})});
  assert.equal(broken.request({},1,'edit',{}),null);assert.equal(ready,1);assert.equal(broken.pending,null);broken.dispose();
});
test('timeout returns control to synchronous fallback rather than leaving old drawing forever',async()=>{
  let ready=0;const client=new GpuCompileClient({timeoutMs:5,onReady:()=>ready++,createWorker:()=>({postMessage(){},terminate(){}})});
  client.request({},1,'edit',{});await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(ready,1);assert.equal(client.disabled,true);assert.equal(client.pending,null);client.dispose();
});
