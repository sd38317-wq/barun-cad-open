// 인허가 도서 창 — [에너지절약계획서]·[장애인편의시설] 두 탭(대표 승인 2026-10-25, 시안 docs/시안-인허가도서-에너지편의시설-2026-10-25).
// ① 개요와 ③ 층 평면 범위는 두 탭이 같이 쓴다: 개요는 reviewSettings.permitBook.overview, 층 범위는 에너지 영역(reviewSettings.energyPlanRegions 의 floor)을 그대로.
// 판정·도서는 서버(/api/permit-book → permit_book_service.py → tools/access_plan·energy_plan)가 만든다. 이 창은 값을 모으고 결과를 보여 주기만 한다.
import {energyRegions,makeEnergyRegion} from './energy-regions.js';
import {cropDocument,buildAccessModel,flattenStories,planMarks} from './access-book-model.js';
import {energySteps,energyStepInfo,energyRequest,energySettings,energyGaps,localStamp,DEFAULT_ASSUMED} from './permit-energy.js';
import {storedOverview,applyOverviewEdits,overviewSettings,readOverviewFromDocument} from './building-overview.js';

// 앱 공통 dialog 꾸밈(폭 780px)을 이 창만 넓힌다.
const CSS=`#permit-book{max-width:none!important;width:min(1180px,94vw)!important;height:84vh!important;max-height:none!important;padding:0;border:1px solid #3d444d;border-radius:14px;background:#1b1e23;color:#e6e9ed;overflow:hidden}
#permit-book .pb-top{display:flex;align-items:center;gap:2px;background:#14161a;padding:8px 12px 0}
#permit-book .pb-top h2{font-size:14px;margin:0 16px 6px 0;font-weight:650}
#permit-book .pb-tab{padding:6px 14px;border-radius:8px 8px 0 0;color:#9aa4b0;background:#1f2328;border:0;font-size:12.5px;cursor:pointer}
#permit-book .pb-tab.on{background:#1b1e23;color:#e6e9ed;outline:1px solid #9dcbe0;outline-offset:-1px}
#permit-book .pb-tab small{margin-left:6px;color:#7fd19b}
#permit-book .pb-close{margin-left:auto;margin-bottom:6px}
#permit-book .pb-wiz{display:grid;grid-template-columns:210px 1fr;height:calc(100% - 40px)}
#permit-book .pb-steps{background:#16191d;border-right:1px solid #383f48;padding:10px 8px;overflow:auto}
#permit-book .pb-steps button{display:block;width:100%;text-align:left;background:none;border:0;color:#9aa4b0;padding:6px 9px;border-radius:7px;margin-bottom:3px;font-size:12.5px;cursor:pointer}
#permit-book .pb-steps button small{display:block;font-size:10.5px;color:#7d8792}
#permit-book .pb-steps button.done small{color:#7fd19b}#permit-book .pb-steps button.on{background:#2e333b;color:#e6e9ed;outline:1px solid #9dcbe0}
#permit-book .pb-share{font-size:10px;color:#9dcbe0;border:1px solid #3f5d6e;border-radius:4px;padding:0 5px;margin-left:4px}
#permit-book .pb-body{padding:14px 18px;overflow:auto;font-size:12.5px;line-height:1.55}
#permit-book .pb-body h3{font-size:14px;margin:0 0 8px}
#permit-book .pb-note{color:#9aa4b0;margin:4px 0 10px}
#permit-book table{width:100%;border-collapse:collapse;margin:6px 0}
#permit-book th{text-align:left;color:#9aa4b0;font-weight:500;border-bottom:1px solid #383f48;padding:4px}
#permit-book td{border-bottom:1px solid #30363f;padding:4px;vertical-align:middle}
#permit-book input,#permit-book select{font-size:12.5px;padding:4px 6px;background:#14161a;color:#e6e9ed;border:1px solid #3d444d;border-radius:6px}
#permit-book .pb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:6px 14px}
#permit-book .pb-grid label{display:flex;justify-content:space-between;align-items:center;gap:8px}
#permit-book .pb-btn{border:1px solid #383f48;background:#2e333b;border-radius:7px;padding:6px 12px;margin:8px 6px 0 0;color:#e6e9ed;cursor:pointer}
#permit-book .pb-btn.pri{background:#2f5f76;border-color:#9dcbe0}
#permit-book .g{color:#7fd19b}#permit-book .y{color:#ffb65c}#permit-book .r{color:#ff8b83}#permit-book .m{color:#9aa4b0}
#permit-book .pb-check td:nth-child(-n+4),#permit-book .pb-check th{white-space:nowrap}#permit-book .pb-check td:last-child span{display:inline-block;margin:2px 10px 2px 0}
#permit-book .pb-tag{font-size:10.5px;border:1px solid;border-radius:4px;padding:0 5px;white-space:nowrap}`;

const OVERVIEW=[['name','건축명'],['office','설계자(사무소)'],['address','대지위치'],['siteArea','대지면적 ㎡','number'],['zone','지역·지구'],['buildingArea','건축면적 ㎡','number'],
 ['gfa','연면적 ㎡','number'],['mainUse','주용도'],['structure','구조'],['date','작성일','date'],['frameNumber','원 도면 도곽 번호(예: A-601)'],['planSheets','원 도면 평면 번호(예: A-101·A-102)']];
const REQ={mandatory:'의무',recommended:'권장','not-required':'',unknown:'확인'};
const today=()=>new Date().toISOString().slice(0,10);
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props))k==='class'?e.className=v:k==='style'?e.style.cssText=v:k.startsWith('on')?e[k]=v:e.setAttribute(k,v);e.append(...kids.filter(k=>k!=null));return e;};

/** 도서 목록 줄 — 같은 이름이 이어지는 시트(상세도 등)는 한 줄로(AC-301~318 · 18장). */
export function sheetGroups(sheets){
 const out=[];for(const s of sheets){const last=out.at(-1);if(last&&last.title===s.title){last.to=s.number;last.n++;}else out.push({from:s.number,to:s.number,title:s.title,n:1});}
 return out.map(g=>[g.n>1?`${g.from}~${g.to.replace(/^[A-Z]+-/,'')}`:g.from,g.n>1?`${g.title} ${g.n}장`:g.title]);
}
/** ② 편의시설 조건 → 앱 판정이 받는 값(숫자·공사 종류·기준일 정리). 서버 permit_book_service._access_project 와 같은 규칙. */
export function accessFacility(f={},overview={}){
 const n=v=>v===''||v==null||!Number.isFinite(Number(v))?null:Number(v),out={use:f.use||'',areaM2:n(f.areaM2),work:['new','change-use'].includes(f.work)?f.work:'new',date:f.date||overview.date||new Date().toISOString().slice(0,10)};
 if(n(f.parkingSpaces)!=null)out.parkingSpaces=Math.trunc(n(f.parkingSpaces));if(n(f.parkingRatio)!=null)out.parkingRatio=n(f.parkingRatio);
 return out;
}
/** 도면에 저장한 인허가 도서 값(되돌리기 됨). */
export function permitSettings(doc){return structuredClone(doc?.reviewSettings?.permitBook||{});}
/** ③ 공용 층 범위 — 에너지 영역 중 층만, 아래층부터. 엔진에는 '1층' 같은 이름과 범위로 준다. */
export function permitFloors(doc){return energyRegions(doc).filter(r=>r.kind==='floor').map(r=>({name:r.label,bounds:r.bounds}));}
/** 창과 AI 도구가 서버에 같이 보내는 바탕 값. */
export function permitBase(doc,drawingPath=''){const s=permitSettings(doc);return {document:doc,drawingPath,overview:s.overview||{},floors:permitFloors(doc),facility:s.facility||{},accessibility:{facilities:s.facilities||{}}};}
/** 한 벌(drawingSets) 층 → 에너지 층 번호: 옥상층은 빼고 레벨 순서로 지상 1·2…, 지하는 위에서부터 -1·-2…. */
function setFloorNumbers(model){
 const st=(model?.stories||[]).filter(s=>s.id!=='rf'&&!/옥상|지붕|roof/i.test(s.name||'')).sort((a,b)=>a.elevation-b.elevation),out={};
 st.filter(s=>s.elevation<0).reverse().forEach((s,i)=>out[s.id]=-(i+1));st.filter(s=>!(s.elevation<0)).forEach((s,i)=>out[s.id]=i+1);
 return out;
}
const unionBox=bs=>({minX:Math.min(...bs.map(b=>b.minX)),minY:Math.min(...bs.map(b=>b.minY)),maxX:Math.max(...bs.map(b=>b.maxX)),maxY:Math.max(...bs.map(b=>b.maxY))});
/** 미리 초안(2026-10-30 대표 "필요한 도면은 자기가 찾아 넣어야"): 확정 전 빈칸만 도면에서 찾아 채운다 — 설계자 값·고른 영역은 그대로.
 * ① 건축명·대지위치 = 저장된 개요 → 도면 건축개요 글자 → 한 벌 설계 자료(building) → (건축명만) 도면 파일 이름, ② 지역 = 대지위치로 별표1(서버 energy-region),
 * ③ 층 범위 = 한 벌 평면 장(한 장 한 층, 옥상 뺌) · 층고 = 한 벌 층 높이 → 개요 층고, ④ 창호 일람표 = 한 벌 창호도 장, ⑤ 형별 = [기본값 넣기]와 같은 기본값([가정]).
 * settings = review.settings 한 번(되돌리기 됨, 확정 안 함 — energy.draftAt), assumed = 채운 값마다 쉬운 말 한 줄. */
export async function energyDraft(doc,{api,drawingPath=''}){
 const rs=doc?.reviewSettings||{},assumed=[],e=energySettings(doc);let store=storedOverview(doc);const edits={};
 const sets=doc?.drawingSets||{},setIds=Object.keys(sets).filter(id=>(doc.sheets||[]).some(sh=>sh.drawingSet===id&&sh.kind==='plan'));
 const setId=setIds.at(-1),model=sets[setId]?.model,sheets=(doc?.sheets||[]).filter(sh=>sh.drawingSet===setId&&sh.bounds);
 const read=readOverviewFromDocument(doc).values,fileName=String(drawingPath).split(/[\\/]/).pop().replace(/\.[^.]+$/,'');
 // 연면적·주용도도 채운다(2026-11-02) — 연면적이 비면 도서 만들기가 깨졌고, 주용도로 주거·비주거를 가른다
 for(const [k,label,setKey=k] of [['name','건축명'],['address','대지위치'],['gfa','연면적'],['mainUse','주용도','use']]){
  if(store.values[k])continue;
  const fromSet=model?.building?.[setKey];   // 지금 한 벌만 — 지운 옛 한 벌(도면에 남은 drawingSets)의 이름·주소가 섞였다(2026-11-02)
  const [v,from]=read[k]?[read[k],'도면 건축개요 글자']:fromSet?[fromSet,'한 벌 설계 자료']:k==='name'&&fileName?[fileName,'도면 파일 이름']:[];
  if(v){edits[k]=String(v);assumed.push(`${label}: '${v}' — ${from}에서 찾음`);}
 }
 if(Object.keys(edits).length)store=applyOverviewEdits(store,edits,'미리 · 도면에서 찾음(설계자 확인 전)');
 const permitBook=Object.keys(edits).length?overviewSettings(doc,store).permitBook:structuredClone(rs.permitBook||{}),ov=permitBook.overview||{};
 // 개요 대지위치가 '괴정동 213-17 / 사리로 64-1'처럼 시·도 없이 적히면 지역을 못 정한다(2026-10-30) — 불러온 지적의 주소·한 벌 설계 주소도 차례로 본다
 const addresses=[ov.address,...(doc?.entities||[]).filter(x=>x.parcelRole==='site').map(x=>x.attributes?.landInfo?.address),model?.building?.address].filter(Boolean);
 for(const address of e.region?[]:[...new Set(addresses)]){const r=await api('permit-book',{action:'energy-region',overview:{...ov,address}});if(r?.region){e.region=r.region;assumed.push(`지역: ${r.label} — 주소 '${address}'로 별표1에서 정함`);break;}}
 const regions=energyRegions(doc),add=[],nums=setFloorNumbers(model),pt=(b,c)=>({x:b[c+'X'],y:b[c+'Y']});
 if(!regions.some(r=>r.kind==='floor'))for(const sh of sheets.filter(s=>s.kind==='plan'&&s.stories?.length===1&&nums[s.stories[0]])){
  const r=makeEnergyRegion({kind:'floor',floor:nums[sh.stories[0]]},pt(sh.bounds,'min'),pt(sh.bounds,'max'));
  if(!add.some(a=>a.key===r.key)){add.push(r);assumed.push(`${r.label} 평면 범위: 한 벌 평면 장 ${sh.id.replace(setId+'-sheet-','')}`);}}
 const sch=sheets.filter(s=>s.kind==='schedule').map(s=>s.bounds);
 if(!regions.some(r=>r.kind==='window_schedule')&&sch.length){const b=unionBox(sch);add.push(makeEnergyRegion({kind:'window_schedule'},pt(b,'min'),pt(b,'max')));assumed.push('창호 일람표 영역: 한 벌 창호도 장');}
 const floors=[...regions,...add].filter(r=>r.kind==='floor'),heights={...(e.floors||{})},byNo=Object.fromEntries(Object.entries(nums).map(([id,n])=>[n,model.stories.find(s=>s.id===id)]));
 const ovH=Number(ov.storyHeight)>0?Number(ov.storyHeight)/1000:null;
 for(const f of floors){if(Number(heights[f.label]?.height)>0)continue;const sh=byNo[f.floor]?.height>0?byNo[f.floor].height/1000:null,h=sh??ovH;
  if(h){heights[f.label]={...(heights[f.label]||{}),height:h};assumed.push(`${f.label} 층고 ${h} m — ${sh?'한 벌 층 높이':'건축개요 층고'}`);}}
 e.floors=heights;
 if(!e.assemblies){const d=await api('permit-book',{action:'energy-defaults'});Object.assign(e,{assemblies:d.assemblies,details:d.details,section:d.section,assumed:DEFAULT_ASSUMED});assumed.push('형별(외벽·지붕·바닥·창·문): 흔한 구성 기본값 — 도서에 [가정] 표시, 설계자가 창 ⑤에서 고쳐 쓰기');}
 if(!assumed.length)return {settings:null,assumed};
 permitBook.energy={...e,draftAt:new Date().toISOString(),draftAssumed:assumed};
 return {assumed,settings:{permitBook,...(Object.keys(edits).length?{buildingOverview:store}:{}),...(add.length?{energyPlanRegions:[...(rs.energyPlanRegions||[]),...add]}:{})}};
}
/** AI 도구 cad_energy_plan: 설계자가 에너지 탭 ⑥에서 확정한 값으로 도서를 만든다.
 * 확정 전(2026-10-30): autofill(기본) 이면 미리가 빈칸을 도면에서 채운 초안(settings — 다리가 저장)으로, build 면 '초안 — 설계자 확인 전' 도서. autofill=false 는 예전처럼 남은 것만. */
export async function energyPlanForAI(doc,{api,drawingPath='',build=false,autofill=true}){
 const gaps=d=>energyGaps({doc:d,db:null,env:null}).red.filter(x=>!x.startsWith('④ 평면 읽기'));
 let e=energySettings(doc);
 if(!e.confirmedAt&&autofill){
  const {settings,assumed}=await energyDraft(doc,{api,drawingPath}),d=settings?{...doc,reviewSettings:{...doc.reviewSettings,...settings}}:doc,missing=gaps(d);
  const out={built:false,confirmed:false,draft:true,missing,assumed:energySettings(d).draftAssumed||assumed,...(settings?{settings}:{})};
  if(missing.length)return {...out,needs:[{key:'missing',question:`도면에서 못 찾은 것: ${missing.join(' · ')}. 알려 주시면 넣겠습니다(에너지절약계획서 창에서 직접 채워도 됩니다).`,choices:[]}]};
  if(!build)return {...out,message:'도면에서 찾아 초안으로 채웠습니다(설계자 확정 전). build=true 로 부르면 초안 도서를 만듭니다. 설계자는 에너지절약계획서 창에서 값을 보고 고친 뒤 ⑥ [확정].'};
  return {...out,built:true,...await api('permit-book',{action:'energy-build',...permitBase(d,drawingPath),...energyRequest(d),draft:true})};
 }
 const missing=gaps(doc);
 if(!e.confirmedAt)return {built:false,confirmed:false,missing,needs:[{key:'confirm',question:'에너지절약계획서 창(실시 탭 → 에너지절약계획)에서 빨간 줄을 채우고 ⑥ [확정]을 눌러 주세요. 층 범위·창호 일람표 영역은 화면에서 찍어야 해요.',choices:[]}]};
 if(!build)return {built:false,confirmed:true,confirmedAt:e.confirmedAt,missing,message:'확정돼 있습니다. build=true 로 부르면 도서를 만듭니다(1분 안팎).'};
 return {built:true,confirmed:true,...await api('permit-book',{action:'energy-build',...permitBase(doc,drawingPath),...energyRequest(doc)})};
}
/** ④ 시설 확인 표 한 줄 → accessibility.facilities[항목] (설치 여부·실측값·조건 체크). 빈 값은 넣지 않는다.
 * 기울기는 '1/□'의 분모로 받는다(0 = 평지). 조건 체크(지형상 곤란 등)는 실측값과 함께만 넣는다. */
export function facilityDeclaration(row,choice){
 const out={};if(choice.installed==='yes')out.installed=true;else if(choice.installed==='no')out.installed=false;
 const values={};for(const c of row.checks||[]){const raw=choice.values?.[c.field],v=Number(raw);if(!c.field||raw===''||raw==null||!Number.isFinite(v))continue;if(c.field!=='slope')values[c.field]=v;else if(v>=0)values.slope=v?1/v:0;}
 if(Object.keys(values).length){for(const [k,on] of Object.entries(choice.flags||{}))if(on===true)values[k]=true;out.values=values;out.verified=true;}else if(out.installed===true&&!(row.checks||[]).length)out.verified=true;
 return out;
}

export function installPermitBook(studio,{getFilePath=()=>''}={}){
 const {engine,toast}=studio.context;
 if(!document.getElementById('permit-book-css'))document.head.append(el('style',{id:'permit-book-css'},CSS));
 const dialog=el('dialog',{id:'permit-book'});document.body.append(dialog);
 const state={tab:'access',step:{access:7,energy:7},review:null,result:{},profiles:null,busy:false};
 const save=patch=>{engine.execute({type:'review.settings',settings:{permitBook:{...permitSettings(engine.doc),...patch}}});};
 const api=args=>studio.api('permit-book',args);
 const base=()=>permitBase(engine.doc,getFilePath()||'');
 // 편의시설 판정·계획도 기호는 앱 명령 작업자(잠금 코드를 푼 앱 쪽)에서 만들어 서버에 넘긴다 — 설치판 백엔드에는 node·잠금 코드가 없다.
 // 순서는 개발용 다리(tools/access_plan/bridge.mjs)와 같다: 층마다 인식 → 건물 모델 → 건물 전체 판정 → 층마다 기호.
 async function appBridge(){
  const s=permitSettings(engine.doc),facility=accessFacility(s.facility,s.overview),floors=permitFloors(engine.doc);
  if(!floors.length)throw Error('③ 층 평면 범위를 먼저 고르세요(층마다 윈도우 두 점).');
  if(!facility.use||!(facility.areaM2>0))throw Error('② 대상 판정의 용도와 해당 용도 면적을 넣으세요.');
  const response=await fetch('/drawing-knowledge.json',{cache:'no-store'}),knowledge=await response.json();
  if(!response.ok)throw Error(knowledge.error||'도면 기준을 열 수 없습니다. 계정 연결 상태를 확인하세요.');
  const {createCommandClient}=await import('./command-runner.js'),client=createCommandClient();
  const plan=(doc,more)=>client.generate(doc,{kind:'access-plan',...knowledge,facility,overlay:true,...more});
  const elementsOf=r=>[...new Map(r.plan.labels.map(l=>[l.element.id,l.element])).values()];
  try{
   const docs=floors.map(f=>({id:f.name,name:f.name,doc:cropDocument(engine.doc,[f.bounds.minX,f.bounds.minY,f.bounds.maxX,f.bounds.maxY])}));
   for(const f of docs)f.elements=elementsOf(await plan(structuredClone(f.doc),{}));
   const itemKinds=Object.fromEntries((knowledge.details?.access?.planRules?.items||[]).map(i=>[i.id,i.kinds||[]]));
   const model=buildAccessModel({floors:docs,accessibility:{facilities:s.facilities||{}},itemKinds,date:facility.date});
   const all=await plan(structuredClone(docs[0].doc),{model:flattenStories(model),story:'ALL'}),out=[];
   for(const f of docs){const doc=structuredClone(f.doc),before=new Set(doc.entities.map(e=>e.id)),r=await plan(doc,{model,story:f.id});
    out.push({id:f.id,doc:planMarks(r,before,knowledge.standard?.accessPlan?.textHeight||120),labels:r.plan.labels.map(l=>({row:l.row,code:l.code,at:l.at,position:l.position,violation:l.violation}))});}
   return {model,decision:all.plan.decision,rows:all.plan.rows,floors:out};
  }finally{client.stop?.();}
 }
 const accessBase=async()=>({...base(),bridge:await appBridge()});
 const run=async(label,fn)=>{if(state.busy)return;state.busy=true;state.error='';render(label);try{await fn();}catch(e){state.error=e.message||String(e);toast(state.error,true);}finally{state.busy=false;render();}};   // 오류는 창 안에도(알림은 창 뒤에 가려짐)

 // ── 단계 요약(왼쪽 칸 작은 글) ──
 function stepInfo(tab){
  const s=permitSettings(engine.doc),ov=s.overview||{},floors=permitFloors(engine.doc),r=state.review,res=state.result[tab];
  const ovText=ov.mainUse||ov.gfa?[ov.mainUse,ov.gfa?ov.gfa+'㎡':''].filter(Boolean).join(' · '):'';
  const fl=floors.length?floors.map(f=>f.name).join(' · '):'';
  if(tab==='energy'){const ei=energyStepInfo(engine.doc,state);return [['① 개요 윈도우',ovText,true],['② 법적 검토',ei.legal],['③ 층 평면 정리',fl,true],['④ 도면마다 윈도우',ei.read],['⑤ 부족한 것 확인',ei.gaps],['⑥ 전부 있음 확정',ei.confirmed],
   ['⑦ 도서 만들기',res?`${res.sheets.length}장${res.calc?' · '+res.calc.total+'점 '+(res.calc.passOk?'적합':'부적합'):''}`:'']];}
  const active=r?r.rows.filter(x=>['mandatory','recommended'].includes(x.requirement)):[];
  const kinds=r?r.candidates.reduce((m,c)=>(m[c.kind]=(m[c.kind]||0)+1,m),{}):{};
  return [['① 개요 윈도우',ovText,true],['② 대상 판정',r?`${r.decision.status} · 의무 ${r.rows.filter(x=>x.requirement==='mandatory').length} · 권장 ${r.rows.filter(x=>x.requirement==='recommended').length}`:(s.facility?.use?'판정 보기 전':'')],
   ['③ 층 평면 정리',fl,true],['④ 시설 확인',r?`문 ${kinds.door||0} · 계단 ${kinds.stair||0} · 화장실 ${kinds.accessible_wc||0}`:''],
   ['⑤ 부족한 것 확인',r?`빨간 줄 ${active.filter(x=>x.violation).length} · 노란 줄 ${active.filter(x=>!x.violation&&x.status!=='적합').length}`:''],
   ['⑥ 전부 있음 확정',s.confirmedAt?localStamp(s.confirmedAt).slice(5):''],['⑦ 도서 만들기',res?`${res.sheets.length}장 · 미설치·부적합 ${res.rows.filter(x=>x.violation).length}`:(r?`${r.sheets.length}장 예정`:'')]];
 }

 // ── 각 단계 내용 ──
 function overviewStep(){
  // 값은 건축개요 한 곳(도면 인식과 같이 씀, docs/adr/0001)에서 읽고, 고치면 그곳도 같이 바뀐다. 도면 인식이 읽은 칸은 이름 옆에 표시.
  const store=storedOverview(engine.doc),ov={...(permitSettings(engine.doc).overview||{}),...store.values},grid=el('div',{class:'pb-grid'}),inputs={};
  const fromRead=k=>store.evidence[k]&&!/인허가 개요 윈도우|설계자 입력/.test(store.evidence[k]);
  for(const [k,label,type] of OVERVIEW){const i=el('input',{type:type||'text'});i.value=ov[k]??(k==='date'?today():'');inputs[k]=i;grid.append(el('label',{title:store.evidence[k]||''},el('span',{},label,fromRead(k)?el('span',{class:'pb-share'},'도면 인식'):null),i));}
  const saveOverview=()=>{
   const values=Object.fromEntries(Object.entries(inputs).map(([k,i])=>[k,i.type==='number'?(i.value===''?null:Number(i.value)):i.value.trim()]));
   const edits=Object.fromEntries(Object.entries(values).filter(([k,v])=>(v??'')!==(store.values[k]??'')).map(([k,v])=>[k,v??'']));
   const next=applyOverviewEdits(store,edits,'인허가 개요 윈도우에서 고침'),settings=overviewSettings(engine.doc,next);
   settings.permitBook.overview={...settings.permitBook.overview,...values};
   engine.execute({type:'review.settings',settings});state.review=null;toast('개요를 저장했습니다.');render();
  };
  return [el('h3',{},'① 개요 윈도우',el('span',{class:'pb-share'},'두 탭이 같이 씀')),el('p',{class:'pb-note'},'한 번 넣으면 에너지·편의시설 도서와 구조 검토가 같이 씁니다. [도면 인식]으로 도면의 개요표에서 읽어 올 수 있고, 여기서 고치면 도면 인식 결과도 같이 바뀝니다. 도면에 저장되고 Ctrl+Z 로 되돌릴 수 있습니다.'),grid,
   el('button',{class:'pb-btn pri',onclick:saveOverview},'저장'),studio.handlers.RECOGNIZE?el('button',{class:'pb-btn',onclick:()=>{dialog.close();studio.handlers.RECOGNIZE();}},'도면 인식으로 읽기'):null];
 }
 function floorStep(){
  const floors=permitFloors(engine.doc),t=el('table',{},el('tr',{},el('th',{},'층'),el('th',{},'범위(mm)')));
  for(const f of floors)t.append(el('tr',{},el('td',{},f.name),el('td',{class:'m'},`${Math.round(f.bounds.minX)}, ${Math.round(f.bounds.minY)} ~ ${Math.round(f.bounds.maxX)}, ${Math.round(f.bounds.maxY)}`)));
  return [el('h3',{},'③ 층 평면 정리',el('span',{class:'pb-share'},'두 탭이 같이 씀')),el('p',{class:'pb-note'},'층마다 평면 범위를 출력 창의 [윈도우]처럼 두 점으로 고릅니다(에너지 영역의 "층"과 같은 값). 도서의 층별 계획도가 이 범위를 씁니다.'),
   floors.length?t:el('p',{class:'y'},'아직 고른 층이 없습니다.'),
   el('button',{class:'pb-btn pri',onclick:()=>{dialog.close();studio.handlers.ENERGYREGION?.();}},'층 범위 고르기')];
 }
 function facilityStep(){
  const f=permitSettings(engine.doc).facility||{},sel=el('select');
  if(!state.profiles){run('용도 목록 받는 중…',async()=>{state.profiles=(await api({action:'access-profiles'})).profiles;});return [el('p',{class:'m'},'용도 목록을 받는 중…')];}
  sel.append(el('option',{value:''},'— 용도를 고르세요'));for(const p of state.profiles){const o=el('option',{value:p.id},p.name);if(p.id===f.use)o.selected=true;sel.append(o);}
  const num=(v,step)=>{const i=el('input',{type:'number',step:step||'any'});i.value=v??'';return i;};
  const area=num(f.areaM2),work=el('select'),date=el('input',{type:'date'}),spaces=num(f.parkingSpaces,'1'),ratio=num(f.parkingRatio!=null?f.parkingRatio*100:'');
  for(const [v,l] of [['new','신축'],['change-use','용도변경']]){const o=el('option',{value:v},l);if((f.work||'new')===v)o.selected=true;work.append(o);}
  date.value=f.date||today();
  const r=state.review,rows=r?el('table',{},el('tr',{},el('th',{},'번호'),el('th',{},'시설 항목'),el('th',{},'설치대상')),...r.rows.map((x,i)=>el('tr',{},el('td',{},String(i+1)),el('td',{},x.name),el('td',{class:x.requirement==='mandatory'?'g':'m'},REQ[x.requirement]||'')))):null;
  return [el('h3',{},'② 대상 판정 — 시행령 별표1·별표2'),el('p',{class:'pb-note'},'용도·해당 용도 면적·공사 종류·기준일로 시설 항목마다 의무·권장을 정합니다(바른 CAD 편의시설 기준, 한국 팩).'),
   el('div',{class:'pb-grid'},el('label',{},'용도',sel),el('label',{},'해당 용도 면적 ㎡',area),el('label',{},'공사 종류',work),el('label',{},'기준일',date),el('label',{},'부설주차 대수',spaces),el('label',{},'조례 설치비율 %',ratio)),
   el('button',{class:'pb-btn pri',onclick:()=>{save({facility:{use:sel.value,areaM2:area.value===''?null:Number(area.value),work:work.value,date:date.value,parkingSpaces:spaces.value===''?null:Number(spaces.value),parkingRatio:ratio.value===''?null:Number(ratio.value)/100}});run('판정하는 중…',review);}},'저장하고 판정 보기'),
   r?el('p',{},'판정: ',el('b',{},r.decision.status),` (${r.decision.name})`):null,rows];
 }
 async function review(){state.review=await api({action:'access-review',...await accessBase()});}
 function checkStep(){
  const r=state.review;if(!r)return [el('h3',{},'④ 시설 확인'),el('p',{class:'y'},'② 대상 판정을 먼저 보세요.')];
  const decl=permitSettings(engine.doc).facilities||{},t=el('table',{class:'pb-check'},el('tr',{},el('th',{},'번호'),el('th',{},'시설 항목'),el('th',{},'도면 후보'),el('th',{},'설치'),el('th',{},'실측값'))),choices={};
  r.rows.forEach((x,i)=>{if(!['mandatory','recommended'].includes(x.requirement))return;
   const d=decl[x.id]||{},inst=el('select');for(const [v,l] of [['','확인 안 함'],['yes','설치함'],['no','설치 안 함']]){const o=el('option',{value:v},l);if((d.installed===true?'yes':d.installed===false?'no':'')===v)o.selected=true;inst.append(o);}
   const vals={},flags={},box=el('div'),den=v=>v?Math.round(100/v)/100:0;
   for(const c of x.checks.filter((c,k,a)=>c.field&&a.findIndex(z=>z.field===c.field)===k)){const i=el('input',{type:'number',step:'any',style:'width:80px'}),slope=c.field==='slope',v=d.values?.[c.field];
    i.value=v==null?'':slope?den(v):v;if(slope)i.placeholder='0=평지';vals[c.field]=i;
    box.append(el('span',{style:'margin-right:8px;white-space:nowrap'},slope?`${c.name} ${c.op} ${c.limit?'1/'+den(c.limit):''} · 실측 1/`:`${c.name} ${c.op} ${c.limit??''}${c.unit||''} `,i));}
   for(const c of x.checks)for(const k of Object.keys(c.alternative?.when||{}))if(!flags[k]){const b=el('input',{type:'checkbox',style:'width:auto;margin:0;padding:0'});b.checked=d.values?.[k]===true;flags[k]=b;box.append(el('label',{style:'display:inline-flex;gap:5px;align-items:center;width:auto;margin:2px 10px 2px 0;white-space:nowrap'},b,c.alternative.label||k));}
   choices[x.id]={row:x,inst,vals,flags};
   t.append(el('tr',{},el('td',{},String(i+1)),el('td',{},x.name),el('td',{class:'m'},x.targets.length?x.targets.length+'곳':'없음'),el('td',{},inst),el('td',{},Object.keys(vals).length?box:el('span',{class:'m'},x.targets.length?'—':'도면에 시설을 그리거나 설치함만 고르기'))));});
  return [el('h3',{},'④ 시설 확인 — 도면이 찾은 후보를 설계자가 확인'),el('p',{class:'pb-note'},'설치했는지와 실측값을 고르면 설치 검토서에 반영됩니다. 실측값이 기준에 맞아야 "적정"이 됩니다(도면 이름·문짝 크기만으로는 적정으로 보지 않음).'),t,
   el('button',{class:'pb-btn pri',onclick:()=>{const out={};for(const [id,c] of Object.entries(choices)){const v=facilityDeclaration(c.row,{installed:c.inst.value,values:Object.fromEntries(Object.entries(c.vals).map(([k,i])=>[k,i.value])),flags:Object.fromEntries(Object.entries(c.flags).map(([k,b])=>[k,b.checked]))});if(Object.keys(v).length)out[id]=v;}save({facilities:out});run('다시 판정하는 중…',review);}},'저장하고 다시 판정')];
 }
 function gapStep(){
  const r=state.review;if(!r)return [el('h3',{},'⑤ 부족한 것 확인'),el('p',{class:'y'},'② 대상 판정을 먼저 보세요.')];
  const rows=r.rows.filter(x=>['mandatory','recommended'].includes(x.requirement)&&x.status!=='적합');
  return [el('h3',{},'⑤ 부족한 것 확인'),el('p',{class:'pb-note'},'빨강 = 의무 시설의 확인된 미설치·규격 부적합(고쳐야 함) · 노랑 = 설치·실측 확인 필요.'),
   rows.length?el('table',{},el('tr',{},el('th',{},'시설 항목'),el('th',{},'상태'),el('th',{},'고칠 것·확인할 것')),...rows.map(x=>el('tr',{},el('td',{},x.name),el('td',{class:x.violation?'r':'y'},x.status),el('td',{class:'m'},[x.conditionNote,x.remedy].filter(Boolean).join(' · ')||'—')))):el('p',{class:'g'},'부족한 것이 없습니다.')];
 }
 function confirmStep(){
  const s=permitSettings(engine.doc);
  return [el('h3',{},'⑥ 전부 있음 확정'),el('p',{class:'pb-note'},'①~⑤를 확인했으면 확정합니다. 확정 뒤에도 고칠 수 있고, 고치면 다시 확정합니다.'),
   s.confirmedAt?el('p',{class:'g'},'확정: '+localStamp(s.confirmedAt)):null,
   el('button',{class:'pb-btn pri',onclick:()=>{save({confirmedAt:new Date().toISOString()});render();}},'확정')];
 }
 function bookStep(tab){
  const res=state.result[tab];
  if(tab==='energy'){
   const e=energySettings(engine.doc),g=state.energyDb?energyGaps({doc:engine.doc,db:state.energyDb,env:state.env}):null;
   const body=[el('h3',{},'⑦ 도서 만들기 — 에너지절약계획서'),el('p',{class:'pb-note'},'①~⑥에서 모은 값으로 평면을 다시 읽고 도서를 만듭니다. 도서는 도면 파일 옆 "<이름>_인허가도서/에너지" 폴더에 DXF·PDF 로 두고, 외피 자료는 [계정 연결] 돼 있으면 서버에 저장합니다. 양식은 서버에서 받은 판을 씁니다.'),
    e.confirmedAt?el('p',{class:'g'},'⑥ 확정: '+localStamp(e.confirmedAt)):el('p',{class:'y'},'⑥ 전부 있음 확정을 먼저 하세요.'),
    g&&g.red.length?el('p',{class:'r'},`빨간 줄 ${g.red.length}개 — ⑤에서 채우세요.`):null];
   const go=el('button',{class:'pb-btn pri',onclick:()=>run('에너지 도서 만드는 중… (1분 안팎)',async()=>{state.result.energy=await api({action:'energy-build',...base(),...energyRequest(engine.doc)});})},'도서 만들기 (PDF 따로)');
   if(!e.confirmedAt)go.disabled=true;body.push(el('div',{},go));
   if(res)body.push(resultBox(res,[['단면 단열선 끊김',`${res.sectionCheck?.['끊김']??0}곳`,!(res.sectionCheck?.['끊김'])],['글자 넘침',`${res.textOverflow.length}곳`,!res.textOverflow.length],['[가정] 남은 값',res.assumed?'있음':'없음',!res.assumed],
    ['에너지성능지표',res.calc?`${res.calc.total}점 ≥ ${res.calc.pass}점 → ${res.calc.passOk?'적합':'부적합'}`:'—',!!res.calc?.passOk],
    ['외피 자료 서버 저장',res.envelopeSaved?.ok?'저장함':res.envelopeSaved?'못 함 — '+res.envelopeSaved.error:'—',!!res.envelopeSaved?.ok],['도서 양식',res.templatesVersion||'—',true]]));
   return body;
  }
  const r=state.review;
  const head=[el('h3',{},'⑦ 도서 만들기 — 장애인편의시설'),el('p',{class:'pb-note'},'도서는 도면 파일 옆 "<이름>_인허가도서/편의시설" 폴더에 DXF·PDF 로 둡니다. 상세도는 「장애인 편의시설 상세표준도(수정2판)」의 그림 쪽을 그대로 넣습니다.')];
  const body=[...head];
  const list=r?el('table',{},el('tr',{},el('th',{},'번호'),el('th',{},'도서')),...sheetGroups(r.sheets).map(([n,t])=>el('tr',{},el('td',{},n),el('td',{},t)))):null;
  body.push(el('div',{},el('button',{class:'pb-btn pri',onclick:()=>run('편의시설 도서 만드는 중… (1분 안팎)',async()=>{state.result.access=await api({action:'access-build',...await accessBase()});state.review=state.result.access;})},'도서 만들기 (PDF 따로)'),
   el('button',{class:'pb-btn',onclick:()=>run('두 도서 만드는 중…',async()=>{state.result.access=await api({action:'access-build',...await accessBase()});state.review=state.result.access;if(energySettings(engine.doc).confirmedAt)state.result.energy=await api({action:'energy-build',...base(),...energyRequest(engine.doc)});else toast('에너지 탭 ⑥ 확정 전이라 에너지 도서는 건너뛰었습니다.',true);})},'두 도서 모두 만들기')));
  if(res){const act=res.rows.filter(x=>['mandatory','recommended'].includes(x.requirement));
   body.push(resultBox(res,[['의무 시설 미설치·규격 부적합',`${res.rows.filter(x=>x.violation).length}항목`,!res.rows.some(x=>x.violation)],['설치·실측 확인 필요',`${act.filter(x=>!x.violation&&x.status!=='적합').length}항목`,!act.some(x=>!x.violation&&x.status!=='적합')],
    ['글자 넘침',`${res.textOverflow.length}곳`,!res.textOverflow.length],['[샘플 가정] 남은 값',res.assumed?'있음':'없음',!res.assumed],
    ['상세표준도 쪽',res.standardDetails===false?'원본 PDF 가 없어 상세 칸이 비어 있음':'넣음',res.standardDetails!==false]]));}
  if(list)body.push(list);   // 만든 뒤에는 결과가 위, 목록은 아래
  return body;
 }
 function resultBox(res,checks){
  return el('div',{style:'margin-top:12px;border:1px solid #383f48;border-radius:8px;padding:8px 10px;background:#20242a'},
   el('b',{},`도서를 만들었습니다 — ${res.sheets.length}장 · PDF 1개`),
   el('table',{},el('tr',{},el('th',{},'자동 검사'),el('th',{},'결과')),...checks.map(([a,b,ok])=>el('tr',{},el('td',{},a),el('td',{class:ok?'g':'y'},b)))),
   el('p',{class:'m'},res.pdf),
   el('button',{class:'pb-btn pri',onclick:()=>api({action:'open-path',path:res.pdf}).catch(e=>toast(e.message,true))},'PDF 열기'),
   el('button',{class:'pb-btn',onclick:()=>api({action:'open-path',path:res.folder}).catch(e=>toast(e.message,true))},'도서 있는 곳으로 이동'));
 }

 function render(busyLabel){
  const tab=state.tab,steps=stepInfo(tab),step=state.step[tab];
  const tabBtn=(id,label,info)=>el('button',{class:'pb-tab'+(tab===id?' on':''),onclick:()=>{state.tab=id;state.error='';render();}},label,info?el('small',{},info):null);
  const ar=state.result.access,er=state.result.energy;
  const top=el('div',{class:'pb-top'},el('h2',{},'인허가 도서'),tabBtn('energy','에너지절약계획서',er?`${er.sheets.length}장`:''),tabBtn('access','장애인편의시설',ar?`${ar.sheets.length}장`:state.review?state.review.decision.status:''),
   el('button',{class:'pb-btn pb-close',onclick:()=>dialog.close()},'닫기'));
  const side=el('div',{class:'pb-steps'},...steps.map(([label,info,shared],i)=>el('button',{class:(i+1===step?'on':info?'done':''),onclick:()=>{state.step[tab]=i+1;state.error='';render();}},label,shared?el('span',{class:'pb-share'},'같이 씀'):null,el('small',{},info||''))));
  const E=energySteps({el,engine,api,run,render,toast,state,studio,dialog,base});
  const contents=step===1?overviewStep():step===3?floorStep():tab==='energy'?(step===2?E.legal():step===4?E.read():step===5?E.gaps():step===6?E.confirm():bookStep('energy'))
   :step===2?facilityStep():step===4?checkStep():step===5?gapStep():step===6?confirmStep():bookStep('access');
  const body=el('div',{class:'pb-body'},...(busyLabel?[el('p',{class:'y'},busyLabel)]:state.error?[el('p',{class:'r'},state.error)]:[]),...contents);
  dialog.replaceChildren(top,el('div',{class:'pb-wiz'},side,body));
 }

 // 처음 열 때는 아직 안 한 첫 단계로(개요 → 판정 → 층 범위 → 도서).
 // tab: 실시 탭의 '장애인 편의시설'·'에너지절약계획' 카드가 그 탭으로 바로 연다('access'·'energy').
 async function open(tab){
  const s=permitSettings(engine.doc),first=!s.overview?1:!s.facility?.use?2:!permitFloors(engine.doc).length?3:7;
  if(!dialog.open){state.step.access=first;state.step.energy=first===2?3:first;}
  if(tab==='access'||tab==='energy'){state.tab=tab;state.error='';}
  render();if(!dialog.open)dialog.showModal();
 }
 studio.handlers.PERMITBOOK=open;
 return {open};
}
