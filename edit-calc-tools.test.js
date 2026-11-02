// edit-calc-tools.js 순수 함수 시험. DOM 없이 node --test 로 돈다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';
import {
 PY_PER_M2,formatNumber,roundTo,readNumber,
 entityAnchor,entityAngle,curveSegments,closestOnSegment,segmentPairMinimum,minimumDistancePair,
 filletPolyline,filletLineChain,
 breakCircleArcs,
 nearestParamOnPath,replacePolylineSection,
 pathTotalLength,pointAtPathLength,measureAlongPath,
 offsetAndClosePoints,arcToPoints,
 rotationFromReference,
 readRememberedScale,rememberScale,
 sortNumberGroup,pairNumberGroups,abcResults,
 vertexDistanceRows,
 sumPairedSymbols,
 perpendicularFoot,rightAngleMark,triangleTakeoff,quadTakeoff,
 orderBoundaryVertices,orderShapes,siteAreaRows,areaTableEntities,
 areaScaleFactor,closedAreaOf,SCA_FACTOR_LIMIT,
 installEditCalcTools,
} from './edit-calc-tools.js';

const P=(x,y)=>({x,y});

/* ── 2026-09-24 검토 F9: SCA 배율 상한 · SAR 문자크기/축척 0 ── */
test('SCA: 목표 면적이 비현실적으로 크거나 작으면(배율 100배 밖) 한글 오류',()=>{
 near(areaScaleFactor(3e6,6,'m2'),Math.SQRT2);
 near(areaScaleFactor(500,500,'m2'),1000,1e-9);// m 단위로 그린 대지를 mm 로(검토자 지적 8: 단위 환산 1000배 허용)
 assert.throws(()=>areaScaleFactor(3e6,1e15,'m2'),new RegExp(`${SCA_FACTOR_LIMIT}`));
 assert.throws(()=>areaScaleFactor(3e6,0.0000001,'m2'),/배율/);
 assert.throws(()=>areaScaleFactor(3e6,0,'m2'),/양수/);
});
test('SAR: 문자크기·선축척 0 은 폼 안에서 한글 오류로 막는다',async()=>{
 let formError=null;
 const ctx={storage:null,num:()=>150,ensureLayer:n=>n,layers:()=>[],entities:()=>[],selected:()=>[],selectedIds:()=>[],
  toast:()=>{},userErrorMessage:e=>e.message,execute:()=>[],commit:()=>[],refresh:()=>{},pickPoint:async()=>null,pickEntity:async()=>null,pickPath:async()=>null,tolerance:()=>1,
  form:(title,fields,onApply)=>{const values=Object.fromEntries(fields.map(f=>[f.name,f.value]));values.textSize='0';values.lineScale='0';return Promise.resolve(onApply(values)).catch(e=>{formError=e;});}};
 const cmds=installEditCalcTools(ctx);
 const p=cmds.SAR();
 await new Promise(r=>setTimeout(r,10));
 assert.ok(formError,'폼 검증 오류가 없다');
 assert.match(formError.message,/문자크기/);
 void p;
});
const near=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const nearP=(a,b,eps=1e-6)=>{near(a.x,b.x,eps);near(a.y,b.y,eps);};
const T=(text,x,y,extra={})=>({type:'text',text,position:P(x,y),height:100,...extra});

/* ── 진입점 ── */
test('installEditCalcTools 는 맡은 명령 15개를 함수로 돌려준다',()=>{
 const cmds=installEditCalcTools({});
 const names=['FR','CB','DMD','PVS','MM','OAA','OC','RR','SS','ABC','DM','SPN','AHM','SAR','SCA'];
 assert.equal(Object.keys(cmds).length,15);
 for(const n of names)assert.equal(typeof cmds[n],'function',`${n} 명령이 없습니다`);
});

/* ── 숫자 서식·읽기 ── */
test('formatNumber·roundTo·readNumber',()=>{
 assert.equal(formatNumber(1234.5,3,true),'1,234.500');
 assert.equal(formatNumber(1234.5,1,false),'1234.5');
 assert.equal(roundTo(2.3456,3,'round'),2.346);
 assert.equal(roundTo(2.3451,2,'ceil'),2.35);
 assert.equal(roundTo(2.3499,2,'floor'),2.34);
 assert.equal(readNumber('1,234.5'),1234.5);
 assert.equal(readNumber('-12'),-12);
 assert.equal(readNumber('ET-454'),null);
 assert.equal(readNumber('A'),null);
});

/* ── 객체에서 점·각도 읽기 (OAA 근거) ── */
test('entityAnchor·entityAngle',()=>{
 nearP(entityAnchor({type:'line',points:[P(10,20),P(30,40)]}),P(10,20));
 nearP(entityAnchor({type:'circle',center:P(5,6),radius:1}),P(5,6));
 nearP(entityAnchor(T('가',7,8)),P(7,8));
 near(entityAngle({type:'line',points:[P(0,0),P(0,100)]}),90);
 near(entityAngle({type:'polyline',points:[P(0,0),P(100,100),P(200,0)]}),45);
 near(entityAngle(T('가',0,0,{rotation:30})),30);
 near(entityAngle({type:'arc',center:P(0,0),radius:100,startAngle:0,endAngle:90}),135);
});

/* ── DMD(/167): 최단 거리 ── */
test('closestOnSegment·segmentPairMinimum',()=>{
 nearP(closestOnSegment(P(500,300),P(0,0),P(1000,0)),P(500,0));
 nearP(closestOnSegment(P(-500,0),P(0,0),P(1000,0)),P(0,0));
 const m=segmentPairMinimum(P(0,0),P(1000,0),P(0,500),P(1000,500));
 near(m.distance,500);
 const cross=segmentPairMinimum(P(0,0),P(1000,0),P(500,-100),P(500,100));
 near(cross.distance,0);
});
test('DMD: 평행한 두 선과 선-원 사이 최단거리를 좌표로 확인',()=>{
 const a={type:'line',points:[P(0,0),P(1000,0)]},b={type:'line',points:[P(0,500),P(1000,500)]};
 const r=minimumDistancePair(a,b);
 near(r.distance,500);
 near(r.a.y,0);near(r.b.y,500);
 const circle={type:'circle',center:P(0,1000),radius:200};
 const s=minimumDistancePair(a,circle);
 near(s.distance,800);
 nearP(s.a,P(0,0));
 nearP(s.b,P(0,800));
});
test('curveSegments 는 원을 잘게 나눠 돌려준다',()=>{
 const ss=curveSegments({type:'circle',center:P(0,0),radius:100},720);
 assert.equal(ss.length,720);
 near(G.dist(P(0,0),ss[0][0]),100);
});

/* ── FR(/439): 필렛 ── */
test('FR: 1000각형 폴리선 모서리에 반지름 100 필렛 — 접점·호 중심을 좌표로 확인',()=>{
 const square=[P(0,0),P(1000,0),P(1000,1000),P(0,1000)];
 const {points,arcs}=filletPolyline(square,true,100);
 assert.equal(arcs.length,4);
 assert.equal(points.length,8);
 nearP(points[0],P(0,100));
 nearP(points[1],P(100,0));
 nearP(points[2],P(900,0));
 nearP(points[3],P(1000,100));
 nearP(arcs[0].center,P(100,100));
 nearP(arcs[1].center,P(900,100));
 for(const a of arcs)near(a.radius,100);
});
test('FR: 열린 폴리선은 양 끝 정점을 그대로 둔다',()=>{
 const {points,arcs}=filletPolyline([P(0,0),P(1000,0),P(1000,1000)],false,100);
 assert.equal(arcs.length,1);
 nearP(points[0],P(0,0));
 nearP(points[1],P(900,0));
 nearP(points[2],P(1000,100));
 nearP(points[3],P(1000,1000));
});
test('FR: 반지름이 이웃 선보다 크면 한국어 오류',()=>{
 assert.throws(()=>filletPolyline([P(0,0),P(100,0),P(100,100)],false,500),/반지름/);
});
test('FR: 여러 선을 순서대로 필렛하면 호가 사이마다 생긴다',()=>{
 const lines=[
  {id:'a',type:'line',layer:'L',points:[P(0,0),P(1000,0)]},
  {id:'b',type:'line',layer:'L',points:[P(1000,0),P(1000,1000)]},
  {id:'c',type:'line',layer:'L',points:[P(1000,1000),P(0,1000)]}];
 const {updates,extras}=filletLineChain(lines,100,false);
 assert.equal(updates.length,3);
 assert.equal(extras.length,2);
 for(const arc of extras)near(arc.radius,100);
 assert.deepEqual(updates.map(u=>u.id),['a','b','c']);
});

/* ── CB(/414): 원 자르기 ── */
test('CB: 두 점으로 호 2개, 점 없이 사등분이면 호 4개 · 켜는 원본 유지',()=>{
 const circle={id:'c1',type:'circle',center:P(0,0),radius:100,layer:'A-WALL'};
 const two=breakCircleArcs(circle,[P(100,0),P(0,100)]);
 assert.equal(two.length,2);
 assert.deepEqual(two.map(a=>[a.startAngle,a.endAngle]),[[0,90],[90,0]]);
 assert.equal(two[0].layer,'A-WALL');
 const four=breakCircleArcs(circle,[]);
 assert.equal(four.length,4);
 assert.deepEqual(four.map(a=>a.startAngle),[0,90,180,270]);
 assert.throws(()=>breakCircleArcs({type:'line',points:[]},[]),/원/);
 assert.throws(()=>breakCircleArcs(circle,[P(100,0),P(100,0)]),/서로 다른/);
});

/* ── PVS(/131): 폴리선 모양 변경 ── */
test('PVS: 정점을 정확히 찍지 않아도 구간이 새 점열로 바뀐다(열린 폴리선)',()=>{
 const pts=[P(0,0),P(500,0),P(1000,0),P(1500,0)];
 const near0=nearestParamOnPath(pts,false,P(400,50));
 near(near0.param,0.8);
 const out=replacePolylineSection(pts,false,[P(400,0),P(600,300),P(1100,0)]);
 assert.equal(out.length,5);
 nearP(out[0],P(0,0));
 nearP(out[1],P(400,0));
 nearP(out[2],P(600,300));
 nearP(out[3],P(1100,0));
 nearP(out[4],P(1500,0));
});
test('PVS: 닫힌 폴리선은 지정 구간만 치환하고 나머지 정점을 유지한다',()=>{
 const pts=[P(0,0),P(1000,0),P(1000,1000),P(0,1000)];
 const out=replacePolylineSection(pts,true,[P(500,0),P(700,-300),P(1000,500)]);
 nearP(out[0],P(500,0));
 nearP(out[1],P(700,-300));
 nearP(out[2],P(1000,500));
 nearP(out[3],P(1000,1000));
 nearP(out[4],P(0,1000));
 nearP(out[5],P(0,0));
 assert.equal(out.length,6);
});

/* ── MM(/324): 블럭배열(Measure) ── */
test('MM: 시작거리를 비우면 "(전체-간격×개수)/2" 로 가운데 정렬한다',()=>{
 const pts=[P(0,0),P(1000,0)];
 near(pathTotalLength(pts,false),1000);
 const centered=measureAlongPath(pts,false,300,null);
 near(centered.offset,50);
 assert.equal(centered.spots.length,4);
 assert.deepEqual(centered.spots.map(s=>Math.round(s.point.x)),[50,350,650,950]);
 for(const s of centered.spots)near(s.angle,0);
});
test('MM: 시작거리 0 이면 시작점에 붙는다 · 꺾인 선에서도 접선각을 돌려준다',()=>{
 const flush=measureAlongPath([P(0,0),P(1000,0)],false,300,0);
 assert.deepEqual(flush.spots.map(s=>Math.round(s.point.x)),[0,300,600,900]);
 const bent=pointAtPathLength([P(0,0),P(100,0),P(100,500)],false,300);
 nearP(bent.point,P(100,200));
 near(bent.angle,90);
 assert.throws(()=>measureAlongPath([P(0,0),P(100,0)],false,500,0),/짧습니다/);
});

/* ── OC(/417): 간격띄우고 연결 ── */
test('OC: 원본과 옵셋을 이어 닫힌 점열을 만든다',()=>{
 const base=[P(0,0),P(1000,0)],off=[P(0,100),P(1000,100)];
 const out=offsetAndClosePoints(base,off);
 assert.equal(out.length,4);
 nearP(out[0],P(0,0));
 nearP(out[1],P(1000,0));
 nearP(out[2],P(1000,100));
 nearP(out[3],P(0,100));
 near(G.polygonArea(out),100000);
});
test('OC: 호는 폴리선 점열로 편다(바른 CAD 폴리선에 bulge 가 없다)',()=>{
 const pts=arcToPoints({center:P(0,0),radius:100,startAngle:0,endAngle:90},15);
 assert.equal(pts.length,7);
 nearP(pts[0],P(100,0));
 nearP(pts.at(-1),P(0,100),1e-9);
 for(const p of pts)near(G.dist(P(0,0),p),100);
});

/* ── RR(/114): 참조 회전 ── */
test('RR: 참조각과 목표각의 차이를 돌려준다',()=>{
 near(rotationFromReference(P(0,0),P(0,0),P(1,0),P(0,1)),90);
 near(rotationFromReference(P(0,0),P(100,100),P(200,200),P(1,0)),-45);
 near(rotationFromReference(P(50,50),P(0,0),P(-1,0),P(51,50)),180);
});

/* ── SS(/435): 배율 기억 ── */
test('SS: 배율을 저장했다가 다음 실행에서 기본값으로 되돌려준다',()=>{
 const box=new Map();
 const storage={getItem:k=>box.get(k)??null,setItem:(k,v)=>box.set(k,v)};
 assert.equal(readRememberedScale(storage),1);
 rememberScale(storage,2.5);
 assert.equal(readRememberedScale(storage),2.5);
 assert.throws(()=>rememberScale(storage,0),/0보다/);
 assert.equal(readRememberedScale({getItem:()=>'깨진값'},'k',3),3);
});

/* ── ABC(/391): 여러 숫자 연산 ── */
test('ABC: 상→하 정렬로 두 묶음을 짝짓고 쌍별로 계산한다',()=>{
 const a=[T('10',0,900),T('20',0,600),T('30',0,300)];
 const b=[T('2',500,905),T('4',500,595),T('5',500,300)];
 const sorted=sortNumberGroup([a[2],a[0],a[1]],'topDown',10);
 assert.deepEqual(sorted.map(e=>e.text),['10','20','30']);
 const pairs=pairNumberGroups(a,b,{order:'topDown',tolerance:10});
 assert.deepEqual(pairs.map(([x,y])=>[x.text,y.text]),[['10','2'],['20','4'],['30','5']]);
 assert.deepEqual(abcResults(pairs,'*',{decimals:3}).map(r=>r.value),[20,80,150]);
 assert.deepEqual(abcResults(pairs,'/',{decimals:2}).map(r=>r.value),[5,5,6]);
});
test('ABC: 두 번째가 숫자 하나면 모든 첫 묶음에 같은 값을 적용한다(NUC 와 같아짐)',()=>{
 const a=[T('10',0,900),T('20',0,600)];
 const pairs=pairNumberGroups(a,[T('3',500,0)],{});
 assert.deepEqual(abcResults(pairs,'+').map(r=>r.value),[13,23]);
 assert.throws(()=>pairNumberGroups(a,[T('1',0,0),T('2',0,10),T('3',0,20)],{}),/개수가 다릅니다/);
 assert.throws(()=>abcResults(pairNumberGroups(a,[T('0',0,0)],{}),'/'),/0으로/);
});
test('ABC: 좌→우 정렬은 x 오름차순으로 짝짓는다',()=>{
 const a=[T('1',900,0),T('2',100,0),T('3',500,0)];
 assert.deepEqual(sortNumberGroup(a,'leftRight',10).map(e=>e.text),['2','3','1']);
});

/* ── DM(/444): 정점 간 거리 목록 ── */
test('DM: 구간별 거리를 단위·자릿수에 맞춰 줄바꿈 문자열로 만든다',()=>{
 const pts=[P(0,0),P(3000,0),P(3000,4000)];
 const m=vertexDistanceRows(pts,false,{unit:'m',decimals:3});
 assert.deepEqual(m.rows,[3,4]);
 near(m.total,7);
 assert.equal(m.text,'3.000\n4.000');
 const mm=vertexDistanceRows(pts,false,{unit:'mm',decimals:0});
 assert.equal(mm.text,'3000\n4000');
 const closed=vertexDistanceRows(pts,true,{unit:'m',decimals:1});
 assert.equal(closed.rows.length,3);
 near(closed.rows[2],5);
 assert.throws(()=>vertexDistanceRows([P(0,0)],false,{}),/정점/);
});

/* ── SPN(/463): 기호별 합산 ── */
test('SPN: 숫자마다 가장 가까운 기호를 찾아 기호별로 합산한다',()=>{
 const texts=[T('A',0,0),T('3',10,0),T('2',20,0),T('B',1000,0),T('5',1010,0)];
 const rows=sumPairedSymbols(texts,{real:true,decimals:3});
 assert.deepEqual(rows.map(r=>[r.symbol,r.sum,r.count]),[['A',5,2],['B',5,1]]);
 const ints=sumPairedSymbols([T('A',0,0),T('1.4',10,0),T('1.4',20,0)],{real:false});
 assert.deepEqual(ints.map(r=>r.sum),[3]);
 assert.throws(()=>sumPairedSymbols([T('1',0,0),T('2',10,0)],{}),/기호/);
});

/* ── AHM(/504) · SAR(/170): 구적 ── */
test('AHM: 수선의 발·직각표시 기호 좌표를 확인한다',()=>{
 const m=rightAngleMark(P(0,0),P(1000,0),P(200,800),100);
 nearP(m.foot,P(200,0));
 near(m.height,800);
 near(m.base,1000);
 near(m.area,400000);
 nearP(m.heightLine[0],P(200,800));
 nearP(m.heightLine[1],P(200,0));
 // 긴 쪽(오른쪽) 밑변 방향에 한 변 100 짜리 직각 기호가 선다.
 assert.equal(m.mark.length,3);
 nearP(m.mark[0],P(300,0));
 nearP(m.mark[1],P(300,100));
 nearP(m.mark[2],P(200,100));
 nearP(perpendicularFoot(P(0,0),P(0,1000),P(500,400)),P(0,400));
 assert.throws(()=>rightAngleMark(P(0,0),P(1000,0),P(500,0),100),/밑변 위/);
});
test('SAR: 삼각형 한 개의 밑변·높이·면적',()=>{
 const t=triangleTakeoff([P(0,0),P(1000,0),P(500,800)]);
 assert.equal(t.kind,'triangle');
 near(t.base,1000);
 near(t.height,800);
 near(t.area,400000);
 nearP(t.centroid,P(500,800/3));
});
test('SAR: 사각구적 판별은 사각오차(도) 안에서만 통한다',()=>{
 const q=quadTakeoff([P(0,0),P(1000,0),P(1000,600),P(0,600)],0.1);
 assert.equal(q.kind,'quad');
 near(q.width,1000);
 near(q.height,600);
 near(q.area,600000);
 assert.equal(quadTakeoff([P(0,0),P(1000,0),P(1010,600),P(0,600)],0.1),null);
 assert.equal(quadTakeoff([P(0,0),P(1000,0),P(500,800)],0.1),null);
});
test('SAR: 정렬기준·진행방향이 번호 순서를 정한다',()=>{
 const square=[P(0,0),P(1000,0),P(1000,1000),P(0,1000)];
 const tl=orderBoundaryVertices(square,'topLeft',false);
 nearP(tl[0],P(0,1000));
 const br=orderBoundaryVertices(square,'bottomRight',false);
 nearP(br[0],P(1000,0));
 const cw=orderBoundaryVertices(square,'topLeft',true);
 nearP(cw[0],P(0,1000));
 nearP(cw[1],P(1000,1000));
 const shapes=[{centroid:P(0,0)},{centroid:P(1000,1000)},{centroid:P(0,1000)}];
 assert.deepEqual(orderShapes(shapes,'Z',10).map(s=>[s.centroid.x,s.centroid.y]),[[0,1000],[1000,1000],[0,0]]);
 assert.deepEqual(orderShapes(shapes,'S',10).map(s=>[s.centroid.x,s.centroid.y]),[[1000,1000],[0,1000],[0,0]]);
 assert.deepEqual(orderShapes(shapes,'N',10).map(s=>[s.centroid.x,s.centroid.y]),[[0,1000],[0,0],[1000,1000]]);
 assert.deepEqual(orderShapes(shapes,'NR',10).map(s=>[s.centroid.x,s.centroid.y]),[[0,0],[0,1000],[1000,1000]]);
});
test('SAR: 구적표 행은 원문 그림대로 "밑변 X 높이 / 2" 와 합계 행을 갖는다',()=>{
 const shapes=[
  {kind:'triangle',base:4369,height:8238,area:4369*8238/2,centroid:P(0,0)},
  {kind:'quad',width:3535,height:8548,area:3535*8548,centroid:P(0,0)},
  {kind:'cad',area:19851000,centroid:P(0,0)}];
 const {rows,total,totalPy}=siteAreaRows(shapes,{startNumber:1,decimals:3,comma:true,py:true});
 assert.equal(rows.length,4);
 assert.deepEqual(rows[0].cells,['1','4.369 X 8.238 / 2','17.996','']);
 assert.deepEqual(rows[1].cells,['2','3.535 X 8.548','30.217','']);
 assert.equal(rows[2].cells[1],'CAD 구적');
 assert.equal(rows[2].cells[2],'19.851');
 assert.equal(rows[3].cells[0],'합계');
 near(total,17.9961111+30.21718+19.851,1e-3);
 near(totalPy,total*PY_PER_M2,1e-9);
 assert.equal(rows[3].cells[3],formatNumber(totalPy,3,true));
});
test('SAR: 표 작도는 제목 1개 + 가로선 행수+1 + 세로선 5 + 칸 문자를 만든다',()=>{
 const table=siteAreaRows([{kind:'triangle',base:1000,height:800,area:400000,centroid:P(0,0)}],{decimals:3});
 const es=areaTableEntities(table,P(0,0),{title:'대지구적표',textHeight:900,lineLayer:'T',textLayer:'X',unit:'m²'});
 const lines=es.filter(e=>e.type==='line'),texts=es.filter(e=>e.type==='text');
 // 본문 행 = 머리글 1 + 자료 1 + 합계 1 = 3
 assert.equal(lines.filter(l=>l.points[0].y===l.points[1].y).length,4);
 assert.equal(lines.filter(l=>l.points[0].x===l.points[1].x).length,5);
 assert.equal(texts[0].text,'대지구적표');
 assert.ok(texts.some(t=>t.text==='구분'));
 assert.ok(texts.some(t=>t.text==='면적(m²)'));
 assert.ok(texts.some(t=>t.text==='1.000 X 0.800 / 2'));
 assert.ok(texts.some(t=>t.text==='합계'));
 for(const t of texts.slice(1))assert.equal(t.layer,'X');
 for(const l of lines)assert.equal(l.layer,'T');
});

/* ── SCA(/442): 면적 확대하기 ── */
test('SCA: 목표면적/현재면적의 제곱근이 배율이다',()=>{
 near(areaScaleFactor(1e6,4,'m2'),2);
 near(areaScaleFactor(1e6,4e6,'mm2'),2);
 near(areaScaleFactor(4e6,1,'m2'),0.5);
 assert.throws(()=>areaScaleFactor(0,4,'m2'),/현재 면적/);
 assert.throws(()=>areaScaleFactor(1e6,0,'m2'),/양수/);
 near(closedAreaOf({type:'polyline',points:[P(0,0),P(1000,0),P(1000,600),P(0,600)],closed:true}),600000);
 near(closedAreaOf({type:'circle',center:P(0,0),radius:1000}),Math.PI*1e6);
 // 100m² 로 그려진 경계선을 실제 400m² 로 맞추면 배율 2, 면적은 4배가 된다.
 const boundary={type:'polyline',closed:true,points:[P(0,0),P(10000,0),P(10000,10000),P(0,10000)]};
 const factor=areaScaleFactor(closedAreaOf(boundary),400,'m2');
 near(factor,2);
 const scaled=G.resize(boundary,P(0,0),factor);
 near(closedAreaOf(scaled)/1e6,400);
});
