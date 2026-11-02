import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppAIRequestHandler,uiCommandName,confirmAIWrite} from './app-ai-tools.js';
const target={revision:3};
const request=(action,args={})=>({id:crypto.randomUUID(),action,args:{target,...args},expires_at:Date.now()+10000});
function setup({files=[],confirm=true}={}){
 const calls=[],context={runAICommand:async command=>(calls.push(['run',command]),{started:true,command,awaiting_user:true}),output:async(...args)=>(calls.push(['output',...args]),'C:/saved/tool.lsp'),refreshLispLibrary:async()=>calls.push(['refresh'])};
 const binding={assert:t=>assert.equal(t,target)};
 const api=async(route,data)=>{calls.push([route,data]);if(route==='lisp'&&data.action==='status')return {files};if(route==='lisp'&&data.action==='read')return {source:'(defun c:OLD () (princ))'};return {file:{id:'new',commands:['NEW']}};};
 return {calls,context,binding,api,handler:createAppAIRequestHandler(context,binding,{api,confirm:async label=>(calls.push(['confirm',label]),confirm)})};
}
test('native screen commands are forwarded as one command and reported as started',async()=>{
 for(const command of ['PLANSET','APPLOAD','WALDRAW','NEW','SAVE','SAVEAS','OPEN','PLOT','LAYER','DIMSTYLE']){
  const s=setup(),out=await s.handler(request('cad_ui_command',{command}));assert.equal(out.result.started,true);assert.equal(out.result.awaiting_user,true);assert.deepEqual(s.calls.find(c=>c[0]==='run'),['run',command]);
 }
});
test('expressions, scripts, shell, Python and file deletion names cannot be forwarded',()=>{
 for(const name of ['(command "ERASE")','LINE\nSHELL','SHELL','_SHELL','-PYTHON','STARTAPP','DELETEFILE','FILEDELETE','RM','UNLINK','../../x'])assert.throws(()=>uiCommandName(name));
 assert.equal(uiCommandName('planset'),'PLANSET');assert.equal(uiCommandName('PY'),'PY');
});
test('duplicate pending and completed requests run once',async()=>{
 const s=setup(),r=request('cad_ui_command',{command:'PLANSET'});const result=await Promise.all([s.handler(r),s.handler(r)]);assert.deepEqual(result[0],result[1]);await s.handler(r);assert.equal(s.calls.filter(c=>c[0]==='run').length,1);
 const mismatch=await s.handler({...r,args:{...r.args,command:'SAVE'}});assert.match(mismatch.error,/reused/);
});
test('expired or stale requests cannot execute',async()=>{
 const s=setup();assert.match((await s.handler({...request('cad_ui_command',{command:'NEW'}),expires_at:0})).error,/expired/);assert.equal(s.calls.length,0);
 const r=request('cad_ui_command',{command:'NEW'});r.args.target={revision:2};assert.ok((await s.handler(r)).error);assert.equal(s.calls.length,0);
});
test('logout authorization failure prevents a CAD action',async()=>{
 const s=setup(),handler=createAppAIRequestHandler(s.context,s.binding,{api:async()=>{throw Error('not_logged_in');}});assert.match((await handler(request('cad_ui_command',{command:'NEW'}))).error,/not_logged_in/);assert.equal(s.calls.length,0);
});
test('new LSP is exported as .lsp then registered through existing upload and refreshed',async()=>{
 const s=setup(),source='(defun c:NEW () (princ))',out=await s.handler(request('cad_lisp_save',{name:'도구.lsp',source}));assert.equal(out.result.registered,true);assert.equal(out.result.path,'C:/saved/tool.lsp');const saved=s.calls.find(c=>c[0]==='output');assert.equal(saved[2],'도구.lsp');assert.equal(new TextDecoder().decode(Uint8Array.from(atob(saved[1]),c=>c.charCodeAt(0))),source);const upload=s.calls.find(c=>c[1]?.action==='upload');assert.equal(upload[1].ai,true);assert.equal(s.calls.at(-1)[0],'refresh');
});
test('existing LSP overwrite needs screen confirmation and preserves previous-source guard',async()=>{
 const file={id:'old',name:'old.lsp'},s=setup({files:[file]}),source='(defun c:NEW () (princ))';const out=await s.handler(request('cad_lisp_save',{id:'old',name:'old.lsp',source}));assert.equal(out.result.id,'old');assert.equal(s.calls.filter(c=>c[0]==='confirm').length,1);const update=s.calls.find(c=>c[1]?.action==='update');assert.equal(update[1].expectedSource,'(defun c:OLD () (princ))');assert.equal(update[1].ai,true);
});
test('declining LSP overwrite makes no file or registration change',async()=>{
 const s=setup({files:[{id:'old',name:'old.lsp'}],confirm:false});assert.match((await s.handler(request('cad_lisp_save',{name:'old.lsp',source:'(princ)'}))).error,/취소/);assert.ok(!s.calls.some(c=>c[0]==='output'||['upload','update'].includes(c[1]?.action)));
});
test('invalid LSP name or syntax never saves',async()=>{
 for(const args of [{name:'../bad.lsp',source:'(princ)'},{name:'ok.lsp',source:'(defun'},{name:'a.py',source:'(princ)'}]){const s=setup();assert.ok((await s.handler(request('cad_lisp_save',args))).error);assert.ok(!s.calls.some(c=>c[0]==='output'));}
});
test('cancelled epoch while waiting for confirmation cannot save',async()=>{
 const s=setup({files:[{id:'old',name:'old.lsp'}]});let epoch=1;s.context.getAIRequestEpoch=()=>epoch;const handler=createAppAIRequestHandler(s.context,s.binding,{api:s.api,confirm:async()=>{epoch++;return true;}});assert.match((await handler(request('cad_lisp_save',{name:'old.lsp',source:'(princ)'}))).error,/중지/);assert.ok(!s.calls.some(c=>c[0]==='output'));
});
test('save dialog cancel cannot register a LSP',async()=>{
 const s=setup();s.context.output=async()=>{throw Error('취소');};assert.match((await s.handler(request('cad_lisp_save',{name:'new.lsp',source:'(princ)'}))).error,/취소/);assert.ok(!s.calls.some(c=>['upload','update'].includes(c[1]?.action)));
});
test('other-file overwrite confirmation returns bound read result',async()=>{
 const s=setup({confirm:false}),out=await s.handler(request('cad_confirm_write',{path:'C:/other.dxf'}));assert.equal(out.result.confirmed,false);assert.equal(out.result.applied,false);assert.equal(out.result.revision,3);
});
test('confirmation defaults to keep original and maps close to decline',async()=>{
 let callbacks;const pending=confirmAIWrite({form:(title,fields,ok,cancel)=>{assert.equal(fields[0].value,'no');callbacks={ok,cancel};}},'file');callbacks.cancel();assert.equal(await pending,false);
});

test('다른 창의 앱 요청은 대상 창의 대화 epoch와 충돌하지 않는다',async()=>{
 const s=setup();s.context.getBridgeSession=()=> 'target-window';s.context.getAIRequestEpoch=()=> 0;s.context.isAIRequestCancelled=()=>true;s.context.authorizeAIRequest=async()=>{};
 const out=await s.handler(request('cad_ui_command',{command:'PLANSET',_app_epoch:17,_app_origin:'origin-window'}));assert.equal(out.result.started,true);
});
test('다른 창 요청도 서버에서 취소되면 실행되지 않는다',async()=>{
 const s=setup();s.context.getBridgeSession=()=> 'target-window';s.context.authorizeAIRequest=async()=>{throw Error('AI 요청 중지');};
 const out=await s.handler(request('cad_ui_command',{command:'PLANSET',_app_epoch:17,_app_origin:'origin-window'}));assert.match(out.error,/중지/);assert.ok(!s.calls.some(c=>c[0]==='run'));
});

test('화면 명령은 도면 본문을 읽지 않는 경로도 지원한다',async()=>{
 const s=setup(),r=request('cad_ui_command',{command:'PLANSET'});r.args.target=null;const out=await s.handler(r);assert.equal(out.result.started,true);
});


test('앱 AI가 받은 출력 옵션을 화면 명령에 그대로 전달한다',async()=>{
 const s=setup(),inputs={form:{scope:'all',points:'no',deleteLayer:'A-TEXT'}};let received;
 s.context.runAICommand=async(_name,options)=>{received=options.inputs;return {started:true};};await s.handler(request('cad_ui_command',{command:'MSL',inputs}));assert.deepEqual(received,inputs);
});
