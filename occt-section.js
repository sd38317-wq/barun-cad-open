import { LAYER_STANDARDS } from './layer-standards-data.js';
import { scoped, enumValue, forSubshapes, booleanShape, fuseShapes } from './occt-kernel.js';
const EPS = 0.01; // endpoint joining tolerance, mm (never a shape boolean tolerance)
const dot = (a,b) => a.reduce((s,v,i)=>s+v*b[i],0);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = v => {
  if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))throw new TypeError('Direction needs 3 finite coordinates');
  const n=Math.hypot(...v);if(n<1e-12)throw new RangeError('Zero direction');
  return v.map(x=>x/n);
};
const xy = p => ({x:p[0],y:p[1]});
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const project = (p,frame) => {
  const v=p.map((x,i)=>x-frame.origin[i]);
  return {x:dot(v,frame.x),y:dot(v,frame.y)};
};
export function planFrame(elevation) {
  if(!Number.isFinite(elevation))throw new TypeError('Finite plan elevation required');
  return {origin:[0,0,elevation],x:[1,0,0],y:[0,1,0],normal:[0,0,1]};
}
/** normal points toward viewer; retained matter lies on its negative side. */
export function verticalFrame(start,end,{side='left'}={}) {
  if(![start,end].every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))
    throw new TypeError('Section line requires two [x,y] points');
  if(!['left','right'].includes(side))throw new TypeError('Section side must be left/right');
  let x=unit([end[0]-start[0],end[1]-start[1],0]);
  if(side==='right') x=x.map(v=>-v);
  const y=[0,0,1];
  return {origin:[...start,0],x,y,normal:cross(x,y)};
}
export function elevationFrame(direction) {
  const normal=unit(direction);
  const up=[0,0,1];
  if(Math.abs(dot(normal,up))>1-1e-9)throw new RangeError('Elevation direction must not be vertical');
  const x=unit(cross(up,normal)),y=cross(normal,x);
  return {origin:[0,0,0],x,y,normal};
}
function readPoint(p) { return [p.X(),p.Y(),p.Z()]; }
function curvePoint(curve,t,frame) {
  const p=curve.Value(t);
  try { return project(readPoint(p),frame); } finally { p.delete(); }
}
function chordDistance(p,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
function sampleCurve(curve,first,last,frame,tolerance) {
  const begin=curvePoint(curve,first,frame),end=curvePoint(curve,last,frame),points=[begin];
  const divide=(lo,hi,a,b,depth)=>{
    const middle=(lo+hi)/2,p=curvePoint(curve,middle,frame),
      q=curvePoint(curve,(3*lo+hi)/4,frame),r=curvePoint(curve,(lo+3*hi)/4,frame);
    if(Math.max(chordDistance(p,a,b),chordDistance(q,a,b),chordDistance(r,a,b))>tolerance){
      if(depth>=20||points.length>65536)throw new Error('Curve sampling tolerance could not be achieved');
      divide(lo,middle,a,p,depth+1);divide(middle,hi,p,b,depth+1);
    }else points.push(b);
  };
  divide(first,last,begin,end,0);
  return points;
}
function edgeEntity(oc,edge,frame,tolerance) {
  return scoped(s=>{
    const curve=s.own(new oc.BRepAdaptor_Curve(edge));
    const first=curve.FirstParameter(),last=curve.LastParameter();
    if(![first,last].every(Number.isFinite))throw new Error('Unbounded output edge');
    const type=curve.GetType(),a=curvePoint(curve,first,frame),b=curvePoint(curve,last,frame);
    if(type===enumValue(oc,'GeomAbs_CurveType','GeomAbs_Line'))
      return distance(a,b)>1e-6?{type:'line',points:[a,b]}:null;
    if(type===enumValue(oc,'GeomAbs_CurveType','GeomAbs_Circle')&&Math.abs(last-first)<2*Math.PI-1e-7) {
      const circle=s.own(curve.Circle()),center3=s.own(circle.Location());
      const center=project(readPoint(center3),frame),radius=circle.Radius();
      const mid=curvePoint(curve,(first+last)/2,frame);
      // A true circle in the output plane remains an ARC; tilted circles are tessellated.
      if([a,b,mid].every(p=>Math.abs(distance(p,center)-radius)<1e-5)){
        const angle=p=>((Math.atan2(p.y-center.y,p.x-center.x)*180/Math.PI)%360+360)%360;
        let startAngle=angle(a),endAngle=angle(b);
        const span=(endAngle-startAngle+360)%360,middle=(angle(mid)-startAngle+360)%360;
        if(middle>span)[startAngle,endAngle]=[endAngle,startAngle];
        return {type:'arc',center,radius,startAngle,endAngle};
      }
    }
    const points=sampleCurve(curve,first,last,frame,tolerance);
    const closed=distance(points[0],points.at(-1))<1e-6;
    if(closed)points.pop();
    return {type:'polyline',points,closed};
  });
}
export function occtShapeEntities(oc,shape,frame,{tolerance=0.1}={}) {
  if(!(Number.isFinite(tolerance)&&tolerance>0&&tolerance<=1))throw new RangeError('Curve tolerance must be (0,1] mm');
  const result=[];
  if(shape.IsNull())return result;
  if(!oc.BRepLib.BuildCurves3d(shape))throw new Error('OCCT output 3D curves could not be constructed');
  forSubshapes(oc,shape,'TopAbs_EDGE',generic=>scoped(s=>{
    const edge=s.own(oc.TopoDS.Edge(generic));
    const entity=edgeEntity(oc,edge,frame,tolerance);
    if(entity)result.push(entity);
  }));
  return result;
}
function polyPoints(e) {
  if(e.type!=='arc')return e.points;
  const span=(e.endAngle-e.startAngle+360)%360;
  const step=2*Math.acos(Math.max(-1,Math.min(1,1-0.1/e.radius)))*180/Math.PI;
  const count=Math.max(2,Math.ceil(span/Math.max(0.01,step)));
  return Array.from({length:count+1},(_,i)=>{
    const a=(e.startAngle+span*i/count)*Math.PI/180;
    return {x:e.center.x+e.radius*Math.cos(a),y:e.center.y+e.radius*Math.sin(a)};
  });
}
function area(points) {return points.reduce((s,p,i)=>{
  const q=points[(i+1)%points.length];return s+p.x*q.y-q.x*p.y;
},0)/2;}
function contains(p,points) {
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const a=points[i],b=points[j];
    if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
/** Closed even-odd hatch boundaries; reject open or ambiguous contours instead of inventing fills. */
export function sectionHatchBoundaries(entities) {
  const nodes=[],edges=[],loops=[];
  const node=p=>{
    let i=nodes.findIndex(n=>distance(n.point,p)<=EPS);
    if(i<0){i=nodes.length;nodes.push({point:p,edges:[]});}
    return i;
  };
  for(const e of entities) {
    const points=polyPoints(e);
    if(e.closed){loops.push(points);continue;}
    const a=node(points[0]),b=node(points.at(-1)),index=edges.length;
    edges.push({a,b,points,used:false});nodes[a].edges.push(index);nodes[b].edges.push(index);
  }
  if(nodes.some(n=>n.edges.length!==2))throw new Error('Section contour is open or branching; no safe hatch boundary');
  for(const edge of edges) {
    if(edge.used)continue;
    const loop=[],start=edge.a;let current=start,index=edges.indexOf(edge);
    do {
      const e=edges[index];if(e.used)throw new Error('Invalid section contour traversal');
      e.used=true;const points=e.a===current?e.points:[...e.points].reverse();
      loop.push(...points.slice(0,-1));current=e.a===current?e.b:e.a;
      index=nodes[current].edges.find(i=>!edges[i].used);
    }while(current!==start);
    if(loop.length>=3&&Math.abs(area(loop))>1e-6)loops.push(loop);
  }
  const parents=loops.map((loop,i)=>{
    const candidates=loops.map((p,j)=>({p,j})).filter(({p,j})=>i!==j&&
      Math.abs(area(p))>Math.abs(area(loop))&&contains(loop[0],p));
    candidates.sort((a,b)=>Math.abs(area(a.p))-Math.abs(area(b.p)));
    return candidates[0]?.j??-1;
  });
  const depth=i=>parents[i]<0?0:1+depth(parents[i]);
  return loops.flatMap((loop,i)=>depth(i)%2?[]:[{
    layer:'A-WALL-CONC',outer:area(loop)>0?loop:[...loop].reverse(),
    holes:loops.filter((_,j)=>parents[j]===i).map(h=>area(h)<0?h:[...h].reverse()),
  }]);
}
function layer(name) {
  const data=LAYER_STANDARDS.find(l=>l.name===name);
  if(!data)throw new Error('Unknown standard layer '+name);
  return {...data,id:name,visible:true,locked:false};
}
function unique(entities) {
  const keyPoint=p=>Math.round(p.x/1e-5)+','+Math.round(p.y/1e-5);
  const seen=new Set();
  return entities.filter(e=>{
    let key=e.type+':';
    if(e.type==='line')key+=e.points.map(keyPoint).sort().join(';');
    else if(e.type==='arc')key+=keyPoint(e.center)+':'+e.radius.toFixed(5)+':'+e.startAngle.toFixed(5)+':'+e.endAngle.toFixed(5);
    else key+=e.points.map(keyPoint).join(';');
    if(seen.has(key))return false;seen.add(key);return true;
  });
}
function documentFor(cut,visible,hidden,metadata,hatchBoundaries=[]) {
  let counter=1;
  const assign=(e,kind)=>({...e,id:'occt-'+metadata.kind+'-'+kind+'-'+counter++,layer:kind==='cut'?'A-WALL-CONC':'A-ELEV-VIEW',
    lineweight:kind==='cut'?0.35:0.13,linetype:kind==='hidden'?'HIDDEN':'CONTINUOUS',occtRole:kind});
  const cutEntities=unique(cut);
  // HLR also sees the newly cut top edges. Keep the stronger cut entity once.
  const visibleEntities=unique([...cutEntities,...visible]).slice(cutEntities.length);
  return {version:2,units:'mm',linetypeScale:1,blocks:[],
    layers:[layer('A-WALL-CONC'),layer('A-ELEV-VIEW')],
    entities:[...visibleEntities.map(e=>assign(e,'visible')),...cutEntities.map(e=>assign(e,'cut'))],
    hiddenEntities:unique(hidden).map(e=>assign(e,'hidden')),
    hatchBoundaries,metadata};
}
function hlr(oc,shape,frame,options) {
  return scoped(s=>{
    const origin=s.own(new oc.gp_Pnt(...frame.origin)),normal=s.own(new oc.gp_Dir(...frame.normal)),
      x=s.own(new oc.gp_Dir(...frame.x)),axis=s.own(new oc.gp_Ax2(origin,normal,x)),
      projector=s.own(new oc.HLRAlgo_Projector(axis)),algorithm=s.own(new oc.HLRBRep_Algo());
    algorithm.Add(shape,0);algorithm.Projector(projector);algorithm.Update();algorithm.Hide();
    const filter=s.own(new oc.HLRBRep_HLRToShape(algorithm));
    const read=methods=>methods.flatMap(method=>{
      const output=s.own(filter[method]());
      // HLR filters already output edges in view coordinates; projecting again is wrong.
      return occtShapeEntities(oc,output,planFrame(0),options);
    });
    return {visible:read(['VCompound','Rg1LineVCompound','OutLineVCompound']),
      hidden:read(['HCompound','Rg1LineHCompound','OutLineHCompound'])};
  });
}
function clipBehind(oc,shape,frame) {
  return scoped(s=>{
    const point=s.own(new oc.gp_Pnt(...frame.origin)),normal=s.own(new oc.gp_Dir(...frame.normal)),
      plane=s.own(new oc.gp_Pln(point,normal)),faceBuilder=s.own(new oc.BRepBuilderAPI_MakeFace(plane)),
      face=s.own(faceBuilder.Face()),ref=s.own(new oc.gp_Pnt(...frame.origin.map((v,i)=>v-frame.normal[i]))),
      builder=s.own(new oc.BRepPrimAPI_MakeHalfSpace(face,ref)),halfSpace=s.own(builder.Solid());
    return booleanShape(oc,'Common',shape,halfSpace);
  });
}
/** Use the clipped solid's planar faces, not the edge-only Section result.
 * Section also returns edges on coplanar source faces (e.g. window reveals),
 * which can branch even though the actual cut face has perfectly closed wires.
 * Keep every face/wire separate: touching regions must not merge at a vertex.
 */
function cutFaceGeometry(oc,clipped,frame,options) {
  const cut=[],boundaries=[];
  if(clipped.IsNull())return {cut,boundaries};
  forSubshapes(oc,clipped,'TopAbs_FACE',generic=>scoped(s=>{
    const face=s.own(oc.TopoDS.Face(generic)),surface=s.own(new oc.BRepAdaptor_Surface(face,true));
    if(surface.GetType()!==enumValue(oc,'GeomAbs_SurfaceType','GeomAbs_Plane'))return;
    const plane=s.own(surface.Plane()),{theA:a,theB:b,theC:c,theD:d}=plane.Coefficients();
    if(Math.abs(dot([a,b,c],frame.normal))<1-1e-10||Math.abs(dot([a,b,c],frame.origin)+d)>1e-6)return;
    // A near-parallel source face can pass the normal/origin test at one point.
    // Verify the whole bounded planar face lies on the requested cut plane (mm).
    let vertices=0,onPlane=true;
    forSubshapes(oc,face,'TopAbs_VERTEX',generic=>scoped(t=>{
      const vertex=t.own(oc.TopoDS.Vertex(generic)),point=t.own(oc.BRep_Tool.Pnt(vertex));
      vertices++;
      if(Math.abs(dot(readPoint(point).map((v,i)=>v-frame.origin[i]),frame.normal))>1e-6)onPlane=false;
    }));
    if(!vertices||!onPlane)return;
    const outerWire=s.own(oc.BRepTools.OuterWire(face));
    if(outerWire.IsNull())throw new Error('Cut face has no outer wire');
    let outer;const holes=[];
    forSubshapes(oc,face,'TopAbs_WIRE',wire=>{
      const entities=occtShapeEntities(oc,wire,frame,options),loops=sectionHatchBoundaries(entities);
      if(loops.length!==1||loops[0].holes.length)throw new Error('Cut face wire is not a single closed contour');
      cut.push(...entities);
      if(wire.IsSame(outerWire))outer=loops[0].outer;
      else holes.push([...loops[0].outer].reverse());
    });
    if(!outer)throw new Error('Cut face outer contour was not found');
    boundaries.push({layer:'A-WALL-CONC',outer,holes});
  }));
  return {cut,boundaries};
}
function cutView(building,shape,frame,metadata,options) {
  return scoped(s=>{
    const {oc}=building,clipped=s.own(clipBehind(oc,shape,frame)),
      {cut,boundaries}=cutFaceGeometry(oc,clipped,frame,options),projection=hlr(oc,clipped,frame,options);
    return documentFor(cut,projection.visible,projection.hidden,
      {...metadata,frame,cutFaceCount:boundaries.length},boundaries);
  });
}
export function occtPlan(building,{story,height=1200,...options}={}) {
  building.assertAlive();
  const level=building.stories.find(s=>s.id===story);
  if(!level)throw new RangeError('Unknown plan story '+story);
  if(!(Number.isFinite(height)&&height>0&&height<level.height))throw new RangeError('Plan height must be within story');
  const frame=planFrame(level.elevation+height);
  // Floor selection prevents basements/other floors from leaking into a plan.
  return scoped(s=>{
    const shape=s.own(fuseShapes(building.oc,building.viewRecords.filter(r=>r.story===story).map(r=>r.shape)));
    return cutView(building,shape,frame,{kind:'plan',story,cutElevation:frame.origin[2]},options);
  });
}
export function occtVerticalSection(building,{start,end,side='left',...options}={}) {
  building.assertAlive();
  const frame=verticalFrame(start,end,{side});
  return cutView(building,building.shape,frame,{kind:'section',start,end,side},options);
}
/** direction is the vector from model toward viewer, e.g. south=[0,-1,0]. */
export function occtElevation(building,{direction=[0,-1,0],...options}={}) {
  building.assertAlive();
  const frame=elevationFrame(direction),projection=hlr(building.oc,building.shape,frame,options);
  return documentFor([],projection.visible,projection.hidden,{kind:'elevation',direction,frame});
}
