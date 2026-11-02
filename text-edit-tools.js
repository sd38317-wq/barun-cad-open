// 문자 수정 18개(A2M FTT MDF T2M TFF FAM TC TJ TO TOA TS TSA TSE TSO TST TSW TW TEC) 카드.
// 근거: docs/izzarder-reference-20260921/references/11-text-edit.md + reports/2차_매핑검증_A_보고_20260921.md
//       "7. 문자 수정"(원문 대신 TEXTEDIT/TALIGN/TBOX/FINDREPLACE/ATTRIBUTETEXT 로 뭉뚱그려 매핑된 문제를 지적한 조사).
//       원문 WebFetch: A2M izzarder.com/533, FTT /524, MDF /205, T2M /366, TFF /462, FAM /454, TC /318, TJ /594,
//       TO /104, TOA /92, TS /593, TSA /263, TSE /380, TSO /334, TST /361, TSW /445, TW /595.
//       TEC 는 원문 글이 없다(정리본 11-text-edit.md 27개 항목에 없고, WebSearch site:izzarder.com 로도 못 찾음) —
//       카탈로그 한 줄 설명 "문자의 일부 복사"만으로 추정 구현했다(코드·보고서 모두 "추정"이라 적는다).
// 바른 CAD 문자 객체는 {position,text,height,rotation,align,widthFactor?,textStyle?,sourceFont?,sourceBigFont?,
// backgroundMask?,maskPadding?} 뿐이고 MTEXT·FIELD·ATTDEF 개체 타입이 따로 없다(engine.js/view.js 전수 확인,
// 2차 매핑검증 보고서와 같은 결론). align 은 수평(left/center/right)만 있고 렌더링(view.js:96-109)은 항상
// baseline 고정이라, 원문 9방향 정렬점 중 수직 요소는 이 엔진에서 뜻이 없다(TJ·TOA에서 그대로 반영).
// textStyle/sourceFont/sourceBigFont 는 기존 TEXTSTYLEMERGE(workflows.js:167)처럼 저장은 되지만 view.js가
// 고정 글꼴(DRAWING_FONT_FAMILY)만 그려 화면에는 반영되지 않는다 — 새로 생긴 한계가 아니라 이미 있던 한계다.
import * as G from './geometry.js';
import {STD_LAYERS} from './card-kit.js';

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
const stripSpace=s=>String(s??'').replace(/\s+/g,'');
const fail=(ctx,e)=>{console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);};

/* ══ FTT · 필드 고정 (2026-09-24). 문자 하나에서 필드 흔적을 지우고 고정 문자열로 바꾼다. ══ */
const FIELD_RE=/%<([\s\S]*?)>%/g;
const pad2=n=>String(n).padStart(2,'0');
/** 지금 값으로 평가할 수 있는 필드만 문자열을 돌려준다. 그 밖(CreateDate·객체 속성 등)은 캐시값을 알 수 없어 null(원문 그대로 둔다 · 검토자 지적 13). */
export function evaluateFieldCode(code,now=new Date()){
 const s=String(code||'');
 if(/\\AcVar\s+(Date|SaveDate|PlotDate)\b/i.test(s))return `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`;
 if(/\\AcVar\s+(Time)\b/i.test(s))return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
 return null;
}
/** 평가 가능한 필드만 바꾼다. 바뀐 것이 없으면 null. 평가 못 한 필드 수는 freezeFieldText.skipped 로 셀 수 있다. */
export function freezeFieldText(text,now){
 const s=String(text??'');
 if(!FIELD_RE.test(s))return null;
 FIELD_RE.lastIndex=0;
 let changed=0,skipped=0;
 const out=s.replace(FIELD_RE,(m,code)=>{const v=evaluateFieldCode(code,now);if(v===null){skipped++;return m;}changed++;return v;});
 freezeFieldText.skipped=skipped;
 return changed?out:null;
}
/** 객체 하나의 필드 흔적을 고정하는 변경. 블록·표 안의 문자는 entities 배열을 통째로 바꾼다. 없으면 null. */
export function freezeFieldEntity(e,{plain=true,inBlocks=true,inTables=true}={},now=new Date()){
 if(!e||typeof e!=='object')return null;
 if(e.type==='text'){
  if(!plain)return null;
  const changes={};let count=0;
  const frozen=freezeFieldText(e.text,now);
  if(frozen!==null){changes.text=frozen;count++;}
  if(e.darSourceId!==undefined){changes.darSourceId=null;count++;}
  for(const key of ['field','fieldCode','fieldExpression','liveValue'])if(e[key]!==undefined){changes[key]=null;count++;}
  return count?{changes,count}:null;
 }
 if(e.type==='block'&&Array.isArray(e.entities)){
  const isTable=!!e.table;
  if(isTable?!inTables:!inBlocks)return null;
  let count=0;
  const list=e.entities.map(c=>{const r=freezeFieldEntity(c,{plain:true,inBlocks,inTables},now);if(!r)return c;count+=r.count;const next={...c};for(const [k,v] of Object.entries(r.changes)){if(v===null)delete next[k];else next[k]=v;}return next;});
  return count?{changes:{entities:list},count}:null;
 }
 return null;
}

/** 객체(블록 안 포함)에 남는 평가 불가 필드식 개수. */
export function countUnresolvedFields(e){
 if(!e||typeof e!=='object')return 0;
 let n=0;
 if(e.type==='text'){const s=String(e.text??'');FIELD_RE.lastIndex=0;for(const m of s.matchAll(FIELD_RE))if(evaluateFieldCode(m[1])===null)n++;}
 for(const c of e.entities||[])n+=countUnresolvedFields(c);
 return n;
}

/* ══ MDF 보조 · 문자 속성 덮어쓰기 초기화. 글꼴·폭비율·색·배경막을 기본값(ByLayer·1·없음)으로. 바꿀 것이 없으면 null. ══ */
export function textStyleResetChanges(e){
 const changes={};
 if(e.widthFactor!==undefined&&Math.abs(Number(e.widthFactor)-1)>1e-9)changes.widthFactor=null;
 for(const key of ['textStyle','sourceFont','sourceBigFont','color','aci','colorMode','font','bold','italic','underline','overline'])if(e[key]!==undefined&&e[key]!==null)changes[key]=null;
 if(e.backgroundMask){changes.backgroundMask=false;if(e.maskPadding!==undefined)changes.maskPadding=null;}
 return Object.keys(changes).length?changes:null;
}

/* ══ TFF 보조 · 참조상자(폭)·배경막 여백·폭비율을 실제 문자 크기에 맞추는 변경. 없으면 null. ══ */
export function textFrameFixChanges(e){
 if(!e||e.type!=='text')return null;
 const changes={};
 const wf=Number(e.widthFactor);
 const factor=Number.isFinite(wf)&&wf>0?Math.min(wf,10):1;
 if(e.widthFactor!==undefined&&(!Number.isFinite(wf)||wf<=0||wf>10))changes.widthFactor=factor===1?null:factor;
 const actual=textWidth({...e,widthFactor:factor});
 for(const key of ['width','boxWidth','wrapWidth','frameWidth']){
  if(e[key]===undefined||e[key]===null)continue;
  const w=Number(e[key]);
  if(!Number.isFinite(w)||Math.abs(w-actual)>Math.max(1e-6,actual*1e-6))changes[key]=actual;
 }
 if(e.backgroundMask&&e.maskPadding!==undefined){
  const limit=Number(e.height)*0.5;
  if(!(Number(e.maskPadding)>=0)||Number(e.maskPadding)>limit)changes.maskPadding=Math.max(0,Math.min(limit,Number(e.height)*0.25));
 }
 return Object.keys(changes).length?changes:null;
}

/* ══ MDF(izzarder.com/205) 근거: 다행문자 서식코드(\A1; \H1.5x; \C1; \Wn.n; \Pfont|...; \P 중괄호 %%u) 제거.
   우리 문자에는 MTEXT 서식이 원래 생기지 않지만, 다른 프로그램에서 복사해 붙인 문자에 이런 코드가 섞여
   들어온 경우를 정리한다(정리본 "제작 공통 패턴 4"의 xi:StripMtextFormat 을 그대로 옮김). ══ */
export function stripMtextFormat(text,keepBreaks){
 let out='',i=0;const s=String(text??''),n=s.length;
 while(i<n){
  const ch=s[i];
  if(ch==='\\'&&s[i+1]==='P'){out+=keepBreaks?'\n':'';i+=2;continue;}
  if(ch==='\\'){
   const c=s[i+1];
   // ; 없이 끝나는 코드: 밑줄·윗줄·취소선 켜고 끄기, 줄바꿈 없는 띄어쓰기, 탈출 문자(2026-10-27 설명서 시험).
   if(c&&'LlOoKk'.includes(c)){i+=2;continue;}
   if(c==='~'){out+=' ';i+=2;continue;}
   if(c==='\\'||c==='{'||c==='}'){out+=c;i+=2;continue;}
   let j=i+1;while(j<n&&s[j]!==';')j++;
   if(c==='S')out+=s.slice(i+2,j).replace(/[\^#]/g,'/'); // 분수 \S1/2; → 1/2
   i=j+1;continue;
  }
  if(ch==='{'||ch==='}'){i++;continue;}
  if(/^%%[uUoO]/.test(s.slice(i,i+3))){i+=3;continue;}
  out+=ch;i++;
 }
 return out;
}

/* ══ 523 TXT2MTXT·TEXTALIGN ══
   AutoCAD Txt2Mtxt 는 Y 가 큰 것(위)부터, Y 차이가 작으면 X 가 작은 것부터 줄을 잇는다. 바른 CAD 는 첫 문자의 회전 방향 기준으로
   같은 규칙을 써서 기울어진 문자 묶음도 바르게 잇는다. */
export function orderTextsByPosition(texts){
 const list=[...texts];if(list.length<2)return list;
 const r=-(list[0].rotation||0)*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
 const local=e=>({x:e.position.x*c-e.position.y*s,y:e.position.x*s+e.position.y*c});
 const keyed=list.map(e=>({e,p:local(e)}));
 keyed.sort((a,b)=>{const tol=Math.max(a.e.height||0,b.e.height||0)*.5;return Math.abs(a.p.y-b.p.y)>tol?b.p.y-a.p.y:a.p.x-b.p.x;});
 return keyed.map(k=>k.e);
}
/** 위→아래로 이은 문자들의 평균 줄 간격(높이 배수). 한 줄 문자 두 개 이상일 때만, 아니면 null. */
export function averageLineSpacing(ordered){
 const gaps=[];
 for(let i=1;i<ordered.length;i++){
  const a=ordered[i-1],b=ordered[i],r=(a.rotation||0)*Math.PI/180,up={x:-Math.sin(r),y:Math.cos(r)};
  const d=(a.position.x-b.position.x)*up.x+(a.position.y-b.position.y)*up.y,h=Math.max(a.height||0,b.height||0);
  if(h>0&&d>h*.5)gaps.push(d/h);
 }
 return gaps.length?gaps.reduce((s,v)=>s+v,0)/gaps.length:null;
}
/**
 * TEXTALIGN 고르게: start 에서 direction 쪽으로 "간격 + 앞 문자 폭"을 쌓아 다음 위치를 정한다.
 * 방향이 수평·수직에서 1° 안이면 그 축에 붙인다(AutoCAD angleThreshold 와 같다). 폭은 선택 상자와 같은 G.textBoxWidth.
 */
export function alignTextsEvenly(texts,start,direction,spacing=0){
 let d=G.unit(direction);const ang=Math.atan2(d.y,d.x),snap=Math.PI/180;
 for(const k of [0,Math.PI/2,Math.PI,-Math.PI/2,-Math.PI])if(Math.abs(ang-k)<snap)d={x:Math.round(Math.cos(k)),y:Math.round(Math.sin(k))};
 const ordered=[...texts].sort((a,b)=>G.dot(G.sub(a.position,start),d)-G.dot(G.sub(b.position,start),d));
 let p={x:start.x,y:start.y};
 return ordered.map(e=>{
  const out={id:e.id,changes:{position:{x:p.x,y:p.y}}};
  const along=Math.abs(G.dot(G.polar(G.textBoxWidth(e),e.rotation||0),d)),across=Math.abs(G.dot(G.polar(e.height||0,(e.rotation||0)+90),d));
  p=G.add(p,G.mul(d,(Number(spacing)||0)+Math.max(along,across,G.EPS)));
  return out;
 });
}

/* ══ TJ(izzarder.com/594) 근거: 정렬점(72/73) 변경 시 화면 위치를 그대로 두려면 폭만큼 위치를 보정해야
   한다(정리본 "제작 공통 패턴 5"). geometry.js 의 vertices() 가 문자 폭을 글자수×높이×0.65×widthFactor 로
   근사하므로(geometry.js:516-528) 같은 식을 그대로 써서 렌더 결과와 어긋나지 않게 한다. ══ */
// 508: 선택 상자(geometry.vertices)와 같은 폭(G.textBoxWidth — 화면에서는 실제 글꼴 측정, 시험에서는 한글 1.0·나머지 0.65 어림).
// 예전에는 글자 수 × 0.65 라 한글 문자의 정렬 보정이 실제 폭의 65% 만큼만 움직였다.
export function textWidth(e){return G.textBoxWidth(e);}
function alignOffset(align,width){return align==='center'?-width/2:align==='right'?-width:0;}
export function repositionForAlign(e,newAlign){
 const width=textWidth(e),oldOffset=alignOffset(e.align||'left',width),newOffset=alignOffset(newAlign,width);
 const delta=oldOffset-newOffset;
 return delta?G.add(e.position,G.polar(delta,e.rotation||0)):{x:e.position.x,y:e.position.y};
}

/* ══ TOA(izzarder.com/92) 근거: 문자를 담은 닫힌 도형(폴리선/사각형/원)을 찾아 9방향(QWEASDZXC)으로 정렬한다.
   원문은 AutoCAD BOUNDARY 로 경계를 추적하지만 우리 엔진엔 그 명령이 없어, 문자 위치를 담는 가장 작은 닫힌
   도형을 찾는 것으로 대신했다(여러 겹 중첩이면 가장 작은 것을 고름). ══ */
export function findEnclosingBoundary(entities,point){
 let best=null,bestArea=Infinity;
 for(const e of entities||[]){
  if(e.hidden)continue;
  if(e.type==='circle'){
   if(G.dist(point,e.center)>e.radius)continue;
   const area=Math.PI*e.radius*e.radius;
   if(area<bestArea){bestArea=area;best=e;}
   continue;
  }
  if((e.type==='rectangle'||(e.type==='polyline'&&e.closed))&&e.points?.length>=3){
   if(!G.inside(point,e.points))continue;
   const area=G.polygonArea(e.points);
   if(area<bestArea){bestArea=area;best=e;}
  }
 }
 return best;
}
const CORNERS={Q:['left','top'],W:['center','top'],E:['right','top'],A:['left','mid'],S:['center','mid'],D:['right','mid'],Z:['left','bottom'],X:['center','bottom'],C:['right','bottom']};
/** box{minX,minY,maxX,maxY} 안에서 corner(QWEASDZXC) 방향으로 문자를 놓을 좌표·정렬을 계산한다.
 *  세로 방향은 baseline(위로 height 만큼 올라가는 한 줄 문자) 기준의 근사치다(여러 줄은 위쪽이 더 튀어나옴). */
export function boxAlignPoint(box,corner,gap,height){
 const [h,v]=CORNERS[corner]||CORNERS.S;
 const x=h==='left'?box.minX+gap:h==='right'?box.maxX-gap:(box.minX+box.maxX)/2;
 const y=v==='top'?box.maxY-height-gap:v==='bottom'?box.minY+gap:(box.minY+box.maxY)/2-height/2;
 return {x,y,align:h};
}

/* ══ TO(izzarder.com/104) 근거: 최대 3개 문자를 사각형 중심에 줄간격만큼 세로로 쌓는다. ══ */
export function stackOffsets(count,gap){
 const out=[];for(let i=0;i<count;i++)out.push((count-1)/2*gap-i*gap);
 return out;
}

/* ══ TSW(izzarder.com/445) 근거: 선택한 문자들의 내용을 한 칸씩 돌려(rotate) 맞바꾼다. 2개면 서로 교환,
   3개 이상이면 원문대로 "원본 값 리스트를 한 칸씩 순환"한다. ══ */
export function rotateList(list){const n=list.length;return list.map((_,i)=>list[(i+1)%n]);}

/* ══ TC(izzarder.com/318) "숫자만" 모드용 ══ */
const NUM_RE=/-?\d+(?:\.\d+)?/;
export function firstNumberOf(text){const m=NUM_RE.exec(String(text??''));if(!m)throw Error('원본 문자열에 숫자가 없습니다.');return m[0];}
export function replaceFirstNumber(text,token){
 if(!NUM_RE.test(String(text??'')))throw Error('대상 문자열에 숫자가 없습니다.');
 return String(text).replace(NUM_RE,token);
}

/* ══ TEC 추정 구현 근거: 원문 글을 찾지 못했다(izzarder.com "문자의 일부 복사" 게시물 없음, 정리본에도 없음,
   WebSearch 로도 미발견). 카탈로그 한 줄 설명만으로 "원본 문자열의 일부(시작 위치·길이)를 잘라 대상에 복사"로
   추정 구현했다. ══ */
export function extractSubstring(text,start,length){
 const s=String(text??'');
 if(!Number.isInteger(start)||start<1)throw Error('시작 위치는 1 이상 정수여야 합니다.');
 if(!Number.isInteger(length)||length<1)throw Error('길이는 1 이상 정수여야 합니다.');
 const piece=s.slice(start-1,start-1+length);
 if(!piece)throw Error('그 범위에는 문자가 없습니다.');
 return piece;
}

/* ── 화면(설치) ── */
export function installTextEditTools(ctx){

 /* A2M(izzarder.com/533) 속성문자를 일반문자로: 속성블럭 안의 attributeTag 문자를 독립 text 로 뽑아내고,
    ATTRIBUTETEXT(workflows.js:171)가 넣어둔 child text 를 블록에서 지운다. 블록 attributes 값 자체는
    다른 기능(구적표 등)이 참조할 수 있어 그대로 둔다 — 이 선택을 보고서 한계에 적는다. */
 function runA2M(){
  try{
   const blocks=(ctx.selected()||[]).filter(e=>e.type==='block'&&(e.entities||[]).some(c=>c.attributeTag));
   if(!blocks.length)throw Error('속성 태그를 가진 블록을 선택하세요.');
   ctx.form('A2M · 속성문자를 일반문자로 추출',[
    {name:'mode',label:'변환 방식',value:'multi',options:[['multi','속성블럭 속 문자를 다행문자로(태그별 값을 한 문자로 합침)'],['single','속성문자를 각각 단행문자로']]},
    {name:'withTag',label:'태그도 함께 표시("태그: 값")',type:'checkbox'}
   ],values=>{
    const withTag=values.withTag==='on',commands=[],newTexts=[];
    for(const block of blocks){
     const tagged=(block.entities||[]).filter(c=>c.attributeTag);
     if(!tagged.length)continue;
     const layer=ctx.ensureLayer(STD_LAYERS.text,'#ffffff');
     const content=c=>withTag?`${c.attributeTag}: ${block.attributes?.[c.attributeTag]??c.text}`:c.text;
     if(values.mode==='single'){
      for(const c of tagged)newTexts.push({type:'text',layer,position:{x:c.position.x,y:c.position.y},height:c.height,rotation:c.rotation||0,align:c.align||'left',text:content(c)});
     }else{
      const b=G.bounds([block])||G.bounds(tagged),center={x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2};
      newTexts.push({type:'text',layer,position:center,height:tagged[0].height||2.5,rotation:0,align:'center',text:tagged.map(content).join('\n')});
     }
     const remainTags=new Set(tagged.map(c=>c.attributeTag));
     const rest=(block.entities||[]).filter(c=>!remainTags.has(c.attributeTag));
     // 속성 문자만 있던 블록은 빈 블록이 되므로 지운다(도면 엔진은 빈 블록을 받지 않는다, 2026-10-27 설명서 시험).
     commands.push(rest.length?upd(block,{entities:rest}):{type:'delete',ids:[block.id]});
    }
    if(!newTexts.length){ctx.toast('A2M · 추출할 속성 문자가 없습니다.');return;}
    commands.push({type:'addMany',entities:newTexts});
    exec(ctx,commands);
    ctx.toast(`A2M · 블록 ${blocks.length}개에서 문자 ${newTexts.length}개를 뽑아냈습니다(블록의 attributes 값은 남겨둡니다) · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(ctx,e);}
 }

 /* FTT(izzarder.com/524) 필드문자를 일반문자로. 2026-09-24 검토 F13 으로 안내 전용에서 실제 동작으로 바꿈.
    바른 CAD 에서 "필드"에 해당하는 것: ① DAR 이 만든 살아있는 면적 문자(darSourceId 연결) ② 외부 도면에서 들어온
    필드 표현식 %<…>% (날짜/시간 변수는 지금 값으로, 나머지는 캐시값이 없어 AutoCAD 와 같이 ####) ③ field·fieldCode 속성.
    원문 대화상자의 [검색 조건](단행/다행/블럭 안/표 안)·[잠긴 켜 제외]·[화면에서 선택] 을 옮겼다. */
 function runFTT(){
  try{
   ctx.form('FTT · 필드문자를 일반문자로 (izzarder.com/524)',[
    {name:'onScreen',label:'화면에서 선택 (끄면 도면 전체)',type:'checkbox',value:(ctx.selected()||[]).length?'on':''},
    {name:'plain',label:'검색 조건 · 단행/다행 문자',type:'checkbox',value:'on'},
    {name:'inBlocks',label:'검색 조건 · 블럭 안의 문자',type:'checkbox',value:'on'},
    {name:'inTables',label:'검색 조건 · 표 안의 문자',type:'checkbox',value:'on'},
    {name:'skipLocked',label:'잠긴 켜 객체 제외',type:'checkbox',value:''},
   ],values=>{
    const scope=values.onScreen==='on'?(ctx.selected()||[]):(ctx.entities()||[]);
    if(!scope.length)throw Error('대상 객체가 없습니다. 화면에서 선택하거나 도면 전체를 대상으로 하세요.');
    const locked=values.skipLocked==='on'?new Set((ctx.layers()||[]).filter(l=>l.locked).map(l=>l.id)):new Set();
    const opts={plain:values.plain==='on',inBlocks:values.inBlocks==='on',inTables:values.inTables==='on'};
    const commands=[];let converted=0,checked=0;
    for(const e of scope){
     if(locked.has(e.layer))continue;
     checked++;
     const r=freezeFieldEntity(e,opts);
     if(!r)continue;
     commands.push(upd(e,r.changes));converted+=r.count;
    }
    const unresolved=scope.filter(e=>!locked.has(e.layer)).reduce((n,e)=>n+countUnresolvedFields(e),0);
    const note=unresolved?` · 평가할 수 없는 필드식 ${unresolved}개(작성일·객체 속성 등)는 캐시값이 없어 원문 그대로 두었습니다`:'';
    if(!commands.length){ctx.toast(`FTT · 객체 ${checked}개를 확인했지만 고정할 필드 문자가 없습니다(살아있는 면적 문자·날짜/시간 필드식·field 속성 없음)${note}.`);return;}
    exec(ctx,commands);
    ctx.toast(`FTT · 필드 문자 ${converted}개를 고정 문자로 바꿨습니다(객체 ${commands.length}개 · 확인 ${checked}개)${note} · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(ctx,e);}
 }

 /* MDF: 서식코드 제거 + (선택) 문자 속성 초기화. 2026-09-24 검토 F13: 바른 CAD 문자에는 서식코드가 거의 없어 사실상 무동작이었다.
    원문 취지(폰트/색/밑줄 등 서식을 지우고 순수 문자만)에 맞춰 글꼴·폭비율·색·배경 같은 문자 속성 덮어쓰기도 함께 지운다. */
 function runMDF(){
  try{
   const texts=need(ctx);
   ctx.form('MDF · 다행문자 특성 제거 (izzarder.com/205)',[
    {name:'keep',label:'줄바꿈만 남기기(선택 안하면 서식코드 전부 제거)',type:'checkbox'},
    {name:'props',label:'문자 속성(글꼴·폭비율·색·배경막)도 기본값으로 되돌리기 (기본 끔 · 원문은 서식코드만 지웁니다)',type:'checkbox',value:''},
   ],values=>{
    const keep=values.keep==='on',resetProps=values.props==='on',commands=[];
    let codeCount=0,propCount=0;
    for(const e of texts){
     const changes={};
     const stripped=stripMtextFormat(e.text,keep);
     if(stripped!==e.text){changes.text=stripped;codeCount++;}
     if(resetProps){const reset=textStyleResetChanges(e);if(reset){Object.assign(changes,reset);propCount++;}}
     if(Object.keys(changes).length)commands.push(upd(e,changes));
    }
    if(!commands.length){ctx.toast(`MDF · 문자 ${texts.length}개에 지울 서식코드·문자 속성이 없습니다(이미 순수 문자입니다).`);return;}
    exec(ctx,commands);
    ctx.toast(`MDF · 문자 ${commands.length}개 정리 · 서식코드 ${codeCount}개 · 속성 초기화 ${propCount}개 · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(ctx,e);}
 }

 function runT2M(){
  try{
   const picked=needAtLeast(ctx,2);
   // 523: AutoCAD TXT2MTXT 처럼 위치순(위→아래, 같은 줄은 왼→오른)이 기본. 선택순은 예전 방식.
   ctx.form('T2M · 단행문자를 다행문자로 합치기(엔진에 MTEXT 타입이 없어 줄바꿈 포함한 text 하나로 만든다)',[
    {name:'order',label:'줄 순서',options:[['position','위치순 (위→아래, 왼→오른)'],['selection','선택한 순서']],value:'position'},
    {name:'keepOriginals',label:'원본 문자를 남기고 복사(선택 안하면 원본 삭제)',type:'checkbox'}
   ],values=>{
    const texts=values.order==='selection'?inSelectionOrder(ctx,picked):orderTextsByPosition(picked);
    const base=texts[0],content=texts.map(e=>e.text).join('\n'),spacing=averageLineSpacing(texts);
    const commands=[upd(base,{text:content,...(spacing?{lineSpacing:spacing}:{})})];
    if(values.keepOriginals!=='on')commands.push({type:'delete',ids:texts.slice(1).map(e=>e.id)});
    exec(ctx,commands);
    ctx.toast(`T2M · 문자 ${texts.length}개를 ${values.order==='selection'?'선택 순서':'위치 순서'}로 합쳤습니다${spacing?` · 원래 줄 간격 높이의 ${spacing.toFixed(2)}배를 기억(DXF MTEXT 줄 간격)`:''} · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(ctx,e);}
 }

 /* TFF(izzarder.com/462) 다행/다중지시선 테두리 맞추기. 2026-09-24 검토 F13 으로 실제 동작으로 바꿈.
    바른 CAD 문자는 화면 폭을 실제 글자 수·높이로 계산하지만, 외부 도면에서 들어온 참조상자 폭(width/boxWidth/wrapWidth,
    DXF 41 그룹코드)·과한 배경막 여백·비정상 폭비율이 남아 있을 수 있다. 이런 값을 실제 문자 폭에 맞춘다. */
 function runTFF(){
  try{
   const texts=(ctx.selected()||[]).filter(isText);
   const scope=texts.length?texts:(ctx.entities()||[]).filter(isText);
   if(!scope.length)throw Error('문자가 없습니다. 문자를 선택하거나 도면에 문자를 넣은 뒤 실행하세요.');
   const commands=[];
   for(const e of scope){const changes=textFrameFixChanges(e);if(changes)commands.push(upd(e,changes));}
   if(!commands.length){ctx.toast(`TFF · 문자 ${scope.length}개를 확인했지만 실제 폭과 다른 참조상자·여백·폭비율이 없습니다(이미 맞습니다).`);return;}
   exec(ctx,commands);
   ctx.toast(`TFF · 문자 ${commands.length}개의 테두리(참조상자 폭·배경막 여백·폭비율)를 실제 문자 크기에 맞췄습니다(확인 ${scope.length}개) · Ctrl+Z 로 되돌리기`);
  }catch(e){fail(ctx,e);}
 }

 function runFAM(){
  try{
   const scopeTexts=()=>{const sel=(ctx.selected()||[]).filter(isText);return sel.length?sel:(ctx.entities()||[]).filter(isText);};
   ctx.form('FAM · 문자 찾아 표시하기(선택 없으면 도면 전체 대상)',[
    {name:'query',label:'찾을 문자(갯수세기·선택만 모드는 비워두면 전체 대상)',type:'text',value:''},
    {name:'mode',label:'방식',value:'mark',options:[['mark','찾아표시(원/상자로 표시)'],['count','갯수세기'],['select','선택만']]},
    {name:'ignoreSpace',label:'공백무시',type:'checkbox'},
    {name:'shape',label:'표시 모양(찾아표시 모드)',value:'circle',options:[['circle','원'],['box','상자']]},
    {name:'radius',label:'원 반지름/상자 반폭(mm)',type:'number',value:150}
   ],values=>{
    const texts=scopeTexts(),needle=values.query||'';
    const norm=s=>values.ignoreSpace==='on'?stripSpace(s):String(s??'');
    const matches=needle?texts.filter(e=>norm(e.text).includes(norm(needle))):texts;
    if(!matches.length){ctx.toast('FAM · 일치하는 문자가 없습니다.');return;}
    if(values.mode==='select'){ctx.setSelected(matches.map(e=>e.id));ctx.toast(`FAM · ${matches.length}개를 선택했습니다.`);return;}
    if(values.mode==='count'){ctx.toast(`FAM · "${needle||'전체'}" 일치 ${matches.length}개`);return;}
    const r=positive(values.radius,'반지름'),layer=ctx.ensureLayer(STD_LAYERS.symb,'#ff9f68');
    const marks=matches.map(e=>values.shape==='box'
     ?{type:'rectangle',layer,points:G.rectangle({x:e.position.x-r,y:e.position.y-r},{x:e.position.x+r,y:e.position.y+r})}
     :{type:'circle',layer,center:{x:e.position.x,y:e.position.y},radius:r});
    exec(ctx,[{type:'addMany',entities:marks}]);
    ctx.toast(`FAM · ${marks.length}곳에 표시했습니다(원문의 "블록으로 표시"는 지원하지 않음) · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(ctx,e);}
 }

 function runTC(){
  try{
   const texts=inSelectionOrder(ctx,needAtLeast(ctx,2));
   ctx.form('TC · 문자 복사',[
    {name:'mode',label:'모드',value:'broadcast',options:[['broadcast','하나:다수(선택 순서상 첫 문자 → 나머지 전부)'],['pairwise','다수:다수(원본 개수만큼 순서대로 1:1)'],['numbersOnly','숫자만(원본의 숫자만 대상에 교체)']]},
    {name:'sourceCount',label:'원본 개수(다수:다수일 때만, 선택 순서 기준 앞쪽 N개)',type:'number',value:1},
    {name:'afterEquals',label:'등호(=) 이후 문자만 복사',type:'checkbox'},
    {name:'copyLayer',label:'켜까지 복사',type:'checkbox'},
    {name:'copyHeight',label:'문자크기까지 복사',type:'checkbox'},
    {name:'deleteSource',label:'복사 후 원본 삭제',type:'checkbox'}
   ],values=>{
    const mode=values.mode;
    const sourceCount=mode==='pairwise'?Math.max(1,Math.min(texts.length-1,Math.round(Number(values.sourceCount)||1))):1;
    const sources=texts.slice(0,sourceCount),targets=texts.slice(sourceCount);
    if(!targets.length)throw Error('대상 문자를 원본 외에 하나 이상 선택하세요.');
    const contentOf=s=>{let c=s.text;if(values.afterEquals==='on'){const i=c.indexOf('=');if(i<0)throw Error(`"${s.text}"에 등호(=)가 없습니다.`);c=c.slice(i+1).trim();}return c;};
    const commands=[];
    const apply=(target,text)=>{const changes={text};if(values.copyLayer==='on')changes.layer=sources[0].layer;if(values.copyHeight==='on')changes.height=sources[0].height;commands.push(upd(target,changes));};
    if(mode==='numbersOnly'){const token=firstNumberOf(contentOf(sources[0]));for(const t of targets)apply(t,replaceFirstNumber(t.text,token));}
    else if(mode==='pairwise'){const n=Math.min(sources.length,targets.length);for(let i=0;i<n;i++)apply(targets[i],contentOf(sources[i]));}
    else{const content=contentOf(sources[0]);for(const t of targets)apply(t,content);}
    if(values.deleteSource==='on')commands.push({type:'delete',ids:sources.map(e=>e.id)});
    exec(ctx,commands);
    const applied=commands.filter(c=>c.type==='update').length;
    ctx.toast(`TC · 문자 ${applied}개에 복사했습니다 · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(ctx,e);}
 }

 function runTJ(){
  try{
   const texts=need(ctx);
   ctx.form('TJ · 문자 정렬점 변경(위치는 그대로, 정렬점만 변경 · 이 엔진은 수직 정렬점이 없어 수평 3방향만 지원)',[
    {name:'align',label:'새 정렬점',value:'center',options:[['left','좌측'],['center','중앙'],['right','우측']]}
   ],values=>{
    const commands=texts.filter(e=>(e.align||'left')!==values.align).map(e=>upd(e,{position:repositionForAlign(e,values.align),align:values.align}));
    if(!commands.length){ctx.toast('TJ · 이미 그 정렬점입니다.');return;}
    exec(ctx,commands);
    ctx.toast(`TJ · 문자 ${commands.length}개의 정렬점을 바꿨습니다(화면 위치 유지) · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(ctx,e);}
 }

 function runTO(){
  try{
   const texts=inSelectionOrder(ctx,need(ctx));
   if(texts.length>3)throw Error('TO는 최대 3개 문자만 지원합니다(4개 이상이면 TOA를 쓰세요).');
   ctx.form('TO · 사각형 중앙으로 문자 이동',[{name:'gap',label:'줄 간격(문자높이 배수)',type:'number',value:1.6}],async values=>{
    const gap=positive(values.gap,'줄 간격');
    const path=await ctx.pickPath({prompt:'TO · 기준 사각형의 대각선 두 점을 지정하세요(허공에 찍어도 됩니다) · Esc 취소',minPoints:2,maxPoints:2});
    if(!path)return;
    const [p1,p2]=path.points,center={x:(p1.x+p2.x)/2,y:(p1.y+p2.y)/2};
    const h=Math.max(...texts.map(e=>e.height||0),1);
    const offsets=stackOffsets(texts.length,h*gap);
    const commands=texts.map((e,i)=>upd(e,{position:{x:center.x,y:center.y+offsets[i]},align:'center'}));
    exec(ctx,commands);
    ctx.toast(`TO · 문자 ${texts.length}개를 중심으로 모았습니다(선택 순서=위에서 아래) · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(ctx,e);}
 }

 function runTOA(){
  try{
   const texts=need(ctx);
   ctx.form('TOA · 객체(닫힌 도형) 속 문자 일괄 정렬',[
    {name:'corner',label:'정렬 방향(QWEASDZXC)',value:'S',options:[['Q','좌상'],['W','중상'],['E','우상'],['A','좌중'],['S','중중'],['D','우중'],['Z','좌하'],['X','중하'],['C','우하']]},
    {name:'gapMul',label:'이격거리(문자높이 배수)',type:'number',value:1.2}
   ],values=>{
    const gapMul=nonNeg(values.gapMul,'이격거리'),commands=[];let skipped=0;
    for(const e of texts){
     const boundary=findEnclosingBoundary(ctx.entities(),e.position);
     if(!boundary){skipped++;continue;}
     const box=G.bounds([boundary]);
     if(!box){skipped++;continue;}
     const {x,y,align}=boxAlignPoint(box,values.corner,(e.height||0)*gapMul,e.height||0);
     commands.push(upd(e,{position:{x,y},align}));
    }
    if(!commands.length){ctx.toast('TOA · 문자를 담은 닫힌 도형(폴리선/사각형/원)을 찾지 못했습니다.',true);return;}
    exec(ctx,commands);
    ctx.toast(`TOA · 문자 ${commands.length}개를 정렬했습니다${skipped?`(닫힌 도형을 못 찾아 ${skipped}개는 건너뜀)`:''} · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(ctx,e);}
 }

 function runTS(){
  try{
   const texts=need(ctx);
   ctx.form('TS · 문자 크기 변경',[
    {name:'mode',label:'방식',value:'absolute',options:[['absolute','절대 크기(mm)'],['multiply','배수']]},
    {name:'value',label:'값',type:'number',value:2.5}
   ],values=>{
    const v=positive(values.value,'값');
    const commands=texts.map(e=>upd(e,{height:values.mode==='multiply'?e.height*v:v}));
    exec(ctx,commands);
    ctx.toast(`TS · 문자 ${commands.length}개의 크기를 바꿨습니다 · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(ctx,e);}
 }

 /* TSA(izzarder.com/263) 문자모양 일괄변경: STYLE 테이블이 없어 "글꼴 통일" 절반만 만든다. textStyle/
    sourceFont/sourceBigFont 를 바꾸지만(기존 TEXTSTYLEMERGE 와 같은 필드), view.js 가 고정 글꼴만 그려
    화면 모양은 바뀌지 않는다 — 저장값만 남긴다(아래 한계 참고). */
 function runTSA(){
  try{
   const sel=(ctx.selected()||[]).filter(isText),texts=sel.length?sel:(ctx.entities()||[]).filter(isText);
   if(!texts.length)throw Error('문자가 없습니다.');
   ctx.form(`TSA · 문자모양 일괄변경(선택 없으면 도면 전체 ${texts.length}개 대상)`,[{name:'font',label:'바꿀 글꼴 이름',type:'text',value:'malgun gothic'}],values=>{
    const font=values.font.trim();if(!font)throw Error('글꼴 이름을 입력하세요.');
    const commands=texts.map(e=>upd(e,{textStyle:font,sourceFont:font}));
    exec(ctx,commands);
    ctx.toast(`TSA · 문자 ${commands.length}개의 글꼴 이름을 "${font}"로 저장했습니다(바른 CAD 는 화면에 고정 글꼴만 그려 실제 모양은 바뀌지 않습니다) · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(ctx,e);}
 }

 function runTSE(){
  try{
   const texts=inSelectionOrder(ctx,need(ctx));
   const step=i=>{
    if(i>=texts.length){ctx.toast(`TSE · 문자 ${texts.length}개 순차 수정을 마쳤습니다.`);return;}
    const e=texts[i];
    ctx.form(`TSE · ${i+1}/${texts.length} 번째 문자 수정`,[
     {name:'text',label:'내용',type:'text',value:e.text},
     {name:'skip',label:'건너뛰기(내용 그대로 두고 다음으로)',type:'checkbox'}
    ],values=>{
     if(values.skip!=='on'&&values.text!==e.text)exec(ctx,[upd(e,{text:values.text})]);
     step(i+1);
    });
   };
   step(0);
  }catch(e){fail(ctx,e);}
 }

 function runTSO(){
  try{
   const texts=needAtLeast(ctx,2);
   ctx.form('TSO · 문자열 정렬(수직/수평 줄맞춤)',[
    {name:'direction',label:'정렬 방식',value:'vertical',options:[['vertical','수직(위→아래)'],['horizontal','수평(왼쪽→오른쪽)']]},
    {name:'gap',label:'간격(문자높이 배수)',type:'number',value:2},
    {name:'realign',label:'정렬점도 중앙으로 변경',type:'checkbox'}
   ],values=>{
    const gapMul=positive(values.gap,'간격'),vertical=values.direction!=='horizontal';
    const sorted=[...texts].sort((a,b)=>vertical?b.position.y-a.position.y:a.position.x-b.position.x);
    const base=sorted[0],h=Math.max(...sorted.map(e=>e.height||0),1),step=h*gapMul,realign=values.realign==='on';
    const commands=sorted.map((e,i)=>{
     const position=vertical?{x:realign?base.position.x:e.position.x,y:base.position.y-i*step}:{x:base.position.x+i*step,y:realign?base.position.y:e.position.y};
     const changes={position};if(realign)changes.align='center';
     return upd(e,changes);
    });
    exec(ctx,commands);
    ctx.toast(`TSO · 문자 ${commands.length}개를 ${vertical?'수직':'수평'}으로 정렬했습니다(정렬 순서=좌표순, 선택순은 지원 안 함) · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(ctx,e);}
 }

 /* TST(izzarder.com/361): 첫 선택 문자를 기준으로 나머지 모양(글꼴 저장값)을 맞춘다. 원문의 "엔터=현재모양/
    목록에서 선택" 두 경로는 뺐다(아래 한계). TSA 와 같은 이유로 화면에는 반영되지 않는다. */
 function runTST(){
  try{
   const texts=inSelectionOrder(ctx,needAtLeast(ctx,2));
   const [ref,...rest]=texts;
   const commands=rest.map(e=>upd(e,{textStyle:ref.textStyle,sourceFont:ref.sourceFont,sourceBigFont:ref.sourceBigFont}));
   exec(ctx,commands);
   ctx.toast(`TST · 문자 ${commands.length}개의 모양을 첫 선택 문자(기준)에 맞췄습니다(화면에는 반영되지 않는 저장값입니다) · Ctrl+Z 로 되돌리기`);
  }catch(e){fail(ctx,e);}
 }

 function runTSW(){
  try{
   const texts=needAtLeast(ctx,2);
   ctx.form('TSW · 문자 내용 맞바꾸기',[{name:'order',label:'정렬 기준(교환 순서)',value:'selection',options:[['selection','선택한 순서'],['vertical','상하'],['horizontal','좌우']]}],values=>{
    const sorted=values.order==='vertical'?[...texts].sort((a,b)=>b.position.y-a.position.y)
     :values.order==='horizontal'?[...texts].sort((a,b)=>a.position.x-b.position.x)
     :inSelectionOrder(ctx,texts);
    const swapped=rotateList(sorted.map(e=>e.text));
    const commands=sorted.map((e,i)=>upd(e,{text:swapped[i]}));
    exec(ctx,commands);
    ctx.toast(`TSW · 문자 ${commands.length}개의 내용을 맞바꿨습니다(2개면 서로 교환, 3개 이상은 순환) · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(ctx,e);}
 }

 function runTW(){
  try{
   const texts=need(ctx);
   ctx.form('TW · 문자 폭 변경',[
    {name:'mode',label:'방식',value:'value',options:[['value','값 입력'],['reference','참조 문자에서 복사(선택 순서상 첫 문자 기준)']]},
    {name:'value',label:'폭 비율(값 입력일 때)',type:'number',value:1}
   ],values=>{
    let commands;
    if(values.mode==='reference'){
     if(texts.length<2)throw Error('참조 방식은 문자를 2개 이상 선택해야 합니다(첫 문자가 기준).');
     const [ref,...rest]=inSelectionOrder(ctx,texts);
     commands=rest.map(e=>upd(e,{widthFactor:ref.widthFactor||1}));
    }else{
     const v=positive(values.value,'폭 비율');
     commands=texts.map(e=>upd(e,{widthFactor:v}));
    }
    exec(ctx,commands);
    ctx.toast(`TW · 문자 ${commands.length}개의 폭을 바꿨습니다 · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(ctx,e);}
 }

 function runTEC(){
  try{
   const texts=inSelectionOrder(ctx,needAtLeast(ctx,2));
   const [source,...targets]=texts;
   ctx.form('TEC · 문자의 일부 복사(추정 구현 · 원문 게시글을 찾지 못해 카탈로그 설명만으로 만듦)',[
    {name:'start',label:'시작 위치(원본 문자열 1번째부터)',type:'number',value:1},
    {name:'length',label:'길이(글자 수)',type:'number',value:1},
    {name:'append',label:'대상 문자열 뒤에 이어붙이기(선택 안하면 통째로 교체)',type:'checkbox'}
   ],values=>{
    const piece=extractSubstring(source.text,Math.round(Number(values.start)),Math.round(Number(values.length)));
    const commands=targets.map(e=>upd(e,{text:values.append==='on'?e.text+piece:piece}));
    exec(ctx,commands);
    ctx.toast(`TEC · "${piece}"를 대상 ${commands.length}개에 복사했습니다(추정 구현) · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(ctx,e);}
 }

 return {A2M:runA2M,FTT:runFTT,MDF:runMDF,T2M:runT2M,TFF:runTFF,FAM:runFAM,TC:runTC,TJ:runTJ,TO:runTO,TOA:runTOA,TS:runTS,TSA:runTSA,TSE:runTSE,TSO:runTSO,TST:runTST,TSW:runTSW,TW:runTW,TEC:runTEC};
}
