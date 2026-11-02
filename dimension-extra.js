import * as G from './geometry.js';
import {dimensionPreview} from './dimension-preview.js';
import {createPackedBoundsIndex} from './packed-bounds-index.js';

const point = p => ({x:p.x,y:p.y});
const finite = p => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const clamp = x => Math.max(0,Math.min(1,x));
const midpoint = (a,b) => G.mul(G.add(a,b),.5);

// Bulge is tan(includedAngle/4); clockwise bulges are normalized to CCW endpoints.
export function bulgeArc(a,b,bulge) {
 if (!finite(a)||!finite(b)||!Number.isFinite(bulge)||Math.abs(bulge)<G.EPS||G.dist(a,b)<G.EPS) return null;
 const chord=G.sub(b,a),center=G.add(midpoint(a,b),G.mul(G.normal(chord),(1-bulge*bulge)/(4*bulge)));
 const start=bulge>0?a:b,end=bulge>0?b:a;
 return {center,radius:G.dist(center,a),startAngle:G.angle(G.sub(start,center)),endAngle:G.angle(G.sub(end,center)),start:point(start),end:point(end)};
}
export function arcDimensionSpec(entity,at=null) {
 if(entity?.type==='arc') {
  if(!finite(entity.center)||!(entity.radius>0)||!Number.isFinite(entity.startAngle)||!Number.isFinite(entity.endAngle))throw Error('올바른 호를 선택하세요.');
  let start=G.add(entity.center,G.polar(entity.radius,entity.startAngle)),end=G.add(entity.center,G.polar(entity.radius,entity.endAngle));
  if(entity.clockwise)[start,end]=[end,start];
  return {center:point(entity.center),radius:entity.radius,start,end};
 }
 if(entity?.type==='block' && entity.name==='DXF 곡선 폴리선') {
  const arcs=(entity.entities||[]).filter(e=>e.type==='arc').map(e=>{
   const spec=arcDimensionSpec(e),start=G.angle(G.sub(spec.start,spec.center)),end=G.angle(G.sub(spec.end,spec.center));
   const distance=at?(G.angleOnArc(G.angle(G.sub(at,spec.center)),start,end)?Math.abs(G.dist(at,spec.center)-spec.radius):Math.min(G.dist(at,spec.start),G.dist(at,spec.end))):0;
   return {...spec,distance};
  });
  arcs.sort((a,b)=>a.distance-b.distance);if(arcs.length)return arcs[0];
 }
 if(entity?.type==='polyline') {
  const found=[];const count=entity.closed?entity.points.length:entity.points.length-1;
  for(let i=0;i<count;i++){
   const a=entity.points[i],b=entity.points[(i+1)%entity.points.length],bulge=Number(entity.bulges?.[i]??a.bulge??0),arc=bulgeArc(a,b,bulge);if(!arc)continue;
   const d=at?(G.angleOnArc(G.angle(G.sub(at,arc.center)),arc.startAngle,arc.endAngle)?Math.abs(G.dist(at,arc.center)-arc.radius):Math.min(G.dist(at,arc.start),G.dist(at,arc.end))):i;
   found.push({...arc,d});
  }
  found.sort((a,b)=>a.d-b.d);if(found.length)return found[0];
 }
 throw Error('호 또는 폴리선의 호 구간을 선택하세요.');
}
export function buildArcDimension(spec,at,values={}) {
 if(!finite(at)||G.dist(spec.center,at)<G.EPS)throw Error('치수 호 위치를 중심 밖에 지정하세요.');
 return {type:'dimension',mode:'arcLength',points:[point(spec.center),point(spec.start),point(spec.end),point(at)],arcSymbol:'⌒',...values};
}
function curvePoint(curve,at) {
 let angle=G.dist(curve.center,at)>G.EPS?G.angle(G.sub(at,curve.center)):curve.startAngle??0;
 if(curve.type==='arc'&&!G.angleOnArc(angle,curve.startAngle,curve.endAngle)) {
  const a=G.add(curve.center,G.polar(curve.radius,curve.startAngle)),b=G.add(curve.center,G.polar(curve.radius,curve.endAngle));
  angle=G.dist(at,a)<=G.dist(at,b)?curve.startAngle:curve.endAngle;
 }
 return G.add(curve.center,G.polar(curve.radius,angle));
}
export function buildJoggedDimension(curve,override,at,jog=null) {
 if(!finite(curve.center)||!(curve.radius>0)||!finite(override)||!finite(at))throw Error('원·호와 치수 위치를 확인하세요.');
 const chord=curvePoint(curve,at);
 return {type:'dimension',mode:'jogged',points:[point(curve.center),chord,point(at),point(override),point(jog||midpoint(override,chord))]};
}
export function buildOrdinateDimension(origin,feature,at,axis=null,values={}) {
 if(![origin,feature,at].every(finite))throw Error('좌표 치수점이 올바르지 않습니다.');
 const delta=G.sub(at,feature),mode=axis==='X'?'ordinateX':axis==='Y'?'ordinateY':Math.abs(delta.y)>=Math.abs(delta.x)?'ordinateX':'ordinateY';
 return {type:'dimension',mode,points:[point(origin),point(feature),point(at)],...values};
}
function partLength(part) {return part.type==='line'?G.dist(...part.points):part.radius*G.normalizeAngle(part.endAngle-part.startAngle)*Math.PI/180;}
function partParameter(part,p) {
 if(part.type==='line'){const d=G.sub(part.points[1],part.points[0]);return G.dot(G.sub(p,part.points[0]),d)/G.dot(d,d);}
 return G.normalizeAngle(G.angle(G.sub(p,part.center))-part.startAngle)/G.normalizeAngle(part.endAngle-part.startAngle);
}
const breakSize=(dim,gap)=>gap??dim.breakSize??Math.max((dim.textHeight||150)*(dim.scale||1)*.3,G.EPS);
function breaksAgainst(parts,cutters,size){
 const breaks=[];
 parts.forEach((part,partIndex)=>{
  if(!part.dimensionBreakable||!['line','arc'].includes(part.type))return;
  const length=partLength(part);if(length<G.EPS)return;
  const half=size/(2*length);
  for(const cutter of cutters)for(const p of G.intersections(part,cutter)){
   const t=partParameter(part,p);if(t<=G.EPS||t>=1-G.EPS)continue;
   breaks.push({partIndex,start:clamp(t-half),end:clamp(t+half)});
  }
 });
 return breaks;
}
export function automaticDimensionBreaks(dim,entities,gap=null) {
 const cutters=entities.filter(e=>(dim.id==null||e.id!==dim.id)&&!e.hidden).flatMap(e=>G.primitives(e));
 return breaksAgainst(G.dimensionBaseParts(dim),cutters,breakSize(dim,gap));
}

/* ── 자동 끊기를 연관으로(ACAD200 518) ──
   AutoCAD 는 끊는 객체를 참조로 들고 있다가 그 객체가 바뀌면 끊는 자리를 다시 계산한다.
   우리는 치수에 breakMode:'auto' 와 breakBy:[끊는 객체 id] 를 남기고, 자동으로 만든 끊김 칸에는 auto:true 를 붙인다.
   손으로 만든 끊김(auto 없음)은 다시 계산해도 그대로 둔다. 다시 계산은 엔진 동기화 단계(dim-assoc.js)가
   치수나 breakBy 객체가 바뀐 명령에서만 한다 — 도면 전체를 다시 훑지 않는다. */
/** 끊는 객체 하나하나와 교차를 따로 구해, 실제로 끊은 객체 id 만 breakBy 에 남긴다. */
export function autoDimensionBreaks(dim,cutterEntities,{gap=null,primitivesOf=G.primitives}={}) {
 const parts=G.dimensionBaseParts(dim),size=breakSize(dim,gap),breaks=[],breakBy=[];
 for(const e of cutterEntities||[]){
  if(!e||e.hidden||(dim.id!=null&&e.id===dim.id))continue;
  const found=breaksAgainst(parts,primitivesOf(e)||[],size);
  if(!found.length)continue;
  for(const b of found)breaks.push({...b,auto:true});
  if(e.id!=null&&!breakBy.includes(e.id))breakBy.push(e.id);
 }
 return {breaks,breakBy};
}
/** 손 끊김은 두고 자동 끊김만 새 결과로 바꾼 값(update changes 로 그대로 쓴다). */
export function withAutoBreaks(dim,result) {
 const manual=(dim.breaks||[]).filter(b=>!b?.auto);
 return {breaks:[...manual,...result.breaks],breakMode:'auto',breakBy:[...result.breakBy]};
}
/** 치수나 breakBy 객체 중 하나라도 바뀌었으면 다시 계산해야 한다. */
export function needsBreakRefresh(dim,changedIds) {
 return dim?.breakMode==='auto'&&(changedIds.has(dim.id)||(dim.breakBy||[]).some(id=>changedIds.has(id)));
}
/** 엔진 동기화용: breakBy 객체만으로 자동 끊김을 다시 구한다. 지워진 객체는 breakBy 에서 빠진다.
    지금 교차하지 않는 객체도 breakBy 에 남겨 두어, 다시 겹치면 끊김이 돌아온다. */
export function refreshAutoBreaks(dim,lookup,{primitivesOf=G.primitives}={}) {
 if(dim?.breakMode!=='auto')return null;
 const alive=(dim.breakBy||[]).map(id=>lookup(id)).filter(Boolean);
 const result=autoDimensionBreaks(dim,alive,{primitivesOf});
 return {...withAutoBreaks(dim,result),breakBy:alive.map(e=>e.id)};
}
/* 자르개 후보를 공간 색인(packed-bounds-index)으로만 고른다. 예전에는 DIMBREAK 한 번에 도면 전체를
   화면 객체로 펼친 뒤(visibleEntities) 기본 도형으로 다시 펼쳤다(20만 객체면 20만 개 전부).
   색인은 확정된 객체 배열마다 한 번 만들고(엔진 이력 배열은 바뀌지 않는다) 같은 도면에서 다시 쓴다. */
const breakIndexes=new WeakMap();
export function buildBreakIndex(entities) {
 const list=entities||[];
 const cached=breakIndexes.get(list);if(cached&&cached.length===list.length)return cached;
 const index=createPackedBoundsIndex(list.length,i=>{const e=list[i];return e&&!e.hidden?G.bounds([e]):null;});
 const built={length:list.length,query:box=>index.query(box).map(i=>list[i])};
 breakIndexes.set(list,built);return built;
}
/** 치수 하나의 경계 상자에 걸치는 객체만(치수 자신·숨김 제외). */
export function dimensionBreakCandidates(dim,index,accept=()=>true) {
 const box=G.bounds([{...dim,breaks:[]}]);if(!box)return [];
 return index.query(box).filter(e=>e.id!==dim.id&&!e.hidden&&accept(e));
}
export function manualDimensionBreak(dim,first,second) {
 const parts=G.dimensionBaseParts(dim);let best=null;
 parts.forEach((part,partIndex)=>{
  if(!part.dimensionBreakable||!['line','arc'].includes(part.type))return;
  const distance=part.type==='line'?G.distanceToSegment(first,...part.points):G.angleOnArc(G.angle(G.sub(first,part.center)),part.startAngle,part.endAngle)?Math.abs(G.dist(first,part.center)-part.radius):Infinity;
  if(!best||distance<best.distance)best={part,partIndex,distance};
 });
 if(!best||!Number.isFinite(best.distance))throw Error('끊을 치수선 또는 치수보조선을 지정하세요.');
 const a=clamp(partParameter(best.part,first)),b=clamp(partParameter(best.part,second));
 if(Math.abs(a-b)<G.EPS)return [...(dim.breaks||[])];
 return [...(dim.breaks||[]),{partIndex:best.partIndex,start:Math.min(a,b),end:Math.max(a,b)}];
}
async function optionValue(ctx,key) {
 if(typeof ctx.form!=='function')throw Error('치수 옵션 입력창을 사용할 수 없습니다.');
 const numeric=key==='A';
 return new Promise(resolve=>ctx.form(numeric?'치수 문자 각도 지정':'치수 문자 입력',[{name:'value',label:numeric?'각도':'치수 문자 (<> = 측정값)',type:numeric?'number':key==='M'?'textarea':'text',value:numeric?0:'<>'}],values=>{
  const v=numeric?Number(values.value):String(values.value);if(numeric&&!Number.isFinite(v))throw Error('각도를 숫자로 입력하세요.');resolve(v);
 },()=>resolve(null)));
}
export function installDimensionExtra(ctx) {
 const styled=e=>ctx.styledDimension?ctx.styledDimension(e):e;
 const previewLayer=()=>ctx.getSettings?.()?.dimLayerAuto?ctx.layers?.().find(l=>l.name==='A-DIM')?.id:ctx.activeLayer?.();
 const makeStyled=e=>({...styled(e),...(previewLayer()?{layer:previewLayer()}:{})});
 const commit=e=>{
  if(ctx.getSettings?.()?.dimLayerAuto)e={...e,layer:ctx.ensureLayer('A-DIM','#9dcbe0')};
  const layer=ctx.layers?.().find(l=>l.id===(e.layer||ctx.activeLayer?.()));
  if(layer&&(layer.locked||layer.frozen||layer.visible===false))throw Error('치수 레이어를 표시·해동하고 잠금을 해제하세요.');
  ctx.commit({entities:[e]});return e;
 };
 const resolvePick=p=>p?.entity||p;
 const applyOption=async(values,key)=>{
  const v=await optionValue(ctx,key);if(v===null)return false;
  if(key==='A')values.textRotation=v;else values.text=key==='M'?v.replaceAll('\\P','\n'):v;return true;
 };
 return {
  async DIMARC() {
   const picked=await ctx.pickEntity({prompt:'호 또는 폴리선 호 구간 선택',types:['arc','polyline','block'],withPoint:true});if(!picked)return null;
   let spec=arcDimensionSpec(resolvePick(picked),picked.point),values={};
   const make=p=>makeStyled(buildArcDimension(spec,p,values));
   while(true) {
    const p=await ctx.pickPoint({prompt:'호 길이 치수 위치 지정 또는 [여러 줄 문자(M)/문자(T)/각도(A)/부분(P)/지시선(L)]',options:['M','MTEXT','T','TEXT','A','ANGLE','P','PARTIAL','L','LEADER'],preview:dimensionPreview(make)});if(!p)return null;
    if(!p.option)return commit(make(p));
    const key=p.option.toUpperCase()[0];
    if(['M','T','A'].includes(key)){if(!await applyOption(values,key))return null;}
    else if(key==='P'){
     const on=p=>curvePoint({...spec,type:'arc',startAngle:G.angle(G.sub(spec.start,spec.center)),endAngle:G.angle(G.sub(spec.end,spec.center))},p);
     const a=await ctx.pickPoint({prompt:'부분 호의 첫 번째 점 지정',preview:dimensionPreview(make)});if(!a)return null;
     const start=on(a),b=await ctx.pickPoint({prompt:'부분 호의 두 번째 점 지정',preview:dimensionPreview(p=>makeStyled(buildArcDimension({...spec,start,end:on(p)},p,{...values,arcPartial:true})))});if(!b)return null;
     const end=on(b),total=G.normalizeAngle(G.angle(G.sub(spec.end,spec.center))-G.angle(G.sub(spec.start,spec.center))),startT=G.normalizeAngle(G.angle(G.sub(start,spec.center))-G.angle(G.sub(spec.start,spec.center))),endT=G.normalizeAngle(G.angle(G.sub(end,spec.center))-G.angle(G.sub(spec.start,spec.center)));
     if(Math.abs(startT-endT)<G.EPS||Math.max(startT,endT)>total+G.EPS)throw Error('서로 다른 부분 호 점을 지정하세요.');
     spec={...spec,start:startT<=endT?start:end,end:startT<=endT?end:start};values.arcPartial=true;
    }else if(key==='L'){
     values.arcLeader=!values.arcLeader;
     if(values.arcLeader){const p=await ctx.pickPoint({prompt:'지시선 끝점 지정',preview:dimensionPreview(p=>makeStyled(buildArcDimension(spec,p,{...values,leaderPoint:p})))});if(!p)return null;values.leaderPoint=point(p);}else delete values.leaderPoint;
    }
   }
  },
  async DIMJOGGED() {
   const picked=await ctx.pickEntity({prompt:'꺾인 반지름 치수의 원 또는 호 선택',types:['circle','arc'],withPoint:true});if(!picked)return null;
   const curve=resolvePick(picked);if(!['circle','arc'].includes(curve.type))throw Error('원 또는 호를 선택하세요.');
   const override=await ctx.pickPoint({prompt:'중심 대체 위치 지정',preview:dimensionPreview(p=>makeStyled(buildJoggedDimension(curve,p,p)))});if(!override)return null;
   const at=await ctx.pickPoint({prompt:'치수선 위치 지정',preview:dimensionPreview(p=>makeStyled(buildJoggedDimension(curve,override,p)))});if(!at)return null;
   const jog=await ctx.pickPoint({prompt:'꺾기 위치 지정',preview:dimensionPreview(p=>makeStyled(buildJoggedDimension(curve,override,at,p)))});if(!jog)return null;
   return commit(makeStyled(buildJoggedDimension(curve,override,at,jog)));
  },
  async DIMORDINATE() {
   const origin=ctx.ucsOrigin?.()||ctx.doc?.()?.ucs?.origin||{x:0,y:0};
   const feature=await ctx.pickPoint({prompt:'좌표 치수의 점 지정'});if(!feature)return null;
   let axis=null;const values={},make=p=>makeStyled(buildOrdinateDimension(origin,feature,p,axis,values));
   while(true){
    const p=await ctx.pickPoint({prompt:'지시선 끝점 지정 또는 [X 좌표(X)/Y 좌표(Y)/여러 줄 문자(M)/문자(T)/각도(A)]',options:['X','XDATUM','Y','YDATUM','M','MTEXT','T','TEXT','A','ANGLE'],preview:dimensionPreview(make)});if(!p)return null;
    if(!p.option)return commit(make(p));
    const key=p.option.toUpperCase()[0];if(key==='X'||key==='Y')axis=key;else if(!await applyOption(values,key))return null;
   }
  },
  async DIMBREAK() {
   let dims=(ctx.selected?.()||[]).filter(e=>e.type==='dimension');
   if(!dims.length){const picked=await ctx.pickEntity({prompt:'끊을 치수 선택',types:['dimension']});if(!picked)return null;dims=[resolvePick(picked)];}
   const checkEditable=()=>{const layers=new Map((ctx.layers?.()||[]).map(l=>[l.id,l]));if(dims.some(e=>{const l=layers.get(e.layer);return e.type!=='dimension'||l&&(l.locked||l.frozen||l.visible===false);}))throw Error('치수 레이어를 표시·해동하고 잠금을 해제하세요.');};
   checkEditable();
   let multiple=false,changes=null,cachedAuto=null;
   // 치수마다 경계 상자에 걸치는 객체만 후보로(공간 색인). 보이는 레이어의 객체만 끊는다.
   const visibleCutters=dim=>{
    const layers=new Map((ctx.layers?.()||[]).map(l=>[l.id,l])),ids=new Set(dims.map(e=>e.id));
    const shown=e=>!ids.has(e.id)&&!e.hidden&&layers.get(e.layer)?.visible!==false&&!layers.get(e.layer)?.frozen;
    const entities=dimensionBreakCandidates(dim,buildBreakIndex(ctx.entities?.()||[]),shown);
    const doc=ctx.doc?.();
    return doc?.layers?G.visibleEntities(doc,{entities}):entities;
   };
   const visiblePrims=e=>G.visiblePrimitives(e).filter(p=>!p.hidden);
   const auto=()=>{if(!cachedAuto)cachedAuto=dims.map(e=>({...e,...withAutoBreaks(e,autoDimensionBreaks(e,visibleCutters(e),{primitivesOf:visiblePrims}))}));return cachedAuto;};
   while(true){
    const choice=await ctx.pickPoint({prompt:multiple?'치수 끊기 [자동(A)/수동(M)/제거(R)] <자동>':'치수 끊기 [여러 개(M)/자동(A)/수동(MANUAL)/제거(R)] <자동>',options:['','A','AUTO','M','MULTIPLE','MANUAL','S','R','REMOVE'],preview:dimensionPreview(auto)});if(!choice)return null;
    const option=(choice.option||'A').toUpperCase();
    if((option==='M'&&!multiple)||option==='MULTIPLE'){
     multiple=true;
     while(true){const picked=await ctx.pickEntity({prompt:'추가 치수 선택 · Enter 완료',types:['dimension'],allowNone:'done'});if(!picked)return null;if(picked.option==='done')break;const e=resolvePick(picked);if(!dims.some(d=>d.id===e.id)){dims.push(e);checkEditable();cachedAuto=null;}}
     continue;
    }
    if(option==='R'||option==='REMOVE')changes=dims.map(e=>({...e,breaks:[],breakMode:null,breakBy:null}));
    else if(['M','MANUAL','S'].includes(option)){
     const first=await ctx.pickPoint({prompt:'수동 끊기의 첫 번째 점 지정',preview:dimensionPreview(()=>dims)});if(!first)return null;
     const make=p=>dims.map(e=>({...e,breaks:manualDimensionBreak(e,first,p)}));
     const second=await ctx.pickPoint({prompt:'수동 끊기의 두 번째 점 지정',preview:dimensionPreview(make)});if(!second)return null;changes=make(second);
    }else changes=auto();
    const confirm=ctx.confirmDimensionBreak?await ctx.confirmDimensionBreak(changes):await ctx.pickPoint({prompt:'치수 끊기 결과 확인 · 클릭하여 적용 · Esc 취소',preview:dimensionPreview(()=>changes)});if(!confirm)return null;
    checkEditable();
    ctx.execute({type:'updateMany',updates:changes.map(e=>({id:e.id,changes:{breaks:e.breaks,...(e.breakMode!==undefined?{breakMode:e.breakMode,breakBy:e.breakBy}:{})}}))});return changes;
   }
  }
 };
}
