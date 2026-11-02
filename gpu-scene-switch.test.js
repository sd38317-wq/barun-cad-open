import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneSwitchPlan,PARK_MIN_SCENE_ITEMS} from './gpu-controller.js';

test('tab switch: a kept scene comes back, a small scene keeps the renderer, a large one is kept aside',()=>{
 assert.equal(sceneSwitchPlan({kept:true,previousItems:0}),'restore');
 assert.equal(sceneSwitchPlan({kept:false,previousItems:0}),'keep');                       // 시작 빈 탭에서 도면 열기
 assert.equal(sceneSwitchPlan({kept:false,previousItems:PARK_MIN_SCENE_ITEMS-1}),'keep');
 assert.equal(sceneSwitchPlan({kept:false,previousItems:PARK_MIN_SCENE_ITEMS}),'fresh');   // 큰 장면은 따로 두고 새 장치
});
