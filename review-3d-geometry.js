import * as G from './geometry.js';
import ClipperLib from './review-3d-clipper.js';

const FLOOR_RE=/(?:^|[ _-])(\d+)F(?:$|[ _-])/i;
export function floorName(name){
 const match=String(name??'').match(FLOOR_RE),n=match?Number(match[1]):0;
 return Number.isSafeInteger(n)&&n>0?`${n}F`:null;
}
export function floorHeight(name,table={},fallback=3000){
 const value=table?.[floorName(name)];
 return Number.isFinite(value)&&value>0?value:fallback;
}
export function floorElevation(name,height=3000,floorHeights={}){
 const floor=floorName(name);if(!floor)return 0;
 const n=Number(floor.slice(0,-1));let z=(n-1)*height;
 // Sparse tables need no loop over every intervening floor.
 for(const [key,value] of Object.entries(floorHeights||{}))if(floorName(key)===key&&Number(key.slice(0,-1))<n&&Number.isFinite(value)&&value>0)z+=value-height;
 return z;
}

const visible=layer=>layer&&layer.visible!==false&&!layer.frozen&&!layer.hidden;
const closed=e=>['rectangle','rect'].includes(e.type)||e.type==='polyline'&&e.closed;
const perimeter=points=>points.reduce((sum,p,i)=>sum+G.dist(p,points[(i+1)%points.length]),0);
function wallOutline(e){
 if(!e.points?.[1]||!(e.thickness>0)||G.dist(...e.points.slice(0,2))<G.EPS)return null;
 // Keep real mitred joins, but not door/window cuts.
 return G.wallPolygons({...e,openings:[],openingLinks:{}})[0]||null;
}
function unionFootprints(rings,fillInterior){
 if(!rings.length)return [];
 const paths=[];
 const add=(points,outer)=>{
  if(points?.length<3)return;
  const path=points.map(p=>({X:Math.round(p.x*1000),Y:Math.round(p.y*1000)}));
  if(ClipperLib.Clipper.Orientation(path)!==outer)path.reverse();paths.push(path);
 };
 for(const ring of rings){add(ring.points,true);if(!fillInterior)for(const hole of ring.holes||[])add(hole,false);}
 const clipper=new ClipperLib.Clipper(),tree=new ClipperLib.PolyTree();
 clipper.AddPaths(paths,ClipperLib.PolyType.ptSubject,true);
 if(!clipper.Execute(ClipperLib.ClipType.ctUnion,tree,ClipperLib.PolyFillType.pftNonZero,ClipperLib.PolyFillType.pftNonZero))throw Error('바닥판 외곽 합집합 계산 실패');
 const points=node=>node.Contour().map(p=>({x:p.X/1000,y:p.Y/1000})),result=[];
 const visit=node=>{
  for(const child of node.Childs()){
   if(!child.IsHole())result.push({points:points(child),holes:fillInterior?[]:child.Childs().filter(h=>h.IsHole()).map(points)});
   // A wall ring's inside is the floor, rather than a hole or another component.
   if(!fillInterior)visit(child);
  }
 };
 visit(tree);return result;
}

/** Rendering-only footprint calculation; no entities are added or changed. */
export function floorFootprints(doc,{inferLayerWalls=()=>[]}={}){
 const layers=new Map((doc.layers||[]).map(l=>[l.id,l])),byFloor=new Map(),flat=[];
 const group=floor=>{if(!byFloor.has(floor))byFloor.set(floor,{outlines:[],walls:[],tolerance:300});return byFloor.get(floor);};
 const visit=(e,parent)=>{
  const layer=layers.get(e.layer)||parent;if(!visible(layer)||e.hidden||e.model3d?.kind==='roof')return;
  if(e.type==='block'){
   if(['DOOR','WINDOW','STAIR'].includes(e.parameters?.kind))return;
   const source=e.sharedBlock?G.resolveSharedDrawingReference(doc,e):e;
   for(const child of source.entities||[])visit(child,layer);return;
  }
  const floor=floorName(layer.name);if(!floor)return;
  if(!e.libraryCommand&&!e.model3d)flat.push({...e,layer:layer.id});
  if(closed(e)&&e.points?.length>=3){
   const ring={points:e.points,holes:e.loops||[]},width=2*G.polygonArea(e.points)/(perimeter(e.points)||1);
   // Thin closed wall strips belong to the wall union, broad rings are outlines.
   group(floor)[width>600?'outlines':'walls'].push(ring);
  }else if(e.type==='wall'){
   const points=wallOutline(e);if(points){group(floor).walls.push({points,holes:[]});group(floor).tolerance=Math.max(group(floor).tolerance,e.thickness/2+.001);}
  }
 };
 doc.entities.forEach(e=>visit(e));
 for(const layer of layers.values()){
  const floor=floorName(layer.name);if(!floor||!visible(layer))continue;
  for(const points of inferLayerWalls(flat,new Set([layer.id]))||[])if(points.length>=3)group(floor).walls.push({points,holes:[]});
 }
 const insideOrOn=(p,ring,tolerance=G.EPS)=>G.inside(p,ring)||G.segments({points:ring,closed:true}).some(([a,b])=>G.distanceToSegment(p,a,b)<=tolerance);
 const covers=(outer,inner,tolerance=G.EPS)=>inner.points.every(p=>insideOrOn(p,outer.points,tolerance));
 return [...byFloor].sort((a,b)=>parseInt(a[0])-parseInt(b[0])).flatMap(([floor,{outlines,walls,tolerance}])=>{
  // Ignore room contours contained by a larger building outline. Overlapping
  // and separate building outlines still participate in the exact union.
  const wallExteriors=unionFootprints(walls,true);
  const exterior=outlines.filter((ring,i)=>!outlines.some((other,j)=>i!==j&&G.polygonArea(other.points)>G.polygonArea(ring.points)&&covers(other,ring))&&!wallExteriors.some(w=>covers(w,ring)&&!covers(ring,w,tolerance)));
  if(!exterior.length)return wallExteriors.map(ring=>({floor,...ring}));
  // A closed outline for one building must not suppress another wall building.
  const overlaps=(a,b)=>a.points.some(p=>insideOrOn(p,b.points))||b.points.some(p=>insideOrOn(p,a.points))||G.intersections({type:'polyline',closed:true,points:a.points},{type:'polyline',closed:true,points:b.points}).length>0;
  const uncovered=wallExteriors.filter(w=>!exterior.some(o=>overlaps(o,w)));
  return unionFootprints([...exterior,...uncovered],false).map(ring=>({floor,...ring}));
 });
}
