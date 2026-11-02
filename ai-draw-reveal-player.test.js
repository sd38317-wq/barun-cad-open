import test from 'node:test';
import assert from 'node:assert/strict';
import {revealDisplayEntities, revealTimeline, createRevealPlayer} from './ai-draw-reveal-player.js';
import {planReveal} from './ai-draw-reveal.js';

const line=(id,x=0,y=0)=>({id,type:'line',layer:'wall',points:[{x,y},{x:x+10,y}]});
const layer={id:'wall',name:'A-WALL-CONC',visible:true,color:'#123456',linetype:'CENTER',lineweight:.7};
test('display flattening preserves INSERT identity, layer styles and clipping without touching saved geometry',()=>{
 const entity={id:'insert',type:'block',layer:'wall',entities:[line('a')],clip:{enabled:true,points:[{x:0,y:0},{x:5,y:0},{x:5,y:5}]}};
 const doc={entities:[entity],layers:[layer]},before=JSON.stringify(doc);
 const [shown]=revealDisplayEntities(doc,doc.entities);
 assert.equal(shown.sourceId,'insert');assert.equal(shown.sourceType,'block');
 assert.equal(shown.layerName,'A-WALL-CONC');assert.equal(shown._displayColor,layer.color);
 assert.equal(shown._displayLinetype,'CENTER');assert.equal(shown._displayLineweight,.7);
 assert.equal(shown.clipMasks[0],entity.clip);assert.equal(JSON.stringify(doc),before);
});
test('layer 0 children inherit the INSERT layer for reveal classification',()=>{
 const zero={id:'zero',name:'0',visible:true,color:'#fff',linetype:'CONTINUOUS'};
 const insert={id:'insert',type:'block',layer:'wall',entities:[{...line('a'),layer:'zero'}]};
 const shown=revealDisplayEntities({entities:[insert],layers:[{...layer,linetype:'CONTINUOUS'},zero]},[insert]);
 assert.equal(shown[0].layerName,'A-WALL-CONC');assert.equal(planReveal(shown).clusters[0].stages[0].key,'structure');
});
test('large shared INSERT is rejected before materializing its children',()=>{
 const ref={id:'big',type:'block',layer:'wall',sharedBlock:'huge'};
 const doc={entities:[ref],layers:[layer],sharedBlocks:{huge:{origin:{x:0,y:0},entities:Array.from({length:4001},(_,i)=>line(String(i)))}}};
 assert.equal(revealDisplayEntities(doc,doc.entities),null);
});
test('timeline groups only within phases, covers each object and respects 40ms and 18s',()=>{
 const items=Array.from({length:4000},(_,i)=>({...line(String(i),i,0),sourceId:'block',sourceType:'block'}));
 const plan=planReveal(items),timeline=revealTimeline(plan);
 assert.equal(plan.durationMs,18000);assert.equal(timeline.flatMap(t=>t.items).length,4000);
 assert.equal(new Set(timeline.flatMap(t=>t.items)).size,4000);
 assert.ok(timeline.every(t=>t.endMs-t.startMs>=40-1e-8));
 assert.ok(timeline.some(t=>t.items.length>1));assert.ok(timeline.at(-1).endMs<=18000);
});

test('sparse and dense clusters each retain the base 3.2 second budget',()=>{
 const clusters=[100,1].map((count,index)=>({bounds:{minX:index*100,minY:0,maxX:index*100+10,maxY:10},stages:[{key:'layers',label:'선',items:Array.from({length:count},(_,i)=>line(index+':'+i))}]}));
 const timeline=revealTimeline({clusters,total:101,durationMs:6400});
 assert.equal(timeline.filter(t=>t.clusterIndex===0).at(-1).endMs,3200);
 assert.equal(timeline.filter(t=>t.clusterIndex===1)[0].startMs,3200);
 assert.equal(timeline.at(-1).endMs,6400);
 assert.ok(timeline.every(t=>t.endMs-t.startMs>=40-1e-8));
});

function fixture({outside=false,durationMs=3200,clip=false,plan:customPlan,view:initialView,destroyOnFinish=true}={}){
 let view={scale:12,origin:{x:100,y:300},width:800,height:600,fitHeight:600,pixelRatio:1,...initialView};
 const draws=[],contexts=[],frames=new Map(),progress=[],phases=[];let next=0,finished=0,renderCount=0;
 function context(name){const log=[];contexts.push(log);return {name,log,
  setTransform(...v){log.push(['transform',...v]);},save(){},restore(){},drawImage(){},beginPath(){},
  moveTo(){},lineTo(){},stroke(){},arc(){},fill(){},setLineDash(){},rect(){},closePath(){},clip(rule){log.push(['clip',rule]);}};}
 const ctx=context('main'),cacheCtx=context('cache'),cache={width:0,height:0,getContext:()=>cacheCtx};
 const items=[line('a',outside?2000:0),line('b',outside?2010:20),{id:'text',type:'text',layer:'wall',position:{x:outside?2020:40,y:0},height:10,text:'완료'}];
 if(clip)items[0].clipMasks=[{points:[{x:0,y:0},{x:1,y:0},{x:1,y:1}]}];
 const plan=customPlan||{clusters:[{bounds:{minX:outside?2000:0,minY:0,maxX:outside?2040:50,maxY:10},stages:[
  {key:'layers',label:'마감층',items:items.slice(0,2)},{key:'text',label:'문자',items:items.slice(2)}]}],total:3,durationMs};
 let player;
 player=createRevealPlayer({plan,stage:{setPhases:p=>phases.push(p),push:p=>phases.push(p),setProgress:(d,t)=>progress.push([d,t])},
  getView:()=>view,setView:v=>{view={...view,...v};},createCanvas:()=>cache,
  draw:(target,e)=>draws.push({target:target.name,entity:e}),render:()=>renderCount++,
  requestFrame:fn=>{const id=++next;frames.set(id,fn);return id;},cancelFrame:id=>frames.delete(id),
  onFinish:()=>{finished++;if(destroyOnFinish)player.destroy();}});
 function advance(stamp){const [id,fn]=frames.entries().next().value||[];assert.ok(fn,'RAF scheduled');frames.delete(id);fn(stamp);}
 return {player,advance,ctx,draws,cacheCtx,frames,progress,phases,get view(){return view;},get finished(){return finished;},get renderCount(){return renderCount;}};
}
test('completed ink is cached between frames and rebuilt only when the view changes',()=>{
 const f=fixture();f.advance(0);f.player.paint(f.ctx);f.advance(1200);f.player.paint(f.ctx);
 const count=()=>f.draws.filter(d=>d.target==='cache').length;
 assert.equal(count(),1);f.player.paint(f.ctx);assert.equal(count(),1);
 f.view.origin.x+=10;f.player.paint(f.ctx);assert.equal(count(),2);f.player.destroy();
 assert.equal(f.frames.size,0);
});
test('RAF throttles render requests, reports phases and shows text as a whole object',()=>{
 const f=fixture();f.advance(0);f.advance(10);f.advance(20);assert.equal(f.renderCount,1);
 f.advance(40);assert.equal(f.renderCount,2);
 f.advance(2200);f.player.paint(f.ctx);
 assert.equal(f.draws.some(d=>d.entity.type==='text'),false);
 f.advance(3200);assert.equal(f.finished,1);assert.equal(f.frames.size,0);
 assert.ok(f.phases.some(p=>p.phase==='text'));assert.ok(f.progress.every(([d,t])=>d<=t));
});
test('manual navigation cancels only camera motion; reveal continues to completion',()=>{
 const f=fixture({outside:true});f.advance(0);f.advance(250);
 assert.notEqual(f.view.scale,1);f.player.stopCamera();const view=JSON.stringify(f.view);
 f.advance(900);assert.equal(JSON.stringify(f.view),view);assert.equal(f.player.followCamera,false);
 f.advance(3200);assert.equal(f.finished,1);
});
test('an adequately large single cluster keeps its initial view; flights stay inside duration cap',()=>{
 const visible=fixture();visible.advance(0);visible.advance(1000);assert.equal(visible.view.scale,12);visible.player.destroy();
 const f=fixture({outside:true,durationMs:18000});f.advance(0);f.advance(500);f.advance(17500);
 if(!f.finished)f.advance(18000);assert.equal(f.finished,1);assert.equal(f.frames.size,0);
});
test('both partial and accumulated INSERT ink apply its XCLIP mask',()=>{
 const f=fixture({clip:true});f.advance(0);f.player.paint(f.ctx);assert.ok(f.ctx.log.some(x=>x[0]==='clip'));
 f.advance(1200);f.player.paint(f.ctx);assert.ok(f.cacheCtx.log.some(x=>x[0]==='clip'));f.player.destroy();
});

test('far clusters retreat for 40 percent then approach with ink in 700ms; nearby clusters fly directly',()=>{
 for(const gap of [110,1000]){
  const boxes=[{minX:0,minY:0,maxX:100,maxY:100},{minX:gap,minY:0,maxX:gap+100,maxY:100}];
  const plan={durationMs:6400,total:2,clusters:boxes.map((bounds,i)=>({bounds,
   stages:[{key:'layers',label:'선',items:[{...line(String(i),bounds.minX),points:[{x:bounds.minX,y:0},{x:bounds.maxX,y:100}]}]}]}))};
  const f=fixture({plan,view:{scale:.5,origin:{x:100,y:300}}});
  f.advance(0);f.advance(500);const firstScale=f.view.scale;
  f.advance(600);f.player.paint(f.ctx);assert.ok(f.draws.some(d=>d.entity.id==='0'));
  const departure=2850;f.advance(departure);const boundary=f.player.progress;
  f.advance(departure+280);assert.equal(f.player.progress,boundary,'ink clock pauses during the flight');
  if(gap===1000){
   const v=f.view;
   assert.ok(v.scale<firstScale/2,'shared overview zooms out');
   for(const box of boxes){assert.ok(box.minX*v.scale+v.origin.x>=800*.08-1e-6);assert.ok(box.maxX*v.scale+v.origin.x<=800*.92+1e-6);}
   f.player.paint(f.ctx);assert.ok(f.draws.some(d=>d.entity.id==='1'),'first incoming stroke appears in the shared overview');
   for(let elapsed=320;elapsed<660;elapsed+=40){
    f.advance(departure+elapsed);f.player.paint(f.ctx);
    const box=boxes[1],v=f.view;
    assert.ok(box.maxX*v.scale+v.origin.x>0&&box.minX*v.scale+v.origin.x<800,'incoming ink remains in view');
    assert.equal(v.moving,true);
   }
   f.advance(departure+700);assert.equal(f.view.moving,false);assert.ok(Math.abs(f.view.scale-firstScale)<1e-9);
  }else{
   assert.ok(Math.abs(f.view.scale-firstScale)<1e-9,'nearby flight does not retreat');
   f.advance(departure+500);assert.equal(f.view.moving,false);
  }
  f.advance(5900);f.advance(6400);assert.equal(f.finished,1);assert.equal(f.frames.size,0);
  assert.ok(f.view.scale<firstScale,'completion fits all details');
 }
});
test('camera fitting, contains and final retreat share the measured top and 8 percent margins',()=>{
 const box={minX:0,minY:0,maxX:500,maxY:1000};
 const plan={durationMs:3200,total:1,clusters:[{bounds:box,stages:[{key:'layers',label:'선',items:[{id:'box',type:'polyline',points:[{x:0,y:0},{x:500,y:0},{x:500,y:1000},{x:0,y:1000}],closed:true}]}]}]};
 const f=fixture({plan,view:{height:800,fitHeight:650,revealTop:90,origin:{x:100,y:80}}});
 f.advance(0);f.advance(500);
 const v=f.view;
 assert.ok(Math.abs(v.origin.y-box.maxY*v.scale-90)<1e-6);
 assert.ok(Math.abs(v.origin.y-box.minY*v.scale-(650-800*.08))<1e-6);
 assert.ok(box.minX*v.scale+v.origin.x>=800*.08);
 assert.ok(box.maxX*v.scale+v.origin.x<=800*.92);
 f.advance(2700);if(!f.finished)f.advance(3200);assert.equal(f.finished,1);
 assert.ok(Math.abs(f.view.scale-v.scale)<1e-6,'retreat uses the same safe rectangle');
 const safe=fixture({plan,view:{...v,origin:{...v.origin}}});safe.advance(0);safe.advance(500);
 assert.equal(safe.view.scale,v.scale,'contains accepts the fitted viewport');safe.player.destroy();
 const unsafe=fixture({plan,view:{...v,origin:{...v.origin,y:v.origin.y-1}}});unsafe.advance(0);unsafe.advance(500);
 assert.ok(Math.abs(unsafe.view.origin.y-v.origin.y)<1e-6,'contains rejects ink under the top margin');unsafe.player.destroy();
});

test('initial camera settles before any partial ink or pen is shown, within the same duration cap',()=>{
 const f=fixture({outside:true});
 for(const stamp of [0,100,250,450]){f.advance(stamp);f.player.paint(f.ctx);assert.equal(f.draws.length,0);}
 f.advance(500);f.player.paint(f.ctx);assert.ok(f.draws.length>0);
 f.advance(2700);assert.equal(f.finished,1);assert.equal(f.frames.size,0);
});

test('top-level block ceiling is checked before accessing block children',()=>{
 const blocks=Array.from({length:13},(_,i)=>({id:String(i),type:'block',layer:'wall',get entities(){throw new Error('expanded');}}));
 assert.equal(revealDisplayEntities({layers:[layer],entities:blocks},blocks),null);
 assert.equal(revealDisplayEntities({layers:[layer],entities:blocks},[...blocks.slice(0,12),line('extra')]),null);
});

test('twelve camera flights and final retreat fit the 18 second ceiling without clock drift',()=>{
 const plan={durationMs:18000,total:12,clusters:Array.from({length:12},(_,i)=>({
  bounds:{minX:i*1000,minY:0,maxX:i*1000+100,maxY:100},
  stages:[{key:'layers',label:'선',items:[line(String(i),i*1000)]}]}))};
 const f=fixture({plan});
 for(let stamp=0;stamp<=18000&&!f.finished;stamp+=50)f.advance(stamp);
 assert.equal(f.finished,1);assert.equal(f.frames.size,0);
});

test('natural completion cancels its RAF even when onFinish only observes completion',()=>{
 const f=fixture({destroyOnFinish:false});f.advance(0);f.advance(3200);
 assert.equal(f.finished,1);assert.equal(f.frames.size,0);f.player.destroy();assert.equal(f.frames.size,0);
});

test('final camera ignores invalid entity geometry and merges only valid cluster bounds',()=>{
 const entities=[0,1000].flatMap((x,i)=>[
  {id:'box'+i,type:'rectangle',sourceId:i,sourceType:'block',points:[{x,y:0},{x:x+100,y:0},{x:x+100,y:100},{x,y:100}]},
  {id:'bad'+i,type:'line',sourceId:i,sourceType:'block',points:[{x:NaN,y:0},{x:Infinity,y:0}]}
 ]);
 const plan=planReveal(entities),f=fixture({plan});
 for(let stamp=0;stamp<=plan.durationMs&&!f.finished;stamp+=50)f.advance(stamp);
 assert.equal(f.finished,1);assert.equal(f.frames.size,0);
 assert.ok([f.view.scale,f.view.origin.x,f.view.origin.y].every(Number.isFinite));
 assert.ok(1100*f.view.scale+f.view.origin.x<=800*.92+1e-6);
 assert.ok(f.view.origin.x>=800*.08-1e-6);
});
test('a non-path first slot shows whole text or ellipse immediately upon camera arrival',()=>{
 const entities=[{id:'text',type:'text',position:{x:5000,y:0},height:10,text:'도착'},
  {id:'ellipse',type:'ellipse',center:{x:5050,y:50},majorAxis:{x:50,y:0},ratio:1}];
 for(const entity of entities){
  const plan=planReveal([entity]),f=fixture({plan});
  f.player.paint(f.ctx);assert.equal(f.draws.length,0,'no ink before the first camera tick');
  for(const stamp of [0,250,450]){f.advance(stamp);f.player.paint(f.ctx);assert.equal(f.draws.length,0,'flight hides new ink');}
  f.advance(500);f.player.paint(f.ctx);
  assert.ok(f.draws.some(d=>d.entity===entity),'arrival shows the complete non-path object without a blank interval');
  f.player.destroy();assert.equal(f.frames.size,0);
 }
});

test('a nearby tiny cluster keeps its direct flight and shows incoming ink before zooming past the previous drawing',()=>{
 const entities=[{...line('old'),sourceId:'old',sourceType:'block',points:[{x:0,y:0},{x:100,y:100}]},
  {...line('tiny'),sourceId:'tiny',sourceType:'block',points:[{x:102,y:50},{x:103,y:51}]}];
 const f=fixture({plan:planReveal(entities),view:{scale:.5,origin:{x:100,y:300}}});
 f.advance(0);f.advance(500);f.advance(600);f.advance(2850);
 const departureScale=f.view.scale;
 for(const elapsed of [100,250,400,500]){
  f.advance(2850+elapsed);f.draws.length=0;f.player.paint(f.ctx);
  assert.ok(f.view.scale>=departureScale,'direct approach never zooms out');
  assert.ok(f.draws.some(d=>d.entity.id==='tiny'),'incoming ink is painted during the direct flight');
  assert.equal(f.view.moving,elapsed<500);
 }
 f.player.destroy();assert.equal(f.frames.size,0);
});
