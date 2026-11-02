// 계획 — 오른쪽 막대의 '계획' 탭 (미리보다 웹 신축 검토 화면의 CAD 판).
//
//  ① 대지 선택      주소·지번 검색(/api/public/address-search) → 필지 담기 → 지적 조회(VWorld, 로컬 엔진)
//                   또는 도면의 닫힌 경계를 대지로 지정(auto-plan.js siteBoundaryCandidates)
//  ② 대지 정보 카드 면적(지적 계산 / 건축물대장) · 용도지역·지역지구 · 건폐율/용적률 · 최대 규모 · 허가유형
//                   (VWorld getLandUseAttr + /api/public/plan-check, 대장은 /api/public/check)
//  ③ 주변 지적도    반경 30~100m, EPSG:5187, 표준 레이어(A-SITE·A-SITE-ROAD·A-SITE-PARCEL·A-SITE-TEXT), 지번 문자, drawingGeo 기록, 검토용 문구
//  ④ 지도           탭 안 미니맵(일반·위성) · 도면 뒤 배경 지도(브이월드 WMTS, parcel.basemap)
//  ⑤ 대지분석       건물·높이·용도·연대·필지·지적·일조·개방감 도판(site-analysis.js) · 도면 뒤에 깔기 · SVG·PNG
//  ⑥ 계획안         용도·층수·목표 연면적 → /site-plan/generate(설계엔진) 3안 → 후보 카드 → [도면으로 가져오기]
//  ⑦ 3D(주변 건물·5m 등고선·계획 매스, site-3d.js)
//  ⑧ 미리보다       대지·계획 요약만 미리에게 보내 검토(도면 수정 없음) · AI 설계 · 토지·법규 검토
//
// 원격 호출은 모두 로컬 엔진 경로(studio.api)로만 한다(렌더러 CSP). 비밀 키는 이 파일에 오지 않는다.
// 도면을 바꾸는 단계는 명령 한 번(Ctrl+Z 한 번)이다: parcel.import · parcel.info · document.update · load.
// 단계는 PLAN_STEPS 의 모듈 하나씩이다({id,title,hint,evaluate,actions,render?,disabled?}). 새 단계는 끼워 넣으면 된다.
import {lockedImport} from './screen-vault.js';
import {isContract10} from './site-contract.js';
import {contractPlanPanel} from './site-plan-contract-panel.js';
import {contractReplacementOptions,isContractCandidateSet} from './site-plan-results.js';
import * as G from './geometry.js';
import {mergeCandidates,mergeRings,mergeSiteCommand,mergeFetchedEntities} from './site-merge.js';
import {planCheck} from './livecheck-auto.js';
// 배치 품질 판정은 바른 서버에서. 답이 오기 전에는 '검사 중' 칸을 보이고, 답이 오면(PLAN_QUALITY_EVENT) 다시 그린다.
import {planQualityNow,PLAN_QUALITY_EVENT} from './plan-quality-client.js';
import {planQualityPanel} from './plan-quality-panel.js';
import {apartmentView} from './apartment-panel.js';
import {withSitePlanWait,revealSitePlan} from './site-plan-wait.js';
import {attachSitePlan,generateAlternativePlans,generatePlanVariants,planSummary,planValueSources,setPlanValueSources,recordPlanValues} from './site-plan.js';

export const PLAN_TAB_LABEL='계획';
export const PLAN_PANEL_ID='plan-side-panel';
export const ACCOUNT_LABEL='바른 계정';
export const LOGIN_REQUIRED_MESSAGE=`로그인 필요: 오른쪽 위 [계정 연결]에서 카카오(또는 구글)로 한 번 로그인하면 지적·토지정보·설계엔진·계획안이 모두 됩니다. 위쪽 [바른 계정 로그인]을 눌러도 같은 창이 열립니다.`;
export const ENGINE_LOGIN_MESSAGE='설계엔진 연결 필요: '+LOGIN_REQUIRED_MESSAGE.replace(/^로그인 필요: /,'');
export const ENGINE_OFFLINE_MESSAGE='설계엔진 연결 필요: 로컬 엔진 또는 인터넷 연결을 확인하세요.';
export const REVIEW_NOTE='검토용 — 연속지적도 기반, 지적측량 성과 아님';
export const RADIUS_OPTIONS=[10,20,30,50,100,200];
/** 설계엔진(SPEC v0.5.3)이 받는 용도. 주택·오피스텔은 세대수 기준이라 엔진이 아직 받지 않는다(422). */
export const PLAN_USES=['근린생활시설','업무시설','판매시설'];
export const STATE_LABELS=Object.freeze({todo:'할 일',blocked:'대기',running:'진행 중',waiting:'창에서 계속',done:'완료',error:'오류',later:'다음 단계'});

const GEO_CRS=['EPSG:5179','EPSG:5187'];
const siteRing=e=>e.parcelRole==='site'&&e.attributes?.ring!=='hole';
const areaM2=entities=>entities.reduce((sum,e)=>{const a=Array.isArray(e.points)&&e.points.length>=3?G.polygonArea(e.points)/1e6:0;return sum+(e.attributes?.ring==='hole'?-a:a);},0);
const num=(v,d=1)=>Number.isFinite(Number(v))&&v!==null&&v!==''?Number(v).toFixed(d):null;

function siteParcels(sites){
 const parcels=new Map();
 for(const e of sites){
  const a=e.attributes||{};if(e.parcelRole==='label'||a.ring==='hole')continue;
  const pnus=a.sitePnus||[a.pnu],jibuns=a.siteJibuns||[a.jibun];
  pnus.forEach((p,i)=>{if(p&&(!parcels.has(p)||parcels.get(p)===p))parcels.set(p,jibuns[i]||p);});
 }
 return {pnus:[...parcels.keys()],jibuns:[...parcels.values()]};
}
// 새로 조회한 대지는 도면에 그릴 때까지 조회 자료로만 다룬다.
const usesFetchedSite=(site,fetched)=>!!fetched&&(site?.kind!=='parcel'||fetched.pendingSite===true);
const mergeEntities=ctx=>usesFetchedSite(ctx.site,ctx.state.fetched)?ctx.state.fetched.entities||[]:G.parcelEntities(ctx.engine.doc.entities);
const signedPct=n=>(n<0?'−':'+')+Math.abs(n).toFixed(1)+'%';
async function mergeSite(ctx,candidate){
 const site=ctx.site(),fetched=ctx.state.fetched,drawn=site.kind==='parcel'&&!usesFetchedSite(site,fetched);
 const entities=drawn?G.parcelEntities(ctx.engine.doc.entities):fetched?.entities||[];
 const data=siteInfo(site,drawn?null:fetched),basePnu=data?.pnu;
 const pnus=[...new Set([...(data?.pnus||[]),...(candidate?.pnus||[])])];
 const ledgerM2=ctx.state.ledger[basePnu]?.lotAreaM2||null;
 const snapshot=ctx.engine.doc;
 if(drawn){
  // parcelEntities는 블록 자식에만 parcelBlockId를 붙인다. 전체 도면 ID 집합은 만들지 않는다.
  if(entities.some(e=>pnus.includes(e.attributes?.pnu)&&['site','neighbor'].includes(e.parcelRole)&&e.parcelBlockId))
   throw Error('블록으로 묶인 지적도입니다. 분해(EXPLODE)한 뒤 합치세요.');
 }
 const union=await ctx.api('parcel',{action:'union',rings:mergeRings(entities,pnus)});
 if(ctx.engine.doc!==snapshot)throw Error('필지를 합치는 동안 도면이 바뀌었습니다. 다시 합치세요.');
 if(!drawn&&ctx.state.fetched!==fetched)throw Error('필지를 합치는 동안 조회 결과가 바뀌었습니다. 다시 합치세요.');
 const options={pnus,ring:union.ring,ledgerM2},names=siteParcels(entities.filter(e=>pnus.includes(e.attributes?.pnu))).jibuns;
 if(drawn)ctx.execute(mergeSiteCommand(entities,{...options,layers:ctx.engine.doc.layers,siteAnalysis:ctx.engine.doc.siteAnalysis}));
 else {ctx.state.fetched={...fetched,entities:mergeFetchedEntities(entities,options)};ctx.state.siteMerge={basePnu,...options};}
 ctx.state.plans=[];
 return `${names.join(' + ')} 을 한 대지(${union.areaM2.toFixed(1)}㎡)로 합쳤습니다. 원래 필지선은 A-SITE-PARCEL 에 남깁니다.${drawn?' Ctrl+Z 한 번으로 되돌립니다.':' ③에서 도면에 그리면 Ctrl+Z 한 번으로 되돌립니다.'}`+(union.warnings?.length?' '+union.warnings.join(' '):'');
}

/** 도면에서 지금 대지를 읽는다. 주소로 불러온 대지(parcel)가 먼저, 없으면 계획 탭에서 지정한 경계(planSite). */
export function planSiteState(doc,{findParcel=G.findParcelEntity,parcelEntities=G.parcelEntities}={}){
 const entities=doc?.entities||[];
 const site=findParcel(entities,siteRing,'site');
 if(site){
  const all=parcelEntities(entities).filter(e=>e.parcelRole);
  const pnu=site.attributes?.pnu||'';
  const sites=all.filter(e=>e.parcelRole==='site');
  const {pnus,jibuns}=siteParcels(sites);
  const counts={site:0,road:0,neighbor:0};for(const e of all)if(e.parcelRole in counts&&e.attributes?.ring!=='hole')counts[e.parcelRole]++;
  const info=site.attributes?.landInfo||null;
  return {kind:'parcel',pnu,pnus,jibuns,address:info?.address||site.attributes?.jibun||'',areaM2:areaM2(sites),counts,landInfo:info,crs:site.attributes?.sourceCRS||'',
   hasCRS:GEO_CRS.includes(site.attributes?.sourceCRS)&&Array.isArray(site.attributes?.originMetres),labels:all.some(e=>e.parcelRole==='label'),
   drawingGeo:doc?.drawingGeo||null,infoTable:!!pnu&&entities.some(e=>e.siteInfoPnu===pnu),entityIds:sites.map(e=>e.parcelBlockId||e.id)};
 }
 const saved=doc?.planSite;
 if(saved?.source==='drawing'&&Array.isArray(saved.entityIds)&&saved.entityIds.length){
  const wanted=new Set(saved.entityIds),found=entities.filter(e=>wanted.has(e.id));
  return {kind:'drawing',pnu:'',address:saved.address||'',areaM2:found.length?areaM2(found.map(e=>({points:e.points}))):saved.areaM2||0,counts:{site:found.length,road:0,neighbor:0},landInfo:null,hasCRS:false,infoTable:false,entityIds:saved.entityIds,missing:found.length!==saved.entityIds.length};
 }
 return {kind:null,counts:{site:0,road:0,neighbor:0},entityIds:[]};
}

/** 대지 한 줄 요약 */
export function siteLine(site){
 if(!site?.kind)return '아직 대지가 없습니다.';
 const parts=[site.address||(site.kind==='drawing'?'도면에서 지정한 경계':site.pnu||'주소 미확인')];
 if(site.areaM2>0)parts.push(`대지 ${site.areaM2.toFixed(1)}㎡`);
 if(site.pnus?.length>1)parts.push(`${site.pnus.length}필지`);
 if(site.kind==='parcel')parts.push(`도로 ${site.counts.road} · 인접 ${site.counts.neighbor}`);
 return parts.join(' · ');
}

/** 계획 결과가 도면에 있는가(계획안 sitePlan 또는 예전 자동배치 레이어). */
export function engineResultState(doc){
 const plan=!!doc?.sitePlan,auto=(doc?.layers||[]).some(l=>typeof l.name==='string'&&l.name.startsWith('자동배치_'));
 return {plan,auto,any:plan||auto,alternatives:doc?.sitePlanAlternatives?.length||0};
}

/** 조회 결과(fetched) 또는 도면 대지에서 카드에 쓸 토지 자료 */
export function siteInfo(site,fetched){
 if(usesFetchedSite(site,fetched)){
  const pnu=fetched.pnus?.[0]||fetched.pnu,info=fetched.landInfoByPnu?.[pnu]||fetched.landInfo||null;
  const sites=(fetched.entities||[]).filter(e=>e.parcelRole==='site');
  return {pnu,...siteParcels(sites),merged:sites.some(e=>e.attributes?.mergedSite),address:info?.address||sites[0]?.attributes?.jibun||'',cadastralM2:areaM2(sites),info,source:'조회됨 · 아직 도면에 그리지 않음'};
 }
 if(site?.kind==='parcel')return {pnu:site.pnu,pnus:site.pnus||[site.pnu],jibuns:site.jibuns,merged:site.counts.site===1&&site.pnus?.length>1,address:site.address,cadastralM2:site.areaM2,info:site.landInfo,source:'도면의 대지'};
 return null;
}

export const MAP_LAYERS=Object.freeze({Base:'일반',Satellite:'위성'});
/** 도면의 대지 경계(바깥 고리) 점들 [[x,y],…] (mm). */
export function siteRingsMm(doc){
 return G.parcelEntities(doc?.entities||[]).filter(e=>e.parcelRole==='site'&&e.attributes?.ring!=='hole'&&Array.isArray(e.points)).map(e=>e.points.map(p=>[p.x,p.y]));
}
/** 지도 요청: 대지 경계 상자를 margin(m)만큼 넓힌 범위. */
export function mapRequest(geo,rings,marginM,maxPx){
 const pts=rings.flat();if(!pts.length)throw Error('도면에서 대지 경계를 찾지 못했습니다.');
 const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),m=marginM*1000;
 return {crs:geo.crs,originM:geo.originM,bboxMm:[Math.min(...xs)-m,Math.min(...ys)-m,Math.max(...xs)+m,Math.max(...ys)+m],maxPx};
}

/** 도면에 넣은 주변 건물·등고선 수. */
export function surroundingCounts(doc){
 let buildings=0,contours=0;for(const e of G.parcelEntities(doc?.entities||[])){if(e.parcelRole==='building')buildings++;else if(e.parcelRole==='contour'||e.parcelRole==='contour-major')contours++;}
 return {buildings,contours};
}
/** 대지 정보 카드 행 [이름, 값, 강조] — 값이 없으면 없다고 적는다(지어내지 않는다). */
export function siteCardRows(data,ledger){
 if(!data)return [];
 // 합친 대지는 원래 필지 목록도 보여 준다.
 const info=data.info||{},mass=info.massing||{},limits=info.limits||{};
 return [
  ['주소',data.address||'미확인'],
  ...(data.pnus?.length>1?[['필지',`${(data.jibuns||data.pnus).join(' + ')} (1대지 ${data.pnus.length}필지${data.merged?' · 합친 대지':''})`]]:[]),
  ['대지면적 (지적)',data.cadastralM2>0?`${data.cadastralM2.toFixed(1)}㎡ · 연속지적도 경계 계산`:'—'],
  ['대지면적 (대장)',ledger?.lotAreaM2?`${ledger.lotAreaM2.toFixed(1)}㎡ · 건축물대장`:ledger?.message||'조회 전'],
  ['용도지역',mass.zoneName||(info.zoneNames||[])[0]||'미확인'],
  ['건폐율 / 용적률',`${limits.bcr??'미확인'}% / ${limits.far??'미확인'}%`],
  ['최대 건축면적 / 연면적',`${num(mass.maxBuildingAreaM2)??'—'}㎡ / ${num(mass.maxFloorAreaM2)??'—'}㎡`],
 ];
}

/** 설계엔진 계획안 요청: 도면 대지(로컬 from-drawing)가 만든 요청에 사용자가 고른 용도·층수·목표 연면적만 덧씌운다. */
export function planRequest(base,{use,floors,target},source='user'){
 if(!base?.site||base.site.crs!=='EPSG:5187')throw Error('설계엔진 요청을 만들지 못했습니다(대지 좌표계 EPSG:5187 필요).');
 if(!PLAN_USES.includes(use))throw Error('설계엔진이 받는 용도(근린생활시설·업무시설·판매시설)를 고르세요. 주택은 세대수 기준이라 아직 지원하지 않습니다.');
 const n=Number(floors);if(!Number.isInteger(n)||n<1||n>30)throw Error('층수는 1~30 정수로 입력하세요.');
 const request=structuredClone(base);
 request.program={...request.program,use,floors:n,floors_search:false,...(Number(target)>0?{target_gfa:Number(target)}:{})};
 setPlanValueSources(request,planValueSources(base));recordPlanValues(request,{use,floors:n,floors_search:false,...(Number(target)>0?{target_gfa:Number(target)}:{})},source,'계획 조건');
 return request;
}

/** 후보 카드 한 장의 요약 */
export function planCard(plan,quality=planQualityNow(plan.result,{request:plan.request})){
 const held=quality.stages.slice(0,3).some(s=>s.status!=='pass')||quality.stages[3].status==='held';
 const n=plan.result?.report?.numbers||{},checks=plan.result?.report?.checks||[];
 const issues=checks.filter(c=>!planCheck(c).ok&&c.severity!=='info');
 return {title:plan.title,note:plan.note,gfa:n.gfa??null,bcr:n.bcr??null,far:n.far??null,floors:n.floors??null,parking:`${n.parking_placed??'—'}대 / 기준 ${n.parking_required??'—'}대`,
  pass:!held&&!issues.length&&quality.stages[3].status!=='warning',held,quality,issues:held?quality.stages.filter(s=>s.status!=='pass'&&s.status!=='held').flatMap(s=>s.reasons):issues.map(c=>c.rule+(c.provisional?' (잠정)':'')),summary:planSummary(plan.result?.report||{})+(held?' · 앞 단계 확인 필요 · 법규 판정 보류':'')};
}

/* ─────────────── 상세 계획 ─────────────── */
export const DETAIL_SHAPES=[['rect','사각'],['L','L자'],['follow','이격선 따라']];
export const DETAIL_MASSINGS=[['max1f','1층 최대'],['uniform','균일']];
// 설계엔진 API 가 지금 받는 주차 방식은 전면·필로티. 나머지는 형태만 두고(엔진 반영 예정) 값을 그대로 보낸다.
export const DETAIL_PARKING=[['front','전면'],['piloti','필로티'],['general','일반 (예정)'],['front_piloti','전면 필로티 (예정)'],['underground','지하 (예정)'],['mechanical','기계식 (예정)']];
// 설계엔진 반영 예정(엔진 v24 는 지하주차·기계식·공동주택을 아직 다루지 않는다). CAD 는 값을 그대로 보낸다.
export const DETAIL_USES=[...PLAN_USES,'공동주택','오피스텔','다세대주택'];
// 엔진이 아직 받지 않는 조건: 보내면 422 로 하루 한도만 쓴다. 그 안은 보내지 않고 바로 '반영 예정'으로 표시한다.
const PLANNED_PARKING=new Set(['general','front_piloti','underground','mechanical']);
export function detailUnsupported(use,mode){
 if(!PLAN_USES.includes(use))return `${use}은(는) 설계엔진 반영 예정입니다(지금은 ${PLAN_USES.join('·')}).`;
 if(PLANNED_PARKING.has(mode))return `${labelOf(DETAIL_PARKING,mode).replace(' (예정)','')} 주차는 설계엔진 반영 예정입니다(지금은 전면·필로티).`;
 return '';
}
const labelOf=(list,value)=>list.find(([v])=>v===value)?.[1]||value;
const parcelArea=ps=>Math.abs(ps.reduce((s,p,i)=>{const q=ps[(i+1)%ps.length];return s+(p[0]-ps[0][0])*(q[1]-ps[0][1])-(q[0]-ps[0][0])*(p[1]-ps[0][1]);},0))/2;
/** 상세 계획 조건 → 설계엔진 요청 조합. 고른 바닥 모양·매스·주차 방식을 섞어 count 개까지. */
export function detailPlanVariants(base,{use=PLAN_USES[0],floorsMode='auto',floors=3,target='',shapes=['rect'],massings=['max1f'],parkingModes=['front'],entrySide='auto',count=3,valueSources}={}){
 if(!DETAIL_USES.includes(use))throw Error('용도를 고르세요.');
 const supplied=arguments[1]||{},source=(key)=>valueSources?.[key]||(Object.hasOwn(supplied,key)&&!valueSources?'user':'default');
 const z=base?.zoning||{},ps=base?.site?.parcel||[];
 if(!(z.far>0&&z.bcr>0))throw Error('상세 계획에는 확인된 용적률·건폐율 기준이 필요합니다. 토지정보를 다시 조회하세요.');
 const n=Math.round(Number(floors));if(floorsMode!=='auto'&&!(n>=1&&n<=30))throw Error('층수는 1~30 정수로 입력하세요.');
 const searchTop=Math.min(30,Math.max(n||3,Math.ceil(z.far/Math.max(1,z.bcr-1))));
 const floorPatch=floorsMode==='fixed'?{floors:n,floors_search:false}:floorsMode==='cap'?{floors:n,floors_search:true}:{floors:searchTop,floors_search:true};
 const gfa=Number(target)>0?Number(target):parcelArea(ps)*z.far/100;
 const combos=[];
 for(const shape of shapes.length?shapes:['rect'])for(const massing of massings.length?massings:['max1f'])for(const mode of parkingModes.length?parkingModes:['front'])combos.push({shape,massing,mode});
 return combos.slice(0,Math.max(1,count)).map((c,i)=>({title:`${i+1}안 · ${labelOf(DETAIL_SHAPES,c.shape)} · ${labelOf(DETAIL_MASSINGS,c.massing)} · ${labelOf(DETAIL_PARKING,c.mode).replace(' (예정)','')} 주차`,
  valueSources:{'program.use':source('use'),'program.floors':floorsMode==='auto'?'default':source('floors'),'program.floors_search':source('floorsMode'),'program.target_gfa':Number(target)>0?source('target'):'default','program.shape':source('shapes'),'program.massing':source('massings'),'program.entry_side':source('entrySide'),'program.parking.mode':source('parkingModes'),'program.parking.layout':'default'},
  unsupported:detailUnsupported(use,c.mode),
  patch:{use,...floorPatch,target_gfa:gfa,shape:c.shape,massing:c.massing,...(entrySide!=='auto'?{entry_side:entrySide}:{}),parking:{mode:c.mode,layout:'auto'}}}));
}
/** 계획안 한 장의 작은 배치 그림(대지·건물 바닥) */
export function planThumbnail(plan){
 const parcel=plan.request?.site?.parcel||[],foot=plan.result?.report?.geometry?.footprint||[];
 const all=[...parcel,...foot];if(!all.length)return '';
 const xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),minX=Math.min(...xs),maxY=Math.max(...ys),w=Math.max(...xs)-minX||1,h=maxY-Math.min(...ys)||1,pad=Math.max(w,h)*.08;
 const pts=ring=>ring.map(p=>`${(p[0]-minX).toFixed(2)},${(maxY-p[1]).toFixed(2)}`).join(' ');
 return `<svg viewBox="${(-pad).toFixed(2)} ${(-pad).toFixed(2)} ${(w+2*pad).toFixed(2)} ${(h+2*pad).toFixed(2)}" role="img" aria-label="배치 미리보기"><polygon class="site" points="${pts(parcel)}" pathLength="1" vector-effect="non-scaling-stroke"/>${foot.length?`<polygon class="building" points="${pts(foot)}" pathLength="1" vector-effect="non-scaling-stroke"/>`:''}</svg>`;
}
export function openDetailPlanDialog(ctx,request,site){
 return new Promise(resolve=>{
  const doc=document,el=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
  const dialog=el('dialog','plan-detail-dialog');let plans=[],sortKey='gfa',busy=false,done=false,controller=null;const changed=new Set();
  const finish=value=>{if(done)return;done=true;resolve(value);};
  const head=el('div','plan-detail-head');head.append(el('h2',null,'상세 계획 만들기'+(site?.address?' — '+site.address:'')));const close=el('button',null,'닫기 ×');close.type='button';close.onclick=()=>dialog.close();head.append(close);
  const body=el('div','plan-detail-body'),left=el('div','plan-detail-form'),right=el('div','plan-detail-results');body.append(left,right);
  const group=title=>{const g=el('section','plan-detail-group');g.append(el('h3',null,title));left.append(g);return g;};
  const row=(g,label,control)=>{const r=el('label','plan-detail-row');r.append(el('span',null,label),control);g.append(r);return control;};
  const select=(options,value)=>{const s=el('select');for(const [v,t] of options){const o=el('option',null,t);o.value=v;o.selected=v===value;s.append(o);}return s;};
  const chips=(g,label,options,picked)=>{const wrap=el('div','plan-detail-chips');
   for(const [v,t] of options){const c=el('label','plan-detail-chip');const box=el('input');box.type='checkbox';box.value=v;box.checked=picked.includes(v);c.append(box,' '+t);wrap.append(c);}
   const r=el('div','plan-detail-row');r.append(el('span',null,label),wrap);g.append(r);return ()=>[...wrap.querySelectorAll('input:checked')].map(i=>i.value);};
  const z=request?.zoning||{},ps=request?.site?.parcel||[],area=ps.length?parcelArea(ps):0;
  const info=group('대지 (조회값)'),kv=el('div','plan-detail-kv');
  for(const [k,v] of [['대지면적',area?area.toFixed(1)+' ㎡':'—'],['용도지역',z.zone||z.name||'—'],['건폐율·용적률',z.bcr&&z.far?`${z.bcr}% · ${z.far}%`:'—'],['최대 연면적',area&&z.far?(area*z.far/100).toFixed(1)+' ㎡':'—']])kv.append(el('span',null,k),el('b',null,v));
  info.append(kv);
  const scale=group('용도·규모');
  const use=row(scale,'용도',select(DETAIL_USES.map(u=>[u,u]),PLAN_USES[0]));
  scale.append(el('p','plan-detail-note','공동주택·오피스텔·다세대주택은 설계엔진 반영 예정입니다.'));
  const floorsMode=row(scale,'층수',select([['auto','자동 탐색'],['fixed','고정'],['cap','최대']],'auto'));
  const floors=row(scale,'층 수',Object.assign(el('input'),{type:'number',min:1,max:30,value:3}));
  const target=row(scale,'목표 연면적',Object.assign(el('input'),{type:'number',min:1,placeholder:'법정 최대'}));
  const layout=group('배치');
  const shapes=chips(layout,'바닥 모양',DETAIL_SHAPES,['rect','L','follow']);
  const massings=chips(layout,'매스',DETAIL_MASSINGS,['max1f','uniform']);
  const entry=row(layout,'진입',select([['auto','자동'],['north','북'],['south','남'],['east','동'],['west','서']],'auto'));
  const parking=group('주차');
  const modes=chips(parking,'방식',DETAIL_PARKING,['front','piloti']);
  parking.append(el('p','plan-detail-note','(예정) 방식은 설계엔진 반영 전이라 그 안은 「설계엔진 미지원」으로 표시됩니다.'));
  const countGroup=group('만들 안 수');const count=row(countGroup,'안 수',select([['3','3안'],['6','6안'],['9','9안']],'6'));
  for(const [key,control]of [['use',use],['floorsMode',floorsMode],['floors',floors],['target',target],['entrySide',entry]])control.addEventListener('change',()=>changed.add(key));
  for(const [i,key]of ['shapes','massings','parkingModes'].entries())left.querySelectorAll('.plan-detail-chips')[i].addEventListener('change',()=>changed.add(key));
  const sync=()=>{floors.disabled=floorsMode.value==='auto';};floorsMode.onchange=sync;sync();
  const status=el('p','plan-detail-status','조건을 고르고 [계획안 만들기]를 누르세요. 고른 조건을 섞어 안을 만듭니다(안마다 약 10초).');
  const sortBar=el('div','plan-detail-sort');
  const SORTS=[['gfa','연면적'],['bcr','건폐율'],['parking','주차']];
  for(const [key,label] of SORTS){const b=el('button',null,label);b.type='button';b.onclick=()=>{sortKey=key;draw();};sortBar.append(b);}
  const grid=el('div','plan-detail-grid');right.append(status,sortBar,grid);
  const numbers=p=>p.result?.report?.numbers||{};
  const draw=()=>{const value=p=>p.failed?-1:sortKey==='parking'?(numbers(p).parking_placed??0):(numbers(p)[sortKey]??0);
   const sorted=[...plans].sort((a,b)=>value(b)-value(a));
   for(const b of sortBar.children)b.classList.toggle('is-on',b.textContent===SORTS.find(([k])=>k===sortKey)[1]);
   const best=plans.filter(p=>!p.failed&&planCard(p).pass).sort((a,b)=>(numbers(b).gfa??0)-(numbers(a).gfa??0))[0];
   grid.replaceChildren(...sorted.map(plan=>cardFor(plan,best)));};
  // 카드 한 장. fresh 면 방금 끝난 안이라 대지 → 건물 순서로 그려지며 나타난다.
  const cardFor=(plan,best,fresh=false)=>{if(plan.failed){const box=el('article','plan-detail-card is-failed');box.append(el('div','plan-detail-thumb'),el('strong',null,plan.title),el('p','warn',(plan.unsupported?'설계엔진 미지원 · ':'만들지 못함 · ')+plan.error));return box;}const card=planCard(plan),box=el('article','plan-detail-card'+(plan===best?' is-best':'')+(card.pass?'':' has-issues')+(fresh?' is-fresh':''));
    const thumb=el('div','plan-detail-thumb'+(fresh?' is-drawing':''));thumb.innerHTML=planThumbnail(plan);
    box.append(thumb,el('strong',null,card.title+(plan===best?' · 추천':'')),el('p',null,`연면적 ${card.gfa??'—'}㎡ · ${card.floors??'—'}층`),el('p',null,`건폐율 ${card.bcr??'—'}% · 용적률 ${card.far??'—'}%`),el('p',null,'주차 '+card.parking),el('p',card.pass?'ok':'warn',card.pass?'법규 통과':card.held?'법규 판정 보류':'NG '+card.issues.length+'건: '+card.issues.slice(0,2).join(', ')));
    box.append(planQualityPanel(card.quality));
    if(plan.note)box.append(el('p','note',plan.note));
    const take=el('button','primary','도면으로 가져오기');take.type='button';take.disabled=busy;take.onclick=()=>{finish({plan,plans});dialog.close();};box.append(take);return box;};
  // 만드는 동안: 안마다 자리 카드를 먼저 놓고(대지 윤곽이 그려지는 중), 끝난 안부터 하나씩 채운다.
  const pendingCard=(variant,active)=>{const box=el('article','plan-detail-card is-pending'+(active?' is-active':''));const thumb=el('div','plan-detail-thumb'+(active?' is-tracing':''));thumb.innerHTML=planThumbnail({request});
   box.append(thumb,el('strong',null,variant.title),el('p','note',active?'만드는 중…':'대기 중'));return box;};
  const actions=el('div','plan-detail-actions'),make=el('button','primary','계획안 만들기');make.type='button';
  make.onclick=async()=>{if(busy)return;busy=true;make.disabled=true;try{
    const variants=detailPlanVariants(request,{use:use.value,floorsMode:floorsMode.value,floors:floors.value,target:target.value,shapes:shapes(),massings:massings(),parkingModes:modes(),entrySide:entry.value,count:Number(count.value),valueSources:Object.fromEntries([...changed].map(key=>[key,'user']))});
    controller=new AbortController();cancel.hidden=false;plans=[];grid.replaceChildren(...variants.map((v,i)=>pendingCard(v,i===0)));
    plans=await withSitePlanWait(ctx.studio,request,{signal:controller.signal,onFallback:message=>ctx.studio.context.toast?.(message),onProgress:message=>{status.textContent=message;},onPlan:(plan,index)=>{
     grid.children[index]?.replaceWith(cardFor(plan,null,true));
     if(variants[index+1])grid.children[index+1]?.replaceWith(pendingCard(variants[index+1],true));}},options=>generatePlanVariants(request,ctx.api,variants,options));
    status.textContent=`후보 ${plans.filter(p=>!p.failed).length}개${plans.some(p=>p.unsupported)?` · 엔진 반영 예정 ${plans.filter(p=>p.unsupported).length}개`:''}${plans.some(p=>p.failed&&!p.unsupported)?` · 실패 ${plans.filter(p=>p.failed&&!p.unsupported).length}개`:''} · 카드에서 [도면으로 가져오기]를 누르면 마우스 끝에 붙어 원하는 자리에 놓습니다.`;draw();
   }catch(error){status.textContent=String(error?.message||error);}finally{busy=false;controller=null;cancel.hidden=true;make.disabled=false;}};
  const closeButton=el('button',null,'닫기');closeButton.type='button';closeButton.onclick=()=>dialog.close();
  const cancel=el('button',null,'생성 취소');cancel.type='button';cancel.hidden=true;cancel.onclick=()=>controller?.abort();
  actions.append(make,cancel,closeButton);
  dialog.append(head,body,actions);dialog.addEventListener('keydown',e=>e.stopPropagation());
  const onQuality=()=>{if(!busy&&plans.length)draw();};globalThis.addEventListener?.(PLAN_QUALITY_EVENT,onQuality);
  dialog.addEventListener('close',()=>{globalThis.removeEventListener?.(PLAN_QUALITY_EVENT,onQuality);controller?.abort();dialog.remove();finish(null);});doc.body.append(dialog);dialog.showModal();
 });
}

/** 미리에게 보내는 검토 요청문. 도면을 바꾸지 말고 확인할 점만 짧게 답하게 한다. */
export function miriReviewMessage(site,{landInfo=null,sitePlan=null}={}){
 if(!site?.kind)throw Error('먼저 대지를 선택하세요.');
 const data={대지:{주소:site.address||'',필지:site.pnu||'',면적_m2:Number((site.areaM2||0).toFixed(1)),출처:site.kind==='parcel'?'연속지적도(주소 조회)':'도면에서 지정한 경계'},토지정보:landInfo,계획결과:sitePlan};
 return '바른 CAD 계획 탭에서 보낸 검토 요청입니다. 아래 대지와 계획 결과를 보고 확인할 점과 다음 단계를 짧게 알려 주세요.'
  +' 조회되지 않은 법규 수치는 확정하지 말고 확인이 필요하다고 적으세요. 이번 요청에서는 도면을 바꾸지 마세요.'
  +'\n\n[계획 자료 — 참고 데이터]\n'+JSON.stringify(data);
}

/** 대지 경계로 쓸 선택 → document.update 로 남길 planSite 값. */
export function drawingSiteRecord(candidates,{address='',now=()=>new Date().toISOString()}={}){
 const picked=candidates?.picked||[];
 if(!picked.length)throw Error('대지 경계로 쓸 닫힌 폴리선 또는 REC 사각형을 도면에서 먼저 선택하세요.');
 if(picked.some(e=>e.parcelBlockId))throw Error('주소로 불러온 대지는 이미 계획 대지로 쓰입니다.');
 const source=candidates.source.filter(e=>picked.some(p=>p.id===e.id));
 return {source:'drawing',entityIds:picked.map(e=>e.id),areaM2:Number(areaM2(source).toFixed(3)),address:String(address||'').trim().slice(0,200),at:now()};
}

/** 로그인 확인(로컬 엔진의 parcel status — 쿠키가 없으면 원격 호출도 없다). */
export async function accountStatus(api){
 try{const status=await api('parcel',{action:'status'});return {checked:true,connected:!!status?.connected,signedIn:!!status?.signedIn,officeName:status?.officeName||'',userName:status?.userName||'',message:status?.message||''};}
 catch(error){return {checked:true,connected:false,offline:true,message:String(error?.message||error)};}
}
export function accountLine(account){
 if(!account?.checked)return `${ACCOUNT_LABEL}: 확인 중…`;
 if(account.offline)return `${ACCOUNT_LABEL}: 확인 못 함 — 로컬 엔진 또는 인터넷 연결을 확인하세요.`;
 if(!account.connected&&account.signedIn)return `${ACCOUNT_LABEL}: 로그인됨 · 서버 준비 중${account.message?' — '+account.message:''}`;
 if(!account.connected)return `${ACCOUNT_LABEL}: 로그인 필요${account.message?' — '+account.message:''}`;
 return `${ACCOUNT_LABEL}: 로그인됨`+([account.officeName,account.userName].filter(Boolean).length?' · '+[account.officeName,account.userName].filter(Boolean).join(' · '):'');
}
export async function engineReady(api){
 const account=await accountStatus(api);
 if(account.offline)throw Error(ENGINE_OFFLINE_MESSAGE+' ('+account.message+')');
 if(!account.connected)throw Error(account.signedIn?account.message:ENGINE_LOGIN_MESSAGE);
 return account;
}
async function requireLogin(ctx){
 const account=await accountStatus(ctx.api);ctx.state.account=account;
 if(account.offline)throw Error('연결 필요: 로컬 엔진 또는 인터넷 연결을 확인하세요. ('+account.message+')');
 if(!account.connected)throw Error(account.signedIn?account.message:LOGIN_REQUIRED_MESSAGE);
 return account;
}

/** 지적 조회(로컬 엔진 → VWorld). 도면에 이미 drawingGeo 가 있으면 같은 원점으로 받아 겹치게 한다. */
export async function fetchCadastre(ctx,{pnus,radius}){
 if(!pnus?.length)throw Error('검색 결과에서 필지를 하나 이상 담으세요.');
 const geo=ctx.engine.doc.drawingGeo||ctx.state.fetched?.drawingGeo;
 return await ctx.api('parcel',{action:'fetch',pnus,surroundings:true,contextMeters:radius,crs:'EPSG:5187',labels:true,...(geo?.crs==='EPSG:5187'?{originM:geo.originM}:{})});
}

/** 지적 조회 결과를 도면에 그리기 전에 보여 줄 미리보기 모양(도면 mm 좌표 → 화면 위가 북쪽). */
export function cadastrePreview(entities){
 const polys=(entities||[]).filter(e=>e?.type==='polyline'&&['site','road','neighbor'].includes(e.parcelRole)&&e.attributes?.ring!=='hole'&&(e.points||[]).length>=3);
 const all=polys.flatMap(e=>e.points).filter(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y));
 if(!all.length)return null;
 const minX=Math.min(...all.map(p=>p.x)),maxX=Math.max(...all.map(p=>p.x)),minY=Math.min(...all.map(p=>p.y)),maxY=Math.max(...all.map(p=>p.y));
 const width=Math.max(maxX-minX,1),height=Math.max(maxY-minY,1),pad=Math.max(width,height)*.03;
 const order={neighbor:0,road:1,site:2};
 const shapes=polys.sort((a,b)=>order[a.parcelRole]-order[b.parcelRole]).map(e=>({role:e.parcelRole,d:'M'+e.points.map(p=>`${Math.round(p.x-minX)} ${Math.round(maxY-p.y)}`).join('L')+'Z'}));
 const labels=(entities||[]).filter(e=>e?.type==='text'&&['site','road','neighbor'].includes(e.parcelRole)&&Number.isFinite(e.position?.x)&&Number.isFinite(e.position?.y)).map(e=>({role:e.parcelRole,text:String(e.text||'').slice(0,40),x:Math.round(e.position.x-minX),y:Math.round(maxY-e.position.y),size:Math.round(e.height||Math.max(width,height)/60)}));
 return {viewBox:`${Math.round(-pad)} ${Math.round(-pad)} ${Math.round(width+pad*2)} ${Math.round(height+pad*2)}`,shapes,labels,widthM:width/1000,heightM:height/1000};
}

/** 대지분석·3D 반경 고르기(대표 2026-10-27: 150/200/300/500, 기본 500). */
export const SURROUND_RADII=[150,200,300,500];
export const surroundRadius=state=>SURROUND_RADII.includes(state?.surroundRadius)?state.surroundRadius:500;

/** 대지를 볼 때 맞출 범위: 대지·도로·인접 필지 + 토지정보표·검토용 안내 글. 없으면 null. */
export function siteViewBounds(doc){
 const es=(doc?.entities||[]).filter(e=>e.siteInfoPnu||e.attributes?.reviewNote);
 return G.bounds([...G.parcelEntities(doc?.entities||[]).filter(e=>['site','road','neighbor','site-original','road-info'].includes(e.parcelRole)),...es]);
}
/** 대지 둘레(고른 반경) 주변 건물(높이·층수·용도)과 5m 등고선을 도면에 넣는다(Ctrl+Z 한 번). 이미 있으면 바꿔 넣는다. ⑤ 대지분석·⑦ 3D 가 같이 쓴다. */
export async function fetchSurroundings(ctx){
 await requireLogin(ctx);const current=ctx.site(),radius=surroundRadius(ctx.state);
 const {bboxMm,crs,originM}=mapRequest(current.drawingGeo,siteRingsMm(ctx.engine.doc),radius,0);
 const result=await ctx.api('parcel',{action:'surroundings',crs,originM,bboxMm});
 const entities=result.entities.map(e=>e.parcelRole==='building'?{...e,attributes:{...e.attributes,aroundM:radius}}:e);
 if(!entities.length)throw Error('둘레에 가져올 건물·등고선이 없습니다.'+(result.warnings?.length?' '+result.warnings.join(' '):''));
 const counts={buildings:entities.filter(e=>e.parcelRole==='building').length,contours:entities.filter(e=>e.parcelRole!=='building').length};
 const old=G.parcelEntities(ctx.engine.doc.entities||[]).filter(e=>['building','contour','contour-major'].includes(e.parcelRole)).map(e=>e.id);
 ctx.execute(old.length?{type:'batch',commands:[{type:'delete',ids:old},{type:'parcel.import',entities}]}:{type:'parcel.import',entities});
 ctx.studio?.context?.zoomToBounds?.(siteViewBounds(ctx.engine.doc));   // 1km 둘레 건물 전체가 아니라 대지·지적도·토지정보표로 맞춘다(2026-10-28 시안)
 return `둘레 ${radius}m 주변 건물 ${counts.buildings}동 · 등고선 ${counts.contours}줄을 ${old.length?'바꿔 ':''}넣었습니다(A-SITE-BLDG · A-SITE-TOPO). Ctrl+Z 한 번으로 되돌립니다.`+(result.warnings?.length?' '+result.warnings.join(' '):'');
}

/** 대지분석 도판을 다시 만들어야 하는지 가르는 열쇠: 대지·주변 건물·지적이 바뀔 때만 바뀐다(편집마다 다시 그리지 않음). */
export function analysisKey(doc,site){
 let b=0,p=0,u=0;for(const e of G.parcelEntities(doc?.entities||[])){if(e.parcelRole==='building'){b++;if(e.attributes?.useCode)u++;}else if(['site','road','neighbor'].includes(e.parcelRole))p++;}
 return [site?.entityIds?.join('+'),b,p,u].join('|');
}

/* ─────────────── 단계 모듈 ─────────────── */
// ⑤ 계획안 '아파트' (2026-10-21 대표: 아파트 계획도 같은 계획이니 기본 계획창에). 계산·창은 apartment-panel.js 흐름을 그대로 쓰고
// (studio.context.apartmentFlow), 대지는 ①~③ 에서 불러온 대지선이다 — 따로 PL 을 고르지 않는다(A29).
export const PLAN_KINDS=Object.freeze([['building','근생·업무·판매'],['apartment','아파트']]);
const APT_MODE={'84':'1안 · 84 주력',max:'2안 · 최대 용적'},APT_REVIEW={quick:'빠른 검토',precise:'정밀 검토'};
const aptFlow=ctx=>ctx.studio?.context?.apartmentFlow||null;
/** 대지가 바뀌면(필지·면적) 아파트 표·검토를 새로 한다. */
export const apartmentSiteKey=site=>site?.kind==='parcel'?(site.pnus?.length?site.pnus:[site.pnu]).join('+')+'@'+Number(site.areaM2||0).toFixed(1):'';
function apartmentState(ctx){
 const flow=aptFlow(ctx);if(!flow)return null;
 const s=flow.state();
 return s.siteKey===apartmentSiteKey(ctx.site)?s:{...s,table:null,max:null,jobs:{},err:s.siteKey?'':s.err};
}
const aptDone=j=>['done','failed'].includes(j?.state?.status);
const aptClock=sec=>{const n=Math.floor(Number(sec)||0);return n<60?n+'초':Math.floor(n/60)+'분 '+n%60+'초';};
function apartmentEvaluate(ctx){
 const s=apartmentState(ctx);
 if(!s)return {state:'blocked',detail:'아파트 검토를 불러오지 못했습니다. 앱을 다시 시작하세요.'};
 const running=Object.entries(s.jobs).find(([,j])=>!aptDone(j));
 if(running){const [k,j]=running;return {state:'running',detail:`${APT_REVIEW[k]} 계산 중 · ${j.where==='local'?'이 PC':'배치 엔진 서버'}${j.state?.elapsed_s!=null?' · 경과 '+aptClock(j.state.elapsed_s):''}${k==='precise'?' · 수십 분 걸립니다(탭을 닫아도 계속).':''}`};}
 const last=['precise','quick'].find(k=>s.jobs[k]);
 if(last){const j=s.jobs[last];
  if(j.state?.status==='failed')return {state:'error',detail:`${APT_REVIEW[last]} 실패: ${j.state.error||'계산이 끝나지 못했습니다.'}`};
  return {state:'done',detail:`${APT_REVIEW[last]} 결과 · 걸린 시간 ${aptClock(j.state?.elapsed_s)} · `+(j.place?.plans||[]).map(p=>`${APT_MODE[p.mode]||p.title} ${p.status==='불가'?'불가':Number(p.far_pct).toFixed(1)+'%'}`).join(' · ')};}
 if(s.busy)return {state:'running',detail:'인센티브를 전부 넣어 목표 용적률을 계산하는 중…'};
 if(s.err)return {state:'error',detail:s.err};
 if(s.table)return {state:'todo',detail:`목표 용적률 ${s.table.far_pct}%${s.picked?' (바꾼 조건)':' (인센티브 최대)'} · [빠른 검토]를 누르면 1안·2안을 만듭니다.`};
 return {state:'todo',detail:'①에서 고른 대지로 바로 계산합니다. 받을 수 있는 인센티브를 전부 넣어 목표 용적률을 잡습니다.'};
}
async function apartmentReady(ctx){
 const flow=aptFlow(ctx);if(!flow)throw Error('아파트 검토를 불러오지 못했습니다. 앱을 다시 시작하세요.');
 const site=ctx.site(),key=apartmentSiteKey(site),s=flow.state();
 if(s.siteKey===key&&s.table)return flow;
 await requireLogin(ctx);
 const rings=G.parcelEntities(ctx.engine.doc.entities).filter(e=>siteRing(e)&&e.type==='polyline'&&e.closed&&e.points?.length>=3);
 if(rings.length!==1)throw Error('대지선이 하나가 아닙니다. ② 에서 필지를 한 대지로 합치세요.');
 const pl=rings[0].points.map(p=>({x:p.x,y:p.y}));
 await flow.load(pl,key);
 return flow;
}
function apartmentReview(review){
 return async ctx=>{
  const flow=await apartmentReady(ctx),j=flow.state().jobs[review];
  if(j&&!aptDone(j))throw Error(APT_REVIEW[review]+'가 계산 중입니다. 끝나면 결과가 여기에 나옵니다.');
  return await flow.review(review);
 };
}
function apartmentRender(ctx,{el,run}){
 const s=apartmentState(ctx),body=[];if(!s)return body;
 const t=s.table;
 if(t){
  const sum=el('div','plan-apt-sum');
  const cell=(label,value,cls)=>{const d=el('div',cls||null);d.append(el('small',null,label),el('strong',null,value));sum.append(d);};
  cell('대지 면적',`${Number(t.area_m2||0).toLocaleString()}㎡`);cell('기준 용적률',`${t.base_far_pct}%`);
  cell(s.picked?'목표 (바꾼 조건)':'목표 (인센티브 최대)',`${t.far_pct}%`,'is-target');cell('그중 확정',`${t.confirmed_far_pct}%`);
  body.push(sum);
  if(t.zone)body.push(el('p','plan-step-note',`${t.zone} · ${s.where==='local'?'이 PC 엔진':'배치 엔진 서버'} · '확인 필요' 인센티브는 받는다고 가정한 값입니다.`));
 }
 for(const review of ['quick','precise']){const j=s.jobs[review];if(!j)continue;
  const rows=el('div','plan-apt-rows');
  for(const m of j.modes||['84','max']){const st=j.state||{},ok=(st.done||[]).includes(m),now=st.current===m,p=(j.place?.plans||[]).find(x=>x.mode===m);
   const r=el('div');r.append(el('span',ok?'is-ok':null,ok?'✓':now?'▶':'·'),el('span',null,APT_MODE[m]),el('span',null,ok&&p?(p.status==='불가'?'불가':`${Number(p.far_pct).toFixed(1)}%`):now?'계산 중':aptDone(j)?'-':'대기'));rows.append(r);}
  body.push(el('p','plan-step-note',APT_REVIEW[review]+(aptDone(j)?' 결과':' 진행')),rows);
  if(j.err){const w=el('p','plan-candidate-warn',j.err+' ');const b=el('button',null,'다시 조회');b.type='button';b.onclick=()=>aptFlow(ctx)?.retry(review);w.append(b);body.push(w);}
  const plans=j.place?.plans||[],best=plans.filter(p=>p.status!=='불가').sort((a,b)=>(b.mode==='84')-(a.mode==='84'))[0];
  for(const p of plans){const tp=p.target_plan||{},box=el('article','plan-candidate'+(p===best?' is-best':'')+(p.checks_ok?'':' has-issues'));
   box.append(el('strong',null,`${APT_MODE[p.mode]||p.title}${p===best?' · 추천':''}`));
   const far=el('p','plan-apt-far',p.status==='불가'?'불가':`${Number(p.far_pct).toFixed(1)}%`);if(p.status!=='불가')far.append(el('small',null,` / ${tp.target_far_pct??p.far_cap_pct}%`));box.append(far);
   if(p.status==='불가')box.append(el('p','plan-candidate-warn','배치 불가 — '+([].concat(p.blocked_by||[]).join(' · ')||'확인 필요')));
   else{
    box.append(el('p','plan-candidate-numbers',`${Number(p.units).toLocaleString()}세대 · ${p.buildings_n}동 · 84형 ${Number(p.share84_pct||0).toFixed(0)}% · 최고 ${p.floors_max}층`));
    box.append(el('p',p.checks_ok?'plan-candidate-ok':'plan-candidate-warn',p.checks_ok?'검사 통과':'검사 확인 필요'));
    if((tp.assumptions||[]).length)box.append(el('p','plan-candidate-warn',`가정 인센티브 ${tp.assumptions.length}개 — 원문 확인 필요`));
    const take=el('button','primary','도면으로 가져오기');take.type='button';take.dataset.focusKey='apt-take-'+review+'-'+p.mode;take.onclick=()=>run('aptDraw',p);box.append(take);
   }
   body.push(box);}
 }
 return body;
}
function apartmentActions(ctx){
 const s=apartmentState(ctx);if(!s)return [];
 const quickDone=aptDone(s.jobs.quick)&&s.jobs.quick.place?.plans?.length;
 return [
  {id:'aptQuick',label:'빠른 검토 (무료)',primary:!quickDone,run:apartmentReview('quick')},
  {id:'aptPrecise',label:quickDone?'정밀 검토로 더 올리기 (P)':'정밀 검토 (P)',primary:!!quickDone,run:apartmentReview('precise')},
  {id:'aptIncentive',label:'인센티브 고르기…',run:async c=>{(await apartmentReady(c)).incentives();return '인센티브 창을 열었습니다. 고른 뒤 [이 조건으로 계획 탭에 반영]을 누르세요.';}},
 ];
}

export const PLAN_STEPS=[
 {
  id:'site',title:'대지 선택',hint:'주소·지번으로 검색해 필지를 담거나, 도면의 닫힌 경계를 대지로 지정합니다.',
  evaluate:({site,state})=>{
   if(site.kind==='parcel')return {state:'done',detail:siteLine(site)};
   if(site.kind==='drawing')return site.missing?{state:'error',detail:'지정한 대지 경계가 도면에서 지워졌습니다. 다시 선택하세요.'}:{state:'done',detail:siteLine(site)+' · 지적도·계획안은 주소로 불러온 대지에서 됩니다.'};
   if(state.fetched)return {state:'done',detail:`${siteInfo(site,state.fetched)?.address||'필지'} 조회됨 · ③에서 도면에 그리세요.`};
   return {state:'todo',detail:state.results?.length?`검색 결과 ${state.results.length}개 · 필지를 담고 [지적 조회]를 누르세요.`:'주소 또는 지번을 입력하고 [주소 검색]을 누르세요.'};
  },
  render:({state,el,rerender,runAction})=>{
   const wrap=el('div','plan-step-body');
   const label=el('label','plan-step-input','대지 주소·지번');const input=el('input');input.id='plan-site-query';input.maxLength=200;input.placeholder='예: 부산 부산진구 양정동 156-7';input.value=state.query||'';input.dataset.focusKey='site-query';
   input.addEventListener('input',()=>{state.query=input.value;});
   input.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Enter'&&!event.isComposing){event.preventDefault();wrap.closest('.plan-step')?.querySelector('[data-action=search]')?.click();}});
   label.append(input);wrap.append(label);
   if(state.results?.length){
    const list=el('div','plan-site-results');list.setAttribute('role','listbox');list.setAttribute('aria-label','주소 검색 결과');
    for(const row of state.results){
     const item=el('button','plan-site-result'+(state.picked.has(row.pnu)?' is-picked':''),row.label);item.type='button';item.setAttribute('role','option');item.setAttribute('aria-selected',String(state.picked.has(row.pnu)));item.dataset.pnu=row.pnu;
     item.onclick=()=>{if(state.picked.has(row.pnu))state.picked.delete(row.pnu);else if(state.picked.size<10)state.picked.set(row.pnu,row.label);state.fetched=null;state.siteMerge=null;rerender();};
     list.append(item);
    }
    wrap.append(list,el('p','plan-step-note',`담은 필지 ${state.picked.size}/10 · 여러 필지를 담으면 합필로 조회합니다.`));
   }
   const preview=state.fetched&&cadastrePreview(state.fetched.entities);
   if(preview){
    const NS='http://www.w3.org/2000/svg',doc=wrap.ownerDocument,figure=el('figure','plan-cadastre-preview');
    // 미리보기를 누르면 ③ [도면에 그리기]와 같다.
    if(runAction){figure.classList.add('is-action');figure.tabIndex=0;figure.setAttribute('role','button');figure.title='눌러서 도면에 그리기';
     const draw=()=>runAction('cadastre','draw');figure.onclick=draw;figure.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();draw();}};}
    const svg=doc.createElementNS(NS,'svg');svg.setAttribute('viewBox',preview.viewBox);svg.setAttribute('role','img');svg.setAttribute('aria-label','조회한 대지와 주변 지적 미리보기');
    for(const shape of preview.shapes){const path=doc.createElementNS(NS,'path');path.setAttribute('d',shape.d);path.setAttribute('class','is-'+shape.role);path.setAttribute('vector-effect','non-scaling-stroke');svg.append(path);}
    for(const label of preview.labels){const text=doc.createElementNS(NS,'text');text.setAttribute('x',label.x);text.setAttribute('y',label.y);text.setAttribute('font-size',label.size);text.setAttribute('text-anchor','middle');text.setAttribute('class','is-'+label.role);text.textContent=label.text;svg.append(text);}
    figure.append(svg,el('figcaption',null,`도면에 넣기 전 미리보기 · 약 ${Math.round(preview.widthM)}×${Math.round(preview.heightM)}m (반경 ${state.fetched.contextMeters}m) · 눌러서 도면에 그리기(③ [도면에 그리기]와 같음).`));
    wrap.append(figure);
   }
   return wrap;
  },
  actions:({state})=>[
   {id:'search',label:'주소 검색',primary:!state.results?.length,run:async ctx=>{
    const query=(ctx.state.query||'').trim();if(query.length<2)throw Error('대지 주소 또는 지번을 2자 이상 입력하세요.');
    await requireLogin(ctx);
    const found=await ctx.api('parcel',{action:'search',query});
    ctx.state.results=[...new Map((found.results||[]).filter(r=>/^\d{19}$/.test(r.pnu)).map(r=>[r.pnu,{pnu:r.pnu,label:[r.jibunAddress,r.roadAddress,r.buildingName].filter(Boolean).join(' / ')}])).values()];
    ctx.state.picked=new Map();ctx.state.fetched=null;ctx.state.siteMerge=null;
    if(ctx.state.results.length===1)ctx.state.picked.set(ctx.state.results[0].pnu,ctx.state.results[0].label);
    if(!ctx.state.results.length)throw Error('검색 결과가 없습니다. 시·군·구와 지번을 포함해 입력하세요.');
    return `${ctx.state.results.length}개 필지를 찾았습니다. 지번을 확인해 담으세요.`;
   }},
   {id:'fetch',label:'지적 조회',primary:!!state.results?.length,run:async ctx=>{
    await requireLogin(ctx);
    const pnus=[...ctx.state.picked.keys()];
    const result=await fetchCadastre(ctx,{pnus,radius:ctx.state.radius});
    ctx.state.fetched={...result,contextMeters:ctx.state.radius,pendingSite:true};ctx.state.siteMerge=null;
    return `대지 ${result.counts?.site??0} · 도로 ${result.counts?.road??0} · 인접 ${result.counts?.neighbor??0} 경계를 조회했습니다. ${(result.warnings||[]).slice(0,2).join(' ')}`.trim();
   }},
   // 주소 검색 결과를 보는 중에는 숨긴다(검색한 필지를 대지로 쓰는 버튼으로 오해해 누른다).
   ...(state.results?.length||state.fetched?[]:[{id:'pick',label:'선택한 경계를 대지로',run:async ctx=>{
    const {siteBoundaryCandidates}=await ctx.loadAutoPlan();
    const record=drawingSiteRecord(siteBoundaryCandidates(ctx.engine.doc.entities,ctx.selected()),{address:ctx.state.query||''});
    ctx.execute({type:'document.update',changes:{planSite:record}});
    return `도면의 경계 ${record.entityIds.length}개를 대지로 지정했습니다 (${record.areaM2.toFixed(1)}㎡). Ctrl+Z로 되돌릴 수 있습니다.`;
   }}]),
  ],
 },
 {
  id:'info',title:'대지 정보',hint:'주소 · 면적(지적·대장) · 용도지역 · 건폐율/용적률 · 최대 규모.',
  evaluate:({site,state})=>{
   const data=siteInfo(site,state.fetched);
   if(!data)return {state:'blocked',detail:site.kind==='drawing'?'도면에서 지정한 경계에는 필지 정보가 없습니다. 주소로 조회하세요.':'먼저 대지를 조회하세요.'};
   if(!data.info)return {state:'todo',detail:'토지정보가 아직 없습니다. [토지정보 다시 조회]를 누르세요.'};
   if(data.info.error)return {state:'error',detail:'토지정보 조회 실패: '+data.info.error};
   return {state:'done',detail:data.source};
  },
  render:({site,state,engine,el,run,rerender,calculateMerge=mergeCandidates})=>{
   const data=siteInfo(site,state.fetched);if(!data)return null;
   const table=el('dl','plan-site-card');
   for(const [name,value,warn] of siteCardRows(data,state.ledger[data.pnu])){const dt=el('dt',null,name),dd=el('dd',warn?'is-warn':null,value);table.append(dt,dd);}
   const wrap=el('div','plan-step-body');wrap.append(table);
   if(data.info?.eumUrl){const link=el('a','plan-site-link','토지이음 원문 열기');link.href=data.info.eumUrl;link.target='_blank';link.rel='noopener noreferrer';wrap.append(link);}
   const ledgerM2=state.ledger[data.pnu]?.lotAreaM2;
   if(state.account.connected&&ledgerM2&&!state.mergeDismissed[data.pnu]){
    const source=usesFetchedSite(site,state.fetched)?state.fetched:engine.doc;
    if(state.mergeCache?.source!==source||state.mergeCache?.ledgerM2!==ledgerM2)
     state.mergeCache={source,ledgerM2,proposal:calculateMerge(mergeEntities({site,state,engine}),{ledgerM2})};
    const proposal=state.mergeCache.proposal;
    if(proposal.mismatch){
     const box=el('div','plan-site-merge');box.setAttribute('role','region');box.setAttribute('aria-label','여러 필지 대지 제안');
     box.append(el('p',null,`건축물대장 대지면적 ${ledgerM2.toFixed(1)}㎡ ↔ 지적 ${proposal.siteAreaM2.toFixed(1)}㎡ (${signedPct(proposal.diffPct)}). 합필되지 않은 1대지 여러 필지일 수 있습니다.`));
     for(const candidate of proposal.candidates){
      const row=el('div','plan-site-merge-row'),names=[...data.jibuns,...candidate.parcels.map(p=>p.jibun||p.pnu)];
      const button=el('button',null,'함께 대지로 쓰기');button.type='button';button.dataset.action='merge';button.dataset.focusKey='merge:'+candidate.pnus.join('+');button.onclick=()=>run('merge',candidate);
      row.append(el('span',null,`${names.join(' + ')} · 합 ${candidate.areaM2.toFixed(1)}㎡ (${signedPct(candidate.diffPct)})`),button);box.append(row);
     }
     if(!proposal.candidates.length)box.append(el('p',null,'맞닿은 필지 중 합이 대장 면적에 맞는 조합을 찾지 못했습니다(반경 안 필지만 봅니다).'));
     if(proposal.truncated)box.append(el('p',null,'필지가 많아 일부 조합만 봤습니다.'));
     if(proposal.skipped.length)box.append(el('p',null,'반경을 넓혀 다시 조회하면 더 찾을 수 있습니다.'));
     const dismiss=el('button',null,'그대로 두기');dismiss.type='button';dismiss.onclick=()=>{state.mergeDismissed[data.pnu]=true;rerender();};box.append(dismiss);wrap.append(box);
    }
   }
   return wrap;
  },
  extra:{merge:mergeSite},
  actions:({site,state,engine})=>{
   if(!siteInfo(site,state.fetched))return [];
   const actions=[{id:'ledger',label:'대장 면적 조회',run:async ctx=>{
    const data=siteInfo(ctx.site(),ctx.state.fetched);if(!data?.pnu)throw Error('필지 번호(PNU)가 없습니다.');
    const result=await ctx.api('parcel',{action:'ledger',pnu:data.pnu});ctx.state.ledger[data.pnu]=result;
    return result.lotAreaM2?`건축물대장 대지면적 ${result.lotAreaM2.toFixed(1)}㎡`:result.message;
   }}];
   const entities=usesFetchedSite(site,state.fetched)?state.fetched.entities||[]:(engine?G.parcelEntities(engine.doc.entities):[]);
   if(entities.filter(siteRing).length>1)actions.push({id:'merge',label:'필지 합쳐 한 대지로',run:ctx=>mergeSite(ctx,{pnus:[]})});
   // 도면의 대지는 미리보다 토지정보를 다시 조회해 토지정보표까지 갱신한다(parcel.info 한 번).
   if(site.kind==='parcel'&&!usesFetchedSite(site,state.fetched))actions.push({id:'refresh',label:'토지정보 다시 조회',run:async ctx=>{
    if(!ctx.studio.context.miribodaRefresh)throw Error('토지정보 조회를 쓸 수 없습니다. 앱을 다시 시작해 주세요.');
    await requireLogin(ctx);await ctx.studio.context.miribodaRefresh();
    return '토지정보를 다시 조회해 도면의 토지정보표를 갱신했습니다. Ctrl+Z로 되돌릴 수 있습니다.';
   }});
   return actions;
  },
 },
 {
  id:'cadastre',title:'주변 지적도',hint:`대지·도로·인접 필지와 지번을 표준 레이어(A-SITE·A-SITE-ROAD·A-SITE-PARCEL·A-SITE-TEXT)로 그립니다(EPSG:5187). ${REVIEW_NOTE}.`,
  evaluate:({site,state})=>{
   if(site.kind==='parcel'){
    const geo=site.drawingGeo?` · ${site.drawingGeo.crs} 원점 기록됨`:` · ${site.crs||'좌표계 미확인'}(예전 방식)`;
    return {state:'done',detail:`도면에 있음 · 대지 ${site.counts.site} · 도로 ${site.counts.road} · 인접 ${site.counts.neighbor}${site.labels?' · 지번 문자':''}${geo}`};
   }
   if(!state.fetched&&!state.picked?.size)return {state:'blocked',detail:'먼저 대지를 조회하세요.'};
   return {state:'todo',detail:`반경 ${state.radius}m 로 그립니다.`};
  },
  render:({state,el,rerender})=>{
   const label=el('label','plan-step-input','주변 범위 (대지 바깥 반경)');const select=el('select');select.id='plan-radius';select.dataset.focusKey='radius';
   for(const m of RADIUS_OPTIONS){const option=el('option',null,m+'m');option.value=String(m);option.selected=m===state.radius;select.append(option);}
   select.onchange=()=>{state.radius=Number(select.value);rerender();};label.append(select);
   const wrap=el('div','plan-step-body');wrap.append(label);return wrap;
  },
  actions:({site})=>[
   {id:'draw',label:'도면에 그리기',primary:site.kind!=='parcel',run:async ctx=>{
    const current=ctx.site();
    let fetched=ctx.state.fetched;
    if(current.kind==='parcel'&&fetched&&current.pnu===fetched.pnus?.[0])throw Error('이 대지는 이미 도면에 있습니다. 범위를 바꾸려면 Ctrl+Z로 지운 뒤 다시 그리세요.');
    if(!fetched||fetched.contextMeters!==ctx.state.radius){
     await requireLogin(ctx);
     const result={...await fetchCadastre(ctx,{pnus:[...new Set([...(fetched?.pnus||[...ctx.state.picked.keys()]),...(ctx.state.siteMerge?.pnus||[])])],radius:ctx.state.radius}),contextMeters:ctx.state.radius,pendingSite:fetched?.pendingSite===true};
     if(ctx.state.siteMerge)result.entities=mergeFetchedEntities(result.entities,ctx.state.siteMerge);
     fetched=ctx.state.fetched=result;
    }
    if(!fetched.entities?.length)throw Error('조회된 지적 경계가 없습니다.');
    const ids=ctx.execute({type:'parcel.import',entities:fetched.entities,layerSet:'C-SITE',drawingGeo:fetched.drawingGeo});
    ctx.studio.context.selectEntities?.(ids||[]);ctx.studio.context.fit?.();
    ctx.state.fetched=null;
    return `주변 지적도를 그렸습니다(반경 ${ctx.state.radius}m · ${fetched.drawingGeo?.crs||'EPSG:5187'}). 토지정보표도 함께 넣었습니다. Ctrl+Z 한 번으로 되돌립니다.`;
   }},
   ...(site.kind==='parcel'&&site.landInfo&&!site.infoTable?[{id:'table',label:'토지정보표 그리기',run:async ctx=>{const current=ctx.site();ctx.execute({type:'parcel.info',info:current.landInfo});return '토지정보표와 일조 안내를 그렸습니다. Ctrl+Z로 되돌릴 수 있습니다.';}}]:[]),
  ],
 },
 {
  id:'map',title:'지도',hint:'대지 둘레 일반·위성 지도. [도면 뒤에 깔기]로 도면 밑에 같은 자리로 깝니다(도면 파일에는 저장하지 않음).',
  evaluate:({site,studio})=>{
   if(site.kind!=='parcel'||!site.drawingGeo?.originM)return {state:'blocked',detail:'주소로 대지를 불러와 주변 지적도를 그리면 지도가 보입니다.'};
   const bg=studio?.context?.getBackgroundMap?.();
   if(bg?.layer==='Analysis')return {state:'todo',detail:`도면 뒤에는 지금 대지분석 도판(${bg.label||'도판'})이 깔려 있습니다. 지도를 깔면 바뀝니다.`};
   return bg?{state:'done',detail:`도면 뒤에 ${MAP_LAYERS[bg.layer]} 지도를 깔았습니다 · ${bg.attribution}`}:{state:'todo',detail:'일반·위성 지도를 보고, 필요하면 도면 뒤에 까세요.'};
  },
  render:({site,state,el,engine,api,rerender})=>{
   if(site.kind!=='parcel'||!site.drawingGeo?.originM)return null;
   const key=site.pnu+'|'+state.mapLayer+'|'+site.entityIds.join('+');const mini=state.map;
   if(mini?.key!==key&&!state.mapLoading){
    state.mapLoading=true;
    const rings=siteRingsMm(engine.doc);
    api('parcel',{action:'basemap',...mapRequest(site.drawingGeo,rings,80,640),layer:state.mapLayer})
     .then(r=>{state.map={key,rings,...r};},e=>{state.map={key,error:e?.message||String(e)};})
     .finally(()=>{state.mapLoading=false;rerender();});
   }
   const wrap=el('div','plan-step-body plan-map');
   if(!mini||mini.key!==key){wrap.append(el('p','plan-step-note','지도를 불러오는 중…'));return wrap;}
   if(mini.error){wrap.append(el('p','plan-step-note is-warn',mini.error));return wrap;}
   const canvas=el('canvas','plan-map-canvas');canvas.width=mini.width;canvas.height=mini.height;canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`대지 둘레 ${MAP_LAYERS[mini.layer]} 지도`);
   const img=new Image();img.onload=()=>{const c=canvas.getContext('2d');c.drawImage(img,0,0);const [a,b,cc,d,e,f]=mini.affine;
    c.lineWidth=3;c.strokeStyle='#e0457b';for(const ring of mini.rings){c.beginPath();ring.forEach(([x,y],i)=>c[i?'lineTo':'moveTo'](a*x+cc*y+e,b*x+d*y+f));c.closePath();c.stroke();}};
   img.src=mini.image;
   wrap.append(canvas,el('p','plan-step-note',mini.attribution));return wrap;
  },
  actions:({site,state,studio})=>{
   if(site.kind!=='parcel'||!site.drawingGeo?.originM)return [];
   const other=state.mapLayer==='Base'?'Satellite':'Base',shown=studio?.context?.getBackgroundMap?.(),bg=shown?.layer==='Analysis'?null:shown;
   return [
    {id:'layer',label:MAP_LAYERS[other]+' 지도',run:async ctx=>{ctx.state.mapLayer=other;return MAP_LAYERS[other]+' 지도로 바꿨습니다.';}},
    bg?{id:'off',label:'배경 지도 끄기',run:async ctx=>{ctx.studio.context.setBackgroundMap(null);return '도면 뒤 지도를 껐습니다.';}}
     :{id:'under',label:'도면 뒤에 깔기',primary:true,run:async ctx=>{
      await requireLogin(ctx);const current=ctx.site();
      const map=await ctx.api('parcel',{action:'basemap',...mapRequest(current.drawingGeo,siteRingsMm(ctx.engine.doc),300,2048),layer:ctx.state.mapLayer});
      ctx.studio.context.setBackgroundMap(map);
      return `도면 뒤에 ${MAP_LAYERS[map.layer]} 지도를 깔았습니다(대지 둘레 300m).`+(map.missingTiles?` 지도 조각 ${map.missingTiles}개를 받지 못했습니다.`:'');
     }},
   ];
  },
 },
 {
  id:'analysis',title:'대지분석',hint:'지형·경사도·경사 방향·건물·높이·고층·저층·용도지역·용도·연대·구역지구·도시계획시설·필지 규모·지적·밀도·일조·개방감·도로 위계·가구·공원·녹지·하천 도판(반경 150~500m)과 주변 상권(음식점 등)·추천 용도. 카드를 누르면 크게 보고, 도면 뒤에 깔거나 SVG·PNG로 저장합니다.',
  evaluate:({site,engine})=>{
   if(site.kind!=='parcel'||!site.drawingGeo?.originM)return {state:'blocked',detail:'주소로 대지를 불러와 주변 지적도를 그리면 대지분석 도판이 나옵니다.'};
   const c=surroundingCounts(engine?.doc);
   return c.buildings?{state:'done',detail:`주변 건물 ${c.buildings}동 · 도판 20장 · 카드를 누르면 크게 봅니다.`}
    :{state:'todo',detail:'[주변 건물 가져오기]를 누르면 높이·용도·일조·개방감 도판까지 나옵니다. 지금은 지적·필지 도판만 됩니다.'};
  },
  render:({site,engine,state,el,rerender,studio})=>{
   if(site.kind!=='parcel'||!site.drawingGeo?.originM)return null;
   const doc=engine.doc,key=analysisKey(doc,site);
   if(state.analysisKey!==key&&!state.analysisLoading){
    state.analysisLoading=true;state.analysisKey=key;
    import('./site-analysis.js').then(mod=>{state.analysisMod=mod;state.analysisModel=mod.analysisModel(doc,{maxRadiusM:surroundRadius(state)});if(state.zoning&&state.zoningSite===site.pnu)state.analysisModel=mod.withZones(state.analysisModel,state.zoning);state.analysisCache={};state.analysisError='';if(state.marketSite!==site.pnu){state.marketSite=site.pnu;state.market=null;state.recommend=null;state.marketError='';}},
     e=>{state.analysisError=String(e?.message||e);}).finally(()=>{state.analysisLoading=false;rerender();});
   }
   if(state.analysisError)return el('p','plan-step-note is-warn',state.analysisError);
   // 용도지역·지구·시설(브이월드)은 대지마다 한 번, 뒤에서 받는다. 받으면 그 도판들만 다시 그린다.
   if(state.analysisMod&&state.analysisModel&&state.zoningSite!==site.pnu&&!state.zoningLoading){
    state.zoningLoading=true;state.zoningSite=site.pnu;state.zoning=null;
    const {bboxMm,crs,originM}=mapRequest(site.drawingGeo,siteRingsMm(doc),Math.max(250,surroundRadius(state)),0);
    studio.api('parcel',{action:'zoning',crs,originM,bboxMm}).then(z=>{state.zoning=z;},e=>{state.zoning={zones:[],warnings:[String(e?.message||e)]};})
     .finally(()=>{state.zoningLoading=false;if(state.analysisModel)state.analysisModel={...state.analysisModel,zones:null};for(const k of ['zoning','district','planned'])delete state.analysisCache?.[k];rerender();});
   }
   if(state.analysisModel&&state.zoning&&state.analysisModel.zones==null)state.analysisModel=state.analysisMod.withZones(state.analysisModel,state.zoning);
   // 다시 만드는 동안(반경 바꾸기·주변 건물 가져오기)에는 앞 도판을 그대로 둔다: 짧은 글로 바꾸면 칸이 줄어 보던 자리가 ⑥~⑩ 으로 밀렸다(10-28).
   if(!state.analysisMod||(state.analysisLoading&&!state.analysisModel))return el('p','plan-step-note','도판을 만드는 중…');
   const c=studio.context;
   const radius=surroundRadius(state);
   // 반경을 바꾸면 도판·도시계획 자료를 다시 만든다(주변 건물이 그보다 좁게 들어 있으면 아래 [다시 가져오기]).
   const pickRadius=r=>{state.surroundRadius=r;state.analysisKey=null;state.zoningSite=null;rerender();};
   return state.analysisMod.renderAnalysisGallery({doc,el,state,rerender,site,radius,radii:SURROUND_RADII,pickRadius,api:(...args)=>studio.api(...args),setBackgroundMap:c.setBackgroundMap,getBackgroundMap:c.getBackgroundMap,download:c.download,toast:c.toast||(()=>{})});
  },
  actions:({site,engine,studio,state})=>{
   if(site.kind!=='parcel'||!site.drawingGeo?.originM)return [];
   const c=surroundingCounts(engine?.doc),bg=studio?.context?.getBackgroundMap?.();
   // 용도지역 받기는 대지마다 한 번이다. 실패(로그인 전·서버 오류)하면 같은 대지에서 저절로 다시 받지 않으므로 손으로 다시 받는다.
   const z=state?.zoningSite===site.pnu&&!state?.zoningLoading?state.zoning:null;
   const zoningFailed=Boolean(z&&(z.failed?Object.values(z.failed).some(l=>l.length):z.warnings?.length));
   return [
    ...(c.buildings?[]:[{id:'fetch',label:'주변 건물 가져오기',primary:true,run:fetchSurroundings}]),
    ...(c.buildings&&state?.analysisModel?.fetchedR<surroundRadius(state)?[{id:'refetch',label:`주변 ${surroundRadius(state)}m로 다시 가져오기`,primary:true,run:fetchSurroundings}]:[]),
    ...(zoningFailed?[{id:'zoning-retry',label:'도시계획 자료 다시 받기',run:async ctx=>{ctx.state.zoningSite=null;return '용도지역·지구·시설 자료를 다시 받습니다.';}}]:[]),
    ...(bg?.layer==='Analysis'?[{id:'off',label:'도판 배경 끄기',run:async ctx=>{ctx.studio.context.setBackgroundMap(null);return '도면 뒤 도판을 껐습니다.';}}]:[]),
   ];
  },
 },
 {
  id:'plan',title:'계획안',hint:'[추천 계획안]은 엔진이 알아서 3안을, [상세 계획안]은 조건을 골라 여러 안을 만듭니다. 아파트는 위에서 [아파트]를 고르세요.',
  evaluate:view=>{
   const {site,result,state}=view;
   if(site.kind!=='parcel'||!site.hasCRS)return {state:'blocked',detail:site.kind==='drawing'?'설계엔진은 좌표계와 인접 필지 지목이 있는 지적 자료가 필요합니다. 주소로 대지를 불러오세요.':'먼저 주변 지적도를 도면에 그리세요.'};
   if(site.counts?.site>1)return {state:'blocked',detail:'② 에서 필지를 한 대지로 합치세요.'};
   if(state?.planKind==='apartment')return apartmentEvaluate(view);
   if(state.plans?.length)return {state:result.plan?'done':'todo',detail:`후보 ${state.plans.length}개${result.plan?' · 도면에 계획안 있음':' · [도면으로 가져오기]를 누르세요.'}`};
   if(result.plan)return {state:'done',detail:'도면에 계획안이 있습니다.'};
   return {state:'todo',detail:'[추천 계획안]을 누르면 엔진이 3안을 만듭니다. 조건을 정하려면 [상세 계획안]. 결과는 규칙 draft(잠정) 기준 개략 검토입니다.'};
  },
  render:view=>{
   const {site,state,engine,studio,document:dom,el,rerender,run}=view;
   if(site.kind!=='parcel'||!site.hasCRS||site.counts?.site>1)return null;
   const wrap=el('div','plan-step-body');
   const kinds=el('div','plan-kind');kinds.setAttribute('role','group');kinds.setAttribute('aria-label','무엇을 지을까요');
   for(const [kind,label] of PLAN_KINDS){const b=el('button',null,label);b.type='button';b.dataset.kind=kind;b.dataset.focusKey='plan-kind-'+kind;b.setAttribute('aria-pressed',String((state.planKind||'building')===kind));
    b.onclick=()=>{if((state.planKind||'building')===kind)return;state.planKind=kind;rerender();if(kind==='apartment'&&!apartmentState(view)?.table)run('aptTable');};kinds.append(b);}
   wrap.append(kinds);
   if(state.planKind==='apartment'){wrap.append(...apartmentRender(view,{el,run}));return wrap;}
   if(isContractCandidateSet(state.plans)){wrap.append(contractPlanPanel(studio,{request:state.plans[0].request,result:state.plans[0].result,active:engine.doc.sitePlan,document:dom,onChoose:plan=>run('take',plan)}));return wrap;}
   if(!state.plans?.length)wrap.append(el('p','plan-step-note','용도·층수·주차는 엔진이 정합니다(근린생활시설 기준). 조건을 직접 정하려면 [상세 계획안].'));
   for(const [index,plan] of (state.plans||[]).entries()){
    if(isContract10(plan.result)){
     const details=el('details','plan-section');details.append(el('summary',null,plan.title),contractPlanPanel(studio,{request:plan.request,result:plan.result,active:engine.doc.sitePlan,document:dom,onChoose:candidate=>run('take',{...candidate,title:plan.title,note:plan.note})}));wrap.append(details);continue;
    }
    const active=engine?.doc?.sitePlan,selected=active?.alternativeTitle===plan.title;
    const quality=planQualityNow(selected?active:plan.result,{request:selected?active.request:plan.request,...(selected?{document:engine.doc,execution:engine.lastExecution}:{})});
    const card=planCard(plan,quality),box=el('article','plan-candidate'+(card.pass?'':' has-issues'));
    box.append(el('strong',null,card.title),el('p','plan-candidate-numbers',`연면적 ${card.gfa??'—'}㎡ · ${card.floors??'—'}층 · 건폐율 ${card.bcr??'—'}% · 용적률 ${card.far??'—'}%`),el('p','plan-candidate-numbers','주차 '+card.parking),el('p',card.pass?'plan-candidate-ok':'plan-candidate-warn',card.pass?'검토 항목 통과':card.held?'법규 판정 보류 · ':'확인 필요 · '+card.issues.join(', ')));
    box.append(planQualityPanel(card.quality));
    if(card.note)box.append(el('p','plan-step-note',card.note));
    const take=el('button','primary','도면으로 가져오기');take.type='button';take.dataset.action='take-'+index;take.dataset.focusKey='take-'+index;take.onclick=()=>run('take',plan);box.append(take);wrap.append(box);
   }
   return wrap;
  },
  actions:view=>{const {site,result,state}=view;return site.kind==='parcel'&&site.hasCRS&&!(site.counts?.site>1)?state?.planKind==='apartment'?apartmentActions(view):[
   {id:'generate',label:'추천 계획안',primary:true,run:async ctx=>{
    await engineReady(ctx.api);
    const snapshot=ctx.engine.doc;
    // 조건 없이: 용도는 근린생활시설, 층수는 엔진이 찾고, 목표는 법정 최대 연면적
    const {request,inputSources}=await ctx.api('site-plan/from-drawing',{entities:ctx.engine.doc.entities});
    setPlanValueSources(request,inputSources);
    const req=planRequest(request,{use:PLAN_USES[0],floors:3,target:''},'default');
    const controller=new AbortController();ctx.state.planController=controller;
    let plans;try{plans=await withSitePlanWait(ctx.studio,req,{fixedFloors:false,signal:controller.signal,onFallback:message=>ctx.studio.context.toast?.(message),onProgress:message=>ctx.progress('plan',message)},options=>ctx.generatePlans(req,ctx.api,options));}finally{ctx.state.planController=null;}
    if(ctx.engine.doc!==snapshot)throw Error('계획안을 만드는 동안 도면이 바뀌었습니다. 다시 만드세요.');
    ctx.state.plans=plans;
    return `설계엔진 후보 ${plans.length}개를 받았습니다. 카드에서 [도면으로 가져오기]를 누르세요.`;
   }},
   {id:'detail',label:'상세 계획안...',run:async ctx=>{
    await engineReady(ctx.api);
    const snapshot=ctx.engine.doc;
    const {request,inputSources}=await ctx.api('site-plan/from-drawing',{entities:ctx.engine.doc.entities});
    setPlanValueSources(request,inputSources);
    const chosen=await openDetailPlanDialog(ctx,request,site);
    if(!chosen)return '상세 계획 창을 닫았습니다.';
    if(ctx.engine.doc!==snapshot)throw Error('상세 계획 중 도면이 바뀌었습니다. 다시 만드세요.');
    ctx.state.plans=chosen.plans;
    return await PLAN_STEPS.find(s=>s.id==='plan').extra.take(ctx,chosen.plan);
   }},
   ...(result.plan?[{id:'open',label:'계획 결과 창',run:async ctx=>{ctx.studio.context.sitePlanOpen?.({plans:ctx.state.plans,take:plan=>PLAN_STEPS.find(s=>s.id==='plan').extra.take(ctx,plan)});return '계획 결과 창을 열었습니다.';}}]:[]),
  ]:[];},
  extra:{
   // 결과 문장은 단계 설명(apartmentEvaluate)이 이미 말한다 — 같은 말을 두 번 쓰지 않게 빈 문자열.
   aptTable:Object.assign(async ctx=>{await apartmentReady(ctx);return '';},{label:'목표 용적률 계산'}),
   aptDraw:Object.assign(async(ctx,plan)=>aptFlow(ctx).draw(plan)+' Ctrl+Z 로 되돌립니다.',{label:'도면으로 가져오기'}),
   take:async(ctx,plan)=>{
   // 도면으로 가져오기: 계획안을 마우스 끝에 띄워 두고, 사용자가 클릭한 자리에 넣는다(붙여넣기와 같은 방식).
   const before=ctx.engine.doc,known=new Set(before.entities.map(e=>e.id));
   const replacement=isContract10(plan.result)?contractReplacementOptions(before,plan.request,plan.result):{},options={planId:plan.planId,...replacement};
   const draft=attachSitePlan(before,plan.request,plan.result,options);
   const floating=draft.entities.filter(e=>!known.has(e.id)&&!e.sunlightDrawing),box=G.bounds(floating);
   let offset=null;
   if(box&&ctx.studio.context.placePlan&&!replacement.replaceSitePlanId){
    const base={x:box.minX,y:box.minY},point=await ctx.studio.context.placePlan({entities:floating,base,title:plan.title});
    if(ctx.engine.doc!==before)throw Error('계획안을 놓는 동안 도면이 바뀌었습니다. 다시 가져오세요.');
    offset={x:draft.sitePlan.offset.x+point.x-base.x,y:draft.sitePlan.offset.y+point.y-base.y};
   }
   const doc=attachSitePlan(before,plan.request,plan.result,{...options,...(offset?{offset}:{})});
   doc.sitePlan.alternativeTitle=plan.title;doc.sitePlan.alternativeNote=plan.note;
   ctx.engine.validate?.(doc);revealSitePlan(ctx.studio.context,()=>ctx.execute({type:'load',document:doc}));ctx.studio.context.fit?.();
   return `${plan.title} 을(를) 도면에 넣었습니다 · ${planSummary(doc.sitePlan.report)} · Ctrl+Z 한 번으로 되돌립니다.`;
  }},
 },
 {
  // 신축계획에 아파트도 같이(사장님 10/21). [AI 설계]의 자동 설계도 같은 계산을 하고, 진행은 'barun-apartment-review' 알림으로 여기에도 보인다.
  id:'apartment',title:'아파트 계획안',hint:'대지 경계로 아파트 1안(84 주력)·2안(최대 용적)을 배치 엔진 서버에서 계산합니다(빠른 검토 · 회원 무료 · 약 1분). 결과는 도면 \'아파트-검토\' 레이어에 그립니다.',
  evaluate:({site,state})=>{
   if(site.kind!=='parcel')return {state:'blocked',detail:'먼저 주소로 대지를 불러오세요.'};
   const a=state.apartment;
   if(!a)return {state:'todo',detail:'[아파트 빠른 검토]를 누르면 약 1분 뒤 1안·2안이 나옵니다.'};
   const view=apartmentView(a);
   if(view.blocked)return {state:a.status==='done'?'blocked':'error',detail:view.blocked};
   if(view.cards)return {state:'done',detail:`${view.cards.length}안 · 도면 '아파트-검토' 레이어에 그림`};
   return {state:'running',detail:'배치 엔진 서버에서 계산 중'+(Number.isFinite(Number(a.elapsed_s))?` · ${Math.round(a.elapsed_s)}초`:'')};
  },
  render:({state,el})=>{
   const a=state.apartment;if(!a)return null;
   const view=apartmentView(a);if(view.blocked)return null;
   const wrap=el('div','plan-step-body');
   if(view.steps){for(const s of view.steps)wrap.append(el('p','plan-candidate-numbers',`${s.state==='done'?'✓':s.state==='now'?'▶':'·'} ${s.label} — ${s.text}`));return wrap;}
   for(const card of view.cards){
    const box=el('article','plan-candidate'+(card.ok?'':' has-issues'));
    box.append(el('strong',null,card.title),el('p','plan-candidate-numbers',`용적률 ${card.big}${card.cap?' / '+card.cap:''}`),el('p','plan-candidate-numbers',card.meta),el('p',card.ok?'plan-candidate-ok':'plan-candidate-warn',card.ok?'일조·인동 통과':'검사 확인 필요'));
    wrap.append(box);
   }
   return wrap;
  },
  actions:({site,state})=>{
   if(site.kind!=='parcel')return [];
   const busy=state.apartment&&!['done','failed'].includes(state.apartment.status);
   return [
    {id:'apartment-quick',label:busy?'아파트 계산 중…':'아파트 빠른 검토',primary:true,always:false,run:async ctx=>{
     if(!ctx.studio.context.apartmentQuickReview)throw Error('아파트 검토를 쓸 수 없습니다. 앱을 다시 시작해 주세요.');
     if(busy)return '아파트 계산이 아직 진행 중입니다.';
     // 기다리지 않는다: 계산(약 1분) 동안 다른 단계 버튼이 막히지 않게. 진행은 알림으로 받는다.
     ctx.studio.context.apartmentQuickReview({});
     return '아파트 빠른 검토를 접수했습니다(약 1분).';
    }},
    {id:'apartment-open',label:'아파트 검토 창…',run:async ctx=>{ctx.studio.context.apartmentOpen?.();return '아파트 검토 창을 열었습니다.';}},
   ];
  },
 },
 {
  id:'3d',title:'3D',hint:'대지 둘레 건물(브이월드 GIS건물통합정보, 높이·층수)과 5m 등고선을 도면에 넣고 3D로 봅니다. GLB로 저장할 수 있습니다.',
  evaluate:({site,engine,state})=>{
   if(site.kind!=='parcel'||!site.drawingGeo?.originM)return {state:'blocked',detail:'주소로 대지를 불러와 주변 지적도를 그리면 3D를 볼 수 있습니다.'};
   const c=surroundingCounts(engine?.doc);
   return c.buildings||c.contours?{state:'done',detail:`도면에 주변 건물 ${c.buildings}동 · 등고선 ${c.contours}줄 · [3D로 보기]`}:{state:'todo',detail:`[주변 건물·등고선 가져오기]로 둘레 ${surroundRadius(state)}m 건물과 5m 등고선을 넣습니다(한 번에 Ctrl+Z). 반경은 ⑤ 대지분석에서 고릅니다.`};
  },
  actions:({site,engine})=>{
   if(site.kind!=='parcel'||!site.drawingGeo?.originM)return [];
   const c=surroundingCounts(engine?.doc),have=c.buildings||c.contours;
   return [
    ...(have?[]:[{id:'fetch',label:'주변 건물·등고선 가져오기',primary:true,run:fetchSurroundings}]),
    {id:'view',label:'3D로 보기',primary:!!have,run:async ctx=>{const s=ctx.site();await ctx.studio.context.openSite3D({radius:surroundRadius(ctx.state),zoning:ctx.state.zoningSite===s.pnu&&!ctx.state.zoningLoading?ctx.state.zoning:null});return '3D 창을 열었습니다. 끌어서 돌리고, 휠로 확대합니다. Esc 로 닫습니다.';}},
   ];
  },
 },
 {
  id:'miri',title:'미리보다',hint:'대지·계획 요약만 미리에게 보내 검토를 받습니다(미리는 도면을 바꾸지 않습니다).',
  evaluate:({site})=>site.kind?{state:'todo',detail:'미리에게 검토를 요청하거나 AI 설계·토지 법규 검토로 이어가세요.'}:{state:'blocked',detail:'먼저 대지를 선택하세요.'},
  actions:()=>[
   {id:'review',label:'미리에게 검토 요청',primary:true,run:ctx=>new Promise((resolve,reject)=>{
    const request=ctx.studio.context.requestDesignReview;
    if(!request)throw Error('미리 대화를 쓸 수 없습니다. 앱을 다시 시작해 주세요.');
    const message=miriReviewMessage(ctx.site(),{landInfo:ctx.studio.context.miribodaContext?.()||null,sitePlan:ctx.studio.context.sitePlanContext?.()||null});
    request({message,label:'계획 검토 요청',onComplete:outcome=>outcome?.ok?resolve('미리 답변: '+String(outcome.text||'답변을 받았습니다.').trim().slice(0,400)):reject(Error(outcome?.error||'미리 답변을 받지 못했습니다.'))});
   })},
   {id:'newbuild',label:'AI 설계 열기',always:true,run:async ctx=>{const open=ctx.studio.handlers?.NEWBUILD;if(!open)throw Error('AI 설계 창을 찾지 못했습니다.');open();return 'AI 설계 창을 열었습니다.';}},
   {id:'designcases',label:'아파트 평면 사례',always:true,run:async ctx=>{const open=ctx.studio.handlers?.DESIGNCASES;if(!open)throw Error('아파트 평면 사례 창을 찾지 못했습니다.');open();return '아파트 평면 사례 창을 열었습니다.';}},
   {id:'land',label:'토지·법규 검토',run:async ctx=>{const open=ctx.studio.handlers?.MIRIBODA;if(!open)throw Error('토지·법규 검토 창을 찾지 못했습니다.');open();return '토지·법규 검토 창을 열었습니다.';}},
  ],
 },
 // 검수 탭이 하던 입력 기준 검사를 계획 단계 끝으로(2026-10-24 통과 시안 ⑮). 검사 칸은 그대로 두고 여기서 연다.
 {
  id:'law',title:'법규 검사',hint:'건폐율 · 용적률 · 건축선 · 정북 사선을 입력 기준과 비교하고, 일조 단면을 그립니다.',
  evaluate:({site})=>site.kind?{state:'todo',detail:'[법규 검사 열기]에서 대지 정보로 기준을 정하고 검사합니다.'}:{state:'todo',detail:'대지가 없으면 [법규 검사 열기]에서 도면의 경계로 기준을 정합니다.'},
  actions:()=>[
   {id:'open',label:'법규 검사 열기',primary:true,always:true,run:async ctx=>{const open=ctx.studio.context.openLawCheck;if(!open)throw Error('법규 검사 칸을 찾지 못했습니다.');open();return '법규 검사 칸을 열었습니다.';}},
   {id:'sun',label:'일조 단면 그리기',always:true,run:async ctx=>{ctx.studio.context.openLawCheck?.();const button=document.querySelector('.livecheck-panel .lc-section');if(!button)throw Error('일조 단면 단추를 찾지 못했습니다.');button.click();return '일조 단면을 그렸습니다. 기준이 없으면 법규 검사 칸에 안내가 뜹니다.';}},
  ],
 },
];

/** 도면 상태 + 단계별 실행 기록 → 화면에 보일 상태. 실행 중·오류는 도면 상태보다 앞선다. */
export function stepView(step,ctx,runtime={}){
 const base=step.evaluate(ctx);
 if(base.state==='later')return base;
 if(runtime.state==='running')return {...base,state:'running',detail:runtime.message||'진행 중…'};
 if(runtime.state==='error')return {...base,state:'error',detail:runtime.message};
 if(runtime.state==='waiting'&&base.state!=='done')return {...base,state:'waiting',detail:runtime.message};
 if(runtime.state==='done'&&runtime.message)return {...base,note:runtime.message};
 return base;
}

/** 단계 실행. 결과·오류를 runtime 에 남기고 다시 그린다. 같은 단계를 겹쳐 실행하지 않는다. */
export async function runStepAction(step,action,ctx,runtime,render=()=>{}){
 if(runtime[step.id]?.state==='running')return runtime[step.id];
 runtime[step.id]={state:'running',action:action.id,message:action.label+' 중…'};render();
 try{
  const result=await action.run(ctx);
  const message=typeof result==='string'?result:result?.message||'';
  runtime[step.id]={state:result?.waiting?'waiting':'done',message};
 }catch(error){
  runtime[step.id]={state:'error',message:ctx.errorMessage?ctx.errorMessage(error):String(error?.message||error)};
 }
 render();return runtime[step.id];
}

export function freshPlanState(){return {query:'',results:[],picked:new Map(),fetched:null,radius:RADIUS_OPTIONS[0],ledger:{},mergeDismissed:{},mergeCache:null,siteMerge:null,account:{checked:false},mapLayer:'Base',map:null,mapLoading:false,program:{use:PLAN_USES[0],floors:3,target:''},plans:[],planKind:'building'};}

/** '계획' 패널 본문을 만든다. app.js 가 오른쪽 막대에 붙인다. */
/** AI 설계 [3안 자동 설계]: 설계엔진 추천 계획안을 만들어 대지 옆에 나란히 한 번에 넣는다(Ctrl+Z 한 번).
    예전에는 대지와 상관없는 고정 상자 3개를 그렸다. 이제 법규 검토가 붙은 실제 배치안이다. */
export async function drawRecommendedPlans(ctx,{onProgress=()=>{},signal}={}){
 await engineReady(ctx.api);
 const snapshot=ctx.engine.doc;
 const {request,inputSources}=await ctx.api('site-plan/from-drawing',{entities:snapshot.entities});
 setPlanValueSources(request,inputSources);
 const req=planRequest(request,{use:PLAN_USES[0],floors:3,target:''},'default');
 const plans=(await withSitePlanWait(ctx.studio,req,{fixedFloors:false,signal,onProgress,onFallback:onProgress},options=>ctx.generatePlans(req,ctx.api,options))).filter(p=>!p.failed&&p.result);
 if(!plans.length)throw Error('설계엔진이 이 대지에서 계획안을 만들지 못했습니다. 계획 탭 [상세 계획안...]에서 조건을 바꿔 보세요.');
 if(ctx.engine.doc!==snapshot)throw Error('계획안을 만드는 동안 도면이 바뀌었습니다. 다시 실행하세요.');
 let doc=snapshot;const placed=[];
 for(const plan of plans){
  doc=attachSitePlan(doc,plan.request,plan.result,{planId:plan.planId});
  doc.sitePlan.alternativeTitle=plan.title;doc.sitePlan.alternativeNote=plan.note;
  placed.push({sitePlanId:doc.sitePlan.id,title:plan.title,summary:planSummary(doc.sitePlan.report)});
 }
 // AI 대화가 '1안' 이 어느 객체인지 알도록 도면에 안 목록을 남긴다(getInteractionContext 가 읽는다).
 doc.planAlternatives=placed;
 ctx.engine.validate?.(doc);revealSitePlan(ctx.studio.context,()=>ctx.execute({type:'load',document:doc}));ctx.studio.context.fit?.();
 ctx.state.plans=plans;
 return placed;
}

export function installPlanWorkflow(studio,{document:doc=globalThis.document,loadAutoPlan=()=>lockedImport('auto-plan.js'),generatePlans=generateAlternativePlans,errorMessage,steps=PLAN_STEPS}={}){
 const {engine,execute,selected}=studio.context;
 const el=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
 const body=el('div','plan-flow');body.setAttribute('aria-label','계획 단계');
 // 설명 글·계정 칸은 두지 않는다: 계정 상태는 오른쪽 위 [계정 연결] 한 곳에서 보인다(단계 판정에는 계속 쓴다).
 const list=el('ol','plan-flow-steps');
 body.append(list);
 const runtime={};let state=freshPlanState();
 const ctx={studio,engine,execute,selected,document:doc,loadAutoPlan,generatePlans,errorMessage,get state(){return state;},api:(...args)=>studio.api(...args),site:()=>planSiteState(engine.doc),
  progress:(id,message)=>{runtime[id]={state:'running',message};render();}};
 studio.context.drawRecommendedPlans=options=>drawRecommendedPlans(ctx,options);
 // 아파트 빠른 검토 진행(계획 탭·AI 설계 어느 쪽에서 시작했든)을 '아파트 계획안' 단계에 보인다.
 globalThis.addEventListener?.('barun-apartment-review',event=>{state.apartment=event.detail;render();});
 const panelVisible=()=>!body.closest?.('[hidden]');
 let pending=0,aptSubscribed=false;
 async function refreshAccount(){state.account={checked:false};state.account=await accountStatus(ctx.api);render();}
 function render(){
  pending=0;
  // 아파트 검토 흐름(apartment-panel.js)은 계획 탭보다 늦게 설치될 수 있다 — 처음 그릴 때 구독한다.
  if(!aptSubscribed&&studio.context.apartmentFlow){aptSubscribed=true;studio.context.apartmentFlow.onChange(()=>schedule());}
  const view={...ctx,state,site:planSiteState(engine.doc),result:engineResultState(engine.doc)};
  const anyRunning=Object.values(runtime).some(r=>r?.state==='running');
  if(!state.query&&view.site.address)state.query=view.site.address;
  const focused=doc.activeElement&&list.contains(doc.activeElement)?doc.activeElement.dataset.focusKey:null;
  list.replaceChildren();
  steps.forEach((step,index)=>{
   const shown=stepView(step,view,runtime[step.id]);
   const item=el('li','plan-step');item.dataset.step=step.id;item.dataset.state=shown.state;
   const head=el('div','plan-step-head');
   const badge=el('span','plan-step-state',STATE_LABELS[shown.state]||shown.state);badge.setAttribute('role','status');
   head.append(el('span','plan-step-no',String(index+1)),el('strong','plan-step-title',step.title),badge);item.append(head);
   item.append(el('p','plan-step-detail',shown.detail||step.hint));
   if(shown.note)item.append(el('p','plan-step-note',shown.note));
   if(shown.state!=='later'){
    const run=(name,arg)=>{if(anyRunning)return;return runStepAction(step,{id:name,label:step.extra[name]?.label||(name==='merge'?'필지 합치기':'도면으로 가져오기'),run:c=>step.extra[name](c,arg)},ctx,runtime,render);};
    const runAction=(stepId,actionId)=>{if(anyRunning)return;const target=PLAN_STEPS.find(s=>s.id===stepId),action=target?.actions(view).find(a=>a.id===actionId);if(action)runStepAction(target,action,ctx,runtime,render);};
    const custom=step.render?.({...view,el,rerender:render,run,runAction});if(custom)item.append(custom);
    const actions=el('div','plan-step-actions');
    const blocked=shown.state==='blocked'&&step.id!=='site',running=runtime[step.id]?.state==='running';
    for(const action of step.actions(view)){
     const button=el('button',action.primary?'primary':'',action.label);button.type='button';button.dataset.action=action.id;button.dataset.focusKey='action:'+step.id+':'+action.id;
     // 어느 단계든 실행 중이면 모든 버튼을 막는다(여러 번 눌러 조회가 겹치지 않게). 누른 버튼은 '… 중'으로 바뀐다.
     button.disabled=(blocked&&!action.always)||anyRunning;button.onclick=()=>runStepAction(step,action,ctx,runtime,render);
     if(running&&runtime[step.id].action===action.id){button.textContent=action.label+' 중…';button.classList.add('is-loading');button.setAttribute('aria-busy','true');}
     actions.append(button);
    }
    if(anyRunning)item.querySelectorAll('.plan-candidate button,.plan-site-merge button,.plan-site-result,select,input').forEach(b=>{b.disabled=true;});
    if(anyRunning)item.querySelector('.plan-cadastre-preview')?.setAttribute('aria-disabled','true');
    if(step.id==='plan'&&state.planController){const cancel=el('button',null,'생성 취소');cancel.type='button';cancel.onclick=()=>state.planController?.abort();actions.append(cancel);}
    if(actions.childElementCount)item.append(actions);
   }
   list.append(item);
  });
  // 다시 그린 뒤 초점만 돌려주고 칸은 굴리지 않는다: 단추 자리가 바뀌면 focus() 가 칸을 그쪽으로 끌고 가 보던 자리를 잃는다(10-28).
  if(focused)list.querySelector(`[data-focus-key="${focused}"]`)?.focus({preventScroll:true});
 }
 // 큰 도면에서 매 편집마다 대지를 찾지 않는다. 창이 보일 때만, 한 프레임에 한 번.
 const schedule=()=>{if(pending||!panelVisible())return;pending=(globalThis.requestAnimationFrame||(fn=>setTimeout(fn,16)))(render);};
 engine.onChange?.(()=>{
  // 프레임 사이에 편집이 여러 번 와도 캐시의 변경 증거를 한 단계씩 잇는다.
  const active=engine.doc.sitePlan;if(panelVisible()&&active&&state.plans.some(p=>p.title===active.alternativeTitle))planQualityNow(active,{document:engine.doc,execution:engine.lastExecution});
  schedule();
 });
 globalThis.addEventListener?.(PLAN_QUALITY_EVENT,()=>schedule());
 globalThis.addEventListener?.('cad-document-switched',()=>{state={...freshPlanState(),account:state.account};for(const key of Object.keys(runtime))delete runtime[key];schedule();});
 globalThis.addEventListener?.('barun-parcel-account',()=>{if(panelVisible())refreshAccount();else state.account={checked:false};});
 render();
 /** 도면 위 [아파트 검토]·APARTMENT: ⑤ 를 '아파트'로 놓고 보여 준다. 대지가 아직 없으면 ① 주소 칸으로. 창이 보인 뒤 부른다. */
 function focusApartment(){
  state.planKind='apartment';render();
  const view={...ctx,state,site:planSiteState(engine.doc),result:engineResultState(engine.doc)};
  const plan=steps.find(s=>s.id==='plan'),blocked=plan&&plan.evaluate(view).state==='blocked';
  const item=list.querySelector(blocked?'[data-step=site]':'[data-step=plan]');item?.scrollIntoView?.({block:'start',behavior:'smooth'});
  if(blocked){const input=list.querySelector('#plan-site-query');if(input&&!view.site.kind){input.focus();input.classList.add('is-flash');setTimeout(()=>input.classList.remove('is-flash'),1600);}return;}
  if(!apartmentState(view)?.table&&plan?.extra?.aptTable)runStepAction(plan,{id:'aptTable',label:plan.extra.aptTable.label,run:plan.extra.aptTable},ctx,runtime,render);
 }
 return {element:body,render:()=>{if(!state.account.checked)refreshAccount();else render();},schedule,runtime,context:ctx,focusApartment};
}
