import {withSitePlanWait,revealSitePlan,sitePlanWaitEnabled} from './site-plan-wait.js';
import {isContractCandidateSet,contractReplacementOptions} from './site-plan-results.js';
import {contractPlanPanel} from './site-plan-contract-panel.js';
import {isContract10} from './site-contract.js';
import {planSuggestions} from './parcel-info.js';
import {planCheck} from './livecheck-auto.js';
// 배치 품질 판정은 바른 서버에서. 답이 오기 전에는 '검사 중' 칸, 답이 오면(PLAN_QUALITY_EVENT) 창을 다시 그린다.
import {planQualityNow,PLAN_QUALITY_EVENT} from './plan-quality-client.js';
import {planQualityPanel} from './plan-quality-panel.js';
import {attachSitePlan,attachAlternativePlans,generateAlternativePlans,validationPayload,revalidateSitePlan,refreshSunlightDrawing,sitePlanStatus,planSummary,setPlanValueSources,planValueSources,recordPlanValues} from './site-plan.js';

// v0.5.3 production generate/edited polygon validate/DXF verified on 2026-09-10.
const serviceReady=true;
const connectionMessage=serviceReady?'미리보다 v0.5.3 배치 엔진 연결됨':'미리보다 새 배치 엔진 연동 대기 · 결과 파일 열기와 표시는 사용 가능합니다.';

// 선택된 카드는 생성 당시 후보 대신 편집 중인 실제 도면을 검사한다.
export function planResultQuality(state,doc,selected=false){
 const current=selected?doc?.sitePlan:null,result=current||state.result||state;
 return planQualityNow(result,{request:result.request||state.request,...(current||state.id?{document:doc}:{})});
}

export function copyPlanInput(original,doc){
 const request=structuredClone(original),saved=original&&original===doc?.sitePlan?.request?doc.sitePlan.valueSources:{};
 if(request)setPlanValueSources(request,Object.keys(planValueSources(original)).length?planValueSources(original):saved);
 return request;
}
export function drawingInputSources(current,previous,program){
 const sources=structuredClone(current.inputSources||{}),key='program.floors';
 if(!program&&previous?.program&&Object.hasOwn(previous.program,'floors')){
  const prior=planValueSources(previous)[key];
  if(prior&&prior.value===current.request.program.floors)sources[key]=prior;else delete sources[key];
 }
 return sources;
}

export function installSitePlan(studio){
 const {engine,execute,toast,fit}=studio.context;
 const panel=document.createElement('dialog');panel.id='site-plan-dialog';panel.style.cssText='max-width:1180px;width:94vw;max-height:90vh;overflow:auto;padding:28px;border:1px solid #39545f;border-radius:20px;background:#12212a;color:#edf4f5';
 const title=document.createElement('h2');title.textContent='우리 대지의 계획 3안';title.id='site-plan-title';panel.setAttribute('aria-labelledby',title.id);
 const toolbar=document.createElement('div'),status=document.createElement('p'),body=document.createElement('div'),target=document.createElement('select');target.setAttribute('aria-label','편집할 배치 다각형');
 const button=(text,fn)=>{const b=document.createElement('button');b.textContent=text;b.type='button';b.onclick=()=>Promise.resolve().then(fn).catch(e=>toast(e.message,true));toolbar.append(b);return b;};
 const style=document.createElement('style');style.textContent=`
 #site-plan-dialog h2{font-size:25px;margin:0 0 8px;text-wrap:balance}
 #site-plan-dialog p{line-height:1.6} #site-plan-dialog button{font-size:13px;padding:10px 14px;border-radius:9px}
 #site-plan-dialog .plan-toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}
 #site-plan-dialog .plan-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
 #site-plan-dialog .plan-card{background:#192e38;border:1px solid #36505b;border-radius:15px;padding:18px;min-width:0;display:flex;flex-direction:column;gap:12px}
 #site-plan-dialog .plan-card.active{border:2px solid #9dcbe0;padding:17px;box-shadow:none}
 #site-plan-dialog .plan-card h3{font-size:19px;margin:0;color:#f0f5f6;}
 #site-plan-dialog .plan-kicker{color:#8facae;font-size:11px;}
 #site-plan-dialog .plan-preview{width:100%;height:155px;background:#10212a;border-radius:10px}
 #site-plan-dialog .plan-hero{font-size:31px;font-weight:650;font-variant-numeric:tabular-nums;line-height:1.1}
 #site-plan-dialog .plan-hero small{font-size:13px;font-weight:400;color:#a7c1c6;margin-left:6px}
 #site-plan-dialog .plan-metrics{display:grid;grid-template-columns:1fr 1fr;gap:14px 12px;border-top:1px solid #35505b;padding-top:14px}
 #site-plan-dialog .plan-metric span{display:block;color:#a5bac1;font-size:12px;margin-bottom:4px}
 #site-plan-dialog .plan-metric strong{font-size:17px;font-weight:500;font-variant-numeric:tabular-nums}
 #site-plan-dialog .plan-badge{font-size:12px;padding:7px 10px;border-radius:7px;background:#203f3b;color:#a7e6d5}
 #site-plan-dialog .plan-badge.warn{background:#493b26;color:#f4cc87}
 #site-plan-dialog .plan-badge.error{background:#4b3034;color:#ffb5b4}
 #site-plan-dialog .plan-note{font-size:12px;color:#a7bbc1;min-height:40px;margin:0}
 #site-plan-dialog .plan-card button{width:100%;margin-top:auto;background:#25414c;border:1px solid #466570}
 #site-plan-dialog .plan-card.active button{background:#9dcbe0;color:#102c2b;border-color:#9dcbe0}
 #site-plan-dialog .plan-section{margin-top:20px;padding:18px 20px;border:1px solid #354b56;border-radius:12px}
 #site-plan-dialog .plan-section summary{cursor:pointer;font-size:14px;color:#d4e4e7}
 #site-plan-dialog .plan-check{padding:10px 0;border-bottom:1px solid #2c424c;display:flex;justify-content:space-between;gap:20px;font-size:13px}
 #site-plan-dialog .plan-context{font-size:13px;color:#a7bbc1;margin:0 0 8px}
 @media(max-width:760px){#site-plan-dialog .plan-grid{grid-template-columns:1fr}#site-plan-dialog{padding:18px!important}#site-plan-dialog .plan-preview{height:170px}}
 `;document.head.append(style);toolbar.className='plan-toolbar';status.className='plan-context';
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
 function preview(state){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('plan-preview');svg.setAttribute('viewBox','0 0 280 160');svg.setAttribute('aria-label','대지와 건물·주차 배치 미리보기');svg.setAttribute('role','img');
  const ps=state.request.site.parcel,xs=ps.map(p=>p[0]),ys=ps.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y,k=Math.min(230/Math.max(w,1),125/Math.max(h,1));
  const point=p=>`${140+(p[0]-x-w/2)*k},${80-(p[1]-y-h/2)*k}`;
  const polygon=(points,fill,stroke,dash)=>{if(!points?.length)return;const shape=document.createElementNS(svg.namespaceURI,'polygon');shape.setAttribute('points',points.map(point).join(' '));shape.setAttribute('fill',fill);shape.setAttribute('stroke',stroke);shape.setAttribute('stroke-width','1.5');if(dash)shape.setAttribute('stroke-dasharray',dash);svg.append(shape);};
  polygon(ps,'none','#bc9cbb','4 4');polygon(state.geometry.footprint,'#335d69','#9bcacb');for(const floor of state.geometry.floors||[])polygon(floor,'none','#a6d7d0');for(const stall of state.geometry.stalls||[])polygon(stall.rect,'#897142','#f4cb88');return svg;
 }
 function planCard(state,index,selected,stale,button){
  const n=state.report.numbers,card=el('article',null,'plan-card'+(selected?' active':''));card.append(el('div',`PLAN 0${index+1}`,'plan-kicker'),el('h3',(state.alternativeTitle||'').replace(/^\d안 · /,'')),preview(state));
  const hero=el('div',String(n.gfa??'—'),'plan-hero');hero.append(el('small','㎡ 연면적'));card.append(hero);
  const metrics=el('div',null,'plan-metrics');for(const [label,value] of [['규모',`${n.floors}층 · ${n.height}m`],['용적률',`${n.far}%`],['건폐율',`${n.bcr}%`],['주차',`${n.parking_placed}대 / 기준 ${n.parking_required}대`]]){const item=el('div',null,'plan-metric');item.append(el('span',label),el('strong',value));metrics.append(item);}card.append(metrics);
  const failed=state.report.checks.filter(c=>!planCheck(c).ok),issues=failed.filter(c=>c.severity!=='info');
  card.append(el('div',stale?'도면 수정됨 · 재검증 필요':issues.length?'확인 필요 · '+issues.map(c=>c.rule).join(', '):failed.length?'설계 목표 미달 · '+failed.map(c=>c.rule).join(', '):'현재 검토 항목 통과','plan-badge'+(stale?' warn':issues.length?' error':failed.length?' warn':'')),el('p',state.alternativeNote,'plan-note'),button);
  card.append(planQualityPanel(planResultQuality(state,engine.doc,selected)));
   return card;
 }
 let pending=false,progress='',shown=null,controller=null,failure='';
 globalThis.addEventListener?.(PLAN_QUALITY_EVENT,()=>{if(panel.open)render();});
 const chooseContract=async candidate=>{
  if(shown?.take){panel.close();await shown.take(candidate);return;}
  panel.close();const doc=attachSitePlan(engine.doc,candidate.request,candidate.result,{planId:candidate.planId,...contractReplacementOptions(engine.doc,candidate.request,candidate.result)});
  engine.validate(doc);revealSitePlan(studio.context,()=>execute({type:'load',document:doc}));fit();render();
 };
 const input=()=>engine.doc.sitePlanInput||engine.doc.sitePlan?.request;
 const hasParcel=()=>engine.doc.entities.some(e=>e.parcelRole==='site'||e.parcelGroup&&e.entities?.some(c=>c.parcelRole==='site'));
 const render=()=>{
  cancelButton.hidden=!controller;
  const sunlightButton=toolbar.querySelector('[data-sunlight]');if(sunlightButton)sunlightButton.hidden=engine.doc.sitePlan?.sunlightDrawing?.applies===false;
  status.textContent=(pending?progress||'재검증 중 · 수정 전 결과':engine.doc.sitePlan?sitePlanStatus(engine.doc).label:'배치 결과 표시')+(serviceReady?'':' · '+connectionMessage);body.replaceChildren();
  const active=engine.doc.sitePlan;
  if(active){status.textContent=(pending?progress+' · ':'')+(active.request.site.address||'대지 계획')+' · 개략 계획 비교';}
  if(failure)status.textContent=failure;
  const contractResult=shown?isContractCandidateSet(shown.plans)?shown.plans[0].result:null:active?.contract?.bundle;
  if(isContract10(contractResult)){body.append(contractPlanPanel(studio,{result:contractResult,request:shown?.plans?.[0]?.request||active.request,active,pending,onChoose:chooseContract}));return;}
  if(shown?.plans?.some(p=>isContract10(p.result))){
   for(const plan of shown.plans){
    body.append(el('h3',plan.title||'상세 계획 조건'));
    if(plan.failed){body.append(el('p',plan.error,'plan-context'));continue;}
    if(isContract10(plan.result))body.append(contractPlanPanel(studio,{request:plan.request,result:plan.result,active,pending,onChoose:candidate=>chooseContract({...candidate,title:plan.title,note:plan.note})}));
   }return;
  }
  if(engine.doc.sitePlanAlternatives?.length){
   const grid=el('div',null,'plan-grid');
   for(const [index,saved] of engine.doc.sitePlanAlternatives.entries()){
    const state=saved.id===active.id?active:saved,selected=state.id===active.id,stale=sitePlanStatus({...engine.doc,sitePlan:state}).stale;
    const choose=el('button',selected?'선택됨':'이 안 보기');choose.disabled=pending;choose.onclick=()=>{const states=engine.doc.sitePlanAlternatives.map(p=>p.id===active.id?structuredClone(active):p);execute({type:'document.update',changes:{sitePlan:structuredClone(state),sitePlanAlternatives:states}});studio.context.selectEntities(engine.doc.entities.filter(e=>e.sitePlanId===state.id).map(e=>e.id));render();};
    grid.append(planCard(state,index,selected,stale,choose));
   }body.append(grid,el('p','점선은 대지, 청록색은 건물, 노란색은 주차입니다. 선택한 안으로 재검증·PDF를 만듭니다.','plan-context'));
  }else if(shown){
   // 계획 탭의 후보들: 도면에는 고른 한 안만 들어가 있으므로 나머지는 결과만 보이고 [도면으로 가져오기]로 바꾼다.
   const grid=el('div',null,'plan-grid');
   for(const [index,plan] of shown.plans.entries()){
    const report=plan.result.report,state={request:plan.request,report,result:plan.result,geometry:report.geometry,alternativeTitle:plan.title,alternativeNote:plan.note},selected=active?.alternativeTitle===plan.title;
    const take=el('button',selected?'도면에 있음':'도면으로 가져오기');take.disabled=selected||pending||!shown.take;
    take.onclick=()=>{panel.close();Promise.resolve().then(()=>shown.take(plan)).then(message=>message&&toast(message)).catch(e=>toast(e.message,true));};
    grid.append(planCard(state,index,selected,selected&&sitePlanStatus(engine.doc).stale,take));
   }body.append(grid,el('p','점선은 대지, 청록색은 건물, 노란색은 주차입니다. 도면에는 고른 한 안만 들어가며, 아래 검토는 도면에 있는 안 기준입니다.','plan-context'));
  }
  const report=engine.doc.sitePlan?.report;if(!report)return;
   if(!engine.doc.sitePlanAlternatives?.length&&!shown)body.append(planQualityPanel(planQualityNow(active,{document:engine.doc})));
  const selectedTarget=target.value;target.replaceChildren();for(const binding of engine.doc.sitePlan.bindings){const option=document.createElement('option'),path=binding.path;option.value=binding.entityId;option.textContent=path[0]==='floors'?`${path[1]+1}층 바닥`:path[0]==='stalls'?`주차 ${path[1]+1}번`:path[0]==='walkways'?`보행로 ${path[1]+1}번`:path[0]==='landscape'?`조경 ${path[1]+1}번`:path[0]==='footprint'?'건물 외곽':'옥탑';target.append(option);}if([...target.options].some(o=>o.value===selectedTarget))target.value=selectedTarget;
  const issues=report.checks.filter(c=>!planCheck(c).ok&&c.severity!=='info');
  if(issues.length){const attention=el('div',null,'plan-section');attention.append(el('strong','선택한 안에서 먼저 확인할 부분'));for(const c of issues)attention.append(el('p',`${c.rule} · 현재 ${c.value??'—'} / 기준 ${c.limit??'—'}${c.provisional?' (잠정 기준)':''}`));body.append(attention);}
  const details=el('details',null,'plan-section');details.append(el('summary',`상세 검토 ${report.checks.length}개 항목 펼쳐보기`));
  if(sitePlanStatus(engine.doc).stale)details.append(el('p','도면이 수정되었습니다. 이전 수치이므로 재검증하세요.'));
  for(const c of report.checks||[]){const row=el('div',null,'plan-check');row.append(el('span',c.rule),el('span',`${c.value??'—'} / ${c.limit??'—'} · ${planCheck(c).ok?'통과'+(planCheck(c).tolerated?' (±3% 적합)':''):c.severity==='info'?'목표 미달':'확인 필요'}${c.provisional?' · 잠정':''}`));details.append(row);}
  for(const warning of report.warnings||[])details.append(el('p',String(warning)));body.append(details,el('p','생성 시점의 개략 계획입니다. 용적률 상한 달성 및 상세 법규 적합을 확정한 결과는 아닙니다.','plan-context'));

 };
 async function generate(program,confirmedInput,aiCommit){
  if(!serviceReady)throw Error(connectionMessage);
  if(pending)throw Error('배치 요청이 진행 중입니다.');
  const initialSnapshot=JSON.stringify(engine.doc);
  const original=confirmedInput||input();let request=copyPlanInput(original,engine.doc);
  if(!confirmedInput&&hasParcel()&&!engine.doc.sitePlanInput){
   const current=await studio.api('site-plan/from-drawing',{entities:engine.doc.entities,program:program||request?.program});
   setPlanValueSources(current.request,drawingInputSources(current,request,program));request=current.request;
   studio.context.setMiribodaInfo?.(current.landInfo);
  }
  if(!request)throw Error('주소로 대지를 먼저 가져오세요.');
  if(!request.site?.neighbors?.some(n=>n.jimok==='도'||n.jimok==='도로'))throw Error('배치에 사용할 도로 경계가 없습니다. 주변 도로를 포함해 대지를 가져오세요.');
  if(JSON.stringify(engine.doc)!==initialSnapshot)throw Error('대지를 읽는 중 도면이 바뀌었습니다. 다시 요청하세요.');
  if(request.zoning?.zone==='미확인'){
   panel.close();
   studio.context.form('불러온 대지 · 계획 조건',[
    {name:'zone',label:'용도지역 (토지이용계획 확인값)',value:'',type:'text'},
    {name:'target',label:'목표 연면적 (㎡)',value:program?.target_gfa||'',type:'number'},
    {name:'floors',label:'층수',value:program?.floors||request.program.floors,type:'number'},
   ],async values=>{
    if(JSON.stringify(engine.doc)!==initialSnapshot)throw Error('대지가 바뀌었습니다. 계획을 다시 요청하세요.');
    if(!values.zone.trim()||!(Number(values.target)>0)||!Number.isInteger(Number(values.floors))||Number(values.floors)<1)throw Error('용도지역·목표 연면적·층수를 입력하세요.');
    request.zoning.zone=values.zone.trim();setPlanValueSources(request,{...planValueSources(request),'zoning.zone':{value:values.zone.trim(),source:'user',note:'입력한 용도지역'}});
    toast(await generate({...program,target_gfa:Number(values.target),floors:Number(values.floors),floors_search:false},request,aiCommit));
   });
   return '불러온 대지를 계획에 연결했습니다. 열린 계획 조건 창에서 용도지역·목표 연면적을 입력하면 배치를 생성합니다.';
  }
  if(program){const allowed=['use','floors','floor_h','target_gfa','massing','shape','floors_search','parking','entry_side'];if(Object.keys(program).some(k=>!allowed.includes(k)))throw Error('배치는 프로그램 조건으로만 생성합니다. 좌표는 엔진이 결정합니다.');if(program.parking&&Object.keys(program.parking).some(k=>!['count','mode','layout','stall'].includes(k)))throw Error('주차 조건을 확인하세요.');request.program={...request.program,...program};recordPlanValues(request,program,'user','입력한 계획 조건');}
  const snapshot=JSON.stringify(engine.doc),visibleWait=sitePlanWaitEnabled();pending=true;failure='';controller=new AbortController();progress='작업 접수 중';render();if(visibleWait)panel.close();else if(!panel.open)panel.showModal();
  try{
   const plans=await withSitePlanWait(studio,request,{fixedFloors:Number.isInteger(program?.floors),signal:controller.signal,onFallback:message=>toast(message),onProgress:message=>{progress=message;if(!visibleWait)render();}},options=>generateAlternativePlans(request,studio.api,options));
   if(JSON.stringify(engine.doc)!==snapshot)throw Error('생성 중 도면이 바뀌어 결과를 넣지 않았습니다.');
   if(isContract10(plans[0]?.result)){shown={plans};render();panel.showModal();return '계획 3안을 받았습니다. 카드에서 그릴 안을 고르세요.';}
   let doc=attachAlternativePlans(engine.doc,plans);const sourceInfo=studio.context.getMiribodaInfo?.();
   if(sourceInfo?.pnu===request.site.id){const info={...sourceInfo,sunlightApplies:plans[0].result.report.sunlight?.applies,planChecks:plans[0].result.report.checks,suggestions:planSuggestions(plans[0].result.report)};const staged=new engine.constructor();staged.doc=doc;staged.execute({type:'parcel.info',info});doc=staged.doc;studio.context.setMiribodaInfo?.(info);}
   engine.validate(doc);const apply=()=>revealSitePlan(studio.context,()=>execute({type:'load',document:doc}));if(aiCommit)await aiCommit(apply);else apply();fit();render();
   return plans.map(p=>p.title+' · '+planSummary(p.result.report)+' · '+p.note).join('\n');
  }catch(error){failure=String(error?.message||error);if(!panel.open)panel.showModal();throw error;}finally{pending=false;controller=null;progress='';render();}
 }
 async function validate(aiCommit){
  if(!serviceReady)throw Error(connectionMessage);
  if(pending)throw Error('배치 요청이 진행 중입니다.');
  validationPayload(engine.doc);const snapshot=JSON.stringify(engine.doc),source=structuredClone(engine.doc);pending=true;render();
  try{const state=await revalidateSitePlan(source,studio.api);if(JSON.stringify(engine.doc)!==snapshot)throw Error('재검증 중 도면이 바뀌었습니다. 현재 도면으로 다시 검증하세요.');source.sitePlan=state;refreshSunlightDrawing(source);if(aiCommit)await aiCommit(()=>execute({type:'load',document:source}));else execute({type:'load',document:source});return planSummary(state.report)+' · 일조 검토도 갱신';}finally{pending=false;render();}
 }
 button('대지 파일 열기',()=>studio.pickFiles('.json',false,async files=>{const raw=JSON.parse(await files[0].text()),{site,zoning,program,output}=raw;if(site?.crs!=='EPSG:5187'||!zoning||!program)throw Error('미리보다 대지 입력 파일을 확인하세요.');execute({type:'document.update',changes:{sitePlanInput:{site,zoning,program,...(output?{output}:{})}}});toast(serviceReady?'대지 입력을 보관했습니다. 배치를 생성할 수 있습니다.':'대지 입력을 보관했습니다. 새 배치 엔진 연동 후 사용할 수 있습니다.');}));
 const generateButton=button('계획 3안 생성',async()=>toast(await generate()));generateButton.disabled=!serviceReady;generateButton.title=connectionMessage;
 const cancelButton=button('생성 취소',()=>controller?.abort());cancelButton.hidden=true;
 button('결과 파일 열기',()=>studio.pickFiles('.json',true,async files=>{
  const snapshot=JSON.stringify(engine.doc),values=await Promise.all(files.map(async f=>JSON.parse(await f.text())));
  const bundle=values.find(v=>v.request&&v.result),request=bundle?.request||values.find(v=>v.site&&v.program)||input();
  const result=bundle?.result||values.find(v=>v.report&&(v.entities||v.contract))||{report:values.find(v=>v.geometry&&v.checks),entities:values.find(v=>v.units==='m'&&v.entities)};
  if(!request)throw Error('생성에 사용한 대지 입력 파일도 함께 선택하세요.');
  if(JSON.stringify(engine.doc)!==snapshot)throw Error('도면이 바뀌었습니다. 파일을 다시 여세요.');
  const cleaned={site:request.site,zoning:request.zoning,program:request.program,...(request.output?{output:request.output}:{})};
  if(isContract10(result)){shown={plans:result.contract.plans.map(p=>({request:cleaned,result,planId:p.plan_id}))};render();if(!panel.open)panel.showModal();return;}
  const doc=attachSitePlan(engine.doc,cleaned,result);engine.validate(doc);execute({type:'load',document:doc});fit();render();
 }));
 const validateButton=button('편집 후 재검증',async()=>toast(await validate()));validateButton.disabled=!serviceReady;validateButton.title=connectionMessage;
 button('일조 평면·단면 보기',()=>{if(engine.doc.sitePlan?.sunlightDrawing?.applies===false)return;const ids=engine.doc.sitePlan?.sunlightDrawing?.entityIds;if(!ids?.length||ids.some(id=>!engine.doc.entities.some(e=>e.id===id)))throw Error('일조 검토도가 없습니다. 계획을 다시 생성하세요.');studio.context.selectEntities(ids);panel.close();const b=document.querySelector('.canvas-view-tools');[...(b?.querySelectorAll('button')||[])].find(b=>b.textContent==='선택 맞춤')?.click();studio.context.selectEntities([]);}).dataset.sunlight='true';
 button('다각형 선택',()=>{if(!target.value)throw Error('배치 결과를 먼저 여세요.');studio.context.selectEntities([target.value]);panel.close();toast(serviceReady?'선택한 다각형을 편집한 뒤 배치 검토에서 재검증하세요.':'다각형을 선택했습니다. 편집 후 재검증은 서버 연동 후 가능합니다.');});
 button('닫기',()=>panel.close());const advanced=el('details',null,'plan-section');advanced.append(el('summary','파일 가져오기 · 도면 편집'),target);for(const b of [...toolbar.children])if(['대지 파일 열기','결과 파일 열기','다각형 선택'].includes(b.textContent))advanced.append(b);panel.append(title,status,toolbar,body,advanced);document.body.append(panel);engine.onChange(()=>{if(panel.open)render();});
 studio.context.sitePlanGenerate=generate;studio.context.sitePlanValidate=validate;
 // options.plans: 계획 탭이 만든 후보({title,note,request,result}), options.take(plan): 그 안을 도면으로 가져오기
 studio.context.sitePlanOpen=(options)=>{shown=options?.plans?.length?options:null;render();if(!panel.open)panel.showModal();};
 studio.context.sitePlanContext=()=>({generationAvailable:serviceReady,validationAvailable:serviceReady,connectionMessage:serviceReady?null:connectionMessage,hasInput:!!input()||hasParcel(),inputSource:input()?'saved-input':hasParcel()?'drawing-parcel':null,hasResult:!!engine.doc.sitePlan,program:input()?.program,status:sitePlanStatus(engine.doc),summary:engine.doc.sitePlan?planSummary(engine.doc.sitePlan.report):null});
}
