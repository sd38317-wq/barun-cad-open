// 단열재 그리기 카드 INS (xiInsul). izzarder.com/228 의 [설정] 대화상자를 그대로 옮겼다.
// [두께별 형태](0~60 / ~150 / 그 초과 3단계), [두께와 방향](따로지정·동시지정),
// [선길이에 딱 맞추어 절단], [절단 후 말단 쪼가리 제거] · 조작은 두 점+방향점, 또는 [객체선택].
import * as G from './geometry.js';
import {entitiesSvg,openCardDialog,resolveLayers} from './card-kit.js';
import {insulationSourcePath} from './architecture.js';

export const INSULATION_LAYER='A-WALL-INSL';
export const INSULATION_LAYER_COLOR='#ff00ff';
export const INSULATION_STORAGE_KEY='barun-insulation-card';

/* ── 두께별 형태 ──
   원문 그림(180·80·40 mm 표본)의 마디 간격과 고리 크기를 재어 옮긴 값이다.
   PITCH = 한 마디 길이 ÷ 두께 — 잰 값 40mm→0.767 · 80mm→0.591 · 180mm→0.389.
   RADIUS = 고리 반지름 ÷ 두께 — 잰 값 40mm→0.263 · 80mm→0.218 · 180mm→0.182. */
export const STAGE_PITCH=Object.freeze({loose:0.8,mid:0.6,dense:0.4});
export const STAGE_RADIUS=Object.freeze({loose:0.262,mid:0.219,dense:0.182});
export const STAGE_LABEL=Object.freeze({loose:'가장 느슨한 형태',mid:'중간 형태',dense:'가장 촘촘한 형태'});
export const SAMPLES_PER_CYCLE=48;

export const INSULATION_FIELDS=[
 {key:'insulationType',label:'단열재 종류',type:'text',def:null,group:'열성능'},
 {key:'lambda',label:'λ (W/m·K)',type:'number',def:null,min:0,step:0.001,group:'열성능'},
 /* 2026-09-21 사용자 지적 "두께만 정하면 되잖아, 그린 뒤 크기 묻지 말고": 두께는 여기서 한 번만 정하고 형태 단계는 두께로 자동. 구간·입력방식은 숨긴 기본값. */
 {key:'thickness',label:'두께 (mm)',type:'number',def:100,min:1,step:5,group:'두께'},
 {key:'looseMax',label:'0 ~ (mm)',type:'number',def:60,min:1,step:5,group:'두께별 형태',hidden:true},
 {key:'midMax',label:'~ (mm)',type:'number',def:150,min:2,step:5,group:'두께별 형태',hidden:true},
 /* 도면 생성기용(사장님 2026-10-25): 작은 축척에서 마디가 뭉치지 않게 마디 길이 하한(도면 mm). 0 이면 두께로만 정함 — 사람이 쓰는 카드는 그대로. */
 {key:'minPitch',label:'마디 최소 길이 (mm)',type:'number',def:0,min:0,step:1,group:'두께별 형태',hidden:true},
 {key:'thicknessInput',label:'두께와 방향',type:'select',def:'separate',group:'두께와 방향',hidden:true,
  options:[['separate','두께와 방향 따로 지정'],['together','두께와 방향 동시 지정']]},
 {key:'fitCut',label:'선길이에 딱 맞추어 절단',type:'check',def:true,group:'절단'},
 {key:'dropStub',label:'절단 후 말단 쪼가리 제거',type:'check',def:false,group:'절단',when:v=>v.fitCut},
];

/* ── 기하(순수 계산) ── */

/** 두께로 형태 단계를 고른다. 원문 기본값 0~60 느슨 / 60초과~150 중간 / 150초과 촘촘. */
export function insulationStage(thickness,v={}){
 const t=Number(thickness);
 if(!Number.isFinite(t)||t<=0)throw Error('단열재 두께는 양수입니다.');
 const a=Number(v.looseMax??60),b=Number(v.midMax??150);
 if(!Number.isFinite(a)||!Number.isFinite(b)||a<=0||b<=a)throw Error('두께별 형태 구간은 0 < 앞 값 < 뒤 값 이어야 합니다.');
 const key=t<=a?'loose':t<=b?'mid':'dense';
 return {key,label:STAGE_LABEL[key],pitch:Math.max(t*STAGE_PITCH[key],Number(v.minPitch)||0),radius:STAGE_RADIUS[key]};
}

const TAU=Math.PI*2;
const normRad=a=>{const r=a%TAU;return r<0?r+TAU:r;};

/** 고리 반지름. 잰 값을 쓰되, 위·아래 고리가 서로 닿아 이을 수 없을 만큼 크면 줄인다. */
export function coilRadius(thickness,pitch,radiusRatio){
 let r=thickness*radiusRatio;
 for(let i=0;i<80&&Math.hypot(pitch/2,thickness-2*r)<2.02*r;i++)r*=0.95;
 return r;
}

/** 아래 고리(A)에서 위 고리(B)로 건너가는 교차 접선. 나가는 각·들어오는 각을 돌려준다. */
function crossTangent(a,b,r,dirA){
 const vx=b.s-a.s,vy=b.d-a.d,d=Math.hypot(vx,vy);
 if(d<2*r)throw Error('단열재 고리가 서로 겹칩니다. 두께나 형태 구간을 확인하세요.');
 const base=Math.atan2(vy,vx),g=Math.acos(Math.min(1,2*r/d));
 for(const sgn of [1,-1]){
  const m=base+sgn*g,mx=Math.cos(m),my=Math.sin(m);
  if(dirA*(-my*(vx-2*r*mx)+mx*(vy-2*r*my))>0)return {out:m,in:m+Math.PI};
 }
 throw Error('단열재 고리를 이을 수 없습니다.');
}
const pushArc=(out,c,r,a0,a1,dir,step)=>{
 const sweep=dir>0?normRad(a1-a0):normRad(a0-a1),k=Math.max(1,Math.ceil(sweep/step));
 for(let i=0;i<=k;i++){
  const a=a0+dir*sweep*i/k,p={s:c.s+r*Math.cos(a),d:c.d+r*Math.sin(a)};
  if(!out.length||Math.hypot(p.s-out.at(-1).s,p.d-out.at(-1).d)>1e-9)out.push(p);
 }
};

/** 단열재 고리선 (s,d). 아래(반시계)·위(시계) 고리가 pitch/2 간격으로 번갈아 놓이고
 *  이웃한 고리는 교차 접선으로 이어진다. 원문 그림의 물방울 고리 + X 교차 모양이다.
 *  s=0 은 첫 고리의 왼쪽 끝, 끝은 마지막 아래 고리의 오른쪽 끝(= 2r + cycles·pitch). */
export function coilPoints(thickness,pitch,radiusRatio,cycles,{samples=SAMPLES_PER_CYCLE}={}){
 if(!(thickness>0&&pitch>0))throw Error('단열재 두께와 마디 길이는 양수입니다.');
 if(!(radiusRatio>0&&radiusRatio<0.5))throw Error('고리 반지름 비율은 0 과 0.5 사이입니다.');
 const n=Math.round(cycles);
 if(!(n>=1))throw Error('단열재 마디 수는 1 이상입니다.');
 const r=coilRadius(thickness,pitch,radiusRatio),half=pitch/2,step=TAU/Math.max(8,samples);
 const circle=i=>({s:r+i*half,d:i%2===0?r:thickness-r}),dir=i=>i%2===0?1:-1;
 const out=[];
 let a0=Math.PI;
 for(let i=0;i<2*n;i++){
  const t=crossTangent(circle(i),circle(i+1),r,dir(i));
  pushArc(out,circle(i),r,a0,t.out,dir(i),step);
  a0=t.in;
 }
 pushArc(out,circle(2*n),r,a0,0,dir(2*n),step);
 return out;
}
/** cycles 마디를 그렸을 때 차지하는 길이. */
export const coilSpan=(thickness,pitch,radiusRatio,cycles)=>2*coilRadius(thickness,pitch,radiusRatio)+cycles*pitch;

/** 원문 [선길이에 딱 맞추어 절단]. 선 길이를 처음 넘는 곳에서 선을 끊는다(끝에 쪼가리가 남을 수 있다). */
export function clipAtLength(points,length){
 const out=[];
 for(let i=0;i<points.length;i++){
  const p=points[i];
  if(p.s<=length+1e-9){out.push(p);continue;}
  const a=points[i-1];
  if(a&&p.s>a.s){const k=(length-a.s)/(p.s-a.s);out.push({s:length,d:a.d+(p.d-a.d)*k});}
  break;
 }
 if(out.length<2)throw Error('단열재 길이가 한 마디보다 짧습니다. 더 길게 지정하세요.');
 return out;
}

/** 길이·두께·설정으로 (s,d) 단열재 선을 만든다. 절단 옵션이 마디 수를 정한다. */
export function insulationProfile(length,thickness,v={}){
 if(!(Number.isFinite(length)&&length>0))throw Error('단열재 길이를 확인하세요.');
 const stage=insulationStage(thickness,v);
 const r=coilRadius(thickness,stage.pitch,stage.radius),units=(length-2*r)/stage.pitch;
 if(length/stage.pitch>4000)throw Error('단열재가 너무 깁니다. 구간을 나눠 그리세요.');
 let cycles,clip=null;
 if(!v.fitCut)cycles=Math.max(1,Math.round(units));
 else if(v.dropStub)cycles=Math.max(1,Math.floor(units+1e-9));
 else {cycles=Math.max(1,Math.ceil(units-1e-9));clip=length;}
 let points=coilPoints(thickness,stage.pitch,stage.radius,cycles);
 if(clip!==null&&points.at(-1).s>length)points=clipAtLength(points,clip);
 return {stage,cycles,radius:r,points,drawnLength:points.at(-1).s};
}

/** 경로를 누적 길이 자로 바꾼다. 두 점(직선)도 호·원을 푼 점들도 같은 자를 쓴다. */
export function pathRuler(source,closed=false){
 const pts=[];
 for(const p of source||[]){
  if(!Number.isFinite(p?.x)||!Number.isFinite(p?.y))throw Error('경로 좌표를 확인하세요.');
  if(!pts.length||G.dist(pts.at(-1),p)>1e-7)pts.push({x:p.x,y:p.y});
 }
 if(closed&&pts.length>2&&G.dist(pts[0],pts.at(-1))<1e-7)pts.pop();
 if(pts.length<2)throw Error('단열재 경로에 두 점 이상 필요합니다.');
 const points=closed?[...pts,{...pts[0]}]:pts,acc=[0];
 for(let i=1;i<points.length;i++)acc.push(acc[i-1]+G.dist(points[i-1],points[i]));
 if(acc.at(-1)<=0)throw Error('단열재 경로 길이가 0 입니다.');
 return {points,acc,length:acc.at(-1),closed:!!closed};
}

/** 자 위 거리 s 에서 왼쪽 법선으로 d 만큼 띄운 점. */
export function pointAlong(ruler,s,d){
 const {points,acc}=ruler;
 let i=1;
 while(i<acc.length-1&&acc[i]<s)i++;
 const a=points[i-1],b=points[i],seg=acc[i]-acc[i-1]||1,k=(s-acc[i-1])/seg;
 const u=G.unit(G.sub(b,a)),n=G.normal(u);
 return G.add(G.add(a,G.mul(G.sub(b,a),k)),G.mul(n,d));
}

/** 방향점이 경로의 어느 쪽인지. 왼쪽이면 +1, 오른쪽이면 −1. */
export function sideSign(ruler,point){
 const {points}=ruler;
 let best=null,bd=Infinity;
 for(let i=1;i<points.length;i++){const d=G.distanceToSegment(point,points[i-1],points[i]);if(d<bd){bd=d;best=[points[i-1],points[i]];}}
 const c=G.cross(G.sub(best[1],best[0]),G.sub(point,best[0]));
 if(Math.abs(c)<1e-9)throw Error('방향점은 선 위가 아닌 한쪽에 찍으세요.');
 return c>0?1:-1;
}

/** 도면에 넣을 단열재 객체. 켜 이름만 적고 실제 켜 id 는 커밋할 때 넣는다. */
export function insulationEntities({ruler,thickness,values={},sign=1,layer=INSULATION_LAYER}){
 const prof=insulationProfile(ruler.length,thickness,values);
 const points=prof.points.map(p=>pointAlong(ruler,p.s,sign*p.d));
 const lambda=values.lambda==null||values.lambda===''?null:(Number.isFinite(Number(values.lambda))&&Number(values.lambda)>0?Number(values.lambda):null);
 return {...prof,entities:[{type:'polyline',closed:false,points,cardLayer:layer,insulationType:values.insulationType??null,lambda}]};
}

/** 두 점 + 방향점 한 벌을 그대로 단열재로. 동시지정이면 둘째 점~방향점 거리가 두께다. */
export function insulationFromPoints(p1,p2,p3,values={},thickness=null){
 const ruler=pathRuler([p1,p2],false);
 const sign=sideSign(ruler,p3);
 const t=values.thicknessInput==='together'?G.dist(p2,p3):Number(thickness);
 if(!(Number.isFinite(t)&&t>0))throw Error('단열재 두께는 양수입니다.');
 return insulationEntities({ruler,thickness:t,values,sign});
}

/* ── 미리보기 ── */
/** 원문 대화상자의 세 표본 그림처럼 느슨·중간·촘촘을 같은 높이로 나란히 보여 준다. */
export function insulationPreviewSvg(v,_shared,opts={}){
 const a=Number(v.looseMax)||60,b=Number(v.midMax)||150,H=Math.max(1,Number(v.thickness)||100),GAP=60,LEN=H*4.2;
 let stageKey='mid';try{stageKey=insulationStage(H,v).key||'mid';}catch{}
 const rows=[[stageKey,null]];
 const es=[];
 rows.forEach(([key],i)=>{
  const y=-(i*(H+GAP)),pitch=H*STAGE_PITCH[key];
  const ruler=pathRuler([{x:0,y},{x:LEN,y}],false);
  const n=Math.max(1,Math.round((LEN-2*coilRadius(H,pitch,STAGE_RADIUS[key]))/pitch));
  const points=coilPoints(H,pitch,STAGE_RADIUS[key],n,{samples:32});
  es.push({type:'line',points:[{x:0,y},{x:LEN,y}],previewColor:'#4a5563'});
  es.push({type:'polyline',closed:false,points:points.map(p=>pointAlong(ruler,p.s,p.d)),previewColor:'#ffd479'});
 });
 const label=opts.compact?'':`단열재 ${H} mm · ${STAGE_LABEL[stageKey]||''}${v.fitCut?(v.dropStub?' · 절단+쪼가리 제거':' · 선길이에 맞추어 절단'):' · 단위 살림'}`;
 return entitiesSvg(es,{label,...opts});
}

/* ── 화면 흐름 ── */
export function installInsulationCard(ctx){
 let lastThickness=100;

 const commitRun=(ruler,thickness,v,sign)=>{
  const out=insulationEntities({ruler,thickness,values:v,sign});
  const entities=resolveLayers(ctx,out.entities,()=>INSULATION_LAYER_COLOR);
  const ids=ctx.commit({entities});
  const cut=v.fitCut?(v.dropStub?'선길이 절단 · 쪼가리 제거':'선길이 절단'):'마디 단위 살림';
  ctx.toast(`단열재 ${Math.round(thickness)} mm · ${out.stage.label} · ${out.cycles}마디 · ${cut} · ${INSULATION_LAYER} · Ctrl+Z 로 되돌리기`);
  return ids;
 };


 async function drawByPoints(v,settings){
  const previewOf=(points,cursor)=>{
   const pts=cursor?[...points,cursor]:points;
   if(pts.length<2)return [];
   try{
    if(pts.length<3)return [{type:'line',points:[pts[0],pts[1]],previewColor:'#ff9f68'}];
    const t=v.thicknessInput==='together'?G.dist(pts[1],pts[2]):lastThickness;
    return insulationFromPoints(pts[0],pts[1],pts[2],v,t).entities.map(e=>({...e,previewColor:'#ff9f68'}));
   }catch{return [];}
  };
  const path=await ctx.pickPath({prompt:`단열재 ${Math.round(lastThickness)} mm · ① 시작점 ② 끝점(길이) ③ 방향점 · Esc 중단`,preview:previewOf,minPoints:3,maxPoints:3});
  if(!path)return null;
  const [p1,p2,p3]=path.points,ruler=pathRuler([p1,p2],false),sign=sideSign(ruler,p3);
  if(v.thicknessInput==='together')return commitRun(ruler,G.dist(p2,p3),v,sign);
  return commitRun(ruler,lastThickness,v,sign);
 }

 async function drawByObject(v,settings){
  const picked=await ctx.pickEntity({prompt:'단열재 · 단열재를 표현할 선·폴리선·사각형·호·원을 클릭 · Esc 중단',types:['line','polyline','rectangle','arc','circle']});
  if(!picked)return null;
  const side=await ctx.pickPoint('단열재를 채울 쪽을 클릭하세요 · Esc 취소');
  if(!side)return null;
  const n=lastThickness,src=insulationSourcePath(picked,n),ruler=pathRuler(src.points,src.closed);
  return commitRun(ruler,n,v,sideSign(ruler,side));
 }

 const open=()=>openCardDialog({
  ctx,title:'단열재 그리기 · INS',storageKey:INSULATION_STORAGE_KEY,fields:INSULATION_FIELDS,slots:1,fixedNames:['INS 단열재'],
  preview:(v,shared,o)=>insulationPreviewSvg(v,shared,o),
  methods:{legend:'단열재 그리는 방식',def:'points',options:[
   ['points','두 점과 방향','① 시작점 ② 끝점(길이) ③ 방향점 순으로 찍습니다.'],
   ['object','객체선택','호 같은 곡선 벽체를 클릭해 그 선을 따라 그립니다.'],
  ]},
  validate:v=>{if(!(Number(v.thickness)>0))throw Error('단열재 두께는 양수입니다.');if(!(v.looseMax>0&&v.midMax>v.looseMax))throw Error('두께별 형태 구간은 0 < 앞 값 < 뒤 값 이어야 합니다.');},
  onGo:(v,_shared,method)=>{lastThickness=Number(v.thickness)||lastThickness;return method==='object'?drawByObject(v,open):drawByPoints(v,open);},
  note:`${INSULATION_LAYER} 켜에 그립니다. 객체선택은 선을 클릭한 뒤 채울 쪽을 클릭합니다.`,
 });

 return {INS:()=>open()};
}
