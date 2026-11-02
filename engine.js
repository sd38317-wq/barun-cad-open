import {standardLayerForName} from './layer-standards.js';
import * as G from "./geometry.js";
import {entityIndex,entitiesById,changedById,commitEntities,dependentsOf,isAssocDimension,assocSourceIds,assocDependentsOf,pointerDelta} from './entity-index.js';
import {createHistoryLog,composeDelta} from './history-delta.js';
import {cloneWithIdMap} from './entity-refs.js';
import {materialPreset,validateMaterialMap} from './material-presets.js';
import {syncAssociativeDimensions,syncChangedAssocDimensions,refreshAssocDimension} from './dim-assoc.js';
import * as CE from './curve-edit.js';
import {makeAssocArray,editAssocArray,checkArrayParams,expandArray,makeCenterObject,refreshAssociations,isAssociative} from './assoc-edit.js';
import {solveConstraints,constraintsTouching} from './constraints.js';
import {parcelInfoTable,updateParcelInfoTable,parcelDaylightGuide} from "./parcel-info.js";
import {measure,organizeBarunLayers,BARUN_LAYERS,SITE_PLAN_LAYERS,SITE_ROLE_LAYERS,standardLayers,standardLayerForLabel,applyDrawingLayerReview,applyForeignDrawing,rebuildArchitecture,wallOpening,classifyLayer,autoOrganizeDrawingLayers,furnitureSpec} from './architecture.js';
import {createSiteContext,selectSiteEntities,selectSiteDrawOptions} from './site-context.js';
import {appendReviewHistory,nextReviewObjectId,REVIEW_PREFIX} from './review-model.js';
import {tableBlock} from './studio.js';
import {refreshRoomSchedule} from './room-schedule.js';
import {withSharedDefinitions,sharedDerivation,localizeEntities,sharedTemplate,refersTo,definitionUsers} from './shared-blocks.js';
const SITE_LAYER_LABELS=Object.fromEntries(SITE_PLAN_LAYERS.map(l=>[l.name,l.label]));
export { entityDistance, distanceToSegment } from "./geometry.js";
// DWG/DXF 변환기가 허용하는 한도와 맞춘다. 가져오기 보고서의 객체 수는
// 최상위 개수라서 블록 내부 객체까지 세는 검증 한도는 더 넉넉해야 한다.
// 사본의 검토 번호만 새로 발급한다. 선택한 조각·하위 객체 수만 순회.
function copyReviewIds(doc,entities){
 const ids=new Map(),kinds=Object.fromEntries(Object.entries(REVIEW_PREFIX).map(([k,p])=>[p,k]));
 const visit=(e,fn)=>{fn(e);for(const child of e.entities||[])visit(child,fn);};
 for(const e of entities)visit(e,p=>{const old=p.reviewObjectId,kind=kinds[String(old||'').split('-')[0]];if(kind){if(!ids.has(old))ids.set(old,nextReviewObjectId(doc,kind));p.reviewObjectId=ids.get(old);}});
 for(const e of entities)visit(e,p=>{if(!p.reviewInput)return;const v=p.reviewInput;for(const key of ['doorId','parkingId','toiletId'])if(ids.has(v[key]))v[key]=ids.get(v[key]);if(v.doorIds)v.doorIds=v.doorIds.map(id=>ids.get(id)||id);delete v.excluded;});
 return entities;
}
export const MAX_DRAWING_OBJECTS = 3000000;
export const MAX_BLOCK_DEPTH = 12;
export function validateImage(entity) {
  if (!entity || entity.type !== 'image' || (!entity.path && !entity.data)) throw Error('IMAGE 경로 또는 내장 데이터가 필요합니다.');
  if (entity.path !== undefined && (typeof entity.path !== 'string' || !entity.path.trim())) throw Error('IMAGE 경로가 올바르지 않습니다.');
  if (!entity.position || !Number.isFinite(entity.position.x) || !Number.isFinite(entity.position.y) || !(typeof entity.width === 'number' && Number.isFinite(entity.width) && entity.width > 0) || !(typeof entity.height === 'number' && Number.isFinite(entity.height) && entity.height > 0)) throw Error('IMAGE 위치·폭·높이가 올바르지 않습니다.');
  if (entity.pixelWidth !== undefined && !(Number.isInteger(entity.pixelWidth) && entity.pixelWidth > 0) || entity.pixelHeight !== undefined && !(Number.isInteger(entity.pixelHeight) && entity.pixelHeight > 0)) throw Error('IMAGE 픽셀 크기가 올바르지 않습니다.');
  if (!Number.isFinite(entity.rotation ?? 0)) throw Error('IMAGE 회전이 올바르지 않습니다.');
  if (entity.data !== undefined && (typeof entity.data !== 'string' || !/^data:image\/(jpeg|png|bmp);base64,/i.test(entity.data))) throw Error('IMAGE 데이터 형식이 올바르지 않습니다.');
  if (entity.fade !== undefined && !(Number.isFinite(entity.fade) && entity.fade >= 0 && entity.fade <= 90)) throw Error('IMAGE 흐림은 0~90이어야 합니다.');
  return entity;
}
// Shared by the 3D form and MCP edits; never imports the lazy Three renderer.
export function validateFloorHeights(table){
  if(!table||typeof table!=='object'||Array.isArray(table))throw Error('층 높이 표가 필요합니다.');
  for(const [name,height] of Object.entries(table))if(!/^[1-9]\d*F$/.test(name)||!Number.isSafeInteger(Number(name.slice(0,-1)))||!(Number.isFinite(height)&&height>0&&height<=100000))throw Error('층 이름은 nF, 높이는 0~100000 mm 안의 양수여야 합니다.');
  return table;
}
export function validateModel3D(changes,{allowRoof=false}={}){
  if(!changes||typeof changes!=='object'||Array.isArray(changes)||!Object.keys(changes).length||Object.keys(changes).some(k=>!['height','elevation','kind','roofRise','color','material',...(allowRoof?['roof']:[])].includes(k)))throw Error('3D 부재 속성이 잘못되었습니다.');
  if(changes.height!==undefined&&!(Number.isFinite(changes.height)&&changes.height>0&&changes.height<=1000000)||changes.elevation!==undefined&&!Number.isFinite(changes.elevation)||changes.roofRise!==undefined&&!(Number.isFinite(changes.roofRise)&&changes.roofRise>=0)||changes.kind!==undefined&&!['solid','slab','roof'].includes(changes.kind)||changes.color!==undefined&&!/^#[\da-f]{6}$/i.test(changes.color))throw Error('3D 부재 높이·형태·색상 오류');
  // 재료(material-presets.js ID): 3D 그림에서 이 객체만 그 재료. null 이면 도면 종류별 재료로 돌아간다.
  if(changes.material!==undefined&&changes.material!==null&&!materialPreset(changes.material))throw Error('없는 재료입니다: '+changes.material);
  // Stored roofs retain their options; geometry errors use the renderer's flat fallback.
  if(Object.hasOwn(changes,'roof')&&(!changes.roof||typeof changes.roof!=='object'||Array.isArray(changes.roof)))throw Error('3D 지붕 속성이 잘못되었습니다.');
  return changes;
}
export const blankDocument = () => ({
  version: 2,
  units: "mm",
  linetypeScale: 1,
  layers: [
    {
      id: "default",
      name: "0",
      color: "#79d4ff",
      visible: true,
      locked: false,
      lineweight: 0.25,
      linetype: "CONTINUOUS",
    },
  ],
  blocks: [],
  entities: [],
});
// 새 도면용 문서. blankDocument 는 가져온 도면·검증의 빈 바탕이라 그대로 두고,
// 사용자가 여는 도면에만 바른 표준 레이어를 올려 둔다.
export const newDrawingDocument = () => {
  const doc = blankDocument();
  doc.layers.push(...standardLayers());
  return doc;
};
const fresh = (e) => {const copy={...structuredClone(e),id:crypto.randomUUID()};delete copy.lineWallHost;return copy;};
// 되돌리기 기록용 복사. 공유 블록과 원본 보존 자료(dxfPreservation: 원본 DXF 압축 문자열, 수십 MB)는
// 고치는 곳이 없는 불변 값이라 복사하지 않고 같은 것을 가리킨다(예전에는 편집마다 통째로 복사돼 메모리가 바닥났다).
const cloneForHistory=doc=>{
  if(!doc?.sharedBlocks&&!doc?.dxfPreservation)return structuredClone(doc);
  const {sharedBlocks,dxfPreservation,...editable}=doc,copy=structuredClone(editable);
  if(sharedBlocks)copy.sharedBlocks=sharedBlocks;
  if(dxfPreservation)copy.dxfPreservation=dxfPreservation;
  return copy;
};
// Most drawing clicks append one or more independent primitives.  A complete
// structuredClone of a large drawing before every such click used to block the
// renderer for hundreds of milliseconds.  History documents are immutable:
// every mutating command now works on a detached document, while safe append
// commands only copy the two arrays they can change.  Undo can consequently
// swap document references in O(1) without allowing a later command to corrupt
// an older snapshot.
const appendEntitiesOf=command=>{
  if(command?.type==='add')return [command.entity];
  if(command?.type==='addMany'||command?.type==='add.classified')return command.entities||[];
  return null;
};
const hasLinkedGeometry=entity=>{
  if(!entity||typeof entity!=='object')return false;
  // Blocks feed live quantity schedules even when their nested primitives are
  // otherwise ordinary geometry. Keep every composite/block append on the
  // full synchronization path so schedules and nested-object limits remain
  // correct.
  if(entity.type==='wall'||entity.type==='block'||Array.isArray(entity.entities)||entity.hostWall||entity.roomBoundary||entity.scheduleKind)return true;
  return Array.isArray(entity.entities)&&entity.entities.some(hasLinkedGeometry);
};
const canAppendWithoutGlobalSync=(command,doc=null)=>{
  const entities=appendEntitiesOf(command);
  if(!entities||command.centerlineId)return false;
  if(!entities.some(hasLinkedGeometry))return true;
  // Without a block schedule in the drawing, a block reference (a furniture
  // block, a library symbol) feeds nothing: only top-level walls, linked
  // openings, room tags and schedules need the full synchronization.
  const features=doc&&entityIndex(doc.entities)?.features;
  return !!features&&!features.blockSchedule&&!entities.some(entity=>!entity||typeof entity!=='object'||entity.type==='wall'||entity.hostWall||entity.roomBoundary||entity.scheduleKind);
};
// 레이어·색·선종류·선가중치만 바꾸는 편집(속성 창·레이어 바꾸기). 모양·연동은 그대로라 바뀐 객체만 갈아 끼우면 된다.
// 예전에는 전체 동기화 경로로 가서 큰 도면이 통째로 사라졌다가 다시 그려졌다.
const STYLE_KEYS=new Set(['layer','color','aci','colorMode','linetype','linetypeScale','lineweight','transparency']);
const styleOnly=changes=>!!changes&&typeof changes==='object'&&Object.keys(changes).length>0&&Object.keys(changes).every(key=>STYLE_KEYS.has(key));
// 가벼운 경로는 바뀐 객체를 화면 스레드에서 바로 갈아 끼운다. 수백 개를 넘으면 뒤(작업자)에서 다시 만드는 예전 경로보다
// 느려지고 되돌리기까지 1초 넘게 멈췄다(500개 A/B: 확정 1.1→1.9초, 되돌리기 0.04→1.3초). 작은 편집에만 쓴다.
export const STYLE_FAST_LIMIT=100;
const styleEditIdsAll=command=>{
  if(command?.type==='update')return command.ids?.length&&styleOnly(command.changes)?command.ids:null;
  if(command?.type==='updateMany')return command.updates?.length&&command.updates.every(u=>u&&u.id&&styleOnly(u.changes))?command.updates.map(u=>u.id):null;
  if(command?.type==='batch'&&command.commands?.length){const parts=command.commands.map(styleEditIdsAll);return parts.every(Boolean)?[...new Set(parts.flat())]:null;}
  return null;
};
export const styleEditIds=command=>{const ids=styleEditIdsAll(command);return ids&&ids.length<=STYLE_FAST_LIMIT?ids:null;};
/* 210: 레이어·색만 100개 넘게 바꾸는 편집. 화면은 지금처럼 전체를 다시 그리되(6.0.18 A/B 결과 유지),
   엔진은 문서 전체를 복사하지 않고 바뀐 객체만 갈아 끼운다(복사 후 쓰기). AutoCAD 의 부분 되돌리기(applyPartialUndo)처럼
   되돌리기 한 단계가 "바뀐 객체만" 차지한다 — 19만 객체 도면에서 1만 개 레이어 변경이 문서 사본 하나를 통째로 잡던 것이 1만 개로 준다. */
const bulkStyleIds=command=>{const ids=styleEditIdsAll(command);return ids&&ids.length>STYLE_FAST_LIMIT?ids:null;};
/** 되돌리기 단계마다 남기는 객체 차이의 상한(이보다 크면 화면이 어차피 전체를 다시 그린다 — app.js HISTORY_DELTA_LIMIT 와 같다). */
export const HISTORY_RECORD_LIMIT=20000;
// Objects counted by validate() (a node and all its nested children). Objects
// of committed documents are immutable, so the count is cached by identity.
const nestedCounts=new WeakMap();
const nestedCount=entity=>{
  if(!entity?.entities?.length)return 1;
  let count=nestedCounts.get(entity);
  if(count===undefined){count=1;for(const child of entity.entities)count+=nestedCount(child);nestedCounts.set(entity,count);}
  return count;
};
// A layer table edit (on/off, freeze, colour, linetype, lock, rename) changes no
// object: history snapshots share every object, and the display caches
// re-display only the objects reading that layer (geometry.js entityUsesLayers).
// ACAD200 s7: 도면에 함께 저장하는 표시·관리 설정(AutoCAD 도 도면 헤더에 둔다: LAYLOCKFADECTL 은 예외로 우리는 도면별).
// layerFilters 702 · namedViews 711 · lockFade 705 · lineweightDisplay 718 · layerEval 707 · displayUnits 714 · psltscale/msltscale 719 · layerNotify 707
export const DOCUMENT_SETTING_KEYS=Object.freeze(['layerFilters','namedViews','lockFade','lineweightDisplay','layerEval','layerNotify','displayUnits','psltscale','msltscale']);
export function validateDocumentSettings(changes){
  const has=key=>changes[key]!==undefined;
  if(has('lockFade')&&!(Number.isInteger(changes.lockFade)&&changes.lockFade>=0&&changes.lockFade<=90))throw Error('잠긴 레이어 흐리게(LAYLOCKFADECTL)는 0~90 정수입니다.');
  for(const key of ['lineweightDisplay','layerEval','psltscale','msltscale'])if(has(key)&&typeof changes[key]!=='boolean')throw Error(key+' 설정은 켜기/끄기 값입니다.');
  if(has('layerNotify')&&!(Number.isInteger(changes.layerNotify)&&changes.layerNotify>=0&&changes.layerNotify<=63))throw Error('새 레이어 알림(LAYERNOTIFY)은 0~63 입니다.');
  for(const key of ['layerFilters','namedViews'])if(has(key)&&!Array.isArray(changes[key]))throw Error(key+' 목록 형식 오류');
  if(has('displayUnits')&&(!changes.displayUnits||typeof changes.displayUnits!=='object'||Array.isArray(changes.displayUnits)))throw Error('표시 단위 형식 오류');
  return changes;
}
// ACAD200 s7: LAYISO·LAYUNISO·레이어 상태 복원·관리자 여러 줄 고치기는 layer.update 여러 개(+레이어 상태 같은 표시와 무관한 문서 값)를 한 batch 로 보낸다.
// 예전에는 batch 라서 도면 전체를 복사·검사·다시 그렸다(O(도면)). 이제 바뀐 레이어를 읽는 객체만 다시 그린다(O(바뀐 것)).
const LAYER_META_DOCUMENT_KEYS=new Set(['layerStates','layerFilters','namedViews']);
const layerMetaDocumentUpdate=command=>command?.type==='document.update'&&!!command.changes&&typeof command.changes==='object'&&Object.keys(command.changes).length>0&&Object.keys(command.changes).every(key=>LAYER_META_DOCUMENT_KEYS.has(key));
const layerOnlyCommand=command=>command?.type==='layer.update'&&!!command.changes&&typeof command.changes==='object'
  ||command?.type==='batch'&&Array.isArray(command.commands)&&command.commands.length>0&&command.commands.some(part=>part?.type==='layer.update')&&command.commands.every(part=>part?.type==='layer.update'&&!!part.changes&&typeof part.changes==='object'||layerMetaDocumentUpdate(part))
  ||command?.type==='constraints.set'&&!command.solve;   // ACAD200 영역 4: 풀지 않는 구속 저장도 객체를 안 바꾼다
// ACAD200 119: 도면 선종류 축척(LTSCALE)만 바꾸는 문서 편집도 객체를 고치지 않는다: 복사 없는 가벼운 길(화면은 유니폼만 바꾼다).
const linetypeScaleOnlyCommand=command=>command?.type==='document.update'&&!!command.changes&&typeof command.changes==='object'&&Object.keys(command.changes).length===1&&Number(command.changes.linetypeScale)>0;
// Property changes that could link an object to walls, rooms or schedules keep
// the full synchronization path.
const LINKING_CHANGES=['hostWall','roomBoundary','scheduleKind','scheduleIds','type','id','parameters','wallName'];
const plainChanges=changes=>!!changes&&typeof changes==='object'&&!LINKING_CHANGES.some(key=>Object.prototype.hasOwnProperty.call(changes,key));
const scopedEditIds=command=>{
  const style=styleEditIds(command);if(style)return style;
  if(['move','copy','rotate','scale','mirror','delete','offset','fillet','chamfer','transform','transform.copy'].includes(command?.type))return command.ids||[];
  if(command?.type==='array.edit')return command.id?[command.id]:[];
  if(command?.type==='constraints.set'&&command.solve)return Array.isArray(command.solveIds)?command.solveIds:[];
  if(['array','explode','block.create'].includes(command?.type))return command.ids||[];
  // ACAD200 120: DRAWORDER 맨 앞/맨 뒤는 같은 객체의 순서만 바꾼다(복사 없이 가벼운 길). 기준 객체 위·아래는 예전 길.
  if(command?.type==='draworder'&&(command.position==='front'||command.position==='back'))return command.ids||[];
  if(command?.type==='stretch')return Array.isArray(command.targets)?command.targets.map(target=>target?.id):[];
  // 6.0.18: 레이어·색만 100개 넘게 바꾸면 예전 경로가 더 빨랐다(500개 A/B: 확정 1.1→1.9초, 되돌리기 0.04→1.3초) — 그 제한을 지킨다.
  if(styleEditIdsAll(command))return null;
  if(command?.type==='update')return plainChanges(command.changes)?command.ids||[]:null;
  if(command?.type==='updateMany')return Array.isArray(command.updates)&&command.updates.every(update=>plainChanges(update?.changes))?command.updates.map(update=>update.id):null;
  if(['trim','extend'].includes(command?.type))return command.id?[command.id]:[];
  return null;
};
const canEditWithoutGlobalSync=(command,doc,onTargets)=>canScopeIds(scopedEditIds(command),command,doc,onTargets);
const canScopeIds=(ids,command,doc,onTargets)=>{
  if(!ids?.length)return false;
  const set=new Set(ids),targets=entitiesById(doc.entities,set);
  if(targets.length!==set.size)return false;
  // Blocks can feed schedules and architectural objects can feed walls/room
  // tags.  Those remain on the conservative full-sync path.  A plain block
  // (DWG INSERT, furniture) only feeds a block schedule table, so without such
  // a table it takes the scoped path: a full copy of a 190k-object drawing
  // for one moved washer cost more than a second per command.
  if(targets.some(entity=>entity.type==='wall'||entity.hostWall||entity.roomBoundary||entity.scheduleKind))return false;
  // Commands creating block references (a new block, exploded nested blocks,
  // arrayed copies) feed a block schedule like a moved block does.
  const hasBlockTarget=targets.some(entity=>entity.type==='block')||['explode','block.create','array'].includes(command.type);
  // Reverse dependencies exist only if some entity links a wall/room or is a
  // block schedule; the index counts those, so plain plans skip this scan.
  const features=entityIndex(doc.entities)?.features;
  if(features){
    // 221: 역참조 색인(영구 반응자)으로 "이 객체를 보는 객체"를 바로 찾는다 — 벽·실이 있는 도면도 전체를 훑지 않는다.
    if(hasBlockTarget&&features.blockSchedule)return false;
    if(features.hostWall||features.roomBoundary||features.roomSchedule){const dependents=dependentsOf(doc.entities,set);if(!dependents||dependents.size)return false;}
  }else{
    if(doc.entities.some(entity=>set.has(entity.hostWall)||set.has(entity.roomBoundary)||hasBlockTarget&&entity.scheduleKind==='blocks'))return false;
    // 실별 면적표가 집계한 경계·실명을 고치면 표를 다시 계산해야 하므로 전체 동기화로 보낸다.
    if(doc.entities.some(entity=>entity.roomSchedule?.sourceIds?.some(id=>set.has(id))))return false;
  }
  // 연관 치수(치수가 따라가는 원본·자동 끊기 객체)를 고쳐도 가벼운 길에 남는다: 엔진이 색인의 원본 id 역색인으로 그 원본을 쓰는
  // 치수만 찾아 같은 명령 안에서 다시 계산한다(syncAssocDependents). 색인이 없을 때만(확정 전 배열) 예전처럼 전체 동기화로 보낸다.
  if(command.type!=='copy'&&!entityIndex(doc.entities)?.assoc&&doc.entities.some(entity=>isAssocDimension(entity)&&assocSourceIds(entity).some(id=>set.has(id))))return false;
  // EXPLODE lifts children to the top level, where walls and linked objects
  // take part in the full synchronization.
  if(command.type==='explode'&&targets.some(entity=>linkedInside(entity,doc.sharedBlocks)))return false;
  onTargets?.(targets);
  return true;
};
const linkedInside=(entity,definitions,seen=new Set())=>{
  for(const child of entity?.entities||[])if(child&&(child.type==='wall'||child.hostWall||child.roomBoundary||child.scheduleKind||linkedInside(child,definitions,seen)))return true;
  if(entity?.sharedBlock&&definitions&&!seen.has(entity.sharedBlock)){seen.add(entity.sharedBlock);if(linkedInside(definitions[entity.sharedBlock],definitions,seen))return true;}
  return false;
};
// INSERT adds one block reference; only a block schedule reads it.
const canInsertWithoutGlobalSync=(command,doc)=>{
  if(command?.type!=='block.insert')return false;
  const features=entityIndex(doc.entities)?.features;
  return features?!features.blockSchedule:!doc.entities.some(entity=>entity.scheduleKind==='blocks');
};
const appendWorkingDocument=doc=>({
  ...doc,
  // add.classified may normalize an existing standard layer, so layers must
  // be detached even though existing entities stay shared and immutable.
  layers:doc.layers.map(layer=>({...layer})),
  entities:[...doc.entities],
  blocks:doc.blocks,
  ...(doc.sharedBlocks?{sharedBlocks:doc.sharedBlocks}:{}),
});
const validatedSharedDefinitions=new WeakMap();
/* 해치 무늬 줄 한도. 표준 무늬 중 가장 긴 CONCRETE3 이 304줄이다. 화면·출력은 선분 수 상한(hatchSegments)으로 따로 보호한다. */
export const HATCH_PATTERN_LIMITS=Object.freeze({lines:1024,dashes:256});
const validPatternLine=l=>!!l&&Number.isFinite(l.angle)&&!!l.base&&Number.isFinite(l.base.x)&&Number.isFinite(l.base.y)&&!!l.offset&&Number.isFinite(l.offset.x)&&Number.isFinite(l.offset.y)&&Array.isArray(l.dashes)&&l.dashes.length<=HATCH_PATTERN_LIMITS.dashes&&l.dashes.every(Number.isFinite);
export const validHatchPattern=lines=>Array.isArray(lines)&&lines.length<=HATCH_PATTERN_LIMITS.lines&&lines.every(validPatternLine);
/* 불러올 때 무늬 정의가 잘못된 해치 하나 때문에 도면 전체가 안 열리면 안 된다 — 그 해치만 예전 사선 무늬로 바꾸고 표시해 둔다. */
export function repairHatchPatterns(doc){
  let repaired=0;
  const visit=e=>{if(!e||typeof e!=='object')return;if(e.type==='hatch'&&e.patternLines!=null&&!validHatchPattern(e.patternLines)){delete e.patternLines;e.patternFallback=true;repaired++;}for(const child of e.entities||[])visit(child);};
  for(const e of doc?.entities||[])visit(e);
  for(const block of doc?.blocks||[])for(const e of block?.entities||[])visit(e);
  for(const definition of Object.values(doc?.sharedBlocks||{}))for(const e of definition?.entities||[])visit(e);
  return repaired;
}
const clearRenderCache=entity=>{
  if(!entity)return;
  for(const key of ['_renderBounds','_visibleEntities','_lodCollapsed'])delete entity[key];
  for(const child of entity.entities||[])clearRenderCache(child);
};
/* 212: 지울 객체를 포인터로 빼낸 새 배열. AutoCAD 는 스텁의 지움 비트(0x800)만 뒤집지만, 바른 CAD 의 문서 배열은
   되돌리기 이력과 나눠 쓰는 불변 배열이라 비트를 남기면 읽는 곳마다 걸러야 한다. 대신 몇 개를 지우면 위치를 포인터로 찾아
   조각 복사(문자열 id 해시 없음)하고, 많이 지우면 포인터 집합으로 한 번 거른다. 남은 배열에 지운 객체 찌꺼기가 없어
   선택·출력·저장이 따로 거를 일이 없다. */
export function removeEntities(list,targets){
  if(!targets.length)return list;
  if(targets.length<=16){
    const at=targets.map(e=>list.indexOf(e));
    if(at.every(i=>i>=0)&&new Set(at).size===at.length){
      at.sort((a,b)=>a-b);
      const out=new Array(list.length-at.length);let o=0,from=0;
      for(const i of at){for(let k=from;k<i;k++)out[o++]=list[k];from=i+1;}
      for(let k=from;k<list.length;k++)out[o++]=list[k];
      return out;
    }
  }
  const gone=new Set(targets),ids=new Set(targets.map(e=>e.id));
  // 같은 id 의 다른 객체(작업 배열이 복사본을 가진 경우)도 예전처럼 id 로 지운다.
  return list.filter(e=>!gone.has(e)&&!ids.has(e.id));
}
/* 메모리 정책(2026-10 AutoCAD 2027 역공학, 202): AutoCAD 도 객체 페이징을 하지 않는다
   (AcDbImpObject::closeAndPage 는 close 로 바로 넘어가는 4바이트 함수). 줄일 곳은 객체 표현 크기와 되돌리기·복구 기록이다.
   - 큰 본체·하위 객체: entity-stubs.js 의 스텁 표·지연 읽기(201·203·205)
   - 되돌리기: 바뀐 객체만 차지하는 복사 후 쓰기(210), 단계별 차이 기록(history-delta.js, 209·211), 힙 밖 기록(undo-log.js, 208)
   객체를 "닫을 때 내리는" 범용 페이징은 넣지 않는다. 다시 만들지 말 것. */
/* LAYDEL 계획: 지울 레이어의 객체를 뺀 최상위 목록과 블록 정의. 블록 안 객체만 걸린 최상위 블록은 새 사본으로 바꾼다(기록 불변).
   바뀐 것이 없는 객체·정의는 같은 것을 그대로 쓴다. 미리 세기(countLayerDelete)와 같은 규칙. */
const pruneLayerChildren=(entity,ids)=>{
  if(!entity.entities?.length)return entity;
  let changed=false;const kept=[];
  for(const child of entity.entities){if(ids.has(child.layer)){changed=true;continue;}const next=pruneLayerChildren(child,ids);if(next!==child)changed=true;if(next)kept.push(next);}
  if(!changed)return entity;
  if(!kept.length)return null;   // 속이 모두 지워진 블록 참조는 함께 지운다(빈 블록 참조는 도면 오류)
  const copy={...entity,entities:kept};clearRenderCache(copy);return copy;
};
export function layerDeletePlan(doc,ids){
  const entities=[];let removed=0;
  for(const e of doc.entities){if(ids.has(e.layer)){removed++;continue;}const next=pruneLayerChildren(e,ids);if(next)entities.push(next);else removed++;}
  let blocksChanged=false;const blocks=(doc.blocks||[]).map(b=>{const kept=(b.entities||[]).filter(e=>!ids.has(e.layer)).map(e=>pruneLayerChildren(e,ids)).filter(Boolean);if(kept.length!==(b.entities||[]).length||kept.some((e,i)=>e!==b.entities[i])){blocksChanged=true;return {...b,entities:kept};}return b;});
  return {entities,blocks:blocksChanged?blocks:null,removed};
}
/* 실행 전 안내용: 최상위 객체 수, 블록 안 객체 수, 영향 받는 블록 정의 수. */
export function countLayerDelete(doc,ids){
  let top=0,nested=0;const definitions=new Set();
  const inside=e=>{for(const child of e.entities||[]){if(ids.has(child.layer))nested++;else inside(child);}};
  for(const e of doc.entities){if(ids.has(e.layer))top++;else inside(e);}
  for(const b of doc.blocks||[]){const before=nested;for(const e of b.entities||[]){if(ids.has(e.layer))nested++;else inside(e);}if(nested!==before)definitions.add(b.name||b.id);}
  return {top,nested,blocks:definitions.size};
}
/* LAYEREVAL(ACAD200 707): 도면에 layerEval 이 켜져 있으면 붙여넣기·삽입·가져오기·리습으로 새로 생긴 레이어에 확인 전 표시를 붙인다.
   사용자가 직접 만든 레이어(layer.add)와 바른 표준 레이어 이름은 이미 확인된 것으로 본다. 레이어 수가 늘었을 때만 레이어 표만 본다(O(레이어)).
   표시는 같은 실행 안에서 붙어 되돌리기 한 번에 함께 사라진다. */
const USER_LAYER_COMMANDS=new Set(['layer.add','load','new','add.classified']);
function markUnreconciledLayers(previous,doc,command){
  if(USER_LAYER_COMMANDS.has(command?.type))return;
  if(command?.type==='batch'&&command.commands?.every(part=>USER_LAYER_COMMANDS.has(part?.type)||part?.type==='layer.update'))return;
  const old=new Set(previous.layers.map(l=>l.id));
  doc.layers=doc.layers.map(l=>old.has(l.id)||standardLayerForName(l.name)||l.reconciled===false?l:{...l,reconciled:false});
}
// list.push(...items) 는 약 12만 개를 넘으면 호출 스택이 넘친다(10/30 19.6만 개 COPY·붙여넣기가 조용히 실패).
const pushAll=(list,items)=>{for(const item of items)list.push(item);return list;};
export class DrawingEngine {
  constructor() {
    this.doc = blankDocument();
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = [];
    this.batchedListeners = [];
    this.suppressed = 0;
    this.pendingNotice = null;
    this.lastExecution = null;
    // 209: 되돌리기 단계마다 객체 차이. 문서를 약하게 가리켜 이력에서 빠진 문서를 붙잡지 않는다.
    this.history = createHistoryLog({limit:HISTORY_RECORD_LIMIT});
    // 210: 큰 스타일 편집을 복사 후 쓰기로. 문제가 생기면 false 로 예전(문서 전체 복사) 경로로 돌린다.
    this.bulkStyleCow = true;
  }
  /* 되돌리기 묶음(transaction). begin~end 사이의 여러 명령은 되돌리기 한 단계가 된다.
     보조명령 카드가 객체마다 execute/commit 을 수백 번 불러도 되돌리기 상한(100)을 소모하지 않고,
     end 에서 시작 문서 하나만 되돌리기 더미에 넣는다. 중첩 begin 은 깊이만 센다.
     묶음 도중 undo/redo 가 오면 먼저 묶음을 닫아 지금까지의 변경을 한 단계로 확정한다. */
  beginTransaction() {
    this.dropStaleTransaction();
    if (this.transaction) { this.transaction.depth++; return this.transaction.depth; }
    // 묶음은 시작한 되돌리기 더미(stack)에 묶인다. 도면 탭 전환·새 도면·불러오기로 더미가 바뀌면 그 묶음은 버린다(다른 탭 이력 오염 방지).
    // tail/delta(209): 묶음 안 명령들의 객체 차이를 이어 붙인다. 한 단계라도 차이를 모르면 null(예전 비교로).
    this.transaction = { base: this.doc, stack: this.undoStack, depth: 1, changed: false, count: 0, tail: this.doc, delta: undefined, rebuild: false, pendingBatched: false };
    return 1;
  }
  endTransaction() {
    this.dropStaleTransaction();
    const transaction = this.transaction;
    if (!transaction) return { merged: 0, changed: false };
    if (--transaction.depth > 0) return { merged: 0, changed: false, open: true };
    this.transaction = null;
    if (!transaction.changed || this.doc === transaction.base) { this.flushBatched(transaction); return { merged: 0, changed: false }; }
    this.undoStack.push(transaction.base);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    // 213: 묶음 전체가 되돌리기 한 단계 — 차이도 한 번만 남긴다(안쪽 명령마다 따로 남기지 않는다).
    this.history?.record(transaction.base, this.doc, transaction.tail === this.doc && transaction.delta ? transaction.delta : null, { rebuild: transaction.rebuild });
    this.flushBatched(transaction, { kind: 'transaction', count: transaction.count });
    return { merged: transaction.count, changed: true };
  }
  /* 213: 묶음 안에서 미룬 "묶음 알림" 받는 쪽(onChange(fn,{batched:true}))에게 바깥 끝에서 한 번만 알린다.
     화면 캐시를 고치는 보통 받는 쪽은 명령마다 바로 받는다(app.js 의 증분 갱신이 명령마다 차이를 쓰기 때문, 그리기는 rAF 로 한 번). */
  flushBatched(transaction, notice = { kind: 'transaction' }) {
    if (!transaction?.pendingBatched) return false;
    transaction.pendingBatched = false;
    for (const fn of this.batchedListeners || []) fn(this.doc, notice);
    return true;
  }
  /* 209: 화면 쪽(app.js)이 방금 명령의 정확한 객체 차이를 알려 준다. 묶음 안이면 이어 붙이고, 아니면 그 단계에 남긴다. */
  noteStepDelta(before, after, delta) {
    const transaction = this.transaction;
    if (transaction && transaction.stack === this.undoStack) {
      // 한도(HISTORY_RECORD_LIMIT)를 넘은 묶음은 더 합치지 않는다(어차피 화면은 전체를 다시 그린다).
      if (transaction.tail !== before || !delta || transaction.delta === null || (transaction.delta?.removed.length || 0) + (transaction.delta?.added.length || 0) + delta.removed.length + delta.added.length > HISTORY_RECORD_LIMIT) { transaction.delta = null; transaction.tail = after; return false; }
      transaction.delta = transaction.delta === undefined ? { removed: delta.removed.slice(), added: delta.added.slice() } : composeDelta(transaction.delta, delta);
      transaction.tail = after;
      return !!transaction.delta;
    }
    return this.history ? this.history.attach(before, after, delta) : false;
  }
  /* 깊이와 관계없이 지금 묶음을 끝낸다(카드 창을 취소했을 때 등). 변경이 있으면 한 단계로 확정한다. */
  closeTransaction() {
    if (!this.transaction) return { merged: 0, changed: false };
    this.transaction.depth = 1;
    return this.endTransaction();
  }
  /* 탭 전환·새 도면·불러오기 직전에 부른다. 묶음이 아직 이 되돌리기 더미에 속하고 변경이 있으면 지금까지의 카드 작업을
     한 단계로 확정한다(버리면 카드가 바꾼 부분이 이전 단계(예: 원 그리기)에 섞여 Ctrl+Z 한 번에 같이 사라진다).
     더미가 이미 바뀐 묶음은 다른 탭 이력이므로 확정하지 않고 버린다. */
  abortTransaction() {
    const transaction = this.transaction;
    if (!transaction) return { had: false, committed: false };
    if (transaction.stack === this.undoStack) { const result = this.closeTransaction(); return { had: true, committed: result.changed }; }
    this.transaction = null;
    return { had: true, committed: false };
  }
  /* 카드가 도중에 실패했을 때: 바깥 묶음이면 시작 전 문서로 되돌린다(반쯤 적용된 결과를 남기지 않는다).
     안쪽 묶음(폼 안의 폼)이면 바깥 작업을 지우지 않도록 평소처럼 닫는다. */
  rollbackTransaction() {
    this.dropStaleTransaction();
    const transaction = this.transaction;
    if (!transaction) return { rolledBack: false };
    if (transaction.depth > 1) { this.endTransaction(); return { rolledBack: false, nested: true }; }
    this.transaction = null;
    if (!transaction.changed || this.doc === transaction.base) { this.flushBatched(transaction); return { rolledBack: false }; }
    this.doc = transaction.base;
    G.ensureSharedDrawingReferenceBounds(this.doc);
    this.emit({ kind: 'rollback' });
    return { rolledBack: true };
  }
  /* 바로 앞 단계와 방금 단계를 되돌리기 한 번으로 합친다(HATCH 한 번에 찍은 여러 영역 = 해치 하나 = Ctrl+Z 한 번).
     되돌리기 더미 맨 위가 기대한 문서(바로 앞 단계가 끝난 문서)일 때만 합친다 — 그 사이 다른 작업이 끼었으면 합치지 않는다. */
  mergeLastUndo(expectedPrevious) {
    this.dropStaleTransaction();
    if (this.transaction || !expectedPrevious || this.undoStack.at(-1) !== expectedPrevious) return false;
    this.undoStack.pop();
    return true;
  }
  dropStaleTransaction() {
    if (this.transaction && this.transaction.stack !== this.undoStack) this.transaction = null;
  }
  inTransaction() { this.dropStaleTransaction(); return !!this.transaction; }
  /* 받는 쪽은 (문서, 알림) 을 받는다. 알림 kind: edit(명령) · history(되돌리기/다시 실행) · replace(문서 교체) · rollback · transaction.
     {batched:true} 로 등록하면 묶음 안의 알림은 모았다가 바깥 끝에서 한 번만 받는다(213). */
  // 검토 이력만 저장: 도면 객체 복사·새 undo 단계 없이 저장 변경을 알린다.
  setReviewHistory(history) {
    this.doc={...this.doc,reviewHistory:structuredClone(history)};
    this.lastExecution={type:'review.history',lightweight:true,layerOnly:true,document:this.doc};
    this.emit({kind:'metadata'});
  }
  onChange(fn, { batched = false } = {}) {
    (batched ? (this.batchedListeners ||= []) : this.listeners).push(fn);
  }
  emit(notice = { kind: 'edit' }) {
    // 214: 알림 억제 중이면 숫자 하나만 보고 돌아간다. 풀 때 모은 알림을 한 번 보낸다.
    if (this.suppressed) { this.pendingNotice = notice; return; }
    this.listeners.forEach((fn) => fn(this.doc, notice));
    if (this.transaction) { this.transaction.pendingBatched = true; return; }
    for (const fn of this.batchedListeners || []) fn(this.doc, notice);
  }
  /* 214: 대량 작업(탭 되살리기, 여러 단계 불러오기) 동안 알림을 막는다. 겹쳐 불러도 된다(깊이를 센다). */
  suppressNotification() { this.suppressed = (this.suppressed || 0) + 1; return this.suppressed; }
  resumeNotification(notice = { kind: 'replace' }) {
    if (!this.suppressed) return false;
    if (--this.suppressed > 0) return false;
    const pending = this.pendingNotice; this.pendingNotice = null;
    if (!pending) return false;
    this.emit(notice);
    return true;
  }
  /** 억제한 채 fn 을 돌리고, 바뀐 것이 있으면 끝에서 한 번만 알린다. */
  withoutNotification(fn, notice = { kind: 'replace' }) {
    this.suppressNotification();
    try { return fn(); } finally { this.resumeNotification(notice); }
  }
  selected(ids) {
    // 큰 도면(19만 객체)에서 수만 개를 한꺼번에 고쳐도 선형 시간: id·레이어는 Set/Map 으로 찾고, 연동 벽은 hostWall 이 있을 때만 찾는다.
    const wanted = ids instanceof Set ? ids : new Set(ids || []);
    const es = entitiesById(this.doc.entities, wanted);
    if (!es.length) throw Error("먼저 객체를 선택하세요.");
    const locked = new Set(this.doc.layers.filter((l) => l.locked).map((l) => l.id));
    if (locked.size && es.some((e) => locked.has(e.layer)))
      throw Error("잠긴 레이어의 객체는 편집할 수 없습니다.");
    if (locked.size && es.some((e) => e.hostWall)) {
      const hosts = new Set(es.map((e) => e.hostWall).filter(Boolean));
      const map=entityIndex(this.doc.entities)?.map;
      if (map?[...hosts].some((id) => locked.has(map.get(id)?.layer)):this.doc.entities.some((w) => hosts.has(w.id) && locked.has(w.layer))) throw Error('연동 벽 레이어가 잠겨 있습니다.');
    }
    return es;
  }
  execute(c) {
    this.lastExecution = null;
    this.lastLinked = null;
    this.dropStaleTransaction();
    if (["undo", "redo"].includes(c.type)) {
      if (this.transaction) this.closeTransaction();
      const src = c.type === "undo" ? this.undoStack : this.redoStack,
        dst = c.type === "undo" ? this.redoStack : this.undoStack;
      if (src.length) {
        const from = this.doc;
        dst.push(this.doc);
        this.doc = src.pop();
        G.ensureSharedDrawingReferenceBounds(this.doc);
        commitEntities(this.doc.entities);
        // 211: 그 단계를 실행할 때 남긴 차이를 뒤집어(되돌리기) 또는 그대로(다시 실행) 싣는다 — 화면은 두 문서를 다시 비교하지 않는다.
        const step = this.history?.between(from, this.doc);
        this.lastExecution = { history: true, type: c.type, document: this.doc, delta: step && !step.rebuild ? step.delta : null, rebuild: !!step?.rebuild };
        this.emit({ kind: 'history' });
      }
      return;
    }
    const previous = this.doc;
    let scopedTargets=null;
    const energyOnly=c.type==='energy.input',layerOnly=energyOnly||layerOnlyCommand(c)||linetypeScaleOnlyCommand(c),appendOnly=!layerOnly&&canAppendWithoutGlobalSync(c,previous),scopedEdit=!layerOnly&&!appendOnly&&(canInsertWithoutGlobalSync(c,previous)||canEditWithoutGlobalSync(c,previous,targets=>{if(c.type==='move'||c.type==='copy'||c.type==='delete')scopedTargets=targets;})),lightweight=appendOnly||scopedEdit||layerOnly;
    // 210: 큰 스타일 편집 — 엔진은 복사 후 쓰기(cow), 화면은 lightweight=false 라 예전처럼 전체를 다시 그린다.
    const bulkStyle=!lightweight&&this.bulkStyleCow!==false&&!!bulkStyleIds(c)&&canScopeIds(bulkStyleIds(c),c,previous),cow=lightweight||bulkStyle;
    // Never mutate the document currently held by history.  Complex commands
    // still receive a full detached copy; common primitive appends use COW.
    // load·new·lisp.apply 는 문서를 통째로 바꿔 끼우므로 이전 문서를 복사해 둘 필요가 없다(19만 객체면 복사만 2초).
    const replacesDocument=['load','new','lisp.apply'].includes(c.type);
    this.doc=energyOnly?{...previous}:cow?appendWorkingDocument(previous):replacesDocument?previous:cloneForHistory(previous);
    let result = [],changed=null,assocLost=0;
    try {
      this.scopedWrite=cow;
      result = this.mutate(c,this.mutate===nativeMutate&&this.selected===nativeSelected?scopedTargets:null) || [];
      if(this.doc.layerEval&&this.doc.layers.length>previous.layers.length)markUnreconciledLayers(previous,this.doc,c);
      if(!replacesDocument&&!energyOnly)result=this.refreshLinked(previous,c,result);
      if(!cow){this.syncOpenings(previous);if(!['load','new'].includes(c.type))assocLost=this.syncAssocDimensions(previous);}
      changed=cow?this.validateChanged(previous,c,result):null;
      // 가벼운 경로: 바뀐 객체 중 연관 치수만(치수만 옮기면 연관을 풀고, 자동 끊기는 다시 구한다).
      if(changed?.length&&!energyOnly)this.syncAssocChanged(previous,changed);
      // 가벼운 경로에서 원본을 고쳤으면 그 원본을 쓰는 치수만(역색인) 같은 명령 안에서 다시 계산해 changed·결과에 넣는다(되돌리기 한 번·화면 증분).
      if(cow&&!replacesDocument&&!energyOnly){
        const dependents=this.syncAssocDependents(previous,c,changed);
        if(dependents){
          this.validate({...this.doc,entities:dependents.entities,blocks:[]});
          pushAll(changed,dependents.entities);
          // 명령 결과(선택에 쓰임)에는 넣지 않는다: 화면은 lastExecution.linked 로 옛 모양을 빼고 새 모양을 넣는다.
          this.lastLinked=[...(this.lastLinked||[]),...dependents.entities.map(e=>e.id)];assocLost+=dependents.lost;
        }
      }
      // The layer table itself (names, colours, flags) is always checked.
      if(layerOnly)this.validate({...this.doc,entities:[],blocks:[]});
      if(!cow)this.validate(this.doc);
      // A lightweight edit keeps every other object; only new ones need bounds.
      G.ensureSharedDrawingReferenceBounds(this.doc,changed||this.doc.entities);
    } catch (err) {
      this.doc = previous;
      throw err;
    } finally {
      this.scopedWrite=false;
    }
    if (this.transaction) {
      // 묶음 안에서는 시작 문서만 기억한다(end 에서 한 번 push). 중간 문서는 되돌리기 더미에 쌓지 않는다.
      this.transaction.changed = true; this.transaction.count += 1;
      if (bulkStyle) this.transaction.rebuild = true;
      // 화면 쪽이 차이를 알려 주지 않는 명령(전체 동기화)은 묶음 차이를 모름으로 만든다.
      if (!lightweight && this.transaction.tail === previous) { this.transaction.delta = null; this.transaction.tail = this.doc; }
    } else {
      this.undoStack.push(previous);
      if (this.undoStack.length > 100) this.undoStack.shift();
      // 209: 단계를 먼저 남기고, 정확한 차이는 화면 쪽이 noteStepDelta 로 채운다(큰 스타일 편집은 되돌릴 때도 전체 다시 그리기).
      if (!replacesDocument) this.history?.record(previous, this.doc, null, { rebuild: bulkStyle });
    }
    this.redoStack = [];
    // Renderer caches may consume deltas only for this explicitly proven
    // copy-on-write path. Full synchronization can replace entities that are
    // not present in the command result (wall joins, openings, tables).
    // previous·command 는 계획 판정 캐시가 쓰는 가벼운 편집에서만 남긴다. load·new 뒤 옛 큰 도면을 붙잡지 않게.
    this.lastExecution = {lightweight,appendOnly,scopedEdit,layerOnly,bulkStyle,type:c.type,document:this.doc,changed,...(assocLost?{assocLost}:{}),linked:this.lastLinked||null,...(lightweight?{previous,command:c}:{})};
    // The finished document is now history-immutable: its array may be indexed.
    commitEntities(this.doc.entities);
    this.emit({kind:replacesDocument?'replace':'edit'});
    return result;
  }
  /* 연관 치수(ACAD200 513·518): 명령 끝에 한 번, 원본이 바뀐 치수만 다시 계산한다. AutoCAD 도 반응자로 모아 두었다가 명령 끝에 몰아서 고친다.
     연관 치수가 없는 도면은(색인이 센다) 아무것도 훑지 않는다. 돌려주는 값은 원본이 지워져 새로 끊긴 치수 수. */
  syncAssocDimensions(previous){
    if(!previous)return 0;
    const index=entityIndex(previous.entities);
    if(index?!index.assoc?.dims:!previous.entities.some(isAssocDimension))return 0;
    this.assocScan='full';
    let map=index?.map;
    if(!map){map=new Map();for(const e of previous.entities)map.set(e.id,e);}
    return syncAssociativeDimensions(this.doc.entities,id=>map.get(id),{primitivesOf:this.assocPrimitives()}).lost;
  }
  /* 가벼운 경로(복사 후 쓰기)에서 원본이 바뀐 연관 치수(ACAD200 513): 원본 id → 치수 역색인으로 의존 치수만 찾는다.
     연관 치수가 없는 도면·의존 치수가 없는 편집은 아무것도 훑지 않는다. 치수는 새 객체로 작업 배열에서 갈아 끼운다(이력과 나눠 쓰지 않음). */
  syncAssocDependents(previous,c,changed){
    const index=entityIndex(previous.entities);
    if(!index?.assoc?.dims||c.type==='copy')return null;
    const own=new Set(changed.map(e=>e.id)),touched=[...own,...(scopedEditIds(c)||[]),...(bulkStyleIds(c)||[])];
    const dims=assocDependentsOf(previous.entities,touched);
    for(const id of own)dims?.delete(id);   // 명령이 직접 바꾼 치수는 syncAssocChanged 가 맡았다
    if(!dims?.size)return null;
    this.assocScan='scoped';
    // 지금 문서 = 명령 전 객체 + 포인터 차이(바뀐·지운 객체). 차이가 너무 크면 한 번 id 지도를 만든다.
    const list=this.doc.entities,delta=pointerDelta(previous.entities,list);
    let nowOf;
    if(delta){
      const added=new Map(delta.added.map(e=>[e.id,e])),gone=new Set();
      for(const e of delta.removed)if(!added.has(e.id))gone.add(e.id);
      nowOf=id=>added.get(id)??(gone.has(id)?undefined:index.map.get(id));
    }else{const map=new Map();for(const e of list)map.set(e.id,e);nowOf=id=>map.get(id);}
    const beforeOf=id=>index.map.get(id),primitivesOf=this.assocPrimitives(),next=new Map();
    let lost=0;
    for(const id of dims){
      const dim=index.map.get(id);if(!dim||nowOf(id)!==dim)continue;   // 지워졌거나 명령이 이미 바꾼 치수
      const updated=refreshAssocDimension(dim,dim,nowOf,beforeOf,{primitivesOf});
      if(!updated)continue;
      clearRenderCache(updated);next.set(dim,updated);if(updated.assocLost&&!dim.assocLost)lost++;
    }
    if(!next.size)return null;
    if(next.size<=16)for(const [dim,updated] of next)list[list.indexOf(dim)]=updated;
    else for(let i=0;i<list.length;i++){const updated=next.get(list[i]);if(updated)list[i]=updated;}
    return {entities:[...next.values()],lost};
  }
  syncAssocChanged(previous,changed){
    if(!changed.some(isAssocDimension))return 0;
    let map=entityIndex(previous.entities)?.map;
    if(!map){map=new Map();for(const e of previous.entities)map.set(e.id,e);}
    return syncChangedAssocDimensions(changed,id=>map.get(id),{primitivesOf:this.assocPrimitives()});
  }
  assocPrimitives(){
    const doc=this.doc;
    return e=>G.primitives(e?.sharedBlock&&!e.entities?.length&&doc.sharedBlocks?G.materializeSharedDrawingReference(doc,e):e);
  }
  validateChanged(previous,command,result){
    if(this.doc.entities.length>MAX_DRAWING_OBJECTS)throw Error("도면 객체가 300만 개를 넘어 열 수 없습니다.");
    const before=entityIndex(previous.entities);
    if(command.type==='add'&&command.entity?.id&&(before?before.map.has(command.entity.id):previous.entities.some(entity=>entity.id===command.entity.id)))throw Error("객체 ID 중복 또는 오류");
    if(!result?.length)return [];
    const ids=new Set(result),changed=changedById(previous.entities,this.doc.entities,ids);
    if(changed.length!==ids.size)throw Error("변경된 객체를 찾을 수 없습니다.");
    // The previous immutable snapshot has already passed full validation.
    // Validate only newly created/replaced entities, new block definitions and
    // the (small) layer table; unchanged ones cannot become invalid here.
    const oldBlocks=new Set(previous.blocks||[]);
    this.validate({...this.doc,entities:changed,blocks:this.doc.blocks===previous.blocks?[]:(this.doc.blocks||[]).filter(block=>!oldBlocks.has(block))});
    // New composite objects count against the drawing-wide nested limit too.
    if(command.type!=='energy.input'&&changed.some(entity=>entity.entities?.length)){
      let total=0;for(const entity of this.doc.entities)total+=nestedCount(entity);
      for(const block of this.doc.blocks||[])for(const entity of block.entities||[])total+=nestedCount(entity);
      if(total>MAX_DRAWING_OBJECTS)throw Error("도면 객체가 300만 개를 넘어 열 수 없습니다.");
    }
    return changed;
  }
  /* 연관 해치·중심선(assoc-edit.js)과 구속(constraints.js): 이번 명령이 원본을 바꿨으면 같은 명령 안에서 다시 계산한다(되돌리기 한 번).
     훑는 양 = 연관 객체 목록(entity-index 가 들고 있음) + 구속 목록. 영향받은 것이 있을 때만 도면을 한 번 본다. */
  refreshLinked(previous,c,result){
    if(!Array.isArray(result))return result;
    if(c.type==='constraints.set'&&c.solve)return result;
    const index=entityIndex(previous.entities),candidates=index?.assocObjects?[...index.assocObjects]:previous.entities.filter(isAssociative);
    let extra=candidates.length?refreshAssociations(this.doc,candidates,c,result):[];
    if(this.doc.constraints?.length&&c.type!=='constraints.set'&&constraintsTouching(this.doc.constraints,c,result))extra=[...extra,...solveConstraints(this.doc,c,[...result,...extra])];
    this.lastLinked=extra.length?extra:null;
    return extra.length?[...new Set([...result,...extra])]:result;
  }
  /** [객체, 바꿀 값] 목록을 새 객체로 만들어 작업 배열에서 갈아 끼운다(같은 객체가 여러 번 오면 값을 차례로 합친다). */
  replaceEntities(pairs){
    const next=new Map();
    for(const [entity,changes] of pairs){const base=next.get(entity.id)||entity,copy={...base,...structuredClone(changes)};clearRenderCache(copy);next.set(entity.id,copy);}
    const list=this.doc.entities,at=next.size<=16?[...next.keys()].map(id=>list.findIndex(e=>e.id===id)):null;
    if(at&&at.every(i=>i>=0)){const copy=list.slice();at.forEach(i=>{copy[i]=next.get(copy[i].id);});this.doc.entities=copy;}
    else this.doc.entities=list.map(e=>next.get(e.id)||e);
    return [...next.keys()];
  }
  /** 정의 key 를 직접·간접으로 쓰는 최상위 참조의 화면 캐시를 비우고(새 객체로) id 를 돌려준다. */
  refreshSharedUsers(key){
    const users=definitionUsers(this.doc.sharedBlocks,key),ids=[];
    this.doc.entities=this.doc.entities.map((e)=>{if(!e.sharedBlock||!users.has(e.sharedBlock))return e;const copy={...e};clearRenderCache(copy);ids.push(e.id);return copy;});
    return ids;
  }
  /* 601·607 BLOCK(공유): 고른 객체를 기준점 기준 정의 하나로 만들고, 그 자리에 참조 하나를 둔다.
     재정의(같은 이름)는 정의 교체 한 번 — 이 정의를 쓰는 삽입본(중첩 포함)이 모두 새 모양이 된다. 모양 맞추기 추정이 필요 없다. */
  createSharedBlock(c,es,append){
    const targets=es(),name=String(c.name||'').trim(),base=c.base||{x:0,y:0};
    const exists=!!this.doc.sharedBlocks?.[name]||this.doc.blocks.some((b)=>b.name===name);
    if(!name||(exists&&!c.redefine))throw Error("중복되지 않는 블록 이름을 입력하세요.");
    const plain=this.doc.blocks.find((b)=>b.name===name&&!b.sharedBlock);
    if(c.redefine&&plain&&!this.doc.sharedBlocks?.[name])throw Error("사본형 블록입니다. BLOCKSHARE 로 공유 정의로 바꾼 뒤 재정의하세요.");
    if(this.doc.sharedBlocks?.[name]?.xref)throw Error("외부참조 정의는 재정의할 수 없습니다.");
    if(targets.some((e)=>refersTo(this.doc.sharedBlocks,e,name)))throw Error("블록이 자기 자신을 포함할 수 없습니다.");
    const local=localizeEntities(targets,base);
    this.doc.sharedBlocks=withSharedDefinitions(this.doc.sharedBlocks,{[name]:{name,origin:{x:0,y:0},entities:local}});
    this.doc.version=3;
    if(!this.doc.blocks.some((b)=>b.name===name))this.doc.blocks=[...this.doc.blocks,sharedTemplate(name)];
    const refreshed=exists?this.refreshSharedUsers(name):[];
    if(c.mode==="retain")return refreshed;
    const ids=new Set(c.ids);
    this.doc.entities=this.doc.entities.filter((e)=>!ids.has(e.id));
    if(c.mode==="delete")return refreshed.filter((id)=>!ids.has(id));
    return [...refreshed.filter((id)=>!ids.has(id)),...append([{type:"block",name,sharedBlock:name,layer:targets[0].layer,position:{x:base.x,y:base.y},scale:1,rotation:0,entities:[]}])];
  }
  /* 624 EXPLODE 순서 보존: 조각들을 원래 객체가 있던 자리에 끼운다(맨 위로 올리지 않는다). */
  spliceExploded(pieces){
    const added=[],next=[];
    for(const e of this.doc.entities){
      const list=pieces.get(e.id);
      if(!list){next.push(e);continue;}
      for(const item of list){const copy=fresh(item);next.push(copy);added.push(copy.id);}
    }
    this.doc.entities=next;return added;
  }
  // Envelope numbering touches only new objects; copies get independent logical IDs.
  numberEnvelopeObjects(entities,renew=false){const groups=new Map(),kinds={EW:'exterior_wall',W:'window',RF:'roof',FL:'floor'};
    for(const e of entities){const m=String(e.reviewObjectId||'').match(/^(EW|W|RF|FL)-(\d+)$/),kind=m&&kinds[m[1]],seq=m&&Number(m[2]);if(kind&&Number.isSafeInteger(seq)&&seq>(this.doc.reviewObjectSeq?.[kind]||0))this.doc.reviewObjectSeq={...this.doc.reviewObjectSeq,[kind]:seq};}
    for(const e of entities){const old=e.reviewObjectId,kind=kinds[String(old||'').split('-')[0]]||(e.type==='wall'||e.wallPreset?'exterior_wall':e.type==='window'||e.category==='WINDOW'||Object.hasOwn(e,'uValue')?'window':e.type==='roof'||e.model3d?.kind==='roof'?'roof':e.type==='floor'||e.model3d?.kind==='slab'?'floor':null);if(!kind||old&&!renew)continue;
      const group=old||(e.wallPreset?'wall:'+e.wallPreset:kind==='window'&&e.type!=='block'&&e.type!=='window'?'window':null);
      if(group){if(!groups.has(group))groups.set(group,nextReviewObjectId(this.doc,kind));e.reviewObjectId=groups.get(group);}else e.reviewObjectId=nextReviewObjectId(this.doc,kind);
      if(kind==='exterior_wall'){e.thermalLayers??=null;e.exposure??=null;}
    }return entities;
  }
  mutate(c,scopedTargets=null) {
    const es = () => this.selected(c.ids || []),
      append = (entities) => {
        const added = this.numberEnvelopeObjects(entities.map(fresh));
        pushAll(this.doc.entities,added);
        return added.map((e) => e.id);
      },
      replace = (old, items) => {
        this.doc.entities = this.doc.entities.filter((e) => e.id !== old.id);
        return append(items.map(e=>({...e,...(old.reviewObjectId?{reviewObjectId:old.reviewObjectId}:{})})));
      };
    switch (c.type) {
      case 'model3d.settings': {
        const settings=c.settings;
        if(!settings||typeof settings!=='object'||Array.isArray(settings)||Object.keys(settings).some(k=>!['floorHeights','autoSlabs','autoRoof','materials'].includes(k)))throw Error('3D 설정 오류');
        if(Object.hasOwn(settings,'floorHeights'))validateFloorHeights(settings.floorHeights);
        for(const key of ['autoSlabs','autoRoof'])if(settings[key]!==undefined&&typeof settings[key]!=='boolean')throw Error('3D 자동 생성 설정 오류');
        const next=structuredClone(settings);
        // 종류별 재료(material-presets.js): 지금 설정에 합치고, null 은 기본 재료로 되돌린다
        if(Object.hasOwn(settings,'materials')){validateMaterialMap(settings.materials);const merged={...this.doc.model3d?.materials};for(const [kind,id] of Object.entries(settings.materials))if(id===null)delete merged[kind];else merged[kind]=id;next.materials=merged;}
        this.doc.model3d={...this.doc.model3d,...next};return [];
      }
      case 'model3d.set': {
        validateModel3D(c.changes);
        if(!Array.isArray(c.ids)||!c.ids.length||c.ids.some(id=>typeof id!=='string'))throw Error('부재 ID가 필요합니다.');
        const targets=es();
        if(targets.length!==new Set(c.ids).size)throw Error('없는 객체 ID');
        // 가구·위생·주방 블록도 3D 상자 높이·바닥 높이·색·재료를 받는다(형태 kind·지붕은 안 받음)
        const furnitureBlock=e=>!!furnitureSpec(e,this.doc.layers.find(l=>l.id===e.layer)?.name);
        for(const e of targets)if(furnitureBlock(e)?['kind','roofRise'].some(k=>Object.hasOwn(c.changes,k)):!(e.type==='wall'||e.type==='rectangle'||e.type==='rect'||e.type==='polyline'&&e.closed))throw Error(furnitureBlock(e)?'가구 3D 는 높이·바닥 높이·색·재료만 바꿀 수 있습니다.':'벽·닫힌 윤곽·가구 블록을 선택하세요. 문·창·계단은 평면 속성 편집을 사용하세요.');
        // 재료는 그 부재 종류에 맞아야 한다(벽에 유리 재료 같은 저장은 막는다)
        if(c.changes.material)for(const e of targets){const next={...e.model3d,...c.changes},kind=e.type==='wall'?'wall':next.kind==='slab'?'slab':next.kind==='roof'||next.roof?'roof':'solid',preset=materialPreset(c.changes.material);if(!preset.kinds.includes(kind))throw Error(`${preset.label}(${preset.id})은 이 부재(${kind})에 쓸 수 없습니다.`);}
        return this.replaceEntities(targets.map(e=>[e,{model3d:{...e.model3d,...c.changes}}]));
      }
      case 'site.analyze': this.doc.siteAnalysis=structuredClone(c.analysis);return [];
      case 'energy.input':{
        const changes=c.changes,keys=['thermalLayers','exposure','uValue'];if(changes&&Object.keys(changes).some(k=>!keys.includes(k)))throw Error('Invalid energy fields');
        const targets=c.ids?.length?this.selected(c.ids):[];this.doc.reviewSettings={...this.doc.reviewSettings,energy:structuredClone(c.settings)};
        return changes?this.replaceEntities(targets.map(e=>[e,changes])):[];
      }
      case 'review.settings':{
        this.doc.reviewSettings={...this.doc.reviewSettings,...c.settings};
        if(c.settings.floorHeight!==undefined){if(!(Number.isFinite(c.settings.floorHeight)&&c.settings.floorHeight>0))throw Error('층고는 양수여야 합니다.');const linked=this.doc.entities.filter(e=>e.parameters?.kind==='STAIR'&&e.parameters.floorSource==='global');if(linked.length)this.selected(linked.map(e=>e.id));for(const e of linked)this.doc.entities[this.doc.entities.indexOf(e)]=rebuildArchitecture(e,{floorHeight:c.settings.floorHeight});}return [];
      }
      case 'livecheck.layers':
        for(const update of c.layers){const layer=this.doc.layers.find(l=>l.id===update.id);if(!layer||layer.locked)throw Error('잠긴 레이어는 변경할 수 없습니다.');Object.assign(layer,update.changes);}return [];
      case 'layer.review': return applyDrawingLayerReview(this.doc,c.decisions,{outline:c.outline,zone:c.zone});
      case 'foreign.apply': return applyForeignDrawing(this.doc,c.additions,{zone:c.zone});
      case 'layer.auto': return autoOrganizeDrawingLayers(this.doc);
      case 'layer.organize': return organizeBarunLayers(this.doc);
      case 'design.import': {
        if(!Array.isArray(c.documents)||!c.documents.length||c.documents.length>10)throw Error('생성 도면이 없습니다.');
        const bounds=G.bounds(this.doc.entities);
        let x=bounds?bounds.maxX+10000:0;
        // Generated sheets can have very different amounts of notes below the frame.
        // Align their visible tops so repeated 1/2/3 proposals form one readable row.
        const top=bounds?bounds.maxY:0, ids=[];
        let sequence=1;
        while(this.doc.layers.some(l=>l.name.startsWith(`${c.reference?'설계사례':'자동배치'}_${String(sequence).padStart(2,'0')}_`)))sequence++;
        const group=String(sequence).padStart(2,'0');
        for(let i=0;i<c.documents.length;i++){
          const source=structuredClone(c.documents[i]);this.validate(source);
          const b=G.bounds(source.entities);if(!b)throw Error('빈 생성 도면입니다.');
          const layerMap=new Map(source.layers.map(l=>[l.id,crypto.randomUUID()]));
          const prefix=`${c.reference?'설계사례':'자동배치'}_${group}_${i+1}_`;
          for(const l of source.layers)this.doc.layers.push({...l,id:layerMap.get(l.id),name:prefix+l.name,visible:true,locked:false,frozen:false});
          const remap=e=>({...e,id:crypto.randomUUID(),layer:layerMap.get(e.layer),designGroup:group,...(e.entities?{entities:e.entities.map(remap)}:{})});
          const dx=x-b.minX,dy=top-b.maxY;
          const added=source.entities.map(e=>G.translate(remap(e),dx,dy));
          if(source.siteAnalysis){
            const analysis=structuredClone(source.siteAnalysis), shift=p=>({x:p.x+dx,y:p.y+dy});
            analysis.buildable=analysis.buildable.map(p=>({outer:p.outer.map(shift),holes:(p.holes||[]).map(h=>h.map(shift))}));
            if(analysis.northProfile)analysis.northProfile.boundary=analysis.northProfile.boundary.map(shift);
            analysis.layerIds=[...layerMap.values()];this.doc.siteAnalysis=analysis;
          }
          pushAll(this.doc.entities,added);pushAll(ids,added.map(e=>e.id));
          if(source.metadata?.sourceCase){
            this.doc.designCaseImports??=[];
            this.doc.designCaseImports.push({...structuredClone(source.metadata),group,entityIds:added.map(e=>e.id),layerIds:[...layerMap.values()]});
          }
          for(const block of source.blocks??[])this.doc.blocks.push({...block,name:prefix+block.name,entities:block.entities.map(remap)});
          x+=b.maxX-b.minX+10000;
        }
        return ids;
      }
      case 'design.add': {
        if(!['A안','B안'].includes(c.name))throw Error('설계안 이름 오류');
        const name='배치_'+c.name;
        let layer=this.doc.layers.find(l=>l.name===name);
        if(layer&&(layer.locked||!layer.visible||layer.frozen))throw Error('배치안 레이어의 잠금과 숨김을 해제하세요.');
        if(!layer){layer={id:crypto.randomUUID(),name,color:c.name==='A안'?'#ade5cf':'#ffd479',visible:true,locked:false,lineweight:0.35,linetype:'CONTINUOUS'};this.doc.layers.push(layer);}
        return append([{type:'polyline',closed:true,points:c.points,layer:layer.id,designAlternative:c.name}]);
      }
      case 'parcel.import': {
        if(!Array.isArray(c.entities)||!c.entities.length||c.entities.length>8000)throw Error('대지 경계 객체 수를 확인하세요.');   // 주변 건물 6,000동 + 등고선
        // 바른 레이어 세트(2026-10-10): 어느 길로 가져와도 대지·계획 표준 이름. 원대지경계=지적 원래 선, 가각전제=건축선.
        const roleKeys={site:'boundary',road:'road','road-info':'review',neighbor:'adjacentParcels','site-original':'originalBoundary','corner-cut':'review',label:'siteInfo','site-dimension':'dimensions',building:null,contour:null,'contour-major':null};
        const names=Object.fromEntries(Object.entries(roleKeys).map(([role,key])=>[role,[SITE_ROLE_LAYERS[key]||({building:'A-SITE-BLDG',contour:'A-SITE-TOPO','contour-major':'A-SITE-TOPO-MAJR'})[role],role==='site'?'#9dcbe0':'#91b4c9']])),map={};
        const options=selectSiteDrawOptions(c.drawOptions),source=c.entities;
        const selected=selectSiteEntities(source,options);
        if(c.drawingGeo!==undefined){
          const g=c.drawingGeo;
          if(!g||!['EPSG:5179','EPSG:5187'].includes(g.crs)||!Array.isArray(g.originM)||g.originM.length!==2||!g.originM.every(Number.isFinite)||g.unit!=='mm'||!Number.isFinite(g.rotationDeg??0))throw Error('도면 지리 정합(drawingGeo) 값을 확인하세요.');
          const current=this.doc.drawingGeo;
          if(current&&(current.crs!==g.crs||Math.hypot(current.originM[0]-g.originM[0],current.originM[1]-g.originM[1])>1e-6))throw Error('이 도면은 다른 좌표 원점으로 지적을 그렸습니다. 같은 원점으로 다시 불러오세요.');
          this.doc.drawingGeo={crs:g.crs,originM:[...g.originM],unit:'mm',rotationDeg:g.rotationDeg??0};
        }
        for(const e of selected){
          const cornerHatch=e.parcelRole==='corner-cut'&&e.type==='hatch';
          const roadDisplay=e.parcelRole==='road-info'&&['hatch','text'].includes(e.type);
          const labelText=e.parcelRole==='label'&&e.type==='text';const dimension=e.parcelRole==='site-dimension'&&e.type==='dimension';const contourLine=['contour','contour-major'].includes(e.parcelRole)&&e.type==='polyline';
          if(((e.type!=='polyline'||!e.closed)&&!cornerHatch&&!roadDisplay&&!labelText&&!contourLine&&!dimension)||!names[e.parcelRole])throw Error('유효한 필지 경계만 가져올 수 있습니다.');
          const role=e.parcelRole;if(map[role])continue;
          const [name,color]=names[role];let layer=this.doc.layers.find(l=>l.name===name);
          if(layer&&(layer.locked||!layer.visible||layer.frozen))throw Error(name+' 레이어를 표시·해동·잠금 해제한 뒤 가져오세요.');
          if(!layer){const spec=standardLayerForName(name);layer={id:crypto.randomUUID(),name,color:spec?.color||color,visible:true,locked:false,lineweight:spec?.lineweight??(role==='site'?0.5:role==='road'?0.3:0.18),linetype:spec?.linetype||'CONTINUOUS',...(SITE_LAYER_LABELS[name]?{label:SITE_LAYER_LABELS[name]}:{})};this.doc.layers.push(layer);}   // 색·굵기는 레이어 기준(generation-layer-standards.json) — 예전엔 여기 박힌 하늘색이 기준을 이겼다(2026-10-28)
          map[role]=layer.id;
        }
        const entities=selected.map(e=>{const entity={...e,layer:map[e.parcelRole],...(e.parcelRole==='site-original'?{referenceOnly:true}:{})};delete entity.color;delete entity.aci;delete entity.colorMode;return entity;});
        for(const e of entities)if(e.parcelRole==='site'){const info=e.attributes?.landInfo||{pnu:e.attributes?.pnu};const siteContext=c.siteContexts?.[info.pnu]||createSiteContext(source.filter(x=>x.parcelRole!=='site'||x.attributes?.pnu===info.pnu),{info,drawOptions:options});e.attributes={...e.attributes,siteContext,siteSourceContext:structuredClone(siteContext),siteSourceGeometry:source.filter(x=>x.parcelRole==='site'&&x.attributes?.pnu===info.pnu).map(x=>structuredClone(x.points))};}
        const ids=c.block===true?append([{type:'block',name:'지적도 · 대지와 주변',layer:map.site||Object.values(map)[0],parcelGroup:true,entities:entities.map(fresh)}]):append(entities);
        const infos=new Map(source.filter(e=>e.parcelRole==='site'&&e.attributes?.landInfo).map(e=>[e.attributes.pnu,e.attributes.landInfo]));
        for(const info of infos.values())this.mutate({type:'parcel.info',info,drawOptions:options,siteContext:c.siteContexts?.[info.pnu]||createSiteContext(source.filter(e=>e.parcelRole!=='site'||e.attributes?.pnu===info.pnu),{info,drawOptions:options}),allowNoSite:true});return ids;
      }
      case 'parcel.geometry': {
        if(!c.pnu||!Array.isArray(c.entities)||!c.entities.length||c.entities.some(e=>e.parcelRole!=='site'||e.type!=='polyline'||!e.closed||e.attributes?.pnu!==c.pnu||!Array.isArray(e.points)||e.points.length<3||e.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))))throw Error('다시 불러올 대지 경계를 확인하세요.');
        const containers=[];const find=(owner,key)=>{const list=owner[key];if(list.some(e=>e.parcelRole==='site'&&e.attributes?.pnu===c.pnu))containers.push({owner,key,list});for(const e of list)if(e.entities)find(e,'entities');};find(this.doc,'entities');
        if(containers.length!==1)throw Error('같은 필지가 여러 묶음에 있습니다. 반영할 대지를 하나로 정리하세요.');
        const {owner,key,list}=containers[0],old=list.filter(e=>e.parcelRole==='site'&&e.attributes?.pnu===c.pnu),layer=this.doc.layers.find(l=>l.id===old[0].layer);if(!layer||layer.locked||layer.frozen||!layer.visible)throw Error('대지 레이어를 표시·해동·잠금 해제하세요.');
        const replacements=c.entities.map((e,i)=>({...fresh(e),...(old[i]?{id:old[i].id}:{}),layer:layer.id,attributes:{...e.attributes,siteContext:structuredClone(c.siteContext),siteSourceContext:structuredClone(c.siteContext),siteSourceGeometry:c.entities.map(x=>structuredClone(x.points))}}));
        const at=list.indexOf(old[0]),ids=new Set(old.map(e=>e.id));const kept=list.filter(e=>!ids.has(e.id));owner[key]=kept.slice(0,at).concat(replacements,kept.slice(at));return replacements.map(e=>e.id);
      }
      case 'parcel.info': {
        const raw=c.info;if(!raw?.pnu)throw Error('토지정보에 필지 번호가 없습니다.');
        const sites=G.parcelEntities(this.doc.entities).filter(e=>e.parcelRole==='site'&&e.attributes?.pnu===raw.pnu);
        const managed=this.doc.entities.find(e=>e.siteInfoTableId==='site-info:'+raw.pnu);
        if(!sites.length&&!managed&&!c.allowNoSite)throw Error('토지정보에 맞는 대지가 없습니다.');
        const options=selectSiteDrawOptions(c.drawOptions||sites[0]?.attributes?.siteContext?.drawOptions||managed?.siteContext?.drawOptions);
        const siteContext=c.siteContext||sites[0]?.attributes?.siteContext||managed?.siteContext||createSiteContext(sites,{info:raw});const info={...raw,siteContext};
        const update=e=>{if(e.parcelRole==='site'&&e.attributes?.pnu===info.pnu)e.attributes={...e.attributes,landInfo:structuredClone(raw),siteContext:structuredClone(siteContext),...(c.sourceContext?{siteSourceContext:structuredClone(c.sourceContext)}:{})};for(const child of e.entities||[])update(child);};this.doc.entities.forEach(update);
        const existing=this.doc.entities.find(e=>e.siteInfoTableId==='site-info:'+info.pnu),ids=[];
        const getLayer=name=>{let layer=this.doc.layers.find(l=>l.name===name);if(layer&&(layer.locked||!layer.visible||layer.frozen))throw Error(name+' 레이어를 표시·해동·잠금 해제하세요.');if(!layer){layer={id:crypto.randomUUID(),name,color:'#9dcbe0',visible:true,locked:false,lineweight:.18};this.doc.layers.push(layer);}return layer.id;};
        const b=sites.length?G.bounds(sites):{minX:0,minY:0,maxX:0,maxY:0};
        if(options.info){const layer=getLayer(SITE_ROLE_LAYERS.siteInfo);if(existing){const next=updateParcelInfoTable(existing,info,b,layer);Object.assign(existing,next);if(c.sourceContext)existing.siteSourceContext=structuredClone(c.sourceContext);ids.push(existing.id);}else{this.doc.entities=this.doc.entities.filter(e=>e.siteInfoPnu!==info.pnu||e.daylightGuide);
          // 새 표는 지적도(대지·도로·인접 필지) 오른쪽 바깥 8m, 위를 지적도 위에 맞춘다. 검토용 안내 글은 표 바로 아래로(2026-10-28 시안).
          const area=G.bounds(G.parcelEntities(this.doc.entities).filter(e=>['site','road','neighbor','site-original','road-info'].includes(e.parcelRole)))||b;
          const added=parcelInfoTable(info,b,layer,{x:area.maxX+8000,y:area.maxY});ids.push(...append(added));
          const tb=G.bounds(added),note=this.doc.entities.find(e=>e.type==='text'&&e.attributes?.reviewNote);if(tb&&note)note.position={...note.position,x:tb.minX,y:tb.minY-(Number(note.height)||250)*3};}}
        if(options.sunLine&&!this.doc.entities.some(e=>e.daylightGuide&&e.siteInfoPnu===info.pnu))ids.push(...append(parcelDaylightGuide(sites,getLayer(SITE_ROLE_LAYERS.sunline),info)));
        if(c.sourceContext)appendReviewHistory(this.doc,{at:new Date().toISOString(),targetId:'site-info:'+info.pnu,field:'site',next:siteContext,actor:'designer'});
        return ids;
      }
      case 'layer.merge': {
        const target=this.doc.layers.find(l=>l.id===c.target),sources=new Set(c.sources);
        if(!target||target.locked||this.doc.layers.some(l=>sources.has(l.id)&&l.locked))throw Error('대상/원본 레이어가 없거나 잠겨 있습니다.');
        sources.delete(c.target);
        if(this.doc.layers.some(l=>l.name==='0'&&sources.has(l.id)))throw Error('0번 레이어를 다른 레이어에 병합할 수 없습니다.');
        const remap=e=>{if(sources.has(e.layer))e.layer=c.target;for(const child of e.entities||[])remap(child);};
        this.doc.entities.forEach(remap);for(const block of this.doc.blocks)block.entities.forEach(remap);
        this.doc.layers=this.doc.layers.filter(l=>!sources.has(l.id));return [];
      }
      // 공유(DWG) 블록 정의를 바꾼다 — 그 정의를 쓰는 모든 삽입본이 함께 바뀐다(오토캐드 블록 편집). 정의 묶음은 새 객체로(기록 불변).
      // 공유 정의 추가(매개변수 블록·BLOCKSPOT·외부참조·사본형 이전). 같은 키가 있으면 replace 일 때만 바꾼다. 참조(entities)도 함께 넣을 수 있다.
      case "shared.add": {
        const defs=c.definitions||{};
        for(const [key,def] of Object.entries(defs)){
          if(!key||!def||!Array.isArray(def.entities))throw Error('공유 블록 정의가 올바르지 않습니다.');
          if(this.doc.sharedBlocks?.[key]&&!c.replace)throw Error('같은 이름의 공유 블록 정의가 있습니다: '+key);
        }
        if(Object.keys(defs).length){this.doc.sharedBlocks=withSharedDefinitions(this.doc.sharedBlocks,structuredClone(defs));this.doc.version=3;}
        if(Array.isArray(c.templates)&&c.templates.length){const names=new Set(c.templates.map(t=>t.name));this.doc.blocks=[...this.doc.blocks.filter(b=>!names.has(b.name)),...structuredClone(c.templates)];}
        const added=Array.isArray(c.entities)&&c.entities.length?append(c.entities):[];
        if(c.replace)for(const key of Object.keys(defs))added.push(...this.refreshSharedUsers(key));
        return added;
      }
      // 안 쓰는 공유 정의 지우기(PURGE). 아직 쓰는 정의는 지우지 않는다.
      case "shared.purge": {
        const keys=(c.keys||[]).filter(key=>this.doc.sharedBlocks?.[key]);if(!keys.length)return [];
        this.doc.sharedBlocks=withSharedDefinitions(this.doc.sharedBlocks,Object.fromEntries(keys.map(key=>[key,null])));
        const gone=new Set(keys);this.doc.blocks=this.doc.blocks.filter(b=>!(b.sharedBlock&&gone.has(b.sharedBlock)));
        return [];
      }
      case "shared.define": {
        const def = this.doc.sharedBlocks?.[c.key];
        if (!def) throw Error("공유 블록 정의를 찾을 수 없습니다.");
        this.doc.sharedBlocks = withSharedDefinitions(this.doc.sharedBlocks, { [c.key]: { ...def, entities: structuredClone(c.entities) } });
        // 중첩 정의 안에서 이 정의를 쓰는 참조도 다시 그린다(예전: 바로 쓰는 참조만).
        return this.refreshSharedUsers(c.key);
      }
      case "document.update":
        validateDocumentSettings(c.changes||{});
        for (const key of ["reviewObjectSeq","reviewHistory","sheets","blocks","layouts","currentLayout","projectSettings","layerStates","library","xrefs","reports","sitePlan","sitePlanInput","planSite","drawingGeo","limits","linetypeScale","dimStyles","currentDimStyle","scaleList","currentAnnoScale","annoAutoScale","annoAllVisible","textStyles","viewres","transparencyDisplay",...DOCUMENT_SETTING_KEYS]) {
          if (c.changes[key] !== undefined) this.doc[key]=structuredClone(c.changes[key]);
        }
        return [];
      case "visibility":
        { const ids=c.ids&&new Set(c.ids); for (const e of this.doc.entities) if (!ids || ids.has(e.id)) e.hidden=Boolean(c.hidden); }   // Set: ISOLATEOBJECTS 는 거의 모든 id 를 넘긴다
        return [];
      case "batch":
        return c.commands.flatMap((p) => this.mutate(p) || []);
      case 'linewall.place': {
        const targets=this.selected(c.ids);if(targets.length!==c.ids.length)throw Error('연결 벽선 일부가 없어 다시 배치해야 합니다.');
        const parts=c.parts.map(fresh),entity=c.doorId?{...structuredClone(c.entity),id:c.doorId}:fresh(c.entity);
        entity.lineWallHost={sources:structuredClone(c.sources),parts:structuredClone(parts)};
        this.doc.entities=this.doc.entities.filter(e=>!c.ids.includes(e.id));this.doc.entities.push(...parts,entity);return [entity.id];
      }
      case 'add.classified': {
        const target=label=>{const standard=standardLayerForLabel(label);if(!standard)return null;let layer=this.doc.layers.find(l=>l.name===standard.name);if(layer&&(layer.locked||layer.visible===false||layer.frozen))throw Error('대상 레이어가 숨김/잠금 상태입니다: '+standard.name);if(!layer){layer={...standard,id:crypto.randomUUID(),visible:true,locked:false,linetype:standard.linetype};this.doc.layers.push(layer);}else Object.assign(layer,standard);delete layer.aci;delete layer.colorMode;return layer.id;};
        if(c.centerlineId){const source=this.selected([c.centerlineId])[0];source.layer=target('중심선');delete source.color;delete source.aci;delete source.colorMode;source.linetype='CENTER';}
        // 블록은 껍데기만 옮겨서는 소용이 없다. 화면 색은 안쪽 선들의 레이어를 따르므로
        // 문·창·기둥을 놓아도 전부 현재 레이어 색으로 똑같이 보였다. 안쪽까지 함께 옮긴다.
        const relayer=(item,id)=>{item.layer=id;if(Array.isArray(item.entities))for(const child of item.entities)relayer(child,id);};
        const entities=c.entities.map(e=>{const item=structuredClone(e),label=classifyLayer(item,item.wallName||item.name||'');if(label!=='검토필요'){relayer(item,target(label));const current=c.keepColor&&item.color===c.keepColor.color&&(item.colorMode??null)===(c.keepColor.colorMode??null);if(item.type!=='hatch'&&!current){delete item.color;delete item.aci;delete item.colorMode;}}return item;});
        return this.mutate({type:'addMany',entities});
      }
      case "add": {
        const e = structuredClone(c.entity);
        if (e.type === 'image') { validateImage(e); if (e.fade === undefined) e.fade = 50; if (e.rotation === undefined) e.rotation = 0; }
        e.id = e.id || crypto.randomUUID();
        if (this.doc.layers.find((l) => l.id === e.layer)?.locked)
          throw Error("현재 레이어가 잠겨 있습니다.");
        this.numberEnvelopeObjects([e]);
        this.doc.entities.push(e);
        return [e.id];
      }
      case "addMany": {
        for (const e of c.entities || []) if (e?.type === 'image') { validateImage(e); if (e.fade === undefined) e.fade = 50; if (e.rotation === undefined) e.rotation = 0; }
        if (
          c.entities.some(
            (e) => this.doc.layers.find((l) => l.id === e.layer)?.locked,
          )
        )
          throw Error("잠긴 레이어입니다.");
        for(const e of c.entities){
          const fromCurrent=c.currentLinetype&&e.linetype===c.currentLinetype;
          const label=e.type==='wall'?'벽체':e.type==='hatch'?'해치':!fromCurrent&&e.linetype?.toUpperCase().includes('CENTER')?'중심선':null;
          if(c.keepLayers||!label||e.layer&&e.layer!=='default')continue;
          const standard=standardLayerForLabel(label);
          let target=this.doc.layers.find(l=>(l.name===standard.name)&&l.visible&&!l.locked&&!l.frozen);
          if(!target){target={...standard,id:crypto.randomUUID(),visible:true,locked:false,linetype:standard.linetype};this.doc.layers.push(target);}
          e.layer=target.id;
        }
        return append(c.entities);
      }
      // 그리기 순서(오토캐드 DRAWORDER): 도면 객체 배열의 순서가 그리는 순서다. 고른 객체를 맨 앞·맨 뒤 또는 기준 객체 위·아래로.
      case "draworder": {
        const ids = new Set(c.ids || []);
        const moving = this.doc.entities.filter((e) => ids.has(e.id));
        if (!moving.length) throw Error("순서를 바꿀 객체를 선택하세요.");
        const rest = this.doc.entities.filter((e) => !ids.has(e.id));
        let at = c.position === "front" ? rest.length : 0;
        if (c.position === "above" || c.position === "below") {
          const refs = new Set(c.refIds || []), idx = rest.map((e, i) => (refs.has(e.id) ? i : -1)).filter((i) => i >= 0);
          if (!idx.length) throw Error("기준 객체를 선택하세요.");
          at = c.position === "above" ? Math.max(...idx) + 1 : Math.min(...idx);
        }
        this.doc.entities = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
        return moving.map((e) => e.id);
      }
      case "delete": {
        // 212: 가벼운 경로는 실행 전 판정에서 찾은 대상을 그대로 쓰고(다시 훑지 않음), 포인터로 빼낸다.
        let targets;
        if(scopedTargets){
          const locked=new Set(this.doc.layers.filter(layer=>layer.locked).map(layer=>layer.id));
          if(locked.size&&scopedTargets.some(e=>locked.has(e.layer)))throw Error("잠긴 레이어의 객체는 편집할 수 없습니다.");
          targets=scopedTargets;
        }else targets=es();
        // A7: 벽을 지우면 그 벽에 넣은 문·창(hostWall)도 같이 지운다(남기면 3D 에 문틀만 떠 있음). 잠긴 레이어의 것은 둔다.
        const removedWalls=new Set(targets.filter(entity=>entity.type==='wall').map(entity=>entity.id));
        if(removedWalls.size){
          const chosen=new Set(targets),locked=new Set(this.doc.layers.filter(layer=>layer.locked).map(layer=>layer.id));
          const hosted=this.doc.entities.filter(entity=>entity.hostWall&&removedWalls.has(entity.hostWall)&&!chosen.has(entity)&&!locked.has(entity.layer));
          if(hosted.length)targets=[...targets,...hosted];
        }
        this.doc.entities = removeEntities(this.doc.entities,targets);
        return [];
      }
      case "move":
      case "copy":
      case "rotate":
      case "scale":
      case "mirror": {
        // 공유(DWG 압축) 블록 참조는 대칭을 담을 자리가 없어 180° 회전이 돼 버린다 — 대칭 전에 보통 블록으로 풀어 둔다(EXPLODE·block.create 와 같은 방식).
        // MIRROR keeping its source only mirrors copies: the kept references
        // stay shared (turning them into editable blocks re-displayed every
        // selected floor block for nothing); each copy is materialized instead.
        const mirrorCopy = c.type === "mirror" && !c.eraseSource;
        if (c.type === "mirror" && !mirrorCopy) G.materializeSharedDrawingReferences(this.doc, c.ids || []);
        // Reuse this synchronous execution's preflight selection. That path
        // already excludes linked geometry/schedules; still enforce locks.
        if(scopedTargets){
          const locked=new Set(this.doc.layers.filter(layer=>layer.locked).map(layer=>layer.id));
          if(locked.size&&scopedTargets.some(e=>locked.has(e.layer)))throw Error("잠긴 레이어의 객체는 편집할 수 없습니다.");
        }
        const initial = scopedTargets||es(),
          selectedIds=new Set(initial.map(e=>e.id)),
          wallIds=new Set(initial.filter(e=>e.type==='wall').map(e=>e.id)),
          targets=scopedTargets||[...initial,...this.doc.entities.filter(e=>(wallIds.has(e.hostWall)||selectedIds.has(e.roomBoundary))&&!selectedIds.has(e.id))],
          transform = (e) =>
            ["move", "copy"].includes(c.type)
              ? G.translate(e, c.dx, c.dy)
              : c.type === "rotate"
                ? G.rotate(e, c.base, c.angle)
                : c.type === "scale"
                  ? G.resize(e, c.base, c.factor)
                  // MIRRTEXT(c.mirrText): 1·true 이면 글자도 거울처럼, 기본(0)은 AutoCAD 처럼 읽히는 방향으로.
                  : G.mirror(mirrorCopy && e.sharedBlock ? G.materializeSharedDrawingReference(this.doc, e) : e, c.a, c.b, {mirrText: c.mirrText === 1 || c.mirrText === true}),
          transformed = targets.map(e=>{const changed=transform(e);if(c.type==='move'&&e.hostWall&&!wallIds.has(e.hostWall))return rebuildArchitecture(changed,{},this.doc.entities.filter(w=>w.type==='wall'));return changed;});
        if(!scopedTargets)this.selected(targets.map(e=>e.id));
        if (c.type === "copy" || (c.type === "mirror" && !c.eraseSource)) {
          // 222: 두 단계 깊은 복제 — 복제하며 id 대응표를 만들고, 복사본의 참조(벽·실 경계·면적표·수량표)를 표로 옮긴다.
          // transformed 는 속까지 새로 만든 복사본(transformEntity 가 structuredClone)이라 한 번 더 복제하지 않는다(19.6만 개 COPY 0.8초).
          const {copies}=cloneWithIdMap(transformed,{clone:e=>e});
          pushAll(this.doc.entities,this.numberEnvelopeObjects(copyReviewIds(this.doc,copies)));return copies.map(e=>e.id);
        }
        const map = new Map(transformed.map((e) => [e.id, e]));
        // A few targets: find them by pointer and replace them in a fresh copy
        // (the working array may be shared with history), instead of hashing
        // every id of the drawing.
        const list=this.doc.entities,at=targets.length<=16?targets.map(e=>list.indexOf(e)):null;
        if(at&&at.every(i=>i>=0)&&new Set(targets.map(e=>e.id)).size===targets.length){const next=list.slice();at.forEach((i,k)=>{next[i]=map.get(targets[k].id)||next[i];});this.doc.entities=next;}
        else this.doc.entities = this.doc.entities.map((e) => map.get(e.id) || e);
        return targets.map((e) => e.id);
      }
      case "array": {
        const targets = es();
        // 연관 배열(ARRAYASSOCIATIVITY=1): 사본 대신 원본+매개변수를 가진 블록 하나. 간격·개수는 array.edit 로 고친다.
        // 벽·연동 객체는 블록 안에 넣으면 벽 기능이 사라지므로 예전처럼 사본으로 만든다.
        this.lastArrayAssociative = !!c.associative && !targets.some((e) => e.type === 'wall' || e.hostWall || e.roomBoundary || e.scheduleKind || e.reviewObjectId);
        if (this.lastArrayAssociative) {
          const kind = c.kind || 'rect', params = kind === 'rect' ? {rows: c.rows, columns: c.columns, u: c.u || {x: c.dx, y: 0}, v: c.v || {x: 0, y: c.dy}} : c.params;
          const made = makeAssocArray(targets, kind, params, targets[0].layer), gone = new Set(targets.map((e) => e.id));
          this.doc.entities = this.doc.entities.filter((e) => !gone.has(e.id));
          return append([made]);
        }
        if(c.associative&&targets.some(e=>e.reviewObjectId)&&!targets.some(e=>e.type==='wall'||e.hostWall)){
          const kind=c.kind||'rect',params=kind==='rect'?{rows:c.rows,columns:c.columns,u:c.u||{x:c.dx,y:0},v:c.v||{x:0,y:c.dy}}:c.params;
          checkArrayParams(kind,params,targets.length);const expanded=expandArray(targets,kind,params),items=[];
          this.replaceEntities(targets.map((e,i)=>[e,expanded[i]]));
          for(let i=targets.length;i<expanded.length;i+=targets.length)pushAll(items,copyReviewIds(this.doc,expanded.slice(i,i+targets.length)));
          return append(items);
        }
        if (
          !Number.isInteger(c.rows) ||
          !Number.isInteger(c.columns) ||
          c.rows < 1 ||
          c.columns < 1 ||
          c.rows * c.columns * targets.length > 10000 ||
          !Number.isFinite(c.dx) ||
          !Number.isFinite(c.dy)
        )
          throw Error("배열은 양의 정수 행·열, 최대 10,000개로 지정하세요.");
        const items = [];
        for (let r = 0; r < c.rows; r++)
          for (let col = 0; col < c.columns; col++)
            if (r || col)
              items.push(
                ...this.numberEnvelopeObjects(copyReviewIds(this.doc,targets.map((e) => G.translate(e, col * c.dx, r * c.dy)))),
              );
        return append(items);
      }
      case "offset":
        // 모서리 채우기(c.gapType, AutoCAD OFFSETGAPTYPE 0 연장·1 호·2 모따기)와 호 구간 보존은 curve-edit.js.
        return append(this.numberEnvelopeObjects(es().map((e) => CE.offsetAny(e, c.distance, c.side, {gapType: Number(c.gapType) || 0})),true));
      // 행렬 한 번 변환(ALIGN·참조 회전/축척): 이동·회전·축척을 엔진 명령 세 번 대신 한 번에(사본·화면 갱신·되돌리기 한 번).
      case "transform":
      case "transform.copy": {
        const {fn, scale, rotation, mirror} = CE.matrixParts(c.matrix), targets = es();
        if (targets.some((e) => e.type === 'wall' || e.hostWall)) throw Error('벽·벽에 붙은 객체는 이동·회전 명령으로 옮기세요.');
        const moved = targets.map((e) => G.transformEntity(e, fn, {scale, rotation, mirror}));
        if (c.type === "transform.copy") return append(this.numberEnvelopeObjects(copyReviewIds(this.doc,moved)));
        const map = new Map(moved.map((e) => [e.id, e]));
        this.doc.entities = this.doc.entities.map((e) => map.get(e.id) || e);
        return [...map.keys()];
      }
      case "array.edit": {
        const e = this.selected([c.id])[0];
        if (!e.assocArray) throw Error('연관 배열을 고르세요.');
        return this.replaceEntities([[e, (({entities, assocArray}) => ({entities, assocArray}))(editAssocArray(e, c.params || {}))]]);
      }
      // 연관 중심 표시(원·호 하나)·중심선(선 둘): 원본이 바뀌면 refreshLinked 가 다시 그린다.
      case "center.add": {
        const sources = this.selected(c.refs || []);
        if (sources.length !== (c.kind === 'mark' ? 1 : 2)) throw Error(c.kind === 'mark' ? '원이나 호 하나를 고르세요.' : '선 두 개를 고르세요.');
        const ordered = (c.refs || []).map((id) => sources.find((e) => e.id === id));
        return append([makeCenterObject(c.kind === 'mark' ? 'mark' : 'line', ordered, c.layer || ordered[0].layer, c.options || {})]);
      }
      // 기하 구속 목록(constraints.js). 객체는 바꾸지 않으므로 레이어 표처럼 가벼운 길로 간다.
      case "constraints.set": {
        const list = Array.isArray(c.constraints) ? structuredClone(c.constraints) : [];
        if (list.some((x) => !x || !['horizontal', 'vertical', 'coincident'].includes(x.kind))) throw Error('구속 종류는 수평·수직·일치입니다.');
        this.doc.constraints = c.mode === 'replace' ? list : [...(this.doc.constraints || []), ...list];
        // AUTOCONSTRAIN: 새 구속을 곧바로 만족하게 맞춘다(공차 안의 끝점·각도). 고른 객체만 본다.
        return c.solve ? solveConstraints(this.doc, {ids: c.solveIds || []}, c.solveIds || []) : [];
      }
      case "fillet":
      case "chamfer": {
        const chamfer = c.type === "chamfer", options = { size2: c.size2, chamferAngle: c.chamferAngle, trim: c.trim };
        // 폴리선(P) 또는 같은 폴리선의 이웃한 두 구간: 그 꼭짓점(들)만 깎아 폴리선 하나로 남긴다.
        if (c.polylineId) {
          const source = this.doc.entities.find((e) => e.id === c.polylineId);
          if (!source || !['polyline', 'rectangle'].includes(source.type)) throw Error("폴리선을 선택하세요.");
          const result = G.polylineCorners(source, c.size, chamfer, options, c.vertices || null);
          if (!result.done) throw Error(result.skipped ? "모서리 크기가 구간보다 커서 깎을 수 없습니다." : "깎을 꼭짓점이 없습니다.");
          this.lastCornerReport = result;
          const updated = { ...result.entity, type: 'polyline', closed: !!(source.closed || source.type === 'rectangle') };
          this.doc.entities = this.doc.entities.map((e) => (e.id === source.id ? updated : e));
          return [source.id];
        }
        const targets = es();
        if (targets.length !== 2) throw Error("객체 두 개(선·호·원·열린 폴리선)를 선택하세요.");
        // 객체 종류 짝 표(curve-edit.js cornerAny): 선-선(평행선은 반원)·선-호·호-호·원·두 폴리선 잇기.
        const entities = CE.cornerAny(
          targets[0],
          targets[1],
          c.size,
          chamfer,
          targets.map(e=>c.pickPoints?.[e.id]),
          options,
        );
        if (c.trim !== false)
          this.doc.entities = this.doc.entities.filter(
            (e) => !c.ids.includes(e.id),
          );
        return append(entities);
      }
      case 'xclip': {
        const targets=es();if(targets.some(e=>e.type!=='block'))throw Error('XCLIP은 블록에 적용합니다.');
        if(c.points&&(!Array.isArray(c.points)||c.points.length<3||c.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y))||Math.abs(G.polygonArea(c.points))<G.EPS||!G.simpleClipPolygon(c.points)))throw Error('교차하지 않는 세 점 이상의 경계가 필요합니다.');
        for(const e of targets){if(c.points)e.clip={points:structuredClone(c.points),enabled:true,inverted:c.inverted??e.clip?.inverted??false};else if(c.operation==='invert'){if(!e.clip)throw Error('먼저 클립 경계를 지정하세요.');e.clip.inverted=!e.clip.inverted;}else if(c.operation==='delete')delete e.clip;else if(['on','off'].includes(c.operation)){if(!e.clip)throw Error('먼저 클립 경계를 지정하세요.');e.clip.enabled=c.operation==='on';}else throw Error('XCLIP 옵션 오류');}return targets.map(e=>e.id);
      }
      case 'architecture.update': {
        const targets=es();for(const e of targets){const changes={...c.changes};if((changes.floorSource??e.parameters?.floorSource)==='global')changes.floorHeight=this.doc.reviewSettings?.floorHeight||3000;const updated=rebuildArchitecture(e,changes,this.doc.entities.filter(w=>w.type==='wall'));this.doc.entities[this.doc.entities.indexOf(e)]=updated;}return targets.map(e=>e.id);
      }
      case 'opening.grip': {
        const e=es()[0],wall=this.doc.entities.find(w=>w.id===e.hostWall);
        if(!wall)throw Error('연결된 벽이 없습니다.');
        const a=wall.points[0],u=G.unit(G.sub(wall.points[1],a)),length=G.dist(...wall.points),start=G.dot(G.sub(e.position,a),u),end=start+e.openingWidth;
        const at=Math.max(0,Math.min(length,G.dot(G.sub(c.point,a),u))),nextStart=c.end==='opening-start'?Math.min(at,end-1):start,nextEnd=c.end==='opening-end'?Math.max(at,start+1):end;
        if(e.cardOpening){
          const v=e.cardOpening.values,clearance=e.category==='DOOR'?2*(v.frameWidth+v.gap):2*v.gap,width=nextEnd-nextStart-clearance;
          const rebuilt=rebuildArchitecture({...e,position:G.add(a,G.mul(u,nextStart))},{width},[wall]);
          this.doc.entities[this.doc.entities.indexOf(e)]=rebuilt;return [e.id];
        }
        const rebuilt=wallOpening(e.category,{...e.parameters,width:nextEnd-nextStart},wall,G.add(a,G.mul(u,nextStart)),e.layer);
        this.doc.entities[this.doc.entities.indexOf(e)]={...e,...rebuilt,id:e.id,attributes:{...e.attributes,...rebuilt.attributes}};return [e.id];
      }
      case "stretch": {
        if (!Number.isFinite(c.dx) || !Number.isFinite(c.dy))
          throw Error("이동량 오류");
        const changed=G.stretchEntities(this.doc.entities,c.targets,{x:c.dx,y:c.dy});
        this.selected(changed.map(e=>e.id));
        const replacements=new Map(changed.map(e=>[e.id,e]));
        this.doc.entities=this.doc.entities.map(e=>replacements.get(e.id)||e);
        return changed.map(e=>e.id);
      }
      case "trim":
      case "extend": {
        // Quick TRIM passes every object near the pick as a boundary: a Set,
        // not includes() per object (quadratic on a large plan).
        const boundaryIds = new Set(c.boundaryIds || []),
          target = this.selected([c.id])[0],
          boundaries = this.doc.entities.filter(
            (e) => boundaryIds.has(e.id) && e.id !== c.id,
          );
        if (!boundaries.length) throw Error("경계 객체를 먼저 선택하세요.");
        // 선·원·호는 기존 정확 계산, 폴리선·사각형·타원(TRIM)과 열린 폴리선(EXTEND)은 경로 매개변수(curve-edit.js).
        return replace(
          target,
          c.type === "extend" ? CE.extendPath(target, boundaries, c.pick) : CE.cutPath(target, boundaries, c.pick),
        );
      }
      case "break": {
        const e = this.selected([c.id])[0];
        // 선 밖의 곡선(폴리선·원·호·타원)은 같은 경로 매개변수로 끊는다(AutoCAD BreakCmdHandler::breakEntity 처럼 곡선 공통).
        if (e.type !== "line") return replace(e, CE.breakPath(e, c.a, c.b));
        const [a, b] = e.points,
          v = G.sub(b, a),
          project = (p) =>
            Math.max(0, Math.min(1, G.dot(G.sub(p, a), v) / G.dot(v, v)));
        const [t, u] = [project(c.a), project(c.b)].sort((a, b) => a - b);
        // 두 점이 같으면(@ · BREAKATPOINT) 그 점에서 둘로 나눈다(오토캐드).
        if (Math.abs(t - u) < G.EPS) {
          if (t <= G.EPS || t >= 1 - G.EPS) throw Error("선의 끝점에서는 나눌 수 없습니다.");
          const m = G.add(a, G.mul(v, t));
          return replace(e, [{ ...e, points: [a, m] }, { ...e, points: [m, b] }]);
        }
        return replace(e, [
          ...(t > G.EPS ? [{ ...e, points: [a, G.add(a, G.mul(v, t))] }] : []),
          ...(u < 1 - G.EPS
            ? [{ ...e, points: [G.add(a, G.mul(v, u)), b] }]
            : []),
        ]);
      }
      case "join": {
        // AutoCAD joinEntitiesAutomatically: 같은 원 위 호 → 호/원, 한 직선 위 선 → 선, 섞이면 폴리선(호 구간 유지).
        // 허용 거리(c.tolerance, PEDIT 퍼지 거리)는 기본 0.001. 못 이은 객체는 그대로 두고 개수를 알려 준다.
        const targets = es();
        if (targets.length < 2) throw Error("이을 객체를 두 개 이상 선택하세요.");
        const tolerance = c.tolerance === undefined ? 0.001 : Number(c.tolerance);
        if (!(tolerance >= 0) || tolerance > 1e6) throw Error("허용 거리는 0 이상 숫자입니다.");
        const report = CE.joinAuto(targets, tolerance);
        if (!report.made.length) throw Error(`끝점이 ${tolerance} mm 이내에서 이어지는 선·호·열린 폴리선이 없습니다.`);
        this.lastJoinReport = {joined: report.used.length, left: report.left, made: report.made.length, kind: report.kind};
        const used = new Set(report.used);
        this.doc.entities = this.doc.entities.filter((e) => !used.has(e.id));
        return append(report.made);
      }
      case "shared.materialize": {
        const targets=es();G.materializeSharedDrawingReferences(this.doc,targets.map(e=>e.id));return targets.map(e=>e.id);
      }
      case "explode": {
        G.materializeSharedDrawingReferences(this.doc,c.ids||[]);
        // 오토캐드처럼 분해할 수 없는 객체(선·원·문자 등)는 건너뛰고 나머지만 분해한다.
        const targets = es(),
          items = [],
          exploded = new Set(),
          pieces = new Map(),
          zeroLayer = this.doc.layers.find((l) => l.name === "0")?.id;
        this.lastExplodeSkipped = 0;
        for (const e of targets) {
          const before = items.length;
          try {
          if (e.type === "block")
            items.push(
              // 624: 펼쳐 가져온 블록에서 레이어 0 이던 자식(inheritLayer)은 AutoCAD 처럼 레이어 0 으로 돌아간다.
              ...e.entities.map(({ inheritLayer, ...child }) => ({
                ...child,
                layer: inheritLayer && zeroLayer ? zeroLayer : child.layer || e.layer,
              })),
            );
          else if (["wall", "dimension"].includes(e.type))
            items.push(...G.primitives(e));
          else if (["polyline", "rectangle", "hatch"].includes(e.type))
            items.push(
              ...G.segments(e).map((points) => ({
                type: "line",
                points,
                layer: e.layer,
              })),
            );
          else throw Error("분해할 수 없는 객체");
          } catch { items.length = before; this.lastExplodeSkipped++; continue; }
          exploded.add(e.id);
          pieces.set(e.id, items.slice(before));
        }
        if (!exploded.size) throw Error("분해할 수 있는 객체(블록·폴리선·치수·해치 등)를 선택하세요.");
        // 그리기 순서 보존(AutoCAD acedDrawOrderInherit): 조각은 맨 위가 아니라 원래 객체 자리에 들어간다.
        if (c.keepOrder !== false) return this.spliceExploded(pieces);
        this.doc.entities = this.doc.entities.filter(
          (e) => !exploded.has(e.id),
        );
        return append(items);
      }
      case "block.create": {
        if (c.shared) return this.createSharedBlock(c, es, append);
        G.materializeSharedDrawingReferences(this.doc,c.ids||[]);
        const targets = es();
        const existing = this.doc.blocks.findIndex((b) => b.name === c.name);
        if (!c.name?.trim() || (existing >= 0 && !c.redefine))
          throw Error("중복되지 않는 블록 이름을 입력하세요.");
        const definition = { name: c.name, entities: targets.map((e) => G.translate(e, -c.base.x, -c.base.y)) };
        // 재정의(오토캐드): 같은 이름의 정의를 바꾼다. 삽입본 갱신은 화면 쪽이 같은 묶음에서 한다.
        if (existing >= 0) this.doc.blocks = this.doc.blocks.map((b, i) => (i === existing ? { ...b, ...definition } : b));
        // 새 목록으로: 정의 목록을 되돌리기 기록과 같이 쓸 수 있다(edit-inc).
        else this.doc.blocks = [...this.doc.blocks, definition];
        // 오토캐드 BLOCK 동작: 유지(retain)=원래 객체 그대로, 삭제(delete)=원래 객체 지움, 변환(기본)=그 자리에 블록 삽입.
        if (c.mode === "retain") return [];
        this.doc.entities = this.doc.entities.filter(
          (e) => !c.ids.includes(e.id),
        );
        if (c.mode === "delete") return [];
        return append([
          {
            type: "block",
            name: c.name,
            entities: targets.map((e) => structuredClone(e)),
            layer: targets[0].layer,
          },
        ]);
      }
      case "block.insert": {
        const def = this.doc.blocks.find((b) => b.name === c.name);
        if (!def) throw Error("블록 이름을 찾을 수 없습니다.");
        if (this.doc.layers.find((l) => l.id === c.layer)?.locked)
          throw Error("현재 레이어가 잠겨 있습니다.");
        if(def.sharedBlock){
          // Imported catalogs retain a compact first-instance template. Its
          // existing transform and attached attribute text match the expanded
          // catalog's placement, while the new instance keeps shared geometry.
          const template={...def,type:'block',layer:c.layer};
          // 속성 값(ATTRIB)·가시성 상태는 참조에만 둔다(정의는 하나).
          if(c.attributes&&typeof c.attributes==='object')template.attributes={...(def.attributes||{}),...c.attributes};
          if(typeof c.visibility==='string'&&c.visibility)template.visibility=c.visibility;
          return append([G.translate(G.rotate(G.resize(template,{x:0,y:0},c.factor||1),{x:0,y:0},c.angle||0),c.position.x,c.position.y)]);
        }
        return append([
          {
            type: "block",
            name: def.name,
            layer: c.layer,
            entities: def.entities.map((e) =>
              G.translate(
                G.rotate(
                  G.resize(e, { x: 0, y: 0 }, c.factor || 1),
                  { x: 0, y: 0 },
                  c.angle || 0,
                ),
                c.position.x,
                c.position.y,
              ),
            ),
          },
        ]);
      }
      case "update": {
        const targets = es();
        if (c.changes.id || c.changes.type)
          throw Error("객체 ID와 형식은 변경할 수 없습니다.");
        // 새 객체로 갈아 끼운다: 가벼운 경로의 작업 배열은 되돌리기 기록과 객체를 같이 쓴다(edit-inc 도 같은 원칙).
        return this.replaceEntities(targets.map((e) => [e, c.changes]));
      }
      /* 객체마다 다른 값을 한 번에(주석 축척·문자 스타일·끝점 맞춤 등). update 를 수만 번 batch 하면 매번 전체 객체를 훑어
         큰 도면에서 수십 초가 걸렸다 — 한 번만 훑고 id 로 찾는다. */
      case "updateMany": {
        const updates = Array.isArray(c.updates) ? c.updates : [];
        if (!updates.length) throw Error("바꿀 객체가 없습니다.");
        for (const u of updates) if (!u || u.changes == null || typeof u.changes !== "object" || u.changes.id || u.changes.type) throw Error("객체 ID와 형식은 변경할 수 없습니다.");
        const byId = new Map(this.selected(updates.map((u) => u.id)).map((e) => [e.id, e]));
        return this.replaceEntities(updates.filter((u) => byId.has(u.id)).map((u) => [byId.get(u.id), u.changes]));
      }
      case "wall.opening": {
        const e = this.selected([c.id])[0];
        if (e.type !== "wall")
          throw Error("WALL로 작성한 직선 벽을 선택하세요.");
        const [a, b] = e.points,
          v = G.sub(b, a),
          length = G.len(v),
          t = G.dot(G.sub(c.position, a), v) / (length * length),
          half = c.width / length / 2;
        if (
          !Number.isFinite(c.width) ||
          c.width <= 0 ||
          t - half < 0 ||
          t + half > 1
        )
          throw Error("개구부가 벽 길이 안에 들어가야 합니다.");
        e.openings = [...(e.openings || []), [t - half, t + half]];
        return [e.id];
      }
      case "layer.add": {
        const standard=standardLayerForName(c.name);
        if (this.doc.layers.some((l) => l.name === c.name))
          throw Error("이미 존재하는 레이어 이름입니다.");
        this.doc.layers.push({
          // 패드 표시처럼 같은 batch 안에서 새 레이어에 객체를 넣으려면 ID 를 미리 정해 줘야 한다.
          id: typeof c.id === "string" && c.id && !this.doc.layers.some((l) => l.id === c.id) ? c.id : crypto.randomUUID(),
          ...(standard||{}),
          name: c.name || "새 레이어",
          color: c.color || standard?.color || "#ffd479",
          visible: c.visible !== false,
          // 외부참조 의존 레이어(파일명|레이어): PURGE 에서 빼고 결합 때만 본 레이어가 된다.
          ...(c.xref === true ? { xref: true } : {}),
          ...(c.frozen === true ? { frozen: true } : {}),
          locked: false,
          lineweight: c.lineweight ?? standard?.lineweight ?? 0.25,
          // 레이어 선종류로 BYLAYER·BYBLOCK 은 뜻이 없다(AutoCAD 도 거절) → 실선.
          linetype: typeof c.linetype === "string" && c.linetype.trim() && !["BYLAYER","BYBLOCK"].includes(c.linetype.trim().toUpperCase()) ? c.linetype.trim().toUpperCase() : standard?.linetype || "CONTINUOUS",   // LAYMCUR 새 레이어: 선종류까지 한 번에
        });
        return [];
      }
      case "layer.update": {
        const l = this.doc.layers.find((l) => l.id === c.id);
        if (!l) throw Error("레이어를 찾을 수 없습니다.");
        if (c.changes.id) throw Error("레이어 ID는 바꿀 수 없습니다.");
        if(l.name==='0'&&c.changes.name!==undefined&&c.changes.name!=='0')throw Error('0번 레이어의 이름은 바꿀 수 없습니다.');
        Object.assign(l, c.changes);
        return [];
      }
      case "layer.delete": {
        if(this.doc.layers.find(l=>l.id===c.id)?.name==='0')throw Error('0번 레이어는 삭제할 수 없습니다.');
        if (this.doc.layers.length === 1)
          throw Error("마지막 레이어는 삭제할 수 없습니다.");
        const uses = (e) => e.layer === c.id || (e.entities || []).some(uses);
        if (
          this.doc.entities.some(uses) ||
          this.doc.blocks.some((b) => b.entities.some(uses))
        )
          throw Error("객체가 있는 레이어는 삭제할 수 없습니다.");
        this.doc.layers = this.doc.layers.filter((l) => l.id !== c.id);
        return [];
      }
      // PURGE: 쓰지 않는 레이어 여러 개를 한 번에(레이어마다 도면 전체를 훑던 layer.delete 반복 대신 한 번만 훑는다).
      case "layer.purge": {
        const ids = new Set(c.ids || []);
        if (!ids.size) return [];
        if (this.doc.layers.some((l) => ids.has(l.id) && l.name === '0')) throw Error('0번 레이어는 삭제할 수 없습니다.');
        if (this.doc.layers.every((l) => ids.has(l.id))) throw Error("마지막 레이어는 삭제할 수 없습니다.");
        const uses = (e) => ids.has(e.layer) || (e.entities || []).some(uses);
        if (this.doc.entities.some(uses) || (this.doc.blocks || []).some((b) => b.entities.some(uses)))
          throw Error("객체가 있는 레이어는 삭제할 수 없습니다.");
        this.doc.layers = this.doc.layers.filter((l) => !ids.has(l.id));
        return [];
      }
      // LAYDEL(ACAD200 706): 레이어와 그 객체(블록 정의 안 포함)를 한 번에 지운다. 되돌리기 한 번.
      // 도면을 한 번만 훑는다(레이어마다 훑지 않음). 0번·잠긴·마지막 레이어는 거절한다(AutoCAD 와 같음).
      case 'layer.deleteWithEntities': {
        const ids=new Set(c.ids||[]),layers=this.doc.layers.filter(l=>ids.has(l.id));
        if(!layers.length)throw Error('지울 레이어가 없습니다.');
        if(layers.some(l=>l.name==='0'))throw Error('0번 레이어는 지울 수 없습니다.');
        if(layers.some(l=>l.locked))throw Error('잠긴 레이어는 지울 수 없습니다. 잠금을 먼저 푸세요.');
        if(layers.length>=this.doc.layers.length)throw Error('마지막 레이어는 지울 수 없습니다.');
        const result=layerDeletePlan(this.doc,ids);
        this.doc.entities=result.entities;
        if(result.blocks)this.doc.blocks=result.blocks;
        this.doc.layers=this.doc.layers.filter(l=>!ids.has(l.id));
        return [];
      }
      case 'lisp.apply': {
        // 리습 결과. 바뀌지 않은 객체는 실행 전 문서의 객체 그대로다(이력 문서끼리 나눠 쓴다 — 제자리에서 고치면 안 된다).
        // syncOpenings 가 제자리에서 고치는 벽·연동 개구부·실 태그·수량표만 새로 복사해 둔다.
        const d=c.document;if(!d||!Array.isArray(d.entities)||!Array.isArray(d.layers))throw Error('리습 결과 도면이 올바르지 않습니다.');
        const own=e=>e&&(e.type==='wall'||e.hostWall||e.roomBoundary||e.scheduleKind)?structuredClone(e):e;
        this.doc={...d,layers:d.layers.map(l=>({...l})),...(Array.isArray(d.blocks)?{blocks:d.blocks.slice()}:{}),entities:d.entities.filter(e=>e?.managedBy!=='live_check').map(own)};
        return [];
      }
      case "load": {
        this.doc = structuredClone(c.document);
        this.lastRepairedHatches = repairHatchPatterns(this.doc);
        this.doc.entities=this.doc.entities.filter(e=>e.managedBy!=='live_check');this.numberEnvelopeObjects(this.doc.entities.filter(e=>e.reviewObjectId));
        if (this.doc.version === 1) {
          this.doc.version = 2;
          this.doc.blocks = [];
          this.doc.layers = this.doc.layers.map((l) => ({
            locked: false,
            lineweight: 0.25,
            linetype: "CONTINUOUS",
            ...l,
          }));
        }
        return [];
      }
      case "new":
        this.doc = newDrawingDocument();
        return [];
      default:
        throw Error("지원하지 않는 명령: " + c.type + (/^lisp/i.test(String(c.type)) ? " — 리습은 cad_lisp_run(동봉 명령)이나 cad_lisp_load(AI 리습)로 실행하세요. cad_preview 는 add·batch·update 같은 도면 명령만 받습니다." : ""));
    }
  }
  syncOpenings(previous=null){
    if(previous){
      const before=new Map(previous.entities.map(e=>[e.id,e])),walls=new Map(this.doc.entities.filter(e=>e.type==='wall').map(e=>[e.id,e]));
      for(let i=0;i<this.doc.entities.length;i++){
        const e=this.doc.entities[i],wall=walls.get(e.hostWall),oldWall=before.get(e.hostWall),old=before.get(e.id);
        if(!wall||!oldWall||!old||JSON.stringify([wall.points,wall.thickness])===JSON.stringify([oldWall.points,oldWall.thickness]))continue;
        this.selected([e.id]);let position=e.position;
        if(JSON.stringify(old.position)===JSON.stringify(e.position)){
          const offset=G.dot(G.sub(old.position,oldWall.points[0]),G.unit(G.sub(oldWall.points[1],oldWall.points[0])));
          position=G.add(wall.points[0],G.mul(G.unit(G.sub(wall.points[1],wall.points[0])),offset));
        }
        this.doc.entities[i]=rebuildArchitecture({...e,position},{},[wall]);
      }
    }
    for(const table of this.doc.entities.filter(e=>e.scheduleKind==='blocks')){
      const groups=new Map();for(const e of this.doc.entities.filter(e=>e.type==='block'&&!e.table&&(!table.scheduleIds||table.scheduleIds.includes(e.id)))){const a=e.attributes||{},style=a.style||e.parameters?.style||'',key=JSON.stringify([{DOOR:'문',WINDOW:'창',STAIR:'계단'}[e.category]||e.category||'블록',a.mark||e.name,{single:'여닫이',double:'양개',sliding:'미닫이',fixed:'고정',casement:'여닫이'}[style]||style,a.width||'',a.height||'']);groups.set(key,(groups.get(key)||0)+1);}
      const rows=[['분류','번호/이름','종류','폭','높이','수량'],...[...groups].map(([key,n])=>[...JSON.parse(key),n])];
      if(JSON.stringify(rows)!==JSON.stringify(table.table.rows)){const base=table.entities[0]?.points?.[0]||{x:0,y:0},direction=table.entities[0]?.points?.[1]||{x:1,y:0},next=table.entities[1]?.points?.[0]||{x:0,y:-1},angle=G.angle(G.sub(direction,base)),reflected=G.cross(G.sub(direction,base),G.sub(next,base))>0,columns=Math.max(...rows.map(r=>r.length)),widths=table.table.widths?.length===columns?table.table.widths:null,merges=(table.table.merges||[]).filter(m=>m.r2<rows.length&&m.c2<columns);let updated=tableBlock(rows,{height:table.table.height,widths,rowHeight:table.table.rowHeight,align:table.table.align,merges,layer:table.layer,name:table.name});if(reflected)updated=G.mirror(updated,{x:0,y:0},{x:1,y:0});updated=G.translate(G.rotate(updated,{x:0,y:0},angle),base.x,base.y);table.entities=updated.entities;table.table=updated.table;}
    }
    if(this.doc.entities.some(e=>e.roomSchedule)){
      const byId=new Map(this.doc.entities.map(e=>[e.id,e]));
      for(let i=0;i<this.doc.entities.length;i++){const table=this.doc.entities[i];if(!table.roomSchedule)continue;const next=refreshRoomSchedule(this.doc,table,byId);if(next){this.doc.entities[i]=next;byId.set(next.id,next);}}
    }
    const roomTags=this.doc.entities.filter(e=>e.roomBoundary);
    if(roomTags.length){
      // 태그마다 문서 전체를 훑지 않도록 id 지도를 한 번만 만든다(id는 validate에서 유일함).
      const byId=new Map(this.doc.entities.map(e=>[e.id,e]));
      for(const tag of roomTags){
        const room=byId.get(tag.roomBoundary);
        if(room?.room)tag.text=room.room.name+'\n'+(measure(room).area/1e6).toFixed(2)+' ㎡';
      }
    }
    const walls=this.doc.entities.filter(e=>e.type==='wall'),wallById=new Map(walls.map(w=>[w.id,w]));
    const endpoints=new Map(),cell=p=>[Math.floor(p.x/1e-6),Math.floor(p.y/1e-6)];
    for(const wall of walls)for(const p of wall.points){const key=wall.layer+':'+cell(p).join(',');if(!endpoints.has(key))endpoints.set(key,[]);endpoints.get(key).push(wall);}
    // Recompute mitres from shared endpoints so move/delete/undo remain coherent.
    for(const wall of walls)delete wall.joins;
    for(const wall of walls){
      for(const [index,key] of [[0,'start'],[1,'end']]){
        const p=wall.points[index];
        const [cx,cy]=cell(p),nearby=new Set();for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(const other of endpoints.get(wall.layer+':'+[cx+x,cy+y].join(','))||[])nearby.add(other);
        const candidates=[...nearby].filter(other=>other!==wall&&other.points.some(q=>G.dist(p,q)<1e-6));
        if(candidates.length!==1)continue;
        const other=candidates[0],j=G.dist(p,other.points[0])<1e-6?0:1;
        const u=G.unit(G.sub(wall.points[1],wall.points[0])),v=G.unit(G.sub(other.points[1-j],p));
        const n=G.mul(G.normal(u),wall.thickness/2),m=G.mul(G.normal(v),other.thickness/2);
        const sign=index===1?1:-1;
        const corners=[1,-1].map(side=>{const a=G.add(p,G.mul(n,side)),b=G.add(p,G.mul(m,side*sign));return G.lineIntersection(a,G.add(a,u),b,G.add(b,v))?.point;});
        if(corners.every(q=>q&&G.dist(p,q)<=Math.max(wall.thickness,other.thickness)*10)){
          wall.joins??={};wall.joins[key]=corners;
        }
      }
    }
    for(const wall of walls)wall.openingLinks={};
    for(const e of this.doc.entities.filter(e=>e.hostWall)){
      const wall=wallById.get(e.hostWall); // 개구부마다 벽 배열을 선형 탐색하지 않도록 Map 조회
      if(!wall){delete e.hostWall;continue;}
      const a=wall.points[0],b=wall.points[1],length=G.dist(a,b),u=G.unit(G.sub(b,a));
      if(!e.position||!e.openingWidth)continue;
      if(!Number.isFinite(e.openingWidth)||e.openingWidth<=0)throw Error('문/창 개구부 폭은 양수입니다.');
      const t=G.dot(G.sub(e.position,a),u)/length,end=t+e.openingWidth/length;
      if(t<-.000001||end>1.000001||G.distanceToSegment(e.position,a,b)>wall.thickness/2+.001)throw Error('연동 문/창은 벽 구간 안에 있어야 합니다.');
      wall.openingLinks[e.id]=[Math.max(0,t),Math.min(1,end)];
    }
  }
  validate(d) {
    if (
      !d ||
      ![1, 2, 3].includes(d.version) ||
      d.units !== "mm" ||
      !Array.isArray(d.layers) ||
      !d.layers.length ||
      !Array.isArray(d.entities) ||
      d.entities.length > MAX_DRAWING_OBJECTS
    )
      throw Error(
        "지원되는 BCAD 도면이 아닙니다. DXF/DWG는 변환으로 열어 주세요.",
      );
    if (d.version >= 2 && !Array.isArray(d.blocks))
      throw Error("블록 정의 목록 오류");
    if(d.version===3&&(!d.sharedBlocks||typeof d.sharedBlocks!=='object'||Array.isArray(d.sharedBlocks)))throw Error('공유 블록 정의 목록 오류');
    if(d.model3d?.floorHeights!==undefined)validateFloorHeights(d.model3d.floorHeights);
    for(const key of ['autoSlabs','autoRoof'])if(d.model3d?.[key]!==undefined&&typeof d.model3d[key]!=='boolean')throw Error('3D 자동 생성 설정 오류');
    const layers = new Set(),
      ids = new Set(),
      names = new Set(),
      point = (p) =>
        p &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        Math.abs(p.x) <= 1e12 &&
        Math.abs(p.y) <= 1e12,
      positive = (n) => Number.isFinite(n) && n > 0 && n <= 1e12;
    for (const l of d.layers) {
      if (
        typeof l.id !== "string" ||
        layers.has(l.id) ||
        typeof l.name !== "string" ||
        !l.name.trim() ||
        names.has(l.name) ||
        !/^#[0-9a-f]{6}$/i.test(l.color) ||
        typeof l.visible !== "boolean" ||
        (l.locked !== undefined && typeof l.locked !== "boolean") ||
        // ACAD200 701·707: 레이어 투명도 0~90, 설명 문자열, 확인 표시(reconciled).
        (l.transparency !== undefined && l.transparency !== null && !(Number.isFinite(l.transparency) && l.transparency >= 0 && l.transparency <= 90)) ||
        (l.description !== undefined && (typeof l.description !== 'string' || l.description.length > 255)) ||
        (l.reconciled !== undefined && typeof l.reconciled !== 'boolean')
      )
        throw Error("레이어 정보 또는 이름 중복 오류");
      layers.add(l.id);
      names.add(l.name);
    }
    let total = 0;
    const check = (e, depth = 0) => {
      if (++total > MAX_DRAWING_OBJECTS)
        throw Error("도면 객체가 300만 개를 넘어 열 수 없습니다.");
      if (depth > MAX_BLOCK_DEPTH)
        throw Error("블록 중첩이 12단계를 넘어 열 수 없습니다.");
      if (!layers.has(e.layer)) throw Error(`객체의 레이어가 없습니다: ${e.type} ${e.id ?? ""} layer=${e.layer ?? "(없음)"}. 레이어는 도면에 있는 레이어 ID 여야 합니다(AI 는 layer 에 표준 이름·용도를 주면 바꿔 줍니다).`);
      if(e.model3d)validateModel3D(e.model3d,{allowRoof:true});
      if(e.type==='dimension'&&e.mode==='angular'&&(!e.points||e.points.length!==4||!e.points.every(point)||G.dist(e.points[0],e.points[2])<G.EPS||G.dist(e.points[0],e.points[3])<G.EPS))throw Error('각도 치수 기준점 오류');
      if (e.color && !/^#[0-9a-f]{6}$/i.test(e.color)) throw Error("색상 오류");
      if (e.type === "ellipse") {
        if (
          !point(e.center) ||
          !point(e.majorAxis) ||
          G.len(e.majorAxis) < G.EPS ||
          !positive(e.ratio) ||
          e.ratio > 1 ||
          !Number.isFinite(e.startParam || 0) ||
          !Number.isFinite(e.endParam ?? Math.PI * 2)
        )
          throw Error("타원 축/비율 오류");
      } else if (["circle", "arc"].includes(e.type)) {
        if (!point(e.center) || !positive(e.radius))
          throw Error("원/호의 중심 또는 반지름 오류");
        if (
          e.type === "arc" &&
          (!Number.isFinite(e.startAngle) || !Number.isFinite(e.endAngle))
        )
          throw Error("호 각도 오류");
      } else if (e.type === "point") {
        if (!point(e.position)) throw Error("점 좌표 오류");
      } else if (e.type === "text") {
        if (
          !point(e.position) ||
          typeof e.text !== "string" ||
          e.text.length > 20000 ||
          !positive(e.height) ||
          !Number.isFinite(e.rotation || 0) ||
          (e.backgroundMask!==undefined&&typeof e.backgroundMask!=='boolean') ||
          (e.maskPadding!==undefined&&(!Number.isFinite(e.maskPadding)||e.maskPadding<0))
        )
          throw Error("문자 속성 오류");
        if(e.attdef&&(typeof e.attdef!=='object'||typeof e.attdef.tag!=='string'||!e.attdef.tag.trim()||/\s/.test(e.attdef.tag)))throw Error("속성 정의(ATTDEF) 태그 오류");
      } else if (e.type === 'image') {
        validateImage(e);
      } else if (e.type === "block") {
        if((e.visibility!==undefined&&e.visibility!==null&&typeof e.visibility!=='string')||(e.attributes!==undefined&&e.attributes!==null&&(typeof e.attributes!=='object'||Array.isArray(e.attributes))))throw Error('블록 속성·가시성 상태 오류');
        if(e.clip&&(!Array.isArray(e.clip.points)||e.clip.points.length<3||!e.clip.points.every(point)||Math.abs(G.polygonArea(e.clip.points))<G.EPS||typeof e.clip.enabled!=='boolean'))throw Error('블록 표시 범위 오류');
        if(e.table&&(!Array.isArray(e.table.rows)||!e.table.rows.length||!positive(e.table.height)||(e.table.rowHeight!==undefined&&!positive(e.table.rowHeight))||(e.table.widths!==undefined&&(!Array.isArray(e.table.widths)||e.table.widths.some(w=>!positive(w))))||(e.table.align!==undefined&&!['left','center','right'].includes(e.table.align))))throw Error('표 정보 오류');
        if(e.sharedBlock){
          if(d.version!==3||typeof e.sharedBlock!=='string'||!d.sharedBlocks[e.sharedBlock]||!point(e.position)||!positive(e.scale===undefined?1:Number(e.scale))||!Number.isFinite(e.rotation===undefined?0:Number(e.rotation))||!Array.isArray(e.entities)||typeof e.name!=='string'||(e.scaleX!==undefined&&!positive(Number(e.scaleX)))||(e.scaleY!==undefined&&!positive(Number(e.scaleY))))throw Error('공유 블록 참조 오류');
          e.entities.forEach(v=>check(v,depth+1));return;
        }
        if (
          !Array.isArray(e.entities) ||
          !e.entities.length ||
          typeof e.name !== "string"
        )
          throw Error("블록 오류");
        e.entities.forEach((v) => check(v, depth + 1));
      } else if (
        [
          "line",
          "polyline",
          "rectangle",
          "hatch",
          "dimension",
          "wall",
        ].includes(e.type)
      ) {
        const min =
          e.type === "rectangle"
            ? 4
            : ["hatch", "dimension"].includes(e.type)
              ? 3
              : 2;
        if (
          !Array.isArray(e.points) ||
          e.points.length < min ||
          !e.points.every(point)
        )
          throw Error(`객체 좌표 오류: ${e.type} ${e.id ?? ""} 점 ${Array.isArray(e.points) ? e.points.length : 0}개(최소 ${min}개, 모두 숫자 좌표)`);
        if (
          e.type === "wall" &&
          G.dist(...e.points.slice(0, 2)) < G.EPS
        )
          throw Error("길이가 0인 선입니다.");
        if (
          e.type === "wall" &&
          (!positive(e.thickness) ||
            (e.openings || []).some(
              (o) =>
                !Array.isArray(o) ||
                o.length !== 2 ||
                !o.every(Number.isFinite) ||
                o[0] < 0 ||
                o[1] > 1 ||
                o[0] >= o[1],
            ))
        )
          throw Error("벽 두께/개구부 오류");
        if (
          e.type === "hatch" &&
          (!positive(e.spacing ?? 100) ||
            !Number.isFinite(e.angle ?? 0) ||
            (e.loops || []).some(
              (loop) =>
                !Array.isArray(loop) || loop.length < 3 || !loop.every(point),
            ))
        )
          throw Error("해치 속성 오류");
        // 표준 무늬 해치(hatch-patterns.js): 무늬 줄은 유한한 수여야 한다. 줄·대시가 너무 많으면 화면·출력이 멈추므로 막는다.
        if (e.type === "hatch" && e.patternLines != null && !validHatchPattern(e.patternLines))
          throw Error("해치 무늬 정의 오류");
        if (
          e.type === "dimension" &&
          (!Number.isFinite(e.axisAngle ?? 0) ||
            !positive(e.measurementScale??1) ||
            !Number.isInteger(e.precision??2) || (e.precision??2)<0 || (e.precision??2)>8 ||
            (e.textTemplate!==undefined&&typeof e.textTemplate!=='string') ||
            (e.textPosition!==undefined&&!point(e.textPosition)) ||
            !positive(e.textHeight) ||
            (!['ordinateX','ordinateY'].includes(e.mode)&&G.dist(e.points[0], e.points[1]) < G.EPS))
        )
          throw Error("치수점/문자 높이 오류");
      } else throw Error("지원하지 않는 객체 형식: " + e.type);
    };
    // 공유 블록 정의 목록은 가져온 뒤 바뀌지 않고 되돌리기 이력끼리 같은 객체를 나눠 쓴다.
    // 한 번 통과한 목록은 다시 훑지 않고 그때 센 객체 수만 더한다(정의 1,600개를 명령마다 검사하던 비용 제거).
    // 정의 안 객체는 레이어 목록을 따르므로 레이어 id 목록이 같을 때만 재사용한다.
    const layerKey=[...layers].join('\n');let knownDefinitions=d.version===3&&d.sharedBlocks&&typeof d.sharedBlocks==='object'?validatedSharedDefinitions.get(d.sharedBlocks):undefined;
    // 정의 하나를 더하거나 바꾼 묶음(withSharedDefinitions)은 바뀐 정의만 검사한다(예전: 블록 하나 만들 때도 정의 전체).
    if(knownDefinitions?.layerKey!==layerKey&&d.version===3&&d.sharedBlocks&&typeof d.sharedBlocks==='object'){const mark=total;knownDefinitions=this.validateSharedIncrement(d.sharedBlocks,layerKey,check,point)||knownDefinitions;total=mark;}
    if(knownDefinitions?.layerKey===layerKey){total+=knownDefinitions.count;if(total>MAX_DRAWING_OBJECTS)throw Error("도면 객체가 300만 개를 넘어 열 수 없습니다.");}
    else if(d.version===3){
      const done=new Set(),active=new Set(),before=total;
      const validateDefinition=(key,depth=0)=>{
        if(done.has(key))return;if(active.has(key)||depth>MAX_BLOCK_DEPTH)throw Error('공유 블록 정의 순환 또는 중첩 오류');
        const definition=d.sharedBlocks[key];if(!definition||!point(definition.origin||{x:0,y:0})||!Array.isArray(definition.entities))throw Error('공유 블록 정의 오류');
        active.add(key);const start=total;for(const entity of definition.entities)check(entity,depth+1);perKey.set(key,total-start);for(const entity of definition.entities)if(entity.sharedBlock)validateDefinition(entity.sharedBlock,depth+1);active.delete(key);done.add(key);
      };
      const perKey=new Map();
      for(const key of Object.keys(d.sharedBlocks))validateDefinition(key);
      validatedSharedDefinitions.set(d.sharedBlocks,{layerKey,count:total-before,perKey});
    }
    for (const e of d.entities) {
      if (typeof e.id !== "string" || ids.has(e.id))
        throw Error("객체 ID 중복 또는 오류");
      ids.add(e.id);
      check(e);
    }
    const blockNames = new Set();
    for (const b of d.blocks || []) {
      if (
        typeof b.name !== "string" ||
        blockNames.has(b.name) ||
        !Array.isArray(b.entities)
      )
        throw Error("블록 정의 오류");
      blockNames.add(b.name);
      b.entities.forEach((e) => check(e));
    }
  }
  bounds(es = this.doc.entities) {
    return G.bounds(es);
  }
  /* 바로 앞 묶음이 검사를 통과했고 레이어가 같으면, 바뀐 정의만 검사하고 개수는 정의별 기록으로 더한다.
     순환은 바뀐 정의에서 출발해 참조 그래프만 따라가 찾는다(객체 검사 없이). 조건이 안 맞으면 null(전체 검사). */
  validateSharedIncrement(definitions,layerKey,check,point){
    const derivation=sharedDerivation(definitions),base=derivation&&validatedSharedDefinitions.get(derivation.base);
    if(!base||base.layerKey!==layerKey||!base.perKey)return null;
    const perKey=new Map(base.perKey);
    for(const key of derivation.keys){
      perKey.delete(key);const definition=definitions[key];if(!definition)continue;
      if(!point(definition.origin||{x:0,y:0})||!Array.isArray(definition.entities))throw Error('공유 블록 정의 오류');
      let count=0;for(const entity of definition.entities){check(entity,1);count+=nestedCount(entity);}
      perKey.set(key,count);
    }
    const refs=(entity,out)=>{if(entity?.sharedBlock)out.push(entity.sharedBlock);for(const child of entity?.entities||[])refs(child,out);return out;};
    const state=new Map();
    const walk=(key,depth)=>{
      if(state.get(key)===2)return;if(state.get(key)===1||depth>MAX_BLOCK_DEPTH)throw Error('공유 블록 정의 순환 또는 중첩 오류');
      const definition=definitions[key];if(!definition)throw Error('공유 블록 정의가 누락되었습니다: '+key);
      state.set(key,1);for(const entity of definition.entities||[])for(const next of refs(entity,[]))walk(next,depth+1);state.set(key,2);
    };
    for(const key of derivation.keys)if(definitions[key])walk(key,0);
    let count=0;for(const value of perKey.values())count+=value;
    const result={layerKey,count,perKey};validatedSharedDefinitions.set(definitions,result);return result;
  }
}
const nativeMutate=DrawingEngine.prototype.mutate,nativeSelected=DrawingEngine.prototype.selected;


