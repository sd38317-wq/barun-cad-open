import test from 'node:test';
import assert from 'node:assert/strict';
import {createDetailIndex,searchDetails,recommendDetails,dismissDetail,findDetailUses,isDetailInserted,DETAIL_GROUPS,DETAIL_GROUP_LABELS} from './detail-search-index.js';

function fixture() {
  return createDetailIndex({
    ours:[
      {id:'WALL-01',group:'wall',name:'외벽 단열 접합'},
      {id:'BASIC-01',group:'basic',name:'창대'},
      {id:'STAIR-01',group:'stair',name:'계단 디딤판'},
      {id:'STEEL-01',group:'wall',name:'철골 H형강 접합'},
    ],
    knowledge:{wall:{details:[{id:'WALL-01',facility:'세대',assembly:{layers:[{material:'미네랄 울',thickness:125}]},appliesTo:{wallType:'exterior'},lhNumber:'DA-10-001',checks:[{key:'wall.thickness',lawValue:'LAW34.minimum'}]}],laws:[{id:'LAW34',law:'건축법 시행령',article:'제 34 조',values:{minimum:120}}]}},
    lh:[{id:'LH-01',drawing_id:'DA-20-010',name:'지하주차장 방화구획',classification:'fire',facility:'지하주차장',summary:'내화 벽체 200mm'}],
    library:[{id:'LIB-01',name:'공용 바닥 마감',group:'floor',facility:'공용',png:'floor.png'}],
  });
}
test('Korean substring ignores spacing, retains numeric thickness and law article searches',()=>{
 const index=fixture();
 for (const query of ['외벽단열','벽 단 열','미네랄울','125','제34조','34','DA-10-001','exterior']) assert.ok(searchDetails(index,{query}).some(d=>d.id==='WALL-01'),query);
 assert.equal(searchDetails(index,{query:'ㅇㅂ'}).length,0);
 assert.equal(searchDetails(index,{query:'200'}).at(0).id,'LH-01');
});
test('source, ten trades and building/unit folders combine',()=>{
 const index=fixture(); assert.equal(DETAIL_GROUPS.length,12);
 assert.deepEqual(searchDetails(index,{group:'window'}).map(d=>d.id),['BASIC-01']);
 assert.equal(searchDetails(index,{source:'우리 상세',facility:'세대',group:'wall'}).length,1);
 assert.equal(searchDetails(index,{source:'LH',facility:'지하주차장'}).length,1);
 assert.equal(searchDetails(index,{source:'lh',facility:'세대'}).length,0);
 assert.equal(searchDetails(index,{source:'library',group:'floor'}).length,1);
});
test('missing LH and country packs do not suppress generated details; inputs remain unchanged',()=>{
 const input={ours:[{id:'BASIC-03',group:'basic',name:'파라펫'}],knowledge:{},lh:null,library:null};
 const before=structuredClone(input),index=createDetailIndex(input);
 assert.equal(index.length,1);assert.equal(index[0].group,'roof');assert.deepEqual(input,before);
 assert.deepEqual(createDetailIndex(),[]);
});
test('uses preserve plan section elevation navigation coordinates and block reference metadata',()=>{
 const item=fixture()[0];
 const references=['plan','section','elevation'].map((view,i)=>({detail:item.id,view,number:1,referenceAt:[i*100,200]}));
 const doc={drawingSets:{setA:{references,selected:[{id:item.id}]}},entities:[{id:'callout',drawingSet:{id:'setA'},detailReference:{detail:item.id},position:{x:10,y:20}}]};
 const uses=findDetailUses(doc,item);assert.equal(uses.length,4);assert.equal(uses[1].view,'section');assert.deepEqual(uses[1].referenceAt,[100,200]);
 assert.equal(searchDetails(fixture(),{query:'외벽',document:doc})[0].useCount,4);
 assert.equal(findDetailUses({drawingSets:[{selected:[{id:item.id}]}]},item).length,0);
 assert.equal(isDetailInserted({drawingSets:[{selected:[{id:item.id}]}]},item),false);
 assert.ok(isDetailInserted({drawingSets:[{selected:[{id:item.id}]}],entities:[{id:'legacy',drawingSet:{id:'0'}}]},item));
 const lh=fixture().find(d=>d.source==='lh');
 assert.equal(findDetailUses({entities:[{id:'block',detail:{id:lh.id,source:'lh2025'}}]},lh).length,0);
 assert.ok(isDetailInserted({entities:[{id:'block',detail:{id:lh.id,source:'lh2025'}}]},lh));
});
test('selected wall layer suggests wall/window, stair object and steel block match their context',()=>{
 const index=fixture();
 const wall=recommendDetails(index,{selected:[{layer:'wallLayer'}],layers:[{id:'wallLayer',name:'A-WALL'}]});
 assert.ok(wall.some(d=>d.id==='BASIC-01'));assert.ok(wall.some(d=>d.id==='WALL-01'));
 assert.equal(recommendDetails(index,{selected:[{kind:'stair'}]})[0].id,'STAIR-01');
 assert.equal(recommendDetails(index,{selected:[{type:'block',name:'철골 H형강 H-300'}]})[0].id,'STEEL-01');
});
test('auto-selection suggests only details not inserted; drawing command and failed check explain recommendations',()=>{
 const index=fixture(),document={drawingSets:{s:{selected:[{id:'WALL-01'}]}},entities:[{id:'detail',drawingSet:{id:'s'}}]};
 const auto=recommendDetails(index,{document,autoSelected:[{id:'WALL-01'},{id:'BASIC-01'}]});
 assert.deepEqual(auto.map(d=>d.id),['BASIC-01']);assert.match(auto[0].reason,/아직/);
 assert.equal(recommendDetails(index,{command:'계단 단면 그리기'})[0].id,'STAIR-01');
 const legal=recommendDetails(index,{failedChecks:[{ok:false,lawValue:'LAW34.minimum'}]});
 assert.equal(legal[0].id,'WALL-01');assert.match(legal[0].reason,/부적합/);
 assert.deepEqual(recommendDetails(index,{failedChecks:[{ok:true,lawValue:'LAW34.minimum'}]}),[]);
});
test('dismissal persists per document, busy mode does not calculate, recommendations cap at five',()=>{
 const index=createDetailIndex({ours:Array.from({length:8},(_,i)=>({id:'W'+i,group:'wall',name:'벽 상세 '+i}))}),document={};
 const first=recommendDetails(index,{selected:[{layer:'A-WALL'}],document});assert.equal(first.length,5);
 dismissDetail(document,first[0]);dismissDetail(document,first[0]);assert.equal(document.projectSettings.detailSuggestionsDismissed.length,1);
 const restored=JSON.parse(JSON.stringify(document));
 assert.ok(!recommendDetails(index,{selected:[{layer:'A-WALL'}],document:restored}).some(d=>d.key===first[0].key));
 assert.ok(recommendDetails(index,{selected:[{layer:'A-WALL'}],document:{}}).some(d=>d.key===first[0].key));
 assert.deepEqual(recommendDetails(index,{selected:[{layer:'A-WALL'}],idle:false}),[]);
});

test('LH editions with duplicate identifiers stay separate and title annotations are not uses or insertions',()=>{
 const index=createDetailIndex({lh:['lh2017','lh2025','la'].map(source=>({id:'DA-01',source,name:'벽 접합'}))});
 assert.equal(index.length,3);assert.equal(new Set(index.map(x=>x.key)).size,3);
 const doc={entities:[{id:'title',detail:{id:'DA-01',source:'lh2025',annotation:true}},{id:'b',detail:{id:'DA-01',source:'lh2017'}}]};
 assert.ok(isDetailInserted(doc,index[0]));assert.ok(!isDetailInserted(doc,index[1]));
 assert.equal(findDetailUses(doc,index[0]).length,0);
 const callouts={entities:[{id:'c',detailReference:{detail:'DA-01',source:'lh2017'},position:{x:1,y:2}}]};
 assert.equal(findDetailUses(callouts,index[0]).length,1);
 assert.equal(findDetailUses(callouts,index[1]).length,0);
 assert.equal(findDetailUses(callouts,index[0].key).length,1);
});
test('unknown legal review results are not failures and placed details suppress automatic proposals',()=>{
 const index=fixture();
 assert.deepEqual(recommendDetails(index,{failedChecks:[{ok:null,status:'검토필요',lawValue:'LAW34.minimum'}]}),[]);
 const doc={drawingSets:{s:{placed:[{id:'WALL-01',entityIds:['detail']}]}},entities:[{id:'detail'}]};
 assert.equal(findDetailUses(doc,index[0]).length,0);assert.ok(isDetailInserted(doc,index[0]));
 assert.deepEqual(recommendDetails(index,{document:doc,autoSelected:['WALL-01']}),[]);
});
test('search scans large drawing entities only once per query',()=>{
 const items=fixture();let scans=0;
 const doc={get entities(){scans++;return [{id:'ref',detailReference:{detail:'WALL-01'}}];}};
 assert.equal(searchDetails(items,{document:doc}).length,items.length);assert.equal(scans,1);
});

test('tracked callout navigation follows moved nested block bounds and disappears after deletion',()=>{
 const item=fixture()[0];
 const doc={drawingSets:{s:{references:[{detail:item.id,view:'section',at:[10,20],referenceAt:[30,40],entityIds:['callout'],referenceBounds:{minX:0,minY:0,maxX:50,maxY:50}}]}},
   entities:[{id:'callout',type:'block',drawingSet:{id:'s'},entities:[{id:'line',type:'line',points:[{x:100,y:200},{x:150,y:250}]}]}]};
 const before=structuredClone(doc),uses=findDetailUses(doc,item);
 assert.equal(uses.length,1);assert.deepEqual(uses[0].at,[110,220]);assert.deepEqual(uses[0].referenceAt,[130,240]);assert.deepEqual(doc,before);
 doc.entities=[];
 assert.deepEqual(findDetailUses(doc,item),[]);
});
test('selected and placed records cease suppressing recommendations when their geometry is deleted',()=>{
 const index=fixture(),item=index[0];
 const doc={drawingSets:{s:{selected:[{id:item.id,entityIds:['detail-a','detail-b']}]},legacy:{placed:[{id:'BASIC-01'}]}},
   entities:[{id:'detail-a',drawingSet:{id:'s'}},{id:'unrelated',drawingSet:{id:'legacy'}}]};
 assert.ok(isDetailInserted(doc,item));assert.ok(isDetailInserted(doc,index[1]));
 doc.entities=doc.entities.filter(e=>e.id!=='detail-a');
 assert.equal(isDetailInserted(doc,item),false);
 assert.ok(recommendDetails(index,{document:doc,autoSelected:[item.id]}).some(d=>d.id===item.id));
 doc.entities=[];assert.equal(isDetailInserted(doc,index[1]),false);
});
test('legacy reference metadata requires a live drawing set member',()=>{
 const item=fixture()[0],doc={drawingSets:{s:{references:[{detail:item.id,at:[1,2]}]}}};
 assert.equal(findDetailUses(doc,item).length,0);
 doc.entities=[{id:'live',drawingSet:{id:'s'}}];
 assert.equal(findDetailUses(doc,item).length,1);
});
test('library and LH insertion searchKey takes precedence over transport detail source',()=>{
 const items=createDetailIndex({lh:[{id:'same',source:'lh2017',name:'벽 상세'}],library:[{id:'same',name:'벽 모음'}]});
 const doc={entities:[{id:'library',detail:{id:'same',source:'lh2025',searchKey:items[1].key}}]};
 assert.equal(isDetailInserted(doc,items[0]),false);assert.equal(isDetailInserted(doc,items[1]),true);
});
test('recommendation resolves selected IDs and insertion records from one entity scan',()=>{
 const items=fixture();let scans=0;
 const doc={get entities(){scans++;return [{id:'wall',layer:'A-WALL'}];}};
 assert.ok(recommendDetails(items,{document:doc,selected:['wall']}).length>0);assert.equal(scans,1);
});

test('steel, jutong and unit library folders remain independently selectable',()=>{
 const index=createDetailIndex({ours:[{id:'STEEL-146',group:'steel',name:'H형강 접합'}],library:[{id:'JT-1',group:'주동',name:'84 74 84 타워'},{id:'UN-1',group:'단위세대',name:'84형 평면'}]});
 for(const [group,id] of [['steel','STEEL-146'],['jutong','JT-1'],['unit','UN-1']])assert.deepEqual(searchDetails(index,{group}).map(i=>i.id),[id]);
 assert.deepEqual(searchDetails(index,{query:'84 타워'}).map(i=>i.id),['JT-1']);
});

test('confirmed trade names work in labels, Korean folder classification and text search',()=>{
 const labels=['외벽','창호','바닥','지붕','계단','방화','주차장','편의시설','실내','철골'];
 assert.deepEqual(DETAIL_GROUPS.slice(0,10).map(g=>DETAIL_GROUP_LABELS[g]),labels);
 const groups=['wall','access','parking'],names=['외벽','편의시설','주차장'];
 const index=createDetailIndex({library:names.map((group,i)=>({id:String(i),group,name:'샘플 상세'}))});
 groups.forEach((group,i)=>{assert.equal(index[i].group,group);assert.deepEqual(searchDetails(index,{query:names[i]}).map(x=>x.id),[String(i)]);});
});

test('building context suppresses basement trench details for a one-story house',()=>{
 const index=createDetailIndex({ours:[{id:'TRENCH-01',group:'parking',name:'지하주차장 트렌치 상세'},{id:'WALL-01',group:'wall',name:'외벽 상세'}]});
 const house={stories:[{name:'1층'}],buildingUse:'단독주택',basement:false};
 assert.ok(!recommendDetails(index,{model:house,selected:[{layer:'A-PARKING'}]}).some(d=>d.id==='TRENCH-01'));
 const basement={stories:[{name:'지하1층'},{name:'1층'}],buildingUse:'단독주택',basement:true};
 assert.ok(recommendDetails(index,{model:basement,selected:[{layer:'A-PARKING'}]}).some(d=>d.id==='TRENCH-01'));
});


test('basement context uses story values and leaves above-ground trench suggestions available',()=>{
 const index=createDetailIndex({library:[{id:'FLOOR-051',group:'floor',name:'지하주차장 트렌치 상세'},{id:'FLOOR-052',group:'floor',name:'외부 배수 트렌치 상세'},{id:'FLOOR-060',group:'floor',name:'콘크리트 바닥 상세'}]});
 const selected=[{layer:'A-SLAB'}],ids=model=>recommendDetails(index,{model,selected}).map(d=>d.id);
 assert.deepEqual(ids({stories:[{id:'1F',elevation:0,height:3000}],building:{use:'단독주택'},basement:false}),['FLOOR-052','FLOOR-060']);
 for(const story of [{id:'B1',elevation:-3000},{name:'B1',index:-1},{name:'지하1층'},{id:'lower',elevation:-3000}])assert.ok(ids({stories:[story,{id:'1F',elevation:0}]}).includes('FLOOR-051'));
 assert.ok(ids({stories:[],elements:[]}).includes('FLOOR-051'));
 assert.ok(ids({stories:[]}).includes('FLOOR-052'));
 const unknown=recommendDetails(index,{model:{},selected});
 assert.ok(unknown.find(d=>d.id==='FLOOR-051').score<unknown.find(d=>d.id==='FLOOR-060').score);
});

test('above-ground stories keep unconfirmed basement details, including failed check matches',()=>{
 const index=createDetailIndex({ours:[{id:'BASEMENT-01',group:'floor',name:'지하주차장 트렌치 상세'},{id:'FLOOR-01',group:'floor',name:'콘크리트 바닥 상세'}]});
 const model={stories:[{id:'1F',elevation:0,height:3000}],building:{use:'단독주택'}},selected=[{layer:'A-SLAB'}];
 for(const context of [{selected},{failedChecks:[{ok:false,detailId:'BASEMENT-01'}]}]){
  const item=recommendDetails(index,{model,...context}).find(d=>d.id==='BASEMENT-01');
  assert.ok(item,'지상층 정보만으로 지하 상세를 제외하지 않음');assert.equal(item.score,30);assert.equal(item.reason,'지하층 여부를 확인한 뒤 검토할 상세');
 }
 const items=recommendDetails(index,{model,selected});assert.ok(items.find(d=>d.id==='FLOOR-01').score>items.find(d=>d.id==='BASEMENT-01').score);
 for(const context of [{model:{...model,basement:false}},{model:{...model,basement:0}},{model:{...model,building:{basement:false}}},{model,document:{projectSettings:{basement:false}}}])
  assert.ok(!recommendDetails(index,{...context,selected,failedChecks:[{ok:false,detailId:'BASEMENT-01'}]}).some(d=>d.id==='BASEMENT-01'),'지하 없음이 확인되면 제외');
});

test('allowed groups constrain all searches and intersect group, text, source and facility filters',()=>{
 const index=createDetailIndex({library:DETAIL_GROUPS.map(group=>({id:group,group,name:'공통 자료',facility:'세대'}))});
 const details=DETAIL_GROUPS.filter(group=>!['jutong','unit'].includes(group));
 for(const allowGroups of [details,['jutong'],['unit']]) {
  for(const group of ['', 'all']) assert.deepEqual(searchDetails(index,{allowGroups,group}).map(item=>item.group),allowGroups);
  assert.deepEqual(searchDetails(index,{allowGroups,query:'공통',facility:'세대',source:'library'}).map(item=>item.group),allowGroups);
  const outside=DETAIL_GROUPS.find(group=>!allowGroups.includes(group));
  assert.deepEqual(searchDetails(index,{allowGroups,group:outside}),[]);
 }
 assert.deepEqual(searchDetails(index,{allowGroups:[]}),[]);
 assert.equal(searchDetails(index).length,12);
});
test('recommendations apply allowed groups before ranking and the five-item limit',()=>{
 const index=createDetailIndex({library:[...Array.from({length:6},(_,i)=>({id:'JT-'+i,group:'jutong',name:'주동'})),{id:'W',group:'wall',name:'외벽'},{id:'U',group:'unit',name:'단위세대'}]});
 const options={command:'외벽 주동 단위세대',failedChecks:index.filter(item=>item.group==='jutong').map(item=>({ok:false,detailId:item.id}))};
 assert.ok(recommendDetails(index,options).every(item=>item.group==='jutong'));
 assert.deepEqual(recommendDetails(index,{...options,allowGroups:['wall']}).map(item=>item.id),['W']);
 for(const group of ['jutong','unit']) {
  const items=recommendDetails(index,{...options,allowGroups:[group]});
  assert.ok(items.length>0);assert.ok(items.every(item=>item.group===group));
 }
 assert.deepEqual(recommendDetails(index,{...options,allowGroups:[]}),[]);
});
