// 도면 인식 창 — 실시 칸 맨 위 카드와 RECOGNIZE 명령으로 연다(2026-10-27 대표 결정 docs/adr/0001, 시안 docs/mockup-drawing-recognition-2026-10-27 · docs/시안-도면인식-단계-2026-10-27).
// [읽기] 한 번에 ① 개요표 → ② 배치 → ③ 층 평면(바른 서버 "남의 도면 읽기") → ④ 검산 → ⑤ 확인 필요까지 간다. 못 찾은 것만 윈도우(두 점)로 감싸게 한다.
// 읽기·합치기·엑셀 표는 building-overview.js, ②~⑤ 계산은 drawing-recognition-read.js. 이 창은 보여 주고 고친 값·답을 저장만 한다. 누를 때만 읽는다(파일 열 때 알아서 돌리지 않음).
import {OVERVIEW_FIELDS,collectTexts,readOverviewFromTexts,storedOverview,mergeOverview,applyOverviewEdits,overviewSettings,overviewLabel,overviewRows,overviewEditsFromRows} from './building-overview.js';
import {readSitePlan,floorRows,storedRecognition,recognitionResult,recognitionSettings,readFloorsFromServer,floorRegions} from './drawing-recognition-read.js';

const CSS=`#drawing-recognition{max-width:none!important;width:min(1080px,94vw)!important;height:84vh!important;max-height:none!important;padding:0;border:1px solid #3d444d;border-radius:14px;background:#1b1e23;color:#e6e9ed;overflow:hidden}
#drawing-recognition .dr-top{display:flex;align-items:center;gap:6px;background:#14161a;padding:8px 12px;border-bottom:1px solid #383f48}
#drawing-recognition .dr-top h2{font-size:14px;margin:0 8px 0 0;font-weight:650}
#drawing-recognition .dr-top .dr-when{color:#9aa4b0;font-size:12px;margin-right:auto}#drawing-recognition .dr-top .dr-when.y{color:#ffb65c}
#drawing-recognition .dr-wiz{display:grid;grid-template-columns:200px 1fr;height:calc(100% - 46px)}
#drawing-recognition .dr-steps{background:#16191d;border-right:1px solid #383f48;padding:10px 8px;overflow:auto}
#drawing-recognition .dr-steps button{all:unset;box-sizing:border-box;display:block;width:100%;cursor:pointer;padding:6px 9px;border-radius:7px;margin-bottom:3px;font-size:12.5px;color:#c9d1d9}
#drawing-recognition .dr-steps button.on{background:#2e333b;color:#e6e9ed;outline:1px solid #9dcbe0}
#drawing-recognition .dr-steps small{display:block;font-size:10.5px;color:#7d8792}#drawing-recognition .dr-steps small.g{color:#7fd19b}#drawing-recognition .dr-steps small.y{color:#ffb65c}
#drawing-recognition .dr-body{padding:14px 18px;overflow:auto;font-size:12.5px;line-height:1.55}
#drawing-recognition h3{font-size:14px;margin:0 0 6px}#drawing-recognition h4{font-size:13px;margin:16px 0 4px}
#drawing-recognition .dr-note{color:#9aa4b0;margin:2px 0 10px}
#drawing-recognition table{width:100%;border-collapse:collapse}
#drawing-recognition th{text-align:left;color:#9aa4b0;font-weight:500;border-bottom:1px solid #383f48;padding:4px}
#drawing-recognition td{border-bottom:1px solid #30363f;padding:4px;vertical-align:middle}
#drawing-recognition table.ov td:first-child{white-space:nowrap;width:150px}#drawing-recognition table.ov td:nth-child(2){width:300px}#drawing-recognition td.ev{color:#9aa4b0}
#drawing-recognition tr.need td{background:#3a3020}#drawing-recognition tr.need td.ev{color:#ffb65c}
#drawing-recognition input{width:100%;box-sizing:border-box;font-size:12.5px;padding:4px 6px;background:#14161a;color:#e6e9ed;border:1px solid #3d444d;border-radius:6px}
#drawing-recognition .dr-btn{border:1px solid #383f48;background:#2e333b;border-radius:7px;padding:6px 12px;color:#e6e9ed;cursor:pointer;font-size:12.5px}
#drawing-recognition .dr-btn.pri{background:#2f5f76;border-color:#9dcbe0}#drawing-recognition .dr-btn.sm{padding:2px 8px;font-size:11.5px;margin-right:4px}
#drawing-recognition .dr-btn:disabled{opacity:.5;cursor:default}
#drawing-recognition .dr-row{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
#drawing-recognition .y{color:#ffb65c}#drawing-recognition .r{color:#ff8b83}#drawing-recognition .g{color:#7fd19b}
#drawing-recognition .dr-pick{display:flex;gap:6px;align-items:center;margin:4px 0}
#drawing-recognition ol.dr-need li{margin:8px 0}#drawing-recognition ol.dr-need .dr-row{margin:4px 0}`;

const STEPS=['① 개요표','② 배치','③ 층 평면','④ 검산','⑤ 확인 필요'];
const STATUS={title:'"건축개요" 제목 아래 표에서 읽었습니다.',window:'감싼 범위 안에서 읽었습니다.',none:'"건축개요" 제목을 찾지 못해 도면 전체에서 칸 이름을 찾았습니다. 틀리면 [윈도우로 감싸 읽기]를 쓰세요.',many:'"건축개요" 제목이 여러 개라 어느 표인지 모릅니다. [윈도우로 감싸 읽기]로 표를 감싸 주세요.'};
const SITE_STATUS={title:t=>`찾은 배치도: "${t}" 제목 위 그림. 틀리면 [윈도우로 감싸 읽기].`,window:()=>'감싼 범위 안에서 읽었습니다.',none:()=>'"배치도" 제목을 찾지 못했습니다. [윈도우로 감싸 읽기]로 배치도를 감싸 주세요.',many:()=>'"배치도" 제목이 여러 개라 어느 그림인지 모릅니다. [윈도우로 감싸 읽기]로 하나를 감싸 주세요.'};
const KEYS=[...OVERVIEW_FIELDS.filter(f=>f[2]!=='floors').map(f=>[f[0],f[2]]),['floorsAbove','count'],['floorsBelow','count']];
const el=(tag,props={},...kids)=>{const e=document.createElement(tag);for(const [k,v] of Object.entries(props))k==='class'?e.className=v:k.startsWith('on')?e[k]=v:k==='disabled'?e.disabled=!!v:e.setAttribute(k,v);e.append(...kids.filter(k=>k!=null&&k!==false));return e;};
const when=iso=>{if(!iso)return '';const d=new Date(iso);return `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;};
const show=v=>v==null||v===''?'':typeof v==='number'?String(v):v;
const n2=v=>v==null?'—':Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
/** 읽은 뒤 도면 글자가 바뀌었는지 볼 서명(글자 수 + 글자 합 해시). */
export function textSignature(texts){let h=0;for(const t of texts)for(const c of t.text+'|'+Math.round(t.x)+','+Math.round(t.y))h=(h*31+c.charCodeAt(0))|0;return texts.length+':'+(h>>>0).toString(36);}

/** [읽기] 한 번: ① 개요표 → ② 배치 → ③ 층 평면. 저장할 review.settings 와 알림 글. 창과 AI 도구가 같이 쓴다. */
export async function recognizeAll(doc,{readFloors=readFloorsFromServer}={}){
 const texts=collectTexts(doc?.entities),r=readOverviewFromTexts(texts);
 const overview=mergeOverview(storedOverview(doc),r,{source:'개요표'});overview.signature=textSignature(texts);
 const site=readSitePlan(doc),floors=await readFloors(doc);
 const rows=floors.foreign?floorRows(floors.foreign,floors.office,doc):[];
 const settings={...overviewSettings(doc,overview),...recognitionSettings(doc,{site,floors:rows,floorError:floors.floorError||null,now:overview.readAt})};
 const result=recognitionResult({reviewSettings:{...doc?.reviewSettings,...settings}},overview);
 const fail=result.checks.filter(c=>c.state==='fail').length;
 const message=`개요표 ${Object.keys(r.values).length}칸 · 배치 ${site.lot?'대지 '+site.lot.area+'㎡':'못 찾음'} · 층 평면 ${floors.floorError?'못 읽음':rows.length+'개'} · 검산 ${fail?fail+'개 맞지 않음':'이상 없음'} · 확인 필요 ${result.needs.length}`;
 return {settings,overview,result,overviewStatus:r.status,message};
}

export function installDrawingRecognition(studio){
 const {engine,toast}=studio.context;
 if(!document.getElementById('drawing-recognition-css'))document.head.append(el('style',{id:'drawing-recognition-css'},CSS));
 const dialog=el('dialog',{id:'drawing-recognition'});document.body.append(dialog);
 const state={status:null,error:'',step:0,busy:false},inputs={};
 const listeners=new Set();
 const save=settings=>{engine.execute({type:'review.settings',settings});for(const f of listeners)f();};
 const commit=store=>save(overviewSettings(engine.doc,store));
 const commitRec=rec=>save({drawingRecognition:rec});
 const result=()=>recognitionResult(engine.doc,storedOverview(engine.doc));

 async function readAll(){
  if(state.busy)return;state.busy=true;state.error='';render();
  try{const r=await recognizeAll(engine.doc);state.status=r.overviewStatus;save(r.settings);toast(r.message,!!r.result.needs.length);}
  catch(e){state.error=e.message;}
  finally{state.busy=false;render();}
 }
 function read(window=null){
  const texts=collectTexts(engine.doc?.entities),r=readOverviewFromTexts(texts,{window});
  state.status=r.status;
  const merged=mergeOverview(storedOverview(engine.doc),r,{source:r.status==='window'?'개요표(윈도우)':'개요표'});
  merged.signature=textSignature(texts);
  commit(merged);
  const n=Object.keys(r.values).length;
  toast(n?`개요표에서 ${n}칸을 읽었습니다.${merged.confirm.length?` 확인 필요 ${merged.confirm.length}칸.`:''}${merged.conflicts.length?` 이미 넣은 값과 다른 칸 ${merged.conflicts.length}개.`:''}`:'개요표에서 읽은 칸이 없습니다. 윈도우로 표를 감싸 보세요.',!n);
  render();
 }
 /** 창을 닫고 두 점을 받는다. 취소하면 null. */
 async function pickWindow(what){
  const pick=studio.context.pickPoint;if(!pick)return null;
  dialog.close();
  try{
   const a=await pick(`${what}의 한쪽 모서리를 클릭하세요 · Esc 취소`);if(!a||!Number.isFinite(a.x))return null;
   const b=await pick('반대쪽 모서리를 클릭하세요 · Esc 취소');if(!b||!Number.isFinite(b.x))return null;
   return [a,b];
  }finally{if(!dialog.open){render();dialog.showModal();}}
 }
 async function readWindow(){const w=await pickWindow('개요표');if(w)read(w);}
 async function readSiteWindow(){
  const w=await pickWindow('배치도');if(!w)return;
  const rec=storedRecognition(engine.doc);rec.site=readSitePlan(engine.doc,{window:w});commitRec(rec);
  toast(rec.site.lot?`배치도에서 대지 ${rec.site.lot.area}㎡를 읽었습니다.`:'감싼 범위에서 대지 경계를 찾지 못했습니다.',!rec.site.lot);render();
 }
 /** 층 하나를 감싸 다시 읽기(f 가 없으면 새 층). 감싼 범위는 설계자가 고른 것이라 인허가 도서 층 범위도 바꾼다. */
 async function wrapFloor(f){
  const label=f?f.label:await new Promise(res=>{dialog.close();studio.context.form('층 하나 더 감싸기',[{name:'label',label:'층 이름 (예: 3층 · 2~4층 · 지하1층 · 옥탑)',value:''}],v=>res(String(v.label||'').trim()),()=>res(''));});
  if(!label){if(!dialog.open){render();dialog.showModal();}return;}
  const w=await pickWindow(`${label} 평면`);if(!w)return;
  state.busy=true;render();
  try{
   const r=await readFloorsFromServer(engine.doc,{window:w,label});
   if(r.floorError){state.error=r.floorError;return;}
   const [row]=floorRows(r.foreign,[],engine.doc),rec=storedRecognition(engine.doc);
   row.label=label;row.id=f?f.id:`${label}@w`;row.byHand=true;
   rec.floors=f?rec.floors.map(o=>o.id===f.id?{...row,height:o.height}:o):[...rec.floors.filter(o=>o.id!==row.id),row];
   // 손으로 감싼 층은 인허가 도서 층 범위에서도 손으로 고른 범위(덮지 않음)로 둔다
   const regions=floorRegions((engine.doc.reviewSettings?.energyPlanRegions||[]).filter(x=>!(x.kind==='floor'&&row.floors.includes(x.floor))),[row]).map(x=>x.kind==='floor'&&row.floors.includes(x.floor)?(({source,...o})=>o)(x):x);
   save({drawingRecognition:rec,energyPlanRegions:regions});state.error='';toast(`${label}: 바닥면적 ${n2(row.area)}㎡ · 실 ${row.rooms}개를 읽었습니다.`);
  }finally{state.busy=false;render();}
 }
 function answer(id,value,note=''){
  const rec=storedRecognition(engine.doc);rec.answers={...rec.answers,[id]:{value,note,at:new Date().toISOString()}};commitRec(rec);render();
 }
 function keepWithNote(id){
  dialog.close();
  studio.context.form('이대로 둠 — 이유',[{name:'note',label:'왜 이대로 두는지(도서에 남습니다)',value:''}],v=>{answer(id,'keep',String(v.note||'').trim());if(!dialog.open)dialog.showModal();},()=>{if(!dialog.open){render();dialog.showModal();}});
 }
 const look=b=>{if(!b)return;dialog.close();studio.context.zoomToBounds?.(b);toast('도면에서 그 자리를 비췄습니다. [도면 인식]으로 다시 여세요.');};
 function editsFromInputs(store){
  const edits={};
  for(const [k,kind] of KEYS){const i=inputs[k];if(!i)continue;let v=i.value.trim();
   if(v!==''&&kind!=='text'&&kind!=='date'){const n=Number(v.replace(/,/g,''));if(!Number.isFinite(n))throw new Error(`'${overviewLabel(k)}' 칸에는 숫자를 넣으세요.`);v=kind==='count'?Math.round(n):n;}
   if(String(show(store.values[k]))!==String(v))edits[k]=v;}
  return edits;
 }
 function saveOverview(){
  try{const store=storedOverview(engine.doc),edits=editsFromInputs(store);if(!Object.keys(edits).length){toast('바뀐 칸이 없습니다.');return;}
   commit(applyOverviewEdits(store,edits));state.error='';toast(`${Object.keys(edits).length}칸을 저장했습니다.`);render();}
  catch(e){state.error=e.message;render();}
 }
 function confirmRow(k){
  const store=storedOverview(engine.doc);
  try{const edits=editsFromInputs(store);const v=k in edits?edits[k]:store.values[k];if(v==null||v===''){state.error=`'${overviewLabel(k)}' 값을 넣은 뒤 [확인]을 누르세요.`;render();return;}
   commit(applyOverviewEdits(store,{[k]:v},store.evidence[k]&&!(k in edits)?store.evidence[k]+' · 설계자 확인':'설계자 입력'));state.error='';render();}
  catch(e){state.error=e.message;render();}
 }
 function choose(c,useRead){
  const store=storedOverview(engine.doc);
  const next=applyOverviewEdits(store,{[c.key]:useRead?c.read:c.mine},useRead?c.readEvidence:(c.mineEvidence||'설계자 입력'));
  commit(next);render();
 }
 async function exportExcel(){
  const {api,output}=studio.context;
  try{const r=await api('excel',{action:'export',rows:overviewRows(storedOverview(engine.doc))});await output(r.data,'도면데이터-개요.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');}
  catch(e){state.error=e.message;render();}
 }
 function importExcel(){
  const {api,pickFiles,b64}=studio.context;
  pickFiles('.xlsx',false,async files=>{
   if(!files?.length)return;
   try{const r=await api('excel',{action:'import',data:await b64(files[0])});const store=storedOverview(engine.doc),{edits,changed}=overviewEditsFromRows(r.rows,store);
    if(!changed.length){toast('엑셀에서 바뀐 칸이 없습니다.');return;}
    commit(applyOverviewEdits(store,edits,'엑셀에서 고침'));state.error='';toast(`엑셀에서 ${changed.length}칸을 고쳤습니다: ${changed.join(', ')}`);render();}
   catch(e){state.error=e.message;render();}
  });
 }

 // ── 단계별 화면 ──
 function overviewBody(store){
  const need=new Map((store.confirm||[]).map(c=>[c.key==='floors'?'floorsAbove':c.key,c.reason]));
  const table=el('table',{class:'ov'},el('tr',{},el('th',{},'칸'),el('th',{},'값'),el('th',{},'근거')));
  for(const [k] of KEYS){
   const i=el('input',{type:'text','aria-label':overviewLabel(k)});i.value=show(store.values[k]);inputs[k]=i;
   const reason=need.get(k);
   table.append(el('tr',{class:reason?'need':''},el('td',{},overviewLabel(k)),el('td',{},i),
    el('td',{class:'ev'},...(reason?['확인 필요 — '+reason,' ',el('button',{class:'dr-btn sm',onclick:()=>confirmRow(k)},'확인')]:[store.evidence[k]||'']))));
  }
  const conflicts=(store.conflicts||[]).length?[el('h4',{class:'y'},`이미 넣은 값과 다시 읽은 값이 다른 칸 ${store.conflicts.length}개 — 고르세요`),
   ...store.conflicts.map(c=>el('div',{class:'dr-pick'},el('strong',{},overviewLabel(c.key)),
    el('button',{class:'dr-btn sm',title:c.mineEvidence||'',onclick:()=>choose(c,false)},`지금 값: ${show(c.mine)}`),
    el('button',{class:'dr-btn sm',title:c.readEvidence||'',onclick:()=>choose(c,true)},`다시 읽은 값: ${show(c.read)}`),el('span',{class:'dr-note'},c.readEvidence||'')))]:[];
  return [el('h3',{},'① 개요표 — 도면의 "건축개요" 표와 도곽에서 읽음'),
   el('p',{class:'dr-note'},'값마다 어디서 읽었는지 적습니다. 못 읽었거나 애매한 칸은 비워 노랗게 "확인 필요"로 둡니다(추측해 채우지 않음). 칸을 고치고 [저장]을 누르면 인허가 도서·에너지·구조 검토가 같이 씁니다.'),
   state.status?el('p',{class:state.status==='many'||state.status==='none'?'y':'g'},STATUS[state.status]):null,
   el('div',{class:'dr-row'},el('button',{class:'dr-btn',onclick:readWindow},'윈도우로 감싸 읽기'),el('button',{class:'dr-btn',onclick:()=>read()},'개요표만 다시 읽기')),
   ...conflicts,table,
   el('div',{class:'dr-row'},el('button',{class:'dr-btn pri',onclick:saveOverview},'저장')),
   el('p',{class:'dr-note'},'엑셀로 내보내 보고 고친 뒤 [엑셀 가져오기]로 되돌릴 수 있습니다. 원본은 도면에 저장된 이 값이고, 엑셀은 펼쳐 보는 길입니다.')];
 }
 function siteBody(site){
  const row=(k,v,ev,need)=>el('tr',{class:need?'need':''},el('td',{},k),el('td',{},v),el('td',{class:'ev'},ev));
  return [el('h3',{},'② 배치 — "배치도" 제목 아래 그림에서 읽음'),
   el('p',{class:site?.status==='title'||site?.status==='window'?'dr-note':'y'},site?SITE_STATUS[site.status](site.title):'아직 읽지 않았습니다 · 위 [읽기]를 누르세요.'),
   el('div',{class:'dr-row'},el('button',{class:'dr-btn',onclick:readSiteWindow},'윈도우로 감싸 읽기'),el('button',{class:'dr-btn',disabled:!site?.region,onclick:()=>look(site.lot?.bounds||site.region)},'도면에서 보기')),
   site?el('table',{},el('tr',{},el('th',{},'칸'),el('th',{},'값'),el('th',{},'근거')),
    row('대지 경계 면적 ㎡',n2(site.lot?.area),site.lot?.evidence||site.confirm.find(c=>c.key==='lot'||c.key==='site')?.reason||'',!site.lot),
    row('건물 윤곽 면적 ㎡',n2(site.building?.area),site.building?.evidence||site.confirm.find(c=>c.key==='building')?.reason||'',!site.building&&site.lot),
    row('정북 방향',site.north?.text||'—',site.north?.evidence||'방위 블록(이름에 north·방위)을 못 찾음'),
    row('도로','— 읽지 않음','쓰는 곳이 생기면 더함')):null];
 }
 function floorsBody(rec,answers){
  const head=el('tr',{},...['층','찾은 평면','바닥면적 ㎡','실','층고 mm','근거',''].map(t=>el('th',{},t)));
  const rows=rec.floors.map(f=>{const roofQ=f.roof&&f.rooms&&!answers[`roof:${f.id}`],doubt=f.unresolved.length||roofQ;
   const asked=answers[`roof:${f.id}`]?.value;
   return el('tr',{class:doubt?'need':''},el('td',{},f.label+(f.floors.length>1?` (${f.floors.length}개 층)`:'')),el('td',{},f.title||'감싼 범위'),el('td',{},n2(f.area)),el('td',{},String(f.rooms)),el('td',{},f.height?f.height.toLocaleString():'—'),
    el('td',{class:'ev'},roofQ?'확인 필요 — 층 평면인지 지붕·옥탑인지':f.unresolved.length?'확인 필요 — '+f.unresolved.join(' · '):[f.byHand?'설계자가 감쌈':'도곽·그림 제목',f.wallLayer?'벽 레이어 '+f.wallLayer:'',asked?(asked==='floor'?'층으로 셈':'지붕·옥탑(연면적 뺌)'):''].filter(Boolean).join(' · ')),
    el('td',{},...(roofQ?[el('button',{class:'dr-btn sm',onclick:()=>answer(`roof:${f.id}`,'floor')},'층으로'),el('button',{class:'dr-btn sm',onclick:()=>answer(`roof:${f.id}`,'roof')},'지붕으로')]:[]),
     el('button',{class:'dr-btn sm',disabled:!f.box,onclick:()=>look(f.box)},'보기'),el('button',{class:'dr-btn sm',onclick:()=>wrapFloor(f)},'다시 감싸기')));});
  return [el('h3',{},'③ 층 평면 — 도곽 이름·그림 제목으로 찾음'),
   el('p',{class:'dr-note'},'바닥면적은 벽 중심선(외단열이면 안쪽 내력벽 중심선) 기준. 층고는 단면도의 "2층 FL" 같은 글자 간격. 찾은 층 범위는 인허가 도서 "③ 층 평면 정리"에도 들어갑니다(거기서 손으로 고른 층은 그대로 둠). 층 평면 읽기는 바른 서버에서 합니다(로그인).'),
   rec.floorError?el('p',{class:'y'},rec.floorError):null,
   rec.floors.length?el('table',{},head,...rows):el('p',{class:'dr-note'},rec.readAt?'찾은 층 평면이 없습니다. [층 하나 더 감싸기]로 층마다 감싸 주세요.':'아직 읽지 않았습니다 · 위 [읽기]를 누르세요.'),
   el('div',{class:'dr-row'},el('button',{class:'dr-btn',disabled:state.busy,onclick:()=>wrapFloor(null)},'층 하나 더 감싸기'))];
 }
 function checksBody(checks){
  const mark={ok:['g','✓'],fail:['r','✗'],skip:['dr-note','—']};
  return [el('h3',{},'④ 검산 — 읽자마자 맞춰 보기'),el('p',{class:'dr-note'},'허용 차이: 치수 ±10 mm · 면적 ±1%. 맞지 않는 줄은 ⑤ 확인 필요로 갑니다. "—"는 한쪽 값이 없어 맞춰 보지 못한 줄입니다.'),
   el('table',{},el('tr',{},el('th',{},'맞춰 본 것'),el('th',{},'결과'),el('th',{},'')),
    ...checks.map(c=>el('tr',{},el('td',{},c.label),el('td',{class:mark[c.state][0]},mark[c.state][1]+' '+c.detail),el('td',{},c.where?el('button',{class:'dr-btn sm',onclick:()=>look(c.where)},'보기'):''))))];
 }
 function needsBody(needs){
  const item=n=>el('li',{},el('b',{class:'y'},`${STEPS[n.step-1].slice(0,1)} ${n.title}`),' — '+n.text,
   el('div',{class:'dr-row'},
    ...(n.conflict?[el('button',{class:'dr-btn sm',onclick:()=>choose(n.conflict,false)},`지금 값 ${show(n.conflict.mine)}`),el('button',{class:'dr-btn sm',onclick:()=>choose(n.conflict,true)},`다시 읽은 값 ${show(n.conflict.read)}`)]:[]),
    ...(n.choices||[]).map(([v,label])=>el('button',{class:'dr-btn sm',onclick:()=>answer(n.id,v)},label)),
    n.go?el('button',{class:'dr-btn sm',onclick:()=>{state.step=n.go-1;render();}},`${STEPS[n.go-1]}로 가기`):null,
    n.where?el('button',{class:'dr-btn sm',onclick:()=>look(n.where)},'그 자리 보기'):null,
    !n.conflict&&!n.choices&&!n.go?el('button',{class:'dr-btn sm',onclick:()=>keepWithNote(n.id)},'이대로 둠(이유 적기)'):null));
  return [el('h3',{},`⑤ 확인 필요 ${needs.length}`),el('p',{class:'dr-note'},'①~④에서 못 읽었거나 맞지 않는 것입니다. 답하면 저장되고 목록에서 빠집니다(Ctrl+Z 로 되돌림).'),
   needs.length?el('ol',{class:'dr-need'},...needs.map(item)):el('p',{class:'g'},'남은 것이 없습니다.')];
 }

 function render(){
  const store=storedOverview(engine.doc),readAt=store.readAt,texts=readAt?collectTexts(engine.doc?.entities):null;
  const changed=readAt&&store.signature&&store.signature!==textSignature(texts),res=result();
  const top=el('div',{class:'dr-top'},el('h2',{},'도면 인식'),
   el('span',{class:'dr-when'+(changed?' y':'')},state.busy?'읽는 중… (층 평면은 바른 서버에서 읽습니다)':readAt?`읽음 ${when(readAt)}`+(changed?' · 읽은 뒤 도면이 바뀌었습니다 — [다시 읽기]':''):'아직 읽지 않았습니다 · [읽기]를 누르세요'),
   el('button',{class:'dr-btn',onclick:exportExcel},'엑셀로 내보내기'),el('button',{class:'dr-btn',onclick:importExcel},'엑셀 가져오기'),
   el('button',{class:'dr-btn pri',disabled:state.busy,onclick:readAll},readAt?'다시 읽기':'읽기'),el('button',{class:'dr-btn',onclick:()=>dialog.close()},'닫기'));
  const byStep=s=>res.needs.filter(n=>n.step===s).length,fails=res.checks.filter(c=>c.state==='fail').length;
  const notes=[
   readAt?(byStep(1)?['y',`읽음 · 확인 필요 ${byStep(1)}`]:['g','읽음']):['','아직'],
   res.site?(res.site.lot?[byStep(2)?'y':'g',`대지 ${n2(res.site.lot.area)}㎡${byStep(2)?' · 확인 필요 '+byStep(2):''}`]:['y','못 찾음 · 감싸 주세요']):['','아직'],
   res.floorError?['y','못 읽음']:res.readAt?[byStep(3)?'y':'g',`${res.floors.length}개 층${byStep(3)?' · 확인 필요 '+byStep(3):''}`]:['','아직'],
   res.readAt?[fails?'y':'g',fails?`${res.checks.length}개 중 ${fails} 맞지 않음`:'이상 없음']:['','아직'],
   res.readAt||readAt?[res.needs.length?'y':'g',res.needs.length?`${res.needs.length}개 남음`:'없음']:['','아직']];
  const steps=el('div',{class:'dr-steps'},...STEPS.map((label,i)=>el('button',{class:i===state.step?'on':'',onclick:()=>{state.step=i;render();}},label,el('small',{class:notes[i][0]},notes[i][1]))));
  const views=[()=>overviewBody(store),()=>siteBody(res.site),()=>floorsBody(res,res.answers),()=>checksBody(res.checks),()=>needsBody(res.needs)];
  const body=el('div',{class:'dr-body'},state.error?el('p',{class:'r'},state.error):null,...views[state.step]());
  dialog.replaceChildren(top,el('div',{class:'dr-wiz'},steps,body));
 }

 function open(){state.error='';state.status=null;render();if(!dialog.open)dialog.showModal();}
 studio.handlers.RECOGNIZE=open;
 /** 실시 칸 카드 꼬리표: 읽은 때와 ①~⑤ 확인 필요 수. */
 const cardState=()=>{const o=storedOverview(engine.doc),r=result();return {read:!!(o.readAt||r.readAt),readAt:o.readAt||r.readAt,confirm:r.needs.length};};
 return {open,read,readAll,state:cardState,onChange:f=>{listeners.add(f);return ()=>listeners.delete(f);}};
}
