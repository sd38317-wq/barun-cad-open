// Pure, millimetre-based geometry. Called only by the optional 3D law overlay.
import {floorHeight,floorElevation} from './review-3d-geometry.js';
const EPS = 1e-7;
export const NORTH_CAP_SEGMENTS = 64;
const dot = (a, b) => a.x*b.x + a.y*b.y + (a.z || 0)*(b.z || 0);
const sub = (a,b) => ({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const cross = (a,b) => ({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const finitePoint = p => Number.isFinite(p?.x) && Number.isFinite(p?.y);
const close = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0)) < EPS;
const area2 = ps => ps.reduce((s,p,i)=>s+p.x*ps[(i+1)%ps.length].y-p.y*ps[(i+1)%ps.length].x,0);
const turn = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function clean(ps) {
  const out=[];
  for (const p of ps || []) { if (!finitePoint(p)) return []; if (!out.length || !close(p,out.at(-1))) out.push({x:p.x,y:p.y}); }
  if(out.length>1 && close(out[0],out.at(-1))) out.pop();
  let changed=true;
  while(changed && out.length>3){changed=false;for(let i=0;i<out.length;i++)if(Math.abs(turn(out[(i+out.length-1)%out.length],out[i],out[(i+1)%out.length]))<EPS){out.splice(i,1);changed=true;break;}}
  return out;
}
// Ear clipping accepts concave simple contours, regardless of winding.
function triangles(ps) {
  const pts=clean(ps);if(pts.length<3 || Math.abs(area2(pts))<EPS)return [];
  if(area2(pts)<0)pts.reverse();
  const ids=pts.map((_,i)=>i),out=[];
  while(ids.length>3){let found=false;
    for(let i=0;i<ids.length;i++){
      const a=pts[ids[(i+ids.length-1)%ids.length]],b=pts[ids[i]],c=pts[ids[(i+1)%ids.length]];
      if(turn(a,b,c)<=EPS)continue;
      if(ids.some(id=>{const p=pts[id];return p!==a&&p!==b&&p!==c&&turn(a,b,p)>=-EPS&&turn(b,c,p)>=-EPS&&turn(c,a,p)>=-EPS;}))continue;
      out.push([a,b,c]);ids.splice(i,1);found=true;break;
    }
    if(!found)return []; // Invalid/self-intersecting contour: never invent a mass.
  }
  out.push(ids.map(i=>pts[i]));return out;
}
function prism(tri,base,top){
  const lo=tri.map(p=>({...p,z:base})),hi=tri.map(p=>({...p,z:top}));
  return [lo.slice().reverse(),hi,...lo.map((p,i)=>[p,lo[(i+1)%3],hi[(i+1)%3],hi[i]])];
}
function volume(faces){
  const ps=faces.flat();if(!ps.length)return 0;
  const c=ps.reduce((s,p)=>({x:s.x+p.x/ps.length,y:s.y+p.y/ps.length,z:s.z+p.z/ps.length}),{x:0,y:0,z:0});
  let v=0;for(const f of faces)for(let i=1;i+1<f.length;i++)v+=Math.abs(dot(sub(f[0],c),cross(sub(f[i],c),sub(f[i+1],c))))/6;
  return v/1e9;
}
function clip(faces,plane){
  const distances=faces.flat().map(p=>dot(plane.n,p)-plane.c);
  if(!distances.length)return [];
  if(Math.max(...distances)<=EPS)return faces;
  if(Math.min(...distances)>=-EPS)return [];
  const result=[],cap=[];
  for(const face of faces){const out=[];
    for(let i=0;i<face.length;i++){
      const a=face[i],b=face[(i+1)%face.length],da=dot(plane.n,a)-plane.c,db=dot(plane.n,b)-plane.c;
      if(da<=EPS)out.push(a);
      if((da>EPS&&db<-EPS)||(da<-EPS&&db>EPS)){
        const t=da/(da-db),p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t};out.push(p);cap.push(p);
      }else if(Math.abs(da)<=EPS)cap.push(a);
    }
    const uniq=out.filter((p,i)=>!i||!close(p,out[i-1]));if(uniq.length>1&&close(uniq[0],uniq.at(-1)))uniq.pop();
    if(uniq.length>=3)result.push(uniq);
  }
  const unique=[];for(const p of cap)if(!unique.some(q=>close(p,q)))unique.push(p);
  if(unique.length>=3){
    const c=unique.reduce((s,p)=>({x:s.x+p.x/unique.length,y:s.y+p.y/unique.length,z:s.z+p.z/unique.length}),{x:0,y:0,z:0});
    const n=plane.n,axis=Math.abs(n.z)<.9*Math.hypot(n.x,n.y,n.z)?{x:0,y:0,z:1}:{x:1,y:0,z:0};
    const u=cross(n,axis),v=cross(n,u);
    unique.sort((a,b)=>Math.atan2(dot(sub(a,c),v),dot(sub(a,c),u))-Math.atan2(dot(sub(b,c),v),dot(sub(b,c),u)));
    result.push(unique);
  }
  return result.length>=4&&volume(result)>1e-12?result:[];
}
// Partition by a convex intersection: outside fragments are disjoint.
function split(faces,planes){
  let inside=faces;const outside=[];
  for(const p of planes){if(!inside.length)break;const rest=clip(inside,{n:{x:-p.n.x,y:-p.n.y,z:-p.n.z},c:-p.c});if(rest.length)outside.push(rest);inside=clip(inside,p);}
  return {inside,outside};
}
function trianglePlanes(tri){return tri.map((a,i)=>{const b=tri[(i+1)%3];const n={x:b.y-a.y,y:a.x-b.x,z:0};return {n,c:dot(n,a)};});}
function footprintPrisms(outer,holes,base,top){
  let pieces=triangles(outer).map(t=>prism(t,base,top));
  for(const hole of holes)for(const tri of triangles(hole))pieces=pieces.flatMap(p=>split(p,trianglePlanes(tri)).outside);
  return pieces;
}
function regionPartition(pieces,regions,status,parts){
  for(const planes of regions){const rest=[];for(const p of pieces){const s=split(p,planes);if(s.inside.length)parts.push({status,faces:s.inside,volumeM3:volume(s.inside)});rest.push(...s.outside);}pieces=rest;}
  return pieces;
}
const floorOf = l => Number.isFinite(l.floor)?l.floor:/^A-BLDG-UP$/i.test(l.name)?2:Number(l.name?.match(/^A-BLDG-L(\d+)$/i)?.[1]||l.name?.match(/(?:^|[ _-])(\d+)F(?:$|[ _-])/i)?.[1]||1);
const repeatOf = l => /^A-BLDG-UP$/i.test(l.name)&&Number.isInteger(l.upperFloors)&&l.upperFloors>0?l.upperFloors:1;
const targetLayer = l => l&&!/^SITE(?:-|$)|^CHECK-VIOLATION$/i.test(l.name)&&(l.building===true||/^A-BLDG-(?:L\d+|UP)$|(?:^|[ _-])\d+F(?:$|[ _-])/i.test(l.name));
// The engine also uses wall/slab layers to determine accumulated floor heights.
const heightLayer = l => l&&!/^SITE(?:-|$)|^CHECK-VIOLATION$/i.test(l.name)&&(l.building===true||/^A-BLDG-(?:L\d+|UP)$|(?:^|[ _-])\d+F(?:$|[ _-])|벽|건물|슬래브|매스|WALL|BUILDING|SLAB|MASS/i.test(l.name));
const target = (e,l) => targetLayer(l)&&(e.type==='mass'||e.type==='rectangle'||e.type==='polyline'&&e.closed);
const zPlane = (z,above=false)=>({n:{x:0,y:0,z:above?-1:1},c:above?-z:z});
function northFrame(a,b,centroid){const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(len<EPS)return null;const t={x:dx/len,y:dy/len,z:0};let n={x:-t.y,y:t.x,z:0};if(dot(n,{x:centroid.x-a.x,y:centroid.y-a.y})<0)n={x:-n.x,y:-n.y,z:0};return {a,b,t,n,len};}
function northRegions(frame,r0,r1,factor){
  const m=(r1.distance-r0.distance)/(r1.height-r0.height)*factor,c=(r0.distance-(r1.distance-r0.distance)/(r1.height-r0.height)*r0.height)*factor,{a,b,n,t}=frame;
  const common=[zPlane(r0.height,true),zPlane(r1.height),{n:{x:-n.x,y:-n.y,z:0},c:-dot(n,a)}];
  // Exact distance to the interior of a finite segment: a rectangular strip.
  const middle=[...common,{n:{x:n.x,y:n.y,z:-m},c:dot(n,a)+c},
    {n:{x:-t.x,y:-t.y,z:0},c:-dot(t,a)}, {n:t,c:dot(t,b)}];
  // Endpoints use inscribed circles instead of rectangular tangent extensions.
  // The inward/tangent constraints select the outward quarter of each circle.
  const shrink=Math.cos(Math.PI/NORTH_CAP_SEGMENTS);
  const cap=(endpoint,side)=>[...common,{n:{x:t.x*side,y:t.y*side,z:0},c:dot(t,endpoint)*side},
    ...Array.from({length:NORTH_CAP_SEGMENTS},(_,i)=>{
      const angle=(i+.5)*Math.PI*2/NORTH_CAP_SEGMENTS,q={x:t.x*Math.cos(angle)+n.x*Math.sin(angle),y:t.y*Math.cos(angle)+n.y*Math.sin(angle),z:0};
      return {n:{...q,z:-m*shrink},c:dot(q,endpoint)+c*shrink};
    })];
  return [middle,cap(a,1),cap(b,-1)];
}
function northSurfaces(frame,r0,r1){
  const {a,b,n,t}=frame,point=(p,r,along=0,inward=1)=>({x:p.x+(n.x*inward+t.x*along)*r.distance,y:p.y+(n.y*inward+t.y*along)*r.distance,z:r.height});
  const faces=[[point(a,r0),point(b,r0),point(b,r1),point(a,r1)]];
  for(const [endpoint,side] of [[a,-1],[b,1]])for(let i=0;i<NORTH_CAP_SEGMENTS/4;i++){
    const angle0=i*Math.PI*2/NORTH_CAP_SEGMENTS,angle1=(i+1)*Math.PI*2/NORTH_CAP_SEGMENTS;
    faces.push([point(endpoint,r0,side*Math.cos(angle0),Math.sin(angle0)),point(endpoint,r0,side*Math.cos(angle1),Math.sin(angle1)),point(endpoint,r1,side*Math.cos(angle1),Math.sin(angle1)),point(endpoint,r1,side*Math.cos(angle0),Math.sin(angle0))]);
  }
  return faces;
}

export function buildLawModel(doc){
  const model={masses:[],limits:[],warnings:[]},a=doc?.siteAnalysis;
  if(!a){model.warnings.push('대지 법규 검사 기준이 없습니다.');return model;}
  const geometry=e=>JSON.stringify({points:e.points,loops:e.loops||[]});
  if((a.sourceGeometry||[]).some(s=>{const e=(doc.entities||[]).find(e=>e?.id===s.id);return !e||geometry(e)!==geometry(s);})){model.warnings.push('기준 경계가 변경되었습니다. 대지 분석을 다시 실행하세요.');return model;}
  if(a.version!==1||a.units!=='mm'||!Array.isArray(a.buildable)||!a.buildable.length||a.buildable.some(p=>!Array.isArray(p.outer)||p.outer.length<3||!p.outer.every(finitePoint)||(p.holes||[]).some(h=>!Array.isArray(h)||h.length<3||!h.every(finitePoint)))){model.warnings.push('법규 검사 기준 좌표 또는 단위가 올바르지 않습니다.');return model;}
  const layers=doc.layers||[],layerById=new Map(layers.map(l=>[l.id,l])),table=doc.model3d?.floorHeights,defaultHeight=table?3000:doc.reviewSettings?.floorHeight??3000,heights=new Map(),excluded=new Set(Object.values(a.sourceIds||{}));
  for(const l of layers)if(heightLayer(l))for(let k=0;k<repeatOf(l);k++){const f=floorOf(l)+k;heights.set(f,Math.max(heights.get(f)||0,l.height??defaultHeight));}
  const layerHeight=(l,f)=>l.height??floorHeight(`${f}F`,table,defaultHeight);
  const baseOf=(l,f)=>{if(Number.isFinite(l.elevation))return l.elevation;if(table)return floorElevation(`${f}F`,defaultHeight,table);let z=0;for(let i=1;i<f;i++)z+=heights.get(i)??defaultHeight;return z;};
  const records=[];
  for(const e of doc.entities||[]){if(!e)continue;const l=layerById.get(e.layer);if(!target(e,l)||l.referenceOnly||excluded.has(e.id)||a.layerIds&&!a.layerIds.includes(e.layer))continue;
    const outer=clean(e.points),holes=(e.loops||[]).map(clean),repeat=repeatOf(l),f=floorOf(l),base=baseOf(l,f)+(e.model3d?.elevation??0),step=e.model3d?.height??(e.height??layerHeight(l,f)*repeat)/repeat;
    if(!triangles(outer).length||holes.some(h=>!triangles(h).length)||!Number.isFinite(base)||!Number.isFinite(step)||step<=0){model.warnings.push(`${e.id}: 유효하지 않은 외곽선 또는 높이로 제외했습니다.`);continue;}
    for(let k=0;k<repeat;k++){
      // Preserve legacy UP total-height splitting; table-driven repeats use each floor.
      const variable=table&&e.height==null&&e.model3d?.height==null,offset=variable?floorElevation(`${f+k}F`,defaultHeight,table)-floorElevation(`${f}F`,defaultHeight,table):k*step,height=variable?layerHeight(l,f+k):step;
      records.push({objectId:e.id,floor:f+k,base:base+offset,top:base+offset+height,outer,holes});
    }
  }
  const tolerance=Number.isFinite(a.tolerancePct)?Math.max(0,Math.min(10,a.tolerancePct))/100:0,errorRegions=[],nominalRegions=[],unknownRegions=[];
  if(Number.isFinite(a.heightLimit)&&a.heightLimit>0){
    errorRegions.push([zPlane(a.heightLimit*(1+tolerance),true)]);nominalRegions.push([zPlane(a.heightLimit,true)]);
    const faces=a.buildable.flatMap(p=>footprintPrisms(p.outer,p.holes||[],a.heightLimit,a.heightLimit+1).map(fs=>fs.find(f=>f.every(p=>p.z===a.heightLimit))));
    model.limits.push({kind:'height',faces:faces.filter(Boolean)});
  }
  if(a.northProfile){const p=a.northProfile,rows=p.setbacks,segs=p.segments||(p.boundary||[]).slice(1).map((q,i)=>[p.boundary[i],q]);
    if(!Array.isArray(rows)||rows.length<2||rows.some((r,i)=>!Number.isFinite(r.height)||!Number.isFinite(r.distance)||r.distance<0||i&&(r.height<=rows[i-1].height||r.distance<rows[i-1].distance))||!Array.isArray(segs)||!segs.length||segs.some(s=>!Array.isArray(s)||s.length!==2||!s.every(finitePoint)||Math.hypot(s[1].x-s[0].x,s[1].y-s[0].y)<EPS)){
      model.warnings.push('정북 사선 기준이 올바르지 않습니다.');unknownRegions.push([]);
    }
    else {
      const points=a.buildable.flatMap(p=>p.outer),centroid={x:points.reduce((s,p)=>s+p.x,0)/points.length,y:points.reduce((s,p)=>s+p.y,0)/points.length},frames=segs.map(s=>northFrame(s[0],s[1],centroid)).filter(Boolean),faces=[];
      const surfaceTop=records.reduce((z,r)=>Math.max(z,r.top),rows[0].height)+3000;
      for(const frame of frames)for(let i=1;i<rows.length;i++){const r0=rows[i-1],r1=rows[i];errorRegions.push(...northRegions(frame,r0,r1,1-tolerance));nominalRegions.push(...northRegions(frame,r0,r1,1));
        if(r0.height<surfaceTop){const end=r1.height<=surfaceTop?r1:{height:surfaceTop,distance:r0.distance+(r1.distance-r0.distance)*(surfaceTop-r0.height)/(r1.height-r0.height)};faces.push(...northSurfaces(frame,r0,end));}}
      model.limits.push({kind:'north',faces});
      model.warnings.push('정북 경계 끝점의 원호는 64각형 내접 근사이며 경계 부근 거리 오차는 최대 0.12%입니다.');
      if(records.some(r=>r.base<rows[0].height||r.top>rows.at(-1).height))model.warnings.push('정북 사선 기준 높이 범위 밖의 부분은 판정하지 않습니다.');
      unknownRegions.push([zPlane(rows[0].height)],[zPlane(rows.at(-1).height,true)]);
    }
  } else model.warnings.push('정북 사선 기준이 없습니다.');
  if(!model.limits.length)model.warnings.push('표시할 법규 한계면이 없습니다.');
  for(const r of records){const parts=[];let pieces=footprintPrisms(r.outer,r.holes,r.base,r.top);pieces=regionPartition(pieces,errorRegions,'violation',parts);pieces=regionPartition(pieces,nominalRegions,'tolerance',parts);pieces=regionPartition(pieces,unknownRegions,'unknown',parts);for(const p of pieces)parts.push({status:'safe',faces:p,volumeM3:volume(p)});model.masses.push({...r,parts,volumeM3:parts.reduce((s,p)=>s+p.volumeM3,0)});}
  return model;
}
