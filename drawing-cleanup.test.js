import test from 'node:test';
import assert from 'node:assert/strict';
import {planPurge,purgeCommand,planOverkill,overkillCommand,planAudit,auditFixCommand,auditSummary} from './drawing-cleanup.js';
import {DrawingEngine as Engine} from './engine.js';

const L0={id:'L0',name:'0',color:'#ffffff',visible:true,locked:false};
const layer=(id,name=id)=>({id,name,color:'#ffffff',visible:true,locked:false});
const line=(id,a,b,extra={})=>({id,type:'line',layer:'A',points:[{x:a[0],y:a[1]},{x:b[0],y:b[1]}],...extra});

test('PURGE: 쓰지 않는 블록 정의(재귀)와 객체 없는 레이어만 고른다',()=>{
 const doc={layers:[L0,layer('A'),layer('B'),layer('C'),layer('CUR'),layer('INB')],
  entities:[line('l1',[0,0],[1,0]),{id:'b1',type:'block',name:'바깥',layer:'B',position:{x:0,y:0},entities:[]}],
  blocks:[{name:'바깥',entities:[{type:'block',name:'안',layer:'B',entities:[]}]},{name:'안',entities:[{type:'line',layer:'INB',points:[]}]},{name:'안씀',entities:[{type:'line',layer:'C',points:[]}]}]};
 const plan=planPurge(doc,{currentLayer:'CUR'});
 assert.deepEqual(plan.blocks,['안씀']);
 // C 는 지워질 블록 안에서만 쓰여 함께 지운다. INB 는 남는 블록 '안' 이 쓴다. 0·현재 레이어는 남긴다.
 assert.deepEqual(plan.layers.map(l=>l.id),['C']);
 const command=purgeCommand(plan);
 assert.equal(command.type,'batch');
 assert.deepEqual(command.commands.map(c=>c.type),['document.update','layer.purge']);
});

test('PURGE: 엔진에서 한 번의 되돌리기로 실행된다',()=>{
 const engine=new Engine();
 const doc=engine.doc;
 engine.execute({type:'layer.add',name:'빈켜1'});
 engine.execute({type:'layer.add',name:'빈켜2'});
 const X1=engine.doc.layers.find(l=>l.name==='빈켜1').id,X2=engine.doc.layers.find(l=>l.name==='빈켜2').id;
 engine.execute({type:'document.update',changes:{blocks:[...(engine.doc.blocks||[]),{name:'안씀',entities:[{type:'line',layer:X2,points:[{x:0,y:0},{x:1,y:0}]}]}]}});
 const before=engine.undoStack.length,layersBefore=engine.doc.layers.length;
 const plan=planPurge(engine.doc,{currentLayer:engine.doc.layers[0].id});
 assert.ok(plan.layers.some(l=>l.id===X1)&&plan.layers.some(l=>l.id===X2));
 engine.execute(purgeCommand(plan));
 assert.equal(engine.undoStack.length,before+1);
 assert.equal(engine.doc.layers.some(l=>l.id===X1||l.id===X2),false);
 assert.equal(engine.doc.blocks.some(b=>b.name==='안씀'),false);
 engine.execute({type:'undo'});
 assert.equal(engine.doc.layers.length,layersBefore);
 assert.ok(doc);
});

test('OVERKILL: 같은 선(반대 방향 포함)·덮인 선은 지우고 겹친 선은 합친다(맞닿은 선 합치기는 옵션)',()=>{
 const doc={layers:[L0,layer('A'),layer('B')],entities:[
  line('a',[0,0],[10,0]),
  line('dup',[10,0],[0,0.000001]),        // 같은 선(반대 방향)
  line('cover',[2,0],[5,0]),             // a 안에 덮인 선
  line('over',[8,0],[15,0]),             // 겹침 → 합침
  line('touch',[15,0],[20,0]),           // 맞닿음 → 합침
  line('gap',[25,0],[30,0]),             // 떨어짐 → 그대로
  line('otherLayer',[0,0],[10,0],{layer:'B'}), // 다른 레이어 → 그대로
  line('parallel',[0,1],[10,1]),         // 평행 → 그대로
  {id:'c1',type:'circle',layer:'A',center:{x:5,y:5},radius:2},
  {id:'c2',type:'circle',layer:'A',center:{x:5.001,y:5},radius:2},
  {id:'t1',type:'text',layer:'A',text:'가',position:{x:0,y:0},height:100},
  {id:'t2',type:'text',layer:'A',text:'가',position:{x:0,y:0},height:100},
  {id:'t3',type:'text',layer:'A',text:'나',position:{x:0,y:0},height:100},
  {id:'arc1',type:'arc',layer:'A',center:{x:0,y:0},radius:5,startAngle:0,endAngle:90},
  {id:'arc2',type:'arc',layer:'A',center:{x:0,y:0},radius:5,startAngle:360,endAngle:90},
 ]};
 const plan=planOverkill(doc,{tolerance:0.01,endToEnd:true});
 assert.deepEqual(new Set(plan.deleteIds),new Set(['dup','cover','over','touch','c2','t2','arc2']));
 assert.ok(!planOverkill(doc,{tolerance:0.01}).deleteIds.includes('touch'),'기본은 맞닿은 선을 합치지 않는다');
 assert.equal(plan.duplicates,5);
 assert.equal(plan.merged,2);
 assert.deepEqual(plan.updates,[{id:'a',changes:{points:[{x:0,y:0},{x:20,y:0}]}}]);
 const command=overkillCommand(plan);
 assert.deepEqual(command.commands.map(c=>c.type),['delete','updateMany']);
});

test('OVERKILL: 레이어 무시·선택 범위·잠긴 레이어',()=>{
 const doc={layers:[L0,layer('A'),layer('B')],entities:[line('a',[0,0],[10,0]),line('b',[0,0],[10,0],{layer:'B'}),line('c',[0,0],[10,0])]};
 assert.deepEqual(planOverkill(doc,{ignoreLayer:true}).deleteIds.sort(),['b','c']);
 assert.deepEqual(planOverkill(doc,{ids:['a','b']}).deleteIds,[]);
 assert.deepEqual(planOverkill(doc,{lockedLayers:new Set(['A'])}).deleteIds,[]);
 assert.throws(()=>planOverkill(doc,{tolerance:0}));
});

test('OVERKILL: 기울어진 선·수평 근처(θ≈π) 선도 합친다',()=>{
 const doc={layers:[L0,layer('A')],entities:[line('a',[0,0],[10,10]),line('b',[15,15],[5,5]),line('h1',[0,50],[10,50]),line('h2',[20,50.000001],[9,49.999999])]};
 const plan=planOverkill(doc);
 assert.deepEqual(new Set(plan.deleteIds),new Set(['b','h1'])); // 더 긴 h2 를 남긴다
 assert.equal(plan.merged,2);
 const a=plan.updates.find(u=>u.id==='a').changes.points;
 assert.deepEqual(a,[{x:0,y:0},{x:15,y:15}]);
});

test('OVERKILL: 20만 개 선도 빠르게(O(n log n))',()=>{
 const entities=[];
 for(let i=0;i<200000;i++){const row=i%1000,col=Math.floor(i/1000);entities.push(line('l'+i,[col*20,row*7],[col*20+10,row*7]));}
 for(let i=0;i<1000;i++)entities.push(line('d'+i,[0,i*7],[10,i*7]));
 const start=performance.now();
 const plan=planOverkill({layers:[L0,layer('A')],entities});
 const elapsed=performance.now()-start;
 assert.equal(plan.duplicates,1000);
 assert.ok(elapsed<5000,'took '+elapsed+'ms');
});

test('OVERKILL: 엔진에서 한 번의 되돌리기',()=>{
 const engine=new Engine(),A=engine.doc.layers[0].id;
 engine.execute({type:'addMany',entities:[{type:'line',layer:A,points:[{x:0,y:0},{x:10,y:0}]},{type:'line',layer:A,points:[{x:5,y:0},{x:20,y:0}]},{type:'line',layer:A,points:[{x:0,y:0},{x:10,y:0}]}]});
 const before=engine.undoStack.length;
 const plan=planOverkill(engine.doc);
 engine.execute(overkillCommand(plan));
 assert.equal(engine.undoStack.length,before+1);
 assert.equal(engine.doc.entities.length,1);
 assert.deepEqual(engine.doc.entities[0].points,[{x:0,y:0},{x:20,y:0}]);
 engine.execute({type:'undo'});
 assert.equal(engine.doc.entities.length,3);
});

test('AUDIT: 없는 레이어·NaN·길이 0 선·중복 id 를 찾아 고친다',()=>{
 const doc={layers:[L0,layer('A')],blocks:[{name:'있음',entities:[]}],entities:[
  line('ok',[0,0],[1,0]),
  line('noLayer',[0,0],[1,0],{layer:'없음'}),
  line('nan',[0,0],[NaN,0]),
  line('zero',[3,3],[3,3]),
  line('same',[0,0],[2,0]),line('same',[0,0],[3,0]),
  {id:'blk',type:'block',name:'없는블록',layer:'A',position:{x:0,y:0},entities:[line(undefined,[0,0],[1,0],{layer:'유령'}),line(undefined,[0,0],[Infinity,0])]},
 ]};
 const plan=planAudit(doc);
 assert.equal(plan.report.missingLayer,2);
 assert.equal(plan.report.badNumber,2);
 assert.equal(plan.report.zeroLength,1);
 assert.equal(plan.report.duplicateIds,1);
 assert.equal(plan.blockReferences,1);
 assert.match(auditSummary(plan),/중복 ID 1개/);
 let n=0;
 const command=auditFixCommand(doc,plan,()=>'new'+(++n));
 const del=command.commands.find(c=>c.type==='delete'),upd=command.commands.find(c=>c.type==='updateMany'),adds=command.commands.filter(c=>c.type==='add');
 assert.deepEqual(new Set(del.ids),new Set(['nan','zero','same']));
 assert.deepEqual(upd.updates.find(u=>u.id==='noLayer').changes,{layer:'L0'});
 const blk=upd.updates.find(u=>u.id==='blk').changes.entities;
 assert.equal(blk.length,1);assert.equal(blk[0].layer,'L0');
 assert.deepEqual(adds.map(a=>a.entity.id),['same','new1']);
});

test('AUDIT: 깨끗한 도면은 고칠 것이 없다',()=>{
 const plan=planAudit({layers:[L0,layer('A')],blocks:[],entities:[line('a',[0,0],[1,0])]});
 assert.equal(plan.problems,0);
 assert.equal(auditFixCommand({entities:[line('a',[0,0],[1,0])]},plan),null);
});
test('OVERKILL merges only overlapping lines by default; end-to-end joining is an option (AutoCAD default off)',()=>{
 const doc={layers:[{id:'L',name:'0'}],entities:[{id:'a',type:'line',layer:'L',points:[{x:0,y:0},{x:100,y:0}]},{id:'b',type:'line',layer:'L',points:[{x:100,y:0},{x:200,y:0}]}],blocks:[]};
 assert.equal(planOverkill(doc).merged,0);
 assert.equal(planOverkill(doc,{endToEnd:true}).merged,1);
});
