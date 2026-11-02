// unfold-card.js(DEV 전개도 · ISD 아이소메트릭 · PZ 부분 확대) 순수 함수 시험.
// 화면(대화상자·점 찍기) 없이 기하·정규화만 좌표 숫자로 확인한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';
import {normalizeValues,defaultsOf} from './card-kit.js';
import {
 CURVE_TYPES,curvePoints,cumulative,curveLength,lengthAlong,unfoldFlip,unfoldMarks,
 DEV_FIELDS,DEV_SHARED_FIELDS,buildUnfold,devPreviewSvg,
 ISO_AXES,ISO_PLANES,ISO_RATIO,ISD_FIELDS,ISD_SHARED_FIELDS,snapIso,isoChain,isoLines,isoEllipse,isoCenterCross,lineCenterline,isoDimension,isoText,isoChange,isdPreviewSvg,
 PZ_FIELDS,regionPolygon,polygonCenter,entitiesInRegion,scaleCopies,zoomBorders,anonymousBlockName,buildPartialZoom,pzPreviewSvg,
 UNFOLD_LAYERS,
} from './unfold-card.js';

const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<=tol,`${a} ≈ ${b} 아님`);
const nearP=(p,x,y,tol=1e-6)=>{near(p.x,x,tol);near(p.y,y,tol);};
const devValues=o=>normalizeValues(DEV_FIELDS,{...defaultsOf(DEV_FIELDS),...o});
const devShared=o=>normalizeValues(DEV_SHARED_FIELDS,{...defaultsOf(DEV_SHARED_FIELDS),...o});
const isdValues=o=>normalizeValues(ISD_FIELDS,{...defaultsOf(ISD_FIELDS),...o});
const isdShared=o=>normalizeValues(ISD_SHARED_FIELDS,{...defaultsOf(ISD_SHARED_FIELDS),...o});
const pzValues=o=>normalizeValues(PZ_FIELDS,{...defaultsOf(PZ_FIELDS),...o});

/* ── DEV 전개도 ─────────────────────────────────────────────── */

test('DEV 원문 기본값: 기준 높이 3000, 수평선·수직선 켜짐, 재 순환 꺼짐', ()=>{
 const v=devValues();
 assert.equal(v.height,3000);
 assert.equal(v.drawH,true);
 assert.equal(v.drawV,true);
 assert.equal(v.recycle,false);
 const s=devShared();
 assert.equal(s.borderLayer,UNFOLD_LAYERS.elev);
 assert.equal(s.markLayer,UNFOLD_LAYERS.symb);
});

test('curvePoints: 선·폴리선·사각형·호·원만 받고 그 밖은 막는다', ()=>{
 assert.deepEqual(CURVE_TYPES,['line','polyline','rectangle','arc','circle']);
 assert.equal(curvePoints({type:'line',points:[{x:0,y:0},{x:3,y:4}]}).length,2);
 assert.throws(()=>curvePoints({type:'text',position:{x:0,y:0},text:'가',height:10}),/선·폴리선/);
 // 닫힌 사각형은 첫 점이 뒤에 한 번 더 붙어 둘레 전체가 된다.
 const rect=curvePoints({type:'rectangle',points:G.rectangle({x:0,y:0},{x:100,y:50})});
 assert.equal(rect.length,5);
 near(curveLength(rect),300);
});

test('curveLength / cumulative: 3-4-5 꺾은선의 누적 거리', ()=>{
 const pts=[{x:0,y:0},{x:3,y:4},{x:3,y:14}];
 assert.deepEqual(cumulative(pts),[0,5,15]);
 near(curveLength(pts),15);
});

test('curvePoints(호): 반지름 1000 · 90도 호의 길이는 1570 근처', ()=>{
 const pts=curvePoints({type:'arc',center:{x:0,y:0},radius:1000,startAngle:0,endAngle:90});
 near(curveLength(pts),1000*Math.PI/2,1);   // 1570.796…
 nearP(pts[0],1000,0,1e-9);
 nearP(pts.at(-1),0,1000,1e-9);
});

test('lengthAlong: 곡선에서 떨어진 점도 가장 가까운 자리로 잰다', ()=>{
 const pts=[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000}];
 near(lengthAlong(pts,{x:400,y:250}),400);        // 첫 구간 위 400
 near(lengthAlong(pts,{x:1300,y:600}),1600);      // 둘째 구간 위 600 → 1000+600
 near(lengthAlong(pts,{x:-500,y:0}),0);           // 시작점 밖은 0 으로 잘린다
});

test('unfoldFlip: 선을 고를 때 찍은 쪽이 전개도의 왼쪽(원문 /398 방향 규칙)', ()=>{
 const pts=[{x:0,y:0},{x:1000,y:0}];
 assert.equal(unfoldFlip(pts,{x:100,y:30}),1);    // 시작점 쪽을 찍음 → 그대로
 assert.equal(unfoldFlip(pts,{x:900,y:-30}),-1);  // 끝점 쪽을 찍음 → 좌우 뒤집음
 assert.throws(()=>unfoldFlip([{x:0,y:0},{x:0,y:0}],{x:0,y:0}),/길이가 0/);
});

test('unfoldMarks: 나눔점을 전개 x 좌표로 바꾸고, 양 끝·중복은 버린다', ()=>{
 const pts=[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000}];   // 전체 길이 2000
 const marks=[{x:300,y:0},{x:1000,y:400},{x:0,y:0},{x:1000,y:1000},{x:300,y:5}];
 assert.deepEqual(unfoldMarks(pts,marks,1),[300,1400]);  // 끝(0·2000)과 중복(300) 제거
 assert.deepEqual(unfoldMarks(pts,marks,-1),[600,1700]); // 뒤집으면 2000-300, 2000-1400... 정렬됨
});

test('buildUnfold: 길이 2000 · 높이 3000 상자와 구분선의 좌표를 숫자로 확인', ()=>{
 const v=devValues(),s=devShared();
 const es=buildUnfold(v,s,{length:2000,marks:[500],origin:{x:100,y:200}});
 assert.equal(es.length,5);   // 수평 2 + 수직 2 + 구분선 1
 const [bottom,top,left,right,mark]=es;
 nearP(bottom.points[0],100,200);nearP(bottom.points[1],2100,200);
 nearP(top.points[0],100,3200);nearP(top.points[1],2100,3200);
 nearP(left.points[0],100,200);nearP(left.points[1],100,3200);
 nearP(right.points[0],2100,200);nearP(right.points[1],2100,3200);
 nearP(mark.points[0],600,200);nearP(mark.points[1],600,3200);
 assert.equal(bottom.cardLayer,UNFOLD_LAYERS.elev);
 assert.equal(mark.cardLayer,UNFOLD_LAYERS.symb);
});

test('buildUnfold: 수평선·수직선 체크를 끄면 그만큼 빠지고, 모두 끄고 구분선도 없으면 막는다', ()=>{
 const s=devShared();
 assert.equal(buildUnfold(devValues({drawV:false}),s,{length:100,marks:[]}).length,2);
 assert.equal(buildUnfold(devValues({drawH:false}),s,{length:100,marks:[50]}).length,3);
 assert.throws(()=>buildUnfold(devValues({drawH:false,drawV:false}),s,{length:100,marks:[]}),/그릴 것이 없습니다/);
 // 선택창은 높이를 1 이상으로 맞춰 주지만(normalizeValues min:1), 값이 직접 들어와도 막는다
 assert.throws(()=>buildUnfold({...devValues(),height:0},s,{length:100,marks:[]}),/기준 높이/);
 assert.throws(()=>buildUnfold(devValues(),s,{length:0,marks:[]}),/전개할 길이/);
});

test('DEV 미리보기 SVG 가 만들어진다', ()=>{
 const svg=devPreviewSvg(devValues(),devShared(),{width:200,height:100});
 assert.match(svg,/^<svg /);
 assert.match(svg,/<line /);
});

/* ── ISD 아이소메트릭 ───────────────────────────────────────── */

test('ISD 등각 상수: 3축 30·150·90도와 반대 방향, 타원비 tan30', ()=>{
 assert.deepEqual([...ISO_AXES],[30,90,150,210,270,330]);
 near(ISO_RATIO,0.5773502691896257,1e-12);
 assert.equal(ISO_PLANES.top.major,0);
 assert.equal(ISO_PLANES.right.major,60);
 assert.equal(ISO_PLANES.left.major,120);
});

test('snapIso: 어긋나게 찍어도 가장 가까운 등각축으로 붙는다', ()=>{
 const o={x:0,y:0};
 const a=snapIso(o,{x:1000,y:500});                 // 26.6도 → 30도 축
 near(G.normalizeAngle(G.angle(a)),30,1e-9);
 const b=snapIso(o,{x:-900,y:400});                 // 156도 → 150도 축
 near(G.normalizeAngle(G.angle(b)),150,1e-9);
 const c=snapIso(o,{x:30,y:-1000});                 // 아래 → 270도 축
 nearP(c,0,-1000,1e-6);
});

test('snapIso: 길이를 주면 방향만 쓰고 길이는 고정한다', ()=>{
 const p=snapIso({x:100,y:100},{x:2000,y:1200},1000);
 near(G.dist({x:100,y:100},p),1000,1e-9);
 nearP(p,100+1000*Math.cos(Math.PI/6),100+1000*Math.sin(Math.PI/6),1e-6);  // (966.025…, 600)
});

test('isoChain / isoLines: 첫 점은 그대로, 이후는 등각축 위에만 놓인다', ()=>{
 const pts=isoChain([{x:0,y:0},{x:1000,y:520},{x:1000,y:2000}],0);
 nearP(pts[0],0,0);
 for(let i=1;i<pts.length;i++){
  const a=G.normalizeAngle(G.angle(G.sub(pts[i],pts[i-1])));
  assert.ok(ISO_AXES.some(ax=>Math.abs(((a-ax+540)%360)-180)<1e-6),`${a} 도는 등각축이 아님`);
 }
 assert.equal(isoLines([{x:0,y:0},{x:1000,y:520}],0).length,1);
 assert.equal(isoLines([{x:0,y:0}],0).length,0);
});

test('isoEllipse: 반지름이 장축 반길이, 단축은 tan30 배, 장축 각도는 등각면을 따른다', ()=>{
 const e=isoEllipse({x:10,y:20},500,'right','A-TEST');
 assert.equal(e.type,'ellipse');
 nearP(e.center,10,20);
 near(G.len(e.majorAxis),500,1e-9);
 near(G.normalizeAngle(G.angle(e.majorAxis)),60,1e-9);
 near(e.ratio,ISO_RATIO,1e-12);
 assert.equal(e.cardLayer,'A-TEST');
 // 그려지는 점들이 장축 500 · 단축 288.675 안에 들어간다
 const ps=G.ellipsePoints(e,64),b=G.bounds([{type:'polyline',points:ps}]);
 near(b.maxX-b.minX,2*Math.hypot(500*Math.cos(Math.PI/3),500*ISO_RATIO*Math.cos(Math.PI/3+Math.PI/2)),1);
 assert.throws(()=>isoEllipse({x:0,y:0},0,'top'),/반지름/);
});

test('isoCenterCross: 장축·단축 두 방향의 중심선, 켜와 선종류 확인', ()=>{
 const cs=isoCenterCross({x:0,y:0},100,'top','A-CNTR',1.2);
 assert.equal(cs.length,2);
 for(const c of cs){assert.equal(c.linetype,'CENTER');assert.equal(c.cardLayer,'A-CNTR');}
 nearP(cs[0].points[0],-120,0,1e-9);   // 상면 장축은 수평, 100*1.2
 nearP(cs[0].points[1],120,0,1e-9);
 near(G.dist(cs[1].points[0],cs[1].points[1]),2*100*ISO_RATIO*1.2,1e-9);
});

test('lineCenterline: 양 끝으로 15% 더 나간 CENTER 선', ()=>{
 const c=lineCenterline({x:0,y:0},{x:1000,y:0},'A-CNTR');
 nearP(c.points[0],-150,0,1e-9);
 nearP(c.points[1],1150,0,1e-9);
 assert.equal(c.linetype,'CENTER');
 assert.throws(()=>lineCenterline({x:0,y:0},{x:0,y:0}),/길이가 0/);
});

test('isoDimension: 정렬치수로 만들어지고 실제 잰 값이 등각 길이와 같다', ()=>{
 const a={x:0,y:0},b=snapIso(a,{x:1000,y:600},1000);
 const d=isoDimension(a,b,{x:0,y:400},300,'A-DIM');
 assert.equal(d.type,'dimension');
 assert.equal(d.mode,'aligned');
 assert.equal(d.textHeight,300);
 const label=G.dimensionParts(d).find(p=>p.dimensionLabel);
 near(Number(label.text),1000,0.01);
 assert.throws(()=>isoDimension(a,a,{x:1,y:1},300),/두 점이 같습니다/);
});

test('isoText: 뒤집혀 보이지 않게 회전각을 고친다', ()=>{
 assert.equal(isoText({x:0,y:0},'가',300,30,'A-TEXT').rotation,30);
 assert.equal(isoText({x:0,y:0},'가',300,210).rotation,30);   // 210도는 읽기 좋게 30도로
 assert.throws(()=>isoText({x:0,y:0},'가',0,30),/문자 높이/);
});

test('isoChange: 선은 첫 점을 잡고 돌리고 길이를 지키며, 타원은 장축 각도만 바뀐다', ()=>{
 const line={id:'a',type:'line',layer:'L',points:[{x:100,y:100},{x:100,y:1100}]};
 const turned=isoChange(line,{axis:30});
 nearP(turned.points[0],100,100);
 near(G.dist(turned.points[0],turned.points[1]),1000,1e-9);
 near(G.normalizeAngle(G.angle(G.sub(turned.points[1],turned.points[0]))),30,1e-9);
 const ell=isoChange({type:'ellipse',center:{x:0,y:0},majorAxis:{x:500,y:0},ratio:ISO_RATIO},{plane:'left'});
 near(G.normalizeAngle(G.angle(ell.majorAxis)),120,1e-9);
 near(G.len(ell.majorAxis),500,1e-9);
 // 150도 축 문자는 뒤집혀 보이지 않게 330도(=-30도)로 눕는다
 assert.equal(isoChange({type:'text',position:{x:0,y:0},text:'가',height:10,rotation:0},{axis:150}).rotation,330);
 assert.equal(isoChange({type:'circle',center:{x:0,y:0},radius:200},{plane:'right'}).type,'ellipse');
 assert.throws(()=>isoChange({type:'hatch'},{axis:30}),/선·원\(타원\)·문자/);
 assert.throws(()=>isoChange(null),/바꿀 객체/);
});

test('ISD 기본값과 미리보기', ()=>{
 const v=isdValues();
 assert.equal(v.plane,'top');
 assert.equal(v.axis,'30');
 assert.equal(v.length,0);
 assert.equal(v.textHeight,300);
 const s=isdShared();
 assert.equal(s.textLayer,UNFOLD_LAYERS.text);
 assert.equal(s.dimLayer,UNFOLD_LAYERS.dims);
 assert.equal(s.centerLayer,UNFOLD_LAYERS.cntr);
 assert.match(isdPreviewSvg(v,s,{width:200,height:100}),/^<svg /);
});

/* ── PZ 부분 확대 ───────────────────────────────────────────── */

test('PZ 원문 기본값: 사각형 방식 · 확대 배율 2 · 일반 블럭 꺼짐', ()=>{
 const v=pzValues();
 assert.equal(v.shape,'rect');
 assert.equal(v.factor,2);
 assert.equal(v.plainBlock,false);
 assert.equal(v.useCurrentLayer,false);
 assert.equal(v.borderLayer,UNFOLD_LAYERS.symb);
 assert.equal(v.borderColor,'ByLayer');
 assert.equal(v.borderLinetype,'CONTINUOUS');
 assert.deepEqual(PZ_FIELDS[0].options.map(([k])=>k),['object','rect','circle','poly']);
});

test('regionPolygon: 사각형·원형·다각형과 잘못된 입력', ()=>{
 const r=regionPolygon('rect',[{x:0,y:0},{x:100,y:50}]);
 assert.equal(r.length,4);
 nearP(r[0],0,0);nearP(r[1],100,0);nearP(r[2],100,50);nearP(r[3],0,50);
 const c=regionPolygon('circle',[{x:10,y:10},{x:110,y:10}]);
 assert.equal(c.length,72);
 near(G.dist({x:10,y:10},c[0]),100,1e-9);
 assert.equal(regionPolygon('poly',[{x:0,y:0},{x:10,y:0},{x:0,y:10}]).length,3);
 assert.throws(()=>regionPolygon('rect',[{x:0,y:0},{x:0,y:50}]),/납작/);
 assert.throws(()=>regionPolygon('circle',[{x:0,y:0},{x:0,y:0}]),/반지름이 0/);
 assert.throws(()=>regionPolygon('poly',[{x:0,y:0},{x:1,y:1}]),/셋 이상/);
});

test('polygonCenter: 영역 가운데', ()=>{
 nearP(polygonCenter(regionPolygon('rect',[{x:-100,y:-50},{x:300,y:150}])),100,50);
});

test('entitiesInRegion: 걸치기 선택 — 안에 있거나 테두리와 만나는 것만 모은다', ()=>{
 const region=regionPolygon('rect',[{x:0,y:0},{x:100,y:100}]);
 const inside={id:'in',type:'line',points:[{x:20,y:20},{x:80,y:80}]};
 const crossing={id:'cross',type:'line',points:[{x:-50,y:50},{x:50,y:50}]};
 const outside={id:'out',type:'line',points:[{x:500,y:500},{x:600,y:600}]};
 const circle={id:'c',type:'circle',center:{x:100,y:100},radius:30};
 const hidden={id:'h',type:'line',points:[{x:20,y:20},{x:30,y:30}],hidden:true};
 const got=entitiesInRegion([inside,crossing,outside,circle,hidden],region).map(e=>e.id);
 assert.deepEqual(got.sort(),['c','cross','in']);
});

test('scaleCopies: 영역 가운데를 기준으로 키우고 놓을 자리로 옮긴다(문자 높이·반지름도 커진다)', ()=>{
 const base={x:0,y:0},target={x:1000,y:0};
 const src=[{id:'x',type:'line',layer:'L1',points:[{x:-100,y:-100},{x:100,y:100}]},
            {id:'y',type:'circle',layer:'L2',center:{x:0,y:50},radius:25},
            {id:'z',type:'text',layer:'L3',position:{x:0,y:0},text:'가',height:100,rotation:0}];
 const out=scaleCopies(src,base,3,target);
 assert.equal(out.length,3);
 assert.ok(out.every(e=>e.id===undefined),'사본에는 원본 id 가 남으면 안 된다');
 nearP(out[0].points[0],1000-300,-300);
 nearP(out[0].points[1],1000+300,300);
 nearP(out[1].center,1000,150);
 near(out[1].radius,75);
 near(out[2].height,300);
 assert.equal(out[0].layer,'L1');    // 원문은 켜를 바꾸지 않는다
 assert.throws(()=>scaleCopies(src,base,0,target),/확대 배율/);
});

test('zoomBorders: 원본 테두리 · 확대 테두리 · 둘을 잇는 지시선(원문 /290 결과 그림)', ()=>{
 const region=regionPolygon('rect',[{x:-50,y:-50},{x:50,y:50}]);
 const out=zoomBorders(region,{x:0,y:0},2,{x:1000,y:0},{cardLayer:'A-SYM',linetype:'CONTINUOUS'});
 assert.equal(out.length,3);
 const [src,dst,leader]=out;
 assert.equal(src.type,'polyline');assert.equal(src.closed,true);
 nearP(src.points[2],50,50);
 assert.equal(dst.type,'polyline');
 nearP(dst.points[0],1000-100,-100);   // (-50,-50) → 2배 → (-100,-100) + (1000,0)
 nearP(dst.points[2],1000+100,100);
 assert.equal(leader.type,'line');
 near(leader.points[0].x,50);          // 원본 테두리에서 확대도 쪽으로 가장 먼 점
 near(leader.points[1].x,900);         // 확대 테두리에서 원본 쪽으로 가장 먼 점
 assert.equal(leader.cardLayer,'A-SYM');
});

test('anonymousBlockName: 이미 있는 *U 번호 다음을 쓴다', ()=>{
 assert.equal(anonymousBlockName([]),'*U1');
 assert.equal(anonymousBlockName([{type:'block',name:'*U1'},{type:'block',name:'*U7'},{type:'block',name:'문짝'},{type:'line'}]),'*U8');
});

test('buildPartialZoom: 기본은 무명블럭 한 덩어리 + 테두리 3개', ()=>{
 const polygon=regionPolygon('rect',[{x:0,y:0},{x:100,y:100}]);
 const source=[{id:'a',type:'line',layer:'L1',points:[{x:10,y:10},{x:90,y:90}]}];
 const out=buildPartialZoom(pzValues(),{polygon,source,target:{x:500,y:0},entities:[{type:'block',name:'*U3'}],borderStyle:{cardLayer:'A-SYM'}});
 assert.equal(out.length,4);
 assert.equal(out[0].type,'block');
 assert.equal(out[0].name,'*U4');
 assert.equal(out[0].layer,'L1');
 assert.equal(out[0].entities.length,1);
 // 영역 가운데 (50,50) 이 (500,0) 으로 가고, (10,10) 은 2배로 (500-80, 0-80)
 nearP(out[0].entities[0].points[0],420,-80);
 nearP(out[0].entities[0].points[1],580,80);
});

test('buildPartialZoom: [일반 블럭으로 생성]을 켜면 낱개 객체로 넣는다', ()=>{
 const polygon=regionPolygon('rect',[{x:0,y:0},{x:100,y:100}]);
 const source=[{id:'a',type:'line',layer:'L1',points:[{x:10,y:10},{x:90,y:90}]},
               {id:'b',type:'line',layer:'L1',points:[{x:10,y:90},{x:90,y:10}]}];
 const out=buildPartialZoom(pzValues({plainBlock:true,factor:1.5}),{polygon,source,target:{x:0,y:0},borderStyle:{}});
 assert.equal(out.length,5);           // 낱개 2 + 테두리 3
 assert.ok(out.slice(0,2).every(e=>e.type==='line'));
 assert.throws(()=>buildPartialZoom({...pzValues(),factor:0},{polygon,source,target:{x:0,y:0}}),/확대 배율/);
 assert.throws(()=>buildPartialZoom(pzValues(),{polygon,source:[],target:{x:0,y:0}}),/확대할 객체가 없습니다/);
});

test('PZ 미리보기 SVG 가 만들어진다', ()=>{
 assert.match(pzPreviewSvg(pzValues(),{},{width:200,height:100}),/^<svg /);
 assert.match(pzPreviewSvg(pzValues({shape:'circle',factor:3}),{}),/원형 영역 · 3 배/);
});
