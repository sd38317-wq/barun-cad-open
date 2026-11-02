// 건축개요 — 도면 인식 ① 개요표 읽기(2026-10-27 대표 결정, docs/adr/0001-drawing-recognition-single-json.md).
// 도면 위 "건축개요" 표(개요표)와 도곽 글자에서 값을 읽고, 값마다 근거를 적는다. 못 읽었거나 애매한 칸은 비워 '확인 필요'로 둔다(추측하지 않는다).
// 결과는 reviewSettings.buildingOverview 한 곳에 두고, 예전 자리(permitBook.overview)에도 같은 값을 적어 인허가 도서·에너지가 그대로 읽게 한다.
// 엑셀은 펼쳐 보고 고치는 길일 뿐 원본이 아니다(overviewRows ↔ overviewEditsFromRows).
import {stripMtextFormat} from './text-edit-tools.js';

/** [키, 칸 이름, 종류, 개요표에서 찾을 이름들]. 종류: text·area(㎡)·floors(지상/지하)·mm·date. 이름이 없는 칸은 손으로만 넣는다. */
export const OVERVIEW_FIELDS=Object.freeze([
 ['name','건축명','text',['공사명','건축명','건물명','사업명','프로젝트명','PROJECT']],
 ['office','설계자(사무소)','text',['설계사무소','설계자','건축사사무소']],
 ['address','대지위치','text',['대지위치및지번','대지위치','소재지','대지지번','위치']],
 ['zone','지역·지구','text',['용도지역지구','지역지구','용도지역','지역']],
 ['siteArea','대지면적 ㎡','area',['대지면적']],
 ['buildingArea','건축면적 ㎡','area',['건축면적']],
 ['gfa','연면적 ㎡','area',['연면적합계','연면적']],
 ['mainUse','주용도','text',['주용도','건물용도','용도']],
 ['structure','구조','text',['주구조','구조형식','구조']],
 ['floors','층수','floors',['건물규모','규모','층수']],
 ['storyHeight','층고 mm','mm',['층고']],
 ['date','작성일','date',[]],
 ['frameNumber','원 도면 도곽 번호(예: A-601)','text',[]],
 ['planSheets','원 도면 평면 번호(예: A-101·A-102)','text',[]],
]);
const FIELD=Object.fromEntries(OVERVIEW_FIELDS.map(f=>[f[0],f]));
// 이름 글자 사이의 띄어쓰기·가운뎃점·빗금은 무시하고(지역 · 지구 = 지역지구), 이름 바로 뒤에 한글이 이어지면 다른 이름이다(용도 ≠ 용도지역).
const labelRe=l=>new RegExp('^[\\s\\-–·*•●○□■▪◎0-9.)①-⑳]*'+[...l].map(c=>c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[\\s·ㆍ・/]*')+'(?![가-힣]|[·ㆍ・]\\s*[가-힣])','i');
const LABELS=OVERVIEW_FIELDS.flatMap(([key,,,names])=>names.map(n=>({key,name:n,re:labelRe(n)}))).sort((a,b)=>b.name.length-a.name.length);
const TITLE=/^\s*[0-9.\-]*\s*건\s*축\s*개\s*요\s*$/;
const SHEET_NO=/^[A-Z]{1,3}\s*-?\s*\d{2,4}$/i;
const empty=v=>v==null||v==='';
const num=s=>Number(String(s).replace(/,/g,''));
const fmt=n=>String(Math.round(n*100)/100);

/** 도면 글자를 [{text,x,y,h}] 로(블록 안 글자까지, 다행문자는 줄마다 하나씩). */
export function collectTexts(entities){
 const out=[];
 const walk=list=>{for(const e of list||[]){
  if(e?.type==='block'||e?.type==='insert'){walk(e._visibleEntities||e.entities);continue;}
  if(e?.type!=='text'&&e?.type!=='mtext'&&e?.type!=='attrib')continue;
  const p=e.position||e.insert||e.point;if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;
  const h=Number(e.height)>0?Number(e.height):250;
  const lines=(e.type==='mtext'?stripMtextFormat(e.text,true):String(e.text??'')).split(/\r?\n/);
  lines.forEach((t,i)=>{if(t.trim())out.push({text:t.trim(),x:p.x,y:p.y-i*h*1.6,h});});
 }};
 walk(entities);
 return out;
}

const labelOf=t=>{for(const l of LABELS){const m=t.text.match(l.re);if(m)return {...l,rest:t.text.slice(m[0].length).replace(/^[\s:：=\-–]+/,'').trim()};}return null;};

/** 한 이름 줄의 값 글자: 같은 글자 안 ':' 뒤, 아니면 같은 줄 오른쪽 글자들(다음 이름 칸이나 큰 틈 앞까지). */
function rowValue(label,t,texts){
 if(label.rest)return label.rest;
 const right=texts.filter(o=>o!==t&&o.x>t.x&&Math.abs(o.y-t.y)<=0.6*Math.max(t.h,o.h)).sort((a,b)=>a.x-b.x),parts=[];let last=t.x;
 // 첫 값은 멀어도 같은 줄이면 받는다(값 칸이 오른쪽 끝에 붙은 표). 그 뒤로는 큰 틈 앞까지만.
 for(const o of right){if(labelOf(o)||(parts.length&&o.x-last>30*Math.max(t.h,o.h)))break;parts.push(o.text);last=o.x;}
 return parts.join(' ').trim();
}

/** 글자 하나를 칸 종류대로 값으로. {value} 또는 {reason}(확인 필요). */
export function parseOverviewValue(kind,raw){
 const s=String(raw??'').trim();if(!s)return {reason:'값이 비어 있음'};
 if(kind==='text')return {value:s};
 if(kind==='area'){
  const all=[...s.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(㎡|m2|m²|M2|평|%)?/g)].filter(m=>m[2]!=='평'&&m[2]!=='%');
  const withUnit=all.filter(m=>m[2]),pick=[...new Set((withUnit.length?withUnit:all).map(m=>fmt(num(m[1]))))];
  if(pick.length===1)return {value:Number(pick[0])};
  return {reason:pick.length?`숫자가 ${pick.length}개(${pick.join(' · ')}) — 어느 것인지 확인`:'면적 숫자가 없음'};
 }
 if(kind==='floors'){
  const below=s.match(/지하\s*(\d+)\s*층/)||s.match(/\bB(\d+)/i),above=s.match(/지상\s*(\d+)\s*층/),bare=!above&&!below&&s.match(/^(\d+)\s*층/);
  if(!above&&!bare)return {reason:'지상 층수를 못 읽음'};
  return {value:{above:Number((above||bare)[1]),below:below?Number(below[1]):0}};
 }
 if(kind==='mm'){
  const vals=[...new Set([...s.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(mm|m)?/gi)].map(m=>{const n=num(m[1]);return Math.round((m[2]?.toLowerCase()==='m'||(!m[2]&&n<20))?n*1000:n);}))];
  if(vals.length===1)return {value:vals[0]};
  return {reason:vals.length?`층고가 여럿(${vals.join(' · ')}) — 층마다 다르면 층 평면에서`:'층고 숫자가 없음'};
 }
 return {value:s};
}

/** 개요표 찾기. 'window' 를 주면 그 안만, 아니면 "건축개요" 제목 근처. 제목이 없거나 여럿이면 도면 전체를 보고 그렇게 알린다. */
export function overviewRegion(texts,window=null){
 const inBox=(t,b)=>t.x>=b.minX&&t.x<=b.maxX&&t.y>=b.minY&&t.y<=b.maxY;
 if(window){const b={minX:Math.min(window[0].x,window[1].x),maxX:Math.max(window[0].x,window[1].x),minY:Math.min(window[0].y,window[1].y),maxY:Math.max(window[0].y,window[1].y)};return {status:'window',texts:texts.filter(t=>inBox(t,b))};}
 // 도면 목록표의 'A-002 건축개요' 처럼 왼쪽 같은 줄에 도면 번호가 있는 글자는 제목이 아니다.
 const listRow=t=>texts.some(o=>o!==t&&o.x<t.x&&t.x-o.x<20*t.h&&Math.abs(o.y-t.y)<=0.6*Math.max(t.h,o.h)&&SHEET_NO.test(o.text));
 const titles=texts.filter(t=>TITLE.test(t.text)&&!listRow(t));
 if(titles.length!==1)return {status:titles.length?'many':'none',texts};
 const t=titles[0],h=t.h;
 return {status:'title',title:t,texts:texts.filter(o=>inBox(o,{minX:t.x-10*h,maxX:t.x+80*h,minY:t.y-90*h,maxY:t.y+2*h}))};
}

/**
 * 도면 글자에서 건축개요 읽기.
 * @returns {{status:string, values:object, evidence:object, confirm:{key:string,reason:string}[]}}
 *   values 의 floors 는 floorsAbove·floorsBelow 두 칸으로 나눠 넣는다.
 */
export function readOverviewFromTexts(texts,{window=null}={}){
 const region=overviewRegion(texts,window),values={},evidence={},confirm=[];
 const where=region.status==='window'?'감싼 범위':region.status==='title'?'개요표':'도면';
 const found=(pool,key)=>pool.map(t=>({t,l:labelOf(t)})).filter(x=>x.l?.key===key).map(x=>({...x,raw:rowValue(x.l,x.t,pool)})).filter(x=>x.raw);
 for(const [key,label,kind,names] of OVERVIEW_FIELDS){
  if(!names.length)continue;
  let hits=found(region.texts,key),src=where;
  // 건축명·설계자는 도곽에도 있다 — 개요표에 없으면 도면 전체에서.
  if(!hits.length&&(key==='name'||key==='office')&&region.status!=='none'){hits=found(texts,key);src='도곽';}
  if(key==='office'&&!hits.length){const own=[...new Set(texts.filter(t=>/건축사\s*사무소/.test(t.text)&&!labelOf(t)).map(t=>t.text))];if(own.length===1){values.office=own[0];evidence.office="도곽 · '건축사사무소' 글자";continue;}}
  if(!hits.length){confirm.push({key,reason:`${where}에서 '${label.replace(/ ㎡| mm/,'')}' 칸을 못 찾음`});continue;}
  const parsed=hits.map(h=>({...h,p:parseOverviewValue(kind,h.raw)})),ok=parsed.filter(h=>!h.p.reason);
  const distinct=[...new Map(ok.map(h=>[JSON.stringify(h.p.value),h])).values()];
  if(distinct.length===1){
   const h=distinct[0],v=h.p.value;
   if(kind==='floors'){values.floorsAbove=v.above;values.floorsBelow=v.below;evidence.floorsAbove=evidence.floorsBelow=`${src} · '${h.l.name}' 줄 → '${h.raw}'`;}
   else{values[key]=v;evidence[key]=`${src} · '${h.l.name}' 줄 → '${h.raw}'`;}
  }else if(distinct.length>1)confirm.push({key,reason:`'${label.replace(/ ㎡| mm/,'')}' 줄이 ${distinct.length}개, 값이 다름(${distinct.map(h=>h.raw).join(' / ')})`});
  else confirm.push({key,reason:`${src} · '${parsed[0].l.name}' 줄 '${parsed[0].raw}' — ${parsed[0].p.reason}`});
 }
 return {status:region.status,values,evidence,confirm};
}

/** 도면 문서에서 읽기(모든 배치 글자). */
export function readOverviewFromDocument(doc,options){return readOverviewFromTexts(collectTexts(doc?.entities),options);}

// ── 한 곳 저장 ──
const KEYS=[...OVERVIEW_FIELDS.filter(f=>f[2]!=='floors').map(f=>f[0]),'floorsAbove','floorsBelow'];
const same=(a,b)=>typeof a==='number'||typeof b==='number'?Math.abs(Number(a)-Number(b))<0.005:String(a).replace(/\s+/g,'')===String(b).replace(/\s+/g,'');
/** 칸 키 → 이름(층수는 지상·지하 두 칸). */
export const overviewLabel=key=>key==='floorsAbove'?'지상 층수':key==='floorsBelow'?'지하 층수':(FIELD[key]?.[1]||key);

/** 지금 저장된 건축개요. 아직 없으면 예전 인허가 개요 윈도우 값을 그대로 쓴다. */
export function storedOverview(doc){
 const s=doc?.reviewSettings?.buildingOverview;
 if(s)return structuredClone({values:{},evidence:{},confirm:[],conflicts:[],...s});
 const old=doc?.reviewSettings?.permitBook?.overview||{},values={},evidence={};
 for(const [k,v] of Object.entries(old))if(!empty(v)){values[k]=v;evidence[k]='인허가 개요 윈도우';}
 return {values,evidence,confirm:[],conflicts:[],readAt:null,source:null};
}

const AUTO=/^(도면|개요표|감싼 범위|도곽) ·/;
/** 읽은 값을 저장된 값에 합친다: 빈 칸만 바로 채우고, 같으면 그대로, 다르면 conflicts 로 남겨 고르게 한다. */
export function mergeOverview(stored,read,{now=new Date().toISOString(),source='개요표'}={}){
 const out=structuredClone(stored),conflicts=[];
 // 예전에 자동으로 읽은 값(근거가 '도면 ·'·'개요표 ·' 등)은 다시 읽은 결과를 따른다 — 이번에 못 찾으면 비우고 확인 필요로.
 for(const k of Object.keys(out.values))if(AUTO.test(out.evidence?.[k]||'')&&!(k in read.values)){delete out.values[k];delete out.evidence[k];}
 for(const [k,v] of Object.entries(read.values)){
  const mine=out.values[k];
  if(empty(mine)||AUTO.test(out.evidence?.[k]||'')){out.values[k]=v;out.evidence[k]=read.evidence[k];}
  else if(!same(mine,v))conflicts.push({key:k,mine,mineEvidence:out.evidence[k]||'',read:v,readEvidence:read.evidence[k]});
 }
 out.confirm=read.confirm.filter(c=>c.key==='floors'?empty(out.values.floorsAbove):empty(out.values[c.key]));
 return {...out,conflicts,readAt:now,source};
}

/** 설계자가 고친 값 넣기(창·엑셀·인허가 개요 윈도우). 고친 칸은 확인 필요·다른 값 목록에서 빠진다. */
export function applyOverviewEdits(stored,edits,evidence='설계자 입력'){
 const out=structuredClone(stored);
 for(const [k,v] of Object.entries(edits)){
  if(empty(v)){delete out.values[k];delete out.evidence[k];}else{out.values[k]=v;out.evidence[k]=evidence;}
  out.confirm=(out.confirm||[]).filter(c=>c.key!==k&&!(c.key==='floors'&&(k==='floorsAbove'||k==='floorsBelow')&&!empty(v)));
  out.conflicts=(out.conflicts||[]).filter(c=>c.key!==k);
 }
 return out;
}

/** 엔진 review.settings 에 넣을 값 — 한 곳(buildingOverview)과 예전 자리(permitBook.overview)를 같이. */
export function overviewSettings(doc,store){
 const permitBook=structuredClone(doc?.reviewSettings?.permitBook||{});
 permitBook.overview={...(permitBook.overview||{}),...Object.fromEntries(KEYS.map(k=>[k,store.values[k]]).filter(([,v])=>!empty(v)))};
 return {buildingOverview:store,permitBook};
}

/** 실시 칸 카드에 띄울 상태. */
export function overviewState(doc){
 const s=doc?.reviewSettings?.buildingOverview;
 if(!s?.readAt)return {read:false,readAt:null,confirm:0};
 return {read:true,readAt:s.readAt,confirm:(s.confirm||[]).length+(s.conflicts||[]).length};
}

// ── 엑셀 "도면데이터 · 개요" ──
const HEAD=['칸','값','근거','확인 필요','키'];
/** 엑셀로 내보낼 표(첫 줄 머리). 키 칸은 가져올 때 짝을 찾는 데 쓴다. */
export function overviewRows(store){
 const reason=k=>(store.confirm||[]).find(c=>c.key===k||(c.key==='floors'&&(k==='floorsAbove'||k==='floorsBelow')))?.reason||(store.conflicts||[]).find(c=>c.key===k)&&'다시 읽은 값과 다름'||'';
 return [HEAD,...KEYS.map(k=>[overviewLabel(k),empty(store.values[k])?'':store.values[k],store.evidence?.[k]||'',reason(k),k])];
}
/** 엑셀에서 가져온 표 → 고칠 값. 머리 줄의 '키'·'값' 칸으로 짝을 찾고, 바뀐 칸만 돌려준다. */
export function overviewEditsFromRows(rows,store){
 const head=(rows||[]).findIndex(r=>Array.isArray(r)&&r.includes('키')&&r.includes('값'));
 if(head<0)throw new Error("'키'·'값' 칸이 있는 도면데이터(개요) 엑셀이 아닙니다. 먼저 [엑셀로 내보내기]로 받은 파일을 고쳐 가져오세요.");
 const ki=rows[head].indexOf('키'),vi=rows[head].indexOf('값'),edits={},changed=[];
 for(const r of rows.slice(head+1)){
  const k=String(r[ki]??'').trim();if(!KEYS.includes(k))continue;
  const kind=k==='floorsAbove'||k==='floorsBelow'?'count':FIELD[k][2];
  let v=r[vi];if(typeof v==='string')v=v.trim();
  if(!empty(v)&&(kind==='area'||kind==='mm'||kind==='count')){const n=num(v);if(!Number.isFinite(n))throw new Error(`'${overviewLabel(k)}' 칸 값 '${v}' 이 숫자가 아닙니다.`);v=kind==='count'?Math.round(n):n;}
  const mine=store.values[k];
  if(empty(v)&&empty(mine))continue;
  if(!empty(v)&&!empty(mine)&&same(v,mine))continue;
  edits[k]=empty(v)?'':v;changed.push(overviewLabel(k));
 }
 return {edits,changed};
}
