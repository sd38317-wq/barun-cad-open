import test from 'node:test';
import assert from 'node:assert/strict';
import {structureArgs,memberRows,STRUCTURE_FORMS,structureFormCards} from './structure-review.js';
import {MAJOR_REPAIR_ITEMS,extensionAreas,permitKind,reviewTableRows} from './extension-review.js';

// 구조 검토(통과 시안 ⑪): 화면 값이 AI 도구와 같은 인자로 엔진에 간다. 모르는 값은 보내지 않는다(자료 부족으로 남김).
test('1~2층은 RC 카드 한 장(철근콘크리트), 3층부터 벽식·라멘 둘',()=>{
 for(const n of [1,2,'']){const c=structureFormCards(n);
  assert.deepEqual(c.map(x=>x[1]),['철근콘크리트 (RC)','철골','목구조']);
  assert.deepEqual(c[0][3],['rc-wall','rc-moment'],'예전에 라멘을 골랐어도 합친 카드에 불이 켜진다');}
 assert.deepEqual(structureFormCards(3).map(x=>x[1]),['벽식 (RC)','라멘 (RC)','철골','목구조']);
 assert.equal(structureFormCards(2)[0][0],'rc-wall','합친 카드를 누르면 벽식 — 3층으로 고치면 벽식이 골라져 있다');
});
test('구조 형식 넷과 엔진 인자',()=>{
 assert.deepEqual(STRUCTURE_FORMS.map(f=>f[1]),['벽식 (RC)','라멘 (RC)','철골','목구조']);
 assert.deepEqual(structureArgs({form:'rc-wall',outlineId:'e1',stories:2,storyHeight:3000,use:'house',Fe:''}),{system:'rc',mode:'check',outline:{entityId:'e1'},stories:2,storyHeight:3000,use:'house'});
 assert.equal(structureArgs({form:'rc-moment',outlineId:'e1',stories:4,storyHeight:3000,use:'retail'}).structureType,'rc-moment','3~5층 엔진만 형식을 받는다');
 assert.deepEqual(structureArgs({form:'steel',outlineId:'e1',stories:2,Fe:'150'}).soil,{Fe:150});
 assert.throws(()=>structureArgs({form:'rc-wall',stories:2}),/외곽/);
 assert.throws(()=>structureArgs({form:'wood',outlineId:'e',stories:4}),/목구조는 3층/);
 assert.throws(()=>structureArgs({form:'rc-wall',outlineId:'e',stories:6}),/1~5층/);
});

test('부재 요약은 종류별로 묶는다',()=>{
 const rows=memberRows([{code:'C1',kind:'column',count:4,size:'400x400'},{code:'C2',kind:'column',count:2,size:'500x500'},{code:'W1',kind:'wall',count:8,size:'200'}]);
 assert.deepEqual(rows.map(r=>[r.label,r.count,r.sizes.join(',')]),[['기둥',6,'400x400,500x500'],['내력벽',8,'200']]);
});

// 증축·대수선(통과 시안 ⑫). 법 원문 2026-10-26 대조: 시행령 제3조의2(7호 삭제) · 법 제14조①1·3·4호 · 시행령 제11조②.
test('대수선 항목은 시행령 제3조의2 1~6·8·9호(7호 삭제)',()=>{
 assert.deepEqual(MAJOR_REPAIR_ITEMS.map(i=>i[2]),[1,2,3,4,5,6,8,9]);
});

test('면적표: 기존 + 증축 − 철거, 건폐율·용적률',()=>{
 const a=extensionAreas({existing:{arch:132.4,floor:396},added:{arch:28.6,floor:57.2},removed:{}},270);
 assert.equal(Math.round(a.arch*10)/10,161);assert.equal(Math.round(a.floor*10)/10,453.2);
 assert.equal(Math.round(a.coverage*10)/10,59.6);assert.equal(extensionAreas({existing:{arch:1}},0).coverage,null);
});

test('허가·신고 예비 판정',()=>{
 assert.equal(permitKind({existingFloor:396,addedFloor:57.2,floors:2}).kind,'신고','85㎡ 이내 증축');
 assert.equal(permitKind({existingFloor:396,addedFloor:57.2,floors:3}).kind,'허가','3층 이상은 연면적 1/10(39.6㎡) 이내만 신고');
 assert.equal(permitKind({existingFloor:396,addedFloor:30,floors:3}).kind,'신고');
 assert.equal(permitKind({existingFloor:150,floors:2,repairs:{column:'change'}}).kind,'신고','200㎡ 미만·3층 미만 대수선');
 assert.equal(permitKind({existingFloor:500,floors:4,repairs:{column:'repair',stair:'repair'}}).kind,'신고','주요구조부 해체 없는 수선만');
 assert.equal(permitKind({existingFloor:500,floors:4,repairs:{finish:'repair'}}).kind,'허가','외벽 마감재는 제11조② 목록에 없다');
 const big=permitKind({existingFloor:500,floors:4,repairs:{beam:'change'}});assert.equal(big.kind,'허가');assert.equal(big.structural,true);
 assert.equal(permitKind({}).kind,'해당 없음');
});

test('검토표 줄',()=>{
 const state={existing:{arch:100,floor:200},added:{arch:20,floor:40},removed:{},repairs:{stair:'repair'}};
 const rows=reviewTableRows({...state,siteArea:250,areas:extensionAreas(state,250),permit:{kind:'신고'},limits:{coverage:60,far:200}});
 assert.deepEqual(rows[2],['건축면적(㎡)','100.0','20.0','0.0','120.0']);
 assert.ok(rows.some(r=>r[0]==='대수선 6호'));assert.deepEqual(rows.at(-1),['허가·신고','신고','','','예비 판정 — 관할 확인']);
});
// 2026-10-27 설명서 시험: 구조 검토 화면에 AI 용 안내('mode=design 으로 부르세요')와 벽 ID 목록이 그대로 나왔다.
import {screenMessage} from './structure-review.js';
test('screenMessage: AI 용 안내·ID 를 화면 말로 바꾼다',()=>{
 const m=screenMessage('1층 벽(a4ebf381-1a4c-48a5-ac7b-675055374256, 171e72f3-0a59-4cd7-aa4e-4b3fbb41871f)에 어느 벽에 붙었는지 정해지지 않은 창·문(s1-o1, s1-o2)이 있어 개구부를 뺀 벽 길이를 셀 수 없습니다. 그 창·문을 벽에 붙여 그리거나(문 D1·창 W1 명령) 사용자에게 어느 벽인지 확인한 뒤 다시 검토하세요. 벽을 읽지 않는 구조 시안만 원하면 mode=design 으로 부르세요.');
 assert.doesNotMatch(m,/mode=design|[0-9a-f]{8}-[0-9a-f]{4}|사용자에게/);
 assert.match(m,/\[외곽만으로 구조 시안\]/);
 assert.match(m,/창·문/);
 assert.equal(screenMessage('평면을 읽지 못했습니다: x (도면에 벽이 아직 없어 외곽만으로 시안을 원하면 mode=design 으로 다시 부르세요.)'),'평면을 읽지 못했습니다: x (도면에 벽이 아직 없어 외곽만으로 시안을 원하면 검토 방식에서 [외곽만으로 구조 시안]을 고르세요.)');
});
// 2026-10-27: 개요(도면 인식)에 지상 1층·층고·주용도가 있는데 구조 검토가 2층·주택 기본값으로 열렸다.
import {structureDefaults} from './structure-review.js';
test('structureDefaults: 개요의 지상 층수·층고·주용도로 빈칸을 채운다',()=>{
 assert.deepEqual(structureDefaults({floorsAbove:1,storyHeight:2900,mainUse:'단독주택'}),{stories:1,storyHeight:2900,use:'house'});
 assert.deepEqual(structureDefaults({floorsAbove:3,mainUse:'제2종 근린생활시설'}),{stories:3,use:'retail'});
 assert.deepEqual(structureDefaults({mainUse:'업무시설',floorsAbove:9}),{use:'other'});   // 구조 엔진은 5층까지
 assert.deepEqual(structureDefaults(null),{});
});
// 2026-10-27: 개요에 대지 주소가 있는데 구조 검토가 '대지 주소나 위치를 알려 주세요'(바람·눈)로 남았다.
test('개요 대지 주소를 구조 검토 위치로 넘긴다',()=>{
 assert.deepEqual(structureDefaults({address:'부산 부산진구 양정동 156-7'}),{location:'부산 부산진구 양정동 156-7'});
 assert.equal(structureArgs({form:'wood',outlineId:'e1',stories:1,storyHeight:3000,use:'house',Fe:'',location:'부산 부산진구 양정동 156-7'}).location,'부산 부산진구 양정동 156-7');
 assert.equal('location' in structureArgs({form:'wood',outlineId:'e1',stories:1,storyHeight:3000,use:'house',Fe:''}),false);
});
// 2026-10-27 대표 승인 시안(docs/시안-구조검토-확인할것-2026-10-27): '확인할 것'을 화면에서 채운다. 모르는 칸(빈 값)은 보내지 않는다.
import {checkText} from './structure-review.js';
test('확인할 것 칸 → 엔진 인자',()=>{
 const base={form:'steel',outlineId:'e1',stories:1,storyHeight:3000,use:'house',Fe:''};
 const a=structureArgs({...base,wind:'D35',snow:'east',basement:'no',siteSlope:'1.2',landfill:'no',roof:'gable',pitch:'18',legalOk:true});
 assert.equal(a.wind,'D35');assert.equal(a.snow,'east');assert.equal(a.basement,false);assert.equal(a.siteSlope,1.2);
 assert.deepEqual(a.soil,{landfill:false});assert.equal(a.roof,'gable');assert.equal(a.pitch,18);assert.deepEqual(a.legal,{excluded32_2_3to8Confirmed:true});
 const b=structureArgs({...base,wind:'',snow:'',basement:'',siteSlope:'',landfill:'',roof:'',pitch:'',legalOk:false,Fe:'150'});
 for(const k of ['wind','snow','basement','siteSlope','roof','pitch','legal'])assert.equal(k in b,false,k);
 assert.deepEqual(b.soil,{Fe:150});
 assert.equal('roof' in structureArgs({...base,form:'rc-wall',roof:'gable',pitch:'30'}),false);   // RC 는 평지붕 검토 — 지붕 칸 없음
 assert.equal(structureArgs({...base,basement:'yes',landfill:'yes',Fe:'120'}).basement,true);
 assert.deepEqual(structureArgs({...base,landfill:'yes',Fe:'120'}).soil,{Fe:120,landfill:true});
});
test('checkText: 영문 코드·같은 말 반복을 뺀다',()=>{
 assert.equal(checkText({item:'지하층',value:'지하층이 있는지 확인해 주세요.',required:'지하층이 있는지 확인해 주세요.',fix:'input'}),'지하층: 지하층이 있는지 확인해 주세요.');
 assert.equal(checkText({item:'법적 소규모 제외조건 확인',value:'제3~8호 비해당 확인 필요',required:'legal.smallBuildingConfirmed: 높이·처마 비해당 확인',fix:'field'}),'법적 소규모 제외조건 확인: 제3~8호 비해당 확인 필요 (기준 높이·처마 비해당 확인) — 현장 확인');
 assert.equal(checkText({item:'배치',value:'간격 9.25 m',required:'6 m 이하',fix:'layout'}),'배치: 간격 9.25 m (기준 6 m 이하) — 도면에서 고치기');
});
// 2026-10-27: 한 벌이 다 그려진 도면에서 구조도(기본 '건물 오른쪽 10 m')가 옆 장(지붕 평면도) 위에 겹쳐 그려졌다.
import {structureSheetOrigin} from './structure-review.js';
test('structureSheetOrigin: 도면 전체의 오른쪽 빈 곳(10 m 띄움), 아래 줄은 도면 맨 아래에 맞춘다',()=>{
 const es=[{type:'line',points:[{x:0,y:-5000},{x:80000,y:-5000}]},{type:'line',points:[{x:10,y:-200000},{x:20,y:3000}]}];
 assert.deepEqual(structureSheetOrigin(es),{x:90000,y:-200000});
 assert.equal(structureSheetOrigin([]),undefined);
});
// 2026-10-27 구조 장 템플릿: 상세 칸에 쓰인 부재에 맞는 바른 표준 철골 상세를 고른다. 맞는 상세가 없으면(기초 단면 등) 비워 둔다.
import {slotDetail} from './structure-review.js';
test('slotDetail: 칸 이름 → 라이브러리 철골 상세(이름 일치 첫 것), 철골 아니면 없음',()=>{
 const lib=[{id:'ST-a',name:'노출형 주각 평면 — BASE PL-90',group:'steel'},{id:'ST-b',name:'작은보-큰보 웨브 접합 — PL-8',group:'steel'},{id:'W-1',name:'노출형 주각 아님',group:'wall'}];
 assert.equal(slotDetail('주각 상세',lib,'steel')?.id,'ST-a');
 assert.equal(slotDetail('작은보-큰보 접합',lib,'steel')?.id,'ST-b');
 assert.equal(slotDetail('기초 단면',lib,'steel'),null);
 assert.equal(slotDetail('주각 상세',lib,'rc-wall'),null);
});
// 2026-10-28 설명서 녹화: 명령창 STRUCTUREREVIEW·EXTENSIONREVIEW 가 '알 수 없는 명령'(카드로만 열림).
import {resolveCommand,defaultAliases} from './commands.js';
test('명령창에서 STRUCTUREREVIEW·EXTENSIONREVIEW 로 연다',()=>{
 const settings={aliases:defaultAliases()};
 for(const name of ['STRUCTUREREVIEW','EXTENSIONREVIEW','APARTMENT','PERMITBOOK'])assert.equal(resolveCommand(name,settings),name);
});
// 2026-10-28: 층수 기본값 2 로 단층 집도 2층으로 검토됐다. 모르면 비워 두고(도면 그대로 검토는 엔진이 도면에서 읽은 층 수), 시안은 층수를 묻는다.
test('층수를 모르면 보내지 않는다(도면 그대로 검토), 외곽만 시안은 층수를 묻는다',()=>{
 assert.equal('stories' in structureArgs({form:'rc-wall',outlineId:'e1',stories:''}),false);
 assert.throws(()=>structureArgs({form:'steel',outlineId:'e1',stories:'',mode:'design'}),/층수/);
});
// 2026-10-28: 엔진·서버 안내가 개발용 말 그대로(sameLayoutUpper=true, steel × check).
test('층수 불일치·지원 안 하는 검토 방식을 사람 말로',()=>{
 const m=screenMessage('층수가 읽은 평면과 다릅니다(도면에서 읽은 층 1개, 요청 2층). 위층이 1층과 같은 배치라고 사용자가 확인했으면 sameLayoutUpper=true 로, 아니면 층별 boxes 또는 floors를 지정하세요.');
 assert.doesNotMatch(m,/sameLayoutUpper|boxes|floors|사용자/);assert.match(m,/도면에서 읽은 층 1개/);assert.match(m,/\[외곽만으로 구조 시안\]/);
 const t=checkText({item:'지원하지 않는 구조·검토 방식',value:'steel × check',required:'철골·목조는 design만 지원, check·renovation 생성 불가',fix:'calc'});
 assert.doesNotMatch(t,/steel|check|design|renovation|×/);assert.match(t,/철골/);assert.match(t,/\[외곽만으로 구조 시안\]/);
});
