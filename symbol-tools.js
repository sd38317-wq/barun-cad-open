// 2차 병렬 작업: 기호 미연결 10개(CMW ELM K PLM PPB RD SL V X XZ) + 도형 및 기호 미연결 4개(OOL MTLT LEX LXP).
// 근거: docs/izzarder-reference-20260921/references/03-symbol.md, 14-shape-line.md 의 각 절.
// 원문(izzarder.com)은 스크린샷 위주라 WebFetch(텍스트 변환)만으로는 그림을 못 읽어, K/V/X/XZ 는 4개 기호가 함께 있는
// 원문 이미지(izzarder.com/317, 스크린샷 픽셀 좌표를 직접 대조)로 점1·점2와 실제 선의 관계를 확인했고, RD(/195)·PPB(/233)·
// ELM(/234)·PLM(/235)·SL(/320) 는 설정 대화상자 스크린샷을 직접 읽어 항목·기본값을 옮겼다. CMW(/190)는 원문에 대화상자가
// 없다(그려진 구름 기호를 선택해 두께만 입력). MTLT(/534)·LEX 는 .lin(선모양 정의 파일) 체계가 필요한데 바른 CAD 의 선종류는
// CONTINUOUS/CENTER/PHANTOM/DOT/DASHED/HIDDEN 5종 고정(geometry.js 어디에도 커스텀 .lin 로더가 없다) — "없음" 카드로 등록한다.
// LEX 는 정리본에도 없고 WebSearch site:izzarder.com 로도 전용 원문 글을 찾지 못했다(선종류 내보내기 자체가 없어서와 같은 이유).
// LXP(선 모양대로 폭파하기)도 전용 원문 글을 못 찾았지만, 과제 지시대로 "선 모양대로 낱개 선으로 폭파"가 가능해 만들었다
// (view.js 의 CENTER/PHANTOM/DOT/DASHED 대시 비율을 그대로 옮겨 로컬에 다시 정의했다 — 공유 파일은 손대지 않고 읽기만 했다).
// 문자 높이 기본값은 과제 지시대로 ctx.num('text-height',150) 을 쓴다(원문 대화상자의 2.5×선축척=250 대신 앱 공통 기본값).
// 켜는 과제 지시대로 기호는 A-SYM, 문자는 A-TEXT 로 고정한다(원문의 커스텀 켜 이름 드롭다운은 만들지 않았다).
import * as G from './geometry.js';
import {STD_LAYERS,resolveLayers} from './card-kit.js';
import {assertGeneratedCount,boundedNumber,downloadText,safeFileName} from './card-input.js';
import {BARUN_LINETYPES,barunLinetypeKey,barunLinetypeDefinition,textLinetypeDefinition,linFileText,patternName} from './pattern-files.js';

const tag=e=>({...e,cardLayer:e.type==='text'?STD_LAYERS.text:STD_LAYERS.symb});

/* ══ K/V/X/XZ — 두 점(대각 코너)으로 그리는 고정 기호. izzarder.com/317 의 한 그림에 네 기호가 함께 있어
   점1·점2와 실제 선의 관계(어느 점이 꼭짓점 x·y 를 결정하는지)를 픽셀 좌표로 대조해 확인했다. ══ */
export function buildX(p1,p2){
 return [
  {type:'line',points:[{x:p1.x,y:p1.y},{x:p2.x,y:p2.y}]},
  {type:'line',points:[{x:p1.x,y:p2.y},{x:p2.x,y:p1.y}]},
 ];
}
/** XZ(▷◁ 나비기호). 원문: "왼쪽에서 출발하면 좌우가 닫힌 면, 오른쪽에서 출발하면 위아래가 닫힌 면"
 *  → 점1이 점2보다 왼쪽(x 작음)이면 세로 변(좌우) 두 개 + 대각선 두 개, 아니면 가로 변(상하) 두 개 + 대각선 두 개. */
export function buildXZ(p1,p2){
 const edges=p1.x<=p2.x
  ?[[{x:p1.x,y:p1.y},{x:p1.x,y:p2.y}],[{x:p2.x,y:p1.y},{x:p2.x,y:p2.y}]]
  :[[{x:p1.x,y:p1.y},{x:p2.x,y:p1.y}],[{x:p1.x,y:p2.y},{x:p2.x,y:p2.y}]];
 const diagonals=[[{x:p1.x,y:p1.y},{x:p2.x,y:p2.y}],[{x:p1.x,y:p2.y},{x:p2.x,y:p1.y}]];
 return [...edges,...diagonals].map(points=>({type:'line',points}));
}
/** K(여닫이 "<"). 꼭짓점은 점1의 x 위치·중간 높이, 두 팔은 점2 쪽 x 열의 위·아래 모서리로 벌어진다. */
export function buildK(p1,p2){
 const vertex={x:p1.x,y:(p1.y+p2.y)/2};
 return [{type:'line',points:[vertex,{x:p2.x,y:p2.y}]},{type:'line',points:[vertex,{x:p2.x,y:p1.y}]}];
}
/** V. K 를 90도 돌린 모양 — 꼭짓점은 점1의 y 위치·중간 x, 두 팔은 점2 쪽 y 열의 좌·우 모서리로 벌어진다. */
export function buildV(p1,p2){
 const vertex={x:(p1.x+p2.x)/2,y:p1.y};
 return [{type:'line',points:[vertex,{x:p1.x,y:p2.y}]},{type:'line',points:[vertex,{x:p2.x,y:p2.y}]}];
}

/* ══ RD — 지붕배수구 기호(izzarder.com/195). 사각형 배수구 기호 + 내부 대각선(원문 "사각형 배수구 기호"). ══ */
export function buildRD(center,diameter){
 if(!(diameter>0))throw Error('배수구 지름은 양수여야 합니다.');
 const h=diameter/2,a={x:center.x-h,y:center.y-h},b={x:center.x+h,y:center.y+h};
 const corners=G.rectangle(a,b);
 return [
  {type:'polyline',closed:true,points:corners},
  {type:'line',points:[a,b]},
  {type:'line',points:[corners[1],corners[3]]},
 ];
}

/* ══ ELM/PLM — 레벨 기호. izzarder.com/234·235 의 설정 대화상자를 직접 읽었다(접두사·문자높이·소숫점자릿수·표시숫자·재순환).
   표시숫자 서식: 앞 공백·부호·콤마는 입력을 그대로 살리고(원문 "콤마가 있으면 결과에도 콤마"), 소숫점자릿수>0 이면
   그만큼 자리를 나눠 m 단위처럼 보이게 한다(원문 "mm 단위가 아닌 m 단위(3.500) 표기도 가능"). ══ */
export function formatLevelNumber(raw,decimals){
 const d=Math.max(0,Math.round(Number(decimals)||0));
 const s=String(raw??'');
 const leading=(s.match(/^\s*/)||[''])[0];
 let rest=s.trim();
 let sign='';
 if(rest[0]==='+'||rest[0]==='-'){sign=rest[0];rest=rest.slice(1);}
 const hasComma=rest.includes(',');
 const numeric=Number(rest.replace(/,/g,''));
 if(!Number.isFinite(numeric))throw Error('표시숫자를 숫자로 입력하세요.');
 if(!sign)sign=numeric<0?'-':'+';
 const value=Math.abs(numeric)/10**d;
 const body=d>0?value.toFixed(d):(hasComma?Math.round(value).toLocaleString('en-US'):String(Math.round(value)));
 return leading+sign+body;
}
/** ELM. 원문: "아래로 향한 삼각형(쐐기) 기호 + 문자"(입단면 레벨 표시). */
export function buildELM(point,prefix,formattedText,textHeight){
 if(!(textHeight>0))throw Error('문자높이는 양수여야 합니다.');
 const s=textHeight*1.3;
 const apex={x:point.x,y:point.y},bl={x:point.x-s/2,y:point.y+s},br={x:point.x+s/2,y:point.y+s};
 return [
  {type:'polyline',closed:true,points:[apex,bl,br]},
  {type:'text',position:{x:point.x+s*0.9,y:point.y+s*0.5},text:`${prefix} ${formattedText}`.trim(),height:textHeight,rotation:0,align:'left'},
 ];
}
/** PLM. 원문: "크로스헤어(타겟) 마커 + 밑줄 있는 문자"(평면 레벨 표시). 실제 삽입 블럭(xi_LeMark.dwg)은 얻을 수 없어
 *  이 근사 기호로 대신한다(아래 한계 참고). */
export function buildPLM(point,prefix,formattedText,textHeight){
 if(!(textHeight>0))throw Error('문자높이는 양수여야 합니다.');
 const r=textHeight*0.4,label=`${prefix} ${formattedText}`.trim();
 const tx=point.x+r*2.2,ty=point.y;
 return [
  {type:'circle',center:{x:point.x,y:point.y},radius:r},
  {type:'line',points:[{x:point.x-r*1.6,y:point.y},{x:point.x+r*1.6,y:point.y}]},
  {type:'line',points:[{x:point.x,y:point.y-r*1.6},{x:point.x,y:point.y+r*1.6}]},
  {type:'text',position:{x:tx,y:ty},text:label,height:textHeight,rotation:0,align:'left'},
  {type:'line',points:[{x:tx-r*0.3,y:ty-textHeight*0.35},{x:tx+label.length*textHeight*0.62,y:ty-textHeight*0.35}]},
 ];
}

/* ══ PPB — 참조도면 기호(izzarder.com/233). 사각형(PHANTOM 선종류) 모서리 두 점 → 리더(꺾임선) → 원(2단 문자). ══ */
export function buildPPB(p1,p2,detailNo,refDwg,symbolSize,textHeight){
 if(!(symbolSize>0)||!(textHeight>0))throw Error('기호크기·문자높이는 양수여야 합니다.');
 if(G.dist(p1,p2)<G.EPS)throw Error('사각형의 두 모서리 점은 서로 달라야 합니다.');
 const rect={type:'polyline',closed:true,linetype:'PHANTOM',points:G.rectangle({x:Math.min(p1.x,p2.x),y:Math.min(p1.y,p2.y)},{x:Math.max(p1.x,p2.x),y:Math.max(p1.y,p2.y)})};
 const dir=G.unit(G.sub(p2,p1));
 const elbow=G.add(p2,G.mul(dir,symbolSize));
 const horizEnd={x:elbow.x+Math.sign(dir.x||1)*symbolSize*1.6,y:elbow.y};
 const circle={type:'circle',center:horizEnd,radius:symbolSize/2};
 const divider={type:'line',points:[{x:horizEnd.x-symbolSize/2,y:horizEnd.y},{x:horizEnd.x+symbolSize/2,y:horizEnd.y}]};
 return [
  rect,
  {type:'line',points:[{x:p2.x,y:p2.y},elbow]},
  {type:'line',points:[elbow,horizEnd]},
  circle,divider,
  {type:'text',position:{x:horizEnd.x,y:horizEnd.y+symbolSize*0.22},text:String(detailNo),height:textHeight,align:'center'},
  {type:'text',position:{x:horizEnd.x,y:horizEnd.y-symbolSize*0.22},text:String(refDwg),height:textHeight*0.85,align:'center'},
 ];
}

/* ══ SL — 경사도 표시(izzarder.com/320). 대화상자를 직접 읽었다(삼각기호/문자표시/2x4목구조/문자각도/표현방식). ══ */
export function slopeOf(p1,p2){
 const run=Math.abs(p2.x-p1.x),rise=Math.abs(p2.y-p1.y);
 if(run<G.EPS)throw Error('두 점의 수평 거리가 0입니다(경사를 계산할 수 없습니다).');
 return {run,rise};
}
export function formatSlope(run,rise,mode){
 if(mode==='ratio1')return `1:${(rise/run).toFixed(2)}`;
 if(mode==='ratio10')return `10:${(rise/run*10).toFixed(2)}`;
 if(mode==='ratio1v')return `1:${(run/rise).toFixed(2)}`;
 return `${(rise/run*100).toFixed(1)}%`;
}
const readableAngle=a=>{const r=G.normalizeAngle(a);return r>90&&r<=270?G.normalizeAngle(r+180):r;};
export function buildSL(p1,p2,opts){
 const {run,rise}=slopeOf(p1,p2);
 if(!(opts.textHeight>0))throw Error('문자높이는 양수여야 합니다.');
 const text=`${opts.prefix||''}${formatSlope(run,rise,opts.format)}`;
 const entities=[],mid=G.mul(G.add(p1,p2),0.5),showTriangle=!!opts.triangle,showText=!showTriangle||!!opts.textOnSymbol;
 if(showTriangle){
  const corner={x:p1.x,y:p2.y};
  entities.push({type:'polyline',closed:true,points:[{x:p1.x,y:p1.y},corner,{x:p2.x,y:p2.y}]});
  if(opts.studs){
   const dir=G.unit(G.sub(p2,p1)),n=G.normal(dir);
   for(let k=1;k<=3;k++){
    const base=G.add(p1,G.mul(G.sub(p2,p1),k/4));
    entities.push({type:'line',points:[G.sub(base,G.mul(n,run*0.03)),G.add(base,G.mul(n,run*0.03))]});
   }
  }
 }
 if(showText){
  const angle=opts.horizontal?0:readableAngle(G.angle(G.sub(p2,p1)));
  const n=G.normal(G.unit(G.sub(p2,p1)));
  const pos=G.add(mid,G.mul(n,Math.max(run,rise)*0.06+20));
  entities.push({type:'text',position:pos,text,height:opts.textHeight,rotation:angle,align:'center'});
 }
 return entities;
}

/* ══ OOL — 여러 닫힌 도형이 겹칠 때 바깥 외곽선만 뽑는다(izzarder.com/583). 일반 다각형 합집합(구멍 없음)을
   간선 분할 + 중점 포함판정으로 구현했다: 모든 변을 서로 교차하는 지점에서 자르고, 잘린 조각의 중점이 "자기 자신이
   아닌 다른 도형" 안에 있으면(덮여 있으면) 버리고, 아무 도형에도 덮이지 않은 조각만 남겨 다시 고리로 잇는다. ══ */
function polyEdges(pts){const n=pts.length,out=[];for(let i=0;i<n;i++)out.push([pts[i],pts[(i+1)%n]]);return out;}
export function outlineOfPolygons(polys){
 if(!polys||polys.length<1)throw Error('닫힌 도형이 없습니다.');
 if(polys.length===1)return [polys[0].map(p=>({x:p.x,y:p.y}))];
 const kept=[];
 for(let si=0;si<polys.length;si++){
  for(const [a,b] of polyEdges(polys[si])){
   const ts=[0,1];
   for(let sj=0;sj<polys.length;sj++){
    if(sj===si)continue;
    for(const [c,d] of polyEdges(polys[sj])){
     const h=G.lineIntersection(a,b,c,d);
     if(h&&h.t>1e-9&&h.t<1-1e-9&&h.u>-1e-9&&h.u<1+1e-9)ts.push(h.t);
    }
   }
   ts.sort((x,y)=>x-y);
   for(let k=0;k<ts.length-1;k++){
    const t0=ts[k],t1=ts[k+1];if(t1-t0<1e-9)continue;
    const p0=G.add(a,G.mul(G.sub(b,a),t0)),p1=G.add(a,G.mul(G.sub(b,a),t1)),mid=G.mul(G.add(p0,p1),0.5);
    let covered=false;
    for(let sj=0;sj<polys.length;sj++){if(sj===si)continue;if(G.inside(mid,polys[sj])){covered=true;break;}}
    if(!covered)kept.push([p0,p1]);
   }
  }
 }
 if(!kept.length)throw Error('선택한 도형들이 서로 겹치지 않습니다(외곽선을 뽑을 필요가 없습니다).');
 const key=p=>`${Math.round(p.x*1000)/1000},${Math.round(p.y*1000)/1000}`;
 const starts=new Map();
 kept.forEach((s,i)=>{const k=key(s[0]);if(!starts.has(k))starts.set(k,[]);starts.get(k).push(i);});
 const used=new Array(kept.length).fill(false),loops=[];
 for(let i=0;i<kept.length;i++){
  if(used[i])continue;
  const loop=[kept[i][0]];let cur=i;
  for(;;){
   used[cur]=true;const endPt=kept[cur][1];loop.push(endPt);
   const cands=(starts.get(key(endPt))||[]).filter(j=>!used[j]);
   if(!cands.length)break;
   cur=cands[0];
  }
  if(loop.length>3&&key(loop[0])===key(loop.at(-1))){loop.pop();loops.push(loop);}
 }
 if(!loops.length)throw Error('닫힌 외곽선을 만들지 못했습니다(끝점이 서로 맞물리지 않습니다).');
 return loops;
}
/** 선택 객체를 닫힌 다각형 점열로 바꾼다. 열린 선·문자·블록 등은 null(제외). 원은 표본화한다. */
export function closedPolygonPoints(e,steps=48){
 if(e.type==='rectangle')return e.points.map(p=>({x:p.x,y:p.y}));
 if(e.type==='polyline'&&e.closed)return e.points.map(p=>({x:p.x,y:p.y}));
 if(e.type==='circle'){const pts=[];for(let i=0;i<steps;i++)pts.push(G.add(e.center,G.polar(e.radius,i*360/steps)));return pts;}
 return null;
}

/* ══ LXP — 선 모양대로 낱개 선으로 폭파. CENTER/PHANTOM/DOT/DASHED/HIDDEN 5종의 대시 비율은
   view.js 의 linetypeDashPattern 과 같은 비율([12,4,2,4] 등)을 이 모듈 안에 다시 정의했다(공유 파일은 읽기만 했다). ══ */
export function dashRatioFor(linetype){
 const t=String(linetype||'CONTINUOUS').toUpperCase();
 if(t.includes('CENTER'))return [12,4,2,4];
 if(t.includes('PHANTOM'))return [12,3,2,3,2,3];
 if(t.includes('DOT'))return [1,4];
 if(t.includes('DASH')||t.includes('HIDDEN'))return [7,5];
 return null;
}
export function entityPathPoints(e,steps=96){
 if(e.type==='line')return [{x:e.points[0].x,y:e.points[0].y},{x:e.points[1].x,y:e.points[1].y}];
 if(e.type==='polyline'||e.type==='rectangle'){const pts=e.points.map(p=>({x:p.x,y:p.y}));if(e.closed||e.type==='rectangle')pts.push(pts[0]);return pts;}
 if(e.type==='circle'){const pts=[];for(let i=0;i<=steps;i++)pts.push(G.add(e.center,G.polar(e.radius,i*360/steps)));return pts;}
 if(e.type==='arc'){const sweep=G.normalizeAngle(e.endAngle-e.startAngle)||360,pts=[];for(let i=0;i<=steps;i++)pts.push(G.add(e.center,G.polar(e.radius,e.startAngle+sweep*i/steps)));return pts;}
 throw Error('선·폴리선·사각형·원·호만 지원합니다.');
}
export function pathLength(pts){let L=0;for(let i=1;i<pts.length;i++)L+=G.dist(pts[i-1],pts[i]);return L;}
export function pointAtLength(pts,s){
 if(s<=0)return pts[0];
 let acc=0;
 for(let i=1;i<pts.length;i++){
  const seg=G.dist(pts[i-1],pts[i]);
  if(acc+seg>=s-1e-9){const t=seg<G.EPS?0:(s-acc)/seg;return G.add(pts[i-1],G.mul(G.sub(pts[i],pts[i-1]),t));}
  acc+=seg;
 }
 return pts.at(-1);
}
export const LXP_MAX_PIECES=20000;
export function explodeByPattern(pts,pattern){
 const total=pathLength(pts);
 if(!(total>1e-6))throw Error('선의 길이가 0입니다.');
 /* 2026-09-24(검토 P2 계열): 기준 길이가 아주 작으면 조각이 수십억 개가 되어 멈췄다. */
 const cycle=pattern.reduce((s,v)=>s+Math.max(1e-6,v),0);
 assertGeneratedCount(Math.ceil(total/cycle)*Math.ceil(pattern.length/2),'LXP · 선 조각',LXP_MAX_PIECES);
 const out=[];let s=0,i=0,on=true;
 while(s<total-1e-6){
  const segLen=Math.max(1e-6,pattern[i%pattern.length]);
  const e=Math.min(total,s+segLen);
  if(on&&e-s>1e-6)out.push({type:'line',points:[pointAtLength(pts,s),pointAtLength(pts,e)]});
  s=e;i++;on=!on;
 }
 if(!out.length)throw Error('폭파할 선 조각이 없습니다(기준 길이를 줄여 보세요).');
 return out;
}

/* ══ MTLT — 문자 포함 선 만들기(izzarder.com/534). 2026-09-24: 안내만 하던 것을 실제 동작으로.
   바른 CAD 선종류는 대시 비율만 있고 문자 요소를 그릴 수 없어서, 고른 선을 "대시 선분 + 선 방향으로 돌린 문자"
   조각으로 바꿔 화면·출력·DXF 모두에 같은 모양이 나오게 한다. 원문처럼 캐드용 선종류 정의(.lin)도 함께 저장할 수 있고,
   만든 정의는 LEX(선 모양 내보내기)가 다시 내보낼 수 있게 카드 설정에 남긴다. ══ */
export const MTLT_STORE_KEY='barun-mtlt-linetypes';
export const MTLT_MAX_PIECES=5000;
export function textDrawWidth(text,height){
 return [...String(text)].reduce((w,ch)=>w+(/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3\u4e00-\u9fff]/.test(ch)?1:0.62)*height,0);
}
export function textLinePieces(pts,{text,height,dash}){
 const label=String(text??'').trim();
 if(!label)throw Error('MTLT · 선에 넣을 문자를 입력하세요.');
 if(!(height>0)||!(dash>0))throw Error('MTLT · 문자 높이와 대시 길이는 0보다 커야 합니다.');
 const total=pathLength(pts);
 if(!(total>1e-6))throw Error('MTLT · 선의 길이가 0입니다.');
 const gap=textDrawWidth(label,height)+height,cycle=dash+gap;
 assertGeneratedCount(Math.ceil(total/cycle)*2,'MTLT · 선 조각',MTLT_MAX_PIECES);
 const out=[];let s=0,texts=0;
 const angleAt=at=>{let acc=0;for(let i=1;i<pts.length;i++){const seg=G.dist(pts[i-1],pts[i]);if(acc+seg>=at-1e-9&&seg>G.EPS)return G.angle(G.sub(pts[i],pts[i-1]));acc+=seg;}return G.angle(G.sub(pts.at(-1),pts[0]));};
 while(s<total-1e-6){
  const e=Math.min(total,s+dash);
  if(e-s>1e-6)out.push({type:'line',points:[pointAtLength(pts,s),pointAtLength(pts,e)]});
  s=e;
  if(s+gap>total+1e-6){if(total-s>1e-6)out.push({type:'line',points:[pointAtLength(pts,s),pointAtLength(pts,total)]});break;}
  const mid=s+gap/2,at=pointAtLength(pts,mid);
  let rot=angleAt(mid);const up=((rot%360)+360)%360;if(up>90&&up<=270)rot+=180;
  const n=G.polar(1,rot+90);
  out.push({type:'text',position:G.add(at,G.mul(n,-height/2)),text:label,height,rotation:((rot%360)+360)%360,align:'center'});
  texts++;s+=gap;
 }
 if(!texts)throw Error('MTLT · 선이 짧아 문자를 넣을 자리가 없습니다(대시 길이나 문자 높이를 줄이세요).');
 return out;
}
export function loadTextLinetypes(storage){try{const list=JSON.parse(storage?.getItem?.(MTLT_STORE_KEY)||'[]');return Array.isArray(list)?list.filter(d=>d&&d.name&&d.text):[];}catch{return [];}}
export function saveTextLinetype(storage,def){
 const list=loadTextLinetypes(storage).filter(d=>d.name!==def.name);list.push(def);
 try{storage?.setItem?.(MTLT_STORE_KEY,JSON.stringify(list.slice(-50)));}catch{}
 return list;
}
/* ══ LEX — 선 모양 내보내기. 2026-09-24: 안내만 하던 것을 실제 동작으로. 도면(켜·객체·블록 안)이 쓰는 선종류와
   MTLT 로 만든 문자 포함 선을 캐드 호환 .lin 파일로 내려받는다. 바른 CAD 선종류 비율은 view.js 와 같다. ══ */
export function usedLinetypeKeys(entities,layers){
 const keys=new Set();
 const add=v=>{const k=barunLinetypeKey(v);if(k)keys.add(k);};
 for(const l of layers||[])add(l.linetype);
 const visit=e=>{add(e.linetype);for(const c of e.entities||[])visit(c);};
 for(const e of entities||[])visit(e);
 return Object.keys(BARUN_LINETYPES).filter(k=>keys.has(k));
}
export function linetypeExportText(keys,textLinetypes=[]){
 const defs=[...keys.map(k=>barunLinetypeDefinition(k)),...textLinetypes.map(d=>textLinetypeDefinition(d.name,d.text,{dash:d.linDash||12.7,height:d.linHeight||2.5}))];
 if(!defs.length)throw Error('LEX · 내보낼 선종류가 없습니다(도면이 실선만 씁니다). "바른 CAD 선종류 전체"를 고르세요.');
 return {text:linFileText(defs,{title:'바른 CAD 선종류 내보내기(LEX)'}),count:defs.length};
}

/* ── 화면(설치) ── */
export function installSymbolTools(ctx){
 const fail=e=>{console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);};
 const textHeightDefault=()=>ctx.num('text-height',150);

 const twoPointPreview=build=>(points,cursor)=>{
  const p1=points[0],p2=cursor||points[1];
  if(!p1||!p2)return [];
  try{return build(p1,p2).map(e=>({...e,previewColor:'#ff9f68'}));}catch{return [];}
 };
 async function twoPointSymbol(name,label,build){
  try{
   const pts=(await ctx.pickPath({prompt:`${name} · ${label} · 대각 두 점을 지정하세요 · Esc 취소`,preview:twoPointPreview(build),minPoints:2,maxPoints:2}))?.points;
   if(!pts)return;
   const entities=resolveLayers(ctx,build(pts[0],pts[1]).map(tag));
   ctx.commit({entities});
   ctx.toast(`${name} · 기호를 그렸습니다 · Ctrl+Z 로 되돌리기`);
  }catch(e){fail(e);}
 }

 async function runCMW(){
  try{
   const picked=await ctx.pickEntity({prompt:'CMW · 두께를 줄 구름형 수정기호(폴리선 또는 CM 의 구름 호)를 선택하세요 · Esc 취소',types:['polyline','rectangle','arc']});
   if(!picked)return;
   // CM 은 구름을 낱개 반원 호로 그린다(엔진 폴리선에 둥근 구간이 없음). 호를 고르면 이어진 호 전부를 촘촘한 닫힌 폴리선 하나로 바꿔 두께를 준다(2026-10-27 설명서 시험).
   const chain=picked.type==='arc'?cloudArcChain(ctx.entities(),picked):null;
   const e=chain?{type:'polyline',layer:picked.layer,closed:chain.closed,points:chain.points}:picked;
   const removeIds=chain?chain.ids:[picked.id];
   ctx.askNumber({title:'CMW · 구름형 수정기호 입체화',label:'두께 (mm, 0=두께 없애기)',value:e.constantWidth||40,min:0,allowZero:true},async width=>{
    if(!(width>=0))throw Error('두께는 0 이상이어야 합니다.');
    ctx.commit({removeIds,entities:[{...e,constantWidth:width}]});
    ctx.toast(`CMW · 두께 ${width}mm 를 적용했습니다 · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(e);}
 }

 async function runRD(){
  try{
   ctx.askNumber({title:'RD · 지붕배수구 기호',label:'배수구 지름 (mm)',value:200},async dia=>{
    if(!(dia>0))throw Error('지름은 양수여야 합니다.');
    const p=await ctx.pickPoint('RD · 배수구를 삽입할 점을 지정하세요 · Esc 취소');
    if(!p)return;
    const entities=resolveLayers(ctx,buildRD(p,dia).map(tag));
    ctx.commit({entities});
    ctx.toast('RD · 배수구 기호를 그렸습니다 · Ctrl+Z 로 되돌리기');
   });
  }catch(e){fail(e);}
 }

 async function levelLoop(name,defaults,build){
  ctx.form(`${name} · ${defaults.title}`,[
   {name:'prefix',label:'접두사',type:'text',value:defaults.prefix},
   {name:'text',label:'표시숫자',type:'text',value:'3500'},
   {name:'decimals',label:'소숫점자릿수',type:'number',value:0},
   {name:'height',label:'문자높이 (mm)',type:'number',value:textHeightDefault()},
   {name:'loop',label:defaults.loopLabel,type:'checkbox',value:defaults.loopDefault?'on':''},
  ],async values=>{
   const height=Number(values.height);
   const text=formatLevelNumber(values.text,values.decimals);
   const loop=values.loop==='on';
   let count=0;
   for(;;){
    const p=await ctx.pickPoint(`${name} · 삽입점을 지정하세요${loop?' · 계속 클릭, Esc 로 끝내기':' · Esc 취소'}`);
    if(!p)break;
    const entities=resolveLayers(ctx,build(p,values.prefix,text,height).map(tag));
    ctx.commit({entities});
    count++;
    if(!loop)break;
   }
   if(count)ctx.toast(`${name} · 레벨 기호 ${count}개를 그렸습니다 · Ctrl+Z 로 되돌리기`);
  });
 }
 const runELM=()=>{try{levelLoop('ELM',{title:'입단면 레벨 기호 그리기',prefix:'E.L',loopLabel:'입력 후 재순환',loopDefault:false},buildELM);}catch(e){fail(e);}};
 const runPLM=()=>{try{levelLoop('PLM',{title:'평면 레벨 기호 그리기',prefix:'F.L',loopLabel:'명령 종료 후 재순환',loopDefault:true},buildPLM);}catch(e){fail(e);}};

 async function runPPB(){
  try{
   ctx.form('PPB · 참조도면 기호 그리기',[
    {name:'detail',label:'상세번호',type:'text',value:'1'},
    {name:'ref',label:'참조도면',type:'text',value:'A-205'},
    {name:'size',label:'기호크기 (mm)',type:'number',value:600},
    {name:'height',label:'문자높이 (mm)',type:'number',value:textHeightDefault()},
    {name:'loop',label:'입력 후 재순환',type:'checkbox'},
   ],async values=>{
    const size=Number(values.size),height=Number(values.height),loop=values.loop==='on';
    const build=(p1,p2)=>buildPPB(p1,p2,values.detail,values.ref,size,height);
    let count=0;
    for(;;){
     const pts=(await ctx.pickPath({prompt:`PPB · ①모서리점 ②꺾임점 을 지정하세요${loop?' · 계속 지정, Esc 로 끝내기':' · Esc 취소'}`,preview:twoPointPreview(build),minPoints:2,maxPoints:2}))?.points;
     if(!pts)break;
     const entities=resolveLayers(ctx,build(pts[0],pts[1]).map(tag));
     ctx.commit({entities});
     count++;
     if(!loop)break;
    }
    if(count)ctx.toast(`PPB · 참조도면 기호 ${count}개를 그렸습니다 · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(e);}
 }

 async function runSL(){
  try{
   ctx.form('SL · 경사도 표현',[
    {name:'prefix',label:'접두어',type:'text',value:'SLOPE ='},
    {name:'height',label:'문자높이 (mm)',type:'number',value:textHeightDefault()},
    {name:'triangle',label:'삼각 기호 표시',type:'checkbox'},
    {name:'textOnSymbol',label:'기호에 문자 표시(삼각 기호 켰을 때만)',type:'checkbox',value:'on'},
    {name:'studs',label:'2x4 목구조(삼각 기호 켰을 때만)',type:'checkbox'},
    {name:'horizontal',label:'문자를 수평으로(선택 안하면 기울기에 맞춤)',type:'checkbox'},
    {name:'format',label:'표현방식',type:'text',value:'percent',options:[['percent','20%'],['ratio1','1:0.2'],['ratio10','10:2'],['ratio1v','1:5']]},
   ],async values=>{
    const height=Number(values.height);
    const opts={prefix:values.prefix,textHeight:height,triangle:values.triangle==='on',textOnSymbol:values.textOnSymbol==='on',studs:values.studs==='on',horizontal:values.horizontal==='on',format:values.format};
    const build=(p1,p2)=>buildSL(p1,p2,opts);
    const pts=(await ctx.pickPath({prompt:'SL · 경사의 두 점을 지정하세요 · Esc 취소',preview:twoPointPreview(build),minPoints:2,maxPoints:2}))?.points;
    if(!pts)return;
    const entities=resolveLayers(ctx,build(pts[0],pts[1]).map(tag));
    ctx.commit({entities});
    ctx.toast('SL · 경사도 표시를 그렸습니다 · Ctrl+Z 로 되돌리기');
   });
  }catch(e){fail(e);}
 }

 async function runOOL(){
  try{
   const picked=[];
   for(;;){
    const e=await ctx.pickEntity({prompt:`OOL · 외곽선을 뽑을 닫힌 도형(원·닫힌 폴리선·사각형)을 선택하세요 · 지금까지 ${picked.length}개 · Esc 로 끝내기`,types:['polyline','rectangle','circle']});
    if(!e)break;
    if(e.type==='polyline'&&!e.closed){ctx.toast('열린 폴리선은 제외했습니다(닫힌 도형만 지원합니다).',true);continue;}
    picked.push(e);
   }
   if(picked.length<2){ctx.toast('겹치는 닫힌 도형을 2개 이상 선택하세요.');return;}
   const polys=picked.map(e=>closedPolygonPoints(e));
   const loops=outlineOfPolygons(polys);
   ctx.commit({removeIds:picked.map(e=>e.id),entities:loops.map(pts=>({type:'polyline',closed:true,points:pts,layer:picked[0].layer}))}); // 첫 도형의 레이어를 잇는다
   ctx.toast(`OOL · 원본 ${picked.length}개 → 외곽선 ${loops.length}개 · Ctrl+Z 로 되돌리기`);
  }catch(e){fail(e);}
 }

 function runMTLT(){
  try{
   ctx.form('MTLT · 문자 포함 선 만들기',[
    {name:'text',label:'선에 넣을 문자(예: GAS, 우수)',type:'text',value:'GAS'},
    {name:'height',label:'문자 높이 (mm)',type:'number',value:textHeightDefault()},
    {name:'dash',label:'문자 사이 선 길이 (mm)',type:'number',value:textHeightDefault()*8},
    {name:'name',label:'선종류 이름(영문·숫자, .lin 저장용)',type:'text',value:'BARUN_TEXT_LINE'},
    {name:'saveLin',label:'캐드용 선종류 정의(.lin)도 저장',value:'no',options:[['no','아니요'],['yes','예']]},
   ],async values=>{
    const height=boundedNumber(values.height,{min:0,max:1e5,exclusiveMin:true,label:'MTLT · 문자 높이(mm)'});
    const dash=boundedNumber(values.dash,{min:0,max:1e7,exclusiveMin:true,label:'MTLT · 선 길이(mm)'});
    const text=String(values.text||'').trim();if(!text)throw Error('MTLT · 선에 넣을 문자를 입력하세요.');
    const name=patternName(values.name,'BARUN_TEXT_LINE');
    const e=await ctx.pickEntity({prompt:'MTLT · 문자를 넣을 선·폴리선·호·원을 선택하세요 · Esc 취소',types:['line','polyline','rectangle','circle','arc']});
    if(!e)return;
    const pieces=textLinePieces(entityPathPoints(e),{text,height,dash});
    const textLayer=ctx.ensureLayer(STD_LAYERS.text,'#ffffff');
    ctx.commit({removeIds:[e.id],entities:pieces.map(p=>p.type==='text'?{...p,layer:textLayer}:{...p,layer:e.layer,color:e.color,lineweight:e.lineweight})});
    saveTextLinetype(ctx.storage,{name,text,height,dash});
    if(values.saveLin==='yes')downloadText(safeFileName(name)+'.lin',linFileText([textLinetypeDefinition(name,text)],{title:'바른 CAD 문자 포함 선(MTLT)'}));
    ctx.toast(`MTLT · "${text}" 문자 포함 선으로 바꿨습니다(선 ${pieces.filter(p=>p.type==='line').length}조각 · 문자 ${pieces.filter(p=>p.type==='text').length}개)${values.saveLin==='yes'?` · ${name}.lin 저장`:''} · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(e);}
 }
 function runLEX(){
  try{
   const used=usedLinetypeKeys(ctx.entities(),ctx.layers()),custom=loadTextLinetypes(ctx.storage);
   ctx.form('LEX · 선 모양 내보내기(.lin)',[
    {name:'scope',label:'내보낼 선종류',value:used.length||custom.length?'used':'all',options:[['used',`도면에서 쓰는 선종류(${used.join(', ')||'없음'})${custom.length?` + MTLT ${custom.length}개`:''}`],['all','바른 CAD 선종류 전체(CENTER·PHANTOM·DOT·DASHED·HIDDEN)']]},
    {name:'file',label:'파일 이름(.lin 은 자동)',type:'text',value:'barun'},
   ],values=>{
    const keys=values.scope==='all'?Object.keys(BARUN_LINETYPES):used;
    const result=linetypeExportText(keys,custom);
    const fileName=safeFileName(String(values.file||'barun').replace(/\.lin$/i,''),'barun')+'.lin';
    downloadText(fileName,result.text);
    ctx.toast(`LEX · 선종류 ${result.count}개를 "${fileName}" 로 내보냈습니다(바른 CAD 화면 비율 × ${2.5}mm).`);
   });
  }catch(e){fail(e);}
 }

 async function runLXP(){
  try{
   const e=await ctx.pickEntity({prompt:'LXP · 선 모양대로 폭파할 객체(선·폴리선·사각형·원·호)를 선택하세요 · Esc 취소',types:['line','polyline','rectangle','circle','arc']});
   if(!e)return;
   const ratio=dashRatioFor(e.linetype);
   if(!ratio)throw Error('이 객체는 실선(CONTINUOUS)이라 선 모양이 없습니다. CENTER·PHANTOM·DOT·DASHED·HIDDEN 선종류만 폭파할 수 있습니다.');
   ctx.askNumber({title:'LXP · 선 모양대로 폭파하기',label:'선 조각 기준 길이 배수 (mm, 선종류 간격에 곱함)',value:10},async factor=>{
    if(!(factor>0))throw Error('기준 길이 배수는 양수여야 합니다.');
    const pattern=ratio.map(v=>v*factor);
    const pts=entityPathPoints(e);
    const pieces=explodeByPattern(pts,pattern).map(p=>({...p,layer:e.layer}));
    ctx.commit({removeIds:[e.id],entities:pieces});
    ctx.toast(`LXP · 선 모양(${e.linetype})대로 조각 ${pieces.length}개로 폭파했습니다 · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(e);}
 }

 return {
  CMW:runCMW,
  ELM:runELM,
  K:()=>twoPointSymbol('K','힌지=점1 쪽(대각 코너 두 점)',buildK),
  PLM:runPLM,
  PPB:runPPB,
  RD:runRD,
  SL:runSL,
  V:()=>twoPointSymbol('V','힌지=점1 쪽(대각 코너 두 점)',buildV),
  X:()=>twoPointSymbol('X','대각 코너 두 점',buildX),
  XZ:()=>twoPointSymbol('XZ','대각 코너 두 점(점1이 왼쪽이면 좌우가 닫힘)',buildXZ),
  OOL:runOOL,
  MTLT:runMTLT,
  LEX:runLEX,
  LXP:runLXP,
 };
}

/** CM 구름의 호 하나에서 시작해 끝점이 맞닿는 같은 레이어 호들을 차례로 이어 점 목록으로(호마다 12 조각). */
export function cloudArcChain(entities,start){
 const rad=d=>d*Math.PI/180,pt=(a,deg)=>({x:a.center.x+a.radius*Math.cos(rad(deg)),y:a.center.y+a.radius*Math.sin(rad(deg))});
 const ends=a=>[pt(a,a.startAngle),pt(a,a.endAngle)],near=(p,q,t)=>Math.hypot(p.x-q.x,p.y-q.y)<=t;
 const pool=entities.filter(x=>x.type==='arc'&&x.layer===start.layer&&x.id!==start.id),ids=[start.id],points=[];
 const sample=(a,reverse)=>{let s=a.startAngle,e=a.endAngle;if(e<s)e+=360;const out=[];for(let i=0;i<=12;i++)out.push(pt(a,s+(e-s)*i/12));return reverse?out.reverse():out;};
 let cur=start,rev=false,closed=false;
 for(;;){
  const seg=sample(cur,rev);points.push(...(points.length?seg.slice(1):seg));
  const tail=points.at(-1),tol=Math.max(1e-6,cur.radius*1e-3);
  if(points.length>13&&near(tail,points[0],tol)){points.pop();closed=true;break;}
  const i=pool.findIndex(a=>ends(a).some(p=>near(p,tail,tol)));
  if(i<0)break;
  const next=pool.splice(i,1)[0];rev=!near(ends(next)[0],tail,tol);ids.push(next.id);cur=next;
 }
 return {points,ids,closed};
}
