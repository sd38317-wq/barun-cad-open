import { loadOcct } from './occt-loader.js';
import { assertKernel, scoped, prism, booleanShape, fuseShapes, validShape,
  solidBounds, solidVolume } from './occt-kernel.js';

const finite = (v,label) => {
  if (!Number.isFinite(v)) throw new TypeError(label + ' must be a finite number');
  return v;
};
const positive = (v,label) => {
  finite(v,label); if (v <= 0) throw new RangeError(label + ' must be positive');
  return v;
};
const point = (p,label) => {
  if (!Array.isArray(p) || p.length !== 2) throw new TypeError(label + ' must be [x,y]');
  return p.map((v,i) => finite(v,label + '[' + i + ']'));
};
const id = (v,label) => {
  if (typeof v !== 'string' || !v.trim()) throw new TypeError(label + ' needs an id');
  return v;
};
export const signedArea = points => points.reduce((sum,p,i) => {
  const q = points[(i+1)%points.length]; return sum + p[0]*q[1] - q[0]*p[1];
},0)/2;
function intersects(a,b,c,d) {
  const cross = (p,q,r) => (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  const on = (p,q,r) => Math.abs(cross(p,q,r)) < 1e-8 &&
    r[0] >= Math.min(p[0],q[0])-1e-8 && r[0] <= Math.max(p[0],q[0])+1e-8 &&
    r[1] >= Math.min(p[1],q[1])-1e-8 && r[1] <= Math.max(p[1],q[1])+1e-8;
  const x=cross(a,b,c),y=cross(a,b,d),z=cross(c,d,a),w=cross(c,d,b);
  return (x*y<0 && z*w<0) || on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
}
function ring(values,label,clockwise=false) {
  if (!Array.isArray(values) || values.length < 3) throw new TypeError(label+' needs 3 points');
  const result = values.map((p,i) => point(p,label+'['+i+']'));
  for (let i=0;i<result.length;i++) {
    const j=(i+1)%result.length;
    if (Math.hypot(result[i][0]-result[j][0],result[i][1]-result[j][1]) < 1e-6)
      throw new RangeError(label+' has repeated adjacent vertices');
    for (let k=i+1;k<result.length;k++) {
      const l=(k+1)%result.length;
      if (j===k || l===i) continue;
      if (intersects(result[i],result[j],result[k],result[l]))
        throw new RangeError(label+' self intersects');
    }
  }
  const area=signedArea(result);
  if (Math.abs(area)<1e-6) throw new RangeError(label+' has no area');
  if ((area<0)!==clockwise) result.reverse();
  return result;
}
function inside(p,ring) {
  let yes=false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if ((a[1]>p[1])!==(b[1]>p[1]) &&
      p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) yes=!yes;
  }
  return yes;
}
function ringsTouch(a,b) {
  return a.some((p,i)=>b.some((q,j)=>intersects(p,a[(i+1)%a.length],q,b[(j+1)%b.length])));
}
export function wallOutline(wall) {
  const [a,b]=wall.path;
  const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
  positive(length,wall.id+' length');
  const direction=[(b[0]-a[0])/length,(b[1]-a[1])/length];
  const normal=[-direction[1],direction[0]];
  const reference=wall.reference??'center';
  if (!['center','left-face','right-face'].includes(reference))
    throw new TypeError(wall.id+' unsupported wall reference');
  const low=reference==='left-face'?-wall.thickness:reference==='right-face'?0:-wall.thickness/2;
  const high=low+wall.thickness;
  const offset=(p,n)=>[p[0]+normal[0]*n,p[1]+normal[1]*n];
  return { outline:[offset(a,low),offset(b,low),offset(b,high),offset(a,high)],
    length,direction,normal,low,high };
}


/** Match CAD's endpoint mitres without moving source paths or opening offsets.
 * Only unambiguous centre-line pairs with the same vertical span may join.
 * T/interior junctions and all other cases retain their original footprint.
 */
function joinWallOutlines(solids) {
  const endpoints=new Map(),walls=solids.filter(e=>e.kind==='wall');
  for(const wall of walls)for(const [index,p]of wall.path.entries()){
    const key=JSON.stringify([wall.story,...p]);
    if(!endpoints.has(key))endpoints.set(key,[]);
    endpoints.get(key).push({wall,index});
  }
  const intersection=(a,u,b,v)=>{
    const cross=(x,y)=>x[0]*y[1]-x[1]*y[0],den=cross(u,v);
    if(Math.abs(den)<1e-9)return null;
    const t=cross([b[0]-a[0],b[1]-a[1]],v)/den;
    return [a[0]+t*u[0],a[1]+t*u[1]];
  };
  for(const pair of endpoints.values()){
    if(pair.length!==2)continue;
    const [a,b]=pair;
    if(a.wall===b.wall||a.wall.bottom!==b.wall.bottom||a.wall.height!==b.wall.height||
      pair.some(({wall})=>(wall.reference??'center')!=='center'))continue;
    const joint=a.wall.path[a.index];
    // Endpoint degree alone misses a third wall passing through the joint.
    // Only walls whose vertical interiors overlap can form this junction.
    if(walls.some(wall=>{
      if(wall===a.wall||wall===b.wall||wall.story!==a.wall.story||
        Math.min(wall.bottom+wall.height,a.wall.bottom+a.wall.height)<=Math.max(wall.bottom,a.wall.bottom))return false;
      const dx=joint[0]-wall.path[0][0],dy=joint[1]-wall.path[0][1],
        along=dx*wall.direction[0]+dy*wall.direction[1];
      return along>1e-6&&along<wall.length-1e-6&&
        Math.abs(dx*wall.direction[1]-dy*wall.direction[0])<=1e-6;
    }))continue;
    const updates=pair.map(({wall,index},i)=>{
      const other=pair[1-i],p=wall.path[index],u=wall.direction,
        v=other.wall.direction.map(n=>n*(other.index===0?1:-1)),
        n=wall.normal.map(n=>n*wall.thickness/2),
        m=[-v[1]*other.wall.thickness/2,v[0]*other.wall.thickness/2],sign=index===1?1:-1;
      const corners=[1,-1].map(side=>intersection(
        [p[0]+n[0]*side,p[1]+n[1]*side],u,
        [p[0]+m[0]*side*sign,p[1]+m[1]*side*sign],v));
      if(!corners.every(q=>q&&q.every(Number.isFinite)&&
        Math.hypot(q[0]-p[0],q[1]-p[1])<=Math.max(wall.thickness,other.wall.thickness)*10))return null;
      const outline=wall.outline.map(p=>[...p]);
      outline[index===0?3:2]=corners[0];outline[index===0?0:1]=corners[1];
      // A short/acute wall must not invert or cross after modifying either end.
      if(signedArea(outline)<=1e-6)return null;
      try{ring(outline,wall.id+' joined outline');}catch{return null;}
      return {wall,outline};
    });
    if(updates.every(Boolean))for(const {wall,outline}of updates)wall.outline=outline;
  }
}

/** Validate the supported solid subset; preserve source model and report ignored kinds. */
export function normalizeBuildingModel(model,{onProgress}={}) {
  if (model?.format!=='barun-building-model' || model.units!=='mm')
    throw new TypeError('Expected barun-building-model in mm');
  if (!Array.isArray(model.stories) || !model.stories.length || !Array.isArray(model.elements))
    throw new TypeError('Building needs stories and elements arrays');
  const stories=new Map();
  for (const s of model.stories) {
    id(s.id,'story');
    if (stories.has(s.id)) throw new TypeError('Duplicate story '+s.id);
    stories.set(s.id,{...s,elevation:finite(s.elevation,s.id+' elevation'),
      height:positive(s.height,s.id+' height')});
    onProgress?.({phase:'stories',label:(s.name||s.id)+' 층 모델 확인',done:stories.size,total:model.stories.length,unit:'층'});
  }
  const elements=new Map(),solids=[],openings=[],ignored=[];
  for (const e of model.elements) {
    id(e.id,'element');
    if (elements.has(e.id)) throw new TypeError('Duplicate element '+e.id);
    elements.set(e.id,e);
    if (e.kind==='door'||e.kind==='window') { openings.push({...e}); continue; }
    if (!['wall','slab'].includes(e.kind)) { ignored.push({id:e.id,kind:e.kind}); continue; }
    const story=stories.get(e.story);
    if (!story) throw new TypeError(e.id+' unknown story '+e.story);
    const thickness=positive(e.thickness,e.id+' thickness');
    if (e.kind==='wall') {
      if (!Array.isArray(e.path) || e.path.length!==2)
        throw new TypeError(e.id+' requires a straight two-point wall path');
      const path=e.path.map((p,i)=>point(p,e.id+' path '+i));
      const geometry=wallOutline({...e,path,thickness});
      const bottom=story.elevation+finite(e.baseOffset??0,e.id+' baseOffset');
      solids.push({...e,...geometry,path,thickness,bottom,
        height:positive(e.height??story.height,e.id+' height'),holes:[],openings:[]});
    } else {
      if (e.role && !['floor','roof'].includes(e.role)) throw new TypeError(e.id+' invalid slab role');
      const outline=ring(e.outline,e.id+' outline');
      if (e.holes!==undefined&&!Array.isArray(e.holes)) throw new TypeError(e.id+' holes must be an array');
      const holes=(e.holes??[]).map((h,i)=>ring(h,e.id+' hole '+i,true));
      holes.forEach((h,i)=>{
        if (!inside(h[0],outline)||ringsTouch(h,outline)) throw new RangeError(e.id+' hole outside outline');
        holes.slice(0,i).forEach(other=>{
          if (ringsTouch(h,other)||inside(h[0],other)||inside(other[0],h))
            throw new RangeError(e.id+' intersecting/nested slab holes');
        });
      });
      const top=story.elevation+finite(e.topOffset??0,e.id+' topOffset');
      solids.push({...e,thickness,outline,holes,bottom:top-thickness,height:thickness,top});
    }
  }
  const byId=new Map(solids.map(e=>[e.id,e]));
  for (const e of openings) {
    const host=byId.get(e.host);
    if (host?.kind!=='wall') throw new TypeError(e.id+' host must be a wall');
    if (e.story!==undefined&&e.story!==host.story) throw new TypeError(e.id+' story differs from host');
    finite(e.offset,e.id+' offset');
    if (e.offset<0) throw new RangeError(e.id+' negative offset');
    positive(e.width,e.id+' width'); positive(e.height,e.id+' height');
    const sill=finite(e.sill??0,e.id+' sill');
    if (sill<0 || e.offset+e.width>host.length+0.001) throw new RangeError(e.id+' outside host');
    // sill is measured from host story floor, not from an optional raised wall base.
    const bottom=stories.get(host.story).elevation+sill;
    if (bottom<host.bottom-0.001||bottom+e.height>host.bottom+host.height+0.001)
      throw new RangeError(e.id+' vertical range outside wall');
    const [a]=host.path,d=host.direction,n=host.normal;
    const p=(along,across)=>[a[0]+d[0]*along+n[0]*across,a[1]+d[1]*along+n[1]*across];
    host.openings.push({...e,sill,bottom,outline:[
      p(e.offset,host.low-2),p(e.offset+e.width,host.low-2),
      p(e.offset+e.width,host.high+2),p(e.offset,host.high+2)]});
  }
  if (!solids.length) throw new RangeError('No walls or slabs to model');
  joinWallOutlines(solids);
  return {stories:[...stories.values()],solids,ignored};
}

/** Builds exact B-rep prisms and opening cuts. The caller MUST dispose the result. */
export async function buildOcctBuilding(model,{oc: suppliedOc,onProgress}={}) {
  const normalized=normalizeBuildingModel(model,{onProgress});
  const oc=suppliedOc??await loadOcct();
  assertKernel(oc);
  const records=[],viewRecords=[],rawWalls=new Map(),owned=new Set();
  const own=shape=>{owned.add(shape);return shape;};
  const release=shape=>{if(owned.delete(shape))shape.delete();};
  const cutOpenings=(initial,openings)=>{
    let solid=initial;
    for(const opening of openings){
      const tool=prism(oc,opening.outline,[],opening.bottom,opening.height);
      try{
        const next=own(booleanShape(oc,'Cut',solid,tool));
        release(solid);solid=next;
      }finally{tool.delete();}
    }
    return solid;
  };
  try {
    onProgress?.({phase:'solids',label:'벽·슬래브 만들기',done:0,total:normalized.solids.length,unit:'개'});
    for (const e of normalized.solids) {
      let solid=own(prism(oc,e.outline,e.holes,e.bottom,e.height));
      if(e.kind==='wall'){
        // Keep uncut walls until the complete story union has been made. Cutting
        // first lets another wall fill an opening where wall footprints overlap.
        rawWalls.set(e.id,solid);
        solid=own(fuseShapes(oc,[solid]));
      }
      solid=cutOpenings(solid,e.openings??[]);
      validShape(oc,solid,e.id);
      const record={id:e.id,story:e.story,kind:e.kind,role:e.role??null,
        thickness:e.thickness,height:e.height,bottom:e.bottom,
        openings:(e.openings??[]).map(o=>o.id),shape:solid,
        bounds:solidBounds(oc,solid),volumeMm3:solidVolume(oc,solid)};
      records.push(record);
      onProgress?.({phase:'solids',label:(e.kind==='wall'?'벽':'슬래브')+' 형상 완료',done:records.length,total:normalized.solids.length,unit:'개'});
      if(e.kind!=='wall')viewRecords.push(record);
    }
    onProgress?.({phase:'solids',label:'층별 벽을 합치고 개구부를 정리하고 있습니다.'});
    for(const story of normalized.stories){
      const walls=normalized.solids.filter(e=>e.kind==='wall'&&e.story===story.id);
      if(!walls.length)continue;
      let solid=own(fuseShapes(oc,walls.map(e=>rawWalls.get(e.id))));
      solid=cutOpenings(solid,walls.flatMap(e=>e.openings));
      validShape(oc,solid,story.id+' walls');
      viewRecords.push({id:'story-walls:'+story.id,story:story.id,kind:'wall',
        sourceIds:walls.map(e=>e.id),openings:walls.flatMap(e=>e.openings.map(o=>o.id)),
        shape:solid,bounds:solidBounds(oc,solid),volumeMm3:solidVolume(oc,solid)});
    }
    for(const solid of rawWalls.values())release(solid);
    // Rendering uses story wall unions; source records remain independently
    // selectable for element metadata and STEP export compatibility.
    const shape=own(fuseShapes(oc,viewRecords.map(r=>r.shape)));
    validShape(oc,shape,'building');
    const bounds=solidBounds(oc,shape);
    let disposed=false;
    return {oc,shape,records,viewRecords,stories:normalized.stories,ignored:normalized.ignored,bounds,
      assertAlive() {if(disposed)throw new Error('OCCT building is disposed');},
      dispose() {
        if(disposed)return;disposed=true;
        for(const solid of [...owned])release(solid);
      }};
  } catch(error) {for(const solid of [...owned])release(solid);throw error;}
}
export function selectOcctShapes(building,{ids,stories}={}) {
  building.assertAlive();
  if (ids && (!Array.isArray(ids)||!ids.length)) throw new TypeError('ids must be nonempty array');
  if (stories && (!Array.isArray(stories)||!stories.length)) throw new TypeError('stories must be nonempty array');
  for (const value of ids??[]) if (!building.records.some(r=>r.id===value)) throw new RangeError('Unknown solid '+value);
  for (const value of stories??[]) if (!building.stories.some(r=>r.id===value)) throw new RangeError('Unknown story '+value);
  const records=building.records.filter(r=>(!ids||ids.includes(r.id))&&(!stories||stories.includes(r.story)));
  if(!records.length) throw new RangeError('Empty solid selection');
  return records;
}

/** Return STEP bytes; no disk writes. Multiple selected elements are separate STEP roots. */
export function exportOcctStep(building,selection={}) {
  const {oc}=building;
  const records=selectOcctShapes(building,selection);
  const filename='/barun-step-'+(stepSerial++)+'.step';
  try {
    return scoped(s=>{
      const writer=s.own(new oc.STEPControl_Writer());
      writer.SetTolerance(0.001);
      const progress=s.own(new oc.Message_ProgressRange());
      const done=oc.IFSelect_ReturnStatus.IFSelect_RetDone;
      for (const record of records) {
        const status=writer.Transfer(record.shape,oc.STEPControl_StepModelType.STEPControl_AsIs,true,progress);
        if (status!==done) throw new Error('STEP Transfer failed for '+record.id+': '+status);
      }
      if(writer.Write(filename)!==done) throw new Error('STEP Write failed');
      return new Uint8Array(oc.FS.readFile(filename)); // clone before unlink
    });
  } finally {if(oc.FS.readdir('/').includes(filename.slice(1)))oc.FS.unlink(filename);}
}
let stepSerial=1;
