import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {spawnSync} from 'node:child_process';
test('LH PDF native paths load in editor and render clipped colors and hatch holes',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'lh2025-test-'));
 try{
  const geometry={version:1,units:'mm',layers:[{id:'lh2025',name:'LH',color:'#000000',visible:true,locked:false,lineweight:.1}],blocks:[],entities:[{id:'body',type:'block',layer:'lh2025',name:'body',clip:{enabled:true,points:[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]},entities:[{id:'white-paper',type:'hatch',layer:'lh2025',color:'#ffffff',colorMode:'truecolor',solid:true,spacing:100,angle:0,points:[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}],loops:[]},{id:'fill',type:'hatch',layer:'lh2025',color:'#ff0000',colorMode:'truecolor',solid:true,spacing:100,angle:0,points:[{x:10,y:10},{x:90,y:10},{x:90,y:90},{x:10,y:90}],loops:[[{x:30,y:30},{x:70,y:30},{x:70,y:70},{x:30,y:70}]]},{id:'line',type:'polyline',layer:'lh2025',color:'#0000ff',lineweight:.2,points:[{x:0,y:0},{x:50,y:100},{x:100,y:0}]}]}]};
  const source=path.join(folder,'detail.json.gz'),svg=path.join(folder,'render.svg');fs.writeFileSync(source,zlib.gzipSync(JSON.stringify({geometry})));
  const input=path.join(folder,'jobs.json'),output=path.join(folder,'results.json');fs.writeFileSync(input,JSON.stringify([{id:'synthetic',path:source,svg,bounds:{minX:0,minY:0,maxX:100,maxY:100}}]));
  const result=spawnSync('node',['tools/lh_details/lh2025_render.mjs',input,output],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const job=JSON.parse(fs.readFileSync(output,'utf8'))[0];assert.equal(job.valid,true,job.error);
  const rendered=fs.readFileSync(svg,'utf8');assert.match(rendered,/fill-rule="evenodd"/);assert.match(rendered,/#ff0000/);assert.match(rendered,/fill="#ffffff"[^>]*fill-rule="evenodd"|fill-rule="evenodd"[^>]*fill="#ffffff"/);assert.match(rendered,/clipPath/);assert.match(rendered,/viewBox="61\.5 0 297 297"/);
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
