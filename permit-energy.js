// 인허가 도서 창 — 에너지 탭 ②~⑥(대표 승인 시안 docs/mockup-energy-drawings-2026-10-25 · 시안-에너지도서만들기-2026-10-25).
// 값은 도면 reviewSettings.permitBook.energy(지역·층고·확인 지문·형별·설비·차양·열교) 와 reviewSettings.energyPlan(② 법적 검토 조건)에 둔다(되돌리기 됨).
// 평면 읽기·도서는 서버(/api/permit-book: energy-envelope · energy-build → permit_book_service.py)가 한다. 이 파일은 화면과 '부족한 것' 판정만.
import {ENERGY_PLAN_FIELDS,applyEnergyPlanInputs,planSubmission,planSummary,loadEnergyPlanStandards,energyDefaultsFromOverview,energyUseLabel} from './energy-plan.js';
import {energyRegions} from './energy-regions.js';

export const REGIONS=[['central1','중부1'],['central2','중부2'],['south','남부'],['jeju','제주']];
const PARTS=[['W1','외벽'],['R1','지붕'],['F1','최하층 바닥']];
// 기본값 그대로 쓰면 도서에 [가정]으로 표시할 값(양식 글의 !a 경로)
export const DEFAULT_ASSUMED=['opening.G1.airtightGrade','opening.G1.shgc','opening.D1.U'];
const ASSUMED_LABEL={'opening.G1.airtightGrade':'창 기밀 등급','opening.G1.shgc':'창 SHGC','opening.D1.U':'문 열관류율'};

/** 도면에 저장한 에너지 값(복사본). */
export function energySettings(doc){return structuredClone(doc?.reviewSettings?.permitBook?.energy||{});}
/** ④ 창호 일람표 영역(에너지 영역 중 창호 일람표). */
export function scheduleRegions(doc){return energyRegions(doc).filter(r=>r.kind==='window_schedule').map(r=>r.bounds);}

const num=v=>typeof v==='number'&&Number.isFinite(v);
/** ISO 시각(UTC) → 이 컴퓨터 지역 시각 'YYYY-MM-DD HH:MM'. */
export function localStamp(iso){const d=new Date(iso),p=n=>String(n).padStart(2,'0');return Number.isNaN(d.getTime())?'':`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;}
/** 형별 한 부위에 빠진 것(없으면 빈 목록). */
function partGaps(code,a){
 if(!a)return [`${code} 형별이 없습니다`];
 const out=[];if(!Array.isArray(a.layers)||!a.layers.length)out.push(`${code} 재료층이 없습니다`);
 else a.layers.forEach((l,i)=>{if(!l[0]||!num(l[1])||l[1]<=0||!num(l[2])||l[2]<=0)out.push(`${code} ${i+1}번째 층(재료·두께·열전도율)을 채우세요`);});
 if(code==='F1'&&a.floorHeating&&!(a.underfloor||[]).length)out.push('F1 바닥난방: 배관 아래~슬래브 사이 층 번호를 고르세요(의무 ③)');
 return out;
}

/** ⑤ 부족한 것 — red: 이게 있으면 확정 못 함 / yellow: 확인 권장(가정·설비 점수 없음 등). env = ④ 평면 읽기 결과(없으면 null). */
export function energyGaps({doc,db,env}){
 const e=energySettings(doc),floors=energyRegions(doc).filter(r=>r.kind==='floor'),red=[],yellow=[],ov=doc?.reviewSettings?.permitBook?.overview||{};
 if(!ov.name||!ov.address)red.push('① 개요: 건축명·대지위치');
 if(db){const r=planSubmission(doc?.reviewSettings?.energyPlan,db);if(r.status==='need_input')red.push('② 법적 검토 조건: '+r.needs.join(', '));else if(r.status==='not_target'||r.status==='exempt')yellow.push('② 제출 대상이 아닙니다 — 도서는 만들 수 있지만 제출 의무는 없음');}
 if(!REGIONS.some(([k])=>k===e.region))red.push('② 지역(중부1·중부2·남부·제주)');
 if(!floors.length)red.push('③ 층 평면 범위');
 if(!scheduleRegions(doc).length)red.push('④ 창호 일람표 영역');
 for(const f of floors){const h=e.floors?.[f.label]?.height;if(!num(h)||h<=0)red.push(`④ ${f.label} 층고`);}
 if(!env)red.push('④ 평면 읽기(층마다 외벽·창 확인)');
 else for(const f of env.floors){const c=e.floors?.[f.name]?.sig;if(c!==f.sig)red.push(`④ ${f.name} 확인함(${c?'읽은 값이 바뀌어 다시 확인':'아직 확인 안 함'})`);}
 if(env?.issues?.length)yellow.push(...env.issues.map(x=>'④ '+x));
 const A=e.assemblies;
 if(!A)red.push('⑤ 형별(외벽·지붕·바닥·창·문) — [기본값 넣기]로 시작할 수 있음');
 else{for(const [c] of PARTS)red.push(...partGaps(c,A[c]));
  for(const c of ['G1','D1']){const o=A.openings?.[c];if(!o||!num(o.U)||o.U<=0)red.push(`${c} 열관류율 U`);}
  if(!num(A.openings?.G1?.shgc))yellow.push('G1 SHGC 가 없으면 태양열취득(EPI 건축 7) 계산을 못 함');}
 if((e.assumed||[]).length)yellow.push('⑤ 기본값(가정) 그대로인 값 — 도서에 [가정]으로 표시: '+e.assumed.map(k=>ASSUMED_LABEL[k]||k).join(', '));
 if(!(e.systems?.epi||[]).length)yellow.push('⑤ 기계·전기·신재생 점수 없음 — 협력사 자료를 받으면 넣기(없어도 건축 부문은 만듦)');
 return {red,yellow};
}

/** 에너지 탭 왼쪽 칸 요약. */
export function energyStepInfo(doc,state){
 const e=energySettings(doc),r=state.energyDb?planSubmission(doc?.reviewSettings?.energyPlan,state.energyDb):null,env=state.env,g=state.energyDb?energyGaps({doc,db:state.energyDb,env}):null;
 const reg=REGIONS.find(([k])=>k===e.region)?.[1];
 return {legal:r?[planSummary(r).head.replace(/ \(500㎡ 이상\)$/,''),reg].filter(Boolean).join(' · '):'',
  read:env?`${env.floors.filter(f=>e.floors?.[f.name]?.sig===f.sig).length} / ${env.floors.length} 확인`:'',
  gaps:g?`빨간 줄 ${g.red.length} · 노란 줄 ${g.yellow.length}`:'',confirmed:e.confirmedAt?localStamp(e.confirmedAt).slice(5):''};
}

/** 창이 서버에 보낼 에너지 값. */
export function energyRequest(doc){
 // useLabel: ② 주 용도 이름 — 도서 개요·법적 검토 칸이 판정과 같은 용도를 쓰게(2026-10-27).
 const energyPlan=structuredClone(doc?.reviewSettings?.energyPlan||{}),useLabel=energyUseLabel(energyPlan.mainUse);
 return {energy:energySettings(doc),energyPlan:useLabel?{...energyPlan,useLabel}:energyPlan,scheduleRegions:scheduleRegions(doc)};
}

// ── 화면(ctx: el·engine·api·run·render·toast·state·studio·dialog·base) ──
export function energySteps(ctx){
 const {el,engine,api,run,render,toast,state,studio,dialog}=ctx;
 const save=patch=>{const pb=structuredClone(engine.doc?.reviewSettings?.permitBook||{});engine.execute({type:'review.settings',settings:{permitBook:{...pb,energy:{...(pb.energy||{}),...patch}}}});};
 const need=()=>{if(state.energyDb)return null;run('에너지 기준 DB 여는 중…',async()=>{state.energyDb=await loadEnergyPlanStandards();});return [el('p',{class:'m'},'에너지 기준 DB 여는 중…')];};
 const numIn=(v,w=80,step='any')=>{const i=el('input',{type:'number',step,style:`width:${w}px`});i.value=v??'';return i;};
 const txt=(v,w=160)=>{const i=el('input',{type:'text',style:`width:${w}px`});i.value=v??'';return i;};
 const n=i=>i.value===''?null:Number(i.value);

 function legal(){
  const wait=need();if(wait)return wait;
  const e=energySettings(engine.doc),cur=engine.doc?.reviewSettings?.energyPlan||{},inputs={},grid=el('div',{class:'pb-grid'});
  // 빈칸은 도면 인식 개요(주용도·연면적)로 미리 채워 보여 준다 — [저장하고 판정 보기]를 눌러야 저장된다.
  const dflt=energyDefaultsFromOverview(engine.doc?.reviewSettings?.permitBook?.overview).plan,val=k=>cur[k]??dflt[k]??'';
  for(const f of ENERGY_PLAN_FIELDS){let i;if(f.type==='select'){i=el('select');for(const [v,l] of f.options){const o=el('option',{value:v},l);if(String(val(f.name))===v)o.selected=true;i.append(o);}}else{i=el('input',{type:'number',step:'any'});i.value=val(f.name);}inputs[f.name]=i;grid.append(el('label',{},f.label,i));}
  const reg=el('select');reg.append(el('option',{value:''},'— 지역'));for(const [v,l] of REGIONS){const o=el('option',{value:v},l);if(e.region===v)o.selected=true;reg.append(o);}
  if(!e.region&&!state.regionAsked){state.regionAsked=true;run('주소로 지역 찾는 중…',async()=>{const r=await api({action:'energy-region',overview:engine.doc?.reviewSettings?.permitBook?.overview||{}});if(r.region){save({region:r.region});toast(`주소로 ${r.label}으로 정했습니다. 다르면 고르세요.`);}});}
  grid.append(el('label',{},'지역(별표1 — 주소로 자동, 바꿀 수 있음)',reg));
  const r=planSubmission(cur,state.energyDb),sum=planSummary(r);
  const rows=[['제출 대상',sum.head],...(r.status==='target'?[['점수표 칸',sum.columns.join(' · ')],['적합 기준',`${r.passScore}점 이상`],['1천㎡ 이상 필수 조건',r.over1000.applies?`적용 · ${r.over1000.requirements.length}개`:'해당 없음'],['에너지소요량 평가서',r.energyDemand.applies?'대상(알림만)':'해당 없음']]:r.briefs.map(b=>['판정',b])),...r.notes.map(x=>['참고',x])];
  return [el('h3',{},'② 법적 검토 — 녹색건축법 시행령 제10조 · 고시 제2026-360호'),el('p',{class:'pb-note'},'용도·공사 종류·연면적으로 제출 대상, 점수표 칸, 적합 기준을 정합니다(검토창 에너지 탭 카드와 같은 판정).'),grid,
   el('button',{class:'pb-btn pri',onclick:()=>{try{applyEnergyPlanInputs(engine,Object.fromEntries(Object.entries(inputs).map(([k,i])=>[k,i.value])));save({region:reg.value||null});toast('법적 검토 조건을 저장했습니다.');render();}catch(err){toast(err.message,true);}}},'저장하고 판정 보기'),
   el('table',{},el('tr',{},el('th',{},'항목'),el('th',{},'결과')),...rows.map(([a,b])=>el('tr',{},el('td',{},a),el('td',{class:a==='제출 대상'&&r.status==='target'?'y':''},b))))];
 }

 function read(){
  const e=energySettings(engine.doc),floors=energyRegions(engine.doc).filter(r=>r.kind==='floor'),sch=scheduleRegions(engine.doc),env=state.env;
  const hs={},t=el('table',{},el('tr',{},el('th',{},'층'),el('th',{},'층고(m)'),el('th',{},'바닥 구적'),el('th',{},'지붕 노출'),el('th',{},'최하층 바닥'),el('th',{},'창 · 문'),el('th',{},'방위별 외벽(㎡)'),el('th',{},'확인')));
  const storyM=energyDefaultsFromOverview(engine.doc?.reviewSettings?.permitBook?.overview).storyHeightM;   // 층고 빈칸은 개요 층고로
  for(const f of floors){const row=env?.floors.find(x=>x.name===f.label),h=numIn(e.floors?.[f.label]?.height??storyM,60,'0.05');hs[f.label]=h;
   const ok=row&&e.floors?.[f.label]?.sig===row.sig,box=el('input',{type:'checkbox'});box.checked=!!ok;box.disabled=!row;
   box.onchange=()=>{const fl={...(energySettings(engine.doc).floors||{})};fl[f.label]={...(fl[f.label]||{}),sig:box.checked?row.sig:null};save({floors:fl});render();};
   t.append(el('tr',{},el('td',{},f.label),el('td',{},h),el('td',{},row?row.floorArea+'㎡':'—'),el('td',{},row?row.roof+'㎡':'—'),el('td',{},row?row.ground+'㎡':'—'),
    el('td',{},row?`창 ${row.windows} · 문 ${row.doors}`+(row.tags.length?` (${row.tags.join(' ')})`:''):'—'),
    el('td',{class:'m'},row?Object.entries(row.byOrientation).map(([d,v])=>`${d} ${v.gross}`).join(' · '):'—'),el('td',{},box,ok?el('span',{class:'g'},' 확인함'):null)));}
  const north=numIn(e.northDeg??90,60),grid=txt(e.grid||'X1',60);
  const saveInputs=()=>{const fl={...(e.floors||{})};for(const [k,i] of Object.entries(hs))fl[k]={...(fl[k]||{}),height:n(i)};save({floors:fl,northDeg:n(north)??90,grid:grid.value.trim()||'X1'});};
  return [el('h3',{},'④ 도면마다 윈도우 · 하나씩 확인'),el('p',{class:'pb-note'},'층고와 창호 일람표 영역을 넣고 [평면 읽기]를 누르면 층마다 벽 바깥면·창·문·실을 읽습니다. 값을 보고 맞으면 [확인]에 체크하세요. 도면이 바뀌어 읽은 값이 달라지면 확인이 풀립니다.'),
   el('p',{},'창호 일람표 영역: ',sch.length?el('span',{class:'g'},`${sch.length}곳 고름`):el('span',{class:'r'},'없음'),' ',el('button',{class:'pb-btn',onclick:()=>{dialog.close();studio.handlers.ENERGYREGION?.({kind:'window_schedule'});}},'영역 고르기(종류: 창호 일람표)')),
   el('div',{class:'pb-grid'},el('label',{},'북쪽 방향(도면 각도°, 위쪽=90)',north),el('label',{},'층 맞춤 그리드 이름',grid)),t,
   el('button',{class:'pb-btn pri',onclick:()=>{saveInputs();run('평면 읽는 중… (층마다 몇 초)',async()=>{state.env=await api({action:'energy-envelope',...ctx.base(),...energyRequest(engine.doc)});});}},'저장하고 평면 읽기'),
   env?.issues?.length?el('div',{},el('p',{class:'y'},'확인할 것'),...env.issues.map(x=>el('p',{class:'m'},'· '+x))):null];
 }

 function layersEditor(code,a,onChange){
  const t=el('table',{},el('tr',{},el('th',{},'#'),el('th',{},'재료 (실외 → 실내)'),el('th',{},'두께 mm'),el('th',{},'λ W/mK'),el('th',{})));
  (a.layers||[]).forEach((l,i)=>{const nm=txt(l[0],200),th=numIn(l[1],70),la=numIn(l[2],70,'0.001');
   const upd=()=>{a.layers[i]=[nm.value.trim(),n(th),n(la)];onChange();};nm.onchange=th.onchange=la.onchange=upd;
   t.append(el('tr',{},el('td',{},String(i)),el('td',{},nm),el('td',{},th),el('td',{},la),el('td',{},el('button',{class:'pb-btn',style:'margin:0;padding:2px 8px',onclick:()=>{a.layers.splice(i,1);onChange();render();}},'빼기'))));});
  return [t,el('button',{class:'pb-btn',onclick:()=>{(a.layers||=[]).push(['',null,null]);onChange();render();}},'층 더하기')];
 }

 function gaps(){
  const wait=need();if(wait)return wait;
  const e=energySettings(engine.doc),g=energyGaps({doc:engine.doc,db:state.energyDb,env:state.env}),A=e.assemblies?structuredClone(e.assemblies):null;
  const head=[el('h3',{},'⑤ 부족한 것 확인'),el('p',{class:'pb-note'},'빨강 = 채워야 확정할 수 있는 것 · 노랑 = 확인 권장. 짐작해서 채우지 않습니다 — 기본값은 [가정]으로 도서에 표시됩니다.'),
   g.red.length?el('div',{},...g.red.map(x=>el('p',{class:'r'},'● '+x))):el('p',{class:'g'},'빨간 줄 없음'),...g.yellow.map(x=>el('p',{class:'y'},'● '+x))];
  if(!A)return [...head,el('button',{class:'pb-btn pri',onclick:()=>run('기본값 받는 중…',async()=>{const d=await api({action:'energy-defaults'});save({assemblies:d.assemblies,details:d.details,section:d.section,assumed:DEFAULT_ASSUMED});})},'기본값 넣기(흔한 구성 — 고쳐 쓰기)')];
  const keep=()=>save({assemblies:A});
  const sec=[];
  for(const [c,label] of PARTS){const a=A[c];
   const side=el('select');for(const [v,l] of [['exterior','외단열'],['interior','내단열·슬래브 아래']]){const o=el('option',{value:v},l);if(a.side===v)o.selected=true;side.append(o);}side.onchange=()=>{a.side=side.value;keep();};
   const ex=el('select');for(const [v,l] of [['direct','외기 직접'],['indirect','외기 간접']]){const o=el('option',{value:v},l);if(a.exposure===v)o.selected=true;ex.append(o);}ex.onchange=()=>{a.exposure=ex.value;keep();};
   const extra=c==='F1'?(()=>{const fh=el('input',{type:'checkbox'});fh.checked=!!a.floorHeating;fh.onchange=()=>{a.floorHeating=fh.checked;a.condition=fh.checked?'floor_heating':undefined;keep();render();};
    const uf=txt((a.underfloor||[]).join(','),80);uf.onchange=()=>{a.underfloor=uf.value.split(/[ ,]+/).filter(Boolean).map(Number).filter(Number.isInteger);keep();};
    return el('span',{},' 바닥난방 ',fh,a.floorHeating?el('span',{},' 배관 아래~슬래브 층 번호 ',uf):null);})():null;
   sec.push(el('h4',{style:'margin:12px 0 4px'},`${c} ${label}`),el('div',{},'노출 ',ex,' 단열 위치 ',side,extra),...layersEditor(c,a,keep));}
  const O=A.openings,op=el('table',{},el('tr',{},el('th',{},'부호'),el('th',{},'U'),el('th',{},'기밀 등급'),el('th',{},'SHGC'),el('th',{},'창틀계수'),el('th',{},'유리·문'),el('th',{},'프레임')));
  for(const c of ['G1','D1']){const o=O[c],u=numIn(o.U,60,'0.001'),ag=numIn(o.airtightGrade,50,'1'),sh=numIn(o.shgc,60,'0.01'),fr=numIn(o.frame,60,'0.01'),gl=txt(o.glass,170),ft=txt(o.frameType,110);
   const upd=()=>{Object.assign(o,{U:n(u),airtightGrade:n(ag),shgc:n(sh),frame:n(fr),glass:gl.value.trim(),frameType:ft.value.trim()});keep();};[u,ag,sh,fr,gl,ft].forEach(i=>i.onchange=upd);
   op.append(el('tr',{},el('td',{},c),el('td',{},u),el('td',{},ag),el('td',{},sh),el('td',{},fr),el('td',{},gl),el('td',{},ft)));}
  const tape=el('input',{type:'checkbox'});tape.checked=A.airtightTape===true;tape.onchange=()=>{A.airtightTape=tape.checked;keep();};
  const asm=el('input',{type:'checkbox'});asm.checked=(e.assumed||[]).length>0;asm.onchange=()=>{save({assumed:asm.checked?DEFAULT_ASSUMED:[]});render();};
  // 설비(협력사 자료): EPI 점수 줄
  const S=structuredClone(e.systems||{summary:{},epi:[]}),keepS=()=>save({systems:S});
  const st=el('table',{},el('tr',{},el('th',{},'부문'),el('th',{},'번호'),el('th',{},'항목'),el('th',{},'배점 b'),el('th',{},'근거'),el('th',{})));
  S.epi.forEach((x,i)=>{const p=el('select');for(const v of ['기계','전기','신재생']){const o=el('option',{value:v},v);if(x[0]===v)o.selected=true;p.append(o);}
   const no=numIn(x[1],50,'1'),nm=txt(x[2],180),b=numIn(x[3],60,'0.1'),bs=txt(x[4],180);const upd=()=>{S.epi[i]=[p.value,n(no),nm.value.trim(),n(b),bs.value.trim()];keepS();};[p,no,nm,b,bs].forEach(q=>q.onchange=upd);
   st.append(el('tr',{},el('td',{},p),el('td',{},no),el('td',{},nm),el('td',{},b),el('td',{},bs),el('td',{},el('button',{class:'pb-btn',style:'margin:0;padding:2px 8px',onclick:()=>{S.epi.splice(i,1);keepS();render();}},'빼기'))));});
  const sum={};for(const [k,l] of [['mechanical','기계 요약'],['electrical','전기 요약'],['renewable','신재생 요약']]){const i=txt(S.summary?.[k],260);i.onchange=()=>{(S.summary||={})[k]=i.value.trim();keepS();};sum[k]=el('label',{},l,i);}
  return [...head,el('h3',{style:'margin-top:14px'},'형별(벽·지붕·바닥)'),...sec,el('h3',{style:'margin-top:14px'},'창·문'),op,el('p',{},'창·문 접합부 기밀테이프(EPI 건축 6) ',tape,' · 기본값 그대로 — 도서에 [가정] 표시 ',asm),
   el('h3',{style:'margin-top:14px'},'기계·전기·신재생 (협력사 자료)'),el('div',{class:'pb-grid'},...Object.values(sum)),st,el('button',{class:'pb-btn',onclick:()=>{S.epi.push(['기계',null,'',null,'']);keepS();render();}},'점수 줄 더하기')];
 }

 function confirm(){
  const wait=need();if(wait)return wait;
  const e=energySettings(engine.doc),g=energyGaps({doc:engine.doc,db:state.energyDb,env:state.env});
  const btn=el('button',{class:'pb-btn pri',onclick:()=>{save({confirmedAt:new Date().toISOString()});render();}},g.red.length?`확정 (빨간 줄 ${g.red.length}개 남음)`:'전부 있음 — 확정');if(g.red.length)btn.disabled=true;
  return [el('h3',{},'⑥ 전부 있음 확정'),el('p',{class:'pb-note'},'빨간 줄이 하나도 없을 때만 확정됩니다. 노란 줄(설비 점수·가정 값)은 남아 있어도 확정할 수 있습니다(대표 결정).'),
   e.confirmedAt?el('p',{class:'g'},'확정: '+localStamp(e.confirmedAt)):null,...g.red.map(x=>el('p',{class:'r'},'● '+x)),btn];
 }
 return {legal,read,gaps,confirm};
}
