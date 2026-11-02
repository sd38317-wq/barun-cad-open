import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as G from './geometry.js';
import * as C from './curve-edit.js';
import * as S4 from './edit-commands-s4.js';
import {DrawingEngine} from './engine.js';
import {ARCH_LIBRARY,ARCH_LINKS,nativeDraftingEdits,nativeLength} from './architectural-library.js';
import {dimensionPreview} from './dimension-preview.js';
import {insulationPath,insulationSourcePath,wallOpening} from './architecture.js';
import {defaultAliases,defaultHotkeys,validateSettings,classifyInput,parsePoint,hangulToQwerty,imeOptionValue} from './commands.js';
import {calculatorShortcut} from './calculator-shortcut.js';
import {historyShortcutAction} from './command-history-shortcut.js';
/* ACAD200 영역 4: app.js 명령 흐름(명령창 입력 그대로). 화면 없는 시험 틀은 basic-command-flows.test.js 의 session() 과 같고 form 만 붙잡는다. */
const source=fs.readFileSync('app.js','utf8');
const p=(x,y)=>({x,y});
function session(){
 const engine=new DrawingEngine(),elements=new Map(),errors=[];
 const c={dimensionPreview,clearOverlapSelection(){},hangulToQwerty,imeOptionValue,calculatorShortcut,historyShortcutAction,nativeDraftingEdits,nativeLength,ARCH_LIBRARY,ARCH_LINKS,G,engine,insulationPath,insulationSourcePath,structuredClone,crypto,console,Set,Math,Number,parsePoint,classifyInput,settings:validateSettings({version:1,aliases:defaultAliases(),hotkeys:defaultHotkeys()}),selected:new Set(),previousSelection:[],mode:'SELECT',phase:'idle',points:[],params:{},drag:null,space:false,busy:false,activeLayer:'default',lastCommand:'LINE',inputHistory:[],historyIndex:0,zoomHistory:[],scale:1,origin:{x:0,y:0},width:1000,height:800,cursor:null,lastDrawingPointer:null,cadClipboard:null,
 $:id=>{if(!elements.has(id))elements.set(id,{value:'',focus(){},click(){}});return elements.get(id);},canvas:{focus(){c.canvasFocusCount=(c.canvasFocusCount||0)+1;}},studio:{run:()=>false},num:(id,f)=>f,fmt:String,log(){},toast:(m,error)=>{if(error)errors.push(m);},render(){},updatePrompt(){},refresh(){},safe:fn=>{try{return fn();}catch(e){errors.push(e.message);}},fit:()=>c.fitCount=(c.fitCount||0)+1,zoom:f=>c.scale*=f};
 c.chosen=()=>engine.doc.entities.filter(e=>c.selected.has(e.id));c.editable=()=>engine.doc.entities;c.execute=command=>engine.execute(command);c.setSelected=ids=>c.selected=new Set(ids);c.addEntities=entities=>engine.execute({type:'addMany',entities:entities.map(e=>({...e,layer:e.layer||'default'}))});c.pick=(p,options={})=>engine.doc.entities.find(e=>!options.exclude?.includes(e.id)&&G.entityDistance(e,p)<1);
 c.S4=S4;c.form=(title,fields,apply)=>{c.lastForm={title,fields,apply};};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function reset()'),source.indexOf('function refresh()')),c);
 c.wallOpening=wallOpening;c.visible=()=>engine.doc.entities;vm.runInContext(source.slice(source.indexOf('function nearPlacementWall('),source.indexOf('function placementArchitecture(')),c);
 vm.runInContext(source.slice(source.indexOf('function copySelection('),source.indexOf('const fmt =')),c);
 c.send=value=>{c.$('coordinate').value=value;c.submit();assert.deepEqual(errors,[],errors.join(';'));};return c;
}

test('418 DIVIDE B: 블록 이름·정렬을 고른 뒤 등분 수를 넣으면 블록이 들어간다(되돌리기 한 번)',()=>{
 const c=session();const [line,pt]=c.addEntities([{type:'line',points:[p(0,0),p(400,0)]},{type:'point',position:p(0,0)}]);
 c.engine.execute({type:'block.create',ids:[pt],name:'MARK',base:p(0,0),mode:'delete'});
 c.selected=new Set([line]);c.send('DIV');c.send('B');assert.match(c.lastForm.title,/블록/);c.lastForm.apply({name:'MARK',align:'on'});
 assert.equal(c.params.divideBlock.name,'MARK');const depth=c.engine.undoStack.length;c.send('4');
 assert.equal(c.engine.doc.entities.filter(e=>e.type==='block').length,3);assert.equal(c.engine.undoStack.length,depth+1);
});
test('421 MATCHPROP S: 색만 켜면 레이어는 그대로',()=>{
 const c=session();c.engine.execute({type:'layer.add',name:'L2',color:'#00ff00'});const l2=c.engine.doc.layers.at(-1).id;
 const [,dst]=c.addEntities([{type:'line',layer:l2,color:'#ff0000',points:[p(0,0),p(100,0)]},{type:'line',points:[p(0,100),p(100,100)]}]);
 c.send('MA');c.accept(p(50,0));c.send('S');c.lastForm.apply({color:'on'});assert.deepEqual([...c.run.matchFlags],['color']);c.accept(p(50,100));
 const d=c.engine.doc.entities.find(e=>e.id===dst);assert.equal(d.color,'#ff0000');assert.equal(d.layer,'default');
});
test('409 ELLIPSE A(호)·SPLINE 맞춤점',()=>{
 const c=session();for(const v of ['EL','A','-100,0','100,0','0,50','0','90'])c.send(v);
 const el=c.engine.doc.entities.find(e=>e.type==='ellipse');assert.ok(el);assert.ok(Math.abs(el.startParam)<1e-9&&Math.abs(el.endParam-Math.PI/2)<1e-9);
 for(const v of ['SPL','0,0','100,50','200,0',''])c.send(v);
 const sp=c.engine.doc.entities.find(e=>e.spline);assert.equal(sp.spline.fitPoints.length,3);assert.ok(G.splineMatches(sp));
});
test('410 REVCLOUD P(다각형): 정확한 호 구간 구름',()=>{
 const c=session();c.run.revcloudArc=100;for(const v of ['REVCLOUD','P','0,0','400,0','400,300',''])c.send(v);
 const cloud=c.engine.doc.entities.find(e=>e.revcloud);assert.ok(cloud&&cloud.closed);assert.ok(C.pathParts(cloud).every(s=>s.kind==='arc'));
});
test('405 ARRAY: 기본은 연관 배열 하나, AS 로 낱개 사본',()=>{
 const c=session();const [id]=c.addEntities([{type:'line',points:[p(0,0),p(10,0)]}]);c.selected=new Set([id]);c.send('AR');c.send('2,3,100,50');
 assert.equal(c.engine.doc.entities.length,1);assert.ok(c.engine.doc.entities[0].assocArray);
 const d=session();const [x]=d.addEntities([{type:'line',points:[p(0,0),p(10,0)]}]);d.selected=new Set([x]);d.send('AR');d.send('AS');d.send('2,3,100,50');
 try{assert.equal(d.engine.doc.entities.length,6);}finally{S4.setEditVar('ARRAYASSOCIATIVITY',1);}
});
test('404 OFFSET G: 바깥 모서리를 호로',()=>{
 const c=session();c.addEntities([{type:'polyline',closed:true,points:G.rectangle(p(0,0),p(100,100))}]);
 try{c.send('O');c.send('G');assert.equal(S4.editVar('OFFSETGAPTYPE'),1);c.send('10');c.accept(p(100,50));c.accept(p(300,50));
  const out=c.engine.doc.entities.at(-1);assert.equal(C.pathParts(out).filter(s=>s.kind==='arc').length,4);}
 finally{S4.setEditVar('OFFSETGAPTYPE',0);}
});
test('407 JOIN: JOINFUZZ 허용 거리로 잇는다',()=>{
 const c=session();const ids=c.addEntities([{type:'line',points:[p(0,0),p(10,0)]},{type:'line',points:[p(10.5,0),p(10.5,20)]}]);
 S4.setEditVar('JOINFUZZ',1);try{c.selected=new Set(ids);c.send('J');assert.equal(c.engine.doc.entities.length,1);assert.equal(c.engine.doc.entities[0].type,'polyline');}finally{S4.setEditVar('JOINFUZZ',0.001);}
});
test('414 STRETCH: 변위 단계의 Enter 는 지난 변위를 다시 쓴다',()=>{
 const c=session();const [id]=c.addEntities([{type:'line',points:[p(0,0),p(100,0)]}]);c.selected=new Set([id]);
 c.send('STRETCH');c.send('D');c.send('10,0');assert.deepEqual({...c.run.lastStretch},{x:10,y:0});
 c.selected=new Set([id]);c.send('STRETCH');c.send('');c.send('');
 assert.deepEqual(c.engine.doc.entities[0].points[1],p(120,0));
});
test('417 MIRROR: 명령창 MIRROR 도 MIRRTEXT 0 이면 읽히는 문자',()=>{
 const c=session();const [id]=c.addEntities([{type:'text',text:'AB',height:100,position:p(0,0),rotation:0}]);c.selected=new Set([id]);
 for(const v of ['MI','10,0','10,100',''])c.send(v);
 const texts=c.engine.doc.entities.filter(e=>e.type==='text');assert.equal(texts.length,2);assert.ok(texts.every(t=>t.rotation===0));
});
test('406 BREAK·BREAKATPOINT: 원·폴리선도 끊는다',()=>{
 const c=session();const [circle,pl]=c.addEntities([{type:'circle',center:p(0,0),radius:10},{type:'polyline',points:[p(0,100),p(100,100),p(100,200)]}]);
 c.selected=new Set([pl]);c.send('BREAKATPOINT');c.accept(p(100,150));assert.equal(c.engine.doc.entities.filter(e=>e.type==='polyline').length,2);
 c.selected=new Set([circle]);c.send('BR');c.accept(p(10,0));c.accept(p(0,10));assert.ok(c.engine.doc.entities.some(e=>e.type==='arc'));
});
test('416 ROTATE 참조: 첫 값에서 Enter 는 지난 참조 각',()=>{
 const c=session();const [id]=c.addEntities([{type:'line',points:[p(0,0),p(100,0)]}]);c.selected=new Set([id]);
 for(const v of ['RO','0,0','R','30','90'])c.send(v);assert.equal(c.run.rotateRefAngle,30);
 c.selected=new Set([id]);for(const v of ['RO','0,0','R','','120'])c.send(v);
 const [a,b]=c.engine.doc.entities[0].points;assert.ok(Math.abs(G.normalizeAngle(G.angle(G.sub(b,a)))-150)<1e-6,'60° 돌린 선을 다시 (120-30)° 돌림');
});
test('401 TRIM 빠른 모드: 경계 후보를 색인으로 줄이고, O 는 이번 명령만 바꾸며 다음 TRIM 은 늘 경계부터',()=>{
 assert.match(source,/function quickTrimBoundaries\(id,p,op\)\{/);
 assert.doesNotMatch(source.slice(source.indexOf('function trimOne('),source.indexOf('function trimOption(')),/editable\(\)\.map/);
 const c=session();c.addEntities([{type:'line',points:[p(0,0),p(1000,0)]},{type:'line',points:[p(500,-100),p(500,100)]}]);
 c.send('TR');assert.equal(c.phase,'select','경계부터');c.send('O');assert.equal(c.phase,'pick','O = 빠른 모드');c.send('O');assert.equal(c.phase,'select');
 c.send('O');assert.equal(c.phase,'pick');const c2=session();c2.addEntities([{type:'line',points:[p(0,0),p(1000,0)]}]);c2.send('TR');assert.equal(c2.phase,'select','O 를 기억하지 않는다');
 assert.equal(S4.EDIT_VARS.TRIMEXTENDMODE,undefined,'TRIMEXTENDMODE 설정은 없앴다');
});
