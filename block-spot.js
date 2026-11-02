// 615 BLOCKSPOT/BCONVERT: 펼쳐진 반복 도형(분해된 세대 평면, 상세 사본)을 찾아 공유 블록 정의 1개 + 참조로 바꾼다.
// AutoCAD 는 묶음마다 썸네일 이미지를 그려 이미지끼리 비교한다(AcBlockSpot compareTwoImages).
// 우리는 그림 없이 결정적으로 한다: (1) 묶음 서명(종류별 개수·크기 정규화 2차 모멘트·길이 분포)으로 후보를 모으고
// (2) 회전·대칭·축척 후보 변환을 실제로 적용해 객체 하나하나가 맞는지 확인한 뒤에만 바꾼다(잘못 묶어 도형이 바뀌는 일 없음).
// 결과는 엔진 명령 묶음 하나(되돌리기 한 번). 순수 함수, 화면 경로에서 부르지 않는다.
import * as G from './geometry.js';
import {localizeEntities,sharedTemplate} from './shared-blocks.js';

const SKIP=new Set(['wall']);
export function featurePoints(e){
  if(e.type==='circle')return [e.center];
  if(e.type==='arc')return [e.center,G.add(e.center,G.polar(e.radius,e.startAngle)),G.add(e.center,G.polar(e.radius,e.endAngle))];
  if(e.type==='ellipse')return [e.center,G.add(e.center,e.majorAxis)];
  if(e.type==='text'||e.type==='point')return [e.position];
  if(e.type==='block'&&e.sharedBlock)return [e.position];
  if(Array.isArray(e.points))return e.points;
  return G.vertices(e)||[];
}
const boxOf=e=>{try{return G.bounds([e]);}catch{return null;}};
/** 묶음 찾기: 범위가 gap 안으로 닿는 객체끼리 한 묶음(격자 해시, 거의 선형). group 이름이 있으면 그 이름이 묶음이다. */
export function findClusters(entities,{gap=1}={}){
  const items=entities.filter(e=>e&&!SKIP.has(e.type)&&!e.hostWall&&!e.xref);
  const parent=items.map((_,i)=>i),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;},join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a;};
  const named=new Map();items.forEach((e,i)=>{if(e.group){if(named.has(e.group))join(named.get(e.group),i);else named.set(e.group,i);}});
  const boxes=items.map(boxOf),sizes=boxes.filter(Boolean).map(b=>Math.max(b.maxX-b.minX,b.maxY-b.minY)).sort((a,b)=>a-b);
  const cell=Math.max(gap*4,sizes[Math.floor(sizes.length/2)]||1),grid=new Map();
  boxes.forEach((b,i)=>{
    if(!b||items[i].group)return;
    for(let gx=Math.floor((b.minX-gap)/cell);gx<=Math.floor((b.maxX+gap)/cell);gx++)for(let gy=Math.floor((b.minY-gap)/cell);gy<=Math.floor((b.maxY+gap)/cell);gy++){
      const key=gx+','+gy,list=grid.get(key);
      if(list){for(const j of list){const o=boxes[j];if(b.minX-gap<=o.maxX&&o.minX-gap<=b.maxX&&b.minY-gap<=o.maxY&&o.minY-gap<=b.maxY)join(i,j);}list.push(i);}else grid.set(key,[i]);
    }
  });
  const clusters=new Map();items.forEach((e,i)=>{const root=find(i);if(!clusters.has(root))clusters.set(root,[]);clusters.get(root).push(e);});
  return [...clusters.values()];
}
const r4=v=>Math.round(v*1e4)/1e4;
/** 이동·회전·축척에 거의 무관한 서명. 같은 서명이어도 실제 변환 확인 전에는 바꾸지 않는다. */
export function clusterSignature(entities){
  const pts=entities.flatMap(featurePoints);if(pts.length<2)return null;
  const cx=pts.reduce((s,p)=>s+p.x,0)/pts.length,cy=pts.reduce((s,p)=>s+p.y,0)/pts.length;
  let mxx=0,myy=0,mxy=0;for(const p of pts){const x=p.x-cx,y=p.y-cy;mxx+=x*x;myy+=y*y;mxy+=x*y;}
  const s2=(mxx+myy)/pts.length;if(!(s2>1e-12))return null;
  const det=(mxx*myy-mxy*mxy)/(pts.length**2)/(s2*s2);
  const kinds={};for(const e of entities)kinds[e.type]=(kinds[e.type]||0)+1;
  const s=Math.sqrt(s2);
  const lens=entities.filter(e=>e.type==='line').map(e=>r4(G.dist(e.points[0],e.points[1])/s)).sort((a,b)=>a-b);
  const radii=entities.filter(e=>e.radius).map(e=>r4(e.radius/s)).sort((a,b)=>a-b);
  const texts=entities.filter(e=>e.type==='text').map(e=>e.text).sort();
  return JSON.stringify([Object.keys(kinds).sort().map(k=>[k,kinds[k]]),pts.length,r4(det),lens,radii,texts]);
}
function frame(entities){
  const pts=entities.flatMap(featurePoints),n=pts.length;
  const c={x:pts.reduce((s,p)=>s+p.x,0)/n,y:pts.reduce((s,p)=>s+p.y,0)/n};
  let mxx=0,myy=0,mxy=0;for(const p of pts){const x=p.x-c.x,y=p.y-c.y;mxx+=x*x;myy+=y*y;mxy+=x*y;}
  return {c,s:Math.sqrt((mxx+myy)/n),angle:0.5*Math.atan2(2*mxy,mxx-myy)*180/Math.PI,size:Math.sqrt(mxx+myy)};
}
// 참조 변환과 같은 식: 로컬(대칭이면 x 반전) × 축척 → 회전 → +위치.
const placer=({mirror,scale,rotation,position})=>{const r=rotation*Math.PI/180,c=Math.cos(r),s=Math.sin(r);return p=>{const x=p.x*scale*(mirror?-1:1),y=p.y*scale;return {x:position.x+x*c-y*s,y:position.y+x*s+y*c};};};
function sameEntities(local,target,transform,tolerance){
  const used=new Set();
  for(const e of local){
    const pts=featurePoints(e).map(transform);
    const hit=target.findIndex((t,i)=>{
      if(used.has(i)||t.type!==e.type)return false;
      if(e.radius!==undefined&&Math.abs(e.radius*transform.scale-t.radius)>tolerance)return false;
      if(e.type==='text'&&e.text!==t.text)return false;
      const tp=featurePoints(t);if(tp.length!==pts.length)return false;
      if(pts.every((p,k)=>G.dist(p,tp[k])<=tolerance))return true;
      // 대칭이면 호의 시작·끝이 바뀐다.
      if(t.type==='arc'&&G.dist(pts[0],tp[0])<=tolerance&&G.dist(pts[1],tp[2])<=tolerance&&G.dist(pts[2],tp[1])<=tolerance)return true;
      // 닫힌 폴리선·선은 시작점·방향이 달라도 같은 모양이다.
      if(Array.isArray(t.points)&&pts.length>1){const rev=[...tp].reverse();if(pts.every((p,k)=>G.dist(p,rev[k])<=tolerance))return true;if(t.closed){for(let shift=1;shift<tp.length;shift++)for(const list of [tp,rev])if(pts.every((p,k)=>G.dist(p,list[(k+shift)%list.length])<=tolerance))return true;}}
      return false;
    });
    if(hit<0)return false;used.add(hit);
  }
  return used.size===target.length;
}
/** A(로컬, 원점=무게중심)를 B 로 옮기는 변환을 찾는다. 주축 각도 ±180·±90, 대칭 여부를 모두 시험한다. */
export function matchTransform(localA,frameA,entitiesB,frameB){
  const scale=frameB.s/frameA.s,tolerance=Math.max(1e-3,frameB.size*1e-6);
  for(const mirror of [false,true])for(const turn of [0,90,180,270]){
    const base=mirror?(frameB.angle+frameA.angle):(frameB.angle-frameA.angle);
    const rotation=((base+turn)%360+360)%360,transform=placer({mirror,scale,rotation,position:frameB.c});transform.scale=scale;
    if(sameEntities(localA,entitiesB,transform,tolerance))return {mirror,scale,rotation,position:frameB.c};
  }
  return null;
}
/** 반복 묶음 찾기 → 바꿀 계획. min 개 이상 같은 모양이 있는 묶음만. */
export function planBlockSpot(entities,{gap=1,min=2,name='반복',minEntities=2,existing={}}={}){
  const clusters=findClusters(entities,{gap}).filter(list=>list.length>=minEntities);
  const bySignature=new Map();
  for(const list of clusters){const signature=clusterSignature(list);if(!signature)continue;if(!bySignature.has(signature))bySignature.set(signature,[]);bySignature.get(signature).push(list);}
  const groups=[];let index=1;
  for(const lists of bySignature.values()){
    if(lists.length<min)continue;
    const remaining=[...lists];
    while(remaining.length>=min){
      const first=remaining.shift(),fa=frame(first),local=localizeEntities(first,fa.c),members=[{entities:first,transform:{mirror:false,scale:1,rotation:0,position:fa.c}}],rest=[];
      for(const other of remaining){const t=matchTransform(local,fa,other,frame(other));if(t)members.push({entities:other,transform:t});else rest.push(other);}
      remaining.length=0;remaining.push(...rest);
      if(members.length<min)continue;
      let key=`${name}${index++}`;while(existing[key])key=`${name}${index++}`;
      groups.push({key,definition:{name:key,origin:{x:0,y:0},entities:local},members});
    }
  }
  return {groups,converted:groups.reduce((n,g)=>n+g.members.length,0),removed:groups.reduce((n,g)=>n+g.members.reduce((m,x)=>m+x.entities.length,0),0)};
}
/** 계획 → 엔진 명령(지우기 + 정의·참조 추가). */
export function blockSpotCommand(plan,layer){
  if(!plan.groups.length)return null;
  const ids=[],definitions={},templates=[],refs=[];
  for(const group of plan.groups){
    definitions[group.key]=group.definition;templates.push(sharedTemplate(group.key));
    for(const member of group.members){
      ids.push(...member.entities.map(e=>e.id));
      const t=member.transform,ref={type:'block',name:group.key,sharedBlock:group.key,layer:layer??member.entities[0].layer,position:{x:t.position.x,y:t.position.y},scale:t.scale,rotation:t.rotation,entities:[]};
      if(t.mirror)ref.mirror=true;refs.push(ref);
    }
  }
  return {type:'batch',commands:[{type:'delete',ids},{type:'shared.add',definitions,templates,entities:refs}]};
}
/** 616 교체 추천: 서명이 가까운 정의 순서(같은 종류 구성·모멘트). */
export function similarDefinitions(definitions,key,limit=5){
  const sig=s=>{try{return JSON.parse(s);}catch{return null;}};
  const target=sig(clusterSignature(definitions[key]?.entities||[]));if(!target)return [];
  const distance=other=>{if(!other)return Infinity;let d=JSON.stringify(other[0])===JSON.stringify(target[0])?0:10;d+=Math.abs(other[1]-target[1])/Math.max(1,target[1]);d+=Math.abs(other[2]-target[2]);return d;};
  return Object.keys(definitions).filter(k=>k!==key).map(k=>({key:k,name:definitions[k].name||k,distance:distance(sig(clusterSignature(definitions[k].entities||[])))})).filter(x=>Number.isFinite(x.distance)).sort((a,b)=>a.distance-b.distance).slice(0,limit);
}
