// 난간 그리기 DHR 카드 기하 시험. 화면 없이 순수 함수만 돌린다. 기대값은 izzarder.com/94 의 대화상자·그림에서 잰 것이다.
import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeValues,defaultsOf} from './card-kit.js'
import {
 DHR_FIELDS,ANCHOR_MIN_EXTEND,railFrame,railToWorld,railToLocal,resolvedExtend,divideMax,postCenters,
 verticalBalusterCenters,railLevels,handrailMembers,buildHandrail,keepIntervals,clipLocalPath,trimByBlockers,handrailPreviewSvg,
} from './handrail-card.js'

const V=(extra={})=>normalizeValues(DHR_FIELDS,{...defaultsOf(DHR_FIELDS),...extra},'DHR 기본')
const shared={railLayer:'A-STAIR'}
const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<=tol,`${a} ≈ ${b} 아님`)
const hs=m=>m.pts.map(p=>p[1])
const kinds=(ms,k)=>ms.filter(m=>m.kind===k)
const flat=pts=>pts.map(([s,h])=>[s+0,h+0])   // -0 을 0 으로 맞춘다

test('대화상자 기본값이 원문 캡처와 같다', () => {
 const v=V()
 assert.equal(v.height,1200);assert.equal(v.capThickness,60)
 assert.equal(v.postSpacing,900);assert.equal(v.postThickness,20)
 assert.equal(v.topGap,100);assert.equal(v.topThickness,20)
 assert.equal(v.bottomGap,100);assert.equal(v.bottomThickness,20)
 assert.equal(v.baluster,'vertical');assert.equal(v.vSpacing,100);assert.equal(v.vThickness,10)
 assert.equal(v.hSpacing,100);assert.equal(v.hThickness,10);assert.equal(v.extendLength,100)
 // 2026-09-24 F19: 원문은 "가려지는 선 자르기" 기본 켬이지만 기존 벽선·폴리선이 예고 없이 잘려 나가 기본은 끔으로 둔다.
 assert.equal(v.trim,false)
})
test('기본 설정(자르기 끔)이면 난간을 기존 선 위에 그려도 기존 객체를 지우지 않는다', () => {
 const v=V()
 const r=buildHandrail({x:0,y:0},{x:2000,y:0},v,shared)
 const existing=[{id:'w',type:'line',points:[{x:-100,y:0},{x:3000,y:0}]},{id:'g',type:'line',points:[{x:1000,y:-500},{x:1000,y:2000}]}]
 const cut=v.trim?trimByBlockers(existing,r.frame,r.blockers):{removeIds:[],add:[]}
 assert.deepEqual(cut.removeIds,[])
 assert.ok(trimByBlockers(existing,r.frame,r.blockers).removeIds.length>0,'켜면 여전히 잘린다')
})

test('등분: 입력 간격을 최대값으로 나눈다 · 원문 안목간격 88.89 를 그대로 낸다', () => {
 // 엄지기둥 간격 900, 두께 20 → 안쪽 순거리 880, 수직살 두께 10, 입력 간격 100
 const d=divideMax(880,10,100)
 assert.equal(d.n,9);assert.equal(d.count,8)
 near(d.pitch,890/9);near(d.gap,800/9)          // 안목간격 88.888… → 대화상자 표시 88.89
 assert.equal(d.gap.toFixed(2),'88.89')
 assert.ok(d.pitch<=100+1e-9,'중심선 간격은 입력값 이하여야 한다')
 near(d.centers[0],890/9-5)                      // 첫 살 중심 = pitch - 두께/2
 assert.equal(d.centers.length,8)
 // 딱 나누어떨어지면 칸 수가 늘지 않는다
 assert.equal(divideMax(890,10,100).n,9)
 assert.equal(divideMax(990,10,100).n,10)
 assert.deepEqual(divideMax(0,10,100).centers,[])
})

test('엄지기둥: 등분 없이 절대 간격으로 놓이고 남는 거리는 양 끝에 반씩', () => {
 // 원문 [하부연장] 그림에서 잰 값: 폭 약 1786, 간격 900 → 기둥 2개가 443 / 1343
 assert.deepEqual(postCenters(1786,900,20),[443,1343])
 const c=postCenters(2700,900,20)
 assert.deepEqual(c,[0,900,1800,2700])           // 딱 떨어지면 양 끝에도 선다
 near(c[1]-c[0],900)
 assert.deepEqual(postCenters(600,900,20),[300]) // 간격보다 짧으면 가운데 하나
 assert.deepEqual(postCenters(1786,0,20),[])
})

test('수직살 + 엄지기둥: 기둥 사이 등분 간격을 난간 전체에 이어 쓴다 (원문 그림과 같은 16개)', () => {
 const v=V(),posts=postCenters(1786,900,20)
 const r=verticalBalusterCenters(1786,v,posts,20)
 assert.equal(r.centers.length,16)               // 원문 그림: 왼쪽 4 + 기둥 사이 8 + 오른쪽 4
 assert.equal(r.gap.toFixed(2),'88.89')
 near(r.pitch,890/9)
 const first=r.centers[0],last=r.centers.at(-1)
 near(r.centers[3],443-(10+800/9+5),1e-3)        // 왼쪽 기둥 바로 옆 살 = 기둥면에서 안목간격만큼 띄운 자리 (중심은 0.001 로 반올림해 둔다)
 near(first,443-(10+800/9+5)-3*(890/9),1e-3)      // 거기서 같은 간격으로 이어 나간 왼쪽 끝 살 (원문 그림의 42.4)
 assert.equal(first.toFixed(1),'42.4')
 assert.ok(first-5>=0,'살이 난간 밖으로 나가면 안 된다')
 assert.ok(last+5<=1786)
 near(first,1786-last,1e-3)                      // 기둥이 가운데 있으므로 좌우가 대칭이다
 // 기둥 사이에는 정확히 8개가 들어가고 기둥과 겹치지 않는다
 const mid=r.centers.filter(c=>c>443&&c<1343)
 assert.equal(mid.length,8)
 for(const c of r.centers)for(const p of posts)assert.ok(Math.abs(c-p)>=10+5-1e-6,'기둥과 겹쳤다')
 for(let i=1;i<mid.length;i++)near(mid[i]-mid[i-1],890/9,1e-3)
})

test('수직살 + 엄지기둥 없음: 입력 간격 그대로, 남는 거리는 양 끝에 반씩', () => {
 const v=V({post:false,vSpacing:100,vThickness:10})
 const r=verticalBalusterCenters(1000,v,[],0)
 assert.equal(r.pitch,100)
 for(let i=1;i<r.centers.length;i++)near(r.centers[i]-r.centers[i-1],100)
 const leftMargin=r.centers[0]-5,rightMargin=1000-(r.centers.at(-1)+5)
 near(leftMargin,rightMargin)                    // 양 끝 여백이 같다
 assert.equal(r.centers.length,10)               // (10-1)*100+10 = 910 ≤ 1000, 11개는 못 들어간다
 near(leftMargin,(1000-910)/2)
})

test('높이: 손스침 아랫면 · 상부 칸(손스침 아랫면 기준) · 하부 칸(기준선 기준)', () => {
 const lv=railLevels(V())
 assert.equal(lv.capTop,1200);assert.equal(lv.capBottom,1140)   // 1200 - 손스침 60
 assert.equal(lv.single,false)
 near(lv.top.c,1040);near(lv.top.lo,1030);near(lv.top.hi,1050)  // 손스침 아랫면에서 100 아래가 중심
 near(lv.bottom.c,100);near(lv.bottom.lo,90);near(lv.bottom.hi,110) // 기준선에서 100 위가 중심
 near(lv.inTop,1030);near(lv.inBottom,110)
 // 손스침 두께 1 이면 한 선
 const one=railLevels(V({capThickness:1}))
 assert.equal(one.single,true);assert.equal(one.capBottom,1200)
 // 칸을 끄면 안쪽 거리가 손스침 아랫면 ~ 기준선이 된다
 const off=railLevels(V({topRail:false,bottomRail:false}))
 near(off.inTop,1140);near(off.inBottom,0)
 assert.throws(()=>railLevels(V({capThickness:2000})),/손스침 두께/)
 assert.throws(()=>railLevels(V({topGap:1200})),/상부 칸/)
})

test('하부연장 · 앵커고정: 앵커를 켜면 130 미만이 130 으로 바뀐다', () => {
 assert.equal(resolvedExtend(V()),100)
 assert.equal(resolvedExtend(V({extend:false})),0)
 assert.equal(resolvedExtend(V({anchor:true})),ANCHOR_MIN_EXTEND)      // 100 → 130
 assert.equal(resolvedExtend(V({anchor:true,extendLength:400})),400)
 assert.equal(resolvedExtend(V({post:false,anchor:true})),100)         // 기둥이 없으면 앵커는 없는 것으로 본다
 assert.equal(resolvedExtend(V({anchor:true,extend:false})),ANCHOR_MIN_EXTEND)
})

test('손스침 두께 1 이면 손스침을 한 선으로만 그리고 가리지 않는다', () => {
 const one=handrailMembers(1786,V({capThickness:1,trim:true}))
 const cap=kinds(one.members,'cap')
 assert.equal(cap.length,1)
 assert.deepEqual(hs(cap[0]),[1200,1200])
 assert.equal(one.blockers.filter(b=>b.s0===0&&b.s1===1786).length,0) // 띠가 아니므로 가림 상자가 없다
 const two=handrailMembers(1786,V())
 assert.equal(two.blockers.length,3)                                   // 손스침 1 + 엄지기둥 2
 assert.deepEqual(two.blockers[0],{s0:0,s1:1786,h0:1140,h1:1200})
})

test('엄지기둥 기하: 손스침 아랫면에서 기준선 아래 연장길이까지', () => {
 const m=handrailMembers(1786,V())
 const posts=kinds(m.members,'post')
 assert.equal(posts.length,2)
 assert.deepEqual(flat(posts[0].pts),[[433,1140],[433,-100],[453,-100],[453,1140]]) // 443 ± 10, 위는 손스침 밑, 아래는 -100
 assert.deepEqual(m.blockers[1],{s0:433,s1:453,h0:-100,h1:1140})
 const noExt=handrailMembers(1786,V({extend:false}))
 assert.deepEqual(flat(kinds(noExt.members,'post')[0].pts),[[433,1140],[433,0],[453,0],[453,1140]])
})

test('수직살 아래 끝: 기둥이 있으면 기준선까지, 기둥이 없으면 살 자체가 아래로 연장된다', () => {
 // 원문: 엄지기둥 있음 + 하부칸 없음 → 살은 기준선(0)에서 멈추고 기둥만 내려간다
 const a=handrailMembers(1786,V({bottomRail:false}))
 const ba=kinds(a.members,'baluster')
 assert.ok(ba.length>0)
 near(hs(ba[0])[1],0)
 near(kinds(a.members,'post')[0].pts[1][1],-100)
 // 원문: 엄지기둥·하부칸 모두 없음 → 세로살 자체가 하부로 연장된다
 const b=handrailMembers(1786,V({post:false,bottomRail:false}))
 near(hs(kinds(b.members,'baluster')[0])[1],-100)
 near(hs(kinds(b.members,'baluster')[0])[0],1030)  // 위는 상부 칸 아랫면
 assert.equal(kinds(b.members,'post').length,0)
})

test('수평살: 상·하부 칸 유무를 따진 안쪽 거리를 입력값 이하로 등분한다', () => {
 const v=V({baluster:'horizontal',hSpacing:100,hThickness:10})
 const m=handrailMembers(1786,v)
 const span=1030-110                       // 상부 칸 아랫면 ~ 하부 칸 윗면
 const d=divideMax(span,10,100)
 assert.equal(m.info.balusters,d.count)
 assert.ok(d.pitch<=100+1e-9)
 assert.ok(d.gap<=100)
 for(const y of m.info.balusterCenters){assert.ok(y>110&&y<1030,'살이 칸 사이를 벗어났다')}
 // 칸을 끄면 손스침 아랫면 ~ 기준선 전체를 등분한다
 const wide=handrailMembers(1786,V({baluster:'horizontal',topRail:false,bottomRail:false}))
 assert.equal(wide.info.balusters,divideMax(1140,10,100).count)
 // 없음
 assert.equal(handrailMembers(1786,V({baluster:'none'})).info.balusters,0)
})

test('양끝 막음: 손스침·상부 칸·하부 칸·수평살의 끝을 막거나 연다', () => {
 const on=handrailMembers(1786,V({baluster:'horizontal'}))
 const capOn=kinds(on.members,'cap')[0]
 assert.equal(capOn.closed,true)                                   // 손스침이 닫힌 사각형
 const topOn=kinds(on.members,'toprail')
 assert.equal(topOn.length,4)                                      // 선 2 + 양끝 막음 2
 assert.deepEqual(topOn[2].pts,[[0,1030],[0,1050]])
 assert.deepEqual(topOn[3].pts,[[1786,1030],[1786,1050]])
 const off=handrailMembers(1786,V({baluster:'horizontal',closeEnds:false}))
 assert.equal(kinds(off.members,'cap').length,2)                   // 열린 두 선
 assert.equal(kinds(off.members,'cap')[0].closed,false)
 assert.equal(kinds(off.members,'toprail').length,2)
 assert.equal(kinds(off.members,'bottomrail').length,2)
 // 수평살도 같이 막힌다
 const barsOn=kinds(on.members,'baluster').length,barsOff=kinds(off.members,'baluster').length
 assert.equal(barsOn,barsOff*2)
})

test('가려지는 선 자르기: 기둥 띠 안쪽만 빠지고 경계선은 남는다', () => {
 const rects=[{s0:433,s1:453,h0:-100,h1:1140}]
 // 기둥을 가로지르는 선 → 두 조각
 assert.deepEqual(keepIntervals({s:0,h:500},{s:1000,h:500},rects).map(k=>k.map(t=>Math.round(t*1000)/1000)),[[0,0.433],[0.453,1]])
 // 기둥 위(손스침 아랫면 위)는 안 잘린다
 assert.deepEqual(keepIntervals({s:0,h:1200},{s:1000,h:1200},rects),[[0,1]])
 // 기둥 옆은 그대로
 assert.deepEqual(keepIntervals({s:0,h:500},{s:400,h:500},rects),[[0,1]])
 // 완전히 가려지면 아무것도 안 남는다
 assert.deepEqual(keepIntervals({s:435,h:0},{s:450,h:900},rects),[])
 const pieces=clipLocalPath([[0,0],[1786,0]],false,rects)
 assert.equal(pieces.length,2)
 near(pieces[0].pts[1][0],433);near(pieces[1].pts[0][0],453)
})

test('난간 자신의 기준선·칸도 기둥에서 잘리고, 손스침·기둥은 잘리지 않는다', () => {
 const p1={x:0,y:0},p2={x:1786,y:0}
 const cut=buildHandrail(p1,p2,V({trim:true}),shared)   // 2026-09-24 F19: 기본은 끔이라 명시적으로 켠다
 const keep=buildHandrail(p1,p2,V({trim:false}),shared)
 // 자르기를 켜면 선 개수가 늘어난다(기준선·상부칸·하부칸이 기둥 2개에서 3토막)
 assert.ok(cut.entities.length>keep.entities.length)
 const baseKeep=keep.entities.filter(e=>e.type==='line'&&e.points.every(p=>Math.abs(p.y)<1e-9))
 const baseCut=cut.entities.filter(e=>e.type==='line'&&e.points.every(p=>Math.abs(p.y)<1e-9))
 assert.equal(baseKeep.length,1)
 assert.equal(baseCut.length,3)                                   // 기둥 2개에서 세 토막
 near(baseCut[0].points[1].x,433);near(baseCut[1].points[0].x,453)
 // 손스침은 자르기를 켜도 닫힌 사각형 그대로 남는다
 const caps=cut.entities.filter(e=>e.type==='polyline'&&e.closed&&e.points.some(p=>Math.abs(p.y-1200)<1e-9))
 assert.equal(caps.length,1)
 assert.equal(caps[0].points.length,4)
})

test('이미 그려진 선 자르기: 손스침·기둥에 가려지는 구간만 빠진다', () => {
 const f=railFrame({x:0,y:0},{x:1786,y:0})
 const m=handrailMembers(1786,V())
 const ents=[
  {id:'a',type:'line',layer:'L1',points:[{x:0,y:1170},{x:1786,y:1170}]},   // 손스침 안을 지나는 선
  {id:'b',type:'line',layer:'L1',points:[{x:0,y:500},{x:1786,y:500}]},     // 기둥 2개를 지나는 선
  {id:'c',type:'line',layer:'L1',points:[{x:0,y:-500},{x:1786,y:-500}]},   // 아무것도 안 걸리는 선
  {id:'d',type:'circle',layer:'L1',center:{x:443,y:500},radius:50},        // 선이 아닌 것은 손대지 않는다
 ]
 const r=trimByBlockers(ents,f,m.blockers)
 assert.deepEqual(r.removeIds.sort(),['a','b'])
 const a=r.add.filter(e=>e.layer==='L1'&&e.points.every(p=>Math.abs(p.y-1170)<1e-9))
 assert.equal(a.length,0)                                          // 손스침이 전부 가린다
 const b=r.add.filter(e=>e.points.every(p=>Math.abs(p.y-500)<1e-9))
 assert.equal(b.length,3)                                          // 기둥 2개에서 세 토막
 near(b[0].points[1].x,433);near(b[1].points[0].x,453);near(b[1].points[1].x,1333);near(b[2].points[0].x,1353)
 assert.equal(b[0].layer,'L1')
 assert.deepEqual(trimByBlockers(ents,f,[]),{removeIds:[],add:[]})
})

test('앵커고정: 기둥마다 판과 볼트 4개가 기준선 아래에 붙는다', () => {
 const m=handrailMembers(1786,V({anchor:true}))
 const an=kinds(m.members,'anchor')
 assert.equal(an.length,10)                                        // 기둥 2개 × (판 1 + 볼트 4)
 const plate=an.find(x=>x.closed)
 assert.deepEqual(plate.pts,[[388,-25],[498,-25],[498,-130],[388,-130]]) // 443 ± (10+45), 130 은 앵커 최소 하부연장
 const bolts=an.filter(x=>x.circleRadius)
 assert.equal(bolts.length,8)
 for(const b of bolts)assert.ok(b.pts[0][1]<-25&&b.pts[0][1]>-130,'볼트가 판 밖에 있다')
 assert.equal(handrailMembers(1786,V({post:false,anchor:true})).members.filter(x=>x.kind==='anchor').length,0)
})

test('두 점 좌표계: 어느 쪽으로 찍어도 난간은 위로 서고, 기울어도 두 점을 잇는다', () => {
 const left=buildHandrail({x:0,y:0},{x:2000,y:0},V(),shared)
 const right=buildHandrail({x:2000,y:0},{x:0,y:0},V(),shared)
 const topY=e=>Math.max(...e.entities.flatMap(x=>x.points?x.points.map(p=>p.y):[x.center.y]))
 near(topY(left),1200);near(topY(right),1200)                      // 반대로 찍어도 위로 선다
 near(left.frame.width,2000);near(right.frame.width,2000)
 // 기울어진 기준선: 두 점이 난간 아랫변 양 끝이다
 const f=railFrame({x:100,y:100},{x:1100,y:1100})
 near(f.width,Math.hypot(1000,1000))
 const p=railToWorld(f,0,0);near(p.x,100);near(p.y,100)
 const q=railToWorld(f,f.width,0);near(q.x,1100);near(q.y,1100)
 const l=railToLocal(f,{x:1100,y:1100});near(l.s,f.width);near(l.h,0,1e-9)
 assert.ok(railToWorld(f,0,1200).y>100,'높이는 기준선 위쪽으로 잡힌다')
 assert.throws(()=>railFrame({x:0,y:0},{x:0,y:0}),/서로 다른 점/)
})

test('미리보기 SVG 와 잘못된 값 안내', () => {
 const svg=handrailPreviewSvg(V(),shared,{width:300,height:150})
 assert.ok(svg.startsWith('<svg'));assert.ok(svg.includes('안목간격'))
 assert.ok(handrailPreviewSvg(V(),shared,{width:64,height:34,compact:true}).includes('<svg'))
 assert.ok(handrailPreviewSvg(V({capThickness:5000}),shared,{}).includes('손스침 두께'))
 assert.throws(()=>handrailMembers(0,V()),/두 점/)
})
