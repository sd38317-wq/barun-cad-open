import test from 'node:test';
import assert from 'node:assert/strict';
import {DrawingEngine} from './engine.js';
import {LiveChecker} from './livecheck-engine.js';
import {autoSiteAnalysis} from './livecheck-auto.js';
import {mergeRings,mergeSiteCommand,mergeFetchedEntities,mergedSiteEntity} from './site-merge.js';

const rect=(x,y,w,h)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const parcel=(pnu,role,points,extra={})=>({type:'polyline',closed:true,parcelRole:role,points,attributes:{pnu,jibun:pnu,polygon:0,ring:'outer',...extra}});
const ring=points=>points.map(p=>[p.x,p.y]);
const sources=()=>[parcel('A','site',rect(0.123,0.456,10000,10000)),parcel('B','neighbor',rect(10000.123,0.456,10000,10000)),parcel('C','neighbor',rect(20000.123,0.456,10000,10000))];
const firstOptions={pnus:['A','B'],ring:ring(rect(0,0,20000,10000))};
const nextOptions={pnus:['A','B','C'],ring:ring(rect(0,0,30000,10000))};

test('합필 후 이전 100㎡ 분석을 중단하고 새 200㎡ 기준으로 건폐율·건축선·북측을 다시 계산한다',()=>{
 const engine=new DrawingEngine();
 engine.execute({type:'parcel.import',entities:[parcel('A','site',rect(0,0,10000,10000),{northVector:[0,1]}),parcel('B','neighbor',rect(0,10000,10000,10000))],drawOptions:{neighbors:true}});
 engine.execute({type:'layer.add',name:'A-BLDG-L1'});
 const floor=engine.doc.layers.find(l=>l.name==='A-BLDG-L1');
 engine.execute({type:'add',entity:{type:'polyline',closed:true,points:rect(1000,9000,8000,10000),layer:floor.id}});
 const old=autoSiteAnalysis(engine.doc,{manualZone:'제2종일반주거지역'}).analysis;
 engine.execute({type:'site.analyze',analysis:old});
 const checker=new LiveChecker(),before=structuredClone(engine.doc);
 assert.equal(checker.run(engine.doc).coverage,80);
 const command=mergeSiteCommand(engine.doc.entities,{pnus:['B'],ring:ring(rect(0,0,10000,20000)),layers:engine.doc.layers,siteAnalysis:engine.doc.siteAnalysis});
 engine.execute(command);
 assert.deepEqual(engine.doc.siteAnalysis,{...old,needsSiteReview:true});
 for(const source of old.sourceGeometry){const kept=engine.doc.entities.find(e=>e.id===source.id);assert.deepEqual(kept.points,source.points);}
 const stopped=checker.run(JSON.parse(JSON.stringify(engine.doc)));assert.equal(stopped.active,false);assert.equal(stopped.stale,true);assert.ok(!stopped.findings.some(f=>['coverage','building_line','north'].includes(f.type)));
 const updated=autoSiteAnalysis(engine.doc,{manualZone:'제2종일반주거지역'}).analysis;
 assert.equal(updated.siteArea,200);assert.deepEqual(updated.buildable[0].outer,rect(0,0,10000,20000));
 assert.deepEqual(updated.northProfile.segments,[[{x:10000,y:20000},{x:0,y:20000}]]);
 assert.equal(checker.run({...engine.doc,siteAnalysis:updated}).coverage,40);
 engine.execute({type:'undo'});assert.deepEqual(engine.doc,before);
});

test('재합필 union 입력은 반올림된 합성 경계 대신 실제 원본 좌표·구멍을 복원한다',()=>{
 const input=sources();input.splice(2,0,parcel('B','neighbor',rect(11000.123,1000.456,1000,1000),{ring:'hole'}));
 const expected=mergeRings(input,['A','B','C']);
 const once=mergeFetchedEntities(input,firstOptions);
 assert.deepEqual(mergeRings(once,['A','B','C']),expected);
 const twice=mergeFetchedEntities(once,nextOptions);
 assert.deepEqual(mergeRings(twice,['A','B','C']),expected);
});

test('재합필 명령은 중간 합성 외곽만 삭제하고 실제 원본을 보존하며 한 번의 undo로 복원한다',()=>{
 const engine=new DrawingEngine();engine.execute({type:'parcel.import',entities:sources(),drawOptions:{neighbors:true}});
 const original=structuredClone(engine.doc.entities);
 engine.execute(mergeSiteCommand(engine.doc.entities,{...firstOptions,layers:engine.doc.layers}));
 const before=structuredClone(engine.doc),middle=engine.doc.entities.find(e=>e.attributes?.mergedSite);
 engine.execute(mergeSiteCommand(engine.doc.entities,{...nextOptions,layers:engine.doc.layers}));
 assert.equal(engine.doc.entities.some(e=>e.id===middle.id),false);
 assert.equal(engine.doc.entities.filter(e=>e.attributes?.mergedSite).length,1);
 for(const source of original){const kept=engine.doc.entities.find(e=>e.id===source.id);assert.equal(kept.parcelRole,'site-original');assert.deepEqual(kept.points,source.points);assert.deepEqual(kept.attributes,source.attributes);}
 engine.execute({type:'undo'});assert.deepEqual(engine.doc,before);
});

test('조회 상태 재합필도 과거 합성 외곽을 원본 레이어에 쌓지 않는다',()=>{
 const input=sources(),once=mergeFetchedEntities(input,firstOptions),before=structuredClone(once);
 const twice=mergeFetchedEntities(once,nextOptions);
 assert.deepEqual(once,before);assert.equal(twice.length,4);
 assert.equal(twice.filter(e=>e.attributes?.mergedSite).length,1);
 assert.deepEqual(twice.filter(e=>e.parcelRole==='site-original').map(e=>e.points),input.map(e=>e.points));
});

test('단일 PNU의 여러 외곽을 합칠 때 지번에 외 0필지를 붙이지 않는다',()=>{
 const entities=[parcel('123-4','site',rect(0,0,1000,1000)),parcel('123-4','site',rect(1000,0,1000,1000),{polygon:1})];
 const out=mergedSiteEntity(entities,{pnus:['123-4'],ring:ring(rect(0,0,2000,1000))});
 assert.equal(out.attributes.jibun,'123-4');assert.deepEqual(out.attributes.sitePnus,['123-4']);
});
