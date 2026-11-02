// 209·211: 되돌리기 한 단계에 "무엇이 바뀌었나"(객체 차이)를 함께 남긴다.
//
// AutoCAD: 객체는 명령 안에서 처음 쓸 때 한 번만 되돌리기 기록에 들어가고(assertWriteEnabled 의 0x20 비트),
// 되돌릴 때는 기록 자체가 바뀐 목록이라 도면 전체를 비교하지 않는다(applyUndo).
//
// 바른 CAD 판: 되돌리기 더미는 지금처럼 불변 문서 스냅숏이다(되돌리기 = 포인터 교환, O(1)). 여기에 단계마다
// 정확한 객체 차이({removed, added} — 객체 포인터 목록)를 붙인다.
//  - 앞으로 실행할 때 화면 갱신에 쓴 차이를 그대로 남기므로 새로 계산하는 비용이 0 이다.
//  - 되돌리기는 차이를 뒤집어(removed↔added) 쓰고, 다시 실행은 그대로 쓴다 — 두 배열을 다시 비교하지 않는다.
//  - 묶음(transaction) 안 여러 명령의 차이는 합성한다: 같은 객체를 여러 번 바꿔도 "처음 본 이전 객체"만 남는다(AutoCAD 0x800000000 비트 역할).
//  - 기록은 문서를 약하게 가리킨다(WeakMap + 일련번호): 되돌리기 더미에서 빠진 옛 문서를 붙잡지 않는다.
//  - 차이를 모르는 단계(전체 동기화 편집)는 null 로 남겨, 쓰는 쪽이 예전 비교로 돌아간다(틀린 차이를 쓰지 않는다).

const serials=new WeakMap();let nextSerial=1;
export const docSerial=doc=>{if(!doc||typeof doc!=='object')return 0;let n=serials.get(doc);if(!n){n=nextSerial++;serials.set(doc,n);}return n;};

export const invertDelta=delta=>delta?{removed:delta.added,added:delta.removed}:null;
export const deltaSize=delta=>delta?delta.removed.length+delta.added.length:0;

/** a 다음 b 를 한 차이로 합친다(객체 포인터 기준). 둘 다 정확하면 결과도 정확하다. 어느 하나가 null 이면 null. */
export function composeDelta(a,b){
  if(!a||!b)return null;
  const aAdded=new Set(a.added),bRemoved=new Set(b.removed);
  // a 가 넣고 b 가 뺀 객체는 서로 지워진다(중간에만 있던 객체). a 가 뺀 객체는 처음 것 그대로 남는다.
  const removed=new Set(a.removed);for(const e of b.removed)if(!aAdded.has(e))removed.add(e);
  const added=new Set();for(const e of a.added)if(!bRemoved.has(e))added.add(e);
  // b 가 처음 문서의 객체를 되살렸으면(a 가 뺀 것을 다시 넣음) 차이가 아니다.
  for(const e of b.added){if(removed.has(e))removed.delete(e);else added.add(e);}
  return {removed:[...removed],added:[...added]};
}

/** 셈 검사: after 길이 = before 길이 - 뺀 수 + 넣은 수. 맞지 않으면 그 차이를 쓰지 않는다. */
export const deltaFits=(before,after,delta)=>!!delta&&Array.isArray(before)&&Array.isArray(after)&&after.length===before.length-delta.removed.length+delta.added.length;

/** 단계 기록. key = 단계가 끝난 문서. 값 = {before: 시작 문서 일련번호, delta, rebuild}. */
export function createHistoryLog({limit=Infinity}={}){
  const steps=new WeakMap();
  return {
    /** before → after 단계의 차이를 남긴다. 너무 큰 차이(limit 초과)는 남기지 않는다(옛 객체를 오래 붙잡지 않게). */
    record(before,after,delta,{rebuild=false}={}){
      if(!before||!after||before===after)return false;
      const kept=delta&&deltaSize(delta)<=limit?{removed:delta.removed.slice(),added:delta.added.slice()}:null;
      steps.set(after,{before:docSerial(before),delta:kept,rebuild:!!rebuild});
      return !!kept;
    },
    /** 이미 남긴 단계에 화면 정책만 덧붙인다(엔진이 먼저 단계를 남기고 화면 쪽이 차이를 채우는 경우). */
    attach(before,after,delta){
      const step=steps.get(after);
      if(!step||step.before!==docSerial(before))return this.record(before,after,delta);
      if(!step.delta&&delta&&deltaSize(delta)<=limit)step.delta={removed:delta.removed.slice(),added:delta.added.slice()};
      return !!step.delta;
    },
    get(after){return steps.get(after)||null;},
    /** from 문서에서 to 문서로 바꿀 때의 차이. 되돌리기(from 이 단계 끝)·다시 실행(to 가 단계 끝) 모두 찾는다. */
    between(from,to){
      const forward=steps.get(to);
      if(forward&&forward.before===docSerial(from))return {delta:forward.delta,rebuild:forward.rebuild,direction:'redo'};
      const backward=steps.get(from);
      if(backward&&backward.before===docSerial(to))return {delta:invertDelta(backward.delta),rebuild:backward.rebuild,direction:'undo'};
      return null;
    },
    forget(after){steps.delete(after);},
  };
}
