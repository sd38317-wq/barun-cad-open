// 문자 수정 11개(ABE MSK CTX FAR TAP TD TE TM TSH TSM TSP) 카드. 4차 병렬 작업, 2차 검증에서 "부분"으로
// 판정된 90건 중 문자 수정 분(reports/2차_매핑검증_A_보고_20260921.md "7. 문자 수정" 절)을 원문대로 다시 만든다.
// 근거: docs/카드작업규칙_4차_20260921.md, docs/izzarder-reference-20260921/references/11-text-edit.md.
//       원문 WebFetch: ABE izzarder.com/537, MSK /585, CTX /492, FAR /264, TAP /539, TD /540, TE /204, TM /368,
//       TSM /97, TSP /605. TSH 는 정리본 27개 목록에 없어(정리본 명령어 요약표에 TSH 자체가 빠져 있다)
//       WebSearch site:izzarder.com 로 /531 을 찾아 WebFetch 로 읽었다 — 2차 검증 보고서의 TSH 행은 MSK 와
//       같은 배경마스크(TEXTMASK)로 추정 비교했지만, 원문(izzarder.com/531)을 직접 읽어보니 TSH(xiTextShadow)는
//       "문자를 익스플로드한 뒤 폭만큼 솔리드 그림자를 만드는" 전혀 다른 명령이었다. 정리본·2차 추정보다
//       원문이 우선이므로(규칙서 2절) 이 카드는 원문을 따른다.
// 중복 확인(규칙서 12절, 명령마다 비교):
//  - MSK·TSH: 둘 다 "문자 뒤에 뭔가 깐다"는 인상이 있어 규칙서가 직접 짚었지만, 원문은 다른 명령이다.
//    MSK(izzarder.com/585)는 문자 자체의 배경마스크 플래그(그룹코드 90/63/45, 우리 엔진 backgroundMask/
//    maskPadding)를 켜는 "속성 변경"이고, TSH(izzarder.com/531)는 문자를 익스플로드해 폭만큼 오프셋한
//    별도의 솔리드 도형을 만드는 "새 객체 생성"이다. 카드를 합치지 않는다.
//  - CTX·TE: CTX(izzarder.com/492)는 찾은 것을 하나씩 보여주며 개별 확인 후 바꾸는 대화형 반복이고,
//    TE(izzarder.com/204)는 내용뿐 아니라 켜·색·높이·폭·각도·대소문자까지 조건검색 후 일괄 변경하는
//    다속성 편집기다. 겹치는 범위(문자 내용 바꾸기)가 있지만 조작 방식과 대상 속성이 달라 합치지 않는다.
//  - TD·TSP: TD(izzarder.com/540)는 클릭 위치 1곳을 기준으로 1회만 자르고 다른 문자열에 병합/새 문자열
//    생성까지 하는 명령이고, TSP(izzarder.com/605)는 구분문자로 한 문자열을 여러 조각으로 한 번에 다
//    쪼개기만 한다(병합 없음). 합치지 않는다.
//  - 1~3차 모듈·기존 카드 대조: `grep -rn "\bABE\b(\|\bMSK\b(\|...`  *.js` 로 11개 이름 전부가
//    architecture-command-pack.js(매핑 표, 공유 파일)에만 있고 다른 모듈에 카드로 구현된 적이 없음을 확인했다.
//    "배경"(output-tools.js TBC=화면 배경색 토글), "접두/접미"(block-edit-tools.js BRN=블록 이름,
//    text-create-tools.js·dim-symbol-tools.js=숫자 자동증가용 3분할)는 이름만 비슷하고 기능이 달라
//    duplicate 아님. "음영/그림자/종합수정/스타일 합치기/속성 태그/찾아 바꾸기" 키워드도 다른 모듈에 없다.
// 기존 대체 명령(그대로 둔다, 수정 안 함): workflows.js 의 textEditor(TEXTEDIT/FINDREPLACE/TEXTMERGE)·
//       TEXTAFFIX·TEXTSPLIT·TEXTMASK·TEXTSTYLEMERGE·ATTRIBUTETEXT. 이 11개는 그 명령들과 별개의 새 카드다.
// 문자 객체는 {type:'text',position,text,height,rotation,align,widthFactor?,textStyle?,sourceFont?,
// backgroundMask?,maskPadding?} 뿐이고 MTEXT·FIELD·ATTDEF·STYLE 테이블이 따로 없다(engine.js/view.js 전수
// 확인, 3차 text-edit-tools.js·2차 검증 보고서와 같은 결론). view.js:105 는 배경마스크 색을 캔버스
// 배경색으로 고정해 그리므로(수정 금지 파일) MSK 의 채움색/투명 옵션은 값은 저장되지만 화면에는 반영되지
// 않는다(TSA 가 글꼴을 저장만 하는 것과 같은 한계).
// 선택창 규칙(규칙서 11절): 옵션이 넷 이상인 ABE·TAP·TE 는 card-kit openCardDialog(slots:1, 한 화면,
// when 으로 항목 숨김)를 쓴다. FAR 는 다중 old/new 쌍 목록에 여러 줄 입력(textarea)이 꼭 필요한데
// card-kit 필드에는 textarea 가 없어(number/select/check/text/layer 뿐) ctx.form 을 그대로 쓴다(트임).
// 나머지(MSK CTX TD TM TSH TSM TSP)는 옵션을 셋 이하로 줄여 ctx.form 을 쓴다.
import * as G from './geometry.js';
import {STD_LAYERS, openCardDialog, entitiesSvg} from './card-kit.js';
import {findMatcher, matchOptions, textSlots, findAll, planSlotEdits, lockedBy, literalReplacer, slotBounds, SLOT_KIND_LABELS, MATCH_MODES, SCOPE_MODES} from './text-find.js';
// 522 찾기 공급자는 text-find.js 에 두고 여기서도 내보낸다(스펙의 import 경로).
export {findMatcher, textSlots, findAll} from './text-find.js';

/* ── 공용 ── */
const isText=e=>!!e&&e.type==='text';
function need(ctx){const texts=(ctx.selected()||[]).filter(isText);if(!texts.length)throw Error('문자를 먼저 선택하세요.');return texts;}
function needAtLeast(ctx,n){const texts=need(ctx);if(texts.length<n)throw Error(`문자를 ${n}개 이상 선택하세요.`);return texts;}
function inSelectionOrder(ctx,texts){
 const ids=typeof ctx.selectedIds==='function'?ctx.selectedIds():texts.map(e=>e.id);
 const rank=new Map(ids.map((id,i)=>[id,i]));
 return [...texts].sort((a,b)=>(rank.has(a.id)?rank.get(a.id):1e9)-(rank.has(b.id)?rank.get(b.id):1e9));
}
const upd=(e,changes)=>({type:'update',ids:[e.id],changes});
const exec=(ctx,commands)=>ctx.execute({type:'batch',commands});
const positive=(v,label)=>{const n=Number(v);if(!Number.isFinite(n)||n<=0)throw Error(`${label}은(는) 양수여야 합니다.`);return n;};
const nonNeg=(v,label)=>{const n=Number(v);if(!Number.isFinite(n)||n<0)throw Error(`${label}은(는) 0 이상이어야 합니다.`);return n;};
const on=v=>v==='on'||v===true;
const fail=(ctx,e)=>{console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);};
export function trimEdges(text){return String(text??'').trim();}

/* ══════════════════════════════════════════════════════════════════════════
   ABE · 속성블럭 문자 수정 (izzarder.com/537, xiAttBlkEdit)
   2차 검증에서 빠졌다고 한 것: 기존 ATTRIBUTETEXT(workflows.js:171)는 선택된 모든 블록에 "같은 값 1개"만
   일괄 대입한다. ABE 는 블록마다 자기 현재 값을 기준으로 숫자연산($n 사칙연산)·구분문자 재조합·축척연동
   (배율) 세 방식으로 "블록마다 다르게" 계산해 채운다. 태그선택/속성편집 서브다이얼로그, "블럭 속 블럭
   포함", 여러 파일(ObjectDBX)은 만들지 않는다(정직한 한계, 보고서에 적음).
   ══════════════════════════════════════════════════════════════════════════ */
// 앞의 '-'를 부호로 잡지 않는다("A-1"·"101-A-3" 같은 속성값은 하이픈이 구분자이지 음수가 아니다).
const NUM_RE_G=/\d+(?:\.\d+)?/g;
export function applyNumOp(value,rule){
 const s=String(value??'');
 if(!rule||!rule.trim())return s;
 const nums=[...s.matchAll(NUM_RE_G)];
 if(!nums.length)throw Error(`"${s}"에 숫자가 없습니다.`);
 const ops=[];
 for(const part of rule.split(',')){
  const m=/^\s*\$(\d+)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)\s*$/.exec(part);
  if(!m)throw Error(`숫자연산 규칙 "${part}" 형식이 잘못됐습니다(예: $1+2,$3*3).`);
  const idx=Number(m[1]);
  if(idx<1||idx>9)throw Error('숫자연산은 $1~$9까지만 지원합니다.');
  ops.push({idx,op:m[2],operand:Number(m[3])});
 }
 let out=s,shift=0;
 for(const {idx,op,operand} of ops){
  const token=nums[idx-1];
  if(!token)continue;
  const before=token[0],decimals=(before.split('.')[1]||'').length;
  let n=Number(before);
  n=op==='+'?n+operand:op==='-'?n-operand:op==='*'?n*operand:n/operand;
  const after=decimals?n.toFixed(decimals):String(Math.round(n));
  const at=token.index+shift;
  out=out.slice(0,at)+after+out.slice(at+before.length);
  shift+=after.length-before.length;
 }
 return out;
}
export function applyScaleRule(value,scaleX){
 const s=String(value??''),nums=[...s.matchAll(NUM_RE_G)];
 if(!nums.length)throw Error(`"${s}"에 숫자가 없습니다.`);
 const token=nums[0],before=token[0],decimals=(before.split('.')[1]||'').length||2;
 const after=(Number(before)*scaleX).toFixed(decimals);
 return s.slice(0,token.index)+after+s.slice(token.index+before.length);
}
export function applyDelimiterRule(value,delimiter,rule){
 const d=delimiter||',';
 const tokens=String(value??'').split(d);
 if(!rule||!rule.trim())return tokens.join(d);
 for(const part of rule.split(',')){
  const m=/^\s*\$(\d+)\s*([+\-*/])\s*(.+)$/.exec(part);
  if(!m)throw Error(`구분문자 규칙 "${part}" 형식이 잘못됐습니다(예: $1*2 또는 $2/찾을$바꿀).`);
  const idx=Number(m[1])-1,op=m[2],operand=m[3];
  if(idx<0||idx>=tokens.length)throw Error(`${idx+1}번째 조각이 없습니다(구분문자 "${d}" 기준 ${tokens.length}개).`);
  if(op==='/'){
   const parts=operand.split('$'),find=parts[0],replace=parts.length>1?parts[1]:'';
   tokens[idx]=find?tokens[idx].split(find).join(replace):tokens[idx];
  }else{
   const n=Number(tokens[idx]);
   if(!Number.isFinite(n))throw Error(`${idx+1}번째 조각 "${tokens[idx]}"은(는) 숫자가 아닙니다.`);
   tokens[idx]=String(op==='+'?n+Number(operand):op==='-'?n-Number(operand):n*Number(operand));
  }
 }
 return tokens.join(d);
}
function attrChildren(block){return (block.entities||[]).filter(c=>c.attributeTag);}
function runABE(ctx){
 try{
  const blocks=(ctx.selected()||[]).filter(e=>e.type==='block'&&attrChildren(e).length);
  if(!blocks.length)throw Error('속성 태그를 가진 블록을 선택하세요.');
  const tagSet=new Set();for(const b of blocks)for(const c of attrChildren(b))tagSet.add(c.attributeTag);
  const tags=[...tagSet];
  if(!tags.length)throw Error('블록에 속성 태그가 없습니다.');
  openCardDialog({
   ctx,title:`ABE · 속성블럭 문자 수정(블록 ${blocks.length}개, 태그 ${tags.length}종)`,storageKey:'card-abe-4',slots:1,
   fields:[
    {key:'tag',label:'고칠 태그',type:'select',def:tags[0],options:tags.map(t=>[t,t])},
    {key:'mode',label:'방식',type:'select',def:'direct',options:[['direct','직접 입력(모든 블록 같은 값)'],['numOp','숫자연산($n, 블록마다 자기 값 기준)'],['delim','구분문자 재조합(블록마다 자기 값 기준)'],['scale','축척 연동(첫 숫자 x 배율)']]},
    {key:'value',label:'입력 값',type:'text',def:'',when:v=>v.mode==='direct'},
    {key:'rule',label:'규칙(예: $1+2,$3*3 / $1*2 / $2/찾을$바꿀)',type:'text',def:'',when:v=>v.mode==='numOp'||v.mode==='delim'},
    {key:'delimiter',label:'구분문자',type:'text',def:',',when:v=>v.mode==='delim'},
    {key:'scaleX',label:'배율',type:'number',def:1,step:.1,min:.01,when:v=>v.mode==='scale'}
   ],
   preview:(v,shared,{width,height})=>entitiesSvg(blocks.flatMap(b=>attrChildren(b).filter(c=>c.attributeTag===v.tag)),{width,height,label:'태그 "'+v.tag+'" 문자'}),
   note:'숫자연산·구분문자재조합·축척연동은 블록마다 자기 현재 값을 기준으로 계산합니다(모든 블록에 같은 값을 넣는 것은 "직접 입력"입니다).',
   goLabel:'적용',
   validate:v=>{if((v.mode==='numOp'||v.mode==='delim')&&!v.rule.trim())throw Error('규칙을 입력하세요.');},
   onGo:v=>{
    const tag=v.tag,commands=[];let changed=0;
    for(const block of blocks){
     const child=attrChildren(block).find(c=>c.attributeTag===tag);
     if(!child)continue;
     const current=String(block.attributes?.[tag]??child.text??'');
     let next;
     if(v.mode==='direct')next=v.value;
     else if(v.mode==='numOp')next=applyNumOp(current,v.rule);
     else if(v.mode==='delim')next=applyDelimiterRule(current,v.delimiter,v.rule);
     else next=applyScaleRule(current,v.scaleX);
     if(next===current)continue;
     changed++;
     const attributes={...block.attributes,[tag]:next};
     const entities=(block.entities||[]).map(c=>c.attributeTag===tag?{...c,text:next}:c);
     commands.push(upd(block,{attributes,entities}));
    }
    if(!commands.length){ctx.toast('ABE · 바뀐 값이 없습니다.');return;}
    exec(ctx,commands);
    ctx.toast(`ABE · 블록 ${changed}개의 "${tag}" 값을 블록마다 개별 계산해 바꿨습니다 · Ctrl+Z 로 되돌리기`);
   }
  });
 }catch(e){fail(ctx,e);}
}

/* ══════════════════════════════════════════════════════════════════════════
   MSK · 다행문자 배경 넣기 (izzarder.com/585, xiMask)
   2차 검증에서 빠졌다고 한 것: 기존 TEXTMASK(workflows.js:170)는 on/off + 여백(mm)만 있고 채움색·투명
   옵션이 없다(배경색이 캔버스 배경색으로 고정). 이 카드는 채움색·투명을 추가한다 — 단 view.js:105 가
   배경을 항상 캔버스 배경색으로 그려(수정 금지 파일) 색상값은 저장만 되고 화면에는 반영되지 않는다.
   ══════════════════════════════════════════════════════════════════════════ */
function runMSK(ctx){
 try{
  const texts=need(ctx);
  ctx.form('MSK · 다행문자에 배경 넣기(간격·채움색)',[
   {name:'marginMul',label:'배경막 간격(문자 높이 배수, 원문 기본 1.5)',type:'number',value:1.5},
   {name:'transparent',label:'투명(채움색 없이 텍스트만 마스킹)',type:'checkbox'},
   {name:'color',label:'채움 색(투명이 아닐 때)',type:'color',value:'#ff0000'}
  ],values=>{
   const marginMul=nonNeg(values.marginMul,'배경막 간격'),transparent=on(values.transparent);
   const padding=marginMul*Math.max(...texts.map(e=>e.height||0),1);
   const commands=texts.map(e=>upd(e,{backgroundMask:true,maskPadding:padding,maskTransparent:transparent,maskColor:transparent?null:values.color}));
   exec(ctx,commands);
   ctx.toast(`MSK · 문자 ${commands.length}개에 배경을 넣었습니다(채움색·투명 값은 저장만 되고, 화면은 캔버스 배경색으로 고정 표시됩니다 · view.js 수정 금지라 그대로 둠) · Ctrl+Z 로 되돌리기`);
  });
 }catch(e){fail(ctx,e);}
}

/* ══════════════════════════════════════════════════════════════════════════
   CTX · 문자 수정 (izzarder.com/492, xiCTX)
   2차 검증에서 빠졌다고 한 것: 기존 TEXTEDIT 의 replace 액션은 확인 없이 즉시 전체 치환이라 CTX 의 핵심인
   "하나씩 확인 후 개별/전체 바꾸기"가 없다. 화면 확대(zoom) API 가 카드 문맥에 없어 "확대해서 보여준다"는
   흉내낼 수 없고, 대신 그 문자를 선택 상태로 만들고(ctx.setSelected) 폼 제목에 위치·순번을 보여준다(한계).
   모덜리스 대신 폼을 순차 재실행(recursive step)해 "하나씩 확인" 흐름을 만든다(3차 text-edit-tools.js 의
   TSE 순차편집과 같은 패턴).
   ══════════════════════════════════════════════════════════════════════════ */
// 522: 문자뿐 아니라 치수 문자·블록 속성·표 칸·블록 안 문자도 하나씩 확인한다(text-find.js 공급자). 잠긴 레이어는
// 건너뛰고 개수를 알린다. 카드 문맥에 zoomToBounds 가 있으면(app.js 연결) 그 위치로 확대해 보여 준다.
const slotId=s=>`${s.id}|${s.path.join('/')}|${s.key}`;
const scopeAll=ctx=>{const sel=ctx.selected()||[];return sel.length?sel:(ctx.entities()||[]);};
const entityById=(ctx,id)=>(ctx.entities()||[]).find(e=>e.id===id)||(ctx.selected()||[]).find(e=>e.id===id);
export function showSlot(ctx,slot){
 const e=entityById(ctx,slot.id);
 if(typeof ctx.setSelected==='function')ctx.setSelected([slot.id]);
 if(typeof ctx.zoomToBounds==='function'){const b=slotBounds(e,slot);if(b)try{ctx.zoomToBounds(b);}catch{}}
}
function runCTX(ctx){
 try{
  ctx.form('CTX · 찾을 문자(단계별 확인 후 바꾸기)',[
   {name:'find',label:'찾을 문자열',value:''},
   {name:'replace',label:'바꿀 문자열',value:''},
   {name:'match',label:'찾는 방식',value:'case',options:MATCH_MODES},
   {name:'scope',label:'찾을 곳',value:'all',options:SCOPE_MODES}
  ],values=>{
   const find=values.find;
   if(!find)throw Error('찾을 문자열을 입력하세요.');
   const re=findMatcher(find,matchOptions(values.match)),locked=lockedBy(ctx.layers?.());
   const found=findAll(scopeAll(ctx),re,{scope:values.scope}),matches=found.filter(s=>!locked(s)),lockedCount=found.length-matches.length;
   const lockedNote=lockedCount?` · 잠긴 레이어 ${lockedCount}곳은 건너뜀`:'';
   if(!matches.length){ctx.toast(`CTX · "${find}"을(를) 찾지 못했습니다${lockedNote}.`);return;}
   const editOf=(keys,replacement)=>{const r=literalReplacer(re,replacement);return s=>keys.has(slotId(s))?r(s.value):null;};
   const apply=(slots,replacement)=>{
    const ids=[...new Set(slots.map(s=>s.id))],current=ids.map(id=>entityById(ctx,id)).filter(Boolean);
    const plan=planSlotEdits(current,editOf(new Set(slots.map(slotId)),replacement),{locked,scope:values.scope});
    if(plan.updates.length)exec(ctx,plan.updates.map(u=>upd(u,u.changes)));
    return plan;
   };
   const step=i=>{
    if(i>=matches.length){ctx.toast(`CTX · 확인 ${matches.length}개를 모두 지났습니다${lockedNote}.`);return;}
    const slot=matches[i];
    showSlot(ctx,slot);
    ctx.form(`CTX · ${i+1}/${matches.length} · ${SLOT_KIND_LABELS[slot.kind]} · "${slot.value}"`,[
     {name:'action',label:'작업',value:'replace',options:[['replace','이것만 바꾸기'],['skip','건너뛰기'],['all','남은 것 전체 바꾸기'],['stop','그만두기']]},
     {name:'replace',label:'바꿀 문자열',value:values.replace}
    ],v=>{
     if(v.action==='stop'){ctx.toast('CTX · 그만뒀습니다.');return;}
     if(v.action==='all'){
      const rest=matches.slice(i),plan=apply(rest,v.replace);
      ctx.toast(`CTX · 나머지 ${plan.edits.length}곳을 모두 바꿨습니다${plan.guarded?` · 치수 측정값 자리(<>)를 지우는 ${plan.guarded}곳은 막음`:''}${lockedNote} · Ctrl+Z 로 되돌리기`);
      return;
     }
     if(v.action==='replace')apply([slot],v.replace);
     step(i+1);
    });
   };
   step(0);
  });
 }catch(e){fail(ctx,e);}
}

/* ══════════════════════════════════════════════════════════════════════════
   FAR · 문자 찾아 바꾸기 (izzarder.com/264, xiFindReplace)
   2차 검증에서 빠졌다고 한 것: 기존 FINDREPLACE(=TEXTEDIT replace)는 단일 find→단일 replace 하나뿐이다.
   여러 old/new 쌍 목록·리포트·정렬점/폭 자동보정을 채운다. 여러 파일(ObjectDBX) 일괄처리는 작업 지시에도
   "없음"으로 명시돼 있어 만들지 않는다(모형공간 하나만 대상). 다중 쌍 목록에는 여러 줄 입력(textarea)이
   꼭 필요한데 card-kit 필드(number/select/check/text/layer)에는 textarea 가 없어 openCardDialog 대신
   ctx.form 을 그대로 쓴다 — 규칙서 11절의 "옵션 셋 이하면 ctx.form" 기준보다 필드가 많지만(5개)
   textarea 필요성 때문에 트인 것으로, [이 높이만 검색]·[문자위치고정] 두 옵션은 빼 다섯 개로 줄였다.
   ══════════════════════════════════════════════════════════════════════════ */
export function autoShrinkWidth(oldText,newText,widthFactor){
 const a=String(oldText??'').length,b=String(newText??'').length;
 if(!b||b<=a)return widthFactor;
 const shrunk=Math.floor(widthFactor*(a/b)*100)/100;
 return Math.min(widthFactor,shrunk);
}
export function repositionForAlignFar(e,newAlign){
 const width=Math.max(String(e.text??'').split('\n').reduce((m,l)=>Math.max(m,l.length),1),1)*(e.height||0)*0.65*(e.widthFactor||1);
 const off=a=>a==='center'?-width/2:a==='right'?-width:0;
 const delta=off(e.align||'left')-off(newAlign);
 return delta?G.add(e.position,G.polar(delta,e.rotation||0)):{x:e.position.x,y:e.position.y};
}
export function parsePairs(rows){
 return String(rows??'').trim().split('\n').map(r=>r.split('\t')).filter(([o])=>o&&o.trim()).map(([o,n=''])=>[o,n]);
}
function runFAR(ctx){
 try{
  ctx.form('FAR · 문자 찾아 바꾸기(여러 쌍, 선택 없으면 도면 전체)',[
   {name:'pairs',label:'Old TAB New, 줄마다 한 쌍',type:'textarea',value:''},
   {name:'layerOnly',label:'이 켜만 검색(켜 이름, 비우면 전체)',value:''},
   {name:'scope',label:'찾을 곳',value:'all',options:SCOPE_MODES},
   {name:'report',label:'리포트 문자 생성',type:'checkbox'},
   {name:'align',label:'정렬점(문자 객체만 · 바꾼 뒤, 바뀌면 화면 위치는 유지)',value:'keep',options:[['keep','바꾸지 않음'],['left','좌'],['center','중'],['right','우']]},
   {name:'autoWidth',label:'폭 자동(문자 객체만 · 글자수 늘어나면 폭비율 축소, 줄면 안 건드림)',type:'checkbox'}
  ],values=>{
   const pairs=parsePairs(values.pairs);
   if(!pairs.length)throw Error('Old TAB New 형식으로 한 쌍 이상 입력하세요.');
   let pool=scopeAll(ctx);
   if(String(values.layerOnly||'').trim()){
    const layer=ctx.layers().find(l=>l.name===values.layerOnly.trim());
    if(!layer)throw Error(`켜 "${values.layerOnly}"를 찾지 못했습니다.`);
    pool=pool.filter(e=>e.layer===layer.id);
   }
   const swap=value=>{let next=value;for(const [o,n] of pairs)if(next.includes(o))next=next.split(o).join(n);return next;};
   const plan=planSlotEdits(pool,s=>swap(s.value),{locked:lockedBy(ctx.layers?.()),scope:values.scope});
   const byId=new Map(pool.map(e=>[e.id,e])),commands=[],report=plan.edits.map(s=>`${s.before} → ${s.after}`);
   for(const u of plan.updates){
    const e=byId.get(u.id),changes={...u.changes};
    if(e?.type==='text'&&typeof changes.text==='string'){
     if(values.align!=='keep'&&values.align!==(e.align||'left')){changes.position=repositionForAlignFar(e,values.align);changes.align=values.align;}
     if(on(values.autoWidth))changes.widthFactor=autoShrinkWidth(e.text,changes.text,e.widthFactor||1);
    }
    commands.push(upd(u,changes));
   }
   const notes=(plan.skippedLocked?` · 잠긴 레이어 ${plan.skippedLocked}곳은 건너뜀`:'')+(plan.guarded?` · 치수 측정값 자리(<>)를 지우는 ${plan.guarded}곳은 막음`:'');
   if(!commands.length){ctx.toast(`FAR · 바뀐 문자가 없습니다${notes}.`);return;}
   if(on(values.report)){
    const edited=pool.filter(e=>byId.has(e.id)&&plan.updates.some(u=>u.id===e.id));
    const b=G.bounds(edited)||{maxX:0,maxY:0},height=Math.max(...edited.map(e=>e.height||0),2.5)*0.7,layer=ctx.ensureLayer(STD_LAYERS.text,'#ffffff');
    commands.push({type:'addMany',entities:[{type:'text',layer,position:{x:b.maxX+height*10,y:b.maxY},height,rotation:0,align:'left',text:`FAR 리포트(${report.length}건)\n`+report.join('\n')}]});
   }
   exec(ctx,commands);
   ctx.toast(`FAR · ${commands.filter(c=>c.type==='update').length}개 객체 ${plan.edits.length}곳을 바꿨습니다${notes} · Ctrl+Z 로 되돌리기`);
  });
 }catch(e){fail(ctx,e);}
}

/* ══════════════════════════════════════════════════════════════════════════
   TAP · 문자에 접두어·접미어 넣기/빼기 (izzarder.com/539, xiTextAp)
   2차 검증에서 빠졌다고 한 것: 기존 TEXTAFFIX(workflows.js:168)는 "넣기"만 있다. "자르기(빼기)"(임의문자·
   문자갯수 기준), 특정 위치 삽입, 최근 입력 히스토리를 채운다. "임의문자로 자르기"·"문자갯수로 자르기"에
   앞/뒤 어느 쪽을 남길지는 원문 글에 명시가 없어(스크린샷 항목 이름만 확인됨) 둘 다 선택 가능하게 만들고
   가정임을 보고서에 적는다.
   ══════════════════════════════════════════════════════════════════════════ */
export function applyAffix(text,prefix,suffix){return `${prefix||''}${text}${suffix||''}`;}
export function cutByChar(text,cutChar,side,includeChar){
 const s=String(text??'');
 const i=cutChar?s.indexOf(cutChar):-1;
 if(i<0)return s;
 if(side==='back')return includeChar?s.slice(i+cutChar.length):s.slice(i);
 return includeChar?s.slice(0,i):s.slice(0,i+cutChar.length);
}
export function cutByCount(text,count,side){
 const s=String(text??''),n=Math.min(Math.max(0,Math.round(Number(count))||0),s.length);
 return side==='back'?s.slice(0,s.length-n):s.slice(n);
}
export function insertAtPosition(text,side,index,insert){
 const s=String(text??''),i=side==='back'?Math.max(0,s.length-(index-1)):Math.min(s.length,index-1);
 return s.slice(0,i)+String(insert??'')+s.slice(i);
}
export function insertAtChar(text,targetChar,side,insert){
 if(!targetChar)throw Error('특정문자를 입력하세요.');
 const s=String(text??'');
 let out='',i=0,found=false;
 while(i<s.length){
  const at=s.indexOf(targetChar,i);
  if(at<0){out+=s.slice(i);break;}
  found=true;
  out+=side==='front'?s.slice(i,at)+insert+targetChar:s.slice(i,at)+targetChar+insert;
  i=at+targetChar.length;
 }
 if(!found)throw Error(`"${s}"에 "${targetChar}"가 없습니다.`);
 return out;
}
const TAP_HISTORY_KEY='card-tap-4-history';
function loadTapHistory(ctx){try{return JSON.parse(ctx.storage?.getItem(TAP_HISTORY_KEY)||'[]');}catch{return [];}}
function saveTapHistory(ctx,prefix,suffix){
 if(!prefix&&!suffix)return;
 const list=loadTapHistory(ctx).filter(h=>!(h.prefix===prefix&&h.suffix===suffix));
 list.unshift({prefix,suffix});
 try{ctx.storage?.setItem(TAP_HISTORY_KEY,JSON.stringify(list.slice(0,5)));}catch{}
}
function runTAP(ctx){
 try{
  const texts=need(ctx);
  const history=loadTapHistory(ctx);
  const histOptions=[['','(직접 입력)'],...history.map((h,i)=>[String(i),`${h.prefix||''}…${h.suffix||''}`])];
  openCardDialog({
   ctx,title:`TAP · 문자 접두어·접미어 넣기/빼기(문자 ${texts.length}개)`,storageKey:'card-tap-4',slots:1,
   fields:[
    {key:'trimSpace',label:'앞뒤 공백 없애기',type:'check',def:false},
    {key:'mode',label:'넣기/자르기',type:'select',def:'insert',options:[['insert','넣기(접두·접미)'],['cutChar','임의문자로 자르기'],['cutCount','문자갯수로 자르기']]},
    {key:'history',label:'최근 사용',type:'select',def:'',options:histOptions,when:v=>v.mode==='insert'},
    {key:'prefix',label:'접두어',type:'text',def:'',when:v=>v.mode==='insert'},
    {key:'suffix',label:'접미어',type:'text',def:'',when:v=>v.mode==='insert'},
    {key:'cutChar',label:'자를 기준 문자',type:'text',def:'',when:v=>v.mode==='cutChar'},
    {key:'cutSide',label:'남길 쪽',type:'select',def:'front',options:[['front','앞부분'],['back','뒷부분']],when:v=>v.mode==='cutChar'||v.mode==='cutCount'},
    {key:'includeChar',label:'입력문자 포함 자르기',type:'check',def:false,when:v=>v.mode==='cutChar'},
    {key:'cutCount',label:'자를 문자 갯수',type:'number',def:1,min:0,when:v=>v.mode==='cutCount'},
    {key:'posOn',label:'특정 위치에 넣기',type:'check',def:false},
    {key:'posSide',label:'위치 기준',type:'select',def:'front',options:[['front','앞에서 N번째'],['back','뒤에서 N번째']],when:v=>v.posOn},
    {key:'posIndex',label:'번째에',type:'number',def:1,min:1,when:v=>v.posOn},
    {key:'posText',label:'삽입할 문자(위치)',type:'text',def:'',when:v=>v.posOn},
    {key:'atChar',label:'특정문자 기준 넣기: 문자',type:'text',def:''},
    {key:'atSide',label:'특정문자 앞/뒤',type:'select',def:'front',options:[['front','앞에'],['back','뒤에']],when:v=>!!v.atChar},
    {key:'atText',label:'삽입할 문자(특정문자)',type:'text',def:'',when:v=>!!v.atChar}
   ],
   preview:(v,shared,{width,height})=>entitiesSvg(texts,{width,height,label:texts.length+'개 문자'}),
   note:'문장 내 동일 특정문자가 여러 개면 모두 찾아 넣습니다(원문과 같음).',
   goLabel:'적용',
   onGo:v=>{
    let prefix=v.prefix,suffix=v.suffix;
    if(v.history){const h=history[Number(v.history)];if(h){prefix=h.prefix;suffix=h.suffix;}}
    const commands=texts.map(e=>{
     let text=e.text;
     if(v.trimSpace)text=trimEdges(text);
     if(v.mode==='insert'&&(prefix||suffix))text=applyAffix(text,prefix,suffix);
     else if(v.mode==='cutChar'&&v.cutChar)text=cutByChar(text,v.cutChar,v.cutSide,v.includeChar);
     else if(v.mode==='cutCount')text=cutByCount(text,v.cutCount,v.cutSide);
     if(v.posOn&&v.posText)text=insertAtPosition(text,v.posSide,v.posIndex,v.posText);
     if(v.atChar&&v.atText)text=insertAtChar(text,v.atChar,v.atSide,v.atText);
     return {e,text};
    }).filter(({e,text})=>text!==e.text).map(({e,text})=>upd(e,{text}));
    if(!commands.length){ctx.toast('TAP · 바뀐 문자가 없습니다.');return;}
    if(v.mode==='insert'&&(prefix||suffix))saveTapHistory(ctx,prefix,suffix);
    exec(ctx,commands);
    ctx.toast(`TAP · 문자 ${commands.length}개를 바꿨습니다 · Ctrl+Z 로 되돌리기`);
   }
  });
 }catch(e){fail(ctx,e);}
}

/* ══════════════════════════════════════════════════════════════════════════
   TD · 문자열 잘라 새 문자열 (izzarder.com/540, xiTextDivide)
   2차 검증에서 빠졌다고 한 것: 기존 TEXTSPLIT(workflows.js:169)은 구분자로 전체를 여러 조각으로 나눠
   항상 새 개체만 만든다. TD 는 클릭 위치 1곳을 기준으로 1회만 자르고, 잘라낸 뒤쪽 조각을 다른 문자열의
   앞/뒤에 합치거나(대상 지정) 새 문자열을 만든다(대상 없이 클릭). 절단 위치는 3차 text-edit-tools.js 의
   textWidth 와 같은 식(글자수×높이×0.65×폭비율)으로 근사한다.
   ══════════════════════════════════════════════════════════════════════════ */
export function localCharWidth(e){return (e.height||0)*0.65*(e.widthFactor||1);}
export function charIndexAtLocalX(e,localX){
 const w=localCharWidth(e)||1,text=String(e.text??''),start=e.align==='center'?-text.length*w/2:e.align==='right'?-text.length*w:0;
 return Math.max(0,Math.min(text.length,Math.round((localX-start)/w)));
}
export function splitAt(text,index){const s=String(text??'');return [s.slice(0,index),s.slice(index)];}
export function joinPieces(a,b,between,trimA,trimB){
 return (trimA?trimEdges(a):String(a??''))+String(between??'')+(trimB?trimEdges(b):String(b??''));
}
function localXOf(e,point){
 const rad=-(e.rotation||0)*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad);
 const dx=point.x-e.position.x,dy=point.y-e.position.y;
 return dx*c-dy*s;
}
async function runTD(ctx){
 try{
  const source=await ctx.pickEntity({prompt:'TD · 자를 문자를 선택하세요 · Esc 취소',types:['text']});
  if(!source)return;
  const cutPoint=await ctx.pickPoint('TD · 자를 위치를 문자 위에서 클릭하세요(그 위치부터 뒤가 잘립니다) · Esc 취소');
  if(!cutPoint)return;
  const index=charIndexAtLocalX(source,localXOf(source,cutPoint));
  const [front,piece]=splitAt(source.text,index);
  if(!piece){ctx.toast('TD · 문자열 맨 끝을 클릭했습니다. 잘라낼 부분이 없습니다.',true);return;}
  const targetPoint=await ctx.pickPoint('TD · 붙일 대상 문자열을 클릭하세요(대상 없이 클릭: 새 문자열 생성) · Esc 취소');
  if(!targetPoint)return;
  const tol=Math.max(ctx.tolerance?ctx.tolerance():5,localCharWidth(source)*8);
  const near=(ctx.entities()||[]).filter(isText).filter(e=>e.id!==source.id)
   .map(e=>({e,d:G.dist(e.position,targetPoint)})).sort((a,b)=>a.d-b.d)[0];
  const target=near&&near.d<tol?near.e:null;
  ctx.form('TD · 문자열 나누기 설정',[
   {name:'keepSource',label:'원본 문자열 유지(잘라낸 부분을 지우지 않음)',type:'checkbox'},
   {name:'between',label:'사이문자(합칠 때)',value:' '},
   {name:'trimBoth',label:'조각 앞뒤 공백 제거',type:'checkbox',value:'on'}
  ],values=>{
   const trim=on(values.trimBoth),between=values.between;
   const commands=[];
   if(!on(values.keepSource))commands.push(upd(source,{text:trim?trimEdges(front):front}));
   if(target){
    const idx=charIndexAtLocalX(target,localXOf(target,targetPoint));
    const frontHalf=idx<target.text.length/2;
    const merged=frontHalf?joinPieces(piece,target.text,between,trim,trim):joinPieces(target.text,piece,between,trim,trim);
    commands.push(upd(target,{text:merged}));
   }else{
    const pieceText=trim?trimEdges(piece):piece;
    commands.push({type:'addMany',entities:[{type:'text',layer:source.layer,position:{x:targetPoint.x,y:targetPoint.y},height:source.height,rotation:source.rotation||0,align:source.align||'left',text:pieceText}]});
   }
   exec(ctx,commands);
   ctx.toast(`TD · 문자열을 잘라 ${target?'대상 문자열에 합쳤습니다':'새 문자열을 만들었습니다'} · Ctrl+Z 로 되돌리기`);
  });
 }catch(e){fail(ctx,e);}
}

/* ══════════════════════════════════════════════════════════════════════════
   TE · 문자 종합수정 (izzarder.com/204, xiTextEdit)
   2차 검증에서 빠졌다고 한 것: 기존 TEXTEDIT 6액션은 내용(문자열) 치환/번호/증감/병합/개수/이름지정뿐이다.
   높이·색·폭·각도·모양(스타일 이름)·켜를 조건검색 후 선택적으로 바꾸는 것과 대소문자 변환을 채운다.
   "모양"은 TSA·TST 와 같은 이유로 textStyle 저장값만 바뀌고 화면 글꼴은 고정이다(한계).
   ══════════════════════════════════════════════════════════════════════════ */
const TE_PROPS=[['content','내용','text'],['style','모양(글꼴 이름)','text'],['layer','켜','layer'],['color','색(#rrggbb)','text'],['height','높이(mm)','number'],['widthFactor','폭비율','number'],['rotation','각도(도)','number']];
function teGroup(prefix,label){
 return TE_PROPS.flatMap(([key,klabel,type])=>[
  {key:prefix+key+'On',label:klabel,type:'check',def:false,group:label},
  {key:prefix+key,label:klabel+' 값',type,def:type==='number'?0:'',group:label,when:v=>v[prefix+key+'On']}
 ]);
}
export function teFields(){
 return [
  ...teGroup('f','기존값(검색 조건 · 선택 없으면 전체 대상)'),
  ...teGroup('c','변경 값(체크한 항목만 바뀜)'),
  {key:'caseOn',label:'대소문자 변경(켜면 변경값 내용은 무시)',type:'check',def:false,group:'대소문자'},
  {key:'caseMode',label:'방식',type:'select',def:'word',options:[['sentence','문장 첫 글자'],['word','단어 첫 글자'],['upper','대문자'],['lower','소문자']],group:'대소문자',when:v=>v.caseOn}
 ];
}
export function matchesFilter(e,filters){
 for(const [key] of TE_PROPS){
  const f=filters[key];if(!f||!f.on)continue;
  if(key==='content'&&!e.text.includes(f.value))return false;
  if(key==='style'&&(e.textStyle||'')!==f.value)return false;
  if(key==='layer'&&e.layer!==f.value)return false;
  if(key==='color'&&(e.color||'')!==f.value)return false;
  if(key==='height'&&Math.abs((e.height||0)-Number(f.value))>1e-6)return false;
  if(key==='widthFactor'&&Math.abs((e.widthFactor||1)-Number(f.value))>1e-6)return false;
  if(key==='rotation'&&Math.abs((e.rotation||0)-Number(f.value))>1e-6)return false;
 }
 return true;
}
export function applyCase(text,mode){
 const s=String(text??'');
 if(mode==='upper')return s.toUpperCase();
 if(mode==='lower')return s.toLowerCase();
 if(mode==='word')return s.replace(/[A-Za-z][A-Za-z']*/g,w=>w[0].toUpperCase()+w.slice(1).toLowerCase());
 if(mode==='sentence'){
  let out='',cap=true;
  for(const ch of s){
   if(/[A-Za-z]/.test(ch)){out+=cap?ch.toUpperCase():ch.toLowerCase();cap=false;}
   else{out+=ch;if(/[.!?]/.test(ch))cap=true;}
  }
  return out;
 }
 return s;
}
export function buildChanges(e,change,caseMode){
 const out={};
 if(caseMode)out.text=applyCase(e.text,caseMode);
 else if(change.content?.on)out.text=change.content.value;
 if(change.style?.on){out.textStyle=change.style.value;out.sourceFont=change.style.value;}
 if(change.layer?.on)out.layer=change.layer.value;
 if(change.color?.on)out.color=change.color.value;
 if(change.height?.on)out.height=Number(change.height.value);
 if(change.widthFactor?.on)out.widthFactor=Number(change.widthFactor.value);
 if(change.rotation?.on)out.rotation=Number(change.rotation.value);
 return out;
}
function runTE(ctx){
 try{
  const sel=(ctx.selected()||[]).filter(isText);
  const scopeAll=sel.length?sel:(ctx.entities()||[]).filter(isText);
  if(!scopeAll.length)throw Error('문자가 없습니다.');
  openCardDialog({
   ctx,title:`TE · 문자종합수정(선택 없으면 도면 전체 ${scopeAll.length}개)`,storageKey:'card-te-4',slots:1,
   fields:teFields(),
   preview:(v,shared,{width,height})=>entitiesSvg(scopeAll.slice(0,80),{width,height,label:scopeAll.length+'개 대상'}),
   note:'모양(글꼴)은 이름만 저장되고 화면 글꼴은 고정이라 반영되지 않습니다.',
   goLabel:'적용',
   onGo:v=>{
    const filters={},change={};
    for(const [key] of TE_PROPS){filters[key]={on:!!v['f'+key+'On'],value:v['f'+key]};change[key]={on:!!v['c'+key+'On'],value:v['c'+key]};}
    if(filters.layer.on){const l=ctx.layers().find(x=>x.name===filters.layer.value);filters.layer.value=l?l.id:'\0';}
    if(change.layer.on)change.layer.value=ctx.ensureLayer(change.layer.value||STD_LAYERS.text,'#ffffff');
    const caseMode=v.caseOn?v.caseMode:null;
    const targets=scopeAll.filter(e=>matchesFilter(e,filters));
    if(!targets.length){ctx.toast('TE · 조건에 맞는 문자가 없습니다.');return;}
    const commands=targets.map(e=>upd(e,buildChanges(e,change,caseMode))).filter(c=>Object.keys(c.changes).length);
    if(!commands.length){ctx.toast('TE · [변경 값]에서 바꿀 항목을 하나 이상 선택하세요.',true);return;}
    exec(ctx,commands);
    ctx.toast(`TE · 문자 ${commands.length}개를 수정했습니다 · Ctrl+Z 로 되돌리기`);
   }
  });
 }catch(e){fail(ctx,e);}
}

/* ══════════════════════════════════════════════════════════════════════════
   TM · 문자열 병합 (izzarder.com/368, xiTextMerge)
   2차 검증에서 빠졌다고 한 것: 기존 TEXTMERGE(workflows.js:164→21-41)는 구분자를 고를 수 없고(항상 공백
   1개), "새로운 문자열 생성" 옵션이 없으며, 같은-줄 자동 그룹핑만 있어 정렬 순서 4아이콘(Z/역S/N/역N)이
   없다. 이 셋을 채운다. 오차(mm)는 항목 수를 셋으로 줄이려 10mm 로 고정했다(보고서에 적음).
   ══════════════════════════════════════════════════════════════════════════ */
const TM_TOLERANCE=10;
export function orderTexts(texts,order,tolerance=TM_TOLERANCE){
 if(order==='selection')return texts;
 const byRow=()=>{const rows=[];for(const e of texts){let row=rows.find(r=>Math.abs(r[0].position.y-e.position.y)<tolerance);if(!row){row=[];rows.push(row);}row.push(e);}rows.sort((a,b)=>b[0].position.y-a[0].position.y);for(const row of rows)row.sort((a,b)=>a.position.x-b.position.x);return rows;};
 const byCol=()=>{const cols=[];for(const e of texts){let col=cols.find(c=>Math.abs(c[0].position.x-e.position.x)<tolerance);if(!col){col=[];cols.push(col);}col.push(e);}return cols;};
 if(order==='z')return byRow().flat();
 if(order==='reverseZ'){const rows=byRow();rows.reverse();for(const row of rows)row.reverse();return rows.flat();}
 if(order==='n'){const cols=byCol();cols.sort((a,b)=>a[0].position.x-b[0].position.x);for(const col of cols)col.sort((a,b)=>b.position.y-a.position.y);return cols.flat();}
 if(order==='reverseN'){const cols=byCol();cols.sort((a,b)=>b[0].position.x-a[0].position.x);for(const col of cols)col.sort((a,b)=>a.position.y-b.position.y);return cols.flat();}
 return byRow().flat();
}
export function mergeContents(texts,delimiter){return texts.map(e=>e.text).join(delimiter);}
function runTM(ctx){
 try{
  const texts=needAtLeast(ctx,2);
  ctx.form('TM · 문자열 합치기',[
   {name:'delimiter',label:'합치는 문자열 사이 문자(기본 공백 1개)',value:' '},
   {name:'newString',label:'새로운 문자열 생성(화면에서 위치 지정, 끄면 첫 문자 재사용)',type:'checkbox'},
   {name:'order',label:'정렬순서(오차 10mm 고정)',value:'z',options:[['selection','선택순'],['z','지그재그(Z, 위→아래 각 줄 좌→우)'],['reverseZ','역S(아래→위 각 줄 우→좌)'],['n','N(좌→우 각 열 위→아래)'],['reverseN','역N(우→좌 각 열 아래→위)']]}
  ],async values=>{
   const ordered=orderTexts(inSelectionOrder(ctx,texts),values.order);
   const merged=mergeContents(ordered,values.delimiter);
   const commands=[{type:'delete',ids:ordered.map(e=>e.id)}];
   if(on(values.newString)){
    const p=await ctx.pickPoint('TM · 새 문자열을 놓을 위치를 클릭하세요 · Esc 취소');
    if(!p)return;
    commands.push({type:'addMany',entities:[{type:'text',layer:ordered[0].layer,position:{x:p.x,y:p.y},height:ordered[0].height,rotation:ordered[0].rotation||0,align:ordered[0].align||'left',text:merged}]});
   }else{
    commands.push({type:'addMany',entities:[{...ordered[0],id:undefined,text:merged}]});
   }
   exec(ctx,commands);
   ctx.toast(`TM · 문자 ${ordered.length}개를 "${merged}"로 합쳤습니다 · Ctrl+Z 로 되돌리기`);
  });
 }catch(e){fail(ctx,e);}
}

/* ══════════════════════════════════════════════════════════════════════════
   TSH · 문자 음영(그림자) (izzarder.com/531, xiTextShadow)
   원문은 "문자를 익스플로드한 뒤 폭만큼 솔리드 그림자를 문자 아래에 만드는" 명령이다(2차 검증 보고서는
   MSK 와 같은 배경마스크로 추정했으나 원문을 직접 읽어보니 다른 명령 — 원문이 우선). 우리 엔진에는 문자
   익스플로드(폰트 윤곽선 추출)가 없어 글자 모양 그대로의 그림자는 만들 수 없다(정직한 한계) — 대신 문자
   바운딩박스 크기의 솔리드 해치(hatch, solid:true)를 지정한 폭·각도만큼 오프셋해 원본 문자 "뒤"(먼저
   추가되도록 원본을 지웠다 나중에 다시 추가)에 깔아 "솔리드 그림자"라는 목적에 최대한 가깝게 만든다.
   ══════════════════════════════════════════════════════════════════════════ */
export function shadowRect(e,width,angleDeg){
 const w=Math.max(String(e.text??'').split('\n').reduce((m,l)=>Math.max(m,l.length),1),1)*(e.height||0)*0.65*(e.widthFactor||1);
 const h=(e.height||0)*1.2;
 const off=G.polar(width,angleDeg);
 const cx=e.position.x+(e.align==='center'?0:e.align==='right'?-w/2:w/2)+off.x;
 const cy=e.position.y+h*0.1+off.y;
 return G.rectangle({x:cx-w/2,y:cy-h/2},{x:cx+w/2,y:cy+h/2});
}
function runTSH(ctx){
 try{
  const texts=need(ctx);
  ctx.form('TSH · 문자에 솔리드 음영(그림자) 넣기',[
   {name:'width',label:'그림자 폭(mm)',type:'number',value:Math.max(...texts.map(e=>e.height||0),2.5)*0.3},
   {name:'angle',label:'그림자 방향(도, 기본 -45=우하단)',type:'number',value:-45},
   {name:'color',label:'그림자 색',type:'color',value:'#808080'}
  ],values=>{
   const width=positive(values.width,'그림자 폭'),layer=ctx.ensureLayer(STD_LAYERS.text,'#808080');
   const shadows=texts.map(e=>({type:'hatch',layer,points:shadowRect(e,width,Number(values.angle)),loops:[],pattern:'solid',solid:true,spacing:100,hatchScale:1,angle:0,color:values.color}));
   const ids=texts.map(e=>e.id),originals=texts.map(({id,...rest})=>rest);
   exec(ctx,[{type:'delete',ids},{type:'addMany',entities:[...shadows,...originals]}]);
   ctx.toast(`TSH · 문자 ${texts.length}개 뒤에 솔리드 그림자를 넣었습니다(글자 모양이 아닌 문자 영역 사각 음영으로 근사) · Ctrl+Z 로 되돌리기`);
  });
 }catch(e){fail(ctx,e);}
}

/* ══════════════════════════════════════════════════════════════════════════
   TSM · 문자 스타일(모양) 병합 (izzarder.com/97, xiStyleMerge)
   2차 검증에서 빠졌다고 한 것: 기존 TEXTSTYLEMERGE(workflows.js:167)는 "선택된 문자 두 개 이상" 사이에서
   첫 문자의 속성을 나머지에 복사할 뿐이다. 원문은 STYLE 테이블에서 "여러 모양 이름을 하나로 병합 후
   퍼지"인데 우리 엔진엔 STYLE 테이블이 없어(textStyle 은 문자마다 붙는 이름표일 뿐) 도면 전체 문자를
   대상으로 "여러 모양 이름 → 하나의 이름"으로 통일하는 것으로 다시 만든다(TSA 와 같은 범위). "퍼지"는
   대응 개체가 없어 항상 생략한다(정직한 한계).
   ══════════════════════════════════════════════════════════════════════════ */
export function parseNameList(text){return String(text??'').split(/[,\n]/).map(s=>s.trim()).filter(Boolean);}
export function styleNameOf(e){return e.textStyle||'Standard';}
function runTSM(ctx){
 try{
  const all=(ctx.entities()||[]).filter(isText);
  if(!all.length)throw Error('문자가 없습니다.');
  const names=[...new Set(all.map(styleNameOf))].sort();
  ctx.form(`TSM · 문자 모양 합치기(도면 전체 ${all.length}개 문자, 현재 모양 ${names.length}종: ${names.join(', ')})`,[
   {name:'merge',label:'합칠 모양 이름(콤마 또는 줄바꿈으로 여러 개)',type:'textarea',value:names.slice(0,Math.max(1,names.length-1)).join(', ')},
   {name:'target',label:'대상 모양(하나)',value:names.at(-1)||'Standard',options:names.map(n=>[n,n])}
  ],values=>{
   const merge=new Set(parseNameList(values.merge));
   if(!merge.size)throw Error('합칠 모양을 하나 이상 입력하세요.');
   merge.delete(values.target);
   const targets=all.filter(e=>merge.has(styleNameOf(e)));
   if(!targets.length){ctx.toast('TSM · 합칠 대상 문자가 없습니다(이름을 확인하세요).');return;}
   const ref=all.find(e=>styleNameOf(e)===values.target);
   const commands=targets.map(e=>upd(e,{textStyle:values.target,...(ref?{sourceFont:ref.sourceFont,widthFactor:ref.widthFactor}:{})}));
   exec(ctx,commands);
   ctx.toast(`TSM · 모양 ${merge.size}종(${[...merge].join(', ')}) → "${values.target}" 로 문자 ${commands.length}개를 합쳤습니다(STYLE 테이블이 없어 "퍼지"는 생략) · Ctrl+Z 로 되돌리기`);
  });
 }catch(e){fail(ctx,e);}
}

/* ══════════════════════════════════════════════════════════════════════════
   TSP · 문자열 분리 (izzarder.com/605, xiTextSeparate)
   2차 검증에서 빠졌다고 한 것: 기존 TEXTSPLIT(workflows.js:169)은 항상 구분자를 삭제한다. "기준문자
   삭제하지 않음"(구분자 보존) 옵션을 채운다. 구분자를 남기면 앞 조각 끝에 붙인다 — 원문 게시글에 조각의
   어느 쪽에 붙는지까지는 명시가 없어(첨부 이미지에도 없음) 택한 가정이며 보고서에 적는다.
   ══════════════════════════════════════════════════════════════════════════ */
export function splitPreserving(text,baseChar,keep){
 const s=String(text??''),sep=baseChar||'  ';
 if(!sep)return [s];
 const out=[];let i=0;
 while(true){
  const at=s.indexOf(sep,i);
  if(at<0){out.push(s.slice(i));break;}
  out.push(s.slice(i,at)+(keep?sep:''));
  i=at+sep.length;
 }
 return out.filter(p=>p!=='');
}
function runTSP(ctx){
 try{
  const texts=need(ctx);
  ctx.form('TSP · 문자열 분리(기준문자로 여러 문자 객체로)',[
   {name:'baseChar',label:'기준 문자(기본은 화면에 안 보이는 공백 2개)',value:'  '},
   {name:'gap',label:'간격(문자높이 배수)',type:'number',value:2},
   {name:'keepChar',label:'기준문자 삭제하지 않음(조각 앞에 붙여 보존)',type:'checkbox'}
  ],values=>{
   const gapMul=positive(values.gap,'간격'),keep=on(values.keepChar);
   const commands=[],added=[];let total=0;
   for(const e of texts){
    const pieces=splitPreserving(e.text,values.baseChar,keep);
    if(pieces.length<2)continue;
    total+=pieces.length;
    // 다음 조각 = 앞 조각 글자 폭 + 간격(글자 높이×배수). 예전엔 간격만 더해 조각이 겹쳐 붙어 보였다(2026-10-27 설명서 시험).
    const gap=(e.height||0)*gapMul,dir=G.polar(1,e.rotation||0);
    commands.push(upd(e,{text:pieces[0]}));
    let along=0;
    for(let i=1;i<pieces.length;i++){along+=G.textBoxWidth({...e,text:pieces[i-1]})+gap;added.push({...e,id:undefined,text:pieces[i],position:G.add(e.position,G.mul(dir,along))});}
   }
   if(!total){ctx.toast('TSP · 나눌 수 있는 문자가 없습니다(기준 문자를 확인하세요).',true);return;}
   if(added.length)commands.push({type:'addMany',entities:added});
   exec(ctx,commands);
   ctx.toast(`TSP · 문자 ${total}개 조각으로 나눴습니다(${keep?'기준문자 보존':'기준문자 삭제'}) · Ctrl+Z 로 되돌리기`);
  });
 }catch(e){fail(ctx,e);}
}

/* ── 설치 ── */
export function installTextEditTools4(ctx){
 return {
  ABE:()=>runABE(ctx), MSK:()=>runMSK(ctx), CTX:()=>runCTX(ctx), FAR:()=>runFAR(ctx),
  TAP:()=>runTAP(ctx), TD:()=>runTD(ctx), TE:()=>runTE(ctx), TM:()=>runTM(ctx),
  TSH:()=>runTSH(ctx), TSM:()=>runTSM(ctx), TSP:()=>runTSP(ctx)
 };
}
