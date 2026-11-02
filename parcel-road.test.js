import test from 'node:test';
import assert from 'node:assert/strict';
import {deadEndRoadRequirement,estimatedRoadWidthM,estimatedFrontageM,roadDisplayEntities,frontageRoads} from './parcel-road.js';
const road={parcelRole:'road',closed:true,points:[{x:0,y:0},{x:20000,y:0},{x:20000,y:3000},{x:0,y:3000}],attributes:{pnu:'road'}};
test('dead-end road width follows the current length thresholds',()=>{
 assert.equal(deadEndRoadRequirement(9.9).requiredWidthM,2);
 assert.equal(deadEndRoadRequirement(15).requiredWidthM,3);
 assert.equal(deadEndRoadRequirement(35).requiredWidthM,6);
 assert.equal(deadEndRoadRequirement(35,{nonUrbanTownship:true}).requiredWidthM,4);
 assert.equal(deadEndRoadRequirement(15,{terrainException:true}).requiredWidthM,3);
});
test('road display estimates width, hatches the road and writes the verdict',()=>{
 assert.equal(estimatedRoadWidthM(road),3);
 const site={parcelRole:'site',closed:true,points:[{x:0,y:3000},{x:10000,y:3000},{x:10000,y:10000},{x:0,y:10000}]};
 assert.equal(estimatedFrontageM([site,road]),10);
 const display=roadDisplayEntities([site,road],{deadEnd:true,deadEndLengthM:15});
 assert.equal(display[0].type,'hatch');assert.match(display[1].text,/필요폭 3m · 확인 필요/);
});

// A13(10-21): 시청 부지에서 도로 추정폭 0.14m·0.18m·접도 0m. 굽은 도로는 꼭짓점이 촘촘해 '옆 꼭짓점↔다음 변' 거리를 폭으로 잡았다.
const arcRoad=(r1,r2,n=24)=>{const ring=(r,rev)=>Array.from({length:n+1},(_,i)=>{const t=(rev?n-i:i)/n*Math.PI/2;return {x:r*Math.cos(t),y:r*Math.sin(t)};});return {parcelRole:'road',closed:true,points:[...ring(r2,false),...ring(r1,true)],attributes:{pnu:'arc'}};};
test('A13: 굽은 도로(반지름 50~60m, 꼭짓점 50개)의 추정폭은 10m 근처다',()=>{
 const w=estimatedRoadWidthM(arcRoad(50000,60000));
 assert.ok(w>9&&w<11,'추정폭 '+w);
});
test('A13: 대지에 닿은 도로만 폭·검토 해치를 단다(주변 100개 넘는 도로를 다 늘어놓지 않는다)',()=>{
 const site={parcelRole:'site',closed:true,points:[{x:0,y:3000},{x:10000,y:3000},{x:10000,y:10000},{x:0,y:10000}]};
 const far={...road,points:road.points.map(p=>({x:p.x+90000,y:p.y})),attributes:{pnu:'far'}};
 const sliver={parcelRole:'road',closed:true,points:[{x:2000,y:2900},{x:6000,y:2900},{x:6000,y:3000},{x:2000,y:3000}],attributes:{pnu:'sliver'}};   // 0.4㎡ 자투리
 assert.deepEqual(frontageRoads([site,road,far,sliver]).map(r=>r.attributes.pnu),['road'],'멀리 있는 도로·자투리 조각은 빼고');
 assert.equal(estimatedFrontageM([site,sliver]),10,'자투리도 접도 길이에는 센다(닿은 대지 변 하나 10m)');
 const display=roadDisplayEntities([site,road,far]);
 assert.equal(display.filter(e=>e.type==='hatch').length,1);assert.ok(display.every(e=>e.attributes.sourceRoadPnu!=='far'));
});
