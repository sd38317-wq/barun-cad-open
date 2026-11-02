import test from 'node:test';import assert from 'node:assert/strict';import {connectBridge} from './bridge-client.js';
test('cancelled beforeunload keeps polling; actual pagehide ends polling',async()=>{
 const original={window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout};const handlers={},timers=[];let pulses=0;
 globalThis.window={addEventListener:(name,fn)=>handlers[name]=fn};globalThis.document={hasFocus:()=>true};globalThis.setTimeout=fn=>timers.push(fn);
 try{
  connectBridge({context:{engine:{doc:{entities:[{id:'one'}]},onChange(){}},selected:()=>new Set(),getCommandSettings:()=>({})},getFolder:()=>'',api:async()=>{pulses++;return {requests:[]};}});
  await Promise.resolve();await Promise.resolve();handlers.beforeunload?.();await timers.shift()();assert.equal(pulses,2);assert.equal(timers.length,1);
  handlers.pagehide();await timers.shift()();assert.equal(timers.length,0);
 }finally{Object.assign(globalThis,original);}
});

test('AI 눈: 영역 고르기(창 > 객체 > 화면 > 전체)와 여백 없이 자른 출력 SVG',async()=>{
 const {viewWindow,viewSvg}=await import('./bridge-client.js');const {newDrawingDocument}=await import('./engine.js');
 const doc=newDrawingDocument(),layer=doc.layers[0].id;
 doc.entities=[{id:'a',type:'line',layer,points:[{x:0,y:0},{x:10000,y:0}]},{id:'b',type:'circle',layer,center:{x:5000,y:3000},radius:1000}];
 assert.deepEqual(viewWindow(doc,{window:{minX:0,minY:0,maxX:100,maxY:50}}),{minX:0,minY:0,maxX:100,maxY:50});
 const one=viewWindow(doc,{ids:['b']});assert.ok(one.minX<4000&&one.maxX>6000&&one.maxX<6200,JSON.stringify(one));
 assert.deepEqual(viewWindow(doc,{scope:'screen'},{minX:1,minY:2,maxX:3,maxY:4}).minX<1,true);
 assert.throws(()=>viewWindow(doc,{scope:'screen'},{minX:5,minY:5,maxX:5,maxY:5}),/화면 크기/);
 const all=viewWindow(doc,{});assert.ok(all.minX<0&&all.maxX>10000&&all.maxY>4000);
 assert.throws(()=>viewWindow(doc,{ids:['없음']}),/없는 객체/);
 const svg=viewSvg(doc,all),[w,h]=/width="([\d.]+)mm" height="([\d.]+)mm"/.exec(svg).slice(1).map(Number);
 assert.ok(Math.abs(w/h-(all.maxX-all.minX)/(all.maxY-all.minY))<1e-6,'그림 비율 = 영역 비율(용지 여백 없음)');
 assert.match(svg,/<circle|<path|<line/);
});

test('AI 기록 재현: cad_view_drawing 이 x0~y1 영역·좌표 깨진 객체에도 볼 영역을 만든다(10/12 9건)',async()=>{
 const {viewWindow}=await import('./bridge-client.js');const {newDrawingDocument}=await import('./engine.js');
 const doc=newDrawingDocument(),layer=doc.layers[0].id;
 doc.entities=[{id:'a',type:'line',layer,points:[{x:0,y:0},{x:10000,y:0}]},{id:'bad',type:'line',layer,points:[{x:NaN,y:0},{x:1,y:1}]}];
 assert.deepEqual(viewWindow(doc,{window:{x0:100,y0:50,x1:0,y1:0}}),{minX:0,minY:0,maxX:100,maxY:50});
 const all=viewWindow(doc,{});assert.ok(Number.isFinite(all.minX)&&all.maxX>10000);
 assert.throws(()=>viewWindow(doc,{window:{left:0}}),/window 는 \{minX/);
 assert.throws(()=>viewWindow(newDrawingDocument(),{}),/비어 있어/);
});
