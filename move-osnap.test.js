import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as G from './geometry.js';
import * as IA from './input-assist.js';
import {snapIntersections} from './snap-intersections.js';

const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const section=(a,b)=>{const start=source.indexOf(a),end=source.indexOf(b,start);assert.ok(start>=0&&end>start);return source.slice(start,end);};
const p=(x,y)=>({x,y});
function runner(entity,option,mode='MOVE',target=false){
 const entities=[{id:'selected',layer:'A-GRID',...entity}];
 const c={G,IA,assist:IA.createInputAssist(),engine:{doc:{entities}},scale:10,mode,phase:'point',
  points:target?[p(-100,-100)]:[],params:{},drag:null,selected:new Set(['selected']),
  orthogonalInput:q=>q,num:()=>16,sceneRevision:1,visibleGeneration:1,visible:()=>entities,entityMap:()=>new Map(entities.map(e=>[e.id,e])),
  snapIntersections,$:id=>({checked:id==='osnap'||id==='snap-'+option}),aiReveal:null,
  finishAIReveal:()=>{c.aiReveal=null;c.finished=(c.finished||0)+1;}};
 vm.createContext(c);
 c.assist.prefs.osnapOptions=0;
 vm.runInContext(section('function snap(p)', '// 직교(F8)')+'\n'+section('function nearby(', '// Snap and pick candidates.')+
  '\n'+section('function currentSnapOptions(){','// 303·309:'),c);
 c.nearby.objects=G.spatialIndex(entities);c.nearby.objectsRevision=1;c.nearby.objectsGeneration=1;
 c.pickGeneration=()=>1;
 return c;
}
const cases=[
 ['line end',{type:'line',points:[p(0,0),p(20,0)]},'end',p(0,0)],
 ['line midpoint',{type:'line',points:[p(0,0),p(20,0)]},'mid',p(10,0)],
 ['polyline end',{type:'polyline',points:[p(0,0),p(20,0),p(20,20)]},'end',p(20,20)],
 ['polyline midpoint',{type:'polyline',points:[p(0,0),p(20,0),p(20,20)]},'mid',p(20,10)],
 ['CENTER circle center',{type:'circle',linetype:'CENTER',center:p(0,0),radius:20},'center',p(0,0)],
 ...[0,90,180,270].map(angle=>['CENTER circle quadrant '+angle,{type:'circle',linetype:'CENTER',center:p(0,0),radius:20},'quadrant',G.polar(20,angle)]),
 ['arc endpoint',{type:'arc',center:p(0,0),radius:20,startAngle:10,endAngle:60},'end',G.polar(20,10)],
 ['arc midpoint',{type:'arc',center:p(0,0),radius:20,startAngle:10,endAngle:60},'mid',G.polar(20,35)],
 ['arc center outside ink bounds',{type:'arc',center:p(0,0),radius:20,startAngle:10,endAngle:60},'center',p(0,0)],
 ['arc quadrant',{type:'arc',center:p(0,0),radius:20,startAngle:10,endAngle:160},'quadrant',p(0,20)],
 ['ellipse center',{type:'ellipse',center:p(0,0),majorAxis:p(20,0),ratio:.5},'center',p(0,0)],
 ['ellipse quadrant',{type:'ellipse',center:p(0,0),majorAxis:p(20,0),ratio:.5},'quadrant',p(0,10)],
 ['rotated ellipse quadrant',{type:'ellipse',center:p(3,4),majorAxis:p(20,10),ratio:.5},'quadrant',p(-2,14)],
 ['ellipse arc end',{type:'ellipse',center:p(0,0),majorAxis:p(20,0),ratio:.5,startParam:.2,endParam:2},'end',p(20*Math.cos(.2),10*Math.sin(.2))],
 ['ellipse arc midpoint',{type:'ellipse',center:p(0,0),majorAxis:p(20,0),ratio:.5,startParam:.2,endParam:2},'mid',p(20*Math.cos(1.1),10*Math.sin(1.1))],
 ['text insert',{type:'text',position:p(0,0),text:'Y6',height:5},'insert',p(0,0)],
 ['multiline text insert',{type:'text',position:p(0,0),text:'Y6\n2800',height:5},'insert',p(0,0)],
 ['mtext insert',{type:'mtext',position:p(0,0),text:'Y6\n2800',height:5},'insert',p(0,0)],
 ['block insert outside child bounds',{type:'block',position:p(0,0),entities:[{type:'line',points:[p(100,100),p(120,100)]}]},'insert',p(0,0)],
 ['nested block insert',{type:'block',entities:[{type:'block',position:p(0,0),entities:[{type:'line',points:[p(100,100),p(120,100)]}]}]},'insert',p(0,0)],
 ...[p(0,0),p(2800,0),p(0,500)].map((q,i)=>['dimension definition '+i,{type:'dimension',mode:'horizontal',points:[p(0,0),p(2800,0),p(0,500)],textHeight:50},'end',q]),
 ['dimension text',{type:'dimension',mode:'horizontal',points:[p(0,0),p(2800,0),p(0,500)],textHeight:50,textPosition:p(1400,650)},'insert',p(1400,650)],
 ['hatch boundary end',{type:'hatch',points:[p(0,0),p(20,0),p(20,20)]},'end',p(0,0)],
 ['hatch boundary midpoint',{type:'hatch',points:[p(0,0),p(20,0),p(20,20)]},'mid',p(10,0)],
 ['hatch second loop',{type:'hatch',points:[p(100,100),p(120,100),p(120,120)],loops:[[p(0,0),p(20,0),p(20,20)]]},'end',p(0,0)],
 ['dense hatch second loop',{type:'hatch',points:Array.from({length:300},(_,i)=>p(100+20*Math.cos(i/300*Math.PI*2),100+20*Math.sin(i/300*Math.PI*2))),loops:[[p(0,0),p(20,0),p(20,20)]]},'end',p(0,0)],
 ['point node',{type:'point',position:p(0,0)},'node',p(0,0)],
];
for(const mode of ['MOVE','COPY'])for(const target of [false,true])for(const [name,entity,option,q] of cases){
 test(`${mode} ${target?'target':'base'} snaps selected ${name}`,()=>{
  const c=runner(entity,option,mode,target),got=c.snap(p(q.x+.01,q.y+.02),c.currentSnapOptions());
  assert.equal(got.snapped,true,JSON.stringify(got));
  assert.ok(G.dist(got,q)<1e-8,JSON.stringify(got));
 });
}
test('stalled reveal cannot disable snap or picking queries',()=>{
 const c=runner({type:'circle',center:p(0,0),radius:20},'center');
 c.aiReveal={hiddenIds:new Set(['selected'])};
 assert.equal(c.snap(p(.01,.02)).snapped,true);assert.ok(!c.finished,'커서 이동만으로 연출을 끊지 않는다');
 c.aiReveal={};assert.equal(c.nearby(p(20,0),1).length,1);
});
test('command start ends reveal before command guards or selection changes',()=>{
 const c={aiReveal:{},busy:true,finishAIReveal(){c.aiReveal=null;c.finished=true;},traceInput(){},inputState(){}};
 vm.runInNewContext(section('function run(name) {',' // 206:')+'}',c);
 c.run('MOVE');assert.equal(c.finished,true);
});
test('dimension definition anchors do not create phantom strokes',()=>{
 const e={id:'dim',type:'dimension',mode:'horizontal',points:[p(0,0),p(2800,0),p(0,500)],textHeight:50};
 const box={minX:-1,minY:-1,maxX:2801,maxY:1000};
 const anchor=G.querySnapPrimitives(e,box).find(part=>part.snapDefinitionPoints);
 assert.deepEqual(G.snapGeometry(anchor,p(1400,250),3000).segments,[]);
 for(const option of ['mid','nearest','intersection']){
  assert.equal(runner(e,option).snap(p(1400.01,250.02)).snapped,undefined);
 }
});
test('explicit hatch exclusion and monitor votes still apply',()=>{
 const c=runner({type:'hatch',points:[p(0,0),p(20,0),p(20,20)]},'end');
 c.assist.prefs.osnapOptions=1;assert.equal(c.snap(p(.01,.02)).snapped,undefined);
 const d=runner({type:'circle',center:p(0,0),radius:20},'center');
 d.assist.inputPoints.addMonitor({excludeEntities:()=>['selected']});
 assert.equal(d.snap(p(.01,.02)).snapped,undefined);
});
test('block clipping applies to insertion and dimension anchors',()=>{
 const mask=[p(-5,-5),p(5,-5),p(5,5),p(-5,5)];
 for(const inverted of [false,true]){
  const e={type:'block',position:p(0,0),clip:{enabled:true,inverted,points:mask},entities:[{type:'line',points:[p(-10,0),p(10,0)]}]};
  const c=runner(e,'insert');assert.equal(c.snap(p(.01,.02)).snapped,inverted?undefined:true);
 }
});
test('shared translated instance retains nested anchors beyond ink without materializing children',()=>{
 const child={type:'block',layer:'0',position:p(0,0),entities:[{type:'line',layer:'0',points:[p(100,100),p(120,100)]}]};
 const make=(id,x)=>({id,type:'block',layer:'0',sharedBlock:'B',position:p(x,0),scale:1,rotation:0,entities:[]});
 const doc={layers:[{id:'0',visible:true,color:'#fff'}],sharedBlocks:{B:{origin:p(0,0),entities:Array.from({length:128},()=>structuredClone(child))}},entities:[make('a',0),make('b',1000)]};
 G.prepareSharedDrawingReferences(doc);
 const first=G.visibleEntities(doc,{entities:[doc.entities[0]],inPlace:true})[0];
 assert.deepEqual(G.bounds([doc.entities[0]]),G.bounds([G.materializeSharedDrawingReference(doc,doc.entities[0])]));
 const second=G.visibleEntities(doc,{entities:[doc.entities[1]],inPlace:true,reuseDisplays:[first]})[0];
 assert.ok(G.getDisplayInstance(second));const getter=Object.getOwnPropertyDescriptor(second,'entities').get;
 const box={minX:999,minY:-1,maxX:1001,maxY:1};
 assert.equal(G.spatialIndex([second]).query(box).length,0,'먼 기준점은 공간 색인 상자 밖(고른 블록만 nearby 가 따로 넣는다)');
 const parts=G.querySnapPrimitives(second,box);assert.ok(parts.some(e=>e.position?.x===1000&&e.position?.y===0));
 assert.equal(Object.getOwnPropertyDescriptor(second,'entities').get,getter);
});

test('shared snap bounds do not expand rendering or zoom extents',()=>{
 const e={id:'ref',type:'block',layer:'0',sharedBlock:'B',position:p(0,0),scale:1,entities:[]};
 const doc={layers:[{id:'0',visible:true}],entities:[e],sharedBlocks:{B:{origin:p(0,0),entities:[{type:'line',layer:'0',points:[p(100000,100000),p(100020,100010)]}]}}};
 G.prepareSharedDrawingReferences(doc);
 assert.deepEqual(G.bounds([e]),{minX:100000,minY:100000,maxX:100020,maxY:100010});
 // 먼 삽입점은 공간 색인 상자에 넣지 않는다(큰 도면 스냅 50배 느려짐, 7.0.25). 고른 블록은 nearby() 가 따로 넣는다.
 assert.equal(G.spatialIndex([e]).query({minX:-1,minY:-1,maxX:1,maxY:1}).length,0);
});
