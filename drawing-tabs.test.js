import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingTabs,startsFresh} from './drawing-tabs.js';
import {DrawingEngine,blankDocument} from './engine.js';
function setup(){const engine=new DrawingEngine();let name='첫 도면',dirty=false,view={scale:1},project={folder:'A'};const tabs=new DrawingTabs({capture:()=>({name,doc:engine.doc,undoStack:engine.undoStack,redoStack:engine.redoStack,dirty,view,project}),apply:t=>{engine.doc=t.doc;engine.undoStack=t.undoStack;engine.redoStack=t.redoStack;name=t.name;dirty=t.dirty;view=t.view;project=t.project;}});engine.onChange(()=>dirty=true);return {tabs,engine,view:value=>view=value,current:()=>({name,dirty,view,project}),open:name=>tabs.open({name,doc:blankDocument(),undoStack:[],redoStack:[],dirty:false,view:{scale:1},project:{folder:name}})};}
test('ten drawings keep independent geometry, undo/redo, view and project folder',()=>{
 const s=setup(),ids=[];
 for(let i=0;i<10;i++){ids.push(s.open('도면 '+i).id);s.engine.execute({type:'add',entity:{type:'line',layer:'default',points:[{x:i,y:0},{x:i+1,y:0}]}});s.view({scale:i+1});}
 assert.throws(()=>s.open('11번째'),/10/);assert.equal(s.tabs.tabs.length,10);
 for(let i=0;i<10;i++){s.tabs.select(ids[i]);assert.equal(s.engine.doc.entities[0].points[0].x,i);assert.equal(s.current().view.scale,i+1);assert.equal(s.current().project.folder,'도면 '+i);assert.equal(s.engine.undoStack.length,1);}
 s.tabs.select(ids[3]);s.engine.execute({type:'undo'});assert.equal(s.engine.doc.entities.length,0);
 s.tabs.select(ids[7]);assert.equal(s.engine.doc.entities.length,1);s.tabs.select(ids[3]);s.engine.execute({type:'redo'});assert.equal(s.engine.doc.entities[0].points[0].x,3);
});
test('recovery retains dirty drawings and active identity without conflating undo sessions',()=>{
 const s=setup();const a=s.open('A'),b=s.open('B');s.engine.execute({type:'add',entity:{type:'circle',layer:'default',center:{x:1,y:2},radius:10}});s.tabs.select(a.id);const saved=structuredClone(s.tabs.snapshot());
 const other=setup();other.tabs.restore(saved,d=>other.engine.validate(d));assert.equal(other.tabs.activeId,a.id);other.tabs.select(b.id);assert.equal(other.current().dirty,true);assert.equal(other.engine.doc.entities.length,1);assert.equal(other.engine.undoStack.length,1);other.engine.execute({type:'undo'});assert.equal(other.engine.doc.entities.length,0);other.engine.execute({type:'redo'});assert.equal(other.engine.doc.entities.length,1);
 const before=other.tabs.snapshot();assert.throws(()=>other.tabs.restore({...saved,tabs:[saved.tabs[0],saved.tabs[0]]},()=>{}));const after=other.tabs.snapshot();assert.ok(after.savedAt>=before.savedAt);assert.deepEqual({...after,savedAt:before.savedAt},before);
});
test('closing an inactive tab leaves the current document and its undo intact',()=>{
 const s=setup(),a=s.open('A'),b=s.open('B');s.engine.execute({type:'add',entity:{type:'circle',layer:'default',center:{x:0,y:0},radius:5}});s.tabs.remove(a.id);assert.equal(s.tabs.activeId,b.id);assert.equal(s.engine.doc.entities.length,1);assert.equal(s.engine.undoStack.length,1);
});

test('앱을 새로 열면 종료 방식과 관계없이 빈 도면으로 시작한다',()=>{
 assert.equal(startsFresh({freshLaunch:true,closedCleanly:true}),true);      // 정상 종료 뒤 새로 켬 → 새 도면
 assert.equal(startsFresh({freshLaunch:true,closedCleanly:false}),true);     // 업데이트·강제 종료 뒤 새로 켬 → 새 도면
 assert.equal(startsFresh({freshLaunch:false,closedCleanly:true}),false);    // 새로고침 → 늘 되살림
 assert.equal(startsFresh({freshLaunch:false,closedCleanly:false}),false);
});

import {restorableDrawingWorkspace} from './drawing-tabs.js';
test('칸 복원은 빈 새 도면을 빼고 파일·미저장 탭만 유지한다',()=>{
 const blank={id:'blank',name:'새 도면 1',doc:blankDocument(),dirty:false};
 const file={id:'file',name:'평면도',filePath:'C:/drawings/plan.dxf',doc:blankDocument(),dirty:false};
 const dirty={id:'dirty',name:'새 도면 2',doc:blankDocument(),dirty:true};
 assert.equal(restorableDrawingWorkspace({version:1,tabs:[blank]}),null);
 const saved={version:1,activeId:'blank',tabs:[blank,file,dirty]};
 const restored=restorableDrawingWorkspace(saved);
 assert.deepEqual(restored.tabs,[file,dirty]);assert.equal(restored.activeId,'file');
 assert.equal(restored.tabs[0].doc,file.doc,'복원 판단은 도면 객체를 복사하지 않는다');
 assert.equal(saved.tabs.length,3);
 assert.equal(restorableDrawingWorkspace({...saved,activeId:'dirty'}).activeId,'dirty');
});

import {isEmptyDrawingTab,drawingPathKey} from './drawing-tabs.js';
test('빈 새 도면은 객체·dirty·파일·undo/redo를 모두 검사하고 이름 접두사만으로 지우지 않는다',()=>{
 const tab={name:'새 도면1',doc:blankDocument(),dirty:false,undoStack:[],redoStack:[]};assert.equal(isEmptyDrawingTab(tab),true);assert.equal(isEmptyDrawingTab({...tab,name:'새 도면 2'}),true);
 for(const changes of [{filePath:'C:/empty.dxf'},{dirty:true},{doc:{entities:[{}]}},{undoStack:[{}]},{redoStack:[{}]},{name:'새 도면 참고자료'},{doc:null}])assert.equal(isEmptyDrawingTab({...tab,...changes}),false);
 assert.equal(drawingPathKey('C:\\Plan.DXF'),drawingPathKey('c:/plan.dxf'));
});
