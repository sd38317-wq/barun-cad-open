import {ARCH_LIBRARY,ARCH_LINKS,nativeDraftingEdits,nativeLength} from './architectural-library.js';
import './dimension-style.test.js';
import {applyDimStyle,getDimStyle} from './dimension-style.js';
import {buildSmartDimension} from './smart-dim.js';
import {withDimAssoc,radialAssoc,assocFromPicks,lookupIn,snapSource} from './dim-assoc.js';
import {dimensionPreview} from './dimension-preview.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as G from './geometry.js';
import {DrawingEngine} from './engine.js';
import {insulationPath,insulationSourcePath,wallOpening} from './architecture.js';
import {defaultAliases,defaultHotkeys,validateSettings,classifyInput,parsePoint,resolveCommand} from './commands.js';
import {hangulToQwerty,imeOptionValue} from './commands.js';
import {calculatorShortcut} from './calculator-shortcut.js';
import {historyShortcutAction} from './command-history-shortcut.js';
import {justifiedText,TEXT_JUSTIFY as TEXT_JUSTIFY_KEYS,isFitJustify,JUSTIFY_PROMPT} from './text-justify.js';
import {normalizeTypedText} from './text-codes.js';
import * as S4 from './edit-commands-s4.js';
const source=fs.readFileSync('app.js','utf8');

test('erase completion followed by Space starts erase selection again',()=>{
 const c=session();const ids=c.addEntities([{type:'line',points:[{x:0,y:0},{x:100,y:0}]},{type:'line',points:[{x:0,y:100},{x:100,y:100}]}]);
 c.selected=new Set([ids[0]]);c.send('E');assert.equal(c.mode,'SELECT');assert.equal(c.engine.doc.entities.length,1);
 c.send('');assert.equal(c.mode,'ERASE');assert.equal(c.phase,'select');c.selected=new Set([ids[1]]);c.send('');assert.equal(c.engine.doc.entities.length,0);c.send('');assert.equal(c.mode,'ERASE');
});

test('early-return workflow commands are remembered and repeated',()=>{
 const c=session();let calls=0;c.studio.run=name=>{if(name==='TABLE'){calls++;return true;}return false;};
 c.run('TABLE');assert.equal(c.lastCommand,'TABLE');c.finish();assert.equal(calls,2);
 c.backup=()=>calls++;c.run('BACKUP');assert.equal(c.lastCommand,'BACKUP');c.finish();assert.equal(calls,4);
});

test('area outline repetition preserves the original command instead of plain polyline',()=>{
 const c=session();for(const value of ['AREAOUTLINE','0,0','1000,0','1000,1000',''])c.send(value);
 assert.equal(c.lastCommand,'AREAOUTLINE');c.send('');assert.equal(c.mode,'PLINE');assert.equal(c.params.areaOutline,true);
});

test('Space repeats insulation with the completed thickness and side without converting selection',()=>{
 const c=session();c.mode='INSULATION';c.phase='point';c.params={depth:180,side:'left'};c.points=[{x:0,y:0},{x:1200,y:0}];c.finish();
 assert.equal(c.mode,'SELECT');assert.equal(c.lastCommand,'INSULATION');const count=c.engine.doc.entities.length;c.finish();
 assert.equal(c.mode,'INSULATION');assert.equal(c.phase,'point');assert.equal(c.params.depth,180);assert.equal(c.params.side,'left');assert.equal(c.points.length,0);assert.equal(c.engine.doc.entities.length,count);
 c.points=[{x:0,y:500},{x:1200,y:500}];c.finish();assert.equal(c.engine.doc.entities.length,count+1);
});
test('clipboard transfers source layers across drawings and undo removes the whole paste',()=>{
 const c=session();c.engine.execute({type:'layer.add',name:'WALL_CUSTOM',color:'#ff00aa',lineweight:.5});const layer=c.engine.doc.layers.at(-1).id;
 const ids=c.addEntities([{type:'line',layer,points:[{x:0,y:0},{x:1000,y:0}]}]);c.selected=new Set(ids);c.send('COPYCLIP');c.engine.execute({type:'new'});const base=c.engine.doc.layers.length;c.selected.clear();c.activeLayer='default';
 c.send('PASTECLIP');c.accept({x:2000,y:3000});const entity=c.engine.doc.entities[0],target=c.engine.doc.layers.find(l=>l.id===entity.layer);assert.equal(target.name,'WALL_CUSTOM');assert.equal(target.color,'#ff00aa');assert.equal(target.lineweight,.5);assert.notEqual(entity.id,ids[0]);assert.deepEqual(entity.points[0],{x:2000,y:3000});c.engine.validate(c.engine.doc);
 c.engine.execute({type:'undo'});assert.equal(c.engine.doc.entities.length,0);assert.equal(c.engine.doc.layers.length,base);
});
test('clipboard makes compact DWG block references portable across drawings',()=>{
 const c=session(),layer={id:'default',name:'0',color:'#79d4ff',visible:true,locked:false,frozen:false,plot:true,lineweight:.25,linetype:'CONTINUOUS'};
 c.engine.execute({type:'load',document:{version:3,units:'mm',linetypeScale:1,layers:[layer],blocks:[],entities:[{id:'insert',type:'block',name:'UNIT',sharedBlock:'unit',layer:'default',position:{x:10,y:20},scale:1,rotation:0,entities:[]}],sharedBlocks:{unit:{origin:{x:0,y:0},entities:[{id:'source-line',type:'line',layer:'default',points:[{x:0,y:0},{x:100,y:0}]}]}}}});
 c.selected=new Set(['insert']);c.send('COPYCLIP');
 assert.equal(c.cadClipboard.entities[0].sharedBlock,undefined);assert.equal(c.cadClipboard.entities[0].entities[0].type,'line');
 c.engine.execute({type:'new'});c.selected.clear();c.send('PASTECLIP');c.accept({x:1000,y:2000});
 const pasted=c.engine.doc.entities[0];assert.equal(pasted.sharedBlock,undefined);assert.deepEqual(pasted.entities[0].points,[{x:1000,y:2000},{x:1100,y:2000}]);c.engine.validate(c.engine.doc);
});
test('COPYBASE places the stored base exactly and MATCHPROP copies appearance',()=>{
 const c=session();const ids=c.addEntities([{type:'line',color:'#ff0000',lineweight:.7,points:[{x:10,y:20},{x:110,y:20}]},{type:'line',points:[{x:0,y:200},{x:100,y:200}]}]);c.selected=new Set([ids[0]]);c.send('COPYBASE');c.accept({x:10,y:20});c.send('PASTECLIP');c.accept({x:300,y:400});assert.deepEqual(c.engine.doc.entities.at(-1).points[0],{x:300,y:400});
 c.send('MA');c.accept({x:50,y:20});c.accept({x:50,y:200});assert.equal(c.engine.doc.entities[1].color,'#ff0000');assert.equal(c.engine.doc.entities[1].lineweight,.7);
});
test('AREAOUTLINE creates a closed measured boundary; ID and DIST leave geometry intact',()=>{
 const c=session(),messages=[];c.toast=s=>messages.push(s);for(const v of ['AREAOUTLINE','0,0','1000,0','1000,1000','0,1000',''])c.send(v);assert.equal(c.engine.doc.entities[0].closed,true);const count=c.engine.doc.entities.length;
 c.send('ID');c.accept({x:42,y:84});assert.ok(messages.at(-1).includes('42'));c.send('DI');c.accept({x:0,y:0});c.accept({x:300,y:400});assert.ok(messages.at(-1).includes('500'));assert.equal(c.engine.doc.entities.length,count);
});
test('WINDOW command clicks vertical wall, aligns opening and undoes atomically',()=>{
 const c=session();c.addEntities([{type:'wall',points:[{x:0,y:0},{x:0,y:5000}],thickness:200,openings:[]}]);
 c.send('WIN');c.send('1200');c.accept({x:70,y:1000});const e=c.engine.doc.entities[1];
 assert.equal(e.category,'WINDOW');assert.equal(e.parameters.rotation,90);assert.equal(e.position.x,0);assert.equal(e.attributes.depth,200);assert.equal(c.mode,'SELECT');
 assert.deepEqual(c.engine.doc.entities[0].openingLinks[e.id],[.2,.44]);c.run('UNDO');assert.equal(c.engine.doc.entities.length,1);assert.equal(Object.keys(c.engine.doc.entities[0].openingLinks).length,0);
});
test('XCLIP command accepts mask corners and OFF / ON / D without mutating original block',()=>{
 const c=session();const ids=c.addEntities([{type:'block',name:'clip',entities:[{type:'line',layer:'default',points:[{x:0,y:0},{x:1000,y:0}]}]}]);c.selected=new Set(ids);
 for(const v of ['XC','100,-100','500,100'])c.send(v);assert.equal(c.engine.doc.entities[0].clip.enabled,true);
 for(const v of ['XC','OFF'])c.send(v);assert.equal(c.engine.doc.entities[0].clip.enabled,false);
 for(const v of ['XC','ON'])c.send(v);assert.equal(c.engine.doc.entities[0].clip.enabled,true);
 for(const v of ['XC','D'])c.send(v);assert.equal(c.engine.doc.entities[0].clip,undefined);
});
test('AA places editable square-metre text at next point and undo removes only label',()=>{
 const c=session();c.selected=new Set(c.addEntities([{type:'rectangle',points:[{x:0,y:0},{x:10000,y:0},{x:10000,y:15500},{x:0,y:15500}]}]));
 c.send('AA');assert.equal(c.phase,'area-label');assert.equal(c.engine.doc.entities.length,1);
 c.accept({x:12000,y:8000});
 const label=c.engine.doc.entities.at(-1);assert.equal(label.type,'text');assert.equal(label.text,'155m²');assert.equal(label.position.x,12000);assert.equal(label.position.y,8000);
 c.run('UNDO');assert.equal(c.engine.doc.entities.length,1);
});
function session(){
 const engine=new DrawingEngine(),elements=new Map(),errors=[];
 const c={withDimAssoc,radialAssoc,assocFromPicks,lookupIn,snapSource,justifiedText,TEXT_JUSTIFY_KEYS,isFitJustify,JUSTIFY_PROMPT,normalizeTypedText,dimensionPreview,clearOverlapSelection(){},hangulToQwerty,imeOptionValue,calculatorShortcut,historyShortcutAction,nativeDraftingEdits,nativeLength,ARCH_LIBRARY,ARCH_LINKS,G,engine,insulationPath,insulationSourcePath,structuredClone,crypto,console,Set,Math,Number,parsePoint,classifyInput,settings:validateSettings({version:1,aliases:defaultAliases(),hotkeys:defaultHotkeys()}),selected:new Set(),previousSelection:[],mode:'SELECT',phase:'idle',points:[],params:{},drag:null,space:false,busy:false,activeLayer:'default',lastCommand:'LINE',inputHistory:[],historyIndex:0,zoomHistory:[],scale:1,origin:{x:0,y:0},width:1000,height:800,cursor:null,lastDrawingPointer:null,cadClipboard:null,
 $:id=>{if(!elements.has(id))elements.set(id,{value:'',focus(){},click(){}});return elements.get(id);},canvas:{focus(){c.canvasFocusCount=(c.canvasFocusCount||0)+1;}},studio:{run:()=>false},num:(id,f)=>f,fmt:String,log(){},toast:(m,error)=>{if(error)errors.push(m);},render(){},updatePrompt(){},refresh(){},safe:fn=>{try{return fn();}catch(e){errors.push(e.message);}},fit:()=>c.fitCount=(c.fitCount||0)+1,zoom:f=>c.scale*=f};
 c.chosen=()=>engine.doc.entities.filter(e=>c.selected.has(e.id));c.editable=()=>engine.doc.entities;c.allSelectableIds=()=>engine.doc.entities.map(e=>e.id);c.execute=command=>engine.execute(command);c.setSelected=ids=>c.selected=new Set(ids);c.addEntities=entities=>engine.execute({type:'addMany',entities:entities.map(e=>({...e,layer:e.layer||'default'}))});c.pick=(p,options={})=>engine.doc.entities.find(e=>!options.exclude?.includes(e.id)&&G.entityDistance(e,p)<1);
 c.S4=S4;vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function reset()'),source.indexOf('function refresh()')),c);
 c.wallOpening=wallOpening;c.visible=()=>engine.doc.entities;vm.runInContext(source.slice(source.indexOf('function nearPlacementWall('),source.indexOf('function placementArchitecture(')),c);
 vm.runInContext(source.slice(source.indexOf('function copySelection('),source.indexOf('const fmt =')),c);
 c.studio.numberCalculator={open:operator=>{c.openedCalculatorOperator=operator;c.reset();}};
 c.send=value=>{c.$('coordinate').value=value;c.submit();assert.deepEqual(errors,[],errors.join(';'));};return c;
}
// 5.0.4 검토 U-H1: 명령 도중의 연산자('-')는 음수 좌표의 첫 글자이므로 계산기를 열지 않는다. 계산기 단축은 명령이 없을 때만 연다.
test('bare calculator operator opens the calculator only when idle; a command in progress keeps its input',()=>{const c=session();c.send('+');assert.equal(c.openedCalculatorOperator,'+');assert.equal(c.mode,'SELECT');c.openedCalculatorOperator=null;c.send('C');assert.equal(c.mode,'COPY');c.$('coordinate').value='+';c.submit();/* 명령 도중의 연산자는 값으로 처리되어 오류 안내만 나온다 */assert.equal(c.openedCalculatorOperator,null);assert.equal(c.mode,'COPY');});
test('standard aliases and custom COPY alias remain compatible',()=>{const s={aliases:defaultAliases()};for(const [a,b]of Object.entries({Z:'ZOOM',E:'ERASE',PL:'PLINE',CO:'COPY',C:'COPY',QSAVE:'SAVE',MA:'MATCHPROP',POL:'POLYGON',F:'FILLET',ZE:'FIT'}))assert.equal(resolveCommand(a,s),b);});
test('Z E is extents, never erase; Z P restores previous view',()=>{const c=session();c.addEntities([{type:'line',points:[{x:0,y:0},{x:100,y:0}]}]);c.send('Z');c.send('E');assert.equal(c.fitCount,1);assert.equal(c.engine.doc.entities.length,1);c.zoomHistory.push({scale:3,origin:{x:8,y:9}});c.send('Z');c.send('P');assert.equal(c.scale,3);});
test('LINE close and local undo options do not invoke COPY or global aliases',()=>{const c=session();c.send('L');c.send('0,0');c.send('100,0');c.send('100,100');c.send('U');assert.equal(c.engine.doc.entities.length,1);c.send('100,100');c.send('C');assert.equal(c.engine.doc.entities.length,3);assert.equal(c.mode,'SELECT');});
test('PL close produces one closed polyline and one undo restores blank',()=>{const c=session();for(const v of ['PL','0,0','100,0','100,100','C'])c.send(v);assert.equal(c.engine.doc.entities[0].closed,true);c.run('UNDO');assert.equal(c.engine.doc.entities.length,0);});
test('PL Enter keeps the completed open polyline',()=>{const c=session();for(const v of ['PL','0,0','100,0','100,100',''])c.send(v);assert.equal(c.mode,'SELECT');assert.equal(c.engine.doc.entities.length,1);assert.equal(c.engine.doc.entities[0].type,'polyline');assert.equal(c.engine.doc.entities[0].closed,false);assert.equal(c.engine.doc.entities[0].points.length,3);});
test('PL A H L U W options create width, exact length and undo a whole arc segment',()=>{const c=session();for(const v of ['PL','0,0','100,0','W','20','L','50','A','S','175,25','200,0'])c.send(v);const arcPointCount=c.points.length;assert.ok(arcPointCount>4);c.send('U');assert.equal(c.points.length,3);for(const v of ['H','5',''])c.send(v);const e=c.engine.doc.entities[0];assert.equal(e.constantWidth,10);assert.equal(G.dist(e.points[1],e.points[2]),50);});
test('TEXT W option sets width factor for every line of the command (user report: no text width)',()=>{const c=session();for(const v of ['TEXT','W','0.7','0,0','250','0','첫 줄','둘째 줄',''])c.send(v);const texts=c.engine.doc.entities.filter(e=>e.type==='text');assert.deepEqual(texts.map(e=>e.widthFactor),[0.7,0.7]);for(const v of ['TEXT','W','1','100,0','250','0','보통',''])c.send(v);assert.equal(c.engine.doc.entities.at(-1).widthFactor,undefined,'1 은 기본값이라 적지 않는다');});
test('TEXT W keeps the width with aligned justify and ignores a click while asking the width (Codex·Argon review)',()=>{const c=session();c.send('TEXT');c.send('W');c.accept({x:5,y:5});assert.equal(c.phase,'text-width','클릭은 폭 입력을 건너뛰지 않는다');for(const v of ['0.5','J','A','0,0','1000,0','맞춤',''])c.send(v);const t=c.engine.doc.entities.at(-1);assert.equal(t.type,'text');assert.equal(t.widthFactor,0.5);});
test('COPY supports repeated placements from original, Enter ends',()=>{const c=session();c.selected=new Set(c.addEntities([{type:'line',points:[{x:0,y:0},{x:100,y:0}]}]));for(const v of ['CO','0,0','0,100','0,200',''])c.send(v);assert.equal(c.engine.doc.entities.length,3);assert.equal(c.mode,'SELECT');assert.equal(c.engine.doc.entities[2].points[0].y,200);});
test('circle diameter and regular polygon numeric entry',()=>{const c=session();for(const v of ['CI','0,0','D','100'])c.send(v);assert.equal(c.engine.doc.entities[0].radius,50);for(const v of ['POL','6','0,0','','100'])c.send(v);assert.equal(c.engine.doc.entities[1].points.length,6);const ys=c.engine.doc.entities[1].points.map(p=>Math.round(p.y));assert.equal(ys.filter(y=>y===Math.min(...ys)).length,2,'밑변 수평');});
test('CAD clipboard paste creates independent objects and cut is undoable',()=>{const c=session();c.selected=new Set(c.addEntities([{type:'line',points:[{x:0,y:0},{x:100,y:0}]}]));c.run('COPYCLIP');c.run('PASTECLIP');c.accept({x:0,y:200});assert.equal(c.engine.doc.entities.length,2);assert.notEqual(c.engine.doc.entities[0].id,c.engine.doc.entities[1].id);c.run('CUTCLIP');assert.equal(c.engine.doc.entities.length,1);c.run('UNDO');assert.equal(c.engine.doc.entities.length,2);});
test('OFFSET accepts distance before selecting source and remains available',()=>{const c=session();c.addEntities([{type:'line',points:[{x:0,y:0},{x:1000,y:0}]}]);c.send('O');c.send('100');assert.equal(c.phase,'offset-object');c.accept({x:500,y:0});c.accept({x:500,y:100});assert.equal(c.engine.doc.entities.length,2);assert.equal(c.phase,'offset-object');c.send('');assert.equal(c.mode,'SELECT');});
test('TR Enter uses all geometry as boundaries',()=>{const lines=[{type:'line',points:[{x:0,y:0},{x:1000,y:0}]},{type:'line',points:[{x:500,y:-100},{x:500,y:100}]}];const c=session();c.addEntities(lines);c.send('TR');assert.equal(c.phase,'select','경계부터(자동 빠른 모드 없음, 10-23)');c.send('');assert.equal(c.phase,'pick');assert.equal(c.params.quickTrim,true,'아무것도 안 고르고 Enter = 모든 선이 경계');});
test('MOVE ROTATE SCALE ERASE work through command input and undo restores',()=>{const c=session();const ids=c.addEntities([{type:'line',points:[{x:0,y:0},{x:100,y:0}]}]);c.selected=new Set(ids);for(const v of ['M','0,0','100,100'])c.send(v);assert.equal(c.engine.doc.entities[0].points[0].x,100);assert.equal(c.selected.size,0,'수정 명령이 끝나면 선택이 풀린다(오토캐드)');c.selected=new Set(ids);for(const v of ['RO','100,100','90'])c.send(v);assert.ok(Math.abs(c.engine.doc.entities[0].points[1].y-200)<1e-6);c.selected=new Set(ids);for(const v of ['SC','100,100','2'])c.send(v);assert.ok(Math.abs(c.engine.doc.entities[0].points[1].y-300)<1e-6);c.selected=new Set(ids);c.send('E');assert.equal(c.engine.doc.entities.length,0);c.run('UNDO');assert.equal(c.engine.doc.entities.length,1);});
test('toolbar-first edit command returns keyboard focus to drawing for selection and Enter',()=>{const c=session();c.addEntities([{type:'line',points:[{x:0,y:0},{x:100,y:0}]}]);c.canvasFocusCount=0;c.run('MOVE');assert.equal(c.phase,'select');assert.equal(c.canvasFocusCount,1);});
test('FILLET R sets corner radius before selecting two edges',()=>{const c=session();const ids=c.addEntities([{type:'line',points:[{x:0,y:0},{x:1000,y:0}]},{type:'line',points:[{x:1000,y:0},{x:1000,y:1000}]}]);c.send('FIL');c.send('R');c.send('100');c.selected=new Set(ids);c.send('');assert.ok(c.engine.doc.entities.some(e=>e.type==='arc'));});
test('FILLET default F uses zero radius and preserves undoable corner connection',()=>{const c=session();const ids=c.addEntities([{type:'line',points:[{x:0,y:0},{x:1000,y:0}]},{type:'line',points:[{x:1000,y:0},{x:1000,y:1000}]}]);assert.equal(resolveCommand('F',c.settings),'FILLET');c.engine.execute({type:'fillet',ids,size:0});assert.equal(c.engine.doc.entities.length,2);assert.deepEqual(c.engine.doc.entities.map(e=>e.points),[[{x:0,y:0},{x:1000,y:0}],[{x:1000,y:0},{x:1000,y:1000}]]);c.run('UNDO');assert.equal(c.engine.doc.entities.length,2);assert.deepEqual(c.engine.doc.entities.map(e=>e.id),ids);});
test('direct distance follows cursor direction and remains undoable',()=>{const c=session();c.send('L');c.send('0,0');c.cursor={x:0,y:10};c.send('500');assert.equal(c.engine.doc.entities[0].points[1].y,500);c.send('');c.run('UNDO');assert.equal(c.engine.doc.entities.length,0);});
test('view commands preserve the last drafting command',()=>{const c=session();c.lastCommand=null;c.send('Z');c.send('E');c.send('');assert.equal(c.mode,'SELECT');c.send('L');c.send('0,0');c.send('100,0');c.send('');c.send('Z');c.send('E');c.send('');assert.equal(c.mode,'LINE');});

test('STRETCH selection waits for Enter; exact cursor-directed distance changes only chosen ends and undo restores',()=>{
 for(const direction of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}]){
  const c=session();const [id]=c.addEntities([{type:'line',points:[{x:0,y:0},{x:1000,y:0}]}]);
  c.send('STRT');assert.equal(c.phase,'window');
  c.params.targets=[{id,indices:[1]}];c.selected.add(id);
  c.send('');assert.equal(c.phase,'point');assert.equal(c.points.length,0);
  c.accept({x:1000,y:0});c.cursor={x:1000+direction.x*20,y:direction.y*20};c.send('100');
  const line=c.engine.doc.entities[0];assert.equal(line.points[0].x,0);assert.equal(line.points[0].y,0);
  assert.equal(line.points[1].x,1000+direction.x*100);assert.equal(line.points[1].y,direction.y*100);
  assert.equal(c.mode,'SELECT');c.run('UNDO');assert.equal(c.engine.doc.entities[0].points[1].x,1000);assert.equal(c.engine.doc.entities[0].points[1].y,0);
 }
});

test('STRETCH numeric preview matches result without changing the document',()=>{
 const c=session();const [id]=c.addEntities([{type:'rectangle',points:G.rectangle({x:0,y:0},{x:1000,y:500})}]);
 vm.runInContext(source.slice(source.indexOf('function distancePoint('),source.indexOf('let renderPending = false;')),c);
 c.send('STRT');c.params.targets=[{id,indices:[1,2]}];c.selected.add(id);c.send('');c.accept({x:1000,y:0});
 c.cursor={x:1200,y:0};c.$('coordinate').value='100';const preview=c.draft()[0];
 assert.equal(preview.points[1].x,1100);assert.equal(preview.points[2].x,1100);assert.equal(preview.points[0].x,0);
 assert.equal(c.engine.doc.entities[0].points[1].x,1000);c.send('100');
 assert.equal(JSON.stringify(preview),JSON.stringify(c.engine.doc.entities[0]));
});



test('IOD previews entered distance, finishes a bent path and cancels an unfinished path',()=>{
 const c=session();vm.runInContext(source.slice(source.indexOf('function distancePoint('),source.indexOf('let renderPending = false;')),c);
 c.send('IOD');c.send('100');c.accept({x:0,y:0});c.accept({x:1000,y:0});c.cursor={x:1000,y:2000};c.$('coordinate').value='1000';
 const preview=c.draft()[0];assert.deepEqual({...preview.parameters.path.at(-1)},{x:1000,y:1000});
 c.send('1000');c.send('');assert.equal(c.engine.doc.entities.length,1);
 assert.deepEqual(c.engine.doc.entities[0].entities,preview.entities);
 c.send('IOD');c.send('100');c.accept({x:5000,y:5000});c.cancelSelection();assert.equal(c.engine.doc.entities.length,1);
 c.run('UNDO');assert.equal(c.engine.doc.entities.length,0);
});


test('native utilities resolve locally with AutoCAD absent; command-first PC and undo',()=>{
 const c=session();c.lastCommand=null;
 const [id]=c.addEntities([{type:'polyline',closed:false,points:[{x:0,y:0},{x:100,y:0},{x:100,y:100}]}]);
 c.send('PC');assert.equal(c.phase,'select');c.selected.add(id);c.send('');
 assert.equal(c.engine.doc.entities[0].closed,true);c.run('UNDO');assert.equal(c.engine.doc.entities[0].closed,false);
 for(const cmd of ['TALIGN','DIMCLEAN','LEN','PC'])assert.equal(resolveCommand(cmd,c.settings),cmd);
});
test('native TALIGN DIMCLEAN LEN dialogs execute and preserve one-step undo',async()=>{
 const c=session();let apply; c.form=(title,fields,callback)=>{apply=callback;};
 let ids=c.addEntities([{type:'text',text:'문자',height:100,position:{x:10,y:20}},{type:'text',text:'둘',height:100,position:{x:30,y:40}}]);
 c.selected=new Set(ids);c.send('TALIGN');apply({axis:'Y',value:500});assert.ok(c.engine.doc.entities.every(e=>e.position.y===500));c.run('UNDO');assert.equal(c.engine.doc.entities[0].position.y,20);
 ids=c.addEntities([0,20,40].map(y=>({type:'dimension',mode:'horizontal',textHeight:100,points:[{x:0,y:0},{x:1000,y:0},{x:500,y:200+y}]})));
 c.pickPointOnce=async options=>{const before=JSON.stringify(c.engine.doc);const proposed=options.preview([], {x:100,y:200});assert.equal(proposed.filter(e=>e.type==='dimension').length,3);assert.equal(JSON.stringify(c.engine.doc),before);return {x:100,y:200};};c.selected=new Set(ids);c.send('DIMCLEAN');await apply({gap:150});assert.deepEqual(c.engine.doc.entities.filter(e=>e.type==='dimension').map(e=>e.points[2].y),[200,350,500]);c.run('UNDO');assert.equal(c.engine.doc.entities.at(-1).points[2].y,240);
 ids=c.addEntities([{type:'line',points:[{x:0,y:0},{x:300,y:400}]}]);c.selected=new Set(ids);const count=c.engine.doc.entities.length;c.send('LEN');apply({insert:'no'});assert.equal(c.engine.doc.entities.length,count);c.send('LEN');apply({insert:'yes',x:20,y:30});assert.equal(c.engine.doc.entities.at(-1).text,'길이 합계 500 mm');c.run('UNDO');assert.equal(c.engine.doc.entities.length,count);
});

test('transparent zoom and pan restore unfinished polyline and Escape cancels one stage',()=>{const c=session();c.send('PL');c.send('0,0');c.send('100,0');const before=JSON.stringify(c.points);c.send('Z');c.send('2X');assert.equal(c.mode,'PLINE');assert.equal(JSON.stringify(c.points),before);c.send('PAN');c.cancelStep();assert.equal(c.mode,'PLINE');c.send('100,100');c.send('C');assert.equal(c.engine.doc.entities.length,1);c.selected=new Set([c.engine.doc.entities[0].id]);c.send('M');c.cancelStep();assert.equal(c.selected.size,1);c.cancelStep();assert.equal(c.selected.size,0);});
test('ALL at idle uses editable objects',()=>{const c=session();c.addEntities([{type:'line',points:[{x:0,y:0},{x:1,y:1}]}]);c.send('ALL');assert.equal(c.selected.size,1);});

const pace50=async actions=>{for(const action of actions){action();await new Promise(resolve=>setTimeout(resolve,50));}};
test('요청된 핵심 명령은 50ms 연속 dispatcher 입력에서도 완료된다',async()=>{
 const drawing=()=>session();
 {
  const c=drawing();await pace50([()=>c.send('L'),()=>c.accept({x:0,y:0}),()=>c.accept({x:100,y:0}),()=>c.send('')]);assert.equal(c.engine.doc.entities[0].type,'line');
 }
 {
  const c=drawing();await pace50([()=>c.send('PL'),()=>c.accept({x:0,y:0}),()=>c.accept({x:100,y:0}),()=>c.accept({x:100,y:100}),()=>c.send('')]);assert.equal(c.engine.doc.entities[0].type,'polyline');
 }
 for(const command of ['M','CO','MI']){
  const c=drawing(),ids=c.addEntities([{type:'line',points:[{x:0,y:0},{x:100,y:0}]}]);c.selected=new Set(ids);
  await pace50([()=>c.send(command),()=>c.accept({x:0,y:0}),()=>c.accept(command==='MI'?{x:0,y:100}:{x:100,y:100}),...(command==='CO'?[()=>c.send('')]:[])]);
  assert.ok(c.engine.doc.entities.length>=1,command);
 }
 for(const [command,value] of [['RO','90'],['SC','2']]){
  const c=drawing(),ids=c.addEntities([{type:'line',points:[{x:0,y:0},{x:100,y:0}]}]);c.selected=new Set(ids);
  await pace50([()=>c.send(command),()=>c.accept({x:0,y:0}),()=>c.send(value)]);assert.equal(c.mode,'SELECT',command);
 }
 {
  const c=drawing();c.addEntities([{type:'line',points:[{x:0,y:0},{x:1000,y:0}]}]);await pace50([()=>c.send('O'),()=>c.send('100'),()=>c.accept({x:500,y:0}),()=>c.accept({x:500,y:100}),()=>c.send('')]);assert.equal(c.engine.doc.entities.length,2);
 }
 for(const command of ['TR','EX']){
  const c=drawing();c.addEntities([{type:'line',points:[{x:0,y:0},{x:1000,y:0}]},{type:'line',points:[{x:500,y:-100},{x:500,y:100}]}]);
  await pace50([()=>c.send(command)]);assert.equal(c.phase,'select',command); // 대표 결정(10-23): 자동 빠른 모드 없음 — 경계부터 고른다
  await pace50([()=>c.send('')]);assert.equal(c.phase,'pick',command); // 아무것도 안 고르고 Enter = 모든 선이 경계
 }
 {
  const c=drawing(),ids=c.addEntities([{type:'line',points:[{x:0,y:0},{x:1000,y:0}]},{type:'line',points:[{x:1000,y:0},{x:1000,y:1000}]}]);
  await pace50([()=>c.send('FIL'),()=>c.send('R'),()=>c.send('100'),()=>{c.selected=new Set(ids)},()=>c.send('')]);assert.ok(c.engine.doc.entities.some(entity=>entity.type==='arc'));
 }
 for(const [command,points,type] of [['REC',[{x:0,y:0},{x:100,y:50}],'rectangle'],['CI',[{x:0,y:0},{x:50,y:0}],'circle']]){
  const c=drawing();await pace50([()=>c.send(command),...points.map(point=>()=>c.accept(point))]);assert.equal(c.engine.doc.entities[0].type,type);
 }
});

// 오토캐드 맞춤 9·10 (6.0.15)
test('AutoCAD command names typed as-is reach the matching Barun command',()=>{
 const s={aliases:defaultAliases()};
 for(const [typed,name] of Object.entries({DIM:'DIMSMART',LAYFRZ:'FREEZE',LAYTHW:'THAW',LAYUNISO:'LAYRESTORE',WBLOCK:'WBLOCK',PURGE:'PURGE',PU:'PURGE',OVERKILL:'OVERKILL',AUDIT:'AUDIT',LENGTHEN:'LENGTHEN',MREDO:'REDO',QDIM:'QUICKDIM'}))assert.equal(resolveCommand(typed,s),name,typed);
 assert.equal(resolveCommand('LEN',s),'LEN','바른 CAD 고유 이름이 먼저');
});
test('FROM takes a base point then an @ offset from it',()=>{
 const c=session();for(const v of ['L','0,0','FRO','100,0','@50,0',''])c.send(v);
 assert.deepEqual(c.engine.doc.entities[0].points[1],{x:150,y:0});
});
test('LINE Enter at the first prompt continues from the last line end; ARC Enter draws a tangent arc',()=>{
 const c=session();for(const v of ['L','0,0','100,0','','L','','100,100',''])c.send(v);
 assert.deepEqual(c.engine.doc.entities[1].points,[{x:100,y:0},{x:100,y:100}]);
 const d=session();for(const v of ['L','0,0','100,0','','A','','200,100'])d.send(v);
 const arc=d.engine.doc.entities[1];assert.equal(arc.type,'arc');assert.ok(Math.abs(arc.radius-100)<1e-6);assert.ok(Math.abs(arc.center.x-100)<1e-6&&Math.abs(arc.center.y-100)<1e-6);
});
test('INSERT asks scale then rotation, Enter keeps the remembered defaults',()=>{
 const c=session();c.engine.doc.blocks=[{name:'K',entities:[{type:'line',layer:c.engine.doc.layers[0].id,points:[{x:0,y:0},{x:100,y:0}]}]}];
 for(const v of ['INSERT','K','0,0','2','90'])c.send(v);
 const p=c.engine.doc.entities[0].entities[0].points[1];assert.ok(Math.abs(p.x)<1e-6&&Math.abs(p.y-200)<1e-6);
 for(const v of ['INSERT','K','500,0','',''])c.send(v);
 const q=c.engine.doc.entities[1].entities[0].points[1];assert.ok(Math.abs(q.x-500)<1e-6&&Math.abs(q.y-200)<1e-6,'축척·회전 기억');
});
test('POLYGON E builds from an edge; ELLIPSE R uses rotation; XLINE B bisects',()=>{
 const c=session();for(const v of ['POL','4','E','0,0','100,0'])c.send(v);
 const sq=c.engine.doc.entities[0].points;assert.equal(sq.length,4);assert.ok(Math.abs(sq[2].x-100)<1e-6&&Math.abs(sq[2].y-100)<1e-6);
 const e=session();for(const v of ['EL','0,0','200,0','R','60'])e.send(v);const el=e.engine.doc.entities[0];assert.ok(Math.abs(el.ratio-0.5)<1e-6,JSON.stringify(el)+e.phase+e.mode);
 const x=session();for(const v of ['XL','B','0,0','100,0','0,100'])x.send(v);const [a,b]=x.engine.doc.entities[0].points;assert.ok(Math.abs(Math.abs(G.angle(G.sub(b,a))%180)-45)<1e-6);
});
test('STRETCH with preselection skips the window and D takes a displacement',()=>{
 const c=session();const ids=c.addEntities([{type:'line',points:[{x:0,y:0},{x:100,y:0}]}]);c.selected=new Set(ids);
 c.send('STRT');assert.equal(c.phase,'point');c.send('D');c.send('100,50');
 assert.deepEqual(c.engine.doc.entities[0].points,[{x:100,y:50},{x:200,y:50}]);
});
test('MATCHPROP with a preselected source applies to clicked targets',()=>{
 const c=session();const ids=c.addEntities([{type:'line',color:'#00ff00',lineweight:.5,linetypeScale:3,points:[{x:0,y:0},{x:100,y:0}]},{type:'line',points:[{x:0,y:200},{x:100,y:200}]}]);
 c.selected=new Set([ids[0]]);c.send('MA');assert.equal(c.phase,'select');c.accept({x:50,y:200});
 const t=c.engine.doc.entities[1];assert.equal(t.color,'#00ff00');assert.equal(t.lineweight,.5);assert.equal(t.linetypeScale,3);
});
test('polar tracking snaps the cursor to the increment angle from the last point; ortho and polar are exclusive',()=>{
 assert.match(source,/function polarInput\(point,raw\)\{/);
 assert.match(source,/return orthogonalInput\(polarInput\(result,p\)\);/);
 assert.match(source,/F10:'polar'/);
});
test('상태표시줄 작도 보조 단추는 기능 키 순서(F3·F8·F9·F10·F11)로 놓이고 그 키로 켜고 끈다',()=>{
 const order="['osnap','ortho','snap','polar','otrack']";
 assert.equal(source.split("for(const id of "+order+"){").length-1,2,'단추 만들기와 표시 맞추기 두 곳 모두');
 const keys={F3:'osnap',F8:'ortho',F9:'snap',F10:'polar',F11:'otrack'};
 assert.deepEqual(Object.values(keys),JSON.parse(order.replace(/'/g,'"')));
 for(const [key,id] of Object.entries(keys))assert.match(source,new RegExp(key+":'"+id+"'"));
});
test('FILLET/CHAMFER options: remembered values, T no-trim, CHAMFER two distances and angle, polyline P and adjacent segments',()=>{
 const L=(a,b)=>({type:'line',points:[a,b]});
 // CHAMFER D 두 거리 → 선택(Enter 흐름)
 const c=session();const ids=c.addEntities([L({x:0,y:0},{x:1000,y:0}),L({x:0,y:0},{x:0,y:1000})]);
 c.send('CHA');c.send('D');c.send('100');c.send('200');c.selected=new Set(ids);c.params.cornerPicks={[ids[0]]:{x:500,y:0},[ids[1]]:{x:0,y:500}};c.finish();
 const chamferLine=c.engine.doc.entities.find(e=>e.type==='line'&&e.points.some(p=>p.y===200));assert.ok(chamferLine,'둘째 거리 200');
 // FILLET T(N) 자르지 않기: 원래 선 그대로 + 호
 const f=session();const fids=f.addEntities([L({x:0,y:0},{x:1000,y:0}),L({x:0,y:0},{x:0,y:1000})]);
 f.send('F');f.send('R');f.send('100');f.send('T');f.send('N');f.selected=new Set(fids);f.finish();
 assert.equal(f.engine.doc.entities.filter(e=>e.type==='line').length,2);assert.equal(f.engine.doc.entities.filter(e=>e.type==='arc').length,1);
 assert.deepEqual(f.engine.doc.entities[0].points,[{x:0,y:0},{x:1000,y:0}]);
 // 다음 실행도 반지름·자르기를 기억한다
 f.send('F');assert.equal(f.run.corner.FILLET.radius,100);assert.equal(f.run.corner.FILLET.trim,false);
 // 폴리선 P: 모든 꼭짓점
 const p=session();const [pid]=p.addEntities([{type:'polyline',closed:true,points:[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000},{x:0,y:1000}]}]);
 p.engine.execute({type:'fillet',polylineId:pid,size:100});assert.ok(p.engine.doc.entities[0].points.length>8);
 // 이웃한 두 구간 → 그 꼭짓점 하나만
 const q=session();const [qid]=q.addEntities([{type:'polyline',closed:false,points:[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000}]}]);
 q.engine.execute({type:'chamfer',polylineId:qid,vertices:[1],size:100,size2:100});assert.deepEqual(q.engine.doc.entities[0].points.map(p=>[Math.round(p.x),Math.round(p.y)]),[[0,0],[900,0],[1000,100],[1000,1000]]);
 // 모따기 각도 방식
 const a=session();const aids=a.addEntities([L({x:0,y:0},{x:1000,y:0}),L({x:0,y:0},{x:0,y:1000})]);
 a.engine.execute({type:'chamfer',ids:aids,size:100,chamferAngle:45,pickPoints:{[aids[0]]:{x:500,y:0},[aids[1]]:{x:0,y:500}}});
 const cl=a.engine.doc.entities.at(-1);assert.ok(cl.points.some(p=>Math.abs(p.y-100)<1e-6),'45° → 둘째 거리 100');
});
test('TRIM fence trims every crossed line in one undo; Shift swaps to extend; U undoes the last trim',()=>{
 const L=(a,b)=>({type:'line',points:[a,b]});
 const c=session();c.addEntities([L({x:0,y:0},{x:0,y:1000}),L({x:-500,y:200},{x:500,y:200}),L({x:-500,y:400},{x:500,y:400})]);
 c.send('TR');c.send('');assert.equal(c.phase,'pick');
 c.fenceTrim({x:300,y:100},{x:300,y:500},'trim');
 const lines=c.engine.doc.entities.filter(e=>e.type==='line');
 assert.ok(lines.filter(e=>e.points.some(p=>p.y===200||p.y===400)).every(e=>Math.max(...e.points.map(p=>p.x))<=1e-6),'오른쪽 구간이 잘림');
 c.send('U');assert.equal(c.engine.doc.entities.filter(e=>e.type==='line'&&e.points.some(p=>p.x===500)).length,2,'U 한 번에 울타리 전체 되돌림');
 const d=session();d.addEntities([L({x:0,y:0},{x:0,y:1000}),L({x:-500,y:200},{x:-100,y:200})]);d.send('TR');d.send('');
 d.shiftOrthoHeld=true;d.accept({x:-120,y:200});d.shiftOrthoHeld=false;
 assert.ok(d.engine.doc.entities.some(e=>e.type==='line'&&e.points.some(p=>Math.abs(p.x)<1e-6&&p.y===200)),'Shift+클릭 = 연장');
});
test('command line autocomplete and clickable prompt options are wired',()=>{
 assert.match(source,/function updateCommandSuggest\(\)\{/);
 assert.match(source,/if \(typeof commandSuggestKey === 'function' && commandSuggestKey\(e\)\) return;/);
 assert.match(source,/function renderPrompt\(text\)\{/);
 assert.match(source,/renderPrompt\(instruction\(\)\);/);
});
test('PL arc mode is AutoCAD style: tangent arcs until L, CE/R/A/D/S options, CL closes with an arc',()=>{
 const c=session();for(const v of ['PL','0,0','100,0','A','200,100'])c.send(v);
 assert.equal(c.phase,'pline-arc','호 모드 유지');const last=c.points.at(-1);assert.equal(last.x,200);assert.equal(last.y,100);
 const mid=c.points[Math.floor((2+c.points.length-1)/2)];assert.ok(Math.abs(G.dist(mid,{x:100,y:100})-100)<1,'접선 호(중심 100,100 반지름 100)');
 c.send('L');assert.equal(c.phase,'point');c.send('200,300');c.send('');
 assert.deepEqual(c.engine.doc.entities[0].points.at(-1),{x:200,y:300});
 const d=session();for(const v of ['PL','0,0','100,0','A','R','50','200,0'])d.send(v);assert.ok(d.points.every(p=>Math.abs(p.y)<=50+1e-6));
 const e=session();for(const v of ['PL','0,0','100,0','A','CE','100,100','0,100'])e.send(v);assert.ok(Math.abs(G.dist(e.points.at(-1),{x:100,y:100})-100)<1e-6);
 const f=session();for(const v of ['PL','0,0','1000,0','A','1000,1000','CL'])f.send(v);assert.equal(f.engine.doc.entities[0].closed,true);
});
test('TEXT J sets justification: MC centers horizontally and drops the baseline by half the height',()=>{
 const c=session();for(const v of ['TEXT','J','MC','100,100','200','0','가'])c.send(v);
 const t=c.engine.doc.entities[0];assert.equal(t.align,'center');assert.equal(t.position.x,100);assert.ok(Math.abs(t.position.y-0)<1e-6);
 c.send('');const d=session();d.run.textJustify='L';for(const v of ['TEXT','0,0','100','0','나'])d.send(v);assert.equal(d.engine.doc.entities[0].align,undefined);
});
test('RECTANG F/C/W options are remembered and A builds from an area',()=>{
 const c=session();for(const v of ['REC','F','100','0,0','1000,500'])c.send(v);
 const r=c.engine.doc.entities[0];assert.equal(r.type,'polyline');assert.ok(r.points.length>8,'모깎기 모서리');
 for(const v of ['REC','F','0','C','50','','0,1000','1000,1500'])c.send(v);const ch=c.engine.doc.entities[1];assert.equal(ch.points.length,8,'모따기 8점');
 for(const v of ['REC','C','0','','W','20','0,2000','1000,2500'])c.send(v);assert.equal(c.engine.doc.entities[2].constantWidth,20);
 const d=session();for(const v of ['REC','0,0','A','200000','L','500'])d.send(v);const box=G.bounds([d.engine.doc.entities[0]]);assert.equal(box.maxX-box.minX,500);assert.equal(box.maxY-box.minY,400);
});
test('BLOCK asks retain/convert/delete and offers redefinition that updates same-name inserts',()=>{
 const c=session();vm.runInContext(source.slice(source.indexOf('function blockPoints('),source.indexOf('function toSharedLocal(')),c);const layer=c.engine.doc.layers[0].id;
 const ids=c.addEntities([{type:'line',layer,points:[{x:0,y:0},{x:100,y:0}]}]);c.selected=new Set(ids);
 for(const v of ['BLOCK','K','0,0','R'])c.send(v);assert.equal(c.engine.doc.blocks.length,1);assert.equal(c.engine.doc.entities[0].type,'line','유지');
 c.engine.execute({type:'block.insert',name:'K',position:{x:1000,y:0},layer});
 const ids2=c.addEntities([{type:'line',layer,points:[{x:0,y:0},{x:0,y:300}]}]);c.selected=new Set(ids2);
 for(const v of ['BLOCK','K','Y','0,0','D'])c.send(v);
 assert.equal(c.engine.doc.blocks[0].entities[0].points[1].y,300,'정의 재정의');
 const insert=c.engine.doc.entities.find(e=>e.type==='block');assert.ok(Math.abs(insert.entities[0].points[1].y-300)<1e-6&&Math.abs(insert.entities[0].points[1].x-1000)<1e-6,'삽입본 갱신');
 assert.ok(!c.engine.doc.entities.some(e=>e.id===ids2[0]),'삭제');
});
test('OFFSET E erases the source, M keeps offsetting from the new copy, U undoes the last offset',()=>{
 const c=session();c.addEntities([{type:'line',points:[{x:0,y:0},{x:1000,y:0}]}]);
 for(const v of ['O','E','Y','100'])c.send(v);c.accept({x:500,y:0});c.accept({x:500,y:500});
 const ys=c.engine.doc.entities.map(e=>e.points[0].y);assert.deepEqual(ys,[100],'원본 지움');
 c.send('');c.run.offsetErase=false;
 const d=session();d.addEntities([{type:'line',points:[{x:0,y:0},{x:1000,y:0}]}]);
 for(const v of ['O','100'])d.send(v);d.accept({x:500,y:0});d.send('M');d.accept({x:500,y:500});d.accept({x:500,y:500});
 assert.deepEqual(d.engine.doc.entities.map(e=>e.points[0].y).sort((a,b)=>a-b),[0,100,200],'다중: 새 선에서 계속');
 d.send('U');assert.equal(d.engine.doc.entities.length,2);
});
test('CIRCLE TTR draws the circle tangent to two lines on the picked side',()=>{
 const c=session();c.addEntities([{type:'line',points:[{x:0,y:0},{x:1000,y:0}]},{type:'line',points:[{x:0,y:0},{x:0,y:1000}]}]);
 c.send('CI');c.send('T');c.accept({x:300,y:0});c.accept({x:0,y:300});c.send('100');
 const circle=c.engine.doc.entities.find(e=>e.type==='circle');assert.ok(circle);assert.ok(Math.abs(circle.center.x-100)<1e-6&&Math.abs(circle.center.y-100)<1e-6);
});
test('DRAWORDER moves objects to front/back or above a reference; HATCHTOBACK and TEXTTOFRONT',()=>{
 const c=session();const ids=c.addEntities([{type:'line',points:[{x:0,y:0},{x:1,y:0}]},{type:'hatch',points:[{x:0,y:0},{x:1,y:0},{x:1,y:1}]},{type:'text',position:{x:0,y:0},text:'a',height:1}]);
 c.selected=new Set([ids[0]]);c.send('DRAWORDER');c.send('F');assert.equal(c.engine.doc.entities.at(-1).id,ids[0]);
 c.run('HATCHTOBACK');assert.equal(c.engine.doc.entities[0].type,'hatch');
 c.run('TEXTTOFRONT');assert.equal(c.engine.doc.entities.at(-1).type,'text');
 c.selected=new Set([ids[1]]);c.send('DRAWORDER');c.send('A');c.selected=new Set([ids[0]]);c.send('');
 const order=c.engine.doc.entities.map(e=>e.id);assert.equal(order.indexOf(ids[1]),order.indexOf(ids[0])+1,'기준 위로');
});
test('hot grip C copies repeatedly while keeping the original, B sets a new base point, U undoes a copy',()=>{
 const c=session();const ids=c.addEntities([{type:'line',points:[{x:0,y:0},{x:100,y:0}]}]);c.selected=new Set(ids);
 c.reset();c.mode='GRIP';c.phase='point';c.params={gripId:ids[0],grip:{point:{x:0,y:0}},op:'move'};c.points=[{x:0,y:0}];
 c.send('C');c.accept({x:0,y:100});c.accept({x:0,y:200});assert.equal(c.engine.doc.entities.length,3);
 c.send('U');assert.equal(c.engine.doc.entities.length,2);
 c.send('B');c.accept({x:100,y:0});c.accept({x:100,y:500});assert.ok(c.engine.doc.entities.some(e=>e.points[0].y===500));
 assert.equal(c.engine.doc.entities[0].points[0].y,0,'원본 그대로');
});
test('select prompt F, WP and CP choose objects by fence and polygons',()=>{
 const L=(y)=>({type:'line',points:[{x:0,y},{x:100,y}]});
 const c=session();const ids=c.addEntities([L(0),L(50),L(200)]);c.send('E');assert.equal(c.phase,'select');
 c.send('F');c.params.selectPoly.points.push({x:50,y:-10},{x:50,y:60});c.finish();
 assert.deepEqual([...c.selected].sort(),[ids[0],ids[1]].sort(),'울타리');
 c.selected=new Set();c.send('WP');c.params.selectPoly.points.push({x:-10,y:-10},{x:110,y:-10},{x:110,y:20},{x:-10,y:20});c.finish();assert.deepEqual([...c.selected],[ids[0]],'창 다각형');
 c.selected=new Set();c.send('CP');c.params.selectPoly.points.push({x:50,y:-10},{x:150,y:-10},{x:150,y:60},{x:50,y:60});c.finish();assert.deepEqual([...c.selected].sort(),[ids[0],ids[1]].sort(),'걸침 다각형');
});
test('ARC variants: start-center-angle, center-start-length, start-end-angle and start-end-direction',()=>{
 const ang=(a)=>((a%360)+360)%360;
 const c=session();for(const v of ['A','0,0','C','-100,0','A','90'])c.send(v);let arc=c.engine.doc.entities[0];assert.ok(Math.abs(arc.radius-100)<1e-6&&Math.abs(ang(arc.endAngle)-90)<1e-6,'SCA');
 const d=session();for(const v of ['A','C','0,0','100,0','L','141.42135623730951'])d.send(v);arc=d.engine.doc.entities[0];assert.ok(Math.abs(ang(arc.endAngle-arc.startAngle)-90)<1e-6,'CSL');
 const e=session();for(const v of ['A','0,0','E','200,0','A','180'])e.send(v);arc=e.engine.doc.entities[0];assert.ok(Math.abs(arc.radius-100)<1e-6&&Math.abs(arc.center.x-100)<1e-6,'SEA');
 const f=session();for(const v of ['A','0,0','E','200,0','D','0,100'])f.send(v);arc=f.engine.doc.entities[0];assert.ok(Math.abs(arc.center.x-100)<1e-6&&Math.abs(arc.center.y)<1e-6,'SED');
});
test('dynamic input: a length locked with Tab and an angle make the next point',()=>{
 const c=session();c.send('L');c.send('0,0');c.params.dynLength=500;c.send('90');
 const p=c.engine.doc.entities[0].points[1];assert.ok(Math.abs(p.x)<1e-6&&Math.abs(p.y-500)<1e-6);
 assert.match(source,/e\.key === 'Tab' && !e\.shiftKey && dynamicInputReady\(\)/);
});
test('LAYER opens the layer manager table (on/freeze/lock/color/linetype/lineweight/transparency/plot/description, multi-row edits)',()=>{
 assert.match(source,/function openLayerManager\(\)\{/);
 // ACAD200 701: 표는 layer-manager.js 가 그린다(투명도·설명 열 추가). app.js 는 연결만.
 const manager=fs.readFileSync('layer-manager.js','utf8');
 assert.match(manager,/\['현재', '이름', '켜기', '동결', '잠금', '색', '선종류', '굵기', '투명도', '인쇄', '설명', '객체'\]/);
 assert.match(manager,/if \(changes\.frozen && list\.includes\(activeLayer\)\) throw Error\('현재 레이어는 동결할 수 없습니다\.'\);/);
});
test('PASTEBLOCK pastes the CAD clipboard as one auto-named block',()=>{
 const c=session();c.selected=new Set(c.addEntities([{type:'line',points:[{x:0,y:0},{x:100,y:0}]},{type:'line',points:[{x:0,y:0},{x:0,y:100}]}]));
 c.run('COPYCLIP');c.run('PASTEBLOCK');c.accept({x:500,y:500});
 const block=c.engine.doc.entities.find(e=>e.type==='block');assert.ok(block&&block.name.startsWith('A$C'));assert.equal(block.entities.length,2);
});
test('dimension ends follow the style arrowType (filled arrow, open, tick); radius has one arrow at the arc',()=>{
 const base={type:'dimension',mode:'aligned',points:[{x:0,y:0},{x:1000,y:0},{x:500,y:300}],textHeight:100,arrowSize:100};
 const parts=t=>G.dimensionParts({...base,arrowType:t});
 assert.equal(parts('closed-filled').filter(p=>p.type==='hatch').length,2);
 assert.equal(parts('tick').filter(p=>p.type==='hatch').length,0);
 assert.equal(parts(undefined).filter(p=>p.type==='hatch').length,0,'설정 없는 치수는 사선');
 assert.equal(parts('open').filter(p=>p.type==='line').length,1+2+4,'치수선+보조선 2+열린 화살표 4선');
 assert.equal(G.dimensionParts({...base,mode:'radius',arrowType:'closed-filled'}).filter(p=>p.type==='hatch').length,1);
});

// DIMLINEAR regression: execute the actual UI command functions and draft(),
// with style defaults from the same helper used by the browser.
function dimensionSession(){
 const c=session();c.buildSmartDimension=buildSmartDimension;c.styledDimension=e=>applyDimStyle(e,getDimStyle(c.engine.doc));
 vm.runInContext(source.slice(source.indexOf('function draft()'),source.indexOf('// 하단 상태줄')),c);
 return c;
}
test('linear dimensions preview each point stage, auto-switch axes, then persist exactly the preview',()=>{
 const c=dimensionSession();c.send('DLI');c.cursor={x:10,y:20};assert.equal(c.draft().length,0);
 c.accept({x:0,y:0});assert.equal(c.draft()[0].type,'line');
 c.accept({x:500,y:1800});assert.equal(c.engine.doc.entities.length,0);
 for(const [p,mode] of [[{x:250,y:2200},'horizontal'],[{x:250,y:-300},'horizontal'],[{x:1000,y:800},'vertical'],[{x:-500,y:800},'vertical']]){
  c.cursor=p;const dim=c.draft()[0];assert.equal(dim.mode,mode);
  const parts=G.dimensionParts(dim);assert.equal(parts.filter(p=>p.type==='line').length,3);assert.equal(parts.filter(p=>p.type==='hatch').length,2);assert.ok(parts.find(p=>p.dimensionLabel).height>0);
 }
 const preview=c.draft()[0];c.accept(c.cursor);const dim=c.engine.doc.entities[0];assert.equal(c.mode,'SELECT');assert.equal(dim.mode,preview.mode);assert.deepEqual(dim.points,preview.points);assert.equal(dim.textHeight,preview.textHeight);assert.equal(c.draft().length,0);c.engine.validate(c.engine.doc);
});
test('Enter object selection consumes both endpoints before placement for linear and aligned dimensions',()=>{
 for(const name of ['DIMLINEAR','DIMALIGNED']){
  const c=dimensionSession();c.addEntities([{type:'line',points:[{x:0,y:0},{x:500,y:1800}]}]);c.send(name);c.send('');c.accept({x:250,y:900});
  assert.equal(c.phase,'point');assert.equal(c.points.length,2);c.cursor={x:1000,y:800};const draft=c.draft()[0];assert.equal(draft.type,'dimension');assert.equal(draft.mode,name==='DIMALIGNED'?'aligned':'vertical');
  c.accept(c.cursor);assert.equal(c.engine.doc.entities.length,2);assert.equal(c.mode,'SELECT');
 }
});
test('polyline segment and circle object selection both enter dimension placement immediately',()=>{
 for(const [entity,p] of [[{type:'polyline',points:[{x:0,y:0},{x:500,y:0},{x:500,y:800}]},{x:500,y:400}],[{type:'circle',center:{x:0,y:0},radius:500},{x:500,y:0}]]){
  const c=dimensionSession();c.addEntities([entity]);c.send('DLI');c.send('');c.accept(p);assert.equal(c.points.length,2);assert.equal(c.phase,'point');c.cursor={x:800,y:1000};assert.equal(c.draft()[0].type,'dimension');
 }
});
test('M/T/A/H/V/R dimension options update both preview and committed properties',()=>{
 const c=dimensionSession();for(const v of ['DLI','0,0','1000,500','M','길이 <>\\P검토','A','30','R','45'])c.send(v);
 c.cursor={x:500,y:900};let draft=c.draft()[0];assert.equal(draft.axisAngle,45);assert.equal(draft.textRotation,30);assert.equal(draft.text,'길이 <>\n검토');assert.equal(G.dimensionParts(draft).find(p=>p.dimensionLabel).rotation,30);
 c.send('V');assert.equal(c.draft()[0].mode,'vertical');assert.equal(c.draft()[0].axisAngle,undefined);c.send('H');c.send('T');c.send('검토 <>');draft=c.draft()[0];c.accept(c.cursor);assert.equal(c.engine.doc.entities[0].text,draft.text);assert.equal(c.engine.doc.entities[0].textRotation,30);
});
test('radius/diameter selected circle or arc gets full cursor preview and persistent dimension',()=>{
 for(const name of ['DIMRADIUS','DIMDIAMETER']){
  const c=dimensionSession();c.addEntities([{type:'arc',center:{x:0,y:0},radius:500,startAngle:0,endAngle:90}]);c.send(name);c.cursor={x:500,y:0};assert.equal(c.draft().length,0);c.accept(c.cursor);c.cursor={x:700,y:700};const draft=c.draft()[0];assert.equal(draft.mode,name==='DIMRADIUS'?'radius':'diameter');c.accept(c.cursor);const dim=c.engine.doc.entities.at(-1);assert.deepEqual(dim.points,draft.points);assert.equal(c.mode,'SELECT');
 }
});
test('hidden dimension destination reports an error and retains two points for retry',()=>{
 const c=dimensionSession();c.addEntities=es=>c.engine.execute({type:'add.classified',entities:es.map(e=>({...e,layer:'default'}))});c.engine.doc.layers.push({id:'dim-off',name:'A-DIM',visible:false,locked:false,color:'#ffffff'});
 c.send('DLI');c.accept({x:0,y:0});c.accept({x:1000,y:0});assert.throws(()=>c.accept({x:0,y:500}),/레이어/);assert.equal(c.points.length,2);assert.equal(c.engine.doc.entities.length,0);c.engine.doc.layers.find(l=>l.id==='dim-off').visible=true;c.accept({x:0,y:500});assert.equal(c.engine.doc.entities[0].type,'dimension');
});

test('dimension text accepts snap/coordinate keywords verbatim and Korean keyboard H/V options work',()=>{
 const c=dimensionSession();for(const v of ['DLI','0,0','1000,500'])c.send(v);
 for(const word of ['FROM','M2P','CEN','END','NEA','한글']){c.send('T');c.send(word);assert.equal(c.params.dimText,word);assert.equal(c.phase,'point');assert.equal(c.params.fromState,undefined);assert.equal(c.params.m2p,undefined);}
 c.send('ㅗ');assert.equal(c.params.dimForce,'horizontal');c.send('ㅍ');assert.equal(c.params.dimForce,'vertical');
});

test('DCO/DBA preview repeated attachments without changing step, style, or document until click',()=>{
 for(const name of ['DCO','DBA']){
  const c=dimensionSession();const [id]=c.addEntities([{type:'dimension',mode:'horizontal',textHeight:100,scale:2,text:'수정 문자',textPosition:{x:500,y:800},points:[{x:0,y:0},{x:1000,y:0},{x:0,y:300}]}]);c.selected=new Set([id]);c.send(name);
  for(const x of [2000,3500]){
   c.cursor={x,y:0};const before=JSON.stringify(c.engine.doc),step=c.params.baselineStep;
   const proposed=c.draft()[0];assert.equal(proposed.type,'dimension');assert.equal(proposed.textPosition,undefined);assert.equal(proposed.text,'');assert.ok(G.dimensionParts(proposed).some(p=>p.dimensionLabel));c.draft();assert.equal(JSON.stringify(c.engine.doc),before);assert.equal(c.params.baselineStep,step);
   c.accept(c.cursor);const actual=c.engine.doc.entities.at(-1);assert.equal(JSON.stringify(actual.points),JSON.stringify(proposed.points));assert.equal(actual.scale,proposed.scale);
  }
 }
});
test('radial M/T/A options and preselected arc share preview and final properties',()=>{
 for(const name of ['DRA','DDI']){const c=dimensionSession();const [id]=c.addEntities([{type:'arc',center:{x:0,y:0},radius:500,startAngle:0,endAngle:90}]);c.selected=new Set([id]);c.send(name);c.send('T');c.send('R=<>');c.send('A');c.send('25');c.cursor={x:800,y:800};const proposed=c.draft()[0];assert.equal(proposed.text,'R=<>');assert.equal(proposed.textRotation,25);c.accept(c.cursor);assert.deepEqual(c.engine.doc.entities.at(-1).points,proposed.points);}
});
test('hot dimension grip previews the actual stretched dimension or text update',()=>{
 for(const text of [false,true]){const c=dimensionSession();const [id]=c.addEntities([{type:'dimension',mode:'horizontal',textHeight:100,points:[{x:0,y:0},{x:1000,y:0},{x:500,y:300}]}]);const entity=c.engine.doc.entities[0],grip=G.editingGrips(entity).find(g=>text?g.kind==='dimension-text':g.index===2);c.selected=new Set([id]);c.mode='GRIP';c.phase='point';c.points=[grip.point];c.params={op:'stretch',gripId:id,grip};c.cursor={x:800,y:900};const before=JSON.stringify(c.engine.doc),proposed=c.draft()[0];assert.equal(proposed.type,'dimension');assert.equal(JSON.stringify(c.engine.doc),before);c.accept(c.cursor);assert.deepEqual(G.dimensionParts(c.engine.doc.entities[0]),G.dimensionParts(proposed));}
});
test('point picker preserves options including Enter default for DIMEDIT',async()=>{
 const c=session();c.pickPathOnce=async options=>{assert.ok(options.options.includes(''));return {option:''};};vm.runInContext(source.slice(source.indexOf('function pickPointOnce('),source.indexOf('/* 모달 폼이 열린')),c);
 const result=await c.pickPointOnce({prompt:'치수 편집',options:['','H']});assert.equal(result.option,'');
});
test('SCALE reference: R two points, then P two points matches the new length (AutoCAD Points)',()=>{
 const c=session();const ids=c.addEntities([{type:'line',points:[{x:0,y:0},{x:1000,y:0}]},{type:'line',points:[{x:0,y:500},{x:2500,y:500}]}]);
 c.selected=new Set([ids[0]]);c.send('SC');c.accept({x:0,y:0});c.send('R');c.accept({x:0,y:0});c.accept({x:1000,y:0});
 c.send('P');assert.equal(c.params.scaleRef.stage,'new1');c.accept({x:0,y:500});c.accept({x:2500,y:500});
 assert.deepEqual(c.engine.doc.entities.find(e=>e.id!==ids[1]).points,[{x:0,y:0},{x:2500,y:0}]);assert.equal(c.mode,'SELECT');
});
test('WBLOCK (WB) asks for objects first, then hands the chosen ids to writeBlock',()=>{
 assert.equal(resolveCommand('WB',{aliases:defaultAliases()}),'WBLOCK');
 const c=session();const ids=c.addEntities([{type:'line',points:[{x:0,y:0},{x:1000,y:0}]},{type:'line',points:[{x:0,y:500},{x:900,y:500}]}]);
 let written=null;c.writeBlock=list=>{written=list;};
 c.send('WBLOCK');assert.equal(c.phase,'select');c.selected=new Set([ids[1]]);c.send('');
 assert.deepEqual([...written],[ids[1]]);assert.equal(c.mode,'SELECT');
});
