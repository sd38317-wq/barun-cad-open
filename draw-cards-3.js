import {standardLayerForName} from './layer-standards.js';
// 3차 병렬 작업 그리기 카드 다섯. 원문의 설정 대화상자 그림과 명령창 프롬프트를 그대로 옮겼다.
//  STB 철골보 평면 그리기(xiSTB)        — izzarder.com/239
//  DOR 평면문 회전(xiDoorRotate)        — izzarder.com/105
//  CEN 중심선 그리기(xiCenter)          — izzarder.com/201
//  CEP 폴리선 중심그리기(xiCenterPoly)  — izzarder.com/202
//  ELV 엘리베이터 그리기                — izzarder.com 에 원문 글이 없다(그리기 도움말 35편 전수 확인). 카탈로그 한 줄 설명으로 추정 구현.
import * as G from './geometry.js';
import {entitiesSvg,openCardDialog,resolveLayers,readableAngle} from './card-kit.js';

/* 규칙서 6절 표준 켜. 원문 켜 이름(A-BEAM 자리의 "기호켜", CEN, 0 …)을 바른 CAD 표준 이름으로 옮긴다. */
export const DRAW3_LAYERS=Object.freeze({beam:'A-BEAM',text:'A-TEXT',door:'A-DOOR',wallCntr:'A-WALL-C',cntr:'A-CNTR',elev:'A-ELEV'});
export const DRAW3_COLORS=Object.freeze(Object.fromEntries(["A-BEAM","A-TEXT","A-DOOR","A-WALL-C","A-CNTR","A-ELEV","A-WALL"].map(name=>[name,standardLayerForName(name).color])));
const colorOf=name=>DRAW3_COLORS[name];
const num=(v,d=0)=>{const n=Number(v);return Number.isFinite(n)?n:d;};
const P=(x,y)=>({x,y});
const clonePts=ps=>ps.map(p=>({x:p.x,y:p.y}));
const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
/** 결과를 선으로 낼지 폴리선으로 낼지(CEN 원문 [폴리선으로 생성]) */
const seg2ent=(a,b,layerName,asPoly,linetype='CENTER')=>asPoly
 ?{type:'polyline',closed:false,points:[P(a.x,a.y),P(b.x,b.y)],cardLayer:layerName,linetype}
 :{type:'line',points:[P(a.x,a.y),P(b.x,b.y)],cardLayer:layerName,linetype};

/* ══════════════════════════════════════════════════════════════════════
   STB — 철골보 평면 그리기 (izzarder.com/239)
   원문 대화상자 "철골보 평면그리기": 기호켜 / 문자켜 / 형태(평면·구조기호) / 이격거리 1.0×선축척 /
   철골보폭 400 · 웨브선 HIDDEN · 웨브두께 6(형태=평면일 때만 활성) / 부호 SG+1 · [v]대문자 /
   머리크기 4×선축척 / 머리접합(강접합·핀접합) · 꼬리접합(강접합·핀접합) / 선 두께 1×선축척 /
   문자크기 3×선축척 / [ ]입력 후 재 순환.  조작: 두 점(머리→꼬리) 지정.
   ══════════════════════════════════════════════════════════════════════ */
export const STB_STORAGE_KEY='barun-stb-card';

/** 대화상자 값 → mm 치수. "× 선축척" 항목은 모두 선축척을 곱한다. */
export function stbSizes(v){
 const ls=num(v.lineScale,100);
 if(!(ls>0))throw Error('선축척은 0보다 큰 수여야 합니다.');
 const s={ls,gap:num(v.gap,1)*ls,head:num(v.headSize,4)*ls,lineWidth:num(v.lineWidth,1)*ls,
  textHeight:num(v.textHeight,3)*ls,beamWidth:num(v.beamWidth,400),webThick:num(v.webThick,6)};
 if(!(s.head>0))throw Error('머리크기는 0보다 커야 합니다.');
 if(v.shape==='plan'){
  if(!(s.beamWidth>0))throw Error('철골보폭은 0보다 커야 합니다.');
  if(s.webThick<0)throw Error('웨브두께는 0 이상이어야 합니다(0 이면 한 선).');
  if(s.webThick>=s.beamWidth)throw Error(`웨브두께(${s.webThick})는 철골보폭(${s.beamWidth})보다 작아야 합니다.`);
 }else if(!(s.textHeight>0))throw Error('문자크기는 0보다 커야 합니다.');
 return s;
}
/** 원문 [부호] = 접두 문자 + 숫자, [대문자] 체크면 대문자로 바꿔 넣는다. */
export function stbMark(v){
 const s=`${String(v.markPrefix??'').trim()}${String(v.markNumber??'').trim()}`;
 return v.upper?s.toUpperCase():s;
}
/** 원문 [머리접합]·[꼬리접합]. 강접합(모멘트접합)=속 채운 삼각형, 핀접합=보에 직각인 짧은 선.
 *  원문 예시 그림에서 삼각형의 밑변(보에 직각)이 머리크기, 보 방향 길이는 그 1/3 이다. */
export function stbJoint(kind,at,uIn,n,head,layerName){
 const half=head/2,depth=head/3;
 const base1=G.add(at,G.mul(n,half)),base2=G.add(at,G.mul(n,-half));
 if(kind!=='rigid')return [{type:'line',points:[base1,base2],cardLayer:layerName}];
 const tri=[base1,base2,G.add(at,G.mul(uIn,depth))];
 return [
  {type:'polyline',closed:true,points:clonePts(tri),cardLayer:layerName},
  {type:'hatch',points:clonePts(tri),loops:[],pattern:'solid',solid:true,spacing:100,hatchScale:1,angle:0,cardLayer:layerName},
 ];
}
/** 두 점 사이 철골보 하나. 켜는 이름(cardLayer)으로만 적고 실제 id 는 커밋할 때 바꾼다. */
export function stbGeometry(v,shared={},p1={x:0,y:0},p2={x:6000,y:0}){
 const s=stbSizes(v),L=G.dist(p1,p2);
 if(!(L>G.EPS))throw Error('두 점은 서로 다른 점이어야 합니다.');
 const u=G.unit(G.sub(p2,p1)),n=G.normal(u),out=[];
 const symLayer=shared.symbolLayer||DRAW3_LAYERS.beam,txtLayer=shared.textLayer||DRAW3_LAYERS.text;
 if(v.shape==='plan'){
  const hw=s.beamWidth/2;
  out.push({type:'polyline',closed:true,cardLayer:symLayer,
   points:[G.add(p1,G.mul(n,hw)),G.add(p2,G.mul(n,hw)),G.add(p2,G.mul(n,-hw)),G.add(p1,G.mul(n,-hw))]});
  const lt=String(v.webLinetype||'HIDDEN').toUpperCase();
  for(const d of (s.webThick>0?[s.webThick/2,-s.webThick/2]:[0]))
   out.push({type:'line',cardLayer:symLayer,linetype:lt,points:[G.add(p1,G.mul(n,d)),G.add(p2,G.mul(n,d))]});
 }else{
  out.push({type:'polyline',closed:false,cardLayer:symLayer,points:[P(p1.x,p1.y),P(p2.x,p2.y)],
   ...(s.lineWidth>0?{constantWidth:s.lineWidth}:{})});
  out.push(...stbJoint(v.headJoint,p1,u,n,s.head,symLayer));
  out.push(...stbJoint(v.tailJoint,p2,G.mul(u,-1),n,s.head,symLayer));
  const mark=stbMark(v);
  if(mark)out.push({type:'text',cardLayer:txtLayer,text:mark,height:s.textHeight,align:'center',
   rotation:readableAngle(G.angle(u)),position:G.add(mid(p1,p2),G.mul(n,s.gap+s.lineWidth/2))});
 }
 return {entities:out,length:L,angle:G.angle(u)};
}
export const stbSummary=v=>(v.shape==='plan'
 ?`평면 · 보폭 ${num(v.beamWidth,400)} · 웨브 ${num(v.webThick,6)||'한 선'}`
 :`구조기호 · ${stbMark(v)||'(부호 없음)'} · 머리 ${v.headJoint==='rigid'?'강접합':'핀접합'} / 꼬리 ${v.tailJoint==='rigid'?'강접합':'핀접합'}`);

export const STB_FIELDS=[
 {key:'shape',label:'형태',type:'select',def:'symbol',options:[['plan','평면'],['symbol','구조기호']],group:'형태'},
 {key:'gap',label:'이격거리',type:'number',def:1,min:0,step:.1,group:'형태',hint:'보에서 기호문자까지 · × 선축척',when:v=>v.shape!=='plan'},
 {key:'beamWidth',label:'철골보폭 (mm)',type:'number',def:400,min:1,step:10,group:'평면',when:v=>v.shape==='plan'},
 {key:'webLinetype',label:'웨브선',type:'select',def:'HIDDEN',options:[['HIDDEN','HIDDEN'],['DASHED','DASHED'],['CENTER','CENTER'],['CONTINUOUS','CONTINUOUS']],group:'평면',when:v=>v.shape==='plan'},
 {key:'webThick',label:'웨브두께 (mm)',type:'number',def:6,min:0,step:1,group:'평면',when:v=>v.shape==='plan',hint:'0 이면 한 선, 숫자면 그 폭의 두 선'},
 {key:'markPrefix',label:'부호',type:'text',def:'SG',group:'부호',when:v=>v.shape!=='plan'},
 {key:'markNumber',label:'번호',type:'text',def:'1',group:'부호',when:v=>v.shape!=='plan'},
 {key:'upper',label:'대문자',type:'check',def:true,group:'부호',when:v=>v.shape!=='plan',hint:'구조 부호를 항상 대문자로 바꿔 넣습니다'},
 {key:'headJoint',label:'머리접합',type:'select',def:'rigid',options:[['rigid','강접합 (모멘트접합)'],['pin','핀접합']],group:'접합방식',when:v=>v.shape!=='plan'},
 {key:'tailJoint',label:'꼬리접합',type:'select',def:'rigid',options:[['rigid','강접합 (모멘트접합)'],['pin','핀접합']],group:'접합방식',when:v=>v.shape!=='plan'},
 {key:'headSize',label:'머리크기',type:'number',def:4,min:.1,step:.5,group:'접합방식',when:v=>v.shape!=='plan',hint:'× 선축척'},
 {key:'lineWidth',label:'선 두께',type:'number',def:1,min:0,step:.5,group:'크기',when:v=>v.shape!=='plan',hint:'× 선축척 · 0 이면 두께 없는 선'},
 {key:'textHeight',label:'문자크기',type:'number',def:3,min:.1,step:.5,group:'크기',when:v=>v.shape!=='plan',hint:'× 선축척'},
 {key:'lineScale',label:'선축척',type:'number',def:100,min:.01,step:1,group:'크기',hint:'카드 문맥이 도면 선축척을 읽지 못해 직접 적습니다(1:100 이면 100).'},
 {key:'recycle',label:'입력 후 재 순환',type:'check',def:false,group:'실행',hint:'켜면 대화상자 없이 이어서 그리고 부호만 다시 묻습니다'},
];
export const STB_SHARED_FIELDS=[
 {key:'symbolLayer',label:'기호켜',type:'layer',def:DRAW3_LAYERS.beam,group:'켜'},
 {key:'textLayer',label:'문자켜',type:'layer',def:DRAW3_LAYERS.text,group:'켜'},
];
export const stbSlotDefaults=i=>[
 {name:'구조기호 SG1 강접합',shape:'symbol',headJoint:'rigid',tailJoint:'rigid'},
 {name:'구조기호 SG1 핀접합',shape:'symbol',headJoint:'pin',tailJoint:'pin'},
 {name:'평면 보폭 400',shape:'plan'},
][i]||{};
export function stbPreviewSvg(v,shared,opts={}){
 const L=Math.max(3000,num(v.lineScale,100)*num(v.headSize,4)*8);
 const es=stbGeometry(v,shared,P(0,0),P(L,0)).entities;
 return entitiesSvg(es,{label:opts.compact?'':`두 점 사이 · ${stbSummary(v)}`,colorOf:e=>colorOf(e.cardLayer),...opts});
}

/* ══════════════════════════════════════════════════════════════════════
   DOR — 평면문 회전 (izzarder.com/105)
   원문 대화상자 "문 회전" 설정: 기본 각도 30 / [ ]양개문 동시 선택 / 복사후 켜 / 궤적선 켜 /
   [궤적선종류] Continuous / [v]입력 후 재 순환.
   원문 명령창: ">> 설정(S)/ 양개문(D)/ 문 선택:" → ">> 회전 기준점 지정:" → ">> 회전 방향 지정:"
                → ">> 회전 각도입력<30.0>:" (양개문이면 문 선택이 "첫번째 문 선택"·"두번째 문 선택" 둘로 나뉜다)
   원문 GIF 에서 원본 문은 그대로 남고 회전한 사본이 더해진다(대화상자 항목 이름도 "복사후 켜").
   ══════════════════════════════════════════════════════════════════════ */
export const DOR_STORAGE_KEY='barun-dor-card';

export function entityPoints(list){return list.flatMap(e=>{try{return G.vertices(e)||[];}catch{return e.points||[];}});}
/** 힌지에서 가장 먼 점 = 문짝 끝. 궤적 호의 반지름·시작각을 여기서 얻는다. */
export function farthestFrom(list,base){
 let best=null,bd=-1;
 for(const p of entityPoints(list)){const d=G.dist(p,base);if(d>bd){bd=d;best=p;}}
 if(!best)throw Error('선택한 문에서 점을 찾을 수 없습니다. 선·폴리선·호로 그린 문을 고르세요.');
 return {point:{x:best.x,y:best.y},distance:bd};
}
/** 양개문에서 둘째 문의 힌지 = 첫째 힌지에서 가장 먼 제 끝점(원문 그림처럼 바깥쪽 끝). */
export const secondHinge=(list,firstHinge)=>farthestFrom(list,firstHinge).point;
/** 원문 ">> 회전 방향 지정:" — 찍은 점이 문짝의 어느 쪽인지로 돌아갈 방향(+1 반시계 / −1 시계)을 정한다. */
export function rotationSign(list,hinge,dirPoint){
 const far=farthestFrom(list,hinge).point,a=G.sub(far,hinge),b=G.sub(dirPoint,hinge);
 if(G.len(b)<G.EPS||G.len(a)<G.EPS)return 1;
 return G.cross(a,b)<0?-1:1;
}
/** 회전한 사본 + 궤적 호. groups[i] 의 문을 hinges[i] 기준으로 돌린다(양개문은 둘째가 반대 방향). */
export function doorRotationResult(v,shared={},groups=[],hinges=[],sign=1){
 const angle=num(v.angle,30);
 if(!(angle>0))throw Error('기본 각도는 0보다 커야 합니다.');
 if(angle>360)throw Error('기본 각도는 360 이하여야 합니다.');
 const doorLayer=shared.doorLayer||DRAW3_LAYERS.door,arcLayer=shared.arcLayer||DRAW3_LAYERS.door;
 const lt=String(v.arcLinetype||'CONTINUOUS').toUpperCase(),out=[];
 groups.forEach((list,i)=>{
  if(!list?.length)return;
  const hinge=hinges[i],deg=(i===0?sign:-sign)*angle;
  for(const e of list){
   const r=G.rotate(e,hinge,deg);
   delete r.id;delete r.layer;delete r.hostWall;
   out.push({...r,cardLayer:doorLayer});
  }
  const far=farthestFrom(list,hinge);
  if(far.distance>G.EPS){
   const a0=G.normalizeAngle(G.angle(G.sub(far.point,hinge))),a1=G.normalizeAngle(a0+deg);
   out.push({type:'arc',center:P(hinge.x,hinge.y),radius:far.distance,
    startAngle:deg>0?a0:a1,endAngle:deg>0?a1:a0,cardLayer:arcLayer,linetype:lt});
  }
 });
 if(!out.length)throw Error('회전할 문 객체가 없습니다.');
 return out;
}
export const DOR_FIELDS=[
 {key:'angle',label:'기본 각도 (도)',type:'number',def:30,min:.1,max:360,step:5,group:'설정'},
 {key:'doubleDoor',label:'양개문 동시 선택',type:'check',def:false,group:'설정',hint:'원문 명령창의 (D) 옵션과 같은 뜻 · 켜면 문 두 짝을 서로 반대로 돌립니다'},
 {key:'arcLinetype',label:'궤적선종류',type:'select',def:'CONTINUOUS',options:[['CONTINUOUS','Continuous'],['DASHED','DASHED'],['CENTER','CENTER'],['HIDDEN','HIDDEN'],['DOT','DOT']],group:'설정'},
 {key:'recycle',label:'입력 후 재 순환',type:'check',def:true,group:'설정',hint:'켜면 한 번 돌린 뒤 이어서 다음 문을 계속 돌립니다'},
];
export const DOR_SHARED_FIELDS=[
 {key:'doorLayer',label:'복사후 켜',type:'layer',def:DRAW3_LAYERS.door,group:'켜'},
 {key:'arcLayer',label:'궤적선 켜',type:'layer',def:DRAW3_LAYERS.door,group:'켜'},
];
export const dorSlotDefaults=i=>[
 {name:'홑문 30도',angle:30,doubleDoor:false},
 {name:'양개문 30도',angle:30,doubleDoor:true},
 {name:'홑문 45도',angle:45,doubleDoor:false},
][i]||{};
/** 미리보기: 900 짜리 문짝 하나(양개문이면 둘)를 가상으로 두고 회전 결과를 보여준다. */
export function dorPreviewSvg(v,shared,opts={}){
 const W=900,leaf=h=>[{type:'polyline',closed:true,cardLayer:'A-WALL',
  points:[P(h,0),P(h+W,0),P(h+W,40),P(h,40)]}];
 const base=v.doubleDoor?[leaf(0),leaf(W+200).map(e=>({...e}))]:[leaf(0)];
 const hinges=v.doubleDoor?[P(2*W+200,0),P(0,0)]:[P(0,0)];
 const groups=v.doubleDoor?[base[1],base[0]]:[base[0]];
 let rotated=[];
 try{rotated=doorRotationResult(v,shared,groups,hinges,-1);}catch{rotated=[];}
 return entitiesSvg([...base.flat(),...rotated],
  {label:opts.compact?'':`${v.doubleDoor?'양개문':'홑문'} · ${num(v.angle,30)}도 · 원본은 남고 사본이 돌아갑니다`,colorOf:e=>colorOf(e.cardLayer),...opts});
}

/* ══════════════════════════════════════════════════════════════════════
   CEN — 중심선 그리기 (izzarder.com/201)
   원문 대화상자 "중심선 그리기" 설정: [ ]폴리선으로 생성 / 연장 길이 15×선축척 / 켜 CEN /
   여러선 선택시 최대 인식 거리 250.0.
   원문 명령창: ">> 설정(S)/ 여러선 동시 입력(M)/ 선, 폴리선, 호, 원을 선택:"
   원문 그림에서 확인한 결과(모두 CENTER 선종류의 붉은 선):
    · 선 하나  → 그 선의 중점에서 선에 직각인 중심선(양쪽으로 연장길이)
    · 선 둘    → 두 선 사이 중심선(각도가 다르면 교점을 지나는 이등분선), 두 선의 범위 + 연장길이
    · 호·원    → 중심점에 축에 나란한 십자(반지름 + 연장길이)
    · 문자·치수·지시선 → 그 객체를 대표 선분으로 바꿔 위와 같은 규칙을 적용
   ══════════════════════════════════════════════════════════════════════ */
export const CEN_STORAGE_KEY='barun-cen-card';

export const isRound=e=>!!e&&(e.type==='circle'||e.type==='arc')&&e.center&&num(e.radius)>0;
/** 문자의 대표 선분(정렬·폭계수까지 geometry.js vertices 와 같은 계산). */
export function textSegment(e){
 const h=num(e.height,100),rot=num(e.rotation,0);
 const w=Math.max(...String(e.text??'').split('\n').map(s=>s.length),1)*h*.65*num(e.widthFactor,1);
 const off=e.align==='center'?-w/2:e.align==='right'?-w:0;
 const a=G.add(e.position,G.polar(off,rot));
 return [a,G.add(a,G.polar(w,rot))];
}
/** 객체 → 직선 선분 목록. 폴리선·사각형은 구간 전부, 문자·치수는 대표 선분 하나. */
export function entitySegments(e){
 if(!e)return [];
 if(e.type==='line'&&e.points?.length>=2)return [[e.points[0],e.points[1]]];
 if((e.type==='polyline'||e.type==='rectangle')&&e.points?.length>=2)return G.segments(e).filter(([a,b])=>G.dist(a,b)>G.EPS).map(([a,b])=>[a,b]);
 if(e.type==='text'&&e.position)return [textSegment(e)];
 if(e.points?.length>=2)return [[e.points[0],e.points.at(-1)]];
 return [];
}
export function longestSegment(segs){
 let best=null,bd=-1;
 for(const s of segs){const d=G.dist(s[0],s[1]);if(d>bd){bd=d;best=s;}}
 if(!best)throw Error('중심선을 만들 선분이 없습니다.');
 return best;
}
/** 선 하나 → 중점에서 직각인 중심선 */
export function midMark(seg,ext){
 const u=G.unit(G.sub(seg[1],seg[0])),n=G.normal(u),m=mid(seg[0],seg[1]);
 return [G.add(m,G.mul(n,ext)),G.add(m,G.mul(n,-ext))];
}
/** 호·원 → 중심점 십자(가로·세로 각각 반지름+연장길이) */
export function crossMark(center,radius,ext){
 const r=num(radius,0)+ext;
 return [[P(center.x-r,center.y),P(center.x+r,center.y)],[P(center.x,center.y-r),P(center.x,center.y+r)]];
}
/** 선 둘 → 중심선. 평행하면 두 중점의 가운데를, 각도가 다르면 교점을 지나는 이등분선을 쓴다. */
export function centerlineOfTwo(s1,s2,ext){
 const u1=G.unit(G.sub(s1[1],s1[0]));
 let u2=G.unit(G.sub(s2[1],s2[0]));
 if(G.dot(u1,u2)<0)u2=G.mul(u2,-1);
 const parallel=Math.abs(G.cross(u1,u2))<1e-9;
 let u=G.add(u1,u2);
 u=G.len(u)<G.EPS?G.normal(u1):G.unit(u);
 let anchor=mid(mid(s1[0],s1[1]),mid(s2[0],s2[1]));
 if(!parallel){
  const x=G.lineIntersection(s1[0],s1[1],s2[0],s2[1]);
  if(x)anchor=x.point;
 }
 const ts=[...s1,...s2].map(p=>G.dot(G.sub(p,anchor),u));
 const lo=Math.min(...ts)-ext,hi=Math.max(...ts)+ext;
 return [G.add(anchor,G.mul(u,lo)),G.add(anchor,G.mul(u,hi))];
}
/** 두 객체에서 서로 가장 잘 마주 보는 선분 한 쌍을 고른다(폴리선·사각형끼리도 된다). */
export function bestSegmentPair(segsA,segsB){
 let best=null,bs=Infinity;
 for(const a of segsA)for(const b of segsB){
  let ua,ub;
  try{ua=G.unit(G.sub(a[1],a[0]));ub=G.unit(G.sub(b[1],b[0]));}catch{continue;}
  const sin=Math.abs(G.cross(ua,ub)),d=G.dist(mid(a[0],a[1]),mid(b[0],b[1]));
  const score=d*(1+9*sin);
  if(score<bs){bs=score;best=[a,b];}
 }
 if(!best)throw Error('중심선을 만들 선분 쌍을 찾지 못했습니다.');
 return best;
}
/** 여러선 동시 입력(M) 에서 쓰는 평행 쌍 판정. 평행하고 겹치며 거리가 maxDist 이내면 한 쌍. */
export function pairDistance(s1,s2,angleTol=1){
 let u1,u2;
 try{u1=G.unit(G.sub(s1[1],s1[0]));u2=G.unit(G.sub(s2[1],s2[0]));}catch{return null;}
 if(Math.abs(G.cross(u1,u2))>Math.sin(angleTol*Math.PI/180))return null;
 const n=G.normal(u1),d=Math.abs(G.dot(G.sub(s2[0],s1[0]),n));
 const L=G.dist(s1[0],s1[1]),t=p=>G.dot(G.sub(p,s1[0]),u1);
 const t0=Math.min(t(s2[0]),t(s2[1])),t1=Math.max(t(s2[0]),t(s2[1]));
 if(t1<0||t0>L)return null;
 return d;
}
export function parallelPairs(segs,maxDist,angleTol=1){
 const cand=[];
 for(let i=0;i<segs.length;i++)for(let j=i+1;j<segs.length;j++){
  const d=pairDistance(segs[i],segs[j],angleTol);
  if(d!=null&&d>1e-6&&d<=maxDist)cand.push({i,j,d});
 }
 cand.sort((a,b)=>a.d-b.d||a.i-b.i||a.j-b.j);
 const used=new Set(),out=[];
 for(const c of cand){
  if(used.has(c.i)||used.has(c.j))continue;
  used.add(c.i);used.add(c.j);out.push([segs[c.i],segs[c.j]]);
 }
 return out;
}
/** 선택한 객체들 → 중심선 객체들. */
export function cenGeometry(v,shared={},picked=[]){
 const ls=num(v.lineScale,100);
 if(!(ls>0))throw Error('선축척은 0보다 큰 수여야 합니다.');
 const ext=num(v.extend,15)*ls,layer=shared.layer||DRAW3_LAYERS.wallCntr,poly=!!v.asPolyline;
 const list=(picked||[]).filter(Boolean);
 if(!list.length)throw Error('중심선을 넣을 객체를 고르세요.');
 const out=[],push=s=>out.push(seg2ent(s[0],s[1],layer,poly));
 const round=list.filter(isRound),flat=list.filter(e=>!isRound(e));
 if(v.multi){
  const segs=flat.flatMap(entitySegments);
  for(const [a,b] of parallelPairs(segs,num(v.maxPair,250)))push(centerlineOfTwo(a,b,ext));
  for(const c of round)for(const s of crossMark(c.center,c.radius,ext))push(s);
  if(!out.length)throw Error(`최대 인식 거리 ${num(v.maxPair,250)} 안에서 평행한 선 쌍을 찾지 못했습니다. 거리를 늘리거나 두 선만 골라 보세요.`);
  return out;
 }
 for(const c of round)for(const s of crossMark(c.center,c.radius,ext))push(s);
 if(flat.length>=2)push(centerlineOfTwo(...bestSegmentPair(entitySegments(flat[0]),entitySegments(flat[1])),ext));
 else if(flat.length===1)push(midMark(longestSegment(entitySegments(flat[0])),ext));
 if(!out.length)throw Error('선·폴리선·호·원·문자·치수만 중심선을 만들 수 있습니다.');
 return out;
}
export const CEN_FIELDS=[
 {key:'asPolyline',label:'폴리선으로 생성',type:'check',def:false,group:'설정',hint:'끄면 선, 켜면 폴리선으로 만듭니다'},
 {key:'extend',label:'연장 길이',type:'number',def:15,min:0,step:1,group:'설정',hint:'× 선축척 · 중심선이 객체에서 더 뻗는 길이'},
 {key:'lineScale',label:'선축척',type:'number',def:100,min:.01,step:1,group:'설정',hint:'카드 문맥이 도면 선축척을 읽지 못해 직접 적습니다(원문은 15 × 선축척 = 1500).'},
 {key:'maxPair',label:'여러선 선택시 최대 인식 거리 (mm)',type:'number',def:250,min:1,step:10,group:'설정',hint:'벽 두께가 200 이면 250 쯤 · 이 거리 안의 평행선 쌍마다 중심선'},
 {key:'multi',label:'여러선 동시 입력 (M)',type:'check',def:false,group:'실행',hint:'원문 명령창의 (M) 옵션 · 선택한 여러 선에서 평행 쌍을 자동으로 찾습니다'},
];
export const CEN_SHARED_FIELDS=[{key:'layer',label:'켜',type:'layer',def:DRAW3_LAYERS.wallCntr,group:'켜'}];
export const cenSlotDefaults=i=>[
 {name:'벽선 한 쌍 (200 벽)',multi:false,maxPair:250},
 {name:'여러 벽선 동시 (M)',multi:true,maxPair:250},
][i]||{};
export function cenPreviewSvg(v,shared,opts={}){
 const t=200,L=3000;
 const walls=[{type:'line',points:[P(0,0),P(L,0)],cardLayer:'A-WALL'},{type:'line',points:[P(0,t),P(L,t)],cardLayer:'A-WALL'}];
 let res=[];
 try{res=cenGeometry({...v,multi:false},shared,walls);}catch{res=[];}
 return entitiesSvg([...walls,...res],
  {label:opts.compact?'':`벽선 두 줄 → 중심선 · 연장 ${num(v.extend,15)*num(v.lineScale,100)}`,colorOf:e=>colorOf(e.cardLayer),...opts});
}

/* ══════════════════════════════════════════════════════════════════════
   CEP — 폴리선 중심그리기 (izzarder.com/202)
   원문 대화상자 "폴리선 간의 중심선 그리기" 설정: 켜 /
   (o)중심선 생성 ( )중심선 임의 등분 ( )등고선 2등분 ( )등고선 임의 등분 /
   연장길이 5×선축척 · 나눔 5 · 정점 수 100 / [ ]입력 후 재 순환.
   열린 두 폴리선 → 중심선(정점 수는 많은 쪽을 따라감), 닫힌 폴리선 하나 → 무게중심 십자(돌출=연장길이).
   ══════════════════════════════════════════════════════════════════════ */
export const CEP_STORAGE_KEY='barun-cep-card';
export const CEP_MODES=Object.freeze({center:'중심선 생성',centerDiv:'중심선 임의 등분',contour2:'등고선 2등분',contourDiv:'등고선 임의 등분'});

export function pathOf(e){
 if(!e||!['line','polyline','rectangle'].includes(e.type)||!Array.isArray(e.points)||e.points.length<2)
  throw Error('CEP 는 선·폴리선·사각형만 다룹니다.');
 return {points:clonePts(e.points),closed:e.type==='rectangle'||!!e.closed};
}
function pointAtLength(pts,acc,target){
 let i=1;
 while(i<acc.length-1&&acc[i]<target)i++;
 const d0=acc[i-1],d1=acc[i],t=d1-d0<G.EPS?0:(target-d0)/(d1-d0);
 return G.add(pts[i-1],G.mul(G.sub(pts[i],pts[i-1]),t));
}
/** 길이를 따라 정점 n 개로 다시 나눈다(닫힌 것은 한 바퀴를 n 등분). */
export function resamplePath(points,closed,n){
 const count=Math.max(2,Math.round(num(n,2)));
 const pts=closed?[...clonePts(points),{x:points[0].x,y:points[0].y}]:clonePts(points);
 const acc=[0];let total=0;
 for(let i=1;i<pts.length;i++){total+=G.dist(pts[i-1],pts[i]);acc.push(total);}
 if(!(total>G.EPS))throw Error('길이가 0 인 폴리선은 다시 나눌 수 없습니다.');
 const out=[];
 for(let k=0;k<count;k++)out.push(pointAtLength(pts,acc,total*(closed?k/count:k/(count-1))));
 return out;
}
/** 둘째 폴리선이 거꾸로 그려져 있으면 뒤집어 맞춘다(안 그러면 중심선이 X 자로 꼬인다). */
export function alignPath(a,b){
 const rb=[...b].reverse();
 const f=a.reduce((s,p,i)=>s+G.dist(p,b[i]),0),r=a.reduce((s,p,i)=>s+G.dist(p,rb[i]),0);
 return r<f?rb:b;
}
export const blendPaths=(a,b,t)=>a.map((p,i)=>({x:p.x+(b[i].x-p.x)*t,y:p.y+(b[i].y-p.y)*t}));
/** 닫힌 폴리선의 무게중심(면적 가중). 면적이 0 이면 정점 평균. */
export function polygonCentroid(points){
 let a=0,cx=0,cy=0;
 for(let i=0;i<points.length;i++){
  const p=points[i],q=points[(i+1)%points.length],f=p.x*q.y-q.x*p.y;
  a+=f;cx+=(p.x+q.x)*f;cy+=(p.y+q.y)*f;
 }
 if(Math.abs(a)<G.EPS){
  const n=points.length||1;
  return {x:points.reduce((s,p)=>s+p.x,0)/n,y:points.reduce((s,p)=>s+p.y,0)/n};
 }
 return {x:cx/(3*a),y:cy/(3*a)};
}
/** 모드마다 만들 중간선의 위치 비율. 중심선=0.5 한 줄, 임의 등분=나눔 등분한 안쪽 줄들. */
export function cepRatios(mode,divide){
 if(mode==='center'||mode==='contour2')return [.5];
 const d=Math.max(2,Math.round(num(divide,5))),out=[];
 for(let k=1;k<d;k++)out.push(k/d);
 return out;
}
export function cepGeometry(v,shared={},picked=[]){
 const ls=num(v.lineScale,100);
 if(!(ls>0))throw Error('선축척은 0보다 큰 수여야 합니다.');
 const ext=num(v.extend,5)*ls,layer=shared.layer||DRAW3_LAYERS.cntr;
 const list=(picked||[]).filter(Boolean);
 if(!list.length)throw Error('폴리선을 고르세요.');
 const contour=v.mode==='contour2'||v.mode==='contourDiv';
 const lt=contour?'CONTINUOUS':'CENTER';
 if(list.length===1){
  const a=pathOf(list[0]);
  if(!a.closed)throw Error('열린 폴리선은 두 개를 골라야 중심선을 만듭니다. 닫힌 폴리선 하나는 무게중심을 표시합니다.');
  const c=polygonCentroid(a.points),b=G.bounds([{type:'polyline',points:a.points,closed:true}]);
  return [
   seg2ent(P(b.minX-ext,c.y),P(b.maxX+ext,c.y),layer,!!v.asPolyline,'CENTER'),
   seg2ent(P(c.x,b.minY-ext),P(c.x,b.maxY+ext),layer,!!v.asPolyline,'CENTER'),
  ];
 }
 const a=pathOf(list[0]),b0=pathOf(list[1]);
 if(a.closed||b0.closed)throw Error('중심선은 열린 폴리선 두 개 사이에만 만듭니다(닫힌 폴리선은 하나만 골라 무게중심을 표시하세요).');
 const n=contour?Math.max(2,Math.round(num(v.nodes,100))):Math.max(a.points.length,b0.points.length);
 const A=resamplePath(a.points,false,n),B=alignPath(A,resamplePath(b0.points,false,n));
 return cepRatios(v.mode,v.divide).map(t=>({type:'polyline',closed:false,points:blendPaths(A,B,t),cardLayer:layer,linetype:lt}));
}
export const CEP_FIELDS=[
 {key:'mode',label:'기능',type:'select',def:'center',group:'설정',
  options:[['center','중심선 생성'],['centerDiv','중심선 임의 등분'],['contour2','등고선 2등분'],['contourDiv','등고선 임의 등분']]},
 {key:'extend',label:'연장길이',type:'number',def:5,min:0,step:1,group:'설정',hint:'× 선축척 · 닫힌 폴리선 십자 중심선의 돌출 길이'},
 {key:'divide',label:'나눔',type:'number',def:5,min:2,step:1,group:'설정',when:v=>v.mode==='centerDiv'||v.mode==='contourDiv',hint:'두 폴리선 사이를 이 수로 등분합니다(안쪽 줄은 나눔−1 개).'},
 {key:'nodes',label:'정점 수',type:'number',def:100,min:2,step:10,group:'설정',when:v=>v.mode==='contour2'||v.mode==='contourDiv',hint:'등고선을 이 정점 수로 다시 그립니다. 중심선은 원본 정점 수(많은 쪽)를 따라갑니다.'},
 {key:'lineScale',label:'선축척',type:'number',def:100,min:.01,step:1,group:'설정',hint:'카드 문맥이 도면 선축척을 읽지 못해 직접 적습니다(원문은 5 × 선축척 = 500).'},
 {key:'asPolyline',label:'십자 중심선을 폴리선으로',type:'check',def:false,group:'설정',hint:'닫힌 폴리선 무게중심 표시에만 씁니다'},
 {key:'recycle',label:'입력 후 재 순환',type:'check',def:false,group:'실행',hint:'켜면 이어서 다음 폴리선을 계속 고릅니다'},
];
export const CEP_SHARED_FIELDS=[{key:'layer',label:'켜',type:'layer',def:DRAW3_LAYERS.cntr,group:'켜'}];
export const cepSlotDefaults=i=>[
 {name:'중심선 생성',mode:'center'},
 {name:'등고선 임의 등분',mode:'contourDiv',divide:5,nodes:100},
][i]||{};
export function cepPreviewSvg(v,shared,opts={}){
 const a={id:'a',type:'polyline',closed:false,points:[P(0,0),P(1000,300),P(2000,200),P(3000,600)]};
 const b={id:'b',type:'polyline',closed:false,points:[P(0,1200),P(1000,1400),P(2000,1300),P(3000,1800)]};
 let res=[];
 try{res=cepGeometry(v,shared,[a,b]);}catch{res=[];}
 return entitiesSvg([{...a,cardLayer:'A-WALL'},{...b,cardLayer:'A-WALL'},...res],
  {label:opts.compact?'':`${CEP_MODES[v.mode]||''} · 줄 ${res.length}개`,colorOf:e=>colorOf(e.cardLayer),...opts});
}

/* ══════════════════════════════════════════════════════════════════════
   ELV — 엘리베이터 그리기  ※ 추정 구현
   izzarder.com 에 ELV 원문 글이 없다. "Help_그리기" 도움말 35편을 전수(카테고리 목록 2쪽)로 확인했고
   ELV 는 그 안에 없다. 근거는 명령 카탈로그(reference-command-catalog.js 그리기 55행)의 한 줄 설명
   "엘리베이터 그리기" 뿐이라, 아래 대화상자 항목과 도형은 모두 **추정**이다(원문 대조 불가).
   기존 바른 CAD ELD 와의 차이는 보고서에 적었다.
   ══════════════════════════════════════════════════════════════════════ */
export const ELV_STORAGE_KEY='barun-elv-card';

export function elevatorSizes(v){
 const W=num(v.shaftWidth,2200),D=num(v.shaftDepth,2200),cw=num(v.carWidth,1600),cd=num(v.carDepth,1500),
  dw=num(v.doorWidth,900),count=Math.max(1,Math.round(num(v.count,1))),leaf=num(v.leafThickness,50),
  textHeight=num(v.textHeight,200);
 if(!(W>0&&D>0))throw Error('승강로 폭·깊이는 0보다 커야 합니다.');
 if(!(cw>0&&cw<W))throw Error(`카 폭(${cw})은 0보다 크고 승강로 폭(${W})보다 작아야 합니다.`);
 if(!(cd>0&&cd<D))throw Error(`카 깊이(${cd})는 0보다 크고 승강로 깊이(${D})보다 작아야 합니다.`);
 if(!(dw>0&&dw<=cw))throw Error(`출입문 폭(${dw})은 0보다 크고 카 폭(${cw}) 이하여야 합니다.`);
 if(!(textHeight>0))throw Error('문자크기는 0보다 커야 합니다.');
 return {W,D,cw,cd,dw,count,leaf,textHeight};
}
export const elevatorMark=(v,i)=>{
 const base=String(v.mark??'EV').trim()||'EV';
 if(Number(v.count)<=1)return base;
 const m=base.match(/^(.*?)(\d+)$/);
 return m?`${m[1]}${Number(m[2])+i}`:`${base}${i+1}`;
};
/** 평면 한 벌: 승강로 외벽선(앞면은 출입구만큼 벌어짐) + 카 + 문짝 두 짝 + 번호. 추정 도형이다. */
export function elevatorGeometry(v,shared={},insert={x:0,y:0},rot=0){
 const s=elevatorSizes(v),u=G.polar(1,rot),n=G.polar(1,rot+90);
 const W2=(x,y)=>G.add(insert,G.add(G.mul(u,x),G.mul(n,y)));
 const elev=shared.shaftLayer||DRAW3_LAYERS.elev,door=shared.doorLayer||DRAW3_LAYERS.door,txt=shared.textLayer||DRAW3_LAYERS.text;
 const out=[],line=(x1,y1,x2,y2,layerName)=>out.push({type:'line',points:[W2(x1,y1),W2(x2,y2)],cardLayer:layerName});
 const rect=(x1,y1,x2,y2,layerName)=>out.push({type:'polyline',closed:true,cardLayer:layerName,
  points:[W2(x1,y1),W2(x2,y1),W2(x2,y2),W2(x1,y2)]});
 for(let i=0;i<s.count;i++){
  const x0=i*s.W,dl=x0+(s.W-s.dw)/2,dr=x0+(s.W+s.dw)/2,cx0=x0+(s.W-s.cw)/2,cx1=x0+(s.W+s.cw)/2,
   cy0=(s.D-s.cd)/2,cy1=cy0+s.cd;
  line(x0,0,x0,s.D,elev);line(x0,s.D,x0+s.W,s.D,elev);line(x0+s.W,s.D,x0+s.W,0,elev);
  line(x0,0,dl,0,elev);line(dr,0,x0+s.W,0,elev);               // 앞면 = 출입구만큼 벌어진 두 도막
  line(cx0,cy0,cx0,cy1,elev);line(cx0,cy1,cx1,cy1,elev);line(cx1,cy1,cx1,cy0,elev);
  line(cx0,cy0,dl,cy0,elev);line(dr,cy0,cx1,cy0,elev);         // 카 앞면도 출입구만큼 열어 둔다
  line(dl,0,dl,cy0,elev);line(dr,0,dr,cy0,elev);               // 출입구 옆벽
  if(s.leaf>0){rect(dl,0,dl+s.dw/2,s.leaf,door);rect(dr-s.dw/2,0,dr,s.leaf,door);}
  else{line(dl,0,dl+s.dw/2,0,door);line(dr-s.dw/2,0,dr,0,door);}
  out.push({type:'text',cardLayer:txt,text:elevatorMark(v,i),height:s.textHeight,align:'center',
   rotation:readableAngle(rot),position:W2(x0+s.W/2,(cy0+cy1)/2)});
 }
 return {entities:out,width:s.W*s.count,depth:s.D};
}
export const ELV_FIELDS=[
 {key:'shaftWidth',label:'승강로 폭 (mm)',type:'number',def:2200,min:1,step:50,group:'승강로'},
 {key:'shaftDepth',label:'승강로 깊이 (mm)',type:'number',def:2200,min:1,step:50,group:'승강로'},
 {key:'count',label:'대수 (나란히)',type:'number',def:1,min:1,max:8,step:1,group:'승강로',hint:'옆으로 이어 붙입니다'},
 {key:'carWidth',label:'카 폭 (mm)',type:'number',def:1600,min:1,step:50,group:'카'},
 {key:'carDepth',label:'카 깊이 (mm)',type:'number',def:1500,min:1,step:50,group:'카'},
 {key:'doorWidth',label:'출입문 폭 (mm)',type:'number',def:900,min:1,step:50,group:'출입문'},
 {key:'leafThickness',label:'문짝 두께 (mm, 0 = 단선)',type:'number',def:50,min:0,step:10,group:'출입문'},
 {key:'mark',label:'번호',type:'text',def:'EV1',group:'표기',hint:'대수가 2 이상이면 끝 숫자를 하나씩 올립니다'},
 {key:'textHeight',label:'문자크기 (mm)',type:'number',def:200,min:1,step:10,group:'표기'},
];
export const ELV_SHARED_FIELDS=[
 {key:'shaftLayer',label:'승강로·카 켜',type:'layer',def:DRAW3_LAYERS.elev,group:'켜'},
 {key:'doorLayer',label:'출입문 켜',type:'layer',def:DRAW3_LAYERS.door,group:'켜'},
 {key:'textLayer',label:'문자 켜',type:'layer',def:DRAW3_LAYERS.text,group:'켜'},
];
export const elvSlotDefaults=i=>[
 {name:'승용 2200×2200 1대',shaftWidth:2200,shaftDepth:2200,count:1,mark:'EV1'},
 {name:'승용 2200×2200 2대',shaftWidth:2200,shaftDepth:2200,count:2,mark:'EV1'},
 {name:'비상용 2500×2500 1대',shaftWidth:2500,shaftDepth:2500,carWidth:1800,carDepth:1700,doorWidth:1000,mark:'EV1'},
][i]||{};
export function elvPreviewSvg(v,shared,opts={}){
 let es=[];
 try{es=elevatorGeometry(v,shared,P(0,0),0).entities;}catch(e){throw e;}
 return entitiesSvg(es,{label:opts.compact?'':`추정 구현 · ${num(v.shaftWidth,2200)}×${num(v.shaftDepth,2200)} · ${Math.max(1,Math.round(num(v.count,1)))}대`,colorOf:e=>colorOf(e.cardLayer),...opts});
}

/* ══════════════════════════════════════════════════════════════════════
   화면(대화상자·화면 입력·커밋). 순수 계산은 위쪽 export 함수에 있고 여기는 DOM 만 쓴다.
   ══════════════════════════════════════════════════════════════════════ */
export function installDrawCards3(ctx){
 const fail=e=>{console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);};
 const put=(entities,removeIds=[])=>ctx.commit({removeIds,entities:resolveLayers(ctx,entities,colorOf)});
 const previewColored=list=>list.map(e=>({...e,previewColor:colorOf(e.cardLayer)||'#ffd479'}));
 /** 객체를 하나씩 이어 고른다(Esc 로 끝). 미리 선택해 둔 것이 있으면 그것을 쓴다. */
 async function pickMany(prompt,types,{limit=0,pre=true}={}){
  if(pre){
   const sel=(ctx.selected()||[]).filter(e=>!types||types.includes(e.type));
   if(sel.length)return limit?sel.slice(0,limit):sel;
  }
  const out=[];
  for(;;){
   if(limit&&out.length>=limit)break;
   const e=await ctx.pickEntity({prompt:`${prompt} · 지금까지 ${out.length}개 · Esc 로 끝내기`,types:types||null});
   if(!e)break;
   if(!out.some(x=>x.id===e.id))out.push(e);
  }
  return out;
 }

 /* ── STB ── */
 async function drawSTB(v,shared){
  for(;;){
   const previewOf=(points,cursor)=>{
    const pts=cursor?[...points,cursor]:points;
    if(pts.length<2)return [];
    try{return previewColored(stbGeometry(v,shared,pts[0],pts[1]).entities);}catch{return [];}
   };
   const path=await ctx.pickPath({prompt:`철골보 [${v.name}] ${stbSummary(v)} · ① 머리(시작) ② 꼬리(끝) · Esc 중단`,preview:previewOf,minPoints:2,maxPoints:2});
   if(!path)return null;
   const r=stbGeometry(v,shared,path.points[0],path.points[1]);
   put(r.entities);
   ctx.toast(`철골보 ${stbSummary(v)} · 길이 ${Math.round(r.length)} · Ctrl+Z 로 되돌리기`);
   if(!v.recycle)return null;
   if(v.shape==='plan')continue;
   const again=await new Promise(resolve=>{
    try{ctx.form('부호 입력 (입력 후 재 순환)',[
     {name:'markPrefix',label:'부호',type:'text',value:v.markPrefix},
     {name:'markNumber',label:'번호',type:'text',value:v.markNumber},
    ],values=>{v.markPrefix=values.markPrefix;v.markNumber=values.markNumber;resolve(true);});}catch(e){resolve(false);}
   });
   if(!again)return null;
  }
 }
 const openSTB=()=>openCardDialog({ctx,title:'철골보 평면그리기 · STB',storageKey:STB_STORAGE_KEY,
  fields:STB_FIELDS,sharedFields:STB_SHARED_FIELDS,slots:3,slotDefaults:stbSlotDefaults,
  preview:(v,s,o)=>stbPreviewSvg(v,s,o),validate:(v,s)=>{stbGeometry(v,s,P(0,0),P(6000,0));},
  onGo:(v,s)=>drawSTB({...v},s),
  note:'형태를 고르고 [그리기 시작] → 두 점(머리 → 꼬리)을 찍으면 그 자리에 보 하나를 그립니다. 평면은 철골보폭 직사각형 + 웨브선(HIDDEN), 구조기호는 두꺼운 한 선 + 머리·꼬리 접합기호 + 부호 문자입니다(원문 예시 그림 그대로). [입력 후 재 순환]을 켜면 부호만 다시 물으며 이어 그립니다.'});

 /* ── DOR ── */
 async function drawDOR(v,shared){
  for(;;){
   const first=await pickMany(v.doubleDoor?'DOR · 첫번째 문 선택':'DOR · 문 선택(선·폴리선·호 여러 개 가능)',null,{pre:!v.doubleDoor});
   if(!first.length){ctx.toast('선택한 문이 없습니다.');return null;}
   let second=[];
   if(v.doubleDoor){
    second=await pickMany('DOR · 두번째 문 선택',null,{pre:false});
    if(!second.length){ctx.toast('양개문은 문 두 짝을 골라야 합니다.',true);return null;}
   }
   const hingePrompt=`DOR · ① 회전 기준점(힌지) 지정 ② 회전 방향 지정 · 각도는 설정의 기본 각도 ${num(v.angle,30)}도 · Esc 중단`;
   const previewOf=(points,cursor)=>{
    const pts=cursor?[...points,cursor]:points;
    if(pts.length<2)return [];
    try{
     const hinge=pts[0],sign=rotationSign(first,hinge,pts[1]);
     const groups=v.doubleDoor?[first,second]:[first];
     const hinges=v.doubleDoor?[hinge,secondHinge(second,hinge)]:[hinge];
     return previewColored(doorRotationResult(v,shared,groups,hinges,sign));
    }catch{return [];}
   };
   const path=await ctx.pickPath({prompt:hingePrompt,preview:previewOf,minPoints:2,maxPoints:2});
   if(!path)return null;
   const hinge=path.points[0],sign=rotationSign(first,hinge,path.points[1]);
   const groups=v.doubleDoor?[first,second]:[first];
   const hinges=v.doubleDoor?[hinge,secondHinge(second,hinge)]:[hinge];
   put(doorRotationResult(v,shared,groups,hinges,sign));
   ctx.toast(`문 회전 ${num(v.angle,30)}도${v.doubleDoor?' (양개문)':''} · 원본은 그대로 두고 사본과 궤적을 넣었습니다 · Ctrl+Z 로 되돌리기`);
   if(!v.recycle)return null;
  }
 }
 const openDOR=()=>openCardDialog({ctx,title:'문 회전 · DOR',storageKey:DOR_STORAGE_KEY,
  fields:DOR_FIELDS,sharedFields:DOR_SHARED_FIELDS,slots:3,slotDefaults:dorSlotDefaults,
  preview:(v,s,o)=>dorPreviewSvg(v,s,o),
  validate:v=>{if(!(num(v.angle,0)>0))throw Error('기본 각도는 0보다 커야 합니다.');},
  onGo:(v,s)=>drawDOR({...v},s),
  note:'[그리기 시작] → 문 선택(Esc 로 선택 끝) → 회전 기준점(힌지) → 회전 방향 순서입니다. 원본 문은 그대로 남고 돌아간 사본과 궤적 호가 더해집니다(원문 대화상자의 "복사후 켜"). 원문 명령창의 넷째 물음 "회전 각도입력<30.0>" 은 설정의 [기본 각도] 칸으로 옮겼습니다.'});

 /* ── CEN ── */
 async function drawCEN(v,shared){
  const types=['line','polyline','rectangle','arc','circle','text','dimension'];
  const picked=v.multi
   ?await pickMany('CEN · 여러선 동시 입력(M) · 선, 폴리선, 호, 원을 선택',types)
   :await pickMany('CEN · 선, 폴리선, 호, 원을 선택(최대 2개)',types,{limit:2});
  if(!picked.length){ctx.toast('선택한 객체가 없습니다.');return null;}
  const es=cenGeometry(v,shared,picked);
  put(es);
  ctx.toast(`중심선 ${es.length}개 · ${v.multi?'여러선 동시 입력(M)':'객체 선택'} · Ctrl+Z 로 되돌리기`);
  return null;
 }
 const openCEN=()=>openCardDialog({ctx,title:'중심선 그리기 · CEN',storageKey:CEN_STORAGE_KEY,
  fields:CEN_FIELDS,sharedFields:CEN_SHARED_FIELDS,slots:2,slotDefaults:cenSlotDefaults,
  preview:(v,s,o)=>cenPreviewSvg(v,s,o),
  validate:v=>{if(!(num(v.lineScale,0)>0))throw Error('선축척은 0보다 큰 수여야 합니다.');},
  onGo:(v,s)=>drawCEN(v,s).catch(fail),
  note:'선 하나는 중점에 직각 중심선, 선 둘은 두 선 사이 중심선(각도가 다르면 이등분선), 호·원은 중심 십자입니다. [여러선 동시 입력(M)]을 켜면 고른 선들에서 최대 인식 거리 안의 평행 쌍을 모두 찾아 중심선을 넣습니다. 결과는 CENTER 선종류입니다.'});

 /* ── CEP ── */
 async function drawCEP(v,shared){
  for(;;){
   const types=['polyline','rectangle','line'];
   const picked=await pickMany('CEP · 열린 폴리선 두 개(중심선) 또는 닫힌 폴리선 하나(무게중심)를 선택',types,{limit:2});
   if(!picked.length){ctx.toast('선택한 폴리선이 없습니다.');return null;}
   const es=cepGeometry(v,shared,picked);
   put(es);
   ctx.toast(`${CEP_MODES[v.mode]||'중심선'} ${es.length}개 · Ctrl+Z 로 되돌리기`);
   if(!v.recycle)return null;
  }
 }
 const openCEP=()=>openCardDialog({ctx,title:'폴리선 간의 중심선 그리기 · CEP',storageKey:CEP_STORAGE_KEY,
  fields:CEP_FIELDS,sharedFields:CEP_SHARED_FIELDS,slots:2,slotDefaults:cepSlotDefaults,
  preview:(v,s,o)=>cepPreviewSvg(v,s,o),
  validate:(v,s)=>{cepGeometry(v,s,[{type:'polyline',points:[P(0,0),P(1000,0)]},{type:'polyline',points:[P(0,500),P(1000,500)]}]);},
  onGo:(v,s)=>drawCEP({...v},s).catch(fail),
  note:'열린 폴리선 두 개를 고르면 그 사이 중심선을, 닫힌 폴리선 하나를 고르면 무게중심 십자를 그립니다. [중심선]은 원본 정점 수(많은 쪽)를 따라가고, [등고선]은 [정점 수]로 다시 나눕니다. [임의 등분]은 [나눔] 수만큼 등분해 안쪽 줄을 나눔−1 개 만듭니다.'});

 /* ── ELV (추정) ── */
 async function drawELV(v,shared){
  const previewOf=(points,cursor)=>{
   const insert=points[0]||cursor;
   if(!insert)return [];
   const rot=points[0]&&cursor?G.angle(G.sub(cursor,insert)):0;
   try{return previewColored(elevatorGeometry(v,shared,insert,rot).entities);}catch{return [];}
  };
  const path=await ctx.pickPath({prompt:`엘리베이터(추정) ${num(v.shaftWidth,2200)}×${num(v.shaftDepth,2200)} · ① 승강로 앞면 왼쪽 모서리 ② 앞면이 향하는 오른쪽 방향 · Esc 중단`,preview:previewOf,minPoints:2,maxPoints:2});
  if(!path)return null;
  const insert=path.points[0],rot=G.angle(G.sub(path.points[1],insert));
  const r=elevatorGeometry(v,shared,insert,rot);
  put(r.entities);
  ctx.toast('엘리베이터 평면을 그렸습니다. 원문 글이 없어 카탈로그 설명으로 만든 추정 도형입니다 · Ctrl+Z 로 되돌리기',false);
  return null;
 }
 const openELV=()=>openCardDialog({ctx,title:'엘리베이터 그리기 · ELV (추정)',storageKey:ELV_STORAGE_KEY,
  fields:ELV_FIELDS,sharedFields:ELV_SHARED_FIELDS,slots:3,slotDefaults:elvSlotDefaults,
  preview:(v,s,o)=>elvPreviewSvg(v,s,o),validate:(v,s)=>{elevatorGeometry(v,s,P(0,0),0);},
  onGo:(v,s)=>drawELV(v,s).catch(fail),
  note:'※ izzarder.com 에 ELV 원문 글이 없습니다(그리기 도움말 35편 전수 확인). 대화상자 항목과 도형은 카탈로그의 "엘리베이터 그리기" 한 줄로 만든 추정입니다. 두 점(앞면 왼쪽 모서리 → 오른쪽 방향)을 찍으면 승강로·카·출입문·번호를 낱개 선으로 그립니다.'});

 return {
  STB:()=>{try{openSTB();}catch(e){fail(e);}},
  DOR:()=>{try{openDOR();}catch(e){fail(e);}},
  CEN:()=>{try{openCEN();}catch(e){fail(e);}},
  CEP:()=>{try{openCEP();}catch(e){fail(e);}},
  ELV:()=>{try{openELV();}catch(e){fail(e);}},
 };
}
