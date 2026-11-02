// Pure close decision controller, shared with regression tests.
class CloseController {
 // aborted: 닫기가 어떤 이유로든(취소·저장 창 취소·오류) 무산되면 한 번 불린다. 창 전체 닫기 상태를 풀어야 다음 X 가 먹는다.
 constructor({choose,save,retry,report,aborted=()=>{}}){Object.assign(this,{choose,save,retry,report,aborted});this.pending=false;this.allowed=false;}
 async blocked(event){
  if(this.allowed){event.preventDefault();this.allowed=false;return;}
  if(this.pending)return;
  this.pending=true;
  try{
   const choice=await this.choose();
   if(choice==='cancel')return;
   if(choice==='save'&&!(await this.save()))return;
   if(!['save','discard'].includes(choice))return;
   this.allowed=true;this.retry();
  }catch(error){this.allowed=false;this.report(error);}
  finally{this.pending=false;if(!this.allowed)this.aborted();}
 }
}

/* S10: 백엔드 stdout/stderr 를 회전 로그 파일에 남긴다(예전에는 stdio:'ignore' 로 버렸다). */
class RotatingLog {
 constructor({path:target,maxBytes=5*1024*1024,keep=3,fs=require('node:fs')}={}){this.path=target;this.maxBytes=maxBytes;this.keep=keep;this.fs=fs;this.size=0;try{this.fs.mkdirSync(require('node:path').dirname(target),{recursive:true});this.size=this.fs.statSync(target).size;}catch{}}
 rotate(){
  try{
   for(let index=this.keep-1;index>=1;index--){const from=this.path+'.'+index,to=this.path+'.'+(index+1);try{if(index+1>this.keep)this.fs.rmSync(from,{force:true});else this.fs.renameSync(from,to);}catch{}}
   try{this.fs.renameSync(this.path,this.path+'.1');}catch{}
  }catch{}
  this.size=0;
 }
 write(chunk){
  const text=typeof chunk==='string'?chunk:String(chunk);
  if(!text)return;
  try{
   const bytes=Buffer.byteLength(text,'utf8');
   if(this.size+bytes>this.maxBytes)this.rotate();
   this.fs.appendFileSync(this.path,text);this.size+=bytes;
  }catch{}
 }
 line(message){this.write(new Date().toISOString()+' '+message+'\n');}
}

/* S3: 엔진 감시자. 엔진 프로세스가 죽으면 제한 횟수 안에서 다시 띄우고 준비될 때까지 기다린 뒤 알린다.
   spawn()  → {pid, onExit(handler), exitCode, kill()} 를 돌려주는 함수
   waitReady() → 엔진이 준비되면 true (토큰은 엔진이 새로 만들며 화면이 /api/status 로 다시 받는다)
   notify(status) → 화면에 상태를 전달 {state:'starting'|'ready'|'restarting'|'failed', restarted, attempt, message} */
class EngineSupervisor {
 constructor({spawn,waitReady,notify=()=>{},log=()=>{},maxRestarts=3,windowMs=5*60*1000,restartDelayMs=1000,now=Date.now,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),setInterval:schedule=globalThis.setInterval,clearInterval:unschedule=globalThis.clearInterval}){
  Object.assign(this,{spawn,waitReady,notify,log,maxRestarts,windowMs,restartDelayMs,now,delay,schedule,unschedule});
  this.worker=null;this.stopped=false;this.restarts=[];this.restarting=null;this.generation=0;this.ready=false;this.starting=false;this.adoptedPid=null;this.watchTimer=null;
 }
 get pid(){return this.worker?.pid||this.adoptedPid||null;}
 async start(){
  const generation=++this.generation;
  this.stopped=false;this.ready=false;this.starting=true;this.adoptedPid=null;
  const worker=this.spawn();this.worker=worker;
  worker.onExit(code=>{if(this.worker===worker)this.handleExit(code,generation);});
  let ok=false;
  try{ok=await this.waitReady(worker);}finally{this.starting=false;}
  if(this.worker!==worker)return false;
  this.ready=ok;
  return ok;
 }
 /* 이미 떠 있던 엔진을 넘겨받는다. exit 이벤트가 없으므로 주기적으로 살아 있는지 물어보고, 사라지면 우리 엔진을 띄운다. */
 adopt({pid,probe,intervalMs=5000}){
  this.stopped=false;this.ready=true;this.adoptedPid=pid||null;this.worker=null;
  this.unwatch();
  this.watchTimer=this.schedule(async()=>{
   if(this.stopped||this.worker)return;
   let alive=false;
   try{alive=(await probe()).state==='engine';}catch{alive=false;}
   if(alive||this.stopped)return;
   this.unwatch();this.adoptedPid=null;this.log('adopted engine disappeared');
   await this.handleExit('adopted-lost',this.generation);
  },intervalMs);
  return this;
 }
 unwatch(){if(this.watchTimer!==null){this.unschedule(this.watchTimer);this.watchTimer=null;}}
 stop(){this.stopped=true;this.unwatch();const worker=this.worker;this.worker=null;this.ready=false;return worker;}
 async handleExit(code,generation){
  if(this.stopped||generation!==this.generation)return;
  if(this.starting)return;   // 첫 기동 실패는 start() 의 false 로 보고한다(재시작 알림과 겹치지 않게)
  this.ready=false;this.worker=null;
  const at=this.now();
  this.restarts=this.restarts.filter(time=>at-time<this.windowMs);
  this.log('engine exited code='+code+' restarts-in-window='+this.restarts.length);
  if(this.restarts.length>=this.maxRestarts){
   const message='로컬 도면 엔진이 '+this.maxRestarts+'번 연속으로 종료되어 자동 재시작을 멈췄습니다. 바른 CAD를 다시 실행하세요. 열려 있는 도면은 저장해 두세요.';
   this.notify({state:'failed',code,message});return false;
  }
  this.restarts.push(at);
  const attempt=this.restarts.length;
  this.notify({state:'restarting',code,attempt,message:'로컬 도면 엔진이 종료되어 다시 시작합니다 ('+attempt+'/'+this.maxRestarts+').'});
  this.restarting=(async()=>{
   await this.delay(this.restartDelayMs);
   if(this.stopped)return false;
   const ok=await this.start();
   if(ok)this.notify({state:'ready',restarted:true,attempt,message:'로컬 도면 엔진을 다시 시작했습니다. 진행 중이던 작업은 다시 실행하세요.'});
   else if(!this.stopped)this.notify({state:'failed',attempt,message:'로컬 도면 엔진을 다시 시작하지 못했습니다. 바른 CAD를 다시 실행하세요.'});
   return ok;
  })();
  return this.restarting;
 }
}
// 닫기 확인은 renderer의 beforeunload에 의존하지 않는다(WebContentsView도 같은 경로).
async function closeDocumentView(entry,{choose,save,remove,report,aborted=()=>{}}){
 if(entry.closing)return false;
 entry.closing=true;let closed=false;
 try{
  const contents=entry.view.webContents;
  if(contents&&!contents.isDestroyed()&&entry.state!=='crashed'){
   const choice=await choose();
   if(!['save','discard'].includes(choice))return false;
   if(choice==='save'&&!(await save()))return false;
  }
  remove(entry.id);closed=true;return true;
 }catch(error){report(error);return false;}
 finally{if(!closed){entry.closing=false;aborted();}}
}
module.exports={CloseController,RotatingLog,EngineSupervisor,closeDocumentView};
