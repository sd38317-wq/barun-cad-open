// ACAD200 103: 편집 종류 비트와 "색만 바뀜" 빠른 길.
import test from 'node:test';
import assert from 'node:assert/strict';
import {GPU_EDIT,classifyEntityChange,mergeEditMasks,colorOnlyPairs} from './gpu-edit-mask.js';
import {CadGpuRenderer} from './gpu-renderer.js';
import {THREE} from './vendor/mlightcad.js';
import * as gpuScene from './gpu-scene.js';

const line=(id,x=0,color='#ff0000')=>({id,type:'line',layer:'0',color,points:[{x,y:0},{x:x+10,y:10}]});
const doc=entities=>({layers:[{id:'0',name:'0',visible:true,color:'#ffffff',lineweight:.25}],entities,blocks:[],linetypeScale:1});
function renderer(){
  const r=Object.create(CadGpuRenderer.prototype);
  Object.assign(r,{scene:new THREE.Scene(),stats:{builds:0,frames:0},renderer:{subEntityTraits:{},lineSegments(values,size,indices){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(values,size));g.setIndex(new THREE.BufferAttribute(indices,1));
    const child=new THREE.LineSegments(g,new THREE.LineBasicMaterial());const group=new THREE.Group();group.add(child);return group;
  }}});
  return r;
}
const update=(r,next,removed,added)=>{const previousDoc=r.doc,previousRevision=r.revision;r.setDocument(next,previousRevision+1,1,{previousDoc,previousRevision,lightweight:true,removed,added});};

test('change bits: geometry, style-only and same-object re-display are told apart',()=>{
  const a=line('a');
  assert.deepEqual(classifyEntityChange(a,{...a,color:'#00ff00'}),{mask:GPU_EDIT.STYLE,keys:['color']});
  assert.equal(classifyEntityChange(a,{...a,points:[{x:1,y:1},{x:2,y:2}]}).mask,GPU_EDIT.GEOM);
  assert.equal(classifyEntityChange(a,{...a,color:'#00ff00',points:[{x:1,y:1},{x:2,y:2}]}).mask,GPU_EDIT.GEOM|GPU_EDIT.STYLE);
  assert.equal(classifyEntityChange(a,a).mask,GPU_EDIT.ORDER);
  assert.equal(classifyEntityChange(a,{...a,_displayColor:'#123456'}).mask,0,'render caches are ignored');
  const merged=mergeEditMasks(new Map([['a',GPU_EDIT.STYLE]]),new Map([['a',GPU_EDIT.GEOM],['b',GPU_EDIT.STYLE]]));
  assert.equal(merged.get('a'),GPU_EDIT.GEOM|GPU_EDIT.STYLE);assert.equal(merged.get('b'),GPU_EDIT.STYLE);
  assert.ok(colorOnlyPairs([a],[{...a,color:'#00ff00'}]));
  assert.equal(colorOnlyPairs([a],[{...a,linetype:'DASHED'}]),null,'a linetype change needs new dash distances');
  assert.equal(colorOnlyPairs([a],[{...a,color:'#00ff00',points:[]}]),null);
});

test('a colour-only edit reuses the geometry records without recompiling the source',()=>{
  const r=renderer(),lines=Array.from({length:30},(_,i)=>line('l'+i,i*20));const first=doc(lines);r.setDocument(first,1,1);
  const oldBatch=[...r.lineBatches.values()][0],record=oldBatch.records.find(x=>x.sourceId==='l5');
  const recolored={...lines[5],color:'#00ff00'},next={...first,entities:lines.map((e,i)=>i===5?recolored:e)};
  update(r,next,[lines[5]],[recolored]);
  assert.equal(r.stats.builds,1);assert.equal(r.stats.restyledSources,1);
  const batches=[...r.sourceBatchesOf('l5')];assert.equal(batches.length,1);
  assert.equal(batches[0].color,'#00ff00');assert.ok(batches[0].records.includes(record),'the very same record (points) moved');
  assert.equal(r.lineBatches.get(oldBatch.key),oldBatch,'old colour batch kept (index gap)');assert.ok(!oldBatch.records.includes(record));
  assert.equal(r.doc,next);
  // Back to red: it lands in a red delta batch again; nothing is lost.
  const back={...recolored,color:'#ff0000'};update(r,{...next,entities:next.entities.map(e=>e===recolored?back:e)},[recolored],[back]);
  assert.equal(r.stats.restyledSources,2);assert.equal([...r.lineBatches.values()].flatMap(b=>b.records).filter(x=>x.sourceId==='l5').length,1);
  assert.equal([...r.sourceBatchesOf('l5')][0].color,'#ff0000');
});

test('colour edits of text, blocks or with other changes take the ordinary path',()=>{
  const r=renderer(),a=line('a'),t={id:'t',type:'text',layer:'0',color:'#ff0000',text:'A',height:10,position:{x:0,y:0}};
  globalThis.document??={createElement(){return {getContext(){return {measureText:s=>({width:String(s).length*10}),fillText(){},save(){},restore(){},beginPath(){},rect(){},clip(){},fillRect(){}};}};}};
  const first=doc([a,t]);r.setDocument(first,1,1);
  const t2={...t,color:'#00ff00'};update(r,{...first,entities:[a,t2]},[t],[t2]);
  assert.ok(!r.stats.restyledSources,'text colour is re-rasterised normally');assert.equal(r.stats.builds,1);
  void gpuScene;
});
