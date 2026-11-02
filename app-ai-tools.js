// 앱 AI의 화면 전용 길. 실행할 수 있는 것은 CAD 명령 하나와 등록 LSP뿐이다.
import {read} from './lisp-native.js';
export const APP_AI_ACTIONS=new Set(['cad_ui_command','cad_lisp_save','cad_confirm_write']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FORBIDDEN=/^(?:SHELL|STARTAPP|PYTHON|EXEC|SYSTEM|DELETEFILE|FILEDELETE|UNLINK|RM|RMDIR|TRASH)$/i;
export function uiCommandName(value){
 if(typeof value!=='string'||!/^[A-Za-z0-9_?-]{1,100}$/.test(value)||FORBIDDEN.test(value.replace(/^[-_]+/,'')))throw Error('CAD 명령 이름 하나만 지정하세요. 파일 삭제·셸·외부 실행은 불가합니다.');
 return value.toUpperCase();
}
export function confirmAIWrite(context,label){
 return new Promise(resolve=>context.form('AI 파일 덮어쓰기 확인',[
  {name:'allow',label:label,value:'no',options:[['no','취소 · 기존 파일 유지'],['yes','확인 · 덮어쓰기']]}
 ],v=>resolve(v.allow==='yes'),()=>resolve(false)));
}
const base64=source=>{let s='';for(const byte of new TextEncoder().encode(source))s+=String.fromCharCode(byte);return btoa(s);};
export function createAppAIRequestHandler(context,binding,{api,confirm=label=>confirmAIWrite(context,label)}={}){
 const requests=new Map();
 return async request=>{
  const id=request?.id,target=request?.args?.target,args=request?.args||{},fingerprint=JSON.stringify(request);
  for(const [key,entry] of requests)if(entry.expires<=Date.now())requests.delete(key);
  if(requests.has(id)){
   const prior=requests.get(id);
   if(prior.fingerprint!==fingerprint)return {id,target,error:'Request identifier was reused with different content'};
   return structuredClone(await prior.pending);
  }
  if(requests.size>=512)return {id,target,error:'CAD request replay cache is full'};
  const pending=(async()=>{
   let savedPath=null;const epoch=args._app_epoch??context.getAIRequestEpoch?.();
   try{
    const assertCurrent=()=>{if(target!=null)binding.assert(target);else if(!['cad_ui_command','cad_lisp_save'].includes(request.action))throw Error('CAD target required');context.assertAIRequest?.(request);if(!Number.isSafeInteger(request.expires_at)||request.expires_at<=Date.now())throw Error('CAD request expired');if((!args._app_origin||args._app_origin===context.getBridgeSession?.())&&(context.isAIRequestCancelled?.()||context.getAIRequestEpoch?.()!==epoch))throw Error('요청을 중지했거나 다른 요청을 시작했습니다.');};
    if(!UUID.test(id||'')||!APP_AI_ACTIONS.has(request.action))throw Error('Invalid app CAD request');
    assertCurrent();
    await context.authorizeAIRequest?.(request);await api('chat',{action:'authorize'});assertCurrent();
    let result;
    if(request.action==='cad_ui_command'){
     const command=uiCommandName(args.command);
     result=await context.runAICommand(command,{assertCurrent,request,inputs:args.inputs||{},saveOptions:{...(!args._app_origin||args._app_origin===context.getBridgeSession?.()?{aiRequestEpoch:epoch}:{}),aiExpiresAt:request.expires_at,aiRequestId:id,aiRecipient:target?.editor_session||context.getBridgeSession?.()}});
    }else if(request.action==='cad_confirm_write'){
     const confirmed=await confirm(args.path+' 파일을 덮어쓸까요?');assertCurrent();
     await context.authorizeAIRequest?.(request);await api('chat',{action:'authorize'});assertCurrent();
     result={confirmed,target,before_revision:target.revision,after_revision:target.revision,revision:target.revision,applied:false};
    }else{
     if(typeof args.name!=='string'||args.name.length>100||!args.name.toLowerCase().endsWith('.lsp')||/[\\/:*?"<>|\x00-\x1f]/.test(args.name)||args.name.endsWith(' '))throw Error('경로 없는 .lsp 파일 이름이 필요합니다.');
     if(typeof args.source!=='string'||!args.source.trim()||new TextEncoder().encode(args.source).length>200000)throw Error('source는 200KB 이하 AutoLISP여야 합니다.');
     read(args.source); // 소스 구문만 읽는다. 등록 중에는 실행하지 않는다.
     const library=await api('lisp',{action:'status'});assertCurrent();
     const existing=args.id?(library.files||[]).find(f=>f.id===args.id):(library.files||[]).find(f=>f.name.toLowerCase()===args.name.toLowerCase());
     if(args.id&&!existing)throw Error('등록된 리습 ID가 아닙니다.');
     if(existing&&existing.name.toLowerCase()!==args.name.toLowerCase())throw Error('기존 리습은 같은 파일 이름으로 수정하세요.');
     let previous=null;
     if(existing){
      previous=(await api('lisp',{action:'read',id:existing.id})).source;assertCurrent();
      if(!await confirm(existing.name+' 사용자 리습을 덮어쓸까요?'))throw Error('덮어쓰기를 취소했습니다.');
      assertCurrent();
     }
     await api('chat',{action:'authorize'});assertCurrent();
     const encoded=base64(args.source);
     // 데스크톱 저장 대화상자가 실제 .lsp 경로와 파일 덮어쓰기를 확인한다.
     savedPath=await context.output(encoded,args.name,'text/plain','',{...(!args._app_origin||args._app_origin===context.getBridgeSession?.()?{aiRequestEpoch:epoch}:{}),aiExpiresAt:request.expires_at,aiRequestId:id,aiRecipient:target?.editor_session||context.getBridgeSession?.()});assertCurrent();
     if(savedPath===false)throw Error('리습 저장을 취소했습니다.');
     const registration=await api('lisp',existing?{action:'update',id:existing.id,source:args.source,expectedSource:previous,ai:true,aiRequestId:id,aiRecipient:target?.editor_session||context.getBridgeSession?.()}:{action:'upload',name:args.name,data:encoded,ai:true,aiRequestId:id,aiRecipient:target?.editor_session||context.getBridgeSession?.()});
     await context.refreshLispLibrary?.();
     result={saved:true,registered:true,path:savedPath||null,name:args.name,id:existing?.id||registration.file?.id,commands:registration.file?.commands};
    }
    return {id,target,result};
   }catch(error){return {id,target,error:(savedPath?'LSP 파일은 저장됐지만 등록을 완료하지 못했습니다: ':'')+String(error?.message||error)};}
  })();
  requests.set(id,{fingerprint,pending,expires:request?.expires_at||Date.now()});
  return structuredClone(await pending);
 };
}
