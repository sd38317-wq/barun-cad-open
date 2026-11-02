// 그리기 카드 3개: DEV 전개도 그리기(izzarder.com/398) · ISD 아이소메트릭 그리기(izzarder.com/592) · PZ 부분 확대 그리기(izzarder.com/290).
// 원문 대화상자 항목과 명령행 순서를 그대로 옮겼다. DEV 는 [테두리 켜·구분선 켜·기준 높이·수평선 그리기·수직선그리기·입력 후 재 순환],
// ISD 는 원문 옵션줄 "설정(S)/ 선(L)/ 원(C)/ 치수(D)/ 문자(T)/ 중심선(CE)/ 변경(CH)", PZ 는 [방식선택 · 설정(켜·색상·선종류·확대 배율·일반 블럭으로 생성)] 이다.
import * as G from './geometry.js';
import {entitiesSvg,openCardDialog,resolveLayers,readableAngle} from './card-kit.js';

/* ── 이 카드들이 쓰는 켜 표준(규칙서 6절). 원문 켜 이름은 선 굵기용(W2·S)이거나 "현재 켜"라서 요소별 표준 이름으로 옮겼다. ── */
export const UNFOLD_LAYERS=Object.freeze({elev:'A-ELEV-VIEW',symb:'A-SYM',text:'A-TEXT',dims:'A-DIM',cntr:'A-CNTR'});
export const UNFOLD_COLORS=Object.freeze({'A-ELEV-VIEW':'#9ad0ff','A-SYM':'#ff9f68','A-TEXT':'#ffffff','A-DIM':'#7bdc7b','A-CNTR':'#ff5a5a'});
export const LINETYPE_OPTIONS=[['CONTINUOUS','실선'],['CENTER','중심선'],['DASHED','파선'],['HIDDEN','숨은선'],['DOT','점선']];
const colorOf=name=>UNFOLD_COLORS[name]||'#ffd479';

/* ══════════════════════════════════════════════════════════════════════
   공통 곡선 도구 — 전개도(DEV)가 쓰는 "선을 곧게 편 거리" 계산
   ══════════════════════════════════════════════════════════════════════ */
export const CURVE_TYPES=['line','polyline','rectangle','arc','circle'];

/** 선·폴리선·사각형·호·원을 점 목록으로 편다. 폴리선의 bulge(곡선 구간)는 곧은 선으로 본다. */
export function curvePoints(e,steps=72){
 if(!e||!CURVE_TYPES.includes(e.type))throw Error('전개도는 선·폴리선·사각형·호·원에서만 그립니다.');
 if(e.type==='arc'){
  const sweep=G.normalizeAngle(e.endAngle-e.startAngle)||360,n=Math.max(8,Math.ceil(sweep/5));
  return Array.from({length:n+1},(_,i)=>G.add(e.center,G.polar(e.radius,e.startAngle+sweep*i/n)));
 }
 if(e.type==='circle')return Array.from({length:steps+1},(_,i)=>G.add(e.center,G.polar(e.radius,i*360/steps)));
 const pts=(e.points||[]).map(p=>({x:p.x,y:p.y}));
 if(pts.length<2)throw Error('점이 둘 이상인 선을 고르세요.');
 if((e.closed||e.type==='rectangle')&&G.dist(pts[0],pts.at(-1))>G.EPS)pts.push({x:pts[0].x,y:pts[0].y});
 return pts;
}
/** 점 목록의 누적 거리 [0, d1, d1+d2, …]. 마지막 값이 전체 길이다. */
export function cumulative(pts){
 const out=[0];
 for(let i=1;i<pts.length;i++)out.push(out[i-1]+G.dist(pts[i-1],pts[i]));
 return out;
}
export const curveLength=pts=>cumulative(pts).at(-1);
/** 점 p 를 곡선에 내려 찍은 자리까지의 누적 거리. 곡선에서 떨어져 있어도 가장 가까운 구간으로 잰다. */
export function lengthAlong(pts,p){
 const acc=cumulative(pts);let best=0,bd=Infinity;
 for(let i=1;i<pts.length;i++){
  const a=pts[i-1],b=pts[i],v=G.sub(b,a),l2=G.dot(v,v);
  if(l2<G.EPS)continue;
  const t=Math.max(0,Math.min(1,G.dot(G.sub(p,a),v)/l2)),foot=G.add(a,G.mul(v,t)),d=G.dist(p,foot);
  if(d<bd){bd=d;best=acc[i-1]+Math.sqrt(l2)*t;}
 }
 return best;
}
/** 원문: "객체를 선택할 때 바라 보는 방향에서 왼쪽의 한 점을 지정하면 그 쪽으로 바라보는 전개도가 그려집니다."
 *  → 선을 고를 때 찍은 점에 가까운 끝이 전개도의 왼쪽이 된다. 뒤쪽 절반을 찍었으면 좌우를 뒤집는다(-1). */
export function unfoldFlip(pts,pick){
 const L=curveLength(pts);
 if(!(L>0))throw Error('길이가 0 인 선입니다.');
 return lengthAlong(pts,pick)<=L/2?1:-1;
}
/** 나눔점(찍은 점 또는 교차점)을 전개도 x 좌표(0…L)로 바꾼다. 양 끝과 겹치거나 중복인 값은 버린다. */
export function unfoldMarks(pts,marks,flip=1,tol=0.5){
 const L=curveLength(pts),out=[];
 for(const m of marks||[]){
  let s=lengthAlong(pts,m);
  if(flip<0)s=L-s;
  if(s<=tol||s>=L-tol)continue;
  if(out.some(v=>Math.abs(v-s)<=tol))continue;
  out.push(s);
 }
 return out.sort((a,b)=>a-b);
}

/* ══════════════════════════════════════════════════════════════════════
   DEV — 전개도 그리기 (izzarder.com/398, xiDrawExplodedView)
   원문 대화상자 "전개도 그리기": 테두리 켜 / 구분선 켜 / 기준 높이(3000.0000) /
   [테두리 설정] 수평선 그리기·수직선그리기 / 입력 후 재 순환
   원문 명령행: 설정(S)/ 전개도를 그릴 선을 선택 → 중간구분선 위치 지정 <엔터=교차선선택> → 교차선 선택 → 전개도 높이 입력 <3000.0000>
   ══════════════════════════════════════════════════════════════════════ */
export const DEV_STORAGE_KEY='barun-unfold-dev-card';
export const DEV_FIELDS=[
 {key:'height',label:'기준 높이 (mm)',type:'number',def:3000,min:1,step:100,group:'전개도',hint:'원문 기본값 3000. 전개도 사각 박스의 높이입니다.'},
 {key:'drawH',label:'수평선 그리기',type:'check',def:true,group:'테두리 설정'},
 {key:'drawV',label:'수직선그리기',type:'check',def:true,group:'테두리 설정'},
 {key:'recycle',label:'입력 후 재 순환',type:'check',def:false,group:'테두리 설정',hint:'그린 뒤 같은 설정으로 다시 선 선택부터 반복합니다. Esc 로 끝냅니다.'},
];
export const DEV_SHARED_FIELDS=[
 {key:'borderLayer',label:'테두리 켜',type:'layer',def:UNFOLD_LAYERS.elev,group:'켜 설정'},
 {key:'markLayer',label:'구분선 켜',type:'layer',def:UNFOLD_LAYERS.symb,group:'켜 설정'},
];

/** 전개도 객체. origin 은 전개도 왼쪽 아래 모서리, length 는 편 길이, marks 는 0…length 안의 구분선 위치. */
export function buildUnfold(v,shared,{length,marks=[],origin={x:0,y:0}}){
 const h=Number(v.height);
 if(!(h>0))throw Error('기준 높이는 0보다 커야 합니다.');
 if(!(length>0))throw Error('전개할 길이가 0 입니다. 선을 다시 고르세요.');
 const border=shared?.borderLayer||UNFOLD_LAYERS.elev,mark=shared?.markLayer||UNFOLD_LAYERS.symb;
 const P=(dx,dy)=>({x:origin.x+dx,y:origin.y+dy}),out=[];
 if(v.drawH){
  out.push({type:'line',points:[P(0,0),P(length,0)],cardLayer:border});
  out.push({type:'line',points:[P(0,h),P(length,h)],cardLayer:border});
 }
 if(v.drawV){
  out.push({type:'line',points:[P(0,0),P(0,h)],cardLayer:border});
  out.push({type:'line',points:[P(length,0),P(length,h)],cardLayer:border});
 }
 for(const s of marks)out.push({type:'line',points:[P(s,0),P(s,h)],cardLayer:mark});
 if(!out.length)throw Error('수평선·수직선을 모두 끄고 구분선도 없으면 그릴 것이 없습니다.');
 return out;
}
export function devPreviewSvg(v,shared,opts={}){
 const L=12000,marks=[2400,5200,5900,9100];
 const es=buildUnfold(v,shared,{length:L,marks,origin:{x:0,y:0}});
 const curve=[{type:'polyline',points:[{x:0,y:-2600},{x:3000,y:-3600},{x:7000,y:-3500},{x:11500,y:-2200}],previewColor:'#5f6b76'}];
 return entitiesSvg([...curve,...es],{label:opts.compact?'':`전개 길이 ${L} × 높이 ${v.height} · 구분선 ${marks.length}개 (회색 = 전개 전 선)`,...opts});
}

/* ══════════════════════════════════════════════════════════════════════
   ISD — 아이소메트릭 그리기 (izzarder.com/592, xiIsometricDraw)
   원문 옵션줄: 설정(S)/ 선(L)/ 원(C)/ 치수(D)/ 문자(T)/ 중심선(CE)/ 변경(CH)
   원문 설정: 문자·치수·중심선의 켜
   ══════════════════════════════════════════════════════════════════════ */
export const ISD_STORAGE_KEY='barun-unfold-isd-card';
/** 등각 3축(30·150·90도)과 그 반대 방향. 선은 이 여섯 방향으로만 그어진다. */
export const ISO_AXES=Object.freeze([30,90,150,210,270,330]);
/** 등각면별 타원 장축 각도. 상면은 수평(0), 우면 60, 좌면 120 — 각 면에 수직인 축이 단축이 된다. */
export const ISO_PLANES=Object.freeze({top:{label:'상면',major:0,axes:[30,150]},right:{label:'우면',major:60,axes:[30,90]},left:{label:'좌면',major:120,axes:[150,90]}});
/** 등각 원(타원)의 단축/장축 비 = tan30도 */
export const ISO_RATIO=Math.tan(Math.PI/6);

export const ISD_FIELDS=[
 {key:'plane',label:'등각면 (원·중심선·변경)',type:'select',def:'top',options:[['top','상면'],['right','우면'],['left','좌면']],group:'등각'},
 {key:'axis',label:'등각 축 (변경·문자)',type:'select',def:'30',options:[['30','오른쪽 30도'],['150','왼쪽 150도'],['90','수직 90도']],group:'등각'},
 {key:'length',label:'선 길이 (mm, 0 = 마우스)',type:'number',def:0,min:0,step:100,group:'선',hint:'0 이 아니면 찍는 방향의 등각축으로 이 길이만큼씩 반복해 그립니다(원문의 길이입력·스페이스키 반복).'},
 {key:'radius',label:'원 반지름 (mm)',type:'number',def:500,min:1,step:50,group:'원'},
 {key:'textValue',label:'문자',type:'text',def:'샘플도면',group:'문자·치수'},
 {key:'textHeight',label:'문자·치수 글자 높이 (mm)',type:'number',def:300,min:1,step:10,group:'문자·치수'},
];
export const ISD_SHARED_FIELDS=[
 {key:'textLayer',label:'문자 켜',type:'layer',def:UNFOLD_LAYERS.text,group:'켜 설정'},
 {key:'dimLayer',label:'치수 켜',type:'layer',def:UNFOLD_LAYERS.dims,group:'켜 설정'},
 {key:'centerLayer',label:'중심선 켜',type:'layer',def:UNFOLD_LAYERS.cntr,group:'켜 설정'},
];

/** 두 각도의 사이각(0…180) */
const angleGap=(a,b)=>Math.abs(((a-b+540)%360)-180);
/** 기준점에서 커서 쪽으로 가장 가까운 등각축을 골라 그 축 위의 점을 돌려준다. 길이를 주면 그 길이로 맞춘다. */
export function snapIso(base,p,fixedLength=0){
 const v=G.sub(p,base),l=G.len(v);
 if(l<G.EPS)return {x:base.x,y:base.y};
 const a=G.normalizeAngle(G.angle(v));
 let best=ISO_AXES[0],bd=Infinity;
 for(const ax of ISO_AXES){const d=angleGap(a,ax);if(d<bd){bd=d;best=ax;}}
 const u=G.polar(1,best),len=fixedLength>0?fixedLength:Math.max(1,G.dot(v,u));
 return G.add(base,G.mul(u,len));
}
/** 찍은 점들을 차례로 등각축에 붙인 꺾은선. 첫 점은 그대로 둔다. */
export function isoChain(points,fixedLength=0){
 if(!points?.length)return [];
 const out=[{x:points[0].x,y:points[0].y}];
 for(let i=1;i<points.length;i++)out.push(snapIso(out[i-1],points[i],fixedLength));
 return out;
}
export function isoLines(points,fixedLength=0,layerName=null){
 const pts=isoChain(points,fixedLength),out=[];
 for(let i=1;i<pts.length;i++){
  if(G.dist(pts[i-1],pts[i])<G.EPS)continue;
  out.push({type:'line',points:[pts[i-1],pts[i]],...(layerName?{cardLayer:layerName}:{})});
 }
 return out;
}
/** 등각 원 = 타원. 반지름이 장축 반길이가 되고 단축은 tan30 배다. */
export function isoEllipse(center,radius,plane='top',layerName=null){
 const def=ISO_PLANES[plane]||ISO_PLANES.top;
 if(!(radius>0))throw Error('원 반지름은 0보다 커야 합니다.');
 return {type:'ellipse',center:{x:center.x,y:center.y},majorAxis:G.polar(radius,def.major),ratio:ISO_RATIO,...(layerName?{cardLayer:layerName}:{})};
}
/** 등각 원(타원)·원의 중심선 두 줄. 장축·단축 방향으로 반지름의 overshoot 배만큼 긋는다. */
export function isoCenterCross(center,radius,plane='top',layerName=null,overshoot=1.2){
 const def=ISO_PLANES[plane]||ISO_PLANES.top;
 const maj=G.polar(radius*overshoot,def.major),min=G.polar(radius*ISO_RATIO*overshoot,def.major+90);
 const mk=v=>({type:'line',points:[G.sub(center,v),G.add(center,v)],linetype:'CENTER',...(layerName?{cardLayer:layerName}:{})});
 return [mk(maj),mk(min)];
}
/** 선 하나의 중심선. 양 끝으로 overshoot 만큼 더 나간다. */
export function lineCenterline(a,b,layerName=null,overshoot=null){
 const l=G.dist(a,b);
 if(l<G.EPS)throw Error('길이가 0 인 선입니다.');
 const u=G.unit(G.sub(b,a)),ext=G.mul(u,overshoot??Math.max(l*0.15,1));
 return {type:'line',points:[G.sub(a,ext),G.add(b,ext)],linetype:'CENTER',...(layerName?{cardLayer:layerName}:{})};
}
/** 등각 정렬치수. 두 점을 잇는 축 방향으로 눕고, 세 번째 점이 치수선 위치다. */
export function isoDimension(a,b,p,height,layerName=null){
 if(G.dist(a,b)<G.EPS)throw Error('치수의 두 점이 같습니다.');
 return {type:'dimension',mode:'aligned',points:[{x:a.x,y:a.y},{x:b.x,y:b.y},{x:p.x,y:p.y}],textHeight:height,...(layerName?{cardLayer:layerName}:{})};
}
/** 등각 문자. 바른 CAD 문자에는 기울임각(oblique)이 없어 회전만 준다(보고서 "아직 없는 것" 참고). */
export function isoText(position,text,height,axisAngle,layerName=null){
 if(!(height>0))throw Error('문자 높이는 0보다 커야 합니다.');
 return {type:'text',position:{x:position.x,y:position.y},text:String(text),height,rotation:readableAngle(Number(axisAngle)||0),align:'center',...(layerName?{cardLayer:layerName}:{})};
}
/** [변경] 이미 그린 객체를 다른 등각 각도로 바꾼다. 선은 첫 점을 잡고 돌리고, 타원은 장축 방향만, 문자는 회전각만 바꾼다. */
export function isoChange(entity,{axis=30,plane='top'}={}){
 if(!entity)throw Error('바꿀 객체를 고르세요.');
 const def=ISO_PLANES[plane]||ISO_PLANES.top;
 if(entity.type==='line'&&entity.points?.length>=2){
  const [a,b]=entity.points,l=G.dist(a,b);
  if(l<G.EPS)throw Error('길이가 0 인 선입니다.');
  return {...structuredClone(entity),points:[{x:a.x,y:a.y},G.add(a,G.polar(l,Number(axis)||0))]};
 }
 if(entity.type==='ellipse')return {...structuredClone(entity),majorAxis:G.polar(G.len(entity.majorAxis),def.major),ratio:ISO_RATIO};
 if(entity.type==='circle')return {...isoEllipse(entity.center,entity.radius,plane),...(entity.layer?{layer:entity.layer}:{}),...(entity.id?{id:entity.id}:{})};
 if(entity.type==='text')return {...structuredClone(entity),rotation:readableAngle(Number(axis)||0)};
 throw Error('등각 각도를 바꿀 수 있는 것은 선·원(타원)·문자입니다.');
}
export function isdPreviewSvg(v,shared,opts={}){
 const s=1200,o={x:0,y:0};
 const top=[G.polar(s,30),G.polar(s,150)];
 const box=[
  ...isoLines([o,G.polar(s,30),G.add(G.polar(s,30),G.polar(s,150)),G.polar(s,150),o],0,null),
  {type:'line',points:[o,G.polar(s,270)]},
  {type:'line',points:[G.polar(s,30),G.add(G.polar(s,30),G.polar(s,270))]},
  {type:'line',points:[G.polar(s,150),G.add(G.polar(s,150),G.polar(s,270))]},
  {type:'line',points:[G.add(G.polar(s,30),G.polar(s,270)),G.add(G.polar(s,270),{x:0,y:0})]},
 ].map(e=>({...e,previewColor:'#c9d1d9'}));
 const center=G.mul(G.add(top[0],top[1]),0.5);
 const circle=isoEllipse(center,Math.min(s*0.45,Number(v.radius)||500),v.plane,shared?.centerLayer);
 const cross=isoCenterCross(center,Math.min(s*0.45,Number(v.radius)||500),v.plane,shared?.centerLayer);
 const text=isoText(G.add(G.polar(s*0.5,270),G.polar(s*0.5,30)),v.textValue,Math.max(150,Number(v.textHeight)||300),Number(v.axis)||30,shared?.textLayer);
 return entitiesSvg([...box,{...circle,previewColor:UNFOLD_COLORS[UNFOLD_LAYERS.cntr]},...cross.map(e=>({...e,previewColor:UNFOLD_COLORS[UNFOLD_LAYERS.cntr]})),text],
  {label:opts.compact?'':`등각 30·150·90도 · ${(ISO_PLANES[v.plane]||ISO_PLANES.top).label} 원 · 문자 ${v.textHeight}`,...opts});
}

/* ══════════════════════════════════════════════════════════════════════
   PZ — 부분 확대 그리기 (izzarder.com/290, xiPartialZoom)
   원문 [방식선택]: 객체 선택 / 사각형(기본 선택) / 원형 / 다각형
   원문 [설정]: 켜(+cl 체크) / 색상 선 / 선종류 / 확대 배율(2) / [일반 블럭으로 생성]
   원문 순서: 실행 → 방식·설정 대화상자 → 확대할 영역의 도형 지정 → 확대도가 들어갈 위치 지정 → 확대도 작도
   ══════════════════════════════════════════════════════════════════════ */
export const PZ_STORAGE_KEY='barun-unfold-pz-card';
export const PZ_FIELDS=[
 {key:'shape',label:'방식선택',type:'select',def:'rect',options:[['object','객체 선택'],['rect','사각형'],['circle','원형'],['poly','다각형']],group:'방식선택'},
 {key:'factor',label:'확대 배율',type:'number',def:2,min:0.01,step:0.5,group:'설정'},
 {key:'plainBlock',label:'일반 블럭으로 생성',type:'check',def:false,group:'설정',hint:'끄면 확대도를 무명블럭 한 덩어리로, 켜면 낱개 객체로 넣어 바로 고칠 수 있게 합니다.'},
 {key:'useCurrentLayer',label:'현재 켜 사용 (cl)',type:'check',def:false,group:'설정',hint:'원문 [cl] 체크. 켜면 위 [테두리 켜] 칸이 꺼지고 테두리를 현재 켜에 그립니다.'},
 {key:'borderLayer',label:'테두리 켜',type:'layer',def:UNFOLD_LAYERS.symb,group:'설정',when:v=>!v.useCurrentLayer},
 {key:'borderColor',label:'색상 선',type:'text',def:'ByLayer',group:'설정',hint:'ByLayer 이면 켜 색을 따릅니다. #ff00ff 처럼 적으면 그 색으로 그립니다.'},
 {key:'borderLinetype',label:'선종류',type:'select',def:'CONTINUOUS',options:LINETYPE_OPTIONS,group:'설정'},
];

/** 방식선택에 따라 확대할 영역을 다각형으로 만든다. */
export function regionPolygon(shape,points){
 const ps=(points||[]).map(p=>({x:p.x,y:p.y}));
 if(shape==='rect'){
  if(ps.length<2)throw Error('사각형 영역은 두 점을 찍으세요.');
  const [a,b]=ps;
  if(Math.abs(a.x-b.x)<G.EPS||Math.abs(a.y-b.y)<G.EPS)throw Error('사각형 영역이 납작합니다. 두 점을 대각선으로 찍으세요.');
  return G.rectangle(a,b);
 }
 if(shape==='circle'){
  if(ps.length<2)throw Error('원형 영역은 중심과 반지름 점을 찍으세요.');
  const r=G.dist(ps[0],ps[1]);
  if(!(r>G.EPS))throw Error('원형 영역의 반지름이 0 입니다.');
  return Array.from({length:72},(_,i)=>G.add(ps[0],G.polar(r,i*5)));
 }
 if(ps.length<3)throw Error('다각형 영역은 점을 셋 이상 찍으세요.');
 return ps;
}
export function polygonCenter(polygon){
 const b=G.bounds([{type:'polyline',points:polygon,closed:true}]);
 if(!b)throw Error('영역을 만들지 못했습니다.');
 return {x:(b.minX+b.maxX)/2,y:(b.minY+b.maxY)/2};
}
/** 원문의 ssget "_C"(걸치기 선택)에 해당. 영역 안에 점이 있거나 영역 테두리와 만나는 객체를 모은다. */
export function entitiesInRegion(entities,polygon){
 const clip={type:'polyline',points:polygon,closed:true};
 return (entities||[]).filter(e=>{
  if(!e||e.hidden)return false;
  let vs=[];try{vs=G.vertices(e)||[];}catch{vs=[];}
  if(vs.some(p=>G.inside(p,polygon)))return true;
  try{if(G.intersections(e,clip).length)return true;}catch{}
  return false;
 });
}
/** base 를 기준으로 factor 배 키운 뒤 target 으로 옮긴 사본. 원본 켜·색은 그대로 둔다(원문은 켜 변경을 말하지 않는다). */
export function scaleCopies(list,base,factor,target){
 if(!(factor>0))throw Error('확대 배율은 0보다 커야 합니다.');
 return (list||[]).map(e=>{
  const moved=G.translate(G.resize(e,base,factor),target.x-base.x,target.y-base.y);
  delete moved.id;delete moved._renderBounds;
  return moved;
 });
}
const farthestToward=(polygon,center,dir)=>{
 let best=polygon[0],bv=-Infinity;
 for(const p of polygon){const v=G.dot(G.sub(p,center),dir);if(v>bv){bv=v;best=p;}}
 return {x:best.x,y:best.y};
};
/** 테두리 — 원본 영역 테두리, 확대도 테두리, 둘을 잇는 지시선(원문 /290 결과 그림과 같은 구성). */
export function zoomBorders(polygon,base,factor,target,style={}){
 const scaled=polygon.map(p=>({x:target.x+(p.x-base.x)*factor,y:target.y+(p.y-base.y)*factor}));
 const out=[{type:'polyline',closed:true,points:polygon.map(p=>({x:p.x,y:p.y})),...style},{type:'polyline',closed:true,points:scaled,...style}];
 const d=G.sub(target,base);
 if(G.len(d)>G.EPS){
  const u=G.unit(d);
  out.push({type:'line',points:[farthestToward(polygon,base,u),farthestToward(scaled,target,G.mul(u,-1))],...style});
 }
 return out;
}
/** 도면에 이미 있는 무명블럭 이름 뒤 번호를 보고 다음 이름을 만든다(*U1, *U2 …). */
export function anonymousBlockName(entities){
 let max=0;
 for(const e of entities||[]){
  if(e?.type!=='block')continue;
  const m=/^\*U(\d+)$/.exec(String(e.name||''));
  if(m)max=Math.max(max,Number(m[1]));
 }
 return '*U'+(max+1);
}
/** 확대도 한 벌. borderStyle 의 layer/cardLayer 는 부르는 쪽에서 정한다. */
export function buildPartialZoom(v,{polygon,source,target,entities=[],borderStyle={}}){
 const factor=Number(v.factor);
 if(!(factor>0))throw Error('확대 배율은 0보다 커야 합니다.');
 if(!source?.length)throw Error('확대할 객체가 없습니다. 영역 안에 객체가 있는지 확인하세요.');
 const base=polygonCenter(polygon),copies=scaleCopies(source,base,factor,target);
 const body=v.plainBlock?copies:[{type:'block',name:anonymousBlockName(entities),entities:copies,...(copies[0]?.layer?{layer:copies[0].layer}:{})}];
 return [...body,...zoomBorders(polygon,base,factor,target,borderStyle)];
}
export function pzPreviewSvg(v,shared,opts={}){
 const region=G.rectangle({x:-600,y:-400},{x:600,y:400});
 const source=[
  {type:'line',points:[{x:-500,y:-300},{x:500,y:-300}],previewColor:'#c9d1d9'},
  {type:'line',points:[{x:-500,y:300},{x:500,y:300}],previewColor:'#c9d1d9'},
  {type:'circle',center:{x:0,y:0},radius:220,previewColor:'#c9d1d9'},
 ];
 const factor=Math.max(0.1,Math.min(6,Number(v.factor)||2)),target={x:3200,y:0};
 const base=polygonCenter(region);
 const style={previewColor:UNFOLD_COLORS[UNFOLD_LAYERS.symb],linetype:v.borderLinetype};
 const es=[...source,...scaleCopies(source,base,factor,target),...zoomBorders(region,base,factor,target,style)];
 const label=`${(PZ_FIELDS[0].options.find(([k])=>k===v.shape)||['','사각형'])[1]} 영역 · ${factor} 배 · ${v.plainBlock?'낱개 객체':'무명블럭'}`;
 return entitiesSvg(es,{label:opts.compact?'':label,...opts});
}

/* ══════════════════════════════════════════════════════════════════════
   설치 — 통합 담당이 Object.assign(cardCommands, installUnfoldCards(cardContext)) 로 붙인다.
   ══════════════════════════════════════════════════════════════════════ */
export function installUnfoldCards(ctx){
 const preview=list=>list.map(e=>({...e,previewColor:e.previewColor||colorOf(e.cardLayer)}));
 /** 켜 이름도 켜 id 도 없는 객체는 현재 켜에 둔다(원문 설정에 켜 항목이 없는 것들 — ISD 의 선·원, PZ 확대 사본). */
 const onCurrentLayer=list=>list.map(e=>e.layer||e.cardLayer?e:{...e,layer:ctx.activeLayer()});
 const commitCard=(entities,message)=>{
  const ids=ctx.commit({removeIds:[],entities:resolveLayers(ctx,onCurrentLayer(entities),colorOf)});
  ctx.toast(message+' · Ctrl+Z 로 되돌리기');
  return ids;
 };

 /* ── DEV ── */
 async function drawUnfold(v,shared,method){
  for(;;){
   const picked=await ctx.pickPath({prompt:'전개도 · 전개도를 그릴 선을 선택 (바라보는 방향에서 왼쪽이 될 쪽을 찍으세요) · Esc 중단',minPoints:1,maxPoints:1});
   if(!picked)return null;
   const pick=picked.points[0];
   let target=null,bd=Math.max(ctx.tolerance()*3,1);
   for(const e of ctx.entities()){
    if(!CURVE_TYPES.includes(e.type)||e.hidden)continue;
    const d=G.entityDistance(e,pick,bd);
    if(d<bd){bd=d;target=e;}
   }
   if(!target)throw Error('전개할 선·폴리선·사각형·호·원을 찾지 못했습니다. 선 위의 점을 찍으세요.');
   const pts=curvePoints(target),L=curveLength(pts),flip=unfoldFlip(pts,pick);
   let raw=[];
   if(method==='cross'){
    const chosen=ctx.selected().filter(e=>e.id!==target.id);
    let crossers=chosen;
    if(!crossers.length){
     crossers=[];
     for(;;){
      const one=await ctx.pickEntity({prompt:`교차선 선택 · 개구부·창 같은 교차 객체를 하나씩 고르세요 (${crossers.length}개) · Esc 로 끝내기`});
      if(!one)break;
      if(one.id!==target.id&&!crossers.some(e=>e.id===one.id))crossers.push(one);
     }
    }
    for(const c of crossers){try{raw.push(...G.intersections(target,c));}catch{}}
    if(!raw.length)throw Error('교차점을 찾지 못했습니다. 전개할 선과 실제로 만나는 객체를 고르세요.');
   }else{
    const marks=await ctx.pickPath({prompt:'중간구분선 위치 지정 · 나눔점을 차례로 찍고 Enter · Esc 중단',minPoints:1});
    if(!marks)return null;
    raw=marks.points;
   }
   const marks=unfoldMarks(pts,raw,flip);
   const previewOf=(points,cursor)=>{
    const o=points[0]||cursor;
    if(!o)return [];
    try{return preview(buildUnfold(v,shared,{length:L,marks,origin:o}));}catch{return [];}
   };
   const spot=await ctx.pickPath({prompt:`전개도 놓을 위치 · 왼쪽 아래 모서리 · 길이 ${Math.round(L)} × 높이 ${v.height} · 구분선 ${marks.length}개 · Esc 중단`,preview:previewOf,minPoints:1,maxPoints:1});
   if(!spot)return null;
   const entities=buildUnfold(v,shared,{length:L,marks,origin:spot.points[0]});
   commitCard(entities,`전개도 ${Math.round(L)} × ${v.height} · 구분선 ${marks.length}개${flip<0?' · 좌우 뒤집음':''}`);
   if(!v.recycle)return null;
  }
 }

 /* ── ISD ── */
 async function drawIso(v,shared,method){
  const th=Math.max(1,Number(v.textHeight)||300);
  if(method==='line'){
   const fixed=Math.max(0,Number(v.length)||0);
   const previewOf=(points,cursor)=>{
    const pts=cursor?[...points,cursor]:points;
    if(pts.length<2)return [];
    try{return preview(isoLines(pts,fixed,UNFOLD_LAYERS.elev));}catch{return [];}
   };
   const path=await ctx.pickPath({prompt:`등각 선 · 점을 이어 찍으세요 (30·150·90도로 붙습니다${fixed>0?` · 길이 ${fixed} 고정`:''}) · Enter 완료 · Esc 중단`,preview:previewOf,minPoints:2});
   if(!path)return null;
   // 0 레이어(현재 레이어)에 떨어지지 않게 표준 입면 레이어로(2026-10-27 설명서 시험에서 확인, DEV 와 같은 레이어).
   const entities=isoLines(path.points,fixed,UNFOLD_LAYERS.elev);
   if(!entities.length)throw Error('그려진 등각 선이 없습니다.');
   return commitCard(entities,`등각 선 ${entities.length}개`);
  }
  if(method==='circle'){
   const plane=v.plane,def=ISO_PLANES[plane]||ISO_PLANES.top;
   const previewOf=(points,cursor)=>{
    const c=points[0];
    if(!c)return [];
    const r=cursor&&points.length>=1?Math.max(1,G.dist(c,cursor)):Number(v.radius)||500;
    try{return preview([isoEllipse(c,r,plane,UNFOLD_LAYERS.elev)]);}catch{return [];}
   };
   const path=await ctx.pickPath({prompt:`등각 원 · ① 중심 ② 반지름 점 · ${def.label} · Esc 중단`,preview:previewOf,minPoints:2,maxPoints:2});
   if(!path)return null;
   const r=Math.max(1,G.dist(path.points[0],path.points[1]));
   return commitCard([isoEllipse(path.points[0],r,plane,UNFOLD_LAYERS.elev)],`${def.label} 등각 원 반지름 ${Math.round(r)}`);
  }
  if(method==='dim'){
   const chosen=ctx.selected();
   let a=null,b=null;
   if(chosen.length===1&&chosen[0].type==='line'&&chosen[0].points?.length>=2){[a,b]=chosen[0].points;}
   else if(chosen.length===1&&chosen[0].type==='ellipse'){const c=chosen[0].center,m=chosen[0].majorAxis;a=G.sub(c,m);b=G.add(c,m);}
   else if(chosen.length===1&&chosen[0].type==='circle'){const c=chosen[0].center,r=chosen[0].radius;a=G.sub(c,{x:r,y:0});b=G.add(c,{x:r,y:0});}
   const need=a?1:3;
   const previewOf=(points,cursor)=>{
    const pts=cursor?[...points,cursor]:points;
    try{
     if(a)return pts.length>=1?preview([isoDimension(a,b,pts[0],th,shared.dimLayer)]):[];
     if(pts.length<3)return pts.length>=2?preview([{type:'line',points:[pts[0],snapIso(pts[0],pts[1])]}]):[];
     return preview([isoDimension(pts[0],snapIso(pts[0],pts[1]),pts[2],th,shared.dimLayer)]);
    }catch{return [];}
   };
   const path=await ctx.pickPath({prompt:a?'등각 치수 · 선택한 객체의 치수선 위치를 찍으세요 · Esc 중단':'등각 치수 · ① 첫 점 ② 둘째 점(등각축에 붙음) ③ 치수선 위치 · Esc 중단',preview:previewOf,minPoints:need,maxPoints:need});
   if(!path)return null;
   const dim=a?isoDimension(a,b,path.points[0],th,shared.dimLayer)
    :isoDimension(path.points[0],snapIso(path.points[0],path.points[1]),path.points[2],th,shared.dimLayer);
   return commitCard([dim],'등각 정렬치수 1개');
  }
  if(method==='text'){
   const previewOf=(points,cursor)=>{
    const p=points[0];
    if(!p)return [];
    const dir=cursor&&points.length>=1?G.angle(G.sub(snapIso(p,cursor),p)):Number(v.axis)||30;
    try{return preview([isoText(p,v.textValue,th,dir,shared.textLayer)]);}catch{return [];}
   };
   const path=await ctx.pickPath({prompt:`등각 문자 "${v.textValue}" · ① 문자 위치 ② 방향 점(등각축에 붙음) · Esc 중단`,preview:previewOf,minPoints:2,maxPoints:2});
   if(!path)return null;
   const dir=G.angle(G.sub(snapIso(path.points[0],path.points[1]),path.points[0]));
   return commitCard([isoText(path.points[0],v.textValue,th,dir,shared.textLayer)],`등각 문자 "${v.textValue}"`);
  }
  if(method==='center'){
   const e=await ctx.pickEntity({prompt:'중심선 · 등각으로 그려 둔 선·원·타원을 고르세요 · Esc 중단',types:['line','circle','ellipse']});
   if(!e)return null;
   let entities;
   if(e.type==='line')entities=[lineCenterline(e.points[0],e.points[1],shared.centerLayer)];
   else if(e.type==='circle')entities=isoCenterCross(e.center,e.radius,v.plane,shared.centerLayer);
   else entities=isoCenterCross(e.center,G.len(e.majorAxis),v.plane,shared.centerLayer);
   return commitCard(entities,`중심선 ${entities.length}개`);
  }
  if(method==='change'){
   const e=await ctx.pickEntity({prompt:'변경 · 각도를 바꿀 등각 선·원(타원)·문자를 고르세요 · Esc 중단',types:['line','circle','ellipse','text']});
   if(!e)return null;
   const changed=isoChange(e,{axis:Number(v.axis)||30,plane:v.plane});
   const {id,...rest}=changed;
   const ids=ctx.commit({removeIds:[e.id],entities:[{...rest,layer:e.layer}]});
   ctx.toast(`등각 각도를 ${e.type==='ellipse'||e.type==='circle'?(ISO_PLANES[v.plane]||ISO_PLANES.top).label:v.axis+'도'} 로 바꿨습니다 · Ctrl+Z 로 되돌리기`);
   return ids;
  }
  throw Error('알 수 없는 입력 종류입니다.');
 }

 /* ── PZ ── */
 async function drawZoom(v){
  const factor=Number(v.factor);
  let polygon=null,source=null;
  if(v.shape==='object'){
   source=ctx.selected();
   if(!source.length)throw Error('[객체 선택] 방식은 확대할 객체를 먼저 선택한 뒤 실행하세요.');
   const b=G.bounds(source);
   if(!b)throw Error('선택한 객체의 크기를 잴 수 없습니다.');
   polygon=G.rectangle({x:b.minX,y:b.minY},{x:b.maxX,y:b.maxY});
  }else{
   const need=v.shape==='poly'?0:2;
   const previewOf=(points,cursor)=>{
    const pts=cursor?[...points,cursor]:points;
    try{return [{type:'polyline',closed:true,points:regionPolygon(v.shape,pts),previewColor:UNFOLD_COLORS[UNFOLD_LAYERS.symb]}];}catch{return [];}
   };
   const prompt=v.shape==='rect'?'부분 확대 · 확대할 사각형 영역의 두 점 · Esc 중단'
    :v.shape==='circle'?'부분 확대 · 확대할 원형 영역의 ① 중심 ② 반지름 점 · Esc 중단'
    :'부분 확대 · 확대할 다각형 영역의 점을 찍고 Enter · Esc 중단';
   const path=await ctx.pickPath({prompt,preview:previewOf,minPoints:need||3,...(need?{maxPoints:need}:{})});
   if(!path)return null;
   polygon=regionPolygon(v.shape,path.points);
   source=entitiesInRegion(ctx.entities(),polygon);
  }
  if(!source.length)throw Error('영역 안에 확대할 객체가 없습니다.');
  const base=polygonCenter(polygon);
  const style={linetype:v.borderLinetype,...(/^#[0-9a-f]{6}$/i.test(String(v.borderColor).trim())?{color:String(v.borderColor).trim().toLowerCase()}:{}),
   ...(v.useCurrentLayer?{layer:ctx.activeLayer()}:{cardLayer:v.borderLayer})};
  const previewOf=(points,cursor)=>{
   const t=points[0]||cursor;
   if(!t)return [];
   try{return preview([...scaleCopies(source,base,factor,t),...zoomBorders(polygon,base,factor,t,{...style,layer:undefined,cardLayer:v.useCurrentLayer?UNFOLD_LAYERS.symb:v.borderLayer})]);}catch{return [];}
  };
  const spot=await ctx.pickPath({prompt:`확대도가 들어갈 위치 · ${factor} 배 · 객체 ${source.length}개 · Esc 중단`,preview:previewOf,minPoints:1,maxPoints:1});
  if(!spot)return null;
  const entities=buildPartialZoom(v,{polygon,source,target:spot.points[0],entities:ctx.entities(),borderStyle:style});
  return commitCard(entities,`부분 확대도 ${factor} 배 · 객체 ${source.length}개 · ${v.plainBlock?'낱개 객체':'무명블럭 '+entities[0].name}`);
 }

 return {
  DEV:()=>openCardDialog({ctx,title:'전개도 그리기 · DEV',storageKey:DEV_STORAGE_KEY,fields:DEV_FIELDS,sharedFields:DEV_SHARED_FIELDS,slots:3,fixedNames:['DEV 전개도'],
   preview:(v,s,o)=>devPreviewSvg(v,s,o),validate:v=>{if(!(Number(v.height)>0))throw Error('기준 높이는 0보다 커야 합니다.');},
   methods:{legend:'중간구분선 지정 방식',def:'points',options:[['points','나눔점 찍기','점을 하나씩 찍어 구분선 위치를 정합니다.'],['cross','교차선 선택','개구부·창처럼 전개할 선과 만나는 객체를 골라 교차점을 한꺼번에 씁니다.']]},
   onGo:(v,s,m)=>drawUnfold(v,s,m),
   note:'원문 순서: 전개도를 그릴 선을 선택 → 중간구분선 위치 지정 → 전개도 높이 → 놓을 위치. 선을 고를 때 찍은 쪽이 전개도의 왼쪽이 됩니다. 전개도 높이는 위 [기준 높이]를 씁니다.'}),

  ISD:()=>openCardDialog({ctx,title:'아이소메트릭 그리기 · ISD',storageKey:ISD_STORAGE_KEY,fields:ISD_FIELDS,sharedFields:ISD_SHARED_FIELDS,slots:3,fixedNames:['ISD 아이소메트릭'],
   preview:(v,s,o)=>isdPreviewSvg(v,s,o),validate:v=>{if(!(Number(v.textHeight)>0))throw Error('문자 높이는 0보다 커야 합니다.');if(!(Number(v.radius)>0))throw Error('원 반지름은 0보다 커야 합니다.');},
   methods:{legend:'입력 종류 (원문 옵션줄)',def:'line',options:[
    ['line','선 (L)','30·150·90도 등각축으로만 이어 그립니다.'],
    ['circle','원 (C)','고른 등각면의 타원으로 그립니다.'],
    ['dim','치수 (D)','두 점을 찍거나 선·원을 먼저 골라 등각 정렬치수를 넣습니다.'],
    ['text','문자 (T)','문자를 넣고 방향을 지정합니다.'],
    ['center','중심선 (CE)','이미 그린 선·원(타원)을 골라 중심선을 넣습니다.'],
    ['change','변경 (CH)','이미 그린 객체의 등각 각도를 바꿉니다.']]},
   onGo:(v,s,m)=>drawIso(v,s,m),
   note:'원문 옵션줄 "설정(S)/ 선(L)/ 원(C)/ 치수(D)/ 문자(T)/ 중심선(CE)/ 변경(CH)" 을 그대로 옮겼습니다. 선·원의 켜는 원문 설정에 없어 현재 켜에 그립니다. 바른 CAD 문자에는 기울임각이 없어 등각 문자는 회전만 적용됩니다.'}),

  PZ:()=>openCardDialog({ctx,title:'부분 확대 그리기 · PZ',storageKey:PZ_STORAGE_KEY,fields:PZ_FIELDS,slots:4,fixedNames:['PZ 부분 확대'],
   preview:(v,s,o)=>pzPreviewSvg(v,s,o),validate:v=>{if(!(Number(v.factor)>0))throw Error('확대 배율은 0보다 커야 합니다.');},
   onGo:v=>drawZoom(v),
   note:'원문 순서: 방식·설정 → 확대할 영역 지정 → 확대도가 들어갈 위치 지정. 테두리는 원본 영역·확대도 양쪽에 그리고 둘을 지시선으로 잇습니다(원문 결과 그림과 같음). [일반 블럭으로 생성]을 끄면 무명블럭(*U) 한 덩어리로 묶습니다.'}),
 };
}
