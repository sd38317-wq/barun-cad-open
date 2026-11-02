// Read-only diagnostic. No app commands, user windows, document writes or packaging.
// One renderer/document build; isolated hidden Electron; 180-second hard deadline.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'tmp/research-render-20260927/cause-profile');
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile-'+process.pid));
app.commandLine.appendSwitch('disable-renderer-backgrounding');
const report={status:'running',scope:'Hidden direct renderer, no OS input/presentation measurement. One prepared private drawing loaded once.',limitations:['GPU timer is an elapsed GPU command-stream interval and may include idle between CPU submissions; it is not pure GPU busy time.','Category isolation is diagnostic only and omits drawing content; its timing cannot count as product acceptance.','apiMs includes separately reported diagnosticMaskMs; submitOnlyMs excludes that diagnostic classification.','Timer polling serializes samples; this does not measure maximum queued throughput.'],startedAt:new Date().toISOString(),cases:[]};
let win,server,finished=false,watchdog;
const save=()=>fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));
function finish(code=0){if(finished)return;finished=true;clearTimeout(watchdog);win?.destroy();server?.close();report.closed=true;report.finishedAt=new Date().toISOString();save();app.exit(code);}
watchdog=setTimeout(()=>{report.status='timeout';finish(2);},180000);
save();
async function prepare(){
 const {CadGpuRenderer}=await import('/gpu-renderer.js'),G=await import('/geometry.js');
 const face=new FontFace('Barun Drawing Korean','url(/fonts/NanumGothic-Regular.ttf)');await face.load();document.fonts.add(face);
 const doc=await(await fetch('/fixture.json')).json(),view=await(await fetch('/view.json')).json();
 const start=performance.now();G.prepareSharedDrawingReferences(doc);
 const r=new CadGpuRenderer({compileWorker:false});
 const options={doc,revision:1,width:view.width,height:view.height,scale:view.scale,origin:{...view.origin},pixelRatio:2.5};
 r.render(options);
 const gl=r.gl.getContext(),extension=gl.getExtension('EXT_disjoint_timer_query_webgl2');
 const debug=gl.getExtension('WEBGL_debug_renderer_info');
 window.__cause={r,gl,extension,options,frame:0,kind:'all'};
 return {buildWallMs:performance.now()-start,stats:{...r.stats},gpuTimerSupported:!!extension,webgl:gl.getParameter(gl.VERSION),renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),width:view.width,height:view.height,dpr:2.5,topEntities:doc.entities.length};
}
async function measureCase(kind,dpr){
 const d=window.__cause,{r,gl,extension,options}=d;d.kind=kind;
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const originalRender=r.gl.render;
 let submitOnlyMs=0,maskMs=0,objects={},currentQuery=null,measuring=false;
 r.gl.render=function(scene,camera){
  const started=performance.now(),groups={lines:new Set([...r.lineBatches.values()].flatMap(b=>b.objects)),hatches:new Set([...r.sourceHatches.values()].flatMap(xs=>[...xs])),text:new Set(r.textMeshes.map(t=>t.mesh))};
  objects={};for(const [type,roots]of Object.entries(groups)){objects[type]=roots.size;for(const root of roots)root.visible=kind==='all'||type===kind;}
  maskMs=performance.now()-started;
  if(measuring&&extension){currentQuery=gl.createQuery();gl.beginQuery(extension.TIME_ELAPSED_EXT,currentQuery);}
  const t=performance.now();const result=originalRender.call(this,scene,camera);submitOnlyMs=performance.now()-t;
  if(currentQuery)gl.endQuery(extension.TIME_ELAPSED_EXT);return result;
 };
 const render=()=>r.render({...options,pixelRatio:dpr,origin:{x:options.origin.x+(++d.frame%4),y:options.origin.y+(d.frame%4)}});
 try{
  for(let i=0;i<8;i++){render();await wait(0);}
  const samples=[];
  for(let i=0;i<16;i++){
   let gpuMs=null,gpuInvalid=null;currentQuery=null;measuring=true;
   const start=performance.now();render();const apiMs=performance.now()-start;
   measuring=false;const query=currentQuery;
   const calls=r.gl.info.render.calls,triangles=r.gl.info.render.triangles,lines=r.gl.info.render.lines;
   if(query){
    const deadline=performance.now()+4000;
    while(!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)&&performance.now()<deadline)await wait(2);
    if(gl.getParameter(extension.GPU_DISJOINT_EXT))gpuInvalid='disjoint';
    else if(!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE))gpuInvalid='timeout';
    else gpuMs=gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6;
    gl.deleteQuery(query);
   }
   samples.push({apiMs,submitOnlyMs,diagnosticMaskMs:maskMs,cullMs:r.stats.cullMs,gpuMs,gpuInvalid,calls,triangles,lines});
   await wait(0);
  }
  const summary={};for(const key of ['apiMs','submitOnlyMs','diagnosticMaskMs','cullMs','gpuMs','calls','triangles','lines']){const a=samples.map(s=>s[key]).filter(x=>x!==null&&Number.isFinite(x)).sort((a,b)=>a-b);summary[key]=a.length?{min:a[0],p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)}:null;}
  return {kind,dpr,objects,summary,samples,stats:{builds:r.stats.builds,items:r.stats.items,lineChunks:r.stats.lineChunks,hatchObjects:r.stats.hatchObjects,textEntries:r.stats.textEntries,visibleChunks:r.stats.visibleChunks,spatialChunks:r.stats.spatialChunks,detailCandidates:r.stats.detailCandidates}};
 }finally{r.gl.render=originalRender;for(const o of r.spatialObjects.keys())o.visible=true;}
}
app.whenReady().then(async()=>{try{
 const previous=JSON.parse(fs.readFileSync(path.join(root,'tmp/interaction-113mb-20260927/interaction-worker.json'),'utf8'));
 const view=previous.stages.find(s=>s.name==='LOAD_COMPLETE').state.stats.displayedView;
 server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  if(pathname==='/probe.html'){res.setHeader('Content-Type','text/html');res.end('<html><body></body></html>');return;}
  if(pathname==='/view.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(view));return;}
  const allowed=pathname==='/fixture.json'||/^\/[\w-]+\.js$/.test(pathname)||pathname==='/vendor/mlightcad.js'||/^\/fonts\/[\w.-]+$/.test(pathname);
  if(!allowed){res.writeHead(404).end();return;}
  const file=pathname==='/fixture.json'?path.join(root,'tmp/interaction-113mb-20260927/drawing.private.json'):path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.ttf')?'font/ttf':'application/octet-stream');
  fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
 }).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith(base+'/')&&!details.url.startsWith('data:')&&!details.url.startsWith('blob:')}));
 win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 win.webContents.on('render-process-gone',(_,details)=>{report.status='renderer-gone';report.reason=details.reason;finish(1);});
 await win.loadURL(base+'/probe.html');
 report.prepare=await win.webContents.executeJavaScript('('+prepare.toString()+')()');save();
 // Detached GUI processes may outlive their stdout pipe. Results go only to result.json.
 for(const [kind,dpr]of [['all',2.5],['all',1],['lines',2.5],['hatches',2.5],['text',2.5],['all',2.5]]){
  const result=await win.webContents.executeJavaScript('('+measureCase.toString()+')('+JSON.stringify(kind)+','+dpr+')');report.cases.push(result);save();
 }
 await win.webContents.executeJavaScript('window.__cause.r.dispose();delete window.__cause;');
 report.status='completed';finish();
 }catch(error){report.status='failed';report.error=String(error.stack);finish(1);}});
