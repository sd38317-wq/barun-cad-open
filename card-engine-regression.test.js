// 2026-09-24 검토(수정 C · 검토자 재지적) 회귀 시험: 카드 문맥 대체물이 아니라 실제 DrawingEngine 위에서 명령을 돌려 결과 문서를 단정한다.
// 대상: FLT(벽 두께 보존) · STT(치수 배율 제곱 방지·기본 끔) · CUT(꺼진 켜 제외·바깥 삭제 확인·블록 통째 삭제) · FL(면적 폴리선 보존·벽 폴리선 참여)
//       · LMA/LNA(실무 레벨 표기) · OPA(load 되돌리기) · BBL/MFB(되돌리기 한 단계).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine,newDrawingDocument} from './engine.js';
import * as G from './geometry.js';
import {getDimStyle,applyDimStyle} from './dimension-style.js';
import {installGroupFileTools} from './group-file-tools.js';
import {installBlockEditTools} from './block-edit-tools.js';
import {installTrimTools} from './trim-tools.js';
import {installWallFilletCards} from './wall-fillet-card.js';
import {installAreaTools} from './area-tools.js';
import {installBlockXrefTools} from './block-xref-tools.js';

const P=(x,y)=>({x,y});
/** 실제 엔진 위의 카드 문맥. form 은 기본값+override 로 즉시 적용, pick* 은 큐에서 꺼낸다. */
function engineCtx(engine,{formValues=[],points=[],entities=[],paths=[],numbers=[],selected=[]}={}){
 const toasts=[],runs=[];let sel=new Set(selected);let activeLayer=engine.doc.layers[0].id;
 const fq=[...formValues],pq=[...points],eq=[...entities],pathq=[...paths],nq=[...numbers];
 const ctx={
  storage:{getItem:()=>null,setItem(){},removeItem(){}},
  entities:()=>engine.doc.entities,layers:()=>engine.doc.layers,blocks:()=>engine.doc.blocks,document:()=>structuredClone(engine.doc),
  selected:()=>engine.doc.entities.filter(e=>sel.has(e.id)),selectedIds:()=>[...sel],setSelected:ids=>{sel=new Set(ids);},
  execute:c=>engine.execute(c),refresh(){},toast:(m,e)=>toasts.push((e?'[오류] ':'')+m),userErrorMessage:e=>e?.message||String(e),run:async n=>{runs.push(n);},
  ensureLayer:(n,color)=>{const f=engine.doc.layers.find(l=>l.name===n);if(f)return f.id;engine.execute({type:'layer.add',name:n,color:color||'#fff'});return engine.doc.layers.find(l=>l.name===n).id;},
  commit:({removeIds=[],entities=[]})=>engine.execute({type:'batch',commands:[...(removeIds.length?[{type:'delete',ids:removeIds}]:[]),{type:'addMany',entities:entities.map(e=>({...e,layer:e.layer||activeLayer}))}]}),
  activeLayer:()=>activeLayer,tolerance:()=>10,num:(k,d)=>d,log(){},
  form:async(title,fields,onApply)=>{const v=Object.fromEntries(fields.map(f=>[f.name,f.value??'']));const next=fq.length?fq.shift():{};try{await onApply({...v,...next});}catch(e){toasts.push('[폼오류] '+e.message);}},
  askNumber:({value},onValue)=>{const n=nq.length?nq.shift():value;setTimeout(()=>Promise.resolve(onValue(n)).catch(e=>toasts.push('[오류] '+e.message)),0);},
  pickPoint:async()=>pq.length?pq.shift():null,
  pickEntity:async()=>{const id=eq.shift();return id?structuredClone(engine.doc.entities.find(e=>e.id===id)):null;},
  pickPath:async()=>pathq.length?pathq.shift():null,
 };
 return {ctx,toasts,runs};
}
const fresh=()=>{const e=new DrawingEngine();e.doc=newDrawingDocument();return e;};
const layerOf=(engine,name)=>engine.doc.layers.find(l=>l.name===name)?.id||engine.doc.layers[0].id;
const settle=()=>new Promise(r=>setTimeout(r,20));

test('FLT(실제 엔진): 벽 두께는 그대로 두고 선의 z 만 지운다',async()=>{
 const engine=fresh();const lay=engine.doc.layers[0].id;
 engine.execute({type:'addMany',entities:[{type:'wall',layer:lay,points:[P(0,0),P(5000,0)],thickness:200,openings:[]},{type:'line',layer:lay,points:[{x:0,y:0,z:5},{x:10,y:0,z:5}]}]});
 const {ctx,toasts}=engineCtx(engine,{formValues:[{scope:'all'}]});
 await installGroupFileTools(ctx).FLT();
 assert.ok(!toasts.some(t=>t.startsWith('[오류]')),toasts.join('/'));
 assert.equal(engine.doc.entities.find(e=>e.type==='wall').thickness,200);
 assert.ok(engine.doc.entities.find(e=>e.type==='line').points.every(p=>!('z' in p)));
 engine.execute({type:'undo'});
 assert.equal(engine.doc.entities.find(e=>e.type==='line').points[0].z,5,'되돌리기 한 단계로 복구');
});

test('STT(실제 엔진): 1/200 은 치수 문자를 300 으로 그리고(150×scale 2), 사용자 문자높이 250 은 500 으로, 기본값은 아무것도 바꾸지 않는다',async()=>{
 for(const [den,custom,expected] of [[200,null,300],[50,null,75],[100,250,250],[200,250,500]]){
  const engine=fresh();
  if(custom){engine.doc.dimStyles={STANDARD:{name:'STANDARD',textHeight:custom,arrowSize:custom},MYDIM:{name:'MYDIM',textHeight:300}};engine.doc.currentDimStyle='STANDARD';}
  const {ctx,toasts}=engineCtx(engine,{formValues:[{denominator:String(den),lineScale:'',dimScale:'on',layers:'',sheet:'none'}]});
  await installBlockEditTools(ctx).STT();
  assert.ok(!toasts.some(t=>t.startsWith('[오류]')),toasts.join('/'));
  const style=getDimStyle(engine.doc);
  const parts=G.dimensionParts(applyDimStyle({type:'dimension',mode:'linear',points:[P(0,0),P(3000,0),P(1500,-800)]},style));
  assert.equal(parts.find(p=>p.type==='text').height,expected,`1/${den} custom=${custom}`);
  assert.equal(engine.doc.linetypeScale,1,'선축척은 끄면 그대로');
  if(custom)assert.equal(engine.doc.dimStyles.MYDIM.textHeight,300,'다른 치수모양은 보존');
 }
 const engine=fresh();const before=JSON.stringify({d:engine.doc.dimStyles,l:engine.doc.linetypeScale});
 const {ctx}=engineCtx(engine,{formValues:[{denominator:'200',layers:'',sheet:'none'}]});
 await installBlockEditTools(ctx).STT();
 assert.equal(JSON.stringify({d:engine.doc.dimStyles,l:engine.doc.linetypeScale}),before,'기본값(모두 끔)이면 축척 설정을 건드리지 않는다');
});

function cutDoc(){
 const engine=fresh();const lay=engine.doc.layers[0].id;
 engine.doc.layers.push({id:'OFF',name:'OFF-LAYER',color:'#00ff00',visible:false,locked:false,lineweight:0.25,linetype:'CONTINUOUS'});
 const off='OFF';
 engine.doc.entities.push(...[
  {id:'box',type:'polyline',closed:true,layer:lay,points:[P(0,0),P(1000,0),P(1000,1000),P(0,1000)]},
  {id:'tin',type:'text',layer:lay,text:'안',position:P(500,500),height:50},
  {id:'tout',type:'text',layer:lay,text:'밖',position:P(5000,5000),height:50},
  {id:'toff',type:'text',layer:off,text:'꺼짐',position:P(9000,9000),height:50},
  {id:'lin',type:'line',layer:lay,points:[P(-500,500),P(1500,500)]},
  {id:'bin',type:'block',name:'D',layer:lay,position:P(200,200),entities:[{type:'line',layer:lay,points:[P(200,200),P(400,200)]}]},
  {id:'bspan',type:'block',name:'D',layer:lay,position:P(900,900),entities:[{type:'line',layer:lay,points:[P(900,900),P(1400,900)]}]},
 ]);
 return engine;
}
test('CUT(실제 엔진): 안쪽 클릭 → 안의 문자·통째 블록 삭제, 걸친 블록·꺼진 켜 보존, 선은 잘림',async()=>{
 const engine=cutDoc();
 const {ctx}=engineCtx(engine);
 const before=JSON.stringify(engine.doc);
 // CUT 카드창(openCardDialog)은 DOM 이 필요하다 → 카드가 부르는 계산 함수를 실제 엔진 문서에 적용하고 commit 으로 반영해 단정한다.
 const {cutTargetsByBoundary}=await import('./trim-tools.js');
 const r=cutTargetsByBoundary({entities:engine.doc.entities,boundaries:[engine.doc.entities.find(e=>e.id==='box')],pick:P(500,500),layers:engine.doc.layers});
 assert.deepEqual(r.removeIds.sort(),['bin','lin','tin']);
 assert.equal(r.skippedBlock,1,'걸친 블록은 건너뜀');
 assert.equal(r.deleteSide,true);
 ctx.commit({removeIds:r.removeIds,entities:r.add});
 const ids=engine.doc.entities.map(e=>e.id);
 assert.ok(ids.includes('toff')&&ids.includes('tout')&&ids.includes('bspan')&&!ids.includes('tin')&&!ids.includes('bin'));
 assert.ok(engine.doc.entities.some(e=>e.type==='line'&&Math.round(e.points[0].x)===-500&&Math.round(e.points[1].x)===0),'경계 밖 선 조각은 남는다');
 engine.execute({type:'undo'});
 assert.equal(JSON.stringify(engine.doc),before,'되돌리기 한 단계');
});
test('CUT(실제 엔진): 바깥 클릭 → 꺼진 켜 객체는 지우지 않고, 바깥 문자·블록만 지운다',()=>{
 const engine=cutDoc();
 return import('./trim-tools.js').then(({cutTargetsByBoundary})=>{
  const r=cutTargetsByBoundary({entities:engine.doc.entities,boundaries:[engine.doc.entities.find(e=>e.id==='box')],pick:P(5000,5000),layers:engine.doc.layers});
  assert.equal(r.deleteSide,false);
  assert.ok(!r.removeIds.includes('toff'),'꺼진 켜의 객체는 제외');
  assert.equal(r.skippedHidden,1);
  assert.ok(r.removeIds.includes('tout')&&r.removeIds.includes('lin'));
  assert.ok(!r.removeIds.includes('tin'));
 });
});

test('FL(실제 엔진): A-AREA 면적 폴리선은 보존되고 A-WALL 폴리선은 걸린 구간만 낱개 선으로 참여한다',async()=>{
 const engine=fresh();const wall=layerOf(engine,'A-WALL'),area=engine.doc.layers.find(l=>l.name==='A-AREA')?.id||wall;
 engine.doc.entities.push(...[
  {id:'h0',type:'line',layer:wall,points:[P(0,0),P(6000,0)]},{id:'h1',type:'line',layer:wall,points:[P(0,200),P(6000,200)]},
  {id:'v0',type:'line',layer:wall,points:[P(0,0),P(0,4000)]},{id:'v1',type:'line',layer:wall,points:[P(200,0),P(200,4000)]},
  {id:'room',type:'polyline',closed:true,layer:area,points:[P(-100,-100),P(300,-100),P(300,300),P(-100,300)]},
 ]);
 const {ctx,toasts}=engineCtx(engine,{paths:[{points:[P(-100,-100),P(400,400)]},null]});
 await installWallFilletCards(ctx).FL();
 assert.ok(!toasts.some(t=>t.startsWith('[오류]')),toasts.join('/'));
 assert.ok(engine.doc.entities.some(e=>e.id==='room'),'면적 폴리선 보존');
 const key=e=>e.points.map(p=>`${Math.round(p.x)},${Math.round(p.y)}`).sort().join('>');// 방향 무시
 const walls=engine.doc.entities.filter(e=>e.type==='line'&&e.layer===wall).map(key).sort();
 assert.deepEqual(walls,['0,0>0,4000','0,0>6000,0','200,200>200,4000','200,200>6000,200'].map(s=>s.split('>').sort().join('>')).sort());
});

test('CUT(실제 엔진): 바깥 클릭이어도 방을 감싸는 도곽 블록은 남기고 바깥의 문 블록만 지운다(재지적 ①)',async()=>{
 const engine=fresh();const lay=engine.doc.layers[0].id;
 engine.doc.entities.push(
  {id:'room',type:'polyline',closed:true,layer:lay,points:[P(1000,1000),P(4000,1000),P(4000,3000),P(1000,3000)]},
  {id:'tb',type:'block',name:'A3-도곽',layer:lay,position:P(0,0),entities:[{type:'polyline',closed:true,layer:lay,points:[P(0,0),P(42000,0),P(42000,29700),P(0,29700)]}]},
  {id:'door',type:'block',name:'DOOR-01',layer:lay,position:P(20000,20000),entities:[{type:'line',layer:lay,points:[P(20000,20000),P(20900,20000)]}]},
 );
 const {ctx}=engineCtx(engine);
 const {cutTargetsByBoundary}=await import('./trim-tools.js');
 const r=cutTargetsByBoundary({entities:engine.doc.entities,boundaries:[engine.doc.entities.find(e=>e.id==='room')],pick:P(30000,5000),layers:engine.doc.layers});
 assert.deepEqual(r.removeIds,['door']);
 assert.deepEqual(r.skippedBlockNames,['A3-도곽']);assert.deepEqual(r.removedBlockNames,['DOOR-01']);
 ctx.commit({removeIds:r.removeIds,entities:r.add});
 assert.ok(engine.doc.entities.some(e=>e.id==='tb')&&!engine.doc.entities.some(e=>e.id==='door'));
});
test('LNA(실제 엔진): 단위 표기 없는 "+50" 은 도면의 다른 레벨(FL+3,000 → mm)을 따라 +550 이 된다(재지적 ②)',async()=>{
 const engine=fresh();const t=layerOf(engine,'A-TEXT');
 engine.doc.entities.push({id:'a',type:'text',layer:t,text:'FL+3,000',position:P(0,0),height:150,rotation:0},{id:'b',type:'text',layer:t,text:'+50',position:P(0,500),height:150,rotation:0},{id:'c',type:'text',layer:t,text:'L3',position:P(0,900),height:150,rotation:0});
 const b=engineCtx(engine,{selected:['b'],formValues:[{delta:'+500'}]});
 await installAreaTools(b.ctx).LNA();
 assert.equal(engine.doc.entities.find(e=>e.id==='b').text,'+550',b.toasts.join('/'));
 assert.match(b.toasts.at(-1),/mm 로 보았습니다/);
 const c=engineCtx(engine,{selected:['c'],formValues:[{delta:'+500'}]});
 await installAreaTools(c.ctx).LNA();
 assert.equal(engine.doc.entities.find(e=>e.id==='c').text,'L3','도면 기호 L3 은 레벨로 바꾸지 않는다');
 assert.ok(c.toasts.some(t=>/"L3"/.test(t)),c.toasts.join('/'));
});
test('LMA/LNA(실제 엔진): FL+3,000 을 3 m 위로 복사하면 FL+6,000, FL-50 에 +500 은 FL+450',async()=>{
 const engine=fresh();const t=layerOf(engine,'A-TEXT');
 engine.doc.entities.push({id:'lv',type:'text',layer:t,text:'FL+3,000',position:P(0,0),height:150,rotation:0},{id:'lv2',type:'text',layer:t,text:'FL-50',position:P(0,500),height:150,rotation:0});
 const a=engineCtx(engine,{entities:['lv'],points:[P(0,3000)]});
 await installAreaTools(a.ctx).LMA();
 assert.ok(engine.doc.entities.some(e=>e.text==='FL+6,000'),JSON.stringify(engine.doc.entities.map(e=>e.text)));
 const b=engineCtx(engine,{selected:['lv2'],formValues:[{delta:'+500'}]});
 await installAreaTools(b.ctx).LNA();
 assert.equal(engine.doc.entities.find(e=>e.id==='lv2').text,'FL+450');
});

test('OPA(실제 엔진): 확인 후 파일 내용으로 바꾸고, 되돌리기 한 단계로 원래 도면이 돌아온다',async()=>{
 const engine=fresh();const lay=engine.doc.layers[0].id;
 engine.execute({type:'addMany',entities:[{type:'line',layer:lay,points:[P(0,0),P(1,0)]}]});
 const other=newDrawingDocument();other.entities.push({id:'o1',type:'circle',layer:other.layers[0].id,center:P(0,0),radius:10});
 const desktop={pickDrawingFiles:async()=>['D:\\x\\plan.bcad'],readExternalFile:async()=>({name:'plan.bcad',data:Buffer.from(JSON.stringify(other)).toString('base64')})};
 const {ctx,toasts}=engineCtx(engine,{formValues:[{confirm:'on'}]});
 const u0=engine.undoStack.length;
 await installGroupFileTools(ctx,{desktop}).OPA();
 assert.ok(!toasts.some(t=>t.startsWith('[오류]')),toasts.join('/'));
 assert.equal(engine.doc.entities.length,1);assert.equal(engine.doc.entities[0].type,'circle');
 assert.equal(engine.undoStack.length-u0,1);
 engine.execute({type:'undo'});
 assert.equal(engine.doc.entities[0].type,'line');
});

test('BBL/MFB(실제 엔진): 일반 블록이면 되돌리기 한 단계(F11)',async()=>{
 const engine=fresh();const lay=engine.doc.layers[0].id;
 engine.doc.entities.push(...[
  {id:'b1',type:'block',name:'K',layer:lay,position:P(0,0),entities:[{type:'line',layer:lay,points:[P(0,0),P(100,0)]}]},
  {id:'b2',type:'block',name:'K',layer:lay,position:P(1000,0),entities:[{type:'line',layer:lay,points:[P(1000,0),P(1100,0)]}]},
 ]);
 const a=engineCtx(engine,{selected:['b1','b2'],formValues:[{mode:'x'}]});
 let u0=engine.undoStack.length;
 await installBlockXrefTools(a.ctx).BBL();await settle();
 assert.ok(engine.doc.entities.some(e=>e.type==='polyline'),'삽입점 연결선 생성 '+a.toasts.join('/'));
 assert.equal(engine.undoStack.length-u0,1,'BBL 되돌리기 한 단계');
 const m=engineCtx(engine,{selected:['b1'],formValues:[{action:'scale',factor:'2'}]});
 u0=engine.undoStack.length;
 await installBlockXrefTools(m.ctx).MFB();await settle();
 assert.equal(engine.undoStack.length-u0,1,'MFB 되돌리기 한 단계 '+m.toasts.join('/'));
});

/* 2026-10-06 봇 점검(CUT·FE·BAT·BRO 선택 종료·반복 입력): 같은 객체를 두 번 골라도 두 벌로 처리하지 않는다. */
test('BRO(실제 엔진): 끊을 대상을 두 번 골라도 한 번만 끊고 조각을 두 벌 넣지 않는다',async()=>{
 const engine=fresh();const lay=engine.doc.layers[0].id;
 const [base,t]=engine.execute({type:'addMany',entities:[{type:'line',layer:lay,points:[P(500,-500),P(500,500)]},{type:'line',layer:lay,points:[P(0,0),P(1000,0)]}]});
 const {ctx,toasts}=engineCtx(engine,{entities:[base,'',t,t,'']});
 await installTrimTools(ctx).BRO();
 assert.ok(!toasts.some(t=>t.startsWith('[오류]')),toasts.join('/'));
 const pieces=engine.doc.entities.filter(e=>e.id!==base);
 assert.equal(pieces.length,2,'한 번 끊어 두 조각 '+JSON.stringify(pieces.map(e=>e.points)));
 assert.deepEqual(pieces.map(e=>e.points.map(p=>p.x).sort((a,b)=>a-b)).sort((a,b)=>a[0]-b[0]),[[0,500],[500,1000]]);
});
test('FE(실제 엔진): 같은 직선을 두 번 고르면 도면을 바꾸지 않고 알린다',async()=>{
 const engine=fresh();const lay=engine.doc.layers[0].id;
 const [a]=engine.execute({type:'addMany',entities:[{type:'line',layer:lay,points:[P(0,0),P(1000,0)]}]});
 const before=JSON.stringify(engine.doc.entities);
 const {ctx,toasts}=engineCtx(engine,{entities:[a,a],numbers:[0]});
 await installTrimTools(ctx).FE();await settle();
 assert.equal(JSON.stringify(engine.doc.entities),before);
 assert.ok(toasts.some(t=>/\[오류\].*같은 직선/.test(t)),'toasts='+JSON.stringify(toasts));
});
test('BAT 위치지정: 같은 선에 두 곳을 찍으면 원래 선 하나를 두 군데 자르고 문자 두 개를 넣는다(겹친 선 없음)',async()=>{
 const {batPositionPlan}=await import('./trim-tools.js');
 const line={id:'w',type:'line',layer:'L',points:[P(0,0),P(6000,0)]};
 const text=(p)=>({type:'text',position:p,text:'F',height:150,rotation:0,align:'center'});
 const plan=batPositionPlan([{entity:line,point:P(1000,10)},{entity:line,point:P(4000,-10)}],200,text);
 assert.deepEqual(plan.removeIds,['w']);
 assert.equal(plan.done,1);
 const lines=plan.add.filter(e=>e.type!=='text');
 assert.equal(lines.length,3,'두 틈으로 세 조각');
 assert.deepEqual(lines.map(e=>[e.points[0].x,e.points.at(-1).x]),[[0,900],[1100,3900],[4100,6000]]);
 assert.equal(plan.add.filter(e=>e.type==='text').length,2);
});