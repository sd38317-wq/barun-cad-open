// 작업 대기·조회 간격·전체 제한은 이 설정 한 곳에서 조정한다.
export const SITE_PLAN_JOB_TIMING = Object.freeze({pollMs:1500,timeoutMs:900000});
const cancelled=()=>Object.assign(Error('계획 생성을 취소했습니다. 서버 계산은 계속될 수 있습니다.'),{name:'AbortError'});
const abortable=(promise,signal)=>{
 if(signal?.aborted)return Promise.reject(cancelled());
 if(!signal)return promise;
 return new Promise((resolve,reject)=>{const stop=()=>reject(cancelled());signal.addEventListener('abort',stop,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));});
};
export async function generateSitePlan(request,api,{signal,onProgress=()=>{},onJob,onFallback=()=>{},timing=SITE_PLAN_JOB_TIMING,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const start=now();const check=()=>{if(signal?.aborted)throw cancelled();if(now()-start>=timing.timeoutMs)throw Error('계획 작업 대기 시간을 초과했습니다. 다시 시도하세요.');};
 const call=(route,body)=>{check();return abortable(api(route,body),signal);};
 let submitted=false;
 try{
  let job=await call('site-plan/jobs',{action:'submit',request});submitted=true;
  if(!/^[a-f0-9]{32}$/.test(job.job_id||''))throw Error('작업 접수 응답을 확인하세요.');
  const jobId=job.job_id;
  for(;;){
   check();
   if(job.status==='succeeded'){onJob?.({status:'succeeded',result:job.result,mock:!!(job.meta?.mock||job.result?.meta?.mock)});if(!job.result?.contract&&!job.result?.report)throw Error('계획 작업 결과가 없습니다.');return job.result;}
   if(job.status==='failed')throw Error(job.error||'계획 작업에 실패했습니다.');
   if(!['queued','running'].includes(job.status))throw Error('알 수 없는 계획 작업 상태입니다.');
   onJob?.({status:job.status,elapsedSeconds:Math.floor((now()-start)/1000),program:request.program,mock:!!job.meta?.mock});
   onProgress((job.status==='queued'?'계산 대기':'대지 계산 중')+' · '+Math.floor((now()-start)/1000)+'초');
   await abortable(sleep(timing.pollMs),signal);check();
   job=await call('site-plan/jobs',{action:'status',jobId});
  }
 }catch(error){
  if(error?.status!==404)throw error;
  // 접수부터 404 면 서버에 대기열이 없는 것(지금 운영 서버가 그렇다): 늘 같은 일이라 알리지 않는다. 진행 중 작업이 사라졌을 때만 알린다.
  check();if(submitted)onFallback('계획 작업을 서버에서 찾지 못해 바로 생성으로 전환합니다.');onProgress('동기 생성 중 · 취소하면 결과 수신을 중단합니다.');
  onJob?.({status:'sync',program:request.program});
  const result=await call('site-plan/generate',request);onJob?.({status:'succeeded',result,mock:!!result.meta?.mock});return result;
 }
}
