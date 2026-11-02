import {commitAIChange} from './ai-commit.js';
import {showConsentRequests} from './ai-consent.js';
import {ensureAIWorkBand,notifyAIChange} from './ai-work-band.js';
import {standardLayerForName} from './layer-standards.js';
import {legacyStandardName} from './layer-migration.js';
import {prepareAICommand,aiLayerWarnings} from './ai-layer-policy.js';
import {snapAITextHeights} from './paper-sizes.js';
// AI 가 직접 넣는 글자 높이는 종이 위 크기표(drawing-standard paperSizes) × 축척으로 맞춘다(사장님 2026-10-25 "강제해서 절대 못 하게")
let paperStandardPromise=null,paperStandard=null;
const paperStandardOnce=()=>paperStandardPromise||=(typeof fetch==='function'?fetch('/drawing-knowledge.json',{cache:'no-store'}).then(async r=>r.ok?(await r.json()).standard||null:null):Promise.resolve(null)).then(s=>(paperStandard=s)).catch(()=>{paperStandardPromise=null;return null;});
// 요청 처리는 동기라 기준은 미리 읽어 둔 것을 쓴다. 아직 못 읽었으면 글자를 고치지 않고 그렇다고 알린다.
const paperSized=(doc,command)=>{paperStandardOnce();if(!paperStandard)return {command,warnings:!/"type":"text"/.test(JSON.stringify(command||{}))?[]:['code=paper_size: 종이 위 크기표(drawing-standard paperSizes)를 아직 읽지 못해 글자 높이를 확인하지 못했습니다.']};return snapAITextHeights(doc,command,paperStandard);};
import {prepareUnitInsertion} from './unit-insertion.js';
import {prepareJutongInsertion} from './jutong-insertion.js';
import {DrawingEngine} from './engine.js';
import {applyStructureSet} from './structure-drawing.js';
import {certificateFields,certificateHtml} from './structure-certificate.js';
import * as Compute from './compute-client.js';
import * as G from './geometry.js';
import {userErrorMessage} from './user-error.js';
import {documentWeight} from './import-stream.js';
import {createCommandClient} from './command-runner.js';
import {plotSVG,plotPDFJob} from './plot.js';
import {MATERIAL_PRESETS,MATERIAL_KINDS,KIND_LABELS,DEFAULT_MATERIALS} from './material-presets.js';
import {drawingDenominator} from './ai-asks.js';
import {planDeliveryCheck} from './delivery-check.js';
import {attachSitePlan} from './site-plan.js';
import {padSketchBounds,padSketchPngPlan} from './pad-sketch.js';
import {isLowMemDetected} from './low-memory.js';
import {commitImage} from './image-underlay.js';
import {energyRegions,energyRegionContents} from './energy-regions.js';
import {extensionAreas,permitKind,MAJOR_REPAIR_ITEMS,REPAIR_CHOICES} from './extension-review.js';
import {energyPlanForAI} from './permit-book.js';
import {recognizeAll} from './drawing-recognition.js';
import {recognitionForAI,recognitionAnswerSettings} from './drawing-recognition-read.js';
/* S6: 편집마다 도면 전체를 보내지 않는다. 같은 기준(app.js 자동 복구)대로 5만 객체를 넘으면 문서를 보내지 않고,
   그 아래에서는 마지막 전송 뒤 DOCUMENT_INTERVAL_MS 가 지난 다음 한 번만 보낸다(연속 편집 중에는 모아 보낸다). */
export const MAX_BRIDGE_ENTITIES=50000;
export const DOCUMENT_INTERVAL_MS=1500;
export const LOW_MEMORY_RECOVERY_INTERVAL_MS=30_000;   // 207: 메모리가 거의 찼을 때는 2분 대신 30초(보내는 일 자체가 메모리를 쓰므로 매번은 아님)
export const LARGE_RECOVERY_INTERVAL_MS=120_000;   // 5만 객체를 넘는 도면의 복구본은 2분마다(변경이 있을 때만) 줄 단위 스트림으로 보낸다
/** 대용량 도면 복구 전송 시점 판단. {send:boolean, reason?}
    207: 메모리가 거의 찼으면(lowMem) 2분 주기 대신 30초 간격으로 남긴다 — 화면이 죽기 전에 마지막 작업을 엔진 쪽에 둔다
    (보내는 일 자체가 메모리를 쓰므로 매번은 아님).
    ACAD200-811: AutoCAD 처럼 '명령이 끝나 조용할 때'만 보낸다 — 명령 중(commandIdle=false)이거나 마지막 입력 뒤 1초가 안 됐으면
    (quiet=false) 다음 펄스(0.3초 뒤)로 미룬다. 그래서 2분마다 끌기·입력 중에 1초 멈추던 일이 없다. 늦어져도 간격이 지난 뒤 첫 한가한 순간에 보낸다.
    저메모리일 때도 이 미루기 규칙은 같다(명령 중에 보내면 그 순간 멈춤과 메모리 사용이 겹친다). */
export function largeRecoveryPlan({count,revision,sentRevision,now,lastSentAt,intervalMs=LARGE_RECOVERY_INTERVAL_MS,limit=MAX_BRIDGE_ENTITIES,dirty=true,lowMem=false,quiet=true,commandIdle=true}){
 if(count<=limit||!dirty||revision===sentRevision)return {send:false};
 const interval=lowMem?Math.min(intervalMs,LOW_MEMORY_RECOVERY_INTERVAL_MS):intervalMs;
 if(lastSentAt>=0&&now-lastSentAt<interval)return {send:false};
 if(!commandIdle)return {send:false,reason:'command'};
 if(!quiet)return {send:false,reason:'input'};
 return lowMem?{send:true,reason:'low-memory'}:{send:true};
}
/** 이번 pulse 에 문서를 어떻게 실을지 정한다. {send:'document'|'omitted'|'none'} */
export function documentSendPlan({changed,count,now,lastSentAt,intervalMs=DOCUMENT_INTERVAL_MS,limit=MAX_BRIDGE_ENTITIES,forced=false}){
 if(!changed&&!forced)return {send:'none'};
 if(count>limit)return {send:'omitted'};
 if(forced||lastSentAt<0||now-lastSentAt>=intervalMs)return {send:'document'};
 return {send:'none'};   // 아직 간격이 안 찼다 — 다음 pulse 에서 다시 판단한다(뒤늦은 전송)
}
const TARGET_KEYS=['protocol_version','backend_generation','editor_session','document_generation','snapshot_id','revision'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sameTarget=(a,b)=>!!a&&!!b&&TARGET_KEYS.every(key=>a[key]===b[key]);
const validTarget=t=>!!t&&typeof t==='object'&&Object.keys(t).length===TARGET_KEYS.length&&t.protocol_version===1&&
 Number.isSafeInteger(t.revision)&&t.revision>=0&&TARGET_KEYS.filter(k=>!['protocol_version','revision'].includes(k)).every(k=>UUID.test(t[k]||''));

/** Renderer-owned identities. A document pointer is not an identity: COW edits replace it. */
export function createBridgeBinding(context){
 const editorSession=crypto.randomUUID();let generation=crypto.randomUUID(),revision=0,backend=null,acknowledged=null;
 let drawingId=context.getDrawingId?.()??null,lastExecution=context.engine.lastExecution;
 const supported=typeof context.getDrawingId==='function';
 const observeDrawing=()=>{const next=context.getDrawingId?.()??null;if(next!==drawingId){drawingId=next;generation=crypto.randomUUID();revision++;acknowledged=null;return true;}return false;};
 context.engine.onChange(()=>{
  const switched=observeDrawing(),execution=context.engine.lastExecution;
  if(!switched&&execution!==lastExecution&&['load','new'].includes(execution?.type)){generation=crypto.randomUUID();acknowledged=null;}
  lastExecution=execution;revision++;
 });
 const current=()=>{observeDrawing();return {protocol_version:1,editor_session:editorSession,document_generation:generation,revision};};
 return {
  editorSession,supported,current,
  receive(response){
   if(response.protocol_version!==1||!UUID.test(response.backend_generation||'')){backend=null;acknowledged=null;return;}
   if(backend!==response.backend_generation){backend=response.backend_generation;acknowledged=null;}
   const now=current(),target=response.target;
   if(validTarget(target)&&target.backend_generation===backend&&target.editor_session===editorSession&&target.document_generation===now.document_generation&&target.revision===now.revision)acknowledged=structuredClone(target);
  },
  assert(target){
   const now=current();
   if(!supported||drawingId===null||!validTarget(target)||target.backend_generation!==backend||
      target.editor_session!==editorSession||target.document_generation!==now.document_generation||target.revision!==now.revision||!sameTarget(target,acknowledged))
    throw Error('CAD target changed; read and preview this editor again.');
   if(context.isDocumentBusy?.()||context.isSwitchingDrawing?.()||context.engine.inTransaction?.())throw Error('CAD editor is busy; finish the current drawing operation first.');
   return now;
  }
 };
}

/** Stage an offline library detail only when explicitly inserted. */
export {prepareJutongInsertion} from './jutong-insertion.js';

export function prepareDetailInsertion(document,args){
 const detail=args.detail,original=detail?.geometry;
 const source=original?.sharedBlocks ? G.expandSharedDrawingBlocks(original) : original;
 if(detail?.kind&&detail.kind!=='detail'&&!(detail.server_asset&&['unit','jutong'].includes(detail.kind)))throw Error('상세 단위만 삽입할 수 있습니다.');
 const sourceName=detail?.source==='la'?'LA':(detail?.source_name||'LH');
 if(!source||!Array.isArray(source.entities)||!source.entities.length||!Array.isArray(source.layers))throw Error('상세 기하가 없습니다.');
 const position=args.position??{x:0,y:0},factor=args.scale??1,rotation=args.rotation??0,mirror=args.mirror??false;
 if(!Number.isFinite(position.x)||!Number.isFinite(position.y))throw Error('position은 유한한 x,y가 필요합니다.');
 if(!Number.isFinite(factor)||factor<=G.EPS)throw Error('scale은 양수여야 합니다.');
 if(!Number.isFinite(rotation)||typeof mirror!=='boolean')throw Error('rotation은 유한한 숫자, mirror는 boolean이어야 합니다.');
 const actualPlan=detail.source==='library'&&(detail.group==='unit'||detail.group==='jutong'||/^(?:UN|JT)-/.test(detail.id||args.id||''));
 if(actualPlan&&(factor!==1||source.units!=='mm'||detail.scale_verified!==true))throw Error('주동·단위세대는 확인된 실제 mm 크기로만 삽입합니다.');
 const bounds=args.bounds??detail.bounds??(detail.source==='library'?G.bounds(source.entities):null);
 if(!bounds||!['minX','minY','maxX','maxY'].every(k=>Number.isFinite(bounds[k]))||bounds.maxX<=bounds.minX||bounds.maxY<=bounds.minY)throw Error('상세 범위가 잘못되었습니다.');
 const full=detail.bounds;
 if(args.bounds&&full&&['minX','minY'].some(k=>bounds[k]<full[k]-1e-5)||args.bounds&&full&&['maxX','maxY'].some(k=>bounds[k]>full[k]+1e-5))throw Error('선택 범위가 상세 영역을 벗어납니다.');
 const layers=document.layers.slice(),mapping=new Map(),names=new Set(layers.map(l=>l.name));
 for(const layer of source.layers){
  if(detail.server_asset){
   // 서버 자산은 아직 옛 긴 이름(A-ANNO-TEXT·A-PATT·A-ANNO-DIMS 등)을 쓴다 → 넣을 때 짧은 바른 이름으로(10-25 서버 상세 164개 검사)
   const name=legacyStandardName(layer.name)||layer.name;
   const existing=layers.find(row=>row.name===name);
   if(existing){
    if(existing.locked||existing.frozen||existing.visible===false||existing.plot===false)throw Error('서버 자산 대상 레이어가 잠겨 있거나 숨겨져 있습니다.');
    mapping.set(layer.id,existing.id);continue;
   }
   const next={...structuredClone(layer),...standardLayerForName(name),name,id:crypto.randomUUID()};layers.push(next);names.add(next.name);mapping.set(layer.id,next.id);continue;
  }
  const next={...structuredClone(layer),id:crypto.randomUUID()};let base=sourceName+' '+layer.name,name=base,n=2;
  while(names.has(name))name=base+' '+n++;
  next.name=name;names.add(name);layers.push(next);mapping.set(layer.id,next.id);
 }
 const remap=e=>{
  const v=structuredClone(e);v.id=crypto.randomUUID();v.layer=mapping.get(e.layer);
  if(!v.layer)throw Error('상세 객체의 원본 레이어가 없습니다.');
  if(v.sharedBlock)throw Error('상세 공유 블록을 등록 도구에서 전개해야 합니다.');
  for(const key of ['entities','children'])if(Array.isArray(e[key]))v[key]=e[key].map(remap);
  return v;
 };
 const base={x:bounds.minX,y:bounds.minY};
 const transform=entity=>{let value=entity;if(mirror)value=G.mirror(value,position,{x:position.x,y:position.y+1});if(rotation)value=G.rotate(value,position,rotation);return value;};
 const moved=source.entities.map(remap).map(e=>transform(G.translate(G.resize(e,base,factor),position.x-base.x,position.y-base.y)));
 const radians=rotation*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
 const transformPoint=point=>{const x=(point.x-position.x)*(mirror?-1:1),y=point.y-position.y;return {x:position.x+x*cos-y*sin,y:position.y+x*sin+y*cos};};
 let insertionLayer=document.layers.find(l=>l.visible!==false&&!l.frozen&&!l.locked&&l.plot!==false);
 if(!insertionLayer){
  let name=sourceName+' 상세',n=2;while(names.has(name))name=sourceName+' 상세 '+n++;
  insertionLayer={...structuredClone(document.layers[0]),id:crypto.randomUUID(),name,visible:true,frozen:false,locked:false,plot:true};
  layers.push(insertionLayer);
 }
 const block={id:crypto.randomUUID(),type:'block',name:sourceName+' '+(detail.drawing_id||args.id),layer:insertionLayer.id,entities:moved,
  clip:{enabled:true,points:[position,{x:position.x+(bounds.maxX-bounds.minX)*factor,y:position.y},{x:position.x+(bounds.maxX-bounds.minX)*factor,y:position.y+(bounds.maxY-bounds.minY)*factor},{x:position.x,y:position.y+(bounds.maxY-bounds.minY)*factor}].map(transformPoint)},
  attributes:{[detail.server_asset?'BARUN_ASSET_ID':sourceName==='LA'?'LA_DETAIL_ID':'LH_DETAIL_ID']:detail.id||args.id,DETAIL_SOURCE:detail.source||'lh2025'},detail:{id:detail.id||args.id,source:detail.source||'lh2025',title:detail.name||'',scale:factor,rotation,mirror}};
 return {document:{...document,layers,entities:[...document.entities,block]},block};
}

/** 선택한 층 박스를 기존 읽기 모듈 API로 변환한다. 원본 모듈은 고치지 않는다. */
export function readStructureBoxes(document, boxIds, options = {}, overrides = {}) {
 if (!Array.isArray(boxIds) || !boxIds.length || !options || typeof options !== 'object' || Array.isArray(options)) throw Error('아래층부터 선택한 박스 ID와 읽기 옵션을 확인하세요.');
 const boxes = boxIds.map(id => {
  const box = document.entities.find(e => e.id === id);
  if (!box) throw Error('선택한 평면 박스가 없습니다: ' + id);
  return box;
 });
 return readStructurePlan(document, boxes, options, overrides);
}

// 외곽 주위 1 m를 가상 선택 박스로 읽는다. 벽 두께·문 호·모서리 기둥까지 포함하고 도면은 바꾸지 않는다.
export function readStructureOutline(document, outline, options = {}, overrides = {}) {
 const points = Array.isArray(outline) ? outline.map(p=>({x:p[0]*1000,y:p[1]*1000})) :
  [{x:outline.x,y:outline.y},{x:outline.x+outline.width,y:outline.y+outline.depth}];
 const b=G.bounds([{type:'polyline',points}]);
 if(!b||!Object.values(b).every(Number.isFinite))throw Error('구조 외곽 좌표를 확인하세요.');
 const box={type:'rectangle',points:[{x:b.minX-1000,y:b.minY-1000},{x:b.maxX+1000,y:b.maxY+1000}]};
 return readStructurePlan(document, [box], options, overrides);
}

// 평면 읽기·구조 입력 인식은 바른 서버에서(compute/actions.js structure.readPlan). 여기서는 박스만 고른다.
async function readStructurePlan(document, boxes, options, overrides) {
 return Compute.readStructurePlan(document, boxes, options, overrides);
}

/** 현재 단계는 축에 나란한 네 꼭짓점의 닫힌 윤곽만 읽는다(도면 단위 mm). */
function structureOutline(entity){
 const invalid=()=>{throw Error('직사각형 닫힌 윤곽만 됩니다(회전·꺾인 모양은 다음 단계)');};
 const points=entity?.points;
 if(!(entity?.type==='rectangle'||entity?.type==='polyline'&&entity.closed)||!Array.isArray(points)||points.length!==4||
    !points.every(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y)))invalid();
 const xs=points.map(p=>p.x),ys=points.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys),width=Math.max(...xs)-x,depth=Math.max(...ys)-y;
 if(width<=0||depth<=0)invalid();
 const corners=points.map(p=>({x:p.x-x<=width/2?0:1,y:p.y-y<=depth/2?0:1}));
 if(new Set(corners.map(p=>p.x+2*p.y)).size!==4)invalid();
 for(let i=0;i<4;i++){
  const p=points[i],q=points[(i+1)%4],a=corners[i],b=corners[(i+1)%4];
  if(a.x!==b.x&&a.y!==b.y||a.x===b.x&&Math.abs(p.x-q.x)>1||a.y===b.y&&Math.abs(p.y-q.y)>1)invalid();
 }
 return {x,y,width,depth};
}

// 서버 계산이 필요한 AI 요청(구조 평면 읽기·구조계산서·창호 제안/채광/넣기). 계산은 바른 서버에서 먼저 받아 두고,
// 아래 handleRequest 가 같은 도면일 때만(사이에 바뀌지 않았을 때만) 그 결과를 쓴다 — 확인과 적용 사이에는 여전히 기다림이 없다.
export const COMPUTE_REQUEST_ACTIONS=new Set(['cad_structure_calc_report','cad_structure_read','cad_suggest_openings','cad_check_daylight','cad_apply_openings','cad_insert_image','cad_energy_plan','cad_recognize_drawing']);
export async function prepareComputeRequest(context,binding,request){
 const {action}=request||{},args=request?.args||{},doc=context.engine.doc;
 if(!COMPUTE_REQUEST_ACTIONS.has(action))return undefined;
 // 형식·만료·대상이 틀리면 서버에 묻지 않는다(handleRequest 가 같은 오류로 답한다).
 if(!UUID.test(request.id||'')||!Number.isSafeInteger(request.expires_at)||request.expires_at<=Date.now())return undefined;
 try{binding.assert(args.target);context.assertAIRequest?.(request);}catch{return undefined;}
 let pending;
 if(action==='cad_insert_image')pending=import('./image-underlay.js').then(mod=>mod.loadImageSource(args).then(source=>mod.imageEntity(args,source)));
 else if(action==='cad_structure_calc_report'){const record=args.record||doc.structureSets?.[args.setId];if(!record)return undefined;pending=Compute.structureCalcReport(record,args.project||{});}
 else if(action==='cad_structure_read'){
  if(args.setId)return undefined;
  try{if(args.boxes)pending=readStructureBoxes(doc,args.boxes,args.options,args.overrides);else if(args.outline)pending=readStructureOutline(doc,args.outline,args.options,args.overrides);else return undefined;}
  catch(error){return {snapshot:doc,error};}
 }
 else if(action==='cad_suggest_openings')pending=Compute.suggestOpenings(doc,args);
 else if(action==='cad_check_daylight')pending=Compute.checkDaylight(doc,args);
 else if(action==='cad_recognize_drawing'){if(args.action!=='read')return undefined;pending=recognizeAll(doc);}   // 층 평면은 바른 서버(로그인)
 else if(action==='cad_energy_plan')pending=energyPlanForAI(doc,{api:context.api,drawingPath:context.getDrawingPath?.()||'',build:args.build===true,autofill:args.autofill!==false});
 else{if(!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision!==args.target?.revision)return undefined;pending=Compute.prepareOpenings(doc,args.proposals);}
 try{return {snapshot:doc,value:await pending};}catch(error){return {snapshot:doc,error};}
}

/** Synchronous check + engine application: no await or event-loop yield between them. */
export function createBoundRequestHandler(context,binding){
 const {engine,execute,selected,refresh,toast}=context,completed=new Map();
 const revealExecute=command=>{context.beginAIReveal?.();try{return execute(command);}finally{context.endAIReveal?.();}};
 const summary=doc=>({count:doc.entities.length,bounds:G.bounds(doc.entities),types:doc.entities.reduce((a,e)=>(a[e.type]=(a[e.type]||0)+1,a),{})});
 const diff=(a,b)=>{const old=new Map(a.entities.map(e=>[e.id,e])),next=new Map(b.entities.map(e=>[e.id,e]));return {added:b.entities.filter(e=>!old.has(e.id)).map(e=>e.id),removed:a.entities.filter(e=>!next.has(e.id)).map(e=>e.id),changed:b.entities.filter(e=>old.has(e.id)&&JSON.stringify(old.get(e.id))!==JSON.stringify(e)).map(e=>e.id)};};
 const bindNewIds=command=>{if(command?.type==='add'&&command.entity&&!command.entity.id)command.entity.id=crypto.randomUUID();if(command?.type==='batch')for(const child of command.commands||[])bindNewIds(child);return command;};
 return (request,prepared)=>{
  const target=request?.args?.target,identifier=request?.id;
  const fingerprint=JSON.stringify(request);
  const computed=()=>{
   if(!prepared)throw Error('바른 서버 계산 결과가 없습니다. 다시 시도하세요.');
   if(prepared.snapshot!==engine.doc)throw Error('바른 서버에서 계산하는 동안 도면이 바뀌었습니다. 다시 시도하세요.');
   if(prepared.error)throw prepared.error;
   return prepared.value;
  };
  for(const [key,entry] of completed)if(entry.expiresAt<=Date.now())completed.delete(key);
  if(completed.has(identifier)){
   const previous=completed.get(identifier);
   if(previous.fingerprint!==fingerprint)return {id:identifier,target,error:'Request identifier was reused with different content'};
   return structuredClone(previous.response);
  }
  if(completed.size>=512)return {id:identifier,target,error:'CAD request replay cache is full; wait before submitting another request'};
  let response;
  try{
   if(!UUID.test(identifier||'')||!Number.isSafeInteger(request.expires_at)||request.expires_at<=Date.now())throw Error('CAD request is invalid or expired');
   binding.assert(target);context.assertAIRequest?.(request);
   const {action,args}=request,beforeRevision=target.revision;let result,applied=false;
   if(args.expectedRevision!==undefined&&args.expectedRevision!==beforeRevision)throw Error('Expected revision differs from bound target');
   if(['cad_set_floor_heights','cad_set_model3d','cad_set_materials','cad_delivery_fix'].includes(action)&&args.expectedRevision!==beforeRevision)throw Error('expectedRevision이 필요하며 target revision과 같아야 합니다.');
   if(action==='cad_structure_calc_report'){
     const record=args.record||engine.doc.structureSets?.[args.setId];
     if(!record) throw Error('없는 구조 묶음입니다.');
     result=computed();
    }
    else if(action==='cad_structure_certificate'){
    const record=args.record||engine.doc.structureSets?.[args.setId];
    if(!record) throw Error('없는 구조 묶음입니다.');
    const fields=certificateFields(record.model||record,record.review||[],args.project||{});
    if(!fields.ok){ result=fields; } else { result={ok:true,html:certificateHtml(fields),missing:fields.missing||[],table:fields.table}; }
   }
   else if(action==='cad_structure_read'){
    if(args.setId)result={record:engine.doc.structureSets?.[args.setId]??null};
    else if(args.boxes||args.outline)result=computed();
    else if(args.entityId)result={outline:structureOutline(engine.doc.entities.find(e=>e.id===args.entityId))};
    else throw Error('구조 묶음 ID(setId) 또는 윤곽 객체 ID(entityId)가 필요합니다.');
   }
   else if(action==='cad_suggest_openings'||action==='cad_check_daylight')result=computed();
   else if(action==='cad_energy_plan'){
    // 미리 초안(2026-10-30): 도면에서 채운 빈칸을 review.settings 한 번으로 저장(Ctrl+Z 되돌림). 도면 그림은 안 바꾸므로 applied=false(읽기 도구 그대로)
    const {settings,...r}=computed();if(settings)execute({type:'review.settings',settings});result={...r,...(r.draft?{saved:!!settings}:{})};
   }
   else if(action==='cad_apply_openings'){
    if(!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision!==beforeRevision)throw Error('expectedRevision is required and must match the target');
    const staged=computed();
    engine.validate(staged.document);
    revealExecute({type:'lisp.apply',document:staged.document});applied=true;
    result={added:staged.added,warnings:staged.warnings||[],after:summary(engine.doc)};
    try{refresh?.();toast?.('AI/MCP 창호 넣기 완료 · 실행 취소 가능');}catch{}
   }
   else if(action==='cad_select'){
    if(!Array.isArray(args.ids)||args.ids.some(id=>!engine.doc.entities.some(e=>e.id===id)))throw Error('없는 객체 ID');
    selected().clear();args.ids.forEach(id=>selected().add(id));refresh();result={selected:[...selected()]};applied=true;
   }else if(action==='cad_validate'){engine.validate(engine.doc);result={valid:true,...summary(engine.doc)};}
   else if(action==='cad_preview'){
    const sized=paperSized(engine.doc,args.command);
    const planned=prepareAICommand(engine.doc,sized.command,args,context.getActiveLayer?.());
     const normalized=bindNewIds(structuredClone(context.normalizeBridgeCommand?.(planned)??planned));
    const copy=new DrawingEngine();copy.execute({type:'load',document:structuredClone(engine.doc)});copy.execute(normalized);
     const beforeIds=new Set(engine.doc.entities.map(e=>e.id));
    result={valid:true,...diff(engine.doc,copy.doc),after:summary(copy.doc),after_document:structuredClone(copy.doc),normalized_command:normalized,warnings:[...sized.warnings,...aiLayerWarnings(copy.doc,copy.doc.entities.filter(e=>!beforeIds.has(e.id)),{primitive:true})]};
   }else if(action==='cad_execute'){
    const sized=paperSized(engine.doc,args.command);
    const planned=prepareAICommand(engine.doc,sized.command,args,context.getActiveLayer?.());
    const normalized=context.normalizeBridgeCommand?.(planned)??planned;
    if(JSON.stringify(normalized)!==JSON.stringify(planned))throw Error('CAD current properties changed; preview the normalized command again.');
    const before=structuredClone(engine.doc);revealExecute(normalized);applied=true;
    const beforeIds=new Set(before.entities.map(e=>e.id));
    result={...diff(before,engine.doc),after:summary(engine.doc),warnings:[...sized.warnings,...aiLayerWarnings(engine.doc,engine.doc.entities.filter(e=>!beforeIds.has(e.id)),{primitive:true})]};
   }else if(action==='cad_insert_detail'){
    const staged=prepareDetailInsertion(engine.doc,args);engine.validate(staged.document);
    revealExecute({type:'lisp.apply',document:staged.document});applied=true;
    try{refresh?.();}catch{}
    result={added:[staged.block.id],after:summary(engine.doc),detail_id:args.id,message:'상세 블록을 삽입했습니다. 실행 취소 한 번으로 되돌릴 수 있습니다.'};
   }else if(action==='cad_insert_unit'){
    const staged=prepareUnitInsertion(engine.doc,args);engine.validate(staged.document);
    revealExecute({type:'lisp.apply',document:staged.document});applied=true;
    try{refresh?.();}catch{}
    result={added:[staged.block.id],after:summary(engine.doc),unit_id:args.id,message:'단위세대를 삽입했습니다. 실행 취소 한 번으로 되돌릴 수 있습니다.'};
   }else if(action==='cad_insert_jutong'){
    const staged=prepareJutongInsertion(engine.doc,args); engine.validate(staged.document); revealExecute({type:'lisp.apply',document:staged.document}); applied=true; try{refresh?.();}catch{} result={added:[staged.block.id],after:summary(engine.doc),jutong_id:args.id,message:'주동을 삽입했습니다. 실행 취소 한 번으로 되돌릴 수 있습니다.'};
   }else if(action==='cad_insert_layout'){
    const input=args.request,resultPayload=args.result;
    if(!input||!resultPayload||!resultPayload.report||!Array.isArray(resultPayload.entities?.entities))throw Error('배치 결과 형식이 잘못되었습니다.');
    const before=structuredClone(engine.doc);
    if(args.offset!==undefined&&(!args.offset||!Number.isFinite(args.offset.x)||!Number.isFinite(args.offset.y)))throw Error('offset은 유한한 숫자 x,y가 필요합니다.');
    const doc=attachSitePlan(engine.doc,input,resultPayload,{offset:args.offset});
    doc.sitePlan.alternativeTitle=args.title||'AI 배치';
    engine.validate(doc);
    revealExecute({type:'load',document:doc});
    applied=true;
    const changes=diff(before,engine.doc);
    result={added:changes.added.length,removed:changes.removed.length,changed:changes.changed.length,after:summary(engine.doc),site_plan_id:engine.doc.sitePlan?.id,message:'다음 편집 전 cad_get_document 로 target 을 다시 읽으세요.'};
   }else if(action==='cad_insert_image'){
    result=commitImage({doc:()=>engine.doc,execute:revealExecute},computed());
    applied=true;
    try{refresh?.();toast?.('AI/MCP 이미지 밑그림 넣기 완료 · 실행 취소 가능');}catch{}
   }else if(action==='cad_set_floor_heights'){
    execute({type:'model3d.settings',settings:{floorHeights:args.floorHeights}});applied=true;result={floorHeights:structuredClone(engine.doc.model3d.floorHeights)};
   }else if(action==='cad_set_model3d'){
    const ids=execute({type:'model3d.set',ids:args.ids,changes:args.changes});applied=true;result={changed:ids,after:summary(engine.doc)};
   }else if(action==='cad_extension_review'){
    // 증축·대수선 예비 판정(extension-review.js 와 같은 계산). 도면은 바꾸지 않는다.
    const {existing={},added={},removed={},siteArea,floors=0,repairs={}}=args;
    for(const [id,v] of Object.entries(repairs))if(!MAJOR_REPAIR_ITEMS.some(([k])=>k===id)||!(v in REPAIR_CHOICES))throw Error(`repairs.${id} 는 ${MAJOR_REPAIR_ITEMS.map(([k])=>k).join('·')} 중 하나에 none·repair·change 입니다.`);
    const areas=extensionAreas({existing,added,removed},siteArea);
    result={areas,permit:permitKind({existingFloor:existing.floor,addedFloor:added.floor,floors,repairs}),repairItems:MAJOR_REPAIR_ITEMS.map(([id,label,no])=>({id,label,article:`시행령 제3조의2 ${no}호`})),
     note:'예비 판정 — 관할 허가권자 확인 필요. permit.structural 이 true 면 cad_structure_review 로 구조 안전을 확인하세요.'};
   }else if(action==='cad_get_recognition'){
    result=recognitionForAI(engine.doc);   // 실시 탭 [도면 인식]과 같은 저장값(drawing-recognition-read.js). 도면은 바꾸지 않는다.
   }else if(action==='cad_recognize_drawing'){
    // read = 창의 [읽기](개요표·배치·층 평면·검산), answer = 확인 필요 한 줄에 답. 둘 다 review.settings 한 번(Ctrl+Z 되돌림)
    if(args.action==='read'){const r=computed();execute({type:'review.settings',settings:r.settings});applied=true;result={message:r.message,...recognitionForAI(engine.doc)};}
    else if(args.action==='answer'){execute({type:'review.settings',settings:recognitionAnswerSettings(engine.doc,{id:args.id,value:args.value,note:args.note})});applied=true;result=recognitionForAI(engine.doc);}
    else throw Error("action 은 'read' 또는 'answer' 입니다.");
    try{refresh?.();toast?.(args.action==='read'?'AI/MCP 도면 인식 · '+result.message:'AI/MCP 도면 인식 확인 필요에 답함 · 실행 취소 가능');}catch{}
   }else if(action==='cad_energy_regions'){
    // 에너지절약계획서 영역: 목록, 또는 한 영역 안의 내용(energy-regions.js)
    const regions=energyRegions(engine.doc),want=args.region==null?null:String(args.region).trim();
    if(want===null)result={regions:regions.map(r=>({key:r.key,label:r.label,bounds:r.bounds})),message:regions.length?undefined:'아직 고른 영역이 없습니다. 설계자에게 에너지절약계획서 창에서 [윈도우]로 영역을 골라 달라고 하세요.'};
    else{const region=regions.find(r=>r.key===want||r.label===want);if(!region)throw Error(`'${want}' 영역이 없습니다. 있는 영역: ${regions.map(r=>r.label).join(', ')||'없음'}`);result=energyRegionContents(engine.doc,region);}
   }else if(action==='cad_get_materials'){
    // 3D 재료 목록(material-presets.js)과 지금 도면의 종류별 재료
    result={kinds:MATERIAL_KINDS.map(kind=>({kind,label:KIND_LABELS[kind],default:DEFAULT_MATERIALS[kind],current:engine.doc.model3d?.materials?.[kind]||DEFAULT_MATERIALS[kind]})),
     presets:MATERIAL_PRESETS.map(m=>({id:m.id,label:m.label,kinds:m.kinds})),perObject:engine.doc.entities.filter(e=>e.model3d?.material).map(e=>({id:e.id,material:e.model3d.material})).slice(0,200)};
   }else if(action==='cad_set_materials'){
    if(args.ids!==undefined&&(!Array.isArray(args.ids)||!args.ids.length||args.ids.some(id=>typeof id!=='string')))throw Error('ids 는 객체 ID 문자열 배열입니다.');
    if(args.material!==undefined&&args.material!==null&&typeof args.material!=='string')throw Error('material 은 재료 ID 또는 null 입니다.');
    const commands=[];
    if(args.materials!==undefined)commands.push({type:'model3d.settings',settings:{materials:args.materials}});
    if(args.ids!==undefined){if(args.material===undefined)throw Error('ids 와 함께 material(재료 ID 또는 null)을 주세요.');commands.push({type:'model3d.set',ids:args.ids,changes:{material:args.material}});}
    if(!commands.length)throw Error('materials 또는 ids+material 을 주세요.');
    execute(commands.length===1?commands[0]:{type:'batch',commands});applied=true;   // 되돌리기 한 번
    result={materials:{...DEFAULT_MATERIALS,...engine.doc.model3d?.materials},changed:args.ids||[],message:'cad_view_3d 나 cad_view_interior 로 바뀐 모습을 보고 계속 고르세요.'};
   }else if(action==='cad_delivery_check'||action==='cad_delivery_fix'){
    if(args.denominator!==undefined&&!(Number.isInteger(args.denominator)&&args.denominator>=1&&args.denominator<=5000))throw Error('denominator 는 1~5000 정수입니다.');
    if(action==='cad_delivery_fix'&&(!Array.isArray(args.keys)||!args.keys.length||args.keys.some(k=>!['audit','overkill','angle','ends'].includes(k))))throw Error('keys 는 audit·overkill·angle·ends 중에서 고른 배열입니다.');
    const scale=args.denominator?null:drawingDenominator(engine.doc),denominator=args.denominator||scale?.value||100,locked=new Set(engine.doc.layers.filter(l=>l.locked).map(l=>l.id));
    const asks=args.denominator?{}:scale?{autoFilled:{denominator:{value:denominator,from:scale.from}}}:{assumed:[{key:'denominator',value:100,say:'도면 축척을 몰라 1:100 으로 보고 글자 크기를 봤어요. 다른 축척이면 말해 주세요.'}]};
    const check=()=>planDeliveryCheck(engine.doc,{lockedLayers:locked,denominator});
    const brief=r=>r.items.map(i=>({key:i.key,title:i.title,why:i.why,count:i.count,fixable:!!i.fix,ids:i.ids.slice(0,200)}));
    if(action==='cad_delivery_check'){const r=check();result={...asks,denominator,problems:r.problems,items:brief(r)};}
    else{
     const fixed=[];
     for(const key of ['audit','overkill','angle','ends'].filter(k=>args.keys.includes(k))){   // 하나 고칠 때마다 다시 검사한 도면으로
      const item=check().items.find(i=>i.key===key),command=item?.fix?.();if(!command)continue;
      revealExecute(key==='audit'?{...command,keepProperties:true}:command);
      fixed.push({key,title:item.title,count:item.count});applied=true;
     }
     const after=check();result={...asks,fixed,remaining:brief(after).filter(i=>i.count),problems:after.problems};
    }
   }else if(action==='cad_plot_pdf'){
    // PDF 출력 작업만 만든다. 서버(bridge.py)가 pdf_service 로 그려 파일로 쓴다.
    const fit=!(args.scale>0);
    const job=plotPDFJob(engine.doc,{paper:args.paper||'A3',orientation:args.orientation||'landscape',fit,denominator:fit?100:args.scale,margin:10,colorMode:'color',title:context.getDrawingName?.()||'바른 CAD',...(args.window?{window:args.window}:{})});
    if(args.tile)job.tile={paper:args.tile.paper,overlap:args.tile.overlap??10};
    const said=[...(args.paper?[]:['A3 용지']),...(fit?['용지에 맞춘 축척']:[])];
    result={job,paper:args.paper||'A3',denominator:Number(job.denominator.toFixed(3)),tile:args.tile||null,...(said.length?{assumed:[{key:'paper',say:`${said.join(' · ')}로 만들었어요. 용지 크기나 축척(예: 1:100)을 바꾸려면 말해 주세요.`}]}:{})};
   }else if(action==='cad_save_complete'){result=context.completeBridgeSave?.(args.path);if(!result)throw Error('저장 상태를 갱신하지 못했습니다.');applied=true;}
   else if(action==='cad_undo'||action==='cad_redo'){execute({type:action==='cad_redo'?'redo':'undo'});applied=true;result=summary(engine.doc);}
   else throw Error('알 수 없는 CAD 작업');
   const afterRevision=binding.current().revision;
   if(applied)notifyAIChange(context,action,identifier);
   response={id:identifier,target:structuredClone(target),result:{...result,target:structuredClone(target),before_revision:beforeRevision,after_revision:afterRevision,revision:afterRevision,applied}};
   if(action==='cad_execute')try{toast?.('AI/MCP 도면 편집 완료 · 실행 취소 가능');}catch{}
   if(action==='cad_insert_layout')try{toast?.('AI/MCP 배치안 넣기 완료 · 실행 취소 가능');}catch{}
  }catch(error){response={id:identifier,target:target?structuredClone(target):null,error:userErrorMessage(error)};}
  // Request IDs are server issued; keep a bounded replay cache until their deadline.
  completed.set(identifier,{fingerprint,response:structuredClone(response),expiresAt:request?.expires_at||Date.now()});
  return response;
 };
}
/** 건축 요소 명령(카드)을 이름으로 실행·미리보기·설명한다. 실행은 전용 Worker 의 도면 사본에서 하고(await),
 *  적용 직전에 대상·도면이 그대로인지 다시 확인한 뒤 결과 도면을 한 번에 넣는다(되돌리기 한 단계). */
export function createDetailSuggestionRequestHandler(context,binding) {
 return async request=>{
  const target=request.args?.target;
  try{
   if(!Number.isFinite(request.expires_at)||request.expires_at<=Date.now())throw Error('추천 요청 시간이 지났습니다. 다시 요청하세요.');
   binding.assert(target);context.assertAIRequest?.(request);const snapshot=context.engine.doc;
   const suggestions=await context.suggestDetails(request.args?.context || {});
   if(request.expires_at<=Date.now())throw Error('추천 요청 시간이 지났습니다. 다시 요청하세요.');
   binding.assert(target);context.assertAIRequest?.(request);
   if(context.engine.doc!==snapshot)throw Error('추천 중 도면이 변경되었습니다. 다시 요청하세요.');
   return {id:request.id,target,result:{target,before_revision:target.revision,after_revision:target.revision,revision:target.revision,applied:false,
    suggestions:suggestions.map(({id,key,name,source,catalogSource,reason,score})=>({id,key,name,source,catalogSource,reason,score}))}};
  }catch(error){return {id:request.id,target,error:userErrorMessage(error)};}
 };
}
export const COMMAND_ACTIONS=new Set(['cad_run_command','cad_preview_command','cad_describe_command','cad_generate_drawing','cad_push_pull','cad_access_plan','cad_structure_apply','cad_structure_preview','cad_read_foreign_plan','cad_electrical_layout']);
export function createCommandRequestHandler(context,binding,runner=createCommandClient(),{rasterize:renderPng=rasterize}={}){
 const {engine,execute,refresh,toast}=context,completed=new Map();
 const revealExecute=command=>{context.beginAIReveal?.();try{return execute(command);}finally{context.endAIReveal?.();}};
 const summary=doc=>({count:doc.entities.length,bounds:G.bounds(doc.entities),types:doc.entities.reduce((a,e)=>(a[e.type]=(a[e.type]||0)+1,a),{})});
 const storage=()=>{const out={};try{const ls=globalThis.localStorage;for(let i=0;i<(ls?.length||0);i++){const k=ls.key(i);out[k]=ls.getItem(k);}}catch{}return out;};
 return async request=>{
  const target=request?.args?.target,identifier=request?.id,fingerprint=JSON.stringify(request);
  for(const [key,entry] of completed)if(entry.expiresAt<=Date.now())completed.delete(key);
  if(completed.has(identifier)){const previous=completed.get(identifier);if(previous.fingerprint!==fingerprint)return {id:identifier,target,error:'Request identifier was reused with different content'};return structuredClone(previous.response);}
  let response;
  try{
   if(!UUID.test(identifier||'')||!Number.isSafeInteger(request.expires_at)||request.expires_at<=Date.now())throw Error('CAD request is invalid or expired');
   await context.authorizeAIRequest?.(request);binding.assert(target);context.assertAIRequest?.(request);
   const {action,args}=request,beforeRevision=target.revision;
   if(args.expectedRevision!==undefined&&args.expectedRevision!==beforeRevision)throw Error('Expected revision differs from bound target');
   if(action==='cad_electrical_layout'){
    // 조명·전기 배치 + 법령 검토(읽기만) — 계산은 바른 서버(electrical.layout). 도면에 그리려면 cad_run_command ELECLAYOUT
    let k={};try{const r=await fetch('/drawing-knowledge.json',{cache:'no-store'});if(r.ok)k=await r.json();}catch{}
    if(!k.electrical)throw Error('조명·전기 배치 규칙을 읽지 못했습니다(로그인 필요).');
    const {electricalLayout}=await import('./compute-client.js'),res=await electricalLayout(engine.doc,k.standard?.planReading||null,k.electrical,{occupancy:args.occupancy||null,autoFurnish:args.autoFurnish!==false,building:args.building||{}});
    const floors=res.floors.map(f=>({label:f.label,occupancy:f.layout.occupancy,schedule:f.layout.schedule,unresolved:f.layout.unresolved,rooms:f.layout.rooms.map(m=>({name:m.name,use:m.use,area:+m.area.toFixed(2),lights:m.lights.length,lux:m.lux,switches:m.switches.length,outlets:m.outlets.length,furniture:m.furniture,furnitureOutlets:m.outlets.filter(o=>o.for).map(o=>o.for+':'+o.kind),detectors:m.detectors.length}))}));
    response={id:identifier,target:structuredClone(target),result:{floors,review:res.review,...(args.include_engine_input?{engineInput:res.request}:{}),basis:k.electrical.basis,next:res.review.needs.length?'review.needs 를 사용자에게 하나씩 물어 building 에 넣고 다시 부르세요':'도면에 그리려면 cad_run_command name=ELECLAYOUT',target:structuredClone(target),before_revision:beforeRevision,after_revision:beforeRevision,revision:beforeRevision,applied:false}};
    completed.set(identifier,{fingerprint,response:structuredClone(response),expiresAt:request.expires_at});return response;
   }
   if(action==='cad_read_foreign_plan'){
    // 성공 답에도 읽기 영수증(target·판 번호·applied:false)을 붙인다 — 빠지면 다리가 답을 말없이 버려 미리가 10분 기다렸다(2026-10-30)
    // 남의 도면 읽기(읽기만) — 계산은 바른 서버(plan.foreignRead). 도면에 그리려면 cad_run_command FOREIGNREAD
    let reading=null;try{const k=await fetch('/drawing-knowledge.json',{cache:'no-store'});if(k.ok)reading=(await k.json()).standard?.planReading||null;}catch{}
    const {foreignRead}=await import('./compute-client.js'),t0=Date.now(),read=await foreignRead(engine.doc,reading,{fileName:args.fileName||'',wallLayer:args.wallLayer||null}),data=read.data;
    if(!args.include_geometry)for(const f of data.floors){f.walls=f.walls.length;f.outline=f.outline?f.outline.length+' 점':null;f.rooms=f.rooms.map(({points,...r})=>r);}
    response={id:identifier,target:structuredClone(target),result:{...data,ms:Date.now()-t0,layerScores:read.floors.map(f=>({floor:f.label,chosen:f.wallLayer,candidates:f.layerScores})),next:'베끼지 말고 해석해 다시 그립니다(대표 2026-10-30): 읽은 벽 중심선·치수선 숫자·실 이름·층 면적만 가져와 설계 JSON(stories·elements, 실 이름은 한글 use)을 만들고 바로 cad_generate_drawing kind=set 으로 바른 기준대로 한 벌을 그리세요. 벽 두께·창호·마감·글자는 도면 기준대로 새로 정합니다. floors[].balconies(확장 발코니 띠, floorArea 에서 이미 뺌)는 그 층 elements 에 kind:"balcony",story,outline(points) 로 꼭 옮기세요 — 빠지면 방이 덮은 발코니가 바닥면적에 듭니다. 층 바닥면적(floors[].floorArea ㎡)과 원본 개요 면적이 1% 넘게 다르면 중심선을 다시 보고 고치세요. 근거 없는 값(층고 등)은 원본 단면·개요 숫자 → 없으면 보통 값으로 가정하고 evidence·답에 가정이라고 밝히세요.',target:structuredClone(target),before_revision:beforeRevision,after_revision:beforeRevision,revision:beforeRevision,applied:false}};
    completed.set(identifier,{fingerprint,response:structuredClone(response),expiresAt:request.expires_at});return response;
   }
   if(action==='cad_structure_apply'||action==='cad_structure_preview'){
    const preview=action==='cad_structure_preview';
    if(!preview&&args.expectedRevision!==beforeRevision)throw Error('expectedRevision이 필요하며 target revision과 같아야 합니다.');
    if(preview&&!args.record?.drawn)throw Error('미리볼 구조 도면 설정(drawn)이 필요합니다.');
    const snapshot=engine.doc,r=applyStructureSet(snapshot,args.record);
    engine.validate(r.document);
    const assertCurrent=()=>{
     binding.assert(target);
     if(engine.doc!==snapshot)throw Error('구조 도면을 준비하는 동안 도면이 바뀌었습니다. 다시 읽으세요.');
     if(request.expires_at<=Date.now())throw Error('CAD request expired');
    };
    let result;
    if(preview){
     const added=new Set(r.added),doc={...r.document,entities:r.document.entities.filter(e=>added.has(e.id))};
     const win=viewWindow(doc),maxPx=Math.min(VIEW_MAX_PX,Math.max(256,Math.round(Number(args.size)||1200)));
     const png=await renderPng(viewSvg(doc,win,{colorMode:args.colorMode}),win,maxPx);
     assertCurrent();
     result={image:{mimeType:'image/png',data:png.data},width:png.width,height:png.height,window:win,sheets:r.sheets,count:r.added.length};
    }else{
     assertCurrent();
     revealExecute({type:'lisp.apply',document:r.document});
     try{context.setSelectedIds?.(r.added);refresh?.();toast?.(`AI/MCP 구조 ${r.removed?'다시 만들기':'적용'} ${r.added.length}개 · 실행 취소 가능${r.warnings.length?' · '+r.warnings.join(' / '):''}`);}catch{}
     result={setId:args.record.id,added:r.added.length,removed:r.removed,sheets:r.sheets,preserved:r.preserved,warnings:r.warnings,after:summary(engine.doc)};
    }
    const afterRevision=binding.current().revision;
    response={id:identifier,target:structuredClone(target),result:{...result,target:structuredClone(target),before_revision:beforeRevision,after_revision:afterRevision,revision:afterRevision,applied:!preview}};
    completed.set(identifier,{fingerprint,response:structuredClone(response),expiresAt:request.expires_at});return response;
   }
   if(action==='cad_push_pull'){
    if(args.expectedRevision!==beforeRevision)throw Error('expectedRevision이 필요하며 target revision과 같아야 합니다.');
    const snapshot=engine.doc,{pushPullDrawingSet}=await import('./drawing-set-command.js');
    const assertCurrent=()=>{binding.assert(target);context.assertAIRequest?.(request);if(request.expires_at<=Date.now())throw Error('CAD request expired');};
    let stagedCommand=null,stagedSelection=[];
    const r=await pushPullDrawingSet({doc:()=>engine.doc,execute:command=>{stagedCommand=command;},form:context.form,refresh:()=>{},toast:()=>{},setSelected:ids=>{stagedSelection=ids;},assertCurrent,
     regenerateDrawingSet:async(doc,setId,changes)=>{await context.authorizeAIRequest?.(request);const result=await runner.generate(doc,{...args.request,setId,...changes},{signal:context.getAIRequestSignal?.(request)});await context.authorizeAIRequest?.(request);return result;}},
     {setId:args.setId,target:args.element,distance:args.distance,expectedDocument:snapshot});
    if(stagedCommand){await commitAIChange(context,request,assertCurrent,()=>execute(stagedCommand));context.setSelectedIds?.(stagedSelection);refresh?.();}
    const afterRevision=binding.current().revision;
    response={id:identifier,target:structuredClone(target),result:{setId:args.setId,cancelled:!!r.cancelled,added:r.added?.length||0,removed:r.removed||0,after:summary(engine.doc),target:structuredClone(target),before_revision:beforeRevision,after_revision:afterRevision,revision:afterRevision,applied:!r.cancelled}};
    completed.set(identifier,{fingerprint,response:structuredClone(response),expiresAt:request.expires_at});return response;
   }
   if(action==='cad_generate_drawing'||action==='cad_access_plan'){
    // 도면 생성기: 설계 JSON + 도면 기준(브리지가 열쇠 묶음에서 실어 옴) → Worker 에서 그린 뒤 한 번에 적용(실행 취소 한 단계)
    if(!args.request?.standard)throw Error('도면 기준이 필요합니다.');
    const snapshot=engine.doc,r=await runner.generate(snapshot,args.request,{signal:context.getAIRequestSignal?.(request)});
    await context.authorizeAIRequest?.(request);binding.assert(target);context.assertAIRequest?.(request);
    if(request.expires_at<=Date.now())throw Error('요청 시간이 지나 도면에 적용하지 않았습니다. 다시 읽고 실행하세요.');
    if(engine.doc!==snapshot)throw Error('도면을 그리는 동안 도면이 바뀌어 적용하지 않았습니다. 다시 읽고 실행하세요.');
    await commitAIChange(context,request,()=>{binding.assert(target);if(engine.doc!==snapshot)throw Error('도면이 바뀌었습니다.');},()=>execute({type:'lisp.apply',document:r.document}));context.setSelectedIds?.(r.added||[]);refresh?.();
    try{toast?.(`AI/MCP 도면 ${r.removed?'다시 만들기':'생성'} ${r.added.length}개 · 실행 취소 가능`);}catch{}
    const afterRevision=binding.current().revision;
    const checklist=r.checklist||r.plan?.checklist;
    const checklistSummary=Array.isArray(checklist)?{total:checklist.length,done:checklist.filter(x=>x.status==='done').length,na:checklist.filter(x=>x.status==='na').length,missing:checklist.filter(x=>x.status==='missing').map(x=>({id:x.id,story:x.story,label:x.label||x.why||x.id}))}:undefined;
    // 평면 생성 응답은 요약만(단계별 객체 ID·표본 값은 도면 기록 drawingSets 에 남는다) — AI 맥락 낭비 방지
    const generated=Boolean(r.plan?.steps),plan=generated?{scale:r.plan.scale,walls:r.plan.walls,windows:r.plan.windows,doors:r.plan.doors,extent:r.plan.extent,failedChecks:(r.checks||r.plan.checks||[]).filter(c=>c&&c.ok===false).map(c=>({story:c.story,stage:c.stage,kind:c.kind})),evidenceMissing:(r.evidenceChecklist||r.plan.evidenceChecklist||[]).filter(x=>x.status==='missing').map(x=>x.element),storyOffsets:storyOffsets(args.request?.model,r.wallViews)}:r.plan;
    response={id:identifier,target:structuredClone(target),result:{setId:r.setId,added:r.added.length,removed:r.removed,commands:r.commands,sheets:r.sheets,plan,section:r.section,schedule:r.schedule,elevation:r.elevation,recognition:r.recognition,assumed:r.assumed||r.recognition?.assumed||[],checklist:generated?undefined:checklist,checklistSummary,occt:r.occt,after:summary(r.document),target:structuredClone(target),before_revision:beforeRevision,after_revision:afterRevision,revision:afterRevision,applied:true}};
    completed.set(identifier,{fingerprint,response:structuredClone(response),expiresAt:request?.expires_at||Date.now()});
    return response;
   }
   if(typeof args.name!=='string'||!args.name.trim())throw Error('명령 이름(name)이 필요합니다.');
   const inputs=args.inputs&&typeof args.inputs==='object'?args.inputs:{},snapshot=engine.doc,options={activeLayer:context.getActiveLayer?.(),storage:storage(),signal:context.getAIRequestSignal?.(request)};
   let result,applied=false;
   if(action==='cad_run_command'&&['MSL','QQ'].includes(args.name.trim().toUpperCase())&&context.runOutputCommand){
     const assertCurrent=()=>{binding.assert(target);context.assertAIRequest?.(request);if(request.expires_at<=Date.now())throw Error('요청 시간이 지났습니다.');};
     const beforeOutput=async()=>{await context.authorizeAIRequest?.(request);assertCurrent();};
     const commitOutput=apply=>commitAIChange(context,request,assertCurrent,apply);
     const beforeOutputClose=async()=>{if(context.authorizeOutputClose)await context.authorizeOutputClose(request);else await context.authorizeAIRequest?.(request);assertCurrent();};
     assertCurrent();result=await context.runOutputCommand(args.name.trim().toUpperCase(),inputs,{afterDelivery:context.afterBridgeDelivery?fn=>context.afterBridgeDelivery(fn,{requestId:request.id}):undefined,beforeOutput,beforeOutputClose,commitOutput});applied=result.applied===true;
    }
    else if(action==='cad_describe_command')result=await runner.describe(snapshot,args.name,inputs,options);
   else{
    // E2C 처럼 클립보드를 읽는 명령: 일꾼은 클립보드를 못 읽으므로 화면이 미리 읽어 넘긴다(2026-10-27 설명서 시험).
    if(['E2C'].includes(args.name.trim().toUpperCase())){try{options.clipboardText=await (globalThis.cadDesktop?.clipboardText?globalThis.cadDesktop.clipboardText():navigator.clipboard.readText());}catch{}}
    const r=await runner.run(snapshot,args.name,inputs,options);
    result={command:r.command,...(r.followUps?{followUps:{downloads:(r.followUps.downloads||[]).map(d=>d.filename),clipboard:r.followUps.clipboard!=null,run:r.followUps.run||[],storage:Object.keys(r.followUps.storage||{})}}:{}),...(r.assumed?{assumed:r.assumed,recognition:r.recognition}:{}),added:r.added,removed:r.removed,changed:r.changed,messages:r.messages,warnings:r.warnings||[],after:summary(r.document)};
    if(action==='cad_run_command'){
     await context.authorizeAIRequest?.(request);binding.assert(target);context.assertAIRequest?.(request);
     if(request.expires_at<=Date.now())throw Error('요청 시간이 지나 도면에 적용하지 않았습니다. 다시 읽고 실행하세요.');
     if(engine.doc!==snapshot)throw Error('명령을 계산하는 동안 도면이 바뀌어 적용하지 않았습니다. 다시 읽고 실행하세요.');
     await commitAIChange(context,request,()=>{binding.assert(target);if(engine.doc!==snapshot)throw Error('도면이 바뀌었습니다.');},()=>execute({type:'lisp.apply',document:r.document}));context.setSelectedIds?.(r.selection||[]);refresh?.();applied=true;
     // 일꾼이 모아 둔 '화면이 할 일'(파일 내려받기·클립보드·설정 저장·이어서 열 명령 창)을 사람이 직접 실행했을 때처럼 처리한다.
     if(r.followUps)try{const done=await context.applyCommandFollowUps?.(r.followUps);if(done?.failed?.length){result.warnings=[...(result.warnings||[]),...done.failed.map(m=>'후속 처리 실패: '+m)];if(result.followUps)result.followUps.clipboard=false;}}catch(error){result.warnings=[...(result.warnings||[]),'후속 처리 실패: '+(error?.message||error)];}
     try{toast?.(`AI/MCP 명령 ${r.command} 실행 · 실행 취소 가능`);}catch{}
    }
   }
   const afterRevision=binding.current().revision;
   response={id:identifier,target:structuredClone(target),result:{...result,target:structuredClone(target),before_revision:beforeRevision,after_revision:afterRevision,revision:afterRevision,applied}};
  }catch(error){response={id:identifier,target:target?structuredClone(target):null,error:error?.name==='NeedInput'?`${error.message} (what=${error.what})`:userErrorMessage(error)};}
  completed.set(identifier,{fingerprint,response:structuredClone(response),expiresAt:request?.expires_at||Date.now()});
  return response;
 };
}
/** "눈": AI 가 도면 한 영역을 그림(PNG)으로 본다. 출력(plotSVG)과 같은 그리기를 쓰고, 화면 보기·도면은 바꾸지 않는다.
 *  영역: window(도면 mm) > ids(객체 둘레) > scope 'screen'(지금 화면) > 도면 전체. 그림 px → 도면 좌표는 x=minX+px·mmPerPixel, y=maxY−py·mmPerPixel. */
export const VIEW_ACTION='cad_view_drawing';
export const PAD_SKETCH_ACTION='cad_get_pad_sketch';
export const VIEW_MAX_PX=2048;
export function viewWindow(doc,{window,ids,scope}={},screenWindow=null){
 let b;
 // cad_get_document 의 window 는 {x0,y0,x1,y1} 이라 AI 가 그 형식을 그대로 넘겨 NaN → '볼 영역이 없습니다'가 났다(10/12 기록 9건). 둘 다 받는다.
 if(window){const x=[+(window.minX??window.x0),+(window.maxX??window.x1)],y=[+(window.minY??window.y0),+(window.maxY??window.y1)];b={minX:Math.min(...x),minY:Math.min(...y),maxX:Math.max(...x),maxY:Math.max(...y)};}
 else if(Array.isArray(ids)&&ids.length){const want=new Set(ids),es=doc.entities.filter(e=>want.has(e.id));if(es.length!==want.size)throw Error('없는 객체 ID가 있습니다. cad_get_document 의 ID를 쓰세요.');b=G.bounds(es);}
 else if(scope==='screen'){if(!(screenWindow?.maxX>screenWindow?.minX&&screenWindow?.maxY>screenWindow?.minY))throw Error('지금 화면 크기를 읽지 못했습니다(CAD 창이 숨겨져 있거나 최소화됨). window 나 ids 로 영역을 주세요.');b=screenWindow;}
 else{if(!doc.entities.length)throw Error('도면이 비어 있어 볼 것이 없습니다.');b=G.bounds(doc.entities.filter(e=>{const x=G.bounds([e]);return x&&[x.minX,x.minY,x.maxX,x.maxY].every(Number.isFinite);}));}  // 좌표가 깨진 객체 하나가 전체 범위를 NaN 으로 만들지 않게
 if(!b||!['minX','minY','maxX','maxY'].every(k=>Number.isFinite(b[k]))||b.maxX<b.minX||b.maxY<b.minY)throw Error(window?'볼 영역 값이 잘못됐습니다. window 는 {minX,minY,maxX,maxY}(또는 x0,y0,x1,y1) 숫자(mm)로 주세요.':'볼 영역이 없습니다(좌표가 올바른 객체가 없음).');
 // 객체 둘레·전체는 3% 여유를 두고, 점·직선처럼 납작하면 최소 폭을 준다.
 const pad=window?0:Math.max(b.maxX-b.minX,b.maxY-b.minY)*0.03,w=Math.max(b.maxX-b.minX+2*pad,1),h=Math.max(b.maxY-b.minY+2*pad,1),cx=(b.minX+b.maxX)/2,cy=(b.minY+b.maxY)/2;
 return {minX:cx-w/2,minY:cy-h/2,maxX:cx+w/2,maxY:cy+h/2};
}
/** 영역에 꼭 맞게 자른 출력 SVG(용지 여백 없음). */
export function viewSvg(doc,win,{colorMode='auto'}={}){   // colorMode: 출력 창과 같은 규칙(auto·mono 흑백·gray 회색조·color)
 const portrait=win.maxY-win.minY>win.maxX-win.minX,svg=plotSVG(doc,{fit:true,window:win,paper:'A3',orientation:portrait?'portrait':'landscape',title:'AI 보기',colorMode:['auto','mono','gray','color'].includes(colorMode)?colorMode:'auto'});
 const [pw,ph]=/viewBox="0 0 ([\d.e+-]+) ([\d.e+-]+)"/.exec(svg).slice(1).map(Number),den=Math.max((win.maxX-win.minX)/pw,(win.maxY-win.minY)/ph),cw=(win.maxX-win.minX)/den,ch=(win.maxY-win.minY)/den;
 return svg.replace(/width="[^"]+" height="[^"]+" viewBox="[^"]+"/,`width="${cw}mm" height="${ch}mm" viewBox="${(pw-cw)/2} ${(ph-ch)/2} ${cw} ${ch}"`);
}
async function rasterize(svg,win,maxPx){
 const aspect=(win.maxY-win.minY)/(win.maxX-win.minX),width=Math.round(aspect>1?maxPx/aspect:maxPx),height=Math.round(aspect>1?maxPx:maxPx*aspect);
 const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
 try{
  const img=new Image();img.src=url;await img.decode();
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,width);canvas.height=Math.max(1,height);
  const c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,canvas.width,canvas.height);c.drawImage(img,0,0,canvas.width,canvas.height);
  return {data:canvas.toDataURL('image/png').split(',')[1],width:canvas.width,height:canvas.height};
 }finally{URL.revokeObjectURL(url);}
}
export function createViewRequestHandler(context,binding){
 const {engine}=context;
 return async request=>{
  const target=request?.args?.target,identifier=request?.id;
  try{
   if(!UUID.test(identifier||'')||!Number.isSafeInteger(request.expires_at)||request.expires_at<=Date.now())throw Error('CAD request is invalid or expired');
   binding.assert(target);context.assertAIRequest?.(request);
   const args=request.args||{},before=target.revision,maxPx=Math.min(VIEW_MAX_PX,Math.max(256,Math.round(Number(args.size)||1024)));
   const win=viewWindow(engine.doc,args,context.getViewWindow?.());
   const png=await rasterize(viewSvg(engine.doc,win,{colorMode:args.colorMode}),win,maxPx);
   const after=binding.current().revision;
   return {id:identifier,target:structuredClone(target),result:{window:win,mmPerPixel:(win.maxX-win.minX)/png.width,width:png.width,height:png.height,image:{mimeType:'image/png',data:png.data},
    target:structuredClone(target),before_revision:before,after_revision:after,revision:after,applied:false}};
  }catch(error){return {id:identifier,target:target?structuredClone(target):null,error:userErrorMessage(error)};}
 };
}
/** 현장 기록 핀으로 보기만 이동한다. 도면 본문·수정 이력은 건드리지 않는다. */
export function createFieldRecordsAuthorizeHandler(context,binding){
 return async request=>{
  const target=request?.args?.target,id=request?.id;
  try{
   const assertCurrent=()=>{if(!UUID.test(id||'')||!Number.isSafeInteger(request.expires_at)||request.expires_at<=Date.now())throw Error('요청 시간이 지났습니다. 다시 요청하세요.');binding.assert(target);context.assertAIRequest?.(request);};
   assertCurrent();
   if(typeof context.authorizeAIRequest!=='function')throw Error('현장 기록 변경 권한을 확인할 수 없습니다.');
   await context.authorizeAIRequest(request);assertCurrent();
   return {id,target:structuredClone(target),result:{authorized:true,applied:false,target:structuredClone(target),before_revision:target.revision,after_revision:target.revision,revision:target.revision}};
  }catch(error){return {id,target:target?structuredClone(target):null,error:userErrorMessage(error)};}
 };
}

export function createFieldRecordsLocateHandler(context,binding){
 return async request=>{
  const target=request?.args?.target,identifier=request?.id;
  try{
   const assertCurrent=()=>{
    if(!UUID.test(identifier||'')||!Number.isSafeInteger(request.expires_at)||request.expires_at<=Date.now())throw Error('요청 시간이 지났습니다. 다시 요청하세요.');
    binding.assert(target);context.assertAIRequest?.(request);
   };
   assertCurrent();
   const record=request.args?.record,at=record?.at;
   if(!at||!Number.isFinite(at.x)||!Number.isFinite(at.y))throw Error('저장된 핀 위치를 찾을 수 없습니다.');
   if(typeof context.focusFieldRecord!=='function')throw Error('현장 핀을 보여 줄 도면 화면을 찾을 수 없습니다.');
   await context.authorizeAIRequest?.(request);assertCurrent();
   context.focusFieldRecord(record);
   const revision=binding.current().revision;
   return {id:identifier,target:structuredClone(target),result:{located:true,record,applied:false,target:structuredClone(target),before_revision:target.revision,after_revision:revision,revision}};
  }catch(error){return {id:identifier,target:target?structuredClone(target):null,error:userErrorMessage(error)};}
 };
}

/** 원획만 검정 잉크로 읽는다. 도면 순회/편집/현재 보기 변경 없이 요청 때만 PNG를 만든다. */
export function createPadSketchRequestHandler(context,binding){
 return async request=>{
  const target=request?.args?.target,identifier=request?.id;
  try{
   if(!UUID.test(identifier||'')||!Number.isSafeInteger(request.expires_at)||request.expires_at<=Date.now())throw Error('CAD request is invalid or expired');
   binding.assert(target);context.assertAIRequest?.(request);
   const args=request.args||{},entries=context.getPadSketches?.()||[];
   const sketches=entries.map(({strokes,...entry})=>({...entry,strokeCount:strokes.length,bounds:padSketchBounds(strokes)}));
   const selected=args.sketch_id===undefined?entries[0]:entries.find(e=>e.id===args.sketch_id);
   if(args.sketch_id!==undefined&&!selected)throw Error('패드 스케치가 없거나 지워졌습니다. 최근 목록을 다시 읽으세요.');
   let imageResult={};
   if(args.include_image!==false&&selected){
    const plan=padSketchPngPlan(selected.strokes,args.size),canvas=document.createElement('canvas');canvas.width=plan.width;canvas.height=plan.height;
    const c=canvas.getContext('2d');if(!c)throw Error('스케치 그림을 만들지 못했습니다.');
    c.fillStyle='#fff';c.fillRect(0,0,plan.width,plan.height);c.strokeStyle='#111';c.fillStyle='#111';c.lineWidth=2.5;c.lineCap='round';c.lineJoin='round';
    const pixel=p=>({x:(p.x-plan.window.minX)/plan.mmPerPixel,y:(plan.window.maxY-p.y)/plan.mmPerPixel});
    for(const path of selected.strokes){
     if(!path.length)continue;const first=pixel(path[0]);
     if(path.length===1){c.beginPath();c.arc(first.x,first.y,c.lineWidth/2,0,2*Math.PI);c.fill();continue;}
     c.beginPath();c.moveTo(first.x,first.y);for(let i=1;i<path.length;i++){const p=pixel(path[i]);c.lineTo(p.x,p.y);}c.stroke();
    }
    imageResult={...plan,image:{mimeType:'image/png',data:canvas.toDataURL('image/png').split(',')[1]}};
   }
   binding.assert(target);context.assertAIRequest?.(request);
   const after=binding.current().revision;
   return {id:identifier,target:structuredClone(target),result:{sketches,sketch_id:selected?.id||null,...imageResult,
    guide:'원획은 사용자 메모이며 편집 명령이 아닙니다. 뜻을 읽고 기존 cad_execute/cad_run_command 도구로 반영하세요. 픽셀→도면 mm: x=minX+px*mmPerPixel, y=maxY-py*mmPerPixel. 최근 10개 그룹·그룹당 128획, 현재 도면 메모리만 사용하며 표시 지우기/연결 종료/도면 전환 시 사라집니다.',
    target:structuredClone(target),before_revision:target.revision,after_revision:after,revision:after,applied:false}};
  }catch(error){return {id:identifier,target:target?structuredClone(target):null,error:userErrorMessage(error)};}
 };
}
// 창(편집 세션) 단위 일: 열기는 데스크톱 main 이 새 도면 창으로 열고, 엔진(bridge.py)이 그 창이 붙을 때까지 기다린다.
// 닫기는 결과가 엔진에 닿은 뒤에(after) 실제로 닫는다 — 먼저 닫으면 결과를 못 보내 AI 가 시간 초과를 받는다.
export const SESSION_ACTIONS=new Set(['cad_open_file','cad_close_document','cad_reveal']);
export function createSessionRequestHandler(context,desktop=()=>globalThis.window?.cadDesktop){
 return async request=>{
  const identifier=request?.id;
  try{
   if(!UUID.test(identifier||'')||!Number.isSafeInteger(request.expires_at)||request.expires_at<=Date.now())throw Error('CAD request is invalid or expired');
   const args=request.args||{};context.assertAIRequest?.(request);
   if(request.action==='cad_reveal'){
    // 그리기 전에 이 칸이 다른 칸 뒤에 있으면 앞으로 꺼낸다(bridge.dispatch). 3초 안에 안 보이면(창 최소화 등) 그대로 알린다.
    const self=context.windowSelf?.();if(globalThis.document?.hidden&&self)desktop()?.selectWindow?.(self);
    if(globalThis.document?.hidden)await new Promise(done=>{const seen=()=>{if(!document.hidden)finish();},finish=()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',seen);done();},timer=setTimeout(finish,3000);document.addEventListener('visibilitychange',seen);});
    return {response:{id:identifier,target:null,result:{visible:!globalThis.document?.hidden}}};
   }
   if(request.action==='cad_open_file'){
    const open=desktop()?.openInNewWindows;
    if(!open)throw Error('파일 열기는 도면 창마다 프로세스로 실행한 데스크톱 앱에서만 됩니다.');
    if(typeof args.path!=='string'||!args.path)throw Error('열 파일 경로가 없습니다.');
    // main 의 열기 줄은 다른 창들의 상태를 묻느라 오래 걸릴 수 있다 — 기다리지 않고, 실패는 화면에 알린다.
    open([args.path]).catch(error=>context.toast?.('AI/MCP 도면 열기 실패: '+userErrorMessage(error),true));
    return {response:{id:identifier,target:null,result:{requested:true}}};
   }
   if(request.action!=='cad_close_document')throw Error('알 수 없는 창 작업');
   const {result,after}=context.closeDrawingForBridge({allowAI:args.app_ai===true});
   return {response:{id:identifier,target:null,result},after};
  }catch(error){return {response:{id:identifier,target:null,error:userErrorMessage(error)}};}
 };
}
export const REVIEW_ACTIONS=new Set(['cad_view_3d','cad_export_glb','cad_sun_study','cad_view_interior','cad_wind_check']);
export function createReviewRequestHandler(context,binding,load=()=>import('./review-3d.js')){
 return async request=>{
  const target=request?.args?.target,identifier=request?.id;
  try{
   if(!UUID.test(identifier||'')||!Number.isSafeInteger(request.expires_at)||request.expires_at<=Date.now())throw Error('CAD request is invalid or expired');
   binding.assert(target);context.assertAIRequest?.(request);
   const snapshot=context.engine.doc,args=request.args||{},module=await load();
   binding.assert(target);context.assertAIRequest?.(request);if(context.engine.doc!==snapshot)throw Error('3D를 준비하는 동안 도면이 바뀌었습니다. 다시 읽으세요.');
   const options={inferLayerWalls:context.inferLayerWalls,...(args.setId!==undefined?{setId:args.setId}:{})};let result;
   if(request.action==='cad_view_3d')result=await module.renderReview3D(snapshot,{...options,view:args.view??'iso-se',size:args.size??900,...(args.floors!==undefined?{floors:args.floors}:{})});
   else if(request.action==='cad_sun_study'){
    // 이웃 필지별 동지 일조(일조 보고서): 한 벌 설계의 model.site.neighbors(설계 mm) — 3D 도 같은 설계 좌표
    // 일조 보고서는 지적 이웃 필지를 설계 mm 로 바꿔 args.neighbors 로 준다
    const sets=snapshot.drawingSets||{},given=Array.isArray(args.neighbors)&&args.neighbors.length?args.neighbors:null;
    const rec=args.setId!==undefined?sets[args.setId]:Object.values(sets).filter(s=>given?['set','all'].includes(s?.kind)&&s?.model:s?.model?.site?.neighbors?.length).at(-1);
    result=await module.renderSunStudy(snapshot,{...options,...(args.setId===undefined&&rec&&options.setId===undefined?{setId:Object.keys(sets).find(k=>sets[k]===rec)}:{}),neighbors:given||rec?.model?.site?.neighbors||[],day:args.day,time:args.time,grid:args.grid,view:args.view,size:args.size});
   }
   else if(request.action==='cad_view_interior')result=await module.renderInterior(snapshot,{...options,x:args.x,y:args.y,floor:args.floor,heading:args.heading,pitch:args.pitch,fov:args.fov,size:args.size,day:args.day,time:args.time});
   else if(request.action==='cad_wind_check')result=await module.renderWindCheck(snapshot,{...options,region:args.region,basicWindSpeed:args.basicWindSpeed,terrain:args.terrain,importance:args.importance,height:args.height,directions:args.directions,direction:args.direction,gust:args.gust,size:args.size});
   else if(request.action==='cad_export_glb'){
    const bytes=new Uint8Array(await module.exportReviewGLB(snapshot,options));let binary='';
    for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    result={data:btoa(binary),mimeType:'model/gltf-binary',size:bytes.length};
   }else throw Error('알 수 없는 3D 작업');
   // Do not return a stale render or export after asynchronous work/tab changes.
   binding.assert(target);context.assertAIRequest?.(request);if(context.engine.doc!==snapshot)throw Error('3D를 만드는 동안 도면이 바뀌었습니다. 다시 읽으세요.');
   if(request.expires_at<=Date.now())throw Error('CAD request expired');
   return {id:identifier,target:structuredClone(target),result:{...result,target:structuredClone(target),before_revision:target.revision,after_revision:target.revision,revision:target.revision,applied:false}};
  }catch(error){return {id:identifier,target:target?structuredClone(target):null,error:userErrorMessage(error)};}
 };
}
// 조회 결과만 복사한다. 블록 자식·보존 원문·큰 속성 때문에 부분 조회가 전체 JSON이 되지 않게 상한을 둔다.
export function createDocumentRequestHandler(context,binding){
 return request=>{
  const target=request?.args?.target,identifier=request?.id;
  try{
   if(!UUID.test(identifier||'')||!Number.isSafeInteger(request.expires_at)||request.expires_at<=Date.now())throw Error('CAD request is invalid or expired');
   binding.assert(target);context.assertAIRequest?.(request);
   const args=request.args||{},mode=args.mode??'summary',limit=args.limit??200,window=args.window;
   if(!['summary','window','selection'].includes(mode))throw Error('mode는 summary·window·selection 중 하나입니다.');
   if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('limit은 1~1000 정수입니다.');
   if(mode==='window'){
    if(!window||Object.keys(window).length!==4||!['x0','y0','x1','y1'].every(k=>Number.isFinite(window[k]))||window.x0>window.x1||window.y0>window.y1)throw Error('window는 유한한 x0,y0,x1,y1과 정방향 범위가 필요합니다.');
   }else if(window!==undefined)throw Error('window는 mode=window에서만 씁니다.');
   if(args.ids!==undefined&&(mode!=='selection'||!Array.isArray(args.ids)||args.ids.length>1000||args.ids.some(id=>typeof id!=='string'||!id)))throw Error('ids는 mode=selection의 1000개 이하 객체 ID 배열입니다.');
   const doc=context.engine.doc,selected=context.selected(),large=documentWeight(doc,MAX_BRIDGE_ENTITIES+1)>MAX_BRIDGE_ENTITIES;
   G.ensureSharedDrawingReferenceBounds(doc);
   const capabilities={target_binding:1,document_query:true,editing:!large},message=large?'대형 도면은 조회 전용입니다. mode=window(영역) 또는 mode=selection(선택·ID)으로 좁혀 읽으세요. 블록 자식은 펼치지 않습니다.':undefined;
   let result;
   if(mode==='summary'){
    const layers=new Map(),types=new Map();
    for(const e of doc.entities){layers.set(e.layer,(layers.get(e.layer)||0)+1);types.set(e.type,(types.get(e.type)||0)+1);}
    const names=new Map(doc.layers.map(l=>[l.id,l.name])),blocks=new Set((doc.blocks||[]).map(b=>b.name));
    for(const name of Object.keys(doc.sharedBlocks||{}))blocks.add(name);
    result={summary:{entityCount:doc.entities.length,layers:[...layers].map(([id,count])=>({id,name:names.get(id)||id,count})),types:Object.fromEntries(types),extents:G.bounds(doc.entities),blockDefinitionCount:blocks.size,selectedCount:selected.size??selected.length}};
   }else{
    const wanted=mode==='selection'?new Set(args.ids??selected):null,found=new Set(),entities=[],layers=new Set();let matched=0,truncated=false,values=20000,chars=100000;
    const copy=(value,depth=0)=>{
     if(--values<0||depth>16)throw Error('query size');
     if(typeof value==='string'){chars-=value.length;if(chars<0)throw Error('query size');return value;}
     if(!value||typeof value!=='object')return value;
     if(Array.isArray(value)){const out=[];for(const child of value)out.push(copy(child,depth+1));return out;}
     const out={};for(const key in value)if(Object.hasOwn(value,key)){chars-=key.length;if(chars<0)throw Error('query size');out[key]=copy(value[key],depth+1);}return out;
    };
    for(const e of doc.entities){
     if(wanted&&!wanted.has(e.id))continue;
     const bounds=G.bounds([e]);
     if(window&&(!bounds||bounds.minX<window.x0||bounds.minY<window.y0||bounds.maxX>window.x1||bounds.maxY>window.y1))continue;
     matched++;if(wanted)found.add(e.id);if(entities.length>=limit){truncated=true;continue;}
     let entity;
     try{
      if(e.type==='block'){
       const {entities:children,...rest}=e;entity={...copy(rest),bounds,childCount:children?.length||0,detailsOmitted:true};
      }else if(e.type==='image'){
       const {data,...rest}=e;entity={...copy(rest),hasData:!!data};
      }else entity=copy(e);
     }catch{entity={id:e.id,type:e.type,layer:e.layer,bounds,detailsOmitted:true};truncated=true;}
     entities.push(entity);layers.add(e.layer);
    }
    result={document:{units:doc.units||'mm',entities,layers:doc.layers.filter(l=>layers.has(l.id)).map(l=>({id:l.id,name:l.name}))},matched_count:matched,count:entities.length,limit,truncated,missing_ids:args.ids?.filter(id=>!found.has(id))||[]};
   }
   return {id:identifier,target,result:{...result,...(args.include_command_settings?{commandSettings:context.getCommandSettings()}:{}),mode,documentOmitted:large,capabilities,...(message?{message}:{}),target,before_revision:target.revision,after_revision:target.revision,revision:target.revision,applied:false}};
  }catch(error){return {id:identifier,target:target??null,error:userErrorMessage(error)};}
 };
}
function bridgeDocument(value){
 if(!value||typeof value!=='object')return value;
 if(Array.isArray(value))return value.map(bridgeDocument);
 const image=value.type==='image',out={};
 for(const key of Object.keys(value))if(!image||key!=='data')out[key]=bridgeDocument(value[key]);
 if(image)out.hasData=!!(value.data||value.hasData);
 return out;
}
// 층마다 설계 좌표 → 도면 좌표 이동량(시트 배치 뒤). 원본 사진 밑그림 align 의 drawingPoints = 설계 좌표 + 이 값
export function storyOffsets(model,views){
 const storyOf=new Map((model?.elements||[]).filter(e=>e.kind==='wall').map(w=>[w.id,w.story])),out={};
 for(const v of views||[])for(const id of v.wallIds||[]){const s=storyOf.get(id);if(s&&!out[s])out[s]=v.origin;}
 return out;
}
export function connectBridge(studio){
 const {engine,execute,selected,refresh,toast}=studio.context;
 let last=-1,lastMetadata='',results=[],stopped=false,lastSentAt=-1,freshLaunch=!!studio.context.startedFresh?.()&&!/[?&]docSlot=([2-9]|\d\d)/.test(globalThis.location?.search||''),recoveryWarned=false,largeSentRevision=-1,largeSentAt=-1,largeBusy=false;
 const binding=createBridgeBinding(studio.context),client=binding.editorSession,handleRequest=createBoundRequestHandler(studio.context,binding);
 const appInFlight=new Map();let reconnecting=false;
 let aiToolsActive=0;studio.context.aiToolRunning=()=>aiToolsActive>0;   // 미리 도구가 이 칸에서 지금 도는 중(그 도구가 도면을 바꿔도 미리 대화를 끊지 않게, chat.js)
 const workBand=ensureAIWorkBand(studio);
 studio.context.getBridgeSession=()=>client;
 studio.context.authorizeAIRequest=async request=>{await studio.api('chat',{action:'validateTool',requestId:request.id,recipient:client});};
 studio.context.authorizeOutputClose=async request=>{await studio.api('chat',{action:'validateOutputClose',requestId:request.id,recipient:client});};
 let handleAppAI=null,consentShown=false;
 let handleLisp=null,handleCommand=null,handleView=null,handlePadSketch=null,handleFieldLocate=null,handleReview=null,handleSession=null,afterDelivery=[];
 studio.context.afterBridgeDelivery=(fn,{requestId}={})=>{const after=delivery=>{Promise.resolve().then(()=>fn(delivery)).catch(error=>toast?.(userErrorMessage(error),true));};after.requestId=requestId;afterDelivery.push(after);};
 async function loop(){
  try{
   const identity=binding.current(),revision=identity.revision;
   const payload={client,...(binding.supported?identity:{}),revision,selected:[...selected()],active:document.hasFocus(),visible:!document.hidden,folder:studio.context.getDrawingFolder?.()??studio.getFolder(),drawingPath:studio.context.getDrawingPath?.()||'',drawingName:studio.context.getDrawingName?.()||'',draftKey:studio.context.getDrawingId?.()||'',commandSettings:studio.context.getCommandSettings(),results,dirty:!!(studio.context.isDrawingDirty?.()??studio.context.hasDrawingWorkspace?.())};
   if(freshLaunch){payload.freshLaunch=true;}
   const metadata=JSON.stringify([payload.folder,payload.commandSettings]);
   // 블록 안 객체까지 센다: 최상위 4만이라도 블록 안 17만인 도면을 편집마다 통째로 JSON 으로 보내면 1초 넘게 멈춘다.
   const weight=documentWeight(engine.doc,MAX_BRIDGE_ENTITIES+1);
   // AI 편집 결과를 돌려줄 때는 편집 후 본문도 바로 보낸다: 다리가 그 본문에 묶인 새 target 을 결과에 넣으려고 기다린다(1.5초 간격만큼 늦어지지 않게).
   const plan=documentSendPlan({changed:last!==revision||lastMetadata!==metadata,count:weight,now:Date.now(),lastSentAt,forced:last===-1||(last!==revision&&results.some(r=>r?.result?.applied))});
   if(plan.send==='document'){payload.document=bridgeDocument(engine.doc);if(binding.supported)payload.document_revision=revision;last=revision;lastMetadata=metadata;lastSentAt=Date.now();}
   else if(plan.send==='omitted'){payload.documentOmitted=true;payload.entityCount=engine.doc.entities.length;if(binding.supported)payload.document_revision=revision;last=revision;lastMetadata=metadata;}
   const delivering=afterDelivery;afterDelivery=[];const deliveringResults=results;results=[];payload.results=deliveringResults;let r;
   try{r=await studio.api('bridge',payload);}catch(error){results=[...deliveringResults,...results];afterDelivery=[...delivering,...afterDelivery];throw error;}
   freshLaunch=false;binding.receive(r);
   // 바깥 AI 첫 연결 허락 창(ai_consent.py). 목록이 비면 떠 있던 창을 닫는다.
   if(r.aiConsent||consentShown)consentShown=showConsentRequests(r.aiConsent||[],{api:studio.api.bind(studio),toast})>0;
   workBand.consume(r.toolEvents,r.toolActiveIds);
   if(reconnecting){reconnecting=false;last=-1;toast?.('AI 편집 창 연결이 복구되었습니다.');}
   for(const after of delivering)try{after({rejected:!!after.requestId&&!!r.rejected_results?.includes(after.requestId)});}catch{}
   // S2/S6: 대용량 도면도 복구본을 남긴다 — 문서를 줄 단위 스트림으로 보내고 엔진은 그대로 파일에 쓴다(메모리에 올리지 않는다).
   const large=largeRecoveryPlan({count:weight,revision,sentRevision:largeSentRevision,now:Date.now(),lastSentAt:largeSentAt,dirty:payload.dirty,lowMem:isLowMemDetected(),quiet:!studio.context.recoveryInputActive?.(),commandIdle:studio.context.isCommandIdle?.()??true});
   if(large.send&&!largeBusy){largeBusy=true;const sending=revision;studio.api('recovery',{client,largeRecovery:true,folder:payload.folder,commandSettings:payload.commandSettings,dirty:true,drawingName:payload.drawingName,drawingPath:payload.drawingPath,document:engine.doc}).then(()=>{largeSentRevision=sending;largeSentAt=Date.now();}).catch(e=>{if(!recoveryWarned){recoveryWarned=true;toast('대용량 복구본 저장 실패: '+userErrorMessage(e),true);}}).finally(()=>{largeBusy=false;});}
   if(r.needDocument)last=-1;
   if(r.recoveryError&&!recoveryWarned){recoveryWarned=true;toast(r.recoveryError,true);}
   for(const [id,expires] of appInFlight)if(expires<=Date.now())appInFlight.delete(id);
   for(const request of r.requests||[]){
    if(appInFlight.has(request.id))continue;
    if(appInFlight.size>=512)continue;
    appInFlight.set(request.id,request.expires_at||Date.now()+600_000);
    // commandJob/3D/file dialogs continue independently; the 300ms pulse must
    // remain alive so the original window can receive completion and reconnect.
    aiToolsActive++;
    (async()=>{
     try{
      if(['cad_ui_command','cad_lisp_save','cad_confirm_write'].includes(request?.action)){
       handleAppAI||=(await import('./app-ai-tools.js')).createAppAIRequestHandler(studio.context,binding,{api:studio.api.bind(studio)});
       const response=await handleAppAI(request);results.push(response);return;
      }
      await studio.context.authorizeAIRequest(request);
      if(SESSION_ACTIONS.has(request?.action)){
       const {response,after}=await (handleSession||=createSessionRequestHandler(studio.context))(request);
       results.push(response);if(after)afterDelivery.push(after);return;
      }
      if(request?.action==='cad_get_document'){results.push(createDocumentRequestHandler(studio.context,binding)(request));return;}
      // await 를 먼저 끝내고 넣는다: results.push(await …) 는 기다리기 전의 배열을 잡아서, 그사이 펄스가 그 배열을 보내 버리면
      // 느린 명령(도면 세트 등)의 결과가 사라지고 다리가 10분 뒤 응답 시간 초과를 낸다.
      const response=['cad_lisp_run','cad_lisp_load'].includes(request?.action)?await (handleLisp||=(await import('./mcp-lisp.js')).createLispRequestHandler(studio.context,binding,{api:studio.api.bind(studio)}))(request):COMMAND_ACTIONS.has(request?.action)?await (handleCommand||=createCommandRequestHandler(studio.context,binding))(request):request?.action==='cad_suggest_details'?await createDetailSuggestionRequestHandler(studio.context,binding)(request):request?.action===VIEW_ACTION?await (handleView||=createViewRequestHandler(studio.context,binding))(request):request?.action===PAD_SKETCH_ACTION?await (handlePadSketch||=createPadSketchRequestHandler(studio.context,binding))(request):request?.action==='cad_field_records_authorize'?await createFieldRecordsAuthorizeHandler(studio.context,binding)(request):request?.action==='cad_field_records_locate'?await (handleFieldLocate||=createFieldRecordsLocateHandler(studio.context,binding))(request):REVIEW_ACTIONS.has(request?.action)?await (handleReview||=createReviewRequestHandler(studio.context,binding))(request):await prepareComputeRequest(studio.context,binding,request).then(prepared=>commitAIChange(studio.context,request,()=>binding.assert(request.args?.target),()=>handleRequest(request,prepared)));
      results.push(response);
     }catch(error){results.push({id:request.id,target:request.args?.target??null,error:userErrorMessage(error)});}
     finally{aiToolsActive--;if(binding.current().revision!==request.args?.target?.revision)last=-1;}
    })();
   }
  }catch(e){last=-1;if(!reconnecting){workBand.reset();reconnecting=true;toast?.('AI 편집 창에 다시 연결 중입니다. 몇 초 뒤 다시 시도하세요.',true);}}
  if(!stopped)setTimeout(loop,300);
 }
 async function start(){
  // 정상 종료 뒤 새로 켠 것이면 지난 도면을 자동으로 열지 않는다(RECOVER 로 되살릴 수 있다).
  // 복구 갈래가 셋이라 이 자리도 같은 기준을 따라야 한다. 여기만 빠져서 새 도면인데 내용이 남았다.
  try{if(!studio.context.startedFresh?.()&&!engine.doc.entities.length&&!studio.context.hasDrawingWorkspace?.()){const saved=await studio.api('restore',{});if(saved.document){execute({type:'load',document:saved.document});engine.undoStack=[];engine.redoStack=[];if(saved.commandSettings)studio.context.restoreCommandSettings(saved.commandSettings);if(saved.folder)await studio.projectOpen(saved.folder);refresh();studio.context.fit();toast(saved.recoveryWarning||'로컬 앱 복구 도면과 명령 설정을 불러왔습니다.',Boolean(saved.recoveryWarning));}}}catch(e){toast('로컬 복구 확인: '+userErrorMessage(e),true);}
  loop();
 }
 start();window.addEventListener('pagehide',()=>{stopped=true;workBand.destroy();});return {getRevision:()=>binding.current().revision};
}
