// 4차 "부분" 매핑 9개(면적·계산·선택) 카드. 근거: 2차 검증 reports/2차_매핑검증_A_보고_20260921.md
// "4. 선택"·"5. 면적 및 계산" 절, reports/2차_매핑검증_B_보고_20260921.md "9. 기타"의 (=,-,*,/) 행. 원문은
// docs/izzarder-reference-20260921/references/10-area-calc.md(MRT/518, 00·(=,-,*,/)/377·387, AE/193, CDB/322,
// DAR/262, M2/394, PY/393), 07-select.md(SE/219, SEB/527)를 WebFetch 로 재확인해 그 대화상자·옵션을 채웠다.
// MRT→ROOMSCHEDULE, CALC00→NUMCALC, AE→AREA, CDB→DISTANCECHECK, DAR→ROOM, M2·PY→기존 M2·PY,
// SE→SELECTSIMILAR, SEB→SELECTBOUNDARY 를 대체하는 새 카드이며 기존 명령·파일은 손대지 않는다.
// 중복 확인(카드작업규칙 12절): 이 9개 사이에서 AE 와 DAR 은 "닫힌 도형 면적을 문자로 찍는다"는 같은 핵심이라
// computeAreaResult() 하나를 공유한다(DAR 은 옵션이 적은 대화상자로 같은 함수를 부른다. 필드(Field) 자동
// 갱신만 DAR 고유 기능인데 그건 애초에 구현 불가라 "없음"으로 적는다). M2 와 PY 도 같은 변환 루프를
// convertAreaUnit() 하나로 합치고 방향·괄호표현만 다르게 받는다. SE(속성/수치 조건 검색)와 SEB(경계 안 포함
// 여부)는 판정 로직이 달라 따로 둔다. area-tools.js(1차)·edit-calc-tools.js(3차)와 grep 으로 대조한 결과
// MRT/CALC00/AE/CDB/DAR/M2/PY/SE/SEB 이름은 그 두 모듈에 없다(이름·기능 겹침 없음).
// room-schedule.js(buildRoomSchedule), number-calculator.js(calculateSequence/formatCalculatedNumber/
// numericLabels) 의 순수 함수만 가져다 쓴다. ctx.form 을 Promise 로 감싸는 방식은 edit-calc-tools.js askForm
// 패턴을 그대로 따른다(대화상자가 닫힌 뒤 바로 pickPoint 등을 이어 쓸 수 있다).
import * as G from './geometry.js';
import {STD_LAYERS} from './card-kit.js';
import {buildRoomSchedule} from './room-schedule.js';
import {calculateSequence,formatCalculatedNumber,numericLabels} from './number-calculator.js';

/* ══════════ 순수 함수(node --test 로 DOM 없이 확인) ══════════ */

/** 바른 CAD 리습 wcmatch 와일드카드(간이) → 정규식. * 임의문자열, ? 임의 한 글자, # 숫자 한 글자. */
export function wildcardRegex(pattern){
 let body='';
 for(const ch of String(pattern))body+= ch==='*'?'.*':ch==='?'?'.':ch==='#'?'\\d':/[.+^${}()|[\]\\]/.test(ch)?'\\'+ch:ch;
 return new RegExp('^'+body+'$','i');
}
/** MRT 공제 켜: 콤마로 구분한 와일드카드 목록에 맞는 실제 켜 이름을 돌려준다. */
export function matchLayers(csv,layers){
 const patterns=String(csv||'').split(',').map(s=>s.trim()).filter(Boolean);
 if(!patterns.length)return [];
 const regs=patterns.map(wildcardRegex);
 return (layers||[]).filter(l=>regs.some(r=>r.test(l.name))).map(l=>l.name);
}
export function layerNameOf(layers,e){return (layers||[]).find(l=>l.id===e.layer)?.name||e.layer;}

export function roundValue(value,decimals,mode='round'){
 const f=10**decimals;
 if(mode==='ceil')return Math.ceil(value*f)/f;
 if(mode==='floor')return Math.floor(value*f)/f;
 return Math.round(value*f)/f;
}

/** AE·CALC00·SE 공용 길이·면적. 대상이 아니면 던진다(SE 쪽에서는 numericAttributes 로 감싸 안전하게 쓴다). */
export function entityLength(e){
 if(e.type==='circle')return 2*Math.PI*e.radius;
 if(e.type==='arc'){const sweep=G.normalizeAngle(e.endAngle-e.startAngle)||360;return e.radius*sweep*Math.PI/180;}
 if(Array.isArray(e.points)&&e.points.length>=2){const closed=e.type==='rectangle'||!!e.closed;const segs=G.segments({points:e.points,closed});return segs.reduce((s,[a,b])=>s+G.dist(a,b),0);}
 throw Error('길이를 잴 수 있는 객체를 선택하세요.');
}
export function entityArea(e){
 if(e.type==='circle')return Math.PI*e.radius**2;
 const ps=e.type==='wall'?G.wallPolygons(e):(['rectangle','hatch'].includes(e.type)||(e.type==='polyline'&&e.closed))?[e.points]:null;
 if(!ps)throw Error('닫힌 영역/원/벽을 선택하세요.');
 return ps.reduce((s,points)=>s+G.polygonArea(points),0);
}
/** SE 의 "각도" 조건: 선·폴리선은 첫째~둘째 정점 각, 호는 사이각, 블럭·문자는 회전각. */
export function axisAngle(e){
 if((e.type==='line'||e.type==='polyline'||e.type==='rectangle')&&e.points?.length>=2)return G.normalizeAngle(G.angle(G.unit(G.sub(e.points[1],e.points[0]))));
 if(e.type==='arc')return G.normalizeAngle(e.endAngle-e.startAngle);
 if(e.type==='block'||e.type==='text')return G.normalizeAngle(e.rotation||0);
 return null;
}
/** SE 의 [수치 측정값 블록]: 종류에 맞는 것만 채워서 돌려준다(두께·고도는 2D 엔진이라 없음). */
export function numericAttributes(e){
 const out={};
 if(['line','polyline','rectangle'].includes(e.type)){try{out.length=entityLength(e);}catch{}}
 if(e.type==='circle'||['rectangle','hatch','wall'].includes(e.type)||(e.type==='polyline'&&e.closed)){try{out.area=entityArea(e);}catch{}}
 const a=axisAngle(e);if(a!=null)out.angle=a;
 if(e.type==='circle'||e.type==='arc')out.radius=e.radius;
 if(e.type==='block')out.scale=e.scale??1;
 if(e.type==='text')out.height=e.height;
 return out;
}
export const NUM_ATTR_LABELS={length:'길이',area:'면적',angle:'각도',radius:'반지름',scale:'축척',height:'문자크기'};

/** AE 점지정 모드: 점을 둘러싼 가장 작은 닫힌 도형을 찾는다(Boundary 흉내). */
export function findEnclosingArea(entities,point){
 let best=null,bestArea=Infinity;
 for(const e of entities||[]){
  if(e.hidden)continue;
  if(e.type==='circle'){
   if(G.dist(point,e.center)>e.radius)continue;
   const a=Math.PI*e.radius**2;if(a<bestArea){bestArea=a;best=e;}continue;
  }
  const ps=e.type==='wall'?G.wallPolygons(e):(['rectangle','hatch'].includes(e.type)||(e.type==='polyline'&&e.closed))?[e.points]:null;
  if(!ps)continue;
  for(const points of ps){
   if(!points||points.length<3||!G.inside(point,points))continue;
   const a=G.polygonArea(points);if(a<bestArea){bestArea=a;best=e;}
  }
 }
 return best;
}
export function groupByKey(list,keyFn){
 const map=new Map();
 for(const e of list){const k=keyFn(e);if(!map.has(k))map.set(k,[]);map.get(k).push(e);}
 return [...map.entries()].map(([key,list])=>({key,list}));
}
/** AE·DAR 공용 핵심: 대상 면적 합 − 보이드 합을 올림방식·단위·산출식·켜별구분표 옵션대로 문자열로 만든다.
 *  DAR 은 byLayer:false, formula:false 로 같은 함수를 호출해 AE 와 코드를 공유한다(중복 방지). */
export function computeAreaResult(targets,voids,{decimals=2,rounding='round',unit='m2',byLayer=false,formula=false,layerNameFn=e=>e.layer}={}){
 if(!targets?.length)throw Error('면적을 잴 대상을 선택하세요.');
 const groups=byLayer?groupByKey(targets,layerNameFn):[{key:null,list:targets}];
 const withUnit=v=>unit==='py'?formatCalculatedNumber(v*0.3025,decimals,true)+'평':unit==='both'?formatCalculatedNumber(v,decimals,true)+'㎡('+formatCalculatedNumber(v*0.3025,decimals,true)+'평)':formatCalculatedNumber(v,decimals,true)+'㎡';
 const areaOf=e=>roundValue(entityArea(e)/1e6,decimals,rounding);
 const voidArea=(voids||[]).reduce((s,e)=>s+entityArea(e),0)/1e6;
 let total=groups.reduce((s,g)=>s+g.list.reduce((n,e)=>n+entityArea(e)/1e6,0),0)-voidArea;
 total=roundValue(total,decimals,rounding);
 if(total<=0)throw Error('빼기 후 면적이 0 이하입니다.');
 const formulaText=formula?groups.flatMap(g=>g.list.map(e=>formatCalculatedNumber(areaOf(e),decimals,true))).join('+')+((voids||[]).length?'-('+voids.map(e=>formatCalculatedNumber(roundValue(entityArea(e)/1e6,decimals,rounding),decimals,true)).join('+')+')':'')+' = ':'';
 const byLayerLines=byLayer?groups.map(g=>`${g.key||'(레이어 없음)'} ${withUnit(roundValue(g.list.reduce((s,e)=>s+entityArea(e),0)/1e6,decimals,rounding))}`):[];
 return {text:formulaText+withUnit(total),total,byLayerLines};
}

/* ── MRT: 일반표(선+문자) 만들기 ── */
export function groupRooms(rooms,sort){
 const map=new Map();
 for(const r of rooms){const k=r.floor+'|'+r.name;if(!map.has(k))map.set(k,{floor:r.floor,name:r.name,count:0,area:0});const g=map.get(k);g.count++;g.area+=r.areaM2;}
 const groups=[...map.values()];
 const numOf=name=>{const m=String(name).match(/\d+/);return m?Number(m[0]):Infinity;};
 groups.sort((a,b)=>sort==='no'?(numOf(a.name)-numOf(b.name)||String(a.name).localeCompare(String(b.name),'ko')):(String(a.floor).localeCompare(String(b.floor),'ko',{numeric:true})||String(a.name).localeCompare(String(b.name),'ko',{numeric:true})));
 return groups;
}
export function autoWidths(rows,textHeight){
 const nCols=Math.max(...rows.map(r=>r.length));
 return Array.from({length:nCols},(_,c)=>Math.max(textHeight*3,Math.max(...rows.map(r=>String(r[c]??'').length),1)*textHeight*0.62+textHeight*2));
}
/** 왼쪽 위 origin 기준 선+문자 그리드 표(+y 위 좌표계). hatch-table-tools.js(3차) 의 buildTableGeometry 와
 *  같은 방식을 이 모듈 안에서 새로 적었다(그 파일은 카드작업규칙 3절에 따라 import 금지). */
export function gridTable(origin,colWidths,rowHeight,rows,textHeight,layer){
 const totalW=colWidths.reduce((a,b)=>a+b,0),totalH=rows.length*rowHeight,entities=[];
 for(let r=0;r<=rows.length;r++){const y=origin.y-r*rowHeight;entities.push({type:'line',points:[{x:origin.x,y},{x:origin.x+totalW,y}],layer});}
 let x=origin.x;const xs=[x];for(const w of colWidths){x+=w;xs.push(x);}
 for(const cx of xs)entities.push({type:'line',points:[{x:cx,y:origin.y},{x:cx,y:origin.y-totalH}],layer});
 rows.forEach((row,r)=>{let cx=origin.x;for(let c=0;c<colWidths.length;c++){const w=colWidths[c];entities.push({type:'text',position:{x:cx+w/2,y:origin.y-r*rowHeight-rowHeight/2-textHeight*0.35},text:String(row[c]??''),height:textHeight,rotation:0,align:'center',layer});cx+=w;}});
 return entities;
}

/* ── M2·PY 공용 숫자-문자 변환 ── */
const NUM_TOKEN=/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+/;
export function firstNumber(text){
 const s=String(text).replaceAll('−','-');
 const m=s.match(NUM_TOKEN);
 if(!m)return null;
 return {value:Number(m[0].replace(/,/g,'')),index:m.index,raw:m[0],before:s.slice(0,m.index),after:s.slice(m.index+m[0].length)};
}
/** M2(평→㎡ ×400/121) PY(㎡→평 ×121/400) 공용 변환. area-conversion.js 의 convertAreaText 는 소수 자릿수·단위
 *  표기·괄호표현을 고를 수 없어(항상 소수 4자리 고정) 이 카드에는 못 쓴다(보고서에 이유를 적는다). */
export function areaConvert(text,{direction,decimals=3,unitOn=false,unitLabel='',paren=false}={}){
 const found=firstNumber(text);
 if(!found)throw Error('선택한 문자에서 숫자를 찾지 못했습니다.');
 const factor=direction==='py2m2'?400/121:direction==='m22py'?121/400:null;
 if(!factor)throw Error('변환 방향을 확인할 수 없습니다.');
 let out=formatCalculatedNumber(found.value*factor,decimals,false);
 if(unitOn)out+=unitLabel;
 if(paren)out=`(${out})`;
 return out;
}

/* ── SEB: 경계 폴리곤 판정 ── */
export function circlePolygon(e,n=48){
 const pts=[];for(let i=0;i<n;i++){const a=i/n*2*Math.PI;pts.push({x:e.center.x+e.radius*Math.cos(a),y:e.center.y+e.radius*Math.sin(a)});}
 return pts;
}
export function entityInsidePolygon(e,polygon){
 const vs=G.vertices(e);
 if(!vs?.length)return false;
 return vs.every(p=>G.inside(p,polygon));
}
export function entityTouchesPolygon(e,polygon){
 const vs=G.vertices(e);
 if(vs?.length&&vs.some(p=>G.inside(p,polygon)))return true;
 const segs=(G.segments(e)||[]);
 for(const [a,b] of segs)for(let i=0;i<polygon.length;i++){const c=polygon[i],d=polygon[(i+1)%polygon.length];const hit=G.lineIntersection(a,b,c,d);if(hit&&hit.t>=0&&hit.t<=1&&hit.u>=0&&hit.u<=1)return true;}
 if(e.type==='circle')for(let i=0;i<polygon.length;i++){const c=polygon[i],d=polygon[(i+1)%polygon.length];if(G.distanceToSegment(e.center,c,d)<=e.radius)return true;}
 return false;
}

/* ── CDB 높이 입력 검증(2026-09-24 검토 F9: 층고 1e15 같은 값을 그대로 받던 문제). 항목마다 0 이상·100 m 이하, 합계 > 0. 건물 높이(mm)를 돌려준다. ── */
export const CDB_HEIGHT_LIMIT=100000;
export function checkCdbHeights(v){
 for(const [key,label] of [['floorHeight','기준층 층고'],['topHeight','최상층 층고'],['glHeight','GL→1층 높이'],['parapet','파라펫 높이']]){
  const n=Number(v[key]);
  if(!Number.isFinite(n)||n<0)throw Error(`${label}(mm)는 0 이상의 숫자로 입력하세요.`);
  if(n>CDB_HEIGHT_LIMIT)throw Error(`${label}(mm)가 ${CDB_HEIGHT_LIMIT.toLocaleString()} mm(100 m)를 넘습니다. 값을 확인하세요.`);
 }
 // 층수(기본 2): GL + 기준층×(층수-1) + 최상층 + 파라펫. 예전엔 층수 칸이 없어 2층으로만 셌다(2026-10-27 설명서 시험).
 const floors=v.floors===undefined||v.floors===''?2:Number(v.floors);
 if(!Number.isInteger(floors)||floors<1||floors>200)throw Error('층수는 1 이상 200 이하의 정수로 입력하세요.');
 const total=Number(v.floorHeight)*(floors-1)+Number(v.topHeight)+Number(v.glHeight)+Number(v.parapet);
 if(total>CDB_HEIGHT_LIMIT*10)throw Error('건물 높이가 너무 큽니다. 층수·층고를 확인하세요.');
 if(!(total>0))throw Error('층고·GL높이·파라펫높이를 확인하세요(합계가 0보다 커야 합니다).');
 return total;
}

/* ══════════ 화면 명령(install 안에서만 pick/dialog 를 쓴다) ══════════ */

export function installAreaSelectTools4(ctx){
 const guard=fn=>async(...args)=>{try{await fn(...args);}catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}};
 /** ctx.form 을 Promise 로 감싼다(edit-calc-tools.js askForm 과 같은 방식) — 대화상자가 닫힌 뒤 바로
  *  pickPoint/pickEntity 를 이어 쓸 수 있어 1차 area-tools.js 의 setTimeout(…,0) 우회가 필요 없다. */
 /** check(values) 가 던지면 폼이 열린 채 그 문구를 보여 준다(폼이 잡는다). */
 const askForm=(title,fields,check=null)=>new Promise((resolve,reject)=>{ctx.form(title,fields,async values=>{if(check)check(values);try{resolve(values);}catch(e){reject(e);}});});
 const calcTextEntity=(position,text,height)=>({type:'text',position:{x:position.x,y:position.y},text,height:height||ctx.num('text-height',150),rotation:0,align:'left',layer:ctx.ensureLayer(STD_LAYERS.text||'A-TEXT','#ffffff')});
 /** 선택 중인 객체를 쓰거나 클릭을 반복해 모은다. escOk 면 0개로 Esc 해도 null 을 돌려준다(에러 아님). */
 async function pickMany(prompt,{types}={},limit=0,escOk=false){
  const list=[];
  for(;;){
   const e=await ctx.pickEntity({prompt:`${prompt}${list.length?' · 지금까지 '+list.length+'개':''}`,types});
   if(!e)break;
   list.push(e);
   if(limit&&list.length>=limit)break;
  }
  if(!list.length){if(escOk)return null;throw Error('선택한 객체가 없습니다.');}
  return list;
 }

 /* ── MRT · 실별 면적표 만들기(/518) ── */
 async function mrt(){
  const pre=ctx.selected().filter(e=>['polyline','rectangle','hatch'].includes(e.type));
  const list=pre.length?pre:await pickMany('MRT · 실 경계(폴리선/사각형/해치) 선택',{types:['polyline','rectangle','hatch']});
  const v=await askForm('MRT · 실별 면적표 만들기',[
   {name:'floor',label:'층(문자에 층 표시가 없을 때 기본값)',value:'1F'},
   {name:'hole',label:'공제 켜(콤마, 와일드카드 * ? # 지원, 예 AREA_S*,BO)',value:''},
   {name:'shape',label:'표 모양',options:[['cad','캐드표(표 블록)'],['plain','일반표(선+문자)']],value:'cad'},
   {name:'sort',label:'표정렬(일반표에만 적용)',options:[['name','실명순'],['no','실번호순']],value:'name'},
   {name:'live',label:'살아있는 면적숫자(Field)',type:'checkbox',value:''},
  ]);
  if(v.live==='on')ctx.toast('바른 CAD 에는 필드(Field) 객체가 없어 살아있는 면적숫자는 아직 제공하지 않습니다. 고정 숫자로 만듭니다.',true);
  const holeLayers=matchLayers(v.hole,ctx.layers());
  const doc={units:'mm',entities:ctx.entities(),layers:ctx.layers()};
  // 표는 0 레이어(현재 레이어)가 아니라 표준 문자 레이어에(같은 파일의 면적 글자와 같은 A-TEXT, 2026-10-27 설명서 시험).
  const tableLayer=ctx.ensureLayer(STD_LAYERS.text||'A-TEXT','#ffffff');
  const result=buildRoomSchedule(doc,{ids:list.map(e=>e.id),floor:v.floor||'미지정',holeLayers,layer:tableLayer,height:ctx.num('text-height',250)});
  if(v.shape==='cad'){ctx.commit({entities:[result.entity]});ctx.toast(result.summary);return;}
  const groups=groupRooms(result.rooms,v.sort);
  const rows=[['층','실명','개소','면적(㎡)','면적(평)'],...groups.map(g=>[g.floor,g.name,g.count,formatCalculatedNumber(g.area,2,true),formatCalculatedNumber(g.area*0.3025,2,true)])];
  const total=groups.reduce((s,g)=>s+g.area,0);
  rows.push(['합계','',groups.reduce((s,g)=>s+g.count,0),formatCalculatedNumber(total,2,true),formatCalculatedNumber(total*0.3025,2,true)]);
  const point=await ctx.pickPoint('MRT · 표 위치(왼쪽 위)를 지정하세요');
  if(!point)return;
  const height=ctx.num('text-height',250),widths=autoWidths(rows,height);
  ctx.commit({entities:gridTable(point,widths,height*2.2,rows,height,tableLayer)});
  ctx.toast(`MRT · 일반표 · 실 ${result.rooms.length}개 · ${formatCalculatedNumber(total,2,true)}㎡`);
 }

 /* ── CALC00 · 계산기(00, 사칙연산 (=,-,*,/) 도 같은 계산기)(/377,/387) ── */
 function pushCalcHistory(line){
  let list=[];try{list=JSON.parse(ctx.storage?.getItem('calc00-history')||'[]');}catch{list=[];}
  list.unshift({line,time:Date.now()});list=list.slice(0,20);
  try{ctx.storage?.setItem('calc00-history',JSON.stringify(list));}catch{}
  ctx.log('CALC00 이력 · '+list.slice(0,5).map(h=>h.line).join(' | '));
 }
 async function calc00(){
  const v=await askForm('CALC00 · 계산기',[
   {name:'source',label:'가져올 값',options:[['text','화면 문자/치수 읽기'],['length','객체 길이'],['area','객체 면적(해치 표시)'],['distance','두 점 거리'],['coordx','좌표 X'],['coordy','좌표 Y']],value:'text'},
   {name:'op',label:'연산',options:[['+','더하기'],['-','빼기'],['*','곱하기'],['/','나누기'],['avg','평균'],['percent','퍼센트'],['sin','sin(첫 값,도)'],['cos','cos(첫 값,도)'],['tan','tan(첫 값,도)']],value:'+'},
   {name:'divide',label:'읽은 값 나누기(예 1000, mm→m. 비우면 안 함)',value:''},
   {name:'decimals',label:'소수 자릿수(비우면 자동)',value:''},
   {name:'grouped',label:'천단위 콤마',type:'checkbox',value:'on'},
   {name:'affix',label:'접두어,접미어(콤마 구분)',value:''},
  ]);
  const decimals=v.decimals===''||v.decimals==null?'auto':Number(v.decimals);
  const grouped=v.grouped==='on';
  const [prefix='',suffix='']=(v.affix||'').split(',').map(s=>s.trim());
  const divideBy=v.divide===''||v.divide==null?null:Number(v.divide);
  if(divideBy!=null&&(!Number.isFinite(divideBy)||divideBy===0))throw Error('나누기 값을 확인하세요.');
  if(v.op==='percent'){
   const pv=await askForm('CALC00 · 퍼센트 계산',[{name:'base',label:'전체 값',type:'number',value:0},{name:'percent',label:'비율 %',type:'number',value:0}]);
   const base=Number(pv.base),percent=Number(pv.percent),result=base*percent/100;
   const point=await ctx.pickPoint('CALC00 · 결과 위치를 지정하세요');
   if(!point)return;
   const text=`${prefix}${formatCalculatedNumber(result,decimals,grouped)}${suffix}`;
   ctx.commit({entities:[calcTextEntity(point,text)]});
   pushCalcHistory(`${base} 의 ${percent}% = ${text}`);
   ctx.toast(`CALC00 · ${text}`);
   return;
  }
  const values=[],hatches=[];
  const trig=['sin','cos','tan'].includes(v.op);
  for(;;){
   let raw=null;
   if(v.source==='text'){
    const e=await ctx.pickEntity({prompt:`CALC00 · 문자/치수 선택 · Esc: 계산 마침${values.length?' · '+values.length+'개':''}`,types:['text','dimension']});
    if(!e)break;
    const labels=numericLabels(e);
    if(!labels.length){ctx.toast('그 객체에서 숫자를 찾지 못했습니다.',true);continue;}
    raw=labels[0].calculatorNumber;
   }else if(v.source==='length'){
    const e=await ctx.pickEntity({prompt:`CALC00 · 길이 객체 선택 · Esc: 계산 마침${values.length?' · '+values.length+'개':''}`,types:['line','polyline','rectangle','circle','arc']});
    if(!e)break;
    try{raw=entityLength(e);}catch(err){ctx.toast(err.message,true);continue;}
   }else if(v.source==='area'){
    const e=await ctx.pickEntity({prompt:`CALC00 · 면적 객체 선택 · Esc: 계산 마침${values.length?' · '+values.length+'개':''}`,types:['rectangle','polyline','circle','hatch','wall']});
    if(!e)break;
    try{raw=entityArea(e)/1e6;}catch(err){ctx.toast(err.message,true);continue;}
    const ps=e.type==='wall'?G.wallPolygons(e):[e.type==='circle'?circlePolygon(e,48):e.points];
    for(const points of ps)hatches.push({type:'hatch',points,layer:ctx.ensureLayer('A-HATCH','#6ec6ff'),spacing:200,angle:45});
   }else if(v.source==='distance'){
    const path=await ctx.pickPath({prompt:'CALC00 · 거리를 잴 두 점을 지정 · Esc: 계산 마침',minPoints:2,maxPoints:2});
    if(!path)break;
    raw=G.dist(path.points[0],path.points[1]);
   }else{
    const point=await ctx.pickPoint(`CALC00 · 좌표 점 지정 · Esc: 계산 마침${values.length?' · '+values.length+'개':''}`);
    if(!point)break;
    raw=v.source==='coordx'?point.x:point.y;
   }
   if(divideBy!=null)raw/=divideBy;
   values.push(raw);
   ctx.toast(`CALC00 · ${values.length}개 · 최근 값 ${formatCalculatedNumber(raw,decimals,grouped)}`);
   if(trig)break;
  }
  if(!values.length)return;
  let result;
  if(v.op==='avg')result=values.reduce((s,n)=>s+n,0)/values.length;
  else if(trig)result=Math[v.op](values[0]*Math.PI/180);
  else result=calculateSequence(v.op,values);
  const point=await ctx.pickPoint('CALC00 · 결과 위치를 지정하세요');
  if(!point)return;
  const text=`${prefix}${formatCalculatedNumber(result,decimals,grouped)}${suffix}`;
  ctx.commit({entities:[calcTextEntity(point,text),...hatches]});
  const opSign={'+':'+','-':'-','*':'×','/':'÷',avg:'평균'}[v.op]||v.op;
  pushCalcHistory(`${values.map(n=>formatCalculatedNumber(n,decimals,grouped)).join(' '+opSign+' ')} = ${text}`);
  ctx.toast(`CALC00 · ${text}`);
 }

 /* ── AE · 면적 숫자로 찍어주기(/193), DAR · 살아있는 면적숫자(/262, Field 는 "없음") ── */
 async function ae(){
  const v=await askForm('AE · 면적 숫자로 찍어주기',[
   {name:'mode',label:'작동 방식',options:[['select','선택'],['point','점지정(내부 점)']],value:'select'},
   {name:'void',label:'빼기(보이드) 사용',type:'checkbox',value:''},
   {name:'byLayer',label:'켜별 구분표로 표시',type:'checkbox',value:''},
   {name:'formula',label:'산출식 함께 표시',type:'checkbox',value:'on'},
   {name:'affix',label:'접두어,접미어(콤마 구분)',value:''},
   {name:'rounding',label:'올림 방식',options:[['round','반올림'],['ceil','올림'],['floor','내림']],value:'round'},
   {name:'unit',label:'단위',options:[['m2','㎡'],['py','평'],['both','㎡+평']],value:'m2'},
  ]);
  const [prefix='',suffix='']=(v.affix||'').split(',').map(s=>s.trim());
  let targets;
  if(v.mode==='point'){
   targets=[];
   for(;;){
    const pt=await ctx.pickPoint(`AE · 안쪽 점 지정 · Esc: 마침${targets.length?' · '+targets.length+'개':''}`);
    if(!pt)break;
    const hit=findEnclosingArea(ctx.entities(),pt);
    if(!hit){ctx.toast('그 위치를 둘러싼 닫힌 도형을 찾지 못했습니다.',true);continue;}
    targets.push(hit);
   }
   if(!targets.length)return;
  }else targets=await pickMany('AE · 면적을 합산할 닫힌 도형 선택',{types:['rectangle','polyline','circle','hatch','wall']});
  let voids=[];
  if(v.void==='on')voids=await pickMany('AE · 뺄 보이드 선택(없으면 Esc)',{types:['rectangle','polyline','circle','hatch']},0,true)||[];
  const point=await ctx.pickPoint('AE · 면적 숫자 위치를 지정하세요');
  if(!point)return;
  const layers=ctx.layers();
  const r=computeAreaResult(targets,voids,{decimals:2,rounding:v.rounding,unit:v.unit,byLayer:v.byLayer==='on',formula:v.formula==='on',layerNameFn:e=>layerNameOf(layers,e)});
  const height=ctx.num('text-height',150);
  const entities=[calcTextEntity(point,`${prefix}${r.text}${suffix}`,height),...r.byLayerLines.map((line,i)=>calcTextEntity({x:point.x,y:point.y-(i+1)*height*1.8},line,height))];
  ctx.commit({entities});
  ctx.toast(`AE · ${r.text}`);
 }
 async function dar(){
  const boundary=await ctx.pickEntity({prompt:'DAR · 실 경계(닫힌 폴리선/사각형) 선택',types:['polyline','rectangle']});
  if(!boundary)return;
  if(boundary.type==='polyline'&&!boundary.closed)throw Error('닫힌 경계를 선택하세요.');
  const v=await askForm('DAR · 살아있는 면적숫자',[
   {name:'void',label:'빼기(보이드) 사용',type:'checkbox',value:''},
   {name:'unit',label:'표현방법',options:[['m2','㎡'],['py','평']],value:'m2'},
  ]);
  let voids=[];
  if(v.void==='on')voids=await pickMany('DAR · 뺄 보이드 경계 선택(없으면 Esc)',{types:['polyline','rectangle']},0,true)||[];
  const point=await ctx.pickPoint('DAR · 면적 숫자 위치를 지정하세요');
  if(!point)return;
  const r=computeAreaResult([boundary],voids,{decimals:2,rounding:'round',unit:v.unit,byLayer:false,formula:false});
  ctx.commit({entities:[{...calcTextEntity(point,r.text),darSourceId:boundary.id}]});
  ctx.toast(`DAR · ${r.text} · 바른 CAD 에는 필드(Field) 객체가 없어 경계를 고쳐도 자동으로 갱신되지 않습니다. 값이 바뀌면 DAR 을 다시 실행해 새로 찍으세요.`);
 }

 /* ── CDB · 인동 간격 검토(/322) ── */
 async function cdb(){
  const v=await askForm('CDB · 인동 간격 검토 설정',[
   {name:'factor',label:'배수',options:[['0.25','0.25배'],['0.5','0.5배'],['0.6','0.6배'],['0.8','0.8배'],['1.0','1.0배']],value:'0.5'},
   {name:'floors',label:'층수(지상, 최상층 포함)',type:'number',value:2},
   {name:'floorHeight',label:'기준층 층고(mm)',type:'number',value:2800},
   {name:'topHeight',label:'최상층 층고(mm)',type:'number',value:2800},
   {name:'glHeight',label:'GL→1층 높이(mm)',type:'number',value:900},
   {name:'parapet',label:'파라펫 높이(mm)',type:'number',value:300},
   {name:'repeat',label:'입력 후 재순환',type:'checkbox',value:'on'},
  ],checkCdbHeights);
  const factor=Number(v.factor);
  const buildingHeight=checkCdbHeights(v);
  const requiredM=buildingHeight*factor/1000,repeat=v.repeat==='on';
  let more=true;
  while(more){
   const path=await ctx.pickPath({prompt:'CDB · 인동간격을 잴 두 점을 지정하세요'+(repeat?' · Esc: 끝내기':''),minPoints:2,maxPoints:2});
   if(!path)break;
   const actualM=G.dist(path.points[0],path.points[1])/1000,ok=actualM>=requiredM-1e-6;
   const text=`인동간격 ${formatCalculatedNumber(actualM,2,true)}m / 요구 ${formatCalculatedNumber(requiredM,2,true)}m(${factor}배) · ${ok?'충족':'부족'}`;
   ctx.commit({entities:[calcTextEntity(path.points[1],text),{type:'dimension',mode:'aligned',points:[path.points[0],path.points[1],path.points[0]],textHeight:ctx.num('text-height',150),layer:ctx.ensureLayer('A-DIM','#ffd479')}]});
   ctx.toast(`CDB · ${text}`);
   more=repeat;
  }
 }

 /* ── M2(/394)·PY(/393) 공용 변환 루프(중복 방지로 하나만 둔다) ── */
 async function convertAreaUnit(direction,dialogTitle,cmdLabel,extraFields){
  const v=await askForm(dialogTitle,[
   {name:'decimals',label:'소수 자릿수',type:'number',value:3},
   ...extraFields,
   {name:'unitOn',label:'단위표현',type:'checkbox',value:direction==='py2m2'?'on':''},
   {name:'unitLabel',label:'단위 표기',options:direction==='py2m2'?[['m2','m2'],['m²','m²'],['sqm','sqm']]:[['평','평'],['py','py']],value:direction==='py2m2'?'m2':'평'},
   {name:'target',label:'결과 넣을 곳',options:[['replace','기존 문자 수정'],['new','새 문자(오른쪽)']],value:'replace'},
   {name:'repeat',label:'입력 후 재순환',type:'checkbox',value:''},
  ]);
  const decimals=Number(v.decimals),unitOn=v.unitOn==='on',unitLabel=v.unitLabel,target=v.target,repeat=v.repeat==='on',paren=v.paren==='on';
  let more=true;
  while(more){
   const list=await pickMany(`${cmdLabel} · 변환할 문자 선택`+(repeat?' · Esc: 끝내기':''),{types:['text']},0,true);
   if(!list)break;
   const conv=e=>areaConvert(e.text,{direction,decimals,unitOn,unitLabel,paren});
   if(target==='replace')ctx.execute({type:'batch',commands:list.map(e=>({type:'update',ids:[e.id],changes:{text:conv(e)}}))});
   else ctx.commit({entities:list.map(e=>({...calcTextEntity({x:e.position.x+(e.height||150)*6,y:e.position.y},conv(e),e.height),layer:e.layer}))});
   ctx.toast(`${cmdLabel} · 문자 ${list.length}개를 변환했습니다.`);
   more=repeat;
  }
 }
 const m2=()=>convertAreaUnit('py2m2','M2 · 평→제곱미터 변환','M2',[]);
 const py=()=>convertAreaUnit('m22py','PY · 제곱미터→평 변환','PY',[{name:'paren',label:'괄호표현',type:'checkbox',value:''}]);

 /* ── SE · 유사 객체 선택(/219) ── */
 async function se(){
  const base=await ctx.pickEntity({prompt:'SE · 기준 객체를 선택하세요'});
  if(!base)return;
  const layers=ctx.layers();
  const attrCandidates=[
   {key:'layer',label:'켜 이름',value:layerNameOf(layers,base),get:e=>layerNameOf(layers,e)},
   {key:'color',label:'켜 색',value:base.color||'',get:e=>e.color||''},
   ...(base.type==='block'?[{key:'name',label:'블럭 이름',value:base.name||'',get:e=>e.name||''}]:[]),
   ...(base.type==='text'?[{key:'text',label:'문자 내용',value:base.text||'',get:e=>e.text||''}]:[]),
  ];
  const nums=numericAttributes(base);
  const numFields=Object.entries(nums).map(([key,value])=>({key,label:NUM_ATTR_LABELS[key],value}));
  const fields=[
   {name:'region',label:'선택영역 지정(끄면 화면 전체)',type:'checkbox',value:''},
   ...attrCandidates.map(f=>({name:'a_'+f.key,label:`${f.label} 일치("${f.value}")`,type:'checkbox',value:''})),
   ...numFields.map(f=>({name:'n_'+f.key,label:`${f.label} 오차범위(기준 ${formatCalculatedNumber(f.value,3,false)}, 비우면 끔)`,value:''})),
   {name:'replace',label:'교체(선택 시 다음에 새 객체 선택)',type:'checkbox',value:''},
   {name:'label',label:'표시(번호 매기기)',type:'checkbox',value:''},
   {name:'affix',label:'표시 접두,접미(콤마 구분)',value:''},
  ];
  const v=await askForm('SE · 유사 객체 선택',fields);
  let region=null;
  if(v.region==='on'){
   const path=await ctx.pickPath({prompt:'SE · 선택 영역의 두 꼭짓점을 지정하세요',minPoints:2,maxPoints:2});
   if(!path)return;
   const [p1,p2]=path.points;
   region={minX:Math.min(p1.x,p2.x),maxX:Math.max(p1.x,p2.x),minY:Math.min(p1.y,p2.y),maxY:Math.max(p1.y,p2.y)};
  }
  const inRegion=e=>{if(!region)return true;const b=G.bounds([e]);return !!b&&b.minX>=region.minX&&b.maxX<=region.maxX&&b.minY>=region.minY&&b.maxY<=region.maxY;};
  const matches=ctx.entities().filter(e=>{
   if(e.id===base.id||e.hidden||e.type!==base.type||!inRegion(e))return false;
   for(const f of attrCandidates)if(v['a_'+f.key]==='on'&&String(f.get(e))!==String(f.value))return false;
   for(const f of numFields){
    const rawTol=v['n_'+f.key];if(rawTol===''||rawTol==null)continue;
    const tol=Math.abs(Number(rawTol)),val=numericAttributes(e)[f.key];
    if(val==null||!Number.isFinite(tol)||Math.abs(val-f.value)>tol)return false;
   }
   return true;
  });
  if(!matches.length)throw Error('조건에 맞는 객체를 찾지 못했습니다.');
  ctx.setSelected(matches.map(e=>e.id));
  ctx.toast(`SE · ${matches.length}개 선택`);
  if(v.replace==='on'){
   const rep=await ctx.pickEntity({prompt:'SE · 교체할 새 객체를 선택하세요'});
   if(rep){
    const anchor=e=>e.position||e.center||e.points?.[0]||null;
    const removeIds=[],adds=[];
    for(const e of matches){
     const a=anchor(e);if(!a)continue;
     const clone=structuredClone(rep);delete clone.id;
     if(clone.position)clone.position={x:a.x,y:a.y};
     if(clone.center)clone.center={x:a.x,y:a.y};
     removeIds.push(e.id);adds.push(clone);
    }
    if(adds.length){ctx.commit({removeIds,entities:adds});ctx.toast(`SE · ${adds.length}개를 교체했습니다.`);}
    else ctx.toast('SE · 위치 기준점이 있는 객체(문자·블럭·원 등)만 교체할 수 있습니다.',true);
   }
  }
  if(v.label==='on'){
   const [prefix='',suffix='']=(v.affix||'').split(',').map(s=>s.trim());
   const height=ctx.num('text-height',150);
   const sorted=[...matches].sort((a,b)=>{const ba=G.bounds([a]),bb=G.bounds([b]);return (bb?.maxY??0)-(ba?.maxY??0)||((ba?.minX??0)-(bb?.minX??0));});
   const entities=sorted.map((e,i)=>{const b=G.bounds([e]);if(!b)return null;return calcTextEntity({x:b.maxX+height,y:b.maxY},`${prefix}${i+1}${suffix}`,height);}).filter(Boolean);
   if(entities.length)ctx.commit({entities});
  }
 }

 /* ── SEB · 영역 내의 객체 선택(/527) ── */
 const SEB_TYPES=[['text','단행문자'],['block','블럭'],['line','선'],['polyline','폴리선'],['rectangle','사각형'],['circle','원'],['arc','호'],['dimension','치수'],['hatch','해치'],['wall','벽']];
 async function seb(){
  const boundary=await ctx.pickEntity({prompt:'SEB · 경계로 쓸 폴리선/사각형/원을 선택하세요',types:['polyline','rectangle','circle']});
  if(!boundary)return;
  if(boundary.type==='polyline'&&!boundary.closed)throw Error('닫힌 폴리선을 경계로 선택하세요.');
  const layers=ctx.layers();
  const v=await askForm('SEB · 영역 내의 객체 선택',[
   {name:'mode',label:'방식',options:[['inside','윈도우(완전 포함)'],['crossing','걸침(닿으면 포함)']],value:'inside'},
   {name:'layerLimit',label:'특정 켜의 영역만 인정',type:'checkbox',value:''},
   {name:'layerName',label:'영역 켜 이름',value:layerNameOf(layers,boundary)},
   ...SEB_TYPES.map(([k,label])=>({name:'t_'+k,label,type:'checkbox',value:k==='text'?'on':''})),
  ]);
  if(v.layerLimit==='on'&&layerNameOf(layers,boundary)!==String(v.layerName||'').trim())throw Error('경계 객체가 지정한 켜에 있지 않습니다. 그 켜의 경계를 다시 선택하세요.');
  const wanted=SEB_TYPES.filter(([k])=>v['t_'+k]==='on').map(([k])=>k);
  if(!wanted.length)throw Error('목표 객체 종류를 하나 이상 선택하세요.');
  const polygon=boundary.type==='circle'?circlePolygon(boundary,48):boundary.points;
  const crossing=v.mode==='crossing';
  const matches=ctx.entities().filter(e=>{
   if(e.id===boundary.id||e.hidden||!wanted.includes(e.type))return false;
   return crossing?entityTouchesPolygon(e,polygon):entityInsidePolygon(e,polygon);
  });
  ctx.setSelected(matches.map(e=>e.id));
  ctx.toast(`SEB · ${matches.length}개 선택`);
 }

 return {
  MRT:guard(mrt), CALC00:guard(calc00), AE:guard(ae), CDB:guard(cdb), DAR:guard(dar),
  M2:guard(m2), PY:guard(py), SE:guard(se), SEB:guard(seb),
 };
}
