import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';
import {applyDimStyle} from './dimension-style.js';
import {drawEntity} from './view.js';
import {installDimensionExtra,bulgeArc,arcDimensionSpec,buildArcDimension,buildJoggedDimension,buildOrdinateDimension,automaticDimensionBreaks,manualDimensionBreak} from './dimension-extra.js';
const P=(x,y)=>({x,y});
const curve={type:'arc',center:P(0,0),radius:100,startAngle:0,endAngle:90};
const style={name:'TEST',textHeight:10,arrowSize:4,textGap:2,extensionOffset:1,extensionOvershoot:2,scale:2,precision:2,arrowType:'closed-filled',textColor:'#112233',lineColor:'#334455'};
const clean=e=>{const c=structuredClone(e);delete c.id;return c;};
const label=e=>G.dimensionParts(e).find(p=>p.dimensionLabel);
function render(e){
 const calls=[];const canvas=new Proxy({canvas:{width:1000,height:800},measureText:t=>({width:String(t).length*5}),getLineDash:()=>[],setLineDash(){},fillText:t=>calls.push(t),stroke:()=>calls.push('stroke'),fill:()=>calls.push('fill')},{get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>(o[k]=v,true)});
 drawEntity(canvas,e,p=>({x:p.x,y:-p.y}),1,'#9dcbe0',1.4,false,true);assert.ok(calls.length);return calls;
}
function harness({entities=[],picks=[],points=[],formValues=[],settings={},selected=false,origin=null}={}){
 const engine=new DrawingEngine();engine.execute({type:'addMany',entities:entities.map(e=>({...e,layer:'default'}))});const previews=[],pickOptions=[],selection=selected?engine.doc.entities:[];
 const ctx={entities:()=>engine.doc.entities,layers:()=>engine.doc.layers,selected:()=>selection,activeLayer:()=> 'default',getSettings:()=>settings,ucsOrigin:()=>origin,styledDimension:e=>applyDimStyle(e,style),execute:c=>engine.execute(c),ensureLayer:(name,color)=>{const found=engine.doc.layers.find(l=>l.name===name);if(found)return found.id;engine.execute({type:'layer.add',name,color});return engine.doc.layers.at(-1).id;},
 commit:({entities:es})=>engine.execute({type:'addMany',entities:es.map(e=>({...e,layer:e.layer||'default'}))}),
 form:(title,fields,apply)=>apply({value:formValues.shift()}),
 pickEntity:async options=>{pickOptions.push(options);const p=picks.shift();return typeof p==='number'?engine.doc.entities[p]:p??null;},
 pickPoint:async options=>{pickOptions.push(options);const p=points.shift()??null;
  if(p&&!p.option&&options.preview){const before=JSON.stringify(engine.doc),entities=options.preview([],p);assert.ok(entities.length,'drawable preview at '+options.prompt);entities.forEach(render);previews.push(entities);options.preview(P(p.x+1,p.y+1));assert.equal(JSON.stringify(engine.doc),before,'preview leaves document and layers unchanged');}
  return p;
 }
 };
 return {ctx,engine,previews,pickOptions,run:async name=>{const result=await installDimensionExtra(ctx)[name]();engine.validate(engine.doc);return result;}};
}
test('DIMARC uses true arc length, symbol, style scale and primary arc geometry',()=>{
 const d=applyDimStyle(buildArcDimension(arcDimensionSpec(curve),P(150,150)),style),parts=G.dimensionParts(d);
 assert.equal(label(d).text,'⌒ 157.08');assert.equal(label(d).height,20);assert.equal(label(d).color,'#112233');
 assert.equal(parts[0].radius,Math.sqrt(45000));assert.equal(parts[0].endAngle,90);assert.equal(parts[0].color,'#334455');
 const ext=parts[1];assert.equal(ext.points[0].x,102);assert.ok(parts.filter(p=>p.type==='hatch').length===2);
 assert.equal(label({...d,measurementScale:2,text:'L=<>'}).text,'L=⌒ 314.16');
});
test('polyline positive and negative bulges yield the same CCW semicircle measurement',()=>{
 for(const bulge of [1,-1]){const arc=bulgeArc(P(-100,0),P(100,0),bulge);assert.deepEqual(arc.center,P(0,0));assert.equal(arc.radius,100);assert.equal(G.normalizeAngle(arc.endAngle-arc.startAngle),180);}
 const e={type:'polyline',points:[P(-100,0),P(100,0),P(300,0)],bulges:[1,0]};const spec=arcDimensionSpec(e,P(0,-100));assert.equal(label(buildArcDimension(spec,P(0,-150))).text,'⌒ 314.16');
 assert.equal(bulgeArc(P(0,0),P(100,0),0),null);assert.throws(()=>arcDimensionSpec({...e,bulges:[0,0]}),/호/);
});
test('polyline arc selection follows the clicked curved segment and supports vertex bulges',()=>{
 const e={type:'polyline',points:[{x:0,y:0,bulge:1},P(100,0),P(200,0)],bulges:[1,1]};
 assert.deepEqual(arcDimensionSpec(e,P(150,-50)).center,P(150,0));
});
test('clockwise arcs normalize endpoints and preserve major/minor sweep',()=>{
 const spec=arcDimensionSpec({...curve,startAngle:90,endAngle:0,clockwise:true});assert.equal(label(buildArcDimension(spec,P(150,150))).text,'⌒ 157.08');
 assert.equal(label(buildArcDimension(arcDimensionSpec({...curve,endAngle:270}),P(150,150))).text,'⌒ 471.24');
});
test('DIMARC command placement preview equals committed styled dimension on current layer',async()=>{
 const h=harness({picks:[curve],points:[P(150,150)]}),result=await h.run('DIMARC');assert.deepEqual(clean(h.engine.doc.entities[0]),h.previews.at(-1)[0]);assert.equal(result.layer,'default');assert.equal(h.previews.length,1);
});
test('DIMARC M/T/A options and arc leader preserve measurement and final preview',async()=>{
 const h=harness({picks:[curve],points:[{option:'M'},{option:'T'},{option:'A'},{option:'L'},P(200,30),P(150,150)],formValues:['line1\\Pline2','ARC=<>',37]});
 const e=await h.run('DIMARC');assert.equal(e.text,'ARC=<>');assert.equal(e.textRotation,37);assert.deepEqual(e.leaderPoint,P(200,30));assert.equal(e.arcLeader,true);assert.deepEqual(e,h.previews.at(-1)[0]);assert.ok(G.dimensionBaseParts(e).some(p=>p.type==='line'&&G.dist(p.points[0],P(200,30))<G.EPS));
});
test('DIMARC partial option measures projected portion and previews exact final endpoints',async()=>{
 const a=G.polar(200,20),b=G.polar(250,60),h=harness({picks:[curve],points:[{option:'P'},a,b,P(200,200)]});
 const e=await h.run('DIMARC');assert.equal(e.arcPartial,true);assert.equal(label(e).text,'⌒ 69.81');assert.ok(Math.abs(G.dist(...e.points.slice(0,2))-100)<1e-6);assert.deepEqual(e,h.previews.at(-1)[0]);
});
test('DIMARC multiline option and turning the arc leader off work without hover effects',async()=>{
 const h=harness({picks:[curve],points:[{option:'M'},{option:'L'},P(200,30),{option:'L'},P(150,150)],formValues:['first\\Psecond']});const e=await h.run('DIMARC');assert.equal(e.text,'first\nsecond');assert.equal(e.arcLeader,false);assert.equal(e.leaderPoint,undefined);
});
test('DIMJOGGED previews every stage and measures the true radius despite replacement center',async()=>{
 const h=harness({picks:[{type:'circle',center:P(0,0),radius:100}],points:[P(30,20),P(200,0),P(80,20)]});const e=await h.run('DIMJOGGED');assert.equal(h.previews.length,3);assert.equal(e.mode,'jogged');assert.deepEqual(e.points,[P(0,0),P(100,0),P(200,0),P(30,20),P(80,20)]);assert.equal(label(e).text,'R 100');assert.deepEqual(e,h.previews.at(-1)[0]);assert.equal(G.dimensionBaseParts(e).filter(p=>p.dimensionBreakable).length,4);
});
test('DIMJOGGED attaches its arrow to the selected arc even when cursor is outside angular range',()=>{
 const e=buildJoggedDimension(curve,P(30,20),P(-200,0),P(80,20));assert.ok(Math.abs(G.dist(e.points[0],e.points[1])-100)<1e-6);assert.ok(G.angleOnArc(G.angle(e.points[1]),0,90));assert.equal(label(e).text,'R 100');
});
for(const [at,mode,text] of [[P(105,200),'ordinateX','100'],[P(250,55),'ordinateY','50']])test('DIMORDINATE auto chooses '+mode+' and previews styled dogleg',async()=>{
 const h=harness({points:[P(100,50),at]}),e=await h.run('DIMORDINATE');assert.equal(e.mode,mode);assert.equal(label(e).text,text);assert.equal(label(e).height,20);assert.equal(G.dimensionParts(e).filter(p=>p.dimensionBreakable).length,2);assert.deepEqual(e,h.previews.at(-1)[0]);
});
test('DIMORDINATE X/Y/M/T/A options use UCS origin and text rotation without changing measurement',async()=>{
 const h=harness({origin:P(80,40),points:[P(100,50),{option:'X'},{option:'Y'},{option:'M'},{option:'T'},{option:'A'},P(100,200)],formValues:['first','Y=<>',25]}),e=await h.run('DIMORDINATE');assert.equal(e.mode,'ordinateY');assert.equal(e.textRotation,25);assert.equal(label(e).text,'Y=10');assert.deepEqual(e.points[0],P(80,40));assert.deepEqual(e,h.previews.at(-1)[0]);
});
test('ordinate styles, text rotation and rotated axis retain signed values',()=>{
 const d=applyDimStyle(buildOrdinateDimension(P(100,100),P(50,200),P(30,300),'X',{axisAngle:90,textRotation:60}),style);assert.equal(label(d).text,'100');assert.equal(label(d).rotation,60);assert.equal(label({...d,axisAngle:0}).text,'-50');
});
for(const [name,picks,points]of [
 ['DIMARC',[curve],[null]],['DIMARC',[curve],[{option:'P'},P(100,0),null]],
 ['DIMJOGGED',[{type:'circle',center:P(0,0),radius:100}],[P(30,20),P(200,0),null]],
 ['DIMORDINATE',[],[P(100,50),null]],
])test(name+' cancellation creates no dimensions or automatic layer',async()=>{
 const h=harness({picks,points,settings:{dimLayerAuto:true}}),before=JSON.stringify(h.engine.doc);await h.run(name);assert.equal(JSON.stringify(h.engine.doc),before);
});
test('automatic dimension layer is created only at commit and matches final geometry',async()=>{
 const h=harness({picks:[curve],points:[P(150,150)],settings:{dimLayerAuto:true}}),e=await h.run('DIMARC');const layer=h.engine.doc.layers.find(l=>l.name==='A-DIM');assert.ok(layer);assert.equal(e.layer,layer.id);assert.deepEqual(G.dimensionParts(e),G.dimensionParts(h.previews.at(-1)[0]));
});
const linear=()=>({type:'dimension',mode:'horizontal',points:[P(0,0),P(100,0),P(0,50)],textHeight:10,scale:2,arrowSize:4,arrowType:'open',lineColor:'#334455'});
test('automatic breaks split only dimension and extension lines; arrows, labels and colors stay intact',()=>{
 const e=linear(),base=G.dimensionParts(e),cutters=[{type:'line',points:[P(50,0),P(50,100)]},{type:'line',points:[P(-10,25),P(10,25)]}];const breaks=automaticDimensionBreaks(e,cutters,10);assert.equal(breaks.length,2);assert.equal(breaks[0].partIndex,0);assert.deepEqual(breaks[0],{partIndex:0,start:.45,end:.55});
 const parts=G.dimensionParts({...e,breaks});assert.equal(parts.length,base.length+2);assert.deepEqual(parts.filter(p=>!p.dimensionBreakable),base.filter(p=>!p.dimensionBreakable));assert.ok(parts.filter(p=>p.dimensionBreakable).every(p=>p.color==='#334455'));assert.equal(parts[0].points[1].x,45);assert.ok(Math.abs(parts[1].points[0].x-55)<1e-8);
});
test('arc break parameters split the measured arc and merge overlapping ranges',()=>{
 const e=buildArcDimension(arcDimensionSpec(curve),P(150,0)),cutters=[{type:'line',points:[P(0,0),P(200,200)]}],breaks=automaticDimensionBreaks(e,cutters,20);assert.ok(breaks.some(b=>b.partIndex===0));
 const parts=G.dimensionParts({...e,breaks:[{partIndex:0,start:.2,end:.4},{partIndex:0,start:.3,end:.5}]});const arcs=parts.filter(p=>p.type==='arc');assert.deepEqual(arcs.map(p=>[p.startAngle,p.endAngle]),[[0,18],[45,90]]);
});
test('manual breaks project chosen points to a single dimension primitive and preserve earlier breaks',()=>{
 const e=linear(),breaks=manualDimensionBreak(e,P(40,51),P(60,49));assert.deepEqual(breaks,[{partIndex:0,start:.4,end:.6}]);assert.equal(manualDimensionBreak({...e,breaks},P(70,50),P(80,50)).length,2);
});
test('DIMBREAK auto confirms an unchanged-id update matching preview and can undo',async()=>{
 const h=harness({entities:[linear(),{type:'line',points:[P(50,0),P(50,100)]}],picks:[0],points:[{option:'A'},P(0,0)]}),source=clean(h.engine.doc.entities[0]),id=h.engine.doc.entities[0].id;await h.run('DIMBREAK');assert.equal(h.engine.doc.entities[0].id,id);assert.deepEqual(h.engine.doc.entities[0],h.previews.at(-1)[0]);assert.ok(h.engine.doc.entities[0].breaks.length);h.engine.execute({type:'undo'});assert.deepEqual(clean(h.engine.doc.entities[0]),source);
});
test('DIMBREAK manual flow previews exactly the retained manual interval',async()=>{
 const h=harness({entities:[linear()],picks:[0],points:[{option:'MANUAL'},P(40,50),P(60,50),P(0,0)]});await h.run('DIMBREAK');assert.deepEqual(h.engine.doc.entities[0].breaks,[{partIndex:0,start:.4,end:.6}]);assert.deepEqual(h.engine.doc.entities[0],h.previews.at(-1)[0]);
});
test('DIMBREAK multiple selection removes gaps from all dimensions in a single undo',async()=>{
 const e=linear(),breaks=[{partIndex:0,start:.4,end:.6}],h=harness({entities:[{...e,breaks},{...e,points:e.points.map(p=>G.add(p,P(0,100))),breaks}],picks:[0,1,{option:'done'}],points:[{option:'M'},{option:'R'},P(0,0)]});await h.run('DIMBREAK');assert.ok(h.engine.doc.entities.every(e=>e.breaks.length===0));assert.deepEqual(h.engine.doc.entities,h.previews.at(-1));h.engine.execute({type:'undo'});assert.ok(h.engine.doc.entities.every(e=>e.breaks.length===1));
});
test('DIMBREAK cancellation leaves original dimension and break arrays unchanged',async()=>{
 const h=harness({entities:[linear(),{type:'line',points:[P(50,0),P(50,100)]}],selected:true,points:[{option:'A'},null]}),before=JSON.stringify(h.engine.doc);await h.run('DIMBREAK');assert.equal(JSON.stringify(h.engine.doc),before);
});
test('arc leader coordinates transform with the dimension',()=>{
 const e={...buildArcDimension(arcDimensionSpec(curve),P(150,150)),arcLeader:true,leaderPoint:P(200,30)},moved=G.transformEntity(e,p=>G.add(p,P(10,20)));assert.deepEqual(moved.leaderPoint,P(210,50));assert.equal(label(moved).text,label(e).text);
});

test('DIMBREAK hover caches automatic intersections and retains preexisting manual breaks',async()=>{
 const original={...linear(),breaks:[{partIndex:0,start:.1,end:.2}]},h=harness({entities:[original,{type:'line',points:[P(50,0),P(50,100)]}],picks:[0],points:[P(5,5),P(0,0)]});let reads=0;const entities=h.ctx.entities;h.ctx.entities=()=>{reads++;return entities();};await h.run('DIMBREAK');assert.equal(reads,1);assert.deepEqual(h.engine.doc.entities[0].breaks[0],original.breaks[0]);assert.equal(h.engine.doc.entities[0].breaks.length,2);
});
for(const state of ['locked','frozen'])test('DIMBREAK refuses '+state+' layers before previews or updates',async()=>{
 const h=harness({entities:[linear()],picks:[0],points:[{option:'R'},P(0,0)]});h.engine.doc.layers[0][state]=true;const before=JSON.stringify(h.engine.doc);await assert.rejects(h.run('DIMBREAK'),/치수 레이어/);assert.equal(JSON.stringify(h.engine.doc),before);assert.equal(h.previews.length,0);
});
test('DIMBREAK automatic cutters ignore invisible and frozen layers',async()=>{
 const h=harness({entities:[linear(),{type:'line',points:[P(50,0),P(50,100)]}],picks:[0],points:[{option:'A'},P(0,0)]});h.engine.execute({type:'layer.add',name:'hidden',color:'#ffffff'});const layer=h.engine.doc.layers.at(-1);layer.visible=false;h.engine.doc.entities[1].layer=layer.id;await h.run('DIMBREAK');assert.deepEqual(h.engine.doc.entities[0].breaks,[]);
});
test('undefined optional global settings use the current layer safely',async()=>{
 const h=harness({picks:[curve],points:[P(150,150)]});h.ctx.getSettings=()=>undefined;await h.run('DIMARC');assert.equal(h.engine.doc.entities[0].layer,'default');
});

test('DIMARC selects the clicked arc in the imported DXF curved polyline block',async()=>{
 const block={type:'block',name:'DXF 곡선 폴리선',entities:[{type:'line',points:[P(-20,0),P(0,0)]},curve,{...curve,center:P(300,0)}]};
 const h=harness({picks:[{entity:block,point:P(370,70)}],points:[P(450,150)]}),e=await h.run('DIMARC');assert.deepEqual(e.points[0],P(300,0));assert.equal(label(e).text,'⌒ 157.08');assert.deepEqual(e,h.previews.at(-1)[0]);assert.ok(h.pickOptions[0].types.includes('block'));
 assert.throws(()=>arcDimensionSpec({...block,name:'arbitrary block'},P(370,70)),/호/);
});
test('arc dimension reflection reverses normalized arc gaps and swaps extension indices',()=>{
 const e=applyDimStyle(buildArcDimension(arcDimensionSpec(curve),P(150,0)),style);e.breaks=[{partIndex:0,start:.2,end:.4},{partIndex:1,start:.3,end:.5}];
 const mirror=p=>P(-p.x,p.y),reflected=G.transformEntity(e,mirror,{mirror:true});
 assert.deepEqual(reflected.breaks,[{partIndex:0,start:.6,end:.8},{partIndex:2,start:.3,end:.5}]);
 assert.deepEqual(G.dimensionParts(reflected).filter(p=>p.type==='arc').map(p=>[Number(p.startAngle.toFixed(6)),Number(p.endAngle.toFixed(6))]),[[90,144],[162,180]]);
 const signature=p=>p.type==='line'?'L'+p.points.map(q=>[q.x.toFixed(6),q.y.toFixed(6)].join(',')).sort().join(';'):'A'+[p.center.x,p.center.y,p.radius,G.normalizeAngle(p.startAngle),G.normalizeAngle(p.endAngle)].map(v=>v.toFixed(6)).join(',');
 const expected=G.dimensionParts(e).filter(p=>p.dimensionBreakable).map(p=>G.transformEntity(p,mirror,{mirror:true})).map(signature).sort();
 assert.deepEqual(G.dimensionParts(reflected).filter(p=>p.dimensionBreakable).map(signature).sort(),expected);
});
test('arc reflection resolves omitted extensions and preserves leader gap position',()=>{
 const e={...buildArcDimension(arcDimensionSpec(curve),P(100,0)),extensionOffset:0,extensionOvershoot:0,arcLeader:true,leaderPoint:P(150,150),breaks:[{partIndex:0,start:.2,end:.4}]};
 const leaderIndex=G.dimensionBaseParts(e).findIndex(p=>p.type==='line'&&p.dimensionBreakable);e.breaks.push({partIndex:leaderIndex,start:.3,end:.5});
 assert.equal(G.dimensionBaseParts(e).filter(p=>p.dimensionBreakable&&p.type==='line').length,1);
 const reflected=G.transformEntity(e,p=>P(-p.x+20,p.y+30),{mirror:true});assert.equal(reflected.breaks[1].partIndex,leaderIndex);assert.deepEqual(reflected.breaks[1],e.breaks[1]);
 const oldLines=G.dimensionParts(e).filter(p=>p.dimensionBreakable&&p.type==='line').map(p=>p.points.map(p=>P(-p.x+20,p.y+30))),newLines=G.dimensionParts(reflected).filter(p=>p.dimensionBreakable&&p.type==='line').map(p=>p.points);
 for(let i=0;i<oldLines.length;i++)for(let j=0;j<2;j++)assert.ok(G.dist(oldLines[i][j],newLines[i][j])<1e-6);
});
test('DIMBREAK resolves shared INSERT geometry and respects hidden children and clipping',async()=>{
 const h=harness({entities:[linear()],picks:[0],points:[{option:'A'},P(0,0)]});h.engine.execute({type:'layer.add',name:'hidden child',color:'#ffffff'});const hidden=h.engine.doc.layers.at(-1);hidden.visible=false;
 h.engine.doc.version=3;h.engine.doc.sharedBlocks={B:{origin:P(0,0),entities:[
  {id:'visible',type:'line',layer:'default',points:[P(50,0),P(50,100)]},
  {id:'outside',type:'line',layer:'default',points:[P(30,0),P(30,100)]},
  {id:'hidden',type:'line',layer:hidden.id,points:[P(52,0),P(52,100)]}
 ]}};
 h.engine.execute({type:'addMany',entities:[{type:'block',name:'B',sharedBlock:'B',layer:'default',position:P(0,0),rotation:0,scale:1,entities:[],clip:{enabled:true,points:[P(45,-10),P(55,-10),P(55,110),P(45,110)]}}]});h.ctx.doc=()=>h.engine.doc;
 await h.run('DIMBREAK');assert.equal(h.engine.doc.entities[0].breaks.length,1);const cut=h.engine.doc.entities[0].breaks[0];assert.equal(cut.partIndex,0);assert.ok(Math.abs((cut.start+cut.end)/2-.5)<1e-6);assert.deepEqual(h.engine.doc.entities[0],h.previews.at(-1)[0]);assert.equal(h.engine.doc.entities[1].entities.length,0,'canonical shared INSERT remains unexpanded');
});

for(const accepted of [true,false])test('DIMBREAK result dialog '+(accepted?'applies one undoable update':'cancels without a change'),async()=>{
 const h=harness({entities:[linear(),{type:'line',points:[P(50,0),P(50,100)]}],picks:[0],points:[{option:'A'}]});const before=JSON.stringify(h.engine.doc);let proposals;
 h.ctx.confirmDimensionBreak=async changes=>{proposals=changes;assert.equal(JSON.stringify(h.engine.doc),before);assert.ok(changes[0].breaks.length);return accepted;};
 const result=await h.run('DIMBREAK');assert.ok(proposals);
 if(!accepted){assert.equal(result,null);assert.equal(JSON.stringify(h.engine.doc),before);}else{assert.deepEqual(h.engine.doc.entities[0].breaks,proposals[0].breaks);h.engine.execute({type:'undo'});assert.equal(JSON.stringify(h.engine.doc),before);}
});
