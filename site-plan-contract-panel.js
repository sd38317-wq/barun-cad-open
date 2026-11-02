import {sitePlanStatus} from './site-plan.js';
import {contractPlan} from './site-contract.js';
import {contractCandidates,contractValidation,validationEntityIds,enginePlanFile,contractResultMatches,PLAN_DRAWING_NUMBERS} from './site-plan-results.js';
const previews=new WeakMap();
function previewFile(studio,url){
 let cache=previews.get(studio);if(!cache){cache=new Map();previews.set(studio,cache);}
 if(!cache.has(url)){if(cache.size>=24)cache.delete(cache.keys().next().value);cache.set(url,studio.api('site-plan/artifact',{url,format:'png'}));}
 return cache.get(url);
}
// 호출한 때만 카드·미리보기를 만든다. 도면의 그리기·선택 루프와 분리한다.
export function contractPlanPanel(studio,{request,result,active,pending=false,onChoose,document:doc=globalThis.document}){
 const el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
 const section=el('section',null,'contract-plan-panel'),error=el('p',null,'contract-plan-error');error.setAttribute('role','alert');
 const style=el('style');style.textContent='.contract-plan-panel{font-variant-numeric:tabular-nums}.contract-plan-panel .plan-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:16px}.contract-plan-panel .plan-card{padding:16px;border:1px solid #39545f;display:flex;flex-direction:column;gap:10px}.contract-plan-panel .plan-metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px}.contract-plan-panel dd{margin:0}.contract-plan-panel h3{margin:0;text-wrap:balance}.contract-plan-panel p{text-wrap:pretty}.contract-plan-panel .plan-card.active{border-color:#9dcbe0;box-shadow:none}.contract-plan-panel .contract-preview{width:100%;height:170px;object-fit:contain;background:#10212a}.contract-plan-panel .contract-actions{display:flex;flex-wrap:wrap;gap:8px}.contract-plan-panel .contract-actions button{width:auto;margin:0}.contract-plan-panel table{width:100%;border-collapse:collapse;margin:16px 0}.contract-plan-panel th,.contract-plan-panel td{padding:8px;border-bottom:1px solid #39545f;text-align:left}.contract-plan-panel .contract-table{overflow:auto}.contract-plan-panel .contract-plan-error{color:#ffb5b4}.contract-plan-panel .contract-check{display:block;text-align:left;width:100%;margin:8px 0}.contract-plan-panel button:focus-visible{outline:2px solid #9dcbe0;outline-offset:2px}';section.append(style,error);
 const run=fn=>async()=>{error.textContent='';try{await fn();}catch(e){error.textContent=e.message;}};
 active=contractResultMatches(active,result,request)?active:null;
 const candidates=contractCandidates(request,result),grid=el('div',null,'plan-grid'),fmt=(v,u='')=>v==null?'미확인':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2})+u;
 const metricRows=p=>{const m=p.metrics||{};return [['용적률',fmt(m.floor_area_ratio_pct,'%')],['건폐율',fmt(m.building_coverage_pct,'%')],['연면적',fmt(m.gross_floor_area_m2,'㎡')],['세대수',fmt(m.unit_count,'세대')],['주차',fmt(m.parking_planned_count,'대')+' / 기준 '+fmt(m.parking_required_count,'대')]];};
 for(const candidate of candidates){
  const p=result.contract.plans.find(p=>p.plan_id===candidate.planId),selected=active?.contract?.planId===p.plan_id,card=el('article',null,'plan-card'+(selected?' active':''));card.append(el('p',candidate.sheet.drawing_number||PLAN_DRAWING_NUMBERS[p.plan_id],'plan-kicker'),el('h3',candidate.title));
  const preview=el('div','PNG 미리보기 '+(candidate.sheet.png_url?'불러오는 중':'미제공'),'contract-preview');card.append(preview);
  if(candidate.sheet.png_url)previewFile(studio,candidate.sheet.png_url).then(file=>{if(!preview.isConnected)return;const img=el('img');img.alt=candidate.title+' 배치도';img.className='contract-preview';img.src='data:image/png;base64,'+file.data;preview.replaceWith(img);}).catch(()=>{preview.textContent='PNG 미리보기를 받지 못했습니다.';});
  const metrics=el('dl',null,'plan-metrics');for(const [label,value] of metricRows(p)){const row=el('div',null,'plan-metric');row.append(el('dt',label),el('dd',value));metrics.append(row);}card.append(metrics);
  const choose=el('button',selected?'도면에 있음':'이 안으로 그리기');choose.type='button';choose.disabled=pending||candidate.failed||selected;choose.onclick=run(()=>onChoose(candidate));card.append(choose);
  if(candidate.failed)card.append(el('p',candidate.error,'contract-plan-error'));
  const actions=el('div',null,'contract-actions');
  for(const format of ['dxf','png','pdf']){const b=el('button',format.toUpperCase()+' 저장');b.type='button';b.disabled=pending||!candidate.sheet[format+'_url'];if(b.disabled)b.title='엔진 파일 미제공 또는 생성 중';b.onclick=run(()=>enginePlanFile(studio,result,p.plan_id,format));actions.append(b);}
  const open=el('button','DXF 도면으로 열기');open.type='button';open.disabled=pending||!candidate.sheet.dxf_url;open.onclick=run(()=>enginePlanFile(studio,result,p.plan_id,'dxf',{open:true}));actions.append(open);card.append(actions);grid.append(card);
 }
 section.append(grid);
 const compare=el('div',null,'contract-table'),table=el('table'),caption=el('caption','A0-000 · 계획 3안 비교표');table.append(caption);
 const head=el('tr');for(const t of ['항목',...candidates.map(c=>c.title)])head.append(el('th',t));table.append(head);
 const rows=result.contract.plans.map(metricRows);for(let i=0;i<5;i++){const row=el('tr');row.append(el('th',rows[0]?.[i]?.[0]||''));for(const cells of rows)row.append(el('td',cells[i][1]));table.append(row);}compare.append(table);section.append(compare);
 const compareSheet=(result.sheets||[]).find(s=>s.drawing_number==='A0-000');
 if(compareSheet){const actions=el('div',null,'contract-actions');for(const format of ['dxf','png','pdf'])if(compareSheet[format+'_url']){const b=el('button','A0-000 '+format.toUpperCase()+' 저장');b.type='button';b.onclick=run(()=>enginePlanFile(studio,result,compareSheet.plan_id,format));actions.append(b);}section.append(actions);}
 const chosenId=active?.contract?.planId;const chosen=result.contract.plans.some(p=>p.plan_id===chosenId)?chosenId:candidates.find(c=>!c.failed)?.planId;
 const currentDoc=studio.context.engine.doc,stale=active&&sitePlanStatus(currentDoc).stale;
 if(active?.contract?.revalidated)section.append(el('p','편집 후 재검증했습니다. 아래 계약 수치·검사는 생성 당시 결과입니다. 최신 안별 계약은 다시 생성해 받으세요.','plan-context'));
 if(active&&!active.contract?.revalidated)section.append(el('p',stale?'도면이 수정되었습니다. 아래 수치·검사는 수정 전 결과입니다.':'생성 시점의 계획 검사 결과입니다.','plan-context'));
 const showChecks=(title,rows,related=!!active&&!active.contract?.revalidated)=>{const details=el('details',null,'plan-section');details.open=true;details.append(el('summary',title+' · '+rows.length+'개 (계획안 허용오차 ±3%)'));
  for(const c of rows){const row=el('button',c.rule+' · '+c.status+' · '+(c.value??'미확인')+' / '+(c.limit??'미확인')+(c.provisional?' · 잠정':'')+(c.basis?' · '+c.basis:''),'contract-check');row.type='button';const ids=related?validationEntityIds(currentDoc,c):[];row.disabled=!ids.length;row.title=ids.length?'관련 객체 위치로 이동':'관련 도면 객체 없음';row.onclick=()=>studio.context.zoomObjects?.(ids);details.append(row);}section.append(details);
 };
 if(chosen)showChecks(contractPlan(result.contract,chosen).label_ko+' · 안별 검사',contractValidation(result.contract,chosen));
 if(result.contract.validation?.length)showChecks('엔진 대표안 validation · 안별 검사와 별도',contractValidation(result.contract),!!active&&!active.contract?.revalidated&&active.contract.planId===result.contract.selected_plan?.plan_id);
 return section;
}
