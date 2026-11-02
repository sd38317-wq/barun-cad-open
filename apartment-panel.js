// 아파트 검토 1단계 — 가져온 대지(필지 1~10)·용도지역을 읽어 면적·구역(국토계획법 84조)을 표로 보이고 조각을 도면에 그린다.
// 배치(동·인동간격·일조)는 다음 단계. 계산은 로컬 엔진(/api/apartment → 설계엔진 apartment/site_zones).
import {buildApartmentPreview,PREVIEW_LAYER} from './apartment-sheet.js';
import * as G from './geometry.js';
const PART_LAYER='용도지역-조각';
// 대지로 쓸 수 있는 닫힌 PL: 사용자가 그린 선 또는 주소로 불러온 대지선(parcelRole 'site' 바깥 고리). 도로·인접·원대지경계는 아니다(A29).
const enclosureLike=e=>e&&e.type==='polyline'&&e.closed&&e.points?.length>=3&&(!e.parcelRole||e.parcelRole==='site')&&e.attributes?.ring!=='hole';
/** 계획 탭 대지(주소로 불러온 site 바깥 고리)가 하나면 그 점들. 없거나 여럿이면 null. */
export function siteRingPL(doc){
 const rings=G.parcelEntities(doc?.entities||[]).filter(e=>e.parcelRole==='site'&&enclosureLike(e));
 return rings.length===1?rings[0].points.map(p=>({x:p.x,y:p.y})):null;
}
// 흐름 v2 모양 — 값은 바른 에어 대화상자(barun-air.css)에서 잰 값 그대로(연두 #bedb71, 우물 #1c1f23, 선 #3d444d)
const APV2_CSS=`#apartment-dialog .apv2 h2{font-size:18px;font-weight:650;margin:0 0 2px}
#apartment-dialog .apv2-sub{font-size:12px;color:#a3a9b2;margin:0 0 14px}
#apartment-dialog .apv2-steps{display:flex;gap:6px;margin:0 0 14px;font-size:12px}
#apartment-dialog .apv2-steps span{padding:3px 10px;border-radius:999px;color:#a3a9b2;border:1px solid #3d444d}
#apartment-dialog .apv2-steps span.on{color:#15171c;background:#bedb71;border-color:#bedb71;font-weight:700}
#apartment-dialog .apv2-steps span.done{color:#bedb71;border-color:rgba(190,219,113,.45)}
#apartment-dialog .apv2-sum{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:14px}
#apartment-dialog .apv2-sum div{background:#1c1f23;border:1px solid #3d444d;border-radius:8px;padding:8px 10px}
#apartment-dialog .apv2-sum small{display:block;color:#a3a9b2;font-size:11px}
#apartment-dialog .apv2-sum strong{font-size:18px;font-weight:650}
#apartment-dialog .apv2-sum .big strong{color:#bedb71}#apartment-dialog .apv2-sum .chg strong{color:#f0c38c}
#apartment-dialog .apv2-sum s{color:#a3a9b2;font-size:12px;margin-left:4px}
#apartment-dialog .apv2 table{width:100%;border-collapse:collapse;font-size:12px}
#apartment-dialog .apv2 th{font-weight:600;color:#a3a9b2;text-align:left;padding:5px 6px;border-bottom:1px solid #3d444d}
#apartment-dialog .apv2 td{padding:6px;border-bottom:1px solid #2c3139;vertical-align:middle}
#apartment-dialog .apv2 tr.grp td{color:#a3a9b2;font-size:11px;padding-top:10px;border-bottom:none}
#apartment-dialog .apv2 .n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
#apartment-dialog .apv2 tr.off td:not(:first-child){color:#6b727c}#apartment-dialog .apv2 tr.off td.name{text-decoration:line-through}
#apartment-dialog .apv2 tr.changed{background:rgba(240,195,140,.07)}#apartment-dialog .apv2 tr.changed td.n{color:#f0c38c}
#apartment-dialog .apv2 input[type=number]{width:96px;text-align:right}
#apartment-dialog .apv2 .tag{font-size:10.5px;padding:1px 6px;border-radius:4px;margin-left:6px;white-space:nowrap}
#apartment-dialog .apv2 .tag.chk{background:rgba(232,168,92,.16);color:#f0c38c}#apartment-dialog .apv2 .tag.auto{background:rgba(190,219,113,.14);color:#cfe79a}
#apartment-dialog .apv2-sw{appearance:none;width:30px;height:17px;border-radius:9px;background:#3a4049;position:relative;cursor:pointer;margin:0;vertical-align:middle}
#apartment-dialog .apv2-sw::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:#9aa1ab;transition:left 150ms}
#apartment-dialog .apv2-sw:checked{background:#7d9440}#apartment-dialog .apv2-sw:checked::after{left:15px;background:#eef0f3}
#apartment-dialog .apv2-sw:disabled{opacity:.45;cursor:default}
#apartment-dialog .apv2-bar{margin:10px 0 2px;font-size:11.5px;color:#a3a9b2}
#apartment-dialog .apv2-meter{height:6px;border-radius:3px;background:#2c3139;overflow:hidden;margin-top:4px}#apartment-dialog .apv2-meter i{display:block;height:100%;background:#bedb71}
#apartment-dialog .apv2-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:16px}
#apartment-dialog .apv2-acts .sp{flex:1}
#apartment-dialog .apv2 button.ghost{background:none!important;box-shadow:none!important;color:#a3a9b2;padding:9px 6px}
#apartment-dialog .apv2-note{font-size:11.5px;color:#a3a9b2;margin:12px 0 0}
#apartment-dialog .apv2-err{color:#f0a08c;font-size:12px}`;

/** 가져온 대지(parcelRole 'site')의 바깥 경계 중 가장 넓은 것 — 신축설계에서 가두리 PL 대신 쓴다. */
export function sitePolyline(entities){
 const area=pts=>Math.abs(pts.reduce((s,p,i)=>{const q=pts[(i+1)%pts.length];return s+p.x*q.y-q.x*p.y;},0))/2;
 const rings=G.parcelEntities(entities||[]).filter(e=>e?.type==='polyline'&&e.closed&&e.parcelRole==='site'&&e.attributes?.ring!=='hole'&&e.points?.length>=3);
 if(!rings.length)return null;
 return rings.reduce((a,b)=>area(b.points)>area(a.points)?b:a).points.map(p=>({x:p.x,y:p.y}));
}

/** 신축설계용 아파트 빠른 검토: 접수 → 끝날 때까지 조회. 도면에 그리는 일(draw)은 ready 가 풀린 뒤에만 한다
    (소규모 3안을 그리는 동안 도면이 바뀌면 그쪽이 실패하므로). 실패는 던지지 않고 {status:'failed',error}로 돌려준다. */
export async function runQuickReview(api,{pl,entities,layers,opts={},ready=Promise.resolve(),draw=()=>{},onProgress=()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms)),pollMs=3000,maxMs=600000}={}){
 let job;
 try{job=await api('apartment',{action:'review',review:'quick',pl,entities,layers,...opts});}
 catch(error){return {status:'failed',error:error.message,plans:[]};}
 onProgress({status:'queued',done:[],current:null,where:job.where,enclose:job.enclose});
 const started=Date.now();let place=null,have=0,state={};
 while(Date.now()-started<maxMs){
  await sleep(pollMs);
  try{state=await api('apartment',{action:'review_job',jobId:job.job_id,where:job.where,have,engine:job.enclose?.engine,textH:job.enclose?.text_h,northVec:job.north_vec});}
  catch(error){return {status:'failed',error:error.message,plans:place?.plans||[]};}
  if(state.place){place=state.place;have=state.plans_n;}
  onProgress({...state,where:job.where,plans:place?.plans||[]});
  if(state.status==='done'||state.status==='failed')break;
 }
 if(state.status!=='done'&&state.status!=='failed')return {status:'failed',error:'아파트 계산이 10분 안에 끝나지 않았습니다. 아파트 검토 창에서 다시 조회하세요.',plans:place?.plans||[]};
 if(place){await ready;draw({enclose:job.enclose,place});}
 return {status:state.status,error:state.error||'',plans:place?.plans||[],elapsed_s:state.elapsed_s,where:job.where};
}

/** 아파트 가두리 결과 → 소규모 기다림 무대가 받는 요청 모양(대지 경계 m·용도지역 한도). 조각이 여럿이면 면적 가중 한도. */
export function apartmentWaitRequest(enclose){
 const eng=enclose?.engine||{},parts=eng.parts||[],total=parts.reduce((s,p)=>s+(+p.area_m2||0),0)||1;
 const avg=k=>parts.length?parts.reduce((s,p)=>s+(+p[k]||0)*(+p.area_m2||0),0)/total:undefined;
 return {site:{parcel:(eng.site||[]).map(p=>Array.isArray(p)?[+p[0],+p[1]]:[+p.x,+p.y]),address:eng.address||''},
  zoning:{zone:[...new Set(parts.map(p=>p.zone))].join(' + ')||undefined,bcr:avg('bcr'),far:avg('far')},
  program:{use:'공동주택(아파트)',floors_search:true}};
}
/** 아파트 작업 상태 → 무대 사건(1안·2안 = 안 1/2·2/2, 끝난 안은 실제 용적·연면적·층수). */
export function apartmentWaitEvent(state){
 const s=state||{},done=s.done||[],plans=s.plans||[];
 const status={queued:'queued',running:'running',done:'succeeded',failed:'failed'}[s.status]||'queued';
 const planIndex=s.current==='max'?2:s.current==='84'?1:Math.max(1,Math.min(2,done.length));
 const p=plans.at(-1),floors=p?Math.max(0,...(p.buildings||[]).map(b=>+b.floors||0)):0;
 const result=p?{report:{numbers:{far:p.far_pct,gfa:p.gfa_m2??p.gross_floor_area_m2,floors:floors||undefined,building_area:p.building_area_m2}}}:undefined;
 return {status,planIndex,planTotal:2,...(result?{result}:{})};
}

const APT_MODE = { '84': '1안 · 84 주력', max: '2안 · 최대 용적' };
const pct = value => (Number.isFinite(Number(value)) ? Number(value).toFixed(1) + '%' : '-');

/** 아파트 빠른 검토 진행·결과 → 화면 줄. 계산 중이면 단계 줄(steps), 끝나면 카드(cards), 안 되면 이유(blocked). */
export function apartmentView(state) {
 const s = state || {};
 const plans = s.plans || [];
 const usable = plans.filter(p => p.status !== '불가');
 if (s.status === 'failed' && !usable.length) return { blocked: s.error || '아파트 계산이 끝나지 못했습니다.' };
 if (s.status === 'done' && plans.length && !usable.length) {
  // blocked_by 는 서버가 규칙 이름 목록으로 준다(빈 목록이면 동을 앉힐 자리가 없는 것).
  const by = [].concat(plans[0].blocked_by || []).filter(Boolean).join(', ');
  return { blocked: '이 대지는 아파트를 지을 수 없습니다: ' + (by || '동을 앉힐 자리가 없습니다(대지 면적·모양을 확인하세요)') };
 }
 if (s.status === 'done') {
  return { cards: usable.map(p => ({
   title: APT_MODE[p.mode] || p.title || '아파트 안',
   big: pct(p.far_pct), cap: p.target_plan?.target_far_pct != null ? '목표 ' + pct(p.target_plan.target_far_pct) : '',
   meta: [p.units != null && Number(p.units).toLocaleString() + '세대', p.buildings_n != null && p.buildings_n + '개 동', p.share84_pct != null && '84형 ' + Number(p.share84_pct).toFixed(0) + '%'].filter(Boolean).join(' · '),
   ok: !!p.checks_ok,
  })) };
 }
 const done = s.done || [];
 return { steps: ['84', 'max'].map(mode => {
  const plan = plans.find(p => p.mode === mode);
  const state = done.includes(mode) ? 'done' : s.current === mode ? 'now' : 'wait';
  return { mode, label: APT_MODE[mode], state, text: state === 'done' && plan ? pct(plan.far_pct) : state === 'now' ? '동 조합 계산 중' : '대기' };
 }) };
}

export function installApartment(studio){
 const {engine,execute,toast,fit}=studio.context;
 const panel=document.createElement('dialog');panel.id='apartment-dialog';panel.style.cssText='max-width:900px;width:90vw;max-height:85vh;overflow:auto;padding:24px;border:1px solid #39545f;border-radius:16px;background:#12212a;color:#edf4f5';
 const title=document.createElement('h2');title.textContent='아파트 검토 · 대지 면적과 용도지역 조각';title.style.cssText='font-size:22px;margin:0 0 8px;letter-spacing:-.6px';
 const hint=document.createElement('p');hint.style.cssText='font-size:13px;color:#a7bbc1;line-height:1.6;margin:0 0 12px';hint.textContent='[빠른 검토](무료·로그인 회원)·[정밀 검토](P): 가두리 PL 을 고르고 누르면 인센티브 최대 목표에 맞춰 1안(84 주력)·2안(최대 용적)을 계산합니다. 빠른 검토는 대표 동 9종만(안마다 30초 안팎), 정밀 검토는 주동 전부·각도 1°·층수 전부(수십 분). 이 PC 에 아파트 엔진이 있으면 여기서, 없으면 배치 엔진 서버에서 계산하고, 결과는 도면 \'아파트-검토\' 레이어에 글자로 그립니다. [가두리로 검토·배치]: 필지를 불러온 뒤 대지 경계로 쓸 닫힌 PL 하나를 선택하고 누르면 필지 검토 → 용도지역 묶음별 법 검토 → 인센티브 최대 → 계산표 → 3안 배치까지 한 번에 도면 옆에 그립니다. 기존 방식: 지번으로 가져온 대지의 필지별 용도지역을 읽어 법정 한도를 셉니다. 한 필지가 두 지역에 걸치면 "용도지역" 레이어에 경계 점선과 지역 이름 글자를 그린 뒤 다시 실행하세요.';
 const pre=document.createElement('pre');pre.style.cssText='font:12px/1.6 Consolas,monospace;white-space:pre-wrap;background:#1c1f23;border:1px solid #3d444d;border-radius:8px;padding:10px 12px;min-height:80px;color:#c5ccd4';
 const bar=document.createElement('div');bar.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 0;align-items:center';
 const strip=document.createElement('input');strip.type='checkbox';const stripLabel=document.createElement('label');stripLabel.style.fontSize='13px';stripLabel.append(strip,' 도로변 띠 모양 상업지역(작은 조각 기준 660㎡)');
 const button=(text,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.style.cssText='font-size:13px;padding:9px 13px;border-radius:9px';b.onclick=()=>Promise.resolve().then(fn).then(m=>{if(m)toast(m);}).catch(e=>toast(e.message,true));bar.append(b);return b;};
 // 높이제한·인센티브 — 접어 두고, 값 있는 것만 보낸다
 const opt=document.createElement('details');opt.style.cssText='margin-top:10px;font-size:13px';const sum=document.createElement('summary');sum.textContent='높이제한 · 인센티브 (해당 있을 때만)';sum.style.cursor='pointer';opt.append(sum);
 const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px 14px;margin-top:8px';opt.append(grid);
 const field=(label,el)=>{const l=document.createElement('label');l.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:8px';l.append(label,el);grid.append(l);return el;};
 const num=(label,w=90)=>{const i=document.createElement('input');i.type='number';i.style.cssText='width:'+w+'px;font-size:13px;padding:5px';return field(label,i);};
 const chk=label=>{const i=document.createElement('input');i.type='checkbox';return field(label,i);};
 const sel=(label,opts)=>{const s=document.createElement('select');s.style.cssText='font-size:13px;padding:5px';for(const o of opts){const e=document.createElement('option');e.value=o;e.textContent=o;s.append(e);}return field(label,s);};
 const heightLimit=num('높이제한 (m · 가로구역·고도지구)'),openSpace=num('공개공지 면적 (㎡)'),landscape=num('조경 면적 (㎡)'),roadW=num('접한 도로 너비 (m)'),roadL=num('접도 길이 (m)');
 const roadBonus=chk('접도 120% (25m 도로 20m 이상 접함·공원변)'),bcrCut=chk('건폐율 축소'),remodel=chk('리모델링 대비 구조'),redevelop=chk('정비사업 (인동 0.8배)'),northExempt=chk('정북 일조 제외 (지구단위·20m 도로 접함, 86조②)'),sunGate=chk('세대 일조 2시간 미달 안 빼기');
 const green=sel('녹색건축·에너지효율',['미적용','1+/최우수','1+/우수','1/최우수','1/우수']),zeb=sel('제로에너지',['미적용','ZEB 1','ZEB 2','ZEB 3','ZEB 4','ZEB 5','기타']),longlife=sel('장수명주택',['미적용','최우수','우수']);
 const planMode=sel('배치 방식',['목표 배치 (1안 84타입 · 2안 최대 용적)','기존 3안 (타워·판상·혼합)']);
 const options=()=>{const inc={};if(roadBonus.checked)inc.road_frontage={road_width_m:Number(roadW.value)||undefined,road_frontage_m:Number(roadL.value)||undefined};if(bcrCut.checked)inc.bcr_reduction=true;if(remodel.checked)inc.remodeling_ready={tier:'90점 이상'};
  if(Number(openSpace.value)>0)inc.open_space_building_act={open_space_m2:Number(openSpace.value)};if(Number(landscape.value)>0)inc.landscape_upgrade={landscape_m2:Number(landscape.value)};
  if(green.value!=='미적용')inc.green_building_cert=green.value;if(zeb.value!=='미적용')inc.zero_energy=zeb.value;if(longlife.value!=='미적용')inc.long_life_housing=longlife.value;
  const siteExtra={};if(Number(openSpace.value)>0)siteExtra.open_space_m2=Number(openSpace.value);if(Number(landscape.value)>0)siteExtra.landscape_m2=Number(landscape.value);if(Number(roadW.value)>0)siteExtra.road_width_m=Number(roadW.value);if(Number(roadL.value)>0)siteExtra.road_frontage_m=Number(roadL.value);
  return {stripCommercial:strip.checked,heightLimit:Number(heightLimit.value)>0?Number(heightLimit.value):undefined,incentives:Object.keys(inc).length?inc:undefined,siteExtra:Object.keys(siteExtra).length?siteExtra:undefined,redevelopment:redevelop.checked,northExempt:northExempt.checked,sunGate:sunGate.checked,planMode:planMode.value.startsWith('목표')?'target':'maxfar'};};
 let last=null;
 async function run(){
  if(!studio.context.hasSite?.()){panel.close();await studio.context.openParcel('',{contextMeters:100,surroundings:true});throw Error('지번을 골라 대지를 가져온 뒤 "아파트 검토"를 다시 누르세요.');}
  const r=await studio.api('apartment',{action:'zones',entities:engine.doc.entities,layers:engine.doc.layers,...options()});
  last=r;pre.textContent=r.table+'\n\n필지: '+r.parcels.map(p=>(p.jibun||p.pnu)+' ['+(p.zones.join('/')||'용도지역 없음')+']').join(' · ');
  if(!panel.open)panel.showModal();
  return '대지 '+r.result.site_area_m2.toLocaleString()+'㎡ · 조각 '+r.result.parts.length+' · 판정 '+({single:'단일 지역',weighted:'가중평균',separate:'조각별 각자'}[r.result.mode]||r.result.mode);
 }
 function draw(){
  if(!last)throw Error('먼저 검토를 실행하세요.');
  const colors={[PART_LAYER]:['#f4cc87','DASHED'],'등고선':['#8fb3c9','CONTINUOUS']};
  const names=[...new Set(last.draw.map(e=>e.apartmentLayer||PART_LAYER))],ids={};
  for(const name of names){
   if(!engine.doc.layers.some(l=>l.name===name)){const [color,linetype]=colors[name]||['#f4cc87','CONTINUOUS'];execute({type:'layer.add',name,color,linetype,lineweight:0.3});}
   const layer=engine.doc.layers.find(l=>l.name===name);if(layer.locked||layer.visible===false)throw Error(name+' 레이어를 표시·잠금 해제하세요.');ids[name]=layer.id;
  }
  const old=engine.doc.entities.filter(e=>e.apartmentZone&&Object.values(ids).includes(e.layer)).map(e=>e.id);if(old.length)execute({type:'delete',ids:old});
  execute({type:'addMany',entities:last.draw.map(e=>{const {apartmentLayer,...rest}=e;return {...rest,layer:ids[apartmentLayer||PART_LAYER]};})});fit();
  return '용도지역 조각 '+last.result.parts.length+'개'+(last.terrain?' · 등고선('+last.terrain.contour_m+'m)':'')+'을 그렸습니다.';
 }
 const floors=document.createElement('input');floors.type='number';floors.min='5';floors.max='60';floors.value='15';floors.style.cssText='width:64px;font-size:13px;padding:7px';const floorsLabel=document.createElement('label');floorsLabel.style.fontSize='13px';floorsLabel.append('층수 ',floors);
 const plansBox=document.createElement('div');plansBox.style.cssText='display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px';
 let lastPlans=null;
 async function placeRun(){
  if(!studio.context.hasSite?.())throw Error('대지를 먼저 가져오세요.');
  pre.textContent=(pre.textContent||'')+'\n\n배치 3안 계산 중…';
  const r=await studio.api('apartment',{action:'place',entities:engine.doc.entities,layers:engine.doc.layers,...options(),floors:Number(floors.value)});
  lastPlans=r;last={...(last||{}),table:r.zones.table,result:r.zones.result,draw:last?.draw||[],parcels:last?.parcels||[]};pre.textContent=r.zones.table;plansBox.replaceChildren();
  r.plans.forEach((p,i)=>{const card=document.createElement('div');card.style.cssText='background:linear-gradient(180deg,#2c313b,#1a1d23);border:1px solid #4b525c;border-radius:12px;padding:12px 14px;font-size:12px;line-height:1.5';
   const h=document.createElement('strong');h.textContent=p.title;const s=document.createElement('div');s.textContent=p.summary.replace(p.title+' · ','');
   const b=document.createElement('button');b.type='button';b.textContent='이 안 그리기';b.style.cssText='margin-top:8px;font-size:12px;padding:7px 10px;border-radius:8px';
   b.onclick=()=>{try{drawPlan(p);toast(p.title+' 을 "아파트-배치" 레이어에 그렸습니다.');}catch(e){toast(e.message,true);}};card.append(h,s,b);plansBox.append(card);});
  if(!panel.open)panel.showModal();
  return r.plans.map(p=>p.summary).join('\n');
 }
 function drawPlan(p){
  const name='아파트-배치';
  if(!engine.doc.layers.some(l=>l.name===name))execute({type:'layer.add',name,color:'#9bcacb',linetype:'CONTINUOUS',lineweight:0.35});
  const layer=engine.doc.layers.find(l=>l.name===name);if(layer.locked||layer.visible===false)throw Error(name+' 레이어를 표시·잠금 해제하세요.');
  const old=engine.doc.entities.filter(e=>e.layer===layer.id&&String(e.apartmentZone||'').startsWith('plan')).map(e=>e.id);if(old.length)execute({type:'delete',ids:old});
  execute({type:'addMany',entities:p.draw.map(e=>{const {apartmentLayer,...rest}=e;return {...rest,layer:layer.id};})});fit();
 }
 // 가두리 한 번에 — 선택한 닫힌 PL(또는 '가두리' 레이어의 닫힌 PL 하나) → 필지 검토 → 묶음별 법 검토 → 인센티브 최대 → 계산표 → 3안.
 // 결과는 '아파트-검토' 레이어에 미리보기(다시 돌리면 교체), [이 안 그리기] 때만 '아파트-배치' 로 확정.
 let lastAll=null;const off=new Set(),include=new Set();
 let enclosureId=null;   // Selected enclosure identity, including imported parcel blocks.
 // 순서: 선택한 닫힌 PL(대지선 블록을 통째로 골랐으면 그 안 대지선) → '가두리' 레이어 → 불러온 대지선이 하나뿐이면 그것.
 function enclosurePL(){
  const ids=studio.context.selected?.()||new Set();
  const all=G.parcelEntities(engine.doc.entities);
  let pick=all.filter(e=>(ids.has(e.id)||ids.has(e.parcelBlockId))&&enclosureLike(e));
  if(!pick.length){const L=engine.doc.layers.find(l=>l.name==='가두리');pick=L?all.filter(e=>e.layer===L.id&&enclosureLike(e)):[];}
  if(!pick.length)pick=all.filter(e=>e.parcelRole==='site'&&enclosureLike(e));
  if(pick.length!==1)throw Error('대지 경계로 쓸 닫힌 PL 하나를 선택하세요(주소로 불러온 대지선도 됩니다).');
  enclosureId=pick[0].id;return pick[0].points.map(p=>({x:p.x,y:p.y}));
 }
 // 단계 도중 가두리 PL 을 고쳤으면 묶어 둔 대지(flow.enc)를 버리고 새로 묶는다. 선택이 풀려 PL 을 못 찾으면 그대로 둔다.
 function freshSite(){
  // 검토 A9: 처음 고른 가두리 PL 을 지웠거나 열린 선으로 바꿨으면 옛 대지로 계속하지 않는다(선택만 풀린 것은 그 PL 그대로 씀).
  const own=flow.plId?G.parcelEntities(engine.doc.entities).find(e=>e.id===flow.plId):null;
  if(flow.fromPlan&&!flow.plId)return;
  let pl;try{if(flow.fromPlan){if(!enclosureLike(own))throw Error();pl=own.points.map(p=>({x:p.x,y:p.y}));}else{pl=enclosurePL();flow.plId=enclosureId;}}catch{
   if(flow.plId&&!(own?.type==='polyline'&&own.closed&&own.points?.length>=3)){flow.enc=null;flow.pl=null;throw Error('가두리 PL 이 지워졌거나 열린 선이 되었습니다. 닫힌 PL 을 다시 고른 뒤 "아파트 검토"를 다시 누르세요.');}
   pl=own?.points.map(p=>({x:p.x,y:p.y}));if(!pl)return;
  }
  if(JSON.stringify(pl)!==JSON.stringify(flow.pl)){flow.pl=pl;flow.enc=null;}
 }
 function ensureLayer(name,color){if(!engine.doc.layers.some(l=>l.name===name))execute({type:'layer.add',name,color,linetype:'CONTINUOUS',lineweight:0.25});const l=engine.doc.layers.find(l=>l.name===name);if(l.locked||l.visible===false)throw Error(name+' 레이어를 표시·잠금 해제하세요.');return l.id;}
 function drawPreview(r){
  const ents=buildApartmentPreview(r);
  const extra=[...(r.enclose?.draw||[]),...(r.incentive?.draw||[])].map(e=>({...e,layerName:e.apartmentLayer||PREVIEW_LAYER,apartmentZone:'preview'}));
  const names=[...new Set([...ents,...extra].map(e=>e.layerName))],ids={};for(const n of names)ids[n]=ensureLayer(n,n==='용도지역'?'#f4cc87':'#82ded5');
  const old=engine.doc.entities.filter(e=>e.apartmentZone==='preview').map(e=>e.id);if(old.length)execute({type:'delete',ids:old});
  execute({type:'addMany',entities:[...extra,...ents].map(({layerName,apartmentLayer,...e})=>({...e,layer:ids[layerName]}))});fit();
 }
 async function runAll(){
  const r=await studio.api('apartment',{action:'run_all',pl:enclosurePL(),entities:engine.doc.entities,layers:engine.doc.layers,...options(),
   incentiveOff:[...off],includePnus:[...include],zonesByPnu:lastAll?.enclose?.zonesByPnu});
  lastAll=r;drawPreview(r);renderAll(r);if(!panel.open)panel.showModal();
  const ps=r.place.plans.map(p=>`${p.title} ${p.status==='불가'?'불가':Number(p.fill_pct).toFixed(0)+'%'}`).join(' · ');
  return `대지 ${Math.round(r.enclose.engine.site_area_m2).toLocaleString()}㎡ · 묶음 ${r.enclose.engine.parts.length} · ${ps}`;
 }
 const allBox=document.createElement('div');allBox.style.cssText='margin-top:12px;font-size:12px;line-height:1.6';
 function renderAll(r){
  pre.textContent=[r.enclose.table,r.incentive.table,r.place.note||''].filter(Boolean).join('\n\n');
  allBox.replaceChildren();
  // 인센티브 가정 체크 · 기반시설 필지 포함 토글 → 다시 실행
  const det=document.createElement('details');const s=document.createElement('summary');s.textContent='가정한 인센티브 · 기반시설 필지 (체크 바꾸면 다시 계산)';s.style.cursor='pointer';det.append(s);
  const tick=(label,checked,fn)=>{const l=document.createElement('label');l.style.cssText='display:block';const c=document.createElement('input');c.type='checkbox';c.checked=checked;c.onchange=()=>{fn(c.checked);runAll().then(m=>toast(m)).catch(e=>toast(e.message,true));};l.append(c,' ',label);det.append(l);};
  for(const it of r.incentive.items||[])if(it.group==='assumed')tick(`(가정) ${it.name}`,!off.has(it.id),v=>v?off.delete(it.id):off.add(it.id));
  for(const p of r.enclose.parcels||[])if(p.public_like)tick(`기반시설 ${p.jibun} ${Math.round(p.area||0)}㎡ 대지에 포함`,include.has(p.pnu),v=>{v?include.add(p.pnu):include.delete(p.pnu);flow.enc=null;});
  const cards=document.createElement('div');cards.style.cssText='display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:10px';
  r.place.plans.forEach((p,i)=>{const card=document.createElement('div');card.style.cssText='background:linear-gradient(180deg,#2c313b,#1a1d23);border:1px solid #4b525c;border-radius:12px;padding:12px 14px';
   const h=document.createElement('strong');h.textContent=`${i+1}안 · ${p.title}`;const big=document.createElement('div');big.style.cssText='font-size:22px;margin:4px 0';
   big.textContent=p.status==='불가'?'불가':`${Number(p.far_pct).toFixed(0)}% / ${Number(p.far_cap_pct).toFixed(0)}%`;
   const t=document.createElement('div');t.textContent=p.status==='불가'?('막힌 규칙: '+(p.blocked_by||'확인필요')):`${Number(p.units).toLocaleString()}세대 · ${p.buildings_n}개동 · 84형 ${Number(p.share84_pct||0).toFixed(0)}% · 일조 ${p.checks_ok?'통과':'확인'}`;
   card.append(h,big,t);
   if(p.status!=='불가'){const b=document.createElement('button');b.type='button';b.textContent='이 안 그리기';b.style.cssText='margin-top:8px;font-size:12px;padding:7px 10px;border-radius:8px';
    b.onclick=()=>{try{drawPlan(p);toast(p.title+' 을 "아파트-배치" 레이어에 그렸습니다.');}catch(e){toast(e.message,true);}};card.append(b);}
   cards.append(card);});
  allBox.append(det,cards);
 }
 // ── 빠른 검토(무료·회원) · 정밀 검토(P) — 사장님 2026-10-18 ──
 // 접수(action review) → 작업 번호로 조회(review_job). 로컬 엔진이면 이 PC 뒤에서, 없으면 배치 엔진 서버 작업. 끝난 안부터 '아파트-검토' 레이어에 미리보기.
 const REVIEW={quick:'빠른 검토',precise:'정밀 검토'},MODE={'84':'1안 · 84 주력',max:'2안 · 최대 용적'},POLL={quick:3000,precise:15000};
 const reviewBox=document.createElement('div');reviewBox.style.cssText='margin-top:12px;display:flex;flex-direction:column;gap:12px';
 const jobs={};
 async function startReview(review,{inline=false}={}){
  freshSite();const o=options();
  const r=await studio.api('apartment',{action:'review',review,pl:flow.enc?undefined:(flow.pl||enclosurePL()),entities:engine.doc.entities,layers:engine.doc.layers,...o,
   siteExtra:{...(o.siteExtra||{}),...flow.site},incentiveExclude:[...flow.exclude],incentiveChoices:flow.choices,enclose:flow.enc||undefined,
   incentiveOff:[...off],includePnus:[...include],zonesByPnu:lastAll?.enclose?.zonesByPnu});
  clearTimeout(jobs[review]?.timer);jobs[review]={...r,have:0,place:null,state:null,err:'',target:flow.table?.far_pct,maxTarget:flow.max?.max_far_pct};
  flow.enc=flow.enc||r.enclose;flow.step=3;
  pre.textContent=r.enclose.table;drawPreview({enclose:r.enclose});renderReview();renderFlow();if(!inline&&!panel.open)panel.showModal();
  jobs[review].timer=setTimeout(()=>pollReview(review),1000);
  return `${REVIEW[review]} 접수 — ${r.where==='local'?'이 PC 아파트 엔진':'배치 엔진 서버'}에서 계산합니다.`;
 }
 async function pollReview(review){
  const j=jobs[review];if(!j)return;
  try{
   const s=await studio.api('apartment',{action:'review_job',jobId:j.job_id,where:j.where,have:j.have,engine:j.enclose.engine,textH:j.enclose.text_h,northVec:j.north_vec});
   if(jobs[review]!==j)return;
   j.state=s;j.err='';
   if(s.place){j.place=s.place;j.have=s.plans_n;drawPreview({enclose:j.enclose,place:s.place});}
   renderReview();
   if(s.status==='done'||s.status==='failed'){toast(REVIEW[review]+(s.status==='done'?' 끝: '+(j.place?.plans||[]).map(p=>`${p.title} ${Number(p.far_pct).toFixed(1)}%`).join(' · '):' 실패: '+(s.error||'')),s.status!=='done');return;}
  }catch(e){if(jobs[review]!==j)return;j.err=e.message;renderReview();return;}   // 로그인·연결 문제 — [다시 조회]로
  j.timer=setTimeout(()=>pollReview(review),POLL[review]);
 }
 const el=(tag,css,text)=>{const e=document.createElement(tag);if(css)e.style.cssText=css;if(text!==undefined)e.textContent=text;return e;};
 function renderReview(){
  reviewBox.replaceChildren();
  for(const review of ['quick','precise']){const j=jobs[review];if(!j)continue;
   const s=j.state||{},done=s.status==='done'||s.status==='failed',sec=el('section','display:flex;flex-direction:column;gap:8px');
   const hd=el('div','display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap');
   const el_s=Math.floor(Number(s.elapsed_s)||0),clock=el_s<60?el_s+'초':Math.floor(el_s/60)+'분 '+el_s%60+'초';
   hd.append(el('strong','color:#e2e5e9',`${REVIEW[review]} ${done?'결과':'계산 중'}`),el('span','font-size:12px;color:#a3a9b2',`${j.where==='local'?'이 PC':'배치 엔진 서버'}${s.elapsed_s!=null?' · '+(done?'걸린 시간 ':'경과 ')+clock:''}`));sec.append(hd);
   const steps=el('div','background:#1c1f23;border:1px solid #3d444d;border-radius:8px;padding:6px 12px');
   for(const m of j.modes||['84','max']){const ok=(s.done||[]).includes(m),now=s.current===m,p=(j.place?.plans||[]).find(x=>x.mode===m);
    const row=el('div','display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:8px;font-size:12px;padding:3px 0');
    row.append(el('span','color:'+(ok?'#bedb71':'#727882'),ok?'✓':now?'▶':'·'),el('span','',MODE[m]),el('span','color:'+(now?'#bedb71':'#a3a9b2'),ok&&p?`${Number(p.far_pct).toFixed(1)}% / 목표 ${p.target_plan?.target_far_pct??'-'}%`:now?'동 조합 계산 중':done?'-':'대기'));steps.append(row);}
   sec.append(steps);
   if(!done)sec.append(el('p','',review==='quick'?'안마다 30초 안팎. ':'보통 수십 분(80×100m 대지 1안 약 28분). 창을 닫아도 계산은 계속됩니다. '));
   if(s.status==='failed')sec.append(el('p','color:#f0a08c',s.error||'계산이 끝나지 못했습니다. 다시 실행하세요.'));
   if(j.err){const w=el('p','color:#f0a08c',j.err+' ');const b=el('button','margin-left:6px',`다시 조회`);b.type='button';b.onclick=()=>{j.err='';renderReview();pollReview(review);};w.append(b);sec.append(w);}
   const cards=el('div','display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px');
   for(const p of j.place?.plans||[]){const tp=p.target_plan||{},c=el('article','background:linear-gradient(180deg,#2c313b,#1a1d23);border:1px solid '+(p.mode==='84'?'#bedb71':'#4b525c')+';border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:6px;min-width:0');
    const top=el('div','display:flex;justify-content:space-between;gap:8px');top.append(el('strong','color:#e2e5e9',MODE[p.mode]||p.title),el('span','font-size:11px;padding:1px 6px;border-radius:4px;'+(p.checks_ok?'background:rgba(190,219,113,.14);color:#cfe79a':'background:rgba(232,168,92,.16);color:#f0c38c'),p.checks_ok?'검사 통과':'검사 확인'));
    const big=el('div','font-size:26px;font-weight:600;color:#eef0f3',p.status==='불가'?'불가':`${Number(p.far_pct).toFixed(1)}%`);if(p.status!=='불가')big.append(el('span','font-size:14px;color:#a3a9b2',` / ${tp.target_far_pct??p.far_cap_pct}%`));
    c.append(top,big,el('div','font-size:12px;color:#a3a9b2',`${Number(p.units).toLocaleString()}세대 · ${p.buildings_n}동 · 84형 ${Number(p.share84_pct||0).toFixed(0)}% · 최고 ${p.floors_max}층`));
    if(p.status==='불가')c.append(el('div','font-size:12px;color:#f0c38c','배치 불가 — '+([].concat(p.blocked_by||[]).join(' · ')||'확인 필요')));
    else if(tp.gap_pct>0)c.append(el('div','font-size:12px;color:#a3a9b2',`목표까지 ${tp.gap_pct}%p`+([].concat(p.blocked_by||[]).length?' · 막은 규칙: '+[].concat(p.blocked_by).slice(0,3).join(' · '):'')));
    if((tp.assumptions||[]).length)c.append(el('div','font-size:11px;color:#f0c38c',`가정 인센티브 ${tp.assumptions.length}개 — 원문 확인 필요`+(tp.confirmed_far_pct?` (확정만 ${tp.confirmed_far_pct}%)`:'')));
    const acts=el('div','display:flex;gap:8px;flex-wrap:wrap;margin-top:4px');
    const b=el('button','','이 안 그리기');b.type='button';b.className='primary';b.disabled=p.status==='불가';b.onclick=()=>{try{drawPlan(p);toast(p.title+' 을 "아파트-배치" 레이어에 그렸습니다.');}catch(e){toast(e.message,true);}};acts.append(b);
    if(review==='quick'&&done){const u=el('button','border-color:#bedb71;color:#e2e5e9','정밀 검토로 더 올리기 (P)');u.type='button';u.disabled=Boolean(jobs.precise&&!['done','failed'].includes(jobs.precise.state?.status));u.onclick=()=>startReview('precise').then(m=>toast(m)).catch(e=>toast(e.message,true));acts.append(u);}
    c.append(acts);cards.append(c);}
   if(cards.childElementCount)sec.append(cards);
   if(j.place?.note)sec.append(el('pre','margin:0;background:#1c1f23;border:1px solid #3d444d;border-radius:8px;padding:10px 12px;font:12px/1.6 Consolas,monospace;color:#c5ccd4;white-space:pre-wrap',j.place.note));
   reviewBox.append(sec);}
  if(Object.keys(jobs).length)reviewBox.append(el('p','','인센티브는 인증·평가를 받는다고 가정한 값이며 원문 등급 비율 확인 전입니다. 동지 일조는 창 부분(동 단위) 검토입니다. 미리보기는 \'아파트-검토\' 레이어(다시 돌리면 지워짐) · [이 안 그리기]만 \'아파트-배치\' 레이어에 남습니다.'));
  notify();
 }
 button('가두리로 검토·배치',runAll);
 button('검토 실행',run);button('조각 그리기',draw);bar.append(stripLabel,floorsLabel);button('배치 3안',placeRun);

 // ── 흐름 v2 (사장님 2026-10-18): 대지(닫힌 PL) → 인센티브 최대로 목표 용적률 → 빼기·등급 낮추기 → 그 조건으로 다시 산정 → 1안·2안 ──
 // 시안: 작업시안/아파트검토_2026-10-18/시안/Cad-흐름-v2.html. 인센티브 표는 서버(POST /site-plan/apartment/incentive) 또는 이 PC 엔진.
 const flow={step:1,enc:null,table:null,max:null,exclude:new Set(),choices:{},site:{},busy:false,err:'',fromPlan:false,siteKey:''};
 // 계획 탭 ⑤ 가 같은 흐름을 쓴다(2026-10-21 대표: 아파트 계획을 기본 계획창에). 상태가 바뀌면 계획 탭을 다시 그린다.
 const listeners=new Set();
 const notify=()=>{for(const fn of listeners){try{fn();}catch{}}};
 const flowBox=el('div','');flowBox.className='apv2';
 if(!document.getElementById?.('apartment-v2-style')){const st=document.createElement('style');st.id='apartment-v2-style';st.textContent=APV2_CSS;document.head?.append(st);}
 const picked=()=>flow.exclude.size+Object.keys(flow.choices).length+Object.keys(flow.site).length>0;
 const act=(text,fn,cls='')=>{const b=el('button','',text);b.type='button';if(cls)b.className=cls;b.onclick=()=>Promise.resolve().then(fn).then(m=>{if(m)toast(m);}).catch(e=>toast(e.message,true));return b;};
 const NO_PARCEL='도면에 지적(필지)이 없습니다. 오른쪽 계획 탭 ① 대지 선택 → ③ 주변 지적도로 주소 대지를 먼저 불러오세요.';
 const hasParcels=()=>studio.context.hasSite?.()||G.parcelEntities(engine.doc.entities).some(e=>e.parcelRole&&Array.isArray(e.attributes?.originMetres));
 function resetFlow(){flow.exclude.clear();flow.choices={};flow.site={};flow.enc=null;flow.table=flow.max=null;flow.err='';flow.siteKey='';flow.pl=null;flow.plId=null;enclosureId=null;
  for(const k of Object.keys(jobs)){clearTimeout(jobs[k].timer);delete jobs[k];}}
 async function startFlow(){
  resetFlow();flow.fromPlan=false;
  const fail=message=>{flow.step=1;flow.err=message;renderFlow();if(!panel.open)panel.showModal();return '';};
  try{flow.pl=enclosurePL();flow.plId=enclosureId;}catch(e){return fail(hasParcels()?e.message:NO_PARCEL);}
  if(!hasParcels())return fail(NO_PARCEL);
  flow.step=2;if(!panel.open)panel.showModal();
  return loadTable();
 }
 async function loadTable(){
  flow.busy=true;flow.err='';renderFlow();
  try{
   freshSite();const o=options();
   const r=await studio.api('apartment',{action:'incentive_table',pl:flow.enc?undefined:flow.pl,entities:flow.enc?undefined:engine.doc.entities,layers:flow.enc?undefined:engine.doc.layers,...o,
    siteExtra:{...(o.siteExtra||{}),...flow.site},incentiveExclude:[...flow.exclude],incentiveChoices:flow.choices,enclose:flow.enc||undefined,
    includePnus:[...include],zonesByPnu:lastAll?.enclose?.zonesByPnu});
   if(r.enclose){flow.enc=r.enclose;pre.textContent=r.enclose.table||'';drawPreview({enclose:r.enclose});}
   // 배치 엔진 서버 표에는 대지 면적·지역 이름이 없을 때가 있다 — 묶은 대지(enclose)로 채운다.
   const eng=flow.enc?.engine||{};
   flow.table={...r.table,area_m2:r.table.area_m2||Math.round(Number(eng.site_area_m2)||0),zone:r.table.zone||eng.zoning?.zone||eng.parts?.[0]?.zone||''};flow.where=r.where;if(!flow.max||!picked())flow.max=flow.table;flow.step=2;
   return `목표 용적률 ${r.table.far_pct}%`+(picked()?` (인센티브 최대 ${flow.max.max_far_pct}%)`:' — 인센티브 최대');
  }catch(e){flow.err=e.message;throw e;}
  finally{flow.busy=false;renderFlow();}
 }
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 function setChoice(it,label){
  const c=it.choices.find(x=>x.label===label);
  if(!c||c.value==='미적용'){flow.exclude.add(it.id);delete flow.choices[it.id];}
  else{flow.exclude.delete(it.id);if(it.max_choice&&same(c.value,it.max_choice.value))delete flow.choices[it.id];else flow.choices[it.id]=c.value;}
  return loadTable();
 }
 function toggle(it,on){
  if(on){flow.exclude.delete(it.id);if(!it.max_choice){const c=it.choices.find(x=>x.value!=='미적용');if(c)flow.choices[it.id]=c.value;}}
  else{flow.exclude.add(it.id);delete flow.choices[it.id];}
  return loadTable();
 }
 function changedRow(it){const m=flow.max?.items?.find(x=>x.id===it.id);return Boolean(m)&&(m.on!==it.on||(it.on&&it.choice?.label!==m.choice?.label));}
 const GROUPS=[['auto','자동 적용 — 대지 사실로 판정'],['assumed','받는다고 가정 — 인증·평가'],['value','값을 넣으면 적용 — 없는 사실은 0']];
 function renderFlow(){
  const t=flow.table,max=flow.max;
  const head=el('div','');head.append(el('h2','',flow.fromPlan?'인센티브 고르기':'아파트 검토'));
  const sub=t?`${t.zone||''} · ${Number(t.area_m2||0).toLocaleString()}㎡ · ${flow.where==='local'?'이 PC 엔진':'배치 엔진 서버'}`:'대지 경계로 쓸 닫힌 PL 하나를 고르고 시작하세요.';
  const subP=el('p','',sub);subP.className='apv2-sub';head.append(subP);
  const steps=el('div','');steps.className='apv2-steps';
  if(!flow.fromPlan)[['1','대지'],['2','인센티브'],['3','결과']].forEach(([n,l],i)=>{const s=el('span','',`${n} ${l}`);s.className=i+1===flow.step?'on':i+1<flow.step?'done':'';steps.append(s);});
  const body=[];
  if(flow.step===1){
   body.push(el('p','',flow.err||'도면에서 대지 경계(닫힌 PL)를 선택한 뒤 [선택한 PL로 시작]을 누르면, 받을 수 있는 인센티브를 전부 최대로 넣어 목표 용적률을 계산합니다.'));
   const a=el('div','');a.className='apv2-acts';const sp=el('span','');sp.className='sp';a.append(act('선택한 PL로 시작',startFlow,'primary'),sp,act('닫기',()=>panel.close(),'ghost'));body.push(a);
  }else if(flow.step===2&&t){
   const ch=picked();
   const sum=el('div','');sum.className='apv2-sum';
   const cell=(label,val,cls,old)=>{const d=el('div','');if(cls)d.className=cls;d.append(el('small','',label));const s=el('strong','',val);d.append(s);if(old)d.append(el('s','',old));sum.append(d);};
   cell('대지 면적',`${Number(t.area_m2||0).toLocaleString()}㎡`);cell('기준 용적률',`${t.base_far_pct}%`);
   cell(ch?'목표 (바꾼 조건)':'목표 (인센티브 최대)',`${t.far_pct}%`,ch?'chg':'big',ch&&max&&max.max_far_pct!==t.far_pct?`${max.max_far_pct}%`:'');
   cell('그중 확정 (원문 확인)',`${t.confirmed_far_pct}%`);
   const tb=el('table',''),hd=el('tr','');for(const [h,w] of [['적용','40px'],['인센티브',''],['등급·값','170px'],['더해짐','70px']]){const th=el('th',w?'width:'+w:'',h);if(h==='더해짐')th.className='n';hd.append(th);}
   const thead=el('thead','');thead.append(hd);const tbody=el('tbody','');tb.append(thead,tbody);
   for(const [g,label] of GROUPS){const rows=(t.items||[]).filter(i=>i.group===g);if(!rows.length)continue;
    const gr=el('tr','');gr.className='grp';const gc=el('td','',label);gc.colSpan=4;gr.append(gc);tbody.append(gr);
    for(const it of rows){const tr=el('tr','');tr.className=[it.on?'':'off',changedRow(it)?'changed':''].filter(Boolean).join(' ');
     const sw=el('input','');sw.type='checkbox';sw.className='apv2-sw';sw.checked=it.on;sw.disabled=flow.busy||(it.group==='value'&&!it.on&&!flow.site[it.param]);
     sw.onchange=()=>toggle(it,sw.checked).then(m=>toast(m)).catch(e=>toast(e.message,true));
     const c1=el('td','');c1.append(sw);
     const c2=el('td','');c2.className='name';c2.append(it.name);
     const tag=it.group==='auto'&&!it.on?'해당 없음':!it.confirmed&&it.on?'확인 필요':'';
     if(tag){const s=el('span','',tag);s.className='tag '+(it.group==='auto'?'auto':'chk');c2.append(s);}
     const c3=el('td','');
     if(it.group==='value'){const inp=el('input','');inp.type='number';inp.placeholder=it.needs||'값';inp.value=flow.site[it.param]??'';inp.disabled=flow.busy;
      inp.onchange=()=>{const v=Number(inp.value);if(v>0)flow.site[it.param]=v;else delete flow.site[it.param];loadTable().then(m=>toast(m)).catch(e=>toast(e.message,true));};c3.append(inp);}
     else if((it.choices||[]).length>2||it.on){const s=el('select','');for(const c of it.choices||[]){const o=el('option','',c.label);o.value=c.label;s.append(o);}
      s.value=it.on?(it.choice?.label??it.choices[0]?.label):'미적용';s.disabled=flow.busy||it.group==='auto';
      s.onchange=()=>setChoice(it,s.value).then(m=>toast(m)).catch(e=>toast(e.message,true));c3.append(s);}
     else c3.append('—');
     const c4=el('td','',it.on&&it.far_gain_pct?`+${it.far_gain_pct}%`:'0%');c4.className='n';
     tr.append(c1,c2,c3,c4);tbody.append(tr);}}
   const bar=el('div','');bar.className='apv2-bar';
   if(t.green){bar.append(`녹색건축 묶음 한도 15%(${t.green.limit_pct}%p) 중 ${t.green.used_pct}%p 사용`);const m=el('div','');m.className='apv2-meter';const fill=el('i',`width:${Math.min(100,100*t.green.used_pct/(t.green.limit_pct||1))}%`);m.append(fill);bar.append(m);}
   const a=el('div','');a.className='apv2-acts';
   // 계획 탭 ⑤ 에서 연 창이면 검토는 계획 탭에서 한다 — 여기서는 조건만 고르고 돌아간다.
   if(flow.fromPlan)a.append(act('이 조건으로 계획 탭에 반영',()=>{panel.close();notify();return `목표 용적률 ${t.far_pct}% — 계획 탭 ⑤에서 [빠른 검토]를 누르세요.`;},'primary'));
   else a.append(act(ch?'바꾼 조건으로 다시 산정 · 빠른':'빠른 검토 (무료 · 회원)',()=>startReview('quick'),'primary'),act(ch?'정밀 (P)':'정밀 검토 (P)',()=>startReview('precise')));
   if(ch)a.append(act('처음(최대)으로',()=>{flow.exclude.clear();flow.choices={};flow.site={};return loadTable();},'ghost'));
   const sp=el('span','');sp.className='sp';a.append(sp,act('닫기',()=>panel.close(),'ghost'));
   if(flow.busy)a.append(el('span','','계산 중…'));
   const note=el('p','',ch?'바꾼 줄: '+(t.items||[]).filter(changedRow).map(it=>`${it.name} ${it.on?(it.choice?.label||'적용'):'끔'}`).join(', ')
    :"'확인 필요'는 인증을 받는다고 가정한 항목입니다. 끄거나 등급을 낮추면 목표 용적률을 바로 다시 계산합니다.");note.className='apv2-note';
   if(flow.err){const w=el('p','',flow.err);w.className='apv2-err';body.push(w);}
   body.push(sum,tb,bar,a,note);
  }else if(flow.step===2){const p=el('p','',flow.err||'인센티브 표를 계산하는 중입니다…');if(flow.err)p.className='apv2-err';body.push(p);}
  else{
   const a=el('div','');a.className='apv2-acts';a.append(act('‹ 인센티브 다시 바꾸기',()=>{flow.step=2;renderFlow();},'ghost'));
   if(t)body.push(el('p','',`목표 ${t.far_pct}%`+(max&&max.max_far_pct!==t.far_pct?` (처음 최대 ${max.max_far_pct}%)`:'')));
   body.push(reviewBox,a);
  }
  flowBox.replaceChildren(head,...(flow.fromPlan?[]:[steps]),...body);
  notify();
 }
 const oldTools=el('details','margin-top:16px');const oldSum=el('summary','cursor:pointer;color:#a3a9b2','예전 도구 (필지별 용도지역 · 가두리 3안 · 조건 입력)');
 oldTools.append(oldSum,hint,pre,bar,opt,allBox,plansBox);
 renderFlow();
 panel.append(flowBox,oldTools);document.body.append(panel);
 // 도면 위 [아파트 검토]·APARTMENT 명령: 계획 탭 ⑤ 를 '아파트'로 열어 준다. 계획 탭이 없는 화면(시험 등)이면 예전처럼 이 창.
 const openApartment=()=>{if(studio.context.openPlanApartment){studio.context.openPlanApartment();return Promise.resolve();}return startFlow().then(m=>{if(m)toast(m);}).catch(e=>toast(e.message,true));};
 const open=document.createElement('button');open.textContent='아파트 검토';open.dataset.menuNative='APARTMENT';open.onclick=openApartment;
 document.querySelector('#canvas-tools')?.prepend(open);
 studio.handlers.APARTMENT=openApartment;
 studio.context.apartmentZones=run;studio.context.apartmentOpen=()=>{if(!panel.open)panel.showModal();};
 globalThis.addEventListener?.('cad-document-switched',()=>{resetFlow();flow.step=1;flow.fromPlan=false;if(panel.open)panel.close();notify();});
 studio.context.apartmentFlow={
  /** 계획 탭이 그릴 상태(읽기 전용 사본). */
  state:()=>({siteKey:flow.siteKey,table:flow.table,max:flow.max,busy:flow.busy,err:flow.err,where:flow.where,picked:picked(),
   jobs:Object.fromEntries(Object.entries(jobs).map(([k,j])=>[k,{where:j.where,modes:j.modes,state:j.state,place:j.place,err:j.err}]))}),
  /** 계획 탭 대지로 인센티브 최대 표를 계산한다. 대지(siteKey)가 바뀌었을 때만 처음부터. */
  load:async(pl,siteKey)=>{
   if(flow.siteKey!==siteKey||!flow.table){resetFlow();flow.pl=pl;flow.plId=G.parcelEntities(engine.doc.entities).find(e=>enclosureLike(e)&&same(e.points.map(p=>({x:p.x,y:p.y})),pl))?.id||null;flow.siteKey=siteKey;}
   flow.fromPlan=true;flow.step=2;return loadTable();
  },
  review:review=>startReview(review,{inline:true}),
  retry:review=>{const j=jobs[review];if(j){j.err='';pollReview(review);}},
  incentives:()=>{flow.fromPlan=true;flow.step=2;renderFlow();if(!panel.open)panel.showModal();},
  draw:p=>{drawPlan(p);return `${MODE[p.mode]||p.title} 을 "아파트-배치" 레이어에 그렸습니다.`;},
  onChange:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);},
 };
 // 신축설계(new-build.js)가 소규모 3안과 함께 부른다. 대지 경계를 가두리로 쓰고, 결과는 '아파트-검토' 레이어에 미리보기로 그린다.
 studio.context.apartmentQuickReview=({ready,onProgress}={})=>{
  const pl=sitePolyline(engine.doc.entities);
  // 계획 탭의 '아파트 계획안' 단계도 같은 진행을 보이게 알린다(어느 쪽에서 시작했든).
  const tell=state=>{globalThis.dispatchEvent?.(new CustomEvent('barun-apartment-review',{detail:state}));return state;};
  if(!pl)return Promise.resolve(tell({status:'failed',error:'대지 경계가 없어 아파트 검토를 하지 못했습니다.',plans:[]}));
  tell({status:'queued',done:[],plans:[]});
  // 이미 그린 계획안(sitePlanId)·아파트 미리보기(apartmentZone) 글자를 용도지역 글자로 잘못 읽지 않게 뺀다.
  const entities=engine.doc.entities.filter(e=>!e.sitePlanId&&!e.apartmentZone);
  // The copied apartment screen receives actual site, server progress and both plans; close affects only the overlay.
  const viewport=document.querySelector('.viewport');let wait=null,waitLoad=null;
  const stage=fn=>waitLoad?.then(()=>{try{fn();}catch{wait?.destroy();wait=null;}});
  const waitFor=state=>{
   if(state.enclose&&viewport&&!waitLoad)waitLoad=import('./apartment-wait-frame.js').then(m=>{wait=m.mountApartmentWaitFrame(viewport,state.enclose,{onClose:()=>{wait=null;}});}).catch(()=>{});
   stage(()=>wait?.update(state));
  };
  return runQuickReview((...a)=>studio.api(...a),{pl,entities,layers:engine.doc.layers,opts:options(),ready,onProgress:state=>{waitFor(state);const {enclose,...rest}=state;tell(rest);onProgress?.(rest);},draw:drawPreview})
   .then(result=>{stage(()=>wait?.update(result));return tell(result);});
 };
}
