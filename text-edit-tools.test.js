// text-edit-tools.js 시험. DOM 없이 node --test 로 돈다. 순수 함수는 좌표/문자열로 직접 확인하고,
// installTextEditTools 의 18개 명령은 최소 1건씩 가벼운 스텁 ctx(toast/execute/form/entities/selected 기록)로 확인한다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';
import {
 stripMtextFormat,
 textWidth,repositionForAlign,
 findEnclosingBoundary,boxAlignPoint,
 stackOffsets,
 rotateList,
 firstNumberOf,replaceFirstNumber,
 extractSubstring,
 installTextEditTools,
 evaluateFieldCode,freezeFieldText,freezeFieldEntity,textStyleResetChanges,textFrameFixChanges,
} from './text-edit-tools.js';

/* ── 스텁 ctx. ctx.form 은 onApply 를 즉시(동기) 호출하고 반환값(프라미스일 수 있음)을 ctx._lastForm 에 남긴다. ── */
function makeCtx({entities=[],selected=[],selectedIds=null,formOverrides={},pickPath=async()=>null}={}){
 const toasts=[],execCalls=[];
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
  ensureLayer:name=>name,
  setSelected:ids=>{ctx._selected=ids;},
  pickPath,
 };
 return {ctx,toasts,execCalls};
}
const text=(id,over={})=>({id,type:'text',position:{x:0,y:0},height:10,text:'T'+id,align:'left',rotation:0,...over});

/* ══ installTextEditTools: 18개 명령이 전부 함수로 반환되는지 ══ */
test('installTextEditTools returns all 18 commands as functions',()=>{
 const cmds=installTextEditTools(makeCtx().ctx);
 const names=['A2M','FTT','MDF','T2M','TFF','FAM','TC','TJ','TO','TOA','TS','TSA','TSE','TSO','TST','TSW','TW','TEC'];
 assert.equal(Object.keys(cmds).length,18);
 for(const n of names)assert.equal(typeof cmds[n],'function',n+' 명령이 없습니다');
});

/* ══ MDF: stripMtextFormat 서식코드 제거 ══ */
test('stripMtextFormat removes format codes, optionally keeping \\P as newline',()=>{
 const src='\\A1;A\\Pb\\H1.5x;{c}\\C1;d%%uE%%u';
 assert.equal(stripMtextFormat(src,true),'A\nbcdE');
 assert.equal(stripMtextFormat(src,false),'AbcdE');
 assert.equal(stripMtextFormat('plain text',true),'plain text');
});
test('MDF card strips format codes from selected texts',()=>{
 const t1=text('1',{text:'A\\PB'}),t2=text('2',{text:'clean'});
 const {ctx,execCalls,toasts}=makeCtx({selected:[t1,t2],formOverrides:{keep:'on'}});
 const cmds=installTextEditTools(ctx);
 cmds.MDF();
 assert.equal(execCalls.length,1);
 assert.deepEqual(execCalls[0],{type:'batch',commands:[{type:'update',ids:['1'],changes:{text:'A\nB'}}]});
 assert.equal(toasts.length,1);
});

/* ══ TJ: textWidth/repositionForAlign — 화면 위치를 유지한 채 정렬점만 바뀌는지 ══ */
test('textWidth approximates rendered width (chars × height × 0.65 × widthFactor)',()=>{
 assert.equal(textWidth({text:'AB',height:10,widthFactor:2}),2*10*0.65*2);
 assert.equal(textWidth({text:'A\nBBB',height:4}),3*4*0.65); // 가장 긴 줄(3글자) 기준
});
test('repositionForAlign keeps on-screen position when align changes (rotation 0)',()=>{
 const e={position:{x:0,y:0},text:'AB',height:10,widthFactor:1,align:'left',rotation:0};
 const width=textWidth(e); // 13
 const toCenter=repositionForAlign(e,'center');
 assert.ok(Math.abs(toCenter.x-width/2)<1e-9);
 assert.ok(Math.abs(toCenter.y)<1e-9);
 const toRight=repositionForAlign(e,'right');
 assert.ok(Math.abs(toRight.x-width)<1e-9);
});
test('repositionForAlign rotates the shift with the text (rotation 90)',()=>{
 const e={position:{x:5,y:5},text:'AB',height:10,widthFactor:1,align:'left',rotation:90};
 const width=textWidth(e);
 const moved=repositionForAlign(e,'center');
 assert.ok(Math.abs(moved.x-5)<1e-9); // 90도 회전이면 폭 보정이 y축으로 간다
 assert.ok(Math.abs(moved.y-(5+width/2))<1e-9);
});
test('TJ card keeps screen position while changing align, skips texts already at target',()=>{
 const t1=text('1',{text:'AB',align:'left'}),t2=text('2',{text:'CD',align:'center'});
 const {ctx,execCalls}=makeCtx({selected:[t1,t2],formOverrides:{align:'center'}});
 const cmds=installTextEditTools(ctx);
 cmds.TJ();
 assert.equal(execCalls.length,1);
 assert.equal(execCalls[0].commands.length,1); // t2 는 이미 center 라 건드리지 않는다
 assert.equal(execCalls[0].commands[0].ids[0],'1');
 assert.equal(execCalls[0].commands[0].changes.align,'center');
});

/* ══ TOA: findEnclosingBoundary/boxAlignPoint ══ */
test('findEnclosingBoundary finds the smallest closed shape containing the point, null otherwise',()=>{
 const outer={type:'rectangle',points:G.rectangle({x:0,y:0},{x:100,y:100})};
 const inner={type:'polyline',closed:true,points:G.rectangle({x:10,y:10},{x:30,y:30})};
 const circle={type:'circle',center:{x:200,y:200},radius:5};
 assert.equal(findEnclosingBoundary([outer,inner,circle],{x:20,y:20}),inner);
 assert.equal(findEnclosingBoundary([outer,inner,circle],{x:50,y:50}),outer);
 assert.equal(findEnclosingBoundary([outer,inner,circle],{x:200,y:201}),circle);
 assert.equal(findEnclosingBoundary([outer,inner,circle],{x:500,y:500}),null);
});
test('boxAlignPoint places 9 directions inside the box with the right align',()=>{
 const box={minX:0,minY:0,maxX:100,maxY:50};
 assert.deepEqual(boxAlignPoint(box,'Q',5,10),{x:5,y:35,align:'left'});
 assert.deepEqual(boxAlignPoint(box,'S',5,10),{x:50,y:20,align:'center'});
 assert.deepEqual(boxAlignPoint(box,'C',5,10),{x:95,y:5,align:'right'});
});
test('TOA card aligns texts inside their enclosing boundary, counts skipped',()=>{
 const box={type:'rectangle',points:G.rectangle({x:0,y:0},{x:100,y:50})};
 const inside=text('1',{position:{x:20,y:20},height:10});
 const outside=text('2',{position:{x:999,y:999},height:10});
 const {ctx,execCalls,toasts}=makeCtx({entities:[box,inside,outside],selected:[inside,outside],formOverrides:{corner:'S',gapMul:1.2}});
 const cmds=installTextEditTools(ctx);
 cmds.TOA();
 assert.equal(execCalls.length,1);
 assert.equal(execCalls[0].commands.length,1); // outside 는 담는 도형이 없어 건너뜀
 assert.equal(execCalls[0].commands[0].ids[0],'1');
 assert.match(toasts.at(-1).m,/건너뜀/);
});

/* ══ TO: stackOffsets, 사각형 중심으로 모으기(픽 두 점) ══ */
test('stackOffsets centers n items around 0 with the given gap',()=>{
 assert.deepEqual(stackOffsets(1,10),[0]);
 assert.deepEqual(stackOffsets(3,10),[10,0,-10]);
 assert.deepEqual(stackOffsets(2,4),[2,-2]);
});
test('TO card stacks up to 3 texts at the rectangle center',async()=>{
 const t1=text('1',{position:{x:1,y:1},height:10}),t2=text('2',{position:{x:2,y:2},height:10});
 const {ctx,execCalls}=makeCtx({selected:[t1,t2],selectedIds:['1','2'],formOverrides:{gap:1},pickPath:async()=>({points:[{x:0,y:0},{x:20,y:20}]})});
 const cmds=installTextEditTools(ctx);
 cmds.TO();
 await ctx._lastForm;
 assert.equal(execCalls.length,1);
 const [c1,c2]=execCalls[0].commands;
 assert.equal(c1.changes.position.x,10);assert.equal(c1.changes.position.y,10+5); // gap*height/2 = 1*10/2
 assert.equal(c2.changes.position.y,10-5);
});

/* ══ TSW: rotateList ══ */
test('rotateList shifts values by one (true swap for 2 items)',()=>{
 assert.deepEqual(rotateList(['a','b']),['b','a']);
 assert.deepEqual(rotateList(['a','b','c']),['b','c','a']);
});
test('TSW card swaps content between selected texts',()=>{
 const t1=text('1',{text:'실1',position:{x:0,y:0}}),t2=text('2',{text:'실2',position:{x:10,y:0}});
 const {ctx,execCalls}=makeCtx({selected:[t1,t2],selectedIds:['1','2']});
 const cmds=installTextEditTools(ctx);
 cmds.TSW();
 assert.equal(execCalls.length,1);
 const [c1,c2]=execCalls[0].commands;
 assert.equal(c1.changes.text,'실2');
 assert.equal(c2.changes.text,'실1');
});

/* ══ TC: firstNumberOf/replaceFirstNumber, 하나:다수/숫자만 ══ */
test('firstNumberOf/replaceFirstNumber',()=>{
 assert.equal(firstNumberOf('거실 24.5㎡'),'24.5');
 assert.throws(()=>firstNumberOf('숫자없음'));
 assert.equal(replaceFirstNumber('(거실:31.7 평)','34.2'),'(거실:34.2 평)');
 assert.throws(()=>replaceFirstNumber('숫자없음','1'));
});
test('TC card broadcasts source content to all targets (하나:다수)',()=>{
 const src=text('1',{text:'W-1'}),t1=text('2',{text:'old'}),t2=text('3',{text:'old2'});
 const {ctx,execCalls}=makeCtx({selected:[src,t1,t2],selectedIds:['1','2','3']});
 const cmds=installTextEditTools(ctx);
 cmds.TC();
 assert.equal(execCalls.length,1);
 assert.equal(execCalls[0].commands.length,2);
 for(const c of execCalls[0].commands)assert.equal(c.changes.text,'W-1');
});
test('TC card numbersOnly mode replaces only the numeric token',()=>{
 const src=text('1',{text:'34.2'}),t1=text('2',{text:'(거실:31.7 평)'});
 const {ctx,execCalls}=makeCtx({selected:[src,t1],selectedIds:['1','2'],formOverrides:{mode:'numbersOnly'}});
 const cmds=installTextEditTools(ctx);
 cmds.TC();
 assert.equal(execCalls[0].commands[0].changes.text,'(거실:34.2 평)');
});

/* ══ TEC(추정): extractSubstring ══ */
test('extractSubstring slices 1-based start/length, validates input',()=>{
 assert.equal(extractSubstring('hello world',1,5),'hello');
 assert.equal(extractSubstring('hello world',7,5),'world');
 assert.throws(()=>extractSubstring('hi',0,1));
 assert.throws(()=>extractSubstring('hi',1,0));
});
test('TEC card copies the extracted piece to targets (replace by default)',()=>{
 const src=text('1',{text:'거실 24.5㎡'}),t1=text('2',{text:'old'});
 const {ctx,execCalls}=makeCtx({selected:[src,t1],selectedIds:['1','2'],formOverrides:{start:4,length:4}});
 const cmds=installTextEditTools(ctx);
 cmds.TEC();
 assert.equal(execCalls[0].commands[0].changes.text,'24.5');
});

/* ══ T2M: 단행문자를 다행문자(줄바꿈 포함 text)로 합치기 ══ */
test('T2M card merges selected texts into one newline-joined text, deletes the rest by default',()=>{
 const t1=text('1',{text:'거실'}),t2=text('2',{text:'24.5㎡'});
 const {ctx,execCalls}=makeCtx({selected:[t1,t2],selectedIds:['1','2']});
 const cmds=installTextEditTools(ctx);
 cmds.T2M();
 assert.equal(execCalls.length,1);
 const [mergeCmd,deleteCmd]=execCalls[0].commands;
 assert.equal(mergeCmd.changes.text,'거실\n24.5㎡');
 assert.deepEqual(deleteCmd,{type:'delete',ids:['2']});
});
test('T2M card keeps originals when requested',()=>{
 const t1=text('1',{text:'A'}),t2=text('2',{text:'B'});
 const {ctx,execCalls}=makeCtx({selected:[t1,t2],selectedIds:['1','2'],formOverrides:{keepOriginals:'on'}});
 const cmds=installTextEditTools(ctx);
 cmds.T2M();
 assert.equal(execCalls[0].commands.length,1); // 삭제 명령이 없다
});

/* ══ A2M: 속성블럭 문자 뽑아내기 ══ */
test('A2M card extracts attribute-tagged child texts and detaches them from the block',()=>{
 const block={id:'B1',type:'block',layer:'L0',attributes:{MARK:'A-1'},entities:[
  {type:'text',attributeTag:'MARK',position:{x:5,y:5},height:3,rotation:0,align:'left',text:'A-1'},
 ]};
 const {ctx,execCalls}=makeCtx({selected:[block]}); // 기본 모드: multi, withTag 꺼짐
 const cmds=installTextEditTools(ctx);
 cmds.A2M();
 assert.equal(execCalls.length,1);
 const [removeBlock,addMany]=execCalls[0].commands;
 // 속성 문자만 있던 블록은 다 뽑으면 빈 블록이 되는데 도면 엔진은 빈 블록을 받지 않는다 → 블록을 지운다(2026-10-27 설명서 시험).
 assert.deepEqual(removeBlock,{type:'delete',ids:['B1']});
 assert.equal(addMany.entities.length,1);
 assert.equal(addMany.entities[0].text,'A-1');
});
test('A2M card tags values with "태그: 값" when requested',()=>{
 const block={id:'B1',type:'block',layer:'L0',attributes:{MARK:'A-1'},entities:[
  {type:'text',attributeTag:'MARK',position:{x:5,y:5},height:3,rotation:0,align:'left',text:'A-1'},
 ]};
 const {ctx,execCalls}=makeCtx({selected:[block],formOverrides:{withTag:'on'}});
 const cmds=installTextEditTools(ctx);
 cmds.A2M();
 assert.equal(execCalls[0].commands[1].entities[0].text,'MARK: A-1');
});
test('A2M card is honest when nothing has attribute tags (toast, no execute)',()=>{
 const block={id:'B1',type:'block',entities:[]};
 const {ctx,execCalls,toasts}=makeCtx({selected:[block]});
 const cmds=installTextEditTools(ctx);
 cmds.A2M();
 assert.equal(execCalls.length,0);
 assert.equal(toasts.length,1);
 assert.match(toasts[0].m,/속성 태그/);
});

/* ══ FTT/TFF: 정직한 "없음" 카드 — 엔진에 없는 개념이라 실행해도 아무 것도 바뀌지 않는다 ══ */
/* ══ FTT (2026-09-24 F13 실제 동작): 살아있는 면적 문자·%<>% 필드식·블록 안 문자를 고정한다 ══ */
test('FTT freezes live-area texts and %<>% field expressions, leaves plain texts untouched',()=>{
 const live=text('1',{text:'3.00 ㎡',darSourceId:'room'});
 const fld=text('2',{text:'날짜: %<\\AcVar Date \\f "yyyy-MM-dd">% / 면적 %<\\AcObjProp Object(1).Area>%'});
 const created=text('4',{text:'%<\\AcVar CreateDate>%'});
 const plain=text('3');
 const block={id:'b',type:'block',name:'TB',position:{x:0,y:0},entities:[{type:'text',text:'%<\\AcVar Time>%',position:{x:0,y:0},height:5}]};
 const {ctx,execCalls,toasts}=makeCtx({entities:[live,fld,plain,block,created],selected:[],formOverrides:{onScreen:'',plain:'on',inBlocks:'on',inTables:'on',skipLocked:''},});
 ctx.layers=()=>[];
 installTextEditTools(ctx).FTT();
 assert.equal(execCalls.length,1);
 const cmds=execCalls[0].commands;
 assert.deepEqual(cmds.map(c=>c.ids[0]).sort(),['1','2','b'],'작성일(CreateDate)만 있는 문자는 손대지 않는다');
 assert.equal(cmds.find(c=>c.ids[0]==='1').changes.darSourceId,null);
 const frozen=cmds.find(c=>c.ids[0]==='2').changes.text;
 // 검토자 지적 13: 평가할 수 없는 객체 속성 필드는 #### 로 바꾸지 않고 원문을 남긴다
 assert.match(frozen,/^날짜: \d{4}-\d{2}-\d{2} \/ 면적 %<\\AcObjProp Object\(1\)\.Area>%$/);
 assert.match(cmds.find(c=>c.ids[0]==='b').changes.entities[0].text,/^\d{2}:\d{2}$/);
 assert.match(toasts[0].m,/필드 문자 3개/);
 assert.match(toasts[0].m,/평가할 수 없는 필드식 2개/);
 assert.equal(freezeFieldText('그냥 문자'),null);
 assert.equal(evaluateFieldCode('\\AcObjProp x'),null);
 assert.equal(freezeFieldText('%<\\AcVar CreateDate>%'),null);
 assert.equal(freezeFieldEntity(plain),null);
});
test('FTT with nothing to freeze toasts the checked count and does not execute',()=>{
 const {ctx,execCalls,toasts}=makeCtx({entities:[text('1')],formOverrides:{onScreen:'',plain:'on',inBlocks:'on',inTables:'on'}});
 ctx.layers=()=>[];
 installTextEditTools(ctx).FTT();
 assert.equal(execCalls.length,0);
 assert.match(toasts[0].m,/필드 문자가 없습니다/);
});
/* ══ MDF: 서식코드 + 문자 속성 초기화 ══ */
test('MDF resets font/width/color/mask overrides together with format codes',()=>{
 const styled=text('1',{text:'{\\fArial|b1;굵게} 글자',widthFactor:0.8,color:'#ff0000',backgroundMask:true,maskPadding:3});
 const {ctx,execCalls}=makeCtx({selected:[styled],formOverrides:{props:'on'}});
 installTextEditTools(ctx).MDF();
 const changes=execCalls[0].commands[0].changes;
 assert.equal(changes.text,'굵게 글자');
 assert.equal(changes.widthFactor,null);assert.equal(changes.color,null);assert.equal(changes.backgroundMask,false);
 assert.equal(textStyleResetChanges(text('2')),null);
 // 검토자 지적 6: 기본(속성 초기화 끔)은 서식코드만 지우고 폭비율·색은 남긴다
 const def=makeCtx({selected:[text('3',{text:'{\\fArial|b1;굵게} 글자',widthFactor:0.8,color:'#ff0000'})]});
 installTextEditTools(def.ctx).MDF();
 assert.deepEqual(def.execCalls[0].commands[0].changes,{text:'굵게 글자'});
});
/* ══ TFF (2026-09-24 F13 실제 동작): 참조상자 폭·여백·폭비율을 실제 문자 크기에 맞춘다 ══ */
test('TFF fits reference-box width, mask padding and width factor to the real text size',()=>{
 const boxed=text('1',{text:'ABC',width:9999,widthFactor:0,backgroundMask:true,maskPadding:500});
 const changes=textFrameFixChanges(boxed);
 assert.equal(changes.width,3*10*0.65);
 assert.equal(changes.widthFactor,null);
 assert.equal(changes.maskPadding,2.5);
 assert.equal(textFrameFixChanges(text('2')),null);
 const {ctx,execCalls,toasts}=makeCtx({selected:[boxed,text('2')]});
 installTextEditTools(ctx).TFF();
 assert.equal(execCalls.length,1);
 assert.equal(execCalls[0].commands.length,1);
 assert.match(toasts[0].m,/테두리/);
 const none=makeCtx({selected:[text('3')]});
 installTextEditTools(none.ctx).TFF();
 assert.equal(none.execCalls.length,0);
 assert.match(none.toasts[0].m,/이미 맞습니다/);
});

/* ══ FAM: 찾아표시/갯수세기/선택만 ══ */
test('FAM card marks matches with circles on the symbol layer',()=>{
 const t1=text('1',{text:'거실'}),t2=text('2',{text:'침실'});
 const {ctx,execCalls}=makeCtx({selected:[t1,t2],formOverrides:{query:'거실'}});
 const cmds=installTextEditTools(ctx);
 cmds.FAM();
 assert.equal(execCalls.length,1);
 assert.equal(execCalls[0].commands[0].entities.length,1);
 assert.equal(execCalls[0].commands[0].entities[0].type,'circle');
});
test('FAM card counts matches without creating anything',()=>{
 const t1=text('1',{text:'거실 A'}),t2=text('2',{text:'거실 B'}),t3=text('3',{text:'침실'});
 const {ctx,execCalls,toasts}=makeCtx({selected:[t1,t2,t3],formOverrides:{query:'거실',mode:'count'}});
 const cmds=installTextEditTools(ctx);
 cmds.FAM();
 assert.equal(execCalls.length,0);
 assert.match(toasts.at(-1).m,/2개/);
});
test('FAM card select mode only selects matches',()=>{
 const t1=text('1',{text:'거실'}),t2=text('2',{text:'침실'});
 const {ctx,execCalls}=makeCtx({selected:[t1,t2],formOverrides:{query:'거실',mode:'select'}});
 const cmds=installTextEditTools(ctx);
 cmds.FAM();
 assert.equal(execCalls.length,0);
 assert.deepEqual(ctx._selected,['1']);
});

/* ══ TS: 절대/배수 ══ */
test('TS card sets absolute height or multiplies existing height',()=>{
 const t1=text('1',{height:10});
 let {ctx,execCalls}=makeCtx({selected:[t1],formOverrides:{mode:'absolute',value:5}});
 installTextEditTools(ctx).TS();
 assert.equal(execCalls[0].commands[0].changes.height,5);
 ({ctx,execCalls}=makeCtx({selected:[t1],formOverrides:{mode:'multiply',value:2}}));
 installTextEditTools(ctx).TS();
 assert.equal(execCalls[0].commands[0].changes.height,20);
});

/* ══ TW: 값 입력/참조 복사 ══ */
test('TW card sets widthFactor by value or copies from the first selected reference',()=>{
 const t1=text('1',{}),t2=text('2',{widthFactor:0.8});
 let {ctx,execCalls}=makeCtx({selected:[t1],formOverrides:{mode:'value',value:0.7}});
 installTextEditTools(ctx).TW();
 assert.equal(execCalls[0].commands[0].changes.widthFactor,0.7);
 ({ctx,execCalls}=makeCtx({selected:[t2,t1],selectedIds:['2','1'],formOverrides:{mode:'reference'}}));
 installTextEditTools(ctx).TW();
 assert.equal(execCalls[0].commands[0].changes.widthFactor,0.8);
});

/* ══ TSA/TST: 화면에는 반영 안 되는 저장값(기존 TEXTSTYLEMERGE 와 같은 한계) ══ */
test('TSA card stores font name on selection, or whole drawing when nothing is selected',()=>{
 const t1=text('1'),t2=text('2');
 let {ctx,execCalls}=makeCtx({selected:[t1],entities:[t1,t2],formOverrides:{font:'Gungsuh'}});
 installTextEditTools(ctx).TSA();
 assert.equal(execCalls[0].commands.length,1);
 ({ctx,execCalls}=makeCtx({selected:[],entities:[t1,t2],formOverrides:{font:'Gungsuh'}}));
 installTextEditTools(ctx).TSA();
 assert.equal(execCalls[0].commands.length,2);
});
test('TST card copies style fields from the first selected reference text',()=>{
 const ref=text('1',{textStyle:'Style-A',sourceFont:'A.shx'}),t2=text('2',{});
 const {ctx,execCalls}=makeCtx({selected:[ref,t2],selectedIds:['1','2']});
 installTextEditTools(ctx).TST();
 assert.equal(execCalls[0].commands[0].changes.textStyle,'Style-A');
});

/* ══ TSO: 수직 줄맞춤 ══ */
test('TSO card stacks texts vertically by gap × height, sorted top-to-bottom',()=>{
 const t1=text('1',{position:{x:0,y:0},height:10}),t2=text('2',{position:{x:0,y:100},height:10});
 const {ctx,execCalls}=makeCtx({selected:[t1,t2],formOverrides:{direction:'vertical',gap:2}});
 installTextEditTools(ctx).TSO();
 const [first,second]=execCalls[0].commands;
 assert.equal(first.ids[0],'2'); // 더 위(y 큼)가 기준이라 그대로
 assert.equal(first.changes.position.y,100);
 assert.equal(second.changes.position.y,100-20);
});

/* ══ TSE: 순차 편집(건너뛰기 지원) ══ */
test('TSE card walks selected texts one by one and stops after the last one',()=>{
 const t1=text('1',{text:'a'}),t2=text('2',{text:'b'});
 const {ctx,execCalls,toasts}=makeCtx({selected:[t1,t2],selectedIds:['1','2']}); // 값 override 없음 → 매번 원래 내용 그대로(무변경)
 installTextEditTools(ctx).TSE();
 assert.equal(execCalls.length,0); // 아무 것도 안 바꿨으니 update 호출 없음
 assert.match(toasts.at(-1).m,/마쳤습니다/);
});
test('TSE card applies edited content when it differs from the original',()=>{
 const t1=text('1',{text:'a'});
 const {ctx,execCalls}=makeCtx({selected:[t1],selectedIds:['1'],formOverrides:{text:'변경됨'}});
 installTextEditTools(ctx).TSE();
 assert.equal(execCalls.length,1);
 assert.equal(execCalls[0].commands[0].changes.text,'변경됨');
});

// 2026-10-27 설명서 시험: ; 없이 끝나는 코드(\L \l \O \o \K \k \~ \\ \{ \})를 ; 까지 건너뛰어 뒤 글자가 사라졌다.
test('stripMtextFormat: ; 없는 서식코드 뒤 글자를 지우지 않는다(밑줄·윗줄·취소선·띄어쓰기·탈출 문자, 분수)',()=>{
 assert.equal(stripMtextFormat('{\\C1;거실} Room \\L12\\l㎡',false),'거실 Room 12㎡');
 assert.equal(stripMtextFormat('\\Oover\\o \\Kstrike\\k',false),'over strike');
 assert.equal(stripMtextFormat('a\\~b \\\\ \\{x\\}',false),'a b \\ {x}');
 assert.equal(stripMtextFormat('\\S1/2;"',false),'1/2"');
});
