import test from 'node:test';
import assert from 'node:assert/strict';
import {commitAIChange} from './ai-commit.js';
test('logout while LISP computes blocks the final engine commit',async()=>{
 let loggedIn=true,applied=0,release;
 const context={authorizeAIRequest:async()=>{if(!loggedIn)throw Error('logged out');}};
 const computation=new Promise(r=>release=r);
 const result=(async()=>{await computation;return commitAIChange(context,{id:'external'},()=>{},()=>applied++);})();
 loggedIn=false;release();await assert.rejects(result,/logged out/);assert.equal(applied,0);
});
test('authorization is required and cancellation is checked after reauthorization',async()=>{
 let applied=0,cancelled=false;
 await assert.rejects(commitAIChange({}, {},()=>{},()=>applied++));
 await assert.rejects(commitAIChange({authorizeAIRequest:async()=>{cancelled=true;},assertAIRequest:()=>{if(cancelled)throw Error('cancelled');}}, {},()=>{},()=>applied++),/cancelled/);
 assert.equal(applied,0);
});
test('screen follow runs after an asynchronous commit resolves',async()=>{
 let release,follow=0,applied=false;
 const gate=new Promise(resolve=>{release=resolve;});
 const pending=commitAIChange({authorizeAIRequest:async()=>{},followAIChange:()=>{assert.equal(applied,true);follow++;}}, {},()=>{},async()=>{await gate;applied=true;return 'done';});
 await Promise.resolve();assert.equal(follow,0);release();assert.equal(await pending,'done');assert.equal(follow,1);
});
test('screen follow receives before and after snapshots instead of stale selection',async()=>{
 let entities=[{id:'old'}],change;
 await commitAIChange({authorizeAIRequest:async()=>{},captureAIChange:()=>entities.map(entity=>({entity,signature:JSON.stringify(entity)})),followAIChange:value=>{change=value;}}, {},()=>{},()=>{entities=[{id:'new'}];});
 assert.deepEqual(change.before.map(item=>item.entity.id),['old']);
 assert.deepEqual(change.after.map(item=>item.entity.id),['new']);
});
test('screen follow receives equal snapshots for a read-only commit',async()=>{
 let change;
 await commitAIChange({authorizeAIRequest:async()=>{},captureAIChange:()=>[{entity:{id:'same'},signature:'same'}],followAIChange:value=>{change=value;}}, {},()=>{},()=>{});
 assert.deepEqual(change.before,change.after);
});


import fs from 'node:fs';import vm from 'node:vm';import * as G from './geometry.js';
const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
function followFixture(){
 const fits=[],g={engine:{doc:{entities:[]}},G,aiFollowView:true,mode:'SELECT',phase:'idle',drag:null,busy:false,aiReveal:null,scale:1,origin:{x:0,y:0},fitBox:b=>fits.push(b)};
 vm.createContext(g);vm.runInContext(app.slice(app.indexOf('function captureAIChange()'),app.indexOf('function copySelection(')),g);
 return {g,fits};
}
test('real app follow fits changed result with 10% margin and stops reveal camera',()=>{
 const {g,fits}=followFixture();let stops=0;
 g.engine.doc.entities=[{id:'old',type:'line',points:[{x:0,y:0},{x:10,y:10}]}];const before=g.captureAIChange();
 g.engine.doc.entities=[{id:'new',type:'line',points:[{x:100,y:200},{x:200,y:300}]}];
 g.aiReveal={player:{stopCamera:()=>stops++},finalView:{}};g.busy=true;
 g.followAIChange({before,after:g.captureAIChange(),aiCommit:true});
 assert.equal(stops,1);assert.equal(JSON.stringify(fits[0]),JSON.stringify({minX:90,maxX:210,minY:190,maxY:310}));
});
test('real app follow skips off, command, drag, user busy, and unchanged commits',()=>{
 for(const state of [{aiFollowView:false},{mode:'LINE'},{phase:'point'},{drag:{}},{busy:true}]){
  const {g,fits}=followFixture();Object.assign(g,state);g.engine.doc.entities=[{id:'new',type:'line',points:[{x:0,y:0},{x:10,y:10}]}];g.followAIChange({before:[],after:g.captureAIChange()});assert.equal(fits.length,0);
 }
 const {g,fits}=followFixture();g.engine.doc.entities=[{id:'same',type:'line',points:[{x:0,y:0},{x:10,y:10}]}];const before=g.captureAIChange();g.followAIChange({before,after:g.captureAIChange(),aiCommit:true});assert.equal(fits.length,0);
});
test('real app follow preserves nonenumerable shared-block bounds and in-place edit snapshots',()=>{
 const {g,fits}=followFixture(),shared={id:'block',type:'block',sharedBlock:'test',entities:[],position:{x:100,y:100}};
 Object.defineProperty(shared,'_renderBounds',{value:{minX:100,maxX:500,minY:100,maxY:300},enumerable:false});
 g.engine.doc.entities=[shared];g.followAIChange({before:[],after:g.captureAIChange(),aiCommit:true});
 assert.equal(JSON.stringify(fits[0]),JSON.stringify({minX:60,maxX:540,minY:80,maxY:320}));
 const before=g.captureAIChange();shared.position.x=200;g.engine.doc.entities=[];g.followAIChange({before,after:[],aiCommit:true});assert.equal(fits.length,2);assert.equal(fits[1].minX,60);
});
test('검토 A3·A4: 따라가기를 끄면 아무것도 잡지 않고, 켜도 범위만 비교하며, 아주 많은 객체도 예외 없이 맞춘다',()=>{
 const {g,fits}=followFixture();
 g.aiFollowView=false;g.engine.doc.entities=[{id:'a',type:'line',points:[{x:0,y:0},{x:1,y:1}]}];assert.equal(g.captureAIChange(),null);
 g.aiFollowView=true;const one=g.captureAIChange()[0];assert.equal(one.signature,'0,0,1,1','객체 JSON 이 아니라 범위만');
 const many=200000;g.engine.doc.entities=Array.from({length:many},(_,i)=>({id:'n'+i,type:'line',points:[{x:i,y:0},{x:i+1,y:1}]}));
 g.followAIChange({before:[],after:g.captureAIChange(),aiCommit:true});
 assert.equal(fits.length,1);assert.equal(fits[0].maxX>many,true);
});
