// ACAD200 517: 치수 간격 0 = 자동 고르게(첫·끝 고정, 겹치지 않는 치수는 같은 칸, 겹침 허용치 1e-5).
import test from 'node:test';
import assert from 'node:assert/strict';
import {arrangeDimensionGaps,distributeDimensions,dimensionLanes,DIM_OVERLAP_TOLERANCE} from './dim-tools-4.js';
import {nativeDraftingEdits} from './architectural-library.js';

const P=(x,y)=>({x,y});
const h=(x0,x1,y,id)=>({id,type:'dimension',mode:'horizontal',points:[P(x0,0),P(x1,0),P((x0+x1)/2,y)]});
const yOf=d=>d.points[2].y;

test('간격 0: 첫·끝 치수는 제자리, 사이는 고르게',()=>{
 const dims=[h(0,1000,-300,'a'),h(0,2000,-700,'b'),h(0,3000,-1500,'c'),h(0,4000,-2000,'d')];
 const out=arrangeDimensionGaps(dims,null,0);
 [-300,-866.6666666666667,-1433.3333333333333,-2000].forEach((y,i)=>assert.ok(Math.abs(yOf(out[i])-y)<1e-9,yOf(out[i])+' ≈ '+y));
 assert.deepEqual(out[0].points.slice(0,2),dims[0].points.slice(0,2),'측정 끝점은 그대로');
});

test('겹치지 않는 치수는 같은 칸, 끝이 맞닿는 치수(겹침 0)도 같은 칸',()=>{
 const dims=[h(0,1000,-300,'a'),h(1000,2000,-500,'b'),h(0,2000,-900,'total'),h(2000,3000,-1300,'c')];
 const {lanes}=dimensionLanes(dims);
 assert.deepEqual(lanes.map(l=>l.map(it=>dims[it.i].id).sort()).sort(),[['a','b'],['c','total']]);
 const out=distributeDimensions(dims);
 assert.deepEqual(out.map(yOf),[-300,-300,-1300,-1300],'두 줄로: 첫 줄은 첫 치수 자리, 마지막 줄은 끝 치수 자리');
});

test('겹침 허용치 1e-5: 그보다 작게 겹치면 겹치지 않은 것으로 본다',()=>{
 assert.equal(DIM_OVERLAP_TOLERANCE,1e-5);
 const tiny=[h(0,1000,-300,'a'),h(1000-5e-6,2000,-600,'b')],real=[h(0,1000,-300,'a'),h(1000-2e-5,2000,-600,'b')];
 assert.equal(dimensionLanes(tiny).lanes.length,1);assert.equal(dimensionLanes(real).lanes.length,2);
});

test('모두 안 겹치면 첫 치수의 줄로 가지런히, 양수 간격은 예전 그대로',()=>{
 const dims=[h(0,1000,-300,'a'),h(2000,3000,-800,'b')];
 assert.deepEqual(distributeDimensions(dims).map(yOf),[-300,-300],'재는 점에 가장 가까운(안쪽) 치수 줄로');
 assert.deepEqual(arrangeDimensionGaps(dims,P(0,-100),50).map(yOf),[-50,-100]);
 assert.throws(()=>arrangeDimensionGaps(dims,P(0,0),-1),/0 = 자동/);
});

test('DIMCLEAN(DIMSPACE) 간격 0 = 자동: 방향별로 묶어 고르게, 바뀐 것만 고친다',()=>{
 const v=(y0,y1,x,id)=>({id,type:'dimension',mode:'vertical',points:[P(0,y0),P(0,y1),P(x,(y0+y1)/2)]});
 const dims=[h(0,1000,-300,'a'),h(0,2000,-400,'b'),h(0,3000,-1300,'c'),v(0,500,800,'v1'),{id:'t',type:'text'}];
 const edits=nativeDraftingEdits('DIMCLEAN',dims,{gap:0});
 assert.deepEqual(edits.map(e=>e.ids[0]),['b']);assert.equal(edits[0].changes.points[2].y,-800);
 assert.throws(()=>nativeDraftingEdits('DIMCLEAN',dims,{gap:-5}),/0\(자동\) 또는 양수/);
 assert.ok(nativeDraftingEdits('DIMCLEAN',dims,{gap:150}).length>=0,'최소 간격 모드는 그대로');
});
