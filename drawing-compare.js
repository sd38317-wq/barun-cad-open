// 625 DWG 비교(DWGCOMPARE): 두 도면에서 한쪽에만 있는 것을 찾아 구름 표시로 묶는다.
// AutoCAD: 객체마다 실제 그리기 호출을 기록·해시해 짝을 맞춘다(AcVDiff). 블록도 펼쳐 그린다.
// 우리: 두 단계.
//   1) 객체 해시(좌표 1e-6 반올림, id·원본 핸들·화면 캐시 제외). 공유 참조는 "정의 해시 + 변환"이라 펼치지 않는다 —
//      같은 블록 1만 개가 있어도 정의를 한 번만 해시한다.
//   2) 1단계에서 짝이 없는 객체만 기본 도형(선·폴리선·호·문자)으로 풀어 다시 맞춘다. 폴리선 ↔ 선 묶음처럼 데이터만 다르고
//      모양이 같은 것은 차이로 치지 않는다.
// 결과 구름은 격자로 묶은 사각형(도면 단위). 순수 함수.
import * as G from './geometry.js';

const SKIP_KEYS=new Set(['id','sourceHandle','sourceFingerprint','group']);
const r6=v=>Math.round(v*1e6)/1e6;
const canonical=value=>{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object'){const out={};for(const key of Object.keys(value).sort()){if(SKIP_KEYS.has(key)||key.startsWith('_'))continue;out[key]=canonical(value[key]);}return out;}
  return typeof value==='number'?r6(value):value;
};
const definitionHashes=new WeakMap();
export function definitionHash(definitions,key){
  let cache=definitionHashes.get(definitions);if(!cache){cache=new Map();definitionHashes.set(definitions,cache);}
  if(cache.has(key))return cache.get(key);
  cache.set(key,'cycle:'+key);
  const definition=definitions?.[key],body=(definition?.entities||[]).map(child=>entityHash(definitions,child));
  const hash='def:'+JSON.stringify([canonical(definition?.origin||{x:0,y:0}),body]);
  cache.set(key,hash);return hash;
}
export function entityHash(definitions,entity,layerName=id=>id){
  if(entity?.sharedBlock){const {sharedBlock,entities,...rest}=entity;return JSON.stringify(['ref',definitionHash(definitions,sharedBlock),canonical({...rest,layer:layerName(entity.layer)}),(entities||[]).map(child=>entityHash(definitions,child,layerName))]);}
  const {entities,...rest}=entity||{};
  return JSON.stringify([canonical({...rest,layer:layerName(entity?.layer)}),(entities||[]).map(child=>entityHash(definitions,child,layerName))]);
}
export function primitiveHash(p,layerName=id=>id){
  const pts=(p.points||[p.center,p.position].filter(Boolean)).map(q=>[r6(q.x),r6(q.y)]);
  if(p.type==='line'||p.type==='polyline'){const a=JSON.stringify(pts),b=JSON.stringify([...pts].reverse());return [p.type==='polyline'&&p.closed?'ring':'path',layerName(p.layer),p.color||'',a<b?a:b].join('|');}
  return [p.type,layerName(p.layer),p.color||'',p.radius!==undefined?r6(p.radius):'',p.text??'',r6(p.startAngle??0),r6(p.endAngle??0),JSON.stringify(pts)].join('|');
}
// 폴리선은 변으로 풀어 "선 묶음"과 같은 모양이면 같게 본다.
function shapeParts(doc,entity){
  let parts;try{parts=G.primitives(entity.sharedBlock?G.materializeSharedDrawingReference(doc,entity):entity);}catch{parts=[entity];}
  const out=[];
  const visit=part=>{if(part?.type==='block'){for(const child of part.entities||[])visit({...child,layer:child.layer??part.layer});return;}if((part.type==='polyline'||part.type==='rectangle')&&Array.isArray(part.points)){for(const [a,b] of G.segments(part)||[])out.push({type:'line',layer:part.layer,color:part.color,points:[a,b]});return;}out.push(part);};
  for(const part of parts)visit(part);
  return out;
}
const boxOf=entity=>{try{return entity._renderBounds||G.bounds([entity]);}catch{return null;}};
export function compareDocs(a,b,{cell=5000,byLayerName=true,detail=true}={}){
  const nameOf=doc=>{const map=new Map((doc.layers||[]).map(layer=>[layer.id,layer.name]));return id=>byLayerName?(map.get(id)??id):id;};
  const la=nameOf(a),lb=nameOf(b);
  const bag=(doc,layerName)=>{const map=new Map();for(const entity of doc.entities||[]){const hash=entityHash(doc.sharedBlocks,entity,layerName);const list=map.get(hash);if(list)list.push(entity);else map.set(hash,[entity]);}return map;};
  const A=bag(a,la),B=bag(b,lb);
  let onlyA=[],onlyB=[],same=0;
  for(const [hash,list] of A){const other=B.get(hash)||[];same+=Math.min(list.length,other.length);if(list.length>other.length)onlyA.push(...list.slice(other.length));}
  for(const [hash,list] of B){const other=A.get(hash)||[];if(list.length>other.length)onlyB.push(...list.slice(other.length));}
  // 2단계: 짝 없는 것만 모양으로 다시 맞춘다.
  if(detail&&onlyA.length&&onlyB.length&&onlyA.length+onlyB.length<=20000){
    const shapes=(doc,list,layerName)=>{const counts=new Map();for(const entity of list){for(const part of shapeParts(doc,entity)){const h=primitiveHash(part,layerName);counts.set(h,(counts.get(h)||0)+1);}}return counts;};
    const SA=shapes(a,onlyA,la),SB=shapes(b,onlyB,lb);
    const covered=(doc,entity,mine,other,layerName)=>shapeParts(doc,entity).every(part=>{const h=primitiveHash(part,layerName);return (other.get(h)||0)>=(mine.get(h)||0);});
    const keepA=onlyA.filter(entity=>!covered(a,entity,SA,SB,la)),keepB=onlyB.filter(entity=>!covered(b,entity,SB,SA,lb));
    same+=onlyA.length-keepA.length;onlyA=keepA;onlyB=keepB;
  }
  const clouds=new Map();
  for(const [side,list] of [['a',onlyA],['b',onlyB]])for(const entity of list){
    const box=boxOf(entity);if(!box)continue;
    const key=`${side}:${Math.floor(box.minX/cell)}:${Math.floor(box.minY/cell)}`,c=clouds.get(key)||{side,box:{...box},count:0};
    c.box={minX:Math.min(c.box.minX,box.minX),minY:Math.min(c.box.minY,box.minY),maxX:Math.max(c.box.maxX,box.maxX),maxY:Math.max(c.box.maxY,box.maxY)};c.count++;clouds.set(key,c);
  }
  return {onlyA,onlyB,same,clouds:[...clouds.values()]};
}
/** 구름(사각형 둘레를 호 모양 마디로) 폴리선. 마디 길이 arc, 바깥으로 pad 만큼 띄운다. */
export function revisionCloud(box,{pad=200,arc=600}={}){
  const x0=box.minX-pad,y0=box.minY-pad,x1=box.maxX+pad,y1=box.maxY+pad,points=[];
  const edge=(a,b)=>{const length=G.dist(a,b),n=Math.max(1,Math.round(length/arc));for(let i=0;i<n;i++){const s=G.add(a,G.mul(G.sub(b,a),i/n)),e=G.add(a,G.mul(G.sub(b,a),(i+1)/n)),mid=G.add(G.mul(G.add(s,e),.5),G.mul(G.normal(G.unit(G.sub(b,a))),-length/n*.25));points.push(s,mid);}};
  edge({x:x0,y:y0},{x:x1,y:y0});edge({x:x1,y:y0},{x:x1,y:y1});edge({x:x1,y:y1},{x:x0,y:y1});edge({x:x0,y:y1},{x:x0,y:y0});
  return {type:'polyline',closed:true,points};
}
