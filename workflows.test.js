import test from 'node:test';import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';import * as G from './geometry.js';
import {architecture,measure,formwork,simplify} from './architecture.js';
import {structuralDetail,steelFrame,standardHSection} from './structure.js';
import {CALS_LAYERS,A1_TEXT_HEIGHTS} from './reference-data.js';import {closestBuildings} from './file-workflows.js';
import {installWorkflows} from './workflows.js';import {tableBlock,defaults} from './studio.js';
import {COMMANDS,validateSettings,defaultAliases,defaultHotkeys,resolveCommand} from './commands.js';
const point=(x,y)=>({x,y}),rect=(x,y,w,h)=>({type:'rectangle',layer:'default',points:G.rectangle(point(x,y),point(x+w,y+h))});
function harness(options={}){const engine=new DrawingEngine(),selection=new Set();let fields,apply;const previewCalls=[];const context={engine,execute:c=>engine.execute(c),chosen:()=>engine.doc.entities.filter(e=>selection.has(e.id)),selected:()=>selection,activeLayer:()=> 'default',refresh(){},toast(){},getSettings:()=>defaults,field:(name,label,value,type,options)=>({name,label,value,type,options}),pointFields:()=>[{name:'x',value:0},{name:'y',value:0}],pickPoint: options.pickPoint?async cfg=>{previewCalls.push(cfg.preview);return options.pickPoint(cfg);}:undefined,form:(title,f,a)=>{fields=f;apply=a;},add:entities=>engine.execute({type:'addMany',entities:entities.map(e=>({layer:'default',...e}))}),change:changes=>engine.execute({type:'document.update',changes})};const studio=installWorkflows({context,handlers:{}});return {engine,selection,previewCalls,context,invoke:name=>studio.handlers[name](),apply:values=>apply({...Object.fromEntries(fields.map(f=>[f.name,f.value])),...values}),open:name=>{studio.handlers[name]();return fields;},run:async(name,values={})=>{studio.handlers[name]();await apply({...Object.fromEntries(fields.map(f=>[f.name,String(f.value??'')])),...values});engine.validate(engine.doc);}};}
test('all Korean workflow names and original aliases resolve without collisions',()=>{const s=validateSettings({version:1,aliases:defaultAliases(),hotkeys:defaultHotkeys()});for(const c of COMMANDS)assert.equal(resolveCommand(c.label,s),c.name);assert.equal(resolveCommand('C',s),'COPY');});
test('high-frequency manual tools have direct commands, distinct aliases and the intended default action',()=>{
 const s=validateSettings({version:1,aliases:defaultAliases(),hotkeys:defaultHotkeys()});
 for(const [alias,name] of [['FRP','FINDREPLACE'],['TXN','TEXTNUMBER'],['TINC','TEXTINCREMENT'],['TMRG','TEXTMERGE'],['TQC','TEXTCOUNT'],['NTN','NEARTEXTNAME'],['LAMG','LAYMERGE'],['LAS','LAYSTATE'],['LSTD','LAYSTANDARD'],['HM','HATCHMERGE'],['LH','LANDHATCH'],['DSCL','DIMSCALE'],['DED','DIMEDIT'],['LDR','LEADER'],['OMO','MULTIOFFSET'],['DAC','POLARARRAY'],['SERG','SELECTRANGE'],['SEBD','SELECTBOUNDARY'],['PVR','SIMPLIFY'],['BKM','BREAKMULTI'],['TRB','TRIMBOUNDARY'],['MFL','MULTIFILLET'],['LAD','LENGTHADJUST'],['OAL','OBJECTALIGN'],['DVCP','DIVIDECOPY'],['AGC','ANGLECOPY'],['DOF','DOUBLEOFFSET'],['COF','CHAINOFFSET'],['PED','PLINEEDIT'],['TSMG','TEXTSTYLEMERGE'],['TPX','TEXTAFFIX'],['TXS','TEXTSPLIT'],['TXM','TEXTMASK'],['ATX','ATTRIBUTETEXT'],['DAX','DIMAFFIX'],['DSMG','DIMSTYLEMERGE'],['DEX','DIMEXTENSION'],['DTMV','DIMTEXTMOVE'],['QDM','QUICKDIM'],['TBE','TABLEEDIT'],['TCM','TABLECELLMERGE'],['TBSP','TABLESPACING'],['TBA','TABLEALIGN']])assert.equal(resolveCommand(alias,s),name);
 const t=harness();const [textId,shapeId]=t.engine.execute({type:'addMany',entities:[{type:'text',layer:'default',position:point(0,0),height:50,text:'A1'},rect(0,0,100,100)]});
 const expected={FINDREPLACE:'replace',TEXTNUMBER:'number',TEXTINCREMENT:'increment',TEXTMERGE:'merge',TEXTCOUNT:'count',NEARTEXTNAME:'name',LAYMERGE:'merge',LAYSTATE:'stateSave',LAYSTANDARD:'standard'};
 for(const [name,action] of Object.entries(expected)){if(name.startsWith('TEXT')||name==='FINDREPLACE'||name==='NEARTEXTNAME'){t.selection.clear();t.selection.add(textId);}const field=t.open(name).find(f=>f.name==='action');assert.equal(field.value,action,name);}
 t.selection.clear();t.selection.add(shapeId);assert.equal(t.open('HATCHMERGE').find(f=>f.name==='action').value,'merge');assert.equal(t.open('LANDHATCH').find(f=>f.name==='action').value,'land');
});
test('range and boundary selection support complete-inside and crossing modes',async()=>{
 const t=harness(),ids=t.engine.execute({type:'addMany',entities:[
  {type:'rectangle',layer:'default',closed:true,points:G.rectangle(point(0,0),point(100,100))},
  {type:'line',layer:'default',points:[point(10,10),point(90,90)]},
  {type:'line',layer:'default',points:[point(-20,50),point(20,50)]},
  {type:'circle',layer:'default',center:point(50,50),radius:200},
  {type:'line',layer:'default',points:[point(200,200),point(300,300)]},
 ]});
 await t.run('SELECTRANGE',{minX:0,minY:0,maxX:100,maxY:100,mode:'inside'});assert.deepEqual([...t.selection].sort(),[ids[0],ids[1]].sort());
 await t.run('SELECTRANGE',{minX:0,minY:0,maxX:100,maxY:100,mode:'crossing'});assert.deepEqual([...t.selection].sort(),[ids[0],ids[1],ids[2],ids[3]].sort());
 t.selection.clear();t.selection.add(ids[0]);await t.run('SELECTBOUNDARY',{mode:'inside'});assert.deepEqual([...t.selection],[ids[1]]);
 t.selection.clear();t.selection.add(ids[0]);await t.run('SELECTBOUNDARY',{mode:'crossing'});assert.deepEqual([...t.selection].sort(),[ids[1],ids[2],ids[3]].sort());
});
test('batch break, boundary trim and continuous fillet edit real line geometry in one undo step',async()=>{
 const t=harness(),breakIds=t.engine.execute({type:'addMany',entities:[{type:'line',layer:'default',points:[point(0,0),point(1000,0)]},{type:'line',layer:'default',points:[point(0,100),point(1000,100)]}]});breakIds.forEach(id=>t.selection.add(id));
 await t.run('BREAKMULTI',{ax:400,ay:0,bx:600,by:0});assert.equal(t.engine.doc.entities.length,4);t.engine.execute({type:'undo'});assert.equal(t.engine.doc.entities.length,2);
 t.selection.clear();t.engine.execute({type:'delete',ids:breakIds});const [boundary,target]=t.engine.execute({type:'addMany',entities:[{type:'line',layer:'default',points:[point(500,-100),point(500,100)]},{type:'line',layer:'default',points:[point(0,0),point(1000,0)]}]});t.selection.add(boundary);t.selection.add(target);await t.run('TRIMBOUNDARY',{boundary,action:'trim',x:900,y:0});assert.deepEqual(t.engine.doc.entities.find(e=>e.type==='line'&&e.id!==boundary).points,[point(0,0),point(500,0)]);
 t.selection.clear();t.engine.execute({type:'delete',ids:t.engine.doc.entities.map(e=>e.id)});const chain=t.engine.execute({type:'addMany',entities:[{type:'line',layer:'default',points:[point(0,0),point(1000,0)]},{type:'line',layer:'default',points:[point(1000,0),point(1000,1000)]}]});chain.forEach(id=>t.selection.add(id));await t.run('MULTIFILLET',{radius:100});assert.equal(t.engine.doc.entities.filter(e=>e.type==='line').length,2);assert.equal(t.engine.doc.entities.find(e=>e.type==='arc').radius,100);
});
test('length, alignment and copy helpers preserve editable source objects',async()=>{
 const t=harness(),[line]=t.engine.execute({type:'add',entity:{type:'line',layer:'default',points:[point(0,0),point(1000,0)]}});t.selection.add(line);await t.run('LENGTHADJUST',{method:'total',value:2000,end:'finish'});assert.deepEqual(t.engine.doc.entities[0].points,[point(0,0),point(2000,0)]);
 t.selection.clear();const boxes=t.engine.execute({type:'addMany',entities:[rect(0,0,100,100),rect(300,200,100,100)]});boxes.forEach(id=>t.selection.add(id));await t.run('OBJECTALIGN',{mode:'left'});assert.equal(G.bounds([t.engine.doc.entities.find(e=>e.id===boxes[1])]).minX,0);
 t.selection.clear();t.selection.add(line);await t.run('DIVIDECOPY',{x:0,y:0,endX:1000,endY:0,count:3});assert.equal(t.engine.doc.entities.filter(e=>e.type==='line').length,3);await t.run('ANGLECOPY',{x:0,y:0,angles:'90'});assert.ok(t.engine.doc.entities.some(e=>e.type==='line'&&Math.abs(e.points[1].x)<1e-6&&e.points[1].y===2000));
});
test('two-sided, repeated offset and polyline vertex editing create valid geometry',async()=>{
 const t=harness(),[line]=t.engine.execute({type:'add',entity:{type:'line',layer:'default',points:[point(0,0),point(1000,0)]}});t.selection.add(line);await t.run('DOUBLEOFFSET',{distance:50,x:0,y:1000});assert.deepEqual(t.engine.doc.entities.slice(1).map(e=>e.points[0].y).sort((a,b)=>a-b),[-50,50]);await t.run('CHAINOFFSET',{distance:100,count:3,x:0,y:1000});assert.deepEqual(t.engine.doc.entities.slice(3).map(e=>e.points[0].y),[100,200,300]);
 t.selection.clear();const [poly]=t.engine.execute({type:'add',entity:{type:'polyline',layer:'default',points:[point(0,0),point(1000,0),point(1000,1000)],closed:false}});t.selection.add(poly);await t.run('PLINEEDIT',{action:'add',x:500,y:40});assert.deepEqual(t.engine.doc.entities.find(e=>e.id===poly).points[1],point(500,0));await t.run('PLINEEDIT',{action:'close'});assert.equal(t.engine.doc.entities.find(e=>e.id===poly).closed,true);await t.run('PLINEEDIT',{action:'reverse'});assert.deepEqual(t.engine.doc.entities.find(e=>e.id===poly).points[0],point(1000,1000));
});
test('text style, affix and split commands preserve editable text objects',async()=>{
 const t=harness(),ids=t.engine.execute({type:'addMany',entities:[{type:'text',layer:'default',position:point(0,0),height:100,text:'A,B',rotation:30,align:'center',widthFactor:.8,textStyle:'TITLE'},{type:'text',layer:'default',position:point(1000,0),height:50,text:'C,D'}]});ids.forEach(id=>t.selection.add(id));await t.run('TEXTSTYLEMERGE',{rotation:'copy'});const second=t.engine.doc.entities[1];assert.equal(second.height,100);assert.equal(second.rotation,30);assert.equal(second.align,'center');assert.equal(second.textStyle,'TITLE');
 await t.run('TEXTAFFIX',{prefix:'[',suffix:']',duplicate:'skip'});assert.deepEqual(t.engine.doc.entities.map(e=>e.text),['[A,B]','[C,D]']);t.selection.clear();t.selection.add(ids[0]);await t.run('TEXTSPLIT',{delimiter:',',direction:'horizontal',gap:200});assert.equal(t.engine.doc.entities.length,3);assert.equal(t.engine.doc.entities[0].text,'[A');assert.equal(t.engine.doc.entities.at(-1).text,'B]');t.engine.execute({type:'undo'});assert.equal(t.engine.doc.entities.length,2);
 await t.run('TEXTMASK',{action:'on',padding:25});assert.equal(t.engine.doc.entities[0].backgroundMask,true);assert.equal(t.engine.doc.entities[0].maskPadding,25);
});
test('block attribute text updates data and replaces the same visible attribute atomically',async()=>{
 const t=harness(),[id]=t.engine.execute({type:'add',entity:{type:'block',name:'ROOM',layer:'default',entities:[{type:'line',layer:'default',points:[point(0,0),point(1000,0)]}]}});t.selection.add(id);await t.run('ATTRIBUTETEXT',{key:'MARK',value:'R-01',dx:0,dy:100,height:100});let block=t.engine.doc.entities[0];assert.equal(block.attributes.MARK,'R-01');assert.equal(block.entities.find(e=>e.attributeTag==='MARK').text,'R-01');await t.run('ATTRIBUTETEXT',{key:'MARK',value:'R-02',dx:0,dy:100,height:100});block=t.engine.doc.entities[0];assert.equal(block.entities.filter(e=>e.attributeTag==='MARK').length,1);assert.equal(block.attributes.MARK,'R-02');
});
test('dimension affix, style, extension and text position commands update measured dimensions',async()=>{
 const t=harness(),ids=t.engine.execute({type:'addMany',entities:[{type:'dimension',layer:'default',mode:'horizontal',points:[point(0,0),point(1000,0),point(0,300)],textHeight:120,precision:1,arrowSize:60},{type:'dimension',layer:'default',mode:'horizontal',points:[point(0,500),point(2000,500),point(0,800)],textHeight:80,precision:2}]});ids.forEach(id=>t.selection.add(id));await t.run('DIMAFFIX',{prefix:'W=',suffix:' mm'});assert.equal(t.engine.doc.entities[1].textTemplate,'W=<> mm');await t.run('DIMSTYLEMERGE',{template:'copy'});assert.equal(t.engine.doc.entities[1].textHeight,120);assert.equal(t.engine.doc.entities[1].precision,1);assert.equal(t.engine.doc.entities[1].arrowSize,60);await t.run('DIMEXTENSION',{extensionOffset:20,extensionOvershoot:40,textGap:50,arrowSize:70});assert.equal(t.engine.doc.entities[0].extensionOffset,20);await t.run('DIMTEXTMOVE',{x:700,y:900});assert.deepEqual(G.primitives(t.engine.doc.entities[0]).find(e=>e.type==='text').position,point(700,900));
});
test('table content, merge, spacing and alignment rebuild the same editable table block',async()=>{
 const t=harness(),[id]=t.engine.execute({type:'add',entity:tableBlock([['A','B','C'],[1,2,3]],{height:100,layer:'default'})});t.selection.add(id);await t.run('TABLECELLMERGE',{action:'merge',r1:1,c1:1,r2:1,c2:2});let table=t.engine.doc.entities[0];assert.deepEqual(table.table.merges,[{r1:0,c1:0,r2:0,c2:1}]);assert.equal(table.table.rows[0][0],'A B');assert.equal(table.entities.filter(e=>e.type==='text').length,5);
 await t.run('TABLEALIGN',{action:'align',align:'center'});table=t.engine.doc.entities[0];assert.ok(table.entities.filter(e=>e.type==='text').every(e=>e.align==='center'));await t.run('TABLESPACING',{action:'spacing',textHeight:120,rowHeight:300,widths:'400,500,600'});table=t.engine.doc.entities[0];assert.equal(table.table.height,120);assert.equal(table.table.rowHeight,300);assert.deepEqual(table.table.widths,[400,500,600]);await t.run('TABLEEDIT',{action:'content',rows:'X\tY\n10\t20'});table=t.engine.doc.entities[0];assert.deepEqual(table.table.rows,[['X','Y'],[10,20]]);assert.deepEqual(table.table.merges,[]);
});
test('building form aligns windows to diagonal walls and clamps to available segment',async()=>{
 const t=harness();const [id]=t.engine.execute({type:'add',entity:{type:'wall',layer:'default',points:[point(0,0),point(3000,4000)],thickness:240,openings:[]}});t.selection.add(id);
 await t.run('BUILDING',{kind:'WINDOW',wall:'yes',x:'3000',y:'4000',width:'1000'});const window=t.engine.doc.entities[1];assert.equal(window.position.x,2400);assert.equal(window.position.y,3200);assert.equal(window.attributes.depth,240);assert.ok(Math.abs(window.parameters.rotation-53.13010235415598)<1e-6);assert.deepEqual(t.engine.doc.entities[0].openingLinks[window.id],[.8,1]);
});
test('leader, quantities, calculator and ratios write the computed values',async()=>{
 const t=harness();const [id]=t.engine.execute({type:'add',entity:rect(0,0,6000,4000)});t.selection.add(id);await t.run('QUANTITY');assert.equal(t.engine.doc.entities.at(-1).table.rows[1][1],24);await t.run('RATIOS',{site:1000,footprint:400,gross:1200});assert.equal(t.engine.doc.entities.at(-1).table.rows[4][1],40);assert.equal(t.engine.doc.entities.at(-1).table.rows[5][1],120);
 await t.run('CALCULATE',{action:'multiply',a:12,b:3});assert.equal(t.engine.doc.entities.at(-1).text,'multiply = 36');await assert.rejects(()=>t.run('CALCULATE',{action:'divide',a:1,b:0}));await t.run('LEADER',{text:'TEST',endX:2000,endY:1000});assert.equal(t.engine.doc.entities.at(-1).entities[2].text,'TEST');
});
test('continue dimension and trim form change actual geometry',async()=>{
 const t=harness();const [id]=t.engine.execute({type:'add',entity:{type:'dimension',layer:'default',mode:'horizontal',textHeight:100,points:[point(0,0),point(1000,0),point(0,300)]}});t.selection.add(id);await t.run('DIMCONTINUE',{x:2000,y:0});assert.deepEqual(t.engine.doc.entities.at(-1).points.slice(0,2),[point(1000,0),point(2000,0)]);
 t.selection.clear();const ids=t.engine.execute({type:'addMany',entities:[{type:'line',layer:'default',points:[point(0,0),point(1000,0)]},{type:'line',layer:'default',points:[point(500,-100),point(500,100)]}]});ids.forEach(id=>t.selection.add(id));await t.run('TRIMEXTEND',{target:ids[0],action:'trim',x:900,y:0});assert.ok(t.engine.doc.entities.some(e=>e.type==='line'&&e.points[1].x===500&&e.points[1].y===0));
});
test('layer standards use supplied weights for both creation and update; saved state restores',async()=>{
 const t=harness();await t.run('LAYERS',{action:'standard',rows:'TEST\t#123456\t0.7'});const l=t.engine.doc.layers.find(l=>l.name==='TEST');assert.equal(l.lineweight,.7);
 await t.run('LAYERS',{action:'stateSave',name:'a'});t.engine.execute({type:'layer.update',id:l.id,changes:{visible:false}});await t.run('LAYERS',{action:'stateRestore',name:'a'});assert.equal(t.engine.doc.layers.find(a=>a.id===l.id).visible,true);
});
test('library inserts nested blocks from another drawing without missing layers',async()=>{
 const store=new Map();globalThis.localStorage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)};
 const t=harness();t.engine.execute({type:'layer.add',name:'source',color:'#123456'});const layer=t.engine.doc.layers.at(-1).id;const [id]=t.engine.execute({type:'add',entity:{type:'block',name:'nested',layer,entities:[{type:'line',layer,points:[point(10,20),point(110,20)]}]}});t.selection.add(id);await t.run('LIBRARY',{action:'save',name:'shared'});
 const other=harness();await other.run('LIBRARY',{action:'insert',name:'shared',x:1000,y:2000});const child=other.engine.doc.entities[0].entities[0].entities[0];assert.equal(child.layer,'default');assert.deepEqual(child.points[0],point(1000,2000));other.engine.execute({type:'undo'});assert.equal(other.engine.doc.entities.length,0);delete globalThis.localStorage;
});
test('coordinate import, attribute table and table reading create editable data',async()=>{
 const t=harness();await t.run('COORDINATES',{rows:'0\t0\n1000\t0\n1000\t1000',closed:'yes'});const poly=t.engine.doc.entities[0];assert.equal(poly.closed,true);t.selection.add(poly.id);await t.run('COORDINATES',{action:'export'});assert.equal(t.engine.doc.entities.at(-1).table.rows.length,4);
 await t.run('TABLE',{rows:'번호\t수량\nA\t5'});assert.equal(t.engine.doc.entities.at(-1).table.rows[1][1],5);t.selection.clear();t.selection.add(t.engine.doc.entities.at(-1).id);await t.run('TABLE',{action:'read'});assert.equal(t.engine.doc.entities.at(-1).table.rows[1][1],'5');await t.run('ATTRIBUTES',{keys:'name'});assert.ok(t.engine.doc.entities.at(-1).table.rows[1][1]);
});
test('hatch boundary extracts outer and hole; non-hatch selection reports error',async()=>{
 const t=harness();const [id]=t.engine.execute({type:'add',entity:{...rect(0,0,1000,1000),type:'hatch',loops:[G.rectangle(point(100,100),point(200,200))],spacing:100,angle:45}});t.selection.add(id);await t.run('HATCHEDIT',{action:'boundary'});assert.equal(t.engine.doc.entities.length,3);assert.equal(t.engine.doc.entities[2].closed,true);t.selection.clear();t.selection.add(t.engine.doc.entities[1].id);await assert.rejects(()=>t.run('HATCHEDIT',{action:'boundary'}));
});
test('similar selection excludes hidden objects and simplification preserves endpoints',async()=>{
 const t=harness();const ids=t.engine.execute({type:'addMany',entities:[{type:'polyline',layer:'default',points:[point(0,0),point(500,.1),point(1000,0)]},{type:'polyline',layer:'default',hidden:true,points:[point(0,0),point(1000,0)]}]});t.selection.add(ids[0]);await t.run('SELECTSIMILAR',{condition:'type'});assert.deepEqual([...t.selection],[ids[0]]);await t.run('SIMPLIFY',{tolerance:1});assert.deepEqual(t.engine.doc.entities[0].points,[point(0,0),point(1000,0)]);
});
test('every architecture generator produces editable validated geometry',()=>{for(const kind of ['DOOR','WINDOW','STAIR','COLUMN','ELEVATOR','CURVESTAIR','INSULATION','RAMP','LEVEL','SECTION','ARROW','BREAKSYMBOL','TITLE','TEXTBOX','ROOMTAG','OPENINGTAG']){const e=architecture(kind,{width:1200,depth:2000,count:12,mark:kind},'default');const eng=new DrawingEngine();eng.execute({type:'add',entity:e});assert.ok(e.entities.length>0);}});
test('room area includes hole deduction and unit conversion',()=>{const r=rect(0,0,6000,4000);assert.equal(measure(r).area/1e6,24);const hatch={...r,type:'hatch',loops:[G.rectangle(point(0,0),point(1000,1000))]};assert.equal(measure(hatch).area/1e6,23);});
test('formwork calculation retains slope, stair, deduction and rejects excessive deductions',()=>{const r=formwork({length:10,height:3,allowance:5,rise:3,run:4,steps:10,tread:.3,riser:.15,stairWidth:1,openings:2});assert.equal(r.slope,1.25);assert.equal(r.stair,4.5);assert.equal(r.total,42);assert.throws(()=>formwork({length:1,height:1,openings:2}));});
test('structural beam/column/slab/steel emit sections and bars with input limits',()=>{for(const kind of ['beam','column','slab','steel']){const eng=new DrawingEngine();const e=structuralDetail(kind,{width:400,depth:600,cover:40,diameter:22,count:4,spacing:200,span:6000,mark:'G1'});eng.execute({type:'add',entity:e});assert.ok(e.entities.length>5);}assert.throws(()=>structuralDetail('beam',{width:100,depth:100,cover:49,diameter:22,count:4,spacing:200,span:6000}));});
test('building distance detects separation, crossing and containment',()=>{assert.equal(closestBuildings(rect(0,0,1000,1000),rect(3000,0,1000,1000)).distance,2000);assert.equal(closestBuildings(rect(0,0,1000,1000),rect(500,500,1000,1000)).distance,0);assert.equal(closestBuildings(rect(0,0,5000,5000),rect(1000,1000,1000,1000)).distance,0);});
test('polyline simplification preserves endpoints within tolerance',()=>{assert.deepEqual(simplify([point(0,0),point(100,.1),point(200,0)],1),[point(0,0),point(200,0)]);});
test('analytic curve intersections and trims preserve exact arcs',()=>{const circle={type:'circle',center:point(0,0),radius:100},line={type:'line',points:[point(-200,0),point(200,0)]};assert.equal(G.intersections(circle,line).length,2);const parts=G.cutEntity(circle,[line],point(0,100));assert.equal(parts[0].type,'arc');assert.equal(parts[0].startAngle,180);assert.equal(parts[0].endAngle,0);});
test('sheet clipping cuts crossing lines and circle arcs at the actual frame',()=>{const b={minX:0,minY:0,maxX:100,maxY:100};const line={type:'line',points:[point(-50,50),point(150,50)]};assert.deepEqual(G.clipToBounds(line,b)[0].points,[point(0,50),point(100,50)]);const arc=G.clipToBounds({type:'circle',center:point(0,0),radius:50},b);assert.equal(arc.length,1);assert.equal(arc[0].startAngle,0);assert.equal(arc[0].endAngle,90);});
test('text numbering, replacement and count use actual engine edits',async()=>{const t=harness();for(let i=0;i<3;i++)t.engine.execute({type:'add',entity:{type:'text',text:'OLD',position:point(i*100,0),height:50,layer:'default'}});await t.run('TEXTEDIT',{action:'number',replace:'A-',start:'10',step:'2'});assert.deepEqual(t.engine.doc.entities.map(e=>e.text),['A-10','A-12','A-14']);await t.run('TEXTEDIT',{action:'replace',find:'A-',replace:'B-'});assert.equal(t.engine.doc.entities[1].text,'B-12');});
test('room tag and schedule use selected geometry',async()=>{const t=harness();const [id]=t.engine.execute({type:'add',entity:rect(0,0,6000,4000)});t.selection.add(id);await t.run('ROOM',{name:'거실',floor:'1F'});assert.equal(t.engine.doc.entities[0].room.name,'거실');await t.run('SCHEDULE',{kind:'rooms'});assert.equal(t.engine.doc.entities.at(-1).table.rows[1][3],24);});
test('chain dimensions, annotation scale and split preserve measured geometry',async()=>{const t=harness();const [id]=t.engine.execute({type:'add',entity:rect(0,0,6000,4000)});t.selection.add(id);await t.run('DIMCHAIN');const dim=t.engine.doc.entities.find(e=>e.type==='dimension');assert.ok(dim);t.selection.clear();t.selection.add(dim.id);await t.run('DIMSCALE',{scale:'50'});assert.equal(t.engine.doc.entities.find(e=>e.id===dim.id).textHeight,125);await t.run('DIMEDIT',{action:'split',ratio:'.5'});assert.equal(t.engine.doc.entities.filter(e=>e.type==='dimension').length,2);});
test('multiple offset and circular array retain originals',async()=>{const t=harness();const [id]=t.engine.execute({type:'add',entity:{type:'circle',center:point(2000,0),radius:100,layer:'default'}});t.selection.add(id);await t.run('MULTIOFFSET',{distances:'100,200',x:'3000',y:'0'});assert.equal(t.engine.doc.entities.length,3);await t.run('POLARARRAY',{count:'4',angle:'360',x:'0',y:'0'});assert.equal(t.engine.doc.entities.length,6);assert.equal(t.engine.doc.entities.find(e=>e.id===id).center.x,2000);});
test('linked door openings follow edits, host movement and undo',async()=>{const t=harness();const [id]=t.engine.execute({type:'add',entity:{type:'wall',points:[point(0,0),point(6000,0)],thickness:200,openings:[],layer:'default'}});t.selection.add(id);await t.run('BUILDING',{kind:'DOOR',wall:'yes',x:'1000',y:'0',width:'900'});const door=t.engine.doc.entities[1];assert.equal(Object.keys(t.engine.doc.entities[0].openingLinks).length,1);assert.equal(door.hostWall,id);t.engine.execute({type:'move',ids:[door.id],dx:1000,dy:0});assert.equal(t.engine.doc.entities[0].openingLinks[door.id][0],1/3);t.engine.execute({type:'move',ids:[id],dx:0,dy:1000});assert.equal(t.engine.doc.entities[1].position.y,1000);t.engine.execute({type:'delete',ids:[door.id]});assert.equal(Object.keys(t.engine.doc.entities[0].openingLinks).length,0);t.engine.execute({type:'undo'});assert.equal(Object.keys(t.engine.doc.entities[0].openingLinks).length,1);});

test('steel floor plan creates one column per intersection and beams between neighbours',()=>{const es=steelFrame([0,6000,12000],[0,5000],{width:300,depth:400});const eng=new DrawingEngine();eng.execute({type:'addMany',entities:es});assert.equal(es.filter(e=>e.category==='STEEL_COLUMN').length,6);assert.equal(es.filter(e=>e.category==='STEEL_BEAM').length,7);assert.throws(()=>steelFrame([0,0],[0,1],{width:300,depth:400}));});

test('H형강 규격표가 실제 플랜지·웹 두께를 준다',()=>{
 // 예전에는 높이·너비에 비례해 어림했다. H-300×300 의 플랜지는 15mm 이지 18mm 가 아니다.
 const section=standardHSection(300,300);
 assert.equal(section.label,'H-300x300x10x15');assert.equal(section.tf,15);assert.equal(section.tw,10);
 const made=structuralDetail('steel',{width:300,depth:300,cover:40,diameter:22,count:4,spacing:200,span:6000,mark:'SC1'});
 assert.match(made.entities.find(e=>e.type==='text').text,/H-300x300x10x15/);
 assert.equal(standardHSection(600,400),null);                       // 규격에 없는 크기는 어림값으로 간다
});

test('CALS 표준 레이어 자료가 이름·색·선종류를 갖춘다',()=>{
 assert.ok(CALS_LAYERS.length>150);
 assert.ok(CALS_LAYERS.every(l=>/^[A-Z]{2}-/.test(l.name)&&/^#[0-9a-f]{6}$/.test(l.color)&&l.linetype));
 assert.equal(new Set(CALS_LAYERS.map(l=>l.name)).size,CALS_LAYERS.length);   // 이름이 겹치면 레이어가 덮인다
 assert.equal(CALS_LAYERS.find(l=>l.name==='AA-XXXX-CNTL').color,'#ff0000');
});

test('A1 기준 글자 높이에 축척 분모를 곱하면 모형 높이가 된다',()=>{
 const normal=A1_TEXT_HEIGHTS.find(t=>t.key==='TXT_H2');
 assert.equal(normal.paperHeight,4);
 assert.equal(normal.paperHeight*100,400);
 assert.ok(A1_TEXT_HEIGHTS.every(t=>t.paperHeight>0&&t.paperHeight<=50));
});


test('DIMCHAIN and QUICKDIM preview the exact inserted dimensions without modifying the drawing',async()=>{
 for(const name of ['DIMCHAIN','QUICKDIM']){
  let preview;const cursor=point(0,500),t=harness({pickPoint:async cfg=>{const before=JSON.stringify(t.engine.doc);preview=cfg.preview([],cursor);assert.ok(preview.every(e=>e.type==='dimension'));assert.equal(JSON.stringify(t.engine.doc),before);return cursor;}});
  const ids=t.engine.execute({type:'addMany',entities:[{type:'line',layer:'default',points:[point(0,0),point(1000,0)]},{type:'line',layer:'default',points:[point(2000,0),point(3000,0)]}]});ids.forEach(id=>t.selection.add(id));
  t.invoke(name);await t.apply({mode:'horizontal',source:'ends',denominator:100});assert.deepEqual(t.engine.doc.entities.slice(2).map(({id,...e})=>e),preview);
 }
});
test('DIMTEXTMOVE preview contains complete dimension geometry rather than update commands',async()=>{
 let preview;const t=harness({pickPoint:async cfg=>{preview=cfg.preview([],point(1800,900));assert.equal(preview[0].type,'dimension');assert.ok(G.dimensionParts(preview[0]).some(e=>e.dimensionLabel));return point(1800,900);}});
 const [id]=t.engine.execute({type:'add',entity:{type:'dimension',layer:'default',mode:'horizontal',points:[point(0,0),point(1000,0),point(0,100)],textHeight:100}});t.selection.add(id);await t.invoke('DIMTEXTMOVE');assert.deepEqual(t.engine.doc.entities[0],preview[0]);
});
test('LEADER previews user text and the full final leader block',async()=>{
 let preview;const pts=[point(0,0),point(1000,500)],t=harness({pickPoint:async cfg=>{const at=pts.shift();if(cfg.preview){preview=cfg.preview([],at);assert.equal(preview[0].type,'block');assert.equal(preview[0].entities.find(e=>e.type==='text').text,'지시 내용');}return at;}});
 t.invoke('LEADER');await t.apply({text:'지시 내용',x:0,y:0,endX:1000,endY:500});const {id,...actual}=t.engine.doc.entities[0];assert.deepEqual(actual,preview[0]);
});
test('DIMEDIT split preview matches the entire replacement before committing once',async()=>{
 let preview;const t=harness({pickPoint:async cfg=>{preview=cfg.preview([],point(0,500));assert.equal(t.engine.doc.entities.length,1);return point(0,500);}});const [id]=t.engine.execute({type:'add',entity:{type:'dimension',layer:'default',mode:'horizontal',points:[point(0,0),point(1000,0),point(0,100)],textHeight:100}});t.selection.add(id);
 t.invoke('DIMEDIT');await t.apply({action:'split',ratio:.4});assert.deepEqual(t.engine.doc.entities.map(({id,...e})=>e),preview.map(({id,...e})=>e));
});

test('QDIM preserves vertical, aligned and center source choices before live placement',async()=>{
 for(const [mode,source] of [['auto','ends'],['vertical','ends'],['aligned','ends'],['vertical','centers']]){
  let preview;const at=point(500,400),t=harness({pickPoint:async cfg=>{preview=cfg.preview([],at);assert.ok(preview.length);return at;}});
  const ids=t.engine.execute({type:'addMany',entities:[{type:'line',layer:'default',points:[point(0,0),point(0,1000)]},{type:'line',layer:'default',points:[point(2000,2000),point(2000,3000)]}]});ids.forEach(id=>t.selection.add(id));t.invoke('QUICKDIM');await t.apply({mode,source,denominator:100});assert.deepEqual(t.engine.doc.entities.slice(2).map(({id,...e})=>e),preview);
 }
 const t=harness({pickPoint:async cfg=>{const at=point(500,500);assert.equal(cfg.preview([],at)[0].mode,'vertical');return at;}});const [id]=t.engine.execute({type:'add',entity:{type:'line',layer:'default',points:[point(0,0),point(0,1000)]}});t.selection.add(id);t.invoke('QUICKDIM');await t.apply({mode:'auto',source:'ends',denominator:100});assert.equal(t.engine.doc.entities.at(-1).mode,'vertical');
});
