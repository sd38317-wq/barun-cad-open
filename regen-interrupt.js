// 재생성 중단 확인(ACAD200 117).
// AutoCAD 는 재생성 반복 64번마다 사용자 중단을 읽고, 입력 대기 확인은 101ms 가 지났을 때만 한다.
// 우리도 같은 두 겹 거름을 쓴다: 반복 64번에 한 번, 그리고 100ms 에 한 번만 "새 입력이 왔나"를 본다.
// 입력은 화면(canvas)에 단 이벤트가 숫자 하나만 올린다(이벤트마다 일 없음). 입력이 왔으면 무거운 반복은
// 그 단계를 멈추고 다음 프레임에 이어 한다(버리지 않는다: 같은 화면이면 그대로 이어 간다).
export class RegenInterrupt {
  constructor({now=()=>performance.now(),every=64,intervalMs=100}={}){this.now=now;this.every=every;this.intervalMs=intervalMs;this.inputSeq=0;this.seenSeq=0;this.calls=0;this.lastCheck=-Infinity;this.yields=0;}
  noteInput(){this.inputSeq++;}
  // 무거운 반복 안에서 부른다. true 면 지금 멈추고 다음 프레임에 이어 한다.
  shouldYield(){
    if((++this.calls%this.every)!==0)return false;
    const now=this.now();if(now-this.lastCheck<this.intervalMs)return false;
    this.lastCheck=now;const pending=this.inputSeq!==this.seenSeq;this.seenSeq=this.inputSeq;
    if(pending)this.yields++;
    return pending;
  }
  // 반복 하나가 끝날 때 한 번 부르는 가벼운 확인(64번 거름 없이 100ms 거름만).
  inputPending(){
    const now=this.now();if(now-this.lastCheck<this.intervalMs)return false;
    this.lastCheck=now;const pending=this.inputSeq!==this.seenSeq;this.seenSeq=this.inputSeq;
    if(pending)this.yields++;
    return pending;
  }
  attach(target,types=['pointerdown','pointermove','wheel','keydown']){
    // 사람이 낸 입력만 센다: 스크립트가 보낸 이벤트(isTrusted:false, 자동화·품질 검사)는 재생성을 멈출 이유가 아니다.
    const listener=event=>{if(event?.isTrusted!==false)this.inputSeq++;};
    for(const type of types)target?.addEventListener?.(type,listener,{capture:true,passive:true});
    return ()=>{for(const type of types)target?.removeEventListener?.(type,listener,{capture:true});};
  }
}
export const regenInterrupt=new RegenInterrupt();
