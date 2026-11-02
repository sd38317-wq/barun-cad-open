// 문 그리기 카드 D1(간단문) · D2·D3(상세문). izzarder.com/171·172·173 의 설정 항목과 조작 순서를 옮겼다.
// 조작: 문 폭 → 세 점(1 힌지 위치, 2 같은 벽선 위 문이 열리는 쪽 방향, 3 반대쪽 벽선) → 벽선 절단 + 문 생성.
// 켜 설정은 D1·D2·D3 가 공통이다(원문과 같음).
// H85(2026-09-26, 훈민 WD·DR·WDR / ACA Door Styles 대조): 문 종류 [여닫이 / 양개 / 편개 / 철제(S)] 와 마감 두께를 더했다.
//  - 새 설정의 기본값(여닫이 · 마감 0)은 예전과 한 글자도 다르지 않은 도형을 만든다(arch-cards.test.js 기준값 비교).
//  - 철제문: 문틀 폭(틀 폭) × 깊이의 ㄷ자 철판 문틀(1.6t 이중선)을 그리고 문짝·궤적은 그대로다.
//  - 마감 두께: 찍은 벽선을 골조면으로 보고 양쪽 면에 마감(미장·보드)만큼 문틀·절단 범위·단면 정리선을 마감면까지 넓힌다.
//  - 실행방식 '명령행 순서': 종류 → 힌지 쪽 벽 끝·반대 벽 두 점 → 폭 → 벽 끝에서 거리 → 마감 두께.
import * as G from './geometry.js';
import {doorClearWidth} from './access-review.js';
import {nextReviewObjectId} from './review-model.js';
import {STD_LAYERS,builder,snapWallFrame,wallFrame,cutWallBand,capLines,entitiesSvg,openCardDialog,loadCardState,resolveLayers,normalizeValues,toWorld,wallFaceSegments,linkCardOpening} from './card-kit.js';

export const DOOR_STORAGE_KEY='barun-door-cards';
export const DOOR_SLOTS=6;
export const DOOR_FIXED_NAMES=['D1 간단문','D2 상세문','D3 상세문 (설정 2)'];
/** 문 종류. swing(여닫이)=예전 동작(폭이 양개문 시작길이 이상이거나 '양쪽으로'면 양개), double=항상 양개, single=항상 한 짝, steel=철제문. */
export const DOOR_TYPE_OPTIONS=[['swing','여닫이 (폭에 따라 자동 양개)'],['double','양개 (항상 두 짝)'],['single','편개 (항상 한 짝)'],['steel','철제 (S) · 철판 문틀']];
/** 명령행 순서의 종류 입력 글자: 여닫이(W) / 양개(D) / 편개(P) / 철제(S). 한글 자판 글자(ㅈ·ㅇ·ㅔ·ㄴ)와 한글 이름도 받는다. */
export const DOOR_TYPE_LETTERS=Object.freeze({swing:'W',double:'D',single:'P',steel:'S'});
const DOOR_TYPE_WORDS={W:'swing',D:'double',P:'single',S:'steel','ㅈ':'swing','ㅇ':'double','ㅔ':'single','ㄴ':'steel','여닫이':'swing','양개':'double','편개':'single','철제':'steel','철제문':'steel',SWING:'swing',DOUBLE:'double',SINGLE:'single',STEEL:'steel'};
/** 종류 입력 풀이. 빈칸이면 fallback(기본값 Enter), 모르는 글자면 null. */
export function parseDoorTypeOption(text,fallback='swing'){
 const s=String(text??'').trim();
 if(!s)return fallback;
 const up=s.toUpperCase();
 return Object.hasOwn(DOOR_TYPE_WORDS,up)?DOOR_TYPE_WORDS[up]:Object.hasOwn(DOOR_TYPE_WORDS,s)?DOOR_TYPE_WORDS[s]:null;
}
export const DOOR_FINISH_MAX=200;

export const DOOR_FIELDS=[
 {key:'runMode',label:'실행방식',type:'select',def:'dialog',options:[['dialog','대화상자 먼저'],['command','명령입력 먼저 (창 없이 바로 폭·점 입력)'],['sequence','명령행 순서 (종류 → 벽 끝·반대 벽 → 폭 → 벽 거리 → 마감)']],group:'실행방식'},
 {key:'detail',label:'문 표현',type:'select',def:'detail',options:[['simple','간단문 (단선)'],['detail','상세문 (문틀·문짝 두께)']],group:'문',when:v=>v.doorType!=='steel'},
 {key:'doorType',label:'문 종류',type:'select',def:'swing',options:DOOR_TYPE_OPTIONS,group:'문',hint:'여닫이는 예전과 같이 폭이 양개문 시작길이 이상이면 양개로 그립니다. 편개는 폭과 관계없이 한 짝, 양개는 항상 두 짝입니다.'},
 {key:'width',label:'문짝 폭 (mm, 틀 제외)',type:'number',def:940,min:100,step:10,group:'문'},
 {key:'swing',label:'열리는 방식',type:'select',def:'single',options:[['single','한쪽으로 (외여닫이)'],['double','양쪽으로 (양개)']],group:'문',when:v=>v.doorType!=='double'&&v.doorType!=='single'},
 {key:'offset',label:'시작점에서 개구부 띄울 거리 (mm)',type:'number',def:0,min:0,step:10,group:'문',hint:'0 이면 찍은 점을 벽선 위 가장 가까운 점으로 씁니다. 명령행 순서에서는 벽 끝에서의 거리입니다.'},
 {key:'doubleFrom',label:'양개문 시작길이 (mm)',type:'number',def:1500,min:100,step:10,group:'양개문 설정',hint:'이 폭 이상이면 자동으로 양개문'},
 {key:'split',label:'분할',type:'select',def:'equal',options:[['equal','1:1 등분'],['twoOne','2:1 분할'],['fixed','한쪽문 고정']],group:'양개문 설정'},
 {key:'fixedWidth',label:'고정폭 길이 (mm, 힌지 쪽)',type:'number',def:600,min:50,step:10,group:'양개문 설정',when:v=>v.split==='fixed'},
 {key:'openAngle',label:'문 열림 각도 (도)',type:'number',def:90,min:5,max:180,step:5,group:'양개문 설정'},
 {key:'position',label:'문의 위치',type:'select',def:'center',options:[['center','벽중심'],['hinge','힌지 쪽 돌출'],['opposite','반대 쪽 돌출']],group:'문틀 크기와 위치'},
 {key:'protrude',label:'돌출길이 (mm, − 는 역방향)',type:'number',def:0,step:5,group:'문틀 크기와 위치',when:v=>v.position!=='center'},
 {key:'frameWidth',label:'틀 폭 (mm)',type:'number',def:45,min:0,step:5,group:'문틀 크기와 위치'},
 {key:'leafThickness',label:'문 두께 (mm, 0 = 단선)',type:'number',def:40,min:0,step:5,group:'문틀 크기와 위치'},
 {key:'gap',label:'골조와 문틀 사이 간격 (mm)',type:'number',def:0,min:0,step:5,group:'문틀 크기와 위치'},
 {key:'finishThickness',label:'마감 두께 (mm, 벽 한쪽 면)',type:'number',def:0,min:0,max:DOOR_FINISH_MAX,step:5,group:'문틀 크기와 위치',hint:'찍은 벽선을 골조면으로 보고 양쪽 면에 이 두께만큼 마감(미장·보드)이 있다고 봅니다. 문틀·벽선 절단·단면 정리선이 마감면까지 넓어집니다. 0 이면 예전과 같습니다.'},
 {key:'steelDepth',label:'철판 문틀 깊이 (mm, 0 = 마감면까지 벽 두께 전체)',type:'number',def:100,min:0,max:400,step:5,group:'철제문 (S)',when:v=>v.doorType==='steel'},
 {key:'steelPlate',label:'철판 두께 (mm)',type:'number',def:1.6,min:0.5,max:5,step:0.1,group:'철제문 (S)',when:v=>v.doorType==='steel',hint:'문틀 단면을 이 간격의 이중선(ㄷ자)으로 그립니다. 문틀 폭은 위 [틀 폭], 문짝 두께는 [문 두께](40~45 권장)를 씁니다.'},
 {key:'swingMark',label:'열림 궤적 표시',type:'select',def:'arc',options:[['arc','호'],['line','직선'],['both','호 + 직선'],['none','없음']],group:'표현'},
 {key:'wallCap',label:'벽선 정리',type:'select',def:'first',options:[['first','첫번째 선을 따라 (한 선)'],['each','각각의 벽선으로']],group:'표현'},
];
export const DOOR_SHARED_FIELDS=[
 {key:'frameLayer',label:'문틀 켜',type:'layer',def:STD_LAYERS.door,group:'켜 설정 (D1·D2·D3 공통)'},
 {key:'leafLayer',label:'문짝 켜',type:'layer',def:STD_LAYERS.door,group:'켜 설정 (D1·D2·D3 공통)'},
 {key:'swingLayer',label:'궤적 켜',type:'layer',def:STD_LAYERS.door,group:'켜 설정 (D1·D2·D3 공통)'},
];
export const doorSlotDefaults=i=>i===0?{detail:'simple',width:900,leafThickness:0,frameWidth:45}:{detail:'detail',leafThickness:40};

/** 마감 두께. 예전 값(키 없음)·잘못된 값은 0 이다. */
const finishOf=v=>Number.isFinite(v?.finishThickness)&&v.finishThickness>0?v.finishThickness:0;
/** 설정 검사(대화상자 [그리기 시작]·명령행 순서). 앞 두 문구는 예전 검사 그대로다. */
export function validateDoorValues(v){
 if(!(v.width>0))throw Error('문 폭은 양수여야 합니다.');
 if(v.split==='fixed'&&v.fixedWidth>=v.width)throw Error('고정폭은 문 폭보다 작아야 합니다.');
 if(v.finishThickness!==undefined&&!(Number.isFinite(v.finishThickness)&&v.finishThickness>=0&&v.finishThickness<=DOOR_FINISH_MAX))throw Error(`마감 두께는 0~${DOOR_FINISH_MAX} mm 사이여야 합니다.`);
 if(v.doorType==='steel')steelCheck(v,v.steelDepth>0?v.steelDepth:null);
}
function steelCheck(v,depth){
 const p=v.steelPlate;
 if(!(Number.isFinite(p)&&p>0))throw Error('철판 두께는 양수여야 합니다.');
 if(!(v.frameWidth>2*p))throw Error(`철제문은 틀 폭(${v.frameWidth} mm)이 철판 두께의 두 배(${2*p} mm)보다 커야 합니다.`);
 if(depth!==null&&!(depth>2*p))throw Error(`철판 문틀 깊이(${depth} mm)는 철판 두께의 두 배(${2*p} mm)보다 커야 합니다.`);
}

/** 문짝 나누기. 힌지 쪽 문이 첫째다. */
export function doorLeaves(v){
 const W=v.width,dbl=v.doorType==='double'?true:v.doorType==='single'?false:v.swing==='double'||W>=v.doubleFrom;
 if(!dbl)return [{s:0,w:W,right:false}];
 let w1=v.split==='equal'?W/2:v.split==='twoOne'?W*2/3:Math.min(W-50,Math.max(50,v.fixedWidth));
 return [{s:0,w:w1,right:false},{s:W,w:W-w1,right:true}];
}
/** 철제문 문틀의 벽 두께 방향 범위 [dA,dB]. 깊이 0 은 마감면까지 벽 두께 전체, 돌출 위치면 그쪽 마감면에 맞춘다. */
export function steelFrameSpan(f,v){
 const ft=finishOf(v),lo=ft>0?-ft:0,hi=f.t+ft,depth=v.steelDepth>0?v.steelDepth:hi-lo;
 if(v.position==='hinge'){const a=lo-v.protrude;return [a,a+depth];}
 if(v.position==='opposite'){const b=hi+v.protrude;return [b-depth,b];}
 const c=(lo+hi)/2;return [c-depth/2,c+depth/2];
}
/** 벽선 절단 띠와 단면 정리선 범위. 마감 0 이면 예전 식(0~t, 문짝 두께 반영) 그대로다. band 가 null 이면 절단 띠는 예전 기본값(0~t). */
export function doorExtents(f,v,dL){
 const ft=finishOf(v),lt=v.leafThickness,faceLo=ft>0?-ft:0,faceHi=f.t+ft;
 let capLo=Math.min(faceLo,dL-lt/2),capHi=Math.max(faceHi,dL+lt/2);
 if(v.doorType==='steel'){const [a,b]=steelFrameSpan(f,v);capLo=Math.min(capLo,a);capHi=Math.max(capHi,b);}
 return {capLo,capHi,band:ft>0?[faceLo,faceHi]:null};
}
/** 문 기하. 벽 좌표계 f(s 는 벽 방향, d 는 첫 벽선 0 → 반대 벽선 t) 안에서 만든다. 문은 셋째 점 쪽(d 증가 방향)으로 열린다. */
export function buildDoor(f,v,shared){
 const fw=v.frameWidth,g=v.gap,W=v.width,t=f.t,s0=v.offset,sh=s0+fw+g,cutEnd=s0+W+2*(fw+g);
 const lt=v.leafThickness,ft=finishOf(v);
 const dL=v.position==='center'?t/2:v.position==='hinge'?(ft>0?-ft-v.protrude:-v.protrude):(ft>0?t+ft+v.protrude:t+v.protrude);
 const b=builder(f,shared.frameLayer);
 const L={frame:shared.frameLayer,leaf:shared.leafLayer,swing:shared.swingLayer};
 if(v.doorType==='steel'){
  // 철판 문틀: 벽 쪽으로 열린 ㄷ자 단면. 바깥선과 철판 두께만큼 안쪽 선을 한 닫힌 폴리선(이중선)으로 그린다.
  const [dA,dB]=steelFrameSpan(f,v),p=v.steelPlate;
  steelCheck(v,dB-dA);
  const channel=(sWeb,sBack,dir)=>b.poly([[sBack,dA],[sWeb,dA],[sWeb,dB],[sBack,dB],[sBack,dB-p],[sWeb-dir*p,dB-p],[sWeb-dir*p,dA+p],[sBack,dA+p]],true,{layer:L.frame});
  channel(sh,s0+g,1);channel(sh+W,cutEnd-g,-1);
  if(g>0){b.line(s0,0,s0+g,0,{layer:L.frame});b.line(s0,t,s0+g,t,{layer:L.frame});b.line(cutEnd-g,0,cutEnd,0,{layer:L.frame});b.line(cutEnd-g,t,cutEnd,t,{layer:L.frame});}
 }else if(v.detail==='simple'){
  // 원문: 실제 문틀 대신 (틀 폭 + 간격) 길이의 단선을 벽 절단면에서 문까지 그린다.
  if(fw+g>0){b.line(s0,dL,sh,dL,{layer:L.frame});b.line(sh+W,dL,cutEnd,dL,{layer:L.frame});}
 }else{
  const lo=Math.min(ft>0?-ft:0,dL-lt/2),hi=Math.max(t+ft,dL+lt/2);
  if(fw>0){b.rect(s0+g,lo,sh,hi,{layer:L.frame});b.rect(sh+W,lo,cutEnd-g,hi,{layer:L.frame});}
  if(g>0){b.line(s0,0,s0+g,0,{layer:L.frame});b.line(s0,t,s0+g,t,{layer:L.frame});b.line(cutEnd-g,0,cutEnd,0,{layer:L.frame});b.line(cutEnd-g,t,cutEnd,t,{layer:L.frame});}
 }
 const a=v.openAngle,swings=[];
 for(const leaf of doorLeaves(v)){
  const hs=sh+leaf.s,dir=leaf.right?-1:1,ang=leaf.right?180-a:a;
  const tip=[hs+leaf.w*Math.cos(ang*Math.PI/180),dL+leaf.w*Math.sin(ang*Math.PI/180)];
  if(lt>0){
   const ux=Math.cos(ang*Math.PI/180),uy=Math.sin(ang*Math.PI/180),nx=-uy*lt/2,ny=ux*lt/2;
   b.poly([[hs-nx,dL-ny],[tip[0]-nx,tip[1]-ny],[tip[0]+nx,tip[1]+ny],[hs+nx,dL+ny]],true,{layer:L.leaf});
  }else b.line(hs,dL,tip[0],tip[1],{layer:L.leaf});
  const A=f.angle+f.flip*(leaf.right?180-a:0),B=f.angle+f.flip*(leaf.right?180:a);swings.push({center:toWorld(f,hs,dL),radius:leaf.w,startAngle:G.normalizeAngle(f.flip>0?A:B),endAngle:G.normalizeAngle(f.flip>0?B:A)});
  if(v.swingMark==='arc'||v.swingMark==='both')b.arc(hs,dL,leaf.w,leaf.right?180-a:0,leaf.right?180:a,{layer:L.swing});
  if(v.swingMark==='line'||v.swingMark==='both')b.line(tip[0],tip[1],hs+dir*leaf.w,dL,{layer:L.swing});
 }
 const openingWidthMm=W+2*fw,leafThicknessMm=lt;
 const blocked=doorLeaves(v).reduce((sum,l)=>sum+l.w*Math.max(0,Math.cos(a*Math.PI/180))+lt*Math.abs(Math.sin(a*Math.PI/180)),0);
 const reviewInput={openingWidthMm,frameWidthMm:fw,leafThicknessMm,clearWidthMm:Number(doorClearWidth(openingWidthMm,fw,blocked).toFixed(6)),swing:swings,partCount:b.list.length};
 for(const e of b.list)e.reviewInput=reviewInput;
 return {entities:b.list,cut:[s0,cutEnd],capPositions:[s0,cutEnd],dL};
}

/* ── 명령행 순서의 두 점: ① 힌지 쪽 벽선의 끝(벽 끝에서 [벽 거리]만큼 띄워 문을 놓는다) ② 반대쪽 벽선 ── */
const parallel=(a,b,u)=>{const v=G.sub(b,a),l=Math.hypot(v.x,v.y);return l>G.EPS&&Math.abs(G.cross(G.mul(v,1/l),u))<1e-4;};
function wallSegments(entities,layers){
 const center=new Set((layers||[]).filter(l=>/CNTR|GRID|CENTER|중심|(?:^|-)WALL-C(?:$|-)/i.test(l.name)||l.linetype==='CENTER').map(l=>l.id));
 const out=[];
 for(const e of entities||[]){
  if(!['line','polyline','rectangle','wall'].includes(e.type)||e.hidden||!Array.isArray(e.points))continue;
  if(center.has(e.layer)||String(e.linetype||'').toUpperCase().includes('CENTER'))continue;
  for(const [a,b] of wallFaceSegments(e))if(G.dist(a,b)>G.EPS)out.push({entity:e,a,b});
 }
 return out;
}
/** 두 점으로 벽 좌표계를 만든다. 원점은 첫 점 가까운 벽선 끝(허용오차 밖이면 찍은 점의 수선 발), s 축은 그 벽선의 안쪽(먼 끝) 방향,
 *  d 축은 둘째 점(반대쪽 벽선) 쪽이다. 벽 모서리처럼 후보가 여럿이면 둘째 점 근처에 평행선이 있는 벽선을 고른다. */
export function wallEndFrame(entities,pEnd,pOpp,tolerance,{layers=[]}={}){
 const segs=wallSegments(entities,layers);
 const near=segs.map(s=>({...s,d:G.distanceToSegment(pEnd,s.a,s.b)})).filter(s=>s.d<=tolerance);
 if(!near.length)throw Error('첫 점은 힌지 쪽 벽선의 끝 가까이에 찍으세요. 가까운 벽선을 찾지 못했습니다.');
 const oppOf=u=>segs.filter(s=>parallel(s.a,s.b,u)).map(s=>({...s,d:G.distanceToSegment(pOpp,s.a,s.b)})).filter(s=>s.d<=tolerance).sort((x,y)=>x.d-y.d)[0]||null;
 const ranked=near.map(s=>{const u=G.unit(G.sub(s.b,s.a)),opp=oppOf(u),off=Math.abs(G.cross(u,G.sub(pOpp,s.a)));return {...s,u,opp,score:(opp?0:1)*1e12+(off>G.EPS?0:1e11)+s.d};}).sort((x,y)=>x.score-y.score);
 const h=ranked[0];
 const [nearEnd,farEnd]=G.dist(pEnd,h.a)<=G.dist(pEnd,h.b)?[h.a,h.b]:[h.b,h.a];
 const v=G.sub(h.b,h.a),k=Math.max(0,Math.min(1,G.dot(G.sub(pEnd,h.a),v)/G.dot(v,v))),foot=G.add(h.a,G.mul(v,k));
 const origin=G.dist(foot,nearEnd)<=tolerance?nearEnd:foot,u=G.unit(G.sub(farEnd,nearEnd));
 const c=h.opp?G.add(h.opp.a,G.mul(G.unit(G.sub(h.opp.b,h.opp.a)),G.dot(G.sub(pOpp,h.opp.a),G.unit(G.sub(h.opp.b,h.opp.a))))):pOpp;
 const frame=wallFrame({x:origin.x,y:origin.y},G.add(origin,u),c);
 frame.snapped={first:h.entity,opposite:h.opp?.entity||null};
 return frame;
}

/** 미리보기용 가상 벽(두께 200) 위에 그린 문 */
export function doorPreviewSvg(v,shared,opts={}){
 const t=200,W=v.width,total=W+2*(v.frameWidth+v.gap),f=wallFrame({x:0,y:0},{x:1,y:0},{x:0,y:t});
 const door=buildDoor(f,v,shared),ft=finishOf(v);
 const wall=[{type:'line',points:[{x:-total*.3-v.offset,y:0},{x:v.offset,y:0}],cardLayer:'A-WALL'},{type:'line',points:[{x:-total*.3-v.offset,y:t},{x:v.offset,y:t}],cardLayer:'A-WALL'},
  {type:'line',points:[{x:door.cut[1],y:0},{x:door.cut[1]+total*.3,y:0}],cardLayer:'A-WALL'},{type:'line',points:[{x:door.cut[1],y:t},{x:door.cut[1]+total*.3,y:t}],cardLayer:'A-WALL'},
  ...capLines(f,door.capPositions,[{d:0,layer:'A-WALL'},{d:t,layer:'A-WALL'}],v.wallCap).map(e=>({...e,layer:undefined,cardLayer:'A-WALL'}))];
 if(ft>0)for(const d of [-ft,t+ft])wall.push({type:'line',points:[{x:-total*.3-v.offset,y:d},{x:v.offset,y:d}],cardLayer:'A-WALL',linetype:'DASHED'},{type:'line',points:[{x:door.cut[1],y:d},{x:door.cut[1]+total*.3,y:d}],cardLayer:'A-WALL',linetype:'DASHED'});
 const kind=v.doorType==='steel'?`철제문 ${v.steelPlate}t`:v.detail==='simple'?'간단문':'상세문';
 const extra=(v.doorType==='double'?' · 양개':v.doorType==='single'?' · 편개':'')+(ft>0?` · 마감 ${ft}`:'');
 return entitiesSvg([...wall,...door.entities],{label:opts.compact?'':`문 폭 ${W} · ${kind}${extra} · 셋째 점 쪽으로 열림`,...opts});
}

/* ── 화면 ── */
/** 공용 폼 창은 열리면 [닫기] 단추에 초점이 가므로 첫 입력칸으로 옮긴다(글자 + Enter 로 바로 넘어가게). 화면이 없으면 아무것도 안 한다. */
function focusFormField(){try{const el=globalThis.document?.getElementById?.('form-fields')?.querySelector?.('input,select,textarea');el?.focus?.();el?.select?.();}catch{}}
export function installDoorCards(ctx){
 const slotOf=name=>({D1:0,D2:1,D3:2})[name]??0;
 /** 벽 좌표계가 정해진 뒤: 문 생성 + 벽선 절단 + 단면 정리 → 한 번에 커밋(Ctrl+Z 한 번). */
 function place(v,shared,f){
  const door=buildDoor(f,v,shared),ext=doorExtents(f,v,door.dL);
  const cut=cutWallBand(ctx.entities(),f,door.cut[0],door.cut[1],ext.band?{layers:ctx.layers(),dMin:ext.band[0],dMax:ext.band[1]}:{layers:ctx.layers()});
  const caps=capLines(f,door.capPositions,cut.cuts,v.wallCap,{dLo:ext.capLo,dHi:ext.capHi,fallbackLayerName:shared.frameLayer});
  const numbering={reviewObjectSeq:ctx.doc?.().reviewObjectSeq},reviewObjectId=ctx.doc?nextReviewObjectId(numbering,'door'):null;
  if(reviewObjectId)for(const e of door.entities)e.reviewObjectId=reviewObjectId;
  const drawn=resolveLayers(ctx,cut.walls.length?[...door.entities,...caps].map(e=>e.cardLayer?{...e,cardOpeningLayer:e.cardLayer}:e):[...door.entities,...cut.add,...caps]);
  const entities=cut.walls.length?[...linkCardOpening(cut.walls,f,door.cut,'DOOR',v,shared,drawn,ctx.layers()),...cut.add]:drawn;
  const placed=entities.map(e=>e.category==='DOOR'?{...e,reviewObjectId,reviewInput:door.entities[0]?.reviewInput}:e);
  const ids=ctx.commit({removeIds:cut.removeIds,entities:placed,select:false,...(reviewObjectId?{reviewObjectSeq:numbering.reviewObjectSeq}:{})});
  const note=(v.doorType==='steel'?' · 철제문':v.doorType==='double'?' · 양개':v.doorType==='single'?' · 편개':'')+(finishOf(v)?` · 마감 ${finishOf(v)}`:'');
  ctx.toast(`문 [${v.name}] 폭 ${v.width}${note} · 벽선 ${cut.removeIds.length+cut.walls.length}개 절단 · Ctrl+Z 로 되돌리기`);
  return ids;
 }
 async function draw(v,shared){
  const previewOf=(points,cursor)=>{
   const pts=cursor?[...points,cursor]:points;if(pts.length<2)return [];
   try{
    if(pts.length===2){const f=wallFrame(pts[0],pts[1],G.add(pts[0],G.normal(G.unit(G.sub(pts[1],pts[0])))));const end=v.offset+v.width+2*(v.frameWidth+v.gap);return [{type:'line',points:[toWorld(f,v.offset,0),toWorld(f,end,0)],previewColor:'#f4d35e'},{type:'line',points:[toWorld(f,v.offset,-60),toWorld(f,v.offset,60)]},{type:'line',points:[toWorld(f,end,-60),toWorld(f,end,60)]}];}
    const f=wallFrame(pts[0],pts[1],pts[2]);const door=buildDoor(f,v,shared);return door.entities.map(e=>({...e,previewColor:'#f4d35e'}));
   }catch{return [];}
  };
  const pts=(await ctx.pickPath({prompt:`문 [${v.name}] 폭 ${v.width} · ① 힌지 쪽 벽선 위 점 ② 같은 벽선에서 문이 열리는 쪽 방향 점 ③ 반대쪽 벽선 위 점(그쪽으로 열림) · Esc 중단`,preview:previewOf,minPoints:3,maxPoints:3}))?.points;
  if(!pts)return null;
  const f=snapWallFrame(ctx.entities(),pts[0],pts[1],pts[2],ctx.tolerance(),{layers:ctx.layers()});
  return place(v,shared,f);
 }
 const persist=(state,select,v)=>{state.presets[select]=v;try{ctx.storage.setItem(DOOR_STORAGE_KEY,JSON.stringify({presets:state.presets,shared:state.shared,selected:select}));}catch{}};
 /** 명령행 순서: 종류 → 두 점(힌지 쪽 벽 끝, 반대쪽 벽) → 폭 → 벽 끝에서 거리 → 마감 두께. 입력마다 저장해 다음 실행의 기본값이 된다. */
 function runSequence(name,select,state){
  const preset=state.presets[select],settings=()=>open(name,{forceDialog:true});
  // 명령행처럼 글자 하나 + Enter 로 넘어가도록 글 입력칸(선택 목록은 Enter 로 제출되지 않는다)을 쓰고 열리자마자 초점을 준다.
  ctx.form(`${preset.name} · 문 종류`,[{name:'doorType',label:'문 종류 [여닫이(W) / 양개(D) / 편개(P) / 철제(S)]',type:'text',value:DOOR_TYPE_LETTERS[preset.doorType]||'W'}],async values=>{
   const doorType=parseDoorTypeOption(values?.doorType,preset.doorType);
   if(!doorType)throw Error('문 종류는 W(여닫이)·D(양개)·P(편개)·S(철제) 중 하나를 입력하세요.');
   let v=normalizeValues(DOOR_FIELDS,{...preset,doorType},preset.name);
   const previewOf=(points,cursor)=>{
    const pts=cursor?[...points,cursor]:points;if(pts.length<2)return [];
    try{const f=wallEndFrame(ctx.entities(),pts[0],pts[1],ctx.tolerance(),{layers:ctx.layers()});return buildDoor(f,v,state.shared).entities.map(e=>({...e,previewColor:'#f4d35e'}));}catch{return [];}
   };
   const pts=(await ctx.pickPath({prompt:`문 [${v.name}] ${DOOR_TYPE_OPTIONS.find(([k])=>k===v.doorType)[1]} · ① 힌지 쪽 벽선의 끝 ② 반대쪽 벽선 위 점(그쪽으로 열림) · Esc 중단`,preview:previewOf,minPoints:2,maxPoints:2}))?.points;
   if(!pts)return;
   const f=wallEndFrame(ctx.entities(),pts[0],pts[1],ctx.tolerance(),{layers:ctx.layers()});
   ctx.askNumber({title:`${v.name} · 문 폭`,label:'문 폭 (mm) · Enter 로 진행',value:v.width,min:100,settings},width=>{
    v=normalizeValues(DOOR_FIELDS,{...v,width},v.name);
    ctx.askNumber({title:`${v.name} · 벽 거리`,label:'벽 끝에서 개구부까지 거리 (mm)',value:v.offset,allowZero:true,settings},offset=>{
     v=normalizeValues(DOOR_FIELDS,{...v,offset},v.name);
     ctx.askNumber({title:`${v.name} · 마감 두께`,label:`마감 두께 (mm, 벽 한쪽 면 · 0~${DOOR_FINISH_MAX})`,value:v.finishThickness,allowZero:true,max:DOOR_FINISH_MAX,settings},finishThickness=>{
      if(!(finishThickness>=0&&finishThickness<=DOOR_FINISH_MAX))throw Error(`마감 두께는 0~${DOOR_FINISH_MAX} mm 사이여야 합니다.`);
      v=normalizeValues(DOOR_FIELDS,{...v,finishThickness},v.name);
      validateDoorValues(v);
      persist(state,select,v);
      return place(v,state.shared,f);
     });
    });
   });
  });
  focusFormField();
 }
 function open(name,{forceDialog=false}={}){
  const select=slotOf(name);
  const state=loadCardState(ctx.storage,DOOR_STORAGE_KEY,{fields:DOOR_FIELDS,sharedFields:DOOR_SHARED_FIELDS,slots:DOOR_SLOTS,fixedNames:DOOR_FIXED_NAMES,slotDefaults:doorSlotDefaults});
  const preset=state.presets[select];
  if(!forceDialog&&preset.runMode==='command'){
   ctx.askNumber({title:`${preset.name} · 문 폭`,label:'문 폭 (mm) · Enter 로 진행',value:preset.width,settings:()=>open(name,{forceDialog:true})},async width=>{
    const v=normalizeValues(DOOR_FIELDS,{...preset,width},preset.name);state.presets[select]=v;
    try{ctx.storage.setItem(DOOR_STORAGE_KEY,JSON.stringify({presets:state.presets,shared:state.shared,selected:select}));}catch{}
    await draw(v,state.shared);
   });
   return;
  }
  if(!forceDialog&&preset.runMode==='sequence'){runSequence(name,select,state);return;}
  openCardDialog({ctx,title:`문 그리기 · ${name} (D1 간단문 · D2/D3 상세문)`,storageKey:DOOR_STORAGE_KEY,fields:DOOR_FIELDS,sharedFields:DOOR_SHARED_FIELDS,slots:DOOR_SLOTS,fixedNames:DOOR_FIXED_NAMES,slotDefaults:doorSlotDefaults,select,
   preview:(v,shared,o)=>doorPreviewSvg(v,shared,o),
   validate:v=>validateDoorValues(v),
   onGo:(v,shared)=>draw(v,shared),
   note:'세 점 순서: ① 힌지 위치(벽선 위) → ② 같은 벽선 위, 문이 열리는 쪽 방향 → ③ 반대쪽 벽선(그쪽으로 열림). 벽선은 자동으로 잘리고, 중심선은 남습니다. 문 종류: 여닫이·양개·편개·철제(S). 마감 두께를 넣으면 문틀이 벽 양면 마감면까지 맞춰집니다.'});
 }
 return {D1:()=>open('D1'),D2:()=>open('D2'),D3:()=>open('D3')};
}
