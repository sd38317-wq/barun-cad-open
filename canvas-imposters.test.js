// ACAD200 110·111: 작은 블록 상자를 프레임 단위로 모아 한 번에 그리기.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ImposterBatch,beginImposters,endImposters,blockImposterDecision,imposterState} from './canvas-imposters.js';
import {drawEntity} from './view.js';

function recordingCtx(){
  const calls=[];
  return {calls,globalAlpha:1,save(){calls.push('save');},restore(){calls.push('restore');},beginPath(){calls.push('begin');},rect(...a){calls.push(['rect',...a]);},stroke(){calls.push('stroke');},strokeRect(...a){calls.push(['strokeRect',...a]);},setLineDash(){},moveTo(){},lineTo(){},closePath(){},clip(){calls.push('clip');}};
}
const block=(id,size,extra={})=>({id,type:'block',entities:[{type:'line',points:[{x:0,y:0},{x:size,y:size}]}],...extra});

test('decision: same as before without pressure, more boxes and skipped dots under pressure',()=>{
  assert.equal(blockImposterDecision(2,1),'box');assert.equal(blockImposterDecision(0,0),'box','a point-sized block stays a 1 px box');
  assert.equal(blockImposterDecision(50,10),'draw');assert.equal(blockImposterDecision(50,10,{collapsed:true}),'box');
  assert.equal(blockImposterDecision(.5,.5,{factor:.5}),'skip');assert.equal(blockImposterDecision(8,8,{factor:.5}),'box');
});

test('tiny blocks drawn in one frame are stroked as one path per colour',()=>{
  const ctx=recordingCtx(),batch=new ImposterBatch();beginImposters(ctx,batch,1);
  for(let i=0;i<50;i++)drawEntity(ctx,block('b'+i,1),p=>({x:p.x+i*10,y:p.y}),1,i%2?'#ff0000':'#00ff00',1);
  assert.equal(ctx.calls.filter(c=>c[0]==='strokeRect').length,0,'nothing stroked yet');
  assert.equal(endImposters(ctx),50);
  assert.equal(ctx.calls.filter(c=>c==='stroke').length,2,'one stroke per colour');assert.equal(ctx.calls.filter(c=>c[0]==='rect').length,50);
  assert.equal(imposterState(ctx),null);assert.equal(ctx.__barunImposters,undefined,'nothing is attached to the context');
  // Without a frame batch the former per-block strokeRect remains.
  const plain=recordingCtx();drawEntity(plain,block('x',1),p=>p,1,'#ff0000',1);assert.equal(plain.calls.filter(c=>c[0]==='strokeRect').length,1);
});

test('boxes inside a clipped block are not deferred outside its clip',()=>{
  const ctx=recordingCtx(),batch=new ImposterBatch();beginImposters(ctx,batch,1);
  const clipped={id:'c',type:'block',clip:{enabled:true,points:[{x:0,y:0},{x:100,y:0},{x:100,y:100}]},entities:[block('inner',1),{type:'line',points:[{x:0,y:0},{x:90,y:90}]}]};
  drawEntity(ctx,clipped,p=>p,1,'#ff0000',1);
  assert.equal(ctx.calls.filter(c=>c[0]==='strokeRect').length,1,'drawn at once inside the clip');assert.equal(batch.count,0);assert.equal(imposterState(ctx).batch,batch,'batch restored after the clipped block');
  endImposters(ctx);
});
