import {standardLayerForLabel,standardLayerForName} from './layer-standards.js';

// 옛 접두사는 읽기 호환에만 쓴다. 새 레이어 정의·명령에는 사용하지 않는다.
const koreanPrefix=['바른','_'].join('');
export const SITE_LEGACY_LAYER_NAMES=Object.freeze({'대지경계':'A-SITE-BND','도로':'A-SITE-ROAD','도로검토':'A-REVIEW','주변필지':'A-SITE-PARCEL','원대지경계':'A-SITE-PARCEL','가각전제':'A-REVIEW','토지정보':'A-SITE-TEXT','C-SITE-BND':'A-SITE-BND','C-SITE-ROAD':'A-SITE-ROAD','C-SITE-PARCEL':'A-SITE-PARCEL','C-SITE-TEXT':'A-SITE-TEXT'});
export const LEGACY_LAYER_NAMES={...SITE_LEGACY_LAYER_NAMES,B_Wall:'A-WALL',B_Window:'A-GLAZ',B_Door:'A-DOOR',B_Column:'A-COL',B_Furniture:'A-FURN',B_Dim:'A-DIM',B_Text:'A-TEXT',B_Hatch:'A-HATCH',B_Site:'A-SITE',B_Center:'A-CNTR',B_Masonry:'A-WALL-MASN',B_Road:'A-SITE-ROAD',B_Insulation:'A-WALL-INSL',B_Stair:'A-STAIR',B_Lift:'A-ELEV',B_Ramp:'A-RAMP',B_Review:'A-REVIEW',B_Plumbing:'A-PLMB',B_Kitchen:'A-KTCH','A-ANNO':'A-TEXT','A-WALL-BRCK':'A-WALL-MASN','A-AREA-PATT':'A-HATCH','S-COLS':'A-COL','S-BEAM':'A-BEAM','A-ANNO-DIMS-MAJR':'A-DIM-MAJR','A-ANNO-DIMS':'A-DIM','A-ANNO-TEXT':'A-TEXT','A-ANNO-SYMB':'A-SYM','A-ANNO-TTLB':'A-TITLE','A-ANNO-NOTE':'A-NOTE','A-ANNO-PLOT':'A-PLOT','A-ANNO-GUID':'A-GUIDE','A-ANNO-ACCS':'A-ACCS','A-ANNO-ASSUMED':'A-ASSUMED','A-PATT':'A-HATCH','A-COLS':'A-COL','A-STRS':'A-STAIR','A-WALL-CNTR':'A-WALL-C','A-SANR':'A-SANI'};
export function legacyStandardName(name){
 if(typeof name!=='string')return null;
 if(name.startsWith(koreanPrefix))return standardLayerForLabel(name.slice(koreanPrefix.length))?.name||null;
 if(name.startsWith('B_Room_')){const n='A-AREA-'+name.slice(7).toUpperCase();return standardLayerForName(n)?.name||null;}
 return LEGACY_LAYER_NAMES[name]||null;
}
const state=l=>({visible:l.visible!==false,frozen:!!l.frozen,locked:!!l.locked,plot:l.plot!==false});
const restrictive=(a,b)=>({visible:a.visible&&b.visible,frozen:a.frozen||b.frozen,locked:a.locked||b.locked,plot:a.plot&&b.plot});

/** 도면 열기 전 한 번만 실행. 바뀌지 않은 객체·공유 정의는 재사용하고 원본은 undo에 둔다.
 * 같은 이름에 합칠 때 목표 사양을 유지하되 BYLAYER 외관은 객체 속성에 고정한다.
 * 서로 다른 레이어 상태는 restrictive(보수적 합침) 또는 target 정책으로 처리한다. */
export function prepareLegacyLayerMigration(doc,{mergePolicy='restrictive'}={}){
 const candidates=(doc.layers||[]).filter(l=>legacyStandardName(l.name));
 if(!candidates.length)return {doc,before:null,changed:0,merged:0,stateConflicts:0,layerIds:new Map()};
 if(!['restrictive','target'].includes(mergePolicy))throw Error('레이어 병합 상태 기준 오류');
 const original=new Map(doc.layers.map(l=>[l.id,l])),byName=new Map(doc.layers.filter(l=>!legacyStandardName(l.name)).map(l=>[l.name,l]));
 const destinations=new Map(),layerIds=new Map(),removed=new Set(),changedLayers=new Map();
 const safety=doc.legacyLayerSafety||{},viewportStyles=new Map(Object.entries(safety.viewportStyles||{})),uncopyable=new Set(safety.uncopyableLayers||[]),skipped=[];
 const viewportConflict=(source,target)=>{
  if(!source||!target)return false;
  return [...new Set([...Object.keys(source.views),...Object.keys(target.views)])].some(handle=>{
   const view=source.views[handle]||{override:false,values:source.defaults},other=target.views[handle]||{override:false,values:target.defaults};
   return other&&(view.override||other.override)&&(JSON.stringify(source.base)!==JSON.stringify(target.base)||JSON.stringify(view.values)!==JSON.stringify(other.values));
  });
 };
 let merged=0,stateConflicts=0;
 for(const source of candidates){
  const name=legacyStandardName(source.name),key=source.name.toLowerCase();let target=byName.get(name);
  const reason=uncopyable.has(key)?'블록을 복제할 수 없어':viewportConflict(viewportStyles.get(key),viewportStyles.get(name.toLowerCase()))?'뷰포트 속성이 달라':null;
  if(reason){skipped.push({name:source.name,reason});continue;}
  if(!viewportStyles.has(name.toLowerCase())&&viewportStyles.has(key))viewportStyles.set(name.toLowerCase(),viewportStyles.get(key));
  if(!target){target={...source,name};byName.set(name,target);changedLayers.set(source.id,target);}
  else{
   const copy={...target,mergedLayerSources:[...(target.mergedLayerSources||[]),structuredClone(source)]};
   const a=state(target),b=state(source);if(Object.keys(a).some(k=>a[k]!==b[k])){stateConflicts++;if(mergePolicy==='restrictive')Object.assign(copy,restrictive(a,b));}
   target=copy;byName.set(name,target);changedLayers.set(target.id,target);removed.add(source.id);merged++;
  }
  destinations.set(source.id,target);layerIds.set(source.id,target.id);
 }
 if(!destinations.size)return {doc,before:null,changed:0,merged:0,stateConflicts:0,layerIds,skipped};
 // 여러 옛 레이어가 한 목표로 합쳐졌으면 마지막 목표 속성으로 모든 대응을 맞춘다.
 for(const [id,target] of destinations)destinations.set(id,byName.get(target.name));
 const layers=doc.layers.filter(l=>!removed.has(l.id)).map(l=>changedLayers.get(l.id)||l);
 let definitions=doc.sharedBlocks,defsChanged=false;const definitionCache=new Map(),active=new Set();let variant=0;
 const targetOf=layer=>destinations.get(layer?.id)||layer;
 const preserveStyle=(entity,source,target,parent)=>{
  if(!source||!target||source.id===target.id)return entity;
  const changes={};
  // BYBLOCK은 참조 색을 계속 상속한다. BYLAYER만 원래 레이어의 외관으로 고정한다.
  if((entity.colorMode==='byblock'?!parent:!entity.color||entity.colorMode==='bylayer'||entity.aci===256)&&source.color!==target.color){
   changes.color=source.color;changes.colorMode=source.colorMode==='aci'?'aci':'truecolor';changes.aci=source.colorMode==='aci'&&Number.isInteger(source.aci)?source.aci:undefined;
  }
  const lt=String(entity.linetype||'BYLAYER').toUpperCase();
  if((lt==='BYLAYER'||lt==='BYBLOCK'&&!parent)&&source.linetype!==target.linetype)changes.linetype=source.linetype||'CONTINUOUS';
  if(entity.lineweight==null&&source.lineweight!==target.lineweight)changes.lineweight=source.lineweight??.25;
  return Object.keys(changes).length?{...entity,...changes}:entity;
 };
 const mapArray=(list,parent)=>{let changed=false;const next=(list||[]).map(e=>{const n=visit(e,parent);changed||=n!==e;return n;});return changed?next:list;};
 const rewriteDefinition=(key,parent)=>{
  const cacheKey=key+'|'+(parent?.id||'');if(definitionCache.has(cacheKey))return definitionCache.get(cacheKey);
  const definition=doc.sharedBlocks?.[key];if(!definition)return key;
  if(active.has(cacheKey))throw Error('공유 블록 정의 순환 오류');active.add(cacheKey);
  const entities=mapArray(definition.entities,parent);active.delete(cacheKey);
  let nextKey=key;
  if(entities!==definition.entities){
   if(!defsChanged){definitions={...doc.sharedBlocks};defsChanged=true;}
   if(parent){do{nextKey=key+'-layer-'+(++variant);}while(Object.hasOwn(definitions,nextKey));}
   definitions[nextKey]={...definition,entities};
  }
  definitionCache.set(cacheKey,nextKey);return nextKey;
 };
 const visit=(entity,parent=null)=>{
  const own=original.get(entity.layer),source=own?.name==='0'&&parent?parent:own,target=targetOf(source);
  let next=preserveStyle(entity,source,target,parent);
  const layer=layerIds.get(entity.layer);if(layer&&layer!==entity.layer)next={...next,layer};
  if(entity.entities){const entities=mapArray(entity.entities,source);if(entities!==entity.entities)next={...next,entities};}
  if(entity.sharedBlock){const sharedBlock=rewriteDefinition(entity.sharedBlock,source);if(sharedBlock!==entity.sharedBlock)next={...next,sharedBlock};}
  if(entity.lineWallHost){const parts=mapArray(entity.lineWallHost.parts,null),sources=mapArray(entity.lineWallHost.sources,null);if(parts!==entity.lineWallHost.parts||sources!==entity.lineWallHost.sources)next={...next,lineWallHost:{...entity.lineWallHost,parts,sources}};}
  return next;
 };
 const entities=mapArray(doc.entities,null),blocks=doc.blocks?.map(block=>{const entities=mapArray(block.entities,null);return entities===block.entities?block:{...block,entities};});
 for(const key of Object.keys(doc.sharedBlocks||{}))rewriteDefinition(key,null);
 const layerNameMigrations=[...(doc.layerNameMigrations||[]),...candidates.filter(l=>destinations.has(l.id)).map(l=>({from:l.name,to:legacyStandardName(l.name)}))];
 const next={...doc,layers,entities,layerNameMigrations,...(blocks?{blocks}:{}),...(defsChanged?{sharedBlocks:definitions}:{})};
 return {doc:next,before:doc,changed:destinations.size,merged,stateConflicts,layerIds,skipped};
}
export function migrateLegacyLayerNames(doc,options){
 const result=prepareLegacyLayerMigration(doc,options);if(result.changed)Object.assign(doc,result.doc);return result.changed;
}
export const layerMigrationNotice=result=>[
 ...(result.skipped||[]).map(({name,reason})=>`${name} 레이어는 ${reason} 그대로 두었습니다`),
 ...(result.changed?[`옛 레이어 ${result.changed}개를 A- 기준으로 옮겼습니다${result.merged?' · 같은 레이어 '+result.merged+'개 합침':''}${result.stateConflicts?' · 상태 충돌은 보수적으로 보존':''} · Ctrl+Z 한 번으로 되돌리기 · 저장 전 원본 파일 유지`]:[])
].join(' · ');

/** 복구한 탭도 한 번만 이전한다. Undo 후 탭 전환·다시 복구해도 재실행하지 않는다. */
export function migrateDrawingTabLayers(tab){
 if(tab.legacyLayersChecked)return {changed:0};
 const result=prepareLegacyLayerMigration(tab.doc);tab.legacyLayersChecked=true;
 if(result.changed){tab.doc=result.doc;tab.dirty=true;tab.undoStack=[...(tab.undoStack||[]),result.before];tab.redoStack=[];if(tab.view?.activeLayer&&result.layerIds.has(tab.view.activeLayer))tab.view={...tab.view,activeLayer:result.layerIds.get(tab.view.activeLayer)};}
 return result;
}
