import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {LiveChecker} from './livecheck-engine.js';
import {parseActions,stageActions} from './ai-actions.js';
import {plotPDFJob} from './plot.js';
import fs from 'node:fs';
const rect=(n)=>({type:'rectangle',layer:'default',points:[{x:0,y:0},{x:n,y:0},{x:n,y:n},{x:0,y:n}]});
test('idle right-click cannot repeat the previous command and middle double-click fits the drawing',()=>{
 const source=fs.readFileSync('app.js','utf8');
 // 명령 없이 우클릭하면 바로가기 메뉴만 연다(예전처럼 직전 명령을 저절로 반복하지 않는다).
 assert.match(source,/if\(mode==='SELECT'&&phase==='idle'\)\{showCanvasMenu\(e\.clientX,e\.clientY,idleMenuItems\(\)\);return;\}/);
 assert.doesNotMatch(source,/idleMenuItems\(\)\);[^}]*run\(lastCommand\)/,'메뉴를 여는 줄에서 직전 명령을 바로 실행하지 않는다');
 assert.match(source,/if\(e\.button===1\)\{\s*e\.preventDefault\(\);drag=null;fit\(\)/);
});
test('desktop open dialog remembers the last drawing directory',()=>{
 const source=fs.readFileSync('desktop.cjs','utf8');
 assert.match(source,/defaultPath:lastDrawingDirectory/);
 assert.match(source,/lastDrawingDirectory=path\.dirname\(result\.filePaths\[0\]\)/);
});
test('heavy drawing open reports stages, elapsed time and waits for first painted frames',()=>{
 const app=fs.readFileSync('app.js','utf8'),desktop=fs.readFileSync('desktop.cjs','utf8'),preload=fs.readFileSync('desktop-preload.cjs','utf8'),html=fs.readFileSync('index.html','utf8');
 assert.match(html,/id="drawing-load-overlay"/);assert.match(app,/beginDrawingLoad\(file\.name\)/);assert.match(app,/drawing-load-elapsed/);assert.match(app,/await loadPaint\(\);await loadPaint\(\);/);assert.match(app,/function loadPaint\(\)\{return document\.hidden\?recoveryNextTask\(\)/);assert.match(app,/requestAnimationFrame\(finish\);setTimeout\(finish,250\)/);assert.match(preload,/onImportProgress/);assert.match(desktop,/timeoutMs:1_250_000/);
});
test('baseline roles exclude site, detect changed boundary and recover on undo',()=>{
 const e=new DrawingEngine();const [site,building]=e.execute({type:'addMany',entities:[rect(10000),rect(8000)]});e.doc.layers[0].building=true;
 const shape=e.doc.entities[0];e.doc.siteAnalysis={version:1,units:'mm',areaUnits:'m2',siteArea:100,coverageLimit:60,farLimit:200,ruleId:'synthetic',buildable:[{outer:shape.points}],sourceIds:{site,buildable:site},sourceGeometry:[{id:site,points:structuredClone(shape.points),loops:[]}]};
 const c=new LiveChecker();let r=c.run(e.doc);assert.equal(r.coverage,64);assert.equal(r.targetCount,1);assert.equal(r.areaSummary.coverageArea,64);
 e.execute({type:'scale',ids:[site],base:{x:0,y:0},factor:2});r=c.run(e.doc);assert.equal(r.active,false);assert.equal(r.stale,true);assert.equal(r.coverage,null);e.execute({type:'undo'});assert.equal(c.run(e.doc).coverage,64);
 e.execute({type:'delete',ids:[building]});r=c.run(e.doc);assert.equal(r.targetCount,0);assert.ok(r.findings.some(f=>f.type==='no_targets'));
});
test('AI native door generation is real parametric geometry and updates atomically',()=>{
 const e=new DrawingEngine();const plan=parseActions(JSON.stringify({actions:[{cmd:'architecture',args:{command:'DOD',options:{x:30000,y:0,width:900,style:'single'}}}],ask:null,note:null}));const result=stageActions(e,plan,{activeLayer:'default'});const door=result.document.entities[0];assert.equal(door.category,'DOOR');assert.equal(door.parameters.width,900);assert.equal(door.position.x,30000);assert.equal(e.doc.entities.length,0);
 assert.throws(()=>stageActions(e,{...plan,actions:[...plan.actions,{cmd:'architecture',args:{command:'DOD',options:{x:0,y:0,width:-1}}}]},{activeLayer:'default'}));assert.equal(e.doc.entities.length,0);
});
test('direct PDF job preserves paper direction, scale, geometry and CTB-free automatic ink',()=>{const e=new DrawingEngine();e.execute({type:'add',entity:rect(10000)});const j=plotPDFJob(e.doc,{paper:'A4',orientation:'portrait',fit:true,margin:12});assert.deepEqual(j.size,[210,297]);assert.ok(j.denominator>0);assert.equal(j.entities.length,1);assert.equal(j.entities[0].color,'#5798b6');/* 자동 보정 기본은 5.0.3 과 같다(밝은 색 진하게는 옵션 darkenLightColors) */});
