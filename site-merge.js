import * as G from './geometry.js';

export const MERGE_TOLERANCE_PCT=3;
export const SNAP_MM=20;
// 기본 24개 중 추가 3개 조합(2324개)은 모두 보고, 더 큰 요청은 일부만 본다.
const MAX_VISITED_STATES=2500;
const MAX_EDGE_COMPARISONS=20000;
const boundary=e=>e?.type==='polyline'&&e.closed===true&&['site','neighbor'].includes(e.parcelRole)&&e.attributes?.pnu;
function checkedRing(points){
 if(!Array.isArray(points)||points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw Error('필지 경계 좌표가 올바르지 않습니다.');
 const ps=points.length>1&&points[0].x===points.at(-1).x&&points[0].y===points.at(-1).y?points.slice(0,-1):points;
 if(new Set(ps.map(p=>`${p.x},${p.y}`)).size<3)throw Error('경계에는 서로 다른 점이 세 개 이상 필요합니다.');
 return ps;
}
export function parcelGroups(entities){
 const groups=new Map();
 for(const entity of entities||[]){
  if(!boundary(entity))continue;
  const a=entity.attributes,points=checkedRing(entity.points),hole=a.ring==='hole';
  let group=groups.get(a.pnu);
  if(!group){group={pnu:a.pnu,jibun:a.jibun||'',role:entity.parcelRole,areaM2:0,rings:[],clipped:false};groups.set(a.pnu,group);}
  if(entity.parcelRole==='site')group.role='site';
  if(!group.jibun&&a.jibun)group.jibun=a.jibun;
  group.areaM2+=(hole?-1:1)*Math.abs(G.polygonArea(points))/1e6;
  group.rings.push({points,hole,entity});group.clipped||=a.clippedToContext===true;
 }
 return groups;
}

// 투영 구간으로 자른 두 끝점의 거리로 판단한다. 길이도 양방향 평균으로 대칭이다.
export function sharedEdgeLengthM(pointsA,pointsB,tolMm=SNAP_MM){
 const a=checkedRing(pointsA),b=checkedRing(pointsB);let length=0;
 if(!Number.isFinite(tolMm)||tolMm<0)throw Error('경계 거리 허용값이 올바르지 않습니다.');
 const clipped=(p,q,r,s)=>{
  const dx=q.x-p.x,dy=q.y-p.y,la=Math.hypot(dx,dy);if(!la)return 0;
  const ux=dx/la,uy=dy/la,t=(r.x-p.x)*ux+(r.y-p.y)*uy,u=(s.x-p.x)*ux+(s.y-p.y)*uy;
  const lo=Math.max(0,Math.min(t,u)),hi=Math.min(la,Math.max(t,u));if(hi<=lo)return 0;
  const at=v=>{const f=(v-t)/(u-t);return {x:r.x+f*(s.x-r.x),y:r.y+f*(s.y-r.y)};};
  const first=at(lo),last=at(hi),distance=v=>Math.abs((v.x-p.x)*uy-(v.y-p.y)*ux);
  return distance(first)<=tolMm&&distance(last)<=tolMm?Math.hypot(last.x-first.x,last.y-first.y):0;
 };
 for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){
  const p=a[i],q=a[(i+1)%a.length],r=b[j],s=b[(j+1)%b.length];
  const ab=clipped(p,q,r,s);if(!ab)continue;
  const ba=clipped(r,s,p,q);if(ba)length+=(ab+ba)/2;
 }
 return length/1000;
}
export function ledgerMismatch(cadastralM2,ledgerM2,tolPct=MERGE_TOLERANCE_PCT){
 if(!Number.isFinite(ledgerM2)||ledgerM2<=0)return {mismatch:false,diffPct:null};
 const diffPct=(cadastralM2-ledgerM2)/ledgerM2*100;
 return {mismatch:Math.abs(diffPct)>tolPct,diffPct};
}
function siteGroups(groups){
 const sites=[...groups.values()].filter(g=>g.role==='site');
 if(!sites.length)throw Error('현재 대지 필지가 없습니다.');
 return sites;
}
export function mergeCandidates(entities,{ledgerM2,tolerancePct=MERGE_TOLERANCE_PCT,maxExtra=3,minSharedM=0.5,maxPool=24,limit=5}={}){
 if(!Number.isFinite(tolerancePct)||tolerancePct<0||!Number.isFinite(minSharedM)||minSharedM<0||
  [maxExtra,maxPool,limit].some(n=>!Number.isInteger(n)||n<0))throw Error('필지 조합 탐색 옵션이 올바르지 않습니다.');
 maxExtra=Math.min(maxExtra,5);
 const groups=parcelGroups(entities),sites=siteGroups(groups),siteAreaM2=sites.reduce((sum,g)=>sum+g.areaM2,0);
 const result={sitePnus:sites.map(g=>g.pnu),siteAreaM2,ledgerM2,...ledgerMismatch(siteAreaM2,ledgerM2,tolerancePct),candidates:[],skipped:[]};
 const neighbors=[];
 for(const g of groups.values())if(g.role==='neighbor'){
  if(g.clipped)result.skipped.push({pnu:g.pnu,jibun:g.jibun,reason:'주변 범위에서 잘린 필지입니다.'});
  else if(g.areaM2<=0)result.skipped.push({pnu:g.pnu,jibun:g.jibun,reason:'면적이 양수가 아닌 필지입니다.'});
  else neighbors.push(g);
 }
 const upper=ledgerM2*(1+tolerancePct/100);
 if(!result.mismatch||!maxExtra||!maxPool||!limit||siteAreaM2>upper)return result;
 const bounds=g=>{
  const box={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};
  for(const r of g.rings)for(const p of r.points){box.minX=Math.min(box.minX,p.x);box.maxX=Math.max(box.maxX,p.x);box.minY=Math.min(box.minY,p.y);box.maxY=Math.max(box.maxY,p.y);}
  return box;
 };
 let edgeChecks=0,edgeLimit=false;
 const pieces=new Map([...sites,...neighbors].map(g=>[g,g.rings.filter(r=>!r.hole)]));
 const boxes=new Map([...pieces.values()].flat().map(r=>[r,bounds({rings:[r]})])),cache=new Map();
 const adjacentPiece=(a,b)=>{
  if(edgeLimit)return false;
  let row=cache.get(a);if(row?.has(b))return row.get(b);
  const x=boxes.get(a),y=boxes.get(b);let length=0;
  if(x.minX<=y.maxX+SNAP_MM&&x.maxX+SNAP_MM>=y.minX&&x.minY<=y.maxY+SNAP_MM&&x.maxY+SNAP_MM>=y.minY){
   // 공유 변 계산도 화면에서 실행되므로 조합 수와 별도로 총 변 비교를 제한한다.
   const cost=a.points.length*b.points.length;
   if(edgeChecks+cost>MAX_EDGE_COMPARISONS){result.truncated=true;edgeLimit=true;return false;}
   edgeChecks+=cost;length=sharedEdgeLengthM(a.points,b.points);
  }
  const yes=length>0&&length>=minSharedM;
  if(!row){row=new Map();cache.set(a,row);}row.set(b,yes);
  if(!cache.has(b))cache.set(b,new Map());cache.get(b).set(a,yes);return yes;
 };
 const adjacent=(a,b)=>pieces.get(a).some(ra=>pieces.get(b).some(rb=>adjacentPiece(ra,rb)));
 // 여러 대지를 시작점으로 한 너비 우선 탐색: 가까운 이웃부터 풀에 넣는다.
 const pool=[],queue=[...sites],added=new Set();
 for(let head=0;head<queue.length&&pool.length<maxPool&&!edgeLimit;head++)for(const g of neighbors){
  if(added.has(g)||!adjacent(queue[head],g))continue;
  added.add(g);pool.push(g);queue.push(g);if(pool.length===maxPool)break;
 }
 if(edgeLimit)return result;
 const all=[...sites,...pool],graph=all.map(()=>new Set()),rootCount=sites.length;
 for(let i=0;i<all.length&&!edgeLimit;i++)for(let j=i+1;j<all.length&&!edgeLimit;j++)if(adjacent(all[i],all[j])){graph[i].add(j);graph[j].add(i);}
 if(edgeLimit)return result;
 // 필지 간 그래프는 탐색용이다. 최종 후보는 바깥 고리 조각 모두가 이어져야 한다.
 const fragments=all.flatMap((g,owner)=>pieces.get(g).map(r=>({r,owner}))),pieceGraph=fragments.map(()=>[]);
 for(let i=0;i<fragments.length&&!edgeLimit;i++)for(let j=i+1;j<fragments.length&&!edgeLimit;j++)if(adjacentPiece(fragments[i].r,fragments[j].r)){pieceGraph[i].push(j);pieceGraph[j].push(i);}
 if(edgeLimit)return result;
 const roots=sites.map((_,i)=>i),seen=new Set();let stopped=false;
 const connected=chosen=>{
  const allowed=new Set([...roots,...chosen]),visited=new Set([0]),walk=[0];
  const count=fragments.reduce((n,f)=>n+Number(allowed.has(f.owner)),0);
  for(let head=0;head<walk.length;head++)for(const j of pieceGraph[walk[head]])if(allowed.has(fragments[j].owner)&&!visited.has(j)){visited.add(j);walk.push(j);}
  return visited.size===count;
 };
 function expand(chosen,areaM2){
  if(stopped)return;
  if(chosen.length){
   const key=pool.length<=30?chosen.reduce((mask,i)=>mask|(1<<(i-rootCount)),0):chosen.slice().sort((a,b)=>a-b).join(',');if(seen.has(key))return;
   if(seen.size>=MAX_VISITED_STATES){result.truncated=true;stopped=true;return;}seen.add(key);
   const {mismatch,diffPct}=ledgerMismatch(areaM2,ledgerM2,tolerancePct);
   if(!mismatch&&connected(chosen)){
    const ordered=chosen.slice().sort((a,b)=>a-b);
    result.candidates.push({pnus:ordered.map(i=>all[i].pnu),parcels:ordered.map(i=>({pnu:all[i].pnu,jibun:all[i].jibun,areaM2:all[i].areaM2})),areaM2,diffPct});
   }
  }
  if(chosen.length>=maxExtra)return;
  const frontier=new Set();
  for(const i of [...roots,...chosen])for(const j of graph[i])if(j>=rootCount&&!chosen.includes(j))frontier.add(j);
  for(const j of frontier){if(stopped)break;const sum=areaM2+all[j].areaM2;if(sum<=upper)expand([...chosen,j],sum);}
 }
 expand([],siteAreaM2);
 result.candidates.sort((a,b)=>Math.abs(a.diffPct)-Math.abs(b.diffPct)||a.pnus.length-b.pnus.length);
 result.candidates=result.candidates.slice(0,limit);return result;
}

function selection(entities,pnus,includeSites=false){
 const groups=parcelGroups(entities),sites=siteGroups(groups);
 if(!Array.isArray(pnus))throw Error('합칠 필지 목록이 올바르지 않습니다.');
 // 이미 합친 대지의 원래 필지 번호도 현재 외곽 하나로 해석한다.
 const byPnu=new Map(groups);
 for(const group of sites)for(const ring of group.rings)for(const pnu of ring.entity.attributes.sitePnus||[])
  if(!byPnu.has(pnu))byPnu.set(pnu,group);
 for(const pnu of pnus)if(!byPnu.has(pnu))throw Error(`합칠 필지를 찾을 수 없습니다: ${pnu}`);
 const selected=[...new Set([...(includeSites?sites:[]),...pnus.map(pnu=>byPnu.get(pnu))])];
 return {sites,selected};
}
export function mergeRings(entities,pnus){
 const {selected}=selection(entities,pnus),result=[];
 // 합친 외곽은 서버의 스냅/반올림 결과다. 재합필은 보존한 실제 원본에서 다시 계산한다.
 // 원본이 누락된 이전 저장본은 일부 필지만 복원하지 않고 현재 외곽 전체를 유지한다.
 const sourcePnus=new Set(selected.flatMap(g=>g.rings.filter(r=>r.entity.attributes.mergedSite===true).flatMap(r=>r.entity.attributes.sitePnus||[])));
 const originals=parcelGroups(entities.filter(e=>e.parcelRole==='site-original'&&!e.attributes?.mergedSite&&sourcePnus.has(e.attributes?.pnu)).map(e=>({...e,parcelRole:'site'})));
 const restored=[],seen=new Set();
 for(const group of selected){
  const merged=group.rings.every(r=>r.entity.attributes.mergedSite===true),pnus=[...new Set(group.rings.flatMap(r=>r.entity.attributes.sitePnus||[]))];
  const sources=merged&&pnus.length&&pnus.every(p=>originals.get(p)?.rings.some(r=>!r.hole))?pnus.map(p=>originals.get(p)):[group];
  for(const source of sources)if(!seen.has(source.pnu)){seen.add(source.pnu);restored.push(source);}
 }
 for(const group of restored){
  const polygons=new Map();
  for(const ring of group.rings){
   const a=ring.entity.attributes,key=JSON.stringify([a.polygon??0,a.contextPart??0]);
   if(!polygons.has(key))polygons.set(key,[]);polygons.get(key).push(ring);
  }
  for(const rings of polygons.values()){
   const outers=rings.filter(r=>!r.hole).map(r=>({ring:r,data:{pnu:group.pnu,outer:r.points.map(p=>[p.x,p.y]),holes:[]}}));
   for(const hole of rings.filter(r=>r.hole)){
    const outer=outers.filter(o=>G.inside(hole.points[0],o.ring.points)).sort((a,b)=>G.polygonArea(a.ring.points)-G.polygonArea(b.ring.points))[0];
    if(!outer)throw Error('구멍을 포함하는 필지 바깥 경계가 없습니다.');
    outer.data.holes.push(hole.points.map(p=>[p.x,p.y]));
   }
   result.push(...outers.map(o=>o.data));
  }
 }
 return result;
}
export function mergedSiteEntity(entities,{pnus,ring,ledgerM2=null,now=()=>new Date().toISOString()}){
 const {selected}=selection(entities,pnus,true);
 if(!Array.isArray(ring)||ring.some(p=>!Array.isArray(p)||p.length!==2))throw Error('합친 대지 경계 좌표가 올바르지 않습니다.');
 const points=checkedRing(ring.map(([x,y])=>({x,y}))),first=entities.find(e=>boundary(e)&&e.parcelRole==='site'&&e.attributes.ring!=='hole');
 if(!first)throw Error('현재 대지의 바깥 경계가 없습니다.');
 const provenance=new Map();
 for(const group of selected)for(const r of group.rings){
  const a=r.entity.attributes,pnus=a.sitePnus||[group.pnu],jibuns=a.siteJibuns||[group.jibun];
  pnus.forEach((p,i)=>{if(!provenance.has(p))provenance.set(p,jibuns[i]||p);});
 }
 const attributes=structuredClone(first.attributes);
 for(const key of ['id','layer','contextPart','clippedToContext'])delete attributes[key];
 if(Array.isArray(attributes.originMetres)&&attributes.originMetres.length===2&&attributes.originMetres.every(Number.isFinite)){
  // 서버는 첫 점을 원점 기준으로 쓰므로, 합집합이 시작점을 바꾼 만큼 기준도 옮긴다.
  const at=Array.isArray(attributes.insertionMm)&&attributes.insertionMm.length===2&&attributes.insertionMm.every(Number.isFinite)
   ?attributes.insertionMm:[first.points[0].x,first.points[0].y];
  attributes.originMetres=attributes.originMetres.map((v,i)=>v+([points[0].x,points[0].y][i]-at[i])/1000);
  attributes.insertionMm=[points[0].x,points[0].y];
 }
 return {type:'polyline',closed:true,points:points.map(p=>({...p})),parcelRole:'site',attributes:{...attributes,ring:'outer',polygon:0,pnu:first.attributes.pnu,
  jibun:`${provenance.values().next().value||''}${provenance.size>1?` 외 ${provenance.size-1}필지`:''}`,sitePnus:[...provenance.keys()],siteJibuns:[...provenance.values()],mergedSite:true,ledgerAreaM2:ledgerM2,mergedAt:now()}};
}
export function mergeSiteCommand(entities,options){
 const {selected}=selection(entities,options.pnus,true),targets=selected.flatMap(g=>g.rings.map(r=>r.entity));
 if(targets.some(e=>!e.id))throw Error('아직 도면에 그리지 않은 필지 경계가 있습니다.');
 let layer=targets.find(e=>e.parcelRole==='neighbor'&&e.layer)?.layer??entities.find(e=>e.parcelRole==='neighbor'&&e.layer)?.layer;
 const prepare=[];
 if(Array.isArray(options.layers)){
  const original=options.layers.find(l=>l.name==='A-SITE-PARCEL');
  if(original&&(original.locked||original.frozen||!original.visible))throw Error('A-SITE-PARCEL 레이어를 표시·해동·잠금 해제한 뒤 합치세요.');
  layer=original?.id||crypto.randomUUID();
  if(!original)prepare.push({type:'layer.add',id:layer,name:'A-SITE-PARCEL',color:'#9a9a9a',lineweight:0.18});
 }
 const originals=targets.filter(e=>!e.attributes?.mergedSite),intermediate=targets.filter(e=>e.attributes?.mergedSite);
 return {type:'batch',commands:[...prepare,
  ...(originals.length?[{type:'updateMany',updates:originals.map(e=>({id:e.id,changes:{parcelRole:'site-original',...(layer?{layer}:{})}}))}]:[]),
  ...(intermediate.length?[{type:'delete',ids:intermediate.map(e=>e.id)}]:[]),
  {type:'parcel.import',entities:[mergedSiteEntity(entities,options)]},
  // 확인값은 보존하되 면적·건축선·북측의 이전 판정은 새 대지 기준 확인 전까지 중단한다.
  ...(options.siteAnalysis?[{type:'site.analyze',analysis:{...structuredClone(options.siteAnalysis),needsSiteReview:true}}]:[])]};
}
export function mergeFetchedEntities(entities,options){
 const {selected}=selection(entities,options.pnus,true),targets=new Set(selected.flatMap(g=>g.rings.map(r=>r.entity)));
 return [mergedSiteEntity(entities,options),...entities.filter(e=>!(targets.has(e)&&e.attributes?.mergedSite)).map(e=>targets.has(e)?{...e,parcelRole:'site-original'}:e)];
}
