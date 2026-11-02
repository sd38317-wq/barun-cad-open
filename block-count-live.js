// 613 COUNT: 한 번 세고 바뀐 것만 다시 센다(AutoCAD AcCountingMaintainer 와 같은 생각, 우리 구조로).
// 문서 객체는 확정된 뒤 바뀌지 않는다(편집 = 새 객체). 그래서 객체마다 센 결과(중첩 블록 포함)를 WeakMap 에 두면
// 다음 집계에서는 새로 생기거나 바뀐 객체만 다시 훑고, 나머지는 기억한 값을 더하기만 한다.
// 공유 참조 안의 중첩 블록은 정의마다 한 번 센 값(603 sharedDefinitionStats)을 곱한다.
// 정의 묶음이 바뀌면(재정의) 그 묶음 기준으로 객체별 기억을 새로 시작한다.
import {sharedDefinitionStats} from './shared-blocks.js';

function contribution(entity,definitions){
  const out=new Map(),bump=(name,n)=>out.set(name,(out.get(name)||0)+n);
  const visit=e=>{
    if(e?.type!=='block'||e.table)return;
    if(!e.minsert)bump(e.name||'(이름 없음)',1);
    if(e.sharedBlock&&definitions?.[e.sharedBlock])for(const [name,count] of sharedDefinitionStats(definitions,e.sharedBlock).blocks)bump(name,count);
    for(const child of e.entities||[])if(child?.type==='block')visit(child);
  };
  visit(entity);return out;
}
export function createCountMaintainer(){
  let cache=new WeakMap(),definitions,lastEntities=null,lastResult=null,stats={recounted:0,reused:0};
  const read=(doc,{filter=null}={})=>{
    if(doc.sharedBlocks!==definitions){definitions=doc.sharedBlocks;cache=new WeakMap();lastEntities=null;}
    if(!filter&&doc.entities===lastEntities&&lastResult)return lastResult;
    const totals=new Map();stats={recounted:0,reused:0};
    for(const entity of doc.entities||[]){
      if(entity?.type!=='block'||filter&&!filter(entity))continue;
      let part=cache.get(entity);
      if(part)stats.reused++;else{part=contribution(entity,definitions);cache.set(entity,part);stats.recounted++;}
      for(const [name,count] of part)totals.set(name,(totals.get(name)||0)+count);
    }
    const result=[...totals].filter(([,count])=>count>0).sort((a,b)=>a[0].localeCompare(b[0],'ko',{numeric:true})).map(([name,count])=>({name,count}));
    if(!filter){lastEntities=doc.entities;lastResult=result;}
    return result;
  };
  return {read,lastStats:()=>({...stats})};
}
// 앱 전체에서 하나(도면 탭이 바뀌어도 객체 기억은 객체 자신에 붙어 있어 틀리지 않는다).
export const blockCountMaintainer=createCountMaintainer();
