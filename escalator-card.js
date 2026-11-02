// 에스컬레이터 카드 EED(입면)·EPD(평면) 과 사면 표시 카드 SLP.
// izzarder.com/249(EED) · /250(EPD) · /162(SLP) 의 대화상자 항목·조작 순서를 그대로 옮겼다.
// 그림에서 잰 상수(수평부·트러스 깊이·난간 높이·깃 비율)는 보고서 3절에 근거를 적었다.
import * as G from './geometry.js';
import {entitiesSvg,openCardDialog,resolveLayers} from './card-kit.js';

export const ESC_LAYER='A-ELEV',SITE_LAYER='A-SITE';
export const EED_KEY='barun-escalator-elev-card',EPD_KEY='barun-escalator-plan-card',SLP_KEY='barun-slope-pattern-card';

/* ── 원문 그림에서 잰 에스컬레이터 치수(mm). LEAD 는 상·하부 수평부의 합으로,
      원문 EED [폭계산] 의 4500·30도 = 12350.0 을 그대로 재현하는 값이다. ── */
export const ESC=Object.freeze({
 LEAD:4555.77,      // 상·하부 수평부 합 (W.P. ~ 경사 시작 × 2)
 FLAT:4555.77/2,    // 한쪽 수평부
 TRUSS:1100,        // W.P. 아래 트러스 깊이
 RAIL:1000,         // W.P. 위 핸드레일 높이
 RAIL_RETURN:160,   // 핸드레일 되돌림선 높이
 RAIL_START:750,    // W.P. 에서 핸드레일 끝까지
 RAIL_STUB:600,     // 되돌림선 수평 길이
 STEP:400,          // 디딤판 수평 간격
 SKIRT:95,          // 스텝 가장자리 → 핸드레일 선
 TRUSS_SIDE:175,    // 스텝 가장자리 → 평면 외곽선
});
export const FEATHER_LINES=8,FEATHER_WIDTH=0.75; // 자연사면 깃 선 수 · 밑변 비율

const clamp01=v=>Math.max(0,Math.min(1,Number(v)||0));
const RAD=Math.PI/180;

/* ── 공통 계산 ── */
/** 에스컬레이터 평면 길이(W.P. ~ W.P.) = 층고 ÷ tan(경사각) + 상·하부 수평부 */
export function escalatorLength(height,angle){
 const a=Number(angle)*RAD,h=Math.max(0,Number(height)||0);
 if(!(a>0&&a<Math.PI/2))throw Error('경사각은 0도보다 크고 90도보다 작아야 합니다.');
 return h/Math.tan(a)+ESC.LEAD;
}
/** 층수·종류에 따른 각 대(臺)의 W.P. 쌍. p1 맨 아래층 W.P, p2 바로 위층 W.P. */
export function escalatorRuns(p1,p2,kind,floors){
 const dx=p2.x-p1.x,dy=p2.y-p1.y,N=Math.max(1,Math.round(Number(floors)||1)),out=[];
 if(kind==='cross'){
  for(let k=0;k<N;k++){const y=p1.y+k*dy;out.push([{x:p1.x,y},{x:p1.x+dx,y:y+dy}]);out.push([{x:p1.x+dx,y},{x:p1.x,y:y+dy}]);}
 }else if(kind==='return'){
  let a={x:p1.x,y:p1.y};
  for(let k=0;k<N;k++){const b={x:a.x+(k%2?-dx:dx),y:a.y+dy};out.push([a,b]);a=b;}
 }else{
  let a={x:p1.x,y:p1.y};
  for(let k=0;k<N;k++){const b={x:a.x+dx,y:a.y+dy};out.push([a,b]);a=b;}
 }
 return out;
}

/* ── EED 입면 한 대 ── */
/** a 아래 W.P, b 위 W.P. 트러스 바닥선 폴리선 하나 + 핸드레일 폴리선 하나. */
export function elevationRun(a,b,layer=ESC_LAYER){
 const dx=b.x-a.x,dy=b.y-a.y,s=dx<0?-1:1,span=Math.abs(dx);
 if(span<=ESC.LEAD)throw Error(`W.P. 두 점의 수평거리는 상·하부 수평부 합(${Math.round(ESC.LEAD)} mm)보다 커야 합니다.`);
 const P=(x,y)=>({x:a.x+s*x,y:a.y+y}),F=ESC.FLAT,T=ESC.TRUSS,R=ESC.RAIL,RR=ESC.RAIL_RETURN,RS=ESC.RAIL_START,SB=ESC.RAIL_STUB;
 const truss={type:'polyline',closed:false,cardLayer:layer,points:[P(0,0),P(0,-T),P(F,-T),P(span-F,dy-T),P(span,dy-T),P(span,dy)]};
 const r=(R-RR)/2,cy=(R+RR)/2,pts=[P(RS+SB,RR)];
 for(let k=0;k<=10;k++){const t=Math.PI*(1-k/10);pts.push(P(RS-r*Math.sin(t),cy+r*Math.cos(t)));}
 pts.push(P(F,R),P(span-F,dy+R));
 for(let k=0;k<=10;k++){const t=Math.PI*k/10;pts.push(P(span-RS+r*Math.sin(t),dy+cy+r*Math.cos(t)));}
 pts.push(P(span-RS-SB,dy+RR));
 return [truss,{type:'polyline',closed:false,cardLayer:layer,points:pts}];
}
export function buildEscalatorElevation(p1,p2,v,shared={}){
 const layer=shared.escLayer||ESC_LAYER,runs=escalatorRuns(p1,p2,v.kind,v.floors),entities=[];
 for(const [a,b] of runs)entities.push(...elevationRun(a,b,layer));
 return {entities,runs:runs.length};
}
export function eedPreviewSvg(v,shared,opts={}){
 const L=escalatorLength(v.calcHeight,v.calcAngle),p1={x:0,y:0},p2={x:L,y:Number(v.calcHeight)||4500};
 const r=buildEscalatorElevation(p1,p2,v,shared);
 return entitiesSvg(r.entities,{label:opts.compact?'':`입면 ${r.runs}대 · 층수 ${Math.round(v.floors)} · 폭(길이) = ${L.toFixed(1)} mm (층고 ${v.calcHeight} · ${v.calcAngle}도)`,...opts});
}

/* ── EPD 평면 한 대 ── */
export function buildEscalatorPlan(start,dirPoint,v,shared={}){
 const layer=shared.escLayer||ESC_LAYER,d=G.sub(dirPoint,start);
 if(G.len(d)<G.EPS)throw Error('둘째 점(방향)은 시작점과 달라야 합니다.');
 const u=G.unit(d),n=G.normal(u),L=escalatorLength(v.height,v.angle),W=Number(v.width)||1200,hw=W/2,F=ESC.FLAT;
 const P=(x,y)=>G.add(start,G.add(G.mul(u,x),G.mul(n,y))),out=[];
 const line=(x1,y1,x2,y2,extra)=>out.push({type:'line',points:[P(x1,y1),P(x2,y2)],cardLayer:layer,...extra});
 out.push({type:'polyline',closed:true,cardLayer:layer,points:[P(0,-(hw+ESC.TRUSS_SIDE)),P(L,-(hw+ESC.TRUSS_SIDE)),P(L,hw+ESC.TRUSS_SIDE),P(0,hw+ESC.TRUSS_SIDE)]});
 for(const s of [-1,1]){line(0,s*(hw+ESC.SKIRT),L,s*(hw+ESC.SKIRT));line(0,s*hw,L,s*hw);}
 line(0,0,L,0,{linetype:'CENTER'});
 line(F,-hw,F,hw);line(L-F,-hw,L-F,hw);
 let steps=0;
 for(let x=F+ESC.STEP;x<L-F-1e-6;x+=ESC.STEP){line(x,-hw,x,hw);steps++;}
 return {entities:out,length:L,steps};
}
export function epdPreviewSvg(v,shared,opts={}){
 const r=buildEscalatorPlan({x:0,y:0},{x:1,y:0},v,shared);
 return entitiesSvg(r.entities,{label:opts.compact?'':`평면 길이 ${r.length.toFixed(1)} mm · 층고 ${v.height} · ${v.angle}도 · 너비 ${v.width}mm · 디딤판 ${r.steps}`,...opts});
}

/* ── SLP 사면 표시 ── */
/** 선·폴리선·사각형 → 점 배열(닫힌 것은 첫 점을 끝에 붙인다) */
export function pathPoints(e){
 if(!e)throw Error('선을 고르세요.');
 if(e.type==='line'&&e.points?.length>=2)return [{x:e.points[0].x,y:e.points[0].y},{x:e.points[1].x,y:e.points[1].y}];
 if((e.type==='polyline'||e.type==='rectangle')&&e.points?.length>=2){
  const p=e.points.map(q=>({x:q.x,y:q.y}));
  if(e.closed||e.type==='rectangle')p.push({x:p[0].x,y:p[0].y});
  return p;
 }
 throw Error('선·폴리선·사각형만 고를 수 있습니다.');
}
export function pathLength(pts){let L=0;for(let i=0;i<pts.length-1;i++)L+=G.dist(pts[i],pts[i+1]);return L;}
/** 경로를 따라 거리 d 인 지점과 그 곳의 진행 방향 */
export function pointAlong(pts,d){
 let rest=Math.max(0,d);
 for(let i=0;i<pts.length-1;i++){
  const seg=G.dist(pts[i],pts[i+1]);if(seg<G.EPS)continue;
  if(rest<=seg||i===pts.length-2){const u=G.unit(G.sub(pts[i+1],pts[i]));return {point:G.add(pts[i],G.mul(u,Math.min(rest,seg))),dir:u};}
  rest-=seg;
 }
 return {point:{x:pts[0].x,y:pts[0].y},dir:G.unit(G.sub(pts.at(-1),pts[0]))};
}
/** 점 p 에 가장 가까운 지점의 경로상 거리 */
export function nearestAlong(pts,p){
 let acc=0,best={d:0,dist:Infinity};
 for(let i=0;i<pts.length-1;i++){
  const a=pts[i],b=pts[i+1],v=G.sub(b,a),seg=G.len(v);
  if(seg<G.EPS)continue;
  const t=Math.max(0,Math.min(1,G.dot(G.sub(p,a),v)/(seg*seg))),foot=G.add(a,G.mul(v,t)),dist=G.dist(p,foot);
  if(dist<best.dist)best={d:acc+t*seg,dist};
  acc+=seg;
 }
 return best.d;
}
/** origin 에서 dir 방향 반직선이 경로와 처음 만나는 곳 */
export function rayHit(pts,origin,dir){
 let best=null;
 for(let i=0;i<pts.length-1;i++){
  const a=pts[i],e=G.sub(pts[i+1],a),den=G.cross(dir,e);
  if(Math.abs(den)<1e-12)continue;
  const w=G.sub(a,origin),t=G.cross(w,e)/den,u=G.cross(w,dir)/den;
  if(t>1e-6&&u>=-1e-9&&u<=1+1e-9&&(!best||t<best.t))best={t,point:G.add(origin,G.mul(dir,t))};
 }
 return best;
}
/** 높은 쪽 선의 거리 d 지점에서 그 선에 직각으로 낮은 쪽 선까지 */
export function slopeStation(highPts,lowPts,d){
 const {point,dir}=pointAlong(highPts,d),n=G.normal(dir),m=G.mul(n,-1);
 const a=rayHit(lowPts,point,n),b=rayHit(lowPts,point,m);
 const pick=a&&b?(a.t<=b.t?[a,n]:[b,m]):a?[a,n]:b?[b,m]:null;
 if(!pick)return null;
 return {high:point,low:pick[0].point,dir:pick[1],length:pick[0].t,d};
}
/** 주표시 지점 목록(경로 전체를 주표시 간격으로) */
export function slopeStations(highPts,spacing){
 const L=pathLength(highPts),sp=Math.max(1,Number(spacing)||1),out=[];
 for(let d=0;d<L-1e-6;d+=sp)out.push(d);
 out.push(L);
 return out;
}
/** 계획사면: 긴 선(주표시) + 사이를 등분한 짧은 선(낮은 쪽 선에 붙는다) */
export function buildPlannedSlope(highPts,lowPts,v,layer=SITE_LAYER){
 const ds=slopeStations(highPts,v.mainSpacing),k=Math.max(1,Math.round(Number(v.subDivide)||1)),ratio=clamp01(v.planRatio),out=[];
 for(let i=0;i<ds.length;i++){
  const s=slopeStation(highPts,lowPts,ds[i]);
  if(s)out.push({type:'line',points:[s.high,s.low],cardLayer:layer});
  if(i+1>=ds.length)continue;
  for(let j=1;j<k;j++){
   const t=slopeStation(highPts,lowPts,ds[i]+(ds[i+1]-ds[i])*j/k);
   if(t)out.push({type:'line',points:[t.low,G.add(t.low,G.mul(t.dir,-t.length*ratio))],cardLayer:layer});
  }
 }
 return out;
}
/** 자연사면 한 자리: 직선부(줄기) + 경사표시(깃). oneLine 이면 폴리선 하나. */
export function naturalMark(st,v,layer=SITE_LAYER){
 const r=Math.max(0.02,Math.min(0.9,Number(v.natRatio)||0.3)),L=st.length,u=st.dir,n=G.normal(u);
 const apex=G.add(st.high,G.mul(u,L*(1-r))),fl=L*r;
 const rung=k=>{const t=k/FEATHER_LINES,c=G.add(apex,G.mul(u,fl*t)),hw=fl*FEATHER_WIDTH*t;return [G.add(c,G.mul(n,-hw)),G.add(c,G.mul(n,hw))];};
 if(v.oneLine){
  const pts=[st.high,apex];
  for(let k=1;k<=FEATHER_LINES;k++){const [A,B]=rung(k);if(k%2)pts.push(A,B);else pts.push(B,A);}
  return [{type:'polyline',closed:false,points:pts,cardLayer:layer}];
 }
 const out=[{type:'line',points:[st.high,apex],cardLayer:layer}];
 for(let k=1;k<=FEATHER_LINES;k++)out.push({type:'line',points:rung(k),cardLayer:layer});
 return out;
}
export function buildNaturalSlope(highPts,lowPts,v,layer=SITE_LAYER){
 const out=[];
 for(const d of slopeStations(highPts,v.mainSpacing)){const st=slopeStation(highPts,lowPts,d);if(st)out.push(...naturalMark(st,v,layer));}
 return out;
}
/** 하나씩 그리기 — 찍은 자리 한 곳분만 만든다 */
export function slopeMarkAt(highPts,lowPts,d,v,layer=SITE_LAYER){
 const st=slopeStation(highPts,lowPts,d);
 if(!st)return [];
 if(v.kind==='natural')return naturalMark(st,v,layer);
 const k=Math.max(1,Math.round(Number(v.subDivide)||1)),sp=Math.max(1,Number(v.mainSpacing)||1),ratio=clamp01(v.planRatio);
 const out=[{type:'line',points:[st.high,st.low],cardLayer:layer}];
 for(let j=1;j<k;j++){
  const t=slopeStation(highPts,lowPts,d+sp*j/k);
  if(t)out.push({type:'line',points:[t.low,G.add(t.low,G.mul(t.dir,-t.length*ratio))],cardLayer:layer});
 }
 return out;
}
export function buildSlopePattern(highPts,lowPts,v,layer=SITE_LAYER){
 return v.kind==='natural'?buildNaturalSlope(highPts,lowPts,v,layer):buildPlannedSlope(highPts,lowPts,v,layer);
}
export function slpPreviewSvg(v,shared,opts={}){
 const layer=shared?.slopeLayer||SITE_LAYER;
 const high=[{x:0,y:0},{x:12000,y:900},{x:24000,y:1500}],low=[{x:0,y:-5000},{x:12000,y:-4200},{x:24000,y:-3800}];
 const es=[{type:'polyline',closed:false,points:high,cardLayer:layer},{type:'polyline',closed:false,points:low,cardLayer:layer},...buildSlopePattern(high,low,v,layer)];
 return entitiesSvg(es,{label:opts.compact?'':`${v.kind==='natural'?'자연사면':'계획사면'} · ${v.runMode==='one'?'하나씩':'한꺼번에'} · 주표시 ${v.mainSpacing}`,...opts});
}

/* ── 카드 항목(원문 대화상자 그대로) ── */
export const EED_FIELDS=[
 {key:'kind',label:'종류',type:'select',def:'return',options:[['return','그림 1 · 되돌림형 (위층은 반대 방향)'],['inline','그림 2 · 연속형 (같은 방향으로 이어감)'],['cross','그림 3 · 교차형 (층마다 X 자)']],group:'설정'},
 {key:'floors',label:'층수',type:'number',def:3,min:1,max:20,step:1,group:'설정'},
 {key:'repeat',label:'입력 후 재 순환',type:'check',def:false,group:'설정'},
 {key:'calcHeight',label:'층고 (mm)',type:'number',def:4500,min:100,step:10,group:'폭 계산 ※ 아래는 폭을 알기 위한 계산임',hint:'그리기에는 쓰이지 않습니다. 길이는 미리보기 글에 나옵니다.'},
 {key:'calcAngle',label:'경사각',type:'select',def:'30',options:[['30','30도'],['35','35도']],group:'폭 계산 ※ 아래는 폭을 알기 위한 계산임'},
];
export const ESC_SHARED_FIELDS=[{key:'escLayer',label:'켜',type:'layer',def:ESC_LAYER,group:'켜 설정'}];

export const EPD_FIELDS=[
 {key:'height',label:'층고 (mm)',type:'number',def:4500,min:100,step:10,group:'설정'},
 {key:'angle',label:'경사각',type:'select',def:'30',options:[['30','30도'],['35','35도']],group:'설정'},
 {key:'width',label:'너비',type:'select',def:'1200',options:[['800','800mm'],['1200','1,200mm']],group:'설정'},
 {key:'result',label:'결과',type:'select',def:'group',options:[['none','그냥 두기'],['group','그룹으로 묶기'],['block','블럭으로 묶기']],group:'결과',hint:'바른 CAD 에는 그룹이 없어 [그룹으로 묶기]는 선택 상태로 대신합니다.'},
 {key:'repeat',label:'입력 후 재 순환',type:'check',def:false,group:'설정'},
];

export const SLP_FIELDS=[
 {key:'kind',label:'종류',type:'select',def:'planned',options:[['planned','계획사면'],['natural','자연사면']],group:'종류'},
 {key:'runMode',label:'명령어 기본 실행',type:'select',def:'all',options:[['all','한꺼번에'],['one','하나씩']],group:'종류'},
 {key:'mainSpacing',label:'주표시 간격 (mm)',type:'number',def:5000,min:10,step:100,group:'계획사면',hint:'자연사면의 표시 간격도 이 값을 씁니다(원문 자연사면 란에 간격 칸이 없습니다).'},
 {key:'subDivide',label:'보조 나누기',type:'number',def:5,min:1,max:50,step:1,group:'계획사면',when:v=>v.kind==='planned'},
 {key:'planRatio',label:'길이 비율',type:'number',def:0.4,min:0.05,max:1,step:0.05,group:'계획사면',when:v=>v.kind==='planned'},
 {key:'natRatio',label:'길이 비율',type:'number',def:0.3,min:0.05,max:0.9,step:0.05,group:'자연사면',when:v=>v.kind==='natural'},
 {key:'oneLine',label:'한 선으로 그리기',type:'check',def:true,group:'자연사면',when:v=>v.kind==='natural'},
];
export const SLP_SHARED_FIELDS=[{key:'slopeLayer',label:'켜',type:'layer',def:SITE_LAYER,group:'켜 설정'}];

/* ── 화면 흐름 ── */
export function installEscalatorCards(ctx){
 const tint=es=>es.map(e=>({...e,previewColor:'#6ec6ff'}));

 async function drawElevation(v,shared){
  do{
   const preview=(points,cursor)=>{
    const pts=cursor?[...points,cursor]:points;
    if(pts.length<2)return [];
    try{return tint(buildEscalatorElevation(pts[0],pts[1],v,shared).entities);}catch{return [];}
   };
   const pts=(await ctx.pickPath({prompt:`에스컬레이터 입면 · 층수 ${Math.round(v.floors)} · ① 맨 아래층 W.P ② 바로 위층 W.P · Esc 중단`,preview,minPoints:2,maxPoints:2}))?.points;
   if(!pts)return null;
   const r=buildEscalatorElevation(pts[0],pts[1],v,shared);
   ctx.commit({removeIds:[],entities:resolveLayers(ctx,r.entities)});
   ctx.toast(`에스컬레이터 입면 ${r.runs}대 · 층수 ${Math.round(v.floors)} · Ctrl+Z 로 되돌리기`);
  }while(v.repeat);
  return true;
 }

 async function drawPlan(v,shared){
  do{
   const preview=(points,cursor)=>{
    const pts=cursor?[...points,cursor]:points;
    if(pts.length<2)return [];
    try{return tint(buildEscalatorPlan(pts[0],pts[1],v,shared).entities);}catch{return [];}
   };
   const pts=(await ctx.pickPath({prompt:'에스컬레이터 평면 · ① 시작점 ② 방향(길이는 층고·경사각으로 정해집니다) · Esc 중단',preview,minPoints:2,maxPoints:2}))?.points;
   if(!pts)return null;
   const r=buildEscalatorPlan(pts[0],pts[1],v,shared);
   const ids=ctx.commit({removeIds:[],entities:resolveLayers(ctx,r.entities)});
   let extra='';
   if(v.result==='group'){ctx.setSelected(ids);extra=' · 바른 CAD 에는 그룹이 없어 선택 상태로 묶어 두었습니다';}
   else if(v.result==='block'){
    try{
     const name=`에스컬레이터_${Date.now().toString(36).toUpperCase()}`;
     ctx.execute({type:'block.create',ids,name,base:pts[0]});
     extra=` · 블록 "${name}" 으로 묶었습니다(되돌리기는 두 번)`;
    }catch(e){console.error('[card]',e);extra=' · 블록으로 묶지 못했습니다(그린 것은 그대로 있습니다)';}
   }
   ctx.toast(`에스컬레이터 평면 길이 ${r.length.toFixed(1)} mm · 디딤판 ${r.steps}개${extra} · Ctrl+Z 로 되돌리기`);
  }while(v.repeat);
  return true;
 }

 async function drawSlope(v,shared){
  const layer=shared.slopeLayer||SITE_LAYER;
  const hi=await ctx.pickEntity({prompt:'>> 높은 쪽 선 선택 · Esc 중단',types:['line','polyline','rectangle']});
  if(!hi)return null;
  const lo=await ctx.pickEntity({prompt:'>> 낮은 쪽 선 선택 · Esc 중단',types:['line','polyline','rectangle']});
  if(!lo)return null;
  if(hi.id===lo.id)throw Error('높은 쪽 선과 낮은 쪽 선은 서로 다른 선이어야 합니다.');
  const H=pathPoints(hi),L=pathPoints(lo);
  if(v.runMode==='one'){
   let n=0;
   for(;;){
    const p=await ctx.pickPoint(`사면 표시를 넣을 자리를 찍으세요 (${n}개 그림) · Esc 로 끝냅니다`);
    if(!p)break;
    const es=slopeMarkAt(H,L,nearestAlong(H,p),v,layer);
    if(!es.length){ctx.toast('그 자리에서는 낮은 쪽 선을 만나지 못했습니다.',true);continue;}
    ctx.commit({removeIds:[],entities:resolveLayers(ctx,es)});n++;
   }
   ctx.toast(n?`${v.kind==='natural'?'자연':'계획'}사면 ${n}자리를 그렸습니다. 되돌리기는 자리마다 한 번씩입니다.`:'그린 것이 없습니다.');
   return n;
  }
  const es=buildSlopePattern(H,L,v,layer);
  if(!es.length)throw Error('두 선이 마주 보지 않아 사면 표시를 만들지 못했습니다. 높은 쪽 → 낮은 쪽 순서로 다시 고르세요.');
  ctx.commit({removeIds:[],entities:resolveLayers(ctx,es)});
  ctx.toast(`${v.kind==='natural'?'자연':'계획'}사면 표시 ${es.length}개 · 무명그룹 기능이 없어 묶지 않았습니다 · Ctrl+Z 로 되돌리기`);
  return es.length;
 }

 return {
  EED:()=>openCardDialog({ctx,title:'에스컬레이터 입면그리기 · EED',storageKey:EED_KEY,fields:EED_FIELDS,sharedFields:ESC_SHARED_FIELDS,slots:4,fixedNames:['EED 기본'],
   preview:(v,s,o)=>eedPreviewSvg(v,s,o),onGo:(v,s)=>drawElevation(v,s),
   validate:v=>{if(!(v.floors>=1))throw Error('층수는 1 이상이어야 합니다.');},
   note:'두 점: ① 맨 아래층 W.P(슬라브와 에스컬레이터가 만나는 지점) → ② 바로 위층 W.P. [폭 계산] 란은 그리기에 쓰이지 않고 길이만 미리 알려 줍니다.'}),
  EPD:()=>openCardDialog({ctx,title:'에스컬레이터 평면그리기 · EPD',storageKey:EPD_KEY,fields:EPD_FIELDS,sharedFields:ESC_SHARED_FIELDS,slots:4,fixedNames:['EPD 기본'],
   preview:(v,s,o)=>epdPreviewSvg(v,s,o),onGo:(v,s)=>drawPlan(v,s),
   note:'두 점: ① 시작점 → ② 방향(둘째 점은 방향일 뿐 의미 있는 점이 아닙니다). 길이는 층고 ÷ tan(경사각) + 상·하부 수평부로 정해집니다.'}),
  SLP:()=>openCardDialog({ctx,title:'사면 표시 · SLP',storageKey:SLP_KEY,fields:SLP_FIELDS,sharedFields:SLP_SHARED_FIELDS,slots:4,fixedNames:['SLP 기본'],
   preview:(v,s,o)=>slpPreviewSvg(v,s,o),onGo:(v,s)=>drawSlope(v,s),
   validate:v=>{if(!(v.mainSpacing>0))throw Error('주표시 간격은 0보다 커야 합니다.');},
   note:'선 두 개를 [높은 쪽 → 낮은 쪽] 순서로 고릅니다. 긴 선은 먼저 고른 선에 직각으로 그어집니다. [하나씩]이면 자리를 찍을 때마다 하나씩 그립니다.'}),
 };
}
