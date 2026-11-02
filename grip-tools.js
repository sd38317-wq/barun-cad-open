// ACAD200 영역 3 — 그립 보조(307~310). 그립 수 한도, 그립 집기 색인, 폴리선 구간 가운데 그립, 여러 뜨거운 그립.
import {createPackedBoundsIndex} from './packed-bounds-index.js';

// 307. 그립 개수 한도(AutoCAD GRIPOBJLIMIT=100). 넘으면 그립을 그리지도 집지도 않는다.
// Ctrl+A(수천 개 선택) 직후 매 프레임 그립 수만 개를 그리던 비용이 0 이 된다. 0 이면 한도 없음(예전 동작).
export const GRIP_OBJ_LIMIT_DEFAULT=100;
export function gripsShown(count,limit=GRIP_OBJ_LIMIT_DEFAULT){
  if(!(count>0))return false;
  const n=Number(limit);
  if(n===0)return true;
  return count<=Math.max(1,Math.min(32767,Number.isFinite(n)?n:GRIP_OBJ_LIMIT_DEFAULT));
}

// 309. 폴리선·사각형의 구간 가운데 그립(kind 'segment'). 끌면 그 구간을 평행 이동(양 끝 꼭짓점 신축),
// 메뉴로 정점 추가. 정점 그립 메뉴에는 정점 삭제. G.editingGrips 는 그대로 두고 덧붙이기만 한다.
export function segmentGrips(e){
  if(!e||!['polyline','rectangle'].includes(e.type)||e.drawingSet||e.lineWallHost)return [];
  const ps=e.points||[];if(ps.length<2)return [];
  const closed=e.closed||e.type==='rectangle',n=closed?ps.length:ps.length-1,out=[];
  for(let i=0;i<n;i++){const a=ps[i],b=ps[(i+1)%ps.length];out.push({kind:'segment',index:i,point:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}});}
  return out;
}
/** 그립 메뉴 항목 이름(그립 종류별). 빈 배열이면 메뉴 없음. */
export function gripMenuOps(entity,grip){
  if(grip?.kind==='segment')return entity?.type==='polyline'?['stretch','add-vertex']:['stretch'];
  if(grip?.kind==='vertex'&&entity?.type==='polyline'){
    const min=entity.closed?3:2;return (entity.points?.length||0)>min?['stretch','remove-vertex']:['stretch'];
  }
  return [];
}
export const GRIP_OP_LABELS={stretch:'신축','add-vertex':'정점 추가','remove-vertex':'정점 삭제'};
/** segment·vertex 그립의 확장 동작 명령. 해당 없으면 null(호출자가 G.gripCommand 를 쓴다). */
export function extendedGripCommand(e,grip,point,op='stretch'){
  if(!e||!grip||!point||!Number.isFinite(point.x)||!Number.isFinite(point.y))return null;
  const ps=e.points||[];
  if(grip.kind==='segment'){
    const i=grip.index,j=(i+1)%ps.length;
    if(op==='add-vertex'){
      if(e.type!=='polyline')throw Error('정점 추가는 폴리선에서만 됩니다.');
      const points=ps.map(q=>({x:q.x,y:q.y}));points.splice(i+1,0,{x:point.x,y:point.y});
      return {type:'update',ids:[e.id],changes:{points}};
    }
    return {type:'stretch',targets:[{id:e.id,indices:[...new Set([i,j])]}],dx:point.x-grip.point.x,dy:point.y-grip.point.y};
  }
  if(grip.kind==='vertex'&&op==='remove-vertex'){
    if(e.type!=='polyline')return null;
    const min=e.closed?3:2;if(ps.length<=min)throw Error('폴리선의 최소 정점 수보다 줄일 수 없습니다.');
    const points=ps.filter((_,index)=>index!==grip.index).map(q=>({x:q.x,y:q.y}));
    return {type:'update',ids:[e.id],changes:{points}};
  }
  return null;
}

// 308. 그립 집기: 고른 객체의 그립 점으로 압축 R-tree(createPackedBoundsIndex)를 선택·도면이 바뀔 때 한 번 만들고,
// 클릭·호버 때는 커서 둘레 상자만 질의한다(AutoCAD get_a_grip 의 R-tree). 판정: 화면 상자 |dx|,|dy| ≤ 반경 안에서 가장 가까운 것.
// 반경은 마우스 8px(그리는 네모 10px 보다 조금 넉넉히), 펜 10px, 손가락 16px.
export function gripPickRadiusPx(pointerType='mouse'){return pointerType==='touch'?16:pointerType==='pen'?10:8;}
export class GripIndex {
  constructor(){this.key=null;this.list=[];this.index=null;}
  /** key 가 같으면 다시 만들지 않는다. collect() 는 [{entity,grip}] 를 돌려준다. */
  ensure(key,collect){
    if(this.key===key&&this.index)return this;
    const list=collect();
    this.list=list;this.key=key;
    this.index=createPackedBoundsIndex(list.length,i=>{const q=list[i].grip.point;return {minX:q.x,minY:q.y,maxX:q.x,maxY:q.y};});
    return this;
  }
  invalidate(){this.key=null;this.index=null;this.list=[];}
  /** world: 커서 도면 좌표, pixel: 화면 좌표, screen: 도면→화면, scale: 화면px/도면단위, radiusPx: 화면 반경. */
  at(world,pixel,screen,scale,radiusPx=8){
    if(!this.index||!this.list.length)return null;
    const r=radiusPx/scale;let best=null,bestD=Infinity;
    for(const i of this.index.query({minX:world.x-r,minY:world.y-r,maxX:world.x+r,maxY:world.y+r})){
      const s=screen(this.list[i].grip.point),dx=Math.abs(s.x-pixel.x),dy=Math.abs(s.y-pixel.y),d=dx*dx+dy*dy;
      // 같은 거리면 꼭짓점 그립이 가운데 그립을 이긴다(짧은 구간에서 겹칠 때).
      if(dx<=radiusPx&&dy<=radiusPx&&(d<bestD||(d===bestD&&best?.grip.kind==='segment'&&this.list[i].grip.kind!=='segment'))){bestD=d;best=this.list[i];}
    }
    return best;
  }
}

// 310. 여러 그립을 뜨겁게(Shift+그립 클릭) 해서 한꺼번에 늘리기. 엔진 stretch 명령은 이미 targets 여러 개를 받는다.
export class HotGrips {
  constructor(){this.map=new Map();this.revision=null;}
  get size(){let n=0;for(const s of this.map.values())n+=s.size;return n;}
  clear(){this.map.clear();}
  /** 선택이 바뀌었으면(리비전 다름) 비운다. */
  sync(revision){if(this.revision!==revision){this.revision=revision;this.map.clear();}}
  has(id,index){return !!this.map.get(id)?.has(index);}
  toggle(entityId,grip){
    if(grip?.kind!=='vertex')return false;
    const set=this.map.get(entityId)??new Set();
    if(set.has(grip.index))set.delete(grip.index);else set.add(grip.index);
    if(set.size)this.map.set(entityId,set);else this.map.delete(entityId);
    return true;
  }
  /** 뜨거운 그립 하나를 끌 때의 신축 명령. 끄는 그립도 포함. 뜨거운 그립이 없거나 vertex 가 아니면 null. */
  command(drag,point){
    if(!this.map.size||drag?.grip?.kind!=='vertex')return null;
    if(!this.has(drag.id,drag.grip.index))return null;
    const targets=[...this.map].map(([id,set])=>({id,indices:[...set].sort((a,b)=>a-b)}));
    return {type:'stretch',targets,dx:point.x-drag.grip.point.x,dy:point.y-drag.grip.point.y};
  }
}
