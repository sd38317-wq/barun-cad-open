import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {normalizeBuildingModel,wallOutline,buildOcctBuilding} from './occt-building.js';
import {createOcctLoader} from './occt-loader.js';
import {createOcctClient} from './occt-client.js';
import {planFrame,verticalFrame,elevationFrame,sectionHatchBoundaries} from './occt-section.js';
import {readOcctFixture} from './tools/occt-fixture.mjs';

test('사리로 실모델: mm 수치와 층별 요소를 보존하며 입력을 바꾸지 않는다',async()=>{
  const model=await readOcctFixture(),before=JSON.stringify(model),n=normalizeBuildingModel(model);
  assert.equal(n.solids.length,21);
  assert.equal(n.solids.filter(e=>e.kind==='wall').length,18);
  assert.equal(n.solids.reduce((s,e)=>s+(e.openings?.length??0),0),24);
  assert.deepEqual(n.stories.map(s=>[s.id,s.elevation,s.height]),[['s1',0,3000],['s2',3000,3000],['rf',6000,1000]]);
  assert.equal(JSON.stringify(model),before);
  assert.ok(n.ignored.length>0); // unsupported space/stair metadata remains in source
});
test('슬래브 윗면은 층 바닥+topOffset, 바닥은 두께만큼 아래다',async()=>{
  const n=normalizeBuildingModel(await readOcctFixture()),slabs=n.solids.filter(e=>e.kind==='slab');
  assert.deepEqual(slabs.map(s=>[s.bottom,s.top,s.height]),[[-200,0,200],[2800,3000,200],[5800,6000,200]]);
});
test('벽 기준선 center/left-face/right-face와 대각 방향',()=>{
  const wall={id:'w',path:[[0,0],[1000,0]],thickness:200};
  assert.deepEqual(wallOutline(wall).outline,[[0,-100],[1000,-100],[1000,100],[0,100]]);
  assert.deepEqual(wallOutline({...wall,reference:'left-face'}).outline,[[0,-200],[1000,-200],[1000,0],[0,0]]);
  assert.deepEqual(wallOutline({...wall,reference:'right-face'}).outline,[[0,0],[1000,0],[1000,200],[0,200]]);
  const g=wallOutline({...wall,path:[[0,0],[300,400]]});
  assert.equal(g.length,500);assert.ok(Math.abs(g.normal[0]+0.8)<1e-12);
});
test('정의되지 않은 벽/층과 유효하지 않은 개구부는 OCCT 로딩 전에 거절한다',async()=>{
  const original=await readOcctFixture();
  for(const mutate of [
    m=>m.units='m',
    m=>m.elements[0].story='missing',
    m=>m.elements[0].path[1]=m.elements[0].path[0],
    m=>m.elements.find(e=>e.kind==='door').host='missing',
    m=>m.elements.find(e=>e.kind==='window').width=1e9,
    m=>delete m.elements.find(e=>e.kind==='window').height,
  ]){const m=structuredClone(original);mutate(m);assert.throws(()=>normalizeBuildingModel(m));}
  const bad=structuredClone(original);bad.units='m';
  await assert.rejects(buildOcctBuilding(bad),/in mm/);
});
test('슬래브 구멍의 방향을 고치고 교차/밖에 있는 구멍을 거절한다',()=>{
  const model={format:'barun-building-model',units:'mm',stories:[{id:'s',height:3000,elevation:0}],elements:[
    {id:'sl',kind:'slab',story:'s',thickness:200,outline:[[0,0],[1000,0],[1000,1000],[0,1000]],
      holes:[[[200,200],[400,200],[400,400],[200,400]]]}]};
  const n=normalizeBuildingModel(model);
  assert.deepEqual(n.solids[0].holes[0][0],[200,400]);
  const outside=structuredClone(model);outside.elements[0].holes[0][0]=[-100,200];
  assert.throws(()=>normalizeBuildingModel(outside));
  const crossing=structuredClone(model);crossing.elements[0].outline=[[0,0],[1000,1000],[0,1000],[1000,0]];
  assert.throws(()=>normalizeBuildingModel(crossing),/self intersects/);
});
test('첫 요청 전 로더·클라이언트는 아무 일도 하지 않으며 동시 요청은 한번만 초기화한다',async()=>{
  let calls=0;
  const loader=createOcctLoader({wasmUrl:'data:application/wasm;base64,',
    initFactory:async()=>{calls++;return {wasmMemory:{buffer:new ArrayBuffer(4096)}};}});
  assert.equal(loader.getMetrics(),null);assert.equal(calls,0);
  const promises=[loader.load(),loader.load(),loader.load()];
  assert.equal(promises[0],promises[1]);const [a,b]=await Promise.all(promises);
  assert.equal(a,b);assert.equal(calls,1);assert.equal(loader.getMetrics().after.wasmHeapBytes,4096);
  const client=createOcctClient();await client.terminate();await assert.rejects(client.load(),/closed/);
});
test('실패한 첫 초기화는 재시도할 수 있다',async()=>{
  let calls=0;
  const loader=createOcctLoader({wasmUrl:'data:application/wasm;base64,',initFactory:async()=>{
    if(++calls===1)throw new Error('test failure');return {};
  }});
  await assert.rejects(loader.load(),/test failure/);await loader.load();assert.equal(calls,2);
});
test('Worker는 잘못된 입력을 전달하고 종료 후 재실행하지 않는다',async()=>{
  const client=createOcctClient({timeoutMs:15000});
  try{await assert.rejects(client.build({format:'wrong'}),/in mm/);}finally{await client.terminate();}
  await assert.rejects(client.build({}),/closed/);
});
test('수평면, 임의 선의 세로면, 입면의 오른손 좌표계',()=>{
  assert.deepEqual(planFrame(1200).origin,[0,0,1200]);
  const frame=verticalFrame([100,200],[400,600]);
  assert.ok(Math.abs(frame.x[0]-0.6)<1e-12);
  assert.ok(Math.abs(frame.normal[0]-0.8)<1e-12);
  assert.deepEqual(elevationFrame([0,-1,0]).x,[1,0,-0]);
  assert.throws(()=>verticalFrame([0,0],[0,0]),/Zero/);
  assert.throws(()=>elevationFrame([0,0,1]),/vertical/);
});
const square=(x,y,size)=>[
  {x,y},{x:x+size,y},{x:x+size,y:y+size},{x,y:y+size},
];
const lines=points=>points.map((p,i)=>({type:'line',points:[p,points[(i+1)%points.length]]}));
test('해치 경계: 순서 섞인 선, 구멍, 분리된 섬을 구별한다',()=>{
  const entities=[...lines(square(0,0,100)),...lines(square(20,20,20)),...lines(square(200,200,30))].reverse();
  const boundaries=sectionHatchBoundaries(entities);
  assert.equal(boundaries.length,2);
  assert.equal(boundaries.reduce((n,b)=>n+b.holes.length,0),1);
  assert.ok(boundaries.every(b=>b.layer==='A-WALL-CONC'));
  assert.throws(()=>sectionHatchBoundaries(entities.slice(1)),/open or branching/);
});

test('DXF는 mm·실제 CRLF·표준 선 두께·truecolor·숨은선 패턴을 기록하고 PNG를 만든다',async()=>{
  const {occtDocumentDxf,occtDocumentPng,writeOcctArtifacts}=await import('./tools/occt-artifacts.mjs');
  const doc={version:2,units:'mm',layers:[{id:'wall',name:'A-WALL-CONC',color:'#ffff00',lineweight:0.35}],
    entities:[
      {id:'l',type:'line',layer:'wall',lineweight:0.13,linetype:'HIDDEN',points:[{x:-100,y:0},{x:900,y:0}]},
      {id:'a',type:'arc',layer:'wall',center:{x:200,y:300},radius:100,startAngle:350,endAngle:10},
      {id:'p',type:'polyline',layer:'wall',closed:true,points:[{x:0,y:0},{x:1000,y:0},{x:1000,y:700},{x:0,y:700}]},
    ]};
  const dxf=occtDocumentDxf(doc),lines=dxf.trim().split(/\r?\n/);
  assert.equal(lines.length%2,0);assert.equal(lines.at(-1),'EOF');
  const pairs=Array.from({length:lines.length/2},(_,i)=>[lines[2*i],lines[2*i+1]]);
  assert.ok(pairs.some(([code,v])=>code==='370'&&v==='35'));
  assert.ok(pairs.some(([code,v])=>code==='370'&&v==='13'));
  assert.ok(pairs.some(([code,v])=>code==='420'&&v==='16776960'));
  assert.ok(pairs.some(([code,v])=>code==='49'&&v==='-1.5'));
  assert.ok(pairs.some(([code,v])=>code==='6'&&v==='HIDDEN'));
  assert.ok(pairs.some(([code,v])=>code==='10'&&v==='-100'));
  const png=occtDocumentPng(doc);
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(png.readUInt32BE(16),1400);assert.equal(png.readUInt32BE(20),900);
  await assert.rejects(writeOcctArtifacts(doc,{directory:'tmp/occt-spike',name:'../escape'}),/filename/);
});

test('Electron 렌더러는 process가 있어도 브라우저 로더와 Web Worker 경로를 쓴다',async()=>{
  const previousWindow=globalThis.window,previousWorker=globalThis.Worker;
  let creations=0,terminations=0;
  globalThis.window={};
  globalThis.Worker=class{
    handlers=new Map();
    constructor(url,options){creations++;assert.ok(url.href.endsWith('occt-worker.js'));assert.equal(options.type,'module');}
    addEventListener(name,fn){this.handlers.set(name,fn);}
    postMessage(message){queueMicrotask(()=>this.handlers.get('message')({data:{id:message.id,result:'browser-contract'}}));}
    terminate(){terminations++;}
  };
  try{
    const loader=createOcctLoader({wasmUrl:'file:///deliberately-missing.wasm',
      initFactory:async()=>({wasmMemory:{buffer:new ArrayBuffer(1024)}})});
    await loader.load();assert.equal(loader.getMetrics().after.wasmHeapBytes,1024);
    assert.equal(loader.getMetrics().after.process,undefined);
    const client=createOcctClient();
    assert.equal(creations,0);assert.equal(await client.load(),'browser-contract');
    await client.terminate();assert.equal(creations,1);assert.equal(terminations,1);
  }finally{
    if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;
    if(previousWorker===undefined)delete globalThis.Worker;else globalThis.Worker=previousWorker;
  }
});

test('miter는 같은 층·높이·center·정확한 두 끝점만 연결하고 원본·개구부 좌표를 보존한다',()=>{
  const base={format:'barun-building-model',units:'mm',
    stories:[{id:'s',elevation:0,height:3000},{id:'other',elevation:0,height:3000}],elements:[
      {id:'a',kind:'wall',story:'s',path:[[0,0],[1000,0]],thickness:200},
      {id:'b',kind:'wall',story:'s',path:[[0,0],[0,1000]],thickness:200},
      {id:'door',kind:'door',host:'a',offset:400,width:300,height:2100},
    ]};
  const before=JSON.stringify(base),joined=normalizeBuildingModel(base);
  assert.equal(JSON.stringify(base),before);
  assert.deepEqual(joined.solids[0].path,base.elements[0].path);
  assert.deepEqual(joined.solids[0].outline,[[-100,-100],[1000,-100],[1000,100],[100,100]]);
  assert.deepEqual(joined.solids[0].openings[0].outline,[[400,-102],[700,-102],[700,102],[400,102]]);
  for(const mutate of [
    m=>m.elements[1].story='other',
    m=>m.elements[1].height=2500,
    m=>m.elements[1].baseOffset=100,
    m=>m.elements[1].reference='left-face',
    m=>m.elements[1].path[0]=[0.0000001,0],
    m=>m.elements[1].path[1]=[-1000,0],
    m=>m.elements.push({id:'c',kind:'wall',story:'s',path:[[0,0],[-1000,0]],thickness:200}),
  ]){
    const model=structuredClone(base);mutate(model);
    const normalized=normalizeBuildingModel(model);
    assert.deepEqual(normalized.solids[0].outline,wallOutline(model.elements[0]).outline);
  }
});

test('끝점 두 개여도 같은 높이의 통과벽이 있으면 세 갈래 접합으로 miter를 생략한다',()=>{
  for(const [story,baseOffset,height,skip]of [
    ['s',0,3000,true],['s',2500,1000,true],['s',3000,1000,false],['other',0,3000,false],
  ]){
    const model={format:'barun-building-model',units:'mm',
      stories:[{id:'s',elevation:0,height:3000},{id:'other',elevation:0,height:3000}],elements:[
        {id:'a',kind:'wall',story:'s',path:[[0,0],[1000,0]],thickness:200},
        {id:'b',kind:'wall',story:'s',path:[[0,0],[0,1000]],thickness:200},
        {id:'through',kind:'wall',story,path:[[-1000,-1000],[1000,1000]],thickness:200,baseOffset,height},
      ]};
    const a=normalizeBuildingModel(model).solids[0];
    assert.deepEqual(a.outline[0],skip?[0,-100]:[-100,-100]);
  }
});
