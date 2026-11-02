// 일조 검토 계산(화면 없음). 3D 검토 화면의 일조 띠(review-3d.js)가 쓴다.
// · 태양 위치: NOAA 태양 위치식(균시차·적위) + 경도 + 한국 표준시(UTC+9). 대기 굴절은 넣지 않는다(고도 10° 이상에서 0.1° 미만).
// · 위치: 지적도를 넣은 도면은 drawingGeo(EPSG:5185~5188·5179 원점)로 위도·경도와 도북 보정(자오선 수렴각)을 구한다.
//   없으면 부산 시청 근처(기존 3D 기본값 35.1°)로 하고 화면에 '기본 위치'라고 적는다.
// · 일조 확보 기준: 동지 09~15시 연속 2시간 이상 또는 08~16시 총 4시간 이상(공동주택 일조 침해 판례에서 쓰는 수인한도 기준).
//   법정 일조(건축법 시행령 제86조 정북 사선)와는 다른 '실제 햇빛 시간' 검토다 — 결과 문구에 함께 적는다.
const RAD=Math.PI/180;
export const SUN_RULE=Object.freeze({continuousFrom:9,continuousTo:15,continuousMin:120,totalFrom:8,totalTo:16,totalMin:240,stepMin:10,
  text:'동지 09~15시 연속 2시간 또는 08~16시 총 4시간(공동주택 일조 수인한도 판례 기준)'});
/** A8: 일조 확보는 고른 날로 계산한다. 판례 문구(동지)를 그대로 쓰면 춘·추분·하지 결과도 동지 기준처럼 읽히므로, 계산한 날을 앞에 적는다. */
export function sunRuleText(dayLabel){
  if(!dayLabel||dayLabel==='동지')return SUN_RULE.text;
  const r=SUN_RULE,h=n=>String(n).padStart(2,'0');
  return `${dayLabel} 기준 계산 · ${h(r.continuousFrom)}~${h(r.continuousTo)}시 연속 ${r.continuousMin/60}시간 또는 ${h(r.totalFrom)}~${h(r.totalTo)}시 총 ${r.totalMin/60}시간(공동주택 일조 판례의 기준일은 동지)`;
}
export const KEY_DAYS=Object.freeze([{key:'winter',label:'동지',month:12,day:22},{key:'equinox',label:'춘·추분',month:3,day:20},{key:'summer',label:'하지',month:6,day:21}]);
import {siteAddress} from './ai-asks.js';

// 시·도 → 청사 위도·경도(일조는 위도 1° 차이에 동지 태양 고도 약 1° — 시·도 단위로 충분)
const PROVINCES=[[/^서울/,37.57,126.98,'서울'],[/^부산/,35.18,129.08,'부산'],[/^대구/,35.87,128.6,'대구'],[/^인천/,37.46,126.71,'인천'],[/^광주/,35.16,126.85,'광주'],[/^대전/,36.35,127.38,'대전'],[/^울산/,35.54,129.31,'울산'],[/^세종/,36.48,127.29,'세종'],
 [/^경기/,37.27,127.01,'경기'],[/^강원/,37.88,127.73,'강원'],[/^충(청)?북/,36.64,127.49,'충북'],[/^충(청)?남/,36.66,126.67,'충남'],[/^전(라)?북|^전북/,35.82,127.15,'전북'],[/^전(라)?남/,34.82,126.46,'전남'],
 [/^경(상)?북/,36.57,128.51,'경북'],[/^경(상)?남/,35.24,128.69,'경남'],[/^제주/,33.5,126.53,'제주']];
export const DEFAULT_SITE=Object.freeze({lat:35.1,lon:129.04,convergence:0,source:'기본 위치(부산)'});

/** 한국 시각(연·월·일·시·분)의 태양 고도·방위(°, 방위는 진북에서 시계 방향). */
export function sunPosition({year=new Date().getFullYear(),month,day,hour,minute=0},{lat,lon}){
  const utc=Date.UTC(year,month-1,day,hour-9,minute),start=Date.UTC(year,0,1),dayOfYear=Math.floor((utc-start)/86400000)+1;
  const utcHour=new Date(utc).getUTCHours()+new Date(utc).getUTCMinutes()/60,leap=(year%4===0&&year%100!==0)||year%400===0;
  const g=2*Math.PI/(leap?366:365)*(dayOfYear-1+(utcHour-12)/24);
  const eqtime=229.18*(0.000075+0.001868*Math.cos(g)-0.032077*Math.sin(g)-0.014615*Math.cos(2*g)-0.040849*Math.sin(2*g));
  const decl=0.006918-0.399912*Math.cos(g)+0.070257*Math.sin(g)-0.006758*Math.cos(2*g)+0.000907*Math.sin(2*g)-0.002697*Math.cos(3*g)+0.00148*Math.sin(3*g);
  const trueSolarMin=utcHour*60+eqtime+4*lon,ha=(trueSolarMin/4-180)*RAD,phi=lat*RAD;
  const cosZ=Math.min(1,Math.max(-1,Math.sin(phi)*Math.sin(decl)+Math.cos(phi)*Math.cos(decl)*Math.cos(ha)));
  const azimuth=((Math.atan2(Math.sin(ha),Math.cos(ha)*Math.sin(phi)-Math.tan(decl)*Math.cos(phi))/RAD+180)%360+360)%360;
  return {altitude:90-Math.acos(cosZ)/RAD,azimuth,declination:decl/RAD,equationOfTime:eqtime};
}

// 한국 평면직각좌표(GRS80, 횡메르카토르) 역변환. 도면은 도북(좌표 y) 기준이라 진북과의 각(수렴각)도 같이 낸다.
const TM={'EPSG:5185':{lon0:125,k0:1,fe:200000,fn:600000},'EPSG:5186':{lon0:127,k0:1,fe:200000,fn:600000},'EPSG:5187':{lon0:129,k0:1,fe:200000,fn:600000},
  'EPSG:5188':{lon0:131,k0:1,fe:200000,fn:600000},'EPSG:5179':{lon0:127.5,k0:0.9996,fe:1000000,fn:2000000}};
export function gridToLatLon(crs,east,north){
  const p=TM[crs];if(!p||!Number.isFinite(east)||!Number.isFinite(north))return null;
  const a=6378137,f=1/298.257222101,e2=f*(2-f),e4=e2*e2,e6=e4*e2,ep2=e2/(1-e2),lat0=38*RAD;
  const M=phi=>a*((1-e2/4-3*e4/64-5*e6/256)*phi-(3*e2/8+3*e4/32+45*e6/1024)*Math.sin(2*phi)+(15*e4/256+45*e6/1024)*Math.sin(4*phi)-(35*e6/3072)*Math.sin(6*phi));
  const mu=(M(lat0)+(north-p.fn)/p.k0)/(a*(1-e2/4-3*e4/64-5*e6/256)),e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
  const phi1=mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)+(21*e1**2/16-55*e1**4/32)*Math.sin(4*mu)+(151*e1**3/96)*Math.sin(6*mu)+(1097*e1**4/512)*Math.sin(8*mu);
  const s=Math.sin(phi1),c=Math.cos(phi1),C1=ep2*c*c,T1=Math.tan(phi1)**2,N1=a/Math.sqrt(1-e2*s*s),R1=a*(1-e2)/(1-e2*s*s)**1.5,D=(east-p.fe)/(N1*p.k0);
  const lat=phi1-(N1*Math.tan(phi1)/R1)*(D*D/2-(5+3*T1+10*C1-4*C1*C1-9*ep2)*D**4/24+(61+90*T1+298*C1+45*T1*T1-252*ep2-3*C1*C1)*D**6/720);
  const lon=p.lon0*RAD+(D-(1+2*T1+C1)*D**3/6+(5-2*C1+28*T1-3*C1*C1+8*ep2+24*T1*T1)*D**5/120)/c;
  return {lat:lat/RAD,lon:lon/RAD,convergence:(lon/RAD-p.lon0)*Math.sin(lat)};
}

/** 도면의 위치: drawingGeo(원점 m) + 모델 중심(도면 mm). 없으면 기본 위치. */
export function siteOf(doc,centerMm={x:0,y:0}){
  const geo=doc?.drawingGeo,o=geo?.originM;
  if(Array.isArray(o)&&o.length===2){const r=gridToLatLon(geo.crs,o[0]+centerMm.x/1000,o[1]+centerMm.y/1000);if(r&&Number.isFinite(r.lat))return {...r,source:`지적도 위치(${geo.crs})`};}
  const a=siteAddress(doc).address.replace(/\s+/g,''),hit=a&&PROVINCES.find(([re])=>re.test(a));
  if(hit)return {lat:hit[1],lon:hit[2],convergence:0,province:hit[3],source:`대지 주소(${hit[3]}) 대략 위치`};   // shortcut: 시·도 청사 위치 — 지적도로 불러오면 정확한 자리
  return {...DEFAULT_SITE};
}

/** 도면(도북) 기준 방위: 진북 방위에서 수렴각을 뺀다. */
export const gridAzimuth=(azimuth,site)=>((azimuth-(site.convergence||0))%360+360)%360;

/** 하루 일조 계산에 쓸 시각 목록(08:00~16:00, 10분 간격 = 49개). */
export function sampleTimes(rule=SUN_RULE){const out=[];for(let m=rule.totalFrom*60;m<=rule.totalTo*60;m+=rule.stepMin)out.push(m);return out;}

/** 한 점의 시각별 햇빛 여부(sampleTimes 순서) → 연속·총 일조 분과 판정. 표본 하나 = stepMin 분. */
export function sunlightVerdict(lit,rule=SUN_RULE,times=sampleTimes(rule)){
  let run=0,best=0,total=0;
  for(let i=0;i<times.length;i++){
    const t=times[i],on=!!lit[i];
    if(t<rule.totalTo*60&&on)total+=rule.stepMin;
    const inContinuous=t>=rule.continuousFrom*60&&t<rule.continuousTo*60;
    if(inContinuous&&on){run+=rule.stepMin;if(run>best)best=run;}else if(inContinuous)run=0;
  }
  return {continuous:best,total,ok:best>=rule.continuousMin||total>=rule.totalMin};
}

/** 칸별 판정 모음 → 요약(충족 비율). cells: sunlightVerdict 결과 배열(바깥 칸은 null). */
export function summarizeSunlight(cells){
  const used=cells.filter(Boolean),ok=used.filter(c=>c.ok).length;
  return {cells:used.length,ok,ratio:used.length?ok/used.length:0};
}

export const pad2=n=>String(n).padStart(2,'0');
export const clock=minutes=>`${pad2(Math.floor(minutes/60))}:${pad2(minutes%60)}`;
