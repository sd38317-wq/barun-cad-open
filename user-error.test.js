import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {technicalErrorMessage,userErrorMessage} from './user-error.js';

test('Electron 저장 오류를 사용자용 한글 안내로 바꾼다',()=>{
 const raw="Error invoking remote method 'cad:save-file': Error: Failed to get 'documents' path";
 const message=userErrorMessage(raw);
 assert.match(message,/문서 폴더 위치를 찾지 못했습니다/);
 assert.doesNotMatch(message,/Error|Failed|documents/);
 assert.equal(technicalErrorMessage(raw),"Failed to get 'documents' path");
});

test('운영체제와 통신 오류를 한글로 바꾼다',()=>{
 assert.match(userErrorMessage('EACCES: permission denied'),/접근할 권한/);
 assert.match(userErrorMessage('ENOSPC: no space left on device'),/저장 공간/);
 assert.match(userErrorMessage('TypeError: Failed to fetch'),/연결하지 못했습니다/);
});

test('한글 문맥은 유지하되 뒤의 영문 내부 오류는 노출하지 않는다',()=>{
 const message=userErrorMessage('도면 열기 실패: decoder process crashed');
 assert.match(message,/^도면 열기 실패:/);
 assert.doesNotMatch(message,/decoder|crashed/);
});

test('프로그램이 만든 한글 오류는 그대로 유지한다',()=>{
 assert.equal(userErrorMessage('CTB 파일은 2MB 이하만 지원합니다.'),'CTB 파일은 2MB 이하만 지원합니다.');
 assert.equal(userErrorMessage('숫자를 입력하세요.'),'숫자를 입력하세요.');
});

test('저장창은 문서 폴더가 없을 때 대체 폴더를 사용한다',async()=>{
 const source=await readFile(new URL('./desktop.cjs',import.meta.url),'utf8');
 assert.match(source,/\['documents','downloads','desktop','userData'\]/);
 assert.doesNotMatch(source,/path\.join\(app\.getPath\('documents'\)/);
});

test('문자 코드 오류는 한글 코드 문제라고 알려 준다 (A38)',()=>{
 const message=userErrorMessage("처리 중 오류가 났습니다: 'utf-8' codec can't decode byte 0xc0 in position 16699: invalid start byte");
 assert.match(message,/문자 코드/);
 assert.doesNotMatch(message,/codec|0xc0/);
});

test('AI 연결 확인 영어 오류는 기본 문구로 숨지 않고 원인과 다음 할 일을 알린다', () => {
 for(const raw of ['CAD target changed; read and preview this editor again.','CAD editor is busy; finish the current drawing operation first.','CAD request is invalid or expired','CAD request expired','Expected revision differs from bound target','CAD current properties changed; preview the normalized command again.']){
  const message=userErrorMessage(new Error(raw));
  assert.notEqual(message,'작업을 완료하지 못했습니다. 다시 시도하세요.',raw);
  assert.match(message,/[가-힣]/,raw);
 }
 assert.match(userErrorMessage(new Error('CAD target changed; read and preview this editor again.')),/cad_get_document/);
});
