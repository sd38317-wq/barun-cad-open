// 벽 그리기(WAL) · 미리 정해 둔 벽체 구성(중심선 기준 거리·켜·선종류·색)을 한 번에 그린다.
// izzarder.com/503 의 사용법을 바른 CAD 방식으로 옮긴 것이다. 벽체 끌기(D)는 dragWallBand 로 ㄷ자 끌기를 한다.
import * as G from './geometry.js';
import {wallFrame,cutWallBand,wallBandFilter,toWorld,toLocal,consumeCardRepeat,rememberCardGo} from './card-kit.js';

/** 벽체 끌기에서 손대지 않는(고정) 켜. 원문 기본값 CEN* 에 바른 CAD 표준 이름을 더했다. 와일드카드 * ? 허용, 콤마로 구분. */
export const WAL_FIXED_LAYERS_DEFAULT='A-WALL-C, A-GRID, CEN*';

export const WAL_STORAGE_KEY='barun-wal-presets';
export const WAL_SLOTS=20;
export const WAL_LINETYPES=[['CONTINUOUS','실선'],['CENTER','중심선'],['DASHED','파선'],['HIDDEN','숨은선'],['DOT','점선']];

const line=(d,layer,lt,color)=>({d,layer,lt,color});
export const WAL_SAMPLES=[
 {name:'조적벽 190',lines:[line(95,'A-WALL-MASN','CONTINUOUS','#ff7f00'),line(-95,'A-WALL-MASN','CONTINUOUS','#ff7f00')]},
 {name:'RC 200 외벽 · 단열 90 · 마감 12',lines:[line(202,'A-WALL-FNSH','CONTINUOUS','#00ffff'),line(190,'A-WALL-INSL','DASHED','#ff00ff'),line(100,'A-WALL-CONC','CONTINUOUS','#ffff00'),line(-100,'A-WALL-CONC','CONTINUOUS','#ffff00')]},
 {name:'RC 200 내벽',lines:[line(100,'A-WALL-CONC','CONTINUOUS','#ffff00'),line(-100,'A-WALL-CONC','CONTINUOUS','#ffff00')]},
 {name:'경량 칸막이 100',lines:[line(50,'A-WALL-PRTN','CONTINUOUS','#00ff00'),line(-50,'A-WALL-PRTN','CONTINUOUS','#00ff00')]},
];
WAL_SAMPLES[0].exposure=null;WAL_SAMPLES[0].thermalLayers=[{name:'조적',thicknessMm:190,lambda:null,lambdaSource:null,category:'masonry'}];
WAL_SAMPLES[1].exposure='direct';WAL_SAMPLES[1].thermalLayers=[{name:'RC',thicknessMm:200,lambda:null,lambdaSource:null,category:'concrete'},{name:'단열',thicknessMm:90,lambda:null,lambdaSource:null,category:'insulation'},{name:'마감',thicknessMm:12,lambda:null,lambdaSource:null,category:'finish'}];
WAL_SAMPLES[2].exposure=null;WAL_SAMPLES[2].thermalLayers=[{name:'RC',thicknessMm:200,lambda:null,lambdaSource:null,category:'concrete'}];
WAL_SAMPLES[3].exposure=null;WAL_SAMPLES[3].thermalLayers=null;

export function emptyPreset(){return {name:'',lines:[],thermalLayers:null,exposure:null};}

/** 저장된 프리셋. 없거나 깨졌으면 샘플로 시작한다. 항상 20칸을 유지한다. */
export function loadWalState(storage){
 let raw=null;try{raw=JSON.parse(storage?.getItem(WAL_STORAGE_KEY)||'null');}catch{raw=null;}
 const presets=[];
 for(let i=0;i<WAL_SLOTS;i++){
  const p=raw?.presets?.[i];
  presets.push(p&&typeof p==='object'?normalizePreset(p):(raw?emptyPreset():structuredClone(WAL_SAMPLES[i]||emptyPreset())));
 }
 return {
  presets,
  selected:Math.min(WAL_SLOTS-1,Math.max(0,Number(raw?.selected)||0)),
  byLayer:raw?.byLayer!==false,
  explode:!!raw?.explode,
  method:['center','points','drag'].includes(raw?.method)?raw.method:'center',
  fixedLayers:typeof raw?.fixedLayers==='string'?raw.fixedLayers:WAL_FIXED_LAYERS_DEFAULT,
 };
}
export function saveWalState(storage,state){
 try{storage?.setItem(WAL_STORAGE_KEY,JSON.stringify({presets:state.presets.map(normalizePreset),selected:state.selected,byLayer:state.byLayer,explode:state.explode,method:state.method,fixedLayers:state.fixedLayers}));}catch{}
}
export function normalizePreset(p){
 const lines=(Array.isArray(p.lines)?p.lines:[]).map(l=>({
  d:Number(l.d)||0,
  layer:String(l.layer||'').trim()||'A-WALL',
  lt:WAL_LINETYPES.some(([k])=>k===String(l.lt||'').toUpperCase())?String(l.lt).toUpperCase():'CONTINUOUS',
  color:/^#[0-9a-f]{6}$/i.test(String(l.color||''))?String(l.color).toLowerCase():'#ffd479',
 }));
 // 원문과 같이 최외곽(실외)부터 안쪽(실내) 순으로 정렬한다. 음수는 중심선 기준 실내측이다.
 lines.sort((a,b)=>b.d-a.d);
 const thermalLayers=Array.isArray(p.thermalLayers)?p.thermalLayers.map(x=>({name:String(x?.name||''),thicknessMm:Number.isFinite(Number(x?.thicknessMm))&&Number(x.thicknessMm)>0?Number(x.thicknessMm):null,lambda:typeof x?.lambdaSource==='string'&&x.lambdaSource.trim()&&Number.isFinite(Number(x?.lambda))&&Number(x.lambda)>0?Number(x.lambda):null,lambdaSource:typeof x?.lambdaSource==='string'&&x.lambdaSource.trim()?x.lambdaSource:null,category:x?.category==null?null:String(x.category)})):null;
 return {name:String(p.name||'').slice(0,40),lines,thermalLayers,exposure:['direct','indirect'].includes(p.exposure)?p.exposure:null};
}

/* ── 기하 ── */
const sub=(a,b)=>({x:a.x-b.x,y:a.y-b.y}),add=(a,b)=>({x:a.x+b.x,y:a.y+b.y}),mul=(a,k)=>({x:a.x*k,y:a.y*k});
const len=v=>Math.hypot(v.x,v.y),unit=v=>{const l=len(v)||1;return {x:v.x/l,y:v.y/l};},left=v=>({x:-v.y,y:v.x});

/** 중심선의 가장 가까운 구간을 기준으로 side 를 반대쪽으로 비춘 점. 실내측 선을 만들 때 쓴다. */
export function oppositeSide(center,side){
 let best=null,bd=Infinity;
 for(const [a,b] of G.segments(center)){const d=G.distanceToSegment(side,a,b);if(d<bd){bd=d;best=[a,b];}}
 if(!best)return side;
 const [a,b]=best,v=sub(b,a),l2=v.x*v.x+v.y*v.y||1,t=((side.x-a.x)*v.x+(side.y-a.y)*v.y)/l2,foot=add(a,mul(v,t));
 return sub(mul(foot,2),side);
}
/** 시계반대방향으로 찍은 경로의 실외(바깥) 쪽 점. 첫 구간의 오른쪽이다. */
export function exteriorSideOf(points){
 if(points.length<2)return null;
 const a=points[0],b=points[1],mid=mul(add(a,b),.5),n=left(unit(sub(b,a)));
 return sub(mid,mul(n,Math.max(10,len(sub(b,a))*.05)));
}
/** 클릭한 선에 끝점이 맞닿아 이어지는 선들을 한 경로(폴리선)로 묶는다.
 *  선을 여러 개로 그린 중심선도 꺾이는 곳이 자연스럽게 이어지게 하기 위해서다.
 *  갈림길(한 끝점에 선이 셋 이상)이나 벽 선 자체는 따라가지 않는다. */
export function chainCenterline(hit,entities,tolerance=0.5){
 if(!hit||hit.type!=='line')return hit;
 const same=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<=tolerance;
 const lines=(entities||[]).filter(e=>e.type==='line'&&e.id!==hit.id&&!e.wallPreset&&Array.isArray(e.points)&&e.points.length===2);
 const used=new Set([hit.id]);
 const touching=(p)=>lines.filter(e=>!used.has(e.id)&&(same(e.points[0],p)||same(e.points[1],p)));
 const walk=(from)=>{const out=[];let p=from;for(;;){const next=touching(p);if(next.length!==1)break;const e=next[0];used.add(e.id);p=same(e.points[0],p)?e.points[1]:e.points[0];out.push(p);}return out;};
 const a=hit.points[0],b=hit.points[1];
 const forward=walk(b),backward=walk(a).reverse();
 const points=[...backward,a,b,...forward];
 if(points.length===2)return hit;
 const closed=points.length>3&&same(points[0],points.at(-1));
 if(closed)points.pop();
 return {type:'polyline',points:points.map(p=>({x:p.x,y:p.y})),closed,chainedFrom:hit.id};
}
/** 프리셋 한 벌을 중심선(선·폴리선·사각형)에 얹은 선 객체들. 켜는 이름으로만 적고, 실제 켜 id 는 부를 때 넣는다. */
export function buildWallLines(center,side,preset,{explode=false,byLayer=true}={}){
 if(!center||!['line','polyline','rectangle'].includes(center.type))throw Error('중심선은 선·폴리선·사각형이어야 합니다.');
 if(!preset?.lines?.length)throw Error('선택한 벽체에 구성선이 없습니다. 구성 표에 거리를 입력하세요.');
 if(center.bulges?.some(b=>b))throw Error('곡선 구간이 있는 폴리선은 아직 지원하지 않습니다. 직선으로 나눈 뒤 선택하세요.');
 if(!Array.isArray(center.points)||center.points.length<2)throw Error('중심선에 점이 2개 이상 있어야 벽을 그릴 수 있습니다.');
 if(!side||!Number.isFinite(side.x)||!Number.isFinite(side.y))throw Error('벽의 실외(바깥) 쪽 점을 지정하세요.');
 const inner=oppositeSide(center,side),out=[];
 for(const spec of preset.lines){
  let e;
  if(Math.abs(spec.d)<G.EPS)e={...structuredClone(center)};
  else e=G.offsetEntity(center,Math.abs(spec.d),spec.d>0?side:inner);
  delete e.id;delete e.layer;delete e.hostWall;delete e.color;delete e.linetype;
  const style={linetype:spec.lt,...(byLayer?{}:{color:spec.color}),wallPreset:preset.name||undefined,wallLayerName:spec.layer,thermalLayers:preset.thermalLayers??null,exposure:preset.exposure??null};
  if(e.type==='rectangle'){e={type:'polyline',points:e.points,closed:true};}
  if(explode&&e.type==='polyline'){
   const pts=e.points,n=pts.length,count=e.closed?n:n-1;
   for(let i=0;i<count;i++)out.push({type:'line',points:[pts[i],pts[(i+1)%n]],...style});
  }else out.push({...e,...style});
 }
 return out;
}

/* ── 벽체 끌기(D) ── */
/** 원문의 와일드카드 켜 지정(예: "CEN*, A-GRID"). 대소문자 구분 없이 이름 전체가 맞아야 한다. */
export function matchesLayerPattern(name,patterns){
 const list=String(patterns||'').split(',').map(s=>s.trim()).filter(Boolean);
 return list.some(pat=>new RegExp('^'+pat.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.')+'$','i').test(String(name||'')));
}
/** 벽 띠(좌표계 f, 첫 벽선 d=0 · 반대 벽선 d=t) 안의 평행 벽선 중 [s0,s1] 구간을 delta 만큼 n 방향으로 ㄷ자로 끈다.
 *  끄는 쪽 반대 면이 안쪽 모서리가 되고, 바깥 켜는 안쪽 면에서 떨어진 만큼 더 넓게 둘러싼다(원문 그림과 같음).
 *  돌려주는 것: {removeIds, add} — 삭제할 원본 id 와 새로 넣을 선(켜·선종류·색은 원본을 따름). */
export function dragWallBand(entities,f,s0,s1,delta,{tol=0.5,fixedLayerIds=new Set(),layers=[]}={}){
 if(!(s1-s0>tol))throw Error('첫째·둘째 점 사이가 너무 좁습니다. 움직일 벽의 너비를 두 점으로 찍으세요.');
 if(Math.abs(delta)<=tol)throw Error('옮길 위치가 벽선과 같습니다. 벽에서 떨어진 점을 찍으세요.');
 const isWallLine=e=>['line','polyline','rectangle'].includes(e.type)&&!e.hidden&&Array.isArray(e.points)&&e.points.length>=2&&!e.bulges?.some(b=>b)&&!fixedLayerIds.has(e.layer);
 const canMove=wallBandFilter(entities,layers);
 const work=(entities||[]).filter(e=>isWallLine(e)&&canMove(e));
 const dInner=delta<0?f.t:0;
 // 띠 안 평행 구간을 켜 거리(d)별로 모은다.
 const bands=new Map();
 for(const e of work){
  for(const [a,b] of G.segments(e)){
   const v=G.sub(b,a);if(G.len(v)<G.EPS||Math.abs(G.cross(G.unit(v),f.u))>1e-4)continue;
   const la=toLocal(f,a),lb=toLocal(f,b);if(la.d<-tol||la.d>f.t+tol)continue;
   const lo=Math.min(la.s,lb.s),hi=Math.max(la.s,lb.s),ext=Math.abs(la.d-dInner);
   if(hi<=s0-ext+tol||lo>=s1+ext-tol)continue;
   const key=Math.round(la.d*10);if(!bands.has(key))bands.set(key,{d:la.d,ext,segs:[]});
   bands.get(key).segs.push({lo,hi,layer:e.layer,linetype:e.linetype,color:e.color,reviewObjectId:e.reviewObjectId,thermalLayers:e.thermalLayers,exposure:e.exposure});
  }
 }
 if(!bands.size)throw Error('세 점으로 만든 벽 띠 안에 평행한 벽선이 없습니다. 첫째·둘째 점은 한 벽선 위에, 셋째 점은 반대쪽 벽선 위에 찍으세요.');
 const originalIds=new Set(work.map(e=>e.id));
 let cur=work,tmp=0;const moved=[];
 for(const {d,ext,segs} of [...bands.values()].sort((p,q)=>p.d-q.d)){
  const a=s0-ext,b=s1+ext;
  const r=cutWallBand(cur,f,a,b,{dMin:d-tol,dMax:d+tol,tol,layers});
  const gone=new Set(r.removeIds);
  cur=[...cur.filter(e=>!gone.has(e.id)),...r.add.map(e=>({...e,id:'__wal_tmp'+(++tmp)}))];
  for(const seg of segs){
   const style={layer:seg.layer,thermalLayers:seg.thermalLayers??null,exposure:seg.exposure??null,...(seg.reviewObjectId?{reviewObjectId:seg.reviewObjectId}:{}),...(seg.linetype?{linetype:seg.linetype}:{}),...(seg.color?{color:seg.color}:{})};
   const from=Math.max(seg.lo,a),to=Math.min(seg.hi,b);
   if(to-from>tol)moved.push({type:'line',points:[toWorld(f,from,d+delta),toWorld(f,to,d+delta)],...style});
   if(seg.lo<a-tol)moved.push({type:'line',points:[toWorld(f,a,d),toWorld(f,a,d+delta)],...style});
   if(seg.hi>b+tol)moved.push({type:'line',points:[toWorld(f,b,d),toWorld(f,b,d+delta)],...style});
  }
 }
 const kept=new Set(cur.map(e=>e.id));
 const removeIds=[...originalIds].filter(id=>!kept.has(id));
 const pieces=cur.filter(e=>String(e.id).startsWith('__wal_tmp')).map(({id,...rest})=>rest);
 return {removeIds,add:[...pieces,...moved]};
}
const CENTER_LAYER_RE=/CNTR|GRID|CENTER|중심|(?:^|-)WALL-C(?:$|-)/i;
/** 점 p 에서 tolerance 안에 있고 방향 u 와 평행(약 3° 이내)한 가장 가까운 벽선 구간. 중심선 켜·선종류는 건너뛴다. */
export function nearestParallelSegment(entities,p,u,tolerance,layers=[]){
 const center=new Set((layers||[]).filter(l=>CENTER_LAYER_RE.test(l.name)||l.linetype==='CENTER').map(l=>l.id));
 let best=null,bd=tolerance;
 for(const e of entities||[]){
  if(!['line','polyline','rectangle'].includes(e.type)||e.hidden||e.bulges?.some(b=>b))continue;
  if(center.has(e.layer)||String(e.linetype||'').toUpperCase().includes('CENTER'))continue;
  for(const [a,b] of G.segments(e)){
   const v=G.sub(b,a);if(G.len(v)<G.EPS||Math.abs(G.cross(G.unit(v),u))>0.05)continue;
   const d=G.distanceToSegment(p,a,b);
   if(d<bd){bd=d;const t=Math.max(0,Math.min(1,G.dot(G.sub(p,a),v)/G.dot(v,v)));best={entity:e,a,b,foot:G.add(a,G.mul(v,t)),distance:d};}
  }
 }
 return best;
}
/** 네 점(①② 한 벽선 위 너비, ③ 반대 벽선, ④ 옮길 위치)에서 끌기 계산에 필요한 좌표계·구간·거리를 만든다. */
export function dragFrameFromPoints(entities,[p1,p2,p3,p4],tolerance,{fixedLayerIds=new Set(),layers=[]}={}){
 const usable=(entities||[]).filter(e=>!fixedLayerIds.has(e.layer));
 if(G.dist(p1,p2)<G.EPS)throw Error('첫째·둘째 점은 서로 다른 점이어야 합니다.');
 // 첫째→둘째 점 방향과 평행한 벽선에만 붙인다. 앞서 끌어 생긴 ㄷ자 연결선(수직선) 위에 점을 찍어도 벽 축이 뒤틀리지 않게.
 const u0=G.unit(G.sub(p2,p1));
 const h1=nearestParallelSegment(usable,p1,u0,tolerance,layers);
 let a=p1,b=p2;
 if(h1){a=h1.foot;const u=G.unit(G.sub(h1.b,h1.a));const along=G.dot(G.sub(p2,a),u);b=G.add(a,G.mul(u,Math.abs(along)<G.EPS?1:along));}
 const h3=nearestParallelSegment(usable,p3,G.unit(G.sub(b,a)),tolerance,layers);
 const f=wallFrame(a,b,h3?h3.foot:p3);
 f.snapped={first:h1?.entity||null,opposite:h3?.entity||null};
 const s1=Math.abs(G.dot(G.sub(p2,f.origin),f.u));
 const base=toWorld(f,s1/2,0);
 const delta=G.dot(G.sub(p4,base),f.n);
 return {f,s0:0,s1,delta};
}

/* ── 그림 ── */
/** 벽체 단면 그림. 위가 실외, 아래가 실내. 붉은 점선이 중심선이다. */
export function sectionSvg(preset,{width=280,height=150,compact=false}={}){
 const lines=preset?.lines||[],ds=lines.map(l=>l.d),span=Math.max(120,...ds.map(Math.abs))*1.15,k=(height/2-14)/span,cy=height/2;
 const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const rows=lines.map(l=>{
  const y=(cy-l.d*k).toFixed(1),dash=l.lt==='CONTINUOUS'?'':l.lt==='CENTER'?' stroke-dasharray="14 4 3 4"':l.lt==='DOT'?' stroke-dasharray="2 4"':' stroke-dasharray="8 5"';
  const label=compact?'':`<text x="${width-6}" y="${(Number(y)-3).toFixed(1)}" text-anchor="end" font-size="10" fill="${esc(l.color)}">${l.d>0?'+':''}${l.d} ${esc(l.layer)}</text>`;
  return `<line x1="8" y1="${y}" x2="${width-8}" y2="${y}" stroke="${esc(l.color)}" stroke-width="${compact?1.2:1.8}"${dash}/>${label}`;
 }).join('');
 const guide=compact?'':`<text x="8" y="12" font-size="10" fill="#9aa4b1">실외 ↑</text><text x="8" y="${height-4}" font-size="10" fill="#9aa4b1">실내 ↓</text>`;
 return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(preset?.name||'벽체')} 단면"><rect x="0" y="0" width="${width}" height="${height}" fill="#101820" rx="6"/><line x1="8" y1="${cy}" x2="${width-8}" y2="${cy}" stroke="#ff5a5a" stroke-width="1" stroke-dasharray="10 3 2 3"/>${rows}${guide}</svg>`;
}

/* ── 화면 ── */
/**
 * ctx: {storage, layers:()=>[...], ensureLayer:(name,color)=>id, addEntities:(list)=>ids, setSelected, pickEntity, pickPoint, pickPath, toast, userErrorMessage, run}
 * 돌려주는 함수는 WAL 카드/명령이 부른다.
 */
export function installWallPreset(ctx){
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
 let clipboard=null;
 return function openWallPreset(){
  if(ctx.scripted){
   const state=loadWalState(ctx.storage);
   return ctx.form('벽 그리기 · WALDRAW',[
    {name:'slot',label:'프리셋 칸 번호 (0~19)',type:'number',value:state.selected},
    {name:'method',label:'방식 (center / points / drag)',type:'text',value:state.method},
    {name:'lines',label:'구성선 [{d,layer,lt,color}] (생략하면 프리셋)',value:null},
    {name:'thermalLayers',label:'재료층 JSON (name,thicknessMm,lambda,lambdaSource,category)',value:null},
    {name:'exposure',label:'노출 (direct / indirect / 생략)',type:'text',value:null},
    {name:'byLayer',label:'켜 색 사용',value:state.byLayer},{name:'explode',label:'낱개 선으로',value:state.explode},
    {name:'fixedLayers',label:'끌기 예외 켜',type:'text',value:state.fixedLayers},
   ],async values=>{
    const slot=ctx.scripted.inputs.slot??values.slot,method=ctx.scripted.inputs.method??values.method;
    if(!Number.isInteger(slot)||slot<0||slot>=WAL_SLOTS)throw Error('벽 프리셋 slot은 0~19 정수입니다.');
    if(!['center','points','drag'].includes(method))throw Error('벽 방식은 center·points·drag 중 하나입니다.');
    if(values.lines!==null&&values.lines!==''&&(!Array.isArray(values.lines)||values.lines.some(l=>!l||!Number.isFinite(l.d))))throw Error('벽 구성선 lines는 유한한 거리 d를 가진 배열입니다.');
    const base=values.lines===null||values.lines===''?state.presets[slot]:(()=>{const lines=normalizePreset({lines:values.lines}).lines;const match=[state.presets[slot],...WAL_SAMPLES].find(p=>JSON.stringify(p.lines)===JSON.stringify(lines));return {name:match?.name||'사용자 구성',lines};})();
    let thermalLayers=base.thermalLayers,exposure=base.exposure;
    if(values.thermalLayers!==null&&values.thermalLayers!=='')thermalLayers=JSON.parse(values.thermalLayers);
    if(values.exposure!==null&&values.exposure!=='')exposure=values.exposure;
    const preset=normalizePreset({...base,thermalLayers,exposure});
    if(method!=='drag'&&!preset.lines.length)throw Error('구성선이 없는 벽은 그릴 수 없습니다. lines 또는 다른 slot을 주세요.');
    return method==='drag'?dragWalls(values.fixedLayers):draw(preset,{method,byLayer:values.byLayer,explode:values.explode});
   });
  }
  {const again=consumeCardRepeat('wal');if(again){again.run();return again.state;}}
  const state=loadWalState(ctx.storage);
  const d=el('dialog','wal-dialog');
  const dismiss=()=>{try{d.close();}catch{}d.remove();};
  const header=el('div','dialog-header');const h2=el('h2',null,'벽 그리기 · WAL');const close=el('button',null,'닫기 ×');close.type='button';close.onclick=dismiss;header.append(h2,close);
  const body=el('div','wal-body');
  const list=el('div','wal-list');
  const editor=el('div','wal-editor');
  const preview=el('div','wal-preview');
  const nameRow=el('label','wal-name');nameRow.append(el('span',null,'분류(벽 이름)'));const nameInput=el('input');nameInput.type='text';nameInput.maxLength=40;nameInput.placeholder='예: 조적벽 190';nameRow.append(nameInput);
  const table=el('table','wal-table');const thead=el('thead');const hr=el('tr');for(const t of ['중심선에서 거리 (mm, −는 실내측)','켜 이름','선종류','색','']){hr.append(el('th',null,t));}thead.append(hr);const tbody=el('tbody');table.append(thead,tbody);
  const rowActions=el('div','wal-row-actions');const addRow=el('button',null,'+ 구성선 추가');addRow.type='button';const hint=el('span','wal-hint','선은 실외(+)부터 실내(−) 순으로 자동 정렬됩니다. 등록한 켜가 도면에 없으면 자동으로 만듭니다.');rowActions.append(addRow,hint);
  const opts=el('div','wal-options');
  const byLayer=el('label');const byLayerBox=el('input');byLayerBox.type='checkbox';byLayerBox.checked=state.byLayer;byLayer.append(byLayerBox,el('span',null,'ByLayer 로 그리기 (색은 켜 색을 따름)'));
  const explode=el('label');const explodeBox=el('input');explodeBox.type='checkbox';explodeBox.checked=state.explode;explode.append(explodeBox,el('span',null,'생성선 폭파 (폴리선을 낱개 선으로)'));
  const fixedRow=el('label','wal-fixed');fixedRow.append(el('span',null,'벽끌기시 예외 켜(콤마로 구분)'));const fixedInput=el('input');fixedInput.type='text';fixedInput.value=state.fixedLayers;fixedInput.placeholder=WAL_FIXED_LAYERS_DEFAULT;fixedInput.title='벽체 끌기에서 움직이지 않고 고정되는 켜. 와일드카드 * 허용, 여러 켜는 콤마로 구분';fixedRow.append(fixedInput);
  const thermalInput=el('textarea');thermalInput.placeholder='재료층 JSON';const thermalRow=el('label');thermalRow.append(el('span',null,'재료층 JSON'));thermalRow.append(thermalInput);
  const exposureSelect=el('select');for(const [v,t] of [['','미지정'],['direct','직접 외기'],['indirect','간접 외기']]){const o=el('option',null,t);o.value=v;exposureSelect.append(o);}const exposureRow=el('label');exposureRow.append(el('span',null,'노출'));exposureRow.append(exposureSelect);
  opts.append(byLayer,explode,fixedRow,thermalRow,exposureRow);
  const methods=el('fieldset','wal-methods');methods.append(el('legend',null,'벽그리기 방식'));
  const methodDefs=[['center','중심선 선택','도면의 선·폴리선·사각형을 클릭하고 실외 쪽을 찍습니다. 폴리선은 전체 벽체를 한 번에 그립니다.'],['points','교차점 지정','중심선 교차점을 실외에서 볼 때 왼쪽부터(시계반대방향) 찍습니다. Enter 완료, C 를 치면 닫힌 외벽이 됩니다.'],['drag','벽체 끌기 (D)','이미 그려진 벽을 ㄷ자로 끕니다. ① 움직일 벽의 한쪽 벽선 위 시작점 ② 같은 벽선 위 끝점(너비) ③ 반대쪽 벽선 위 점(두께) ④ 옮길 위치. 예외 켜(아래)는 고정됩니다.']];
  const methodInputs={};
  for(const [key,label,desc] of methodDefs){const l=el('label','wal-method');const r=el('input');r.type='radio';r.name='wal-method';r.value=key;r.checked=state.method===key;methodInputs[key]=r;l.append(r,el('strong',null,label),el('small',null,desc));methods.append(l);}
  const error=el('p','error');error.setAttribute('role','alert');
  const actions=el('div','dialog-actions wal-actions');
  const copyBtn=el('button',null,'벽복사');const pasteBtn=el('button',null,'벽 붙여넣기');const saveBtn=el('button',null,'저장');const goBtn=el('button','primary','그리기 시작');for(const b of [copyBtn,pasteBtn,saveBtn,goBtn])b.type='button';
  actions.append(copyBtn,pasteBtn,saveBtn,goBtn);
  editor.append(nameRow,preview,table,rowActions,opts,methods,error);
  body.append(list,editor);
  d.append(header,body,actions);

  const current=()=>state.presets[state.selected];
  const readEditor=()=>{
   let thermalLayers=null;try{thermalLayers=thermalInput.value.trim()?JSON.parse(thermalInput.value):null;}catch{error.textContent='재료층 JSON 형식이 올바르지 않습니다.';return false;}
   if(thermalLayers!==null&&!Array.isArray(thermalLayers)){error.textContent='재료층 JSON은 배열이어야 합니다.';return false;}
   const p=current();p.name=nameInput.value.trim();
   p.lines=[...tbody.querySelectorAll('tr')].map(tr=>({d:Number(tr.querySelector('[name=d]').value),layer:tr.querySelector('[name=layer]').value.trim(),lt:tr.querySelector('[name=lt]').value,color:tr.querySelector('[name=color]').value}))
    .filter(l=>Number.isFinite(l.d)&&(l.layer||l.d!==0));
   p.thermalLayers=thermalLayers;
   p.exposure=exposureSelect.value||null;
   state.presets[state.selected]=normalizePreset(p);state.byLayer=byLayerBox.checked;state.explode=explodeBox.checked;state.fixedLayers=fixedInput.value.trim();state.method=[...Object.values(methodInputs)].find(r=>r.checked)?.value||'center';return true;
  };
  const renderPreview=()=>{preview.innerHTML=sectionSvg(current(),{width:520,height:150});const cap=el('p','wal-caption',current().name||'(이름 없음)');preview.append(cap);};
  const renderList=()=>{
   list.replaceChildren();
   state.presets.forEach((p,i)=>{
    const b=el('button','wal-slot'+(i===state.selected?' active':'')+(p.lines.length?'':' empty'));b.type='button';
    b.innerHTML=sectionSvg(p,{width:64,height:34,compact:true});b.append(el('span',null,`${i+1}. ${p.name||(p.lines.length?'(이름 없음)':'비어 있음')}`));
    b.onclick=()=>{if(!readEditor())return;state.selected=i;renderAll();};list.append(b);
   });
  };
  const lineRow=(l)=>{
   const tr=el('tr');
   const dIn=el('input');dIn.type='number';dIn.name='d';dIn.step='1';dIn.value=l.d;
   const layerIn=el('input');layerIn.type='text';layerIn.name='layer';layerIn.value=l.layer;layerIn.setAttribute('list','wal-layer-names');
   const ltSel=el('select');ltSel.name='lt';for(const [k,label] of WAL_LINETYPES){const o=el('option',null,label);o.value=k;o.selected=k===l.lt;ltSel.append(o);}
   const colorIn=el('input');colorIn.type='color';colorIn.name='color';colorIn.value=l.color;
   const del=el('button',null,'삭제');del.type='button';del.onclick=()=>{tr.remove();if(readEditor()){renderPreview();renderList();}};
   for(const c of [dIn,layerIn,ltSel,colorIn,del]){const td=el('td');td.append(c);tr.append(td);}
   for(const c of [dIn,layerIn,ltSel,colorIn])c.addEventListener('input',()=>{if(readEditor()){renderPreview();renderList();}});
   return tr;
  };
  const renderEditor=()=>{
   const p=current();nameInput.value=p.name;thermalInput.value=p.thermalLayers?JSON.stringify(p.thermalLayers):'';exposureSelect.value=p.exposure||'';tbody.replaceChildren();for(const l of p.lines)tbody.append(lineRow(l));
  };
  const renderAll=()=>{renderList();renderEditor();renderPreview();error.textContent='';};
  const datalist=el('datalist');datalist.id='wal-layer-names';for(const l of ctx.layers()){const o=el('option');o.value=l.name;datalist.append(o);}d.append(datalist);
  nameInput.addEventListener('input',()=>{if(readEditor()){renderList();renderPreview();}});
  addRow.onclick=()=>{if(!readEditor())return;const p=current();p.lines.push(line(p.lines.length?Math.min(...p.lines.map(l=>l.d))-50:100,'A-WALL','CONTINUOUS','#ffd479'));state.presets[state.selected]=normalizePreset(p);renderEditor();renderPreview();renderList();};
  copyBtn.onclick=()=>{if(!readEditor())return;clipboard=structuredClone(current());ctx.toast(`${state.selected+1}번 벽 "${clipboard.name||'(이름 없음)'}" 을 복사했습니다. 붙여넣을 칸을 고른 뒤 [벽 붙여넣기]를 누르세요.`);};
  pasteBtn.onclick=()=>{if(!clipboard){error.textContent='먼저 [벽복사]로 복사할 벽을 고르세요.';return;}state.presets[state.selected]=structuredClone(clipboard);renderAll();};
  saveBtn.onclick=()=>{if(!readEditor())return;saveWalState(ctx.storage,state);ctx.toast('벽체 구성을 저장했습니다.');renderList();};
  goBtn.onclick=async()=>{
   if(!readEditor())return;saveWalState(ctx.storage,state);
   const preset=current();
   if(state.method==='drag'){dismiss();try{await dragWalls(state.fixedLayers);}catch(e){ctx.toast(ctx.userErrorMessage(e),true);}return;}
   if(!preset.lines.length){error.textContent='구성선이 없는 벽은 그릴 수 없습니다. 거리를 하나 이상 입력하세요.';return;}
   dismiss();
   const go=async()=>{try{await draw(preset,{byLayer:state.byLayer,explode:state.explode,method:state.method});}catch(e){ctx.toast(ctx.userErrorMessage(e),true);}};
   rememberCardGo('wal',state,go);
   await go();
  };
  d.addEventListener('close',()=>d.remove(),{once:true});
  document.querySelectorAll('dialog.wal-dialog').forEach(old=>old.remove());
  document.body.append(d);renderAll();d.showModal();
 };

 /** 켜 이름을 실제 켜 id 로 바꾸고 문서에 넣는다. 켜가 없으면 프리셋 색으로 만든다. */
 function commit(entities,preset){
  const ids=new Map();
  for(const e of entities){if(!ids.has(e.wallLayerName)){const spec=preset.lines.find(l=>l.layer===e.wallLayerName);ids.set(e.wallLayerName,ctx.ensureLayer(e.wallLayerName,spec?.color));}}
  const placed=entities.map(e=>{const {wallLayerName,...rest}=e;return {...rest,layer:ids.get(wallLayerName)};});
  const added=ctx.commit?ctx.commit({entities:placed}):ctx.addEntities(placed);ctx.setSelected(added);return added;
 }
 /** 벽체 끌기(D). 네 점을 찍을 때마다 ㄷ자로 끌고, Esc 까지 반복한다. 예외 켜(와일드카드)는 손대지 않는다. */
 async function dragWalls(fixedLayers){
  const fixedIds=()=>new Set(ctx.layers().filter(l=>matchesLayerPattern(l.name,fixedLayers)).map(l=>l.id));
  const tol=()=>typeof ctx.tolerance==='function'?ctx.tolerance():10;
  const compute=pts=>{const ids=fixedIds();const {f,s0,s1,delta}=dragFrameFromPoints(ctx.entities(),pts,tol(),{fixedLayerIds:ids,layers:ctx.layers()});return dragWallBand(ctx.entities(),f,s0,s1,delta,{tol:0.5,fixedLayerIds:ids,layers:ctx.layers()});};
  const previewOf=(points,cursor)=>{
   const pts=cursor?[...points,cursor]:points;
   if(pts.length<2)return [];
   if(pts.length<4){const out=[{type:'line',points:[pts[0],pts[1]]}];if(pts.length===3)out.push({type:'line',points:[pts[1],pts[2]]});return out;}
   try{return compute(pts.slice(0,4)).add;}catch{return [];}
  };
  let count=0;
  for(;;){
   if(count&&ctx.scripted&&!ctx.scripted.hasPathInput?.())break;
   const path=await ctx.pickPath({prompt:`벽체 끌기 · ① 움직일 벽의 한쪽 벽선 위 시작점 ② 같은 벽선 위 끝점(너비) ③ 반대쪽 벽선 위 점(두께) ④ 옮길 위치 · U 한 점 취소 · Esc 끝내기${count?' · 지금까지 '+count+'번':''}`,preview:previewOf,minPoints:4,maxPoints:4});
   if(!path)break;
   try{
    const result=compute(path.points);
    if(typeof ctx.commit==='function')ctx.commit({removeIds:result.removeIds,entities:result.add});
    else{ctx.addEntities(result.add);}
    count++;ctx.toast(`벽체를 끌었습니다 · 선 ${result.add.length}개 · 계속 네 점을 찍거나 Esc · Ctrl+Z 로 되돌리기`);
   }catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}
  }
  if(count)ctx.toast(`벽체 끌기 끝 · ${count}번 · Ctrl+Z 로 되돌리기`);
 }
 async function draw(preset,opts){
  if(opts.method==='points'){
   const previewOf=(points,cursor)=>{const pts=cursor?[...points,cursor]:points;if(pts.length<2)return [];const center={type:'polyline',points:pts,closed:false};return [{type:'polyline',points:pts,linetype:'CENTER'},...buildWallLines(center,exteriorSideOf(pts),preset,{...opts,byLayer:false})];};
   do{
   const path=await ctx.pickPath({prompt:`벽 [${preset.name||'이름 없음'}] · 중심선 교차점을 실외에서 볼 때 왼쪽부터(시계반대) 클릭 · Enter 완료 · C 닫기 · U 한 점 취소 · Esc 중단`,preview:previewOf,minPoints:2});
   if(!path)return;
   if(!Array.isArray(path.points)||path.points.length<2)throw Error('교차점 지정 방식은 점을 2개 이상 찍어야 합니다. 첫 점과 다음 교차점을 차례로 클릭한 뒤 Enter 를 누르세요.');
   const center={type:'polyline',points:path.points,closed:path.closed};
   const added=commit(buildWallLines(center,exteriorSideOf(path.points),preset,opts),preset);
   ctx.toast(`벽 ${added.length}개 선을 그렸습니다 · 모서리는 FL/FT/FX 로 정리 · Ctrl+Z 로 되돌리기`);
   }while(ctx.scripted?.hasPathInput?.());
   return;
  }
  let drawn=0;
  for(;;){
   if(drawn&&ctx.scripted&&!ctx.scripted.hasEntityInput())break;
   const picked=await ctx.pickEntity({prompt:`벽 [${preset.name||'이름 없음'}] · 중심선(선·폴리선·사각형)을 클릭 · Esc 끝내기${drawn?' · 지금까지 '+drawn+'개':''}`,types:['line','polyline','rectangle']});
   if(!picked)break;
   const hit=chainCenterline(picked,ctx.entities?ctx.entities():[]);
   if(hit!==picked)ctx.toast(`이어진 선 ${hit.points.length-(hit.closed?0:1)}개를 한 벽으로 묶었습니다`);
   const side=await ctx.pickPoint('벽의 실외(바깥) 쪽을 클릭하세요 · Esc 취소');
   if(!side)break;
   const added=commit(buildWallLines(hit,side,preset,opts),preset);drawn+=added.length;
   ctx.toast(`벽 선 ${added.length}개 생성 · 계속 다른 중심선을 클릭하거나 Esc`);
  }
  if(drawn)ctx.toast(`벽 그리기 끝 · 선 ${drawn}개 · Ctrl+Z 로 되돌리기`);
 }
}
