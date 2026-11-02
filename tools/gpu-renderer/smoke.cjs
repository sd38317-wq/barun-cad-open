const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../..'),out=__dirname;
app.setPath('userData',path.join(out,'test-profile-'+process.pid));
app.whenReady().then(async()=>{
 const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',/\.(m?js)$/.test(p)?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.ttf')?'font/ttf':p.endsWith('.png')?'image/png':p.endsWith('.svg')?'image/svg+xml':p.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(p));}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const win=new BrowserWindow({show:false,width:1000,height:760,webPreferences:{backgroundThrottling:false}});
 win.webContents.on('console-message',(_e,d)=>{console.log('PAGE',JSON.stringify(d),_e.message||'');});
 try{
 await win.loadURL(`http://127.0.0.1:${server.address().port}/tools/gpu-renderer/compare.html`);
 const start=Date.now();while(true){const s=await win.webContents.executeJavaScript('({ready:window.ready,failure:window.failure})');if(s.failure)throw Error(s.failure);if(s.ready)break;if(Date.now()-start>90000)throw Error('timeout');await new Promise(r=>setTimeout(r,100));}
 const stats=await win.webContents.executeJavaScript(`(async()=>{const times={};for(const type of ['Canvas','Gpu']){const a=[];for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,0));const t=performance.now();window['draw'+type](compare.scale,{x:compare.origin.x+i*3,y:compare.origin.y+i});a.push(performance.now()-t);}a.sort((a,b)=>a-b);times[type]={p50:a[15],p95:a[28]};}return {times,gpu:compare.gpu.stats};})()`);
 console.log('BENCH DONE');fs.writeFileSync(path.join(out,'smoke-results.json'),JSON.stringify({features:app.getGPUFeatureStatus(),...stats},null,2));
 await win.webContents.executeJavaScript('drawGpu()');await new Promise(r=>setTimeout(r,100));fs.writeFileSync(path.join(out,'gpu.png'),(await win.webContents.capturePage()).toPNG());
 await win.webContents.executeJavaScript('drawCanvas()');await new Promise(r=>setTimeout(r,100));fs.writeFileSync(path.join(out,'canvas.png'),(await win.webContents.capturePage()).toPNG());
 console.log(JSON.stringify(stats));
 }catch(e){console.error(e.stack);process.exitCode=1;}finally{win.destroy();server.close();app.exit(process.exitCode||0);}
});


