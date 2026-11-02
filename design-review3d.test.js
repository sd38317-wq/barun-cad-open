import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewModel,disposeReviewModel,exportReviewGLB} from './review-3d.js';
import {snapPushPullDistance} from './design-push-pull-ui.js';

const model=()=>({stories:[{id:'s1',name:'1F',elevation:0,height:3000},{id:'s2',name:'2F',elevation:3000,height:3200}],elements:[
 {id:'w1',kind:'wall',story:'s1',path:[[0,0],[5000,0]],thickness:200,exterior:true,outwardNormal:[0,-1]},
 {id:'w2',kind:'wall',story:'s2',path:[[0,0],[5000,0]],thickness:200,exterior:true,outwardNormal:[0,-1]},
 {id:'slab',kind:'slab',story:'s1',outline:[[0,0],[5000,0],[5000,4000],[0,4000]],thickness:200},
 {id:'roof',kind:'slab',story:'s2',role:'roof',topOffset:3200,outline:[[0,0],[5000,0],[5000,4000],[0,4000]],thickness:200}
]});
const doc=()=>({layers:[],entities:[{type:'line',points:[{x:999999,y:999999},{x:1000000,y:1000000}]}],drawingSets:{A:{model:model()},B:{model:{stories:[{id:'other',name:'3F',elevation:10000,height:4000}],elements:[{id:'wb',kind:'wall',story:'other',path:[[0,0],[2000,0]],thickness:200}]}}}});
test('review uses drawingSet model rather than drawing lines and selects exact set',()=>{
 const d=doc(),before=JSON.stringify(d),a=buildReviewModel(d,{setId:'A'}),b=buildReviewModel(d,{setId:'B'});
 try{assert.equal(a.wallCount,2);assert.ok(a.box.max.x<=5.2);assert.ok(Math.abs(a.box.max.y-6.2)<1e-5);assert.ok(Math.abs(b.box.max.y-14)<1e-5);assert.equal(JSON.stringify(d),before);assert.throws(()=>buildReviewModel(d,{setId:'missing'}));}finally{disposeReviewModel(a.group);disposeReviewModel(b.group);}
});
test('default set and floor filters share the JSON builder',()=>{
 const d=doc(),a=buildReviewModel(d),b=buildReviewModel(d,{setId:'A',floors:['2F']});
 try{assert.equal(a.wallCount,2);assert.equal(b.wallCount,1);assert.ok(b.box.min.y>=3);assert.deepEqual(b.floors,['2F']);}finally{disposeReviewModel(a.group);disposeReviewModel(b.group);}
});
test('drag snaps to 10mm and exact nearby existing values including original',()=>{
 assert.equal(snapPushPullDistance(126),130);assert.equal(snapPushPullDistance(-126),-130);assert.equal(snapPushPullDistance(4),0);assert.equal(snapPushPullDistance(42,[43]),43);assert.throws(()=>snapPushPullDistance(Infinity));
});
test('GLB exports design geometry through the shared review path',async()=>{
 const old=globalThis.FileReader;globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();});}};
 try{const d=doc(),before=JSON.stringify(d),bytes=await exportReviewGLB(d,{setId:'B'}),view=new DataView(bytes);assert.equal(view.getUint32(0,true),0x46546c67);assert.equal(view.getUint32(8,true),bytes.byteLength);assert.equal(JSON.stringify(d),before);}finally{globalThis.FileReader=old;}
});
