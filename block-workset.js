// 606 REFEDIT 작업 세트·중첩 경로 / 608 BEDIT 이름으로 정의 열기.
// AutoCAD REFEDIT: 장기 트랜잭션으로 정의를 꺼내 작업 세트에 넣고, 고른 중첩 경로의 변환을 차례로 곱해(calculateXform) 놓는다.
//   저장(checkIn)은 정의 하나만 바꾸므로 모든 삽입본이 함께 바뀐다.
// 우리: 같은 순서로 경로 행렬을 곱하되, 바깥 블록의 나머지 내용은 "주변(흐리게·잠김)"으로 보여 주고 안쪽 정의만 편집한다.
//   닫을 때 경로 행렬의 역행렬로 로컬 좌표로 되돌려 정의 교체 한 번(shared.define). 바깥 참조는 손대지 않고 되돌려 놓는다.
// 순수 함수: 문서를 고치지 않는다(앱이 명령으로 실행).
import {pathMatrix,invertMatrix,transformByMatrix,referenceMatrix,decomposeMatrix,IDENTITY,composeMatrix} from './shared-blocks.js';

const stripRender=entity=>{const copy={...entity};for(const key of ['_renderBounds','_visibleEntities','_lodCollapsed'])delete copy[key];if(copy.entities)copy.entities=copy.entities.map(stripRender);return copy;};
const uniformPath=(path)=>path.every(ref=>!(ref.scaleX!==undefined&&ref.scaleY!==undefined&&Math.abs(Number(ref.scaleX)-Number(ref.scaleY))>1e-12));

/** 참조 하나 안의 중첩 공유 참조 경로(깊이 우선, 최대 depth 단계). 이름·경로를 돌려준다. 바깥 참조 자신은 [ref]. */
export function nestedPaths(definitions,ref,{depth=3,limit=50}={}){
  const out=[{label:ref.name||ref.sharedBlock,path:[ref]}];
  const walk=(path,level)=>{
    if(level>=depth||out.length>=limit)return;
    const key=path.at(-1).sharedBlock;
    for(const child of definitions?.[key]?.entities||[]){
      if(!child?.sharedBlock||out.length>=limit)continue;
      const next=[...path,child];
      out.push({label:next.map(r=>r.name||r.sharedBlock).join(' › '),path:next});
      walk(next,level+1);
    }
  };
  if(ref?.sharedBlock)walk([ref],0);
  return out;
}
/** 경로의 정의를 편집용으로 펼친다: members(편집 대상, 도면 좌표)와 context(바깥 블록의 나머지, 도면 좌표, 잠김 표시용). */
export function openWorkSet(doc,path){
  if(!path?.length||!path[0].sharedBlock)throw Error('공유 블록 참조를 고르세요.');
  if(!uniformPath(path))throw Error('비균일 축척 블록 안쪽은 아직 제자리 편집할 수 없습니다. 바깥 블록을 편집하세요.');
  if(path.some(ref=>ref.mirror===true))throw Error('대칭된 블록의 안쪽은 아직 제자리 편집할 수 없습니다. 대칭 안 된 삽입본을 고르세요.');
  const definitions=doc.sharedBlocks||{},key=path.at(-1).sharedBlock,definition=definitions[key];
  if(!definition)throw Error('블록 정의를 찾을 수 없습니다: '+key);
  if(definition.xref)throw Error('외부참조 정의는 원본 파일 보호를 위해 직접 편집하지 않습니다.');
  const matrix=pathMatrix(definitions,path);
  const members=definition.entities.map(child=>stripRender(transformByMatrix(structuredClone(child),matrix)));
  // 주변: 경로의 각 단계에서 "다음 단계로 가지 않는" 형제들을 그 단계의 행렬로 놓는다(형제 참조는 참조 그대로).
  const context=[];let m=IDENTITY;
  for(let level=0;level<path.length-1;level++){
    const ref=path[level],origin=definitions[ref.sharedBlock]?.origin||{x:0,y:0};m=composeMatrix(m,referenceMatrix(ref,origin));
    const next=path[level+1];
    for(const child of definitions[ref.sharedBlock]?.entities||[])if(child!==next)context.push(stripRender(transformByMatrix(structuredClone(child),m)));
  }
  for(const child of path[0].entities||[])context.push(stripRender(structuredClone(child)));
  return {key,matrix,members,context,depth:path.length};
}
/** 편집한 객체(도면 좌표)를 정의 로컬 좌표로(경로 행렬의 역). id 는 지운다. */
export function closeWorkSet(workset,edited){
  const inverse=invertMatrix(workset.matrix);
  return edited.map(entity=>{const local=transformByMatrix(stripRender(structuredClone(entity)),inverse);delete local.id;return local;});
}
/** 608 BEDIT: 이름(정의 키)으로 편집을 시작할 대상. 이미 놓인 참조가 있으면 그것, 없으면 원점에 놓을 임시 참조. */
export function beditTarget(doc,key,{at={x:0,y:0},layer}={}){
  const definition=doc.sharedBlocks?.[key];if(!definition)throw Error('블록 정의를 찾을 수 없습니다: '+key);
  const existing=(doc.entities||[]).find(entity=>entity.sharedBlock===key&&!entity.xref&&entity.mirror!==true);
  if(existing)return {ref:existing,temporary:false};
  return {ref:{type:'block',name:definition.name||key,sharedBlock:key,layer:layer??doc.layers?.[0]?.id,position:{x:at.x,y:at.y},scale:1,rotation:0,entities:[]},temporary:true};
}
/** BEDIT 목록: 사용자 정의(외부참조·매개변수 자동 정의 제외)와 참조 수. */
export function editableDefinitions(doc){
  const counts=new Map();for(const entity of doc.entities||[])if(entity.sharedBlock)counts.set(entity.sharedBlock,(counts.get(entity.sharedBlock)||0)+1);
  return Object.entries(doc.sharedBlocks||{}).filter(([key,definition])=>!definition.xref&&!key.startsWith('@')&&!key.startsWith('LIB:')).map(([key,definition])=>({key,name:definition.name||key,count:counts.get(key)||0})).sort((a,b)=>a.name.localeCompare(b.name,'ko',{numeric:true}));
}
export {decomposeMatrix};
