// 건축 요소 실행기 전용 Worker — 리습·AI 가 부른 카드 명령을 도면 사본에서 돌리고 결과 도면을 돌려준다.
// 한 번에 하나씩: 실행기가 실행 동안 타이머를 세므로 두 작업이 겹치면 서로의 타이머를 기다리게 된다.
import {commandJob} from './command-runner.js';
import {setImageTransport} from './image-underlay.js';
import {setScreenVaultSource} from './screen-vault.js';
import {setComputeTransport,ComputeError} from './compute-client.js';
let chain=Promise.resolve(),vaultWait=[],current=null,calls=0;const replies=new Map();
// 잠근 화면 코드(도면 생성기)는 화면 스레드가 엔진에서 받아 건넨다(이 Worker 는 화면 토큰이 없다).
setScreenVaultSource(()=>new Promise((resolve,reject)=>{vaultWait.push({resolve,reject});if(vaultWait.length===1)self.postMessage({vault:true});}));
// 서버 계산(평면 인식·벽 찾기 등)은 Worker 가 엔진 토큰을 못 받으므로 화면에 대신 보내 달라고 한다.
setComputeTransport((action,input)=>new Promise((resolve,reject)=>{const call=++calls;replies.set(call,{resolve,reject});self.postMessage({id:current,compute:{call,action,input}});}));
setImageTransport(input=>new Promise((resolve,reject)=>{const call=++calls;replies.set(call,{resolve,reject});self.postMessage({id:current,compute:{call,action:'image.read',input}});}));
self.onmessage=({data})=>{
 if(data?.vault){const waiting=vaultWait;vaultWait=[];for(const w of waiting)data.vault.error?w.reject(Object.assign(Error(data.vault.error),{code:'screen_locked'})):w.resolve(data.vault.bundle);return;}
 if(data?.computeReply){const {call,result,error}=data.computeReply,wait=replies.get(call);replies.delete(call);if(error)wait?.reject(new ComputeError(error.message,error.code));else wait?.resolve(result);return;}
 // 한 작업이 던지면(결과 복사 실패 등) chain 이 거절된 채로 남아 이 Worker 의 다음 작업이 영영 시작되지 않았다(AI 도면 생성이 600초 running).
 // 그 작업만 오류로 돌려주고 줄은 계속 간다.
 chain=chain.then(async()=>{current=data.id;self.postMessage({id:data.id,started:true});self.postMessage(await commandJob(data,{onProgress:data.progress?progress=>self.postMessage({id:data.id,progress}):undefined}));})
  .catch(error=>{try{self.postMessage({id:data.id,error:{name:'Error',message:error?.message||String(error),code:error?.code??null}});}catch{}});
};
