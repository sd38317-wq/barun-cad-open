import {standardLayerForName} from './layer-standards.js';
// 구조 그리기 카드 두 개. 원문 대화상자 그림을 그대로 옮겼다.
//  BLS 보 스케쥴 작성(xiBeamListSchedule) — izzarder.com/553
//  TRUSS 트러스 그리기(xiTtruss)          — izzarder.com/268
import * as G from './geometry.js';
import {entitiesSvg,openCardDialog,resolveLayers,isPlotBoxLayerName} from './card-kit.js';

/* 규칙서 6절 표준 켜. 트러스는 구조 보(A-BEAM), 스케쥴표는 주석 켜를 쓴다. */
export const STRUCTURE_LAYERS=Object.freeze({truss:'A-BEAM',text:'A-TEXT',line:'A-SYM'});
export const STRUCTURE_PREVIEW_COLORS=Object.freeze(Object.fromEntries(["A-BEAM","A-COL","A-TEXT","A-SYM"].map(name=>[name,standardLayerForName(name).color])));
const colorOf=name=>STRUCTURE_PREVIEW_COLORS[name];
const num=(v,d=0)=>{const n=Number(v);return Number.isFinite(n)?n:d;};

/* ══════════════════════════════════════════════════════════════════════
   TRUSS — 트러스 그리기 (izzarder.com/268)
   원문 대화상자: 켜 / 트러스 높이(A) 1500 / 주부재 너비(B) 300 /
   [v]단면재 표현 · 단면재 높이(C) 200 / [v]간재 표현 · 간재 두께(D) 200 / [ ]그룹으로 묶기.
   부재 배치는 원문 둘째 그림(결과 도면)을 픽셀로 재서 그대로 옮겼다 — 보고서 참조.
   ══════════════════════════════════════════════════════════════════════ */
export const TRUSS_STORAGE_KEY='barun-truss-card';

/** 원문 대화상자 값을 숫자로 바꾸고 서로 맞는지 본다. L 은 두 점 사이 거리. */
export function trussSizes(v,L){
 const A=num(v.height),B=num(v.mainWidth),C=num(v.capHeight),D=num(v.webThick);
 if(!(A>0))throw Error('트러스 높이(A)는 0보다 커야 합니다.');
 if(!(B>0))throw Error('주부재 너비(B)는 0보다 커야 합니다.');
 if(A<=B*2)throw Error(`트러스 높이(A ${A})는 주부재 너비(B ${B})의 2배보다 커야 합니다. 위·아래 주부재가 겹칩니다.`);
 if(v.endCap&&!(C>0&&C<=B))throw Error(`단면재 높이(C)는 0보다 크고 주부재 너비(B ${B}) 이하여야 합니다.`);
 if(v.web&&!(D>0))throw Error('간재 두께(D)는 0보다 커야 합니다.');
 if(Number.isFinite(L)){
  if(!(L>0))throw Error('두 점은 서로 다른 점이어야 합니다.');
  if(L<B*5)throw Error(`트러스 길이(${Math.round(L)})가 주부재 너비(B ${B})의 5배보다 짧아 부재가 겹칩니다. 두 점을 더 벌리거나 주부재 너비를 줄이세요.`);
 }
 return {A,B,C,D};
}
/** 축에 나란한 네모 안으로 선분을 자른다(없으면 null). 좌표는 트러스 지역좌표 [s,d]. */
export function clipSegment(a,b,rect,eps=1e-9){
 let t0=0,t1=1;const d=[b[0]-a[0],b[1]-a[1]];
 const lim=[[-d[0],a[0]-rect.s0],[d[0],rect.s1-a[0]],[-d[1],a[1]-rect.d0],[d[1],rect.d1-a[1]]];
 for(const [p,q] of lim){
  if(Math.abs(p)<eps){if(q<-eps)return null;continue;}
  const r=q/p;
  if(p<0){if(r>t1)return null;if(r>t0)t0=r;}else{if(r<t0)return null;if(r<t1)t1=r;}
 }
 if(t1-t0<eps)return null;
 return [[a[0]+d[0]*t0,a[1]+d[1]*t0],[a[0]+d[0]*t1,a[1]+d[1]*t1]];
}
/** 두께 t 인 사재 하나 = 중심선 양쪽으로 t/2 씩 민 평행선 두 줄, 칸(rect) 안으로 자른 것. */
export function braceLines(a,b,t,rect){
 const dx=b[0]-a[0],dy=b[1]-a[1],n=Math.hypot(dx,dy);
 if(!(n>0))return [];
 const px=-dy/n*t/2,py=dx/n*t/2,out=[];
 for(const s of [1,-1]){
  const seg=clipSegment([a[0]+px*s,a[1]+py*s],[b[0]+px*s,b[1]+py*s],rect);
  if(seg)out.push(seg);
 }
 return out;
}
/** 트러스 부재의 지역좌표 선분 목록. s 는 첫 점에서 잰 길이, d 는 바닥선에서 잰 높이. */
export function trussSegments(v,L){
 const {A,B,C,D}=trussSizes(v,L),seg=[],add=(s1,d1,s2,d2)=>seg.push([[s1,d1],[s2,d2]]);
 add(0,0,L,0);add(0,B,L,B);                 // 하현 주부재 위·아래 선
 add(0,A,L,A);add(B,A-B,L-B,A-B);           // 상현 주부재 위·아래 선(아래 선은 단부재 사이만)
 add(0,0,0,A);add(L,0,L,A);                 // 양 끝선
 add(B,B,B,A);add(L-B,B,L-B,A);             // 단부 수직 주부재 안쪽면
 const mid=L/2;
 for(const s of [B*2,L-B*2,mid-B/2,mid+B/2])add(s,B,s,A-B);   // 중간·중앙 수직 주부재
 if(v.web){
  const rectL={s0:B*2,s1:mid-B/2,d0:B,d1:A-B},rectR={s0:mid+B/2,s1:L-B*2,d0:B,d1:A-B};
  for(const [a,b,r] of [[[B*2,B],[mid-B/2,A-B],rectL],[[L-B*2,B],[mid+B/2,A-B],rectR]])
   for(const s of braceLines(a,b,D,r))seg.push(s);
 }
 if(v.endCap)for(const s0 of [0,L-B]){          // 단면재: 끝 두 칸의 맨 위, 높이 C 인 상자에 ×
  add(s0,A-C,s0+B,A-C);add(s0,A-C,s0+B,A);add(s0,A,s0+B,A-C);
 }
 return seg;
}
/** 두 점 사이에 놓은 트러스 객체. 켜는 이름(cardLayer)으로만 적고 실제 id 는 커밋할 때 바꾼다. */
export function trussGeometry(v,shared={},p1={x:0,y:0},p2={x:6000,y:0}){
 const L=G.dist(p1,p2);
 trussSizes(v,L);
 const u=G.unit(G.sub(p2,p1)),n=G.normal(u);
 const W=(s,d)=>G.add(p1,G.add(G.mul(u,s),G.mul(n,d)));
 const layer=shared.trussLayer||STRUCTURE_LAYERS.truss;
 const entities=trussSegments(v,L).map(([a,b])=>({type:'line',points:[W(a[0],a[1]),W(b[0],b[1])],cardLayer:layer}));
 return {entities,length:L,angle:G.angle(u)};
}
export const trussSummary=v=>`높이 ${num(v.height)} · 주부재 ${num(v.mainWidth)}`
 +(v.endCap?` · 단면재 ${num(v.capHeight)}`:' · 단면재 없음')+(v.web?` · 간재 ${num(v.webThick)}`:' · 간재 없음');

export const TRUSS_FIELDS=[
 {key:'height',label:'트러스 높이(A) (mm)',type:'number',def:1500,min:1,step:50,group:'크기'},
 {key:'mainWidth',label:'주부재 너비(B) (mm)',type:'number',def:300,min:1,step:10,group:'크기'},
 {key:'endCap',label:'단면재 표현',type:'check',def:true,group:'단면재'},
 {key:'capHeight',label:'단면재 높이(C) (mm)',type:'number',def:200,min:1,step:10,group:'단면재',when:v=>!!v.endCap},
 {key:'web',label:'간재 표현',type:'check',def:true,group:'간재'},
 {key:'webThick',label:'간재 두께(D) (mm)',type:'number',def:200,min:1,step:10,group:'간재',when:v=>!!v.web},
 {key:'group',label:'그룹으로 묶기',type:'check',def:false,group:'간재',hint:'켜면 트러스 전체를 블록 객체 하나로 넣습니다'},
];
export const TRUSS_SHARED_FIELDS=[{key:'trussLayer',label:'켜',type:'layer',def:STRUCTURE_LAYERS.truss,group:'켜'}];
export const trussSlotDefaults=i=>[
 {name:'기본 A1500 B300',height:1500,mainWidth:300,capHeight:200,webThick:200,endCap:true,web:true},
 {name:'단면재 없음',endCap:false},
 {name:'간재 없음',web:false},
 {name:'낮은 트러스 A900',height:900,mainWidth:200,capHeight:150,webThick:150},
][i]||{};
export function trussPreviewSvg(v,shared,opts={}){
 let es=[];
 try{es=trussGeometry(v,shared,{x:0,y:0},{x:Math.max(num(v.mainWidth,300)*5,num(v.height,1500)*3.3),y:0}).entities;}catch{es=[];}
 return entitiesSvg(es,{label:opts.compact?'':`트러스 ${trussSummary(v)} · 두 점은 아래 모서리`,colorOf:e=>colorOf(e.cardLayer),...opts});
}

/* ══════════════════════════════════════════════════════════════════════
   BLS — 보 스케쥴 작성 (izzarder.com/553)
   보일람표의 칸마다 [기호문자 영역]과 [치수영역]을 읽어 크기별로 묶은 리스트 표를 만든다.
   ══════════════════════════════════════════════════════════════════════ */
export const BLS_STORAGE_KEY='barun-bls-card';
export const BLS_REGISTRATION_KEY='barun-bls-card-registration';
export const BLS_PLOT_BOX_LAYER='PLOT_BOX';   // 원문 [지정켜]의 켜 이름 그대로
const DIV_MODE_LEN=Object.freeze({none:0,one:1,two:2,three:3});

/** 맨 앞 지하층 표시 "-" 은 분류 인식에서 자동으로 제외된다(원문 주의사항). */
export const stripUnderground=s=>String(s??'').trim().replace(/^-+/,'');
/** [기호 문자별 분류 구분] 한 칸으로 묶을 분류 키. 같은 키 + 같은 크기끼리 한 칸에 모인다. */
export function classifyKey(symbol,mode,onlyText=''){
 const s=stripUnderground(symbol);
 if(mode==='only'){const t=String(onlyText??'').trim();return t&&s.startsWith(t)?'only:'+t:'self:'+s;}
 const n=DIV_MODE_LEN[mode];
 if(!n)return 'self:'+s;                       // [안함] — 한 칸에 기호 하나
 return 'head:'+s.slice(0,n);
}
export const rectOf=(a,b)=>({minX:Math.min(a.x,b.x),minY:Math.min(a.y,b.y),maxX:Math.max(a.x,b.x),maxY:Math.max(a.y,b.y)});
export const boxOf=e=>{const b=G.bounds([e]);return {minX:b.minX,minY:b.minY,maxX:b.maxX,maxY:b.maxY};};
/** 네모를 기준점에서 잰 상대값으로 / 상대값을 다시 네모로. 등록한 영역을 다른 도곽에 그대로 쓰려고 쓴다. */
export const relRect=(r,o)=>({x0:r.minX-o.x,y0:r.minY-o.y,x1:r.maxX-o.x,y1:r.maxY-o.y});
export const absRect=(rel,o)=>({minX:o.x+rel.x0,minY:o.y+rel.y0,maxX:o.x+rel.x1,maxY:o.y+rel.y1});
const inRect=(p,r,tol=0)=>p&&p.x>=r.minX-tol&&p.x<=r.maxX+tol&&p.y>=r.minY-tol&&p.y<=r.maxY+tol;

/** [도곽 영역] 방식: 좌상단 한 칸을 도곽 안에 가로·세로로 깐다. 칸 크기가 곧 간격이다. */
export function tileCells(frame,first,tol=1){
 const w=first.maxX-first.minX,h=first.maxY-first.minY;
 if(!(w>0)||!(h>0))throw Error('좌상단 한 칸의 영역이 너무 작습니다. 두 점을 다시 지정하세요.');
 const cols=Math.max(1,Math.floor((frame.maxX-first.minX+tol)/w)),rows=Math.max(1,Math.floor((first.maxY-frame.minY+tol)/h));
 if(cols*rows>4000)throw Error('칸이 너무 많습니다(4000칸 초과). 도곽이나 한 칸 영역을 다시 지정하세요.');
 const out=[];
 for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)
  out.push({minX:first.minX+c*w,maxX:first.maxX+c*w,minY:first.minY-r*h,maxY:first.maxY-r*h});
 return out;
}
/** 네모 안 문자. 위→아래, 왼→오른쪽 순으로 읽는다. */
export function textsInRect(entities,rect){
 return (entities||[]).filter(e=>e.type==='text'&&!e.hidden&&inRect(e.position,rect))
  .sort((a,b)=>Math.abs(a.position.y-b.position.y)>1?b.position.y-a.position.y:a.position.x-b.position.x)
  .map(e=>String(e.text??'').trim()).filter(Boolean);
}
/** 치수 객체의 잰 값(mm). 직선 치수만 읽는다. */
export function dimensionValue(e){
 if(e?.type!=='dimension'||!Array.isArray(e.points)||e.points.length<2)return null;
 const [a,b]=e.points,d=G.sub(b,a);
 if(e.mode==='horizontal')return {value:Math.abs(d.x),vertical:false};
 if(e.mode==='vertical')return {value:Math.abs(d.y),vertical:true};
 if(e.mode==='aligned')return {value:G.len(d),vertical:Math.abs(d.y)>Math.abs(d.x)};
 return null;
}
const round=n=>Number(n.toFixed(2)).toString();
/** 네모 안의 치수(또는 숫자 문자)에서 "가로x세로" 를 읽는다. 가로 = 수평 치수, 세로 = 수직 치수. */
export function readSizeInRect(entities,rect){
 let w=null,d=null;
 for(const e of entities||[]){
  if(e.hidden)continue;
  if(e.type==='dimension'){
   const mid=Array.isArray(e.points)&&e.points.length>=2?G.mul(G.add(e.points[0],e.points[1]),.5):null;
   if(!inRect(mid,rect))continue;
   const v=dimensionValue(e);if(!v||!(v.value>0))continue;
   if(v.vertical){if(d===null)d=round(v.value);}else if(w===null)w=round(v.value);
  }
 }
 if(w!==null&&d!==null)return `${w}x${d}`;      // 원문대로 치수 객체를 먼저 읽는다
 for(const t of textsInRect(entities,rect)){
  const both=t.match(/(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)/);
  if(both)return `${both[1]}x${both[2]}`;
 }
 if(w===null||d===null)for(const e of entities||[]){
  if(e.type!=='text'||e.hidden||!inRect(e.position,rect))continue;
  const m=String(e.text??'').match(/\d+(?:\.\d+)?/);if(!m)continue;
  const up=Math.abs(G.normalizeAngle(e.rotation||0)-90)<20||Math.abs(G.normalizeAngle(e.rotation||0)-270)<20;
  if(up){if(d===null)d=m[0];}else if(w===null)w=m[0];
 }
 return w!==null&&d!==null?`${w}x${d}`:'';
}
/** 칸 목록을 읽어 {기호, 크기, 기준점} 기록으로 바꾼다. 둘 다 빈 칸은 버린다. */
export function readCells(entities,cells){
 const out=[];
 for(const c of cells){
  const symbol=textsInRect(entities,c.symbol).join(' ').trim(),size=readSizeInRect(entities,c.size);
  if(!symbol&&!size)continue;
  out.push({symbol,size,box:c.box});
 }
 return out;
}
/** [정렬기준점 및 순서]. 기준점 네 모서리 중 하나를 잡고, 가로/세로 우선 · 위→아래 / 아래→위 로 줄 세운다. */
export function sortRecords(records,{origin='bl',order='hDown',tolerance=10,pickOrder=false}={}){
 if(pickOrder)return [...records];
 const pt=r=>({x:origin==='br'||origin==='tr'?r.box.maxX:r.box.minX,y:origin==='tl'||origin==='tr'?r.box.maxY:r.box.minY});
 const tol=Math.max(0,num(tolerance,10)),band=(v,dir)=>dir*Math.round(v/(tol||1));
 const horizontal=order==='hDown'||order==='hUp',downFirst=order==='hDown'||order==='vDown';
 return [...records].map((r,i)=>({r,i,p:pt(r)})).sort((a,b)=>{
  if(horizontal){
   const y=band(a.p.y,downFirst?-1:1)-band(b.p.y,downFirst?-1:1);if(y)return y;
   const x=a.p.x-b.p.x;if(x)return x;
  }else{
   const x=band(a.p.x,1)-band(b.p.x,1);if(x)return x;
   const y=downFirst?b.p.y-a.p.y:a.p.y-b.p.y;if(y)return y;
  }
  return a.i-b.i;
 }).map(o=>o.r);
}
/** 같은 크기 · 같은 분류 키끼리 한 칸으로 모은다. 나오는 순서를 그대로 지킨다. */
export function aggregateRows(records,{mode='two',onlyText=''}={}){
 const map=new Map();
 for(const r of records){
  const key=(r.size||'')+' '+classifyKey(r.symbol,mode,onlyText);
  if(!map.has(key))map.set(key,{symbols:[],size:r.size||''});
  const row=map.get(key);
  if(r.symbol&&!row.symbols.includes(r.symbol))row.symbols.push(r.symbol);
 }
 return [...map.values()];
}
/** 기호를 한 줄에 몇 개씩 끊을지. 원문 실행 예 그림이 한 줄에 3개다. */
export const chunkSymbols=(symbols,perLine=3)=>{
 const out=[];for(let i=0;i<symbols.length;i+=perLine)out.push(symbols.slice(i,i+perLine).join(','));
 return out.length?out:[''];
};
/** 리스트 표 객체(선 + 문자). 삽입점은 표의 왼쪽 위다. 공란은 사선 한 줄로 표시한다(원문). */
export function scheduleEntities(rows,{x=0,y=0,scale=100,textHeight=2.5,lineGap=6,verticalLines=false,
 symbolGap=60,sizeGap=30,remarkGap=30,perLine=3,textLayer=STRUCTURE_LAYERS.text,lineLayer=STRUCTURE_LAYERS.line}={}){
 if(!rows?.length)throw Error('스케쥴에 넣을 보가 없습니다. 기호문자 영역과 치수영역을 다시 지정하세요.');
 const s=num(scale,100),h=num(textHeight,2.5)*s,rh=num(lineGap,6)*s;
 if(!(s>0))throw Error('목록표 축척은 0보다 커야 합니다.');
 if(!(h>0))throw Error('문자높이는 0보다 커야 합니다.');
 if(!(rh>=h))throw Error('선 간격은 문자높이보다 커야 합니다.');
 const widths=[num(symbolGap,60)*s,num(sizeGap,30)*s,num(remarkGap,30)*s];
 if(widths.some(w=>!(w>0)))throw Error('문자 간격(기호·크기·비고)은 0보다 커야 합니다.');
 const xs=[x];for(const w of widths)xs.push(xs.at(-1)+w);
 const out=[],line=(a,b,layer)=>out.push({type:'line',points:[a,b],cardLayer:layer});
 const total=xs.at(-1)-x;
 line({x,y},{x:x+total,y},lineLayer);
 let yy=y;
 for(const row of rows){
  const lines=chunkSymbols(row.symbols,perLine),rowH=rh*lines.length,top=yy;
  yy-=rowH;
  lines.forEach((t,i)=>{if(t)out.push({type:'text',position:{x:xs[0]+h*.5,y:top-rh*(i+.5)-h*.35},text:t,height:h,rotation:0,align:'left',cardLayer:textLayer});});
  if(!row.symbols.length)line({x:xs[0],y:yy},{x:xs[1],y:top},lineLayer);
  if(row.size)out.push({type:'text',position:{x:xs[1]+h*.5,y:top-rh*.5-h*.35},text:row.size,height:h,rotation:0,align:'left',cardLayer:textLayer});
  else line({x:xs[1],y:yy},{x:xs[2],y:top},lineLayer);
  line({x,y:yy},{x:x+total,y:yy},lineLayer);
 }
 if(verticalLines)for(const cx of xs)line({x:cx,y},{x:cx,y:yy},lineLayer);
 return out;
}
/** [크기를 평면도에 쓰기]. 숫자 뒤 영문자부터 기호로 보므로 앞의 층표시 숫자는 무시하고 견준다(원문). */
export const planSymbolKey=s=>stripUnderground(s).replace(/^\d+/,'').toUpperCase();
export function planSizeFor(symbol,rows,{between=''}={}){
 const key=planSymbolKey(symbol);if(!key)return '';
 for(const row of rows)for(const s of row.symbols)if(planSymbolKey(s)===key)return row.size?`${symbol}${between}${row.size}`:'';
 return '';
}
/** [영역의 종류] 에 맞는 도곽·영역 후보. layerNameOf 는 켜 id → 이름. */
export function areaCandidates(entities,{kindIsBlock=true,method='frame',layerNameOf=()=>''}={}){
 return (entities||[]).filter(e=>{
  if(e.hidden)return false;
  if(kindIsBlock)return e.type==='block';
  if(!['polyline','rectangle'].includes(e.type)||!(e.points?.length>=4))return false;
  if(e.type==='polyline'&&!e.closed)return false;
  return method==='frame'?isPlotBoxLayerName(layerNameOf(e.layer)):true;
 });
}
/* 등록(도곽·영역 + 문자·치수 영역)을 저장해 두고 다시 쓴다 — 원문 [등록사용]. */
export function loadRegistration(storage,key=BLS_REGISTRATION_KEY){
 try{const r=JSON.parse(storage?.getItem(key)||'null');return r&&typeof r==='object'&&r.method?r:null;}catch{return null;}
}
export function saveRegistration(storage,reg,key=BLS_REGISTRATION_KEY){try{storage?.setItem(key,JSON.stringify(reg));}catch{}}
/** 등록값 + 도곽(또는 개별 영역) 하나 → 읽을 칸 목록. */
export function cellsFromRegistration(reg,box){
 const o={x:box.minX,y:box.minY};
 if(reg.method==='cell'){const c={minX:box.minX,minY:box.minY,maxX:box.maxX,maxY:box.maxY};
  return [{box:c,symbol:absRect(reg.symbol,o),size:absRect(reg.size,o)}];}
 const first=absRect(reg.cell,o);
 return tileCells(box,first).map(c=>{const co={x:c.minX,y:c.minY};
  return {box:c,symbol:absRect(reg.symbol,co),size:absRect(reg.size,co)};});
}

export const BLS_FIELDS=[
 {key:'space',label:'작업공간',type:'select',def:'model',options:[['model','모형'],['paper','종이'],['all','모두']],group:'작업공간',hint:'바른 CAD 에는 종이공간이 없어 [모형]만 됩니다'},
 {key:'frameSelect',label:'공간별 도곽선택',type:'select',def:'screen',options:[['screen','화면선택'],['all','모두']],group:'작업공간',hint:'[배치선택]은 원문에서도 꺼져 있어 넣지 않았습니다'},
 {key:'origin',label:'정렬기준점',type:'select',def:'bl',options:[['bl','좌하'],['br','우하'],['tr','우상'],['tl','좌상']],group:'정렬기준점 및 순서'},
 {key:'order',label:'순서',type:'select',def:'hDown',options:[['hDown','가로 우선 · 위→아래'],['hUp','가로 우선 · 아래→위'],['vDown','세로 우선 · 위→아래'],['vUp','세로 우선 · 아래→위']],group:'정렬기준점 및 순서'},
 {key:'tolerance',label:'오차 (mm)',type:'number',def:10,min:0,step:1,group:'정렬기준점 및 순서'},
 {key:'pickOrder',label:'선택순',type:'check',def:false,group:'정렬기준점 및 순서',hint:'고른 순서 그대로 읽습니다'},
 {key:'divide',label:'기호문자별 분류 구분',type:'select',def:'two',options:[['none','안함'],['one','첫'],['two','둘'],['three','셋'],['only','이것만']],group:'기호문자별 분류 구분'},
 {key:'onlyText',label:'이것만 : 문자',type:'text',def:'',group:'기호문자별 분류 구분',when:v=>v.divide==='only'},
 {key:'method',label:'영역 인식 방법',type:'select',def:'frame',options:[['frame','도곽 영역'],['cell','개별 영역']],group:'영역'},
 {key:'kind',label:'영역의 종류',type:'select',def:'block',options:[['block','블럭'],['layer','지정켜']],group:'영역',hint:'지정켜는 도곽이면 PLOT_BOX 켜의 폴리선 박스만 봅니다'},
 {key:'useSaved',label:'등록사용',type:'check',def:false,group:'영역',hint:'끄면 실행할 때마다 도곽·문자영역·치수영역을 다시 물어봅니다'},
 {key:'scale',label:'목록표 축척: 1/',type:'number',def:100,min:1,step:10,group:'표 설정'},
 {key:'verticalLines',label:'수직선표현',type:'check',def:false,group:'표 설정',hint:'엑셀로 옮기려면 켭니다'},
 {key:'textHeight',label:'문자높이 (×축척)',type:'number',def:2.5,min:.1,step:.1,group:'표 설정'},
 {key:'lineGap',label:'선 간격 (×축척)',type:'number',def:6,min:.1,step:.5,group:'표 설정'},
 {key:'symbolGap',label:'기호 (×축척)',type:'number',def:60,min:1,step:5,group:'문자간격'},
 {key:'sizeGap',label:'크기 (×축척)',type:'number',def:30,min:1,step:5,group:'문자간격'},
 {key:'remarkGap',label:'비고 (×축척)',type:'number',def:30,min:1,step:5,group:'문자간격',hint:'원문 그림에서 [비고] 입력칸 값이 잘려 보이지 않아 [크기]와 같게 두었습니다'},
 {key:'writePlan',label:'크기를 평면도에 쓰기',type:'check',def:false,group:'크기를 평면도에 쓰기'},
 {key:'between',label:'사이문자',type:'text',def:' ',group:'크기를 평면도에 쓰기',when:v=>!!v.writePlan},
];
export const BLS_SHARED_FIELDS=[
 {key:'textLayer',label:'문자켜',type:'layer',def:STRUCTURE_LAYERS.text,group:'표 설정'},
 {key:'lineLayer',label:'선 켜',type:'layer',def:STRUCTURE_LAYERS.line,group:'표 설정'},
];
export const blsSlotDefaults=i=>[
 {name:'도곽 영역 · 분류 둘',method:'frame',divide:'two'},
 {name:'분류 안함',divide:'none'},
 {name:'개별 영역',method:'cell'},
 {name:'수직선 표현(엑셀)',verticalLines:true},
][i]||{};
const BLS_SAMPLE=[{symbols:['1G1','1G1B','1G2B','1G3B'],size:'800x900'},{symbols:['1G2C','1G11D'],size:'650x1250'},{symbols:['1G11E'],size:''}];
export function blsPreviewSvg(v,shared,opts={}){
 let es=[];
 try{es=scheduleEntities(BLS_SAMPLE,{...blsTableOptions(v,shared),x:0,y:0});}catch{es=[];}
 return entitiesSvg(es,{label:opts.compact?'':`보 스케쥴 보기 · 기호 / 크기 / 비고 · 공란은 사선`,colorOf:e=>colorOf(e.cardLayer),...opts});
}
export const blsTableOptions=(v,shared={})=>({scale:num(v.scale,100),textHeight:num(v.textHeight,2.5),lineGap:num(v.lineGap,6),
 verticalLines:!!v.verticalLines,symbolGap:num(v.symbolGap,60),sizeGap:num(v.sizeGap,30),remarkGap:num(v.remarkGap,30),
 textLayer:shared.textLayer||STRUCTURE_LAYERS.text,lineLayer:shared.lineLayer||STRUCTURE_LAYERS.line});

/* ══════════════════════════════════════════════════════════════════════
   화면 흐름 (DOM 이 있어야 돈다)
   ══════════════════════════════════════════════════════════════════════ */
export function installStructureCards(ctx){
 const rectPreview=r=>[{type:'polyline',closed:true,previewColor:'#ff5a5a',
  points:[{x:r.minX,y:r.minY},{x:r.maxX,y:r.minY},{x:r.maxX,y:r.maxY},{x:r.minX,y:r.maxY}]}];
 async function pickRect(prompt){
  const path=await ctx.pickPath({prompt:prompt+' · 두 점 · Esc 중단',minPoints:2,maxPoints:2,
   preview:(points,cursor)=>points[0]&&cursor?rectPreview(rectOf(points[0],cursor)):[]});
  if(!path)return null;
  const r=rectOf(path.points[0],path.points[1]);
  if(!(r.maxX-r.minX>0)||!(r.maxY-r.minY>0))throw Error('영역의 두 점이 한 줄 위에 있습니다. 네모가 되게 다시 찍으세요.');
  return r;
 }

 /* ── TRUSS ── */
 async function drawTruss(v,shared){
  const previewOf=(points,cursor)=>{
   const a=points[0],b=points[1]||cursor;if(!a||!b)return [];
   try{return trussGeometry(v,shared,a,b).entities.map(e=>({...e,previewColor:colorOf(e.cardLayer)}));}catch{return [];}
  };
  const path=await ctx.pickPath({prompt:`트러스 ${trussSummary(v)} · 두 점(양 지지점, 아래 모서리) · Esc 중단`,preview:previewOf,minPoints:2,maxPoints:2});
  if(!path)return null;
  const r=trussGeometry(v,shared,path.points[0],path.points[1]);
  let list=resolveLayers(ctx,r.entities,colorOf);
  if(v.group)list=[{type:'block',name:`트러스 ${Math.round(r.length)}`,layer:list[0].layer,entities:list}];
  const ids=ctx.commit({removeIds:[],entities:list});
  ctx.toast(`트러스 길이 ${Math.round(r.length)} · ${trussSummary(v)}${v.group?' · 블록 하나로 묶음':''} · Ctrl+Z 로 되돌리기`);
  return ids;
 }

 /* ── BLS ── */
 async function registerAreas(v){
  const isCell=v.method==='cell';
  const pick=await ctx.pickEntity({prompt:isCell?'개별 영역 블럭(또는 폴리선 박스)을 고르세요 · Esc 중단':'보일람표 도곽을 고르세요 · Esc 중단',
   types:v.kind==='block'?['block']:['polyline','rectangle']});
  if(!pick)return null;
  const box=boxOf(pick),o={x:box.minX,y:box.minY};
  let cell=null;
  if(!isCell){
   const c=await pickRect('② 도곽 안 보일람표의 좌상단 한 칸 영역');if(!c)return null;cell=relRect(c,o);
  }
  const symbolOrigin=isCell?o:{x:o.x+cell.x0,y:o.y+cell.y0};
  const sym=await pickRect(isCell?'② 영역 중에 문자 영역':'③ 기호문자 영역');if(!sym)return null;
  const size=await pickRect(isCell?'③ 영역 중에 치수 영역':'④ 중앙부 보의 치수영역');if(!size)return null;
  const reg={method:isCell?'cell':'frame',kind:v.kind,width:box.maxX-box.minX,height:box.maxY-box.minY,
   cell,symbol:relRect(sym,symbolOrigin),size:relRect(size,symbolOrigin)};
  saveRegistration(ctx.storage,reg);
  return {reg,box};
 }
 async function collectBoxes(v,first){
  if(v.frameSelect==='all'){
   const names=new Map(ctx.layers().map(l=>[l.id,l.name]));
   const found=areaCandidates(ctx.entities(),{kindIsBlock:v.kind==='block',method:v.method,layerNameOf:id=>names.get(id)||''}).map(boxOf);
   if(!found.length)throw Error(v.kind==='block'?'도면에서 블럭을 찾지 못했습니다. [영역의 종류]를 확인하세요.':`${BLS_PLOT_BOX_LAYER} 켜의 폴리선 박스를 찾지 못했습니다.`);
   return found;
  }
  const out=first?[first]:[];
  for(;;){
   const e=await ctx.pickEntity({prompt:`${v.method==='cell'?'영역':'도곽'}을 더 고르세요(${out.length}개 골랐음) · Esc 로 끝 · 그만 고르면 표를 만듭니다`,
    types:v.kind==='block'?['block']:['polyline','rectangle']});
   if(!e)break;
   out.push(boxOf(e));
   if(out.length>=200)break;
  }
  if(!out.length)throw Error('읽을 도곽(영역)을 하나도 고르지 않았습니다.');
  return out;
 }
 async function writeOnPlan(v,rows){
  const added=[];
  for(;;){
   const t=await ctx.pickEntity({prompt:`구조 평면도의 기호 문자를 고르세요(${added.length}개 기록함) · Esc 로 끝`,types:['text']});
   if(!t)break;
   const text=planSizeFor(String(t.text??''),rows,{between:v.between??' '});
   if(!text){ctx.toast(`"${t.text}" 와 같은 기호가 스케쥴에 없습니다.`,true);continue;}
   added.push({type:'text',position:{x:t.position.x+(t.height||150)*.6,y:t.position.y},text,height:t.height||150,rotation:t.rotation||0,align:'left',layer:t.layer});
   if(added.length>=500)break;
  }
  if(added.length)ctx.commit({removeIds:[],entities:added});
  return added.length;
 }
 async function runBls(v,shared){
  if(v.space!=='model')throw Error('바른 CAD 에는 종이공간·배치가 없습니다. [작업공간]을 [모형]으로 두고 다시 실행하세요.');
  if(v.divide==='only'&&!String(v.onlyText||'').trim())throw Error('[이것만] 을 골랐으면 옆 칸에 분류할 첫 문자를 넣으세요.');
  let reg=v.useSaved?loadRegistration(ctx.storage):null,first=null;
  if(!reg){const r=await registerAreas(v);if(!r)return null;reg=r.reg;first=r.box;}
  const boxes=await collectBoxes(v,first);
  const es=ctx.entities(),cells=[];
  for(const b of boxes)for(const c of cellsFromRegistration(reg,b))cells.push(c);
  const records=sortRecords(readCells(es,cells),{origin:v.origin,order:v.order,tolerance:v.tolerance,pickOrder:!!v.pickOrder});
  if(!records.length)throw Error('기호문자 영역·치수영역에서 읽어낸 것이 없습니다. 등록한 영역이 칸과 맞는지 확인하세요.');
  const rows=aggregateRows(records,{mode:v.divide,onlyText:v.onlyText});
  const opts=blsTableOptions(v,shared);
  const point=await ctx.pickPath({prompt:`보 ${records.length}개 → ${rows.length}줄 · 스케쥴표 왼쪽 위 점 · Esc 중단`,minPoints:1,maxPoints:1,
   preview:(points,cursor)=>{const p=points[0]||cursor;if(!p)return [];
    try{return scheduleEntities(rows,{...opts,x:p.x,y:p.y}).map(e=>({...e,previewColor:colorOf(e.cardLayer)}));}catch{return [];}}});
  if(!point)return null;
  const p=point.points[0];
  const ids=ctx.commit({removeIds:[],entities:resolveLayers(ctx,scheduleEntities(rows,{...opts,x:p.x,y:p.y}),colorOf)});
  ctx.toast(`보 ${records.length}개를 ${rows.length}줄로 모았습니다 · Ctrl+Z 로 되돌리기`);
  if(v.writePlan){const n=await writeOnPlan(v,rows);ctx.toast(n?`평면도에 크기 ${n}개를 적었습니다.`:'평면도에 적은 것이 없습니다.');}
  return ids;
 }

 return {
  BLS:()=>openCardDialog({ctx,title:'보 스케쥴 작성 · BLS',storageKey:BLS_STORAGE_KEY,fields:BLS_FIELDS,sharedFields:BLS_SHARED_FIELDS,
   slots:4,slotDefaults:blsSlotDefaults,preview:(v,s,o)=>blsPreviewSvg(v,s,o),
   validate:v=>{if(v.space!=='model')throw Error('바른 CAD 에는 종이공간이 없어 [작업공간]은 [모형]만 됩니다.');
    if(v.divide==='only'&&!String(v.onlyText||'').trim())throw Error('[이것만] 을 골랐으면 옆 칸에 분류할 첫 문자를 넣으세요.');
    scheduleEntities(BLS_SAMPLE,blsTableOptions(v));},
   onGo:(v,s)=>runBls(v,s),goLabel:'스케쥴 만들기',
   note:'[만들기] → (등록사용이 꺼져 있으면) 도곽 → 좌상단 한 칸 → 기호문자 영역 → 치수영역을 차례로 지정 → 읽을 도곽을 더 고르고 Esc → 표 왼쪽 위 점 → 표가 들어갑니다. 공란은 사선으로 표시합니다. 맨 앞 "-"(지하층)는 분류에서 자동으로 빠집니다.'}),
  TRUSS:()=>openCardDialog({ctx,title:'트러스 그리기 · TRUSS',storageKey:TRUSS_STORAGE_KEY,fields:TRUSS_FIELDS,sharedFields:TRUSS_SHARED_FIELDS,
   slots:4,slotDefaults:trussSlotDefaults,preview:(v,s,o)=>trussPreviewSvg(v,s,o),
   validate:v=>{trussSizes(v,NaN);},onGo:(v,s)=>drawTruss(v,s),
   note:'치수를 정하고 [그리기 시작] → 두 점(트러스 양 지지점)을 찍으면 그려집니다. 두 점은 트러스의 아래 모서리이고, 트러스는 첫 점에서 둘째 점으로 보아 왼쪽(위쪽)에 그려집니다. 원문은 구조가 반영된 트러스가 아니라 그림상 표현입니다.'}),
 };
}
