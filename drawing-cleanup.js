// 도면 정리 순수 함수: PURGE(소거)·OVERKILL(중복 객체 삭제)·AUDIT(도면 검사).
// 모두 문서를 고치지 않고 "할 일 목록"만 돌려준다. 실행(엔진 명령 묶음)은 app.js 가 한 번의 batch 로 한다(되돌리기 한 단계).
// 19만 객체 도면에서도 O(n log n): 선은 속성별 → 방향 정렬 → 오프셋 정렬 → 구간 정렬로 묶는다. 화면·커서 경로에서는 부르지 않는다.
import {cleanBlockDefinitions} from './block-tools.js';
import {mergeCircularSpans} from './curve-edit.js';

const isFiniteNumber=value=>typeof value==='number'&&Number.isFinite(value);
const LINKED_FLAGS=['hostWall','lineWallHost','roomBoundary','scheduleKind','parcelRole','plotBox','dimensionLabel','numberLabel'];
const isLinked=entity=>LINKED_FLAGS.some(key=>entity[key]);

/* ─────────────── PURGE ─────────────── */

/* 220 참조 내보내기(AutoCAD AcDbPurgeFiler 처럼): 객체가 가리키는 기호(레이어·블록·공유 정의·치수 스타일)를 emit 한다.
   PURGE·WBLOCK 이 같이 쓴다. 새 참조 필드가 생기면 여기만 고치면 된다. 공유 정의 안은 정의마다 한 번만 들어간다. */
export function refsOf(entity,emit,definitions=null,seenDefinitions=new Set()){
  if(!entity||typeof entity!=='object')return;
  if(entity.layer)emit('layer',entity.layer);
  if(entity.dimStyle)emit('dimStyle',entity.dimStyle);
  if(entity.type==='block'&&entity.name)emit('block',entity.name);
  if(entity.sharedBlock){
    emit('sharedBlock',entity.sharedBlock);
    if(definitions&&!seenDefinitions.has(entity.sharedBlock)){seenDefinitions.add(entity.sharedBlock);for(const child of definitions[entity.sharedBlock]?.entities||[])refsOf(child,emit,definitions,seenDefinitions);}
  }
  for(const child of entity.entities||[])refsOf(child,emit,definitions,seenDefinitions);
}
/** 후보(종류 → 이름 집합)에서 쓰이는 것을 지운다. 후보가 다 지워지면 바로 끝낸다(대부분 레이어가 쓰이는 큰 도면에서 일찍 멈춘다). */
export function planPurgeAll(doc,candidates,{roots=doc?.entities||[],extraRoots=[]}={}){
  let left=0;for(const set of candidates.values())left+=set.size;
  const definitions=doc?.sharedBlocks||null,seen=new Set();
  const emit=(kind,name)=>{if(candidates.get(kind)?.delete(name))left--;};
  for(const list of [roots,extraRoots]){for(const entity of list){if(!left)return candidates;refsOf(entity,emit,definitions,seen);}}
  return candidates;
}
/** 622 최상위 참조에서 닿는 공유 정의 키(중첩 포함). */
export function usedSharedKeys(doc,roots=doc?.entities||[]){
  const used=new Set(),definitions=doc?.sharedBlocks||{};
  const visit=entity=>{if(!entity||typeof entity!=='object')return;if(entity.sharedBlock&&!used.has(entity.sharedBlock)){used.add(entity.sharedBlock);for(const child of definitions[entity.sharedBlock]?.entities||[])visit(child);}for(const child of entity.entities||[])visit(child);};
  for(const entity of roots)visit(entity);
  return used;
}
/** 안 쓰는 공유 정의(재귀라 한 번에 중첩까지). 외부참조 정의도 참조가 없으면 지운다. */
export function purgeSharedPlan(doc,roots=doc?.entities||[]){
  const used=usedSharedKeys(doc,roots);
  return Object.keys(doc?.sharedBlocks||{}).filter(key=>!used.has(key));
}

/** 쓰지 않는 블록 정의(재귀)·공유 정의(중첩)와 객체가 하나도 없는 레이어를 찾는다.
 *  지울 수 없는 레이어: '0', 현재 레이어, Defpoints, 외부참조 의존 레이어, 남는 블록 정의·공유 정의 안에서 쓰는 레이어.
 *  options.emptyGeometry 가 참이면 길이 0 선·빈 문자도 지울 목록에 넣는다(AutoCAD PURGE 의 같은 선택 사항). */
export function planPurge(doc,{currentLayer=null,emptyGeometry=false}={}){
  const blockResult=cleanBlockDefinitions({entities:doc?.entities||[],blocks:doc?.blocks||[]});
  const removeBlocks=new Set(blockResult.removed);
  const eraseIds=emptyGeometry?emptyGeometryIds(doc?.entities||[]):[];
  const erased=new Set(eraseIds);
  const roots=erased.size?(doc?.entities||[]).filter(entity=>!erased.has(entity.id)):(doc?.entities||[]);
  const keptTemplates=blockResult.blocks.filter(block=>block.sharedBlock).map(block=>({sharedBlock:block.sharedBlock}));
  const sharedKeys=purgeSharedPlan(doc||{},[...roots,...keptTemplates]);
  const layerCandidates=new Set((doc?.layers||[]).filter(layer=>layer.id!==currentLayer&&layer.name!=='0'&&String(layer.name).toUpperCase()!=='DEFPOINTS'&&!layer.xref).map(layer=>layer.id));
  const candidates=new Map([['layer',layerCandidates]]);
  planPurgeAll(doc||{},candidates,{roots,extraRoots:[...blockResult.blocks.flatMap(block=>block.entities||[]),...keptTemplates]});
  const layers=(doc?.layers||[]).filter(layer=>layerCandidates.has(layer.id));
  // 마지막 레이어는 지우지 않는다(엔진 규칙).
  if(layers.length&&layers.length>=(doc?.layers||[]).length)layers.pop();
  return {
    layers:layers.map(layer=>({id:layer.id,name:layer.name})),
    blocks:[...removeBlocks],
    keptBlocks:blockResult.blocks,
    sharedKeys,
    sharedNames:sharedKeys.map(key=>doc.sharedBlocks[key]?.name&&doc.sharedBlocks[key].name!==key?`${doc.sharedBlocks[key].name}(${key})`:key),
    eraseIds,
    total:layers.length+removeBlocks.size+eraseIds.length+sharedKeys.length,
  };
}

/** 622 WBLOCK: 고른 객체와 그것이 쓰는 레이어·공유 정의·블록 견본만 담은 새 문서. 기준점을 원점으로 옮긴다. */
export function wblockDocument(doc,entities,base={x:0,y:0},translate=null){
  const moved=(base.x||base.y)&&translate?entities.map(entity=>translate(entity,-base.x,-base.y)):entities.map(entity=>structuredClone(entity));
  const keys=usedSharedKeys(doc,moved),sharedBlocks=Object.fromEntries([...keys].map(key=>[key,doc.sharedBlocks[key]]));
  const candidates=new Map([['layer',new Set(doc.layers.map(layer=>layer.id))],['block',new Set((doc.blocks||[]).map(block=>block.name))]]);
  planPurgeAll({sharedBlocks},candidates,{roots:moved});
  const usedLayers=new Set(doc.layers.map(layer=>layer.id).filter(id=>!candidates.get('layer').has(id)));
  const usedBlocks=new Set((doc.blocks||[]).map(block=>block.name).filter(name=>!candidates.get('block').has(name)));
  const out={...doc,entities:moved,layers:doc.layers.filter(layer=>usedLayers.has(layer.id)||layer.name==='0'),blocks:(doc.blocks||[]).filter(block=>usedBlocks.has(block.name)&&(!block.sharedBlock||keys.has(block.sharedBlock))),sheets:[]};
  if(!out.layers.length)out.layers=[doc.layers[0]];
  if(keys.size){out.sharedBlocks=sharedBlocks;out.version=3;}else{delete out.sharedBlocks;if(out.version===3)out.version=2;}
  delete out.dxfPreservation;
  return out;
}

/** 길이 0 선과 내용 없는 문자(최상위 객체만). */
export function emptyGeometryIds(entities){
  const out=[];
  for(const entity of entities||[]){
    if(entity.type==='line'&&isZeroLengthLine(entity))out.push(entity.id);
    else if((entity.type==='text'||entity.type==='mtext')&&!String(entity.text??'').trim())out.push(entity.id);
  }
  return out;
}

/** planPurge 결과를 엔진 명령 하나(batch)로. 블록 정의를 먼저 줄여야 그 안에서만 쓰던 레이어를 지울 수 있다. */
export function purgeCommand(plan){
  const commands=[];
  if(plan.eraseIds?.length)commands.push({type:'delete',ids:plan.eraseIds});
  if(plan.blocks?.length)commands.push({type:'document.update',changes:{blocks:plan.keptBlocks}});
  if(plan.sharedKeys?.length)commands.push({type:'shared.purge',keys:plan.sharedKeys});
  if(plan.layers?.length)commands.push({type:'layer.purge',ids:plan.layers.map(layer=>layer.id)});
  return commands.length?{type:'batch',commands}:null;
}

/* ─────────────── OVERKILL ─────────────── */

const styleKey=(entity,ignoreLayer)=>[ignoreLayer?'':entity.layer??'',entity.color??'',entity.aci??'',entity.colorMode??'',entity.linetype??'',entity.linetypeScale??'',entity.lineweight??'',entity.transparency??''].join('\u0001');
const q=(value,tolerance)=>Math.round(value/tolerance);
const qp=(point,tolerance)=>q(point.x,tolerance)+','+q(point.y,tolerance);
const validPoint=point=>point&&isFiniteNumber(point.x)&&isFiniteNumber(point.y);
const normAngle=degrees=>{const value=((Number(degrees)||0)%360+360)%360;return value>=360-1e-9?0:value;};

function duplicateKey(entity,tolerance,ignoreLayer){
  const style=styleKey(entity,ignoreLayer);
  switch(entity.type){
    case 'circle':
      if(!validPoint(entity.center)||!isFiniteNumber(entity.radius))return null;
      return ['c',style,qp(entity.center,tolerance),q(entity.radius,tolerance)].join('|');
    case 'arc':{
      if(!validPoint(entity.center)||!isFiniteNumber(entity.radius))return null;
      // 각도 대신 양 끝점을 비교한다(반지름이 커도 같은 공차로 판정된다).
      const at=degrees=>{const r=normAngle(degrees)*Math.PI/180;return {x:entity.center.x+entity.radius*Math.cos(r),y:entity.center.y+entity.radius*Math.sin(r)};};
      return ['a',style,qp(entity.center,tolerance),q(entity.radius,tolerance),qp(at(entity.startAngle),tolerance),qp(at(entity.endAngle),tolerance)].join('|');
    }
    case 'point':
      return validPoint(entity.position)?['p',style,qp(entity.position,tolerance)].join('|'):null;
    case 'text':case 'mtext':
      if(!validPoint(entity.position))return null;
      return ['t',entity.type,style,qp(entity.position,tolerance),q(Number(entity.height)||0,tolerance),String(entity.text??''),normAngle(entity.rotation).toFixed(6),entity.align??'',entity.font??entity.style??'',entity.width??''].join('|');
    case 'polyline':case 'rectangle':{
      const points=entity.points;
      if(!Array.isArray(points)||points.length<2||!points.every(validPoint)||points.some(point=>point.bulge))return null;
      const forward=points.map(point=>qp(point,tolerance)).join(';'),backward=points.map(point=>qp(point,tolerance)).reverse().join(';');
      return ['l',entity.type,style,entity.closed?1:0,forward<backward?forward:backward].join('|');
    }
    case 'block':
      if(entity.table||!validPoint(entity.position))return null;
      return ['b',style,String(entity.name??''),entity.sharedBlock??'',qp(entity.position,tolerance),(Number(entity.scale??1)).toFixed(9),(Number(entity.scaleY??entity.scale??1)).toFixed(9),normAngle(entity.rotation).toFixed(6),JSON.stringify(entity.attributes||{})].join('|');
    default:return null;
  }
}

function isZeroLengthLine(entity){
  const [a,b]=entity.points||[];
  return validPoint(a)&&validPoint(b)&&Math.hypot(b.x-a.x,b.y-a.y)<1e-9;
}

/** 중복 객체와 겹친 같은 직선 위의 선을 찾는다.
 *  doc: 문서, options.ids: 대상 객체 id(없으면 전부), tolerance(기본 0.01mm), ignoreLayer(기본 false),
 *  options.lockedLayers: 잠긴 레이어 id 집합(대상에서 뺀다).
 *  돌려주는 값: {deleteIds, updates:[{id,changes:{points}}], duplicates, merged}. */
export function planOverkill(doc,{ids=null,tolerance=0.01,ignoreLayer=false,lockedLayers=null,endToEnd=false}={}){
  const tol=Number(tolerance);
  if(!(tol>0)||!Number.isFinite(tol))throw Error('공차는 0보다 큰 숫자여야 합니다.');
  const wanted=ids?new Set(ids):null;
  const locked=lockedLayers instanceof Set?lockedLayers:new Set(lockedLayers||[]);
  const entities=doc?.entities||[];
  const deleteIds=new Set(),updates=[],adds=[];
  let duplicates=0,merged=0;
  const nearIndex=nearDuplicateIndex(tol,ignoreLayer);
  const lineGroups=new Map(),arcs=[];
  entities.forEach((entity,order)=>{
    if(!entity||(wanted&&!wanted.has(entity.id))||locked.has(entity.layer)||isLinked(entity)||entity.hidden)return;
    if(entity.type==='line'){
      const [a,b]=entity.points||[];
      if(!validPoint(a)||!validPoint(b)||entity.points.length!==2)return;
      const length=Math.hypot(b.x-a.x,b.y-a.y);
      if(length<=tol)return; // 길이 0 수준의 선은 AUDIT 가 맡는다.
      const key=styleKey(entity,ignoreLayer);
      let list=lineGroups.get(key);if(!list){list=[];lineGroups.set(key,list);}
      list.push({entity,order,a,b,length});
      return;
    }
    // 호는 같은 원 위 호끼리 겹친 구간을 합친다(아래 mergeArcs) — 완전히 같은 호도 거기서 '중복'으로 센다.
    if(entity.type==='arc'&&validPoint(entity.center)&&isFiniteNumber(entity.radius)&&entity.radius>tol){arcs.push({entity,order});return;}
    if(nearIndex.seen(entity)){deleteIds.add(entity.id);duplicates++;}
  });
  const arcResult=mergeArcs(arcs,tol,ignoreLayer,endToEnd);
  for(const id of arcResult.deleteIds)deleteIds.add(id);
  updates.push(...arcResult.updates);adds.push(...arcResult.adds);
  duplicates+=arcResult.duplicates;merged+=arcResult.merged;
  for(const lines of lineGroups.values()){
    const result=mergeCollinear(lines,tol,endToEnd);
    for(const id of result.deleteIds)deleteIds.add(id);
    updates.push(...result.updates);
    duplicates+=result.duplicates;merged+=result.merged;
  }
  return {deleteIds:[...deleteIds],updates,adds,duplicates,merged,total:deleteIds.size};
}

/* 공차 경계 문제(ACAD200-419): Math.round(v/공차) 칸만 보면 0.0049 와 0.0051(공차 0.01)처럼 가까운 값이 다른 칸에 들어가
   같은 것으로 못 본다. 기준점(중심·위치·가장 왼쪽 점)이 든 칸과 이웃 8칸을 함께 보고, 나머지 값은 실제 차이로 견준다. */
function nearDuplicateIndex(tol,ignoreLayer){
  const cells=new Map();
  return {seen(entity){
    const key=duplicateKey(entity,tol,ignoreLayer);if(!key)return false;
    const anchor=anchorOf(entity);if(!validPoint(anchor))return false;
    const kind=key.split('|',1)[0]+'|'+styleKey(entity,ignoreLayer),cx=Math.floor(anchor.x/tol),cy=Math.floor(anchor.y/tol);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const other of cells.get(kind+'|'+(cx+dx)+','+(cy+dy))||[])if(sameWithin(other,entity,tol))return true;
    const own=kind+'|'+cx+','+cy;let list=cells.get(own);if(!list){list=[];cells.set(own,list);}list.push(entity);
    return false;
  }};
}
const anchorOf=entity=>entity.type==='circle'?entity.center:entity.type==='polyline'||entity.type==='rectangle'?leftmost(entity.points):entity.position;
const leftmost=points=>(points||[]).reduce((best,p)=>!best||p.x<best.x-1e-12||Math.abs(p.x-best.x)<=1e-12&&p.y<best.y?p:best,null);
const nearPoint=(a,b,tol)=>Math.abs(a.x-b.x)<=tol&&Math.abs(a.y-b.y)<=tol;
function sameWithin(a,b,tol){
  if(a.type!==b.type)return false;
  switch(a.type){
    case 'circle':return nearPoint(a.center,b.center,tol)&&Math.abs(a.radius-b.radius)<=tol;
    case 'point':return nearPoint(a.position,b.position,tol);
    case 'text':case 'mtext':return nearPoint(a.position,b.position,tol)&&Math.abs((Number(a.height)||0)-(Number(b.height)||0))<=tol&&String(a.text??'')===String(b.text??'')&&normAngle(a.rotation).toFixed(6)===normAngle(b.rotation).toFixed(6)&&(a.align??'')===(b.align??'')&&(a.font??a.style??'')===(b.font??b.style??'')&&(a.width??'')===(b.width??'');
    case 'polyline':case 'rectangle':{
      const p=a.points,r=b.points;if(p.length!==r.length||!!a.closed!==!!b.closed)return false;
      return p.every((v,i)=>nearPoint(v,r[i],tol))||p.every((v,i)=>nearPoint(v,r[r.length-1-i],tol));
    }
    case 'block':return nearPoint(a.position,b.position,tol)&&String(a.name??'')===String(b.name??'')&&(a.sharedBlock??'')===(b.sharedBlock??'')&&(Number(a.scale??1)).toFixed(9)===(Number(b.scale??1)).toFixed(9)&&(Number(a.scaleY??a.scale??1)).toFixed(9)===(Number(b.scaleY??b.scale??1)).toFixed(9)&&normAngle(a.rotation).toFixed(6)===normAngle(b.rotation).toFixed(6)&&JSON.stringify(a.attributes||{})===JSON.stringify(b.attributes||{});
    default:return false;
  }
}
/* 같은 원(중심·반지름이 공차 안) 위의 호를 각도 구간으로 정렬해 겹친 것을 하나로(AutoCAD COverkillEngine::handleArcs 와 같은 생각).
   한 바퀴를 다 덮으면 원 하나로 바꾼다(호를 지우고 원을 더함). endToEnd 면 끝끼리 닿은 호도 잇는다. */
function mergeArcs(arcs,tol,ignoreLayer,endToEnd=false){
  const out={deleteIds:[],updates:[],adds:[],duplicates:0,merged:0};
  if(arcs.length<2)return out;
  const clusters=[],cells=new Map();
  for(const item of arcs){
    const e=item.entity,style=styleKey(e,ignoreLayer),cx=Math.floor(e.center.x/tol),cy=Math.floor(e.center.y/tol);
    let home=null;
    for(let dx=-1;dx<=1&&!home;dx++)for(let dy=-1;dy<=1&&!home;dy++)for(const c of cells.get((cx+dx)+','+(cy+dy))||[])if(c.style===style&&nearPoint(c.center,e.center,tol)&&Math.abs(c.radius-e.radius)<=tol){home=c;break;}
    if(!home){home={style,center:e.center,radius:e.radius,items:[]};clusters.push(home);const k=cx+','+cy;let list=cells.get(k);if(!list){list=[];cells.set(k,list);}list.push(home);}
    home.items.push(item);
  }
  for(const c of clusters){
    if(c.items.length<2)continue;
    const gap=tol/c.radius*180/Math.PI;
    const spans=c.items.map(({entity,order})=>{const s=normAngle(entity.startAngle);let w=normAngle(entity.endAngle-entity.startAngle);if(w<1e-9)w=360;return {entity,order,s,w};});
    // 겹친 구간끼리 묶는다(0° 를 건너는 묶음도 하나로) — curve-edit.js mergeCircularSpans 를 JOIN 과 같이 쓴다.
    for(const group of mergeCircularSpans(spans,{gap,touch:endToEnd})){
      if(group.items.length<2)continue;
      let keep=group.items[0];for(const x of group.items)if(x.w>keep.w+1e-12||(Math.abs(x.w-keep.w)<=1e-12&&x.order<keep.order))keep=x;
      for(const x of group.items){if(x===keep)continue;out.deleteIds.push(x.entity.id);if(normAngle(x.s-keep.s)+x.w<=keep.w+gap)out.duplicates++;else out.merged++;}
      if(group.to-group.from>=360-gap){const {id,startAngle,endAngle,...rest}=keep.entity;out.deleteIds.push(id);out.adds.push({...rest,type:'circle'});continue;}
      const start=normAngle(group.from),end=normAngle(group.to);
      if(Math.abs(normAngle(start-keep.s))>1e-9||Math.abs(group.to-group.from-keep.w)>1e-9)out.updates.push({id:keep.entity.id,changes:{startAngle:start,endAngle:end}});
    }
  }
  return out;
}

/* ─────────────── GEOMETRYCLEANUP (작도 오류 검사, ACAD200-424) ───────────────
   AutoCAD 2027 AcDraftAssist 의 검사기 5종(틈·넘침·모자람·절대 각도·상대 각도) 중 앞의 넷. 문서는 고치지 않고 "문제 목록 + 고칠 점"만.
   선 상자 격자로 끝점 이웃만 견줘 O(n). 같은 선 끝에 넘침·모자람이 여럿이면 가장 작은 것 하나만 남긴다. */
export function planGeometryCleanup(doc,{gap=1,shoot=5,angle=0.5,ids=null,lockedLayers=null}={}){
  for(const [name,value] of [['틈',gap],['넘침·모자람',shoot],['각도',angle]])if(!(Number(value)>=0)||!Number.isFinite(Number(value)))throw Error(name+' 공차는 0 이상 숫자여야 합니다.');
  const wanted=ids?new Set(ids):null,locked=lockedLayers instanceof Set?lockedLayers:new Set(lockedLayers||[]);
  const lines=(doc?.entities||[]).filter(e=>e&&e.type==='line'&&e.points?.length===2&&e.points.every(validPoint)&&(!wanted||wanted.has(e.id))&&!locked.has(e.layer)&&!e.hidden&&!isLinked(e)&&Math.hypot(e.points[1].x-e.points[0].x,e.points[1].y-e.points[0].y)>1e-9);
  const issues=[],reach=Math.max(gap,shoot,1e-6),cell=reach*4,grid=new Map();
  lines.forEach((e,i)=>{const [a,b]=e.points,x0=Math.floor(Math.min(a.x,b.x)/cell),x1=Math.floor(Math.max(a.x,b.x)/cell),y0=Math.floor(Math.min(a.y,b.y)/cell),y1=Math.floor(Math.max(a.y,b.y)/cell);
    // 아주 긴 선(칸 수천 개)은 양 끝 칸에만 넣는다 — 끝점 검사에는 그것으로 충분하고 색인이 커지지 않는다.
    const cellsOf=(x1-x0+1)*(y1-y0+1)>4096?[[x0,y0],[x1,y1],[Math.floor(a.x/cell),Math.floor(a.y/cell)],[Math.floor(b.x/cell),Math.floor(b.y/cell)]]:null;
    const put=(x,y)=>{const k=x+','+y;let list=grid.get(k);if(!list){list=[];grid.set(k,list);}list.push(i);};
    if(cellsOf)for(const [x,y] of cellsOf)put(x,y);else for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)put(x,y);});
  const around=p=>{const out=new Set();for(let x=Math.floor((p.x-reach)/cell);x<=Math.floor((p.x+reach)/cell);x++)for(let y=Math.floor((p.y-reach)/cell);y<=Math.floor((p.y+reach)/cell);y++)for(const i of grid.get(x+','+y)||[])out.add(i);return out;};
  const best=new Map(),offer=issue=>{const k=issue.ids[0]+':'+issue.end,old=best.get(k);if(!old||issue.size<old.size)best.set(k,issue);};
  lines.forEach((L,li)=>{
    for(const end of [0,1]){
      const E=L.points[end],O=L.points[1-end],len=Math.hypot(E.x-O.x,E.y-O.y),ux=(E.x-O.x)/len,uy=(E.y-O.y)/len;
      for(const mi of around(E)){
        if(mi===li)continue;
        const M=lines[mi],[c,d]=M.points;
        // 틈: 다른 선 끝점과 아주 가깝지만 붙지 않음(한 쌍은 한 번만).
        for(const [j,q] of [[0,c],[1,d]]){const g=Math.hypot(q.x-E.x,q.y-E.y);if(g>1e-9&&g<=gap&&L.id<M.id)issues.push({kind:'gap',ids:[L.id,M.id],ends:[end,j],at:{x:(E.x+q.x)/2,y:(E.y+q.y)/2},size:g});}
        // 넘침·모자람: L 끝이 M 을 조금 지나쳤거나 조금 못 미침(M 구간 안에서 만날 때만). t = E 에서 L 바깥 방향으로 잰 교점 거리.
        const vx=d.x-c.x,vy=d.y-c.y,den=ux*vy-uy*vx;if(Math.abs(den)<1e-12)continue;
        const t=((c.x-E.x)*vy-(c.y-E.y)*vx)/den,u=((c.x-E.x)*uy-(c.y-E.y)*ux)/den;
        if(u<-1e-9||u>1+1e-9)continue;
        const hit={x:E.x+ux*t,y:E.y+uy*t},nearEnd=Math.min(Math.hypot(hit.x-c.x,hit.y-c.y),Math.hypot(hit.x-d.x,hit.y-d.y));
        if(nearEnd<=gap)continue; // 끝끼리 만나는 곳은 틈 검사가 맡는다
        if(t<-1e-9&&-t<=shoot&&-t<len-1e-9)offer({kind:'overshoot',ids:[L.id,M.id],end,at:hit,size:-t,fix:[{id:L.id,index:end,point:hit}]});
        else if(t>1e-9&&t<=shoot)offer({kind:'undershoot',ids:[L.id,M.id],end,at:hit,size:t,fix:[{id:L.id,index:end,point:hit}]});
      }
    }
    const [a,b]=L.points,deg=((Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI)%90+90)%90,off=Math.min(deg,90-deg);
    if(off>1e-6&&off<=angle){
      const mx=(a.x+b.x)/2,my=(a.y+b.y)/2,half=Math.hypot(b.x-a.x,b.y-a.y)/2,horizontal=Math.abs(b.x-a.x)>=Math.abs(b.y-a.y),sx=Math.sign(b.x-a.x)||1,sy=Math.sign(b.y-a.y)||1;
      issues.push({kind:'angle',ids:[L.id],at:{x:mx,y:my},size:off,fix:[{id:L.id,index:0,point:horizontal?{x:mx-sx*half,y:my}:{x:mx,y:my-sy*half}},{id:L.id,index:1,point:horizontal?{x:mx+sx*half,y:my}:{x:mx,y:my+sy*half}}]});
    }
  });
  for(const issue of issues)if(issue.kind==='gap'){const [a,b]=issue.ids,[ea,eb]=issue.ends;issue.fix=[{id:a,index:ea,point:issue.at},{id:b,index:eb,point:issue.at}];}
  const all=[...issues,...best.values()],rank={gap:0,overshoot:1,undershoot:2,angle:3};
  all.sort((x,y)=>rank[x.kind]-rank[y.kind]||x.size-y.size);
  const counts={gap:0,overshoot:0,undershoot:0,angle:0};for(const x of all)counts[x.kind]++;
  return {issues:all,counts,total:all.length};
}
/** 고른 종류만 고치는 엔진 명령(updateMany 하나 = 되돌리기 한 번). 같은 끝점을 두 번 고치면 먼저 나온(작은) 것만. */
export function geometryCleanupCommand(plan,doc,kinds=['gap','overshoot','undershoot','angle']){
  const want=new Set(kinds),ids=new Set((plan.issues||[]).flatMap(x=>x.ids)),byId=new Map((doc?.entities||[]).filter(e=>ids.has(e.id)).map(e=>[e.id,e])),points=new Map(),done=new Set();
  for(const issue of plan.issues||[]){
    if(!want.has(issue.kind)||!issue.fix||issue.fix.some(f=>done.has(f.id+':'+f.index)))continue;
    for(const f of issue.fix){const e=byId.get(f.id);if(!e)continue;const ps=points.get(f.id)||e.points.map(p=>({x:p.x,y:p.y}));ps[f.index]={x:f.point.x,y:f.point.y};points.set(f.id,ps);done.add(f.id+':'+f.index);}
  }
  const updates=[...points].filter(([,ps])=>Math.hypot(ps[1].x-ps[0].x,ps[1].y-ps[0].y)>1e-9).map(([id,ps])=>({id,changes:{points:ps}}));
  return updates.length?{type:'updateMany',updates}:null;
}

// 방향각 θ(-angTol ~ π-angTol) → 기준 방향과 거리(오프셋) → 직선 방향 구간 순으로 정렬해 겹치는 선을 한 줄로.
const ANGLE_TOLERANCE=1e-5;
function mergeCollinear(lines,tol,endToEnd=false){
  const out={deleteIds:[],updates:[],duplicates:0,merged:0};
  if(lines.length<2)return out;
  for(const line of lines){
    let theta=Math.atan2(line.b.y-line.a.y,line.b.x-line.a.x);
    if(theta<-ANGLE_TOLERANCE)theta+=Math.PI;
    if(theta>=Math.PI-ANGLE_TOLERANCE)theta-=Math.PI;
    line.theta=theta;
  }
  lines.sort((x,y)=>x.theta-y.theta);
  for(let start=0;start<lines.length;){
    let end=start+1;
    while(end<lines.length&&lines[end].theta-lines[start].theta<=ANGLE_TOLERANCE)end++;
    if(end-start>1)mergeParallel(lines.slice(start,end),tol,out,endToEnd);
    start=end;
  }
  return out;
}

function mergeParallel(lines,tol,out,endToEnd=false){
  const reference=lines[0],ux=Math.cos(reference.theta),uy=Math.sin(reference.theta);
  for(const line of lines){
    const mx=(line.a.x+line.b.x)/2,my=(line.a.y+line.b.y)/2;
    line.offset=ux*my-uy*mx;
    const ta=ux*line.a.x+uy*line.a.y,tb=ux*line.b.x+uy*line.b.y;
    line.t0=Math.min(ta,tb);line.t1=Math.max(ta,tb);line.ux=ux;line.uy=uy;
  }
  lines.sort((x,y)=>x.offset-y.offset);
  for(let start=0;start<lines.length;){
    let end=start+1;
    while(end<lines.length&&lines[end].offset-lines[start].offset<=tol)end++;
    if(end-start>1)mergeRuns(lines.slice(start,end),tol,out,endToEnd);
    start=end;
  }
}

// 점 p 에서 선 line(무한 직선)까지 거리.
const distanceToLine=(p,line)=>Math.abs((line.b.x-line.a.x)*(p.y-line.a.y)-(line.b.y-line.a.y)*(p.x-line.a.x))/line.length;

// 오토캐드 OVERKILL 기본: 겹친 선만 합친다. 끝과 끝이 닿기만 한 선은 endToEnd(옵션, 기본 끔)일 때만.
function mergeRuns(lines,tol,out,endToEnd=false){
  lines.sort((x,y)=>x.t0-y.t0||x.order-y.order);
  const used=new Uint8Array(lines.length);
  for(let i=0;i<lines.length;i++){
    if(used[i])continue;
    const anchor=lines[i],group=[anchor];used[i]=1;
    let reach=anchor.t1;
    for(let j=i+1;j<lines.length&&(endToEnd?lines[j].t0<=reach+tol:lines[j].t0<reach-tol);j++){
      if(used[j])continue;
      const line=lines[j];
      // 같은 직선 위에 있는지 기준 선으로 다시 확인(방향·오프셋 묶음의 경계 오차 방지).
      if(distanceToLine(line.a,anchor)>tol||distanceToLine(line.b,anchor)>tol||distanceToLine(anchor.a,line)>tol||distanceToLine(anchor.b,line)>tol)continue;
      group.push(line);used[j]=1;
      if(line.t1>reach)reach=line.t1;
    }
    if(group.length<2)continue;
    // 남길 선: 가장 긴 선(같으면 도면 순서가 앞선 것). 그 선 안에 들어가는 선은 '중복', 밖으로 나가는 선은 '합침'.
    let keep=group[0];
    for(const line of group)if(line.length>keep.length+1e-12||(Math.abs(line.length-keep.length)<=1e-12&&line.order<keep.order))keep=line;
    let minPoint=null,minT=Infinity,maxPoint=null,maxT=-Infinity,extended=false;
    const ux=anchor.ux,uy=anchor.uy,tOf=p=>ux*p.x+uy*p.y;
    // 남길 선의 끝점을 먼저 둔다: 같은 위치면 원래 좌표를 유지한다.
    for(const line of [keep,...group]){
      for(const p of [line.a,line.b]){const t=tOf(p);if(t<minT-1e-9){minT=t;minPoint=p;}if(t>maxT+1e-9){maxT=t;maxPoint=p;}}
    }
    for(const line of group){
      if(line===keep)continue;
      out.deleteIds.push(line.entity.id);
      if(line.t0>=keep.t0-tol&&line.t1<=keep.t1+tol)out.duplicates++;
      else{out.merged++;extended=true;}
    }
    if(extended){
      // 원래 방향을 유지한다(a→b).
      const forward=tOf(keep.b)>=tOf(keep.a);
      const points=forward?[{...minPoint},{...maxPoint}]:[{...maxPoint},{...minPoint}];
      for(const p of points){delete p.bulge;}
      out.updates.push({id:keep.entity.id,changes:{points:[{x:points[0].x,y:points[0].y},{x:points[1].x,y:points[1].y}]}});
    }
  }
}

/** planOverkill 결과를 엔진 명령 하나(batch)로. */
export function overkillCommand(plan){
  const commands=[];
  if(plan.deleteIds?.length)commands.push({type:'delete',ids:plan.deleteIds});
  if(plan.updates?.length)commands.push({type:'updateMany',updates:plan.updates});
  if(plan.adds?.length)commands.push({type:'addMany',entities:plan.adds});
  return commands.length?{type:'batch',commands}:null;
}

/* ─────────────── AUDIT ─────────────── */

// 객체 안의 숫자에 NaN·무한대가 있는지(하위 객체 entities 와 '_' 로 시작하는 캐시는 따로/건너뛴다).
function hasBadNumber(value,depth=0){
  if(typeof value==='number')return !Number.isFinite(value);
  if(!value||typeof value!=='object'||depth>6||ArrayBuffer.isView(value))return false;
  if(Array.isArray(value)){for(const item of value)if(hasBadNumber(item,depth+1))return true;return false;}
  for(const key in value){
    if(key==='entities'||key.charCodeAt(0)===95)continue;
    if(hasBadNumber(value[key],depth+1))return true;
  }
  return false;
}

const KNOWN_BLOCK_EXEMPT=entity=>entity.table||entity.sharedBlock||entity.scheduleKind||entity.hostWall||entity.category||entity.parcelGroup;

/** 도면을 검사해 문제와 고칠 방법을 돌려준다.
 *  missingLayer: 없는 레이어를 가리키는 객체 → '0' 레이어로, badNumber: NaN·무한대 좌표 → 삭제,
 *  zeroLength: 길이 0 선 → 삭제, duplicateIds: 같은 id → 새 id, missingBlocks: 정의 없는 블록 이름(보고만). */
export function planAudit(doc){
  const layers=doc?.layers||[],layerIds=new Set(layers.map(layer=>layer.id));
  const fallbackLayer=(layers.find(layer=>layer.name==='0')||layers[0])?.id??null;
  const blockNames=new Set((doc?.blocks||[]).map(block=>block.name));
  const report={missingLayer:0,badNumber:0,zeroLength:0,duplicateIds:0,missingBlocks:new Map()};
  const removeIds=new Set(),replacements=new Map(),seenIds=new Map(),duplicateIdSet=new Set();
  // 하위 객체(블록 안)를 고친 사본. 바뀐 것이 없으면 원래 객체를 그대로 돌려준다.
  const fixChildren=(entity,depth)=>{
    if(!Array.isArray(entity.entities)||!entity.entities.length||depth>12)return entity;
    let changed=false;const children=[];
    for(const child of entity.entities){
      if(!child||typeof child!=='object'){changed=true;continue;}
      if(hasBadNumber(child)){report.badNumber++;changed=true;continue;}
      if(child.type==='line'&&isZeroLengthLine(child)){report.zeroLength++;changed=true;continue;}
      let fixed=fixChildren(child,depth+1);
      if(fixed.layer!==undefined&&!layerIds.has(fixed.layer)){report.missingLayer++;fixed={...fixed,layer:fallbackLayer};}
      if(fixed!==child)changed=true;
      children.push(fixed);
    }
    return changed?{...entity,entities:children}:entity;
  };
  for(const entity of doc?.entities||[]){
    if(!entity||typeof entity!=='object')continue;
    if(typeof entity.id==='string'){
      if(seenIds.has(entity.id)){report.duplicateIds++;duplicateIdSet.add(entity.id);}
      else seenIds.set(entity.id,entity);
    }
    if(hasBadNumber(entity)){report.badNumber++;removeIds.add(entity);continue;}
    if(entity.type==='line'&&isZeroLengthLine(entity)){report.zeroLength++;removeIds.add(entity);continue;}
    if(entity.type==='block'&&!KNOWN_BLOCK_EXEMPT(entity)&&entity.name&&!blockNames.has(entity.name))report.missingBlocks.set(entity.name,(report.missingBlocks.get(entity.name)||0)+1);
    let fixed=fixChildren(entity,0);
    if(!layerIds.has(fixed.layer)){report.missingLayer++;fixed={...fixed,layer:fallbackLayer};}
    if(fixed!==entity)replacements.set(entity,fixed);
  }
  const problems=report.missingLayer+report.badNumber+report.zeroLength+report.duplicateIds;
  return {report,problems,removeIds,replacements,duplicateIdSet,fallbackLayer,blockReferences:[...report.missingBlocks].reduce((sum,[,count])=>sum+count,0)};
}

/** planAudit 결과를 고치는 엔진 명령(batch). 같은 id 객체는 지운 뒤 첫 번째는 원래 id, 나머지는 새 id 로 다시 넣는다. */
export function auditFixCommand(doc,plan,newId=()=>crypto.randomUUID()){
  const commands=[],deleteIds=new Set(),updates=[],adds=[];
  const firstSeen=new Set();
  for(const entity of doc?.entities||[]){
    if(!entity||typeof entity!=='object')continue;
    const duplicate=plan.duplicateIdSet.has(entity.id);
    const removed=plan.removeIds.has(entity);
    const fixed=plan.replacements.get(entity);
    if(duplicate){
      deleteIds.add(entity.id);
      if(removed)continue;
      const copy=structuredClone(fixed||entity);
      if(firstSeen.has(entity.id))copy.id=newId();else firstSeen.add(entity.id);
      adds.push(copy);
      continue;
    }
    if(removed){deleteIds.add(entity.id);continue;}
    if(fixed){const changes={};for(const key of ['layer','entities'])if(fixed[key]!==entity[key])changes[key]=fixed[key];updates.push({id:entity.id,changes});}
  }
  if(deleteIds.size)commands.push({type:'delete',ids:[...deleteIds]});
  if(updates.length)commands.push({type:'updateMany',updates});
  for(const entity of adds)commands.push({type:'add',entity});
  return commands.length?{type:'batch',commands}:null;
}

/** 검사 결과 한 줄 요약. */
export function auditSummary(plan){
  const r=plan.report;
  const parts=[`없는 레이어 참조 ${r.missingLayer}개`,`잘못된 좌표(NaN·무한대) ${r.badNumber}개`,`길이 0 선 ${r.zeroLength}개`,`중복 ID ${r.duplicateIds}개`];
  if(plan.blockReferences)parts.push(`정의 없는 블록 참조 ${plan.blockReferences}개(${r.missingBlocks.size}종, 보고만)`);
  return parts.join(', ');
}

/** ACAD200-810: 감사 결과를 도면 옆에 남길 보고서(<이름>.adt) 글. AutoCAD 와 달리 고칠 방법과 되돌리기를 함께 적는다. */
export function auditReportText(plan,{name='도면',when=new Date()}={}){
  const r=plan.report;
  const lines=[`바른 CAD 감사 보고서 · ${name} · ${when.toLocaleString('ko-KR')}`,'',
    `없는 레이어 참조: ${r.missingLayer}개 → 0 레이어로 옮김`,
    `잘못된 숫자(NaN·무한대) 좌표: ${r.badNumber}개 → 삭제`,
    `길이 0 선: ${r.zeroLength}개 → 삭제`,
    `같은 id: ${r.duplicateIds}개 → 새 id`];
  for(const [blockName,count] of r.missingBlocks)lines.push(`정의 없는 블록 ${blockName}: ${count}곳 (참조 안 그림을 유지, 보고만)`);
  lines.push('',plan.problems?`합계 ${plan.problems}건 · AUDIT 에서 [예]로 고치고 Ctrl+Z 로 되돌릴 수 있습니다.`:'고칠 문제가 없습니다.');
  return lines.join('\r\n');
}
