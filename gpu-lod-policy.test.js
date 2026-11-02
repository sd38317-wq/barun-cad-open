// ACAD200 108·109·110·112: 프레임 압박, LOD 전략, 픽셀 LOD 단계, 그리킹 기준.
import test from 'node:test';
import assert from 'node:assert/strict';
import {FramePressure,LOD_STRATEGIES,selectLodStrategy,movingBlockPixels,LOD_THRESHOLDS,combinedPressure,lodLevel,textGreekPixels} from './gpu-lod-policy.js';
import {createDisplayQuality} from './display-quality.js';
import {visibilityCacheKeys} from './viewport-visibility.js';

test('108: pressure comes from the recent frame average and only while interactive',()=>{
  const p=new FramePressure({desiredFps:30,window:4});
  for(const ms of [10,10,10,10])p.record(ms);
  assert.equal(p.pressure,0,'still view: no pressure');
  p.interactive=true;assert.equal(p.pressure,0,'fast frames');assert.equal(p.level,0);
  for(const ms of [50,50,50,50])p.record(ms);
  assert.ok(Math.abs(p.pressure-.5)<1e-9);assert.equal(p.level,1);
  for(const ms of [200,200,200,200])p.record(ms);assert.equal(p.pressure,1);assert.equal(p.level,2);
  p.record(NaN);p.record(-1);assert.equal(p.samples.length,4,'bad samples ignored');
  assert.deepEqual([0,1,2].map(movingBlockPixels),[96,144,192]);
});

test('109: three strategies; a still view keeps the former budgets exactly',()=>{
  assert.equal(selectLodStrategy({}),LOD_STRATEGIES.standard);
  assert.equal(LOD_STRATEGIES.standard.refineMs,8);assert.equal(LOD_STRATEGIES.standard.blockPixels,36);
  assert.equal(selectLodStrategy({interactive:true}),LOD_STRATEGIES.optimized);
  assert.equal(selectLodStrategy({building:true}),LOD_STRATEGIES.progressive);
  assert.equal(selectLodStrategy({memoryPressure:.85}),LOD_STRATEGIES.progressive);
});

test('110: pixel LOD levels use the 1/3/6/10 px thresholds and shrink under pressure',()=>{
  assert.deepEqual(LOD_THRESHOLDS,{invisible:1,imposter:3,lowRes:6,midRes:10});
  assert.equal(lodLevel(.5),'imposter','no pressure: a sub-pixel block stays a dot box');
  assert.equal(lodLevel(2),'imposter');assert.equal(lodLevel(4),'low');assert.equal(lodLevel(8),'mid');assert.equal(lodLevel(40),'full');
  assert.equal(lodLevel(0),'invisible');
  const half=combinedPressure(.5,0);assert.equal(half,.5);
  assert.equal(lodLevel(.5,half),'invisible','under pressure sub-pixel blocks are skipped');
  assert.equal(lodLevel(8,half),'imposter','8 px counts as 2^(3*0.5)=2.8 px');
  assert.equal(combinedPressure(.5,.5),.25);assert.equal(combinedPressure(0,0),1);
});

test('112: greeking size follows the strategy and grows under memory pressure; app setting turns it off',()=>{
  assert.equal(textGreekPixels(LOD_STRATEGIES.standard),3);assert.equal(textGreekPixels(LOD_STRATEGIES.standard,.9),6);
  const q=createDisplayQuality();q.beginFrame({interactive:false,doc:{}});assert.equal(q.strategy().name,'standard');assert.equal(q.strategy().textGreekPx,3);
  q.beginFrame({interactive:true});for(let i=0;i<8;i++)q.pressure.record(100);assert.equal(q.strategy().name,'optimized');assert.equal(q.blockPixels(true),192);assert.equal(q.lodBand,2);
  const previous=globalThis.localStorage;globalThis.localStorage={getItem:()=> 'off'};
  try{assert.equal(createDisplayQuality().strategy().textGreekPx,0);}finally{globalThis.localStorage=previous;}
  // The moving-frame visibility cache key carries the band, the still key is unchanged.
  const base={heavy:true,scale:1,a:{x:0,y:0},b:{x:10,y:10},width:10,height:10};
  assert.equal(visibilityCacheKeys({...base,viewMoving:false}).scaleKey,visibilityCacheKeys({...base,viewMoving:false,lodBand:0}).scaleKey);
  assert.notEqual(visibilityCacheKeys({...base,viewMoving:true,lodBand:1}).scaleKey,visibilityCacheKeys({...base,viewMoving:true}).scaleKey);
});
