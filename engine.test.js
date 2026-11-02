import { test } from "node:test";
import assert from "node:assert/strict";
import { snapGeometry } from "./geometry.js";
import { DrawingEngine, entityDistance, MAX_DRAWING_OBJECTS, MAX_BLOCK_DEPTH } from "./engine.js";

test("대형 반복 블록 도면은 300만 객체까지 검증하며 블록 깊이는 별도 제한한다", () => {
  assert.equal(MAX_DRAWING_OBJECTS, 3000000);
  assert.equal(MAX_BLOCK_DEPTH, 12);
});
const line = {
  id: "line-1",
  type: "line",
  layer: "default",
  points: [
    { x: 0, y: 0 },
    { x: 3000, y: 4000 },
  ],
};

test('scoped MOVE and COPY retain drawing order, history and duplicate-selection semantics',()=>{
  for(const type of ['move','copy']){
    const e=new DrawingEngine(),originalIds=e.execute({type:'addMany',entities:[line,{...line,id:'line-2'},{...line,id:'line-3'}]});
    const before=e.doc,ids=e.execute({type,ids:[originalIds[2],originalIds[0],originalIds[2]],dx:25,dy:-10});
    assert.equal(e.lastExecution.scopedEdit,true);assert.equal(ids.length,2);
    assert.equal(e.doc.entities[1],before.entities[1]);
    const changed=ids.map(id=>e.doc.entities.find(entity=>entity.id===id));
    for(const entity of changed)assert.deepEqual(entity.points,[{x:25,y:-10},{x:3025,y:3990}]);
    assert.deepEqual(before.entities.map(entity=>entity.id),originalIds);
    if(type==='move')assert.deepEqual(ids,[originalIds[0],originalIds[2]]);
    else assert.deepEqual(e.doc.entities.slice(3).map(entity=>entity.id),ids);
    e.execute({type:'undo'});assert.equal(e.doc,before);
  }
});

test('scoped MOVE and COPY on a locked layer leave document and history intact',()=>{
  for(const type of ['move','copy']){
    const e=new DrawingEngine();e.execute({type:'add',entity:line});
    e.doc.layers.find(layer=>layer.id==='default').locked=true;
    const before=e.doc,history=e.undoStack.length;
    assert.throws(()=>e.execute({type,ids:['line-1'],dx:25,dy:10}),/잠긴 레이어/);
    assert.equal(e.doc,before);assert.equal(e.undoStack.length,history);
    assert.deepEqual(e.doc.entities[0].points,line.points);
  }
});

test('mutate extensions may replace working selection before forwarding MOVE',()=>{
  const e=new DrawingEngine();e.execute({type:'add',entity:line});
  const before=e.doc,mutate=e.mutate;
  e.mutate=function(c,...args){
    this.doc.entities=this.doc.entities.map(entity=>({...entity,points:entity.points.map(p=>({...p,x:p.x+100}))}));
    return mutate.call(this,c,...args);
  };
  e.execute({type:'move',ids:['line-1'],dx:10,dy:0});
  assert.equal(e.doc.entities[0].points[0].x,110);
  e.execute({type:'undo'});assert.equal(e.doc,before);assert.equal(e.doc.entities[0].points[0].x,0);
});
test("exact coordinates survive move, history and JSON roundtrip", () => {
  const e = new DrawingEngine();
  e.execute({ type: "add", entity: line });
  e.execute({ type: "move", ids: ["line-1"], dx: 125.5, dy: -200 });
  assert.deepEqual(e.doc.entities[0].points[1], { x: 3125.5, y: 3800 });
  e.execute({ type: "undo" });
  assert.deepEqual(e.doc.entities[0], line);
  e.execute({ type: "redo" });
  const f = new DrawingEngine();
  f.execute({ type: "load", document: JSON.parse(JSON.stringify(e.doc)) });
  assert.deepEqual(f.doc, e.doc);
  f.execute({ type: "delete", ids: ["line-1"] });
  assert.equal(f.doc.entities.length, 0);
  f.execute({ type: "undo" });
  assert.equal(f.doc.entities.length, 1);
});
test("invalid load and invalid edits roll back without poisoning history", () => {
  const e = new DrawingEngine();
  e.execute({ type: "add", entity: line });
  const before = JSON.stringify(e.doc),
    n = e.undoStack.length;
  assert.throws(() => e.execute({ type: "load", document: { version: 2 } }));
  assert.throws(() =>
    e.execute({ type: "move", ids: ["line-1"], dx: NaN, dy: 0 }),
  );
  assert.equal(JSON.stringify(e.doc), before);
  assert.equal(e.undoStack.length, n);
  assert.throws(() => e.execute({ type: "add", entity: line }));
});
test("circle bounds, closed edge hit testing and layers", () => {
  const e = new DrawingEngine();
  e.execute({
    type: "add",
    entity: {
      type: "circle",
      center: { x: 100, y: 200 },
      radius: 50,
      layer: "default",
    },
  });
  assert.deepEqual(e.bounds(), { minX: 50, maxX: 150, minY: 150, maxY: 250 });
  assert.equal(entityDistance(e.doc.entities[0], { x: 150, y: 200 }), 0);
  assert.equal(
    entityDistance(
      {
        type: "rectangle",
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 10 },
          { x: 0, y: 10 },
        ],
      },
      { x: 0, y: 5 },
    ),
    0,
  );
  e.execute({ type: "layer.add", name: "대지" });
  const l = e.doc.layers.at(-1);
  e.execute({ type: "layer.update", id: l.id, changes: { visible: false } });
  assert.equal(e.doc.layers.at(-1).visible, false);
  e.execute({ type: "undo" });
  assert.equal(e.doc.layers.at(-1).visible, true);
});
test("new edit clears redo and malformed geometry is rejected", () => {
  const e = new DrawingEngine();
  e.execute({ type: "add", entity: line });
  e.execute({ type: "undo" });
  e.execute({ type: "layer.add", name: "건물" });
  assert.equal(e.redoStack.length, 0);
  assert.throws(() =>
    e.execute({
      type: "add",
      entity: {
        type: "circle",
        center: { x: 0, y: 0 },
        radius: -1,
        layer: "default",
      },
    }),
  );
});

test('zero-length LINE survives load, selection, MOVE and DXF-style endpoints',()=>{
 const e=new DrawingEngine(),dot={id:'dot-line',type:'line',layer:'default',points:[{x:25,y:30},{x:25,y:30}]};
 const doc={...e.doc,entities:[dot]};e.execute({type:'load',document:doc});
 assert.deepEqual(e.doc.entities[0].points,dot.points);
 assert.equal(entityDistance(e.doc.entities[0],{x:25,y:30}),0);
 assert.deepEqual(snapGeometry(e.doc.entities[0],{x:25.1,y:30.1},1).points,dot.points);
 e.execute({type:'move',ids:['dot-line'],dx:5,dy:-10});
 assert.deepEqual(e.doc.entities[0].points,[{x:30,y:20},{x:30,y:20}]);
 e.execute({type:'undo'});assert.deepEqual(e.doc.entities[0].points,dot.points);
 assert.throws(()=>e.execute({type:'add',entity:{...dot,id:'zero-wall',type:'wall',thickness:200}}),/길이가 0/);
});

test('deleting a wall also deletes the doors/windows hosted in it; undo brings both back (A7)',()=>{
  const e=new DrawingEngine();
  const wall={id:'w',type:'wall',layer:'default',points:[{x:0,y:0},{x:5000,y:0}],thickness:200,openings:[]};
  const door={id:'d',type:'block',name:'D1 간단문',category:'DOOR',layer:'default',position:{x:1000,y:0},hostWall:'w',hostOffset:0.2,entities:[{type:'line',layer:'default',points:[{x:1000,y:0},{x:1900,y:0}]}]};
  const other={id:'d2',type:'block',name:'D1 간단문',category:'DOOR',layer:'default',position:{x:9000,y:0},hostWall:'w-other',entities:[{type:'line',layer:'default',points:[{x:9000,y:0},{x:9900,y:0}]}]};
  const [w]=e.execute({type:'addMany',entities:[wall]});
  const [d,d2]=e.execute({type:'addMany',entities:[{...door,hostWall:w},other]});
  e.execute({type:'delete',ids:[w]});
  assert.deepEqual(e.doc.entities.map(x=>x.id),[d2]);
  e.execute({type:'undo'});
  assert.deepEqual(e.doc.entities.map(x=>x.id).sort(),[w,d,d2].sort());
  e.execute({type:'delete',ids:[d]});
  assert.deepEqual(e.doc.entities.map(x=>x.id).sort(),[w,d2].sort(),'deleting only the door keeps the wall');
});

test('AI 기록 재현: 엔진 거절 문구가 어떤 객체·다음 도구를 알려 준다',()=>{
  const e=new DrawingEngine();
  assert.throws(()=>e.execute({type:'lisp.run',name:'BCIRCLE'}),/cad_lisp_run/);
  assert.throws(()=>e.validate({...e.doc,entities:[{id:'r1',type:'rectangle',layer:e.doc.layers[0].id,points:[{x:0,y:0},{x:1,y:1}]}]}),/객체 좌표 오류: rectangle r1 점 2개\(최소 4개/);
  assert.throws(()=>e.validate({...e.doc,entities:[{id:'l1',type:'line',layer:'A-WALL',points:[{x:0,y:0},{x:1,y:1}]}]}),/객체의 레이어가 없습니다: line l1 layer=A-WALL/);
});


test('검토 순번·이력은 document.update 및 저장용 JSON 재로드와 undo에 남는다',()=>{
 const e=new DrawingEngine(),changes={reviewObjectSeq:{door:12},reviewHistory:[{at:'now',targetId:'doc:D-12',prevStatus:'revise',nextStatus:'satisfied'}]};
 e.execute({type:'document.update',changes});changes.reviewObjectSeq.door=0;assert.equal(e.doc.reviewObjectSeq.door,12);
 const saved=JSON.parse(JSON.stringify(e.doc)),loaded=new DrawingEngine();loaded.execute({type:'load',document:saved});assert.deepEqual(loaded.doc.reviewHistory,e.doc.reviewHistory);assert.equal(loaded.doc.reviewObjectSeq.door,12);
 e.execute({type:'undo'});assert.equal(e.doc.reviewObjectSeq,undefined);e.execute({type:'redo'});assert.equal(e.doc.reviewObjectSeq.door,12);
});
test('TRIM·BREAK 조각은 원본 검토 번호를 승계한다',()=>{
 for(const type of ['trim','break']){
  const e=new DrawingEngine(),[id]=e.execute({type:'addMany',entities:[{...line,reviewObjectId:'EW-01',points:[{x:0,y:0},{x:1000,y:0}]}]});let ids;
  if(type==='break')ids=e.execute({type,id,a:{x:400,y:0},b:{x:600,y:0}});
  else {const boundaryIds=e.execute({type:'addMany',entities:[{...line,points:[{x:400,y:-100},{x:400,y:100}]},{...line,points:[{x:600,y:-100},{x:600,y:100}]}]});ids=e.execute({type,id,boundaryIds,pick:{x:500,y:0}});}
  assert.equal(ids.length,2);assert.ok(ids.every(id=>e.doc.entities.find(e=>e.id===id).reviewObjectId==='EW-01'));
 }
 const e=new DrawingEngine(),[id]=e.execute({type:'addMany',entities:[{type:'arc',layer:'default',center:{x:0,y:0},radius:100,startAngle:0,endAngle:180,reviewObjectId:'EW-02'}]});const ids=e.execute({type:'break',id,a:{x:0,y:100},b:{x:0,y:100}});assert.equal(ids.length,2);assert.ok(ids.every(id=>e.doc.entities.find(e=>e.id===id).reviewObjectId==='EW-02'));
});

test("폭 있는 폴리선은 띠 가장자리를 눌러도 고른다", () => {
  const pl = { type: "polyline", points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }], constantWidth: 100 };
  assert.equal(entityDistance(pl, { x: 500, y: 45 }), 0);
  assert.equal(entityDistance(pl, { x: 500, y: 45 }, 5), 0);
  assert.equal(entityDistance(pl, { x: 500, y: 70 }), 20);
  assert.equal(entityDistance({ ...pl, constantWidth: 0 }, { x: 500, y: 45 }), 45);
});
