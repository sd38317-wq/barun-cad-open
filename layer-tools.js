// 켜(레이어) 보조명령 21개. 바른 CAD 리습(izzarder.com) 켜도구 정리본 docs/izzarder-reference-20260921/references/08-layer.md 를
// 원문(각 절 끝 izzarder.com/NNN)과 함께 옮겼다. 바른 CAD는 AutoCAD ACI 색번호(1~255) 대신 항상 #RRGGBB 색을 쓰므로
// "색번호" 관련 명령(LCD·LCM·SLC·LLC·LFC·ECO·ECF)은 색번호 대신 #RRGGBB 로 옮겼다.
// 바른 CAD에는 레이어 필터(ACAD_LAYERFILTERS)·draworder(그리기 순서 재배치 엔진 명령)가 없어 LFG·LFD·DOL 은 "없음" 카드다.
// ECO·ECF 는 원문 글 번호를 찾지 못했다(WebSearch·izzarder 켜도구 카테고리 목록 확인, 26개 글 어디에도 없음). "켜 상태 조절
// 명령어 모음"(izzarder.com/100, ESF/EOO/ESO = 객체 단위 visible)과 LLC/LFC(izzarder.com/448·447, 켜 단위 색 필터)의
// 조합으로 미루어 "객체 단위 색 필터"로 추정 구현했다. 보고서 참고.
import {STD_LAYERS} from './card-kit.js';
import {isChecked} from './card-input.js';

/* ── 색·선모양 정규화 ── */
export function normalizeHex(v){
 const s=String(v||'').trim().toLowerCase();
 const m=/^#?([0-9a-f]{6}|[0-9a-f]{3})$/.exec(s);
 if(!m)return null;
 let h=m[1];if(h.length===3)h=[...h].map(c=>c+c).join('');
 return '#'+h;
}
export function parseColorList(str){
 const s=String(str||'').trim();
 if(!s)return {all:false,colors:[]};
 if(/^(all|전체)$/i.test(s))return {all:true,colors:[]};
 return {all:false,colors:[...new Set(s.split(/[,\s]+/).map(normalizeHex).filter(Boolean))]};
}
export function parseNameList(str){
 return [...new Set(String(str||'').split(/[,\n]+/).map(x=>x.trim()).filter(Boolean))];
}
/** 한 줄에 "#RRGGBB:켜이름" (구분자 : = , 탭 모두 허용). 같은 색이 중복되면 나중 줄이 이긴다(원문 LCD 주의사항과 같다). */
export function parseLayerMapping(str){
 const map=new Map();
 for(let line of String(str||'').split(/\n+/)){
  line=line.trim();if(!line)continue;
  const m=/^(#?[0-9a-fA-F]{3,6})\s*[:=,\t]\s*(.+)$/.exec(line);
  if(!m)continue;
  const color=normalizeHex(m[1]),layer=m[2].trim();
  if(!color||!layer)continue;
  map.set(color,layer);
 }
 return [...map.entries()].map(([color,layer])=>({color,layer}));
}
/** 켜 이름에 쓸 수 없는 특수문자(원문: *,/,&,^,%,!,@,() )는 지우고 남는 글자로 이름을 만든다. 다 지워지면 null. */
const FORBIDDEN=/[*/&^%!@()]/g;
export function sanitizeLayerName(text){
 const cleaned=String(text||'').replace(FORBIDDEN,'').trim();
 return cleaned||null;
}

/* ── 객체·켜의 실제(ByLayer 포함) 색·선모양 ── */
export function effectiveColor(entity,layerById){
 return normalizeHex(entity?.color)||normalizeHex(layerById.get(entity?.layer)?.color)||null;
}
export function effectiveLinetype(entity,layerById){
 if(entity?.linetype&&String(entity.linetype).toUpperCase()!=='BYLAYER')return String(entity.linetype).toUpperCase();
 return String(layerById.get(entity?.layer)?.linetype||'CONTINUOUS').toUpperCase();
}
export function colorMatchIds(entities,layerById,color){
 const c=normalizeHex(color);if(!c)return [];
 return entities.filter(e=>effectiveColor(e,layerById)===c).map(e=>e.id);
}
export function layersMatchingColor(layers,color){
 const c=normalizeHex(color);if(!c)return [];
 return layers.filter(l=>normalizeHex(l.color)===c).map(l=>l.id);
}
export function linetypesMatchingName(layers,name){
 const n=String(name||'').toUpperCase();if(!n)return [];
 return layers.filter(l=>String(l.linetype||'CONTINUOUS').toUpperCase()===n).map(l=>l.id);
}

/* ── 켜 상태 일괄 변경 계산(순수). key: 'frozen'|'locked'|'visible'. keepIds 에 든 켜는 goodValue, 아니면 badValue.
   protectId(보통 현재 켜)는 목록에서 아예 뺀다(원문: 현재 켜는 얼리거나 잠글 수 없다). ── */
export function isolateLayerChanges(layers,keepIds,key,goodValue,badValue,{protectId=null}={}){
 const keep=new Set(keepIds);
 return layers.filter(l=>l.id!==protectId).map(l=>({id:l.id,[key]:keep.has(l.id)?goodValue:badValue}));
}
export function toggleVisibilityChanges(layers,protectId){
 return layers.filter(l=>l.id!==protectId).map(l=>({id:l.id,visible:!l.visible}));
}
export function turnOnChanges(ids){return ids.map(id=>({id,visible:true,frozen:false}));}
export function offOrFrozenLayers(layers,protectId){
 return layers.filter(l=>l.id!==protectId&&(!l.visible||l.frozen));
}

/* ── ELY: 대상 켜 목록과 그 켜의 객체 ── */
export function layersToErase(layers,mode,listIds,invert){
 let set;
 if(mode==='off')set=new Set(layers.filter(l=>!l.visible).map(l=>l.id));
 else if(mode==='frozen')set=new Set(layers.filter(l=>l.frozen).map(l=>l.id));
 else set=new Set(listIds);
 if(invert)set=new Set(layers.map(l=>l.id).filter(id=>!set.has(id)));
 return [...set];
}
/** 잠긴 켜는 항상 제외한다(원문의 "잠긴 켜 객체 제외" 체크를 기본 동작으로 고정). */
export function entitiesToErase(entities,targetLayerIds,lockedLayerIds){
 const targets=new Set(targetLayerIds),locked=new Set(lockedLayerIds);
 return entities.filter(e=>targets.has(e.layer)&&!locked.has(e.layer)).map(e=>e.id);
}

/* ── LCM/LTM: 색·선모양 합치기 대상 객체. scope: 'all'|'forced'|'bylayer' ── */
export function colorMergeMatches(entities,layerById,colors,scope){
 const set=new Set(colors);
 return entities.filter(e=>{
  const forced=!!normalizeHex(e.color);
  if(scope==='forced'&&!forced)return false;
  if(scope==='bylayer'&&forced)return false;
  const eff=effectiveColor(e,layerById);
  return eff&&set.has(eff);
 }).map(e=>e.id);
}
export function linetypeMergeMatches(entities,layerById,names,scope){
 const set=new Set(names.map(n=>String(n).toUpperCase()));
 return entities.filter(e=>{
  const forced=!!(e.linetype&&String(e.linetype).toUpperCase()!=='BYLAYER');
  if(scope==='forced'&&!forced)return false;
  if(scope==='bylayer'&&forced)return false;
  return set.has(effectiveLinetype(e,layerById));
 }).map(e=>e.id);
}

/* ── LQT/LST: 켜별 집계·목록, 표 대신 문자 여러 줄로 그린다 ── */
export function computeLayerCounts(entities,layers,{types=null}={}){
 const counts=new Map(layers.map(l=>[l.id,0]));
 for(const e of entities){
  if(types&&types.length&&!types.includes(e.type))continue;
  if(counts.has(e.layer))counts.set(e.layer,(counts.get(e.layer)||0)+1);
 }
 return layers.map(l=>({id:l.id,name:l.name,count:counts.get(l.id)||0}));
}
export function sortRows(rows,by='name',dir='asc'){
 const s=[...rows].sort((a,b)=>by==='count'?a.count-b.count:String(a.name).localeCompare(String(b.name)));
 return dir==='desc'?s.reverse():s;
}
export function buildLayerListRows(layers){
 return [...layers].sort((a,b)=>a.name.localeCompare(b.name)).map(l=>
  `${l.name}\t${l.color}\t${l.linetype||'CONTINUOUS'}${l.visible?'':' [꺼짐]'}${l.frozen?' [동결]':''}${l.locked?' [잠김]':''}`
 );
}
export function stackTextRows(origin,rows,{height=150,lineGap=1.6}={}){
 const step=height*lineGap;
 return rows.map((text,i)=>({position:{x:origin.x,y:origin.y-i*step},text}));
}

/* ── TLL: 선 길이를 한 변으로 하는 정사각형 안에서 가장 가까운 문자 찾기 ── */
export function nearestTextInBox(line,texts){
 const [a,b]=line.points||[];
 if(!a||!b)return null;
 const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},half=Math.hypot(b.x-a.x,b.y-a.y)/2;
 const inBox=p=>Math.abs(p.x-mid.x)<=half+1e-6&&Math.abs(p.y-mid.y)<=half+1e-6;
 let best=null,bd=Infinity;
 for(const t of texts){
  if(!t.position||!inBox(t.position))continue;
  const d=Math.hypot(t.position.x-mid.x,t.position.y-mid.y);
  if(d<bd){bd=d;best=t;}
 }
 return best;
}

/* ── 화면 문맥이 필요한 명령들 ── */
export function installLayerTools(ctx){
 const layerById=()=>new Map(ctx.layers().map(l=>[l.id,l]));
 const flag=isChecked; /* 2026-09-24: 체크박스는 card-input isChecked(on·true·yes·1 = 켜짐)로 읽는다(LOS 등 실행 불가 해결) */

 async function pickColorRef(promptText){
  const sel=ctx.selected()[0];
  if(sel)return sel;
  return ctx.pickEntity({prompt:promptText});
 }

 return ({ /* 비평 11: 오류 처리는 app.js runCardCommand(보고·되돌리기 묶음) 한 곳에서 한다 — 모듈 안의 두 번째 감싸기는 뺐다. */
  /* LFF — 선택객체를 제외한 얼림(izzarder.com/100) */
  LFF(){
   const sel=ctx.selected();
   if(!sel.length)throw Error('계속 보이게(얼리지 않게) 할 객체를 먼저 선택하세요.');
   const keep=new Set(sel.map(e=>e.layer));
   const changes=isolateLayerChanges(ctx.layers(),keep,'frozen',false,true,{protectId:ctx.activeLayer()});
   if(!changes.length)return ctx.toast('바꿀 켜가 없습니다.');
   ctx.execute({type:'batch',commands:changes.map(c=>({type:'layer.update',id:c.id,changes:{frozen:c.frozen}}))});
   ctx.refresh();
   ctx.toast(`선택 객체가 속한 켜 ${keep.size}개를 제외하고 나머지 켜를 얼렸습니다.`);
  },
  /* LFK — 선택 켜를 제외하고 잠금(izzarder.com/100) */
  LFK(){
   const sel=ctx.selected();
   if(!sel.length)throw Error('잠금에서 제외할 객체를 먼저 선택하세요.');
   const keep=new Set(sel.map(e=>e.layer));
   const changes=isolateLayerChanges(ctx.layers(),keep,'locked',false,true,{});
   if(!changes.length)return ctx.toast('바꿀 켜가 없습니다.');
   ctx.execute({type:'batch',commands:changes.map(c=>({type:'layer.update',id:c.id,changes:{locked:c.locked}}))});
   ctx.refresh();
   ctx.toast(`선택 객체가 속한 켜 ${keep.size}개를 제외하고 나머지 켜를 잠갔습니다.`);
  },
  /* LTG — 켜 On/Off 반전(izzarder.com/403) */
  LTG(){
   const changes=toggleVisibilityChanges(ctx.layers(),ctx.activeLayer());
   if(!changes.length)return ctx.toast('바꿀 켜가 없습니다.');
   ctx.execute({type:'batch',commands:changes.map(c=>({type:'layer.update',id:c.id,changes:{visible:c.visible}}))});
   ctx.refresh();
   ctx.toast('모든 켜의 켜짐/꺼짐 상태를 반전했습니다. (현재 켜는 그대로 둡니다)');
  },
  /* LOS — 꺼진 켜 중에서 선택하여 켜기(izzarder.com/547, 단일 파일 모드만. 여러 파일 동기화는 없음) */
  LOS(){
   const candidates=offOrFrozenLayers(ctx.layers(),ctx.activeLayer());
   if(!candidates.length)return ctx.toast('꺼지거나 얼려진 켜가 없습니다.');
   const fields=candidates.map(l=>({name:l.id,label:`${l.name}${!l.visible?' [꺼짐]':''}${l.frozen?' [동결]':''}`,type:'checkbox',value:false}));
   ctx.form('선택 켜기/풀기 · 켜서 보이게 할 켜를 고르세요 (LOS)',fields,values=>{
    const ids=candidates.filter(l=>flag(values[l.id])).map(l=>l.id);
    if(!ids.length)throw Error('하나 이상 고르세요.');
    const changes=turnOnChanges(ids);
    ctx.execute({type:'batch',commands:changes.map(c=>({type:'layer.update',id:c.id,changes:{visible:c.visible,frozen:c.frozen}}))});
    ctx.refresh();
    ctx.toast(`${ids.length}개 켜를 켰습니다.`);
   });
  },
  /* LLC — 선택 색상만 끄기(izzarder.com/448) */
  async LLC(){
   const ref=await pickColorRef('기준 색을 가져올 객체를 선택하세요 (LLC · 선택 색상만 끄기)');
   if(!ref)return;
   const color=effectiveColor(ref,layerById());
   if(!color)throw Error('선택한 객체의 색을 확인할 수 없습니다.');
   const ids=layersMatchingColor(ctx.layers(),color);
   if(!ids.length)return ctx.toast('같은 색의 켜가 없습니다.');
   ctx.execute({type:'batch',commands:ids.map(id=>({type:'layer.update',id,changes:{visible:false}}))});
   ctx.refresh();
   ctx.toast(`색 ${color} 켜 ${ids.length}개를 껐습니다.`);
  },
  /* LFC — 선택된 색상 레이어만 켜기(izzarder.com/447) */
  async LFC(){
   const ref=await pickColorRef('기준 색을 가져올 객체를 선택하세요 (LFC · 선택 색상만 켜기)');
   if(!ref)return;
   const color=effectiveColor(ref,layerById());
   if(!color)throw Error('선택한 객체의 색을 확인할 수 없습니다.');
   const keep=new Set(layersMatchingColor(ctx.layers(),color));
   if(!keep.size)return ctx.toast('같은 색의 켜가 없습니다.');
   const changes=isolateLayerChanges(ctx.layers(),keep,'visible',true,false,{});
   ctx.execute({type:'batch',commands:changes.map(c=>({type:'layer.update',id:c.id,changes:{visible:c.visible}}))});
   ctx.refresh();
   ctx.toast(`색 ${color} 켜만 남기고 나머지를 껐습니다.`);
  },
  /* ECO — 선택 색 객체만 켜기 (izzarder.com/100 의 ESO + izzarder.com/447 LFC 조합으로 추정 구현. 원문 글 번호 미상) */
  async ECO(){
   const ref=await pickColorRef('기준 색을 가져올 객체를 선택하세요 (ECO · 선택 색 객체만 켜기, 추정 구현)');
   if(!ref)return;
   const color=effectiveColor(ref,layerById());
   if(!color)throw Error('선택한 객체의 색을 확인할 수 없습니다.');
   const ids=colorMatchIds(ctx.entities(),layerById(),color);
   if(!ids.length)return ctx.toast('같은 색의 객체가 없습니다.');
   ctx.execute({type:'batch',commands:[{type:'visibility',hidden:true},{type:'visibility',hidden:false,ids}]});
   ctx.refresh();
   ctx.toast(`색 ${color} 객체 ${ids.length}개만 남기고 나머지 객체를 숨겼습니다.`);
  },
  /* ECF — 선택 색 객체만 끄기 (izzarder.com/100 의 ESF + izzarder.com/448 LLC 조합으로 추정 구현. 원문 글 번호 미상) */
  async ECF(){
   const ref=await pickColorRef('기준 색을 가져올 객체를 선택하세요 (ECF · 선택 색 객체만 끄기, 추정 구현)');
   if(!ref)return;
   const color=effectiveColor(ref,layerById());
   if(!color)throw Error('선택한 객체의 색을 확인할 수 없습니다.');
   const ids=colorMatchIds(ctx.entities(),layerById(),color);
   if(!ids.length)return ctx.toast('같은 색의 객체가 없습니다.');
   ctx.execute({type:'visibility',hidden:true,ids});
   ctx.refresh();
   ctx.toast(`색 ${color} 객체 ${ids.length}개를 숨겼습니다.`);
  },
  /* ESO — 선택 객체 제외 끔(izzarder.com/100, 객체 단위 visible. 대용량 도면은 느릴 수 있다고 원문에 적혀 있음) */
  ESO(){
   const ids=ctx.selectedIds();
   if(!ids.length)throw Error('남길 객체를 먼저 선택하세요.');
   ctx.execute({type:'batch',commands:[{type:'visibility',hidden:true},{type:'visibility',hidden:false,ids}]});
   ctx.refresh();
   ctx.toast(`선택한 객체 ${ids.length}개만 남기고 나머지를 숨겼습니다.`);
  },
  /* ELY — 선택켜 객체 모두 삭제(izzarder.com/404). 영역 지정·종이공간·문자/치수 개별 제외 옵션은 생략(보고서 참고),
     잠긴 켜는 항상 삭제 대상에서 뺀다(원문의 "잠긴 켜 객체 제외" 체크를 고정 동작으로). */
  ELY(){
   const layers=ctx.layers();
   ctx.form('선택켜 객체 모두 삭제 (ELY)',[
    {name:'mode',label:'대상',type:'select',options:[['list','목록 켜(지금 선택된 객체의 켜)'],['off','꺼진 켜'],['frozen','얼린 켜']],value:'list'},
    {name:'invert',label:'켜 선택 반전',type:'checkbox',value:false},
    {name:'purge',label:'삭제 뒤 빈 켜도 지우기',type:'checkbox',value:false},
   ],values=>{
    const mode=values.mode;
    const listIds=mode==='list'?[...new Set(ctx.selected().map(e=>e.layer))]:[];
    if(mode==='list'&&!listIds.length)throw Error('삭제할 켜를 얻으려면 먼저 그 켜의 객체를 선택하세요.');
    const targetIds=layersToErase(layers,mode,listIds,flag(values.invert));
    const lockedIds=layers.filter(l=>l.locked).map(l=>l.id);
    const ids=entitiesToErase(ctx.entities(),targetIds,lockedIds);
    if(!ids.length)return ctx.toast('지울 객체가 없습니다. (잠긴 켜는 항상 제외됩니다)');
    ctx.execute({type:'delete',ids});
    ctx.refresh();
    let purged=0;
    if(flag(values.purge)){
     for(const id of targetIds){
      if(lockedIds.includes(id)||ctx.entities().some(e=>e.layer===id))continue;
      try{ctx.execute({type:'layer.delete',id});purged++;}catch{}
     }
     if(purged)ctx.refresh();
    }
    ctx.toast(`객체 ${ids.length}개를 지웠습니다.${purged?` · 빈 켜 ${purged}개도 지웠습니다.`:''}`);
   });
  },
  /* LCD — 위명령 목록에서 선택(izzarder.com/210, "목록으로 변경" 방식만 옮겼다. 색번호 자동생성·개별지정·엑셀연동은 생략) */
  LCD(){
   ctx.form('색→켜 변경 · 목록으로 일괄 변경 (LCD)',[
    {name:'map',label:'줄마다 "#RRGGBB:켜이름" (예: #ff0000:A-DOOR)',type:'textarea',value:''},
    {name:'onlySelected',label:'화면에서 선택한 객체에만 적용',type:'checkbox',value:false},
   ],values=>{
    const mapping=parseLayerMapping(values.map);
    if(!mapping.length)throw Error('한 줄에 "#RRGGBB:켜이름" 형식으로 하나 이상 입력하세요.');
    const lb=layerById();
    const pool=flag(values.onlySelected)?ctx.selected():ctx.entities();
    const commands=[];let matched=0;
    for(const {color,layer:name} of mapping){
     const targets=pool.filter(e=>effectiveColor(e,lb)===color);
     if(!targets.length)continue;
     const layerId=ctx.ensureLayer(name,color);
     commands.push({type:'update',ids:targets.map(e=>e.id),changes:{layer:layerId,color:null}});
     matched+=targets.length;
    }
    if(!commands.length)return ctx.toast('일치하는 색의 객체가 없습니다.');
    ctx.execute({type:'batch',commands});
    ctx.refresh();
    ctx.toast(`객체 ${matched}개를 목록에 따라 켜로 옮기고 색을 ByLayer 로 되돌렸습니다.`);
   });
  },
  /* LCM — 색 합치기(izzarder.com/153) */
  LCM(){
   ctx.form('색 합치기 (LCM)',[
    {name:'sources',label:'합쳐질 색 목록 (콤마구분 #RRGGBB, 또는 all)',type:'text',value:''},
    {name:'dest',label:'대상 색 (#RRGGBB)',type:'text',value:''},
    {name:'scope',label:'적용범위',type:'select',options:[['all','모두'],['forced','강제 변경된 객체만'],['bylayer','ByLayer 인 객체만']],value:'all'},
    {name:'target',label:'바꿀 대상',type:'select',options:[['layer','켜의 색 변경'],['object','객체 색 강제 변경']],value:'layer'},
    {name:'onlySelected',label:'화면에서 선택한 객체에만 적용',type:'checkbox',value:false},
   ],values=>{
    const dest=normalizeHex(values.dest);
    if(!dest)throw Error('대상 색은 #RRGGBB 형식으로 입력하세요.');
    const {all,colors}=parseColorList(values.sources);
    if(!all&&!colors.length)throw Error('합쳐질 색을 입력하거나 all 을 입력하세요.');
    if(values.target==='layer'){
     const ids=all?ctx.layers().map(l=>l.id):ctx.layers().filter(l=>colors.includes(normalizeHex(l.color))).map(l=>l.id);
     if(!ids.length)return ctx.toast('일치하는 켜가 없습니다.');
     ctx.execute({type:'batch',commands:ids.map(id=>({type:'layer.update',id,changes:{color:dest}}))});
     ctx.refresh();
     ctx.toast(`켜 ${ids.length}개의 색을 ${dest} 로 바꿨습니다.`);
    }else{
     const pool=flag(values.onlySelected)?ctx.selected():ctx.entities();
     const lb=layerById();
     const ids=all?pool.map(e=>e.id):colorMergeMatches(pool,lb,colors,values.scope);
     if(!ids.length)return ctx.toast('일치하는 객체가 없습니다.');
     ctx.execute({type:'update',ids,changes:{color:dest}});
     ctx.refresh();
     ctx.toast(`객체 ${ids.length}개의 색을 ${dest} 로 강제 지정했습니다.`);
    }
   });
  },
  /* LTM — 선모양 합치기(izzarder.com/149) */
  LTM(){
   ctx.form('선모양 합치기 (LTM)',[
    {name:'sources',label:'합쳐질 선모양 이름 목록 (콤마구분, 예 CENTER,HIDDEN)',type:'text',value:''},
    {name:'dest',label:'대상 선모양 이름 (예 CONTINUOUS)',type:'text',value:''},
    {name:'scope',label:'적용범위',type:'select',options:[['all','모두'],['forced','강제 지정된 객체만'],['bylayer','ByLayer 인 객체만']],value:'all'},
    {name:'target',label:'바꿀 대상',type:'select',options:[['layer','켜의 선모양 변경'],['object','객체 선모양 강제 변경']],value:'layer'},
    {name:'onlySelected',label:'화면에서 선택한 객체에만 적용',type:'checkbox',value:false},
   ],values=>{
    const dest=String(values.dest||'').trim().toUpperCase();
    if(!dest)throw Error('대상 선모양 이름을 입력하세요.');
    const names=parseNameList(values.sources);
    if(!names.length)throw Error('합쳐질 선모양 이름을 입력하세요.');
    if(values.target==='layer'){
     const ids=names.flatMap(n=>linetypesMatchingName(ctx.layers(),n));
     const uniq=[...new Set(ids)];
     if(!uniq.length)return ctx.toast('일치하는 켜가 없습니다.');
     ctx.execute({type:'batch',commands:uniq.map(id=>({type:'layer.update',id,changes:{linetype:dest}}))});
     ctx.refresh();
     ctx.toast(`켜 ${uniq.length}개의 선모양을 ${dest} 로 바꿨습니다.`);
    }else{
     const pool=flag(values.onlySelected)?ctx.selected():ctx.entities();
     const ids=linetypeMergeMatches(pool,layerById(),names,values.scope);
     if(!ids.length)return ctx.toast('일치하는 객체가 없습니다.');
     ctx.execute({type:'update',ids,changes:{linetype:dest}});
     ctx.refresh();
     ctx.toast(`객체 ${ids.length}개의 선모양을 ${dest} 로 강제 지정했습니다.`);
    }
   });
  },
  /* LQT — 켜 숫자 세기(izzarder.com/345). "캐드표"/CSV 출력 대신 문자 여러 줄로 그린다(규칙서 지시). */
  async LQT(){
   const p=await ctx.pickPoint('켜 숫자 세기 표를 놓을 점을 찍으세요 (LQT)');
   if(!p)return;
   const rows=sortRows(computeLayerCounts(ctx.entities(),ctx.layers()),'name','asc');
   const lines=['켜이름\t갯수',...rows.map(r=>`${r.name}\t${r.count}`)];
   const layerId=ctx.ensureLayer(STD_LAYERS.text,'#ffffff');
   const height=ctx.num('text-height',150);
   const texts=stackTextRows(p,lines,{height}).map(t=>({type:'text',position:t.position,text:t.text,height,rotation:0,align:'left',layer:layerId}));
   const ids=ctx.execute({type:'addMany',entities:texts});
   ctx.setSelected(ids);ctx.refresh();
   ctx.toast(`켜 ${rows.length}개의 객체 수를 표로 그렸습니다.`);
  },
  /* LST — 도면의 모든 켜 리스트 작성(izzarder.com/405). 화면에 선으로 그리는 표 대신 문자로 그린다(규칙서 지시). */
  async LST(){
   const p=await ctx.pickPoint('켜 목록을 놓을 점을 찍으세요 (LST)');
   if(!p)return;
   const lines=['켜이름\t색\t선모양',...buildLayerListRows(ctx.layers())];
   const layerId=ctx.ensureLayer(STD_LAYERS.text,'#ffffff');
   const height=ctx.num('text-height',150);
   const texts=stackTextRows(p,lines,{height}).map(t=>({type:'text',position:t.position,text:t.text,height,rotation:0,align:'left',layer:layerId}));
   const ids=ctx.execute({type:'addMany',entities:texts});
   ctx.setSelected(ids);ctx.refresh();
   ctx.toast(`켜 ${ctx.layers().length}개 목록을 문자로 그렸습니다.`);
  },
  /* SLC — 색 축출로 켜색 변경(izzarder.com/590) */
  async SLC(){
   const ref=await ctx.pickEntity({prompt:'색을 추출할 기준 객체를 선택하세요 (SLC)'});
   if(!ref)return;
   const color=effectiveColor(ref,layerById());
   if(!color)throw Error('기준 객체의 색을 확인할 수 없습니다.');
   let n=0;
   for(;;){
    const t=await ctx.pickEntity({prompt:`색 ${color} 로 켜 색을 바꿀 객체를 선택 · Esc 로 끝내기${n?' · 지금까지 '+n+'개':''}`});
    if(!t)break;
    ctx.execute({type:'layer.update',id:t.layer,changes:{color}});
    ctx.refresh();n++;
   }
   if(n)ctx.toast(`켜 ${n}개의 색을 ${color} 로 바꿨습니다.`);
  },
  /* TLL — 가까운 문자켜를 선켜로(izzarder.com/589) */
  async TLL(){
   let n=0;
   for(;;){
    const line=await ctx.pickEntity({prompt:`가까운 문자켜를 선켜로 · 선을 선택 · Esc 로 끝내기${n?' · 지금까지 '+n+'개':''}`,types:['line']});
    if(!line)break;
    const texts=ctx.entities().filter(e=>e.type==='text'&&e.id!==line.id);
    const near=nearestTextInBox(line,texts);
    if(!near){ctx.toast('탐색 범위 안에 문자가 없습니다.',true);continue;}
    ctx.execute({type:'update',ids:[line.id],changes:{layer:near.layer}});
    ctx.refresh();n++;
   }
   if(n)ctx.toast(`선 ${n}개의 켜를 가까운 문자의 켜로 바꿨습니다.`);
  },
  /* TTL — 문자내용으로 켜 생성(izzarder.com/552) */
  async TTL(){
   let n=0;
   for(;;){
    const t=await ctx.pickEntity({prompt:`문자내용으로 켜 생성 · 문자 객체를 선택 · Esc 로 끝내기${n?' · 지금까지 '+n+'개':''}`,types:['text']});
    if(!t)break;
    const name=sanitizeLayerName(t.text);
    if(!name){ctx.toast('켜 이름으로 쓸 수 없는 문자입니다(특수문자를 지우면 빈 문자열).',true);continue;}
    const layerId=ctx.ensureLayer(name,'#ffd479');
    ctx.execute({type:'update',ids:[t.id],changes:{layer:layerId}});
    ctx.refresh();n++;
   }
   if(n)ctx.toast(`문자 ${n}개의 내용으로 켜를 만들고 옮겼습니다.`);
  },
 });
}
