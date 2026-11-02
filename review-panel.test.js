import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DrawingEngine as Engine} from './engine.js';
import {encodeFull,fileBytes,decodeBcad} from './bcad-store.js';
import {makeReviewItem,formatReviewValue} from './review-model.js';
import {liveCheckReviewItems,filterReviewItems,reviewRowText,reviewDetails,createReviewStore,applyReviewRepair,repairOverlay,stageReviewRepair,installReviewPanel,linkReviewDetail} from './review-panel.js';
const item=o=>makeReviewItem({id:'a',field:'law',name:'출입문',reason:'폭 확인',progress:'done',status:'revise',objectIds:['o'],...o});
test('상세 연결은 근거만 추가하고 재검토·복원 뒤에도 유지한다',()=>{
 const doc={},store=createReviewStore({getDoc:()=>doc}),detail={id:'DETAIL-01',name:'창호 접합 상세',source:'library'};
 const original=item({status:'need_input',current:{value:null},reviewObjectIds:['W-01']});store.publish([original]);
 const linked=linkReviewDetail(store,'a',detail);assert.deepEqual({...linked,evidence:[]},original);assert.deepEqual(linked.evidence,[{detailId:detail.id,detailName:detail.name,source:'library'}]);
 const history=doc.reviewHistory.length;linkReviewDetail(store,'a',detail);assert.equal(doc.reviewHistory.length,history);
 store.publish([original]);assert.equal(store.items[0].evidence.length,1);assert.equal(store.items[0].status,'need_input');
 store.restore();assert.equal(store.items[0].evidence[0].detailId,detail.id);assert.throws(()=>linkReviewDetail(store,'missing',detail),/고르세요/);
});
test('legacy four states and unchecked/non-target values never satisfy',()=>{
 const result={active:true,findings:[{type:'building_line',severity:'error',message:'돌출'},{type:'areas_missing',severity:'warn',message:'면적 미확인'},{type:'north',severity:'warn',message:'상세'},{type:'pass',status:'satisfied',current:{value:1,confirmation:'confirmed'},message:'충족'}]};
 const rows=liveCheckReviewItems(result,{},'now');assert.deepEqual(rows.slice(0,4).map(i=>i.status),['revise','need_input','check_detail','satisfied']);
 assert.equal(rows[4].current.value,null);assert.equal(formatReviewValue(rows[4].current),'—');assert.notEqual(rows[4].status,'satisfied');
 assert.match(reviewRowText(item({progress:'stale'})),/검토 전.*■.*수정.*폭 확인/);
 assert.notEqual(item({status:'satisfied',applicability:'not_applicable'}).status,'satisfied');
 assert.equal(rows[0].evaluatedAt,'now');assert.equal(rows[0].ruleVersionId,'livecheck-v1');assert.equal(rows[0].statuteRef,null);
});
test('field filters group site and law and retain independent extension fields',()=>{const items=['site','law','access','energy'].map((field,n)=>item({id:String(n),field}));assert.equal(filterReviewItems(items,'all').length,4);assert.equal(filterReviewItems(items,'site').length,2);assert.deepEqual(filterReviewItems(items,'energy').map(i=>i.field),['energy']);});
test('detail order and null display are fixed',()=>{const details=reviewDetails(item({assumed:true,unknowns:['층 미확인'],nextAction:'입력',evaluatedAt:'now',ruleVersionId:'v1',statuteRef:'제1조'}));assert.deepEqual(details.map(d=>d[0]),['상태·사유','현재값/비교값','가정·미확인','다음 조치','근거']);assert.match(details[1][1],/—/);assert.match(details[4][1],/제1조.*now.*v1/);});
test('bidirectional object/review IDs and transitive stale scope without entity scans',async()=>{
 const doc={reviewHistory:[]};Object.defineProperty(doc,'entities',{get(){throw Error('전체 순회 금지');}});let zoom;
 const store=createReviewStore({getDoc:()=>doc,zoomObjects:ids=>zoom=ids});store.publish([item({reviewObjectIds:['D-01']}),item({id:'b',objectIds:['p']}),item({id:'c',field:'energy',objectIds:['q']})],{dependsOn:{b:['a'],c:['b']}});
 assert.deepEqual([...store.selectObjects([],['D-01'])],['a']);store.activate('a');assert.deepEqual(zoom,['o']);
 assert.deepEqual([...store.markChanged({removed:[{id:'o'}],added:[]})],['a','b','c']);assert.ok(store.items.every(i=>i.progress==='stale'));
 store.publish([item({id:'d',objectIds:['untouched']})]);assert.equal(store.items.at(-1).progress,'done');
 const calls=[];for(const field of ['law','energy'])store.registerReviewSource(field,async scope=>{calls.push(scope);return scope.items.map(i=>({...i,progress:'done'}));});await store.recheck();assert.deepEqual(calls.map(s=>s.itemIds),[['a','b'],['c']]);assert.equal(store.items.find(i=>i.id==='d').progress,'done');
});
test('history records changes/removals once and survives native JSON load',()=>{
 const engine=new Engine(),initial=engine.doc;const store=createReviewStore({getDoc:()=>engine.doc,persistHistory:reviewHistory=>engine.setReviewHistory(reviewHistory)});
 store.publish([item()]);assert.equal(engine.doc.reviewHistory.length,1);assert.equal(initial.reviewHistory,undefined);assert.equal(engine.doc.entities,initial.entities);assert.equal(engine.lastExecution.lightweight,true);
 store.publish([item({evaluatedAt:'later'})]);assert.equal(engine.doc.reviewHistory.length,1);store.publish([item({reason:'폭 부족'})]);assert.equal(engine.doc.reviewHistory.length,2);store.publish([],{replaceIds:['a']});assert.equal(engine.doc.reviewHistory.length,3);
 const restored=new Engine();restored.execute({type:'load',document:JSON.parse(JSON.stringify(engine.doc))});assert.deepEqual(restored.doc.reviewHistory,engine.doc.reviewHistory);
 assert.deepEqual(decodeBcad(fileBytes(encodeFull(engine.doc))).doc.reviewHistory,engine.doc.reviewHistory);
});
test('late source results are discarded after edits and document switches',async()=>{
 let doc={};const store=createReviewStore({getDoc:()=>doc});store.publish([item()]);store.markChanged(null);let finish;store.registerReviewSource('law',()=>new Promise(r=>finish=r));const running=store.recheck();store.markChanged({removed:[{id:'o'}],added:[]});finish([item({reason:'오래된 결과'})]);assert.equal(await running,false);assert.notEqual(store.items[0].reason,'오래된 결과');
 const running2=store.recheck();doc={};finish([item()]);assert.equal(await running2,false);
});
test('all registered fields finish when each history write replaces the document',async()=>{
 let doc={};const calls=[],store=createReviewStore({getDoc:()=>doc,persistHistory:reviewHistory=>{doc={...doc,reviewHistory};}});
 for(const field of ['law','access','energy'])store.registerReviewSource(field,async()=>{calls.push(field);return [item({id:field,field})];});
 assert.equal(await store.recheck(),true);assert.deepEqual(calls,['law','access','energy']);assert.equal(store.items.length,3);assert.equal(doc.reviewHistory.length,3);
});
test('preview overlay leaves original intact; apply is one undo and failures rollback',()=>{
 const engine=new Engine();engine.execute({type:'add',entity:{type:'line',points:[{x:0,y:0},{x:100,y:0}],layer:engine.doc.layers[0].id}});const before=JSON.stringify(engine.doc),staged=structuredClone(engine.doc);staged.entities[0].points[1].x=200;
 const overlay=repairOverlay(engine.doc,staged);assert.equal(overlay.length,1);assert.equal(overlay[0].layer,'A-REVIEW');assert.equal(JSON.stringify(engine.doc),before);
 const preview=stageReviewRepair(engine,staged);assert.equal(preview.overlay.length,1);assert.equal(preview.cancel().rolledBack,true);assert.equal(JSON.stringify(engine.doc),before);
 const deleted=repairOverlay(engine.doc,{...engine.doc,entities:[]});assert.equal(deleted.length,1);assert.equal(deleted[0].linetype,'DASHED');
 const count=engine.undoStack.length;assert.throws(()=>applyReviewRepair(engine,()=>{engine.execute({type:'load',document:staged});throw Error('취소');}),/취소/);assert.equal(JSON.stringify(engine.doc),before);assert.equal(engine.undoStack.length,count);
 applyReviewRepair(engine,()=>engine.execute({type:'load',document:staged}));assert.equal(engine.undoStack.length,count+1);engine.execute({type:'undo'});assert.equal(JSON.stringify(engine.doc),before);
 engine.beginTransaction();assert.throws(()=>applyReviewRepair(engine,()=>{}),/진행 중/);engine.rollbackTransaction();
});
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.attributes={};}
 append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}setAttribute(k,v){this.attributes[k]=v;}scrollIntoView(){this.scrolled=true;}
}
test('panel tabs, activation, selection scroll and detail refresh use accessible buttons',()=>{
 const saved=globalThis.document;globalThis.document={createElement:t=>new Element(t)};
 try{const host=new Element('div');let view,zoom;const store=createReviewStore({getDoc:()=>({}),zoomObjects:ids=>zoom=ids,onChange:()=>view?.draw()});store.publish([item(),item({id:'energy',field:'energy',objectIds:['wall']})]);view=installReviewPanel({host,store});const [tabs,scope,run,list,detail]=host.children;assert.equal(tabs.children.length,4);tabs.children[3].onclick();assert.equal(list.children.length,1);assert.match(list.children[0].textContent,/폭 확인/);list.children[0].onclick();assert.deepEqual(zoom,['wall']);assert.equal(detail.children.length,5);
 store.selectObjects(['o']);view.selectionChanged();assert.equal(tabs.children[0].attributes['aria-pressed'],'true');assert.equal(list.children[0].scrolled,true);assert.match(scope.textContent,/2항목/);assert.equal(run.textContent,'다시 검토');
 }finally{globalThis.document=saved;}
});
test('application wiring exposes panel, indexed selection and delta notification',()=>{
 const app=readFileSync(new URL('./app.js',import.meta.url),'utf8'),live=readFileSync(new URL('./live-check.js',import.meta.url),'utf8');assert.match(app,/liveCheck\?\.selectionChanged/);assert.match(app,/liveCheck\?\.notifyDelta\(delta,previousDoc\)/);assert.match(app,/applyReviewRepair\(engine,apply\)/);assert.match(live,/registerReviewSource/);assert.doesNotMatch(live,/abortTransaction/);
});
