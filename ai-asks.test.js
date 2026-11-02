import test from 'node:test';
import assert from 'node:assert/strict';
import {windAsks,interiorAsks,roomSpots,drawingDenominator,terrainHint,siteAddress,TERRAIN_CHOICES,ASK_RULE} from './ai-asks.js';
import {validateMaterialMap} from './material-presets.js';

const parcelDoc=(address,zones=[])=>({layers:[{id:'L',name:'C-SITE',visible:true}],entities:[{id:'p',type:'polyline',layer:'L',parcelRole:'site',attributes:{landInfo:{address,zoneNames:zones}}}]});

test('바람 검토: "풍동검토 해줘"만 해도 도면 주소는 채우고 주변 모습만 쉬운 말로 묻는다', ()=>{
 const r=windAsks(parcelDoc('부산광역시 해운대구 중동 947-1',['일반상업지역']));
 assert.equal(r.autoFilled.region.value,'부산광역시 해운대구 중동 947-1');assert.equal(r.found.speed,38);
 assert.deepEqual(r.needs.map(n=>n.key),['terrain']);
 const q=r.needs[0];assert.equal(q.suggested,'B');assert.match(q.why,/일반상업지역/);
 assert.deepEqual(q.choices.map(c=>c.n),[1,2,3,4]);
 for(const c of q.choices)assert.doesNotMatch(c.label,/지표면|조도|Kzr|[ABCD]\b/,'보기 글자에 기준 기호를 쓰지 않는다');
 assert.deepEqual(q.choices.map(c=>c.value),['A','B','C','D']);
 assert.equal(r.assumed[0].key,'importance');assert.equal(r.assumed[0].value,'1');
 assert.match(ASK_RULE,/하나만/);
});

test('바람 검토: 주소가 없으면 지역부터, 이름이 겹치면 후보를 보기로', ()=>{
 const none=windAsks({layers:[],entities:[]});assert.deepEqual(none.needs.map(n=>n.key),['region','terrain']);assert.equal(none.needs[0].choices.length,0);
 const both=windAsks({entities:[]},{region:'고성'});
 assert.deepEqual(both.needs[0].choices.map(c=>c.label).sort(),['강원 고성','경상 고성']);
 const picked=windAsks({entities:[]},{region:both.needs[0].choices[0].value,terrain:'C',importance:'2'});
 assert.equal(picked.needs.length,0);assert.equal(picked.assumed.length,0);assert.ok(picked.found.speed>0);
 assert.equal(windAsks({entities:[]},{basicWindSpeed:40,terrain:'D'}).needs.length,0,'기본풍속을 직접 주면 지역을 묻지 않는다');
 assert.equal(TERRAIN_CHOICES.length,4);
});

test('용도지역으로 주변 모습 추천', ()=>{
 assert.equal(terrainHint(['중심상업지역']).value,'A');assert.equal(terrainHint(['제2종일반주거지역']).value,'B');
 assert.equal(terrainHint(['자연녹지지역']).value,'C');assert.equal(terrainHint([]),null);
 assert.match(terrainHint(['상대보호구역','소로2류(폭 8m~10m)','제2종일반주거지역']).why,/제2종일반주거지역이라/,'보호구역·도로 이름이 앞에 와도 용도지역으로 말한다');
 assert.equal(siteAddress({sitePlanInput:{site:{address:'서울 강남구'}},entities:[]}).address,'서울 강남구');
 const ov=siteAddress({entities:[],reviewSettings:{buildingOverview:{values:{address:'부산 부산진구 양정동 156-7',zone:'제2종일반주거지역'}}}});
 assert.equal(ov.address,'부산 부산진구 양정동 156-7');assert.equal(terrainHint(ov.zones).value,'B');
 assert.match(terrainHint(siteAddress({entities:[],reviewSettings:{buildingOverview:{values:{zone:'제2종 일반주거지역, 지구단위계획구역'}}}}).zones).why,/제2종 일반주거지역이라/);
});

test('내부 투시도: 자리를 안 주면 방 이름(층 포함)과 건물 가운데를 보기로', ()=>{
 const doc={layers:[{id:'a',name:'A-TEXT-2F',visible:true},{id:'h',name:'HIDE',visible:false}],entities:[
  {id:'t1',type:'text',layer:'a',text:'거실',position:{x:1000.4,y:2000}},{id:'t2',type:'text',layer:'a',text:'침실 1',position:{x:5000,y:2000}},
  {id:'t3',type:'text',layer:'a',text:'거실',position:{x:1200,y:2100}},{id:'t4',type:'text',layer:'h',text:'주방',position:{x:0,y:0}},{id:'t5',type:'text',layer:'a',text:'W=1200 창호',position:{x:0,y:0}}]};
 assert.deepEqual(roomSpots(doc).map(s=>s.label),['2층 거실','2층 침실1']);
 assert.deepEqual(roomSpots(doc)[0].value,{x:1000,y:2000,floor:'2F'});
 const r=interiorAsks(doc,{},{center:{x:3000,y:2000}});
 assert.equal(r.needs[0].key,'spot');assert.equal(r.needs[0].choices.at(-1).label,'건물 한가운데');
 assert.equal(interiorAsks(doc,{x:1,y:2}).needs.length,0);
 // Codex 검토: 3D 모델 밖 글자(다른 도면 묶음·옮겨 놓은 설계안)와 모델에 없는 층은 보기에서 뺀다
 const only=interiorAsks(doc,{},{inside:p=>p.x<3000,floors:['2F']});assert.deepEqual(only.needs[0].choices.map(c=>c.label),['2층 거실']);
 assert.equal(interiorAsks(doc,{},{floors:['1F']}).needs[0].choices.length,0,'모델에 2층이 없으면 2층 방은 묻지 않는다');
 const plain={layers:[{id:'a',name:'TEXT',visible:true}],entities:[{id:'t',type:'text',layer:'a',text:'거실',position:{x:1,y:1}}]};
 assert.deepEqual(interiorAsks(plain,{floor:'3F'},{center:{x:0,y:0}}).needs[0].choices.map(c=>c.value.floor),['3F','3F'],'층을 정해 부르면 보기에도 그 층');
});

test('납품 점검 축척: 주석 축척 → 시트 축척 → 모름', ()=>{
 assert.deepEqual(drawingDenominator({currentAnnoScale:50}),{value:50,from:'도면 주석 축척'});
 assert.equal(drawingDenominator({currentAnnoScale:1,sheets:[{denominator:200}]}).value,200);
 assert.equal(drawingDenominator({}),null);
 assert.equal(drawingDenominator({currentAnnoScale:1,sheets:[{denominator:1}]}).value,1,'시트에 적힌 1:1 은 그대로');
});

test('재료를 잘못 고르면 그 부재에 쓸 수 있는 재료를 함께 알려 준다', ()=>{
 assert.throws(()=>validateMaterialMap({glass:'brick-red'}),/유리.*쓸 수 있는 재료: .*\(glass-/);
 assert.throws(()=>validateMaterialMap({wall:'없는것'}),/없는 재료: 없는것 — .*적벽돌\(brick-red\)/);
});
