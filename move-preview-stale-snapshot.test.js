import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as G from './geometry.js';

// MOVE/COPY 미리보기: 큰 대상(공유 블록·자식 800개 넘는 블록·300개 넘는 선택)은 한 번 뜬 그림(translateSnapshot)을
// 옮겨 그린다. 그 그림의 대상 목록이 다음 MOVE 까지 남아 있으면, 작은 객체 하나를 옮길 때도 예전에 옮긴 큰 대상
// (건물 한 줄·도면 묶음)이 커서를 따라 함께 그려져 "도면 전체가 움직이는 것처럼" 보였다(6.0.9~6.0.15).
const source=fs.readFileSync('app.js','utf8');
function harness(){
 const draft=source.slice(source.indexOf('function draft() {'),source.indexOf('function showSelectionCount(){'));
 const snapshot=source.slice(source.indexOf('let translateSnapshot=null;'),source.indexOf('function gripDragPreview(command){'));
 assert.ok(draft.length>100&&snapshot.length>100,'app.js 구간을 찾지 못했습니다');
 const c={G,mode:'MOVE',phase:'point',params:{},drag:null,points:[],cursor:null,chosenList:[]};
 c.chosen=()=>c.chosenList;
 vm.createContext(c);
 vm.runInContext(draft+'\n'+snapshot+'\nglobalThis.previewState=()=>translatePreviewState();',c);
 return c;
}
const shared=id=>({id,type:'block',name:'BLD',sharedBlock:'BLD',position:{x:0,y:0},entities:[]});
const line=id=>({id,type:'line',points:[{x:0,y:0},{x:10,y:0}]});

test('큰 대상을 옮긴 뒤 작은 객체를 MOVE 하면 예전 대상 그림이 미리보기에 끼지 않는다',()=>{
 const c=harness();
 // 1) 공유 블록(건물) MOVE: 그림 미리보기로 간다
 c.chosenList=[shared('big')];c.points=[{x:0,y:0}];c.cursor={x:50,y:0};
 assert.equal(c.draft().length,0);
 assert.deepEqual([...c.previewState().ids],['big']);
 // 2) 명령이 끝나고 선 하나를 새로 골라 MOVE
 c.chosenList=[line('small')];c.points=[{x:0,y:0}];c.cursor={x:30,y:5};
 const drafts=c.draft();
 assert.equal(drafts.length,1);
 assert.equal(drafts[0].source.id,'small');
 assert.equal(c.previewState(),null,'작은 객체 MOVE 에서 예전 큰 대상 그림이 함께 따라온다');
});

test('COPY 로 큰 대상을 복사한 뒤에도 작은 객체 COPY 미리보기는 그 객체만 그린다',()=>{
 const c=harness();
 c.mode='COPY';c.chosenList=[shared('big')];c.points=[{x:0,y:0}];c.cursor={x:50,y:0};
 c.draft();assert.deepEqual([...c.previewState().ids],['big']);
 c.chosenList=[line('small')];c.cursor={x:20,y:0};c.draft();
 assert.equal(c.previewState(),null);
});

test('큰 대상끼리는 지금 고른 대상의 그림만 쓴다',()=>{
 const c=harness();
 c.chosenList=[shared('a')];c.points=[{x:0,y:0}];c.cursor={x:50,y:0};c.draft();
 c.chosenList=[shared('b')];c.draft();
 assert.deepEqual([...c.previewState().ids],['b']);
});
