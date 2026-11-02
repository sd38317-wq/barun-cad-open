import test from 'node:test';
import assert from 'node:assert/strict';
import {roofGeometry} from './roof-geometry.js';

const polygon=coords=>coords.map(([x,y])=>({x,y}));
const rectangle=polygon([[0,0],[8000,0],[8000,4000],[0,4000]]);
const lPlan=polygon([[0,0],[8000,0],[8000,4000],[4000,4000],[4000,8000],[0,8000]]);
const uPlan=polygon([[0,0],[10000,0],[10000,8000],[7000,8000],[7000,3000],[3000,3000],[3000,8000],[0,8000]]);
const close=(actual,expected,tol=1e-5)=>assert.ok(Math.abs(actual-expected)<=tol,`${actual} != ${expected}`);
const projectedArea=([a,b,c])=>((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))/2;
const polygonArea=ps=>Math.abs(ps.reduce((s,p,i)=>{const q=ps[(i+1)%ps.length];return s+p.x*q.y-p.y*q.x;},0)/2);

function verifyMesh(roof,expectedArea) {
  assert.equal(roof.fallback,false,roof.reason);
  assert.ok(roof.triangles.length>0);
  close(roof.triangles.reduce((s,t)=>s+projectedArea(t),0),expectedArea,Math.max(1e-5,expectedArea*1e-10));
  const heights=new Map();
  for (const t of roof.triangles) {
    assert.ok(projectedArea(t)>0,'top faces wind upwards');
    for (const p of t) {
      assert.ok([p.x,p.y,p.z].every(Number.isFinite));assert.ok(p.z>=0);
      const key=[p.x,p.y].map(v=>Math.round(v*1e5)).join(':');
      if (heights.has(key)) close(p.z,heights.get(key));
      heights.set(key,p.z);
    }
  }
}

function squareDistance(p,ps) {
  return Math.min(...ps.map((a,i)=>{
    const b=ps[(i+1)%ps.length],len=Math.hypot(b.x-a.x,b.y-a.y),dx=p.x-a.x,dy=p.y-a.y;
    const t=(dx*(b.x-a.x)+dy*(b.y-a.y))/len,n=(dx*(a.y-b.y)+dy*(b.x-a.x))/len;
    return Math.max(Math.abs(n),-t,t-len);
  }));
}

function verifyHipSamples(roof,ps,pitch) {
  for (const t of roof.triangles) {
    const centroid={x:t.reduce((s,p)=>s+p.x,0)/3,y:t.reduce((s,p)=>s+p.y,0)/3};
    close(t.reduce((s,p)=>s+p.z,0)/3,squareDistance(centroid,ps)*pitch/100);
    for (const p of t) close(p.z,squareDistance(p,ps)*pitch/100);
  }
}

test('rectangle gable: two planar faces, longest-edge ridge, 50% rise',()=>{
  const roof=roofGeometry(rectangle,{type:'gable',pitch:50});
  verifyMesh(roof,32000000);assert.equal(roof.faces.length,2);close(roof.maxHeight,1000);
  const ridge=roof.triangles.flat().filter(p=>Math.abs(p.z-1000)<1e-5);
  assert.ok(ridge.length);for (const p of ridge) close(p.y,2000);
  const across=roofGeometry(rectangle,{type:'gable',pitch:{height:1200},ridgeDirection:'y'});
  verifyMesh(across,32000000);close(across.maxHeight,1200);
  for (const p of across.triangles.flat().filter(p=>Math.abs(p.z-1200)<1e-5)) close(p.x,4000);
});

test('rectangle hip: four planar faces, equal pitch, correct ridge height',()=>{
  const roof=roofGeometry(rectangle,{type:'hip',pitch:50});
  verifyMesh(roof,32000000);assert.equal(roof.faces.length,4);close(roof.maxHeight,1000);
  verifyHipSamples(roof,rectangle,50);
});

test('L hip: six planar faces, full coverage and continuous equal-pitch heights',()=>{
  const roof=roofGeometry(lPlan,{type:'hip',pitch:50});
  verifyMesh(roof,48000000);assert.equal(roof.faces.length,6);close(roof.maxHeight,1000);
  assert.equal(roof.approximation,'orthogonal-square-wavefront');verifyHipSamples(roof,lPlan,50);
  const fixed=roofGeometry(lPlan,{type:'hip',height:1800});close(fixed.maxHeight,1800);
});

test('U hip includes inner valleys without covering the notch',()=>{
  const roof=roofGeometry(uPlan,{type:'hip',pitch:40});
  // The two separate top eaves share a plane, so there are seven plane groups.
  verifyMesh(roof,polygonArea(uPlan));assert.equal(roof.faces.length,7);close(roof.maxHeight,600);
  verifyHipSamples(roof,uPlan,40);
  for (const t of roof.triangles) {
    const x=t.reduce((s,p)=>s+p.x,0)/3,y=t.reduce((s,p)=>s+p.y,0)/3;
    assert.ok(!(x>3000&&x<7000&&y>3000));
  }
});

test('rotated L hip and reversed closed winding preserve coverage and heights',()=>{
  const angle=.37,ps=lPlan.map(p=>({x:1e8+p.x*Math.cos(angle)-p.y*Math.sin(angle),y:-2e8+p.x*Math.sin(angle)+p.y*Math.cos(angle)}));
  const roof=roofGeometry([...ps.slice().reverse(),ps.at(-1)],{type:'hip',pitch:50});
  verifyMesh(roof,48000000);assert.equal(roof.faces.length,6);close(roof.maxHeight,1000);
  verifyHipSamples(roof,ps,50);
});

test('overhang offsets eaves in mm; ridge rise uses expanded span',()=>{
  const roof=roofGeometry(rectangle,{type:'gable',pitch:50,overhang:500});
  verifyMesh(roof,45000000);close(roof.maxHeight,1250);
  const points=roof.triangles.flat();
  close(Math.min(...points.map(p=>p.x)),-500);close(Math.max(...points.map(p=>p.x)),8500);
  close(Math.min(...points.map(p=>p.y)),-500);close(Math.max(...points.map(p=>p.y)),4500);
  for (const p of points.filter(p=>Math.abs(p.y+500)<1e-5||Math.abs(p.y-4500)<1e-5)) close(p.z,0);
  const hip=roofGeometry(lPlan,{type:'hip',pitch:50,overhang:300});
  assert.equal(hip.fallback,false,hip.reason);assert.equal(hip.faces.length,6);close(hip.maxHeight,1150);
});

test('flat and shed: no ridge, percent and height input, explicit direction',()=>{
  const flat=roofGeometry(rectangle,{type:'flat',overhang:100});verifyMesh(flat,polygonArea(polygon([[-100,-100],[8100,-100],[8100,4100],[-100,4100]])));close(flat.maxHeight,0);
  const shed=roofGeometry(rectangle,{type:'shed',pitch:{percent:25},ridgeDirection:0});
  verifyMesh(shed,32000000);assert.equal(shed.faces.length,1);close(shed.maxHeight,1000);
  for (const p of shed.triangles.flat()) close(p.z,p.y*.25);
  close(roofGeometry(rectangle,{type:'shed',pitch:{height:750},ridgeDirection:{x:1,y:0}}).maxHeight,750);
});

test('normalization removes duplicate/collinear corners without mutating inputs',()=>{
  const ps=polygon([[0,0],[4000,0],[8000,0],[8000,0],[8000,4000],[0,4000],[0,0]]),copy=structuredClone(ps),options={type:'hip',pitch:50};
  const roof=roofGeometry(ps,options);verifyMesh(roof,32000000);assert.equal(roof.faces.length,4);
  assert.deepEqual(ps,copy);assert.deepEqual(options,{type:'hip',pitch:50});
});

test('degenerate and invalid outlines safely return empty flat mesh with reasons',()=>{
  for (const ps of [[],polygon([[0,0],[10,0],[20,0]]),polygon([[0,0],[10,10],[0,10],[10,0]]),[{x:NaN,y:0}],null]) {
    const roof=roofGeometry(ps,{type:'hip'});assert.equal(roof.type,'flat');assert.equal(roof.fallback,true);
    assert.ok(roof.reason);assert.deepEqual(roof.triangles,[]);
  }
});

test('unsupported/invalid options fall back to original triangulated flat outline',()=>{
  for (const options of [{type:'hip',pitch:-5},{type:'unknown'},{type:'gable',ridgeDirection:{x:0,y:0}},{type:'hip',overhang:-1},{type:'shed',height:Infinity}]) {
    const roof=roofGeometry(rectangle,options);assert.equal(roof.type,'flat');assert.equal(roof.fallback,true);assert.ok(roof.reason);
    close(roof.maxHeight,0);close(roof.triangles.reduce((s,t)=>s+projectedArea(t),0),32000000);
  }
  const oblique=lPlan.map((p,i)=>i===3?{x:3500,y:4500}:p),roof=roofGeometry(oblique,{type:'hip'});
  assert.equal(roof.fallback,true);assert.match(roof.reason,/orthogonal/);close(roof.triangles.reduce((s,t)=>s+projectedArea(t),0),polygonArea(oblique));
});

test('complexity guard rejects large boundaries with a reason',()=>{
  const ps=Array.from({length:1000},(_,i)=>({x:1000*Math.cos(i*Math.PI/500),y:1000*Math.sin(i*Math.PI/500)}));
  const roof=roofGeometry(ps,{type:'hip'});assert.equal(roof.fallback,true);assert.match(roof.reason,/limit/);
});
