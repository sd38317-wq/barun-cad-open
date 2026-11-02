import test from 'node:test';
import assert from 'node:assert/strict';
import {designReviewPrompt,planSmsPayload,designOptions,designDrawPrompt} from './miriboda-panel.js';
import {siteLimits,limitsLine,newBuildTalkPrompt,wantsDrawing} from './new-build.js';
import {editRequest,internalPlannerLeak} from './chat.js';

test('design review keeps requirements and land evidence distinct and requires usable input',()=>{
 const brief={address:'서울 테스트 대지',requirements:'방 3개, 욕실 2개',area:'200',floors:'2'};
 const prompt=designReviewPrompt(brief,{land:{address:'다른 대지'}});
 assert.match(prompt,/방 3개/);assert.match(prompt,/다른 대지/);assert.match(prompt,/불일치/);assert.match(prompt,/도면을 변경하거나 문자를 발송하지/);
 assert.throws(()=>designReviewPrompt({...brief,address:''},{}));
 const empty=designReviewPrompt({address:brief.address,requirements:''},{});assert.match(empty,/계획안 3개/);assert.match(empty,/추가 입력을 요구하지/);assert.match(empty,/한 줄/);assert.match(empty,/필지를 찾지 못했습니다/);assert.doesNotMatch(prompt,/\"area\"|\"floors\"/);
});
test('SMS confirmation normalizes number and includes the actual share link',()=>{
 const payload=planSmsPayload('010-1234-5678','계획 확인 부탁드립니다.','https://barunarc.co.kr/');
 assert.equal(payload.phone,'01012345678');assert.equal(payload.confirmed,true);
 assert.equal(payload.text,'계획 확인 부탁드립니다.\n\n계획 보기: https://barunarc.co.kr/');
});
test('SMS rejects missing content, invalid numbers, local links and combined overflow',()=>{
 for(const [phone,body,url]of [['abc01012345678','계획',''],['01012345678','',''],['01012345678','계획','file:///C:/plan.pdf'],['01012345678','계획','https://localhost/plan'],['01012345678','계획','https://192.168.0.1/'],['01012345678','계획','https://user:password@example.com/'],['01012345678','가'.repeat(1999),'https://example.com/']])assert.throws(()=>planSmsPayload(phone,body,url));
});

const 조회결과={address:'부산 부산진구 양정동 156-7',areaM2:163,zoneNames:['제2종일반주거지역'],
 limits:{bcr:60,far:250},massing:{zoneName:'제2종일반주거지역',maxBuildingAreaM2:97.8,maxFloorAreaM2:407.5,lotAreaM2:163},warnings:[]};

test('주소 조회만으로 최대 건폐율·용적률·최대 규모가 나온다',()=>{
 // 사용자에게 물을 필요가 없는 값들이다. 물어보던 것을 여기서 끊는다.
 const site=siteLimits(조회결과);
 assert.equal(site.maxCoverage,60);assert.equal(site.maxFloorRatio,250);
 assert.equal(site.maxBuildingAreaM2,97.8);assert.equal(site.maxFloorAreaM2,407.5);
 assert.match(limitsLine(site),/최대 건폐율 60% · 최대 용적률 250%/);
 assert.match(limitsLine(site),/최대 건축면적 97.8㎡/);
});

test('조회되지 않은 값은 지어내지 않고 없다고 말한다',()=>{
 assert.equal(limitsLine(null),'대지를 아직 가져오지 않았습니다.');
 const 빈값=siteLimits({address:'어딘가',limits:{},massing:{}});
 assert.equal(빈값.maxCoverage,null);assert.equal(빈값.maxBuildingAreaM2,null);
 assert.match(limitsLine(빈값),/조회하지 못했습니다/);
});

test('신축설계 대화는 조건을 캐묻지 않고 최대 규모를 근거로 제안한다',()=>{
 const prompt=newBuildTalkPrompt(siteLimits(조회결과),[{role:'user',text:'2층이 나을까요?'}],'주차는 몇 대 되나요?');
 assert.match(prompt,/조건을 캐묻지 마세요/);
 assert.match(prompt,/97\.8/);
 assert.match(prompt,/주차는 몇 대 되나요/);
 assert.match(prompt,/지어내지 마세요/);
 assert.throws(()=>newBuildTalkPrompt(null,[],'   '));
});

test('제안에서 안을 뽑고 추천안을 먼저 고른다',()=>{
 const 제안=['1안 — 단층 마당형: 한 층에 모음','2안 — 2층 분리형: 1층 공용 2층 침실','3안 — 중정형: 가운데 마당','추천 — 접도를 보면 2안이 낫습니다'].join('\n');
 const {options,recommended}=designOptions(제안);
 assert.equal(options.length,3);assert.equal(recommended,'2안');
 assert.equal(options[1].summary,'2층 분리형: 1층 공용 2층 침실');
 assert.deepEqual(designOptions('').options,[]);
});

test('작도 요청은 검토가 아니라 실제 작도임을 분명히 한다',()=>{
 const prompt=designDrawPrompt({address:'부산 양정동 156-7'},'2안 — 2층 분리형','주차 2대',{site:siteLimits(조회결과)});
 assert.match(prompt,/검토가 아니라 실제 작도/);
 assert.match(prompt,/주차 2대/);
 assert.match(prompt,/2안/);
 assert.throws(()=>designDrawPrompt({address:'부산'},'',''));
 assert.throws(()=>designDrawPrompt({address:''},'2안',''));
});

test('평면도 요청이 배치 API로 새지 않게 못 박는다',()=>{
 // 실측 결함: "설계 작성 · 2안"이 site_plan.generate 로 가서 배치 API 422 로 떨어졌다.
 const prompt=designDrawPrompt({address:'부산 양정동 156-7'},'2안 — 2층 단독주택','',{});
 assert.match(prompt,/배치도가 아니라 평면도입니다/);
 assert.match(prompt,/site_plan\.generate 와 parcel_import 를 쓰지 마세요/);
 assert.match(prompt,/wall.*text.*architecture/);
});

test('대화칸에서 그려 달라고 하면 작도로 넘긴다',()=>{
 // "검토 모드라 도면을 못 만든다"고 답하는 막다른 길을 막는다.
 for(const 말 of ['3안 다 만들어줘','2안으로 그려줘','평면 작도해줘'])assert.equal(wantsDrawing(말),true,말);
 for(const 말 of ['주차 몇 대 되나요?','예산은 얼마쯤이죠','용적률이 뭔가요'])assert.equal(wantsDrawing(말),false,말);
});

test('모드를 사람이 고르지 않는다 — 말을 보고 가른다',()=>{
 // 회귀: "검토 모드라 도면 작성이 금지되어 있습니다"로 끝나던 자리.
 for(const 말 of ['2안으로 그려줘','선택한 문 폭을 900으로','이 벽 지워줘','침실 하나 더 추가해줘','평면 만들어줘'])
  assert.equal(editRequest(말),true,말);
 for(const 말 of ['용적률이 뭔가요?','현재 검사 결과를 설명해줘','참고 평면 보여줘','주차 몇 대 되나요'])
  assert.equal(editRequest(말),false,말);
 // CAD 명령처럼 짧게 말한 위치·치수 표현은 실행하되, 호명과 일상 질문은 대화로 보낸다.
 assert.equal(editRequest('1층 화장실 남쪽'),true);
 assert.equal(editRequest('선택한 문 폭을 900으로'),true);
 for(const 말 of ['미리','무슨말이지','좋은 도면이네','안녕하세요'])assert.equal(editRequest(말),false,말);
 // 10-26 "근생설계 할려구 하는데 도와줄 수 있는 게 머 있지"가 '설계' 낱말로 도면 작업이 됐다 — 묻는 말로 끝나면 대화.
 for(const 말 of ['지금 근생설계 할려구 하는데도와줄수있는게 머있지','근생 설계 도와줄 수 있어?','평면 그릴 수 있어?','배치 어떻게 해야 돼?','설계 순서 알려줘'])
  assert.equal(editRequest(말),false,말);
 for(const 말 of ['근생 설계해줘','벽 그려줄래?','이 벽 지워줘','배치해줘'])assert.equal(editRequest(말),true,말);
});

test('미리 내부 CAD 명령 규격은 대화 기록에 노출하지 않는다',()=>{
 assert.equal(internalPlannerLeak('actions/ask/note 각 필드의 형식을 알려주세요.'),true);
 assert.equal(internalPlannerLeak('선택한 문을 오른쪽으로 이동했습니다.'),false);
});
