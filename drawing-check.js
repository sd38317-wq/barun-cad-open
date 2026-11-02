// 도면 확인(2026-10-22 대표 결정, docs/도면알아보기/결정기록.md · 시안 docs/시안-도면확인-2026-10-22).
// 받은 도면을 열면 레이어 이름 목록 대신, 우리 기능이 실제로 읽는 것(3D 모형·단면, 법규 검토)을 찾았는지 보여 주고
// 빠진 것만 직원이 도면에서 짚게 한다.
//  - 목록에 없는 레이어는 그대로 둔다(뜻을 맞히지 않음).
//  - 짚은 것은 그 선 묶음만 옮기는 것이 기본이고, 기억은 기본이 '이번 도면만'이다. 짧은 이름은 사무소 사전에 못 올린다.
import {layerExactKey} from './layer-name-groups.js';
import * as G from './geometry.js';
import {zoneOf} from './livecheck-auto.js';
import {STANDARD_LAYERS} from './layer-standards.js';

// 실 이름 낱말: 3D 모형(compute/plan-to-model.js, 바른 서버에서만 도는 계산)과 같은 목록. 화면에서는 그 파일을 못 가져오므로 여기 둔다 — 시험이 둘이 같은지 지킨다.
export const ROOM_WORDS=/실|방|욕|화장|주방|부엌|거실|현관|발코니|다용도|드레스|홀|복도|창고|침실|안방|식당|사무|회의|로비|기계|전기|계단|ROOM|BATH|LIVING|KITCHEN/i;

/** 사무소 사전에 올려도 되는 이름인가: '0'·W·IN 처럼 짧거나 숫자뿐이거나 출력 안 하는 레이어는 도면마다 뜻이 달라 기억하지 않는다. */
export function rememberAllowed(name){
 const key=layerExactKey(name);
 return key.length>=(/[가-힣]/.test(key)?2:3)&&!/^\d+$/.test(key)&&key!=='DEFPOINTS';   // 한글은 두 글자(창호·계단)도 뜻이 분명
}

const len=([a,b])=>Math.hypot(b.x-a.x,b.y-a.y);
/** 곧은 선 하나로 된 객체면 그 선분(계단 디딤판 후보). */
const single=e=>{const s=e.type==='line'||e.type==='polyline'&&!e.closed?G.segments(e):[];return s.length===1?s[0]:null;};

/** 계단 디딤판 묶음: 누른 선과 같은 길이(±60mm)·같은 방향(3° 안)·같은 줄의 선이 150~400mm 간격으로 4개 이상 이어진 것. */
function stairRun(pickedSeg,candidates){
 const [a,b]=pickedSeg,L0=len(pickedSeg),ux=(b.x-a.x)/L0,uy=(b.y-a.y)/L0;
 const along=p=>(p.x-a.x)*ux+(p.y-a.y)*uy,across=p=>-(p.x-a.x)*uy+(p.y-a.y)*ux;
 const rows=[];
 for(const {e,s} of candidates){
  const L=len(s);if(Math.abs(L-L0)>60)continue;
  if(Math.abs(((s[1].x-s[0].x)*uy-(s[1].y-s[0].y)*ux)/L)>Math.sin(Math.PI/60))continue;
  const mid={x:(s[0].x+s[1].x)/2,y:(s[0].y+s[1].y)/2};if(Math.abs(along(mid)-L0/2)>L0*.25)continue;
  rows.push({e,off:across(mid)});
 }
 rows.sort((p,q)=>p.off-q.off);
 const i=rows.findIndex(r=>Math.abs(r.off)<1e-6);if(i<0)return null;
 let lo=i,hi=i;const ok=(p,q)=>{const g=q.off-p.off;return g>=150&&g<=400;};
 while(lo>0&&ok(rows[lo-1],rows[lo]))lo--;while(hi<rows.length-1&&ok(rows[hi],rows[hi+1]))hi++;
 return hi-lo+1>=4?rows.slice(lo,hi+1).map(r=>r.e.id):null;
}

/** 직원이 도면에서 누른 객체로 옮길 묶음을 정한다. 레이어 전체가 아니라 그 선 묶음이 기본(섞인 레이어 대비). */
export function pickGroup(doc,id){
 const e=doc.entities.find(x=>x.id===id);if(!e)return null;
 const layer=doc.layers.find(l=>l.id===e.layer),sameLayer=doc.entities.filter(x=>x.layer===e.layer&&!x.hidden);
 const base={layerId:e.layer,layerName:layer?.name||'',layerCount:sameLayer.length};
 const seg=single(e);
 if(seg){
  const run=stairRun(seg,sameLayer.map(x=>({e:x,s:single(x)})).filter(x=>x.s));
  if(run)return {...base,ids:run,how:'같은 간격 평행선'};
 }
 // 문 열림 호: 호와, 경첩(호 중심)에서 반지름만큼 뻗은 문짝만. 호 끝에 붙은 창틀까지 끌고 오지 않는다.
 if(e.type==='arc'&&e.center){const leaf=sameLayer.filter(x=>{const s=single(x);if(!s)return false;const near=Math.min(Math.hypot(s[0].x-e.center.x,s[0].y-e.center.y),Math.hypot(s[1].x-e.center.x,s[1].y-e.center.y));return near<=30&&Math.abs(len(s)-e.radius)<=Math.max(60,e.radius*.1);});
  return {...base,ids:[id,...leaf.map(x=>x.id)],how:leaf.length?'열림 호와 문짝':'한 개'};}
 const chain=connected(e,sameLayer);
 return {...base,ids:chain,how:chain.length>1?'이어진 선':'한 개'};
}

/** 끝점이 1mm 안으로 이어진 같은 레이어 선들(벽 한 줄기·창 한 짝처럼). 너무 크면 2,000개에서 멈춘다. */
function connected(start,pool){
 const ends=e=>{if(e.type==='arc'&&e.center){const at=a=>({x:e.center.x+e.radius*Math.cos(a*Math.PI/180),y:e.center.y+e.radius*Math.sin(a*Math.PI/180)});return [e.center,at(e.startAngle),at(e.endAngle)];}   // 호: 경첩(중심)·양 끝
  const ps=e.points||[];return ps.length?[ps[0],ps.at(-1)]:[];};
 const key=p=>Math.round(p.x)+','+Math.round(p.y),byEnd=new Map();
 for(const e of pool)for(const p of ends(e)){const k=key(p);if(!byEnd.has(k))byEnd.set(k,[]);byEnd.get(k).push(e);}
 const seen=new Set([start.id]),queue=[start];
 while(queue.length&&seen.size<2000){const e=queue.shift();for(const p of ends(e))for(const n of byEnd.get(key(p))||[])if(!seen.has(n.id)){seen.add(n.id);queue.push(n);}}
 return [...seen];
}

/** 건물 외곽(법규 검토용 닫힌 선)을 벽·창·문 선으로 만든다.
    선을 칸 그림(50mm~)에 그리고, 선에서 R 만큼 떨어진 곳까지를 벽으로 보고 도면 바깥에서 물을 부어 닿지 않는 곳을 건물로 본다.
    다시 R 만큼 깎아 벽 바깥 면에 맞춘 뒤 그 둘레를 닫힌 선으로 만든다.
    R=150mm 로 안 닫히면(문 없는 통로) R=1.2m(틈 2.4m 이하)로 한 번 더 — 그때는 gaps:true 로 알린다.
    그래도 바깥이 안으로 새면 closed:false — 사각형으로 꾸며 내지 않는다. */
export function wallOutline(entities){
 const segs=entities.flatMap(pieces).filter(([a,b])=>a&&b);
 if(!segs.length)return {points:[],closed:false,gaps:false};
 const xs=segs.flatMap(([a,b])=>[a.x,b.x]),ys=segs.flatMap(([a,b])=>[a.y,b.y]);
 const min=v=>v.reduce((a,b)=>a<b?a:b),max=v=>v.reduce((a,b)=>a>b?a:b);   // 선이 수만 개여도 펼치지 않게
 const pad=2000,x0=min(xs)-pad,y0=min(ys)-pad,spanX=max(xs)+pad-x0,spanY=max(ys)+pad-y0;
 const px=Math.max(50,Math.max(spanX,spanY)/1200),nx=Math.ceil(spanX/px)+1,ny=Math.ceil(spanY/px)+1,N=nx*ny;
 const line=new Uint8Array(N);
 for(const [a,b] of segs){
  const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/(px/2)));
  for(let s=0;s<=n;s++){const i=Math.round((a.x+(b.x-a.x)*s/n-x0)/px),j=Math.round((a.y+(b.y-a.y)*s/n-y0)/px);if(i>=0&&j>=0&&i<nx&&j<ny)line[j*nx+i]=1;}
 }
 const fromLine=distance(line,nx,ny),box=(max(xs)-min(xs))*(max(ys)-min(ys));
 let last={points:[],closed:false,gaps:false};
 for(const R of [150,1200]){
  const r=R/px,out=new Uint8Array(N),stack=[];
  for(let i=0;i<nx;i++)stack.push(i,(ny-1)*nx+i);for(let j=0;j<ny;j++)stack.push(j*nx,j*nx+nx-1);
  while(stack.length){const k=stack.pop();if(out[k]||fromLine[k]<=r)continue;out[k]=1;const i=k%nx;if(i>0)stack.push(k-1);if(i<nx-1)stack.push(k+1);if(k>=nx)stack.push(k-nx);if(k<N-nx)stack.push(k+nx);}
  const fromOut=distance(out,nx,ny),inside=new Uint8Array(N);
  for(let k=0;k<N;k++)inside[k]=!out[k]&&fromOut[k]>r?1:0;
  const ring=traceLargest(inside,nx,ny);if(!ring)continue;
  const points=simplify(ring.map(([i,j])=>({x:x0+i*px,y:y0+j*px})),px);
  // 틈으로 샌 평면은 벽 자리만 남아 넓이가 아주 작다
  last={points,closed:points.length>=3&&Math.abs(G.polygonArea(points))>=.3*box,gaps:R>150};
  if(last.closed)return last;
 }
 return {...last,closed:false};
}

/** 칸마다 표시된 칸(mask=1)까지의 거리(칸 수, 3-4 체임퍼 근사). */
function distance(mask,nx,ny){
 const d=new Float32Array(nx*ny),INF=1e9,D=1,E=Math.SQRT2;
 for(let k=0;k<d.length;k++)d[k]=mask[k]?0:INF;
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const k=j*nx+i;let v=d[k];
  if(i>0)v=Math.min(v,d[k-1]+D);if(j>0){v=Math.min(v,d[k-nx]+D);if(i>0)v=Math.min(v,d[k-nx-1]+E);if(i<nx-1)v=Math.min(v,d[k-nx+1]+E);}d[k]=v;}
 for(let j=ny-1;j>=0;j--)for(let i=nx-1;i>=0;i--){const k=j*nx+i;let v=d[k];
  if(i<nx-1)v=Math.min(v,d[k+1]+D);if(j<ny-1){v=Math.min(v,d[k+nx]+D);if(i<nx-1)v=Math.min(v,d[k+nx+1]+E);if(i>0)v=Math.min(v,d[k+nx-1]+E);}d[k]=v;}
 return d;
}

/** 외곽을 막는 선분: 블록은 안의 선(이미 도면 좌표)까지, 호·원은 잘게 나눈 선으로(문 열림 호가 문 틈을 막는다). */
function pieces(e){
 if(Array.isArray(e.entities))return e.entities.flatMap(pieces);
 if((e.type==='arc'||e.type==='circle')&&e.center&&e.radius>0){
  const a0=e.type==='arc'?e.startAngle:0;let a1=e.type==='arc'?e.endAngle:360;if(a1<=a0)a1+=360;
  const n=Math.max(4,Math.ceil((a1-a0)/10)),pt=a=>({x:e.center.x+e.radius*Math.cos(a*Math.PI/180),y:e.center.y+e.radius*Math.sin(a*Math.PI/180)});
  return [...Array(n)].map((_,i)=>[pt(a0+(a1-a0)*i/n),pt(a0+(a1-a0)*(i+1)/n)]);
 }
 return G.segments(e);
}

/** 가장 큰 덩어리의 바깥 둘레를 칸 꼭짓점을 따라 돈다(칸 가장자리 선분을 이어 붙임). */
function traceLargest(mask,nx,ny){
 const label=new Int32Array(nx*ny),sizes=[0];let best=0;
 for(let k=0;k<nx*ny;k++){
  if(!mask[k]||label[k])continue;const id=sizes.length,stack=[k];let n=0;label[k]=id;
  while(stack.length){const c=stack.pop();n++;const i=c%nx,j=(c-i)/nx;for(const d of [i>0?c-1:-1,i<nx-1?c+1:-1,j>0?c-nx:-1,j<ny-1?c+nx:-1])if(d>=0&&mask[d]&&!label[d]){label[d]=id;stack.push(d);}}
  sizes.push(n);if(n>sizes[best]||!best)best=id;
 }
 if(!best)return null;
 // 덩어리 칸의 네 변 중 이웃이 덩어리가 아닌 변을 반시계로 모아 잇는다
 const inC=(i,j)=>i>=0&&j>=0&&i<nx&&j<ny&&label[j*nx+i]===best,next=new Map(),K=(i,j)=>i+','+j;
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
  if(!inC(i,j))continue;
  if(!inC(i,j-1))next.set(K(i,j),[i+1,j]);
  if(!inC(i+1,j))next.set(K(i+1,j),[i+1,j+1]);
  if(!inC(i,j+1))next.set(K(i+1,j+1),[i,j+1]);
  if(!inC(i-1,j))next.set(K(i,j+1),[i,j]);
 }
 // 가장 아래 줄 가장 왼쪽 꼭짓점에서 출발하면 바깥 둘레다
 let start=null;for(const k of next.keys()){const [i,j]=k.split(',').map(Number);if(!start||j<start[1]||j===start[1]&&i<start[0])start=[i,j];}
 const ring=[start];let cur=next.get(K(...start));
 while(cur&&!(cur[0]===start[0]&&cur[1]===start[1])&&ring.length<nx*ny){ring.push(cur);cur=next.get(K(...cur));}
 return ring;
}

/** 꺾이지 않는 점은 빼고(Douglas-Peucker, 허용 tol) 닫힌 꼭짓점만 남긴다. */
function simplify(ps,tol){
 const dp=(a,b)=>{let m=-1,k=-1;for(let i=a+1;i<b;i++){const d=G.distanceToSegment(ps[i],ps[a],ps[b]);if(d>m){m=d;k=i;}}return m>tol?[...dp(a,k),...dp(k,b).slice(1)]:[ps[a],ps[b]];};
 if(ps.length<4)return ps;
 const half=Math.floor(ps.length/2),out=[...dp(0,half),...dp(half,ps.length-1).slice(1)];
 return out.slice(0,-1).length>=3?out.filter((p,i)=>i<out.length-1||Math.hypot(p.x-out[0].x,p.y-out[0].y)>tol):out;
}

// 기능마다 읽는 것(2026-10-22 코드 확인, docs/도면알아보기/계획.md 1절 표). labels = 표준 레이어 분류 이름.
export const CHECK_GROUPS=Object.freeze([
 {key:'model',title:'3D 모형 · 단면',uses:'평면을 3D 모형으로 세워 단면·입면을 그림',items:[
  {key:'wall',name:'벽',labels:['벽체','콘크리트벽','조적','칸막이','벽돌 벽체']},
  {key:'window',name:'창',labels:['창호']},
  {key:'door',name:'문',labels:['문']},
  {key:'stair',name:'계단',labels:['계단']},
  {key:'room',name:'실 이름'},
  {key:'height',name:'층 높이'}]},
 {key:'law',title:'법규 검토',uses:'건폐율·용적률·정북 일조·건축선',items:[
  {key:'site',name:'대지 경계',labels:['대지']},
  {key:'building',name:'건물 외곽',labels:['건물 1층 외곽','건물 상층 외곽']},
  {key:'zone',name:'용도지역'},
  {key:'bline',name:'건축선',labels:['건축선']},
  {key:'north',name:'정북'}]},
]);
const LABEL_OF_LAYER=new Map(STANDARD_LAYERS.map(l=>[l.name.toUpperCase(),l.label]));
const isClosed=e=>e.type==='rectangle'||(e.type==='polyline'||e.type==='hatch')&&e.closed&&e.points?.length>=3;
const textOf=e=>e.type==='text'||e.type==='mtext'?String(e.text??'').trim():null;
let outlineCache={key:'',value:null};

/** 도면 확인 목록. decisions = 레이어 정리 결정(적용 예정 포함), marks = 직원이 '이 도면에 없음'으로 넘긴 항목, zone = 직원이 고른 용도지역.
    상태: ok(찾음) · miss(없으면 그 기능이 안 돎/빠짐) · none(없어도 기본값으로 돎, 또는 이 도면에 없음). */
export function checkDrawing(doc,decisions=[],{marks={},zone=''}={}){
 const layers=new Map(doc.layers.map(l=>[l.id,l])),decided=new Map(decisions.filter(d=>d.accepted&&d.label).map(d=>[d.id,d.label]));
 const labelOf=e=>decided.get(e.id)||LABEL_OF_LAYER.get(String(layers.get(e.layer)?.name||'').toUpperCase())||null;
 const live=doc.entities.filter(e=>!e.hidden&&layers.get(e.layer)?.visible!==false&&!layers.get(e.layer)?.frozen);
 const withLabel=labels=>live.filter(e=>labels.includes(labelOf(e)));
 const names=es=>[...new Set(es.map(e=>layers.get(e.layer)?.name||'기본'))].slice(0,2).join('·');
 const found=(es,unit='개')=>({status:'ok',count:es.length,detail:`${es.length}${unit} (${names(es)})`,ids:es.map(e=>e.id)});
 const miss=detail=>({status:'miss',count:0,detail,ids:[]});
 const none=detail=>({status:'none',count:0,detail,ids:[]});
 const sites=live.filter(e=>isClosed(e)&&(e.parcelRole==='site'||labelOf(e)==='대지'));
 const rules={
  room:()=>{const es=live.filter(e=>{const t=textOf(e);return t&&t.length<=16&&ROOM_WORDS.test(t);});return es.length?found(es,'곳'):miss('못 찾음');},
  height:()=>doc.reviewSettings?.floorHeight>0?{status:'ok',count:1,detail:`${doc.reviewSettings.floorHeight/1000}m (설정)`,ids:[]}
   :live.some(e=>/(\d+)\s*(?:층|F)\s*(?:바닥\s*)?(SL|FL)/i.test(textOf(e)||''))?{status:'ok',count:1,detail:'단면 레벨 글자',ids:[]}:none('없음 → 3m 로 가정'),
  site:()=>sites.length?found(sites):miss('못 찾음'),
  building:()=>{
   const drawn=withLabel(['건물 1층 외곽','건물 상층 외곽']).filter(isClosed);if(drawn.length)return found(drawn);
   const walls=withLabel(['벽체','콘크리트벽','조적','칸막이','벽돌 벽체']);if(!walls.length)return miss('벽을 먼저 찾아야 함');
   const parts=[...walls,...withLabel(['창호','문'])],key=parts.map(e=>e.id).sort().join();
   if(outlineCache.key!==key)outlineCache={key,value:wallOutline(parts)};
   return outlineCache.value.closed?{status:'ok',count:1,detail:outlineCache.value.gaps?'벽 둘레로 만듦 · 2.4m 이하 틈은 막음':'벽 둘레로 만듦',ids:[],outline:outlineCache.value.points}:miss('벽 둘레가 닫히지 않음');
  },
  zone:()=>{const z=sites.map(e=>zoneOf(e.attributes?.landInfo)).find(Boolean)||doc.siteAnalysis?.manualZone||doc.reviewSettings?.manualZone||zone;
   return z?{status:'ok',count:1,detail:z,ids:[]}:miss('없음');},
  bline:()=>{const es=withLabel(['건축선']).filter(isClosed);return es.length?found(es):none('없음 → 대지 경계로');},
  north:()=>Number.isFinite(doc.drawingGeo?.rotationDeg)||sites.some(e=>e.attributes?.northVector)?{status:'ok',count:1,detail:'도면 방향 정보',ids:[]}:none('없음 → 도면 위쪽'),
 };
 const groups=CHECK_GROUPS.map(g=>{
  const items=g.items.map(it=>{
   let r=rules[it.key]?rules[it.key]():(es=>es.length?found(es):miss('못 찾음'))(withLabel(it.labels));
   if(r.status==='miss'&&marks[it.key]==='none')r=none('이 도면에 없음');
   return {key:it.key,name:it.name,...r};
  });
  return {key:g.key,title:g.title,uses:g.uses,items,ready:items.every(i=>i.status!=='miss')};
 });
 return {groups,missing:groups.flatMap(g=>g.items).filter(i=>i.status==='miss').length};
}

// ── 남의 도면 읽기(바른 서버 FOREIGNREAD)와 합치기 (2026-10-22 대표 결정, 시안 docs/시안-도면확인합치기-2026-10-22) ──
//  로그인 상태면 서버가 읽은 결과(벽 줄·창문 구멍·실 다각형·계단·벽 중심선 외곽)로 체크 목록을 채운다.
//  벽 레이어만은 서버 1등을 '제안'으로 두고 직원이 확정한다. 서버가 스스로 의심하면(바닥 윤곽 두 방법 차이) 고르게 한다.
const DOUBT=/두 방법 차이|벽으로 닫힌 공간을 찾지/;
const m2=a=>(a/1e6).toFixed(1);

/** 서버 읽기 결과 한 층 → 체크 목록. local = checkDrawing 결과(대지·용도지역·건축선·정북·층 높이는 도면에서 그대로). */
export function serverChecks(read,{floor=0,wallSource='server',wallNames=null,marks={},local=null}={}){
 const f=read.floors[floor]||{runs:[],rooms:[],walls:[],unresolved:[]},runs=f.runs||[],rooms=f.rooms||[],open=runs.flatMap(w=>w.openings||[]);
 const doubt=(f.unresolved||[]).find(u=>DOUBT.test(u.reason));
 const name=(wallNames||[f.wallLayer].flat()).filter(Boolean).join('·')||'없음',score=(f.layerScores||[]).find(s=>[s.layer].flat().join()===[f.wallLayer].flat().join())?.area;
 const item=(key,label,r)=>({key,name:label,ids:[],count:0,...r,...(r.status==='miss'&&marks[key]==='none'?{status:'none',detail:'이 도면에 없음'}:{})});
 const wall=wallSource!=='server'?{status:'ok',count:runs.length,detail:`${name} · ${runs.length}줄`,source:wallSource==='dictionary'?'사무소 사전':'직원이 고름'}
  :!runs.length||doubt?{status:'miss',count:runs.length,detail:`${name} · 서버 1등${doubt?' — '+doubt.reason.split(' — ')[0]:' — 벽을 못 찾음'}`,source:'서버 읽기',doubt:true}
  :{status:'sug',count:runs.length,detail:`${name} · 닫힌 면적 ${score?.toFixed?.(0)??'?'}㎡ 로 1등`,source:'서버 읽기'};
 const holes=kind=>{const n=open.filter(o=>(o.kind==='door')===(kind==='door')).length;return n?{status:'ok',count:n,detail:`${n}곳 · 벽 구멍으로`,source:'서버 읽기'}:{status:'miss',detail:'못 찾음'};};
 const stairs=rooms.filter(r=>r.stair),plain=rooms.filter(r=>!r.stair),unnamed=plain.filter(r=>!r.name),first=plain.filter(r=>r.name).sort((a,b)=>b.area-a.area)[0];
 const env=f.outline?.envelope?.length>=3?f.outline.envelope:f.outline?.points;
 const localItem=key=>local?.groups.flatMap(g=>g.items).find(i=>i.key===key);
 const model=[item('wall','벽',wall),item('window','창',holes('window')),item('door','문',holes('door')),
  item('stair','계단',stairs.length?{status:'ok',count:stairs.length,detail:`${stairs.length}곳`,source:'서버 읽기'}:{status:'miss',detail:'못 찾음'}),
  item('room','실',plain.length?{status:'ok',count:plain.length,detail:`${plain.length}개`+(first?` · ${first.name} ${m2(first.area)}㎡`+(plain.length>1?' 외':''):'')+(unnamed.length?` · 이름 없는 ${unnamed.length}개`:''),unnamed:unnamed.length,source:'서버 읽기'}:{status:'miss',detail:'못 찾음'}),
  localItem('height')||item('height','층 높이',{status:'none',detail:'없음 → 3m 로 가정'})];
 const law=[localItem('site')||item('site','대지 경계',{status:'miss',detail:'못 찾음'}),
  item('building','건물 외곽',env?{status:'ok',count:1,detail:`벽 중심선 ${m2(Math.abs(G.polygonArea(env)))}㎡`,outline:env,source:'서버 읽기'}:{status:'miss',detail:'벽 중심선 외곽 없음'}),
  localItem('zone')||item('zone','용도지역',{status:'miss',detail:'없음'}),
  localItem('bline')||item('bline','건축선',{status:'none',detail:'없음 → 대지 경계로'}),
  localItem('north')||item('north','정북',{status:'none',detail:'없음 → 도면 위쪽'})];
 const groups=[{key:'model',title:CHECK_GROUPS[0].title,uses:CHECK_GROUPS[0].uses,items:model},{key:'law',title:CHECK_GROUPS[1].title,uses:CHECK_GROUPS[1].uses,items:law}]
  .map(g=>({...g,ready:g.items.every(i=>i.status==='ok'||i.status==='none')}));
 // 확인 필요: 서버가 사람에게 묻는 것. 직원이 고른 것(marks)은 빠진다
 const confirm=[...(f.unresolved||[]).filter(u=>!DOUBT.test(u.reason)||wallSource!=='server').map((u,i)=>({key:`u${floor}-${i}`,kind:'note',text:u.reason})),
  ...(f.outline?.outdoorCandidates||[]).map((c,i)=>({key:`o${floor}-${i}`,kind:'outdoor',text:`실 밖 공간 ${m2(c.area)}㎡ — 바깥 발코니·테라스면 바닥면적에서 뺌`,points:c.points,area:c.area}))]
  .filter(c=>!marks[c.key]);
 if(doubt&&wallSource==='server')confirm.unshift({key:`d${floor}`,kind:'wall',text:doubt.reason});
 return {groups,missing:groups.flatMap(g=>g.items).filter(i=>i.status==='miss').length,confirm,floor:f};
}

export const MERGED_WALL_LAYER='도면확인-벽';
/** 서버는 벽 레이어를 이름 하나로만 받는다 → 고른 레이어들의 선을 임시 레이어 하나로 옮긴 사본을 보낸다(원본은 그대로). */
export function mergeWallLayers(doc,names){
 const want=new Set(names),ids=new Set(doc.layers.filter(l=>want.has(l.name)).map(l=>l.id)),id='drawing-check-wall';
 const move=e=>{const next=ids.has(e.layer)?{...e,layer:id}:e;return Array.isArray(e.entities)?{...next,entities:e.entities.map(move)}:next;};
 return {doc:{...doc,layers:[...doc.layers,{id,name:MERGED_WALL_LAYER,visible:true,locked:false,frozen:false}],entities:doc.entities.map(move)},layer:MERGED_WALL_LAYER};
}

/** 서버 읽기 결과 → 도면에 더할 것(아직 ID 없음). 적용은 architecture.applyForeignDrawing 한 번(되돌리기 한 번).
    roomNames: '층:실번호' → 직원이 넣은 이름. marks: 확인 필요 칸에서 직원이 고른 것(고른 실 밖 공간은 [확인] 표시를 남기지 않음). */
export function foreignAdditions(read,{floors=null,roomNames={},marks={}}={}){
 const out={walls:[],openings:[],rooms:[],outlines:[],outdoor:[],choices:[]};
 read.floors.forEach((f,fi)=>{
  if(floors&&!floors.includes(fi)||!(f.runs||[]).length)return;
  for(const w of f.runs){const wi=out.walls.length;out.walls.push({thickness:w.thickness,points:[w.start,w.end]});
   for(const o of w.openings||[])out.openings.push({wall:wi,kind:o.kind==='door'?'DOOR':'WINDOW',width:o.width,offset:o.offset});}
  (f.rooms||[]).forEach((r,ri)=>out.rooms.push({points:r.points,stair:!!r.stair,area:r.area,name:roomNames[`${fi}:${ri}`]||r.name||(r.stair?'계단':'실')}));
  const env=f.outline?.envelope?.length>=3?f.outline.envelope:f.outline?.points;
  if(env)out.outlines.push({points:env,label:f.label||'',area:f.outline.area});
  (f.outline?.outdoorCandidates||[]).forEach((c,i)=>{const k=`o${fi}-${i}`;if(marks[k])out.choices.push({key:k,area:c.area,choice:marks[k]});else out.outdoor.push({points:c.points,area:c.area});});
 });
 return out;
}
