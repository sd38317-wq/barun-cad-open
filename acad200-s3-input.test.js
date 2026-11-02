// ACAD200 영역 3 — 입력: 301 클릭·끌기 판정, 318 입력점 파이프라인, 319 입력 줄, 320 오른쪽 단추, 317 상대 좌표, 입력 설정.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PressClassifier,PRESS_PROFILES,InputPointManager,InputQueue,classifyRightClick,promptOptions} from './input-manager.js';
import {parsePoint} from './commands.js';
import {normalizeInputPrefs,loadInputPrefs,saveInputPrefs,INPUT_PREF_DEFAULTS,INPUT_PREFS_KEY,renderInputPrefControls,INPUT_PREF_FIELDS} from './input-prefs.js';

const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const press=(type='mouse')=>new PressClassifier(PRESS_PROFILES[type]).begin(0,{x:0,y:0});

test('301 손떨림(0.7px)은 언제 떼도 클릭 — 그립이 늘어나지 않는다',()=>{
  for(const t of [10,150,260,900])assert.equal(press().isClick(t,{x:.7,y:0}),true,`t=${t}`);
});
test('301 짧게 누른 동안은 크게 움직여야 끌기, 그 뒤는 떨림 문턱만 넘으면 끌기',()=>{
  assert.equal(press().isClick(120,{x:10,y:0}),true,'0.12초·10px = 빠른 탁 클릭');
  assert.equal(press().isClick(120,{x:16,y:0}),false,'0.12초·16px = 끌기');
  assert.equal(press().isClick(260,{x:10,y:0}),false,'0.26초·10px = 끌기(AutoCAD 는 여기서 클릭으로 잃는다)');
  assert.equal(press().isClick(600,{x:3,y:0}),false,'오래 누르고 3px');
});
test('301 한 번 끌기가 되면 제자리로 돌아와도 끌기, 손가락은 문턱이 크다',()=>{
  const c=press();assert.equal(c.update(300,{x:5,y:0}),true);assert.equal(c.isClick(310,{x:0,y:0}),false);
  assert.equal(press('touch').isClick(300,{x:5,y:0}),true,'손가락 5px 은 클릭');
  assert.equal(press('touch').isClick(100,{x:20,y:0}),true,'손가락 빠른 20px 은 탭');
  const fromEvent=PressClassifier.forEvent({pointerType:'pen',timeStamp:1000},{x:0,y:0});assert.equal(fromEvent.jitter,4);assert.equal(fromEvent.isClick(1100,{x:3,y:0}),true);
});
test('301 app.js: 세 끌기 종류가 같은 판정기를 쓰고, 설정을 끄면 예전 거리 문턱',()=>{
  assert.match(app,/drag\.press\?drag\.press\.update\(e\.timeStamp,p\):G\.dist\(p,drag\.start\)/);
  assert.match(app,/pending\.press\?!pending\.press\.isClick\(e\.timeStamp,localPoint\(e\)\)/);
  assert.match(app,/const pressClick=drag\.press&&!drag\.secondCorner\?drag\.press\.isClick\(e\.timeStamp,b\):null;/);
  assert.match(app,/if\(typeof assist==='undefined'\|\|!assist\.prefs\.pressClassifier/);
});

test('318 필터는 하나, 모니터는 여럿(툴팁만), 등록이 없으면 그대로',()=>{
  const m=new InputPointManager();assert.equal(m.active,false);
  const f=ip=>({point:{x:ip.raw.x,y:0},tooltip:'벽 중심선'});m.registerFilter(f);
  assert.throws(()=>m.registerFilter(()=>null),/하나만/);
  const off=m.addMonitor({monitor:ip=>`길이 ${ip.computed.x}`,excludeEntities:()=>['a']});
  const ip=m.compute({x:5,y:7},{x:5,y:7,snapped:false});
  assert.deepEqual([ip.computed.x,ip.computed.y],[5,0]);assert.equal(ip.computed.tooltip,'벽 중심선 · 길이 5');
  assert.deepEqual([...m.excludedIds()],['a']);
  off();m.revokeFilter(f);assert.equal(m.active,false);
  const crashing=new InputPointManager();crashing.registerFilter(()=>{throw Error('x');});
  assert.deepEqual(crashing.compute({x:1,y:2},{x:1,y:2}).computed,{x:1,y:2},'필터 오류가 점을 잃게 하지 않는다');
});

test('319 바쁜 동안 클릭·Enter 를 줄 세우고, 이동은 버리고, Esc 는 비운다',()=>{
  let now=0;const q=new InputQueue({limit:3,maxAgeMs:3000,clock:()=>now});
  assert.equal(q.push({type:'pointermove'}),false);
  for(const n of [1,2,3,4])q.push({type:'click',n});
  assert.deepEqual(q.items.map(i=>i.n),[2,3,4],'한도를 넘으면 가장 오래된 것부터');
  q.push({type:'keydown',key:'Escape'});assert.equal(q.size,0);
});
test('319 다시 바빠지면 남은 입력을 되돌려 다음에 잇고, 오래된·다른 탭 입력은 버린다',()=>{
  let now=0;const q=new InputQueue({clock:()=>now});
  for(const n of [1,2,3])q.push({type:'click',n,tab:'A'});q.push({type:'click',n:9,tab:'B'});
  const seen=[];q.drain(item=>{seen.push(item.n);return item.n!==2;},{isCurrent:item=>item.tab==='A'});
  assert.deepEqual(seen,[1,2]);assert.deepEqual(q.items.map(i=>i.n),[3,9]);
  now=5000;assert.equal(q.drain(()=>true),0,'3초 넘은 입력은 버림');
  const timers=[];let busy=true;const q2=new InputQueue({clock:()=>0});q2.push({type:'click',n:1});
  const done=[];q2.whenIdle(()=>busy,item=>done.push(item.n),{},{setTimer:fn=>{timers.push(fn);return timers.length;}});
  timers.shift()();assert.deepEqual(done,[],'아직 바쁨');busy=false;timers.shift()();assert.deepEqual(done,[1]);assert.equal(timers.length,0);
});
test('319 app.js: busy 누르기는 버리지 않고 줄에, 끝나면 같은 처리기로 다시 보낸다',()=>{
  assert.match(app,/if \(busy\)\{reason='busy';if\(typeof queueBusyInput==='function'&&queueBusyInput\(e,w\)\)reason='queued';return;\}/);
  assert.match(app,/canvas\.dispatchEvent\(new PointerEvent\('pointerdown'/);
  assert.match(app,/if \(busy\) \{if\(typeof queueBusySubmit==='function'\)queueBusySubmit/);
});

test('320 오른쪽 단추: 짧게 Enter, 길게 메뉴, 0 이면 늘 Enter',()=>{
  assert.equal(classifyRightClick(120,300),'enter');assert.equal(classifyRightClick(450,300),'menu');
  assert.equal(classifyRightClick(9999,0),'enter');assert.equal(classifyRightClick(NaN,300),'enter');
  assert.deepEqual(promptOptions('점 지정 또는 [기준점(B)/복사(C)/명령 취소(U)/종료(X)] · [복사(C)/회전(R)]'),
    [{label:'기준점',key:'B'},{label:'복사',key:'C'},{label:'명령 취소',key:'U'},{label:'종료',key:'X'},{label:'회전',key:'R'}]);
  assert.deepEqual(promptOptions('객체 선택'),[]);
});

test('317 동적 입력: 두 번째 점부터 접두사 없는 좌표는 상대, #은 절대, @는 늘 상대',()=>{
  const base={x:100,y:100};
  assert.deepEqual(parsePoint('50,20',base,{relativeDefault:true}),{x:150,y:120});
  assert.deepEqual(parsePoint('#50,20',base,{relativeDefault:true}),{x:50,y:20});
  assert.deepEqual(parsePoint('*50,20',base,{relativeDefault:true}),{x:50,y:20});
  assert.deepEqual(parsePoint('50,20',base),{x:50,y:20},'설정이 없으면 예전처럼 절대');
  assert.deepEqual(parsePoint('@50,20',base),{x:150,y:120});
  const polar=parsePoint('100<90',base,{relativeDefault:true});assert.ok(Math.abs(polar.x-100)<1e-9&&Math.abs(polar.y-200)<1e-9);
  assert.deepEqual(parsePoint('50,20',null,{relativeDefault:true}),{x:50,y:20},'기준점이 없으면 절대');
  assert.match(app,/submit\.keyboard=true;try\{submit\(\);\}finally\{submit\.keyboard=false;\}/,'키보드로 친 좌표만(리습·매크로는 그대로 절대)');
});

test('입력 설정: 기본값·범위 밖 값 버리기·저장/읽기·설정 칸',()=>{
  assert.equal(INPUT_PREF_DEFAULTS.gripObjLimit,100);
  const n=normalizeInputPrefs({gripObjLimit:-5,osnapOptions:3,lassoSelect:'yes',polarAddAngles:'15,75',unknown:1});
  assert.equal(n.gripObjLimit,100);assert.equal(n.lassoSelect,false);assert.equal(n.polarAddAngles,'15,75');assert.equal('unknown' in n,false);
  const store=new Map(),storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
  saveInputPrefs(storage,{...INPUT_PREF_DEFAULTS,dynPiCoords:1});assert.equal(loadInputPrefs(storage).dynPiCoords,1);assert.ok(store.has(INPUT_PREFS_KEY));
  assert.deepEqual(loadInputPrefs({getItem(){throw Error('blocked');}}),{...INPUT_PREF_DEFAULTS});
  // 가짜 문서로 칸 만들기
  const el=tag=>({tag,children:[],dataset:{},listeners:{},append(...xs){this.children.push(...xs);},replaceChildren(){this.children=[];},addEventListener(k,f){this.listeners[k]=f;}});
  const doc={createElement:el,createTextNode:t=>({text:t})},root=el('div');let prefs={...INPUT_PREF_DEFAULTS},changed=0;
  renderInputPrefControls(root,()=>prefs,next=>{prefs=next;changed++;},doc);
  assert.equal(root.children.length,INPUT_PREF_FIELDS.length);
  const grip=root.children.find(w=>w.children.some(c=>c.dataset?.inputPref==='gripObjLimit')).children.find(c=>c.dataset?.inputPref);
  grip.value='250';grip.listeners.change();assert.equal(prefs.gripObjLimit,250);assert.equal(changed,1);
});
