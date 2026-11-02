/** These are REAL kernel integration tests. Missing WASM fails, never silently skips. */
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {buildOcctBuilding,exportOcctStep,normalizeBuildingModel} from './occt-building.js';
import {occtPlan,occtVerticalSection,occtElevation} from './occt-section.js';
import {scoped,forSubshapes} from './occt-kernel.js';
import {readOcctFixture} from './tools/occt-fixture.mjs';
import {createOcctClient} from './occt-client.js';
let pending;
const get=()=>pending??=(async()=>{const model=await readOcctFixture();return {model,building:await buildOcctBuilding(model)};})();
after(async()=>{if(pending)try{(await pending).building.dispose();}catch{}});
const within=(a,b)=>assert.ok(Math.abs(a-b)<=1,'Expected '+b+' mm, got '+a+' mm');
test('사리로 실제 OCCT 벽 두께·층고·슬래브 두께가 원모델과 ±1mm다',async()=>{
  const {model,building:b}=await get(),n=normalizeBuildingModel(model);
  for(const record of b.records){
    const expected=n.solids.find(e=>e.id===record.id);
    within(record.bounds.min[2],expected.bottom);
    within(record.bounds.max[2]-record.bounds.min[2],expected.height);
    if(record.kind==='wall'){
      const values=[];
      forSubshapes(b.oc,record.shape,'TopAbs_VERTEX',shape=>scoped(s=>{
        const vertex=s.own(b.oc.TopoDS.Vertex(shape)),p=s.own(b.oc.BRep_Tool.Pnt(vertex));
        values.push(p.X()*expected.normal[0]+p.Y()*expected.normal[1]);
      }));
      within(Math.max(...values)-Math.min(...values),expected.thickness);
      const removed=expected.openings.reduce((s,e)=>s+e.width*e.height*expected.thickness,0);
      assert.ok(Math.abs(record.volumeMm3-(expected.length*expected.height*expected.thickness-removed))<=1,
        record.id+' opening subtraction volume');
    }
  }
  assert.equal(b.records.length,21);
});
function crossesAt(entities,x,y){
  return entities.some(e=>e.type==='line'&&Math.abs(e.points[0].y-y)<0.001&&Math.abs(e.points[1].y-y)<0.001&&
    x>=Math.min(e.points[0].x,e.points[1].x)&&x<=Math.max(e.points[0].x,e.points[1].x));
}
test('사리로 +1.2m 평면: 절단·하부 보이는 선·해치 경계, 높은 창의 하부와 낮은 창 틈',async()=>{
  const {building:b}=await get(),doc=occtPlan(b,{story:'s1'});
  assert.equal(doc.version,2);assert.equal(doc.metadata.cutElevation,1200);
  const cut=doc.entities.filter(e=>e.occtRole==='cut'),visible=doc.entities.filter(e=>e.occtRole==='visible');
  assert.ok(cut.length>0&&visible.length>0&&doc.hatchBoundaries.length>0);
  assert.ok(cut.every(e=>e.layer==='A-WALL-CONC'&&e.lineweight===0.35));
  assert.ok(visible.every(e=>e.lineweight<0.35));
  assert.ok(crossesAt(cut,10650,2500)); // bathroom window sill=1500
  assert.ok(!crossesAt(cut,3300,2500)); // living room window sill=100
});
test('사리로 임의 두 점 수직면: 절단·너머 HLR·구멍 포함 경계',async()=>{
  const {building:b}=await get(),doc=occtVerticalSection(b,{start:[0,5500],end:[13000,5500]});
  assert.ok(doc.entities.some(e=>e.occtRole==='cut'));
  assert.ok(doc.entities.some(e=>e.occtRole==='visible'));
  assert.equal(doc.metadata.cutFaceCount,1);
  assert.equal(doc.hatchBoundaries.length,1);
  assert.equal(doc.hatchBoundaries[0].holes.length,2);
  // Independent union of source x/z rectangles minus windows/doors: 8,720,000 mm².
  within(hatchArea(doc),8720000);
  assert.equal(doc.entities.filter(e=>e.occtRole==='cut').length,38);
  assertBoundaryEdges(doc);
  const diagonal=occtVerticalSection(b,{start:[0,2000],end:[13000,9000],side:'right'});
  assert.ok(diagonal.entities.some(e=>e.occtRole==='cut'));
  assert.equal(diagonal.hatchBoundaries[0].holes.length,6);
  assertBoundaryEdges(diagonal);
});
test('사리로 남측 입면 HLR의 보이는 선/숨은 선은 별도이며 좌표가 유한하다',async()=>{
  const {building:b}=await get(),doc=occtElevation(b,{direction:[0,-1,0]});
  assert.ok(doc.entities.length>0&&doc.hiddenEntities.length>0);
  assert.ok(doc.entities.every(e=>e.occtRole==='visible'));
  assert.ok(doc.hiddenEntities.every(e=>e.occtRole==='hidden'&&e.linetype==='HIDDEN'));
  assert.ok(doc.entities.filter(e=>e.type==='line').every(e=>e.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))));
});
test('HLR는 전면 벽에 완전히 가려진 뒤쪽 부재를 visible에 넣지 않는다',async()=>{
  const model={format:'barun-building-model',units:'mm',stories:[{id:'s',height:3000,elevation:0}],elements:[
    {id:'front',kind:'wall',story:'s',path:[[0,0],[10000,0]],thickness:200},
    {id:'back',kind:'wall',story:'s',path:[[3000,3000],[7000,3000]],thickness:200,height:2000}]};
  const b=await buildOcctBuilding(model);
  try {
    const d=occtElevation(b,{direction:[0,-1,0]});
    assert.ok(d.hiddenEntities.length>0);
    assert.ok(!d.entities.some(e=>e.type==='line'&&e.points.every(p=>Math.abs(p.x-3000)<0.001)));
    assert.ok(!d.entities.some(e=>e.type==='line'&&e.points.every(p=>Math.abs(p.x-7000)<0.001)));
  }finally{b.dispose();}
});
test('사리로 STEP 전체·선택 부재가 실제 B-rep 파일이고 가상 파일은 정리된다',async()=>{
  const {building:b}=await get();
  const all=exportOcctStep(b),one=exportOcctStep(b,{ids:['1-S']});
  const text=new TextDecoder().decode(all),partial=new TextDecoder().decode(one);
  assert.match(text,/ISO-10303-21/);assert.match(text,/MANIFOLD_SOLID_BREP/);
  assert.match(text,/END-ISO-10303-21/);assert.ok(all.byteLength>one.byteLength&&one.byteLength>1000);
  assert.match(partial,/ADVANCED_FACE/);
  assert.ok(!b.oc.FS.readdir('/').some(f=>/^barun-step-/.test(f)));
  assert.throws(()=>exportOcctStep(b,{ids:['missing']}),/Unknown solid/);
});
test('Node Worker에서 실제 로딩·건물·평면·STEP·dispose를 완료한다',async()=>{
  const client=createOcctClient();
  try {
    const result=await client.build(await readOcctFixture());
    assert.equal(result.records.length,21);assert.ok(result.load.loadMs>0);
    const doc=await client.plan(result.handle,{story:'s1'});assert.ok(doc.entities.length>0);
    const step=await client.step(result.handle,{stories:['s1']});assert.ok(step.byteLength>1000);
    await client.dispose(result.handle);
    assert.equal((await client.metrics()).models,0);
  }finally{await client.terminate();}
});

test('수직 단면의 앞쪽은 제외되고 선택한 너머 반공간만 투영한다',async()=>{
  const model={format:'barun-building-model',units:'mm',stories:[{id:'s',height:3000,elevation:0}],elements:[
    {id:'behind',kind:'wall',story:'s',path:[[2000,2000],[3000,2000]],thickness:200,height:1000},
    {id:'front',kind:'wall',story:'s',path:[[7000,-2000],[8000,-2000]],thickness:200,height:2000},
  ]};
  const building=await buildOcctBuilding(model);
  try{
    const doc=occtVerticalSection(building,{start:[0,0],end:[10000,0],side:'left'});
    assert.ok(doc.entities.some(e=>e.points?.some(p=>Math.abs(p.x-2000)<0.001)));
    assert.ok(!doc.entities.some(e=>e.points?.some(p=>Math.abs(p.x-7000)<0.001)));
    const reversed=occtVerticalSection(building,{start:[0,0],end:[10000,0],side:'right'});
    assert.ok(reversed.entities.some(e=>e.points?.some(p=>Math.abs(p.x+7000)<0.001)));
    assert.ok(!reversed.entities.some(e=>e.points?.some(p=>Math.abs(p.x+2000)<0.001)));
  }finally{building.dispose();}
});

const loopArea=points=>points.reduce((s,p,i)=>{
  const q=points[(i+1)%points.length];return s+p.x*q.y-q.x*p.y;
},0)/2;
const hatchArea=doc=>doc.hatchBoundaries.reduce((s,b)=>
  s+loopArea(b.outer)+b.holes.reduce((n,h)=>n+loopArea(h),0),0);
function assertBoundaryEdges(doc){
  const cut=doc.entities.filter(e=>e.occtRole==='cut');
  for(const boundary of doc.hatchBoundaries)for(const [i,loop]of [boundary.outer,...boundary.holes].entries()){
    assert.ok(loop.length>=3&&loop.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
    assert.ok(i===0?loopArea(loop)>0:loopArea(loop)<0,'outer CCW, holes CW');
    for(const [j,p]of loop.entries()){
      const q=loop[(j+1)%loop.length],same=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<0.001;
      assert.ok(cut.some(e=>e.type==='line'&&
        ((same(e.points[0],p)&&same(e.points[1],q))||(same(e.points[1],p)&&same(e.points[0],q)))),
        'Every hatch closing edge must come from the real cut face');
    }
  }
  assert.equal(doc.metadata.cutFaceCount,doc.hatchBoundaries.length);
}
test('절단면에서 꼭짓점을 공유하는 두 솔리드는 각각 닫힌 해치 경계를 갖는다',async()=>{
  const model={format:'barun-building-model',units:'mm',stories:[{id:'s',elevation:0,height:3000}],elements:[
    {id:'a',kind:'slab',story:'s',thickness:1000,topOffset:1000,outline:[[0,-100],[1000,-100],[1000,100],[0,100]]},
    {id:'b',kind:'slab',story:'s',thickness:1000,topOffset:2000,outline:[[1000,-100],[2000,-100],[2000,100],[1000,100]]},
  ]};
  const b=await buildOcctBuilding(model);
  try{
    const d=occtVerticalSection(b,{start:[0,0],end:[2000,0]});
    assert.equal(d.hatchBoundaries.length,2);within(hatchArea(d),2000000);assertBoundaryEdges(d);
  }finally{b.dispose();}
});
test('슬래브 평면 절단의 실제 구멍은 닫힌 내부 와이어로 남는다',async()=>{
  const b=await buildOcctBuilding({format:'barun-building-model',units:'mm',stories:[{id:'s',elevation:0,height:3000}],elements:[
    {id:'sl',kind:'slab',story:'s',thickness:200,topOffset:1500,
      outline:[[0,0],[1000,0],[1000,1000],[0,1000]],holes:[[[200,200],[400,200],[400,400],[200,400]]]},
  ]});
  try{
    const d=occtPlan(b,{story:'s',height:1400});
    assert.equal(d.hatchBoundaries.length,1);assert.equal(d.hatchBoundaries[0].holes.length,1);
    within(hatchArea(d),960000);assertBoundaryEdges(d);
  }finally{b.dispose();}
});
test('거의 평행한 원본 벽면은 절단면으로 중복 분류하지 않는다',async()=>{
  const b=await buildOcctBuilding({format:'barun-building-model',units:'mm',stories:[{id:'s',elevation:0,height:3000}],elements:[
    {id:'w',kind:'wall',story:'s',path:[[0,0],[10000,0]],thickness:200},
  ]});
  try{
    for(const rise of [0.001,0.01,0.1]){
      const d=occtVerticalSection(b,{start:[0,-100],end:[10000,-100+rise],side:'right'});
      assert.equal(d.hatchBoundaries.length,1);
      within(hatchArea(d),Math.hypot(10000,rise)*3000);assertBoundaryEdges(d);
    }
  }finally{b.dispose();}
});

test('경계면 일치·외부 절단 양방향: 남긴 솔리드 경계만 폐합하고 빈 쪽은 선도 없다',async()=>{
  const b=await buildOcctBuilding({format:'barun-building-model',units:'mm',stories:[{id:'s',elevation:0,height:3000}],elements:[
    {id:'w',kind:'wall',story:'s',path:[[0,0],[1000,0]],thickness:200},
  ]});
  try{
    for(const [y,side,retained,faces]of [
      [-100,'left',true,1],[-100,'right',false,0],
      [100,'left',false,0],[100,'right',true,1],
      [-1000,'left',true,0],[-1000,'right',false,0],
      [1000,'left',false,0],[1000,'right',true,0],
    ]){
      const d=occtVerticalSection(b,{start:[0,y],end:[1000,y],side});
      assert.equal(d.hatchBoundaries.length,faces);assertBoundaryEdges(d);
      assert.equal(d.entities.length>0,retained);
      if(faces)within(hatchArea(d),3000000);
      else assert.ok(!d.entities.some(e=>e.occtRole==='cut'));
      if(!retained)assert.equal(d.hiddenEntities.length,0);
    }
  }finally{b.dispose();}
});

// Real kernel regressions: the cut outline is the union boundary, never the
// per-wall rectangle outlines or HLR copies of the same cut edges.
function assertUniqueLines(doc){
  const keys=doc.entities.filter(e=>e.type==='line').map(e=>e.points
    .map(p=>[p.x,p.y].map(v=>Math.round(v*1000)).join(',')).sort().join(';'));
  assert.equal(new Set(keys).size,keys.length,'cut and visible edges must not be duplicated');
}
test('L·T 벽 접합은 한 절단면이며 겹침 사각형이나 중복 선을 만들지 않는다',async()=>{
  for(const [name,paths,area,edges]of [
    ['L',[[[0,0],[1000,0]],[[0,0],[0,1000]]],400000,6],
    ['T',[[[-1000,0],[1000,0]],[[0,0],[0,1000]]],580000,8],
  ]){
    const b=await buildOcctBuilding({format:'barun-building-model',units:'mm',
      stories:[{id:'s',elevation:0,height:3000}],elements:paths.map((points,i)=>
        ({id:name+i,kind:'wall',story:'s',path:points,thickness:200}))});
    try{
      const d=occtPlan(b,{story:'s'});
      assert.equal(d.hatchBoundaries.length,1);assert.equal(d.hatchBoundaries[0].holes.length,0);
      assert.equal(d.entities.filter(e=>e.occtRole==='cut').length,edges);
      within(hatchArea(d),area);assertBoundaryEdges(d);assertUniqueLines(d);
      assert.equal(b.records.length,2);assert.equal(b.viewRecords.length,1);
      assert.equal(b.viewRecords[0].sourceIds.length,2);
    }finally{b.dispose();b.dispose();}
  }
});
test('벽 합친 뒤 host 개구부를 빼서 접합부의 다른 벽이 창을 다시 메우지 않는다',async()=>{
  const b=await buildOcctBuilding({format:'barun-building-model',units:'mm',
    stories:[{id:'s',elevation:0,height:3000}],elements:[
      {id:'a',kind:'wall',story:'s',path:[[0,0],[1000,0]],thickness:200},
      {id:'b',kind:'wall',story:'s',path:[[0,0],[0,1000]],thickness:200},
      {id:'window',kind:'window',host:'a',offset:0,width:300,height:1500,sill:500},
    ]});
  try{
    const d=occtPlan(b,{story:'s'});
    // The cutter runs 2mm beyond the host's outer face, removing the overlap too.
    within(hatchArea(d),339800);assertBoundaryEdges(d);assertUniqueLines(d);
    const inLoop=(p,loop)=>{let yes=false;for(let i=0,j=loop.length-1;i<loop.length;j=i++){
      const a=loop[i],b=loop[j];
      if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;
    }return yes;};
    assert.ok(!d.hatchBoundaries.some(h=>inLoop({x:50,y:50},h.outer)),
      'the window opening must remain empty inside the perpendicular wall overlap');
    assert.equal(b.records.find(r=>r.id==='a').openings[0],'window');
  }finally{b.dispose();}
});
test('층별 벽 합치기는 위층 개구부와 벽을 아래층 평면에 섞지 않는다',async()=>{
  const b=await buildOcctBuilding({format:'barun-building-model',units:'mm',
    stories:[{id:'s1',elevation:0,height:3000},{id:'s2',elevation:3000,height:3000}],elements:[
      {id:'w1',kind:'wall',story:'s1',path:[[0,0],[1000,0]],thickness:200},
      {id:'w2',kind:'wall',story:'s2',path:[[0,0],[1000,0]],thickness:200},
      {id:'window',kind:'window',host:'w2',offset:300,width:400,height:1500,sill:500},
    ]});
  try{
    const lower=occtPlan(b,{story:'s1'}),upper=occtPlan(b,{story:'s2'});
    within(hatchArea(lower),200000);within(hatchArea(upper),120000);
    assert.equal(lower.hatchBoundaries.length,1);assert.equal(upper.hatchBoundaries.length,2);
    assertBoundaryEdges(lower);assertBoundaryEdges(upper);
    assertUniqueLines(lower);assertUniqueLines(upper);
  }finally{b.dispose();}
});

test('사리로 네 외곽 코너는 miter로 닫히며 100mm 홈·슬래브 사각형이 없다',async()=>{
  const {building:b,model}=await get(),before=JSON.stringify(model),d=occtPlan(b,{story:'s1'});
  const corners=[[700,2500],[11900,2500],[11900,8500],[700,8500]];
  const cut=d.entities.filter(e=>e.occtRole==='cut');
  for(const [x,y]of corners){
    const nearby=cut.flatMap(e=>e.points??[]).filter(p=>Math.hypot(p.x-x,p.y-y)<150);
    assert.ok(nearby.length>0);
    assert.ok(nearby.every(p=>Math.hypot(p.x-x,p.y-y)<0.001),'no 100mm notch at '+[x,y]);
    assert.ok(!d.entities.some(e=>e.occtRole==='visible'&&e.points?.every(p=>Math.hypot(p.x-x,p.y-y)<150)),
      'no exposed slab square at '+[x,y]);
  }
  // Butt unions measured 6,065,000mm²; four missing 100x100 corners add 40,000mm².
  within(hatchArea(d),6105000);assertBoundaryEdges(d);assertUniqueLines(d);
  assert.equal(JSON.stringify(model),before);
  assert.equal(b.records.length,21);
});
