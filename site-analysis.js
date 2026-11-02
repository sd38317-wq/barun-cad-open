// 계획 탭 ⑤ 대지분석: 도면에 넣은 대지·주변 지적·주변 건물(A-SITE-BLDG)로 대지분석 도판을 그린다.
//
//  · 자료는 새로 받지 않는다 — ③ 주변 지적도와 ⑥ [주변 건물·등고선 가져오기]가 도면에 넣은 객체를 읽는다.
//  · 도판 = 원형(또는 사각) 프레임의 SVG. 대지 가운데가 원점, 위가 북쪽(도면 y+ = 북).
//  · [도면 뒤에 깔기]는 같은 그림을 화소로 바꿔 배경 지도 자리(setBackgroundMap)에 깐다 — 도면 파일은 바꾸지 않는다.
//  · 없는 자료는 지어내지 않는다: 높이 미상·용도 미상·연도 미상은 회색으로 따로 센다.
// 이 파일은 [대지분석] 단계를 열 때만 plan-workflow-panel.js 가 불러온다.
import * as G from './geometry.js';

export const ANALYSIS_ATTRIBUTION='대지분석 · 브이월드 GIS건물통합정보·연속지적도로 계산';
const ACCENT='#e0245e',BG='#f4f4f2',MONO='IBM Plex Mono, ui-monospace, Menlo, monospace';
const f1=n=>Math.round(n*10)/10;
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ─────────────── 자료 모으기(순수 함수 · 시험 대상) ─────────────── */
const ringAreaMm=pts=>{let a=0;for(let i=0,j=pts.length-1;i<pts.length;j=i++)a+=(pts[j].x+pts[i].x)*(pts[j].y-pts[i].y);return Math.abs(a/2);};
const centroid=pts=>pts.reduce((s,p)=>({x:s.x+p.x/pts.length,y:s.y+p.y/pts.length}),{x:0,y:0});

/** 건축법 시행령 별표1 호 번호(GIS건물통합정보 usability 다섯 자리 = 호×1000) → 도판 범주. */
export const USE_CATS=[
 {t:'주거',c:'#f2d98d',no:[1,2],m:/단독주택|공동주택/},
 {t:'근린생활',c:'#f0a878',no:[3,4],m:/근린생활/},
 {t:'상업·숙박',c:'#ec7f9a',no:[7,15,16],m:/판매|숙박|위락/},
 {t:'업무',c:'#7fa7e3',no:[14,24],m:/업무|방송통신/},
 {t:'공업·창고',c:'#b39ddb',no:[17,18,19,20,22,25],m:/공장|창고|위험물|자동차|자원순환|발전/},
 {t:'교육·의료·복지',c:'#7cc9bd',no:[9,10,11,12],m:/교육|노유자|의료|수련/},
 {t:'문화·종교·운동',c:'#b8d27a',no:[5,6,13,27],m:/문화|종교|운동|관광/},
 {t:'그 밖',c:'#c9c6bf',no:[8,21,23,26,28,29],m:/.+/},
];
export const USE_UNKNOWN={t:'미상',c:'#e3e3e1'};
export function useCategory(code,name){
 const n=parseInt(String(code||'').trim().slice(0,2),10);
 if(String(code||'').trim().length>=4&&n>0){const cat=USE_CATS.find(c=>c.no.includes(n));if(cat)return cat;}
 if(name)return USE_CATS.find(c=>c.m.test(name))||USE_UNKNOWN;
 return USE_UNKNOWN;
}

/** 도면에서 도판 재료를 뽑는다. 좌표는 대지 가운데 기준 m(x 동쪽, y 남쪽 = SVG 방향). */
export function analysisModel(doc,{maxRadiusM=400}={}){
 const all=G.parcelEntities(doc?.entities||[]);
 const sites=all.filter(e=>e.parcelRole==='site'&&e.attributes?.ring!=='hole'&&e.points?.length>=3);
 if(!sites.length)return null;
 const sp=sites.flatMap(e=>e.points),c=centroid(sp);
 const P=p=>[(p.x-c.x)/1000,-(p.y-c.y)/1000];
 const buildings=all.filter(e=>e.parcelRole==='building'&&e.points?.length>=3).map(e=>{
  const a=e.attributes||{},pts=e.points.map(P),cc=centroid(e.points);
  // 서버는 층수도 높이도 없는 건물을 '층수 없음 · 1층으로 봄'(3.3m)으로 넣는다 → 도판에서는 미상으로 센다.
  const guessed=String(a.heightSource||'').startsWith('층수 없음');
  const h=Number(a.heightM)||((e.model3d?.height||0)/1000)||null;
  return {pts,c:P(cc),area:ringAreaMm(e.points)/1e6,h:guessed?null:h,hs:h||3.3,floors:guessed?null:Number(a.floors)||null,
   use:useCategory(a.useCode,a.useName),useCode:a.useCode||'',useName:a.useName||'',gfa:Number(a.totalAreaM2)||null,year:Number(a.approvalYear)||null,name:a.name||''};
 });
 const parcels=all.filter(e=>['site','road','neighbor'].includes(e.parcelRole)&&e.attributes?.ring!=='hole'&&e.points?.length>=3).map(e=>({
  role:e.parcelRole,pnu:e.attributes?.pnu||'',pts:e.points.map(P),area:ringAreaMm(e.points)/1e6}));
 const siteRings=sites.map(e=>e.points.map(P));
 const contours=all.filter(e=>(e.parcelRole==='contour'||e.parcelRole==='contour-major')&&Number.isFinite(e.attributes?.elevationM)&&e.points?.length>=2)
  .map(e=>({z:e.attributes.elevationM,major:e.parcelRole==='contour-major',pts:e.points.map(P)}));
 // 주변 건물을 몇 m 둘레로 받았는지(가져올 때 aroundM 을 붙인다). 예전 도면은 150m.
 const fetchedR=all.reduce((r,e)=>e.parcelRole==='building'?Math.max(r,Number(e.attributes?.aroundM)||150):r,0)||null;
 // 프레임 반경: 주변 건물 중심 거리의 95번째 값(없으면 필지 중심) — 길게 뻗은 도로 필지 끝이 반경을 늘리지 않게. 최소 60m · 최대 maxRadiusM.
 const pc=p=>{let x=0,y=0;for(const q of p.pts){x+=q[0];y+=q[1];}return [x/p.pts.length,y/p.pts.length];};
 const dist=(buildings.length?buildings.map(b=>Math.hypot(...b.c)):parcels.map(p=>Math.hypot(...pc(p)))).sort((a,b)=>a-b);
 const reach=dist.length?dist[Math.min(dist.length-1,Math.floor(dist.length*.95))]:0;
 // 반경을 정해 받은 도면(aroundM)은 원 도판 = 받은 원 그대로. 예전 도면은 건물 분포로 잡는다.
 const R=fetchedR&&all.some(e=>e.parcelRole==='building'&&e.attributes?.aroundM)?Math.min(maxRadiusM,fetchedR):Math.round(Math.min(maxRadiusM,Math.max(60,reach*1.02)));
 const geo=doc?.drawingGeo||null;
 return {center:c,R,buildings,parcels,siteRings,contours,fetchedR,geo,lat:latOf(doc,c),zones:null,counts:{buildings:buildings.length,parcels:parcels.length}};
}

/** parcel zoning 응답(도면 mm 면[면][고리][점]) → 도판 좌표(m, y 남쪽) 고리 목록(구멍은 evenodd 로 빠짐). zones 만 붙인 새 model. */
export function withZones(model,zoning){
 if(!model||!zoning)return model;
 const P=([x,y])=>[(x-model.center.x)/1000,-(y-model.center.y)/1000];
 const zones=(zoning.zones||[]).map(z=>({kind:z.kind,layer:z.layer,name:z.name||'',group:z.group||'',detail:z.detail||'',rings:(z.polygons||[]).flat(1).map(r=>r.map(P))}));
 // 종류별 "받지 못함". 받지 못한 것을 "이 범위에 없음"으로 보이지 않게 한다(없는 자료는 지어내지 않는다, 2026-10-22 검토).
 // failed 가 없으면 요청 자체가 실패한 것({zones:[],warnings:[오류]}) — 세 종류 모두 받지 못함.
 const warn=String(zoning.warnings?.[0]||'');
 const zoneErrors={};
 for(const kind of ['zone','district','facility','water']){
  const layers=zoning.failed?zoning.failed[kind]||[]:warn?[warn]:[];
  if(layers.length)zoneErrors[kind]=zoning.failed?(zoning.warnings||[]).filter(w=>layers.some(l=>w.startsWith(l+':'))).join(' / ')||layers.join(', '):warn;
 }
 return {...model,zones,zoneErrors};
}
// 위도: drawingGeo(EPSG:5187·5179)에서 근사. 없으면 부산(일조 계산용 기본값).
function latOf(doc,c){
 const geo=doc?.drawingGeo;if(!geo?.originM)return 35.15;
 const N=geo.originM[1]+c.y/1000;
 // 5187(중부원점 북 600,000) · 5179(통합 북 2,000,000, 원점 위도 38°). 1° ≈ 110.9km.
 return geo.crs==='EPSG:5179'?38+(N-2000000)/110900:38+(N-600000)/110900;
}

/* ─────────────── 일조시간 · 개방감(도면 건물 높이 격자) ─────────────── */
function heightGrid(buildings,H,cell){
 const n=Math.ceil(2*H/cell),g=new Float32Array(n*n);
 for(const b of buildings){
  const h=b.hs;if(!(h>0))continue;let y0=Infinity,y1=-Infinity;for(const [,y] of b.pts){if(y<y0)y0=y;if(y>y1)y1=y;}
  const j0=Math.max(0,Math.floor((y0+H)/cell)),j1=Math.min(n-1,Math.floor((y1+H)/cell));
  for(let j=j0;j<=j1;j++){
   const yc=-H+(j+.5)*cell,xs=[];
   for(let i=0,k=b.pts.length-1;i<b.pts.length;k=i++){const [xa,ya]=b.pts[k],[xb,yb]=b.pts[i];if((ya>yc)!==(yb>yc))xs.push(xa+(yc-ya)*(xb-xa)/(yb-ya));}
   xs.sort((a,b)=>a-b);
   for(let q=0;q+1<xs.length;q+=2){const i0=Math.max(0,Math.ceil((xs[q]+H)/cell-.5)),i1=Math.min(n-1,Math.floor((xs[q+1]+H)/cell-.5));for(let i=i0;i<=i1;i++){const o=j*n+i;if(g[o]<h)g[o]=h;}}
  }
 }
 return {n,cell,H,g};
}
const hAt=(G,x,y)=>{const i=Math.floor((x+G.H)/G.cell),j=Math.floor((y+G.H)/G.cell);return i<0||j<0||i>=G.n||j>=G.n?0:G.g[j*G.n+i];};
export function sunPosition(lat,decl,hour){
 const φ=lat*Math.PI/180,δ=decl*Math.PI/180,h=(hour-12)*15*Math.PI/180;
 const alt=Math.asin(Math.sin(φ)*Math.sin(δ)+Math.cos(φ)*Math.cos(δ)*Math.cos(h));
 const az=Math.atan2(Math.sin(h),Math.cos(h)*Math.sin(φ)-Math.tan(δ)*Math.cos(φ))+Math.PI;
 return [alt,az];
}
/** 동지(적위 −23.44°) 진태양시 from~to 시, step 간격으로 햇빛이 드는 시간. 건물 안 = −1. */
export function sunHours(G,M,lat,{decl=-23.44,from=9,to=15,step=.5}={}){
 const H=G.H,s=2*H/M,out=new Float32Array(M*M),suns=[];
 for(let t=from;t<=to+1e-9;t+=step){const [alt,az]=sunPosition(lat,decl,t);if(alt>.02)suns.push({dx:Math.sin(az),dy:-Math.cos(az),tan:Math.tan(alt)});}
 let maxH=0;for(const v of G.g)if(v>maxH)maxH=v;
 for(let j=0;j<M;j++)for(let i=0;i<M;i++){
  const x=-H+(i+.5)*s,y=-H+(j+.5)*s;if(hAt(G,x,y)>0){out[j*M+i]=-1;continue;}
  let lit=0;for(const S of suns){let blocked=false;for(let d=G.cell;d<=maxH/S.tan;d+=G.cell)if(hAt(G,x+S.dx*d,y+S.dy*d)>d*S.tan){blocked=true;break;}if(!blocked)lit++;}
  out[j*M+i]=Math.max(0,lit-(suns.length>1?1:0))*step;
 }
 return out;
}
/** 천공률(0~1): 방위 az개로 반경 R(m) 안 건물의 최대 앙각. 건물 안 = −1. */
export function skyView(G,M,R=150,az=24){
 const H=G.H,s=2*H/M,out=new Float32Array(M*M),dirs=Array.from({length:az},(_,k)=>[Math.cos(2*Math.PI*k/az),Math.sin(2*Math.PI*k/az)]);
 for(let j=0;j<M;j++)for(let i=0;i<M;i++){
  const x=-H+(i+.5)*s,y=-H+(j+.5)*s;if(hAt(G,x,y)>0){out[j*M+i]=-1;continue;}
  let acc=0;for(const [dx,dy] of dirs){let best=0;for(let d=G.cell;d<=R;d+=G.cell){const h=hAt(G,x+dx*d,y+dy*d);if(h>0&&h/d>best)best=h/d;}const s2=best*best/(1+best*best);acc+=s2;}
  out[j*M+i]=1-acc/az;
 }
 return out;
}

/* ─────────────── 지형(등고선 → 표고 격자) ─────────────── */
/** 등고선 → M×M 표고 격자(도판 좌표, 위=북). 가까운 등고선 점의 거리 역가중, 그다음 약 50m 폭으로 두 번 평활(경사가 계단처럼 보이지 않게).
 *  경사도(°)·경사 방향(내려가는 쪽 방위, 북=0°)도 함께. 등고선이 없으면 null. 칸 밖(자료 없음) = NaN. */
export function terrainGrid(contours,H,M=180){
 if(!contours?.length)return null;
 const cs=2*H/M,B=40,buckets=new Map();
 for(const c of contours)for(let i=0;i<c.pts.length;i++){const a=c.pts[i],b=c.pts[Math.min(i+1,c.pts.length-1)],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/8));
  for(let k=0;k<n;k++){const x=a[0]+(b[0]-a[0])*k/n,y=a[1]+(b[1]-a[1])*k/n,key=Math.floor(x/B)+','+Math.floor(y/B);(buckets.get(key)||buckets.set(key,[]).get(key)).push([x,y,c.z]);}}
 const raw=new Float32Array(M*M);
 for(let j=0;j<M;j++)for(let i=0;i<M;i++){const x=-H+(i+.5)*cs,y=-H+(j+.5)*cs,bx=Math.floor(x/B),by=Math.floor(y/B);let w=0,s=0;
  for(let r=1;r<=4&&!w;r++)for(let dx=-r;dx<=r;dx++)for(let dy=-r;dy<=r;dy++)for(const q of buckets.get((bx+dx)+','+(by+dy))||[]){const ww=1/((q[0]-x)**2+(q[1]-y)**2+1);w+=ww;s+=ww*q[2];}
  raw[j*M+i]=w?s/w:NaN;}
 const blur=(a,r)=>{const o=new Float32Array(M*M);for(let j=0;j<M;j++)for(let i=0;i<M;i++){let s=0,n=0;for(let dj=Math.max(-r,-j);dj<=r&&j+dj<M;dj++)for(let di=Math.max(-r,-i);di<=r&&i+di<M;di++){const v=a[(j+dj)*M+i+di];if(v===v){s+=v;n++;}}o[j*M+i]=n?s/n:NaN;}return o;};
 const r=Math.max(1,Math.round(30/cs)),z=blur(blur(raw,r),r),slope=new Float32Array(M*M).fill(NaN),aspect=new Float32Array(M*M).fill(NaN);
 for(let j=1;j<M-1;j++)for(let i=1;i<M-1;i++){const gx=(z[j*M+i+1]-z[j*M+i-1])/(2*cs),gy=(z[(j+1)*M+i]-z[(j-1)*M+i])/(2*cs);// j+ = 남쪽
  slope[j*M+i]=Math.atan(Math.hypot(gx,gy))*180/Math.PI;aspect[j*M+i]=(Math.atan2(-gx,gy)*180/Math.PI+360)%360;}
 let zmin=Infinity,zmax=-Infinity;for(const c of contours){if(c.z<zmin)zmin=c.z;if(c.z>zmax)zmax=c.z;}
 return {M,cs,H,z,slope,aspect,zmin,zmax};
}
const terrains=new WeakMap();
const terrainFor=m=>{if(!terrains.has(m))terrains.set(m,terrainGrid(m.contours,m.R*1.06));return terrains.get(m);};

/* ─────────────── 도판 ─────────────── */
const ptsD=pts=>{let d='';pts.forEach(([x,y],i)=>{d+=(i?'L':'M')+f1(x)+' '+f1(y);});return d+'Z';};
const pathEl=(d,attrs)=>d?`<path d="${d}" ${attrs}/>`:'';
const lerpC=(stops,t)=>{t=Math.max(0,Math.min(1,t))*(stops.length-1);const i=Math.min(stops.length-2,Math.floor(t)),k=t-i,h=c=>[1,3,5].map(o=>parseInt(c.slice(o,o+2),16)),a=h(stops[i]),b=h(stops[i+1]);return a.map((v,q)=>Math.round(v+(b[q]-v)*k));};

export const ZONING=[
 {t:'제1종전용주거',c:'#fff7c2',m:/제1종전용주거/},{t:'제2종전용주거',c:'#fdf0a6',m:/제2종전용주거/},
 {t:'제1종일반주거',c:'#fbe58a',m:/제1종일반주거/},{t:'제2종일반주거',c:'#f6d25e',m:/제2종일반주거/},
 {t:'제3종일반주거',c:'#eab83d',m:/제3종일반주거/},{t:'준주거',c:'#f0a04b',m:/준주거/},
 {t:'중심상업',c:'#d93a5e',m:/중심상업/},{t:'일반상업',c:'#ec6f8c',m:/일반상업/},{t:'근린상업',c:'#f4a3b5',m:/근린상업/},{t:'유통상업',c:'#e58ac0',m:/유통상업/},
 {t:'전용공업',c:'#9a7fd1',m:/전용공업/},{t:'일반공업',c:'#b9a2e3',m:/일반공업/},{t:'준공업',c:'#d7c8f2',m:/준공업/},
 {t:'보전녹지',c:'#5fae5a',m:/보전녹지/},{t:'생산녹지',c:'#a6d38a',m:/생산녹지/},{t:'자연녹지',c:'#cbe8b5',m:/자연녹지/},
 {t:'관리지역',c:'#e8e2c8',m:/관리/},{t:'농림지역',c:'#d9e6a9',m:/농림/},{t:'자연환경보전',c:'#7fbf95',m:/자연환경보전/},{t:'그 밖',c:'#e4e4e0',m:/.?/},
];
export const DISTRICT=[
 {t:'지구단위계획구역',c:'#2ab3a6',m:/지구단위/},{t:'경관지구',c:'#6f8ff0',m:/경관/},{t:'고도지구',c:'#e86f4f',m:/고도/},{t:'방화지구',c:'#f2a33a',m:/방화/},
 {t:'방재지구',c:'#4fb3d9',m:/방재/},{t:'보호·보존지구',c:'#b07ad8',m:/보호|보존/},{t:'취락지구',c:'#9bbf4f',m:/취락/},{t:'개발진흥지구',c:'#d07fae',m:/개발진흥/},{t:'그 밖 지구',c:'#8a8f99',m:/.?/},
];
export const PLANNED=[
 {t:'도로',c:'#f6c46a',m:z=>z.group==='도로'||/로[123]류|광로|대로|중로|소로|도로/.test(z.name)},
 {t:'철도·도시철도',c:'#e5308c',m:z=>/철도|정거장|역$/.test(z.name)},
 {t:'주차장',c:'#a3a3a3',m:z=>/주차/.test(z.name)},
 {t:'공원',c:'#7ac943',m:z=>/공원|유원지/.test(z.name)},
 {t:'녹지',c:'#b5dd94',m:z=>/녹지/.test(z.name)},
 {t:'광장·공공공지',c:'#d8c79f',m:z=>/광장|공공공지/.test(z.name)},
 {t:'학교',c:'#3f6fb7',m:z=>/학교|대학/.test(z.name)},
 {t:'공공·문화체육',c:'#8fb0e6',m:z=>z.group==='공공·문화체육'},
 {t:'유통·공급',c:'#b98bd6',m:z=>z.group==='유통·공급'},
 {t:'방재',c:'#79bde8',m:z=>z.group==='방재'},
 {t:'환경기초',c:'#9a9a6a',m:z=>z.group==='환경기초'},
 {t:'그 밖 시설',c:'#d0d0cc',m:()=>true},
];
export const FAR_BINS=[{t:'~0.5',c:'#fff4cf',m:.5},{t:'0.5~1',c:'#fde08a',m:1},{t:'1~2',c:'#fbbf47',m:2},{t:'2~4',c:'#f5912e',m:4},{t:'4~8',c:'#df5a1f',m:8},{t:'8~',c:'#9f2a12',m:Infinity}];
const ringsD=rings=>rings.map(ptsD).join('');
const zonesOf=(m,kind)=>(m.zones||[]).filter(z=>z.kind===kind);
const ZONE_WAIT='용도지역·지구·시설 자료를 받는 중입니다(로그인 필요).';
// 한 종류 안에서 일부 레이어만 받지 못해도 그 도판은 그리지 않는다 — 빠진 채 그리면 "없는 것"처럼 보인다.
const ZONE_KIND_NAME={zone:'용도지역',district:'용도지구·지구단위계획구역',facility:'도시계획시설'};
const zoneNeed=kind=>m=>m.zones==null?ZONE_WAIT:m.zoneErrors?.[kind]?`${ZONE_KIND_NAME[kind]} 자료를 받지 못했습니다: ${m.zoneErrors[kind]} — 아래 [도시계획 자료 다시 받기]를 누르세요.`:zonesOf(m,kind).length?'':'이 범위에는 해당 자료가 없습니다.';
const pickName=(c,z)=>c.m.test(z.name),pickFn=(c,z)=>c.m(z);
function catFill(list,cats,pick,attrs=()=>''){const by=cats.map(()=>[]);for(const z of list){const i=cats.findIndex(c=>pick(c,z));by[i>=0?i:cats.length-1].push(ringsD(z.rings));}return cats.map((c,i)=>pathEl(by[i].join(''),`fill="${c.c}" fill-rule="evenodd" ${attrs(c)}`)).join('');}
const drawnCats=(list,cats,pick)=>cats.filter(c=>list.some(z=>cats.find(x=>pick(x,z))===c)).map(c=>({c:c.c,t:c.t}));
/** 밀도: 격자(25·50·100m)별 연면적 ÷ 격자 면적. 연면적은 GIS건물통합정보 totalarea, 없으면 바닥면적 × 층수(미상 1층). */
export function densityCells(m){
 const cs=m.R<=150?25:m.R<=300?50:100,cells=new Map();
 for(const b of m.buildings){const g=b.gfa??b.area*(b.floors||1),k=Math.floor(b.c[0]/cs)+','+Math.floor(b.c[1]/cs);cells.set(k,(cells.get(k)||0)+g);}
 return {cs,cells:[...cells].map(([k,g])=>{const [i,j]=k.split(',').map(Number);return {x:i*cs,y:j*cs,far:g/(cs*cs)};})};
}
export const HEIGHT_BINS=[
 {t:'미상',c:'#e0e0de',test:h=>h==null},{t:'~10m',c:'#cfe0ff',test:h=>h<10},{t:'10~20m',c:'#9cc3ff',test:h=>h<20},
 {t:'20~35m',c:'#5b9cf6',test:h=>h<35},{t:'35~60m',c:'#2563eb',test:h=>h<60},{t:'60~100m',c:'#1e3a9e',test:h=>h<100},{t:'100m~',c:'#121f52',test:()=>true},
];
export const AGE_BINS=[
 {t:'~1979',c:'#6e2516',m:1980},{t:'1980년대',c:'#9c3a24',m:1990},{t:'1990년대',c:'#c4583a',m:2000},
 {t:'2000년대',c:'#de8a64',m:2010},{t:'2010년대',c:'#efbb9c',m:2020},{t:'2020~',c:'#f8e0cf',m:9999},
];
export const PLOT_BINS=[
 {t:'~100㎡',c:'#efeaf8',m:100},{t:'100~200',c:'#d9cff0',m:200},{t:'200~330',c:'#bcaee4',m:330},{t:'330~660',c:'#9a86d2',m:660},
 {t:'660~1,650',c:'#7660bb',m:1650},{t:'1,650~3,300',c:'#563f9e',m:3300},{t:'3,300㎡~',c:'#352168',m:Infinity},
];
const SUN_C=['#2d2a5a','#5b3f86','#a0559a','#e07b6a','#f6b25a','#fde68a'];
export const TOPO_C=['#f3efe2','#e3dcc0','#cdbf94','#b49c6c','#8f744a'];
export const SLOPE_BINS=[{t:'0~5°',c:'#f4f1e6',m:5},{t:'5~10°',c:'#f6d58c',m:10},{t:'10~15°',c:'#ef9b4a',m:15},{t:'15~20°',c:'#d4552b',m:20},{t:'20°~',c:'#8e2415',m:Infinity}];
export const ASPECT_C=[{t:'북',c:'#4f6fb5'},{t:'북동',c:'#5aa3c9'},{t:'동',c:'#73c4a0'},{t:'남동',c:'#c8d36a'},{t:'남',c:'#f2c04d'},{t:'남서',c:'#ee8a4a'},{t:'서',c:'#d35d6e'},{t:'북서',c:'#8e63b0'}];
// 도시계획 도로 이름(광로1류·대로2류(폭 30m~35m)…)에서 위계. 폭 구분은 도시·군계획시설규칙 제9조.
export const ROAD_CLASS=[{t:'광로(40m 이상)',c:'#2b2b2b',m:/광로/},{t:'대로(25~40m)',c:'#5a5a5a',m:/대로/},{t:'중로(12~25m)',c:'#8f8f8f',m:/중로/},{t:'소로(12m 미만)',c:'#c2c2c2',m:/소로/}];
const GREEN_RE=/공원|녹지|유원지|공공공지|광장/;
const TOPO_NEED='등고선이 없습니다 — ⑥ [주변 건물·등고선 가져오기]를 먼저 누르세요.';
const hexC=c=>[1,3,5].map(o=>parseInt(c.slice(o,o+2),16)),BG_RGB=hexC(BG);
const mixBg=(c,a)=>hexC(c).map((v,k)=>Math.round(BG_RGB[k]+(v-BG_RGB[k])*a));
const roadZones=m=>zonesOf(m,'facility').filter(z=>z.group==='도로');
const railZones=m=>zonesOf(m,'facility').filter(z=>/철도/.test(z.name));
const lineD=pts=>pts.map(([x,y],i)=>(i?'L':'M')+f1(x)+' '+f1(y)).join('');
const contourBody=(m,u)=>m.contours.map(c=>pathEl(lineD(c.pts),`fill="none" stroke="#6b5636" stroke-opacity="${c.major?.8:.45}" stroke-width="${f1((c.major?1.6:.8)*u)}"`)).join('');
const SKY_C=['#20243f','#36508a','#5f8fc9','#a8cdea','#eef6fc'];

const bldD=(model,filter=()=>true)=>model.buildings.filter(filter).map(b=>ptsD(b.pts)).join('');
const binFill=(model,bins,pick)=>{const by=bins.map(()=>[]);for(const b of model.buildings){const i=pick(b);if(i>=0)by[i].push(ptsD(b.pts));}return bins.map((x,i)=>pathEl(by[i].join(''),`fill="${x.c}"`)).join('');};

/** 패널: {key,en,ko,need(자료 확인),body(model,opts)→SVG 조각,legend(model)} */
export const ANALYSIS_PANELS=[
 {key:'topo',en:'TOPOGRAPHY',ko:'지형·등고선',need:m=>m.contours.length?'':TOPO_NEED,note:'5m 등고선(국토지리정보원 수치지형도) · 높이 색은 등고선 사이를 이어 칠함',
  raster:m=>{const t=terrainFor(m),span=t.zmax-t.zmin||1;return {M:t.M,vals:t.z.map(v=>v===v?Math.max(0,(v-t.zmin)/span):-1),color:v=>lerpC(TOPO_C,v)};},
  body:m=>contourBody(m,m.R*1.06/450)+pathEl(bldD(m),'fill="#000" fill-opacity=".12"'),
  legend:m=>{const t=terrainFor(m);return [{c:TOPO_C[0],t:`${f1(t.zmin)}m`},{c:TOPO_C[2],t:`${f1((t.zmin+t.zmax)/2)}m`},{c:TOPO_C[4],t:`${f1(t.zmax)}m`},{c:'#6b5636',t:'등고선 5m',k:'line'}];}},
 {key:'slope',en:'SLOPE',ko:'경사도',need:m=>m.contours.length?'':TOPO_NEED,note:'등고선에서 계산 · 약 50m 폭 평활 — 그보다 좁은 옹벽·절개지는 안 보입니다',
  raster:m=>{const t=terrainFor(m);return {M:t.M,vals:t.slope.map(v=>v===v?v:-1),color:v=>hexC(SLOPE_BINS.find(b=>v<b.m).c)};},
  body:m=>pathEl(bldD(m),'fill="#000" fill-opacity=".1"'),legend:()=>SLOPE_BINS.map(b=>({c:b.c,t:b.t}))},
 {key:'aspect',en:'ASPECT',ko:'경사 방향',need:m=>m.contours.length?'':TOPO_NEED,note:'비탈이 내려가는 방향(8방위) · 가파를수록 진하게 · 3° 미만 평지는 칠하지 않음',
  // 값 = 방위 칸(0~7) + 가파른 정도(0~0.99).
  raster:m=>{const t=terrainFor(m);return {M:t.M,vals:t.slope.map((s,k)=>s===s&&s>=3?Math.round(t.aspect[k]/45)%8+Math.min(.99,s/20):-1),color:v=>mixBg(ASPECT_C[Math.floor(v)].c,.35+.65*(v%1))};},
  body:m=>pathEl(bldD(m),'fill="#000" fill-opacity=".1"'),legend:()=>ASPECT_C.map(a=>({c:a.c,t:a.t+' 향'}))},
 {key:'buildings',en:'BUILDINGS',ko:'건물',body:m=>pathEl(bldD(m),'fill="#111"'),legend:()=>[{c:'#111',t:'건물'}]},
 {key:'height',en:'BUILDING HEIGHT',ko:'건축물 높이',body:m=>binFill(m,HEIGHT_BINS,b=>HEIGHT_BINS.findIndex(x=>x.test(b.h))),legend:()=>HEIGHT_BINS.map(b=>({c:b.c,t:b.t}))},
 {key:'high',en:'HIGH-RISE',ko:'고층(35m 이상)',body:m=>pathEl(bldD(m,b=>!(b.h>=35)),'fill="#dcdcda"')+pathEl(bldD(m,b=>b.h>=35),'fill="#e5308c"'),legend:()=>[{c:'#e5308c',t:'35m 이상'},{c:'#dcdcda',t:'그 밖·미상'}]},
 {key:'lowrise',en:'LOW-RISE',ko:'저층(12m 이하)',body:m=>pathEl(bldD(m,b=>!(b.h!=null&&b.h<=12)),'fill="#dcdcda"')+pathEl(bldD(m,b=>b.h!=null&&b.h<=12),'fill="#9b59d0"'),legend:()=>[{c:'#9b59d0',t:'12m 이하'},{c:'#dcdcda',t:'그 밖·미상'}]},
 {key:'zoning',en:'ZONING',ko:'용도지역',need:zoneNeed('zone'),note:'국토교통부 도시계획정보(브이월드)',
  body:m=>catFill(zonesOf(m,'zone'),ZONING,pickName)+pathEl(bldD(m),'fill="#000" fill-opacity=".1"'),legend:m=>drawnCats(zonesOf(m,'zone'),ZONING,pickName)},
 {key:'use',en:'BUILDING USE',ko:'건축물 용도',need:m=>m.buildings.some(b=>b.use!==USE_UNKNOWN)?'':'용도 자료가 없습니다 — ⑥ [주변 건물·등고선 가져오기]를 다시 누르면 용도까지 받습니다.',
  body:m=>{const cats=[...USE_CATS,USE_UNKNOWN];return binFill(m,cats,b=>cats.indexOf(b.use));},legend:m=>[...USE_CATS,USE_UNKNOWN].filter(c=>m.buildings.some(b=>b.use===c)).map(c=>({c:c.c,t:c.t}))},
 {key:'age',en:'BUILDING AGE',ko:'준공 연대',need:m=>m.buildings.some(b=>b.year)?'':'사용승인 연도 자료가 없습니다(이 지역 GIS건물통합정보에 연도 칸이 비어 있거나 아직 받지 않음).',
  body:m=>pathEl(bldD(m,b=>!b.year),'fill="#e3e3e1"')+binFill(m,AGE_BINS,b=>b.year?AGE_BINS.findIndex(x=>b.year<x.m):-1),legend:()=>AGE_BINS.map(b=>({c:b.c,t:b.t})).concat([{c:'#e3e3e1',t:'미상'}])},
 {key:'district',en:'DISTRICTS & ZONES',ko:'구역·지구',need:zoneNeed('district'),note:'용도지구·지구단위계획구역(브이월드)',
  body:m=>pathEl(bldD(m),'fill="#000" fill-opacity=".08"')+catFill(zonesOf(m,'district'),DISTRICT,pickName,c=>`fill-opacity=".3" stroke="${c.c}" stroke-width="${f1(m.R*.006)}"`),
  legend:m=>drawnCats(zonesOf(m,'district'),DISTRICT,pickName)},
 {key:'planned',en:'PLANNED FACILITIES',ko:'도시계획시설',need:zoneNeed('facility'),note:'결정 고시된 도시계획시설(집행·미집행 포함, 브이월드)',
  body:m=>pathEl(bldD(m),'fill="#000" fill-opacity=".08"')+catFill(zonesOf(m,'facility'),PLANNED,pickFn,c=>`fill-opacity="${c.t==='도로'?.55:.85}"`),
  legend:m=>drawnCats(zonesOf(m,'facility'),PLANNED,pickFn)},
 {key:'plotsize',en:'PLOT SIZE',ko:'필지 규모',need:m=>m.parcels.length>1?'':'주변 지적이 없습니다 — ③ 주변 지적도를 먼저 그리세요.',
  body:m=>{const by=PLOT_BINS.map(()=>[]),road=[];for(const p of m.parcels)(p.role==='road'?road:by[PLOT_BINS.findIndex(b=>p.area<b.m)]).push(ptsD(p.pts));
   const st=`stroke="${BG}" stroke-width="${f1(m.R*.004)}"`;return pathEl(road.join(''),`fill="#e6e6e3" ${st}`)+PLOT_BINS.map((b,i)=>pathEl(by[i].join(''),`fill="${b.c}" ${st}`)).join('');},
  legend:()=>PLOT_BINS.map(b=>({c:b.c,t:b.t})).concat([{c:'#e6e6e3',t:'도로'}])},
 {key:'cadastral',en:'CADASTRAL',ko:'지적',need:m=>m.parcels.length>1?'':'주변 지적이 없습니다 — ③ 주변 지적도를 먼저 그리세요.',
  body:m=>pathEl(m.siteRings.map(ptsD).join(''),`fill="${ACCENT}" fill-opacity=".16"`)+pathEl(m.parcels.filter(p=>p.role!=='site').map(p=>ptsD(p.pts)).join(''),`fill="none" stroke="#d08466" stroke-width="${f1(m.R*.003)}"`),
  legend:()=>[{c:'#d08466',t:'필지 경계',k:'line'},{c:ACCENT,t:'대지'}]},
 {key:'heat',en:'DENSITY',ko:'밀도(용적률)',need:m=>m.buildings.length?'':'주변 건물이 없습니다 — [주변 건물 가져오기]를 먼저 누르세요.',
  note:'격자 연면적 ÷ 격자 면적. 연면적 = 건물통합정보 연면적, 없으면 바닥면적 × 층수',
  body:m=>{const {cs,cells}=densityCells(m),by=FAR_BINS.map(()=>[]);for(const c of cells)by[FAR_BINS.findIndex(b=>c.far<b.m)].push(`M${c.x} ${c.y}h${cs}v${cs}h${-cs}Z`);
   return FAR_BINS.map((b,i)=>pathEl(by[i].join(''),`fill="${b.c}" stroke="${BG}" stroke-width="${f1(m.R*.003)}"`)).join('')+pathEl(bldD(m),`fill="none" stroke="#000" stroke-opacity=".2" stroke-width="${f1(m.R*.002)}"`);},
  legend:()=>FAR_BINS.map(b=>({c:b.c,t:b.t}))},
 {key:'sunhours',en:'SUN HOURS',ko:'일조시간(동지)',heavy:true,need:m=>m.buildings.length?'':'주변 건물이 없습니다 — ⑥ [주변 건물·등고선 가져오기]를 먼저 누르세요.',
  raster:m=>{const g=gridFor(m),M=150;return {M,vals:sunHours(g,M,m.lat),color:h=>lerpC(SUN_C,h/6)};},body:m=>pathEl(bldD(m),'fill="#bdbdbb"'),
  legend:()=>[{c:SUN_C[0],t:'0시간'},{c:SUN_C[2],t:'2시간'},{c:SUN_C[4],t:'4시간'},{c:SUN_C[5],t:'6시간'}],note:'동지 진태양시 9~15시 · 30분 간격 · 건물만(지형 제외)'},
 {key:'skyview',en:'SKY VIEW',ko:'개방감',heavy:true,need:m=>m.buildings.length?'':'주변 건물이 없습니다 — ⑥ [주변 건물·등고선 가져오기]를 먼저 누르세요.',
  raster:m=>{const g=gridFor(m),M=130;return {M,vals:skyView(g,M,150,24),color:v=>lerpC(SKY_C,v)};},body:m=>pathEl(bldD(m),'fill="#bdbdbb"'),
  legend:()=>[{c:SKY_C[0],t:'막힘'},{c:SKY_C[2],t:'반'},{c:SKY_C[4],t:'트임'}],note:'천공률 — 반경 150m 안 건물이 가리는 하늘을 뺀 비율'},
 {key:'roads',en:'ROADS',ko:'도로 위계',need:zoneNeed('facility'),note:'도시계획 도로(광로·대로·중로·소로) · 그 밖의 길은 지적의 도로 필지',
  body:m=>pathEl(bldD(m),'fill="#d9d9d6"')+pathEl(m.parcels.filter(p=>p.role==='road').map(p=>ptsD(p.pts)).join(''),'fill="#e8e3d6"')
   +ROAD_CLASS.slice().reverse().map(c=>pathEl(roadZones(m).filter(z=>c.m.test(z.name)).map(z=>ringsD(z.rings)).join(''),`fill="${c.c}" fill-rule="evenodd"`)).join('')
   +pathEl(railZones(m).map(z=>ringsD(z.rings)).join(''),'fill="#e5308c" fill-opacity=".75" fill-rule="evenodd"'),
  legend:()=>ROAD_CLASS.map(c=>({c:c.c,t:c.t})).concat([{c:'#e8e3d6',t:'그 밖 도로(지적)'},{c:'#e5308c',t:'철도'}])},
 {key:'blocks',en:'BLOCKS',ko:'가구(街區)',need:zoneNeed('facility'),note:'도로 필지와 도시계획 도로·철도를 뺀 땅 = 가구',
  body:m=>`<circle r="${m.R}" fill="#c9cfd6"/>`+pathEl(bldD(m),'fill="#9aa4ae"')
   +pathEl(m.parcels.filter(p=>p.role==='road').map(p=>ptsD(p.pts)).join('')+[...roadZones(m),...railZones(m)].map(z=>ringsD(z.rings)).join(''),`fill="${BG}"`),
  legend:()=>[{c:'#c9cfd6',t:'가구(도로로 둘러싸인 땅)'},{c:'#9aa4ae',t:'건물'},{c:BG,t:'도로·철도'}]},
 {key:'green',en:'PARKS & WATER',ko:'공원·녹지·하천',need:m=>m.zones==null?ZONE_WAIT:m.zoneErrors?.water?`하천 자료를 받지 못했습니다: ${m.zoneErrors.water} — 아래 [도시계획 자료 다시 받기]를 누르세요.`:'',
  note:'공원·녹지·공공공지(도시계획시설) · 녹지지역(용도지역) · 하천(브이월드 하천망)',
  body:m=>pathEl(bldD(m),'fill="#d6d6d3"')+pathEl(zonesOf(m,'zone').filter(z=>/녹지/.test(z.name)).map(z=>ringsD(z.rings)).join(''),'fill="#cbe8b5" fill-rule="evenodd"')
   +pathEl(zonesOf(m,'facility').filter(z=>GREEN_RE.test(z.name)).map(z=>ringsD(z.rings)).join(''),'fill="#5fae5a" fill-rule="evenodd"')
   +pathEl(zonesOf(m,'water').map(z=>ringsD(z.rings)).join(''),'fill="#8cc4e8" fill-rule="evenodd"'),
  legend:()=>[{c:'#5fae5a',t:'공원·녹지(시설)'},{c:'#cbe8b5',t:'녹지지역'},{c:'#8cc4e8',t:'하천'},{c:'#d6d6d3',t:'건물'}]},
];
const grids=new WeakMap();
function gridFor(m){if(!grids.has(m)){const H=m.R*1.06;grids.set(m,heightGrid(m.buildings,H,Math.max(1.5,2*H/600)));}return grids.get(m);}

/** 래스터 패널의 값 → RGBA 화소(브라우저 밖 시험에서도 돈다). */
export function rasterPixels({M,vals,color}){
 const px=new Uint8ClampedArray(M*M*4);
 for(let k=0;k<M*M;k++){if(vals[k]<0)continue;const [r,g,b]=color(vals[k]),o=k*4;px[o]=r;px[o+1]=g;px[o+2]=b;px[o+3]=255;}
 return px;
}
function rasterHref(r,doc=globalThis.document){
 const c=doc.createElement('canvas');c.width=c.height=r.M;const g=c.getContext('2d'),im=g.createImageData(r.M,r.M);
 im.data.set(rasterPixels(r));g.putImageData(im,0,0);return c.toDataURL('image/png');
}

/** 도판 한 장의 SVG. opts.background=false 면 바탕 원을 빼고(도면 뒤에 깔 때) 표식만 남긴다. */
export function diagramSVG(model,key,{background=true,legend=false,title=false,rasterHref:toHref=rasterHref,size=900}={}){
 const p=ANALYSIS_PANELS.find(x=>x.key===key);if(!p)throw Error('알 수 없는 도판: '+key);
 const R=model.R,H=R*1.06,u=2*H/size,id='sa-clip-'+key;
 let body='';
 if(p.raster){const r=p.raster(model);body+=`<image href="${toHref(r)}" x="${f1(-H)}" y="${f1(-H)}" width="${f1(2*H)}" height="${f1(2*H)}" preserveAspectRatio="none" style="image-rendering:auto"/>`;}
 body+=p.body(model);
 const tri=22*u,mark=`<path d="M0 0L${f1(-tri/2)} ${f1(-tri*.9)}L${f1(tri/2)} ${f1(-tri*.9)}Z" fill="${ACCENT}"/>`;
 let deco='';
 if(title)deco+=`<text x="${f1(-H+14*u)}" y="${f1(-H+28*u)}" font-family="${MONO}" font-size="${f1(15*u)}" fill="#1f2937" font-weight="500">${esc(p.en)}<tspan fill="#6b7280" font-weight="400"> ${esc(p.ko)}</tspan></text>`;
 if(legend){const items=p.legend(model).slice(0,9),lh=18*u,x=H-160*u;let y=H-16*u-items.length*lh;
  deco+=`<rect x="${f1(x-8*u)}" y="${f1(y-6*u)}" width="${f1(160*u)}" height="${f1(items.length*lh+10*u)}" fill="#fff" fill-opacity=".85" rx="${f1(4*u)}"/>`;
  for(const it of items){deco+=`<rect x="${f1(x)}" y="${f1(y+2*u)}" width="${f1(12*u)}" height="${f1(it.k==='line'?3*u:11*u)}" fill="${it.c}"/><text x="${f1(x+18*u)}" y="${f1(y+12*u)}" font-family="${MONO}" font-size="${f1(11*u)}" fill="#1f2937">${esc(it.t)}</text>`;y+=lh;}}
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f1(-H)} ${f1(-H)} ${f1(2*H)} ${f1(2*H)}" width="${size}" height="${size}">`
  +`<defs><clipPath id="${id}"><circle r="${R}"/></clipPath></defs>`
  +(background?`<circle r="${R}" fill="${BG}"/>`:'')
  +`<g clip-path="url(#${id})" stroke-linejoin="round">${body}</g>`
  +pathEl(model.siteRings.map(ptsD).join(''),`fill="none" stroke="${ACCENT}" stroke-width="${f1(2*u)}"`)+mark+deco+'</svg>';
}

/** 도면 뒤에 깔 아핀: 도면 mm → 그림 화소(size×size). 그림 왼쪽 위 = (−H, −H) m = 도면 (cx−H, cy+H) mm. */
export function overlayAffine(model,size=1600){
 const H=model.R*1.06,k=size/(2*H*1000);
 return [k,0,0,-k,-(model.center.x-H*1000)*k,(model.center.y+H*1000)*k];
}

/** SVG 문자열 → PNG data URL(브라우저). */
export async function svgToPngDataUrl(svg,size,doc=globalThis.document){
 const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
 try{
  const img=new Image();await new Promise((ok,no)=>{img.onload=ok;img.onerror=()=>no(Error('도판 그림을 만들지 못했습니다.'));img.src=url;});
  const c=doc.createElement('canvas');c.width=c.height=size;c.getContext('2d').drawImage(img,0,0,size,size);return c.toDataURL('image/png');
 }finally{URL.revokeObjectURL(url);}
}

/** data URL → Blob. fetch(dataURL)은 index.html CSP(connect-src 에 data: 없음)에 막혀 [PNG 저장]이 실패했다(2026-10-22 검토). */
export function dataUrlToBlob(dataUrl){
 const m=/^data:([^;,]+)(;base64)?,(.*)$/s.exec(String(dataUrl));
 if(!m)throw Error('도판 그림 자료가 올바르지 않습니다.');
 const bytes=m[2]?Uint8Array.from(atob(m[3]),c=>c.charCodeAt(0)):new TextEncoder().encode(decodeURIComponent(m[3]));
 return new Blob([bytes],{type:m[1]});
}

/** 도면 뒤에 깔 배경 그림(setBackgroundMap 형식). 바탕 원 없이 반투명. */
export async function overlayMap(model,key,{size=1600}={}){
 const svg=diagramSVG(model,key,{background:false,size}).replace('<g clip-path','<g opacity=".78" clip-path');
 const p=ANALYSIS_PANELS.find(x=>x.key===key);
 return {image:await svgToPngDataUrl(svg,size),affine:overlayAffine(model,size),layer:'Analysis',label:p.ko,attribution:`${p.ko} · ${ANALYSIS_ATTRIBUTION}`};
}

/* ─────────────── 상권 · 추천 용도(홈페이지 계산) ─────────────── */
/** 건축법 시행령 별표1 호 번호 → 용도 이름(usability 코드 = 호 × 1000). */
export const BYEOLPYO1=['','단독주택','공동주택','제1종근린생활시설','제2종근린생활시설','문화및집회시설','종교시설','판매시설','운수시설','의료시설','교육연구시설',
 '노유자시설','수련시설','운동시설','업무시설','숙박시설','위락시설','공장','창고시설','위험물저장및처리시설','자동차관련시설','동물및식물관련시설',
 '자원순환관련시설','교정및군사시설','방송통신시설','발전시설','묘지관련시설','관광휴게시설','장례시설','야영장시설'];
const useNameOf=b=>{const n=parseInt(String(b.useCode||'').slice(0,2),10);return BYEOLPYO1[n]||b.useName||'';};
/** 추천 용도 입력: 대지 둘레 radiusM 안 건물의 용도별 동수·평균 층수(모르는 용도는 빼고 따로 센다). */
export function useStats(model,radiusM=100){
 const near=model.buildings.filter(b=>Math.hypot(...b.c)<=radiusM),by=new Map();let unknown=0;
 for(const b of near){const name=useNameOf(b);if(!name){unknown++;continue;}const r=by.get(name)||{use:name,count:0,floors:0,n:0};r.count++;if(b.floors){r.floors+=b.floors;r.n++;}by.set(name,r);}
 const stats=[...by.values()].sort((a,b)=>b.count-a.count).slice(0,12).map(r=>({use:r.use,count:r.count,avgFloors:r.n?Math.round(r.floors/r.n*10)/10:0}));
 return {stats,total:near.length,unknown,radiusM};
}
/** 추천 용도 요청 본문(대지 상태 → 홈페이지 /api/use-recommend). */
export function recommendRequest(model,site){
 const info=site?.landInfo||{},zone=info.massing?.zoneName||(info.zoneNames||[])[0];
 const {stats,total}=useStats(model);
 return {action:'use-recommend',address:site?.address||'',zoneNames:[...new Set([zone,...(info.zoneNames||[])].filter(Boolean))],lotAreaM2:Math.round((site?.areaM2||0)*10)/10,
  jiga:Number(info.officialPrice||info.jiga)||null,stats,totalBuildings:total};
}
export function marketSection({model,site,api,state,el,rerender}){
 const box=el('section','site-analysis-market');
 box.append(el('h4',null,'상권 · 추천 용도'));
 const row=el('div','plan-step-actions'),busy=state.marketBusy;
 // 응답은 최대 110초 걸린다. 그사이 대지가 바뀌면(state.marketSite 가 바뀜) 옛 대지의 답을 새 대지에 붙이지 않는다.
 const button=(label,key,run)=>{const b=el('button',null,busy===key?label+' 중…':label);b.type='button';b.disabled=!!busy;b.onclick=async()=>{
  const forSite=state.marketSite,same=()=>state.marketSite===forSite;state.marketBusy=key;state.marketError='';rerender();
  try{const out=await run();if(same())state[key]=out;}catch(e){if(same())state.marketError=String(e?.message||e);}finally{state.marketBusy='';rerender();}};row.append(b);};
 button('주변 상권(음식점 등)','market',()=>api('parcel',{action:'market',address:site?.address||''}));
 button('추천 용도','recommend',()=>api('parcel',recommendRequest(model,site)));
 box.append(row);
 if(state.marketError)box.append(el('p','plan-step-note is-warn',state.marketError));
 const m=state.market;
 if(m?.상권){
  box.append(el('p','plan-step-note',`반경 ${m.상권.반경m||1000}m 점포 ${Number(m.상권.총점포||0).toLocaleString()}곳`+(m.상권.주의?' · '+m.상권.주의:'')));
  const table=el('div','site-analysis-biz');
  for(const r of (m.전체||[]).slice().sort((a,b)=>b.near-a.near)){
   const line=el('div','site-analysis-biz-row'+(r.level==='부족'?' is-short':r.level==='많음'?' is-crowded':''));
   line.append(el('span',null,r.name),el('b',null,r.near+(r.nearCapped?'+':'')+'곳'),el('i',null,r.level));table.append(line);
  }
  box.append(table);
  if(m.후보?.length){box.append(el('p','plan-step-note','추천 업종'));
   for(const c of m.후보){const card=el('div','site-analysis-pick');card.append(el('strong',null,`${c.name} · ${c.자리}`),el('span',null,c.상권평||''),el('span',null,c.자리설명||''));box.append(card);}}
  if(m.disclaimer)box.append(el('p','plan-step-note',m.disclaimer));
 }
 const r=state.recommend;
 if(r?.구성){
  box.append(el('p','plan-step-note','추천 용도 구성(저층 → 상층)'+(r.세대수?` · 약 ${r.세대수}세대`:'')));
  for(const c of r.구성){const card=el('div','site-analysis-pick');card.append(el('strong',null,[c.용도명,c.세부].filter(Boolean).join(' · ')),el('span',null,c.역할||''));box.append(card);}
  if(r.이유)box.append(el('p','plan-step-note',r.이유));
  if(r.유의점?.length)box.append(el('p','plan-step-note','유의: '+r.유의점.join(' / ')));
  const {stats,total,unknown}=useStats(model);
  box.append(el('p','plan-step-note',`근거: 대지 둘레 100m 건물 ${total}동(용도 미상 ${unknown}) — `+stats.slice(0,4).map(s=>`${s.use} ${s.count}`).join(', ')));
 }
 return box;
}

/* ─────────────── 단계 화면 ─────────────── */
// 카드 그림은 PNG 그림(img)으로 넣는다: SVG(글 속이든 img 든)는 건물 3천 동이면 칸 위에서 마우스가 움직일 때마다 다시 칠해 0.3~1초씩 걸렸다(10-28 설명서 녹화).
// 먼저 SVG 로 바로 보이고, 뒤에서 한 번 PNG 로 구워 바꾼다(브라우저 밖 시험에는 Image 가 없어 SVG 그대로).
const baking=new Set();
function thumbSrc(model,key,state,rerender){
 const hit=state.analysisCache[key];if(hit)return hit;
 const svg=diagramSVG(model,key,{size:300}),url='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);state.analysisCache[key]=url;
 if(globalThis.Image&&!baking.has(url)){baking.add(url);svgToPngDataUrl(svg,300).then(png=>{if(state.analysisCache[key]===url){state.analysisCache[key]=png;rerender();}},()=>{}).finally(()=>baking.delete(url));}
 return url;
}
/** 계획 탭 단계 본문: 도판 카드 격자. 카드를 누르면 크게 보기 창. */
export function renderAnalysisGallery({doc,el,state,rerender,setBackgroundMap,getBackgroundMap,download,toast=()=>{},site=null,api=null,radius=null,radii=[],pickRadius=null}){
 const model=state.analysisModel;
 const wrap=el('div','plan-step-body site-analysis');
 if(!model){wrap.append(el('p','plan-step-note','도판을 만드는 중…'));return wrap;}
 if(pickRadius&&radii.length){
  const row=el('div','site-analysis-radius');row.append(el('span',null,'반경'));
  for(const r of radii){const b=el('button',r===radius?'is-on':'',`${r}m`);b.type='button';b.setAttribute('aria-pressed',String(r===radius));b.onclick=()=>r!==radius&&pickRadius(r);row.append(b);}
  wrap.append(row);
 }
 wrap.append(el('p','plan-step-note',`반경 ${model.R}m · 건물 ${model.counts.buildings}동 · 필지 ${model.counts.parcels}개`));
 if(radius&&model.fetchedR&&model.fetchedR<radius)wrap.append(el('p','plan-step-note is-warn',`주변 건물은 둘레 ${model.fetchedR}m까지만 들어 있습니다 — 아래 [주변 ${radius}m로 다시 가져오기]를 누르세요.`));
 const grid=el('div','site-analysis-grid');
 const bg=getBackgroundMap?.();
 for(const p of ANALYSIS_PANELS){
  const card=el('button','site-analysis-card'+(bg?.layer==='Analysis'&&bg.label===p.ko?' is-on':''));card.type='button';card.dataset.key=p.key;
  const missing=p.need?.(model)||'';
  const thumb=el('div','site-analysis-thumb');
  if(missing)thumb.append(el('span','site-analysis-empty','자료 없음'));
  else if(p.heavy&&!state.analysisCache?.[p.key])thumb.append(el('span','site-analysis-empty','눌러서 계산'));
  else{const img=el('img');img.alt='';img.style.cssText='width:100%;height:100%;display:block';img.src=thumbSrc(model,p.key,state,rerender);thumb.append(img);}
  card.append(thumb,el('span','site-analysis-name',p.ko));
  card.title=missing||p.note||p.ko;
  card.onclick=()=>{
   if(missing){toast(missing);return;}
   if(p.heavy&&!state.analysisCache[p.key]){card.querySelector('.site-analysis-empty').textContent='계산 중…';setTimeout(()=>{thumbSrc(model,p.key,state,rerender);rerender();},20);return;}
   openAnalysisDialog({model,key:p.key,el,setBackgroundMap,download,toast,onChange:rerender});
  };
  grid.append(card);
 }
 wrap.append(grid);
 if(api)wrap.append(marketSection({model,site,api,state,el,rerender}));
 return wrap;
}

export function openAnalysisDialog({model,key,el,setBackgroundMap,download,toast=()=>{},onChange=()=>{},doc=globalThis.document}){
 const p=ANALYSIS_PANELS.find(x=>x.key===key);
 const dialog=el('dialog','site-analysis-dialog');
 const head=el('div','site-analysis-head');head.append(el('strong',null,`${p.en} · ${p.ko}`));
 const close=el('button',null,'닫기 ×');close.type='button';close.onclick=()=>dialog.close();head.append(close);
 const view=el('div','site-analysis-view');view.innerHTML=diagramSVG(model,key,{size:900});
 const legend=el('div','site-analysis-legend');
 for(const it of p.legend(model)){const s=el('span');const i=el('i');i.style.background=it.c;if(it.k==='line')i.className='line';s.append(i,it.t);legend.append(s);}
 const note=el('p','plan-step-note',[p.note,`반경 ${model.R}m · ${ANALYSIS_ATTRIBUTION}`].filter(Boolean).join(' · '));
 const actions=el('div','plan-step-actions');
 const btn=(label,primary,run)=>{const b=el('button',primary?'primary':'',label);b.type='button';b.onclick=async()=>{b.disabled=true;try{await run();}catch(e){toast(String(e?.message||e));}finally{b.disabled=false;}};actions.append(b);return b;};
 btn('도면 뒤에 깔기',true,async()=>{setBackgroundMap(await overlayMap(model,key));toast(`${p.ko} 도판을 도면 뒤에 깔았습니다(도면 파일은 바뀌지 않음). [배경 끄기]로 지웁니다.`);onChange();dialog.close();});
 btn('배경 끄기',false,async()=>{setBackgroundMap(null);onChange();});
 const name=`대지분석_${String(ANALYSIS_PANELS.indexOf(p)+1).padStart(2,'0')}_${p.ko.replace(/[^\w가-힣]/g,'')}`;
 btn('SVG 저장',false,async()=>download(diagramSVG(model,key,{size:900,legend:true,title:true}),name+'.svg','image/svg+xml'));
 btn('PNG 저장',false,async()=>{const url=await svgToPngDataUrl(diagramSVG(model,key,{size:2000,legend:true,title:true}),2000,doc);download(dataUrlToBlob(url),name+'.png','image/png');});
 dialog.append(head,view,legend,note,actions);
 dialog.addEventListener('keydown',e=>e.stopPropagation());
 dialog.addEventListener('close',()=>dialog.remove());
 doc.body.append(dialog);dialog.showModal();
 return dialog;
}
