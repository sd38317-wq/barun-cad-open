const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{EventEmitter}=require('node:events');
const {closeDocumentView}=require('./desktop-lifecycle.cjs');
class Contents extends EventEmitter {
 constructor(){super();this.dead=false;this.closes=[];}
 isDestroyed(){return this.dead;}focus(){}loadURL(url){this.url=url;}send(channel,payload){(this.sent||=[]).push({channel,payload});}
 close(options){this.closes.push(options);this.dead=true;this.emit('destroyed');}
}
class View {constructor(options){this.options=options;this.webContents=new Contents();}setBackgroundColor(){}setBounds(){} }
function fixture(){
 const mod={exports:{}};vm.runInNewContext(fs.readFileSync('desktop-docs.cjs','utf8'),{require:()=>({WebContentsView:View}),module:mod,Date,Map,Set,setTimeout,clearTimeout});
 const window=new EventEmitter();window.isDestroyed=()=>false;window.isMinimized=()=>false;window.getContentBounds=()=>({width:100,height:100});window.contentView={addChildView(){},removeChildView(){}};
 const changes=[];const docs=new mod.exports.DocumentViews({window,url:'http://localhost',preload:'preload',configure:()=>{},onChange:tabs=>changes.push(tabs)});
 return {docs,changes,...mod.exports};
}
test('세 칸은 전역 번호·서로 다른 프로세스 세션을 가진다',()=>{
 const {docs}=fixture();const entries=[docs.create(),docs.create(),docs.create()];
 assert.deepEqual(entries.map(e=>e.initialDrawingName),['새 도면 1','새 도면 2','새 도면 3']);
 assert.equal(docs.allocateDrawingName(),'새 도면 4');
 assert.equal(entries[1].view.options.webPreferences.partition,'persist:barun-cad-doc-2');
 assert.equal(entries[2].view.options.webPreferences.partition,'persist:barun-cad-doc-3');
 assert.ok(entries[1].view.options.webPreferences.additionalArguments.includes('--barun-drawing-name=새 도면 2'));
});
test('새 도면 번호는 지금 쓰지 않는 가장 작은 번호 — 닫으면 다시 1부터(사장님 2026-10-26 "창이 하나면 1 아닌가")',()=>{
 const {docs}=fixture();const a=docs.create();a.drawings=[{name:'새 도면 1'}];
 assert.equal(docs.allocateDrawingName(a,[]),'새 도면 1','칸의 도면을 모두 닫았으면 1');
 assert.equal(docs.allocateDrawingName(a,['새 도면 1','새 도면 3']),'새 도면 2','빈 번호부터');
 const b=docs.create();assert.equal(b.initialDrawingName,'새 도면 2','다른 칸이 쓰는 1 은 피한다');
 assert.equal(docs.allocateDrawingName(a,['새 도면 1']),'새 도면 3','새 칸이 이름을 알리기 전에도 겹치지 않는다');
});
test('X/Ctrl+W 닫기는 contents를 파괴하고 탭·복원 목록에서 제거한다',async()=>{
 const {docs,openWindowsSnapshot}=fixture();const entries=[docs.create(),docs.create(),docs.create()];
 for(const e of entries)e.drawings=[{name:e.title,dirty:true,filePath:''}];
 const target=entries[1],contents=target.view.webContents;let choices=0;
 assert.equal(await closeDocumentView(target,{choose:async()=>{choices++;return 'discard';},save:async()=>{throw Error('unexpected save');},remove:id=>docs.remove(id),report:()=>{}}),true);
 assert.equal(contents.isDestroyed(),true);assert.equal(contents.closes.length,1);assert.equal(contents.closes[0].waitForBeforeUnload,false);assert.equal(choices,1);
 assert.equal(docs.views.size,2);assert.equal(docs.list().some(e=>e.id===target.id),false);
 assert.deepEqual(Array.from(openWindowsSnapshot(docs.views.values()).windows,e=>e.slot),[1,3]);
});
for(const choice of ['cancel','save-fails','save-throws'])test('닫기 취소/저장 실패 후 다시 닫을 수 있다: '+choice,async()=>{
 const {docs}=fixture(),entry=docs.create();let errors=0,aborts=0;
 const hooks={choose:async()=>choice==='cancel'?'cancel':'save',save:async()=>{if(choice==='save-throws')throw Error('disk full');return false;},remove:id=>docs.remove(id),report:()=>errors++,aborted:()=>aborts++};
 assert.equal(await closeDocumentView(entry,hooks),false);assert.equal(docs.views.size,1);assert.equal(entry.closing,false);assert.equal(aborts,1);assert.equal(errors,choice==='save-throws'?1:0);
 assert.equal(await closeDocumentView(entry,{...hooks,choose:async()=>'discard'}),true);assert.equal(docs.views.size,0);
});
test('저장 완료 후만 닫고 중복 X는 하나의 확인을 사용한다',async()=>{
 const {docs}=fixture(),entry=docs.create();let decide;const order=[];
 const hooks={choose:()=>new Promise(r=>decide=r),save:async()=>{order.push('save');return true;},remove:id=>{order.push('remove');docs.remove(id);},report:()=>{}};
 const first=closeDocumentView(entry,hooks);assert.equal(await closeDocumentView(entry,hooks),false);decide('save');assert.equal(await first,true);assert.deepEqual(order,['save','remove']);
});
test('구판 [1,2,4]를 검사 대상으로 읽고 새 기록은 빈 칸을 제외한다',()=>{
 const {readOpenWindows,openWindowsSnapshot}=fixture();
 assert.deepEqual(Array.from(readOpenWindows([1,2,4,4,0,100,'2']),e=>e.slot),[1,2,4]);
 const entries=[{slot:1,drawings:[{name:'새 도면 1',dirty:false,filePath:''}]},{slot:2,drawings:[{name:'평면도',dirty:false,filePath:'C:/plan.dxf'}]},{slot:4,drawings:[{name:'새 도면 3',dirty:true,filePath:''}]}];
 const snapshot=openWindowsSnapshot(entries);assert.deepEqual(Array.from(snapshot.windows,e=>e.slot),[2,4]);
 assert.deepEqual(Array.from(readOpenWindows(snapshot),e=>e.slot),[2,4]);
 assert.equal(openWindowsSnapshot([{slot:4,restorePending:true}]).windows[0].pending,true);
});
test('화면 자기 X는 main 종료로 보내고 빈 칸은 확인 창 없이 discard 한다',async()=>{
 const source=fs.readFileSync('app.js','utf8'),context={window:{cadDesktop:{windowShortcut:async name=>context.calls.push(name)}},calls:[],tabSwitchAllowed(){},documents:{tabs:[{id:'a'}],checkpoint(){}},toast(){},markCleanExit(){}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function closeDrawingTab('),source.indexOf('function chooseDrawingClose(')),context);
 await context.closeDrawingTab('a');assert.deepEqual(context.calls,['close']);
 let handler;context.window.cadDesktop={onCloseChoiceRequested:fn=>handler=fn};context.documents.dirtyTabs=()=>[];
 vm.runInContext(source.slice(source.indexOf('if(window.cadDesktop?.onCloseChoiceRequested)'),source.indexOf('/* 공통 계정 및 업데이트 창')),context);
 assert.equal(await handler({closing:true,scope:'window'}),'discard');
});

test('복원 IPC는 실패한 칸의 원래 경로를 보존하고 빈 구판 칸만 제거한다',()=>{
 const source=fs.readFileSync('desktop.cjs','utf8');const {docs,openWindowsSnapshot}=fixture();const a=docs.create({restore:true}),b=docs.create({restore:true});b.restoreDrawings=[{name:'파일',dirty:false,filePath:'C:/plan.dxf'}];
 const pendingRestores=new Map([[1,{slot:1}],[2,{slot:2,drawings:b.restoreDrawings}]]);let handler;
 const context={ipcMain:{on:(_name,fn)=>handler=fn},docs,pendingRestores};vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf("ipcMain.on('cad:workspace-ready'"),source.indexOf(" ipcMain.on('cad:window-select'")),context);
 handler({sender:b.view.webContents},{empty:true,failed:true});assert.equal(docs.views.size,2);assert.equal(b.restorePending,true);
 assert.equal(openWindowsSnapshot(docs.views.values()).windows.find(e=>e.slot===2).drawings[0].filePath,'C:/plan.dxf');
 handler({sender:b.view.webContents},{empty:true,failed:false});assert.equal(docs.views.size,1);assert.equal(b.view.webContents.isDestroyed(),true);
 const content=docs.create({restore:true}),lateBlank=docs.create({restore:true});a.startupEmpty=true;a.restorePending=false;content.restorePending=false;content.drawings=[{name:'편집',dirty:true,filePath:''}];
 handler({sender:lateBlank.view.webContents},{empty:true,failed:false});assert.equal(docs.views.size,1);assert.equal(docs.active().id,content.id);
});
test('칸 복원은 공용 엔진 복구본을 빈 칸에 적용하지 않고 대형 파일을 다시 연다',async()=>{
 const {restorableDrawingWorkspace}=await import('./drawing-tabs.js');
 const source=fs.readFileSync('app.js','utf8'),start=source.indexOf('if(window.cadDesktop?.restoreWindow&&startFresh)'),end=source.indexOf('const offer=recoveryOffer(',start),branch=source.slice(start,end);
 const setup=(recorded,saved)=>{const calls=[],context={window:{cadDesktop:{restoreWindow:true,restoreDrawings:recorded,initialDrawingName:'새 도면 2'}},startFresh:true,saved,restorableDrawingWorkspace,engineRecovery:{dirty:true,savedAt:99999},restoreFiles:[],keepPreviousWorkspace:false,documents:{restore:s=>calls.push(s)},engine:{validate(){}},nextDrawingName:()=> '새 도면 3',tabsRecovered:false,calls};vm.createContext(context);return context;};
 const empty=setup([], {version:1,tabs:[{id:'a',name:'새 도면 1',dirty:false}]});await vm.runInContext('(async()=>{'+branch+'})()',empty);assert.equal(empty.calls.length,0);
 const file=setup([{name:'대형 파일',filePath:'C:/large.dxf',dirty:false,large:true}],{version:1,tabs:[{id:'old',name:'작은 구판',filePath:'C:/large.dxf',dirty:false}]});await vm.runInContext('(async()=>{'+branch+'})()',file);assert.equal(file.calls.length,0);assert.deepEqual(Array.from(file.restoreFiles),['C:/large.dxf']);
 const large=setup([{name:'새 도면 1',filePath:'',dirty:true,large:true}],{version:1,tabs:[{id:'old',name:'새 도면 1',dirty:true}]});await assert.rejects(vm.runInContext('(async()=>{'+branch+'})()',large),/칸별 복구본/);assert.equal(large.keepPreviousWorkspace,true);assert.equal(large.calls.length,0);
 const partial=setup([{name:'A',filePath:'C:/a.dxf',dirty:false},{name:'B',filePath:'',dirty:true}],{version:1,tabs:[{id:'a',name:'A',filePath:'C:/a.dxf',dirty:false}]});await assert.rejects(vm.runInContext('(async()=>{'+branch+'})()',partial),/일부의 복구본/);assert.equal(partial.keepPreviousWorkspace,true);assert.equal(partial.calls.length,0);
 const dirty=setup([],{version:1,activeId:'a',tabs:[{id:'a',name:'새 도면 1',dirty:true},{id:'b',name:'새 도면 1',dirty:true}]});await vm.runInContext('(async()=>{'+branch+'})()',dirty);assert.deepEqual(Array.from(dirty.calls[0].tabs,t=>t.name),['새 도면 2','새 도면 3']);
});

test('대용량 보호는 블록 내부 객체까지 세고 같은 도면은 다시 세지 않는다',async()=>{
 const {documentWeight}=await import('./import-stream.js');const source=fs.readFileSync('app.js','utf8');let counts=0;
 const context={WeakMap,documentWeight:(...args)=>{counts++;return documentWeight(...args);}};vm.createContext(context);
 const start=source.indexOf('const recoveryWeights='),end=source.indexOf('function oversizedActiveDocument',start);
 vm.runInContext(source.slice(start,end)+'globalThis.weight=recoveryWeight;',context);
 const doc={entities:Array.from({length:40000},()=>({type:'line'})),sharedBlocks:{block:{entities:new Array(170000)}}};assert.ok(context.weight(doc)>50000);assert.ok(context.weight(doc)>50000);assert.equal(counts,1);
 assert.equal(context.weight({entities:[]}),0);
});

test('BCAD 파일 열기는 경로를 보존하여 복원 목록에 남길 수 있다',async()=>{
 const source=fs.readFileSync('app.js','utf8'),context={fileImportQueue:[{name:'plan.bcad',path:'C:/plan.bcad',size:10,text:async()=>JSON.stringify({entities:[]})}],performance:{now:()=>0},busy:false,window:{cadDesktop:{}},engine:{validate(){}},beginDrawingLoad(){},updatePrompt(){},updateDrawingLoad(){},endDrawingLoad(){},applyDrawingImport:async()=>{context.openedPath=context.nextOpenFilePath;},toast:text=>{throw Error(text)},JSON,File:class{},nextOpenFilePath:''};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function readNextDrawingFile(){'),source.indexOf('async function applyDrawingImport(')),context);await context.readNextDrawingFile();assert.equal(context.openedPath,'C:/plan.bcad');
});

test('화면 프레임 없이 복구를 내릴 때도 칸 dirty 메타데이터를 알린다',async()=>{
 const source=fs.readFileSync('app.js','utf8'),reports=[],context={window:{cadDesktop:{reportDrawings:rows=>reports.push(rows)}},documents:{tabs:[{id:'a',name:'새 도면 1',dirty:false,doc:{entities:[]}}],activeId:'a',checkpoint(){this.tabs[0].dirty=true;}},recoveryWeight:()=>60000,reportedDrawings:'',recoveryStartup:null,recoveryTimer:null,recoveryIdleId:null,recoveryBackground:false,clearTimeout(){},hasOversizedRecoveryDocument:()=>true,recoveryPending:true,largeRecoveryNotice:true};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function reportDrawingStates(){'),source.indexOf('function renderDrawingTabs(){'))+source.slice(source.indexOf('async function flushDrawingRecovery('),source.indexOf('async function closeDrawingTab(')),context);await context.flushDrawingRecovery();assert.equal(reports[0][0].dirty,true);assert.equal(context.recoveryPending,false);
});

test('감사 3: 대용량 탭이 있어도 나머지 탭은 칸별 복구에 계속 쓴다',async()=>{
 const source=fs.readFileSync('app.js','utf8'),written=[],big={entities:[]},small={entities:[]};
 const tabs=[{id:'big',name:'단지',dirty:true,doc:big},{id:'b',name:'새 도면 2',dirty:true,doc:small}];
 const context={window:{cadDesktop:{}},documents:{tabs,activeId:'big',checkpoint(){},snapshot:()=>({version:1,activeId:'big',tabs:tabs.map(t=>({...t}))})},
  recoveryWeight:doc=>doc===big?60000:10,hasOversizedRecoveryDocument:()=>true,reportedDrawings:'',recoveryStartup:null,recoveryTimer:null,recoveryIdleId:null,recoveryBackground:false,clearTimeout(){},
  recoveryPending:false,largeRecoveryNotice:true,recoveryStore:{write:async s=>{written.push(s);}},recoveryBlocked:false,keepPreviousWorkspace:false,sceneRevision:3,stampRecovery(){},recoveryWrite:null};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function reportDrawingStates(){'),source.indexOf('function renderDrawingTabs(){'))+source.slice(source.indexOf('async function flushDrawingRecovery('),source.indexOf('async function closeDrawingTab(')),context);
 await context.flushDrawingRecovery();
 assert.deepEqual(written.map(s=>s.tabs.map(t=>t.id)),[['b']]);assert.equal(context.recoveryPending,false);
 assert.equal(written[0].activeId,'b','검토 B2: 빠진 큰 탭이 아니라 남은 탭을 가리킨다');
 // 검토 B2: 탭이 모두 대용량이면 편집마다 복구 준비(checkpoint)를 걸지 않는다.
 const scheduled=[];const c2={documents:{tabs:[{doc:big}]},restoringTabs:false,recoveryWeight:doc=>doc===big?60000:10,recoveryPending:true,clearTimeout(){},setTimeout:fn=>scheduled.push(fn)};
 vm.createContext(c2);vm.runInContext(source.slice(source.indexOf('function scheduleDrawingRecovery(){'),source.indexOf('async function flushDrawingRecovery(')),c2);
 c2.scheduleDrawingRecovery();assert.equal(scheduled.length,0);assert.equal(c2.recoveryPending,false);
});

const fileKey=value=>String(value).replace(/\\/g,'/').toLowerCase();
const liveState=async e=>({busy:false,drawings:e.drawings||[{name:e.title,empty:true}]});
test('빈 한 칸에 파일을 열면 같은 프로세스를 재사용하고 읽는 중 중복 열기도 합친다',async()=>{
 const {docs}=fixture(),entry=docs.create();entry.externalReady=true;
 await docs.openFiles(['C:/plan.dxf'],{readState:liveState,key:fileKey});
 assert.equal(docs.views.size,1);assert.equal(docs.active(),entry);assert.deepEqual(Array.from(entry.openingFiles),['C:/plan.dxf']);
 assert.equal(entry.view.webContents.sent[0].channel,'cad:external-open');
 await docs.openFiles(['c:\\PLAN.DXF'],{readState:liveState,key:fileKey});assert.equal(docs.views.size,1);
 entry.openingFiles=[];entry.drawings=[{name:'plan',filePath:'C:/plan.dxf',empty:false}];
 await docs.openFiles(['C:/plan.dxf'],{readState:liveState,key:fileKey});assert.equal(docs.views.size,1);assert.equal(entry.view.webContents.sent.at(-1).channel,'cad:select-file');
});
test('되살리기에 실패한 칸은 그 파일을 연 칸으로 치지 않아 같은 파일 열기가 새로 읽는다',async()=>{
 const {docs}=fixture(),failed=docs.create();failed.externalReady=true;
 failed.restorePending=true;failed.restoreFailed=true;failed.restoreDrawings=[{name:'plan',filePath:'C:/plan.dxf',dirty:true}];
 await docs.openFiles(['C:/plan.dxf'],{readState:liveState,key:fileKey});
 assert.equal(docs.views.size,2,'빈 실패 칸을 고르고 끝나지 않고 새 칸에서 읽는다');
 assert.ok([...docs.views.values()].some(e=>e!==failed&&Array.from(e.openingFiles||e.files||[]).includes('C:/plan.dxf')));
});
test('미리와 대화한 빈 칸은 파일을 열 칸으로 쓰지 않고 빈 칸 정리에서도 닫지 않는다',async()=>{
 const {docs}=fixture(),talking=docs.create();talking.externalReady=true;
 const state=async e=>({busy:false,conversation:e===talking,drawings:e.drawings||[{name:e.title,empty:true}]});
 await docs.openFiles(['C:/plan.dxf'],{readState:state,key:fileKey});
 assert.equal(docs.views.size,2,'대화 칸을 재사용하지 않고 새 칸');assert.equal(talking.openingFiles.length,0);
 const opened=[...docs.views.values()].find(e=>e!==talking);opened.openingFiles=[];opened.drawings=[{name:'plan',filePath:'C:/plan.dxf',empty:false}];
 const closed=[];await docs.pruneEmpty({readState:state,close:e=>{closed.push(e);docs.remove(e.id);}});
 assert.deepEqual(closed,[]);assert.ok(docs.views.has(talking.id));
});
test('빈 세 칸 중 현재 칸에서 열고 성공 뒤 다른 빈 프로세스와 복원 기록을 정리한다',async()=>{
 const {docs,openWindowsSnapshot}=fixture();docs.create();docs.create();const active=docs.create();for(const e of docs.views.values())e.externalReady=true;
 await docs.openFiles(['C:/plan.dxf'],{readState:liveState,key:fileKey});assert.equal(docs.views.size,3);assert.deepEqual(Array.from(active.openingFiles),['C:/plan.dxf']);
 await docs.pruneEmpty({readState:liveState,close:e=>docs.remove(e.id)});assert.equal(docs.views.size,3,'실패할 수 있는 읽기 중에는 빈 칸 유지');
 const blanks=[...docs.views.values()].filter(e=>e!==active),contents=blanks.map(e=>e.view.webContents);
 active.openingFiles=[];active.drawings=[{name:'plan',filePath:'C:/plan.dxf',empty:false}];
 await docs.pruneEmpty({readState:liveState,close:e=>docs.remove(e.id)});
 assert.equal(docs.views.size,1);assert.ok(contents.every(c=>c.isDestroyed()));assert.equal(docs.active(),active);
 assert.deepEqual(Array.from(openWindowsSnapshot(docs.views.values()).windows,e=>e.slot),[3]);
});
test('편집 중 칸과 상태 응답 없는 칸은 재사용하거나 자동 닫지 않는다',async()=>{
 const {docs}=fixture(),edited=docs.create(),unknown=docs.create();edited.drawings=[{name:edited.title,dirty:true,empty:false}];
 const state=async e=>e===unknown?null:liveState(e);
 await docs.openFiles(['C:/plan.dxf'],{readState:state,key:fileKey});assert.equal(docs.views.size,3);
 await docs.pruneEmpty({readState:state,close:e=>docs.remove(e.id)});assert.equal(docs.views.size,3);
});
test('여러 파일은 다른 빈 칸을 사용하고 초기 파일 예약은 준비 전 중복 요청을 막는다',async()=>{
 const {docs}=fixture(),first=docs.create({files:['C:/first.dxf']});
 await docs.openFiles(['C:/first.dxf','C:/second.dxf','C:/second.dxf'],{readState:async()=>null,key:fileKey});
 assert.equal(docs.views.size,2);assert.deepEqual(first.files,['C:/first.dxf']);assert.deepEqual(Array.from(docs.active().files),['C:/second.dxf']);
});
test('복원 중 파일은 중복 생성하지 않고 복원 완료 후 옛 경로는 열린 파일로 취급하지 않는다',async()=>{
 const {docs}=fixture(),entry=docs.create({restore:true});entry.restoreDrawings=[{filePath:'C:/plan.dxf'}];
 await docs.openFiles(['C:/plan.dxf'],{readState:async()=>null,key:fileKey});assert.equal(docs.views.size,1);
 entry.restorePending=false;entry.drawings=[{filePath:'C:/changed.dxf',empty:false}];
 await docs.openFiles(['C:/plan.dxf'],{readState:liveState,key:fileKey});assert.equal(docs.views.size,2);
});
test('현재 칸에 파일 탭과 빈 내부 탭이 함께 있어도 빈 탭을 재사용할 수 있다',async()=>{
 const {docs}=fixture(),entry=docs.create();entry.drawings=[{filePath:'C:/kept.dxf',empty:false},{name:'새 도면 2',empty:true}];
 await docs.openFiles(['C:/next.dxf'],{readState:liveState,key:fileKey});assert.equal(docs.views.size,1);assert.deepEqual(Array.from(entry.files),['C:/next.dxf']);
});
test('시작은 복원할 칸/시작 파일만 만들고 둘 다 없을 때만 빈 칸 하나를 만든다',async()=>{
 const source=fs.readFileSync('desktop.cjs','utf8'),start=source.indexOf('for(const row of restoreWindows)docs.create('),end=source.indexOf(' showWhatsNew();',start),branch=source.slice(start,end);
 for(const [rows,files] of [[[{slot:2,drawings:[{filePath:'C:/plan.dxf'}]}],[]],[[],['C:/plan.dxf']],[[],[]]]){
  const {docs}=fixture(),context={docs,restoreWindows:rows,pendingExternal:[...files],pagePath:'/',window:{loadFile:async()=>{}},path:{join:()=>''},__dirname:'',logLine(){},openDrawingPaths:paths=>docs.openFiles(paths,{readState:async()=>null,key:fileKey})};
  vm.createContext(context);await vm.runInContext('(async()=>{'+branch+'})()',context);assert.equal(docs.views.size,1);
  assert.equal(docs.active().restorePending,!!rows.length);assert.deepEqual(docs.active().files?Array.from(docs.active().files):null,files.length?files:null);
 }
});
test('칸을 [저장 안 함]으로 닫으면 정상 종료 표시를 남긴다(칸 닫기는 beforeunload 를 거치지 않는다)',async()=>{
 const source=fs.readFileSync('app.js','utf8');let handler,marked=0;
 const context={window:{cadDesktop:{onCloseChoiceRequested:fn=>handler=fn}},documents:{dirtyTabs:()=>[]},markCleanExit:()=>marked++};vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('if(window.cadDesktop?.onCloseChoiceRequested)'),source.indexOf('/* 공통 계정 및 업데이트 창')),context);
 assert.equal(await handler({closing:false,scope:null}),'discard');assert.equal(marked,0);   // 새로고침은 닫는 것이 아니다
 assert.equal(await handler({closing:true,scope:'window'}),'discard');assert.equal(marked,1);
});
test('자동 빈 칸 정리 요청은 현재 편집/읽기 상태를 다시 검사하고 확인 창을 띄우지 않는다',async()=>{
 const source=fs.readFileSync('app.js','utf8');let handler,state={busy:false,drawings:[{empty:true}]};
 const context={window:{cadDesktop:{onCloseChoiceRequested:fn=>handler=fn}},drawingOpenState:()=>state};vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('if(window.cadDesktop?.onCloseChoiceRequested)'),source.indexOf('/* 공통 계정 및 업데이트 창')),context);
 assert.equal(await handler({scope:'empty'}),'discard');state={busy:false,drawings:[{empty:false}]};assert.equal(await handler({scope:'empty'}),'cancel');state={busy:true,drawings:[{empty:true}]};assert.equal(await handler({scope:'empty'}),'cancel');
});

test('파일 열기는 빈 내부 탭 세 개를 정리하고 파일·미저장 탭은 보존한다',async()=>{
 const {DrawingTabs,isEmptyDrawingTab}=await import('./drawing-tabs.js');
 const source=fs.readFileSync('app.js','utf8'),context={isEmptyDrawingTab,nextOpenFilePath:'C:/plan.dxf',prepareLegacyLayerMigration:doc=>({doc,changed:false,skipped:[]}),layerMigrationNotice:()=>'',toast(){},log(){},tabSwitchAllowed(){},engine:{validate(){}},studio:{getProjectState:()=>({})},structuredClone,fit(){},scheduleDrawingRecovery(){}};
 let state;const docs=new DrawingTabs({capture:()=>state,apply:tab=>{state=tab;}});context.documents=docs;
 for(let n=1;n<=3;n++)docs.open({name:'새 도면 '+n,doc:{entities:[],layers:[{id:'default',visible:true}]},dirty:false,undoStack:[],redoStack:[]});
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function openDrawingTab('),source.indexOf('function selectDrawingTab(')),context);
 context.openDrawingTab({entities:[],layers:[{id:'default',visible:true}]},'plan',false,{replaceEmpty:true});assert.equal(docs.tabs.length,1);assert.equal(docs.active.filePath,'C:/plan.dxf');
 const kept=docs.active;docs.open({name:'새 도면 4',doc:{entities:[{id:'changed'}],layers:[]},dirty:true,undoStack:[{}],redoStack:[]});const dirty=docs.active;
 docs.open({name:'새 도면 5',doc:{entities:[],layers:[]},dirty:false,undoStack:[],redoStack:[]});context.nextOpenFilePath='C:/next.dxf';
 context.openDrawingTab({entities:[],layers:[{id:'default',visible:true}]},'next',false,{replaceEmpty:true});assert.equal(docs.tabs.length,3);assert.ok(docs.tabs.includes(kept));assert.ok(docs.tabs.includes(dirty));assert.equal(dirty.doc.entities[0].id,'changed');
});

test('앱을 정상으로 닫으면 다음 실행에 창을 다시 띄우지 않는다(파일·빈·버린 도면 모두) — 복원 못 끝낸 칸만 남긴다',()=>{
 const {closedWindowForRestore,openWindowsSnapshot}=fixture();
 const row=closedWindowForRestore({slot:2,drawings:[{name:'새 도면 1',dirty:false},{name:'버린 미저장 도면',dirty:true},{name:'파일',dirty:true,filePath:'C:/plan.dxf'}]});
 assert.equal(openWindowsSnapshot([row]).windows.length,0);   // 사장님 2026-10-26 "닫고 나면 전에 있던 창 띄우는 거 안 했으면"
 const failed=closedWindowForRestore({slot:4,restorePending:true,restoreDrawings:[{filePath:'C:/missing.dxf',dirty:false,reopen:true}]});assert.equal(openWindowsSnapshot([failed]).windows[0].drawings[0].reopen,true);
});
test('전체 종료 기록은 마지막 destroyed 뒤도 유지하고 취소/개별 닫기는 실제 칸만 기록한다',()=>{
 const {openWindowsSnapshot,closedWindowForRestore}=fixture(),source=fs.readFileSync('desktop.cjs','utf8'),writes=[];
 const docs={views:new Map([[1,{slot:1,drawings:[{name:'file',filePath:'C:/file.dxf',dirty:false}]}]])},closedForExit=new Map(),context={docs,closedForExit,pendingRestores:new Map(),closingAll:true,preservingExit:false,openWindowsSnapshot,fsSync:{writeFileSync:(_file,value)=>writes.push(JSON.parse(value))},openWindowsFile:'test',logLine(){}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const saveOpenWindows=()=>{'),source.indexOf(' let closingAll=',source.indexOf('const saveOpenWindows=()=>{')))+'globalThis.write=saveOpenWindows;',context);
 closedForExit.set(1,closedWindowForRestore({...docs.views.get(1),restorePending:true,restoreDrawings:[{name:'미저장',dirty:true}]}));docs.views.clear();context.write();assert.equal(writes.at(-1).windows.length,1);
 context.closingAll=false;context.preservingExit=true;context.write();assert.equal(writes.at(-1).windows.length,1);
 context.preservingExit=false;closedForExit.clear();context.write();assert.equal(writes.at(-1).windows.length,0);
});
test('reopen 파일은 버린 IndexedDB 편집본 대신 디스크에서 다시 연다',async()=>{
 const {restorableDrawingWorkspace}=await import('./drawing-tabs.js'),source=fs.readFileSync('app.js','utf8'),start=source.indexOf('if(window.cadDesktop?.restoreWindow&&startFresh)'),end=source.indexOf('const offer=recoveryOffer(',start),calls=[];
 const context={window:{cadDesktop:{restoreWindow:true,restoreDrawings:[{name:'plan',filePath:'C:/plan.dxf',dirty:false,reopen:true}]}},startFresh:true,saved:{version:1,tabs:[{name:'plan',filePath:'C:/plan.dxf',dirty:true,doc:{entities:[{id:'discarded'}]}}]},restorableDrawingWorkspace,restoreFiles:[],keepPreviousWorkspace:false,documents:{restore:rows=>calls.push(rows)},engine:{validate(){}},tabsRecovered:false};vm.createContext(context);await vm.runInContext('(async()=>{'+source.slice(start,end)+'})()',context);
 assert.equal(calls.length,0);assert.deepEqual(Array.from(context.restoreFiles),['C:/plan.dxf']);
});

test('상태 응답을 기다리는 사이 앱 종료가 시작되면 새 칸/파일 예약을 만들지 않는다',async()=>{
 const {docs}=fixture(),entry=docs.create();let allow=true;
 await docs.openFiles(['C:/plan.dxf'],{readState:async e=>{allow=false;return liveState(e);},key:fileKey,canOpen:()=>allow});assert.equal(docs.views.size,1);assert.equal(entry.openingFiles.length,0);assert.equal(entry.files,null);
});
test('빈 칸 정리의 취소는 진행 중인 앱 종료를 취소하지 않고 정상 닫기를 계속한다',()=>{
 const source=fs.readFileSync('desktop.cjs','utf8'),start=source.indexOf('aborted:()=>{if(emptyOnly)'),end=source.indexOf('\n  });',start);const calls=[],context={emptyOnly:true,closingAll:true,preservingExit:false,afterClose:()=>calls.push('continue'),closedForExit:new Map([[1,{}]]),saveOpenWindows:()=>calls.push('save')};vm.createContext(context);vm.runInContext('globalThis.handler=({'+source.slice(start,end).trim()+'}).aborted;',context);context.handler();assert.equal(context.closingAll,true);assert.deepEqual(calls,['continue']);assert.equal(context.closedForExit.size,1);
 context.closingAll=false;context.handler();assert.equal(context.closedForExit.size,1);assert.deepEqual(calls,['continue']);
});

function readyDocs(){const f=fixture();const entries=[f.docs.create(),f.docs.create(),f.docs.create()];for(const e of entries){e.state='ready';e.drawings=[{name:e.title,dirty:e.id===3}];}return {...f,entries};}
test('QQ 본체 중계: 저장된 두 칸만 닫고 미저장 한 칸은 건너뛴다',async()=>{
 const {docs,entries}=readyDocs();docs.requestTool=async e=>({safe:!e.drawings[0].dirty,dirty:e.drawings[0].dirty});
 const result=await docs.closeSavedWindows(entries.map(e=>e.id),{requester:entries[0],close:async e=>docs.remove(e.id)});
 assert.deepEqual(Array.from(result.closed),[2,1]);assert.deepEqual(Array.from(result.dirty),[3]);assert.equal(result.failed.length,0);assert.equal(docs.views.size,1);
});
test('QQ는 닫기 직전 다시 묻고 사이에 편집된 칸과 작업 중인 칸을 닫지 않는다',async()=>{
 const {docs,entries}=readyDocs(),asked=[];docs.requestTool=async(e,op)=>{asked.push([e.id,op]);return {safe:false,dirty:e.id===2};};
 const result=await docs.closeSavedWindows([1,2],{close:async()=>{throw Error('닫으면 안 됨');}});
 assert.deepEqual(Array.from(result.dirty),[2]);assert.deepEqual(Array.from(result.failed),[1]);assert.equal(asked.length,2);assert.equal(docs.views.size,3);
});
test('MSL 본체 중계는 칸마다 같은 옵션을 보내고 성공과 실패를 모은다',async()=>{
 const {docs,entries}=readyDocs(),calls=[];docs.requestTool=async(e,op,opts)=>{calls.push([e.id,op,opts]);if(e.id===2)throw Error('응답 없음');return {results:[{name:e.title,counts:{removed:e.id}}]};};
 const result=await docs.cleanWindows(entries.map(e=>e.id),{points:true},entries[0]);
 assert.equal(calls.length,3);assert.ok(calls.every(c=>c[1]==='clean'&&c[2].points===true));assert.equal(result.results.length,2);assert.equal(result.failures.length,1);assert.match(result.failures[0],/응답 없음/);
});
test('칸 요청은 응답한 sender를 검증하고 시간 초과·충돌·닫기 때 기다림을 끝낸다',async()=>{
 const {docs,entries}=readyDocs();docs.toolTimeoutMs=15;
 let request=docs.requestTool(entries[0],'clean',{});const sent=entries[0].view.webContents.sent.at(-1).payload;
 assert.equal(docs.answerTool(entries[1].view.webContents,{id:sent.id,result:{}}),false);
 assert.equal(docs.answerTool(entries[0].view.webContents,{id:sent.id,result:{results:[]}}),true);await request;
 await assert.rejects(docs.requestTool(entries[0],'clean',{}),/응답/);
 request=docs.requestTool(entries[1],'clean',{});entries[1].view.webContents.emit('render-process-gone',{}, {reason:'crashed'});await assert.rejects(request,/멈췄|닫혔|중단/);
 request=docs.requestTool(entries[2],'clean',{});docs.remove(entries[2].id);await assert.rejects(request,/멈췄|닫혔|중단/);assert.equal(docs.pendingTools.size,0);
});

test('MSL 실제 중계: 응답 없는 칸은 제한 시간 뒤 실패이고 늦은 응답은 무시한다',async()=>{
 const {docs,entries}=readyDocs();docs.toolTimeoutMs=15;
 const pending=docs.cleanWindows([1,2],{points:true},entries[0]);const message=entries[0].view.webContents.sent.at(-1).payload;
 docs.answerTool(entries[0].view.webContents,{id:message.id,result:{results:[{name:'가',counts:{removed:1}}]}});
 const result=await pending;assert.equal(result.results.length,1);assert.equal(result.failures.length,1);assert.match(result.failures[0],/응답/);
 const late=entries[1].view.webContents.sent.at(-1).payload;assert.equal(docs.answerTool(entries[1].view.webContents,{id:late.id,result:{results:[]}}),false);assert.equal(docs.pendingTools.size,0);
});
test('QQ는 마지막 칸도 기존 닫기로 넘기며 AI 자기 칸은 나중에 다시 검사한다',async()=>{
 const {docs,entries}=readyDocs();docs.remove(2);docs.remove(3);let dirty=false,asked=0;docs.requestTool=async()=>{asked++;return {safe:!dirty,dirty};};
 const deferred=await docs.closeSavedWindows([1],{requester:entries[0],deferSelf:true,close:()=>{throw Error('아직 닫지 않음');}});assert.deepEqual(Array.from(deferred.deferred),[1]);assert.equal(docs.views.size,1);
 dirty=true;const refused=await docs.closeSavedWindows([1],{requester:entries[0],close:e=>docs.remove(e.id)});assert.deepEqual(Array.from(refused.dirty),[1]);
 dirty=false;const closed=await docs.closeSavedWindows([1],{requester:entries[0],close:e=>docs.remove(e.id)});assert.deepEqual(Array.from(closed.closed),[1]);assert.equal(docs.views.size,0);assert.equal(asked,3);
});
test('프리로드는 단일 프로세스에서 칸 API를 숨기고 만료·준비 전 정리를 거부한다',async()=>{
 const source=fs.readFileSync('desktop-preload.cjs','utf8').split('// 도면 칸마다 프로세스: 칸마다 저장 공간이 따로라')[0];
 const make=docView=>{const handlers={},sent=[];let api;const ipcRenderer={on:(name,fn)=>handlers[name]=fn,send:(...args)=>sent.push(args)};const context={require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>api=value},ipcRenderer}),process:{argv:docView?['--barun-doc-view']:[]},Date,Promise};vm.runInNewContext(source,context);return {handlers,sent,api};};
 const single=make(false);assert.equal(single.api.outputWindows,undefined);assert.equal(single.api.onOutputRequested,undefined);
 const multi=make(true);await multi.handlers['cad:output-request']({}, {id:1,operation:'clean',expiresAt:Date.now()+1000});await new Promise(r=>setImmediate(r));assert.match(multi.sent[0][1].error,/준비/);
 let runs=0;multi.api.onOutputRequested(()=>{runs++;return {};});multi.handlers['cad:output-request']({}, {id:2,expiresAt:Date.now()-1});await new Promise(r=>setImmediate(r));assert.equal(runs,0);assert.match(multi.sent[1][1].error,/시간/);
});

test('실제 본체 IPC는 권한·저장 재확인을 거쳐 기존 닫기를 쓰고 남은 칸에 결과를 보낸다',async()=>{
 const {docs,entries}=readyDocs(),handlers={},events={},source=fs.readFileSync('desktop.cjs','utf8');const start=source.indexOf(' // 기존 CAD 탭 목록'),end=source.indexOf(' // 칸 안에 도면이 하나뿐일 때의 Ctrl+Tab',start);
 let closes=0;docs.requestTool=async e=>({safe:!e.drawings[0].dirty,dirty:e.drawings[0].dirty});
 const context={ipcMain:{handle:(name,fn)=>handlers[name]=fn,on:(name,fn)=>events[name]=fn},docs,closingAll:false,preservingExit:false,closeView:async(e,emptyOnly,savedOnly)=>{assert.equal(emptyOnly,false);assert.equal(savedOnly,true);closes++;docs.remove(e.id);}};
 vm.runInNewContext(source.slice(start,end),context);const event={sender:entries[0].view.webContents};
 assert.throws(()=>handlers['cad:output-windows']({sender:{}}),/요청/);
 assert.equal(handlers['cad:output-windows'](event).windows.length,3);
 const result=await handlers['cad:output-close'](event,{ids:[1,2,3]});assert.equal(closes,2);assert.equal(result.closed.length,2);assert.equal(result.dirty.length,1);
 const notice=entries[2].view.webContents.sent.find(x=>x.channel==='cad:output-closed');assert.equal(notice.payload.closed.length,2);assert.equal(notice.payload.dirty.length,1);
});

test('마지막 칸 destroyed가 늦어도 QQ 결과는 새 칸이 준비되면 전달된다',()=>{
 const {docs,entries}=readyDocs();docs.remove(2);docs.remove(3);const contents=entries[0].view.webContents;contents.close=()=>{contents.dead=true;};docs.remove(1);
 docs.queueNotice('cad:output-closed',{closed:[1],dirty:[],failed:[]});assert.equal(docs.pendingNotices.length,1);
 const next=docs.create();assert.equal(next.view.webContents.sent,undefined);next.state='ready';docs.changed();assert.equal(next.view.webContents.sent[0].channel,'cad:output-closed');assert.equal(docs.pendingNotices.length,0);
});


test('QQ savedOnly의 실제 종료 직전 재검증에서 dirty 또는 만료된 예약이면 칸을 보존한다',async()=>{
 const source=fs.readFileSync('desktop.cjs','utf8'),start=source.indexOf(' const closeView='),end=source.indexOf(' const afterClose=',start);
 for(const safe of [false,true]){
  const {docs,entries}=readyDocs(),entry=entries[0],calls=[];
  docs.requestTool=async(e,operation,options)=>{calls.push({operation,options,closing:e.closing});return {safe,dirty:!safe};};
  const context={docs,closeDocumentView,closingAll:false,preservingExit:false,dialog:{showErrorBox(){}},desktopErrorMessage:()=>'',closedForExit:new Map(),saveOpenWindows(){}};
  vm.runInNewContext(source.slice(start,end)+'globalThis.close=closeView;',context);
  await context.close(entry,false,true,{lease:42,ids:['a']});
  assert.equal(docs.views.has(entry.id),!safe);assert.equal(calls.length,1);assert.equal(calls[0].operation,'confirm-close');assert.equal(calls[0].options.lease,42);assert.equal(calls[0].closing,true);
 }
});
test('QQ 예약 재확인은 closing 표시 중에도 IPC를 보내고 일반 정리는 거부한다',async()=>{
 const {docs,entries}=readyDocs(),entry=entries[0];entry.closing=true;
 await assert.rejects(docs.requestTool(entry,'clean'),/준비|닫혔/);
 const pending=docs.requestTool(entry,'confirm-close',{lease:4,ids:['a']});const message=entry.view.webContents.sent?.at(-1)?.payload;
 assert.ok(message,'닫기 예약 재검증을 renderer에 보내야 함');docs.answerTool(entry.view.webContents,{id:message.id,result:{safe:true}});assert.equal((await pending).safe,true);
});
test('QQ 한 칸 안의 선택한 저장 탭만 닫고 미선택 탭은 보존한다',async()=>{
 const {docs,entries}=readyDocs(),entry=entries[0];entry.drawings=[{id:'a',name:'저장',dirty:false},{id:'b',name:'편집',dirty:true}];const calls=[];
 docs.requestTool=async(e,operation,options)=>{calls.push({operation,options});return operation==='close-tabs'?{closed:['a'],dirty:[],failed:[]}:{safe:false,dirty:true};};
 const result=await docs.closeSavedWindows([entry.id],{targets:[{windowId:entry.id,id:'a',name:'저장',dirty:false}],close:()=>{throw Error('전체 칸은 닫으면 안 됨');}});
 assert.deepEqual(Array.from(result.closed),['a']);assert.equal(result.dirty.length,0);assert.equal(docs.views.has(entry.id),true);assert.equal(calls[0].operation,'close-tabs');assert.deepEqual(Array.from(calls[0].options.ids),['a']);
});
test('QQ 전체 저장 탭 종료는 도면 ID 목록과 lease를 기존 종료 경로에 전달한다',async()=>{
 const {docs,entries}=readyDocs(),entry=entries[0];entry.drawings=[{id:'a',name:'가',dirty:false},{id:'b',name:'나',dirty:false}];let reservation;
 docs.requestTool=async(e,operation,options)=>{assert.equal(operation,'can-close');assert.deepEqual(Array.from(options.ids),['a','b']);return {safe:true,dirty:false,lease:4,expiresAt:Date.now()+1000};};
 const result=await docs.closeSavedWindows([entry.id],{targets:entry.drawings.map(d=>({...d,windowId:entry.id})),close:async(e,state)=>{reservation=state;docs.remove(e.id);}});
 assert.deepEqual(Array.from(result.closed),['a','b']);assert.equal(reservation.lease,4);assert.deepEqual(Array.from(reservation.ids),['a','b']);
});

function outputMainFixture(){
 const f=readyDocs(),handlers={},events={},source=fs.readFileSync('desktop.cjs','utf8');for(const e of f.entries)e.drawings=[{id:'d'+e.id,name:e.title,dirty:false}];
 const start=source.indexOf(' // 기존 CAD 탭 목록'),end=source.indexOf(' // 칸 안에 도면이 하나뿐일 때의 Ctrl+Tab',start),calls=[];
 f.docs.requestTool=async(e,op,options)=>{calls.push({id:e.id,op,options});return {safe:true,dirty:false,lease:4,ids:e.drawings.map(d=>d.id),expiresAt:Date.now()+1000};};
 let now=Date.now();const context={Date:{now:()=>now},ipcMain:{handle:(name,fn)=>handlers[name]=fn,on:(name,fn)=>events[name]=fn},docs:f.docs,closingAll:false,preservingExit:false,closeView:async(e,empty,saved,reservation)=>{assert.equal(saved,true);assert.equal(reservation?.lease,4);f.docs.remove(e.id);}};
 vm.runInNewContext(source.slice(start,end),context);const event={sender:f.entries[0].view.webContents},targets=f.entries.slice(0,2).map(e=>({...e.drawings[0],windowId:e.id}));
 return {...f,handlers,events,calls,event,targets,advance:ms=>{now+=ms;}};
}
test('QQ 지연 자기닫기는 본체 토큰에 원 결과와 대상을 보존하고 최종 알림을 누적한다',async()=>{
 const f=outputMainFixture();
 const first=await f.handlers['cad:output-close'](f.event,{ids:[1,2],deferSelf:true,options:{targets:f.targets}});
 assert.deepEqual(Array.from(first.closed),['d2']);assert.deepEqual(Array.from(first.deferred),[1]);assert.ok(first.token);
 const final=await f.handlers['cad:output-close'](f.event,{ids:[1],options:{targets:[f.targets[0]],previous:{...first,closed:['forged']}}});
 assert.deepEqual(Array.from(final.closed),['d2','d1']);assert.equal(final.requested,2);assert.equal(final.deferred.length,0);
 const notice=f.entries[2].view.webContents.sent.find(x=>x.channel==='cad:output-closed');assert.equal(notice.payload.closed.length,2);assert.equal(notice.payload.requested,2);
});
test('QQ 지연 자기닫기는 대상 변경 또는 명시 취소 때 원 성공을 유지하고 남은 도면 실패를 알린다',async()=>{
 for(const cancel of [false,true]){
  const f=outputMainFixture();const first=await f.handlers['cad:output-close'](f.event,{ids:[1,2],deferSelf:true,options:{targets:f.targets}});
  if(!cancel)f.entries[0].drawings=[{id:'replacement',name:'교체',dirty:false}];
  const final=await f.handlers['cad:output-close'](f.event,{ids:cancel?[]:[1],options:{targets:[f.targets[0]],previous:first,cancel}});
  assert.equal(f.docs.views.has(1),true);assert.deepEqual(Array.from(final.closed),['d2']);assert.deepEqual(Array.from(final.failed),['d1']);assert.equal(final.requested,2);
 }
});
test('도면 보고 IPC는 같은 칸의 도면 식별자를 보존한다',()=>{
 const f=readyDocs(),handlers={},source=fs.readFileSync('desktop.cjs','utf8'),start=source.indexOf(" ipcMain.on('cad:report-drawings'"),end=source.indexOf(" ipcMain.on('cad:restore-drawings'",start);
 vm.runInNewContext(source.slice(start,end),{ipcMain:{on:(name,fn)=>handlers[name]=fn},docs:f.docs});handlers['cad:report-drawings']({sender:f.entries[0].view.webContents},[{id:'chosen',name:'선택'}]);assert.equal(f.entries[0].drawings[0].id,'chosen');
});
test('프리로드 닫기 API는 대상과 이전 결과 옵션을 그대로 본체에 전달한다',async()=>{
 const source=fs.readFileSync('desktop-preload.cjs','utf8').split('// 도면 칸마다 프로세스: 칸마다 저장 공간이 따로라')[0],calls=[];let api;
 vm.runInNewContext(source,{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>api=value},ipcRenderer:{on(){},invoke:(...args)=>calls.push(args)}}),process:{argv:['--barun-doc-view']},Date,Promise});
 const options={targets:[{windowId:1,id:'a'}],previous:{token:1}};api.closeOutputWindows([1],false,options);assert.equal(calls[0][1].options,options);
});

test('QQ 자기 칸의 저장·미저장 내부 탭 혼합은 지연 후 각 탭으로 분리 처리한다',async()=>{
 const {docs,entries}=readyDocs(),entry=entries[0];entry.drawings=[{id:'a',name:'저장',dirty:false},{id:'b',name:'편집',dirty:true}];const targets=entry.drawings.map(d=>({...d,windowId:entry.id}));
 docs.requestTool=async(e,op)=>op==='close-tabs'?{closed:['a'],dirty:['b'],failed:[]}:{safe:false,dirty:true};
 const first=await docs.closeSavedWindows([entry.id],{targets,requester:entry,deferSelf:true});assert.deepEqual(Array.from(first.deferred),[entry.id]);assert.equal(first.dirty.length,0);
 const final=await docs.closeSavedWindows([entry.id],{targets,requester:entry});assert.deepEqual(Array.from(final.closed),['a']);assert.deepEqual(Array.from(final.dirty),['b']);assert.equal(docs.views.has(entry.id),true);
});
test('QQ 종료 직전 재확인 응답 동안 예약이 만료되면 칸을 보존한다',async()=>{
 const source=fs.readFileSync('desktop.cjs','utf8'),start=source.indexOf(' const closeView='),end=source.indexOf(' const afterClose=',start),{docs,entries}=readyDocs(),entry=entries[0];
 docs.requestTool=async()=>({safe:true,dirty:false});const context={docs,closeDocumentView,closingAll:false,preservingExit:false,dialog:{showErrorBox(){}},desktopErrorMessage:()=>'',closedForExit:new Map(),saveOpenWindows(){}};
 vm.runInNewContext(source.slice(start,end)+'globalThis.close=closeView;',context);await context.close(entry,false,true,{lease:42,ids:['a'],expiresAt:Date.now()-1});assert.equal(docs.views.has(entry.id),true);
});

test('QQ 지연 토큰은 만료·다른 sender·재사용을 거부하고 대상 칸을 유지한다',async()=>{
 const f=outputMainFixture(),first=await f.handlers['cad:output-close'](f.event,{ids:[1,2],deferSelf:true,options:{targets:f.targets}});
 await assert.rejects(f.handlers['cad:output-close']({sender:f.entries[2].view.webContents},{ids:[1],options:{targets:f.targets,previous:first}}),/요청한 창/);
 f.advance(30001);const expired=await f.handlers['cad:output-close'](f.event,{ids:[1],options:{targets:f.targets,previous:first}});
 assert.deepEqual(Array.from(expired.closed),['d2']);assert.deepEqual(Array.from(expired.failed),['d1']);assert.equal(f.docs.views.has(1),true);
 await assert.rejects(f.handlers['cad:output-close'](f.event,{ids:[1],options:{targets:f.targets,previous:first}}),/지연 닫기 요청/);
});

test('QQ 상태 응답 직전에 한 탭이 dirty가 되어도 나머지 저장 탭은 따로 닫는다',async()=>{
 const {docs,entries}=readyDocs(),entry=entries[0];entry.drawings=[{id:'a',name:'가',dirty:false},{id:'b',name:'나',dirty:false}];const targets=entry.drawings.map(d=>({...d,windowId:entry.id}));
 docs.requestTool=async(e,op)=>op==='close-tabs'?{closed:['a'],dirty:['b'],failed:[]}:{safe:false,dirty:true};
 const result=await docs.closeSavedWindows([entry.id],{targets,close:()=>{throw Error('dirty 탭을 담은 칸 종료 금지');}});
 assert.deepEqual(Array.from(result.closed),['a']);assert.deepEqual(Array.from(result.dirty),['b']);assert.equal(docs.views.has(entry.id),true);
});

test('QQ 다른 칸 종료 재확인은 뒤늦게 시작된 다른 칸 AI 작업을 허용하지 않는다',async()=>{
 const {docs,entries}=readyDocs(),entry=entries[1],source=fs.readFileSync('desktop.cjs','utf8'),start=source.indexOf(' const closeView='),end=source.indexOf(' const afterClose=',start),allows=[];
 docs.requestTool=async(e,op,options,allowAI)=>{allows.push(allowAI);return op==='can-close'?{safe:true,dirty:false,lease:4,ids:['remote'],expiresAt:Date.now()+1000}:{safe:allowAI,dirty:false};};
 const context={docs,closeDocumentView,closingAll:false,preservingExit:false,dialog:{showErrorBox(){}},desktopErrorMessage:()=>'',closedForExit:new Map(),saveOpenWindows(){}};
 vm.runInNewContext(source.slice(start,end)+'globalThis.close=closeView;',context);
 const result=await docs.closeSavedWindows([entry.id],{requester:entries[0],close:(e,reservation)=>context.close(e,false,true,reservation)});
 assert.deepEqual(allows,[false,false]);assert.equal(docs.views.has(entry.id),true);assert.deepEqual(Array.from(result.failed),[entry.id]);
});
test('켤 때 지난 도면 다시 열기는 메뉴·화면이 다 그려진 뒤에(기다리면 정리 전 메뉴가 날것으로 보였다)',()=>{
 const app=fs.readFileSync(__dirname+'/app.js','utf8'),init=app.slice(app.indexOf('async function initializeDrawingTabs(){'),app.indexOf('const flushAfterCheck='));
 assert.match(init,/restoreFiles\.length\)drawingWorkspaceReady\.then\([\s\S]*?\.then\(reopenPreviousFiles\)/);
 assert.ok(app.indexOf('await initializeDrawingTabs();')<app.indexOf('resolveDrawingWorkspaceReady();'));
});

test('탭 오른쪽 클릭 메뉴는 누른 탭을 닫기·저장·다른 이름으로 저장한다',async()=>{
 const source=fs.readFileSync('app.js','utf8'),calls=[],toasts=[];
 const context={toast:(m,bad)=>toasts.push([m,bad]),tabSwitchAllowed(){},documents:{select:id=>calls.push(['select',id])},canvas:{focus(){}},closeDrawingTab:id=>calls.push(['close',id]),saveNow:()=>calls.push(['save']),openSaveDialog:as=>calls.push(['saveas',as])};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function selectDrawingTab(id)'),source.indexOf('let otherWindows=')),context);
 const items=context.drawingTabMenuItems('b');
 assert.deepEqual(Array.from(items,i=>i.label),['닫기','저장','다른 이름으로 저장']);
 for(const item of items)await item.run();
 assert.deepEqual(calls,[['close','b'],['select','b'],['save'],['select','b'],['saveas',true]]);
 // 검토 B3: 명령 중이라 탭을 못 바꾸거나 저장이 실패하면 처리 안 된 예외가 아니라 알림으로.
 context.tabSwitchAllowed=()=>{throw Error('명령 중에는 도면을 바꿀 수 없습니다');};await context.drawingTabMenuItems('b')[1].run();
 context.tabSwitchAllowed=()=>{};context.saveNow=async()=>{throw Error('디스크가 가득 찼습니다');};await context.drawingTabMenuItems('b')[1].run();
 assert.deepEqual(toasts,[['명령 중에는 도면을 바꿀 수 없습니다',true],['디스크가 가득 찼습니다',true]]);
 assert.match(source,/\.\.\.\(w\.state==='crashed'\?\[\]:\[\{label:'저장'/,'멈춘 칸에는 닫기만');
 assert.match(source,/close\.onclick=\(\)=>closeDrawingTab\(tab\.id\);button\.oncontextmenu=e=>\{e\.preventDefault\(\);showCanvasMenu\(e\.clientX,e\.clientY,drawingTabMenuItems\(tab\.id\)\);\};/);
 assert.match(source,/desk\.windowCommand\(w\.id,'SAVE'\)/);assert.match(source,/desk\.windowCommand\(w\.id,'SAVEAS'\)/);
});

test('다른 칸 탭 메뉴의 저장은 그 칸을 앞으로 꺼내고 그 칸에만 명령을 보낸다',()=>{
 const source=fs.readFileSync('desktop.cjs','utf8');const {docs}=fixture();const a=docs.create(),b=docs.create();let handler;
 const context={ipcMain:{on:(name,fn)=>{if(name==='cad:window-command')handler=fn;}},docs};vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf("ipcMain.on('cad:window-command'"),source.indexOf(" ipcMain.on('cad:workspace-ready'")>source.indexOf("ipcMain.on('cad:window-command'")?source.indexOf(" ipcMain.on('cad:workspace-ready'"):source.indexOf('\n',source.indexOf("ipcMain.on('cad:window-command'"))),context);
 a.view.webContents.sent=[];b.view.webContents.sent=[];
 handler({sender:a.view.webContents},b.id,'SAVEAS');
 assert.equal(docs.active(),b);assert.deepEqual(b.view.webContents.sent.at(-1),{channel:'cad:run-command',payload:'SAVEAS'});assert.equal(a.view.webContents.sent.filter(m=>m.channel==='cad:run-command').length,0);
 handler({sender:a.view.webContents},b.id,'DELETE');assert.equal(b.view.webContents.sent.filter(m=>m.channel==='cad:run-command').length,1,'저장 말고는 보내지 않는다');
 b.state='crashed';handler({sender:a.view.webContents},b.id,'SAVE');assert.equal(b.view.webContents.sent.filter(m=>m.channel==='cad:run-command').length,1,'검토 B3: 멈춘 칸에는 보내지 않는다');
});
