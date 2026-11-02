import {prepareLegacyLayerMigration} from './layer-migration.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {isEmptyDrawingTab,drawingPathKey} from './drawing-tabs.js';
const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const entry=source.slice(source.indexOf('// Shared picker/drop entry:'),source.indexOf('// End shared picker/drop entry.'));
function setup(overrides={}){
 const events={},file={},report={open:false},messages=[],received=[];
 const context={isEmptyDrawingTab,drawingPathKey,busy:false,pendingImport:null,fileImportQueue:[],dirty:true,fileName:'작업 중',documents:{tabs:[{}],limit:10,checkpoint(){}},engine:{doc:{entities:[{id:'keep'}]},undoStack:[{}]},$:id=>id==='file'?file:report,document:{addEventListener:(name,fn)=>events[name]=fn},window:{cadDesktop:null},toast:msg=>messages.push(msg),...overrides};
 context.readNextDrawingFile=async()=>received.push(...context.fileImportQueue);
 vm.runInNewContext(entry,context);
 function drop(names){let prevented=false;events.drop({dataTransfer:{types:['Files'],files:names.map(name=>({name}))},preventDefault(){prevented=true;}});return prevented;}
 return {context,events,file,report,messages,received,drop};
}
test('file drop prevents browser navigation and forwards multiple drawings without changing the active drawing',()=>{
 const s=setup();assert.equal(s.drop(['a.DWG','b.dxf','c.bcad']),true);
 assert.deepEqual(s.received.map(f=>f.name),['a.DWG','b.dxf','c.bcad']);
 assert.equal(s.context.engine.doc.entities[0].id,'keep');assert.equal(s.context.dirty,true);
});
test('busy import cannot be overwritten by a second drop',()=>{
 const s=setup({busy:true,fileImportQueue:[{name:'queued.dwg'}]});s.drop(['next.dxf']);
 assert.equal(s.context.fileImportQueue[0].name,'queued.dwg');assert.equal(s.received.length,0);assert.equal(s.messages.length,1);
});
test('unsupported files and tab overflow are rejected before import',()=>{
 const s=setup();s.drop(['image.png']);assert.equal(s.received.length,0);
 s.context.documents.tabs=Array(10).fill({});s.drop(['a.dxf']);assert.equal(s.received.length,0);assert.equal(s.messages.length,2);
});
test('picker uses the same queue and non-file drags retain normal behavior',async()=>{
 const s=setup();const target={files:[{name:'a.dwg'}],value:'selected'};await s.file.onchange({target});assert.equal(target.value,'');assert.equal(s.received[0].name,'a.dwg');
 let prevented=false;s.events.dragover({dataTransfer:{types:['text/plain']},preventDefault(){prevented=true;}});assert.equal(prevented,false);
});

const directImport=source.slice(source.indexOf('async function readNextDrawingFile(){'),source.indexOf('function commandSearchTerms('));
function directSetup(files){
 const scheduled=[],opened=[],messages=[];
 const context={fileImportQueue:files,busy:false,drawingOpenWait:null,performance,window:{},
  beginDrawingLoad(){},endDrawingLoad(){},updateDrawingLoad(){},updatePrompt(){},
  toast:message=>messages.push(message),drawingOpenErrorMessage:e=>e.message,
  requestAnimationFrame:fn=>fn(),setTimeout:fn=>scheduled.push(fn),
  engine:{validate(doc){if(doc.invalid)throw Error('invalid drawing');}},
  G:{prepareSharedDrawingReferences(){},expandSharedDrawingBlocksAsync:async()=>{}},
  openDrawingTab(doc,name){assert.equal(context.busy,true);opened.push({doc,name});},
  prepareNearbyIndexNow(){},preparePickCandidatesAsync:async()=>{},gpuView:{stats:{}},waitForPaint:async()=>{},rememberDrawingPerformance(){},prepareLegacyLayerMigration,prepareSharedDisplayAsync:async()=>[],S4:{rememberImportReport(){}},document:{hidden:false},loadPaint:async()=>{}};
 vm.createContext(context);vm.runInContext(directImport,context);
 return {context,scheduled,opened,messages};
}
const loadYields=source.slice(source.indexOf('const recoveryYieldChannel='),source.indexOf('function recoveryPause('));
const nativeFile=(name,invalid=false)=>({name,nativeImport:async()=>({document:{entities:[{x:120}],sharedBlocks:{},invalid},report:{imported:1,unitless:true,skipped:{ARC:40}}})});
test('drawings open without confirmation and advance the queue exactly once after rendering',async()=>{
 const s=directSetup([nativeFile('first.dwg'),nativeFile('second.dxf'),{name:'third.bcad',text:async()=>JSON.stringify({entities:[]})}]);
 await s.context.readNextDrawingFile();
 assert.deepEqual(s.opened.map(x=>x.name),['first']);assert.equal(s.context.busy,false);
 assert.equal(s.opened[0].doc.entities[0].x,120);assert.equal(s.scheduled.length,1);
 await s.scheduled.shift()();assert.deepEqual(s.opened.map(x=>x.name),['first','second']);assert.equal(s.scheduled.length,1);
 await s.scheduled.shift()();assert.deepEqual(s.opened.map(x=>x.name),['first','second','third']);assert.equal(s.scheduled.length,0);
});
test('가려지거나 최소화된 창(화면 신호 없음)에서도 도면 열기가 끝난다',async()=>{
 const s=directSetup([nativeFile('hidden.dwg')]);
 Object.assign(s.context,{document:{hidden:true},requestAnimationFrame:()=>{},waitForPaint:()=>new Promise(()=>{}),MessageChannel});
 vm.runInContext(loadYields,s.context);const channel=vm.runInContext('recoveryYieldChannel',s.context);
 try{await s.context.readNextDrawingFile();}finally{channel.port1.close();channel.port2.close();}
 assert.deepEqual(s.opened.map(x=>x.name),['hidden']);assert.equal(s.context.busy,false);
 assert.equal(s.context.hiddenFitPending,true,'숨은 채 연 도면은 다시 보일 때 다시 맞춘다');
});
test('크기 0 인(화면에 안 붙은) 칸의 도면 맞춤은 미뤘다가 크기를 얻으면 맞춘다',()=>{
 const start=source.indexOf('function fit({all=false}={}) {'),fit=source.slice(start,source.indexOf('\n}',start)+2);
 const context={width:0,height:600,needsInitialFit:false,rememberView(){throw Error('0 크기에서 맞추면 안 된다');}};
 vm.createContext(context);vm.runInContext(fit,context);context.fit();
 assert.equal(context.needsInitialFit,true);assert.equal(context.hiddenFitPending,true);
 // 펼치는 동안 크기가 여러 번 바뀌어도 마지막 크기로 한 번만 맞춘다.
 const start2=source.indexOf('function fitWhenSettled(){'),settle=source.slice(start2,source.indexOf('\n',start2));
 const timers=[],fits=[];Object.assign(context,{document:{hidden:false},hiddenFitTimer:0,clearTimeout:id=>{timers[id-1]=null;},setTimeout:fn=>timers.push(fn),sizes:[[300,200],[1500,800]],sizeCanvas(){[context.width,context.height]=context.sizes.shift()||[context.width,context.height];},fit(){fits.push([context.width,context.height,context.scale]);}});
 vm.runInContext(settle,context);context.fitWhenSettled();context.fitWhenSettled();
 timers.filter(Boolean).forEach(fn=>fn());
 assert.equal(fits.length,2,'두 번 맞춰 전체로 모은다');assert.deepEqual(fits[0],[300,200,1e-8],'큰 도면도 전체가 보이게 끝까지 줄인 뒤 맞춘다');assert.equal(context.needsInitialFit,false);assert.equal(context.hiddenFitPending,false);
});
test('failed validation releases busy state and continues to the next drawing',async()=>{
 const s=directSetup([nativeFile('bad.dwg',true),nativeFile('good.dwg')]);
 await s.context.readNextDrawingFile();assert.equal(s.opened.length,0);assert.equal(s.context.busy,false);
 assert.ok(s.messages.some(x=>x.includes('invalid drawing')));assert.equal(s.scheduled.length,1);
 await s.scheduled.shift()();assert.deepEqual(s.opened.map(x=>x.name),['good']);assert.equal(s.scheduled.length,0);
});

test('completed import displays TABLE and REGION decomposition counts',async()=>{
 const file={name:'table.dwg',nativeImport:async()=>({document:{entities:[],sharedBlocks:{}},report:{imported:0,decomposed:{ACAD_TABLE:3,REGION:2}}})};
 const s=directSetup([file]);await s.context.readNextDrawingFile();
 assert.ok(s.messages.some(message=>message.includes('표 3개 → 선·글자로 바꿈')&&message.includes('영역(REGION) 2개 → 닫힌 폴리선으로 바꿈')));
});

test('데스크톱 열기·끌어 놓기는 첫 파일도 main의 재사용/중복 검사로 보낸다',async()=>{
 const routed=[];const s=setup({window:{cadDesktop:{openInNewWindows:async paths=>routed.push(Array.from(paths))}}});
 await s.file.onchange({target:{files:[{name:'a.dxf',path:'C:/a.dxf'},{name:'b.dxf',path:'C:/b.dxf'}],value:''}});
 assert.deepEqual(routed,[['C:/a.dxf','C:/b.dxf']]);assert.equal(s.received.length,0);
});
test('import 완료/실패는 예약 경로를 해제하도록 main에 알린다',async()=>{
 const reports=[],s=directSetup([{...nativeFile('bad.dwg',true),path:'C:/bad.dwg'},{...nativeFile('good.dwg'),path:'C:/good.dwg'}]);
 s.context.window.cadDesktop={fileOpenFinished:status=>reports.push({...status})};await s.context.readNextDrawingFile();await s.scheduled.shift()();
 assert.deepEqual(reports,[{path:'C:/bad.dwg',ok:false},{path:'C:/good.dwg',ok:true}]);
});
