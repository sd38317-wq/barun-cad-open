import test from 'node:test';
import assert from 'node:assert/strict';
import {createChunkedRecoveryAdapter,captureRecoverySnapshot,RECOVERY_CHUNK_PREFIX} from './recovery-chunks.js';

function fixture(options={}){
  const values=new Map(),writes=[];let fail=null,sequence=0,yields=0,onYield=null;
  const backend={
    async get(key){return structuredClone(values.get(key));},
    async keys(){return [...values.keys()];},
    async put(key,value){if(fail?.(key,value))throw Error('injected storage failure');writes.push({key,bytes:value===undefined?0:Buffer.byteLength(JSON.stringify(value))});if(value===undefined)values.delete(key);else values.set(key,structuredClone(value));},
  };
  const adapter=createChunkedRecoveryAdapter(backend,{maxRecordBytes:1024,budgetMs:4,newId:()=>`g${++sequence}`,yield:async()=>{yields++;await onYield?.();},lock:operation=>operation(),...options});
  return {values,writes,backend,adapter,set fail(value){fail=value;},set onYield(value){onYield=value;},get yields(){return yields;}};
}
const workspace=doc=>({version:1,savedAt:1,activeId:'tab',tabs:[{id:'tab',name:'Drawing',dirty:true,doc}]});

test('streamed giant arrays, nested blocks, strings and shared aliases round trip in bounded records',async()=>{
  const f=fixture(),point={x:12,y:34},points=Array.from({length:5000},(_,i)=>({x:i,y:-i}));points.push(point,point);
  const definition={origin:{x:0,y:0},entities:[{type:'block',entities:[{type:'polyline',points}]}]};
  const sharedBlocks={shape:definition},doc={version:3,layers:[{id:'0',color:'#ffffff'}],entities:[{sharedBlock:'shape'}],sharedBlocks};
  const saved=workspace(doc);saved.tabs[0].recoveryUndo={...doc,entities:[]};saved.tabs.push({id:'other',name:'Other',doc});
  saved.note='가'.repeat(5000);saved['k'.repeat(1000)]='long key';
  await f.adapter.put('current',saved);const restored=await f.adapter.get('current');
  assert.deepEqual(restored,saved);
  assert.equal(restored.tabs[0].doc,restored.tabs[1].doc);
  assert.equal(restored.tabs[0].doc.sharedBlocks,restored.tabs[0].recoveryUndo.sharedBlocks);
  const restoredPoints=restored.tabs[0].doc.sharedBlocks.shape.entities[0].entities[0].points;
  assert.equal(restoredPoints.at(-1),restoredPoints.at(-2),'even shared inline leaf identity survives');
  assert.ok(f.writes.length>100);assert.ok(f.yields>100);
  assert.ok(f.writes.every(write=>write.bytes<=1024),`record max ${Math.max(...f.writes.map(w=>w.bytes))}`);
  assert.deepEqual(await f.adapter.keys(),['current']);
});

test('workspace headers and layer rows are captured synchronously before a queued save yields',async()=>{
  const f=fixture(),entities=Array.from({length:2000},(_,i)=>({id:i,points:[{x:i,y:0}]}));
  const doc={version:3,layers:Array.from({length:300},(_,i)=>({id:String(i),name:'Layer '+i,color:'#ffffff'})),entities,sharedBlocks:{shape:{entities:[]}}},saved=workspace(doc);
  const captured=captureRecoverySnapshot(saved);assert.equal(captured.tabs[0].doc.entities,entities);assert.notEqual(captured.tabs[0].doc.layers,doc.layers);
  const operation=f.adapter.put('current',saved);
  saved.tabs[0].name='Changed';doc.layers[299].color='#ff0000';doc.version=99;saved.activeId='changed';
  await operation;const actual=await f.adapter.get('current');
  assert.equal(actual.tabs[0].name,'Drawing');assert.equal(actual.tabs[0].doc.layers[299].color,'#ffffff');assert.equal(actual.tabs[0].doc.version,3);assert.equal(actual.activeId,'tab');
});

test('large extension arrays are streamed rather than synchronously cloned during header capture',async()=>{
  const f=fixture(),extension=Array.from({length:5000},(_,i)=>i),saved=workspace({layers:[],entities:[],extension});
  assert.equal(captureRecoverySnapshot(saved).tabs[0].doc.extension,extension);
  await f.adapter.put('current',saved);assert.deepEqual(await f.adapter.get('current'),saved);
});

test('essential layers are captured beyond optional array and object budgets before queued writes',async()=>{
  const f=fixture(),layers=Array.from({length:4097},(_,i)=>({id:String(i),color:'old',details:{label:'old'}}));
  const saved=workspace({entities:[],layers});
  // Optional workspace metadata consumes the entire budget before doc capture.
  saved.first=Array.from({length:4096},(_,i)=>({i}));
  saved.second=Array.from({length:4096},(_,i)=>({i}));
  const pending=f.adapter.put('current',saved);
  layers[0].details.label='changed';layers[4096].color='changed';layers.push({id:'late'});
  await pending;const actual=await f.adapter.get('current');
  assert.equal(actual.tabs[0].doc.layers.length,4097);
  assert.equal(actual.tabs[0].doc.layers[0].details.label,'old');
  assert.equal(actual.tabs[0].doc.layers[4096].color,'old');
});

test('sparse arrays retain holes, own properties, trailing length and shared identity',async()=>{
  const f=fixture(),shared={label:'shared'},items=new Array(1000000);
  items[2]=shared;items[7]=undefined;items[900000]=shared;
  items.note=shared;items['key'.repeat(500)]='long property';
  Object.defineProperty(items,'__proto__',{value:shared,enumerable:true});
  items.self=items;
  const small=new Array(12);small[3]='present';small.note='metadata';
  const value=workspace({entities:[{items}],layers:[],small});
  await f.adapter.put('current',value);const restored=await f.adapter.get('current');
  assert.deepEqual(restored,value);
  const actual=restored.tabs[0].doc.entities[0].items;
  assert.equal(actual.length,1000000);assert.equal(0 in actual,false);assert.equal(7 in actual,true);assert.equal(999999 in actual,false);
  assert.equal(actual[2],actual[900000]);assert.equal(actual.note,actual[2]);assert.equal(actual.self,actual);
  assert.equal(Object.getOwnPropertyDescriptor(actual,'__proto__').value,actual[2]);
  assert.equal(Object.getPrototypeOf(actual),Array.prototype);
  assert.ok(f.writes.length<30,'sparse holes must not emit one token per missing index');
  assert.ok(f.writes.every(write=>write.bytes<=1024));
});

test('dense streamed arrays use compact positional values and old positional pages stay readable',async()=>{
  const f=fixture(),value=Array.from({length:200},(_,i)=>i);
  await f.adapter.put('current',value);
  const tokens=[...f.values.values()].flatMap(record=>record.tokens||[]);
  assert.equal(tokens.filter(token=>token[0]==='k').length,0,'dense arrays add no per-index keys');
  assert.deepEqual(await f.adapter.get('current'),value);
  await f.backend.put(RECOVERY_CHUNK_PREFIX+'legacy-array/p/0',{format:'barun-recovery-chunks',tokens:[['a',0,3],['p',1],['p',undefined],['p',3],['e']]});
  await f.backend.put('legacy-array',{format:'barun-recovery-chunks',version:1,generation:'legacy-array',pages:1});
  assert.deepEqual(await f.adapter.get('legacy-array'),[1,undefined,3]);
});

test('unsupported metadata prototypes fail explicitly without replacing committed recovery',async()=>{
  for(const special of [new Date(),new Map([['a',1]]),new Set([1])]){
    const f=fixture();await f.adapter.put('current',{previous:true});
    const saved=workspace({entities:[],layers:[{id:'0'}],extra:special});
    assert.throws(()=>captureRecoverySnapshot(saved),/Unsupported recovery object/);
    await assert.rejects(async()=>f.adapter.put('current',saved),/Unsupported recovery object/);
    assert.deepEqual(await f.adapter.get('current'),{previous:true});
    saved.tabs[0].doc.extra=Array.from({length:4097},()=>0);saved.tabs[0].doc.extra[4096]=special;
    await assert.rejects(f.adapter.put('current',saved),/Unsupported recovery object/,'objects beyond optional capture are rejected by streaming encoder');
    assert.deepEqual(await f.adapter.get('current'),{previous:true});
  }
});

test('page failure and final manifest failure retain the previous committed recovery',async()=>{
  for(const final of [false,true]){
    const f=fixture(),old={value:'old'},next={points:Array.from({length:1000},(_,i)=>({x:i,y:i}))};
    await f.adapter.put('current',old);const manifest=structuredClone(f.values.get('current'));
    f.fail=(key,value)=>final?key==='current'&&value!==undefined:key.endsWith('/p/2');
    await assert.rejects(f.adapter.put('current',next),/injected storage failure/);
    assert.deepEqual(f.values.get('current'),manifest);assert.deepEqual(await f.adapter.get('current'),old);
    f.fail=null;await f.adapter.cleanup();
    assert.ok([...f.values.keys()].filter(k=>k.startsWith(RECOVERY_CHUNK_PREFIX)).every(k=>k.includes('/'+manifest.generation+'/')));
  }
});

test('old manifest remains readable during staging and concurrent writes and clear stay ordered',async()=>{
  const f=fixture();await f.adapter.put('current',{revision:0});let checks=0;
  f.onYield=async()=>{if(checks++===0){const manifest=await f.backend.get('current');assert.equal(manifest.generation,'g1');}};
  const a=f.adapter.put('current',{revision:1,points:Array.from({length:1000},(_,x)=>({x,y:0}))});
  const b=f.adapter.put('current',{revision:2});const clear=f.adapter.put('current',undefined);const c=f.adapter.put('current',{revision:3});
  await Promise.all([a,b,clear,c]);assert.deepEqual(await f.adapter.get('current'),{revision:3});
  const commits=f.writes.filter(w=>w.key==='current');assert.equal(commits.length,5);
  await f.adapter.cleanup();assert.deepEqual(await f.adapter.keys(),['current']);
});

test('cleanup retains every live session and active stage while removing only unreachable chunks',async()=>{
  const f=fixture(),sessions=[];
  for(let i=0;i<3;i++){const key='last-session:'+i;sessions.push(key);await f.adapter.put(key,{revision:i});}
  await f.adapter.put('current',{revision:4});await f.adapter.put('current',{revision:5});await f.adapter.put('current',undefined);
  const stage=RECOVERY_CHUNK_PREFIX+'other-writer/';
  await f.backend.put(stage+'stage',{format:'barun-recovery-chunks',stage:true,generation:'other-writer'});
  await f.backend.put(stage+'p/0',{format:'barun-recovery-chunks',tokens:[['p','pending']]});
  assert.ok(await f.adapter.cleanup()>0);
  for(let i=0;i<3;i++)assert.deepEqual(await f.adapter.get(sessions[i]),{revision:i});
  assert.ok(f.values.has(stage+'p/0'));assert.deepEqual((await f.adapter.keys()).sort(),sessions);
});

test('legacy inline values are readable and upgrade only after complete chunk commit',async()=>{
  const f=fixture(),old=workspace({layers:[],entities:[{id:'old'}]});await f.backend.put('current',old);
  assert.deepEqual(await f.adapter.get('current'),old);
  f.fail=key=>key==='current';await assert.rejects(f.adapter.put('current',{new:true}));
  assert.deepEqual(await f.adapter.get('current'),old);
  f.fail=null;await f.adapter.put('current',{new:true});assert.deepEqual(await f.adapter.get('current'),{new:true});
});

test('dangerous property names and missing-page errors do not corrupt decoded objects or legacy data',async()=>{
  const f=fixture(),value=JSON.parse('{"__proto__":{"polluted":true},"constructor":"data"}');
  await f.adapter.put('current',value);const actual=await f.adapter.get('current');
  assert.deepEqual(actual,value);assert.equal({}.polluted,undefined);
  const manifest=f.values.get('current');f.values.delete(RECOVERY_CHUNK_PREFIX+manifest.generation+'/p/0');
  await assert.rejects(f.adapter.get('current'),/Missing recovery page/);
});

test('shared origin lock prevents another adapter replacing and collecting a generation during its read',async()=>{
  const f=fixture();let tail=Promise.resolve();
  const lock=operation=>{const result=tail.then(operation);tail=result.catch(()=>{});return result;};
  let release,entered;const blocked=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  let blockRead=false,paused=false;
  const a=createChunkedRecoveryAdapter(f.backend,{maxRecordBytes:1024,lock,newId:()=> 'reader-generation',yield:async()=>{if(blockRead&&!paused){paused=true;entered();await gate;}}});
  const b=createChunkedRecoveryAdapter(f.backend,{maxRecordBytes:1024,lock,newId:()=> 'writer-generation',yield:async()=>{}});
  const old={points:Array.from({length:500},(_,x)=>({x,y:0}))};await a.put('current',old);
  blockRead=true;const reading=a.get('current');await blocked;
  let committed=false;const writing=b.put('current',{revision:2}).then(()=>{committed=true;});const cleaning=b.cleanup();
  await Promise.resolve();await Promise.resolve();assert.equal(committed,false,'second adapter waits for the complete old read');
  release();assert.deepEqual(await reading,old);await writing;await cleaning;
  assert.deepEqual(await b.get('current'),{revision:2});
  assert.ok(![...f.values.keys()].some(key=>key.includes('/reader-generation/')),'old pages collected only after reader releases lock');
});

test('cleanup without cross-context locking fails closed and leaves old generations readable',async()=>{
  const f=fixture({lock:null});await f.adapter.put('current',{revision:1});const old=structuredClone(f.values.get('current'));
  await f.adapter.put('current',{revision:2});assert.equal(await f.adapter.cleanup(),0);
  assert.ok(f.values.has(RECOVERY_CHUNK_PREFIX+old.generation+'/p/0'));
  assert.deepEqual(await f.adapter.get('current'),{revision:2});
});

const geometryWorkspace=()=>{
  const points=Array.from({length:1500},(_,x)=>({x,y:-x}));
  const entities=Array.from({length:100},(_,i)=>({id:String(i),type:'polyline',points:i===0?points:[{x:i,y:0},{x:i,y:1}]}));
  return workspace({version:3,layers:[{id:'0',color:'old'}],entities,sharedBlocks:{shape:{entities:[{type:'polyline',points}]}}});
};
const editedWorkspace=(saved,revision)=>{
  const doc=saved.tabs[0].doc,entities=[...doc.entities];entities[0]={...entities[0],color:'color-'+revision};
  const next=workspace({...doc,entities});next.savedAt=revision;next.tabs[0].recoveryUndo=doc;return next;
};
const coldAdapter=f=>createChunkedRecoveryAdapter(f.backend,{maxRecordBytes:1024,lock:operation=>operation(),yield:async()=>{}});

test('single-edit deltas reuse full geometry descendants and preserve current/undo aliases on cold restore',async()=>{
  const f=fixture(),original=geometryWorkspace();
  await f.adapter.put('current',original);const full=f.values.get('current'),fullWrites=f.writes.length;
  assert.equal(full.kind,'full');assert.ok(f.values.has(RECOVERY_CHUNK_PREFIX+full.generation+'/complete'));
  // Reading adds decoded identities without replacing original live identities.
  await f.adapter.get('current');
  const next=editedWorkspace(original,2),start=f.writes.length;await f.adapter.put('current',next);
  const delta=f.values.get('current');assert.equal(delta.kind,'delta');assert.equal(delta.baseline.generation,full.generation);
  assert.ok(f.writes.length-start<fullWrites/5,'single edit writes a small fraction of full records');
  const restored=await coldAdapter(f).get('current');assert.deepEqual(restored,next);
  assert.equal(restored.tabs[0].doc.entities[0].points,restored.tabs[0].recoveryUndo.entities[0].points);
  assert.equal(restored.tabs[0].doc.entities[0].points,restored.tabs[0].doc.sharedBlocks.shape.entities[0].points);
  assert.equal(restored.tabs[0].doc.entities[1],restored.tabs[0].recoveryUndo.entities[1]);
  assert.ok(f.writes.every(write=>write.bytes<=1024));
  for(let i=3;i<=5;i++){
    await f.adapter.put('current',editedWorkspace(original,i));const manifest=f.values.get('current');
    assert.equal(manifest.kind,'delta');assert.equal(manifest.baseline.generation,full.generation,'every delta directly references the full baseline');
  }
});

test('delta saves capture changed layers and headers while mutable extension identities are not reused',async()=>{
  const f=fixture(),saved=geometryWorkspace(),extension=Array.from({length:4097},(_,i)=>i);saved.tabs[0].doc.extension=extension;
  await f.adapter.put('current',saved);
  extension[4096]='changed before capture';saved.tabs[0].doc.layers[0].color='new';saved.activeId='new-active';
  const pending=f.adapter.put('current',saved);saved.tabs[0].doc.layers[0].color='too late';saved.activeId='too late';
  await pending;assert.equal(f.values.get('current').kind,'delta');const actual=await coldAdapter(f).get('current');
  assert.equal(actual.tabs[0].doc.extension[4096],'changed before capture');assert.equal(actual.tabs[0].doc.layers[0].color,'new');assert.equal(actual.activeId,'new-active');
});

test('failed delta and full manifest commits preserve both durable recovery and the previous baseline index',async()=>{
  const f=fixture(),original=geometryWorkspace();await f.adapter.put('current',original);const full=f.values.get('current');
  for(const next of [editedWorkspace(original,2),structuredClone(geometryWorkspace())]){
    f.fail=(key,value)=>key==='current'&&value!==undefined;
    await assert.rejects(f.adapter.put('current',next),/injected storage failure/);
    assert.deepEqual(f.values.get('current'),full);assert.deepEqual(await f.adapter.get('current'),original);
    f.fail=null;
  }
  await f.adapter.cleanup();await f.adapter.put('current',editedWorkspace(original,3));
  assert.equal(f.values.get('current').baseline.generation,full.generation,'failed full attempt did not replace usable original identities');
});

test('collection invalidates complete markers before pages and a stale adapter then writes a standalone full',async()=>{
  const f=fixture(),original=geometryWorkspace();await f.adapter.put('current',original);const old=f.values.get('current');
  let nextId=0;const other=createChunkedRecoveryAdapter(f.backend,{maxRecordBytes:1024,lock:operation=>operation(),yield:async()=>{},newId:()=>`other-${++nextId}`});
  await other.put('current',{replacement:true});
  f.fail=(key,value)=>value===undefined&&key===RECOVERY_CHUNK_PREFIX+old.generation+'/p/0';
  await assert.rejects(other.cleanup(),/injected storage failure/);
  assert.equal(f.values.has(RECOVERY_CHUNK_PREFIX+old.generation+'/complete'),false);
  assert.equal(f.values.has(RECOVERY_CHUNK_PREFIX+old.generation+'/p/0'),true,'interrupted GC may leave arbitrary old pages');
  f.fail=null;await f.adapter.put('current',editedWorkspace(original,2));
  assert.equal(f.values.get('current').kind,'full','a stale WeakMap cannot reference an incompletely collected generation');
  assert.deepEqual(await coldAdapter(f).get('current'),editedWorkspace(original,2));
});

test('session dependencies retain their full baseline across count rebasing and cold independent restores',async()=>{
  const f=fixture({maxDeltaWrites:2}),original=geometryWorkspace();await f.adapter.put('current',original);const first=f.values.get('current');
  await f.adapter.put('session:1',editedWorkspace(original,1));await f.adapter.put('session:2',editedWorkspace(original,2));
  const rebased=editedWorkspace(original,3);await f.adapter.put('current',rebased);const second=f.values.get('current');
  assert.equal(second.kind,'full');assert.notEqual(second.generation,first.generation);
  await f.adapter.put('session:3',editedWorkspace(rebased,4));
  assert.equal(f.values.get('session:3').baseline.generation,second.generation);
  await f.adapter.put('current',undefined);await f.adapter.cleanup();
  assert.ok(f.values.has(RECOVERY_CHUNK_PREFIX+first.generation+'/complete'));
  assert.ok(f.values.has(RECOVERY_CHUNK_PREFIX+second.generation+'/complete'));
  const cold=coldAdapter(f);
  assert.deepEqual(await cold.get('session:1'),editedWorkspace(original,1));assert.deepEqual(await cold.get('session:2'),editedWorkspace(original,2));
  assert.deepEqual(await cold.get('session:3'),editedWorkspace(rebased,4));
  await f.adapter.put('session:1',undefined);await f.adapter.put('session:2',undefined);await f.adapter.cleanup();
  assert.ok(![...f.values.keys()].some(key=>key.startsWith(RECOVERY_CHUNK_PREFIX+first.generation+'/')));
  assert.deepEqual(await cold.get('session:3'),editedWorkspace(rebased,4));
});

test('measured delta growth triggers the next standalone rebase without a delta chain',async()=>{
  const f=fixture({rebaseRatio:.01}),original=geometryWorkspace();await f.adapter.put('current',original);
  await f.adapter.put('current',editedWorkspace(original,1));assert.equal(f.values.get('current').kind,'delta');
  await f.adapter.put('current',editedWorkspace(original,2));assert.equal(f.values.get('current').kind,'full');
  assert.deepEqual(await coldAdapter(f).get('current'),editedWorkspace(original,2));
});

test('a cold successful read adopts full baseline identities for session preservation and subsequent edits',async()=>{
  const f=fixture(),original=geometryWorkspace();await f.adapter.put('current',original);const first=f.values.get('current');
  await f.adapter.put('current',editedWorkspace(original,1));
  const reader=createChunkedRecoveryAdapter(f.backend,{maxRecordBytes:1024,lock:operation=>operation(),yield:async()=>{},newId:()=> 'adopted-session'});
  const restored=await reader.get('current');await reader.put('session',{...restored,preservedAt:'now'});
  const manifest=f.values.get('session');assert.equal(manifest.kind,'delta');assert.equal(manifest.baseline.generation,first.generation);
  assert.deepEqual(await coldAdapter(f).get('session'),{...restored,preservedAt:'now'});
});

test('keeping the previous session aliases its immutable pages instead of rewriting them',async()=>{
  const {createRecoveryStore}=await import('./drawing-tabs.js');
  const f=fixture(),points=Array.from({length:4000},(_,i)=>({x:i,y:i}));
  const saved=workspace({version:3,layers:[{id:'0'}],entities:[{type:'polyline',points}]});
  const store=createRecoveryStore(f.adapter,{now:()=>new Date('2026-09-29T00:00:00Z')});
  await store.write(saved);
  const pagesBefore=f.writes.filter(w=>w.key.startsWith(RECOVERY_CHUNK_PREFIX)&&w.key.includes('/p/')).length;
  f.writes.length=0;
  assert.equal(await store.preserveCurrentSession(saved),true);
  assert.equal(f.writes.filter(w=>w.key.includes('/p/')).length,0,'no page is written again');
  assert.ok(pagesBefore>20);
  // A new workspace replaces current; cleanup must keep the aliased generation alive.
  await store.write(workspace({version:3,layers:[{id:'0'}],entities:[]}));
  await f.adapter.cleanup();
  assert.deepEqual(await store.readLastSession(),saved);
  assert.deepEqual(await createRecoveryStore(coldAdapter(f)).readLastSession(),saved);
  // Nothing to lose: no generation.
  assert.equal(await store.preserveCurrentSession({...saved,tabs:[{...saved.tabs[0],dirty:false}]}),false);
});
