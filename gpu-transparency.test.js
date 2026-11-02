// ACAD200 121: 객체 투명도 — 계산 규칙, GPU 선 배치, 캔버스 그리기, 표시 끄기.
import test from 'node:test';
import assert from 'node:assert/strict';
import {transparencyPercent,resolveTransparency,displayAlpha,alphaKey,setTransparencyDisplay,transparencyDisplay} from './gpu-transparency.js';
import {compileGpuScene} from './gpu-scene.js';
import {CadGpuRenderer} from './gpu-renderer.js';
import {THREE} from './vendor/mlightcad.js';
import {drawEntity} from './view.js';

function renderer(){
  const r=Object.create(CadGpuRenderer.prototype);
  Object.assign(r,{scene:new THREE.Scene(),stats:{builds:0,frames:0},renderer:{subEntityTraits:{},lineSegments(values,size,indices){
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(values,size));g.setIndex(new THREE.BufferAttribute(indices,1));
    const child=new THREE.LineSegments(g,new THREE.LineBasicMaterial());const group=new THREE.Group();group.add(child);return group;
  }}});
  return r;
}
const doc=entities=>({layers:[{id:'0',name:'0',visible:true,color:'#ffffff',lineweight:.25}],entities,blocks:[],linetypeScale:1});
const line=(id,extra={})=>({id,type:'line',layer:'0',color:'#ff0000',points:[{x:0,y:0},{x:10,y:10}],...extra});

test('rules: 0~90 %, ByLayer/ByBlock, display modes 2 (alpha) and 3 (sqrt)',()=>{
  assert.equal(transparencyPercent(null),null);assert.equal(transparencyPercent('ByLayer'),null);assert.equal(transparencyPercent(120),90);assert.equal(transparencyPercent(-5),0);
  assert.equal(resolveTransparency({transparency:40}),40);assert.equal(resolveTransparency({transparency:'ByBlock'},30),30);
  assert.equal(resolveTransparency({},null,{transparency:20}),20,'ByLayer');assert.equal(resolveTransparency({}),0);
  assert.equal(displayAlpha(40),.6);assert.ok(Math.abs(displayAlpha(36,{mode:3})-.8)<1e-12);assert.equal(displayAlpha(40,{mode:1}),1);
  assert.equal(displayAlpha(40,{on:false}),1);assert.equal(alphaKey(.6000001),.6);
});

test('compile: only items with transparency carry it (block ByBlock children inherit)',()=>{
  const {items}=compileGpuScene([line('a',{transparency:50}),line('b'),{id:'k',type:'block',transparency:30,entities:[line('c',{transparency:'ByBlock'}),line('d')]}]);
  const by=id=>items.filter(i=>i.sourceId===id).map(i=>i.transparency);
  assert.deepEqual(by('a'),[50]);assert.deepEqual(by('b'),[undefined]);assert.deepEqual(by('k'),[30,undefined]);
});

test('GPU: a transparent line gets its own translucent batch; opaque batches are unchanged',()=>{
  const r=renderer();r.setDocument(doc([line('a',{transparency:50}),line('b')]),1,1);
  const batches=[...r.lineBatches.values()],translucent=batches.find(b=>b.records[0].sourceId==='a'),opaque=batches.find(b=>b.records[0].sourceId==='b');
  assert.notEqual(translucent,opaque);assert.equal(translucent.alpha,.5);assert.ok(!('alpha' in opaque));
  translucent.objects[0].traverse(c=>{if(c.material){assert.equal(c.material.transparent,true);assert.equal(c.material.opacity,.5);assert.equal(c.material.depthWrite,false);assert.equal(c.material.userData.barunOwnedMaterial,true);}});
  opaque.objects[0].traverse(c=>{if(c.material){assert.equal(c.material.transparent,false);assert.equal(c.material.depthWrite,true);}});
  setTransparencyDisplay(false);
  try{const off=renderer();off.setDocument(doc([line('a',{transparency:50}),line('b')]),1,1);assert.equal(off.lineBatches.size,1,'display off: one opaque batch');}
  finally{setTransparencyDisplay(true);}
  assert.equal(transparencyDisplay(),true);
});

test('canvas: drawEntity applies the alpha inside its own save/restore',()=>{
  const seen=[],ctx={globalAlpha:1,save(){this.stack=[...(this.stack||[]),this.globalAlpha];},restore(){this.globalAlpha=this.stack.pop();},beginPath(){},moveTo(){},lineTo(){},closePath(){},arc(){},setLineDash(){},stroke(){seen.push(this.globalAlpha);},fill(){},fillRect(){}};
  const screen=p=>p;
  drawEntity(ctx,line('a',{transparency:40}),screen,1,'#ff0000',1);
  drawEntity(ctx,line('b'),screen,1,'#ff0000',1);
  assert.deepEqual(seen,[.6,1]);assert.equal(ctx.globalAlpha,1);
  setTransparencyDisplay(false);try{seen.length=0;drawEntity(ctx,line('a',{transparency:40}),screen,1,'#ff0000',1);assert.deepEqual(seen,[1]);}finally{setTransparencyDisplay(true);}
});

test('plot: transparency is printed only when asked (AutoCAD default: not plotted)',async()=>{
  const {plotOpacity,plotSVG}=await import('./plot.js');
  assert.equal(plotOpacity({screen:100},{transparency:40},{}),1);assert.equal(plotOpacity({screen:100},{transparency:40},{},true),.6);
  assert.equal(plotOpacity({screen:50},{transparency:40},{},true),.3,'screening and transparency multiply');
  const drawing={layers:[{id:'0',name:'0',visible:true,color:'#000000',lineweight:.25}],entities:[line('a',{transparency:40,color:'#000000'})],blocks:[]};
  assert.match(plotSVG(drawing,{fit:true,plotTransparency:true}),/opacity="0.6"/);
  assert.doesNotMatch(plotSVG(drawing,{fit:true}),/opacity="0.6"/);
});
