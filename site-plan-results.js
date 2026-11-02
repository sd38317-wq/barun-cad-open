import {planCheck} from './livecheck-auto.js';
import {contractPlan} from './site-contract.js';
export const PLAN_DRAWING_NUMBERS={max_far:'A0-001',max_bcr:'A0-002',efficiency:'A0-003'};
export function planSheet(result,planId){return (result.sheets||[]).find(s=>s.plan_id===planId||s.drawing_number===PLAN_DRAWING_NUMBERS[planId])||{};}
export function contractCandidates(request,result){
 return (result.contract?.plans||[]).map(p=>({planId:p.plan_id,title:p.label_ko,note:p.verdict?.note_ko||'',failed:p.available===false,error:p.verdict?.note_ko||'성립하는 안이 없습니다.',request,result,sheet:planSheet(result,p.plan_id)}));
}
// 입력이 같아도 다시 생성한 결과는 별도다. 선택 상태와 검사 위치는 정확히 같은 결과에만 연결한다.
export function contractResultMatches(active,result,request){
 const bundle=active?.contract?.bundle;
 return !!bundle&&(!request||JSON.stringify(active.request)===JSON.stringify(request))&&JSON.stringify(bundle.contract)===JSON.stringify(result.contract)&&JSON.stringify(bundle.sheets||[])===JSON.stringify(result.sheets||[]);
}
export function isContractCandidateSet(plans){return !!plans?.length&&plans.every(p=>p.planId&&p.result===plans[0].result&&p.result?.contract?.contract_version==='1.0');}
export function contractReport(result,plan){
 const m=plan.metrics||{},toM=ring=>ring?.map(p=>p.map(v=>v/1000)),outlines=(plan.objects||[]).filter(o=>o.role==='building_outline').sort((a,b)=>Math.min(...(a.floors||[a.floor]))-Math.min(...(b.floors||[b.floor])));
 const first=outlines[0],floors=[];
 for(const o of outlines)for(const f of o.floors||[o.floor])if(f>0)floors[f-1]=toM(o.geometry.ring);
 const geometry={...result.report?.geometry,footprint:toM(first?.geometry.ring)||[],floors: Array.from({length:floors.length},(_,i)=>floors[i]||[]),stalls:(plan.stalls||[]).map(s=>({rect:toM(s.geometry.ring),tandem:!!s.tandem,group:s.group||0})),walkways:(plan.objects||[]).filter(o=>o.role==='walkway').map(o=>toM(o.geometry.ring)),landscape:(plan.objects||[]).filter(o=>o.role==='landscape').map(o=>toM(o.geometry.ring)),rooftop_box:[]};
 return {...result.report,numbers:{...result.report?.numbers,building_area:m.building_area_m2,gfa:m.gross_floor_area_m2,bcr:m.building_coverage_pct,far:m.floor_area_ratio_pct,floors:m.floor_count,units:m.unit_count,parking_placed:m.parking_planned_count,parking_required:m.parking_required_count},geometry,checks:(plan.checks||[]).map(c=>({rule:c.label_ko,value:c.value,limit:c.limit,ok:c.passed,severity:c.severity,provisional:c.provisional}))};
}
export function contractValidation(contract,planId){
 const plan=contractPlan(contract,planId),validation=plan.validation|| (!planId||planId===contract.selected_plan?.plan_id?contract.validation:null);
 const list=validation?.length?validation:(plan.checks||[]);
 return list.map(c=>{
  const rule=c.label_ko||c.item||c.rule||'',passed=c.passed??c.ok??(c.result==='PASS'?true:c.result==='FAIL'?false:null),value=c.measured??c.value,limit=c.limit;
  const checked=planCheck({rule,value,limit,ok:passed});
  const unknown=passed==null||['UNKNOWN','NOT_APPLICABLE'].includes(c.result)||c.provisional===true&&passed===true;
  const status=unknown?'확인 필요':checked.tolerated?'허용오차 내 적합':checked.ok?'적합':'부적합';
  return {...c,rule,value,limit,status,basis:c.basis||c.article||c.note_ko||'',objectIds:c.object_ids||c.related_object_ids||(c.object_id?[c.object_id]:[])};
 });
}
export function validationEntityIds(doc,row){
 const objects=new Set(row.objectIds||[]),roles=/주차|차로|출입구/.test(row.rule)?['parking_row','stall','lane','entrance']:/조경/.test(row.rule)?['landscape']:/이격|일조/.test(row.rule)?['sunlight','building_outline']:/건폐율|용적률|외곽|높이/.test(row.rule)?['building_outline']:[];
 return doc.entities.filter(e=>e.sitePlanId===doc.sitePlan?.id&&(objects.size?objects.has(e.contractObjectId):roles.includes(e.contractRole))).map(e=>e.id);
}
export function contractReplacementOptions(doc,request,result){
 const prior=doc.sitePlan,bundle=prior?.contract?.bundle;if(!bundle)return {};
 const hash=result.contract?.provenance?.input_sha1,oldHash=bundle.contract?.provenance?.input_sha1;
 const same=hash&&oldHash?hash===oldHash:JSON.stringify(prior.request)===JSON.stringify(request);
 return same?{replaceSitePlanId:prior.id,offset:prior.offset}:{};
}
export async function enginePlanFile(studio,result,planId,format,{open=false}={}){
 if(!['dxf','png','pdf'].includes(format)||open&&format!=='dxf')throw Error('지원하지 않는 도면 파일입니다.');
 const sheet=planSheet(result,planId),url=sheet[format+'_url'];if(!url)throw Error(format.toUpperCase()+' 파일을 엔진에서 제공하지 않았습니다.');
 const file=await studio.api('site-plan/artifact',{url,format}),name=(sheet.drawing_number||PLAN_DRAWING_NUMBERS[planId]||planId)+'.'+format;
 if(open){const imported=await studio.api('import',{data:file.data,extension:'.dxf'});if(!imported.document)throw Error('DXF 도면을 열지 못했습니다.');return studio.context.openDrawing(imported.document,name);}
 return studio.output(file.data,name,file.mime||{dxf:'application/dxf',png:'image/png',pdf:'application/pdf'}[format]);
}
