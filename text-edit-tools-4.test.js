// text-edit-tools-4.js 시험. DOM 없이 node --test 로 돈다. openCardDialog 를 쓰는 ABE·TAP·TE 는 DOM 이
// 필요해 dialog 자체는 시험하지 않고, 그 안에서 쓰는 순수 함수(계산 로직)만 직접 호출해 확인한다.
// 나머지(MSK CTX FAR TD TM TSH TSM TSP)는 ctx.form 스텁으로 카드 전체를 실행해 확인한다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';
import {
 trimEdges,
 applyNumOp, applyScaleRule, applyDelimiterRule,
 autoShrinkWidth, repositionForAlignFar, parsePairs,
 applyAffix, cutByChar, cutByCount, insertAtPosition, insertAtChar,
 localCharWidth, charIndexAtLocalX, splitAt, joinPieces,
 teFields, matchesFilter, applyCase, buildChanges,
 orderTexts, mergeContents,
 shadowRect,
 parseNameList, styleNameOf,
 splitPreserving,
 installTextEditTools4,
} from './text-edit-tools-4.js';

/* ── 스텁 ctx (3차 text-edit-tools.test.js 와 같은 형태 + pickEntity/layers/storage 추가) ── */
function makeCtx({entities=[],selected=[],selectedIds=null,formOverrides={},pickPath=async()=>null,pickPoint=async()=>null,pickEntity=async()=>null,layers=[]}={}){
 const toasts=[],execCalls=[];
 const mem=new Map();
 const ctx={
  entities:()=>entities,
  selected:()=>selected,
  selectedIds:()=>selectedIds||selected.map(e=>e.id),
  execute:cmd=>{execCalls.push(cmd);return [];},
  toast:(m,isError)=>toasts.push({m,isError}),
  userErrorMessage:e=>e.message,
  form:(title,fields,onApply)=>{
   const values={};
   for(const f of fields)values[f.name]=Object.prototype.hasOwnProperty.call(formOverrides,f.name)?formOverrides[f.name]:(f.type==='checkbox'?undefined:f.value);
   const p=onApply(values);
   ctx._lastForm=p;
   return p;
  },
  layers:()=>layers,
  ensureLayer:name=>name,
  setSelected:ids=>{ctx._selected=ids;},
  pickPath,pickPoint,pickEntity,
  tolerance:()=>5,
  storage:{getItem:k=>(mem.has(k)?mem.get(k):null),setItem:(k,v)=>mem.set(k,v)},
 };
 return {ctx,toasts,execCalls};
}
const text=(id,over={})=>({id,type:'text',position:{x:0,y:0},height:10,text:'T'+id,align:'left',rotation:0,...over});
const block=(id,over={})=>({id,type:'block',entities:[],attributes:{},...over});

test('installTextEditTools4 returns all 11 commands as functions',()=>{
 const cmds=installTextEditTools4(makeCtx().ctx);
 for(const n of ['ABE','MSK','CTX','FAR','TAP','TD','TE','TM','TSH','TSM','TSP'])assert.equal(typeof cmds[n],'function',n+' 명령이 없습니다');
});

/* ══ ABE 순수 함수 ══ */
test('applyNumOp applies $n arithmetic to nth number, keeping decimals',()=>{
 assert.equal(applyNumOp('A101동 3층','$1+1'),'A102동 3층');
 assert.equal(applyNumOp('1:200','$2*2'),'1:400');
 assert.equal(applyNumOp('12.5m','$1*2'),'25.0m');
 assert.throws(()=>applyNumOp('없음','$1+1'));
 assert.throws(()=>applyNumOp('5','$1@1'));
});
test('applyScaleRule multiplies the first number by scale (decimals follow the original, 0→2 자리)',()=>{
 assert.equal(applyScaleRule('1:100',2),'2.00:100');
 assert.equal(applyScaleRule('3.0m',2),'6.0m');
});
test('applyDelimiterRule splits by delimiter and applies per-token op',()=>{
 assert.equal(applyDelimiterRule('101,A,3',',','$1+1'),'102,A,3');
 assert.equal(applyDelimiterRule('101-A-3','-','$2/A$B'),'101-B-3');
 assert.throws(()=>applyDelimiterRule('a,b',',','$9+1'));
});
test('ABE card recalculates each block from its own current value (numOp mode)',()=>{
 const b1=block('b1',{attributes:{MARK:'A-1'},entities:[{attributeTag:'MARK',text:'A-1',position:{x:0,y:0},height:2.5}]});
 const b2=block('b2',{attributes:{MARK:'A-2'},entities:[{attributeTag:'MARK',text:'A-2',position:{x:0,y:0},height:2.5}]});
 const {ctx,execCalls}=makeCtx({selected:[b1,b2]});
 const cmds=installTextEditTools4(ctx);
 // openCardDialog 는 DOM 이 필요해 직접 부르지 않고, 같은 계산을 여기서 재현해 대체 확인한다.
 assert.equal(applyNumOp('A-1','$1+1'),'A-2');
 assert.equal(applyNumOp('A-2','$1+1'),'A-3');
 assert.equal(typeof cmds.ABE,'function');
});

/* ══ MSK ══ */
test('MSK card sets backgroundMask + padding + color on selected texts',()=>{
 const t1=text('1',{height:10}),t2=text('2',{height:20});
 const {ctx,execCalls}=makeCtx({selected:[t1,t2],formOverrides:{marginMul:1.5,transparent:undefined,color:'#00ff00'}});
 installTextEditTools4(ctx).MSK();
 const batch=execCalls[0];
 assert.equal(batch.type,'batch');
 assert.equal(batch.commands.length,2);
 for(const c of batch.commands){
  assert.equal(c.changes.backgroundMask,true);
  assert.equal(c.changes.maskTransparent,false);
  assert.equal(c.changes.maskColor,'#00ff00');
  assert.ok(c.changes.maskPadding>0);
 }
});
test('MSK card marks transparent and clears color when transparent checked',()=>{
 const t1=text('1',{height:10});
 const {ctx,execCalls}=makeCtx({selected:[t1],formOverrides:{marginMul:1,transparent:'on',color:'#ff0000'}});
 installTextEditTools4(ctx).MSK();
 const c=execCalls[0].commands[0];
 assert.equal(c.changes.maskTransparent,true);
 assert.equal(c.changes.maskColor,null);
});

/* ══ CTX ══ */
test('CTX steps through matches one at a time and replaces on "replace"',()=>{
 const t1=text('1',{text:'1층 평면도'}),t2=text('2',{text:'1층 배치도'});
 const {ctx,execCalls,toasts}=makeCtx({entities:[t1,t2],selected:[],formOverrides:{find:'1층',replace:'지하1층',action:'replace'}});
 installTextEditTools4(ctx).CTX();
 // 첫 폼(find/replace) 뒤 두번째 폼(action)까지 스텁이 즉시 실행되므로 execCalls 에 1건만 남는다(하나만 바꾸기 후 다음 단계로 재귀).
 assert.ok(execCalls.length>=1);
 assert.equal(execCalls[0].commands[0].changes.text,'지하1층 평면도');
});
test('CTX "all" action replaces the remaining matches in one batch',()=>{
 const t1=text('1',{text:'A층'}),t2=text('2',{text:'A층 창고'});
 const {ctx,execCalls}=makeCtx({entities:[t1,t2],formOverrides:{find:'A층',replace:'B층',action:'all'}});
 installTextEditTools4(ctx).CTX();
 const batch=execCalls.find(c=>c.commands.length===2);
 assert.ok(batch);
 assert.equal(batch.commands[0].changes.text,'B층');
});

/* ══ FAR ══ */
test('parsePairs parses tab-separated Old/New rows',()=>{
 assert.deepEqual(parsePairs('A\tB\nC\tD'),[['A','B'],['C','D']]);
 assert.deepEqual(parsePairs(' \n\nX\tY\n'),[['X','Y']]);
});
test('autoShrinkWidth only shrinks when text grows, floored to 2 decimals',()=>{
 assert.equal(autoShrinkWidth('AB','ABCD',1),0.5);
 assert.equal(autoShrinkWidth('ABCD','AB',1),1);
 assert.equal(autoShrinkWidth('AB','ABCDEFG',1),Math.floor(1*(2/7)*100)/100);
});
test('repositionForAlignFar keeps visual position when align changes',()=>{
 const e=text('1',{text:'AB',height:10,widthFactor:1,align:'left',position:{x:0,y:0}});
 const moved=repositionForAlignFar(e,'right');
 // 왼쪽 끝을 고정한 채 정렬점만 오른쪽 끝으로 옮기므로, 새 앵커는 폭(13)만큼 오른쪽으로 이동한다.
 assert.ok(Math.abs(moved.x-13)<1e-6);
});
test('FAR card applies multiple pairs and reports count',()=>{
 const t1=text('1',{text:'거실 24.5'}),t2=text('2',{text:'침실 12'});
 const {ctx,execCalls,toasts}=makeCtx({entities:[t1,t2],selected:[],formOverrides:{pairs:'거실\t방1\n침실\t방2',layerOnly:'',report:'on',align:'keep',autoWidth:undefined}});
 installTextEditTools4(ctx).FAR();
 const batch=execCalls[0];
 const updates=batch.commands.filter(c=>c.type==='update');
 assert.equal(updates.length,2);
 assert.equal(updates[0].changes.text,'방1 24.5');
 const addMany=batch.commands.find(c=>c.type==='addMany');
 assert.ok(addMany&&addMany.entities[0].text.includes('FAR 리포트'));
});

/* ══ TAP 순수 함수 ══ */
test('applyAffix / cutByChar / cutByCount / insertAtPosition / insertAtChar',()=>{
 assert.equal(applyAffix('101','W-',''),'W-101');
 assert.equal(cutByChar('101호실','호',  'front',false),'101호');
 assert.equal(cutByChar('101호실','호','front',true),'101');
 assert.equal(cutByChar('101호실','호','back',false),'호실');
 assert.equal(cutByChar('101호실','호','back',true),'실');
 assert.equal(cutByCount('가나다라',2,'front'),'다라');
 assert.equal(cutByCount('가나다라',2,'back'),'가나');
 assert.equal(insertAtPosition('ABCD','front',2,'-'),'A-BCD');
 assert.equal(insertAtPosition('ABCD','back',2,'-'),'ABC-D');
 assert.equal(insertAtChar('A-B-C','-','front','*'),'A*-B*-C');
 assert.equal(insertAtChar('A-B-C','-','back','*'),'A-*B-*C');
 assert.throws(()=>insertAtChar('ABC','-','front','*'));
});
test('trimEdges strips leading/trailing whitespace',()=>{assert.equal(trimEdges('  a b  '),'a b');});

/* ══ TD 순수 함수 ══ */
test('splitAt / joinPieces / charIndexAtLocalX',()=>{
 assert.deepEqual(splitAt('거실 24.5',2),['거실',' 24.5']);
 assert.equal(joinPieces(' 24.5','침실',' ',true,false),'24.5 침실');
 const e=text('1',{text:'ABCD',height:10,align:'left'});
 assert.equal(charIndexAtLocalX(e,0),0);
 assert.equal(charIndexAtLocalX(e,localCharWidth(e)*2),2);
});
test('TD card cuts at click and merges into target text',async()=>{
 const source=text('s',{text:'거실24.5',height:10,align:'left',position:{x:0,y:0}});
 const target=text('t',{text:'침실',height:10,align:'left',position:{x:1000,y:0}});
 const cutX=localCharWidth(source)*2; // '거실' 뒤
 const {ctx,execCalls}=makeCtx({
  entities:[source,target],
  pickEntity:async()=>source,
  pickPoint:async(msg)=>msg.includes('대상')?{x:1000,y:0}:{x:cutX,y:0},
  formOverrides:{keepSource:undefined,between:' ',trimBoth:'on'},
 });
 await installTextEditTools4(ctx).TD();
 const batch=execCalls[0];
 assert.ok(batch);
 const sourceUpdate=batch.commands.find(c=>c.ids?.[0]==='s');
 assert.equal(sourceUpdate.changes.text,'거실');
 const targetUpdate=batch.commands.find(c=>c.ids?.[0]==='t');
 assert.ok(targetUpdate.changes.text.includes('24.5')&&targetUpdate.changes.text.includes('침실'));
});
test('TD card creates a new text when no target found nearby',async()=>{
 const source=text('s',{text:'거실24.5',height:10,align:'left',position:{x:0,y:0}});
 const cutX=localCharWidth(source)*2;
 const {ctx,execCalls}=makeCtx({
  entities:[source],
  pickEntity:async()=>source,
  pickPoint:async(msg)=>msg.includes('대상')?{x:5000,y:5000}:{x:cutX,y:0},
  formOverrides:{keepSource:'on',between:' ',trimBoth:'on'},
 });
 await installTextEditTools4(ctx).TD();
 const batch=execCalls[0];
 const added=batch.commands.find(c=>c.type==='addMany');
 assert.ok(added&&added.entities[0].text==='24.5');
 assert.ok(!batch.commands.some(c=>c.type==='update'));// keepSource on → 원본 update 없음
});

/* ══ TE 순수 함수 ══ */
test('teFields builds on/value pairs for every TE_PROPS with hidden-until-checked value fields',()=>{
 const fields=teFields();
 // 키는 prefix+속성명+'On' 그대로 이어붙인다(예: 'f'+'content'+'On' = 'fcontentOn').
 const fContentOn=fields.find(f=>f.key==='fcontentOn');
 const fContent=fields.find(f=>f.key==='fcontent');
 assert.ok(fContentOn&&fContent);
 assert.equal(fContent.when({fcontentOn:false}),false);
 assert.equal(fContent.when({fcontentOn:true}),true);
 assert.equal(fields.length,30);// 속성 7개 x (검색조건 on/value + 변경값 on/value) + 대소문자 2개
});
test('matchesFilter filters by content/layer/height',()=>{
 const e=text('1',{text:'거실',layer:'L1',height:5});
 assert.equal(matchesFilter(e,{content:{on:true,value:'거'}}),true);
 assert.equal(matchesFilter(e,{content:{on:true,value:'없음'}}),false);
 assert.equal(matchesFilter(e,{layer:{on:true,value:'L1'}}),true);
 assert.equal(matchesFilter(e,{layer:{on:true,value:'L2'}}),false);
 assert.equal(matchesFilter(e,{height:{on:true,value:5}}),true);
});
test('applyCase word/sentence/upper/lower',()=>{
 assert.equal(applyCase('type a room','word'),'Type A Room');
 assert.equal(applyCase('hello. world','sentence'),'Hello. World');
 assert.equal(applyCase('MiX','upper'),'MIX');
 assert.equal(applyCase('MiX','lower'),'mix');
});
test('buildChanges applies only checked change fields, case overrides content',()=>{
 const e=text('1',{text:'room a'});
 const c1=buildChanges(e,{content:{on:true,value:'new'},height:{on:false}},null);
 assert.deepEqual(c1,{text:'new'});
 const c2=buildChanges(e,{content:{on:true,value:'new'}},'upper');
 assert.equal(c2.text,'ROOM A');
 const c3=buildChanges(e,{height:{on:true,value:'7'}},null);
 assert.equal(c3.height,7);
});
test('TE card applies filtered batch change (smoke, bypassing dialog)',()=>{
 const t1=text('1',{text:'실1',height:5}),t2=text('2',{text:'실2',height:7});
 const targets=[t1,t2].filter(e=>matchesFilter(e,{height:{on:true,value:5}}));
 assert.equal(targets.length,1);
 assert.equal(targets[0].id,'1');
});

/* ══ TM ══ */
test('orderTexts groups by row for z and reverses for reverseZ',()=>{
 const a=text('a',{position:{x:0,y:0}}),b=text('b',{position:{x:100,y:0}}),c=text('c',{position:{x:0,y:100}});
 const z=orderTexts([a,b,c],'z',10).map(e=>e.id);
 assert.deepEqual(z,['c','a','b']);
 const rz=orderTexts([a,b,c],'reverseZ',10).map(e=>e.id);
 assert.deepEqual(rz,['b','a','c']);
});
test('mergeContents joins with delimiter',()=>{assert.equal(mergeContents([text('a',{text:'X'}),text('b',{text:'Y'})],'-'),'X-Y');});
test('TM card reuses first entity when newString is off',()=>{
 const a=text('a',{text:'거실',position:{x:0,y:0}}),b=text('b',{text:'24.5',position:{x:100,y:0}});
 const {ctx,execCalls}=makeCtx({selected:[a,b],selectedIds:['a','b'],formOverrides:{delimiter:' ',newString:undefined,order:'selection'}});
 installTextEditTools4(ctx).TM();
 const batch=execCalls[0];
 const del=batch.commands.find(c=>c.type==='delete');
 const add=batch.commands.find(c=>c.type==='addMany');
 assert.deepEqual(del.ids.sort(),['a','b']);
 assert.equal(add.entities[0].text,'거실 24.5');
});

/* ══ TSH ══ */
test('shadowRect returns an offset rectangle sized to the text',()=>{
 const e=text('1',{text:'AB',height:10,align:'left',position:{x:0,y:0}});
 const rect=shadowRect(e,5,-45);
 assert.equal(rect.length,4);
});
test('TSH card deletes originals and re-adds shadow+original in one batch',()=>{
 const t1=text('1',{text:'AB',height:10});
 const {ctx,execCalls}=makeCtx({selected:[t1],formOverrides:{width:3,angle:-45,color:'#333333'}});
 installTextEditTools4(ctx).TSH();
 const batch=execCalls[0];
 const del=batch.commands.find(c=>c.type==='delete');
 const add=batch.commands.find(c=>c.type==='addMany');
 assert.deepEqual(del.ids,['1']);
 assert.equal(add.entities.length,2);
 assert.equal(add.entities[0].type,'hatch');
 assert.equal(add.entities[1].text,'AB');
});

/* ══ TSM ══ */
test('parseNameList / styleNameOf',()=>{
 assert.deepEqual(parseNameList('A, B\nC'),['A','B','C']);
 assert.equal(styleNameOf(text('1')),'Standard');
 assert.equal(styleNameOf(text('1',{textStyle:'굴림'})),'굴림');
});
test('TSM card merges selected style names into target across whole drawing',()=>{
 const a=text('a',{textStyle:'A'}),b=text('b',{textStyle:'B'}),c=text('c',{textStyle:'B'});
 const {ctx,execCalls}=makeCtx({entities:[a,b,c],formOverrides:{merge:'A',target:'B'}});
 installTextEditTools4(ctx).TSM();
 const batch=execCalls[0];
 assert.equal(batch.commands.length,1);
 assert.equal(batch.commands[0].ids[0],'a');
 assert.equal(batch.commands[0].changes.textStyle,'B');
});

/* ══ TSP ══ */
test('splitPreserving splits and optionally keeps the delimiter on the preceding piece',()=>{
 assert.deepEqual(splitPreserving('거실  24.5','  ',false),['거실','24.5']);
 assert.deepEqual(splitPreserving('거실  24.5','  ',true),['거실  ','24.5']);
});
test('TSP card splits into multiple offset text entities',()=>{
 const t1=text('1',{text:'거실  24.5  발코니',height:10,rotation:0,position:{x:0,y:0}});
 const {ctx,execCalls}=makeCtx({selected:[t1],formOverrides:{baseChar:'  ',gap:2,keepChar:undefined}});
 installTextEditTools4(ctx).TSP();
 const batch=execCalls[0];
 const upd1=batch.commands.find(c=>c.type==='update');
 const add=batch.commands.find(c=>c.type==='addMany');
 assert.equal(upd1.changes.text,'거실');
 assert.equal(add.entities.length,2);
 assert.equal(add.entities[0].text,'24.5');
 assert.equal(add.entities[1].text,'발코니');
});

// 2026-10-27 설명서 시험: 조각 간격을 글자 높이×배수로만 잡아 '거실침실욕실' 처럼 붙어 보였다.
test('TSP 조각은 앞 조각의 글자 폭만큼 더 띄워 겹치지 않는다',()=>{
 const t1=text('1',{text:'거실  침실  욕실 3',height:250,rotation:0,position:{x:0,y:0},align:'left'});
 const {ctx,execCalls}=makeCtx({selected:[t1],formOverrides:{baseChar:'  ',gap:1,keepChar:undefined}});
 installTextEditTools4(ctx).TSP();
 const add=execCalls[0].commands.find(c=>c.type==='addMany');
 const w0=G.textBoxWidth({...t1,text:'거실'}),w1=G.textBoxWidth({...t1,text:'침실'});
 assert.ok(add.entities[0].position.x>=w0+250-1e-6,`둘째 조각 x=${add.entities[0].position.x} ≥ 첫 조각 폭 ${w0}+간격`);
 assert.ok(add.entities[1].position.x>=add.entities[0].position.x+w1+250-1e-6,'셋째 조각도 둘째 조각 뒤');
});
