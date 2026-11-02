// Isolated CAD app runner. No preload, original file access, external network,
// user profile or save/export route is exposed to the renderer.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../..');
const [drawingPath,resultPath]=process.argv.slice(2);
if(!drawingPath||!resultPath)throw Error('Usage: inspect-renderer.cjs prepared-document.json result.json');
app.setPath('userData',path.join(path.dirname(resultPath),'profile-'+process.pid));
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
let win,server,complete=false,profiling=false;
const result={schemaVersion:1,status:'failed',input:'synthetic-events-and-app-command-api',visibility:'hidden',errors:[],checks:[]};
function write(){fs.writeFileSync(resultPath,JSON.stringify(result,null,2));}
async function finish(){if(complete)return;complete=true;try{
 if(profiling){result.cpuProfileCaptured=false;try{const data=await Promise.race([win.webContents.debugger.sendCommand('Profiler.stop'),new Promise(resolve=>setTimeout(()=>resolve(null),2000))]);if(data?.profile){fs.writeFileSync(path.join(path.dirname(resultPath),'cpu.private.json'),JSON.stringify(data.profile));result.cpuProfileCaptured=true;}}catch{result.cpuProfileCaptured=false;}}
 win?.destroy();result.closed=true;write();
 }finally{server?.close();app.exit(result.status==='completed'?0:1);}}
const watchdog=setTimeout(()=>{result.status='timeout';result.errors.push({code:'RENDERER_TIMEOUT'});finish();},process.env.CAD_INSPECTION_PROFILE==='1'?60000:120000);
app.whenReady().then(async()=>{
 server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  let file;
  if(url.pathname==='/inspection-document.json')file=drawingPath;
  else{
   file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
   if(!file.startsWith(root+path.sep)||!(/\.(js|css|html|svg|png|ttf|woff2?)$/i.test(file)||file===path.join(root,'package.json'))){res.writeHead(404).end();return;}
  }
  try{const stat=fs.statSync(file);res.setHeader('Content-Type',/\.js$/.test(file)?'text/javascript':/\.json$/.test(file)?'application/json':/\.css$/.test(file)?'text/css':/\.ttf$/.test(file)?'font/ttf':'text/html');res.setHeader('Content-Length',stat.size);fs.createReadStream(file).pipe(res);}catch{res.writeHead(404).end();}
 }).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 session.defaultSession.webRequest.onBeforeRequest((details,cb)=>cb({cancel:!details.url.startsWith(base+'/')&&!details.url.startsWith('data:')&&!details.url.startsWith('blob:')}));
 win=new BrowserWindow({show:false,width:1000,height:760,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.on('console-message',(event,_level,legacyMessage)=>{
  if(complete)return;
  const message=event.message||legacyMessage;
  if(typeof message!=='string'||!message.startsWith('CAD_QUALITY_PROGRESS '))return;
  try{const check=JSON.parse(message.slice('CAD_QUALITY_PROGRESS '.length));
   if(!/^[A-Z_]+$/.test(check.name)||!['running','passed','failed','skipped'].includes(check.status))return;
   result.lastCheck=check.name;
   if(check.status!=='running')result.checks.push(check);
   write();
  }catch{}
 });
 win.webContents.on('render-process-gone',(_event,details)=>{result.errors.push({code:'RENDERER_PROCESS_GONE',reason:['crashed','oom','killed','abnormal-exit'].includes(details.reason)?details.reason:'other'});finish();});
 win.webContents.on('unresponsive',()=>result.errors.push({code:'RENDERER_UNRESPONSIVE'}));
 try{
  await win.loadURL(base+'/?renderer=gpu&gpu-test=1');
  const until=Date.now()+30000;
  while(!await win.webContents.executeJavaScript('!!window.__cadGpuTest')){if(Date.now()>until)throw Error('STARTUP_TIMEOUT');await new Promise(r=>setTimeout(r,100));}
  if(process.env.CAD_INSPECTION_PROFILE==='1'){
   win.webContents.debugger.attach('1.3');
   await win.webContents.debugger.sendCommand('Profiler.enable');
   await win.webContents.debugger.sendCommand('Profiler.start');profiling=true;
  }
  const measured=await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname,'inspect-scenario.js'),'utf8'));
  if(complete)return;
  const lifecycleErrors=result.errors;
  Object.assign(result,measured);
  result.errors=[...lifecycleErrors,...(measured.errors||[])];
  result.status=result.checks.some(c=>c.status==='failed')||result.errors.length?'failed':'completed';
 }catch(error){result.errors.push({code:error.message==='STARTUP_TIMEOUT'?'STARTUP_TIMEOUT':'SCENARIO_EXECUTION_FAILED',type:error.name==='Error'?'Error':'Other'});}
 finally{clearTimeout(watchdog);finish();}
}).catch(()=>{result.errors.push({code:'HARNESS_START_FAILED'});finish();});
