// 201·203·205: 객체 스텁 표 — 객체 1개 = 고정 크기 칸 1개, 본체는 필요할 때만 JS 객체로.
//
// AutoCAD 는 객체마다 16바이트 스텁(포인터 + 상태 비트)을 두고, 본체는 처음 열 때 파일에서 읽는다(201).
// 스텁은 2KB 정렬 블록에 8개 묶음으로 모아 주소만으로 주인을 찾는다(205). 블록 참조의 속성·옛 폴리선 정점 같은
// 하위 객체는 "디스크에 둠" 비트로 본체를 열지 않은 채 둔다(203). 64비트 AutoCAD 는 객체 페이징을 하지 않는다(202).
//
// 바른 CAD 판(더 낫게 한 점):
//  - 칸은 4096개짜리 타입 배열 슬랩(slab)에 둔다. GC 가 따라갈 것은 객체 수십만 개가 아니라 슬랩 수십 개다.
//    칸 번호 >> 12 = 슬랩 번호(AutoCAD 의 `& ~0x7ff` 마스크와 같은 생각, 포인터 대신 정수라 직렬화도 쉽다).
//  - 범위(box)·형식·레이어 번호가 칸에 있어 화면 밖 판정·레이어 끄기·범위 질의를 본체 없이 한다.
//  - 본체는 ArrayBuffer(JS 힙 밖 저장소)에 UTF-8 로 접어 둔다. 접은 본체는 바뀌지 않았을 때만 내려놓는다(데이터 손실 없음).
//  - 지우기는 비트 하나(ERASED). 되돌리기는 같은 비트를 다시 뒤집는다. 칸·핸들은 그대로 남는다.
// 1단계: 표·슬랩·본체 저장소·하위 객체 접기를 독립 모듈로 두고 시험한다. 엔진 문서를 이 표로 바꾸는 일은 남은 단계다.

import {createHandleTable} from './handle-table.js';

export const RESIDENT=1<<14,ON_DISK=1<<8,ERASED=1<<11,MODIFIED=1<<5,LEAVE_ON_DISK=1<<25,SUBENTITY=1<<3;
export const SLAB_SHIFT=12,SLAB_SIZE=1<<SLAB_SHIFT,SLAB_MASK=SLAB_SIZE-1;
export const TYPE_CODES=Object.freeze(['other','line','polyline','circle','arc','text','mtext','dimension','hatch','block','wall','rectangle','ellipse','spline','point','leader','table','image']);
const typeCode=type=>{const i=TYPE_CODES.indexOf(type);return i<0?0:i;};

/** 205: 4096칸 슬랩 저장소. 지운 칸은 자유 목록으로 다시 쓴다. */
export function createSlabStore(){
  const slabs=[],free=[];let next=0,live=0;
  const slab=()=>({flags:new Uint32Array(SLAB_SIZE),type:new Uint8Array(SLAB_SIZE),layer:new Uint16Array(SLAB_SIZE),
    box:new Float64Array(SLAB_SIZE*4),handle:new Uint32Array(SLAB_SIZE),parent:new Int32Array(SLAB_SIZE).fill(-1),bodyAt:new Float64Array(SLAB_SIZE).fill(-1)});
  return {
    alloc(){
      const slot=free.length?free.pop():next++;
      const s=slabs[slot>>SLAB_SHIFT]||(slabs[slot>>SLAB_SHIFT]=slab()),i=slot&SLAB_MASK;
      s.flags[i]=0;s.type[i]=0;s.layer[i]=0;s.handle[i]=0;s.parent[i]=-1;s.bodyAt[i]=-1;s.box.fill(0,i*4,i*4+4);
      live++;return slot;
    },
    release(slot){const s=slabs[slot>>SLAB_SHIFT];if(!s)return;s.flags[slot&SLAB_MASK]=0;free.push(slot);live--;},
    slab(slot){return slabs[slot>>SLAB_SHIFT];},
    get capacity(){return next;},
    get liveCount(){return live;},
    get slabCount(){return slabs.length;},
    /** 슬랩이 잡은 바이트(타입 배열 본체 = JS 힙 밖). */
    get bytes(){return slabs.length*SLAB_SIZE*(4+1+2+32+4+4+8);},
  };
}

/** 본체 저장소: 객체를 UTF-8 JSON 으로 접어 큰 ArrayBuffer 페이지에 이어 붙인다. 위치(at)는 [페이지, 시작, 길이]. */
export function createBodyStore({pageBytes=1<<20}={}){
  const pages=[],encoder=new TextEncoder(),decoder=new TextDecoder();
  const index=[];   // key -> {page,start,length}
  let used=0,wasted=0;
  return {
    put(body){
      const bytes=encoder.encode(JSON.stringify(body));
      let page=pages.at(-1);
      if(!page||page.used+bytes.length>page.buf.length){page={buf:new Uint8Array(Math.max(pageBytes,bytes.length)),used:0};pages.push(page);}
      page.buf.set(bytes,page.used);
      index.push({page:pages.length-1,start:page.used,length:bytes.length});
      page.used+=bytes.length;used+=bytes.length;
      return index.length-1;
    },
    get(key){
      const at=index[key];if(!at)throw Error('본체 위치 없음: '+key);
      const page=pages[at.page];
      return JSON.parse(decoder.decode(page.buf.subarray(at.start,at.start+at.length)));
    },
    /** 옛 본체 자리를 버린다(낭비로만 센다 — 215 의 증분 저장과 같은 계산). */
    discard(key){const at=index[key];if(at){wasted+=at.length;index[key]=null;}},
    get usedBytes(){return used;},
    get wastedBytes(){return wasted;},
    get pageCount(){return pages.length;},
  };
}

/** 201: 스텁 표. boundsOf(entity) → {minX,minY,maxX,maxY}|null 를 받아 범위를 칸에 적는다. */
export function createStubTable({bodies=createBodyStore(),boundsOf=()=>null}={}){
  const slabs=createSlabStore(),handles=createHandleTable(),live=new Map(),children=new Map(),ids=new Map(),idOf=[];
  const layerNames=[],layerIndex=new Map();
  let nextHandle=1;
  const layerNo=name=>{const key=String(name??'');let n=layerIndex.get(key);if(n===undefined){n=layerNames.length;if(n>0xffff)throw Error('레이어가 너무 많습니다.');layerNames.push(key);layerIndex.set(key,n);}return n;};
  const at=slot=>({s:slabs.slab(slot),i:slot&SLAB_MASK});
  const table={
    slabs,handles,bodies,
    /** 객체 하나를 칸에 넣는다. 본체는 메모리에 둔 채(RESIDENT) 시작한다. */
    add(entity,{handle=nextHandle,parent=-1}={}){
      const slot=slabs.alloc(),{s,i}=at(slot);
      handles.set(handle,slot);nextHandle=Math.max(nextHandle,handle+1);
      s.handle[i]=handle;s.type[i]=typeCode(entity?.type);s.layer[i]=layerNo(entity?.layer);s.parent[i]=parent;
      const b=boundsOf(entity);
      if(b&&[b.minX,b.minY,b.maxX,b.maxY].every(Number.isFinite)){s.box[i*4]=b.minX;s.box[i*4+1]=b.minY;s.box[i*4+2]=b.maxX;s.box[i*4+3]=b.maxY;}
      else{s.box[i*4]=Infinity;s.box[i*4+1]=Infinity;s.box[i*4+2]=-Infinity;s.box[i*4+3]=-Infinity;}
      s.flags[i]=RESIDENT|(parent>=0?SUBENTITY:0);
      live.set(slot,entity);
      if(entity?.id){ids.set(entity.id,slot);idOf[slot]=entity.id;}
      if(parent>=0){let list=children.get(parent);if(!list)children.set(parent,list=[]);list.push(slot);}
      return slot;
    },
    slotOfId(id){const slot=ids.get(id);return slot===undefined?-1:slot;},
    slotOfHandle(h){return handles.get(h);},
    flags(slot){const {s,i}=at(slot);return s?s.flags[i]:0;},
    type(slot){const {s,i}=at(slot);return TYPE_CODES[s.type[i]];},
    layer(slot){const {s,i}=at(slot);return layerNames[s.layer[i]];},
    box(slot){const {s,i}=at(slot);return {minX:s.box[i*4],minY:s.box[i*4+1],maxX:s.box[i*4+2],maxY:s.box[i*4+3]};},
    childrenOf(slot){return children.get(slot)||[];},
    /** AcDbStub::openAcDbObject 와 같은 갈림: 메모리에 있으면 바로, 아니면 본체 저장소에서 꺼낸다. 지운 칸은 null. */
    open(slot){
      const {s,i}=at(slot);if(!s)return null;
      const f=s.flags[i];
      if((f&(RESIDENT|ERASED))===RESIDENT)return live.get(slot);
      if(f&ERASED)return null;
      if(!(f&ON_DISK))throw Error('본체 위치 없음');
      const body=bodies.get(s.bodyAt[i]);
      live.set(slot,body);s.flags[i]=f|RESIDENT;
      return body;
    },
    /** 고칠 객체: 열고 MODIFIED 를 켠다(접어 둔 옛 본체는 버린다 — 바뀐 본체를 내려놓다 잃지 않게). */
    openForWrite(slot){
      const body=table.open(slot);if(!body)return null;
      const {s,i}=at(slot);s.flags[i]|=MODIFIED;
      return body;
    },
    /** 본체를 저장소로 접고 메모리에서 내린다. 바뀌었으면 새로 접는다. 지운 칸은 건드리지 않는다. */
    evict(slot){
      const {s,i}=at(slot);if(!s)return false;
      const f=s.flags[i];
      if(!(f&RESIDENT)||(f&ERASED))return false;
      if(!(f&ON_DISK)||(f&MODIFIED)){
        if(f&ON_DISK)bodies.discard(s.bodyAt[i]);
        s.bodyAt[i]=bodies.put(live.get(slot));
      }
      live.delete(slot);s.flags[i]=(f|ON_DISK)&~(RESIDENT|MODIFIED);
      return true;
    },
    /** 212: 지우기·살리기는 비트 하나. 이미 같은 상태면 아무것도 하지 않는다(AcDbImpObject::erase 와 같은 비교). */
    erase(slot,on=true){
      const {s,i}=at(slot);if(!s)return false;
      const was=(s.flags[i]&ERASED)!==0;if(was===on)return false;
      s.flags[i]=on?s.flags[i]|ERASED:s.flags[i]&~ERASED;
      return true;
    },
    /** 203: 부모와 하위 객체의 "디스크에 둠" 상태를 한 번에 바꾼다. 켜면 하위 본체를 내려놓는다(본체는 열지 않는다). */
    leaveSubentsOnDisk(slot,on){
      const {s,i}=at(slot);if(!s)return false;
      const was=(s.flags[i]&LEAVE_ON_DISK)!==0;if(was===on)return false;
      const set=(sl)=>{const p=at(sl);p.s.flags[p.i]=on?p.s.flags[p.i]|LEAVE_ON_DISK:p.s.flags[p.i]&~LEAVE_ON_DISK;};
      set(slot);
      const walk=parent=>{for(const child of children.get(parent)||[]){set(child);if(on)table.evict(child);walk(child);}};
      walk(slot);
      return true;
    },
    /** 범위 질의: 본체를 열지 않고 칸의 범위만 본다. 지운 칸·하위 객체는 뺀다. */
    query(box,{layers=null,includeSub=false}={}){
      const out=[],wanted=layers?new Set([...layers].map(name=>layerIndex.get(String(name))).filter(n=>n!==undefined)):null;
      for(let slot=0;slot<slabs.capacity;slot++){
        const {s,i}=at(slot),f=s.flags[i];
        if(!f||(f&ERASED)||(!includeSub&&(f&SUBENTITY)))continue;
        if(wanted&&!wanted.has(s.layer[i]))continue;
        const o=i*4;
        if(s.box[o]<=box.maxX&&s.box[o+2]>=box.minX&&s.box[o+1]<=box.maxY&&s.box[o+3]>=box.minY)out.push(slot);
      }
      return out;
    },
    stats(){
      let resident=0,onDisk=0,erased=0;
      for(let slot=0;slot<slabs.capacity;slot++){const f=table.flags(slot);if(f&RESIDENT)resident++;if(f&ON_DISK)onDisk++;if(f&ERASED)erased++;}
      return {slots:slabs.liveCount,slabs:slabs.slabCount,resident,onDisk,erased,slabBytes:slabs.bytes,bodyBytes:bodies.usedBytes,wastedBodyBytes:bodies.wastedBytes};
    },
    idOf(slot){return idOf[slot];},
  };
  return table;
}

/** 문서 → 스텁 표. 최상위 객체와 블록 안 하위 객체(재귀)를 칸에 넣는다.
    foldSubentsOver 보다 하위 객체가 많은 블록은 하위 본체를 바로 접어 둔다(203: 화면은 GPU 버퍼·범위로 충분). */
export function buildStubTable(doc,{boundsOf=()=>null,foldSubentsOver=Infinity,bodies}={}){
  const table=createStubTable({boundsOf,bodies});
  const addTree=(entity,parent)=>{
    const slot=table.add(entity,{parent});
    for(const child of Array.isArray(entity?.entities)?entity.entities:[])addTree(child,slot);
    return slot;
  };
  for(const entity of doc?.entities||[]){
    const slot=addTree(entity,-1);
    if((entity?.entities?.length||0)>foldSubentsOver)table.leaveSubentsOnDisk(slot,true);
  }
  return table;
}
