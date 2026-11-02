// 자동 배치 품질 검사 — 판정은 바른 서버(compute/plan-quality.js)에서 한다. 화면은 검사 범위만 보내고 결과를 기억해 다시 그린다.
// 같은 범위·같은 결과면 서버에 다시 묻지 않는다. 가벼운 편집(검사 범위 밖 객체만 바뀜)은 앞 결과를 그대로 잇는다(예전 화면 계산과 같은 규칙).
import {qualityScope,boundaryLayer} from './plan-quality-scope.js';
import {planValueSources} from './site-plan.js';
import {compute,COMPUTE_LOGIN_GUIDE} from './compute-client.js';

export const PLAN_QUALITY_WAITING='바른 서버에서 배치 품질을 검사하는 중입니다.';
/** 서버 답이 오면 화면에 알린다(열린 계획 창이 다시 그린다). */
export const PLAN_QUALITY_EVENT='barun-plan-quality';
const STAGES=[['open','열림'],['shape','형태'],['objects','객체 품질'],['practice','실무 사용']];
const MAX_RESULTS=48,RETRY_MS=30_000;
const results=new Map(),docCache=new WeakMap();

/** 서버 답을 기다리거나 못 받았을 때의 판정 칸: 첫 칸에 이유, 나머지는 판정 보류. */
function placeholder(reason,extra){
 return {stages:STAGES.map(([id,label],i)=>({id,label,status:i?'held':'needs_check',reasons:i?['앞 단계 결과를 기다리는 중']:[reason]})),values:[],...extra};
}
const failure=error=>placeholder(error?.code==='not_logged_in'?COMPUTE_LOGIN_GUIDE:error?.message||'배치 품질 검사를 받지 못했습니다.',{failed:true,code:error?.code||'offline'});

function inputFor(result,{request,document:current}){
 const req=request!==undefined?request:result?.request;
 const input={result,...(request!==undefined?{request}:{}),valueSources:planValueSources(req)};
 let scope=null;
 if(current){
  try{scope=qualityScope(current,result);}catch{scope=null;}
  // 범위를 못 고르면(깨진 도면) 서버가 같은 오류를 판정 칸에 적도록 받은 그대로 보낸다.
  const d=scope?.doc||current;
  input.document={version:d.version,units:d.units,layers:d.layers,entities:d.entities,sharedBlocks:d.sharedBlocks};
 }
 return {input,scope,req};
}

function lookup(key,input,onReady){
 let entry=results.get(key);
 if(entry?.error&&Date.now()-entry.at>RETRY_MS){results.delete(key);entry=null;}
 if(entry){results.delete(key);results.set(key,entry);}
 else{
  entry={quality:null,listeners:new Set()};results.set(key,entry);
  while(results.size>MAX_RESULTS)results.delete(results.keys().next().value);
  entry.promise=compute('plan.quality',input).then(quality=>{entry.quality=quality;},error=>{entry.error=error;entry.at=Date.now();entry.quality=failure(error);})
   .finally(()=>{const listeners=[...entry.listeners];entry.listeners.clear();for(const fn of listeners)try{fn();}catch{}
    try{globalThis.dispatchEvent?.(new Event(PLAN_QUALITY_EVENT));}catch{}});
 }
 if(!entry.quality&&onReady)entry.listeners.add(onReady);
 return entry;
}

function entryFor(result,{request,document:current,execution}={},onReady){
 const trusted=current&&execution?.document===current;
 if(trusted){
  const req=request!==undefined?request:result?.request,cached=docCache.get(current);
  if(cached?.result===result&&cached.request===req)return lookup(cached.key,cached.input,onReady);
  const previous=docCache.get(execution.previous);
  if(previous){
   const layerKey=JSON.stringify(current.layers.filter(l=>previous.layerIds.has(l.id)||boundaryLayer(l.name)));
   const c=execution.command||{},ids=c.ids||c.updates?.map(u=>u.id)||c.targets?.map(t=>t.id)||(c.id?[c.id]:[]);
   if(execution.lightweight&&previous.result===result&&previous.request===req&&previous.layerKey===layerKey&&execution.previous.blocks===current.blocks&&execution.previous.sharedBlocks===current.sharedBlocks&&!ids.some(id=>previous.ids.has(id))&&!execution.changed?.some(e=>previous.ids.has(e.id)||previous.relevant(e))){
    docCache.set(current,previous);return lookup(previous.key,previous.input,onReady);
   }
  }
 }
 const {input,scope,req}=inputFor(result,{request,document:current}),key=JSON.stringify(input);
 if(trusted&&scope){
  const layerIds=new Set(scope.doc.layers.map(l=>l.id));
  docCache.set(current,{result,request:req,layerIds,layerKey:JSON.stringify(current.layers.filter(l=>layerIds.has(l.id)||boundaryLayer(l.name))),ids:new Set(scope.doc.entities.map(e=>e.id)),relevant:scope.relevant,key,input});
 }
 return lookup(key,input,onReady);
}

/** 화면 그리기용: 받은 결과가 있으면 바로, 없으면 '검사 중' 칸을 돌려주고 답이 오면 onReady 로 다시 그리게 한다. */
export function planQualityNow(result,options={},onReady){
 const entry=entryFor(result,options,onReady);
 return entry.quality||placeholder(PLAN_QUALITY_WAITING,{pending:true});
}
/** 결과를 기다려 받는다(시험·명령용). */
export async function planQuality(result,options={}){
 const entry=entryFor(result,options);await entry.promise;return entry.quality;
}
/** 지금 기다리는 서버 답이 모두 올 때까지(시험·한 번에 다시 그리기). */
export async function planQualitySettled(){await Promise.all([...results.values()].map(entry=>entry.promise));}
/** 로그인 상태가 바뀌면 실패 기억을 지운다(다시 묻게). */
export function clearPlanQualityFailures(){for(const [key,entry] of results)if(entry.error)results.delete(key);}
