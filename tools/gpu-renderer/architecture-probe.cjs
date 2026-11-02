const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../..'),tag=process.argv.find(a=>a.startsWith('--tag='))?.slice(6)||'baseline';
app.commandLine.appendSwitch('disable-renderer-backgrounding');app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');app.commandLine.appendSwitch('disable-background-timer-throttling');
app.setPath('userData',path.join(__dirname,'architecture-probe-profile-'+process.pid));
app.whenReady().then(async()=>{
 const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',/\.(m?js)$/.test(p)?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.ttf')?'font/ttf':p.endsWith('.json')?'application/json':'text/html');let data=fs.readFileSync(p);if(p===path.join(root,'app.js'))data=Buffer.from(data.toString()+'\n'+'globalThis.__reg={first:type=>engine.doc.entities.find(e=>e.type===type&&!layerMap().get(e.layer)?.locked)?.id,edit:c=>execute(c),paint:()=>waitForPaint(),pickScreen:(x,y)=>!!pick(world({x,y}))};');res.end(data);}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const win=new BrowserWindow({show:false,width:1280,height:900,title:'CAD isolated command latency audit',webPreferences:{backgroundThrottling:false}});
 const watchdog=setTimeout(()=>{console.error('audit watchdog');win.destroy();server.close();app.exit(2);},180000);
 try{
 
 await win.loadURL(`http://127.0.0.1:${server.address().port}/index.html?renderer=gpu&gpu-test=1`);
 const start=Date.now();while(!await win.webContents.executeJavaScript('!!window.__cadGpuTest&&!!window.__reg')){if(Date.now()-start>30000)throw Error('startup timeout');await new Promise(r=>setTimeout(r,100));}
 await win.webContents.executeJavaScript(`(async()=>{__cadGpuTest.load(await(await fetch('/tools/gpu-renderer/close-backups/drawing-1790474279430.json')).json());await new Promise(r=>setTimeout(r,2200));return __cadGpuTest.state();})()`);
 win.webContents.debugger.attach();await win.webContents.debugger.sendCommand('Profiler.enable');await win.webContents.debugger.sendCommand('Profiler.start');
 const result=await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname,'architecture-probe.js'),'utf8'));
 const {profile}=await win.webContents.debugger.sendCommand('Profiler.stop');const hits=new Map();for(const id of profile.samples||[])hits.set(id,(hits.get(id)||0)+1);
 result.hot=profile.nodes.map(n=>({name:n.callFrame.functionName,url:n.callFrame.url.replace(/^http:\/\/127\.0\.0\.1:\d+\//,''),line:n.callFrame.lineNumber+1,hits:hits.get(n.id)||0})).sort((a,b)=>b.hits-a.hits).slice(0,35);
 fs.writeFileSync(path.join(__dirname,`architecture-probe-${tag}.json`),JSON.stringify(result,null,2));fs.writeFileSync(path.join(__dirname,`architecture-probe-${tag}-cpu.json`),JSON.stringify(profile));console.log(JSON.stringify(result));
 }catch(e){console.error(e.stack);process.exitCode=1;}finally{clearTimeout(watchdog);win.destroy();server.close();app.exit(process.exitCode||0);}
});
