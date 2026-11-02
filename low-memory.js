// 206·207: 메모리 부족을 "죽기 전에" 알아채고, 알림 문구는 미리 만들어 둔다.
//
// AutoCAD: 시작할 때 60MB 예비 블록을 잡아 두고(AcDbLowMemReserve), 메모리가 바닥나 예비를 풀어 쓰면 저메모리로 판정한다.
// 명령 시작마다(lmcBeginCmd) 판정을 보고 경고·취소한다. 메모리 부족 문구는 처음 한 번 만들어 두고 다시 쓴다.
//
// 바른 CAD 판(더 낫게 한 점):
//  - 예비 블록을 잡지 않는다. 화면은 V8 이라 한도가 "JS 힙 상한"(약 4GB)이고, ArrayBuffer 예비는 힙 밖이라 풀어도 힙 숨통이
//    트이지 않는다(RSS 만 60MB 낭비). 대신 힙 사용률을 직접 보고, 85% 에서 켜고 75% 아래에서 끄는 두 문턱(되튐 방지)을 둔다.
//  - 판정은 명령 시작 때 한 번, 값 두 개를 읽는 일이라 매 프레임 비용이 없다.
//  - 무거운 명령(대량 복사·배열·분해·붙여넣기)만 막고, 막을 때도 복구본을 먼저 남긴 뒤 이유와 할 일을 한국어로 알린다.
//    설정(lowMemoryGuard=false)으로 끌 수 있다.
//  - 알림 문구는 모듈을 읽을 때 만들어 둔다(바닥난 순간에 문자열을 새로 만들지 않는다, getOutOfMemoryMessage 와 같은 생각).

export const LOW_MEMORY_ON=0.85,LOW_MEMORY_OFF=0.75,FLUSH_INTERVAL_MS=60_000;
export const HEAVY_COMMANDS=Object.freeze(new Set(['COPY','ARRAY','ARRAYRECT','ARRAYPOLAR','ARRAYPATH','EXPLODE','PASTECLIP','PASTEORIG','INSERT','XREF','XATTACH','IMPORT']));
export const LOW_MEMORY_MESSAGES=Object.freeze({
  warn:'메모리가 거의 찼습니다. 지금 저장해 두세요. (복구본은 방금 남겼습니다)',
  blocked:'메모리가 부족해 이 명령을 멈췄습니다. 저장한 뒤 도면을 닫았다 다시 열면 메모리가 비워집니다. (복구본은 방금 남겼습니다)',
  recovered:'메모리 여유가 다시 생겼습니다.',
  crashed:'메모리가 부족해 도면 화면이 닫혔습니다. 다시 열면 마지막 복구본에서 이어갈 수 있습니다.',
});

/** 힙 사용률(0~1). performance.memory 가 없는 곳(Node 시험·다른 브라우저)은 0. */
export function heapRatio(memory=globalThis.performance?.memory){
  const used=Number(memory?.usedJSHeapSize),limit=Number(memory?.jsHeapSizeLimit);
  return used>0&&limit>0?used/limit:0;
}

/** 두 문턱 판정기. read() 는 사용률을 돌려준다(시험에서 바꿔 끼운다). */
export function createLowMemoryMonitor({read=()=>heapRatio(),on=LOW_MEMORY_ON,off=LOW_MEMORY_OFF}={}){
  let low=false,lastRatio=0,changedAt=0,count=0;
  return {
    lastFlushAt:-Infinity,
    /** 지금 저메모리인가. 상태가 바뀌면 changed 가 true. */
    check(now=Date.now()){
      const ratio=read();lastRatio=ratio;
      const before=low;
      if(!low&&ratio>=on)low=true;
      else if(low&&ratio<off)low=false;
      if(before!==low){changedAt=now;count++;}
      return {low,ratio,changed:before!==low};
    },
    get low(){return low;},
    get ratio(){return lastRatio;},
    get transitions(){return count;},
    get changedAt(){return changedAt;},
  };
}

const defaultMonitor=createLowMemoryMonitor();
export const isLowMemDetected=()=>defaultMonitor.check().low;

/** 명령 시작 때 부른다. false 면 명령을 실행하지 않는다.
    deps: {toast(text,error), flushRecovery(), enabled, monitor} */
export function lowMemCheck(name,{toast=()=>{},flushRecovery=()=>{},enabled=true,monitor=defaultMonitor,now=Date.now()}={}){
  if(!enabled)return true;
  const {low,changed}=monitor.check(now);
  if(!low){if(changed)toast(LOW_MEMORY_MESSAGES.recovered,false);return true;}
  // 복구본을 먼저 남긴다(기다리지 않는다 — 명령 입력을 붙잡지 않게). 저메모리 동안 1분에 한 번까지만.
  if(changed||now-monitor.lastFlushAt>=FLUSH_INTERVAL_MS){monitor.lastFlushAt=now;try{const pending=flushRecovery();pending?.catch?.(()=>{});}catch{}}
  if(HEAVY_COMMANDS.has(String(name||'').toUpperCase())){toast(LOW_MEMORY_MESSAGES.blocked,true);return false;}
  if(changed)toast(LOW_MEMORY_MESSAGES.warn,true);
  return true;
}
