import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneWithIdMap,forEachIdRef,translateIdRefs} from './entity-refs.js';
import {commitEntities,dependentsOf,entityIndex,resetEntityIndex} from './entity-index.js';
import {DrawingEngine} from './engine.js';

test('222 · 깊은 복제는 복제 범위 안의 참조만 새 id 로 옮기고 밖은 그대로 둔다',()=>{
  let n=0;const newId=()=>'n'+(++n);
  const wall={id:'w',type:'wall'},door={id:'d',type:'block',hostWall:'w'},tag={id:'t',type:'text',roomBoundary:'r-outside'};
  const table={id:'s',type:'block',roomSchedule:{sourceIds:['w','zz']},scheduleIds:['d','q']};
  const {copies,map}=cloneWithIdMap([wall,door,tag,table],{newId});
  assert.deepEqual(copies.map(c=>c.id),['n1','n2','n3','n4']);
  assert.equal(copies[1].hostWall,'n1','복사한 문은 복사한 벽에 걸린다');
  assert.equal(copies[2].roomBoundary,'r-outside','범위 밖 참조는 그대로');
  assert.deepEqual(copies[3].roomSchedule.sourceIds,['n1','zz']);
  assert.deepEqual(copies[3].scheduleIds,['n2','q']);
  assert.equal(map.get('w'),'n1');
  assert.equal(door.hostWall,'w','원본은 건드리지 않는다');
  const cut={hostWall:'x',scheduleIds:['x','w']};translateIdRefs(cut,new Map([['w','W']]),{keepOutside:false});
  assert.equal(cut.hostWall,undefined);assert.deepEqual(cut.scheduleIds,['W']);
  const seen=[];forEachIdRef(table,(id,kind)=>seen.push(kind+':'+id));
  assert.deepEqual(seen,['roomSchedule:w','roomSchedule:zz','scheduleIds:d','scheduleIds:q']);
});

test('221 · 역참조 색인은 커밋 차이로 O(바뀐 것) 갱신되고 dependentsOf 가 훑지 않고 답한다',()=>{
  resetEntityIndex();
  const w={id:'w'},d1={id:'d1',hostWall:'w'},d2={id:'d2',hostWall:'w'},line={id:'l'};
  const a=[w,d1,d2,line];commitEntities(a);
  assert.deepEqual([...dependentsOf(a,['w'])].sort(),['d1','d2']);
  assert.equal(dependentsOf(a,['l']).size,0);
  const d1b={id:'d1',hostWall:'w2'},b=[w,d1b,d2,line];commitEntities(b);
  assert.deepEqual([...dependentsOf(b,['w'])],['d2'],'바뀐 문은 옛 벽 목록에서 빠진다');
  assert.deepEqual([...dependentsOf(b,['w2'])],['d1']);
  assert.equal(entityIndex(b).refs.get('w').size,1);
  const c=[w,d2,line];commitEntities(c);
  assert.equal(dependentsOf(c,['w2']).size,0,'지운 문의 역참조도 빠진다');
  assert.equal(dependentsOf([w],['w']),null,'커밋 안 된 배열은 null(예전 훑기로)');
});

test('221 · 벽이 있는 도면에서 벽과 무관한 선 이동은 가벼운 경로, 문이 걸린 벽 이동은 전체 동기화',()=>{
  const e=new DrawingEngine();
  e.execute({type:'add',entity:{id:'w',type:'wall',layer:'default',points:[{x:0,y:0},{x:5000,y:0}],thickness:200}});
  e.execute({type:'add',entity:{id:'l',type:'line',layer:'default',points:[{x:0,y:1000},{x:100,y:1000}]}});
  e.execute({type:'add',entity:{id:'t',type:'text',layer:'default',text:'실',position:{x:0,y:0},height:100,roomBoundary:'l'}});
  e.execute({type:'move',ids:['l'],dx:10,dy:0});
  assert.equal(e.lastExecution.lightweight,false,'실 이름표가 걸린 경계선은 전체 동기화');
  e.execute({type:'add',entity:{id:'free',type:'line',layer:'default',points:[{x:0,y:2000},{x:100,y:2000}]}});
  e.execute({type:'move',ids:['free'],dx:10,dy:0});
  assert.equal(e.lastExecution.lightweight,true,'아무도 보지 않는 선은 가벼운 경로');
});

test('222 · 엔진 복사는 함께 복사한 경계를 이름표가 따라간다',()=>{
  const e=new DrawingEngine();
  e.execute({type:'add',entity:{id:'room',type:'polyline',closed:true,layer:'default',points:[{x:0,y:0},{x:100,y:0},{x:100,y:100}]}});
  e.execute({type:'add',entity:{id:'tag',type:'text',layer:'default',text:'방',position:{x:10,y:10},height:10,roomBoundary:'room'}});
  const ids=e.execute({type:'copy',ids:['room','tag'],dx:1000,dy:0});
  const [room,tag]=ids.map(id=>e.doc.entities.find(x=>x.id===id));
  assert.equal(tag.roomBoundary,room.id);
});
