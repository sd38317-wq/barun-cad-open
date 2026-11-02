// 614 데이터 추출(DATAEXTRACTION)·표 연결 갱신.
// AutoCAD: 추출 마법사 결과 표는 원본이 바뀌면 "갱신 필요"를 띄우고 사용자가 다시 채운다.
// 우리: 추출 정의(spec)를 표 객체에 함께 저장하고, 표를 열거나 명령을 다시 부르면 같은 정의로 다시 채운다.
//   - 공유 참조 안의 중첩 블록은 정의마다 한 번 모은 값을 참조 수만큼 곱한다(펼치지 않음).
//   - 레이어는 이름으로, 속성은 태그 대소문자 무시로 읽는다. 엑셀·CSV 로 그대로 내보낼 수 있는 2차원 배열을 돌려준다.
// 순수 함수. 문서를 고치지 않는다.

const MAX_DEPTH=8;
const textOf=value=>value==null?'':String(value);
function attributeValue(entity,tag){
  const values=entity.attributes||{};
  if(Object.hasOwn(values,tag))return values[tag];
  const upper=tag.toUpperCase();for(const [key,value] of Object.entries(values))if(key.toUpperCase()===upper)return value;
  return entity.blockParameters?.[tag]??'';
}
export function normalizeSpec(spec={}){
  const groupBy=Array.isArray(spec.groupBy)&&spec.groupBy.length?spec.groupBy.map(String):['name'];
  const columns=Array.isArray(spec.columns)&&spec.columns.length?spec.columns:[...groupBy.map(key=>({key,label:key==='name'?'블록 이름':key==='layer'?'레이어':key.startsWith('attr:')?key.slice(5):key})),{key:'count',label:'수량'}];
  const list=value=>Array.isArray(value)?value.map(String).filter(Boolean):typeof value==='string'?value.split(',').map(s=>s.trim()).filter(Boolean):null;
  const names=list(spec.filter?.names),layers=list(spec.filter?.layers);
  return {groupBy,columns,filter:{names:names?.length?names:null,layers:layers?.length?layers:null},nested:!!spec.nested,sort:spec.sort||'key'};
}
export function runExtraction(doc,rawSpec){
  const spec=normalizeSpec(rawSpec),layerNames=new Map((doc.layers||[]).map(layer=>[layer.id,layer.name]));
  const names=spec.filter.names&&new Set(spec.filter.names),layers=spec.filter.layers&&new Set(spec.filter.layers);
  const definitions=doc.sharedBlocks||{},rows=new Map(),nestedMemo=new Map();
  const keyVals=entity=>spec.groupBy.map(key=>key==='name'?textOf(entity.name||'(이름 없음)'):key==='layer'?textOf(layerNames.get(entity.layer)??entity.layer):key.startsWith('attr:')?textOf(attributeValue(entity,key.slice(5))):textOf(entity[key]));
  const matches=entity=>(!names||names.has(entity.name))&&(!layers||layers.has(layerNames.get(entity.layer)));
  const bump=(target,entity,count=1)=>{if(!matches(entity))return;const values=keyVals(entity),key=JSON.stringify(values),row=target.get(key)||{keyVals:values,count:0};row.count+=count;target.set(key,row);};
  // 정의 안(중첩) 블록의 행 기여: 정의마다 한 번만 계산한다.
  const nestedRows=(key,stack=[])=>{
    if(nestedMemo.has(key))return nestedMemo.get(key);
    if(stack.includes(key)||stack.length>MAX_DEPTH)return new Map();
    const out=new Map();
    const walk=(entity,depth)=>{
      if(entity?.type!=='block'||entity.table||depth>MAX_DEPTH)return;
      bump(out,entity);
      if(entity.sharedBlock)for(const [rowKey,row] of nestedRows(entity.sharedBlock,[...stack,key])){const prior=out.get(rowKey)||{keyVals:row.keyVals,count:0};prior.count+=row.count;out.set(rowKey,prior);}
      for(const child of entity.entities||[])walk(child,depth+1);
    };
    for(const child of definitions[key]?.entities||[])walk(child,1);
    nestedMemo.set(key,out);return out;
  };
  for(const entity of doc.entities||[]){
    if(entity?.type!=='block'||entity.table)continue;
    // MINSERT 묶음은 칸마다 센다.
    if(entity.minsert){for(const cell of entity.entities||[])if(cell?.type==='block')bump(rows,cell);continue;}
    bump(rows,entity);
    if(!spec.nested)continue;
    if(entity.sharedBlock)for(const [rowKey,row] of nestedRows(entity.sharedBlock)){const prior=rows.get(rowKey)||{keyVals:row.keyVals,count:0};prior.count+=row.count;rows.set(rowKey,prior);}
    const walk=(child,depth)=>{if(child?.type!=='block'||child.table||depth>MAX_DEPTH)return;bump(rows,child);if(child.sharedBlock)for(const [rowKey,row] of nestedRows(child.sharedBlock)){const prior=rows.get(rowKey)||{keyVals:row.keyVals,count:0};prior.count+=row.count;rows.set(rowKey,prior);}for(const next of child.entities||[])walk(next,depth+1);};
    for(const child of entity.entities||[])walk(child,1);
  }
  const list=[...rows.values()];
  list.sort(spec.sort==='count'?(a,b)=>b.count-a.count:(a,b)=>a.keyVals.join('\u0001').localeCompare(b.keyVals.join('\u0001'),'ko',{numeric:true}));
  return [spec.columns.map(column=>column.label),...list.map(row=>spec.columns.map(column=>column.key==='count'?row.count:row.keyVals[spec.groupBy.indexOf(column.key)]??''))];
}
/** 추출 표 갱신 계획: 표 객체(extraction 정의를 가진 것)마다 다시 계산해 내용이 다르면 바꿀 행을 돌려준다. */
export function staleExtractionTables(doc){
  const out=[];
  for(const entity of doc.entities||[]){
    if(!entity?.table||!entity.extraction)continue;
    const rows=runExtraction(doc,entity.extraction);
    if(JSON.stringify(rows)!==JSON.stringify(entity.table.rows))out.push({entity,rows});
  }
  return out;
}
/** CSV(엑셀에서 바로 열리게 BOM 포함). */
export function extractionCsv(rows){
  const cell=value=>{const text=textOf(value);return /[",\n\r]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;};
  return '﻿'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
