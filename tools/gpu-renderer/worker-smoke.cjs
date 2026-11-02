const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'tmp/gpu-render-worker');
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile-'+process.pid));
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(async()=>{
 const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return;}if(req.url==='/probe.html'){res.setHeader('Content-Type','text/html');res.end('<html><body></body></html>');return;}res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.html')?'text/html':p.endsWith('.css')?'text/css':'application/octet-stream');fs.createReadStream(p).on('error',()=>res.destroy()).pipe(res);}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const w=new BrowserWindow({show:false,width:500,height:500,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 const timer=setTimeout(()=>app.exit(2),60000);
 try{
 await w.loadURL('http://127.0.0.1:'+server.address().port+'/probe.html');
 const result=await w.webContents.executeJavaScript(`(async()=>{
  const {CadGpuRenderer}=await import('/gpu-renderer.js'),{GpuRenderClient}=await import('/gpu-render-client.js');
  const face=new FontFace('Barun Drawing Korean','url(/fonts/NanumGothic-Regular.ttf)');await face.load();document.fonts.add(face);
  const rect=(a,b,c,d)=>[{x:a,y:b},{x:c,y:b},{x:c,y:d},{x:a,y:d}];
  const doc={layers:[{id:'0',name:'0',visible:true,color:'#ffffff'}],entities:[
   {id:'a',type:'line',layer:'0',color:'#ffffff',points:[{x:-400,y:-300},{x:400,y:300}]},
   {id:'b',type:'hatch',layer:'0',solid:true,color:'#ff3333',points:rect(-200,-200,200,200)},
   {id:'c',type:'text',layer:'0',position:{x:-150,y:50},height:30,text:'한글 Worker 정확성'},
   {id:'f1',type:'text',layer:'0',position:{x:-150,y:-20},height:18,text:'맑은고딕 abc',sourceFont:'malgun.ttf'},
   {id:'f2',type:'text',layer:'0',position:{x:-150,y:-50},height:18,text:'SHX 대응 abc',sourceFont:'romans.shx'},
   {id:'f3',type:'text',layer:'0',position:{x:-150,y:-75},height:18,text:'Arial abc',sourceFont:'arial.ttf'},
   {id:'d',type:'block',layer:'0',clip:{enabled:true,inverted:true,points:rect(-80,-80,80,80)},entities:[{type:'circle',layer:'0',center:{x:0,y:0},radius:120,color:'#00ffff'}]}
  ]};
  const pixels=image=>{const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const x=c.getContext('2d');x.drawImage(image,0,0);return x.getImageData(0,0,c.width,c.height).data;};
  const wait=async(client,o)=>{client.request(o);for(let i=0;i<1000;i++){if(client.failed)throw Error(client.failed);if(client.frame&&!client.pending)return client.frame;await new Promise(r=>setTimeout(r,10));}throw Error('frame timeout');};
  const results=[];
  for(const dpr of [1,1.25,1.5,2]){
   const c=new GpuRenderClient({overscan:0}),r=new CadGpuRenderer();const o={doc,revision:1,width:400,height:400,scale:1,origin:{x:200,y:200},pixelRatio:dpr};
   const frame=await wait(c,o),a=pixels(frame.bitmap),b=pixels(r.render(o));let max=0,bad=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);max=Math.max(max,d);if(d>2)bad++;}
   results.push({dpr,max,bad,stats:c.stats});c.dispose();r.dispose();if(bad)throw Error('worker pixels differ '+JSON.stringify(results.at(-1)));
  }
  const overscan=[];
  for(const dpr of [1,1.25,1.5,2]){
   const c=new GpuRenderClient(),r=new CadGpuRenderer(),o={doc,revision:1,width:400,height:400,scale:1,origin:{x:200,y:200},pixelRatio:dpr};
   const frame=await wait(c,o),a=pixels(frame.bitmap),b=pixels(r.render({...frame.region,doc,revision:1}));let max=0,bad=0;
   for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);max=Math.max(max,d);if(d>2)bad++;}
   if(bad)throw Error('overscan worker/main pixels differ '+dpr+' '+max);
   const messages=c.stats.documentMessages,submitted=c.stats.viewMessages,start=performance.now();
   for(let i=1;i<=40;i++){const ready=c.request({...o,origin:{x:200+i/dpr,y:200+i/dpr}});if(!ready||ready.view.origin.x!==200+i/dpr)throw Error('integer crop unavailable');}
   const submitMs=performance.now()-start;await wait(c,{...o,origin:{x:240/dpr+200-200/dpr,y:240/dpr+200-200/dpr}});
   // COW erase is sent as a delta and must keep the initial scene build.
   const beforeBuilds=c.stats.builds,next={...doc,entities:doc.entities.filter(e=>e.id!=='a')},changed={...o,doc:next,revision:2,edit:{lightweight:true,previousDoc:doc,previousRevision:1,removed:[doc.entities[0]],added:[]}};
   const edited=await wait(c,changed),actual=pixels(edited.bitmap),expected=pixels(r.render({...edited.region,doc:next,revision:2}));let editBad=0;
   for(let i=0;i<actual.length;i++)if(Math.abs(actual[i]-expected[i])>2)editBad++;
   if(editBad||c.stats.builds!==beforeBuilds)throw Error('worker delta accuracy/build failure '+editBad);
   overscan.push({dpr,max,bad,mainSubmit40Ms:submitMs,documentMessagesDuringPan:c.stats.documentMessages-messages-1,viewMessages:c.stats.viewMessages-submitted,editBad,builds:c.stats.builds});c.dispose();r.dispose();
  }
  return {passed:true,results,overscan};
 })()`);
 await w.loadURL('http://127.0.0.1:'+server.address().port+'/index.html?renderer=gpu-worker&gpu-test=1');
 result.app=await w.webContents.executeJavaScript(`(async()=>{
  const pause=ms=>new Promise(r=>setTimeout(r,ms));while(!window.__cadGpuTest)await pause(10);
  const api=__cadGpuTest,c=document.getElementById('canvas');
  const wait=async()=>{for(let i=0;i<1000;i++){api.draw();const s=api.state();if(s.stats.reason)throw Error(s.stats.reason);if(s.stats.frames>0&&!s.stats.workerPending&&!s.stats.viewPending)return s;await pause(10);}throw Error('app settle timeout');};
  api.load({layers:[{id:'0',name:'0',visible:true,color:'#ffffff'}],entities:[{id:'guard-line',type:'line',layer:'0',points:[{x:0,y:0},{x:100,y:0}]}]});await wait();api.setView(1,{x:100,y:100});await wait();
  const pointer=(type,x,y,buttons=0)=>{const r=c.getBoundingClientRect();c.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,pointerType:'mouse',button:0,buttons,clientX:r.left+x,clientY:r.top+y}));};
  api.runCommand('ERASE');api.setView(2,{x:100,y:100});pointer('pointerdown',200,100,1);pointer('pointerup',200,100);const rejected=api.state();
  if(rejected.selected.length||rejected.count!==1)throw Error('pending camera permitted selection');
  await wait();pointer('pointerdown',200,100,1);pointer('pointerup',200,100);const accepted=api.state();
  if(!accepted.selected.includes('guard-line'))throw Error('settled camera blocked selection '+JSON.stringify(accepted));
  c.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait();if(api.state().count!==0)throw Error('settled ERASE failed');
  return {pendingClickRejected:true,settledClickAccepted:true,eraseSucceeded:true};
 })()`);
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));
 }catch(error){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(error.stack)},null,2));process.exitCode=1;}finally{clearTimeout(timer);w.destroy();server.close();app.exit(process.exitCode||0);}
});
