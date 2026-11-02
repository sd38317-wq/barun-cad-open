import test from 'node:test';
import assert from 'node:assert/strict';
import {createSlabStore,createStubTable,buildStubTable,createBodyStore,RESIDENT,ON_DISK,ERASED,LEAVE_ON_DISK,SLAB_SIZE} from './entity-stubs.js';

const box=e=>e?.points?{minX:Math.min(...e.points.map(p=>p.x)),minY:Math.min(...e.points.map(p=>p.y)),maxX:Math.max(...e.points.map(p=>p.x)),maxY:Math.max(...e.points.map(p=>p.y))}:null;
const line=(id,x,layer='0')=>({id,type:'line',layer,points:[{x,y:0},{x:x+10,y:10}]});

test('205 · 슬랩: 4096칸 묶음, slot>>12 로 바로 찾고, 지운 칸을 다시 쓴다',()=>{
  const s=createSlabStore();
  const slots=Array.from({length:SLAB_SIZE+5},()=>s.alloc());
  assert.equal(s.slabCount,2);assert.equal(s.slab(slots.at(-1)),s.slab(SLAB_SIZE));
  s.release(7);assert.equal(s.alloc(),7,'자유 목록 재사용');
  assert.equal(s.liveCount,SLAB_SIZE+5);
});

test('201 · 스텁 표: 본체를 접어 내리고 필요할 때만 다시 연다(바뀐 본체는 다시 접는다)',()=>{
  const t=createStubTable({boundsOf:box});
  const a=t.add(line('a',0,'벽')),b=t.add(line('b',100));
  assert.equal(t.open(a).id,'a');assert.ok(t.flags(a)&RESIDENT);
  assert.equal(t.layer(a),'벽');assert.equal(t.type(a),'line');assert.deepEqual(t.box(b),{minX:100,minY:0,maxX:110,maxY:10});
  assert.equal(t.evict(a),true);
  assert.equal(t.flags(a)&RESIDENT,0);assert.ok(t.flags(a)&ON_DISK);
  const back=t.open(a);assert.deepEqual(back,line('a',0,'벽'),'저장소에서 그대로 되살아난다');
  t.openForWrite(a).layer='새';t.evict(a);
  assert.equal(t.open(a).layer,'새','바뀐 본체는 잃지 않는다');
  assert.ok(t.stats().wastedBodyBytes>0,'옛 본체 자리는 낭비로 센다');
});

test('212 · 지우기는 비트 하나: 같은 상태면 아무것도 안 하고, 되돌리면 그대로 살아난다',()=>{
  const t=createStubTable({boundsOf:box}),a=t.add(line('a',0));
  assert.equal(t.erase(a,true),true);assert.equal(t.erase(a,true),false);
  assert.ok(t.flags(a)&ERASED);assert.equal(t.open(a),null);
  assert.deepEqual(t.query({minX:-1,minY:-1,maxX:50,maxY:50}),[]);
  t.erase(a,false);assert.equal(t.open(a).id,'a');assert.deepEqual(t.query({minX:-1,minY:-1,maxX:50,maxY:50}),[a]);
});

test('203 · 큰 블록의 하위 객체는 본체를 열지 않은 채 접어 두고, 범위 질의는 본체 없이 한다',()=>{
  const block={id:'B',type:'block',layer:'0',points:[{x:0,y:0},{x:1000,y:1000}],entities:Array.from({length:50},(_,i)=>line('c'+i,i*20))};
  const doc={entities:[block,line('x',5000,'도로')]};
  const t=buildStubTable(doc,{boundsOf:box,foldSubentsOver:10});
  const parent=t.slotOfId('B'),child=t.slotOfId('c3');
  assert.ok(t.flags(parent)&LEAVE_ON_DISK);assert.ok(t.flags(child)&LEAVE_ON_DISK);
  assert.equal(t.flags(child)&RESIDENT,0,'하위 본체는 내려가 있다');
  assert.equal(t.childrenOf(parent).length,50);
  assert.equal(t.open(child).id,'c3','편집할 때 꺼낼 수 있다');
  assert.deepEqual(t.query({minX:4000,minY:-1,maxX:6000,maxY:20}).map(s=>t.idOf(s)),['x']);
  assert.deepEqual(t.query({minX:0,minY:0,maxX:6000,maxY:20},{layers:['도로']}).map(s=>t.idOf(s)),['x']);
  assert.equal(t.leaveSubentsOnDisk(parent,true),false,'이미 같은 상태면 바꾸지 않는다');
  assert.equal(t.slotOfHandle(1),parent);
  const st=t.stats();assert.equal(st.slots,52);assert.ok(st.onDisk>=50);
});

test('201 · 본체 저장소는 큰 ArrayBuffer 페이지에 이어 붙인다',()=>{
  const store=createBodyStore({pageBytes:64});
  const keys=Array.from({length:10},(_,i)=>store.put({i,text:'가'.repeat(i)}));
  assert.equal(store.get(keys[9]).text,'가'.repeat(9));assert.ok(store.pageCount>1);
  store.discard(keys[0]);assert.throws(()=>store.get(keys[0]),/본체 위치 없음/);
});
