// 4차 병렬 작업(2026-09-21): 블럭 5개(ABX BAM BCH BEX BIN BSC 는 6개, 아래 표 참고) + 문자 2개(TIC TX) = 8개.
// 2차 검증(reports/2차_매핑검증_B_보고_20260921.md) "1. 블럭 및 외부참조"·"2. 문자 생성 및 증가" 절에서
// "부분"으로 판정한 것들이다 — 기존 바른 CAD 명령(BLOCKREPLACE/BLOCKEXPORT/BLOCKBASE/SCALE/EXPLODE/BLOCK/
// TEXTINCREMENT/TBOX)과 핵심은 겹치지만 원문의 대화상자·옵션·조작 순서가 빠져 있었다. 이 모듈은 그 바른 CAD 리습
// 이름 그대로(ABX BAM BCH BEX BIN BSC TIC TX) 원문 조작감의 카드를 새로 만든다. 기존 명령/파일은 손대지
// 않았다(규칙서 3절).
//
// 원문은 docs/izzarder-reference-20260921/references/15-block-xref.md(ABX/349 BAM/399 BIN/508 BEX/491
// BSC/485 BCH/179), 12-text-create.md(TIC/488 TX/355)를 먼저 읽고, 각 절 끝 izzarder.com/NNN 을 WebFetch 로
// 전부 다시 읽어 대조했다(정리본 "제작 방법"은 추정이므로 근거로 삼지 않고, 대화상자 항목·조작 순서만 원문
// 기준으로 옮겼다).
//
// 바른 CAD 블록 구조(engine.js 확인): 블록의 자식(entities)은 절대좌표로 그대로 담기고, block 엔티티에는
// AutoCAD 같은 "정의 테이블 + 실시간 공유" 개념이 없다(block.create 가 만든 인스턴스도 독립 사본). 그래서
// BAM의 "재정의(같은 이름이면 자동 갱신)"는 도면에 존재하는 같은 이름의 인스턴스들을 전부 찾아 내용을 교체하는
// 방식으로, BSC의 "X/Y 독립 축척"은 엔진의 공용 scale(균일 배율) 명령 대신 이 모듈이 직접 좌표를 변환하는
// 방식으로 만들었다. block-tools.js(허용된 순수 모듈)의 replaceBlock 을 BCH·BAM 재정의에 그대로 가져다 쓴다.
//
// 정직한 한계는 각 함수 주석과 install 안의 toast 문구, 보고서(reports/4차_block-text-tools-4_보고_20260921.md)
// "아직 없는 것"에 적는다.
import * as G from './geometry.js';
import {STD_LAYERS,openCardDialog,entitiesSvg} from './card-kit.js';
import {replaceBlock} from './block-tools.js';

/* ================================================================================================
   공통 헬퍼. 규칙(3·4절)상 다른 병렬 모듈(block-edit-tools.js 등)을 import 하지 않으므로, 겹치는 아주 작은
   헬퍼(블록 기준점·같은 이름 찾기)는 이 모듈 안에 다시 둔다.
   ================================================================================================ */

/** 블록의 기준점: position 이 있으면 그 값, 없으면 내부 범위 중심. */
export function blockAnchor(entity){
 if(entity?.type!=='block')throw Error('블록만 선택할 수 있습니다.');
 if(entity.position)return {x:entity.position.x,y:entity.position.y};
 const b=G.bounds([entity]);
 if(!b)throw Error('블록 범위를 계산할 수 없습니다(내부가 비어 있습니다).');
 return {x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2};
}

/** 도면 최상위 객체 중 같은 이름의 일반 블록(표·외부참조 제외) id 목록. */
export function matchingBlockIds(entities,name){
 if(!name)throw Error('블록 이름이 없습니다.');
 return (entities||[]).filter(e=>e.type==='block'&&!e.table&&!e.xref&&e.name===name).map(e=>e.id);
}

/* ================================================================================================
   ABX 블럭 분해 — 내부 모든 블럭 폭파 (xiAllBlockExplode, izzarder.com/349)
   대체: EXPLODE(engine.js "explode" — 한 단계만 자식으로 펼침, 재귀 없음, 옵션 없음).
   ABX 는 (1)중첩된 블럭을 끝까지 재귀적으로 풀고 (2)겉 블럭 유지 여부·속성블럭 보호·후처리(0번 켜/ByLayer)
   옵션을 준다. "독립폭파(E)"는 선택한 인스턴스 하나만(같은 이름 다른 인스턴스는 그대로) 새 이름으로 분리해
   처리한다.
   ================================================================================================ */

/** 자식 목록을 재귀적으로 평평하게 편다. 속성이 있는 하위 블록은 skipAttrBlocks 가 true 면 그대로 둔다. */
export function explodeBlockRecursive(entities,{skipAttrBlocks=true}={}){
 const out=[];
 for(const child of entities||[]){
  if(child.type==='block'){
   const hasAttrs=child.attributes&&Object.keys(child.attributes).length>0;
   if(skipAttrBlocks&&hasAttrs){out.push(child);continue;}
   const inner=explodeBlockRecursive(child.entities||[],{skipAttrBlocks});
   for(const e of inner)out.push(e.layer?e:{...e,layer:child.layer});
  }else out.push(child);
 }
 return out;
}

/** 폭파 후처리: 0번 켜로 변경 / 색·선모양을 ByLayer(속성 제거)로. */
export function finishExplodedEntities(list,{toLayer0=false,colorByLayer=false,linetypeByLayer=true}={}){
 return (list||[]).map(e=>{
  const n={...e};
  if(toLayer0)n.layer='0';
  if(colorByLayer)delete n.color;
  if(linetypeByLayer)delete n.linetype;
  return n;
 });
}

/** ABX 본체. keepOuter=true 면 겉 블럭(type:'block')을 남기고 내부만 평평하게 편 것을 돌려주고,
    false 면(기본값) 겉 블럭까지 풀어 최상위 원시 객체 배열을 돌려준다. 어느 쪽이든 "재귀"가 핵심이라
    한 단계만 여는 엔진 EXPLODE 와 다르다. */
export function explodeInnerBlocks(block,opts={}){
 if(block?.type!=='block')throw Error('블록만 선택할 수 있습니다.');
 const {keepOuter=false,skipAttrBlocks=true,toLayer0=false,colorByLayer=false,linetypeByLayer=true}=opts;
 const flat=finishExplodedEntities(explodeBlockRecursive(block.entities||[],{skipAttrBlocks}),{toLayer0,colorByLayer,linetypeByLayer});
 if(keepOuter)return {...block,entities:flat};
 return flat.map(e=>({...e,layer:e.layer||block.layer}));
}

/* ================================================================================================
   BAM 블럭 만들기 — 자동 블럭만들기 (xiBlockAutoMake, izzarder.com/399)
   대체: BLOCK(app.js "block.create"/engine.js — 이름 직접입력+기준점, 동일 이름 재정의는 명시적으로 거부).
   BAM 의 핵심은 "재실행 시 같은 이름 블럭 자동 재정의(업데이트)"다. 이 엔진엔 블록 정의 테이블이 없어(각
   인스턴스가 독립 사본), "재정의"를 도면에 있는 같은 이름의 모든 인스턴스에 새 내용을 교체 적용하는 것으로
   구현했다(block-tools.js 의 replaceBlock 재사용 — BCH 가 쓰는 것과 같은 함수).
   ================================================================================================ */

/** 삽입점: circle 모드면 사용자가 지정한 점, tag 모드면 태그(문자) 위치, 없으면 선택 범위 좌하귀. */
export function bamAnchor(selectedEntities,mode,tagEntity,circlePoint){
 if(mode==='circle'){
  if(!circlePoint)throw Error('원 중심점을 지정하세요.');
  return {x:circlePoint.x,y:circlePoint.y};
 }
 if(tagEntity)return {x:tagEntity.position.x,y:tagEntity.position.y};
 const b=G.bounds(selectedEntities);
 if(!b)throw Error('블록으로 만들 객체를 선택하세요.');
 return {x:b.minX,y:b.minY};
}

/** 도면에 이미 있는 같은 이름의 일반 블록 인스턴스(표·외부참조 제외). */
export function bamExistingInstances(entities,name){
 return (entities||[]).filter(e=>e.type==='block'&&!e.table&&!e.xref&&e.name===name);
}

/** 재정의 계획: 새로 선택한 도형을 "새 정의"로 삼아, 같은 이름의 기존 인스턴스마다 replaceBlock 으로
    내용을 교체한 변경사항을 돌려준다(각 인스턴스의 기존 위치·회전·축척은 replaceBlock 이 유지한다). */
export function bamRedefinePlan(selectedEntities,base,name,existingInstances){
 if(!existingInstances.length)throw Error('재정의할 기존 인스턴스가 없습니다.');
 const source={type:'block',name,position:{x:base.x,y:base.y},entities:selectedEntities.map(e=>{const c=structuredClone(e);delete c.id;return c;})};
 return existingInstances.map(target=>{
  const updated=replaceBlock(source,target);
  const {id,type,...changes}=updated;
  return {id:target.id,changes};
 });
}

/* ================================================================================================
   BCH 블럭 교체 — 블럭 교체하기 (xiChgBlock, izzarder.com/179)
   대체: BLOCKREPLACE(workflows.js 288 · block-tools.js replaceBlock — "선택한 것"만 대상, 선택 순서가
   반대(원문은 새 블럭을 먼저 고름), "모두(A)" 자동검색이 없어 인스턴스를 일일이 선택해야 함).
   이 카드는 새 블럭 → 교체 대상 1개 → 모두(A)/선택(S) 순서를 그대로 두고, "모두(A)"에서 같은 이름 전체를
   자동으로 찾는다. 설정(S)의 회전/축척/켜 유지 3개 체크박스(원문 스크린샷은 확인 못 함, 텍스트만 확인)는
   "회전·축척 유지" 하나(블록 모델에서 회전·축척이 함께 계산되는 상대변환이라 묶었다)와 "켜 유지"로 옮겼다.
   ================================================================================================ */

function boundsCenterOf(entity){
 const b=G.bounds([entity]);
 if(!b)throw Error('블록 범위를 계산할 수 없습니다.');
 return {x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2};
}

/** "회전·축척 유지 안 함": 대상의 기존 변환을 무시하고, 새 블럭 자기 모양 그대로 대상 위치에 옮겨 붙인다. */
export function placeSourceAsIs(source,target){
 if(source?.type!=='block'||target?.type!=='block')throw Error('블록만 교체할 수 있습니다.');
 const sourceAnchor=source.position||boundsCenterOf(source),targetAnchor=target.position||boundsCenterOf(target);
 const dx=targetAnchor.x-sourceAnchor.x,dy=targetAnchor.y-sourceAnchor.y;
 const entities=(source.entities||[]).map(child=>{const c=G.translate(structuredClone(child),dx,dy);delete c.id;return c;});
 return {...structuredClone(target),name:source.name,entities,position:targetAnchor,sharedBlock:undefined,xref:null};
}

/** BCH 한 건에 대한 update.changes 를 계산한다. */
export function planBchReplace(source,target,{keepTransform=true,keepLayer=true}={}){
 const base=keepTransform?replaceBlock(source,target):placeSourceAsIs(source,target);
 const {id,type,...changes}=base;
 if(!keepLayer)changes.layer=source.layer;
 return changes;
}

/* ================================================================================================
   BEX 블럭 내보내기 (xiExportBlock, izzarder.com/491)
   대체: BLOCKEXPORT(workflows.js 292 — 선택한 블록을 개별 DXF 로 저장. 옵션 없음).
   cardContext 에는 파일 저장 권한이 없다(api/output 이 없음 — block-edit-tools.js 가 이미 확인한 한계와
   같다). 그래서 이 카드는 "저장폴더 지정·켜별/색상별 묶음·접두어" 같은 파일 단계는 만들지 못하고, 원문이
   요구하는 "목록에서 골라 선택"(네이티브는 화면선택만 가능) 부분만 채운 뒤 ctx.run('BLOCKEXPORT')로 실제
   저장은 기존 명령에 맡긴다(규칙서 0절 "기존 명령 그대로면 ctx.run 사용 가능").
   ================================================================================================ */

/** 내보낼 수 있는 블록 이름·개수 목록(목록선택 UI용). */
export function listBlockNamesForExport(entities){
 const counts=new Map();
 for(const e of entities||[]){
  if(e.type!=='block'||e.table||e.xref)continue;
  const key=e.name||'(이름 없음)';
  counts.set(key,(counts.get(key)||0)+1);
 }
 return [...counts.entries()].sort((a,b)=>a[0].localeCompare(b[0],'ko',{numeric:true})).map(([name,count])=>({name,count}));
}

/** 고른 이름들에 해당하는 블록 id 전부. */
export function idsForBlockNames(entities,names){
 const set=new Set(names);
 return (entities||[]).filter(e=>e.type==='block'&&!e.table&&!e.xref&&set.has(e.name)).map(e=>e.id);
}

/* ================================================================================================
   BIN 블럭 삽입점 변경 (xiBchin, izzarder.com/508)
   대체: BLOCKBASE(workflows.js 290 — position 필드만 갱신, 표시 형상은 불변). 이건 원문의 방식(1)과
   정확히 같다. 방식(2, 삽입점 고정·블럭 자체 이동)이 통째로 빠져 있었다 — 이 카드가 두 방식을 라디오로
   모두 준다.
   ================================================================================================ */

/** 방식(1) 블럭 제자리 고정: 표시 형상은 그대로 두고 기준점 메타데이터(position)만 바꾼다. */
export function changeBlockBaseInPlace(block,newBase){
 if(block?.type!=='block')throw Error('블록만 선택할 수 있습니다.');
 return {position:{x:newBase.x,y:newBase.y}};
}

/** 방식(2) 삽입점 고정: 기준점이 새 좌표에 오도록 블럭 전체(자식 좌표 포함)를 옮긴다. */
export function moveBlockToNewBase(block,newBase){
 if(block?.type!=='block')throw Error('블록만 선택할 수 있습니다.');
 const anchor=block.position||boundsCenterOf(block);
 const dx=newBase.x-anchor.x,dy=newBase.y-anchor.y;
 const moved=G.translate(block,dx,dy);
 const {id,type,...changes}=moved;
 return changes;
}

/* ================================================================================================
   BSC 블럭 축척 — 블럭 축척변경 (xiBlockScaleChange, izzarder.com/485)
   대체: SCALE(app.js/engine.js "scale" — base점 기준 균일(X=Y) 배율 하나, 모든 엔티티 대상, 블록 전용 아님).
   BSC 의 정체성은 X/Y 독립(비대칭) 축척이다. 엔진의 scale 명령은 G.resize(균일 배율)만 있어, 이 카드는
   G.transformEntity 를 직접 불러 좌표를 X/Y 따로 변환한다. "기존값 불러오기" 버튼은 만들지 못했다(이 엔진은
   일반 블록의 현재 X/Y 축척을 별도로 저장하지 않는다 — block.scale 은 압축 공유 블록(sharedBlock)에만 쓰인다).
   ================================================================================================ */

/** 블럭 하나를 기준점 기준으로 X, Y 축척을 독립적으로 바꾼다. 원·문자 높이 등 스칼라 속성은
    기하평균(sqrt(sx*sy))으로 근사한다(비대칭 축척에서 원은 타원이 되어야 정확하지만, 이 엔진의 원 엔티티는
    반지름 하나뿐이라 완전한 타원 변환은 만들지 못했다). */
export function scaleBlockXY(block,sx,sy){
 if(block?.type!=='block')throw Error('블록만 축척을 바꿀 수 있습니다.');
 if(!(sx>0)||!(sy>0))throw Error('축척은 0보다 커야 합니다.');
 const base=block.position||boundsCenterOf(block);
 const scale=Math.sqrt(Math.abs(sx*sy)),map=p=>({x:base.x+(p.x-base.x)*sx,y:base.y+(p.y-base.y)*sy});
 const out=G.transformEntity(block,map,{scale});
 if(sx===sy||!Array.isArray(block.entities))return out;
 // 가로·세로가 다르면 블록 안의 원은 타원으로(2026-10-27 설명서 시험: 예전엔 √(sx·sy) 로 고르게 커졌다).
 return {...out,entities:out.entities.map((e,i)=>{const c=block.entities[i];if(c?.type!=='circle')return e;
  const rx=c.radius*sx,ry=c.radius*sy;
  const {radius,...rest}=c;
  return {...rest,type:'ellipse',center:map(c.center),majorAxis:rx>=ry?{x:rx,y:0}:{x:0,y:ry},ratio:Math.min(rx,ry)/Math.max(rx,ry)};})};
}

/** "미리지정": 기준거리/참조거리로 배율을 역산한다. */
export function refRatio(baseDist,refDist){
 if(!(baseDist>0)||!(refDist>0))throw Error('기준·참조 거리는 0보다 커야 합니다.');
 return refDist/baseDist;
}

/* ================================================================================================
   TIC 문자 증가 복사 — 숫자증가(원본변경) (xiAutoNumbering, izzarder.com/488)
   대체: TEXTINCREMENT(workflows.js 163 · 21행의 textEditor 'increment' 분기 — 선택된 기존 문자 전체에
   동일 start 값을 정규식으로 더함. 선행 0 보존·진법 변환·접두/숫자/접미 분해확인 대화상자 없음).
   이 카드가 채우는 것: 접두어/숫자/접미어 3분할 편집, "입력 숫자 +1부터 시작", "기존 숫자에 더하기"(포맷이
   같은 문자에만, 다르면 건너뜀 — 원문 "주의" 그대로), 선행 억제, 8/16진수 표시, 대상 한꺼번에/하나씩.
   "도곽선택"과 [켜와 문자 모양] 그룹은 만들지 못했다(도곽·문자스타일 개념이 카드 문맥에 없음 — 보고서 참고).
   ================================================================================================ */

/** "A-001b" → {prefix:'A-',number:'001',suffix:'b'}. 첫 숫자 앞까지가 접두어(소숫점은 다루지 않는다 —
    원문 TIC 대화상자 예시가 정수 일련번호 위주라 이 카드도 정수만 다룬다). */
export function splitPrefixNumberSuffix(str){
 const s=String(str??'');
 let i=0,prefix='';
 while(i<s.length&&!/[0-9]/.test(s[i])){prefix+=s[i];i++;}
 let number='';
 while(i<s.length&&/[0-9]/.test(s[i])){number+=s[i];i++;}
 return {prefix,number,suffix:s.slice(i)};
}

/** 정수를 지정 진법(8/10/16)으로 표시한다. suppressLeading 이 아니면 원래 자릿수만큼 0으로 채운다. */
export function formatNumberBase(n,base=10,{digits=0,suppressLeading=false}={}){
 if(!Number.isFinite(n))throw Error('숫자가 아닙니다.');
 const neg=n<0;
 let s=Math.abs(Math.round(n)).toString(base).toUpperCase();
 if(!suppressLeading&&digits>s.length)s=s.padStart(digits,'0');
 return (neg?'-':'')+s;
}

/** "기존 숫자에 더하기": source(선택한 첫 문자의 분해값)와 대상 문자열의 접두·접미가 같아야 한다(다르면
    던짐 — 원문 "1층 평면도"/"지하 1층 단면도" 예시와 같은 실패 사례). */
export function ticAddToTarget(source,targetText,{base=10,suppressLeading=false}={}){
 const t=splitPrefixNumberSuffix(targetText);
 if(!t.number)throw Error('대상 문자에 숫자가 없습니다: '+targetText);
 if(t.prefix!==source.prefix||t.suffix!==source.suffix)throw Error('포맷이 달라 더할 수 없습니다(NUC 류를 쓰세요): '+targetText);
 const value=parseInt(t.number,10)+parseInt(source.number,10);
 return t.prefix+formatNumberBase(value,base,{digits:t.number.length,suppressLeading})+t.suffix;
}

/** 대상에서 문자를 찾는다: text 엔티티면 자신, 속성이 있는 블록이면 첫 태그 문자, 아니면 첫 하위 문자. */
export function ticLabelOf(entity){
 if(!entity)return null;
 if(entity.type==='text')return {text:entity.text,apply:text=>({type:'update',ids:[entity.id],changes:{text}})};
 if(Array.isArray(entity.entities)){
  let idx=entity.entities.findIndex(e=>e.type==='text'&&e.attributeTag);
  if(idx<0)idx=entity.entities.findIndex(e=>e.type==='text');
  if(idx>=0){
   const child=entity.entities[idx];
   return {text:child.text,apply:text=>({type:'update',ids:[entity.id],changes:{entities:entity.entities.map((e,i)=>i===idx?{...e,text}:e)}})};
  }
 }
 return null;
}

/* ================================================================================================
   TX 문자 상자 — 문자에 테두리 그리기 (xiTextBox, izzarder.com/355)
   대체: TBOX(app.js 3883 — 기존 선택 문자 주변에 패딩값만으로 사각 폴리선 테두리, 단일 옵션).
   원문 7개 그룹 중 이 카드가 만든 것: [모서리 형식](12종 중 사각/둥근사각/원형/다각(면수 지정) 4종 — 나머지
   8종은 곡선·경사 변형이라 이 모듈의 기하 함수로는 만들지 못했다), [입력문자](새 문자+대문자, 또는 기존
   문자에 테두리), [문자와 테두리](문자높이·켜), [테두리 폭/높이](간격, 다각 면수, 모서리반경). 만들지 못한
   것: WipeOut(바른 CAD 에 WipeOut 객체 없음), "폭/높이 고정 + 불변" 최소값/절대값 구분(간격만 지원), 문자
   목록 저장소, "문자와 연동"(정적 생성이라 이후 문자 크기 변경에 따라가는 연동은 의미가 없음) — 보고서 참고.
   ================================================================================================ */

/** 회전 0, 위치(0,0) 기준의 문자 로컬 경계상자(align·줄바꿈 포함, geometry.js 의 실제 text 경계 계산 재사용). */
function localTextBox(text,height,align='left'){
 const b=G.bounds([{type:'text',text,height,align,position:{x:0,y:0},rotation:0}]);
 if(!b)throw Error('문자 범위를 계산할 수 없습니다.');
 return b;
}

/** 로컬 점을 문자의 실제 위치·회전으로 옮긴다(geometry.js 의 text vertices() 와 같은 공식). */
function toWorldFromLocal(local,anchor,rotation){
 return G.add(anchor,G.polar(G.len(local),G.angle(local)+(rotation||0)));
}

export function textBoxRectPoints(box,padX,padY){
 return G.rectangle({x:box.minX-padX,y:box.minY-padY},{x:box.maxX+padX,y:box.maxY+padY});
}

export function textBoxRoundedRectPoints(box,padX,padY,radius,segsPerCorner=4){
 const x0=box.minX-padX,y0=box.minY-padY,x1=box.maxX+padX,y1=box.maxY+padY;
 const r=Math.max(0,Math.min(radius,(x1-x0)/2,(y1-y0)/2));
 if(r<=0)return textBoxRectPoints(box,padX,padY);
 const corners=[{cx:x1-r,cy:y0+r,start:-90,end:0},{cx:x1-r,cy:y1-r,start:0,end:90},{cx:x0+r,cy:y1-r,start:90,end:180},{cx:x0+r,cy:y0+r,start:180,end:270}];
 const pts=[];
 for(const c of corners)for(let i=0;i<=segsPerCorner;i++){const a=c.start+(c.end-c.start)*i/segsPerCorner;pts.push(G.add({x:c.cx,y:c.cy},G.polar(r,a)));}
 return pts;
}

export function textBoxPolygonPoints(box,padX,padY,sides){
 if(!Number.isInteger(sides)||sides<3)throw Error('면수는 3 이상 정수입니다.');
 const cx=(box.minX+box.maxX)/2,cy=(box.minY+box.maxY)/2;
 const w=(box.maxX-box.minX)/2+padX,h=(box.maxY-box.minY)/2+padY;
 const radius=Math.hypot(w,h);
 const pts=[];
 for(let i=0;i<sides;i++){const a=90+360*i/sides;pts.push(G.add({x:cx,y:cy},G.polar(radius,a)));}
 return pts;
}

/** 원형 모서리: 로컬 중심·반지름만 계산(엔티티는 install 쪽에서 world 로 옮겨 만든다). */
export function textBoxCircleLocal(box,padX,padY){
 return {cx:(box.minX+box.maxX)/2,cy:(box.minY+box.maxY)/2,radius:Math.hypot((box.maxX-box.minX)/2+padX,(box.maxY-box.minY)/2+padY)};
}

/** TX 본체: textEntity(문자 위치·회전 포함) 주위에 shape('rect'|'round'|'circle'|'poly') 테두리 엔티티를 만든다. */
export function buildTextBoxBorder(textEntity,shape,opts={}){
 const {padX=(textEntity.height||1)*0.5,padY=(textEntity.height||1)*0.3,cornerRadius=(textEntity.height||1)*0.3,sides=6,layer}=opts;
 const box=localTextBox(textEntity.text,textEntity.height,textEntity.align||'left');
 const anchor=textEntity.position,rotation=textEntity.rotation||0;
 if(shape==='circle'){
  const c=textBoxCircleLocal(box,padX,padY);
  return {type:'circle',layer,center:toWorldFromLocal({x:c.cx,y:c.cy},anchor,rotation),radius:c.radius};
 }
 let localPts;
 if(shape==='rect')localPts=textBoxRectPoints(box,padX,padY);
 else if(shape==='round')localPts=textBoxRoundedRectPoints(box,padX,padY,cornerRadius);
 else if(shape==='poly')localPts=textBoxPolygonPoints(box,padX,padY,sides);
 else throw Error('알 수 없는 테두리 모양입니다: '+shape);
 return {type:'polyline',layer,closed:true,points:localPts.map(p=>toWorldFromLocal(p,anchor,rotation))};
}

/* ================================================================================================
   install: 명령 이름 → 실행 함수. ctx 는 규칙서 5절의 cardContext.
   ================================================================================================ */
export function installBlockTextTools4(ctx){
 const guard=fn=>async(...args)=>{try{await fn(...args);}catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}};

 async function pickBlock(prompt){
  let target=ctx.selected().find(e=>e.type==='block'&&!e.table);
  if(!target)target=await ctx.pickEntity({prompt:prompt+' · Esc 취소',types:['block']});
  if(!target)return null;
  if(target.sharedBlock){ctx.execute({type:'shared.materialize',ids:[target.id]});target=ctx.entities().find(e=>e.id===target.id);}
  return target;
 }

 /* ── ABX 블럭 분해 (옵션 6개 → 11절 기준 openCardDialog, slots:1) ── */
 async function abx(){
  const target=await pickBlock('ABX · 내부 모든 블럭 폭파 · 블록을 클릭하세요');
  if(!target)return;
  const opsOf=values=>({keepOuter:!!values.keepOuter,skipAttrBlocks:!!values.skipAttr,toLayer0:!!values.toLayer0,colorByLayer:!!values.colorByLayer,linetypeByLayer:!!values.linetypeByLayer});
  openCardDialog({
   ctx,title:'ABX · 내부 모든 블럭 폭파 (izzarder.com/349)',storageKey:'barun4-abx',slots:1,goLabel:'폭파',
   fields:[
    {key:'keepOuter',label:'겉 블럭 유지(내부만 폭파)',type:'check',def:false},
    {key:'skipAttr',label:'속성블럭 보호',type:'check',def:true},
    {key:'toLayer0',label:'0번 켜로 변경',type:'check',def:false},
    {key:'colorByLayer',label:'색 ByLayer',type:'check',def:false},
    {key:'linetypeByLayer',label:'선모양 ByLayer',type:'check',def:true},
    {key:'scope',label:'적용 범위',type:'select',def:'all',options:[['all','같은 이름 전체'],['one','독립폭파(E)']]},
   ],
   preview:(values,shared,{width,height})=>{try{const result=explodeInnerBlocks(target,opsOf(values));const list=Array.isArray(result)?result:(result.entities||[]);return entitiesSvg(list,{width,height,label:'ABX 결과'});}catch{return entitiesSvg([],{width,height});}},
   note:'재귀적으로 내부 블럭을 전부 풀어냅니다(엔진 EXPLODE 는 한 단계만 풉니다).',
   onGo:(values)=>{
    const opts=opsOf(values);
    const scope=values.scope==='all'?matchingBlockIds(ctx.entities(),target.name):[target.id];
    const fresh=ctx.entities();
    const commands=[];
    for(const id of scope){
     const e=fresh.find(x=>x.id===id);
     if(!e)continue;
     const result=explodeInnerBlocks(e,opts);
     if(Array.isArray(result))commands.push({type:'delete',ids:[id]},{type:'addMany',entities:result});
     else{const changes={...result};delete changes.id;delete changes.type;if(values.scope==='one')changes.name=(e.name||'블록')+'-EXP';commands.push({type:'update',ids:[id],changes});}
    }
    if(!commands.length)throw Error('폭파할 블록을 찾지 못했습니다.');
    ctx.execute({type:'batch',commands});
    ctx.refresh();
    ctx.toast('ABX · 블록 '+scope.length+'개를 재귀적으로 폭파했습니다(속성블럭 판정·ArrayClassicBlock 은 바른 CAD 구조상 근사치입니다) · Ctrl+Z 로 되돌리기');
   },
  });
 }

 /* ── BAM 블럭 만들기 ── */
 async function bam(){
  const selected=ctx.selected();
  if(!selected.length)throw Error('블록으로 만들 객체를 먼저 선택하세요.');
  const tagCandidate=selected.find(e=>e.type==='text');
  ctx.form('BAM · 자동 블럭만들기 (izzarder.com/399) · 같은 이름이 이미 있으면 자동으로 재정의합니다',[
   {name:'name',label:'블록이름(특성블럭 태그값)',value:tagCandidate?.text||''},
   {name:'baseMode',label:'삽입점',value:'tag',options:[['tag','특성블럭삽입점(선택한 문자 위치, 없으면 선택 범위 좌하귀)'],['circle','Defpoints_원(화면에서 원 중심 클릭)']]},
   {name:'excludeLocked',label:'잠긴 켜 객체 제외',type:'checkbox',value:false},
  ],async v=>{
   const name=v.name.trim();
   if(!name)throw Error('블록 이름을 입력하세요.');
   let entities=selected;
   if(v.excludeLocked==='on'){
    const locked=new Set(ctx.layers().filter(l=>l.locked).map(l=>l.id));
    entities=entities.filter(e=>!locked.has(e.layer));
   }
   if(!entities.length)throw Error('제외 후 남은 객체가 없습니다.');
   let base;
   if(v.baseMode==='circle'){
    const p=await ctx.pickPoint('BAM · 원 중심(삽입점)을 클릭하세요 · Esc 취소');
    if(!p)return;
    base=p;
   }else base=bamAnchor(entities,'tag',tagCandidate,null);
   const existing=bamExistingInstances(ctx.entities(),name).filter(e=>!entities.some(s=>s.id===e.id));
   if(!existing.length){
    ctx.execute({type:'block.create',ids:entities.map(e=>e.id),base,name});
    ctx.refresh();
    ctx.toast('BAM · 블록 "'+name+'"을(를) 새로 만들었습니다 · Ctrl+Z 로 되돌리기');
   }else{
    const plans=bamRedefinePlan(entities,base,name,existing);
    ctx.execute({type:'batch',commands:[...plans.map(p=>({type:'update',ids:[p.id],changes:p.changes})),{type:'delete',ids:entities.map(e=>e.id)}]});
    ctx.refresh();
    ctx.toast('BAM · 같은 이름의 블록 '+existing.length+'개를 재정의했습니다(선택한 새 도형은 정의에 흡수됩니다) · Ctrl+Z 로 되돌리기');
   }
  });
 }

 /* ── BCH 블럭 교체 ── */
 async function bch(){
  const source=await pickBlock('BCH · 새로운(바꿀 모양) 블록을 먼저 선택하세요');
  if(!source)return;
  const firstTarget=await ctx.pickEntity({prompt:'BCH · 교체될(바뀔) 블록 하나를 선택하세요 · Esc 취소',types:['block']});
  if(!firstTarget)return;
  if(firstTarget.id===source.id)throw Error('새 블록과 교체 대상이 같습니다. 다른 블록을 선택하세요.');
  const sameName=matchingBlockIds(ctx.entities(),firstTarget.name).filter(id=>id!==source.id);
  ctx.form('BCH · 블럭 교체하기 (izzarder.com/179) · 설정(S)',[
   {name:'scope',label:'교체 범위',value:'all',options:[['all','모두(A) · 같은 이름 전체 ('+sameName.length+'개)'],['one','선택(S) · 방금 고른 블록만']]},
   {name:'keepTransform',label:'회전·축척 유지(대상 위치의 기존 회전·크기 유지)',type:'checkbox',value:true},
   {name:'keepLayer',label:'켜 유지(대상의 기존 켜 유지)',type:'checkbox',value:true},
  ],v=>{
   const ids=v.scope==='all'?sameName:[firstTarget.id];
   if(!ids.length)throw Error('교체할 블록이 없습니다.');
   const fresh=ctx.entities();
   const commands=ids.map(id=>{
    const target=fresh.find(e=>e.id===id);
    if(!target)return null;
    return {type:'update',ids:[id],changes:planBchReplace(source,target,{keepTransform:v.keepTransform==='on',keepLayer:v.keepLayer==='on'})};
   }).filter(Boolean);
   if(!commands.length)throw Error('교체할 블록을 찾지 못했습니다.');
   ctx.execute({type:'batch',commands});
   ctx.refresh();
   ctx.toast('BCH · 블록 '+commands.length+'개를 "'+(source.name||'')+'"(으)로 교체했습니다 · Ctrl+Z 로 되돌리기');
  });
 }

 /* ── BEX 블럭 내보내기 ── */
 async function bex(){
  const list=listBlockNamesForExport(ctx.entities());
  if(!list.length)throw Error('내보낼 블록이 도면에 없습니다.');
  ctx.form('BEX · 블럭 내보내기 (izzarder.com/491) · 고른 블록을 기존 BLOCKEXPORT(개별 DXF 저장)로 내보냅니다',[
   ...list.map((b,i)=>({name:'b'+i,label:b.name+' ('+b.count+'개)',type:'checkbox',value:false})),
   {name:'excludeLocked',label:'잠긴 켜 제외',type:'checkbox',value:false},
  ],async v=>{
   const chosenNames=list.filter((b,i)=>v['b'+i]==='on').map(b=>b.name);
   if(!chosenNames.length)throw Error('내보낼 블록을 하나 이상 고르세요.');
   let ids=idsForBlockNames(ctx.entities(),chosenNames);
   if(v.excludeLocked==='on'){
    const locked=new Set(ctx.layers().filter(l=>l.locked).map(l=>l.id)),all=ctx.entities();
    ids=ids.filter(id=>{const e=all.find(x=>x.id===id);return e&&!locked.has(e.layer);});
   }
   if(!ids.length)throw Error('내보낼 블록이 남지 않았습니다.');
   ctx.setSelected(ids);
   await ctx.run('BLOCKEXPORT');
   ctx.toast('BEX · '+ids.length+'개 블록을 DXF 로 내보냈습니다(저장폴더 기억·켜별/색상별 묶음·접두어는 카드 문맥에 파일 접근이 없어 아직 없습니다).');
  });
 }

 /* ── BIN 블럭 삽입점 변경 ── */
 async function bin(){
  const targets=ctx.selected().filter(e=>e.type==='block'&&!e.table);
  if(!targets.length)throw Error('삽입점을 바꿀 블록을 먼저 선택하세요.');
  ctx.form('BIN · 블럭 삽입점 변경 (izzarder.com/508)',[
   {name:'mode',label:'방식',value:'inplace',options:[['inplace','블럭 제자리 고정(삽입점만 변경, 표시 형상 유지)'],['move','삽입점 고정(블럭 자체 이동)']]},
  ],async v=>{
   const p=await ctx.pickPoint('BIN · 새 삽입점을 클릭하세요 · Esc 취소');
   if(!p)return;
   const commands=targets.map(t=>({type:'update',ids:[t.id],changes:v.mode==='inplace'?changeBlockBaseInPlace(t,p):moveBlockToNewBase(t,p)}));
   ctx.execute({type:'batch',commands});
   ctx.refresh();
   ctx.toast('BIN · 블록 '+targets.length+'개의 삽입점을 바꿨습니다('+(v.mode==='inplace'?'표시 형상 유지':'블록도 함께 이동')+') · Ctrl+Z 로 되돌리기');
  });
 }

 /* ── BSC 블럭 축척 (옵션 7개 → openCardDialog, slots:1) ── */
 function bscFactors(values){
  let sx=Number(values.x),sy=values.sameXY?sx:Number(values.y);
  if(Number(values.screenRefBase)>0&&Number(values.screenRefTarget)>0){
   const ratio=refRatio(Number(values.screenRefBase),Number(values.screenRefTarget));
   sx=values.mode==='ratio'?sx*ratio:ratio;
   sy=values.sameXY?sx:(values.mode==='ratio'?sy*ratio:ratio);
  }
  return {sx,sy};
 }
 async function bsc(){
  const targets=ctx.selected().filter(e=>e.type==='block'&&!e.table);
  if(!targets.length)throw Error('축척을 바꿀 블록을 먼저 선택하세요.');
  openCardDialog({
   ctx,title:'BSC · 블럭 축척변경 (izzarder.com/485)',storageKey:'barun4-bsc',slots:1,goLabel:'적용',
   fields:[
    {key:'mode',label:'모드',type:'select',def:'ratio',options:[['absolute','절대값'],['ratio','비율']]},
    {key:'x',label:'X축척/비율',type:'number',def:1,step:0.01},
    {key:'sameXY',label:'Y = X',type:'check',def:false},
    {key:'y',label:'Y축척/비율',type:'number',def:1,step:0.01,when:values=>!values.sameXY},
    {key:'screenRefBase',label:'미리지정 · 기준거리',type:'number',def:0,group:'화면에서 비율 지정'},
    {key:'screenRefTarget',label:'미리지정 · 참조거리',type:'number',def:0,group:'화면에서 비율 지정'},
    {key:'recycle',label:'입력 후 재순환',type:'check',def:false},
   ],
   preview:(values,shared,{width,height})=>{try{const {sx,sy}=bscFactors(values);return entitiesSvg([scaleBlockXY(targets[0],sx,sy)],{width,height,label:'X'+sx.toFixed(2)+' Y'+sy.toFixed(2)});}catch{return entitiesSvg([],{width,height});}},
   note:'X·Y 축척을 따로 바꿉니다("기존값 불러오기"는 블록별 현재 축척을 저장하지 않아 없습니다).',
   onGo:(values)=>{
    const {sx,sy}=bscFactors(values);
    if(!(sx>0)||!(sy>0))throw Error('축척은 0보다 커야 합니다.');
    const commands=targets.map(t=>{const scaled=scaleBlockXY(t,sx,sy);const changes={...scaled};delete changes.id;delete changes.type;return {type:'update',ids:[t.id],changes};});
    ctx.execute({type:'batch',commands});
    ctx.refresh();
    ctx.toast('BSC · 블록 '+targets.length+'개의 X'+sx.toFixed(3)+' / Y'+sy.toFixed(3)+' 축척을 바꿨습니다 · Ctrl+Z 로 되돌리기');
    if(values.recycle)bsc();
   },
  });
 }

 /* ── TIC 문자 증가 복사 (옵션 9개 → openCardDialog, slots:1) ── */
 async function tic(){
  const first=await ctx.pickEntity({prompt:'TIC · 숫자증가(원본변경) · 기준이 될 문자(또는 속성이 있는 블록)를 선택하세요'});
  if(!first)return;
  const label=ticLabelOf(first);
  if(!label)throw Error('선택한 객체에서 문자를 찾지 못했습니다(문자 또는 속성이 있는 블록을 선택하세요).');
  const parts=splitPrefixNumberSuffix(label.text);
  if(!parts.number)throw Error('선택한 문자에 숫자가 없습니다.');
  openCardDialog({
   ctx,title:'TIC · 숫자증가(원본변경) · 분해값 확인 (izzarder.com/488)',storageKey:'barun4-tic',slots:1,goLabel:'대상 선택 시작',
   fields:[
    {key:'prefix',label:'접두어',type:'text',def:parts.prefix,group:'분해값'},
    {key:'number',label:'숫자',type:'text',def:parts.number,group:'분해값'},
    {key:'suffix',label:'접미어',type:'text',def:parts.suffix,group:'분해값'},
    {key:'startPlusOne',label:'입력 숫자 +1부터 시작',type:'check',def:false,group:'증가 숫자'},
    {key:'addMode',label:'기존 숫자에 더하기',type:'check',def:false,group:'증가 숫자'},
    {key:'suppressLeading',label:'선행 억제',type:'check',def:false,group:'증가 숫자'},
    {key:'base',label:'숫자 진법',type:'select',def:'10',options:[['8','8진수'],['10','10진수'],['16','16진수']],group:'증가 숫자'},
    {key:'target',label:'대상 객체',type:'select',def:'batch',options:[['batch','한꺼번에'],['one','하나씩']],group:'대상'},
    {key:'order',label:'한꺼번에 순서',type:'select',def:'topdown',options:[['topdown','위→아래'],['pick','선택한 순서']],when:values=>values.target==='batch',group:'대상'},
   ],
   preview:(values,shared,{width,height})=>{
    try{
     const base=Number(values.base),step=values.startPlusOne?1:0;
     const sample=values.prefix+formatNumberBase(parseInt(values.number,10)+step,base,{digits:values.number.length,suppressLeading:values.suppressLeading})+values.suffix;
     return entitiesSvg([{type:'text',position:{x:0,y:0},text:sample,height:100,align:'left'}],{width,height,label:'다음 값 미리보기'});
    }catch{return entitiesSvg([],{width,height});}
   },
   note:'대상 객체는 여기서 고르지 않고, [대상 선택 시작]을 누른 뒤 도면에서 클릭으로 고릅니다.',
   onGo:async(values)=>{
    const base=Number(values.base),startStep=values.startPlusOne?1:0,addMode=!!values.addMode,suppressLeading=!!values.suppressLeading;
    const applyOne=(current,targetText)=>{
     if(addMode)return ticAddToTarget({prefix:values.prefix,suffix:values.suffix,number:values.number},targetText,{base,suppressLeading});
     return values.prefix+formatNumberBase(current,base,{digits:values.number.length,suppressLeading})+values.suffix;
    };
    if(values.target==='one'){
     let cur=parseInt(values.number,10)+startStep,n=0;
     for(;;){
      const t=await ctx.pickEntity({prompt:'TIC · 대상을 하나씩 선택하세요'+(n?' · 지금까지 '+n+'개':'')+' · Esc 끝내기'});
      if(!t)break;
      const tl=ticLabelOf(t);
      if(!tl){ctx.toast('TIC · 문자를 찾지 못해 건너뜁니다.',true);continue;}
      try{ctx.execute(tl.apply(applyOne(cur,tl.text)));ctx.refresh();cur++;n++;}
      catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}
     }
     if(n)ctx.toast('TIC · '+n+'개 갱신 · Ctrl+Z 로 되돌리기');
     return;
    }
    const targets=[];
    for(;;){
     const t=await ctx.pickEntity({prompt:'TIC · 한꺼번에 · 대상을 선택하세요'+(targets.length?' · 지금까지 '+targets.length+'개':'')+' · Esc 끝내기'});
     if(!t)break;
     const tl=ticLabelOf(t);
     if(!tl){ctx.toast('TIC · 문자를 찾지 못해 건너뜁니다.',true);continue;}
     const anchor=t.position||(G.bounds([t])?{x:G.bounds([t]).minX,y:G.bounds([t]).maxY}:{x:0,y:0});
     targets.push({label:tl,anchor});
    }
    if(!targets.length)return;
    const ordered=values.order==='pick'?targets:[...targets].sort((a,b)=>b.anchor.y-a.anchor.y||a.anchor.x-b.anchor.x);
    const commands=[];let skipped=0,cur=parseInt(values.number,10)+startStep;
    for(const tg of ordered){
     try{commands.push(tg.label.apply(applyOne(cur,tg.label.text)));cur++;}
     catch{skipped++;}
    }
    if(!commands.length)throw Error('적용할 대상이 없습니다'+(skipped?'(포맷이 달라 '+skipped+'개 제외)':'')+'.');
    ctx.execute({type:'batch',commands});
    ctx.refresh();
    ctx.toast('TIC · '+commands.length+'개 갱신'+(skipped?' · 포맷이 달라 '+skipped+'개 건너뜀':'')+' · Ctrl+Z 로 되돌리기');
   },
  });
 }

 /* ── TX 문자 상자 (옵션 9개 → openCardDialog, slots:1) ── */
 async function tx(){
  openCardDialog({
   ctx,title:'TX · 문자에 테두리 그리기 (izzarder.com/355)',storageKey:'barun4-tx',slots:1,goLabel:'대상 선택',
   fields:[
    {key:'mode',label:'대상',type:'select',def:'existing',options:[['existing','기존 문자'],['new','새 문자 입력']]},
    {key:'text',label:'새 문자',type:'text',def:'NOTE',when:values=>values.mode==='new'},
    {key:'uppercase',label:'대문자로',type:'check',def:false,when:values=>values.mode==='new'},
    {key:'height',label:'문자높이mm',type:'number',def:ctx.num('text-height',150),when:values=>values.mode==='new'},
    {key:'shape',label:'모서리 형식',type:'select',def:'rect',options:[['rect','사각'],['round','둥근사각'],['circle','원형'],['poly','다각']]},
    {key:'sides',label:'면수',type:'number',def:6,when:values=>values.shape==='poly'},
    {key:'cornerRadius',label:'모서리반경mm',type:'number',def:3,when:values=>values.shape==='round'},
    {key:'padX',label:'좌우 간격mm',type:'number',def:5},
    {key:'padY',label:'상하 간격mm',type:'number',def:3},
   ],
   preview:(values,shared,{width,height})=>{
    try{
     const h=Number(values.height)||150,sample=values.mode==='new'?(values.uppercase?String(values.text||'').toUpperCase():(values.text||'NOTE')):'가나다';
     const text={type:'text',position:{x:0,y:0},text:sample,height:h,rotation:0,align:'left'};
     const opts={padX:Number(values.padX),padY:Number(values.padY),cornerRadius:Number(values.cornerRadius),sides:Number(values.sides)};
     return entitiesSvg([text,buildTextBoxBorder(text,values.shape,opts)],{width,height});
    }catch{return entitiesSvg([],{width,height});}
   },
   note:'WipeOut·문자 목록 저장소는 바른 CAD 에 없어 만들지 않았습니다.',
   onGo:async(values)=>{
    const opts={padX:Number(values.padX),padY:Number(values.padY),cornerRadius:Number(values.cornerRadius),sides:Number(values.sides),layer:ctx.ensureLayer(STD_LAYERS.symb,'#ff9f68')};
    if(values.mode==='existing'){
     let n=0;
     for(;;){
      const t=await ctx.pickEntity({prompt:'TX · 테두리 그릴 기존 문자를 선택하세요'+(n?' · 지금까지 '+n+'개':'')+' · Esc 끝내기',types:['text']});
      if(!t)break;
      try{ctx.execute({type:'addMany',entities:[buildTextBoxBorder(t,values.shape,opts)]});n++;}
      catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);break;}
     }
     if(n){ctx.refresh();ctx.toast('TX · 문자 '+n+'개에 테두리를 둘렀습니다 · Ctrl+Z 로 되돌리기');}
    }else{
     const p=await ctx.pickPoint('TX · 새 문자를 놓을 위치를 클릭하세요 · Esc 취소');
     if(!p)return;
     const height=Number(values.height);
     if(!(height>0))throw Error('문자높이는 양수입니다.');
     const text={type:'text',layer:ctx.ensureLayer(STD_LAYERS.text,'#ffffff'),position:p,text:values.uppercase?String(values.text).toUpperCase():values.text,height,rotation:0,align:'left'};
     const border=buildTextBoxBorder(text,values.shape,opts);
     ctx.execute({type:'addMany',entities:[text,border]});
     ctx.refresh();
     ctx.toast('TX · 문자와 테두리를 만들었습니다 · Ctrl+Z 로 되돌리기');
    }
   },
  });
 }

 return {ABX:guard(abx),BAM:guard(bam),BCH:guard(bch),BEX:guard(bex),BIN:guard(bin),BSC:guard(bsc),TIC:guard(tic),TX:guard(tx)};
}
