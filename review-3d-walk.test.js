import test from 'node:test';
import assert from 'node:assert/strict';
import {eyeFromPlan,lookVector,stepVector,nextLevel,EYE_HEIGHT} from './review-3d-walk.js';

const near=(a,b,msg)=>assert.ok(Math.abs(a-b)<1e-9,`${msg}: ${a} vs ${b}`);

test('찍은 점(도면 mm) → 눈높이 자리, 모델 가운데를 바라본다', ()=>{
 const e=eyeFromPlan({x:5000,y:2000},3,{x:5,z:-12});   // 가운데가 도면 위쪽(북)으로 10 m
 assert.deepEqual(e.position,{x:5,y:3+EYE_HEIGHT,z:-2});
 const v=lookVector(e.yaw,0);near(v.x,0,'x');near(v.z,-1,'북쪽을 봄');
 const east=eyeFromPlan({x:0,y:0},0,{x:10,z:0});const ve=lookVector(east.yaw,0);near(ve.x,1,'동쪽을 봄');near(ve.z,0,'z');
 assert.equal(eyeFromPlan({x:5000,y:-5000},0,{x:5.2,z:5.3}).yaw,0,'가운데 근처면 북쪽');
});

test('걷기: 앞은 보는 방향, 오른쪽은 시계 방향 90°, 대각선도 같은 거리', ()=>{
 const f=stepVector(0,1,0,2);near(f.x,0,'앞 x');near(f.z,-2,'앞 z(북)');
 const r=stepVector(0,0,1,2);near(r.x,2,'오른쪽 = 동');near(r.z,0,'오른쪽 z');
 const d=stepVector(Math.PI/2,1,1,1);near(Math.hypot(d.x,d.z),1,'대각선 길이');
 const back=stepVector(Math.PI,1,0,1);near(back.z,1,'남쪽을 보면 앞이 +z');
});

test('위·아래층: 가장 가까운 층으로, 끝이면 그대로', ()=>{
 const levels=[0,3,6.5];
 assert.equal(nextLevel(levels,0,1),3);assert.equal(nextLevel(levels,3,1),6.5);assert.equal(nextLevel(levels,6.5,1),6.5);
 assert.equal(nextLevel(levels,6.5,-1),3);assert.equal(nextLevel(levels,0,-1),0);assert.equal(nextLevel([],0,1),0);
});
