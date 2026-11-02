// group-file-tools.js 시험: GEE(그룹) FLT(Z값 0) STL(다른 도면에서 가져오기) ON(다음 도면) OPA(저장 없이 다시 열기).
// 순수 함수는 직접, 카드 흐름은 스텁 ctx·env(desktop/cad/document 대체물)로 DOM 없이 돈다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 groupMap,nextGroupName,validGroupName,assignGroupPlan,clearGroupPlan,membersOfGroups,
 flattenEntity,flattenPlan,
 stealableItems,stealPlan,parseDrawingJson,
 nextDrawingId,
 installGroupFileTools,
} from './group-file-tools.js';

const P=(x,y)=>({x,y});
function makeCtx({entities=[],selected=[],layers=[{id:'l0',name:'0',color:'#fff'}],blocks=[],formValues={},document=null}={}){
 const executed=[],toasts=[],picks=[];let selectedIds=null;
 const ctx={
  entities:()=>entities,selected:()=>selected,layers:()=>layers,blocks:()=>blocks,
  execute:c=>{executed.push(c);if(c.type==='batch')for(const x of c.commands)if(x.type==='layer.add')layers.push({id:'id-'+x.name,name:x.name,color:x.color});return [];},
  toast:(m,isError)=>toasts.push({m,isError}),userErrorMessage:e=>e.message,refresh:()=>{},
  setSelected:ids=>{selectedIds=ids;},pickEntity:async({prompt})=>{picks.push(prompt);return null;},
  form:(title,fields,onApply)=>{const v=Object.fromEntries(fields.map(f=>[f.name,f.value]));return onApply({...v,...formValues});},
  ...(document?{document:()=>document}:{}),
 };
 return {ctx,executed,toasts,picks,selectedIds:()=>selectedIds};
}
const tick=()=>new Promise(r=>setTimeout(r,5));

/* ── GEE ── */
test('GEE 순수 함수: 그룹 맵·새 이름·추가/제거 계획·구성원',()=>{
 const es=[{id:'a',group:'G1'},{id:'b',group:'G1'},{id:'c'},{id:'d',group:'G2'}];
 assert.deepEqual([...groupMap(es).entries()],[['G1',['a','b']],['G2',['d']]]);
 assert.equal(nextGroupName(es),'G3');
 assert.throws(()=>validGroupName('  '),/그룹 이름/);
 assert.deepEqual(assignGroupPlan(es.slice(0,3),'G1').map(c=>c.ids[0]),['c']);
 assert.deepEqual(clearGroupPlan(es).map(c=>c.ids[0]),['a','b','d']);
 assert.equal(clearGroupPlan(es)[0].changes.group,null);
 assert.deepEqual(membersOfGroups(es,[{id:'a',group:'G1'}]).map(e=>e.id),['a','b']);
});
test('GEE 카드: 만들기 → update 묶음, 선택 → 같은 그룹 전체 선택, 선택 없이 만들기 → 한글 오류',async()=>{
 const a=makeCtx({entities:[{id:'a'},{id:'b'},{id:'c'}],selected:[{id:'a'},{id:'b'}],formValues:{mode:'make',name:'G1'}});
 await installGroupFileTools(a.ctx).GEE();
 assert.equal(a.executed.length,1);
 assert.deepEqual(a.executed[0].commands.map(c=>c.ids[0]),['a','b']);
 assert.equal(a.executed[0].commands[0].changes.group,'G1');
 assert.match(a.toasts[0].m,/G1/);
 const grouped=[{id:'a',group:'G1'},{id:'b',group:'G1'},{id:'c'}];
 const s=makeCtx({entities:grouped,selected:[grouped[0]],formValues:{mode:'select'}});
 await installGroupFileTools(s.ctx).GEE();
 assert.deepEqual(s.selectedIds(),['a','b']);
 assert.equal(s.executed.length,0);
 const x=makeCtx({entities:grouped,selected:[grouped[0]],formValues:{mode:'explode'}});
 await installGroupFileTools(x.ctx).GEE();
 assert.deepEqual(x.executed[0].commands.map(c=>c.ids[0]),['a','b']);
 const e=makeCtx({entities:grouped,selected:[],formValues:{mode:'make',name:'G9'}});
 await installGroupFileTools(e.ctx).GEE();
 assert.equal(e.executed.length,0);
 assert.equal(e.toasts[0].isError,true);
 assert.match(e.toasts[0].m,/선택/);
 const p=makeCtx({entities:grouped,formValues:{mode:'purge'}});
 await installGroupFileTools(p.ctx).GEE();
 assert.equal(p.executed.length,0);
 assert.match(p.toasts[0].m,/빈 그룹/);
});

/* ── FLT ── */
test('FLT flattenEntity: 정점 z·elevation·블록 안까지 지우고, 평면 객체는 null',()=>{
 const line={id:'l',type:'line',points:[{x:0,y:0,z:5},{x:1,y:0,z:5}],elevation:5};
 const flat=flattenEntity(line);
 assert.ok(flat.points.every(p=>!('z' in p)));
 assert.equal(flat.elevation,null);
 // 검토자 지적 1: thickness 는 벽 두께라 건드리지 않는다
 assert.equal(flattenEntity({id:'w',type:'wall',points:[P(0,0),P(5000,0)],thickness:200,openings:[]}),null);
 assert.equal(flattenEntity({id:'p',type:'line',points:[P(0,0),P(1,1)]}),null);
 assert.equal(flattenEntity({id:'z0',type:'line',points:[P(0,0),P(1,1)],elevation:0}),null);
 const block={id:'b',type:'block',position:P(0,0),entities:[{type:'circle',center:{x:0,y:0,z:2},radius:1}],model3d:{height:3000,elevation:100}};
 const fb=flattenEntity(block);
 assert.ok(!('z' in fb.entities[0].center));
 assert.equal(fb.model3d.elevation,100,'model3d 는 옵션 없이는 그대로');
 assert.equal(flattenEntity(block,{model3d:true}).model3d.elevation,0);
 const plan=flattenPlan([line,{id:'p',type:'line',points:[P(0,0),P(1,1)]}]);
 assert.equal(plan.count,1);
 assert.equal(plan.commands[0].ids[0],'l');
});
test('FLT 카드: 대상에 Z가 없으면 안내만, 있으면 batch 하나',async()=>{
 const none=makeCtx({entities:[{id:'p',type:'line',points:[P(0,0),P(1,1)]}],formValues:{scope:'all'}});
 await installGroupFileTools(none.ctx).FLT();
 assert.equal(none.executed.length,0);
 assert.match(none.toasts[0].m,/이미 평면/);
 const some=makeCtx({entities:[{id:'l',type:'line',points:[{x:0,y:0,z:1},{x:1,y:1,z:1}]}],formValues:{scope:'all'}});
 await installGroupFileTools(some.ctx).FLT();
 assert.equal(some.executed.length,1);
 assert.match(some.toasts[0].m,/1개의 Z값/);
});

/* ── STL ── */
const sourceDoc={
 layers:[{id:'s1',name:'A-WALL',color:'#d0d0d0',linetype:'CONTINUOUS'},{id:'s2',name:'A-GRID',color:'#ff5a5a',linetype:'CENTER'}],
 blocks:[{name:'DOOR-01',entities:[{id:'x',type:'line',layer:'s1',points:[P(0,0),P(800,0)]}]},{name:'WIN-01',entities:[{id:'y',type:'line',layer:'s2',points:[P(0,0),P(1800,0)]}]}],
 dimStyles:{STANDARD:{name:'STANDARD',textHeight:150},ARCH:{name:'ARCH',textHeight:250}},
 entities:[],
};
test('STL 순수 함수: 항목 목록·복사 계획(블록이 쓰는 켜를 함께 만들고 이름으로 다시 맞춘다)·JSON 읽기',()=>{
 const items=stealableItems(sourceDoc);
 assert.deepEqual(items,{layers:['A-WALL','A-GRID'],blocks:['DOOR-01','WIN-01'],dimStyles:['STANDARD','ARCH']});
 const target={layers:[{id:'t1',name:'A-WALL'}],blocks:[{name:'DOOR-01',entities:[]}],dimStyles:{STANDARD:{name:'STANDARD'}}};
 const plan=stealPlan(sourceDoc,target,{blocks:['WIN-01','DOOR-01'],dimStyles:['ARCH']});
 assert.deepEqual(plan.commands,[{type:'layer.add',name:'A-GRID',color:'#ff5a5a'}]);
 assert.equal(plan.addedLayers,1);assert.equal(plan.addedBlocks,1);assert.equal(plan.replacedBlocks,1);
 assert.equal(plan.blockDefs.length,2);
 assert.equal(plan.blockDefs.find(b=>b.name==='WIN-01').entities[0].layerName,'A-GRID');
 assert.equal(plan.blockDefs.find(b=>b.name==='WIN-01').entities[0].id,undefined);
 assert.deepEqual(plan.layerStyleFixes,[{name:'A-GRID',changes:{linetype:'CENTER'}}]);
 assert.equal(plan.dimStyleDefs.ARCH.textHeight,250);
 assert.ok(plan.dimStyleDefs.STANDARD);
 assert.throws(()=>parseDrawingJson('not json'),/읽을 수 없습니다/);
 assert.throws(()=>parseDrawingJson('{"a":1}'),/형식/);
 assert.equal(parseDrawingJson(JSON.stringify(sourceDoc)).blocks.length,2);
});
test('STL 카드(설치본 경로 대체물): 파일 고르기 → 항목 선택 → 켜·블록이 현재 도면에 들어간다',async()=>{
 const desktop={pickDrawingFiles:async()=>['D:\\x\\src.bcad'],readExternalFile:async()=>({name:'src.bcad',data:Buffer.from(JSON.stringify(sourceDoc)).toString('base64')})};
 const {ctx,executed,toasts}=makeCtx({formValues:{category:'blocks',all:'on'},document:{layers:[{id:'l0',name:'0'}],blocks:[],dimStyles:{},entities:[]}});
 await installGroupFileTools(ctx,{desktop}).STL();
 assert.ok(!toasts.some(t=>t.isError),JSON.stringify(toasts));
 const adds=executed.flatMap(c=>c.type==='batch'?c.commands:[c]).filter(c=>c.type==='layer.add').map(c=>c.name).sort();
 assert.deepEqual(adds,['A-GRID','A-WALL']);
 const docUpdate=executed.flatMap(c=>c.type==='batch'?c.commands:[c]).find(c=>c.type==='document.update'&&c.changes.blocks);
 assert.equal(docUpdate.changes.blocks.length,2);
 assert.equal(docUpdate.changes.blocks[0].entities[0].layer,'id-A-WALL','켜 id 를 이름으로 다시 맞춤');
 assert.equal(docUpdate.changes.blocks[0].entities[0].layerName,undefined);
 assert.match(toasts.at(-1).m,/블록 2개 추가/);
});

/* ── ON ── */
test('ON: 다음 탭 id 는 순환하고, 탭이 하나면 null',()=>{
 const tabs=[{id:'a'},{id:'b'},{id:'c'}];
 assert.equal(nextDrawingId(tabs,'a'),'b');
 assert.equal(nextDrawingId(tabs,'c'),'a');
 assert.equal(nextDrawingId([{id:'a'}],'a'),null);
});
test('ON 카드: 열린 도면이 여럿이면 다음 탭을 고른다',async()=>{
 const selected=[];
 const cad={drawings:{list:()=>[{id:'a',name:'1층.dxf'},{id:'b',name:'2층.dxf'}],active:()=>'a',select:id=>selected.push(id)}};
 const {ctx,toasts}=makeCtx();
 await installGroupFileTools(ctx,{cad}).ON();
 assert.deepEqual(selected,['b']);
 assert.match(toasts[0].m,/2층\.dxf/);
 const one={drawings:{list:()=>[{id:'a',name:'1층.dxf'}],active:()=>'a',select:()=>{}}};
 const single=makeCtx();
 await installGroupFileTools(single.ctx,{cad:one,desktop:null,document:{}}).ON();
 assert.equal(single.toasts[0].isError,true);
 assert.match(single.toasts[0].m,/하나뿐/);
});

/* ── OPA ── */
test('OPA 카드: 확인 없이는 막고, 확인하면 파일을 다시 읽어 load 명령으로 바꾼다',async()=>{
 const desktop={pickDrawingFiles:async()=>['D:\\x\\plan.bcad'],readExternalFile:async()=>({name:'plan.bcad',data:Buffer.from(JSON.stringify(sourceDoc)).toString('base64')})};
 const no=makeCtx({formValues:{confirm:''}});
 await installGroupFileTools(no.ctx,{desktop}).OPA();
 assert.equal(no.executed.length,0);assert.equal(no.toasts[0].isError,true);
 const yes=makeCtx({formValues:{confirm:'on'}});
 await installGroupFileTools(yes.ctx,{desktop}).OPA();
 assert.equal(yes.executed.length,1);
 assert.equal(yes.executed[0].type,'load');
 assert.equal(yes.executed[0].document.blocks.length,2);
 assert.match(yes.toasts[0].m,/plan\.bcad/);
});
// 2026-10-27 맥판 시험: 파일에서 연 도면인데도 OPA 가 파일을 다시 고르라고 했다. 연 파일 경로를 알면 그 파일을 바로 다시 읽는다.
test('OPA 카드: 연 파일 경로가 있으면 고르지 않고 그 파일을 다시 읽는다',async()=>{
 let picked=0;const read=[];
 const desktop={pickDrawingFiles:async()=>{picked++;return [];}};
 const yes=makeCtx({formValues:{confirm:'on'}});
 yes.ctx.drawingFilePath=()=>'/Users/a/현장/plan.dxf';
 yes.ctx.readDrawingFile=async path=>{read.push(path);return {document:sourceDoc};};
 await installGroupFileTools(yes.ctx,{desktop}).OPA();
 assert.equal(picked,0);
 assert.deepEqual(read,['/Users/a/현장/plan.dxf']);
 assert.equal(yes.executed[0].type,'load');
 assert.match(yes.toasts.at(-1).m,/plan\.dxf/);
});
