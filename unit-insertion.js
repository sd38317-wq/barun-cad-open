import {standardLayerForName} from './layer-standards.js';
import * as G from './geometry.js';
const STANDARD = new Set(['A-WALL','A-GLAZ','A-DOOR','A-CORE','A-TEXT','A-DIM','A-AREA','A-AREA-PATT','A-CNTR']);
const unavailable=l=>l.locked||l.frozen||l.hidden||l.visible===false||l.plot===false;
export function prepareUnitInsertion(document,args){
 const detail=args?.detail, source=detail?.geometry;
 if(!source||source.units!=='mm'||!Array.isArray(source.layers)||!Array.isArray(source.entities)||!source.entities.length)throw Error('단위세대의 실제 mm 기하가 없습니다.');
 if(detail.usable_as_unit!==true||detail.scale_verified!==true)throw Error('삽입할 수 없는 단위세대입니다.');
 if(args.scale!==undefined&&args.scale!==1)throw Error('단위세대는 실제 크기로만 삽입합니다.');
 const p=args.position??{x:0,y:0},rotation=args.rotation??0,mirror=args.mirror??false;
 if(typeof mirror!=='boolean')throw Error('mirror는 boolean이어야 합니다.');
 if(![p.x,p.y,rotation].every(Number.isFinite))throw Error('position과 rotation은 유한한 숫자여야 합니다.');
 const layers=document.layers.slice(),map=new Map(),by=new Map(layers.map(l=>[l.name,l]));
 for(const layer of source.layers){if(!STANDARD.has(layer.name)||map.has(layer.id))throw Error('단위세대 표준 레이어를 확인하세요.'); const old=by.get(layer.name),target=old||{...structuredClone(layer),...(detail.server_asset?standardLayerForName(layer.name):null),id:crypto.randomUUID()}; if(unavailable(target))throw Error('단위세대 대상 레이어가 잠겨 있거나 숨겨져 있습니다.'); if(!old){layers.push(target);by.set(target.name,target)} map.set(layer.id,target.id)}
 const remap=e=>{if(e.sharedBlock)throw Error('단위세대 공유 블록은 등록할 때 전개해야 합니다.'); const v=structuredClone(e);v.id=crypto.randomUUID();v.layer=map.get(e.layer); if(!v.layer)throw Error('단위세대 객체의 레이어가 없습니다.'); for(const k of ['entities','children'])if(Array.isArray(e[k]))v[k]=e[k].map(remap); return v};
 let entities=source.entities.map(remap); if(mirror)entities=entities.map(e=>G.mirror(e,{x:0,y:0},{x:0,y:1})); entities=entities.map(e=>G.rotate(G.translate(e,p.x,p.y),p,rotation));
 const root=by.get('A-WALL')||layers.find(l=>l.id===map.get(source.entities[0].layer)); if(!root||unavailable(root))throw Error('단위세대 대상 레이어가 잠겨 있거나 숨겨져 있습니다.');
 const metadata=Object.fromEntries(['id','name','type_name','exclusive_area_m2','bays','rooms','bathrooms','core_form','width_mm','depth_mm','usable_as_unit','scale_verified','expanded','balcony','supply_area_m2','balcony_area_m2','outline_area_m2','area_difference_pct','area_verified','boundary_method','kitchen_position','living_orientation','building_form','review_required','review_reasons','evidence','confidence','opening_status','mirror_variants_grouped'].filter(k=>detail[k]!==undefined).map(k=>[k,structuredClone(detail[k])]));
 const block={id:crypto.randomUUID(),type:'block',name:detail.name||detail.id||'단위세대',layer:root.id,position:{...p},entities,attributes:{UNIT_ID:detail.id},unit:{...metadata,rotation,mirror}};
 return {document:{...document,layers,entities:[...document.entities,block]},block};
}
