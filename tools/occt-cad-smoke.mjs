// Actual CAD command smoke and artifacts, without DOM or browser uploads.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DrawingEngine} from '../engine.js';
import {runScripted} from '../command-runner.js';
import {hatchSegments} from '../hatch-patterns.js';
import {readOcctFixture} from './occt-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),out=path.join(root,'tmp/occt-spike');
await mkdir(out,{recursive:true});
const engine=new DrawingEngine(),model=await readOcctFixture();
engine.execute({type:'load',document:{...engine.doc,drawingSets:{sariro:{kind:'plan',model,options:{origin:{x:0,y:0}}}}}});
engine.undoStack=[];
const summary=[];
for(const [name,stem,inputs] of [
 ['OCCTPLAN','cad-plan',{points:[[0,0]]}],
 ['OCCTSECTION','cad-section',{points:[[0,3000],[12000,3000],[0,4000],[15000,0]]}],
 ['OCCTELEVATION','cad-elevation',{form:{face:'south'},points:[[30000,0]]}]
]){
 const before=engine.doc,undo=engine.undoStack.length,started=performance.now();
 const result=await runScripted(engine,name,inputs),ms=performance.now()-started;
 if(engine.undoStack.length!==undo+1)throw Error('Expected exactly one undo entry');
 const after=engine.doc;engine.execute({type:'undo'});if(engine.doc!==before)throw Error('Undo did not restore source');engine.execute({type:'redo'});
 const added=new Set(result.added),doc={...after,entities:after.entities.filter(e=>added.has(e.id))};
 const renderHatches=doc.entities.filter(e=>e.type==='hatch').map(e=>{const ps=e.points;const box={minX:Math.min(...ps.map(p=>p.x)),maxX:Math.max(...ps.map(p=>p.x)),minY:Math.min(...ps.map(p=>p.y)),maxY:Math.max(...ps.map(p=>p.y))};return {id:e.id,...hatchSegments(e.patternLines,box,{maxSegments:100000})};});
 await writeFile(path.join(out,stem+'.json'),JSON.stringify(doc,null,2));
 await writeFile(path.join(out,stem+'-render.json'),JSON.stringify({doc,renderHatches,title:name+' · actual Node CAD command output'}));
 const rendered=spawnSync('python',[path.join(root,'tools/occt-cad-render.py'),path.join(out,stem+'-render.json')],{cwd:root,encoding:'utf8',windowsHide:true});
 if(rendered.status!==0)throw Error(rendered.stderr || rendered.stdout);
 const checks=JSON.parse(rendered.stdout);
 summary.push({name,stem,ms,entities:doc.entities.length,hatches:renderHatches.length,undo:'one step',...checks});
}
await writeFile(path.join(out,'cad-all.bcad'),JSON.stringify(engine.doc));
await writeFile(path.join(out,'cad-smoke.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
