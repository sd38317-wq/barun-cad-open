import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DrawingEngine,removeEntities} from './engine.js';

const line=(id,y,layer='default')=>({id,type:'line',layer,points:[{x:0,y},{x:100,y}]});

test('212 · 포인터로 빼낸 배열은 filter 와 같은 결과(순서 보존, 원본 그대로)',()=>{
  const list=Array.from({length:40},(_,i)=>line('l'+i,i));
  const few=[list[0],list[17],list[39]],many=list.filter((_,i)=>i%3===0);
  assert.deepEqual(removeEntities(list,few),list.filter(e=>!few.includes(e)));
  assert.deepEqual(removeEntities(list,many),list.filter(e=>!many.includes(e)));
  assert.equal(removeEntities(list,[]),list);
  const copy={...list[5]};
  assert.deepEqual(removeEntities(list,[copy]).map(e=>e.id),list.filter(e=>e.id!=='l5').map(e=>e.id),'같은 id 의 사본도 지운다');
  assert.equal(list.length,40,'원본 배열(되돌리기 기록)은 그대로');
});

test('212 · 엔진 삭제: 가벼운 경로는 판정 때 찾은 대상을 다시 훑지 않고 지우며, 잠금·되돌리기는 그대로',()=>{
  const e=new DrawingEngine();
  e.execute({type:'load',document:{...e.doc,entities:Array.from({length:100},(_,i)=>line('l'+i,i))}});
  const before=e.doc;
  e.execute({type:'delete',ids:['l3','l50']});
  assert.equal(e.lastExecution.scopedEdit,true);
  assert.equal(e.doc.entities.length,98);assert.ok(!e.doc.entities.some(x=>x.id==='l3'||x.id==='l50'));
  assert.equal(e.doc.entities[3],before.entities[4],'남은 객체는 같은 객체');
  e.execute({type:'undo'});assert.equal(e.doc,before);
  e.execute({type:'layer.update',id:'default',changes:{locked:true}});
  assert.throws(()=>e.execute({type:'delete',ids:['l1']}),/잠긴 레이어/);
  assert.equal(e.doc.entities.length,100);
});

test('212 · 엔진은 지울 때 문자열 id 로 도면 전체를 다시 훑지 않는다(소스 확인)',()=>{
  const source=readFileSync(new URL('./engine.js',import.meta.url),'utf8');
  const start=source.indexOf('case "delete": {'),body=source.slice(start,source.indexOf('case "move":',start));
  assert.match(body,/removeEntities\(this\.doc\.entities,targets\)/);
  assert.doesNotMatch(body,/filter\(\s*\(e\) => !ids\.has\(e\.id\)/);
});
