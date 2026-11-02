import test from 'node:test';import assert from 'node:assert/strict';
import {extractNumbers,stripTextMarkup,evaluateExpression,liveValue,insertPickedNumber,numericTextsOf,textAtPoint,formatNumber} from './expression-calculator.js';

test('글자에서 숫자 뽑기: 단위·쉼표·소수·부호',()=>{
  const v=t=>extractNumbers(t).map(n=>n.value);
  assert.deepEqual(v('1,234.5㎡'),[1234.5]);
  assert.deepEqual(v('157.92'),[157.92]);
  assert.deepEqual(v('-25.5'),[-25.5]);
  assert.deepEqual(v('−3'),[-3]);
  assert.deepEqual(v('Ø150'),[150]);
  assert.deepEqual(v('A-101'),[101]);
  assert.deepEqual(v('2020-05'),[2020,5]);
  assert.deepEqual(v('W 3.5 x 2'),[3.5,2]);
  assert.deepEqual(v('면적: -12.5 (m2)'),[-12.5,2]);
  assert.deepEqual(v('.5'),[.5]);
  assert.deepEqual(v('12,34'),[12,34]);
  assert.deepEqual(v('TYP'),[]);
});
test('MTEXT 서식 코드는 숫자로 읽지 않는다',()=>{
  assert.equal(stripTextMarkup('{\\fArial|b1;123.4}\\P56'),'123.4\n56');
  assert.deepEqual(extractNumbers('{\\C1;12.5}\\P{\\H0.7x;30}').map(n=>n.value),[12.5,30]);
  assert.deepEqual(extractNumbers('%%c150').map(n=>n.value),[150]);
});
test('식 계산: 사칙·괄호·우선순위·부호·퍼센트·쉼표',()=>{
  assert.equal(evaluateExpression('151.25 + 157.92'),309.17);
  assert.equal(evaluateExpression('1,234.5 + 0.5'),1235);
  assert.equal(evaluateExpression('2 + 3 × 4'),14);
  assert.equal(evaluateExpression('(2 + 3) × 4 ÷ 2'),10);
  assert.equal(evaluateExpression('10 − 4 − 3'),3);
  assert.equal(evaluateExpression('-(2+3)*2'),-10);
  assert.equal(evaluateExpression('2*-3'),-6);
  assert.equal(evaluateExpression('50%'),.5);
  assert.equal(evaluateExpression('200 * 10%'),20);
  assert.equal(evaluateExpression('100 + 10%'),110);
  assert.equal(evaluateExpression('100 - 10%'),90);
  assert.equal(evaluateExpression('0.1 + 0.2'),.3);
});
test('식 계산: 잘못된 식과 코드 실행 시도는 거부한다',()=>{
  for(const bad of ['','2 +','(2+3','2+3)','1/0','abc','alert(1)','constructor','2 ** 3','1;2','`1`','2(3)','1..2 + x','globalThis'])assert.throws(()=>evaluateExpression(bad),undefined,bad);
});
test('실시간 합계는 입력 도중의 식도 부분 계산한다',()=>{
  assert.equal(liveValue('1 + 2 +'),3);
  assert.equal(liveValue('2 × (3 + 4'),14);
  assert.equal(liveValue(''),null);
  assert.equal(liveValue('+'),null);
  assert.equal(liveValue('1 + 2'),3);
});
test('포인트 삽입: 처음에는 숫자만, 이어서는 연산자와 함께, 음수는 괄호',()=>{
  let r=insertPickedNumber('',0,151.25,'+');assert.equal(r.text,'151.25');
  r=insertPickedNumber(r.text,r.caret,157.92,'+');assert.equal(r.text,'151.25 + 157.92');assert.equal(evaluateExpression(r.text),309.17);
  r=insertPickedNumber(r.text,r.caret,-5,'*');assert.equal(r.text,'151.25 + 157.92 × (-5)');
  assert.equal(insertPickedNumber('3 +',3,4,'*').text,'3 + 4');
  assert.equal(insertPickedNumber('(',1,4,'+').text,'(4');
  assert.equal(insertPickedNumber('1 + 2',1,9,'-').text,'1 − 9 + 2');
  assert.equal(formatNumber(1234567.891),'1,234,567.891');
});
test('도면 글자 찾기: 표 글자·블록 안 글자·숫자 없는 글자 제외',()=>{
  const a={id:'a',type:'text',text:'151.25',position:{x:0,y:0},height:10,rotation:0};
  const b={id:'b',type:'text',text:'설명',position:{x:0,y:50},height:10,rotation:0};
  assert.equal(numericTextsOf(b).length,0);
  assert.equal(numericTextsOf(a).length,1);
  const hit=textAtPoint([b,a],{x:5,y:5},4);
  assert.equal(hit?.root.id,'a');
  assert.equal(textAtPoint([a],{x:500,y:500},4),null);
});
