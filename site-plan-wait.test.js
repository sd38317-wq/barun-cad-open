import test from 'node:test';
import assert from 'node:assert/strict';
import {siteWaitFacts,withSitePlanWait,revealSitePlan,appendLoadRevealDelta} from './site-plan-wait.js';
import {generateSitePlan} from './site-plan-jobs.js';
import {generateAlternativePlans} from './site-plan.js';
import fs from 'node:fs';
import vm from 'node:vm';
const request={site:{parcel:[[200000,400000],[200020,400000],[200020,400010],[200000,400010]]},zoning:{zone:'입력 지역',bcr:60,far:200},program:{floors:3,parking:{count:'auto'}}};
test('대지 좌표 면적·입력 기준과 미확정 영역·주차를 구별하고 요청을 보존',()=>{
 const before=structuredClone(request),facts=siteWaitFacts(request);
 assert.match(facts[1][1],/200㎡/);assert.match(facts[0][1],/입력 지역.*60%.*200%/);
 assert.match(facts[2][1],/확정 영역은 엔진 결과 대기.*120㎡/);assert.match(facts[3][1],/목표 미확인.*엔진 산정 대기/);assert.deepEqual(request,before);
});
test('무대가 없는 환경은 DOM·타이머 없이 같은 결과와 콜백을 반환',async()=>{
 let event;const result={real:true};assert.equal(await withSitePlanWait({},request,{onJob:e=>event=e},async options=>{options.onJob({status:'running'});return result;}),result);assert.equal(event.status,'running');
});
test('취소는 신호를 무시하는 늦은 결과도 소비자에게 넘기지 않음',async()=>{
 const c=new AbortController();let complete;
 const work=withSitePlanWait({},request,{signal:c.signal},()=>new Promise(r=>complete=r));c.abort();
 await assert.rejects(work,{name:'AbortError'});complete({late:true});
 const already=new AbortController();already.abort();await assert.rejects(withSitePlanWait({},request,{signal:already.signal},()=>assert.fail('취소 후 실행')), {name:'AbortError'});
});
test('결과 공개는 한 번의 기존 변경을 감싸고 실패에도 닫음',()=>{
 const events=[],context={beginAIReveal:()=>events.push('begin'),endAIReveal:info=>events.push(info)};
 assert.equal(revealSitePlan(context,()=>{events.push('execute');return 3;}),3);
 assert.deepEqual(events,['begin','execute',{fit:true}]);events.length=0;
 assert.throws(()=>revealSitePlan(context,()=>{throw Error('도면 오류');}),/도면 오류/);assert.deepEqual(events,['begin',{fit:true}]);
});
test('엔진 사건은 queued/running 실제 상태와 경과만 전달하며 404 동기 전환을 구별',async()=>{
 const events=[],job_id='a'.repeat(32),result={report:{}};let n=0,time=0;
 const out=await generateSitePlan(request,async()=>++n===1?{job_id,status:'queued'}:n===2?{job_id,status:'running'}:{job_id,status:'succeeded',result},{onJob:e=>events.push(e),now:()=>time,sleep:async()=>{time+=1500;}});
 assert.equal(out,result);assert.deepEqual(events.map(e=>e.status),['queued','running','succeeded']);assert.equal(events[1].elapsedSeconds,1);assert.ok(events.every(e=>!('percent' in e)));
 events.length=0;await generateSitePlan(request,async route=>{if(route.endsWith('jobs'))throw Object.assign(Error('없음'),{status:404});return result;},{onJob:e=>events.push(e)});assert.deepEqual(events.map(e=>e.status),['sync','succeeded']);
});
test('3안 순서와 상태 사건을 함께 전달하며 기존 결과를 보존',async()=>{
 const raw=JSON.parse(fs.readFileSync('test-fixtures/site-plan-v053/demo_site.json','utf8'));
 const result={entities:JSON.parse(fs.readFileSync('test-fixtures/site-plan-v053/DEMO-CORNER-01_entities.json','utf8')),report:JSON.parse(fs.readFileSync('test-fixtures/site-plan-v053/DEMO-CORNER-01_report.json','utf8'))};result.report.alternatives=[];
 raw.zoning={...raw.zoning,bcr:60,far:200};
 const events=[];const plans=await generateAlternativePlans(raw,async()=>({job_id:'a'.repeat(32),status:'succeeded',result}),{fixedFloors:true,onJob:e=>events.push(e)});
 assert.equal(plans.length,3);assert.deepEqual(events.filter(e=>e.status==='submitting').map(e=>[e.planIndex,e.planTotal]),[[1,3],[2,3],[3,3]]);assert.deepEqual(plans[0].result,result);
});

test('명시적 추가 도면 공개는 load로 복제된 기존 대지를 새 결과에 섞지 않고 삭제를 감지',()=>{
 const before=[{id:'parcel',type:'polyline',points:[]}],after=[...structuredClone(before),{id:'plan',type:'polyline',points:[]}];
 const delta=appendLoadRevealDelta(before,after);assert.deepEqual(delta.added,[after[1]]);assert.deepEqual(delta.removed,[]);assert.deepEqual(appendLoadRevealDelta(before,[after[1]]).removed,before);
});


test('입력 상한은 좌표 원점·건폐·용적·고정 층수를 반영하고 요청을 바꾸지 않음',async()=>{
 const {siteWaitModel,siteWaitArea}=await import('./site-plan-wait-scene.js');const before=structuredClone(request),m=siteWaitModel(request);
 assert.equal(m.area,200);assert.equal(m.footprint,120);assert.equal(m.gfa,400);assert.equal(m.upper,360);assert.equal(m.count,3);assert.ok(Math.abs(siteWaitArea(m.floors[0])-120)<1e-8);assert.deepEqual(request,before);
 const search=siteWaitModel({...request,program:{...request.program,floors_search:true}});assert.equal(search.upper,400);assert.equal(search.count,4);assert.ok(Math.abs(siteWaitArea(search.floors[3])-40)<1e-8);
 const unknown=siteWaitModel({...request,zoning:{}});assert.equal(unknown.upper,null);assert.deepEqual(unknown.floors,[]);
});
test('엔진 완료 사건은 실제 결과 참조를 전달하며 동기 전환도 보존',async()=>{
 const result={report:{numbers:{gfa:731.2}}},events=[];
 await generateSitePlan(request,async()=>({job_id:'a'.repeat(32),status:'succeeded',result}),{onJob:e=>events.push(e)});assert.equal(events[0].result,result);
 events.length=0;await generateSitePlan(request,async route=>{if(route.endsWith('jobs'))throw Object.assign(Error('없음'),{status:404});return result;},{onJob:e=>events.push(e)});assert.equal(events.at(-1).result,result);
});
test('계약 결과는 선택한 안의 실제 지표와 mm 도형을 읽으며 검사 통과를 만들지 않음',async()=>{
 const {siteWaitResult}=await import('./site-plan-wait-scene.js');const result={contract:{selected_plan:{plan_id:'chosen'},plans:[{plan_id:'other',metrics:{gross_floor_area_m2:900}},{plan_id:'chosen',metrics:{gross_floor_area_m2:731.2,floor_count:2},objects:[{role:'building_outline',floors:[1,2],geometry:{ring:[[0,0],[10000,0],[10000,6000],[0,6000]]}}]}]}};
 const before=structuredClone(result),r=siteWaitResult(result);assert.equal(r.numbers.gfa,731.2);assert.equal(r.geometry.floors.length,2);assert.deepEqual(r.geometry.floors[0][1],[10,0]);assert.equal(r.all_ok,undefined);assert.deepEqual(result,before);
});

test('선택적 무대 초기화 오류에도 계산·응답·외부 진행 콜백은 유지',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document'),doc={defaultView:{localStorage:{getItem:()=> '1'}},getElementById(){throw Error('렌더러 없음');}};doc.querySelector=()=>({ownerDocument:doc});
 Object.defineProperty(globalThis,'document',{configurable:true,value:doc});
 try{let event;const result={report:{numbers:{gfa:731.2}}};assert.equal(await withSitePlanWait({},request,{onJob:e=>event=e},async options=>{options.onJob({status:'running'});return result;}),result);assert.equal(event.status,'running');}
 finally{if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else delete globalThis.document;}
});


test('iframe은 준비 후 최신 실제 요청과 결과를 보내며 출처를 검증하고 정리한다',async()=>{
 const {mountSitePlanWait}=await import('./site-plan-wait.js');
 const listeners=new Map(),sent=[],observed=[],removed=[];
 class Element{
  constructor(tag){this.tag=tag;this.style={setProperty(){}};this.contentWindow={postMessage:(message,origin)=>sent.push({message,origin})};}
  setAttribute(){} append(...nodes){this.children=nodes;} addEventListener(){} showModal(){} close(){this.closed=true;} remove(){removed.push(this);}
 }
 const win={location:{origin:'http://localhost:8916'},addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:(k)=>listeners.delete(k),ResizeObserver:class{observe(){} disconnect(){observed.push('resize');}},IntersectionObserver:class{observe(){} disconnect(){observed.push('intersection');}}};
 const doc={defaultView:win,hidden:false,getElementById:()=>true,createElement:tag=>new Element(tag),addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k)};
 const host={ownerDocument:doc,append(el){this.el=el;},getBoundingClientRect:()=>({left:20,top:30,width:700,height:500})};
 const before=structuredClone(request),stage=mountSitePlanWait(host,request,{now:()=>1000}),iframe=host.el.children[0];
 assert.match(iframe.src,/wait-screens\/site.html\?embed=1$/);
 const result={report:{numbers:{gfa:23}}},program={floors:7};stage.update({status:'succeeded',planIndex:2,planTotal:3,program,result});assert.equal(sent.length,0);
 const ready={source:iframe.contentWindow,origin:win.location.origin,data:{source:'barun-wait',kind:'site',event:'ready'}};
 listeners.get('message')({...ready,origin:'http://foreign.test'});listeners.get('message')({...ready,source:{}});assert.equal(sent.length,0);
 listeners.get('message')(ready);assert.equal(sent[0].message.cmd,'update');assert.equal(sent[0].message.value.result,result);assert.equal(sent[0].message.value.request.program,program);assert.deepEqual(sent[0].message.value.job,{status:'succeeded',planIndex:2,planTotal:3,mock:undefined});assert.equal(sent[0].origin,win.location.origin);
 doc.hidden=true;listeners.get('visibilitychange')();assert.equal(sent.at(-1).message.cmd,'pause');
 stage.destroy();stage.destroy();assert.equal(listeners.size,0);assert.equal(removed.length,1);assert.deepEqual(observed,['resize','intersection']);assert.deepEqual(request,before);
});

test('연출 스위치가 꺼지면 iframe과 화면 모듈을 읽지 않고 작업 사건을 보존한다',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{defaultView:{localStorage:{getItem:()=> '0'}},querySelector:()=>assert.fail('disabled stage queried viewport')}});
 try{let event;const value={real:true};assert.equal(await withSitePlanWait({},request,{onJob:e=>event=e},async options=>{options.onJob({status:'running'});return value;}),value);assert.equal(event.status,'running');}
 finally{if(descriptor)Object.defineProperty(globalThis,'document',descriptor);else delete globalThis.document;}
 const source=fs.readFileSync('site-plan-wait.js','utf8');assert.doesNotMatch(source,/^import /m);
});

test('시연 기록은 출처를 가진 단일 실제 대지이며 화면은 외부 자원을 사용하지 않는다',()=>{
 const script=fs.readFileSync('wait-screens/site_example.js','utf8'),data=JSON.parse(script.slice(script.indexOf('{')).trim().replace(/;$/,''));
 assert.equal(data.items.length,1);assert.equal(data.items[0].id,'BR-0118');assert.equal(data.engine,'bddd079');assert.ok(data.items[0].cands.sample.length>0);
 const html=fs.readFileSync('wait-screens/site.html','utf8'),adapter=fs.readFileSync('wait-screens/site-wait-frame.js','utf8');
 assert.match(html,/src="site_example.js"/);assert.match(html,/src="site-wait-frame.js"/);assert.doesNotMatch(html,/(?:src|href)="https?:/);
 assert.match(adapter,/예시 · 다른 대지 기록 · 엔진 실시간 연결 전/);assert.match(html,/cancelAnimationFrame/);
});
test('예시 기록이 없는 설치판: 기록 재생을 시작하지 않고 실제 값·계산 중·실시간 걸음 자리만 남긴다',()=>{
 const html=fs.readFileSync('wait-screens/site.html','utf8'),adapter=fs.readFileSync('wait-screens/site-wait-frame.js','utf8');
 const inline=html.split('<script src="site_example.js"></script>\n<script>')[1].split('</script>')[0];
 // 멈추기 전에 판 크기만 맞춘다(10-24) — 그 계산에 필요한 만큼만 흉내 낸다
 const app={style:{setProperty(){}}},dom={window:{},innerWidth:1089,innerHeight:576,addEventListener(){},document:{querySelector:()=>app,body:{classList:{toggle(){}}}}};
 assert.throws(()=>vm.runInNewContext(inline,dom),/예시 기록 없음/,'예시가 없으면 판 크기만 맞추고 재생 스크립트는 멈춘다');
 assert.match(app.style.transform,/scale\(/);
 assert.match(adapter,/const example=Boolean\(window\.ENGINE_RUN\);/);
 assert.match(adapter,/if\(example\)\{const recordedFrame=frame;/);assert.match(adapter,/if\(example\)for\(const name of \['counters'/);
 assert.match(adapter,/showActual=!example\|\|/);assert.match(adapter,/'후보 탐색 · 계산 중'/);
 assert.match(adapter,/if\(cmd==='search'&&value&&typeof value==='object'\)\{search=value;paint\(\);\}/);
});
