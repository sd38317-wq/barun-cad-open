// Display-only simplification. The editable entity, snap topology and export
// points never enter this module's mutation path. Output references a subset.
export function canSimplifyGpuPolyline(entity,style={},clipMasks=[]) {
  if(entity.type!=='polyline'||entity.closed||clipMasks.length||entity.points?.length<64)return false;
  if(Number(entity.constantWidth)>0||Number(entity.startWidth)>0||Number(entity.endWidth)>0)return false;
  const linetype=String(style.linetype??'').trim().toUpperCase();
  if(linetype&&linetype!=='CONTINUOUS')return false;
  const first=entity.points[0],last=entity.points.at(-1);
  if(first.x===last.x&&first.y===last.y)return false;
  return !entity.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||Number(p.bulge)||Number(p.startWidth)||Number(p.endWidth));
}

export function gpuPolylineBounds(points) {
  const b={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  for(const p of points){b.minX=Math.min(b.minX,p.x);b.maxX=Math.max(b.maxX,p.x);b.minY=Math.min(b.minY,p.y);b.maxY=Math.max(b.maxY,p.y);}
  return b;
}

export function simplifyGpuPolyline(points,qualityScale,pixelError=.25) {
  if(points.length<3||!Number.isFinite(qualityScale)||qualityScale<=0||!Number.isFinite(pixelError)||pixelError<=0)return points;
  const tolerance=pixelError/qualityScale,tolerance2=tolerance*tolerance;
  const keep=new Uint8Array(points.length);keep[0]=keep[points.length-1]=1;
  const stack=[0,points.length-1];let work=0;
  // An adversarial zigzag must not create unbounded quadratic startup work.
  // Falling back retains every source point and therefore retains precision.
  const workBudget=Math.max(4096,points.length*64);
  while(stack.length){
    const end=stack.pop(),start=stack.pop(),a=points[start],b=points[end];
    const dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;let greatest=tolerance2,pivot=-1;
    for(let i=start+1;i<end;i++){
      if(++work>workBudget)return points;
      const p=points[i],t=length2?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length2)):0;
      const x=p.x-a.x-t*dx,y=p.y-a.y-t*dy,distance2=x*x+y*y;
      if(!Number.isFinite(distance2))return points;
      if(distance2>greatest){greatest=distance2;pivot=i;}
    }
    if(pivot>=0){keep[pivot]=1;stack.push(start,pivot,pivot,end);}
  }
  const result=points.filter((_,index)=>keep[index]);
  return result.length===points.length?points:result;
}
