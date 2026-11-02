import {standardLayerForName} from './layer-standards.js';
import * as G from './geometry.js';
const STANDARD_LAYERS = new Set(['A-BLDG-L1','A-BLDG-UP','A-CORE','A-WALL','A-GLAZ','A-DOOR','A-STAIR','A-ELEV','A-TEXT','A-DIM','A-SYM','A-NOTE','A-AREA','A-AREA-PATT','A-CNTR','A-COL']);
const unavailable = layer => layer.locked || layer.frozen || layer.hidden || layer.visible === false || layer.plot === false;
/** Stages one actual-mm block; the caller validates and applies in one undo transaction. */
export function prepareJutongInsertion(document, args) {
 const detail=args?.detail, source=detail?.geometry;
 if(!source || source.units!=='mm' || !Array.isArray(source.layers) || !Array.isArray(source.entities) || !source.entities.length)throw Error('주동의 실제 mm 기하가 없습니다.');
 if(detail.usable_as_jutong===false)throw Error('동 전체 구성·분리 범위 확인이 필요한 주동입니다.');
 if(detail.scale_verified!==true)throw Error('축척 확인이 되지 않은 주동은 삽입할 수 없습니다.');
 if(args.scale!==undefined && args.scale!==1)throw Error('주동은 실제 크기로만 삽입합니다.');
 const position=args.position??{x:0,y:0},rotation=args.rotation??0;
 if(![position.x,position.y,rotation].every(Number.isFinite))throw Error('position과 rotation은 유한한 숫자여야 합니다.');
 const layers=document.layers.slice(),mapping=new Map(),byName=new Map(layers.map(layer=>[layer.name,layer]));
 for(const layer of source.layers){
  if(!STANDARD_LAYERS.has(layer.name) || mapping.has(layer.id))throw Error('주동 표준 레이어를 확인하세요.');
  const existing=byName.get(layer.name),target=existing||{...structuredClone(layer),...(detail.server_asset?standardLayerForName(layer.name):null),id:crypto.randomUUID()};
  if(unavailable(target))throw Error('주동 대상 레이어가 잠겨 있거나 숨겨져 있습니다.');
  if(!existing){layers.push(target);byName.set(target.name,target);}
  mapping.set(layer.id,target.id);
 }
 const remap=entity=>{
  if(entity.sharedBlock)throw Error('주동 공유 블록은 등록할 때 전개해야 합니다.');
  const value=structuredClone(entity);value.id=crypto.randomUUID();value.layer=mapping.get(entity.layer);
  if(!value.layer)throw Error('주동 객체의 레이어가 없습니다.');
  for(const key of ['entities','children'])if(Array.isArray(entity[key]))value[key]=entity[key].map(remap);
  return value;
 };
 const entities=source.entities.map(remap).map(entity=>G.rotate(G.translate(entity,position.x,position.y),position,rotation));
 const metadata=Object.fromEntries(['id','name','combination','combination_verified','name_order_verified','name_order_evidence','form','classification','core_count','core_form','units_per_floor','unit_types','floor_counts','floor_verified','width_mm','depth_mm','footprint_area_m2','footprint_verified','outline','orientation','balcony','pilotis','review_required','review_reasons','units_verified','core_verified','labeled_unit_count','usable_as_jutong'].filter(key=>detail[key]!==undefined).map(key=>[key,structuredClone(detail[key])]));
 const rootTarget=byName.get('A-BLDG-L1')||layers.find(layer=>layer.id===mapping.get(source.entities[0].layer));
 if(!rootTarget || unavailable(rootTarget))throw Error('주동 블록 대상 레이어가 잠겨 있거나 숨겨져 있습니다.');
 const rootLayer=rootTarget.id;
 const block={id:crypto.randomUUID(),type:'block',name:detail.name||detail.id||'주동',layer:rootLayer,position:{...position},entities,attributes:{JUTONG_ID:detail.id},jutong:{...metadata,rotation}};
 return {document:{...document,layers,entities:[...document.entities,block]},block};
}
