// 벽체 정리 FL(L형) · FT(T형) · FX(X형). izzarder.com/363·364·365.
// 조작: 모서리 안쪽에서 바깥쪽으로 사각형 영역 두 점 → 영역에 걸린 벽선을 잇고 자른다. 중심선은 자동 제외, Esc 까지 반복.
import * as G from './geometry.js';

const CENTER_RE=/CNTR|GRID|CENTER|중심|(?:^|-)WALL-C(?:$|-)/i;
const box2=(a,b)=>({minX:Math.min(a.x,b.x),minY:Math.min(a.y,b.y),maxX:Math.max(a.x,b.x),maxY:Math.max(a.y,b.y)});
const inBox=(p,b)=>p.x>=b.minX-G.EPS&&p.x<=b.maxX+G.EPS&&p.y>=b.minY-G.EPS&&p.y<=b.maxY+G.EPS;
const boxEdges=b=>G.segments({type:'rectangle',points:G.rectangle({x:b.minX,y:b.minY},{x:b.maxX,y:b.maxY})});
export function segmentTouchesBox(a,b,box){
 if(inBox(a,box)||inBox(b,box))return true;
 return boxEdges(box).some(([c,d])=>{const h=G.lineIntersection(a,b,c,d);return h&&h.t>=-G.EPS&&h.t<=1+G.EPS&&h.u>=-G.EPS&&h.u<=1+G.EPS;});
}
/* 2026-09-24 검토 F2: 예전에는 켜와 무관하게 영역에 걸친 폴리선·사각형을 전부 낱개 선으로 폭파해 면적선(A-AREA)·도곽까지 깨졌다.
   폴리선은 "벽 폴리선"일 때만 참여한다 — WAL 이 만든 선(wallPreset/wallLayerName 표식)이거나 켜 이름에 WALL/벽 이 있는 것.
   참여하더라도 영역에 걸린 구간만 낱개 선으로 떼고, 걸리지 않은 연속 구간은 폴리선 조각으로 그대로 남긴다. */
const WALL_RE=/WALL|WAL\b|벽|CONC|조적|PART|칸막이/i;
// 해치·주석·면적 계열과 벽이 아닌 구조 부재(슬래브·보·기둥·기초·말뚝 · 검토자 재지적 ③)는 켜 이름에 CONC 가 있어도 벽으로 보지 않는다.
const NOT_WALL_RE=/PATT|HATCH|ANNO|TEXT|DIM|SYM|NOTE|TITLE|AREA|PAPER|WALLPAPER|SLAB|BEAM|GIRD|COLS?\b|COLUMN|FOOT|FDN|FOUND|PILE|슬래브|슬라브|기둥|기초|말뚝|보\b/i;
/** 벽 폴리선 판정(검토자 지적 7 반영): ① WAL 표식 ② 영역에 걸린 "선"들이 쓰는 켜와 같은 켜 ③ 켜 이름이 벽 계열(WALL/WAL/벽/CONC/조적/PART/칸막이)이고
 *  해치·주석·면적 계열(PATT/HATCH/ANNO/TEXT/DIM/AREA/WALLPAPER)이 아님. lineLayerIds 는 collectBoxLines 가 먼저 모은 선들의 켜 id 집합. */
export function isWallPolyline(e,layers=[],lineLayerIds=null){
 if(e.wallPreset||e.wallLayerName)return true;
 if(lineLayerIds&&lineLayerIds.has(e.layer))return true;
 const layer=(layers||[]).find(l=>l.id===e.layer);
 const name=layer?layer.name:String(e.layer||'');
 return WALL_RE.test(name)&&!NOT_WALL_RE.test(name);
}
/** 영역에 걸린 선을 모은다. 벽 폴리선·사각형은 걸린 구간만 낱개 선으로 나눠 참여시키고, 나머지 구간은 폴리선으로 남긴다(원본은 지운다). */
export function collectBoxLines(entities,corner1,corner2,layers=[]){
 const box=box2(corner1,corner2),center=new Set((layers||[]).filter(l=>CENTER_RE.test(l.name)||l.linetype==='CENTER').map(l=>l.id));
 const lines=[],removeIds=[],extra=[];
 const skip=e=>e.hidden||center.has(e.layer)||String(e.linetype||'').toUpperCase().includes('CENTER');
 // 선을 먼저 모아 그 켜들을 벽 켜의 기준으로 삼는다(폴리선은 그 켜와 같거나 벽 계열 이름일 때만 참여).
 for(const e of entities||[]){
  if(skip(e))continue;
  if(e.type==='line'&&e.points?.length===2&&segmentTouchesBox(e.points[0],e.points[1],box))lines.push({...structuredClone(e),sourceId:e.id});
 }
 const lineLayerIds=new Set(lines.map(l=>l.layer));
 for(const e of entities||[]){
  if(skip(e)||e.type==='line')continue;
  if((e.type==='polyline'||e.type==='rectangle')&&Array.isArray(e.points)&&e.points.length>=2&&!e.bulges?.some(Boolean)){
   if(!isWallPolyline(e,layers,lineLayerIds))continue;
   const segs=G.segments(e);const touched=segs.map(([a,b])=>segmentTouchesBox(a,b,box));
   if(!touched.some(Boolean))continue;
   removeIds.push(e.id);const {id,points,closed,type,bulges,...rest}=e;
   // 닫힌 폴리선은 걸리지 않은 구간이 처음·끝에 걸쳐 이어질 수 있어, 걸린 구간 다음부터 한 바퀴 돌며 연속 구간을 묶는다.
   const n=segs.length,start=(e.type==='rectangle'||e.closed)?((touched.indexOf(true)+1)%n):0;
   let run=[];
   const flushRun=()=>{if(!run.length)return;const pts=[run[0][0],...run.map(([,b])=>b)].map(p=>({x:p.x,y:p.y}));extra.push(pts.length===2?{...structuredClone(rest),type:'line',points:pts}:{...structuredClone(rest),type:'polyline',closed:false,points:pts});run=[];};
   for(let k=0;k<n;k++){
    const i=(start+k)%n,[a,b]=segs[i];
    if(touched[i]){flushRun();lines.push({...structuredClone(rest),type:'line',points:[{x:a.x,y:a.y},{x:b.x,y:b.y}],sourceId:null,exploded:e.id});}
    else run.push([a,b]);
   }
   flushRun();
  }
 }
 return {box,lines,removeIds,extra};
}
const dirOf=l=>G.unit(G.sub(l.points[1],l.points[0]));
const angleMod=l=>{const a=G.normalizeAngle(G.angle(dirOf(l)));return a>=180?a-180:a;};
/** 방향(180도 주기)으로 묶는다. 3도 안이면 같은 방향. */
export function groupByDirection(lines){
 const groups=[];
 for(const l of lines){const a=angleMod(l);let g=groups.find(g=>Math.min(Math.abs(g.angle-a),180-Math.abs(g.angle-a))<=3);if(!g){g={angle:a,lines:[]};groups.push(g);}g.lines.push(l);}
 return groups;
}
const strip=l=>{const {sourceId,exploded,...rest}=l;delete rest.id;return rest;};
const lineLen=l=>G.dist(l.points[0],l.points[1]);
const paramOf=(l,p)=>{const v=G.sub(l.points[1],l.points[0]);return G.dot(G.sub(p,l.points[0]),v)/G.dot(v,v);};
const pointAt=(l,t)=>G.add(l.points[0],G.mul(G.sub(l.points[1],l.points[0]),t));
const infIntersect=(a,b)=>{const h=G.lineIntersection(a.points[0],a.points[1],b.points[0],b.points[1]);return h?h.point:null;};
/** 선의 [ta,tb] 매개변수 구간을 잘라내고 남는 조각들 */
export function breakBetween(l,pa,pb,minLen=0.5){
 const ta=Math.min(paramOf(l,pa),paramOf(l,pb)),tb=Math.max(paramOf(l,pa),paramOf(l,pb)),out=[];
 if(ta>G.EPS)out.push({...strip(l),points:[l.points[0],pointAt(l,Math.min(1,ta))]});
 if(tb<1-G.EPS)out.push({...strip(l),points:[pointAt(l,Math.max(0,tb)),l.points[1]]});
 return out.filter(e=>lineLen(e)>minLen);
}

/** L형: 두 방향의 선을 안쪽부터 짝지어 모서리에서 만나게 한다(연장·자름 모두). */
export function filletL(lines,box,inside){
 const groups=groupByDirection(lines);
 if(groups.length!==2)throw Error(`L형 정리는 두 방향의 벽선이 필요합니다 (지금 ${groups.length} 방향).`);
 const rank=g=>{const n=G.normal(dirOf(g.lines[0]));return [...g.lines].sort((a,b)=>Math.abs(G.dot(G.sub(a.points[0],inside),n))-Math.abs(G.dot(G.sub(b.points[0],inside),n)));};
 const A=rank(groups[0]),B=rank(groups[1]),n=Math.min(A.length,B.length),used=new Set(),add=[];
 for(let i=0;i<n;i++){
  try{const parts=G.corner(A[i],B[i],0);add.push(...parts.map(p=>({...strip(p)})));used.add(A[i]);used.add(B[i]);}catch{}
 }
 if(!used.size)throw Error('만나게 할 수 있는 벽선 짝이 없습니다. 영역을 모서리 안쪽에서 바깥쪽으로 다시 지정하세요.');
 return {used:[...used],add,skipped:A.length+B.length-used.size};
}
/** T형: 영역을 관통하는 벽(통과선)에 끝점이 영역 안인 벽(가지선)을 붙이고, 가장 가까운 통과선을 가지 폭만큼 끊는다. */
export function filletT(lines,box){
 const through=lines.filter(l=>!inBox(l.points[0],box)&&!inBox(l.points[1],box)),branch=lines.filter(l=>inBox(l.points[0],box)!==inBox(l.points[1],box));
 if(!through.length||!branch.length)throw Error('T형 정리는 영역을 지나가는 벽선과 끝이 영역 안에 있는 벽선이 함께 필요합니다.');
 const add=[],used=new Set(),hitsOn=new Map();
 for(const b of branch){
  const inner=inBox(b.points[0],box)?0:1,e=b.points[inner],o=b.points[1-inner];
  // 2026-09-24 검토 F3: 가지선 끝이 통과 벽 두께 띠 "안쪽"에서 끝나면 안쪽 끝점과 두 면의 거리가 같아 먼 면을 고르는 일이 있었다.
  // 가지선이 바깥 끝(o)에서 들어오며 처음 만나는 면, 즉 o 에서 가장 가까운 통과선(가지선 진행 방향 앞쪽)을 고른다.
  let best=null,bd=Infinity;
  const dir=G.unit(G.sub(e,o));
  for(const t of through){if(Math.abs(G.cross(dirOf(t),dirOf(b)))<1e-3)continue;const i=infIntersect(t,b);if(!i)continue;const ahead=G.dot(G.sub(i,o),dir);if(ahead<-G.EPS)continue;const d=G.dist(i,o);if(d<bd){bd=d;best={t,i};}}
  if(!best)continue;
  const pts=inner===0?[best.i,o]:[o,best.i];add.push({...strip(b),points:pts});used.add(b);
  if(!hitsOn.has(best.t))hitsOn.set(best.t,[]);hitsOn.get(best.t).push(best.i);
 }
 if(!used.size)throw Error('붙일 수 있는 벽선이 없습니다.');
 for(const [t,pts] of hitsOn){if(pts.length<2)continue;const ts=pts.map(p=>paramOf(t,p));const a=pointAt(t,Math.min(...ts)),z=pointAt(t,Math.max(...ts));add.push(...breakBetween(t,a,z));used.add(t);}
 return {used:[...used],add,skipped:lines.length-used.size};
}
/** X형: 두 방향의 벽선이 교차하는 곳에서 서로의 바깥선 사이 구간을 끊는다. */
export function filletX(lines,box){
 const groups=groupByDirection(lines);
 if(groups.length!==2)throw Error(`X형 정리는 두 방향의 벽선이 필요합니다 (지금 ${groups.length} 방향).`);
 const [A,B]=groups.map(g=>g.lines),add=[],used=new Set();
 const breakGroup=(lines,others)=>{
  for(const l of lines){
   const pts=others.map(o=>infIntersect(l,o)).filter(Boolean).filter(p=>{const t=paramOf(l,p);return t>-1e-6&&t<1+1e-6;});
   if(pts.length<2)continue;
   const ts=pts.map(p=>paramOf(l,p));add.push(...breakBetween(l,pointAt(l,Math.min(...ts)),pointAt(l,Math.max(...ts))));used.add(l);
  }
 };
 breakGroup(A,B);breakGroup(B,A);
 if(!used.size)throw Error('교차하는 벽선 짝이 없습니다. 교차부를 감싸도록 영역을 지정하세요.');
 return {used:[...used],add,skipped:lines.length-used.size};
}
/** 한 번의 영역 지정에 대한 전체 결과. kind: 'FL'|'FT'|'FX' */
export function wallFilletOnce(kind,entities,c1,c2,layers=[]){
 const {box,lines,removeIds,extra}=collectBoxLines(entities,c1,c2,layers);
 if(!lines.length)throw Error('영역 안에 벽선이 없습니다. 중심선만 있으면 정리할 수 없습니다.');
 const r=kind==='FL'?filletL(lines,box,c1):kind==='FT'?filletT(lines,box):filletX(lines,box);
 const usedSet=new Set(r.used);
 const remove=[...removeIds,...r.used.filter(l=>l.sourceId).map(l=>l.sourceId)];
 const add=[...r.add,...extra,...lines.filter(l=>!usedSet.has(l)&&l.exploded).map(strip)];
 return {removeIds:remove,add,touched:r.used.length,skipped:r.skipped};
}

export function installWallFilletCards(ctx){
 const NAMES={FL:'L형 벽체 정리',FT:'T형 벽체 정리',FX:'X형 벽체 정리'};
 const HINT={FL:'모서리 안쪽에서 시작해 바깥쪽으로',FT:'T자 왼쪽 아래에서 오른쪽 위로',FX:'교차부를 감싸도록'};
 async function run(kind){
  let done=0;
  for(;;){
   const preview=(points,cursor)=>points.length&&cursor?[{type:'polyline',closed:true,points:G.rectangle(points[0],cursor),previewColor:'#ff9f68'}]:[];
   const path=await ctx.pickPath({prompt:`${NAMES[kind]} · 사각형 영역 두 점 (${HINT[kind]}) · 중심선 자동 제외 · Esc 끝내기${done?' · 지금까지 '+done+'곳':''}`,preview,minPoints:2,maxPoints:2});
   if(!path)break;
   try{
    const r=wallFilletOnce(kind,ctx.entities(),path.points[0],path.points[1],ctx.layers());
    ctx.commit({removeIds:r.removeIds,entities:r.add});done++;
    ctx.toast(`${NAMES[kind]} · 벽선 ${r.touched}개 정리${r.skipped?' · '+r.skipped+'개는 그대로':''} · 계속 지정하거나 Esc`);
   }catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}
  }
  if(done)ctx.toast(`${NAMES[kind]} 끝 · ${done}곳 · Ctrl+Z 로 한 곳씩 되돌리기`);
 }
 return {FL:()=>run('FL'),FT:()=>run('FT'),FX:()=>run('FX')};
}
