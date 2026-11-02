import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberAllowed,pickGroup,wallOutline,checkDrawing,serverChecks,mergeWallLayers,foreignAdditions} from './drawing-check.js';
import * as G from './geometry.js';
import {applyDrawingLayerReview,applyForeignDrawing} from './architecture.js';

test('사무소 사전: 짧은 이름(0·W·IN)·숫자뿐·DEFPOINTS 는 기억하지 않는다',()=>{
 for(const name of ['0','W','IN','7','00','000','DEFPOINTS','도면$0$W'])assert.equal(rememberAllowed(name),false,name);
 for(const name of ['WALL1','CON','창호','STAIR','평면도$0$WIN'])assert.equal(rememberAllowed(name),true,name);
});

const line=(id,layer,a,b)=>({id,type:'line',layer,points:[{x:a[0],y:a[1]},{x:b[0],y:b[1]}]});
const L=(id,name)=>({id,name,visible:true,locked:false,frozen:false});

test('짚기: 계단 디딤판 하나를 누르면 같은 간격으로 나란한 선만 묶고, 같은 레이어의 다른 선은 뺀다',()=>{
 const treads=[...Array(9)].map((_,i)=>line('t'+i,'z',[0,i*250],[1000,i*250]));
 const doc={layers:[L('z','0'),L('w','CON')],entities:[...treads,line('x1','z',[5000,0],[9000,4000]),line('x2','z',[-3000,0],[-3000,6000]),line('w1','w',[0,-500],[1000,-500])]};
 const g=pickGroup(doc,'t4');
 assert.deepEqual([...g.ids].sort(),treads.map(t=>t.id).sort());
 assert.equal(g.how,'같은 간격 평행선');
 assert.equal(g.layerName,'0');
 assert.equal(g.layerCount,11);
});

test('짚기: 계단이 아니면 끝점이 이어진 같은 레이어 선을 묶는다(떨어진 선은 뺀다)',()=>{
 const doc={layers:[L('x','X')],entities:[line('a','x',[0,0],[0,3000]),line('b','x',[0,3000],[4000,3000]),line('c','x',[4000,3000],[4000,0]),line('far','x',[9000,0],[9000,3000])]};
 const g=pickGroup(doc,'b');
 assert.deepEqual([...g.ids].sort(),['a','b','c']);
 assert.equal(g.how,'이어진 선');
});

// 10m×8m 방 하나, 벽 두께 200. 남쪽 벽 가운데 2m 가 창(창 선 두 줄이 틈을 가로지름).
function roomWalls({bridged=true}={}){
 const W=[],add=(a,b)=>W.push(line('w'+W.length,'w',a,b));
 add([0,0],[4000,0]);add([6000,0],[10000,0]);add([10000,0],[10000,8000]);add([10000,8000],[0,8000]);add([0,8000],[0,0]);
 add([200,200],[4000,200]);add([6000,200],[9800,200]);add([9800,200],[9800,7800]);add([9800,7800],[200,7800]);add([200,7800],[200,200]);
 add([4000,0],[4000,200]);add([6000,0],[6000,200]);
 if(bridged){add([4000,80],[6000,80]);add([4000,120],[6000,120]);}
 return W;
}

test('건물 외곽: 벽·창 선으로 둘러싼 바깥 둘레를 닫힌 선으로 만든다',()=>{
 const r=wallOutline(roomWalls());
 assert.equal(r.closed,true);
 assert.ok(Math.abs(Math.abs(G.polygonArea(r.points))/1e6-80)<2.5,'넓이 약 80㎡: '+Math.abs(G.polygonArea(r.points))/1e6);
});

test('건물 외곽: 벽 사이가 2.4m 이하로 뚫린 곳(문 없는 통로)은 막아서 만들고, 막았다고 알린다',()=>{
 const r=wallOutline(roomWalls({bridged:false}));
 assert.equal(r.closed,true);
 assert.equal(r.gaps,true);
 assert.equal(wallOutline(roomWalls()).gaps,false);
});

test('건물 외곽: 4m 넘게 뚫려 있으면 닫히지 않았다고 알린다(사각형으로 꾸며 내지 않음)',()=>{
 const W=roomWalls({bridged:false}).map(e=>e.points[0].x===6000&&e.points[1].x>6000?line(e.id,'w',[8000,e.points[0].y],[e.points[1].x,e.points[1].y]):e).filter(e=>!(e.points[0].x===6000&&e.points[1].x===6000));
 assert.equal(wallOutline(W).closed,false);
});

// 받은 평면: 벽은 CON(콘크리트벽으로 정함), 창은 WIN(창호로 정함), 실 이름 글자 '거실'. 문·계단은 없음.
function receivedPlan(){
 const walls=roomWalls().map(e=>({...e,layer:'c'}));
 const win=walls.filter(e=>e.points[0].y===80||e.points[0].y===120).map(e=>({...e,layer:'g'}));
 const entities=[...walls.filter(e=>!win.some(w=>w.id===e.id)),...win,{id:'t1',type:'text',layer:'t',text:'거실',points:[{x:5000,y:4000}]}];
 const decisions=entities.filter(e=>e.type==='line').map(e=>({id:e.id,label:e.layer==='c'?'콘크리트벽':'창호',accepted:true}));
 return {doc:{layers:[L('c','CON'),L('g','WIN'),L('t','TEXT')],entities},decisions};
}
const item=(r,key)=>r.groups.flatMap(g=>g.items).find(i=>i.key===key);

test('도면 확인: 3D 모형·단면에 필요한 것 — 찾은 것 ✓, 빠진 것 !, 기본값으로 도는 것 –',()=>{
 const {doc,decisions}=receivedPlan(),r=checkDrawing(doc,decisions);
 assert.deepEqual(['wall','window','door','stair','room','height'].map(k=>item(r,k).status),['ok','ok','miss','miss','ok','none']);
 assert.equal(r.groups.find(g=>g.key==='model').ready,false);
 const marked=checkDrawing(doc,decisions,{marks:{door:'none',stair:'none'}});
 assert.equal(item(marked,'door').detail,'이 도면에 없음');
 assert.equal(marked.groups.find(g=>g.key==='model').ready,true);
});

test('도면 확인: 법규 검토 — 대지는 짚어야 하고, 건물 외곽은 벽 둘레로 만들고, 용도지역은 고르면 됨',()=>{
 const {doc,decisions}=receivedPlan();
 const r=checkDrawing(doc,decisions);
 assert.equal(item(r,'site').status,'miss');
 assert.equal(item(r,'building').status,'ok');
 assert.ok(Math.abs(Math.abs(G.polygonArea(item(r,'building').outline))/1e6-80)<2.5);
 assert.equal(item(r,'zone').status,'miss');
 assert.deepEqual(['bline','north'].map(k=>item(r,k).status),['none','none']);
 // 대지 경계를 짚고(닫힌 선을 대지로) 용도지역을 고르면 법규 검토를 돌릴 수 있다
 doc.layers.push(L('s','지적'));doc.entities.push({id:'site',type:'polyline',closed:true,layer:'s',points:[{x:-5000,y:-5000},{x:15000,y:-5000},{x:15000,y:13000},{x:-5000,y:13000}]});
 const ok=checkDrawing(doc,[...decisions,{id:'site',label:'대지',accepted:true}],{zone:'제2종일반주거지역'});
 assert.equal(item(ok,'zone').detail,'제2종일반주거지역');
 assert.equal(ok.groups.find(g=>g.key==='law').ready,true);
});

test('적용: 벽 둘레로 만든 건물 외곽은 A-BLDG-L1 닫힌 선으로, 고른 용도지역은 법규 검사가 읽는 곳에 남는다',()=>{
 const {doc,decisions}=receivedPlan(),outline=item(checkDrawing(doc,decisions),'building').outline;
 const r=applyDrawingLayerReview(doc,decisions,{outline,zone:'제2종일반주거지역'});
 const bldg=doc.layers.find(l=>l.name==='A-BLDG-L1'),added=doc.entities.filter(e=>e.layer===bldg?.id);
 assert.equal(added.length,1);
 assert.equal(added[0].closed,true);
 assert.equal(doc.reviewSettings.manualZone,'제2종일반주거지역');
 assert.equal(r.changed,decisions.length);
});

test('건물 외곽: 문 열림 호와 블록 안 선도 틈을 막는다',()=>{
 // 남쪽 창 틈은 블록 안 창 선으로, 북쪽 문 틈(900)은 열림 호로 막힌 평면
 const W=roomWalls({bridged:false}).filter(e=>!(e.points[0].y===8000&&e.points[1].y===8000)&&!(e.points[0].y===7800&&e.points[1].y===7800));
 W.push(line('n1','w',[10000,8000],[4900,8000]),line('n2','w',[4000,8000],[0,8000]),line('n3','w',[9800,7800],[4900,7800]),line('n4','w',[4000,7800],[200,7800]));
 W.push({id:'blk',type:'block',layer:'w',entities:[line('g1','w',[4000,80],[6000,80]),line('g2','w',[4000,120],[6000,120])]});
 W.push({id:'arc',type:'arc',layer:'w',center:{x:4000,y:8000},radius:900,startAngle:0,endAngle:90});
 W.push(line('leaf','w',[4000,8000],[4000,8900]));   // 문짝
 const r=wallOutline(W);
 assert.equal(r.closed,true);
 const a=Math.abs(G.polygonArea(r.points))/1e6;assert.ok(a>79&&a<82.5,'넓이 '+a);
});

test('짚기: 문 열림 호를 누르면 호 중심(경첩)에서 뻗은 문짝 선도 같이 묶는다',()=>{
 const doc={layers:[L('d','WD')],entities:[{id:'arc',type:'arc',layer:'d',center:{x:0,y:0},radius:900,startAngle:0,endAngle:90},line('leaf','d',[0,0],[0,900]),line('far','d',[5000,0],[6000,0]),line('frame','d',[900,0],[3000,0])]};   // frame: 호 끝에 붙은 창틀(같은 레이어) — 문이 아님
 assert.deepEqual([...pickGroup(doc,'arc').ids].sort(),['arc','leaf']);
});

test('실 이름 낱말은 3D 모형(서버 계산 compute/plan-to-model.js)과 같은 목록을 쓴다',async()=>{
 const {ROOM_WORDS:model}=await import('./compute/plan-to-model.js');
 const {ROOM_WORDS:mine}=await import('./drawing-check.js');
 assert.equal(String(mine),String(model));
});

// ── 남의 도면 읽기(서버) 결과로 채우는 도면 확인 (2026-10-22 대표 결정: 두 기능 합치기) ──
const sq=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
function serverRead({doubt=false,outdoor=false}={}){
 return {sheets:1,floors:[{label:'1층',wallLayer:'CON',layerScores:[{layer:'CON',walls:14,area:117.1},{layer:'0',walls:2,area:2.1}],
  runs:[{start:{x:0,y:0},end:{x:10000,y:0},thickness:200,openings:[{offset:2000,width:1500,kind:'window'},{offset:6000,width:1500,kind:'window'}]},
        {start:{x:10000,y:0},end:{x:10000,y:8000},thickness:200,openings:[{offset:3000,width:900,kind:'door'}]},
        {start:{x:10000,y:8000},end:{x:0,y:8000},thickness:200,openings:[]},{start:{x:0,y:8000},end:{x:0,y:0},thickness:200,openings:[]}],
  rooms:[{name:'소매점',stair:false,area:60e6,points:sq(0,0,7500,8000)},{name:null,stair:false,area:12e6,points:sq(7500,0,10000,4800)},{name:null,stair:true,area:8e6,points:sq(7500,4800,10000,8000)}],
  outline:{points:sq(0,0,10000,8000),envelope:sq(-100,-100,10100,8100),area:80e6,envelopeArea:82e6,outdoorCandidates:outdoor?[{points:sq(10000,0,11500,3000),area:4.5e6}]:[]},
  unresolved:doubt?[{reason:'바닥 윤곽 두 방법 차이 -11.0% — 외곽 확인 필요'}]:[]}],data:{schema:'barun.foreign-plan/0.1'}};
}

test('서버 읽기 결과: 벽은 제안(?), 창·문은 벽 구멍 수, 실·계단·벽 중심선 외곽은 찾음',()=>{
 const r=serverChecks(serverRead());
 const it=k=>r.groups.flatMap(g=>g.items).find(i=>i.key===k);
 assert.equal(it('wall').status,'sug');
 assert.match(it('wall').detail,/CON/);
 assert.deepEqual([it('window').count,it('door').count,it('stair').count],[2,1,1]);
 assert.equal(it('room').status,'ok');
 assert.match(it('room').detail,/이름 없는 1/);
 assert.equal(it('building').status,'ok');
 assert.equal(Math.round(Math.abs(G.polygonArea(it('building').outline))/1e6),Math.round(10200*8200/1e6));   // 발코니 띠 빼기 전 벽 중심선 외곽
});

test('서버가 스스로 의심하면 벽은 !(고르기), 직원이 고르면 ✓ — 의심 내용은 확인 필요 칸에',()=>{
 const r=serverChecks(serverRead({doubt:true}));
 const it=(x,k)=>x.groups.flatMap(g=>g.items).find(i=>i.key===k);
 assert.equal(it(r,'wall').status,'miss');
 assert.ok(r.confirm.some(c=>/두 방법 차이/.test(c.text)));
 assert.equal(it(serverChecks(serverRead({doubt:true}),{wallSource:'staff',wallNames:['WALL1','CON']}),'wall').status,'ok');
});

test('실 밖 공간 후보는 확인 필요 칸에, 직원이 고른 것은 빠진다',()=>{
 const r=serverChecks(serverRead({outdoor:true}));
 const c=r.confirm.find(x=>x.kind==='outdoor');
 assert.ok(c);
 assert.equal(serverChecks(serverRead({outdoor:true}),{marks:{[c.key]:'keep'}}).confirm.some(x=>x.key===c.key),false);
});

test('여러 벽 레이어를 서버에 한 이름으로: 고른 레이어의 선만 임시 레이어로 옮긴 사본, 원본은 그대로',()=>{
 const doc={layers:[L('a','WALL1'),L('b','WALL2'),L('c','TEXT')],entities:[line('1','a',[0,0],[1,0]),line('2','b',[0,1],[1,1]),line('3','c',[0,2],[1,2])]};
 const {doc:copy,layer}=mergeWallLayers(doc,['WALL1','WALL2']);
 const id=copy.layers.find(l=>l.name===layer).id;
 assert.deepEqual(copy.entities.map(e=>e.layer===id),[true,true,false]);
 assert.deepEqual(doc.entities.map(e=>e.layer),['a','b','c']);
});

test('다시 그려 더하기: 한 번의 적용으로 벽 객체·벽 구멍(창·문)·실·계단·벽 중심선 외곽을 더하고, 원본 선은 그대로',()=>{
 const doc={layers:[L('c','CON')],entities:[line('orig','c',[0,0],[10000,0])]};
 const add=foreignAdditions(serverRead({outdoor:true}),{roomNames:{'0:1':'창고'},marks:{}});
 const r=applyForeignDrawing(doc,add,{zone:'제2종일반주거지역'});
 const on=name=>doc.entities.filter(e=>doc.layers.find(l=>l.id===e.layer)?.name===name);
 const walls=on('A-WALL-CONC');
 assert.equal(walls.length,4);
 assert.ok(walls.every(w=>w.type==='wall'));
 const holes=doc.entities.filter(e=>e.hostWall);
 assert.equal(holes.length,3);
 assert.ok(holes.every(h=>walls.some(w=>w.id===h.hostWall)));
 assert.equal(on('A-AREA').filter(e=>e.type==='polyline').length,3);   // 실 2 + 확인 안 한 실 밖 공간 1
 assert.equal(on('A-STAIR').length,1);
 assert.ok(on('A-TEXT').some(t=>/창고/.test(t.text)));
 assert.ok(on('A-TEXT').some(t=>/\[확인\]/.test(t.text)));
 assert.equal(on('A-BLDG-L1').length,1);
 assert.equal(doc.entities.find(e=>e.id==='orig').layer,'c');
 assert.equal(doc.reviewSettings.manualZone,'제2종일반주거지역');
 assert.ok(r.added.length>=10);
});

test('다시 그려 더하기: 직원이 확인한 실 밖 공간은 [확인] 표시를 남기지 않는다',()=>{
 const doc={layers:[],entities:[]};
 applyForeignDrawing(doc,foreignAdditions(serverRead({outdoor:true}),{marks:{'o0-0':'keep'}}));
 assert.equal(doc.entities.some(e=>/\[확인\]/.test(e.text||'')),false);
});
