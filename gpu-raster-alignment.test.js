import test from 'node:test';
import assert from 'node:assert/strict';
import {alignRasterView,viewOf,sameView,renderRegion,cropRegion} from './gpu-render-protocol.js';
import {GpuRenderClient} from './gpu-render-client.js';
import {CadGpuRenderer} from './gpu-renderer.js';
import {THREE} from './vendor/mlightcad.js';
import {SceneMatrixCache} from './gpu-scene-matrices.js';

const origin={x:73.125,y:91.75};
const view=(pixelRatio,width=1200/pixelRatio,height=800/pixelRatio)=>({width,height,pixelRatio,scale:.35,origin,hiddenTextId:null});

test('near-integer alignment preserves camera and fixes floor/round disagreement across DPRs',()=>{
 for(const d of [1,1.25,2,2.5])for(const error of [-.00005,.00005]){
  const raw=view(d,(1200+error)/d,(800+error)/d),aligned=alignRasterView(raw);
  assert.equal(Math.floor(aligned.width*d),1200);assert.equal(Math.floor(aligned.height*d),800);
  assert.equal(Math.round(aligned.width*d),1200);assert.equal(Math.round(aligned.height*d),800);
  assert.equal(aligned.origin,origin);assert.equal(aligned.scale,raw.scale);assert.equal(aligned.pixelRatio,d);
  assert.equal(alignRasterView(aligned),aligned,'canonical view is stable');
 }
 const actual=view(2.5,1172,492.3999938964844),aligned=alignRasterView(actual);
 assert.equal(Math.floor(actual.height*actual.pixelRatio),1230);
 assert.equal(aligned.height,492.4);assert.equal(Math.floor(aligned.height*2.5),1231);
});

test('alignment accepts only near-integer error and leaves genuine fractional dimensions unchanged',()=>{
 const inside=view(2.5,(1200+.000099)/2.5,(800-.000099)/2.5);
 const outside=view(2.5,(1200+.000101)/2.5,(800-.000101)/2.5);
 assert.notEqual(alignRasterView(inside),inside);assert.equal(alignRasterView(outside),outside);
 const fractional=view(1.25,401,300),aligned=alignRasterView(fractional);
 assert.equal(aligned,fractional);assert.equal(renderRegion(fractional).margin,0);
 for(const d of [1.1,1.3,1.7])for(const pixels of [1231,2463,4097]){
  const aligned=alignRasterView(view(d,pixels/d-1e-8,800/d));
  assert.equal(Math.floor(aligned.width*d),pixels,'normalization must not leave a one-ULP floor error');
 }
});

test('worker region and crop agree on canonical dimensions without accepting fractional pan or zoom',()=>{
 const raw=view(2.5,1172,492.3999938964844),canonical=viewOf(raw),region=renderRegion(raw);
 assert.equal(region.margin,128);assert.equal(region.width,1428);assert.equal(region.height,748.4);
 const frame={view:canonical,region,bitmap:{width:Math.floor(region.width*2.5),height:Math.floor(region.height*2.5)}};
 assert.deepEqual(cropRegion(frame,raw),{x:320,y:320,w:2930,h:1231});
 assert.deepEqual(cropRegion(frame,{...raw,origin:{x:origin.x+.4,y:origin.y}}),{x:319,y:320,w:2930,h:1231});
 assert.equal(cropRegion(frame,{...raw,origin:{x:origin.x+.2,y:origin.y}}),null);
 assert.equal(cropRegion(frame,{...raw,scale:raw.scale*2}),null);
 assert.equal(sameView(raw,canonical),true);
});

test('worker reply to a noisy near-integer view does not trigger an endless redispatch loop',()=>{
 const sent=[],worker={postMessage(message){sent.push(message);},terminate(){}},client=new GpuRenderClient({createWorker:()=>worker});
 const raw=view(2.5,1172,492.3999938964844),doc={layers:[],entities:[]};
 try{
  client.request({...raw,doc,revision:1});assert.equal(sent.length,1);
  const job=sent[0],region=renderRegion(job.view,job.overscan);
  client.receive({...job,region,bitmap:{width:Math.floor(region.width*2.5),height:Math.floor(region.height*2.5),close(){}},stats:{frames:1}});
  assert.equal(sent.length,1);
  const ready=client.request({...raw,doc,revision:1});assert.ok(ready);assert.equal(sent.length,1);assert.equal(ready.crop.h,1231);assert.equal(client.stats.viewPending,false);
 }finally{client.dispose();}
});

function renderer(){
 const r=Object.create(CadGpuRenderer.prototype);let ratio=1;
 Object.assign(r,{canvas:{width:0,height:0},camera:new THREE.OrthographicCamera(),scene:new THREE.Scene(),sceneMatrices:new SceneMatrixCache(),stats:{frames:0},dashMaterials:new Set(),widthMaterials:[],clipAssets:new Map(),
  setDocument(doc,revision){this.doc=doc;this.revision=revision;this.shift={x:0,y:0};},updateTextViewport(){},refineViewport(){},updateViewport(){},
  gl:{setPixelRatio(value){ratio=value;},info:{render:{calls:1}},render(){}},
  renderer:{setSize(width,height){r.canvas.width=Math.floor(width*ratio);r.canvas.height=Math.floor(height*ratio);},syncCameraZoom(){}},
 });return r;
}

test('native size, projection and retained snapshot use the same aligned dimensions',()=>{
 for(const d of [1,1.25,2,2.5]){
  const r=renderer(),doc={},raw=view(d,(1200-.00005)/d,(800-.00005)/d),aligned=alignRasterView(raw);
  r.render({...raw,doc,revision:1});assert.equal(r.canvas.width,1200);assert.equal(r.canvas.height,800);
  assert.equal(r.camera.right,(aligned.width-origin.x)/raw.scale);assert.equal(r.camera.bottom,(origin.y-aligned.height)/raw.scale);
  assert.equal(r.renderSnapshot.width,aligned.width);assert.equal(r.renderSnapshot.height,aligned.height);
  const first=r.renderSnapshot;r.render({...aligned,doc,revision:1});assert.equal(r.renderSnapshot,first);assert.equal(r.stats.fullFrames,1);
 }
 const r=renderer(),raw=view(1.25,401,300);r.render({...raw,doc:{},revision:1});assert.equal(r.renderSnapshot.width,401);assert.equal(r.canvas.width,501);
});
