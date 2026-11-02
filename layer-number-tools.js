// 레이어 번호(H12·H07, 2026-09-26): 사무소마다 표준 레이어에 번호를 붙여(1 = A-WALL, 2 = A-GLAZ, 3 = A-DOOR …)
// 짧은 명령 하나로 부른다. 훈민캐드 Q1~·QQn, AutoCAD LAYMCH(객체를 다른 레이어로) + 레이어 드롭다운(현재 레이어)에 해당한다.
//  - 번호표: 바른 표준 레이어(architecture.js BARUN_LAYERS)에서 만든 기본표. 사용자가 고친 표는 'barun-layer-numbers' 에 저장한다.
//    번호는 1~99 정수, 번호·레이어 이름 모두 중복 불가.
//  - LAYNUM(LN): 번호 · 할 일 [현재 레이어로 / 선택 객체 이동 / 같은 레이어 전체 이동 / 번호표 편집…].
//  - 명령창 바로 입력: LN3 · 레이어3 · 레이어번호 3 · LAYNUM 3 A. 선택한 객체가 있으면 옮기고(S), 없으면 현재 레이어를 바꾼다.
//    뒤에 A 를 붙이면(또는 긴 이름으로 불렀을 때 범위를 A 로 고르면) 선택 객체와 같은 레이어의 객체 전체를 옮긴다.
//  - 없는 레이어는 표준 색·선종류·선두께로 만든다. 잠긴 레이어의 객체는 옮기지 않고, 잠기거나 숨긴 레이어로는 옮기지 않는다.
//  - 한 번 실행은 되돌리기 한 단계다(레이어 만들기 + 옮기기). app.js 의 카드 실행(runCardCommand·cardFormApply)이 묶고,
//    ctx.transact 가 있으면 모듈도 스스로 묶는다.
// 훈민의 QQn 은 바른 CAD 에서 QQ(도면 일괄 닫기)와 겹치므로 쓰지 않는다.
import {standardLayers} from './architecture.js';
import {consumeCardRepeat,rememberCardGo} from './card-kit.js';

export const LAYER_NUMBER_STORAGE_KEY='barun-layer-numbers';
export const LAYER_NUMBER_MIN=1;
export const LAYER_NUMBER_MAX=99;
/** 기본표 앞 번호. 1=벽 2=창 3=문 … 순서로 외우기 쉽게 두고, 나머지 표준 레이어는 BARUN_LAYERS 순서로 뒤에 붙는다. */
export const LAYER_NUMBER_PRIORITY=Object.freeze(['A-WALL','A-GLAZ','A-DOOR','A-COL','A-CNTR','A-DIM','A-TEXT','A-SYM','A-FURN','A-HATCH']);
const BAD_NAME=/[<>/\\":;?*|,=`]/;

/** 표준 레이어 사양(이름·표시 이름·색·선종류·선두께). 선종류 규칙은 standardLayers()(중심선류 CENTER)를 그대로 따른다. */
export function standardLayerSpecs(){
 return standardLayers().map(({name,label,color,linetype,lineweight})=>({name,label,color,linetype,lineweight}));
}
/** 기본 번호표: 우선 레이어 → 나머지 표준 레이어(99개까지). */
export function defaultLayerNumbers(specs=standardLayerSpecs()){
 const names=specs.map(s=>s.name),order=[...LAYER_NUMBER_PRIORITY.filter(n=>names.includes(n)),...names.filter(n=>!LAYER_NUMBER_PRIORITY.includes(n))];
 return [...new Set(order)].slice(0,LAYER_NUMBER_MAX).map((name,i)=>({no:i+1,name}));
}

/** 번호표 검사·정리. 잘못되면 한국어 오류(줄 번호가 있으면 함께)를 던진다. 번호순으로 돌려준다. */
export function validateLayerNumbers(list){
 if(!Array.isArray(list))throw Error('레이어 번호표 형식이 올바르지 않습니다.');
 const out=[],numbers=new Map(),names=new Map();
 for(const raw of list){
  const at=raw?.line?`${raw.line}번째 줄: `:'';
  const no=typeof raw?.no==='string'&&raw.no.trim()!==''?Number(raw.no):raw?.no;
  if(!Number.isInteger(no)||no<LAYER_NUMBER_MIN||no>LAYER_NUMBER_MAX)throw Error(`${at}레이어 번호는 ${LAYER_NUMBER_MIN}~${LAYER_NUMBER_MAX} 사이 정수입니다. (${raw?.no??'빈칸'})`);
  const name=String(raw?.name??'').trim();
  if(!name)throw Error(`${at}${no}번의 레이어 이름이 비었습니다.`);
  if(name.length>255||BAD_NAME.test(name))throw Error(`${at}레이어 이름 "${name}"에 쓸 수 없는 문자(< > / \\ " : ; ? * | , = \`)가 있습니다.`);
  if(numbers.has(no))throw Error(`${at}${no}번이 두 번 있습니다 (${numbers.get(no)}, ${name}).`);
  const key=name.toLowerCase();
  if(names.has(key))throw Error(`${at}"${name}" 레이어가 ${names.get(key)}번과 ${no}번에 겹칩니다. 한 레이어에는 번호 하나만 붙입니다.`);
  const entry={no,name};
  if(raw.color!=null&&raw.color!==''){if(!/^#[0-9a-f]{6}$/i.test(String(raw.color)))throw Error(`${at}${no}번 색은 #RRGGBB 형식입니다. (${raw.color})`);entry.color=String(raw.color).toLowerCase();}
  if(raw.linetype!=null&&raw.linetype!==''){const lt=String(raw.linetype).trim().toUpperCase();if(!/^[A-Z0-9_-]{1,40}$/.test(lt))throw Error(`${at}${no}번 선종류 이름이 올바르지 않습니다. (${raw.linetype})`);entry.linetype=lt;}
  numbers.set(no,name);names.set(key,no);out.push(entry);
 }
 return out.sort((a,b)=>a.no-b.no);
}
/** 편집 글. 한 줄에 "번호 = 레이어이름[, #색][, 선종류]". 빈 줄과 ; 로 시작하는 줄은 건너뛴다. */
export function parseLayerNumberText(text){
 const entries=[];
 String(text??'').split(/\r?\n/).forEach((raw,i)=>{
  const line=raw.trim();if(!line||line.startsWith(';'))return;
  const m=/^(\S+?)\s*(?:[=:]\s*|\s+)(.+)$/.exec(line);
  if(!m)throw Error(`${i+1}번째 줄: "번호 = 레이어이름" 형식으로 적으세요. (${line})`);
  const [name,...extra]=m[2].split(',').map(s=>s.trim());
  const entry={line:i+1,no:m[1],name};
  for(const token of extra){if(!token)continue;if(token.startsWith('#'))entry.color=token;else entry.linetype=token;}
  entries.push(entry);
 });
 return validateLayerNumbers(entries);
}
export function formatLayerNumberText(entries){
 return entries.map(e=>`${e.no} = ${e.name}${e.color?`, ${e.color}`:''}${e.linetype?`, ${e.linetype}`:''}`).join('\n');
}

/* ── 저장. {version:1, entries?, last?} — entries 가 없으면 기본표(표준 레이어가 늘면 함께 늘어난다). ── */
function readRaw(storage){
 let text=null;try{text=storage?.getItem(LAYER_NUMBER_STORAGE_KEY)??null;}catch{text=null;}
 if(!text)return {raw:null,broken:false};
 try{const raw=JSON.parse(text);return {raw:raw&&typeof raw==='object'?raw:null,broken:!(raw&&typeof raw==='object')};}catch{return {raw:null,broken:true};}
}
function writeRaw(storage,raw){storage.setItem(LAYER_NUMBER_STORAGE_KEY,JSON.stringify(raw));}
export function loadLayerNumbers(storage){
 const {raw,broken}=readRaw(storage);
 let entries=null,error=broken?'저장된 레이어 번호표를 읽지 못해 기본 번호표를 씁니다.':null;
 if(Array.isArray(raw?.entries)){try{entries=validateLayerNumbers(raw.entries);}catch(e){error=`저장된 레이어 번호표가 올바르지 않아 기본 번호표를 씁니다. (${e.message})`;}}
 const last=Number.isInteger(raw?.last)?raw.last:null;
 return {entries:entries||defaultLayerNumbers(),custom:!!entries,last,error};
}
export function saveLayerNumbers(storage,entries){
 const clean=validateLayerNumbers(entries),{raw}=readRaw(storage);
 try{writeRaw(storage,{version:1,entries:clean,...(Number.isInteger(raw?.last)?{last:raw.last}:{})});}catch(e){throw Error('레이어 번호표를 저장하지 못했습니다: '+(e?.message||e));}
 return clean;
}
export function resetLayerNumbers(storage){
 const {raw}=readRaw(storage);
 try{writeRaw(storage,{version:1,...(Number.isInteger(raw?.last)?{last:raw.last}:{})});}catch(e){throw Error('레이어 번호표를 되돌리지 못했습니다: '+(e?.message||e));}
 return defaultLayerNumbers();
}
function rememberLast(storage,no){try{const {raw}=readRaw(storage);writeRaw(storage,{version:1,...(raw&&Array.isArray(raw.entries)?{entries:raw.entries}:{}),last:no});}catch{}}
/** 레이어 목록(현재 레이어 선택 창)에 번호 표시용: 소문자 레이어 이름 → 번호. */
export function layerNumberIndex(storage){
 return new Map(loadLayerNumbers(storage).entries.map(e=>[e.name.toLowerCase(),e.no]));
}

/** 화면용 복사본만 정렬: 번호 오름차순 → 번호 없는 레이어는 한국어 이름순. */
export function sortLayersForDisplay(layers,layerNumbers){
 return layers.map(layer=>({layer,no:layerNumbers.get(String(layer.name).toLowerCase())}))
  .sort((a,b)=>{
   if(a.no!=null&&b.no!=null)return a.no-b.no||String(a.layer.name).localeCompare(String(b.layer.name),'ko');
   if(a.no!=null)return -1;
   if(b.no!=null)return 1;
   return String(a.layer.name).localeCompare(String(b.layer.name),'ko');
  }).map(item=>item.layer);
}

/** 새로 만들 레이어의 사양. 번호표에 적은 색·선종류가 먼저, 없으면 표준 레이어 값, 그것도 없으면 기본값. */
export function layerSpecFor(entry,specs=standardLayerSpecs()){
 const std=specs.find(s=>s.name.toLowerCase()===entry.name.toLowerCase());
 return {name:entry.name,color:entry.color||std?.color||'#ffd479',linetype:entry.linetype||std?.linetype||'CONTINUOUS',...(std?.lineweight!=null?{lineweight:std.lineweight}:{}),label:std?.label||''};
}
const findLayer=(layers,name)=>layers.find(l=>l.name===name)||layers.find(l=>String(l.name).toLowerCase()===name.toLowerCase())||null;

/* ── 명령창 입력 풀이 ──
   LN3 · LN 3 · LN3A · 레이어3 · 레이어 3 A · 레이어번호 3 · 레이어 번호 3 · LAYNUM 3 S · (한글 자판) ㅣㅜ3 · 레이어3ㅁ.
   ask 는 긴 이름(레이어번호·LAYNUM)으로 불러 범위를 따로 묻는지. 짧은 이름은 묻지 않고 S 로 본다. */
const SCOPE_WORDS={S:'S',A:'A','ㄴ':'S','ㅁ':'A','선택':'S','전체':'A'};
const scopeWord=s=>{const up=s.toUpperCase();return Object.hasOwn(SCOPE_WORDS,up)?SCOPE_WORDS[up]:Object.hasOwn(SCOPE_WORDS,s)?SCOPE_WORDS[s]:null;};
export function parseLayerNumberCommand(text){
 let s=String(text??'').trim().replace(/\s+/g,' ');
 if(!s)return null;
 s=s.replace(/^ㅣㅜ(?=\s*\d)/,'LN').replace(/^레이어 번호(?=\s*\d)/,'레이어번호');
 const m=/^(LAYNUM|LN|레이어번호|레이어)\s?(\d{1,3})(?:\s?(S|A|ㄴ|ㅁ|선택|전체))?$/i.exec(s);
 if(!m)return null;
 const head=m[1].toUpperCase();
 return {number:Number(m[2]),scope:m[3]?scopeWord(m[3]):null,ask:head==='LAYNUM'||head==='레이어번호'};
}

/** 할 일 정하기. auto = 선택이 있으면 옮기기(S: 선택 객체, A: 같은 레이어 전체), 없으면 현재 레이어. */
export function resolveLayerNumberAction(action,scope,hasSelection){
 if(['current','selected','layer'].includes(action))return action;
 if(action!=='auto')throw Error('할 일을 [현재 레이어로 / 선택 객체 이동 / 같은 레이어 전체 이동] 중에서 고르세요.');
 if(scope==='A'&&!hasSelection)throw Error('같은 레이어 전체(A)를 옮기려면 먼저 기준 객체를 선택하세요.');
 return hasSelection?(scope==='A'?'layer':'selected'):'current';
}

/** 실행. 검사를 모두 마친 뒤에만 레이어를 만들고 옮긴다(실패하면 도면은 그대로). */
export function applyLayerNumber(ctx,{number,action='auto',scope=null}={}){
 const n=Number(number);
 if(!Number.isInteger(n)||n<LAYER_NUMBER_MIN||n>LAYER_NUMBER_MAX)throw Error(`레이어 번호는 ${LAYER_NUMBER_MIN}~${LAYER_NUMBER_MAX} 사이 정수입니다. (${number})`);
 const {entries}=loadLayerNumbers(ctx.storage);
 const entry=entries.find(e=>e.no===n);
 if(!entry)throw Error(`${n}번은 레이어 번호표에 없습니다. LAYNUM → [번호표 편집…]에서 정하세요.`);
 const selection=typeof ctx.selected==='function'?ctx.selected()||[]:[];
 const mode=resolveLayerNumberAction(action,scope,selection.length>0);
 const spec=layerSpecFor(entry),echo=`${n} = ${entry.name}`;
 ctx.log?.(echo);
 const layers=ctx.layers(),byId=new Map(layers.map(l=>[l.id,l]));
 let target=findLayer(layers,entry.name);
 let ids=[],skipped=0,sources=[];
 if(mode==='current'){
  if(target?.frozen)throw Error(`${echo} · 동결된 레이어는 현재 레이어로 지정할 수 없습니다. 먼저 동결을 푸세요.`);
 }else{
  if(!selection.length)throw Error('옮길 객체를 먼저 선택하세요. (선택 없이 실행하면 현재 레이어만 바꿉니다)');
  if(target&&(target.locked||target.frozen||target.visible===false))throw Error(`${echo} · 잠기거나 숨긴(동결) 레이어로는 옮길 수 없습니다. 레이어 상태를 먼저 푸세요.`);
  let pool=selection;
  if(mode==='layer'){
   const set=new Set(selection.map(e=>e.layer).filter(id=>id!==target?.id));
   sources=[...set].map(id=>byId.get(id)?.name||id);
   pool=ctx.entities().filter(e=>set.has(e.layer));
  }
  for(const e of pool){if(target&&e.layer===target.id)continue;if(byId.get(e.layer)?.locked){skipped++;continue;}ids.push(e.id);}
  if(!ids.length){
   ctx.toast(`${echo} · 옮길 객체가 없습니다.${skipped?` (잠긴 레이어의 객체 ${skipped}개는 옮기지 않음)`:''}`);
   return {entry,mode,moved:0,skipped,created:false,layerId:target?.id??null};
  }
 }
 const transact=typeof ctx.transact==='function'?ctx.transact:fn=>fn();
 let created=false;
 transact(()=>{
  if(!target){
   if(typeof ctx.execute==='function')ctx.execute({type:'layer.add',name:spec.name,color:spec.color,linetype:spec.linetype,...(spec.lineweight!=null?{lineweight:spec.lineweight}:{})});
   else ctx.ensureLayer(spec.name,spec.color);
   target=findLayer(ctx.layers(),spec.name);
   if(!target)throw Error(`"${spec.name}" 레이어를 만들지 못했습니다.`);
   created=true;
  }
  if(mode==='current')ctx.setActiveLayer(target.id);
  else ctx.execute({type:'update',ids,changes:{layer:target.id}});
 });
 rememberLast(ctx.storage,n);
 ctx.refresh?.();
 const made=created?' (표준 설정으로 새로 만듦)':'';
 if(mode==='current'){
  const state=target.visible===false?' · 이 레이어는 꺼져 있어 그린 객체가 보이지 않습니다':target.locked?' · 잠긴 레이어입니다':'';
  ctx.toast(`${echo}${made} · 현재 레이어로 지정했습니다.${state}`);
 }else{
  const what=mode==='layer'?`같은 레이어(${sources.join(', ')}) 전체 ${ids.length}개`:`선택 객체 ${ids.length}개`;
  ctx.toast(`${echo}${made} · ${what}를 옮겼습니다.${skipped?` 잠긴 레이어의 객체 ${skipped}개는 옮기지 않았습니다.`:''} · Ctrl+Z 로 되돌리기`);
 }
 return {entry,mode,moved:ids.length,skipped,created,layerId:target.id};
}

/** 범위 글자 풀이: S·ㄴ·선택 → S, A·ㅁ·전체 → A, 빈칸(Enter) → S. 모르면 null. */
export function parseLayerNumberScope(text){
 const s=String(text??'').trim();
 if(!s)return 'S';
 return scopeWord(s);
}
/** 공용 폼 창은 열리면 [닫기] 단추에 초점이 가므로 첫 입력칸으로 옮긴다(숫자·글자 + Enter 로 바로 적용). 화면이 없으면 아무것도 안 한다. */
function focusFormField(){try{const el=globalThis.document?.getElementById?.('form-fields')?.querySelector?.('input,select,textarea');el?.focus?.();el?.select?.();}catch{}}

/** 명령창 바로 입력(parseLayerNumberCommand 결과) 실행. 긴 이름으로 불렀고 선택이 있고 범위를 안 적었으면
 *  "범위 [선택 객체(S) / 같은 레이어 전체(A)] <S>" 를 묻는다(글자 + Enter). */
export function runLayerNumberInput(ctx,parsed){
 if(!parsed)throw Error('레이어 번호를 알 수 없습니다. 예: LN3 · 레이어3 · 레이어번호 3');
 const go=scope=>{const r=applyLayerNumber(ctx,{number:parsed.number,action:'auto',scope});rememberCardGo(LAYER_NUMBER_STORAGE_KEY,null,()=>applyLayerNumber(ctx,{number:parsed.number,action:'auto',scope}));return r;};
 const hasSelection=(ctx.selected?.()||[]).length>0;
 if(parsed.ask&&hasSelection&&!parsed.scope){
  const {entries}=loadLayerNumbers(ctx.storage),entry=entries.find(e=>e.no===parsed.number);
  if(!entry)throw Error(`${parsed.number}번은 레이어 번호표에 없습니다. LAYNUM → [번호표 편집…]에서 정하세요.`);
  ctx.form(`${entry.no} = ${entry.name} · 범위`,[{name:'scope',label:'범위 [선택 객체(S) / 같은 레이어 전체(A)] <S>',type:'text',value:'S'}],v=>{
   const scope=parseLayerNumberScope(v?.scope);
   if(!scope)throw Error('범위는 S(선택 객체) 또는 A(같은 레이어 전체)를 입력하세요.');
   return go(scope);
  });
  focusFormField();
  return null;
 }
 return go(parsed.scope);
}

/* ── 카드 진입점: LAYNUM(번호로 지정·이동), LAYNUMLIST(번호표 편집) ── */
export function installLayerNumberTools(ctx){
 function openList(){
  const {entries,custom,error}=loadLayerNumbers(ctx.storage);
  if(error)ctx.toast(error,true);
  ctx.form(`레이어 번호표 (LAYNUMLIST) · ${custom?'사용자 번호표':'기본 번호표(표준 레이어)'}`,[
   {name:'table',label:`한 줄에 "번호 = 레이어이름" (선택: , #색 , 선종류) · ${LAYER_NUMBER_MIN}~${LAYER_NUMBER_MAX} · 번호·이름 중복 불가 · ; 로 시작하면 메모`,type:'textarea',value:formatLayerNumberText(entries)},
   {name:'mode',label:'저장 방식',options:[['save','위 목록으로 저장'],['reset','기본 번호표로 되돌리기 (표준 레이어 순서)']],value:'save'},
  ],values=>{
   if(values?.mode==='reset'){const list=resetLayerNumbers(ctx.storage);ctx.toast(`레이어 번호표를 기본값(${list.length}개)으로 되돌렸습니다.`);return;}
   const list=saveLayerNumbers(ctx.storage,parseLayerNumberText(values?.table));
   ctx.toast(`레이어 번호표를 저장했습니다 · ${list.length}개 · 예: LN${list[0]?.no??1} = ${list[0]?.name??'-'}`);
  });
  focusFormField();
 }
 return {
  LAYNUM(){
   const again=consumeCardRepeat(LAYER_NUMBER_STORAGE_KEY);if(again){again.run();return;}
   const {entries,last,error}=loadLayerNumbers(ctx.storage);
   if(error)ctx.toast(error,true);
   if(!entries.length){openList();return;}
   const count=(ctx.selected?.()||[]).length,shown=entries.slice(0,12).map(e=>`${e.no}=${e.name}`).join(' ');
   // 번호는 숫자 입력칸(숫자 + Enter 로 바로 적용). 번호표 전체는 [번호표 편집…]에서 본다.
   ctx.form('레이어 번호 (LAYNUM) · 명령창에서 LN3 · 레이어3 으로도 부릅니다',[
    {name:'number',label:`번호 ${LAYER_NUMBER_MIN}~${LAYER_NUMBER_MAX} · ${shown}${entries.length>12?' …':''}`,type:'number',value:String(entries.some(e=>e.no===last)?last:entries[0].no)},
    {name:'action',label:count?`할 일 · 선택 객체 ${count}개`:'할 일 · 선택한 객체 없음 (Enter = 현재 레이어)',options:[['current','현재 레이어로'],['selected','선택 객체 이동 (S)'],['layer','같은 레이어 전체 이동 (A)'],['manage','번호표 편집…']],value:count?'selected':'current'},
   ],values=>{
    if(values?.action==='manage'){openList();return;}
    if(String(values?.number??'').trim()==='')throw Error(`레이어 번호(${LAYER_NUMBER_MIN}~${LAYER_NUMBER_MAX})를 입력하세요.`);
    const request={number:Number(values.number),action:values?.action||'current'};
    const result=applyLayerNumber(ctx,request);
    rememberCardGo(LAYER_NUMBER_STORAGE_KEY,null,()=>applyLayerNumber(ctx,request));
    return result;
   });
   focusFormField();
  },
  LAYNUMLIST(){openList();},
 };
}
