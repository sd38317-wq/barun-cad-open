import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DrawingEngine,styleEditIds,STYLE_FAST_LIMIT} from './engine.js';

const line=(id,y)=>({id,type:'line',layer:'default',points:[{x:0,y},{x:100,y}]});
function engineWith(count=50){
 const engine=new DrawingEngine();
 engine.execute({type:'layer.add',name:'A-WALL',color:'#ff0000'});
 const wall=engine.doc.layers.find(l=>l.name==='A-WALL').id;
 engine.execute({type:'addMany',entities:Array.from({length:count},(_,i)=>line('l'+i,i*10))});
 return {engine,wall,ids:engine.doc.entities.map(e=>e.id)};
}

test('레이어·색만 바꾸는 명령만 가벼운 편집으로 본다',()=>{
 assert.deepEqual(styleEditIds({type:'update',ids:['a'],changes:{layer:'x'}}),['a']);
 assert.deepEqual(styleEditIds({type:'batch',commands:[{type:'updateMany',updates:[{id:'a',changes:{color:'#f00',aci:1,colorMode:'aci'}},{id:'b',changes:{lineweight:0.3}}]}]}),['a','b']);
 assert.equal(styleEditIds({type:'update',ids:['a'],changes:{radius:3}}),null);
 assert.equal(styleEditIds({type:'batch',commands:[{type:'update',ids:['a'],changes:{layer:'x'}},{type:'move',ids:['a'],dx:1,dy:0}]}),null);
 assert.equal(styleEditIds({type:'update',ids:['a'],changes:{}}),null);
});

test('속성 창의 레이어·색 바꾸기는 바뀐 선만 새 객체로 갈아 끼우고, 나머지·되돌리기 기록은 그대로 둔다',()=>{
 const {engine,wall,ids}=engineWith();
 const before=engine.doc,target=before.entities.find(e=>e.id===ids[3]),other=before.entities.find(e=>e.id===ids[4]);
 const result=engine.execute({type:'batch',commands:[{type:'updateMany',updates:[{id:ids[3],changes:{layer:wall}},{id:ids[3],changes:{color:'#00ff00',aci:3,colorMode:'aci'}}]}]});
 assert.deepEqual(result,[ids[3]]);
 assert.equal(engine.lastExecution.lightweight,true,'전체 동기화 경로로 가면 도면 전체를 다시 그린다');
 const after=engine.doc.entities.find(e=>e.id===ids[3]);
 assert.equal(after.layer,wall);assert.equal(after.color,'#00ff00');
 assert.notEqual(after,target);
 assert.equal(target.layer,'default','되돌리기 기록의 객체를 고치면 안 된다');assert.equal(target.color,undefined);
 assert.equal(engine.doc.entities.find(e=>e.id===ids[4]),other,'다른 객체는 그대로 같은 객체');
 engine.execute({type:'undo'});
 assert.equal(engine.doc.entities.find(e=>e.id===ids[3]).layer,'default');
});

test('잠긴 레이어 객체와 벽은 여전히 막거나 전체 동기화로 간다',()=>{
 const {engine,wall,ids}=engineWith(3);
 engine.execute({type:'layer.update',id:'default',changes:{locked:true}});
 assert.throws(()=>engine.execute({type:'update',ids:[ids[0]],changes:{layer:wall}}),/잠긴/);
});

test('화면 쪽 execute 가 레이어·색 바꾸기를 바뀐 객체만 갈아 끼우는 경로로 보낸다',()=>{
 const source=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 assert.match(source,/const styleIds=appendOnly\|\|typeof styleEditIds!=='function'\?null:styleEditIds\(c\);/);
 assert.match(source,/const cacheDelta=appendOnly\|\|!!styleIds\|\|/);
});

test('large style edits go back to the background rebuild path (A/B: 500 objects were slower on the fast path)',()=>{
 const ids=Array.from({length:STYLE_FAST_LIMIT+1},(_,i)=>'e'+i);
 assert.equal(styleEditIds({type:'update',ids,changes:{color:'#ff0000'}}),null);
 assert.deepEqual(styleEditIds({type:'update',ids:ids.slice(0,STYLE_FAST_LIMIT),changes:{color:'#ff0000'}}),ids.slice(0,STYLE_FAST_LIMIT));
 assert.equal(styleEditIds({type:'batch',commands:[{type:'update',ids:ids.slice(0,60),changes:{layer:'x'}},{type:'update',ids:ids.slice(60),changes:{layer:'x'}}]}),null);
});
