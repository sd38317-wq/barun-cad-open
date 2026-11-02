// 실제 소스판에서 MCP cad_open_file / cad_close_document: 열고, 이미 열린 것 찾고, 저장 안 한 것 거부, 닫으면 칸(프로세스)이 사라지는지.
import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs';import {fileURLToPath} from 'node:url';import path from 'node:path';
const REPO=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),HERE=path.join(REPO,'tmp','gpu-tabs');fs.mkdirSync(HERE,{recursive:true});
const ROOT=process.argv[2]||REPO;
const EXE=path.join(ROOT,'node_modules/electron/dist/electron.exe'),UD=path.join(HERE,'ud-mcp'),PORT=9334;
fs.rmSync(UD,{recursive:true,force:true});
const dir='D:\\어플\\캐드\\tmp\\details-v2',files=fs.readdirSync(dir).filter(f=>f.endsWith('.dxf')).sort().slice(0,3).map(f=>path.join(dir,f));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const env={...process.env,BARUN_CAD_RENDERER:'gpu',BARUN_CAD_RECOVERY_DIR:path.join(HERE,'recovery')};
const main=spawn(EXE,[ROOT,'--user-data-dir='+UD,'--remote-debugging-port='+PORT,'--disable-features=CalculateNativeWinOcclusion'],{env,stdio:'ignore'});
async function targets(){try{return (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter(t=>t.type==='page'&&/renderer=gpu/.test(t.url));}catch{return [];}}
async function ev(t,expression){const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise((a,b)=>{ws.onopen=a;ws.onerror=b;});const r=await new Promise(res=>{ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id===1)res(m);};ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});ws.close();return r.result?.result?.value;}
function mcp(name,args){
 const out=execFileSync('python',['-c','import mcp_server,json,sys\ntry:print(json.dumps(mcp_server.call(sys.argv[1],json.loads(sys.argv[2])),ensure_ascii=False))\nexcept Exception as e:print(json.dumps({"ERROR":str(e)},ensure_ascii=False))',name,JSON.stringify(args)],{cwd:ROOT,env:{...process.env,BARUN_CAD_INSTANCE:'18765',PYTHONIOENCODING:'utf-8'},encoding:'utf8'});
 return JSON.parse(out.trim().split('\n').pop());
}
const gpu=()=>Math.round(Number(execFileSync('powershell',['-NoProfile','-Command',`$g=Get-CimInstance Win32_Process -Filter "Name='electron.exe'"|?{$_.ParentProcessId -eq ${main.pid} -and $_.CommandLine -match 'gpu-process'};(Get-Process -Id $g.ProcessId).PrivateMemorySize64`],{encoding:'utf8'}))/1048576);
const log=(...a)=>console.log(...a.map(x=>typeof x==='string'?x:JSON.stringify(x)));
try{
 for(let i=0;i<120&&!(await targets()).length;i++)await sleep(500);
 await sleep(6000);
 const sessions=[];
 for(const f of files){const t0=Date.now();const r=mcp('cad_open_file',{path:f});log('open',path.basename(f),Date.now()-t0+'ms',r);sessions.push(r.editor_session);}
 await sleep(3000);log('targets after open',(await targets()).length,'gpu',gpu());
 log('reopen',mcp('cad_open_file',{path:files[1]}));
 // 셋째 도면을 고쳐 저장 안 한 상태로 → 닫기 거부
 for(const t of await targets())if(String(await ev(t,`(window.cad?.drawings?.list?.()||[]).map(d=>d.name).join()`)).includes(path.basename(files[2],'.dxf')))
  log('edit',await ev(t,`(()=>{const d=window.cad.getDocument();window.cad.execute({type:'add',entity:{type:'line',points:[{x:0,y:0},{x:1000,y:0}],layer:d.layers[0].id}});return 'ok'})()`));
 await sleep(1000);
 log('close dirty',mcp('cad_close_document',{editor_session:sessions[2]}));
 for(const s of sessions.slice(0,2))log('close',mcp('cad_close_document',{editor_session:s}));
 await sleep(8000);log('targets after close',(await targets()).length,'gpu',gpu());
 log('read closed',mcp('cad_get_document',{editor_session:sessions[0]}));
 log('reopen closed',mcp('cad_open_file',{path:files[0]}).already_open);
 await sleep(2000);log('targets',(await targets()).length);
}catch(e){log('ERR',e.stack);}
try{process.kill(main.pid);}catch{}
execFileSync('powershell',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | ?{$_.CommandLine -like '*ud-mcp*'} | %{Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue}; Get-CimInstance Win32_Process -Filter "Name='python.exe'" | ?{$_.CommandLine -like '*server.py*' -and $_.CommandLine -like '*18765*'} | %{Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue}`]);
