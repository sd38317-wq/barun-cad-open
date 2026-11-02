// 숨었다(버퍼 놓음) 돌아온 칸이 같은 그림인지, 숨은 동안 글자를 더해도 옛 글자가 남는지 화면으로 확인한다.
import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs';import {fileURLToPath} from 'node:url';import path from 'node:path';
const REPO=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),HERE=path.join(REPO,'tmp','gpu-tabs');fs.mkdirSync(HERE,{recursive:true});
const ROOT=process.argv[2]||REPO;
const EXE=path.join(ROOT,'node_modules/electron/dist/electron.exe'),UD=path.join(HERE,'ud-vis'),PORT=9334;
fs.rmSync(UD,{recursive:true,force:true});
const dir='D:\\어플\\캐드\\tmp\\details-v2',pick=fs.readdirSync(dir).filter(f=>f.endsWith('.dxf')).sort(),A=path.join(dir,pick[0]),B=path.join(dir,pick[1]);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const args=file=>[ROOT,'--user-data-dir='+UD,'--remote-debugging-port='+PORT,'--disable-features=CalculateNativeWinOcclusion',file];
const env={...process.env,BARUN_CAD_RENDERER:'gpu',BARUN_CAD_RECOVERY_DIR:path.join(HERE,'recovery')};
const main=spawn(EXE,args(A),{env,stdio:'ignore'});
async function targets(){try{return (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(t=>t.type==='page'&&/renderer=gpu/.test(t.url));}catch{return [];}}
async function cdp(target,method,params={}){
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
 const r=await new Promise(res=>{ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id===1)res(m);};ws.send(JSON.stringify({id:1,method,params}));});ws.close();return r.result;
}
const ev=async(t,expression)=>(await cdp(t,'Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}))?.result?.value;
async function waitFor(fn,ms=60000){for(const end=Date.now()+ms;Date.now()<end;await sleep(300)){const v=await fn().catch(()=>null);if(v)return v;}throw Error('timeout');}
const named=async name=>waitFor(async()=>{for(const t of await targets())if(String(await ev(t,`JSON.stringify(window.cad?.drawings?.list?.().map(d=>d.name)||[])`)).includes(path.basename(name,'.dxf')))return t;});
async function shot(t,file){
 const clip=await ev(t,`(()=>{const r=document.getElementById('canvas').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`);
 const r=await cdp(t,'Page.captureScreenshot',{format:'png',clip});fs.writeFileSync(path.join(HERE,file),Buffer.from(r.data,'base64'));return r.data;
}
const state=t=>ev(t,`JSON.stringify({hidden:document.hidden,canvas:document.getElementById('canvas').width})`);
const out=[];
try{
 const tA=await named(A);await sleep(4000);const a1=await shot(tA,'A1.png');out.push('A1 '+await state(tA));
 spawn(EXE,args(B),{env,stdio:'ignore'});const tB=await named(B);await sleep(8000);
 out.push('A hidden '+await state(tA));
 await ev(tB,`window.cadDesktop.windowShortcut('next')`);await sleep(1500);
 const a2=await shot(tA,'A2.png');out.push('A2 '+await state(tA)+' same='+(a1===a2));
 // 다시 숨기고, 숨은 동안 기존 글자 옆에 글자를 더한다 → 놓았던 아틀라스 장을 다시 그리는 길.
 await ev(tA,`window.cadDesktop.windowShortcut('next')`);await sleep(8000);out.push('A hidden2 '+await state(tA));
 out.push('add '+await ev(tA,`(()=>{const d=window.cad.getDocument(),t=d.entities.find(e=>e.type==='text');if(!t)return 'no text';window.cad.execute({type:'add',entity:{type:'text',position:{x:t.position.x,y:t.position.y-t.height*3},height:t.height,text:'숨김중추가 ABC',layer:t.layer}});return 'added near '+JSON.stringify(t.text)})()`));
 await ev(tB,`window.cadDesktop.windowShortcut('next')`);await sleep(2000);
 await shot(tA,'A3.png');out.push('A3 '+await state(tA));
}catch(e){out.push('ERR '+e.stack);}
console.log(out.join('\n'));
try{process.kill(main.pid);}catch{}
execFileSync('powershell',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ?{$_.CommandLine -like '*ud-vis*'} | %{Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue}; Get-CimInstance Win32_Process -Filter "Name='python.exe'" | ?{$_.CommandLine -like '*server.py*' -and $_.CommandLine -like '*18765*'} | %{Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue}`]);
