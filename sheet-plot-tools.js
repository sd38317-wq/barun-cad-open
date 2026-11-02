// 3차 병렬 작업(2026-09-21): 도곽 4개(DAS DBC DSB PBS) + 출력 3개(PBM PPP RUB) + 켜 3개(LCC LCS LE) + 선택 1개(SER) + LUI.
// 원문은 docs/izzarder-reference-20260921/references/09-titleblock.md(DAS 420·DBC 229·DSB 421),
// 14-shape-line.md(PBS/PBM 133), 17-plot-save.md(PPP 43·PBM 546 — 이 쪽이 더 자세하고 gif 로 확인했다고 적혀
// 있어 PBM은 이 문서를 근거로 삼았다), 18-etc.md(RUB 230), 08-layer.md(LE 402·LCS 373·LCC 209·LUI 는 "켜 상태
// 조절 명령어 모음" 공용 글 100), 07-select.md(SER 407)를 WebFetch 로 직접 읽고 옮겼다.
// 순수 계산은 export 된 함수로 두어 node 시험이 DOM 없이 돈다. 화면 입력은 installSheetPlotTools(ctx) 안에만 둔다.
import * as G from './geometry.js';
import {isChecked} from './card-input.js';
import {STD_LAYERS,isPlotBoxLayerName} from './card-kit.js';

/* ══════════════════════════ DAS · 살아있는 도곽축척 (izzarder.com/420) ══════════════════════════
   원문은 도곽블럭 축척에 연동해 REGEN/출력 시 자동 갱신되는 FIELD 문자를 만든다. 바른 CAD 엔진에는
   FIELD/MTEXT 필드 개체가 없어(text 타입 하나뿐) 자동 갱신은 만들 수 없다 - 정직하게 고정 문자만 넣고
   보고서에 한계를 적는다. */
export function scaleLabelText(denominator,prefix='1:'){
 const n=Number(denominator);
 if(!(n>0))throw Error('축척 분모는 양수여야 합니다.');
 return prefix+String(n);
}

/* ══════════════════════════ DBC · 도곽 자동인식 복사 (izzarder.com/229) ══════════════════════════
   원문은 서로 다른 축척의 도곽(1/100→1/50 등) 사이에서 요소를 스케일·회전 보정하며 복사한다. 여기서는
   회전 보정은 생략하고(두 영역 모두 축에 나란한 사각형으로 지정) 폭 비율로 균일 축척만 계산한다. */
export function boxFromCorners(p0,p1){
 return {minX:Math.min(p0.x,p1.x),minY:Math.min(p0.y,p1.y),maxX:Math.max(p0.x,p1.x),maxY:Math.max(p0.y,p1.y)};
}
export function entitiesFullyInside(entities,box){
 return (entities||[]).filter(e=>{
  const b=G.bounds([e]);
  return b&&b.minX>=box.minX-1e-6&&b.maxX<=box.maxX+1e-6&&b.minY>=box.minY-1e-6&&b.maxY<=box.maxY+1e-6;
 });
}
/** 원본 영역(sourceBox)의 좌하귀를 기준으로 균일 축척(폭 비율)을 계산해 대상 영역(targetBox) 좌하귀로 옮긴다.
 *  G.resize 가 textHeight/radius/thickness/arrowSize 등도 함께 비례시켜 치수·문자 크기까지 자동 보정된다
 *  (geometry.js transformEntity 의 scale 목록 참고 - 별도 "치수축척 보정" 코드가 필요 없다). */
export function copyBetweenBoxes(entities,sourceBox,targetBox){
 const sw=sourceBox.maxX-sourceBox.minX,sh=sourceBox.maxY-sourceBox.minY;
 if(!(sw>G.EPS&&sh>G.EPS))throw Error('원본 도곽 영역이 올바르지 않습니다.');
 const scale=(targetBox.maxX-targetBox.minX)/sw;
 if(!(scale>G.EPS))throw Error('대상 도곽 영역이 올바르지 않습니다.');
 const origin={x:sourceBox.minX,y:sourceBox.minY},dx=targetBox.minX-sourceBox.minX,dy=targetBox.minY-sourceBox.minY;
 return entities.map(e=>G.translate(G.resize(e,origin,scale),dx,dy));
}

/* ══════════════════════════ DSB · 도곽블럭 내 치수축척 자동 변경 (izzarder.com/421) ══════════════════════════
   원문: 도곽블럭을 선택만 하면 그 boundingbox 안 DIMENSION/LEADER 의 축척을 도곽 축척에 맞춘다. 바른 CAD 는
   지시선이 별도 entity 타입이 아니라 block(LEADER 명령이 만드는 선+문자 묶음)이라 여기서는 dimension 타입만
   다룬다(한계는 보고서에 적는다). */
export function boundaryContainsCenter(entityBounds,box){
 if(!entityBounds)return false;
 const cx=(entityBounds.minX+entityBounds.maxX)/2,cy=(entityBounds.minY+entityBounds.maxY)/2;
 return cx>=box.minX&&cx<=box.maxX&&cy>=box.minY&&cy<=box.maxY;
}
export function dimensionIdsInsideBox(entities,box){
 return (entities||[]).filter(e=>e.type==='dimension'&&boundaryContainsCenter(G.bounds([e]),box)).map(e=>e.id);
}

/* ══════════════════════════ PBS/PBM · 경계 사각형 그리기 (izzarder.com/133, PBM 은 546) ══════════════════════════
   PBS: 블록(또는 임의 객체) 외곽에 출력 박스 켜(A-PLOT)로 사각형 하나. 대화상자 없음.
   PBM: 사각 폴리선 하나를 클릭하면 같은 켜의 축에 나란한 사각 폴리선들 "위에" 동일 크기 출력 박스 사각형을
   자동으로 복제한다(레이어를 바꾸는 것이 아니라 새로 그린다 - 546번 글이 gif 로 확인한 더 정확한 설명이다). */
export function isAxisAlignedQuad(entity){
 if(!entity)return false;
 if(!(entity.type==='rectangle'||(entity.type==='polyline'&&entity.closed)))return false;
 let pts=entity.points;
 if(!Array.isArray(pts))return false;
 if(pts.length===5&&Math.abs(pts[0].x-pts[4].x)<1e-6&&Math.abs(pts[0].y-pts[4].y)<1e-6)pts=pts.slice(0,4);
 if(pts.length!==4)return false;
 const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 if(maxX-minX<1e-6||maxY-minY<1e-6)return false;
 return pts.every(p=>(Math.abs(p.x-minX)<1e-6||Math.abs(p.x-maxX)<1e-6)&&(Math.abs(p.y-minY)<1e-6||Math.abs(p.y-maxY)<1e-6));
}
export function sameLayerQuadBoxes(entities,sourceId){
 const source=(entities||[]).find(e=>e.id===sourceId);
 if(!source)throw Error('기준 사각 폴리선을 찾지 못했습니다.');
 if(!isAxisAlignedQuad(source))throw Error('선택한 객체가 축에 나란한 사각형 폴리선(또는 사각형)이 아닙니다.');
 return entities.filter(e=>e.layer===source.layer&&isAxisAlignedQuad(e)).map(e=>G.bounds([e]));
}

/* ══════════════════════════ PPP · 자동출력 (izzarder.com/43) ══════════════════════════
   원문은 그룹 15개짜리 대형 대화상자(도곽형태 5종·도면명 자동축출·여러파일 일괄·PDF 합본 등)다. 여기서는
   그 전체를 새로 만들지 않고, 이미 SHEET/PLOTBOX 로 등록된 도곽 전체를 번호순으로 모아 PDF 한 개로 뽑는
   바른 CAD 의 기존 출력 경로(studio.js SHEETPDF → plot.js)를 ctx.run 으로 그대로 재사용한다(카드 문맥에는
   plot API 가 없어 직접 호출할 수 없다). "여러 박스를 차례로 출력"은 되지만 개별 파일별 저장·도면명 자동
   축출·15개 그룹 설정은 없다 - 한계는 보고서에 적는다. */
export function plotBoxDecorationIds(entities){
 return (entities||[]).filter(e=>e.plotBox&&e.sheetDecoration).map(e=>e.sheetId);
}
/* 2026-09-24(검토 P10): PB·PBM·PBS 로 그린 출력 박스(plotBox 표식 또는 PLOT_BOX 켜의 축 사각형)를 PPP 가 알아보게 한다.
   아직 도곽(sheet)으로 등록되지 않은 박스만 돌려주고, 위→아래·왼쪽→오른쪽 순서(도면 읽는 순서)로 정렬한다. */
export function unregisteredPlotBoxes(entities,layers){
 const plotLayers=new Set((layers||[]).filter(l=>isPlotBoxLayerName(l.name)).map(l=>l.id));
 const seen=new Set(),out=[];
 for(const e of entities||[]){
  if(e.sheetDecoration||!isAxisAlignedQuad(e))continue;
  if(!(e.plotBox||plotLayers.has(e.layer)))continue;
  const b=G.bounds([e]);const key=[b.minX,b.minY,b.maxX,b.maxY].map(v=>Math.round(v)).join(',');
  if(seen.has(key))continue;seen.add(key);out.push({id:e.id,layer:e.layer,bounds:b});
 }
 return out.sort((a,b)=>(b.bounds.maxY-a.bounds.maxY)||(a.bounds.minX-b.bounds.minX));
}
const NICE_SCALES=[1,2,5,10,20,25,30,40,50,60,75,100,120,150,200,250,300,400,500,600,750,1000,1200,1500,2000,2500,3000,4000,5000,6000,7500,10000];
export const PAPER_MM=Object.freeze({A1:[841,594],A3:[420,297],A4:[297,210]});
/** 박스 크기에 맞는 가장 작은 표준 축척(1:N)과 용지. 기본은 A3, 1:10000 보다 크면 A1. */
export function plotBoxSheetSpec(bounds,paper='A3'){
 const w=bounds.maxX-bounds.minX,h=bounds.maxY-bounds.minY;
 if(!(w>G.EPS&&h>G.EPS))throw Error('출력 박스의 폭과 높이가 0보다 커야 합니다.');
 const [pl,ps]=PAPER_MM[paper]||PAPER_MM.A3,long=Math.max(w,h),short=Math.min(w,h);
 const need=Math.max(long/pl,short/ps);
 const denominator=NICE_SCALES.find(s=>s>=need-1e-9)||Math.ceil(need);
 return {paper,denominator};
}
export function plotBoxSheetPlan(boxes,existingSheets,{prefix='P-',title='출력 박스',paper='A3',makeId=()=>globalThis.crypto?.randomUUID?.()||('pb-'+Math.random().toString(36).slice(2))}={}){
 const numbers=new Set((existingSheets||[]).map(s=>s.number));let next=(existingSheets||[]).length+1;
 const sheets=[],updates=[];
 for(const box of boxes){
  let number;do{number=prefix+String(next++).padStart(3,'0');}while(numbers.has(number));numbers.add(number);
  const id=makeId(),spec=plotBoxSheetSpec(box.bounds,paper);
  sheets.push({id,number,title,paper:spec.paper,denominator:spec.denominator,bounds:{...box.bounds},plotBox:true});
  updates.push({type:'update',ids:[box.id],changes:{sheetId:id,sheetDecoration:true,plotBox:true}});
 }
 return {sheets,updates};
}

/* ══════════════════════════ RUB · 잡석 다짐 그리기 (izzarder.com/230) ══════════════════════════
   원문: 대화상자 없음, 두 점을 지정하면 그 사이를 마젠타색 연속 지그재그(V자) 사선 다발로 채운다(삼각형
   아님). 폭·간격은 원문에 옵션이 없어(원문 자체가 고정값) 카드 설정(ctx.num)에 기본값을 두었다. */
export const RUB_COLOR='#ff00ff';
export function rubbleZigzag(p0,p1,width,pitch){
 width=Number(width);pitch=Number(pitch);
 if(!(width>0))throw Error('잡석 폭은 0보다 커야 합니다.');
 if(!(pitch>0))throw Error('지그재그 간격은 0보다 커야 합니다.');
 const length=G.dist(p0,p1);
 if(length<G.EPS)throw Error('두 점은 서로 달라야 합니다.');
 const u=G.unit(G.sub(p1,p0)),n=G.normal(u),segCount=Math.max(2,Math.round(length/pitch));
 const points=[];
 for(let i=0;i<=segCount;i++){
  const s=length*i/segCount,d=i%2===0?-width/2:width/2;
  points.push(G.add(G.add(p0,G.mul(u,s)),G.mul(n,d)));
 }
 return points;
}

/* ══════════════════════════ LCC · 색-켜 변경(개별) (izzarder.com/209) ══════════════════════════ */
function normalizeHex(v){
 const s=String(v||'').trim().toLowerCase(),m=/^#?([0-9a-f]{6}|[0-9a-f]{3})$/.exec(s);
 if(!m)return null;
 let h=m[1];if(h.length===3)h=[...h].map(c=>c+c).join('');
 return '#'+h;
}
export function effectiveColorOf(entity,layers){
 const layer=(layers||[]).find(l=>l.id===entity?.layer);
 return normalizeHex(entity?.color)||normalizeHex(layer?.color)||null;
}
export function colorMatchIds(entities,layers,color){
 const c=normalizeHex(color);if(!c)return [];
 return (entities||[]).filter(e=>effectiveColorOf(e,layers)===c).map(e=>e.id);
}

/* ══════════════════════════ LCS · 동일 객체 켜 일괄변경 (izzarder.com/373) ══════════════════════════ */
export function sameConditionIds(entities,ref){
 if(!ref)return [];
 return (entities||[]).filter(e=>e.type===ref.type&&(ref.type!=='block'||e.name===ref.name)).map(e=>e.id);
}

/* ══════════════════════════ SER · 범위로 선택 (izzarder.com/407) ══════════════════════════
   원문은 기준 객체 종류에 맞는 수치 항목(문자높이/길이/면적/고도/반지름/축척)마다 체크박스+최소~최대를 AND
   결합한다. 바른 CAD 는 2D 전용(고도 없음)이라 그 항목은 뺐고, 체크박스 on/off 는 이 앱의 공용 form() 이
   checkbox 초기 체크 상태를 그리지 않는 한계가 있어(다른 카드도 같은 제약) 종류별 해당 항목을 전부 AND 로
   적용한다(범위를 넓게 잡으면 사실상 그 항목을 끄는 것과 같다) - 보고서 참고. */
export const SER_MEASURE_LABEL=Object.freeze({height:'문자높이',length:'길이',area:'면적',radius:'반지름',scale:'축척'});
export function measurableKeysFor(type){
 if(type==='text')return ['height'];
 if(type==='circle')return ['radius','area'];
 if(type==='arc')return ['radius'];
 if(type==='line')return ['length'];
 if(type==='polyline'||type==='rectangle')return ['length','area'];
 if(type==='block')return ['scale'];
 return [];
}
export function measureValue(entity,key){
 if(key==='height')return Number(entity.height)||0;
 if(key==='radius')return Number(entity.radius)||0;
 if(key==='scale')return Number(entity.scale)||1;
 if(key==='length'){
  if(entity.type==='line'&&entity.points?.length>=2)return G.dist(entity.points[0],entity.points[1]);
  return G.segments(entity).reduce((s,[a,b])=>s+G.dist(a,b),0);
 }
 if(key==='area'){
  if(entity.type==='circle')return Math.PI*Math.pow(Number(entity.radius)||0,2);
  if(Array.isArray(entity.points)&&entity.points.length>=3)return G.polygonArea(entity.points);
  return 0;
 }
 return 0;
}
export function selectByRange(entities,ref,ranges){
 const keys=Object.keys(ranges);
 return (entities||[]).filter(e=>e.type===ref.type&&keys.every(k=>{
  const v=measureValue(e,k),[lo,hi]=ranges[k];
  return v>=lo&&v<=hi;
 })).map(e=>e.id);
}

/* ══════════════════════════ LUI · 직전 켜 상태 복구 (izzarder.com/100, "켜 상태 조절 명령어 모음" 공용 글) ══════════════════════════
   원문의 LUI 는 LF/LFF/LFK 가 바꾼 상태를 되돌리는 것으로 보이나, 그 구현(app.js 의 isolatedLayerState)은
   LF(LAYISO) 하나만 기록하고 다른 파일이라 이 모듈에서 고칠 수 없다. 그래서 LUI 카드 자체에 "지금 켜 상태
   저장"과 "저장한 상태로 복구" 두 동작을 담아, LFF·LFK 등 어떤 켜 명령이 상태를 바꿨더라도 저장해 둔 시점
   으로 되돌릴 수 있게 한다(기존 LAYRESTORE 와는 별개 저장소를 쓴다) - 한계는 보고서에 적는다. */
export function layerSnapshot(layers){
 return (layers||[]).map(l=>({id:l.id,visible:l.visible!==false,frozen:!!l.frozen,locked:!!l.locked}));
}
export function applicableSnapshotChanges(snapshot,layers){
 const ids=new Set((layers||[]).map(l=>l.id));
 return (snapshot||[]).filter(s=>ids.has(s.id));
}

/* ══════════════════════════ 화면 문맥이 필요한 명령들 ══════════════════════════ */
export function installSheetPlotTools(ctx){
 const flag=isChecked; /* 2026-09-24: 체크박스는 card-input isChecked(on·true·yes·1 = 켜짐)로 읽는다 */
 const LUI_KEY='barun-lui-layer-snapshot';

 /* DAS — 살아있는 도곽축척 넣기(izzarder.com/420, 고정 문자만) */
 function DAS(){
  ctx.askNumber({title:'살아있는 도면 축척 넣기 (DAS)',label:'축척 분모 (1:__)',value:ctx.num('das-denominator',100)},async n=>{
   const text=scaleLabelText(n);
   const p=await ctx.pickPoint('축척 문자를 놓을 위치를 클릭하세요(표제란 부근) · Esc 취소');
   if(!p)return;
   const layerId=ctx.ensureLayer('A-TITLE','#ffffff'),height=ctx.num('text-height',150);
   ctx.commit({entities:[{type:'text',position:p,text,height,rotation:0,align:'left',layer:layerId}]});
   ctx.toast(`축척 문자 "${text}"를 넣었습니다 · 도곽 크기를 바꿔도 자동으로 갱신되지 않습니다(FIELD 개체가 없어 고정 문자입니다) · Ctrl+Z 로 되돌리기`);
  });
 }

 /* DBC — 도곽 자동인식 복사(izzarder.com/229) */
 async function DBC(){
  const src=await ctx.pickPath({prompt:'원본 도곽 영역의 두 모서리를 지정하세요 (DBC · 도곽 자동인식 복사) · Esc 취소',minPoints:2,maxPoints:2});
  if(!src)return;
  const dst=await ctx.pickPath({prompt:'복사할 대상 도곽 영역의 두 모서리를 지정하세요 · Esc 취소',minPoints:2,maxPoints:2});
  if(!dst)return;
  const sourceBox=boxFromCorners(src.points[0],src.points[1]),targetBox=boxFromCorners(dst.points[0],dst.points[1]);
  const pool=entitiesFullyInside(ctx.entities(),sourceBox);
  if(!pool.length)throw Error('원본 영역 안에 완전히 들어있는 객체가 없습니다.');
  ctx.form(`도곽 자동인식 복사 (DBC) · 원본 영역 안 객체 ${pool.length}개`,[
   {name:'removeSource',label:'복사 후 원본 객체 삭제',type:'checkbox',value:false},
  ],values=>{
   const copies=copyBetweenBoxes(pool,sourceBox,targetBox);
   const removeIds=flag(values.removeSource)?pool.map(e=>e.id):[];
   ctx.commit({removeIds,entities:copies});
   const scale=(targetBox.maxX-targetBox.minX)/(sourceBox.maxX-sourceBox.minX);
   ctx.toast(`객체 ${copies.length}개를 배율 ${scale.toFixed(3)} 로 축척 보정해 복사했습니다${removeIds.length?' · 원본 삭제됨':''} · Ctrl+Z 로 되돌리기`);
  });
 }

 /* DSB — 도곽블럭 내 치수축척 자동 변경(izzarder.com/421) */
 async function DSB(){
  const ref=await ctx.pickEntity({prompt:'치수축척을 맞출 도곽(경계 블록·폴리선)을 선택하세요 (DSB)'});
  if(!ref)return;
  const box=G.bounds([ref]);
  if(!box)throw Error('선택한 객체의 영역을 계산할 수 없습니다.');
  const ids=dimensionIdsInsideBox(ctx.entities().filter(e=>e.id!==ref.id),box);
  if(!ids.length)return ctx.toast('이 도곽 영역 안에 치수 객체가 없습니다. (지시선은 이 앱에서 별도 타입이 아니라 대상에서 빠집니다)',true);
  const current=Number(ctx.entities().find(e=>e.id===ids[0])?.scale)||1;
  ctx.askNumber({title:'도곽내부 치수축척 일괄변경 (DSB)',label:`영역 안 치수 ${ids.length}개에 적용할 축척`,value:current},n=>{
   if(!(n>0))throw Error('축척은 양수여야 합니다.');
   ctx.execute({type:'update',ids,changes:{scale:n}});
   ctx.refresh();
   ctx.toast(`도곽 영역 안 치수 ${ids.length}개의 축척을 ${n} 로 맞췄습니다 · Ctrl+Z 로 되돌리기`);
  });
 }

 /* PBS — 블럭도곽 경계 확인(izzarder.com/133) */
 async function PBS(){
  const ref=await ctx.pickEntity({prompt:'경계를 그릴 블록(또는 객체)을 선택하세요 (PBS)'});
  if(!ref)return;
  const b=G.bounds([ref]);
  if(!b)throw Error('선택한 객체의 외곽을 계산할 수 없습니다.');
  const layerId=ctx.ensureLayer(STD_LAYERS.plot,'#ff9f68');
  ctx.commit({entities:[{type:'rectangle',points:G.rectangle({x:b.minX,y:b.minY},{x:b.maxX,y:b.maxY}),layer:layerId,plotBox:true}]});
  ctx.toast('선택한 객체의 외곽에 출력 박스(A-PLOT) 사각형을 그렸습니다 · Ctrl+Z 로 되돌리기');
 }

 /* PBM — 폴리도곽에 출력용 박스 얹기(izzarder.com/546) */
 async function PBM(){
  const ref=await ctx.pickEntity({prompt:'도곽으로 쓸 사각 폴리선을 하나 선택하세요 (PBM · 폴리도곽에 출력용 박스 얹기)',types:['polyline','rectangle']});
  if(!ref)return;
  const boxes=sameLayerQuadBoxes(ctx.entities(),ref.id);
  if(!boxes.length)return ctx.toast('같은 켜의 사각 폴리선을 찾지 못했습니다.',true);
  const layerId=ctx.ensureLayer(STD_LAYERS.plot,'#ff9f68');
  const entities=boxes.map(b=>({type:'rectangle',points:G.rectangle({x:b.minX,y:b.minY},{x:b.maxX,y:b.maxY}),layer:layerId,plotBox:true}));
  ctx.commit({entities});
  ctx.toast(`같은 켜의 사각 폴리선 ${boxes.length}개 위에 출력 박스(A-PLOT) 사각형을 그렸습니다 · Ctrl+Z 로 되돌리기`);
 }

 /* PPP — 자동출력(izzarder.com/43, 등록된 도곽 전체를 SHEETPDF 경로로 재사용).
    2026-09-24: PB·PBM·PBS 로 그린 출력 박스도 인식한다 — 아직 등록되지 않은 박스는 도곽(sheet)으로 등록하고
    박스선은 출력에서 빼는(sheetDecoration) 한 번의 batch 로 처리한 뒤 SHEETPDF 를 실행한다(Ctrl+Z 한 번에 등록 취소). */
 function PPP(){
  const entities=ctx.entities(),layers=ctx.layers();
  const registered=new Set(plotBoxDecorationIds(entities));
  const lockedIds=new Set(layers.filter(l=>l.locked).map(l=>l.id));
  const loose=unregisteredPlotBoxes(entities,layers),usable=loose.filter(b=>!lockedIds.has(b.layer));
  const cad=globalThis.window?.cad;
  const sheets=typeof cad?.getDocument==='function'?(cad.getDocument().sheets||[]):null;
  if(!registered.size&&!(sheets||[]).length&&!usable.length){
   ctx.toast(loose.length?'PB 로 그린 출력 박스가 모두 잠긴 켜에 있습니다. 켜 잠금을 푼 뒤 다시 실행하세요.':'등록된 도곽(SHEET·PLOTBOX)도, PB·PBM·PBS 로 그린 출력 박스도 없습니다. 먼저 PB 로 출력 박스를 그리세요.',true);return;
  }
  let added=0;
  if(usable.length){
   if(!sheets)throw Error('PPP · 출력 박스를 도곽으로 등록하려면 바른 CAD 본 화면에서 실행하세요.');
   const plan=plotBoxSheetPlan(usable,sheets);
   ctx.execute({type:'batch',commands:[...plan.updates,{type:'document.update',changes:{sheets:[...sheets,...plan.sheets]}}]});
   ctx.refresh();added=plan.sheets.length;
  }
  const total=(sheets?sheets.length:registered.size)+added;
  ctx.toast(`PPP · 도곽 ${total}장을 번호순으로 모아 PDF 한 개로 출력합니다${added?` · PB 출력 박스 ${added}개를 도곽(P-번호, 1:축척 자동)으로 등록했습니다(Ctrl+Z 로 등록 취소)`:''}${loose.length>usable.length?` · 잠긴 켜의 박스 ${loose.length-usable.length}개 제외`:''} · 15개 그룹 설정·개별 파일 저장·도면명 자동 축출은 없습니다.`);
  ctx.run('SHEETPDF');
 }

 /* RUB — 잡석 그리기(izzarder.com/230) */
 async function RUB(){
  const pts=(await ctx.pickPath({prompt:'잡석 다짐을 그릴 두 점을 지정하세요 (RUB) · Esc 취소',minPoints:2,maxPoints:2,
   preview:(points,cursor)=>{
    const all=cursor?[...points,cursor]:points;if(all.length<2)return [];
    try{return [{type:'polyline',points:rubbleZigzag(all[0],all[1],ctx.num('rub-width',300),ctx.num('rub-pitch',250)),closed:false,previewColor:RUB_COLOR}];}catch{return [];}
   }}))?.points;
  if(!pts)return;
  const width=ctx.num('rub-width',300),pitch=ctx.num('rub-pitch',250);
  const points=rubbleZigzag(pts[0],pts[1],width,pitch);
  // 잡석 다짐은 단면의 채움·패턴과 같은 A-HATCH 에, 색은 레이어를 따른다(2026-10-27 설명서 시험: 콘크리트 벽 레이어·색 고정이었다).
  const layerId=ctx.ensureLayer('A-HATCH','#6ec6ff');
  ctx.commit({entities:[{type:'polyline',points,closed:false,layer:layerId}]});
  ctx.toast('잡석 다짐 기호를 그렸습니다 · Ctrl+Z 로 되돌리기');
 }

 /* LCC — 색-켜 변경(개별)(izzarder.com/209) */
 async function LCC(){
  const ref=await ctx.pickEntity({prompt:'같은 색을 켜로 옮길 기준 객체를 선택하세요 (LCC · 색-켜 변경)'});
  if(!ref)return;
  const color=effectiveColorOf(ref,ctx.layers());
  if(!color)throw Error('선택한 객체의 색을 확인할 수 없습니다.');
  ctx.form(`색-켜 변경 · 색 ${color} 객체를 옮길 켜 (LCC)`,[
   {name:'layer',label:'대상 켜 이름(없으면 새로 생성)',type:'text',value:''},
  ],values=>{
   const name=String(values.layer||'').trim();
   if(!name)throw Error('대상 켜 이름을 입력하세요.');
   const ids=colorMatchIds(ctx.entities(),ctx.layers(),color);
   if(!ids.length)return ctx.toast('같은 색의 객체가 없습니다.');
   const layerId=ctx.ensureLayer(name,color);
   ctx.execute({type:'update',ids,changes:{layer:layerId,color:null}});
   ctx.refresh();
   ctx.toast(`색 ${color} 객체 ${ids.length}개를 "${name}" 켜로 옮기고 색을 ByLayer 로 되돌렸습니다 · Ctrl+Z 로 되돌리기`);
  });
 }

 /* LCS — 동일 객체 켜 일괄변경(izzarder.com/373).
    2026-09-24(검토 P6): 잠긴 켜의 객체가 섞이면 엔진이 거부해 중간에 멈추고 앞서 옮긴 것만 남았다. 잠긴 켜 객체는 빼고,
    조건 객체를 다 고른 뒤 한 번에(Ctrl+Z 한 번) 옮긴다. */
 async function LCS(){
  const target=await ctx.pickEntity({prompt:'기준 켜를 가져올 객체를 선택하세요 (LCS · 동일 객체 켜 일괄변경)'});
  if(!target)return;
  const targetLayer=target.layer,targetLayerObj=ctx.layers().find(l=>l.id===targetLayer),targetName=targetLayerObj?.name||'';
  if(targetLayerObj?.locked)throw Error(`기준 켜 "${targetName}" 가 잠겨 있어 객체를 옮길 수 없습니다. 켜 잠금을 푼 뒤 다시 실행하세요.`);
  const chosen=new Set();let skipped=0;
  for(;;){
   const ref=await ctx.pickEntity({prompt:`조건이 될 객체를 선택하세요 · 같은 종류(블록이면 같은 이름)를 모두 "${targetName}" 켜로 옮깁니다 · Esc 로 끝내기${chosen.size?' · 지금까지 '+chosen.size+'개':''}`});
   if(!ref)break;
   const locked=new Set(ctx.layers().filter(l=>l.locked).map(l=>l.id));
   for(const e of ctx.entities())if(sameConditionIds([e],ref).length&&e.layer!==targetLayer){if(locked.has(e.layer)){skipped++;continue;}chosen.add(e.id);}
  }
  if(!chosen.size){if(skipped)ctx.toast(`조건에 맞는 객체가 모두 잠긴 켜에 있어 옮기지 않았습니다(${skipped}개).`,true);return;}
  ctx.execute({type:'update',ids:[...chosen],changes:{layer:targetLayer}});
  ctx.refresh();
  ctx.toast(`조건에 맞는 객체 ${chosen.size}개의 켜를 "${targetName}" 로 옮겼습니다${skipped?` · 잠긴 켜 객체 ${skipped}개는 건너뛰었습니다`:''} · Ctrl+Z 로 되돌리기`);
 }

 /* LE — 객체선택하여 현재 켜를 변경(izzarder.com/402) */
 async function LE(){
  const ref=await ctx.pickEntity({prompt:'켜를 현재 켜로 만들 객체를 선택하세요 (LE)'});
  if(!ref)return;
  ctx.setActiveLayer(ref.layer);
  const name=ctx.layers().find(l=>l.id===ref.layer)?.name||'';
  ctx.toast(`현재 켜를 "${name}" 로 바꿨습니다 (LE)${ref.type==='dimension'?' · 치수모양(dimstyle) 전환은 이 앱에 없는 개념이라 켜만 바뀝니다':''}`);
 }

 /* SER — 범위로 선택(izzarder.com/407) */
 async function SER(){
  const ref=await ctx.pickEntity({prompt:'범위로 선택할 기준 객체를 선택하세요 (SER · 범위로 선택)'});
  if(!ref)return;
  const keys=measurableKeysFor(ref.type);
  if(!keys.length)throw Error('이 종류의 객체는 범위로 선택할 수 있는 수치가 없습니다(문자·선·폴리선·원·호·블록만 지원).');
  const fields=keys.flatMap(k=>{
   const v=measureValue(ref,k);
   return [
    {name:'min_'+k,label:SER_MEASURE_LABEL[k]+' 최소',type:'number',value:Math.round(v*0.9*100)/100},
    {name:'max_'+k,label:SER_MEASURE_LABEL[k]+' 최대',type:'number',value:Math.round(v*1.1*100)/100},
   ];
  });
  const summary=keys.map(k=>`${SER_MEASURE_LABEL[k]} ${measureValue(ref,k).toFixed(2)}`).join(' · ');
  ctx.form(`범위로 선택 (SER) · 기준 ${ref.type} · ${summary}`,fields,values=>{
   const ranges={};
   for(const k of keys){
    const lo=Number(values['min_'+k]),hi=Number(values['max_'+k]);
    if(!Number.isFinite(lo)||!Number.isFinite(hi)||lo>hi)throw Error(SER_MEASURE_LABEL[k]+' 범위를 확인하세요.');
    ranges[k]=[lo,hi];
   }
   const ids=selectByRange(ctx.entities(),ref,ranges);
   if(!ids.length)return ctx.toast('범위에 맞는 객체가 없습니다.',true);
   ctx.setSelected(ids);
   ctx.toast(`범위 조건에 맞는 ${ref.type} ${ids.length}개를 선택했습니다 (SER)`);
  });
 }

 /* LUI — 직전 켜 상태 복구(izzarder.com/100) */
 function LUI(){
  ctx.form('직전 켜 상태 저장·복구 (LUI)',[
   {name:'mode',label:'동작',value:'save',options:[['save','지금 켜 상태를 저장'],['restore','저장된 상태로 복구']]},
  ],values=>{
   if(values.mode==='restore'){
    let saved=null;try{saved=JSON.parse(ctx.storage.getItem(LUI_KEY)||'null');}catch{saved=null;}
    if(!Array.isArray(saved)||!saved.length)throw Error('저장된 켜 상태가 없습니다. 먼저 "지금 켜 상태를 저장"을 실행하세요.');
    const changes=applicableSnapshotChanges(saved,ctx.layers());
    if(!changes.length)return ctx.toast('복구할 켜가 없습니다(저장 뒤 켜가 모두 삭제된 것으로 보입니다).',true);
    ctx.execute({type:'batch',commands:changes.map(c=>({type:'layer.update',id:c.id,changes:{visible:c.visible,frozen:c.frozen,locked:c.locked}}))});
    ctx.refresh();
    ctx.toast(`켜 ${changes.length}개를 저장된 상태로 복구했습니다 · Ctrl+Z 로 되돌리기`);
   }else{
    const snapshot=layerSnapshot(ctx.layers());
    try{ctx.storage.setItem(LUI_KEY,JSON.stringify(snapshot));}catch{}
    ctx.toast(`켜 ${snapshot.length}개의 표시·동결·잠금 상태를 저장했습니다(LUI 저장) · LFF·LFK 등 다른 켜 명령으로 바뀐 상태도 이 저장 시점으로 되돌릴 수 있습니다.`);
   }
  });
 }

 /* 비평 11: 오류 처리는 app.js runCardCommand(보고·되돌리기 묶음) 한 곳에서 한다 — 모듈 안의 두 번째 감싸기는 뺐다. */
 const guard=fn=>fn;
 const commands={DAS,DBC,DSB,PBS,PBM,PPP,RUB,LCC,LCS,LE,SER,LUI};
 return Object.fromEntries(Object.entries(commands).map(([name,fn])=>[name,guard(fn)]));
}
