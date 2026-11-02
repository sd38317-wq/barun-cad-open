import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {runScripted,scriptedCommandNames,NeedInput} from './command-runner.js';
import {resolveCommand} from './commands.js';
import {buildingModelEntries,planReferences,sectionOptions,elevationDirection,insertOcctView,createOcctDrawingService,installOcctCommands} from './occt-commands.js';

const model=()=>({format:'barun-building-model',units:'mm',stories:[{id:'s1',name:'1층',elevation:0,height:3000}],elements:[
 {id:'w1',kind:'wall',story:'s1',path:[[0,0],[3000,0]],thickness:200},
 {id:'w2',kind:'wall',story:'s1',path:[[3000,0],[3000,2000]],thickness:200},
 {id:'door',kind:'door',story:'s1',host:'w1',offset:1000,width:900,height:2100},
 {id:'slab',kind:'slab',story:'s1',outline:[[0,0],[3000,0],[3000,2000],[0,2000]],thickness:200}
]});
function setup(){const engine=new DrawingEngine();engine.execute({type:'load',document:{...engine.doc,drawingSets:{building:{kind:'plan',model:model(),options:{origin:{x:5000,y:6000}}}}}});engine.undoStack=[];engine.redoStack=[];return engine;}
const fakeView=()=>({entities:[{id:'fixed',type:'line',layer:'A-WALL-CONC',occtRole:'cut',points:[{x:10,y:20},{x:110,y:20}]}],hatchBoundaries:[{outer:[{x:10,y:20},{x:110,y:20},{x:110,y:120},{x:10,y:120}],holes:[[{x:30,y:40},{x:30,y:60},{x:50,y:60},{x:50,y:40}]]}],metadata:{kind:'plan'}});
const request=(m=model())=>({model:m,modelSetId:'building',kind:'plan',options:{story:'s1'},origin:{x:1000,y:2000}});

test('세 명령은 명령 목록·한글 이름·화면 없는 등록부에 있다',()=>{
 for(const [word,name] of [['평면도 만들기','OCCTPLAN'],['단면도 만들기','OCCTSECTION'],['입면도 만들기','OCCTELEVATION']]){assert.equal(resolveCommand(word),name);assert.ok(scriptedCommandNames().includes(name));}
});
test('모델이 없으면 Worker를 만들지 않고 한국어로 안내한다',async()=>{
 const engine=new DrawingEngine(),before=engine.doc,old=globalThis.Worker;let workers=0;globalThis.Worker=class{constructor(){workers++;}};
 try{await assert.rejects(runScripted(engine,'OCCTPLAN'),/3D 건물 모델이 없습니다/);assert.equal(workers,0);assert.equal(engine.doc,before);}finally{globalThis.Worker=old;}
});
test('건물 모델은 기존 drawingSets에서만 고른다',()=>{
 const e=setup();e.doc.drawingSets.detail={kind:'details',model:{stories:[],elements:[]}};assert.deepEqual(buildingModelEntries(e.doc).map(e=>e.id),['building']);
});
test('잘못된 절단 높이는 생성하기 전에 거부한다',async()=>{
 for(const height of [-1,3,'','NaN']){const e=setup(),before=e.doc;await assert.rejects(runScripted(e,'OCCTPLAN',{form:{height},points:[[0,0]]}),/절단 높이/);assert.equal(e.doc,before);}
});
test('Esc와 입력 부족은 모델·레이어·객체를 바꾸지 않는다',async()=>{
 const e=setup(),before=e.doc;await runScripted(e,'OCCTPLAN',{points:[null]});assert.equal(e.doc,before);
 await assert.rejects(runScripted(e,'OCCTSECTION',{points:[[0,0]]}),NeedInput);assert.equal(e.doc,before);
});
test('단면의 세 점은 기준 평면 원점과 좌우 방향을 따른다',()=>{
 assert.deepEqual(sectionOptions([5000,6000],[8000,6000],[5000,7000],{x:5000,y:6000}),{start:[0,0],end:[3000,0],side:'left'});
 assert.equal(sectionOptions([0,0],[3,0],[0,-1]).side,'right');
 assert.throws(()=>sectionOptions([0,0],[0,0],[1,0]),/두 점/);assert.throws(()=>sectionOptions([0,0],[3,0],[1,0]),/바라볼 쪽/);
});
test('동서남북과 임의 입면 방향은 관찰자로 향한다',()=>{
 assert.deepEqual(elevationDirection('south'),[0,-1,0]);assert.deepEqual(elevationDirection('north'),[0,1,0]);
 assert.deepEqual(elevationDirection('east'),[1,0,0]);assert.deepEqual(elevationDirection('west'),[-1,0,0]);
 assert.ok(Math.abs(elevationDirection('custom',90)[1]-1)<1e-10);assert.throws(()=>elevationDirection('custom',''),/각도/);
});
test('삽입은 표준 레이어·콘크리트 무늬·구멍·원본 보존·고유 ID를 지킨다',()=>{
 const e=setup(),before=structuredClone(e.doc),a=insertOcctView(e.doc,fakeView(),request()),b=insertOcctView(a.document,fakeView(),request());
 assert.deepEqual(e.doc,before);assert.equal(new Set(b.document.entities.map(e=>e.id)).size,b.document.entities.length);
 const hatch=a.document.entities.find(e=>e.type==='hatch');assert.equal(hatch.patternName,'AR-CONC');assert.equal(hatch.solid,false);
 assert.equal(a.document.layers.find(l=>l.id===hatch.layer).name,'A-HATCH');assert.deepEqual(hatch.points[0],{x:1000,y:2000});assert.deepEqual(hatch.loops[0][0],{x:1020,y:2020});
 const check=new DrawingEngine();check.execute({type:'load',document:a.document});
 assert.equal(planReferences(a.document,buildingModelEntries(a.document)[0]).at(-1).id,a.viewId);
});
test('잠긴 표준 레이어와 빈 결과는 원본을 바꾸지 않고 거부한다',()=>{
 const e=setup();e.doc.layers.push({id:'locked',name:'A-HATCH',locked:true,visible:true});const before=structuredClone(e.doc);
 assert.throws(()=>insertOcctView(e.doc,fakeView(),request()),/잠금/);assert.deepEqual(e.doc,before);
 assert.throws(()=>insertOcctView(e.doc,{entities:[]},request()),/형상이 없습니다/);
});
test('지연 서비스는 첫 호출 전 엔진 작업 0, 같은 모델 캐시, 모델 변경 때 dispose',async()=>{
 let created=0,loads=0,builds=0,disposes=0,stops=0;
 const s=createOcctDrawingService({idleMs:0,clientFactory:()=>{created++;return{load:async()=>{loads++;},build:async()=>({handle:String(++builds)}),plan:async()=>fakeView(),dispose:async()=>{disposes++;},terminate:async()=>{stops++;}};}});
 assert.equal(created,0);try{const e=setup();await s.generate(e.doc,request());await s.generate(e.doc,request());assert.equal(builds,1);
 const m=model();m.elements[0].thickness=250;await s.generate(e.doc,request(m));assert.equal(builds,2);assert.equal(disposes,1);assert.equal(loads,1);}finally{await s.close();}assert.equal(stops,1);
});
test('엔진 오류 후 다음 호출은 새 Worker로 재시도한다',async()=>{
 let n=0,stops=0;const s=createOcctDrawingService({idleMs:0,clientFactory:()=>{const first=++n===1;return{load:async()=>{if(first)throw Error('WASM 로딩 실패');},build:async()=>({handle:'1'}),plan:async()=>fakeView(),terminate:async()=>{stops++;}};}});
 try{await assert.rejects(s.generate(setup().doc,request()),/WASM 로딩 실패/);await s.generate(setup().doc,request());assert.equal(n,2);assert.equal(stops,1);}finally{await s.close();}
});
test('유휴 종료와 close는 WASM Worker를 해제한다',async()=>{
 let cb,stops=0;const s=createOcctDrawingService({idleMs:1,setTimer:f=>{cb=f;return 1;},clearTimer:()=>{},clientFactory:()=>({load:async()=>{},build:async()=>({handle:'1'}),plan:async()=>fakeView(),terminate:async()=>{stops++;}})});
 await s.generate(setup().doc,request());await cb();assert.equal(stops,1);await s.close();await assert.rejects(s.generate(setup().doc,request()),/종료/);
});
test('Worker 응답 동안 도면이 바뀌면 결과를 적용하지 않는다',async()=>{
 let doc=setup().doc,applied=0;const ctx={doc:()=>doc,selected:()=>[],form:(t,f,cb)=>cb(Object.fromEntries(f.map(x=>[x.name,x.value]))),pickPoint:async()=>({x:0,y:0}),generateOcctView:async(source)=>{const r=insertOcctView(source,fakeView(),request());doc={...source,name:'other'};return r;},execute:()=>{applied++;}};
 await assert.rejects(installOcctCommands(ctx).OCCTPLAN(),/도면이 변경/);assert.equal(applied,0);
});
for(const [name,inputs] of [
 ['OCCTPLAN',{points:[[10000,20000]]}],
 ['OCCTSECTION',{points:[[5000,6100],[8000,6100],[6000,7000],[10000,20000]]}],
 ['OCCTELEVATION',{form:{face:'custom',angle:25},points:[[10000,20000]]}]
]) test(name+' 실제 Worker 결과를 한 번에 삽입하고 undo/redo',async()=>{
 const e=setup(),before=e.doc,result=await runScripted(e,name,inputs);assert.ok(result.added.length>0);
 const layers=new Map(e.doc.layers.map(l=>[l.id,l.name]));assert.ok(e.doc.entities.every(x=>layers.get(x.layer).startsWith('A-')));
 if(name!=='OCCTELEVATION')assert.ok(e.doc.entities.some(x=>x.type==='hatch'&&layers.get(x.layer)==='A-HATCH'));
 assert.equal(e.undoStack.length,1);const after=e.doc;e.execute({type:'undo'});assert.equal(e.doc,before);e.execute({type:'redo'});assert.equal(e.doc,after);
});

test('이동한 OCCT 평면은 실제 이동량을 반영하고 부분 편집·복사를 거부한다',()=>{
 const e=setup(),r=insertOcctView(e.doc,fakeView(),request());e.execute({type:'load',document:r.document});
 e.execute({type:'move',ids:r.added,dx:5000,dy:-3000});
 const ref=planReferences(e.doc,buildingModelEntries(e.doc)[0]).at(-1);
 assert.deepEqual(ref.translation,{x:5990,y:-1020});
 assert.deepEqual(sectionOptions([6000,-1000],[6100,-1000],[6000,-900],ref.translation).start,[10,20]);
 e.execute({type:'move',ids:[r.added[0]],dx:1,dy:0});assert.ok(planReferences(e.doc,buildingModelEntries(e.doc)[0]).at(-1).invalid);
 e.execute({type:'undo'});e.execute({type:'copy',ids:r.added,dx:1000,dy:0});assert.ok(planReferences(e.doc,buildingModelEntries(e.doc)[0]).at(-1).invalid);
});
test('첫 로딩 대기 중 close하면 build를 진행하지 않고 Worker를 종료한다',async()=>{
 let release,builds=0,stops=0;const wait=new Promise(r=>{release=r;});
 const s=createOcctDrawingService({idleMs:0,clientFactory:()=>({load:()=>wait,build:async()=>{builds++;return{handle:'1'};},terminate:async()=>{stops++;}})});
 const task=s.generate(setup().doc,request());await Promise.resolve();await s.close();release();
 await assert.rejects(task,/종료/);assert.equal(builds,0);assert.equal(stops,1);
});

test('이전 도면 한 벌의 검증되지 않은 배치 원점은 단면 기준으로 쓰지 않는다',()=>{const e=setup();e.doc.drawingSets.building.kind='set';e.doc.drawingSets.building.selected=[];assert.deepEqual(planReferences(e.doc,buildingModelEntries(e.doc)[0]).map(r=>r.id),['model']);});
