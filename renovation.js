// 리노베이션 상태: 객체마다 기존·철거·신설을 붙이고, 보기(전체·현황도·철거도·계획도)에 맞춰 색·선종류·숨김을 바꾼다.
// 그리는 경로는 손대지 않는다 — 보기를 바꿀 때 해당 객체의 color·linetype·hidden 만 한 번에 고치므로
// 화면·PDF·DXF 가 지금 경로 그대로 따라오고, 보기 전환은 되돌리기 한 번이다. 원래 색은 renovationBase 에 둔다.

export const STATUS={existing:'기존',demolish:'철거',new:'신설'};
export const VIEWS={all:'전체',survey:'현황도',demolition:'철거도',plan:'계획도'};
// 신설(증축)은 파랑(2026-10-24 통과 시안 ⑫: 기존 회색 · 증축 파랑 · 철거 빨간 점선).
const EXISTING={color:'#9aa4aa'},DEMOLISH={color:'#ff5c5c',linetype:'DASHED'},NEW={color:'#7fb0ff'};
const KEYS=['color','linetype','hidden'];

/** 상태·보기·원래 모양에서 보일 모양. 현황도는 고치기 전 그대로, 철거도는 신설을, 계획도는 철거를 숨긴다. */
export function displayFor(status,view,base){
 const hide=(view==='survey'||view==='demolition')&&status==='new'||view==='plan'&&status==='demolish';
 if(hide)return {...base,hidden:true};
 if(view==='survey')return {...base};
 if(status==='existing')return {...base,...EXISTING};
 if(status==='demolish')return {...base,...DEMOLISH};
 return {...base,...NEW};
}

const value=v=>v===undefined?null:v;
/** 지금 객체의 원래 모양. 마지막으로 보기를 적용한 뒤 사용자가 색·선종류를 바꿨으면 그 값을 새 원래 모양으로 삼는다. */
function baseOf(e){
 const base={color:value(e.color),linetype:value(e.linetype),hidden:!!e.hidden,...(e.renovationBase||{})};
 if(e.renovationShown)for(const k of KEYS){const now=k==='hidden'?!!e[k]:value(e[k]);if(now!==(k==='hidden'?!!e.renovationShown[k]:value(e.renovationShown[k])))base[k]=now;}
 return base;
}
function changesFor(e,status,view){
 const base=baseOf(e);
 if(!status)return {renovation:undefined,renovationBase:undefined,renovationShown:undefined,color:base.color??undefined,linetype:base.linetype??undefined,hidden:base.hidden||undefined};
 const shown=displayFor(status,view,base);
 return {renovation:status,renovationBase:base,renovationShown:shown,color:shown.color??undefined,linetype:shown.linetype??undefined,hidden:shown.hidden||undefined};
}
const same=(e,changes)=>Object.entries(changes).every(([k,v])=>JSON.stringify(e[k])===JSON.stringify(v));

/** 고른 객체에 상태를 붙인다(null 이면 뗀다). 지금 보기를 바로 적용한다. */
export function setStatusCommand(doc,ids,status){
 if(status!==null&&!STATUS[status])throw Error('기존·철거·신설 중에서 고르세요.');
 const view=doc.reviewSettings?.renovationView||'all',set=new Set(ids);
 const updates=doc.entities.filter(e=>set.has(e.id)).map(e=>({id:e.id,changes:changesFor(e,status,view)})).filter(u=>!same(doc.entities.find(e=>e.id===u.id),u.changes));
 return updates.length?{type:'updateMany',updates}:null;
}

/** 보기를 바꾼다. 상태가 붙은 객체만 고친다. */
export function setViewCommand(doc,view){
 if(!VIEWS[view])throw Error('보기를 고르세요.');
 const updates=doc.entities.filter(e=>e.renovation).map(e=>({id:e.id,changes:changesFor(e,e.renovation,view)})).filter(u=>!same(doc.entities.find(e=>e.id===u.id),u.changes));
 const settings={type:'review.settings',settings:{renovationView:view}};
 return {type:'batch',commands:updates.length?[settings,{type:'updateMany',updates}]:[settings]};
}

export function statusCounts(doc){const n={existing:0,demolish:0,new:0};for(const e of doc.entities)if(n[e.renovation]!==undefined)n[e.renovation]++;return n;}

export function installRenovation(studio){
 const {engine,execute,toast}=studio.context;
 const dialog=document.createElement('dialog');dialog.id='renovation-dialog';dialog.className='storeys-dialog';
 dialog.innerHTML='<div class="dialog-header"><h2>리노베이션 (기존·철거·신설)</h2><button type="button" class="r-close">닫기 ×</button></div>'
  +'<p class="muted">고른 객체에 상태를 붙이고, 보기를 바꾸면 화면·PDF·DXF 가 그 보기대로 나옵니다. 기존은 회색, 신설은 파랑, 철거는 빨간 점선입니다. 보기 전환은 되돌리기 한 번입니다.</p>'
  +'<div class="s-assign"><strong>고른 객체</strong>'+Object.entries(STATUS).map(([k,label])=>`<button type="button" data-status="${k}">${label}</button>`).join('')+'<button type="button" data-status="">표시 떼기</button></div>'
  +'<div class="s-assign"><strong>보기</strong>'+Object.entries(VIEWS).map(([k,label])=>`<button type="button" data-view="${k}">${label}</button>`).join('')+'</div>'
  +'<p class="s-note" role="status"></p>';
 document.body.append(dialog);dialog.addEventListener('keydown',e=>e.stopPropagation());
 const $=s=>dialog.querySelector(s);
 const render=()=>{const view=engine.doc.reviewSettings?.renovationView||'all',n=statusCounts(engine.doc);
  for(const b of dialog.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===view));
  $('.s-note').textContent=`지금 보기: ${VIEWS[view]} · 기존 ${n.existing} · 철거 ${n.demolish} · 신설 ${n.new}`;};
 const run=command=>{if(command)execute(command);render();};
 for(const b of dialog.querySelectorAll('[data-status]'))b.onclick=()=>{try{const ids=[...studio.context.selected()];if(!ids.length)throw Error('먼저 객체를 고르세요.');const c=setStatusCommand(engine.doc,ids,b.dataset.status||null);run(c);toast(c?`${ids.length}개 · ${b.dataset.status?STATUS[b.dataset.status]:'표시 뗌'}`:'바뀐 것이 없습니다.');}catch(error){$('.s-note').textContent=error.message;}};
 for(const b of dialog.querySelectorAll('[data-view]'))b.onclick=()=>{try{run(setViewCommand(engine.doc,b.dataset.view));}catch(error){$('.s-note').textContent=error.message;}};
 $('.r-close').onclick=()=>dialog.close();
 const open=()=>{render();if(!dialog.open)dialog.show();};
 studio.handlers.RENOVATION=open;
 return {open};
}
