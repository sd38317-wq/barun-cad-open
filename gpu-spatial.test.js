import test from 'node:test';
import assert from 'node:assert/strict';
import {createViewportIndex,spatialChunks,positionBounds} from './gpu-spatial.js';
import {CadGpuRenderer,initialGpuChunks} from './gpu-renderer.js';
import {THREE} from './vendor/mlightcad.js';
import {SceneMatrixCache} from './gpu-scene-matrices.js';

const overlap=(a,b)=>a.minX<=b.maxX&&a.maxX>=b.minX&&a.minY<=b.maxY&&a.maxY>=b.minY;
test('large initial styles use bounded 4096-segment leaves while small styles keep 512',()=>{
 const records=Array.from({length:16384},(_,i)=>({points:[i,0,0,i+1,1,0],bounds:{minX:i,minY:0,maxX:i+1,maxY:1}}));
 const large=initialGpuChunks(records);assert.equal(large.length,4);assert.equal(large.flat().length,records.length);assert.ok(large.every(chunk=>chunk.length<=4096));
 assert.ok(initialGpuChunks(records.slice(0,2048)).every(chunk=>chunk.length<=512));
});
test('clip culling retains thick strokes whose centreline lies outside the mask',()=>{
 const r=Object.create(CadGpuRenderer.prototype);Object.assign(r,{scene:new THREE.Scene(),spatialObjects:new Map(),activeObjects:new Set(),spatialDirty:true});
 const o=new THREE.Group();o.userData.barunClipMasks=[{points:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]}];r.scene.add(o);
 r.registerSpatial(o,{minX:11,maxX:11,minY:2,maxY:8},4,2);
 assert.equal(o.visible,true);const entry=r.spatialObjects.get(o);assert.equal(entry.worldMargin,2);
 assert.ok(createViewportIndex([entry]).query({minX:9,maxX:10,minY:2,maxY:8},1).includes(entry));
});
test('viewport BVH matches brute force, including boundaries and thick strokes',()=>{
  const entries=Array.from({length:4096},(_,i)=>({id:i,bounds:{minX:(i%64)*20,minY:Math.floor(i/64)*20,maxX:(i%64)*20+4,maxY:Math.floor(i/64)*20+3},pixelMargin:i%4,worldMargin:i%3}));
  const index=createViewportIndex(entries);
  for(let i=0;i<60;i++){
    const box={minX:(i*71)%1200,minY:(i*133)%1200,maxX:(i*71)%1200+20,maxY:(i*133)%1200+25},scale=.1+i/5;
    const expected=entries.filter(e=>{const m=e.worldMargin+e.pixelMargin/scale;return overlap(e.bounds,{minX:box.minX-m,minY:box.minY-m,maxX:box.maxX+m,maxY:box.maxY+m});});
    assert.deepEqual(index.query(box,scale).map(e=>e.id).sort((a,b)=>a-b),expected.map(e=>e.id));
  }
  const stats={};index.query({minX:1,minY:1,maxX:3,maxY:3},1,stats);
  assert.ok(stats.entries<entries.length/20,JSON.stringify(stats));
});

test('mutable viewport BVH matches brute force after mixed moves, removals and insertions',()=>{
  const entries=Array.from({length:1000},(_,i)=>({id:i,bounds:{minX:i%50*10,minY:Math.floor(i/50)*10,maxX:i%50*10+2,maxY:Math.floor(i/50)*10+2},pixelMargin:i%3,worldMargin:i%2}));
  const active=new Set(entries),index=createViewportIndex(entries);
  for(let i=0;i<800;i++){
    const e=entries[i%entries.length];
    if(i%3===0){index.remove(e);active.delete(e);}
    else{const x=(i*127)%1300-400,y=(i*89)%900-300;e.bounds={minX:x,maxX:x+4,minY:y,maxY:y+4};index.update(e);active.add(e);}
    assert.equal(index.size,active.size);assert.ok(index.mutationNodes<100);
    const box={minX:(i*47)%600-100,minY:(i*71)%400-100,maxX:(i*47)%600+70,maxY:(i*71)%400+70},scale=.2+i%10;
    const expected=[...active].filter(e=>{const m=e.worldMargin+e.pixelMargin/scale;return overlap(e.bounds,{minX:box.minX-m,maxX:box.maxX+m,minY:box.minY-m,maxY:box.maxY+m});}).map(e=>e.id).sort((a,b)=>a-b);
    assert.deepEqual(index.query(box,scale).map(e=>e.id).sort((a,b)=>a-b),expected);
  }
  for(const e of active)index.remove(e);assert.equal(index.size,0);assert.deepEqual(index.query({minX:-1e6,maxX:1e6,minY:-1e6,maxY:1e6}),[]);
  index.insert(entries[0]);assert.equal(index.size,1);
});

test('monotonic dynamic insertions remain height balanced and local queries stay bounded',()=>{
  const index=createViewportIndex([]);
  for(let i=0;i<10000;i++)index.insert({id:i,bounds:{minX:i*10,maxX:i*10+1,minY:0,maxY:1}});
  assert.ok(index.height<25);assert.ok(index.mutationNodes<80);
  const stats={};assert.equal(index.query({minX:50000,maxX:50001,minY:0,maxY:1},1,stats).length,1);assert.ok(stats.entries<40);
});
test('spatial chunks separate distant interleaved records without changing their attributes',()=>{
  const entries=Array.from({length:100},(_,i)=>{const x=(i%2?10000:0)+i;return {id:i,points:[x,0,i,x+1,1,i],distances:[i,i+1],bounds:{minX:x,minY:0,maxX:x+1,maxY:1}};});
  const chunks=spatialChunks(entries,10);
  assert.equal(chunks.flat().length,100);
  for(const chunk of chunks){assert.ok(chunk.length<=10);assert.ok(chunk.every(e=>e.points[0]<1000)||chunk.every(e=>e.points[0]>1000));for(const e of chunk)assert.equal(e,entries[e.id]);}
});

function renderer(){
  const r=Object.create(CadGpuRenderer.prototype);
  Object.assign(r,{scene:new THREE.Scene(),sceneMatrices:new SceneMatrixCache(),stats:{builds:0,frames:0},renderer:{subEntityTraits:{},lineSegments(values,size,indices){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(values,size));geometry.setAttribute('lineDistance',new THREE.Float32BufferAttribute(new Float32Array(values.length/size),1));geometry.setIndex(new THREE.BufferAttribute(indices,1));
    const group=new THREE.Group();group.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial()));return group;
  }}});return r;
}
const line=(id,x,y=0)=>({id,type:'line',layer:'0',color:'#ffffff',points:[{x,y},{x:x+2,y:y+1}]});
const drawing=entities=>({layers:[{id:'0',name:'0',visible:true,color:'#ffffff'}],entities});
test('same-style GPU lines cull by region and return after panning without rebuilding',()=>{
  const r=renderer(),entities=[];
  for(let i=0;i<2048;i++)entities.push(line(i,(i%2)*100000+(i%32),Math.floor(i/32)));
  r.setDocument(drawing(entities),1,1);
  const roots=[...r.spatialObjects.keys()],b={minX:-r.shift.x-5,maxX:-r.shift.x+40,minY:-r.shift.y-5,maxY:-r.shift.y+80};
  r.updateViewport(b,1);assert.ok(r.stats.culledChunks>0);assert.ok(r.stats.visibleChunks<roots.length);
  assert.equal(r.scene.children.length,r.stats.visibleChunks);
  const left=new Set(r.scene.children);
  r.updateViewport({...b,minX:b.minX+100000,maxX:b.maxX+100000},1);
  assert.ok(r.scene.children.every(o=>!left.has(o)));assert.equal(r.stats.builds,1);
  r.updateViewport(b,1);assert.deepEqual(new Set(r.scene.children),left);
});
test('polyline fragmentation retains continuous dash distances and per-source removal',()=>{
  const r=renderer(),points=Array.from({length:130},(_,i)=>({x:i,y:0})),p={id:'p',type:'polyline',layer:'0',points,linetype:'DASHED'};
  const first=drawing([p]);r.setDocument(first,1,1);
  const records=[...r.lineBatches.values()].flatMap(b=>b.records).sort((a,b)=>a.distances[0]-b.distances[0]);
  assert.equal(records.length,5);assert.equal(records[0].distances[0],0);assert.equal(records.at(-1).distances.at(-1),129);
  for(let i=1;i<records.length;i++)assert.equal(records[i].distances[0],records[i-1].distances.at(-1));
  r.setDocument({...first,entities:[]},2,1,{previousDoc:first,previousRevision:1,lightweight:true,removed:[p],added:[]});
  r.updateViewport({minX:-1e6,minY:-1e6,maxX:1e6,maxY:1e6},1);
  assert.equal(r.spatialObjects.size,0);assert.equal(r.scene.children.length,0);assert.equal(r.stats.builds,1);
});
test('moving a same-style source retains distant buffers and refreshes viewport index',()=>{
  const r=renderer(),entities=Array.from({length:1600},(_,i)=>line(i,i*10)),first=drawing(entities);r.setDocument(first,1,1);
  const distant=[...r.lineBatches.values()].find(b=>b.records.some(rec=>rec.sourceId===1599)).objects[0];
  r.updateViewport({minX:-1,maxX:1,minY:-1,maxY:1},1);
  const moved=line(0,50000),next={...first,entities:[moved,...entities.slice(1)]};
  r.setDocument(next,2,1,{previousDoc:first,previousRevision:1,lightweight:true,removed:[entities[0]],added:[moved]});
  assert.ok(r.spatialObjects.has(distant));assert.equal(r.stats.builds,1);
  r.updateViewport({minX:50000-r.shift.x-1,maxX:50000-r.shift.x+4,minY:-2,maxY:2},1);
  assert.equal(r.scene.children.length,1);
  assert.ok(!r.scene.children.includes(distant));
});
test('clear disposes geometry even when off-screen objects are detached',()=>{
  const r=renderer();r.setDocument(drawing([line('a',0),line('b',1e6)]),1,1);
  let disposed=0;for(const root of r.spatialObjects.keys())root.traverse(o=>o.geometry?.addEventListener('dispose',()=>disposed++));
  const count=r.spatialObjects.size;r.updateViewport({minX:1e9,minY:1e9,maxX:1e9+1,maxY:1e9+1},1);assert.equal(r.scene.children.length,0);
  r.clearScene();assert.equal(disposed,count);assert.equal(r.spatialObjects.size,0);
});
test('text leaves retain contiguous painter order for overlapping translucent glyph edges',()=>{
  const previous=globalThis.document;
  globalThis.document={createElement(){return {getContext(){return {measureText(){return {width:8};},fillText(){},save(){},restore(){},beginPath(){},rect(){},clip(){}};}};}};
  try{
    const r=renderer();r.clearScene();
    const entries=Array.from({length:130},(_,i)=>({z:i/130,order:-1,item:{color:'#ffffff',entity:{type:'text',text:'A',height:16,position:{x:i%2?1e6:0,y:0}}}}));
    r.addText(entries,{x:0,y:0},1,130);
    const zs=[...r.spatialObjects.keys()].flatMap(o=>{const p=o.geometry.getAttribute('position');return Array.from({length:p.count/6},(_,i)=>p.getZ(i*6));});
    assert.equal(zs.length,130);for(let i=1;i<zs.length;i++)assert.ok(zs[i]>=zs[i-1]);
  }finally{globalThis.document=previous;}
});
test('constant-width cloned materials follow viewport resize and zoom',()=>{
  const r=renderer(),material={resolution:new THREE.Vector2(1,1)};
  Object.assign(r,{shift:{x:0,y:0},camera:new THREE.OrthographicCamera(),widthMaterials:[[material,3]],dashMaterials:new Set(),setDocument(){},updateViewport(){},gl:{setPixelRatio(){},render(){},info:{render:{calls:0}}}});
  r.renderer.setSize=()=>{};r.renderer.syncCameraZoom=()=>{};
  r.render({width:800,height:600,scale:2,origin:{x:0,y:0}});
  assert.deepEqual(material.resolution.toArray(),[800,600]);assert.equal(material.linewidth,6);
  r.render({width:1200,height:700,scale:4,origin:{x:0,y:0}});
  assert.deepEqual(material.resolution.toArray(),[1200,700]);assert.equal(material.linewidth,12);
});
test('hatch culling uses generated geometry beyond source boundary vertices',()=>{
  const r=renderer();r.renderer.subEntityTraits.fillType={};
  r.renderer.area=()=>{const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([100,100,0,110,100,0,100,110,0],3));return new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());};
  r.setDocument(drawing([{id:'h',type:'hatch',layer:'0',points:[{x:0,y:0},{x:10,y:0},{x:0,y:10}],solid:false}]),1,1);
  r.updateViewport({minX:102,minY:102,maxX:104,maxY:104},1);
  assert.equal(r.stats.visibleChunks,1);
});
