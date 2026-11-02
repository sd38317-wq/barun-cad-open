// Progress travels beside the original request. Its payload and response stay unchanged.
export function xhrResponse(url,options,{xhrFactory=()=>new XMLHttpRequest(),onUpload=()=>{}}={}){
 return new Promise((resolve,reject)=>{
  const xhr=xhrFactory();let settled=false;
  const cleanup=()=>options.signal?.removeEventListener('abort',abort);
  const fail=error=>{if(settled)return;settled=true;cleanup();reject(error);};
  const abort=()=>{xhr.abort();fail(Object.assign(Error('요청을 중지했습니다.'),{name:'AbortError'}));};
  if(options.signal?.aborted){abort();return;}
  xhr.open('POST',url);for(const [key,value] of Object.entries(options.headers||{}))xhr.setRequestHeader(key,value);
  xhr.upload.onprogress=e=>{try{onUpload(e.loaded,e.lengthComputable?e.total:null);}catch{}};
  xhr.onerror=()=>fail(new TypeError('로컬 엔진 연결이 끊겼습니다.'));
  xhr.onabort=()=>fail(Object.assign(Error('요청을 중지했습니다.'),{name:'AbortError'}));
  xhr.onload=()=>{if(settled)return;settled=true;cleanup();const body=xhr.responseText;resolve({ok:xhr.status>=200&&xhr.status<300,status:xhr.status,headers:{get:name=>xhr.getResponseHeader(name)},json:async()=>JSON.parse(body)});};
  options.signal?.addEventListener('abort',abort,{once:true});xhr.send(options.body);
 });
}

export function createOutputObservers({begin,xhrFactory,pollMs=500}={}){
 const pending=[];
 const consume=data=>{const index=pending.findIndex(entry=>entry.data===data);if(index<0)return null;const [entry]=pending.splice(index,1);clearTimeout(entry.timer);return entry.wait;};
 const observe=(route,data)=>{
  if(!begin||data?.dryRun||!['export','pdf','convert-file'].includes(route))return null;
  let wait;try{wait=begin({kind:route,format:data?.format||'dxf',objects:data?.document?.entities?.length||0});}catch{return null;}
  if(!wait)return null;
  let jobId=null,stopped=false,timer=0,pollController=null,lastSnapshot=null;
  const safely=fn=>{try{fn();}catch{}};
  const stop=()=>{stopped=true;clearTimeout(timer);pollController?.abort();};
  async function send(url,options,fetchImpl){
   const status=async(body,signal=options.signal)=>{const response=await fetchImpl('/api/output-jobs',{method:'POST',headers:{'Content-Type':'application/json','X-CAD-Token':options.headers['X-CAD-Token']},body:JSON.stringify(body),signal});if(!response.ok)throw Error('진행 상태를 확인하지 못했습니다.');return response.json();};
   // A missing observer route never prevents the existing save/print request.
   const registration=new AbortController(),deadline=setTimeout(()=>registration.abort(),1000);
   const abortRegistration=()=>registration.abort();options.signal?.addEventListener('abort',abortRegistration,{once:true});
   try{const created=await status({action:'create',kind:route},registration.signal);if(/^[a-f0-9]{32}$/.test(created.job_id||''))jobId=created.job_id;}catch{}
   finally{clearTimeout(deadline);options.signal?.removeEventListener('abort',abortRegistration);}
   const read=async()=>{if(!jobId||stopped)return;try{
    pollController=new AbortController();const deadline=setTimeout(()=>pollController.abort(),3000);
    let snapshot;try{const response=await fetchImpl('/api/output-jobs',{method:'POST',headers:{'Content-Type':'application/json','X-CAD-Token':options.headers['X-CAD-Token']},body:JSON.stringify({action:'status',jobId}),signal:pollController.signal});if(response.ok)snapshot=await response.json();}finally{clearTimeout(deadline);pollController=null;}
    if(snapshot&&!stopped){lastSnapshot=snapshot;safely(()=>wait.progress(snapshot));}
   }catch{}finally{if(!stopped)timer=setTimeout(read,pollMs);}};
   const headers={...options.headers,...(jobId?{'X-CAD-Output-Job':jobId}:{})};
   if(jobId)timer=setTimeout(read,pollMs);
   try{
    const response=typeof XMLHttpRequest==='function'||xhrFactory?await xhrResponse(url,{...options,headers},{xhrFactory,onUpload:(loaded,total)=>wait.upload(loaded,total)}):await fetchImpl(url,{...options,headers});
    return response;
   }finally{stop();}
  }
  return {
   send,
   received(result){stop();if(result._outputProgress){safely(()=>wait.progress(result._outputProgress));delete result._outputProgress;}if(result.path||!result.data){safely(()=>wait.finish(result.path));return;}safely(()=>wait.ready());const entry={data:result.data,wait,timer:0};entry.timer=setTimeout(()=>{const index=pending.indexOf(entry);if(index>=0){pending.splice(index,1);safely(()=>wait.destroy());}},30_000);pending.push(entry);while(pending.length>8){const old=pending.shift();clearTimeout(old.timer);safely(()=>old.wait.destroy());}},
   fail(error){stop();safely(()=>wait.fail(error));}
  };
 };
 return {observe,consume};
}
