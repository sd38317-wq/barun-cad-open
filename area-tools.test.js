import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as G from './geometry.js';
import {
 findNumberTokens,findFirstNumber,formatNumber,insertCommas,removeCommas,fixDecimalPlaces,
 calc,applyBulkCalc,sumTexts,parseLevelText,formatLevelText,shiftLevelText,parseLevelDelta,parseLevelParts,formatLevelLike,inferDrawingLevelUnit,
 indexSums,allocateShareArea,segmentsOf,chainClosedLoop,rectangleWidthHeight,triangleBaseHeightArea,
 northSlopeOffset,northSlopeCheckLines,installAreaTools,
} from './area-tools.js';

// ── 숫자 토큰 ──
test('findNumberTokens: 문장 속 여러 숫자를 찾는다',()=>{
 const tokens=findNumberTokens('3,455x234 (34.5㎡)');
 assert.equal(tokens.length,3);
 assert.equal(tokens[0].value,3455);
 assert.equal(tokens[0].hadComma,true);
 assert.equal(tokens[1].value,234);
 assert.equal(tokens[2].value,34.5);
 assert.equal(tokens[2].decimals,1);
});
test('findFirstNumber: 음수 고려 옵션',()=>{
 assert.equal(findFirstNumber('ET-454').value,454);
 assert.equal(findFirstNumber('ET-454',{negativeAware:true}).value,-454);
 assert.equal(findFirstNumber('숫자 없음'),null);
 const f=findFirstNumber('X1');
 assert.equal(f.value,1);assert.equal(f.before,'X');assert.equal(f.after,'');
});
test('formatNumber: 그룹핑·음수·소숫점',()=>{
 assert.equal(formatNumber(1234567,0,true),'1,234,567');
 assert.equal(formatNumber(1234.5,2,true),'1,234.50');
 assert.equal(formatNumber(-1234.5,2,true),'-1,234.50');
 assert.equal(formatNumber(3,null,false),'3');
 assert.throws(()=>formatNumber(NaN));
});

// ── COI / COR / EDP ──
test('insertCommas / removeCommas: 왕복해도 값이 같다',()=>{
 assert.equal(insertCommas('3455x234'),'3,455x234');
 assert.equal(insertCommas('34,455.45와 5234.1'),'34,455.45와 5,234.1');
 assert.equal(removeCommas('3,455x234'),'3455x234');
 assert.equal(removeCommas(insertCommas('실면적 12345.6㎡')),'실면적 12345.6㎡');
});
test('fixDecimalPlaces: 자릿수를 맞추고 기존 콤마는 유지한다',()=>{
 assert.equal(fixDecimalPlaces('34,455.45와 5234.1',3),'34,455.450와 5234.100');
 assert.equal(fixDecimalPlaces('12',0),'12');
 assert.throws(()=>fixDecimalPlaces('12',-1));
 assert.throws(()=>fixDecimalPlaces('12',7));
});

// ── NUC ──
test('calc: 사칙연산과 0 나누기',()=>{
 assert.equal(calc(3,'+',2),5);
 assert.equal(calc(3,'-',2),1);
 assert.equal(calc(3,'*',2),6);
 assert.equal(calc(3,'/',2),1.5);
 assert.throws(()=>calc(3,'/',0));
 assert.throws(()=>calc(NaN,'+',1));
});
test('applyBulkCalc: 문자+숫자 혼합, 음수 고려 옵션',()=>{
 assert.equal(applyBulkCalc('X1',{operator:'+',operand:1}),'X2');
 assert.equal(applyBulkCalc('ET-454',{operator:'+',operand:1,negativeAware:false}),'ET-455');
 assert.equal(applyBulkCalc('ET-454',{operator:'+',operand:1,negativeAware:true}),'ET-453');
 assert.equal(applyBulkCalc('12.5',{operator:'*',operand:2,decimals:1}),'25.0');
});

// ── LMA / LNA ──
test('레벨 문자 파싱·재구성',()=>{
 assert.equal(parseLevelText('±0.000'),0);
 assert.equal(parseLevelText('+3.600'),3.6);
 assert.equal(parseLevelText('-1.200'),-1.2);
 assert.equal(formatLevelText(0),'±0.000');
 assert.equal(formatLevelText(3.6),'+3.600');
 assert.equal(formatLevelText(-1.2),'-1.200');
 assert.equal(shiftLevelText('+3.600',0.9),'+4.500');
 assert.equal(shiftLevelText('+3.600',-3.6),'±0.000');
 assert.throws(()=>parseLevelText('abc'));
});
test('레벨 문자 실무 표기(FL+3,000 · GL+1,200 · EL+3000 · SL-1,500 · mm/m 단위)를 읽고 같은 형식으로 다시 쓴다(2026-09-24 F6)',()=>{
 assert.equal(parseLevelText('FL+3,000'),3);
 assert.equal(parseLevelText('GL+1,200'),1.2);
 assert.equal(parseLevelText('EL+3000'),3);
 assert.equal(parseLevelText('SL-1,500'),-1.5);
 assert.equal(parseLevelText('+3000mm'),3);
 assert.equal(parseLevelText('FL 3.6 m'),3.6);
 assert.equal(parseLevelText('EL. +3.600'),3.6);
 assert.equal(shiftLevelText('FL+3,000',3),'FL+6,000');
 assert.equal(shiftLevelText('GL+1,200',0.5),'GL+1,700');
 assert.equal(shiftLevelText('EL+3000',-3),'EL±0');
 assert.equal(shiftLevelText('SL-1,500',0.5),'SL-1,000');
 assert.equal(shiftLevelText('FL 3.6 m',0.5),'FL 4.1 m');
 assert.equal(shiftLevelText('3000',0.5),'3500');
 assert.equal(parseLevelParts('FL+3,000').unit,'mm');
 assert.equal(parseLevelParts('+3.600').unit,'m');
 // 검토자 지적 4: 접두어가 있고 소숫점이 없으면 mm("FL-50"=-50mm), 콤마가 있으면 소숫점이 있어도 mm, 층 접두어(1FL·B1FL·RFL) 허용
 assert.equal(parseLevelText('FL-50'),-0.05);
 assert.equal(shiftLevelText('FL-50',3),'FL+2950');
 assert.equal(parseLevelText('FL+99'),0.099);
 assert.equal(parseLevelText('+3,000.5'),3.0005);
 assert.equal(shiftLevelText('+3,000.5',0.0005),'+3,001.0');
 assert.equal(parseLevelText('1FL+3,000'),3);
 assert.equal(shiftLevelText('1FL+3,000',0.5),'1FL+3,500');
 assert.equal(parseLevelText('B1FL-3,300'),-3.3);
 assert.equal(parseLevelText('+3'),3,'접두어·소숫점 없는 작은 정수는 m');
 assert.equal(shiftLevelText('±0',0.5),'+0.500');
 assert.equal(shiftLevelText('FL±0',0.5),'FL+500');
 // 검토자 재지적 ②: 한 글자 L 접두어는 부호가 있어야 레벨, 접두어 뒤 부호·공백·콤마·소숫점이 없으면("FL50") 레벨 아님, 맨 "+50" 은 애매
 assert.throws(()=>parseLevelText('L3'),/"L3"/);
 assert.equal(parseLevelText('L+3,000'),3);
 assert.throws(()=>parseLevelText('FL50'),/"FL50"/);
 assert.equal(parseLevelText('FL 3,000'),3);
 const amb=parseLevelParts('+50');
 assert.equal(amb.ambiguous,true);assert.equal(amb.unit,'m');
 assert.equal(parseLevelParts('+50',{defaultUnit:'mm'}).meters,0.05);
 assert.equal(parseLevelParts('+50',{defaultUnit:'mm'}).ambiguous,false);
 assert.equal(shiftLevelText('+50',0.5,3,{defaultUnit:'mm'}),'+550');
 assert.equal(inferDrawingLevelUnit([{id:'a',type:'text',text:'FL+3,000'},{id:'b',type:'text',text:'거실'},{id:'c',type:'text',text:'+50'}]),'mm');
 assert.equal(inferDrawingLevelUnit([{id:'a',type:'text',text:'+3.600'}]),'m');
 assert.equal(inferDrawingLevelUnit([{id:'c',type:'text',text:'+50'}]),null);
 assert.equal(formatLevelLike(parseLevelParts('±0.000'),3.6),'+3.600');
 // 레벨 접두어(…L)가 아닌 일반 기호·한글은 값이 보이는 오류
 assert.throws(()=>parseLevelText('A-1'),/"A-1"/);
 assert.throws(()=>parseLevelText('거실'),/"거실"/);
});
test('parseLevelDelta: "+500"/"-300"(mm) → 미터',()=>{
 assert.equal(parseLevelDelta('+500'),0.5);
 assert.equal(parseLevelDelta('-300'),-0.3);
 assert.throws(()=>parseLevelDelta('500'));
});

// ── INA ──
test('indexSums: 기호별 합산',()=>{
 const r=indexSums(['W2: 23.54','W2: 10','G1: 5.5','문자만']);
 assert.equal(r.total,39.04);
 const w2=r.groups.find(g=>g.symbol==='W2');
 assert.equal(w2.sum,33.54);
 assert.throws(()=>indexSums(['숫자만 있음 3.0']));
});

// ── BA ──
test('allocateShareArea: 전용면적 비율로 공용면적 배분',()=>{
 const r=allocateShareArea([60,40],20);
 assert.equal(r.sumExclusive,100);
 assert.equal(r.allocated[0],72);
 assert.equal(r.allocated[1],48);
 assert.equal(r.total,120);
 assert.throws(()=>allocateShareArea([0,0],10));
});
test('sumTexts: 문자 배열 합산',()=>{
 assert.equal(sumTexts([{text:'12.5'},{text:'7.5㎡'}]),20);
 assert.throws(()=>sumTexts([{text:'숫자 없음'}]));
});

// ── MAC ──
test('chainClosedLoop: 네 변을 하나의 닫힌 고리로 잇는다',()=>{
 const square=[
  {type:'line',points:[{x:0,y:0},{x:1000,y:0}]},
  {type:'line',points:[{x:1000,y:1000},{x:1000,y:0}]},
  {type:'line',points:[{x:1000,y:1000},{x:0,y:1000}]},
  {type:'line',points:[{x:0,y:0},{x:0,y:1000}]},
 ];
 const loop=chainClosedLoop(square,0.5);
 assert.equal(loop.length,4);
 assert.equal(Math.round(G.polygonArea(loop)),1000*1000);
});
test('chainClosedLoop: 연결 안 된 선분이 있으면 오류',()=>{
 const broken=[
  {type:'line',points:[{x:0,y:0},{x:1000,y:0}]},
  {type:'line',points:[{x:2000,y:2000},{x:3000,y:2000}]},
  {type:'line',points:[{x:1000,y:1000},{x:0,y:1000}]},
 ];
 assert.throws(()=>chainClosedLoop(broken,0.5));
});
test('segmentsOf: 사각형은 닫힌 네 변을 돌려준다',()=>{
 const rect={type:'rectangle',points:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]};
 assert.equal(segmentsOf(rect).length,4);
});

// ── HV / HW ──
test('rectangleWidthHeight: 가로x세로',()=>{
 const rect={type:'rectangle',points:[{x:0,y:0},{x:3000,y:0},{x:3000,y:2000},{x:0,y:2000}]};
 const r=rectangleWidthHeight(rect);
 assert.equal(r.w,3000);assert.equal(r.h,2000);assert.equal(r.area,6e6);
 assert.throws(()=>rectangleWidthHeight({points:[{x:0,y:0},{x:1,y:1}]}));
});
test('triangleBaseHeightArea: 직각삼각형',()=>{
 const m=triangleBaseHeightArea([{x:0,y:0},{x:4000,y:0},{x:0,y:3000}]);
 assert.equal(m.base,5000); // 빗변이 가장 긴 변
 assert.equal(m.area,6e6);
 assert.ok(Math.abs(m.height-2400)<1e-6);
 assert.throws(()=>triangleBaseHeightArea([{x:0,y:0},{x:1,y:0}]));
});

// ── CDN ──
test('northSlopeOffset: 기준높이 이하 1.5m, 초과분은 (h-기준)/2 추가',()=>{
 assert.equal(northSlopeOffset(5,9),1.5);
 assert.equal(northSlopeOffset(9,9),1.5);
 assert.equal(northSlopeOffset(13,9),3.5);
 assert.equal(northSlopeOffset(10,10),1.5);
});
test('northSlopeCheckLines: 간격마다 검토선을 만들고 마지막은 검토높이',()=>{
 const lines=northSlopeCheckLines(9,10,3);
 assert.deepEqual(lines.map(l=>l.height),[3,6,9,10]);
 assert.equal(lines.at(-1).offset,northSlopeOffset(10,9));
 assert.throws(()=>northSlopeCheckLines(9,0,3));
 assert.throws(()=>northSlopeCheckLines(9,10,0));
});

// ── 카드 진입점 구조 ──
test('installAreaTools: 19개 명령을 모두 내보낸다',()=>{
 const calls=[];
 const ctx={toast:(msg,isError)=>calls.push({msg,isError}),selected:()=>[],selectedIds:()=>[],pickEntity:async()=>null,pickPoint:async()=>null,pickPath:async()=>null,tolerance:()=>1,execute:()=>{},commit:()=>{},form:()=>{},ensureLayer:()=>'layer-id',num:(k,d)=>d,log:()=>{},userErrorMessage:e=>e.message};
 const commands=installAreaTools(ctx);
 const expected=['DEE','CDN','COI','COR','EDP','INA','LMA','LNA','MAC','NUC','QD','BA','HV','HW','ND','NP','NS'];
 assert.equal(Object.keys(commands).length,expected.length);
 for(const name of expected)assert.equal(typeof commands[name],'function',`${name} 명령이 없습니다`);
});
test('installAreaTools: DEE 는 "없음" 토스트를 띄우고 아무것도 만들지 않는다 · 삭제한 ZAE·FFO 는 없다',()=>{
 const calls=[];
 const ctx={toast:(msg,isError)=>calls.push({msg,isError}),selected:()=>[],execute:()=>{throw Error('없음 카드는 execute 를 호출하면 안 됩니다');},commit:()=>{throw Error('없음 카드는 commit 을 호출하면 안 됩니다');},userErrorMessage:e=>e.message};
 const commands=installAreaTools(ctx);
 commands.DEE();
 assert.equal(calls.length,1);
 assert.ok(calls.every(c=>c.isError===true));
 assert.match(calls[0].msg,/DEE/);
 assert.ok(!('ZAE' in commands)&&!('FFO' in commands));
});
test('installAreaTools: 선택 객체가 없으면 오류를 토스트로 안내한다(guard)',async()=>{
 const calls=[];
 const ctx={toast:(msg,isError)=>calls.push({msg,isError}),selected:()=>[],pickEntity:async()=>null,userErrorMessage:e=>e.message};
 const commands=installAreaTools(ctx);
 await commands.COI();
 assert.equal(calls.length,1);
 assert.equal(calls[0].isError,true);
 assert.match(calls[0].msg,/선택한 객체가 없습니다/);
});
