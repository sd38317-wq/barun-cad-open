import test from 'node:test';
import assert from 'node:assert/strict';
import { CadGpuRenderer } from './gpu-renderer.js';
import { THREE } from './vendor/mlightcad.js';
import {compileGpuJob,gpuJobDocument} from './gpu-compile-job.js';

// A heavy complete build runs across frames; it must produce exactly the scene
// the synchronous build produces.
function renderer(budget){
  const r=Object.create(CadGpuRenderer.prototype);
  Object.assign(r,{scene:new THREE.Scene(),stats:{builds:0,frames:0},onChange(){},buildBudgetMs:budget,gl:{clear(){}},renderer:{subEntityTraits:{},lineSegments(values,size,indices){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(values,size));g.setIndex(new THREE.BufferAttribute(indices,1));
    const child=new THREE.LineSegments(g,new THREE.LineBasicMaterial()),group=new THREE.Group();group.add(child);return group;
  }}});return r;
}
const layers=[{id:'0',name:'0',visible:true,color:'#ffffff',lineweight:.25},{id:'d',name:'d',visible:true,color:'#ff0000',linetype:'DASHED'}];
function drawing(){
  const entities=[];
  for(let i=0;i<6000;i++){
    const x=(i%100)*50,y=Math.floor(i/100)*50,k=i%6,layer=i%7===0?'d':'0';
    if(k===0)entities.push({id:'l'+i,type:'line',layer,points:[{x,y},{x:x+30,y:y+10}]});
    else if(k===1)entities.push({id:'p'+i,type:'polyline',layer,points:Array.from({length:80},(_,j)=>({x:x+j*.4,y:y+Math.sin(j/5)*8}))});
    else if(k===2)entities.push({id:'c'+i,type:'circle',layer,center:{x,y},radius:5+i%9});
    else if(k===3)entities.push({id:'a'+i,type:'arc',layer,center:{x,y},radius:12,startAngle:10,endAngle:200});
    else if(k===4)entities.push({id:'o'+i,type:'point',layer,position:{x,y}});
    else entities.push({id:'q'+i,type:'polyline',layer,closed:true,points:[{x,y},{x:x+20,y},{x:x+20,y:y+20},{x,y:y+20}]});
  }
  return {layers,entities,blocks:[],linetypeScale:1};
}
const snapshot=r=>({
  batches:[...r.lineBatches.entries()].map(([key,b])=>({key,style:b.style,records:b.records.map(x=>({sourceId:x.sourceId,detailId:x.detailId,points:[...x.points],distances:[...(x.distances||[])],bounds:x.bounds}))})),
  sourceZ:[...r.sourceZ],depths:[...r.sourcePrimitiveDepths].map(([id,d])=>[id,[...d]]),
  details:[...r.details.values()].map(d=>[d.id,d.scale,d.builtScale,d.z]),items:r.stats.items,shift:r.shift,detailScale:r.detailScale,
});

test('a sliced complete build equals the synchronous build',()=>{
  const d=drawing(),sync=renderer(Infinity);sync.setDocument(d,1,.05);assert.equal(sync.buildTask??null,null);
  const sliced=renderer(0);let calls=0;
  do{sliced.setDocument(d,1,.05);calls++;}while(sliced.buildTask&&calls<100000);
  assert.ok(calls>10,'the build was worked off in many steps ('+calls+')');
  assert.equal(sliced.doc,d);assert.equal(sliced.stats.workerPending,false);
  assert.deepEqual(snapshot(sliced),snapshot(sync));
  sync.clearScene();sliced.clearScene();
});

test('a newer revision mid-build restarts the build; an outside reset cancels it',()=>{
  const d=drawing(),r=renderer(0);
  r.setDocument(d,1,.05);r.setDocument(d,1,.05);assert.ok(r.buildTask,'still building');
  const next={...d,entities:d.entities.slice(0,5500)};
  let calls=0;do{r.setDocument(next,2,.05);calls++;}while(r.buildTask&&calls<100000);
  const reference=renderer(Infinity);reference.setDocument(next,2,.05);
  assert.equal(r.doc,next);assert.equal(r.revision,2);assert.deepEqual(snapshot(r),snapshot(reference));reference.clearScene();r.clearScene();
  const again=renderer(0);again.setDocument(d,1,.05);assert.ok(again.buildTask);again.clearScene();assert.equal(again.buildTask,null);
});

test('a slice whose blocks expand to over 100k primitives still builds (no argument-spread overflow)',()=>{
  const children=Array.from({length:150000},(_,i)=>({id:'k'+i,type:'line',layer:'0',points:[{x:i,y:0},{x:i,y:5}]}));
  const d={layers,entities:[...drawing().entities.slice(0,5000),{id:'big',type:'block',layer:'0',entities:children}],blocks:[],linetypeScale:1};
  const sync=renderer(Infinity);sync.setDocument(d,1,.05);
  const sliced=renderer(0);let calls=0;do{sliced.setDocument(d,1,.05);calls++;}while(sliced.buildTask&&calls<100000);
  assert.equal(sliced.stats.items,sync.stats.items);assert.ok(sliced.stats.items>150000);
  assert.deepEqual(snapshot(sliced),snapshot(sync));sync.clearScene();sliced.clearScene();
});

test('a rejected 3x3 ARRAY installs a full worker result in bounded steps even with nine roots',()=>{
  const children=Array.from({length:13000},(_,i)=>({id:'k'+i,type:'line',layer:'0',points:[{x:i%130,y:Math.floor(i/130)},{x:i%130+1,y:Math.floor(i/130)+1}]}));
  const ref=(id,x,y)=>({id,type:'block',layer:'0',sharedBlock:'floor',entities:[],position:{x,y},scale:1,rotation:0});
  const before={layers,entities:[ref('original',0,0)],blocks:[],sharedBlocks:{floor:{origin:{x:0,y:0},entities:children}},linetypeScale:1};
  const added=Array.from({length:8},(_,i)=>ref('copy'+i,((i+1)%3)*200,Math.floor((i+1)/3)*200));
  const next={...before,entities:[...before.entities,...added]},scale=.05;
  const full=compileGpuJob({doc:gpuJobDocument(next),scale:scale*2});
  const editResult=compileGpuJob({doc:gpuJobDocument(next,added),scale:scale*2,origin:full.origin});
  const sync=renderer(Infinity),sliced=renderer(Infinity);
  for(const r of [sync,sliced])r.setDocument(before,1,scale);
  const edit={lightweight:true,previousDoc:before,previousRevision:1,removed:[],added};
  const counts=r=>{
    let items=0,uploads=0,maxItems=0,maxUploads=0,calls=0;
    const register=r.registerDetail.bind(r),build=r.buildLineBatch.bind(r);
    r.registerDetail=(...args)=>{items++;return register(...args);};
    r.buildLineBatch=(...args)=>{uploads++;return build(...args);};
    // Force the compile-worker path rather than the independent copy cache.
    r.reuseTemplateCopies=()=>null;r.reuseCompiledCopies=()=>null;
    r.compileClient={select(){},cancel(){},consume(){this.pending=null;},request(doc,revision,kind){this.pending={doc,revision,kind};return {result:kind==='edit'?editResult:full};}};
    return {step(){items=0;uploads=0;r.setDocument(next,2,scale,edit);calls++;maxItems=Math.max(maxItems,items);maxUploads=Math.max(maxUploads,uploads);},get result(){return {maxItems,maxUploads,calls};}};
  };
  const a=counts(sync),b=counts(sliced);sliced.buildBudgetMs=0;
  try{
    a.step();do{b.step();}while(sliced.buildTask&&b.result.calls<10000);
    assert.equal(sliced.stats.editReject,'mass');assert.equal(next.entities.length,9);
    assert.equal(sliced.buildTask,null);assert.equal(sliced.stats.workerBuilds,2,'edit compilation and full compilation both used the worker');
    assert.equal(a.result.maxItems,117000);assert.equal(b.result.maxItems,512);
    assert.ok(a.result.maxUploads>1);assert.equal(b.result.maxUploads,1);
    assert.ok(b.result.calls>200);assert.deepEqual(snapshot(sliced),snapshot(sync));
    console.log('ARRAY installation work counts:',{synchronous:a.result,sliced:b.result});
  }finally{sync.clearScene();sliced.clearScene();}
});

test('a finite-budget fallback with few roots uses retained primitive count and cancels on a newer revision',()=>{
  const doc={layers,entities:[{id:'big',type:'block',layer:'0',entities:Array.from({length:6000},(_,i)=>({id:'l'+i,type:'line',layer:'0',points:[{x:i,y:0},{x:i,y:1}]}))}],blocks:[],linetypeScale:1};
  const r=renderer(Infinity);r.setDocument(doc,1,.05);r.buildBudgetMs=0;
  // Any other document key still rejects the edit (LTSCALE alone no longer does: ACAD200 119).
  const next={...doc,regenProbe:2,entities:[...doc.entities]},edit={lightweight:true,previousDoc:doc,previousRevision:1,removed:[],added:[]};
  try{
    r.setDocument(next,2,.05,edit);assert.ok(r.buildTask,'few roots must not force a synchronous rejected edit');
    const newer={...doc,entities:[{id:'new',type:'line',layer:'0',points:[{x:0,y:0},{x:1,y:1}]}]};
    let calls=0;do{r.setDocument(newer,3,.05);calls++;}while(r.buildTask&&calls<10000);
    assert.equal(r.doc,newer);assert.equal(r.revision,3);assert.equal(r.stats.items,1);
  }finally{r.clearScene();}
});

test('upload warmup restores GL state between slices, including revision replacement and reset',()=>{
  const doc={layers,entities:Array.from({length:6000},(_,i)=>({id:'l'+i,type:'line',layer:'0',points:[{x:i,y:0},{x:i,y:1}]})),blocks:[],linetypeScale:1};
  for(const cancel of ['revision','reset']){
    const r=renderer(0);let uploads=0;
    Object.assign(r.gl,{autoClear:true,scissor:false,compile(){return new Set();},setScissorTest(value){this.scissor=value;},setScissor(){},render(){assert.equal(this.autoClear,false);assert.equal(this.scissor,true);uploads++;}});
    try{
      let calls=0;do{r.setDocument(doc,1,.05);calls++;}while(!uploads&&r.buildTask&&calls<10000);
      assert.ok(uploads);assert.ok(r.buildTask,'paused during upload warmup');
      assert.equal(r.gl.autoClear,true);assert.equal(r.gl.scissor,false);
      if(cancel==='reset')r.clearScene();
      else{
        const next={...doc,entities:doc.entities.slice(0,1)};
        do{r.setDocument(next,2,.05);calls++;}while(r.buildTask&&calls<10000);
        assert.equal(r.doc,next);assert.equal(r.revision,2);
      }
      assert.equal(r.gl.autoClear,true);assert.equal(r.gl.scissor,false);
    }finally{r.clearScene();}
  }
});
