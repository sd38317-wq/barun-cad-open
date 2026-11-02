// 아파트 검토 v2: 닫힌 PL → 인센티브 표·조건 변경 → 접수·조회 → 카드·도면.
// 계산은 apartment_service.py(로컬 엔진 또는 배치 엔진 서버)가 한다. 여기서는 버튼·조회·그리기 흐름만 본다(최소 DOM).
import test from 'node:test';
import assert from 'node:assert/strict';

class El {
 constructor(tag){this.tag=tag;this.children=[];this.style={};this.dataset={};this.textContent='';this.className='';this.open=false;}
 append(...c){for(const x of c)this.children.push(typeof x==='string'?{tag:'#text',textContent:x,children:[]}:x);}
 prepend(...c){this.children.unshift(...c);}
 replaceChildren(...c){this.children=[];this.append(...c);}
 get childElementCount(){return this.children.length;}
 showModal(){this.open=true;}close(){this.open=false;}
 get value(){return this._v??(this.tag==='select'?this.children[0]?.value:'');}set value(v){this._v=v;}
}
const tools=new El('div');
globalThis.document={createElement:t=>new El(t),body:new El('body'),querySelector:()=>tools};
const timers=[];globalThis.setTimeout=(fn)=>{timers.push(fn);return timers.length;};globalThis.clearTimeout=()=>{};
const flush=()=>new Promise(r=>setImmediate(r));
const walk=(e,out=[])=>{out.push(e);for(const c of e.children||[])walk(c,out);return out;};
const text=e=>walk(e).map(x=>x.textContent||'').join(' ');
const buttons=(root,label)=>walk(root).filter(x=>x.tag==='button'&&x.textContent.includes(label));

const {installApartment}=await import('./apartment-panel.js');
const sq=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const card=(mode,title)=>({mode,review:'quick',title,status:'가능',far_pct:171.2,far_cap_pct:250,units:128,buildings_n:4,share84_pct:100,floors_max:25,floors_min:25,checks_ok:true,
 blocked_by:[],per_piece:[],unit_mix:[],check_rows:[],callouts:[],sheets:[],target_plan:{target_far_pct:320,confirmed_far_pct:200,gap_pct:148.8,assumptions:['리모델링 대비 구조 — 가정']},
 buildings:[{dong:101,block:'J-1',floors:25,label:'101동 84×4 · 25F',points_mm:sq(10000,10000,58000,13000),centroid_mm:{x:39000,y:16500}}],
 draw:[{type:'text',text:'101동 84×4 · 25F',position:{x:39000,y:16500},height:2000,rotation:0,apartmentLayer:'아파트-배치',apartmentZone:'plan1'}]});

const tierChoices=[{label:'최우수',value:{tier:'최우수'}},{label:'우수',value:{tier:'우수'}},{label:'미적용',value:'미적용'}];
function incentiveTable(payload){
 const on=!(payload.incentiveExclude||[]).includes('green');
 const choice=tierChoices.find(c=>c.value.tier&&c.value.tier===payload.incentiveChoices?.green?.tier)||tierChoices[0];
 const value=(payload.incentiveExclude||[]).includes('open')?0:Number(payload.siteExtra?.open_space_m2)||0;
 return {zone:'제2종일반주거지역',area_m2:8000,base_far_pct:200,max_far_pct:320,
  far_pct:200+(on?(choice.label==='최우수'?120:60):0)+value/10,confirmed_far_pct:200,
  items:[{id:'green',name:'녹색건축 인증',group:'assumed',on,choices:tierChoices,choice:on?choice:null,
   max_choice:tierChoices[0],far_gain_pct:on?120:0,confirmed:false},
   {id:'open',name:'공개공지',group:'value',param:'open_space_m2',needs:'면적',on:value>0,choices:[],far_gain_pct:value/10}]};
}
function studio(){
 const doc={entities:[{id:'pl',type:'polyline',closed:true,points:sq(0,0,80000,100000)}],layers:[]};let n=0;const calls=[],toasts=[];
 const execute=c=>{if(c.type==='layer.add')doc.layers.push({id:'L'+(++n),name:c.name,visible:true,locked:false});
  else if(c.type==='addMany')doc.entities.push(...c.entities.map(e=>({...e,id:'e'+(++n)})));else if(c.type==='delete')doc.entities=doc.entities.filter(e=>!c.ids.includes(e.id));};
 const enclose={table:'대지 1필지 8,000㎡',site_mm:sq(0,0,80000,100000),parts_mm:[{no:1,zone:'제2종일반주거지역',points:sq(0,0,80000,100000)}],text_h:2000,sheets:[],draw:[],engine:{parts:[{zone:'제2종일반주거지역'}]}};
 const api=async(route,payload)=>{assert.equal(route,'apartment');calls.push(structuredClone(payload));
  if(payload.action==='incentive_table')return {where:'server',enclose:payload.enclose?null:enclose,table:incentiveTable(payload)};
  if(payload.action==='review')return {job_id:'a'.repeat(32),where:'server',review:payload.review,modes:['84','max'],enclose,north_vec:[0,1]};
  if(payload.action==='review_job')return payload.have?{status:'done',done:['84','max'],plans_n:2}:
   {status:'done',review:'quick',done:['84','max'],current:null,elapsed_s:41,plans_n:2,place:{plans:[card('84','빠른 검토 · 1안'),card('max','빠른 검토 · 2안')],note:'목표 320%',text_h:2000,north_vec:[0,1]}};
  throw Error('unexpected '+payload.action);};
 const s={context:{engine:{doc},execute,toast:(m,bad)=>toasts.push([m,!!bad]),fit(){},hasSite:()=>true,selected:()=>new Set(['pl'])},api,handlers:{}};
 return {s,doc,calls,toasts,enclose};
}

function setup(){
 timers.length=0;document.body.replaceChildren();tools.replaceChildren();
 const fixture=studio();installApartment(fixture.s);
 return {...fixture,panel:document.body.children.find(e=>e.id==='apartment-dialog')};
}
const row=(panel,name)=>walk(panel).find(e=>e.tag==='tr'&&text(e).includes(name));
const control=(panel,name,tag)=>walk(row(panel,name)).find(e=>e.tag===tag);
const change=async(e,value)=>{if(e.type==='checkbox')e.checked=value;else e.value=value;await e.onchange();await flush();};

test('A: PL → 최대 표 → 스위치 끄기 → 검토·카드·그리기 → 표로 복귀', async()=>{
 const {s,doc,calls,toasts,panel,enclose}=setup();
 assert.equal(buttons(panel,'빠른 검토').length,0,'예전 검토 버튼 없음');
 assert.ok(walk(panel).some(e=>e.tag==='details'&&text(e).includes('예전 도구')));
 await s.handlers.APARTMENT();
 assert.equal(panel.open,true);
 assert.deepEqual([calls[0].action,calls[0].pl.length],['incentive_table',4]);
 assert.deepEqual(calls[0].pl,sq(0,0,80000,100000));
 for(const w of ['목표 (인센티브 최대)','320%','녹색건축 인증','공개공지'])assert.ok(text(panel).includes(w),w);
 assert.equal(buttons(panel,'빠른 검토 (무료 · 회원)')[0].className,'primary');
 assert.equal(buttons(panel,'정밀 검토 (P)').length,1);
 await change(control(panel,'녹색건축 인증','input'),false);
 assert.equal(calls[1].action,'incentive_table');
 assert.deepEqual(calls[1].incentiveExclude,['green']);assert.deepEqual(calls[1].enclose,enclose);
 const summary=walk(panel).find(e=>e.className==='apv2-sum');
 for(const w of ['목표 (바꾼 조건)','200%','320%'])assert.ok(text(summary).includes(w),w);
 assert.equal(walk(summary).find(e=>e.tag==='s').textContent,'320%','옛 최대는 취소선');
 await buttons(panel,'바꾼 조건으로 다시 산정 · 빠른')[0].onclick();await flush();
 assert.deepEqual([calls[2].action,calls[2].review],['review','quick']);
 assert.deepEqual(calls[2].incentiveExclude,['green']);assert.deepEqual(calls[2].enclose,enclose);
 assert.ok(toasts.some(([m])=>m.includes('배치 엔진 서버')));
 assert.ok(text(panel).includes('빠른 검토 계산 중'));
 timers.shift()();await flush();
 assert.deepEqual([calls[3].action,calls[3].jobId,calls[3].where,calls[3].have],['review_job','a'.repeat(32),'server',0]);
 const t=text(panel);
 for(const w of ['빠른 검토 결과','1안 · 84 주력','2안 · 최대 용적','171.2%','/ 320%','128세대','목표까지 148.8%p','원문 확인 필요'])assert.ok(t.includes(w),w);
 assert.equal(timers.length,0,'끝난 작업은 더 조회하지 않는다');
 const preview=doc.layers.find(l=>l.name==='아파트-검토');assert.ok(preview&&doc.entities.some(e=>e.layer===preview.id),'미리보기는 아파트-검토 레이어');
 buttons(panel,'이 안 그리기')[0].onclick();
 const plan=doc.layers.find(l=>l.name==='아파트-배치');assert.ok(doc.entities.some(e=>e.layer===plan.id&&e.text==='101동 84×4 · 25F'),'도면 글자는 아파트-배치 레이어');
 const up=buttons(panel,'정밀 검토로 더 올리기 (P)');assert.equal(up.length,2,'빠른 검토 카드마다');
 up[0].onclick();await flush();
 assert.deepEqual([calls.at(-1).action,calls.at(-1).review],['review','precise']);
 assert.ok(text(panel).includes('정밀 검토 계산 중'));
 assert.deepEqual(calls.at(-1).incentiveExclude,['green']);assert.deepEqual(calls.at(-1).enclose,enclose);
 const before=calls.length;
 await buttons(panel,'‹ 인센티브 다시 바꾸기')[0].onclick();await flush();
 assert.equal(calls.length,before,'표 복귀는 다시 계산하지 않음');
 assert.ok(text(panel).includes('목표 (바꾼 조건)'));
 assert.equal(buttons(panel,'바꾼 조건으로 다시 산정 · 빠른').length,1);
 assert.ok(walk(panel).some(e=>e.className==='on'&&e.textContent==='2 인센티브'));
});

test('B: 등급 낮추기·최대 복원·미적용·값 입력·처음으로 초기화', async()=>{
 const {s,calls,panel,enclose}=setup();await s.handlers.APARTMENT();
 await change(control(panel,'녹색건축 인증','select'),'우수');
 assert.deepEqual(calls.at(-1).incentiveChoices,{green:{tier:'우수'}});
 assert.deepEqual(calls.at(-1).incentiveExclude,[]);assert.deepEqual(calls.at(-1).enclose,enclose);
 assert.ok(text(panel).includes('260%'));
 await change(control(panel,'녹색건축 인증','select'),'최우수');
 assert.deepEqual(calls.at(-1).incentiveChoices,{});assert.deepEqual(calls.at(-1).incentiveExclude,[]);
 assert.ok(text(panel).includes('목표 (인센티브 최대)'));
 await change(control(panel,'녹색건축 인증','select'),'미적용');
 assert.deepEqual(calls.at(-1).incentiveChoices,{});assert.deepEqual(calls.at(-1).incentiveExclude,['green']);
 const number=walk(row(panel,'공개공지')).find(e=>e.type==='number');await change(number,'100');
 assert.equal(calls.at(-1).siteExtra.open_space_m2,100);
 await change(control(panel,'녹색건축 인증','select'),'우수');
 await change(control(panel,'공개공지','input'),false);
 assert.deepEqual(calls.at(-1).incentiveChoices,{green:{tier:'우수'}});
 assert.deepEqual(calls.at(-1).incentiveExclude,['open']);
 await buttons(panel,'처음(최대)으로')[0].onclick();await flush();
 assert.equal(calls.at(-1).action,'incentive_table');
 assert.deepEqual(calls.at(-1).incentiveChoices,{});assert.deepEqual(calls.at(-1).incentiveExclude,[]);
 assert.equal(calls.at(-1).siteExtra.open_space_m2,undefined);
 assert.ok(text(panel).includes('목표 (인센티브 최대)'));assert.equal(buttons(panel,'처음(최대)으로').length,0);
});

test('C: 닫힌 PL 선택 없음 → 1단계 안내 → 선택한 PL로 시작', async()=>{
 const {s,doc,calls,panel}=setup();s.context.selected=()=>new Set();
 await s.handlers.APARTMENT();
 assert.equal(calls.length,0);assert.equal(panel.open,true);
 assert.ok(text(panel).includes('닫힌 PL 하나를 선택'));
 assert.ok(walk(panel).some(e=>e.className==='on'&&e.textContent==='1 대지'));
 s.context.selected=()=>new Set(['pl']);doc.entities[0].closed=false;
 await buttons(panel,'선택한 PL로 시작')[0].onclick();await flush();assert.equal(calls.length,0,'열린 PL은 거절');
 doc.entities[0].closed=true;
 await buttons(panel,'선택한 PL로 시작')[0].onclick();await flush();
 assert.deepEqual([calls[0].action,calls[0].pl.length],['incentive_table',4]);
});

test('조회 실패(로그인 등)는 멈추고 [다시 조회]', async()=>{
 const {s,calls,panel}=setup();const api=s.api;let polls=0;
 s.api=async(route,payload)=>{
  if(payload.action!=='review_job')return api(route,payload);
  if(++polls===1){calls.push(structuredClone(payload));throw Error('아파트 배치 검토는 로그인한 회원만 쓸 수 있습니다');}
  return api(route,payload);
 };
 await s.handlers.APARTMENT();
 await buttons(panel,'정밀 검토 (P)')[0].onclick();await flush();timers.shift()();await flush();
 assert.ok(text(panel).includes('로그인한 회원만'));assert.equal(timers.length,0);
 buttons(panel,'다시 조회')[0].onclick();await flush();
 assert.equal(calls.filter(c=>c.action==='review_job').length,2);
 assert.ok(text(panel).includes('정밀 검토 결과'));assert.equal(buttons(panel,'다시 조회').length,0);
 assert.equal(timers.length,0);
});

test('A29: 주소로 불러온 대지선(블록 안 site)을 골라도 시작한다 · 아무것도 안 골라도 대지선이 하나면 그것', async()=>{
 const {s,doc,calls,panel}=setup();
 const site={id:'s1',type:'polyline',closed:true,parcelRole:'site',attributes:{pnu:'1',ring:'outer',originMetres:[0,0],sourceCRS:'EPSG:5187'},points:sq(0,0,50000,60000)};
 const road={id:'r1',type:'polyline',closed:true,parcelRole:'road',attributes:{pnu:'2'},points:sq(50000,0,10000,60000)};
 doc.entities=[{id:'blk',type:'block',parcelGroup:true,entities:[site,road]}];
 s.context.selected=()=>new Set(['blk']);
 await s.handlers.APARTMENT();
 assert.equal(calls[0]?.action,'incentive_table','대지선 블록 선택 → 바로 2단계');
 assert.deepEqual(calls[0].pl,sq(0,0,50000,60000));
 s.context.selected=()=>new Set();
 await s.handlers.APARTMENT();
 assert.deepEqual(calls[1].pl,sq(0,0,50000,60000),'선택 없이도 대지선 하나');
 assert.ok(walk(panel).some(e=>e.className==='on'&&e.textContent==='2 인센티브'),'1단계에 멈추지 않음');
});

test('지적이 없는 도면 → 주소 창을 갑자기 띄우지 않고 계획 탭 ① 안내', async()=>{
 const {s,calls,panel}=setup();let opened=0;s.context.hasSite=()=>false;s.context.openParcel=async()=>{opened++;};
 await s.handlers.APARTMENT();
 assert.equal(calls.length,0);assert.equal(opened,0);
 assert.ok(text(panel).includes('계획 탭 ① 대지 선택'));
});

test('계획 탭 흐름(apartmentFlow): 창 없이 표·검토, 인센티브 창은 [계획 탭에 반영]', async()=>{
 const {s,calls,panel}=setup();const flow=s.context.apartmentFlow;let changes=0;flow.onChange(()=>changes++);
 const pl=sq(0,0,80000,100000);
 await flow.load(pl,'A@8000.0');
 assert.equal(panel.open,false,'표는 창을 열지 않는다');
 assert.equal(calls[0].action,'incentive_table');assert.deepEqual(calls[0].pl,pl);
 assert.equal(flow.state().table.far_pct,320);assert.equal(flow.state().siteKey,'A@8000.0');assert.ok(changes>0);
 await flow.review('quick');
 assert.equal(panel.open,false,'빠른 검토도 창 없이');assert.deepEqual([calls[1].action,calls[1].review],['review','quick']);
 timers.shift()();await flush();
 const j=flow.state().jobs.quick;assert.equal(j.state.status,'done');assert.equal(j.place.plans.length,2);
 flow.incentives();assert.equal(panel.open,true);
 assert.ok(text(panel).includes('인센티브 고르기'));assert.ok(!text(panel).includes('1 대지'));
 assert.equal(buttons(panel,'빠른 검토 (무료').length,0);
 await buttons(panel,'이 조건으로 계획 탭에 반영')[0].onclick();await flush();assert.equal(panel.open,false);
 const before=calls.length;await flow.load(pl,'A@8000.0');assert.equal(calls.length,before+1);assert.ok(flow.state().jobs.quick,'같은 대지면 검토 결과 유지');
 await flow.load(pl,'B@10.0');assert.equal(flow.state().jobs.quick,undefined,'대지가 바뀌면 처음부터');
});

test('D: 단계 도중 가두리 PL 을 고치면 묶어 둔 대지를 버리고 새 PL 로 다시 묶는다', async()=>{
 const {s,doc,calls,panel,enclose}=setup();
 await s.handlers.APARTMENT();
 await change(control(panel,'녹색건축 인증','input'),false);
 assert.deepEqual(calls[1].enclose,enclose,'PL 그대로면 대지 재사용');
 doc.entities[0].points=sq(0,0,60000,100000);
 await change(control(panel,'녹색건축 인증','input'),true);
 assert.equal(calls[2].enclose,undefined,'PL 바뀌면 옛 대지를 보내지 않는다');
 assert.deepEqual(calls[2].pl,sq(0,0,60000,100000));
 await buttons(panel,'빠른 검토 (무료 · 회원)')[0].onclick();await flush();
 assert.equal(calls[3].action,'review');assert.deepEqual(calls[3].enclose,enclose,'새로 묶은 대지는 다시 재사용');
});

test('E: 선택만 풀리면 그 PL 그대로, PL 을 지우거나 열린 선으로 바꾸면 옛 대지로 계속하지 않는다(검토 A9)', async()=>{
 const {s,doc,calls,panel,enclose}=setup();
 await s.handlers.APARTMENT();
 s.context.selected=()=>new Set();
 await change(control(panel,'녹색건축 인증','input'),false);
 assert.deepEqual(calls[1].enclose,enclose,'선택만 풀림: 묶어 둔 대지 재사용');
 doc.entities[0].closed=false;
 const before=calls.length;
 await change(control(panel,'녹색건축 인증','input'),true);
 assert.equal(calls.length,before,'열린 선이 되면 요청을 보내지 않는다');
 assert.ok(text(panel).includes('지워졌거나 열린 선'),text(panel));
 doc.entities=[];
 await change(control(panel,'녹색건축 인증','input'),false);
 assert.equal(calls.length,before,'지운 PL 로도 보내지 않는다');
});

test('아파트 기다림은 소규모 계획안 무대를 쓰고, 이 대지 실제 값과 서버 1안→2안 진행을 넘긴다', async () => {
 const {apartmentWaitRequest,apartmentWaitEvent}=await import('./apartment-panel.js');
 const req=apartmentWaitRequest({engine:{address:'전포동 897',site:[[0,0],[100,0],[100,100]],parts:[{zone:'일반상업지역',area_m2:300,bcr:60,far:1000},{zone:'제2종일반주거지역',area_m2:100,bcr:60,far:200}]}});
 assert.deepEqual(req.site.parcel,[[0,0],[100,0],[100,100]]);
 assert.equal(req.zoning.zone,'일반상업지역 + 제2종일반주거지역');
 assert.equal(req.zoning.far,800);   // 면적 가중
 assert.equal(apartmentWaitEvent({status:'running',current:'84',done:[]}).planIndex,1);
 const e=apartmentWaitEvent({status:'running',current:'max',done:['84'],plans:[{mode:'84',far_pct:198.4,gfa_m2:20000,buildings:[{floors:25},{floors:30}]}]});
 assert.deepEqual([e.status,e.planIndex,e.planTotal,e.result.report.numbers.far,e.result.report.numbers.floors],['running',2,2,198.4,30]);
 assert.equal(apartmentWaitEvent({status:'done',done:['84','max']}).status,'succeeded');
});


test('merge: plan review tracks its parcel block after edits despite an unrelated selected enclosure', async()=>{
 const {s,doc,calls,panel}=setup();
 const site={id:'site',type:'polyline',closed:true,parcelRole:'site',points:sq(0,0,50000,60000)};
 doc.entities.push({id:'block',type:'block',parcelGroup:true,entities:[site]});
 const flow=s.context.apartmentFlow;
 await flow.load(site.points,'site@3000');
 site.points=sq(0,0,70000,60000);
 await flow.review('quick');
 assert.equal(calls[1].enclose,undefined);
 assert.deepEqual(calls[1].pl,site.points,'fresh plan geometry takes precedence over the unrelated selected PL');
 assert.equal(panel.open,false);
 site.closed=false;
 const before=calls.length;
 await assert.rejects(flow.review('quick'));
 assert.equal(calls.length,before,'invalidated parcel blocks cannot reuse the previous enclosure');
});

test('merge: quick review finds the largest outer site ring inside imported parcel blocks', async()=>{
 const {sitePolyline}=await import('./apartment-panel.js');
 const small={type:'polyline',closed:true,parcelRole:'site',points:sq(0,0,10,10)};
 const large={...small,points:sq(0,0,30,30)};
 const hole={...small,attributes:{ring:'hole'},points:sq(0,0,100,100)};
 assert.deepEqual(sitePolyline([{id:'block',type:'block',parcelGroup:true,entities:[small,large,hole]}]),large.points);
});
