import {createReviewTables} from './review-table.js';
import {legacyStatusToReview} from './review-model.js';
import {energyPart,energyReviewItems,loadEnergyStandards,installEnergyInputs} from './energy-envelope.js';
import {energyPlanReviewItem,energyPlanCard,loadEnergyPlanStandards,ENERGY_PLAN_FIELDS,applyEnergyPlanInputs} from './energy-plan.js';
import * as G from './geometry.js';
import {accessReview,ACCESS_DEFAULTS,setAccessSettings,editAccessInput} from './access-review.js';
import {entitiesById} from './entity-index.js';
import {createReviewStore,installReviewPanel,liveCheckReviewItems,stageReviewRepair} from './review-panel.js';
import {plotSVG} from './plot.js';
import {autoSiteAnalysis,autoSiteContext,isLiveCheckTarget,STATUTORY_LIMITS,sunSectionEntities,planFloorSettings} from './livecheck-auto.js';
// Both sidebar and law-panel actions share one lazy viewport installation.
export function createReview3DOpener(context,load=()=>import('./review-3d.js')){
 let pending;
 // action: 'open'(기본) 또는 'walk'(평면에서 점 찍어 내부 투시도로 들어가기)
 return async(action='open')=>{
  pending??=load().then(({installReview3D})=>installReview3D(context)).catch(error=>{pending=null;throw error;});
  const view=await pending;(view[action]||view.open)();
 };
}
export function installLiveCheck({engine,getDrawingInfo=()=>({}),getSelectedIds=()=>[],render,zoomObjects,toast,download,form,openReview3D=createReview3DOpener({engine,toast,download})}){
 /* 검사 일꾼(livecheck-worker.js)은 214KB 다. 실제로 검사할 때 만든다. */
 const pending=new Map();let workerCache=null;
 const worker=new Proxy({},{get(_,key){
  if(!workerCache){workerCache=new Worker(new URL('./livecheck-worker.js',import.meta.url),{type:'module'});for(const [k,v] of Object.entries(workerHandlers))workerCache[k]=v;}
  const value=workerCache[key];return typeof value==='function'?value.bind(workerCache):value;
 },set(_,key,value){workerHandlers[key]=value;if(workerCache)workerCache[key]=value;return true;}});
 const workerHandlers={};
 // 로그인으로 핵심 자산이 풀리면(vault_gate) 잠긴 자리 Worker 를 버리고 다음 검사 때 진짜 검사기를 새로 띄운다.
 globalThis.addEventListener?.('barun-protected-unlocked',()=>{workerCache?.terminate();workerCache=null;});
 let serial=0,revision=0,timer,renderJob=0,changedAt=performance.now(),previewOverlay=[];
 let result={active:false,findings:[],status:'대지 미분석'},highlights=new Set(),overlay=[];
 const badge=document.createElement('button');badge.className='livecheck-status';badge.textContent='대지 미분석';document.querySelector('footer').append(badge);
 const row=document.querySelector('.drawing-row'),panel=document.createElement('aside');panel.className='livecheck-panel';panel.hidden=true;
 panel.innerHTML='<strong>입력 기준 검사</strong><p class="lc-scope">건폐율 · 용적률 · 건축선 · 입력한 정북 사선 기준을 비교합니다. 주차·피난 등 전체 법규 자동 판정은 포함하지 않습니다.</p><ol class="lc-steps"><li>대지·건축선과 확인한 기준 설정</li><li>건물·층 연결 (대지 경계 자동 제외)</li><li>결과와 산출 근거 확인</li></ol><p class="lc-summary">검사 준비가 필요합니다.</p><p class="lc-plain"></p><ul class="lc-basis"></ul><button class="lc-ai">AI에게 쉽게 설명받기</button><button class="lc-auto">대지 정보로 자동 설정</button><button class="lc-section">일조 단면 그리기</button><button class="lc-manual">도면에서 기준 설정</button><button class="lc-import">분석 파일 불러오기</button><button class="lc-export">기준 JSON 저장</button><label><input type="checkbox" class="lc-include">DXF 저장 시 위반 해칭 포함</label><button class="lc-layers">건물 층·높이·면적 설정</button><div class="lc-list"></div>';
 row.append(panel);const toggle=document.createElement('button');toggle.className='livecheck-toggle';toggle.textContent='공통 검토';const rail=document.createElement('nav');rail.className='sidebar-tabs';rail.setAttribute('aria-label','보조 패널');const aiTab=document.getElementById('ai-sidebar-toggle');if(aiTab)rail.append(aiTab);rail.append(toggle);row.append(rail);badge.onclick=toggle.onclick=()=>{const opening=panel.hidden;const ai=document.getElementById('ai-sidebar-toggle');if(opening&&ai?.getAttribute('aria-expanded')==='true')ai.click();panel.hidden=!opening;if(opening)syncManualZone(true);};document.getElementById('ai-sidebar-toggle')?.addEventListener('click',()=>{panel.hidden=true;});
 const accessButton=document.createElement('button');accessButton.textContent='편의시설 검토';accessButton.onclick=()=>openAccess();panel.append(accessButton);
 const accessInput=document.createElement('button');accessInput.textContent='선택 객체 편의시설 입력';accessInput.onclick=()=>editAccess().catch(e=>toast(e.message,true));panel.append(accessInput);
 async function editAccess(){await openAccess();const selected=getSelectedIds(),related=reviews.items.filter(i=>i.objectIds.some(id=>selected.includes(id))).flatMap(i=>i.objectIds);editAccessInput({engine,form,ids:[...new Set([...selected,...related])],onDone:()=>{reviews.markChanged(null);return openAccess();}});}
 const accessSettings=document.createElement('button');accessSettings.textContent='편의시설 기준·문 제외';accessSettings.onclick=()=>{const current={...ACCESS_DEFAULTS,...engine.doc.reviewSettings?.access},labels=['문 실폭 최소 (mm)','경사로 최대 기울기 (1/12 = 0.0833333)','경사로 유효폭 최소 (mm)','참 최소 길이 (mm)','회전원 지름 (mm)','변기 옆 최소 (mm)','변기 앞 최소 (mm)','접근로 통과폭 최소 (mm)','접근로 최대 단차 (mm)'];form('편의시설 기준·문 제외',[...Object.keys(ACCESS_DEFAULTS).map((name,i)=>({name,label:labels[i],type:'number',value:current[name]})),{name:'excludedDoors',label:'설계자 제외 문 번호 (쉼표 구분, 예: D-01)',value:(current.excludedDoors||[]).join(',')}],values=>{const changes=Object.fromEntries(Object.keys(ACCESS_DEFAULTS).map(k=>[k,values[k]==null||String(values[k]).trim()===''?null:Number(values[k])])),excludedDoors=String(values.excludedDoors||'').split(',').map(s=>s.trim()).filter(Boolean);if(excludedDoors.some(s=>!/^D-\d+$/.test(s)))throw Error('문 번호를 확인하세요.');const draft={reviewSettings:engine.doc.reviewSettings,reviewHistory:engine.doc.reviewHistory};setAccessSettings(draft,{...changes,excludedDoors});engine.execute({type:'document.update',changes:{reviewSettings:draft.reviewSettings,reviewHistory:draft.reviewHistory}});reviews.markChanged(null);return openAccess();});};panel.append(accessSettings);
 async function openAccess(){panel.hidden=false;reviewView.selectField('access');try{await reviews.recheck({all:true,field:'access'});}catch(e){toast(e.message,true);}}
 const advanced=document.createElement('details');const advancedTitle=document.createElement('summary');advancedTitle.textContent='고급 설정 · 파일';advanced.append(advancedTitle);for(const selector of ['.lc-import','.lc-export','.lc-include']){const element=panel.querySelector(selector);advanced.append(element.tagName==='INPUT'?element.parentElement:element);}panel.append(advanced);
 const $=s=>panel.querySelector(s),file=document.createElement('input');file.type='file';file.accept='.json';file.hidden=true;panel.append(file);
 let historyWrite=false,deltaSerial=0,reviewView,reviewTables,tableRefreshQueued=false,restoring=false,reviewRevision=getDrawingInfo().revision??null,siteDirty=new Set(),siteFullScope=false;
 const reviews=createReviewStore({getDoc:()=>engine.doc,zoomObjects,persistHistory:history=>{historyWrite=true;try{if(engine.setReviewHistory)engine.setReviewHistory(history);else engine.execute({type:'document.update',changes:{reviewHistory:history}});}finally{historyWrite=false;}},onChange:()=>{reviewView?.draw();if(!restoring&&!tableRefreshQueued){tableRefreshQueued=true;queueMicrotask(()=>{tableRefreshQueued=false;if(!reviews.checking)syncReviewTables();});}}});
 function syncReviewTables(){try{reviewTables?.sync();}catch(e){toast('검토표 갱신: '+e.message,true);}}
 function restoreReviews(){restoring=true;try{reviewTables.reset();reviews.restore(reviewTables.savedItems());}finally{restoring=false;}queueMicrotask(()=>{if(!reviews.checking)syncReviewTables();});}
 const reviewDoc=()=>Object.assign(Object.create(engine.doc),getDrawingInfo(),{revision:engine.doc.revision??reviewRevision});reviewTables=createReviewTables(engine,reviews,reviewDoc);restoreReviews();
 function insertReviewTable(){form('검토표 넣기',[{name:'x',label:'삽입 X (mm)',type:'number',value:0},{name:'y',label:'삽입 Y (mm)',type:'number',value:0}],v=>{const x=Number(v.x),y=Number(v.y);if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('삽입 좌표를 확인하세요.');reviewTables.insert(x,y);render();});}
 let planDb=null;loadEnergyPlanStandards().then(d=>{planDb=d;reviewView?.draw();}).catch(()=>{});
 // 에너지절약계획서 조건: 연면적은 설계자가 넣는다(용적률 산입 면적은 지하·주차장 기준이 달라 참고로만 보인다).
 function editEnergyPlan(){const doc=engine.doc,current=doc.reviewSettings?.energyPlan||{},far=result.areaSummary?.farArea;form('에너지절약계획서 · 조건',ENERGY_PLAN_FIELDS.map(f=>({...f,value:current[f.name]??'',...(f.name==='nonResidentialAreaM2'&&far!=null?{label:f.label+' · 참고: 용적률 산입 면적 '+Math.round(far).toLocaleString('ko-KR')+'㎡'}:{})})),values=>{if(engine.doc!==doc)throw Error('도면이 바뀌었습니다. 계획서 조건을 다시 여세요.');applyEnergyPlanInputs(engine,values);reviews.recheck({all:true,field:'energy'}).catch(e=>toast(e.message,true));toast('계획서 조건 저장');});}
 reviewView=installReviewPanel({host:$('.lc-list'),store:reviews,getDoc:reviewDoc,insertTable:insertReviewTable,onError:e=>toast(e.message,true),cards:{energy:()=>energyPlanCard({doc:engine.doc,db:planDb,onEdit:editEnergyPlan})}});
 reviews.registerReviewSource('access',({doc})=>{const result=accessReview(doc);return {items:result.items,linkedObjects:Object.fromEntries(result.items.map(i=>[i.id,['@access-input']])),accept:()=>{if(!result.updates.length&&!Object.entries(result.reviewObjectSeq).some(([k,n])=>engine.doc.reviewObjectSeq?.[k]!==n))return;historyWrite=true;try{engine.execute({type:'batch',commands:[{type:'document.update',changes:{reviewObjectSeq:result.reviewObjectSeq}},...(result.updates.length?[{type:'updateMany',updates:result.updates}]:[])]});}finally{historyWrite=false;}}};});
 reviews.registerReviewSource('energy',async({doc})=>{let db=null;try{db=await loadEnergyStandards();}catch{}try{planDb=await loadEnergyPlanStandards();}catch{}const items=[energyPlanReviewItem(doc,planDb),...energyReviewItems(doc,db)];return {items,replaceIds:reviews.items.filter(i=>i.field==='energy').map(i=>i.id),linkedObjects:Object.fromEntries(items.map(i=>[i.id,['@energy-input']]))};});
 installEnergyInputs({host:$('.lc-list'),engine,form,reviews,toast});
 reviews.registerReviewSource('law',async({doc,items,all})=>{const full=all||!items.length||siteFullScope,basis=new Set(Object.values(doc.siteAnalysis?.sourceIds||{})),objects=new Set([...siteDirty,...items.filter(i=>!['live:coverage','live:far'].includes(i.id)).flatMap(i=>i.objectIds)].filter(id=>!id.startsWith('@')&&!basis.has(id))),next=await check(doc,full?null:[...objects]),converted=convertReviews(next),ids=new Set(items.map(i=>i.id));const scoped=full?converted:converted.filter(i=>ids.has(i.id)||i.objectIds.some(id=>objects.has(id)));return {...reviewBatch(scoped),accept:()=>{siteDirty.clear();siteFullScope=false;display(next,false);}};});
 function convertReviews(next){const converted=liveCheckReviewItems(next,engine.doc.siteAnalysis),basis=Object.values(engine.doc.siteAnalysis?.sourceIds||{}).filter(Boolean),targets=next.areaSummary?.floors?.flatMap(f=>f.ids)||[];return converted.map(i=>({...i,reviewObjectIds:[...new Set([...i.reviewObjectIds,...entitiesById(engine.doc.entities,new Set(i.objectIds)).map(e=>e.reviewObjectId).filter(Boolean)])],objectIds:[...new Set([...i.objectIds,...basis,...(i.id.startsWith('live:north')?engine.doc.layers.filter(l=>isLiveCheckTarget({type:'polyline',closed:true},l)).map(l=>'@layer:'+l.id):[]),...(!i.objectIds.length||i.id==='live:coverage'||i.id==='live:far'?['@site-input',...targets]:[])])]}));}
 function reviewBatch(items){return {items:items.map(i=>({...i,objectIds:i.objectIds.filter(id=>!id.startsWith('@'))})),linkedObjects:Object.fromEntries(items.map(i=>[i.id,i.objectIds.filter(id=>id.startsWith('@'))]))};}
 function notifyDelta(delta,previousDoc){deltaSerial++;reviewTables.delta(delta);if(reviewTables.writing)return;reviewRevision=getDrawingInfo().revision??null;if(delta&&[...delta.removed,...delta.added].length&&[...delta.removed,...delta.added].every(e=>e.reviewTableId))return;if(engine.lastExecution?.type==='load'||engine.lastExecution?.type==='new'){restoreReviews();siteDirty.clear();siteFullScope=false;return;}let relevant=false;const layers=new Map(engine.doc.layers.map(l=>[l.id,l]));for(const e of [...(delta?.removed||[]),...(delta?.added||[])]){siteDirty.add(e.id);const l=layers.get(e.layer)||previousDoc?.layers.find(l=>l.id===e.layer);if(isLiveCheckTarget(e,l))relevant=true;}const oldLayers=new Map((previousDoc?.layers||[]).map(l=>[l.id,l])),changedLayers=previousDoc&&previousDoc.layers!==engine.doc.layers?engine.doc.layers.filter(l=>['height','floor','elevation','upperFloors','building','excludeFromFAR'].some(k=>oldLayers.get(l.id)?.[k]!==l[k])).map(l=>({id:'@layer:'+l.id})):[];if(changedLayers.length||!delta)siteFullScope=true;reviews.markChanged(delta?{removed:delta.removed,added:[...delta.added,...(delta.added.length||delta.removed.length?[{id:'@access-input'}]:[]),...changedLayers,...(relevant||changedLayers.length?[{id:'@site-input'}]:[])]}:null);}
 const zoneField=document.createElement('div');zoneField.className='lc-zone-field';zoneField.hidden=true;
 const zoneLabel=document.createElement('label');zoneLabel.textContent='용도지역 직접 선택';
 const zoneSelect=document.createElement('select');zoneSelect.className='lc-zone';zoneSelect.setAttribute('aria-label','용도지역 직접 선택');
 for(const zone of ['',...Object.keys(STATUTORY_LIMITS)]){const option=document.createElement('option');option.value=zone;option.textContent=zone||'용도지역을 선택하세요';zoneSelect.append(option);}
 const zoneNote=document.createElement('p');zoneNote.className='lc-scope';zoneNote.textContent='토지정보가 없어 시행령 상한으로 검사합니다. 조례값은 다를 수 있고 더 낮을 수 있으니 관할 조례를 확인하세요. 선택 후 [대지 정보로 자동 설정]을 누르세요.';
 zoneLabel.append(zoneSelect);zoneField.append(zoneLabel,zoneNote);$('.lc-auto').before(zoneField);
 let zoneDoc=engine.doc;
 function restoreManualZone(){zoneDoc=engine.doc;zoneSelect.value=engine.doc.siteAnalysis?.manualZone||engine.doc.reviewSettings?.manualZone||'';}
 function syncManualZone(restore=false){
  if(restore||zoneDoc!==engine.doc)restoreManualZone();
  const {needsManualZone}=autoSiteContext(engine.doc);zoneField.hidden=!needsManualZone;
  if(!needsManualZone)zoneSelect.value='';
 }
 globalThis.addEventListener?.('cad-document-switched',()=>{revision++;renderJob++;deltaSerial++;restoreReviews();siteDirty.clear();siteFullScope=false;result={active:false,findings:[],status:'대지 미분석'};highlights=new Set();overlay=[];previewOverlay=[];restoreManualZone();zoneField.hidden=true;badge.textContent=idleStatus();});
 worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.result);};
 worker.onerror=()=>{for(const p of pending.values())p.reject(Error('법규 검사 Worker 오류'));pending.clear();badge.textContent='검사 오류';};
 /* 대지 기준이 없으면 검사할 것이 없으므로 도면을 Worker 로 복사하지 않는다(20만 개면 복사만으로 화면이 멈춘다).
    기준이 있다가 없어진 첫 번만 보내 Worker 캐시를 비운다. */
 let workerHasAnalysis=false;
 function check(document,objectIds=null){
  const hasAnalysis=!!document?.siteAnalysis;
  if(!hasAnalysis&&!workerHasAnalysis)return Promise.resolve({active:false,findings:[],status:'대지 미분석'});
  return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve:value=>{workerHasAnalysis=hasAnalysis;resolve(value);},reject});worker.postMessage({id,document,objectIds,transient:document!==engine.doc});});
 }
 function display(next,publish=true){result=next;highlights=new Set(next.findings.filter(f=>f.severity==='error').flatMap(f=>f.objectIds));overlay=next.findings.flatMap((f,i)=>f.geometry.map((p,j)=>({id:`check-${i}-${j}`,type:'hatch',layer:'A-REVIEW',points:p.outer,loops:p.holes,spacing:200,angle:45,solid:false,color:'#ff4545',reviewStatus:legacyStatusToReview('livecheck',f).status,managedBy:'live_check'})));
  badge.dataset.latencyMs=String(Math.round(performance.now()-changedAt));badge.textContent=next.status;const errors=next.findings.filter(f=>f.severity==='error').length;$('.lc-summary').textContent=next.stale?'기준 재확인 필요':!next.active?'검사 준비 필요':next.targetCount===0?'검사 대상 없음':errors?`위반 ${errors}건`:next.findings.length?'확인 필요':'설정한 검사 항목에서 위반 없음';$('.lc-plain').textContent=next.stale?next.status:!next.active?'먼저 [대지 정보로 자동 설정]을 누르거나, 대지 경계와 적용 기준을 직접 설정하세요.':next.status;$('.lc-basis').replaceChildren(...(engine.doc.siteAnalysis?.basis||[]).map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));if(publish){siteDirty.clear();siteFullScope=false;const batch=reviewBatch(convertReviews(next));reviews.publish(batch.items,{linkedObjects:batch.linkedObjects,replaceIds:reviews.items.filter(i=>i.field==='law').map(i=>i.id)});}render();
 }
 async function refresh(){syncManualZone();const job=++renderJob;changedAt=performance.now();if(engine.doc.siteAnalysis)badge.textContent='검사 중…';try{const next=await check(engine.doc);if(job===renderJob)display(next);}catch(e){if(job===renderJob){display({active:false,findings:[],status:'기준 오류 · '+e.message});}}}
 /* 자동 검사는 하지 않는다. 명령마다 도면 전체를 검사하면 큰 도면에서 매번 화면이 멈춘다.
    도면이 바뀌면 지난 결과만 '다시 검사 필요'로 표시하고, 검사는 [지금 검사]·패널 열기·기준 설정 때만 한다. */
 const idleStatus=()=>engine.doc.siteAnalysis?'법규 검사 · 수동':'대지 미분석';
 const markChanged=()=>{if(historyWrite||reviewTables.writing)return;reviewRevision=getDrawingInfo().revision??null;revision++;renderJob++;clearTimeout(timer);const token=deltaSerial;queueMicrotask(()=>{if(token===deltaSerial)notifyDelta(null);});
  // 일반 편집도 문서 객체를 교체하므로 선택은 유지한다. 새 도면·불러오기만 O(1) 초기화.
  zoneDoc=engine.doc;
  if(engine.lastExecution?.type==='load'||engine.lastExecution?.type==='new'){restoreManualZone();zoneField.hidden=true;}
  if(result.active||overlay.length||highlights.size){result={...result,needsRecheck:true,status:'도면 변경됨 · 다시 검사 필요'};overlay=[];highlights=new Set();$('.lc-summary').textContent='도면이 바뀌었습니다. [지금 검사]를 누르세요.';reviewView.draw();}
  badge.textContent=result.needsRecheck?'다시 검사 필요':idleStatus();};
 engine.onChange(markChanged);
 const runNow=document.createElement('button');runNow.className='lc-run';runNow.textContent='지금 검사';runNow.onclick=()=>{if(!engine.doc.siteAnalysis){toast('먼저 [대지 정보로 자동 설정] 또는 [도면에서 기준 설정]으로 대지 기준을 정하세요.',true);return;}refresh();};$('.lc-summary').after(runNow);
 const view3d=document.createElement('button');view3d.type='button';view3d.textContent='법규 3D 보기';runNow.after(view3d);
 view3d.onclick=async()=>{view3d.disabled=true;try{await openReview3D();}catch(e){toast('3D 열기 실패: '+e.message,true);}finally{view3d.disabled=false;}};
 // 패널 열기만으로 전체 재검사는 하지 않는다.
 async function setAnalysis(analysis,layers=[]){const snapshot=JSON.stringify(engine.doc),next={...engine.doc,siteAnalysis:analysis,layers:engine.doc.layers.map(l=>({...l,...layers.find(x=>x.id===l.id)?.changes}))};await check(next);if(snapshot!==JSON.stringify(engine.doc))throw Error('분석 확인 중 도면이 변경됐습니다. 다시 불러오세요.');engine.execute(layers.length?{type:'batch',commands:[{type:'livecheck.layers',layers},{type:'site.analyze',analysis}]}:{type:'site.analyze',analysis});refresh();}
 $('.lc-ai').onclick=()=>document.getElementById('ai-dock')?.dispatchEvent(new CustomEvent('review-request',{detail:{label:'검사 결과를 설명해줘',message:'검사 결과를 쉽게 설명하고 누락된 기준과 다음 작업을 알려줘. 기준이 없으면 추측하지 마. 도면을 변경하지 마.\n'+JSON.stringify(result)}}));
 // 대지 정보로 자동 설정: 대지선·토지정보·용도지역에서 기준을 채운다(livecheck-auto.js). 손 입력은 [도면에서 기준 설정].
 $('.lc-auto').onclick=async()=>{try{syncManualZone();const {analysis,basis}=autoSiteAnalysis(engine.doc,{manualZone:zoneSelect.value});await setAnalysis(analysis,planFloorSettings(engine.doc).layers.filter(x=>!engine.doc.layers.find(l=>l.id===x.id)?.locked));toast('자동 기준: '+basis.slice(0,2).join(' · '));}catch(e){toast(e.message,true);}};
 // 일조 단면: 지금 검사 결과를 평면 절단축과 나란히 CAD 객체로 그린다(A-ENV-SUN-SECTION, 다시 그리면 바꿔 그림, 되돌리기 가능).
 $('.lc-section').onclick=async()=>{try{
  if(!engine.doc.siteAnalysis)throw Error('먼저 [대지 정보로 자동 설정]으로 기준을 정하세요.');
  const checked=await check(engine.doc);display(checked);
  if(!checked.section)throw Error('정북 사선 기준이 없어 일조 단면을 그릴 수 없습니다(주거지역이 아니거나 북쪽 경계와 건물을 잇는 절단선을 찾지 못함).');
  const kept=engine.doc.entities.filter(e=>!e.sunSection),entities=sunSectionEntities(checked.section,G.bounds(kept));
  if(!engine.doc.layers.some(l=>l.name==='A-ENV-SUN-SECTION'))engine.execute({type:'layer.add',name:'A-ENV-SUN-SECTION',color:'#73aebd',lineweight:.18});
  const layer=engine.doc.layers.find(l=>l.name==='A-ENV-SUN-SECTION'),old=engine.doc.entities.filter(e=>e.sunSection).map(e=>e.id);
  engine.execute({type:'batch',commands:[...(old.length?[{type:'delete',ids:old}]:[]),{type:'addMany',entities:entities.map(e=>({...e,layer:layer.id,sunSection:true}))}]});
  await refresh();   // 단면을 넣으면 도면이 바뀐 것으로 결과가 지워지므로 바로 다시 검사한다(단면은 검사 대상이 아니다).
  toast('평면 절단선과 일조 단면의 투영선을 맞춰 그렸습니다. [도면 맞춤]으로 함께 보세요.');
 }catch(e){toast(e.message,true);}};
 $('.lc-manual').onclick=()=>{
  const polygons=engine.doc.entities.filter(e=>e.type==='rectangle'||e.type==='polyline'&&e.closed),lines=engine.doc.entities.filter(e=>e.type==='line'&&e.points.length===2);
  if(!polygons.length)return toast('대지와 건축 가능한 영역을 닫힌 폴리선으로 그려주세요.',true);
  const choices=polygons.map((e,i)=>[e.id,`${i+1} · ${engine.doc.layers.find(l=>l.id===e.layer)?.name||''} · ${(Math.abs(G.polygonArea(e.points))/1e6).toFixed(2)}㎡`]);
  const saved=engine.doc.siteAnalysis||{}, refs=saved.sourceIds||{};
  form('대지 검사 기준 · 기존 값 확인 후 적용',[
   {name:'site',label:'대지 경계',options:choices,value:refs.site||choices[0][0]},
   {name:'buildable',label:'건축 가능한 경계 (확인한 건축선)',options:choices,value:refs.buildable||choices[0][0]},
   {name:'coverage',label:'건폐율 상한 (%)',type:'number',value:saved.coverageLimit??''},
   {name:'far',label:'용적률 상한 (%)',type:'number',value:saved.farLimit??''},
   {name:'rule',label:'적용 기준 이름 / 근거',value:saved.ruleId||''},
   {name:'north',label:'정북 경계선',options:[['','사선 검사 사용 안 함'],...lines.map((e,i)=>[e.id,`${i+1} · ${engine.doc.layers.find(l=>l.id===e.layer)?.name||''}`])],value:refs.north||''},
   {name:'profile',label:'사선 기준 (아래 표에서 입력)',value:(saved.northProfile?.setbacks||[]).map(r=>`${r.height/1000}:${r.distance/1000}`).join(',')},
  ],async v=>{
   const site=engine.doc.entities.find(e=>e.id===v.site),buildable=engine.doc.entities.find(e=>e.id===v.buildable);
   if(!site||!buildable)throw Error('경계가 바뀌었습니다. 다시 설정하세요.');
   if(!String(v.coverage).trim()||!String(v.far).trim()||!v.rule.trim())throw Error('확인한 상한과 기준 이름을 입력하세요.');
   const sourceIds={site:v.site,buildable:v.buildable,north:v.north||null};const sourceGeometry=[...new Set(Object.values(sourceIds).filter(Boolean))].map(id=>{const e=engine.doc.entities.find(e=>e.id===id);return {id,points:structuredClone(e.points),loops:structuredClone(e.loops||[])};});
   const analysis={...saved,needsSiteReview:false,sourceIds,sourceGeometry,confirmedAt:new Date().toISOString(),version:1,units:'mm',areaUnits:'m2',siteArea:(Math.abs(G.polygonArea(site.points))-(site.loops||[]).reduce((sum,h)=>sum+Math.abs(G.polygonArea(h)),0))/1e6,coverageLimit:Number(v.coverage),farLimit:Number(v.far),ruleId:v.rule.trim(),buildable:[{outer:structuredClone(buildable.points),holes:structuredClone(buildable.loops||[])}]};
   delete analysis.northProfile;
   if(v.north){const line=engine.doc.entities.find(e=>e.id===v.north);if(!line)throw Error('정북 경계선을 다시 선택하세요.');const setbacks=v.profile.split(',').map(pair=>{const parts=pair.trim().split(':');if(parts.length!==2||parts.some(p=>!p.trim()))throw Error('사선 기준의 높이:이격 형식을 확인하세요.');return {height:Number(parts[0])*1000,distance:Number(parts[1])*1000};});analysis.northProfile={boundary:structuredClone(line.points),setbacks};}
   await setAnalysis(analysis);toast('도면에 대지 기준을 저장했습니다.');
  });
  installBaselineEditor(polygons,lines);
 };
 $('.lc-import').onclick=()=>file.click();file.onchange=async()=>{try{const selected=file.files[0];if(!selected)return;if(selected.size>5000000)throw Error('분석 JSON은 5MB 이하만 지원합니다.');await setAnalysis(JSON.parse(await selected.text()));toast('대지 분석 기준을 저장했습니다.');}catch(e){toast(e.message,true);}finally{file.value='';}};
 $('.lc-export').onclick=()=>{if(!engine.doc.siteAnalysis)return toast('대지 미분석',true);download(JSON.stringify(engine.doc.siteAnalysis,null,2),'site-analysis.json','application/json');};
 $('.lc-layers').onclick=()=>{
  const planned=planFloorSettings(engine.doc),dialog=document.createElement('dialog');dialog.className='livecheck-settings';const title=document.createElement('h3');title.textContent='건물·층 연결';dialog.append(title);const help=document.createElement('p');help.textContent='건물의 닫힌 바닥 경계가 있는 레이어를 선택하세요. 대지·건축선·정북 경계는 자동으로 제외합니다. 벽만 있으면 바닥 면적은 미산정입니다. 같은 층의 영역은 합쳐 계산합니다. 층·층고를 변경하면 해당 층부터 위층의 바닥 높이를 다시 계산합니다.';dialog.append(help);const entries=[];
  for(const layer of engine.doc.layers){if(layer.locked||/^SITE(?:-|$)|^CHECK-VIOLATION$/i.test(layer.name))continue;const row=document.createElement('div');row.className='lc-layer-row';const name=document.createElement('span');name.textContent=layer.name;row.append(name);
   const source=planned.layers.find(s=>s.id===layer.id)?.changes,fromPlan=engine.doc.entities.some(e=>e.layer===layer.id&&planned.objects.has(e.id));
   const building=document.createElement('input');building.type='checkbox';building.checked=!!layer.building;building.title='건물 레이어';
   const floor=document.createElement('input');floor.type='number';floor.value=source?.floor??layer.floor??(/^A-BLDG-UP$/i.test(layer.name)?2:Number(layer.name.match(/^A-BLDG-L(\d+)$/i)?.[1]||layer.name.match(/(?:^|[ _-])(\d+)F(?:$|[ _-])/i)?.[1]||1));floor.title='시작 층';
   const height=document.createElement('input');height.type='number';height.min='1';height.value=source?.height??layer.height??3000;height.title='층고 mm';
   const repeat=/^A-BLDG-UP$/i.test(layer.name)||source?document.createElement('input'):null;
   if(repeat){repeat.className='lc-upper-floors';repeat.type='number';repeat.min='1';repeat.step='1';repeat.title='이 모양으로 쌓을 층수';repeat.value=source?.upperFloors??layer.upperFloors??1;}
   floor.readOnly=fromPlan;height.readOnly=fromPlan&&source?.height!=null;if(repeat)repeat.readOnly=fromPlan;
   const excluded=document.createElement('input');excluded.type='checkbox';excluded.checked=!!layer.excludeFromFAR;excluded.title='용적률 제외 (적용 기준 확인 후 지정)';row.append(building,document.createTextNode('건물'),floor,document.createTextNode('시작 층'),height,document.createTextNode('층고 mm'),excluded,document.createTextNode('용적률 제외'));
   if(repeat)row.append(repeat,document.createTextNode('이 모양으로 쌓을 층수'));
   if(fromPlan||repeat){const note=document.createElement('span');note.className='lc-floor-source';note.textContent=fromPlan?'계획안에서 가져옴'+(source?'':' · 도형별 층 묶음 적용'):'확인 필요 · 상층 층수를 입력하세요.';row.append(note);}
   if(fromPlan&&!source){floor.hidden=height.hidden=true;if(repeat)repeat.hidden=true;}
   dialog.append(row);entries.push({layer,building,floor,height,excluded,repeat,source,fromPlan,initialFloor:Number(floor.value),initialHeight:Number(height.value),initialRepeat:repeat?Number(repeat.value):undefined});
  }
  const error=document.createElement('p'),save=document.createElement('button'),close=document.createElement('button');save.textContent='적용';close.textContent='닫기';close.onclick=()=>dialog.close();save.onclick=()=>{try{let changedFrom=Infinity;const layers=entries.map(e=>{const floor=Number(e.floor.value),height=Number(e.height.value),upperFloors=e.repeat?Number(e.repeat.value):undefined;if(!Number.isInteger(floor)||!Number.isFinite(height)||height<=0||upperFloors!==undefined&&(!Number.isInteger(upperFloors)||upperFloors<=0))throw Error('층·층고·쌓을 층수는 올바른 양수로 입력하세요.');if(!e.fromPlan&&(floor!==e.initialFloor||height!==e.initialHeight||upperFloors!==e.initialRepeat))changedFrom=Math.min(changedFrom,floor,e.initialFloor);return {id:e.layer.id,changes:{building:e.building.checked,excludeFromFAR:e.excluded.checked,...(e.fromPlan&&!e.source?{}:{floor,height,...(upperFloors===undefined?{}:{upperFloors})})}};});if(Number.isFinite(changedFrom)){const locked=engine.doc.layers.find(l=>l.locked&&Number.isFinite(l.elevation)&&(l.floor??(/^A-BLDG-UP$/i.test(l.name)?2:Number(l.name.match(/^A-BLDG-L(\d+)$/i)?.[1]||l.name.match(/(?:^|[ _-])(\d+)F(?:$|[ _-])/i)?.[1]||1)))>=changedFrom&&!engine.doc.entities.some(e=>e.layer===l.id&&planned.objects.has(e.id)));if(locked)throw Error('위층 바닥 높이를 다시 계산해야 하지만 '+locked.name+' 레이어가 잠겨 있습니다. [레이어]에서 잠금을 해제한 뒤 다시 적용하세요.');}for(let i=0;i<entries.length;i++){const e=entries[i];if(!e.fromPlan&&Number.isFinite(e.layer.elevation)&&Math.max(e.initialFloor,Number(e.floor.value))>=changedFrom)layers[i].changes.elevation=null;}engine.execute({type:'livecheck.layers',layers});dialog.close();refresh();}catch(e){error.textContent=e.message;}};dialog.append(error,save,close);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
 };
 function showDetails(f){
  const d=document.createElement('dialog');d.className='livecheck-settings';const title=document.createElement('h3');title.textContent=f.message;d.append(title);
  const a=result.areaSummary,fmt=n=>n==null?'미산정':n.toFixed(2)+'㎡';
  const lines=['기준: '+(engine.doc.siteAnalysis?.ruleId||'미설정'),'기준 확인: '+(engine.doc.siteAnalysis?.confirmedAt?.slice(0,10)||'기록 없음')];
  if(a)lines.push('대지 '+fmt(a.site),'건축 면적 '+fmt(a.coverageArea)+' / 허용 '+fmt(a.coverageAllowed)+' / 초과 '+fmt(a.coverageArea==null?null:Math.max(0,a.coverageArea-a.coverageAllowed)),'연면적 산입 '+fmt(a.farArea)+' / 허용 '+fmt(a.farAllowed),...a.floors.map(r=>r.floor+'층: 건축면적 '+fmt(r.coverage)+' · 용적률 산입 '+fmt(r.far)));
  lines.push('대상 객체 '+f.objectIds.length+'개 · 도면에서 강조했습니다.');for(const text of lines){const p=document.createElement('p');p.textContent=text;d.append(p);}
  const next=document.createElement('button');next.textContent=result.stale?'대지 기준 다시 확인':'건물·층 연결 확인';next.onclick=()=>{d.close();$(result.stale?'.lc-manual':'.lc-layers').click();};const close=document.createElement('button');close.textContent='닫기';close.onclick=()=>d.close();d.append(next,close);document.body.append(d);d.onclose=()=>d.remove();d.showModal();
 }
 function installBaselineEditor(polygons,lines){
  const root=document.getElementById('form-fields'),get=n=>root.querySelector('[name="'+n+'"]');
  const wrap=document.createElement('section');wrap.className='baseline-preview';const label=document.createElement('label');label.textContent='미리보기에서 고를 경계 ';const role=document.createElement('select');role.setAttribute('aria-label','미리보기 선택 역할');for(const [value,text]of [['site','대지'],['buildable','건축선'],['north','정북선']]){const o=document.createElement('option');o.value=value;o.textContent=text;role.append(o);}label.append(role);
  const c=document.createElement('canvas');c.width=700;c.height=260;c.setAttribute('aria-label','대지 경계 선택 미리보기');const note=document.createElement('p');note.textContent='경계선을 클릭하여 선택하세요. 청록: 대지 · 주황: 건축선 · 파랑: 정북선. 목록으로도 선택할 수 있습니다.';wrap.append(label,c,note);root.prepend(wrap);
  const es=[...polygons,...lines],b=G.bounds(es);let k=1,ox=0,oy=0;const ctx=c.getContext('2d');
  if(b){k=Math.min(650/Math.max(1,b.maxX-b.minX),210/Math.max(1,b.maxY-b.minY));ox=350-(b.minX+b.maxX)*k/2;oy=130+(b.minY+b.maxY)*k/2;}
  const redraw=()=>{ctx.clearRect(0,0,700,260);for(const e of es){ctx.strokeStyle='#71828e';ctx.lineWidth=1;if(e.id===get('site').value){ctx.strokeStyle='#6fe0c4';ctx.lineWidth=3;}if(e.id===get('buildable').value){ctx.strokeStyle='#ffb75c';ctx.lineWidth=3;}if(e.id===get('north').value){ctx.strokeStyle='#79afff';ctx.lineWidth=3;}ctx.beginPath();e.points.forEach((p,i)=>i?ctx.lineTo(ox+p.x*k,oy-p.y*k):ctx.moveTo(ox+p.x*k,oy-p.y*k));if(e.type!=='line')ctx.closePath();ctx.stroke();}};
  c.onclick=e=>{const r=c.getBoundingClientRect(),p={x:((e.clientX-r.left)*700/r.width-ox)/k,y:(oy-(e.clientY-r.top)*260/r.height)/k};const candidates=role.value==='north'?lines:polygons;const nearest=candidates.map(e=>({e,d:Math.min(...G.segments(e).map(([a,b])=>G.distanceToSegment(p,a,b)))})).sort((a,b)=>a.d-b.d)[0];if(nearest){get(role.value).value=nearest.e.id;redraw();}};for(const name of ['site','buildable','north'])get(name).addEventListener('change',redraw);redraw();
  const hidden=get('profile');hidden.closest('label').hidden=true;const table=document.createElement('section');table.className='north-table';const intro=document.createElement('p');intro.textContent='정북 사선 기준: 높이별 필요한 이격거리를 2행 이상 입력하세요. 높이는 증가, 이격은 감소하지 않아야 합니다. 행 사이 값은 직선 보간하며 범위 밖은 미판정입니다.';table.append(intro);const rows=document.createElement('div');table.append(rows);
  const sync=()=>hidden.value=[...rows.children].map(row=>[...row.querySelectorAll('input')].map(e=>e.value).join(':')).join(',');
  const addRow=(h='',d='')=>{const row=document.createElement('div');row.className='north-row';for(const [name,value]of [['높이 (m)',h],['이격 (m)',d]]){const label=document.createElement('label');label.textContent=name;const input=document.createElement('input');input.type='number';input.step='any';input.value=value;input.setAttribute('aria-label',name);input.oninput=sync;label.append(input);row.append(label);}const remove=document.createElement('button');remove.type='button';remove.textContent='행 삭제';remove.onclick=()=>{row.remove();sync();};row.append(remove);rows.append(row);};
  const existing=hidden.value?hidden.value.split(',').map(s=>s.split(':')):[['',''],['','']];for(const r of existing)addRow(...r);const add=document.createElement('button');add.type='button';add.textContent='구간 행 추가';add.onclick=()=>addRow();table.append(add);hidden.closest('label').after(table);const update=()=>table.hidden=!get('north').value;get('north').addEventListener('change',update);role.addEventListener('change',update);c.addEventListener('click',update);update();
 }
 badge.textContent=idleStatus();
 return {openAccess,editAccess,insertReviewTable,get result(){return result;},get highlights(){return highlights;},get overlay(){return [...overlay,...previewOverlay];},check,refresh,setAnalysis,reviews,notifyDelta,selectionChanged:(ids,reviewIds)=>{reviews.selectObjects(ids,reviewIds);reviewTables.activate(ids);reviewView.selectionChanged();},registerReviewSource:(field,fn)=>reviews.registerReviewSource(field,fn),
  async prepareExport(doc){if(!$('.lc-include').checked)return doc;const checked=await check(doc);if(!checked.active)return doc;const document=structuredClone(doc),existing=document.layers.find(l=>l.name==='A-REVIEW'),id=existing?.id||'A-REVIEW-'+crypto.randomUUID();if(!existing)document.layers.push({id,name:'A-REVIEW',color:'#ff4545',visible:true,locked:false,lineweight:.18});document.entities.push(...checked.findings.flatMap(f=>f.geometry.map(p=>({id:crypto.randomUUID(),type:'hatch',layer:id,points:p.outer,loops:p.holes,spacing:200,angle:45,solid:false,reviewStatus:legacyStatusToReview('livecheck',f).status,managedBy:'live_check'}))));return document;},
  async confirmRepair(staged,plan){const before=await check(engine.doc),after=await check(staged);const preview=stageReviewRepair(engine,staged);previewOverlay=preview.overlay;render();return new Promise(resolve=>{const dialog=document.createElement('dialog');dialog.className='livecheck-settings';const title=document.createElement('h3');title.textContent='위반 수정 미리보기';const summary=document.createElement('p');summary.textContent=`위반 ${before.findings.filter(f=>f.severity==='error').length}건 → ${after.findings.filter(f=>f.severity==='error').length}건`;const list=document.createElement('div');list.className='lc-preview-pair';for(const [label,doc] of [['변경 전',engine.doc],['변경 후',staged]]){const box=document.createElement('div');const caption=document.createElement('strong');caption.textContent=label;const drawing=document.createElement('div');drawing.innerHTML=plotSVG(doc,{fit:true,paper:'A4',title:label});box.append(caption,drawing);list.append(box);}const apply=document.createElement('button');apply.textContent='확인 후 실행';const cancel=document.createElement('button');cancel.textContent='취소';let accepted=false;apply.onclick=()=>{accepted=true;dialog.close();};cancel.onclick=()=>dialog.close();dialog.append(title,summary,list,apply,cancel);document.body.append(dialog);dialog.addEventListener('close',()=>{if(accepted)preview.accept();else preview.cancel();previewOverlay=[];render();dialog.remove();resolve(accepted);});dialog.showModal();}).catch(error=>{preview.cancel();previewOverlay=[];render();throw error;});}
 };
}
