import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {prepareUnitInsertion} from './unit-insertion.js';
import {createBridgeBinding,createBoundRequestHandler} from './bridge-client.js';
function detail(){return {id:'UN-1',name:'84A 4.5베이',type_name:'84A',exclusive_area_m2:84,bays:4.5,rooms:3,bathrooms:2,core_form:'계단실형',usable_as_unit:true,scale_verified:true,review_required:true,review_reasons:['전용 경계 확인 필요'],geometry:{units:'mm',layers:[{id:'wall',name:'A-WALL',label:'벽',color:'#ffffff',visible:true,plot:true},{id:'area',name:'A-AREA',label:'세대 경계',color:'#ffffff',visible:true,plot:true}],entities:[{id:'line',type:'line',layer:'wall',points:[{x:1000,y:0},{x:3000,y:0}]},{id:'outline',type:'polyline',layer:'area',closed:true,points:[{x:0,y:0},{x:3000,y:0},{x:3000,y:5000},{x:0,y:5000}]}]}};}
function harness(){
 const engine=new DrawingEngine();let drawing='one';
 const context={engine,execute:c=>engine.execute(c),getDrawingId:()=>drawing,selected:()=>new Set(),refresh(){}};
 const binding=createBridgeBinding(context),target={...binding.current(),backend_generation:crypto.randomUUID(),snapshot_id:crypto.randomUUID()};
 binding.receive({protocol_version:1,backend_generation:target.backend_generation,target});
 return {engine,target,handler:createBoundRequestHandler(context,binding),switchDrawing:()=>{drawing='two';},request(extra={}){return {id:crypto.randomUUID(),expires_at:Date.now()+25000,action:'cad_insert_unit',args:{target,id:'UN-1',detail:detail(),position:{x:10000,y:20000},rotation:90,mirror:true,...extra}};}};
}
test('real bound handler applies mirror then rotation and translation, preserves metadata, replays once and undoes in one step',()=>{
 const h=harness(),before=structuredClone(h.engine.doc),request=h.request(),response=h.handler(request);
 assert.equal(response.error,undefined);assert.equal(response.result.applied,true);assert.equal(response.result.unit_id,'UN-1');
 assert.equal(h.engine.doc.entities.length,1);assert.equal(h.engine.undoStack.length,1);
 const block=h.engine.doc.entities[0];assert.equal(block.type,'block');assert.equal(block.unit.bays,4.5);assert.equal(block.attributes.UNIT_ID,'UN-1');assert.equal(block.unit.review_required,true);assert.deepEqual(block.unit.review_reasons,['전용 경계 확인 필요']);
 const points=block.entities[0].points;
 assert.ok(Math.abs(points[0].x-10000)<1e-8);assert.equal(points[0].y,19000);
 assert.ok(Math.abs(points[1].x-10000)<1e-8);assert.equal(points[1].y,17000);
 assert.equal(h.handler(request).error,undefined);assert.equal(h.engine.doc.entities.length,1);assert.equal(h.engine.undoStack.length,1);
 h.engine.execute({type:'undo'});assert.deepEqual(h.engine.doc,before);
});
test('zero rotation keeps real mm dimensions and source data unmodified',()=>{
 const h=harness(),d=detail(),original=structuredClone(d),result=prepareUnitInsertion(h.engine.doc,{detail:d,position:{x:10,y:20}});
 assert.deepEqual(result.block.entities[0].points,[{x:1010,y:20},{x:3010,y:20}]);assert.deepEqual(d,original);assert.equal(h.engine.doc.entities.length,0);
});
test('standard layer reused by name and origin ignores annotation bounds',()=>{
 const h=harness(),d=detail();h.engine.doc.layers.push({...d.geometry.layers[0],id:'existing'});d.bounds={minX:-5000,minY:-10000,maxX:9000,maxY:9000};
 const result=prepareUnitInsertion(h.engine.doc,{detail:d,position:{x:10,y:20}});
 assert.equal(result.block.entities[0].layer,'existing');assert.equal(result.document.layers.filter(l=>l.name==='A-WALL').length,1);assert.deepEqual(result.block.position,{x:10,y:20});
});
test('switched drawing rejects without changes or undo entry',()=>{
 const h=harness(),before=structuredClone(h.engine.doc);h.switchDrawing();assert.ok(h.handler(h.request()).error);assert.deepEqual(h.engine.doc,before);assert.equal(h.engine.undoStack.length,0);
});
for(const field of ['locked','frozen','hidden','visible','plot'])test('unavailable standard layer rejects atomically: '+field,()=>{
 const h=harness(),d=detail();h.engine.doc.layers.push({...d.geometry.layers[0],id:'existing',[field]:!['visible','plot'].includes(field)});
 const before=structuredClone(h.engine.doc);assert.ok(h.handler(h.request()).error);assert.deepEqual(h.engine.doc,before);assert.equal(h.engine.undoStack.length,0);
});
for(const problem of ['unverified','unusable','missing use flag','wrong units','missing layer','fake layer','duplicate layer id','shared block','malformed geometry'])test('invalid unit rejects atomically: '+problem,()=>{
 const h=harness(),d=detail();
 if(problem==='unverified')delete d.scale_verified;
 if(problem==='unusable')d.usable_as_unit=false;
 if(problem==='missing use flag')delete d.usable_as_unit;
 if(problem==='wrong units')d.geometry.units='m';
 if(problem==='missing layer')d.geometry.entities[0].layer='missing';
 if(problem==='fake layer')d.geometry.layers[0].name='A-FAKE';
 if(problem==='duplicate layer id')d.geometry.layers[1].id='wall';
 if(problem==='shared block')d.geometry.entities[0].sharedBlock='missing';
 if(problem==='malformed geometry')d.geometry.entities[0].points[0].x=NaN;
 const before=structuredClone(h.engine.doc);assert.ok(h.handler(h.request({detail:d})).error);assert.deepEqual(h.engine.doc,before);assert.equal(h.engine.undoStack.length,0);
});
for(const args of [{scale:2},{rotation:NaN},{position:{x:0,y:Infinity}},{mirror:'false'}])test('invalid transform rejects '+JSON.stringify(args),()=>{
 const h=harness(),before=structuredClone(h.engine.doc);assert.ok(h.handler(h.request(args)).error);assert.deepEqual(h.engine.doc,before);assert.equal(h.engine.undoStack.length,0);
});

test('server unit insertion retains submillimetre marks and hidden account signature',()=>{
 const engine=new DrawingEngine(),source=detail();source.server_asset=true;
 source.geometry.entities[0].points[0].x+=0.004;source.geometry.entities[0].points[0].y-=0.004;
 source.geometry.entities[0].xdata={BARUN_WM:['barun-asset/1','unit',source.id,'abcdef123456']};
 const before=structuredClone(source),r=prepareUnitInsertion(engine.doc,{detail:source,position:{x:1000,y:2000},rotation:90,mirror:true});
 assert.deepEqual(source,before);assert.deepEqual(r.block.entities[0].xdata,source.geometry.entities[0].xdata);
 const p=r.block.entities[0].points[0],original=source.geometry.entities[0].points[0];
 assert.ok(Math.abs(p.x-(1000-original.y))<1e-8);assert.ok(Math.abs(p.y-(2000-original.x))<1e-8);
 engine.validate(r.document);
});
