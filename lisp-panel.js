import {Interpreter,read,write,unsupportedCalls,usedCommands,scanByFunction,supportedFunctions,Sym,LispError,InputError,isCowViolation} from './lisp-native.js';
import {createHost,SUPPORTED_COMMANDS} from './lisp-host.js';
import {userErrorMessage} from './user-error.js';
import {scriptedCommandNames,runOnCopy,NeedInput} from './command-runner.js';

// 동봉 건축 리습은 2026-10-27 뺐다(기본 건축 명령과 같은 일). 사용자 파일은 리습 관리 창(APPLOAD)에서 추가·삭제·순서·사용 여부·편집을 한다.
// 입력은 브라우저의 기본 입력 창으로 받지 않는다. Electron 은 그 창을 지원하지 않아 5.0.1~5.0.2 에서 모든 리습이 첫 질문에서 멈췄다.
// 대신 본체가 넘겨 준 ask(질문) 로 한 가지씩 묻는다.

/* ── 실행 준비·실행 (화면 없이 도는 부분 — 노드 시험이 같은 코드를 쓴다) ── */

// 예제 4개 원문(examples/바른캐드_리습예제.lsp 와 같은 내용). 화면에서는 쓰지 않고 리습 엔진 시험만 쓴다.
export const EXAMPLE_LISP_NAME='바른캐드_리습예제.lsp';
export const EXAMPLE_LISP=`; 바른캐드 실제 AutoLISP 예제 · 좌표 단위 mm
(defun BC:layer (name)
  (if (not (tblsearch "LAYER" name))
    (entmake (list '(0 . "LAYER") '(100 . "AcDbSymbolTableRecord") '(100 . "AcDbLayerTableRecord")
      (cons 2 name) '(70 . 0) '(62 . 7) '(420 . 16777215) '(6 . "CONTINUOUS") '(370 . 18))))
  name)
(defun c:BCIRCLE (/ p r)
  (setq p (getpoint "\\nCenter X,Y: ") r (getdist p "\\nRadius: "))
  (if (and p r (> r 0)) (entmakex (list '(0 . "CIRCLE") (cons 8 (BC:layer "A-SYM")) (cons 10 p) (cons 40 r)))) (princ))
(defun c:BBOX (/ p q)
  (setq p (getpoint "\\nFirst X,Y: ") q (getcorner p "\\nOpposite X,Y: "))
  (if (and p q) (progn (BC:layer "A-SYM") (command "_.RECTANG" p q) (command "_.CHPROP" (entlast) "" "_LA" "A-SYM" ""))) (princ))
(defun c:BNUMBER (/ ss i p n h e)
  (setq ss (ssget "_I") n (getint "\\nStart number: ") h (getdist "\\nText height: ") i 0)
  (if (and ss n h) (repeat (sslength ss)
    (setq e (entget (ssname ss i)) p (cdr (assoc 10 e)))
    (if p (progn (entmakex (list '(0 . "TEXT") (cons 8 (BC:layer "A-TEXT")) (cons 10 p) (cons 40 h) (cons 1 (itoa n)))) (setq n (1+ n))))
    (setq i (1+ i)))) (princ))
(defun c:BLENGTH (/ ss i total e a b)
  (setq ss (ssget "_X" '((0 . "LINE"))) i 0 total 0.0)
  (if ss (repeat (sslength ss) (setq e (entget (ssname ss i)) a (cdr (assoc 10 e)) b (cdr (assoc 11 e)) total (+ total (distance a b)) i (1+ i))))
  (princ (strcat "\\nTOTAL LENGTH mm = " (rtos total 2 3))) (princ))
`;

const COMPILED=/\.(fas|vlx)$/i;
export const COMPILED_NOTE='FAS·VLX 는 컴파일된 리습이라 바른 CAD 자체 엔진에서 실행할 수 없습니다. AutoCAD 가 설치된 PC에서만 실행됩니다.';
const parsed=new Map();   // 원문 → 읽은 결과. 질문마다 처음부터 다시 도는데 23개 파일을 매번 다시 읽지 않는다.
let knownFunctions=null;
const known=()=>knownFunctions||(knownFunctions=new Set(supportedFunctions()));

/** 파일 하나를 읽고, 불러올 때(최상위 식) 이 엔진이 못 하는 것이 있는지 본다. 한 파일의 잘못이 다른 파일을 막지 않는다. */
export function inspectFile(item){
 const name=String(item.name||'리습'),source=String(item.source??'');
 if(COMPILED.test(name))return {...item,name,forms:null,error:COMPILED_NOTE,commands:[]};
 let entry=parsed.get(source);
 if(!entry){
  try{const forms=read(source);entry={forms,scan:scanByFunction(forms)};}
  catch(error){entry={error:error?.message||String(error)};}
  if(parsed.size>200)parsed.clear();parsed.set(source,entry);
 }
 if(entry.error)return {...item,name,forms:null,error:`${name}: ${entry.error}`,commands:[]};
 const commands=[...entry.scan.owners.keys()].filter(k=>k.startsWith('C:')).map(k=>k.slice(2));
 return {...item,name,forms:entry.forms,scan:entry.scan,error:null,commands};
}

/** 읽지 못한 파일에도 그 명령 정의가 적혀 있는지(오류 안내를 정확히 하려고 글자로 찾는다). */
const definesCommand=(source,command)=>String(source||'').toUpperCase().replace(/\s+/g,' ').includes('(DEFUN C:'+String(command).toUpperCase()+' ');

/** 명령(또는 식) 하나를 이 엔진으로 돌릴 수 있는지, 어떤 파일을 불러올지 정한다. */
/** 리습 (command "D1" …) 로 부를 수 있는 바른 CAD 건축 요소 명령. AutoCAD 표준 이름(SUPPORTED_COMMANDS)이 먼저다. */
let bridgeNameSet=null;
export function bridgeCommandNames(){
 if(!bridgeNameSet)bridgeNameSet=new Set(scriptedCommandNames().filter(n=>!SUPPORTED_COMMANDS.has(n)));
 return bridgeNameSet;
}
const runnableCommand=name=>SUPPORTED_COMMANDS.has(name.replace(/^-/,''))||bridgeCommandNames().has(name.replace(/^[_.]+/,'').toUpperCase());
export function planRun(files,command){
 const warnings=[],usable=[];
 const defined=new Set(files.flatMap(f=>f.scan?[...f.scan.defined]:[]));
 for(const f of files){
  if(f.error){warnings.push(f.error);continue;}
  // 불러올 때 도는 최상위 식에 이 엔진이 모르는 함수나 명령이 있으면 그 파일만 건너뛴다.
  const top=[...f.scan.top.calls].filter(c=>!known().has(c)&&!defined.has(c)&&!c.startsWith('BR:'));
  const topCommands=[...f.scan.top.commands.keys()].filter(c=>!c.startsWith('(')&&!runnableCommand(c));
  if(top.length||topCommands.length){warnings.push(`${f.name}: 불러올 때 이 엔진이 모르는 ${[...top,...topCommands.map(c=>'(command "'+c+'")')].join(', ')} 을(를) 불러 이 파일은 건너뛰었습니다.`);continue;}
  usable.push(f);
 }
 const forms=usable.flatMap(f=>f.forms);
 const blockers=[];let owner=null;
 if(command){
  const key='C:'+String(command).toUpperCase();
  owner=usable.find(f=>f.scan.owners.has(key))||null;
  if(!owner){
   const skipped=files.find(f=>f.scan?.owners.has(key))||files.find(f=>f.error&&definesCommand(f.source,command));
   blockers.push(skipped?`${command} 명령이 든 ${skipped.name} 을(를) 불러올 수 없습니다(${skipped.error||'불러올 때 쓰는 함수를 이 엔진이 모릅니다'})`:`${command} 명령을 정의한 리습 파일이 없습니다`);
  }else{
   try{
    for(const item of unsupportedCalls(forms,command,{includeTop:false}))blockers.push(item.name);
    for(const item of usedCommands(forms,command,{includeTop:false}))if(!item.name.startsWith('(')&&!runnableCommand(item.name))blockers.push('command "'+item.name+'"');
   }catch(error){blockers.push('읽지 못한 문법: '+userErrorMessage(error));}
  }
 }
 return {files:usable,warnings,blockers:[...new Set(blockers)],owner,needsContext:command?needsRooms(usable,command):false};
}

/** ACAD200-819: 명령 하나를 돌릴 때 실제로 필요한 파일만 불러온다(AutoCAD autoload 를 자동으로).
    명령을 정의한 파일 + 그 명령에서 (따옴표·문자열로라도) 닿는 함수를 정의한 파일(꼬리 물기) + 불러올 때 무슨 일이든 하는
    파일(최상위에 defun 말고 다른 식이 있음 — acaddoc.lsp 역할). 식 실행이거나 정의를 못 찾으면 예전처럼 전부. */
export function lispFilesFor(files,command){
 if(!command||!Array.isArray(files))return files;
 const key='C:'+String(command).toUpperCase(),defs=new Map(),always=new Set();
 const isDefun=form=>Array.isArray(form)&&form[0] instanceof Sym&&/^DEFUN(-Q)?$/.test(form[0].key)&&form[1] instanceof Sym;
 for(const f of files){
  if(!Array.isArray(f?.forms)){always.add(f);continue;}
  for(const form of f.forms){
   if(isDefun(form)){const name=form[1].key;if(!defs.has(name))defs.set(name,[]);defs.get(name).push({file:f,body:form.slice(2)});}
   else always.add(f);
  }
 }
 if(!defs.has(key))return files;
 const needed=new Set(always),seen=new Set([key]),stack=[key];
 const reach=name=>{name=String(name).toUpperCase();if(defs.has(name)&&!seen.has(name)){seen.add(name);stack.push(name);}};
 const walk=v=>{
  if(v instanceof Sym){reach(v.key);return;}
  if(typeof v==='string'){for(const word of v.match(/[A-Za-z_:*][\w:*\-]*/g)||[])reach(word);return;}   // (eval (read "(helper)")) 같은 경우
  if(Array.isArray(v))for(const x of v)walk(x);
 };
 for(const f of always)for(const form of f.forms||[])if(!isDefun(form))walk(form);
 while(stack.length){for(const {file,body} of defs.get(stack.pop())){needed.add(file);walk(body);}}
 return files.filter(f=>needed.has(f));
}

/** 이 명령이 실 경계(br:rooms) 나 BOUNDARY 에 닿을 때만 파이썬 경계 계산을 부른다. 예전에는 모든 명령의 모든 질문마다 불렀다. */
function needsRooms(files,command){
 const defs=new Map();
 for(const f of files)for(const form of f.forms)if(Array.isArray(form)&&form[0] instanceof Sym&&/^DEFUN(-Q)?$/.test(form[0].key)&&form[1] instanceof Sym)defs.set(form[1].key,form);
 const seen=new Set(),stack=['C:'+String(command).toUpperCase()];let hit=false;
 const walk=v=>{
  if(hit)return;
  if(v instanceof Sym){if(v.key==='BR:ROOMS')hit=true;else if(defs.has(v.key)&&!seen.has(v.key)){seen.add(v.key);stack.push(v.key);}return;}
  if(typeof v==='string'){if(/^[_.-]*boundary$/i.test(v))hit=true;return;}
  if(Array.isArray(v))for(const x of v)walk(x);
 };
 while(stack.length&&!hit){const key=stack.pop();seen.add(key);const form=defs.get(key);if(form)walk(form.slice(3));}
 return hit;
}
export const expressionNeedsRooms=text=>/br:rooms|boundary/i.test(String(text||''));

const lispText=value=>JSON.stringify(String(value));
/** 실행마다 먼저 도는 준비 식: br:ok/br:fail, 원래 블록 이름, (필요할 때만) 실 경계, 미리 고른 선택(br:ss). */
export function preludeFor(document,context={},preselected=[]){
 const lines=['(setq br:ok T)','(defun br:fail (msg) (setq br:ok nil br:error msg) (princ msg))'];
 const blocks=document.entities.filter(entity=>entity.type==='block'&&entity.name);
 lines.push("(setq br:blocknames '("+blocks.map(entity=>'('+lispText(entity.id)+' . '+lispText(entity.name)+')').join(' ')+'))');
 if(context?.rooms)lines.push(context.rooms);
 if(preselected.length)lines.push('(setq br:ss (ssget "_I"))');
 return lines.join('\n');
}

/* 큰 도면(19만 객체, JSON 3억 글자)에서 리습은 질문 하나마다 처음부터 다시 돌고, 그때마다 도면 전체를 JSON.parse 했다(한 번 1.9초).
   이제 같은 실행(snapshotKey) 안에서는 원본을 한 번만 읽어 깊게 얼려 두고, 매번 목록만 얕게 복사해(copy-on-write) 쓴다.
   리습 호스트가 원본 객체를 제자리에서 고치려 하면 얼린 객체라 TypeError 가 나고(isCowViolation), 그때는 예전처럼 전체를 새로 읽어 다시 돈다.
   결과는 도면 전체 대신 '원본 몇 번째 객체 그대로 / 새 객체' 목록(delta)으로도 돌려준다. 화면은 바뀌지 않은 객체를 그대로 재사용한다. */
let pristineCache=null;
const deepFreeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const key in value)deepFreeze(value[key]);}return value;};
function pristineDocument(snapshot,key){
 const cacheKey=key??snapshot;
 if(pristineCache&&pristineCache.key===cacheKey)return pristineCache;
 pristineCache=null;
 const doc=JSON.parse(snapshot);
 for(const field of Object.keys(doc))deepFreeze(doc[field]);
 const index=new Map();doc.entities.forEach((entity,i)=>index.set(entity,i));
 pristineCache={key:cacheKey,doc,index};return pristineCache;
}
/** 실행이 끝나면 원본 사본을 놓는다(대형 도면은 수백 MB). */
export function releasePristine(){pristineCache=null;}
const workingCopy=doc=>({...doc,entities:doc.entities.slice(),layers:doc.layers.map(layer=>({...layer})),...(Array.isArray(doc.blocks)?{blocks:doc.blocks.slice()}:{})});
function cowChanges(document,pristine){
 const base=pristine.doc,fields={};let changed=false;
 const entitiesChanged=document.entities.length!==base.entities.length||document.entities.some((entity,i)=>entity!==base.entities[i]);
 const layersChanged=JSON.stringify(document.layers)!==JSON.stringify(base.layers);
 for(const key of new Set([...Object.keys(document),...Object.keys(base)])){
  if(key==='entities'||key==='layers')continue;
  const a=document[key],b=base[key];
  const same=Array.isArray(a)&&Array.isArray(b)&&key==='blocks'?a.length===b.length&&a.every((item,i)=>item===b[i]):a===b;
  if(!same){fields[key]=a;changed=true;}
 }
 changed||=entitiesChanged||layersChanged;
 return {changed,delta:changed?{entities:document.entities.map(entity=>pristine.index.get(entity)??entity),layers:document.layers,fields}:null};
}
/** delta 를 실행 전 도면(base: 스냅숏을 만든 바로 그 문서)에 입힌다. 번호는 base.entities 의 자리, 객체는 리습이 새로 만들거나 고친 것이다. */
export function applyLispDelta(base,delta){
 const entities=delta.entities.map(item=>typeof item==='number'?base.entities[item]:item);
 if(entities.some(entity=>!entity))throw Error('리습 결과를 도면에 맞추지 못했습니다. 다시 실행하세요.');
 return {...base,...delta.fields,layers:delta.layers,entities};
}

/** 이 스레드에서 돈 결과의 새 객체는 얼린 원본의 좌표 배열 등을 나눠 쓸 수 있다. 도면에 넣기 전에 새로 복사한다(바뀐 것만). */
function ownDelta(delta){return {entities:delta.entities.map(item=>typeof item==='number'?item:structuredClone(item)),layers:structuredClone(delta.layers),fields:structuredClone(delta.fields||{})};}

/** 한 번 실행한다. 입력이 모자라면 LispError(error.ask) 를 던진다 — runWithPrompts 가 물어서 다시 돈다. */
export function runNative(options){
 let pristine=null;
 // copyOnWrite:false 는 예전 방식(매번 전체 JSON.parse)을 강제한다 — 두 방식의 결과가 같은지 검사에서 비교한다.
 if(options.copyOnWrite!==false)try{pristine=pristineDocument(options.snapshot,options.snapshotKey);}catch(error){if(!(error instanceof SyntaxError))throw error;}
 if(pristine){
  try{return runOnDocument(options,workingCopy(pristine.doc),pristine);}
  catch(error){if(!isCowViolation(error))throw error;}
 }
 return runOnDocument(options,JSON.parse(options.snapshot),null);
}
function runOnDocument({files,command=null,expression=null,snapshot,inputs=[],preselected=[],activeLayer='0',context={},sources=[],timeLimitMs,idSeed=null,bridgeDone=null,strict=false,session=null},document,pristine){
 let interpreter=null;
 const host=createHost(document,{inputs,preselected,restricted:strict,vars:{CLAYER:activeLayer},regions:context?.regions||[],idSeed,
  bridge:bridgeDone?{names:bridgeCommandNames(),done:bridgeDone,calls:0}:null,
  recentOutput:()=>interpreter?interpreter.output.slice(-4).join(''):'',
  loadLisp:name=>{const want=String(name).replace(/\\/g,'/').split('/').pop().toLowerCase();const hit=sources.find(s=>{const n=String(s.name).toLowerCase();return n===want||n===want+'.lsp'||n.replace(/\.lsp$/,'')===want;});return hit?String(hit.source):null;}});
 interpreter=new Interpreter(host,{timeLimitMs});
 if(strict)for(const name of ['STARTAPP','VL-REGISTRY-READ','VL-REGISTRY-WRITE','VL-DIRECTORY-FILES']){
  interpreter.builtins[name]=()=>{throw new LispError('AI 리습에서 허용하지 않는 함수: '+name);};
 }
 if(session?.interpreter)interpreter.copyStateFrom(session.interpreter);
 const loaded=new Map(session?.loaded||[]);
 try{
 if(strict)interpreter.load('(setq br:ss nil br:rooms nil br:error nil)');
 interpreter.load(preludeFor(document,context,preselected));
 const warnings=[];
 host.setLoading(true);
 for(const f of files){
  if(session&&loaded.get(f.name)===f.source)continue;
  try{interpreter.loadForms(f.forms);interpreter.exited=false;loaded.set(f.name,f.source);}
  catch(error){
   if(strict)throw error;
   if(error?.ask)warnings.push(`${f.name}: 불러올 때 입력을 요구해 이 파일은 건너뛰었습니다.`);
   else if(error?.fatal||isCowViolation(error))throw error;
   else warnings.push(`${f.name}: 불러오는 중 오류로 일부 정의만 쓰입니다 — ${error?.message||error}`);
  }
 }
 host.setLoading(false);
 // AI 호출에서는 개별 로드 문구만 모으고, 사용자 리습의 나머지 출력은 보존한다.
 if(strict){const isLoad=s=>/^\n로드됨:[^\n]*$/.test(s),count=interpreter.output.filter(isLoad).length;if(count)interpreter.output=[...interpreter.output.filter(s=>!isLoad(s)),'\n로드됨: 리습 '+count+'개\n'];}
 if(command&&!interpreter.commands.has('C:'+String(command).toUpperCase())){
  const owner=files.find(f=>f.scan?.owners.has('C:'+String(command).toUpperCase()));
  const why=owner&&warnings.find(w=>w.startsWith(owner.name+':'));
  throw Error(`${command} 명령을 불러오지 못했습니다`+(why?` — ${why}`:'. 파일이 로드되었는지 확인하세요.'));
 }
 const mark=strict?0:interpreter.output.length;
 let value=null;
 if(command)interpreter.callCommand(command);else value=interpreter.evaluate(String(expression||''));
 host.finish();
 const output=interpreter.output.slice(mark).join('');
 const handled=interpreter.handledError;   // 리습의 *error* 가 받아 끝낸 오류 — AutoCAD 처럼 명령 끝으로 보고 결과를 적용한다
 if(strict&&handled)throw Error(handled);
 const stopped=interpreter.global.get('BR:OK')===null?String(interpreter.global.get('BR:ERROR')||'리습이 실행을 중단했습니다.'):(interpreter.exited&&command&&!handled?'리습이 실행을 중단했습니다.':'');
 if(stopped){const error=Error(stopped);error.output=output;throw error;}
 const notes=host.notes();if(handled)notes.unshift('리습의 *error* 처리기가 받았습니다: '+handled);
 const result={document,output,value:command?null:write(value),notes,warnings,exportRequest:host.exportRequest,files:host.outputFiles()};
 const outcome=pristine?{...result,...cowChanges(document,pristine)}:{...result,changed:JSON.stringify(document)!==snapshot};
 if(session){interpreter.host=null;session.interpreter=interpreter;session.loaded=loaded;}
 return outcome;
 }catch(error){if(strict&&error&&!error.output)error.output=interpreter.output.join('');throw error;}
}

/** 입력이 모자라면 ask 로 하나씩 묻고 처음부터 다시 돈다. 형식이 틀린 답(InputError)은 지우고 같은 질문을 다시 묻는다.
    runner 는 한 번 실행하는 함수다. 기본은 이 스레드의 runNative, 화면에서는 리습 전용 Worker 로 보낸다. */
/** 건축 요소 명령을 부르는 리습: 멈춘 자리마다 그 명령을 도면 사본에서 돌리고(비동기) 결과를 기억해 처음부터 다시 돈다.
    다시 돌 때 같은 객체가 같은 id 를 갖도록 실행 한 번에 씨앗(idSeed) 하나를 쓴다. 다리를 쓰지 않는 리습은 runNative 와 같다. */
export async function runNativeBridged(options,{runCard=runOnCopy,storage=options.cardStorage,limit=200}={}){
 const done=[],idSeed=options.idSeed||Array.from({length:20},()=>Math.floor(Math.random()*16).toString(16)).join('');
 for(;;){
  try{return runNative({...options,idSeed,bridgeDone:done});}
  catch(error){
   const call=error?.bridgeSuspend;if(!call)throw error;
   if(done.length>=limit)throw Error(`리습이 건축 요소 명령을 ${limit}번 넘게 불러 중지했습니다.`);
   const layer=error.document.layers.find(l=>l.name===call.clayer)||null;
   let r;
   try{r=await runCard(error.document,call.name,call.inputs,{activeLayer:layer?.id,storage:storage?{getItem:k=>Object.prototype.hasOwnProperty.call(storage,k)?storage[k]:null}:undefined});}
   catch(e){const failed=new LispError(`(command "${call.name}") 실행 실패: ${e instanceof NeedInput?`입력이 더 필요합니다 — ${e.prompt||e.what} (점·숫자·객체·(("키" . 값)) 를 넘기세요)`:e?.message||e}`);if(options.strict&&e instanceof NeedInput)failed.ask={what:e.what,prompt:e.prompt||e.what};if(options.strict)failed.output=error.output||'';throw failed;}
   const added=new Set(r.added),changed=new Set(r.changed);
   done.push({name:call.name,removed:r.removed,added:r.document.entities.filter(e=>added.has(e.id)),changed:r.document.entities.filter(e=>changed.has(e.id)),layers:r.document.layers});
  }
 }
}

export async function runWithPrompts(options,ask,runner=runNativeBridged){
 const inputs=[];let warning='';
 for(let attempt=0;attempt<400;attempt++){
  try{return await runner({...options,inputs:inputs.slice()});}
  catch(error){
   const message=error?.message||String(error);
   // 형식 오류만 되묻는다. (+ "a" 1) 같은 리습 자체의 오류는 답을 지우지 않는다(예전에는 '받은 값:' 글자만 보고 되물었다).
   if((error instanceof InputError||error?.retry)&&!error.ask&&inputs.length){inputs.pop();warning=message;continue;}
   if(!(error instanceof LispError||error?.lisp)||!error.ask)throw error;
   if(typeof ask!=='function')throw Error(message.replace(/\s*입력값 칸에 한 줄 더 적어 주세요\.?$/,'')+' · 이 화면에서는 리습 입력을 받을 수 없습니다.');
   const answer=await ask({what:error.ask.what||'값',prompt:error.ask.prompt||'',step:inputs.length+1,warning});warning='';
   if(answer===null||answer===undefined)throw Error('리습 실행을 취소했습니다.');inputs.push(String(answer));
  }
 }
 throw Error('리습 입력 단계가 너무 많아 실행을 중단했습니다.');
}

/** 실행 결과를 한 줄로: 리습이 princ 로 알린 마지막 내용(LEN 합계, BLKCNT 집계 등)을 보여 준다. */
export function outputSummary(output,limit=240){
 const lines=String(output||'').split('\n').map(s=>s.trim()).filter(s=>s&&!/^로드됨:/.test(s));
 const text=lines.join(' · ');
 return text.length>limit?'…'+text.slice(-limit):text;
}

/* ── 화면 ─────────────────────────────────────────────────── */

export function installLisp(studio,{engine,selected,activeLayer,apply,ask,pickPoint}){
 let files=[],available=false,running=false,lastRun=null;const warned=new Set();
 const sourceCache=new Map();
 const picker=document.createElement('input');picker.type='file';picker.multiple=true;picker.accept='.lsp,.fas,.vlx,.dcl';picker.hidden=true;picker.setAttribute('aria-label','사용자 리습 추가');document.body.append(picker);
 const notify=(message,error=false)=>studio.context.toast?.(message,error);
 const refresh=async()=>{const state=await studio.api('lisp',{action:'status'});files=state.files||[];available=!!state.available;renderManager();return state;};
 const enabled=()=>files.filter(file=>!file.disabled);

 async function addFiles(){
  try{
   let compiled=0;
   for(const file of picker.files||[]){if(file.size>5000000)throw Error(file.name+' · 5MB 이하 파일을 추가하세요.');await studio.api('lisp',{action:'upload',name:file.name,data:await studio.b64(file)});if(COMPILED.test(file.name))compiled++;}
   await refresh();const count=files.filter(file=>!file.bundled).length;notify(`사용자 리습 등록 완료 · ${count}개 자동 불러오기`+(compiled?' · '+COMPILED_NOTE:''));
  }catch(error){notify(userErrorMessage(error),true);try{await refresh();}catch{}}
  finally{picker.value='';}
 }
 picker.addEventListener('change',addFiles);
 const addUserLisp=()=>picker.click();

 async function readSource(file){
  const key=file.id+':'+file.size;
  if(!sourceCache.has(key))sourceCache.set(key,(await studio.api('lisp',{action:'read',id:file.id})).source);
  return sourceCache.get(key);
 }
 async function sources(){
  const result=[];
  for(const file of enabled())if(/\.lsp$/i.test(file.name))result.push({id:file.id,name:file.name,source:await readSource(file)});   // FAS·VLX 는 자체 엔진이 읽지 못한다(관리 창에 안내)
  return result;
 }
 const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

 /* ── 리습 전용 Worker ──
    엔진을 화면 스레드 밖에서 돌려 오래 걸리는 리습이 화면을 멈추지 않게 한다. 실행 중에는 '중지' 버튼을 띄우고,
    누르면 worker.terminate() 로 바로 끊는다(질문마다 처음부터 다시 돌기 때문에 중간 상태가 남지 않는다).
    Worker 를 만들 수 없는 환경(파일이 없음·보안 정책)에서는 이 스레드에서 20초 한도로 돈다. */
 let worker=null,workerReady=null,workerBroken=false,workerFailures=0,pendingRun=null,indicator=null,indicatorTimer=0;
 const WORKER_LIMIT_MS=60000,INLINE_LIMIT_MS=20000;
 function dropWorker(){try{worker?.terminate();}catch{}worker=null;workerReady=null;}
 // 업데이트 뒤 예전 lisp-worker.js 가 캐시에서 나오지 않도록 app.js 와 같은 판 표시(?v=…)를 붙인다.
 const versionQuery=()=>{try{const script=[...document.scripts].find(s=>/\/app\.js(\?|$)/.test(s.src));return script?new URL(script.src).search:'';}catch{return '';}};
 // 시작에 실패하면 한 번 더 해 본다(첫 실행은 파일을 처음 읽느라 느릴 수 있다). 두 번 실패하면 이 화면에서 돌리고 한 번 알린다.
 function workerFailed(){workerFailures++;dropWorker();if(workerFailures>=2&&!workerBroken){workerBroken=true;notify('리습 전용 실행기를 시작하지 못해 이 화면에서 실행합니다(최대 20초, 실행 중 중지 버튼 없음). 프로그램을 다시 시작하면 다시 시도합니다.',true);}}
 function ensureWorker(){
  if(workerBroken||typeof Worker!=='function')return null;
  if(worker)return workerReady;
  try{worker=new Worker(new URL('./lisp-worker.js'+versionQuery(),import.meta.url),{type:'module'});}catch{workerFailed();worker=null;return null;}
  workerReady=new Promise(resolve=>{
   const timer=setTimeout(()=>{workerFailed();resolve(false);},10000);
   worker.onmessage=({data})=>{
    if(data?.ready){clearTimeout(timer);workerFailures=0;resolve(true);return;}
    const run=pendingRun;pendingRun=null;if(!run)return;
    if(data.error){
     const e=data.error,error=e.retry?new InputError(e.message):e.lisp?new LispError(e.message):Error(e.message);
     if(e.ask)error.ask=e.ask;if(e.output)error.output=e.output;if(e.retry)error.retry=true;error.lisp=e.lisp;run.reject(error);
    }else run.resolve(data.result);
   };
   worker.onerror=event=>{
    event?.preventDefault?.();clearTimeout(timer);
    const run=pendingRun;pendingRun=null;
    if(run){run.reject(Error('리습 실행 중 내부 오류가 났습니다. 다시 실행하세요.'));dropWorker();}else workerFailed();
    resolve(false);
   };
  });
  return workerReady;
 }
 function showRunning(label){
  clearTimeout(indicatorTimer);
  indicatorTimer=setTimeout(()=>{
   if(!indicator){
    indicator=document.createElement('div');indicator.className='lisp-running';indicator.setAttribute('role','status');
    const text=document.createElement('span'),stop=document.createElement('button');stop.type='button';stop.textContent='중지';stop.onclick=cancelRun;
    indicator.append(text,stop);document.body.append(indicator);
   }
   indicator.firstChild.textContent=label+' 리습 실행 중…';indicator.hidden=false;
  },600);
 }
 function hideRunning(){clearTimeout(indicatorTimer);if(indicator)indicator.hidden=true;}
 function cancelRun(){const run=pendingRun;pendingRun=null;dropWorker();hideRunning();run?.reject(Error('리습 실행을 중지했습니다.'));}
 /** 한 번 실행: Worker 가 있으면 그쪽에서, 없으면 이 스레드에서. */
 async function runOnce(options,label){
  const ready=await ensureWorker();
  // 리습이 부르는 건축 요소 명령(문·창 카드 등)이 사용자가 저장한 카드 설정을 쓰도록 저장소 사본을 함께 넘긴다.
  const cardStorage={};try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(/^(barun|card)/.test(k))cardStorage[k]=localStorage.getItem(k);}}catch{}
  if(!ready)return runNativeBridged({...options,cardStorage,timeLimitMs:INLINE_LIMIT_MS});
  const {files,...message}=options;   // 읽어 둔 식(files)은 넘길 수 없다. Worker 가 원문(items)에서 다시 읽는다(캐시함).
  showRunning(label);
  try{return await new Promise((resolve,reject)=>{pendingRun={resolve,reject};worker.postMessage({...message,cardStorage,items:options.sources,timeLimitMs:WORKER_LIMIT_MS});});}
  finally{hideRunning();}
 }
 async function runInAutoCAD(command,expression,snapshot){
  const started=await studio.api('lisp',{action:'start',files:enabled().map(file=>file.id),command:command||'',expression:expression||'',inputs:'',selected:[...selected()],activeLayer:activeLayer(),document:JSON.parse(snapshot)});
  for(;;){await wait(350);const state=await studio.api('lisp',{action:'poll',id:started.id});if(state.state==='running')continue;if(state.state!=='completed')throw Error(state.error||'리습 실행에 실패했습니다.');if(!state.result?.document)throw Error(state.result?.note||'리습 결과를 도면에 적용할 수 없습니다.');return {document:state.result.document,changed:!!state.result.canApply,output:'',notes:[],warnings:[],files:{}};}
 }
 async function contextFor(document){
  try{return await studio.api('lisp',{action:'context',document});}catch{return {};}
 }
 async function saveDxf(document,name){
  const result=await studio.api('export',{document});
  await studio.context.output(result.data,(String(name||'').split(/[\\/]/).pop().replace(/\.dxf$/i,'')||'리습결과')+'.dxf','application/dxf');
 }
 const encode=text=>{const bytes=new TextEncoder().encode(text);let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);};

 /** 명령 또는 식 하나를 실행한다. 식은 명령창의 (+ 1 2) 같은 것이다. */
 async function execute(target){
  const text=String(target||'').trim();if(!text||running)return;
  const expression=text.startsWith('(')?text:null,command=expression?null:text.toUpperCase();
  const label=command||expression;
  // 도면은 실행을 시작할 때의 문서(startDoc)로 고정한다. 엔진은 바뀔 때마다 새 문서 객체를 쓰므로 같은 객체인지로 '실행 중 변경'을 안다.
  running=true;style();const startDoc=engine.doc,layersAtStart=JSON.stringify(startDoc.layers),snapshot=JSON.stringify(startDoc),snapshotKey=`${Date.now()}-${Math.random()}`;
  try{
   await refresh();
   const items=await sources(),inspected=items.map(inspectFile),plan=planRun(inspected,command);
   if(expression){try{read(expression);}catch(error){throw Error('식을 읽지 못했습니다: '+error.message);}}
   let result;
   if(!plan.blockers.length){
    // 화면 스레드에서 도면 전체를 JSON.parse 하지 않는다(19만 객체면 2초 멈춤). 읽기만 하므로 startDoc 을 그대로 쓴다.
    const needs=command?plan.needsContext:expressionNeedsRooms(expression);
    const context=needs?await contextFor(startDoc):{};   // 한 번 실행에 한 번만 계산한다(질문마다 다시 하지 않는다)
    const layerName=(startDoc.layers.find(layer=>layer.id===activeLayer())||{}).name||'0';
    result=await runWithPrompts({files:lispFilesFor(plan.files,command),command,expression,snapshot,snapshotKey,preselected:[...selected()],activeLayer:layerName,context,sources:items},
     question=>ask({command:label,...question,pickPoint}),options=>runOnce(options,label));
   }
   else if(available)result=await runInAutoCAD(command,expression,snapshot);
   else throw Error(plan.blockers.join(', ')+' · 이 PC에는 AutoCAD 실행 엔진이 없습니다.');
   if(engine.doc!==startDoc||JSON.stringify(engine.doc.layers)!==layersAtStart)throw Error('실행 중 도면이 변경되어 결과를 적용하지 않았습니다.');
   // 바뀐 것만 돌려받았으면 실행 전 도면에 입힌다. 바뀌지 않은 객체는 같은 객체라 화면 색인·되돌리기 이력을 다시 만들지 않는다.
   if('delta' in result)result={...result,document:result.delta?applyLispDelta(startDoc,ownDelta(result.delta)):startDoc};
   lastRun={label,at:new Date(),document:result.document,...result,planWarnings:plan.warnings};
   /* DXFOUT2 처럼 "[결과 DXF 저장]"을 말하는 리습은 아래에서 바로 저장 창을 연다. 2026-10-06(봇 점검): 알림이 "실행 후 [결과 DXF 저장]을
      누르세요"로 남아 저장이 안 된 것처럼 보였다 — 자동 저장할 때는 알림 문구를 실제 동작(저장 위치 고르기)으로 바꾼다. */
   const autoExport=result.exportRequest!==undefined||/\[결과 DXF 저장\]/.test(result.output||'');
   const said=autoExport?outputSummary(String(result.output||'').replace(/실행 후 \[결과 DXF 저장\]을 누르세요\.?/g,'저장할 위치를 고르세요.')):outputSummary(result.output),parts=[];
   if(expression)parts.push(`${expression} = ${result.value??'nil'}`);
   if(said&&!expression)parts.push(said);else if(said)parts.push('출력: '+said);
   parts.push(...(result.notes||[]));
   // 바뀐 것이 없으면 도면에 적용하지 않는다. 되돌리기 기록도 남기지 않는다.
   if(result.changed){apply(result.document);notify([label+' 실행 완료 · Ctrl+Z로 되돌릴 수 있습니다.',...parts].join(' · '));}
   else notify([label+(expression?'':' 실행 완료 · 도면 변경 없음'),...parts].filter(Boolean).join(' · '));
   const warnings=[...plan.warnings,...(result.warnings||[])];
   const fresh=[...new Set(warnings)].filter(w=>!warned.has(w));fresh.forEach(w=>warned.add(w));
   if(fresh.length)notify('불러오지 못한 리습 파일이 있습니다 — '+fresh.slice(0,3).join(' / ')+' · 나머지 명령은 그대로 쓸 수 있습니다.',true);
   if(autoExport)await saveDxf(result.document,result.exportRequest||engine.doc.name||'리습결과');
   const written=Object.keys(result.files||{});
   if(written.length)notify(`리습이 만든 파일 ${written.length}개(${written.slice(0,3).join(', ')})는 보안상 디스크에 바로 쓰지 않았습니다. 리습 관리(APPLOAD)의 '최근 실행' 에서 저장하세요.`);
   renderManager();
  }catch(error){
   const said=outputSummary(error?.output);
   notify(userErrorMessage(error)+(said&&!userErrorMessage(error).includes(said)?' · '+said:''),true);
  }finally{running=false;releasePristine();try{worker?.postMessage({release:true});}catch{}}
 }

 /* ── 리습 관리 창 ── */
 let dialog=null,editing=null;
 function style(){
  if(document.getElementById('lisp-manager-style'))return;
  const s=document.createElement('style');s.id='lisp-manager-style';
  s.textContent='.lisp-manager{width:min(760px,94vw);max-height:88vh;overflow:auto}.lisp-manager h2{margin:0 0 8px}.lisp-manager .lm-actions,.lisp-manager .lm-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.lisp-manager .lm-row{border-bottom:1px solid #8884;padding:6px 0}.lisp-manager .lm-name{flex:1 1 220px;min-width:0;overflow-wrap:anywhere}.lisp-manager .lm-note{font-size:12px;opacity:.8}.lisp-manager textarea{width:100%;min-height:320px;font-family:Consolas,monospace;font-size:12px}.lisp-manager pre{white-space:pre-wrap;max-height:180px;overflow:auto;font-size:12px;border:1px solid #8884;padding:6px}.lisp-manager .lm-off{opacity:.55}.lisp-running{position:fixed;right:16px;bottom:56px;z-index:9999;display:flex;gap:8px;align-items:center;padding:8px 12px;border-radius:6px;background:#222c;color:#fff;font-size:13px}.lisp-running[hidden]{display:none}';
  document.head.append(s);
 }
 const button=(text,onclick,title='')=>{const b=document.createElement('button');b.type='button';b.textContent=text;if(title)b.title=title;b.onclick=async()=>{try{await onclick(b);}catch(error){notify(userErrorMessage(error),true);}};return b;};
 const el=(tag,text='',cls='')=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
 async function move(file,step){
  const ids=files.map(f=>f.id),at=ids.indexOf(file.id),to=at+step;
  if(at<0||to<0||to>=ids.length)return;
  [ids[at],ids[to]]=[ids[to],ids[at]];await studio.api('lisp',{action:'reorder',ids});await refresh();
 }
 async function toggle(list,on){for(const file of list)await studio.api('lisp',{action:'toggle',id:file.id,enabled:on});await refresh();}
 function renderManager(){
  if(!dialog?.open)return;
  const body=dialog.querySelector('.lm-body');body.replaceChildren();
  if(editing){
   const {file,source}=editing,area=el('textarea');area.value=source;area.spellcheck=false;area.setAttribute('aria-label',file.name+' 원문');
   const actions=el('div','','lm-actions');
   body.append(el('h3',file.name+' 편집'),el('p','저장하면 바로 전 내용은 같은 폴더에 .previous 로 한 벌 보관됩니다.','lm-note'),area,actions);
   actions.append(button('저장',async()=>{try{read(area.value);}catch(error){throw Error('저장하지 않았습니다 · '+error.message);}await studio.api('lisp',{action:'update',id:file.id,source:area.value});editing=null;sourceCache.clear();await refresh();notify(file.name+' 저장 완료 · 이전 내용은 백업했습니다.');}),button('취소',()=>{editing=null;renderManager();}));
   area.focus();return;
  }
  const mine=files.filter(f=>!f.bundled);
  const top=el('div','','lm-actions');
  top.append(button('파일 추가',addUserLisp,'LSP · FAS · VLX · DCL'));
  body.append(top);
  body.append(el('h3',`사용자 리습 ${mine.length}개`));
  if(!mine.length)body.append(el('p','등록한 사용자 리습이 없습니다. [파일 추가]로 LSP 를 넣으세요. 건축 요소는 기본 건축 명령(WALDRAW·D1·W1 등)으로 그립니다.','lm-note'));
  for(const file of mine){
   const row=el('div','','lm-row'+(file.disabled?' lm-off':'')),name=el('div','','lm-name');
   name.append(el('strong',file.name),el('div',(file.commands||[]).length?'명령: '+file.commands.join(', '):COMPILED.test(file.name)?COMPILED_NOTE:/\.dcl$/i.test(file.name)?'대화상자 정의(DCL) — 자체 엔진은 대화상자를 띄우지 않습니다.':'정의된 명령 없음','lm-note'));
   row.append(name,el('span',file.disabled?'꺼짐':'사용 중','lm-note'),
    button('▲',()=>move(file,-1),'위로'),button('▼',()=>move(file,1),'아래로'),
    button(file.disabled?'켜기':'끄기',()=>toggle([file],!!file.disabled)));
   if(/\.lsp$/i.test(file.name))row.append(button('편집',async()=>{editing={file,source:await readSource(file)};renderManager();}));
   row.append(button('삭제',async b=>{if(b.dataset.confirm!=='1'){b.dataset.confirm='1';b.textContent='삭제 확인';setTimeout(()=>{b.dataset.confirm='';b.textContent='삭제';},4000);return;}await studio.api('lisp',{action:'remove',id:file.id});sourceCache.clear();await refresh();notify(file.name+' 등록을 지웠습니다.');},'두 번 누르면 지웁니다'));
   body.append(row);
  }
  const run=el('div','','lm-actions'),input=el('input');input.placeholder='(+ 1 2) 처럼 리습 식을 적고 계산';input.setAttribute('aria-label','리습 식');input.style.flex='1';
  input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();execute(input.value);}};
  run.append(input,button('계산',()=>execute(input.value)));
  body.append(el('h3','리습 식 실행'),run);
  if(lastRun){
   body.append(el('h3',`최근 실행 · ${lastRun.label}`));
   const text=[lastRun.value!=null?'값: '+lastRun.value:'',String(lastRun.output||'').trim(),...(lastRun.notes||[]),...(lastRun.planWarnings||[]),...(lastRun.warnings||[])].filter(Boolean).join('\n');
   body.append(el('pre',text||'출력 없음'));
   const acts=el('div','','lm-actions');
   acts.append(button('결과 DXF 저장',()=>saveDxf(lastRun.document,lastRun.label)));
   for(const [name,content] of Object.entries(lastRun.files||{}))acts.append(button('파일 저장: '+name,()=>studio.context.output(encode(content),String(name).split(/[\\/]/).pop()||'리습출력.txt','text/plain')));
   body.append(acts);
  }
 }
 async function openManager(){
  style();
  if(!dialog){
   dialog=el('dialog','','lisp-manager');dialog.setAttribute('aria-label','리습 관리');
   const head=el('h2','리습 관리'),body=el('div','','lm-body'),foot=el('div','','lm-actions');
   foot.append(button('닫기',()=>dialog.close()));
   dialog.append(head,body,foot);document.body.append(dialog);
   dialog.addEventListener('close',()=>{editing=null;});
  }
  if(!dialog.open)dialog.showModal();
  renderManager();
  try{await refresh();}catch(error){notify(userErrorMessage(error),true);}
 }

 studio.handlers.APPLOAD=openManager;
 studio.lisp={refresh:async()=>{sourceCache.clear();return refresh();},open:options=>options?.command?execute(options.command):openManager(),evaluate:text=>execute(text),addFiles:addUserLisp,manage:openManager,
  hasCommand:name=>enabled().some(file=>(file.commands||[]).includes(String(name||'').toUpperCase())),
  isExpression:text=>/^\(.*\)$/s.test(String(text||'').trim()),
  list:()=>enabled().flatMap(file=>(file.commands||[]).map(command=>({command:String(command).toUpperCase(),file:file.name,bundled:!!file.bundled})))};
 refresh().catch(()=>{});
 return studio.lisp;
}
