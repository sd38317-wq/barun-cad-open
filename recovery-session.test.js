// 5.0.4 안정성 검토 S2/S6 · 세션 복구 세대와 브리지 전송 정책
import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryOffer,workspaceHasContent,showRecoveryDialog} from './drawing-tabs.js';
import {connectBridge,documentSendPlan,MAX_BRIDGE_ENTITIES} from './bridge-client.js';

test('S2: 새 실행은 지난 세션을 덮지 않고 보관하며, 비정상 종료면 되살릴지 묻는다',()=>{
 const empty={version:1,tabs:[{name:'새 도면 1',doc:{entities:[]},dirty:false}]},work={version:1,tabs:[{name:'평면',doc:{entities:[{id:'a'}]},dirty:true},{name:'빈',doc:{entities:[]},dirty:false}]};
 assert.equal(workspaceHasContent(empty),false);assert.equal(workspaceHasContent(work),true);assert.equal(workspaceHasContent(null),false);
 assert.equal(recoveryOffer({saved:null,startFresh:true,closedCleanly:true}).action,'none');
 assert.equal(recoveryOffer({saved:empty,startFresh:true,closedCleanly:false}).action,'none');
 const viewed={version:1,tabs:[{name:'참고',doc:{entities:[{id:'f'}]},dirty:false}]};assert.equal(recoveryOffer({saved:viewed,startFresh:true,closedCleanly:false}).action,'none');   // 잃을 것이 없다
 assert.equal(recoveryOffer({saved:work,startFresh:true,closedCleanly:true}).action,'keep');
 const offer=recoveryOffer({saved:work,startFresh:true,closedCleanly:false});assert.equal(offer.action,'offer');assert.equal(offer.count,2);assert.deepEqual(offer.names,['평면','빈']);
 assert.equal(recoveryOffer({saved:work,startFresh:false,closedCleanly:false}).action,'restore');
});
test('S2: 되살리기 창은 Esc 로 닫히지 않고 선택 결과를 한 번만 전달한다',()=>{
 const nodes=[];const make=tag=>({tag,children:[],attrs:{},listeners:{},set textContent(v){this.text=v;},append(...items){this.children.push(...items);},setAttribute(k,v){this.attrs[k]=v;},addEventListener(name,fn){this.listeners[name]=fn;},showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;}});
 const doc={createElement:tag=>{const node=make(tag);nodes.push(node);return node;},body:{append(){}}};
 const choices=[];const {dialog,choose}=showRecoveryDialog({count:2,names:['평면','단면'],onRecover:()=>choices.push('recover'),onFresh:()=>choices.push('fresh')},doc);
 assert.equal(dialog.open,true);const cancel={prevented:false,preventDefault(){this.prevented=true;}};dialog.listeners.cancel(cancel);assert.equal(cancel.prevented,true);
 const buttons=nodes.filter(n=>n.tag==='button');assert.equal(buttons.length,2);buttons[1].onclick();buttons[0].onclick();choose('fresh');
 assert.deepEqual(choices,['recover']);assert.equal(dialog.removed,true);
});
test('S6: bridge sends the document at most once per interval and never above the entity limit',()=>{
 assert.deepEqual(documentSendPlan({changed:false,count:10,now:1000,lastSentAt:0}),{send:'none'});
 assert.deepEqual(documentSendPlan({changed:true,count:10,now:1000,lastSentAt:-1}),{send:'document'});
 assert.deepEqual(documentSendPlan({changed:true,count:10,now:1000,lastSentAt:900}),{send:'none'});
 assert.deepEqual(documentSendPlan({changed:true,count:10,now:2600,lastSentAt:900}),{send:'document'});
 assert.deepEqual(documentSendPlan({changed:true,count:MAX_BRIDGE_ENTITIES+1,now:5000,lastSentAt:-1}),{send:'omitted'});
 assert.deepEqual(documentSendPlan({changed:false,count:10,now:1000,lastSentAt:-1,forced:true}),{send:'document'});
});
test('S2/S6: first pulse carries freshLaunch and dirty flags; large drawings are omitted',async()=>{
 const original={window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout};const timers=[],payloads=[];
 globalThis.window={addEventListener(){}};globalThis.document={hasFocus:()=>true};globalThis.setTimeout=fn=>timers.push(fn);
 try{
  const big={entities:Array.from({length:MAX_BRIDGE_ENTITIES+5},(_,i)=>({id:String(i)}))};
  connectBridge({context:{engine:{doc:big,onChange(){}},selected:()=>new Set(),getCommandSettings:()=>({}),startedFresh:()=>true,hasDrawingWorkspace:()=>false},getFolder:()=>'',api:async(route,payload)=>{payloads.push(payload);return {requests:[]};}});
  await Promise.resolve();await Promise.resolve();
  assert.equal(payloads[0].freshLaunch,true);assert.equal(payloads[0].dirty,false);assert.equal(payloads[0].documentOmitted,true);assert.equal(payloads[0].entityCount,MAX_BRIDGE_ENTITIES+5);assert.equal('document' in payloads[0],false);
  await timers.shift()();assert.equal(payloads[1].freshLaunch,undefined);assert.equal('documentOmitted' in payloads[1],false);
 }finally{Object.assign(globalThis,original);}
});
