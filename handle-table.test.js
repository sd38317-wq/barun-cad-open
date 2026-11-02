import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandleTable,parseHandle,formatHandle} from './handle-table.js';

test('204 · 핸들 표: 넣기·찾기·지우기, 중복 거절, 성긴 핸들, 빈 잎 반납',()=>{
  const t=createHandleTable();
  t.set(0x1F,5);t.set(0x20,6);t.set(0xABCDEF01,7);
  assert.equal(t.get(0x1F),5);assert.equal(t.get(0x20),6);assert.equal(t.get(0xABCDEF01),7);
  assert.equal(t.get(0x21),-1);assert.equal(t.get(0x12345678),-1);
  assert.throws(()=>t.set(0x20,9),/핸들 중복/);
  assert.equal(t.size,3);assert.equal(t.leafCount,2);
  assert.equal(t.remove(0xABCDEF01),true);assert.equal(t.leafCount,1,'빈 잎은 돌려준다');
  assert.equal(t.get(0xABCDEF01),-1);assert.equal(t.remove(0xABCDEF01),false);
});

test('204 · 핸들 오름차순 돌기(정렬 없이)와 다음 핸들',()=>{
  const t=createHandleTable(),hs=[0x400,0x3,0xFFFFFFF0,0x401,0x80000000];
  hs.forEach((h,i)=>t.set(h,i));
  const seen=[];t.forEach((h,slot)=>seen.push([h,slot]));
  assert.deepEqual(seen.map(x=>x[0]),[...hs].sort((a,b)=>a-b));
  assert.equal(t.nextHandle(),0xFFFFFFF1);
});

test('204 · DXF 16진 핸들을 정수로',()=>{
  assert.equal(parseHandle('1F'),31);assert.equal(parseHandle(' abcdef01 '),0xabcdef01);
  assert.equal(parseHandle('123456789'),null,'32비트를 넘으면 문자열 경로로');
  assert.equal(parseHandle('zz'),null);assert.equal(formatHandle(255),'FF');
});

test('204 · 이웃 핸들 20만 개를 넣고 찾는다(마지막 잎 재사용)',()=>{
  const t=createHandleTable(),n=200000;
  for(let h=1;h<=n;h++)t.set(h,h-1);
  let ok=true;for(let h=1;h<=n;h++)if(t.get(h)!==h-1){ok=false;break;}
  assert.ok(ok);assert.equal(t.size,n);assert.equal(t.leafCount,Math.ceil((n+1)/256));
});
