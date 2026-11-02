const {contextBridge,ipcRenderer,webUtils}=require('electron');
// 도면 칸마다 프로세스의 도면 칸에만 붙는 표시. 이때 설정(localStorage)을 앱 본체의 공용 설정과 맞춘다.
const docView=process.argv.includes('--barun-doc-view');
// macOS: 창 단추가 왼쪽 위라 머리줄 여백을 바꾼다(barun-air.css html[data-platform=darwin]). 문서가 생긴 뒤에도 붙인다.
if(process.platform==='darwin'){const markPlatform=()=>{if(document.documentElement)document.documentElement.dataset.platform='darwin';};markPlatform();window.addEventListener('DOMContentLoaded',markPlatform);}
// 화면 초기화 전의 main 요청은 초기화 완료까지 보관한다.
let drawingStateHandler=null;const pendingDrawingStates=[];
const answerDrawingState=id=>Promise.resolve().then(()=>drawingStateHandler()).then(state=>ipcRenderer.send('cad:drawing-state-result',{id,state})).catch(()=>ipcRenderer.send('cad:drawing-state-result',{id,state:{busy:true,drawings:[]}}));
if(docView)ipcRenderer.on('cad:drawing-state-request',(_event,id)=>{if(drawingStateHandler)answerDrawingState(id);else pendingDrawingStates.push(id);});
let outputHandler=null,outputClosedHandler=null;const outputClosedQueue=[];
if(docView){
 ipcRenderer.on('cad:output-request',(_event,request)=>{
  Promise.resolve().then(()=>{if(!outputHandler||request.expiresAt<=Date.now())throw Error('도면 칸이 준비되지 않았거나 요청 시간이 지났습니다.');return outputHandler(request);}).then(result=>ipcRenderer.send('cad:output-result',{id:request.id,result})).catch(error=>ipcRenderer.send('cad:output-result',{id:request.id,error:error?.message||String(error)}));
 });
 ipcRenderer.on('cad:output-closed',(_event,result)=>{if(outputClosedHandler)outputClosedHandler(result);else outputClosedQueue.push(result);});
}
// 사용자가 고르거나 끌어 놓은 실제 파일(File)의 경로만 main 에 알린다. 화면이 지어낸 File 은 경로가 빈 글자라 알리지 않는다.
// main 은 이 경로·연 파일만 글자 경로 가져오기·.json 열기에 받는다(desktop.cjs selectedPaths).
const selectedFilePath=file=>{const target=webUtils.getPathForFile(file);if(target)ipcRenderer.send('cad:file-selected',target);return target;};
contextBridge.exposeInMainWorld('cadDesktop',{
 outputWindows:docView?(()=>ipcRenderer.invoke('cad:output-windows')):undefined,
 cleanOutputWindows:docView?((ids,options)=>ipcRenderer.invoke('cad:output-clean',{ids,options})):undefined,
 closeOutputWindows:docView?((ids,deferSelf=false,options)=>ipcRenderer.invoke('cad:output-close',{ids,deferSelf,options})):undefined,
 onOutputReleased:docView?(handler=>ipcRenderer.on('cad:output-release',(_event,id)=>handler(id))):undefined,
 onOutputRequested:docView?(handler=>{outputHandler=handler;}):undefined,
 onOutputClosed:docView?(handler=>{outputClosedHandler=handler;for(const result of outputClosedQueue.splice(0))handler(result);}):undefined,
 setFullscreen:value=>ipcRenderer.invoke('cad:set-fullscreen',value),
 listPrinters:()=>ipcRenderer.invoke('cad:list-printers'),
 printDrawing:payload=>ipcRenderer.invoke('cad:print-drawing',payload),
 setAIRequestState:state=>ipcRenderer.send('cad:ai-request-state',state),
 saveFile:payload=>ipcRenderer.invoke('cad:save-file',payload),
 pickSaveTarget:payload=>ipcRenderer.invoke('cad:pick-save-target',payload),
 filePath:file=>selectedFilePath(file),
 importDrawingFile:file=>ipcRenderer.invoke('cad:import-drawing-path',selectedFilePath(file)),
 importDrawingPath:target=>ipcRenderer.invoke('cad:import-external-drawing-path',target),
 prepareDrawingImport:target=>ipcRenderer.invoke('cad:prepare-external-drawing-import',target),
 prepareSelectedDrawingImport:target=>ipcRenderer.invoke('cad:prepare-drawing-import',target),
 openFolder:(folder,options)=>ipcRenderer.invoke('cad:open-folder',folder,options&&options.mustExist?{mustExist:true}:undefined),
 checkUpdate:()=>ipcRenderer.invoke('cad:check-update'),
 applyUpdate:()=>ipcRenderer.invoke('cad:apply-update'),
 onUpdateStatus:handler=>ipcRenderer.on('cad:update-status',(_event,status)=>handler(status)),
 externalReady:()=>ipcRenderer.invoke('cad:external-ready'),
 readExternalFile:target=>ipcRenderer.invoke('cad:read-external-file',target),
 pickDrawingFiles:()=>ipcRenderer.invoke('cad:pick-drawings'),
 onExternalOpen:handler=>ipcRenderer.on('cad:external-open',(_event,files)=>handler(files)),
 onImportProgress:handler=>ipcRenderer.on('cad:import-progress',(_event,status)=>handler(status)),
 onEngineStatus:handler=>ipcRenderer.on('cad:engine-status',(_event,status)=>handler(status)),
 engineStatus:()=>ipcRenderer.invoke('cad:engine-status'),
 engineToken:()=>ipcRenderer.invoke('cad:engine-token'),
 onSaveRequested:handler=>{ipcRenderer.on('cad:save-request',async(_event,id)=>{try{ipcRenderer.send('cad:save-result',{id,ok:(await handler())===true});}catch{ipcRenderer.send('cad:save-result',{id,ok:false});}});},
 // 도면 칸마다 프로세스: 칸끼리 CAD 클립보드(복사한 객체)를 앱 본체를 거쳐 주고받는다.
 shareCadClipboard:data=>{if(docView)ipcRenderer.send('cad:clipboard',data);},
 // OS 클립보드 글: 인자 없으면 읽기, 글을 주면 쓰기(창이 뒤에 있어도 됨).
 clipboardText:docView?(text=>text===undefined?ipcRenderer.invoke('cad:clipboard-text'):ipcRenderer.invoke('cad:clipboard-text',String(text))):undefined,
 onCadClipboard:handler=>{if(docView)ipcRenderer.on('cad:clipboard',(_event,data)=>handler(data));},
 onDrawingStateRequested:docView?(handler=>{drawingStateHandler=handler;for(const id of pendingDrawingStates.splice(0))answerDrawingState(id);}):undefined,
 fileOpenFinished:docView?(status=>ipcRenderer.send('cad:file-open-finished',status)):undefined,
 onSelectDrawingFile:docView?(handler=>ipcRenderer.on('cad:select-file',(_event,file)=>handler(file))):undefined,
 openInNewWindows:docView?(paths=>ipcRenderer.invoke('cad:open-in-new-windows',paths)):undefined,
 windowShortcut:docView?(name=>ipcRenderer.invoke('cad:window-shortcut',name)):undefined,
 initialDrawingName:docView?process.argv.find(arg=>arg.startsWith('--barun-drawing-name='))?.split('=').slice(1).join('='):undefined,
 restoreWindow:docView&&process.argv.includes('--barun-restore-window'),
 restoreDrawings:docView&&process.argv.includes('--barun-restore-window')?ipcRenderer.sendSync('cad:restore-drawings'):[],
 allocateDrawingName:docView?(names=>ipcRenderer.sendSync('cad:next-drawing-name',Array.isArray(names)?names:null)):undefined,
 workspaceReady:docView?(status=>ipcRenderer.send('cad:workspace-ready',status)):undefined,
 reportDrawings:docView?(drawings=>ipcRenderer.send('cad:report-drawings',drawings)):undefined,
 onWindows:docView?(handler=>ipcRenderer.on('cad:windows',(_event,state)=>handler(state))):undefined,
 selectWindow:docView?(id=>ipcRenderer.send('cad:window-select',id)):undefined,
 closeWindow:docView?(id=>ipcRenderer.send('cad:window-close',id)):undefined,
 windowCommand:docView?((id,name)=>ipcRenderer.send('cad:window-command',id,name)):undefined,
 onRunCommand:docView?(handler=>ipcRenderer.on('cad:run-command',(_event,name)=>handler(name))):undefined,
 noteCommand:name=>{if(typeof name==='string'&&name.length<=40)ipcRenderer.send('cad:command-ran',name);},
 sharedSettingChanged:(key,value)=>{if(docView)ipcRenderer.send('cad:shared-setting',{key,value});},
 onCloseChoiceRequested:handler=>{ipcRenderer.on('cad:close-choice-request',(_event,request)=>Promise.resolve(handler(request)).then(choice=>ipcRenderer.send('cad:close-choice-result',{id:request.id,choice})).catch(()=>ipcRenderer.send('cad:close-choice-result',{id:request.id,choice:'cancel'})));}
});
// 도면 칸마다 프로세스: 칸마다 저장 공간이 따로라 설정을 공용 설정과 맞춘다(desktop-shared-settings.cjs). 페이지 코드보다 먼저 돈다.
// PER_WINDOW 는 desktop-shared-settings.cjs 와 같은 글자여야 한다(샌드박스라 그 모듈을 못 불러온다 — 시험이 확인).
if(docView){
 // 칸 안에서는 창 단추(최소화·최대화·닫기) 자리 정보(env(titlebar-area-*))가 없다 → CSS 가 이 표시로 자리를 비킨다.
 // 미리 읽기(preload) 때는 아직 문서가 없을 수 있어 문서가 생긴 뒤에도 붙인다.
 const markDocView=()=>{if(document.documentElement)document.documentElement.dataset.docView='1';};markDocView();window.addEventListener('DOMContentLoaded',markDocView);
 const PER_WINDOW=/^(barun-cad-recovery|barun-cad-workspace-rev|barun-cad-clean-exit|barun-cad-session|barun-drawing-performance)/;
 try{
  const store=window.localStorage,snapshot=ipcRenderer.sendSync('cad:shared-settings-snapshot');
  if(snapshot===null){
   const seed={};for(let i=0;i<store.length;i++){const key=store.key(i);if(!PER_WINDOW.test(key))seed[key]=store.getItem(key);}
   ipcRenderer.send('cad:shared-settings-seed',seed);
  }else if(snapshot&&typeof snapshot==='object'){
   for(let i=store.length-1;i>=0;i--){const key=store.key(i);if(!PER_WINDOW.test(key)&&!Object.prototype.hasOwnProperty.call(snapshot,key))store.removeItem(key);}
   for(const [key,value] of Object.entries(snapshot))if(store.getItem(key)!==value)store.setItem(key,value);
  }
  // 다른 칸에서 바뀐 설정. 이 격리 세계의 Storage 는 페이지 쪽 가로채기와 따로라 되돌려 알리지 않는다.
  ipcRenderer.on('cad:shared-setting',(_event,change)=>{try{if(change?.value===null)store.removeItem(change.key);else store.setItem(change.key,change.value);}catch{}});
  // 페이지가 설정을 쓰면 앱 본체에 알린다.
  contextBridge.executeInMainWorld({func:source=>{
   const pattern=new RegExp(source),proto=Storage.prototype,set=proto.setItem,remove=proto.removeItem,clear=proto.clear;
   const shared=(storage,key)=>storage===window.localStorage&&!pattern.test(key);
   const send=(key,value)=>{try{window.cadDesktop.sharedSettingChanged(key,value);}catch{}};
   proto.setItem=function(key,value){set.call(this,key,value);if(shared(this,String(key)))send(String(key),String(value));};
   proto.removeItem=function(key){remove.call(this,key);if(shared(this,String(key)))send(String(key),null);};
   proto.clear=function(){const keys=this===window.localStorage?Object.keys(this):[];clear.call(this);for(const key of keys)if(shared(this,key))send(key,null);};
  },args:[PER_WINDOW.source]});
 }catch{}
}
