import test from 'node:test';import assert from 'node:assert/strict';
import {createTabletPad,MEMO_LAYER,looksLikeCommand} from './tablet-pad.js';
// 화면 1000×800, 축척 .1(1px = 10mm), 원점 (500,400) → 화면 가운데가 도면 (0,0).
function setup(entities=[],overrides={}){
 const calls=[],layers=[{id:'L0',name:'0'}],doc={entities};
 const host={view:()=>({origin:{x:500,y:400},scale:.1,width:1000,height:800}),screen:p=>({x:500+p.x*.1,y:400-p.y*.1}),editable:()=>doc.entities,
  pick:p=>doc.entities.find(e=>e.points&&Math.hypot(e.points[0].x-p.x,e.points[0].y-p.y)<50),setSelected:ids=>calls.push(['select',ids]),render(){},toast:m=>calls.push(['toast',m]),
  entities:ids=>doc.entities.filter(e=>ids.includes(e.id)),execute:c=>calls.push(['execute',c]),activeLayer:()=>'L0',textHeight:()=>250,
  ensureLayer:name=>{let l=layers.find(l=>l.name===name);if(!l){l={id:'L'+layers.length,name};layers.push(l);}return l.id;},cloud:ring=>({type:'polyline',closed:true,points:ring}),
  architecturalDetail:(command,o)=>({type:'block',category:command==='DOD'?'DOOR':'WINDOW',parameters:o,position:{x:o.x,y:o.y}}),
  parallelWallPair:es=>({u:{x:1,y:0},offset:es[1].points[0].y-es[0].points[0].y,center:[{x:-3000,y:(es[0].points[0].y+es[1].points[0].y)/2},{x:3000,y:(es[0].points[0].y+es[1].points[0].y)/2}]}),
  wallLineOpening:(es,offset,width)=>[{type:'line',points:[{x:0,y:0},{x:1,y:0}],cut:[offset,width]}],
  undo:()=>calls.push(['undo']),commandActive:()=>false,command:t=>calls.push(['command',t]),askAi:t=>{calls.push(['ai',t]);return true;},voice(){},
  pointer:(type,p)=>calls.push([type,Math.round(p.x),Math.round(p.y)]),applyView:e=>calls.push(['view',e]),...overrides};
 return {pad:createTabletPad(host),calls,host,layers};
}
// 도면 좌표(mm) → 패드가 보내는 0~1 좌표
const at=(x,y)=>({x:(500+x*.1)/1000,y:(400-y*.1)/800});
function draw(pad,mode,pts,extra={}){pts.forEach((p,i)=>pad.handle({kind:'point',mode,phase:i===0?'down':i===pts.length-1?'up':'move',...at(p.x,p.y),...extra}));}
const loop=(cx,cy,r,n=24)=>Array.from({length:n+1},(_,i)=>({x:cx+r*Math.cos(2*Math.PI*i/n),y:cy+r*Math.sin(2*Math.PI*i/n)}));
const line=(a,b,n=12)=>Array.from({length:n+1},(_,i)=>({x:a.x+(b.x-a.x)*i/n,y:a.y+(b.y-a.y)*i/n}));
const door={id:'door',type:'line',points:[{x:-300,y:0},{x:300,y:0}]};

test('handwriting strokes close together share one number; marks go to the AI with a guide',()=>{
 const {pad}=setup([door]);draw(pad,'mark',line({x:0,y:0},{x:400,y:0}));draw(pad,'mark',line({x:420,y:0},{x:420,y:400}));draw(pad,'mark',line({x:5000,y:3000},{x:6000,y:3000}));
 const context=pad.context();assert.deepEqual(context.tabletMarks.map(m=>m.number),[1,2]);assert.equal(context.tabletMarks[0].strokes,2);
 assert.ok(context.tabletGuide.includes('objectIds'));assert.ok(!('ink' in context.tabletMarks[0]));
});
test('circle then arrow down previews a 300 move; a typed number changes it; confirm moves and clears',()=>{
 const {pad,calls}=setup([door]);draw(pad,'mark',loop(0,0,600));draw(pad,'mark',line({x:0,y:-650},{x:20,y:-960}));
 assert.equal(pad.info().pending,'1번 아래 300');
 pad.handle({kind:'ask',text:'450'});assert.equal(pad.info().pending,'1번 아래 450');
 pad.handle({kind:'confirm'});assert.deepEqual(calls.find(c=>c[0]==='execute')[1],{type:'move',ids:['door'],dx:0,dy:-450});
 assert.equal(pad.hasMarks,false);assert.equal(pad.info().pending,'');
});
test('ask box: command names and input during a command go to the command line, words go to the AI',()=>{
 let {pad,calls}=setup([door]);draw(pad,'mark',loop(0,0,600));pad.handle({kind:'ask',text:'MOVE'});pad.handle({kind:'ask',text:'1번 지워'});
 assert.deepEqual(calls.filter(c=>['command','ai'].includes(c[0])),[['command','MOVE'],['ai','1번 지워']]);assert.equal(pad.hasMarks,false);
 ({pad,calls}=setup([],{commandActive:()=>true}));pad.handle({kind:'ask',text:'300'});assert.deepEqual(calls.at(-1),['command','300']);
 assert.equal(looksLikeCommand('문 지워'),false);
});
test('draw mode: wobbly stroke becomes a straight line; a door sketch on two wall lines is placed into the wall',()=>{
 const walls=[{id:'w1',type:'line',points:[{x:-3000,y:0},{x:3000,y:0}]},{id:'w2',type:'line',points:[{x:-3000,y:200},{x:3000,y:200}]}];
 let {pad,calls}=setup(walls);draw(pad,'draw',line({x:0,y:1000},{x:1010,y:1030}));pad.flushSketch();
 const added=calls.find(c=>c[0]==='execute')[1];assert.equal(added.type,'addMany');assert.deepEqual(added.entities[0].points.map(p=>Math.round(p.y)),[1000,1000]);
 ({pad,calls}=setup(walls));
 draw(pad,'draw',Array.from({length:31},(_,i)=>{const t=i/30*Math.PI/2;return {x:900*Math.cos(t),y:200+900*Math.sin(t)};}));draw(pad,'draw',line({x:0,y:200},{x:0,y:1100}));pad.flushSketch();
 assert.match(pad.info().pending,/^문 900/);pad.handle({kind:'confirm'});
 const batch=calls.find(c=>c[0]==='execute')[1];assert.equal(batch.type,'batch');assert.equal(batch.commands[0].type,'linewall.place');assert.deepEqual(batch.commands[0].ids,['w1','w2']);
 assert.equal(batch.commands[0].entity.parameters.width,900);
});
test('unknown scribble in draw mode is not added to the drawing; it stays as a pen mark',()=>{
 const {pad,calls}=setup();draw(pad,'draw',Array.from({length:40},(_,i)=>({x:(i%5)*300+(i%3)*90,y:(i%7)*200})));pad.flushSketch();
 assert.ok(!calls.some(c=>c[0]==='execute'));assert.equal(pad.hasMarks,true);
});
test('text box: memo goes on the memo layer with a cloud; drawing text goes on the current layer',()=>{
 const {pad,calls,layers}=setup();pad.handle({kind:'text',...at(1000,1000),text:'창 키워 주세요',as:'memo'});pad.handle({kind:'text',...at(0,0),text:'거실',as:'text'});
 const [memo,text]=calls.filter(c=>c[0]==='execute').map(c=>c[1]);const memoLayer=layers.find(l=>l.name===MEMO_LAYER).id;
 assert.equal(memo.type,'addMany');assert.ok(memo.entities.every(e=>e.layer===memoLayer));assert.equal(memo.entities[0].text,'창 키워 주세요');assert.equal(memo.entities[1].closed,true);
 assert.deepEqual(text.entity,{type:'text',text:'거실',position:{x:0,y:0},height:250,layer:'L0'});
});
test('select mode drives the PC mouse; pen points use the view of the picture they were drawn on (A19)',()=>{
 const {pad,calls}=setup();draw(pad,'select',[{x:0,y:0},{x:1000,y:0},{x:2000,y:0}]);
 assert.deepEqual(calls.map(c=>c[0]),['pointermove','pointerdown','pointermove','pointerup']);assert.deepEqual(calls[1].slice(1),[500,400]);
 pad.rememberFrame(3,{origin:{x:0,y:0},scale:1,width:1000,height:800});pad.handle({kind:'text',x:.1,y:.1,frame:3,text:'A',as:'text'});
 assert.deepEqual(calls.filter(c=>c[0]==='execute').at(-1)[1].entity.position,{x:100,y:-80});
});
test('undo removes the last pen mark first, then undoes the drawing; keep turns marks into memo objects',()=>{
 const {pad,calls,layers}=setup();pad.handle({kind:'text',...at(0,0),text:'A',as:'text'});draw(pad,'mark',line({x:0,y:0},{x:900,y:0}));
 pad.handle({kind:'undo'});assert.equal(pad.hasMarks,false);pad.handle({kind:'undo'});assert.deepEqual(calls.at(-1),['undo']);
 draw(pad,'mark',line({x:0,y:0},{x:900,y:0}));pad.handle({kind:'keep'});const kept=calls.filter(c=>c[0]==='execute').at(-1)[1];
 assert.equal(kept.type,'addMany');assert.deepEqual(kept.entities.map(e=>e.type),['polyline','text']);assert.ok(kept.entities.every(e=>e.layer===layers.find(l=>l.name===MEMO_LAYER).id));assert.equal(pad.hasMarks,false);
});

test('MCP raw sketches survive recognition and AI sending, return copies, and clear with current pad lifetime',()=>{
 const {pad}=setup();
 draw(pad,'draw',line({x:0,y:0},{x:1010,y:30}));const raw=pad.getSketches()[0];pad.flushSketch();
 assert.equal(raw.mode,'draw');assert.equal(pad.getSketches()[0].id,raw.id);
 assert.ok(Math.abs(raw.strokes[0].at(-1).y-30)<1e-6,'원획을 정리된 수평선으로 바꾸지 않는다');
 draw(pad,'mark',line({x:0,y:500},{x:900,y:550}));draw(pad,'mark',line({x:950,y:550},{x:950,y:900}));
 const note=pad.getSketches()[0];assert.equal(note.strokes.length,2);assert.equal(note.number,1);
 pad.handle({kind:'ask',text:'손글씨 읽어 줘'});assert.equal(pad.hasMarks,false);assert.equal(pad.getSketches()[0].id,note.id);
 note.strokes[0][0].x=987654;assert.notEqual(pad.getSketches()[0].strokes[0][0].x,987654);
 pad.clearMarks();assert.deepEqual(pad.getSketches(),[]);
 draw(pad,'draw',line({x:0,y:0},{x:1000,y:0}));pad.reset();pad.flushSketch();assert.deepEqual(pad.getSketches(),[]);
});
test('recent sketch memory is bounded and undone pen strokes disappear from the read list',()=>{
 const {pad}=setup();
 for(let i=0;i<12;i++){draw(pad,'draw',line({x:i*1000,y:0},{x:i*1000+900,y:0}));pad.flushSketch();}
 assert.equal(pad.getSketches().length,10);
 for(let i=0;i<140;i++)draw(pad,'mark',line({x:0,y:1000},{x:500,y:1000}));
 const note=pad.getSketches()[0];assert.equal(note.strokes.length,128);assert.equal(note.truncated,true);
 pad.handle({kind:'undo'});assert.equal(pad.getSketches()[0].strokes.length,127);
 pad.reset();
});
