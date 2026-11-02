import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleImportEntity,createImportPreview,PREVIEW_INTERVAL_MS,PREVIEW_BUDGET_MS,MAX_FRAME_ENTITIES,createPreviewScheduler,mountDrawingOpenWait} from './drawing-open-preview.js';
import {createImportAssembler,receiveImportStream} from './import-stream.js';

test('preview reads a constant number of points, never expands block children or writes geometry',()=>{
 const entity={type:'block',layer:'A-WALL',position:Object.freeze({x:3,y:4})};
 Object.defineProperty(entity,'entities',{get(){throw Error('must not expand a block');}});
 Object.freeze(entity);
 assert.deepEqual(sampleImportEntity(entity),{layer:'A-WALL',points:[[3,4]]});
 let reads=0;
 const points=new Proxy({length:1000000},{get(target,key){if(key==='length')return target.length;reads++;return {x:Number(key),y:0};}});
 assert.equal(sampleImportEntity({layer:'A',points}),null); // Non-array geometry is ignored.
 const array=Array(1000000);array[0]={x:1,y:2};array[999999]={x:3,y:4};
 const result=sampleImportEntity({layer:'A',points:array});
 assert.deepEqual(result.points,[[1,2],[3,4]]);
 assert.equal(reads,0);
 assert.equal(sampleImportEntity({position:{x:Infinity,y:2}}),null);
});

test('samples use received coordinates and layer names with bounded pending work and memory',()=>{
 const model=createImportPreview({now:()=>0});
 const entities=Array.from({length:120000},(_,i)=>Object.freeze({layer:'A-'+i%24,points:[{x:i,y:-i}]}));
 for(let i=0;i<1000;i++)model.offer(entities);
 assert.ok(model.pending===entities.length);
 model.collect(1);
 assert.ok(model.samples.length<=MAX_FRAME_ENTITIES);assert.equal(model.pending,0);
 assert.ok(model.samples.some(s=>s.points[0][0]===119999));
 for(let i=0;i<200;i++){model.offer(entities);model.collect(1);}
 assert.ok(model.samples.length<=1536);
 assert.ok(model.layers.size<=49);
 assert.deepEqual(model.bounds,{minX:0,minY:-119999,maxX:119999,maxY:-0});
});

test('collection obeys its deadline and accepts no work after pending is cleared',()=>{
 let clock=0;const model=createImportPreview({now:()=>++clock});
 model.offer(Array.from({length:1000},(_,i)=>({position:{x:i,y:i}})));
 model.collect(2);
 assert.equal(model.samples.length,1);assert.ok(model.pending>0);
 model.clearPending();model.collect(100);
 assert.equal(model.samples.length,1);
 assert.equal(PREVIEW_INTERVAL_MS,100);assert.equal(PREVIEW_BUDGET_MS,2);
});

const payload=()=>[
 {kind:'header',document:{entities:[],layers:[]},report:{imported:3},counts:{entities:3}},
 {kind:'entities',items:[{id:'a',position:{x:1,y:2}},{id:'b',position:{x:3,y:4}}]},
 {kind:'entities',items:[{id:'c',position:{x:5,y:6}}]},
 {kind:'end',counts:{entities:3}}
].map(v=>JSON.stringify(v)).join('\n')+'\n';

test('existing stream batch hooks report real counts and leave the full document identical',()=>{
 const baseline=createImportAssembler(),seen=[],preview=createImportAssembler({onEntities:(items,total)=>seen.push([items,total])});
 const bytes=new TextEncoder().encode(payload());baseline.push(bytes);preview.push(bytes);
 const expected=baseline.finish(),actual=preview.finish();
 assert.deepEqual(actual,expected);
 assert.deepEqual(seen.map(([items,total])=>[items.length,total]),[[2,2],[1,3]]);
 assert.equal(seen[0][0][0],actual.document.entities[0]);
});

test('a failed optional preview cannot break import or change its result',async()=>{
 const a=createImportAssembler({onEntities(){throw Error('preview unavailable');}});
 a.push(new TextEncoder().encode(payload()));assert.equal(a.finish().document.entities.length,3);
 const response=new Response(JSON.stringify({document:{entities:[{id:'json'}]},report:{imported:1}}),{headers:{'Content-Type':'application/json'}});
 const result=await receiveImportStream(response,{onEntities(){throw Error('no canvas');}});
 assert.deepEqual(result.document.entities,[{id:'json'}]);
});

test('stream preview callback can be enabled and disabled between existing batches',async()=>{
 let controller,firstProgress,secondSeen;
 const first=new Promise(resolve=>{firstProgress=resolve;}),second=new Promise(resolve=>{secondSeen=resolve;});
 const stream=new ReadableStream({start(c){controller=c;}});
 const options={onProgress:p=>{if(p.entities===1)firstProgress();}};
 const resultPromise=receiveImportStream(new Response(stream,{headers:{'Content-Type':'application/x-ndjson'}}),options);
 const encode=value=>new TextEncoder().encode(JSON.stringify(value)+'\n');
 controller.enqueue(new Uint8Array([...encode({kind:'header',document:{entities:[]},report:{imported:3},counts:{entities:3}}),...encode({kind:'entities',items:[{id:'a'}]})]));
 await first;
 const seen=[];options.onEntities=items=>{seen.push(...items.map(x=>x.id));secondSeen();};
 controller.enqueue(encode({kind:'entities',items:[{id:'b'}]}));
 await second;
 options.onEntities=undefined;
 controller.enqueue(encode({kind:'entities',items:[{id:'c'}]}));
 controller.enqueue(encode({kind:'end',counts:{entities:3}}));controller.close();
 const result=await resultPromise;
 assert.deepEqual(seen,['b']);assert.equal(result.document.entities.length,3);
});


test('offering a large batch keeps a reference and never reads an entity in the receiving tick',()=>{
 let reads=0;
 const items=new Proxy(Array.from({length:120000},(_,i)=>({position:{x:i,y:-i}})),{get(target,key){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key);}});
 const model=createImportPreview({now:()=>0});
 model.offer(items,items.length);assert.equal(reads,0);
 assert.equal(model.collect(1),MAX_FRAME_ENTITIES);assert.equal(reads,MAX_FRAME_ENTITIES);
 assert.equal(model.pending,0);
 const newer=[{position:{x:8,y:9}}];model.offer(items,items.length);model.offer(newer,newer.length);
 model.collect(1);assert.equal(reads,MAX_FRAME_ENTITIES);assert.deepEqual(model.samples.at(-1).points,[[8,9]]);
});

function fakeView(idle=true){
 let id=0;const jobs=new Map(),view={
  setTimeout(fn,ms){jobs.set(++id,{type:'timer',fn,ms});return id;},clearTimeout:id=>jobs.delete(id),
  requestAnimationFrame(fn){jobs.set(++id,{type:'frame',fn});return id;},cancelAnimationFrame:id=>jobs.delete(id)
 };
 if(idle){view.requestIdleCallback=fn=>{jobs.set(++id,{type:'idle',fn});return id;};view.cancelIdleCallback=id=>jobs.delete(id);}
 return {view,jobs,run(type,timeRemaining=()=>10){const entry=[...jobs].find(([,job])=>job.type===type);assert.ok(entry,'missing '+type);jobs.delete(entry[0]);entry[1].fn({timeRemaining});return entry[1];}};
}

for(const idle of [true,false])test('preview scheduler uses '+(idle?'idle time':'rAF fallback')+', throttles and cancels hidden/finished work',()=>{
 const fake=fakeView(idle);let clock=0,visible=true;const slices=[];
 const scheduler=createPreviewScheduler({view:fake.view,visible:()=>visible,now:()=>clock,work:(...args)=>slices.push(args)});
 scheduler.start();assert.equal(slices.length,0);assert.equal(fake.jobs.size,1);
 fake.run('timer');assert.equal(slices.length,0);fake.run(idle?'idle':'frame');
 assert.equal(slices.length,1);assert.ok(slices[0][1]-slices[0][0]<PREVIEW_BUDGET_MS);
 assert.equal([...fake.jobs.values()][0].ms,100);
 clock=99;fake.run('timer');fake.run(idle?'idle':'frame');assert.equal(slices.length,1);
 clock=100;fake.run('timer');fake.run(idle?'idle':'frame');assert.equal(slices.length,2);
 visible=false;fake.run('timer');assert.equal(fake.jobs.size,0);assert.equal(slices.length,2);
 visible=true;scheduler.start();scheduler.pause();assert.equal(fake.jobs.size,0);
 scheduler.start();fake.run('timer');scheduler.destroy();assert.equal(fake.jobs.size,0);
});

test('preview never forces a busy idle callback and does not work without its two millisecond budget',()=>{
 const fake=fakeView();let worked=0;
 const scheduler=createPreviewScheduler({view:fake.view,visible:()=>true,now:()=>0,work:()=>worked++});
 scheduler.start();fake.run('timer');fake.run('idle',()=>1);assert.equal(worked,0);scheduler.destroy();
});


function previewSurface(setting){
 const fake=fakeView(),listeners=new Map(),storage=new Map();if(setting!==undefined)storage.set('barun.drawingWaitPreview',setting);
 const document={hidden:false,defaultView:{...fake.view,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)}},getElementById:()=>null,
  addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:k=>listeners.delete(k)};
 let contexts=0;
 const element=tag=>({ownerDocument:document,tag,children:[],dataset:{},attrs:{},hidden:false,isConnected:true,
  append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}},after(...nodes){this.parent.append(...nodes);},
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);},
  setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},
  addEventListener(k,fn){this[k]=fn;},removeEventListener(k){delete this[k];},
  querySelector(selector){return this.children.find(n=>selector==='.'+n.className||selector==='#'+n.id||selector===n.tag)||null;},
  getContext(){contexts++;return {clearRect(){},fillRect(){}};}
 });
 document.createElement=element;document.head=element('head');
 const overlay=element('div');overlay.hidden=true;const card=element('div');card.className='drawing-load-card';overlay.append(card);
 const title=element('strong'),progress=element('progress'),detail=element('small'),stage=element('span');detail.id='drawing-load-detail';stage.id='drawing-load-stage';card.append(title,progress,detail,stage);
 return {...fake,document,overlay,listeners,get contexts(){return contexts;}};
}

test('default/off mount has no entity hooks, canvas context or scheduled preview work',()=>{
 for(const setting of [undefined,'0']){
  const surface=previewSurface(setting),wait=mountDrawingOpenWait(surface.overlay);surface.overlay.hidden=false;wait.update('읽는 중',null,'','read');
  assert.equal(wait.streamOptions.onEntities,undefined);assert.equal(wait.streamOptions.onHeader,undefined);
  assert.equal(surface.jobs.size,0);assert.equal(surface.contexts,0);assert.equal(wait.stats.frames,0);wait.destroy();
 }
});

test('hidden mount starts only after showing/update, and hidden/complete cannot restart its preview',()=>{
 const surface=previewSurface('1'),wait=mountDrawingOpenWait(surface.overlay);
 assert.equal(surface.jobs.size,0);assert.equal(surface.contexts,0);
 surface.overlay.hidden=false;wait.update('읽는 중',null,'','read');assert.equal(surface.jobs.size,1);
 const items=[Object.freeze({layer:'A',position:Object.freeze({x:3,y:4})})];wait.streamOptions.onEntities(items,1,1);
 assert.equal(wait.stats.samples,0);surface.run('timer');surface.run('idle');assert.equal(wait.stats.samples,1);assert.equal(surface.contexts,1);
 surface.document.hidden=true;surface.listeners.get('visibilitychange')();assert.equal(surface.jobs.size,0);
 wait.update('계속 읽는 중',null,'','read');assert.equal(surface.jobs.size,0);
 surface.document.hidden=false;surface.listeners.get('visibilitychange')();assert.equal(surface.jobs.size,1);
 wait.streamProgress({stage:'받았습니다',entities:1,expected:1,percent:1});assert.equal(surface.jobs.size,1);
 wait.finish();assert.equal(surface.jobs.size,0);assert.equal(wait.streamOptions.onEntities,undefined);
 wait.update('화면 준비',null,'','screen');assert.equal(surface.jobs.size,0);wait.destroy();assert.equal(surface.listeners.size,0);
});


test('whole-result handoff after receive completion can still paint once before opening finishes',()=>{
 const surface=previewSurface('1');surface.overlay.hidden=false;const wait=mountDrawingOpenWait(surface.overlay);
 wait.streamProgress({stage:'받았습니다',entities:1,expected:1,percent:1});
 wait.setLayers([{id:'A',name:'벽'}]);
 const items=[Object.freeze({layer:'A',position:Object.freeze({x:3,y:4})})];
 assert.equal(typeof wait.onEntities,'function');wait.onEntities(items,1,1);
 assert.equal(wait.stats.samples,0);surface.run('timer');surface.run('idle');assert.equal(wait.stats.samples,1);
 wait.finish();assert.equal(surface.jobs.size,0);assert.equal(wait.onEntities,undefined);wait.destroy();
});
