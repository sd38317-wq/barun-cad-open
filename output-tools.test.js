// output-tools.js 의 순수 함수(기하·정규화·상태) 시험. DOM 없이 node --test 로 돈다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
 roundValue,roundPoint,correctionPatch,
 plotBoxLayerIds,entitiesOnLayers,
 sabTranslateDelta,toZeroLayerStandard,
 nextBackgroundTheme,
 isAbsoluteWindowsPath,folderOfPath,
 closableTabIds,
 tabsInScope,dirtySkippedCount,closeTabsVerified,installOutputTools,
 filterBackupEntries,restoreEntries,parseSettingsFile,
 stampDateText,buildStamp,
 fridgeSize,kitchenModules,kitchenGeometry,
 stallCount,partitionPositions,boothGeometry,
} from './output-tools.js';
import * as G from './geometry.js';

/* ── CER ── */
test('roundValue/roundPoint snap to tolerance grid relative to a base point',()=>{
 assert.equal(roundValue(15.3,0.5),15.5);
 assert.equal(roundValue(15.3,1),15);
 assert.equal(roundValue(5301.33,1),5301);
 assert.deepEqual(roundPoint({x:5301.33,y:3400.01},1),{x:5301,y:3400});
 assert.deepEqual(roundPoint({x:10.3,y:20.7},1,{x:10,y:20}),{x:10,y:21});
});
test('correctionPatch only touches selected types and only when coordinates actually change',()=>{
 const line={id:'a',type:'line',points:[{x:0.3,y:0},{x:10.2,y:0}]};
 const p1=correctionPatch(line,{tol:1,types:['line']});
 assert.deepEqual(p1,{points:[{x:0,y:0},{x:10,y:0}]});
 const p2=correctionPatch(line,{tol:1,types:['circle']});
 assert.deepEqual(p2,{});
 const clean={id:'b',type:'line',points:[{x:0,y:0},{x:10,y:0}]};
 assert.deepEqual(correctionPatch(clean,{tol:1,types:['line']}),{});
});
test('correctionPatch rounds circle/arc center and optionally radius',()=>{
 const c={id:'c',type:'circle',center:{x:5301.33,y:0.2},radius:100.4};
 assert.deepEqual(correctionPatch(c,{tol:1,types:['circle']}),{center:{x:5301,y:0}});
 assert.deepEqual(correctionPatch(c,{tol:1,types:['circle'],roundRadius:true}),{center:{x:5301,y:0},radius:100});
});
test('correctionPatch on a block moves the insertion point and, when blockInner, corrects nested entities at the origin with their own tolerance',()=>{
 const block={id:'blk',type:'block',position:{x:100.3,y:0},entities:[{id:'inner',type:'line',points:[{x:0.06,y:0},{x:10.04,y:0}]}]};
 const outerOnly=correctionPatch(block,{tol:1,types:['block']});
 assert.deepEqual(outerOnly.position,{x:100,y:0});
 assert.equal(outerOnly.entities,undefined);
 const withInner=correctionPatch(block,{tol:1,types:['block'],blockInner:true,blockTol:0.1});
 assert.deepEqual(withInner.position,{x:100,y:0});
 assert.deepEqual(withInner.entities[0].points,[{x:0.1,y:0},{x:10,y:0}]);
});

/* ── PBD ── */
test('plotBoxLayerIds matches PLOT_BOX prefix case-insensitively; entitiesOnLayers filters by those ids',()=>{
 const layers=[{id:'l1',name:'PLOT_BOX'},{id:'l2',name:'plot_box_2'},{id:'l3',name:'A-WALL'}];
 assert.deepEqual(plotBoxLayerIds(layers),['l1','l2']);
 const entities=[{id:'e1',layer:'l1'},{id:'e2',layer:'l3'},{id:'e3',layer:'l2'}];
 assert.deepEqual(entitiesOnLayers(entities,plotBoxLayerIds(layers)),['e1','e3']);
});

/* ── SAB ── */
test('sabTranslateDelta moves the bounding box lower-left corner to the origin',()=>{
 const entities=[{type:'line',points:[{x:100,y:200},{x:300,y:250}]},{type:'circle',center:{x:150,y:300},radius:10}];
 const {dx,dy}=sabTranslateDelta(entities);
 assert.equal(dx,-100);assert.equal(dy,-200);
 const moved=entities.map(e=>G.translate(e,dx,dy));
 const b=G.bounds(moved);
 assert.equal(b.minX,0);assert.equal(b.minY,0);
});
test('toZeroLayerStandard forces layer 0 / ByLayer color+linetype on the entity and any nested entities',()=>{
 const block={id:'blk',type:'block',layer:'L1',color:'#ff0000',entities:[{id:'in',type:'line',layer:'L2',color:'#00ff00',points:[]}]};
 const out=toZeroLayerStandard(block,'zero');
 assert.equal(out.layer,'zero');assert.equal(out.color,null);assert.equal(out.linetype,null);
 assert.equal(out.entities[0].layer,'zero');assert.equal(out.entities[0].color,null);
 assert.equal(out.entities[0].id,'in','nested ids are preserved');
});

/* ── TBC ── */
test('nextBackgroundTheme toggles between dark and ivory',()=>{
 assert.equal(nextBackgroundTheme('dark'),'ivory');
 assert.equal(nextBackgroundTheme('ivory'),'dark');
 assert.equal(nextBackgroundTheme(undefined),'ivory');
});

/* ── EXP ── */
test('isAbsoluteWindowsPath accepts drive letters and UNC paths, rejects relative paths',()=>{
 assert.equal(isAbsoluteWindowsPath('D:\\프로젝트\\현장A'),true);
 assert.equal(isAbsoluteWindowsPath('D:/project'),true);
 assert.equal(isAbsoluteWindowsPath('\\\\server\\share'),true);
 assert.equal(isAbsoluteWindowsPath('relative\\path'),false);
 assert.equal(isAbsoluteWindowsPath(''),false);
});

test('EXP: 지금 도면 파일의 폴더를 기본값으로 채우고, 없는 폴더를 새로 만들지 않도록 mustExist 로 연다',async()=>{
 assert.equal(folderOfPath('D:\\현장A\\평면도.dxf'),'D:\\현장A');
 assert.equal(folderOfPath('D:\\평면도.dxf'),'D:\\');
 assert.equal(folderOfPath('\\\\server\\share\\a.dwg'),'\\\\server\\share');
 assert.equal(folderOfPath('평면도.dxf'),'');
 assert.equal(folderOfPath(''),'');
 const opened=[],toasts=[];let form=null;
 const saved=globalThis.window;
 globalThis.window={cadDesktop:{openFolder:async(folder,options)=>{opened.push({folder,options});}}};
 try{
  const ctx={toast:(m,e)=>toasts.push({m,e:!!e}),userErrorMessage:e=>e.message,drawingFilePath:()=>'D:\\현장A\\평면도.dxf',form:(title,fields,apply)=>{form={title,fields,apply};}};
  installOutputTools(ctx).EXP();
  assert.equal(form.fields[0].value,'D:\\현장A');
  await form.apply({folder:form.fields[0].value});
  assert.deepEqual(opened,[{folder:'D:\\현장A',options:{mustExist:true}}]);
  assert.match(toasts.at(-1).m,/탐색기로 열었습니다/);
  globalThis.window.cadDesktop.openFolder=async()=>{throw Error('폴더가 없습니다: D:\\오타');};
  await assert.rejects(form.apply({folder:'D:\\오타'}),/폴더를 열지 못했습니다/);
  const fresh={...ctx,drawingFilePath:()=>''};
  installOutputTools(fresh).EXP();
  assert.equal(form.fields[0].value,'');
  assert.match(form.title,/아직 파일로 열거나 저장하지 않았습니다/);
 }finally{globalThis.window=saved;}
});
// 2026-10-27 맥에서 써 보니 /Users/… 경로를 절대 경로가 아니라며 거절하고, 연 도면의 폴더도 채우지 못했다.
test('EXP: 맥 경로(/Users/…)도 받아 연 도면의 폴더를 채우고 연다',async()=>{
 assert.equal(folderOfPath('/Users/a/현장A/평면도.dxf'),'/Users/a/현장A');
 assert.equal(folderOfPath('/평면도.dxf'),'/');
 const opened=[];let form=null;
 const saved=globalThis.window;
 globalThis.window={cadDesktop:{openFolder:async(folder,options)=>{opened.push({folder,options});}}};
 try{
  const ctx={toast:()=>{},userErrorMessage:e=>e.message,drawingFilePath:()=>'/Users/a/현장A/평면도.dxf',form:(title,fields,apply)=>{form={title,fields,apply};}};
  installOutputTools(ctx).EXP();
  assert.equal(form.fields[0].value,'/Users/a/현장A');
  assert.doesNotMatch(form.title,/아직 파일로/);
  await form.apply({folder:'/Users/a/현장A'});
  assert.deepEqual(opened,[{folder:'/Users/a/현장A',options:{mustExist:true}}]);
  await assert.rejects(form.apply({folder:'현장A'}),/절대 경로/);
 }finally{globalThis.window=saved;}
});

/* ── QQ ── */
test('closableTabIds skips dirty tabs and honors scope',()=>{
 const tabs=[{id:'a',dirty:false},{id:'b',dirty:true},{id:'c',dirty:false}];
 assert.deepEqual(closableTabIds(tabs,'excludeCurrent','a'),['c']);
 assert.deepEqual(closableTabIds(tabs,'includeCurrent','a'),['a','c']);
 assert.deepEqual(closableTabIds(tabs,'onlyCurrent','a'),['a']);
 assert.deepEqual(closableTabIds(tabs,'onlyCurrent','b'),[],'dirty current tab is never included');
});
test('dirtySkippedCount counts only the dirty tabs that were actually in scope',()=>{
 const tabs=[{id:'a',dirty:false},{id:'b',dirty:true},{id:'c',dirty:false}];
 assert.equal(dirtySkippedCount(tabs,'excludeCurrent','a'),1);
 assert.equal(dirtySkippedCount(tabs,'onlyCurrent','a'),0);
 assert.equal(dirtySkippedCount(tabs,'onlyCurrent','b'),1);
 assert.deepEqual(tabsInScope(tabs,'includeCurrent','a'),tabs);
});

/* QQ 화면 흐름: app.js 처럼 [적용] 콜백이 끝난 뒤에야 설정 창(form-dialog)이 닫히고, 창이 열려 있거나 작업 중이면
   closeDrawingTab(tabSwitchAllowed)이 닫기를 거부한다. 실제로 닫힌 것만 성공으로 알려야 한다. */
function qqHarness({refuse=()=>false}={}){
 let tabs=[{id:'a',name:'A.dxf',dirty:false},{id:'b',name:'B.dxf',dirty:false},{id:'c',name:'C.dxf',dirty:false}];
 let formOpen=false,cancel=null;
 const toasts=[];
 const wrapperOf=t=>({querySelector:sel=>sel==='[data-drawing-id]'?{dataset:{drawingId:t.id}}:sel==='.drawing-tab-close'?{click:()=>{if(formOpen||refuse(t))return;tabs=tabs.filter(x=>x.id!==t.id);}}:null});
 const document={querySelectorAll:sel=>sel==='.drawing-tab'?tabs.map(wrapperOf):[],querySelector:sel=>sel==='dialog[open]'&&formOpen?{}:null};
 const window={cad:{drawings:{list:()=>tabs.map(t=>({...t})),active:()=>'a'}}};
 const ctx={toast:(text,isError=false)=>toasts.push({text,isError}),userErrorMessage:e=>e.message,
  form:(title,fields,onApply,onCancel)=>{formOpen=true;cancel=()=>{formOpen=false;onCancel?.();};
   ctx.submit=values=>{const result=onApply(values);return Promise.resolve(result).then(()=>{formOpen=false;});};}};
 return {ctx,toasts,document,window,tabs:()=>tabs,cancel:()=>cancel()};
}
async function withDom(h,fn){
 const saved={window:globalThis.window,document:globalThis.document};
 globalThis.window=h.window;globalThis.document=h.document;
 try{return await fn();}finally{globalThis.window=saved.window;globalThis.document=saved.document;}
}
async function waitFor(check,ms=2000){const end=Date.now()+ms;while(!check()&&Date.now()<end)await new Promise(r=>setTimeout(r,10));}
test('QQ closes the tabs after its form has closed and reports only tabs that really closed',async()=>{
 const h=qqHarness();
 await withDom(h,async()=>{
  const tools=installOutputTools(h.ctx);
  await tools.QQ();
  await h.ctx.submit({scope:'excludeCurrent'});
  await waitFor(()=>h.toasts.length);
  assert.deepEqual(h.tabs().map(t=>t.id),['a'],'b and c are really closed');
  assert.equal(h.toasts.at(-1).isError,false);
  assert.match(h.toasts.at(-1).text,/도면 2개를 닫았습니다/);
 });
});
test('QQ does not report success when the tabs refuse to close (busy / another dialog open)',async()=>{
 const h=qqHarness({refuse:t=>t.id==='c'});
 await withDom(h,async()=>{
  const tools=installOutputTools(h.ctx);
  await tools.QQ();
  await h.ctx.submit({scope:'excludeCurrent'});
  await waitFor(()=>h.toasts.length);
  assert.deepEqual(h.tabs().map(t=>t.id),['a','c']);
  const last=h.toasts.at(-1);
  assert.equal(last.isError,true,'a partial close is shown as an error');
  assert.doesNotMatch(last.text,/도면 2개를 닫았습니다/);
  assert.match(last.text,/2개 중 1개만 닫았습니다/);
  assert.match(last.text,/C\.dxf/);
 });
 const none=qqHarness({refuse:()=>true});
 await withDom(none,async()=>{
  const tools=installOutputTools(none.ctx);
  await tools.QQ();
  await none.ctx.submit({scope:'excludeCurrent'});
  await waitFor(()=>none.toasts.length);
  assert.equal(none.tabs().length,3);
  assert.equal(none.toasts.at(-1).isError,true);
  assert.match(none.toasts.at(-1).text,/닫지 못했습니다/);
 });
});
test('QQ cancel says nothing was closed',async()=>{
 const h=qqHarness();
 await withDom(h,async()=>{
  const tools=installOutputTools(h.ctx);
  await tools.QQ();
  h.cancel();
  assert.equal(h.tabs().length,3);
  assert.match(h.toasts.at(-1).text,/취소했습니다. 닫은 도면이 없습니다/);
 });
});
test('closeTabsVerified skips tabs that became unsaved instead of opening the save prompt',async()=>{
 let tabs=[{id:'a',dirty:false},{id:'b',dirty:true}];const pressed=[];
 const r=await closeTabsVerified(['a','b','gone'],{list:()=>tabs,clickClose:id=>{pressed.push(id);tabs=tabs.filter(t=>t.id!==id);return true;}});
 assert.deepEqual(pressed,['a']);
 assert.deepEqual(r,{closed:['a','gone'],failed:[],dirty:['b']});
});

/* ── xiBackup/xiRestore ── */
test('filterBackupEntries keeps only barun- prefixed keys',()=>{
 const entries=[['barun-door-cards','{}'],['other-setting','1'],['barun-rld-card','{}']];
 assert.deepEqual(filterBackupEntries(entries),[['barun-door-cards','{}'],['barun-rld-card','{}']]);
});
test('restoreEntries reads back only string barun- values from a backup payload',()=>{
 const payload={version:1,data:{'barun-door-cards':'{"a":1}','not-mine':'x','barun-bad':42}};
 assert.deepEqual(restoreEntries(payload),[['barun-door-cards','{"a":1}']]);
 assert.deepEqual(restoreEntries({}),[]);
 assert.deepEqual(restoreEntries(null),[]);
});

// 2026-10-27 맥판 시험: BRRESTORE 에서 도면(.dxf)을 잘못 고르면 '작업을 완료하지 못했습니다'라는 막연한 말만 나왔다.
test('parseSettingsFile: 설정 파일이 아니면 무엇을 골라야 하는지 알려 준다',()=>{
 assert.deepEqual(parseSettingsFile('{"app":"barun-cad","data":{}}'),{app:'barun-cad',data:{}});
 assert.throws(()=>parseSettingsFile('  0\nSECTION\n'),/BRBACKUP 으로 만든 설정 파일\(\.json\)/);
});

/* ── RLD ── */
test('stampDateText formats manual date fields and switches to "now" when auto is set',()=>{
 assert.equal(stampDateText({auto:false,year:2026,month:3,day:5,hour:9,minute:7}),'2026.03.05 09:07');
 const auto=stampDateText({auto:true});
 assert.match(auto,/^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}$/);
});
test('buildStamp draws a circle, 24 tick marks and the fixed text blocks, centered on the insert point',()=>{
 const v={auto:false,year:2026,month:1,day:1,hour:0,minute:0,purpose:'estimate',deptOn:true,dept:'설계팀',deptRatio:1,companyOn:true,company:'바른 CAD',companyRatio:1,radius:1000};
 const es=buildStamp(v,{x:500,y:500});
 const circle=es.find(e=>e.type==='circle');
 assert.deepEqual(circle.center,{x:500,y:500});assert.equal(circle.radius,1000);
 const ticks=es.filter(e=>e.type==='line'&&e!==es[24]);
 assert.equal(es.filter(e=>e.type==='line').length,24+1,'24 tick marks + 1 arrow shaft');
 const texts=es.filter(e=>e.type==='text');
 assert.equal(texts.length,5,'출도 + 일시 + 목적 + 부서 + 회사');
 assert.ok(texts.some(t=>t.text==='출도'));
 assert.ok(texts.some(t=>t.text==='2026.01.01 00:00'));
});
test('buildStamp omits department/company text when their checkboxes are off',()=>{
 const v={auto:true,purpose:'review',deptOn:false,companyOn:false,radius:800};
 const es=buildStamp(v,{x:0,y:0});
 assert.equal(es.filter(e=>e.type==='text').length,3,'출도 + 일시 + 목적만');
});

/* ── KCI/KCL ── */
test('fridgeSize looks up the 8-entry table and falls back to "none"',()=>{
 assert.equal(fridgeSize('f825').w,912);
 assert.equal(fridgeSize('nope').key,'none');
});
test('kitchenModules lays out sink only for a short run, and sink+counter+stove for a longer one',()=>{
 const short=kitchenModules(500,0);
 assert.deepEqual(short,[{type:'sink',s0:0,s1:500}]);
 const withStove=kitchenModules(1200,0);
 assert.deepEqual(withStove,[{type:'sink',s0:0,s1:600},{type:'stove',s0:600,s1:1200}]);
 const withCounter=kitchenModules(2000,0);
 assert.deepEqual(withCounter,[{type:'sink',s0:0,s1:600},{type:'counter',s0:600,s1:1400},{type:'stove',s0:1400,s1:2000}]);
});
test('kitchenModules places the fridge first and rejects a fridge wider than the run',()=>{
 const withFridge=kitchenModules(2000,860);
 assert.deepEqual(withFridge[0],{type:'fridge',s0:0,s1:860});
 assert.throws(()=>kitchenModules(500,860),/냉장고 폭/);
 assert.throws(()=>kitchenModules(0,0),/가구 길이/);
});
test('kitchenGeometry draws one rectangle per module and an extra corner square when corner=true',()=>{
 const f=G.dist!==undefined&&true; // sanity that geometry module loaded
 const wf={origin:{x:0,y:0},u:{x:1,y:0},n:{x:0,y:1},t:600,angle:0,flip:1};
 const straight=kitchenGeometry(wf,1200,600,'none','A-FURN',false);
 assert.equal(straight.entities.filter(e=>e.type==='polyline'&&e.points.length===4).length,3,'sink envelope + sink bowl-rect + stove envelope');
 const corner=kitchenGeometry(wf,1200,600,'none','A-FURN',true);
 assert.equal(corner.entities.filter(e=>e.type==='polyline'&&e.points.length===4).length,4,'+1 corner square');
});

/* ── MTB1/MTB2 ── */
test('stallCount floors to whole stalls and rejects a run shorter than one stall',()=>{
 assert.equal(stallCount(2700,900),3);
 assert.equal(stallCount(2650,900),2);
 assert.throws(()=>stallCount(500,900),/칸 폭/);
});
test('partitionPositions drops the matching end board(s) per mode',()=>{
 assert.deepEqual(partitionPositions(3,'none'),[1,2]);
 assert.deepEqual(partitionPositions(3,'noStart'),[1,2,3]);
 assert.deepEqual(partitionPositions(3,'noEnd'),[0,1,2]);
 assert.deepEqual(partitionPositions(3,'both'),[0,1,2,3]);
});
test('boothGeometry draws (n+1 minus skipped) partition boards plus one toilet per stall',()=>{
 const wf={origin:{x:0,y:0},u:{x:1,y:0},n:{x:0,y:1},t:1200,angle:0,flip:1};
 const v={stallWidth:900,depth:1200,thickness:30,endMode:'none',toiletType:'type1'};
 const shared={boothLayer:'A-WALL-PRTN',toiletLayer:'A-SANI'};
 const r=boothGeometry(wf,2700,v,shared);
 assert.equal(r.count,3);
 const boards=r.entities.filter(e=>e.cardLayer==='A-WALL-PRTN');
 assert.equal(boards.length,2,'3 stalls, both-ends-omitted leaves 2 interior boards');
 const toiletParts=r.entities.filter(e=>e.cardLayer==='A-SANI');
 assert.equal(toiletParts.length,3*2,'each type1 toilet draws a tank rect + bowl circle');
});

test('MSL은 다른 칸 목록을 포함하고 명시적 확인 뒤 옵션을 중계한다',async()=>{
 const saved=globalThis.window,calls=[],toasts=[];let form;
 globalThis.window={cadDesktop:{outputWindows:async()=>({self:1,windows:[{id:1,title:'가',drawings:[{name:'가'}]},{id:2,title:'나',drawings:[{name:'나'}]}]}),cleanOutputWindows:async(ids,opts)=>{calls.push({ids,opts});return {results:[{name:'나',counts:{removed:2,zeroed:0,moved:0,purged:0}}],failures:['가: 응답 없음']};}},cad:{drawings:{list:()=>[{id:'a',name:'가'}]}}};
 try{const tools=installOutputTools({scripted:true,form:(title,fields,apply)=>{form={title,fields,apply};},toast:(text,error)=>toasts.push({text,error})});await tools.MSL();
 assert.match(JSON.stringify(form.fields),/열린 도면 모두\(2장\)/);assert.match(JSON.stringify(form.fields),/다른 칸 도면 1장 포함/);
 const values={scope:'all',points:'yes',emptyText:'yes',purgeLayers:'yes'};
 assert.throws(()=>form.apply(values),/확인/);assert.equal(calls.length,0);await form.apply({...values,confirmAll:true});assert.deepEqual(calls[0].ids,[1,2]);assert.equal(calls[0].opts.points,true);assert.match(toasts.at(-1).text,/실패 1장/);assert.match(toasts.at(-1).text,/Ctrl\+Z/);
 }finally{globalThis.window=saved;}
});
test('QQ는 본체의 모든 칸을 범위대로 요청하고 닫힘·미저장 수를 알린다',async()=>{
 const saved=globalThis.window,calls=[],toasts=[];let apply;
 globalThis.window={cadDesktop:{outputWindows:async()=>({self:1,windows:[{id:1,title:'가',drawings:[{dirty:false}]},{id:2,title:'나',drawings:[{dirty:false}]},{id:3,title:'다',drawings:[{dirty:true}]}]}),closeOutputWindows:async ids=>{calls.push(ids);return {closed:[2,1],dirty:[3],failed:[]};}},cad:{drawings:{list:()=>[{id:'a'}]}}};
 try{await installOutputTools({scripted:true,form:(_t,_f,fn)=>apply=fn,toast:(text,error)=>toasts.push({text,error})}).QQ();await apply({scope:'includeCurrent'});assert.deepEqual(calls[0],[1,2,3]);assert.match(toasts[0].text,/2개를 닫았습니다/);assert.match(toasts[0].text,/저장하지 않은 도면 1개/);}finally{globalThis.window=saved;}
});

test('각 칸 MSL 정리는 삭제·켜 정리를 한 번 되돌리기로 원복하며 잠긴 객체를 보존한다',async()=>{
 const {DrawingEngine}=await import('./engine.js'),{handleOutputRequest}=await import('./output-tools.js'),engine=new DrawingEngine(),base=engine.doc.layers[0].id;
 engine.execute({type:'layer.add',name:'A-UNUSED',color:'#ffffff'});
 engine.execute({type:'add',entity:{type:'point',layer:base,position:{x:2,y:3}}});
 engine.execute({type:'layer.add',name:'A-KEEP',color:'#ffffff'});const kept=engine.doc.layers.find(l=>l.name==='A-KEEP').id;engine.execute({type:'add',entity:{type:'point',layer:kept,position:{x:4,y:5}}});engine.execute({type:'layer.update',id:kept,changes:{locked:true}});
 const before=JSON.stringify(engine.doc),undo=engine.undoStack.length;
 const ctx={entities:()=>engine.doc.entities,layers:()=>engine.doc.layers,blocks:()=>engine.doc.blocks,activeLayer:()=>base,execute:c=>engine.execute(c),refresh(){},userErrorMessage:e=>e.message,
 outputState:()=>({busy:false,drawings:[{id:'a',name:'평면',dirty:true}]}),outputActive:()=>'a',outputSelect(){},outputBatch:fn=>{engine.beginTransaction();try{const r=fn();engine.endTransaction();return r;}catch(e){engine.rollbackTransaction();throw e;}}};
 const result=handleOutputRequest(ctx,{operation:'clean',options:{points:true,purgeLayers:true},expiresAt:Date.now()+1000});
 assert.equal(result.results[0].counts.removed,1);assert.equal(result.results[0].counts.purged,1);assert.equal(engine.undoStack.length,undo+1);
 engine.execute({type:'undo'});assert.equal(JSON.stringify(engine.doc),before);
 assert.throws(()=>handleOutputRequest(ctx,{operation:'clean',expiresAt:Date.now()-1}),/시간/);
 ctx.outputState=()=>({busy:true,drawings:[{id:'a',dirty:false}]});assert.throws(()=>handleOutputRequest(ctx,{operation:'clean',expiresAt:Date.now()+1000}),/작업/);
 assert.equal(handleOutputRequest(ctx,{operation:'can-close',expiresAt:Date.now()+1000}).safe,false);
});
test('MCP 전체 실행은 실제 화면 승인을 기다리고 QQ 자기 칸 닫기는 결과 전달 뒤 재요청한다',async()=>{
 const {runOutputCommand}=await import('./output-tools.js'),saved=globalThis.window,calls=[],after=[];
 globalThis.window={cad:{drawings:{list:()=>[]}},cadDesktop:{outputWindows:async()=>({self:1,windows:[{id:1,title:'가',drawings:[{}]},{id:2,title:'나',drawings:[{}]}]}),cleanOutputWindows:async()=>{calls.push('clean');return {results:[],failures:[]};},closeOutputWindows:async(ids,defer)=>{calls.push([ids,defer]);return {closed:defer?[2]:[1],dirty:[],failed:[],deferred:defer?[1]:[]};}}};
 const ctx={toast(){},userErrorMessage:e=>e.message,deferOutputClose:fn=>after.push(fn)};
 try{await assert.rejects(runOutputCommand(ctx,'MSL',{form:{scope:'all'}}),/확인/);assert.equal(calls.length,0);
 let form;ctx.form=(_title,fields,apply)=>{form={fields,apply};};
 const msl=runOutputCommand(ctx,'MSL',{form:{scope:'all',confirmAll:true}});await new Promise(r=>setTimeout(r,0));assert.equal(calls.length,0);assert.equal(form.fields.find(f=>f.name==='confirmAll').value,false);form.apply({scope:'all',confirmAll:true});await msl;assert.equal(calls[0],'clean');
 const qq=runOutputCommand(ctx,'QQ',{form:{scope:'includeCurrent'}});await new Promise(r=>setTimeout(r,0));form.apply({scope:'includeCurrent'});await qq;assert.deepEqual(calls[1],[[1,2],true]);assert.equal(after.length,1);await after[0]();assert.deepEqual(calls[2],[[1],false]);
 }finally{globalThis.window=saved;}
});

test('QQ 저장 확인과 닫기 사이에는 실행을 예약하고 해제·만료 뒤 편집을 다시 허용한다',async()=>{
 const {handleOutputRequest,createOutputCloseReservation}=await import('./output-tools.js');let edits=0,held=false,timer;const engine={execute(){edits++;}};
 const reservation=createOutputCloseReservation({engine,hold:()=>held=true,release:()=>held=false,schedule:fn=>(timer=fn),unschedule(){}});
 const ctx={outputState:()=>({busy:false,drawings:[{dirty:false}]}),outputReserve:request=>reservation.acquire(request)};
 const result=handleOutputRequest(ctx,{id:9,operation:'can-close',options:{reserve:true},expiresAt:Date.now()+1000});assert.equal(result.safe,true);assert.equal(result.lease,9);assert.equal(held,true);assert.throws(()=>engine.execute({type:'add'}),/닫기/);assert.equal(edits,0);
 reservation.release(8);assert.equal(held,true);reservation.release(9);engine.execute({});assert.equal(edits,1);assert.equal(held,false);
 reservation.acquire({id:10,expiresAt:Date.now()+1000});timer();engine.execute({});assert.equal(edits,2);assert.equal(held,false);
});

// 2026-10-27 설명서 시험에서 찾은 것
test('MTB 변기: 양식2(수조 없음)는 수조 사각형을 그리지 않는다 — 양식1 만 수조, 양식3 은 벽부 플레이트',()=>{
 const wf={origin:{x:0,y:0},u:{x:1,y:0},n:{x:0,y:1},t:1500,angle:0,flip:1},v={stallWidth:1000,depth:1500,thickness:30,endMode:'both'},shared={boothLayer:'A-WALL-PRTN',toiletLayer:'A-SANI'};
 const rects=type=>boothGeometry(wf,1000,{...v,toiletType:type},shared).entities.filter(e=>(e.cardLayer||e.layer)==='A-SANI'&&e.type!=='circle').length;
 assert.equal(rects('type1'),1,'양식1 수조');
 assert.equal(rects('type2'),0,'양식2 수조 없음');
 assert.equal(rects('type3'),1,'양식3 벽부 플레이트');
});
test('KCI 냉장고 칸은 가구 깊이가 아니라 냉장고 실제 깊이로 그린다(590L = D730)',()=>{
 const wf={origin:{x:0,y:0},u:{x:1,y:0},n:{x:0,y:1},t:1500,angle:0,flip:1};
 const r=kitchenGeometry(wf,3000,600,'f590','A-KTCH',false),m=r.modules.find(x=>x.type==='fridge');
 const ys=r.entities.filter(e=>e.type!=='circle').flatMap(e=>(e.points||[])).filter(p=>p.x>=m.s0-1&&p.x<=m.s1+1).map(p=>Math.abs(p.y));
 assert.ok(Math.max(...ys)>=729,`냉장고 깊이 ${Math.max(...ys)}`);
});
test('KCL ㄴ자: 꺾인 쪽 길이만큼 두 번째 다리를 그린다(시작점 쪽, 안쪽 방향) · 0 이면 예전처럼 코너 사각형만',()=>{
 const wf={origin:{x:0,y:0},u:{x:1,y:0},n:{x:0,y:1},t:600,angle:0,flip:1};
 const ys=r=>r.entities.flatMap(e=>e.points||[]).filter(p=>p.x<=1e-6).map(p=>p.y);
 const leg=kitchenGeometry(wf,3000,600,'none','A-KTCH',1800);
 assert.equal(Math.max(...ys(leg)),1800,'두 번째 다리 끝 = 1800');
 assert.ok(leg.entities.flatMap(e=>e.points||[]).some(p=>Math.abs(p.x+600)<1e-6),'다리 폭 = 가구 깊이');
 const old=kitchenGeometry(wf,3000,600,'none','A-KTCH',true);
 assert.equal(Math.max(...ys(old)),600,'true 는 예전처럼 깊이만큼의 코너');
});
