// shape-tools.js 순수 함수 시험. DOM 없이 node --test 로 돈다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';
import {
 pathLength,pointAtLength,
 meanValueWeights,mapPointBetweenShapes,mapEntity2DP,
 findBoundaryCrossings,polylineBoolean,
 buildBreakLine,
 nearestBoundaryPoint,contourConnectors,
 lineCrossings,buildJumpLine,
 pathDashes,dashRect,arrowHead,buildPathArrow,
 boundingBoxOf,
 perpendicularFoot,
 collectOpenEndpoints,pairEndpoints,
 joinChains,
 toPolylineForWidth,withWidth,
 buildOutline,
 unfoldLengths,
 xlineReferencePoints,longLineThrough,
 zigzagStraight,zigzagOnArc,
 installShapeTools,
 flattenPolyline3d,checkTolerance,checkZigzag,checkAngle,
} from './shape-tools.js';

const P=(x,y)=>({x,y});
const close=(a,b,eps=1e-6)=>Math.abs(a-b)<eps;
const closeP=(a,b,eps=1e-6)=>close(a.x,b.x,eps)&&close(a.y,b.y,eps);

/* ── installShapeTools: 이름 목록과 반환 형태 ── */
test('installShapeTools returns all 16 commands as functions',()=>{
 const cmds=installShapeTools({});
 const names=['3TP','2DP','BOO','BS','CBJ','JUL','PAA','PBB','PEC','PET','PJ','PW','PWD','UFD','XLD','ZIGZAG'];
 assert.equal(Object.keys(cmds).length,16);
 for(const n of names)assert.equal(typeof cmds[n],'function',n+' 명령이 없습니다');
});

/* ── 3TP: z 있는 폴리선 → 2D + elevation (2026-09-24 F13 실제 동작) ── */
test('3TP flattenPolyline3d strips vertex z into one elevation and leaves 2D polylines alone',()=>{
 const p3d={id:'p',type:'polyline',closed:false,points:[{x:0,y:0,z:385},{x:10,y:0,z:385},{x:10,y:10,z:390}]};
 const flat=flattenPolyline3d(p3d);
 assert.equal(flat.elevation,385);
 assert.ok(flat.points.every(p=>!('z' in p)));
 assert.equal(flattenPolyline3d({type:'polyline',points:[{x:0,y:0},{x:1,y:1}]}),null);
 assert.equal(flattenPolyline3d({type:'line',points:[{x:0,y:0,z:1},{x:1,y:1,z:1}]}),null);
 assert.equal(flattenPolyline3d({type:'rectangle',points:[{x:0,y:0},{x:1,y:1}],polyline3d:true}).closed,true);
});
test('3TP card converts selected 3D polylines with one batch and reports already-2D ones',async()=>{
 const calls=[],toasts=[];
 const p3d={id:'p',type:'polyline',closed:false,points:[{x:0,y:0,z:385},{x:10,y:0,z:385}]};
 const flat={id:'q',type:'polyline',closed:true,points:[{x:0,y:0},{x:10,y:0},{x:10,y:10}]};
 const ctx={selected:()=>[p3d,flat],execute:c=>calls.push(c),toast:m=>toasts.push(m),userErrorMessage:e=>e.message,pickEntity:async()=>null};
 await installShapeTools(ctx)['3TP']();
 assert.equal(calls.length,1);
 assert.equal(calls[0].commands.length,1);
 assert.equal(calls[0].commands[0].ids[0],'p');
 assert.equal(calls[0].commands[0].changes.elevation,385);
 assert.match(toasts[0],/1개를 2D/);
 const only2d={selected:()=>[flat],execute:c=>calls.push(c),toast:m=>toasts.push(m),userErrorMessage:e=>e.message,pickEntity:async()=>null};
 await installShapeTools(only2d)['3TP']();
 assert.equal(calls.length,1,'2D 만 있으면 execute 없음');
 assert.match(toasts.at(-1),/이미 2D/);
});
/* ── 2026-09-24 F9: 인식거리·지그재그·각도 상한 ── */
test('checkTolerance / checkZigzag / checkAngle reject huge or non-positive values with Korean messages',()=>{
 assert.equal(checkTolerance(250),250);
 assert.throws(()=>checkTolerance(1e15),/이하로 입력/);
 assert.throws(()=>checkTolerance(0),/0보다 큰/);
 assert.throws(()=>checkZigzag(1e15,1e15,0),/이하로 입력/);
 assert.throws(()=>checkZigzag(0,100,0),/양수/);
 assert.throws(()=>checkZigzag(100,100,-1),/0 이상/);
 assert.equal(checkAngle(45),45);
 assert.throws(()=>checkAngle(1e15),/360/);
 assert.throws(()=>checkAngle(NaN),/숫자/);
});

/* ── 경로 길이/위치 ── */
test('pathLength sums segment lengths',()=>{
 assert.equal(pathLength([P(0,0),P(3,0),P(3,4)]),7);
});
test('pointAtLength walks along a multi-segment path',()=>{
 const pts=[P(0,0),P(3,0),P(3,4)];
 const mid=pointAtLength(pts,1.5);
 assert.ok(closeP(mid.point,P(1.5,0)));
 const onSecond=pointAtLength(pts,5);
 assert.ok(closeP(onSecond.point,P(3,2)));
 assert.ok(closeP(onSecond.dir,P(0,1)));
});

/* ── 2DP: 평균값 좌표 ── */
test('mean value coordinates map a square onto itself as identity',()=>{
 const sq=[P(-100,-100),P(100,-100),P(100,100),P(-100,100)];
 const center=mapPointBetweenShapes(sq,sq,P(0,0));
 assert.ok(closeP(center,P(0,0),1e-6));
 const w=meanValueWeights(sq,P(0,0));
 for(const x of w)assert.ok(close(x,0.25,1e-6));
});
test('mean value coordinates send a source vertex exactly to the matching dest vertex',()=>{
 const src=[P(0,0),P(200,0),P(200,100),P(0,100)];
 const dst=[P(10,10),P(310,20),P(300,220),P(0,200)];
 for(let i=0;i<4;i++)assert.ok(closeP(mapPointBetweenShapes(src,dst,src[i]),dst[i],1e-6));
});
test('mapEntity2DP moves line points but keeps a text entity size, only moving its position',()=>{
 const src=[P(0,0),P(100,0),P(100,100),P(0,100)];
 const dst=[P(0,0),P(200,0),P(200,200),P(0,200)];
 const line={type:'line',points:[P(50,50),P(60,60)]};
 const moved=mapEntity2DP(line,src,dst);
 assert.ok(closeP(moved.points[0],P(100,100),1e-4));
 const text={type:'text',position:P(50,50),text:'A',height:100,rotation:0};
 const movedText=mapEntity2DP(text,src,dst);
 assert.equal(movedText.height,100);
 assert.ok(closeP(movedText.position,P(100,100),1e-4));
});

/* ── BOO: 폴리도형 합치기/빼기 (손으로 계산한 겹친 사각형 두 개) ── */
const rectA=[P(0,0),P(200,0),P(200,100),P(0,100)];
const rectB=[P(100,-50),P(300,-50),P(300,50),P(100,50)];
const area=pts=>Math.abs(pts.reduce((s,p,i)=>s+G.cross(p,pts[(i+1)%pts.length]),0))/2;
test('findBoundaryCrossings finds exactly the two lens intersection points',()=>{
 const hits=findBoundaryCrossings(rectA,rectB);
 assert.equal(hits.length,2);
});
test('polylineBoolean union area equals sum minus overlap',()=>{
 const u=polylineBoolean(rectA,rectB,'union');
 assert.ok(close(area(u),35000,1e-6));
});
test('polylineBoolean subtract area equals A minus overlap',()=>{
 const d=polylineBoolean(rectA,rectB,'subtract');
 assert.ok(close(area(d),15000,1e-6));
});
test('polylineBoolean refuses shapes that overlap in a complex way',()=>{
 const notOverlapping=[P(1000,1000),P(1100,1000),P(1100,1100),P(1000,1100)];
 assert.throws(()=>polylineBoolean(rectA,notOverlapping,'union'));
});

/* ── BS: 절단선 기호 ── */
test('buildBreakLine produces the expected zigzag coordinates',()=>{
 const line=buildBreakLine(P(0,0),P(400,0),100,false);
 assert.equal(line.points.length,6);
 assert.ok(closeP(line.points[0],P(0,0)));
 assert.ok(closeP(line.points[1],P(80,0)));
 assert.ok(closeP(line.points[5],P(400,0)));
});
test('buildBreakLine rejects coincident points',()=>{
 assert.throws(()=>buildBreakLine(P(0,0),P(0,0),100,false));
});

/* ── CBJ: 등고선-테두리 연결 ── */
test('nearestBoundaryPoint finds the closest point on a rectangle boundary',()=>{
 const rect=[P(0,0),P(100,0),P(100,100),P(0,100)];
 const hit=nearestBoundaryPoint(rect,true,P(50,-5));
 assert.ok(closeP(hit.point,P(50,0)));
 assert.ok(close(hit.distance,5));
});
test('contourConnectors links a nearby contour endpoint to the boundary',()=>{
 const boundary={points:[P(0,0),P(100,0),P(100,100),P(0,100)],type:'rectangle'};
 const contour={points:[P(50,-5),P(50,-50)]};
 const add=contourConnectors(boundary,[contour],10);
 assert.equal(add.length,1);
 assert.ok(closeP(add[0].points[0],P(50,-5)));
 assert.ok(closeP(add[0].points[1],P(50,0)));
});

/* ── JUL: 점프선 ── */
test('lineCrossings finds the crossing parameter of a perpendicular line',()=>{
 const ts=lineCrossings([P(0,0),P(400,0)],{points:[P(200,-50),P(200,50)]});
 assert.equal(ts.length,1);
 assert.ok(close(ts[0],0.5));
});
test('buildJumpLine inserts a triangular jog at the crossing',()=>{
 const jumped=buildJumpLine([P(0,0),P(400,0)],[0.5],40,20);
 assert.equal(jumped.points.length,5);
 assert.ok(closeP(jumped.points[0],P(0,0)));
 assert.ok(closeP(jumped.points[1],P(180,0)));
 assert.ok(closeP(jumped.points[2],P(200,20)));
 assert.ok(closeP(jumped.points[3],P(220,0)));
 assert.ok(closeP(jumped.points[4],P(400,0)));
});

/* ── PAA: 동선 화살표 ── */
test('pathDashes splits a straight path into segLen/gapLen dashes',()=>{
 const dashes=pathDashes([P(0,0),P(500,0)],100,50);
 assert.equal(dashes.length,4);// 0-100,150-250,300-400,450-500(잘림)
 assert.ok(closeP(dashes[0][0],P(0,0)));
 assert.ok(closeP(dashes[0][1],P(100,0)));
 assert.ok(closeP(dashes[3][1],P(500,0)));
});
test('dashRect builds a width-thick quad around a segment',()=>{
 const r=dashRect(P(0,0),P(100,0),20);
 assert.equal(r.points.length,4);
 assert.ok(r.points.every(p=>close(Math.abs(p.y),10)));
});
test('arrowHead builds two symmetric barb lines pointing outward',()=>{
 const [l,r]=arrowHead(P(100,0),P(1,0),30,10);
 assert.ok(closeP(l.points[0],P(100,0)));
 assert.ok(close(G.dist(l.points[1],P(91.3397,-5)),0,1e-3));
 assert.ok(close(G.dist(r.points[1],P(91.3397,5)),0,1e-3));
});
test('buildPathArrow with thicknessMode returns dash rectangles plus one end arrow',()=>{
 const pts=[P(0,0),P(300,0)];
 const entities=buildPathArrow(pts,{thicknessMode:true,thickness:20,segLen:100,gapLen:50,angle:30,size:10,gap:0,bothSides:false});
 assert.ok(entities.some(e=>e.type==='polyline'&&e.closed));
 assert.equal(entities.filter(e=>e.type==='line').length,2);
});

/* ── PBB: 경계 박스 ── */
test('boundingBoxOf wraps an entity bounds as a rectangle',()=>{
 const e={type:'line',points:[P(10,20),P(-5,60)]};
 const box=boundingBoxOf(e);
 assert.equal(box.type,'rectangle');
 assert.ok(closeP(box.points[0],P(-5,20)));
 assert.ok(closeP(box.points[2],P(10,60)));
});

/* ── PEC: 수직선 ── */
test('perpendicularFoot finds the foot on the nearest segment',()=>{
 const base={type:'line',points:[P(0,0),P(100,0)]};
 const foot=perpendicularFoot(base,P(40,25));
 assert.ok(closeP(foot,P(40,0)));
});

/* ── PET: 끝점 잇기(additive) ── */
test('pairEndpoints connects endpoints within tolerance and ignores same-entity ends',()=>{
 const entities=[
  {id:'a',type:'line',points:[P(0,0),P(100,0)]},
  {id:'b',type:'line',points:[P(103,0),P(200,0)]},
 ];
 const pairs=pairEndpoints(entities,5);
 assert.equal(pairs.length,1);
 assert.ok(closeP(pairs[0].points[0],P(100,0)));
 assert.ok(closeP(pairs[0].points[1],P(103,0)));
});
test('pairEndpoints finds nothing beyond tolerance',()=>{
 const entities=[
  {id:'a',type:'line',points:[P(0,0),P(100,0)]},
  {id:'b',type:'line',points:[P(103,0),P(200,0)]},
 ];
 assert.equal(pairEndpoints(entities,2).length,0);
});
test('collectOpenEndpoints skips closed polylines',()=>{
 const entities=[{id:'c',type:'polyline',closed:true,points:[P(0,0),P(10,0),P(10,10)]}];
 assert.equal(collectOpenEndpoints(entities).length,0);
});

/* ── PJ: 실제 잇기 ── */
test('joinChains merges three gapped collinear segments into one polyline',()=>{
 const items=[
  {points:[P(0,0),P(100,0)]},
  {points:[P(103,0),P(200,0)]},
  {points:[P(203,0),P(300,0)]},
 ];
 const chains=joinChains(items,5);
 assert.equal(chains.length,1);
 assert.equal(chains[0].closed,false);
 assert.ok(closeP(chains[0].points[0],P(0,0)));
 assert.ok(closeP(chains[0].points.at(-1),P(300,0)));
});
test('joinChains leaves far-apart segments as separate chains',()=>{
 const items=[{points:[P(0,0),P(100,0)]},{points:[P(500,0),P(600,0)]}];
 assert.equal(joinChains(items,5).length,2);
});

/* ── PW: 폴리선 두께 ── */
test('toPolylineForWidth converts a line to an open polyline',()=>{
 const poly=toPolylineForWidth({type:'line',points:[P(0,0),P(10,0)]});
 assert.equal(poly.type,'polyline');
 assert.equal(poly.closed,false);
});
test('toPolylineForWidth samples a circle into a closed polyline on the radius',()=>{
 const poly=toPolylineForWidth({type:'circle',center:P(0,0),radius:50},16);
 assert.equal(poly.closed,true);
 assert.equal(poly.points.length,16);
 for(const p of poly.points)assert.ok(close(G.dist(p,P(0,0)),50,1e-6));
});
test('withWidth only sets constantWidth for a positive value',()=>{
 const poly={type:'polyline',points:[]};
 assert.equal(withWidth(poly,0).constantWidth,undefined);
 assert.equal(withWidth(poly,25).constantWidth,25);
});

/* ── PWD: 두께+외곽선 ── */
test('buildOutline produces the expected rectangle around a straight segment',()=>{
 const outline=buildOutline([P(0,0),P(100,0)],5);
 assert.equal(outline.closed,true);
 assert.equal(outline.points.length,4);
 assert.ok(outline.points.every(p=>close(Math.abs(p.y),5)));
 assert.ok(outline.points.some(p=>close(p.x,0)));
 assert.ok(outline.points.some(p=>close(p.x,100)));
});

/* ── UFD: 펼치기 ── */
test('unfoldLengths accumulates open-path segment lengths',()=>{
 const lens=unfoldLengths([P(0,0),P(3,0),P(3,4)],false);
 assert.deepEqual(lens,[0,3,7]);
});
test('unfoldLengths includes the closing segment for a closed polyline',()=>{
 const lens=unfoldLengths([P(0,0),P(10,0),P(10,10),P(0,10)],true);
 assert.equal(lens.length,5);
 assert.equal(lens.at(-1),40);
});

/* ── XLD ── */
test('longLineThrough builds a long centered line at the given angle',()=>{
 const h=longLineThrough(P(0,0),0,100);
 assert.ok(closeP(h.points[0],P(-50,0)));
 assert.ok(closeP(h.points[1],P(50,0)));
 const v=longLineThrough(P(0,0),90,100);
 assert.ok(closeP(v.points[0],P(0,-50),1e-6));
 assert.ok(closeP(v.points[1],P(0,50),1e-6));
});
test('xlineReferencePoints returns endpoints+midpoint for a line, and 3 points for a circle',()=>{
 const lineRefs=xlineReferencePoints({type:'line',points:[P(0,0),P(10,0)]});
 assert.equal(lineRefs.length,3);
 assert.ok(closeP(lineRefs[2],P(5,0)));
 const circleRefs=xlineReferencePoints({type:'circle',center:P(0,0),radius:10});
 assert.equal(circleRefs.length,3);
});

/* ── ZIGZAG ── */
test('zigzagStraight builds the expected alternating offsets',()=>{
 const z=zigzagStraight(P(0,0),P(400,0),100,100);
 assert.equal(z.points.length,5);
 assert.ok(closeP(z.points[1],P(100,50)));
 assert.ok(closeP(z.points[2],P(200,-50)));
 assert.ok(closeP(z.points[3],P(300,50)));
});
test('zigzagOnArc starts and ends exactly on the given points',()=>{
 const z=zigzagOnArc(P(0,0),P(50,50),P(100,0),20,20);
 assert.ok(closeP(z.points[0],P(0,0),1e-6));
 assert.ok(closeP(z.points.at(-1),P(100,0),1e-6));
});
