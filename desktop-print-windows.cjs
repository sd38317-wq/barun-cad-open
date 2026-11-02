'use strict';
const {spawn}=require('node:child_process');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {createInterface}=require('node:readline');

// Read through fs so the helper also works inside app.asar. No shell interpolation
// of printer names, no elevated rights, and no temporary plaintext script files.
function createPrinterSettings(printerName,timeoutMs=60000){
 const script=readFileSync(path.join(__dirname,'desktop-print-windows.ps1')).toString('base64');
 const bootstrap="[Console]::InputEncoding=New-Object Text.UTF8Encoding($false); & ([scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::ReadLine()))))";
 const child=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(bootstrap,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let pending,closed=false,failure,restorePromise,nextId=0;
 const fail=error=>{failure=error;if(pending){clearTimeout(pending.timer);pending.reject(error);pending=null;}};
 child.on('error',error=>fail(Error('프린터 설정 도우미 실행 실패: '+error.message)));
 child.on('exit',code=>{closed=true;fail(Error('프린터 설정 도우미가 종료됐습니다 ('+code+').'));});
 child.stdin.on('error',error=>fail(Error('프린터 설정 도우미 연결 실패: '+error.message)));
 // Drain stderr; protocol errors are returned as UTF-8 JSON on stdout.
 child.stderr.resume();
 createInterface({input:child.stdout}).on('line',line=>{
  let reply;try{reply=JSON.parse(line);}catch{return;}
  if(!pending||reply.id!==pending.id)return;
  const request=pending;pending=null;clearTimeout(request.timer);
  reply.ok?request.resolve(reply.data):request.reject(Error(reply.error||'프린터 설정 실패'));
 });
 function request(action,extra={}){
  if(closed||failure)return Promise.reject(failure||Error('프린터 설정 도우미 연결이 닫혔습니다.'));
  return new Promise((resolve,reject)=>{
   const id=++nextId;
   const timer=setTimeout(()=>{pending=null;reject(Error('프린터 설정 응답 시간이 초과됐습니다.'));},Math.max(timeoutMs,15000));
   pending={id,resolve,reject,timer};child.stdin.write(JSON.stringify({id,action,...extra})+'\n');
  });
 }
 child.stdin.write(script+'\n');
 return {
  open:()=>request('open',{printerName,parentPid:process.pid,idleMs:Math.max(timeoutMs*2,120000)}),
  set:(paper,orientation)=>request('set',{paper,orientation}),
  restore(){
   if(!restorePromise)restorePromise=(async()=>{
    // Keep the watchdog alive: never kill a process holding the original DEVMODE.
    try{await request('restore');}finally{child.stdin.end();}
   })();
   return restorePromise;
  }
 };
}
module.exports={createPrinterSettings};
