import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';

const line=(id,extra={})=>({id,type:'line',layer:'default',points:[{x:0,y:0},{x:10,y:0}],...extra});
const linkedFixture=()=>[
  line('wall',{type:'wall',thickness:200}),
  line('boundary'),
  line('opening',{hostWall:'wall'}),
  line('tag',{roomBoundary:'boundary'}),
  line('unrelated',{hostWall:'other-wall',roomBoundary:'other-boundary'}),
];

// Exercise association gathering directly: these lightweight stand-ins isolate
// target membership from architectural opening and room-tag regeneration.
for(const type of ['copy','move','rotate','scale','mirror']){
  test(`${type} includes wall/room dependents once even when already selected`,()=>{
    const engine=new DrawingEngine();engine.doc.entities=linkedFixture();
    const before=structuredClone(engine.doc.entities);
    const result=engine.mutate({type,ids:['wall','boundary','opening','opening'],dx:20,dy:30,
      base:{x:0,y:0},angle:90,factor:2,a:{x:0,y:0},b:{x:0,y:1},eraseSource:true});
    assert.equal(result.length,4);
    assert.equal(new Set(result).size,4);
    assert.deepEqual(engine.doc.entities.find(e=>e.id==='unrelated'),before[4]);
    if(type==='copy'){
      assert.deepEqual(engine.doc.entities.slice(0,5),before);
      const copies=engine.doc.entities.slice(5);
      assert.equal(copies.length,4);
      assert.equal(copies[2].hostWall,copies[0].id);
      assert.equal(copies[3].roomBoundary,copies[1].id);
      assert.deepEqual(copies.map(e=>e.points[0]),Array(4).fill({x:20,y:30}));
    }else{
      assert.deepEqual(result,['wall','boundary','opening','tag']);
      assert.equal(engine.doc.entities.length,5);
      assert.equal(engine.doc.entities[2].hostWall,'wall');
      assert.equal(engine.doc.entities[3].roomBoundary,'boundary');
      for(const entity of engine.doc.entities.slice(0,4))assert.notDeepEqual(entity.points,before[0].points);
    }
  });
}

test('COPY checks locks on implicitly associated targets before inserting copies',()=>{
  const engine=new DrawingEngine();engine.doc.entities=linkedFixture();
  engine.doc.layers.push({id:'locked',name:'Locked',visible:true,locked:true});
  engine.doc.entities[3].layer='locked';
  const before=structuredClone(engine.doc.entities);
  assert.throws(()=>engine.mutate({type:'copy',ids:['boundary'],dx:20,dy:30}),/잠긴/);
  assert.deepEqual(engine.doc.entities,before);
});

test('large COPY target gathering has linear ID lookup work and retains undo',()=>{
  const engine=new DrawingEngine(),count=4000,selectedCount=800;
  let idReads=0;
  engine.doc.entities=Array.from({length:count},(_,i)=>{
    const entity=line(`entity-${i}`);
    Object.defineProperty(entity,'id',{enumerable:true,get(){idReads++;return `entity-${i}`;}});
    return entity;
  });
  const original=engine.doc,ids=Array.from({length:selectedCount},(_,i)=>`entity-${i}`);
  const copies=engine.execute({type:'copy',ids,dx:20,dy:30});
  // Count property reads instead of wall time: an N*S scan exceeds this bound
  // regardless of host load, while validation and immutable-copy scans fit it.
  assert.ok(idReads<30*(count+selectedCount),`COPY read IDs ${idReads} times`);
  assert.equal(copies.length,selectedCount);
  assert.equal(engine.doc.entities.length,count+selectedCount);
  assert.equal(engine.lastExecution.lightweight,true);
  assert.deepEqual(engine.doc.entities[count].points[0],{x:20,y:30});
  engine.execute({type:'undo'});
  assert.equal(engine.doc,original);
  assert.equal(engine.doc.entities.length,count);
  assert.deepEqual(engine.doc.entities[0].points[0],{x:0,y:0});
});

test('ERASE retains unselected order, ignores duplicate targets and supports undo/redo',()=>{
  const engine=new DrawingEngine();engine.doc.entities=['a','b','c','d'].map(id=>line(id));
  const original=engine.doc;
  engine.execute({type:'delete',ids:['c','a','c']});
  assert.deepEqual(engine.doc.entities.map(e=>e.id),['b','d']);
  engine.execute({type:'undo'});
  assert.equal(engine.doc,original);
  engine.execute({type:'redo'});
  assert.deepEqual(engine.doc.entities.map(e=>e.id),['b','d']);
});

test('ERASE rejects locked targets atomically and does not add an undo entry',()=>{
  const engine=new DrawingEngine();
  engine.doc.layers.push({id:'locked',name:'Locked',visible:true,locked:true});
  engine.doc.entities=[line('free'),line('locked',{layer:'locked'})];
  const original=engine.doc;
  assert.throws(()=>engine.execute({type:'delete',ids:['free','locked']}),/잠긴/);
  assert.equal(engine.doc,original);
  assert.deepEqual(engine.doc.entities.map(e=>e.id),['free','locked']);
  assert.equal(engine.undoStack.length,0);
});

test('large ERASE scans its target list a bounded number of times',()=>{
  const engine=new DrawingEngine(),count=4000,selectedCount=800;
  engine.doc.entities=Array.from({length:count},(_,i)=>line(`entity-${i}`));
  const original=engine.doc,ids=Array(selectedCount);let targetReads=0;
  for(let i=0;i<selectedCount;i++)Object.defineProperty(ids,i,{enumerable:true,
    get(){targetReads++;return `entity-${i}`;}});
  engine.execute({type:'delete',ids});
  // Array.includes repeatedly reads these entries; Set construction reads
  // each once. Counting accesses catches quadratic work without a timing gate.
  assert.ok(targetReads<20*(count+selectedCount),`ERASE read targets ${targetReads} times`);
  assert.equal(engine.lastExecution.lightweight,true);
  assert.equal(engine.doc.entities.length,count-selectedCount);
  assert.equal(engine.doc.entities[0].id,`entity-${selectedCount}`);
  engine.execute({type:'undo'});
  assert.equal(engine.doc,original);
  assert.equal(engine.doc.entities.length,count);
});

// 오토캐드 비교 측정(2026-10-30): 19만 개 전체 복사가 push(...xs) 호출 스택 초과로 멈췄다. 큰 배열도 끝까지 복사한다.
test('copy and move of 200k entities do not overflow the call stack',()=>{
 const engine=new DrawingEngine();engine.doc.entities=Array.from({length:200000},(_,i)=>line('l'+i));
 const ids=engine.doc.entities.map(e=>e.id);
 engine.execute({type:'copy',ids,dx:0,dy:100});assert.equal(engine.doc.entities.length,400000);
 engine.execute({type:'move',ids,dx:5,dy:0});assert.equal(engine.doc.entities[0].points[0].x,5);
});
