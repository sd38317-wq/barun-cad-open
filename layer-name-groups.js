// 레이어 정리 — 이름 묶음 확인(2026-10-21 대표 결정, docs/도면알아보기/결정기록.md · 시안 docs/시안-레이어정리-2026-10-21).
// 자동 정리가 정하지 못하고 남긴 객체를 레이어 이름 묶음(끝 번호만 다른 WALL1·WALL2 …)으로 모아, 직원이 묶음마다 한 번 확인한다.
//  - 여기서 내는 것은 '제안'일 뿐 자동으로 옮기지 않는다(이름 짐작이 틀리면 단면·법규가 틀어진다).
//  - 모양으로 벽·창을 가리지 않는다(2026-10-09 결정 그대로). 문 제안에 열림 호가 없으면 경고만 붙인다.
//  - 확인한 묶음은 사무소 사전에 '이름#' 으로 남아, 다음 도면의 같은 묶음(WALL3 …)은 자동으로 간다.
//    레이어별로 펼쳐 따로 확인한 것은 그 이름 그대로(WALL1) 남는다.
import {layerNameLabel} from './layer-knowledge.js';
import {standardLayerForLabel} from './layer-standards.js';

// 단면·법규에 쓰이는 종류(핵심 6종: 중심선·벽·문·창·계단·실 이름)
export const CORE_LABELS=new Set(['벽체','콘크리트벽','조적','칸막이','벽돌 벽체','창호','문','계단','축선','벽중심선','중심선','문자']);

// 이름 규칙에 없는 흔한 약어 — 제안만(사무소 확인: COR=코어, ELE=엘리베이터, IN=단열재, W=벽)
const ABBREVIATIONS={W:'벽체',WAL:'벽체',CON:'콘크리트벽',CONC:'콘크리트벽',RC:'콘크리트벽',FUR:'가구',FURN:'가구',FIN:'마감',CEN:'중심선',COR:'코어(계단실·홀)',CORE:'코어(계단실·홀)',
 ELE:'승강기',EL:'승강기',IN:'단열재',OPEN:'문',HAT:'해치',TEX:'문자',TXT:'문자'};
// 한글 낱말 — 앞에서부터 먼저 맞는 것. '창' 한 글자처럼 다른 낱말(창고)에 섞이는 것은 넣지 않는다.
const KOREAN_WORDS=[['부호','기호'],['면적','면적'],['입면','전개·입면'],['단열','단열재'],['벽','벽체'],['창호','창호'],['창문','창호'],
 ['계단','계단'],['중심','중심선'],['가구','가구'],['욕실','위생'],['위생','위생'],['실명','문자'],['문자','문자'],['치수','치수'],
 ['해치','해치'],['승강','승강기'],['엘리베이터','승강기'],['기둥','기둥'],['마감','마감'],['코어','코어(계단실·홀)'],['도로','도로'],['대지','대지']];

const known=label=>label&&standardLayerForLabel(label)?label:null;
const norm=name=>String(name??'').normalize('NFKC').trim();

/** 외부참조 묶인 이름 앞($0$·$1$·|)과 괄호 설명을 뗀 대문자 이름(끝 번호는 그대로). */
export function layerExactKey(name){
 return norm(name).toUpperCase().split(/\$\d+\$|\|/).pop().replace(/\(.*?\)/g,'').trim();
}
/** 사무소 사전에 레이어 하나를 그대로 남길 때의 이름: 외부참조 앞만 떼고 괄호 설명은 둔다(ELE-4(입면선) 과 ELE-4(기타) 를 구분).
 *  architecture.js layerDictionaryKey 와 같은 규칙(서로 불러오면 고리가 생겨 따로 둔다). */
export function layerDictionaryEntry(name){
 return norm(name).toUpperCase().split(/\$\d+\$|\|/).pop();
}
/** 이름 묶음 키: layerExactKey 에서 끝 번호까지 뗀 이름(WALL1 → WALL). */
export function layerFamilyKey(name){
 const bare=layerExactKey(name);
 return bare.replace(/[-_ ]?\d+$/,'')||bare;
}

function wordsLabel(text){
 const t=norm(text).toUpperCase();
 for(const [word,label] of KOREAN_WORDS)if(t.includes(word)&&known(label))return {label,word};
 return null;
}

/** 레이어 이름 하나에 대한 제안 {label, source, hint} 또는 null. 사전 → 괄호 설명 → 이름 규칙 → 약어 → 한글 낱말.
 *  hint 는 직원이 읽는 근거 한 줄(개발자 말 없이). */
export function suggestLayerFamily(name,dictionary={}){
 const exact=layerExactKey(name),key=layerFamilyKey(name);
 const remembered=known(dictionary[layerDictionaryEntry(name)])||known(dictionary[exact])||known(dictionary[key+'#'])||known(dictionary[key]);
 if(remembered)return {label:remembered,source:'사무소 사전',hint:'전에 사무소에서 정해 둔 이름'};
 const description=(norm(name).match(/\((.*?)\)/)||[])[1];
 const fromDescription=description&&wordsLabel(description);
 if(fromDescription)return {label:fromDescription.label,source:'레이어 설명',hint:`레이어 설명에 '${fromDescription.word}'`};
 const named=known(layerNameLabel({name:key}));
 if(named)return {label:named,source:'이름 규칙',hint:`'${key}' 는 흔히 ${named}`};
 // 약어: 이름 전체(CON) → 한글 낱말(FUR-욕실 은 가구보다 위생) → '-'·'_' 로 나뉜 낱말 하나가 통째로 약어일 때(HAT-덧부재).
 // 낱말 일부(STREET 의 STR)는 보지 않는다.
 const whole=known(ABBREVIATIONS[key]);
 if(whole)return {label:whole,source:'약어',hint:`'${key}' 는 흔히 ${whole}`};
 const word=wordsLabel(key);
 if(word)return {label:word.label,source:'이름 안 낱말',hint:`이름에 '${word.word}'`};
 const token=key.split(/[-_ .]+/).find(t=>known(ABBREVIATIONS[t]));
 if(token)return {label:ABBREVIATIONS[token],source:'약어',hint:`이름에 '${token}'`};
 return null;
}

const isArc=e=>String(e?.type||'').toLowerCase()==='arc';
const doorWarning='열림 호가 없습니다 — 샤프트·개구부일 수 있어 미리보기로 확인하세요';

function finish(g,dictionary,suggestionFor){
 const names=[...g.byLayer.keys()];
 const unnamed=g.key==='0'||g.key==='DEFPOINTS';
 const suggestion=unnamed?null:suggestionFor(names[0],dictionary);
 return {key:g.key,exact:!!g.exact,parent:g.parent||null,layers:names.map(name=>({name,count:g.byLayer.get(name).length})),
  byLayer:names.map(name=>({name,entityIds:g.byLayer.get(name)})),entityIds:names.flatMap(name=>g.byLayer.get(name)),
  count:names.reduce((n,name)=>n+g.byLayer.get(name).length,0),arcs:g.arcs,
  suggestion,core:!!suggestion&&CORE_LABELS.has(suggestion.label),warning:suggestion?.label==='문'&&!g.arcs?doorWarning:null,unnamed};
}

/** 자동으로 정하지 못한 객체를 이름 묶음으로. 제안 있는 줄 먼저, 그다음 객체 수가 많은 순. */
export function buildNameGroups(doc,decisions,dictionary={}){
 const layers=new Map(doc.layers.map(l=>[l.id,l])),entities=new Map(doc.entities.map(e=>[e.id,e]));
 const groups=new Map();
 for(const d of decisions){
  if(d.accepted)continue;
  const entity=entities.get(d.id),layer=layers.get(entity?.layer);if(!layer)continue;
  const key=layerFamilyKey(layer.name);
  if(!groups.has(key))groups.set(key,{key,byLayer:new Map(),arcs:0});
  const g=groups.get(key);if(!g.byLayer.has(layer.name))g.byLayer.set(layer.name,[]);g.byLayer.get(layer.name).push(d.id);if(isArc(entity))g.arcs++;
 }
 return [...groups.values()].map(g=>finish(g,dictionary,suggestLayerFamily))
  .sort((a,b)=>(!!b.suggestion-!!a.suggestion)||(b.count-a.count)||a.key.localeCompare(b.key));
}

/** 묶음을 레이어별 줄로 펼친다(WALL1 은 콘크리트, WALL2 는 칸막이처럼 번호마다 뜻이 다를 때). 펼친 줄은 그 이름 그대로 기억한다. */
export function splitNameGroup(doc,group,dictionary={}){
 const entities=new Map(doc.entities.map(e=>[e.id,e]));
 return group.byLayer.map(({name,entityIds})=>finish({key:layerDictionaryEntry(name),exact:true,parent:group,byLayer:new Map([[name,entityIds]]),
  arcs:entityIds.filter(id=>isArc(entities.get(id))).length},dictionary,(n,dict)=>suggestLayerFamily(n,dict)||group.suggestion));
}

/** 묶음 하나를 직원이 확인: 그 객체들의 분류를 정하고 옮길 대상으로. 옮길 객체 수를 돌려준다. */
export function applyNameGroup(decisions,group,label){
 const ids=new Set(group.entityIds);let n=0;
 const names=group.layers.map(l=>l.name).join('·');
 for(const d of decisions){
  if(!ids.has(d.id))continue;
  if(label){d.label=label;d.accepted=true;d.reason=`이름 묶음 '${names}' → ${label} · 직원 확인`;n++;}
  else{d.accepted=false;d.reason=`이름 묶음 '${names}' · 원본 유지`;}
 }
 return n;
}

/** 묶음의 지금 상태: 객체 분류에서 다시 읽는다(종류별 보기에서 선을 고쳐도 맞게).
 *  'confirmed'(전부 같은 분류로 적용 예정) · 'mixed'(일부만) · 'kept'(원본 유지로 정함) · 'pending'. */
export function nameGroupState(group,decisionById,kept=false){
 const ds=group.entityIds.map(id=>decisionById.get(id)).filter(Boolean);
 const accepted=ds.filter(d=>d.accepted&&d.label);
 if(!accepted.length)return {state:kept?'kept':'pending',label:null,accepted:0};
 const labels=new Set(accepted.map(d=>d.label));
 if(accepted.length===ds.length&&labels.size===1)return {state:'confirmed',label:[...labels][0],accepted:accepted.length};
 return {state:'mixed',label:null,accepted:accepted.length};
}

/** 다음 도면에서 자동으로 갈 이름을 사람이 읽는 말로: 'WALL·WALL1·WALL2…' 또는 펼친 줄은 그 이름. */
export function rememberTarget(group){
 if(group.exact)return group.layers[0].name;
 const numbered=group.layers.some(l=>layerExactKey(l.name)!==group.key);
 return numbered?`${group.key}·${group.key}1·${group.key}2…`:group.key;
}

/** 확인한 묶음 중 '다음부터 자동'을 켠 것만 사무소 사전으로: 묶음은 {이름#: 분류}, 펼친 줄은 {이름: 분류}. */
export function dictionaryFromNameGroups(confirmed){
 const out={};
 for(const g of confirmed)if(g.remember&&g.label&&g.key&&g.key!=='0')out[g.exact?g.key:g.key+'#']=g.label;
 return out;
}

/** 사무소 사전을 사람이 읽는 목록으로: [{entry, name, label}] (WALL# → 'WALL + 번호'). */
export function describeDictionary(dictionary){
 return Object.entries(dictionary||{}).filter(([,label])=>typeof label==='string'&&label)
  .map(([entry,label])=>({entry,label,name:entry.endsWith('#')?`${entry.slice(0,-1)} + 번호`:entry}))
  .sort((a,b)=>a.name.localeCompare(b.name));
}
