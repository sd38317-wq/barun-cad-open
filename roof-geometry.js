// Pure roof geometry. Coordinates and heights are millimetres; no drawing state.
// pitch: percent (number or {percent}), or {height} for total rise in mm.
// ridgeDirection: degrees from +X, 'x'/'y', or {x,y}; default longest edge.
// Concave hips use a finite-edge square-wavefront (straight skeleton) approximation
// for orthogonal outlines, including rotated L/U plans. Other concave plans fall back.
const EPS = 1e-7;
const MAX_VERTICES = 64, MAX_CELLS = 12000, MAX_WORK = 250000;
const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const area = ps => ps.reduce((s,p,i) => {const q=ps[(i+1)%ps.length];return s+p.x*q.y-p.y*q.x;},0)/2;
const value = (f,p) => f.x*p.x+f.y*p.y+f.c;
const subtract = (a,b) => ({x:a.x-b.x,y:a.y-b.y,c:a.c-b.c});
const near = (a,b) => Math.hypot(a.x-b.x,a.y-b.y)<EPS;

function clean(points) {
  if (!Array.isArray(points)) throw Error('outline must be an array');
  if (points.length>MAX_VERTICES+1) throw Error('outline vertex limit (64)');
  const ps=[];
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw Error('non-finite outline');
    if (!ps.length || !near(p,ps.at(-1))) ps.push({x:p.x,y:p.y});
  }
  if (ps.length>1 && near(ps[0],ps.at(-1))) ps.pop();
  let changed=true;
  while (changed && ps.length>=3) {
    changed=false;
    for (let i=0;i<ps.length;i++) {
      const a=ps[(i+ps.length-1)%ps.length],b=ps[i],c=ps[(i+1)%ps.length];
      if (Math.abs(cross(a,b,c))<=EPS*Math.max(1,Math.hypot(c.x-a.x,c.y-a.y)) &&
          (b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y)>=0) {
        ps.splice(i,1);changed=true;break;
      }
    }
  }
  return ps;
}

function simple(ps) {
  for (let i=0;i<ps.length;i++) for (let j=i+1;j<ps.length;j++) {
    if (j===i+1 || i===0 && j===ps.length-1) continue;
    const a=ps[i],b=ps[(i+1)%ps.length],c=ps[j],d=ps[(j+1)%ps.length];
    const touches=(p,q,r) => Math.abs(cross(p,q,r))<EPS &&
      r.x>=Math.min(p.x,q.x)-EPS && r.x<=Math.max(p.x,q.x)+EPS &&
      r.y>=Math.min(p.y,q.y)-EPS && r.y<=Math.max(p.y,q.y)+EPS;
    if (touches(a,b,c)||touches(a,b,d)||touches(c,d,a)||touches(c,d,b) ||
        cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0) return false;
  }
  return true;
}

function triangulate(ps) {
  const remaining=ps.slice(),out=[];
  while (remaining.length>3) {
    let found=false;
    for (let i=0;i<remaining.length;i++) {
      const a=remaining[(i+remaining.length-1)%remaining.length],b=remaining[i],c=remaining[(i+1)%remaining.length];
      if (cross(a,b,c)<=EPS) continue;
      if (remaining.some(p=>p!==a&&p!==b&&p!==c&&cross(a,b,p)>=-EPS&&cross(b,c,p)>=-EPS&&cross(c,a,p)>=-EPS)) continue;
      out.push([a,b,c]);remaining.splice(i,1);found=true;break;
    }
    if (!found) throw Error('outline triangulation failed');
  }
  if (remaining.length===3 && cross(...remaining)>EPS) out.push(remaining);
  return out;
}

// Clip a convex polygon to f(p)>=0. Every resulting cell stays convex.
function clip(ps,f) {
  if (!ps.length) return [];
  const out=[];
  for (let i=0;i<ps.length;i++) {
    const a=ps[i],b=ps[(i+1)%ps.length],va=value(f,a),vb=value(f,b);
    if (va>=0) out.push(a);
    if ((va<0 && vb>0)||(va>0 && vb<0)) {
      const t=va/(va-vb);out.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
    }
  }
  return out.length>=3 && area(out)>EPS ? out : [];
}
const inverse = f => ({x:-f.x,y:-f.y,c:-f.c});
function edges(ps) {
  return ps.map((a,i)=>{
    const b=ps[(i+1)%ps.length],length=Math.hypot(b.x-a.x,b.y-a.y),u={x:(b.x-a.x)/length,y:(b.y-a.y)/length};
    return {a,b,length,u,n:{x:-u.y,y:u.x}};
  });
}

function offset(ps,d) {
  if (!d) return ps;
  const es=edges(ps);
  const result=es.map((e,i)=>{
    const prev=es[(i+es.length-1)%es.length];
    const a={x:e.a.x-e.n.x*d,y:e.a.y-e.n.y*d},b={x:e.a.x-prev.n.x*d,y:e.a.y-prev.n.y*d};
    const det=prev.u.x*e.u.y-prev.u.y*e.u.x;
    if (Math.abs(det)<EPS) throw Error('overhang has parallel adjoining edges');
    const t=((a.x-b.x)*e.u.y-(a.y-b.y)*e.u.x)/det;
    const p={x:b.x+prev.u.x*t,y:b.y+prev.u.y*t};
    if (!Number.isFinite(p.x+p.y) || Math.hypot(p.x-e.a.x,p.y-e.a.y)>d*100) throw Error('overhang miter is too long');
    return p;
  });
  if (!simple(result) || area(result)<=EPS) throw Error('overhang changes outline topology');
  return result;
}

function direction(es,requested) {
  let u;
  if (requested==null) u=es.reduce((a,b)=>a.length>=b.length?a:b).u;
  else if (requested==='x') u={x:1,y:0};
  else if (requested==='y') u={x:0,y:1};
  else if (typeof requested==='number' && Number.isFinite(requested)) u={x:Math.cos(requested*Math.PI/180),y:Math.sin(requested*Math.PI/180)};
  else if (requested && Number.isFinite(requested.x) && Number.isFinite(requested.y)) u=requested;
  if (!u || Math.hypot(u.x,u.y)<EPS) throw Error('invalid ridge direction');
  const length=Math.hypot(u.x,u.y);return {x:u.x/length,y:u.y/length};
}

function minPlanes(seeds,planes) {
  const cells=[];
  for (const f of planes) for (const seed of seeds) {
    let ps=seed;
    for (const other of planes) {if (other!==f) ps=clip(ps,subtract(other,f));if (!ps.length) break;}
    if (ps.length) cells.push({ps,f});
  }
  return cells;
}

function concaveHip(seeds,es) {
  let cells=[],work=0;
  const boundedClip=(ps,f)=>{
    work+=ps.length;
    if(work>MAX_WORK) throw Error('hip approximation complexity limit');
    return clip(ps,f);
  };
  const emit=(out,ps,f)=>{
    if (ps.length) out.push({ps,f});
    if (out.length>MAX_CELLS || ++work>MAX_WORK) throw Error('hip approximation complexity limit');
  };
  const dominant=(out,ps,planes)=>{
    for (const f of planes) {
      let part=ps;
      for (const other of planes) {if(other!==f) part=boundedClip(part,subtract(f,other));if(!part.length) break;}
      emit(out,part,f);
    }
  };
  for (const e of es) {
    // Distance to a finite edge in its orthogonal square metric, max of four planes.
    const c=e.n.x*e.a.x+e.n.y*e.a.y,t=e.u.x*e.a.x+e.u.y*e.a.y;
    const planes=[{...e.n,c:-c},{x:-e.n.x,y:-e.n.y,c},
      {x:-e.u.x,y:-e.u.y,c:t},{...e.u,c:-t-e.length}];
    if (!cells.length) {for(const ps of seeds) dominant(cells,ps,planes);continue;}
    const next=[];
    for (const {ps,f} of cells) {
      let remaining=ps;
      // Keep old min wherever ANY branch of this edge is above it.
      for (const q of planes) {
        const delta=subtract(q,f),vs=remaining.map(p=>value(delta,p));
        if (vs.every(v=>v>=-EPS)) {emit(next,remaining,f);remaining=[];break;}
        if (vs.every(v=>v<=EPS)) continue;
        emit(next,boundedClip(remaining,delta),f);remaining=boundedClip(remaining,inverse(delta));
        if (!remaining.length) break;
      }
      if (remaining.length) dominant(next,remaining,planes);
    }
    cells=next;
  }
  return cells;
}

function result(cells,origin,type,scale=1,reason=null,approximation=null) {
  const triangles=[],faces=[],byPlane=new Map();let maxHeight=0;
  for (const {ps,f} of cells) {
    const key=[f.x,f.y,f.c].map(v=>Math.round(v*1e7)).join(':');
    let face=byPlane.get(key);
    if (!face) {face={id:faces.length,triangles:[]};faces.push(face);byPlane.set(key,face);}
    const vertices=ps.map(p=>{
      const z=Math.max(0,value(f,p)*scale);maxHeight=Math.max(maxHeight,z);
      return {x:p.x+origin.x,y:p.y+origin.y,z};
    });
    for (let i=1;i<vertices.length-1;i++) {
      if (cross(vertices[0],vertices[i],vertices[i+1])<=EPS) continue;
      const triangle=[vertices[0],vertices[i],vertices[i+1]];
      face.triangles.push(triangle);triangles.push(triangle);
    }
  }
  return {type,triangles,faces:faces.filter(f=>f.triangles.length),maxHeight,fallback:reason!==null,reason,approximation};
}

/** Returns {triangles, faces, maxHeight, type, fallback, reason, approximation}.
 * faces groups coplanar triangles (including disconnected pieces).
 * A triangle is three {x,y,z} vertices, CCW from above; z=0 is eave level.
 * Invalid/unsupported input returns a triangulated flat outline when possible;
 * an untriangulatable/zero-area boundary returns no triangles, with a reason.
 * Work is bounded and happens only when called (3D review, never 2D editing).
 */
export function roofGeometry(outline,options={}) {
  let ps=[],seeds=[],origin={x:0,y:0};
  const flat=reason=>result(seeds.map(ps=>({ps,f:{x:0,y:0,c:0}})),origin,'flat',1,reason);
  try {
    ps=clean(outline);
    if (ps.length<3) throw Error('degenerate outline: fewer than three corners');
    if (ps.length>MAX_VERTICES) throw Error('outline vertex limit (64)');
    origin={...ps[0]};ps=ps.map(p=>({x:p.x-origin.x,y:p.y-origin.y}));
    if (!simple(ps)) throw Error('self-intersecting outline');
    if (Math.abs(area(ps))<=EPS) throw Error('degenerate outline: zero area');
    if (area(ps)<0) ps.reverse();
    seeds=triangulate(ps);
    const {type='flat',pitch=30,overhang=0,ridgeDirection}=options;
    if (!['flat','gable','hip','shed'].includes(type)) throw Error('unsupported roof type');
    if (!Number.isFinite(overhang)||overhang<0) throw Error('overhang must be nonnegative mm');
    const expanded=offset(ps,overhang),expandedSeeds=triangulate(expanded),es=edges(expanded);
    let cells;
    if (type==='flat') cells=expandedSeeds.map(ps=>({ps,f:{x:0,y:0,c:0}}));
    else if (type==='gable'||type==='shed') {
      const u=direction(edges(ps),ridgeDirection),n={x:-u.y,y:u.x};
      const projections=expanded.map(p=>n.x*p.x+n.y*p.y),lo=Math.min(...projections),hi=Math.max(...projections);
      const a={...n,c:-lo},b={x:-n.x,y:-n.y,c:hi};
      cells=type==='gable'?minPlanes(expandedSeeds,[a,b]):expandedSeeds.map(ps=>({ps,f:a}));
    } else if (expanded.every((p,i)=>cross(p,expanded[(i+1)%expanded.length],expanded[(i+2)%expanded.length])>=-EPS)) {
      cells=minPlanes(expandedSeeds,es.map(e=>({...e.n,c:-e.n.x*e.a.x-e.n.y*e.a.y})));
    } else {
      const u=es[0].u;
      if (!es.every(e=>Math.min(Math.abs(u.x*e.u.y-u.y*e.u.x),Math.abs(u.x*e.u.x+u.y*e.u.y))<EPS))
        throw Error('concave hip requires an orthogonal outline');
      cells=concaveHip(expandedSeeds,es);
    }
    let scale=0;
    if (type!=='flat') {
      const rise=options.height ?? (typeof pitch==='object' && pitch!==null ? pitch.height : undefined);
      const percent=typeof pitch==='number'?pitch:pitch?.percent;
      if (rise!==undefined) {
        if (!Number.isFinite(rise)||rise<0) throw Error('roof height must be nonnegative mm');
        const run=Math.max(...cells.flatMap(({ps,f})=>ps.map(p=>value(f,p))));
        if (!(run>EPS)) throw Error('degenerate roof run');
        scale=rise/run;
      } else {
        if (!Number.isFinite(percent)||percent<0) throw Error('pitch must be nonnegative percent');
        scale=percent/100;
      }
    }
    const out=result(cells,origin,type,scale,null,type==='hip'&&cells.length &&
      expanded.some((p,i)=>cross(p,expanded[(i+1)%expanded.length],expanded[(i+2)%expanded.length])<-EPS)?'orthogonal-square-wavefront':null);
    if (!out.triangles.length || !out.triangles.every(t=>t.every(p=>Number.isFinite(p.x+p.y+p.z)))) throw Error('non-finite or empty roof');
    return out;
  } catch (error) {return flat(error.message);}
}
