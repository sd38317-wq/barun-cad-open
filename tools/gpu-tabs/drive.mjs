// 작은 DXF N개를 차례로 열고(두 번째 실행 = second-instance) GPU 프로세스 PrivateMemorySize64 를 잰 뒤, 하나 남기고 칸을 닫고 다시 잰다.
// node drive.mjs <label> [N] [root]
import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs';import {fileURLToPath} from 'node:url';import path from 'node:path';
const REPO=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),HERE=path.join(REPO,'tmp','gpu-tabs');fs.mkdirSync(HERE,{recursive:true});
const label=process.argv[2]||'run',N=Number(process.argv[3]||20),ROOT=process.argv[4]||REPO;
const EXE=path.join(ROOT,'node_modules/electron/dist/electron.exe'),UD=path.join(HERE,'ud-'+label),PORT=9334;
fs.rmSync(UD,{recursive:true,force:true});
const dir=process.env.DXF_DIR||'D:/어플/캐드/tmp/details-v2',files=fs.readdirSync(dir).filter(f=>f.endsWith('.dxf')).sort().slice(0,N).map(f=>path.join(dir,f).replace(/\//g,'\\'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const args=file=>[ROOT,'--user-data-dir='+UD,'--remote-debugging-port='+PORT,'--disable-features=CalculateNativeWinOcclusion',file];
const env={...process.env,BARUN_CAD_RENDERER:'gpu',BARUN_CAD_RECOVERY_DIR:path.join(HERE,'recovery')};
const main=spawn(EXE,args(files[0]),{env,stdio:'ignore'});
const ps=script=>execFileSync('powershell',['-NoProfile','-Command',script],{encoding:'utf8'});
function measure(){
 const out=ps(`$all=Get-CimInstance Win32_Process -Filter "Name='electron.exe'";$kids=$all|?{$_.ParentProcessId -eq ${main.pid} -or $_.ProcessId -eq ${main.pid}};$kids|%{$p=Get-Process -Id $_.ProcessId -EA SilentlyContinue;if($p){$t=if($_.CommandLine -match '--type=([\\w-]+)'){$matches[1]}else{'browser'};"$t $($p.PrivateMemorySize64)"}}`);
 const rows=out.trim().split(/\r?\n/).map(l=>l.split(' ')).map(([t,b])=>({t,mb:Math.round(Number(b)/1048576)}));
 const gpu=rows.filter(r=>r.t==='gpu-process').reduce((a,r)=>a+r.mb,0),renderers=rows.filter(r=>r.t==='renderer');
 return {gpu,renderers:renderers.length,rendererMb:renderers.reduce((a,r)=>a+r.mb,0),total:rows.reduce((a,r)=>a+r.mb,0)};
}
async function targets(){try{const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);return (await r.json()).filter(t=>t.type==='page'&&/:\d+\/\?renderer=gpu/.test(t.url));}catch{return [];}}
async function evaluate(target,expression){
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
 const result=await new Promise(res=>{ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id===1)res(m.result);};ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});
 ws.close();return result?.result?.value;
}
async function waitOpened(count,file){
 const base=path.basename(file,'.dxf');
 for(let i=0;i<240;i++){
  const list=await targets();
  if(list.length>=count){for(const t of list){const titles=await evaluate(t,`JSON.stringify((window.cad?.drawings?.list?.()||[]).map(d=>d.name))`).catch(()=>'');if(String(titles).includes(base))return true;}}
  await sleep(500);
 }
 return false;
}
const log=[];
for(let i=0;i<files.length;i++){
 if(i>0)spawn(EXE,args(files[i]),{env,stdio:'ignore'});
 const ok=await waitOpened(i+1,files[i]);await sleep(2500);
 const m={step:'open',n:i+1,ok,...measure()};log.push(m);console.log(JSON.stringify(m));
}
await sleep(5000);
for(const t of await targets())console.log('canvases',await evaluate(t,`document.hidden+' '+JSON.stringify([...document.querySelectorAll('canvas')].filter(c=>c.width*c.height>4096).map(c=>(c.id||c.className)+':'+c.width+'x'+c.height))`).catch(e=>String(e)));
if(process.env.EXPR){await sleep(3000);{const m={step:'before-expr',...measure()};console.log(JSON.stringify(m));}for(const t of await targets())console.log('expr',await evaluate(t,`document.hidden?(${process.env.EXPR}):'visible'`).catch(e=>String(e)));await sleep(6000);{const m={step:'after-expr',...measure()};console.log(JSON.stringify(m));}}
if(process.env.HOLD){console.log('holding');await sleep(Number(process.env.HOLD));}
{const m={step:'settled',n:files.length,...measure()};log.push(m);console.log(JSON.stringify(m));}
// 첫 칸만 남기고 닫는다(칸 자신의 닫기 = 마지막 도면 탭 닫기와 같은 길).
const list=await targets();
for(const t of list.slice(1))await evaluate(t,`window.cadDesktop.windowShortcut('close')`).catch(()=>{});
for(let i=0;i<40&&(await targets()).length>1;i++)await sleep(500);
await sleep(8000);{const m={step:'closed',n:(await targets()).length,...measure()};log.push(m);console.log(JSON.stringify(m));}
fs.writeFileSync(path.join(HERE,`result-${label}.json`),JSON.stringify(log,null,1));
try{process.kill(main.pid);}catch{}
ps(`Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ?{$_.CommandLine -like '*ud-${label}*'} | %{Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue}`);
ps(`Get-CimInstance Win32_Process -Filter "Name='python.exe'" | ?{$_.CommandLine -like '*server.py*18765*'} | %{Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue}`);
