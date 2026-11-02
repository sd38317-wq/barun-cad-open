import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';
import {REVIEW_STATUS,APPLICABILITY,PROGRESS,reviewValue,formatReviewValue,makeReviewItem,compareCriterion,legacyStatusToReview,REVIEW_PREFIX,nextReviewObjectId,reviewObjectKey,appendReviewHistory} from './review-model.js';
const value=n=>reviewValue({value:n,unit:'mm',sourceKind:'designer',confirmation:'confirmed'});
const complete={id:'width',name:'실폭',field:'access',current:value(900),applicability:'applicable',progress:'done',status:'satisfied'};
test('네 상태 라벨·기호·색과 출처·확인 상태를 보존한다',()=>{
 assert.deepEqual(Object.values(REVIEW_STATUS).map(s=>[s.label,s.symbol,s.color]),[['수정 검토','■','#ff6b6b'],['입력 필요','▲','#9fb3c8'],['상세 확인','◆','#ffb65c'],['해당 항목 충족','●','#85ddc9']]);
 for(const sourceKind of ['source','auto_read','designer','assumed'])for(const confirmation of ['confirmed','assumed','unconfirmed']){const v=reviewValue({value:0,unit:'mm',sourceKind,confirmation,sourceRef:'ref',observedAt:'now',confirmedAt:'then'});assert.equal(v.value,confirmation==='unconfirmed'?null:0);assert.equal(v.sourceRef,'ref');assert.equal(v.observedAt,'now');assert.equal(v.confirmedAt,'then');}
 assert.equal(formatReviewValue(reviewValue()),'—');assert.equal(formatReviewValue(value(0)),'0mm');assert.equal(formatReviewValue(value(900)),'900mm');assert.equal(reviewValue({value:NaN,confirmation:'confirmed'}).value,null);assert.throws(()=>reviewValue({sourceKind:'bad'}));
});
test('미완료·비적용·미확인·가정은 충족이 될 수 없다',()=>{
 for(const progress of Object.values(PROGRESS))for(const applicability of Object.values(APPLICABILITY))for(const n of [null,0,900]){const row=makeReviewItem({...complete,progress,applicability,current:value(n)});const ok=progress==='done'&&applicability==='applicable'&&n!==null;assert.equal(row.status==='satisfied',ok);if(!ok)assert.ok(row.reason);}
 for(const extra of [{unknowns:['폭 미확인']},{assumed:true},{current:reviewValue({value:900,confirmation:'assumed'})}])assert.notEqual(makeReviewItem({...complete,...extra}).status,'satisfied');
 assert.equal(makeReviewItem(complete).status,'satisfied');assert.throws(()=>makeReviewItem({field:'bad'}));assert.equal(makeReviewItem().current.value,null);
});
test('수치 비교는 경계·부족·초과와 단위·미입력을 구분한다',()=>{
 const criterion={name:'실폭',value:900,unit:'mm',operator:'>='};assert.equal(compareCriterion(value(820),{value:900,unit:'mm',operator:'>='}).reason,'900mm 미만 (80mm 부족)');assert.deepEqual(compareCriterion(value(820),criterion),{status:'revise',reason:'실폭 900mm 미만 (80mm 부족)'});
 assert.equal(compareCriterion(value(900),criterion).status,'satisfied');assert.equal(compareCriterion(value(901),criterion).status,'satisfied');assert.equal(compareCriterion(value(901),{...criterion,operator:'<='}).reason,'실폭 900mm 초과 (1mm 초과)');assert.equal(compareCriterion(value(899),{...criterion,operator:'<='}).status,'satisfied');
 assert.equal(compareCriterion(value(null),criterion).status,'need_input');for(const c of [{...criterion,operator:'='},{...criterion,unit:'m'},{...criterion,value:'900'}])assert.equal(compareCriterion(value(900),c).status,'check_detail');assert.equal(compareCriterion(reviewValue({value:900,confirmation:'assumed'}),criterion).status,'check_detail');
});
test('모든 옛 상태를 공통 표시 상태로 변환한다',()=>{
 const rows={'livecheck':[['error','revise'],['warn','check_detail'],...['areas_missing','floor_area_incomplete','north_missing'].map(x=>[x,'need_input'])],'parcel-road':[['부족','revise'],['확인 필요','need_input'],['충족','satisfied']],'parcel-info':[['통과','satisfied'],['NG','revise'],['확인 필요','need_input'],['목표 미달','check_detail']],'apartment':[['검사 통과','satisfied'],['검사 확인','check_detail'],['해당 없음','check_detail']]};rows['site-plan']=rows['parcel-info'];
 for(const [kind,entries]of Object.entries(rows))for(const [input,status]of entries)assert.equal(legacyStatusToReview(kind,input).status,status);
 assert.equal(legacyStatusToReview('apartment','해당 없음').applicability,'not_applicable');assert.equal(legacyStatusToReview('livecheck',{severity:'error',type:'north_missing'}).status,'need_input');
});
test('객체 번호는 종류별 증가하고 삭제 후 재사용하지 않는다',()=>{
 const doc={documentId:'doc',entities:[]};for(const [kind,prefix]of Object.entries(REVIEW_PREFIX))assert.equal(nextReviewObjectId(doc,kind),prefix+'-01');
 doc.entities.push({reviewObjectId:nextReviewObjectId(doc,'door')});doc.entities=[];assert.equal(nextReviewObjectId(doc,'door'),'D-03');doc.reviewObjectSeq.door=99;assert.equal(nextReviewObjectId(doc,'door'),'D-100');assert.equal(reviewObjectKey('doc','D-01'),'doc:D-01');assert.throws(()=>nextReviewObjectId(doc,'bad'));
});
test('이력은 불변 복사·2000개 제한과 모든 필드를 지킨다',()=>{
 const old=[{at:'old'}],doc={reviewHistory:old},entry={at:'now',targetId:'doc:D-01',field:'access',prev:{value:800},next:{value:900},prevStatus:'revise',nextStatus:'satisfied',ruleVersionId:'v1',actor:'designer'};
 appendReviewHistory(doc,entry);assert.equal(old.length,1);entry.next.value=0;assert.equal(doc.reviewHistory[1].next.value,900);assert.deepEqual(Object.keys(doc.reviewHistory[1]),['at','targetId','field','prev','next','prevStatus','nextStatus','ruleVersionId','actor']);
 for(let i=0;i<2001;i++)appendReviewHistory(doc,{at:String(i)});assert.equal(doc.reviewHistory.length,2000);assert.equal(doc.reviewHistory[0].at,'1');
});
test('생성 항목은 인계 JSON Schema를 통과하고 잘못된 충족은 거부한다',()=>{
 const rows=[];for(const progress of Object.values(PROGRESS))for(const applicability of Object.values(APPLICABILITY))for(const n of [null,0,900])rows.push(makeReviewItem({...complete,progress,applicability,current:value(n)}));rows.push(makeReviewItem(),makeReviewItem({...complete,unknowns:['확인']}));
 const schema=JSON.parse(readFileSync(new URL('./rules/knowledge/review-row.schema.json',import.meta.url),'utf8'));
 const invalid=[{...rows[0],status:'satisfied'},...['applicability','progress','unknowns','current'].map(key=>({...makeReviewItem(complete),[key]:({applicability:'unknown',progress:'stale',unknowns:['확인'],current:value(null)})[key]}))];
 const script="import json,sys,jsonschema\np=json.load(sys.stdin);v=jsonschema.Draft202012Validator(p['schema']);v.check_schema(p['schema'])\nfor r in p['rows']:v.validate(r)\nfor r in p['invalid']:assert not v.is_valid(r)\n";
 const run=spawnSync('python',['-c',script],{input:JSON.stringify({schema,rows,invalid}),encoding:'utf8'});assert.equal(run.status,0,run.stderr);
});

test('허용오차 ±3% 안의 경고는 해당 항목 충족',()=>{assert.equal(legacyStatusToReview('livecheck',{type:'coverage_tolerance',severity:'warn'}).status,'satisfied');assert.equal(legacyStatusToReview('livecheck',{type:'north_tolerance',severity:'warn'}).status,'satisfied');});
