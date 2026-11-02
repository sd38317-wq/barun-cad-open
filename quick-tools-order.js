/* 왼쪽 빠른 작도 띠의 버튼 순서(구분선으로 나뉜 묶음 배열).
   저장된 순서를 믿지 않는다: 모르는 명령은 버리고, 빠진 기본 명령은 원래 묶음 끝에 되살린다. */
export const QUICK_TOOLS_ORDER_KEY='barun-quick-tools-order-v1';

export function orderedQuickGroups(defaults,saved){
 const known=new Set(defaults.flat()),seen=new Set();
 const groups=defaults.map(()=>[]);
 if(Array.isArray(saved)&&saved.length===defaults.length){
  saved.forEach((names,index)=>{
   if(!Array.isArray(names))return;
   for(const name of names)if(known.has(name)&&!seen.has(name)){seen.add(name);groups[index].push(name);}
  });
 }
 defaults.forEach((names,index)=>{for(const name of names)if(!seen.has(name)){seen.add(name);groups[index].push(name);}});
 return groups;
}

/** 버튼 하나를 다른 버튼 앞(before) 또는 뒤로, 혹은 묶음 끝(target 없음)으로 옮긴 새 배열. */
export function moveQuickTool(groups,name,{group,target=null,before=true}){
 if(target===name)return groups;
 const next=groups.map(names=>names.filter(item=>item!==name));
 const list=next[group];if(!list)return groups;
 const at=target==null?list.length:list.indexOf(target);
 list.splice(at<0?list.length:at+(before?0:1),0,name);
 return next;
}
