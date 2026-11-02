import {test} from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {DrawingEngine} from './engine.js';
import {MERGE_TOLERANCE_PCT,parcelGroups,sharedEdgeLengthM,ledgerMismatch,mergeCandidates,mergeRings,mergedSiteEntity,mergeSiteCommand,mergeFetchedEntities} from './site-merge.js';

const A='2611010100102130017',B='2611010100102130018',C='2611010100102130019';
const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const parcel=(pnu,jibun,role,points,attributes={})=>({type:'polyline',closed:true,points,parcelRole:role,attributes:{pnu,jibun,ring:'outer',polygon:0,...attributes}});
const sample=()=>[parcel(A,'213-17','site',rect(0,0,13525,10000)),parcel(B,'213-18','neighbor',rect(13525,0,8770,10000))];
const unionRing=[[0,0],[22295,0],[22295,10000],[0,10000]];
const near=(actual,expected,eps=1e-9)=>assert.ok(Math.abs(actual-expected)<eps,`${actual} ≈ ${expected}`);
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const v of Object.values(value))freeze(v);}return value;};

test('사리로 64-1: 213-17과 213-18의 합을 첫 후보로 제안한다',()=>{
 const r=mergeCandidates(sample(),{ledgerM2:222});
 assert.equal(MERGE_TOLERANCE_PCT,3);assert.deepEqual(r.sitePnus,[A]);assert.equal(r.siteAreaM2,135.25);
 assert.equal(r.ledgerM2,222);assert.equal(r.mismatch,true);near(r.diffPct,(135.25-222)/222*100);
 assert.deepEqual(r.candidates,[{pnus:[B],parcels:[{pnu:B,jibun:'213-18',areaM2:87.7}],areaM2:222.95,diffPct:(222.95-222)/222*100}]);
 near(r.candidates[0].diffPct,0.4279279279279228);assert.deepEqual(r.skipped,[]);
});
test('공유 변의 중간 꼭짓점·역방향·중복 닫는 점을 처리한다',()=>{
 const entities=sample(),b=entities[1].points;
 b.push({x:13525,y:5000});b.push({...b[0]});
 near(sharedEdgeLengthM(entities[0].points,b),10);
 near(sharedEdgeLengthM(b,entities[0].points),10);
 near(sharedEdgeLengthM(entities[0].points,[...b].reverse()),10);
 assert.deepEqual(mergeCandidates(entities,{ledgerM2:222}).candidates[0].pnus,[B]);
});
test('공유 경계는 일부 투영 구간과 명시적 50mm 허용값을 적용한다',()=>{
 const a=rect(0,0,10000,10000);
 near(sharedEdgeLengthM(a,rect(10040,2500,1000,5000),50),5);
 assert.equal(sharedEdgeLengthM(a,rect(10051,2500,1000,5000)),0);
 assert.equal(sharedEdgeLengthM(a,rect(10040,2500,1000,5000),0),0);
 // 짧은 비스듬한 변의 근접 구간은 500mm 연결 기준에 못 미친다.
 assert.ok(sharedEdgeLengthM([{x:0,y:0},{x:40,y:0},{x:20,y:-1000}],[{x:20,y:0},{x:20,y:40},{x:1000,y:20}])<0.5);
});
test('대장 136㎡는 불일치가 아니므로 제안하지 않는다',()=>{
 const r=mergeCandidates(sample(),{ledgerM2:136});
 assert.equal(r.mismatch,false);assert.deepEqual(r.candidates,[]);
});
test('대장이 없거나 0 이하이면 불일치·차이를 계산하지 않는다',()=>{
 for(const ledgerM2 of [undefined,null,0,-1,NaN,Infinity]){
  assert.deepEqual(ledgerMismatch(135.25,ledgerM2),{mismatch:false,diffPct:null});
  assert.deepEqual(mergeCandidates(sample(),{ledgerM2}).candidates,[]);
 }
 assert.deepEqual(ledgerMismatch(103,100),{mismatch:false,diffPct:3});
 assert.deepEqual(ledgerMismatch(97,100),{mismatch:false,diffPct:-3});
 assert.equal(ledgerMismatch(103.01,100).mismatch,true);
 assert.equal(ledgerMismatch(103,100,2).mismatch,true);
});
test('0.5m 떨어지거나 모서리 한 점만 닿은 필지는 제외한다',()=>{
 for(const points of [rect(14025,0,8770,10000),rect(13525,10000,8770,10000)]){
  const entities=sample();entities[1].points=points;
  assert.equal(sharedEdgeLengthM(entities[0].points,points),0);
  assert.deepEqual(mergeCandidates(entities,{ledgerM2:222}).candidates,[]);
  assert.deepEqual(mergeCandidates(entities,{ledgerM2:222,minSharedM:0}).candidates,[]);
 }
});
test('대지→B→C의 연결된 조합을 찾고 C 단독은 제안하지 않는다',()=>{
 const entities=[parcel(A,'A','site',rect(0,0,10000,10000)),parcel(B,'B','neighbor',rect(10000,0,5000,10000)),parcel(C,'C','neighbor',rect(15000,0,5000,10000))];
 const r=mergeCandidates(entities,{ledgerM2:200});
 assert.deepEqual(r.candidates.map(c=>c.pnus),[[B,C]]);assert.equal(r.candidates[0].areaM2,200);
 assert.deepEqual(mergeCandidates(entities,{ledgerM2:200,maxExtra:1}).candidates,[]);
 assert.deepEqual(mergeCandidates(entities,{ledgerM2:150}).candidates.map(c=>c.pnus),[[B]]);
});
test('잘린 고리가 하나라도 있으면 필지 전체를 제외하고 도로·레이블은 무시한다',()=>{
 const entities=sample();entities[1].attributes.clippedToContext=true;
 entities.push(parcel(C,'도로','road',rect(0,10000,8770,10000)),{...entities[1],parcelRole:'label'});
 const r=mergeCandidates(entities,{ledgerM2:222});
 assert.deepEqual(r.candidates,[]);assert.equal(r.skipped.length,1);assert.equal(r.skipped[0].pnu,B);
 assert.equal(r.skipped[0].jibun,'213-18');assert.match(r.skipped[0].reason,/잘린/);
 const multi=sample();multi.push(parcel(B,'213-18','neighbor',rect(14000,1000,100,100),{ring:'hole',clippedToContext:true}));
 assert.equal(mergeCandidates(multi,{ledgerM2:222}).skipped[0].pnu,B);
});
test('여러 다각형·역방향 고리·구멍을 PNU별로 합산한다',()=>{
 const entities=sample(),hole=parcel(B,'213-18','neighbor',rect(14525,1000,1000,1000),{ring:'hole'});
 hole.points.reverse();entities.push(hole,parcel(B,'213-18','neighbor',rect(50000,0,2000,1000),{polygon:1}));
 entities.push({...entities[0],attributes:{}},{...entities[0],closed:false},{...entities[0],type:'text'});
 const groups=parcelGroups(entities),g=groups.get(B);
 assert.equal(groups.size,2);near(g.areaM2,88.7);assert.equal(g.rings.length,3);
 assert.equal(g.rings[1].hole,true);assert.equal(g.rings[1].entity,hole);assert.equal(g.clipped,false);
 assert.equal(g.role,'neighbor');assert.equal(groups.get(A).role,'site');
 const r=mergeCandidates(entities,{ledgerM2:223.95});assert.deepEqual(r.candidates,[]);
});
test('이미 여러 대지 필지이면 면적과 PNU를 모두 포함한다',()=>{
 const entities=sample();entities[1].parcelRole='site';
 entities.push(parcel(C,'213-19','neighbor',rect(22295,0,1000,10000)));
 const r=mergeCandidates(entities,{ledgerM2:232.95});
 assert.deepEqual(r.sitePnus,[A,B]);near(r.siteAreaM2,222.95);assert.deepEqual(r.candidates[0].pnus,[C]);
});
test('여러 기존 대지가 떨어져 있으면 전체를 연결하는 조합만 제안한다',()=>{
 const entities=[parcel(A,'A','site',rect(0,0,10000,10000)),parcel(C,'C','site',rect(20000,0,10000,10000)),parcel(B,'B','neighbor',rect(10000,0,10000,10000))];
 assert.deepEqual(mergeCandidates(entities,{ledgerM2:300}).candidates[0].pnus,[B]);
 entities[1].points=rect(30000,0,10000,10000);
 assert.deepEqual(mergeCandidates(entities,{ledgerM2:300}).candidates,[]);
});
test('오차 절댓값이 작을수록 먼저 정렬한다',()=>{
 const entities=sample();entities.push(parcel(C,'213-19','neighbor',rect(0,10000,8900,10000)));
 const r=mergeCandidates(entities,{ledgerM2:223});
 assert.deepEqual(r.candidates.map(c=>c.pnus),[[B],[C]]);
 assert.equal(mergeCandidates(entities,{ledgerM2:223,limit:1}).candidates.length,1);
 assert.deepEqual(mergeCandidates(entities,{ledgerM2:223,tolerancePct:0}).candidates,[]);
});
test('같은 오차이면 필지 수가 적은 순이고 같은 조합은 중복하지 않는다',()=>{
 const entities=[parcel(A,'A','site',rect(0,0,10000,10000)),parcel(B,'B','neighbor',rect(10000,0,1000,10000)),parcel(C,'C','neighbor',rect(0,10000,10000,400)),parcel('D','D','neighbor',rect(0,10400,10000,600))];
 assert.deepEqual(mergeCandidates(entities,{ledgerM2:110}).candidates.map(c=>c.pnus),[[B],[C,'D']]);
 const grid=[parcel(A,'A','site',rect(0,0,1000,1000)),parcel(B,'B','neighbor',rect(1000,0,1000,1000)),parcel(C,'C','neighbor',rect(0,1000,1000,1000)),parcel('D','D','neighbor',rect(1000,1000,1000,1000))];
 const r=mergeCandidates(grid,{ledgerM2:4});
 assert.equal(r.candidates.length,1);assert.equal(new Set(r.candidates[0].pnus).size,3);
});
test('풀은 입력 순서보다 그래프 거리가 가까운 필지를 우선한다',()=>{
 const entities=[parcel(A,'A','site',rect(0,0,1000,1000)),parcel(C,'C','neighbor',rect(2000,0,1000,1000)),parcel(B,'B','neighbor',rect(1000,0,1000,1000))];
 assert.deepEqual(mergeCandidates(entities,{ledgerM2:2,maxPool:1}).candidates[0].pnus,[B]);
 assert.deepEqual(mergeCandidates(entities,{ledgerM2:3,maxPool:1}).candidates,[]);
 for(const options of [{maxPool:0},{maxExtra:0},{limit:0},{minSharedM:2}])
  assert.deepEqual(mergeCandidates(entities,{ledgerM2:2,...options}).candidates,[]);
 assert.deepEqual(mergeCandidates(sample(),{ledgerM2:100}).candidates,[]);
});
test('30개 이웃 격자에서 1초 안에 탐색하고 limit을 지킨다',()=>{
 const entities=[parcel(A,'A','site',rect(0,0,1000,1000))];
 for(let y=0;y<5;y++)for(let x=0;x<6;x++)entities.push(parcel(`grid-${x}-${y}`,`${x}-${y}`,'neighbor',rect((x+1)*1000,y*1000,1000,1000)));
 const start=performance.now(),r=mergeCandidates(entities,{ledgerM2:4,limit:2}),elapsed=performance.now()-start;
 assert.ok(elapsed<1000,`탐색 ${elapsed}ms`);assert.ok(r.candidates.length>0&&r.candidates.length<=2);
 assert.ok(r.candidates.every(c=>c.pnus.length<=3));
});
test('mergeRings는 다각형·contextPart별 바깥 고리와 구멍을 mm 좌표로 묶는다',()=>{
 const entities=sample();
 entities.push(parcel(B,'213-18','neighbor',rect(14525,1000,1000,1000),{ring:'hole'}));
 entities.push(parcel(B,'213-18','neighbor',rect(30000,0,2000,2000),{polygon:1}));
 entities.push(parcel(B,'213-18','neighbor',rect(34000,0,2000,2000),{polygon:1,contextPart:1}));
 entities.push(parcel(B,'213-18','neighbor',rect(34500,500,500,500),{polygon:1,contextPart:1,ring:'hole'}));
 const rings=mergeRings(freeze(entities),[A,B,B]);
 assert.equal(rings.length,4);assert.deepEqual(rings.map(r=>r.pnu),[A,B,B,B]);
 assert.deepEqual(rings[0].outer,[[0,0],[13525,0],[13525,10000],[0,10000]]);
 assert.deepEqual(rings[1].holes,[[[14525,1000],[15525,1000],[15525,2000],[14525,2000]]]);
 assert.equal(rings[2].holes.length,0);assert.equal(rings[3].holes.length,1);
 assert.equal(mergeRings(entities,[B]).length,3);
});
test('mergedSiteEntity는 첫 대지 속성·지번을 복사하고 조회 범위와 ID를 제거한다',()=>{
 const entities=sample();entities[0].id='site-id';entities[0].layer='site-layer';
 Object.assign(entities[0].attributes,{id:'attr-id',layer:'attr-layer',contextPart:1,clippedToContext:true,sourceCRS:'EPSG:5187',originMetres:[1,2],northVector:[0,1],landInfo:{name:'대'}});
 const merged=mergedSiteEntity(freeze(entities),{pnus:[B,A,B],ring:freeze(unionRing),ledgerM2:222,now:()=>'검증 시각'});
 assert.equal(merged.type,'polyline');assert.equal(merged.closed,true);assert.equal(merged.parcelRole,'site');
 assert.deepEqual(merged.points,unionRing.map(([x,y])=>({x,y})));assert.equal(merged.id,undefined);assert.equal(merged.layer,undefined);
 const a=merged.attributes;assert.equal(a.pnu,A);assert.equal(a.jibun,'213-17 외 1필지');
 assert.deepEqual(a.sitePnus,[A,B]);assert.deepEqual(a.siteJibuns,['213-17','213-18']);
 assert.equal(a.ring,'outer');assert.equal(a.polygon,0);assert.equal(a.ledgerAreaM2,222);assert.equal(a.mergedSite,true);assert.equal(a.mergedAt,'검증 시각');
 for(const key of ['id','layer','contextPart','clippedToContext'])assert.equal(key in a,false);
 assert.equal(a.sourceCRS,'EPSG:5187');assert.deepEqual(a.originMetres,[1,2]);assert.deepEqual(a.northVector,[0,1]);
 a.landInfo.name='변경';assert.equal(entities[0].attributes.landInfo.name,'대');
 const defaulted=mergedSiteEntity(entities,{pnus:[B],ring:unionRing});assert.equal(defaulted.attributes.ledgerAreaM2,null);assert.ok(Number.isFinite(Date.parse(defaulted.attributes.mergedAt)));
});
test('mergeSiteCommand는 모든 대상 고리를 이웃 레이어로 보관하는 batch 하나를 만든다',()=>{
 const entities=sample();entities.push(parcel(B,'213-18','neighbor',rect(14525,1000,1000,1000),{ring:'hole'}));
 entities.forEach((e,i)=>{e.id=`id-${i}`;e.layer=i?'neighbor-layer':'site-layer';});
 const cmd=mergeSiteCommand(freeze(entities),{pnus:[B],ring:unionRing,ledgerM2:222,now:()=>'now'});
 assert.equal(cmd.type,'batch');assert.equal(cmd.commands.length,2);
 assert.deepEqual(cmd.commands[0],{type:'updateMany',updates:entities.map(e=>({id:e.id,changes:{parcelRole:'site-original',layer:'neighbor-layer'}}))});
 assert.equal(cmd.commands[1].type,'parcel.import');assert.equal(cmd.commands[1].entities.length,1);
 assert.deepEqual(cmd.commands[1].entities[0].attributes.sitePnus,[A,B]);assert.equal(cmd.commands[1].entities[0].attributes.jibun,'213-17 외 1필지');
});
test('실제 도면 엔진에서 병합 후 Ctrl+Z 한 번으로 전체를 복원한다',()=>{
 const engine=new DrawingEngine();engine.execute({type:'parcel.import',entities:sample(),drawOptions:{neighbors:true}});
 const before=structuredClone(engine.doc),command=mergeSiteCommand(engine.doc.entities,{pnus:[B],ring:unionRing,ledgerM2:222});
 engine.execute(command);assert.equal(engine.doc.entities.length,3);
 assert.equal(engine.doc.entities.filter(e=>e.parcelRole==='site').length,1);
 const neighborLayer=before.entities[1].layer;
 assert.ok(engine.doc.entities.filter(e=>e.parcelRole==='site-original').every(e=>e.layer===neighborLayer));
 engine.execute({type:'undo'});assert.deepEqual(engine.doc,before);
});
test('mergeFetchedEntities는 원본을 보존하고 대상 고리만 복사한다',()=>{
 const entities=sample();entities.push(parcel(C,'213-19','neighbor',rect(50000,0,1000,1000)),{type:'text',parcelRole:'label',attributes:{pnu:A}});
 const before=structuredClone(entities),out=mergeFetchedEntities(freeze(entities),{pnus:[B],ring:unionRing,ledgerM2:222});
 assert.deepEqual(entities,before);assert.notEqual(out,entities);assert.equal(out.length,entities.length+1);
 assert.equal(out[0].parcelRole,'site');assert.deepEqual(out[0].attributes.sitePnus,[A,B]);
 for(let i=0;i<2;i++){assert.notEqual(out[i+1],entities[i]);assert.equal(out[i+1].parcelRole,'site-original');}
 assert.equal(out[3],entities[2]);assert.equal(out[4],entities[3]);
});
test('잘못된 대지·PNU·짧은 고리·도면 ID는 한국어 Error를 낸다',()=>{
 const entities=sample(),options={pnus:[B],ring:unionRing};
 const korean=/[가-힣]/;
 assert.throws(()=>mergeCandidates([entities[1]],{ledgerM2:222}),korean);
 for(const fn of [()=>mergeRings(entities,['없는 PNU']),()=>mergedSiteEntity(entities,{...options,pnus:['없는 PNU']}),
  ()=>mergeFetchedEntities(entities,{...options,pnus:['없는 PNU']}),()=>mergedSiteEntity([entities[1]],options),
  ()=>mergedSiteEntity(entities,{...options,ring:[[0,0],[1,1]]}),()=>sharedEdgeLengthM([],entities[0].points),
  ()=>parcelGroups([{...entities[0],points:[{x:0,y:0},{x:1,y:1}]}]),()=>mergeSiteCommand(entities,options)])assert.throws(fn,korean);
 const partial=sample();partial[1].id='neighbor-id';partial[1].layer='neighbor-layer';
 assert.throws(()=>mergeSiteCommand(partial,options),korean);
});

// 작업 D 회귀: 기울기·거리·조각 연결·탐색 상한.
test('3~6mm 기울어진 공유 변은 양방향에서 같은 길이와 후보를 얻는다',()=>{
 const a=rect(0,0,10000,10000),b=[{x:10003,y:0},{x:20003,y:0},{x:20006,y:1000},{x:10006,y:1000}];
 assert.ok(sharedEdgeLengthM(a,b)>=1);near(sharedEdgeLengthM(a,b),sharedEdgeLengthM(b,a));
 assert.deepEqual(mergeCandidates([parcel(A,'A','site',a),parcel(B,'B','neighbor',b)],{ledgerM2:110}).candidates[0]?.pnus,[B]);
});
test('기본 SNAP_MM은 20이고 45mm 틈은 연결 후보가 아니다',async()=>{
 const {SNAP_MM}=await import('./site-merge.js');assert.equal(SNAP_MM,20);
 const entities=[parcel(A,'A','site',rect(0,0,10000,10000)),parcel(B,'B','neighbor',rect(10045,0,10000,10000))];
 assert.equal(sharedEdgeLengthM(entities[0].points,entities[1].points),0);
 assert.deepEqual(mergeCandidates(entities,{ledgerM2:200}).candidates,[]);
});
test('PNU 일부만 닿고 다른 polygon이 떨어진 필지는 제안하지 않는다',()=>{
 const entities=[parcel(A,'A','site',rect(0,0,10000,10000)),parcel(B,'B','neighbor',rect(10000,0,5000,10000)),parcel(B,'B','neighbor',rect(100000,0,5000,10000),{polygon:1})];
 assert.deepEqual(mergeCandidates(entities,{ledgerM2:200}).candidates,[]);
 // 다른 필지가 모든 조각을 이어 주면 허용한다.
 entities[2].points=rect(20000,0,5000,10000);entities.push(parcel(C,'C','neighbor',rect(15000,0,5000,10000)));
 assert.deepEqual(mergeCandidates(entities,{ledgerM2:250}).candidates[0]?.pnus,[B,C]);
});
test('24개 격자에서 maxExtra=24도 200ms 이내이며 추가 필지는 최대 5개',()=>{
 const entities=[parcel(A,'A','site',rect(0,0,1000,1000))];
 for(let y=0;y<5;y++)for(let x=0;x<5;x++)if(x||y)entities.push(parcel('g'+x+'-'+y,'g','neighbor',rect(x*1000,y*1000,1000,1000)));
 const start=performance.now(),r=mergeCandidates(entities,{ledgerM2:25,maxExtra:24,limit:1});
 assert.ok(performance.now()-start<200);assert.deepEqual(r.candidates,[]);
});
test('방문 상태 상한에 도달하면 truncated를 표시한다',()=>{
 const entities=[parcel(A,'A','site',rect(0,0,24000,1000))];
 for(let i=0;i<24;i++)entities.push(parcel('n'+i,'n','neighbor',rect(i*1000,1000,1000,1000)));
 const start=performance.now(),r=mergeCandidates(entities,{ledgerM2:29,maxExtra:24,limit:1});
 assert.equal(r.truncated,true);assert.ok(performance.now()-start<200);assert.ok(r.candidates.every(c=>c.pnus.length<=5));
});
test('이웃 레이어 없이 여러 대지를 합치면 role만 바꾸고 각 레이어는 유지한다',()=>{
 const entities=sample();entities.forEach((e,i)=>{e.id='s'+i;e.layer='site'+i;e.parcelRole='site';});
 const cmd=mergeSiteCommand(entities,{pnus:[],ring:unionRing});
 assert.deepEqual(cmd.commands[0].updates,entities.map(e=>({id:e.id,changes:{parcelRole:'site-original'}})));
});

test('긴 이웃 변의 먼 끝점은 제외하고 겹치는 투영 구간만 거리 검사한다',()=>{
 const a=rect(0,0,10000,1000),b=[{x:10003,y:0},{x:20003,y:0},{x:20033,y:10000},{x:10033,y:10000}];
 assert.ok(sharedEdgeLengthM(a,b)>0.99);near(sharedEdgeLengthM(a,b),sharedEdgeLengthM(b,a));
});

test('모서리 근처 공유 변 499mm는 거부하고 500mm부터 후보이다',()=>{
 for(const shared of [470,499,500]){
  const entities=[parcel(A,'A','site',rect(0,0,10000,10000)),parcel(B,'B','neighbor',rect(10000,10000-shared,10000,10000))];
  near(sharedEdgeLengthM(entities[0].points,entities[1].points),shared/1000);
  assert.equal(mergeCandidates(entities,{ledgerM2:200}).candidates.length,shared>=500?1:0);
 }
});



test('일부 원본이 없는 이전 저장본의 재합필은 현재 외곽 전체와 필지 목록을 보존한다',()=>{
 const merged=parcel(A,'213-17 외 1필지','site',rect(0,0,15000,10000),{sitePnus:[A,B],siteJibuns:['213-17','213-18'],mergedSite:true});
 const original=parcel(B,'213-18','site-original',rect(10000,0,5000,10000));
 const c=parcel(C,'213-19','neighbor',rect(15000,0,5000,10000)),entities=[merged,original,c];
 assert.deepEqual(mergeCandidates(entities,{ledgerM2:200}).candidates[0]?.pnus,[C]);
 const rings=mergeRings(entities,[A,B,C]);assert.equal(rings.length,2);assert.deepEqual(rings.map(r=>r.pnu),[A,C]);
 const options={pnus:[A,B,C],ring:[[0,0],[20000,0],[20000,10000],[0,10000]],now:()=> 'x'};
 const out=mergedSiteEntity(entities,options);assert.deepEqual(out.attributes.sitePnus,[A,B,C]);assert.deepEqual(out.attributes.siteJibuns,['213-17','213-18','213-19']);
 assert.equal(out.attributes.jibun,'213-17 외 2필지');assert.deepEqual(mergeFetchedEntities(entities,options)[0].attributes.sitePnus,[A,B,C]);
});

test('2000점 인접 경계도 후보 탐색 비용 상한에서 200ms 안에 중단하며 제안을 지어내지 않는다',()=>{
 const many=x=>{const corners=rect(x,0,10000,10000);return corners.flatMap((p,i)=>{const q=corners[(i+1)%4];return Array.from({length:500},(_,j)=>({x:p.x+(q.x-p.x)*j/500,y:p.y+(q.y-p.y)*j/500}));});};
 const entities=[parcel(A,'A','site',many(0)),parcel(B,'B','neighbor',many(10000))];
 const start=performance.now(),r=mergeCandidates(entities,{ledgerM2:200});
 assert.ok(performance.now()-start<200);assert.equal(r.truncated,true);assert.deepEqual(r.candidates,[]);
});

test('이웃 없이 합칠 때 도면 레이어 목록으로 표준 원본 레이어를 만들거나 재사용한다',()=>{
 for(const existing of [false,true]){
  const engine=new DrawingEngine();engine.execute({type:'parcel.import',entities:sample().map(e=>({...e,parcelRole:'site'}))});
  if(existing)engine.execute({type:'layer.add',name:'A-SITE-PARCEL'});
  const before=structuredClone(engine.doc),undo=engine.undoStack.length;
  engine.execute(mergeSiteCommand(engine.doc.entities,{pnus:[],ring:unionRing,layers:engine.doc.layers}));
  const layers=engine.doc.layers.filter(l=>l.name==='A-SITE-PARCEL');assert.equal(layers.length,1);
  assert.ok(engine.doc.entities.filter(e=>e.parcelRole==='site-original').every(e=>e.layer===layers[0].id));
  assert.equal(engine.undoStack.length,undo+1);engine.execute({type:'undo'});assert.deepEqual(engine.doc.entities,before.entities);assert.deepEqual(engine.doc.layers,before.layers);
 }
});

test('원본 표준 레이어가 숨김·잠금·동결이면 변경 전에 안내한다',()=>{
 for(const flag of ['locked','frozen','visible']){
  const entities=sample().map((e,i)=>({...e,id:'id'+i})),layers=[{id:'original',name:'A-SITE-PARCEL',visible:true,[flag]:flag!=='visible'}];
  assert.throws(()=>mergeSiteCommand(entities,{pnus:[B],ring:unionRing,layers}),/A-SITE-PARCEL.*표시·해동·잠금 해제/);
 }
});


test('합집합 첫 점이 바뀌어도 설계엔진 원점은 지도와 같은 위치를 가리킨다',()=>{
 const entities=sample(),source=entities[0];
 source.attributes={...source.attributes,sourceCRS:'EPSG:5187',originMetres:[200000,400000],insertionMm:[3000,5000]};
 source.points=source.points.map(p=>({x:p.x+3000,y:p.y+5000}));
 const ring=[[3000,15000],[3000,5000],[23000,5000],[23000,15000]];
 const merged=mergedSiteEntity(entities,{pnus:[A,B],ring});
 assert.deepEqual(merged.attributes.originMetres,[200000,400010]);assert.deepEqual(merged.attributes.insertionMm,ring[0]);
 const first=merged.points[0],at=merged.attributes.originMetres;
 for(const p of merged.points)assert.deepEqual([at[0]+(p.x-first.x)/1000,at[1]+(p.y-first.y)/1000],[200000+(p.x-3000)/1000,400000+(p.y-5000)/1000]);
 const nextRing=[...ring.slice(1),ring[0]],again=mergedSiteEntity([merged,entities[1]],{pnus:[A,B],ring:nextRing});
 assert.deepEqual(again.attributes.originMetres,[200000,400000]);assert.deepEqual(again.attributes.insertionMm,nextRing[0]);
});


test('기본 추가 3필지 탐색은 24개 이웃의 가능한 세 필지 조합을 모두 본다',()=>{
 const entities=[parcel(A,'A','site',rect(0,0,24000,1000))];
 for(let i=0;i<24;i++)entities.push(parcel('n'+i,'n','neighbor',rect(i*1000,1000,1000,1000)));
 const result=mergeCandidates(entities,{ledgerM2:27,limit:3000});
 assert.equal(result.candidates.length,24*23*22/6);assert.equal(result.truncated,undefined);
 assert.ok(result.candidates.every(c=>c.pnus.length===3));
});
