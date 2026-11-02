import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';
import {crossing,drawEntity} from './view.js';

const p=(x,y)=>({x,y});
const rect=(a,b)=>G.rectangle(a,b);
const line=(a,b)=>({type:'line',points:[a,b]});
const box=(x,y,r=1)=>({minX:x-r,maxX:x+r,minY:y-r,maxY:y+r});
const exhaustiveCrossing=(entity,query)=>G.visiblePrimitives(entity).some(primitive=>crossing(primitive,query));

test('finite picking retains every exact in-aperture hit, including closed edges and clip masks',()=>{
  const dense={type:'polyline',closed:true,bulges:[.2,-.1],points:Array.from({length:1200},(_,i)=>p(i*2,30*Math.sin(i/11)))};
  const clip={points:rect(p(0,-50),p(1200,50))};
  const entities=[dense,{...dense,clipMasks:[clip]},line(p(-10,0),p(10,0)),
    {type:'rectangle',points:rect(p(20,20),p(40,40))},
    {type:'circle',center:p(500,0),radius:40},
    {type:'arc',center:p(500,0),radius:50,startAngle:20,endAngle:250},
    {type:'ellipse',center:p(500,0),majorAxis:p(40,10),ratio:.5},
    {type:'text',position:p(500,0),height:15,text:'Text',rotation:35},
    {type:'hatch',points:rect(p(0,-40),p(800,40)),loops:[rect(p(200,-20),p(600,20))]}];
  let seed=13;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
  for(const entity of entities)for(let i=0;i<60;i++){
    const cursor=i<10&&i<entity.points?.length?entity.points[i]:p(random()*2400,random()*120-60);
    for(const tolerance of [0,1,8,50]){
      const expected=G.entityDistance(entity,cursor),actual=G.entityDistance(entity,cursor,tolerance);
      if(expected<=tolerance)assert.equal(actual,expected,`${entity.type} exact hit at tolerance ${tolerance}`);
      else assert.ok(actual>tolerance,`${entity.type} must not invent a hit`);
    }
  }
  const closingPoint=G.mul(G.add(dense.points[0],dense.points.at(-1)),.5);
  assert.equal(G.entityDistance(dense,closingPoint,0),0);
});

test('warm dense-polyline picking reads local geometry rather than all points',()=>{
  let reads=0;
  const points=Array.from({length:12000},(_,i)=>({get x(){reads++;return i*10;},y:0}));
  const entity={type:'polyline',points,closed:false},cursor=p(60000,2);
  G.entityDistance(entity,cursor,4); // Build the immutable point-array index once.
  reads=0;
  assert.equal(G.entityDistance(entity,cursor,4),2);
  assert.ok(reads<2000,`warm pick read point coordinates ${reads} times`);
  entity.points=points.map(q=>p(q.x+200000,q.y));
  assert.equal(G.entityDistance(entity,cursor,4),Infinity);
});

test('block crossing agrees with exhaustive primitives for fills, text, curves and nested clips',()=>{
  const primitives=[line(p(-100,0),p(100,0)),
    {type:'polyline',closed:true,bulges:[.5],points:rect(p(-80,-50),p(80,50))},
    {type:'hatch',points:rect(p(-150,-150),p(150,150)),loops:[rect(p(-20,-20),p(20,20))]},
    {type:'text',position:p(-40,-20),height:30,text:'TEST',rotation:20},
    {type:'circle',center:p(0,0),radius:70},
    {type:'arc',center:p(0,0),radius:80,startAngle:10,endAngle:250},
    {type:'ellipse',center:p(0,0),majorAxis:p(100,10),ratio:.7}];
  const plain={type:'block',entities:primitives};
  const clipped={type:'block',clip:{enabled:true,points:rect(p(-60,-60),p(60,60))},entities:[plain]};
  const inverted={...clipped,clip:{...clipped.clip,inverted:true}};
  const queries=[box(0,0),box(40,40),box(100,0),box(-100,-100),box(400,400),
    {minX:-200,maxX:200,minY:-200,maxY:200}];
  for(let i=-170;i<180;i+=17)queries.push(box(i,i/2,4));
  for(const entity of [plain,clipped,inverted,{type:'block',entities:[clipped]}]){
    for(const query of queries)assert.equal(crossing(entity,query),exhaustiveCrossing(entity,query),JSON.stringify({query,clip:entity.clip}));
  }
  for(const primitive of primitives.filter(e=>['hatch','text'].includes(e.type))){
    const entity={type:'block',entities:[primitive]},query=primitive.type==='hatch'?box(60,60):box(-20,-10);
    assert.equal(crossing(entity,query),true,'a filled shape containing the selection box is still selected');
  }
});

test('block query bounds include finer ellipse crossing tessellation extrema',()=>{
  const ellipse={type:'ellipse',center:p(0,0),majorAxis:p(100,10),ratio:.7};
  const fine=G.ellipsePoints(ellipse,256),tip=fine.reduce((best,q)=>q.x>best.x?q:best,fine[0]);
  assert.ok(tip.x>G.bounds([ellipse]).maxX+1e-4,'fixture extends beyond 128-step bounds');
  const entity={type:'block',entities:[ellipse]},query=box(tip.x,tip.y,1e-5);
  assert.equal(exhaustiveCrossing(entity,query),true);
  assert.equal(crossing(entity,query),true);
  for(const candidate of [entity,{type:'block',entities:[entity]},
    {type:'block',entities:[],_visibleEntities:[entity]}]){
    G.bounds([candidate]); // Populate the legacy coarse display-bounds cache.
    assert.deepEqual(G.spatialIndex([candidate]).query(query),[candidate]);
    const incremental=G.spatialIndex([]);incremental.insert([candidate]);
    assert.deepEqual(incremental.query(query),[candidate]);
  }
  const clipped={type:'block',entities:[entity],clip:{enabled:true,points:rect(p(-10,-10),p(10,10))}};
  assert.deepEqual(G.spatialIndex([clipped]).query(query),[],'normal clipping still bounds the candidate');
  const reference={type:'block',sharedBlock:'outer',position:p(0,0),scale:1,rotation:0};
  const doc={entities:[reference],sharedBlocks:{outer:{origin:p(0,0),entities:[{type:'block',sharedBlock:'inner',position:p(0,0),scale:1,rotation:0}]},inner:{origin:p(0,0),entities:[ellipse]}}};
  G.prepareSharedDrawingReferences(doc);
  assert.deepEqual(G.spatialIndex(doc.entities).query(query),[reference],'unexpanded shared references also retain conservative bounds');
});

test('immutable block crossing stops before unrelated descendants and keeps clipped semantics',()=>{
 let reads=0;
 const tail={get type(){reads++;return 'line';},points:[p(90000,0),p(90000,10)]};
 const root=Object.freeze({type:'block',entities:[line(p(0,0),p(10,0)),tail]});
 assert.equal(crossing(root,box(5,0)),true);
 assert.equal(reads,0,'first actual hit must not expand unrelated children');
 const stable={...line(p(0,0),p(10,0)),layer:'child'},layered=Object.freeze({type:'block',layer:'parent',entities:[stable]});
 for(let i=0;i<2;i++)G.someEntityPrimitive(layered,box(5,0),part=>{assert.equal(part,stable,'retain primitive identity for translated-instance caches');return true;});
 const clipped=Object.freeze({type:'block',entities:[line(p(0,0),p(10,0))],clip:{enabled:true,points:[p(4,-2),p(6,-2),p(6,2),p(4,2)]}});
 const nested=Object.freeze({type:'block',entities:[clipped]});
 for(const query of [box(0,0),box(5,0),box(10,0),{minX:4,minY:0,maxX:4,maxY:0}]){
  const expected=G.queryEntityPrimitives(nested,query).some(part=>crossing(part,query));
  assert.equal(crossing(nested,query),expected);
 }
});

test('repeated block crossing reuses primitive preparation and invalidates replaced children',()=>{
  let childReads=0;
  const children=Array.from({length:4000},(_,i)=>{
    const entity=line(p(i*10,0),p(i*10,10));
    Object.defineProperty(entity,'type',{enumerable:true,get(){childReads++;return 'line';}});
    return entity;
  });
  const entity={type:'block',entities:[{type:'block',entities:children}]},query=box(20000,5);
  assert.equal(crossing(entity,query),true);
  childReads=0;
  assert.equal(crossing(entity,query),true);
  assert.equal(childReads,0,'warm crossing must not flatten every original child again');
  entity.entities=[line(p(90000,0),p(90000,10))];
  assert.equal(crossing(entity,query),false);
});

test('rebuilding top-level spatial indexes reuses conservative nested block bounds',()=>{
  let reads=0;
  const points=Array.from({length:100000},(_,i)=>({get x(){reads++;return i;},y:0}));
  const child={type:'polyline',points},inner={type:'block',entities:[child]},entity={type:'block',entities:[inner]};
  G.spatialIndex([entity]);reads=0;
  for(let i=0;i<3;i++)assert.deepEqual(G.spatialIndex([entity]).query(box(50000,0)),[entity]);
  const incremental=G.spatialIndex([]);incremental.insert([entity]);
  assert.deepEqual(incremental.query(box(50000,0)),[entity]);
  assert.equal(reads,0,'top-level rebuilds must not reread unchanged descendant coordinates');
});

test('conservative block bounds invalidate with source, clipping and render bounds',()=>{
  const entity={type:'block',entities:[line(p(0,0),p(10,0))]};
  const query=x=>G.spatialIndex([entity]).query(box(x,0));
  assert.deepEqual(query(5),[entity]);
  entity.entities=[line(p(100,0),p(110,0))];
  assert.deepEqual(query(105),[entity],'source array replacement');
  entity.entities.push(line(p(200,0),p(210,0)));
  assert.deepEqual(query(205),[entity],'source array length change');
  entity._visibleEntities=[entity.entities[1]];
  assert.deepEqual(query(205),[entity],'display subset remains inside canonical bounds');
  entity.clip={enabled:true,points:rect(p(200,-10),p(210,10))};
  assert.deepEqual(query(5),[],'new normal clip limits bounds');
  entity.clip.points=rect(p(0,-10),p(10,10));
  assert.deepEqual(query(205),[],'replaced clip points invalidate');
  entity.clip.enabled=false;
  assert.deepEqual(query(205),[entity],'clip flag edits invalidate');
  delete entity.clip;delete entity._visibleEntities;
  entity.entities[0].points=[p(400,0),p(410,0)];
  delete entity._renderBounds; // Existing geometry-edit invalidation contract.
  assert.deepEqual(query(405),[entity],'in-place child edit with render-bounds invalidation');
  entity._renderBounds={minX:0,minY:-10,maxX:1000,maxY:10};
  assert.deepEqual(query(900),[entity],'replaced prepared bounds');
  entity._renderBounds.maxX=2000;
  assert.deepEqual(query(1900),[entity],'updated prepared bounds values');
});

test('visibleEntities refresh does not invalidate unchanged canonical block spatial bounds',()=>{
  let reads=0;
  const points=Array.from({length:100000},(_,i)=>({get x(){reads++;return i;},y:0}));
  const child={type:'polyline',layer:'0',points},entity={type:'block',layer:'0',entities:[child]};
  const doc={layers:[{id:'0',name:'0',visible:true,color:'#fff'}],entities:[entity]};
  G.spatialIndex(G.visibleEntities(doc,{inPlace:true}));
  const previous=entity._visibleEntities;
  reads=0;
  const refreshed=G.visibleEntities(doc,{inPlace:true});
  assert.notEqual(entity._visibleEntities,previous,'exercise the real display-array refresh');
  assert.deepEqual(G.spatialIndex(refreshed).query(box(50000,0)),[entity]);
  assert.equal(reads,0,'display refresh plus top-level rebuild must not revisit source points');
  doc.layers[0].visible=false;
  assert.deepEqual(G.spatialIndex(G.visibleEntities(doc,{inPlace:true})).query(box(50000,0)),[]);
});

test('cold local queries match full primitive indexes including nested arc centers and clipping',()=>{
  const arc={type:'arc',center:p(0,0),radius:100,startAngle:0,endAngle:30};
  const ellipse={type:'ellipse',center:p(300,0),majorAxis:p(100,10),ratio:.7};
  const inner={type:'block',layer:'inner',entities:[arc,ellipse,
    {type:'hatch',points:rect(p(-30,-30),p(30,30))},
    {type:'polyline',closed:true,bulges:[.5],points:rect(p(-50,-50),p(50,50))},
    {type:'text',position:p(-10,0),height:20,text:'Test'},line(p(-100,0),p(500,0))]};
  for(const clip of [undefined,{enabled:true,points:rect(p(-20,-20),p(320,20))},
    {enabled:true,inverted:true,points:rect(p(-20,-20),p(320,20))}]){
    for(const query of [box(0,0),box(99,0),box(350,10),box(-45,0),box(1000,1000),box(0,0,500)]){
      const root=structuredClone({type:'block',layer:'root',entities:[{...inner,clip}]});
      const expected=G.spatialIndex(G.visiblePrimitives(root)).query(query);
      assert.deepEqual(G.queryEntityPrimitives(root,query),expected,'cold candidates equal the full index');
      assert.deepEqual(G.queryEntityPrimitives(root,query),expected,'warm candidates equal the full index');
      assert.equal(crossing(root,query),exhaustiveCrossing(root,query),'clipped candidates do not invent crossing hits');
    }
  }
  const arcOnly={type:'block',entities:[{type:'block',entities:[arc]}]};
  assert.ok(G.bounds([arcOnly]).minX>80,'arc center is outside both ancestor display bounds');
  assert.equal(G.queryEntityPrimitives(arcOnly,box(0,0))[0].type,'arc','nested center remains a snap candidate');
});

test('small cold block query expands only nearby primitives and retains four local identity regions',()=>{
  let expansions=0;
  const children=Array.from({length:4000},(_,i)=>{
    const entity={...line(p(i*100,0),p(i*100,10)),id:`line-${i}`};
    Object.defineProperty(entity,'metadata',{enumerable:true,get(){expansions++;return 1;}});
    return entity;
  });
  const root={type:'block',entities:[{type:'block',entities:children}]};
  G.spatialIndex([root]);expansions=0;
  const first=G.queryEntityPrimitives(root,box(10000,5))[0];
  assert.equal(first.id,'line-100');
  assert.ok(expansions<10,`cold query expanded ${expansions} distant primitives`);
  expansions=0;
  assert.equal(G.queryEntityPrimitives(root,box(10000,6))[0],first,'contained aperture shares primitive identity');
  assert.equal(expansions,0,'contained aperture does not expand originals');
  for(const x of [20000,30000,40000])G.queryEntityPrimitives(root,box(x,5));
  assert.equal(G.queryEntityPrimitives(root,box(10000,5))[0],first,'four regions retained and touched region promoted');
  G.queryEntityPrimitives(root,box(50000,5));
  assert.equal(G.queryEntityPrimitives(root,box(10000,5))[0],first,'most recently used region retained');
  for(const x of [60000,70000,80000,90000])G.queryEntityPrimitives(root,box(x,5));
  assert.notEqual(G.queryEntityPrimitives(root,box(10000,5))[0],first,'old fifth region is evicted');
  const full=G.prepareEntityDistanceIndex(root),prepared=full.query(box(10000,5))[0];
  assert.equal(G.queryEntityPrimitives(root,box(10000,5))[0],prepared,'explicit complete index takes precedence');
});

test('local primitive regions invalidate after visibility, source, layer and clipping changes',()=>{
  const near=line(p(0,0),p(10,0)),far=line(p(1000,0),p(1010,0));
  const root={type:'block',layer:'A',entities:[near,far]},query=box(5,0);
  let first=G.queryEntityPrimitives(root,query)[0];
  root.layer='B';
  let next=G.queryEntityPrimitives(root,query)[0];
  assert.notEqual(next,first);assert.equal(next.layer,'B');
  root._visibleEntities=[far];assert.deepEqual(G.queryEntityPrimitives(root,query),[]);
  root._visibleEntities=[near,far];assert.equal(G.queryEntityPrimitives(root,query).length,1);
  root.clip={enabled:true,points:rect(p(100,-20),p(1100,20))};
  assert.deepEqual(G.queryEntityPrimitives(root,query),[]);
  root.clip.points=rect(p(-20,-20),p(20,20));
  first=G.queryEntityPrimitives(root,query)[0];assert.ok(first);
  root.clip.inverted=true;assert.deepEqual(G.queryEntityPrimitives(root,query),[]);
  root.clip.enabled=false;
  next=G.queryEntityPrimitives(root,query)[0];assert.ok(next);assert.notEqual(next,first);
  delete root._visibleEntities;root.entities=[far];
  assert.deepEqual(G.queryEntityPrimitives(root,query),[]);
  root.entities.push(near);assert.equal(G.queryEntityPrimitives(root,query).length,1);
  near.points=[p(2000,0),p(2010,0)];delete root._renderBounds;
  assert.deepEqual(G.queryEntityPrimitives(root,query),[],'existing render-bounds invalidation covers descendant edits');
});


test('block line drawing retains individual strokes while sharing state and restoring nested fallbacks',()=>{
 const stack=[],strokes=[];let saves=0,dashWrites=0,current=[];
 const ctx={strokeStyle:'#111111',lineWidth:9,dash:[],
  save(){saves++;stack.push({strokeStyle:this.strokeStyle,lineWidth:this.lineWidth,dash:this.dash});},
  restore(){Object.assign(this,stack.pop());},setLineDash(v){dashWrites++;this.dash=v;},
  beginPath(){current=[];},moveTo(x,y){current.push([x,y]);},lineTo(x,y){current.push([x,y]);},
  stroke(){strokes.push({color:this.strokeStyle,width:this.lineWidth,dash:[...this.dash],points:current});},
  strokeRect(x,y,w,h){strokes.push({color:this.strokeStyle,width:this.lineWidth,dash:[...this.dash],rect:[x,y,w,h]});},
 };
 const simple=x=>({type:'line',color:'#808080',points:[p(x,0),p(x+10,10)]});
 const entity={type:'block',entities:[...Array.from({length:1000},(_,i)=>({...simple(i),linetype:'DASHED'})),
  {type:'block',color:'#0000ff',entities:[{...simple(0),points:[p(0,0),p(.1,.1)]}]},simple(2000),
  {...simple(2010),color:'#ff0000',linetype:'DASHED',linetypeScale:2},simple(2020)]};
 drawEntity(ctx,entity,q=>q,1,'#ffffff',2.3);
 assert.equal(strokes.length,1004,'overlapping lines remain independent raster strokes');
 assert.ok(strokes.slice(0,1000).every(s=>s.color==='#808080'&&s.width===2.3));
 assert.deepEqual(strokes[1000].dash,[],'collapsed fallback inherits the block baseline, not the preceding line dash');
 assert.equal(strokes[1000].width,1);assert.equal(strokes[1000].color,'#0000ff');
 assert.equal(strokes[1001].width,2.3);assert.equal(strokes[1001].color,'#808080');
 assert.deepEqual(strokes[1002].dash.map(v=>Math.round(v*1e6)/1e6),[14,10].map(v=>Math.round(v/.6*1e6)/1e6),'1 px/mm: 도면 길이(÷0.6)');assert.deepEqual(strokes[1003].dash,[]);
 assert.equal(ctx.strokeStyle,'#111111');assert.equal(ctx.lineWidth,9);assert.deepEqual(ctx.dash,[]);
 assert.ok(saves<10,'does not save and restore state for every simple line');assert.ok(dashWrites<10);
});
