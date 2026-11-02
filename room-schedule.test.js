import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {buildRoomSchedule,lineRooms} from './room-schedule.js';
import {parseActions,stageActions} from './ai-actions.js';
const p=(x,y)=>({x,y});
const rect=(x,y,w,h,extra={})=>({type:'polyline',closed:true,layer:'default',points:[p(x,y),p(x+w,y),p(x+w,y+h),p(x,y+h)],...extra});
const label=(text,x,y)=>({type:'text',text,position:p(x,y),height:200,layer:'default'});
const engine=entities=>{const e=new DrawingEngine();e.execute({type:'addMany',entities});return e;};
test('labels, metadata floors, raw sums and grouped subtotals produce editable table',()=>{
 const e=engine([rect(0,0,4000,3000),label('거실',1000,1000),rect(5000,0,4000,3000),label('거실',6000,1000),rect(0,5000,2000,2000,{room:{name:'침실',floor:'2F'}})]);
 const before=JSON.stringify(e.doc),r=buildRoomSchedule(e.doc,{floor:'1F'});
 assert.equal(r.totalM2,28);assert.deepEqual(r.entity.table.rows[1],['1F','거실',2,24,7.26]);assert.equal(r.rooms.length,3);
 assert.equal(JSON.stringify(e.doc),before);e.execute({type:'add',entity:r.entity});e.validate(e.doc);e.execute({type:'undo'});assert.equal(JSON.stringify(e.doc),before);
});
test('straight lines with shared wall, T intersections and duplicates give two rooms',()=>{
 const pairs=[[p(0,0),p(8000,0)],[p(8000,0),p(8000,3000)],[p(8000,3000),p(0,3000)],[p(0,3000),p(0,0)],[p(4000,0),p(4000,3000)],[p(0,0),p(8000,0)]];
 const es=pairs.map(points=>({type:'line',layer:'default',points}));assert.equal(lineRooms(es).length,2);
 const r=buildRoomSchedule(engine([...es,label('거실',1000,1000),label('침실',5000,1000)]).doc);assert.equal(r.totalM2,24);assert.equal(r.rooms.length,2);
});
test('open lines do not invent an enclosure',()=>{assert.equal(lineRooms([{type:'line',points:[p(0,0),p(1000,0)]}]).length,0);assert.throws(()=>buildRoomSchedule(engine([rect(0,0,4000,3000,{closed:false}),label('실',1000,1000)]).doc),/닫힌/);});
test('decimal midpoint rounds up and concave cutouts cannot be bridged by deduction edges',()=>{
 const e=engine([rect(0,0,11000,3000,{room:{name:'실'}})]);assert.equal(buildRoomSchedule(e.doc).entity.table.rows.at(-1)[4],9.983);
 const outer=[p(0,0),p(10000,0),p(10000,10000),p(8000,10000),p(8000,3000),p(7000,3000),p(7000,10000),p(0,10000)];
 const f=engine([{type:'hatch',layer:'default',points:outer,loops:[rect(1000,4000,8000,1000).points],room:{name:'실'}}]);assert.throws(()=>buildRoomSchedule(f.doc),/실 밖/);
});
test('hatch holes and explicit deduction layers subtract exact area',()=>{
 const e=engine([rect(0,0,4000,4000,{type:'hatch',loops:[rect(1000,1000,2000,2000).points]}),label('실',500,500)]);assert.equal(buildRoomSchedule(e.doc).totalM2,12);
 const f=engine([rect(0,0,4000,4000),label('실',500,500)]);f.execute({type:'layer.add',name:'공제',color:'#ffffff'});const holeLayer=f.doc.layers.find(l=>l.name==='공제').id;
 f.execute({type:'add',entity:rect(1000,1000,2000,2000,{layer:holeLayer})});assert.equal(buildRoomSchedule(f.doc,{holeLayers:['공제']}).totalM2,12);
 assert.throws(()=>buildRoomSchedule(f.doc,{holeLayers:['공제 오타']}),/레이어 이름/);
 assert.throws(()=>buildRoomSchedule(f.doc,{ids:[f.doc.entities[0].id],holeLayers:['공제']}),/함께 선택/);
});
test('duplicate boundaries are counted once, conflicting labels are rejected',()=>{
 const e=engine([rect(0,0,4000,3000),rect(0,0,4000,3000),label('실',1000,1000)]);assert.equal(buildRoomSchedule(e.doc).totalM2,12);
 e.execute({type:'add',entity:label('다른 실',2000,1000)});assert.throws(()=>buildRoomSchedule(e.doc),/여러 개/);
});
test('overlapping rooms and deductions are rejected, shared boundaries allowed',()=>{
 const e=engine([rect(0,0,4000,3000,{room:{name:'A'}}),rect(2000,0,4000,3000,{room:{name:'B'}})]);assert.throws(()=>buildRoomSchedule(e.doc),/겹칩니다/);
 const f=engine([rect(0,0,5000,5000,{type:'hatch',room:{name:'실'},loops:[rect(500,500,2000,2000).points,rect(1500,500,2000,2000).points]})]);assert.throws(()=>buildRoomSchedule(f.doc),/겹칩니다/);
});
test('unsupported scope and ambiguous boundary labels never silently produce a total',()=>{
 const e=engine([rect(0,0,4000,3000),label('실',0,1000)]);assert.throws(()=>buildRoomSchedule(e.doc),/경계선 위/);
 const f=engine([rect(0,0,4000,3000,{room:{name:'실'}}),{type:'circle',center:p(9000,9000),radius:100,layer:'default'}]);assert.throws(()=>buildRoomSchedule(f.doc),/직선 경계/);assert.equal(buildRoomSchedule(f.doc,{ids:[f.doc.entities[0].id]}).totalM2,12);
});
test('AI schedule uses existing geometry, stays atomic and rejects invented area inputs',()=>{
 const e=engine([rect(0,0,4000,3000),label('거실',1000,1000)]),before=JSON.stringify(e.doc);
 const plan=actions=>parseActions(JSON.stringify({actions,ask:null,note:null}));
 const r=stageActions(e,plan([{cmd:'room_schedule',args:{floor:'1F'}}]));assert.equal(r.document.entities.at(-1).roomSchedule.rooms[0].areaM2,12);assert.equal(JSON.stringify(e.doc),before);
 assert.throws(()=>stageActions(e,plan([{cmd:'room_schedule',args:{}},{cmd:'circle',args:{center:p(0,0),radius:-1}}])));assert.equal(JSON.stringify(e.doc),before);
 assert.throws(()=>stageActions(e,plan([{cmd:'room_schedule',args:{area:999}}])));
 e.execute({type:'load',document:r.document});e.execute({type:'undo'});assert.equal(JSON.stringify(e.doc),before);
});
