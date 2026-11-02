// 그리기 순서(DRAWORDER) 바꾸기의 증명과 깊이 배정(ACAD200 120).
// AutoCAD 는 순서 변경을 대기열에 모았다가 그리기 스레드에서 한 번에 반영한다.
// 우리는 "같은 객체들을 맨 앞/맨 뒤로 옮겼을 뿐"임을 포인터 비교 한 번(O(n), 숫자 비교 없음)으로
// 증명하고, 옮긴 원본의 깊이(z)만 바꾼다. 장면을 다시 만들지 않는다. 증명이 안 되면 null.

// after 가 before 에서 ids 의 객체를 (서로의 순서를 지킨 채) 맨 앞(front) 또는 맨 뒤(back)로 옮긴 것인지.
export function proveDrawOrderMove(before,after,ids,position){
  if(!Array.isArray(before)||!Array.isArray(after)||before.length!==after.length||!ids?.size)return false;
  if(position!=='front'&&position!=='back')return false;
  const n=ids.size,moving=[],rest=[];
  for(const entity of before)(ids.has(entity?.id)?moving:rest).push(entity);
  if(moving.length!==n)return false;
  const expected=position==='front'?[...rest,...moving]:[...moving,...rest];
  for(let i=0;i<after.length;i++)if(after[i]!==expected[i])return false;
  return true;
}
// 앱 쪽: 두 배열이 같은 객체를 순서만 바꿔 담았고, 그 변화가 맨 앞/맨 뒤 이동인지 알아낸다.
// 아니면 {reordered:false} 또는 지원하지 않는 순서 변경이면 {reordered:true,move:null}.
export function detectDrawOrderMove(before,after){
  if(before===after||!Array.isArray(before)||!Array.isArray(after)||before.length!==after.length)return {reordered:false};
  let first=0;while(first<before.length&&before[first]===after[first])first++;
  if(first===before.length)return {reordered:false};
  const set=new Set(before);for(const entity of after)if(!set.has(entity))return {reordered:false};
  // 맨 뒤로(front): after 의 끝 부분이 옮긴 객체들. 맨 앞(back): after 의 앞부분.
  // 같은 결과를 두 방법으로 설명할 수 있으면(하나를 뒤로 = 나머지를 앞으로) 적게 옮기는 쪽을 고른다.
  let best=null;
  for(const position of ['front','back']){
    const ids=new Set();
    if(position==='front'){
      // before[first] 가 after 의 끝 쪽으로 갔다. after 끝에서부터, before 에서 first 이후에 있던 객체들을 모은다.
      const at=after.indexOf(before[first]);if(at<0)continue;
      for(let i=at;i<after.length;i++)ids.add(after[i].id);
    }else{
      const at=before.indexOf(after[first]);if(at<0)continue;
      for(let i=first;i<after.length&&after[i]!==before[first];i++)ids.add(after[i].id);
    }
    if(ids.size&&ids.size<before.length&&(!best||ids.size<best.ids.length)&&proveDrawOrderMove(before,after,ids,position))best={ids:[...ids],position};
  }
  return {reordered:true,move:best};
}
// 옮길 원본들의 새 깊이. spans: [{id,first,last}] (문서 순서). 원본 안의 간격은 그대로 두고 통째로 민다.
// front 는 top 위로, back 은 bottom 아래로 1e-5 씩 띄워 쌓는다. 한도를 넘으면 null(전체 재구성).
export function drawOrderOffsets(spans,position,{top=1,bottom=0,gap=1e-5,maxTop=2,minBottom=-50}={}){
  const offsets=new Map();
  if(position==='front'){
    let at=top;
    for(const s of spans){const start=at+gap;offsets.set(s.id,start-s.first);at=start+(s.last-s.first);}
    return at<maxTop?{offsets,top:at,bottom}:null;
  }
  let need=0;for(const s of spans)need+=gap+(s.last-s.first);
  let at=bottom-need;if(at<=minBottom)return null;
  const lowest=at;
  for(const s of spans){offsets.set(s.id,at-s.first);at+=(s.last-s.first)+gap;}
  return {offsets,top,bottom:lowest};
}
// app.js execute() 용: 방금 실행이 "같은 객체의 순서만 바꿈"이면 화면 캐시 delta 를 버리고(순서가 바뀌었으니
// 보이는 목록·집기 색인은 다시 만든다) GPU 에는 깊이만 바꾸는 편집을 준다. 맨 앞/맨 뒤가 아니거나
// 아직 그리지 않은 편집이 남아 있으면 GPU 편집은 null(전체 재구성: 예전과 같은 길).
// delta 가 같은 객체들의 빼기·더하기(포인터 diff 가 순서 변경을 이렇게 본다)이거나 비어 있을 때만 배열을 훑는다.
export function drawOrderGpuEdit({before,after,delta,pending=null,previousDoc,previousRevision}){
  if(!delta||before===after||before?.length!==after?.length)return null;
  const {removed=[],added=[]}=delta;
  if(removed.length!==added.length)return null;
  if(removed.length){const set=new Set(added);for(const entity of removed)if(!set.has(entity))return null;}
  const found=detectDrawOrderMove(before,after);
  if(!found.reordered)return null;
  const gpuEdit=found.move&&!pending?.lightweight?{previousDoc,previousRevision,lightweight:true,removed:[],added:[],drawOrder:found.move}:null;
  return {gpuEdit,move:found.move};
}
