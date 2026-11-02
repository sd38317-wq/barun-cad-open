const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
/* 5.0.5 갱신: 레이어 도구줄의 자동정리 단추는 아이콘 + "자동정리" 라벨(도움말 문구에 승인 후 적용)로 바뀌었다.
   예전 '레이어 자동정리' 텍스트 기대는 낡은 것이라 현재 마크업에 맞춘다. 학습 정리 단추(learnedOrganizeButton)는 계속 없어야 한다. */
test('layer toolbar exposes one clear automatic cleanup action',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'..','app.js'),'utf8');
 assert.match(source,/organizeButton\.className='organize-layer'/);
 assert.match(source,/organizeButton\.innerHTML='<b>✦<\/b><span>자동정리<\/span>'/);
 assert.match(source,/organizeButton\.title='레이어 자동 분류 미리보기 · 승인 후 적용'/);
 assert.match(source,/organizeButton\.onclick=\(\)=>layerReviewDialog\(\)/);
 assert.doesNotMatch(source,/learnedOrganizeButton/);
});
