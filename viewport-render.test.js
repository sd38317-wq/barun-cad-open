import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as G from './geometry.js';
const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
function setup(entities){
 let builds=0;
 const c={engine:{doc:{entities}},visible:()=>entities,sceneRevision:1,visibleGeneration:1,
  width:100,height:100,scale:1,origin:{x:0,y:100},nearby:{},warmNearbyIndex:{},
  G:{...G,spatialIndex:items=>{builds++;return G.spatialIndex(items);}}};
 c.world=p=>({x:(p.x-c.origin.x)/c.scale,y:(c.origin.y-p.y)/c.scale});
 // app.js: small drawings pick from visible(), large ones from the whole document.
 c.pickCandidates=()=>c.visible();c.pickGeneration=()=>c.engine.doc.entities.length>50000?-1:c.visibleGeneration;
 vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('function setNearbyObjects('),source.indexOf('function warmNearbyIndex('))+source.slice(source.indexOf('function prepareNearbyIndexNow('),source.indexOf('// 선택 상자에 걸릴'))+source.slice(source.indexOf('function viewportDrawingEntities('),source.indexOf('function paintFrame()')),c);
 return {c,builds:()=>builds};
}
const lines=()=>Array.from({length:18000},(_,i)=>({id:String(i),type:'line',points:[{x:i*10,y:0},{x:i*10+1,y:1}]}));
test('18k drawing redraw culls offscreen objects and reuses the index through pan and zoom',()=>{
 const entities=lines(),s=setup(entities);
 const initial=s.c.viewportDrawingEntities();assert.equal(initial.length,19);assert.equal(s.builds(),1);
 s.c.origin.x=-10000;const panned=s.c.viewportDrawingEntities();assert.equal(panned[0].id,'992');
 s.c.scale=2;s.c.viewportDrawingEntities();assert.equal(s.builds(),1);
 assert.equal(s.c.visible().length,18000);assert.equal(G.bounds(s.c.visible()).maxX,179991);
});
test('draw order, crossing lines and block bounds survive viewport filtering',()=>{
 const entities=lines();
 const block={id:'block',type:'block',entities:[{type:'line',points:[{x:-500,y:50},{x:500,y:50}]}]};
 entities.splice(2,0,block);const s=setup(entities),shown=s.c.viewportDrawingEntities();
 assert.deepEqual(shown.slice(0,4).map(e=>e.id),['0','1','block','2']);
 assert.equal(shown.find(e=>e.id==='block'),block);
});
test('edits invalidate culling and tab switch uses the next drawing',()=>{
 const s=setup(lines());s.c.viewportDrawingEntities();
 const next=[...lines(),{id:'new',type:'point',position:{x:50,y:50}}];
 s.c.engine.doc.entities=next;s.c.visible=()=>next;s.c.sceneRevision++;s.c.visibleGeneration++;
 assert.ok(s.c.viewportDrawingEntities().some(e=>e.id==='new'));assert.equal(s.builds(),2);
 const small=[{id:'small',type:'point',position:{x:0,y:0}}];s.c.engine.doc.entities=small;s.c.visible=()=>small;
 assert.equal(s.c.viewportDrawingEntities(),small);
});
