// 보조명령 카드 15개(자르기·끌기 / 도형·선 / 멀티도구 / 면적·계산 혼합):
//   FR CB DMD PVS MM OAA OC RR SS ABC DM SPN AHM SAR SCA.
// 근거 원문(izzarder.com, 2026-09-21 WebFetch 로 직접 확인): FR /439, CB /414, DMD /167, PVS /131, MM /324,
//   OC /417, RR /114, SS /435, ABC /391, DM /444, SPN /463, AHM /504, SAR /170, SCA /442.
//   OAA 는 전용 원문 글이 없어(WebSearch 로도 없음) OA(/451) 의 [객체 각도에 맞추어 회전] 항목과
//   카탈로그 라벨("객체를 다른 객체각도에 정렬")을 근거로 옮겼다 — 보고서에 그대로 적었다.
// SAR 대화상자·구적표 서식과 AHM 직각표시는 원문 첨부 그림(/170 7장, /504 2장)을 내려받아 보고 옮겼다.
// 순수 계산은 export 된 함수로 두어 node --test 가 DOM 없이 돈다. 화면 흐름(pick·form)은 installEditCalcTools(ctx) 안에만 둔다.
import * as G from './geometry.js';
import {triangulatePolygon} from './area-takeoff.js';

const P=(x,y)=>({x,y});
export const PY_PER_M2=121/400;

/* ── 공통: 숫자 서식 ── */
export function formatNumber(value,decimals=3,comma=false){
 if(!Number.isFinite(value))throw Error('표시할 수 없는 숫자입니다.');
 const d=Math.max(0,Math.min(6,Math.round(decimals)));
 return (Object.is(value,-0)?0:value).toLocaleString('ko-KR',{useGrouping:!!comma,minimumFractionDigits:d,maximumFractionDigits:d});
}
/** 올림방식: 'round'(반올림) 'ceil'(올림) 'floor'(내림) */
export function roundTo(value,decimals=3,mode='round'){
 if(!Number.isFinite(value))throw Error('계산 결과가 숫자가 아닙니다.');
 const d=Math.max(0,Math.min(6,Math.round(decimals))),f=10**d;
 const fn=mode==='ceil'?Math.ceil:mode==='floor'?Math.floor:Math.round;
 return fn(value*f+(mode==='round'?Number.EPSILON*Math.abs(value)*f:0))/f;
}
/** "1,234.5" 같은 도면 문자에서 숫자 하나를 읽는다. 없으면 null. */
export function readNumber(text){
 const s=String(text??'').trim().replaceAll('−','-').replaceAll(',','');
 const m=s.match(/-?\d+(?:\.\d+)?/);
 if(!m)return null;
 if(!/^-?\d+(?:\.\d+)?$/.test(s))return null;
 const n=Number(m[0]);return Number.isFinite(n)?n:null;
}

/* ── 공통: 객체에서 점·각도 읽기 ── */
export function entityAnchor(e){
 if(!e)throw Error('객체를 선택하세요.');
 if(e.position)return {x:e.position.x,y:e.position.y};
 if(e.center)return {x:e.center.x,y:e.center.y};
 if(Array.isArray(e.points)&&e.points.length)return {x:e.points[0].x,y:e.points[0].y};
 const b=G.bounds([e]);
 if(!b)throw Error('기준점을 읽을 수 없는 객체입니다.');
 return P((b.minX+b.maxX)/2,(b.minY+b.maxY)/2);
}
/** 객체의 "각도"(도). 선·폴리선은 첫 구간, 문자는 회전각, 호는 시작→끝 현(弦). */
export function entityAngle(e){
 if(!e)throw Error('각도를 읽을 객체를 선택하세요.');
 if(e.type==='text')return G.normalizeAngle(e.rotation||0);
 if(e.type==='arc')return G.normalizeAngle(G.angle(G.sub(G.add(e.center,G.polar(e.radius,e.endAngle)),G.add(e.center,G.polar(e.radius,e.startAngle)))));
 const ss=G.segments(e);
 if(ss.length&&G.dist(...ss[0])>G.EPS)return G.normalizeAngle(G.angle(G.sub(ss[0][1],ss[0][0])));
 throw Error('각도를 읽을 수 있는 객체(선·폴리선·문자·호)를 선택하세요.');
}
/** 선형 객체를 선분 목록으로 바꾼다(원·호는 잘게 나눈다). */
export function curveSegments(e,samples=720){
 if(!e)throw Error('객체를 선택하세요.');
 if(e.type==='circle'||e.type==='arc'){
  const start=e.type==='arc'?e.startAngle:0,sweep=e.type==='arc'?G.normalizeAngle(e.endAngle-e.startAngle)||360:360;
  const n=Math.max(8,Math.round(samples*sweep/360)),out=[];
  let prev=G.add(e.center,G.polar(e.radius,start));
  for(let i=1;i<=n;i++){const p=G.add(e.center,G.polar(e.radius,start+sweep*i/n));out.push([prev,p]);prev=p;}
  return out;
 }
 const ss=G.segments(e);
 if(ss.length)return ss;
 const vs=G.vertices(e);
 if(vs.length<2)throw Error('거리를 잴 수 있는 객체를 선택하세요.');
 return vs.map((p,i)=>[p,vs[(i+1)%vs.length]]);
}
export function closestOnSegment(p,a,b){
 const v=G.sub(b,a),dd=G.dot(v,v);
 if(dd<G.EPS)return {x:a.x,y:a.y};
 const t=Math.max(0,Math.min(1,G.dot(G.sub(p,a),v)/dd));
 return G.add(a,G.mul(v,t));
}
export function segmentPairMinimum(a1,a2,b1,b2){
 const hit=G.lineIntersection(a1,a2,b1,b2);
 if(hit&&hit.t>=0&&hit.t<=1&&hit.u>=0&&hit.u<=1)return {a:hit.point,b:hit.point,distance:0};
 let best=null;
 for(const [p,q1,q2,swap] of [[a1,b1,b2,false],[a2,b1,b2,false],[b1,a1,a2,true],[b2,a1,a2,true]]){
  const c=closestOnSegment(p,q1,q2),d=G.dist(p,c);
  if(!best||d<best.distance)best={a:swap?c:p,b:swap?p:c,distance:d};
 }
 return best;
}
/** DMD(/167): 두 객체 사이 최단 거리와 그 두 점. 원(circle)은 중심 투영으로 정확히 구한다. */
export function minimumDistancePair(first,second){
 if(first?.type==='circle'&&second?.type!=='circle'){const r=minimumDistancePair(second,first);return {a:r.b,b:r.a,distance:r.distance};}
 if(second?.type==='circle'){
  const c=second.center;
  let near=null;
  for(const [p,q] of curveSegments(first)){const cp=closestOnSegment(c,p,q),d=G.dist(c,cp);if(!near||d<near.distance)near={point:cp,distance:d};}
  if(!near)throw Error('거리를 잴 수 있는 객체를 선택하세요.');
  if(near.distance<G.EPS)return {a:near.point,b:G.add(c,P(second.radius,0)),distance:second.radius};
  const onCircle=G.add(c,G.mul(G.unit(G.sub(near.point,c)),second.radius));
  return {a:near.point,b:onCircle,distance:Math.abs(near.distance-second.radius)};
 }
 const A=curveSegments(first),B=curveSegments(second);
 let best=null;
 for(const [a1,a2] of A)for(const [b1,b2] of B){
  const m=segmentPairMinimum(a1,a2,b1,b2);
  if(!best||m.distance<best.distance)best=m;
 }
 if(!best)throw Error('거리를 잴 수 있는 객체를 선택하세요.');
 return best;
}

/* ── FR(/439): 여러 선 Fillet Radius ── */
/** 폴리선 한 개의 모서리 전체에 반지름을 적용한다. 바른 CAD 폴리선에는 bulge 가 없어 "잘린 폴리선 + 호"로 돌려준다. */
export function filletPolyline(points,closed,radius){
 if(!Array.isArray(points)||points.length<3)throw Error('모서리가 있는 폴리선을 선택하세요.');
 if(!Number.isFinite(radius)||radius<=0)throw Error('반지름은 양수여야 합니다.');
 const n=points.length,arcs=[],out=[];
 const corners=closed?points.map((_,i)=>i):points.map((_,i)=>i).slice(1,-1);
 if(!closed)out.push({...points[0]});
 for(const i of corners){
  const cur=points[i],prev=points[(i-1+n)%n],next=points[(i+1)%n];
  const lp=G.dist(prev,cur),ln=G.dist(cur,next);
  if(lp<G.EPS||ln<G.EPS){out.push({...cur});continue;}
  const u=G.unit(G.sub(prev,cur)),v=G.unit(G.sub(next,cur));
  const theta=Math.acos(Math.max(-1,Math.min(1,G.dot(u,v))));
  if(theta<1e-6||Math.abs(theta-Math.PI)<1e-6){out.push({...cur});continue;}
  const d=radius/Math.tan(theta/2);
  if(d>lp/2+1e-9||d>ln/2+1e-9)throw Error(`반지름 ${radius} 이 모서리(${i+1}번)의 이웃 선보다 큽니다. 반지름을 줄이세요.`);
  const t1=G.add(cur,G.mul(u,d)),t2=G.add(cur,G.mul(v,d));
  const center=G.add(cur,G.mul(G.unit(G.add(u,v)),radius/Math.sin(theta/2)));
  const s=G.angle(G.sub(t1,center)),e=G.angle(G.sub(t2,center));
  arcs.push({type:'arc',center,radius,startAngle:G.normalizeAngle(e-s)<=180?s:e,endAngle:G.normalizeAngle(e-s)<=180?e:s});
  out.push(t1,t2);
 }
 if(!closed)out.push({...points.at(-1)});
 return {points:out,arcs};
}
/** 여러 선을 고른 순서대로 이어가며 필렛(또는 모따기)한다. FR 은 반지름을 카드 설정에만 저장한다(FILLETRAD 오염 없음). */
export function filletLineChain(lines,radius,chamfer=false){
 if(!Array.isArray(lines)||lines.length<2)throw Error('선을 두 개 이상 선택하세요.');
 if(lines.some(l=>l.type!=='line'))throw Error('여러 선 방식은 직선만 지원합니다. 폴리선은 한 개만 선택하세요.');
 const updates=[],extras=[];
 let current={...lines[0]};
 for(let i=1;i<lines.length;i++){
  const parts=G.corner(current,lines[i],radius,chamfer);
  updates.push({id:current.id,points:parts[0].points});
  current={...lines[i],points:parts[1].points};
  if(parts[2])extras.push({...parts[2],layer:lines[i].layer});
 }
 updates.push({id:current.id,points:current.points});
 return {updates,extras};
}

/* ── CB(/414): 원 자르기 ── */
/** 원을 두 점(또는 점 없이 사등분)으로 끊어 같은 켜의 호로 바꾼다. */
export function breakCircleArcs(circle,picks=[]){
 if(!circle||circle.type!=='circle')throw Error('원(circle)을 선택하세요.');
 const angles=picks.length?picks.map(p=>G.normalizeAngle(G.angle(G.sub(p,circle.center)))):[0,90,180,270];
 if(picks.length&&picks.length!==2)throw Error('원 위의 두 점을 지정하거나, 점 없이 Esc 로 사등분하세요.');
 const sorted=[...angles].sort((a,b)=>a-b);
 for(let i=0;i<sorted.length;i++)if(G.normalizeAngle(sorted[(i+1)%sorted.length]-sorted[i])<1e-6)throw Error('서로 다른 두 점을 지정하세요.');
 const base={layer:circle.layer,color:circle.color,linetype:circle.linetype,lineweight:circle.lineweight};
 return sorted.map((a,i)=>({...base,type:'arc',center:{...circle.center},radius:circle.radius,startAngle:a,endAngle:sorted[(i+1)%sorted.length]}));
}

/* ── PVS(/131): 폴리선 모양 변경 ── */
/** 폴리선 위(또는 근처)의 한 점이 몇 번째 구간의 어디에 붙는지. */
export function nearestParamOnPath(points,closed,p){
 const ss=G.segments({points,closed,type:'polyline'});
 if(!ss.length)throw Error('구간이 있는 폴리선이 필요합니다.');
 let best=null;
 ss.forEach(([a,b],index)=>{
  const v=G.sub(b,a),dd=G.dot(v,v);
  const t=dd<G.EPS?0:Math.max(0,Math.min(1,G.dot(G.sub(p,a),v)/dd));
  const point=G.add(a,G.mul(v,t)),distance=G.dist(p,point);
  if(!best||distance<best.distance)best={index,t,point,distance,param:index+t};
 });
 return best;
}
/** 스케치한 점열로 폴리선의 한 구간을 통째로 치환한다. 기존 정점을 정확히 찍지 않아도 된다(/131). */
export function replacePolylineSection(points,closed,sketch){
 if(!Array.isArray(points)||points.length<2)throw Error('폴리선을 선택하세요.');
 if(!Array.isArray(sketch)||sketch.length<2)throw Error('새 모양을 두 점 이상 그리세요.');
 let start=nearestParamOnPath(points,closed,sketch[0]),end=nearestParamOnPath(points,closed,sketch.at(-1)),shape=sketch;
 if(!closed&&start.param>end.param){[start,end]=[end,start];shape=[...sketch].reverse();}
 const clean=list=>{const out=[];for(const p of list)if(!out.length||G.dist(out.at(-1),p)>1e-6)out.push({x:p.x,y:p.y});return out;};
 if(!closed){
  const head=points.slice(0,Math.floor(start.param)+1),tail=points.slice(Math.ceil(end.param));
  const out=clean([...head,...shape,...tail]);
  if(out.length<2)throw Error('치환 결과 정점이 모자랍니다. 구간을 다시 지정하세요.');
  return out;
 }
 const n=points.length,keep=[];
 const i0=Math.ceil(end.param)%n,i1=Math.floor(start.param)%n;
 const span=Math.min(n,(((i1-i0)%n)+n)%n+1);
 for(let k=0;k<span;k++)keep.push(points[(i0+k)%n]);
 const out=clean([...shape,...keep]);
 if(out.length<3)throw Error('치환 결과 정점이 모자랍니다. 구간을 다시 지정하세요.');
 return out;
}

/* ── MM(/324): 블럭배열(Measure) ── */
export function pathTotalLength(points,closed){
 return G.segments({points,closed,type:'polyline'}).reduce((s,[a,b])=>s+G.dist(a,b),0);
}
export function pointAtPathLength(points,closed,distance){
 const ss=G.segments({points,closed,type:'polyline'});
 let left=distance;
 for(const [a,b] of ss){
  const l=G.dist(a,b);
  if(l<G.EPS)continue;
  if(left<=l+1e-9){const u=G.unit(G.sub(b,a));return {point:G.add(a,G.mul(u,Math.max(0,left))),angle:G.angle(u)};}
  left-=l;
 }
 const [a,b]=ss.at(-1),u=G.unit(G.sub(b,a));
 return {point:{...b},angle:G.angle(u)};
}
/** 간격마다 놓을 자리. startOffset 이 null 이면 원문대로 "(전체거리 - 간격×배치개수)/2" 로 가운데 정렬한다. */
export function measureAlongPath(points,closed,spacing,startOffset=null){
 if(!Number.isFinite(spacing)||spacing<=0)throw Error('배열 간격은 양수여야 합니다.');
 const total=pathTotalLength(points,closed);
 if(total<spacing)throw Error(`선 전체 길이(${total.toFixed(1)})가 간격(${spacing})보다 짧습니다.`);
 const count=Math.floor(total/spacing+1e-9);
 const offset=startOffset===null||startOffset===undefined?(total-spacing*count)/2:Number(startOffset);
 if(!Number.isFinite(offset)||offset<0)throw Error('시작점에서 첫 객체까지의 거리는 0 이상이어야 합니다.');
 const spots=[];
 for(let d=offset;d<=total+1e-6;d+=spacing)spots.push({...pointAtPathLength(points,closed,Math.min(d,total)),distance:Math.min(d,total)});
 return {total,spacing,offset,spots};
}

/* ── OC(/417): 간격띄우고 연결 ── */
/** 원본 점열과 옵셋 점열의 양 끝을 이어 닫힌 폴리선 점열로 만든다. */
export function offsetAndClosePoints(basePoints,offsetPoints){
 if(!Array.isArray(basePoints)||basePoints.length<2)throw Error('선·호·열린 폴리선을 선택하세요.');
 if(!Array.isArray(offsetPoints)||offsetPoints.length<2)throw Error('옵셋 결과를 만들 수 없습니다.');
 const out=[...basePoints.map(p=>({x:p.x,y:p.y})),...[...offsetPoints].reverse().map(p=>({x:p.x,y:p.y}))];
 const clean=[];
 for(const p of out)if(!clean.length||G.dist(clean.at(-1),p)>1e-6)clean.push(p);
 if(G.dist(clean[0],clean.at(-1))<=1e-6)clean.pop();
 if(clean.length<3)throw Error('닫힌 모양을 만들 수 없습니다. 옵셋 거리를 바꿔보세요.');
 return clean;
}
/** 호를 폴리선 점열로 편다(바른 CAD 폴리선에 bulge 가 없어서). */
export function arcToPoints(arc,stepDegrees=5){
 const sweep=G.normalizeAngle(arc.endAngle-arc.startAngle)||360;
 const n=Math.max(2,Math.ceil(sweep/stepDegrees));
 return Array.from({length:n+1},(_,i)=>G.add(arc.center,G.polar(arc.radius,arc.startAngle+sweep*i/n)));
}

/* ── RR(/114): 참조 회전 ── */
/** 참조 두 점이 이루는 각과 기준점→목표점 각의 차이(도). */
export function rotationFromReference(base,refA,refB,target){
 const reference=G.angle(G.sub(refB,refA)),goal=G.angle(G.sub(target,base));
 const d=G.normalizeAngle(goal-reference);
 return d>180?d-360:d;
}

/* ── SS(/435): 연속 크기변경(배율 기억) ── */
export function readRememberedScale(storage,key='barun.card.SS',fallback=1){
 try{const v=Number(JSON.parse(storage?.getItem(key)??'null')?.factor);return Number.isFinite(v)&&v>0?v:fallback;}catch{return fallback;}
}
export function rememberScale(storage,value,key='barun.card.SS'){
 if(!Number.isFinite(value)||value<=0)throw Error('배율은 0보다 커야 합니다.');
 try{storage?.setItem(key,JSON.stringify({factor:value}));}catch{}
 return value;
}

/* ── ABC(/391): 여러 숫자 연산 ── */
/** 정렬 순서: 'topDown'(상→하) 은 같은 행(오차 안)끼리 좌→우, 'leftRight'(좌→우) 는 같은 열끼리 상→하. */
export function sortNumberGroup(items,order='topDown',tolerance=10){
 const t=Math.max(0,Number(tolerance)||0);
 return [...items].sort((a,b)=>{
  const ap=entityAnchor(a),bp=entityAnchor(b);
  if(order==='leftRight'){
   if(Math.abs(ap.x-bp.x)>t)return ap.x-bp.x;
   return bp.y-ap.y;
  }
  if(Math.abs(ap.y-bp.y)>t)return bp.y-ap.y;
  return ap.x-bp.x;
 });
}
export function pairNumberGroups(groupA,groupB,{order='topDown',tolerance=10}={}){
 if(!groupA?.length)throw Error('첫 번째 숫자 묶음을 선택하세요.');
 if(!groupB?.length)throw Error('두 번째 숫자 묶음을 선택하세요.');
 const a=sortNumberGroup(groupA,order,tolerance),b=sortNumberGroup(groupB,order,tolerance);
 if(b.length!==1&&b.length!==a.length)throw Error(`두 묶음의 개수가 다릅니다 (${a.length} vs ${b.length}). 두 번째는 같은 개수이거나 한 개여야 합니다.`);
 return a.map((item,i)=>[item,b.length===1?b[0]:b[i]]);
}
export function abcResults(pairs,operator='+',{decimals=3,rounding='round'}={}){
 if(!['+','-','*','/'].includes(operator))throw Error('연산방법을 고르세요.');
 return pairs.map(([left,right],index)=>{
  const a=readNumber(left.text),b=readNumber(right.text);
  if(a===null||b===null)throw Error(`${index+1}번째 쌍에 숫자가 아닌 문자가 있습니다.`);
  if(operator==='/'&&b===0)throw Error(`${index+1}번째 쌍에서 0으로 나눌 수 없습니다.`);
  const raw=operator==='+'?a+b:operator==='-'?a-b:operator==='*'?a*b:a/b;
  return {left,right,a,b,value:roundTo(raw,decimals,rounding)};
 });
}

/* ── DM(/444): 폴리선 거리를 메모리로 ── */
/** 정점 간 구간 거리 목록(엑셀 붙여넣기용 줄바꿈 문자열). */
export function vertexDistanceRows(points,closed,{unit='m',decimals=3}={}){
 if(!Array.isArray(points)||points.length<2)throw Error('정점이 두 개 이상인 폴리선·선을 선택하세요.');
 const div=unit==='mm'?1:1000;
 const ss=G.segments({points,closed,type:'polyline'});
 const rows=ss.map(([a,b])=>G.dist(a,b)/div);
 return {rows,total:rows.reduce((s,v)=>s+v,0),text:rows.map(v=>formatNumber(v,decimals,false)).join('\n')};
}

/* ── SPN(/463): 기호문자별 개수 합산 ── */
/** 숫자 문자마다 가장 가까운 기호 문자를 찾아 짝짓고, 기호별로 합산한다. */
export function sumPairedSymbols(texts,{real=true,decimals=3}={}){
 const items=(texts||[]).filter(e=>e&&e.type==='text');
 if(items.length<2)throw Error('기호 문자와 숫자 문자를 함께 선택하세요.');
 const numbers=[],symbols=[];
 for(const e of items)(readNumber(e.text)===null?symbols:numbers).push(e);
 if(!symbols.length)throw Error('기호로 쓸 문자(숫자가 아닌 문자)가 없습니다.');
 if(!numbers.length)throw Error('합산할 숫자 문자가 없습니다.');
 const totals=new Map();
 for(const n of numbers){
  const np=entityAnchor(n);
  let near=null;
  for(const s of symbols){const d=G.dist(np,entityAnchor(s));if(!near||d<near.distance)near={symbol:s,distance:d};}
  const key=String(near.symbol.text).trim(),value=readNumber(n.text);
  const cur=totals.get(key)||{symbol:key,sum:0,count:0};
  cur.sum+=value;cur.count+=1;totals.set(key,cur);
 }
 return [...totals.values()].map(row=>({...row,sum:real?roundTo(row.sum,decimals,'round'):Math.round(row.sum)}))
  .sort((a,b)=>a.symbol.localeCompare(b.symbol,'ko'));
}

/* ── AHM(/504) · SAR(/170): 구적 ── */
export function perpendicularFoot(a,b,p){
 const v=G.sub(b,a),dd=G.dot(v,v);
 if(dd<G.EPS)throw Error('밑변의 두 점이 같습니다.');
 return G.add(a,G.mul(v,G.dot(G.sub(p,a),v)/dd));
}
/** 밑변 두 점과 꼭지점으로 높이선·직각표시 기호를 만든다(/504 그림). 기호는 긴 쪽 밑변 방향에 놓는다. */
export function rightAngleMark(baseA,baseB,apex,size){
 if(!Number.isFinite(size)||size<=0)throw Error('직각표시 크기는 양수여야 합니다.');
 const foot=perpendicularFoot(baseA,baseB,apex);
 const h=G.dist(foot,apex);
 if(h<G.EPS)throw Error('꼭지점이 밑변 위에 있습니다. 다른 꼭지점을 지정하세요.');
 const toApex=G.unit(G.sub(apex,foot));
 const far=G.dist(foot,baseA)>=G.dist(foot,baseB)?baseA:baseB;
 const along=G.dist(foot,far)<G.EPS?G.unit(G.sub(baseB,baseA)):G.unit(G.sub(far,foot));
 const s=Math.min(size,h*0.9,Math.max(G.dist(foot,far)*0.9,G.EPS));
 return {foot,height:h,base:G.dist(baseA,baseB),area:G.dist(baseA,baseB)*h/2,
  heightLine:[{...apex},{...foot}],
  mark:[G.add(foot,G.mul(along,s)),G.add(G.add(foot,G.mul(along,s)),G.mul(toApex,s)),G.add(foot,G.mul(toApex,s))]};
}
/** 삼각형 한 개의 구적 행: 가장 긴 변을 밑변으로 본다(/170 그림의 "밑변 X 높이 / 2"). */
export function triangleTakeoff(triangle){
 const edges=triangle.map((p,i)=>({a:p,b:triangle[(i+1)%3],length:G.dist(p,triangle[(i+1)%3])})).sort((x,y)=>y.length-x.length);
 const base=edges[0],apex=triangle.find(p=>G.dist(p,base.a)>G.EPS&&G.dist(p,base.b)>G.EPS);
 const mark=rightAngleMark(base.a,base.b,apex,Math.max(base.length,1)*0.06);
 return {kind:'triangle',baseA:base.a,baseB:base.b,apex,base:base.length,height:mark.height,area:base.length*mark.height/2,
  centroid:P((triangle[0].x+triangle[1].x+triangle[2].x)/3,(triangle[0].y+triangle[1].y+triangle[2].y)/3)};
}
/** 사각구적: 네 모서리가 모두 직각(사각오차 이내)인지 보고 가로×세로로 잰다. 아니면 null(삼각구적으로 전환). */
export function quadTakeoff(points,squareTolerance=0.1){
 if(!Array.isArray(points)||points.length!==4)return null;
 const angles=points.map((p,i)=>{
  const prev=points[(i+3)%4],next=points[(i+1)%4];
  const u=G.sub(prev,p),v=G.sub(next,p);
  if(G.len(u)<G.EPS||G.len(v)<G.EPS)return NaN;
  return Math.acos(Math.max(-1,Math.min(1,G.dot(u,v)/(G.len(u)*G.len(v)))))*180/Math.PI;
 });
 if(angles.some(a=>!Number.isFinite(a)||Math.abs(a-90)>squareTolerance))return null;
 const w=G.dist(points[0],points[1]),h=G.dist(points[1],points[2]);
 return {kind:'quad',width:w,height:h,area:w*h,
  centroid:P(points.reduce((s,p)=>s+p.x,0)/4,points.reduce((s,p)=>s+p.y,0)/4)};
}
/** 정렬기준(시작 정점 모서리)에 맞춰 경계 정점 순서를 돌린다. */
export function orderBoundaryVertices(points,startCorner='topLeft',clockwise=false){
 const b=G.bounds([{type:'polyline',closed:true,points}]);
 const anchor={topLeft:P(b.minX,b.maxY),topRight:P(b.maxX,b.maxY),bottomLeft:P(b.minX,b.minY),bottomRight:P(b.maxX,b.minY)}[startCorner]||P(b.minX,b.maxY);
 let at=0,best=Infinity;
 points.forEach((p,i)=>{const d=G.dist(p,anchor);if(d<best){best=d;at=i;}});
 const signed=points.reduce((s,p,i)=>s+G.cross(p,points[(i+1)%points.length]),0);
 let out=[...points.slice(at),...points.slice(0,at)];
 if((signed<0)!==!!clockwise)out=[out[0],...out.slice(1).reverse()];
 return out;
}
/** 진행방향: 'Z'(가로, 행마다 좌→우) 'S'(가로, 행마다 우→좌) 'N'(세로, 열마다 상→하) 'NR'(세로, 열마다 하→상) */
export function orderShapes(shapes,direction='Z',tolerance=10){
 const t=Math.max(0,Number(tolerance)||0);
 return [...shapes].sort((a,b)=>{
  const ap=a.centroid,bp=b.centroid;
  if(direction==='N'||direction==='NR'){
   if(Math.abs(ap.x-bp.x)>t)return ap.x-bp.x;
   return direction==='N'?bp.y-ap.y:ap.y-bp.y;
  }
  if(Math.abs(ap.y-bp.y)>t)return bp.y-ap.y;
  return direction==='S'?bp.x-ap.x:ap.x-bp.x;
 });
}
/** 구적표 행(원문 /170 그림: 구분 | 산출근거 | 면적(㎡) | 면적(평), 마지막 합계 행). */
export function siteAreaRows(shapes,{startNumber=1,decimals=3,comma=true,py=true}={}){
 if(!shapes?.length)throw Error('구적할 도형이 없습니다.');
 const rows=shapes.map((s,i)=>{
  const m2=s.area/1e6;
  const basis=s.kind==='cad'?'CAD 구적':s.kind==='quad'
   ?`${formatNumber(s.width/1000,decimals,false)} X ${formatNumber(s.height/1000,decimals,false)}`
   :`${formatNumber(s.base/1000,decimals,false)} X ${formatNumber(s.height/1000,decimals,false)} / 2`;
  return {no:startNumber+i,basis,areaM2:m2,cells:[String(startNumber+i),basis,formatNumber(m2,decimals,comma),'']};
 });
 const total=rows.reduce((s,r)=>s+r.areaM2,0);
 rows.push({no:null,basis:'',areaM2:total,total:true,
  cells:['합계','',formatNumber(total,decimals,comma),py?formatNumber(total*PY_PER_M2,decimals,comma):'']});
 return {rows,total,totalPy:total*PY_PER_M2};
}
/** 구적표를 선·문자 객체로 작도한다. origin 은 표의 좌상단(제목 아래). */
export function areaTableEntities(table,origin,{title='대지구적표',textHeight=900,lineLayer,textLayer,unit='m²'}={}){
 const h=Math.max(1,textHeight),row=h*1.8,cols=[h*2.6,h*10,h*4.4,h*4.4];
 const width=cols.reduce((s,v)=>s+v,0),head=['구분','산출근거',`면적(${unit})`,'면적(평)'];
 const body=[head,...table.rows.map(r=>r.cells)],entities=[];
 const top=origin.y,left=origin.x,bottom=top-row*body.length;
 entities.push({type:'text',position:P(left,top+row*0.6),text:title,height:h*1.2,rotation:0,align:'left',layer:textLayer});
 for(let r=0;r<=body.length;r++)entities.push({type:'line',points:[P(left,top-row*r),P(left+width,top-row*r)],layer:lineLayer});
 let x=left;
 for(let c=0;c<=cols.length;c++){entities.push({type:'line',points:[P(x,top),P(x,bottom)],layer:lineLayer});x+=cols[c]??0;}
 body.forEach((cells,r)=>{
  let cx=left;
  cells.forEach((text,c)=>{
   if(text!=='')entities.push({type:'text',position:P(cx+cols[c]/2,top-row*r-row*0.68),text:String(text),height:h,rotation:0,align:'center',layer:textLayer});
   cx+=cols[c];
  });
 });
 return entities;
}

/* ── SCA(/442): 면적 확대하기 ── */
/** 목표 면적 / 현재 면적 의 제곱근이 배율이다. unit 은 'm2' 또는 'mm2'. */
export const SCA_FACTOR_LIMIT=1000;// m→mm 단위 환산(1000배)까지 허용(검토자 지적 8). 10배 이상은 카드에서 한 번 더 확인한다.
export const SCA_CONFIRM_FACTOR=10;
export function areaScaleFactor(currentAreaMm2,targetArea,unit='m2'){
 if(!Number.isFinite(currentAreaMm2)||currentAreaMm2<=0)throw Error('현재 면적을 구할 수 없습니다. 닫힌 경계선을 선택하세요.');
 if(!Number.isFinite(targetArea)||targetArea<=0)throw Error('실제 대지 면적은 양수여야 합니다.');
 const target=unit==='mm2'?targetArea:targetArea*1e6;
 const factor=Math.sqrt(target/currentAreaMm2);
 // 2026-09-24 검토 F9: 목표 1e15 m² 같은 값이 그대로 배율 1,800만 배로 들어가던 문제. 단위 환산(m→mm 1000배)까지만 허용한다.
 if(factor>SCA_FACTOR_LIMIT||factor<1/SCA_FACTOR_LIMIT)throw Error(`배율이 ${factor>1?Math.round(factor):factor.toExponential(2)}배가 됩니다. 실제 대지 면적과 단위(m²/mm²)를 확인하세요(허용 배율 1/${SCA_FACTOR_LIMIT}~${SCA_FACTOR_LIMIT}).`);
 return factor;
}
export function closedAreaOf(entity){
 if(!entity)throw Error('대지 경계선을 선택하세요.');
 if(entity.type==='circle')return Math.PI*entity.radius**2;
 const pts=entity.points;
 if(!Array.isArray(pts)||pts.length<3)throw Error('닫힌 폴리선·사각형을 선택하세요.');
 return G.polygonArea(pts);
}

/* ══════════════════════════════════════════════════════════════════════════ */
export function installEditCalcTools(ctx){
 const fail=e=>{console.error('[card]',e);ctx.toast(ctx.userErrorMessage(e),true);};
 const guard=fn=>async(...a)=>{try{await fn(...a);}catch(e){fail(e);}};
 const L=(name,color)=>ctx.ensureLayer(name,color);
 const TEXT=()=>L('A-TEXT','#ffffff'),SYMB=()=>L('A-SYM','#ff9f68'),AREA=()=>L('A-AREA','#b995ff'),TTLB=()=>L('A-TITLE','#7fd1e0');
 const textHeight=()=>ctx.num('text-height',150);
 const settings=(key,def)=>{try{return {...def,...JSON.parse(ctx.storage?.getItem(key)??'{}')};}catch{return {...def};}};
 const saveSettings=(key,value)=>{try{ctx.storage?.setItem(key,JSON.stringify(value));}catch{}};
 /** check(values) 가 던지면 폼이 열린 채 그 문구를 보여 준다(폼이 잡는다). */
 const askForm=(title,fields,check=null)=>new Promise((resolve,reject)=>{
  ctx.form(title,fields,async values=>{if(check)check(values);try{resolve(values);}catch(e){reject(e);}});
 });
 /** 선택된 객체를 쓰거나, 없으면 Esc 까지 반복해 클릭으로 모은다. */
 async function collect(prompt,{types=null,filter=null}={}){
  const ok=e=>(!types||types.includes(e.type))&&(!filter||filter(e));
  const pre=ctx.selected().filter(ok);
  if(pre.length)return pre;
  const list=[];
  for(;;){
   const e=await ctx.pickEntity({prompt:`${prompt} · Esc: 선택 마침${list.length?` · 지금까지 ${list.length}개`:''}`,...(types?{types}:{})});
   if(!e)break;
   if(!ok(e)){ctx.toast('이 명령이 다룰 수 있는 객체가 아닙니다.',true);continue;}
   if(!list.some(x=>x.id===e.id))list.push(e);
  }
  if(!list.length)throw Error('선택한 객체가 없습니다.');
  return list;
 }
 const textOf=(position,text,{height=textHeight(),align='left',layer}={})=>({type:'text',position,text:String(text),height,rotation:0,align,layer:layer||TEXT()});

 /* ── FR: 여러 선 Fillet Radius (/439) ── */
 const fr=async()=>{
  const targets=await collect('FR · 필렛할 폴리선 1개 또는 선 여러 개 선택',{types:['polyline','rectangle','line']});
  const saved=settings('barun.card.FR',{radius:300});
  const v=await askForm('FR · 여러 선 Fillet Radius',[
   {name:'radius',label:'반지름 (mm) · 이 값은 이 카드에만 저장되고 기본 FILLET 설정을 바꾸지 않습니다',type:'number',value:saved.radius},
   {name:'chamfer',label:'모따기(챔퍼)로 처리 · 원문 FR 은 필렛만 하지만 같은 입력으로 쓸 수 있게 두었습니다',type:'checkbox',value:''}]);
  const radius=Number(v.radius),chamfer=v.chamfer==='on';
  if(!Number.isFinite(radius)||radius<=0)throw Error('반지름은 양수여야 합니다.');
  saveSettings('barun.card.FR',{radius});
  if(targets.length===1&&targets[0].type!=='line'){
   const e=targets[0],closed=e.type==='rectangle'||!!e.closed;
   const {points,arcs}=filletPolyline(e.points,closed,radius);
   const extras=chamfer?[]:arcs.map(a=>({...a,layer:e.layer}));
   const shape={...e,type:'polyline',closed,points};
   delete shape.id;
   ctx.commit({removeIds:[e.id],entities:[shape,...extras]});
   ctx.toast(`FR · 폴리선 모서리 ${arcs.length}곳을 반지름 ${radius} 로 정리했습니다 · Ctrl+Z 로 되돌리기`);
   return;
  }
  const {updates,extras}=filletLineChain(targets,radius,chamfer);
  ctx.execute({type:'batch',commands:[
   ...updates.map(u=>({type:'update',ids:[u.id],changes:{points:u.points}})),
   ...(extras.length?[{type:'addMany',entities:extras}]:[])]});
  ctx.refresh();
  ctx.toast(`FR · 선 ${targets.length}개를 순서대로 ${chamfer?'모따기':'필렛'}(${radius}) 했습니다 · Ctrl+Z 로 되돌리기`);
 };

 /* ── CB: 원 자르기 (/414) ── */
 const cb=async()=>{
  const circle=await ctx.pickEntity({prompt:'CB · 자를 원을 선택하세요 · Esc 취소',types:['circle']});
  if(!circle)return;
  const picks=[];
  for(let i=0;i<2;i++){
   const p=await ctx.pickPoint(`CB · 원 위의 ${i+1}번째 점 · Esc(첫 점에서): 사등분`);
   if(!p)break;
   picks.push(p);
  }
  if(picks.length===1)throw Error('두 점을 모두 지정하거나, 첫 점에서 Esc 를 눌러 사등분하세요.');
  const arcs=breakCircleArcs(circle,picks);
  ctx.commit({removeIds:[circle.id],entities:arcs});
  ctx.toast(`CB · 원을 같은 켜의 호 ${arcs.length}개로 나눴습니다 · Ctrl+Z 로 되돌리기`);
 };

 /* ── DMD: 가장 가까운 거리 표시 (/167) ── */
 const dmd=async()=>{
  const a=await ctx.pickEntity({prompt:'DMD · 첫 번째 객체를 선택하세요 · Esc 취소'});
  if(!a)return;
  const b=await ctx.pickEntity({prompt:'DMD · 두 번째 객체를 선택하세요 · Esc 취소'});
  if(!b)return;
  if(a.id===b.id)throw Error('서로 다른 두 객체를 선택하세요.');
  const near=minimumDistancePair(a,b);
  if(near.distance<1e-6)throw Error('두 객체가 서로 닿아 있어 최단거리 선을 그릴 수 없습니다.');
  ctx.commit({entities:[{type:'line',points:[near.a,near.b],layer:SYMB()}]});
  ctx.toast(`DMD · 최단거리 ${formatNumber(near.distance,1,true)} mm 에 선을 그렸습니다 · Ctrl+Z 로 되돌리기`);
 };

 /* ── PVS: 폴리선 모양 변경 (/131) ── */
 const pvs=async()=>{
  const e=await ctx.pickEntity({prompt:'PVS · 모양을 바꿀 폴리선을 선택하세요 · Esc 취소',types:['polyline','rectangle']});
  if(!e)return;
  const closed=e.type==='rectangle'||!!e.closed;
  const path=await ctx.pickPath({prompt:'PVS · 바꿀 구간의 새 모양을 그리세요(정점을 정확히 찍지 않아도 됩니다) · Enter 완료 · Esc 취소',minPoints:2});
  if(!path)return;
  const points=replacePolylineSection(e.points,closed,path.points);
  const shape={...e,type:'polyline',closed,points};
  delete shape.id;
  ctx.commit({removeIds:[e.id],entities:[shape]});
  ctx.toast(`PVS · 폴리선 구간을 새 모양(정점 ${path.points.length}개)으로 바꿨습니다 · Ctrl+Z 로 되돌리기`);
 };

 /* ── MM: 블럭배열(Measure) (/324) ── */
 const mm=async()=>{
  const path=await ctx.pickEntity({prompt:'MM · 나눌 선(선·폴리선)을 선택하세요 · Esc 취소',types:['line','polyline','rectangle']});
  if(!path)return;
  const closed=path.type==='rectangle'||!!path.closed;
  const total=pathTotalLength(path.points,closed);
  const block=await ctx.pickEntity({prompt:`MM · 배열할 기준 블럭을 선택하세요 · Esc: 블럭 없이 가상선으로 배열 · 선 전체 길이 ${formatNumber(total,1,true)}`,types:['block']});
  const saved=settings('barun.card.MM',{spacing:900,markLength:300});
  const v=await askForm(`MM · 블럭배열(Measure) · 선 전체 길이 ${formatNumber(total,1,true)}`,[
   {name:'spacing',label:'배열 간격 (mm)',type:'number',value:saved.spacing},
   {name:'offset',label:'시작점에서 첫 객체까지 거리 (빈 값: 시작·끝 등간격 / 0: 시작점에 붙임)',type:'text',value:''},
   ...(block?[]:[{name:'markLength',label:'가상선 길이 (mm) · 원문에 없는 항목이라 바른 CAD 에서 더한 값입니다',type:'number',value:saved.markLength}])]);
  const spacing=Number(v.spacing);
  const raw=String(v.offset??'').trim();
  const offset=raw===''?null:Number(raw);
  const markLength=block?0:Number(v.markLength);
  saveSettings('barun.card.MM',{spacing,markLength:markLength||saved.markLength});
  const plan=measureAlongPath(path.points,closed,spacing,offset);
  const entities=plan.spots.map(spot=>{
   if(block)return {...structuredClone(block),id:undefined,position:{...spot.point},rotation:spot.angle};
   const n=G.polar(markLength/2,spot.angle+90);
   return {type:'line',points:[G.sub(spot.point,n),G.add(spot.point,n)],layer:path.layer};
  }).map(e=>{const c={...e};delete c.id;return c;});
  ctx.commit({entities});
  ctx.toast(`MM · ${block?'블럭':'가상선'} ${entities.length}개를 간격 ${spacing} (시작 ${formatNumber(plan.offset,1,false)}) 로 배열했습니다 · Ctrl+Z 로 되돌리기`);
 };

 /* ── OAA: 객체를 다른 객체 각도에 정렬 (전용 원문 없음 · OA /451 의 [객체 각도에 맞추어 회전]) ── */
 const oaa=async()=>{
  const reference=await ctx.pickEntity({prompt:'OAA · 각도를 가져올 기준 객체를 선택하세요 · Esc 취소'});
  if(!reference)return;
  const goal=entityAngle(reference);
  const targets=(await collect('OAA · 그 각도에 맞출 객체 선택')).filter(e=>e.id!==reference.id);
  if(!targets.length)throw Error('기준 객체 말고 맞출 객체를 선택하세요.');
  const commands=targets.map(e=>{
   const turn=G.normalizeAngle(goal-entityAngle(e));
   const rotated=G.rotate(e,entityAnchor(e),turn>180?turn-360:turn);
   const {id,type,...changes}=rotated;
   return {type:'update',ids:[e.id],changes};
  });
  ctx.execute({type:'batch',commands});
  ctx.refresh();
  ctx.toast(`OAA · 객체 ${targets.length}개를 기준 객체 각도 ${formatNumber(goal,1,false)}° 로 돌렸습니다 · Ctrl+Z 로 되돌리기`);
 };

 /* ── OC: 간격띄우고 연결 (/417) ── */
 const oc=async()=>{
  const e=await ctx.pickEntity({prompt:'OC · 옵셋할 폴리선·선·호를 선택하세요 · Esc 취소',types:['polyline','line','arc']});
  if(!e)return;
  if(e.type==='polyline'&&e.closed)throw Error('열린 폴리선·선·호만 이어 닫을 수 있습니다.');
  const saved=settings('barun.card.OC',{distance:100});
  const v=await askForm('OC · 간격띄우고 연결',[{name:'distance',label:'옵셋 거리 (mm)',type:'number',value:saved.distance}]);
  const distance=Number(v.distance);
  if(!Number.isFinite(distance)||distance<=0)throw Error('옵셋 거리는 양수여야 합니다.');
  saveSettings('barun.card.OC',{distance});
  const side=await ctx.pickPoint('OC · 옵셋할 쪽을 클릭하세요 · Esc 취소');
  if(!side)return;
  const basePoints=e.type==='arc'?arcToPoints(e):e.points;
  const offsetShape=G.offsetEntity(e,distance,side);
  const offsetPoints=e.type==='arc'?arcToPoints(offsetShape):offsetShape.points;
  const points=offsetAndClosePoints(basePoints,offsetPoints);
  ctx.commit({removeIds:[e.id],entities:[{type:'polyline',closed:true,points,layer:e.layer,color:e.color,linetype:e.linetype}]});
  ctx.toast(`OC · 옵셋(${distance}) 결과를 원본과 이어 닫힌 폴리선(정점 ${points.length})으로 만들었습니다 · Ctrl+Z 로 되돌리기`);
 };

 /* ── RR: 참조 회전 (/114) ── */
 const rr=async()=>{
  const targets=await collect('RR · 회전할 객체 선택');
  const base=await ctx.pickPoint('RR · 회전 기준점을 지정하세요 · Esc 취소');
  if(!base)return;
  const refA=await ctx.pickPoint('RR · 참조각의 첫 점을 지정하세요(다른 객체 위여도 됩니다) · Esc 취소');
  if(!refA)return;
  const refB=await ctx.pickPoint('RR · 참조각의 둘째 점을 지정하세요 · Esc 취소');
  if(!refB)return;
  const target=await ctx.pickPoint('RR · 목표각이 될 점을 지정하세요 · Esc 취소');
  if(!target)return;
  const degrees=rotationFromReference(base,refA,refB,target);
  const commands=targets.map(e=>{const {id,type,...changes}=G.rotate(e,base,degrees);return {type:'update',ids:[e.id],changes};});
  ctx.execute({type:'batch',commands});
  ctx.refresh();
  ctx.toast(`RR · 참조각 ${formatNumber(G.normalizeAngle(G.angle(G.sub(refB,refA))),1,false)}° 기준으로 ${formatNumber(degrees,1,false)}° 돌렸습니다 · Ctrl+Z 로 되돌리기`);
 };

 /* ── SS: 연속 크기변경 (/435) ── */
 const ss=async()=>{
  const targets=await collect('SS · 크기를 바꿀 객체 선택');
  const remembered=readRememberedScale(ctx.storage);
  const v=await askForm('SS · 연속 크기변경',[{name:'factor',label:`배율 (직전 값 ${remembered} 이 기본값으로 제시됩니다)`,type:'number',value:remembered}]);
  const factor=Number(v.factor);
  if(!Number.isFinite(factor)||factor<=0)throw Error('배율은 0보다 커야 합니다.');
  rememberScale(ctx.storage,factor);
  const base=await ctx.pickPoint('SS · 크기변경 기준점을 지정하세요 · Esc 취소');
  if(!base)return;
  const commands=targets.map(e=>{const {id,type,...changes}=G.resize(e,base,factor);return {type:'update',ids:[e.id],changes};});
  ctx.execute({type:'batch',commands});
  ctx.refresh();
  ctx.toast(`SS · 객체 ${targets.length}개를 배율 ${factor} 로 바꿨습니다. 다음 실행부터 이 배율이 기본값입니다 · Ctrl+Z 로 되돌리기`);
 };

 /* ── ABC: 여러 숫자 연산 (/391) ── */
 const abc=async()=>{
  const saved=settings('barun.card.ABC',{operator:'+',decimals:3,rounding:'round',order:'topDown',tolerance:10,follow:'',recycle:'on'});
  const v=await askForm('ABC · 여러 숫자 연산',[
   {name:'operator',label:'연산방법',value:saved.operator,options:[['+','+'],['-','-'],['*','×'],['/','÷']]},
   {name:'decimals',label:'소수점 자릿수',type:'number',value:saved.decimals},
   {name:'rounding',label:'올림방식',value:saved.rounding,options:[['round','반올림'],['ceil','올림'],['floor','내림']]},
   {name:'order',label:'정렬 순서',value:saved.order,options:[['topDown','상→하'],['leftRight','좌→우']]},
   {name:'tolerance',label:'오차 (mm)',type:'number',value:saved.tolerance},
   {name:'follow',label:'결과 문자를 첫 번째 선택 객체의 켜로 (끄면 A-TEXT)',type:'checkbox',value:saved.follow},
   {name:'recycle',label:'입력 후 재순환',type:'checkbox',value:saved.recycle}]);
  const opt={operator:v.operator,decimals:Number(v.decimals),rounding:v.rounding,order:v.order,tolerance:Number(v.tolerance),follow:v.follow,recycle:v.recycle};
  saveSettings('barun.card.ABC',opt);
  do{
   const groupA=await collect('ABC · 첫 번째 숫자 묶음 선택',{types:['text'],filter:e=>readNumber(e.text)!==null});
   ctx.setSelected([]);
   const groupB=await collect('ABC · 두 번째 숫자 묶음(또는 숫자 하나) 선택',{types:['text'],filter:e=>readNumber(e.text)!==null});
   ctx.setSelected([]);
   const pairs=pairNumberGroups(groupA,groupB,{order:opt.order,tolerance:opt.tolerance});
   const results=abcResults(pairs,opt.operator,{decimals:opt.decimals,rounding:opt.rounding});
   const at=await ctx.pickPoint('ABC · 결과를 놓을 위치를 지정하세요 · Esc 취소');
   if(!at)return;
   const h=results[0].left.height||textHeight();
   const entities=results.map(r=>{
    const anchor=entityAnchor(r.left);
    const position=opt.order==='leftRight'?P(anchor.x,at.y):P(at.x,anchor.y);
    return textOf(position,formatNumber(r.value,opt.decimals,false),{height:h,align:'left',layer:opt.follow==='on'?r.left.layer:TEXT()});
   });
   ctx.commit({entities});
   ctx.toast(`ABC · ${results.length}쌍을 "${opt.operator}" 로 계산해 기록했습니다 · Ctrl+Z 로 되돌리기`);
  }while(opt.recycle==='on'&&await ctx.pickPoint('ABC · 재순환: 다음 계산을 하려면 아무 곳이나 클릭 · Esc: 끝내기'));
 };

 /* ── DM: 폴리선 거리를 메모리로 (/444) ── */
 const dm=async()=>{
  const e=await ctx.pickEntity({prompt:'DM · 거리를 뽑을 폴리선·선을 선택하세요 · Esc 취소',types:['polyline','rectangle','line']});
  if(!e)return;
  const saved=settings('barun.card.DM',{unit:'m',decimals:3});
  const v=await askForm('DM · 폴리선 거리를 메모리로',[
   {name:'unit',label:'단위',value:saved.unit,options:[['m','m'],['mm','mm']]},
   {name:'decimals',label:'소숫점 자릿수',type:'number',value:saved.decimals}]);
  const opt={unit:v.unit,decimals:Number(v.decimals)};
  saveSettings('barun.card.DM',opt);
  const closed=e.type==='rectangle'||!!e.closed;
  const {rows,total,text}=vertexDistanceRows(e.points,closed,opt);
  try{
   await navigator.clipboard.writeText(text);
   ctx.log(`DM · 정점 간 거리 ${rows.length}개를 클립보드로 복사했습니다 (합계 ${formatNumber(total,opt.decimals,true)} ${opt.unit}).`);
   ctx.toast(`DM · 구간 거리 ${rows.length}개를 클립보드로 복사했습니다. 엑셀에 바로 붙여넣으세요.`);
  }catch{
   const at=await ctx.pickPoint('DM · 클립보드를 쓸 수 없습니다. 목록을 놓을 위치를 지정하세요 · Esc 취소');
   if(!at)throw Error('클립보드를 쓸 수 없어 복사하지 못했습니다.');
   const h=textHeight();
   ctx.commit({entities:text.split('\n').map((line,i)=>textOf(P(at.x,at.y-i*h*1.8),line,{height:h}))});
   ctx.toast(`DM · 클립보드를 쓸 수 없어 구간 거리 ${rows.length}개를 도면에 적었습니다 · Ctrl+Z 로 되돌리기`);
  }
 };

 /* ── SPN: 기호문자별 개수 합산 (/463) ── */
 const spn=async()=>{
  const saved=settings('barun.card.SPN',{real:'on',decimals:3});
  const v=await askForm('SPN · 기호문자별 개수 합산',[
   {name:'real',label:'실수 계산 (끄면 정수로 합산)',type:'checkbox',value:saved.real},
   {name:'decimals',label:'소숫점 자릿수',type:'number',value:saved.decimals}]);
  const opt={real:v.real==='on',decimals:Number(v.decimals)};
  saveSettings('barun.card.SPN',{real:v.real,decimals:opt.decimals});
  const texts=await collect('SPN · 계산 대상 문자(기호+숫자 쌍)를 모두 선택',{types:['text']});
  const rows=sumPairedSymbols(texts,opt);
  const lines=rows.map(r=>`${r.symbol} = ${formatNumber(r.sum,opt.decimals,true)}  (${r.count}쌍)`);
  ctx.log(`SPN · 기호별 합계 — ${lines.join(' / ')}`);
  ctx.toast(`SPN · 기호 ${rows.length}종 합산: ${lines.slice(0,3).join(' / ')}${rows.length>3?' …':''}`);
  const at=await ctx.pickPoint('SPN · 합산 목록을 도면에 적을 위치 지정 · Esc: 적지 않고 끝내기');
  if(!at)return;
  const h=textHeight();
  ctx.commit({entities:lines.map((line,i)=>textOf(P(at.x,at.y-i*h*1.8),line,{height:h}))});
  ctx.toast(`SPN · 기호별 합계 ${rows.length}줄을 적었습니다 · Ctrl+Z 로 되돌리기`);
 };

 /* ── SAR / AHM 공통 설정 (AHM 은 SAR 설정을 상속한다 · /504) ── */
 const SAR_KEY='barun.card.SAR';
 const SAR_DEFAULT={shape:'quadAuto',startNumber:1,title:'대지구적표',unit:'m²',decimals:3,
  textSize:3,lineScale:300,circleSize:2.5,rightSize:3,squareTolerance:0.1,
  startCorner:'topLeft',direction:'Z',tolerance:10,eraseBoundary:'on',py:'on',comma:'on'};
 const sarSettings=()=>settings(SAR_KEY,SAR_DEFAULT);
 const sarFields=s=>[
  {name:'shape',label:'구적형태',value:s.shape,options:[['triangle','삼각구적'],['quadAuto','사각:자동'],['quadManual','사각:수동']]},
  {name:'startNumber',label:'시작번호',type:'number',value:s.startNumber},
  {name:'title',label:'표제목',value:s.title},
  {name:'unit',label:'단위',value:s.unit,options:[['m²','m²'],['mm²','mm²']]},
  {name:'decimals',label:'소수점 자릿수',type:'number',value:s.decimals},
  {name:'textSize',label:'문자크기',type:'number',value:s.textSize},
  {name:'lineScale',label:'x 선축척 (실제 문자높이 = 문자크기 × 선축척)',type:'number',value:s.lineScale},
  {name:'circleSize',label:'원크기 (정점·번호 표시)',type:'number',value:s.circleSize},
  {name:'rightSize',label:'직각크기 (삼각구적 전용)',type:'number',value:s.rightSize},
  {name:'squareTolerance',label:'사각오차 (도) · 이보다 틀어진 네모는 삼각구적으로 바뀝니다',type:'number',value:s.squareTolerance},
  {name:'startCorner',label:'정렬기준 (번호를 매기기 시작할 모서리)',value:s.startCorner,options:[['topLeft','좌상'],['topRight','우상'],['bottomLeft','좌하'],['bottomRight','우하']]},
  {name:'direction',label:'진행방향',value:s.direction,options:[['Z','가로 Z(행마다 좌→우)'],['S','가로 S(행마다 우→좌)'],['N','세로 N(열마다 상→하)'],['NR','세로 역N(열마다 하→상)']]},
  {name:'tolerance',label:'오차 (mm) · 같은 행/열로 볼 허용치',type:'number',value:s.tolerance},
  {name:'eraseBoundary',label:'생성된 경계선 삭제 (끄면 도형켜에 경계선 사본을 함께 작도)',type:'checkbox',value:s.eraseBoundary},
  {name:'py',label:'평 표현',type:'checkbox',value:s.py},
  {name:'comma',label:'천단위 콤마',type:'checkbox',value:s.comma}];
 const readSar=v=>{
  const s={shape:v.shape,startNumber:Math.round(Number(v.startNumber))||1,title:String(v.title||'대지구적표'),unit:v.unit,
   decimals:Number(v.decimals),textSize:Number(v.textSize),lineScale:Number(v.lineScale),circleSize:Number(v.circleSize),
   rightSize:Number(v.rightSize),squareTolerance:Number(v.squareTolerance),startCorner:v.startCorner,direction:v.direction,
   tolerance:Number(v.tolerance),eraseBoundary:v.eraseBoundary,py:v.py,comma:v.comma};
  // 2026-09-24 검토 F9: 문자크기·선축척 0 이 조용히 대체값으로 그려지던 문제.
  const positive=(key,label,max)=>{const n=s[key];if(!Number.isFinite(n)||n<=0)throw Error(`${label} 값은 0보다 큰 숫자로 입력하세요.`);if(n>max)throw Error(`${label} 값은 ${max} 이하로 입력하세요.`);};
  positive('textSize','문자크기',10000);positive('lineScale','선축척',10000);positive('circleSize','원크기',10000);positive('rightSize','직각크기',10000);
  if(s.textSize*s.lineScale>100000)throw Error('실제 문자높이(문자크기 × 선축척)가 100,000 mm 를 넘습니다. 값을 확인하세요.');
  if(!Number.isInteger(s.decimals)||s.decimals<0||s.decimals>6)throw Error('소수점 자릿수는 0~6 사이의 정수로 입력하세요.');
  if(!Number.isFinite(s.tolerance)||s.tolerance<0)throw Error('오차(mm)는 0 이상으로 입력하세요.');
  if(!Number.isFinite(s.squareTolerance)||s.squareTolerance<0||s.squareTolerance>45)throw Error('사각오차(도)는 0~45 사이로 입력하세요.');
  return s;
 };
 const numberCircle=(centroid,label,s,layer,textLayer)=>{
  const r=Math.max(1,s.circleSize*s.lineScale)/2;
  return [{type:'circle',center:{...centroid},radius:r,layer},
   textOf(P(centroid.x,centroid.y-r*0.45),label,{height:r*0.9,align:'center',layer:textLayer})];
 };

 /* ── SAR: 부지 구적표 그리기 (/170) ── */
 const sar=async()=>{
  const v=await askForm('SAR · 구적도 작성',sarFields(sarSettings()),readSar);
  const s=readSar(v);
  saveSettings(SAR_KEY,s);
  const height=Math.max(1,s.textSize*s.lineScale);
  const picked=await collect('SAR · 대지경계선(삼각구적) 또는 폴리선(사각구적, 여러 개 가능) 선택',
   {types:['polyline','rectangle','circle'],filter:e=>e.type==='circle'||e.type==='rectangle'||e.closed});
  const shapes=[];
  const shapeLayer=AREA(),tableLayer=TTLB(),labelLayer=TEXT();
  for(const e of picked){
   if(e.type==='circle'){shapes.push({kind:'cad',area:closedAreaOf(e),centroid:{...e.center}});continue;}
   const ordered=orderBoundaryVertices(e.points,s.startCorner,false);
   const quad=s.shape==='triangle'?null:quadTakeoff(ordered,s.squareTolerance);
   if(quad){shapes.push(quad);continue;}
   for(const triangle of triangulatePolygon(ordered)){
    shapes.push(triangleTakeoff(triangle));
   }
  }
  if(!shapes.length)throw Error('구적할 도형이 없습니다.');
  const ordered=orderShapes(shapes,s.direction,s.tolerance);
  const table=siteAreaRows(ordered,{startNumber:s.startNumber,decimals:s.decimals,comma:s.comma==='on',py:s.py==='on'});
  const at=await ctx.pickPoint('SAR · 구적표를 놓을 위치(좌상단)를 지정하세요 · Esc 취소');
  if(!at)return;
  const entities=areaTableEntities(table,at,{title:s.title,textHeight:height,lineLayer:tableLayer,textLayer:labelLayer,unit:s.unit});
  ordered.forEach((shape,i)=>{
   const label=String(s.startNumber+i);
   entities.push(...numberCircle(shape.centroid,label,s,shapeLayer,labelLayer));
   if(shape.kind!=='triangle')return;
   const mark=rightAngleMark(shape.baseA,shape.baseB,shape.apex,Math.max(1,s.rightSize*s.lineScale));
   entities.push({type:'line',points:mark.heightLine,layer:shapeLayer,color:'#ff6bd6'});
   entities.push({type:'polyline',closed:false,points:mark.mark,layer:shapeLayer,color:'#9aa4ad'});
   entities.push({type:'line',points:[{...shape.baseA},{...shape.baseB}],layer:shapeLayer,color:'#ff6bd6'});
  });
  if(s.eraseBoundary!=='on')for(const e of picked)if(e.points)entities.push({type:'polyline',closed:true,points:e.points.map(p=>({...p})),layer:shapeLayer});
  ctx.commit({entities});
  ctx.toast(`SAR · ${s.title} · ${table.rows.length-1}행 · 합계 ${formatNumber(table.total,s.decimals,s.comma==='on')} ${s.unit}${s.py==='on'?` (${formatNumber(table.totalPy,s.decimals,s.comma==='on')} 평)`:''} · Ctrl+Z 로 되돌리기`);
 };

 /* ── AHM: 구적삼각 직각표시(수동) (/504) ── */
 const ahm=async()=>{
  const s=sarSettings();
  const a=await ctx.pickPoint('AHM · 밑변의 첫 점을 지정하세요(순서 무관) · Esc 취소');
  if(!a)return;
  const b=await ctx.pickPoint('AHM · 밑변의 둘째 점을 지정하세요 · Esc 취소');
  if(!b)return;
  const apex=await ctx.pickPoint('AHM · 꼭지점을 지정하세요 · Esc 취소');
  if(!apex)return;
  const mark=rightAngleMark(a,b,apex,Math.max(1,s.rightSize*s.lineScale));
  const shapeLayer=AREA(),labelLayer=TEXT();
  const entities=[
   {type:'line',points:mark.heightLine,layer:shapeLayer,color:'#ff6bd6'},
   {type:'polyline',closed:false,points:mark.mark,layer:shapeLayer,color:'#9aa4ad'}];
  const centroid=P((a.x+b.x+apex.x)/3,(a.y+b.y+apex.y)/3);
  entities.push(...numberCircle(centroid,String(s.startNumber),s,shapeLayer,labelLayer));
  if(s.eraseBoundary!=='on')entities.push({type:'polyline',closed:true,points:[{...a},{...b},{...apex}],layer:shapeLayer});
  ctx.commit({entities});
  saveSettings(SAR_KEY,{...s,startNumber:(Math.round(Number(s.startNumber))||1)+1});
  ctx.toast(`AHM · 직각표시를 그렸습니다 (밑변 ${formatNumber(mark.base/1000,s.decimals,false)} × 높이 ${formatNumber(mark.height/1000,s.decimals,false)}). 색·크기는 SAR 설정을 따릅니다 · Ctrl+Z 로 되돌리기`);
 };

 /* ── SCA: 면적 확대하기 (/442) ── */
 const sca=async()=>{
  const boundary=await ctx.pickEntity({prompt:'SCA · 대지 경계선(닫힌 폴리선·사각형·원)을 선택하세요 · Esc 취소',types:['polyline','rectangle','circle']});
  if(!boundary)return;
  const current=closedAreaOf(boundary);
  const saved=settings('barun.card.SCA',{unit:'m2'});
  const v=await askForm(`SCA · 면적 확대하기 · 현재 면적 ${formatNumber(current/1e6,3,true)} m²`,[
   {name:'unit',label:'단위',value:saved.unit,options:[['m2','m²'],['mm2','mm²']]},
   {name:'target',label:'실제 대지 면적',type:'number',value:''}],f=>areaScaleFactor(current,Number(f.target),f.unit));
  const factor=areaScaleFactor(current,Number(v.target),v.unit);
  if(factor>=SCA_CONFIRM_FACTOR||factor<=1/SCA_CONFIRM_FACTOR){
   const ok=await askForm(`SCA · 배율 ${formatNumber(factor,3,false)}배 — 단위 환산 수준의 큰 배율입니다`,[
    {name:'confirm',label:`현재 ${formatNumber(current/1e6,3,true)} m² → 목표 ${v.target} ${v.unit==='mm2'?'mm²':'m²'} 로 ${formatNumber(factor,3,false)}배 확대/축소합니다. 확인`,type:'checkbox',value:''}]);
   if(ok.confirm!=='on'){ctx.toast('SCA · 취소했습니다(확인 체크 안 함).');return;}
  }
  saveSettings('barun.card.SCA',{unit:v.unit});
  const extra=ctx.selected().filter(e=>e.id!==boundary.id);
  const targets=[boundary,...extra];
  const base=await ctx.pickPoint('SCA · 크기변경 기준점을 지정하세요 · Esc: 경계선 바운딩박스 좌하단');
  const box=G.bounds([boundary]);
  const origin=base||P(box.minX,box.minY);
  const commands=targets.map(e=>{const {id,type,...changes}=G.resize(e,origin,factor);return {type:'update',ids:[e.id],changes};});
  ctx.execute({type:'batch',commands});
  ctx.refresh();
  ctx.toast(`SCA · 배율 ${formatNumber(factor,6,false)} 로 객체 ${targets.length}개를 조정했습니다(목표 ${v.target} ${v.unit==='mm2'?'mm²':'m²'}) · Ctrl+Z 로 되돌리기`);
 };

 return {FR:guard(fr),CB:guard(cb),DMD:guard(dmd),PVS:guard(pvs),MM:guard(mm),OAA:guard(oaa),OC:guard(oc),
  RR:guard(rr),SS:guard(ss),ABC:guard(abc),DM:guard(dm),SPN:guard(spn),AHM:guard(ahm),SAR:guard(sar),SCA:guard(sca)};
}
