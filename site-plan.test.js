import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const OUT=path.join(os.tmpdir(),'barun-cad-tests','site-plan-import-check');   // 검사 산출물은 소스 트리(tmp/)가 아니라 OS 임시 폴더에 쓴다
import {DrawingEngine} from './engine.js';
import {refreshSunlightDrawing} from './site-plan.js';
import {attachSitePlan,attachAlternativePlans,generateAlternativePlans,generatePlanVariants,validationPayload,sitePlanStatus,revalidateSitePlan,planSummary} from './site-plan.js';
const read=name=>JSON.parse(readFileSync(new URL('./test-fixtures/site-plan-v053/'+name,import.meta.url),'utf8'));
const fixtures=[['DEMO-CORNER-01','demo_site.json'],['DEMO-NORTHROAD-02','demo_site_north_road.json'],['DEMO-NARROW-03','demo_site_narrow.json'],['DEMO-PARK-04','demo_site_park.json'],['DEMO-FLAG-05','demo_site_flag.json']];
test('building overview contains actual plan figures as independent objects outside the plan',()=>{
 const doc=build(...fixtures[0]),items=doc.entities.filter(e=>e.buildingOverview),texts=items.filter(e=>e.type==='text').map(e=>e.text);
 assert.ok(texts.includes('건축개요'));assert.ok(texts.includes('산정 대지면적'));assert.ok(texts.includes('구조 · 지하층'));
 assert.ok(texts.includes(doc.sitePlan.report.numbers.building_area.toLocaleString('ko-KR',{maximumFractionDigits:2})+' ㎡'));
 assert.ok(items.every(e=>e.type==='text'||e.type==='line'));
 const oldMax=Math.max(...doc.entities.filter(e=>!e.buildingOverview&&!e.sunlightDrawing).flatMap(e=>(e.points||[]).map(p=>p.x)));
 assert.ok(items.every(e=>(e.position?.x??e.points[0].x)>oldMax));
 assert.ok(!texts.some(t=>/NaN|undefined/.test(t)));
});
const build=(name,input,current=new DrawingEngine().doc)=>{const raw=read(input),request={site:raw.site,zoning:raw.zoning,program:raw.program,output:raw.output};return attachSitePlan(current,request,{entities:read(name+'_entities.json'),report:read(name+'_report.json')});};
test('sunlight sheet is required and follows edited floors',()=>{
 const doc=build(...fixtures[0]),sheet=doc.sitePlan.sunlightDrawing;assert.ok(sheet.limits.length);
 const limits=doc.entities.filter(e=>e.sunlightLimit);assert.ok(limits.length>=4);assert.ok(limits.every(e=>e.type==='polyline'&&e.constantWidth===50&&e.color==='#ff0000'&&e.linetype==='DASHED'));
 const sectionLimits=limits.filter(e=>e.sunlightSection);assert.equal(sectionLimits.length,1);const points=sectionLimits[0].points;assert.equal(points.length,4);assert.equal(sectionLimits[0].closed,false);assert.equal(points[1].y,points[2].y);assert.equal(points[2].x-points[1].x,3500);assert.equal(points[1].y-points[0].y,10000);
 const copy=doc.entities.find(e=>e.sunlightSourceId),original=doc.entities.find(e=>e.id===copy.sunlightSourceId);original.points[0].x+=100;
 refreshSunlightDrawing(doc);assert.equal(copy.points[0].x,original.points[0].x+sheet.dx);
 doc.entities=doc.entities.filter(e=>e.id!==sheet.entityIds[0]);assert.throws(()=>refreshSunlightDrawing(doc),/삭제/);
 const result={entities:read('DEMO-CORNER-01_entities.json'),report:read('DEMO-CORNER-01_report.json')};result.entities.entities=result.entities.entities.filter(e=>e.layer!=='A-ENV-SUN');
 assert.throws(()=>attachSitePlan(new DrawingEngine().doc,read('demo_site.json'),result),/한계선/);
});
test('non-applicable sunlight adds neither review layer nor review entities',()=>{
 const result={entities:read('DEMO-CORNER-01_entities.json'),report:read('DEMO-CORNER-01_report.json')};result.report.sunlight.applies=false;
 const doc=attachSitePlan(new DrawingEngine().doc,read('demo_site.json'),result);
 assert.equal(doc.sitePlan.sunlightDrawing.applies,false);assert.ok(!doc.entities.some(e=>e.sunlightDrawing));assert.ok(!doc.layers.some(l=>l.name.startsWith('일조검토도')));refreshSunlightDrawing(doc);
});
test('three objectives preserve explicit floors, disclose duplicates, and keep each validation geometry',async()=>{
 const request=read('demo_site.json');request.zoning={...request.zoning,bcr:60,far:220};const calls=[];
 const result={entities:read('DEMO-CORNER-01_entities.json'),report:read('DEMO-CORNER-01_report.json')};result.report.alternatives=[];
 const plans=await generateAlternativePlans(request,async(route,r)=>{if(route==='site-plan/jobs')throw Object.assign(Error('미지원'),{status:404});calls.push(structuredClone(r));return structuredClone(result);},{fixedFloors:true});
 assert.equal(calls.length,3);assert.ok(calls.every(r=>r.program.floors===request.program.floors&&r.program.floors_search===false));
 assert.equal(calls[2].program.parking.layout,'single');assert.match(plans[1].note,/동일/);
 const doc=attachAlternativePlans(new DrawingEngine().doc,plans);new DrawingEngine().execute({type:'load',document:doc});assert.equal(doc.sitePlanAlternatives.length,3);
 for(const s of doc.sitePlanAlternatives){doc.sitePlan=s;assert.deepEqual(validationPayload(doc).overrides,result.report.geometry);assert.ok(doc.entities.some(e=>e.sitePlanId===s.id&&e.buildingOverview));}
});
for(const [name,input] of fixtures)test(name+' imports all entities and round-trips original polygon geometry exactly',()=>{
 const doc=build(name,input),e=new DrawingEngine();e.execute({type:'load',document:doc});
 assert.deepEqual(validationPayload(e.doc).overrides,read(name+'_report.json').geometry);
 assert.equal(sitePlanStatus(e.doc).stale,false);assert.equal(doc.layers.length,15);
 assert.ok(doc.entities.some(e=>e.type==='text'&&e.text.includes('지적측량 성과 아님')));
 assert.equal(doc.sitePlan.scale,200);
 mkdirSync(OUT,{recursive:true});writeFileSync(path.join(OUT,name+'.json'),JSON.stringify(doc));
});
test('six-vertex footprint is edited without rectangle conversion; coincident floors remain independently editable',()=>{
 const doc=build(...fixtures[1]),s=doc.sitePlan,b=s.bindings.find(b=>b.path.join('.')==='floors.2');
 const e=new DrawingEngine();e.execute({type:'load',document:doc});const before=validationPayload(e.doc);
 e.execute({type:'move',ids:[b.entityId],dx:3000,dy:-1000});const after=validationPayload(e.doc);
 assert.equal(after.overrides.floors[2].length,6);assert.equal(after.overrides.floors[2][0][0],before.overrides.floors[2][0][0]+3);
 assert.deepEqual(after.overrides.footprint,before.overrides.footprint);assert.deepEqual(after.overrides.floors[1],before.overrides.floors[1]);assert.equal(sitePlanStatus(e.doc).stale,true);
 e.execute({type:'undo'});assert.equal(sitePlanStatus(e.doc).stale,false);
});
test('parking movement preserves group and tandem; API receives source CRS m and report flags are retained',async()=>{
 const doc=build(...fixtures[1]),s=doc.sitePlan,b=s.bindings.find(b=>b.path.join('.')==='stalls.0.rect'),entity=doc.entities.find(e=>e.id===b.entityId);
 entity.points=entity.points.map(p=>({x:p.x,y:p.y-30000}));const expected=validationPayload(doc);assert.equal(expected.overrides.stalls[0].tandem,true);assert.equal(expected.overrides.stalls[0].group,0);
 const report={mode:'validate',geometry:expected.overrides,numbers:{building_area:100,gfa:400},all_ok:false,checks:[{rule:'구획 도로 접근',ok:false,provisional:false},{rule:'건폐율',ok:true,provisional:true}],provisional_rules:['건폐율']};
 const state=await revalidateSitePlan(doc,async(route,payload)=>{assert.equal(route,'site-plan/validate');assert.deepEqual(payload,expected);return report;});
 assert.equal(doc.sitePlan.report.all_ok,true);assert.equal(sitePlanStatus(doc).stale,true);doc.sitePlan=state;assert.equal(sitePlanStatus(doc).stale,false);assert.deepEqual(state.report,report);assert.match(planSummary(report),/구획 도로 접근/);
 const engine=new DrawingEngine();engine.execute({type:'load',document:doc});engine.execute({type:'document.update',changes:{sitePlanInput:doc.sitePlan.request,sitePlan:{...state,report:{...report,all_ok:true}}}});assert.equal(engine.doc.sitePlan.report.all_ok,true);assert.deepEqual(engine.doc.sitePlanInput,doc.sitePlan.request);engine.execute({type:'undo'});assert.equal(engine.doc.sitePlan.report.all_ok,false);
 mkdirSync(OUT,{recursive:true});writeFileSync(path.join(OUT,'parking-behind.json'),JSON.stringify(expected));
});
test('failed validation leaves old report, deleted or opened boundaries fail rather than reuse original geometry',async()=>{
 const doc=build(...fixtures[1]),before=JSON.stringify(doc);await assert.rejects(()=>revalidateSitePlan(doc,async()=>{throw Error('offline');}));assert.equal(JSON.stringify(doc),before);
 const b=doc.sitePlan.bindings[0],e=doc.entities.find(e=>e.id===b.entityId);e.closed=false;assert.throws(()=>validationPayload(doc),/열렸습니다/);doc.entities=doc.entities.filter(e=>e.id!==b.entityId);assert.throws(()=>validationPayload(doc),/삭제/);
});
test('copied tracked objects and changed cadastral context cannot silently reuse old judgement',()=>{
 const e=new DrawingEngine();e.execute({type:'load',document:build(...fixtures[1])});
 e.execute({type:'copy',ids:[e.doc.sitePlan.bindings[0].entityId],dx:2000,dy:0});assert.throws(()=>validationPayload(e.doc),/복사된/);e.execute({type:'undo'});
 e.execute({type:'move',ids:[e.doc.sitePlan.contextGeometry[0].entityId],dx:1000,dy:0});assert.throws(()=>validationPayload(e.doc),/대지·주변/);
});
test('placement offset preserves pre-existing geometry and million-metre CRS round-trip',()=>{
 const current=new DrawingEngine();current.execute({type:'add',entity:{type:'line',layer:'default',points:[{x:0,y:0},{x:100000,y:0}]}});const prior=JSON.stringify(current.doc.entities);
 const doc=build(...fixtures[1],current.doc);assert.equal(JSON.stringify(doc.entities.slice(0,1)),prior);assert.deepEqual(validationPayload(doc).overrides,read(fixtures[1][0]+'_report.json').geometry);
 const request=read(fixtures[1][1]),result={report:read(fixtures[1][0]+'_report.json'),entities:read(fixtures[1][0]+'_entities.json')};
 request.site.parcel=request.site.parcel.map(([x,y])=>[x+200000,y+500000]);
 const shifted=attachSitePlan(new DrawingEngine().doc,request,result);assert.deepEqual(validationPayload(shifted).overrides,result.report.geometry);
});


test('engine v0.5.x PANEL_TABLE is skipped and MTEXT review note becomes multi-line text',()=>{
 const raw=read('demo_site.json'),request={site:raw.site,zoning:raw.zoning,program:raw.program,output:raw.output};
 const entities=read('DEMO-CORNER-01_entities.json'),text=entities.entities.find(e=>e.type==='TEXT');
 entities.entities.push({type:'PANEL_TABLE',layer:text.layer,rows:[['연면적','133.5 ㎡']]},{type:'MTEXT',layer:text.layer,text:'검토 정보\n옥탑 계단실 3m',position:text.position,height:text.height,width:38,attachment:'TOP_LEFT'});
 const doc=attachSitePlan(new DrawingEngine().doc,request,{entities,report:read('DEMO-CORNER-01_report.json')});
 assert.ok(doc.entities.some(e=>e.type==='text'&&e.text==='검토 정보\n옥탑 계단실 3m'));
});

test('계획안 레이어는 대지·계획 표준 이름으로 들어오고, 두 번 가져와도 같은 레이어를 다시 쓴다',()=>{
 const raw=read('demo_site.json'),request={site:raw.site,zoning:raw.zoning,program:raw.program,output:raw.output};
 const once=attachSitePlan(new DrawingEngine().doc,request,{entities:read('DEMO-CORNER-01_entities.json'),report:read('DEMO-CORNER-01_report.json')});
 const names=once.layers.map(l=>l.name);
 for(const n of ['A-SITE-BND','A-DIM','A-TEXT','A-SYM','A-BLDG-L1','A-PARK'])assert.ok(names.includes(n),n);
 for(const n of ['A-ANNO-DIMS','A-ANNO-TEXT','A-ANNO-SYMB'])assert.ok(!names.includes(n),n);
 assert.equal(once.layers.find(l=>l.name==='A-BLDG-L1').label,'건물 1층 외곽');
 const twice=attachSitePlan(once,request,{entities:read('DEMO-CORNER-01_entities.json'),report:read('DEMO-CORNER-01_report.json')});
 assert.equal(twice.layers.filter(l=>l.name.startsWith('A-PARK')).length,1,'A-PARK_xxxx 같은 복제 레이어가 생기지 않는다');
});

test('상세 계획: 안이 하나 끝날 때마다 onPlan 으로 알려 카드를 하나씩 채운다(실패한 안도)',async()=>{
 const raw=read('demo_site.json'),request={site:raw.site,zoning:raw.zoning,program:raw.program,output:raw.output};
 const result={entities:read('DEMO-CORNER-01_entities.json'),report:read('DEMO-CORNER-01_report.json')};
 let n=0;const api=async route=>{if(route==='site-plan/jobs')throw Object.assign(Error('미지원'),{status:404});if(++n===2)throw Error('미지원');return structuredClone(result);};
 const seen=[];
 const plans=await generatePlanVariants(request,api,[{title:'1안',patch:{}},{title:'2안',patch:{}},{title:'3안',patch:{}}],{onPlan:(plan,index)=>seen.push([index,plan.title,!!plan.failed])});
 assert.deepEqual(seen,[[0,'1안',false],[1,'2안',true],[2,'3안',false]]);
 assert.equal(plans.length,3);
});
