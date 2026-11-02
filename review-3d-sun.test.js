import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './three.module.js';
import {computeSunGrid,computeSunGridAsync,sunGridRunning} from './review-3d-sun.js';
import {sampleTimes,sunlightVerdict,summarizeSunlight} from './sun-study.js';

const size=128*128,colors={ok:[86,200,130,150],some:[240,180,60,150],none:[230,84,70,150]};
function fixture(){
 const scene=new THREE.Scene(),group=new THREE.Group(),sun=new THREE.DirectionalLight(),helper=new THREE.Group();
 scene.add(group,sun,sun.target,helper);helper.visible=false;scene.background=new THREE.Color('#123456');
 const originalMaterial=new THREE.MeshBasicMaterial(),originalTarget={original:true};scene.overrideMaterial=originalMaterial;sun.layers.enable(5);
 let target=originalTarget,minutes=720,renders=0,fail=false;
 const opts={scene,group,sun,center:new THREE.Vector3(3,0,4),span:20,
  at:t=>({altitude:t===480?0:30,azimuth:t}),applySun:s=>{minutes=s?.azimuth??720;},
  renderer:{getRenderTarget:()=>target,setRenderTarget:t=>{target=t;},render:()=>{renders++;if(fail)throw Error('GPU failure');},
   readRenderTargetPixels:(_t,_x,_y,_w,_h,buf)=>{for(let i=0;i<size;i++){const mask=i%17===0;buf[i*4]=scene.overrideMaterial?(mask?0:255):((i+Math.round(minutes/10))%9<5?255:0);}}
  }};
 const children=[...scene.children],background=scene.background,layerMask=sun.layers.mask;
 return {opts,get renders(){return renders;},set fail(v){fail=v;},restored(){assert.deepEqual(scene.children,children);assert.equal(scene.background,background);assert.equal(scene.overrideMaterial,originalMaterial);assert.equal(sun.layers.mask,layerMask);assert.equal(helper.visible,false);assert.equal(target,originalTarget);assert.equal(minutes,720);}};
}
// Independent reference for the pre-slicing 49-time / 128-square accumulation, including night and roof cells.
function reference(center,span){
 const times=sampleTimes(),lit=times.map(t=>Uint8Array.from({length:size},(_,i)=>t===480?0:((i+Math.round(t/10))%9<5?1:0)));
 const cells=new Array(size),color=new Uint8Array(size*4);
 for(let i=0;i<size;i++){if(i%17===0){cells[i]=null;continue;}const v=sunlightVerdict(times.map((_,k)=>lit[k][i]));cells[i]=v;color.set(v.ok?colors.ok:v.total>=120?colors.some:colors.none,i*4);}
 return {grid:128,side:span*1.6,center:center.clone(),cells,color,summary:summarizeSunlight(cells)};
}
test('solar sync and sliced results exactly match the original grid accumulation',async()=>{
 const a=fixture(),b=fixture(),progress=[];let frames=0;
 const sync=computeSunGrid(a.opts),asyncResult=await computeSunGridAsync({...b.opts,onProgress:p=>progress.push(p),batchSize:4,fastTaskMs:0,yieldFrame:async()=>{b.restored();assert.equal(sunGridRunning(b.opts.renderer),true);frames++;}});
 assert.deepEqual(sync,reference(a.opts.center,a.opts.span));assert.deepEqual(asyncResult,sync);assert.equal(a.renders,49);assert.equal(b.renders,49);
 const samples=progress.filter(p=>p.kind==='sun-grid'&&p.index>0);assert.equal(progress.at(-1).index,49);for(let i=0;i<samples.length;i++){assert.equal(samples[i].minutes,sampleTimes()[samples[i].index-1]);if(i)assert.ok(samples[i].index>=samples[i-1].index);}assert.ok(samples.length>1);
 assert.ok(frames>=12);a.restored();b.restored();assert.equal(sunGridRunning(b.opts.renderer),false);
});
test('solar cancellation restores scene, light, target and temporary resources between frames',async()=>{
 const f=fixture(),controller=new AbortController();let events=0;
 await assert.rejects(computeSunGridAsync({...f.opts,signal:controller.signal,batchSize:4,fastTaskMs:0,yieldFrame:async()=>{f.restored();},onProgress:p=>{if(p.index>=3){events++;controller.abort();}}}),{name:'AbortError'});
 assert.equal(events,1);f.restored();assert.ok(f.renders>=3&&f.renders<=6);
});
test('solar GPU failure restores all renderer state',async()=>{
 const f=fixture();f.fail=true;await assert.rejects(computeSunGridAsync({...f.opts,yieldFrame:async()=>{}}),/GPU failure/);f.restored();assert.equal(sunGridRunning(f.opts.renderer),false);
});
test('hidden document finishes all GPU analysis without yielding or drawing a visible frame',async()=>{
 const before=globalThis.document,doc=new EventTarget();doc.hidden=true;globalThis.document=doc;
 try{
  const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(computeSunGridAsync({...f.opts,signal:controller.signal}),{name:'AbortError'});assert.equal(f.renders,0);f.restored();
  const g=fixture();let frames=0;const r=await computeSunGridAsync({...g.opts,batchSize:1,onProgress:()=>{},yieldFrame:async()=>{frames++;}});assert.equal(g.renders,49);assert.equal(frames,0);assert.deepEqual(r,reference(g.opts.center,g.opts.span));g.restored();
 }finally{if(before===undefined)delete globalThis.document;else globalThis.document=before;}
});

test('이웃 필지별 동지 일조: 칸 가운데가 필지 안이면 세고, 충족 비율·가장 짧은 시간 — 계산판 밖 필지는 0칸',async()=>{
 const {sunByParcel}=await import('./review-3d-sun.js');
 // 2×2 칸, 한 칸 1 m, 가운데 (0,0): 칸 가운데 도면 mm 순서 (−500,−500)(500,−500)(−500,500)(500,500) — sunWorstSpots 와 같은 줄 방향
 const r={grid:2,side:2,center:{x:0,z:0},cells:[{ok:true,continuous:150,total:300},{ok:false,continuous:30,total:90},null,{ok:true,continuous:200,total:400}]};
 const [north,east,far]=sunByParcel(r,[{jibun:'북',coords:[[-1000,0],[1000,0],[1000,1000],[-1000,1000]]},{jibun:'동',coords:[{x:0,y:-1000},{x:1000,y:-1000},{x:1000,y:0},{x:0,y:0}]},{jibun:'먼',coords:[[5000,5000],[6000,5000],[6000,6000]]}]);
 assert.deepEqual(north,{jibun:'북',cells:1,okRatio:1,minContinuousMin:200,minTotalMin:400},'건물 바닥 칸(null)은 안 셈');
 assert.deepEqual(east,{jibun:'동',cells:1,okRatio:0,minContinuousMin:30,minTotalMin:90});
 assert.equal(far.cells,0);assert.equal(far.okRatio,null);
});
