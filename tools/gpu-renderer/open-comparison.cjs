const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const selectionCheck=process.argv.includes('--selection-check');
const snapCheck=process.argv.includes('--snap-check');
const postCommandCheck=process.argv.includes('--post-command-check');
const restoreLatest=process.argv.includes('--restore-latest');
const port=postCommandCheck?'18782':snapCheck?'18781':selectionCheck?'18780':'18779',profile=path.join(__dirname,postCommandCheck?'post-command-comparison-profile':snapCheck?'snap-comparison-profile':selectionCheck?'selection-comparison-profile':'comparison-profile'),title=postCommandCheck?'바른 CAD · GPU 종료 후 끊김 수정판':snapCheck?'바른 CAD · GPU 명령 속도 수정판':selectionCheck?'바른 CAD · GPU 선택 수정판':'바른 CAD · GPU 비교';
app.setPath('userData',profile);
// All comparison variants share one lock/profile going forward.
app.setPath('userData',path.join(__dirname,'current-comparison-profile'));
const ownsInstance=app.requestSingleInstanceLock();if(!ownsInstance)app.quit();
let server;
app.whenReady().then(async()=>{
  if(!ownsInstance)return;
  server=spawn('python',['server.py','--port',port,'--no-browser'],{cwd:root,windowsHide:true,env:{...process.env,LOCALAPPDATA:profile}});
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('비교용 서버 시작 시간 초과')),15000);server.stdout.on('data',d=>{if(String(d).includes('Barun CAD:')){clearTimeout(timeout);resolve();}});server.once('exit',c=>{clearTimeout(timeout);reject(Error('비교용 서버 종료: '+c));});});
  const win=new BrowserWindow({width:1500,height:950,title,webPreferences:{sandbox:true,contextIsolation:true}});win.removeMenu();
  app.on('second-instance',()=>{if(win.isMinimized())win.restore();win.focus();});
  let closing=false;
  win.on('close',event=>{
    event.preventDefault();if(closing)return;closing=true;
    (async()=>{
      await win.webContents.executeJavaScript('window.cad?.drawings?.flush?.()');
      const doc=await win.webContents.executeJavaScript('window.cad?.getDocument?.()');
      if(doc){const dir=path.join(__dirname,'close-backups');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'drawing-'+Date.now()+'.json'),JSON.stringify(doc));}
      win.destroy();
    })().catch(error=>{closing=false;console.error('Close backup failed',error);require('electron').dialog.showErrorBox('도면 보관 실패',String(error.message));});
  });
  await win.loadURL(`http://127.0.0.1:${port}/?renderer=gpu&gpu-test=1`);
  for(let i=0;i<100;i++){if(await win.webContents.executeJavaScript('!!window.__cadGpuTest'))break;await new Promise(r=>setTimeout(r,100));}
  let drawingPath=path.join(__dirname,'hospital.json');
  if(restoreLatest){
    const dir=path.join(__dirname,'close-backups');
    const latest=fs.readdirSync(dir).filter(name=>/^drawing-\d+\.json$/.test(name)).sort().at(-1);
    if(!latest)throw Error('재시작할 도면 보관본을 찾을 수 없습니다.');
    drawingPath=path.join(dir,latest);
  }
  const doc=JSON.parse(fs.readFileSync(drawingPath,'utf8'));
  await win.webContents.executeJavaScript('__cadGpuTest.load('+JSON.stringify(doc)+')');
  win.setTitle(restoreLatest?'바른 CAD · GPU 공간 검색 적용':title);
}).catch(e=>{console.error(e);app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>server?.kill());
