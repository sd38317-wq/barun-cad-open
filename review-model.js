// 공통 검토 값·상태. 길이는 mm.
export const REVIEW_STATUS=Object.freeze({revise:Object.freeze({label:'수정 검토',symbol:'■',color:'#ff6b6b'}),need_input:Object.freeze({label:'입력 필요',symbol:'▲',color:'#9fb3c8'}),check_detail:Object.freeze({label:'상세 확인',symbol:'◆',color:'#ffb65c'}),satisfied:Object.freeze({label:'해당 항목 충족',symbol:'●',color:'#85ddc9'})});
export const APPLICABILITY=Object.freeze({applicable:'applicable',not_applicable:'not_applicable',unknown:'unknown'});
export const PROGRESS=Object.freeze({not_run:'not_run',running:'running',stale:'stale',done:'done'});
const sources=['source','auto_read','designer','assumed'],confirmations=['confirmed','assumed','unconfirmed'];
export function reviewValue({value=null,unit='',sourceKind='source',sourceRef=null,confirmation='unconfirmed',observedAt=null,confirmedAt=null}={}){if(!sources.includes(sourceKind)||!confirmations.includes(confirmation))throw Error('검토 값 출처·확인 상태 오류');if(typeof value==='number'&&!Number.isFinite(value))value=null;return {value:confirmation==='unconfirmed'?null:value??null,unit,sourceKind,sourceRef,confirmation,observedAt,confirmedAt};}
export function formatReviewValue(v){return v?.value==null?'—':String(v.value)+(v.unit||'');}
export function makeReviewItem(o={}){
 const current=reviewValue(o.current??{}),item={id:o.id??'',field:o.field??'site',objectIds:[...(o.objectIds||[])],reviewObjectIds:[...(o.reviewObjectIds||[])],name:o.name??'',current,criterion:{value:null,unit:'',operator:null,sourceId:null,ruleId:null,ruleVersionId:null,...o.criterion},applicability:o.applicability??'unknown',progress:o.progress??'not_run',status:o.status??'need_input',reason:o.reason??'',assumed:!!o.assumed||current.sourceKind==='assumed'||current.confirmation==='assumed',nextAction:o.nextAction??'',evidence:structuredClone(o.evidence||[]),unknowns:structuredClone(o.unknowns||[]),evaluatedAt:o.evaluatedAt??null,ruleSetId:o.ruleSetId??null,ruleVersionId:o.ruleVersionId??null,effectiveDate:o.effectiveDate??null,statuteRef:o.statuteRef??null};
 if(!Object.hasOwn(REVIEW_STATUS,item.status)||!Object.values(APPLICABILITY).includes(item.applicability)||!Object.values(PROGRESS).includes(item.progress)||!['site','access','energy','law'].includes(item.field))throw Error('검토 항목 상태·분야 오류');
 if(item.status==='satisfied'){const reasons=[];if(item.progress!=='done')reasons.push('검토 미완료');if(item.applicability!=='applicable')reasons.push(item.applicability==='not_applicable'?'해당 없음':'적용 여부 입력 필요');if(current.value===null)reasons.push('현재 값 입력 필요');if(item.unknowns.length)reasons.push('미확인 사항 남음');if(item.assumed)reasons.push('가정 값 확인 필요');if(reasons.length){item.status=current.value===null||item.applicability==='unknown'||item.unknowns.length?'need_input':'check_detail';item.reason=[item.reason,...reasons].filter(Boolean).join(' · ');}}
 return item;
}
export function compareCriterion(current,criterion){
 const c=current?.value,t=criterion?.value,unit=criterion?.unit||current?.unit||'';
 if(c==null||t==null)return {status:'need_input',reason:'현재 값·기준 입력 필요'};
 if(typeof c!=='number'||!Number.isFinite(c)||typeof t!=='number'||!Number.isFinite(t)||!['>=','<='].includes(criterion.operator)||current.unit!==criterion.unit)return {status:'check_detail',reason:'숫자·단위·비교 연산자 확인 필요'};
 const passed=criterion.operator==='>='?c>=t:c<=t,diff=Number(Math.abs(t-c).toFixed(6));
 if(current.confirmation!=='confirmed'||current.sourceKind==='assumed')return {status:'check_detail',reason:'가정·미확인 값 확인 필요'};
 return passed?{status:'satisfied',reason:'기준 충족'}:{status:'revise',reason:(criterion.name?criterion.name+' ':'')+t+unit+(criterion.operator==='>='?' 미만 (':' 초과 (')+diff+unit+(criterion.operator==='>='?' 부족)':' 초과)')};
}
export function legacyStatusToReview(kind,value){
 const v=value?.type||value,code=value?.severity||v;let status='check_detail',applicability='applicable';
 if(Object.hasOwn(REVIEW_STATUS,value?.status))return {status:value.status,applicability:value.applicability??applicability};
 if(kind==='livecheck')status=['areas_missing','floor_area_incomplete','north_missing','floor_unknown'].includes(v)?'need_input':/_tolerance$/.test(v)?'satisfied':code==='error'?'revise':'check_detail';/* ±3% 허용오차 안은 적합 */
 else if(kind==='parcel-road')status=({'부족':'revise','확인 필요':'need_input','충족':'satisfied'})[v]||status;
 else if(['parcel-info','site-plan'].includes(kind))status=({'통과':'satisfied','NG':'revise','확인 필요':'need_input','목표 미달':'check_detail'})[v]||status;
 else if(kind==='apartment'){status=({'검사 통과':'satisfied','검사 확인':'check_detail','해당 없음':'check_detail'})[v]||status;if(v==='해당 없음')applicability='not_applicable';}
 return {status,applicability};
}
export const REVIEW_PREFIX=Object.freeze({door:'D',ramp:'R',toilet:'WC',parking:'P',exterior_wall:'EW',window:'W',zone:'Z',roof:'RF',floor:'FL',pile:'PL'});
export function nextReviewObjectId(doc,kind){if(!Object.hasOwn(REVIEW_PREFIX,kind))throw Error('검토 객체 종류 오류');const seq=doc.reviewObjectSeq?.[kind]??0;if(!Number.isSafeInteger(seq)||seq<0||seq===Number.MAX_SAFE_INTEGER)throw Error('검토 객체 순번 오류');doc.reviewObjectSeq={...doc.reviewObjectSeq,[kind]:seq+1};return REVIEW_PREFIX[kind]+'-'+String(seq+1).padStart(2,'0');}
export function reviewObjectKey(documentId,reviewObjectId){return `${documentId}:${reviewObjectId}`;}
export function appendReviewHistory(doc,entry){const {at=null,targetId=null,field=null,prev=null,next=null,prevStatus=null,nextStatus=null,ruleVersionId=null,actor=null}=entry;const row=structuredClone({at,targetId,field,prev,next,prevStatus,nextStatus,ruleVersionId,actor});doc.reviewHistory=[...(doc.reviewHistory||[]),row].slice(-2000);return doc.reviewHistory;}
