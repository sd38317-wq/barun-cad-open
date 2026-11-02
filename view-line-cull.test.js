import test from 'node:test';
import assert from 'node:assert/strict';
import {drawEntity,PREVIEW_DASH} from './view.js';
const point=(x,y)=>({x,y}),box={minX:0,minY:0,maxX:100,maxY:100};
function draw(points,drawBox=box){
 let calls=0;const ctx=new Proxy({}, {get(){return ()=>{calls++;};},set(){calls++;return true;}});
 drawEntity(ctx,{type:'line',points},p=>p,1,'#fff',2.3,false,false,drawBox);return calls;
}
test('offscreen straight segments skip Canvas state and stroke work',()=>{
 for(const points of [[point(-20,1),point(-1,90)],[point(101,1),point(130,90)],[point(1,-2),point(90,-1)],[point(1,101),point(90,105)]])assert.equal(draw(points),0);
});
test('crossing, boundary, reversed and zero-length visible segments remain drawable',()=>{
 for(const points of [[point(-10,50),point(110,50)],[point(100,30),point(100,70)],[point(50,110),point(50,-10)],[point(0,0),point(0,0)]])assert.ok(draw(points)>0);
 assert.ok(draw([point(-20,1),point(-1,90)],null)>0,'no box preserves prior behavior');
});
test('previews are dashed in screen pixels whatever the object linetype scale',()=>{
 const dashes=(e,dashed)=>{const set=[];const ctx=new Proxy({setLineDash(d){set.push([...d]);}},{get(t,k){return k in t?t[k]:()=>{};},set(){return true;}});drawEntity(ctx,e,p=>p,1,'#fff',1.4,dashed);return set;};
 // A copied line of a drawing with LTSCALE 200: 600/500 px dashes hid most of the preview.
 for(const linetypeScale of [1,50,200,.005])assert.deepEqual(dashes({type:'line',points:[point(0,0),point(1800,0)],linetype:'CONTINUOUS',linetypeScale},true),[[...PREVIEW_DASH]]);
 assert.deepEqual(dashes({type:'polyline',points:[point(0,0),point(900,0),point(900,40)],linetypeScale:200},true),[[...PREVIEW_DASH]]);
 // Inside a block the lines keep the same preview dash.
 const block={type:'block',entities:Array.from({length:3},(_,i)=>({type:'line',points:[point(0,i),point(1800,i)],linetypeScale:100+i*50}))};
 assert.ok(dashes(block,true).every(d=>d.join()===PREVIEW_DASH.join()));
 // Ordinary drawing still scales the object's own linetype.
 assert.notDeepEqual(dashes({type:'line',points:[point(0,0),point(10,0)],linetype:'DASHED',linetypeScale:4},false),[[...PREVIEW_DASH]]);
});

test('zero-length lines render as fixed-size points while retaining line endpoints',()=>{
 const calls=[];const ctx=new Proxy({}, {get(_,k){return (...args)=>calls.push([k,...args]);},set(_,k,val){calls.push([k,val]);return true;}});
 const line={type:'line',points:[point(25,30),point(25,30)]};drawEntity(ctx,line,p=>p,1,'#fff',2.3,false,false,box);
 assert.ok(calls.some(([name])=>name==='fillRect'),'zero-length line uses point rasterization');
 assert.deepEqual(line.points,[point(25,30),point(25,30)],'render does not alter snap endpoints');
});
