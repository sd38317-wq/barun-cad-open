// Runs the actual app snap function with OSNAP on and unchanged private geometry.
// CPU snap timing only; excludes rendering and OS event dispatch.
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
const baseline=process.argv.includes('--baseline');
const G=await import(baseline?'../../tmp/release-6.0.4/source-freeze/geometry.js':'../../geometry.js');
import {snapIntersections} from '../../snap-intersections.js';
const source=fs.readFileSync(new URL(baseline?'../../tmp/release-6.0.4/source-freeze/app.js':'../../app.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('function snap('),source.indexOf('// 직교(F8)'));
const doc=JSON.parse(fs.readFileSync(new URL('../../tmp/interaction-113mb-20260927/drawing.private.json',import.meta.url),'utf8'));
G.prepareSharedDrawingReferences(doc);
const visible=G.visibleEntities(doc,{inPlace:true}),index=G.spatialIndex(visible);
const primitive=visible.flatMap(G.visiblePrimitives);
const dense=primitive.filter(e=>e.points?.length>256).sort((a,b)=>b.points.length-a.points.length);
const probes=dense.slice(0,12).map(e=>({...e.points[Math.floor(e.points.length/2)]}));
let timings={query:0,primitives:0,intersections:0,candidates:0};
const preciseBlocks=new WeakMap();
const timedG={...G};for(const name of ['snapGeometry','visiblePoint','entityDistance'])timedG[name]=(...args)=>{const s=performance.now();const r=G[name](...args);timings[name]=(timings[name]||0)+performance.now()-s;return r;};
const context={G:timedG,scale:.03,points:[],mode:'LINE',orthogonalInput:p=>p,num:()=>16,snapIntersections:(...args)=>{const s=performance.now();const r=snapIntersections(...args);timings.intersections+=performance.now()-s;return r;},
 $:id=>({checked:['osnap','snap-end','snap-mid','snap-center','snap-intersection'].includes(id)}),
 nearby:(p,t)=>{const box={minX:p.x-t,minY:p.y-t,maxX:p.x+t,maxY:p.y+t};let s=performance.now();const objects=index.query(box);timings.query+=performance.now()-s;s=performance.now();const r=objects.flatMap(e=>{if(e.type==='block'&&G.preciseSnapBlock){if(!preciseBlocks.has(e))preciseBlocks.set(e,G.preciseSnapBlock(doc,e));e=preciseBlocks.get(e);}return e?G.queryEntityPrimitives(e,box):[];});timings.primitives+=performance.now()-s;timings.candidates+=r.length;return r;}};
const summary={scope:'actual app snap() OSNAP ON, native Node function (no VM context overhead); CPU only, no renderer/OS latency',baseline,entities:doc.entities.length,primitives:primitive.length,densePolylines:dense.length,scale:context.scale,cases:[]};
for(const mode of ['LINE','MOVE']){
 context.mode=mode;timings={query:0,primitives:0,intersections:0,candidates:0};const samples=[],cold=[],coldStages=[],points=[];
 const snap=Function(...Object.keys(context),body+'\nreturn snap;')(...Object.values(context));
 for(const p of probes){const before={...timings};let start=performance.now();snap(p);cold.push(performance.now()-start);coldStages.push(Object.fromEntries(Object.entries(timings).map(([k,v])=>[k,v-(before[k]||0)])));
  for(let i=0;i<3;i++){const q={x:p.x+i*.25,y:p.y+i*.25};start=performance.now();const result=snap(q);samples.push(performance.now()-start);points.push(result);}}
 const a=[...samples].sort((a,b)=>a-b);summary.cases.push({mode,timings,coldMaxMs:Math.max(...cold),p50Ms:a[Math.floor(a.length*.5)],p95Ms:a[Math.floor(a.length*.95)],maxMs:a.at(-1),cold,coldStages,samples,points});
}
const out=process.argv[2]||'tmp/snap-command-after.json';fs.writeFileSync(out,JSON.stringify(summary,null,2));console.log(JSON.stringify({...summary,cases:summary.cases.map(({samples,points,...rest})=>rest)}));
