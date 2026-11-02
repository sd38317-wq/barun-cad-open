// ACAD200 112 (+525): 작은 글자는 글자 대신 옅은 상자, 아틀라스가 차도 글자를 빠뜨리지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CadGpuRenderer} from './gpu-renderer.js';
import {THREE} from './vendor/mlightcad.js';
import {createSourceSelection} from './gpu-selection-source.js';

function fixture(){
  const previous=globalThis.document;
  globalThis.document={createElement(){
    const ctx={font:'',save(){},restore(){},beginPath(){},rect(){},clip(){},fillRect(){},fillText(){},measureText(text){return {width:String(text).length*parseFloat(this.font)*.6};}};
    return {width:0,height:0,getContext(){return ctx;}};
  }};
  const r=Object.create(CadGpuRenderer.prototype);
  Object.assign(r,{scene:new THREE.Scene(),stats:{builds:0,frames:0},renderer:{subEntityTraits:{},lineSegments(values,size,indices){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(values,size));g.setIndex(new THREE.BufferAttribute(indices,1));
    const child=new THREE.LineSegments(g,new THREE.LineBasicMaterial());const group=new THREE.Group();group.add(child);return group;
  },forceShowLineWeight:false}});
  return {r,restore(){r.clearScene();globalThis.document=previous;}};
}
const text=(id,x,height)=>({id,type:'text',layer:'0',color:'#ffffff',text:'LABEL '+id,height,position:{x,y:0}});
const doc=entities=>({layers:[{id:'0',name:'0',visible:true,color:'#ffffff',lineweight:.25}],entities,blocks:[],linetypeScale:1});
const everything={minX:-1e9,maxX:1e9,minY:-1e9,maxY:1e9};

test('labels under the greeking size become one pale box mesh, without atlas rasters',()=>{
  const f=fixture();
  try{
    // 600 labels: managed (view-dependent) text. Half are 1 unit high, half 100.
    const entities=Array.from({length:600},(_,i)=>text('t'+i,i*1000,i%2?100:1));
    f.r.setDocument(doc(entities),1,1);assert.equal(f.r.managedText,true);
    f.r.textGreekPx=3;f.r.updateTextViewport(everything,1,1,Infinity);
    assert.equal(f.r.stats.textGreeked,300,'1 px labels are greeked');assert.equal(f.r.stats.textEntries,600,'none dropped');
    assert.equal(f.r.stats.uniqueTextRasters,300,'only readable labels are rasterised');
    const greek=f.r.textMeshes.filter(t=>t.greek);assert.equal(greek.length,1);assert.equal(greek[0].records.length,300);
    assert.equal(greek[0].mesh.material.transparent,false,'opaque tint: never interleaves with the transparent text batches');
    // Deleting a greeked label rebuilds only positions (no UVs on boxes).
    f.r.removeSourceDecorations(new Set(['t0']));assert.equal(greek[0].records.length,299);
    assert.equal(greek[0].mesh.geometry.getAttribute('position').count,299*6);assert.equal(greek[0].mesh.geometry.getAttribute('uv'),undefined);
    // Selecting a greeked label borrows its box material.
    const selection=createSourceSelection(f.r,'t2',1);assert.equal(selection.counts.textRecords,1);selection.dispose();
    // The setting 0 (or no LOD strategy) keeps every label as text.
    f.r.textGreekPx=0;f.r.updateTextViewport(everything,1,1,Infinity);
    assert.equal(f.r.stats.textGreeked,0);assert.equal(f.r.textMeshes.filter(t=>t.greek).length,0);
  }finally{f.restore();}
});

test('525: a full atlas greeks the remaining labels instead of dropping them',()=>{
  const f=fixture();
  try{
    // Long unique labels at 128 px fill the 32 atlas pages.
    const entities=Array.from({length:700},(_,i)=>({...text('t'+i,i*1000,128),text:'X'.repeat(200)+i}));
    f.r.setDocument(doc(entities),1,1);f.r.textGreekPx=3;f.r.updateTextViewport(everything,1,1,Infinity);
    assert.ok(f.r.stats.textGreekedOverBudget>0,'over budget labels became boxes');assert.equal(f.r.stats.textLabelsDropped,0);
    assert.equal(f.r.stats.textEntries,700);
  }finally{f.restore();}
});
