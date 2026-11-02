import {mkdir,writeFile,stat,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createOcctClient} from '../occt-client.js';
import {OCCT_PACKAGE,OCCT_ASSETS,measureOcctWasm,getOcctLoadMetrics} from '../occt-loader.js';
import {normalizeBuildingModel} from '../occt-building.js';
import {readOcctFixture} from './occt-fixture.mjs';
import {writeOcctArtifacts} from './occt-artifacts.mjs';
const output=fileURLToPath(new URL('../tmp/occt-spike/',import.meta.url));
await mkdir(output,{recursive:true});
const result={generatedAt:new Date().toISOString(),status:'running',package:OCCT_PACKAGE,
  environment:{node:process.version,platform:process.platform,arch:process.arch},
  note:'Single run, local files, worker per run. Timings include RPC where marked; OS filesystem cache is uncontrolled.',
  wasm:null,stages:[],outputs:[]};
// Inspect literal local module imports reachable from the actual app entry points.
// This proves no OCCT work is on startup; it is not an app wall-clock benchmark.
const seen=new Set(),occtReferences=[],optionalMissing=[];
async function visit(url){
  url.search='';url.hash='';if(seen.has(url.href))return;seen.add(url.href);
  let text;
  try{text=await readFile(url,'utf8');}catch(error){
    // desktop.cjs explicitly catches this packaged-only updater and falls back.
    if(error.code==='ENOENT'&&url.href===new URL('../vendor/electron-updater.cjs',import.meta.url).href){
      optionalMissing.push(fileURLToPath(url));return;
    }
    throw error;
  }
  if(/occt-(?:client|loader|worker|building|section|kernel)|occt-pkg/.test(text))occtReferences.push(fileURLToPath(url));
  const dependencies=[...text.matchAll(/(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"](\.[^'"]+)['"]/g),
    ...text.matchAll(/(?:import|require)\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)];
  for(const match of dependencies)await visit(new URL(match[1],url));
}
async function verifyStartup(){
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const match of html.matchAll(/<script\b[^>]*src=['"]([^'"]+)['"]/g))await visit(new URL('../'+match[1],import.meta.url));
  await visit(new URL('../desktop.cjs',import.meta.url));
  result.startup={method:'Literal local import graph from index.html and desktop.cjs + loader/client lazy contracts',
    modules:seen.size,occtReferences,engineInitializedBeforeRequest:getOcctLoadMetrics()!==null,
    inspectedModules:seen.size-optionalMissing.length,optionalMissing,addedStartupOcctModules:occtReferences.length};
  if(occtReferences.length||result.startup.engineInitializedBeforeRequest)throw new Error('OCCT is on the app startup path');
}
const client=createOcctClient();
const timed=async(name,fn)=>{
  const before=process.memoryUsage(),start=performance.now();
  const value=await fn(),ms=performance.now()-start;
  result.stages.push({name,ms,processBefore:before,processAfter:process.memoryUsage(),
    worker:await client.metrics()});
  return value;
};
try {
  await verifyStartup();
  const model=await readOcctFixture(process.argv[2]);
  const normalized=normalizeBuildingModel(model);
  result.input={stories:normalized.stories.length,solids:normalized.solids.length,
    openings:normalized.solids.reduce((n,e)=>n+(e.openings?.length??0),0),ignored:normalized.ignored.length};
  const start=performance.now(),loaded=await client.load();
  result.stages.push({name:'first-load-and-worker-start',ms:performance.now()-start,
    loadOnlyMs:loaded.load.loadMs,worker:{load:loaded.load,memory:loaded.memory,models:0},processAfter:process.memoryUsage()});
  const building=await timed('solid-building',()=>client.build(model));
  result.bounds=building.bounds;
  const plan=await timed('plan-s1-plus-1200',()=>client.plan(building.handle,{story:'s1'}));
  const section=await timed('vertical-section-y5500',()=>client.section(building.handle,{start:[0,5500],end:[13000,5500]}));
  const elevation=await timed('elevation-south-HLR',()=>client.elevation(building.handle,{direction:[0,-1,0]}));
  const step=await timed('STEP-all',()=>client.step(building.handle));
  for(const [name,doc]of [['plan',plan],['section',section],['elevation',elevation]]){
    if(!doc.entities.length)throw new Error(name+' has no geometry');
    const artifact=await writeOcctArtifacts(doc,{directory:output,name:'sariro-'+name,title:name});
    await writeFile(output+'sariro-'+name+'.json',JSON.stringify(doc,null,2));
    result.outputs.push({...artifact,entities:doc.entities.length,hidden:doc.hiddenEntities.length,
      hatchBoundaries:doc.hatchBoundaries.length});
    if(doc.hiddenEntities.length)await writeOcctArtifacts({...doc,entities:doc.hiddenEntities},
      {directory:output,name:'sariro-'+name+'-hidden',title:name+' hidden'});
  }
  await writeFile(output+'sariro-building.step',step);
  result.stepBytes=step.length;
  await client.dispose(building.handle);result.afterDispose=await client.metrics();
  await client.terminate();result.afterWorkerTermination=process.memoryUsage();
  // Compression runs AFTER geometric timings, so it does not inflate the model benchmark memory.
  result.wasm=await measureOcctWasm();
  result.wasmFiles=[{name:'replicad_single.wasm (사용)',...result.wasm},
    {name:'replicad_multi.wasm (미사용)',...await measureOcctWasm({wasmUrl:new URL('replicad_multi.wasm',OCCT_ASSETS.wasm).href})}];
  result.jsBytes=(await stat(new URL(OCCT_ASSETS.js))).size;
  result.status='complete';
}catch(error){
  result.status='blocked';result.error={code:error.code??null,message:error.message};
  process.exitCode=1;
}finally{
  await client.terminate();
  await writeFile(output+'bench.json',JSON.stringify(result,null,2)+'\n');
  const mib=bytes=>bytes==null?'—':(bytes/1048576).toFixed(1);
  const names={'first-load-and-worker-start':'Worker 첫 로딩','solid-building':'솔리드 생성',
    'plan-s1-plus-1200':'평면 절단 (+1.2m)','vertical-section-y5500':'세로 단면 (y=5500)',
    'elevation-south-HLR':'남측 입면 HLR','STEP-all':'STEP (전체)'};
  const rows=result.stages.map(s=>'| '+(names[s.name]??s.name)+' | '+s.ms.toFixed(1)+' | '+
    mib(s.worker?.memory?.process?.rss??s.processAfter?.rss)+' | '+
    mib(s.worker?.memory?.process?.heapUsed)+' | '+mib(s.worker?.memory?.wasmHeapBytes)+' |');
  const table=['| 항목 | 시간(ms) | RSS(MiB) | Worker JS heap(MiB) | WASM heap(MiB) |',
    '|---|---:|---:|---:|---:|',...rows].join('\n');
  const sizes=['| WASM | 원본(B) | gzip level 9(B) | 원본(MiB) | gzip(MiB) |',
    '|---|---:|---:|---:|---:|',...(result.wasmFiles??[]).map(w=>'| '+w.name+' | '+w.rawBytes+' | '+
      w.gzipBytes+' | '+mib(w.rawBytes)+' | '+mib(w.gzipBytes)+' |')].join('\n');
  const report='# OCCT 시범 측정\n\n상태: '+result.status+' / '+result.generatedAt+'\n\n'+sizes+'\n\n'+table+
    '\n\n엔진 자체 초기화: '+(result.stages[0]?.loadOnlyMs?.toFixed(1)??'미측정')+'ms. '+
    '단일 실행·로컬 파일, OS 파일 캐시 미통제. RSS는 부모+Worker 프로세스 전체이며 단계 완료 직후 값(최고값 아님). '+
    '기하 시간은 RPC 포함, 출력기·압축 시간 제외.\n\n시작 경로: '+(result.startup?.modules??0)+'개 로컬 경로 추적(실제 읽음 '+(result.startup?.inspectedModules??0)+'개), OCCT 참조 '+
    (result.startup?.occtReferences?.length??'미검사')+'개, 첫 요청 전 엔진 초기화 '+
    (result.startup?result.startup.engineInitializedBeforeRequest?'있음':'없음':'미검사')+'. '+
    (result.startup&&!result.startup.occtReferences.length&&!result.startup.engineInitializedBeforeRequest?
      '앱 시작 시 OCCT 추가 작업 0; 앱 전체 시작 시간을 재는 수치는 아니다. ':'시작 경로 검사 미완료/실패. ')+
    '선택 의존성 누락: '+(result.startup?.optionalMissing?.join(', ')||'없음')+' (desktop updater는 원래 catch/fallback 경로).\n\n'+
    (result.error?.message??'원본 수치·출력 목록·dispose/terminate 메모리는 bench.json 참고')+'\n';
  await writeFile(output+'bench.md',report);
  console.log(report);
}
