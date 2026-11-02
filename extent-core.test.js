import test from 'node:test';
import assert from 'node:assert/strict';
import {coreExtents} from './extent-core.js';

const box=e=>({minX:Math.min(e.a.x,e.b.x),minY:Math.min(e.a.y,e.b.y),maxX:Math.max(e.a.x,e.b.x),maxY:Math.max(e.a.y,e.b.y)});
const line=(id,x,y,w=5,h=5)=>({id,a:{x,y},b:{x:x+w,y:y+h}});
const plan=n=>Array.from({length:n},(_,i)=>line('p'+i,(i%40)*100,Math.floor(i/40)*100));

test('멀리 떨어진 부스러기 몇 개는 화면 맞춤에서 빼고 알린다', ()=>{
 const far=[line('far1',5e7,5e7),line('far2',-3e7,0)];
 const r=coreExtents([...plan(400),...far],box);
 assert.equal(r.farCount,2);
 assert.deepEqual(r.far.map(e=>e.id).sort(),['far1','far2']);
 assert.ok(r.core.maxX<5000&&r.core.minX>=0,'본 도면 범위만');
 assert.ok(r.all.maxX>4e7,'전체 범위는 그대로');
});

test('두 덩어리로 나뉜 정상 도면(시트 두 장)은 빼지 않는다', ()=>{
 const a=plan(300),b=plan(300).map(e=>({...e,id:'b'+e.id,a:{x:e.a.x+1e6,y:e.a.y},b:{x:e.b.x+1e6,y:e.b.y}}));
 const r=coreExtents([...a,...b],box);
 assert.equal(r.farCount,0);
 assert.deepEqual(r.core,r.all);
});

test('멀리 있는 것이 많으면(2% 넘음) 뺄 대상이 아니다', ()=>{
 const far=Array.from({length:30},(_,i)=>line('f'+i,5e7+i,5e7));
 assert.equal(coreExtents([...plan(400),...far],box).farCount,0);
});

test('조금만 떨어진 객체(범위를 10배 넘게 늘리지 않음)는 그대로 둔다', ()=>{
 assert.equal(coreExtents([...plan(400),line('near',12000,0)],box).farCount,0);
});

test('객체가 적거나 범위가 없는 객체는 판단하지 않는다', ()=>{
 assert.equal(coreExtents([line('a',0,0),line('b',1e9,1e9)],box).farCount,0);
 const r=coreExtents([...plan(100),{id:'x'}],e=>e.a?box(e):null);
 assert.equal(r.farCount,0);
 assert.equal(coreExtents([],box).core,null);
});

test('20만 객체도 빨리 끝난다', ()=>{
 const many=plan(200000);many.push(line('far',9e8,9e8));
 const t=performance.now(),r=coreExtents(many,box);
 assert.equal(r.farCount,1);
 assert.ok(performance.now()-t<400,'느림: '+(performance.now()-t));
});
