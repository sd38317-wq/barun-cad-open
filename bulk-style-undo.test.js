import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine,STYLE_FAST_LIMIT} from './engine.js';

const line=(id,y,extra={})=>({id,type:'line',layer:'default',points:[{x:0,y},{x:100,y}],...extra});
function drawing(count){
  const e=new DrawingEngine();
  e.execute({type:'layer.add',name:'A-WALL',color:'#ff0000'});
  e.execute({type:'load',document:{...e.doc,entities:Array.from({length:count},(_,i)=>line('l'+i,i*10))}});
  return {e,wall:e.doc.layers.find(l=>l.name==='A-WALL').id};
}

test('210 · 100개 넘는 레이어 바꾸기: 화면은 예전처럼 전체(lightweight=false), 엔진은 바뀐 객체만 새로(나머지 공유)',()=>{
  const {e,wall}=drawing(1000),before=e.doc,ids=before.entities.slice(0,300).map(x=>x.id);
  assert.ok(ids.length>STYLE_FAST_LIMIT);
  e.execute({type:'update',ids,changes:{layer:wall}});
  assert.equal(e.lastExecution.lightweight,false,'화면 경로는 6.0.18 A/B 결과 그대로');
  assert.equal(e.lastExecution.bulkStyle,true);
  const after=e.doc;
  let shared=0;for(let i=0;i<after.entities.length;i++)if(after.entities[i]===before.entities[i])shared++;
  assert.equal(shared,700,'바뀌지 않은 700개는 같은 객체(문서 사본 없음)');
  assert.ok(after.entities.slice(0,300).every(x=>x.layer===wall));
  e.execute({type:'undo'});
  assert.equal(e.doc,before,'되돌리기는 이전 문서로');
  assert.equal(e.lastExecution.rebuild,true,'되돌릴 때도 화면은 전체 다시 그리기(예전과 같은 길)');
  e.execute({type:'redo'});assert.equal(e.doc,after);
});

test('210 · 잠긴 레이어·벽·연동 객체가 끼면 예전 전체 경로(검사도 예전 그대로)',()=>{
  const {e,wall}=drawing(200);
  e.execute({type:'add',entity:{id:'w',type:'wall',layer:'default',points:[{x:0,y:-500},{x:900,y:-500}],thickness:100}});
  const ids=e.doc.entities.slice(0,150).map(x=>x.id);
  e.execute({type:'update',ids:[...ids,'w'],changes:{color:'#00ff00'}});
  assert.equal(e.lastExecution.bulkStyle,false,'벽이 끼면 전체 동기화');
  e.execute({type:'layer.update',id:'default',changes:{locked:true}});
  assert.throws(()=>e.execute({type:'update',ids,changes:{layer:wall}}),/잠긴 레이어/);
});

test('210 · 되돌리기 문서가 객체 사본을 잡지 않는다(메모리: 바뀐 객체 수만큼)',()=>{
  const {e,wall}=drawing(5000),ids=e.doc.entities.slice(0,1000).map(x=>x.id);
  const before=new Set(e.doc.entities);
  e.execute({type:'update',ids,changes:{layer:wall}});
  e.execute({type:'update',ids,changes:{color:'#123456'}});
  const objects=new Set();for(const doc of [...e.undoStack,e.doc])for(const x of doc.entities)objects.add(x);
  // 예전(문서 전체 복사)이라면 5000 × 3 = 15000 개. 지금은 5000 + 1000 + 1000.
  assert.equal(objects.size,7000);
  assert.ok([...before].every(x=>objects.has(x)));
  e.bulkStyleCow=false;e.execute({type:'update',ids,changes:{color:'#654321'}});
  assert.equal(e.lastExecution.bulkStyle,false,'끄면 예전 경로');
});
