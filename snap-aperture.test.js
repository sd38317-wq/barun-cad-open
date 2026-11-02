import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import * as G from './geometry.js';
import {snapIntersections} from './snap-intersections.js';
import {DrawingEngine} from './engine.js';

const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('function snap('),source.indexOf('// 직교(F8)'));
function run(entities,orthogonalInput=point=>point){
  const radii=[];
  const context={G,scale:1,points:[],mode:'LINE',orthogonalInput,
    num:()=>16,nearby:()=>entities,
    $:id=>({checked:['osnap','snap-end','snap-intersection'].includes(id)}),
    snapIntersections:(near,curves,p,r)=>{radii.push(r);return snapIntersections(near,curves,p,r);}};
  vm.createContext(context);vm.runInContext(body,context);
  return {point:context.snap({x:0,y:0}),radii};
}
const line=(a,b)=>({type:'line',points:[a,b]});
const p=(x,y)=>({x,y});
test('named anchor bounds intersection search without losing a closer crossing',()=>{
  const result=run([line(p(1,0),p(10,0)),line(p(.5,-10),p(.5,10)),line(p(-10,0),p(10,0))]);
  assert.equal(result.radii[0],1);
  assert.equal(result.point.x,.5);assert.equal(result.point.y,0);assert.equal(result.point.label,'교차점');
});
test('equal-distance crossing does not replace the earlier endpoint',()=>{
  const result=run([line(p(1,0),p(10,0)),line(p(-1,-10),p(-1,10)),line(p(-10,0),p(10,0))]);
  assert.equal(result.point.x,1);assert.equal(result.point.label,'끝점');
});
test('exact object anchor remains eligible despite ortho projection',()=>{
  const result=run([line(p(0,.2),p(0,10)),line(p(2,-10),p(2,10)),line(p(-10,0),p(10,0))],point=>({...point,y:0}));
  assert.equal(result.radii[0],.2);
  assert.equal(result.point.x,0);assert.equal(result.point.y,.2);
});

test('one aperture query per candidate preserves reduced-distance midpoint snaps',()=>{
 const entities=[line(p(1,0),p(10,0)),line(p(.4,-10),p(.4,10)),line(p(-10,0),p(10,0)),
  {type:'polyline',points:Array.from({length:300},(_,i)=>p(i-150,5)),closed:true}];
 let calls=0;
 const ctx={G:{...G,snapGeometry:(...args)=>{calls++;return G.snapGeometry(...args);}},scale:1,points:[],mode:'LINE',orthogonalInput:q=>q,
  num:()=>16,nearby:()=>entities,snapIntersections,$:id=>({checked:['osnap','snap-end','snap-mid','snap-intersection'].includes(id)})};
 vm.createContext(ctx);vm.runInContext(body,ctx);
 const result=ctx.snap(p(0,0));assert.equal(result.x,0);assert.equal(result.y,0);assert.equal(result.label,'중점');
 assert.equal(calls,3,'one query per visited entity; exact midpoint stops before the fourth');
});

test('reused aperture segments preserve closer intersections after an endpoint shrinks the aperture',()=>{
 const entities=[line(p(1,0),p(10,0)),line(p(.4,-10),p(.4,12)),line(p(-10,.2),p(12,.2)),
  {type:'polyline',points:Array.from({length:300},(_,i)=>p(i-150,.8)),closed:true}];
 let calls=0;
 const ctx={G:{...G,snapGeometry:(...args)=>{calls++;return G.snapGeometry(...args);}},scale:1,points:[],mode:'LINE',orthogonalInput:q=>q,
  num:()=>16,nearby:()=>entities,snapIntersections,$:id=>({checked:['osnap','snap-end','snap-mid','snap-intersection'].includes(id)})};
 vm.createContext(ctx);vm.runInContext(body,ctx);
 const result=ctx.snap(p(0,0));assert.ok(Math.abs(result.x-.4)<1e-10);assert.ok(Math.abs(result.y-.2)<1e-10);assert.equal(result.label,'교차점');
 assert.equal(calls,entities.length,'all candidates, including indexed geometry, queried once');
});

test('named-anchor support rejection preserves snaps against the unfiltered path',()=>{
 const entities=[line(p(.7,.2),p(8,9)),line(p(-100,0),p(1e10,0)),
  ...Array.from({length:160},(_,i)=>({type:'polyline',closed:i%2===0,points:Array.from({length:i%12+2},(_,j)=>p(i*3+j,Math.sin(j+i)*20))})),
  {type:'arc',center:p(5,5),radius:10,startAngle:5,endAngle:320}];
 const make=geometry=>{const ctx={G:geometry,scale:1,points:[p(-5,10)],mode:'LINE',orthogonalInput:q=>q,num:()=>16,nearby:()=>entities,snapIntersections,$:id=>({checked:id==='osnap'||id.startsWith('snap-')})};vm.createContext(ctx);vm.runInContext(body,ctx);return ctx;};
 const optimized=make(G),reference=make({...G,snapGeometryMayContain:()=>true});
 for(let i=0;i<150;i++){const cursor=p((i*37)%450-10,(i*13)%40-20);assert.equal(JSON.stringify(optimized.snap(cursor)),JSON.stringify(reference.snap(cursor)));}
 const extended=line(p(0,0),p(1e10,0));assert.equal(G.snapGeometryMayContain(extended,p(-5,0),.1),true);
 const points=[p(100,100),p(101,101)],e={type:'line',points};assert.equal(G.snapGeometryMayContain(e,p(0,0),1),false);
 e.points=[p(-1,0),p(1,0)];assert.equal(G.snapGeometryMayContain(e,p(0,0),1),true);
 assert.equal(G.snapGeometryMayContain({type:'rectangle',points:[p(1,0)]},p(0,0),1),true,'touching bounds remain eligible');
 assert.equal(G.snapGeometryMayContain(e,p(0,0),NaN),true,'invalid query falls back');
 assert.equal(G.snapGeometryMayContain({type:'line',points:[p(NaN,0),p(1,0)]},p(0,0),1),true,'invalid geometry falls back');
});

test('aperture pair allocation preserves exhaustive order, point identity and degenerate closing edges',()=>{
 for(const count of [0,1,2,255,300])for(const type of ['line','polyline','rectangle','hatch','custom'])for(const closed of [false,true]){
  const points=Array.from({length:count},(_,i)=>p(i%17-8,i%5-2));
  const e={type,points,closed},cursor=p(0,0),r=2;
  const expected=G.segments(e).filter(([a,b])=>a&&b&&Math.min(a.x,b.x)-Math.abs(a.x-b.x)*1e-9<=r&&Math.max(a.x,b.x)+Math.abs(a.x-b.x)*1e-9>=-r&&Math.min(a.y,b.y)-Math.abs(a.y-b.y)*1e-9<=r&&Math.max(a.y,b.y)+Math.abs(a.y-b.y)*1e-9>=-r);
  const actual=G.snapGeometry(e,cursor,r).segments;
  assert.deepEqual(actual,expected);
  for(let i=0;i<actual.length;i++){assert.equal(actual[i][0],expected[i][0]);assert.equal(actual[i][1],expected[i][1]);}
  const again=G.snapGeometry(e,cursor,r).segments;
  for(let i=0;i<again.length;i++)assert.notEqual(actual[i],again[i],'pairs must not retain per-call clip masks');
 }
});

test('dense polyline snap geometry preserves exact nearby vertices, closing edges and original order',()=>{
 const points=Array.from({length:12000},(_,i)=>p(i*10,Math.sin(i/7)*30));
 const entity={type:'polyline',points,closed:true};
 for(const cursor of [p(5000,0),p(635,8),p(119990,points.at(-1).y)]){
  const local=G.snapGeometry(entity,cursor,16),all=G.segments(entity);
  const exact=all.filter(s=>G.distanceToSegment(cursor,...s)<16);
  for(const s of exact)assert.ok(local.segments.some(t=>t[0]===s[0]&&t[1]===s[1]));
  assert.deepEqual(local.points.filter(q=>G.dist(q,cursor)<16),points.filter(q=>G.dist(q,cursor)<16));
  assert.ok(local.segments.length<30,'spatial query must not return all 12000 segments');
 }
 const translated=G.translate(entity,1000000,0);
 assert.equal(G.snapGeometry(translated,p(5000,0),16).points.length,0);
 assert.ok(G.snapGeometry(entity,points[500],16).points.length>0,'UNDO original remains valid');
 entity.points=points.map(q=>G.add(q,p(2000000,0)));
 assert.equal(G.snapGeometry(entity,p(5000,0),16).points.length,0,'replaced point array invalidates index');
});

test('dense polyline indexed snaps match exhaustive geometry for every snap option, including clipping',()=>{
 const entities=[{type:'polyline',closed:true,points:Array.from({length:1200},(_,i)=>p(i*2,40*Math.sin(i/9))),clipMasks:[{points:[p(-5,-60),p(1500,-60),p(1500,60),p(-5,60)]}]},
  line(p(0,2),p(2500,2)),{type:'circle',center:p(300,0),radius:40},
  {type:'arc',center:p(450,0),radius:100,startAngle:10,endAngle:280}];
 let seed=17;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
 for(const enabled of [['end'],['mid'],['nearest'],['intersection'],['perpendicular'],['tangent'],['end','mid','center','quadrant','intersection','nearest','perpendicular','tangent']]){
  const make=geometry=>{const ctx={G:geometry,scale:1,points:[p(300,100)],mode:'LINE',orthogonalInput:q=>q,num:()=>16,nearby:()=>entities,snapIntersections,$:id=>({checked:id==='osnap'||enabled.some(n=>id==='snap-'+n)})};vm.createContext(ctx);vm.runInContext(body,ctx);return ctx;};
  const indexed=make(G),exhaustive=make({...G,snapGeometry:v=>({points:v.points||[],segments:G.segments(v)})});
  for(let i=0;i<35;i++){const cursor=p(random()*2400,random()*100-50);assert.equal(JSON.stringify(indexed.snap(cursor)),JSON.stringify(exhaustive.snap(cursor)),enabled.join('/')+' '+JSON.stringify(cursor));}
 }
});

test('nested small block snap queries reuse the exact primitive index',()=>{
 const entity={type:'block',entities:[{type:'block',entities:Array.from({length:500},(_,i)=>line(p(i*10,0),p(i*10,10)))}]};
 const box={minX:99,minY:4,maxX:101,maxY:6};
 const first=G.queryEntityPrimitives(entity,box),second=G.queryEntityPrimitives(entity,box);
 assert.equal(first.length,1);assert.equal(first[0],second[0],'cached primitive identity avoids repeated nested flattening');
 entity.entities=[line(p(9000,0),p(9000,10))];
 assert.equal(G.queryEntityPrimitives(entity,box).length,0);
});

test('PER broad phase preserves the existing endpoint parameter tolerance',()=>{
 for(const count of [3,300]){
  const points=[p(0,0),p(1e10,0),p(-10,100),...Array.from({length:count-3},(_,i)=>p(-10-i,100))];
  const entity={type:'polyline',points},ctx={G,scale:4,points:[p(-5,10)],mode:'LINE',orthogonalInput:q=>q,num:()=>16,nearby:()=>[entity],snapIntersections,$:id=>({checked:['osnap','snap-perpendicular'].includes(id)})};
  vm.createContext(ctx);vm.runInContext(body,ctx);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.snap(p(-5,0)))),{x:-5,y:0,label:'수직점',snapped:true});
 }
});

test('display-collapsed shared and nested blocks retain exact snap geometry without altering display LOD',()=>{
 const doc={layers:[{id:'0',name:'0',visible:true,color:'#fff'},{id:'hidden',name:'hidden',visible:false}],entities:[{id:'ref',type:'block',layer:'0',sharedBlock:'b',position:p(50,20),scale:1,rotation:0}],sharedBlocks:{b:{origin:p(0,0),entities:[{...line(p(0,0),p(2,0)),layer:'0'},{...line(p(0,5),p(2,5)),layer:'hidden'}]}}};
 G.prepareSharedDrawingReferences(doc);
 const display=G.visibleEntities(doc,{inPlace:true,lodScale:.01,lodPixels:36})[0];assert.equal(display._lodCollapsed,true);
 const exact=G.preciseSnapBlock(doc,display),box={minX:49,minY:19,maxX:53,maxY:26};
 const parts=G.queryEntityPrimitives(exact,box);assert.equal(parts.length,1);assert.deepEqual(parts[0].points,[p(50,20),p(52,20)]);
 const ctx={G,engine:{doc},visible:()=>[display],sceneRevision:1,visibleGeneration:1,display};vm.createContext(ctx);
 const nearbyBody=source.slice(source.indexOf('function nearby('),source.indexOf('/* 집기 색인을'));
 vm.runInContext(nearbyBody+'\nnearby.objects=G.spatialIndex([display]);nearby.objectsRevision=1;nearby.objectsGeneration=1;',ctx);
 const throughApp=ctx.nearby(p(50,20),1,true);assert.equal(throughApp.length,2);assert.equal(throughApp[0].type,'block');assert.deepEqual(throughApp[0].position,p(50,20));assert.deepEqual(throughApp[1].points,[p(50,20),p(52,20)]);
 assert.equal(display._lodCollapsed,true);assert.equal(doc.entities[0].entities,undefined);
 const nested={type:'block',layer:'0',entities:[display]};
 assert.equal(G.queryEntityPrimitives(G.preciseSnapBlock(doc,nested),box).length,1);
 doc.layers[0].visible=false;assert.equal(G.preciseSnapBlock(doc,display),null);
});

test('MOVE and UNDO engine history cannot reuse stale polyline snap coordinates',()=>{
 const engine=new DrawingEngine();
 engine.execute({type:'add',entity:{type:'polyline',layer:'default',closed:false,points:Array.from({length:300},(_,i)=>p(i*10,0))}});
 const original=engine.doc.entities[0],cursor=p(1000,0);
 assert.equal(G.snapGeometryMayContain(original,cursor,1),true);
 assert.deepEqual(G.snapGeometry(original,cursor,1).points,[cursor]);
 engine.execute({type:'move',ids:[original.id],dx:10000,dy:500});
 assert.equal(G.snapGeometryMayContain(engine.doc.entities[0],cursor,1),false);
 assert.equal(G.snapGeometry(engine.doc.entities[0],cursor,1).points.length,0);
 assert.deepEqual(G.snapGeometry(engine.doc.entities[0],p(11000,500),1).points,[p(11000,500)]);
 engine.execute({type:'undo'});assert.deepEqual(G.snapGeometry(engine.doc.entities[0],cursor,1).points,[cursor]);assert.equal(G.snapGeometryMayContain(engine.doc.entities[0],cursor,1),true);
 engine.execute({type:'redo'});assert.equal(G.snapGeometry(engine.doc.entities[0],cursor,1).points.length,0);
});
