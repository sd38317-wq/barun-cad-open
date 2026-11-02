import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';
import {snapIntersections} from './snap-intersections.js';

const pt=(x,y)=>({x,y}),line=(a,b)=>[a,b];
test('short-line near-tangent keeps the existing discriminant tolerance',()=>{
 const near=[line(pt(-.0005,1.001),pt(.0005,1.001))],curves=[{type:'circle',center:pt(0,0),radius:1}],p=pt(0,1.001);
 assert.deepEqual(snapIntersections(near,curves,p,.1),reference(near,curves,p,.1));
});
function reference(near,curves,p,tolerance) {
  const out=[],add=(point,a,b,label)=>{if(G.dist(point,p)<tolerance&&G.visiblePoint(a,point)&&G.visiblePoint(b,point))out.push({...point,label});};
  for(let i=0;i<near.length;i++)for(let j=i+1;j<near.length;j++){
    const h=G.lineIntersection(...near[i],...near[j]);
    if(h&&h.t>=0&&h.t<=1&&h.u>=0&&h.u<=1)add(h.point,near[i],near[j],'교차점');
  }
  for(let i=0;i<curves.length;i++){
    for(const segment of near)for(const point of G.intersections(curves[i],{type:'line',points:segment}))add(point,curves[i],segment,'곡선 교차점');
    for(let j=i+1;j<curves.length;j++)for(const point of G.intersections(curves[i],curves[j]))add(point,curves[i],curves[j],'곡선 교차점');
  }
  return out;
}

test('spatial intersection candidates preserve exhaustive results and tie order',()=>{
  let seed=19263;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
  for(let run=0;run<30;run++){
    const p=pt(run%2?1e8:0,run%2?-1e8:0),r=5;
    const near=Array.from({length:50},()=>line(pt(p.x+(random()-.5)*100,p.y+(random()-.5)*100),pt(p.x+(random()-.5)*100,p.y+(random()-.5)*100)));
    const curves=Array.from({length:15},(_,i)=>({type:i%2?'circle':'arc',center:pt(p.x+(random()-.5)*15,p.y+(random()-.5)*15),radius:random()*10+.1,startAngle:30,endAngle:220}));
    assert.deepEqual(snapIntersections(near,curves,p,r),reference(near,curves,p,r));
  }
});

test('tiny aperture on long lines, tangent curves, and duplicate geometry remains exact',()=>{
  const p=pt(1e9,-1e9),r=.02;
  const near=[line(pt(p.x-1e8,p.y),pt(p.x+1e8,p.y)),line(pt(p.x,p.y-1e8),pt(p.x,p.y+1e8))];
  near.push(near[0],line(p,p));
  const curves=[{type:'circle',center:pt(p.x,p.y+.01),radius:.01},{type:'circle',center:pt(p.x,p.y-.01),radius:.01}];
  assert.deepEqual(snapIntersections(near,curves,p,r),reference(near,curves,p,r));
});

test('intersection must be visible through both participating clip masks',()=>{
  const mask={points:[pt(1,-2),pt(3,-2),pt(3,2),pt(1,2)]};
  const a=Object.assign(line(pt(-4,0),pt(4,0)),{clipMasks:[mask]});
  const b=line(pt(0,-4),pt(0,4));
  assert.deepEqual(snapIntersections([a,b],[],pt(0,0),4),[]);
  const c={type:'circle',center:pt(0,0),radius:2,clipMasks:[mask]};
  assert.deepEqual(snapIntersections([a],[c],pt(0,0),4),reference([a],[c],pt(0,0),4));
});

test('broad phase preserves analytic intersection endpoint tolerance',()=>{
  const near=[line(pt(-1e8,0),pt(0,0))];
  const curves=[{type:'circle',center:pt(.5,.1),radius:.1}];
  const p=pt(.5,0),tolerance=.01;
  assert.deepEqual(snapIntersections(near,curves,p,tolerance),reference(near,curves,p,tolerance));
  assert.ok(snapIntersections(near,curves,p,tolerance).length);
});

test('parallel drawing-spanning lines are rejected before exact pair tests',()=>{
  const near=Array.from({length:2000},(_,i)=>line(pt(-1e8,(i-1000)*.001),pt(1e8,(i-1000)*.001)));
  const stats={};
  assert.deepEqual(snapIntersections(near,[],pt(0,0),2,stats),[]);
  assert.equal(stats.records,2000);assert.equal(stats.exactPairs,0);
  assert.ok(stats.broadPairs<2000);
});
