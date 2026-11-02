import test from 'node:test';
import assert from 'node:assert/strict';
import {correctGpuHatchPattern} from './gpu-fills.js';
import fs from 'node:fs';
// Exercise the exact bundled shader text, including its current guard structure.
const bundle=fs.readFileSync(new URL('./vendor/mlightcad.js',import.meta.url),'utf8');
const start=bundle.indexOf('float drawSolidLine('),end=bundle.indexOf('float drawLine(',start);
const material=()=>({uniforms:{u_patternLines:{value:[]}},fragmentShader:bundle.slice(start,end),userData:{retained:true},version:0,set needsUpdate(v){if(v)this.version++;}});
test('corrects bundled hatch shader once without replacing uniforms or ownership',()=>{
 const m=material(),uniforms=m.uniforms;correctGpuHatchPattern(m);
 assert.match(m.fragmentShader,/float distanceBetweenLines = abs\(offset.y\);/);
 assert.doesNotMatch(m.fragmentShader,/length\(offset\)|samplePos.y \* offset.x \/ offset.y/);
 assert.match(m.fragmentShader,/floor\(samplePos.y \/ offset.y \+ 0.5\) \* offset.x/);
 assert.equal((m.fragmentShader.match(/distanceBetweenLines <= 1e-9/g)||[]).length,2);
 assert.equal(m.uniforms,uniforms);assert.equal(m.userData.retained,true);assert.equal(m.version,1);
 correctGpuHatchPattern(m);assert.equal(m.version,1);
});
test('leaves solid/unrelated materials alone and rejects changed vendor shader atomically',()=>{
 const solid={fragmentShader:'solid'};correctGpuHatchPattern(solid);assert.deepEqual(solid,{fragmentShader:'solid'});
 const m=material();m.fragmentShader=m.fragmentShader.replace('float distanceBetweenLines = length(offset);','different');const before=m.fragmentShader;
 assert.throws(()=>correctGpuHatchPattern(m),/anchors missing/);assert.equal(m.fragmentShader,before);assert.equal(m.version,0);
});

test('a hatch without a usable outer boundary draws nothing instead of throwing; an unusable hole is dropped alone',async()=>{
 const {createGpuHatch}=await import('./gpu-fills.js');
 const areas=[];const renderer={subEntityTraits:{fillType:{}},area(a){areas.push(a);return null;}};
 const bad=createGpuHatch(renderer,{points:[{x:0,y:0},{x:1,y:1}],loops:[]});
 assert.ok(bad&&bad.isObject3D);assert.equal(areas.length,0);
 createGpuHatch(renderer,{points:[{x:0,y:0},{x:10,y:0},{x:10,y:10}],loops:[[{x:1,y:1}],[{x:1,y:1},{x:2,y:1},{x:2,y:2}]]});
 assert.equal(areas.length,1);
});
