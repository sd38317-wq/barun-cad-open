import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as G from './geometry.js';
import {DrawingEngine} from './engine.js';
import * as D from './dynamic-block.js';
import {computeEntities,currentValues,describeParameters,dynamicChanges,dynamicDefinition} from './dynamic-block.js';

// Definitions and references read from two office drawings by the converter
// (converter/DynBlocks.cs) and exchange.py: VALS05 (linear + stretch + move),
// MF-소화기구일람표-Box (linear + stretch on a polyline and a wipeout) and
// RISER-U&D (visibility UP/DOWN/없음). *U12 / *U48 are AutoCAD's own
// anonymous blocks holding each reference's current shape.
const fixture=JSON.parse(readFileSync(new URL('./dynamic-block.fixture.json',import.meta.url),'utf8'));
const doc={version:3,sharedBlocks:fixture.definitions};
const BOX='MF-소화기구일람표-Box';
const box=list=>G.bounds(list);
const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
const sameBounds=(a,b)=>{for(const k of ['minX','minY','maxX','maxY'])near(a[k],b[k],1e-6);};

test('linear values recompute the shape AutoCAD stored for the reference', () => {
 for(const [name,anon] of [['VALS05','*U12'],[BOX,'*U48']]){
  const ref=fixture.references[name],def=doc.sharedBlocks[name],values=currentValues(def.dynamic,ref.dynamic.values);
  assert.equal(ref.sharedBlock,anon);
  sameBounds(box(computeEntities(def,def.dynamic,values)),box(doc.sharedBlocks[anon].entities));
 }
});

test('VALS05 stretch moves exactly the bound vertices', () => {
 const def=doc.sharedBlocks.VALS05,p=def.dynamic.parameters[0];
 assert.equal(p.value,5);
 const before=new Map(def.entities.map(e=>[e.sourceHandle,e])),after=new Map(computeEntities(def,def.dynamic,{[p.id]:20}).map(e=>[e.sourceHandle,e]));
 for(const h of ['437','438'])for(const i of [0,1])near(after.get(h).points[i].x,before.get(h).points[i].x+15);
 for(const h of ['433','434']){near(after.get(h).points[0].x,before.get(h).points[0].x);near(after.get(h).points[1].x,before.get(h).points[1].x+15);}
 for(const h of ['435','436'])assert.deepEqual(after.get(h).points,before.get(h).points);
});

test('box stretch grows by the change and keeps the wipeout with the outline', () => {
 const def=doc.sharedBlocks[BOX],p=def.dynamic.parameters[0],base=box(computeEntities(def,def.dynamic,{[p.id]:50}));
 const grown=computeEntities(def,def.dynamic,{[p.id]:100});
 near(box(grown).maxY-box(grown).minY,base.maxY-base.minY+50);
 // The wipeout sits 1 mm inside the outline; both stretch with the parameter.
 const height=(list,type)=>{const b=box(list.filter(e=>e.type===type));return b.maxY-b.minY;};
 const start=computeEntities(def,def.dynamic,{[p.id]:50});
 for(const type of ['polyline','block'])near(height(grown,type),height(start,type)+50);
});

test('visibility states show their own entities and a stale state falls back', () => {
 const def=doc.sharedBlocks['RISER-U&D'],p=def.dynamic.parameters[0],shown=s=>computeEntities(def,def.dynamic,{[p.id]:s}).map(e=>e.sourceHandle).sort();
 assert.deepEqual(p.states.map(s=>s.name),['UP','DOWN','없음']);
 for(const s of p.states)assert.deepEqual(shown(s.name),[...s.handles].sort());
 assert.notDeepEqual(shown('UP'),shown('DOWN'));
 const values=currentValues(def.dynamic,fixture.references['RISER-U&D'].dynamic.values);
 assert.equal(values[p.id],'UP');     // A missing old state uses the first defined state.
 assert.equal(describeParameters(def.dynamic,values)[0].default,'UP');
});

test('a changed reference lands where the shared one was and can be changed again', () => {
 const ref={id:'r',layer:'0',...structuredClone(fixture.references.VALS05)},p=doc.sharedBlocks.VALS05.dynamic.parameters[0];
 assert.ok(dynamicDefinition(doc,ref));
 const original=box(G.materializeSharedDrawingReference(doc,ref).entities);
 const same=dynamicChanges(doc,ref,{[p.id]:5});
 assert.equal(same.sharedBlock,undefined);
 sameBounds(box(same.entities),original);
 const changed={...ref,...dynamicChanges(doc,ref,{[p.id]:20})};
 // rotation 90°, scale 40: the 15 mm stretch along local +X goes along world +Y by 600.
 near(box(changed.entities).maxY-original.maxY,600,1e-6);
 const moved=G.rotate(G.translate(changed,1000,0),changed.position,90);
 near(moved.rotation,180,1e-9);
 const again={...moved,...dynamicChanges(doc,moved,{[p.id]:20})};
 sameBounds(box(again.entities),box(moved.entities));
 assert.throws(()=>dynamicChanges(doc,ref,{[p.id]:0}),/0보다 커야/);
});


test('DYNB keeps imported attributes through repeated changes without duplicate definition text',()=>{
 const definition=structuredClone(doc.sharedBlocks.VALS05),p=definition.dynamic.parameters[0];
 definition.entities.push({type:'text',layer:'A-문자',position:{x:0,y:0},height:2,text:'기본',attdef:{tag:'NO',default:'기본'}});
 const d={sharedBlocks:{VALS05:definition}},attribute={id:'attr',type:'text',layer:'A-문자',attributeTag:'NO',position:{x:123,y:456},height:17,rotation:31,widthFactor:.7,font:'검수체',textStyle:'검수',text:'203',align:'center',hidden:true};
 const ref={...structuredClone(fixture.references.VALS05),id:'r',type:'block',attributes:{NO:'203'},entities:[attribute]};
 const original=structuredClone(ref),first={...ref,...dynamicChanges(d,ref,{[p.id]:20})};
 const second={...first,...dynamicChanges(d,first,{[p.id]:5})};
 for(const changed of [first,second])assert.deepEqual(changed.entities.filter(e=>e.attributeTag==='NO'),[attribute]);
 const edited={...second,attributes:{NO:'204'}};
 const third={...edited,...dynamicChanges(d,edited,{[p.id]:10})};
 assert.equal(third.entities.filter(e=>e.attributeTag==='NO').length,1);
 assert.equal(third.entities.find(e=>e.attributeTag==='NO').text,'204');
 assert.deepEqual(ref,original);
});

test('old visibility names match case and spaces, otherwise choose first state with warning',()=>{
 const dyn=doc.sharedBlocks['RISER-U&D'].dynamic,p=dyn.parameters[0],warnings=[];
 assert.equal(currentValues(dyn,{[p.id]:' d o w n '},warnings)[p.id],'DOWN');
 assert.equal(warnings.length,0);
 assert.equal(currentValues(dyn,{old:'Riser-UP'},warnings)[p.id],'UP');
 assert.equal(warnings.length,1);assert.match(warnings[0],/Riser-UP/);assert.match(warnings[0],/UP/);
 const ref={...structuredClone(fixture.references['RISER-U&D']),type:'block'};
 assert.doesNotThrow(()=>dynamicChanges(doc,ref,{[p.id]:'Riser-UP'}));
});


test('DYNB editor displays a persistent warning for an obsolete visibility name',()=>{
 const dyn=doc.sharedBlocks['RISER-U&D'].dynamic;
 const editor=D.dynamicEditor(dyn,{old:'Riser-UP'});
 assert.equal(editor.fields[0].readonly,true);
 assert.match(editor.fields[0].value,/Riser-UP/);
 assert.equal(editor.fields[1].value,'UP');
 assert.deepEqual(D.dynamicEditorValues(editor.params,{['p'+dyn.parameters[0].id]:'DOWN'}),{[dyn.parameters[0].id]:'DOWN'});
});


const exampleDynamic=(kind)=>{
 const p={id:1,kind,label:'시험값',p1:{x:0,y:0},p2:{x:0,y:1},value:kind==='flip'?0:kind==='rotation'?0:{x:0,y:1},labels:['기본','뒤집기']};
 const action={id:2,kind:kind==='rotation'?'rotate':kind==='xy'?'move':'flip',param:1,handles:['line','text'],center:{x:0,y:0}};
 const def={origin:{x:0,y:0},dynamic:{parameters:[p],actions:[action]},entities:[
  {id:'line',sourceHandle:'line',type:'line',layer:'A-기호',points:[{x:2,y:1},{x:4,y:3}]},
  {id:'text',sourceHandle:'text',type:'text',layer:'A-기호',position:{x:2,y:1},height:1,rotation:0,text:'표시'},
  {id:'fixed',sourceHandle:'fixed',type:'circle',layer:'A-기호',center:{x:8,y:9},radius:1}
 ]};
 const ref={id:'r',type:'block',name:'시험',sharedBlock:'시험',layer:'A-기호',position:{x:100,y:200},rotation:90,scale:2,entities:[],dynamic:{source:'시험',values:{1:p.value}}};
 return {def,p,action,ref,doc:{version:3,units:'mm',layers:[{id:'A-기호',name:'A-기호',color:'#ffffff',visible:true,locked:false}],blocks:[],sharedBlocks:{시험:def},entities:[ref]}};
};
for(const [kind,value,expected] of [['flip',1,[{x:-2,y:1},{x:-4,y:3}]],['rotation',Math.PI/2,[{x:-1,y:2},{x:-3,y:4}]]]){
 test(kind+' changes selected geometry, reads current value, and undo restores the shared reference',()=>{
  const sample=exampleDynamic(kind),{def,p,doc,ref}=sample;
  assert.equal(currentValues(def.dynamic,{1:0})[1],0);
  const computed=computeEntities(def,def.dynamic,{1:value});
  computed[0].points.forEach((pt,i)=>{near(pt.x,expected[i].x);near(pt.y,expected[i].y);});
  assert.deepEqual(computed[2],def.entities[2]);
  const engine=new DrawingEngine();engine.execute({type:'load',document:doc});
  const before=structuredClone(engine.doc.entities),source=structuredClone(engine.doc.sharedBlocks);
  engine.execute({type:'update',ids:['r'],changes:dynamicChanges(engine.doc,engine.doc.entities[0],{1:value})});
  assert.equal(engine.doc.entities[0].sharedBlock,undefined);
  assert.deepEqual(engine.doc.sharedBlocks,source);
  const back=dynamicChanges(doc,{...ref,...dynamicChanges(doc,ref,{1:value})},{1:0});
  sameBounds(box(back.entities),box(G.materializeSharedDrawingReference(doc,ref).entities));
  engine.execute({type:'undo'});assert.deepEqual(engine.doc.entities,before);
 });
}

test('Flip editor requires explicit choice when the original state cannot be read',()=>{
 const {def,doc,ref}=exampleDynamic('flip'),editor=D.dynamicEditor(def.dynamic,{1:null});
 const field=editor.fields.find(f=>f.name==='p1');
 assert.equal(field.value,'');assert.match(editor.warnings.join(' '),/알 수 없/);
 assert.equal(D.dynamicEditorValues(editor.params,{p1:''})[1],null);
 assert.throws(()=>dynamicChanges(doc,ref,{1:null}),/대칭|고르/);
 assert.equal(D.dynamicEditorValues(editor.params,{p1:'1'})[1],1);
});

test('Rotation editor uses degrees while stored values remain radians, including negative and zero',()=>{
 const {def}=exampleDynamic('rotation'),editor=D.dynamicEditor(def.dynamic,{1:-Math.PI/2});
 assert.match(editor.fields[0].label,/도/);near(editor.fields[0].value,-90);
 near(D.dynamicEditorValues(editor.params,{p1:'180'})[1],Math.PI);
 assert.equal(currentValues(def.dynamic,{1:0})[1],0);
 assert.equal(currentValues(def.dynamic,{1:-.5})[1],-.5);
});


test('XY applies separate X/Y stretch and move links, with one undo restoring the reference',()=>{
 const {def,ref,doc}=exampleDynamic('xy');
 def.dynamic.actions=[
  {kind:'stretch',param:1,xConnection:{id:1,name:'EndX'},yConnection:{id:1,name:'EndY'},bindings:[{h:'line',t:'Line',points:[1]}]},
  {kind:'move',param:1,xConnection:{id:1,name:'EndX'},yConnection:{id:1,name:'EndY'},handles:['text']}
 ];
 const value={x:5,y:-2},before=structuredClone(def),computed=computeEntities(def,def.dynamic,{1:value});
 assert.deepEqual(computed[0].points,[{x:2,y:1},{x:9,y:0}]);
 assert.deepEqual(computed[1].position,{x:7,y:-2});
 assert.deepEqual(computed[2],def.entities[2]);assert.deepEqual(def,before);
 assert.deepEqual(currentValues(def.dynamic,{1:{x:0,y:0}})[1],{x:0,y:0});
 const editor=D.dynamicEditor(def.dynamic,{1:value});
 assert.deepEqual(editor.fields.map(f=>f.name),['p1x','p1y']);
 assert.deepEqual(D.dynamicEditorValues(editor.params,{p1x:'5',p1y:'-2'})[1],value);
 const engine=new DrawingEngine();engine.execute({type:'load',document:doc});
 const initial=structuredClone(engine.doc.entities);
 engine.execute({type:'update',ids:['r'],changes:dynamicChanges(engine.doc,engine.doc.entities[0],{1:value})});
 assert.deepEqual(engine.doc.entities[0].dynamic.values[1],value);
 engine.execute({type:'undo'});assert.deepEqual(engine.doc.entities,initial);
 const back=dynamicChanges(doc,{...ref,...dynamicChanges(doc,ref,{1:value})},{1:def.dynamic.parameters[0].value});
 sameBounds(box(back.entities),box(G.materializeSharedDrawingReference(doc,ref).entities));
 assert.throws(()=>dynamicChanges(doc,ref,{1:{x:Infinity,y:0}}),/가로|거리|좌표/);
});

test('XY uses only connected axes and respects midpoint, distance multiplier and angle offset',()=>{
 const {def}=exampleDynamic('xy');def.dynamic.parameters[0].baseLocation='MidPoint';
 def.dynamic.actions=[{kind:'move',param:1,xConnection:{id:1,name:'BaseX'},handles:['line'],multiplier:2,angle:Math.PI/2}];
 const after=computeEntities(def,def.dynamic,{1:{x:4,y:99}});
 near(after[0].points[0].x,2);near(after[0].points[0].y,-3);
 assert.deepEqual(after[1],def.entities[1]);
});


test('a partially understood definition is not rebuilt over an unsupported action',()=>{
 const {def,doc,ref}=exampleDynamic('flip');def.dynamic.unsupported=['BlockLookupParameter'];
 const original=structuredClone(ref),editor=D.dynamicEditor(def.dynamic,{1:0});
 assert.match(editor.warnings.join(' '),/아직|지원/);
 assert.throws(()=>dynamicChanges(doc,ref,{1:1}),/아직|지원/);
 assert.deepEqual(ref,original);
});


for(const nested of [false,true])for(const mirrored of [false,true])test('Flip keeps nested shared geometry correct: inline='+nested+', mirrored='+mirrored,()=>{
 const {def,ref,doc}=exampleDynamic('flip');
 doc.sharedBlocks.inner={origin:{x:0,y:0},entities:[{id:'inside-line',type:'line',layer:'A-기호',points:[{x:1,y:1},{x:2,y:3}]}]};
 const child={id:'child',sourceHandle:'child',type:'block',sharedBlock:'inner',position:{x:2,y:0},scale:1,scaleX:2,scaleY:3,rotation:37,mirror:mirrored,entities:[]};
 const selected=nested?{id:'outer',sourceHandle:'child',type:'block',entities:[child]}:child;
 def.entities=[selected];def.dynamic.actions[0].handles=['child'];
 Object.assign(ref,{position:{x:0,y:0},rotation:0,scale:1});
 const material=G.materializeSharedDrawingReference(doc,ref),expected=G.mirror(material,{x:0,y:0},{x:0,y:1});
 const actual=dynamicChanges(doc,ref,{1:1});
 const points=e=>e.type==='line'?e.points:(e.entities||[]).flatMap(points);
 const actualPoints=actual.entities.flatMap(points),expectedPoints=expected.entities.flatMap(points);
 assert.equal(actualPoints.length,expectedPoints.length);
 actualPoints.forEach((p,i)=>{near(p.x,expectedPoints[i].x);near(p.y,expectedPoints[i].y);});
});

// Cross-review regressions: unknown data must not move geometry.
for(const kind of ['flip','rotation','linear','xy'])for(const unknown of [null,undefined])test(kind+' leaves geometry unchanged for unknown current/default values '+unknown,()=>{
 const {def,p,action}=exampleDynamic(kind);
 if(kind==='linear'){p.value=10;p.p2={x:10,y:0};action.kind='move';}
 if(kind==='rotation')p.value=Math.PI/2;
 const original=structuredClone(def);
 assert.deepEqual(computeEntities(def,def.dynamic,{1:unknown}),def.entities);
 p.value=unknown;
 const known=kind==='xy'?{x:3,y:4}:kind==='flip'?1:2;
 assert.deepEqual(computeEntities(def,def.dynamic,{1:known}),def.entities);
 assert.deepEqual(original.entities,def.entities);
});

test('unknown scalar old keys never guess linear, rotation or flip values',()=>{
 for(const kind of ['linear','rotation','flip']){
  const {def}=exampleDynamic(kind);
  assert.equal(currentValues(def.dynamic,{1:null,old:1})[1],null);
  assert.equal(currentValues(def.dynamic,{old:1})[1],null);
 }
});

test('null placeholders permit an unambiguous old XY or visibility value',()=>{
 const {def}=exampleDynamic('xy');
 assert.deepEqual(currentValues(def.dynamic,{1:null,old:{x:3,y:-2}})[1],{x:3,y:-2});
 const dyn={parameters:[{id:1,kind:'visibility',states:[{name:'모양'}]}]};
 assert.equal(currentValues(dyn,{1:null,old:'모양'})[1],'모양');
 assert.equal(currentValues(def.dynamic,{1:null,a:{x:1,y:2},b:{x:3,y:4}})[1],null);
});

for(const actionKind of ['move','stretch'])test('Y-only '+actionKind+' ignores disconnected X sentinel',()=>{
 const {def}=exampleDynamic('xy');
 def.dynamic.actions=[{kind:actionKind,param:-1,xConnection:{id:-1,name:''},yConnection:{id:1,name:'EndY'},handles:['line'],bindings:[{h:'line',t:'Line',points:[1]}]}];
 const after=computeEntities(def,def.dynamic,{1:{x:88,y:4}});
 assert.deepEqual(after[0].points,[{x:2,y:actionKind==='move'?4:1},{x:4,y:6}]);
});

for(const kind of ['flip','rotation','linear','xy'])test('editor treats whitespace as missing '+kind,()=>{
 const {def,doc,ref}=exampleDynamic(kind);
 if(kind==='linear')def.dynamic.parameters[0].value=10;
 const editor=D.dynamicEditor(def.dynamic),fields=kind==='xy'?{p1x:' \t ',p1y:'1'}:{p1:' \t '};
 const values=D.dynamicEditorValues(editor.params,fields);
 assert.equal(values[1],null);
 assert.throws(()=>dynamicChanges(doc,ref,values));
});

for(const missing of [null,undefined])test('visibility missing input stays absent '+missing,()=>{
 const params=[{id:1,kind:'visibility',states:[{name:'모양'}]}],values=D.dynamicEditorValues(params,{p1:missing}),warnings=[];
 assert.equal(values[1],null);
 assert.equal(currentValues({parameters:params},values,warnings)[1],'모양');
 assert.deepEqual(warnings,[]);
});

for(const [kind,values] of [['rotation',[Math.PI/2,Math.PI,0]],['flip',[1,0]],['linear',[150,50,100]],['xy',[{x:20,y:30},{x:0,y:1}]]])test('controlled attribute follows '+kind+' repeatedly while preserving text and style',()=>{
 const {def,p,action,doc,ref}=exampleDynamic(kind);
 if(kind==='linear'){p.value=100;p.p2={x:100,y:0};action.kind='move';ref.dynamic.values[1]=100;}
 if(kind==='xy'){action.xConnection={id:1,name:'EndX'};action.yConnection={id:1,name:'EndY'};}
 const base={id:'attr',sourceHandle:'attr',type:'text',layer:'A-문자',position:{x:100,y:0},height:3,rotation:0,text:'기본',attdef:{tag:'NO',default:'기본'}};
 def.entities.push(base);action.handles.push('attr');
 Object.assign(ref,{position:{x:0,y:0},rotation:0,scale:1,attributes:{NO:'203'},entities:[{...base,attdef:undefined,attributeTag:'NO',text:'203',font:'검수체',widthFactor:.7}]});
 const initial=structuredClone(ref);let changed=ref;
 for(const value of values){
  changed={...changed,...dynamicChanges(doc,changed,{1:value})};
  const actual=changed.entities.filter(e=>e.attributeTag==='NO');assert.equal(actual.length,1);
  const expected=computeEntities(def,def.dynamic,{1:value}).find(e=>e.sourceHandle==='attr');
  near(actual[0].position.x,expected.position.x);near(actual[0].position.y,expected.position.y);near(actual[0].rotation,expected.rotation);
  assert.equal(actual[0].text,'203');assert.equal(actual[0].font,'검수체');assert.equal(actual[0].widthFactor,.7);
 }
 assert.deepEqual(ref,initial);
});

test('unknown rotation base blocks rebuilding the reference',()=>{
 const {def,doc,ref}=exampleDynamic('rotation');def.dynamic.parameters[0].value=null;
 const original=structuredClone(ref);
 assert.throws(()=>dynamicChanges(doc,ref,{1:Math.PI/2}),/원래|기준|알 수/);
 assert.deepEqual(ref,original);
});

for(const mirrored of [false,true])for(const nonuniform of [false,true])test('controlled attribute retains custom offset through rotated/scaled placement: mirror='+mirrored+', nonuniform='+nonuniform,()=>{
 const {def,p,action,ref,doc}=exampleDynamic('rotation');
 const attr={id:'attr',sourceHandle:'attr',type:'text',layer:'A-문자',position:{x:105,y:7},height:3,rotation:17,attributeTag:'NO',text:'203',font:'검수체',widthFactor:.7,hidden:true};
 def.origin={x:11,y:-13};
 def.entities.push({...attr,position:{x:100,y:0},attdef:{tag:'NO',default:'기본'}});action.handles.push('attr');
 Object.assign(ref,{position:{x:321,y:654},rotation:37,scale:2,mirror:mirrored,...(nonuniform?{scaleX:3,scaleY:2}:{}),attributes:{NO:'203'}});
 const local={...def,entities:[attr]},placed=(v)=>G.materializeSharedDrawingReference({sharedBlocks:{own:{origin:def.origin,entities:computeEntities(local,def.dynamic,{1:v})}}},{...ref,sharedBlock:'own',entities:[]}).entities[0];
 ref.dynamic.values[1]=Math.PI/4;ref.entities=[placed(Math.PI/4)];
 let changed=ref;
 for(const value of [Math.PI/2,-Math.PI/3,0]){
  changed={...changed,...dynamicChanges(doc,changed,{1:value})};
  const actual=changed.entities.find(e=>e.attributeTag==='NO'),expected=placed(value);
  near(actual.position.x,expected.position.x);near(actual.position.y,expected.position.y);
  near(((actual.rotation-expected.rotation)%360+360)%360,0);
  near(actual.height,expected.height);near(actual.widthFactor,expected.widthFactor);assert.equal(actual.hidden,true);assert.equal(actual.font,'검수체');
 }
});

test('controlled attributes preserve an offset with composed rotation and move actions',()=>{
 const {def,action,ref,doc}=exampleDynamic('rotation');
 const attr={id:'attr',sourceHandle:'attr',type:'text',layer:'A-문자',position:{x:105,y:7},height:3,rotation:17,attributeTag:'NO',text:'203'};
 def.entities.push({...attr,attdef:{tag:'NO',default:'기본'}});action.handles.push('attr');
 def.dynamic.parameters.push({id:2,kind:'linear',value:10,p1:{x:0,y:0},p2:{x:10,y:0}});
 def.dynamic.actions.push({kind:'move',param:2,handles:['attr']});
 Object.assign(ref,{position:{x:0,y:0},rotation:0,scale:1,attributes:{NO:'203'},dynamic:{source:'시험',values:{1:0,2:10}},entities:[attr]});
 let changed=ref;
 for(const values of [{1:Math.PI/2,2:30},{1:Math.PI,2:20},{1:0,2:10}]){
  changed={...changed,...dynamicChanges(doc,changed,values)};
  const actual=changed.entities.find(e=>e.attributeTag==='NO'),expected=G.translate(G.rotate(attr,{x:0,y:0},values[1]*180/Math.PI),values[2]-10,0);
  near(actual.position.x,expected.position.x);near(actual.position.y,expected.position.y);near(actual.rotation,expected.rotation);
 }
});

test('controlled attributes with an unreadable previous value keep the reference untouched',()=>{
 const {def,action,ref,doc}=exampleDynamic('rotation');
 const attr={id:'attr',sourceHandle:'attr',type:'text',layer:'A-문자',position:{x:100,y:0},height:3,rotation:0,attributeTag:'NO',text:'203'};
 def.entities.push({...attr,attdef:{tag:'NO',default:'기본'}});action.handles.push('attr');
 ref.entities=[attr];ref.dynamic.values[1]=null;
 const before=structuredClone(ref);
 assert.throws(()=>dynamicChanges(doc,ref,{1:Math.PI/2}),/원래|알 수/);assert.deepEqual(ref,before);
});


test('mirrored placement keeps attribute alignment and fitting points through repeated unchanged values',()=>{
 const {def,action,ref,doc}=exampleDynamic('rotation');
 const attr={id:'attr',type:'text',layer:'A-문자',attributeTag:'NO',position:{x:-100,y:0},height:3,rotation:0,text:'203',align:'right',justify:'R',alignPoint:{x:-90,y:0},fitTo:{x:-80,y:0}};
 def.entities.push({type:'text',sourceHandle:'attr',position:{x:100,y:0},height:3,text:'기본',attdef:{tag:'NO',default:'기본'}});action.handles.push('attr');
 Object.assign(ref,{position:{x:0,y:0},scale:1,rotation:0,mirror:true,entities:[attr]});
 let changed=ref;
 for(let i=0;i<3;i++){
  changed={...changed,...dynamicChanges(doc,changed,{1:0})};
  const actual=changed.entities.find(e=>e.attributeTag==='NO');
  for(const key of ['align','justify','position','alignPoint','fitTo'])assert.deepEqual(actual[key],attr[key]);
 }
});

test('XY ignores a connection with an empty name even if its node id exists',()=>{
 const {def}=exampleDynamic('xy');
 def.dynamic.actions=[{kind:'move',param:1,xConnection:{id:1,name:' '},yConnection:{id:1,name:'EndY'},handles:['line']}];
 assert.deepEqual(computeEntities(def,def.dynamic,{1:{x:88,y:4}})[0].points,[{x:2,y:4},{x:4,y:6}]);
});


test('an unchanged flip keeps attribute fitting through another changed action',()=>{
 const {def,action,ref,doc}=exampleDynamic('flip');
 const attr={id:'attr',type:'text',layer:'A-문자',attributeTag:'NO',position:{x:-100,y:0},height:3,rotation:180,text:'203',justify:'R',alignPoint:{x:-90,y:0},fitTo:{x:-80,y:0}};
 def.entities.push({type:'text',sourceHandle:'attr',position:{x:100,y:0},height:3,text:'기본',attdef:{tag:'NO',default:'기본'}});action.handles.push('attr');
 def.dynamic.parameters.push({id:2,kind:'rotation',value:0,p1:{x:0,y:0},p2:{x:1,y:0}});
 def.dynamic.actions.push({kind:'rotate',param:2,center:{x:0,y:0},handles:['attr']});
 Object.assign(ref,{position:{x:0,y:0},scale:1,rotation:0,entities:[attr],dynamic:{source:'시험',values:{1:1,2:0}}});
 let changed=ref;
 for(const values of [{1:1,2:0},{1:1,2:Math.PI/2}]){
  changed={...changed,...dynamicChanges(doc,changed,values)};
  const actual=changed.entities.find(e=>e.attributeTag==='NO'),expected=G.rotate(attr,{x:0,y:0},values[2]*180/Math.PI);
  assert.equal(actual.justify,'R');
  for(const key of ['position','alignPoint','fitTo']){near(actual[key].x,expected[key].x);near(actual[key].y,expected[key].y);}
 }
});
