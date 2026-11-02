import './test-fixtures/compute-fake-server.js';   // 서버 계산(compute/)은 가짜 바른 서버로
import test from 'node:test';
import assert from 'node:assert/strict';
import {calcReportFields,calcReportHtml,CALC_REPORT_NOTICE,CALC_REPORT_TITLE,CALC_REPORT_VERSION} from './compute/structure-calc-report.js';
import {DrawingEngine,newDrawingDocument} from './engine.js';
import {createBridgeBinding,createBoundRequestHandler,prepareComputeRequest} from './bridge-client.js';
import {CORE,input,analysisFixture,columnMember,beamMember,wallMember,footingMember,footingProposal} from './test-fixtures/structure-calc-report.js';
function actual(kind='A',project={}) {const model=CORE.generate(input(kind)),review=CORE.review(model);return {model,review,result:calcReportFields(model,review,project)};}
const keys = r => r.missing.map(m=>m.key);
for (const [kind,label] of [['A','5층 벽식'],['B','4층 필로티'],['C','3층 모멘트골조']]) test(label+': 실제 엔진 전사·9개 장·부록·초안 문구·A4',()=>{
  const {model,review,result:r}=actual(kind,{공사명:'시험 공사',대지위치:'시험 위치',작성일:'2026-10-17'}),html=calcReportHtml(r);
  assert.equal(r.ok,true);assert.equal(r.sections.length,9);
  assert.equal(r.fields['seismic.x.V'].value,model.preliminary.seismic.x.V);
  assert.equal(r.fields['gravity.C1.PuGravity'].value,model.preliminary.gravity.C1.PuGravity);
  assert.equal(r.fields['gravity.C1.Pu'].value,'');
  assert.equal((html.match(/id="chapter-\d"/g)||[]).length,9);assert.match(html,/id="appendix"/);
  assert.ok(html.includes(CALC_REPORT_TITLE));assert.ok(html.includes(CALC_REPORT_NOTICE));
  for(const forbidden of ['구조 안전 확보','내진 적합','시공 가능','구조계산 완료','기술사 검토 불필요']) assert.ok(!html.includes(forbidden),forbidden);
  assert.match(html,/@page\{size:A4 portrait/);assert.match(html,/break-before:page/);assert.match(html,/thead\{display:table-header-group/);assert.match(html,/Malgun Gothic/);
  assert.ok(!/<(?:link|script|img)\b|https?:\/\/|@import/i.test(html));
  assert.ok(html.includes(model.preliminary.seismic.x.V.toFixed(1)));
  for (const row of review.filter(x=>x.st!=='ok')) assert.ok(html.includes(row.item));
  if(kind==='B') {assert.ok(html.includes('unsupported'));assert.ok(html.includes('필로티'));}
  assert.ok(keys(r).includes('legalArea'));assert.equal(r.fields.legalArea.value,'');
});
test('missing 질문·작성자/서명 강제 빈칸·엔진 누락을 project 기본값으로 보충하지 않는다',()=>{
  const {model,review}=actual();model.preliminary.params=null;model.preliminary.missingInputs=['seismic.siteClass'];review[0].missingInputs=['입력미상'];
  const r=calcReportFields(model,review,{author:'홍길동',signature:'서명',S:0.22,codeEdition:'설계자가 확인한 판'});
  assert.equal(r.fields.author.value,'');assert.equal(r.fields.signature.value,'');assert.equal(r.fields['seismic.x.S'].value,'');
  for(const k of ['author','signature','seismic.x.S','seismic.siteClass','입력미상'])assert.ok(keys(r).includes(k),k);
  assert.ok(r.missing.every(m=>m.key&&m.label&&m.question.includes('요')));
  assert.equal(new Set(keys(r)).size,r.missing.length);
  assert.equal(r.fields.codeEdition.value,'설계자가 확인한 판');
  assert.ok(calcReportHtml(r).includes('누락 항목 및 확인 질문'));
});
test('1~2층·잘못된 reviewMethod·6층·결과 누락 거절',()=>{
  const {model,review}=actual();
  const withStories=n=>({...model.p,stories:n,...(model.p.floors?{floors:Array.from({length:n},(_,i)=>model.p.floors[i%model.p.floors.length])}:{})});   // 층 목록이 있으면 그 수가 층수
  for(const stories of [1,2,6]) {const r=calcReportFields({...model,p:withStories(stories)},review);assert.equal(r.ok,false);assert.match(r.reasons.join(' '),/1~2층.*기존/);assert.throws(()=>calcReportHtml(r));}
  assert.equal(calcReportFields({...model,reviewMethod:'kds42'},review).ok,false);
  assert.equal(calcReportFields({...model,preliminary:null},review).ok,false);
  assert.equal(calcReportFields(model,[]).ok,false);
  assert.throws(()=>calcReportFields(model,review,[]),/객체/);
});

test('층 목록(floors)이 있으면 층수는 그 수 — 서버 기본 stories:2 가 남아도 4층은 계산서(괴정 2026-10-30)',()=>{
  const {model,review}=actual(),floors=Array.from({length:4},()=>({H:3,outline:[[0,0],[10,0],[10,8],[0,8]]}));
  const r=calcReportFields({...model,p:{...model.p,stories:2,floors}},review);assert.equal(r.ok,true,JSON.stringify(r.reasons));
  assert.equal(calcReportFields({...model,p:{...model.p,stories:4,floors:floors.slice(0,2)}},review).ok,false,'2층 목록이면 막음');
});
test('analysis 없음: 6장 미수행 표시와 빈칸, 임의 강성·변위 없음',()=>{
  const model=CORE.generate(input('A')),review=CORE.review(model);delete model.preliminary.analysis;const r=calcReportFields(model,review,{}),chapter=r.sections[5];
  assert.ok(chapter.blocks.some(b=>b.text==='해석 미수행 — 후속 구조계산 필요'));
  const drift=chapter.blocks.find(b=>b.title==='x 방향 층간변위');assert.equal(drift.rows.length,0);
  assert.equal(r.fields['analysis.method'].value,'');assert.ok(keys(r).includes('analysis'));
  assert.ok(!Object.keys(r.fields).some(k=>k.includes('storeys.')));
});
test('실제 엔진 해석 자료 부족(hold): 6장에 자료 부족·빠진 입력 표시, 값 지어내지 않음',()=>{
  const {model,result:r}=actual('A'),chapter=r.sections[5];
  assert.equal(model.preliminary.analysis.status,'hold');
  assert.ok(chapter.blocks.some(b=>typeof b.text==='string'&&b.text.startsWith('해석 자료 부족 — 후속 구조계산 필요 (빠진 입력 ')));
});
test('analysis 약속: 방향별 층간변위·편심·P–Δ·비정형·부재값과 상태 그대로',()=>{
  const {model,review}=actual();model.preliminary.analysis=analysisFixture();const before=JSON.stringify({model,review});
  const r=calcReportFields(model,review),html=calcReportHtml(r);
  for (const dir of ['x','y']) {const key='analysis.dirs.'+dir+'.storeys.1.',expected=model.preliminary.analysis.dirs[dir].storeys[0];for (const k of ['deltaXe_mm','driftRatio','pDeltaSt','Ax','CR']) assert.deepEqual(r.fields[key+k].value,expected[k]);}
  const drift=r.sections[5].blocks.find(b=>b.title==='x 방향 층간변위');assert.equal(r.fields[drift.rows[0][2].field].value,4.567);
  assert.ok(html.includes('4.567'));assert.ok(html.includes('0.0011'));assert.ok(html.includes('54321.7'));assert.ok(html.includes('300.1'));
  assert.ok(r.references.includes('시험 해석 근거'));assert.ok(keys(r).includes('analysis.x.H1b'));
  assert.equal(r.fields['analysis.dirs.x.torsion.H1'].value,false);assert.equal(r.fields['analysis.dirs.x.torsion.H1b'].value,'');
  assert.equal(JSON.stringify({model,review}),before);
});
test('해석 한 방향·한 층·필드 누락은 질문·빈칸, 0·false는 보존',()=>{
  const {model,review}=actual();const a=analysisFixture();delete a.dirs.y;a.dirs.x.storeys[0].delta_mm=0;a.dirs.x.storeys[0].theta=null;a.dirs.x.storeys.pop();a.status='unsupported';model.preliminary.analysis=a;
  const r=calcReportFields(model,review),html=calcReportHtml(r);assert.equal(r.fields['analysis.status'].value,'unsupported');
  assert.equal(r.fields['analysis.dirs.x.storeys.1.delta_mm'].value,0);assert.equal(r.fields['analysis.dirs.x.storeys.1.theta'].value,'');assert.ok(keys(r).includes('analysis.dirs.x.storeys.5.delta_mm'));assert.ok(html.includes('y 방향 해석 미수행'));
});
test('ok/ng/hold/unsupported/scope/info와 fix를 숨기거나 재판정하지 않는다',()=>{
  const {model}=actual();const review=['ok','ng','hold','unsupported','scope','info'].map((st,i)=>({grp:'검토',item:'시험 상태 '+st,st,val:'원 결과 '+i,need:'원 필요',ref:'시험 조항',fix:['input','layout','member','calc','field',undefined][i]}));
  const r=calcReportFields(model,review),b=r.sections[8].blocks.find(b=>b.title==='ok 이외 항목 및 fix 종류');assert.equal(b.rows.length,5);assert.deepEqual(b.rows.map(x=>x[1]),['ng','hold','unsupported','scope','info']);
  const html=calcReportHtml(r);for(const st of ['ok','ng','hold','unsupported','scope','info'])assert.ok(html.includes('시험 상태 '+st));
});
test('HTML 이스케이프: project·review·해석·근거의 태그와 속성 모두 텍스트',()=>{
  const {model,review}=actual();const evil='<img src=x onerror="alert(1)"> & <script>bad()</script>';review[0]={...review[0],grp:evil,item:evil,ref:evil,val:evil,need:evil,fix:evil};model.preliminary.analysis=analysisFixture();model.preliminary.analysis.assumptions=[evil];model.preliminary.analysis.src=[evil];
  const html=calcReportHtml(calcReportFields(model,review,{공사명:evil,구조특기사항:evil}));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;img'));assert.ok(html.includes('&quot;alert(1)&quot;'));assert.ok(html.includes('&amp;'));
});
test('bridge 계산서는 도면·revision·실행 취소 변경 없이 HTML 또는 거절',async()=>{
  const {model,review}=actual(),engine=new DrawingEngine();engine.execute({type:'load',document:newDrawingDocument()});
  const context={engine,getDrawingId:()=> 'drawing',execute:()=>assert.fail('읽기 전용')},binding=createBridgeBinding(context);
  const target={...binding.current(),backend_generation:crypto.randomUUID(),snapshot_id:crypto.randomUUID()};binding.receive({protocol_version:1,backend_generation:target.backend_generation,target});
  const before=JSON.stringify(engine.doc),sync=createBoundRequestHandler(context,binding),handler=async request=>sync(request,await prepareComputeRequest(context,binding,request));
  const request=record=>({id:crypto.randomUUID(),expires_at:Date.now()+25000,action:'cad_structure_calc_report',args:{target,record}});
  const out=(await handler(request({model,review,input:input('A'),rulesVersion:'KDS 42:2022'})));assert.equal(out.error,undefined);assert.equal(out.result.ok,true);assert.equal(out.result.applied,false);assert.equal(out.result.sections.length,9);assert.ok(out.result.html.includes(CALC_REPORT_TITLE));assert.ok(out.result.html.includes('KDS 42:2022'));assert.ok(out.result.html.includes('원 입력 스냅샷 (record.input)'));assert.ok(!out.result.html.includes('원 입력 기록이 미제공'));
  const denied=(await handler(request({model:{...model,p:{...model.p,stories:2,...(model.p.floors?{floors:model.p.floors.slice(0,2)}:{})}},review})));assert.equal(denied.result.ok,false);assert.equal(denied.result.html,undefined);
  assert.equal(JSON.stringify(engine.doc),before);assert.equal(binding.current().revision,target.revision);
});

test('실제 부재·기초·필로티 결과: kN 1자리·mm·kN/m²·입력 두께 및 식 전사',()=>{
  const p=input('B');p.members={columns:[columnMember({Pu:1800})],walls:[wallMember({Vu:100})],flexure:[{id:'S1',kind:'slab',span_mm:4000,support:'simple',fy:400,density:2300,conditionConfirmed:true,thickness_mm:220}]};
  /* q=1000/5.76=173.611111; h550 기초의 실제 엔진 결과를 전사한다. */
  p.foundation=footingMember();p.pilotisDetails={...p.pilotisDetails,bmin:800,spacing:180,Mn:300,Ln:3,analysisShear:150,shearCapacity:190,capacityConfirmed:true};
  const model=CORE.generate(p),review=CORE.review(model),r=calcReportFields(model,review),html=calcReportHtml(r);
  for(const [item,k,unit] of [['기둥 축력 상한 C1','Po','kN'],['기둥 축력 상한 C1','phiPnMax','kN'],['벽 전단 참고 W1','Vc','kN'],['보·슬래브 두께 S1','minimum','mm'],['필로티 강도·전단','requiredShear','kN']]){
    const i=review.findIndex(row=>row.item===item),value=review[i].data[k],f=r.fields['review.data.'+i+'.'+k];assert.equal(f.value,value);assert.equal(f.unit,unit);assert.equal(f.digits,1);assert.ok(html.includes(value.toFixed(1)));
  }
  assert.equal(r.fields['p.members.flexure.0.thickness_mm'].value,220);assert.ok(html.includes('기둥 Po ='));assert.ok(html.includes('Ptotal'));assert.equal(r.fields['footingResults.0.data.soil.qmax'].value,model.preliminary.footingResults[0].data.soil.qmax);assert.equal(r.fields['footingResults.0.data.soil.qmax'].unit,'kN/m²');assert.equal(r.fields['foundation.B'].unit,'mm');
});
test('중첩 null과 부분 좌표는 알려진 값을 보존하며 누락 질문을 남긴다',()=>{
  const {model,review}=actual();const a=analysisFixture();a.dirs.x.storeys[0].CR.y=null;a.dirs.x.torsion.maxAvg[1]=null;a.dirs.x.softStorey.weak.ratios=[{level:1,ratio:null}];model.preliminary.analysis=a;
  const r=calcReportFields(model,review),html=calcReportHtml(r);assert.equal(r.fields['analysis.dirs.x.storeys.1.CR'].value.x,1.2);
  for(const k of ['analysis.dirs.x.storeys.1.CR.y','analysis.dirs.x.torsion.maxAvg.1','analysis.dirs.x.softStorey.weak.ratios.0.ratio'])assert.ok(keys(r).includes(k),k);
  assert.ok(html.includes('x: 1.200'));assert.ok(!html.includes('NaN'));assert.ok(!html.includes('Infinity'));
});

function htmlCell(html,key) {
  const opening='<td data-field="'+key+'">',index=html.indexOf(opening);
  assert.ok(index>=0,'표 셀 '+key);return html.slice(index+opening.length).split('</td>')[0];
}
const renderedRows=(html,title)=>{
  const index=html.indexOf('<caption>'+title+'</caption>');assert.ok(index>=0,'표 '+title);
  const table=html.slice(index).split('</table>')[0];
  return [...table.matchAll(/<tr>(.*?)<\/tr>/gs)].slice(1).map(m=>[...m[1].matchAll(/<td(?: [^>]*)?>(.*?)<\/td>/gs)].map(c=>c[1]));
};
test('주기 실제 계약 A/B/C: T와 Ta 모두 존재·별도 표 셀, 하나 누락해도 대체하지 않음',()=>{
  for (const kind of ['A','B','C']) {
    const {model,review,result:r}=actual(kind),q=model.preliminary.seismic.x,html=calcReportHtml(r);
    assert.ok(Object.hasOwn(q,'T'));assert.ok(Object.hasOwn(q.period,'Ta'));
    assert.equal(htmlCell(html,'seismic.x.T'),q.T.toFixed(4));
    assert.equal(htmlCell(html,'seismic.x.period.Ta'),q.period.Ta.toFixed(4));
    assert.ok(html.includes('채택 주기 T'));assert.ok(html.includes('약산주기 Ta'));
    q.T=.812345;const separated=calcReportHtml(calcReportFields(model,review));
    assert.equal(htmlCell(separated,'seismic.x.T'),'0.8123');assert.equal(htmlCell(separated,'seismic.x.period.Ta'),q.period.Ta.toFixed(4));
    delete q.T;const onlyTa=calcReportFields(model,review),onlyHtml=calcReportHtml(onlyTa);
    assert.equal(htmlCell(onlyHtml,'seismic.x.T'),'');assert.ok(keys(onlyTa).includes('seismic.x.T'));
    assert.equal(htmlCell(onlyHtml,'seismic.x.period.Ta'),q.period.Ta.toFixed(4));
  }
});
test('방향·층마다 고유한 해석값: storeys/forces/members 배열을 섞어도 실제 표 셀 전사',()=>{
  const {model,review}=actual();model.preliminary.analysis=analysisFixture();
  const expected=structuredClone(model.preliminary.analysis);
  for (const dir of ['x','y']) {
    const d=model.preliminary.analysis.dirs[dir];d.storeys=[d.storeys[3],d.storeys[0],d.storeys[4],d.storeys[1],d.storeys[2]];d.members.reverse();
    model.preliminary.seismic[dir].forces.forEach((f,i)=>{f.Fx=123.45+(dir==='x'?0:1000)+i*37;f.Vx=765.43+(dir==='x'?0:2000)+i*29;});
    model.preliminary.seismic[dir].forces.reverse();
  }
  const r=calcReportFields(model,review),html=calcReportHtml(r);
  for (const dir of ['x','y']) {
    for (const row of expected.dirs[dir].storeys) {
      const key='analysis.dirs.'+dir+'.storeys.'+row.level+'.';
      for (const k of ['deltaXe_mm','delta_mm','drift_mm','h_m','z_m','e_m','eAcc_m']) assert.equal(htmlCell(html,key+k),row[k].toFixed(3),dir+' '+row.level+' '+k);
      for (const k of ['Fx_kN','Vx_kN','K_kNm']) assert.equal(htmlCell(html,key+k),row[k].toFixed(1));
      for (const k of ['driftRatio','allowRatio','theta','thetaMax','driftSt','pDeltaSt']) assert.equal(htmlCell(html,key+k),String(typeof row[k]==='number'?Number(row[k].toPrecision(6)):row[k]));
      assert.equal(htmlCell(html,key+'Ax'),row.Ax.toFixed(4));
      for (const k of ['CR','CM']) assert.equal(htmlCell(html,key+k),'x: '+row[k].x.toFixed(3)+'; y: '+row[k].y.toFixed(3));
      const force=model.preliminary.seismic[dir].forces.find(f=>f.level===row.level);
      for (const k of ['Fx','Vx']) assert.equal(htmlCell(html,'seismic.'+dir+'.forces.'+(row.level-1)+'.'+k),force[k].toFixed(1));
    }
    const rows=renderedRows(html,dir+' 방향 부재별 횡력 분담');
    for (const member of expected.dirs[dir].members) {
      const row=rows.find(r=>r[0]===member.id);assert.ok(row);
      assert.deepEqual(row,[member.id,'wall',String(member.level),member.k_kNm.toFixed(1),member.share.toFixed(4),member.V_kN.toFixed(1),member.M_kNm.toFixed(1)]);
    }
    for (const k of ['maxAvg']) assert.equal(htmlCell(html,'analysis.dirs.'+dir+'.torsion.'+k),expected.dirs[dir].torsion[k].map(x=>x.toFixed(4)).join(' · '));
  }
});
test('실제 C 3층: 층고·층력·하중·중력축력 표 셀을 CORE 결과와 대조',()=>{
  const {model,result:r}=actual('C'),html=calcReportHtml(r);assert.equal(model.p.stories,3);
  for (let i=0;i<3;i++) {
    assert.equal(htmlCell(html,'floors.'+i+'.H'),model.p.floors[i].H.toFixed(3));
    for (const k of ['D','L','W']) assert.equal(htmlCell(html,'ledger.'+i+'.'+k),model.preliminary.ledger[i][k].toFixed(1));
    for (const dir of ['x','y']) for (const [k,digits] of [['hx',3],['wx',1],['k',4],['Cvx',4],['Fx',1],['Vx',1]]) assert.equal(htmlCell(html,'seismic.'+dir+'.forces.'+i+'.'+k),model.preliminary.seismic[dir].forces[i][k].toFixed(digits));
  }
  assert.equal(htmlCell(html,'gravity.C1.PuGravity'),'992.5');
});
test('CR/CM 필수 x·y와 배열 개수: 키 없는 부분 객체·빈 객체·빈 배열 누락',()=>{
  const {model,review}=actual();const a=analysisFixture();model.preliminary.analysis=a;
  a.dirs.x.storeys[0].CR={x:1.2};a.dirs.x.storeys[1].CM={};a.dirs.x.torsion.maxAvg=[];
  a.dirs.x.softStorey.ratios=[.9];a.dirs.x.softStorey.weak.ratios=[{level:1},{},null];
  const r=calcReportFields(model,review),html=calcReportHtml(r);
  for (const k of ['analysis.dirs.x.storeys.1.CR.y','analysis.dirs.x.storeys.2.CM.x','analysis.dirs.x.storeys.2.CM.y','analysis.dirs.x.torsion.maxAvg','analysis.dirs.x.torsion.maxAvg.4','analysis.dirs.x.softStorey.ratios.3','analysis.dirs.x.softStorey.weak.ratios.0.ratio','analysis.dirs.x.softStorey.weak.ratios.1.ratio']) assert.ok(keys(r).includes(k),k);
  assert.equal(htmlCell(html,'analysis.dirs.x.storeys.1.CR'),'x: 1.200; y: ');
  assert.equal(htmlCell(html,'analysis.dirs.x.storeys.2.CM'),'x: ; y: ');
  assert.equal(htmlCell(html,'analysis.dirs.x.torsion.maxAvg'),'');
});
test('중첩 NaN·±Infinity는 질문과 빈 셀로 처리, 0·false 보존',()=>{
  const {model,review}=actual();model.preliminary.analysis=analysisFixture();const d=model.preliminary.analysis.dirs.x;
  d.storeys[0].CR.y=NaN;d.storeys[0].theta=Infinity;d.storeys[0].delta_mm=-Infinity;d.storeys[0].CM={x:0,y:0};d.torsion.maxAvg[1]=Infinity;d.softStorey.ratios[0]=-Infinity;
  const r=calcReportFields(model,review),html=calcReportHtml(r);
  for(const k of ['analysis.dirs.x.storeys.1.CR.y','analysis.dirs.x.storeys.1.theta','analysis.dirs.x.storeys.1.delta_mm','analysis.dirs.x.torsion.maxAvg.1','analysis.dirs.x.softStorey.ratios.0']) assert.ok(keys(r).includes(k),k);
  assert.equal(htmlCell(html,'analysis.dirs.x.storeys.1.CR'),'x: 1.200; y: ');assert.equal(htmlCell(html,'analysis.dirs.x.storeys.1.CM'),'x: 0.000; y: 0.000');
  assert.equal(htmlCell(html,'analysis.dirs.x.storeys.1.theta'),'');assert.equal(htmlCell(html,'analysis.dirs.x.storeys.1.delta_mm'),'');assert.equal(htmlCell(html,'analysis.dirs.x.torsion.H1'),'무');
  assert.ok(!/NaN|Infinity/.test(html));
});
test('판정 경계 0.02004 > 0.02: 반올림 전 값과 ng를 표 셀에 보존',()=>{
  const {model,review}=actual();model.preliminary.analysis=analysisFixture();const row=model.preliminary.analysis.dirs.x.storeys[0];
  row.driftRatio=.02004;row.allowRatio=.02;row.driftSt='ng';row.theta=.100004;row.thetaMax=.1;row.pDeltaSt='ng';
  const html=calcReportHtml(calcReportFields(model,review));
  for (const [k,v] of [['driftRatio','0.02004'],['allowRatio','0.02'],['driftSt','ng'],['theta','0.100004'],['thetaMax','0.1'],['pDeltaSt','ng']]) assert.equal(htmlCell(html,'analysis.dirs.x.storeys.1.'+k),v);
  assert.ok(html.includes('판정은 반올림 전 엔진 값'));assert.ok(html.includes('drift(mm) / [1000 × h(m)]'));
});
test('변위 조건: 제공값/미제공·확인 필요를 방향·층별 표 셀에서 구분',()=>{
  const {model,review}=actual();model.preliminary.analysis=analysisFixture();const rows=model.preliminary.analysis.dirs.x.storeys;
  Object.assign(rows[0],{evaluationLocation:'X1 가장자리',axApplication:'Ax 적용 전',pDeltaIncluded:false});
  Object.assign(rows[1],{evaluationLocation:'X2 질량중심',axApplication:'Ax 적용 후',pDeltaIncluded:true});
  const r=calcReportFields(model,review),html=calcReportHtml(r),cells=renderedRows(html,'x 방향 변위 적용 조건');
  assert.deepEqual(cells[0],['1','X1 가장자리','Ax 적용 전','무']);assert.deepEqual(cells[1],['2','X2 질량중심','Ax 적용 후','유']);assert.deepEqual(cells[2],['3','미제공·확인 필요','미제공·확인 필요','미제공·확인 필요']);
  for (const k of ['evaluationLocation','axApplication','pDeltaIncluded']) assert.ok(keys(r).includes('analysis.dirs.y.storeys.1.'+k));
});
test('입력 qmax와 하중 출처: 원자료·확인·가정·경로 분리 및 부록 원값',()=>{
  const p=input('B');p.foundation={qmax:275};p.inputEvidence.foundation={source:'지반검토서 F-01',confirmed:false,assumption:'사용자 임시 반력'};
  const model=CORE.generate(p),review=CORE.review(model),r=calcReportFields(model,review),html=calcReportHtml(r),f=r.fields['foundation.qmax'];
  assert.equal(f.kind,'입력값');assert.equal(f.source,'지반검토서 F-01');assert.equal(f.confirmed,'미확인');assert.equal(f.assumption,'사용자 임시 반력');assert.equal(f.detail,'p.foundation.qmax');assert.equal(htmlCell(html,'foundation.qmax'),'275.000');
  const row=renderedRows(html,'기초 입력·해석 결과').find(r=>r[0]==='qmax');assert.deepEqual(row,['qmax','275.000','kN/m²','입력값','지반검토서 F-01','미확인','사용자 임시 반력','p.foundation.qmax']);
  for (const [k,v] of [['diaphragms.0.snow_kNm2','0.500'],['diaphragms.0.weightItems.equipment_kN','0.000'],['p.otherLoads.F','0.000'],['p.loadPaths.reactions.C1.D','750.000']]) assert.equal(htmlCell(html,k),v);
  assert.equal(r.fields['p.loadPaths.reactions.C1.D'].source,p.inputEvidence.loadPaths.source);
  assert.equal(r.fields['seismic.x.R'].detail,'preliminary.seismic.x.coeff.R');
});
test('4.3.3 일부 항목과 미작성 3행 추적, 별도 도서 문서·개정번호',()=>{
  const {result:r}=actual('A',{structuralPlanningDocument:'STR-001',structuralPlanningRevision:'R2'}),html=calcReportHtml(r);
  assert.ok(html.includes('KDS 41 10 05 4.3.3 일부 항목 초안'));
  const rows=renderedRows(html,'4.3.3 미작성 항목 추적');assert.equal(rows.length,3);assert.ok(rows.every(row=>row[1]==='미작성 — 별도 도서 필요'));
  assert.equal(rows[0][2],'STR-001');assert.equal(rows[0][3],'R2');
  for (const key of ['structuralPlanning','structuralSketches','structuralDetails']) assert.ok(keys(r).includes('documents.'+key));
});
test('빈 검토: all-ok 해당 항목 없음 / 미수행 / 명시한 부재 자료 누락',()=>{
  const {model}=actual();let review=[{item:'시험',st:'ok'}];let r=calcReportFields(model,review),html=calcReportHtml(r);
  assert.deepEqual(renderedRows(html,'ok 이외 항목 및 fix 종류'),[['해당 항목 없음']]);assert.ok(!keys(r).includes('review.9.ok 이외 항목 및 fix 종류'));
  assert.deepEqual(renderedRows(html,'벽 전단'),[['미수행/확인 필요']]);assert.ok(keys(r).includes('review.7.벽 전단'));
  model.p.members={walls:[{id:'W1'},{id:'W2'}]};review=[{item:'벽 전단 참고 W1',st:'ok'},{item:'벽 실제 전단 W1',st:'ok'}];
  r=calcReportFields(model,review);html=calcReportHtml(r);assert.deepEqual(renderedRows(html,'부재별 검토 자료 누락'),[['W2','벽 전단 참고 ','자료 누락'],['W2','벽 실제 전단 ','자료 누락']]);
  r=calcReportFields(model,[{item:'시험',st:'ok'}]);assert.deepEqual(renderedRows(calcReportHtml(r),'벽 전단'),[['자료 누락']]);
});
test('부록 원 입력·정규화 입력·실제 버전과 이스케이프, 미제공을 추정하지 않음',()=>{
  const raw=input('C');raw.note='<script>원 입력</script> & "기록"';const before=JSON.stringify(raw),model=CORE.generate(raw),review=CORE.review(model);
  const record={input:raw,rulesVersion:'KDS 42:2022',programVersion:'7.0.11'};
  const r=calcReportFields(model,review,{},record),html=calcReportHtml(r);
  assert.equal(r.inputSnapshot,JSON.stringify(raw,null,2));assert.equal(r.engineInputSnapshot,JSON.stringify(model.p,null,2));assert.equal(JSON.parse(r.inputSnapshot).stories,1);assert.equal(JSON.parse(r.engineInputSnapshot).stories,3);
  assert.equal(htmlCell(html,'versions.RULES_VERSION'),record.rulesVersion);assert.equal(htmlCell(html,'versions.program'),record.programVersion);assert.equal(htmlCell(html,'versions.report'),CALC_REPORT_VERSION);
  assert.equal(htmlCell(html,'versions.engine'),'');assert.ok(keys(r).includes('versions.engine'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('&quot;note&quot;'));assert.ok(html.includes('\\&quot;기록\\&quot;'));assert.equal(JSON.stringify(raw),before);
  const missing=calcReportFields(model,review,{rulesVersion:'추정금지',programVersion:'추정금지'});assert.equal(missing.fields['versions.RULES_VERSION'].value,'');assert.equal(missing.inputSnapshot,null);assert.ok(keys(missing).includes('record.input'));
});

test('세부 dotted inputEvidence를 그룹 출처보다 우선하며 false·빈 가정도 보존',()=>{
  const {model,review}=actual('B');model.p.foundation={qmax:275};
  model.p.inputEvidence.foundation={source:'그룹 지반자료',confirmed:true,assumption:false};
  model.p.inputEvidence['foundation.qmax']={source:'세부 실측 전',confirmed:false,assumption:'잠정 qmax'};
  const r=calcReportFields(model,review),row=renderedRows(calcReportHtml(r),'기초 입력·해석 결과').find(x=>x[0]==='qmax');
  assert.deepEqual(row.slice(4,7),['세부 실측 전','미확인','잠정 qmax']);
  assert.equal(r.fields['foundation.qa'].source,'그룹 지반자료');assert.equal(r.fields['foundation.qa'].confirmed,'확인');assert.equal(r.fields['foundation.qa'].assumption,false);
});

test('빈 floors·analysis 객체도 누락이며 빈 목록을 해당 없음으로 오인하지 않음',()=>{
  const {model,review}=actual();model.p.floors=[];model.preliminary.analysis={};
  const r=calcReportFields(model,review.filter(r=>!/필로티/.test(r.item))),html=calcReportHtml(r);
  assert.deepEqual(renderedRows(html,'필로티'),[['미수행/확인 필요']]);assert.equal(htmlCell(html,'analysis.method'),'');
  assert.ok(keys(r).includes('analysis.method'));assert.ok(keys(r).includes('analysis.dirs.x.storeys.1.CR.x'));assert.ok(keys(r).includes('analysis.dirs.x.storeys.1.CR.y'));
});

test('7장 실제 부재 수요·설계강도·비율·상태·근거 셀은 엔진 값 전사',()=>{
  const p=input('C');p.members={columns:[columnMember()],walls:[wallMember()],beams:[beamMember()]};
  const model=CORE.generate(p),review=CORE.review(model),before=JSON.stringify({model,review}),r=calcReportFields(model,review),html=calcReportHtml(r);
  const table=r.sections[6].blocks.find(b=>b.title==='부재별 수요·설계강도·제안 단면');assert.equal(table.rows.length,model.preliminary.memberResults.length);
  model.preliminary.memberResults.forEach((m,i)=>{
    const row=table.rows[i];assert.equal(row[0],m.id);assert.equal(row[1],m.level);assert.deepEqual(r.fields[row[2].field].value,m.demand);
    assert.deepEqual(r.fields[row[3].field].value,m.checks.filter(c=>c.capacity!=null).map(c=>({item:c.item,capacity:c.capacity})));
    assert.equal(r.fields[row[3].field].detail,'preliminary.memberResults.'+i+'.checks[].capacity');assert.equal(r.fields[row[4].field].value,m.ratio);assert.equal(htmlCell(html,row[5].field),m.st);assert.deepEqual(r.fields[row[6].field].value,m.src);
    assert.ok(r.sections[6].blocks.some(b=>b.title===m.id+' '+m.level+'층 부재 검토값'));
  });assert.equal(JSON.stringify({model,review}),before);
});
test('7장 제안 단면과 hold 셀, 누락값은 빈칸+질문; 8장 미입력 기초와 사용반력',()=>{
  const p=input('C'),c=columnMember({design:{minB:400,maxB:400,minH:400,maxH:400,barCandidates:['D22'],countCandidates:[8],tieSpacingCandidates:[150]}});for(const k of ['b','h','bar','nx','ny'])delete c[k];p.members={columns:[c]};
  const model=CORE.generate(p),review=CORE.review(model),r=calcReportFields(model,review),html=calcReportHtml(r),table=r.sections[6].blocks.find(b=>b.title==='부재별 수요·설계강도·제안 단면');
  assert.equal(htmlCell(html,table.rows[0][5].field),'hold');assert.equal(r.fields[table.rows[0][7].field].value.b,400);assert.match(htmlCell(html,table.rows[0][7].field),/400/);
  const ft=r.sections[7].blocks.find(b=>b.title==='기초별 수요·설계강도·제안 단면');assert.equal(htmlCell(html,ft.rows[0][2].field),'');assert.ok(keys(r).includes(ft.rows[0][2].field));
  const reactions=r.sections[7].blocks.find(b=>b.title==='기둥 하부 사용하중 반력');assert.equal(reactions.rows[0][0],'C1');assert.equal(model.preliminary.footingDemands[0].Nservice,null);assert.equal(r.fields[reactions.rows[0][3].field].value,'');assert.ok(r.missing.find(q=>q.key===reactions.rows[0][3].field)?.question);
  delete model.preliminary.memberResults[0].ratio;delete model.preliminary.memberResults[0].demand;const missing=calcReportFields(model,review);assert.equal(missing.fields['memberResults.0.ratio'].value,'');assert.equal(missing.fields['memberResults.0.demand'].value,'');assert.ok(keys(missing).includes('memberResults.0.ratio'));assert.ok(missing.missing.find(q=>q.key==='memberResults.0.demand').question);
});

test('기둥 Ln은 mm, 기존 필로티 상세 Ln은 m로 경로별 출력',()=>{
  const p=input('C');p.members={columns:[columnMember({Ln:3000})]};p.pilotisDetails={Ln:3};
  const model=CORE.generate(p),review=CORE.review(model);review.push({grp:'필로티',item:'필로티 입력 Ln',st:'info',val:'시험 원값',ref:'시험 조항',data:{Ln:3}});const r=calcReportFields(model,review);assert.equal(r.fields['p.members.columns.0.Ln'].value,3000);assert.equal(r.fields['p.members.columns.0.Ln'].unit,'mm');assert.equal(r.fields['review.data.'+(review.length-1)+'.Ln'].value,3);assert.equal(r.fields['review.data.'+(review.length-1)+'.Ln'].unit,'m');
});

test('8장 실제 기초 P/M·Pu/Mu·설계강도·비율·보류와 적용 입력은 엔진 값 전사',()=>{
  /* 사용 P1000/A5.76=173.611111<qa200. h550 실제 rho: Vu1220.612164<φVc1291.065845.
   * 강도 sizing ok이나 정착 검토는 hold다. 입력·출력의 mm/kN/MPa를 구분한다. */
  const p=input('C');p.foundation=footingMember({anchorageConfirmed:false});
  const model=CORE.generate(p),review=CORE.review(model),before=JSON.stringify({model,review}),r=calcReportFields(model,review),html=calcReportHtml(r),f=model.preliminary.footingResults[0];
  const table=r.sections[7].blocks.find(b=>b.title==='기초별 수요·설계강도·제안 단면'),row=table.rows[0];
  assert.deepEqual(r.fields[row[2].field].value,f.demand);assert.equal(r.fields[row[4].field].value,f.ratio);assert.equal(htmlCell(html,row[5].field),'hold');
  assert.deepEqual(r.fields[row[3].field].value,f.checks.filter(c=>c.capacity!=null).map(c=>({item:c.item,capacity:c.capacity})));assert.deepEqual(r.fields[row[6].field].value,f.src);
  for(const [k,v] of Object.entries(f.data.soil))if(r.fields['footingResults.0.data.soil.'+k])assert.equal(r.fields['footingResults.0.data.soil.'+k].value,v,k);
  assert.equal(htmlCell(html,'footingResults.0.data.soil.qmax'),'173.611111');assert.equal(r.fields['footingResults.0.data.soil.qmax'].unit,'kN/m²');
  for(const [k,u] of [['P','kN'],['M','kN·m'],['Pu','kN'],['Mu','kN·m'],['B','mm'],['L','mm'],['h','mm'],['fck','MPa'],['fy','MPa']]){const field=r.fields['footingResults.0.data.input.'+k];assert.equal(field.value,f.data.input[k],k);assert.equal(field.unit,u,k);assert.equal(field.detail,'preliminary.footingResults.0.data.input.'+k);}
  assert.equal(htmlCell(html,'foundation.anchorageConfirmed'),'무');assert.equal(htmlCell(html,'foundation.serviceFootingIncluded'),'무');assert.equal(htmlCell(html,'foundation.serviceFootingWeight'),'0.000');
  f.checks.forEach((c,j)=>{for(const k of ['demand','capacity','ratio','st','ref'])assert.equal(r.fields['footingResults.0.checks.'+j+'.'+k].value,c[k]??'');});
  assert.ok(keys(r).includes('footingResults.0.missing.developmentLength'));assert.equal(JSON.stringify({model,review}),before);
});
test('8장 설계 제안과 qa 미상/확정 ng는 실제 기초 상태·빈값·질문을 보존',()=>{
  const p=input('C');p.foundation=footingProposal();let model=CORE.generate(p),review=CORE.review(model),r=calcReportFields(model,review),html=calcReportHtml(r);
  let table=r.sections[7].blocks.find(b=>b.title==='기초별 수요·설계강도·제안 단면');assert.equal(r.fields[table.rows[0][7].field].value.B,2400);assert.match(htmlCell(html,table.rows[0][7].field),/550/);assert.equal(htmlCell(html,table.rows[0][5].field),'hold');assert.equal(htmlCell(html,'foundation.B'),'');assert.equal(p.foundation.B,undefined);
  p.foundation=footingMember();delete p.foundation.qa;model=CORE.generate(p);review=CORE.review(model);r=calcReportFields(model,review);html=calcReportHtml(r);
  assert.equal(model.preliminary.footingResults[0].st,'hold');assert.equal(review.find(x=>x.item==='기초 지내력').fix,'field');assert.equal(htmlCell(html,'footingResults.0.data.soil.qmax'),'');assert.ok(keys(r).includes('footingResults.0.missing.qa'));
  /* 같은 입력에서 h500이면 punching 1240.885428>1170.790591: qa 미상보다 ng 우선. */
  p.foundation.h=500;model=CORE.generate(p);review=CORE.review(model);r=calcReportFields(model,review);html=calcReportHtml(r);assert.equal(htmlCell(html,'footingResults.0.st'),'ng');assert.ok(keys(r).includes('footingResults.0.missing.qa'));
});
