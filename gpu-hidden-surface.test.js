import test from 'node:test';
import assert from 'node:assert/strict';
import {CadGpuRenderer} from './gpu-renderer.js';

// A hidden drawing tab gives back its window-sized drawing buffer and the 2D
// staging canvases of atlas pages already uploaded to the GPU (2026-10-13:
// 65 small tabs held 28 GB in the GPU process).
const fakeCanvas=log=>({width:300,height:150,getContext:()=>({save(){},restore(){},beginPath(){},rect(){},clip(){},fillRect(){},fillText:text=>log.push(text)})});
const tile=(text,x)=>({asset:{font:'16px sans-serif',color:'#fff',lines:[text],lineWidths:[40],lineAlign:'left',rawW:40,ox:0,oy:0,h:16,mask:null},x,y:0,packedW:48,packedH:30,left:0,top:0});

test('releaseSurface shrinks the drawing buffer and drops only uploaded atlas canvases',()=>{
  const sizes=[],r=Object.create(CadGpuRenderer.prototype);
  r.gl={setPixelRatio:ratio=>sizes.push(['ratio',ratio]),setSize:(w,h,style)=>sizes.push([w,h,style]),properties:{get:texture=>({__version:texture.uploaded})}};
  const uploaded={canvas:{width:2048,height:2048},texture:{version:3,uploaded:3}},pending={canvas:{width:2048,height:2048},texture:{version:4,uploaded:3}},fresh={canvas:{width:2048,height:2048}};
  const dropped=uploaded.canvas;
  Object.assign(r,{width:1404,height:672,dpr:2.5,renderSnapshot:{},textPages:[uploaded,pending,fresh]});
  r.releaseSurface();
  assert.equal(uploaded.canvas,null);assert.deepEqual([dropped.width,dropped.height],[0,0]);
  assert.equal(pending.canvas.width,2048,'a page not yet on the GPU keeps its pixels');
  assert.equal(fresh.canvas.width,2048);
  assert.deepEqual(sizes,[['ratio',1],[1,1,false]]);
  assert.equal(r.width,0);assert.equal(r.renderSnapshot,null);
  r.releaseSurface();
  assert.equal(sizes.length,2,'already released: no second resize');
});

test('a released atlas page is repainted whole before a new label joins it',()=>{
  const painted=[],r=Object.create(CadGpuRenderer.prototype);r.createCanvas=()=>fakeCanvas(painted);
  const old=tile('기존',0),added=tile('추가',48),texture={image:null,needsUpdate:false};
  const page={canvas:null,texture,tiles:[old,added]};
  r.paintTextTiles(page,[added]);
  assert.deepEqual(painted,['기존','추가']);
  assert.equal(page.canvas.width,2048);
  r.ensureTextPageTexture(page);
  assert.equal(texture.image,page.canvas,'the texture uploads the new canvas, not the dropped one');
  assert.equal(texture.needsUpdate,true);
  // A live page still paints only the new tiles.
  painted.length=0;r.paintTextTiles(page,[added]);
  assert.deepEqual(painted,['추가']);
});
