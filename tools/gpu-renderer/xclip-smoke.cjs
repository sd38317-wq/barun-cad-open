const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'tmp/gpu-xclip');
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile-'+process.pid));
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.whenReady().then(async()=>{
 const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return;}if(req.url==='/probe.html'){res.setHeader('Content-Type','text/html');res.end('<html><body></body></html>');return;}res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':'text/plain');fs.createReadStream(p).on('error',()=>res.destroy()).pipe(res);}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const w=new BrowserWindow({show:false,width:500,height:500,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}}),errors=[];
 w.webContents.on('console-message',(event,level,legacy)=>{const msg=event.message||legacy;if(event.level==='error'||level===3)errors.push(msg);});
 const timer=setTimeout(()=>app.exit(2),60000);
 try{
 await w.loadURL('http://127.0.0.1:'+server.address().port+'/probe.html');
 const result=await w.webContents.executeJavaScript(`(async()=>{
  const {CadGpuRenderer}=await import('/gpu-renderer.js'),G=await import('/geometry.js');
  const rect=(a,b,c,d)=>[{x:a,y:b},{x:c,y:b},{x:c,y:d},{x:a,y:d}];
  const normal={enabled:true,points:rect(100,100,300,300)},inverted={...normal,inverted:true},nested={enabled:true,inverted:true,points:rect(160,160,240,240)};
  const shapes=[{type:'line',points:[{x:20,y:200},{x:380,y:200}],constantWidth:5},{type:'hatch',solid:true,points:rect(20,20,380,380)},{type:'text',text:'MMMMMMMMMM',position:{x:20,y:190},height:70}];
  const tests=[];
  for(const pixelRatio of [1,2])for(const [name,masks] of [['normal',[normal]],['inverted',[inverted]],['nested',[normal,nested]],['concave',[{enabled:true,points:[{x:100,y:100},{x:300,y:100},{x:300,y:300},{x:220,y:300},{x:220,y:180},{x:100,y:180}]}]]])for(const shape of shapes){
   const r=new CadGpuRenderer();let entity={...shape,id:'shape',layer:'0',color:'#ff0000'};
   for(const clip of [...masks].reverse())entity={id:'block',type:'block',layer:'0',clip,entities:[entity]};
   const doc={entities:[entity],layers:[{id:'0',name:'0',visible:true,color:'#ff0000'}]};
   r.render({doc,revision:1,width:400,height:400,scale:1,origin:{x:0,y:400},pixelRatio});
   const c=document.createElement('canvas');c.width=c.height=400*pixelRatio;const ctx=c.getContext('2d');ctx.drawImage(r.canvas,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height).data;let outside=0,inside=0;
   for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(pixels[(y*c.width+x)*4+3]>5){const p={x:(x+.5)/pixelRatio,y:400-(y+.5)/pixelRatio};const edge=masks.some(m=>G.segments({points:m.points,closed:true}).some(s=>G.distanceToSegment(p,...s)<1.5));if(edge)continue;if(masks.every(m=>G.clipContains(m,p)))inside++;else outside++;}
   tests.push({name,type:shape.type,pixelRatio,inside,outside,drawCalls:r.stats.drawCalls});
   if(!inside||outside)throw Error(JSON.stringify(tests.at(-1)));
   r.dispose();
  }
  // Repeated clipped MOVE/UNDO paths must retain unrelated geometry and retire
  // obsolete mask textures/materials rather than accumulate every old mask.
  const r=new CadGpuRenderer(),base={id:'moving',type:'block',layer:'0',clip:normal,entities:shapes.map(s=>({...s,layer:'0',color:'#ff0000'}))};
  const other={id:'other',type:'line',layer:'0',points:[{x:0,y:0},{x:5,y:5}]};
  let current=structuredClone(base),doc={entities:[current,other],layers:[{id:'0',name:'0',visible:true,color:'#ff0000'}]},revision=1;
  const options={width:400,height:400,scale:1,origin:{x:0,y:400},pixelRatio:1};
  r.render({...options,doc,revision});
  const textureCounts=[];
  for(let i=1;i<=20;i++){
   const added=G.transformEntity(base,p=>({x:p.x+(i%2?i:0),y:p.y})),next={...doc,entities:[added,other]},edit={previousDoc:doc,previousRevision:revision,lightweight:true,removed:[current],added:[added]};
   r.render({...options,doc:next,revision:++revision,edit});doc=next;current=added;
   textureCounts.push(r.clipAssets.size);
   if(r.stats.builds!==1||r.clipAssets.size!==1)throw Error('clipped edit retained masks/builds '+JSON.stringify({builds:r.stats.builds,assets:r.clipAssets.size}));
  }
  const next={...doc,entities:[other]};r.render({...options,doc:next,revision:revision+1,edit:{previousDoc:doc,previousRevision:revision,lightweight:true,removed:[current],added:[]}});
  if(r.clipAssets.size!==0)throw Error('deleted clip texture retained');r.dispose();
  const large=new CadGpuRenderer(),labels=Array.from({length:10000},(_,i)=>({id:'t'+i,type:'text',layer:'0',position:{x:(i%100)*1000,y:Math.floor(i/100)*1000},height:20,text:'DRAWING-LABEL-'+i+'-UNIQUE-LONG-CONTENT'}));
  const largeDoc={entities:[other,...labels],layers:doc.layers};
  large.render({doc:largeDoc,revision:1,width:400,height:400,scale:.003,origin:{x:20,y:380},pixelRatio:1});
  const fit={...large.stats},lineObject=[...large.lineBatches.values()][0].objects[0];
  large.render({doc:largeDoc,revision:1,width:400,height:400,scale:1,origin:{x:20,y:380},pixelRatio:1});
  const local={...large.stats},generation=large.stats.textViewportBuilds;
  for(let i=0;i<10;i++)large.render({doc:largeDoc,revision:1,width:400,height:400,scale:1,origin:{x:20+i,y:380},pixelRatio:1});
  if(fit.textSourceCount!==10000||fit.textViewportCandidates!==10000||local.textViewportCandidates>=100||large.stats.builds!==1||large.stats.textViewportBuilds!==generation||![...large.lineBatches.values()][0].objects.includes(lineObject))throw Error('viewport text retention '+JSON.stringify({fit,local,final:large.stats}));
  const read=()=>{const c=document.createElement('canvas');c.width=c.height=400;const ctx=c.getContext('2d');ctx.drawImage(large.canvas,0,0);return ctx.getImageData(0,0,400,400).data;};
  const view={doc:largeDoc,revision:1,width:400,height:400,scale:1,origin:{x:20,y:380},pixelRatio:1};
  large.render(view);const pixels=read(),beforeFrames=large.stats.frames,beforeGeneration=large.stats.textViewportBuilds;
  for(let i=0;i<30;i++)large.render(view);
  if(large.stats.frames!==beforeFrames)throw Error('unchanged viewport submitted a new GPU frame');
  large.render({...view,hiddenTextId:'t0'});const hidden=read();if(hidden.every((v,i)=>v===pixels[i]))throw Error('active text was not hidden');
  for(let i=0;i<10;i++)large.render({...view,hiddenTextId:'t0',origin:{x:20+i*.1,y:380}});
  large.render({...view,hiddenTextId:'t0'});const restoredHidden=read();if(!restoredHidden.every((v,i)=>v===hidden[i]))throw Error('pan/return changed hidden text pixels');
  large.render(view);const restored=read();if(!restored.every((v,i)=>v===pixels[i]))throw Error('pan/return changed geometry pixels');
  if(large.stats.textViewportBuilds!==beforeGeneration)throw Error('micro pan rebuilt text');
  const largeText={fit,local,final:{...large.stats},stationaryFrameDelta:0,panReturnPixelsEqual:true,hiddenTextPixelsEqual:true};large.dispose();
  const panTests=[],panDoc={layers:doc.layers,entities:[
   {id:'fill',type:'hatch',layer:'0',color:'#ff3030',solid:true,points:rect(-450,-450,450,450)},
   {id:'diag',type:'line',layer:'0',color:'#ffffff',points:[{x:-450,y:-350},{x:450,y:350}]},
   {id:'hatch',type:'hatch',layer:'0',color:'#30ff60',solid:true,points:rect(-160,-160,270,270)},
   {id:'circle',type:'circle',layer:'0',color:'#ffff00',center:{x:0,y:0},radius:230},
   {id:'text',type:'text',layer:'0',color:'#ffffff',height:30,position:{x:-180,y:160},text:'PAN alpha text / 한글'},
   {id:'clip',type:'block',layer:'0',clip:{enabled:true,inverted:true,points:rect(-90,-90,90,90)},entities:[{type:'line',layer:'0',color:'#00ffff',points:[{x:-350,y:80},{x:350,y:80}]},{type:'text',layer:'0',color:'#ff00ff',height:25,position:{x:-230,y:-170},text:'Clipped text across edges'}]}
  ]};
  const pixelsOf=image=>{const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};
  for(const pixelRatio of [1,1.25,1.5,2]){
   const candidate=new CadGpuRenderer(),reference=new CadGpuRenderer();
   const options={doc:panDoc,revision:1,width:400,height:400,scale:1,pixelRatio,origin:{x:200,y:200}};
   candidate.render(options);reference.render(options);let worst=0,differences=0,examples=[];
   const steps=Array.from({length:20},(_,i)=>({x:i<10?i+1:19-i,y:i<10?(i+1)*2:(19-i)*2}));
   for(const p of steps){
    const current={...options,origin:{x:200+p.x/pixelRatio,y:200+p.y/pixelRatio}};
    const a=pixelsOf(candidate.render(current));reference.renderSnapshot=null;const b=pixelsOf(reference.render(current));
    for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);worst=Math.max(worst,d);if(d>2){differences++;if(examples.length<12)examples.push({step:p,index:i,x:Math.floor(i/4)%(400*pixelRatio),y:Math.floor(i/4/(400*pixelRatio)),a:a[i],b:b[i]});}}
   }
   const record={pixelRatio,frames:steps.length,panFrames:candidate.stats.panReusedFrames||0,maxChannelDifference:worst,channelsOverTolerance:differences,examples};panTests.push(record);
   candidate.dispose();reference.dispose();if(differences)throw Error('PAN pixel mismatch '+JSON.stringify(record));
  }
  return {passed:true,tests,clippedMoveUndoCycles:20,textureCounts,deletedClipAssets:0,largeText,panTests};
 })()`);
 if(errors.length)throw Error(errors.join('\n'));
 fs.writeFileSync(path.join(out,'pixels.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,tests:result.tests.length}));
 }catch(e){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(e.stack),errors},null,2));console.error(e.stack);process.exitCode=1;}finally{clearTimeout(timer);w.destroy();server.close();app.exit(process.exitCode||0);}
});
