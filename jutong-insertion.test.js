import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {prepareJutongInsertion} from './jutong-insertion.js';
import {createBridgeBinding,createBoundRequestHandler} from './bridge-client.js';
function detail(){return {id:'JT-test',name:'2코어 4세대 84A×4',scale_verified:true,review_required:true,form:'판상형 일자',core_count:2,units_per_floor:4,width_mm:30000,depth_mm:14000,geometry:{version:1,units:'mm',layers:[{id:'source',name:'A-BLDG-L1',label:'건물 1층 외곽',color:'#ffffff',visible:true,plot:true}],entities:[{id:'e',type:'polyline',layer:'source',closed:true,points:[{x:0,y:0},{x:30000,y:0},{x:30000,y:14000},{x:0,y:14000}]}],blocks:[]}};}
function harness(){
 const engine=new DrawingEngine();let drawing='one';const context={engine,execute:c=>engine.execute(c),getDrawingId:()=>drawing,selected:()=>new Set(),refresh(){}};
 const binding=createBridgeBinding(context),target={...binding.current(),backend_generation:crypto.randomUUID(),snapshot_id:crypto.randomUUID()};binding.receive({protocol_version:1,backend_generation:target.backend_generation,target});
 return {engine,target,handler:createBoundRequestHandler(context,binding),switchDrawing:()=>{drawing='two';},request(extra={}){return {id:crypto.randomUUID(),expires_at:Date.now()+25000,action:'cad_insert_jutong',args:{target,id:'JT-test',detail:detail(),position:{x:1000,y:2000},rotation:90,...extra}};}};
}
test('actual MCP handler inserts one rotated mm block, replay is idempotent and one undo restores layers',()=>{
 const h=harness(),before=structuredClone(h.engine.doc),r=h.request(),response=h.handler(r);assert.equal(response.error,undefined);assert.equal(response.result.applied,true);assert.equal(h.engine.doc.entities.length,1);
 const block=h.engine.doc.entities[0];assert.equal(block.type,'block');assert.equal(block.jutong.core_count,2);assert.deepEqual(block.entities[0].points[0],{x:1000,y:2000});assert.ok(Math.abs(block.entities[0].points[1].x-1000)<1e-8);assert.equal(block.entities[0].points[1].y,32000);
 assert.equal(h.handler(r).error,undefined);assert.equal(h.engine.doc.entities.length,1);h.engine.execute({type:'undo'});assert.deepEqual(h.engine.doc,before);
});
test('actual handler rejects a switched drawing without edits',()=>{const h=harness(),before=structuredClone(h.engine.doc);h.switchDrawing();assert.ok(h.handler(h.request()).error);assert.deepEqual(h.engine.doc,before);});
test('insertion preserves the building origin even if annotation bounds are negative and reuses standard layers',()=>{const h=harness(),d=detail();d.bounds={minX:-5000,minY:-3000,maxX:30000,maxY:14000};h.engine.doc.layers.push({...d.geometry.layers[0],id:'existing'});const r=prepareJutongInsertion(h.engine.doc,{detail:d,position:{x:10,y:20},rotation:0});assert.equal(r.document.layers.length,h.engine.doc.layers.length);assert.equal(r.block.entities[0].layer,'existing');assert.deepEqual(r.block.entities[0].points[0],{x:10,y:20});});
for(const field of ['locked','frozen','hidden','visible','plot'])test('unavailable destination layer '+field+' rejects atomically',()=>{const h=harness(),d=detail();h.engine.doc.layers.push({...d.geometry.layers[0],id:'existing',[field]:!['visible','plot'].includes(field)});const before=structuredClone(h.engine.doc);assert.ok(h.handler(h.request({detail:d})).error);assert.deepEqual(h.engine.doc,before);});
for(const problem of ['unit','scale','fake layer','missing layer','shared block'])test('invalid '+problem+' rejects without edits',()=>{const h=harness(),d=detail();if(problem==='unit')d.geometry.units='m';if(problem==='scale')delete d.scale_verified;if(problem==='fake layer')d.geometry.layers[0].name='A-FAKE';if(problem==='missing layer')d.geometry.entities[0].layer='missing';if(problem==='shared block')d.geometry.entities[0].sharedBlock='other';const before=structuredClone(h.engine.doc);assert.ok(h.handler(h.request({detail:d})).error);assert.deepEqual(h.engine.doc,before);});
test('physical size cannot be overridden by a scale argument',()=>{const h=harness();assert.ok(h.handler(h.request({scale:2})).error);});

test('review-only candidate cannot be inserted and floor metadata survives valid insertion',()=>{
 const h=harness(),d=detail();d.usable_as_jutong=false;const before=structuredClone(h.engine.doc);
 assert.ok(h.handler(h.request({detail:d})).error);assert.deepEqual(h.engine.doc,before);
 d.usable_as_jutong=true;d.floor_counts=[18,20];d.floor_verified=false;
 assert.equal(h.handler(h.request({detail:d})).error,undefined);
 assert.deepEqual(h.engine.doc.entities[0].jutong.floor_counts,[18,20]);
 assert.equal(h.engine.doc.entities[0].jutong.floor_verified,false);
});

for(const field of ['locked','visible'])test('root building layer is checked even when only walls occur in the source: '+field,()=>{const h=harness(),d=detail();d.geometry.layers[0].name='A-WALL';h.engine.doc.layers.push({id:'root',name:'A-BLDG-L1',[field]:field==='locked'});const before=structuredClone(h.engine.doc);assert.ok(h.handler(h.request({detail:d})).error);assert.deepEqual(h.engine.doc,before);});

test('server jutong insertion retains submillimetre marks and hidden account signature',()=>{
 const engine=new DrawingEngine(),source=detail();source.server_asset=true;
 source.geometry.entities[0].points[0].x+=0.004;source.geometry.entities[0].points[0].y-=0.004;
 source.geometry.entities[0].xdata={BARUN_WM:['barun-asset/1','jutong',source.id,'abcdef123456']};
 const before=structuredClone(source),r=prepareJutongInsertion(engine.doc,{detail:source,position:{x:1000,y:2000},rotation:90});
 assert.deepEqual(source,before);assert.deepEqual(r.block.entities[0].xdata,source.geometry.entities[0].xdata);
 const p=r.block.entities[0].points[0],original=source.geometry.entities[0].points[0];
 assert.ok(Math.abs(p.x-(1000-original.y))<1e-8);assert.ok(Math.abs(p.y-(2000+original.x))<1e-8);
 engine.validate(r.document);
});
