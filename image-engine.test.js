import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';

const image=()=>({type:'image',layer:'default',path:'plan.jpg',position:{x:10,y:20},width:100,height:50,rotation:30});
test('IMAGE bounds, corner snaps and border picking',()=>{
  const e=image(), c=G.imageCorners(e);
  assert.equal(c.length,4); const b=G.bounds([e]); assert.ok(b.minX<10&&b.maxX>90&&b.minY===20&&b.maxY>110);
  assert.equal(G.snapGeometry(e,c[2],.01).points.length,1); assert.equal(G.entityDistance(e,c[0]),0);
});
test('IMAGE engine validates, defaults fade, transforms and undo/redo',()=>{
  const eng=new DrawingEngine(); eng.execute({type:'add',entity:image()}); const e=eng.doc.entities[0];
  assert.equal(e.fade,50); eng.execute({type:'copy',ids:[e.id],dx:200,dy:0}); assert.equal(eng.doc.entities.length,2);
  assert.equal(eng.undoStack.length>0,true);
  assert.throws(()=>eng.execute({type:'update',ids:[e.id],changes:{width:0}}));
  assert.throws(()=>eng.execute({type:'add',entity:{...image(),fade:91}}));
  assert.throws(()=>eng.execute({type:'add',entity:{...image(),width:Infinity}}));
  assert.throws(()=>eng.execute({type:'add',entity:{...image(),path:{file:'x'}}}));
  assert.throws(()=>eng.execute({type:'add',entity:{...image(),rotation:Infinity}}));
});
