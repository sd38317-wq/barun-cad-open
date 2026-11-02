import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {sealPadJson,openPadJson,randomToken,newPadSessionId,padLink,parsePadLocation,PAD_ID_PATTERN,sha256Hex} from './pad-crypto.js';
import {normalizePadBatch,buildPadSnapshot,planPadOps,PAD_MARK_LAYER_ID,PAD_MARK_LAYER_NAME,padAck,isPadAck,describePadOp,cloudRing} from './pad-ops.js';

const engineWith=entities=>{const engine=new DrawingEngine();engine.execute({type:'load',document:{...engine.doc,entities}});return engine;};
const layerOf=engine=>engine.doc.layers[0].id;
const entries=batch=>normalizePadBatch(batch).ops.map((op,index)=>({seq:batch.seq,index,op}));

test('pad payload round-trips through AES-GCM and refuses another session or key',async()=>{
 const key=randomToken(32),id=newPadSessionId();
 assert.match(id,PAD_ID_PATTERN);
 const sealed=await sealPadJson({hello:'도면',n:[1,2,3]},key,id);
 assert.deepEqual(await openPadJson(sealed,key,id),{hello:'도면',n:[1,2,3]});
 await assert.rejects(openPadJson(sealed,key,newPadSessionId()),/풀 수 없습니다/);
 await assert.rejects(openPadJson(sealed,randomToken(32),id),/풀 수 없습니다/);
 assert.equal((await sha256Hex('abc')).length,64);
});

test('pad link keeps the key after # and parses back',()=>{
 const id=newPadSessionId(),link=padLink('https://barunarc.co.kr/',id,'KEY_1','W-2');
 assert.equal(link,`https://barunarc.co.kr/p/${id}#k=KEY_1&w=W-2`);
 const url=new URL(link);assert.deepEqual(parsePadLocation(url.pathname,url.hash),{id,key:'KEY_1',writeToken:'W-2'});
 assert.equal(parsePadLocation('/p/short','#k=a').id,'');
});

test('batch normalization rejects commands outside the pad whitelist',()=>{
 assert.throws(()=>normalizePadBatch({v:1,seq:1,ops:[{type:'lisp.apply',code:'(command "erase")'}]}),/지원하지 않는/);
 assert.throws(()=>normalizePadBatch({v:1,seq:1,ops:[{type:'move',ids:['a'],dx:'x',dy:0}]}),/dx/);
 assert.throws(()=>normalizePadBatch({v:2,seq:1,ops:[{type:'delete',ids:['a']}]}),/판/);
 const batch=normalizePadBatch({v:1,seq:3,baseRevision:'r1',ops:[{type:'move',ids:['a'],dx:1,dy:2,extra:'drop'}]});
 assert.deepEqual(batch.ops[0],{type:'move',ids:['a'],dx:1,dy:2});
});

test('planned pad ops apply as one undo step, including marks on a new layer and ops on pad-created objects',()=>{
 const engine=engineWith([]);const layer=layerOf(engine);
 engine.execute({type:'add',entity:{type:'line',id:'L1',layer,points:[{x:0,y:0},{x:100,y:0}]}});
 engine.execute({type:'add',entity:{type:'text',id:'T1',layer,position:{x:0,y:0},text:'거실',height:100,rotation:0}});
 const {snapshot,baseline}=buildPadSnapshot(engine.doc,{name:'시험',revision:'r1'});
 assert.equal(snapshot.entities.length,2);
 const plan=planPadOps(engine.doc,entries({v:1,seq:1,ops:[
  {type:'mark',id:'M1',points:[{x:0,y:0},{x:10,y:10}],note:'여기 확인'},
  {type:'line',id:'N1',points:[{x:0,y:50},{x:50,y:50}]},
  {type:'move',ids:['N1'],dx:0,dy:10},
  {type:'copy',ids:['L1'],dx:0,dy:200,newIds:['C1']},
  {type:'text',id:'T1',text:'안방'},
  {type:'delete',ids:['C1']},
 ]}),{baseline});
 assert.deepEqual(plan.map(item=>item.status),['ready','ready','ready','ready','ready','ready']);
 const undoDepth=engine.undoStack.length;
 engine.execute({type:'batch',commands:plan.flatMap(item=>item.commands)});
 assert.equal(engine.undoStack.length,undoDepth+1);
 const byId=new Map(engine.doc.entities.map(e=>[e.id,e]));
 assert.equal(engine.doc.layers.find(l=>l.id===PAD_MARK_LAYER_ID)?.name,PAD_MARK_LAYER_NAME);
 assert.equal(byId.get('M1').layer,PAD_MARK_LAYER_ID);
 assert.equal(byId.get('M1-note').text,'여기 확인');
 assert.equal(byId.get('N1').points[0].y,60);
 assert.equal(byId.get('T1').text,'안방');
 assert.ok(!byId.has('C1'));
});

test('office edits after sharing become conflicts; missing and locked targets are not applied',()=>{
 const engine=engineWith([]);const layer=layerOf(engine);
 engine.execute({type:'add',entity:{type:'line',id:'L1',layer,points:[{x:0,y:0},{x:100,y:0}]}});
 engine.execute({type:'add',entity:{type:'line',id:'L2',layer,points:[{x:0,y:10},{x:100,y:10}]}});
 const {baseline}=buildPadSnapshot(engine.doc);
 engine.execute({type:'move',ids:['L1'],dx:5,dy:0});
 const ops=entries({v:1,seq:2,ops:[{type:'move',ids:['L1'],dx:1,dy:0},{type:'delete',ids:['GONE']},{type:'move',ids:['L2'],dx:1,dy:0}]});
 let plan=planPadOps(engine.doc,ops,{baseline});
 assert.deepEqual(plan.map(item=>item.status),['conflict','missing','ready']);
 plan=planPadOps(engine.doc,ops,{baseline,force:new Set(['2:0'])});
 assert.equal(plan[0].status,'ready');
 engine.execute({type:'layer.update',id:layer,changes:{locked:true}});
 assert.equal(planPadOps(engine.doc,[ops[2]],{baseline})[0].status,'locked');
});

test('view-scoped snapshot only carries objects overlapping the box',()=>{
 const engine=engineWith([]);const layer=layerOf(engine);
 engine.execute({type:'add',entity:{type:'line',id:'IN',layer,points:[{x:0,y:0},{x:10,y:0}]}});
 engine.execute({type:'add',entity:{type:'line',id:'OUT',layer,points:[{x:1000,y:1000},{x:1010,y:1000}]}});
 const {snapshot}=buildPadSnapshot(engine.doc,{box:{minX:-5,minY:-5,maxX:50,maxY:50}});
 assert.deepEqual(snapshot.entities.map(e=>e.id),['IN']);
});

test('applying only a later pen mark still creates the PAD mark layer (first mark left unchecked)',()=>{
 const engine=engineWith([]);
 const pending=[...entries({v:1,seq:1,ops:[{type:'mark',id:'M1',points:[{x:0,y:0},{x:10,y:10}]}]}),...entries({v:1,seq:2,ops:[{type:'mark',id:'M2',points:[{x:20,y:0},{x:30,y:10}]}]})];
 const chosen=new Set(['2:0']);
 const items=planPadOps(engine.doc,pending,{chosen}).filter(item=>chosen.has(item.key)&&item.status==='ready');
 const undoDepth=engine.undoStack.length;
 engine.execute({type:'batch',commands:items.flatMap(item=>item.commands)});
 assert.equal(engine.undoStack.length,undoDepth+1);
 const byId=new Map(engine.doc.entities.map(e=>[e.id,e]));
 assert.equal(byId.get('M2').layer,PAD_MARK_LAYER_ID);
 assert.equal(engine.doc.layers.find(l=>l.id===PAD_MARK_LAYER_ID)?.name,PAD_MARK_LAYER_NAME);
 assert.ok(!byId.has('M1'));
 engine.execute({type:'undo'});
 assert.ok(!engine.doc.layers.some(l=>l.id===PAD_MARK_LAYER_ID));
 assert.ok(!engine.doc.entities.some(e=>e.id==='M2'));
});

test('field memo is kept in place as text with a closed cloud on the PAD layer, in one undo step (7.0)',()=>{
 const engine=engineWith([]),before=engine.doc.entities.length;
 const plan=planPadOps(engine.doc,entries({v:1,seq:1,ops:[{type:'memo',id:'m1',at:{x:1000,y:500},text:'창 키워 주세요',height:200},{type:'mark',id:'k1',points:[{x:0,y:0},{x:100,y:100}]}]}));
 assert.ok(plan.every(item=>item.status==='ready'));engine.execute({type:'batch',commands:plan.flatMap(item=>item.commands)});
 const text=engine.doc.entities.find(e=>e.id==='m1'),cloud=engine.doc.entities.find(e=>e.id==='m1-cloud');
 assert.deepEqual([text.text,text.position,text.height],['창 키워 주세요',{x:1000,y:500},200]);assert.equal(cloud.closed,true);
 assert.ok(cloud.points.every(p=>p.x<1000||p.x>1000+200*3||p.y<500||p.y>700),'cloud goes around the text');
 assert.ok([text,cloud].every(e=>e.layer===PAD_MARK_LAYER_ID));engine.execute({type:'undo'});assert.equal(engine.doc.entities.length,before);
 assert.equal(describePadOp({type:'memo',text:'창 키워 주세요'}),'메모 · "창 키워 주세요"');
});
test('memo input is checked: empty text, bad height and extra fields are refused',()=>{
 for(const op of [{type:'memo',id:'m',at:{x:0,y:0},text:'   '},{type:'memo',id:'m',at:{x:0,y:0},text:'a',height:-1},{type:'memo',id:'m',text:'a'}])
  assert.throws(()=>normalizePadBatch({v:1,seq:1,ops:[op]}));
 assert.deepEqual(normalizePadBatch({v:1,seq:1,ops:[{type:'memo',id:'m',at:{x:1,y:2},text:'ok',evil:'x'}]}).ops[0],{type:'memo',id:'m',at:{x:1,y:2},text:'ok'});
});
test('office "received" notice is a separate sealed message, never a batch',async()=>{
 const key=randomToken(32),id=newPadSessionId(),ack=padAck(7);
 assert.ok(isPadAck(await openPadJson(await sealPadJson(ack,key,id),key,id)));assert.equal(ack.ack.received,7);
 assert.throws(()=>normalizePadBatch(ack));assert.equal(isPadAck({v:1,ops:[]}),false);
 assert.ok(cloudRing({x:0,y:0},{x:1000,y:400},200).length>20);
});
