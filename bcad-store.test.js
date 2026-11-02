import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeFull,saveBcad,decodeBcad,openBcad,chooseSave,createFreeSpace,fileBytes} from './bcad-store.js';

const line=(i,layer='0')=>({id:'e'+i,type:'line',layer,points:[{x:i,y:0},{x:i+1,y:1}]});
const drawing=n=>({version:2,units:'mm',layers:[{id:'0',name:'0'}],entities:Array.from({length:n},(_,i)=>line(i))});

test('215 · 전체 저장 → 다시 읽기는 같은 문서',()=>{
  const doc=drawing(3000),file=encodeFull(doc);
  assert.ok(file.index.chunks.length>1,'64KB 안팎 덩어리로 나뉜다');
  assert.deepEqual(decodeBcad(fileBytes(file)).doc,doc);
});

test('215 · 증분 저장은 바뀐 객체가 든 덩어리 + 위치표만 쓴다',()=>{
  const doc=drawing(5000),file=encodeFull(doc),full=file.bytesLength;
  const next={...doc,entities:doc.entities.map(e=>e.id==='e10'?{...e,layer:'X'}:e)};
  const {file:after,mode}=saveBcad(file,next,{changedIds:['e10']});
  assert.equal(mode,'incremental');
  assert.ok(after.written<full/4,`쓴 양 ${after.written} < 전체 ${full}/4`);
  assert.deepEqual(decodeBcad(fileBytes(after)).doc,next);
});

test('215 · 지우기·새 객체·머리글 바꾸기도 증분으로, 순서가 바뀌면 전체로',()=>{
  let doc=drawing(2000),file=encodeFull(doc);
  doc={...doc,layers:[...doc.layers,{id:'1',name:'새'}],entities:[...doc.entities.filter(e=>e.id!=='e5'),line(9001,'1')]};
  let r=saveBcad(file,doc,{changedIds:['e9001'],removedIds:['e5'],headerChanged:true});
  assert.equal(r.mode,'incremental');assert.deepEqual(decodeBcad(fileBytes(r.file)).doc,doc);
  const reordered={...doc,entities:[doc.entities.at(-1),...doc.entities.slice(0,-1)]};
  r=saveBcad(r.file,reordered,{changedIds:[]});
  assert.equal(r.mode,'full','덩어리로 나타낼 수 없는 순서 변경은 전체 저장');
  assert.deepEqual(decodeBcad(fileBytes(r.file)).doc,reordered);
});

test('215 · 낭비가 ISAVEPERCENT(50%)를 넘거나 디스크 파일이 바뀌면 전체 저장',()=>{
  let doc=drawing(4000),file=encodeFull(doc);const fullSize=file.bytesLength;
  assert.equal(chooseSave(null),'full');
  assert.equal(chooseSave(file,{disk:{size:1,mtime:2}}),'full','다른 프로그램이 파일을 고침');
  assert.equal(chooseSave(file,{isavePercent:0}),'full','0 이면 증분 끔');
  let modes=[];
  for(let round=0;round<12;round++){
    doc={...doc,entities:doc.entities.map(e=>({...e,layer:'L'+round}))};
    const r=saveBcad(file,doc,{changedIds:doc.entities.map(e=>e.id)});modes.push(r.mode);file=r.file;
    assert.ok(file.bytesLength<=fullSize*3.2,'낭비가 쌓여도 파일은 전체의 약 3배를 넘지 않는다(50%를 넘으면 전체 저장)');
  }
  assert.ok(modes.includes('full')&&modes.includes('incremental'),modes.join(','));
  assert.deepEqual(decodeBcad(fileBytes(file)).doc,doc);
});

test('215 · 덩어리 지문이 틀리면 그 덩어리만 잃고 나머지를 연다',()=>{
  const doc=drawing(3000),file=encodeFull(doc),bytes=new Uint8Array(fileBytes(file));
  const victim=file.index.chunks[1];bytes[victim.at+5]^=0xff;
  const {doc:opened,damaged}=decodeBcad(bytes);
  assert.equal(damaged.length,1);assert.equal(opened.entities.length,3000-victim.count);
  assert.equal(openBcad(bytes).file,null,'손상 파일의 다음 저장은 전체 저장');
});

test('215 · 다시 연 파일로 증분 저장을 이어 간다',()=>{
  const doc=drawing(3000),saved=fileBytes(encodeFull(doc));
  const {doc:opened,file}=openBcad(saved,{disk:{size:saved.length,mtime:1}});
  assert.deepEqual(opened,doc);
  const next={...opened,entities:opened.entities.map(e=>e.id==='e7'?{...e,layer:'Y'}:e)};
  const r=saveBcad(file,next,{changedIds:['e7']},{disk:{size:saved.length,mtime:1}});
  assert.equal(r.mode,'incremental');assert.deepEqual(decodeBcad(fileBytes(r.file)).doc,next);
});

test('216 · 빈 공간: 512B 미만은 세기만, 4KB 이상만 재사용, 가장 맞는 구멍부터, 남는 꼬리는 다시 구멍',()=>{
  const s=createFreeSpace({end:100000});
  s.free({at:0,size:300});assert.equal(s.freeBytes,300);
  assert.deepEqual(s.find(200),{at:100000,size:200,reused:false},'작은 구멍은 재사용하지 않는다');
  s.free({at:1000,size:9000});s.free({at:20000,size:5000});
  const hit=s.find(4500);assert.deepEqual(hit,{at:20000,size:4500,reused:true},'가장 맞는 구멍');
  assert.equal(s.freeBytes,300+9000+500,'꼬리 500B 는 낭비로 셈');
  assert.equal(s.find(3000).reused,false,'4KB 미만은 파일 끝');
  const small=createFreeSpace({reuseSmall:true});small.free({at:0,size:1000});assert.equal(small.find(600).reused,true,'작은 구멍 재사용 설정');
});
