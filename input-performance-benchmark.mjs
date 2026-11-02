import {performance} from 'node:perf_hooks';
import {DrawingEngine,blankDocument} from './engine.js';
import {spatialIndex} from './geometry.js';

const count=Number(process.argv[2]||100000);
const base=blankDocument();
base.entities=Array.from({length:count},(_,i)=>({
  id:`line-${i}`,
  type:'line',
  layer:'default',
  points:[{x:i*2,y:0},{x:i*2+1,y:1}],
}));

const measure=(name,command)=>{
  const engine=new DrawingEngine();
  engine.doc=base;
  const started=performance.now();
  engine.execute(command);
  return [name,Number((performance.now()-started).toFixed(3))];
};

const target=`line-${Math.floor(count/2)}`;
const results=Object.fromEntries([
  measure('add',{type:'add',entity:{type:'line',layer:'default',points:[{x:0,y:10},{x:1,y:11}]}}),
  measure('move',{type:'move',ids:[target],dx:10,dy:20}),
  measure('copy',{type:'copy',ids:[target],dx:10,dy:20}),
  measure('rotate',{type:'rotate',ids:[target],base:{x:0,y:0},angle:45}),
  measure('scale',{type:'scale',ids:[target],base:{x:0,y:0},factor:2}),
  measure('mirror',{type:'mirror',ids:[target],a:{x:0,y:0},b:{x:0,y:1}}),
  measure('delete',{type:'delete',ids:[target]}),
]);

let started=performance.now();
const index=spatialIndex(base.entities);
results.indexBuild=Number((performance.now()-started).toFixed(3));
let worstInsert=0;
for(let i=0;i<512;i++){
  started=performance.now();
  index.insert([{id:`delta-${i}`,type:'line',points:[{x:i*2,y:10},{x:i*2+1,y:11}]}]);
  worstInsert=Math.max(worstInsert,performance.now()-started);
}
results.worstOf512Inserts=Number(worstInsert.toFixed(3));
started=performance.now();
results.deltaQueryCount=index.query({minX:0,minY:9,maxX:1024,maxY:12}).length;
results.deltaQuery=Number((performance.now()-started).toFixed(3));

console.log(JSON.stringify({objects:count,milliseconds:results},null,2));
