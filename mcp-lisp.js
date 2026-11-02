// AI 리습은 기존 리습 Worker와 엔진으로만 실행한다. 도면에 적용한 뒤 세션 정의를 확정한다.
import {commitAIChange} from './ai-commit.js';
import {inspectFile,planRun,applyLispDelta,bridgeCommandNames} from './lisp-panel.js';
import {resolveAILayer,ARCHITECTURE_TOOL_GUIDE,aiLayerWarnings} from './ai-layer-policy.js';

export const LISP_ACTIONS=new Set(['cad_lisp_run','cad_lisp_load']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const commandName=value=>{
 const name=String(value??'').replace(/^c:/i,'').trim().toUpperCase();
 if(!name||name.length>100||/[\s()\[\]"';\\]/.test(name))throw Error('실행할 리습 명령 이름(command)이 필요합니다.');
 return name;
};
const inputText=value=>{
 if(Array.isArray(value)&&value.length>=2&&value.length<=3&&value.every(Number.isFinite))return value.join(',');
 if(typeof value==='string'&&value.length<=4000)return value;
 if(typeof value==='number'&&Number.isFinite(value))return String(value);
 throw Error('inputs는 문자열·유한 숫자·좌표 [x,y] 또는 [x,y,z]의 순서 있는 배열입니다.');
};
const ARCHITECTURE_COMMANDS={WALL2:'WALDRAW',직선이중벽:'WALDRAW',PWALL:'WALDRAW',꺾인벽:'WALDRAW',DOOR2:'D1',리습문:'D1',WIND:'W1',리습창:'W1',COL2:'COL',기둥:'COL'};
const architectureGuideNeeded=command=>bridgeCommandNames().has(ARCHITECTURE_COMMANDS[command]);

/** Worker 한 개는 현재 도면 세션 하나만 가진다. 제한 시간이 지나면 실제 Worker를 종료한다. */
export function createLispWorkerClient({makeWorker=()=>new Worker(new URL('./lisp-worker.js'+new URL(import.meta.url).search,import.meta.url),{type:'module'})}={}){
 let worker=null,pending=null;
 const reset=()=>{worker?.terminate();worker=null;};
 return {
  reset,
  run(data){
   if(pending)return Promise.reject(Error('리습이 실행 중입니다.'));
   return new Promise((resolve,reject)=>{
    const fail=error=>{clearTimeout(pending?.timer);pending=null;reset();error.sessionReset=true;reject(error);};
    const timer=setTimeout(()=>fail(Object.assign(Error('리습 실행 시간이 초과되어 중지했습니다. 세션 리습을 다시 불러오세요.'),{code:'lisp_timeout'})),data.timeLimitMs+1500);
    pending={timer};
    try{
     const send=()=>worker.postMessage({...data,mcp:true});
     const fresh=!worker;
     if(fresh)worker=makeWorker();
     worker.onerror=event=>fail(Error(event?.message||'리습 실행기를 시작하지 못했습니다.'));
     worker.onmessage=({data:reply})=>{
      if(reply?.ready){send();return;}
      if(reply?.id!==data.id)return;
      clearTimeout(timer);pending=null;resolve(reply);
     };
     if(!fresh)send();
    }catch(error){fail(error);}
   });
  },
  commit(id){worker?.postMessage({mcpCommit:id});},
  discard(){worker?.postMessage({mcpDiscard:true});}
 };
}

export function createLispRequestHandler(context,binding,{api,runner=createLispWorkerClient()}={}){
 const {engine,execute,selected,refresh}=context,completed=new Map();
 let generation=null,sources=new Map(),busy=false;
 const current=()=>binding.current().revision;
 return async request=>{
  const id=request?.id,args=request?.args||{},target=args.target,fingerprint=JSON.stringify(request);
  const failure=(error,code='lisp_error')=>({id,target,error:String(error?.message||error),error_data:{
   code:error?.code||code,error:String(error?.message||error),output:error?.output||'',ask:error?.ask||null,
   created:0,added:0,removed:0,before_revision:target?.revision??null,after_revision:current(),revision:current(),applied:false,
   ...(error?.sessionReset?{session_reset:true}:{})
  }});
  for(const [key,entry] of completed)if(entry.expiresAt<=Date.now())completed.delete(key);
  if(completed.has(id)){
   const previous=completed.get(id);
   return previous.fingerprint===fingerprint?structuredClone(previous.response):failure(Error('Request identifier was reused with different content'));
  }
  if(busy)return failure(Error('리습이 실행 중입니다.'),'lisp_busy');
  if(completed.size>=512)return failure(Error('CAD request replay cache is full; wait before submitting another request'));
  busy=true;
  let response;
  try{
   const assertCurrent=()=>{binding.assert(target);context.assertAIRequest?.(request);if(request.expires_at<=Date.now())throw Error('CAD request expired');};
   if(!UUID.test(id||'')||!Number.isSafeInteger(request.expires_at))throw Error('CAD request is invalid or expired');
   assertCurrent();
   if(!LISP_ACTIONS.has(request.action))throw Error('지원하지 않는 리습 도구입니다.');
   if(args.expectedRevision!==target.revision)throw Error('expectedRevision은 target revision과 같아야 합니다.');
   if(generation!==target.document_generation){runner.reset();sources=new Map();generation=target.document_generation;}
   const snapshot=engine.doc,preselected=args.selection??[...(selected?.()||[])],entityIds=new Set(snapshot.entities.map(e=>e.id));
   if(!Array.isArray(preselected)||preselected.some(id=>typeof id!=='string'||!entityIds.has(id)))throw Error('selection에 없는 객체 ID가 있습니다.');
   const rawInputs=args.inputs??[];
   if(!Array.isArray(rawInputs)||rawInputs.length>1000)throw Error('inputs는 1000개 이하의 배열이어야 합니다.');
   const inputs=rawInputs.map(inputText),timeLimitMs=args.timeout_ms??5000;
   if(!Number.isInteger(timeLimitMs)||timeLimitMs<100||timeLimitMs>10000)throw Error('timeout_ms는 100~10000 정수입니다.');
   const command=request.action==='cad_lisp_run'?commandName(args.command):args.command===undefined?null:commandName(args.command);
   const staged=new Map(sources);
   let loadName=null;
   if(request.action==='cad_lisp_load'){
    if(typeof args.source!=='string'||!args.source.trim()||new TextEncoder().encode(args.source).length>200000)throw Error('source는 200KB 이하 AutoLISP 소스 문자열이어야 합니다.');
    loadName=args.name??'ai-'+id+'.lsp';
    if(typeof loadName!=='string'||!loadName.toLowerCase().endsWith('.lsp')||loadName.length>100||/[\\/:*?"<>|\x00-\x1f]/.test(loadName))throw Error('name은 경로 없는 .lsp 파일 이름이어야 합니다.');
    if(!staged.has(loadName)&&staged.size>=32)throw Error('세션 리습은 32개까지 불러올 수 있습니다.');
    staged.set(loadName,{name:loadName,source:args.source});
    if([...staged.values()].reduce((n,s)=>n+new TextEncoder().encode(s.source).length,0)>1000000)throw Error('세션 리습 소스가 너무 큽니다.');
   }
   const library=(await api('lisp',{action:'status'})).files||[];
   const registered=await Promise.all(library.filter(f=>!f.disabled&&/\.lsp$/i.test(f.name)).map(async f=>({...f,...await api('lisp',{action:'read',id:f.id})})));
   const items=[...registered.filter(f=>!staged.has(f.name)),...staged.values()],plan=planRun(items.map(inspectFile),command);
   const lispContext=plan.needsContext?await api('lisp',{action:'context',document:snapshot}):{};
   assertCurrent();
   const requestedLayer=resolveAILayer(snapshot,args);
   const layer=requestedLayer?.name||(snapshot.layers.find(l=>l.id===context.getActiveLayer?.())||snapshot.layers[0]||{}).name||'0';
   const runSnapshot=requestedLayer&&!snapshot.layers.some(l=>l.id===requestedLayer.id)?{...snapshot,layers:[...snapshot.layers,requestedLayer]}:snapshot;
   const reply=await runner.run({id,items,command,loadName,snapshot:JSON.stringify(runSnapshot),snapshotKey:id,inputs,preselected,activeLayer:layer,context:lispContext,timeLimitMs});
   if(reply.error){
    const raw=reply.error,message=raw.ask?'입력 필요: '+(raw.ask.prompt||raw.ask.what):raw.message;
    throw Object.assign(Error(message),{output:raw.output,ask:raw.ask,code:raw.ask?'input_required':'lisp_error',original:raw.message});
   }
   await context.authorizeAIRequest?.(request);assertCurrent();
   if(engine.doc!==snapshot)throw Error('리습 실행 중 도면이 바뀌어 적용하지 않았습니다. 도면을 다시 읽으세요.');
   const result=reply.result;
   if(!result)throw Error('리습 실행 결과가 없습니다.');
   if(result.exportRequest!==undefined||Object.keys(result.files||{}).length)throw Error('AI 리습은 파일을 내보내거나 저장할 수 없습니다.');
   const document='delta' in result?(result.delta?applyLispDelta(runSnapshot,structuredClone(result.delta)):runSnapshot):result.document;
   engine.validate(document);
   const oldIds=new Set(snapshot.entities.map(e=>e.id)),added=document.entities.filter(e=>!oldIds.has(e.id)).map(e=>e.id);
   const newIds=new Set(document.entities.map(e=>e.id)),removed=snapshot.entities.filter(e=>!newIds.has(e.id)).length;
   // assert와 execute 사이에는 await가 없다. 적용 뒤에만 Worker의 정의/전역 변수도 확정한다.
   await commitAIChange(context,request,()=>{assertCurrent();if(engine.doc!==snapshot)throw Error('리습 실행 중 도면이 바뀌었습니다.');},()=>{
    if(result.changed||runSnapshot!==snapshot)execute({type:'lisp.apply',document});
    sources=staged;runner.commit(id);
   });
   const revision=current();
   response={id,target,result:{command,loaded:loadName,commands:loadName?inspectFile(staged.get(loadName)).commands:undefined,created:added.length,added:added.length,entity_ids:added,removed,
    output:result.output||'',warnings:[...(result.warnings||[]),...aiLayerWarnings(document,document.entities.filter(e=>!oldIds.has(e.id))),...(added.length&&architectureGuideNeeded(command)?[ARCHITECTURE_TOOL_GUIDE]:[])],notes:result.notes||[],before_revision:target.revision,after_revision:revision,revision,applied:true,target}};
   try{refresh?.();}catch{}
  }catch(error){
   runner.discard();
   if(error.sessionReset)sources=new Map();
   response=failure(error);
   if(error.original)response.error_data.original_error=error.original;
  }finally{busy=false;}
  completed.set(id,{fingerprint,response:structuredClone(response),expiresAt:request?.expires_at||Date.now()});
  return response;
 };
}
