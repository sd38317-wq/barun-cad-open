import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {certificateFields,certificateHtml} from './structure-certificate.js';
import {DrawingEngine,newDrawingDocument} from './engine.js';
import {createBridgeBinding,createBoundRequestHandler} from './bridge-client.js';

// 저장된 서버 표본이 아니라 이 가지의 실제 CORE를 실행해 모델·검토를 만든다.
const prototype=readFileSync(new URL('./docs/structure/prototype.html',import.meta.url),'utf8');
const source=prototype.split('/*CORE-START*/')[1]?.split('/*CORE-END*/')[0];
assert.ok(source,'CORE 구간이 있어야 한다');
const dependencies=['midrise.js','midrise-analysis.js','member-common.js','member-column.js','member-wall.js','member-beam.js','member-footing.js','member-demand.js'].map((f)=>readFileSync(new URL('./docs/structure/'+f,import.meta.url),'utf8')).join('\n');
const CORE=new Function(dependencies+'\n'+source+';return {generate,review,quantities};')();
const BASE={system:'rc',X:10,Y:9,stories:2,H:3.3,target:6,roof:'flat',pitch:25,stairs:'none',stairW:1,use:'house',snow:'normal',wind:'normal',slope:0,Fe:150,soilOk:true,species:'가',grade:2,openH:2.1};
function actual(changes={},project={}){const model=CORE.generate({...BASE,...changes}),review=CORE.review(model);return {model,review,result:certificateFields(model,review,project)};}
const keys=r=>r.missing.map(m=>m.key);
const outline=[[0,0],[10,0],[10,9],[0,9]];
const floors=[{name:'1층',H:3.3,outline},{name:'2층',H:3.3,outline}];

 test('RC 10×9 2층: 실제 검토·부재·누락·출처, 원 모델 보존',()=>{
  const {model,review,result:r}=actual({}, {공사명:'검증 공사',대지위치:'검증 대지'});
  assert.equal(r.ok,true);assert.equal(r.chapter,1);
  assert.equal(r.fields.projectName.value,'검증 공사');assert.equal(r.fields.projectName.source,'project 입력');
  assert.equal(r.fields.stories.value,2);assert.equal(r.fields.stories.source,'엔진 값');
  assert.equal(r.fields.totalArea.value,parseFloat(review.find(f=>f.item==='연면적').val));
  assert.equal(r.fields.snowExcess.value,'무');assert.equal(r.fields.windExcess.value,'무');
  assert.equal(r.fields.deadLoadExcess.value,'');assert.equal(r.fields.deadLoadExcess.status,'작성자 확인');
  assert.ok(keys(r).includes('deadLoadExcess'));assert.ok(keys(r).includes('author'));assert.ok(keys(r).includes('signature'));assert.ok(keys(r).includes('licenseNumber'));
  assert.ok(!keys(r).includes('projectName'));assert.equal(r.fields.author.value,'');assert.equal(r.fields.author.source,'작성자 기입');
  const b=model.members.filter(m=>m.kind==='beam'&&m.type==='B'),c=model.members.filter(m=>m.kind==='column'&&m.level===1);
  assert.equal(r.fields.beamBSpan.value,Math.max(...b.map(m=>m.L)));assert.ok(b.some(m=>m.b===r.fields.beamBb.value&&m.h===r.fields.beamBh.value));
  assert.equal(r.fields.column1Area.value,Math.max(...c.map(m=>m.Acum)));
  assert.equal(r.fields.slabThickness.value,Math.max(...model.members.filter(m=>m.kind==='slab').map(m=>m.t)));
  const before=structuredClone({model,review});certificateFields(model,review,{});assert.deepEqual({model,review},before);
  assert.ok(r.missing.every(m=>m.key&&m.label&&m.question));assert.ok(Object.values(r.fields).every(f=>['엔진 값','검토 항목','project 입력','작성자 기입'].includes(f.source)));
 });
 test('floors: 위아래 연속·캔틸레버 검토에서 체크와 길이를 옮긴다',()=>{
  const {model,review,result:r}=actual({floors});assert.equal(r.ok,true,JSON.stringify(r.reasons));
  assert.equal(r.fields.verticalDiscontinuity.value,'무');assert.equal(r.fields.verticalDiscontinuity.source,'검토 항목');
  assert.equal(r.fields.cantilever.value,'무');assert.equal(r.fields.cantileverLength.value,0);
  assert.ok(r.fields.verticalDiscontinuity.evidence.some(f=>f.item==='위아래 연속(기둥)'));
  for(const [dir,key] of [['x','wallx1'],['y','wally1']])assert.equal(r.fields[key].value,model.members.filter(m=>m.kind==='wall'&&m.level===1&&m.dir===dir).reduce((a,m)=>a+m.len,0));
  assert.ok(review.some(f=>f.item.includes('캔틸레버')));
 });
 test('구형 입력에 없는 층별 검토는 확인으로 남기며 project로 보충할 수 있다',()=>{
  const {result:r}=actual();assert.ok(keys(r).includes('verticalDiscontinuity'));assert.ok(keys(r).includes('cantileverLength'));
  const project={verticalDiscontinuity:false,cantilever:true,cantileverLength:1.2,sameStructuralSystem:true,deadLoadExcess:'무',liveLoadExcess:false};
  const {result:s}=actual({},project);assert.equal(s.ok,true);assert.equal(s.fields.cantileverLength.value,1.2);assert.equal(s.fields.cantilever.value,'유');assert.equal(s.fields.deadLoadExcess.source,'project 입력');
  for(const key of Object.keys(project))assert.ok(!keys(s).includes(key),key);
 });
 test('범위 밖·부적합·검토 없음은 확인서를 만들지 않는다',()=>{
  for(const change of [{stories:3},{X:30,Y:20,stories:1},{snow:'heavy'},{use:'other'}]){const {result:r}=actual(change);assert.equal(r.ok,false);assert.match(r.reason,/구조계산 필요/);assert.ok(r.reasons.length);assert.throws(()=>certificateHtml(r));}
  const {model}=actual();assert.equal(certificateFields(model,[]).ok,false);
 });
 test('project 보충 답변도 적용제한을 넘으면 거절한다',()=>{
  for(const project of [{deadLoadExcess:'유'},{liveLoadExcess:true},{verticalDiscontinuity:'유'},{sameStructuralSystem:'무'},{cantileverLength:1.501},{basementStories:1}])assert.equal(actual({},project).result.ok,false,JSON.stringify(project));
  assert.throws(()=>actual({}, {deadLoadExcess:'아마 무'}),/유\/무/);
 });
 test('steel: 제3장, 실제 H형강·부하면적·층별 가새 수·각도',()=>{
  const {model,result:r}=actual({system:'steel'});assert.equal(r.ok,true);assert.equal(r.chapter,3);
  const bs=model.members.filter(m=>m.kind==='beam'&&m.type==='B');for(const m of bs)assert.ok(r.fields.beamBSections.value.includes(m.sec));
  assert.equal(r.fields.column1Area.value,Math.max(...model.members.filter(m=>m.kind==='column'&&m.level===1).map(m=>m.A)));
  assert.equal(r.fields.braceExists.value,'유');assert.equal(r.fields.shearWallExists.value,'무');
  assert.match(r.fields.bracexCount.value,/1층 \d+개\n2층 \d+개/);assert.match(certificateHtml(r),/\(제3장\)/);
  assert.ok(keys(r).includes('steelStrength'));assert.equal(r.fields.roofConstruction.value,'철근콘크리트지붕');
 });
 test('wood: 제5장, 실제 장선·서까래·스터드·기초, 없는 목재·덮개는 누락',()=>{
  const {model,result:r}=actual({system:'wood',H:3,roof:'gable'});assert.equal(r.ok,true,JSON.stringify(r.reasons));assert.equal(r.chapter,5);
  assert.equal(r.fields.frameType.value,'경골목구조');assert.equal(r.fields.roofSpan.value,Math.max(...model.members.filter(m=>m.kind==='rafters').map(m=>m.run)));
  assert.equal(r.fields.footWidth.value,Math.max(...model.members.filter(m=>m.kind==='stripW').map(m=>m.footW)));
  assert.ok(keys(r).includes('woodSpecies'));assert.ok(keys(r).includes('roofSheathing'));assert.ok(!keys(r).includes('beamSpacingMax'));assert.ok(!keys(r).some(k=>k.startsWith('cell_')));
  assert.match(certificateHtml(r),/\(제5장\)/);assert.match(r.fields.floorTable.value,/표 4.1-1/);
 });
 test('단면 폭·깊이는 실제 한 부재의 쌍을 보존한다',()=>{
  const {model,review}=actual();const beams=model.members.filter(m=>m.kind==='beam'&&m.type==='B');beams[0].b=500;beams[0].h=450;beams[1].b=300;beams[1].h=700;
  const r=certificateFields(model,review);assert.ok(beams.some(m=>m.b===r.fields.beamBb.value&&m.h===r.fields.beamBh.value));assert.ok(Array.isArray(r.fields.beamBMembers.value));
 });
 test('HTML: 원문 머리글·서명란·원본 전체 병합 좌표·A4와 글꼴',()=>{
  const txt=readFileSync(new URL('./docs/structure/forms/별지제3호서식_구조안전 및 내진설계 확인서(소규모건축물).txt',import.meta.url),'utf8');
  for(const system of ['rc','steel','wood']){
    const r=actual({system,...(system==='wood'?{H:3,roof:'gable'}:{})}).result,html=certificateHtml(r),cells=r.table.rows.flat();
    assert.match(html,/\[별지 제3호서식\]/);assert.ok(html.includes('(제'+r.chapter+'장)'));assert.match(html,/size:A4 portrait/);assert.match(html,/NanumGothic/);assert.match(html,/작성자\(설계자\)/);
    const part=txt.split('### (제'+r.chapter+'장)')[1].split('\n### ')[0].split('#### [표-B]')[1];
    const expected=[...part.matchAll(/\[R(\d+)C(\d+),rs=(\d+),cs=(\d+)\]/g)].map(m=>m.slice(1).map(Number));
    assert.deepEqual(cells.map(c=>[c.row,c.column,c.rowspan,c.colspan]),expected);
    const slots=new Set();for(const c of cells)for(let row=c.row;row<c.row+c.rowspan;row++)for(let col=c.column;col<c.column+c.colspan;col++){const key=row+','+col;assert.ok(!slots.has(key));slots.add(key);}
    assert.equal(slots.size,r.table.rowHeights.length*r.table.columnWidths.length);assert.ok(r.table.rowHeights.reduce((a,b)=>a+b,0)<277);
  }
 });
 test('project 행정 입력은 출력하지만 태그·외부 참조로 해석하지 않는다',()=>{
  const {result:r}=actual({}, {공사명:'<img src=x onerror=alert(1)>',작성자:'가상 작성자',주소:'<script>bad()</script>',작성일:'2026년 10월 16일'});const html=certificateHtml(r);
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script>'));assert.ok(!keys(r).includes('author'));assert.ok(keys(r).includes('signature'));
 });
 test('bridge certificate는 도면·실행 취소·revision을 바꾸지 않고 결과 또는 거절을 돌려준다',()=>{
  const {model,review}=actual(),engine=new DrawingEngine();engine.execute({type:'load',document:newDrawingDocument()});
  const context={engine,getDrawingId:()=> 'drawing',execute:()=>assert.fail('출력은 도면을 바꾸지 않는다')};const binding=createBridgeBinding(context);
  const target={...binding.current(),backend_generation:crypto.randomUUID(),snapshot_id:crypto.randomUUID()};binding.receive({protocol_version:1,backend_generation:target.backend_generation,target});
  const before=JSON.stringify(engine.doc),handler=createBoundRequestHandler(context,binding);
  function request(record){return {id:crypto.randomUUID(),expires_at:Date.now()+25000,action:'cad_structure_certificate',args:{target,record}};}
  const out=handler(request({model,review}));assert.equal(out.error,undefined);assert.equal(out.result.ok,true);assert.equal(out.result.applied,false);assert.match(out.result.html,/제1장/);assert.ok(out.result.table);
  const ng=actual({stories:3});const denied=handler(request({model:ng.model,review:ng.review}));assert.equal(denied.result.ok,false);assert.equal(denied.result.html,undefined);
  assert.equal(JSON.stringify(engine.doc),before);assert.equal(binding.current().revision,target.revision);
 });
