// 편집 종류 비트(ACAD200 103). AutoCAD 의 MergeChanges 처럼 "모양이 바뀜"과 "색만 바뀜"을 따로 표시한다.
// 색만 바뀐 편집은 형상(점 배열)을 다시 계산하지 않고 기존 레코드를 새 색 배치로 옮긴다
// (CadGpuRenderer.restyleSources). 비교는 바뀐 객체 한 쌍의 자기 키만 본다: 도면 전체를 훑지 않는다.
export const GPU_EDIT=Object.freeze({GEOM:1,STYLE:2,ORDER:4});

// 그리기 모양에 영향이 없는 키(선택·이름표 등)는 무시한다.
const IGNORED=new Set(['id','sourceHandle','sourceFingerprint','name','label','note','attributes']);
// 색만(형상·선종류·두께 그대로) 바꾸는 키. 이 키들만 다르면 STYLE.
export const COLOR_KEYS=new Set(['color','aci','colorMode','transparency']);
const STYLE_KEYS=new Set([...COLOR_KEYS,'layer','linetype','linetypeScale','lineweight']);

const same=(a,b)=>a===b||(typeof a==='object'&&typeof b==='object'&&a&&b&&JSON.stringify(a)===JSON.stringify(b));
// 두 객체의 변경 비트와 바뀐 키 목록. 같은 객체(포인터)는 ORDER(다시 표시만).
export function classifyEntityChange(before,after){
  if(!before||!after)return {mask:GPU_EDIT.GEOM,keys:[]};
  if(before===after)return {mask:GPU_EDIT.ORDER,keys:[]};
  if(before.type!==after.type||before.id!==after.id)return {mask:GPU_EDIT.GEOM,keys:['type']};
  const keys=[];let mask=0;
  for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
    if(IGNORED.has(key)||key.startsWith('_'))continue;
    if(same(before[key],after[key]))continue;
    keys.push(key);mask|=STYLE_KEYS.has(key)?GPU_EDIT.STYLE:GPU_EDIT.GEOM;
  }
  return {mask,keys};
}
// 같은 프레임에 온 편집들의 비트를 원본 id 별로 OR 로 합친다.
export function mergeEditMasks(pending,current){
  const masks=new Map(pending||[]);
  for(const [id,mask] of current||[])masks.set(id,(masks.get(id)||0)|mask);
  return masks;
}
// removed·added 짝(같은 id)이 모두 "색만 바뀜"이면 id → 새 객체 표를 준다. 아니면 null.
export function colorOnlyPairs(removed,added,limit=4096){
  if(!removed.length||removed.length!==added.length||removed.length>limit)return null;
  const before=new Map(removed.map(e=>[e.id,e]));if(before.size!==removed.length)return null;
  const pairs=new Map();
  for(const entity of added){
    const old=before.get(entity.id);if(!old||old===entity)return null;
    const {mask,keys}=classifyEntityChange(old,entity);
    if(mask!==GPU_EDIT.STYLE||!keys.every(key=>COLOR_KEYS.has(key)&&key!=='transparency'))return null;
    pairs.set(entity.id,{before:old,after:entity});
  }
  return pairs;
}
