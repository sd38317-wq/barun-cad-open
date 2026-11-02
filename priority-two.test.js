import test from 'node:test';import assert from 'node:assert/strict';import {DrawingEngine} from './engine.js';import * as G from './geometry.js';import {plotSVG} from './plot.js';import {installFileWorkflows} from './file-workflows.js';import {directParcelRequest} from './ai-actions.js';
test('polygon inverse clip splits lines, excludes interior picks, survives transform and undo',()=>{
 const e=new DrawingEngine(),p=(x,y)=>({x,y});const [id]=e.execute({type:'add',entity:{type:'block',name:'inverse',layer:'default',entities:[{type:'line',layer:'default',points:[p(-10,0),p(10,0)]}]}});
 e.execute({type:'xclip',ids:[id],points:[p(-5,-5),p(5,-5),p(0,5)]});e.execute({type:'xclip',ids:[id],operation:'invert'});const b=e.doc.entities[0];assert.equal(G.visiblePrimitives(b).length,2);assert.equal(G.entityDistance(b,p(0,0)),Infinity);assert.equal(G.entityDistance(b,p(9,0)),0);assert.match(plotSVG(e.doc,{fit:true}),/clip-rule="evenodd"/);assert.equal(G.selectionGrips(b).length,3);
 const before=structuredClone(b);e.execute({type:'move',ids:[id],dx:100,dy:30});assert.equal(G.entityDistance(e.doc.entities[0],p(100,30)),Infinity);e.execute({type:'undo'});assert.deepEqual(e.doc.entities[0],before);
 assert.throws(()=>e.execute({type:'xclip',ids:[id],points:[p(0,0),p(5,5),p(0,5),p(5,0)]}));assert.deepEqual(e.doc.entities[0],before);
});
test('XREF relative refresh, failed recovery, bind and detach preserve original and undo',async()=>{
 const engine=new DrawingEngine();let fields,apply,fail=false,last;const studio=installFileWorkflows({handlers:{},getFolder:()=> 'D:/project',context:{engine,execute:c=>engine.execute(c),activeLayer:()=> 'default',toast(){},field:(name,label,value)=>({name,value}),pointFields:()=>[{name:'x',value:0},{name:'y',value:0}],form:(title,f,cb)=>{fields=f;apply=cb;},api:async(name,args)=>{if(name==='project'){last=args;if(fail)throw Error('missing');return {data:'fixture',extension:'.dxf'};}return {report:{unitless:false},document:{entities:[{type:'line',layer:'default',points:[{x:0,y:0},{x:10,y:0}]}]}};}}});
 const run=async values=>{studio.handlers.XREF();await apply({...Object.fromEntries(fields.map(f=>[f.name,f.value])),...values});};
 await run({action:'attach',folder:'../refs',relative:'relative',name:'a.dxf'});const id=engine.doc.entities[0].id;assert.equal(last.baseFolder,'D:/project');const before=structuredClone(engine.doc.entities[0]);fail=true;await assert.rejects(run({action:'repath',id,folder:'missing'}));assert.deepEqual(engine.doc.entities[0],before);fail=false;
 await run({action:'repath',id,folder:'../fixed',relative:'relative',name:'b.dxf'});assert.equal(engine.doc.entities[0].xref.folder,'../fixed');assert.equal(engine.doc.entities[0].id,id);
 await run({action:'bind',id});assert.equal(engine.doc.entities[0].xref,null);engine.execute({type:'undo'});assert.ok(engine.doc.entities[0].xref);await run({action:'detach',id});assert.equal(engine.doc.entities.length,0);engine.execute({type:'undo'});assert.equal(engine.doc.entities[0].id,id);
});
test('parcel road and radius instructions retain address and reject negation',()=>{
 const result=directParcelRequest('부산 사리로 64-1 주변 도로 50m 대지 가져와');assert.equal(result.actions[0].args.query,'부산 사리로 64-1');assert.equal(result.actions[0].args.contextMeters,50);assert.equal(result.actions[0].args.surroundings,true);assert.equal(directParcelRequest('대지 가져오지 마'),null);
});
