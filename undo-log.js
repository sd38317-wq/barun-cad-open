// 208: 되돌리기 기록을 32KB 페이지에 쌓고, 메모리 예산을 넘으면 오래된 페이지부터 저장소로 내린다.
//
// AutoCAD: 되돌리기 기록은 32KB(0x8000) 페이지 + 머리로 잡고(afpager::allocPage), 쓰는 메모리를 세어 두었다가
// 넘치면 임시 파일로 내보낸다. 임시 파일은 실제로 쓸 일이 생겼을 때만 연다(openUndoFile).
//
// 바른 CAD 판(더 낫게 한 점):
//  - 단계 수(지금 100단계)가 아니라 메모리 예산으로 자른다. 작은 편집 1만 번은 다 남고, 거대한 편집 몇 번은 예산만큼만 남는다.
//  - 저장소(backend)는 실제로 내릴 때 처음 쓴다(AutoCAD 처럼 지연 생성). IndexedDB·파일·메모리 Map 어느 것이든 put/get/delete 만 있으면 된다.
//  - 내린 페이지가 저장소에서 사라져도(지운 브라우저 저장소 등) 남은 기록은 계속 쓸 수 있고, 잃은 단계 수를 알려 준다(조용한 손실 없음).
//  - 기록은 뒤에서 앞으로 읽는다(applyUndo 와 같은 순서). 페이지 안 기록 = [길이 4바이트][UTF-8 JSON].
// 1단계: 기록 장치 자체. 엔진의 되돌리기 더미(문서 스냅숏)를 이 기록으로 바꾸는 일은 남은 단계다(history-delta.js 의 차이 기록이 그 재료).

export const UNDO_PAGE_BYTES=32768;
const encoder=new TextEncoder(),decoder=new TextDecoder();

export function createUndoLog({backend=null,memoryBudget=256<<20,pageBytes=UNDO_PAGE_BYTES,prefix='undo/'}={}){
  const pages=[];               // {buf:Uint8Array|null, used, count, key:string|null}
  let memUsed=0,spilled=0,lost=0,spilling=Promise.resolve();
  const newPage=size=>{const page={buf:new Uint8Array(Math.max(pageBytes,size)),used:0,count:0,key:null};pages.push(page);memUsed+=page.buf.length;return page;};
  const recordsOf=buf=>{const out=[],view=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);let at=0;while(at+4<=buf.length){const n=view.getUint32(at);if(!n||at+4+n>buf.length)break;out.push(JSON.parse(decoder.decode(buf.subarray(at+4,at+4+n))));at+=4+n;}return out;};
  const log={
    /** 기록 하나를 붙인다. record 는 JSON 으로 바꿀 수 있는 값({op, ids, before} 등). */
    append(record){
      const bytes=encoder.encode(JSON.stringify(record));
      let page=pages.at(-1);
      if(!page||!page.buf||page.used+bytes.length+4>page.buf.length)page=newPage(bytes.length+4);
      new DataView(page.buf.buffer).setUint32(page.used,bytes.length);
      page.buf.set(bytes,page.used+4);page.used+=bytes.length+4;page.count++;
      if(memUsed>memoryBudget)spilling=spilling.then(()=>log.spillOldest()).catch(()=>{});
      return pages.length-1;
    },
    /** 메모리에 있는 가장 오래된 페이지(마지막 페이지 제외)를 저장소로 내린다. 저장소가 없으면 그 페이지를 버린다(예산 우선). */
    async spillOldest(){
      const page=pages.slice(0,-1).find(p=>p.buf);if(!page)return false;
      const data=page.buf.slice(0,page.used);
      page.buf=null;memUsed-=Math.max(pageBytes,data.length);
      if(backend){page.key=prefix+(spilled++);await backend.put(page.key,data);}
      else{lost+=page.count;page.count=0;page.key=null;}
      return true;
    },
    /** 마지막 기록을 꺼낸다(되돌리기). 내린 페이지는 저장소에서 다시 읽는다. */
    async pop(){
      while(pages.length){
        const page=pages.at(-1);
        if(!page.buf&&page.key){
          const data=await backend?.get(page.key);
          await backend?.delete?.(page.key);
          if(!data){lost+=page.count;pages.pop();continue;}
          page.buf=new Uint8Array(data);page.key=null;memUsed+=Math.max(pageBytes,page.buf.length);
        }
        if(!page.buf||!page.count){pages.pop();continue;}
        const records=recordsOf(page.buf.subarray(0,page.used));
        const last=records.pop();
        // 남은 기록만 다시 담는다(페이지 안 순서 보존).
        let used=0;const view=new DataView(page.buf.buffer,page.buf.byteOffset);
        for(const r of records){const b=encoder.encode(JSON.stringify(r));view.setUint32(used,b.length);page.buf.set(b,used+4);used+=b.length+4;}
        page.used=used;page.count=records.length;
        if(!page.count){memUsed-=page.buf.length;pages.pop();}
        return last;
      }
      return undefined;
    },
    /** 뒤에서 앞으로 모든 기록(시험·복구 확인용). 내린 페이지도 읽는다. */
    async *reverse(){
      for(let p=pages.length-1;p>=0;p--){
        const page=pages[p];let buf=page.buf?page.buf.subarray(0,page.used):null;
        if(!buf&&page.key){const data=await backend?.get(page.key);if(!data)continue;buf=new Uint8Array(data);}
        if(!buf)continue;
        const records=recordsOf(buf);for(let i=records.length-1;i>=0;i--)yield records[i];
      }
    },
    /** 진행 중인 내리기를 기다린다. */
    flush(){return spilling;},
    stats(){return {pages:pages.length,inMemory:pages.filter(p=>p.buf).length,onDisk:pages.filter(p=>!p.buf&&p.key).length,memUsed,lost,records:pages.reduce((n,p)=>n+p.count,0)};},
    /** 모두 버린다(새 도면·불러오기). 저장소의 페이지도 지운다. */
    async clear(){for(const page of pages)if(page.key)await backend?.delete?.(page.key);pages.length=0;memUsed=0;lost=0;},
  };
  return log;
}
