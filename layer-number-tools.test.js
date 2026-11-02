// layer-number-tools.js 시험(H12·H07 레이어 번호). node --test 로 돈다. 화면 없이 실제 DrawingEngine 과 app.js 와 같은 모양의 ctx 로 부른다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine,newDrawingDocument} from './engine.js';
import {BARUN_LAYERS} from './architecture.js';
import {markCardRepeat} from './card-kit.js';
import {
 LAYER_NUMBER_STORAGE_KEY,standardLayerSpecs,defaultLayerNumbers,validateLayerNumbers,parseLayerNumberText,formatLayerNumberText,
 loadLayerNumbers,saveLayerNumbers,resetLayerNumbers,layerNumberIndex,sortLayersForDisplay,layerSpecFor,parseLayerNumberCommand,resolveLayerNumberAction,
 applyLayerNumber,runLayerNumberInput,installLayerNumberTools,parseLayerNumberScope,
} from './layer-number-tools.js';

const P=(x,y)=>({x,y});
function memoryStorage(initial={}){const m=new Map(Object.entries(initial));return {map:m,getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};}
/* 표준 레이어가 있는 새 도면 + 선 몇 개. layerOf(name) 는 레이어 id. */
function drawing({standard=true}={}){
 const engine=new DrawingEngine();
 if(standard)engine.doc=newDrawingDocument();
 const layerOf=name=>engine.doc.layers.find(l=>l.name===name)?.id;
 return {engine,layerOf};
}
function addLines(engine,items){return engine.execute({type:'addMany',entities:items.map(([layer,y])=>({type:'line',layer,points:[P(0,y),P(1000,y)]}))});}
/* app.js cardContext 와 같은 이름의 문맥. run(fn) 은 runCardCommand 처럼, 폼 [적용]은 cardFormApply 처럼 되돌리기 한 단계로 묶는다. */
function makeCtx(engine,{storage=memoryStorage(),selection=[],transact=false}={}){
 const toasts=[],forms=[],logs=[];let active=engine.doc.layers[0].id;
 const wrap=fn=>{engine.beginTransaction();try{return fn();}finally{engine.endTransaction();}};
 const ctx={
  storage,toasts,forms,logs,
  entities:()=>engine.doc.entities,layers:()=>engine.doc.layers,
  selected:()=>engine.doc.entities.filter(e=>selection.includes(e.id)),
  ensureLayer:(name,color)=>{const f=engine.doc.layers.find(l=>l.name===name);if(f)return f.id;engine.execute({type:'layer.add',name,color});return engine.doc.layers.find(l=>l.name===name).id;},
  execute:c=>engine.execute(c),
  form:(title,fields,onApply)=>forms.push({title,fields,apply:values=>wrap(()=>onApply(values))}),
  activeLayer:()=>active,setActiveLayer:id=>{if(engine.doc.layers.some(l=>l.id===id))active=id;},
  toast:(m,isError)=>toasts.push({m:String(m),isError:!!isError}),log:m=>logs.push(m),refresh(){},
  select:ids=>{selection=ids;},
  run:fn=>wrap(fn),
 };
 if(transact)ctx.transact=wrap;
 return ctx;
}
const lastToast=ctx=>ctx.toasts.at(-1)?.m||'';

/* ── 번호표 ── */
test('화면 레이어 순서: 번호 오름차순 뒤 한국어 이름순, 원본 배열·객체·번호표 보존', () => {
 const names=['차','A-EIGHT','A-TWENTY-THREE','가','A-TWENTY-FOUR','a-ten','나','A-TWENTY-FIVE'];
 const layers=Object.freeze(names.map((name,i)=>Object.freeze({id:String(i),name})));
 const layerNumbers=layerNumberIndex(memoryStorage({[LAYER_NUMBER_STORAGE_KEY]:JSON.stringify({version:1,entries:[
  {no:8,name:'A-EIGHT'},{no:23,name:'A-TWENTY-THREE'},{no:24,name:'A-TWENTY-FOUR'},
  {no:10,name:'A-TEN'},{no:25,name:'A-TWENTY-FIVE'},
 ]})}));
 const beforeNumbers=[...layerNumbers],sorted=sortLayersForDisplay(layers,layerNumbers);
 assert.deepEqual(sorted.map(layer=>layer.name),['A-EIGHT','a-ten','A-TWENTY-THREE','A-TWENTY-FOUR','A-TWENTY-FIVE','가','나','차']);
 assert.notEqual(sorted,layers);
 assert.deepEqual(layers.map(layer=>layer.name),names,'도면·저장·DXF에 쓰는 배열 순서 불변');
 assert.ok(sorted.every(layer=>layers.includes(layer)),'레이어 객체를 복제하거나 수정하지 않음');
 assert.deepEqual([...layerNumbers],beforeNumbers);
 assert.deepEqual(sortLayersForDisplay([],layerNumbers),[]);
 assert.deepEqual(sortLayersForDisplay(layers,new Map()).map(layer=>layer.name),[...names].sort((a,b)=>a.localeCompare(b,'ko')));
});

test('기본 번호표: 표준 레이어에서 만들고 1=A-WALL 2=A-GLAZ 3=A-DOOR, 번호는 1부터 빈틈없이 99 이하', () => {
 const list=defaultLayerNumbers();
 assert.deepEqual(list.slice(0,3),[{no:1,name:'A-WALL'},{no:2,name:'A-GLAZ'},{no:3,name:'A-DOOR'}]);
 const standard=new Set(BARUN_LAYERS.map(l=>l.name));
 assert.ok(list.every(e=>standard.has(e.name)),'모두 표준 레이어');
 assert.equal(list.length,Math.min(99,standard.size),'표준 레이어 전부');
 assert.deepEqual(list.map(e=>e.no),list.map((_,i)=>i+1));
 assert.doesNotThrow(()=>validateLayerNumbers(list));
 const specs=standardLayerSpecs();
 assert.equal(specs.find(s=>s.name==='A-CNTR').linetype,'CENTER');assert.equal(specs.find(s=>s.name==='A-DOOR').linetype,'CONTINUOUS');
 assert.deepEqual(layerSpecFor({no:3,name:'a-door'},specs),{name:'a-door',color:'#00ff00',linetype:'CONTINUOUS',lineweight:0.18,label:'문'});
 assert.deepEqual(layerSpecFor({no:50,name:'X-MINE',color:'#123456',linetype:'DASHED'},specs),{name:'X-MINE',color:'#123456',linetype:'DASHED',label:''});
});

test('번호표 검사: 번호 1~99 정수, 번호·이름(대소문자 무시) 중복 불가, 이름·색·선종류 형식', () => {
 assert.throws(()=>validateLayerNumbers([{no:1,name:'A'},{no:1,name:'B'}]),/1번이 두 번/);
 assert.throws(()=>validateLayerNumbers([{no:1,name:'A-WALL'},{no:2,name:'a-wall'}]),/1번과 2번에 겹칩니다/);
 for(const no of [0,100,1.5,'x','',null,-3])assert.throws(()=>validateLayerNumbers([{no,name:'A'}]),/1~99 사이 정수/,String(no));
 assert.throws(()=>validateLayerNumbers([{no:1,name:'  '}]),/이름이 비었습니다/);
 assert.throws(()=>validateLayerNumbers([{no:1,name:'A/B'}]),/쓸 수 없는 문자/);
 assert.throws(()=>validateLayerNumbers([{no:1,name:'A',color:'red'}]),/#RRGGBB/);
 assert.throws(()=>validateLayerNumbers([{no:1,name:'A',linetype:'점 선'}]),/선종류 이름/);
 assert.throws(()=>validateLayerNumbers('1=A'),/형식이 올바르지/);
 assert.deepEqual(validateLayerNumbers([{no:'12',name:' B '},{no:3,name:'A',color:'#AABBCC',linetype:'dashed'}]),[{no:3,name:'A',color:'#aabbcc',linetype:'DASHED'},{no:12,name:'B'}]);
 assert.deepEqual(validateLayerNumbers([]),[]);
});

test('번호표 글: "번호 = 이름, #색, 선종류" 한 줄씩, 메모·빈 줄 무시, 틀린 줄은 줄 번호와 함께 알린다', () => {
 const text='; 우리 사무소\n1 = A-WALL\n\n2: A-GLAZ\n3 A-DOOR\n12 = X-FURN-FIX, #FF00FF, dashed';
 const list=parseLayerNumberText(text);
 assert.deepEqual(list,[{no:1,name:'A-WALL'},{no:2,name:'A-GLAZ'},{no:3,name:'A-DOOR'},{no:12,name:'X-FURN-FIX',color:'#ff00ff',linetype:'DASHED'}]);
 assert.deepEqual(parseLayerNumberText(formatLayerNumberText(list)),list,'글 → 표 → 글 왕복');
 assert.throws(()=>parseLayerNumberText('1 = A\nA-DOOR'),/2번째 줄: "번호 = 레이어이름"/);
 assert.throws(()=>parseLayerNumberText('1 = A\n2 = B\n1 = C'),/3번째 줄: 1번이 두 번/);
 assert.throws(()=>parseLayerNumberText('0 = A'),/1번째 줄: 레이어 번호는 1~99/);
 assert.throws(()=>parseLayerNumberText('100 = A'),/1~99/);
});

test('저장: barun-layer-numbers 에 사용자 표를 두고, 되돌리면 기본표, 망가진 저장값은 기본표 + 안내', () => {
 const storage=memoryStorage();
 assert.deepEqual(loadLayerNumbers(storage),{entries:defaultLayerNumbers(),custom:false,last:null,error:null});
 const mine=[{no:3,name:'A-DOOR'},{no:1,name:'A-WALL'},{no:7,name:'X-MINE',color:'#010203'}];
 saveLayerNumbers(storage,mine);
 const stored=JSON.parse(storage.getItem(LAYER_NUMBER_STORAGE_KEY));
 assert.equal(stored.version,1);assert.deepEqual(stored.entries.map(e=>e.no),[1,3,7]);
 const again=loadLayerNumbers(storage);assert.equal(again.custom,true);assert.deepEqual(again.entries,[{no:1,name:'A-WALL'},{no:3,name:'A-DOOR'},{no:7,name:'X-MINE',color:'#010203'}]);
 assert.throws(()=>saveLayerNumbers(storage,[{no:1,name:'A'},{no:1,name:'B'}]),/두 번/);
 assert.equal(loadLayerNumbers(storage).entries.length,3,'잘못된 표는 저장하지 않는다');
 assert.equal(layerNumberIndex(storage).get('x-mine'),7);
 resetLayerNumbers(storage);assert.deepEqual(loadLayerNumbers(storage).entries,defaultLayerNumbers());assert.equal(loadLayerNumbers(storage).custom,false);
 const broken=loadLayerNumbers(memoryStorage({[LAYER_NUMBER_STORAGE_KEY]:'{oops'}));
 assert.equal(broken.custom,false);assert.match(broken.error,/읽지 못해 기본 번호표/);
 const bad=loadLayerNumbers(memoryStorage({[LAYER_NUMBER_STORAGE_KEY]:JSON.stringify({version:1,entries:[{no:1,name:'A'},{no:1,name:'B'}]})}));
 assert.equal(bad.custom,false);assert.match(bad.error,/올바르지 않아 기본 번호표.*두 번/);
 const throwing={getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('full');}};
 assert.equal(loadLayerNumbers(throwing).entries.length,defaultLayerNumbers().length,'저장소를 못 써도 기본표로 동작');
 assert.throws(()=>saveLayerNumbers(throwing,mine),/저장하지 못했습니다: full/);
});

/* ── 명령창 입력 ── */
test('명령창 입력: LN3 · 레이어3 · 레이어번호 3 · LAYNUM 3 A · 한글 자판 ㅣㅜ3 을 풀고 다른 명령은 건드리지 않는다', () => {
 const p=parseLayerNumberCommand;
 assert.deepEqual(p('LN3'),{number:3,scope:null,ask:false});
 assert.deepEqual(p(' ln 12a '),{number:12,scope:'A',ask:false});
 assert.deepEqual(p('LN3 s'),{number:3,scope:'S',ask:false});
 assert.deepEqual(p('레이어3'),{number:3,scope:null,ask:false});
 assert.deepEqual(p('레이어 3 A'),{number:3,scope:'A',ask:false});
 assert.deepEqual(p('레이어3ㅁ'),{number:3,scope:'A',ask:false});
 assert.deepEqual(p('레이어 5 전체'),{number:5,scope:'A',ask:false});
 assert.deepEqual(p('레이어번호 3'),{number:3,scope:null,ask:true});
 assert.deepEqual(p('레이어 번호 3'),{number:3,scope:null,ask:true});
 assert.deepEqual(p('LAYNUM 7 S'),{number:7,scope:'S',ask:true});
 assert.deepEqual(p('ㅣㅜ3'),{number:3,scope:null,ask:false});
 assert.deepEqual(p('LN100'),{number:100,scope:null,ask:false},'범위 밖 번호도 풀어서 실행 단계에서 1~99 안내');
 for(const other of ['LN','LNA','LINE','레이어','레이어번호','LN3X','3','LN 3 4','LAYER 3','ln3aa','',null])assert.equal(p(other),null,String(other));
});

test('할 일 정하기: 선택이 있으면 S=선택 객체·A=같은 레이어 전체, 없으면 현재 레이어(Enter), A 는 선택이 필요', () => {
 assert.equal(resolveLayerNumberAction('auto',null,true),'selected');
 assert.equal(resolveLayerNumberAction('auto','S',true),'selected');
 assert.equal(resolveLayerNumberAction('auto','A',true),'layer');
 assert.equal(resolveLayerNumberAction('auto',null,false),'current');
 assert.throws(()=>resolveLayerNumberAction('auto','A',false),/먼저 기준 객체를 선택/);
 assert.equal(resolveLayerNumberAction('layer',null,false),'layer');
 assert.throws(()=>resolveLayerNumberAction('bogus',null,true),/할 일을/);
});

/* ── 실행(실제 엔진) ── */
test('선택 객체 이동: LN3 은 선택한 객체만 A-DOOR 로 옮기고 되돌리기 한 번에 돌아간다', () => {
 const {engine,layerOf}=drawing();
 const [a,b,c]=addLines(engine,[[layerOf('A-WALL'),0],[layerOf('A-WALL'),100],[layerOf('A-WALL'),200]]);
 const ctx=makeCtx(engine,{selection:[a,b]}),undo=engine.undoStack.length,before=engine.doc;
 const r=ctx.run(()=>runLayerNumberInput(ctx,parseLayerNumberCommand('LN3')));
 assert.deepEqual([r.mode,r.moved,r.created],['selected',2,false]);
 const layerOfId=id=>engine.doc.entities.find(e=>e.id===id).layer;
 assert.deepEqual([a,b,c].map(layerOfId),[layerOf('A-DOOR'),layerOf('A-DOOR'),layerOf('A-WALL')]);
 assert.equal(engine.undoStack.length,undo+1,'되돌리기 한 단계');
 assert.match(lastToast(ctx),/^3 = A-DOOR · 선택 객체 2개를 옮겼습니다/);assert.deepEqual(ctx.logs,['3 = A-DOOR']);
 engine.execute({type:'undo'});
 assert.equal(engine.doc,before);assert.deepEqual([a,b,c].map(layerOfId),Array(3).fill(layerOf('A-WALL')));
 assert.equal(JSON.parse(ctx.storage.getItem(LAYER_NUMBER_STORAGE_KEY)).last,3,'마지막 번호 기억(LAYNUM 기본값)');
});

test('같은 레이어 전체(A): 선택 객체와 같은 레이어의 객체를 모두 옮기되 잠긴 레이어의 객체는 옮기지 않는다', () => {
 const {engine,layerOf}=drawing();
 const glaz=layerOf('A-GLAZ');
 const [w1,w2,w3,g1,g2,x]=addLines(engine,[[layerOf('A-WALL'),0],[layerOf('A-WALL'),100],[layerOf('A-WALL'),200],[glaz,300],[glaz,400],['default',500]]);
 engine.execute({type:'layer.update',id:glaz,changes:{locked:true}});
 const ctx=makeCtx(engine,{selection:[w1,g1]}),undo=engine.undoStack.length;
 const r=ctx.run(()=>runLayerNumberInput(ctx,parseLayerNumberCommand('레이어3A')));
 assert.deepEqual([r.mode,r.moved,r.skipped],['layer',3,2]);
 const on=id=>engine.doc.entities.find(e=>e.id===id).layer;
 assert.deepEqual([w1,w2,w3].map(on),Array(3).fill(layerOf('A-DOOR')),'선택하지 않은 w2·w3 도 같은 레이어라 옮김');
 assert.deepEqual([g1,g2,x].map(on),[glaz,glaz,'default'],'잠긴 레이어·다른 레이어는 그대로');
 assert.equal(engine.undoStack.length,undo+1);
 assert.match(lastToast(ctx),/같은 레이어\(A-WALL, A-GLAZ\) 전체 3개.*잠긴 레이어의 객체 2개는 옮기지 않았습니다/);
 engine.execute({type:'undo'});assert.deepEqual([w1,w2,w3].map(on),Array(3).fill(layerOf('A-WALL')));
});

test('현재 레이어: 선택 없이 LN3(Enter) 은 현재 레이어만 A-DOOR 로 바꾸고 도면·되돌리기는 그대로, 동결 레이어는 거절', () => {
 const {engine,layerOf}=drawing();
 addLines(engine,[[layerOf('A-WALL'),0]]);
 const ctx=makeCtx(engine),undo=engine.undoStack.length,before=engine.doc;
 const r=ctx.run(()=>runLayerNumberInput(ctx,parseLayerNumberCommand('LN3')));
 assert.equal(r.mode,'current');assert.equal(ctx.activeLayer(),layerOf('A-DOOR'));
 assert.equal(engine.doc,before,'도면은 바뀌지 않는다');assert.equal(engine.undoStack.length,undo);
 assert.match(lastToast(ctx),/3 = A-DOOR · 현재 레이어로 지정했습니다/);
 assert.throws(()=>runLayerNumberInput(ctx,parseLayerNumberCommand('LN3A')),/먼저 기준 객체를 선택/);
 engine.execute({type:'layer.update',id:layerOf('A-GLAZ'),changes:{frozen:true}});
 assert.throws(()=>applyLayerNumber(ctx,{number:2}),/동결된 레이어는 현재 레이어로/);
 assert.equal(ctx.activeLayer(),layerOf('A-DOOR'));
 engine.execute({type:'layer.update',id:layerOf('A-WALL'),changes:{visible:false}});
 applyLayerNumber(ctx,{number:1});assert.match(lastToast(ctx),/꺼져 있어/);
});

test('없는 레이어는 표준 색·선종류·선두께로 만들고, 만들기와 옮기기가 되돌리기 한 단계다', () => {
 const {engine}=drawing({standard:false});
 const [a]=addLines(engine,[['default',0]]);
 const ctx=makeCtx(engine,{selection:[a]}),undo=engine.undoStack.length,before=engine.doc;
 const r=ctx.run(()=>applyLayerNumber(ctx,{number:3}));
 const door=engine.doc.layers.find(l=>l.name==='A-DOOR');
 assert.ok(door);assert.equal(r.created,true);assert.equal(r.layerId,door.id);
 assert.deepEqual([door.color,door.linetype,door.lineweight,door.visible,door.locked],['#00ff00','CONTINUOUS',0.18,true,false]);
 assert.equal(engine.doc.entities.find(e=>e.id===a).layer,door.id);
 assert.match(lastToast(ctx),/표준 설정으로 새로 만듦/);
 assert.equal(engine.undoStack.length,undo+1,'레이어 만들기 + 옮기기 = 한 단계');
 engine.execute({type:'undo'});assert.equal(engine.doc,before);assert.ok(!engine.doc.layers.some(l=>l.name==='A-DOOR'));
 // 중심선 레이어는 CENTER, 사용자 표의 색·선종류가 표준보다 먼저
 const cnt=defaultLayerNumbers().find(e=>e.name==='A-CNTR').no;
 const c2=makeCtx(engine);c2.run(()=>applyLayerNumber(c2,{number:cnt}));
 assert.equal(engine.doc.layers.find(l=>l.name==='A-CNTR').linetype,'CENTER');assert.equal(c2.activeLayer(),engine.doc.layers.find(l=>l.name==='A-CNTR').id);
 const storage=memoryStorage();saveLayerNumbers(storage,[{no:9,name:'X-MINE',color:'#123456',linetype:'dashed'}]);
 const c3=makeCtx(engine,{storage});c3.run(()=>applyLayerNumber(c3,{number:9}));
 const mine=engine.doc.layers.find(l=>l.name==='X-MINE');assert.deepEqual([mine.color,mine.linetype,mine.lineweight],['#123456','DASHED',0.25]);
 // 대소문자만 다른 레이어가 있으면 새로 만들지 않고 그 레이어를 쓴다
 engine.execute({type:'layer.add',name:'a-glaz',color:'#ffffff'});const n=engine.doc.layers.length;
 c3.run(()=>applyLayerNumber(makeCtx(engine),{number:2}));assert.equal(engine.doc.layers.length,n);
});

test('ctx.transact 가 있으면 모듈 혼자서도 레이어 만들기 + 옮기기를 한 단계로 묶는다', () => {
 const {engine}=drawing({standard:false});
 const [a]=addLines(engine,[['default',0]]);
 const ctx=makeCtx(engine,{selection:[a],transact:true}),undo=engine.undoStack.length;
 applyLayerNumber(ctx,{number:1});
 assert.equal(engine.undoStack.length,undo+1);
 engine.execute({type:'undo'});assert.ok(!engine.doc.layers.some(l=>l.name==='A-WALL'));assert.equal(engine.doc.entities[0].layer,'default');
});

test('잠금·실패: 잠기거나 숨긴 대상 레이어로는 옮기지 않고, 실패하면 레이어도 만들지 않는다', () => {
 const {engine,layerOf}=drawing();
 const [a]=addLines(engine,[[layerOf('A-WALL'),0]]);
 engine.execute({type:'layer.update',id:layerOf('A-DOOR'),changes:{locked:true}});
 const ctx=makeCtx(engine,{selection:[a]}),before=engine.doc;
 assert.throws(()=>ctx.run(()=>applyLayerNumber(ctx,{number:3})),/잠기거나 숨긴/);
 assert.equal(engine.doc,before);
 assert.throws(()=>applyLayerNumber(ctx,{number:0}),/1~99/);
 assert.throws(()=>applyLayerNumber(ctx,{number:98}),/98번은 레이어 번호표에 없습니다/);
 const {engine:blank}=drawing({standard:false});
 const empty=makeCtx(blank),layers=blank.doc.layers.length;
 assert.throws(()=>applyLayerNumber(empty,{number:3,action:'selected'}),/옮길 객체를 먼저 선택/);
 assert.equal(blank.doc.layers.length,layers,'검사에 걸리면 레이어를 만들지 않는다');
 // 옮길 것이 모두 잠긴 레이어에 있으면 안내만
 engine.execute({type:'layer.update',id:layerOf('A-DOOR'),changes:{locked:false}});
 engine.execute({type:'layer.update',id:layerOf('A-WALL'),changes:{locked:true}});
 const r=applyLayerNumber(ctx,{number:3});assert.deepEqual([r.moved,r.skipped],[0,1]);assert.match(lastToast(ctx),/옮길 객체가 없습니다.*잠긴 레이어의 객체 1개/);
});

/* ── 명령(폼) ── */
test('LAYNUM: 번호·할 일 폼(선택이 있으면 이동이 기본), [적용]은 한 단계, [번호표 편집…]은 번호표 폼을 연다', () => {
 const {engine,layerOf}=drawing();
 const [a]=addLines(engine,[[layerOf('A-WALL'),0]]);
 const ctx=makeCtx(engine,{selection:[a]}),cmds=installLayerNumberTools(ctx);
 assert.deepEqual(Object.keys(cmds),['LAYNUM','LAYNUMLIST']);
 ctx.run(()=>cmds.LAYNUM());
 const f=ctx.forms.at(-1);
 assert.deepEqual(f.fields.map(x=>x.name),['number','action']);
 assert.equal(f.fields[0].type,'number','숫자 + Enter 로 바로 적용');assert.match(f.fields[0].label,/1=A-WALL 2=A-GLAZ 3=A-DOOR/);assert.equal(f.fields[0].value,'1');assert.equal(f.fields[1].value,'selected');
 assert.throws(()=>f.apply({number:'',action:'selected'}),/레이어 번호\(1~99\)를 입력/);assert.throws(()=>f.apply({number:'2.5',action:'selected'}),/1~99 사이 정수/);
 const undo=engine.undoStack.length;
 f.apply({number:'3',action:'selected'});
 assert.equal(engine.doc.entities.find(e=>e.id===a).layer,layerOf('A-DOOR'));assert.equal(engine.undoStack.length,undo+1);
 ctx.run(()=>cmds.LAYNUM());assert.equal(ctx.forms.at(-1).fields[0].value,'3','마지막 번호가 기본값');
 ctx.forms.at(-1).apply({number:'3',action:'manage'});
 assert.deepEqual(ctx.forms.at(-1).fields.map(x=>x.name),['table','mode']);
 const none=makeCtx(engine);installLayerNumberTools(none).LAYNUM();assert.equal(none.forms.at(-1).fields[1].value,'current');
});

test('LAYNUMLIST: 번호표를 글로 고쳐 저장하고, 틀린 글은 저장하지 않으며, 기본표로 되돌린다', () => {
 const {engine}=drawing();
 const ctx=makeCtx(engine),cmds=installLayerNumberTools(ctx);
 cmds.LAYNUMLIST();
 const f=ctx.forms.at(-1);
 assert.match(f.fields[0].value,/^1 = A-WALL\n2 = A-GLAZ\n3 = A-DOOR\n/);
 f.apply({table:'1 = A-WALL\n2 = A-WIND, #00ffff\n3 = A-DOOR',mode:'save'});
 assert.deepEqual(loadLayerNumbers(ctx.storage).entries,[{no:1,name:'A-WALL'},{no:2,name:'A-WIND',color:'#00ffff'},{no:3,name:'A-DOOR'}]);
 assert.match(lastToast(ctx),/저장했습니다 · 3개/);
 assert.throws(()=>f.apply({table:'1 = A\n1 = B',mode:'save'}),/2번째 줄: 1번이 두 번/);
 assert.equal(loadLayerNumbers(ctx.storage).entries.length,3,'틀린 글은 저장하지 않음');
 // 사용자 표의 2번(없는 레이어 A-WIND)은 지정한 색으로 만든다
 applyLayerNumber(ctx,{number:2});assert.equal(engine.doc.layers.find(l=>l.name==='A-WIND').color,'#00ffff');
 f.apply({table:'',mode:'reset'});assert.equal(loadLayerNumbers(ctx.storage).custom,false);
 // 빈 표를 저장하면 LAYNUM 은 번호표 편집부터 연다
 saveLayerNumbers(ctx.storage,[]);cmds.LAYNUM();assert.deepEqual(ctx.forms.at(-1).fields.map(x=>x.name),['table','mode']);
});

test('긴 이름(레이어번호 3)은 선택이 있을 때 범위 [선택 객체(S) / 같은 레이어 전체(A)] <S> 를 묻는다', () => {
 const {engine,layerOf}=drawing();
 const [a,b]=addLines(engine,[[layerOf('A-WALL'),0],[layerOf('A-WALL'),100]]);
 const ctx=makeCtx(engine,{selection:[a]});
 assert.equal(runLayerNumberInput(ctx,parseLayerNumberCommand('레이어번호 3')),null,'폼을 열고 기다린다');
 const f=ctx.forms.at(-1);
 assert.equal(f.title,'3 = A-DOOR · 범위');assert.equal(f.fields[0].label,'범위 [선택 객체(S) / 같은 레이어 전체(A)] <S>');assert.deepEqual([f.fields[0].type,f.fields[0].value],['text','S']);
 assert.throws(()=>f.apply({scope:'X'}),/S\(선택 객체\) 또는 A/);
 const undo=engine.undoStack.length;
 f.apply({scope:'a'});
 assert.deepEqual([a,b].map(id=>engine.doc.entities.find(e=>e.id===id).layer),[layerOf('A-DOOR'),layerOf('A-DOOR')]);
 assert.equal(engine.undoStack.length,undo+1);
 const direct=makeCtx(engine,{selection:[b]});runLayerNumberInput(direct,parseLayerNumberCommand('레이어번호 1 S'));assert.equal(direct.forms.length,0,'범위를 적으면 묻지 않는다');
 const idle=makeCtx(engine);runLayerNumberInput(idle,parseLayerNumberCommand('레이어번호 2'));assert.equal(idle.forms.length,0,'선택이 없으면 바로 현재 레이어');assert.equal(idle.activeLayer(),layerOf('A-GLAZ'));
 assert.throws(()=>runLayerNumberInput(ctx,parseLayerNumberCommand('레이어번호 98')),/98번은/);
 assert.throws(()=>runLayerNumberInput(ctx,null),/예: LN3/);
});

test('Space/Enter 반복: LN3 뒤 반복하면 LAYNUM 이 창 없이 같은 번호로 다시 실행한다', () => {
 const {engine,layerOf}=drawing();
 const [a,b]=addLines(engine,[[layerOf('A-WALL'),0],[layerOf('A-WALL'),100]]);
 const ctx=makeCtx(engine,{selection:[a]}),cmds=installLayerNumberTools(ctx);
 ctx.run(()=>runLayerNumberInput(ctx,parseLayerNumberCommand('LN3')));
 ctx.select([b]);markCardRepeat();
 ctx.run(()=>cmds.LAYNUM());
 assert.equal(ctx.forms.length,0,'폼 없이');assert.equal(engine.doc.entities.find(e=>e.id===b).layer,layerOf('A-DOOR'));
 ctx.run(()=>cmds.LAYNUM());assert.equal(ctx.forms.length,1,'반복 표시가 없으면 폼');
});

test('범위 글자: S·ㄴ·선택 → S, A·ㅁ·전체 → A, 빈칸 Enter → S', () => {
 for(const [t,v] of [['S','S'],['s','S'],['ㄴ','S'],['선택','S'],['A','A'],['a','A'],['ㅁ','A'],['전체','A'],['','S'],[null,'S'],[' a ','A']])assert.equal(parseLayerNumberScope(t),v,String(t));
 for(const bad of ['X','SA','1','constructor','toString'])assert.equal(parseLayerNumberScope(bad),null,bad);
});
