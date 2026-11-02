import test from 'node:test';
import assert from 'node:assert/strict';
import {planDeliveryCheck,PAPER_TEXT_MIN} from './delivery-check.js';

const layer=(id,name=id)=>({id,name,color:'#ffffff',visible:true,locked:false});
const line=(id,a,b,layerId='W')=>({id,type:'line',layer:layerId,points:[{x:a[0],y:a[1]},{x:b[0],y:b[1]}]});
const text=(id,height,layerId='T')=>({id,type:'text',layer:layerId,text:'실명',height,position:{x:0,y:0}});
const doc=()=>({layers:[layer('L0','0'),layer('W','A-WALL'),layer('T','A-TEXT'),layer('OLD','벽체선')],entities:[
 line('a',[0,0],[1000,0]),line('b',[1000.5,0],[1000.5,1000]),            // 끝 틈 0.5
 line('c',[0,500],[2000,503]),                                            // 조금 기운 선(0.09°)
 line('d',[0,2000],[1000,2000]),line('d2',[0,2000],[1000,2000]),          // 똑같은 선
 line('e',[5000,0],[6000,0],'OLD'),                                       // 표준 밖 레이어
 text('t1',250),text('t2',100),                                           // 1:100 → 2.5 mm(통과) · 1 mm(작음)
]});
const item=(r,key)=>r.items.find(i=>i.key===key);

test('납품 전 점검: 기존 정리 도구와 바른 기준을 한 목록으로', ()=>{
 const r=planDeliveryCheck(doc(),{denominator:100});
 assert.deepEqual(r.items.map(i=>i.key),['audit','overkill','ends','angle','layers','text','far']);
 assert.equal(item(r,'audit').count,0);
 assert.equal(item(r,'overkill').count,1);
 assert.ok(item(r,'ends').count>=1);
 assert.ok(item(r,'ends').ids.includes('a')&&item(r,'ends').ids.includes('b'));
 assert.deepEqual(item(r,'angle').ids,['c']);
 assert.deepEqual(item(r,'layers').ids,['e']);
 assert.match(item(r,'layers').why,/벽체선/);
 assert.deepEqual(item(r,'text').ids,['t2']);
 assert.match(item(r,'text').why,new RegExp(`1:100.*${PAPER_TEXT_MIN}`));
 // 사람이 정할 것(레이어·글자)은 고치기 없이 고르기만
 assert.equal(item(r,'layers').fix,null);
 assert.equal(item(r,'text').fix,null);
 assert.equal(typeof item(r,'overkill').fix,'function');
});

test('출력 축척이 바뀌면 글자 판정도 바뀐다', ()=>{
 assert.deepEqual(item(planDeliveryCheck(doc(),{denominator:50}),'text').ids,['t2']);   // 1:50 → 5 mm(통과) · 2 mm(작음)
 assert.deepEqual(item(planDeliveryCheck(doc(),{denominator:20}),'text').ids,['t1']);   // 1:20 → 12.5 mm(너무 큼) · 5 mm
 assert.deepEqual(item(planDeliveryCheck(doc(),{denominator:200}),'text').ids,['t1','t2']);
});

test('깨끗한 도면은 문제 0', ()=>{
 const clean={layers:[layer('W','A-WALL')],entities:[line('a',[0,0],[1000,0]),line('b',[1000,0],[1000,1000])]};
 const r=planDeliveryCheck(clean);
 assert.equal(r.problems,0);
 assert.ok(r.items.every(i=>i.count===0&&!i.fix));
});

test('고치기는 엔진 명령을 돌려준다(한 항목 = 되돌리기 한 단계)', ()=>{
 const r=planDeliveryCheck(doc());
 for(const key of ['overkill','ends','angle']){const command=item(r,key).fix();assert.ok(command&&command.type,key);}
});

test('기울기 고치기는 붙인 선 끝을 다시 벌리지 않는다(Codex 검토 재현: 끝 붙이기가 먼저, 기운 채 남으면 다음 검사에 다시 나온다)', async ()=>{
 const {DrawingEngine}=await import('./engine.js');
 const engine=new DrawingEngine();const L=engine.doc.layers[0].id;
 engine.execute({type:'addMany',entities:[{id:'A',type:'line',layer:L,points:[{x:0,y:0},{x:1000,y:3}]},{id:'B',type:'line',layer:L,points:[{x:1000.5,y:3},{x:1000.5,y:1000}]}]});
 for(const key of ['angle','ends']){const it=planDeliveryCheck(engine.doc).items.find(i=>i.key===key);if(it.fix)engine.execute(it.fix());}
 const [a,b]=engine.doc.entities;   // addMany 는 새 ID 를 준다
 const gap=Math.min(...a.points.flatMap(p=>b.points.map(q=>Math.hypot(p.x-q.x,p.y-q.y))));
 assert.ok(gap<0.01,'끝이 벌어짐: '+gap);
});

test('멀리 떨어진 객체도 점검 항목(고르기만)', ()=>{
 const d=doc();for(let i=0;i<40;i++)d.entities.push(line('g'+i,[i*100,8000],[i*100+50,8000]));d.entities.push(line('stray',[9e7,9e7],[9e7+10,9e7]));
 const it=item(planDeliveryCheck(d),'far');
 assert.equal(it.count,1);assert.deepEqual(it.ids,['stray']);assert.equal(it.fix,null);
});


test('글자가 속한 도곽 축척 우선: 1:100·1:50 혼합 시트와 시트 밖 글자', ()=>{
 const d={layers:[layer('T','A-TEXT')],sheets:[
  {id:'plan',denominator:100,bounds:{minX:0,minY:0,maxX:10000,maxY:10000}},
  {id:'schedule',denominator:50,bounds:{minX:20000,minY:0,maxX:30000,maxY:10000}}],entities:[
  {...text('plan-ok',250),position:{x:500,y:1000}},
  {...text('schedule-ok',125),position:{x:20500,y:1000}},
  {...text('schedule-small',100),position:{x:20500,y:2000}},
  {...text('schedule-large',625),position:{x:20500,y:3000}},
  {...text('outside',125),position:{x:40000,y:1000}},
  {...text('owned',125),sheetId:'schedule',position:{x:500,y:4000}}]};
 const it=item(planDeliveryCheck(d,{denominator:100}),'text');
 assert.deepEqual(it.ids,['schedule-small','outside','schedule-large']);
 assert.match(it.why,/시트/);assert.match(it.why,/1:50/);assert.match(it.why,/1:100/);
});

test('단독 생성 도면도 묶음의 요청 축척으로 글자 판정', ()=>{
 const d={layers:[layer('T','A-TEXT')],drawingSets:{schedule:{kind:'schedule',options:{scale:'1/50'}}},entities:[
  {...text('generated',125),drawingSet:{id:'schedule',entity:'generated'}},text('ordinary',125)]};
 assert.deepEqual(item(planDeliveryCheck(d),'text').ids,['ordinary']);
});

test('현재 창호도 생성 글자는 기본·지정 축척의 종이 기준 2.5mm 이상', async()=>{
 const {readFileSync}=await import('node:fs'),{DrawingEngine}=await import('./engine.js'),{generateTracked}=await import('./drawing-generator.js');
 const standard=JSON.parse(readFileSync('rules/knowledge/drawing-standard.json','utf8'));
 standard.sheetTemplates = JSON.parse(readFileSync('rules/knowledge/sheet-templates.json','utf8'));   // 한 벌 템플릿은 도면 기준에 붙어 온다(vault_gate, 2026-10-25)
 const model=JSON.parse(readFileSync('test-fixtures/drawing/daeyeon-2an.json','utf8'));
 for(const scale of ['1/100','1/50']){
  const r=await generateTracked(new DrawingEngine().doc,{kind:'schedule',model,standard,scale});
  const texts=r.document.entities.filter(e=>r.added.includes(e.id)&&e.type==='text');
  assert.ok(texts.length>0);assert.ok(texts.every(e=>e.height/Number(scale.split('/')[1])>=PAPER_TEXT_MIN));
  assert.deepEqual(item(planDeliveryCheck(r.document),'text').ids,[]);
 }
});


test('사용자가 지정한 도곽 축척은 구조 묶음 내부 축척보다 우선',()=>{
 const bounds={minX:0,minY:0,maxX:10000,maxY:10000};
 const d={layers:[layer('T','A-TEXT')],sheets:[{id:'manual',denominator:100,bounds}],
  structureSets:{s:{sheetRecords:[{id:'generated',denominator:50,bounds}]}},entities:[{...text('small-at-100',125),position:{x:500,y:1000}}]};
 assert.deepEqual(item(planDeliveryCheck(d),'text').ids,['small-at-100']);
});
