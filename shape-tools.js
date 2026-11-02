// 도형 및 선 미연결 16개: 3TP 2DP BOO BS CBJ JUL PAA PBB PEC PET PJ PW PWD UFD XLD ZIGZAG.
// 근거: docs/izzarder-reference-20260921/references/14-shape-line.md (PET·ZIGZAG·PEC·XLD·PAA·PBB·2DP·JUL·PJ·PW·PWD·CBJ)
//       izzarder.com 원문 WebFetch(PVL/PBS/PBB/PBM 절 안에 PBB 있음): /548(3TP) /382(UFD). BOO 는 전용 글이 없어(업그레이드 changelog 에만
//       "폴리선 객체합치기/빼기" 로 언급) changelog 문구를 근거로 옮겼다 — 자세한 대화상자 설명은 원문에 없다.
// 3TP(3D폴리선 없음)·XLD(Xline 없음, 긴 line 으로 대신)는 바른 CAD 객체 구조상 그대로 만들 수 없어 한계를 토스트/보고서에 적었다.
// BS·PAA·ZIGZAG는 원문에 그림있는 대화상자(DCL)가 있으나, 저장형 카드(WAL·문·창)와 달리 1회성 값 입력이라
// ctx.form(작은 폼, 체크박스로 방식 선택)으로 옵션을 줄여 옮겼다 — 아이콘 그리드 30종·조건부 활성화 등은 생략(보고서에 기록).
import * as G from './geometry.js';
import {STD_LAYERS,resolveLayers,wallFrame,builder} from './card-kit.js';

const isClosed=e=>e.type==='rectangle'||!!e.closed;
const clonePts=pts=>pts.map(p=>({x:p.x,y:p.y}));

/* ── 경로 길이/위치. PAA·UFD·JUL 이 함께 쓴다. ── */
export function pathLength(pts){let L=0;for(let i=1;i<pts.length;i++)L+=G.dist(pts[i-1],pts[i]);return L;}
export function pointAtLength(pts,s){
 if(pts.length<2)throw Error('점이 2개 이상 필요합니다.');
 if(s<=0)return {point:pts[0],dir:G.unit(G.sub(pts[1],pts[0]))};
 let acc=0;
 for(let i=1;i<pts.length;i++){
  const seg=G.dist(pts[i-1],pts[i]);
  if(acc+seg>=s-1e-9){const t=seg<G.EPS?0:(s-acc)/seg;return {point:G.add(pts[i-1],G.mul(G.sub(pts[i],pts[i-1]),t)),dir:G.unit(G.sub(pts[i],pts[i-1]))};}
  acc+=seg;
 }
 return {point:pts.at(-1),dir:G.unit(G.sub(pts.at(-1),pts.at(-2)))};
}

/* ══ 2DP: 도형 안 객체를 다른 도형에 비추기 (평균값 좌표, mean value coordinates) ══
   원문(izzarder.com/136): 정점 개수가 같은 두 폴리선을 지정하면 그 안의 객체가 목적 폴리선 형태로 비례 이동한다.
   제작 방법 문단은 "구간별 아핀 변환"을 제안하지만, 구간 경계에서 어긋남이 생기지 않는 평균값 좌표(Floater/Hormann)로 구현했다. */
export function meanValueWeights(poly,p){
 const n=poly.length,s=poly.map(v=>G.sub(v,p)),r=s.map(G.len);
 for(let i=0;i<n;i++)if(r[i]<1e-9){const w=new Array(n).fill(0);w[i]=1;return w;}
 const tanHalf=new Array(n);
 for(let i=0;i<n;i++){
  const j=(i+1)%n,cr=G.cross(s[i],s[j]),dt=G.dot(s[i],s[j]);
  tanHalf[i]=Math.tan(Math.atan2(Math.abs(cr),dt)/2);
 }
 const w=new Array(n);
 for(let i=0;i<n;i++){const prev=(i-1+n)%n;w[i]=(tanHalf[prev]+tanHalf[i])/r[i];}
 const sum=w.reduce((a,b)=>a+b,0);
 if(!(sum>0))throw Error('평균값 좌표 계산에 실패했습니다.');
 return w.map(x=>x/sum);
}
export function mapPointBetweenShapes(srcPoly,dstPoly,p){
 const w=meanValueWeights(srcPoly,p);
 let x=0,y=0;for(let i=0;i<w.length;i++){x+=w[i]*dstPoly[i].x;y+=w[i]*dstPoly[i].y;}
 return {x,y};
}
export function mapEntity2DP(e,srcPoly,dstPoly){
 const m=p=>mapPointBetweenShapes(srcPoly,dstPoly,p);
 const out={...e};
 if(Array.isArray(e.points))out.points=e.points.map(m);
 if(e.center)out.center=m(e.center);
 if(e.position)out.position=m(e.position);
 return out;
}

/* ══ BOO: 폴리도형 합치기/빼기 (교차점 2개인 단순 겹침만 지원) ══ */
export function findBoundaryCrossings(subjPts,clipPts){
 const n=subjPts.length,m=clipPts.length,hits=[];
 for(let i=0;i<n;i++){const a=subjPts[i],b=subjPts[(i+1)%n];
  for(let j=0;j<m;j++){const c=clipPts[j],d=clipPts[(j+1)%m];
   const h=G.lineIntersection(a,b,c,d);
   if(h&&h.t>1e-7&&h.t<1-1e-7&&h.u>1e-7&&h.u<1-1e-7)hits.push({point:h.point,si:i,st:h.t,ci:j,ct:h.u});
  }}
 return hits;
}
function orderedBoundary(pts,crossings){
 const n=pts.length,byEdge=new Map();
 for(const c of crossings){if(!byEdge.has(c.edgeIndex))byEdge.set(c.edgeIndex,[]);byEdge.get(c.edgeIndex).push(c);}
 const list=[];
 for(let i=0;i<n;i++){
  list.push({point:pts[i],id:null});
  const cs=(byEdge.get(i)||[]).slice().sort((a,b)=>a.param-b.param);
  for(const c of cs)list.push({point:c.point,id:c.id});
 }
 return list;
}
function sliceForward(list,iStart,iEnd){
 const n=list.length,out=[];let i=iStart;
 for(;;){out.push(list[i].point);if(i===iEnd)break;i=(i+1)%n;}
 return out;
}
function arcInsideOther(arc,otherPts){
 const rep=arc.length>2?arc[1]:G.mul(G.add(arc[0],arc[arc.length-1]),0.5);
 return G.inside(rep,otherPts);
}
function stitchArcs(a,b){
 const end=a[a.length-1],bb=G.dist(b[0],end)<1e-6?b:[...b].reverse();
 return [...a,...bb.slice(1)];
}
export function polylineBoolean(subjPts,clipPts,op){
 const hits=findBoundaryCrossings(subjPts,clipPts);
 if(hits.length!==2)throw Error(`BOO는 두 도형이 한 곳에서만 겹치는 단순한 경우만 지원합니다 (교차점 ${hits.length}개).`);
 const [h1,h2]=hits;
 const subjList=orderedBoundary(subjPts,[{edgeIndex:h1.si,param:h1.st,point:h1.point,id:'a'},{edgeIndex:h2.si,param:h2.st,point:h2.point,id:'b'}]);
 const clipList=orderedBoundary(clipPts,[{edgeIndex:h1.ci,param:h1.ct,point:h1.point,id:'a'},{edgeIndex:h2.ci,param:h2.ct,point:h2.point,id:'b'}]);
 const sA=subjList.findIndex(n=>n.id==='a'),sB=subjList.findIndex(n=>n.id==='b');
 const cA=clipList.findIndex(n=>n.id==='a'),cB=clipList.findIndex(n=>n.id==='b');
 const s1=sliceForward(subjList,sA,sB),s2=sliceForward(subjList,sB,sA);
 const c1=sliceForward(clipList,cA,cB),c2=sliceForward(clipList,cB,cA);
 const sOut=arcInsideOther(s1,clipPts)?s2:s1,cOut=arcInsideOther(c1,subjPts)?c2:c1,cIn=cOut===c1?c2:c1;
 if(op==='union')return stitchArcs(sOut,cOut);
 if(op==='subtract')return stitchArcs(sOut,cIn);
 throw Error('알 수 없는 연산입니다.');
}

/* ══ BS: 절단선 기호 (원문 30종 아이콘 대신 지그재그/물결형 2종) ══ */
export function buildBreakLine(p1,p2,size,wave){
 const L=G.dist(p1,p2);
 if(L<G.EPS)throw Error('절단선의 두 점은 서로 달라야 합니다.');
 const u=G.unit(G.sub(p2,p1)),n=G.normal(u);
 const zone=Math.min(size*3,L*0.6);
 const mid=G.mul(G.add(p1,p2),0.5),zs=G.add(mid,G.mul(u,-zone/2)),ze=G.add(mid,G.mul(u,zone/2));
 const at=(t,off)=>G.add(G.add(zs,G.mul(u,zone*t)),G.mul(n,off));
 const pts=wave
  ?[p1,zs,at(0.25,size*0.5),at(0.5,-size*0.5),at(0.75,size*0.5),ze,p2]
  :[p1,zs,at(0.33,size*0.5),at(0.66,-size*0.5),ze,p2];
 return {type:'polyline',closed:false,points:pts};
}

/* ══ CBJ: 등고선 끝점을 테두리(경계 폴리선)에 연결선으로 잇는다 ══
   원문은 등고선과 테두리를 하나의 폐곡선으로 합치지만, 시간 제약으로 "끝점→테두리 최단점" 연결선을 추가하는 것으로 단순화했다. */
export function nearestBoundaryPoint(boundaryPts,closed,p){
 let best=null,bd=Infinity;
 for(const [a,b] of G.segments({points:boundaryPts,closed})){
  const d=G.distanceToSegment(p,a,b);
  if(d<bd){bd=d;const v=G.sub(b,a),t=Math.max(0,Math.min(1,G.dot(G.sub(p,a),v)/(G.dot(v,v)||1)));best=G.add(a,G.mul(v,t));}
 }
 if(!best)throw Error('테두리에 변이 없습니다.');
 return {point:best,distance:bd};
}
export function contourConnectors(boundary,contours,tolerance){
 const bpts=boundary.points,bclosed=isClosed(boundary),out=[];
 for(const c of contours){
  const pts=c.points;if(!pts||pts.length<2)continue;
  for(const end of [pts[0],pts.at(-1)]){
   const hit=nearestBoundaryPoint(bpts,bclosed,end);
   if(hit.distance<=tolerance&&hit.distance>G.EPS)out.push({type:'line',points:[{x:end.x,y:end.y},hit.point]});
  }
 }
 return out;
}

/* ══ JUL: 기준선 위 교차점에 점프(삼각 돌기) 표시를 넣는다 ══
   원문은 반원(불지) 점프지만, 폴리선 bulge 렌더링 의존을 피하려고 직선 돌기로 단순화했다(보고서에 기록). */
export function lineCrossings(basePts,other){
 const [a,b]=basePts,hits=[];
 for(const [c,d] of G.segments(other)){
  const h=G.lineIntersection(a,b,c,d);
  if(h&&h.t>1e-7&&h.t<1-1e-7&&h.u>-1e-7&&h.u<1+1e-7)hits.push(h.t);
 }
 return hits;
}
export function buildJumpLine(basePts,crossingTs,jumpWidth,jumpHeight){
 const [a,b]=basePts,v=G.sub(b,a),L=G.len(v);
 if(L<G.EPS)throw Error('기준선의 두 점은 서로 달라야 합니다.');
 const u=G.unit(v),n=G.normal(u);
 const ts=[...new Set(crossingTs.map(t=>Math.round(t*1e7)/1e7))].filter(t=>t>0&&t<1).sort((x,y)=>x-y);
 const pts=[a];
 for(const t of ts){
  const halfT=(jumpWidth/2)/L,s=Math.max(0,t-halfT),e=Math.min(1,t+halfT);
  pts.push(G.add(a,G.mul(v,s)));
  pts.push(G.add(G.add(a,G.mul(v,(s+e)/2)),G.mul(n,jumpHeight)));
  pts.push(G.add(a,G.mul(v,e)));
 }
 pts.push(b);
 return {type:'polyline',closed:false,points:pts};
}

/* ══ PAA: 동선 화살표 (원문 5그룹 중 핵심만: 두께 방식/화살표만 방식, 길이배수·둥근끝은 생략) ══ */
export function pathDashes(pts,segLen,gapLen){
 const total=pathLength(pts),out=[];
 for(let s=0;s<total-G.EPS;s+=segLen+gapLen){
  const e=Math.min(total,s+segLen);
  if(e-s>G.EPS)out.push([pointAtLength(pts,s).point,pointAtLength(pts,e).point]);
 }
 return out;
}
export function dashRect(a,b,width){
 const u=G.unit(G.sub(b,a)),n=G.mul(G.normal(u),width/2);
 return {type:'polyline',closed:true,points:[G.add(a,n),G.add(b,n),G.sub(b,n),G.sub(a,n)]};
}
export function arrowHead(tip,outwardDir,angleDeg,size){
 const back=G.mul(outwardDir,-size);
 const rot=(v,deg)=>{const r=deg*Math.PI/180,c=Math.cos(r),s=Math.sin(r);return {x:v.x*c-v.y*s,y:v.x*s+v.y*c};};
 return [{type:'line',points:[tip,G.add(tip,rot(back,angleDeg))]},{type:'line',points:[tip,G.add(tip,rot(back,-angleDeg))]}];
}
export function buildPathArrow(pts,v){
 const entities=[];
 if(v.thicknessMode){for(const [a,b] of pathDashes(pts,v.segLen,v.gapLen))entities.push(dashRect(a,b,v.thickness));}
 else entities.push({type:'polyline',closed:false,points:clonePts(pts)});
 const outward=atStart=>atStart?G.unit(G.sub(pts[0],pts[1])):G.unit(G.sub(pts.at(-1),pts.at(-2)));
 const addArrow=atStart=>{
  const dir=outward(atStart),endpoint=atStart?pts[0]:pts.at(-1),tip=G.sub(endpoint,G.mul(dir,v.gap));
  entities.push(...arrowHead(tip,dir,v.angle,v.size));
 };
 addArrow(false);
 if(v.bothSides)addArrow(true);
 return entities;
}

/* ══ PBB: 선택 객체마다 경계 사각형을 그린다 ══ */
export function boundingBoxOf(e){
 const b=G.bounds([e]);if(!b)throw Error('경계를 계산할 수 없는 객체입니다.');
 return {type:'rectangle',points:G.rectangle({x:b.minX,y:b.minY},{x:b.maxX,y:b.maxY})};
}

/* ══ PEC: 기준선 위 수선의 발에서 지정한 점까지 수직선을 긋는다 ══ */
export function perpendicularFoot(baseEntity,p){
 let best=null,bd=Infinity;
 for(const [a,b] of G.segments(baseEntity)){
  if(G.dist(a,b)<G.EPS)continue;
  const d=G.distanceToSegment(p,a,b);
  if(d<bd){bd=d;const v=G.sub(b,a),t=Math.max(0,Math.min(1,G.dot(G.sub(p,a),v)/G.dot(v,v)));best=G.add(a,G.mul(v,t));}
 }
 if(!best)throw Error('기준 객체에 변이 없습니다.');
 return best;
}

/* ══ PET: 허용거리 안의 끝점끼리 연결선을 추가한다(원본 선은 그대로 둔다) ══
   원문은 실제로 끝을 늘려 잇지만, 원본 기하를 바꾸지 않는 additive 연결선으로 단순화했다(보고서에 기록). */
export function collectOpenEndpoints(entities){
 const pts=[];
 for(const e of entities||[]){
  if(e.hidden||!['line','polyline'].includes(e.type)||isClosed(e))continue;
  const ps=e.points;if(!ps||ps.length<2)continue;
  pts.push({id:e.id,point:ps[0]},{id:e.id,point:ps.at(-1)});
 }
 return pts;
}
export function pairEndpoints(entities,tolerance){
 const pts=collectOpenEndpoints(entities),used=new Set(),candidates=[],pairs=[];
 for(let i=0;i<pts.length;i++)for(let j=i+1;j<pts.length;j++){
  if(pts[i].id===pts[j].id)continue;
  const d=G.dist(pts[i].point,pts[j].point);
  if(d>G.EPS&&d<=tolerance)candidates.push({i,j,d});
 }
 candidates.sort((a,b)=>a.d-b.d);
 for(const c of candidates){
  if(used.has(c.i)||used.has(c.j))continue;
  used.add(c.i);used.add(c.j);
  pairs.push({type:'line',points:[pts[c.i].point,pts[c.j].point]});
 }
 return pairs;
}

/* ══ PJ: 허용거리 안의 끝점을 실제로 이어 하나의 폴리선으로 합친다 ══ */
export function joinChains(items,tolerance){
 const chains=items.map(it=>({pts:clonePts(it.points),used:false}));
 const results=[];
 for(const seed of chains){
  if(seed.used)continue;seed.used=true;
  let pts=[...seed.pts],extended=true;
  while(extended){
   extended=false;
   for(const c of chains){
    if(c.used)continue;
    const head=pts[0],tail=pts.at(-1),chead=c.pts[0],ctail=c.pts.at(-1);
    if(G.dist(tail,chead)<=tolerance){pts=[...pts,...c.pts.slice(1)];c.used=true;extended=true;}
    else if(G.dist(tail,ctail)<=tolerance){pts=[...pts,...[...c.pts].reverse().slice(1)];c.used=true;extended=true;}
    else if(G.dist(head,ctail)<=tolerance){pts=[...c.pts.slice(0,-1),...pts];c.used=true;extended=true;}
    else if(G.dist(head,chead)<=tolerance){pts=[...[...c.pts].reverse().slice(0,-1),...pts];c.used=true;extended=true;}
   }
  }
  const closed=pts.length>2&&G.dist(pts[0],pts.at(-1))<=tolerance;
  results.push({points:closed?pts.slice(0,-1):pts,closed});
 }
 return results;
}

/* ══ PW: 대상을 폴리선으로 만들고 두께(constantWidth)를 준다 ══
   engine.js/app.js 확인 결과 폴리선에 constantWidth 속성이 실재하고 view.js 가 그대로 두꺼운 선으로 그린다(basic-command-flows.test.js 의 PL…W 시험 참고). */
export function toPolylineForWidth(e,steps=64){
 if(e.type==='line')return {type:'polyline',closed:false,points:clonePts(e.points)};
 if(e.type==='polyline')return {type:'polyline',closed:!!e.closed,points:clonePts(e.points)};
 if(e.type==='rectangle')return {type:'polyline',closed:true,points:clonePts(e.points)};
 if(e.type==='circle'){const pts=[];for(let i=0;i<steps;i++)pts.push(G.add(e.center,G.polar(e.radius,i*360/steps)));return {type:'polyline',closed:true,points:pts};}
 if(e.type==='arc'){const sweep=G.normalizeAngle(e.endAngle-e.startAngle)||360,pts=[];for(let i=0;i<=steps;i++)pts.push(G.add(e.center,G.polar(e.radius,e.startAngle+sweep*i/steps)));return {type:'polyline',closed:false,points:pts};}
 throw Error('선·폴리선·사각형·원·호만 두께를 줄 수 있습니다(스플라인·타원은 없음).');
}
export function withWidth(poly,width){return width>0?{...poly,constantWidth:width}:poly;}

/* ══ PWD: 열린 선·폴리선에 두께를 주고 그 외곽선도 그린다(닫힌 폴리선은 지원하지 않음) ══ */
export function buildOutline(pts,halfWidth){
 if(pts.length<2)throw Error('점이 2개 이상 필요합니다.');
 const poly={type:'polyline',closed:false,points:clonePts(pts)};
 const u=G.unit(G.sub(pts[1],pts[0])),n=G.normal(u);
 const sideA=G.offsetEntity(poly,halfWidth,G.add(pts[0],G.mul(n,10)));
 const sideB=G.offsetEntity(poly,halfWidth,G.sub(pts[0],G.mul(n,10)));
 return {type:'polyline',closed:true,points:[...sideA.points,...[...sideB.points].reverse()]};
}

/* ══ UFD: 폴리선을 곧게 펼친다(단순 펼치기만 지원, 높이값·가중평균 모드는 생략) ══ */
export function unfoldLengths(pts,closed){
 const out=[0];let acc=0;
 for(const [a,b] of G.segments({points:pts,closed})){acc+=G.dist(a,b);out.push(acc);}
 return out;
}

/* ══ XLD: Xline 객체가 없어 충분히 긴 직선(기본 100000mm)으로 대신한다 ══ */
export function xlineReferencePoints(e){
 if(e.type==='line')return [e.points[0],e.points[1],G.mul(G.add(e.points[0],e.points[1]),0.5)];
 if(['polyline','rectangle'].includes(e.type))return clonePts(e.points);
 if(e.type==='circle')return [e.center,G.add(e.center,{x:e.radius,y:0}),G.sub(e.center,{x:e.radius,y:0})];
 throw Error('선·폴리선·원만 지원합니다(블록 방향 기준은 없음).');
}
export function longLineThrough(point,angleDeg,length=100000){
 const d=G.polar(1,angleDeg);
 return {type:'line',points:[G.sub(point,G.mul(d,length/2)),G.add(point,G.mul(d,length/2))]};
}

/* ══ ZIGZAG: 지그재그(직선형)·파형(3점 기반, 원문의 "원형") ══ */
export function zigzagStraight(p1,p2,height,width){
 const L=G.dist(p1,p2);if(L<G.EPS)throw Error('두 점은 서로 달라야 합니다.');
 const u=G.unit(G.sub(p2,p1)),n=G.normal(u),count=Math.max(1,Math.round(L/Math.max(width,G.EPS)));
 const pts=[p1];
 for(let i=1;i<count;i++)pts.push(G.add(G.add(p1,G.mul(u,L*i/count)),G.mul(n,(i%2?1:-1)*height/2)));
 pts.push(p2);
 return {type:'polyline',closed:false,points:pts};
}
export function zigzagOnArc(p1,pm,p2,height,width){
 const arc=G.arcThrough(p1,pm,p2);
 const sweep=G.normalizeAngle(arc.endAngle-arc.startAngle)||360,L=arc.radius*sweep*Math.PI/180;
 const count=Math.max(1,Math.round(L/Math.max(width,G.EPS))),pts=[];
 for(let i=0;i<=count;i++){
  const a=arc.startAngle+sweep*i/count,base=G.add(arc.center,G.polar(arc.radius,a)),dir=G.unit(G.sub(base,arc.center));
  const off=i===0||i===count?0:(i%2?1:-1)*height/2;
  pts.push(G.add(base,G.mul(dir,off)));
 }
 // arcThrough 는 m 이 속한 호가 되도록 start/end 를 p1↔p2 사이에서 바꿔 넣을 수 있다 — 항상 p1 에서 시작하도록 순서를 맞춘다.
 if(G.dist(pts[0],p1)>G.dist(pts[0],p2))pts.reverse();
 return {type:'polyline',closed:false,points:pts};
}

/* ══ 3TP: 정점에 Z값이 남아 있거나 elevation 이 붙은 폴리선을 2D(LW) 폴리선으로 바꾼다 ══
   원문(izzarder.com/548): 각 정점의 Z값이 Elevation 으로 흡수된 일반 폴리선이 된다.
   바른 CAD 폴리선은 원래 2D 이지만 DXF/외부 자료에서 온 점에 z 가 남아 있거나 polyline3d 표식·elevation 이 있을 수 있어
   그 값을 지우고 시작점 Z(없으면 elevation)를 elevation 속성 하나로 보관한다. 2026-09-24 검토 F13 으로 안내 전용에서 실제 동작으로 바꿈. */
export function flattenPolyline3d(e){
 if(!['polyline','rectangle'].includes(e?.type)||!Array.isArray(e.points))return null;
 const zs=e.points.map(p=>Number(p?.z)).filter(Number.isFinite);
 const hasElevation=Number.isFinite(e.elevation)&&e.elevation!==0;
 if(!zs.length&&!hasElevation&&!e.polyline3d)return null;
 const elevation=zs.length?zs[0]:(Number(e.elevation)||0);
 const {polyline3d,...rest}=e;
 return {...rest,type:'polyline',closed:e.type==='rectangle'||!!e.closed,points:e.points.map(p=>({x:p.x,y:p.y})),elevation};
}
/* ── 입력 상한(2026-09-24 검토 F9). 인식거리·허용거리는 10 m, 지그재그 높이·너비는 100 m 까지만 받는다. ── */
export const TOLERANCE_LIMIT=10000;
export function checkTolerance(tol,label='인식거리'){
 if(!Number.isFinite(tol)||tol<=0)throw Error(`${label}는 0보다 큰 숫자로 입력하세요.`);
 if(tol>TOLERANCE_LIMIT)throw Error(`${label}는 ${TOLERANCE_LIMIT.toLocaleString()} mm(10 m) 이하로 입력하세요. 너무 크면 멀리 떨어진 객체까지 잘못 이어집니다.`);
 return tol;
}
export const ZIGZAG_LIMIT=100000;
export function checkZigzag(height,width,thickness){
 if(!Number.isFinite(height)||height<=0||!Number.isFinite(width)||width<=0)throw Error('높이·너비는 양수여야 합니다.');
 if(height>ZIGZAG_LIMIT||width>ZIGZAG_LIMIT)throw Error(`높이·너비는 ${ZIGZAG_LIMIT.toLocaleString()} mm(100 m) 이하로 입력하세요.`);
 if(!Number.isFinite(thickness)||thickness<0)throw Error('두께는 0 이상의 숫자로 입력하세요.');
 if(thickness>TOLERANCE_LIMIT)throw Error(`두께는 ${TOLERANCE_LIMIT.toLocaleString()} mm 이하로 입력하세요.`);
}
export function checkAngle(angle,label='각도'){
 if(!Number.isFinite(angle))throw Error(`${label}는 숫자로 입력하세요.`);
 if(Math.abs(angle)>360)throw Error(`${label}는 -360~360도 사이로 입력하세요.`);
 return angle;
}

/* ── 화면(설치) ── */
export function installShapeTools(ctx){
 const fail=e=>{console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);};
 const tag=e=>({...e,cardLayer:STD_LAYERS.symb});

 async function run3TP(){
  try{
   let targets=(ctx.selected?.()||[]).filter(e=>['polyline','rectangle'].includes(e.type));
   if(!targets.length){
    for(;;){
     const e=await ctx.pickEntity({prompt:`3TP · 2D 폴리선으로 바꿀 폴리선을 선택하세요 · 지금까지 ${targets.length}개 · Esc 로 끝내기`,types:['polyline','rectangle']});
     if(!e)break;
     targets.push(e);
    }
   }
   if(!targets.length){ctx.toast('선택한 폴리선이 없습니다.');return;}
   const commands=[];
   for(const e of targets){
    const flat=flattenPolyline3d(e);
    if(!flat)continue;
    const {id,type,...changes}=flat;
    commands.push({type:'update',ids:[e.id],changes:{...changes,points:flat.points}});
   }
   if(!commands.length){ctx.toast(`3TP · 선택한 폴리선 ${targets.length}개는 이미 2D(LW) 폴리선입니다. Z값·elevation 이 없어 바꿀 것이 없습니다.`);return;}
   ctx.execute({type:'batch',commands});
   ctx.refresh?.();
   ctx.toast(`3TP · 폴리선 ${commands.length}개를 2D 폴리선으로 바꿨습니다(정점 Z값은 elevation 속성 하나로 보관)${targets.length>commands.length?` · ${targets.length-commands.length}개는 이미 2D`:''} · Ctrl+Z 로 되돌리기`);
  }catch(e){fail(e);}
 }

 async function run2DP(){
  try{
   const src=await ctx.pickEntity({prompt:'2DP · 원본 도형(닫힌 폴리선/사각형)을 선택하세요 · Esc 취소',types:['polyline','rectangle']});
   if(!src)return;
   if(!isClosed(src))throw Error('원본 도형은 닫힌 폴리선이어야 합니다.');
   const dst=await ctx.pickEntity({prompt:'2DP · 목적 도형(정점 개수가 같은 닫힌 폴리선/사각형)을 선택하세요 · Esc 취소',types:['polyline','rectangle']});
   if(!dst)return;
   if(!isClosed(dst))throw Error('목적 도형은 닫힌 폴리선이어야 합니다.');
   if(src.points.length!==dst.points.length)throw Error(`정점 개수가 다릅니다 (원본 ${src.points.length} · 목적 ${dst.points.length}).`);
   const removeIds=[],add=[];
   for(;;){
    const obj=await ctx.pickEntity({prompt:`2DP · 옮길 객체를 선택하세요 · 지금까지 ${add.length}개 · Esc 로 끝내기`});
    if(!obj)break;
    if(obj.id===src.id||obj.id===dst.id){ctx.toast('원본·목적 도형 자체는 옮기지 않습니다.',true);continue;}
    add.push(mapEntity2DP(obj,src.points,dst.points));removeIds.push(obj.id);
   }
   if(!add.length){ctx.toast('옮길 객체를 선택하지 않았습니다.');return;}
   ctx.commit({removeIds,entities:add});
   ctx.toast(`2DP · 객체 ${add.length}개를 목적 도형 형태로 옮겼습니다 · Ctrl+Z 로 되돌리기`);
  }catch(e){fail(e);}
 }

 async function runBOO(){
  try{
   const a=await ctx.pickEntity({prompt:'BOO · 첫째 폴리도형을 선택하세요 · Esc 취소',types:['polyline','rectangle']});
   if(!a)return;
   const b=await ctx.pickEntity({prompt:'BOO · 둘째 폴리도형을 선택하세요 · Esc 취소',types:['polyline','rectangle']});
   if(!b)return;
   if(!isClosed(a)||!isClosed(b))throw Error('두 도형 모두 닫힌 폴리선이어야 합니다.');
   ctx.form('BOO · 폴리도형 합치기/빼기',[{name:'subtract',label:'빼기 (선택 안하면 합치기: 첫째 도형에서 둘째 도형을 뺍니다)',type:'checkbox'}],async values=>{
    const op=values.subtract==='on'?'subtract':'union';
    const result=polylineBoolean(a.points,b.points,op);
    ctx.commit({removeIds:[a.id,b.id],entities:[{type:'polyline',closed:true,points:result,layer:a.layer}]}); // 첫째 도형의 레이어를 잇는다(0 레이어로 빠지지 않게)
    ctx.toast(`BOO · ${op==='union'?'합치기':'빼기'} 완료 · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(e);}
 }

 async function runBS(){
  try{
   ctx.form('BS · 절단선 기호(지그재그/물결형)',[{name:'wave',label:'물결형 (선택 안하면 지그재그형)',type:'checkbox'},{name:'size',label:'기호 크기 (mm)',type:'number',value:250}],async values=>{
    const size=Number(values.size);if(!Number.isFinite(size)||size<=0)throw Error('기호 크기는 양수여야 합니다.');
    const path=await ctx.pickPath({prompt:'BS · 절단선 두 점을 지정하세요 · Esc 취소',minPoints:2,maxPoints:2});
    if(!path)return;
    const line=buildBreakLine(path.points[0],path.points[1],size,values.wave==='on');
    ctx.commit({entities:resolveLayers(ctx,[tag(line)])});
    ctx.toast('BS · 절단선 기호를 그렸습니다 · Ctrl+Z 로 되돌리기');
   });
  }catch(e){fail(e);}
 }

 async function runCBJ(){
  try{
   const boundary=await ctx.pickEntity({prompt:'CBJ · 테두리(경계) 폴리선을 선택하세요 · Esc 취소',types:['polyline','rectangle']});
   if(!boundary)return;
   const contours=[];
   for(;;){
    const c=await ctx.pickEntity({prompt:`CBJ · 이어줄 등고선을 선택하세요 · 지금까지 ${contours.length}개 · Esc 로 끝내기`,types:['line','polyline']});
    if(!c)break;
    if(c.id===boundary.id){ctx.toast('테두리 자체는 등고선으로 선택하지 않습니다.',true);continue;}
    contours.push(c);
   }
   if(!contours.length){ctx.toast('이어줄 등고선을 선택하지 않았습니다.');return;}
   ctx.askNumber({title:'CBJ · 등고선-테두리 연결',label:`연결 인식거리 (mm, 최대 ${TOLERANCE_LIMIT.toLocaleString()})`,value:Math.max(50,ctx.tolerance()*20),max:TOLERANCE_LIMIT},async tol=>{
    checkTolerance(tol,'연결 인식거리');
    const add=contourConnectors(boundary,contours,tol);
    if(!add.length){ctx.toast('인식거리 안에서 연결할 끝점이 없습니다.',true);return;}
    ctx.commit({entities:resolveLayers(ctx,add.map(tag))});
    ctx.toast(`CBJ · 연결선 ${add.length}개를 추가했습니다 · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(e);}
 }

 async function runJUL(){
  try{
   const base=await ctx.pickEntity({prompt:'JUL · 기준선을 선택하세요(직선만) · Esc 취소',types:['line']});
   if(!base)return;
   const crossers=[];
   for(;;){
    const c=await ctx.pickEntity({prompt:`JUL · 교차하는 선을 선택하세요 · 지금까지 ${crossers.length}개 · Esc 로 끝내기`});
    if(!c)break;
    if(c.id===base.id){ctx.toast('기준선 자체는 다시 선택하지 않습니다.',true);continue;}
    crossers.push(c);
   }
   if(!crossers.length){ctx.toast('교차하는 선을 선택하지 않았습니다.');return;}
   ctx.form('JUL · 점프선 크기',[{name:'width',label:'점프 폭 (mm)',type:'number',value:100},{name:'height',label:'점프 높이 (mm)',type:'number',value:60}],async values=>{
    const jw=Number(values.width),jh=Number(values.height);
    if(!Number.isFinite(jw)||jw<=0||!Number.isFinite(jh)||jh<=0)throw Error('점프 폭·높이는 양수여야 합니다.');
    const ts=crossers.flatMap(c=>lineCrossings(base.points,c));
    if(!ts.length){ctx.toast('기준선과 교차하는 지점이 없습니다.',true);return;}
    const jumped=buildJumpLine(base.points,ts,jw,jh);
    ctx.commit({removeIds:[base.id],entities:[{...jumped,layer:base.layer}]});
    ctx.toast(`JUL · 교차점 ${ts.length}곳에 점프선을 넣었습니다 · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(e);}
 }

 async function runPAA(){
  try{
   ctx.form('PAA · 동선 화살표(두께 방식/화살표만 방식)',[
    {name:'arrowOnly',label:'화살표만 (선택 안하면 두께 있는 동선)',type:'checkbox'},
    {name:'thickness',label:'선두께 (mm)',type:'number',value:100},
    {name:'segLen',label:'선 길이 (mm)',type:'number',value:150},
    {name:'gapLen',label:'간격거리 (mm)',type:'number',value:80},
    {name:'angle',label:'화살표 각도 (15~60도)',type:'number',value:45},
    {name:'size',label:'화살표 크기 (mm)',type:'number',value:300},
    {name:'gap',label:'끝에서 이격거리 (mm)',type:'number',value:20},
    {name:'bothSides',label:'양 쪽 끝에 화살표 (선택 안하면 끝 쪽만)',type:'checkbox'},
   ],async values=>{
    const v={thicknessMode:values.arrowOnly!=='on',thickness:Number(values.thickness),segLen:Number(values.segLen),gapLen:Number(values.gapLen),angle:Number(values.angle),size:Number(values.size),gap:Number(values.gap),bothSides:values.bothSides==='on'};
    if(!Number.isFinite(v.angle)||v.angle<5||v.angle>90)throw Error('화살표 각도는 5~90도 사이여야 합니다.');
    if(!Number.isFinite(v.size)||v.size<=0)throw Error('화살표 크기는 양수여야 합니다.');
    const path=await ctx.pickPath({prompt:'PAA · 동선이 될 점을 이어 찍으세요 · Enter 완료 · Esc 취소',minPoints:2,maxPoints:0});
    if(!path)return;
    const entities=buildPathArrow(path.points,v);
    ctx.commit({entities:resolveLayers(ctx,entities.map(tag))});
    ctx.toast('PAA · 동선 화살표를 그렸습니다 · Ctrl+Z 로 되돌리기');
   });
  }catch(e){fail(e);}
 }

 async function runPBB(){
  try{
   const add=[];
   for(;;){
    const e=await ctx.pickEntity({prompt:`PBB · 경계 박스를 그릴 객체를 선택하세요 · 지금까지 ${add.length}개 · Esc 로 끝내기`});
    if(!e)break;
    add.push(boundingBoxOf(e));
   }
   if(!add.length){ctx.toast('선택한 객체가 없습니다.');return;}
   ctx.commit({entities:add});
   ctx.toast(`PBB · 경계 박스 ${add.length}개를 그렸습니다 · Ctrl+Z 로 되돌리기`);
  }catch(e){fail(e);}
 }

 async function runPEC(){
  try{
   const base=await ctx.pickEntity({prompt:'PEC · 기준 선/폴리선을 선택하세요 · Esc 취소',types:['line','polyline','rectangle']});
   if(!base)return;
   const add=[];
   for(;;){
    const p=await ctx.pickPoint(`PEC · 수직선을 그릴 점을 지정하세요 · 지금까지 ${add.length}개 · Esc 로 끝내기`);
    if(!p)break;
    const foot=perpendicularFoot(base,p);
    add.push({type:'line',points:[foot,p]});
   }
   if(!add.length){ctx.toast('지정한 점이 없습니다.');return;}
   ctx.commit({entities:add});
   ctx.toast(`PEC · 수직선 ${add.length}개를 그렸습니다 · Ctrl+Z 로 되돌리기`);
  }catch(e){fail(e);}
 }

 async function runPET(){
  try{
   // 이을 선을 먼저 고른다(미리 고른 것이 있으면 그것). 예전엔 도면 전체 끝점을 짝지어 다른 곳까지 이었다(2026-10-27 설명서 시험).
   let picked=(ctx.selected?.()||[]).filter(e=>['line','polyline'].includes(e.type)&&!isClosed(e));
   if(picked.length<2){
    picked=[];
    for(;;){
     const e=await ctx.pickEntity({prompt:`PET · 끝점을 이을 평행선을 선택하세요 · 지금까지 ${picked.length}개 · Esc 로 끝내기`,types:['line','polyline']});
     if(!e)break;
     if(isClosed(e)){ctx.toast('닫힌 폴리선은 잇기 대상에서 제외합니다.',true);continue;}
     picked.push(e);
    }
   }
   if(picked.length<2){ctx.toast('이을 선은 2개 이상 선택하세요.');return;}
   ctx.askNumber({title:'PET · 평행선 끝점 잇기',label:`인식거리 (mm, 최대 ${TOLERANCE_LIMIT.toLocaleString()})`,value:10,max:TOLERANCE_LIMIT},async tol=>{
    checkTolerance(tol,'인식거리');
    const add=pairEndpoints(picked,tol).map(e=>({...e,layer:picked[0].layer}));
    if(!add.length){ctx.toast('인식거리 안에서 연결할 끝점 쌍이 없습니다.',true);return;}
    ctx.commit({entities:add});
    ctx.toast(`PET · 끝점 ${add.length}쌍을 연결했습니다 · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(e);}
 }

 async function runPJ(){
  try{
   const picked=[];
   for(;;){
    const e=await ctx.pickEntity({prompt:`PJ · 이을 선/폴리선을 선택하세요 · 지금까지 ${picked.length}개 · Esc 로 끝내기`,types:['line','polyline']});
    if(!e)break;
    if(isClosed(e)){ctx.toast('닫힌 폴리선은 잇기 대상에서 제외합니다.',true);continue;}
    picked.push(e);
   }
   if(picked.length<2){ctx.toast('이을 대상은 2개 이상 선택하세요.');return;}
   ctx.askNumber({title:'PJ · 폴리선 이어주기',label:`허용 거리 (mm, 최대 ${TOLERANCE_LIMIT.toLocaleString()})`,value:5,max:TOLERANCE_LIMIT},async tol=>{
    checkTolerance(tol,'허용 거리');
    const chains=joinChains(picked,tol);
    if(chains.length>=picked.length){ctx.toast('허용 거리 안에서 이어질 끝점이 없습니다.',true);return;}
    ctx.commit({removeIds:picked.map(e=>e.id),entities:chains.map(c=>({type:'polyline',closed:c.closed,points:c.points,layer:picked[0].layer}))}); // 첫 선의 레이어를 잇는다
    ctx.toast(`PJ · ${picked.length}개를 ${chains.length}개로 이었습니다 · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(e);}
 }

 async function runPW(){
  try{
   const picked=[];
   for(;;){
    const e=await ctx.pickEntity({prompt:`PW · 두께를 줄 객체를 선택하세요 · 지금까지 ${picked.length}개 · Esc 로 끝내기`,types:['line','polyline','rectangle','circle','arc']});
    if(!e)break;
    picked.push(e);
   }
   if(!picked.length){ctx.toast('선택한 객체가 없습니다.');return;}
   ctx.askNumber({title:'PW · 폴리선 두께 주기',label:'두께 (mm, 0=두께 없이 폴리선 변환만)',value:0,min:0,allowZero:true},async width=>{
    const add=picked.map(e=>({...withWidth(toPolylineForWidth(e),width),layer:e.layer}));
    ctx.commit({removeIds:picked.map(e=>e.id),entities:add});
    ctx.toast(`PW · ${add.length}개에 두께를 적용했습니다 · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(e);}
 }

 async function runPWD(){
  try{
   const e=await ctx.pickEntity({prompt:'PWD · 두께를 줄 열린 선/폴리선을 선택하세요 · Esc 취소',types:['line','polyline']});
   if(!e)return;
   if(isClosed(e))throw Error('PWD는 열린 선·폴리선만 지원합니다(닫힌 폴리선은 시간 제약으로 생략).');
   ctx.askNumber({title:'PWD · 두께주고 테두리 그리기',label:'두께 (mm)',value:200},async width=>{
    if(width<=0)throw Error('두께는 양수여야 합니다.');
    const core=withWidth(toPolylineForWidth(e),width);
    const outline=buildOutline(e.points,width/2);
    ctx.commit({removeIds:[e.id],entities:resolveLayers(ctx,[{...core,layer:e.layer},{...outline,cardLayer:STD_LAYERS.wall}])});
    ctx.toast('PWD · 두께와 외곽선을 그렸습니다 · Ctrl+Z 로 되돌리기');
   });
  }catch(e){fail(e);}
 }

 async function runUFD(){
  try{
   const e=await ctx.pickEntity({prompt:'UFD · 펼칠 폴리선을 선택하세요 · Esc 취소',types:['polyline','rectangle']});
   if(!e)return;
   ctx.form('UFD · 폴리선 펼치기(단순 펼치기)',[{name:'circles',label:'정점에 원 그리기',value:'on',type:'checkbox'}],async values=>{
    const path=await ctx.pickPath({prompt:'UFD · 펼칠 시작점과 방향(두 점)을 지정하세요 · Esc 취소',minPoints:2,maxPoints:2});
    if(!path)return;
    const f=wallFrame(path.points[0],path.points[1],G.add(path.points[0],G.normal(G.unit(G.sub(path.points[1],path.points[0])))));
    const lens=unfoldLengths(e.points,isClosed(e));
    const b=builder(f,STD_LAYERS.symb);
    for(let i=1;i<lens.length;i++)b.line(lens[i-1],0,lens[i],0);
    if(values.circles==='on')for(const s of lens)b.circle(s,0,Math.max(20,lens.at(-1)*0.01));
    ctx.commit({entities:resolveLayers(ctx,b.list)});
    ctx.toast(`UFD · 총 길이 ${Math.round(lens.at(-1))}mm 로 펼쳤습니다 · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(e);}
 }

 async function runXLD(){
  try{
   const e=await ctx.pickEntity({prompt:'XLD · 기준 객체(선/폴리선/원)를 선택하세요 · Esc 취소',types:['line','polyline','rectangle','circle']});
   if(!e)return;
   ctx.askNumber({title:'XLD · 객체에 긴 직선 긋기(Xline 대신)',label:'각도 (도, -360~360)',value:0,min:-360,max:360,allowZero:true,allowNegative:true},async angle=>{
    checkAngle(angle,'각도');
    const refs=xlineReferencePoints(e);
    const add=refs.map(p=>tag(longLineThrough(p,angle)));
    ctx.commit({entities:resolveLayers(ctx,add)});
    ctx.toast(`XLD · 기준점 ${refs.length}곳에 긴 직선(100m)을 그었습니다(Xline 없음 · 근사) · Ctrl+Z 로 되돌리기`);
   });
  }catch(e){fail(e);}
 }

 async function runZIGZAG(){
  try{
   ctx.form('ZIGZAG · 지그재그 폴리선(직선형/원형)',[
    {name:'round',label:'원형 (선택 안하면 직선형)',type:'checkbox'},
    {name:'height',label:'높이 (mm)',type:'number',value:1000},
    {name:'width',label:'너비 (mm)',type:'number',value:1000},
    {name:'thickness',label:'두께 (mm, 0=두께 없음)',type:'number',value:0},
   ],async values=>{
    const height=Number(values.height),width=Number(values.width),thickness=Number(values.thickness);
    checkZigzag(height,width,thickness);
    const round=values.round==='on';
    const path=await ctx.pickPath({prompt:round?'ZIGZAG · 원형: 시작점·호 위 점·끝점 세 점을 지정하세요 · Esc 취소':'ZIGZAG · 직선형: 시작점·끝점 두 점을 지정하세요 · Esc 취소',minPoints:round?3:2,maxPoints:round?3:2});
    if(!path)return;
    const line=round?zigzagOnArc(path.points[0],path.points[1],path.points[2],height,width):zigzagStraight(path.points[0],path.points[1],height,width);
    ctx.commit({entities:resolveLayers(ctx,[tag(withWidth(line,thickness))])});
    ctx.toast('ZIGZAG · 지그재그 폴리선을 그렸습니다 · Ctrl+Z 로 되돌리기');
   });
  }catch(e){fail(e);}
 }

 return {'3TP':run3TP,'2DP':run2DP,BOO:runBOO,BS:runBS,CBJ:runCBJ,JUL:runJUL,PAA:runPAA,PBB:runPBB,PEC:runPEC,PET:runPET,PJ:runPJ,PW:runPW,PWD:runPWD,UFD:runUFD,XLD:runXLD,ZIGZAG:runZIGZAG};
}
