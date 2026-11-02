// 10-24: 설치판(예시 기록 site_example.js 없음)에서 소규모 배치 기다림 화면이 빈 채로 멈췄다.
// 아래 패널 정리 줄이 아직 만들기 전의 example·text 를 써서 ReferenceError 로 스크립트가 끝났기 때문.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('./wait-screens/site-wait-frame.js',import.meta.url),'utf8');
test('예시 기록이 없을 때도 기록 재생을 멈추기 전에 판 크기를 맞춘다',()=>{
 const html=readFileSync(new URL('./wait-screens/site.html',import.meta.url),'utf8');
 const branch=html.slice(html.indexOf('if (!window.ENGINE_RUN)'),html.indexOf('throw new Error("예시 기록 없음'));
 assert.match(branch,/fitOnly\(\); addEventListener\("resize", fitOnly\);/);
 assert.match(branch,/app\.style\.transform = /);
});
test('기다림 화면 아래 패널 정리는 example·text 를 만든 뒤에 돈다',()=>{
 const use=src.indexOf("for(const panel of document.querySelectorAll('.grid .p'))");
 assert.ok(use>0,'패널 정리 줄');
 assert.ok(src.indexOf('const example=')>=0&&src.indexOf('const example=')<use,'example 이 먼저');
 assert.ok(src.indexOf('const text=(tag,value)=>')>=0&&src.indexOf('const text=(tag,value)=>')<use,'text() 가 먼저');
});
