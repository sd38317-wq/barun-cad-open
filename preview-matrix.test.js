// ACAD200 123: 미리보기는 행렬 하나로(작은 선택), 큰 선택은 그림 한 장 + 행렬.
import test from 'node:test';
import assert from 'node:assert/strict';
import {previewAffine,applyAffine,multiplyAffine,invertAffine,screenAffine,MatrixSnapshot} from './preview-matrix.js';
import {drawEntity} from './view.js';

const close=(a,b)=>assert.ok(Math.abs(a.x-b.x)<1e-9&&Math.abs(a.y-b.y)<1e-9,JSON.stringify([a,b]));
test('matrices for translate, rotate, scale and mirror match the former point rules',()=>{
  close(applyAffine(previewAffine('translate',{dx:3,dy:4}),{x:1,y:1}),{x:4,y:5});
  close(applyAffine(previewAffine('rotate',{base:{x:1,y:1},degrees:90}),{x:2,y:1}),{x:1,y:2});
  close(applyAffine(previewAffine('scale',{base:{x:1,y:1},factor:2}),{x:2,y:3}),{x:3,y:5});
  close(applyAffine(previewAffine('mirror',{a:{x:0,y:0},b:{x:1,y:1}}),{x:2,y:0}),{x:0,y:2});
  const m=previewAffine('rotate',{base:{x:5,y:-2},degrees:33});close(applyAffine(multiplyAffine(invertAffine(m),m),{x:7,y:9}),{x:7,y:9});
  const s=screenAffine(previewAffine('translate',{dx:10,dy:0}),{scale:2,origin:{x:100,y:50}});close(applyAffine(s,{x:0,y:0}),{x:20,y:0});
});

test('view.js preview wrapper: SCALE now really scales (it drew the source unscaled before)',()=>{
  const points=[],ctx={save(){},restore(){},beginPath(){},moveTo(x,y){points.push([x,y]);},lineTo(x,y){points.push([x,y]);},closePath(){},stroke(){},setLineDash(){}};
  const source={type:'line',points:[{x:1,y:0},{x:2,y:0}]};
  drawEntity(ctx,{type:'preview-transform',source,operation:'scale',base:{x:0,y:0},factor:3},p=>p,1,'#fff',1);
  assert.deepEqual(points,[[3,0],[6,0]]);
});

test('large selection: one snapshot, then only the matrix changes per frame',()=>{
  const draws=[],canvas=()=>({width:0,height:0,getContext(){return {setTransform(){},clearRect(){},save(){},restore(){}};}});
  const snap=new MatrixSnapshot(canvas);let painted=0;
  const ctx={save(){},restore(){},setTransform(...m){this.m=m;},drawImage(c,x,y){draws.push([...this.m]);}};
  const view={scale:2,origin:{x:0,y:100},ratio:1},bounds={minX:0,minY:0,maxX:10,maxY:10};
  for(const degrees of [0,30,60])snap.draw(ctx,{key:'k',bounds,view,affine:previewAffine('rotate',{base:{x:0,y:0},degrees}),paint:()=>{painted++;}});
  assert.equal(painted,1,'painted once');assert.equal(draws.length,3);assert.notDeepEqual(draws[1],draws[2]);
  // Identity matrix places the snapshot where it was painted (screen top-left of the bounds minus padding).
  assert.deepEqual(draws[0].map(v=>Math.round(v*1e6)/1e6),[1,0,0,1,-4,76]);
  // A huge selection is painted at lower resolution, never cropped.
  const big=new MatrixSnapshot(canvas);big.draw(ctx,{key:'b',bounds:{minX:0,minY:0,maxX:1e5,maxY:10},view,affine:previewAffine('translate',{}),paint:()=>{}});
  assert.ok(big.snap.k<1&&big.snap.canvas.width<=4096);
});
