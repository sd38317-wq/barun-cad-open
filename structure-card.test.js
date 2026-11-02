// 구조 그리기 카드 시험(BLS izzarder.com/553 · TRUSS izzarder.com/268). 화면 없이 순수 함수만 돌린다.
import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeValues,defaultsOf} from './card-kit.js'
import {TRUSS_FIELDS,TRUSS_SHARED_FIELDS,trussSlotDefaults,trussSizes,trussSegments,trussGeometry,trussSummary,
 trussPreviewSvg,clipSegment,braceLines,STRUCTURE_LAYERS,
 BLS_FIELDS,BLS_SHARED_FIELDS,blsSlotDefaults,blsPreviewSvg,blsTableOptions,stripUnderground,classifyKey,rectOf,boxOf,
 relRect,absRect,tileCells,textsInRect,dimensionValue,readSizeInRect,readCells,sortRecords,aggregateRows,chunkSymbols,
 scheduleEntities,planSymbolKey,planSizeFor,areaCandidates,loadRegistration,saveRegistration,cellsFromRegistration} from './structure-card.js'

const tv=(extra={})=>normalizeValues(TRUSS_FIELDS,{...defaultsOf(TRUSS_FIELDS),...extra},'t')
const tshared=normalizeValues(TRUSS_SHARED_FIELDS,defaultsOf(TRUSS_SHARED_FIELDS))
const bv=(extra={})=>normalizeValues(BLS_FIELDS,{...defaultsOf(BLS_FIELDS),...extra},'b')
const bshared=normalizeValues(BLS_SHARED_FIELDS,defaultsOf(BLS_SHARED_FIELDS))
const r2=n=>Math.round(n*100)/100
const seg2=s=>[[r2(s[0][0]),r2(s[0][1])],[r2(s[1][0]),r2(s[1][1])]]
const has=(list,s)=>list.some(x=>x[0][0]===s[0][0]&&x[0][1]===s[0][1]&&x[1][0]===s[1][0]&&x[1][1]===s[1][1])

/* ── TRUSS ─────────────────────────────────────────────────────── */

test('TRUSS 뼈대: 원문 그림에서 읽은 자리에 주부재 선이 놓인다', () => {
 // 원문 둘째 그림 실측 비(길이:높이:주부재 = 314:95:19px)를 A1500 B300 L5000 으로 옮긴 것
 const s=trussSegments(tv(),5000)
 // 가로선 4줄: 하현 아래(d=0)·하현 위(d=300)·상현 아래(d=1200, 단부재 사이만)·상현 위(d=1500)
 assert.ok(has(s,[[0,0],[5000,0]]))
 assert.ok(has(s,[[0,300],[5000,300]]))
 assert.ok(has(s,[[300,1200],[4700,1200]]))
 assert.ok(has(s,[[0,1500],[5000,1500]]))
 // 세로선: 양 끝(0,5000) 전체높이 · 단부재 안쪽면(300,4700) · 중간(600,4400) · 중앙(2350,2650)
 assert.ok(has(s,[[0,0],[0,1500]]))
 assert.ok(has(s,[[5000,0],[5000,1500]]))
 assert.ok(has(s,[[300,300],[300,1500]]))
 assert.ok(has(s,[[4700,300],[4700,1500]]))
 for(const x of [600,4400,2350,2650])assert.ok(has(s,[[x,300],[x,1200]]),'수직 주부재 '+x)
})

test('TRUSS 단면재: 끝 두 칸 맨 위에 높이 C 인 상자와 × 가 들어간다', () => {
 const s=trussSegments(tv(),5000)
 assert.ok(has(s,[[0,1300],[300,1300]]))            // 왼쪽 단면재 아래선 (A-C = 1500-200)
 assert.ok(has(s,[[0,1300],[300,1500]]))            // ×
 assert.ok(has(s,[[0,1500],[300,1300]]))
 assert.ok(has(s,[[4700,1300],[5000,1300]]))        // 오른쪽
 const off=trussSegments(tv({endCap:false}),5000)
 assert.equal(s.length-off.length,6)                // 단면재 표현을 끄면 양쪽 3줄씩 사라진다
 assert.ok(!off.some(x=>x[0][1]===1300||x[1][1]===1300))
})

test('TRUSS 간재: 두께 D 인 평행선 두 줄이 칸 안으로 잘려 들어간다', () => {
 const s=trussSegments(tv(),5000).map(seg2)
 // 왼쪽 사재 중심선 (600,300)→(2350,1200), 두께 200 → 위쪽 선은 s=600 에서, 아래쪽 선은 d=300 에서 잘린다
 assert.ok(has(s,[[600,412.45],[2131.35,1200]]),JSON.stringify(s))
 assert.ok(has(s,[[818.65,300],[2350,1087.55]]))
 // 오른쪽은 좌우 대칭 (s → 5000-s)
 assert.ok(has(s,[[4400,412.45],[2868.65,1200]]))
 assert.ok(has(s,[[4181.35,300],[2650,1087.55]]))
 const off=trussSegments(tv({web:false}),5000)
 assert.equal(trussSegments(tv(),5000).length-off.length,4)   // 사재 4줄만 사라지고 수직 주부재는 남는다
 for(const x of [600,4400,2350,2650])assert.ok(off.some(g=>g[0][0]===x&&g[0][1]===300))
})

test('clipSegment / braceLines: 네모 밖은 잘리고 아예 벗어나면 없다', () => {
 assert.deepEqual(clipSegment([0,0],[10,10],{s0:2,s1:8,d0:0,d1:10}),[[2,2],[8,8]])
 assert.equal(clipSegment([0,0],[1,1],{s0:5,s1:8,d0:0,d1:10}),null)
 assert.equal(braceLines([0,0],[0,0],100,{s0:0,s1:1,d0:0,d1:1}).length,0)
 const two=braceLines([0,0],[100,0],20,{s0:-50,s1:150,d0:-50,d1:50})
 assert.deepEqual(two,[[[0,10],[100,10]],[[0,-10],[100,-10]]])   // 수평 중심선 → 위·아래 10씩
})

test('TRUSS 객체: 두 점 방향으로 돌아가고 켜는 A-BEAM, 길이는 두 점 거리다', () => {
 const r=trussGeometry(tv(),tshared,{x:1000,y:2000},{x:6000,y:2000})
 assert.equal(r.length,5000)
 assert.equal(r.angle,0)
 assert.ok(r.entities.every(e=>e.type==='line'&&e.cardLayer===STRUCTURE_LAYERS.truss))
 const bottom=r.entities[0].points.map(p=>[r2(p.x),r2(p.y)])
 assert.deepEqual(bottom,[[1000,2000],[6000,2000]])
 // 위로 그린 세로 트러스: 첫 점 → 둘째 점이 +y 면 트러스는 -x 쪽(왼쪽)에 선다
 const up=trussGeometry(tv(),tshared,{x:0,y:0},{x:0,y:5000})
 assert.deepEqual(up.entities[0].points.map(p=>[r2(p.x),r2(p.y)]),[[0,0],[0,5000]])
 assert.deepEqual(up.entities[2].points.map(p=>[r2(p.x),r2(p.y)]),[[-1500,0],[-1500,5000]])
})

test('TRUSS 값 검증: 원문 기본값은 통과하고 어긋난 값은 한국어 오류를 던진다', () => {
 assert.deepEqual(trussSizes(tv(),5000),{A:1500,B:300,C:200,D:200})
 assert.throws(()=>trussSizes(tv({height:600}),5000),/트러스 높이/)
 assert.throws(()=>trussSizes(tv({mainWidth:0}),5000),/주부재 너비/)
 assert.throws(()=>trussSizes(tv({capHeight:500}),5000),/단면재 높이/)
 assert.throws(()=>trussSizes(tv(),1000),/트러스 길이/)
 assert.throws(()=>trussGeometry(tv(),tshared,{x:0,y:0},{x:0,y:0}),/서로 다른 점/)
})

test('TRUSS 칸 기본값 넷과 요약·미리보기', () => {
 const ks=[0,1,2,3].map(i=>tv(trussSlotDefaults(i)))
 assert.deepEqual(ks.map(k=>[k.height,k.mainWidth,k.endCap,k.web]),
  [[1500,300,true,true],[1500,300,false,true],[1500,300,true,false],[900,200,true,true]])
 assert.equal(trussSummary(ks[0]),'높이 1500 · 주부재 300 · 단면재 200 · 간재 200')
 assert.equal(trussSummary(ks[1]),'높이 1500 · 주부재 300 · 단면재 없음 · 간재 200')
 for(const k of ks)assert.match(trussPreviewSvg(k,tshared,{width:64,height:34,compact:true}),/^<svg /)
})

/* ── BLS ───────────────────────────────────────────────────────── */

test('BLS 분류: 원문 예(1G4 · 1G3A 가 같은 600x900)에서 첫·둘은 묶이고 셋은 갈라진다', () => {
 for(const m of ['one','two'])assert.equal(classifyKey('1G4',m),classifyKey('1G3A',m))
 assert.notEqual(classifyKey('1G4','three'),classifyKey('1G3A','three'))
 assert.notEqual(classifyKey('1G4','none'),classifyKey('1G3A','none'))
 // 맨 앞 지하층 "-" 는 인식에서 자동 제외 → -1G3A 와 1G4 가 [둘]에서 같은 "1G"
 assert.equal(stripUnderground('-1G3A'),'1G3A')
 assert.equal(classifyKey('-1G3A','two'),classifyKey('1G4','two'))
 assert.equal(classifyKey('1G4','two'),'head:1G')
 // [이것만] : 입력 문자가 첫 문자일 때만 분류
 assert.equal(classifyKey('1G4','only','1G'),'only:1G')
 assert.equal(classifyKey('2G4','only','1G'),'self:2G4')
 assert.notEqual(classifyKey('2G4','only','1G'),classifyKey('2G5','only','1G'))
})

test('BLS 집계: 같은 크기 · 같은 분류끼리 한 줄로 모으고 나온 순서를 지킨다', () => {
 const recs=[{symbol:'1G4',size:'600x900'},{symbol:'-1G3A',size:'600x900'},{symbol:'1G4',size:'600x900'},
  {symbol:'2G1',size:'700x1200'},{symbol:'1G9',size:'600x900'}]
 assert.deepEqual(aggregateRows(recs,{mode:'two'}),
  [{symbols:['1G4','-1G3A','1G9'],size:'600x900'},{symbols:['2G1'],size:'700x1200'}])
 assert.deepEqual(aggregateRows(recs,{mode:'three'}).map(r=>r.symbols),[['1G4'],['-1G3A'],['2G1'],['1G9']])
 assert.deepEqual(aggregateRows(recs,{mode:'none'}).map(r=>r.symbols),[['1G4'],['-1G3A'],['2G1'],['1G9']])
 assert.deepEqual(chunkSymbols(['a','b','c','d','e']),['a,b,c','d,e'])
 assert.deepEqual(chunkSymbols([]),[''])
})

test('BLS 도곽 영역: 좌상단 한 칸을 도곽 안에 깐 칸 좌표가 맞다', () => {
 const frame={minX:0,minY:0,maxX:1000,maxY:800}
 const cells=tileCells(frame,{minX:0,minY:600,maxX:500,maxY:800})
 assert.equal(cells.length,8)                       // 가로 2칸 × 세로 4칸
 assert.deepEqual(cells[0],{minX:0,maxX:500,minY:600,maxY:800})
 assert.deepEqual(cells[1],{minX:500,maxX:1000,minY:600,maxY:800})
 assert.deepEqual(cells[2],{minX:0,maxX:500,minY:400,maxY:600})
 assert.deepEqual(cells[7],{minX:500,maxX:1000,minY:0,maxY:200})
 assert.throws(()=>tileCells(frame,{minX:0,minY:800,maxX:0,maxY:800}),/좌상단 한 칸/)
})

test('BLS 읽기: 기호문자 영역의 문자와 치수영역의 수평·수직 치수를 600x900 으로 읽는다', () => {
 const es=[
  {type:'text',text:'-1G1C',position:{x:50,y:1150}},
  {type:'text',text:'양단부',position:{x:50,y:2000}},          // 칸 밖
  {type:'dimension',mode:'horizontal',points:[{x:10,y:960},{x:610,y:960},{x:10,y:990}]},
  {type:'dimension',mode:'vertical',points:[{x:10,y:0},{x:10,y:900},{x:0,y:0}]},
 ]
 const symbol={minX:0,minY:1100,maxX:200,maxY:1200},size={minX:0,minY:0,maxX:700,maxY:1000}
 assert.deepEqual(textsInRect(es,symbol),['-1G1C'])
 assert.deepEqual(dimensionValue(es[2]),{value:600,vertical:false})
 assert.deepEqual(dimensionValue(es[3]),{value:900,vertical:true})
 assert.equal(readSizeInRect(es,size),'600x900')
 // 문자 하나에 "600x900" 이 통째로 있으면 그대로 쓴다
 assert.equal(readSizeInRect([{type:'text',text:'600X900',position:{x:10,y:10}}],size),'600x900')
 // 세운 문자(rotation 90)는 세로로 본다
 assert.equal(readSizeInRect([{type:'text',text:'650',position:{x:10,y:10},rotation:0},
  {type:'text',text:'1250',position:{x:20,y:20},rotation:90}],size),'650x1250')
 const cells=[{box:{minX:0,minY:0,maxX:700,maxY:1200},symbol,size},
  {box:{minX:1e4,minY:0,maxX:1.07e4,maxY:1200},symbol:{minX:1e4,minY:1100,maxX:1.02e4,maxY:1200},size:{minX:1e4,minY:0,maxX:1.07e4,maxY:1000}}]
 assert.deepEqual(readCells(es,cells),[{symbol:'-1G1C',size:'600x900',box:cells[0].box}])   // 빈 칸은 버린다
})

test('BLS 정렬: 기준점과 순서대로 칸을 줄 세운다', () => {
 const mk=(n,x,y)=>({symbol:n,size:'1',box:{minX:x,minY:y,maxX:x+100,maxY:y+100}})
 const rs=[mk('D',500,0),mk('B',500,500),mk('A',0,500),mk('C',0,0)]
 assert.deepEqual(sortRecords(rs,{order:'hDown'}).map(r=>r.symbol),['A','B','C','D'])
 assert.deepEqual(sortRecords(rs,{order:'hUp'}).map(r=>r.symbol),['C','D','A','B'])
 assert.deepEqual(sortRecords(rs,{order:'vDown'}).map(r=>r.symbol),['A','C','B','D'])
 assert.deepEqual(sortRecords(rs,{order:'vUp'}).map(r=>r.symbol),['C','A','D','B'])
 assert.deepEqual(sortRecords(rs,{pickOrder:true}).map(r=>r.symbol),['D','B','A','C'])
 // 오차 안에서 어긋난 줄은 같은 줄로 본다
 const tilted=[mk('B',500,4),mk('A',0,0)]
 assert.deepEqual(sortRecords(tilted,{order:'hDown',tolerance:10}).map(r=>r.symbol),['A','B'])
})

test('BLS 표: 축척 1/100 의 선·문자 좌표와 공란 사선이 맞다', () => {
 const rows=[{symbols:['1G1','1G1B','1G2B','1G3B'],size:'800x900'},{symbols:[],size:'650x1250'},{symbols:['1G11E'],size:''}]
 const es=scheduleEntities(rows,{x:0,y:0,scale:100,textHeight:2.5,lineGap:6,symbolGap:60,sizeGap:30,remarkGap:30})
 const lines=es.filter(e=>e.type==='line'),texts=es.filter(e=>e.type==='text')
 // 열 너비 6000 / 3000 / 3000 → 표 너비 12000. 줄 높이 600, 첫 줄은 기호가 4개라 두 줄(1200)
 assert.deepEqual(lines[0].points,[{x:0,y:0},{x:12000,y:0}])
 const full=lines.filter(l=>l.points[0].x===0&&l.points[1].x===12000).map(l=>l.points[0].y)
 assert.deepEqual(full,[0,-1200,-1800,-2400])
 // 기호는 한 줄에 3개씩 끊고, 문자높이는 250, 왼쪽 여백은 문자높이의 절반
 assert.deepEqual(texts.map(t=>t.text),['1G1,1G1B,1G2B','1G3B','800x900','650x1250','1G11E'])
 assert.deepEqual([texts[0].position.x,texts[0].position.y,texts[0].height],[125,-387.5,250])
 assert.deepEqual([texts[1].position.x,texts[1].position.y],[125,-987.5])
 assert.deepEqual([texts[2].position.x,texts[2].position.y],[6125,-387.5])
 // 기호 공란 → 기호 칸에 사선, 크기 공란 → 크기 칸에 사선
 assert.ok(lines.some(l=>l.points[0].x===0&&l.points[0].y===-1800&&l.points[1].x===6000&&l.points[1].y===-1200))
 assert.ok(lines.some(l=>l.points[0].x===6000&&l.points[0].y===-2400&&l.points[1].x===9000&&l.points[1].y===-1800))
 // 수직선표현을 켜면 열 경계 네 줄이 더 생긴다
 const withV=scheduleEntities(rows,{x:0,y:0,scale:100,verticalLines:true})
 assert.equal(withV.filter(e=>e.type==='line').length-lines.length,4)
 assert.deepEqual(withV.at(-4).points,[{x:0,y:0},{x:0,y:-2400}])
 assert.deepEqual(withV.at(-1).points,[{x:12000,y:0},{x:12000,y:-2400}])
})

test('BLS 표 검증과 켜: 문자켜·선켜를 나눠 붙이고 잘못된 값은 오류다', () => {
 const es=scheduleEntities([{symbols:['A'],size:'1x2'}],blsTableOptions(bv(),bshared))
 assert.equal(es.find(e=>e.type==='text').cardLayer,'A-TEXT')
 assert.equal(es.find(e=>e.type==='line').cardLayer,'A-SYM')
 assert.throws(()=>scheduleEntities([],{}),/넣을 보가 없습니다/)
 assert.throws(()=>scheduleEntities([{symbols:['A'],size:''}],{scale:0}),/목록표 축척/)
 assert.throws(()=>scheduleEntities([{symbols:['A'],size:''}],{lineGap:1,textHeight:2.5}),/선 간격/)
 assert.throws(()=>scheduleEntities([{symbols:['A'],size:''}],{symbolGap:0}),/문자 간격/)
})

test('BLS 등록: 저장했다 다시 쓰면 다른 도곽에도 같은 자리의 칸이 만들어진다', () => {
 const store=new Map(),storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)}
 const frame={minX:0,minY:0,maxX:1000,maxY:800}
 const first=rectOf({x:0,y:600},{x:500,y:800})
 const reg={method:'frame',kind:'block',width:1000,height:800,cell:relRect(first,{x:0,y:0}),
  symbol:relRect(rectOf({x:10,y:760},{x:490,y:790}),{x:first.minX,y:first.minY}),
  size:relRect(rectOf({x:100,y:610},{x:400,y:750}),{x:first.minX,y:first.minY})}
 saveRegistration(storage,reg)
 assert.deepEqual(loadRegistration(storage),reg)
 assert.equal(loadRegistration({getItem:()=>'{{'}),null)
 const cells=cellsFromRegistration(reg,{minX:5000,minY:0,maxX:6000,maxY:800})
 assert.equal(cells.length,8)
 assert.deepEqual(cells[0].symbol,{minX:5010,minY:760,maxX:5490,maxY:790})
 assert.deepEqual(cells[0].size,{minX:5100,minY:610,maxX:5400,maxY:750})
 assert.deepEqual(cells[2].symbol,{minX:5010,minY:560,maxX:5490,maxY:590})   // 한 칸 아래(200)
 // 개별 영역은 상자 하나가 곧 칸 하나
 const one=cellsFromRegistration({method:'cell',symbol:{x0:10,y0:160,x1:90,y1:190},size:{x0:10,y0:10,x1:90,y1:90}},
  {minX:200,minY:300,maxX:300,maxY:500})
 assert.equal(one.length,1)
 assert.deepEqual(one[0].symbol,{minX:210,minY:460,maxX:290,maxY:490})
 assert.deepEqual(absRect(relRect(frame,{x:0,y:0}),{x:0,y:0}),frame)
})

test('BLS 영역 후보: 블럭 / PLOT_BOX 켜의 폴리선 박스를 가려낸다', () => {
 const box=[{x:0,y:0},{x:100,y:0},{x:100,y:50},{x:0,y:50}]
 const es=[{type:'block',layer:'L1',name:'도곽',entities:[{type:'line',layer:'L1',points:box.slice(0,2)}]},
  {type:'polyline',layer:'L2',closed:true,points:box},
  {type:'polyline',layer:'L3',closed:true,points:box},
  {type:'polyline',layer:'L2',closed:false,points:box},
  {type:'line',layer:'L2',points:box.slice(0,2)}]
 const names=id=>({L1:'0',L2:'PLOT_BOX',L3:'A-SYM'}[id]||'')
 assert.equal(areaCandidates(es,{kindIsBlock:true}).length,1)
 assert.deepEqual(areaCandidates(es,{kindIsBlock:false,method:'frame',layerNameOf:names}),[es[1]])
 assert.equal(areaCandidates(es,{kindIsBlock:false,method:'cell',layerNameOf:names}).length,2)
 assert.deepEqual(boxOf(es[1]),{minX:0,minY:0,maxX:100,maxY:50})
})

test('BLS 평면도에 쓰기: 앞의 층표시 숫자를 빼고 견주어 기호 옆 글을 만든다', () => {
 const rows=[{symbols:['1G4A','2G3'],size:'600x900'},{symbols:['1B1'],size:''}]
 assert.equal(planSymbolKey('-2G3'),'G3')
 assert.equal(planSymbolKey('1G4A'),'G4A')
 assert.equal(planSizeFor('3G4A',rows,{between:' '}),'3G4A 600x900')
 assert.equal(planSizeFor('2G3',rows,{between:'='}),'2G3=600x900')
 assert.equal(planSizeFor('9B1',rows,{}),'')      // 크기가 공란이면 적지 않는다
 assert.equal(planSizeFor('ZZ9',rows,{}),'')
})

test('BLS 칸 기본값 넷과 미리보기·기본 설정값이 원문 대화상자와 같다', () => {
 const ks=[0,1,2,3].map(i=>bv(blsSlotDefaults(i)))
 assert.deepEqual(ks.map(k=>[k.method,k.divide,k.verticalLines]),
  [['frame','two',false],['frame','none',false],['cell','two',false],['frame','two',true]])
 const d=bv()
 assert.deepEqual([d.space,d.frameSelect,d.origin,d.order,d.tolerance,d.divide,d.method,d.kind,d.useSaved],
  ['model','screen','bl','hDown',10,'two','frame','block',false])
 assert.deepEqual([d.scale,d.textHeight,d.lineGap,d.symbolGap,d.sizeGap,d.remarkGap,d.verticalLines],
  [100,2.5,6,60,30,30,false])
 assert.deepEqual(blsTableOptions(d,bshared).textLayer,'A-TEXT')
 for(const k of ks)assert.match(blsPreviewSvg(k,bshared,{width:64,height:34,compact:true}),/^<svg /)
})
