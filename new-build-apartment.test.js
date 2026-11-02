// 신축설계 + 아파트(10/21): 대지 경계로 아파트 빠른 검토를 접수·조회하고, 소규모 3안을 다 그린 뒤에만 아파트를 그린다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {sitePolyline,runQuickReview,apartmentView} from './apartment-panel.js';

const square=(x,y,w)=>[{x,y},{x:x+w,y},{x:x+w,y:y+w},{x,y:y+w}];

test('대지 경계: site 의 바깥 고리 중 가장 넓은 것, 구멍·인접 필지는 뺀다', () => {
 const entities=[
  {type:'polyline',closed:true,parcelRole:'neighbor',points:square(0,0,500)},
  {type:'polyline',closed:true,parcelRole:'site',attributes:{ring:'hole'},points:square(0,0,400)},
  {type:'polyline',closed:true,parcelRole:'site',points:square(0,0,100)},
  {type:'polyline',closed:true,parcelRole:'site',points:square(1000,0,300)},
 ];
 assert.deepEqual(sitePolyline(entities),square(1000,0,300));
 assert.equal(sitePolyline([{type:'line'}]),null);
});

test('빠른 검토: 접수 → 끝날 때까지 조회, 그리기는 ready 뒤에 한 번만', async () => {
 const calls=[];const states=[{status:'running',current:'84',done:[]},{status:'running',current:'max',done:['84'],plans_n:1,place:{plans:[{mode:'84',far_pct:248.7}]}},
  {status:'done',done:['84','max'],plans_n:2,elapsed_s:57,place:{plans:[{mode:'84',far_pct:248.7},{mode:'max',far_pct:271.3}]}}];
 const api=async(route,data)=>{calls.push(data.action);if(data.action==='review')return {job_id:'a'.repeat(32),where:'server',enclose:{engine:{parts:[1]},text_h:500},north_vec:[0,1]};return states.shift();};
 let release;const ready=new Promise(r=>{release=r;});const order=[];
 const progress=[];
 const running=runQuickReview(api,{pl:square(0,0,100),ready,sleep:async()=>{},onProgress:s=>progress.push(s.status),draw:r=>order.push(['draw',r.place.plans.length])});
 await new Promise(r=>setTimeout(r,0));
 order.push(['small-drawn']);release();
 const result=await running;
 assert.deepEqual(calls,['review','review_job','review_job','review_job']);
 assert.deepEqual(order,[['small-drawn'],['draw',2]]);
 assert.equal(result.status,'done');assert.equal(result.plans.length,2);assert.equal(result.elapsed_s,57);
 assert.deepEqual(progress,['queued','running','running','done']);
});

test('접수 실패(로그인 등)는 던지지 않고 이유를 돌려준다', async () => {
 const api=async()=>{throw new Error('아파트 배치 검토는 로그인한 회원만 쓸 수 있습니다.');};
 const result=await runQuickReview(api,{pl:square(0,0,100),sleep:async()=>{}});
 assert.equal(result.status,'failed');assert.match(apartmentView(result).blocked,/로그인/);
});

test('화면 줄: 계산 중은 단계, 끝나면 카드, 모두 불가면 막힌 이유', () => {
 const steps=apartmentView({status:'running',current:'max',done:['84'],plans:[{mode:'84',far_pct:248.7}]}).steps;
 assert.deepEqual(steps.map(s=>[s.state,s.text]),[['done','248.7%'],['now','동 조합 계산 중']]);
 const cards=apartmentView({status:'done',plans:[{mode:'84',far_pct:248.7,units:212,buildings_n:3,share84_pct:100,checks_ok:true,target_plan:{target_far_pct:250}}]}).cards;
 assert.deepEqual(cards,[{title:'1안 · 84 주력',big:'248.7%',cap:'목표 250.0%',meta:'212세대 · 3개 동 · 84형 100%',ok:true}]);
 assert.match(apartmentView({status:'done',plans:[{mode:'84',status:'불가',blocked_by:'제1종전용주거지역'}]}).blocked,/제1종전용주거지역/);
 assert.match(apartmentView({status:'done',plans:[{mode:'84',status:'불가',blocked_by:['인동간격','일조']}]}).blocked,/인동간격, 일조/);
 assert.match(apartmentView({status:'done',plans:[{mode:'84',status:'불가',blocked_by:[]}]}).blocked,/앉힐 자리가 없습니다/);
});

test("계획 탭 '아파트 계획안' 단계: 진행·결과·불가를 그대로 보이고, 계산 중엔 다시 접수하지 않는다", async () => {
 const {PLAN_STEPS}=await import('./plan-workflow-panel.js');
 const step=PLAN_STEPS.find(s=>s.id==='apartment');
 const site={kind:'parcel'};
 assert.equal(step.evaluate({site,state:{}}).state,'todo');
 assert.equal(step.evaluate({site,state:{apartment:{status:'running',done:[],elapsed_s:12}}}).state,'running');
 assert.equal(step.evaluate({site,state:{apartment:{status:'done',plans:[{mode:'84',far_pct:248.7}]}}}).state,'done');
 assert.equal(step.evaluate({site,state:{apartment:{status:'done',plans:[{mode:'84',status:'불가',blocked_by:'용도지역'}]}}}).state,'blocked');
 let started=0;const ctx={studio:{context:{apartmentQuickReview:()=>{started++;return new Promise(()=>{});}}}};
 const quick=state=>step.actions({site,state}).find(a=>a.id==='apartment-quick');
 assert.match(await quick({}).run(ctx),/접수/);
 assert.match(await quick({apartment:{status:'running'}}).run(ctx),/진행 중/);
 assert.equal(started,1);
});
