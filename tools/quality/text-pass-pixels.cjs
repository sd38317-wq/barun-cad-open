const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'tmp/render-fix-20260927');
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'pixel-profile-'+process.pid));
let win,server;const timer=setTimeout(()=>app.exit(2),60000);
app.whenReady().then(async()=>{let result;try{
server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+req.url.split('?')[0]);if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return;}if(req.url==='/probe.html'){res.setHeader('Content-Type','text/html');res.end('<html></html>');return;}res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':'application/octet-stream');fs.createReadStream(p).on('error',()=>res.destroy()).pipe(res);}).listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
win=new BrowserWindow({show:false,width:600,height:600,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
await win.loadURL('http://127.0.0.1:'+server.address().port+'/probe.html');
result=await win.webContents.executeJavaScript('('+probe.toString()+')()');
}catch(error){result={passed:false,error:String(error.stack)};}finally{
fs.writeFileSync(path.join(out,'text-pass-pixels.json'),JSON.stringify(result,null,2));clearTimeout(timer);win?.destroy();server?.close();app.exit(result?.passed?0:1);}});
async function probe(){
const {CadGpuRenderer}=await import('/gpu-renderer.js');
const font=new FontFace('Barun Drawing Korean','url(/fonts/NanumGothic-Regular.ttf)');await font.load();document.fonts.add(font);
const rows=[];
for(const dpr of [1,1.25,1.5,2,2.5]){
const r=new CadGpuRenderer({compileWorker:false}),entities=[];
for(let i=0;i<30;i++)entities.push({id:'t'+i,type:'text',layer:'0',position:{x:i%5*55,y:Math.floor(i/5)*32},height:18,text:'한글 ABC 겹침',rotation:i%3*30,color:i%2?'#00ffff':'#ffffff'});
const doc={layers:[{id:'0',name:'0',visible:true,color:'#ffffff'}],entities};
const o={doc,revision:1,width:420,height:360.4,origin:{x:60,y:280},scale:1,pixelRatio:dpr};
r.render(o);
const capture=()=>{const c=document.createElement('canvas');c.width=r.canvas.width;c.height=r.canvas.height;const x=c.getContext('2d');x.drawImage(r.canvas,0,0);return x.getImageData(0,0,c.width,c.height).data;};
for(const m of r.ownedMaterials)m.forceSinglePass=false;r.renderSnapshot=null;
r.render(o);const a=capture(),oldCalls=r.stats.drawCalls;
for(const m of r.ownedMaterials)m.forceSinglePass=true;r.renderSnapshot=null;
r.render(o);const b=capture(),newCalls=r.stats.drawCalls;
let max=0,bad=0;for(let i=0;i<a.length;i++){max=Math.max(max,Math.abs(a[i]-b[i]));if(a[i]!==b[i])bad++;}
rows.push({dpr,max,bad,oldCalls,newCalls});r.dispose();
}
return {passed:rows.every(r=>r.bad===0&&r.newCalls<r.oldCalls),rows};
}
