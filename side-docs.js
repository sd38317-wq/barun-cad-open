// 616 블록 팔레트 도우미: 최근 블록·다른 도면 블록 둘러보기(곁 문서 캐시)·썸네일·블록 저장 방식 설정.
// AutoCAD: 최근 목록 BLOCKMRULIST=50, 곁 DB 풀(AcDbSideDbPool)에 다른 DWG 를 열어 두고 개수 제한, 썸네일 일괄 생성.
// 우리: 곁 문서는 정의(sharedBlocks)·블록 목록·레이어·단위만 남겨 메모리를 적게 쓰고(LRU 4개), 썸네일은 정의 객체마다
// 한 번 SVG 경로로 만들어 기억한다(정의는 불변이라 다시 그릴 일이 없다). 설정·최근 목록은 문서 밖(브라우저 저장소)에 둔다.
import * as G from './geometry.js';

const memory=new Map();
const storage=()=>{try{return typeof localStorage!=='undefined'?localStorage:null;}catch{return null;}};
export function prefGet(key,fallback){
  try{const raw=storage()?.getItem('barun-cad-block-'+key);return raw==null?fallback:JSON.parse(raw);}catch{return memory.has(key)?memory.get(key):fallback;}
}
export function prefSet(key,value){
  memory.set(key,value);
  try{storage()?.setItem('barun-cad-block-'+key,JSON.stringify(value));}catch{}
  return value;
}
/** 601 블록 저장 방식: 'shared'(정의 1개 + 참조, 기본) 또는 'copy'(예전처럼 삽입마다 사본). */
export const blockStorageShared=()=>prefGet('storage','shared')!=='copy';

/* ── 최근 블록(BLOCKMRULIST=50) ── */
export const RECENT_LIMIT=50;
export function pushRecent(list,name,max=RECENT_LIMIT){
  if(!name)return list||[];
  return [name,...(list||[]).filter(item=>item!==name)].slice(0,max);
}
export function recordRecentBlock(name){return prefSet('recent',pushRecent(prefGet('recent',[]),name));}
/** INSERT 이름 안내: 최근 쓴 블록을 앞에, 나머지는 이름순. 너무 길면 줄인다. */
export function insertNameList(blocks,recent=prefGet('recent',[]),limit=40){
  const names=[...new Set((blocks||[]).map(block=>block.name))],have=new Set(names);
  const first=(recent||[]).filter(name=>have.has(name)),rest=names.filter(name=>!first.includes(name)).sort((a,b)=>a.localeCompare(b,'ko',{numeric:true}));
  const all=[...first,...rest];
  return all.slice(0,limit).join(', ')+(all.length>limit?` 외 ${all.length-limit}개`:'');
}

/* ── 곁 문서 풀(AcDbSideDbPool) ── */
export function sideDocument(doc){
  return {sharedBlocks:doc?.sharedBlocks||{},blocks:doc?.blocks||[],layers:doc?.layers||[],units:doc?.sourceUnits??doc?.insunits??null};
}
export function createSideDocPool(load,max=4,now=()=>(typeof performance!=='undefined'?performance.now():Date.now())){
  const pool=new Map();let tick=0;
  return {
    async get(path){
      let hit=pool.get(path);
      if(!hit){
        hit={doc:sideDocument(await load(path)),used:0};pool.set(path,hit);
        while(pool.size>max){let oldest=null;for(const [key,value] of pool)if(key!==path&&(!oldest||value.used<oldest[1].used))oldest=[key,value];pool.delete(oldest[0]);}
      }
      hit.used=now()+(++tick)*1e-6;return hit.doc;
    },
    has:path=>pool.has(path),
    size:()=>pool.size,
    clear(){pool.clear();},
  };
}
/** 곁 문서의 블록 하나를 지금 도면으로 가져올 정의 묶음(중첩 정의 포함)과 레이어. 이름이 겹치면 접두를 붙인다. */
export function importSideBlock(side,key,target,{prefix=''}={}){
  const definitions=side.sharedBlocks||{};if(!definitions[key])throw Error('곁 도면에 블록 정의가 없습니다: '+key);
  const need=new Set(),visit=k=>{if(need.has(k))return;need.add(k);const walk=e=>{if(e?.sharedBlock)visit(e.sharedBlock);for(const child of e?.entities||[])walk(child);};for(const child of definitions[k]?.entities||[])walk(child);};
  visit(key);
  const rename=new Map();for(const k of need){let next=prefix+k,i=1;while(target.sharedBlocks?.[next]&&target.sharedBlocks[next]!==definitions[k])next=`${prefix}${k}_${i++}`;rename.set(k,next);}
  const layerByName=new Map((target.layers||[]).map(layer=>[layer.name,layer.id])),sourceLayers=new Map((side.layers||[]).map(layer=>[layer.id,layer])),newLayers=[];
  const layerId=id=>{const layer=sourceLayers.get(id);if(!layer)return id;if(layerByName.has(layer.name))return layerByName.get(layer.name);const copy={...layer,id:crypto.randomUUID()};layerByName.set(layer.name,copy.id);newLayers.push(copy);return copy.id;};
  const remap=e=>{const copy={...e,layer:layerId(e.layer)};if(e.sharedBlock)copy.sharedBlock=rename.get(e.sharedBlock)||e.sharedBlock;if(e.entities)copy.entities=e.entities.map(remap);return copy;};
  const out={};for(const k of need)out[rename.get(k)]={...definitions[k],name:definitions[k].name||k,entities:definitions[k].entities.map(remap)};
  return {key:rename.get(key),definitions:out,layers:newLayers};
}

/* ── 썸네일: 정의 객체마다 한 번, 정사각 SVG 경로 ── */
const thumbs=new WeakMap();
export function definitionThumbnail(definitions,key,size=64){
  const definition=definitions?.[key];if(!definition)return '';
  let cached=thumbs.get(definition);if(cached?.size===size)return cached.svg;
  let parts=[];
  try{const ref={id:'thumb',type:'block',name:key,sharedBlock:key,layer:null,position:{x:0,y:0},scale:1,rotation:0,entities:[]};parts=G.primitives(G.materializeSharedDrawingReference({sharedBlocks:definitions},ref));}catch{parts=[];}
  const box=G.bounds(parts.length?parts:[{type:'point',position:{x:0,y:0}}]),span=Math.max(box.maxX-box.minX,box.maxY-box.minY)||1,k=(size-4)/span;
  const map=p=>`${(2+(p.x-box.minX)*k).toFixed(1)},${(size-2-(p.y-box.minY)*k).toFixed(1)}`;
  const paths=[];let budget=4000;
  for(const part of parts){if(budget<=0)break;for(const segment of G.segments(part)||[]){if(--budget<=0)break;paths.push('M'+map(segment[0])+'L'+map(segment[1]));}}
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><path d="${paths.join('')}" fill="none" stroke="currentColor" stroke-width="1"/></svg>`;
  thumbs.set(definition,{size,svg});return svg;
}
