// block-text-tools-4.js 시험. DOM 없이 export 된 순수 함수만 확인한다(규칙서 8절).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 blockAnchor,matchingBlockIds,
 explodeBlockRecursive,finishExplodedEntities,explodeInnerBlocks,
 bamAnchor,bamExistingInstances,bamRedefinePlan,
 placeSourceAsIs,planBchReplace,
 listBlockNamesForExport,idsForBlockNames,
 changeBlockBaseInPlace,moveBlockToNewBase,
 scaleBlockXY,refRatio,
 splitPrefixNumberSuffix,formatNumberBase,ticAddToTarget,ticLabelOf,
 textBoxRectPoints,textBoxRoundedRectPoints,textBoxPolygonPoints,textBoxCircleLocal,buildTextBoxBorder,
} from './block-text-tools-4.js';

import {readFileSync} from 'node:fs';
/* ── 2026-09-24 F5: BIN·BAM 점 지정 프롬프트는 문자열로 호출한다(객체를 넘기면 "[object Object]"가 보인다) ── */
test('pickPoint 는 항상 문자열 프롬프트로 부른다',()=>{
 const src=readFileSync(new URL('./block-text-tools-4.js',import.meta.url),'utf8');
 assert.ok(!/pickPoint\(\s*\{/.test(src),'pickPoint({...}) 호출이 남아 있습니다');
 assert.ok(/pickPoint\('BIN · 새 삽입점/.test(src)&&/pickPoint\('BAM · 원 중심/.test(src));
});

/* ── 공통 헬퍼 ── */
test('blockAnchor: position 있으면 그 값, 없으면 범위 중심',()=>{
 assert.deepEqual(blockAnchor({type:'block',position:{x:5,y:7},entities:[]}),{x:5,y:7});
 const b={type:'block',entities:[{type:'line',points:[{x:0,y:0},{x:10,y:4}]}]};
 assert.deepEqual(blockAnchor(b),{x:5,y:2});
 assert.throws(()=>blockAnchor({type:'line'}));
});

test('matchingBlockIds: 같은 이름의 일반 블록만, 표·외부참조 제외',()=>{
 const es=[
  {id:'a',type:'block',name:'W1',entities:[]},
  {id:'b',type:'block',name:'W1',entities:[]},
  {id:'c',type:'block',name:'W2',entities:[]},
  {id:'d',type:'block',name:'W1',table:true,entities:[]},
  {id:'e',type:'block',name:'W1',xref:{},entities:[]},
 ];
 assert.deepEqual(matchingBlockIds(es,'W1'),['a','b']);
});

/* ── ABX ── */
test('explodeBlockRecursive: 중첩 블럭을 재귀적으로 편다',()=>{
 const nested={type:'block',name:'INNER',layer:'L1',entities:[{type:'line',points:[{x:0,y:0},{x:1,y:0}]}]};
 const flat=explodeBlockRecursive([nested]);
 assert.equal(flat.length,1);
 assert.equal(flat[0].type,'line');
 assert.equal(flat[0].layer,'L1');
});

test('explodeBlockRecursive: 속성 있는 하위 블럭은 skipAttrBlocks 면 보존',()=>{
 const attrBlock={type:'block',name:'TAG',attributes:{MARK:'A1'},entities:[{type:'text',text:'A1'}]};
 const kept=explodeBlockRecursive([attrBlock],{skipAttrBlocks:true});
 assert.equal(kept.length,1);
 assert.equal(kept[0].type,'block');
 const opened=explodeBlockRecursive([attrBlock],{skipAttrBlocks:false});
 assert.equal(opened.length,1);
 assert.equal(opened[0].type,'text');
});

test('finishExplodedEntities: 0번 켜·ByLayer 후처리',()=>{
 const list=[{type:'line',layer:'A',color:'#ff0000',linetype:'DASHED'}];
 const out=finishExplodedEntities(list,{toLayer0:true,colorByLayer:true,linetypeByLayer:true});
 assert.equal(out[0].layer,'0');
 assert.equal(out[0].color,undefined);
 assert.equal(out[0].linetype,undefined);
});

test('explodeInnerBlocks: keepOuter=false 면 최상위 원시 객체 배열, true 면 블럭 유지',()=>{
 const inner={type:'block',name:'B',layer:'L2',entities:[{type:'line',points:[{x:0,y:0},{x:2,y:0}]}]};
 const outer={type:'block',name:'A',layer:'L1',entities:[inner]};
 const flat=explodeInnerBlocks(outer,{keepOuter:false});
 assert.ok(Array.isArray(flat));
 assert.equal(flat.length,1);
 assert.equal(flat[0].type,'line');
 const kept=explodeInnerBlocks(outer,{keepOuter:true});
 assert.equal(kept.type,'block');
 assert.equal(kept.entities.length,1);
 assert.equal(kept.entities[0].type,'line');
});

/* ── BAM ── */
test('bamAnchor: tag 위치 우선, 없으면 범위 좌하귀, circle 모드는 지정한 점',()=>{
 const es=[{type:'line',points:[{x:2,y:3},{x:8,y:9}]}];
 assert.deepEqual(bamAnchor(es,'tag',null,null),{x:2,y:3});
 assert.deepEqual(bamAnchor(es,'tag',{position:{x:1,y:1}},null),{x:1,y:1});
 assert.deepEqual(bamAnchor(es,'circle',null,{x:9,y:9}),{x:9,y:9});
 assert.throws(()=>bamAnchor(es,'circle',null,null));
});

test('bamExistingInstances: 이름이 같은 일반 블록만',()=>{
 const es=[{id:'x',type:'block',name:'N1'},{id:'y',type:'block',name:'N2'},{id:'z',type:'block',name:'N1',xref:{}}];
 const found=bamExistingInstances(es,'N1');
 assert.equal(found.length,1);
 assert.equal(found[0].id,'x');
});

test('bamRedefinePlan: 기존 인스턴스마다 새 내용으로 교체 계획을 만든다',()=>{
 const selected=[{type:'line',points:[{x:0,y:0},{x:4,y:0}]}];
 const target={id:'t1',type:'block',name:'N1',position:{x:100,y:100},entities:[{type:'line',points:[{x:100,y:100},{x:101,y:100}]}]};
 const plans=bamRedefinePlan(selected,{x:0,y:0},'N1',[target]);
 assert.equal(plans.length,1);
 assert.equal(plans[0].id,'t1');
 assert.equal(plans[0].changes.name,'N1');
 assert.ok(Array.isArray(plans[0].changes.entities));
});

/* ── BCH ── */
test('placeSourceAsIs: 대상 위치로 옮기되 새 블럭 모양을 그대로 쓴다',()=>{
 const source={type:'block',name:'NEW',position:{x:0,y:0},entities:[{type:'line',points:[{x:0,y:0},{x:10,y:0}]}]};
 const target={type:'block',name:'OLD',position:{x:50,y:50},entities:[{type:'circle',center:{x:50,y:50},radius:3}]};
 const placed=placeSourceAsIs(source,target);
 assert.equal(placed.name,'NEW');
 assert.equal(placed.entities[0].type,'line');
 assert.deepEqual(placed.entities[0].points[0],{x:50,y:50});
 assert.deepEqual(placed.entities[0].points[1],{x:60,y:50});
});

test('planBchReplace: keepLayer=false 면 새 블럭 켜를 쓴다',()=>{
 const source={type:'block',name:'NEW',layer:'LNEW',position:{x:0,y:0},entities:[{type:'line',points:[{x:0,y:0},{x:1,y:0}]}]};
 const target={type:'block',name:'OLD',layer:'LOLD',position:{x:10,y:10},entities:[{type:'line',points:[{x:10,y:10},{x:11,y:10}]}]};
 const kept=planBchReplace(source,target,{keepTransform:true,keepLayer:true});
 assert.equal(kept.layer,'LOLD');
 const changed=planBchReplace(source,target,{keepTransform:true,keepLayer:false});
 assert.equal(changed.layer,'LNEW');
});

/* ── BEX ── */
test('listBlockNamesForExport / idsForBlockNames',()=>{
 const es=[
  {id:'1',type:'block',name:'DOOR'},{id:'2',type:'block',name:'DOOR'},
  {id:'3',type:'block',name:'WIN'},{id:'4',type:'block',name:'DOOR',table:true},
 ];
 const list=listBlockNamesForExport(es);
 assert.deepEqual(list,[{name:'DOOR',count:2},{name:'WIN',count:1}]);
 assert.deepEqual(idsForBlockNames(es,['WIN']).sort(),['3']);
 assert.deepEqual(idsForBlockNames(es,['DOOR']).sort(),['1','2']);
});

/* ── BIN ── */
test('changeBlockBaseInPlace: position 만 바뀐다(표시 형상은 그대로)',()=>{
 const block={type:'block',position:{x:0,y:0},entities:[{type:'line',points:[{x:0,y:0},{x:5,y:0}]}]};
 const changes=changeBlockBaseInPlace(block,{x:9,y:9});
 assert.deepEqual(changes,{position:{x:9,y:9}});
});

test('moveBlockToNewBase: 기준점이 새 좌표에 오도록 전체가 이동한다',()=>{
 const block={type:'block',position:{x:0,y:0},entities:[{type:'line',points:[{x:0,y:0},{x:5,y:0}]}]};
 const changes=moveBlockToNewBase(block,{x:10,y:20});
 assert.deepEqual(changes.position,{x:10,y:20});
 assert.deepEqual(changes.entities[0].points[0],{x:10,y:20});
 assert.deepEqual(changes.entities[0].points[1],{x:15,y:20});
});

/* ── BSC ── */
test('scaleBlockXY: X·Y 축척을 독립적으로 적용한다',()=>{
 const block={type:'block',position:{x:0,y:0},entities:[{type:'line',points:[{x:2,y:0},{x:0,y:4}]}]};
 const scaled=scaleBlockXY(block,2,0.5);
 assert.deepEqual(scaled.entities[0].points[0],{x:4,y:0});
 assert.deepEqual(scaled.entities[0].points[1],{x:0,y:2});
});

test('scaleBlockXY: 0 이하 축척은 거부',()=>{
 const block={type:'block',position:{x:0,y:0},entities:[]};
 assert.throws(()=>scaleBlockXY(block,0,1));
 assert.throws(()=>scaleBlockXY(block,1,-1));
});

test('refRatio: 참조/기준',()=>{
 assert.equal(refRatio(100,150),1.5);
 assert.throws(()=>refRatio(0,10));
});

/* ── TIC ── */
test('splitPrefixNumberSuffix',()=>{
 assert.deepEqual(splitPrefixNumberSuffix('A-005b'),{prefix:'A-',number:'005',suffix:'b'});
 assert.deepEqual(splitPrefixNumberSuffix('12층'),{prefix:'',number:'12',suffix:'층'});
 assert.deepEqual(splitPrefixNumberSuffix('문자만'),{prefix:'문자만',number:'',suffix:''});
});

test('formatNumberBase: 진법·선행0',()=>{
 assert.equal(formatNumberBase(8,10,{digits:3}),'008');
 assert.equal(formatNumberBase(8,10,{digits:3,suppressLeading:true}),'8');
 assert.equal(formatNumberBase(255,16,{digits:2}),'FF');
 assert.equal(formatNumberBase(8,8,{digits:2}),'10');
});

test('ticAddToTarget: 같은 포맷이면 더하고, 다르면 던진다',()=>{
 const source={prefix:'',number:'1',suffix:'층 평면도'};
 assert.equal(ticAddToTarget(source,'3층 평면도',{base:10}),'4층 평면도');
 assert.throws(()=>ticAddToTarget(source,'지하 1층 단면도',{base:10}));
});

test('ticLabelOf: 문자·속성블록·속성 없는 첫 문자 순',()=>{
 const t={id:'t1',type:'text',text:'hello'};
 assert.equal(ticLabelOf(t).text,'hello');
 const block={id:'b1',type:'block',entities:[{type:'line'},{type:'text',text:'TAG1',attributeTag:'MARK'}]};
 assert.equal(ticLabelOf(block).text,'TAG1');
 const cmd=ticLabelOf(block).apply('TAG2');
 assert.equal(cmd.changes.entities[1].text,'TAG2');
 assert.equal(ticLabelOf({type:'circle'}),null);
});

/* ── TX ── */
test('textBoxRectPoints: 4점, 여백만큼 확장',()=>{
 const pts=textBoxRectPoints({minX:0,minY:0,maxX:10,maxY:5},2,1);
 assert.equal(pts.length,4);
 const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
 assert.equal(Math.min(...xs),-2);
 assert.equal(Math.max(...xs),12);
 assert.equal(Math.min(...ys),-1);
 assert.equal(Math.max(...ys),6);
});

test('textBoxRoundedRectPoints: 반경이 0이면 사각과 같다',()=>{
 const box={minX:0,minY:0,maxX:10,maxY:5};
 const rounded=textBoxRoundedRectPoints(box,0,0,0);
 assert.equal(rounded.length,4);
});

test('textBoxRoundedRectPoints: 모서리 근사점 개수 = 4*(segs+1)',()=>{
 const box={minX:0,minY:0,maxX:10,maxY:5};
 const pts=textBoxRoundedRectPoints(box,1,1,2,4);
 assert.equal(pts.length,20);
});

test('textBoxPolygonPoints: 면수만큼 점, 3 미만은 거부',()=>{
 const box={minX:0,minY:0,maxX:10,maxY:10};
 assert.equal(textBoxPolygonPoints(box,1,1,6).length,6);
 assert.equal(textBoxPolygonPoints(box,1,1,8).length,8);
 assert.throws(()=>textBoxPolygonPoints(box,1,1,2));
});

test('textBoxCircleLocal: 중심·반지름 계산',()=>{
 const box={minX:0,minY:0,maxX:10,maxY:10};
 const c=textBoxCircleLocal(box,0,0);
 assert.deepEqual({x:c.cx,y:c.cy},{x:5,y:5});
 assert.ok(c.radius>0);
});

test('buildTextBoxBorder: 회전 0 이면 로컬 사각형이 문자 위치만큼 평행이동한다',()=>{
 const text={type:'text',text:'AB',height:10,align:'left',position:{x:100,y:100},rotation:0};
 const border=buildTextBoxBorder(text,'rect',{padX:5,padY:3,layer:'L'});
 assert.equal(border.type,'polyline');
 assert.equal(border.closed,true);
 assert.equal(border.layer,'L');
 const xs=border.points.map(p=>p.x),ys=border.points.map(p=>p.y);
 assert.equal(Math.min(...xs),95);
 assert.equal(Math.max(...xs),118);
 assert.equal(Math.min(...ys),97);
 assert.equal(Math.max(...ys),113);
});

test('buildTextBoxBorder: circle 모양은 circle 엔티티를 돌려준다',()=>{
 const text={type:'text',text:'A',height:10,align:'left',position:{x:0,y:0},rotation:0};
 const border=buildTextBoxBorder(text,'circle',{padX:2,padY:2});
 assert.equal(border.type,'circle');
 assert.ok(border.radius>0);
});

test('buildTextBoxBorder: 알 수 없는 모양은 던진다',()=>{
 const text={type:'text',text:'A',height:10,position:{x:0,y:0}};
 assert.throws(()=>buildTextBoxBorder(text,'star',{}));
});

// 2026-10-27 설명서 시험: X·Y 축척을 다르게 주면 원이 타원이 되지 않고 고르게(√(sx·sy)) 커졌다.
test('BSC: 가로·세로 축척이 다르면 블록 안 원은 타원이 된다(가로 2·세로 1 → 장축 2r·단축 r)',()=>{
 const block={id:'B',type:'block',position:{x:0,y:0},entities:[{type:'circle',center:{x:0,y:0},radius:100},{type:'line',points:[{x:-100,y:0},{x:100,y:0}]}]};
 const out=scaleBlockXY(block,2,1),ell=out.entities.find(e=>e.type==='ellipse');
 assert.ok(ell,'타원이 있다');
 assert.equal(Math.hypot(ell.majorAxis.x,ell.majorAxis.y),200);
 assert.equal(ell.ratio,0.5);
 assert.deepEqual(out.entities.find(e=>e.type==='line').points.map(p=>p.x),[-200,200]);
 assert.equal(scaleBlockXY(block,2,2).entities.find(e=>e.type==='circle').radius,200,'같은 축척이면 원 그대로');
});
