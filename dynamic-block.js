// Dynamic blocks: visibility and linear (stretch/move) parameters.
// The converter (converter/DynBlocks.cs) and exchange.py attach the definition
// to doc.sharedBlocks[source].dynamic and each reference's current values to
// ref.dynamic = {source, values}. Changing a value recomputes the reference
// from the source definition into an ordinary block in drawing coordinates
// (only that entity changes, so large drawings are not recompiled); its
// position/scale/rotation stay on the block for the next change.
import * as G from './geometry.js';

const POINT_TYPES=new Set(['Line','LwPolyline','Polyline2D','Polyline3D','Wipeout']);

export function dynamicDefinition(doc,ref){
 const source=ref?.dynamic?.source,definition=source&&doc?.sharedBlocks?.[source];
 return definition?.dynamic?{source,definition}:null;
}

const stateKey=v=>String(v).replace(/\s/g,'').toLocaleLowerCase();
function visibilityValue(p,v,warnings){
 const state=p.states.find(s=>s.name===v)||p.states.find(s=>stateKey(s.name)===stateKey(v));
 if(state)return state.name;
 const first=p.states[0]?.name??null;
 if(v!=null)warnings.push(`저장된 '${v}' 상태가 없어 '${first??'없음'}' 상태를 사용합니다.`);
 return first;
}

// A redefined block can retain an old node key. Only an unambiguous parameter
// of the same kind may consume it. Visibility names are resolved on demand.
const validValue=(p,v)=>p.kind==='xy'?!!v&&Number.isFinite(v.x)&&Number.isFinite(v.y):typeof v==='number'&&Number.isFinite(v)&&(p.kind==='flip'?(v===0||v===1):p.kind==='rotation'||v>0);
const knownParameter=(p,v)=>validValue(p,v)&&validValue(p,p.value);
const mirroredAlign=align=>({left:'right',right:'left'}[align]||align);

export function currentValues(dyn,stored={},warnings=[]){
 const params=dyn.parameters,out={},used=new Set();
 const resolve=(p,v)=>p.kind==='visibility'?visibilityValue(p,v,warnings):validValue(p,v)?v:null;
 for(const p of params){const v=stored[String(p.id)];if(v!=null){used.add(String(p.id));out[p.id]=resolve(p,v);}else used.add(String(p.id));}
 for(const p of params){
  if(p.id in out)continue;
  // A scalar old key carries no evidence of length, angle or flip state.
  const same=params.filter(q=>q.kind===p.kind),rest=Object.entries(stored).filter(([k,v])=>!used.has(k)&&!params.some(q=>String(q.id)===k)&&(p.kind==='visibility'?typeof v==='string':p.kind==='xy'?validValue(p,v):false));
  if(same.length===1&&rest.length===1){out[p.id]=resolve(p,rest[0][1]);used.add(rest[0][0]);}
  else out[p.id]=p.kind==='visibility'?visibilityValue(p,undefined,warnings):null;
 }
 return out;
}

const LABELS={visibility:'보이는 모양',linear:'거리',flip:'대칭',rotation:'회전',xy:'가로·세로 거리'};
export function describeParameters(dyn,values){
 return dyn.parameters.map(p=>({...p,label:p.label||LABELS[p.kind],value:values[p.id],
  default:p.kind==='visibility'?p.states[0]?.name:p.value,states:p.kind==='visibility'?p.states.map(s=>s.name):undefined}));
}

const unit=p=>{const dx=p.p2.x-p.p1.x,dy=p.p2.y-p.p1.y,l=Math.hypot(dx,dy)||1;return {x:dx/l,y:dy/l};};
const turn=(v,a)=>({x:v.x*Math.cos(a)-v.y*Math.sin(a),y:v.x*Math.sin(a)+v.y*Math.cos(a)});

// Displacement of an action's connection point for a new linear value.
// StartPoint: the second point moves by the change; MidPoint: both ends move half.
function shift(param,action,value){
 const d=value-param.value,mid=/^Mid/i.test(param.baseLocation||''),base=/^Base/i.test(action.connection||'');
 const along=base?(mid?-d/2:0):(mid?d/2:d),u=unit(param);
 return turn({x:u.x*along*(action.multiplier??1),y:u.y*along*(action.multiplier??1)},action.angle||0);
}

function flipEntity(source,p1,p2,keepFitting=false){
 const result=G.mirror(source,p1,p2);
 if(keepFitting&&source.type==='text'&&source.justify){
  result.justify=source.justify;
  for(const key of ['alignPoint','fitTo'])if(source[key])result[key]=G.mirror({type:'line',points:[source[key]]},p1,p2).points[0];
 }
 // Shared INSERTs reflect local X before their rotation. Preserve that exact
 // transform for every nested reference instead of treating it as a rotation.
 const references=(before,after)=>{
  if(before.sharedBlock){after.mirror=!before.mirror;after.rotation=(after.rotation||0)+180;}
  for(let i=0;i<(before.entities?.length||0);i++)references(before.entities[i],after.entities[i]);
 };
 references(source,result);return result;
}

function xyShift(dyn,action,values){
 const component=(connection,axis)=>{
  if(!connection?.name?.trim()||connection.id<0)return 0;
  const p=dyn.parameters.find(q=>q.id===connection.id),value=p&&values[p.id];
  if(p?.kind!=='xy'||!knownParameter(p,value))return 0;
  const d=value[axis]-p.value[axis],mid=/^Mid/i.test(p.baseLocation||''),base=/^Base/i.test(connection.name||'');
  return base?(mid?-d/2:0):(mid?d/2:d);
 };
 return turn({x:component(action.xConnection,'x')*(action.multiplier??1),y:component(action.yConnection,'y')*(action.multiplier??1)},action.angle||0);
}

/** Entities of the source definition (local coordinates) for the given values. */
export function computeEntities(definition,dyn,values){
 let entities=structuredClone(definition.entities);
 for(const p of dyn.parameters){
  if(p.kind!=='visibility')continue;
  const state=p.states.find(s=>s.name===values[p.id])||p.states[0];if(!state)continue;
  const controlled=new Set(p.all),shown=new Set(state.handles);
  entities=entities.filter(e=>!controlled.has(e.sourceHandle)||shown.has(e.sourceHandle));
 }
 return applyActions(entities,dyn,values);
}

// Resolve only real parameter links; an unused X slot may carry the sentinel -1.
function actionParameter(dyn,a){
 return [a.param,a.xConnection?.name?.trim()?a.xConnection.id:null,a.yConnection?.name?.trim()?a.yConnection.id:null]
  .filter(id=>Number.isInteger(id)&&id>=0).map(id=>dyn.parameters.find(p=>p.id===id)).find(Boolean);
}
function applyActions(entities,dyn,values,direction=1,keepFitting=false){
 const byHandle=new Map(entities.map((e,i)=>[e.sourceHandle,i]));
 const move=(h,v)=>{const i=byHandle.get(h);if(i!==undefined&&(v.x||v.y))entities[i]=G.translate(entities[i],v.x,v.y);};
 for(const a of direction===1?dyn.actions:[...dyn.actions].reverse()){
  const p=actionParameter(dyn,a);
  if(!p||!knownParameter(p,values[p.id]))continue;
  if(a.kind==='flip'&&p.kind==='flip'){
   if(values[p.id]!==p.value)for(const h of a.handles||[]){const i=byHandle.get(h);if(i!==undefined)entities[i]=flipEntity(entities[i],p.p1,p.p2,keepFitting);}
   continue;
  }
  if(a.kind==='rotate'&&p.kind==='rotation'){
   const degrees=direction*(values[p.id]-p.value)*(a.multiplier??1)*180/Math.PI;
   if(degrees)for(const h of a.handles||[]){const i=byHandle.get(h);if(i!==undefined)entities[i]=G.rotate(entities[i],a.center||p.p1,degrees);}
   continue;
  }
  if(p.kind!=='linear'&&p.kind!=='xy')continue;
  const delta=p.kind==='xy'?xyShift(dyn,a,values):shift(p,a,values[p.id]),v={x:direction*delta.x,y:direction*delta.y};if(!v.x&&!v.y)continue;
  if(a.kind==='move'){for(const h of a.handles||[])move(h,v);continue;}
  if(a.kind!=='stretch')continue;
  for(const b of a.bindings||[]){
   const i=byHandle.get(b.h);if(i===undefined)continue;
   const e=entities[i],target=e.type==='block'&&e.entities?.length===1?e.entities[0]:e; // WIPEOUT comes in as a block holding its boundary
   if(POINT_TYPES.has(b.t)&&Array.isArray(target.points)){for(const k of b.points)if(target.points[k])target.points[k]={x:target.points[k].x+v.x,y:target.points[k].y+v.y};delete e._renderBounds;}
   else move(b.h,v);
  }
 }
 for(const e of entities)for(const q of e.points||[])if(!Number.isFinite(q.x)||!Number.isFinite(q.y))throw Error('동적 블록 계산 결과에 잘못된 좌표가 있습니다.');
 return entities;
}

// Bring only action-controlled attributes back to definition coordinates, undo
// their previous actions, then apply the requested actions. Keep reference text
// and formatting, including per-insert offsets; unrelated attributes stay exact.
function changedAttributes(definition,dyn,ref,values){
 const attached=(ref.entities||[]).filter(e=>e.type==='text'&&e.attributeTag!==undefined);
 if(!attached.length)return attached;
 const definitions=new Map([...(dyn.attributeDefinitions||[]).map(e=>[String(e.tag).toUpperCase(),e]),...definition.entities.filter(e=>e.attdef).map(e=>[String(e.attdef.tag).toUpperCase(),e])]);
 const handles=new Set(dyn.actions.flatMap(a=>[...(a.handles||[]),...(a.bindings||[]).map(b=>b.h)]));
 const controlled=attached.map((e,i)=>({e,i,handle:definitions.get(String(e.attributeTag).toUpperCase())?.sourceHandle})).filter(q=>q.handle!==undefined&&handles.has(q.handle));
 if(!controlled.length)return attached;
 const selected=new Set(controlled.map(q=>q.handle)),actions=dyn.actions.filter(a=>(a.handles||[]).some(h=>selected.has(h))||(a.bindings||[]).some(b=>selected.has(b.h)));
 const previous=currentValues(dyn,ref.dynamic?.values);
 for(const a of actions){
  const params=[actionParameter(dyn,a),...['xConnection','yConnection'].map(k=>dyn.parameters.find(p=>p.id===a[k]?.id))].filter(Boolean);
  if(params.some(p=>!knownParameter(p,previous[p.id])))throw Error('속성 글자의 원래 위치를 계산할 값을 알 수 없어 모양을 바꿀 수 없습니다. 원본 모양을 유지합니다.');
 }
 const [sx,sy]=G.referenceScales(ref),origin=definition.origin||{x:0,y:0},insert=ref.position||{x:0,y:0},r=(ref.rotation||0)*Math.PI/180;
 const local=controlled.map(({e,handle})=>{
  const text=G.transformEntity(e,point=>{const v=turn({x:point.x-insert.x,y:point.y-insert.y},-r);return {x:origin.x+v.x/sx*(ref.mirror?-1:1),y:origin.y+v.y/sy};},{scale:1/sy});
  text.rotation=ref.mirror?(ref.rotation||0)-(e.rotation||0):(e.rotation||0)-(ref.rotation||0);
  if(sx!==sy)text.widthFactor=(e.widthFactor??1)*sy/sx;
  if(ref.mirror)text.align=mirroredAlign(e.align);
  delete text.attdef;return {...text,sourceHandle:handle};
 });
 const actionDyn={...dyn,actions};
 const changed=applyActions(applyActions(local,actionDyn,previous,-1,true),actionDyn,values,1,true);
 const placed=changed.map(e=>{
  // Placement and its inverse preserve fitting points. Only an actual flip
  // action uses the geometry module's policy for mirrored text fitting.
  const text=G.transformEntity(e,point=>{const v=turn({x:(point.x-origin.x)*sx*(ref.mirror?-1:1),y:(point.y-origin.y)*sy},r);return {x:insert.x+v.x,y:insert.y+v.y};},{scale:sy});
  text.rotation=ref.mirror?((ref.rotation||0)-(e.rotation||0)+360)%360:(e.rotation||0)+(ref.rotation||0);
  if(sx!==sy)text.widthFactor=(e.widthFactor??1)*sx/sy;
  if(ref.mirror)text.align=mirroredAlign(e.align);
  return text;
 });
 for(let i=0;i<controlled.length;i++){
  const {e,i:index,handle}=controlled[i];
  const flips=actions.filter(a=>a.kind==='flip'&&(a.handles||[]).includes(handle)&&previous[actionParameter(dyn,a)?.id]!==values[actionParameter(dyn,a)?.id]).length;
  if(flips%2&&placed[i].justify){delete placed[i].justify;delete placed[i].alignPoint;delete placed[i].fitTo;}
  attached[index]={...placed[i],id:e.id,sourceHandle:e.sourceHandle};
 }
 return attached;
}

/** Changes that turn a dynamic reference into its shape for the given values. */
export function dynamicChanges(doc,ref,values,warnings=[]){
 const found=dynamicDefinition(doc,ref);if(!found)throw Error('동적 블록 정의가 없습니다.');
 const {source,definition}=found,dyn=definition.dynamic;
 if(dyn.unsupported?.length)throw Error('이 블록에는 아직 지원하지 않는 동작이 있어 모양을 바꿀 수 없습니다. 원본 모양을 유지합니다.');
 values={...values};
 for(const p of dyn.parameters)if(p.kind==='visibility')values[p.id]=visibilityValue(p,values[p.id],warnings);
 for(const p of dyn.parameters){
  const v=values[p.id];
  if(p.kind!=='visibility'&&!validValue(p,p.value))throw Error(`'${p.label||LABELS[p.kind]}'의 원래 기준값을 알 수 없어 모양을 바꿀 수 없습니다. 원본 모양을 유지합니다.`);
  if(p.kind==='visibility'&&!p.states.some(s=>s.name===v))throw Error(`'${p.label}' 상태를 고르세요.`);
  if(p.kind==='linear'&&!(typeof v==='number'&&Number.isFinite(v)&&v>0))throw Error(`'${p.label}' 값은 0보다 커야 합니다.`);
  if(p.kind==='flip'&&!(v===0||v===1))throw Error(`'${p.label||'대칭'}' 상태를 고르세요.`);
  if(p.kind==='flip'&&(!p.p1||!p.p2||Math.hypot(p.p2.x-p.p1.x,p.p2.y-p.p1.y)<1e-12))throw Error('대칭 기준선이 올바르지 않습니다.');
  if(p.kind==='rotation'&&!(typeof v==='number'&&Number.isFinite(v)))throw Error(`'${p.label||'회전'}' 각도를 입력하세요.`);
  if(p.kind==='xy'&&!(v&&Number.isFinite(v.x)&&Number.isFinite(v.y)))throw Error(`'${p.label||'가로·세로 거리'}'의 가로·세로 거리를 입력하세요.`);
 }
 // Attribute children already use drawing coordinates. Keep only these from
 // the previous shape; carrying its geometry would duplicate every action.
 const attached=changedAttributes(definition,dyn,ref,values);
 const tags=new Set(attached.map(e=>String(e.attributeTag).toUpperCase()));
 const key='\u0000dynamic:'+source,entities=computeEntities(definition,dyn,values).filter(e=>!e.attdef||!tags.has(String(e.attdef.tag).toUpperCase()));
 const placed=G.materializeSharedDrawingReference({sharedBlocks:{...doc.sharedBlocks,[key]:{origin:definition.origin,entities}}},
  {...ref,sharedBlock:key,entities:attached});
 return {sharedBlock:undefined,entities:placed.entities,position:ref.position,scale:ref.scale??1,rotation:ref.rotation??0,dynamic:{source,values:{...values}}};
}


/** Build fields only when DYNB opens; warnings stay visible until it closes. */
export function dynamicEditor(dyn,stored={}){
 const warnings=[],params=describeParameters(dyn,currentValues(dyn,stored,warnings));
 if(dyn.unsupported?.length)warnings.push('이 블록에는 아직 지원하지 않는 동작이 있어 모양을 바꿀 수 없습니다. 원본 모양을 유지합니다.');
 for(const p of params)if(p.kind!=='visibility'&&p.kind!=='linear'&&p.value==null)warnings.push(`'${p.label}'의 원래 값을 알 수 없습니다. 원하는 값을 직접 고르거나 입력하세요.`);
 const fields=warnings.map((value,i)=>({name:'warning'+i,label:'알림',readonly:true,value}));
 for(const p of params){
  const name='p'+p.id;
  if(p.kind==='visibility')fields.push({name,label:p.label,value:p.value??p.default,options:p.states.map(s=>[s,s])});
  else if(p.kind==='flip')fields.push({name,label:p.label,value:p.value??'',options:[['','선택하세요'],['0',p.labels?.[0]||'기본'],['1',p.labels?.[1]||'뒤집기']]});
  else if(p.kind==='xy')for(const axis of ['x','y'])fields.push({name:name+axis,label:(p[axis==='x'?'labelX':'labelY']||(p.label+(axis==='x'?' · 가로':' · 세로')))+' (mm)',type:'number',value:p.value?.[axis]??''});
  else fields.push({name,label:p.label+(p.kind==='rotation'?' (도)':' (mm)'),type:'number',value:p.value==null?(p.kind==='linear'?p.default:''):p.kind==='rotation'?p.value*180/Math.PI:p.value});
 }
 return {params,fields,warnings};
}
export function dynamicEditorValues(params,fields){
 const empty=v=>v==null||typeof v==='string'&&v.trim()==='';
 const values={};for(const p of params){
  if(p.kind==='xy'){
   const x=fields['p'+p.id+'x'],y=fields['p'+p.id+'y'];
   values[p.id]=empty(x)||empty(y)?null:{x:Number(x),y:Number(y)};continue;
  }
  const v=fields['p'+p.id];
  values[p.id]=empty(v)?null:p.kind==='visibility'?String(v):p.kind==='rotation'?Number(v)*Math.PI/180:Number(v);
 }
 return values;
}
