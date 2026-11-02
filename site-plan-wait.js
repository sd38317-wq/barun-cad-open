
export const SITE_WAIT_PHASES = ['① 법규 검토','② 대지 분석','③ 건축가능영역','④ 목표·주차','⑤ 후보 탐색','⑥ 선택','⑦ 결과'].map((label,i)=>({key:String(i+1),label}));
const STYLE_ID='site-plan-wait-style';
const cancelled=()=>Object.assign(Error('계획 생성을 취소했습니다. 서버 계산은 계속될 수 있습니다.'),{name:'AbortError'});
export function sitePlanWaitEnabled(doc=globalThis.document){try{return doc?.defaultView?.localStorage?.getItem('barun.aiDrawReveal')!=='0';}catch{return true;}}
export function appendLoadRevealDelta(before,after){
 const oldIds=new Set(before.map(e=>e.id)),nextIds=new Set(after.map(e=>e.id));
 return {added:after.filter(e=>!oldIds.has(e.id)),removed:before.filter(e=>!nextIds.has(e.id))};
}
export function siteWaitFacts(request){
 const s=request.site||{},z=request.zoning||{},p=request.program||{},ps=s.parcel||[],o=ps[0]||[0,0];
 const area=Math.abs(ps.reduce((a,v,i)=>{const q=ps[(i+1)%ps.length];return a+(v[0]-o[0])*(q[1]-o[1])-(q[0]-o[0])*(v[1]-o[1]);},0))/2;
 const value=(n,unit)=>Number.isFinite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:1})+unit:'미확인';
 return [
  ['① 법규 검토',(z.zone||'용도지역 미확인')+' · 건폐율 '+value(z.bcr,'%')+' · 용적률 '+value(z.far,'%')],
  ['② 대지 분석',value(area,'㎡')+' · 경계 '+ps.length+'점 · 인접 필지 '+(s.neighbors?.length||0)+'개'],
  ['③ 건축가능영역','확정 영역은 엔진 결과 대기'+(Number.isFinite(z.bcr)?' · 입력 건폐율 기준 면적 상한 '+value(area*z.bcr/100,'㎡'):'')],
  ['④ 목표·주차',(p.use||'용도 미확인')+' · '+(p.floors_search?'층수 탐색':value(p.floors,'층'))+' · 목표 '+value(p.target_gfa,'㎡')+' · 주차 '+(Number.isFinite(p.parking?.count)?p.parking.count+'대':'엔진 산정 대기')]
 ];
}
function style(doc){
 if(doc.getElementById(STYLE_ID))return;
 const sheet=doc.createElement('style');sheet.id=STYLE_ID;
 sheet.textContent=`html body #site-plan-wait{position:fixed;zoom:1!important;width:var(--site-wait-width)!important;height:var(--site-wait-height)!important;margin:0!important;padding:0!important;max-width:none!important;max-height:none!important;border:0!important;border-radius:0!important;background:#161a21!important;overflow:hidden;color:#e8eef5}#site-plan-wait::backdrop{background:transparent;backdrop-filter:none}#site-plan-wait iframe{display:block;width:100%;height:100%;border:0}#site-plan-wait .site-plan-wait__cancel{position:absolute;right:12px;top:8px;z-index:2;padding:7px 12px;color:#e8eef5;background:#222c3a;border:1px solid #637d8b;cursor:pointer}`;
 doc.head.append(sheet);
}
export function mountSitePlanWait(host,request,{onCancel=()=>{},now=Date.now}={}){
 const doc=host.ownerDocument,win=doc.defaultView;style(doc);
 const el=doc.createElement('dialog');el.id='site-plan-wait';el.className='site-plan-wait';el.setAttribute('aria-label','배치 생성 기다림');
 const frame=doc.createElement('iframe');frame.title='소규모 배치 · 실제 입력과 예시 기록';
 const cancel=doc.createElement('button');cancel.className='site-plan-wait__cancel';cancel.type='button';cancel.textContent='생성 취소';cancel.onclick=onCancel;
 el.append(frame,cancel);host.append(el);
 const origin=win.location.origin;let destroyed=false,ready=false,visible=true,activeRequest=request,event={status:'submitting'},result=null,resultPlanIndex=null;
 const started=now();
 const send=(cmd,value)=>{if(ready&&!destroyed)frame.contentWindow?.postMessage({target:'barun-wait',cmd,value},origin);};
 const publish=()=>send('update',{request:activeRequest,job:{status:event.status,planIndex:event.planIndex,planTotal:event.planTotal,mock:event.mock},result,resultPlanIndex,elapsedSeconds:Math.max(0,Math.floor((now()-started)/1000))});
 const visibility=()=>send(doc.hidden||!visible?'pause':'resume');
 const message=e=>{if(e.source!==frame.contentWindow||e.origin!==origin||e.data?.source!=='barun-wait'||e.data?.kind!=='site'||e.data?.event!=='ready')return;ready=true;publish();visibility();};
 const layout=()=>{if(destroyed)return;const b=host.getBoundingClientRect();Object.assign(el.style,{left:b.left+'px',top:b.top+'px',width:b.width+'px',height:b.height+'px'});el.style.setProperty('--site-wait-width',b.width+'px');el.style.setProperty('--site-wait-height',b.height+'px');};
 const resize=typeof win.ResizeObserver==='function'?new win.ResizeObserver(layout):null;
 const intersection=typeof win.IntersectionObserver==='function'?new win.IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting!==false;visibility();}):null;
 const release=()=>{resize?.disconnect();intersection?.disconnect();win.removeEventListener('resize',layout);win.removeEventListener('message',message);doc.removeEventListener('visibilitychange',visibility);};
 el.addEventListener('cancel',e=>{e.preventDefault();onCancel();});
 win.addEventListener('message',message);win.addEventListener('resize',layout);doc.addEventListener('visibilitychange',visibility);resize?.observe(host);intersection?.observe(el);
 try{layout();el.showModal();frame.src=new URL('./wait-screens/site.html?embed=1',import.meta.url).href;}catch(error){release();el.remove();throw error;}
 return {element:el,update(next){if(destroyed)return;if(next.program)activeRequest={...request,program:next.program};event={...event,...next};if(next.result){result=next.result;resultPlanIndex=event.planIndex??null;}publish();},destroy(){if(destroyed)return;send('pause');destroyed=true;release();el.close();el.remove();}};
}
// Caller options and old string progress callbacks remain compatible. No drawing scan,
// timer or DOM is created when disabled, headless, or no viewport is installed.
export async function withSitePlanWait(studio,request,options,run){
 const controller=new AbortController(),signal=controller.signal,outer=options.signal;
 const stop=()=>controller.abort();outer?.addEventListener('abort',stop,{once:true});if(outer?.aborted)stop();
 let stage;
 try{
  if(signal.aborted)throw cancelled();
  const doc=globalThis.document,enabled=sitePlanWaitEnabled(doc);
  const host=enabled&&doc?.querySelector('.viewport');if(host){try{stage=mountSitePlanWait(host,request,{onCancel:stop});}catch{/* Optional presentation must never prevent a real calculation. */}}
  const onJob=stage?event=>{try{stage?.update(event);}catch{stage?.destroy();stage=undefined;}options.onJob?.(event);}:options.onJob;
  const work=run({...options,signal,onJob});
  return await new Promise((resolve,reject)=>{const abort=()=>reject(cancelled());signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();Promise.resolve(work).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
 }finally{stage?.destroy();outer?.removeEventListener('abort',stop);}
}
export function revealSitePlan(context,apply){
 context.beginAIReveal?.({appendLoad:true});
 try{return apply();}finally{context.endAIReveal?.({fit:true});}
}
