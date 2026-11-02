const path=require('node:path');

// The backend starts immediately; this window never gates engine readiness.
function createStartupWindow({BrowserWindow,baseDir,onCancel=()=>{}}){
 const startedAt=Date.now();
 let latest={phase:'실행 환경을 확인하고 있습니다.'},loaded=false,closed=false,cancelled=false,loadFailed=false;
 const view=new BrowserWindow({
  width:460,height:280,resizable:false,show:false,title:'바른 CAD 준비 중',
  backgroundColor:'#25292f',
  webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}
 });
 view.removeMenu();
 const send=()=>{
  if(!loaded||closed||view.isDestroyed())return;
  const payload={phase:latest.phase,elapsedMs:Date.now()-startedAt};
  view.webContents.executeJavaScript('window.startupStatus('+JSON.stringify(payload)+')').catch(()=>{});
 };
 const close=()=>{
  if(closed)return;
  closed=true;
  if(!view.isDestroyed())view.close();
 };
 view.webContents.setWindowOpenHandler?.(()=>({action:'deny'}));
 view.webContents.once('did-finish-load',()=>{loaded=true;send();});
 view.once('ready-to-show',()=>{if(!closed&&!loadFailed&&!view.isDestroyed())view.show();});
 view.once('closed',()=>{if(closed)return;closed=true;cancelled=true;onCancel();});
 // Failure to paint the optional startup window must not delay backend startup.
 Promise.resolve(view.loadFile(path.join(baseDir,'desktop-startup.html'))).catch(()=>{loadFailed=true;if(!closed&&!view.isDestroyed())view.hide?.();});
 return {
  view,startedAt,get cancelled(){return cancelled;},
  status(status){if(closed)return;latest={...latest,...status};send();},
  close,error(message){if(closed)return;latest={phase:message};send();}
 };
}
module.exports={createStartupWindow};
