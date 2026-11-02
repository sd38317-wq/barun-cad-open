/* 도면 칸마다 프로세스: 도면 창마다 따로 화면 프로세스를 띄운다.
   창 하나 안에 도면 칸(WebContentsView)을 여럿 겹쳐 두고, 위쪽 탭 줄로 하나만 보인다.
   칸마다 저장 공간(세션)을 따로 준다 — 세션이 다르면 크롬이 한 프로세스를 같이 쓸 수 없어서
   칸마다 자기 메모리 칸(약 4 GB)을 갖고, 한 칸이 죽어도 나머지는 산다.
   1번 칸은 기본 세션(지금까지의 설정·복구본 그대로), 2번부터는 persist:barun-cad-doc-N. */
const {WebContentsView}=require('electron');

// 위쪽 탭 줄은 없다(사용자: 'CAD 탭 줄 자리가 있는데 왜 위에 붙어 있나'). 칸이 창 전체를 쓰고, 다른 칸 도면은 CAD 탭 줄에 함께 보인다.
const STRIP_HEIGHT=0;
const partitionForSlot=slot=>slot===1?null:'persist:barun-cad-doc-'+slot;

// 숫자만 적던 구판 목록도 복구 저장소 확인이 끝날 때까지 보존한다.
function readOpenWindows(value){
 const rows=Array.isArray(value)?value.map(slot=>({slot,pending:true})):value?.version===2&&Array.isArray(value.windows)?value.windows:[];
 const seen=new Set();return rows.filter(row=>Number.isInteger(row?.slot)&&row.slot>0&&row.slot<100&&!seen.has(row.slot)&&seen.add(row.slot)&&(row.pending||row.drawings?.some(d=>d?.dirty||d?.filePath)));
}
function openWindowsSnapshot(entries){
 return {version:2,windows:[...entries].filter(e=>e.restorePending||e.drawings?.some(d=>d.dirty||d.filePath)).map(e=>({slot:e.slot,...(e.restorePending?{pending:true,drawings:e.restoreDrawings||e.drawings||[]}:{drawings:e.drawings.map(({name,dirty,filePath,large,reopen})=>({name,dirty,filePath,large:!!large,...(reopen?{reopen:true}:{})}))})})).sort((a,b)=>a.slot-b.slot)};
}
// 앱을 정상으로 닫으면 다음 실행에 아무 창도 다시 띄우지 않는다(사장님 2026-10-26 "닫고 나면 전에 있던 창 띄우는 거 안 했으면").
// 남기는 것은 아직 복원을 끝내지 못한 칸(강제 종료·충돌로 남은 미저장 도면)뿐 — 그 편집본을 잃지 않게.
function closedWindowForRestore(entry){
 if(entry.restorePending)return {slot:entry.slot,restorePending:true,restoreDrawings:entry.restoreDrawings||[]};
 return {slot:entry.slot,drawings:[]};
}
class DocumentViews {
 constructor({window,url,preload,configure,onChange,log=()=>{}}){
  Object.assign(this,{window,url,preload,configure,onChange,log});
  this.views=new Map();this.activeId=null;this.nextId=1;
  this.pendingNotices=[];this.pendingTools=new Map();this.nextToolId=1;this.toolTimeoutMs=30000;
  // 최소화된 동안 만든 칸은 크기가 0으로 잡힌다 → 되살릴 때·크기 바뀔 때마다 다시 잡는다.
  for(const name of ['resize','restore','maximize','unmaximize','show','enter-full-screen','leave-full-screen'])window.on(name,()=>this.layout());
 }
 // MSL/QQ 실행 때만 IPC를 보낸다. 일반 그리기·편집 경로에는 대기나 객체 복사가 없다.
 requestTool(entry,operation,options={},allowAI=false){
  const contents=entry?.view.webContents;
  if(!entry||!this.views.has(entry.id)||entry.state!=='ready'||(entry.closing&&operation!=='confirm-close')||!contents||contents.isDestroyed())return Promise.reject(Error('도면 칸이 준비되지 않았거나 닫혔습니다.'));
  return new Promise((resolve,reject)=>{
   const id=this.nextToolId++,expiresAt=Date.now()+this.toolTimeoutMs;
   const finish=(error,result)=>{const p=this.pendingTools.get(id);if(!p)return;this.pendingTools.delete(id);clearTimeout(p.timer);if(error&&operation==='can-close'){try{contents.send('cad:output-release',id);}catch{}}error?reject(error):resolve(result);};
   const timer=setTimeout(()=>finish(Error('도면 칸의 응답 시간이 지났습니다.')),this.toolTimeoutMs);
   this.pendingTools.set(id,{entry,contents,timer,finish});
   try{contents.send('cad:output-request',{id,operation,options,allowAI,expiresAt});}catch(error){finish(error);}
  });
 }
 answerTool(contents,message){
  const pending=this.pendingTools.get(message?.id);if(!pending||pending.contents!==contents)return false;
  pending.finish(message.error?Error(String(message.error)):null,message.result);return true;
 }
 cancelTools(entry){for(const pending of this.pendingTools.values())if(pending.entry===entry)pending.finish(Error('도면 칸이 멈췄거나 닫혀 요청을 중단했습니다.'));}
 async cleanWindows(ids,options,requester){
  const results=[],failures=[];
  await Promise.all([...new Set(ids)].map(async id=>{
   const entry=this.views.get(id),name=entry?.title||String(id);
   try{const r=await this.requestTool(entry,'clean',options,entry===requester);if(!Array.isArray(r?.results))throw Error('정리 결과를 받지 못했습니다.');results.push(...r.results);failures.push(...(r.failures||[]));}
   catch(error){failures.push(name+': '+error.message);}
  }));
  return {results,failures};
 }
 async closeSavedWindows(ids,{close,requester,deferSelf=false,targets}={}){
  const closed=[],dirty=[],failed=[],deferred=[];
  // 도면 ID가 있으면 한 칸의 일부 탭도 정확하게 고른다. 요청한 칸은 마지막이다.
  const windows=[...new Set(ids)].sort((a,b)=>Number(a===requester?.id)-Number(b===requester?.id));
  for(const id of windows){
   const entry=this.views.get(id),selected=targets?.filter(t=>t.windowId===id),drawingIds=selected?.map(t=>t.id),keys=drawingIds||[id];let state;
   try{
    if(!entry||drawingIds&&!drawingIds.length)throw Error('닫을 도면이 없습니다.');
    const current=entry.drawings||[],allSelected=!drawingIds||current.length===drawingIds.length&&current.every(d=>drawingIds.includes(d.id));
    const partial=drawingIds&&(!allSelected||current.some(d=>d.dirty));
    if(partial&&deferSelf&&entry===requester){deferred.push(id);continue;}
    if(partial){
     const result=await this.requestTool(entry,'close-tabs',{ids:drawingIds},entry===requester);
     for(const key of keys){if(result?.closed?.includes(key))closed.push(key);else if(result?.dirty?.includes(key))dirty.push(key);else failed.push(key);}
     continue;
    }
    state=await this.requestTool(entry,'can-close',{reserve:!(deferSelf&&entry===requester),...(drawingIds?{ids:drawingIds}:{})},entry===requester);
    if(state?.dirty){
     if(!drawingIds){dirty.push(...keys);continue;}
     if(deferSelf&&entry===requester){deferred.push(id);continue;}
     if(state.lease){entry.view.webContents.send('cad:output-release',state.lease);state.lease=null;}
     const result=await this.requestTool(entry,'close-tabs',{ids:drawingIds},entry===requester);
     for(const key of keys){if(result?.closed?.includes(key))closed.push(key);else if(result?.dirty?.includes(key))dirty.push(key);else failed.push(key);}
     continue;
    }
    if(!state?.safe||state.expiresAt&&state.expiresAt<=Date.now())throw Error('지금은 닫을 수 없습니다.');
    if(deferSelf&&entry===requester){deferred.push(id);continue;}
    const reservation={...state,ids:drawingIds||state.ids,allowAI:entry===requester};
    await close(entry,reservation);
    (this.views.has(id)?failed:closed).push(...keys);
   }catch{failed.push(...keys);}
   finally{if(state?.lease&&this.views.has(id)){try{entry.view.webContents.send('cad:output-release',state.lease);}catch{}}}
  }
  return {closed,dirty,failed,deferred};
 }
 freeSlot(){const used=new Set([...this.views.values()].map(entry=>entry.slot));let slot=1;while(used.has(slot))slot++;return slot;}
 // 지금 열린 도면이 쓰지 않는 가장 작은 번호(사장님 2026-10-26 "창이 하나면 1 아닌가" — 전엔 닫아도 5·6… 계속 올라갔다).
 // 묻는 칸은 지금 가진 도면 이름(names)을 같이 보낸다 — 방금 닫은 도면이 아직 알려지지 않아도 그 번호를 다시 쓴다.
 // 새 칸은 만들자마자 views 에 들어가 이름을 알리기 전에도 첫 이름(initialDrawingName)으로 센다.
 allocateDrawingName(requester=null,names=null){
  const used=new Set();
  for(const entry of this.views.values())for(const name of entry===requester&&Array.isArray(names)?names:Array.isArray(entry.drawings)?entry.drawings.map(d=>d.name):[entry.initialDrawingName])used.add(name);
  let n=1;while(used.has('새 도면 '+n))n++;
  return '새 도면 '+n;
 }
 create({query='',files=null,slot:wanted=null,restore=false}={}){
  const used=new Set([...this.views.values()].map(entry=>entry.slot));
  const id=this.nextId++,slot=wanted&&!used.has(wanted)?wanted:this.freeSlot(),partition=partitionForSlot(slot);
  // 숨은 칸은 크롬 기본대로 그리기를 쉰다. backgroundThrottling:false 는 그리기까지 계속 돌게 해서 쓰지 않는다.
  // 대신 desktop.cjs 가 IntensiveWakeUpThrottling 을 꺼서 숨은 칸의 엔진 연결(bridge-client.js)이 1초 간격 아래로 늦어지지 않게 한다
  // — 8초 넘게 소식이 없으면 AI·Codex 가 그 도면을 "편집 창을 열고 활성화하세요"로 놓친다(bridge.py).
  const initialDrawingName=this.allocateDrawingName();
  const view=new WebContentsView({webPreferences:{preload:this.preload,additionalArguments:['--barun-doc-view','--barun-drawing-name='+initialDrawingName,...(restore?['--barun-restore-window']:[])],contextIsolation:true,nodeIntegration:false,sandbox:true,...(partition?{partition}:{})}});
  const entry={id,slot,view,files,openingFiles:files?[...files]:[],externalReady:false,restorePending:restore,initialDrawingName,attached:false,title:initialDrawingName,state:'loading',pid:null,reason:null,createdAt:Date.now(),loadMs:null,reloadStartedAt:0,lastReloadMs:null};
  this.views.set(id,entry);
  const contents=view.webContents;
  view.setBackgroundColor('#25292f');
  this.configure(contents,entry);
  contents.on('page-title-updated',(_event,title)=>{if(title&&title!=='바른 CAD'){entry.title=title;this.changed();}});
  contents.on('did-finish-load',()=>{
   entry.state='ready';entry.pid=contents.getOSProcessId();
   if(entry.loadMs===null)entry.loadMs=Date.now()-entry.createdAt;
   if(entry.reloadStartedAt){entry.lastReloadMs=Date.now()-entry.reloadStartedAt;entry.reloadStartedAt=0;}
   this.log('doc '+id+' slot='+slot+' ready pid='+entry.pid+' load='+entry.loadMs+'ms'+(entry.lastReloadMs!==null?' reload='+entry.lastReloadMs+'ms':''));
   this.changed();
  });
  for(const name of ['destroyed','render-process-gone','did-start-loading'])contents.on(name,()=>this.cancelTools(entry));
  contents.on('render-process-gone',(_event,details)=>{
   this.log('doc '+id+' render-process-gone '+JSON.stringify(details));
   if(details?.reason==='clean-exit'||!this.views.has(id))return;
   entry.state='crashed';entry.reason=details?.reason||'unknown';
   if(this.activeId===id)this.attach(entry,false);       // 죽은 칸 대신 탭 줄 화면의 "멈췄어요" 안내가 보이게
   this.changed();
  });
  // 2번 칸부터는 docSlot 을 붙인다: 화면이 "앱을 새로 켰다"고 엔진에 알려 진짜 지난 작업 복구본(3세대)을 밀어내지 않게(bridge-client.js).
  contents.loadURL(this.url+(slot===1?query:(query.includes('?')?query+'&':(query||'/')+'?')+'docSlot='+slot));
  this.select(id);
  return entry;
 }
 // 파일 열기는 main의 직렬 큐에서만 호출한다. 읽는 중인 경로도 예약해 두어 두 번째 더블클릭을 합친다.
 async openFiles(paths,{query='',readState,key,preferred=this.activeId,canOpen=()=>true}={}){
  const states=new Map(await Promise.all([...this.views.values()].map(async entry=>[entry.id,await readState(entry).catch(()=>null)])));
  if(!canOpen())return;
  for(const file of paths){
   const existing=[...this.views.values()].find(e=>[...(e.openingFiles||[]),...(e.restorePending&&!e.restoreFailed?e.restoreDrawings||[]:[]).map(d=>d.filePath),...(states.get(e.id)?.drawings||e.drawings||[]).map(d=>d.filePath)].some(p=>p&&key(p)===key(file)));
   if(existing){this.select(existing.id);if(existing.externalReady)existing.view.webContents.send('cad:select-file',file);continue;}
   const reusable=[...this.views.values()].sort((a,b)=>Number(b.id===preferred)-Number(a.id===preferred)).find(e=>{const state=states.get(e.id);return !e.restorePending&&!e.openingFiles?.length&&state&&!state.busy&&!state.conversation&&state.drawings.length&&state.drawings.some(d=>d.empty);});
   if(reusable){
    reusable.openingFiles=[file];this.select(reusable.id);
    if(reusable.externalReady)reusable.view.webContents.send('cad:external-open',[file]);else reusable.files=[file];
   }else this.create({query,files:[file]});
  }
 }
 async pruneEmpty({readState,close}={}){
  const entries=[...this.views.values()];if(entries.length<2)return;
  const states=new Map(await Promise.all(entries.map(async e=>[e.id,await readState(e).catch(()=>null)])));
  if(!entries.some(e=>states.get(e.id)?.drawings.some(d=>!d.empty)))return;
  for(const e of entries){const state=states.get(e.id);if(this.views.size>1&&this.views.has(e.id)&&!e.restorePending&&!e.openingFiles?.length&&state&&!state.busy&&!state.conversation&&state.drawings.length&&state.drawings.every(d=>d.empty))await close(e);}
 }
 select(id){
  if(!this.views.has(id))return;
  this.activeId=id;
  this.layout();
  for(const [key,entry] of this.views)this.attach(entry,key===id&&entry.state!=='crashed');
  const active=this.views.get(id);if(active.state!=='crashed')active.view.webContents.focus();
  this.changed();
 }
 reload(id){
  const entry=this.views.get(id);if(!entry)return;
  entry.state='loading';entry.reason=null;entry.reloadStartedAt=Date.now();
  entry.view.webContents.reload();
  if(this.activeId===id)this.attach(entry,true);
  this.changed();
 }
 remove(id){
  const entry=this.views.get(id);if(!entry)return;
  this.cancelTools(entry);
  this.views.delete(id);
  this.attach(entry,false);
  const contents=entry.view.webContents;            // 'destroyed' 뒤에는 undefined 가 된다
  if(contents&&!contents.isDestroyed())contents.close({waitForBeforeUnload:false});
  if(this.activeId===id){this.activeId=null;const next=[...this.views.keys()].pop();if(next)this.select(next);}
  this.changed();
 }
 // 앞에 보이는 칸만 창에 붙인다. 떼어 둔 칸은 크롬이 '숨김'으로 보고 그리기를 멈춘다(그래픽 자원 아낌).
 // 엔진 연결 타이머는 숨어도 1초 간격으로 돈다(IntensiveWakeUpThrottling 끔, desktop.cjs).
 attach(entry,on){
  if(this.window.isDestroyed()||entry.attached===on)return;
  if(on)this.window.contentView.addChildView(entry.view);else this.window.contentView.removeChildView(entry.view);
  entry.attached=on;
 }
 layout(){
  if(this.window.isDestroyed()||this.window.isMinimized())return;
  const {width,height}=this.window.getContentBounds();
  for(const entry of this.views.values())entry.view.setBounds({x:0,y:STRIP_HEIGHT,width,height:Math.max(0,height-STRIP_HEIGHT)});
 }
 cycle(step){const ids=[...this.views.keys()];if(ids.length<2)return;const i=ids.indexOf(this.activeId);this.select(ids[(i+step+ids.length)%ids.length]);}
 entryFor(contents){if(!contents)return null;for(const entry of this.views.values())if(entry.view.webContents===contents)return entry;return null;}
 has(contents){return !!this.entryFor(contents);}
 active(){return this.views.get(this.activeId)||null;}
 contents(){return [...this.views.values()].map(entry=>entry.view.webContents).filter(contents=>contents&&!contents.isDestroyed());}
 broadcast(channel,payload){for(const contents of this.contents())contents.send(channel,payload);}
 list(){return [...this.views.values()].map(({id,slot,title,state,pid,reason,loadMs,lastReloadMs,drawings})=>({id,slot,title,state,pid,reason,loadMs,lastReloadMs,drawings:drawings||[],active:id===this.activeId}));}
 slots(){return [...this.views.values()].map(entry=>entry.slot).sort((a,b)=>a-b);}
 queueNotice(channel,payload){this.pendingNotices.push({channel,payload});this.flushNotices();}
 flushNotices(){
  if(!this.pendingNotices.length)return;const entry=this.active(),contents=entry?.view.webContents;
  if(entry?.state!=='ready'||!contents||contents.isDestroyed())return;
  while(this.pendingNotices.length){const notice=this.pendingNotices[0];try{contents.send(notice.channel,notice.payload);this.pendingNotices.shift();}catch{return;}}
 }
 changed(){if(!this.window.isDestroyed()){this.onChange(this.list());this.flushNotices();}}
}

module.exports={DocumentViews,STRIP_HEIGHT,partitionForSlot,readOpenWindows,openWindowsSnapshot,closedWindowForRestore};
