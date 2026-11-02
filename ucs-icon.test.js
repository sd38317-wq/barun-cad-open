import test from 'node:test';
import assert from 'node:assert/strict';
import {ucsIconSpot,drawUcsIcon} from './view.js';
// 2026-10-28 대표 지시(시안-원점선): 화면 끝까지 긋던 원점 X·Y 선 대신 오토캐드 UCS 아이콘처럼 작은 L자 표시만.
test('원점이 화면 안이면 원점에, 밖이거나 가장자리에 붙으면 왼쪽 아래 구석에 그린다',()=>{
 assert.deepEqual(ucsIconSpot({x:400,y:300},1000,800),{x:400,y:300,atOrigin:true});
 for(const o of [{x:-50,y:300},{x:1200,y:300},{x:400,y:-10},{x:400,y:900},{x:995,y:300},{x:400,y:20}]){
  const s=ucsIconSpot(o,1000,800);assert.equal(s.atOrigin,false);assert.ok(s.x<60&&s.y>740,JSON.stringify(s));
 }
});
test('표시는 짧은 두 선뿐 — 화면 끝까지 가는 선이 없다',()=>{
 const pts=[];const ctx=new Proxy({moveTo(x,y){pts.push([x,y]);},lineTo(x,y){pts.push([x,y]);}},{get(t,k){return k in t?t[k]:()=>{};},set(){return true;}});
 drawUcsIcon(ctx,{x:400,y:300},1000,800,'#888');
 assert.ok(pts.length>=4);
 for(const [x,y] of pts)assert.ok(Math.abs(x-400)<=50&&Math.abs(y-300)<=50,`${x},${y}`);
});
test('명령창에서 UCSICON 을 알아듣는다',async()=>{
 const {resolveCommand,COMMANDS}=await import('./commands.js');
 assert.equal(resolveCommand('UCSICON',{}),'UCSICON');
});
