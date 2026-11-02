// 패드 스케치 정리(A18·A29): 손으로 그은 획을 정해진 몇 가지 모양으로만 바꾼다.
// 모르는 모양은 null — 도면에 넣지 않고 펜 표시로 남긴다. 좌표는 도면 단위(mm), unit = 화면 1px 의 도면 길이.
import * as G from './geometry.js';

// AI 보기 전용: 원획을 훑는 작업은 MCP 요청 때만 한다. 도면 객체/화면 보기에는 의존하지 않는다.
export function padSketchBounds(strokes){
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const path of strokes)for(const p of path){
  if(!Number.isFinite(p?.x)||!Number.isFinite(p?.y))throw Error('스케치 좌표가 올바르지 않습니다.');
  minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);
 }
 return minX===Infinity?null:{minX,minY,maxX,maxY};
}
/** 흰 바탕 PNG의 크기·여백·좌표 변환. 픽셀 반올림 후에도 양 축의 mmPerPixel은 같다. */
export function padSketchPngPlan(strokes,size=1024){
 const bounds=padSketchBounds(strokes);if(!bounds)throw Error('읽을 패드 스케치가 없습니다.');
 const maxPx=Math.min(2048,Math.max(256,Math.round(Number(size)||1024))),padding=16;
 const spanX=bounds.maxX-bounds.minX,spanY=bounds.maxY-bounds.minY;
 if(!Number.isFinite(spanX)||!Number.isFinite(spanY)||!Number.isFinite(maxPx))throw Error('스케치 범위가 올바르지 않습니다.');
 const mmPerPixel=Math.max(spanX,spanY,1)/(maxPx-2*padding);
 const width=Math.min(maxPx,Math.max(2*padding+1,Math.ceil(spanX/mmPerPixel)+2*padding)),height=Math.min(maxPx,Math.max(2*padding+1,Math.ceil(spanY/mmPerPixel)+2*padding));
 const minX=bounds.minX-padding*mmPerPixel,maxY=bounds.maxY+padding*mmPerPixel;
 const window={minX,minY:maxY-height*mmPerPixel,maxX:minX+width*mmPerPixel,maxY};
 if(!Object.values(window).every(Number.isFinite)||window.maxX<=window.minX||window.maxY<=window.minY)throw Error('스케치 범위가 올바르지 않습니다.');
 return {bounds,window,width,height,mmPerPixel};
}

const pathLength=ps=>ps.slice(1).reduce((s,p,i)=>s+G.dist(ps[i],p),0);
const boxOf=ps=>{const xs=ps.map(p=>p.x),ys=ps.map(p=>p.y);return {minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)};};
const diagonal=ps=>{const b=boxOf(ps);return Math.hypot(b.maxX-b.minX,b.maxY-b.minY);};
export const DOOR_WIDTHS=[600,700,800,900,1000,1100,1200];

export function snapLength(value,step=50){return Math.max(step,Math.round(value/step)*step);}
// 0·90°(그리고 45°) 근처면 딱 붙인다. 우리 작업은 거의 수평·수직이다.
export function snapDirection(u,{diagonals=true,tolerance=8}={}){
 const a=G.angle(u),targets=diagonals?[0,45,90,135,180,-45,-90,-135,-180]:[0,90,180,-90,-180];
 const near=targets.find(t=>Math.abs(a-t)<=tolerance);return near===undefined?G.unit(u):G.polar(1,near);
}
export const axisDirection=u=>Math.abs(u.x)>=Math.abs(u.y)?{x:Math.sign(u.x)||1,y:0}:{x:0,y:Math.sign(u.y)||1};

// 주축(공분산)으로 직선을 맞춘다. deviation = 직선에서 가장 먼 점의 거리.
export function fitLine(ps){
 const n=ps.length,cx=ps.reduce((s,p)=>s+p.x,0)/n,cy=ps.reduce((s,p)=>s+p.y,0)/n;
 let xx=0,xy=0,yy=0;for(const p of ps){const dx=p.x-cx,dy=p.y-cy;xx+=dx*dx;xy+=dx*dy;yy+=dy*dy;}
 const theta=Math.atan2(2*xy,xx-yy)/2,u={x:Math.cos(theta),y:Math.sin(theta)},c={x:cx,y:cy};
 const t=ps.map(p=>G.dot(G.sub(p,c),u)),deviation=Math.max(...ps.map(p=>Math.abs(G.cross(u,G.sub(p,c)))));
 let a=G.add(c,G.mul(u,Math.min(...t))),b=G.add(c,G.mul(u,Math.max(...t)));
 if(G.dot(G.sub(ps.at(-1),ps[0]),u)<0)[a,b]=[b,a];   // 그은 방향을 지킨다
 const d=G.sub(b,a);return {a,b,u:G.len(d)>G.EPS?G.unit(d):u,deviation,length:G.len(d)};
}
// Kasa 원 맞추기. error = 반지름에 대한 평균 어긋남 비율.
export function fitCircle(ps){
 const n=ps.length;if(n<3)return null;
 const mx=ps.reduce((s,p)=>s+p.x,0)/n,my=ps.reduce((s,p)=>s+p.y,0)/n;
 let suu=0,suv=0,svv=0,suuu=0,svvv=0,suvv=0,svuu=0;
 for(const p of ps){const u=p.x-mx,v=p.y-my;suu+=u*u;suv+=u*v;svv+=v*v;suuu+=u*u*u;svvv+=v*v*v;suvv+=u*v*v;svuu+=v*u*u;}
 const det=suu*svv-suv*suv;if(Math.abs(det)<1e-9)return null;
 const r1=(suuu+suvv)/2,r2=(svvv+svuu)/2,uc=(r1*svv-r2*suv)/det,vc=(r2*suu-r1*suv)/det;
 const center={x:mx+uc,y:my+vc},radius=Math.sqrt(uc*uc+vc*vc+(suu+svv)/n);
 const error=ps.reduce((s,p)=>s+Math.abs(G.dist(p,center)-radius),0)/n/radius;
 return {center,radius,error};
}
// 원 위를 지나간 각도(도). 부호 = 도는 방향.
export function sweepOf(ps,center){
 let total=0,last=null;for(const p of ps){const a=Math.atan2(p.y-center.y,p.x-center.x);if(last!==null){let d=a-last;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;total+=d;}last=a;}
 return total*180/Math.PI;
}
// Douglas-Peucker 줄이기
export function simplify(ps,tolerance){
 if(ps.length<3)return ps.slice();
 const keep=new Uint8Array(ps.length);keep[0]=keep[ps.length-1]=1;const stack=[[0,ps.length-1]];
 while(stack.length){const [i,j]=stack.pop();let far=-1,best=tolerance;for(let k=i+1;k<j;k++){const d=G.distanceToSegment(ps[k],ps[i],ps[j]);if(d>best){best=d;far=k;}}if(far>0){keep[far]=1;stack.push([i,far],[far,j]);}}
 return ps.filter((_,i)=>keep[i]);
}

export function classifyStroke(ps,unit=1){
 if(!ps||ps.length<2)return {kind:'free'};
 const size=diagonal(ps),length=pathLength(ps);if(size<6*unit)return {kind:'dot',point:ps[0]};
 const closed=G.dist(ps[0],ps.at(-1))<=Math.max(24*unit,size*.2)&&length>size*1.8;
 const line=fitLine(ps);
 if(!closed&&line.deviation<=Math.max(5*unit,line.length*.07))return {kind:'line',a:line.a,b:line.b,u:line.u,length:line.length};
 const circle=fitCircle(ps);
 if(closed){
  const corners=simplify(ps,Math.max(8*unit,size*.09));
  const ring=G.dist(corners[0],corners.at(-1))<=Math.max(24*unit,size*.2)?corners.slice(0,-1):corners;
  if(ring.length>=4&&ring.length<=5){
   const b=boxOf(ps),u=snapDirection(G.sub(ring[1],ring[0]),{diagonals:false,tolerance:12});
   if(Math.abs(u.x)===1||Math.abs(u.y)===1)return {kind:'rect',min:{x:b.minX,y:b.minY},max:{x:b.maxX,y:b.maxY}};
  }
  if(circle&&circle.error<.12)return {kind:'circle',center:circle.center,radius:circle.radius};
  return {kind:'free',closed:true};
 }
 if(circle&&circle.error<.1){const sweep=sweepOf(ps,circle.center);if(Math.abs(sweep)>=35&&Math.abs(sweep)<=300)return {kind:'arc',center:circle.center,radius:circle.radius,start:ps[0],end:ps.at(-1),sweep};}
 const corners=simplify(ps,Math.max(8*unit,size*.08));
 if(corners.length>=3&&corners.length<=7){
  const square=corners.slice(1,-1).every((p,i)=>{const a=G.unit(G.sub(corners[i],p)),b=G.unit(G.sub(corners[i+2],p));return Math.abs(G.dot(a,b))<Math.sin(18*Math.PI/180);});
  if(square)return {kind:'polyline',points:squarePolyline(corners)};
 }
 return {kind:'free'};
}
// 꺾인 획 → 직각으로 꺾인 선. 첫 변 방향을 수평·수직에 붙이고 변마다 그 방향이나 직각으로.
export function squarePolyline(corners){
 const first=snapDirection(G.sub(corners[1],corners[0]),{diagonals:false,tolerance:12}),side=G.normal(first),out=[corners[0]];
 for(let i=1;i<corners.length;i++){const d=G.sub(corners[i],out.at(-1)),along=Math.abs(G.dot(d,first))>=Math.abs(G.dot(d,side))?first:side;out.push(G.add(out.at(-1),G.mul(along,G.dot(d,along))));}
 return out;
}
// 거의 곧은 획 → 직선. 시작점은 그대로, 방향은 0·45·90°, 길이는 step 단위.
export function straightLine(shape,{step=50}={}){
 const u=snapDirection(G.sub(shape.b,shape.a)),length=snapLength(shape.length,step);
 return [shape.a,G.add(shape.a,G.mul(u,length))];
}

// 동그라미 다음 화살표: 축(수평·수직)으로 맞춘 이동. 끝의 V 자 촉은 시작점에서 가장 먼 점까지만 본다.
export function arrowMove(ps,{step=50}={}){
 if(!ps||ps.length<2)return null;
 let far=ps[0];for(const p of ps)if(G.dist(p,ps[0])>G.dist(far,ps[0]))far=p;
 const shaft=ps.slice(0,ps.indexOf(far)+1),line=fitLine(shaft.length>1?shaft:ps);
 const raw=G.sub(far,ps[0]);if(G.len(raw)<G.EPS)return null;
 const u=axisDirection(raw),distance=snapLength(Math.abs(G.dot(raw,u)),step);
 return {from:ps[0],u,distance,vector:G.mul(u,distance),straight:line.deviation<=Math.max(line.length*.18,1)};
}

// 문: ¼ 호 + 경첩에서 나온 문짝 선. 호 두 개(문짝 끝이 맞닿음)면 양개문.
export function recognizeDoors(shapes,unit=1){
 const arcs=shapes.filter(s=>s.kind==='arc'&&Math.abs(s.sweep)>=55&&Math.abs(s.sweep)<=125),lines=shapes.filter(s=>s.kind==='line'),doors=[];
 for(const arc of arcs){
  const reach=Math.max(arc.radius*.3,18*unit);
  const leaf=lines.find(l=>[[l.a,l.b],[l.b,l.a]].some(([hinge,end])=>G.dist(hinge,arc.center)<=reach&&Math.abs(G.dist(hinge,end)-arc.radius)<=arc.radius*.35&&Math.min(G.dist(end,arc.start),G.dist(end,arc.end))<=arc.radius*.4));
  const ends=[arc.start,arc.end],leafEnd=leaf?[leaf.a,leaf.b].sort((p,q)=>G.dist(q,arc.center)-G.dist(p,arc.center))[0]:null;
  // 열린 문짝 쪽이 아닌 호 끝 = 닫혔을 때 문짝 끝 = 벽 방향
  const closedEnd=leafEnd?ends.sort((p,q)=>G.dist(q,leafEnd)-G.dist(p,leafEnd))[0]:(Math.abs(G.dot(G.unit(G.sub(arc.start,arc.center)),{x:1,y:0}))>Math.abs(G.dot(G.unit(G.sub(arc.end,arc.center)),{x:1,y:0}))?arc.start:arc.end);
  const openEnd=leafEnd||(closedEnd===arc.start?arc.end:arc.start);
  const u=axisDirection(G.sub(closedEnd,arc.center)),swing=G.cross(u,G.sub(openEnd,arc.center))>0?'positive':'negative';
  const width=DOOR_WIDTHS.reduce((best,w)=>Math.abs(w-arc.radius)<Math.abs(best-arc.radius)?w:best,DOOR_WIDTHS[0]);
  doors.push({kind:'door',style:'single',hinge:arc.center,u,side:swing,width,radius:arc.radius,used:[arc,leaf].filter(Boolean)});
 }
 // 양개: 같은 벽 방향, 반대쪽 경첩, 두 경첩 사이 = 두 문짝 합
 const out=[],taken=new Set();
 for(let i=0;i<doors.length;i++){if(taken.has(i))continue;
  const a=doors[i],j=doors.findIndex((b,k)=>k>i&&!taken.has(k)&&G.dot(a.u,b.u)<-.9&&Math.abs(G.dist(a.hinge,b.hinge)-(a.radius+b.radius))<=(a.radius+b.radius)*.25);
  if(j>0){const b=doors[j];taken.add(j);const total=snapLength(G.dist(a.hinge,b.hinge),100);out.push({kind:'door',style:'double',hinge:a.hinge,u:a.u,side:a.side,width:total,used:[...a.used,...b.used]});}
  else out.push(a);
 }
 return out;
}

// 창(사용자 확정): 네모 박스 + 가운데 줄, 또는 손그림 미서기 — 위아래로 지나는 가운데 세로선(두 창짝이 만나는 곳),
// 그와 직각인 창짝 선 1~2개, 양 끝 창틀 선. 폭은 가운데 선에서 창틀까지(양쪽이면 평균 ×2), 100mm 단위.
export function recognizeWindow(shapes,unit=1){
 const rect=shapes.find(s=>s.kind==='rect'),lines=shapes.filter(s=>s.kind==='line');
 if(rect){
  const w=rect.max.x-rect.min.x,h=rect.max.y-rect.min.y,u=w>=h?{x:1,y:0}:{x:0,y:1},c={x:(rect.min.x+rect.max.x)/2,y:(rect.min.y+rect.max.y)/2};
  const inner=lines.filter(l=>Math.abs(G.dot(l.u,u))>.95&&G.dist(G.mul(G.add(l.a,l.b),.5),c)<Math.max(w,h)*.5);
  if(!inner.length)return null;
  return {kind:'window',style:'sliding',center:c,u,width:snapLength(Math.max(w,h),100),thickness:Math.min(w,h),used:[rect,...inner]};
 }
 if(lines.length<2)return null;
 // 가운데 선: 다른 선(창짝)이 가로지르는 가장 긴 선
 const crossing=(l,m)=>{const hit=G.lineIntersection(l.a,l.b,m.a,m.b);return !!hit&&G.distanceToSegment(hit.point,l.a,l.b)<=6*unit&&G.distanceToSegment(hit.point,m.a,m.b)<=6*unit;};
 let best=null;
 for(const center of lines){
  const v=G.unit(G.sub(center.b,center.a)),sashes=lines.filter(m=>m!==center&&Math.abs(G.dot(m.u,v))<.26&&(crossing(center,m)||G.distanceToSegment(G.mul(G.add(m.a,m.b),.5),center.a,center.b)<=Math.max(m.length*.6,20*unit)));
  if(sashes.length&&(!best||center.length>best.center.length))best={center,v,sashes};
 }
 if(!best)return null;
 const axis=axisDirection(G.normal(best.v)),u={x:Math.abs(axis.x),y:Math.abs(axis.y)},sashMid=best.sashes.map(m=>G.mul(G.add(m.a,m.b),.5));
 const along=G.dot(best.center.a,u),across=sashMid.reduce((s,p)=>s+G.dot(p,G.normal(u)),0)/sashMid.length;
 const center=G.add(G.mul(u,along),G.mul(G.normal(u),across));
 const jambs=lines.filter(l=>l!==best.center&&!best.sashes.includes(l)&&Math.abs(G.dot(l.u,u))<.26&&l.length<best.center.length).map(l=>G.dot(G.mul(G.add(l.a,l.b),.5),u)-along);
 const left=jambs.filter(d=>d<0).map(Math.abs),right=jambs.filter(d=>d>0);
 const reach=(left.length&&right.length)?(Math.min(...left)+Math.min(...right))/2:left.length?Math.min(...left):right.length?Math.min(...right):Math.max(...best.sashes.flatMap(m=>[m.a,m.b]).map(p=>Math.abs(G.dot(p,u)-along)));
 const style=best.sashes.length>=2?'sliding':'fixed';
 return {kind:'window',style,center,u,width:snapLength(reach*2,100),used:[best.center,...best.sashes]};
}

// 문·창을 끼울 벽: 방향이 같은 두 벽선(사이 80~500mm)이 그 자리를 덮으면 그 둘. 없으면 null.
export function findWallLines(entities,center,u,span){
 const parallel=entities.filter(e=>e.type==='line'&&e.points?.length===2&&G.dist(...e.points)>G.EPS).map(e=>{const d=G.unit(G.sub(e.points[1],e.points[0]));return {e,d,offset:G.cross(u,G.sub(e.points[0],center)),t:e.points.map(p=>G.dot(G.sub(p,center),u))};})
  .filter(o=>Math.abs(G.cross(o.d,u))<.02&&Math.abs(o.offset)<=500&&Math.min(...o.t)<=-span/2+1&&Math.max(...o.t)>=span/2-1);
 let pair=null;
 // 손그림은 벽 안쪽에 딱 맞지 않는다 — 점에서 가장 가까운(벽 두께 하나 안쪽) 두 줄을 고른다
 for(const a of parallel)for(const b of parallel){const gap=b.offset-a.offset;if(gap<80||gap>500||a.offset>gap||b.offset<-gap)continue;const middle=(a.offset+b.offset)/2;if(!pair||Math.abs(middle)<Math.abs(pair.middle))pair={lines:[a.e,b.e],gap,middle};}
 return pair;
}
