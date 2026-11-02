import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as G from './geometry.js';
import {DrawingEngine} from './engine.js';
import * as S4 from './edit-commands-s4.js';
const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const start=source.indexOf('async function pickHatch('),end=source.indexOf('/* RECTANGLE',start);
const rect=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
// 2×2 표 칸(100×50). 클릭한 점이 든 칸을 서버(/api/hatch-boundary)처럼 돌려준다.
const cellBoundary=p=>{const i=Math.floor(p.x/100),j=Math.floor(p.y/50);return {points:rect(i*100,j*50,i*100+100,j*50+50),loops:[]};};
function fixture(){
 const engine=new DrawingEngine();
 const c={run:Object.assign(function(){},{}),busy:false,params:{},mode:'HATCH',activeLayer:engine.doc.layers[0].id,engine,G,JSON,toast(){},updatePrompt(){},render(){},canvas:{focus(){}},selectedIds:[],
  setSelected(ids){c.selectedIds=[...ids];},hatchPatternChoices:()=>[],hatchPatternFields:(pattern,opts)=>({pattern,...opts}),
  request:async(_url,{point})=>cellBoundary(point),form:(_title,fields,apply)=>{c.fields=fields;c.apply=apply;},$:()=>({querySelector:()=>null}),
  execute:command=>engine.execute(command),
  addEntities:es=>engine.execute({type:'add.classified',entities:es.map(e=>({...e,layer:e.layer||c.activeLayer}))})};
 // Exercise the real flow through form creation; preview painting is tested separately.
 let code=source.slice(start,end);code=code.slice(0,code.indexOf("  const preview=document.createElement('canvas')"))+" }catch(e){toast(e.message,true);}finally{busy=false;} }";
 vm.createContext(c);vm.runInContext(code,c);return c;
}
const hatches=c=>c.engine.doc.entities.filter(e=>e.type==='hatch');
const style={pattern:'ANSI31',scale:'100',angle:'30',color:'#abcdef'};
test('hatch initial apply keeps command active and next region joins the same hatch with the exact style',async()=>{
 const c=fixture();await c.pickHatch({x:10,y:10});assert.equal(c.engine.doc.entities.length,0);
 c.apply(style);assert.equal(c.mode,'HATCH');
 await c.pickHatch({x:110,y:10});
 const hs=hatches(c);assert.equal(hs.length,1);
 assert.equal(hs[0].pattern,'ANSI31');assert.equal(hs[0].scale,100);assert.equal(hs[0].angle,30);assert.equal(hs[0].color,'#abcdef');
 assert.equal(G.hatchRings(hs[0]).length,2);assert.deepEqual(c.selectedIds,[hs[0].id]);
});
test('4 adjacent table cells picked in one HATCH command = one hatch with 4 loops; one undo removes it all',async()=>{
 const c=fixture(),before=c.engine.doc,undoDepth=c.engine.undoStack.length;
 await c.pickHatch({x:10,y:10});c.apply(style);
 for(const p of [{x:110,y:10},{x:10,y:60},{x:110,y:60}])await c.pickHatch(p);
 const hs=hatches(c);assert.equal(hs.length,1,'한 명령에서 찍은 칸은 해치 하나');
 const h=hs[0];assert.equal(G.hatchRings(h).length,4);assert.equal(G.hatchRegions(h).length,4);
 assert.ok(Math.abs(G.hatchArea(h)-200*100)<1e-6);
 for(const p of [{x:50,y:25},{x:150,y:25},{x:50,y:75},{x:150,y:75}]){assert.ok(G.hatchContains(h,p));assert.equal(G.entityDistance(h,p),0,'어느 칸을 눌러도 같은 해치가 잡힌다');}
 assert.deepEqual(G.bounds([h]),{minX:0,minY:0,maxX:200,maxY:100},'범위에 모든 칸이 들어간다(선택·화면 걸러내기)');
 assert.equal(c.engine.undoStack.length,undoDepth+1,'되돌리기 한 단계');
 c.engine.execute({type:'undo'});assert.equal(hatches(c).length,0);assert.equal(c.engine.doc,before);
 c.engine.execute({type:'redo'});assert.equal(hatches(c).length,1);assert.equal(G.hatchRings(hatches(c)[0]).length,4);
});
test('picking inside an area already in the hatch does not add a duplicate loop',async()=>{
 const c=fixture();await c.pickHatch({x:10,y:10});c.apply(style);
 let asked=0;c.request=async(_u,{point})=>{asked++;return cellBoundary(point);};
 await c.pickHatch({x:20,y:20});assert.equal(asked,0);assert.equal(G.hatchRings(hatches(c)[0]).length,1);
});
test('separate HATCH commands still make separate hatches',async()=>{
 const c=fixture();await c.pickHatch({x:10,y:10});c.apply(style);
 c.params={};await c.pickHatch({x:110,y:10});c.apply(style);
 assert.equal(hatches(c).length,2);
});
test('"create separate hatches" option keeps one hatch per picked area (AutoCAD option, default off)',async()=>{
 const c=fixture();await c.pickHatch({x:10,y:10});
 const option=c.fields.find(f=>f.name==='separate');assert.ok(option);assert.equal(option.type,'checkbox');assert.equal(option.value,false);
 c.apply({...style,separate:'on'});await c.pickHatch({x:110,y:10});await c.pickHatch({x:10,y:60});
 assert.equal(hatches(c).length,3);for(const h of hatches(c))assert.equal(G.hatchRings(h).length,1);
});
test('an edit between picks is not swallowed into the hatch undo step',async()=>{
 const c=fixture();await c.pickHatch({x:10,y:10});c.apply(style);
 c.engine.execute({type:'add',entity:{type:'line',layer:c.activeLayer,points:[{x:0,y:0},{x:500,y:0}]}});
 const depth=c.engine.undoStack.length;await c.pickHatch({x:110,y:10});
 assert.equal(hatches(c).length,1);assert.equal(c.engine.undoStack.length,depth+1);
 c.engine.execute({type:'undo'});assert.equal(G.hatchRings(hatches(c)[0]).length,1);assert.ok(c.engine.doc.entities.some(e=>e.type==='line'));
});
test('cancel and restart while boundary is pending discards stale result',async()=>{
 const c=fixture();let resolve;c.request=()=>new Promise(r=>resolve=r);const pending=c.pickHatch({x:1,y:1});c.params={};resolve({points:[]});await pending;assert.equal(c.apply,undefined);assert.equal(c.engine.doc.entities.length,0);assert.equal(c.busy,false);
});
test('boundary failure retains style and allows retry without adding an entity',async()=>{
 const c=fixture();c.params.hatchStyle={pattern:'lines',scale:1,angle:45,color:'#abcdef'};c.request=async()=>{throw Error('open boundary')};await c.pickHatch({x:1,y:1});assert.equal(c.engine.doc.entities.length,0);assert.equal(c.busy,false);assert.equal(c.params.hatchStyle.pattern,'lines');
});
test('Enter / right-click ends the HATCH pick loop instead of raising an error',()=>{
 // A40(10-20): 끝낼 때 작업 중 고른 새 해치 선택을 놓고(setSelected([])) reset 한다
 assert.match(source,/if \(mode === "HATCH" && phase === "hatch-inside" && !busy\) \{(?:\s*\/\/[^\n]*)?\s*if \(params\.hatchId\) setSelected\(\[\]\);\s*reset\(\);/);
});
test('hatch loop geometry: regions, islands, XOR merge and legacy single-loop hatches',()=>{
 // 예전 도면의 해치(바깥 하나 + 구멍)는 그대로 읽힌다.
 const legacy={type:'hatch',points:rect(0,0,100,100),loops:[rect(40,40,60,60)]};
 assert.equal(G.hatchRegions(legacy).length,1);assert.equal(G.hatchRegions(legacy)[0].holes.length,1);
 assert.equal(G.hatchArea(legacy),100*100-20*20);assert.equal(G.hatchContains(legacy,{x:50,y:50}),false);assert.equal(G.hatchContains(legacy,{x:10,y:10}),true);
 // 구멍 있는 칸 + 옆 칸
 const merged={type:'hatch',...G.mergeHatchBoundary(legacy,{points:rect(100,0,200,100),loops:[]})};
 assert.equal(G.hatchRegions(merged).length,2);assert.equal(G.hatchArea(merged),100*100-20*20+100*100);
 // 안쪽 칸을 먼저, 바깥 테두리 영역(안쪽 칸이 구멍)을 나중에 찍으면 짝홀상 같은 루프가 지워져 통째로 채워진다.
 const inner={type:'hatch',points:rect(40,40,60,60),loops:[]};
 const whole=G.mergeHatchBoundary(inner,{points:rect(0,0,100,100),loops:[[...rect(40,40,60,60)].reverse()]});
 assert.equal(whole.loops.length,0);assert.equal(G.polygonArea(whole.points),100*100);
 // 떨어진 영역도 범위·교차 선택에 들어간다.
 const apart={type:'hatch',points:rect(0,0,10,10),loops:[rect(1000,1000,1010,1010)]};
 assert.deepEqual(G.bounds([apart]),{minX:0,minY:0,maxX:1010,maxY:1010});
 assert.equal(G.segments(apart).length,8);
});
test('hatch pick no longer serializes the whole drawing; big drawings send only the view neighbourhood with a full fallback',()=>{
 const body=source.slice(source.indexOf('async function pickHatch('),source.indexOf('/* RECTANGLE'));
 assert.doesNotMatch(body,/JSON\.stringify\(engine\.doc\)/);
 assert.match(source,/function hatchBoundaryDocument\(point\)\{/);
 assert.match(body,/catch\(error\)\{if\(local===snapshot\)throw error;boundary=await request\('\/api\/hatch-boundary',body\(snapshot\)\);\}/);
});

/* ── HATCH 옵션 [객체 선택(S)/원점(O)/연관(A)/간격 허용(G)/설정(T)] ── */
test('G gap tolerance is sent to /api/hatch-boundary only when set',async()=>{
 const c=fixture(),bodies=[];c.request=async(_u,body)=>{bodies.push(body);return cellBoundary(body.point);};
 await c.pickHatch({x:10,y:10});assert.equal('gapTolerance' in bodies[0],false);
 c.params={};c.run.hatchGapTolerance=25;await c.pickHatch({x:10,y:10});assert.equal(bodies[1].gapTolerance,25);
});
test('O origin goes into the new hatch and its pattern fields',async()=>{
 const c=fixture();let seen;c.hatchPatternFields=(pattern,opts)=>{seen=opts;return {pattern,...opts};};
 c.run.hatchOrigin={x:12,y:34};await c.pickHatch({x:10,y:10});c.apply(style);
 assert.deepEqual({...seen.origin},{x:12,y:34});assert.deepEqual({...hatches(c)[0].origin},{x:12,y:34});
 const d=fixture();await d.pickHatch({x:10,y:10});d.apply(style);assert.equal('origin' in hatches(d)[0],false,'원점을 정하지 않으면 예전과 같다');
});
test('S select objects: a given boundary skips the server and joins the same one hatch',async()=>{
 const c=fixture();let asked=0;c.request=async()=>{asked++;return cellBoundary({x:10,y:10});};
 const sel=G.hatchSelectionBoundary([{id:'a',type:'rectangle',points:rect(0,0,100,50)},{id:'b',type:'circle',center:{x:50,y:25},radius:10}]);
 await c.pickHatch(null,sel.boundary);assert.equal(asked,0);c.apply(style);
 assert.equal(hatches(c).length,1);assert.equal(G.hatchRings(hatches(c)[0]).length,2);
 await c.pickHatch(null,{points:rect(100,0,200,50),loops:[]});
 assert.equal(hatches(c).length,1);assert.equal(G.hatchRings(hatches(c)[0]).length,3);
 assert.equal(G.hatchContains(hatches(c)[0],{x:50,y:25}),false,'원 안은 섬');assert.ok(G.hatchContains(hatches(c)[0],{x:150,y:25}));
});
test('hatchSelectionBoundary: closed objects accepted, open ones rejected, nested loops alternate (normal island detection)',()=>{
 const es=[
  {id:'outer',type:'polyline',closed:true,points:rect(0,0,1000,1000)},
  {id:'circle',type:'circle',center:{x:500,y:500},radius:300},
  {id:'inner',type:'rectangle',points:rect(450,450,550,550)},
  {id:'ell',type:'ellipse',center:{x:2000,y:0},majorAxis:{x:200,y:0},ratio:.5},
  {id:'closedByPoints',type:'polyline',points:[...rect(3000,0,3100,100),{x:3000,y:0}]},
  {id:'dup',type:'rectangle',points:rect(0,0,1000,1000)},
  {id:'line',type:'line',points:[{x:0,y:0},{x:1,y:1}]},
  {id:'open',type:'polyline',points:rect(0,0,10,10)},
  {id:'arcEll',type:'ellipse',center:{x:0,y:0},majorAxis:{x:10,y:0},ratio:.5,startParam:0,endParam:Math.PI}];
 const r=G.hatchSelectionBoundary(es);
 assert.deepEqual(r.accepted,['outer','circle','inner','ell','closedByPoints','dup']);
 assert.deepEqual(r.rejected.map(x=>x.id),['line','open','arcEll']);
 for(const x of r.rejected)assert.equal(G.hatchSelectable(es.find(e=>e.id===x.id)),false);
 for(const id of r.accepted)assert.equal(G.hatchSelectable(es.find(e=>e.id===id)),true);
 const h={type:'hatch',...r.boundary};
 assert.equal(G.hatchRings(h).length,5,'겹쳐 그린 같은 사각형은 한 번만');
 assert.ok(G.hatchContains(h,{x:100,y:100}),'바깥 칸 채움');
 assert.equal(G.hatchContains(h,{x:500,y:300}),false,'원 안(섬) 비움');
 assert.ok(G.hatchContains(h,{x:500,y:500}),'섬 안의 섬 채움');
 assert.ok(G.hatchContains(h,{x:2000,y:0}));assert.ok(G.hatchContains(h,{x:3050,y:50}));
 assert.ok(G.hatchRings({points:G.hatchSelectionRings(es[1]).rings[0]}).at(0).length>=90,'원은 촘촘한 꺾은선');
 assert.equal(G.hatchSelectionBoundary([es[6]]).boundary,null);
});
function optionContext(){
 const code=source.slice(source.indexOf('function hatchOption(option){'),source.indexOf('function hatchSelectPrompt(){'));
 const c={busy:false,phase:'hatch-inside',params:{},run:{},selected:[],logs:[],setSelected(ids){c.selected=ids;},log(m){c.logs.push(m);},fmt:String,S4};
 vm.createContext(c);vm.runInContext(code,c);return c;
}
test('HATCH option keywords: S enters object selection, G and O take values, T reopens settings, A toggles association, I cycles islands',()=>{
 const c=optionContext();
 assert.equal(c.hatchOption('S'),true);assert.equal(c.phase,'select');assert.equal(c.params.hatchSelect,true);
 c.phase='hatch-inside';assert.equal(c.hatchOption('G'),true);assert.equal(c.phase,'hatch-gap');
 assert.throws(()=>c.hatchOption('-1'));assert.throws(()=>c.hatchOption('abc'));
 assert.equal(c.hatchOption('15'),true);assert.equal(c.run.hatchGapTolerance,15);assert.equal(c.phase,'hatch-inside');
 assert.match(c.hatchOptionStatus(),/간격 허용 15/);
 assert.equal(c.hatchOption('O'),true);assert.equal(c.phase,'hatch-origin');
 assert.equal(c.hatchOption('100,200'),false,'좌표는 점 입력으로 넘긴다');
 c.run.hatchOrigin={x:1,y:2};assert.equal(c.hatchOption('D'),true);assert.equal(c.run.hatchOrigin,null);assert.equal(c.phase,'hatch-inside');
 c.params.hatchStyle={pattern:'lines'};c.params.hatchId='h1';assert.equal(c.hatchOption('T'),true);assert.equal(c.params.hatchStyle,null);assert.equal(c.params.hatchId,null);
 // ACAD200-413: 연관(A)은 HPASSOC 를 켜고 끈다(예전: 지원 안 함 오류). 섬(I)은 일반→바깥만→무시.
 assert.equal(c.hatchOption('A'),true);assert.equal(S4.editVar('HPASSOC'),0);assert.match(c.hatchOptionStatus(),/연관 끔/);
 assert.equal(c.hatchOption('A'),true);assert.equal(S4.editVar('HPASSOC'),1);
 assert.equal(c.hatchOption('I'),true);assert.equal(c.run.hatchIsland,'outer');assert.equal(c.hatchOption('I'),true);assert.equal(c.run.hatchIsland,'ignore');assert.equal(c.hatchOption('I'),true);assert.equal(c.run.hatchIsland,'normal');
 assert.equal(c.hatchOption('ZZ'),false);
});
test('HATCH prompt lists the AutoCAD options and Enter in option phases returns to picking',()=>{
 assert.match(source,/\[객체 선택\(S\)\/원점\(O\)\/연관\(A\)\/섬\(I\)\/간격 허용\(G\)\/설정\(T\)\]/);
 assert.match(source,/if\(mode==='HATCH'&&\['hatch-origin','hatch-gap'\]\.includes\(phase\)\)\{hatchOption\(''\);/);
 assert.match(source,/if\(mode==='HATCH'&&phase==='hatch-origin'\)\{applyHatchOrigin\(p\);return;\}/);
 assert.match(source,/G\.hatchSelectionBoundary\(chosen\(\)\)/);
});
