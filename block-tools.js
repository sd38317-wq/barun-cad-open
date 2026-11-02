import * as G from './geometry.js';
import {sharedDefinitionStats} from './shared-blocks.js';

const center=entity=>{const bounds=G.bounds([entity]);if(!bounds)throw Error('블록 범위를 계산할 수 없습니다.');return entity.position||{x:(bounds.minX+bounds.maxX)/2,y:(bounds.minY+bounds.maxY)/2};};
const cloneIds=entity=>{const copy=structuredClone(entity);delete copy.id;if(copy.entities)copy.entities=copy.entities.map(cloneIds);return copy;};

export function replaceBlock(source,target){
 if(source?.type!=='block'||target?.type!=='block')throw Error('블록만 교체할 수 있습니다.');
 const targetAnchor=center(target);
 if(source.sharedBlock)return {...structuredClone(target),name:source.name,sharedBlock:source.sharedBlock,entities:[],position:targetAnchor,scale:target.scale??source.scale??1,rotation:target.rotation??source.rotation??0,xref:null};
 const sourceAnchor=center(source),scale=(Number(target.scale)||1)/(Number(source.scale)||1),rotation=(Number(target.rotation)||0)-(Number(source.rotation)||0);
 const entities=(source.entities||[]).map(child=>G.translate(G.rotate(G.resize(cloneIds(child),sourceAnchor,scale),sourceAnchor,rotation),targetAnchor.x-sourceAnchor.x,targetAnchor.y-sourceAnchor.y));
 return {...structuredClone(target),name:source.name,entities,position:targetAnchor,sharedBlock:undefined,xref:null};
}

export function cleanBlockDefinitions(doc){
 const definitions=new Map((doc.blocks||[]).map(block=>[block.name,block])),used=new Set();
 const visitEntity=entity=>{if(entity.type==='block'&&definitions.has(entity.name)&&!used.has(entity.name)){used.add(entity.name);for(const child of definitions.get(entity.name).entities||[])visitEntity(child);}for(const child of entity.entities||[])visitEntity(child);};
 for(const entity of doc.entities||[])visitEntity(entity);
 const blocks=(doc.blocks||[]).filter(block=>used.has(block.name));
 return {blocks,removed:(doc.blocks||[]).filter(block=>!used.has(block.name)).map(block=>block.name)};
}

/* 603 블록 수량: 공유 참조 안의 중첩 블록도 센다. 정의마다 한 번 센 값(sharedDefinitionStats)을 참조 수만큼 곱한다 —
   109만 개를 펼치지 않고 수량을 얻는다. definitions 를 안 주면 예전처럼 보이는 자식만 센다. */
export function blockCounts(entities,definitions=null){
 const counts=new Map(),bump=(key,n=1)=>counts.set(key,(counts.get(key)||0)+n);
 const visit=entity=>{
  // MINSERT 묶음(minsert)은 칸 참조만 센다(행×열 = AutoCAD COUNT 와 같게).
  if(entity.type==='block'&&!entity.table&&!entity.minsert){bump(entity.name||'(이름 없음)');if(entity.sharedBlock&&definitions?.[entity.sharedBlock])for(const [name,count] of sharedDefinitionStats(definitions,entity.sharedBlock).blocks)bump(name,count);}
  for(const child of entity.entities||[])if(child.type==='block')visit(child);
 };
 for(const entity of entities||[])visit(entity);
 return [...counts].sort((a,b)=>a[0].localeCompare(b[0],'ko',{numeric:true})).map(([name,count])=>({name,count}));
}

/* 612 ATTSYNC: 참조의 속성 값을 정의의 속성 정의(attdef) 목록에 맞춘다.
   짝짓기는 태그 대소문자 무시 + 같은 태그 중 몇 번째인지(AutoCAD SyncBlkRef 와 같은 규칙). 값은 지키고, 새 태그는 기본값,
   정의에서 사라진 태그는 지운다. 상수 속성은 참조에 두지 않는다. 화면 문자는 그릴 때 만들어지므로 모양 동기화는 따로 없다. */
export function attsyncValues(definitionEntities,values={}){
 const defs=(definitionEntities||[]).filter(entity=>entity?.attdef);
 const old=Object.entries(values||{}),used=new Set(),next={},seen=new Map();
 for(const entity of defs){
  const def=entity.attdef,tag=String(def.tag),upper=tag.toUpperCase(),nth=seen.get(upper)||0;seen.set(upper,nth+1);
  if(def.constant)continue;
  let hit=-1,count=0;
  for(let i=0;i<old.length;i++){if(used.has(i)||old[i][0].toUpperCase()!==upper)continue;if(count++===nth){hit=i;break;}}
  if(hit<0)for(let i=0;i<old.length;i++)if(!used.has(i)&&old[i][0].toUpperCase()===upper){hit=i;break;}
  if(hit>=0){used.add(hit);next[tag]=old[hit][1];}else next[tag]=def.default??'';
 }
 return next;
}
export function attsyncPlan(doc,key,refs=null){
 const definition=doc.sharedBlocks?.[key];if(!definition)throw Error('공유 블록 정의를 찾을 수 없습니다: '+key);
 // 속성 정의가 없는 정의(가져온 DWG 블록 등)는 맞출 기준이 없다 — 값을 지우지 않도록 멈춘다.
 if(!definition.entities?.some(entity=>entity?.attdef))throw Error('이 블록 정의에는 속성 정의(ATTDEF)가 없습니다. 값은 그대로 둡니다.');
 const updates=[];
 for(const ref of refs||doc.entities){
  if(ref.sharedBlock!==key)continue;
  const next=attsyncValues(definition.entities,ref.attributes);
  if(JSON.stringify(next)!==JSON.stringify(ref.attributes||{}))updates.push({id:ref.id,changes:{attributes:next}});
 }
 return updates.length?{type:'updateMany',updates}:null;
}
/** 611 삽입 때 속성 묻기(insatt 규칙): 상수는 묻지 않고 참조에 두지 않는다, 사전설정(preset)은 기본값, 확인(verify)은 두 번 묻는다. */
export async function promptAttributes(definitionEntities,ask){
 const out={};
 for(const entity of (definitionEntities||[]).filter(e=>e?.attdef&&!e.attdef.constant)){
  const d=entity.attdef,label=d.prompt||d.tag;
  out[d.tag]=d.preset?(d.default??''):await ask(label,d.default??'');
  if(d.verify&&!d.preset&&(await ask(`${label} (확인)`,out[d.tag]))!==out[d.tag])throw Error(`${label}: 확인 값이 다릅니다.`);
 }
 return out;
}
/** 속성 값 바꾸기(ATTEDIT): 맵과, 가져온 ATTRIB 문자 자식(attributeTag)을 함께 고친다 — 둘이 따로 놀지 않게. */
export function attributeEditChanges(ref,values){
 const attributes={...(ref.attributes||{}),...values},changes={attributes};
 if(!ref.sharedBlock&&ref.entities?.some(child=>child.attributeTag!==undefined&&Object.hasOwn(values,child.attributeTag)))changes.entities=ref.entities.map(child=>child.attributeTag!==undefined&&Object.hasOwn(values,child.attributeTag)?{...child,text:String(values[child.attributeTag])}:child);
 return changes;
}
