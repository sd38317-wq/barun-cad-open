// 공유 블록(정의 1개 + 참조의 변환) 도우미. AutoCAD 의 BTR/INSERT 구조를 우리 문서 모양(doc.sharedBlocks + {sharedBlock} 참조)에 맞춘 것.
// - 601 우리 블록도 정의 하나 + 참조로 만든다(engine block.create shared).
// - 602 정의 → 참조 역색인(문서 배열마다 한 번, 중첩 정의는 부모 목록으로 위로 올라간다).
// - 603 정의별 통계는 정의마다 한 번만 세고 곱한다.
// - 604 참조 변환 행렬(비균일 축척 포함)·MINSERT 를 참조 여러 개로.
// - 607 사본형 블록 → 공유 정의 이전(migration).
// - 609 매개변수 값마다 공유 정의 하나(같은 값의 문 500개 = 정의 1개 + 참조 500개).
// 모두 순수 함수다. 문서를 고치지 않고 새 객체·명령을 돌려준다. 화면 경로(매 프레임)에서는 부르지 않는다.
import * as G from './geometry.js';

/* ── 정의 묶음 갱신(불변) ──
   정의 묶음은 되돌리기 기록끼리 같이 쓰는 불변 객체다. 바꿀 때는 새 객체를 만들고, 어느 키가 바뀌었는지 기록해 둔다.
   엔진 검사(validate)는 이 기록으로 바뀐 정의만 다시 검사한다(예전: 정의 1,600개 전체). */
const derivations=new WeakMap();
export function withSharedDefinitions(base,changes){
  const next={...(base||{})},keys=new Set();
  for(const [key,value] of Object.entries(changes||{})){keys.add(key);if(value==null)delete next[key];else next[key]=value;}
  if(base)derivations.set(next,{base,keys});
  return next;
}
export const sharedDerivation=definitions=>definitions&&derivations.get(definitions)||null;

/** 정의 안에서 key 를 (직접·간접으로) 쓰는 정의 키 전부(자기 포함). 정의 묶음마다 역그래프를 한 번 만든다. */
const reverseGraphs=new WeakMap();
function reverseGraph(definitions){
  let graph=reverseGraphs.get(definitions);
  if(graph)return graph;
  graph=new Map();
  const visit=(owner,entity)=>{if(entity?.sharedBlock){if(!graph.has(entity.sharedBlock))graph.set(entity.sharedBlock,new Set());graph.get(entity.sharedBlock).add(owner);}for(const child of entity?.entities||[])visit(owner,child);};
  for(const [key,definition] of Object.entries(definitions||{}))for(const child of definition?.entities||[])visit(key,child);
  reverseGraphs.set(definitions,graph);return graph;
}
export function definitionUsers(definitions,key){
  const out=new Set(),stack=[key],graph=reverseGraph(definitions||{});
  while(stack.length){const k=stack.pop();if(out.has(k))continue;out.add(k);for(const parent of graph.get(k)||[])stack.push(parent);}
  return out;
}
/** 정의 key 가 (중첩 포함) target 을 쓰는가 — 자기 자신을 넣는 순환 블록을 막는다. */
export function refersTo(definitions,entity,target,seen=new Set()){
  if(!entity)return false;
  if(entity.sharedBlock){if(entity.sharedBlock===target)return true;if(!seen.has(entity.sharedBlock)){seen.add(entity.sharedBlock);for(const child of definitions?.[entity.sharedBlock]?.entities||[])if(refersTo(definitions,child,target,seen))return true;}}
  for(const child of entity.entities||[])if(refersTo(definitions,child,target,seen))return true;
  return false;
}

/* ── 정의 만들기·참조 만들기 ── */
const stripIds=entity=>{const copy={...entity};delete copy.id;if(copy.entities)copy.entities=copy.entities.map(stripIds);return copy;};
/** 도면 객체를 기준점 기준 로컬 좌표 정의 자식으로(사본, id 없음). */
export function localizeEntities(entities,base={x:0,y:0}){
  return (entities||[]).map(entity=>stripIds(G.translate(entity,-(base.x||0),-(base.y||0))));
}
/** INSERT 목록(doc.blocks)에 보일 공유 정의 견본. engine block.insert 의 공유 경로가 이 견본을 옮겨 참조를 만든다. */
export const sharedTemplate=(name,key=name)=>({name,sharedBlock:key,position:{x:0,y:0},scale:1,rotation:0,entities:[]});
export function sharedReference(key,definition,{position={x:0,y:0},scale=1,scaleX,scaleY,rotation=0,mirror=false,layer,attributes,visibility,parameters,category}={}){
  const ref={type:'block',name:definition?.name||key,sharedBlock:key,layer,position:{x:position.x,y:position.y},scale,rotation,entities:[]};
  if(scaleX!==undefined&&scaleY!==undefined&&Math.abs(scaleX-scaleY)>1e-12){ref.scaleX=scaleX;ref.scaleY=scaleY;}
  if(mirror)ref.mirror=true;
  if(attributes&&Object.keys(attributes).length)ref.attributes={...attributes};
  if(visibility)ref.visibility=visibility;
  if(parameters)ref.parameters={...parameters};
  if(category)ref.category=category;
  return ref;
}
/** 정의의 속성 정의(ATTDEF = attdef 표시가 붙은 문자) 목록. */
export function attributeDefinitions(definition){
  const out=[];const visit=e=>{if(e?.attdef)out.push(e);};for(const child of definition?.entities||[])visit(child);return out;
}
/** 정의에 있는 가시성 상태 이름(처음 나온 순서). */
export function visibilityStates(definition){
  const out=[];for(const child of definition?.entities||[])for(const state of child?.states||[])if(!out.includes(state))out.push(state);return out;
}

/* ── 602 역색인 ── 문서 객체 배열(편집마다 새 배열)마다 한 번 만든다. 화면 전용, 저장하지 않는다. */
const refIndexes=new WeakMap();
export function buildSharedRefIndex(doc){
  const entities=doc?.entities||[];
  let index=refIndexes.get(entities);
  if(index&&index.definitions===doc.sharedBlocks)return index;
  const top=new Map(),parents=new Map();
  const add=(map,key,value)=>{let set=map.get(key);if(!set){set=new Set();map.set(key,set);}set.add(value);};
  for(const entity of entities)if(entity?.sharedBlock)add(top,entity.sharedBlock,entity);
  const visit=(owner,entity)=>{if(entity?.sharedBlock)add(parents,entity.sharedBlock,owner);for(const child of entity?.entities||[])visit(owner,child);};
  for(const [key,definition] of Object.entries(doc?.sharedBlocks||{}))for(const child of definition?.entities||[])visit(key,child);
  index={top,parents,definitions:doc?.sharedBlocks};
  if(Array.isArray(entities))refIndexes.set(entities,index);
  return index;
}
/** key 를 직접·간접으로 쓰는 최상위 참조 전부(정의를 고친 뒤 다시 그릴 대상). */
export function referencesOf(index,key,seen=new Set()){
  if(seen.has(key))return [];seen.add(key);
  const out=[...(index.top.get(key)||[])];
  for(const parent of index.parents.get(key)||[])out.push(...referencesOf(index,parent,seen));
  return out;
}

/* ── 603 정의별 통계: 정의마다 한 번 세고, 참조는 곱한다 ── */
const statCaches=new WeakMap();
export function sharedDefinitionStats(definitions,key,stack=[]){
  let cache=statCaches.get(definitions);
  if(!cache){cache=new Map();statCaches.set(definitions,cache);}
  if(cache.has(key))return cache.get(key);
  if(stack.includes(key))throw Error('공유 블록 정의가 순환합니다.');
  const out={prims:0,points:0,blocks:new Map()};
  const addBlocks=(map,factor=1)=>{for(const [name,count] of map)out.blocks.set(name,(out.blocks.get(name)||0)+count*factor);};
  const visit=entity=>{
    if(entity?.sharedBlock){
      const stats=sharedDefinitionStats(definitions,entity.sharedBlock,[...stack,key]);
      out.prims+=stats.prims;out.points+=stats.points;
      out.blocks.set(entity.name||entity.sharedBlock,(out.blocks.get(entity.name||entity.sharedBlock)||0)+1);addBlocks(stats.blocks);
      for(const child of entity.entities||[])visit(child);
    }else if(entity?.type==='block'){
      if(!entity.table)out.blocks.set(entity.name||'(이름 없음)',(out.blocks.get(entity.name||'(이름 없음)')||0)+1);
      for(const child of entity.entities||[])visit(child);
    }else if(entity){out.prims++;out.points+=entity.points?.length||1;}
  };
  for(const child of definitions?.[key]?.entities||[])visit(child);
  cache.set(key,out);return out;
}
/** 참조 하나가 펼치면 몇 개가 되는지(펼치지 않고). 열기 예산·LOD 판단용. */
export function referenceStats(definitions,ref){
  if(!ref?.sharedBlock)return null;
  const own=sharedDefinitionStats(definitions,ref.sharedBlock);
  return {prims:own.prims+(ref.entities?.length||0),points:own.points};
}

/* ── 604 참조 변환 행렬 [a c e; b d f] = T(위치)·R(회전)·S(±sx, sy)·T(-원점) ── */
export const IDENTITY=Object.freeze({a:1,b:0,c:0,d:1,e:0,f:0});
export function referenceMatrix(ref,origin={x:0,y:0}){
  const [sx,sy]=G.referenceScales(ref);
  const r=(Number(ref.rotation)||0)*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  const mx=ref.mirror===true?-sx:sx,p=ref.position||{x:0,y:0},ox=origin?.x||0,oy=origin?.y||0;
  return {a:c*mx,b:s*mx,c:-s*sy,d:c*sy,e:p.x-(c*mx*ox-s*sy*oy),f:p.y-(s*mx*ox+c*sy*oy)};
}
export const applyMatrix=(m,q)=>({x:m.a*q.x+m.c*q.y+m.e,y:m.b*q.x+m.d*q.y+m.f});
/** m·n (n 을 먼저 적용). */
export const composeMatrix=(m,n)=>({a:m.a*n.a+m.c*n.b,b:m.b*n.a+m.d*n.b,c:m.a*n.c+m.c*n.d,d:m.b*n.c+m.d*n.d,e:m.a*n.e+m.c*n.f+m.e,f:m.b*n.e+m.d*n.f+m.f});
export function invertMatrix(m){
  const det=m.a*m.d-m.b*m.c;if(Math.abs(det)<1e-18)throw Error('변환을 되돌릴 수 없습니다(축척 0).');
  return {a:m.d/det,b:-m.b/det,c:-m.c/det,d:m.a/det,e:(m.c*m.f-m.d*m.e)/det,f:(m.b*m.e-m.a*m.f)/det};
}
/** 중첩 경로(최상위 참조 → 안쪽 참조 …)의 누적 변환. AutoCAD REFEDIT calculateXform 과 같은 순서. */
export function pathMatrix(definitions,path){
  let m=IDENTITY;
  for(const ref of path){const origin=definitions?.[ref.sharedBlock]?.origin||{x:0,y:0};m=composeMatrix(m,referenceMatrix(ref,origin));}
  return m;
}
/** 행렬을 이동·회전·축척·대칭으로 나눈다(전단 없는 변환만). G.transformEntity 로 객체 전체를 옮길 때 쓴다. */
export function decomposeMatrix(m){
  const sx=Math.hypot(m.a,m.b),det=m.a*m.d-m.b*m.c,mirror=det<0,sy=Math.abs(det)/sx;
  const rotation=Math.atan2(mirror?-m.b:m.b,mirror?-m.a:m.a)*180/Math.PI;
  return {sx,sy,rotation,mirror};
}
/** 행렬로 객체 하나를 옮긴다(점·문자 각도·호 각도·자식까지). 균일 축척만 정확하다(비균일은 점만 옮긴다). */
export function transformByMatrix(entity,m){
  const {sx,sy,rotation,mirror}=decomposeMatrix(m);
  const fn=p=>applyMatrix(m,p);
  return G.transformEntity(entity,fn,{scale:Math.sqrt(sx*sy),rotation:mirror?rotation+180:rotation,mirror});
}
/** MINSERT(행·열 배열 삽입) → 같은 정의를 쓰는 참조 rows×cols 개. 간격은 삽입 회전을 따른다. 정의는 펼치지 않는다. */
export function arrayReferences(ref){
  const {rows=1,cols=1,dx=0,dy=0}=ref.array||{},out=[];
  if(!(Number.isInteger(rows)&&Number.isInteger(cols)&&rows>0&&cols>0&&rows*cols<=100000))throw Error('MINSERT 행·열 수가 잘못되었습니다.');
  const a=(Number(ref.rotation)||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  for(let i=0;i<rows;i++)for(let j=0;j<cols;j++){
    const lx=j*dx,ly=i*dy,{array,...rest}=ref;
    out.push({...rest,position:{x:ref.position.x+lx*c-ly*s,y:ref.position.y+lx*s+ly*c}});
  }
  return out;
}

/* ── 605·607 사본형 블록 → 공유 정의 이전 ──
   같은 이름 + 같은 모양(블록 기준점 기준, 0.001 mm 반올림)이면 정의 하나를 같이 쓴다. 기준점은 position, 없으면 범위 왼쪽 아래.
   모양만 같고 회전된 사본은 615(BLOCKSPOT)가 맡는다. 바꿀 수 없는 블록(표·외부참조·클립·매개변수·연동)은 그대로 둔다. */
const round=v=>Math.round(v*1000)/1000;
const canonical=value=>{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort()){if(key==='id'||key.startsWith('_'))continue;out[key]=canonical(value[key]);}return out;}
  return typeof value==='number'?round(value):value;
};
export const shapeHash=(name,body)=>name+'|'+JSON.stringify(canonical(body));
const LINKED=['hostWall','roomBoundary','scheduleKind','lineWallHost','parcelRole','plotBox'];
export function migratablePlainBlock(entity){
  return entity?.type==='block'&&!entity.sharedBlock&&!entity.xref&&!entity.table&&!entity.clip&&!entity.parameters&&!entity.category&&Array.isArray(entity.entities)&&entity.entities.length>0&&!LINKED.some(key=>entity[key])&&!entity.entities.some(child=>LINKED.some(key=>child?.[key]));
}
export function migratePlainBlocks(doc,{names=null,min=2}={}){
  const definitions=doc.sharedBlocks||{},groups=new Map();
  for(const entity of doc.entities||[]){
    if(!migratablePlainBlock(entity)||names&&!names.includes(entity.name))continue;
    let base=entity.position;
    if(!base){const b=G.bounds(entity.entities);if(!b)continue;base={x:b.minX,y:b.minY};}
    const body=localizeEntities(entity.entities,base),hash=shapeHash(entity.name||'',body);
    let group=groups.get(hash);if(!group){group={name:entity.name||'블록',body,members:[]};groups.set(hash,group);}
    group.members.push({entity,base});
  }
  const changes={},templates=[],updates=[];let index=0;
  for(const group of groups.values()){
    if(group.members.length<min)continue;
    let key=group.name;while(definitions[key]||changes[key])key=`${group.name}#${++index}`;
    changes[key]={name:group.name,origin:{x:0,y:0},entities:group.body};templates.push(sharedTemplate(group.name,key));
    for(const {entity,base} of group.members){
      const {entities,id,type,position,...rest}=entity;
      updates.push({id,replacement:{...rest,type:'block',id,name:group.name,sharedBlock:key,position:{x:base.x,y:base.y},scale:1,rotation:0,entities:[]}});
    }
  }
  return {definitions:changes,templates,updates,groups:Object.keys(changes).length,converted:updates.length};
}

/* ── 609 매개변수 값마다 공유 정의 하나 ── 값(숫자는 0.001 반올림)을 정렬해 키를 만든다(AutoCAD 의 익명 *U 정의). */
export const parametricKey=(kind,params)=>'@'+kind+'#'+JSON.stringify(Object.keys(params||{}).sort().map(key=>[key,typeof params[key]==='number'?round(params[key]):params[key]]));
/** build(params) 는 원점 기준 도형 목록. 정의가 없을 때만 부른다. 돌려주는 definition 이 null 이면 이미 있는 정의를 쓴다. */
export function parametricReference(definitions,kind,params,build,{position={x:0,y:0},rotation=0,mirror=false,layer,name=kind}={}){
  const key=parametricKey(kind,params);
  let definition=null;
  if(!definitions?.[key]){
    const local=(build(params)||[]).map(stripIds);
    if(!local.length)throw Error('매개변수 블록 도형이 비어 있습니다.');
    definition={name,origin:{x:0,y:0},entities:local,parametric:{kind,params:{...params}}};
  }
  const ref=sharedReference(key,definition||definitions[key],{position,rotation,mirror,layer,parameters:undefined});
  ref.blockParameters={...params};ref.name=name;
  return {key,definition,ref};
}
