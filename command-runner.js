import {standardLayerForName} from './layer-standards.js';
// 화면 없는 건축 요소 실행기. 리습 (command "D1" …) 과 AI(MCP)가 메뉴의 카드 명령을 그대로 부른다.
// 카드 코드는 고치지 않는다: 카드가 화면에 묻던 입력(점·경로·객체·숫자·폼·카드 창)을 이 문맥이 미리 받은 값으로 대신 준다.
// 입력이 모자라면 NeedInput 을 던진다(무엇이 더 필요한지 알려 주고, 도면은 바꾸지 않는다).
import {DrawingEngine} from './engine.js';
import {installCardCommands} from './card-registry.js';
import {loadCardState,normalizeValues} from './card-kit.js';
import {applyDimStyle,getDimStyle} from './dimension-style.js';
import {lockedImport,screenVaultBundle} from './screen-vault.js';

export class NeedInput extends Error{
 constructor(what,prompt,detail={}){super(`입력이 더 필요합니다: ${prompt||what}`);this.name='NeedInput';this.what=what;this.prompt=prompt||'';Object.assign(this,detail);}
}
export class CommandFailed extends Error{constructor(message,detail={}){super(message);this.name='CommandFailed';Object.assign(this,detail);}}

const promptText=v=>typeof v==='string'?v:typeof v?.prompt==='string'?v.prompt:'';
const point=p=>{
 if(Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite))return {x:p[0],y:p[1]};
 if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y))return {x:p.x,y:p.y};
 throw new CommandFailed('점은 {x,y} 또는 [x,y] 입니다.');
};
/** 저장소 사본: 사용자의 카드 프리셋은 읽되, 실행 중 저장은 원래 저장소에 쓰지 않는다. */
function sandboxStorage(source){
 const map=new Map();
 return {getItem:k=>map.has(k)?map.get(k):(()=>{try{return source?.getItem?.(k)??null;}catch{return null;}})(),setItem:(k,v)=>{map.set(k,String(v));},removeItem:k=>{map.set(k,null);},
  /** 이번 실행에서 바뀐 값(null = 지움): 화면이 이어서 저장소에 쓴다(followUps.storage). */
  writes:()=>Object.fromEntries(map)};
}

/**
 * inputs = {
 *  form: {키:값} 또는 [{…},{…}]   폼·카드 창 값(차례대로 쓴다)
 *  points: [{x,y}|[x,y]|null …]   점 찍기(차례대로). null = Esc/Enter(여러 점 찍기를 마침)
 *  paths: [[점…] | {points,closed} …]  경로 찍기. 없으면 points 에서 필요한 개수만큼 꺼낸다
 *  entities: [id|null …]            객체 고르기(차례대로). null = Esc(여러 개 고르기를 마침)
 *  numbers: [n …]                   숫자 묻기(없으면 기본값)
 *  selection: [id …]                실행 전 선택
 *  slot, method, shared             카드 창의 칸 번호·방식·공통 값
 * }
 */
export function scriptedContext(engine,inputs={},{activeLayer,storage,drawingKnowledge,regenerateDrawingSet,clipboardText}={}){
 const supplied=inputs,used=new Set(),warnings=[];
 if(supplied.slot!==undefined&&!Number.isInteger(supplied.slot))throw new CommandFailed('slot 은 정수여야 합니다.');
 inputs=new Proxy(inputs,{get:(source,key)=>{used.add(key);return source[key];}});
 const warnFields=(values,keys,prefix)=>{for(const key of Object.keys(values||{}))if(!keys.includes(key))warnings.push('사용하지 않은 입력: '+prefix+'.'+key);};
 const formQ=Array.isArray(inputs.form)?[...inputs.form]:inputs.form?[inputs.form]:[];
 const pointQ=[...(inputs.points||[])],pathQ=[...(inputs.paths||[])],entityQ=[...(inputs.entities||[])],numberQ=[...(inputs.numbers||[])];
 let selection=new Set(supplied.selection||[]);
 let layer=activeLayer&&engine.doc.layers.some(l=>l.id===activeLayer)?activeLayer:engine.doc.layers.find(l=>l.visible!==false&&!l.locked)?.id||engine.doc.layers[0]?.id;
 const pending=new Set(),errors=[],messages=[],requests=[],needs=[];
 const need=(what,prompt,detail)=>{const e=new NeedInput(what,prompt,detail);needs.push(e);return e;};
 // 폼·카드 처리 중 오류: 화면에서는 폼이 열린 채 고쳐 주기를 기다리지만, 여기서는 고칠 사람이 없으니 실행을 끝낸다(aborted).
 let abort;const aborted=new Promise((_,reject)=>{abort=reject;});aborted.catch(()=>{});
 const track=p=>{const q=Promise.resolve(p).catch(e=>{errors.push(e);abort(e);});pending.add(q);q.finally(()=>pending.delete(q));return q;};
 const ask=(what,prompt,detail)=>{requests.push({what,prompt,...detail});};
 const box=storage===undefined?sandboxStorage(null):sandboxStorage(storage);
 const followUps={downloads:[],clipboard:null,clipboardIn:clipboardText,run:[]};
 const ensureLayer=(name,color)=>{const f=engine.doc.layers.find(l=>l.name===name);if(f)return f.id;engine.execute({...(standardLayerForName(name)||{}),type:'layer.add',name,color:standardLayerForName(name)?.color||color||'#ffd479'});return engine.doc.layers.find(l=>l.name===name).id;};
 const scripted={
  inputs,
  requireText:(prompt,value)=>{if(typeof value!=='string'||!value.trim())throw need('file',prompt);return value;},
  remainingPoints:()=>pointQ.length,
  remainingForms:()=>formQ.length,
  hasPathInput:()=>pathQ.length>0||pointQ.length>0,
  hasEntityInput:()=>entityQ.length>0,
  cardDialog(cfg){
   const {title,storageKey,fields,sharedFields=[],slots,fixedNames=[],slotDefaults,methods,onGo}=cfg;
   const state=loadCardState(box,storageKey,{fields,sharedFields,slots,fixedNames,slotDefaults});
   if(Number.isInteger(cfg.select))state.selected=Math.min(slots-1,Math.max(0,cfg.select));
   if(Number.isInteger(inputs.slot))state.selected=Math.min(slots-1,Math.max(0,inputs.slot));
   const given=formQ.length?formQ.shift():{};warnFields(given,['name',...fields.map(f=>f.key)],'form');warnFields(inputs.shared,sharedFields.map(f=>f.key),'shared');
   ask('card',title,{fields:fields.map(f=>({key:f.key,label:f.label,type:f.type,def:state.presets[state.selected][f.key],options:f.options?.map(o=>o[0])})),sharedFields:sharedFields.map(f=>({key:f.key,label:f.label,type:f.type,def:f.def})),methods:methods?.options?.map(o=>o[0])||null});
   const values=normalizeValues(fields,{...state.presets[state.selected],...given},state.presets[state.selected].name);
   const shared=normalizeValues(sharedFields,{...state.shared,...(inputs.shared||{})});delete shared.name;
   const method=methods?(inputs.method||state.shared.__method||methods.def):null;
   if(methods&&!methods.options.some(o=>o[0]===method&&!o[3]))throw new CommandFailed(`방식 "${method}" 은(는) 이 카드에 없습니다.`);
   cfg.validate?.(values,shared,method);
   track(onGo(values,shared,method,state));
   return state;
  },
 };
 let knowledgePromise,generationResult;
 const getDrawingKnowledge=()=>knowledgePromise ||= drawingKnowledge?Promise.resolve(drawingKnowledge):fetch('/drawing-knowledge.json',{cache:'no-store'}).then(async response=>{const data=await response.json();if(!response.ok)throw new CommandFailed(data.error||'도면 기준을 열 수 없습니다.');return data;});
 const ctx={
  getDrawingKnowledge,
  regenerateDrawingSet:async(...args)=>{const r=await (regenerateDrawingSet|| (async(document,setId,request={})=>{const knowledge=await getDrawingKnowledge(),{generateTracked}=await lockedImport('drawing-generator.js');return generateTracked(document,{...knowledge,...request,...(setId?{setId}:{})});}))(...args);generationResult={assumed:r.assumed||r.recognition?.assumed||[],recognition:r.recognition};return r;},
  scripted,storage:box,
  entities:()=>engine.doc.entities,layers:()=>engine.doc.layers,blocks:()=>engine.doc.blocks,doc:()=>engine.doc,document:()=>structuredClone(engine.doc),
  selected:()=>{used.add('selection');return engine.doc.entities.filter(e=>selection.has(e.id));},selectedIds:()=>{used.add('selection');return [...selection];},setSelected:ids=>{selection=new Set(ids);},
  execute:c=>engine.execute(c),refresh(){},log(){},afterCommand:fn=>track(Promise.resolve().then(fn)),
  toast:(m,isError)=>{(isError?errors:messages).push(isError?new CommandFailed(String(m)):String(m));},
  userErrorMessage:e=>e?.message||String(e),
  ensureLayer,
  commit:({removeIds=[],entities=[],reviewObjectSeq=null})=>{
   const current=engine.doc.layers.find(l=>l.id===layer);
   if(current&&(current.visible===false||current.locked))throw new CommandFailed('현재 레이어가 숨김/잠금 상태입니다. 다른 레이어를 선택하세요.');
   const list=entities.map(e=>({...e,layer:e.layer||layer}));
   // 지울 것이 없으면 addMany 하나 — batch 는 엔진이 도면 전체를 되돌리기용으로 복사한다(6천 개 도면에서 명령마다 45ms)
   const commands=[...(reviewObjectSeq?[{type:'document.update',changes:{reviewObjectSeq}}]:[]),...(removeIds.length?[{type:'delete',ids:removeIds}]:[]),{type:'addMany',entities:list}];
   const ids=engine.execute(commands.length===1?commands[0]:{type:'batch',commands});
   selection=new Set(Array.isArray(ids)?ids:[]);return ids;
  },
  documentSnapshot:()=>structuredClone(engine.doc),
  activeLayer:()=>layer,setActiveLayer:id=>{if(engine.doc.layers.some(l=>l.id===id))layer=id;},
  tolerance:()=>10,num:(key,def)=>def,scale:()=>1,drawingFilePath:()=>'',
  // 명령 안에서 다른 명령(DIMSTYLE·XREF·BLOCKCLEAN 등 화면 창)을 부르면 모아 두었다가, 결과를 도면에 넣은 뒤 화면이 이어서 연다(followUps.run).
  run:name=>{followUps.run.push(String(name));},
  form:(title,fields,onApply)=>{
   ask('form',title,{fields:fields.map(f=>({key:f.name,label:f.label,type:f.type,value:f.value,options:f.options}))});
   const given=formQ.length?formQ.shift():{};warnFields(given,fields.map(f=>f.name),'form');
   // 체크 상자: 화면은 'on'/빈 글을 넘긴다. AI 연결이 보낸 true/false 도 같은 값으로(2026-10-27 설명서 시험: SE·SEB·FTT 등이 true 를 꺼짐으로 봄).
   for(const f of fields)if(f.type==='checkbox'&&typeof given[f.name]==='boolean')given[f.name]=given[f.name]?'on':'';
   const values={...Object.fromEntries(fields.map(f=>[f.name,f.value??''])),...given};
   return track(onApply(values));
  },
  askNumber:(opts,onValue)=>{
   ask('number',opts?.label||opts?.title,{value:opts?.value});
   const n=numberQ.length?Number(numberQ.shift()):opts?.value;
   if(!Number.isFinite(n))throw need('number',opts?.label||opts?.title);
   track(onValue(n));
  },
  pickPoint:async options=>{
   ask('point',promptText(options));
   if(!pointQ.length)throw need('point',promptText(options));
   const p=pointQ.shift();
   if(p?.option!==undefined){const token=String(p.option).toUpperCase();if(!options?.options?.includes(token))throw new CommandFailed('허용되지 않은 옵션: '+token);return {option:token};}
   return p===null?null:point(p);
  },
  pickPath:async(options={})=>{
   const min=options.minPoints??2,max=options.maxPoints||0;
   ask('path',promptText(options),{minPoints:min,maxPoints:max});
   if(pathQ[0]===null){pathQ.shift();return null;}
   if(!pathQ.length&&pointQ[0]===null){pointQ.shift();return null;}
   if(pathQ.length){const p=pathQ.shift(),list=Array.isArray(p)?p:p?.points;if(!Array.isArray(list))throw new CommandFailed('경로는 점 목록입니다.');const pts=list.map(point);if(max&&pts.length>max)warnings.push('사용하지 않은 입력: paths (경로의 뒤 '+(pts.length-max)+'개 점)');if(pts.length<min)throw need('path',promptText(options),{minPoints:min,given:pts.length});return {points:max?pts.slice(0,max):pts,closed:!!p?.closed};}
   const take=max||pointQ.length;
   if(pointQ.length<Math.max(min,take)||!take)throw need('path',promptText(options),{minPoints:min,maxPoints:max,given:pointQ.length});
   return {points:pointQ.splice(0,take).map(point),closed:false};
  },
  pickEntity:async(options={})=>{
   ask('entity',promptText(options),{types:options.types||null});
   if(!entityQ.length)throw need('entity',promptText(options),{types:options.types||null});
   const pick=entityQ.shift();if(pick===null)return null;
   if(pick?.option!==undefined&&pick.option===options.allowNone)return {option:pick.option};
   const id=typeof pick==='object'?pick.id:pick;
   const e=engine.doc.entities.find(x=>x.id===id);
   if(!e)throw new CommandFailed(`없는 객체 ID: ${id}`);
   if(options.types&&!options.types.includes(e.type))throw new CommandFailed(`이 명령은 ${options.types.join('·')} 객체를 고릅니다(받은 것: ${e.type}).`);
   return options.withPoint?{entity:structuredClone(e),point:pick?.point?point(pick.point):undefined}:structuredClone(e);
  },
 };
 // 특성·주석 명령용 확장(app.js propertyContext 와 같은 이름). 화면 설정은 기본값으로 둔다.
 const propertyContext={...ctx,getTextHeight:()=>null,getSettings:()=>({}),getDisplayPrecision:()=>2,setDisplayPrecision:v=>v,getCurrentProperties:()=>({}),setCurrentProperties(){},setTextHeight(){}};
 const settle=async()=>{while(pending.size)await Promise.all([...pending]);};
 // 카드 몇 개는 setTimeout 으로 다음 단계를 잇는다(폼을 닫은 뒤 점 찍기 등). 실행 동안만 타이머를 세어 끝까지 기다린다.
 // 화면 스레드에서는 쓰지 않는다(Worker·node 전용): 그 동안 만든 다른 타이머까지 기다리게 되기 때문이다.
 const hookTimers=()=>{
  const realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout,live=new Map();
  // 0ms 타이머는 MessageChannel 로 바로 다음 차례에(Windows node 의 setTimeout(0) 은 15ms — 도면 생성기가 명령 수십 번을 부르면 몇 초가 된다).
  const soon=cb=>{const c=new MessageChannel(),h={cancel:()=>c.port1.close()};c.port1.onmessage=()=>{c.port1.close();cb();};c.port2.postMessage(0);return h;};
  globalThis.setTimeout=(fn,ms,...args)=>{let done;const p=new Promise(r=>{done=r;});
   const go=()=>{live.delete(h);try{Promise.resolve(typeof fn==='function'?fn(...args):undefined).catch(e=>errors.push(e)).finally(done);}catch(e){errors.push(e);done();}};
   const h=(Number(ms)||0)<=0&&typeof MessageChannel==='function'?soon(go):realSet(go,Math.min(Number(ms)||0,2000));
   live.set(h,done);track(p);return h;};
  globalThis.clearTimeout=h=>{const done=live.get(h);if(done){live.delete(h);done();}if(h?.cancel)return h.cancel();return realClear(h);};
  return ()=>{globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear;};
 };
 const failure=()=>needs.at(-1)||errors[0]||null;
 const unusedInputs=()=>[...warnings,...Object.entries({form:formQ,points:pointQ,paths:pathQ,entities:entityQ,numbers:numberQ}).filter(([,q])=>q.length).map(([key,q])=>'사용하지 않은 입력: '+key+' ('+q.length+'개 남음)'),...Object.keys(inputs).filter(key=>!used.has(key)&&supplied[key]!==undefined&&(key!=='selection'||supplied.selection?.length)).map(key=>'사용하지 않은 입력: '+key)];
 return {ctx,propertyContext,generationResult:()=>generationResult,settle,hookTimers,failure,aborted,errors,messages,requests,unusedInputs,selection:()=>[...selection],
  /** 화면이 이어서 할 일: 내려받을 파일·클립보드에 쓸 글·이어서 부를 화면 명령·저장소에 쓸 값. 없으면 undefined. */
  followUps:()=>{const storageWrites=box.writes();const out={...(followUps.downloads.length?{downloads:followUps.downloads}:{}),...(followUps.clipboard!=null?{clipboard:followUps.clipboard}:{}),...(followUps.run.length?{run:followUps.run}:{}),...(Object.keys(storageWrites).length?{storage:storageWrites}:{})};return Object.keys(out).length?out:undefined;},
  followUpSink:followUps};
}

/** 등록된 이름 목록(화면 전용 연결 DEE·QMENU 는 없음). */
export function scriptedCommandNames(){
 const engine=new DrawingEngine();const {ctx,propertyContext}=scriptedContext(engine);
 return Object.keys(installCardCommands(ctx,propertyContext,{styledDimension:e=>e}));
}

/**
 * 명령 하나를 engine 위에서 실행한다. 성공하면 되돌리기 한 단계로 남고, 실패·입력 부족이면 실행 전으로 되돌린다.
 * @returns {added, removed, changed, selection, messages}
 */
export async function runScripted(engine,name,inputs={},options={}){
 const key=String(name||'').trim().toUpperCase();
 const s=scriptedContext(engine,inputs,options);
 const commands=installCardCommands(s.ctx,s.propertyContext,{styledDimension:e=>applyDimStyle(e,getDimStyle(engine.doc))});
 const command=commands[key];
 if(!command)throw new CommandFailed(`"${key}" 은(는) 화면 없이 실행할 수 있는 건축 요소 명령이 아닙니다. cad_list_commands 로 쓸 수 있는 명령을 찾고, 리습 명령이면 cad_lisp_run, 창호표는 cad_generate_drawing(kind=schedule)을 쓰세요.`,{code:'unknown_command'});
 const before=engine.doc;
 // OCCT RPC owns real timeout timers; it has no delayed card-input callbacks to drain.
 const unhook=['OCCTPLAN','OCCTSECTION','OCCTELEVATION','PLANSET','AIREDRAW'].includes(key)?()=>{}:s.hookTimers();
 engine.beginTransaction();
 // card-input.js 의 downloadText·clipboardWrite 가 이 실행 동안 여기로 모은다(화면 없는 일꾼).
 const previousSink=globalThis.__barunCommandFollowUps;globalThis.__barunCommandFollowUps=s.followUpSink;
 try{
  await Promise.race([command(),s.aborted]);
  await s.settle();
  if(s.failure())throw s.failure();
 }catch(error){
  engine.rollbackTransaction();
  throw s.failure()||error;
 }finally{unhook();globalThis.__barunCommandFollowUps=previousSink;}
 engine.endTransaction();
 const old=new Map(before.entities.map(e=>[e.id,e])),now=new Map(engine.doc.entities.map(e=>[e.id,e]));
 return {
  command:key,...(s.generationResult()||{}),
  added:engine.doc.entities.filter(e=>!old.has(e.id)).map(e=>e.id),
  removed:before.entities.filter(e=>!now.has(e.id)).map(e=>e.id),
  changed:engine.doc.entities.filter(e=>old.has(e.id)&&old.get(e.id)!==e&&JSON.stringify(old.get(e.id))!==JSON.stringify(e)).map(e=>e.id),
  selection:s.selection(),messages:s.messages,warnings:s.unusedInputs(),
  ...(s.followUps()?{followUps:s.followUps()}:{}),
 };
}

/** 도면 사본에서 실행해 결과 도면을 돌려준다(원본 engine 은 그대로). AI 미리보기·리습 연결이 쓴다. */
export async function runOnCopy(doc,name,inputs={},options={}){
 const copy=new DrawingEngine();copy.execute({type:'load',document:structuredClone(doc)});
 const result=await runScripted(copy,name,inputs,options);
 return {...result,document:copy.doc};
}

/** 명령이 어떤 입력을 어떤 순서로 묻는지. 실제로 그리지 않고, 첫 번째로 모자란 입력에서 멈춘다. */
export async function describeCommand(doc,name,inputs={},options={}){
 const copy=new DrawingEngine();copy.execute({type:'load',document:structuredClone(doc)});
 const s=scriptedContext(copy,inputs,options);
 const key=String(name||'').trim().toUpperCase();
 const command=installCardCommands(s.ctx,s.propertyContext,{styledDimension:e=>applyDimStyle(e,getDimStyle(copy.doc))})[key];
 if(!command)throw new CommandFailed(`"${key}" 은(는) 화면 없이 실행할 수 있는 건축 요소 명령이 아닙니다. cad_list_commands 로 쓸 수 있는 명령을 찾고, 리습 명령이면 cad_lisp_run, 창호표는 cad_generate_drawing(kind=schedule)을 쓰세요.`,{code:'unknown_command'});
 let stop=null;// OCCT RPC owns real timeout timers; it has no delayed card-input callbacks to drain.
 const unhook=['OCCTPLAN','OCCTSECTION','OCCTELEVATION','PLANSET','AIREDRAW'].includes(key)?()=>{}:s.hookTimers();
 try{await Promise.race([command(),s.aborted]);await s.settle();stop=s.failure();}catch(e){stop=s.failure()||e;}finally{unhook();}
 return {command:key,inputs:s.requests,needs:stop instanceof NeedInput?{what:stop.what,prompt:stop.prompt}:null,error:stop&&!(stop instanceof NeedInput)?stop.message:null};
}

/** Worker 메시지 하나 처리(노드 시험도 이 함수를 쓴다). op: 'run' | 'describe' | 'generate'. storage 는 화면 저장소의 사본({키:값}). */
export async function commandJob({id,op,document,name,inputs={},activeLayer,storage={},recognition,progress,clipboardText}={}, {onProgress}={}){
 const source={getItem:k=>Object.prototype.hasOwnProperty.call(storage,k)?storage[k]:null};
 try{
  if(op==='generate'){
   // 도면 생성기(설계 JSON + 도면 기준 → 도면). 우리 명령(CON·INS·ELM)을 돌리므로 이 Worker 에서만.
   // 묶음을 도면에 기억(drawingSets)하고 같은 setId 면 옛 결과만 바꿔 그린다 — 다시 만들기
   const G=await lockedImport('drawing-generator.js'),r=await G.generateTracked(document,inputs,{onProgress,recognition});
   return {id,result:{document:r.document,added:r.added,removed:r.removed,setId:r.setId,commands:r.commands,sheets:r.sheets??null,plan:r.plan??null,review:r.review??null,quality:r.quality??null,occt:r.occt??null,recognition:r.recognition??null,assumed:r.assumed||r.recognition?.assumed||[],section:r.section??null,schedule:r.schedule??null,elevation:r.elevation??null,warnings:r.warnings||[]}};   // 실시도면 품질 검사(체크리스트 200)·3D 결과도 화면으로
  }
  if(op==='describe')return {id,result:await describeCommand(document,name,inputs,{activeLayer,storage:source})};
  const r=await runOnCopy(document,name,inputs,{activeLayer,storage:source,clipboardText});
  return {id,result:r};
 }catch(e){return {id,error:{message:e?.message||String(e),name:e?.name||'Error',what:e?.what||null,prompt:e?.prompt||null,code:e?.code||null}};}
}

/** 도면 생성기가 평면을 읽어야 하는 경우(설계 JSON·이전 묶음·상세 전용이 아님) 화면에서 먼저 서버에 맡긴다.
    여기서 난 오류는 생성기가 평면 인식을 실제로 쓸 때만 낸다. */
export async function generatorRecognition(document,request,{signal}={}){
 const prev=request?.setId?document.drawingSets?.[request.setId]:null,kind=request?.kind||prev?.kind||'set';
 // 편의시설 계획도는 생성기가 자체 인식을 먼저 쓴다 — 필요할 때만 Worker 가 화면을 거쳐 서버에 묻는다.
 if(request?.model||prev||kind==='details'||kind==='access-plan')return undefined;
 const {recognizePlanModel}=await import('./compute-client.js');
 try{return await recognizePlanModel(document,{reading:request.standard?.planReading,...request.planOptions},{signal});}
 catch(error){if(error?.name==='AbortError')throw error;return {error:{message:error?.message||String(error),code:error?.code||'offline'}};}
}

/** 화면 쪽: 건축 요소 명령을 전용 Worker 에서 돌린다(카드가 쓰는 타이머를 세느라 화면 스레드에서는 돌리지 않는다). */
export function createCommandClient({url=new URL('./command-worker.js',import.meta.url),limitMs=60_000,startLimitMs=120_000}={}){
 let worker=null,seq=0,active=null,retire=false;const waiting=new Map(),queue=[];
 const terminate=()=>{const previous=worker;worker=null;try{previous?.terminate();}catch{}};
 const settle=(id,error,result)=>{const w=waiting.get(id);if(!w)return;waiting.delete(id);clearTimeout(w.timer);clearTimeout(w.startTimer);w.signal?.removeEventListener('abort',w.abort);if(active===id)active=null;if(retire&&active===null){retire=false;terminate();}if(error)w.reject(error);else w.resolve(result);};
 const abortActive=message=>{const id=active;terminate();if(id!==null)settle(id,new CommandFailed(message));pump();};
 const fail=message=>{terminate();for(const id of [...waiting.keys()])settle(id,new CommandFailed(message));queue.length=0;};
 // 로그아웃·만료: Worker 안에 풀어 둔 잠근 화면 코드(도면 생성기)를 버리려고 Worker 를 내린다. 실행 중이면 끝난 뒤에.
 globalThis.addEventListener?.('barun-protected-locked',()=>{if(active===null)terminate();else retire=true;});
 const ensure=()=>{
  if(worker)return worker;
  const current=new Worker(url,{type:'module'});worker=current;
  current.onmessage=({data})=>{
   // Worker 가 잠근 화면 코드(도면 생성기)를 물으면 같은 묶음을 건넨다(screen-vault.js). 잠겨 있으면 안내 문구가 오류로 간다.
   if(data?.vault===true){screenVaultBundle().then(bundle=>current.postMessage({vault:{bundle}}),error=>current.postMessage({vault:{error:error?.message||String(error)}}));return;}
   if(worker!==current||active!==data?.id)return;
   const w=waiting.get(data.id);if(!w)return;
   // The Worker acknowledges immediately before commandJob: module loading and queue wait are not execution time.
   if(data.started===true){clearTimeout(w.startTimer);w.startTimer=null;if(!w.timer)w.timer=setTimeout(()=>abortActive(`건축 요소 실행이 ${w.timeout/1000}초 안에 끝나지 않아 멈췄습니다.`),w.timeout);return;}
   if(data.progress){try{w.onProgress?.(data.progress);}catch{}return;}
   // Worker 는 엔진 토큰을 못 받으므로 서버 계산(compute-client)은 화면이 대신 보내고 답을 돌려준다.
   // 서버를 기다리는 시간은 명령 실행 시간 상한에서 뺀다(답을 돌려준 뒤 다시 센다).
   if(data.compute){const {call:callId,action,input}=data.compute;if(w.timer){clearTimeout(w.timer);w.timer=null;}
    const reply=message=>{if(worker!==current)return;current.postMessage({computeReply:{call:callId,...message}});if(waiting.get(data.id)===w&&!w.timer)w.timer=setTimeout(()=>abortActive(`건축 요소 실행이 ${w.timeout/1000}초 안에 끝나지 않아 멈췄습니다.`),w.timeout);};
    const task=action==='image.read'?import('./image-underlay.js').then(M=>M.loadImageSource(input)):import('./compute-client.js').then(C=>C.compute(action,input));
    task.then(result=>reply({result}),error=>reply({error:{message:error?.message||String(error),code:error?.code||'offline'}}));return;}
   const error=data.error?(data.error.name==='NeedInput'?new NeedInput(data.error.what,data.error.prompt):new CommandFailed(data.error.message,{code:data.error.code})):null;
   settle(data.id,error,data.result);pump();
  };
  current.onerror=e=>{if(worker===current)abortActive('건축 요소 실행기(Worker)가 멈췄습니다.'+(e?.message?` (${e.message})`:''));};
  return current;
 };
 const pump=()=>{
  if(active!==null)return;
  while(queue.length){const id=queue.shift(),w=waiting.get(id);if(!w)continue;if(w.signal?.aborted){settle(id,new CommandFailed('중지했습니다.'));continue;}active=id;
   try{ensure().postMessage({...w.msg,id});}catch(error){terminate();settle(id,new CommandFailed(error?.message||String(error)));continue;}
   // 실행 시간 상한은 Worker 가 started 를 알린 뒤부터 센다. 그 전(모듈·잠근 화면 코드 받기)에 멈추면 이 작업과 뒤에 줄 선 작업이 끝없이 기다렸다.
   w.startTimer=setTimeout(()=>{if(active===id&&!w.timer)abortActive(`건축 요소 실행기가 ${startLimitMs/1000}초 안에 시작하지 못해 멈췄습니다. 다시 실행하세요.`);},startLimitMs);
   return;
  }
 };
 const call=(msg,{signal,onProgress}={})=>new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(new CommandFailed('중지했습니다.'));
  const timeout=msg.op==='generate'||['PLANSET','AIREDRAW','OCCTPLAN','OCCTSECTION','OCCTELEVATION'].includes(String(msg.name||'').toUpperCase())?Math.max(limitMs,180_000):limitMs;
  const id=++seq,abort=()=>{if(active===id)abortActive('중지했습니다.');else settle(id,new CommandFailed('중지했습니다.'));};
  waiting.set(id,{resolve,reject,msg:{...msg,...(onProgress?{progress:true}:{})},signal,abort,timeout,onProgress,timer:null});signal?.addEventListener('abort',abort,{once:true});queue.push(id);pump();
 });
 return {run:(document,name,inputs,{signal,...options}={})=>call({op:'run',document,name,inputs,...options},{signal}),describe:(document,name,inputs,{signal,...options}={})=>call({op:'describe',document,name,inputs,...options},{signal}),generate:async(document,request,{signal,onProgress}={})=>{const {prepareStandardDetails}=await import('./cad-asset-client.js');const inputs=await prepareStandardDetails(document,request);return call({op:'generate',document,inputs,recognition:await generatorRecognition(document,inputs,{signal})},{signal,onProgress});},stop:()=>fail('중지했습니다.')};
}
