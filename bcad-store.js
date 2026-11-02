// 215·216: .bcad 덩어리 형식 — 바뀐 덩어리만 다시 쓰는 증분 저장과 빈 공간 재사용.
//
// AutoCAD: 증분 저장(incrementalSave)은 디스크 파일이 마지막 저장 때와 같은지 보고, 빈 공간 비율이 ISAVEPERCENT(50%)를
// 넘으면 전체 저장으로 넘긴다. 통과하면 바뀐 객체만 쓰고 핸들→위치 표와 빈 공간 표를 고친다. 빈 공간은 512B 미만이면 버리고
// 4KB 이상만 크기 구간 목록에서 다시 쓴다(FreeSpaceAllocator).
//
// 바른 CAD 판(더 낫게 한 점):
//  - 객체 하나씩이 아니라 64KB 안팎 덩어리 단위로 쓴다. 구멍 크기가 고르게 되어 구간 4개로 충분하고, 작은 구멍이 덜 생긴다.
//  - 덩어리마다 FNV-1a 지문을 위치표에 두어 열 때 깨진 덩어리를 바로 찾는다(그 덩어리만 잃고 나머지는 연다 — 데이터 손실을 좁힌다).
//  - 위치표는 언제나 파일 끝에 새로 쓰고 꼬리(마지막 16바이트)가 가장 최근 위치표를 가리킨다. 증분 저장 도중 끊겨도
//    꼬리를 쓰기 전이면 옛 위치표가 그대로 살아 있다(옛 덩어리 자리는 새 위치표가 확정된 뒤에야 빈 공간으로 돌린다).
//  - 디스크 파일이 마지막 저장 때와 다르면(다른 프로그램이 고침) 증분하지 않고 전체 저장한다(AutoCAD 와 같은 검사).
// 1단계: 형식·증분 판단·빈 공간 할당기를 메모리 바이트 위에서 완성하고 시험한다. 실제 파일 쓰기(엔진 쪽 위치 쓰기 API)는 남은 단계다.

export const ISAVEPERCENT=50,FORCED_ISAVEPERCENT=90;
export const CHUNK_TARGET_BYTES=64*1024;
export const MAGIC='BCV3';
const encoder=new TextEncoder(),decoder=new TextDecoder();
const TRAILER=16;

export function fnv1a(bytes){let h=0x811c9dc5;for(let i=0;i<bytes.length;i++){h^=bytes[i];h=Math.imul(h,0x01000193)>>>0;}return h>>>0;}

/** 216: 빈 공간 할당기. 512B 미만 구멍은 세기만 하고(낭비율에 들어감) 다시 쓰지 않는다. 4KB 이상(또는 reuseSmall)만 재사용. */
export function createFreeSpace({end=0,reuseSmall=false}={}){
  const bins=[[4096,[]],[65536,[]],[1<<20,[]],[Infinity,[]]];
  let freeBytes=0,fileEnd=end;
  return {
    get freeBytes(){return freeBytes;},
    get end(){return fileEnd;},
    set end(v){fileEnd=v;},
    free({at,size}){
      if(!(size>0))return;
      freeBytes+=size;
      if(size<512)return;                                   // 작은 구멍은 버림(낭비로만 셈)
      for(const [max,list] of bins)if(size<max){list.push({at,size});return;}
    },
    find(size){
      if(size>=4096||reuseSmall)for(const [,list] of bins){
        let best=-1;for(let i=0;i<list.length;i++)if(list[i].size>=size&&(best<0||list[i].size<list[best].size))best=i;
        if(best>=0){const hole=list.splice(best,1)[0];freeBytes-=hole.size;
          // 남는 꼬리는 다시 구멍으로(512B 미만이면 낭비로 셈).
          if(hole.size>size)this.free({at:hole.at+size,size:hole.size-size});
          return {at:hole.at,size,reused:true};}
      }
      const at=fileEnd;fileEnd+=size;return {at,size,reused:false};
    },
    holes(){return bins.flatMap(([,list])=>list.map(h=>({...h})));},
  };
}

/** 낭비율로 증분/전체를 고른다. file 이 없거나 디스크 파일이 바뀌었으면 전체. */
export function chooseSave(file,{forceIncremental=false,disk=null,isavePercent=ISAVEPERCENT}={}){
  if(!file?.index)return 'full';
  if(disk&&(disk.size!==file.lastSavedSize||disk.mtime!==file.lastSavedMtime))return 'full';
  if(isavePercent<=0)return 'full';                         // 0 = 증분 저장 끔(AutoCAD ISAVEPERCENT=0 과 같은 뜻)
  const total=file.bytesLength||1;
  const waste=Math.min(100,Math.floor(100*file.space.freeBytes/total));
  return waste>(forceIncremental?FORCED_ISAVEPERCENT:isavePercent)?'full':'incremental';
}

const headerOf=doc=>{const {entities,...rest}=doc;return rest;};
function chunkEntities(entities,target=CHUNK_TARGET_BYTES){
  const chunks=[];let current=[],size=0;
  for(const e of entities){
    const n=JSON.stringify(e).length+1;
    if(current.length&&size+n>target){chunks.push(current);current=[];size=0;}
    current.push(e);size+=n;
  }
  if(current.length)chunks.push(current);
  return chunks;
}
const grow=(bytes,need)=>{if(need<=bytes.length)return bytes;const next=new Uint8Array(Math.max(need,bytes.length*2,1024));next.set(bytes);return next;};
function writeAt(file,at,data){file.bytes=grow(file.bytes,at+data.length);file.bytes.set(data,at);file.bytesLength=Math.max(file.bytesLength,at+data.length);}
function writeIndexAndTrailer(file){
  const index=encoder.encode(JSON.stringify(file.index));
  const at=file.space.end;file.space.end=at+index.length+TRAILER;
  writeAt(file,at,index);
  const trailer=new Uint8Array(TRAILER),view=new DataView(trailer.buffer);
  trailer.set(encoder.encode(MAGIC),0);view.setFloat64(4,at);view.setUint32(12,index.length);
  writeAt(file,at+index.length,trailer);
  // 옛 위치표 자리는 새 꼬리가 확정된 뒤에야 빈 공간으로 돌린다.
  if(file.indexAt!=null)file.space.free({at:file.indexAt,size:file.indexSize+TRAILER});
  file.indexAt=at;file.indexSize=index.length;
  file.bytesLength=file.space.end;
}

/** 전체 저장: 머리글 + 덩어리 + 위치표 + 꼬리. 돌려준 file 을 다음 증분 저장에 넘긴다. */
export function encodeFull(doc,{chunkBytes=CHUNK_TARGET_BYTES}={}){
  const file={bytes:new Uint8Array(1024),bytesLength:0,space:createFreeSpace(),index:null,indexAt:null,indexSize:0,chunkOf:new Map(),chunkIds:new Map(),written:0};
  const head=encoder.encode(JSON.stringify(headerOf(doc)));
  const h=file.space.find(head.length);writeAt(file,h.at,head);
  const index={magic:MAGIC,header:{at:h.at,size:head.length,hash:fnv1a(head)},chunks:[],order:[]};
  let next=0;
  for(const group of chunkEntities(doc.entities||[],chunkBytes)){
    const data=encoder.encode(JSON.stringify(group)),slot=file.space.find(data.length),key='c'+(next++);
    writeAt(file,slot.at,data);
    index.chunks.push({key,at:slot.at,size:data.length,hash:fnv1a(data),count:group.length});file.chunkIds.set(key,group.map(e=>e.id));
    index.order.push(key);
    for(const e of group)file.chunkOf.set(e.id,key);
  }
  file.index=index;file.nextKey=next;
  writeIndexAndTrailer(file);
  file.written=file.bytesLength;
  return file;
}

/** 215: 증분 저장. changedIds(바뀐·새 객체)와 removedIds(지운 객체)가 든 덩어리만 다시 쓴다. 위치표는 끝에 한 번. */
export function incrementalSave(file,doc,{changedIds=[],removedIds=[],headerChanged=false,chunkBytes=CHUNK_TARGET_BYTES}={}){
  let written=0;
  const index={...file.index,chunks:file.index.chunks.map(c=>({...c})),order:[...file.index.order]};
  const byKey=new Map(index.chunks.map(c=>[c.key,c])),dirty=new Set(),fresh=[];
  for(const id of [...changedIds,...removedIds]){const key=file.chunkOf.get(id);if(key)dirty.add(key);else if(!removedIds.includes(id))fresh.push(id);}
  const toFree=[];
  if(headerChanged){
    const head=encoder.encode(JSON.stringify(headerOf(doc))),slot=file.space.find(head.length);
    writeAt(file,slot.at,head);written+=head.length;
    toFree.push({at:index.header.at,size:index.header.size});
    index.header={at:slot.at,size:head.length,hash:fnv1a(head)};
  }
  const live=new Map((doc.entities||[]).map(e=>[e.id,e]));
  for(const key of dirty){
    const old=byKey.get(key),oldIds=file.chunkIds.get(key)||[],group=oldIds.filter(id=>live.has(id)).map(id=>live.get(id));
    toFree.push({at:old.at,size:old.size});
    if(!group.length){index.chunks=index.chunks.filter(c=>c.key!==key);index.order=index.order.filter(k=>k!==key);for(const id of oldIds)file.chunkOf.delete(id);file.chunkIds.delete(key);continue;}
    const data=encoder.encode(JSON.stringify(group)),slot=file.space.find(data.length);
    writeAt(file,slot.at,data);written+=data.length;
    Object.assign(byKey.get(key),{at:slot.at,size:data.length,hash:fnv1a(data),count:group.length});file.chunkIds.set(key,group.map(e=>e.id));
    for(const id of oldIds)if(!live.has(id))file.chunkOf.delete(id);
  }
  // 새 객체는 새 덩어리(끝 또는 재사용 구멍)에 문서 순서대로 붙인다.
  const added=fresh.map(id=>live.get(id)).filter(Boolean);
  for(const group of chunkEntities(added,chunkBytes)){
    const data=encoder.encode(JSON.stringify(group)),slot=file.space.find(data.length),key='c'+(file.nextKey++);
    writeAt(file,slot.at,data);written+=data.length;
    index.chunks.push({key,at:slot.at,size:data.length,hash:fnv1a(data),count:group.length});index.order.push(key);file.chunkIds.set(key,group.map(e=>e.id));
    for(const e of group)file.chunkOf.set(e.id,key);
  }
  // 객체 순서(그리기 순서)는 덩어리 순서 + 덩어리 안 순서다. 순서가 바뀐 편집(DRAWORDER 등)은 덩어리로 나타낼 수 없으니 전체 저장한다.
  let k=0;const order=doc.entities||[];
  for(const key of index.order)for(const id of file.chunkIds.get(key)||[]){if(order[k]?.id!==id)return orderFallback(doc,chunkBytes);k++;}
  if(k!==order.length)return orderFallback(doc,chunkBytes);
  file.index=index;
  writeIndexAndTrailer(file);
  written+=file.indexSize+TRAILER;
  for(const hole of toFree)file.space.free(hole);           // 새 위치표가 확정된 뒤에 옛 자리를 돌려준다
  file.written=written;
  return file;
}

const orderFallback=(doc,chunkBytes)=>{const full=encodeFull(doc,{chunkBytes});full.fellBack='order';return full;};
/** 저장(증분 가능하면 증분). 돌려준 {file, mode}. */
export function saveBcad(file,doc,changes={},options={}){
  const mode=chooseSave(file,options);
  if(mode==='full')return {file:encodeFull(doc,options),mode};
  const next=incrementalSave(file,doc,{...changes,...options});
  return {file:next,mode:next.fellBack?'full':'incremental'};
}

/** 바이트 → 문서. 지문이 틀린 덩어리는 빼고 열며 damaged 에 적는다. */
export function decodeBcad(bytes){
  if(bytes.length<TRAILER)throw Error('BCAD 파일이 너무 짧습니다.');
  const trailer=bytes.subarray(bytes.length-TRAILER),view=new DataView(trailer.buffer,trailer.byteOffset,TRAILER);
  if(decoder.decode(trailer.subarray(0,4))!==MAGIC)throw Error('BCAD v3 형식이 아닙니다.');
  const at=view.getFloat64(4),size=view.getUint32(12);
  const index=JSON.parse(decoder.decode(bytes.subarray(at,at+size)));
  const read=({at,size})=>bytes.subarray(at,at+size);
  const head=read(index.header);if(fnv1a(head)!==index.header.hash)throw Error('BCAD 머리글이 손상되었습니다.');
  const doc=JSON.parse(decoder.decode(head)),byKey=new Map(index.chunks.map(c=>[c.key,c])),entities=[],damaged=[];
  for(const key of index.order){
    const chunk=byKey.get(key),data=read(chunk);
    if(fnv1a(data)!==chunk.hash){damaged.push({key,count:chunk.count});continue;}
    entities.push(...JSON.parse(decoder.decode(data)));
  }
  doc.entities=entities;
  return {doc,damaged};
}

/** 저장된 바이트를 다시 열어 다음 증분 저장을 이어 갈 file 상태를 만든다(빈 공간은 쓰는 자리 사이의 틈으로 다시 찾는다). */
export function openBcad(bytes,{disk=null}={}){
  const {doc,damaged}=decodeBcad(bytes);
  if(damaged.length)return {doc,damaged,file:null};          // 손상 파일은 다음 저장을 전체 저장으로(깨진 자리를 다시 쓰지 않는다)
  const trailer=bytes.subarray(bytes.length-TRAILER),view=new DataView(trailer.buffer,trailer.byteOffset,TRAILER);
  const indexAt=view.getFloat64(4),indexSize=view.getUint32(12),index=JSON.parse(decoder.decode(bytes.subarray(indexAt,indexAt+indexSize)));
  const file={bytes:new Uint8Array(bytes),bytesLength:bytes.length,space:createFreeSpace({end:bytes.length}),index,indexAt,indexSize,chunkOf:new Map(),chunkIds:new Map(),written:0,
    nextKey:1+Math.max(-1,...index.order.map(k=>Number(k.slice(1))||0)),lastSavedSize:disk?.size,lastSavedMtime:disk?.mtime};
  let k=0;for(const key of index.order){const c=index.chunks.find(x=>x.key===key),ids=doc.entities.slice(k,k+c.count).map(e=>e.id);k+=c.count;file.chunkIds.set(key,ids);for(const id of ids)file.chunkOf.set(id,key);}
  const used=[{at:index.header.at,size:index.header.size},...index.chunks.map(c=>({at:c.at,size:c.size})),{at:indexAt,size:indexSize+TRAILER}].sort((x,y)=>x.at-y.at);
  let cursor=0;for(const r of used){if(r.at>cursor)file.space.free({at:cursor,size:r.at-cursor});cursor=Math.max(cursor,r.at+r.size);}
  return {doc,damaged,file};
}
/** 파일 바이트(쓴 길이만큼). */
export const fileBytes=file=>file.bytes.subarray(0,file.bytesLength);
