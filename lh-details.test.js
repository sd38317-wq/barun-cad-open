import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';
import {createBridgeBinding,createBoundRequestHandler} from './bridge-client.js';
function harness(){
 const engine=new DrawingEngine();let drawingId='drawing-1';
 const context={engine,execute:c=>engine.execute(c),getDrawingId:()=>drawingId,selected:()=>new Set(),refresh(){}};
 const binding=createBridgeBinding(context);
 const target={...binding.current(),backend_generation:crypto.randomUUID(),snapshot_id:crypto.randomUUID()};
 binding.receive({protocol_version:1,backend_generation:target.backend_generation,target});
 const sourceLayer={...engine.doc.layers[0],name:engine.doc.layers[0].name,color:'#9dcbe0'};
 const detail={id:'DA-10-001@test',drawing_id:'DA-10-001',name:'test',bounds:{minX:10,minY:20,maxX:60,maxY:70},geometry:{version:1,units:'mm',layers:[sourceLayer],blocks:[],entities:[
  {id:'source',type:'line',layer:sourceLayer.id,points:[{x:10,y:20},{x:60,y:70}]},
  {id:'source-text',type:'text',layer:sourceLayer.id,position:{x:20,y:30},text:'KS 10mm',height:2},
  {id:'source-circle',type:'circle',layer:sourceLayer.id,center:{x:30,y:40},radius:3}
 ]}};
 return {engine,target,detail,handler:createBoundRequestHandler(context,binding),switchDrawing:()=>{drawingId='drawing-2';},request(extra={}){return {id:crypto.randomUUID(),expires_at:Date.now()+25000,action:'cad_insert_detail',args:{target,id:detail.id,detail,position:{x:100,y:200},scale:2,...extra}};}};
}
test('LH detail uses a single scaled block and preserves colliding source layer styles; one undo restores layers and geometry',()=>{
 const h=harness(),before=structuredClone(h.engine.doc),request=h.request(),response=h.handler(request);
 assert.equal(response.error,undefined);assert.equal(response.result.applied,true);
 assert.equal(h.engine.doc.entities.length,1);const b=h.engine.doc.entities[0];assert.equal(b.type,'block');
 assert.deepEqual(b.entities[0].points,[{x:100,y:200},{x:200,y:300}]);assert.equal(b.entities[1].height,4);assert.equal(b.entities[2].radius,6);
 assert.notEqual(b.entities[0].id,'source');assert.notEqual(b.entities[0].layer,before.layers[0].id);
 assert.equal(h.engine.doc.layers.find(l=>l.id===b.entities[0].layer).color,'#9dcbe0');assert.equal(h.engine.doc.layers.length,before.layers.length+1);
 assert.equal(h.handler(request).error,undefined);assert.equal(h.engine.doc.entities.length,1);
 assert.ok(h.handler(h.request()).error);
 h.engine.execute({type:'undo'});assert.deepEqual(h.engine.doc,before);
});
test('LH insertion clips a selected part and rejects malformed or out of range bounds atomically',()=>{
 const h=harness();let r=h.handler(h.request({bounds:{minX:20,minY:30,maxX:40,maxY:50}}));
 assert.equal(r.error,undefined);assert.deepEqual(G.bounds(h.engine.doc.entities),{minX:100,minY:200,maxX:140,maxY:240});
 const bad=harness(),before=structuredClone(bad.engine.doc);
 assert.ok(bad.handler(bad.request({bounds:{minX:0,minY:0,maxX:40,maxY:50}})).error);assert.deepEqual(bad.engine.doc,before);
 assert.ok(bad.handler(bad.request({scale:-1})).error);assert.deepEqual(bad.engine.doc,before);
});
test('LH insertion rejects switched drawing and wrong layers without editing',()=>{
 const h=harness();h.switchDrawing();assert.ok(h.handler(h.request()).error);assert.equal(h.engine.doc.entities.length,0);
 const bad=harness();bad.detail.geometry.entities[0].layer='missing';const before=structuredClone(bad.engine.doc);assert.ok(bad.handler(bad.request()).error);assert.deepEqual(bad.engine.doc,before);
});

test('an imported nonplot first layer does not suppress other detail layers',()=>{
 const h=harness();h.detail.geometry.layers[0].plot=false;
 const visible={...h.detail.geometry.layers[0],id:'visible-detail',name:'Visible',plot:true};
 h.detail.geometry.layers.push(visible);h.detail.geometry.entities[2].layer=visible.id;
 const response=h.handler(h.request());assert.equal(response.error,undefined);
 const block=h.engine.doc.entities[0];assert.equal(block.layer,h.engine.doc.layers[0].id);
 assert.ok(G.visibleEntities(h.engine.doc,{plot:true}).length>0);
});

test('LH root uses a visible destination layer or creates one; undo restores unavailable layers',()=>{
 for(const available of [true,false]){
  const h=harness();h.engine.doc.layers[0].visible=false;
  if(available)h.engine.doc.layers.push({...h.engine.doc.layers[0],id:'shown',name:'Shown',visible:true});
  const before=structuredClone(h.engine.doc),response=h.handler(h.request());
  assert.equal(response.error,undefined);const b=h.engine.doc.entities[0],l=h.engine.doc.layers.find(x=>x.id===b.layer);
  assert.equal(l.visible,true);assert.notEqual(l.plot,false);assert.ok(!l.frozen&&!l.locked);
  if(available)assert.equal(b.layer,'shown');
  assert.ok(G.visibleEntities(h.engine.doc).length>0);
  h.engine.execute({type:'undo'});assert.deepEqual(h.engine.doc,before);
 }
});

test('LA insertion retains its source on block, layers and detail metadata; undo restores the drawing',()=>{
 const h=harness(),before=structuredClone(h.engine.doc);h.detail.source='la';h.detail.source_name='LA';h.detail.id='A-1201-001@la';
 const response=h.handler(h.request());assert.equal(response.error,undefined);const block=h.engine.doc.entities[0];
 assert.ok(block.name.startsWith('LA '));assert.equal(block.attributes.LA_DETAIL_ID,h.detail.id);assert.equal(block.attributes.DETAIL_SOURCE,'la');assert.equal(block.detail.source,'la');
 assert.ok(h.engine.doc.layers.find(l=>l.id===block.entities[0].layer).name.startsWith('LA '));
 h.engine.execute({type:'undo'});assert.deepEqual(h.engine.doc,before);
});

for(const [identifier,group] of [['UN-country','unit'],['JT-country','jutong']])test('country '+group+' applies rotation and mirror to geometry and clipping in one undo',()=>{
 const h=harness(),before=structuredClone(h.engine.doc);Object.assign(h.detail,{id:identifier,source:'library',group,scale_verified:true});
 const response=h.handler(h.request({id:identifier,scale:1,rotation:90,mirror:true}));assert.equal(response.error,undefined);
 const b=h.engine.doc.entities[0],p=b.entities[0].points;assert.ok(Math.abs(p[0].x-100)<1e-9&&Math.abs(p[0].y-200)<1e-9);assert.ok(Math.abs(p[1].x-50)<1e-9&&Math.abs(p[1].y-150)<1e-9);
 assert.ok(Math.abs(b.entities[2].center.x-80)<1e-9&&Math.abs(b.entities[2].center.y-180)<1e-9);
 assert.equal(b.detail.rotation,90);assert.equal(b.detail.mirror,true);const bound=G.bounds([b]);assert.ok(Math.abs(bound.minX-50)<1e-9&&Math.abs(bound.minY-150)<1e-9&&Math.abs(bound.maxX-100)<1e-9&&Math.abs(bound.maxY-200)<1e-9);
 h.engine.execute({type:'undo'});assert.deepEqual(h.engine.doc,before);
});
test('country plans reject scaling and malformed transforms without changes',()=>{
 for(const extra of [{scale:2},{scale:1,rotation:NaN},{scale:1,mirror:'yes'}]){const h=harness(),before=structuredClone(h.engine.doc);Object.assign(h.detail,{id:'UN-country',source:'library',group:'unit',scale_verified:true});assert.ok(h.handler(h.request(extra)).error);assert.deepEqual(h.engine.doc,before);}
});
