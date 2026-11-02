const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../..'),out=__dirname;
app.setPath('userData',path.join(out,'test-profile-'+process.pid));
app.whenReady().then(async()=>{
 const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',/\.(m?js)$/.test(p)?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.ttf')?'font/ttf':p.endsWith('.png')?'image/png':p.endsWith('.svg')?'image/svg+xml':p.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(p));}catch{res.writeHead(404).end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const win=new BrowserWindow({show:false,width:1000,height:760,webPreferences:{backgroundThrottling:false}});
 win.webContents.on('console-message',(_e,d)=>{console.log('PAGE',JSON.stringify(d),_e.message||'');});
 try{
 await win.loadURL(`http://127.0.0.1:${server.address().port}/index.html?renderer=gpu&gpu-test=1`);
 const start=Date.now();while(!await win.webContents.executeJavaScript('!!window.__cadGpuTest')){if(Date.now()-start>30000)throw Error('app startup timeout');await new Promise(r=>setTimeout(r,100));}
 const results=await win.webContents.executeJavaScript(`(async()=>{const api=__cadGpuTest;const doc=await(await fetch('/tools/gpu-renderer/hospital.json')).json();api.load(doc);await new Promise(r=>setTimeout(r,500));api.draw();const before=api.state();const line={id:'gpu-check-line',type:'line',layer:doc.layers[0].id,color:'#ff0000',points:[{x:500000,y:600000},{x:510000,y:600000}]};api.command({type:'add',entity:line});const added=api.state();api.command({type:'copy',ids:['gpu-check-line'],dx:1000,dy:500});const copied=api.state();api.command({type:'undo'});api.command({type:'delete',ids:['gpu-check-line']});const deleted=api.state();api.command({type:'undo'});const undone=api.state();api.load(doc);const reloaded=api.state();api.setView(before.scale,{x:before.origin.x+20,y:before.origin.y+10});const pan=api.state();return {before,added,copied,deleted,undone,reloaded,pan};})()`);
 if(results.added.count!==results.before.count+1||results.copied.count!==results.before.count+2||results.deleted.count!==results.before.count||results.undone.count!==results.before.count+1||results.pan.stats.builds!==results.reloaded.stats.builds)throw Error('edit invariants failed');
 if(!results.before.stats.active)throw Error('GPU inactive: '+JSON.stringify(results));
 fs.writeFileSync(path.join(out,'integration-results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results));
 await new Promise(r=>setTimeout(r,250));fs.writeFileSync(path.join(out,'integration.png'),(await win.webContents.capturePage()).toPNG());
 }catch(e){console.error(e.stack);process.exitCode=1;}finally{win.destroy();server.close();app.exit(process.exitCode||0);}
});


