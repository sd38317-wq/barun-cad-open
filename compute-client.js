// 계산 핵심(구조 평면 읽기·구조 계산서·평면 인식·창호 계획·계획 품질)은 바른 서버에서 한다(사장님 2026-10-21).
// 화면은 여기로 요청을 보내고 결과만 쓴다. 길: 화면 → 이 PC 엔진(/api/compute, [계정 연결] 토큰) → 바른 서버(/api/public/cad-compute).
// 계산 코드는 설치본에 없다(compute/ 폴더는 서버 묶음으로만 간다). 이 파일은 보낼 자료를 고르고 받은 결과를 맞추기만 한다.
import * as G from './geometry.js';
import {isPlanBox} from './planset-shared.js';

export const COMPUTE_LOGIN_GUIDE='로그인 필요 · 오른쪽 위 [계정 연결]에서 카카오(또는 구글)로 로그인하면 평면 인식·창호 계획·구조 계산서·배치 품질 검사를 쓸 수 있습니다(무료).';

export class ComputeError extends Error{
 constructor(message,code='offline'){super(message);this.name='ComputeError';this.code=code;}
}

let transport=null;
/** 시험(가짜 서버)·Worker(화면에 대신 묻기)가 길을 바꾼다. 앞의 길을 돌려준다. */
export function setComputeTransport(fn){const previous=transport;transport=fn||null;return previous;}

async function engineToken(signal){
 let status;
 try{const response=await fetch('/api/status',{cache:'no-store',signal});if(!response.ok)throw Error();status=await response.json();}
 catch(error){if(error?.name==='AbortError')throw error;throw new ComputeError('CAD 엔진에 연결하지 못했습니다. 잠시 후 다시 시도하세요.');}
 if(typeof status?.token==='string'&&status.token)return status.token;
 const desktop=globalThis.window?.cadDesktop;
 if(status?.tokenPolicy==='desktop'&&typeof desktop?.engineToken==='function')return await desktop.engineToken();
 throw new ComputeError('CAD 엔진 연결을 확인하세요. 이 작업은 CAD 화면에서 다시 실행하세요.');
}

async function hostTransport(action,input,{signal}={}){
 const token=await engineToken(signal);let response,body=null;
 try{response=await fetch('/api/compute',{method:'POST',headers:{'Content-Type':'application/json','X-CAD-Token':token},body:JSON.stringify({action,input}),signal,cache:'no-store'});}
 catch(error){if(error?.name==='AbortError')throw error;throw new ComputeError('CAD 엔진에 연결하지 못했습니다. 잠시 후 다시 시도하세요.');}
 try{body=await response.json();}catch{}
 if(!response.ok||body?.state!=='ok')throw new ComputeError(body?.error||'바른 서버 계산에 실패했습니다. 잠시 후 다시 시도하세요.',body?.code||'offline');
 return body.result;
}

/** 서버 계산 한 번. 실패하면 ComputeError(code: not_logged_in·limit·bad_input·too_large·cannot_compute·busy·offline). */
export function compute(action,input,options={}){return (transport||hostTransport)(action,input,options);}

// 벽 찾기는 선·폴리선·사각형·치수만 읽는다. 그 객체의 읽는 칸만 보내 큰 도면도 가볍게 한다.
// ID 가 없는 객체는 벽 찾기가 순번을 ID 로 쓰므로 원래 순번을 ID 로 넣는다.
const WALL_TYPES=new Set(['line','polyline','rectangle','dimension']);
export function wallDetectDocument(document){
 const entities=[];
 (document?.entities||[]).forEach((e,index)=>{
  if(!e||e.hidden||!WALL_TYPES.has(e.type))return;
  const out={id:e.id??index,type:e.type};
  for(const key of ['layer','mode','points','closed','bulges'])if(e[key]!==undefined)out[key]=e[key];
  entities.push(out);
 });
 return {units:document?.units,layers:(document?.layers||[]).map(({id,name,visible,frozen})=>({id,name,visible,frozen})),entities};
}
export const detectWalls=(document,options)=>compute('walls.detect',{document:wallDetectDocument(document)},options);

// ── 보낼 도면 고르기. 서버 계산이 실제로 읽는 부분만 보내 큰 도면도 가볍게 한다(결과는 도면 전체를 보낼 때와 같다).
/** 원본 DXF 보존 자료(수십 MB)는 계산이 읽지 않는다. */
export function leanDocument(document){const {dxfPreservation,...rest}=document||{};return rest;}
const finite=b=>b&&[b.minX,b.minY,b.maxX,b.maxY].every(Number.isFinite);
// 공유 블록 정의는 보내는 객체(와 그 자식)가 쓰는 것만.
function usedSharedBlocks(document,entities){
 const all=document.sharedBlocks,out={};if(!all)return undefined;
 const visit=e=>{if(!e)return;if(e.sharedBlock&&!Object.hasOwn(out,e.sharedBlock)&&all[e.sharedBlock]){out[e.sharedBlock]=all[e.sharedBlock];for(const c of all[e.sharedBlock].entities||[])visit(c);}for(const c of e.entities||[])visit(c);};
 entities.forEach(visit);return out;
}
// 층 박스 읽기(PLANSET 평면 읽기·벽체 다시 그리기)는 박스 안(±1 mm)에 든 객체만 쓴다 → 박스와 겹치는 객체만 보낸다(10 mm 여유).
// 범위를 모르는 객체는 그대로 보낸다. 공유 블록 범위는 서버와 같은 캐시(_renderBounds)로 잰다.
const BOX_MARGIN=10;
export function boxDocument(document,boxes){
 const B=(boxes||[]).map(b=>G.bounds([b])).filter(finite);if(!B.length)return leanDocument(document);
 const near=b=>!finite(b)||B.some(x=>b.maxX>=x.minX-BOX_MARGIN&&b.minX<=x.maxX+BOX_MARGIN&&b.maxY>=x.minY-BOX_MARGIN&&b.minY<=x.maxY+BOX_MARGIN);
 const entities=document.entities.filter(e=>{
  if(!e)return true;
  try{if(e.sharedBlock){G.ensureSharedDrawingReferenceBounds(document,[e]);return near(e._renderBounds);}return near(G.bounds([e]));}catch{return true;}
 });
 const out={...leanDocument(document),entities},shared=usedSharedBlocks(document,entities);if(shared)out.sharedBlocks=shared;
 return out;
}
// 사무소 도곽 읽기(readOfficeSheets)는 맨 위 객체 중 블록(이름·위치·배율·회전과 자식 범위)·글자(도곽 장식 글 빼고)·축선(2점 선)만 읽는다.
// 블록 자식은 범위 상자 하나로 바꿔 보낸다(서버가 재는 범위가 이 PC 에서 잰 범위와 같다).
const boundsProxy=entities=>{if(!entities?.length)return entities;const b=G.bounds(entities);return finite(b)?[{type:'polyline',points:[{x:b.minX,y:b.minY},{x:b.maxX,y:b.maxY}]}]:[];};
export function officeDocument(document){
 const shared={},entities=[];
 for(const e of document.entities||[]){
  if(e?.type==='block'&&e.position){
   const out={id:e.id,type:'block',layer:e.layer,name:e.name,position:e.position,scale:e.scale,rotation:e.rotation};
   if(e.entities)out.entities=boundsProxy(e.entities);
   const def=e.sharedBlock?document.sharedBlocks?.[e.sharedBlock]:null;
   if(e.sharedBlock){out.sharedBlock=e.sharedBlock;if(def&&!Object.hasOwn(shared,e.sharedBlock))shared[e.sharedBlock]={origin:def.origin,entities:boundsProxy(def.entities)};}
   entities.push(out);
  }else if((e?.type==='text'||e?.type==='mtext')&&e.position&&e.text&&!e.sheetDecoration)entities.push({id:e.id,type:e.type,layer:e.layer,position:e.position,text:e.text,height:e.height});
  else if(e?.type==='line'||(e?.type==='polyline'&&e.points?.length===2))entities.push({id:e.id,type:e.type,layer:e.layer,points:e.points});
 }
 return {units:document.units,layers:document.layers,entities,...(document.sharedBlocks?{sharedBlocks:shared}:{})};
}

// 평면 인식(PLANSET·도면 생성기·벽체 다시 그리기)
export const planToModel=(document,boxes,options={},o)=>compute('plan.toModel',{document:boxDocument(document,boxes),boxes,options},o);
export const officeFloors=(document,reading=null,{building=null}={},o)=>compute('plan.officeFloors',{document:officeDocument(document),reading,building},o);
export const officeViews=(document,reading=null,o)=>compute('plan.officeViews',{document:officeDocument(document),reading},o);
export const traceWalls=(document,boxes,reading=null,o)=>compute('plan.traceWalls',{document:boxDocument(document,boxes),boxes,reading},o);
/** 현재 도면 → PLANSET 설계 모델. compute/plan-to-model.js recognizePlanModel 과 같은 순서로, 도곽 읽기 → 박스 읽기 두 번을 서버에 맡긴다. */
export async function recognizePlanModel(doc,options={},o){
 const source={...doc,entities:doc.entities.filter(e=>!e.drawingSet&&!e.hidden)};
 let boxes=[],floors=null,method='drawing-bounds';
 if(options.boxIds?.length){
  boxes=options.boxIds.map(id=>source.entities.find(e=>e.id===id));
  if(boxes.some(b=>!isPlanBox(b)))throw Error('planOptions.boxIds 는 원본 도면의 닫힌 PL 또는 사각형 ID여야 합니다.');
  method='selected-boxes';
 }else{
  floors=await officeFloors(source,options.reading,{},o);
  if(floors.length&&new Set(floors.map(f=>f.name)).size!==floors.length)throw Error('같은 층 평면이 여러 장입니다. planOptions.boxIds 로 사용할 평면 박스를 지정하세요.');
  if(floors.length){boxes=floors.map(f=>f.box);method='office-sheets';}
 }
 if(!boxes.length){
  const visible=new Set((source.layers||[]).filter(l=>l.visible!==false&&!l.frozen).map(l=>l.id));
  const b=G.bounds(source.entities.filter(e=>(!e.layer||visible.has(e.layer))&&!e.sheetDecoration));
  if(!finite(b))throw Error('현재 도면에서 평면 경계를 찾지 못했습니다. 벽·문·창이 있는 평면을 먼저 열거나 설계 JSON(model)을 주세요.');
  boxes=[{type:'rectangle',points:[{x:b.minX-1,y:b.minY-1},{x:b.maxX+1,y:b.maxY+1}]}];
 }
 const inferred=floors?.length?{floors:floors.map(f=>({name:f.name,height:f.height})),roofBox:floors.at(-1).roof?'yes':'no',...(floors.every(f=>f.datum)?{datums:floors.map(f=>f.datum)}:{})}:{};
 const {model,report}=await planToModel(source,boxes,{...inferred,...options},o);
 return {model,report:{...report,source:method,boxes:boxes.map(b=>({id:b.id||null,bounds:G.bounds([b])}))},boxes,options:{...inferred,...options}};
}

// 구조(평면 읽기 → 구조 입력, 구조계산서 초안). 평면 읽기는 도면 전체의 레이어 수를 보므로 도면을 다 보낸다.
export const readStructurePlan=(document,boxes,options={},overrides={},o)=>compute('structure.readPlan',{document:leanDocument(document),boxes,options,overrides},o);
export const structureCalcReport=(record,project={},o)=>compute('structure.calcReport',{record,project},o);

// 창호 계획(실·벽·대지·기존 창을 도면 전체에서 읽는다)
export const suggestOpenings=(document,args={},o)=>compute('openings.suggest',{document:leanDocument(document),args},o);
export const checkDaylight=(document,args={},o)=>compute('openings.daylight',{document:leanDocument(document),args},o);
/** 서버는 늘어난 객체·레이어만 돌려준다. 도면 사본 끝에 붙여 예전과 같은 {document,added,warnings} 를 만든다. */
export async function prepareOpenings(document,proposals,o){
 const delta=await compute('openings.prepare',{document:leanDocument(document),proposals},o),copy=structuredClone(document);
 copy.layers.push(...delta.layers);copy.entities.push(...delta.entities);
 return {document:copy,added:delta.added,warnings:delta.warnings};
}

// 남의 도면 읽기·조명 전기 배치·법령 검토(2026-10-21) — 계산은 서버(compute/foreign-plan·electrical-layout·electrical-review)
export const foreignRead=(document,reading=null,{fileName='',wallLayer=null}={},o)=>compute('plan.foreignRead',{document:leanDocument(document),reading,fileName,wallLayer},o);
export const electricalLayout=(document,reading,rules,options={},o)=>compute('electrical.layout',{document:leanDocument(document),reading,rules,options},o);
export const electricalReview=(request,rules=null,o)=>compute('electrical.review',{request,rules},o);
