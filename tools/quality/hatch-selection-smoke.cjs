// Isolated source-app input check; never opens or saves a user's drawing.
const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'tmp/hatch-selection-check');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,'profile-'+process.pid));
app.whenReady().then(async()=>{let server,win;try{
 server=spawn('python',['server.py','--port','18988','--no-browser'],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,APPDATA:out,LOCALAPPDATA:out}});
 for(let i=0;;i++){try{if((await fetch('http://127.0.0.1:18988/api/status')).ok)break;}catch{}if(i>100)throw Error('server timeout');await new Promise(r=>setTimeout(r,100));}
 win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{backgroundThrottling:false,offscreen:true}});
 await win.loadURL('http://127.0.0.1:18988/?gpu-test=1');
 for(let i=0;!await win.webContents.executeJavaScript('!!window.__cadGpuTest');i++){if(i>100)throw Error('app failed');await new Promise(r=>setTimeout(r,100));}
 const result=await win.webContents.executeJavaScript(`(()=>{
 const t=window.__cadGpuTest,canvas=document.getElementById('canvas');
 const rect=(a,b)=>[{x:a,y:a},{x:b,y:a},{x:b,y:b},{x:a,y:b}];
 const doc={version:2,units:'mm',layers:[{id:'0',name:'0',color:'#ffffff',visible:true,locked:false}],entities:[{id:'block',type:'block',layer:'0',entities:[{id:'h',type:'hatch',layer:'0',points:rect(0,1000),loops:[rect(200,800)],solid:true,spacing:100,angle:0}]},{id:'line',type:'line',layer:'0',points:[{x:400,y:400},{x:600,y:400}]}]};
 t.load(doc);t.setView(.3,{x:50,y:350});t.runCommand('ERASE');
 const event=(type,x,y,buttons)=>{const r=canvas.getBoundingClientRect();canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,pointerType:'mouse',button:0,buttons,clientX:r.left+50+x*.3,clientY:r.top+350-y*.3}));};
 event('pointerdown',300,300,1);event('pointerup',300,300,0);
 const first=t.state();if(!first.selectionWindow?.awaitingCorner||first.selected.length)throw Error('hole click did not start window');
 event('pointermove',700,600,0);event('pointerdown',700,600,1);event('pointerup',700,600,0);
 const second=t.state();if(second.selected.join(',')!=='line'||second.selectionWindow)throw Error('second click selected wrong object');
 t.load(doc);t.setView(.3,{x:50,y:350});t.runCommand('ERASE');event('pointerdown',500,400,1);event('pointerup',500,400,0);
 if(t.state().selected.join(',')!=='line')throw Error('direct line click regressed');
 return {holeStartsWindow:true,secondClickSelectsLine:true,directLinePick:true};
 })()`);
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));
 }catch(e){fs.writeFileSync(path.join(out,'failure.txt'),String(e.stack));}finally{win?.destroy();server?.kill();app.exit();}});
