import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DrawingEngine} from './engine.js';
import * as G from './geometry.js';
import {drawEntity} from './view.js';
import {dimensionPreview,pickDimensionPlacement,installDimensionEditing} from './dimension-preview.js';
import {installDimTools4} from './dim-tools-4.js';
import {installDimSymbolTools} from './dim-symbol-tools.js';
import {installDimSequence} from './dim-sequence.js';
import {installMleaderTools} from './mleader-tools.js';
import {installSmartDim} from './smart-dim.js';
import {applyDimStyle,getDimStyle} from './dimension-style.js';
import {COMMANDS,resolveCommand,defaultAliases} from './commands.js';
const P=(x,y)=>({x,y});
const dim=(y=200)=>({type:'dimension',mode:'horizontal',textHeight:100,arrowType:'filled',points:[P(0,0),P(1000,0),P(0,y)]});
const line=(x)=>({type:'line',points:[P(x,0),P(x,1000)]});
const clean=e=>{const copy=structuredClone(e);for(const k of ['id','layer'])delete copy[k];if(copy.entities)copy.entities=copy.entities.map(clean);return copy;};
function renderer(entity){
 const calls=[];
 const canvas=new Proxy({canvas:{width:1000,height:800},measureText:t=>({width:String(t).length*10}),getLineDash:()=>[],setLineDash(){},fillText:t=>calls.push(['text',t]),stroke:()=>calls.push(['stroke']),fill:()=>calls.push(['fill'])},{get:(obj,k)=>k in obj?obj[k]:()=>{},set:(obj,k,v)=>(obj[k]=v,true)});
 drawEntity(canvas,entity,p=>({x:p.x,y:-p.y}),1,'#9dcbe0',1.4,false,true);
 assert.ok(calls.length,'renderer executes draw operations');return calls;
}
function harness({entities=[],points=[],picks=[],path=null}={}){
 const engine=new DrawingEngine(),selection=new Set(),previews=[],errors=[],storage=new Map();let apply,fields=[];
 const ids=engine.execute({type:'addMany',entities:entities.map(e=>({...e,layer:'default'}))});ids.forEach(id=>selection.add(id));
 const ctx={entities:()=>engine.doc.entities,layers:()=>engine.doc.layers,selected:()=>engine.doc.entities.filter(e=>selection.has(e.id)),activeLayer:()=> 'default',num:(k,d)=>d,getSettings:()=>({denominator:100,paperTextHeight:2.5}),styledDimension:e=>applyDimStyle(e,getDimStyle(engine.doc)),storage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},toast:(m,error)=>{if(error)errors.push(m);},userErrorMessage:e=>e.message,execute:c=>engine.execute(c),setSelected(){},ensureLayer:(name,color)=>{const found=engine.doc.layers.find(l=>l.name===name);if(found)return found.id;engine.execute({type:'layer.add',name,color});return engine.doc.layers.at(-1).id;},
  commit:({removeIds=[],entities:list})=>engine.execute({type:'batch',commands:[...(removeIds.length?[{type:'delete',ids:removeIds}]:[]),{type:'addMany',entities:list.map(e=>({...e,layer:e.layer||'default'}))}]}),
  form:(title,f,callback)=>{fields=f;apply=callback;},
  pickEntity:async()=>{const next=picks.shift();return typeof next==='number'?engine.doc.entities[next]:next||null;},
  pickPoint:async options=>{const p=points.shift()??null;if(p&&!Object.hasOwn(p,'option')&&options?.preview){const before=JSON.stringify(engine.doc);const preview=options.preview([],p);assert.ok(preview.length,'complete preview for '+options.prompt);for(const e of preview){assert.ok(['dimension','block','text','line','polyline','hatch','circle','arc'].includes(e.type),'preview contains drawable entity');renderer(e);}options.preview([],P(p.x+17,p.y+19));assert.equal(JSON.stringify(engine.doc),before,'hover cannot mutate document or layers');previews.push({prompt:options.prompt,entities:preview});}return p;},
  pickPath:async options=>{if(path&&options.preview){const before=JSON.stringify(engine.doc),preview=options.preview(path.slice(0,-1),path.at(-1));assert.ok(preview.length);preview.forEach(renderer);assert.equal(JSON.stringify(engine.doc),before);}return path?{points:path}:null;},
 };
 return {ctx,engine,previews,errors,storage,async apply(v={}){const values={...Object.fromEntries(fields.map(f=>[f.name,f.value])),...v};return apply?.(values);},last:()=>previews.at(-1)?.entities};
}
const drain=()=>new Promise(resolve=>setTimeout(resolve,25));
async function card(install,name,config,values={}){
 const h=harness(config),before=h.engine.doc.entities.length;install(h.ctx)[name]();await h.apply(values);await drain();assert.deepEqual(h.errors,[]);h.engine.validate(h.engine.doc);return {...h,before};
}
test('shared preview handles both picker contracts and rejects invalid geometry without effects',()=>{
 let called=0;const f=dimensionPreview(p=>{called++;return dim(p.y);});assert.deepEqual(f([],P(10,20)),f(P(10,20)));assert.deepEqual(f([],null),[]);assert.deepEqual(f(P(NaN,0)),[]);assert.equal(called,2);assert.deepEqual(dimensionPreview(()=>{throw Error('degenerate');})(P(0,0)),[]);
});
for(const mode of ['horizontal','vertical'])test('DQ '+mode+' chain and total preview equals the full committed set',async()=>{
 const h=await card(installDimTools4,'DQ',{entities:[line(0),line(1000)],points:[P(1500,1200),P(1700,1500)]},{mode,totalMode:'always'});
 assert.equal(h.previews.length,2);assert.deepEqual(h.last().map(clean),h.engine.doc.entities.slice(h.before).map(clean));assert.ok(h.last().every(e=>e.type==='dimension'));
});
for(const mode of ['sum','step','each','side','new','chain'])test('CC '+mode+' placement preview equals committed dimensions',async()=>{
 const entities=mode==='chain'?[line(0),line(1000)]:[dim()];
 const points={sum:[P(2000,0),null],step:[P(2000,0),null],each:[P(0,0),P(2000,0),null],side:[P(0,800)],new:[P(0,0),P(2000,0),P(0,800),null],chain:[P(0,800)]}[mode];
 const h=await card(installDimTools4,'CC',{entities,points,picks:[0]},{mode,gap:300,distance:300});
 assert.deepEqual(h.last().map(clean),h.engine.doc.entities.slice(h.before).map(clean));
});
test('LX disabled angle snap keeps the exact leader, arrow and user text',async()=>{
 const h=await card(installDimTools4,'LX',{points:[P(0,0),P(700,413)]},{text:'사용자 마감',angleSnap:undefined,endShape:'arrow'});
 assert.deepEqual(h.last().map(clean),h.engine.doc.entities.map(clean));assert.equal(h.last().find(e=>e.type==='text').text,'사용자 마감');
});
for(const name of ['DG','DLL'])test(name+' editing result is a complete dimension preview',async()=>{
 const points=name==='DG'?[P(0,600)]:[P(0,0),P(100,200)];
 const h=await card(installDimTools4,name,{entities:[dim(),dim(400)],points},{mode:'points',scaleBasis:'line',gap:120,oneLine:undefined});
 assert.deepEqual(h.last().map(clean),h.engine.doc.entities.map(clean));
});
test('SD previews all accumulated splits with the same projected axis as commit',async()=>{
 const source=dim();source.points[1]=P(1000,700);
 const h=await card(installDimTools4,'SD',{entities:[source],points:[P(250,100),P(650,900),null]},{mode:'points'});
 assert.equal(h.last().length,3);assert.deepEqual(h.last().map(clean),h.engine.doc.entities.map(clean));
});
for(const name of ['DTM','DLA'])test(name+' text or extension placement preview equals the update',async()=>{
 const h=await card(installDimSymbolTools,name,{entities:[dim()],points:name==='DTM'?[P(900,500)]:[P(0,-200),P(1000,-200)]},{mode:'single',distance:350});
 assert.deepEqual(h.last().map(clean),h.engine.doc.entities.map(clean));
});
test('DTO distance previews actual auxiliary text before committing',async()=>{
 const h=await card(installDimSymbolTools,'DTO',{entities:[dim()],points:[P(0,0),P(300,400)]},{mode:'distance',offset:200});
 assert.deepEqual(h.last().map(clean),h.engine.doc.entities.slice(h.before).map(clean));
});
test('TL text leader placement previews the whole inserted geometry',async()=>{
 const h=harness({entities:[{type:'text',position:P(500,500),height:150,text:'주석'}],points:[P(0,0)],picks:[0]});const before=h.engine.doc.entities.length;await installDimSymbolTools(h.ctx).TL();await drain();assert.deepEqual(h.errors,[]);
 assert.deepEqual(h.last().map(clean),h.engine.doc.entities.slice(before).map(clean));
});
test('IL intersection dimension uses the final dimension in the cursor preview',async()=>{
 const h=harness({entities:[line(0),line(1000)],points:[P(-100,500),P(1100,500),P(500,800)],picks:[0,1]});const before=h.engine.doc.entities.length;await installDimSymbolTools(h.ctx).IL();await drain();assert.deepEqual(h.errors,[]);
 assert.deepEqual(h.last().map(clean),h.engine.doc.entities.slice(before).map(clean));
});
for(const direction of ['pick','right','up'])test('DIMSEQ '+direction+' previews all dimensions at its placement stage',async()=>{
 const h=harness({points:direction==='pick'?[P(10,20),P(1000,20)]:[P(10,20)]});installDimSequence(h.ctx).DIMSEQ();await h.apply({direction,spacings:'1000,2000',total:true});
 assert.deepEqual(h.last().map(clean),h.engine.doc.entities.map(clean));assert.equal(h.last().length,3);
});
test('MLEADER final placement retains arrow anchor and previews configured block exactly',async()=>{
 const h=harness({path:[P(0,0),P(800,500),P(1000,500)],points:[P(1400,900)]});await installMleaderTools(h.ctx).MLEADER();await h.apply({m1:'',custom:'최종 재료\n두 번째 줄',arrow:'open',attach:'middle',scale:50});
 assert.deepEqual(h.last().map(clean),h.engine.doc.entities.map(clean));assert.deepEqual(h.last()[0].entities[0].points[0],P(0,0));assert.match(h.last()[0].entities.find(e=>e.type==='text').text,/최종 재료/);
});
test('MLEADER canceling final placement leaves no entities or remembered settings',async()=>{
 const h=harness({path:[P(0,0),P(1000,500)],points:[null]});await installMleaderTools(h.ctx).MLEADER();await h.apply();assert.equal(h.engine.doc.entities.length,0);assert.equal(h.storage.size,0);
});
for(const shape of ['circle','vertex'])test('DIMANGULAR '+shape+' endpoint and placement previews persist exactly',async()=>{
 const entity=shape==='circle'?{entity:{type:'circle',center:P(0,0),radius:1000},point:P(1000,0)}:{option:'vertex'};
 const points=shape==='circle'?[P(0,1000),P(1200,1200)]:[P(0,0),P(1000,0),P(0,-1000),P(-1500,1500)];
 const h=harness({picks:[entity],points});const result=await installSmartDim(h.ctx).DIMANGULAR();assert.ok(result);assert.deepEqual(h.last().map(clean),h.engine.doc.entities.map(clean));assert.ok(h.last()[0].points.length===4);
});
for(const name of ['DIMEDIT','DIMTEXTMOVE'])test(name+' options render full edited dimension and commit the preview',async()=>{
 const points=name==='DIMEDIT'?[{option:'N'},P(500,500)]:[{option:'A'},P(500,500)];const h=harness({entities:[dim()],points});
 h.ctx.form=(title,fields,apply)=>apply({value:name==='DIMEDIT'?'W=<>':45});await installDimensionEditing(h.ctx,G)[name]();assert.deepEqual(h.last().map(clean),h.engine.doc.entities.map(clean));
});
test('DIMTEDIT position is a full dimension and changes only text location',async()=>{
 const h=harness({entities:[dim()],points:[P(1300,900)]});const source=structuredClone(h.engine.doc.entities[0]);await installDimensionEditing(h.ctx,G).DIMTEXTMOVE();assert.deepEqual(h.last().map(clean),h.engine.doc.entities.map(clean));assert.deepEqual(h.engine.doc.entities[0].points,source.points);
});
test('dimension option M/T/A/H/V/R callback previews exact styled result',async()=>{
 const h=harness({points:[{option:'T'},{option:'A'},{option:'V'},P(500,600)]});let forms=0;h.ctx.form=(title,fields,apply)=>apply({value:forms++===0?'길이 <>':30});const d=await pickDimensionPlacement(h.ctx,p=>applyDimStyle({...dim(),points:[P(0,0),P(1000,0),p]},getDimStyle(h.engine.doc)),{linear:true});assert.deepEqual(d,h.last()[0]);assert.equal(d.mode,'vertical');assert.equal(d.textRotation,30);assert.equal(d.text,'길이 <>');
});
test('all requested existing AutoCAD names and aliases route; absent commands are explicitly absent',()=>{
 const settings={aliases:defaultAliases()};for(const [alias,name] of Object.entries({DLI:'DIMLINEAR',DAL:'DIMALIGNED',DAN:'DIMANGULAR',DRA:'DIMRADIUS',DDI:'DIMDIAMETER',DCO:'DIMCONTINUE',DBA:'DIMBASELINE',QDIM:'QUICKDIM',DIM:'DIMSMART',DIMTEDIT:'DIMTEXTMOVE',DIMSPACE:'DIMCLEAN',QLEADER:'LEADER',LDR:'LEADER'}))assert.equal(resolveCommand(alias,settings),name);assert.equal(resolveCommand('LE',settings),'LE','preserve the existing library layer command collision');for(const name of ['DIMARC','DIMJOGGED','DIMORDINATE','DIMBREAK'])assert.equal(COMMANDS.some(c=>c.name===name),true);
});
test('browser registration exposes native editors and shared preview module',()=>{
 const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');assert.match(app,/installDimensionEditing\(cardContext,G\)/);assert.match(app,/createStudio\(\{engine,form,execute,styledDimension,pickPoint:pickPointOnce,pickPath:pickPathOnce/);assert.match(fs.readFileSync(new URL('./server.py',import.meta.url),'utf8'),/dimension-preview\.js/);
});

for(const name of ['DIMEDIT','DIMTEXTMOVE'])test(name+' Home clears moved text through the real engine and matches the preview',async()=>{
 const source={...dim(),textPosition:P(1800,1300),textRotation:40};
 const h=harness({entities:[source],points:[{option:name==='DIMEDIT'?'':'H'},P(500,500)]});
 await installDimensionEditing(h.ctx,G)[name]();h.engine.validate(h.engine.doc);
 const final=h.engine.doc.entities[0];assert.equal(final.textPosition,undefined);assert.equal(final.textRotation,undefined);
 assert.deepEqual(h.last().map(clean),h.engine.doc.entities.map(clean));
 assert.deepEqual(G.dimensionParts(final),G.dimensionParts({...final,textPosition:undefined,textRotation:undefined}));
 h.engine.execute({type:'undo'});assert.deepEqual(h.engine.doc.entities[0].textPosition,source.textPosition);
});
test('CC new and chain commit on the established dimension layer without hover creating it',async()=>{
 for(const mode of ['new','chain']){
  const h=await card(installDimTools4,'CC',{entities:[line(0),line(1000)],points:mode==='new'?[P(0,0),P(1000,0),P(0,800),null]:[P(0,800)]},{mode});
  const layer=h.engine.doc.layers.find(l=>l.name==='A-DIM');assert.ok(layer);
  assert.ok(h.engine.doc.entities.slice(h.before).every(e=>e.layer===layer.id));
 }
});
test('DPL retains its dimension layer for form-only placement',async()=>{
 const h=await card(installDimTools4,'DPL',{entities:[{type:'polyline',points:[P(0,0),P(1000,0),P(1000,1000)],closed:false}]},{method:'vertex'});
 const layer=h.engine.doc.layers.find(l=>l.name==='A-DIM');assert.ok(layer);
 assert.ok(h.engine.doc.entities.slice(h.before).every(e=>e.layer===layer.id));
});
test('angular quadrant lock transforms with the dimension',()=>{
 const e={type:'dimension',mode:'angular',points:[P(0,0),P(1000,0),P(0,1000),P(2000,2000)],quadrantPoint:P(-500,-500),textHeight:100};
 const moved=G.transformEntity(e,p=>G.add(p,P(4000,5000)));
 assert.deepEqual(moved.quadrantPoint,P(3500,4500));
 assert.equal(G.dimensionParts(moved).find(p=>p.dimensionLabel).text,G.dimensionParts(e).find(p=>p.dimensionLabel).text);
});
