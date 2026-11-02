import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildDetail,detailBlock} from './detail-library.js';
import {drawingData,isDraftingResult} from './drafting-wait-data.js';
import {revealDisplayEntities} from './ai-draw-reveal-player.js';
import {partialEntity} from './ai-draw-reveal.js';
import {drawEntity} from './view.js';
import {showDraftingWait,destroyDraftingWait} from './drafting-wait-frame.js';

test('actual parameterized detail retains every native entity and stage order without mutation',()=>{
  const built=buildDetail('wall-rc-ext',{concrete:275,insulation:175},{scale:25});
  const before=structuredClone(built);
  const data=drawingData(built.entities,{title:built.title,scale:built.scale});
  const items=data.details.flatMap(d=>d.groups.flatMap(g=>g.items));
  assert.equal(items.length,built.entities.length);
  assert.deepEqual(new Set(items.map(e=>e.native)),new Set(built.entities));
  assert.equal(data.scale,25);assert.deepEqual(built,before);
  assert.deepEqual(data.details[0].groups.map(g=>g.key),['struct','finish','hatch','dims','notes','title']);
  assert.ok(items.some(e=>e.native.type==='dimension'));
});

test('translated inserted detail and section metadata route only the intended results',()=>{
  const block={id:'detail',...detailBlock('fdn-mat',{concrete:900},{position:{x:12000,y:8000}})};
  const doc={entities:[block],layers:[{id:'default',name:'0',visible:true}]};
  const display=revealDisplayEntities(doc,[block]);
  const data=drawingData(display);
  assert.ok(data.sheet.minX>=12000);assert.ok(data.sheet.minY>=8000);
  assert.ok(isDraftingResult(doc,[block]));
  assert.ok(isDraftingResult({drawingSets:{s:{kind:'section'}}},[{drawingSet:{id:'s'}}]));
  assert.equal(isDraftingResult({},[{type:'line'}]),false);
  assert.throws(()=>drawingData(Array(4001).fill({type:'line'})),/한도/);
});

test('cropped library geometry fits the selected region and retains its clipping mask',()=>{
  const mask={points:[{x:10,y:10},{x:20,y:10},{x:20,y:20},{x:10,y:20}]};
  const entities=[{type:'polyline',points:[{x:0,y:15},{x:100,y:15}],clipMasks:[mask]}];
  const data=drawingData(entities);
  assert.equal(data.sheet.minX,10);assert.equal(data.sheet.maxX,20);
  assert.equal(data.details[0].groups.flatMap(g=>g.items)[0].native.clipMasks[0],mask);
});

test('frame obeys switch, validates messages, pauses on tab switch and reuses one loaded iframe',()=>{
  const original=Object.fromEntries(['document','window','location','localStorage','IntersectionObserver'].map(k=>[k,globalThis[k]]));
  const events=new Map(),sent=[];let intersection,disconnected=false,created=0;
  const element=()=>({style:{},children:[],setAttribute(){},append(...e){this.children.push(...e);},remove(){this.removed=true;},
    addEventListener(){},removeEventListener(){},contentWindow:{postMessage:(m)=>sent.push(m)}});
  try{
    globalThis.window={addEventListener:(k,fn)=>events.set(k,fn),removeEventListener:k=>events.delete(k)};
    globalThis.document={hidden:false,createElement(){created++;return element();},addEventListener:(k,fn)=>events.set(k,fn),removeEventListener:k=>events.delete(k)};
    globalThis.location={origin:'http://localhost:8937'};
    globalThis.localStorage={getItem:()=> '0'};
    globalThis.IntersectionObserver=class{constructor(fn){intersection=fn;}observe(){}disconnect(){disconnected=true;}};
    const host={append(){}};
    assert.equal(showDraftingWait(host,[{type:'line'}]),null);assert.equal(created,0);
    globalThis.localStorage.getItem=()=> '1';
    let readyCount=0;
    const entities=[{type:'line'}],frame=showDraftingWait(host,entities,{onReady:()=>readyCount++}),iframe=frame.element.children[0];
    const receive=events.get('message');
    const before=sent.length;
    receive({source:{},origin:location.origin,data:{source:'barun-wait',kind:'drafting',event:'request-drawing'}});assert.equal(sent.length,before);
    receive({source:iframe.contentWindow,origin:location.origin,data:{source:'barun-wait',kind:'drafting',event:'request-drawing'}});
    assert.equal(sent.find(m=>m.cmd==='drawing').value.entities,entities);
    const ready={source:iframe.contentWindow,origin:location.origin,data:{source:'barun-wait',kind:'drafting',event:'ready',runId:sent.find(m=>m.cmd==='drawing').value.runId}};
    receive(ready);receive(ready);assert.equal(readyCount,1);assert.equal(frame.element.style.visibility,'visible');
    intersection([{isIntersecting:false}]);assert.equal(sent.at(-1).cmd,'pause');
    events.get('cad-document-switched')();assert.ok(frame.element.hidden);assert.equal(sent.at(-1).cmd,'pause');
    assert.equal(showDraftingWait(host,[{type:'circle'}]),frame);assert.equal(created,3);
    assert.equal(sent.filter(m=>m.cmd==='drawing').length,2);
    receive(ready);assert.equal(frame.element.style.visibility,'hidden','stale ready never opens the next result');
    destroyDraftingWait();assert.ok(frame.element.removed);assert.ok(disconnected);assert.equal(events.size,0);
  }finally{destroyDraftingWait();for(const [k,v] of Object.entries(original)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});

async function screenFixture(live=true,initialFallback=false){
  const nodes=new Map(),listeners=new Map(),frames=new Map(),posts=[];let id=0,draws=0;
  const context2d=new Proxy({canvas:{width:900,height:600},measureText:()=>({width:20}),
    createRadialGradient:()=>({addColorStop(){}}),save(){},restore(){},fillRect(){draws++;}},
    {get:(o,k)=>k in o?o[k]:(...args)=>{},set:(o,k,v)=>(o[k]=v,true)});
  const node=()=>({style:{},children:[],classList:{add(){},remove(){}},clientWidth:900,clientHeight:600,
    getContext:()=>context2d,querySelector:()=>null,appendChild(e){this.children.push(e);},removeChild(){this.children.shift();},innerHTML:'',textContent:''});
  const document={hidden:false,body:node(),head:{appendChild:e=>e.onload()},createElement:node,
    getElementById:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},fonts:{load:()=>Promise.resolve()}};
  const built=buildDetail('wall-rc-ext',{insulation:175});
  const message=(cmd,value,source=parent)=>listeners.get('message').forEach(fn=>fn({source,origin:'http://localhost:8937',data:{target:'barun-wait',cmd,value}}));
  const parent={postMessage:m=>{posts.push(m);if(m.event==='request-drawing')message('drawing',{entities:initialFallback?null:built.entities,title:built.title,scale:20,runId:1});}};
  const sandbox={drawingData,drawEntity,partialEntity,document,parent,location:{origin:'http://localhost:8937',search:live?'?embed=1&live=1':'?embed=1'},
    URLSearchParams,innerWidth:900,innerHeight:600,devicePixelRatio:1,setTimeout:fn=>fn(),
    addEventListener:(kind,fn)=>{if(!listeners.has(kind))listeners.set(kind,[]);listeners.get(kind).push(fn);},
    requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)};
  sandbox.window=sandbox;vm.createContext(sandbox);
  if(initialFallback)document.head.appendChild=e=>{
    vm.runInContext(fs.readFileSync('wait-screens/detail_data.js','utf8'),sandbox);
    message('drawing',{entities:built.entities,title:built.title,scale:20,runId:2});e.onload();
  };
  else vm.runInContext(fs.readFileSync('wait-screens/detail_data.js','utf8'),sandbox);
  // 화면 스크립트는 drafting.html 에서 drafting-main.js 로 뺐다(설치판은 이것을 따로 묶는다).
  assert.match(fs.readFileSync('wait-screens/drafting.html','utf8'),/<script type="module" src="drafting-main.js"><\/script>/);
  const js=fs.readFileSync('wait-screens/drafting-main.js','utf8').replace(/^import .*;$/gm,'');
  await vm.runInContext('(async()=>{'+js+'})()',sandbox);
  await Promise.resolve();
  const tick=now=>{const queue=[...frames.values()];frames.clear();queue.forEach(fn=>fn(now));};
  return {document,nodes,frames,posts,message,tick,get draws(){return draws;},listeners};
}

test('live screen renders real geometry, authentic progress, pause/hidden and completion stop RAF',async()=>{
  const f=await screenFixture();f.tick(1);f.tick(1000);
  assert.ok(f.draws>0);assert.ok(f.posts.some(p=>p.event==='ready'));
  f.message('pause');assert.equal(f.frames.size,0);
  f.message('resume');assert.equal(f.frames.size,1);
  f.document.hidden=true;f.listeners.get('visibilitychange').forEach(fn=>fn());assert.equal(f.frames.size,0);
  f.document.hidden=false;f.listeners.get('visibilitychange').forEach(fn=>fn());assert.equal(f.frames.size,1);
  f.message('seek',1e9);f.tick(2000);assert.equal(f.frames.size,0);assert.ok(f.posts.some(p=>p.event==='done'));
  f.message('restart');assert.equal(f.frames.size,1);
  const readyCount=f.posts.filter(p=>p.event==='ready').length;
  f.message('drawing',{entities:buildDetail('roof-flat').entities,title:'실제 지붕',scale:50});
  await Promise.resolve();await Promise.resolve();
  assert.ok(f.posts.filter(p=>p.event==='ready').length>readyCount);
  f.message('seek',1e9);f.tick(3000);assert.equal(f.frames.size,0);
});

test('example screen retains four recorded details and rejects unrelated message senders',async()=>{
  const f=await screenFixture(false);f.tick(1);
  assert.ok(f.posts.some(p=>p.event==='ready'&&p.total>0));
  f.message('pause',null,{});assert.equal(f.frames.size,1);
  f.message('pause');assert.equal(f.frames.size,0);
});

test('new actual payload received during initial example loading supersedes that example',async()=>{
  const f=await screenFixture(true,true);
  const ready=f.posts.find(p=>p.event==='ready');
  assert.equal(ready.runId,2);assert.equal(ready.total,buildDetail('wall-rc-ext',{insulation:175}).entities.length);
});

test('unrenderable real geometry explicitly falls back and the same screen accepts a later real result',async()=>{
  const f=await screenFixture();
  f.message('drawing',{entities:[{type:'line',points:[{x:0,y:0},{x:10,y:0}],clipMasks:[{points:[{x:20,y:20},{x:30,y:20},{x:30,y:30}]}]}],runId:3});
  await Promise.resolve();await Promise.resolve();
  assert.ok(f.posts.some(p=>p.event==='ready'&&p.runId===3));
  assert.ok(f.document.body.children.at(-1).textContent.startsWith('예시'));
  f.message('drawing',{entities:buildDetail('fdn-mat').entities,runId:4});
  await Promise.resolve();await Promise.resolve();
  assert.ok(f.posts.some(p=>p.event==='ready'&&p.runId===4));
  assert.ok(f.document.body.children.at(-1).textContent.startsWith('실제 생성'));
});

test('예시 자료가 없는 설치판: 실제 도형을 못 그리면 예시를 찾지 않고 창을 닫게 알린다',async()=>{
  const posts=[],listeners=[];
  const parent={postMessage:m=>{posts.push(m);if(m.event==='request-drawing')listeners.forEach(fn=>fn({source:parent,origin:'http://localhost:8937',data:{target:'barun-wait',cmd:'drawing',value:{entities:null,runId:1}}}));}};
  const sandbox={parent,location:{origin:'http://localhost:8937',search:'?embed=1&live=1'},URLSearchParams,
    addEventListener:(kind,fn)=>{if(kind==='message')listeners.push(fn);},
    document:{head:{appendChild:e=>e.onerror(new Error('404 detail_data.js'))},createElement:()=>({})}};
  sandbox.window=sandbox;vm.createContext(sandbox);
  const js=fs.readFileSync('wait-screens/drafting-main.js','utf8').replace(/^import .*;$/gm,'');
  await assert.rejects(vm.runInContext('(async()=>{'+js+'})()',sandbox));
  assert.deepEqual(posts.map(p=>p.event),['request-drawing','close']);assert.equal(posts[1].reason,'no-example');
});
