// All asynchronous AI paths reauthorize at the last boundary before a synchronous engine change.
export async function commitAIChange(context,request,assertCurrent,apply){
 if(typeof context.authorizeAIRequest!=='function')throw Error('AI 적용 권한을 확인할 수 없습니다.');
 await context.authorizeAIRequest(request);
 context.assertAIRequest?.(request);assertCurrent?.();
 const before=context.captureAIChange?.();
 context.beginAIReveal?.(); let r;
 try{r=apply();}
 finally{context.endAIReveal?.();}
 // Keep AI edits visible after the reveal/commit boundary.  The host decides
 // whether the user is idle and which bounds represent the committed result.
 const result=await r;
 context.followAIChange?.({before,after:context.captureAIChange?.(),aiCommit:true});
 return result;
}
