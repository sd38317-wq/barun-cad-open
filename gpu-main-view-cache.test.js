import test from 'node:test';
import assert from 'node:assert/strict';
import {GpuMainViewCache} from './gpu-main-view-cache.js';

const base={doc:{entities:[]},revision:1,width:400,height:300,scale:2,origin:{x:150.25,y:100.5},pixelRatio:1,hiddenTextId:null};
function fixture(options={}){
 const draws=[],ctx={drawImage(...args){draws.push(args);}},renders=[];
 const renderer={canvas:{width:0,height:0},stats:{workerPending:false},gl:{capabilities:{maxTextureSize:4096}},
  render(view){this.beforeRender?.(view);renders.push(view);this.canvas.width=Math.floor(view.width*view.pixelRatio);this.canvas.height=Math.floor(view.height*view.pixelRatio);
   if(!this.stats.workerPending){this.doc=view.doc;this.revision=view.revision;this.stats.appliedRevision=view.revision;}
   this.renderSnapshot={view};return this.canvas;
  }};
 return {cache:new GpuMainViewCache(options),renderer,ctx,draws,renders};
}

test('integral pans crop the original native canvas without rerender or recenter',()=>{
 const f=fixture(),draw=view=>f.cache.draw(f.ctx,f.renderer,view);
 assert.deepEqual(draw(base),{hit:false,overscan:true});assert.equal(f.renders.length,1);
 const canvas=f.renderer.canvas,snapshot=f.renderer.renderSnapshot;
 assert.equal(f.cache.frame.bitmap,canvas);assert.equal(f.cache.frame.snapshot,snapshot);
 for(const dx of [1,20,-100,128])assert.deepEqual(draw({...base,origin:{...base.origin,x:base.origin.x+dx}}),{hit:true,overscan:true});
 assert.equal(f.renders.length,1);assert.equal(f.cache.stats.hits,4);assert.equal(f.cache.frame.view.origin.x,base.origin.x);
 assert.equal(f.draws.at(-1)[0],canvas);assert.deepEqual(f.draws.at(-1).slice(1),[0,128,400,300,0,0,400,300]);
 assert.deepEqual(draw({...base,origin:{...base.origin,x:base.origin.x+129}}),{hit:false,overscan:true});assert.equal(f.renders.length,2);
});

test('DPR translations use physical pixels and canonical near-integer dimensions',()=>{
 const f=fixture(),view={...base,width:1172,height:492.3999938964844,pixelRatio:2.5};
 f.cache.draw(f.ctx,f.renderer,view);assert.equal(f.draws.at(-1)[4],1231);assert.equal(f.draws.at(-1)[8],492.4);
 f.cache.draw(f.ctx,f.renderer,{...view,origin:{...view.origin,x:view.origin.x+.4}});assert.equal(f.cache.stats.hits,1);
 f.cache.draw(f.ctx,f.renderer,{...view,origin:{...view.origin,x:view.origin.x+.2}});assert.equal(f.renders.length,2,'fractional physical pan must rerender');
});

test('revision, document, camera and presentation changes invalidate cached pixels',()=>{
 const changes=[v=>({...v,doc:{entities:[]}}),v=>({...v,revision:2}),v=>({...v,scale:3}),v=>({...v,width:401}),v=>({...v,height:301}),v=>({...v,pixelRatio:2}),v=>({...v,hiddenTextId:'editing-text'})];
 for(const change of changes){const f=fixture();f.cache.draw(f.ctx,f.renderer,base);f.cache.draw(f.ctx,f.renderer,change(base));assert.equal(f.renders.length,2);assert.equal(f.cache.stats.hits,0);}
});

test('font/context/geometry invalidation and mutable canvas identity reject stale frame reuse',()=>{
 const changes=[r=>{r.renderSnapshot=null;},r=>{r.renderSnapshot={};},r=>{r.canvas={...r.canvas};},r=>{r.canvas.width--;},r=>{r.doc={};},r=>{r.revision=0;},r=>{r.stats.appliedRevision=0;},r=>{r.stats.workerPending=true;},r=>{r.compileClient={pending:{result:{}}};}];
 for(const change of changes){const f=fixture();f.cache.draw(f.ctx,f.renderer,base);change(f.renderer);f.cache.draw(f.ctx,f.renderer,base);assert.equal(f.renders.length,2);assert.equal(f.cache.stats.hits,0);}
 const f=fixture();f.cache.draw(f.ctx,f.renderer,base);f.renderer.failed='lost';f.renderer.render=()=>{assert.equal(f.cache.frame,null);throw Error('context lost');};
 assert.throws(()=>f.cache.draw(f.ctx,f.renderer,base),/context lost/);assert.equal(f.cache.frame,null);
});

test('miss releases the old frame before rendering; pending jobs cannot install reusable pixels',()=>{
 const f=fixture();f.cache.draw(f.ctx,f.renderer,base);
 f.renderer.beforeRender=()=>assert.equal(f.cache.frame,null);
 f.renderer.stats.workerPending=true;f.cache.draw(f.ctx,f.renderer,{...base,revision:2});assert.equal(f.cache.frame,null);
 f.renderer.stats.workerPending=false;f.cache.draw(f.ctx,f.renderer,{...base,revision:2});assert.ok(f.cache.frame);
 f.cache.clear();assert.equal(f.cache.frame,null);assert.equal(f.renderer.canvas.width,656,'clear does not destroy renderer resources');
});

test('genuine fractional dimensions fall back to existing direct rendering without crop or stretch',()=>{
 const f=fixture(),view={...base,width:400.25,pixelRatio:1.25};
 f.cache.draw(f.ctx,f.renderer,view);f.cache.draw(f.ctx,f.renderer,view);
 assert.equal(f.cache.frame,null);assert.equal(f.cache.stats.directFrames,2);assert.equal(f.cache.stats.hits,0);
 assert.equal(f.renders[0].width,view.width);assert.equal(f.renders[0].height,view.height);
 assert.equal(f.draws[0].length,5);assert.deepEqual(f.draws[0].slice(1),[0,0,view.width,view.height]);
});

test('overscan respects texture, renderbuffer and pixel budgets and falls back when no margin fits',()=>{
 const f=fixture();f.renderer.gl.capabilities.maxTextureSize=500;
 f.renderer.gl.getContext=()=>({MAX_RENDERBUFFER_SIZE:1,getParameter:()=>480});
 f.cache.draw(f.ctx,f.renderer,base);assert.equal(f.renderer.canvas.width,480);assert.equal(f.cache.frame.region.margin,40);
 const pixel=fixture({maxPixels:500*400});pixel.cache.draw(pixel.ctx,pixel.renderer,base);assert.ok(pixel.renderer.canvas.width*pixel.renderer.canvas.height<=200000);assert.equal(pixel.cache.frame.region.margin,50);
 const noMargin=fixture({maxPixels:400*300});noMargin.cache.draw(noMargin.ctx,noMargin.renderer,base);assert.equal(noMargin.cache.frame,null);assert.equal(noMargin.cache.stats.directFrames,1);
});

test('unexpected native buffer size falls back directly and renderer replacement cannot share pixels',()=>{
 const f=fixture();const render=f.renderer.render;
 f.renderer.render=function(view){const canvas=render.call(this,view);if(view.margin)canvas.height--;return canvas;};
 f.cache.draw(f.ctx,f.renderer,base);assert.equal(f.renders.length,2);assert.equal(f.cache.frame,null);assert.equal(f.draws[0].length,5);
 const a=fixture(),b=fixture();a.cache.draw(a.ctx,a.renderer,base);a.cache.draw(a.ctx,b.renderer,base);assert.equal(a.cache.stats.hits,0);assert.equal(b.renders.length,1);
});
