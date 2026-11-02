import test from 'node:test';import assert from 'node:assert/strict';
import {classifyStroke,straightLine,arrowMove,recognizeDoors,recognizeWindow,findWallLines,snapDirection,padSketchBounds,padSketchPngPlan} from './pad-sketch.js';

let seed=7;const noise=(k=6)=>((seed=(seed*1103515245+12345)%2147483648)/2147483648-.5)*2*k;
const stroke=(a,b,n=30,k=6)=>Array.from({length:n+1},(_,i)=>({x:a.x+(b.x-a.x)*i/n+noise(k),y:a.y+(b.y-a.y)*i/n+noise(k)}));
const arc=(c,r,from,to,n=40)=>Array.from({length:n+1},(_,i)=>{const t=(from+(to-from)*i/n)*Math.PI/180;return {x:c.x+r*Math.cos(t)+noise(8),y:c.y+r*Math.sin(t)+noise(8)};});
const shapes=strokes=>strokes.map(ps=>classifyStroke(ps,2));

test('wobbly stroke becomes a straight horizontal line rounded to 50mm',()=>{
 const shape=classifyStroke(stroke({x:0,y:0},{x:1012,y:28}),2);assert.equal(shape.kind,'line');
 const [a,b]=straightLine(shape);assert.ok(Math.abs(b.y-a.y)<1e-9);assert.equal(Math.round(b.x-a.x),1000);
 assert.deepEqual(snapDirection({x:1,y:.05}),{x:1,y:0});
});
test('closed shapes: box is a rectangle, round loop is a circle, scribble is unknown',()=>{
 const box=[...stroke({x:0,y:0},{x:800,y:0},10),...stroke({x:800,y:0},{x:800,y:500},10),...stroke({x:800,y:500},{x:0,y:500},10),...stroke({x:0,y:500},{x:0,y:8},10)];
 assert.equal(classifyStroke(box,2).kind,'rect');
 assert.equal(classifyStroke(arc({x:0,y:0},400,0,355),2).kind,'circle');
 const scribble=Array.from({length:60},(_,i)=>({x:(i%7)*40+noise(30),y:(i%5)*60+noise(30)}));
 assert.ok(!['line','rect','circle','arc'].includes(classifyStroke(scribble,2).kind));
});
test('quarter arc plus leaf is a 900 door with hinge, wall direction and swing side',()=>{
 const [door]=recognizeDoors(shapes([arc({x:0,y:0},880,0,90),stroke({x:0,y:0},{x:0,y:890})]),2);
 assert.equal(door.kind,'door');assert.equal(door.width,900);assert.deepEqual(door.u,{x:1,y:0});assert.equal(door.side,'positive');
 assert.ok(Math.hypot(door.hinge.x,door.hinge.y)<60);
 const [flipped]=recognizeDoors(shapes([arc({x:0,y:0},800,0,-90),stroke({x:0,y:0},{x:0,y:-800})]),2);
 assert.equal(flipped.width,800);assert.equal(flipped.side,'negative');
});
test('two arcs whose leaves meet are a double door',()=>{
 const doors=recognizeDoors(shapes([arc({x:0,y:0},600,0,90),stroke({x:0,y:0},{x:0,y:600}),arc({x:1200,y:0},600,180,90),stroke({x:1200,y:0},{x:1200,y:600})]),2);
 assert.equal(doors.length,1);assert.equal(doors[0].style,'double');assert.equal(doors[0].width,1200);
});
test("user's hand-drawn sliding window: centre line, two offset sashes, double jambs",()=>{
 // 2026-10-09 사용자 종이 사진을 mm 로 옮김: 벽 두께 200, 창틀 -500·+500, 가운데 세로선이 위아래로 벽을 지나감
 const sketch=[stroke({x:-1300,y:0},{x:-500,y:0}),stroke({x:-1300,y:200},{x:-500,y:200}),stroke({x:500,y:-20},{x:1300,y:-30}),stroke({x:500,y:190},{x:1300,y:210}),
  stroke({x:-510,y:0},{x:-510,y:200}),stroke({x:-490,y:0},{x:-490,y:200}),stroke({x:495,y:0},{x:495,y:200}),stroke({x:515,y:0},{x:515,y:200}),
  stroke({x:-480,y:70},{x:60,y:75}),stroke({x:-60,y:130},{x:480,y:128}),stroke({x:0,y:-300},{x:5,y:520})];
 const window=recognizeWindow(shapes(sketch),2);
 assert.equal(window.kind,'window');assert.equal(window.style,'sliding');assert.equal(window.width,1000);assert.deepEqual(window.u,{x:1,y:0});
 assert.ok(Math.abs(window.center.x)<20&&Math.abs(window.center.y-100)<20);
});
test('box with a middle line is a window; plain box is not',()=>{
 const box=[...stroke({x:0,y:0},{x:1500,y:0},10),...stroke({x:1500,y:0},{x:1500,y:200},10),...stroke({x:1500,y:200},{x:0,y:200},10),...stroke({x:0,y:200},{x:0,y:6},10)];
 const window=recognizeWindow(shapes([box,stroke({x:40,y:100},{x:1460,y:104})]),2);assert.equal(window.width,1500);assert.deepEqual(window.u,{x:1,y:0});
 assert.equal(recognizeWindow(shapes([box]),2),null);
});
test('arrow after a circle moves straight down by the drawn length rounded to 50',()=>{
 const shaft=stroke({x:0,y:0},{x:12,y:-310}),head=[{x:-25,y:-270},{x:12,y:-312},{x:40,y:-275}];
 const move=arrowMove([...shaft,...head]);assert.deepEqual(move.u,{x:0,y:-1});assert.equal(move.distance,300);assert.deepEqual(move.vector,{x:0,y:-300});
});
test('wall lines under a sketch are found; none when too far apart',()=>{
 const walls=[{id:'a',type:'line',points:[{x:-2000,y:0},{x:2000,y:0}]},{id:'b',type:'line',points:[{x:-2000,y:200},{x:2000,y:200}]},{id:'c',type:'line',points:[{x:-2000,y:900},{x:2000,y:900}]}];
 const pair=findWallLines(walls,{x:0,y:100},{x:1,y:0},1000);assert.deepEqual(pair.lines.map(e=>e.id),['a','b']);assert.equal(pair.gap,200);
 assert.equal(findWallLines(walls.slice(1),{x:0,y:100},{x:1,y:0},1000),null);
});

test('raw sketch PNG plan preserves negative coordinates and y-up orientation with one pixel scale',()=>{
 const paths=[[{x:-1200,y:300},{x:600,y:-100}],[{x:-500,y:900}]],original=structuredClone(paths);
 const p=padSketchPngPlan(paths,1024);
 assert.deepEqual(p.bounds,{minX:-1200,minY:-100,maxX:600,maxY:900});assert.deepEqual(paths,original);
 assert.equal(p.width,1024);assert.ok(p.height<=1024);
 assert.ok(Math.abs((p.window.maxY-p.window.minY)/p.height-p.mmPerPixel)<1e-12);
 for(const point of paths.flat()){
  const x=(point.x-p.window.minX)/p.mmPerPixel,y=(p.window.maxY-point.y)/p.mmPerPixel;
  assert.ok(x>=15.999&&x<=p.width-15.999&&y>=15.999&&y<=p.height-15.999);
  assert.ok(Math.abs(p.window.minX+x*p.mmPerPixel-point.x)<1e-9);
  assert.ok(Math.abs(p.window.maxY-y*p.mmPerPixel-point.y)<1e-9);
 }
});
test('PNG range handles empty, invalid, dot, flat, portrait and large raw paths without spread limits',()=>{
 assert.equal(padSketchBounds([[]]),null);assert.throws(()=>padSketchPngPlan([]),/없습니다/);
 for(const bad of [NaN,Infinity,'4'])assert.throws(()=>padSketchPngPlan([[{x:bad,y:0}]]),/좌표/);
 const dot=padSketchPngPlan([[{x:10,y:-20}]]);assert.ok(dot.mmPerPixel>0);assert.ok(dot.width>0&&dot.height>0);
 const flat=padSketchPngPlan([[{x:0,y:0},{x:1000,y:0}]],1);assert.equal(flat.width,256);assert.ok(flat.height>=33);
 const tall=padSketchPngPlan([[{x:0,y:-1000},{x:0,y:1000}]],9999);assert.equal(tall.height,2048);
 const big=[Array.from({length:150000},(_,i)=>({x:i,y:-i}))];assert.equal(padSketchPngPlan(big).bounds.maxX,149999);
 assert.throws(()=>padSketchPngPlan([[{x:-Number.MAX_VALUE,y:0},{x:Number.MAX_VALUE,y:0}]]),/범위/);
});
