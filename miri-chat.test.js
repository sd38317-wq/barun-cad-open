import test from 'node:test';
import assert from 'node:assert/strict';
import {requestWithGuide,waitingStatus,editRequest} from './chat.js';
import {directParcelRequest} from './ai-actions.js';

// 미리보다 board-intake.mjs 의 ACTION 규칙(4.0.53). 여기에 걸리면 미리가 모델 대신 작업 보드 카드를 만들고
// 본문 첫머리를 제목으로 되돌려 준다("바른캐드봇이 바로 시작했어요: \"답변 방식: …\"").
const MIRI_BOARD_ACTION=/정리\s*해|요약\s*해|고쳐|고치|만들어|보내|찾아|깔아|설치\s*해|바꿔|수정\s*해|변환\s*해|넣어|그려|작성\s*해|추려|검토\s*해|번역\s*해|합쳐|나눠|옮겨|지워|삭제\s*해|출력\s*해|뽑아|잡아\s*줘|잡아줘|정리\s*좀|맡아|처리\s*해|해\s*줘$|해줘$/;

test('미리에 보내는 글은 사용자 말이 맨 앞이고 CAD 안내는 뒤에 붙는다',()=>{
 const body=requestWithGuide('미리');
 assert.ok(body.startsWith('미리\n\n[바른 CAD 안내'),body.slice(0,40));
 assert.ok(body.includes('답변 방식:'));
 // 안내문 자체가 미리의 작업 보드 접수 규칙에 걸리면 "미리" 한 마디도 보드 카드가 된다.
 assert.equal(MIRI_BOARD_ACTION.test(body),false);
 const extra=requestWithGuide('지금 대지 지적도 떠줘','추가 규칙');
 assert.ok(extra.startsWith('지금 대지 지적도 떠줘\n\n'));
 assert.ok(extra.endsWith('\n추가 규칙'));
});

test('미리 답을 오래 기다리면 기다린 시간을 알린다',()=>{
 assert.equal(waitingStatus(3000),'미리 처리 중…');
 assert.equal(waitingStatus(20_000),'미리 답을 기다리는 중 · 20초');
 assert.match(waitingStatus(95_000),/늦어지고 있습니다 · 95초/);
});

test('"지적도 떠줘" 처럼 대지만 띄우라는 말은 대지 가져오기로 바로 간다',()=>{
 assert.deepEqual(directParcelRequest('지금 대지 지적도 떠줘').actions[0],{cmd:'parcel_import',args:{query:''}});
 assert.equal(directParcelRequest('지적도 좀 띄워줘').actions[0].args.query,'');
 assert.equal(directParcelRequest('현재 대지 열어줘').actions[0].args.query,'');
 assert.equal(directParcelRequest('부산 사리로 64-1 대지 지적도 떠줘').actions[0].args.query,'부산 사리로 64-1');
 // 기존 규칙은 그대로
 assert.equal(directParcelRequest('부산 사리로 64-1 대지 가져와').actions[0].args.query,'부산 사리로 64-1');
 assert.equal(directParcelRequest('왜 지적도가 안 떠?'),null);
 assert.equal(directParcelRequest('대지 가져오지 마'),null);
 assert.equal(directParcelRequest('지적도 띄워 그리고 설계해'),null);
});

test('파일·리습·화면 실행 요청은 실행 모드, 기능 질문은 검토 모드다',()=>{
 for(const text of ['도면 저장해줘','도면 열어줘','다른 이름으로 저장해줘','리습 불러와','등록한 리습 실행해','리습 등록해줘','출력해줘','PLANSET','APPLOAD','WALDRAW','NEW','SAVEAS'])assert.equal(editRequest(text),true,text);
 for(const text of ['저장은 어떻게 하나요?','리습 실행 방법 알려줘','파일을 지울 수 있나요?','미리 안녕'])assert.equal(editRequest(text),false,text);
});
