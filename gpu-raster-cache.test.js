// ACAD200 122 (1단계): 나이 방식 래스터 캐시와 화면 크기에 맞는 밉 단계.
import test from 'node:test';
import assert from 'node:assert/strict';
import {GpuRasterCache,rasterLevel} from './gpu-raster-cache.js';
import {CanvasMipCache} from './raster-mip-cache.js';

test('textures are shared per source and level and released after maxAge unused frames',async()=>{
  let disposed=0;const cache=new GpuRasterCache({maxAge:2,createTexture:()=>({dispose(){disposed++;}})});
  const a=cache.acquire('site.png',1,async()=>({w:1})),b=cache.acquire('site.png',1,async()=>({w:2}));
  assert.equal(a,b);assert.equal(cache.stats.loads,1);assert.equal(cache.stats.hits,1);
  await new Promise(resolve=>setTimeout(resolve,0));assert.deepEqual(a.image,{w:1});
  cache.incrementAge();cache.incrementAge();assert.equal(cache.size,1);cache.acquire('site.png',1,()=>null);
  for(let i=0;i<3;i++)cache.incrementAge();assert.equal(cache.size,0);assert.equal(disposed,1);
});
test('mip level follows image pixels per screen pixel',()=>{
  assert.equal(rasterLevel(1000,1000),0);assert.equal(rasterLevel(1000,400),1);assert.equal(rasterLevel(8000,900),3);assert.equal(rasterLevel(10,0),3);
});
test('canvas mips are built on the next tick (the frame draws the original) and reused',()=>{
  const jobs=[];let ready=0;
  const canvas=()=>({width:0,height:0,getContext(){return {drawImage(){},set imageSmoothingQuality(v){}};}});
  const cache=new CanvasMipCache({createCanvas:canvas,schedule:fn=>jobs.push(fn),onReady:()=>ready++,maxAge:1});
  const image={naturalWidth:4000,naturalHeight:2000};
  assert.equal(cache.acquire('map',image,0),null,'level 0: draw the original');
  assert.equal(cache.acquire('map',image,2),null,'not ready yet');assert.equal(jobs.length,1);
  jobs.shift()();assert.equal(ready,1);
  const mip=cache.acquire('map',image,2);assert.equal(mip.canvas.width,1000);assert.equal(mip.canvas.height,500);assert.equal(mip.scale,4);
  cache.acquire('map',image,2);assert.equal(cache.stats.hits,2);assert.equal(jobs.length,0,'built once');
  cache.incrementAge();cache.incrementAge();assert.equal(cache.items.size,0,'unused mips are dropped');
});
