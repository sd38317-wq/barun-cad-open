import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {buildRoomSchedule,refreshRoomSchedule} from './room-schedule.js';
const p=(x,y)=>({x,y});
const rect=(x,y,w,h,extra={})=>({type:'polyline',closed:true,layer:'default',points:[p(x,y),p(x+w,y),p(x+w,y+h),p(x,y+h)],...extra});
const label=(text,x,y)=>({type:'text',text,position:p(x,y),height:200,layer:'default'});
function drawing(){
 const e=new DrawingEngine();
 for(const entity of [rect(0,0,4000,3000,{id:'living'}),{...label('거실',1000,1000),id:'living-label'},rect(5000,0,3000,3000,{id:'bed',room:{name:'침실',floor:'1F'}}),rect(20000,0,1000,1000,{id:'other'})])e.execute({type:'add',entity});
 const ids=['living','bed','living-label'];
 e.execute({type:'add',entity:{...buildRoomSchedule(e.doc,{ids,floor:'1F'}).entity,id:'table'}});
 return e;
}
const total=e=>e.doc.entities.find(x=>x.id==='table').table.rows.at(-1)[3];

test('실 경계 꼭짓점을 옮기면 면적표가 같은 되돌리기 단계 안에서 다시 계산된다',()=>{
 const e=drawing();assert.equal(total(e),21);
 const living=e.doc.entities.find(x=>x.id==='living');
 e.execute({type:'update',ids:['living'],changes:{points:living.points.map(q=>q.x>0?{...q,x:6000-1000}:q)}});
 assert.equal(total(e),24);
 e.execute({type:'undo'});assert.equal(total(e),21);
});

test('이동처럼 가벼운 편집도 면적표가 집계한 객체면 갱신하고, 집계 밖 객체는 가벼운 길 그대로',()=>{
 const e=drawing();
 e.execute({type:'move',ids:['bed'],dx:0,dy:0.001});assert.equal(e.lastExecution.lightweight,false);
 e.execute({type:'move',ids:['other'],dx:100,dy:0});assert.equal(e.lastExecution.lightweight,true);
 const before=e.doc.entities.find(x=>x.id==='table');
 e.execute({type:'update',ids:['bed'],changes:{room:{name:'침실',floor:'1F'}}});
 assert.equal(e.doc.entities.find(x=>x.id==='table').table.rows.length,before.table.rows.length);
});

test('실명을 바꾸면 표의 실명도 바뀐다',()=>{
 const e=drawing();
 e.execute({type:'update',ids:['bed'],changes:{room:{name:'서재',floor:'1F'}}});
 assert.ok(e.doc.entities.find(x=>x.id==='table').table.rows.some(r=>r[1]==='서재'));
});

test('집계한 경계를 지워 다시 만들 수 없으면 값은 두고 이유를 남긴다',()=>{
 const e=drawing();
 e.execute({type:'delete',ids:['living','bed']});
 const table=e.doc.entities.find(x=>x.id==='table');
 assert.ok(table.roomSchedule.stale);assert.equal(table.table.rows.at(-1)[3],21);
});

test('예전 판의 표(지문 없음)는 처음에 지문만 남기고 값을 바꾸지 않는다',()=>{
 const e=drawing(),table=structuredClone(e.doc.entities.find(x=>x.id==='table'));delete table.roomSchedule.fingerprint;
 const next=refreshRoomSchedule(e.doc,table);
 assert.ok(next.roomSchedule.fingerprint);assert.deepEqual(next.table.rows,table.table.rows);
 assert.equal(refreshRoomSchedule(e.doc,next),null);
});
