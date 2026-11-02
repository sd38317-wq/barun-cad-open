// 계단 카드 STP(평면) · STC(입·단면). izzarder.com/241·240 의 설정 항목을 옮겼다.
// STP: 세 점(1 첫 단 시작 모서리, 2 오르는 방향의 임의점, 3 계단 폭 쪽 점). STC: 두 점(1 아래 시작, 2 위 끝).
import * as G from './geometry.js';
import {STD_LAYERS,builder,wallFrame,entitiesSvg,openCardDialog,resolveLayers} from './card-kit.js';

export const STAIR_PLAN_KEY='barun-stair-plan-card',STAIR_SECTION_KEY='barun-stair-section-card';

export const STP_FIELDS=[
 {key:'kind',label:'형식',type:'select',def:'turn',options:[['turn','돌음계단 (ㄷ자)'],['straight','일자계단']],group:'형식'},
 {key:'direction',label:'방향',type:'select',def:'up',options:[['up','Up'],['down','Down'],['updown','Up & Down (절단선)']],group:'형식'},
 {key:'startOffset',label:'시작점 이격 (mm)',type:'number',def:0,min:0,step:10,group:'치수'},
 {key:'count',label:'단수 (계단참·좌우 포함 전체)',type:'number',def:20,min:2,max:200,step:1,group:'치수'},
 {key:'floorHeight',label:'단수 계산기 · 층고 (mm)',type:'number',def:3300,min:100,step:10,group:'치수',hint:'단높이 = 층고 ÷ 단수. 미리보기 글에 표시됩니다.'},
 {key:'tread',label:'단 깊이 (mm)',type:'number',def:280,min:50,step:5,group:'치수'},
 {key:'gap',label:'계단사이 틈 (mm)',type:'number',def:100,min:0,step:10,group:'치수',when:v=>v.kind==='turn'},
 {key:'landing',label:'계단참 너비 (mm, 0 = 없음)',type:'number',def:1200,min:0,step:10,group:'치수',when:v=>v.kind==='straight'},
 {key:'railWidth',label:'손스침 폭 (mm, 0 = 한 선)',type:'number',def:50,min:0,step:5,group:'손스침'},
 {key:'railInset',label:'손스침 벽에서 거리 (mm)',type:'number',def:80,min:0,step:5,group:'손스침'},
 {key:'arrow',label:'화살표',type:'check',def:true,group:'화살표 · 문자'},
 {key:'arrowSize',label:'화살 크기 (mm)',type:'number',def:200,min:20,step:10,group:'화살표 · 문자',when:v=>v.arrow},
 {key:'breakLine',label:'절단선',type:'check',def:true,group:'화살표 · 문자'},
 {key:'breakStyle',label:'절단선 모양',type:'select',def:'zigzag',options:[['zigzag','지그재그'],['straight','직선']],group:'화살표 · 문자',when:v=>v.breakLine&&v.direction==='updown',hint:'원문은 선축척이 1/200 이상이면 직선으로 그립니다(바른 CAD 에는 선축척이 없어 직접 고릅니다, 2026-09-21 보정)'},
 {key:'textSize',label:'UP·DN 문자 크기 (mm)',type:'number',def:250,min:20,step:10,group:'화살표 · 문자'},
 {key:'numbers',label:'단 번호',type:'check',def:false,group:'화살표 · 문자'},
 {key:'numberSize',label:'번호 크기 (mm)',type:'number',def:120,min:20,step:10,group:'화살표 · 문자',when:v=>v.numbers},
 {key:'nonslip',label:'미끄럼방지(논슬립) 선',type:'check',def:false,group:'미끄럼방지'},
 {key:'nosing',label:'논슬립 폭 (mm)',type:'number',def:30,min:5,step:5,group:'미끄럼방지',when:v=>v.nonslip},
];
export const STAIR_SHARED_FIELDS=[
 {key:'stairLayer',label:'계단 켜',type:'layer',def:STD_LAYERS.stair,group:'켜 설정'},
 {key:'textLayer',label:'문자 켜',type:'layer',def:STD_LAYERS.text,group:'켜 설정'},
];

/** 열린 경로를 off 만큼 평행 이동(모서리는 연장해 만남). 손스침 폭 표현에 쓴다. */
export function offsetPath(pts,off){
 const P=pts.map(([x,y])=>({x,y})),n=P.length,segs=[];
 for(let i=0;i<n-1;i++){const u=G.unit(G.sub(P[i+1],P[i])),nn=G.mul(G.normal(u),off);segs.push([G.add(P[i],nn),G.add(P[i+1],nn)]);}
 const out=[segs[0][0]];
 for(let i=1;i<segs.length;i++){const h=G.lineIntersection(...segs[i-1],...segs[i]);out.push(h?h.point:segs[i][0]);}
 out.push(segs.at(-1)[1]);
 return out.map(p=>[p.x,p.y]);
}
/** 평면 계단. f: s 는 오르는 방향, d 는 폭 방향(0 ~ width). */
export function buildStairPlan(f,width,v,shared){
 const b=builder(f,shared.stairLayer),T={layer:shared.textLayer,rotation:0};
 const R=Math.round(v.count),td=v.tread,s=v.startOffset,W=width;
 const risers=[];// {s,d0,d1,index}
 const flights=[];// {s0,s1,d0,d1,dir}
 let landing=null;
 if(v.kind==='straight'){
  const R1=v.landing>0?Math.ceil(R/2):R,R2=R-R1;
  for(let i=0;i<R1;i++)risers.push({s:s+i*td,d0:0,d1:W,n:i+1});
  const sTop=s+(R1-1)*td;flights.push({s0:s,s1:sTop,d0:0,d1:W,dir:1});
  let end=sTop;
  if(R2>0){landing={s0:sTop,s1:sTop+v.landing,d0:0,d1:W,n:R1+1};const s2=sTop+v.landing;for(let i=0;i<R2;i++)risers.push({s:s2+i*td,d0:0,d1:W,n:R1+1+i});end=s2+(R2-1)*td;flights.push({s0:s2,s1:end,d0:0,d1:W,dir:1});}
  b.line(s,0,end,0);b.line(s,W,end,W);
 }else{
  const R1=Math.ceil((R-1)/2),R2=R-1-R1;// 계단참이 한 단
  for(let i=0;i<R1;i++)risers.push({s:s+i*td,d0:0,d1:W,n:i+1});
  const sTop=s+(R1-1)*td,d2=W+v.gap;
  flights.push({s0:s,s1:sTop,d0:0,d1:W,dir:1});
  landing={s0:sTop,s1:sTop+W,d0:0,d1:2*W+v.gap,n:R1+1};
  for(let j=0;j<R2;j++)risers.push({s:sTop-j*td,d0:d2,d1:d2+W,n:R1+2+j});
  const end2=sTop-(R2-1)*td;flights.push({s0:end2,s1:sTop,d0:d2,d1:d2+W,dir:-1});
  b.line(s,0,sTop+W,0);b.line(s,W,sTop,W);b.line(sTop,d2,end2,d2);b.line(sTop+W,0,sTop+W,landing.d1);b.line(end2,landing.d1,sTop+W,landing.d1);
  if(v.gap>0){b.line(sTop,W,sTop,d2);}
 }
 for(const r of risers)b.line(r.s,r.d0,r.s,r.d1);
 if(v.nonslip)for(const r of risers){const fl=flights.find(x=>r.s>=x.s0-1e-6&&r.s<=x.s1+1e-6&&r.d0>=x.d0-1e-6);const dir=fl?fl.dir:1;const sn=r.s+dir*v.nosing;if(dir>0?sn<=r.s+td:sn>=r.s-td)b.line(sn,r.d0,sn,r.d1);}
 // 손스침
 // 챌판이 손스침 끝을 이미 닫으면 끝마감 선을 겹쳐 넣지 않는다.
 const cap=(p,q)=>{if(!risers.some(r=>Math.abs(r.s-p[0])<1e-6&&Math.abs(r.s-q[0])<1e-6&&Math.min(p[1],q[1])>=r.d0-1e-6&&Math.max(p[1],q[1])<=r.d1+1e-6))b.line(p[0],p[1],q[0],q[1]);};
 const rail=(pts)=>{if(v.railWidth<=0){b.poly(pts,false);return;}const a=offsetPath(pts,v.railWidth/2),z=offsetPath(pts,-v.railWidth/2);b.poly(a,false);b.poly(z,false);cap(a[0],z[0]);cap(a.at(-1),z.at(-1));};
 const ri=v.railInset;
 if(v.kind==='straight'){const s1=flights.at(-1).s1;rail([[s,ri],[s1,ri]]);rail([[s,W-ri],[s1,W-ri]]);}
 else{const sTop=landing.s0,d2=W+v.gap,end2=flights[1].s0;rail([[s,W-ri],[sTop+W-ri,W-ri],[sTop+W-ri,d2+ri],[end2,d2+ri]]);rail([[s,ri],[sTop+W-ri,ri],[sTop+W-ri,landing.d1-ri],[end2,landing.d1-ri]]);}
 // 동선 화살표 · 절단선 · 문자
 const route=v.kind==='straight'?[[s+td/2,W/2],[flights.at(-1).s1,W/2]]:[[s+td/2,W/2],[landing.s0+W/2,W/2],[landing.s0+W/2,W+v.gap+W/2],[flights[1].s0,W+v.gap+W/2]];
 const head=(from,to)=>{const u=G.unit({x:to[0]-from[0],y:to[1]-from[1]}),n=G.normal(u),k=v.arrowSize;b.line(to[0],to[1],to[0]-u.x*k+n.x*k*.35,to[1]-u.y*k+n.y*k*.35);b.line(to[0],to[1],to[0]-u.x*k-n.x*k*.35,to[1]-u.y*k-n.y*k*.35);};
 const label=(text,at)=>b.text(at[0],at[1],text,v.textSize,T);
 const breakAt=(sB,d0,d1)=>{const h=(d1-d0),z=td*.5;if(v.breakStyle==='straight'){b.line(sB,d0-h*.08,sB,d1+h*.08);return;}b.poly([[sB,d0-h*.08],[sB,d0+h*.42],[sB+z,d0+h*.5],[sB-z,d0+h*.58],[sB,d0+h*.66],[sB,d1+h*.08]],false);};
 if(v.direction==='up'){if(v.arrow){b.poly(route,false);head(route.at(-2),route.at(-1));}label('UP',[route[0][0]-td*.2,route[0][1]]);}
 else if(v.direction==='down'){const rev=[...route].reverse();if(v.arrow){b.poly(rev,false);head(rev.at(-2),rev.at(-1));}label('DN',[rev[0][0]+(v.kind==='straight'?td*.3:0),rev[0][1]]);}
 else{
  const fl=flights[0],sB=(fl.s0+fl.s1)/2;
  if(v.breakLine){breakAt(sB,fl.d0,fl.d1);if(v.kind==='turn')breakAt(sB,flights[1].d0,flights[1].d1);}
  if(v.arrow){b.poly([route[0],[sB-td*.3,route[0][1]]],false);head(route[0],[sB-td*.3,route[0][1]]);const last=route.at(-1),endPt=[sB+td*.3,last[1]];b.poly([last,endPt],false);head(last,endPt);}
  label('UP',[route[0][0]-td*.2,route[0][1]]);label('DN',[route.at(-1)[0]+(v.kind==='straight'?td*.3:-td*.3),route.at(-1)[1]]);
 }
 if(v.numbers){for(const r of risers){const fl=flights.find(x=>r.s>=x.s0-1e-6&&r.s<=x.s1+1e-6&&r.d0>=x.d0-1e-6)||flights[0];b.text(r.s+fl.dir*td/2,(r.d0+r.d1)/2,r.n,v.numberSize,T);}if(landing)b.text((landing.s0+landing.s1)/2,(landing.d0+landing.d1)/2,landing.n,v.numberSize,T);}
 return {entities:b.list,riser:v.floorHeight/R};
}
export function stairPlanPreviewSvg(v,shared,opts={}){
 const f=wallFrame({x:0,y:0},{x:1,y:0},{x:0,y:1}),W=1200,r=buildStairPlan(f,W,v,shared);
 return entitiesSvg(r.entities,{label:opts.compact?'':`${v.kind==='turn'?'돌음':'일자'}계단 ${v.count}단 · 단높이 ${r.riser.toFixed(1)} mm (층고 ${v.floorHeight}) · 폭은 셋째 점으로`,...opts});
}

export const STC_FIELDS=[
 {key:'view',label:'단면 / 입면',type:'select',def:'elevation',options:[['section','단면'],['elevation','입면']],group:'형식'},
 {key:'wholeFloor',label:'한 개층 모두 그리기 (아래 계단 뒤 위 계단을 다시 지정, 반대 표현)',type:'check',def:true,group:'형식'},
 {key:'count',label:'단수',type:'number',def:10,min:1,max:200,step:1,group:'치수'},
 {key:'roundTen',label:'단 너비 10의 배수로 맞춤',type:'check',def:false,group:'치수'},
 {key:'waist',label:'슬라브 단 깊이 (계단판 두께, mm)',type:'number',def:150,min:10,step:5,group:'치수',when:v=>v.view==='section'},
 {key:'landing',label:'상부 참 길이 (mm)',type:'number',def:1200,min:0,step:10,group:'치수'},
 {key:'numbers',label:'단 번호',type:'check',def:true,group:'단번호'},
 {key:'numberSize',label:'번호 크기 (mm)',type:'number',def:100,min:20,step:10,group:'단번호',when:v=>v.numbers},
 {key:'railHeight',label:'손스침 높이 (mm, 0 = 없음)',type:'number',def:900,min:0,step:10,group:'손스침'},
 {key:'railThickness',label:'손스침 두께 (mm)',type:'number',def:50,min:0,step:5,group:'손스침',when:v=>v.railHeight>0},
 {key:'railExtend',label:'돌출 길이 (mm)',type:'number',def:300,min:0,step:10,group:'손스침',when:v=>v.railHeight>0},
 {key:'hRails',label:'가로살 개수',type:'number',def:2,min:0,max:20,step:1,group:'손스침',when:v=>v.railHeight>0},
 {key:'postSpacing',label:'세로살 간격 (mm, 0 = 없음)',type:'number',def:900,min:0,step:10,group:'손스침',when:v=>v.railHeight>0},
];
/** 입·단면 계단. p1 아래 시작점, p2 위 끝점(마지막 단 코). 단 너비·높이는 두 점으로 정해진다. */
export function buildStairSection(p1,p2,v,shared){
 const R=Math.round(v.count),dx=p2.x-p1.x,dy=p2.y-p1.y;
 if(Math.abs(dx)<1||Math.abs(dy)<1)throw Error('두 점은 가로·세로로 모두 떨어져 있어야 합니다.');
 const sx=Math.sign(dx);let tw=Math.abs(dx)/R;if(v.roundTen)tw=Math.max(10,Math.round(tw/10)*10);const rh=dy/R;
 const out=[],L=shared.stairLayer,T=shared.textLayer,P=(x,y)=>({x,y});
 const X=i=>p1.x+sx*i*tw,Y=i=>p1.y+i*rh;
 const profile=[P(p1.x,p1.y)];
 for(let i=0;i<R;i++){profile.push(P(X(i),Y(i+1)));profile.push(P(X(i+1),Y(i+1)));}
 const topEnd=P(X(R-1)+sx*Math.max(v.landing,tw),Y(R));profile[profile.length-1]=topEnd;
 if(v.view==='section'){
  const slope=rh/tw,sv=v.waist*Math.sqrt(1+slope*slope);
  const under=[P(topEnd.x,topEnd.y-v.waist),P(X(R-1),Y(R)-Math.max(v.waist,sv))];
  const yFloor=p1.y,xMeet=X(R-1)-sx*((Y(R)-Math.max(v.waist,sv))-yFloor)/slope;
  under.push(P(xMeet,yFloor));
  out.push({type:'polyline',closed:true,points:[...profile,...under],cardLayer:L});
 }else{
  out.push({type:'polyline',closed:false,points:profile,cardLayer:L});
  out.push({type:'line',points:[topEnd,P(topEnd.x,p1.y)],cardLayer:L});out.push({type:'line',points:[P(topEnd.x,p1.y),P(p1.x,p1.y)],cardLayer:L});
 }
 if(v.numbers)for(let i=0;i<R;i++)out.push({type:'text',position:P(X(i)+sx*tw/2,Y(i+1)+v.numberSize*.9),text:String(i+1),height:v.numberSize,rotation:0,align:'center',cardLayer:T});
 if(v.railHeight>0){
  const h=v.railHeight,e=v.railExtend,a=P(X(0),Y(1)+h),z=P(X(R-1),Y(R)+h),a0=P(a.x-sx*e,a.y),z0=P(z.x+sx*e,z.y);
  const railPts=[a0,a,z,z0];
  out.push({type:'polyline',closed:false,points:railPts,cardLayer:L});
  if(v.railThickness>0){out.push({type:'polyline',closed:false,points:railPts.map(p=>P(p.x,p.y-v.railThickness)),cardLayer:L});out.push({type:'line',points:[a0,P(a0.x,a0.y-v.railThickness)],cardLayer:L});out.push({type:'line',points:[z0,P(z0.x,z0.y-v.railThickness)],cardLayer:L});}
  const yOn=x=>{const i=Math.min(R-1,Math.max(0,Math.floor((x-p1.x)/(sx*tw)+1e-9)));return Y(i+1);};
  const railY=x=>{if(sx*(x-a.x)<=0)return a.y;if(sx*(x-z.x)>=0)return z.y;return a.y+(z.y-a.y)*((x-a.x)/(z.x-a.x));};
  if(v.postSpacing>0){for(let x=X(0)+sx*tw*.5;sx*(x-z.x)<=tw*.5;x+=sx*v.postSpacing)out.push({type:'line',points:[P(x,yOn(x)),P(x,railY(x)-v.railThickness)],cardLayer:L});}
  for(let k=1;k<=v.hRails;k++){const r=k/(v.hRails+1);out.push({type:'line',points:[P(a.x,Y(1)+(h-v.railThickness)*r),P(z.x,Y(R)+(h-v.railThickness)*r)],cardLayer:L});}
 }
 return {entities:out,tread:tw,riser:Math.abs(rh)};
}
export function stairSectionPreviewSvg(v,shared,opts={}){
 const r=buildStairSection({x:0,y:0},{x:v.count*280,y:v.count*170},v,shared);
 return entitiesSvg(r.entities,{label:opts.compact?'':`${v.view==='section'?'단면':'입면'} ${v.count}단 · 두 점으로 단 너비·높이 결정${v.wholeFloor?' · 한 개층(아래→위 두 번 지정)':''}`,...opts});
}

export function installStairCards(ctx){
 async function drawPlan(v,shared){
  const previewOf=(points,cursor)=>{const pts=cursor?[...points,cursor]:points;if(pts.length<3)return pts.length===2?[{type:'line',points:[pts[0],pts[1]],previewColor:'#ffd479'}]:[];try{const f=wallFrame(pts[0],pts[1],pts[2]);return buildStairPlan(f,f.t,v,shared).entities.map(e=>({...e,previewColor:'#ffd479'}));}catch{return [];}};
  const pts=(await ctx.pickPath({prompt:`계단 평면 ${v.count}단 · ① 첫 단 시작 모서리 ② 오르는 방향의 임의점 ③ 계단 폭 쪽 점 · Esc 중단`,preview:previewOf,minPoints:3,maxPoints:3}))?.points;
  if(!pts)return null;
  const f=wallFrame(pts[0],pts[1],pts[2]),r=buildStairPlan(f,f.t,v,shared);
  const ids=ctx.commit({removeIds:[],entities:resolveLayers(ctx,r.entities)});
  ctx.toast(`계단 평면 ${v.count}단 · 단높이 ${r.riser.toFixed(1)} mm · 폭 ${Math.round(f.t)} · Ctrl+Z 로 되돌리기`);
  return ids;
 }
 async function drawSection(v,shared){
  const rounds=v.wholeFloor?2:1;let total=0;
  for(let k=0;k<rounds;k++){
   const view=k===0?v.view:(v.view==='section'?'elevation':'section'),vk={...v,view};
   const previewOf=(points,cursor)=>{const pts=cursor?[...points,cursor]:points;if(pts.length<2)return [];try{return buildStairSection(pts[0],pts[1],vk,shared).entities.map(e=>({...e,previewColor:'#ffd479'}));}catch{return [];}};
   const pts=(await ctx.pickPath({prompt:`계단 ${view==='section'?'단면':'입면'} ${v.count}단${rounds>1?` (${k+1}/2 ${k?'위':'아래'} 계단)`:''} · ① 아래 시작점 ② 위 끝점(마지막 단 코) · Esc 중단`,preview:previewOf,minPoints:2,maxPoints:2}))?.points;
   if(!pts)break;
   const r=buildStairSection(pts[0],pts[1],vk,shared);
   ctx.commit({removeIds:[],entities:resolveLayers(ctx,r.entities)});total++;
   ctx.toast(`계단 ${view==='section'?'단면':'입면'} ${v.count}단 · 단 너비 ${r.tread.toFixed(0)} · 단높이 ${r.riser.toFixed(1)} · Ctrl+Z 로 되돌리기`);
  }
  return total;
 }
 return {
  STP:()=>openCardDialog({ctx,title:'계단 평면 그리기 · STP',storageKey:STAIR_PLAN_KEY,fields:STP_FIELDS,sharedFields:STAIR_SHARED_FIELDS,slots:4,fixedNames:['STP 기본'],preview:(v,s,o)=>stairPlanPreviewSvg(v,s,o),onGo:(v,s)=>drawPlan(v,s),
   note:'세 점: ① 첫 단이 시작되는 모서리 → ② 오르는 방향(수직선 상의 임의점) → ③ 계단 폭 쪽 점. 계단 길이는 단수 × 단 깊이로 정해집니다.'}),
  STC:()=>openCardDialog({ctx,title:'계단 입·단면 그리기 · STC',storageKey:STAIR_SECTION_KEY,fields:STC_FIELDS,sharedFields:STAIR_SHARED_FIELDS,slots:4,fixedNames:['STC 기본'],preview:(v,s,o)=>stairSectionPreviewSvg(v,s,o),onGo:(v,s)=>drawSection(v,s),
   note:'두 점: ① 아래 시작점 → ② 위 끝점. 한 단의 너비와 높이는 두 점을 단수로 나눠 정해집니다.'}),
 };
}
