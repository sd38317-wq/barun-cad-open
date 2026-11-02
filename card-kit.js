// 보조명령 카드 공통 도구. WAL 벽 그리기(wall-preset.js)와 같은 형태의 선택창을 만들고,
// 문·창·개구부가 함께 쓰는 벽 좌표계(세 점 → 벽 축·두께), 벽선 절단, 단면 정리선, SVG 미리보기를 제공한다.
import * as G from './geometry.js';

export const STD_LAYERS=Object.freeze({door:'A-DOOR',glaz:'A-GLAZ',wall:'A-WALL',stair:'A-STAIR',park:'A-PARK',text:'A-TEXT',symb:'A-SYM',plot:'A-PLOT'});
/** 출력 박스 레이어: 새로 그리는 박스는 A-PLOT(바른 레이어 세트), 남의 도면의 PLOT_BOX(옛 리습 관례)도 알아본다. */
export const isPlotBoxLayerName=name=>/^(PLOT_?BOX|A-PLOT)/i.test(String(name||''));
export const PREVIEW_COLORS=Object.freeze({'A-DOOR':'#f4d35e','A-GLAZ':'#6ec6ff','A-WALL':'#d0d0d0','A-STAIR':'#ffd479','A-PARK':'#b5e48c','A-TEXT':'#ffffff','A-SYM':'#ff9f68','A-WALL-C':'#ff5a5a'});
const CENTER_RE=/CNTR|GRID|CENTER|중심|(?:^|-)WALL-C(?:$|-)/i;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clampInt=(v,lo,hi)=>Math.min(hi,Math.max(lo,Number.isFinite(Number(v))?Math.round(Number(v)):lo));

/* ── 필드 정의와 값 정규화 ──
   field: {key,label,type:'number'|'select'|'check'|'text'|'layer',def,options:[[value,label]],min,max,step,group,hint,when:(values)=>boolean} */
export function normalizeValues(fields,values,name){
 const out={name:String(values?.name??name??'').slice(0,40)};
 for(const f of fields){
  const v=values?.[f.key];
  if(f.def===null&&(v==null||typeof v==='string'&&!v.trim())){out[f.key]=null;continue;}
  if(f.type==='number'){let n=Number(v);if(!Number.isFinite(n))n=f.def;if(n===null){out[f.key]=null;continue;}if(f.min!==undefined)n=Math.max(f.min,n);if(f.max!==undefined)n=Math.min(f.max,n);out[f.key]=n;}
  else if(f.type==='select')out[f.key]=f.options.some(([k])=>k===v)?v:f.def;
  else if(f.type==='check')out[f.key]=v===undefined?!!f.def:!!v;
  else out[f.key]=String(v??f.def??'').trim()||String(f.def??'');
 }
 return out;
}
export function defaultsOf(fields){return Object.fromEntries(fields.map(f=>[f.key,f.def]));}

/* ── 저장. 카드마다 칸(슬롯) 여러 개와 공통(켜) 값을 브라우저 저장소에 둔다. ── */
export function loadCardState(storage,key,{fields,sharedFields=[],slots,fixedNames=[],slotDefaults=()=>({})}){
 let raw=null;try{raw=JSON.parse(storage?.getItem(key)||'null');}catch{raw=null;}
 const presets=[];
 for(let i=0;i<slots;i++){
  const saved=raw?.presets?.[i];const base={...defaultsOf(fields),...slotDefaults(i),...(saved&&typeof saved==='object'?saved:{})};
  const p=normalizeValues(fields,base,fixedNames[i]||'');if(fixedNames[i])p.name=fixedNames[i];presets.push(p);
 }
 const shared=normalizeValues(sharedFields,{...defaultsOf(sharedFields),...(raw?.shared||{})});delete shared.name;
 return {presets,shared,selected:clampInt(raw?.selected,0,slots-1)};
}
export function saveCardState(storage,key,state){try{storage?.setItem(key,JSON.stringify({presets:state.presets,shared:state.shared,selected:state.selected}));}catch{}}

/* ── 벽 좌표계. p1·p2 는 한 벽선 위, p3 는 반대쪽 벽선 위. s 는 벽 방향 거리, d 는 p1 벽선(0)에서 p3 벽선(t) 쪽 거리. ── */
export function wallFrame(p1,p2,p3){
 if(G.dist(p1,p2)<G.EPS)throw Error('첫째·둘째 점은 서로 다른 점이어야 합니다.');
 const u=G.unit(G.sub(p2,p1));let n=G.normal(u),t=G.dot(G.sub(p3,p1),n);
 if(Math.abs(t)<1e-6)throw Error('셋째 점은 반대쪽 벽선 위에 찍으세요. 벽 두께가 0 입니다.');
 if(t<0){n=G.mul(n,-1);t=-t;}
 return {origin:{x:p1.x,y:p1.y},u,n,t,angle:G.angle(u),flip:G.cross(u,n)<0?-1:1};
}
export const toWorld=(f,s,d)=>G.add(f.origin,G.add(G.mul(f.u,s),G.mul(f.n,d)));
export const toLocal=(f,p)=>({s:G.dot(G.sub(p,f.origin),f.u),d:G.dot(G.sub(p,f.origin),f.n)});
/** 글자가 뒤집혀 보이지 않게 하는 회전각 */
export const readableAngle=a=>{const r=G.normalizeAngle(a);return r>90&&r<=270?G.normalizeAngle(r+180):r;};
/** 벽 좌표계(s,d)로 객체를 만드는 도구. 켜는 이름(cardLayer)으로만 적고, 실제 id 는 커밋할 때 바꾼다. */
export function builder(f,layerName){
 const list=[],P=(s,d)=>toWorld(f,s,d);
 const tag=(e,o)=>{list.push({...e,cardLayer:o?.layer||layerName,...(o?.linetype?{linetype:o.linetype}:{}),...(o?.color?{color:o.color}:{})});return e;};
 const arc=(s,d,r,a0,a1,o)=>{const A=f.angle+f.flip*a0,B=f.angle+f.flip*a1;return tag({type:'arc',center:P(s,d),radius:r,startAngle:G.normalizeAngle(f.flip>0?A:B),endAngle:G.normalizeAngle(f.flip>0?B:A)},o);};
 return {
  list,P,
  line:(s1,d1,s2,d2,o)=>tag({type:'line',points:[P(s1,d1),P(s2,d2)]},o),
  rect:(s1,d1,s2,d2,o)=>tag({type:'polyline',closed:true,points:[P(s1,d1),P(s2,d1),P(s2,d2),P(s1,d2)]},o),
  poly:(pts,closed,o)=>tag({type:'polyline',closed:!!closed,points:pts.map(([s,d])=>P(s,d))},o),
  arc,
  circle:(s,d,r,o)=>tag({type:'circle',center:P(s,d),radius:r},o),
  text:(s,d,text,height,o)=>tag({type:'text',position:P(s,d),text:String(text),height,rotation:o?.rotation??readableAngle(f.angle),align:o?.align||'center'},o),
 };
}

/** 실제 벽은 중심선 대신 개구부를 제외한 양면을 스냅에 쓴다. */
export function wallFaceSegments(e){
 return e.type==='wall'?G.wallPolygons(e).flatMap(ps=>[[ps[0],ps[1]],[ps[3],ps[2]]]):G.segments(e);
}
/* ── 가장 가까운 벽선 찾기(원문의 NEA 스냅에 해당). 선·폴리선·사각형의 한 구간을 돌려준다. ── */
export function nearestSegment(entities,p,tolerance,{skipCenter=true,layers=[]}={}){
 const center=new Set(layers.filter(l=>CENTER_RE.test(l.name)||l.linetype==='CENTER').map(l=>l.id));
 let best=null,bd=tolerance;
 for(const e of entities||[]){
  if(!['line','polyline','rectangle','wall'].includes(e.type)||e.hidden)continue;
  if(skipCenter&&(center.has(e.layer)||String(e.linetype||'').toUpperCase().includes('CENTER')))continue;
  for(const [a,b] of wallFaceSegments(e)){
   if(G.dist(a,b)<G.EPS)continue;
   const d=G.distanceToSegment(p,a,b);
   if(d<bd){bd=d;const v=G.sub(b,a),t=Math.max(0,Math.min(1,G.dot(G.sub(p,a),v)/G.dot(v,v)));best={entity:e,a,b,foot:G.add(a,G.mul(v,t)),distance:d};}
  }
 }
 return best;
}
/** 세 점을 벽선에 붙여 벽 좌표계를 만든다. p1·p2 가 같은 벽선 근처면 그 선을 축으로 쓰고, p3 도 반대쪽 벽선에 붙인다. */
export function snapWallFrame(entities,p1,p2,p3,tolerance,opts={}){
 const h1=nearestSegment(entities,p1,tolerance,opts);
 let a=p1,b=p2;
 if(h1){a=h1.foot;const dir=G.sub(h1.b,h1.a),u=G.unit(dir);const along=G.dot(G.sub(p2,a),u);b=G.add(a,G.mul(u,along||G.dist(h1.a,h1.b)));if(Math.abs(along)<G.EPS)b=G.add(a,G.mul(u,1));}
 const h3=nearestSegment(entities,p3,tolerance,opts);
 const c=h3?h3.foot:p3;
 const frame=wallFrame(a,b,c);
 frame.snapped={first:h1?.entity||null,opposite:h3?.entity||null};
 return frame;
}

/* ── 벽선 절단. 벽 방향과 평행하고 두께 띠 안에 있는 선·폴리선 구간에서 [s0,s1] 구간을 잘라낸다. 중심선은 건드리지 않는다. ── */
const WALL_LAYER_RE=/^(?:A-WALL|S-(?:CONC-|MASN-|STEEL-)?WALL)(?:-|$)/i;
const pointAtS=(f,a,b,s)=>{const sa=toLocal(f,a).s,sb=toLocal(f,b).s;const t=Math.abs(sb-sa)<G.EPS?0:(s-sa)/(sb-sa);return G.add(a,G.mul(G.sub(b,a),t));};
/** 절단과 끌기가 함께 쓰는 보호 판정. 실 연결은 전체 객체에서 먼저 읽는다. */
export function wallBandFilter(entities,layers=[]){
 const layerNames=new Map(layers.map(l=>[l.id,l.name]));
 const center=new Set(layers.filter(l=>CENTER_RE.test(l.name)||l.linetype==='CENTER').map(l=>l.id));
 const roomIds=new Set();
 for(const e of entities||[]){
  if(e.roomBoundary)roomIds.add(e.roomBoundary);
  for(const room of e.roomSchedule?.rooms||[])if(room.sourceId)roomIds.add(room.sourceId);
 }
 return e=>{
  if(e.room||roomIds.has(e.id))return false;
  if(e.type==='wall')return true;
  const layerName=layerNames.get(e.layer)||e.layer||'';
  if(/^A-(?:AREA|ANNO|PATT|HATCH|TEXT|DIM|SYM|TITLE|NOTE|PLOT|GUIDE)(?:-|$)/i.test(layerName))return false;
  // 비표준 벽 켜와 프리셋 벽선은 유지하고, 표준 켜의 문·창·기둥 등은 보호한다.
  if(!e.wallPreset&&!e.wallLayerName&&!WALL_LAYER_RE.test(layerName)&&/^[AS]-/i.test(layerName))return false;
  return !center.has(e.layer)&&!String(e.linetype||'').toUpperCase().includes('CENTER');
 };
}
export function cutWallBand(entities,f,s0,s1,{dMin=0,dMax=f.t,tol=0.5,layers=[]}={}){
 const canCut=wallBandFilter(entities,layers);
 const removeIds=[],add=[],cuts=[],walls=[];
 for(const e of entities||[]){
  if(!canCut(e))continue;
  if(e.type==='wall'&&!e.hidden&&e.points?.length===2){
   const [a,b]=e.points,v=G.sub(b,a),length=G.len(v);
   if(length<G.EPS||Math.abs(G.cross(G.unit(v),f.u))>1e-4)continue;
   const la=toLocal(f,a),lb=toLocal(f,b),ds=[la.d-e.thickness/2,la.d+e.thickness/2];
   if(ds[0]<dMin-tol||ds[1]>dMax+tol||Math.abs(la.d-f.t/2)>tol)continue;
   if(Math.max(la.s,lb.s)<=s0+tol||Math.min(la.s,lb.s)>=s1-tol)continue;
   if(s0<Math.min(la.s,lb.s)-tol||s1>Math.max(la.s,lb.s)+tol)throw Error('개구부가 벽 길이 안에 들어가야 합니다.');
   if(layers.some(l=>l.id===e.layer&&l.locked))throw Error('잠긴 레이어의 벽은 편집할 수 없습니다.');
   walls.push(e);for(const d of ds)cuts.push({d,layer:e.layer});
   continue;
  }
  if(!['line','polyline','rectangle'].includes(e.type)||e.hidden||!Array.isArray(e.points)||e.points.length<2)continue;
  if(e.bulges?.some(b=>b))continue;
  const closed=e.type==='rectangle'||!!e.closed;
  const hitOf=(a,b)=>{const v=G.sub(b,a);if(G.len(v)<G.EPS)return null;if(Math.abs(G.cross(G.unit(v),f.u))>1e-4)return null;const la=toLocal(f,a),lb=toLocal(f,b);if(la.d<dMin-tol||la.d>dMax+tol)return null;const lo=Math.min(la.s,lb.s),hi=Math.max(la.s,lb.s);if(hi<=s0+tol||lo>=s1-tol)return null;return {d:la.d,lo,hi};};
  let points=e.points.map(p=>({x:p.x,y:p.y}));
  const segs=G.segments({points,closed}),hits=segs.map(([a,b])=>hitOf(a,b));
  if(!hits.some(Boolean))continue;
  if(closed){const k=hits.findIndex(Boolean);points=[...points.slice(k+1),...points.slice(0,k+1)];points.push(points[0]);}
  const pieces=[];let cur=[];const push=()=>{if(cur.length>=2)pieces.push(cur);cur=[];};
  for(let i=0;i<points.length-1;i++){
   const a=points[i],b=points[i+1],h=hitOf(a,b);
   if(!h){if(!cur.length)cur.push(a);cur.push(b);continue;}
   cuts.push({d:h.d,layer:e.layer,linetype:e.linetype,color:e.color});
   const sa=toLocal(f,a).s,sb=toLocal(f,b).s,fwd=sb>=sa,cutStart=fwd?s0:s1,cutEnd=fwd?s1:s0;
   const inStart=fwd?cutStart>sa+tol:cutStart<sa-tol,inEnd=fwd?cutEnd<sb-tol:cutEnd>sb+tol;
   if(inStart){if(!cur.length)cur.push(a);cur.push(pointAtS(f,a,b,cutStart));}
   push();
   cur=inEnd?[pointAtS(f,a,b,cutEnd),b]:[];
  }
  push();
  if(closed&&pieces.length>1&&G.dist(pieces[0][0],pieces.at(-1).at(-1))<G.EPS){const last=pieces.pop();pieces[0]=[...last,...pieces[0].slice(1)];}
  removeIds.push(e.id);
  const {id,points:_p,closed:_c,type:_t,...rest}=e;
  for(const pts of pieces)add.push(pts.length===2?{...rest,type:'line',points:pts}:{...rest,type:'polyline',closed:false,points:pts});
 }
 const seen=new Set();
 const uniqueCuts=cuts.filter(c=>{const k=Math.round(c.d*10);if(seen.has(k))return false;seen.add(k);return true;}).sort((a,b)=>a.d-b.d);
 return {removeIds,add,cuts:uniqueCuts,walls};
}
/** 창의 열리는 방식. 카드 값·가져온 블록·모델이 같은 이름을 쓴다. */
export function windowStyleOf(e={}){
 const candidates=[e.style,e.subtype,e.parameters?.style,e.parameters?.subtype,e.attributes?.style,e.attributes?.subtype,e.cardOpening?.values?.kind];
 const parse=raw=>{
  const v=typeof raw==='string'?raw.trim().toLowerCase():'';
  if(/^(fixed|fix|고정창?|w1)(?:$|[ _(-])/.test(v))return 'fixed';
  if(/^(sliding|미서기창?|w[23])(?:$|[ _(-])/.test(v))return 'sliding';
  if(/^(casement|여닫이창?)(?:$|[ _(-])/.test(v))return 'casement';
  if(/^(awning|프로젝트창?)(?:$|[ _(-])/.test(v))return 'awning';
  if(/^(tilt[-_ ]?turn|틸트앤턴창?)(?:$|[ _(-])/.test(v))return 'tiltTurn';
  return null;
 };
 for(const raw of candidates){const style=parse(raw);if(style)return style;}
 // 구체적인 종류가 없고 미확인이 명시돼 있으면 이름(W2)으로 추측하지 않는다.
 if(candidates.some(v=>typeof v==='string'&&/^(unknown|미확인|종류 미확인)$/i.test(v.trim())))return 'unknown';
 return parse(e.name)||'unknown';
}
/** 카드 기하는 유지하면서 엔진의 기존 hostWall/openingLinks 규약에 연결한다.
 * 개구부 폭은 틀·간격을 포함한 실제 절단 폭이고, parameters.width는 창호 공칭 폭이다. */
export function cardOpeningStyle(kind,values){
 if(kind!=='DOOR')return values.kind;
 const double=values.doorType==='double'||values.doorType!=='single'&&(values.swing==='double'||values.width>=values.doubleFrom);
 return double?(values.split==='equal'?'double':'unequal'):'single';
}
export function linkCardOpening(walls,f,span,kind,values,shared,entities,layers=[]){
 if(!walls.length)return entities;
 const locked=new Set(layers.filter(l=>l.locked).map(l=>l.id));
 if(entities.some(e=>locked.has(e.layer)))throw Error('잠긴 레이어의 객체는 편집할 수 없습니다.');
 if(walls.length>1)throw Error('겹친 벽이 여러 개입니다. 문·창을 넣을 벽을 분리하세요.');
 const wall=walls[0],[a,b]=wall.points,u=G.unit(G.sub(b,a)),n=G.normal(u),length=G.dist(a,b);
 const ends=span.map(s=>G.dot(G.sub(toWorld(f,s,f.t/2),a),u)),start=Math.max(0,Math.min(...ends)),width=Math.max(...ends)-Math.min(...ends);
 const position=G.add(a,G.mul(u,start)),height=kind==='DOOR'?2100:1500,sill=kind==='DOOR'?0:900;
 const style=cardOpeningStyle(kind,values);
 return [{type:'block',name:values.name,category:kind,...(kind==='WINDOW'?{uValue:values.uValue??null,airtightGrade:values.airtightGrade??null,shgc:values.shgc??null}:{}),layer:entities[0]?.layer||wall.layer,position,
  hostWall:wall.id,hostOffset:start/length,openingWidth:width,
  parameters:{kind,width:values.width,depth:wall.thickness,height,sill,rotation:G.angle(u),style},
  attributes:{mark:values.name,width:values.width,height,sill,style},
  cardOpening:{values:{...values,offset:0},shared,direction:G.dot(f.u,u)>0?1:-1,face:G.dot(G.sub(f.origin,a),n)>0?1:-1},entities}];
}
/** 잘린 벽 단면 정리선. mode 'first' = 첫 벽선의 켜로 전체 두께를 한 선으로, 'each' = 이웃한 벽선 사이마다 각자 켜로.
 *  잘린 벽선이 둘 미만이면 fallbackLayerName 켜로 두께 전체를 한 선으로 긋는다. */
export function capLines(f,positions,cuts,mode='first',{dLo=null,dHi=null,fallbackLayerName=STD_LAYERS.wall}={}){
 const ds=[...cuts].sort((a,b)=>a.d-b.d),out=[];
 for(const s of positions){
  if(ds.length<2){out.push({type:'line',points:[toWorld(f,s,dLo??0),toWorld(f,s,dHi??f.t)],cardLayer:fallbackLayerName});continue;}
  if(mode==='each'){for(let i=0;i<ds.length-1;i++)out.push({type:'line',points:[toWorld(f,s,ds[i].d),toWorld(f,s,ds[i+1].d)],layer:ds[i].layer,...(ds[i].color?{color:ds[i].color}:{})});}
  else out.push({type:'line',points:[toWorld(f,s,dLo??ds[0].d),toWorld(f,s,dHi??ds.at(-1).d)],layer:ds[0].layer,...(ds[0].color?{color:ds[0].color}:{})});
 }
 return out;
}

/* ── SVG 미리보기. 선·폴리선·호·원·문자를 화면 크기에 맞춰 그린다. 위가 +y 다. ── */
function entityBounds(es){
 let b=null;const take=p=>{if(!b)b={minX:p.x,maxX:p.x,minY:p.y,maxY:p.y};else{b.minX=Math.min(b.minX,p.x);b.maxX=Math.max(b.maxX,p.x);b.minY=Math.min(b.minY,p.y);b.maxY=Math.max(b.maxY,p.y);}};
 for(const e of es){
  if(e.points)for(const p of e.points)take(p);
  if(e.center){if(e.type==='circle'){take({x:e.center.x-e.radius,y:e.center.y-e.radius});take({x:e.center.x+e.radius,y:e.center.y+e.radius});}else{const sweep=G.normalizeAngle(e.endAngle-e.startAngle)||360;for(let k=0;k<=8;k++)take(G.add(e.center,G.polar(e.radius,e.startAngle+sweep*k/8)));}}
  if(e.position){take(e.position);const w=(e.text?.length||1)*(e.height||100)*.6;take({x:e.position.x-w/2,y:e.position.y-(e.height||100)/2});take({x:e.position.x+w/2,y:e.position.y+(e.height||100)/2});}
 }
 return b;
}
export function entitiesSvg(entities,{width=280,height=150,pad=10,label='',colorOf=null,compact=false,background='#101820'}={}){
 const es=(entities||[]).filter(Boolean),b=entityBounds(es);
 const color=e=>e.previewColor||(colorOf?colorOf(e):null)||e.color||PREVIEW_COLORS[e.cardLayer]||(e.linetype==='CENTER'?'#ff5a5a':'#c9d1d9');
 let inner='';
 if(b){
  const w=Math.max(1,b.maxX-b.minX),h=Math.max(1,b.maxY-b.minY),k=Math.min((width-pad*2)/w,(height-pad*2)/h),cx=(b.minX+b.maxX)/2,cy=(b.minY+b.maxY)/2;
  const X=x=>(width/2+(x-cx)*k).toFixed(2),Y=y=>(height/2-(y-cy)*k).toFixed(2);
  const dash=e=>e.linetype==='CENTER'?' stroke-dasharray="10 3 2 3"':e.linetype==='DASHED'||e.linetype==='HIDDEN'?' stroke-dasharray="6 4"':e.linetype==='DOT'?' stroke-dasharray="2 3"':'';
  const sw=compact?1:1.4;
  for(const e of es){
   const c=esc(color(e)),common=`stroke="${c}" stroke-width="${sw}" fill="none"${dash(e)}`;
   if(e.type==='line'&&e.points?.length>=2)inner+=`<line x1="${X(e.points[0].x)}" y1="${Y(e.points[0].y)}" x2="${X(e.points[1].x)}" y2="${Y(e.points[1].y)}" ${common}/>`;
   else if((e.type==='polyline'||e.type==='rectangle')&&e.points?.length>=2){const d=e.points.map((p,i)=>`${i?'L':'M'}${X(p.x)} ${Y(p.y)}`).join(' ')+(e.closed||e.type==='rectangle'?' Z':'');inner+=`<path d="${d}" ${common}/>`;}
   else if(e.type==='circle')inner+=`<circle cx="${X(e.center.x)}" cy="${Y(e.center.y)}" r="${(e.radius*k).toFixed(2)}" ${common}/>`;
   else if(e.type==='arc'){const sweep=G.normalizeAngle(e.endAngle-e.startAngle)||360,a=G.add(e.center,G.polar(e.radius,e.startAngle)),z=G.add(e.center,G.polar(e.radius,e.endAngle)),r=(e.radius*k).toFixed(2);inner+=`<path d="M${X(a.x)} ${Y(a.y)} A${r} ${r} 0 ${sweep>180?1:0} 0 ${X(z.x)} ${Y(z.y)}" ${common}/>`;}
   else if(e.type==='text'&&!compact){const fs=Math.max(7,(e.height||100)*k).toFixed(1);inner+=`<text x="${X(e.position.x)}" y="${Y(e.position.y)}" font-size="${fs}" fill="${c}" text-anchor="${e.align==='left'?'start':e.align==='right'?'end':'middle'}" dominant-baseline="middle" transform="rotate(${(-(e.rotation||0)).toFixed(1)} ${X(e.position.x)} ${Y(e.position.y)})">${esc(e.text)}</text>`;}
  }
 }
 const cap=label&&!compact?`<text x="8" y="12" font-size="10" fill="#9aa4b1">${esc(label)}</text>`:'';
 return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(label||'미리보기')}"><rect x="0" y="0" width="${width}" height="${height}" fill="${background}" rx="6"/>${inner}${cap}</svg>`;
}

/* ── 선택창. WAL 카드와 같은 배치: 왼쪽 칸 목록(작은 그림) · 오른쪽 이름·큰 미리보기·설정 표·방식·버튼. ── */
/* ── 스페이스·엔터 반복(2026-09-21 사용자 요청): 명령을 한 번 실행한 뒤 스페이스로 반복하면 선택창을 건너뛰고 마지막 설정으로 바로 그린다.
   app.js 가 반복 직전에 markCardRepeat() 를 부르고, 카드 선택창은 열리기 전에 consumeCardRepeat(키) 로 "같은 카드의 마지막 실행"이 있으면 그것을 다시 돌린다. ── */
let lastGo=null,repeatUntil=0;
export function markCardRepeat(){repeatUntil=Date.now()+800;}
export function consumeCardRepeat(key){const hit=Date.now()<repeatUntil&&lastGo&&lastGo.key===key?lastGo:null;repeatUntil=0;return hit;}
export function rememberCardGo(key,state,run){lastGo={key,state,run};}
export function openCardDialog(cfg){
 // 화면 없는 실행(리습·AI): 창을 열지 않고 실행기(command-runner.js)가 준 값으로 바로 onGo 한다.
 if(cfg.ctx?.scripted)return cfg.ctx.scripted.cardDialog(cfg);
 {const again=consumeCardRepeat(cfg.storageKey);if(again){again.run();return again.state;}}
 const {ctx,title,storageKey,fields,sharedFields=[],slots,fixedNames=[],slotDefaults,preview,onGo,goLabel='그리기 시작',methods=null,copyLabel='복사',pasteLabel='붙여넣기',note=''}=cfg;
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
 const state=loadCardState(ctx.storage,storageKey,{fields,sharedFields,slots,fixedNames,slotDefaults});
 if(Number.isInteger(cfg.select))state.selected=Math.min(slots-1,Math.max(0,cfg.select));
 /* 칸이 하나뿐인 카드는 칸 목록·칸 이름·복사·붙여넣기·설명을 빼고 한 화면에 들어가게 조밀하게 그린다(2026-09-21 사용자 지적). */
 const single=slots===1;
 const d=el('dialog','wal-dialog card-dialog'+(single?' card-single':''));
 const dismiss=()=>{try{d.close();}catch{}d.remove();};
 const header=el('div','dialog-header');header.append(el('h2',null,title));const close=el('button',null,'닫기 ×');close.type='button';close.onclick=dismiss;header.append(close);
 const body=el('div','wal-body'),list=el('div','wal-list'),editor=el('div','wal-editor'),previewBox=el('div','wal-preview');
 const nameRow=el('label','wal-name');nameRow.append(el('span',null,'칸 이름'));const nameInput=el('input');nameInput.type='text';nameInput.maxLength=40;nameRow.append(nameInput);
 const fieldsBox=el('div','card-fields'),sharedBox=el('div','card-fields card-shared');
 const error=el('p','error');error.setAttribute('role','alert');
 const actions=el('div','dialog-actions wal-actions');
 const copyBtn=el('button',null,copyLabel),pasteBtn=el('button',null,pasteLabel),saveBtn=el('button',null,'저장'),goBtn=el('button','primary',goLabel);for(const b of [copyBtn,pasteBtn,saveBtn,goBtn])b.type='button';
 if(single)actions.append(saveBtn,goBtn);else actions.append(copyBtn,pasteBtn,saveBtn,goBtn);
 if(!single)editor.append(nameRow);editor.append(previewBox,fieldsBox);
 if(sharedFields.length)editor.append(sharedBox);
 let methodInputs=null;
 if(methods){const fs=el('fieldset','wal-methods');fs.append(el('legend',null,methods.legend||'방식'));methodInputs={};for(const [key,label,desc,disabled] of methods.options){const l=el('label','wal-method');const r=el('input');r.type='radio';r.name=storageKey+'-method';r.value=key;r.checked=(state.shared.__method||methods.def)===key;if(disabled)r.disabled=true;methodInputs[key]=r;l.append(r,el('strong',null,label),el('small',null,desc));if(desc)l.title=desc;fs.append(l);}editor.append(fs);}
 if(note){const p=el('p','wal-hint',note);editor.append(p);}
 editor.append(error);
 if(!single)body.append(list);body.append(editor);d.append(header,body,actions);
 const datalist=el('datalist');datalist.id=storageKey+'-layers';for(const l of ctx.layers())if(!datalist.querySelector(`option[value="${l.name.replace(/"/g,'&quot;')}"]`)){const o=el('option');o.value=l.name;datalist.append(o);}
 for(const n of Object.values(STD_LAYERS))if(![...datalist.options].some(o=>o.value===n)){const o=el('option');o.value=n;datalist.append(o);}
 d.append(datalist);

 const current=()=>state.presets[state.selected];
 const control=(f,value,onInput)=>{
  let c;
  if(f.type==='select'){c=el('select');for(const [k,label] of f.options){const o=el('option',null,label);o.value=k;o.selected=k===value;c.append(o);}}
  else if(f.type==='check'){c=el('input');c.type='checkbox';c.checked=!!value;}
  else{c=el('input');c.type=f.type==='number'?'number':'text';if(f.type==='number'){c.step=String(f.step??'any');if(f.min!==undefined)c.min=String(f.min);if(f.max!==undefined)c.max=String(f.max);}if(f.type==='layer')c.setAttribute('list',datalist.id);c.value=value??'';}
  c.name=f.key;c.addEventListener('input',onInput);c.addEventListener('change',onInput);
  return c;
 };
 const readValue=(f,c)=>f.type==='check'?c.checked:f.def===null&&!c.value.trim()?null:f.type==='number'?Number(c.value):c.value;
 const renderFields=(box,defs,values,onChange)=>{
  box.replaceChildren();
  const groups=new Map();for(const f of defs){if(f.hidden)continue;const g=f.group||'';if(!groups.has(g))groups.set(g,[]);groups.get(g).push(f);}
  for(const [g,items] of groups){
   const fs=el('fieldset','card-group');if(g)fs.append(el('legend',null,g));
   const grid=el('div','card-grid');
   for(const f of items){
    const row=el('label','card-field'+(f.type==='check'?' check':''));
    const c=control(f,values[f.key],()=>{values[f.key]=readValue(f,c);const norm=normalizeValues(defs,values,values.name);Object.assign(values,norm);onChange();});
    if(f.type==='check')row.append(c,el('span',null,f.label));else row.append(el('span',null,f.label),c);
    if(f.hint)row.title=f.hint; /* 설명글은 줄을 먹지 않게 풍선말로(2026-09-21) */
    if(f.when&&!f.when(values,state.shared)){row.classList.add('off');c.disabled=true;}
    grid.append(row);
   }
   fs.append(grid);box.append(fs);
  }
  hideEmptyGroups(box);
 };
 const hideEmptyGroups=box=>{for(const fs of box.querySelectorAll('.card-group'))fs.hidden=![...fs.querySelectorAll('.card-field')].some(r=>!r.classList.contains('off'));};
 const renderPreview=()=>{let svg='';try{svg=preview(current(),state.shared,{width:480,height:120});}catch(e){svg=`<p class="error">${esc(e.message)}</p>`;}previewBox.innerHTML=svg;if(!single&&!fixedNames[state.selected])previewBox.append(el('p','wal-caption',current().name||'(이름 없음)'));};
 /* 이름 없는 빈 칸은 목록에 늘어놓지 않고 [+ 새 칸] 하나로 대신한다(2026-09-21 사용자 지적). */
 const renderList=()=>{if(single)return;list.replaceChildren();const empties=[];state.presets.forEach((p,i)=>{if(!p.name&&!fixedNames[i]&&i!==state.selected){empties.push(i);return;}const b=el('button','wal-slot'+(i===state.selected?' active':''));b.type='button';let svg='';try{svg=preview(p,state.shared,{width:64,height:34,compact:true});}catch{svg='';}b.innerHTML=svg;b.append(el('span',null,`${i+1}. ${p.name||'(이름 없음)'}`));b.onclick=()=>{state.selected=i;renderAll();};list.append(b);});if(empties.length){const b=el('button','wal-slot wal-slot-add');b.type='button';b.append(el('span',null,`+ 새 칸 (${empties.length}개 남음)`));b.onclick=()=>{state.selected=empties[0];renderAll();};list.append(b);}};
 const refreshEditor=()=>{renderFields(fieldsBox,fields,current(),()=>{renderPreview();renderList();refreshDisabled();});if(sharedFields.length){renderFields(sharedBox,sharedFields,state.shared,()=>{renderPreview();renderList();});}};
 const refreshDisabled=()=>{for(const box of [fieldsBox,sharedBox])for(const row of box.querySelectorAll('.card-field')){const c=row.querySelector('input,select'),f=[...fields,...sharedFields].find(x=>x.key===c?.name);if(!f||!c)continue;const on=!f.when||f.when(current(),state.shared);row.classList.toggle('off',!on);c.disabled=!on;}for(const box of [fieldsBox,sharedBox])hideEmptyGroups(box);};
 const renderAll=()=>{nameInput.value=current().name;nameInput.readOnly=!!fixedNames[state.selected];renderList();refreshEditor();renderPreview();error.textContent='';};
 nameInput.addEventListener('input',()=>{if(!fixedNames[state.selected]){current().name=nameInput.value.slice(0,40);renderList();renderPreview();}});
 let clipboard=null;
 copyBtn.onclick=()=>{clipboard=structuredClone(current());ctx.toast(`${state.selected+1}번 칸 "${clipboard.name}" 설정을 복사했습니다. 붙여넣을 칸을 고른 뒤 [${pasteLabel}]를 누르세요.`);};
 pasteBtn.onclick=()=>{if(!clipboard){error.textContent=`먼저 [${copyLabel}]로 복사할 칸을 고르세요.`;return;}const name=fixedNames[state.selected]||current().name;state.presets[state.selected]={...structuredClone(clipboard),name};renderAll();};
 const persist=()=>{if(methodInputs)state.shared.__method=Object.values(methodInputs).find(r=>r.checked)?.value||methods.def;saveCardState(ctx.storage,storageKey,state);};
 saveBtn.onclick=()=>{persist();ctx.toast('설정을 저장했습니다.');};
 goBtn.onclick=async()=>{
  persist();
  const values=current(),method=methodInputs?Object.values(methodInputs).find(r=>r.checked)?.value:null;
  try{if(cfg.validate)cfg.validate(values,state.shared,method);}catch(e){error.textContent=e.message;return;}
  dismiss();
  const go=async(v,sh)=>{try{await onGo(v,sh,method,state);}catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}};
  rememberCardGo(storageKey,state,()=>go(structuredClone(values),structuredClone(state.shared)));
  await go(values,state.shared);
 };
 d.addEventListener('close',()=>d.remove(),{once:true});
 document.querySelectorAll('dialog.card-dialog').forEach(old=>old.remove());
 document.body.append(d);renderAll();d.showModal();
 return state;
}

/** 켜 이름(cardLayer)을 실제 켜 id 로 바꾼다. 없는 켜는 만든다. */
export function resolveLayers(ctx,entities,colorOf=name=>PREVIEW_COLORS[name]){
 const ids=new Map();
 return entities.map(e=>{
  const {cardLayer,previewColor,...rest}=e;
  if(rest.layer)return rest;
  const name=cardLayer||STD_LAYERS.wall;
  if(!ids.has(name))ids.set(name,ctx.ensureLayer(name,colorOf(name)||'#ffd479'));
  return {...rest,layer:ids.get(name)};
 });
}
/** 그리기 시작 전 세 점 입력. maxPoints 로 자동 완료된다. */
export async function pickThree(ctx,prompts,preview){
 const path=await ctx.pickPath({prompt:prompts,preview,minPoints:3,maxPoints:3});
 return path?path.points:null;
}
