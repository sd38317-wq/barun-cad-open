// Hidden, isolated renderer verification. Does not touch the user's open drawing.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../..');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.setPath('userData',path.join(__dirname,'spatial-test-profile-'+process.pid));
app.whenReady().then(async()=>{
 const server=http.createServer((req,res)=>{
  const name=decodeURIComponent(req.url.split('?')[0]);
  const file=name==='/gpu-renderer-before-spatial.js'?path.join(__dirname,'renderer-before-spatial.txt'):path.resolve(root,'.'+name);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
 }).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 const win=new BrowserWindow({show:false,width:1000,height:760,webPreferences:{backgroundThrottling:false}});
 try{
  await win.loadURL(`http://127.0.0.1:${server.address().port}/tools/gpu-renderer/compare.html`);
  const start=Date.now();
  while(true){const state=await win.webContents.executeJavaScript('({ready:window.ready,failure:window.failure})');if(state.failure)throw Error(state.failure);if(state.ready)break;if(Date.now()-start>90000)throw Error('renderer startup timeout');await new Promise(r=>setTimeout(r,100));}
  const result=await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname,'spatial-check.js'),'utf8'));
  for(const view of result.views)for(const key of ['culledImage','fullImage'])if(view[key]){fs.writeFileSync(path.join(__dirname,`spatial-${view.name}-${key}.png`),Buffer.from(view[key].split(',')[1],'base64'));delete view[key];}
  fs.writeFileSync(path.join(__dirname,'spatial-results.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
  // Repeated full-scene frames also vary slightly in this WebGL backend.
  // Reject a >10/255 channel change or a difference covering >0.1% of pixels;
  // retain raw differences and full-vs-full noise in the report.
  if(result.views.some(v=>v.diagnostic.over10>0||v.differentPixels>700))throw Error('Culled rendering exceeds the documented pixel tolerance');
  if(!result.views.some(v=>v.stats.culledChunks>0))throw Error('No viewport culled any chunks');
 }catch(error){console.error(error.stack);process.exitCode=1;}finally{win.destroy();server.close();app.exit(process.exitCode||0);}
});
