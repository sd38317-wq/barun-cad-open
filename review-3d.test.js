import test from 'node:test';import assert from 'node:assert/strict';
import {wallLayerGuess,floorElevation,noonSun,buildReviewModel,disposeReviewModel,reviewCamera,REVIEW_VIEWS,exportReviewGLB,renderReview3D,walkSpotFromPlan} from './review-3d.js';
import {DrawingEngine} from './engine.js';
import {readFileSync} from 'node:fs';
import * as THREE from './three.module.js';
import {mergeGeometries} from './BufferGeometryUtils.js';
import {roofGeometry} from './roof-geometry.js';
test('floor offsets and approximate Busan solar noon',()=>{assert.equal(floorElevation('1F'),0);assert.equal(floorElevation('2F'),3000);assert.equal(floorElevation('WALL_3F',4000),8000);assert.equal(floorElevation('roof'),0);const sun=noonSun(new Date(2026,5,21));assert.equal(sun.azimuth,180);assert.ok(sun.altitude>78&&sun.altitude<79);});
function fixture(){const engine=new DrawingEngine(),doc=structuredClone(engine.doc);doc.layers[0].name='1F';doc.layers.push({...doc.layers[0],id:'second',name:'2F'});doc.entities=['default','second'].map((layer,i)=>({id:`slab-${i}`,layer,type:'rectangle',points:[{x:0,y:0},{x:5000,y:0},{x:5000,y:5000},{x:0,y:5000}]}));engine.execute({type:'load',document:doc});return engine;}
test('shared model gives slabs200 and roof200, cumulative floors, filters without shifting',()=>{
 const engine=fixture();engine.execute({type:'model3d.settings',settings:{floorHeights:{'1F':4500,'2F':3000}}});
 const before=JSON.stringify(engine.doc),model=buildReviewModel(engine.doc);assert.ok(Math.abs(model.box.min.y+.2)<1e-5);assert.ok(Math.abs(model.box.max.y-7.7)<1e-5);assert.equal(JSON.stringify(engine.doc),before);assert.deepEqual(model.floors,['1F','2F']);
 for(const view of REVIEW_VIEWS){const camera=reviewCamera(model.box,view);assert.ok(camera.isOrthographicCamera);assert.ok(camera.position.toArray().every(Number.isFinite));}
 const lower=buildReviewModel(engine.doc,{floors:['1F']});assert.ok(Math.abs(lower.box.max.y-.2)<1e-5,'no fake roof over a filtered lower floor');disposeReviewModel(lower.group);
 const upper=buildReviewModel(engine.doc,{floors:['2F'],autoSlabs:false,autoRoof:false});assert.ok(Math.abs(upper.box.min.y-4.5)<1e-5);disposeReviewModel(upper.group);
 disposeReviewModel(model.group);
});
test('floor settings JSON roundtrip, undo/redo and invalid edits stay atomic',()=>{
 const engine=fixture(),before=JSON.stringify(engine.doc),count=engine.undoStack.length;
 engine.execute({type:'model3d.settings',settings:{floorHeights:{'1F':4500},autoSlabs:false,autoRoof:false}});assert.equal(engine.undoStack.length,count+1);
 const copy=new DrawingEngine();copy.execute({type:'load',document:JSON.parse(JSON.stringify(engine.doc))});assert.equal(copy.doc.model3d.floorHeights['1F'],4500);
 engine.execute({type:'undo'});assert.equal(JSON.stringify(engine.doc),before);engine.execute({type:'redo'});assert.equal(engine.doc.model3d.autoSlabs,false);
 for(const settings of [{floorHeights:{'0F':3000}},{floorHeights:{'1F':0}},{floorHeights:{'1F':Infinity}},{autoRoof:'yes'},{floorHeights:undefined}]){const snapshot=engine.doc;assert.throws(()=>engine.execute({type:'model3d.settings',settings}));assert.equal(engine.doc,snapshot);}
});
test('partial model properties merge and invalid kind/rise/color/ids fail without undo entry',()=>{
 const engine=fixture();engine.execute({type:'model3d.set',ids:['slab-0','slab-1'],changes:{height:300,kind:'slab'}});engine.execute({type:'model3d.set',ids:['slab-0'],changes:{color:'#abcdef'}});assert.deepEqual(engine.doc.entities[0].model3d,{height:300,kind:'slab',color:'#abcdef'});
 for(const changes of [{height:0},{height:1000001},{elevation:NaN},{kind:'bad'},{roofRise:-1},{color:'red'},{}]){const snapshot=engine.doc,count=engine.undoStack.length;assert.throws(()=>engine.execute({type:'model3d.set',ids:['slab-0'],changes}));assert.equal(engine.doc,snapshot);assert.equal(engine.undoStack.length,count);}
 assert.throws(()=>engine.execute({type:'model3d.set',ids:['slab-0','missing'],changes:{height:100}}));engine.execute({type:'undo'});assert.deepEqual(engine.doc.entities[0].model3d,{height:300,kind:'slab'});
});
test('GLB uses the same model and exports valid binary with no document mutations',async()=>{
 const old=globalThis.FileReader;
 globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();});}};
 try{const engine=fixture(),before=JSON.stringify(engine.doc),bytes=await exportReviewGLB(engine.doc),view=new DataView(bytes);assert.equal(view.getUint32(0,true),0x46546c67);assert.equal(view.getUint32(4,true),2);assert.equal(view.getUint32(8,true),bytes.byteLength);assert.equal(JSON.stringify(engine.doc),before);}finally{globalThis.FileReader=old;}
});
test('3D modules stay dynamically loaded from app and bridge, invalid render inputs reject before WebGL',async()=>{
 for(const filename of ['app.js','bridge-client.js']){const source=readFileSync(new URL(filename,import.meta.url),'utf8');assert.match(source,/import\('\.\/review-3d\.js'\)/);assert.doesNotMatch(source,/from\s+['"]\.\/review-3d/);}
 for(const args of [{view:'unknown'},{size:255},{size:1601},{size:900.5},{floors:['bad']}])await assert.rejects(renderReview3D(fixture().doc,args));
});
test('legacy global floor height is preserved without a table and shared block geometry renders lazily',()=>{
 const engine=fixture();engine.execute({type:'review.settings',settings:{floorHeight:4000}});const legacy=buildReviewModel(engine.doc,{autoSlabs:false,autoRoof:false});assert.ok(Math.abs(legacy.box.max.y-4.2)<1e-5);disposeReviewModel(legacy.group);
 const doc={...structuredClone(engine.doc),version:3,sharedBlocks:{B:{origin:{x:0,y:0},entities:[{type:'rectangle',layer:'default',points:[{x:0,y:0},{x:4000,y:0},{x:4000,y:4000},{x:0,y:4000}]}]}},entities:[{id:'insert',type:'block',name:'B',layer:'default',sharedBlock:'B',position:{x:10000,y:0},rotation:0,scale:1,entities:[]}]};
 const model=buildReviewModel(doc);assert.equal(model.box.isEmpty(),false);assert.ok(model.box.min.x>=10);assert.ok(model.box.max.y>4);disposeReviewModel(model.group);
});
test('native walls follow their floor heights and MCP partial height/elevation overrides',()=>{
 const engine=fixture(),doc=structuredClone(engine.doc);doc.entities=['default','second'].map((layer,i)=>({id:'wall-'+i,type:'wall',layer,points:[{x:0,y:0},{x:5000,y:0}],thickness:200,openings:[]}));doc.model3d={floorHeights:{'1F':4500,'2F':3200},autoSlabs:false,autoRoof:false};engine.execute({type:'load',document:doc});
 const model=buildReviewModel(engine.doc);assert.ok(Math.abs(model.box.max.y-7.7)<1e-5);disposeReviewModel(model.group);
 engine.execute({type:'model3d.set',ids:['wall-1'],changes:{height:1000,elevation:200}});const changed=buildReviewModel(engine.doc);assert.ok(Math.abs(changed.box.max.y-5.7)<1e-5);disposeReviewModel(changed.group);
});
test('line-pair walls on each nF layer are inferred once for rendering plus footprint',()=>{
 const engine=fixture(),counts={};const doc={...engine.doc,entities:[],model3d:{floorHeights:{'1F':4500,'2F':3000}}};
 const inferLayerWalls=(_entities,ids)=>{const id=[...ids][0];counts[id]=(counts[id]||0)+1;return [[{x:0,y:-100},{x:5000,y:-100},{x:5000,y:100},{x:0,y:100}]];};
 const model=buildReviewModel(doc,{inferLayerWalls});assert.equal(model.wallCount,2);assert.deepEqual(counts,{default:1,second:1});assert.ok(Math.abs(model.box.max.y-7.7)<1e-5);disposeReviewModel(model.group);
});

test('review roof buffers use metres, upward normals and merge with existing extrusions',()=>{
 // Execute the actual local adapter without creating a DOM/WebGL renderer.
 const source=readFileSync(new URL('./review-3d.js',import.meta.url),'utf8');
 const adapter=source.match(/^  const addRoof=.*$/m)?.[0];assert.ok(adapter);
 const group=new THREE.Group(),buckets=new Map(),color=new THREE.Color('#b8c7d0');
 const edgePositions=[];   // 지붕은 삼각형에서 모서리를 찾아 여기에 모은다
 const addRoof=new Function('roofGeometry','THREE','group','buckets','objectId','edgePositions',adapter+';return addRoof;')(roofGeometry,THREE,group,buckets,'roof-1',edgePositions);
 const points=[{x:0,y:0},{x:8000,y:0},{x:8000,y:4000},{x:0,y:4000}];
 addRoof(points,{type:'gable',pitch:50},3500,{kind:'roof',preset:'roof-concrete',color});   // 재료 = 종류 + 재료 ID + 색
 const bucket=buckets.get('roof:roof-concrete:'+color.getHex()+':roof-1'),geo=bucket.geos[0];assert.ok(edgePositions.length>0,'지붕 모서리 선');
 geo.computeBoundingBox();assert.equal(geo.boundingBox.max.y,4.5);assert.equal(geo.boundingBox.min.y,3.5);assert.equal(geo.boundingBox.min.z,-4);
 for(let i=0;i<geo.attributes.normal.count;i++) assert.ok(geo.attributes.normal.getY(i)>0);
 const slab=new THREE.ExtrudeGeometry(new THREE.Shape(points.map(p=>new THREE.Vector2(p.x/1000,p.y/1000))),{depth:.2,bevelEnabled:false});
 const merged=mergeGeometries([slab,geo],false);assert.ok(merged);assert.ok(merged.attributes.uv);assert.equal(bucket.id,'roof-1');
 addRoof(points,{type:'hip',pitch:-1},3500,{kind:'roof',preset:'roof-concrete',color});assert.equal(group.userData.roofFallbacks[0].id,'roof-1');assert.ok(group.userData.roofFallbacks[0].reason);
 merged.dispose();slab.dispose();bucket.geos.forEach(g=>g.dispose());
});

test('shared builder renders shaped roofs at cumulative floor elevations and keeps floor filtering',()=>{
 for(const [type,rise] of [['gable',1000],['hip',1000],['shed',2000]]){
  const engine=fixture(),doc=structuredClone(engine.doc);
  doc.model3d={floorHeights:{'1F':4500,'2F':3200},autoSlabs:true,autoRoof:true};
  doc.entities[1].points=[{x:0,y:0},{x:8000,y:0},{x:8000,y:4000},{x:0,y:4000}];
  doc.entities.push({...structuredClone(doc.entities[1]),id:'upper-floor-outline'});
  doc.entities[1].model3d={kind:'roof',height:200,elevation:3200,roofRise:9000,roof:{type,pitch:50,overhang:500},color:'#abcdef'};
  const before=JSON.stringify(doc),model=buildReviewModel(doc);
  try{
   const mesh=model.group.children.find(o=>o.userData.objectId==='slab-1');assert.ok(mesh?.isMesh);
   mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox;
   assert.ok(Math.abs(box.max.y-(7.9+rise/1000+(type==='shed'?.5:.25)))<1e-5,type);
   assert.ok(Math.abs(box.min.x+.5)<1e-5);assert.ok(Math.abs(box.max.x-8.5)<1e-5);
   assert.ok(mesh.geometry.attributes.uv);assert.equal(mesh.material.color.getHexString(),'abcdef');
   assert.ok(Math.abs(model.box.min.y+.2)<1e-5,'automatic slabs retained');
   assert.equal(JSON.stringify(doc),before);assert.equal(model.group.userData.roofFallbacks,undefined);
  }finally{disposeReviewModel(model.group);}
  const lower=buildReviewModel(doc,{floors:['1F']});
  try{assert.ok(Math.abs(lower.box.max.y-.2)<1e-5);assert.ok(!lower.group.children.some(o=>o.userData.objectId==='slab-1'));}finally{disposeReviewModel(lower.group);}
 }
});

test('shared builder reports flat roof fallback and partial model edits retain roof options',()=>{
 const engine=fixture(),doc=structuredClone(engine.doc);
 doc.entities[1].model3d={height:200,elevation:3000,kind:'roof',roof:{type:'hip',pitch:-1}};
 engine.execute({type:'load',document:doc});
 const copy=new DrawingEngine();copy.execute({type:'load',document:JSON.parse(JSON.stringify(engine.doc))});assert.deepEqual(copy.doc.entities[1].model3d.roof,{type:'hip',pitch:-1});
 for(const roof of [null,[],50]){const invalid=structuredClone(doc);invalid.entities[1].model3d.roof=roof;assert.throws(()=>copy.execute({type:'load',document:invalid}));}
 assert.throws(()=>engine.execute({type:'model3d.set',ids:['slab-1'],changes:{roof:{type:'gable'}}}),'MCP property contract is unchanged');
 engine.execute({type:'model3d.set',ids:['slab-1'],changes:{height:300,color:'#abcdef'}});
 assert.deepEqual(engine.doc.entities[1].model3d.roof,{type:'hip',pitch:-1});
 const model=buildReviewModel(engine.doc,{autoSlabs:false,autoRoof:false});
 try{
  assert.equal(model.group.userData.roofFallbacks.length,1);
  assert.equal(model.group.userData.roofFallbacks[0].id,'slab-1');assert.match(model.group.userData.roofFallbacks[0].reason,/pitch/);
  assert.ok(Math.abs(model.box.max.y-6.3)<1e-5);
 }finally{disposeReviewModel(model.group);}
 engine.execute({type:'undo'});assert.equal(engine.doc.entities[1].model3d.height,200);assert.deepEqual(engine.doc.entities[1].model3d.roof,{type:'hip',pitch:-1});
});
test('3D 벽 레이어 기본값: 벽 이름 레이어만 고르고, 없으면 고르지 않는다(레이어 0 의 평행선을 벽으로 세우지 않음)',()=>{
 assert.equal(wallLayerGuess([{name:'0'},{name:'TEXT'}]),null);
 assert.equal(wallLayerGuess([{name:'0'},{name:'A-WALL-INSUL'},{name:'A-WALL-CONC'}]).name,'A-WALL-CONC');
 assert.equal(wallLayerGuess([{name:'단열재'},{name:'벽체'}]).name,'벽체');
});
test('내부 보기: 설계 묶음 평면 칸에서 찍은 자리 → 모델 좌표·그 층 바닥(칸 원점을 뺀다)',()=>{
 const wall=(id,story)=>({id,kind:'wall',story,path:[[0,0],[3600,0],[3600,8850],[0,8850],[0,0]]});
 const doc={drawingSets:{'ds-1':{model:{stories:[{id:'1F',name:'1층',elevation:0},{id:'rf',name:'RF',elevation:3000}],elements:[wall('w1','1F'),wall('w2','rf')]},wallViews:[{origin:[17640,-136365],wallIds:['w1']},{origin:[70440,-136365],wallIds:['w2']}]}}};
 assert.deepEqual(walkSpotFromPlan(doc,'',{x:19440,y:-131800}),{point:{x:1800,y:4565},level:0});
 assert.deepEqual(walkSpotFromPlan(doc,'ds-1',{x:72240,y:-131800}),{point:{x:1800,y:4565},level:3});
 assert.equal(walkSpotFromPlan(doc,'ds-1',{x:-50000,y:0}),null,'칸 밖');
 assert.equal(walkSpotFromPlan({},'',{x:1,y:1}),null,'묶음 없음 = 도면 좌표 그대로');
});
