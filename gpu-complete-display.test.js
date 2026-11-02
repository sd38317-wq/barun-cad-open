import test from 'node:test';
import assert from 'node:assert/strict';
import {CadGpuRenderer,compileCompleteGpuDisplay} from './gpu-renderer.js';
import {compileGpuJob,gpuJobDocument} from './gpu-compile-job.js';
import * as G from './geometry.js';
import {THREE} from './vendor/mlightcad.js';

const p=(x,y)=>({x,y});
const line=(id,x=0)=>({id,type:'line',layer:'0',points:[p(x,0),p(x+10,10)]});
const ref=(id,name)=>({id,type:'block',layer:'0',sharedBlock:name,entities:[],position:p(20,30),scale:2,rotation:30});
const layers=[{id:'0',name:'0',visible:true,color:'#123456',linetype:'DASHED',lineweight:.4},{id:'hidden',name:'Hidden',visible:false,color:'#ffffff'}];
const comparable=result=>JSON.parse(JSON.stringify(result,(key,value)=>key==='compileMs'||key==='id'?undefined:value));
function richDrawing(){
  return {layers:structuredClone(layers),linetypeScale:3,entities:[line('first'),{...ref('shared','outer'),color:'#ff7700',clip:{enabled:true,inverted:true,points:G.rectangle(p(10,10),p(50,50))}},line('last',100)],sharedBlocks:{
    outer:{origin:p(2,3),entities:[ref('nested','inner'),{...line('invisible'),layer:'hidden'}]},
    inner:{origin:p(0,0),entities:[{...line('child'),colorMode:'byblock',linetype:'BYBLOCK'},
      {type:'polyline',layer:'0',closed:true,constantWidth:2,points:G.rectangle(p(0,0),p(10,10))},
      {type:'circle',layer:'0',center:p(0,0),radius:8},
      {type:'arc',layer:'0',center:p(20,0),radius:4,startAngle:25,endAngle:270},
      {type:'ellipse',layer:'0',center:p(30,20),majorAxis:p(10,2),ratio:.7},
      {type:'hatch',layer:'0',solid:true,points:G.rectangle(p(0,0),p(20,20)),loops:[G.rectangle(p(5,5),p(8,8))]},
      {type:'hatch',layer:'0',solid:false,pattern:'ANSI31',spacing:3,angle:45,points:G.rectangle(p(20,0),p(30,10))},
      {type:'text',layer:'0',text:'selection',position:p(5,5),height:3},
      {type:'point',layer:'0',position:p(2,1)}]},
  }};
}

test('complete display compilation matches normal geometry, style, clipping and painter order',()=>{
  const doc=richDrawing(),entities=G.visibleEntities(doc,{inPlace:true});
  const direct=compileCompleteGpuDisplay(doc,3,.3,{doc,revision:3,entities});
  const normal=compileGpuJob({doc:gpuJobDocument(doc),scale:.3});
  assert.deepEqual(comparable(direct),comparable(normal));
  assert.equal(direct.compiled.items[0].sourceId,'first');
  assert.equal(direct.compiled.items.at(-1).sourceId,'last');
  assert.ok(direct.compiled.items.some(item=>item.clipMasks.some(mask=>mask.inverted)));
  assert.ok(direct.compiled.items.some(item=>item.type==='text'));
});

test('stale, absent and heavy display descriptors fail closed',()=>{
  const doc={layers,entities:[line('a')]},entities=G.visibleEntities(doc,{inPlace:true});
  const valid={doc,revision:7,entities};
  for(const display of [undefined,{...valid,doc:{...doc}},{...valid,revision:6},{...valid,entities:null}])assert.equal(compileCompleteGpuDisplay(doc,7,1,display),null);
  // Size alone no longer rejects: large drawings hand over their complete
  // whole-document display set; stale or foreign descriptors still fail closed.
  const heavy={...doc,entities:new Array(50001)};
  assert.ok(compileCompleteGpuDisplay(heavy,7,1,{...valid,doc:heavy}));
  assert.equal(compileCompleteGpuDisplay(heavy,7,1,{...valid,doc:heavy,revision:6}),null);
  // A lazy descriptor is resolved only here, and validated the same way.
  let resolved=0;assert.ok(compileCompleteGpuDisplay(doc,7,1,()=>{resolved++;return valid;}));assert.equal(resolved,1);
  assert.equal(compileCompleteGpuDisplay(doc,7,1,()=>({...valid,revision:6})),null);
  const empty={layers,entities:[]};
  assert.deepEqual(compileCompleteGpuDisplay(empty,1,1,{doc:empty,revision:1,entities:[]}).origin,p(0,0));
});

function renderer(){
  const r=Object.create(CadGpuRenderer.prototype);
  Object.assign(r,{scene:new THREE.Scene(),stats:{builds:0,frames:0},buildLineBatch(batch){batch.objects=[];}});
  return r;
}

test('synchronous build consumes resolved children without reading shared definitions again',()=>{
  const doc={layers,entities:[ref('target','shape')],sharedBlocks:{shape:{origin:p(0,0),entities:[line('child')]}}};
  const entities=G.visibleEntities(doc,{inPlace:true}),source=doc.sharedBlocks.shape;
  let childReads=0;Object.defineProperty(source,'entities',{get(){childReads++;throw Error('duplicate expansion');}});
  const r=renderer();
  try{
    r.setDocument(doc,1,1,undefined,{doc,revision:1,entities});
    assert.equal(childReads,0);assert.equal(r.stats.completeDisplayBuilds,1);assert.equal(r.stats.items,1);
  }finally{r.clearScene();}
});

test('missing descriptor keeps the complete compiler fallback',()=>{
  const r=renderer(),doc={layers,entities:[line('a')]};
  try{r.setDocument(doc,1,1);assert.equal(r.stats.items,1);assert.equal(r.stats.completeDisplayBuilds,0);}finally{r.clearScene();}
});

test('pending and completed worker full jobs retain precedence over complete display',()=>{
  const doc={layers,entities:[ref('target','shape')],sharedBlocks:{shape:{origin:p(0,0),entities:[line('child')]}}};
  const expected=compileGpuJob({doc:gpuJobDocument(doc),scale:2});
  const r=renderer();r.doc={};r.tryEdit=()=>false;
  let ready=false,reads=0;
  const descriptor={doc,revision:2,get entities(){reads++;throw Error('worker must own this build');}};
  r.compileClient={select(){},consume(){},cancel(){},request(){return ready?{result:expected}:{pending:true};}};
  try{
    r.setDocument(doc,2,1,{lightweight:true},descriptor);
    assert.equal(r.stats.workerPending,true);assert.equal(reads,0);
    ready=true;r.setDocument(doc,2,1,{lightweight:true},descriptor);
    assert.equal(r.stats.workerBuilds,1);assert.equal(r.stats.completeDisplayBuilds,0);assert.equal(reads,0);
  }finally{r.clearScene();}
});

test('render forwards the explicit complete display descriptor unchanged',()=>{
  const r=renderer(),doc={layers,entities:[]},display={doc,revision:1,entities:[]},sentinel=Error('stop before GPU');
  r.setDocument=(...args)=>{assert.equal(args[4],display);throw sentinel;};
  assert.throws(()=>r.render({doc,revision:1,scale:1,origin:p(0,0),width:100,height:100,completeDisplay:display}),error=>error===sentinel);
});
