import test from 'node:test';
import assert from 'node:assert/strict';
import { CadGpuRenderer } from './gpu-renderer.js';
import { THREE } from './vendor/mlightcad.js';

function renderer(){
  const r=Object.create(CadGpuRenderer.prototype);
  Object.assign(r,{scene:new THREE.Scene(),stats:{builds:0,frames:0},renderer:{subEntityTraits:{},lineSegments(values,size,indices){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(values,size));g.setIndex(new THREE.BufferAttribute(indices,1));
    const child=new THREE.LineSegments(g,new THREE.LineBasicMaterial()),group=new THREE.Group();group.add(child);return group;
  }}});return r;
}
const doc=entities=>({layers:[{id:'0',name:'0',visible:true,color:'#ffffff',lineweight:.25}],entities,blocks:[],linetypeScale:1});
const line={id:'l',type:'line',layer:'0',points:[{x:0,y:0},{x:10,y:10}]};
const circle=(id,x)=>({id,type:'circle',layer:'0',center:{x,y:0},radius:100});
const records=(r,id)=>[...r.lineBatches.values()].flatMap(b=>b.records).filter(x=>x.sourceId===id);
const objects=(r,id)=>[...r.lineBatches.values()].filter(b=>b.records.some(x=>x.sourceId===id)).flatMap(b=>b.objects);
const box=(r,x)=>({minX:x-150-r.shift.x,maxX:x+150-r.shift.x,minY:-150-r.shift.y,maxY:150-r.shift.y});

test('zoom preserves static buffers and refines only curves inside viewport, including later pan',()=>{
  const r=renderer(),d=doc([line,circle('near',0),circle('far',100000)]);r.setDocument(d,1,.01);
  const statics=objects(r,'l'),far=records(r,'far'),nearSegments=records(r,'near').reduce((n,x)=>n+x.points.length/6,0);
  r.setDocument(d,1,10);assert.equal(r.stats.builds,1);
  r.refineViewport(box(r,0),10);
  assert.equal(r.stats.builds,1);assert.equal(r.stats.refinedCurves,1);
  assert.deepEqual(objects(r,'l'),statics);assert.deepEqual(records(r,'far'),far);
  const refined=records(r,'near').reduce((n,x)=>n+x.points.length/6,0);assert.ok(refined>nearSegments);
  // For a radius100 circle, chord sagitta stays below .25screenpixels.
  for(const record of records(r,'near'))for(let i=0;i<record.points.length;i+=6){
    const p=record.points,dx=p[i]-p[i+3],dy=p[i+1]-p[i+4],sagitta=100-Math.sqrt(Math.max(0,10000-(dx*dx+dy*dy)/4));
    assert.ok(sagitta*10<=.25+1e-7);
  }
  const nearObjects=objects(r,'near');r.refineViewport(box(r,0),10);assert.equal(r.stats.refinedCurves,0);assert.deepEqual(objects(r,'near'),nearObjects);
  const nearRecords=records(r,'near');
  r.refineViewport(box(r,100000),10);assert.equal(r.stats.refinedCurves,1);assert.deepEqual(records(r,'near'),nearRecords);
  r.clearScene();
});

test('point cross retains screen size through zoom without scene rebuild',()=>{
  const r=renderer(),d=doc([line,{id:'p',type:'point',layer:'0',position:{x:0,y:0}}]);r.setDocument(d,1,1);
  const statics=objects(r,'l');r.setDocument(d,1,10);r.refineViewport(box(r,0),10);
  const p=records(r,'p')[0].points;assert.ok(Math.abs((p[3]-p[0])*10-2)<1e-8);
  assert.equal(r.stats.builds,1);assert.deepEqual(objects(r,'l'),statics);r.clearScene();
});

test('edited circles replace their detail index and can refine at a new location',()=>{
  const r=renderer(),c=circle('c',0),first=doc([line,c]);r.setDocument(first,1,.01);
  const moved={...c,center:{x:100000,y:0}},next={...first,entities:[line,moved]};
  r.setDocument(next,2,.01,{lightweight:true,previousDoc:first,previousRevision:1,removed:[c],added:[moved]});
  assert.equal(r.stats.builds,1);assert.equal(r.details.size,1);
  r.refineViewport(box(r,0),10);assert.equal(r.stats.refinedCurves,0);
  r.refineViewport(box(r,100000),10);assert.equal(r.stats.refinedCurves,1);
  assert.ok(records(r,'c').every(rec=>rec.points[0]>99000-r.shift.x));r.clearScene();
});

test('refining nested block curves preserves inherited color, dash and lineweight',()=>{
  const r=renderer(),d=doc([{id:'b',type:'block',layer:'0',color:'#123456',lineweight:.75,linetype:'DASHED',entities:[circle('inner',0)]}]);
  r.setDocument(d,1,.01);const before=[...r.lineBatches.values()][0];
  r.refineViewport(box(r,0),10);const after=[...r.lineBatches.values()][0];
  assert.equal(after.color,before.color);assert.equal(after.width,before.width);assert.deepEqual(after.dash,before.dash);r.clearScene();
});

test('proven coalesced COW cancellation advances revision without rebuilding',()=>{
  const r=renderer(),d=doc([line]);r.setDocument(d,1,1);const retained=r.scene.children[0];
  r.setDocument(d,3,1,{lightweight:true,previousDoc:d,previousRevision:1,removed:[],added:[]});
  assert.equal(r.revision,3);assert.equal(r.stats.builds,1);assert.equal(r.scene.children[0],retained);
  r.setDocument(d,4,1,{lightweight:false,previousDoc:d,previousRevision:3,removed:[],added:[]});
  assert.equal(r.stats.builds,2,'unproved same-identity mutation must rebuild');r.clearScene();
});
