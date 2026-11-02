// 벽 그리기(WAL) 프리셋 기하 시험. 모두 자체 엔진 안에서만 돈다.
import test from 'node:test'
import assert from 'node:assert/strict'
import {buildWallLines,exteriorSideOf,oppositeSide,normalizePreset,loadWalState,saveWalState,sectionSvg,chainCenterline,WAL_SLOTS,WAL_SAMPLES,installWallPreset} from './wall-preset.js'

const preset={name:'RC 200 외벽',lines:[{d:100,layer:'A-WALL-CON',lt:'CONTINUOUS',color:'#ffd479'},{d:190,layer:'A-WALL-INS',lt:'DASHED',color:'#f5a3ff'},{d:-100,layer:'A-WALL-CON',lt:'CONTINUOUS',color:'#ffd479'}]}
const ys=list=>list.map(e=>e.points.map(p=>Math.round(p.y)))

test('WALDRAW 입력 구성에 맞는 wallPreset 표식을 실제 객체에 기록',async()=>{
 const draw=async(lines,slot=0)=>{
  let entities=[];
  const ctx={scripted:{inputs:{}},form:(_title,fields,apply)=>apply({...Object.fromEntries(fields.map(f=>[f.name,f.value])),method:'points',lines,slot}),
   pickPath:async()=>({points:[{x:0,y:0},{x:4000,y:0}]}),ensureLayer:name=>name,setSelected:()=>{},toast:()=>{},
   commit:change=>{entities=change.entities;return entities.map((_,i)=>String(i));}};
  await installWallPreset(ctx)();return entities;
 };
 const rc=await draw(WAL_SAMPLES[2].lines);
 assert.equal(rc.length,2);assert.ok(rc.every(e=>e.wallPreset==='RC 200 내벽'));
 const changed=await draw([{d:125,layer:'A-WALL-CONC'},{d:-125,layer:'A-WALL-CONC'}],1);
 assert.ok(changed.every(e=>e.wallPreset==='사용자 구성'));
 const stored=await draw(null,0);assert.ok(stored.every(e=>e.wallPreset==='조적벽 190'));
});

test('교차점 지정에서 점이 하나뿐이거나 실외 쪽 점이 없으면 한글 안내로 막는다 (2026-09-24 F15)', () => {
 assert.throws(()=>buildWallLines({type:'polyline',points:[{x:0,y:0}],closed:false},null,preset),/점이 2개 이상/)
 assert.throws(()=>buildWallLines({type:'line',points:[{x:0,y:0},{x:1000,y:0}]},null,preset),/실외/)
 assert.equal(exteriorSideOf([{x:0,y:0}]),null)
})

test('직선 중심선에 실외 쪽을 찍으면 +는 그쪽, −는 반대쪽에 놓인다', () => {
  const center={type:'line',points:[{x:0,y:0},{x:4000,y:0}]}
  const out=buildWallLines(center,{x:2000,y:500},preset)
  assert.deepEqual(ys(out),[[100,100],[190,190],[-100,-100]])
  assert.deepEqual(out.map(e=>e.wallLayerName),['A-WALL-CON','A-WALL-INS','A-WALL-CON'])
  assert.equal(out[1].linetype,'DASHED')
  assert.equal(out[0].color,undefined,'ByLayer 이면 선 자체 색을 두지 않는다')
})

test('실외 쪽을 아래로 찍으면 전체가 뒤집힌다', () => {
  const center={type:'line',points:[{x:0,y:0},{x:4000,y:0}]}
  assert.deepEqual(ys(buildWallLines(center,{x:2000,y:-500},preset)),[[-100,-100],[-190,-190],[100,100]])
})

test('시계반대방향 닫힌 경로의 바깥은 첫 구간의 오른쪽이다', () => {
  const pts=[{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}]
  const side=exteriorSideOf(pts)
  assert.ok(side.y<0)
  const out=buildWallLines({type:'polyline',points:pts,closed:true},side,{name:'t',lines:[{d:100,layer:'A',lt:'CONTINUOUS',color:'#ffffff'}]})
  const b=out[0].points
  assert.ok(b.every(p=>p.x<=-99||p.x>=6099||p.y<=-99||p.y>=4099),'바깥 오프셋이므로 모든 점이 원 사각형 밖에 있다')
  assert.equal(out[0].closed,true)
})

test('생성선 폭파를 켜면 폴리선이 낱개 선이 된다', () => {
  const pts=[{x:0,y:0},{x:6000,y:0},{x:6000,y:4000}]
  const out=buildWallLines({type:'polyline',points:pts,closed:false},exteriorSideOf(pts),{name:'t',lines:[{d:100,layer:'A',lt:'CONTINUOUS',color:'#ffffff'}]},{explode:true})
  assert.equal(out.length,2);assert.ok(out.every(e=>e.type==='line'))
})

test('반대쪽 점은 가장 가까운 구간을 기준으로 비춘 점이다', () => {
  const center={type:'line',points:[{x:0,y:0},{x:1000,y:0}]}
  assert.deepEqual(oppositeSide(center,{x:300,y:250}),{x:300,y:-250})
})

test('프리셋은 실외(+)부터 실내(−) 순으로 정렬되고 잘못된 값은 기본값이 된다', () => {
  const p=normalizePreset({name:'x',lines:[{d:-50,layer:'',lt:'zzz',color:'red'},{d:'120',layer:'B',lt:'center',color:'#ABCDEF'}]})
  assert.deepEqual(p.lines,[{d:120,layer:'B',lt:'CENTER',color:'#abcdef'},{d:-50,layer:'A-WALL',lt:'CONTINUOUS',color:'#ffd479'}])
})

test('열성능 메타데이터는 λ 근거가 없으면 null이고 벽선·드래그 조각에 남는다', () => {
 const p=normalizePreset({name:'x',exposure:'direct',thermalLayers:[{name:'단열',thicknessMm:90,lambda:0.03,lambdaSource:null}] ,lines:[{d:100,layer:'A',lt:'CONTINUOUS',color:'#ffffff'}]});
 assert.equal(p.thermalLayers[0].lambda,null);assert.equal(p.exposure,'direct');
 const out=buildWallLines({type:'line',points:[{x:0,y:0},{x:1000,y:0}]},{x:0,y:100},{...p});
 assert.equal(out[0].thermalLayers[0].lambda,null);assert.equal(out[0].exposure,'direct');
})
test('샘플 벽 재료층은 확인된 두께만 기록하고 미확인 칸막이는 null이다', () => {
 assert.deepEqual(WAL_SAMPLES[0].thermalLayers.map(x=>x.thicknessMm),[190]);
 assert.deepEqual(WAL_SAMPLES[1].thermalLayers.map(x=>x.thicknessMm),[200,90,12]);
 assert.deepEqual(WAL_SAMPLES[2].thermalLayers.map(x=>x.thicknessMm),[200]);
 assert.equal(WAL_SAMPLES[3].thermalLayers,null);
})

test('저장소가 비어 있으면 샘플 벽체로 시작하고 20칸을 유지한다', () => {
  const memory=new Map(),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)}
  const state=loadWalState(storage)
  assert.equal(state.presets.length,WAL_SLOTS);assert.equal(state.presets[0].name,'조적벽 190');assert.equal(state.presets[19].lines.length,0)
  state.presets[5]={name:'내 벽',lines:[{d:75,layer:'W',lt:'CONTINUOUS',color:'#112233'}]};state.method='points'
  saveWalState(storage,state)
  const again=loadWalState(storage)
  assert.equal(again.presets[5].name,'내 벽');assert.equal(again.method,'points')
})

test('단면 그림은 구성선마다 선 하나와 이름표를 가진 SVG 다', () => {
  const svg=sectionSvg(preset)
  assert.match(svg,/^<svg/);assert.equal((svg.match(/<line /g)||[]).length,1+preset.lines.length);assert.match(svg,/A-WALL-INS/)
})

test('클릭한 선에 이어진 선들을 한 폴리선으로 묶고, 그 오프셋은 꺾이는 곳에서 만난다', () => {
  const l=(id,a,b)=>({id,type:'line',points:[{x:a[0],y:a[1]},{x:b[0],y:b[1]}]})
  const doc=[l('a',[0,0],[4000,0]),l('b',[4000,0],[4000,4000]),l('c',[4000,4000],[8000,4000]),l('z',[20000,0],[21000,0]),{id:'w',type:'line',wallPreset:'x',points:[{x:8000,y:4000},{x:9000,y:4000}]}]
  const chain=chainCenterline(doc[1],doc)
  assert.equal(chain.type,'polyline');assert.equal(chain.closed,false)
  assert.deepEqual(chain.points,[{x:0,y:0},{x:4000,y:0},{x:4000,y:4000},{x:8000,y:4000}])
  const out=buildWallLines(chain,{x:2000,y:500},{name:'t',lines:[{d:100,layer:'A',lt:'CONTINUOUS',color:'#ffffff'}]})
  assert.deepEqual(out[0].points.map(p=>[Math.round(p.x),Math.round(p.y)]),[[0,100],[3900,100],[3900,4100],[8000,4100]],'모서리가 한 점에서 만난다')
})

test('갈림길이 있는 끝점에서는 묶기를 멈추고, 닫힌 고리는 닫힌 폴리선이 된다', () => {
  const l=(id,a,b)=>({id,type:'line',points:[{x:a[0],y:a[1]},{x:b[0],y:b[1]}]})
  const fork=[l('a',[0,0],[1000,0]),l('b',[1000,0],[2000,0]),l('c',[1000,0],[1000,1000])]
  assert.equal(chainCenterline(fork[0],fork),fork[0],'갈림길이면 클릭한 선만 쓴다')
  const loop=[l('a',[0,0],[1000,0]),l('b',[1000,0],[1000,1000]),l('c',[1000,1000],[0,1000]),l('d',[0,1000],[0,0])]
  const chain=chainCenterline(loop[0],loop)
  assert.equal(chain.closed,true);assert.equal(chain.points.length,4)
})

/* ── 벽체 끌기(D) ── */
import {dragWallBand,dragFrameFromPoints,matchesLayerPattern,WAL_FIXED_LAYERS_DEFAULT} from './wall-preset.js'
import {wallFrame} from './card-kit.js'
const seg=e=>[...e.points.map(p=>[Math.round(p.x),Math.round(p.y)])].sort((p,q)=>p[0]-q[0]||p[1]-q[1])
const bySeg=(p,q)=>p[0][0]-q[0][0]||p[0][1]-q[0][1]||p[1][0]-q[1][0]||p[1][1]-q[1][1]
const twoLayer=()=>[{id:'a',type:'line',points:[{x:-1000,y:0},{x:5000,y:0}],layer:'L1'},{id:'b',type:'line',points:[{x:-1000,y:200},{x:5000,y:200}],layer:'L2',linetype:'DASHED'}]

test('끌기: 첫 벽선 반대쪽으로 끌면 반대 면이 안쪽 모서리가 되고 바깥 켜는 두께만큼 더 넓게 둘러싼다', () => {
  const f=wallFrame({x:0,y:0},{x:1000,y:0},{x:0,y:200})
  const r=dragWallBand(twoLayer(),f,1000,2000,-500)
  assert.deepEqual(r.removeIds.sort(),['a','b'])
  const at=(layer)=>r.add.filter(e=>e.layer===layer).map(seg).sort(bySeg)
  // L1(d=0): 남는 두 토막 + 옮긴 선(800~2200, y=-500) + 연결선 둘(x=800, x=2200)
  assert.deepEqual(at('L1'),[[[-1000,0],[800,0]],[[800,-500],[800,0]],[[800,-500],[2200,-500]],[[2200,-500],[2200,0]],[[2200,0],[5000,0]]])
  // L2(d=200, 안쪽 면): 너비 그대로 1000~2000, y=-300
  assert.deepEqual(at('L2'),[[[-1000,200],[1000,200]],[[1000,-300],[1000,200]],[[1000,-300],[2000,-300]],[[2000,-300],[2000,200]],[[2000,200],[5000,200]]])
  assert.ok(r.add.filter(e=>e.layer==='L2').every(e=>e.linetype==='DASHED'),'선종류는 원본을 따른다')
})

test('끌기: 셋째 점 쪽으로 끌면 규칙이 뒤집혀 첫 벽선이 안쪽 모서리가 된다', () => {
  const f=wallFrame({x:0,y:0},{x:1000,y:0},{x:0,y:200})
  const r=dragWallBand(twoLayer(),f,1000,2000,700)
  const moved=l=>r.add.find(e=>e.layer===l&&Math.abs(e.points[0].y-e.points[1].y)<1e-6&&e.points[0].y>300)
  assert.deepEqual(seg(moved('L1')),[[1000,700],[2000,700]])
  assert.deepEqual(seg(moved('L2')),[[800,900],[2200,900]])
})

test('끌기: 예외 켜(와일드카드)와 중심선은 손대지 않고, 띠 밖의 선도 그대로다', () => {
  const es=[...twoLayer(),{id:'c',type:'line',points:[{x:-1000,y:100},{x:5000,y:100}],layer:'CEN'},{id:'g',type:'line',points:[{x:-1000,y:60},{x:5000,y:60}],layer:'G',linetype:'CENTER'},{id:'z',type:'line',points:[{x:-1000,y:900},{x:5000,y:900}],layer:'L1'}]
  const f=wallFrame({x:0,y:0},{x:1000,y:0},{x:0,y:200})
  const r=dragWallBand(es,f,1000,2000,-500,{fixedLayerIds:new Set(['CEN'])})
  assert.deepEqual(r.removeIds.sort(),['a','b'])
  assert.throws(()=>dragWallBand([es[2]],f,1000,2000,-500,{fixedLayerIds:new Set(['CEN'])}),/평행한 벽선이 없습니다/)
})

test('끌기: 벽선이 구간 안에서 끝나면 연결선은 벽이 이어진 쪽에만 생긴다', () => {
  const es=[{id:'a',type:'line',points:[{x:-1000,y:0},{x:1500,y:0}],layer:'L1'}]
  const f=wallFrame({x:0,y:0},{x:1000,y:0},{x:0,y:200})
  const r=dragWallBand(es,f,1000,2000,300)
  assert.deepEqual(r.add.map(seg).sort(bySeg),[[[-1000,0],[1000,0]],[[1000,0],[1000,300]],[[1000,300],[1500,300]]])
})

test('끌기: 네 점에서 좌표계·너비·거리를 만든다(첫째·둘째 점은 가장 가까운 벽선에 붙음)', () => {
  const es=twoLayer()
  const {f,s0,s1,delta}=dragFrameFromPoints(es,[{x:1000,y:3},{x:2000,y:-2},{x:1500,y:198},{x:1500,y:-600}],10)
  assert.equal(s0,0);assert.equal(Math.round(s1),1000);assert.equal(Math.round(f.t),200);assert.equal(Math.round(delta),-600)
  assert.throws(()=>dragWallBand(es,f,s0,s1,0),/옮길 위치/)
  assert.throws(()=>dragWallBand(es,f,0,0.2,-300),/너무 좁습니다/)
})

test('와일드카드 켜 이름: *·? 허용, 콤마 구분, 대소문자 무시', () => {
  assert.ok(matchesLayerPattern('A-WALL-C',WAL_FIXED_LAYERS_DEFAULT))
  assert.ok(matchesLayerPattern('cen_wall','CEN*'));assert.ok(matchesLayerPattern('A-GRID',' foo , a-grid '))
  assert.ok(!matchesLayerPattern('A-WALL','CEN*'));assert.ok(!matchesLayerPattern('A-WALL','CEN*, A-WAL'));assert.ok(matchesLayerPattern('A-WALL','A-WAL?'))
  assert.ok(!matchesLayerPattern('A-WALL',''))
})

test('예외 켜 문자열은 저장되고, 방식 drag 도 저장된다', () => {
  const memory=new Map(),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)}
  const state=loadWalState(storage);assert.equal(state.fixedLayers,WAL_FIXED_LAYERS_DEFAULT)
  state.fixedLayers='CEN*';state.method='drag';saveWalState(storage,state)
  const again=loadWalState(storage);assert.equal(again.fixedLayers,'CEN*');assert.equal(again.method,'drag')
})

test('끌기: 앞서 생긴 ㄷ자 연결선(수직선) 위에 첫 점을 찍어도 첫째→둘째 방향과 평행한 벽선에만 붙는다', () => {
  const es=[...twoLayer(),{id:'v',type:'line',points:[{x:1500,y:290},{x:1500,y:-510}],layer:'L1'}]
  const {f,s1,delta}=dragFrameFromPoints(es,[{x:1500,y:0},{x:3000,y:0},{x:2200,y:200},{x:2200,y:-800}],50)
  assert.equal(Math.round(s1),1500);assert.equal(Math.round(f.t),200);assert.equal(Math.round(delta),-800);assert.equal(Math.abs(f.u.x),1)
  assert.equal(f.snapped.first.id,'a')
})

test('벽 끌기: 사용자 켜의 기존 벽선은 원본을 자르고 옮겨 중복을 만들지 않는다',()=>{
 const f=wallFrame({x:0,y:0},{x:1000,y:0},{x:0,y:200});
 const source={id:'legacy-wall',type:'line',layer:'legacy',points:[{x:0,y:0},{x:5000,y:0}]};
 const r=dragWallBand([source],f,1000,2000,500,{layers:[{id:'legacy',name:'기존 벽'}]});
 assert.deepEqual(r.removeIds,[source.id]);assert.equal(r.add.length,5);
 assert.ok(r.add.every(e=>e.layer===source.layer));
 assert.deepEqual(r.add.filter(e=>e.points.every(p=>p.y===0)).map(e=>e.points.map(p=>p.x)),[[0,1000],[2000,5000]]);
});


test('벽 띠 절단·끌기 조각은 원본 검토 번호를 유지한다',async()=>{
 const {cutWallBand}=await import('./card-kit.js'),f=wallFrame({x:0,y:0},{x:1000,y:0},{x:0,y:200});
 for(const type of ['line','polyline']){const src={id:'w',type,layer:'wall',points:[{x:0,y:0},{x:4000,y:0}],reviewObjectId:'EW-03'};
  const cut=cutWallBand([src],f,1000,2000);assert.equal(cut.add.length,2);assert.ok(cut.add.every(e=>e.reviewObjectId==='EW-03'));
  const drag=dragWallBand([src],f,1000,2000,500);assert.ok(drag.add.length>=3);assert.ok(drag.add.every(e=>e.reviewObjectId==='EW-03'));
 }
});
