// F1 명령 검색: 이름을 몰라도 하고 싶은 일을 쓰면 찾는다(뜻이 비슷한 말·조사·초성·오타).
import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMANDS,koreanNamesFor} from './commands.js';
import {rankCommandSearch,queryWords} from './command-search.js';

// 라벨·이름·한글 이름만으로 찾는다(앱의 의도 별칭 없이도 되어야 함).
const terms=c=>[c.name,c.label,...koreanNamesFor(c.name)].filter(Boolean).join(' ');
const names=q=>rankCommandSearch(COMMANDS,q,{terms}).map(item=>item.command.name);

test('조사·어미를 떼고 "만"을 따로 본다',()=>{
  assert.deepEqual(queryWords('객체만 켜기'),['만','객체','켜']);
  assert.deepEqual(queryWords('선을 숨기기'),['선','숨기']);
});

test('"객체만 켜기" → 선택 객체만 보이기(ISOLATEOBJECTS)가 위 2개 안(라벨이 글자 그대로인 "선택 색 객체만 켜기" 다음), 비슷한 일이 뒤따른다',()=>{
  const found=names('객체만 켜기');
  assert.ok(found.slice(0,2).includes('ISOLATEOBJECTS'),found.slice(0,6).join(','));
  for(const related of ['LAYISO','SHOWALL'])assert.ok(found.slice(0,15).includes(related),related+' in '+found.slice(0,15).join(','));
});

test('비슷한 말·초성·오타로도 찾고, 맞는 것이 있으면 빈 목록이 아니다',()=>{
  assert.ok(names('객체 감추기').slice(0,3).includes('HIDE'));
  assert.equal(names('모두 보이기')[0],'SHOWALL');
  assert.ok(names('ㄱㅊㅅㄱㄱ').includes('HIDE'),'초성');
  assert.ok(names('MOVVE').includes('MOVE'),'영문 한 글자 오타');
  assert.ok(names('선 지우기').includes('ERASE'),'선은 없어도 지우기=삭제(ERASE)는 나온다');
});

test('이름·별칭을 정확히 친 검색은 예전 순위 그대로(새 순위는 그보다 뒤)',()=>{
  for(const [q,name] of [['COPY','COPY'],['LINE','LINE'],['HIDE','HIDE'],['객체 숨기기','HIDE']])assert.equal(names(q)[0],name,q);
  const scores=rankCommandSearch(COMMANDS,'객체만 켜기',{terms}).map(item=>item.score);
  assert.ok(scores.every(score=>score>=4),'느슨한 맞춤은 4 이하 순위를 차지하지 않는다');
});

test('키 입력마다 돌아도 빠르다(한 번에 화면 한 프레임 16ms 안)',()=>{
  const start=performance.now();for(let i=0;i<200;i++)rankCommandSearch(COMMANDS,'객체만 켜기',{terms});
  assert.ok((performance.now()-start)/200<16,String((performance.now()-start)/200));
});

test('선택 객체만 보이기의 숨기기 단계: 큰 도면에서도 고른 것만 남는다(엔진 visibility 가 Set 으로)',async()=>{
  const {DrawingEngine}=await import('./engine.js');
  const engine=new DrawingEngine(),n=60000;
  const ids=engine.execute({type:'addMany',entities:Array.from({length:n},(_,i)=>({type:'line',layer:'default',points:[{x:i,y:0},{x:i+1,y:1}]}))})||engine.doc.entities.map(e=>e.id);
  const keep=new Set([engine.doc.entities[7].id]),hide=engine.doc.entities.filter(e=>!keep.has(e.id)).map(e=>e.id);
  const start=performance.now();engine.execute({type:'visibility',ids:hide,hidden:true});
  assert.ok(performance.now()-start<1000,'6만 개 숨기기 '+Math.round(performance.now()-start)+'ms');
  assert.deepEqual(engine.doc.entities.filter(e=>!e.hidden).map(e=>e.id),[...keep]);
  assert.ok(ids);
});
