import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {accessReview,doorClearWidth,readExternalDoors,swingInvades,setAccessSettings,editAccessInput,assetDoorReview,doorReviewBadge} from './access-review.js';
import {buildDoor,DOOR_FIELDS,doorSlotDefaults,installDoorCards,DOOR_STORAGE_KEY} from './door-card.js';
import {wallFrame,normalizeValues} from './card-kit.js';
import {DrawingEngine} from './engine.js';
import {createReviewStore} from './review-panel.js';
import {runScripted} from './command-runner.js';
const shared={frameLayer:'A-DOOR',leafLayer:'A-DOOR',swingLayer:'A-DOOR'},frame=wallFrame({x:0,y:0},{x:1,y:0},{x:0,y:200});
const door=(n=820)=>({id:'door',reviewObjectId:'D-01',reviewInput:{clearWidthMm:n,swing:[{center:{x:0,y:0},radius:900,startAngle:0,endAngle:90}]}});
test('자료 문 실폭 배지: 900 경계·미달·미검사·부분 누락·블록',()=>{
 const known=n=>({id:'d'+n,type:'door',reviewInput:{door:true,clearWidthMm:n}}),review=entities=>assetDoorReview({entities});
 assert.equal(doorReviewBadge(review([known(900)])),'● 900 이상');assert.equal(doorReviewBadge(review([known(899)])),'■ 미만');
 for(const result of [assetDoorReview(),review([]),review([known(null)]),review([known(900),known(null)])]){assert.equal(doorReviewBadge(result),'▲ 입력 필요');assert.notEqual(result.status,'satisfied');}
 assert.equal(assetDoorReview().current.value,null);assert.equal(assetDoorReview().progress,'not_run');
 assert.equal(review([known(900),known(null)]).current.value,null);
 assert.equal(doorReviewBadge(review([{type:'block',entities:[known(950)]}])),'● 900 이상');
 assert.equal(doorReviewBadge(review([known(899),known(null)])),'■ 미만');
 const geometry={entities:[known(900)]};assert.equal(doorReviewBadge(assetDoorReview({geometry})),'● 900 이상');
 const shared={sharedBlocks:{doors:{origin:{x:0,y:0},entities:[known(900)]}},entities:[{id:'ref',type:'block',sharedBlock:'doors',position:{x:100,y:200},entities:[]}]};assert.equal(doorReviewBadge(assetDoorReview(shared)),'● 900 이상');
 const source={scenes:[{entities:[known(900)]},{entities:[known(899)]}]},before=structuredClone(source);assert.equal(doorReviewBadge(assetDoorReview(source)),'■ 미만');assert.deepEqual(source,before);
});
const item=(doc,suffix='D-01:width')=>accessReview(doc).items.find(i=>i.id==='access:'+suffix);
test('카드 문 실폭과 기본값: 틀 포함 990 간단문, 두꺼운 상세문 1030',()=>{
 assert.equal(doorClearWidth(950,45,40),820);assert.equal(doorClearWidth(null,45,40),null);
 for(const slot of [0,1,2]){const v=normalizeValues(DOOR_FIELDS,doorSlotDefaults(slot),'D'),r=buildDoor(frame,v,shared),input=r.entities[0].reviewInput;assert.ok(input.clearWidthMm>=900);assert.equal(input.openingWidthMm,slot===0?990:1030);assert.equal(input.clearWidthMm,input.openingWidthMm-2*input.frameWidthMm-input.leafThicknessMm);assert.ok(r.entities.every(e=>e.reviewInput===input));assert.equal(input.swing.length,1);}
});
test('외부 도면: 90도 호와 힌지·끝점이 맞는 문짝선, 확정 자동 읽기',()=>{
 const arc={id:'a',type:'arc',layer:'D',center:{x:0,y:0},radius:820,startAngle:0,endAngle:90},line={id:'l',type:'line',layer:'D',points:[{x:0,y:0},{x:0,y:820}]};
 assert.equal(readExternalDoors([arc,line])[0].input.clearWidthMm,820);assert.equal(readExternalDoors([arc,{...line,layer:'X'}]).length,0);
 const r=accessReview({entities:[arc,line]}),i=r.items[0];assert.equal(i.current.sourceKind,'auto_read');assert.equal(i.current.confirmation,'confirmed');assert.equal(i.status,'revise');assert.deepEqual(i.objectIds,['a','l']);assert.deepEqual(r.updates.map(u=>u.changes.reviewObjectId),['D-01','D-01']);
});
test('820은 규모·용도·대상 여부와 관계없이 바로 revise, 설정·제외·이력',()=>{
 const doc={entities:[door()],reviewSettings:{disabled:false,access:{}}};let i=item(doc);assert.equal(i.status,'revise');assert.equal(i.reason,'실폭 900mm 미만 (80mm 부족)');
 setAccessSettings(doc,{doorClearMinMm:800});assert.equal(item(doc).status,'satisfied');setAccessSettings(doc,{excludedDoors:['D-01']});i=item(doc);assert.equal(i.applicability,'not_applicable');assert.equal(i.reason,'설계자 제외');assert.equal(i.current.sourceKind,'designer');assert.notEqual(i.status,'satisfied');assert.equal(doc.reviewHistory.at(-1).actor,'designer');assert.throws(()=>setAccessSettings(doc,{doorClearMinMm:-1}));
 assert.equal(item({entities:[door(null)]}).current.value,null);assert.equal(item({entities:[door(null)]}).status,'need_input');
});
test('경사로 레벨 없음은 need_input, 레벨·rise·폭·참 비교는 대조 전',()=>{
 const e={id:'r',category:'RAMP',reviewObjectId:'R-01',parameters:{depth:12000,width:1200},reviewInput:{landingMm:1500}};let doc={entities:[e]};assert.equal(item(doc,'R-01:slope').reason,'R-01 상·하부 레벨 미입력');assert.equal(item(doc,'R-01:slope').current.value,null);
 e.reviewInput={...e.reviewInput,startLevelMm:0,endLevelMm:1000};assert.equal(item(doc,'R-01:slope').status,'check_detail');assert.equal(item(doc,'R-01:slope').current.value,1/12);e.reviewInput.riseMm=2000;assert.equal(item(doc,'R-01:slope').status,'revise');assert.match(item(doc,'R-01:landing').statuteRef,/대조 전/);
});
test('문 열림 부채꼴과 활동공간 원·사각형 침범 및 회전 방향',()=>{
 const swing=door().reviewInput.swing[0];assert.equal(swingInvades(swing,{center:{x:500,y:500},radius:100}),true);assert.equal(swingInvades(swing,{center:{x:-500,y:-500},radius:100}),false);assert.equal(swingInvades(swing,{points:[{x:100,y:100},{x:200,y:100},{x:200,y:200},{x:100,y:200}]}),true);
 const wc={id:'wc',reviewObjectId:'WC-01',reviewInput:{disabledToilet:true,doorIds:['D-01'],turnCenter:{x:500,y:500}}},doc={entities:[door(),wc]};assert.equal(item(doc,'WC-01:swing').reason,'문 열림이 활동공간 침범');assert.equal(item(doc,'WC-01:swing').status,'revise');assert.equal(item(doc,'WC-01:detail').status,'check_detail');
});
test('장애인 주차부터 주출입구까지 선만 있으면 충족 아님, BF는 별도',()=>{
 const d=door(900);d.reviewInput.mainEntrance=true;const p={id:'p',reviewObjectId:'P-01',reviewInput:{disabledParking:true}},doc={entities:[d,p]};assert.equal(item(doc,'P-01:path').reason,'보행 접근로 미지정');doc.entities.push({id:'path',type:'line',reviewInput:{walkway:true,parkingId:'P-01',doorId:'D-01'}});assert.equal(item(doc,'P-01:path').status,'need_input');Object.assign(doc.entities.at(-1).reviewInput,{clearWidthMm:1200,stepMm:0});assert.equal(item(doc,'P-01:path').status,'check_detail');doc.entities.at(-1).reviewInput.stepMm=10;assert.equal(item(doc,'P-01:path').status,'revise');assert.equal(item(doc,'bf').status,'check_detail');assert.equal(item(doc,'bf').current.value,null);
});
test('번호는 기존 순번 뒤에서 발급, 공통 저장소 등록·재검토·상세 연결',async()=>{
 const doc={entities:[{id:'r',category:'RAMP'}],reviewObjectSeq:{ramp:9}},r=accessReview(doc);assert.equal(r.updates[0].changes.reviewObjectId,'R-10');const store=createReviewStore({getDoc:()=>doc});store.registerReviewSource('access',()=>r.items);await store.recheck();assert.ok(store.items.every(i=>i.field==='access'));store.selectObjects(['r']);assert.ok(store.selected.size);store.markChanged({removed:[{id:'r'}],added:[]});assert.equal(store.items.find(i=>i.reviewObjectIds.includes('R-10')).progress,'stale');
 const server=readFileSync(new URL('./server.py',import.meta.url),'utf8'),live=readFileSync(new URL('./live-check.js',import.meta.url),'utf8');assert.ok(server.includes("'/access-review.js'"));assert.match(live,/registerReviewSource\('access'/);
});
test('실제 문 카드 삽입: 모든 조각 동일 번호, 삽입·순번 한 번 undo',async()=>{
 const engine=new DrawingEngine();engine.doc.entities=[];const storage={getItem:k=>k===DOOR_STORAGE_KEY?JSON.stringify({presets:[{runMode:'command'}]}):null,setItem(){}};let pending;
 const ctx={doc:()=>engine.doc,storage,entities:()=>[],layers:()=>engine.doc.layers,tolerance:()=>10,ensureLayer:()=>engine.doc.layers[0].id,askNumber:(o,fn)=>{pending=fn(o.value);},pickPath:async()=>({points:[{x:0,y:0},{x:1000,y:0},{x:0,y:200}]}),commit:({entities,reviewObjectSeq})=>engine.execute({type:'batch',commands:[{type:'document.update',changes:{reviewObjectSeq}},{type:'addMany',entities}]}),toast(){}};
 installDoorCards(ctx).D1();await pending;assert.ok(engine.doc.entities.length);assert.ok(engine.doc.entities.filter(e=>e.reviewInput).every(e=>e.reviewObjectId==='D-01'));assert.equal(engine.doc.reviewObjectSeq.door,1);engine.execute({type:'undo'});assert.equal(engine.doc.entities.length,0);
});
test('호 표시를 꺼도 swing 보존, 이동한 호는 현재 기하로 침범 검사',()=>{
 const v=normalizeValues(DOOR_FIELDS,{...doorSlotDefaults(1),swingMark:'none'},'D'),r=buildDoor(frame,v,shared);assert.equal(r.entities[0].reviewInput.swing.length,1);
 const d=door(900);d.type='arc';Object.assign(d,{center:{x:10000,y:10000},radius:900,startAngle:0,endAngle:90});const wc={id:'wc',reviewObjectId:'WC-01',reviewInput:{disabledToilet:true,doorIds:['D-01'],turnCenter:{x:500,y:500}}};assert.notEqual(item({entities:[d,wc]},'WC-01:swing').status,'revise');
});
test('외부 두꺼운 문짝에서 두께를 빼고 주출입구 입력 후에도 재측정한다',()=>{
 const arc={id:'a',type:'arc',layer:'D',reviewObjectId:'D-02',reviewInput:{door:true,mainEntrance:true},center:{x:0,y:0},radius:860,startAngle:0,endAngle:90},leaf={id:'l',type:'rectangle',layer:'D',reviewObjectId:'D-02',reviewInput:{door:true},points:[{x:-20,y:0},{x:20,y:0},{x:20,y:860},{x:-20,y:860}]};const r=accessReview({entities:[arc,leaf]});assert.equal(r.items.filter(i=>i.name.includes('문 실폭')).length,1);assert.equal(r.items[0].current.value,820);assert.equal(readExternalDoors([arc,leaf])[0].input.leafThicknessMm,40);
});
test('경사로·접근로 폭 입력은 문 항목을 만들지 않는다',()=>{
 const doc={entities:[{id:'r',category:'RAMP',reviewInput:{clearWidthMm:1200}},{id:'path',reviewInput:{walkway:true,clearWidthMm:1500}}]};assert.ok(!accessReview(doc).items.some(i=>i.name.includes('문 실폭')));
});
test('변기 옆·앞 공간은 설정값과 변기 방향으로 검사한다',()=>{
 const wc={id:'wc',reviewObjectId:'WC-01',reviewInput:{disabledToilet:true,doorIds:['D-01'],toiletAnchor:{x:1100,y:100},toiletWidthMm:400,toiletDepthMm:700,toiletRotation:0}},doc={entities:[door(900),wc]};assert.equal(item(doc,'WC-01:swing').status,'revise');doc.reviewSettings={access:{toiletSideMinMm:50}};assert.notEqual(item(doc,'WC-01:swing').status,'revise');
});
test('분야 재검토는 다른 분야 검사기를 호출하지 않는다',async()=>{
 const calls=[],store=createReviewStore({getDoc:()=>({})});for(const field of ['law','access'])store.registerReviewSource(field,()=>{calls.push(field);return [];});await store.recheck({all:true,field:'access'});assert.deepEqual(calls,['access']);
});
test('선택 객체 입력에서 빈 레벨·0 레벨 구별, 미입력에 0을 채우지 않는다',()=>{
 const engine=new DrawingEngine(),layer=engine.doc.layers[0].id;const [id]=engine.execute({type:'add',entity:{type:'rectangle',layer,points:[{x:0,y:0},{x:1000,y:0},{x:1000,y:12000},{x:0,y:12000}]}});let callback,done=false;const form=(title,fields,fn)=>{callback=fn;};editAccessInput({engine,form,ids:[id],onDone:()=>done=true});callback({kind:'ramp'});callback({startLevelMm:'0',endLevelMm:'',riseMm:'',runMm:'12000',clearWidthMm:'1200',landingMm:'1500'});const e=engine.selected([id])[0];assert.equal(e.reviewInput.startLevelMm,0);assert.equal(e.reviewInput.endLevelMm,null);assert.ok(done);assert.equal(accessReview(engine.doc).items.find(i=>i.name.includes('기울기')).status,'need_input');
});
test('벽에 연결된 카드 문 폭 수정은 재생성된 문짝 실폭을 읽는다',async()=>{
 const engine=new DrawingEngine(),layer=engine.doc.layers[0].id;engine.execute({type:'add',entity:{type:'wall',layer,points:[{x:0,y:100},{x:5000,y:100}],thickness:200,openings:[]}});
 await runScripted(engine,'D2',{form:{width:940},points:[[1000,0],[2000,0],[1000,200]]});const d=engine.doc.entities.find(e=>e.category==='DOOR');assert.ok(d.cardOpening);assert.equal(item(engine.doc).current.value,900);engine.execute({type:'architecture.update',ids:[d.id],changes:{width:860}});assert.equal(item(engine.doc).current.value,820);assert.equal(item(engine.doc).status,'revise');
 assert.equal(engine.doc.reviewObjectSeq.door,1);
});
test('축척·이동·대칭은 실폭과 숨긴 회전호·활동공간도 함께 바꾼다',()=>{
 const engine=new DrawingEngine(),v=normalizeValues(DOOR_FIELDS,{...doorSlotDefaults(1),swingMark:'none'},'D'),built=buildDoor(frame,v,shared);const ids=engine.execute({type:'addMany',entities:built.entities.map(e=>({...e,layer:engine.doc.layers[0].id,reviewObjectId:'D-01'}))});
 engine.execute({type:'scale',ids,base:{x:0,y:0},factor:.5});assert.equal(item(engine.doc).current.value,450);assert.equal(item(engine.doc).status,'revise');const old=engine.doc.entities[0].reviewInput.swing[0].center;
 engine.execute({type:'move',ids,dx:10000,dy:20000});const moved=engine.doc.entities[0].reviewInput.swing[0];assert.equal(moved.center.x,old.x+10000);assert.equal(moved.center.y,old.y+20000);assert.equal(moved.radius,470);
 engine.execute({type:'mirror',ids,a:{x:0,y:0},b:{x:0,y:1},eraseSource:true});assert.equal(engine.doc.entities[0].reviewInput.swing[0].center.x,-moved.center.x);
});
for(const kind of ['copy','mirror','array','transform.copy'])test(kind+' 사본은 문 조각별 같은 새 번호, 원본과 별도 검토',()=>{
 const engine=new DrawingEngine(),v=normalizeValues(DOOR_FIELDS,doorSlotDefaults(1),'D'),built=buildDoor(frame,v,shared);engine.doc.reviewObjectSeq={door:1};const ids=engine.execute({type:'addMany',entities:built.entities.map(e=>({...e,layer:engine.doc.layers[0].id,reviewObjectId:'D-01'}))});
 const commands={copy:{type:'copy',ids,dx:5000,dy:0},mirror:{type:'mirror',ids,a:{x:3000,y:0},b:{x:3000,y:1},eraseSource:false},array:{type:'array',ids,rows:1,columns:2,dx:5000,dy:0,associative:true},'transform.copy':{type:'transform.copy',ids,matrix:[1,0,0,1,5000,0]}};engine.execute(commands[kind]);assert.equal(engine.doc.reviewObjectSeq.door,2);const rows=accessReview(engine.doc).items.filter(i=>i.name.includes('문 실폭'));assert.equal(rows.length,2);assert.deepEqual(rows.map(i=>i.reviewObjectIds[0]).sort(),['D-01','D-02']);assert.equal(rows[0].objectIds.length,rows[1].objectIds.length);
});
test('화장실 입력은 관련 문보다 원래 선택한 화장실을 우선한다',()=>{
 const engine=new DrawingEngine(),layer=engine.doc.layers[0].id;const [d,wc]=engine.execute({type:'addMany',entities:[{type:'line',layer,reviewObjectId:'D-01',points:[{x:0,y:0},{x:0,y:900}],reviewInput:{door:true}},{type:'rectangle',layer,reviewObjectId:'WC-01',points:[{x:0,y:0},{x:2000,y:0},{x:2000,y:2000},{x:0,y:2000}],reviewInput:{disabledToilet:true}}]});let callback,first;editAccessInput({engine,ids:[wc,d],form:(title,fields,fn)=>{first??=fields[0].value;callback=fn;}});assert.equal(first,'toilet');callback({kind:'toilet'});callback({doorIds:'D-01',turnX:'0',turnY:'0'});assert.deepEqual(engine.selected([wc])[0].reviewInput.turnCenter,{x:0,y:0});assert.equal(engine.selected([d])[0].reviewInput.disabledToilet,undefined);
 assert.throws(()=>setAccessSettings({}, {doorClearMinMm:null}));
});
test('90도 미만 문 열림과 조각 일부 삭제·축척은 충족 판정하지 않는다',()=>{
 const v=normalizeValues(DOOR_FIELDS,doorSlotDefaults(1),'D'),build=values=>buildDoor(frame,values,shared).entities.map(e=>({...e,reviewObjectId:'D-01'}));assert.equal(build({...v,openAngle:60})[0].reviewInput.clearWidthMm,435.358984);
 const parts=build(v);assert.equal(item({entities:parts}).status,'satisfied');assert.equal(item({entities:parts.slice(1)}).status,'need_input');parts[0]={...parts[0],reviewInput:{...parts[0].reviewInput,clearWidthMm:450}};assert.equal(item({entities:parts}).status,'need_input');
});
for(const kind of ['polar','path'])test('검토 문 '+kind+' 배열도 기존 배열 계산을 재사용한다',()=>{
 const engine=new DrawingEngine(),v=normalizeValues(DOOR_FIELDS,doorSlotDefaults(1),'D'),built=buildDoor(frame,v,shared);engine.doc.reviewObjectSeq={door:1};const ids=engine.execute({type:'addMany',entities:built.entities.map(e=>({...e,layer:engine.doc.layers[0].id,reviewObjectId:'D-01'}))}),params=kind==='polar'?{center:{x:0,y:0},count:4,fill:360}:{base:{x:0,y:0},path:[{x:0,y:0},{x:5000,y:0}],count:4};engine.execute({type:'array',ids,associative:true,kind,params});assert.equal(engine.doc.reviewObjectSeq.door,4);assert.equal(accessReview(engine.doc).items.filter(i=>i.name.includes('문 실폭')).length,4);
});
test('문·화장실을 함께 대칭해도 변기 옆·앞 활동공간 관계가 유지된다',()=>{
 const engine=new DrawingEngine(),d=door(900),layer=engine.doc.layers[0].id;Object.assign(d,{type:'arc',layer,center:{x:0,y:0},radius:900,startAngle:0,endAngle:90});const wc={type:'rectangle',layer,points:[{x:0,y:0},{x:2000,y:0},{x:2000,y:2000},{x:0,y:2000}],reviewObjectId:'WC-01',reviewInput:{disabledToilet:true,doorIds:['D-01'],toiletAnchor:{x:1100,y:1000},toiletWidthMm:400,toiletDepthMm:700,toiletRotation:0}},ids=engine.execute({type:'addMany',entities:[d,wc]});assert.notEqual(item(engine.doc,'WC-01:swing').status,'revise');engine.execute({type:'mirror',ids,a:{x:0,y:0},b:{x:0,y:1},eraseSource:true});assert.notEqual(item(engine.doc,'WC-01:swing').status,'revise');
});
