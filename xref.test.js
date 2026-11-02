import test from 'node:test';import assert from 'node:assert/strict';import {DrawingEngine} from './engine.js';import * as G from './geometry.js';import {installFileWorkflows} from './file-workflows.js';
test('XREF refresh preserves clip, identity and transformed geometry including mirror',async()=>{
 const engine=new DrawingEngine();let fields,apply;const source={type:'line',layer:'default',points:[{x:0,y:0},{x:100,y:200}]};
 const studio=installFileWorkflows({handlers:{},getFolder:()=>'',context:{engine,execute:c=>engine.execute(c),activeLayer:()=> 'default',toast(){},field:(name,label,value)=>({name,value}),pointFields:()=>[{name:'x',value:0},{name:'y',value:0}],form:(title,f,callback)=>{fields=f;apply=callback;},api:async name=>name==='project'?{data:'fixture',extension:'.dxf'}:{report:{unitless:false},document:{entities:[source]}}}});
 const run=async values=>{studio.handlers.XREF();await apply({...Object.fromEntries(fields.map(f=>[f.name,f.value])),...values});};
 await run({action:'attach',folder:'fixture',name:'test.dxf',x:1000,y:2000,scale:2});const id=engine.doc.entities[0].id;
 engine.execute({type:'xclip',ids:[id],points:G.rectangle({x:900,y:1900},{x:1300,y:2500})});
 const {id:unusedId,type:unusedType,...mirrored}=G.mirror(G.rotate(engine.doc.entities[0],{x:0,y:0},35),{x:0,y:0},{x:0,y:100});engine.execute({type:'update',ids:[id],changes:mirrored});
 const before=structuredClone(engine.doc.entities[0]);await run({action:'refresh',id});const after=engine.doc.entities[0];
 assert.equal(after.id,id);assert.deepEqual(after.clip,before.clip);
 for(let i=0;i<2;i++)assert.ok(G.dist(after.entities[0].points[i],before.entities[0].points[i])<1e-6);
 engine.execute({type:'undo'});assert.deepEqual(engine.doc.entities[0],before);
});
