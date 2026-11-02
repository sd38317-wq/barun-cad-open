// 풍하중 개략 검토(화면 없음). AI 도구 cad_wind_check 와 3D 그림이 쓴다.
// 근거(2026-10-16 원문 확인):
//  · KDS 41 12 00:2022 건축물 설계하중 5.5 — 속도압 q = ½·ρ·V², ρ = 1.225 kg/m³, 설계풍속 V = V₀·K_D·K_zr·K_zt·I_w,
//    표 5.5-2·5.5-3 풍속고도분포계수, 표 5.5-5 중요도계수, 5.5.3 풍향계수(자료 없으면 1.0), 5.5.5 평탄지 지형계수 1.0.
//  · 같은 기준 5.15 간편법 표 5.15-1 저층건축구조물설계용 외압계수, 주골조 풍압 최소 675 N/m².
//  · 지역별 기본풍속: LH 건축공사 표준상세 DA-93-005-1 '지역별 기본풍속(2)'(국토교통부 고시 제2016-317호 표).
//    KDS 원문은 그림 5.5-1(지도, 등풍속선 사이는 큰 값)이므로 결과에 지도 대조를 권한다.
// 한계: 가스트영향계수(5.6)·내압계수(5.7.2)는 넣지 않는다(개략). 값을 주면 곱한다. 구조 설계는 구조기술사가 한다.
export const WIND_SOURCE=Object.freeze({
 code:'KDS 41 12 00:2022 건축물 설계하중 5장 풍하중(5.5 속도압·5.15 간편법 외압계수)',
 basicWind:'LH 표준상세 DA-93-005-1 지역별 기본풍속(국토교통부 고시 제2016-317호) — KDS 그림 5.5-1 지도와 대조 권장',
 limits:'개략 검토: 가스트영향계수·내압계수 미반영(값을 주면 곱함), 평탄지(K_zt=1), 풍향계수 1.0. 구조 설계 아님'});
const RHO=1.225,MIN_PRESSURE=675;
// 지역별 기본풍속(m/s): [값, 시·군 이름…]. 같은 이름(고성·광주)은 도 이름으로 구분.
const TABLE=[
 ['경기',30,'옹진'],['경기',28,'인천','강화','안산','시흥','평택'],
 ['경기',26,'서울','김포','구리','수원','군포','오산','화성','의왕','부천','고양','안양','과천','광명','의정부','동두천','양주','파주','포천','남양주','가평','하남','성남','광주','양평','용인'],
 ['경기',24,'안성','연천','여주','이천'],
 ['강원',34,'속초','양양','강릉','고성'],['강원',30,'동해','삼척','홍천','정선','인제'],['강원',26,'양구'],['강원',24,'철원','화천','춘천','횡성','원주','평창','영월','태백'],
 ['충청',34,'서산','태안'],['충청',32,'당진'],['충청',30,'서천','보령','홍성','청주','청원'],['충청',28,'예산','세종','대전','공주','부여'],['충청',26,'아산','계룡','진천'],
 ['충청',24,'천안','증평','청양','논산','금산','음성','충주','제천','단양','괴산','보은','영동','옥천'],
 ['경상',40,'울릉','독도'],['경상',38,'부산'],['경상',36,'포항','경주','기장','통영','거제'],['경상',34,'양산','김해','남해','울산','울주'],['경상',32,'영덕','고성'],
 ['경상',30,'울진','창원','사천','영천'],['경상',28,'청송','대구','경산','청도','밀양','하동'],['경상',26,'영양','군위','칠곡','성주','달성','함안','고령','창녕','진주'],
 ['경상',24,'봉화','영주','예천','문경','상주','추풍령','안동','의성','구미','김천','의령','거창','산청','합천','함양'],
 ['전라',36,'완도','해남'],['전라',34,'진도','여수','고흥','신안','무안','장흥'],['전라',32,'군산','목포','부안','영암','강진'],['전라',30,'영광','함평','나주'],
 ['전라',28,'익산','김제','순천','고창','광양'],['전라',26,'광주','보성','완주','전주','장성'],['전라',24,'무주','진안','장수','임실','정읍','순창','남원','담양','곡성','구례'],
 ['제주',44,'서귀포','제주'],
];
const PROVINCE_WORDS={경기:['경기','서울','인천'],강원:['강원'],충청:['충청','충북','충남','대전','세종'],경상:['경상','경북','경남','부산','대구','울산'],전라:['전라','전북','전남','광주광역'],제주:['제주']};
/** 주소·지역 글자 → 기본풍속. '부산광역시 해운대구' · '경남 고성군' · '강릉' 모두 된다. 못 찾거나 겹치면 이유와 후보. */
export function basicWindSpeed(text){
 const s=String(text||'').replace(/\s+/g,' ').trim();if(!s)return {error:'지역(시·군 이름이나 주소)을 주세요.'};
 const province=Object.entries(PROVINCE_WORDS).find(([,words])=>words.some(w=>s.includes(w)))?.[0]||null;
 const hits=[];
 for(const [prov,v,...names] of TABLE)for(const name of names){
  const re=new RegExp(`(^|[\\s,(])${name}(특별시|광역시|특별자치시|특별자치도|시|군|구|읍|도)?($|[\\s,)])`);
  if(re.test(s)||s===name)hits.push({province:prov,region:name,speed:v});
 }
 // 광역시·도 이름이 시 이름과 같은 것(부산·대구·광주·울산·대전·인천·서울·세종·제주)은 그 이름이 맨 앞에 오면 그것을 쓴다
 const narrowed=province?hits.filter(h=>h.province===province):hits;
 const unique=[...new Map(narrowed.map(h=>[h.region+h.speed,h])).values()];
 if(unique.length===1)return unique[0];
 if(unique.length>1){const first=unique.slice().sort((a,b)=>s.indexOf(a.region)-s.indexOf(b.region));const speeds=new Set(unique.map(h=>h.speed));
  if(speeds.size===1)return first[0];
  return {error:`여러 지역이 겹칩니다: ${unique.map(h=>`${h.region}(${h.province}) ${h.speed} m/s`).join(', ')} — 도 이름을 붙이거나 basicWindSpeed 로 주세요.`,candidates:unique};}
 return {error:`표에 없는 지역입니다: ${s}. 가까운 시·군 이름이나 basicWindSpeed(m/s, KDS 41 12 00 그림 5.5-1)로 주세요.`};
}
export const TERRAIN=Object.freeze({A:{zb:20,zg:550,alpha:.33,below:.58,k:.22},B:{zb:15,zg:450,alpha:.22,below:.81,k:.45},C:{zb:10,zg:350,alpha:.15,below:1,k:.71},D:{zb:5,zg:250,alpha:.10,below:1.13,k:.98}});
export const IMPORTANCE=Object.freeze({특:1.05,초고층:1.05,'1':1.00,'2':.95,'3':.90});
/** 풍속고도분포계수 K_zr(표 5.5-2): z ≤ Z_b 는 상수, Z_b < z ≤ Z_g 는 k·z^α, 그 위는 Z_g 값. */
export function kzr(z,terrain='C'){
 const t=TERRAIN[terrain];if(!t)throw Error('지표면조도구분은 A·B·C·D 입니다.');
 const h=Math.min(Math.max(z,0),t.zg);return h<=t.zb?t.below:t.k*h**t.alpha;
}
/** 설계풍속·설계속도압(기준높이 H, m). */
export function designWind({V0,terrain='C',height,importance='1',KD=1,Kzt=1}){
 if(!(V0>0))throw Error('기본풍속이 필요합니다.');if(!(height>0))throw Error('기준높이(m)가 필요합니다.');
 const Iw=IMPORTANCE[String(importance)];if(!Iw)throw Error('중요도는 특·1·2·3 입니다.');
 const K=kzr(height,terrain),VH=V0*KD*K*Kzt*Iw,qH=.5*RHO*VH*VH;
 return {V0,KD,Kzr:K,Kzt,Iw,VH,qH};
}
/** 표 5.15-1 외압계수. side·roof 는 풍상끝에서의 거리 / 기준높이 H 로 구간. 구간 사이 값은 표대로(계단). */
export function wallCpe(face,xOverH=0){
 if(face==='windward')return .6;
 if(face==='leeward')return -.5;   // 표의 −0.5 / −0.3 중 큰 쪽(조건 식은 원문 그림) — 개략이므로 불리한 값
 const x=Math.max(0,xOverH),zone=x<.5?0:x<1.5?1:x<2.5?2:3;
 return face==='roof'?[-1.0,-.8,-.3,-.2][zone]:[-.8,-.7,-.3,-.2][zone];
}
/** 면 하나의 풍압(N/m²): q·Cpe(·가스트). 주골조 최소 675 N/m² 를 크기로 적용. */
export function facePressure(qH,cpe,gust=null){
 const raw=qH*cpe*(gust||1),minApplied=Math.abs(raw)<MIN_PRESSURE;
 return {pressure:minApplied?Math.sign(cpe||1)*MIN_PRESSURE:raw,raw,minApplied};
}
/** 바람이 불어오는 방향(도북 기준 °, 0 = 북쪽에서 부는 바람) → 바람이 나아가는 단위벡터(도면 x·y). */
export const windVector=fromDeg=>{const a=fromDeg*Math.PI/180;return {x:-Math.sin(a),y:-Math.cos(a)};};

/** 벽 면 분류: 바깥 법선 n(도면 단위벡터)·바람 진행 방향 w → 풍상·풍하·측벽. */
export function classifyFace(n,w){const d=n.x*w.x+n.y*w.y;return d<-.5?'windward':d>.5?'leeward':'side';}

const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
const hits=(p,q,a,b)=>{const d1=cross(a,b,p),d2=cross(a,b,q),d3=cross(p,q,a),d4=cross(p,q,b);return (d1>0)!==(d2>0)&&(d3>0)!==(d4>0);};
/** 바깥 벽만: 벽 가운데에서 바깥쪽으로 쏜 선이 다른 벽을 만나지 않는 벽(실내 칸막이·안쪽 면은 뺀다). */
export function exteriorWalls(walls){
 const pts=walls.flatMap(w=>[w.a,w.b]),cx=pts.reduce((s,p)=>s+p.x,0)/pts.length,cy=pts.reduce((s,p)=>s+p.y,0)/pts.length;
 const span=Math.max(...pts.map(p=>Math.hypot(p.x-cx,p.y-cy)))*3+1;
 return walls.map(w=>{const dx=w.b.x-w.a.x,dy=w.b.y-w.a.y,len=Math.hypot(dx,dy)||1,mid={x:(w.a.x+w.b.x)/2,y:(w.a.y+w.b.y)/2};let n={x:dy/len,y:-dx/len};if((mid.x-cx)*n.x+(mid.y-cy)*n.y<0)n={x:-n.x,y:-n.y};return {...w,n,mid,len};})
  .filter(w=>{const p={x:w.mid.x+w.n.x,y:w.mid.y+w.n.y},q={x:w.mid.x+w.n.x*span,y:w.mid.y+w.n.y*span};return !walls.some(o=>o.id!==w.id&&hits(p,q,o.a,o.b));});
}
/** 도면 벽 → 면별 풍압(바깥 벽만). walls = [{id, a:{x,y}, b:{x,y}}](mm), 기준높이 H(m), 바람 방향들(°). */
export function windOnWalls(walls,{qH,height,directions=[0,90,180,270],gust=null}){
 if(!walls.length)throw Error('벽이 없습니다. 3D 의 벽 레이어를 고르거나 벽을 그리세요.');
 const outer=exteriorWalls(walls),pts=walls.flatMap(w=>[w.a,w.b]);
 return directions.map(from=>{
  const w=windVector(from),proj=p=>p.x*w.x+p.y*w.y,start=Math.min(...pts.map(proj));
  const faces=outer.map(wall=>{
   const face=classifyFace(wall.n,w),xOverH=(proj(wall.mid)-start)/1000/height,cpe=wallCpe(face,xOverH),p=facePressure(qH,cpe,gust);
   return {id:wall.id,face,cpe,pressure:Math.round(p.pressure),raw:Math.round(p.raw),minApplied:p.minApplied,lengthMm:Math.round(wall.len)};   // raw = 최소 675 적용 전
  });
  const pos=faces.filter(f=>f.pressure>0),neg=faces.filter(f=>f.pressure<0);
  return {from,label:['북','북동','동','남동','남','남서','서','북서'][Math.round(((from%360)+360)%360/45)%8]+'풍',faces,
   maxPositive:pos.length?Math.max(...pos.map(f=>f.pressure)):0,maxNegative:neg.length?Math.min(...neg.map(f=>f.pressure)):0};
 });
}
