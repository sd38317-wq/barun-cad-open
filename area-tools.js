// 면적 및 계산 미연결 20개(중복 MAC 제외 19개) 카드. docs/izzarder-reference-20260921/references/10-area-calc.md 근거.
// DEE(/522) ZAE(/388) FFO(/523) 는 바른 CAD 구조상(입면 자동전개 엔진·FIELD 객체 없음) "없음" 카드로 등록한다.
// 나머지는 선택 → (필요하면 ctx.form 으로 옵션) → 점 지정 → 문자/도형 생성 순서로, 옵션이 없는 즉시실행형은 선택만으로 바로 적용한다.
import * as G from './geometry.js';
import {STD_LAYERS} from './card-kit.js';

/* ── 숫자-문자 파싱/재조합 (COI COR EDP INA NUC LMA LNA HV ND NP NS BA 공용) ──
   콤마·소숫점을 포함한 숫자 토큰을 찾는다. 부호(-)는 negativeAware 일 때만 앞 글자에서 흡수한다
   (예: "ET-454" 는 기본은 "454", 음수 고려 시 "-454"). */
const NUM_TOKEN=/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+/g;

export function findNumberTokens(text){
 const s=String(text).replaceAll('−','-');
 return [...s.matchAll(NUM_TOKEN)].map(m=>({raw:m[0],index:m.index,value:Number(m[0].replace(/,/g,'')),hadComma:m[0].includes(','),decimals:(m[0].split('.')[1]||'').length}));
}
export function findFirstNumber(text,{negativeAware=false}={}){
 const s=String(text).replaceAll('−','-');
 NUM_TOKEN.lastIndex=0;
 const m=NUM_TOKEN.exec(s);
 NUM_TOKEN.lastIndex=0; // exec 는 매치에 성공하면 lastIndex 를 남긴다. matchAll(Symbol.matchAll)은 그 lastIndex 를 그대로 물려받으므로(스펙),
                         // 다음 findNumberTokens 호출이 앞부분을 건너뛰지 않도록 항상 0으로 되돌려 둔다.
 if(!m)return null;
 let start=m.index,raw=m[0];
 if(negativeAware&&start>0&&s[start-1]==='-'){start--;raw='-'+raw;}
 const value=Number(raw.replace(/,/g,''));
 if(!Number.isFinite(value))return null;
 return {value,before:s.slice(0,start),after:s.slice(m.index+m[0].length),hadComma:m[0].includes(','),decimals:(m[0].split('.')[1]||'').length};
}
export function formatNumber(value,decimals=null,grouped=false){
 if(!Number.isFinite(value))throw Error('표시할 숫자가 없습니다.');
 const sign=value<0?'-':'',abs=Math.abs(value);
 let out=decimals==null?String(abs):abs.toFixed(decimals);
 if(grouped){const [i,d]=out.split('.');out=i.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(d!==undefined?'.'+d:'');}
 return sign+out;
}
/** COI: 문자 안의 모든 숫자에 천단위 콤마를 넣는다. */
export function insertCommas(text){
 return String(text).replace(NUM_TOKEN,tok=>{
  const clean=tok.replace(/,/g,''),[i,d]=clean.split('.'),grouped=i.replace(/\B(?=(\d{3})+(?!\d))/g,',');
  return d!==undefined?grouped+'.'+d:grouped;
 });
}
/** COR: 문자 안의 모든 숫자에서 천단위 콤마를 뺀다. */
export function removeCommas(text){
 return String(text).replace(NUM_TOKEN,tok=>tok.replace(/,/g,''));
}
/** EDP: 문자 안의 모든 숫자를 지정한 소숫점 자릿수로 맞춘다(콤마가 있던 숫자는 콤마 유지). */
export function fixDecimalPlaces(text,places){
 if(!Number.isInteger(places)||places<0||places>6)throw Error('소수 자릿수는 0~6 사이로 입력하세요.');
 return String(text).replace(NUM_TOKEN,tok=>{
  const hadComma=tok.includes(','),value=Number(tok.replace(/,/g,''));
  if(!Number.isFinite(value))return tok;
  let out=value.toFixed(places);
  if(hadComma){const [i,d]=out.split('.');out=i.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(d!==undefined?'.'+d:'');}
  return out;
 });
}
export function calc(a,operator,b){
 if(!Number.isFinite(a)||!Number.isFinite(b))throw Error('유효한 숫자가 필요합니다.');
 if(operator==='/'&&b===0)throw Error('0으로 나눌 수 없습니다.');
 const n=operator==='+'?a+b:operator==='-'?a-b:operator==='*'?a*b:operator==='/'?a/b:NaN;
 if(!Number.isFinite(n))throw Error('계산 가능한 범위를 넘었습니다.');
 return Number(n.toPrecision(14));
}
/** NUC: 문자 안 첫번째 숫자에 연산을 적용해 다시 끼워 넣는다. */
export function applyBulkCalc(text,{operator,operand,negativeAware=false,decimals=null,grouped=false}){
 const found=findFirstNumber(text,{negativeAware});
 if(!found)throw Error(`숫자를 찾을 수 없습니다: "${text}"`);
 const result=calc(found.value,operator,operand);
 const operandDecimals=String(operand).includes('.')?String(operand).split('.')[1].length:0;
 const places=decimals==null?Math.max(found.decimals,operandDecimals):decimals;
 return found.before+formatNumber(result,places,grouped||found.hadComma)+found.after;
}
/** ND NS: 두 문자 그룹의 합계를 나누거나 뺀다. */
export function sumTexts(entities){
 return entities.reduce((sum,e)=>{
  const first=findNumberTokens(e.text)[0];
  if(!first)throw Error(`숫자를 찾을 수 없는 문자가 있습니다: "${e.text}"`);
  return sum+first.value;
 },0);
}

/* ── 레벨 문자 (LMA LNA 공용). "±0.000" "+3.600" "-1.200" 외에 실무 표기
   "FL+3,000" "GL+1,200" "EL. +3600" "SL-1,500" "+3000mm" "FL 3.6 m" 도 읽고, 다시 쓸 때는 원래 표기 형식을 유지한다
   (2026-09-24 검토 F6). 단위 판정: 소숫점이 없고 천단위 콤마가 있거나 100 이상이면 mm, 그 외(소숫점 있음·작은 수)는 m. ── */
// 접두어는 레벨 표기(…L: FL GL EL SL CL RL 1FL B1FL RFL 등)만 허용해 "A-1" 같은 일반 기호가 레벨로 읽히지 않게 한다.
const LEVEL_RE=/^([A-Za-z0-9]{0,4}L\.?)?(\s*)([+\-±]?)(\s*)(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s*)(mm|m)?\s*$/i;
/** 단위 판정(검토자 지적 4·재지적 ② 반영): 단위 표기가 있으면 그것, 천단위 콤마가 있으면 mm, 소숫점이 있으면 m,
 *  레벨 접두어(FL…)가 있고 소숫점이 없으면 mm("FL-50" 은 -50mm), 접두어·소숫점 모두 없는 정수는 100 이상만 mm 로 확정하고
 *  그보다 작으면 애매("+50")하므로 defaultUnit(도면의 다른 레벨 문자에서 추정)을 따르고 ambiguous 로 표시한다. */
export function inferLevelUnit({unitRaw='',prefix='',hadComma=false,decimals=0,number=0,defaultUnit=null}){
 if(unitRaw)return {unit:unitRaw.toLowerCase(),ambiguous:false};
 if(hadComma)return {unit:'mm',ambiguous:false};
 if(decimals>0)return {unit:'m',ambiguous:false};
 if(prefix.trim())return {unit:'mm',ambiguous:false};
 if(Math.abs(number)>=100)return {unit:'mm',ambiguous:false};
 return {unit:defaultUnit==='mm'||defaultUnit==='m'?defaultUnit:'m',ambiguous:defaultUnit!=='mm'&&defaultUnit!=='m',bare:true};
}
export function parseLevelParts(text,{defaultUnit=null}={}){
 const s=String(text).trim().replaceAll('−','-');
 const m=s.match(LEVEL_RE);
 if(!m)throw Error(`레벨 문자를 읽을 수 없습니다: "${text}"`);
 const [,prefixRaw='',sep1='',signRaw='',sep2='',numRaw,sep3='',unitRaw='']=m;
 const prefix=(prefixRaw||'')+sep1,hadComma=numRaw.includes(','),decimals=(numRaw.split('.')[1]||'').length;
 // 접두어가 한 글자(L)뿐이면 부호가 있어야 레벨("L3" 은 도면 기호). 접두어가 있는데 부호·공백·콤마·소숫점이 모두 없으면("FL50") 레벨로 보지 않는다.
 if(prefixRaw){
  const bare=prefixRaw.replace(/\.$/,'');
  if(bare.length===1&&!signRaw)throw Error(`레벨 문자를 읽을 수 없습니다: "${text}"`);
  if(!signRaw&&!sep1&&!hadComma&&decimals===0&&!unitRaw)throw Error(`레벨 문자를 읽을 수 없습니다: "${text}"`);
 }
 const number=Number(numRaw.replace(/,/g,''));
 if(!Number.isFinite(number))throw Error(`레벨 문자를 읽을 수 없습니다: "${text}"`);
 const {unit,ambiguous,bare=false}=inferLevelUnit({unitRaw,prefix:prefixRaw||'',hadComma,decimals,number,defaultUnit});
 const sign=signRaw==='-'?-1:1;
 const meters=sign*(unit==='mm'?number/1000:number);
 return {prefix,sign:signRaw,signSep:sep2,unit,unitText:unitRaw?sep3+unitRaw:'',hadComma,decimals,meters,explicitSign:signRaw!=='',ambiguous,bare};
}
export function parseLevelText(text,opts){
 return parseLevelParts(text,opts).meters;
}
/** 도면의 다른 레벨 문자들에서 단위를 추정한다(애매하지 않은 것만 셈). 하나도 없으면 null. */
export function inferDrawingLevelUnit(entities,excludeIds=[]){
 const skip=new Set(excludeIds);const count={mm:0,m:0};
 for(const e of entities||[]){
  if(e?.type!=='text'||skip.has(e.id))continue;
  try{const p=parseLevelParts(e.text);if(!p.ambiguous)count[p.unit]++;}catch{/* 레벨 아님 */}
 }
 if(!count.mm&&!count.m)return null;
 return count.mm>=count.m?'mm':'m';
}
export function formatLevelText(value,decimals=3){
 const rounded=Number(value.toFixed(decimals));
 if(Math.abs(rounded)<Math.pow(10,-decimals)/2)return '±'+(0).toFixed(decimals);
 return (rounded>0?'+':'-')+Math.abs(rounded).toFixed(decimals);
}
/** 원래 표기(접두어·단위·콤마·자릿수)를 유지한 채 값만 바꿔 쓴다. 부호가 없던 문자는 음수가 될 때만 부호를 붙인다. */
export function formatLevelLike(parts,meters,decimals=3){
 if(parts.unit==='mm'){
  const mmExact=meters*1000,mm=parts.decimals>0?Number(mmExact.toFixed(parts.decimals)):Math.round(mmExact),abs=Math.abs(mm);
  const body=parts.hadComma?formatNumber(abs,parts.decimals>0?parts.decimals:0,true):(parts.decimals>0?abs.toFixed(parts.decimals):String(abs));
  const sign=mm===0?(parts.explicitSign?'±':''):mm<0?'-':(parts.explicitSign?'+':'');
  return `${parts.prefix}${sign}${parts.signSep||''}${body}${parts.unitText||''}`;
 }
 const places=parts.decimals>0?parts.decimals:decimals;
 const rounded=Number(meters.toFixed(places)),abs=Math.abs(rounded);
 const body=parts.hadComma?formatNumber(abs,places,true):abs.toFixed(places);
 const zero=Math.abs(rounded)<Math.pow(10,-places)/2;
 const sign=zero?(parts.explicitSign?'±':''):rounded<0?'-':(parts.explicitSign?'+':'');
 return `${parts.prefix}${sign}${parts.signSep||''}${body}${parts.unitText||''}`;
}
export function shiftLevelText(text,deltaMeters,decimals=3,opts={}){
 const parts=parseLevelParts(text,opts);
 return formatLevelLike(parts,parts.meters+deltaMeters,decimals);
}
/** LNA 명령행 입력 "+500"/"-300"(mm) → 미터 증감값. */
export function parseLevelDelta(input){
 const m=String(input).trim().match(/^([+-])\s*(\d+(?:\.\d+)?)$/);
 if(!m)throw Error('증감값은 "+500" 또는 "-300" 형식(mm)으로 입력하세요.');
 return (m[1]==='-'?-1:1)*Number(m[2])/1000;
}

/* ── INA: "기호:숫자" 형태 문자를 기호별로 합산. ── */
export function indexSums(texts,separator=':'){
 const groups=new Map();
 for(const text of texts){
  const idx=text.indexOf(separator);
  if(idx<0)continue;
  const symbol=text.slice(0,idx).trim();
  const num=findNumberTokens(text.slice(idx+separator.length))[0];
  if(!symbol||!num)continue;
  groups.set(symbol,(groups.get(symbol)||0)+num.value);
 }
 if(!groups.size)throw Error(`구분기호("${separator}")가 포함된 색인 숫자 문자가 없습니다.`);
 const list=[...groups.entries()].map(([symbol,sum])=>({symbol,sum}));
 return {total:list.reduce((s,g)=>s+g.sum,0),groups:list};
}

/* ── BA: 전용면적 비율로 공용면적을 배분. ── */
export function allocateShareArea(exclusiveAreas,commonAreaTotal){
 if(!Array.isArray(exclusiveAreas)||!exclusiveAreas.length)throw Error('전용면적 목록이 비어 있습니다.');
 const sumExclusive=exclusiveAreas.reduce((s,v)=>s+v,0);
 if(!(sumExclusive>0))throw Error('전용면적 합계가 0보다 커야 합니다.');
 const allocated=exclusiveAreas.map(v=>v+(v/sumExclusive)*commonAreaTotal);
 return {sumExclusive,allocated,total:allocated.reduce((s,v)=>s+v,0)};
}

/* ── MAC: 선택한 선/폴리선을 하나의 닫힌 고리로 잇는다(원의 planar-face 다중 고리 인식은 이번 1차 범위 밖). ── */
export function segmentsOf(entity){
 if(entity.type==='line'&&entity.points?.length===2)return [[entity.points[0],entity.points[1]]];
 if((entity.type==='polyline'||entity.type==='rectangle')&&Array.isArray(entity.points)&&entity.points.length>=2&&!entity.bulges?.some(Boolean))return G.segments(entity);
 return [];
}
export function chainClosedLoop(entities,tolerance=0.5){
 const segs=[];
 for(const e of entities||[])for(const [a,b] of segmentsOf(e))if(G.dist(a,b)>G.EPS)segs.push([{x:a.x,y:a.y},{x:b.x,y:b.y}]);
 if(segs.length<3)throw Error('닫힌 고리를 만들려면 선분이 3개 이상 필요합니다.');
 const remaining=segs.slice(1),loop=[segs[0][0],segs[0][1]];
 while(remaining.length){
  const tail=loop.at(-1);
  const idx=remaining.findIndex(([a,b])=>G.dist(a,tail)<=tolerance||G.dist(b,tail)<=tolerance);
  if(idx<0)break;
  const [a,b]=remaining.splice(idx,1)[0];
  loop.push(G.dist(a,tail)<=tolerance?b:a);
 }
 if(remaining.length)throw Error(`선택한 선분이 하나의 닫힌 고리로 연결되지 않습니다(연결 안 된 선분 ${remaining.length}개). 중심선만 다시 선택하세요.`);
 if(G.dist(loop[0],loop.at(-1))>tolerance)throw Error('선택한 선분이 닫힌 고리를 이루지 않습니다. 시작점과 끝점이 만나야 합니다.');
 loop.pop();
 return loop;
}

/* ── HV: 사각형 가로x세로. ── */
export function rectangleWidthHeight(entity){
 const pts=entity?.points;
 if(!Array.isArray(pts)||pts.length<4)throw Error('사각형(4점) 폴리선만 가로x세로로 계산할 수 있습니다.');
 const w=G.dist(pts[0],pts[1]),h=G.dist(pts[1],pts[2]);
 if(!(w>G.EPS)||!(h>G.EPS))throw Error('가로·세로 길이가 있는 사각형을 선택하세요.');
 return {w,h,area:w*h};
}
/* ── HW: 삼각형 세 점 → 밑변(가장 긴 변)·높이·면적. ── */
export function triangleBaseHeightArea(points){
 if(!Array.isArray(points)||points.length!==3)throw Error('삼각형 세 점이 필요합니다.');
 const edges=points.map((p,i)=>G.dist(p,points[(i+1)%3])).sort((a,b)=>b-a);
 const base=edges[0],area=G.polygonArea(points);
 if(!(base>G.EPS))throw Error('세 점이 한 직선 위에 있지 않아야 합니다.');
 return {base,height:2*area/base,area};
}

/* ── CDN: 정북 일조권 사선(평면). 구법 9m / 신법 10m 기준, 기준높이 이하는 1.5m, 초과분은 (h-기준)/2 추가.
   (건축법 시행령 §86 통칙. 원문 주의사항대로 실제 이격거리는 관계법령을 재확인해야 한다.) ── */
export function northSlopeOffset(height,baseHeight){
 if(!(height>=0))throw Error('높이는 0 이상이어야 합니다.');
 return height<=baseHeight?1.5:1.5+(height-baseHeight)/2;
}
export function northSlopeCheckLines(baseHeight,reviewHeight,interval){
 if(!(reviewHeight>0))throw Error('검토높이를 입력하세요.');
 if(!(interval>0))throw Error('검토선 높이 간격을 입력하세요.');
 const out=[];
 for(let h=interval;h<reviewHeight-1e-6;h+=interval)out.push({height:Number(h.toFixed(6)),offset:northSlopeOffset(h,baseHeight)});
 out.push({height:reviewHeight,offset:northSlopeOffset(reviewHeight,baseHeight)});
 return out;
}

/* ── 카드 진입점. ── */
export function installAreaTools(ctx){
 const TEXT_LAYER=STD_LAYERS.text||'A-TEXT';
 const guard=fn=>async(...args)=>{try{await fn(...args);}catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}};
 const none=(cmd,name,reason)=>()=>ctx.toast(`바른 CAD 에는 ${reason} 이(가) 없어 ${cmd}(${name}) 기능은 아직 제공하지 않습니다.`,true);
 /** 선택 중인 객체를 쓰거나(전제 없으면), 클릭을 반복해 여러 객체를 모은다. Esc 로 끝낸다. */
 async function pickMany(prompt,{types=['text']}={}){
  const pre=ctx.selected().filter(e=>types.includes(e.type));
  if(pre.length)return pre;
  const list=[];
  for(;;){
   const e=await ctx.pickEntity({prompt:`${prompt} · Esc: 선택 마침${list.length?' · 지금까지 '+list.length+'개':''}`,types});
   if(!e)break;
   list.push(e);
  }
  if(!list.length)throw Error('선택한 객체가 없습니다.');
  return list;
 }
 const textEntity=(position,text,{height=ctx.num('text-height',150),align='left',layer}={})=>({type:'text',position,text,height,rotation:0,align,layer:layer||ctx.ensureLayer(TEXT_LAYER,'#ffffff')});
 const listEntities=(point,rows,height)=>rows.map((text,i)=>textEntity({x:point.x,y:point.y-i*height*1.8},text,{height}));

 async function coi(){
  const texts=await pickMany('COI · 천단위 콤마를 넣을 문자 선택',{types:['text']});
  ctx.execute({type:'batch',commands:texts.map(e=>({type:'update',ids:[e.id],changes:{text:insertCommas(e.text)}}))});
  ctx.toast(`COI · 문자 ${texts.length}개에 천단위 콤마를 넣었습니다.`);
 }
 async function cor(){
  const texts=await pickMany('COR · 천단위 콤마를 뺄 문자 선택',{types:['text']});
  ctx.execute({type:'batch',commands:texts.map(e=>({type:'update',ids:[e.id],changes:{text:removeCommas(e.text)}}))});
  ctx.toast(`COR · 문자 ${texts.length}개에서 천단위 콤마를 뺐습니다.`);
 }
 async function edp(){
  const texts=await pickMany('EDP · 소숫점 자릿수를 맞출 문자 선택',{types:['text']});
  ctx.form('EDP · 소숫점자리수 맞추기',[{name:'places',label:'소숫점 자릿수',type:'number',value:2}],async v=>{
   const places=Number(v.places);
   ctx.execute({type:'batch',commands:texts.map(e=>({type:'update',ids:[e.id],changes:{text:fixDecimalPlaces(e.text,places)}}))});
   ctx.toast(`EDP · 문자 ${texts.length}개를 소숫점 ${places}자리로 맞췄습니다.`);
  });
 }
 async function nuc(){
  const texts=await pickMany('NUC · 계산을 적용할 숫자 문자 선택',{types:['text']});
  ctx.form('NUC · 숫자에 일괄계산 적용하기',[
   {name:'operator',label:'계산방식',options:[['+','+'],['-','-'],['*','×'],['/','÷']],value:'+'},
   {name:'operand',label:'계산될 숫자',type:'number',value:1},
   {name:'negative',label:'음수(-) 고려 (끄면 "ET-454"의 "-"는 문자로 취급)',type:'checkbox',value:''},
   {name:'grouped',label:'천단위 콤마 넣기',type:'checkbox',value:''},
   {name:'decimals',label:'소숫점 자릿수(비우면 원본·입력값 중 큰 자릿수를 따름)',type:'number',value:''},
  ],async v=>{
   const operator=v.operator,operand=Number(v.operand),negativeAware=v.negative==='on',grouped=v.grouped==='on';
   const decimals=v.decimals===''||v.decimals==null?null:Number(v.decimals);
   if(!Number.isFinite(operand))throw Error('계산될 숫자를 입력하세요.');
   ctx.execute({type:'batch',commands:texts.map(e=>({type:'update',ids:[e.id],changes:{text:applyBulkCalc(e.text,{operator,operand,negativeAware,decimals,grouped})}}))});
   ctx.toast(`NUC · 문자 ${texts.length}개에 ${operator} ${operand} 계산을 적용했습니다.`);
  });
 }
 async function ina(){
  const texts=await pickMany('INA · 색인 숫자 문자 선택 (예: "W2: 23.54")',{types:['text']});
  const result=indexSums(texts.map(e=>e.text));
  const point=await ctx.pickPoint('INA · 목록 위치를 지정하세요');
  if(!point)return;
  const height=ctx.num('text-height',150);
  const rows=[`합계  ${formatNumber(result.total,2,true)}`,...result.groups.map(g=>`${g.symbol}: ${formatNumber(g.sum,2,true)}`)];
  ctx.commit({entities:listEntities(point,rows,height)});
  ctx.toast(`INA · 색인 ${result.groups.length}종 합계 목록을 만들었습니다.`);
 }
 async function lma(){
  const source=await ctx.pickEntity({prompt:'LMA · 복사할 레벨 문자를 선택하세요',types:['text']});
  if(!source)return;
  const target=await ctx.pickPoint('LMA · 복사할 위치를 지정하세요(Y 이동거리로 레벨을 자동 계산합니다)');
  if(!target)return;
  const deltaMeters=(target.y-source.position.y)/1000;
  const defaultUnit=inferDrawingLevelUnit(ctx.entities(),[source.id]);
  const parts=parseLevelParts(source.text,{defaultUnit});
  const text=formatLevelLike(parts,parts.meters+deltaMeters);
  const entity={...structuredClone(source),text,position:{x:target.x,y:target.y}};
  delete entity.id;
  ctx.commit({entities:[entity]});
  ctx.toast(`LMA · 레벨 ${text} 로 복사했습니다.${parts.bare?` · "${source.text}" 는 단위 표기가 없어 ${defaultUnit?`도면의 다른 레벨을 따라 ${defaultUnit}`:'m'} 로 보았습니다(mm 이면 FL 같은 접두어나 콤마를 붙이세요)`:''}`);
 }
 async function lna(){
  const texts=await pickMany('LNA · 일괄 변경할 레벨 문자 선택',{types:['text']});
  ctx.form('LNA · 레벨숫자 일괄 변경',[{name:'delta',label:'증감값 mm (예: +500 또는 -300)',value:'+0'}],async v=>{
   const deltaMeters=parseLevelDelta(v.delta);
   const defaultUnit=inferDrawingLevelUnit(ctx.entities());
   let bare=0;
   const commands=texts.map(e=>{const p=parseLevelParts(e.text,{defaultUnit});if(p.bare)bare++;return {type:'update',ids:[e.id],changes:{text:formatLevelLike(p,p.meters+deltaMeters)}};});
   ctx.execute({type:'batch',commands});
   ctx.toast(`LNA · 레벨 문자 ${texts.length}개를 ${v.delta}mm 만큼 바꿨습니다.${bare?` · 단위 표기 없는 문자 ${bare}개는 ${defaultUnit?`도면의 다른 레벨을 따라 ${defaultUnit}`:'m'} 로 보았습니다(mm 이면 FL 같은 접두어나 콤마를 붙이세요)`:''}`);
  });
 }
 async function mac(){
  const entities=await pickMany('MAC · 면적선으로 만들 중심선(선·폴리선) 선택',{types:['line','polyline','rectangle']});
  const loop=chainClosedLoop(entities,Math.max(1,ctx.tolerance()));
  const areaM2=G.polygonArea(loop)/1e6;
  const centroid={x:loop.reduce((s,p)=>s+p.x,0)/loop.length,y:loop.reduce((s,p)=>s+p.y,0)/loop.length};
  const height=ctx.num('text-height',150);
  ctx.commit({entities:[
   {type:'polyline',closed:true,points:loop,layer:ctx.ensureLayer('A-AREA','#6ec6ff')},
   textEntity(centroid,`${formatNumber(areaM2,2,true)} ㎡`,{height,align:'center'}),
  ]});
  ctx.toast(`MAC · 면적선 1개 생성 · ${formatNumber(areaM2,2,true)} ㎡`);
 }
 async function qd(){
  const path=await ctx.pickPath({prompt:'QD · 거리를 잴 점들을 순서대로 지정 · Enter 완료 · Esc 취소',minPoints:2,maxPoints:0});
  if(!path)return;
  const totalMm=path.points.slice(1).reduce((s,p,i)=>s+G.dist(path.points[i],p),0);
  const point=await ctx.pickPoint('QD · 결과 문자 위치를 지정하세요');
  if(!point)return;
  const text=`${formatNumber(totalMm/1000,2,true)} m`;
  ctx.commit({entities:[textEntity(point,text)]});
  ctx.toast(`QD · 총 ${text}`);
 }
 async function hv(){
  const rects=await pickMany('HV · 사각형(가로x세로) 대상 선택',{types:['rectangle','polyline']});
  const parts=rects.map(rectangleWidthHeight);
  const formula=parts.map(p=>`(${formatNumber(p.w,0,true)}x${formatNumber(p.h,0,true)})`).join('+');
  const areaM2=parts.reduce((s,p)=>s+p.area,0)/1e6;
  const point=await ctx.pickPoint('HV · 결과 문자 위치를 지정하세요');
  if(!point)return;
  const text=`${formula} = ${formatNumber(areaM2,2,true)} ㎡`;
  ctx.commit({entities:[textEntity(point,text)]});
  ctx.toast(`HV · 사각형 ${rects.length}개 합계 ${formatNumber(areaM2,2,true)} ㎡`);
 }
 async function hw(){
  let done=0;
  for(;;){
   const path=await ctx.pickPath({prompt:`HW · 삼각형 세 점을 순서대로 지정 · Esc 끝내기${done?' · 지금까지 '+done+'개':''}`,minPoints:3,maxPoints:3});
   if(!path)break;
   try{
    const m=triangleBaseHeightArea(path.points);
    const text=`(${formatNumber(m.base/1000,2)}x${formatNumber(m.height/1000,2)})/2 = ${formatNumber(m.area/1e6,2,true)} ㎡`;
    const centroid={x:(path.points[0].x+path.points[1].x+path.points[2].x)/3,y:(path.points[0].y+path.points[1].y+path.points[2].y)/3};
    ctx.commit({entities:[textEntity(centroid,text,{align:'center'})]});
    done++;ctx.toast(`HW · ${text}`);
   }catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}
  }
  if(done)ctx.toast(`HW 끝 · ${done}개 · Ctrl+Z 로 되돌리기`);
 }
 async function nd(){
  const a=await pickMany('ND · 첫번째(분자) 숫자 그룹 선택',{types:['text']});
  const b=await pickMany('ND · 두번째(분모) 숫자 그룹 선택',{types:['text']});
  const sa=sumTexts(a),sb=sumTexts(b);
  if(sb===0)throw Error('두번째 그룹의 합계가 0입니다. 나눌 수 없습니다.');
  const point=await ctx.pickPoint('ND · 결과 문자 위치를 지정하세요');
  if(!point)return;
  const text=`${formatNumber(sa,2,true)} / ${formatNumber(sb,2,true)} = ${formatNumber(sa/sb,4,true)}`;
  ctx.commit({entities:[textEntity(point,text)]});
  ctx.toast(`ND · ${text}`);
 }
 async function ns(){
  const a=await pickMany('NS · 첫번째 숫자 그룹 선택',{types:['text']});
  const b=await pickMany('NS · 뺄 숫자 그룹 선택',{types:['text']});
  const sa=sumTexts(a),sb=sumTexts(b);
  const point=await ctx.pickPoint('NS · 결과 문자 위치를 지정하세요');
  if(!point)return;
  const text=`${formatNumber(sa,2,true)} - ${formatNumber(sb,2,true)} = ${formatNumber(sa-sb,2,true)}`;
  ctx.commit({entities:[textEntity(point,text)]});
  ctx.toast(`NS · ${text}`);
 }
 async function np(){
  const exclusive=await pickMany('NP · 전용면적 그룹 선택(검산 대상)',{types:['text']});
  const allocated=await pickMany('NP · 분양면적 그룹 선택(같은 순서·개수)',{types:['text']});
  if(exclusive.length!==allocated.length)throw Error(`전용면적 ${exclusive.length}개와 분양면적 ${allocated.length}개의 개수가 다릅니다. 같은 순서·개수로 선택하세요.`);
  const exVals=exclusive.map(e=>{const n=findNumberTokens(e.text)[0];if(!n)throw Error(`숫자를 찾을 수 없는 문자가 있습니다: "${e.text}"`);return n.value;});
  const alVals=allocated.map(e=>{const n=findNumberTokens(e.text)[0];if(!n)throw Error(`숫자를 찾을 수 없는 문자가 있습니다: "${e.text}"`);return n.value;});
  const sumEx=exVals.reduce((s,v)=>s+v,0),sumAl=alVals.reduce((s,v)=>s+v,0),common=sumAl-sumEx;
  const expected=allocateShareArea(exVals,common).allocated;
  const rows=expected.map((exp,i)=>{const diff=alVals[i]-exp;return `${i+1}: 실제 ${formatNumber(alVals[i],2,true)} · 예상 ${formatNumber(exp,2,true)} · 차이 ${formatNumber(diff,3,true)}${Math.abs(diff)>0.01?' 주의':''}`;});
  ctx.log(['NP 검산 결과 · 공용면적 합계(역산) '+formatNumber(common,2,true),...rows].join('\n'));
  ctx.toast(`NP · 검산 완료 · 전용 합계 ${formatNumber(sumEx,2,true)} · 분양 합계 ${formatNumber(sumAl,2,true)} (자세한 내용은 명령창 기록 참고)`);
 }
 async function ba(){
  const units=await pickMany('BA · 전용면적 문자들을 위에서 아래 순서로 선택',{types:['text']});
  const values=units.map(e=>{const n=findNumberTokens(e.text)[0];if(!n)throw Error(`숫자를 찾을 수 없는 문자가 있습니다: "${e.text}"`);return n.value;});
  ctx.form('BA · 분양면적 배분',[
   {name:'common',label:'공용면적 합계',type:'number',value:0},
   {name:'decimals',label:'소숫점 자릿수',type:'number',value:2},
  ],async v=>{
   const commonTotal=Number(v.common),decimals=Number(v.decimals);
   if(!Number.isFinite(commonTotal)||commonTotal<0)throw Error('공용면적 합계를 0 이상으로 입력하세요.');
   if(!Number.isInteger(decimals)||decimals<0||decimals>6)throw Error('소숫점 자릿수는 0~6 사이로 입력하세요.');
   const result=allocateShareArea(values,commonTotal);
   // 대화상자가 모달이라 열려 있는 동안은 도면을 찍을 수 없다. 닫힌 뒤(0ms 뒤) 점을 받는다.
   setTimeout(()=>{(async()=>{
    try{
     const point=await ctx.pickPoint('BA · 배분 결과 목록 위치를 지정하세요');
     if(!point)return;
     const height=ctx.num('text-height',150);
     const rows=['분양면적 배분',...values.map((v0,i)=>`${i+1}  전용 ${formatNumber(v0,decimals,true)} + 배분 ${formatNumber(result.allocated[i]-v0,decimals,true)} = 분양 ${formatNumber(result.allocated[i],decimals,true)}`),
      `합계  전용 ${formatNumber(result.sumExclusive,decimals,true)} + 공용 ${formatNumber(commonTotal,decimals,true)} = 분양 ${formatNumber(result.total,decimals,true)}`];
     ctx.commit({entities:listEntities(point,rows,height)});
     ctx.toast(`BA · 전용면적 ${values.length}개 분양면적 배분을 완료했습니다.`);
    }catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}
   })();},0);
  });
 }
 async function cdn(){
  ctx.form('CDN · 일조권(정북방향) 사선 검토 · 평면',[
   {name:'base',label:'높이 제한',options:[['9','9m (구법)'],['10','10m (신법)']],value:'9'},
   {name:'review',label:'검토 높이 (m)',type:'number',value:20},
   {name:'interval',label:'검토선 높이 간격 (m)',type:'number',value:3},
   {name:'label',label:'높이 문자 표시',type:'checkbox',value:''},
  ],async v=>{
   const base=Number(v.base),review=Number(v.review),interval=Number(v.interval),showLabel=v.label==='on';
   const lines=northSlopeCheckLines(base,review,interval);
   setTimeout(()=>{(async()=>{
    try{
     const boundary=await ctx.pickPath({prompt:'CDN · 대지경계선(정북쪽) 두 점을 지정하세요',minPoints:2,maxPoints:2});
     if(!boundary)return;
     const southPoint=await ctx.pickPoint('CDN · 대지 안쪽(남쪽) 방향으로 한 점을 지정하세요');
     if(!southPoint)return;
     const [p1,p2]=boundary.points,u=G.unit(G.sub(p2,p1));
     let n=G.normal(u);
     if(G.dot(G.sub(southPoint,p1),n)<0)n=G.mul(n,-1);
     const layer=ctx.ensureLayer('A-REVIEW','#ff5a5a'),height=ctx.num('text-height',150);
     const entities=[];
     for(const item of lines){
      const d=item.offset*1000,a=G.add(p1,G.mul(n,d)),b=G.add(p2,G.mul(n,d));
      entities.push({type:'line',points:[a,b],layer});
      if(showLabel)entities.push(textEntity(G.add(a,G.mul(u,height*0.5)),`${formatNumber(item.height,item.height%1?1:0)}m`,{height}));
     }
     ctx.commit({entities});
     ctx.toast(`CDN · 검토선 ${lines.length}개 작도(${base}m 기준 · ${review}m 까지)`);
    }catch(e){console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);}
   })();},0);
  });
 }

 return {
  DEE:none('DEE','효율등급 입면적도 그리기','평면 선분을 입면 전개 좌표계로 자동 변환해 작도하는 기능'),
  CDN:guard(cdn),COI:guard(coi),COR:guard(cor),EDP:guard(edp),INA:guard(ina),LMA:guard(lma),LNA:guard(lna),
  MAC:guard(mac),NUC:guard(nuc),QD:guard(qd),BA:guard(ba),HV:guard(hv),HW:guard(hw),ND:guard(nd),NP:guard(np),NS:guard(ns),
 };
}
