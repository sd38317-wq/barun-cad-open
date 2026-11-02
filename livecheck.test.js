import test from 'node:test';import assert from 'node:assert/strict';
import {LiveChecker,validateAnalysis} from './livecheck-engine.js';
test('source engine reports unknown floor layers and assumed floor height metadata',async()=>{const {LiveChecker:SourceChecker}=await import('./rules/engine/livecheck.ts');const d={version:1,units:'mm',siteAnalysis:{version:1,units:'mm',areaUnits:'m2',siteArea:100,coverageLimit:60,farLimit:200,ruleId:'TEST',buildable:[{outer:[{x:0,y:0},{x:10000,y:0},{x:10000,y:10000}],holes:[]}]},layers:[{id:'x',name:'BUILDING',building:true}],entities:[{id:'a',type:'polyline',closed:true,layer:'x',points:[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000}]}]};const r=new SourceChecker().run(d);assert.equal(r.findings.find(f=>f.type==='floor_unknown').message,'층 미지정 레이어 1개 — 1층으로 가정해 계산');});
test('source engine resolves standard layer names to numeric floors',async()=>{const {LiveChecker:SourceChecker}=await import('./rules/engine/livecheck.ts');const d={version:1,units:'mm',siteAnalysis:{version:1,units:'mm',areaUnits:'m2',siteArea:100,coverageLimit:60,farLimit:200,ruleId:'TEST',buildable:[{outer:[{x:0,y:0},{x:10000,y:0},{x:10000,y:10000}],holes:[]}]},layers:[{id:'x',name:'A-BLDG-L1'}],entities:[{id:'a',type:'polyline',closed:true,layer:'x',points:[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000}]}]};const r=new SourceChecker().run(d);assert.ok(!r.findings.some(f=>f.type==='floor_unknown'));});
const rect=(w,h)=>[{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
const baseline=()=>({version:1,units:'mm',areaUnits:'m2',siteArea:100,coverageLimit:60,farLimit:200,ruleId:'TEST-ONLY',buildable:[{outer:rect(10000,10000),holes:[]}],northProfile:{boundary:[{x:0,y:10000},{x:10000,y:10000}],setbacks:[{height:0,distance:0},{height:20000,distance:10000}]}});
const drawing=()=>({units:'mm',siteAnalysis:baseline(),layers:[{id:'1',name:'1F',height:3000},{id:'4',name:'4F',height:3000}],entities:[]});
test('inactive without analysis and rejects ambiguous units',()=>{assert.equal(new LiveChecker().run({}).status,'대지 미분석');assert.throws(()=>validateAnalysis({...baseline(),areaUnits:'mm2'}));});
test('wall protrusion appears and clears; unchanged objects are cached',()=>{
 const d=drawing(),c=new LiveChecker();d.entities=[{id:'w',type:'wall',layer:'1',points:[{x:1000,y:1000},{x:2000,y:1000}],thickness:200}];
 assert.equal(c.run(d).findings.filter(f=>f.severity==='error').length,0);assert.deepEqual(c.run(d).checkedIds,[]);
 d.entities[0].points[1].x=11000;const r=c.run(d);assert.ok(r.findings.some(f=>f.type==='building_line'&&f.geometry.length));assert.equal(r.full,false);
 d.entities[0].points[1].x=2000;assert.equal(c.run(d).findings.filter(f=>f.severity==='error').length,0);
});
test('fourth floor height increase creates north setback violation',()=>{const d=drawing(),c=new LiveChecker();d.entities=[{id:'w',type:'wall',layer:'4',points:[{x:1000,y:3000},{x:2000,y:3000}],thickness:200}];assert.equal(c.run(d).findings.filter(f=>f.severity==='error').length,0);/* 층 바닥 높이는 아래층 층고를 쌓아 올린다(1~3층 3m = 9m). 4층 층고 6m → 윗면 15m → 필요 7.5m > 실제 7m. */d.layers[1].height=6000;const r=c.run(d);assert.ok(r.findings.some(f=>f.type==='north'));assert.deepEqual(r.checkedFloors,[4]);});
test('coverage 59 to 61 crosses limit; unions remove overlap and FAR exclusions work',()=>{
 const d=drawing(),c=new LiveChecker();d.entities=[{id:'s',type:'polyline',closed:true,layer:'1',points:rect(10000,5900)}];assert.equal(c.run(d).coverage,59);
 d.entities[0].points=rect(10000,6100);let r=c.run(d);assert.equal(r.coverage,61);assert.match(r.status,/60% ⚠/);
 d.entities.push({...d.entities[0],id:'overlap'});assert.equal(c.run(d).coverage,61);
 d.entities.push({...d.entities[0],id:'upper',layer:'4'});assert.equal(c.run(d).far,122);d.layers[1].excludeFromFAR=true;assert.equal(c.run(d).far,61);
 d.entities=[];r=c.run(d);assert.equal(r.coverage,null);assert.ok(!r.findings.some(f=>f.type==='coverage'));
});
test('SITE and text excluded; holes preserved',()=>{const d=drawing();d.layers.push({id:'site',name:'SITE-BUILDABLE'});d.entities=[{id:'site',type:'rectangle',layer:'site',points:rect(20000,20000)},{id:'text',type:'text',layer:'1',position:{x:20000,y:0},text:'test'},{id:'floor',type:'polyline',closed:true,layer:'1',points:rect(10000,10000),loops:[rect(2000,2000)]}];const r=new LiveChecker().run(d);assert.equal(r.coverage,96);assert.deepEqual(r.checkedIds,['floor']);});

test('scoped worker calculation keeps untouched cache entries and recomputes dependent floors only',()=>{
 const d=drawing(),checker=new LiveChecker();d.entities=[{id:'a',type:'polyline',closed:true,layer:'1',points:rect(2000,2000)},{id:'b',type:'polyline',closed:true,layer:'4',points:rect(1000,1000)}];checker.run(d);const cached=checker.cache.get('b');
 d.entities[0].points=rect(3000,2000);let result=checker.run(d,['a']);assert.deepEqual(result.checkedIds,['a']);assert.deepEqual(result.checkedFloors,[1]);assert.equal(checker.cache.get('b'),cached);assert.equal(result.section,null);
 const fresh=new LiveChecker().run(d);assert.deepEqual(result.findings,fresh.findings);assert.equal(result.coverage,fresh.coverage);assert.equal(result.far,fresh.far);
 d.entities.shift();result=checker.run(d,['a']);assert.equal(checker.cache.has('a'),false);assert.equal(checker.cache.get('b'),cached);assert.deepEqual(result.checkedFloors,[1]);assert.deepEqual(result.findings,new LiveChecker().run(d).findings);
});

test('transient staged checks never contaminate the actual drawing worker cache',async()=>{
 const saved=globalThis.self,answers=[];globalThis.self={postMessage:data=>answers.push(data)};
 try{await import('./livecheck-worker.js?review-isolation');const d=drawing();d.entities=[{id:'lower',type:'polyline',closed:true,layer:'1',points:rect(2000,2000)},{id:'upper',type:'polyline',closed:true,layer:'4',points:rect(1000,1000)}];
  self.onmessage({data:{id:1,document:d}});const before=answers.at(-1).result.far,staged=structuredClone(d);staged.entities[1].points=rect(8000,8000);self.onmessage({data:{id:2,document:staged,transient:true}});assert.notEqual(answers.at(-1).result.far,before);
  d.entities[0].points=rect(2000,3000);self.onmessage({data:{id:3,document:d,objectIds:['lower']}});const result=answers.at(-1).result;assert.equal(result.far,new LiveChecker().run(d).far);assert.deepEqual(result.checkedIds,['lower']);
 }finally{if(saved===undefined)delete globalThis.self;else globalThis.self=saved;}
});

test('north distance uses complete edges near short boundary segments',()=>{const d=drawing();d.siteAnalysis.northProfile.boundary=[{x:4900,y:5000},{x:5100,y:5000}];d.entities=[{id:'wide',type:'wall',layer:'1',points:[{x:1000,y:4000},{x:9000,y:4000}],thickness:200}];assert.ok(new LiveChecker().run(d).findings.some(f=>f.type==='north'));});


test('shrinking repeated floors removes empty floor summaries and lower height changes refresh upper tops',()=>{
 const d=drawing(),checker=new LiveChecker();d.layers=[{id:'1',name:'A-BLDG-L1',height:3500},{id:'up',name:'A-BLDG-UP',height:3000,upperFloors:4}];d.entities=[{id:'g',type:'polyline',closed:true,layer:'1',points:rect(5000,5000)},{id:'u',type:'polyline',closed:true,layer:'up',points:rect(5000,5000)}];
 checker.run(d);d.layers[1].upperFloors=2;let r=checker.run(d);assert.deepEqual(r.areaSummary.floors.map(f=>f.floor),[1,2,3]);
 assert.equal(Math.max(...r.section.entries.map(e=>e.top)),9500);d.layers[0].height=4500;r=checker.run(d);assert.equal(Math.max(...r.section.entries.map(e=>e.top)),10500);assert.ok(r.checkedIds.includes('u'));
});
test('checked-in livecheck bundles exactly match the engine entry points',async()=>{
 const {createHash}=await import('node:crypto'),{build}=await import('esbuild'),{readFile}=await import('node:fs/promises'),{fileURLToPath}=await import('node:url'),{dirname}=await import('node:path'),root=dirname(fileURLToPath(import.meta.url));
 for(const [entry,outfile,minify]of [['rules/engine/livecheck-worker.ts','livecheck-worker.js',true],['rules/engine/livecheck.ts','livecheck-engine.js',false]]){
  const output=await build({absWorkingDir:root,entryPoints:[entry],bundle:true,format:'esm',platform:'browser',outfile,write:false,...(minify?{minify:true,legalComments:'none'}:{})});
  // esbuild 는 묶은 node_modules 의 상대 경로를 주석·키에 남긴다. 작업 사본 깊이(윈도우 worktree ../../../node_modules)나
  // 맥의 링크된 node_modules 가 달라도 같은 소스면 같은 묶음으로 본다. 줄바꿈 차이도 무시한다.
  const normal=data=>Buffer.from(data).toString('utf8').replace(/\r\n/g,'\n').replace(/(?:\.\.\/)+(?:[^\/"\s]+\/)*node_modules\//g,'node_modules/');
  const hash=data=>createHash('sha256').update(normal(data)).digest('hex');assert.equal(hash(output.outputFiles[0].contents),hash(await readFile(new URL(outfile,import.meta.url))),outfile+' must be rebuilt with build:livecheck');
 }
});


test('merged-site analysis invalidation suppresses cached results until a baseline is confirmed',()=>{
 const d=drawing(),checker=new LiveChecker();d.entities=[{id:'floor',type:'polyline',closed:true,layer:'1',points:rect(5000,5000)}];
 assert.equal(checker.run(d).active,true);d.siteAnalysis.needsSiteReview=true;
 const invalid=checker.run(d);assert.equal(invalid.active,false);assert.equal(invalid.stale,true);assert.equal(invalid.coverage,null);assert.equal(invalid.far,null);assert.equal(invalid.section,undefined);assert.match(invalid.findings[0].message,/대지가 합쳐졌습니다/);
 assert.equal(checker.cache.size,0);assert.equal(checker.floorAreas.size,0);
 d.siteAnalysis.needsSiteReview=false;const fresh=checker.run(d);assert.equal(fresh.active,true);assert.equal(fresh.full,true);assert.deepEqual(fresh.checkedIds,['floor']);
});


test('source: 미지정 층은 1층 가정으로 계산하고 입력 필요를 내며 재지정시 캐시를 갱신한다',async()=>{
 const {LiveChecker:Checker}=await import('./rules/engine/livecheck.ts'),d=drawing(),checker=new Checker();d.layers=[{id:'x',name:'BUILDING',building:true},{id:'y',name:'WALL'}];d.entities=[{id:'a',type:'polyline',closed:true,layer:'x',points:rect(1000,1000)},{id:'b',type:'polyline',closed:true,layer:'x',points:rect(1000,1000)},{id:'c',type:'polyline',closed:true,layer:'y',points:rect(1000,1000)}];
 let r=checker.run(d);assert.equal(r.coverage,1);assert.equal(r.findings.find(f=>f.type==='floor_unknown').message,'층 미지정 레이어 2개 — 1층으로 가정해 계산');assert.equal(r.findings.find(f=>f.type==='floor_unknown').status,'need_input');
 d.layers[0].floor=1;r=checker.run(d);assert.equal(r.coverage,1);assert.ok(!r.findings.some(f=>f.type==='floor_unknown'&&f.objectIds.includes('a')));d.layers[0].floor=null;r=checker.run(d);assert.equal(r.coverage,1);assert.ok(r.findings.some(f=>f.type==='floor_unknown'));
});
test('source: 층고 가정은 실제 사용 객체에만 표시하고 캐시·새 계산이 일치한다',async()=>{
 const {LiveChecker:Checker}=await import('./rules/engine/livecheck.ts'),d=drawing(),checker=new Checker();d.layers=[{id:'1',name:'1F',height:3000}];d.entities=[{id:'a',type:'wall',layer:'1',points:[{x:1000,y:9500},{x:2000,y:9500}],thickness:200}];
 const check=()=>{const cached=checker.run(d),fresh=new Checker().run(d);assert.deepEqual(cached.findings,fresh.findings);return cached;};
 let r=check();assert.ok(r.findings.some(f=>f.type==='north'&&!f.status));assert.ok(!r.findings.some(f=>f.type==='floor_height_assumed'));
 d.layers.push({id:'empty',name:'9F'});r=check();assert.ok(!r.findings.some(f=>f.type==='floor_height_assumed'));
 delete d.layers[0].height;r=check();assert.equal(r.findings.find(f=>f.type==='north').status,'check_detail');assert.equal(r.findings.find(f=>f.type==='north').reason,'층고 가정 3,000mm');assert.deepEqual(r.findings.find(f=>f.type==='floor_height_assumed').reviewValue,{value:3000,unit:'mm',sourceKind:'assumed',confirmation:'assumed',sourceRef:null,observedAt:null,confirmedAt:null});
 d.entities[0].height=3000;r=check();assert.ok(!r.findings.some(f=>f.type==='floor_height_assumed'));delete d.entities[0].height;
 d.layers=[{id:'1',name:'4F',height:6000}];r=check();assert.equal(r.findings.find(f=>f.type==='north').status,'check_detail');
 d.reviewSettings={floorHeight:3000};r=check();assert.ok(!r.findings.some(f=>f.type==='floor_height_assumed'));
 d.reviewSettings=undefined;d.layers.push(...[1,2,3].map(f=>({id:'base'+f,name:f+'F',height:3000})));r=check();assert.ok(!r.findings.some(f=>f.type==='floor_height_assumed'));
});
test('source: 층 모르는 벽 레이어의 가정 층고(3,000)가 설계자가 넣은 층고(2,800)를 덮지 않는다',async()=>{
 const {LiveChecker:Checker}=await import('./rules/engine/livecheck.ts'),d=drawing(),checker=new Checker();
 d.layers=[{id:'1',name:'1F',height:2800,building:true},{id:'2',name:'2F',height:2800,building:true},{id:'w',name:'A-WALL'}];
 d.entities=[{id:'a',type:'polyline',closed:true,layer:'1',points:rect(1000,1000)},{id:'b',type:'polyline',closed:true,layer:'2',points:rect(1000,1000)},{id:'c',type:'wall',layer:'w',points:[{x:0,y:0},{x:1000,y:0}],thickness:200}];
 checker.run(d);assert.equal(checker.cache.get('b').z0,2800);
});
