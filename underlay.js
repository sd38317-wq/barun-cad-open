// 620 PDF·이미지 밑그림(UNDERLAY).
// AutoCAD: 밑그림은 객체를 만들지 않는 참조(경로·쪽·위치·축척·클립·흐리기). PDF 는 래스터로 그리고, 스냅은 PDF 벡터로 한다.
// 우리 1단계: PDF 한 쪽의 벡터를 공유 정의 하나로 두고(되돌리기 기록에 안 실림, 화면은 참조처럼 범위·LOD 로 걸러짐)
//   참조 하나(underlay 표시)로 놓는다. 밑그림 레이어는 출력하지 않고(plot:false) 흐린 색이다. 스냅·XCLIP·이동·축척은 블록과 같다.
//   AutoCAD 보다 나은 점: 처음부터 스냅이 되고(벡터), 같은 PDF 쪽을 여러 번 붙여도 정의 하나.
// 2단계(래스터 타일)용 계산: 확대 단계·보이는 타일·LRU 캐시는 여기 순수 함수로 둔다(GPU 텍스처 그리기는 남은 일).

export const UNDERLAY_LAYER={name:'밑그림',color:'#7f8a96',lineweight:0.13,plot:false};
export const underlayKey=source=>`underlay:${String(source.name||'PDF')}#${Number(source.page)||1}`;
/** PDF 벡터(도면 좌표, 왼쪽 아래가 원점 근처) → 정의 하나 + 참조 하나. 모든 자식은 밑그림 레이어로, 색은 레이어를 따른다. */
export function underlayDefinition(entities,source,layerId){
  if(!entities?.length)throw Error('밑그림으로 쓸 벡터가 없습니다(스캔 PDF 는 아직 지원하지 않습니다).');
  const recolor=entity=>{const {id,color,aci,colorMode,...rest}=entity;const copy={...rest,layer:layerId};if(entity.entities)copy.entities=entity.entities.map(recolor);return copy;};
  return {key:underlayKey(source),definition:{name:`밑그림 ${source.name||'PDF'} ${Number(source.page)||1}쪽`,origin:{x:0,y:0},entities:entities.map(recolor),underlay:{kind:source.kind||'pdf',name:source.name||'',page:Number(source.page)||1}}};
}
export function underlayReference(key,definition,{position={x:0,y:0},scale=1,rotation=0,layer,fade=50}={}){
  return {type:'block',name:definition.name,sharedBlock:key,layer,position:{x:position.x,y:position.y},scale,rotation,entities:[],underlay:{...definition.underlay,fade}};
}

/* ── 2단계 래스터 타일 계산 ── */
/** 화면 1 px 에 도면 몇 단위가 보이느냐로 확대 단계(2 의 거듭제곱). 너무 잘게 나누지 않게 0~maxLevel. */
export function tileLevel(pixelsPerUnit,scale=1,maxLevel=6){
  const k=Math.max(1e-12,pixelsPerUnit*scale);
  return Math.max(0,Math.min(maxLevel,Math.ceil(Math.log2(k))));
}
/** 밑그림 범위(도면 좌표) 중 화면 상자와 겹치는 타일 번호. tileUnits = 타일 한 변의 도면 길이. */
export function visibleTileIndices(bounds,view,tileUnits,limit=4096){
  if(!bounds||!view||!(tileUnits>0))return [];
  const minX=Math.max(bounds.minX,view.minX),minY=Math.max(bounds.minY,view.minY),maxX=Math.min(bounds.maxX,view.maxX),maxY=Math.min(bounds.maxY,view.maxY);
  if(minX>maxX||minY>maxY)return [];
  const out=[];
  for(let ix=Math.floor((minX-bounds.minX)/tileUnits);ix<=Math.floor((maxX-bounds.minX)/tileUnits);ix++)
    for(let iy=Math.floor((minY-bounds.minY)/tileUnits);iy<=Math.floor((maxY-bounds.minY)/tileUnits);iy++){out.push({ix,iy});if(out.length>=limit)return out;}
  return out;
}
/** 타일 비트맵 LRU. 넘치면 가장 오래 안 쓴 것을 닫는다(close 가 있으면). */
export function createTileCache(max=256){
  const map=new Map();
  return {
    get(key){if(!map.has(key))return undefined;const value=map.get(key);map.delete(key);map.set(key,value);return value;},
    set(key,value){map.delete(key);map.set(key,value);while(map.size>max){const [oldKey,old]=map.entries().next().value;map.delete(oldKey);old?.close?.();}},
    get size(){return map.size;},
    clear(){for(const value of map.values())value?.close?.();map.clear();},
  };
}
