import test from 'node:test';
import assert from 'node:assert/strict';
import {collectTexts,parseOverviewValue,readOverviewFromTexts,readOverviewFromDocument,storedOverview,mergeOverview,applyOverviewEdits,overviewSettings,overviewState,overviewRows,overviewEditsFromRows} from './building-overview.js';

const T=(text,x,y,h=250)=>({type:'text',text,position:{x,y},height:h});
// 개요표: 제목 아래 이름 칸(x=0)과 값 칸(x=4000) 두 줄 표. 도곽은 멀리.
const table=[T('건 축 개 요',0,10000,400),T('공 사 명',0,9000),T('전주 엿봄 중정집',4000,9000),T('대지위치',0,8500),T('전북 전주시 완산구 ○○동 123-4',4000,8500),
 T('지역 · 지구',0,8000),T('제1종일반주거지역',4000,8000),T('대지면적',0,7500),T('412.50㎡',4000,7500),T('(124.78평)',7000,7500),
 T('건축면적',0,7000),T('165.30 m2',4000,7000),T('건 폐 율',8000,7000),T('40.07%',11000,7000),
 T('연 면 적',0,6500),T('612.4㎡',4000,6500),T('598.7㎡',6500,6500),T('주 용 도',0,6000),T('단독주택',4000,6000),
 T('구 조',0,5500),T('철근콘크리트조',4000,5500),T('규 모',0,5000),T('지상 5층',4000,5000),T('층 고',0,4500),T('3.0m',4000,4500)];
const frame=[T('바른건축사사무소',200000,-50000)];

test('개요표: 제목 아래 이름·값을 줄마다 읽고 근거를 적는다(10-27 도면 인식 ①)',()=>{
 const r=readOverviewFromTexts(collectTexts([...table,...frame]));
 assert.equal(r.status,'title');
 assert.equal(r.values.name,'전주 엿봄 중정집');assert.equal(r.values.address,'전북 전주시 완산구 ○○동 123-4');
 assert.equal(r.values.zone,'제1종일반주거지역');assert.equal(r.values.siteArea,412.5);assert.equal(r.values.buildingArea,165.3);
 assert.equal(r.values.mainUse,'단독주택');assert.equal(r.values.structure,'철근콘크리트조');
 assert.equal(r.values.floorsAbove,5);assert.equal(r.values.floorsBelow,0);assert.equal(r.values.storyHeight,3000);
 assert.equal(r.values.office,'바른건축사사무소');assert.match(r.evidence.office,/도곽/);
 assert.equal(r.evidence.siteArea,"개요표 · '대지면적' 줄 → '412.50㎡ (124.78평)'");
 // 연면적 숫자가 둘 → 비워 두고 확인 필요(추측하지 않는다)
 assert.equal(r.values.gfa,undefined);assert.match(r.confirm.find(c=>c.key==='gfa').reason,/612\.4 · 598\.7/);
});

test('개요표 값: 평·% 는 빼고 ㎡ 숫자, 지하·지상, 층고 m→mm',()=>{
 assert.deepEqual(parseOverviewValue('area','1,234.5㎡(373.4평)'),{value:1234.5});
 assert.deepEqual(parseOverviewValue('floors','지하 1층, 지상 3층'),{value:{above:3,below:1}});
 assert.deepEqual(parseOverviewValue('floors','B2 / 지상 7층'),{value:{above:7,below:2}});
 assert.ok(parseOverviewValue('floors','옥탑').reason);
 assert.deepEqual(parseOverviewValue('mm','2,900'),{value:2900});
 assert.ok(parseOverviewValue('mm','1층 3.3m, 2층 3.0m').reason);
});

test('한 글자 안 "이름 : 값", 이름 뒤 한글이 붙으면 다른 칸(용도 ≠ 용도지역)',()=>{
 const r=readOverviewFromTexts(collectTexts([T('건축개요',0,1000),T('용도지역 : 일반상업지역',0,0),T('용도 : 근린생활시설',0,-500)]));
 assert.equal(r.values.zone,'일반상업지역');assert.equal(r.values.mainUse,'근린생활시설');
});

test('제목이 없으면 도면 전체, 여럿이면 알리고, 윈도우를 주면 그 안만',()=>{
 const noTitle=readOverviewFromTexts(collectTexts(table.slice(1)));assert.equal(noTitle.status,'none');assert.equal(noTitle.values.siteArea,412.5);
 const two=[...table,T('건축개요',100000,10000,400),T('대지면적',100000,9000),T('900㎡',104000,9000)];
 assert.equal(readOverviewFromTexts(collectTexts(two)).status,'many');
 const w=readOverviewFromTexts(collectTexts(two),{window:[{x:99000,y:9500},{x:110000,y:8500}]});
 assert.equal(w.status,'window');assert.equal(w.values.siteArea,900);assert.match(w.evidence.siteArea,/^감싼 범위/);
});

// 2026-10-27 설명서 예제(생성기가 그린 한 벌)에서: 값 칸이 오른쪽 끝에 붙은 연면적을 못 읽고, 도면 목록의 'A-002 건축개요' 줄을
// 제목으로 세어 도면 전체를 뒤지다 메모 문장 '용도지역·설계값…'을 지역·지구 값으로 읽었다.
test('목록표의 "A-002 건축개요" 줄은 제목이 아니고, 멀리 붙은 값도 같은 줄이면 읽고, "이름·한글…" 문장은 칸이 아니다',()=>{
 const sheet=[T('도면 목록',0,30000,360),T('A-002',0,29000,300),T('건축개요',3000,29000,300),T('1/120',9000,29000,300),
  T('건축개요',55920,-6300,360),T('주용도',56160,-8775,300),T('단독주택',57840,-8775,300),T('연면적',56160,-10575,300),T('31.86㎡',65940,-10575,300),
  T('용도지역·설계값·평가서 미확인은 검토필요',90000,-20000,300)];
 const r=readOverviewFromTexts(collectTexts(sheet));
 assert.equal(r.status,'title');assert.equal(r.values.gfa,31.86);assert.equal(r.values.mainUse,'단독주택');assert.equal(r.values.zone,undefined);
 const all=readOverviewFromTexts(collectTexts(sheet.filter(t=>t.text!=='건축개요')));
 assert.equal(all.values.zone,undefined);
 assert.equal(readOverviewFromTexts(collectTexts([T('건축개요',0,1000),T('용도지역·지구',0,0),T('제2종일반주거지역',4000,0)])).values.zone,'제2종일반주거지역');
});

test('블록 안 글자·다행문자 서식도 읽는다',()=>{
 const texts=collectTexts([{type:'block',entities:[{type:'mtext',text:'{\\fArial;대지면적 : 200㎡}\\P연면적 : 350㎡',position:{x:0,y:0},height:200}]}]);
 assert.deepEqual(texts.map(t=>t.text),['대지면적 : 200㎡','연면적 : 350㎡']);
 const r=readOverviewFromDocument({entities:[{type:'block',entities:[{type:'mtext',text:'대지면적 : 200㎡\\P연면적 : 350㎡',position:{x:0,y:0},height:200}]}]});
 assert.equal(r.values.siteArea,200);assert.equal(r.values.gfa,350);
});

test('합치기: 빈 칸만 채우고, 같으면 그대로, 다르면 고르게 남긴다',()=>{
 const doc={reviewSettings:{permitBook:{overview:{name:'내가 쓴 이름',siteArea:412.5,date:'2026-10-01'}}}};
 const stored=storedOverview(doc);assert.equal(stored.evidence.name,'인허가 개요 윈도우');
 const read={values:{name:'전주 엿봄 중정집',siteArea:412.50,zone:'제1종일반주거지역'},evidence:{name:'개요표',siteArea:'개요표',zone:'개요표'},confirm:[{key:'gfa',reason:'숫자 둘'},{key:'zone',reason:'x'}]};
 const m=mergeOverview(stored,read,{now:'2026-10-27T10:55:00Z'});
 assert.equal(m.values.name,'내가 쓴 이름');assert.equal(m.values.zone,'제1종일반주거지역');
 assert.deepEqual(m.conflicts.map(c=>[c.key,c.mine,c.read]),[['name','내가 쓴 이름','전주 엿봄 중정집']]);
 assert.deepEqual(m.confirm.map(c=>c.key),['gfa']);   // 값이 채워진 칸의 확인 필요는 남기지 않는다
 const e=applyOverviewEdits(m,{name:'전주 엿봄 중정집',gfa:612.4});
 assert.equal(e.conflicts.length,0);assert.equal(e.confirm.length,0);assert.equal(e.evidence.gfa,'설계자 입력');
 const s=overviewSettings(doc,e);
 assert.equal(s.permitBook.overview.gfa,612.4);assert.equal(s.permitBook.overview.date,'2026-10-01');assert.equal(s.buildingOverview,e);
 assert.deepEqual(overviewState({reviewSettings:{buildingOverview:m}}),{read:true,readAt:'2026-10-27T10:55:00Z',confirm:2});
 assert.deepEqual(overviewState({}),{read:false,readAt:null,confirm:0});
});

// 2026-10-27: 처음 읽기에서 잘못 읽은 값(메모 문장)이 고친 뒤 [다시 읽기]를 해도 남았다. 자동으로 읽은 값은 다시 읽은 결과를 따른다.
test('합치기: 자동으로 읽은 값은 다시 읽기를 따르고(없어지면 확인 필요), 설계자가 넣은 값은 지킨다',()=>{
 const stored={values:{zone:'·설계값·평가서',gfa:30,name:'내 이름'},evidence:{zone:"도면 · '용도지역' 줄 → '·설계값'",gfa:"개요표 · '연면적' 줄 → '30㎡'",name:'설계자 입력'},confirm:[],conflicts:[]};
 const read={values:{gfa:31.86,name:'다른 이름'},evidence:{gfa:"개요표 · '연면적' 줄 → '31.86㎡'",name:'개요표'},confirm:[{key:'zone',reason:"개요표에서 '지역·지구' 칸을 못 찾음"}]};
 const m=mergeOverview(stored,read,{now:'t'});
 assert.equal(m.values.zone,undefined);assert.deepEqual(m.confirm.map(c=>c.key),['zone']);
 assert.equal(m.values.gfa,31.86);assert.equal(m.values.name,'내 이름');
 assert.deepEqual(m.conflicts.map(c=>c.key),['name']);
});

test('엑셀: 내보낸 표를 고쳐 가져오면 바뀐 칸만 고친다',()=>{
 const store={values:{name:'가',siteArea:412.5,floorsAbove:5},evidence:{name:'개요표'},confirm:[{key:'gfa',reason:'숫자 둘'}],conflicts:[]};
 const rows=overviewRows(store);
 assert.deepEqual(rows[0],['칸','값','근거','확인 필요','키']);
 assert.deepEqual(rows.find(r=>r[4]==='gfa'),['연면적 ㎡','','','숫자 둘','gfa']);
 const edited=rows.map(r=>r[4]==='gfa'?[r[0],'612.4',r[2],r[3],r[4]]:r[4]==='siteArea'?[r[0],412.5,r[2],r[3],r[4]]:r[4]==='floorsAbove'?[r[0],6,r[2],r[3],r[4]]:r);
 assert.deepEqual(overviewEditsFromRows(edited,store),{edits:{gfa:612.4,floorsAbove:6},changed:['연면적 ㎡','지상 층수']});
 assert.throws(()=>overviewEditsFromRows([['a','b']],store),/키/);
 assert.throws(()=>overviewEditsFromRows([['키','값'],['gfa','많이']],store),/숫자가 아닙니다/);
});
