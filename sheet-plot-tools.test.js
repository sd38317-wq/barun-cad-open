// sheet-plot-tools.js 의 순수 함수 시험. DOM 없이 node --test 로 돈다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
 scaleLabelText,
 boxFromCorners,entitiesFullyInside,copyBetweenBoxes,
 boundaryContainsCenter,dimensionIdsInsideBox,
 isAxisAlignedQuad,sameLayerQuadBoxes,
 plotBoxDecorationIds,
 rubbleZigzag,RUB_COLOR,
 effectiveColorOf,colorMatchIds,
 sameConditionIds,
 measurableKeysFor,measureValue,selectByRange,SER_MEASURE_LABEL,
 layerSnapshot,applicableSnapshotChanges,
} from './sheet-plot-tools.js';

/* ── DAS ── */
test('scaleLabelText builds "1:분모" text and rejects non-positive values',()=>{
 assert.equal(scaleLabelText(100),'1:100');
 assert.equal(scaleLabelText(50,'축척 '),'축척 50');
 assert.throws(()=>scaleLabelText(0));
 assert.throws(()=>scaleLabelText(-5));
});

/* ── DBC ── */
test('boxFromCorners normalizes two corners regardless of order',()=>{
 assert.deepEqual(boxFromCorners({x:10,y:10},{x:0,y:0}),{minX:0,minY:0,maxX:10,maxY:10});
 assert.deepEqual(boxFromCorners({x:0,y:10},{x:10,y:0}),{minX:0,minY:0,maxX:10,maxY:10});
});
test('entitiesFullyInside keeps only entities whose bounds sit entirely inside the box',()=>{
 const inBox={id:'a',type:'line',points:[{x:1,y:1},{x:9,y:9}]};
 const straddling={id:'b',type:'line',points:[{x:5,y:5},{x:15,y:5}]};
 const outside={id:'c',type:'line',points:[{x:20,y:20},{x:30,y:30}]};
 const box={minX:0,minY:0,maxX:10,maxY:10};
 assert.deepEqual(entitiesFullyInside([inBox,straddling,outside],box).map(e=>e.id),['a']);
});
test('copyBetweenBoxes scales uniformly by width ratio and translates to the target lower-left corner',()=>{
 const line={id:'a',type:'line',points:[{x:0,y:0},{x:10,y:5}]};
 const sourceBox={minX:0,minY:0,maxX:10,maxY:10},targetBox={minX:100,minY:200,maxX:120,maxY:220};
 const [copy]=copyBetweenBoxes([line],sourceBox,targetBox);
 // scale = 20/10 = 2 ; origin (0,0) -> target (100,200)
 assert.deepEqual(copy.points,[{x:100,y:200},{x:120,y:210}]);
});
test('copyBetweenBoxes also scales textHeight (annotation follows the geometry scale)',()=>{
 const text={id:'t',type:'text',position:{x:5,y:5},text:'X',height:150,rotation:0};
 const sourceBox={minX:0,minY:0,maxX:10,maxY:10},targetBox={minX:0,minY:0,maxX:5,maxY:5};
 const [copy]=copyBetweenBoxes([text],sourceBox,targetBox);
 assert.equal(copy.height,75); // scale 0.5
});
test('copyBetweenBoxes rejects degenerate source/target boxes',()=>{
 assert.throws(()=>copyBetweenBoxes([],{minX:0,minY:0,maxX:0,maxY:10},{minX:0,minY:0,maxX:5,maxY:5}));
 assert.throws(()=>copyBetweenBoxes([],{minX:0,minY:0,maxX:10,maxY:10},{minX:0,minY:0,maxX:0,maxY:5}));
});

/* ── DSB ── */
test('boundaryContainsCenter checks the bounds midpoint against the box',()=>{
 const box={minX:0,minY:0,maxX:10,maxY:10};
 assert.equal(boundaryContainsCenter({minX:2,minY:2,maxX:4,maxY:4},box),true);
 assert.equal(boundaryContainsCenter({minX:8,minY:8,maxX:20,maxY:20},box),false);
 assert.equal(boundaryContainsCenter(null,box),false);
});
test('dimensionIdsInsideBox only matches dimension-type entities centered inside the box',()=>{
 // Keep textHeight/overshoot tiny so the dimension's full rendered geometry
 // (extension lines included) stays well inside the small test box.
 const dimIn={id:'d1',type:'dimension',mode:'horizontal',textHeight:1,extensionOvershoot:0,extensionOffset:0,points:[{x:1,y:0},{x:9,y:0},{x:5,y:2}]};
 const dimOut={id:'d2',type:'dimension',mode:'horizontal',textHeight:1,extensionOvershoot:0,extensionOffset:0,points:[{x:100,y:0},{x:110,y:0},{x:105,y:2}]};
 const line={id:'l1',type:'line',points:[{x:1,y:1},{x:2,y:2}]};
 const box={minX:0,minY:0,maxX:10,maxY:10};
 assert.deepEqual(dimensionIdsInsideBox([dimIn,dimOut,line],box),['d1']);
});

/* ── PBS/PBM ── */
test('isAxisAlignedQuad accepts axis-aligned closed rectangles and rejects others',()=>{
 const rect={id:'r',type:'rectangle',points:[{x:0,y:0},{x:10,y:0},{x:10,y:5},{x:0,y:5}]};
 assert.equal(isAxisAlignedQuad(rect),true);
 const closedWithRepeat={id:'p',type:'polyline',closed:true,points:[{x:0,y:0},{x:10,y:0},{x:10,y:5},{x:0,y:5},{x:0,y:0}]};
 assert.equal(isAxisAlignedQuad(closedWithRepeat),true);
 const openPoly={id:'op',type:'polyline',closed:false,points:[{x:0,y:0},{x:10,y:0},{x:10,y:5},{x:0,y:5}]};
 assert.equal(isAxisAlignedQuad(openPoly),false);
 const triangle={id:'t',type:'polyline',closed:true,points:[{x:0,y:0},{x:10,y:0},{x:5,y:5}]};
 assert.equal(isAxisAlignedQuad(triangle),false);
 const rotated={id:'rt',type:'polyline',closed:true,points:[{x:0,y:0},{x:5,y:5},{x:0,y:10},{x:-5,y:5}]};
 assert.equal(isAxisAlignedQuad(rotated),false);
});
test('sameLayerQuadBoxes returns bounds of every axis-aligned quad sharing the source layer',()=>{
 const a={id:'a',type:'rectangle',layer:'L1',points:[{x:0,y:0},{x:10,y:0},{x:10,y:5},{x:0,y:5}]};
 const b={id:'b',type:'rectangle',layer:'L1',points:[{x:20,y:0},{x:30,y:0},{x:30,y:5},{x:20,y:5}]};
 const other={id:'c',type:'rectangle',layer:'L2',points:[{x:0,y:0},{x:10,y:0},{x:10,y:5},{x:0,y:5}]};
 const boxes=sameLayerQuadBoxes([a,b,other],'a');
 assert.equal(boxes.length,2);
 assert.deepEqual(boxes[0],{minX:0,minY:0,maxX:10,maxY:5});
 assert.deepEqual(boxes[1],{minX:20,minY:0,maxX:30,maxY:5});
});
test('sameLayerQuadBoxes rejects a source that is not an axis-aligned quad',()=>{
 const tri={id:'t',type:'polyline',closed:true,layer:'L1',points:[{x:0,y:0},{x:10,y:0},{x:5,y:5}]};
 assert.throws(()=>sameLayerQuadBoxes([tri],'t'));
 assert.throws(()=>sameLayerQuadBoxes([tri],'missing'));
});

/* ── PPP ── */
test('plotBoxDecorationIds collects distinct sheetIds from PLOT_BOX decoration entities',()=>{
 const es=[
  {id:'e1',plotBox:true,sheetDecoration:true,sheetId:'s1'},
  {id:'e2',plotBox:true,sheetDecoration:true,sheetId:'s2'},
  {id:'e3',type:'line'},
  {id:'e4',plotBox:true,sheetDecoration:false,sheetId:'s3'},
 ];
 assert.deepEqual(plotBoxDecorationIds(es),['s1','s2']);
});

/* ── RUB ── */
test('rubbleZigzag alternates offsets perpendicular to the baseline and forms a magenta zigzag',()=>{
 const points=rubbleZigzag({x:0,y:0},{x:1000,y:0},200,500);
 assert.equal(RUB_COLOR,'#ff00ff');
 assert.equal(points.length,3); // length 1000 / pitch 500 -> 2 segments -> 3 points
 assert.deepEqual(points[0],{x:0,y:-100});
 assert.deepEqual(points[1],{x:500,y:100});
 assert.deepEqual(points[2],{x:1000,y:-100});
});
test('rubbleZigzag rejects non-positive width/pitch and coincident points',()=>{
 assert.throws(()=>rubbleZigzag({x:0,y:0},{x:10,y:0},0,100));
 assert.throws(()=>rubbleZigzag({x:0,y:0},{x:10,y:0},100,0));
 assert.throws(()=>rubbleZigzag({x:0,y:0},{x:0,y:0},100,100));
});

/* ── LCC ── */
test('effectiveColorOf prefers the entity color, falling back to its layer color',()=>{
 const layers=[{id:'L1',color:'#ff0000'}];
 assert.equal(effectiveColorOf({layer:'L1',color:'#00ff00'},layers),'#00ff00');
 assert.equal(effectiveColorOf({layer:'L1'},layers),'#ff0000');
 assert.equal(effectiveColorOf({layer:'missing'},layers),null);
});
test('colorMatchIds finds every entity whose effective color matches',()=>{
 const layers=[{id:'L1',color:'#ff0000'},{id:'L2',color:'#0000ff'}];
 const es=[{id:'a',layer:'L1'},{id:'b',layer:'L2'},{id:'c',layer:'L1',color:'#0000ff'}];
 assert.deepEqual(colorMatchIds(es,layers,'#ff0000'),['a']);
 assert.deepEqual(colorMatchIds(es,layers,'#0000FF').sort(),['b','c']);
});

/* ── LCS ── */
test('sameConditionIds matches same type, and same block name when type is block',()=>{
 const es=[
  {id:'a',type:'line'},
  {id:'b',type:'line'},
  {id:'c',type:'text'},
  {id:'d',type:'block',name:'DOOR'},
  {id:'e',type:'block',name:'WINDOW'},
 ];
 assert.deepEqual(sameConditionIds(es,{type:'line'}).sort(),['a','b']);
 assert.deepEqual(sameConditionIds(es,{type:'block',name:'DOOR'}),['d']);
 assert.deepEqual(sameConditionIds(es,null),[]);
});

/* ── SER ── */
test('measurableKeysFor returns the applicable measurable properties per entity type',()=>{
 assert.deepEqual(measurableKeysFor('text'),['height']);
 assert.deepEqual(measurableKeysFor('circle'),['radius','area']);
 assert.deepEqual(measurableKeysFor('line'),['length']);
 assert.deepEqual(measurableKeysFor('polyline'),['length','area']);
 assert.deepEqual(measurableKeysFor('block'),['scale']);
 assert.deepEqual(measurableKeysFor('dimension'),[]);
 assert.equal(SER_MEASURE_LABEL.area,'면적');
 assert.equal(SER_MEASURE_LABEL.radius,'반지름');
});
test('measureValue computes length/area/radius/height/scale from entity geometry',()=>{
 assert.equal(measureValue({type:'line',points:[{x:0,y:0},{x:3,y:4}]},'length'),5);
 const square={type:'rectangle',points:[{x:0,y:0},{x:4,y:0},{x:4,y:3},{x:0,y:3}]};
 assert.equal(measureValue(square,'area'),12);
 assert.equal(measureValue(square,'length'),14); // perimeter
 assert.equal(measureValue({type:'circle',radius:2},'radius'),2);
 assert.ok(Math.abs(measureValue({type:'circle',radius:2},'area')-Math.PI*4)<1e-9);
 assert.equal(measureValue({type:'text',height:150},'height'),150);
 assert.equal(measureValue({type:'block'},'scale'),1);
 assert.equal(measureValue({type:'block',scale:2.5},'scale'),2.5);
});
test('selectByRange keeps only same-type entities whose every measured key falls in [min,max]',()=>{
 const ref={type:'circle',radius:10};
 const small={id:'a',type:'circle',radius:5};
 const mid={id:'b',type:'circle',radius:10};
 const big={id:'c',type:'circle',radius:50};
 const otherType={id:'d',type:'line',points:[{x:0,y:0},{x:10,y:0}]};
 const ids=selectByRange([small,mid,big,otherType],ref,{radius:[8,12]});
 assert.deepEqual(ids,['b']);
});

/* ── LUI ── */
test('layerSnapshot captures visible/frozen/locked per layer with sane defaults',()=>{
 const layers=[{id:'L1',visible:true,frozen:false,locked:false},{id:'L2',frozen:true,locked:true}];
 assert.deepEqual(layerSnapshot(layers),[
  {id:'L1',visible:true,frozen:false,locked:false},
  {id:'L2',visible:true,frozen:true,locked:true},
 ]);
});
test('applicableSnapshotChanges drops snapshot entries for layers that no longer exist',()=>{
 const snapshot=[{id:'L1',visible:true,frozen:false,locked:false},{id:'gone',visible:false,frozen:false,locked:false}];
 const layers=[{id:'L1'}];
 assert.deepEqual(applicableSnapshotChanges(snapshot,layers),[{id:'L1',visible:true,frozen:false,locked:false}]);
});
