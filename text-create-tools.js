// 문자 생성 및 증가 카드 12종. 바른 CAD 리습(izzarder.com) 정리본 docs/izzarder-reference-20260921/references/12-text-create.md
// 절 끝의 원문 링크를 WebFetch 로 읽어(정리본의 "제작 방법"은 추정이므로 근거로 삼지 않고 원문을 우선했다) 옮겼다.
// 검증 보고서 reports/2차_매핑검증_B_보고_20260921.md "2. 문자 생성 및 증가" 표: 기존 NATIVE_COMMANDS 매핑은
// TEXTINCREMENT/TEXTNUMBER/TEXTCOUNT/TIT/TBOX 5개로 뭉개져 "이름만" 판정 10건이었다 — 이 카드들은 원문의 실제
// 조작(신규 생성 vs 기존 편집, 분해확인 대화상자, 원본유지 방식, 위치지정, 지시선, 특수문자, 표 생성, 객체추종)을
// 각각 따로 구현한다.
// NUMC·MK 는 정리본에도 원문 게시글 번호가 없다(2차 검증에서 "확인 필요"로 남김). 이번에도 WebSearch(site:izzarder.com)
// 로 다시 찾았으나 전용 게시글을 찾지 못했다: NUMC 는 izzarder.com/77("문자 또는 숫자 자동 증가", c:tag 함수, "숫자
// 또는 문자를 자동 증가시켜 여러 지점에 텍스트 생성"·"빈 입력으로 종료")을 가장 가까운 근거로 삼아 추정 구현했고,
// MK 는 reference-command-catalog.js 의 라벨 "문단에 마스크 표시"만으로 추정 구현했다(이미 있는 TEXTMASK 명령과
// 사실상 같은 기능 — 통합 시 이름 겹침을 통합 담당이 처리해야 한다). 둘 다 카드 안에서 "추정 구현"이라고 밝힌다.
import * as G from './geometry.js';
import {STD_LAYERS} from './card-kit.js';
import {tableBlock} from './studio.js';
import {isChecked,boundedInteger} from './card-input.js';

// 2026-09-24(검토 P2 계열): 등간격·배열 개수 상한. 1e15 가 그대로 반복문에 들어가면 렌더러가 멈춘다.
export const TEXT_SERIES_MAX=1000;

/* ================================================================================================
   공통: 문자열 접두어/숫자/접미어 분해와 증가. 원문 정리본 "제작 공통 패턴 4"(izzarder.com/103·488 대화상자에서
   실제로 확인한 접두어/숫자/접미어 3분할 방식)를 그대로 옮겼다. 선행 0 자릿수·소숫점 자릿수를 원본 그대로 유지한다.
   ================================================================================================ */

/** "A-001b" → {prefix:'A-', number:'001', suffix:'b'}. 첫 숫자(또는 '.') 앞까지가 접두어. */
export function splitAffixNumber(str){
 const s=String(str??'');
 let i=0,prefix='';
 while(i<s.length && !/[0-9.]/.test(s[i])){prefix+=s[i];i++;}
 let number='';
 let dotUsed=false;
 while(i<s.length && /[0-9.]/.test(s[i])){
  if(s[i]==='.'){ if(dotUsed)break; dotUsed=true; }
  number+=s[i];i++;
 }
 return {prefix,number,suffix:s.slice(i)};
}

export function decimalPlaces(numStr){
 const i=String(numStr).indexOf('.');
 return i<0?0:String(numStr).length-i-1;
}

/** 숫자 문자열 하나를 step 만큼 늘린다. 소숫점 자릿수와(정수일 때) 선행 0 자릿수를 원본 그대로 유지한다. */
export function incrementNumberString(numStr,step=1){
 const s=String(numStr);
 if(!/^\d*\.?\d+$|^\d+\.?\d*$/.test(s))throw Error('숫자 형태가 아닙니다: '+s);
 const dec=decimalPlaces(s);
 const value=Number(s)+Number(step);
 if(!Number.isFinite(value))throw Error('계산 결과가 숫자가 아닙니다.');
 let out=dec>0?value.toFixed(dec):String(Math.round(value));
 const neg=out.startsWith('-');
 let digits=neg?out.slice(1):out;
 if(dec===0 && /^0/.test(s) && s.length>1 && digits.length<s.length)digits=digits.padStart(s.length,'0');
 return (neg?'-':'')+digits;
}

/** 접두어+숫자+접미어 전체 문자열에서 숫자 부분만 늘린다. */
export function incrementText(str,step=1){
 const {prefix,number,suffix}=splitAffixNumber(str);
 if(!number)throw Error('문자열에 숫자가 없습니다: '+str);
 return prefix+incrementNumberString(number,step)+suffix;
}

/** 영문자 한 글자 증가. Z→A, z→a 로 감싼다(자리올림은 incrementAlphaToken 이 처리). */
export function incrementAlphaChar(ch){
 if(ch==='Z')return 'A';
 if(ch==='z')return 'a';
 if(/[A-Y]/.test(ch))return String.fromCharCode(ch.charCodeAt(0)+1);
 if(/[a-y]/.test(ch))return String.fromCharCode(ch.charCodeAt(0)+1);
 return ch;
}

/** 여러 자리 영문 토큰 증가(AAA→AAB, …, AAZ→ABA). 맨 끝 자리부터 자리올림한다. */
export function incrementAlphaToken(token){
 const chars=[...String(token)];
 if(!chars.length)throw Error('영문자가 없습니다.');
 let i=chars.length-1,carry=true;
 while(i>=0 && carry){
  const wrapped=chars[i]==='Z'||chars[i]==='z';
  chars[i]=incrementAlphaChar(chars[i]);
  carry=wrapped;
  i--;
 }
 if(carry){const lower=chars[0]&&chars[0]===chars[0].toLowerCase()&&chars[0]!==chars[0].toUpperCase();chars.unshift(lower?'a':'A');}
 return chars.join('');
}

/** 시작문자에 숫자를 넣으면 숫자가, 영문을 넣으면 영문이 증가한다(TII·NUMC 원문 그대로). */
export function nextTagValue(current,step=1){
 const s=String(current);
 if(/^-?\d+(?:\.\d+)?$/.test(s))return incrementNumberString(s,step);
 if(/^[A-Za-z]+$/.test(s))return incrementAlphaToken(s);
 return incrementText(s,step);
}

/** start 부터 시작해 count 개의 값을 순서대로 만든다(TII "하나씩"·NUMC 의 각 클릭 값). */
export function buildIncrementSeries(start,count,step=1){
 const out=[];let cur=String(start);
 for(let i=0;i<Math.max(0,count);i++){out.push(cur);cur=nextTagValue(cur,step);}
 return out;
}

/** 두 점 사이를 count 개로 등분한 점 목록(TII "등간격 연속"). count=1 이면 시작점만. */
export function lerpPoints(a,b,count){
 if(count<=1)return [{...a}];
 const out=[];
 for(let i=0;i<count;i++){const t=i/(count-1);out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}
 return out;
}

/* ================================================================================================
   TIE(원본유지) — 문자열 안에서 앞/뒤 숫자(또는 영문) 묶음을 찾아 바꾼다.
   ================================================================================================ */

/** position='back' 이면 문자열의 마지막 숫자(또는 영문) 묶음을, 'front' 면 첫 묶음을 찾는다. */
export function findRun(str,position='back',kind='digit'){
 const re=kind==='alpha'?/[A-Za-z]+/g:/\d+(?:\.\d+)?/g;
 const s=String(str);
 let m,list=[];
 while((m=re.exec(s)))list.push({text:m[0],index:m.index});
 if(!list.length)return null;
 return position==='front'?list[0]:list[list.length-1];
}

/** 찾은 묶음을 value 로 바꾼다. 묶음이 없으면 position 쪽 끝에 덧붙인다. */
export function replaceRunAtPosition(str,position,value,kind='digit'){
 const s=String(str);
 const found=findRun(s,position,kind);
 if(found)return s.slice(0,found.index)+value+s.slice(found.index+found.text.length);
 return position==='front'?value+s:s+value;
}

/** 원본의 숫자(또는 영문)를 시작값 삼아, 대상마다 이어서 증가시키며 자기 나머지 부분은 그대로 둔다. */
export function computeTieSequence(originalText,targetTexts,{position='back',step=1,kind='digit'}={}){
 const startRun=findRun(originalText,position,kind);
 if(!startRun)throw Error(kind==='alpha'?'원본 문자열에 영문자가 없습니다.':'원본 문자열에 숫자가 없습니다.');
 let current=startRun.text;
 return targetTexts.map(t=>{
  current=kind==='alpha'?incrementAlphaToken(current):incrementNumberString(current,step);
  return replaceRunAtPosition(t,position,current,kind);
 });
}

/* ================================================================================================
   TIN(비문자 포함) — 선택 객체가 문자면 그 자체를, 문자가 아니면(원·블럭 등) 내부에 끼워 넣은 문자(예: PKN 이
   블럭 entities 배열에 넣는 numberLabel 텍스트와 같은 모양)를 찾아 라벨로 삼는다.
   ================================================================================================ */

/** 엔티티에서 라벨(숫자 포함 문자)을 찾는다. text 엔티티면 자신, 아니면 하위 entities[] 안의 첫 text. */
export function labelOf(entity){
 if(!entity)return null;
 if(entity.type==='text')return {text:entity.text,buildUpdate:text=>({type:'update',ids:[entity.id],changes:{text}})};
 if(Array.isArray(entity.entities)){
  const idx=entity.entities.findIndex(e=>e.type==='text');
  if(idx>=0){
   const child=entity.entities[idx];
   return {text:child.text,buildUpdate:text=>({type:'update',ids:[entity.id],changes:{entities:entity.entities.map((e,i)=>i===idx?{...e,text}:e)}})};
  }
 }
 return null;
}

/* ================================================================================================
   TIP(위치지정) — 클릭한 화면 X 좌표를 문자 안 인덱스로 환산하고, 그 자리를 포함(또는 가장 가까운) 숫자 묶음을 찾는다.
   ================================================================================================ */

/** 왼쪽 정렬 기준 글자폭(원문에 "문자높이 x 선축척"류 배수 표기가 흔해, 코드베이스가 이미 쓰는 0.65 배를 그대로 쓴다). */
export function charIndexFromLocalX(localX,height,align='left',textLength=0,charWidthFactor=0.65){
 const cw=Math.max(1e-6,height*charWidthFactor);
 const rawWidth=textLength*cw;
 const startOffset=align==='center'?-rawWidth/2:align==='right'?-rawWidth:0;
 return Math.round((localX-startOffset)/cw);
}

/** index 를 포함하는 숫자 묶음, 없으면 가장 가까운 숫자 묶음. */
export function numberGroupAt(text,index){
 const s=String(text);
 const re=/\d+(?:\.\d+)?/g;
 let m,best=null,bestDist=Infinity;
 while((m=re.exec(s))){
  const start=m.index,end=start+m[0].length;
  if(index>=start&&index<end)return {text:m[0],start,end};
  const d=index<start?start-index:index-end+1;
  if(d<bestDist){bestDist=d;best={text:m[0],start,end};}
 }
 return best;
}

/** 지정된 묶음 자리만 step 만큼 늘려 전체 문자열을 다시 만든다. */
export function incrementAtGroup(text,group,step=1){
 if(!group)throw Error('숫자 위치를 찾을 수 없습니다.');
 const s=String(text);
 const value=incrementNumberString(group.text,step);
 return s.slice(0,group.start)+value+s.slice(group.end);
}

/** 배열(A) 옵션: 기준점에서 개수만큼 간격·각도로 점을 만든다. */
export function buildArrayPoints(base,count,distance,angleDeg){
 const out=[];
 for(let i=0;i<count;i++)out.push(G.add(base,G.polar(distance*i,angleDeg)));
 return out;
}

/* ================================================================================================
   LTX(등간격 문자쓰기) — 명령행에서 여러 줄을 이어 입력하면 일정 줄간격으로 배치. 대화상자 없음(원문 확인).
   줄간격 배수(1.35)는 코드베이스가 이미 다행문자에 쓰는 줄간격 상수(view.js·plot.js 의 `e.height*1.35`)를 그대로 썼다.
   ================================================================================================ */
export function layoutLtxLines(basePoint,lines,height,lineHeightFactor=1.35){
 const list=(Array.isArray(lines)?lines:String(lines??'').split('\n')).filter(l=>l.trim()!=='');
 return list.map((text,i)=>({position:{x:basePoint.x,y:basePoint.y-i*height*lineHeightFactor},text}));
}

/* ================================================================================================
   QT(자주 쓰는 문장 골라쓰기) — 분류별 문장 저장소(원문의 `_CommonText.txt`에 해당, 여기서는 ctx.storage 에 JSON 으로).
   규칙서 지시대로, 목록 내용은 원문에서 확인되지 않았으므로 처음에는 비워 두고 사용자가 채운다.
   ================================================================================================ */
const QT_STORAGE_KEY='barun-qt-sentences';

export function loadSentenceLibrary(storage){
 try{
  const raw=storage?.getItem(QT_STORAGE_KEY);
  if(raw){const v=JSON.parse(raw);if(v&&Array.isArray(v.categories)&&v.sentences&&typeof v.sentences==='object')return v;}
 }catch{}
 return {categories:['기본'],sentences:{'기본':[]}};
}
export function saveSentenceLibrary(storage,lib){try{storage?.setItem(QT_STORAGE_KEY,JSON.stringify(lib));}catch{}}

export function addCategoryToLibrary(lib,category){
 const name=String(category??'').trim();
 if(!name)return lib;
 if(lib.categories.includes(name))return lib;
 if(lib.categories.length>=12)throw Error('분류는 최대 12개입니다(원문 QT 한계).');
 return {categories:[...lib.categories,name],sentences:{...lib.sentences,[name]:[]}};
}
export function addSentenceToLibrary(lib,category,sentence){
 const text=String(sentence??'').trim();
 if(!text)return lib;
 if(!lib.categories.includes(category))throw Error('먼저 분류를 만드세요.');
 const list=lib.sentences[category]||[];
 if(list.includes(text))return lib;
 return {...lib,sentences:{...lib.sentences,[category]:[...list,text]}};
}
export function applyUppercase(text,on){return on?String(text).toUpperCase():String(text);}

/** 지시선(꺾은선) + 문자를 함께 만든다. 문자 시작점은 지시선의 마지막 점(원문 "제작 공통 패턴 3"). */
export function buildLeaderEntities(points,text,height,layer){
 if(!Array.isArray(points)||points.length<2)throw Error('지시선 점이 최소 2개 필요합니다.');
 const last=points[points.length-1];
 return [
  {type:'polyline',layer,points:points.map(p=>({x:p.x,y:p.y})),closed:false},
  {type:'text',layer,position:{x:last.x,y:last.y},text,height,rotation:0,align:'left'},
 ];
}

/* ================================================================================================
   QW(특수문자입력기) — 원문은 별도 exe(SpecialChar.exe, 탭+그리드). 바른 CAD 는 클립보드 대신 클릭한 자리에 바로
   문자를 넣는다. 목록은 원문 사용법 문단에서 "확인된 창 구성"으로 명시된 6개 탭 이름은 모두 만들되, 글자 목록은
   그 문단에 실제로 나열된 것만 넣는다(도량형·화살표·원문자·로마숫자·수학기호·박스선 6가지). 원·괄호문자·일본문자·
   그리스·러시아문자·전각영문·한글자모 4개 탭은 원문에 구체 글자가 나열돼 있지 않아 빈 채로 두고, 사용자가
   ctx.storage 저장소에 직접 채워 쓰게 한다(규칙서 지시).
   ================================================================================================ */
export const QW_CATEGORY_DEFS=[
 {id:'unit',label:'도량형·단위 문자'},
 {id:'arrow',label:'화살표'},
 {id:'circled',label:'원문자'},
 {id:'roman',label:'로마숫자'},
 {id:'math',label:'수학기호'},
 {id:'box',label:'박스선 문자'},
 {id:'bracket',label:'원·괄호문자'},
 {id:'japanese',label:'일본문자'},
 {id:'greek-russian',label:'그리스·러시아문자'},
 {id:'fullwidth',label:'전각영문·한글자모'},
];
const QW_SEED={
 unit:['㎡','㎥','㎜','㎏'],
 arrow:['←','↑','→','↓'],
 circled:['ⓐ','ⓑ'],
 roman:['Ⅰ','Ⅱ'],
 math:['±','≠','≒','≤','≥','∞','√'],
 box:['┼','┴','┬','├','┤','┌','┐','└','┘'],
};
const QW_STORAGE_KEY='barun-qw-chars';

export function loadQwLibrary(storage){
 try{
  const raw=storage?.getItem(QW_STORAGE_KEY);
  if(raw){const v=JSON.parse(raw);if(v&&typeof v==='object')return v;}
 }catch{}
 return Object.fromEntries(QW_CATEGORY_DEFS.map(c=>[c.id,[...(QW_SEED[c.id]||[])]]));
}
export function saveQwLibrary(storage,lib){try{storage?.setItem(QW_STORAGE_KEY,JSON.stringify(lib));}catch{}}
export function addCharToCategory(lib,categoryId,ch){
 const c=String(ch??'');
 if(!c)return lib;
 const list=lib[categoryId]||[];
 if(list.includes(c))return lib;
 return {...lib,[categoryId]:[...list,c]};
}

/* ================================================================================================
   TTT(문자를 표로 모으기) — ctx 에 창(윈도우) 선택 도구가 없어 "문자선택" 중 "개별(하나씩)" 방식만 만든다
   ("영역" 두 방식은 아래 install 쪽에서 정직하게 "없음" 토스트로 안내한다). 결과표는 tableBlock(선+문자 조합,
   원문의 "일반표")을 그대로 쓴다. 정렬 4가지(상하/좌우/가나다순/선택순)는 모두 구현한다.
   ================================================================================================ */
const CHAR_CLASS_SYMBOL=0,CHAR_CLASS_DIGIT=1,CHAR_CLASS_LATIN=2,CHAR_CLASS_HANGUL=3;
function charClass(ch){
 if(/[0-9]/.test(ch))return CHAR_CLASS_DIGIT;
 if(/[a-zA-Z]/.test(ch))return CHAR_CLASS_LATIN;
 if(/[\uac00-\ud7a3]/.test(ch))return CHAR_CLASS_HANGUL;
 return CHAR_CLASS_SYMBOL;
}
/** 특수문자 → 숫자 → 영문 → 한글 순(원문 TTT [문자 정렬] "가나다순" 설명 그대로). */
export function korCompare(a,b){
 const s1=String(a??''),s2=String(b??'');
 const n=Math.max(s1.length,s2.length);
 for(let i=0;i<n;i++){
  const c1=s1[i],c2=s2[i];
  if(c1===undefined)return -1;
  if(c2===undefined)return 1;
  const k1=charClass(c1),k2=charClass(c2);
  if(k1!==k2)return k1-k2;
  if(c1!==c2)return c1<c2?-1:1;
 }
 return 0;
}
export function sortTextsForTable(entities,mode='topdown'){
 const list=[...entities];
 if(mode==='pick')return list;
 if(mode==='topdown')return list.sort((a,b)=>b.position.y-a.position.y||a.position.x-b.position.x);
 if(mode==='leftright')return list.sort((a,b)=>a.position.x-b.position.x||b.position.y-a.position.y);
 if(mode==='kor')return list.sort((a,b)=>korCompare(a.text,b.text));
 return list;
}
/** 문자열 목록(한 줄에 한 개)을 1열 표 블럭으로 만든다. */
export function buildTtTable(texts,{height=150,layer='default',name='TTT 표'}={},origin={x:0,y:0}){
 if(!texts.length)throw Error('모은 문자가 없습니다.');
 const rows=texts.map(t=>[t]);
 return tableBlock(rows,{x:origin.x,y:origin.y,height,layer,name});
}

/* ================================================================================================
   TOO(객체 붙는 문자 넣기) — line/polyline/rectangle 처럼 points 배열을 가진 객체를 따라 문자를 배치한다.
   arc·circle 은 points 가 없어 지원하지 않는다(install 쪽에서 정직하게 안내).
   ================================================================================================ */
export function nearestPointOnPolyline(points,p){
 let best=null,bestDist=Infinity;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i];
  const d=G.distanceToSegment(p,a,b);
  if(d<bestDist){
   bestDist=d;
   const ab=G.sub(b,a),ap=G.sub(p,a),len2=G.dot(ab,ab);
   const t=len2<G.EPS?0:Math.max(0,Math.min(1,G.dot(ap,ab)/len2));
   best={point:G.add(a,G.mul(ab,t)),segIndex:i-1,t};
  }
 }
 if(!best)throw Error('선을 따라갈 점이 부족합니다.');
 return best;
}
export function angleAtSegment(points,segIndex){
 const a=points[segIndex],b=points[segIndex+1];
 return G.angle(G.sub(b,a));
}
function pointAtArcLength(points,segLens,arcLen){
 if(arcLen<0)return null;
 let remain=arcLen;
 for(let i=0;i<segLens.length;i++){
  if(remain<=segLens[i]||i===segLens.length-1){
   const t=segLens[i]<=G.EPS?0:Math.max(0,Math.min(1,remain/segLens[i]));
   const a=points[i],b=points[i+1];
   return {point:G.add(a,G.mul(G.sub(b,a),t)),segIndex:i};
  }
  remain-=segLens[i];
 }
 return null;
}
/** 클릭한 시작점 근방부터, 글자 하나씩 spacing 만큼 곡선(폴리선)을 따라 배치하고 그 자리 접선각을 회전값으로 준다. */
export function layoutCurveText(points,startPoint,text,spacing){
 const chars=[...String(text)];
 if(!chars.length)return [];
 const segLens=[];for(let i=1;i<points.length;i++)segLens.push(G.dist(points[i-1],points[i]));
 if(!segLens.length)throw Error('선을 따라갈 구간이 없습니다.');
 const startInfo=nearestPointOnPolyline(points,startPoint);
 let cumBeforeStart=0;for(let i=0;i<startInfo.segIndex;i++)cumBeforeStart+=segLens[i];
 cumBeforeStart+=startInfo.t*segLens[startInfo.segIndex];
 const out=[];
 for(let i=0;i<chars.length;i++){
  const at=pointAtArcLength(points,segLens,cumBeforeStart+i*spacing);
  if(!at)break;
  out.push({position:at.point,text:chars[i],rotation:angleAtSegment(points,at.segIndex)});
 }
 return out;
}

/* ================================================================================================
   install: 명령 이름 → 실행 함수. ctx 는 규칙서 5절의 cardContext.
   ================================================================================================ */
export function installTextCreateTools(ctx){
 const textLayer=()=>ctx.ensureLayer(STD_LAYERS.text,'#ffffff');
 const baseHeight=()=>ctx.num('text-height',150);

 /* ── TII 영문/숫자 증가 입력 (izzarder.com/395) ── */
 async function runTII(){
  const layer=textLayer(),height=baseHeight();
  ctx.form('TII · 영문/숫자 증가 입력 (izzarder.com/395)',[
   {name:'prefix',label:'접두어',type:'text',value:''},
   {name:'start',label:'시작문자(숫자 또는 영문)',type:'text',value:'1'},
   {name:'suffix',label:'접미어',type:'text',value:''},
   {name:'mode',label:'입력 방식',type:'select',value:'single',options:[['single','하나씩(점을 찍을 때마다 증가)'],['array','등간격 연속(두 점으로 간격·각도 지정)']]},
   {name:'count',label:'등간격 개수(등간격 연속 전용)',type:'number',value:5},
   {name:'angleMode',label:'문자 각도(등간격 연속 전용)',type:'select',value:'fixed0',options:[['fixed0','0도 고정'],['follow','입력각도 따라감']]},
   {name:'align',label:'문자 정렬점',type:'select',value:'left',options:[['left','왼쪽'],['center','중심'],['right','오른쪽']]},
   {name:'height',label:'문자크기(mm)',type:'number',value:height},
   {name:'recycle',label:'입력 후 재순환(끝나면 이 설정으로 바로 다시 시작)',type:'checkbox',value:false},
  ],async v=>{
   const h=Number(v.height);if(!Number.isFinite(h)||h<=0)throw Error('문자크기는 양수입니다.');
   const build=(value,position,rotation)=>({type:'text',layer,position,text:v.prefix+value+v.suffix,height:h,rotation,align:v.align});
   if(v.mode==='array'){
    const count=boundedInteger(v.count,{min:1,max:TEXT_SERIES_MAX,label:'TII · 등간격 개수'});
    const path=await ctx.pickPath({prompt:'TII 등간격 연속 · 시작점과 끝점을 찍으세요 · Esc 취소',minPoints:2,maxPoints:2});
    if(!path)return;
    const values=buildIncrementSeries(v.start,count,1);
    const pts=lerpPoints(path.points[0],path.points[1],count);
    const rot=v.angleMode==='follow'?G.angle(G.sub(path.points[1],path.points[0])):0;
    try{
     ctx.commit({removeIds:[],entities:values.map((val,i)=>build(val,pts[i],rot))});
     ctx.toast(`TII · 문자 ${count}개 생성 · Ctrl+Z 로 되돌리기`);
    }catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}
   }else{
    let cur=v.start,n=0;
    for(;;){
     const p=await ctx.pickPoint(`TII 하나씩 · 점을 찍으면 값이 증가합니다${n?' · 지금까지 '+n+'개':''} · Esc 끝내기`);
     if(!p)break;
     try{ctx.commit({removeIds:[],entities:[build(cur,p,0)]});cur=nextTagValue(cur,1);n++;}
     catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);break;}
    }
    if(n)ctx.toast(`TII · 문자 ${n}개 생성 · Ctrl+Z 로 되돌리기`);
   }
   if(isChecked(v.recycle))runTII();
  });
 }

 /* ── DAT 살아있는 도면 제목 넣기 (izzarder.com/535) ── */
 async function runDAT(){
  const sel=ctx.selected().find(e=>e.type==='text');
  if(sel&&sel.datLinkedTo){
   const source=ctx.entities().find(e=>e.id===sel.datLinkedTo&&e.type==='text');
   if(!source)throw Error('원본 문자를 찾을 수 없습니다(삭제되었을 수 있습니다). DAT 는 자동 갱신(FIELD)이 아니라, 이 명령을 다시 실행해 손으로 동기화하는 방식입니다(바른 CAD 한계).');
   ctx.execute({type:'update',ids:[sel.id],changes:{text:source.text}});
   ctx.refresh();
   ctx.toast('DAT · 원본 문자 내용으로 갱신했습니다(수동 동기화).');
   return;
  }
  const source=sel||await ctx.pickEntity({prompt:'DAT · 원본 문자를 선택하세요(표제란 도면명 등)',types:['text']});
  if(!source)return;
  ctx.form('DAT · 살아있는 문자 복사 (izzarder.com/535) · 바른 CAD 에는 FIELD 가 없어 자동 갱신 대신 "복사본을 선택하고 DAT 다시 실행"으로 손으로 동기화합니다',[
   {name:'keepShape',label:'문자모양 가져오기',type:'checkbox',value:true},
   {name:'keepAlign',label:'문자정렬점 가져오기',type:'checkbox',value:true},
  ],async v=>{
   const p=await ctx.pickPoint('DAT · 연동 복사본을 놓을 위치를 클릭하세요');
   if(!p)return;
   const entity={type:'text',layer:source.layer,position:p,text:source.text,height:isChecked(v.keepShape)?source.height:baseHeight(),rotation:isChecked(v.keepShape)?(source.rotation||0):0,align:isChecked(v.keepAlign)?(source.align||'left'):'left',datLinkedTo:source.id};
   try{ctx.commit({removeIds:[],entities:[entity]});ctx.toast('DAT · 연동 복사본을 만들었습니다. 원본이 바뀌면 복사본을 선택하고 DAT 를 다시 실행해 갱신하세요(자동 갱신 아님) · Ctrl+Z 로 되돌리기');}
   catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}
  });
 }

 /* ── LTX 등 간격 문자열 쓰기 (izzarder.com/446, 대화상자 없음) ── */
 async function runLTX(){
  const layer=textLayer(),height=baseHeight();
  const base=await ctx.pickPoint('LTX · 등간격 문자쓰기 · 첫 줄 위치를 클릭하세요');
  if(!base)return;
  ctx.form('LTX · 등 간격 문자열 쓰기 (izzarder.com/446) · 줄마다 Enter 로 구분해 입력(명령행 대신 이 칸에 씀)',[
   {name:'lines',label:'문장(줄마다 Enter)',type:'textarea',value:''},
  ],v=>{
   const layout=layoutLtxLines(base,v.lines,height);
   if(!layout.length)throw Error('입력한 줄이 없습니다.');
   ctx.commit({removeIds:[],entities:layout.map(l=>({type:'text',layer,position:l.position,text:l.text,height,rotation:0,align:'left'}))});
   ctx.toast(`LTX · 문자 ${layout.length}줄 배치 · Ctrl+Z 로 되돌리기`);
  });
 }

 /* ── QT 자주 사용하는 문장 골라쓰기 (izzarder.com/107) ── */
 async function runQT(){
  const layer=textLayer(),height=baseHeight();
  let lib=loadSentenceLibrary(ctx.storage);
  const sentenceOptions=[['','(아래 "새 문장"에 직접 입력)'],...lib.categories.flatMap(cat=>(lib.sentences[cat]||[]).map(s=>[`${cat}\u0001${s}`,`[${cat}] ${s}`]))];
  ctx.form('QT · 자주 사용하는 문장 골라쓰기 (izzarder.com/107)',[
   {name:'pick',label:'저장된 문장',type:'select',value:'',options:sentenceOptions},
   {name:'newSentence',label:'새 문장(비우면 위에서 고른 문장을 씀)',type:'text',value:''},
   {name:'category',label:'분류(새 문장을 저장할 이름)',type:'text',value:lib.categories[0]||'기본'},
   {name:'uppercase',label:'대문자로 변경 삽입',type:'checkbox',value:false},
   {name:'leader',label:'지시선으로 넣기',type:'checkbox',value:false},
   {name:'angleLock',label:'지시선 각도 고정(지시선 전용)',type:'select',value:'free',options:[['free','고정 없음'],['0','0도'],['30','30도'],['45','45도'],['60','60도'],['90','90도']]},
  ],async v=>{
   let text=v.newSentence.trim();
   if(!text&&v.pick)text=v.pick.split('\u0001')[1]||'';
   if(!text)throw Error('문장을 고르거나 새로 입력하세요.');
   if(v.newSentence.trim()){
    const category=v.category.trim()||'기본';
    lib=addCategoryToLibrary(lib,category);
    lib=addSentenceToLibrary(lib,category,text);
    saveSentenceLibrary(ctx.storage,lib);
   }
   text=applyUppercase(text,isChecked(v.uppercase));
   if(isChecked(v.leader)){
    const path=await ctx.pickPath({prompt:'QT · 지시선 점을 순서대로 찍으세요(최소 2점) · Enter 완료 · Esc 취소',minPoints:2,maxPoints:3});
    if(!path)return;
    let points=path.points;
    if(v.angleLock!=='free'&&points.length>=2){
     const angle=Number(v.angleLock),base=points[0],last=points[points.length-1],dist=G.dist(base,last);
     points=[base,G.add(base,G.polar(dist,angle))];
    }
    try{ctx.commit({removeIds:[],entities:buildLeaderEntities(points,text,height,layer)});ctx.toast('QT · 지시선과 문장을 넣었습니다 · Ctrl+Z 로 되돌리기');}
    catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}
   }else{
    const p=await ctx.pickPoint('QT · 문장을 놓을 위치를 클릭하세요');
    if(!p)return;
    try{ctx.commit({removeIds:[],entities:[{type:'text',layer,position:p,text,height,rotation:0,align:'left'}]});ctx.toast('QT · 문장을 넣었습니다 · Ctrl+Z 로 되돌리기');}
    catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}
   }
  });
 }

 /* ── QW 특수문자입력기 (izzarder.com/182) ── */
 async function runQW(){
  let lib=loadQwLibrary(ctx.storage);
  const charOptions=[['','(직접 입력)'],...QW_CATEGORY_DEFS.flatMap(c=>(lib[c.id]||[]).map(ch=>[`${c.id}\u0001${ch}`,`[${c.label}] ${ch}`]))];
  ctx.form('QW · 특수문자입력기 (izzarder.com/182) · 원문은 별도 실행파일+클립보드지만 바른 CAD 는 클릭한 자리에 바로 넣습니다',[
   {name:'char',label:'문자를 고르세요',type:'select',value:'',options:charOptions},
   {name:'custom',label:'목록에 없으면 여기에 직접 입력(고른 분류에 저장됨)',type:'text',value:''},
   {name:'category',label:'직접 입력한 문자를 저장할 분류',type:'select',value:QW_CATEGORY_DEFS[0].id,options:QW_CATEGORY_DEFS.map(c=>[c.id,c.label])},
  ],async v=>{
   let ch=v.custom.trim();
   if(!ch&&v.char)ch=v.char.split('\u0001')[1]||'';
   if(!ch)throw Error('문자를 고르거나 입력하세요.');
   if(v.custom.trim()){lib=addCharToCategory(lib,v.category,ch);saveQwLibrary(ctx.storage,lib);}
   const p=await ctx.pickPoint(`QW · "${ch}" 를 넣을 위치를 클릭하세요`);
   if(!p)return;
   const layer=textLayer(),height=baseHeight();
   try{ctx.commit({removeIds:[],entities:[{type:'text',layer,position:p,text:ch,height,rotation:0,align:'left'}]});ctx.toast(`QW · "${ch}" 를 넣었습니다 · Ctrl+Z 로 되돌리기`);}
   catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}
  });
 }

 /* ── TIE 숫자증가(원본유지) (izzarder.com/183) ── */
 async function runTIE(){
  const original=await ctx.pickEntity({prompt:'TIE · 원본 문자열을 먼저 선택하세요',types:['text']});
  if(!original)return;
  ctx.form('TIE · 숫자증가(원본유지) (izzarder.com/183)',[
   {name:'position',label:'숫자 위치',type:'select',value:'back',options:[['back','뒤'],['front','앞']]},
   {name:'step',label:'증가간격(숫자, 또는 A/a = 영문자 증가)',type:'text',value:'1'},
   {name:'selectMode',label:'선택 방법',type:'select',value:'multi',options:[['multi','여러선택'],['single','단일선택']]},
  ],async v=>{
   const alpha=/^[A-Za-z]$/.test(v.step.trim());
   const kind=alpha?'alpha':'digit';
   const step=alpha?1:Number(v.step);
   if(!alpha&&(!Number.isFinite(step)||step===0))throw Error('증가간격은 0이 아닌 숫자이거나 A/a 입니다.');
   const targets=[];
   for(;;){
    const t=await ctx.pickEntity({prompt:`TIE · 대상 문자를 선택하세요${targets.length?' · 지금까지 '+targets.length+'개':''} · Esc 끝내기`,types:['text']});
    if(!t)break;
    targets.push(t);
    if(v.selectMode==='single')break;
   }
   if(!targets.length)return;
   try{
    const newTexts=computeTieSequence(original.text,targets.map(t=>t.text),{position:v.position,step,kind});
    ctx.execute({type:'batch',commands:targets.map((t,i)=>({type:'update',ids:[t.id],changes:{text:newTexts[i]}}))});
    ctx.refresh();
    ctx.toast(`TIE · ${targets.length}개 갱신 · Ctrl+Z 로 되돌리기`);
   }catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}
  });
 }

 /* ── TIN 숫자증가(비문자 포함) (izzarder.com/103) ── */
 async function runTIN(){
  const first=await ctx.pickEntity({prompt:'TIN · 숫자증가(비문자 포함) · 증가시킬 첫 대상을 선택하세요(문자·원·블럭 등)'});
  if(!first)return;
  const label=labelOf(first);
  if(!label)throw Error('선택한 객체(또는 내부 문자)에서 문자를 찾지 못했습니다.');
  const parts=splitAffixNumber(label.text);
  if(!parts.number)throw Error('선택한 문자에 숫자가 없습니다.');
  ctx.form('TIN · 숫자증가(비문자 포함) · 분해값 확인 (izzarder.com/103)',[
   {name:'prefix',label:'접두어',type:'text',value:parts.prefix},
   {name:'number',label:'숫자',type:'text',value:parts.number},
   {name:'suffix',label:'접미어',type:'text',value:parts.suffix},
   {name:'step',label:'숫자 증가간격',type:'number',value:1},
  ],async v=>{
   const step=Number(v.step);
   if(!Number.isFinite(step)||step===0)throw Error('증가간격은 0이 아닌 숫자입니다.');
   let current=v.number;
   const targets=[];
   for(;;){
    const t=await ctx.pickEntity({prompt:`TIN · 대상을 차례로 선택하세요(원, 블럭 등도 가능)${targets.length?' · 지금까지 '+targets.length+'개':''} · Esc 끝내기`});
    if(!t)break;
    targets.push(t);
   }
   if(!targets.length)return;
   const commands=[];
   let ok=0,skip=0;
   for(const t of targets){
    const l=labelOf(t);
    if(!l){skip++;continue;}
    current=incrementNumberString(current,step);
    commands.push(l.buildUpdate(v.prefix+current+v.suffix));
    ok++;
   }
   if(!ok)throw Error('대상에서 문자를 찾지 못했습니다(문자 객체이거나, 내부에 문자를 포함한 블럭이어야 합니다).');
   try{
    ctx.execute({type:'batch',commands});
    ctx.refresh();
    ctx.toast(`TIN · ${ok}개 갱신${skip?' · '+skip+'개는 문자 없어 건너뜀':''} · Ctrl+Z 로 되돌리기`);
   }catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}
  });
 }

 /* ── TIP 숫자증가(위치지정) (izzarder.com/181) ── */
 async function runTIP(){
  const target=await ctx.pickEntity({prompt:'TIP · 숫자증가(위치지정) · 문자열을 선택하세요',types:['text']});
  if(!target)return;
  const clickPoint=await ctx.pickPoint('TIP · 증가시킬 숫자 자리 근처를 클릭하세요');
  if(!clickPoint)return;
  const localX=clickPoint.x-target.position.x;
  const index=charIndexFromLocalX(localX,target.height,target.align||'left',target.text.length);
  const group=numberGroupAt(target.text,index);
  if(!group)throw Error('클릭한 자리 근처에서 숫자를 찾지 못했습니다.');
  ctx.form('TIP · 숫자증가(위치지정) (izzarder.com/181)',[
   {name:'mode',label:'배치',type:'select',value:'single',options:[['single','복사 기준점마다 하나씩'],['array','배열(A) · 개수/거리/각도']]},
   {name:'count',label:'배열 개수(배열 전용)',type:'number',value:4},
   {name:'distance',label:'배열 간격mm(배열 전용)',type:'number',value:target.height*2},
   {name:'angle',label:'배열 각도도(배열 전용)',type:'number',value:270},
  ],async v=>{
   if(v.mode==='array'){
    const count=boundedInteger(v.count,{min:1,max:TEXT_SERIES_MAX,label:'TIP · 배열 개수'});
    const base=await ctx.pickPoint('TIP · 배열 기준점을 클릭하세요');
    if(!base)return;
    const pts=buildArrayPoints(base,count,Number(v.distance),Number(v.angle));
    const entities=pts.map((pt,i)=>({type:'text',layer:target.layer,position:pt,text:incrementAtGroup(target.text,group,i+1),height:target.height,rotation:target.rotation||0,align:target.align||'left'}));
    try{ctx.commit({removeIds:[],entities});ctx.toast(`TIP · ${count}개 복사 · Ctrl+Z 로 되돌리기`);}
    catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}
   }else{
    let n=0;
    for(;;){
     const p=await ctx.pickPoint(`TIP · 복사 기준점을 클릭하세요${n?' · 지금까지 '+n+'개':''} · Esc 끝내기`);
     if(!p)break;
     n++;
     try{ctx.commit({removeIds:[],entities:[{type:'text',layer:target.layer,position:p,text:incrementAtGroup(target.text,group,n),height:target.height,rotation:target.rotation||0,align:target.align||'left'}]});}
     catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);break;}
    }
    if(n)ctx.toast(`TIP · ${n}개 복사 · Ctrl+Z 로 되돌리기`);
   }
  });
 }

 /* ── TOO 객체에 붙는 문자 넣기 (izzarder.com/538) ── */
 async function runTOO(){
  const height0=baseHeight();
  ctx.form('TOO · 객체 붙는 문자 넣기 (izzarder.com/538)',[
   {name:'mode',label:'설정',type:'select',value:'straight',options:[['straight','직선문장쓰기'],['curve','곡선문장쓰기'],['pick','문자선택(기존 문자를 객체 각도에 맞춤)']]},
   {name:'text',label:'문장입력(문자선택 모드에서는 무시)',type:'text',value:''},
   {name:'height',label:'문자높이mm',type:'number',value:height0},
   {name:'spacing',label:'문자간격mm(곡선문장쓰기 전용)',type:'number',value:Math.round(height0*1.2)},
  ],async v=>{
   const layer=textLayer();
   if(v.mode==='pick'){
    const textEntity=await ctx.pickEntity({prompt:'TOO · 각도를 맞출 기존 문자를 선택하세요',types:['text']});
    if(!textEntity)return;
    const target=await ctx.pickEntity({prompt:'TOO · 각도 기준이 될 객체(선·폴리선)를 선택하세요'});
    if(!target)return;
    if(!Array.isArray(target.points))throw Error('TOO 는 선·폴리선 계열 객체만 지원합니다(원·호는 아직 지원하지 않습니다).');
    try{
     const info=nearestPointOnPolyline(target.points,textEntity.position);
     ctx.execute({type:'update',ids:[textEntity.id],changes:{position:info.point,rotation:angleAtSegment(target.points,info.segIndex)}});
     ctx.refresh();
     ctx.toast('TOO · 문자를 객체 각도에 맞췄습니다 · Ctrl+Z 로 되돌리기');
    }catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}
    return;
   }
   if(!v.text.trim())throw Error('문장을 입력하세요.');
   const target=await ctx.pickEntity({prompt:'TOO · 문장을 따라 붙일 객체(선·폴리선)를 선택하세요'});
   if(!target)return;
   if(!Array.isArray(target.points))throw Error('TOO 는 선·폴리선 계열 객체만 지원합니다(원·호는 아직 지원하지 않습니다).');
   const p=await ctx.pickPoint('TOO · 문장을 시작할 위치를 클릭하세요(객체 위 가까운 점으로 붙습니다)');
   if(!p)return;
   try{
    if(v.mode==='straight'){
     const info=nearestPointOnPolyline(target.points,p);
     ctx.commit({removeIds:[],entities:[{type:'text',layer,position:info.point,text:v.text,height:Number(v.height),rotation:angleAtSegment(target.points,info.segIndex),align:'left'}]});
    }else{
     const chars=layoutCurveText(target.points,p,v.text,Number(v.spacing));
     if(!chars.length)throw Error('곡선 위에 배치할 공간이 없습니다.');
     ctx.commit({removeIds:[],entities:chars.map(c=>({type:'text',layer,position:c.position,text:c.text,height:Number(v.height),rotation:c.rotation,align:'left'}))});
    }
    ctx.toast('TOO · 문장을 객체를 따라 넣었습니다 · Ctrl+Z 로 되돌리기');
   }catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}
  });
 }

 /* ── TTT 문자를 표로 모으기 (izzarder.com/471) ── */
 async function runTTT(){
  ctx.form('TTT · 문자를 표로 모으기 (izzarder.com/471) · 창(윈도우) 선택 도구가 없어 "개별(하나씩)" 방식만 지원합니다',[
   {name:'sort',label:'문자 정렬',type:'select',value:'topdown',options:[['topdown','상하'],['leftright','좌우'],['kor','가나다순'],['pick','선택순']]},
   {name:'removeAfter',label:'표로 옮긴 뒤 원본 문자 삭제("문자삭제" 옵션)',type:'checkbox',value:false},
  ],async v=>{
   const picked=[];
   for(;;){
    const t=await ctx.pickEntity({prompt:`TTT · 표에 모을 문자를 하나씩 선택하세요${picked.length?' · 지금까지 '+picked.length+'개':''} · Esc 끝내기`,types:['text']});
    if(!t)break;
    picked.push(t);
   }
   if(!picked.length)return;
   const sorted=sortTextsForTable(picked,v.sort);
   const p=await ctx.pickPoint('TTT · 표를 놓을 위치(왼쪽 위)를 클릭하세요');
   if(!p)return;
   const layer=textLayer();
   try{
    const table=buildTtTable(sorted.map(t=>t.text),{height:baseHeight(),layer,name:'TTT 표'},p);
    const removeIds=isChecked(v.removeAfter)?sorted.map(t=>t.id):[];
    ctx.commit({removeIds,entities:[table]});
    ctx.toast(`TTT · 문자 ${sorted.length}개를 일반표로 모았습니다 · Ctrl+Z 로 되돌리기`);
   }catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}
  });
 }

 /* ── NUMC 자동 숫자 증가하여 쓰기 (추정 구현 · 전용 원문 게시글을 찾지 못함, izzarder.com/77 을 근거로 삼음) ── */
 async function runNUMC(){
  const layer=textLayer(),height=baseHeight();
  ctx.form('NUMC · 자동 숫자 증가하여 쓰기 (추정 구현 · 전용 원문 게시글을 찾지 못해 izzarder.com/77 "문자 또는 숫자 자동 증가" c:tag 함수를 근거로 삼았습니다)',[
   {name:'start',label:'시작 값(숫자 또는 영문)',type:'text',value:'1'},
  ],async v=>{
   let cur=v.start.trim();
   if(!cur)throw Error('시작 값을 입력하세요.');
   let n=0;
   for(;;){
    const p=await ctx.pickPoint(`NUMC · 점을 찍으면 값이 자동 증가합니다${n?' · 지금까지 '+n+'개':''} · Esc 끝내기`);
    if(!p)break;
    try{ctx.commit({removeIds:[],entities:[{type:'text',layer,position:p,text:cur,height,rotation:0,align:'left'}]});cur=nextTagValue(cur,1);n++;}
    catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);break;}
   }
   if(n)ctx.toast(`NUMC · ${n}개 생성(추정 구현) · Ctrl+Z 로 되돌리기`);
  });
 }

 /* ── MK 문단에 마스크 표시 (추정 구현 · 원문 게시글을 찾지 못함, 라벨만 근거. 이미 있는 TEXTMASK 와 사실상 같은
    기능이라 이름이 겹칠 수 있다 — 통합 담당이 조정) ── */
 function runMK(){
  const sel=ctx.selected().filter(e=>e.type==='text');
  if(!sel.length)throw Error('마스크를 적용할 문자를 먼저 선택하세요.');
  ctx.form('MK · 문단에 마스크 표시 (추정 구현 · reference-command-catalog.js 라벨만 근거, 원문 게시글 못 찾음)',[
   {name:'action',label:'동작',type:'select',value:'on',options:[['on','마스크 켜기'],['off','마스크 끄기']]},
   {name:'padding',label:'여백mm(켜기 전용)',type:'number',value:sel[0].height*0.25},
  ],v=>{
   const on=v.action==='on',padding=Number(v.padding);
   if(on&&(!Number.isFinite(padding)||padding<0))throw Error('여백은 0 이상입니다.');
   ctx.execute({type:'batch',commands:sel.map(e=>({type:'update',ids:[e.id],changes:{backgroundMask:on,maskPadding:on?padding:0}}))});
   ctx.refresh();
   ctx.toast(`MK · 문자 ${sel.length}개 마스크 ${on?'켜기':'끄기'} · Ctrl+Z 로 되돌리기`);
  });
 }

 /* 비평 11: 오류 처리는 app.js runCardCommand(보고·되돌리기 묶음) 한 곳에서 한다 — 모듈 안의 두 번째 감싸기는 뺐다. */
 const guard=fn=>fn;
 const commands={TII:runTII,DAT:runDAT,LTX:runLTX,QT:runQT,QW:runQW,TIE:runTIE,TIN:runTIN,TIP:runTIP,TOO:runTOO,TTT:runTTT,NUMC:runNUMC,MK:runMK};
 return Object.fromEntries(Object.entries(commands).map(([name,fn])=>[name,guard(fn)]));
}
