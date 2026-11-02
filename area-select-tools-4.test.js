import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 wildcardRegex,matchLayers,layerNameOf,roundValue,entityLength,entityArea,axisAngle,numericAttributes,
 findEnclosingArea,groupByKey,computeAreaResult,groupRooms,autoWidths,gridTable,firstNumber,areaConvert,
 circlePolygon,entityInsidePolygon,entityTouchesPolygon,installAreaSelectTools4,
 checkCdbHeights,CDB_HEIGHT_LIMIT,
} from './area-select-tools-4.js';

// ── 2026-09-24 F9: CDB 층고 입력 상한 ──
test('checkCdbHeights: 0 이상·100 m 이하만 받고 합계를 돌려준다',()=>{
 assert.equal(checkCdbHeights({floorHeight:2800,topHeight:2800,glHeight:900,parapet:300}),6800);
 assert.throws(()=>checkCdbHeights({floorHeight:1e15,topHeight:2800,glHeight:900,parapet:300}),new RegExp(CDB_HEIGHT_LIMIT.toLocaleString()));
 assert.throws(()=>checkCdbHeights({floorHeight:'거실',topHeight:2800,glHeight:900,parapet:300}),/숫자/);
 assert.throws(()=>checkCdbHeights({floorHeight:0,topHeight:0,glHeight:0,parapet:0}),/합계/);
});

// ── wildcardRegex / matchLayers (MRT 공제 켜) ──
test('wildcardRegex: * ? # 를 간이 정규식으로 바꾼다',()=>{
 assert.ok(wildcardRegex('AREA_S*').test('AREA_S1'));
 assert.ok(!wildcardRegex('AREA_S*').test('OTHER'));
 assert.ok(wildcardRegex('A#').test('A1'));
 assert.ok(!wildcardRegex('A#').test('AB'));
 assert.ok(wildcardRegex('A?C').test('ABC'));
});
test('matchLayers: 콤마로 구분한 여러 와일드카드 중 하나라도 맞으면 포함',()=>{
 const layers=[{id:'1',name:'AREA_S1'},{id:'2',name:'BO'},{id:'3',name:'A-WALL'}];
 assert.deepEqual(matchLayers('AREA_S*,BO',layers),['AREA_S1','BO']);
 assert.deepEqual(matchLayers('',layers),[]);
 assert.deepEqual(matchLayers('  ',layers),[]);
});
test('layerNameOf: id 로 켜 이름을 찾는다(없으면 id 그대로)',()=>{
 const layers=[{id:'L1',name:'A-WALL'}];
 assert.equal(layerNameOf(layers,{layer:'L1'}),'A-WALL');
 assert.equal(layerNameOf(layers,{layer:'L9'}),'L9');
});

// ── roundValue (AE 올림방식) ──
test('roundValue: 반올림·올림·내림',()=>{
 assert.equal(roundValue(1.234,2,'round'),1.23);
 assert.equal(roundValue(1.231,2,'ceil'),1.24);
 assert.equal(roundValue(1.239,2,'floor'),1.23);
});

// ── entityLength / entityArea / axisAngle / numericAttributes (SE·CALC00 공용) ──
test('entityLength: 선·닫힌 폴리선(사각형)·원',()=>{
 assert.equal(entityLength({type:'line',points:[{x:0,y:0},{x:3000,y:4000}]}),5000);
 assert.equal(entityLength({type:'rectangle',points:[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000},{x:0,y:1000}]}),4000);
 assert.ok(Math.abs(entityLength({type:'circle',center:{x:0,y:0},radius:1000})-2*Math.PI*1000)<1e-6);
 assert.throws(()=>entityLength({type:'text'}));
});
test('entityArea: 사각형·원·열린 폴리선은 오류',()=>{
 assert.equal(entityArea({type:'rectangle',points:[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000},{x:0,y:1000}]}),1e6);
 assert.ok(Math.abs(entityArea({type:'circle',center:{x:0,y:0},radius:1000})-Math.PI*1e6)<1);
 assert.throws(()=>entityArea({type:'polyline',closed:false,points:[{x:0,y:0},{x:1,y:0}]}));
});
test('axisAngle: 선 방향각·블럭 회전각·해당없음(null)',()=>{
 assert.equal(axisAngle({type:'line',points:[{x:0,y:0},{x:1000,y:0}]}),0);
 assert.equal(axisAngle({type:'line',points:[{x:0,y:0},{x:0,y:1000}]}),90);
 assert.equal(axisAngle({type:'block',rotation:45}),45);
 assert.equal(axisAngle({type:'circle',center:{x:0,y:0},radius:1}),null);
});
test('numericAttributes: 종류별로 해당 항목만 채운다(두께·고도는 없음)',()=>{
 const line=numericAttributes({type:'line',points:[{x:0,y:0},{x:1000,y:0}]});
 assert.deepEqual(Object.keys(line).sort(),['angle','length']);
 const circle=numericAttributes({type:'circle',center:{x:0,y:0},radius:500});
 assert.deepEqual(Object.keys(circle).sort(),['area','radius']);
 assert.ok(Math.abs(circle.area-Math.PI*500**2)<1);
 const text=numericAttributes({type:'text',height:150,rotation:0,text:'x'});
 assert.deepEqual(Object.keys(text).sort(),['angle','height']);
});

// ── findEnclosingArea (AE 점지정 모드) ──
test('findEnclosingArea: 점을 둘러싼 가장 작은 닫힌 도형을 찾는다',()=>{
 const big={id:'big',type:'rectangle',points:[{x:0,y:0},{x:2000,y:0},{x:2000,y:2000},{x:0,y:2000}]};
 const small={id:'small',type:'rectangle',points:[{x:500,y:500},{x:1000,y:500},{x:1000,y:1000},{x:500,y:1000}]};
 const hit=findEnclosingArea([big,small],{x:700,y:700});
 assert.equal(hit.id,'small');
 assert.equal(findEnclosingArea([big,small],{x:1900,y:1900})?.id,'big');
 assert.equal(findEnclosingArea([big,small],{x:-1,y:-1}),null);
});

// ── computeAreaResult (AE·DAR 공용 핵심 — 중복 방지로 하나만 둔다) ──
test('computeAreaResult: 면적 합산·보이드 빼기·단위·올림',()=>{
 const a={type:'rectangle',points:[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000},{x:0,y:1000}]}; // 1 m2
 const b={type:'rectangle',points:[{x:0,y:0},{x:2000,y:0},{x:2000,y:1000},{x:0,y:1000}]}; // 2 m2
 const r=computeAreaResult([a,b],[],{decimals:2,unit:'m2'});
 assert.equal(r.total,3);
 assert.equal(r.text,'3.00㎡');
});
test('computeAreaResult: 보이드를 빼고 평 표기(DAR 도 이 함수를 그대로 쓴다)',()=>{
 const a={type:'rectangle',points:[{x:0,y:0},{x:2000,y:0},{x:2000,y:2000},{x:0,y:2000}]}; // 4 m2
 const hole={type:'rectangle',points:[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000},{x:0,y:1000}]}; // 1 m2
 const r=computeAreaResult([a],[hole],{decimals:2,unit:'py'});
 assert.equal(r.total,3);
 assert.equal(r.text,(3*0.3025).toFixed(2)+'평');
});
test('computeAreaResult: 빼기 후 0 이하면 오류, 대상 없으면 오류',()=>{
 const a={type:'rectangle',points:[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000},{x:0,y:1000}]};
 assert.throws(()=>computeAreaResult([a],[a]));
 assert.throws(()=>computeAreaResult([],[]));
});
test('computeAreaResult: 켜별 구분표·산출식',()=>{
 const a={type:'rectangle',layer:'L1',points:[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000},{x:0,y:1000}]};
 const b={type:'rectangle',layer:'L2',points:[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000},{x:0,y:1000}]};
 const r=computeAreaResult([a,b],[],{decimals:0,unit:'m2',byLayer:true,formula:true,layerNameFn:e=>e.layer});
 assert.equal(r.byLayerLines.length,2);
 assert.match(r.text,/^1\+1 = 2㎡$/);
});
test('groupByKey: 키별로 묶는다',()=>{
 const g=groupByKey([{k:'a'},{k:'a'},{k:'b'}],e=>e.k);
 assert.equal(g.length,2);
 assert.equal(g.find(x=>x.key==='a').list.length,2);
});

// ── groupRooms / autoWidths / gridTable (MRT 일반표) ──
test('groupRooms: 같은 층·실명을 묶어 합산하고 정렬한다',()=>{
 const rooms=[{floor:'1F',name:'101 거실',areaM2:10},{floor:'1F',name:'101 거실',areaM2:5},{floor:'1F',name:'102 침실',areaM2:8}];
 const byName=groupRooms(rooms,'name');
 assert.equal(byName.length,2);
 const g101=byName.find(g=>g.name==='101 거실');
 assert.equal(g101.count,2);
 assert.equal(g101.area,15);
 const byNo=groupRooms(rooms,'no');
 assert.equal(byNo[0].name,'101 거실'); // 앞자리 숫자(101<102)로 정렬
});
test('autoWidths / gridTable: 행·열 수만큼 선·문자 개체를 만든다',()=>{
 const rows=[['A','BB'],['1','22']];
 const widths=autoWidths(rows,150);
 assert.equal(widths.length,2);
 const ents=gridTable({x:0,y:0},widths,300,rows,150,'L1');
 const lines=ents.filter(e=>e.type==='line'),texts=ents.filter(e=>e.type==='text');
 assert.equal(lines.length,(rows.length+1)+(widths.length+1)); // 가로선+세로선
 assert.equal(texts.length,4);
 assert.equal(texts[0].text,'A');
});

// ── firstNumber / areaConvert (M2·PY 공용) ──
test('firstNumber: 콤마 포함 첫 숫자를 찾는다',()=>{
 const f=firstNumber('면적 3,455.5㎡');
 assert.equal(f.value,3455.5);
 assert.equal(firstNumber('숫자 없음'),null);
});
test('areaConvert: 평→㎡(×400/121), 단위표현',()=>{
 const out=areaConvert('33평',{direction:'py2m2',decimals:3,unitOn:true,unitLabel:'m2'});
 assert.equal(out,(33*400/121).toFixed(3)+'m2');
});
test('areaConvert: ㎡→평(×121/400), 괄호표현',()=>{
 const out=areaConvert('108.3㎡',{direction:'m22py',decimals:2,unitOn:true,unitLabel:'평',paren:true});
 assert.equal(out,'('+(108.3*121/400).toFixed(2)+'평)');
});
test('areaConvert: 숫자가 없으면 오류',()=>{
 assert.throws(()=>areaConvert('숫자없음',{direction:'py2m2'}));
});

// ── circlePolygon / entityInsidePolygon / entityTouchesPolygon (SEB) ──
test('circlePolygon: n 개 점이 반지름 위에 있다',()=>{
 const pts=circlePolygon({center:{x:0,y:0},radius:1000},8);
 assert.equal(pts.length,8);
 for(const p of pts)assert.ok(Math.abs(Math.hypot(p.x,p.y)-1000)<1e-6);
});
test('entityInsidePolygon / entityTouchesPolygon: 사각형 경계 안팎 판정',()=>{
 const square=[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000},{x:0,y:1000}];
 const inLine={type:'line',points:[{x:200,y:200},{x:800,y:800}]};
 const outLine={type:'line',points:[{x:2000,y:2000},{x:3000,y:3000}]};
 const crossLine={type:'line',points:[{x:-500,y:500},{x:500,y:500}]};
 assert.equal(entityInsidePolygon(inLine,square),true);
 assert.equal(entityInsidePolygon(outLine,square),false);
 assert.equal(entityInsidePolygon(crossLine,square),false);
 assert.equal(entityTouchesPolygon(crossLine,square),true);
 assert.equal(entityTouchesPolygon(outLine,square),false);
});

/* ══════════ 카드 진입점(install) ══════════ */
function baseCtx(overrides={}){
 return {
  toast:()=>{},log:()=>{},userErrorMessage:e=>e.message,storage:{getItem:()=>null,setItem:()=>{}},
  selected:()=>[],entities:()=>[],layers:()=>[],ensureLayer:()=>'L1',activeLayer:()=>'L1',
  pickPoint:async()=>null,pickEntity:async()=>null,pickPath:async()=>null,
  execute:()=>{},commit:()=>{},setSelected:()=>{},num:(k,d)=>d,
  form:(title,fields,onApply)=>{const values={};for(const f of fields)values[f.name]=String(f.value??'');onApply(values);},
  ...overrides,
 };
}
test('installAreaSelectTools4: 9개 명령을 모두 내보낸다',()=>{
 const commands=installAreaSelectTools4(baseCtx());
 const expected=['MRT','CALC00','AE','CDB','DAR','M2','PY','SE','SEB'];
 assert.equal(Object.keys(commands).length,expected.length);
 for(const name of expected)assert.equal(typeof commands[name],'function',`${name} 명령이 없습니다`);
});
test('installAreaSelectTools4: 선택이 없으면 오류를 토스트로 안내한다(guard)',async()=>{
 const calls=[];
 const ctx=baseCtx({toast:(msg,isError)=>calls.push({msg,isError})});
 const commands=installAreaSelectTools4(ctx);
 await commands.MRT(); // pickEntity 가 항상 null → 선택 없음
 assert.equal(calls.length,1);
 assert.equal(calls[0].isError,true);
});
test('SEB: 경계 안 문자만 선택하고 밖·다른 종류는 뺀다',async()=>{
 const boundary={id:'B1',type:'rectangle',layer:'L1',points:[{x:0,y:0},{x:1000,y:0},{x:1000,y:1000},{x:0,y:1000}]};
 const inText={id:'T1',type:'text',layer:'L1',position:{x:400,y:400},height:50,text:'x',rotation:0};
 const outText={id:'T2',type:'text',layer:'L1',position:{x:3000,y:3000},height:50,text:'y',rotation:0};
 const inLine={id:'LN1',type:'line',layer:'L1',points:[{x:100,y:100},{x:200,y:200}]}; // 문자만 켜져 있어 제외돼야 함
 let selected=null;
 const ctx=baseCtx({
  pickEntity:async()=>boundary,
  layers:()=>[{id:'L1',name:'0'}],
  entities:()=>[boundary,inText,outText,inLine],
  setSelected:ids=>{selected=ids;},
 });
 const commands=installAreaSelectTools4(ctx);
 await commands.SEB();
 assert.deepEqual(selected,['T1']);
});
test('M2: 문자 안 숫자를 평→㎡ 로 바꿔 기존 문자를 고친다(기본값: 소수 3자리·단위표현 켜짐·기존문자 수정)',async()=>{
 const text={id:'T1',type:'text',layer:'L1',position:{x:0,y:0},height:100,text:'33평'};
 let picked=false,batch=null;
 const ctx=baseCtx({
  pickEntity:async()=>{if(picked)return null;picked=true;return text;},
  execute:cmd=>{batch=cmd;},
 });
 const commands=installAreaSelectTools4(ctx);
 await commands.M2();
 assert.equal(batch.type,'batch');
 assert.equal(batch.commands.length,1);
 assert.equal(batch.commands[0].changes.text,(33*400/121).toFixed(3)+'m2');
});
test('CALC00: 문자 두 개를 더해 결과 문자를 만든다',async()=>{
 const t1={id:'T1',type:'text',position:{x:0,y:0},height:100,text:'2'};
 const t2={id:'T2',type:'text',position:{x:0,y:0},height:100,text:'3'};
 let step=0,committed=null;
 const ctx=baseCtx({
  pickEntity:async()=>{step++;if(step===1)return t1;if(step===2)return t2;return null;},
  pickPoint:async()=>({x:100,y:100}),
  commit:payload=>{committed=payload;},
 });
 const commands=installAreaSelectTools4(ctx);
 await commands.CALC00();
 assert.equal(committed.entities[0].text,'5');
});

// 2026-10-27 설명서 시험: 층수 칸이 없어 2층 건물로만 계산했다.
test('CDB 건물 높이 = GL + 기준층×(층수-1) + 최상층 + 파라펫 (층수 기본 2 는 예전과 같음)',()=>{
 const base={floorHeight:2800,topHeight:3000,glHeight:900,parapet:300};
 assert.equal(checkCdbHeights(base),2800+3000+900+300);
 assert.equal(checkCdbHeights({...base,floors:2}),2800+3000+900+300);
 assert.equal(checkCdbHeights({...base,floors:5}),900+2800*4+3000+300);
 assert.equal(checkCdbHeights({...base,floors:1}),900+3000+300);
 assert.throws(()=>checkCdbHeights({...base,floors:0}),/층수/);
});
