import * as G from './geometry.js';

// The snap aperture is small even when source lines span the entire drawing.
// Clip only the broad-phase bounds; exact intersections still use original data.
function localLineBounds(segment, p, radius, pad) {
  const a={x:segment[0].x-p.x,y:segment[0].y-p.y};
  const dx=segment[1].x-segment[0].x,dy=segment[1].y-segment[0].y;
  // G.intersections accepts line parameters in [-EPS, 1+EPS]. Include that
  // existing endpoint tolerance in bounds even for very long source segments.
  let lo=-G.EPS,hi=1+G.EPS;
  for(const [start,delta] of [[a.x,dx],[a.y,dy]]) {
    if(delta===0){if(start < -radius || start > radius)return null;continue;}
    let t0=(-radius-start)/delta,t1=(radius-start)/delta;
    if(t0>t1)[t0,t1]=[t1,t0];
    lo=Math.max(lo,t0);hi=Math.min(hi,t1);if(lo>hi)return null;
  }
  const x0=a.x+dx*lo,x1=a.x+dx*hi,y0=a.y+dy*lo,y1=a.y+dy*hi;
  return {minX:Math.min(x0,x1)-pad,maxX:Math.max(x0,x1)+pad,minY:Math.min(y0,y1)-pad,maxY:Math.max(y0,y1)+pad};
}

export function snapIntersections(near, curves, p, tolerance, stats) {
  if(!(tolerance>0)||!Number.isFinite(tolerance))return [];
  const magnitude=Math.max(1,Math.abs(p.x),Math.abs(p.y),tolerance);
  const pad=Math.max(G.EPS*4,tolerance*1e-10,magnitude*Number.EPSILON*32);
  const radius=tolerance+pad,records=[],hits=[];
  for(let i=0;i<near.length;i++) {
    const dx=near[i][1].x-near[i][0].x,dy=near[i][1].y-near[i][0].y,A=dx*dx+dy*dy;
    // The existing line/circle predicate permits discriminant >= -EPS.
    // Its radial tolerance grows for short segments; retain those candidates.
    const linePad=curves.length&&A>=G.EPS?Math.max(pad,Math.sqrt(G.EPS/(4*A))):pad;
    const b=localLineBounds(near[i],p,tolerance+linePad,linePad);
    if(b)records.push({kind:0,index:i,entity:near[i],b});
  }
  for(let i=0;i<curves.length;i++) {
    const e=curves[i],x=e.center.x-p.x,y=e.center.y-p.y,r=e.radius;
    const b={minX:Math.max(-radius,x-r-pad),maxX:Math.min(radius,x+r+pad),minY:Math.max(-radius,y-r-pad),maxY:Math.min(radius,y+r+pad)};
    if(b.minX<=b.maxX&&b.minY<=b.maxY)records.push({kind:1,index:i,entity:e,b});
  }
  // Sweep across the direction with less accumulated extent. This also avoids
  // comparing every pair of parallel, long horizontal (or vertical) lines.
  let extentX=0,extentY=0;
  for(const {b} of records){extentX+=b.maxX-b.minX;extentY+=b.maxY-b.minY;}
  const axis=extentX<=extentY?'X':'Y',other=axis==='X'?'Y':'X';
  const min='min'+axis,max='max'+axis,minOther='min'+other,maxOther='max'+other;
  records.sort((a,b)=>a.b[min]-b.b[min]);
  let active=[],exactPairs=0,broadPairs=0;
  const accept=(point,a,b,kind,i,j,ordinal)=>{
    if(G.dist(point,p)<tolerance&&G.visiblePoint(a,point)&&G.visiblePoint(b,point))hits.push({point,kind,i,j,ordinal});
  };
  for(const current of records) {
    active=active.filter(previous=>previous.b[max]>=current.b[min]);
    for(const previous of active) {
      broadPairs++;
      if(previous.b[maxOther]<current.b[minOther]||current.b[maxOther]<previous.b[minOther])continue;
      exactPairs++;
      let a=previous,b=current;
      if(a.kind>b.kind||a.kind===b.kind&&a.index>b.index)[a,b]=[b,a];
      // 잘게 나눈 곡선(타원·SPLINE)의 이웃 마디는 꼭짓점에서 만나지만 교차점이 아니다.
      if(a.kind===0&&b.kind===0&&a.entity.curveOf&&a.entity.curveOf===b.entity.curveOf)continue;
      if(a.kind===0&&b.kind===0) {
        const h=G.lineIntersection(...a.entity,...b.entity);
        if(h&&h.t>=0&&h.t<=1&&h.u>=0&&h.u<=1)accept(h.point,a.entity,b.entity,0,a.index,b.index,0);
      } else if(a.kind===0) {
        const points=G.intersections(b.entity,{type:'line',points:a.entity});
        points.forEach((point,k)=>accept(point,b.entity,a.entity,1,b.index,a.index,k));
      } else {
        const points=G.intersections(a.entity,b.entity);
        points.forEach((point,k)=>accept(point,a.entity,b.entity,2,a.index,b.index,k));
      }
    }
    active.push(current);
  }
  // Preserve the original loop's tie ordering (including curve-line before
  // curve-curve for each curve), so equal-distance snaps do not change target.
  const order=h=>h.kind===0?[-1,h.i,0,h.j,h.ordinal]:[h.i,0,h.kind,h.j,h.ordinal];
  hits.sort((a,b)=>{const x=order(a),y=order(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;});
  if(stats)Object.assign(stats,{records:records.length,broadPairs,exactPairs});
  return hits.map(({point,kind})=>({...point,label:kind===0?'교차점':'곡선 교차점'}));
}
