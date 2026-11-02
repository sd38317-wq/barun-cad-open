// ACAD200 516: 스마트 치수 선형 종류 판정(smart-dim.js linearMode)을 AutoCAD 판정 순서와 비교해 못 박는다.
//
// AutoCAD(관측된 판정 순서): ① 두 점이 수평·수직이 아니면 커서를 두 점을 잇는 선에 수직 투영해 선분 위면 정렬,
// ② 아니면 커서 Y 가 두 점의 Y 범위 밖이고 X 가 범위 안이면 수평, 그 밖은 수직.
// 우리 규칙: 축에 나란한 선은 그 축, 경계 상자 위·아래로만 벗어나면 수평, 왼·오른쪽으로만 벗어나면 수직, 상자 안이면 정렬,
// 두 방향 모두 벗어난 모서리는 수직 띠(투영이 선분 위) 안이면 정렬, 밖이면 더 많이 벗어난 쪽.
//
// 결과가 다른 곳은 세 군데뿐이고, 모두 우리 쪽이 사용자에게 낫다고 보고 그대로 둔다(아래 시험이 그 경계를 지킨다).
//  A. 상자 위·아래(또는 좌·우)로만 벗어났지만 수직 띠 안: AutoCAD 는 정렬, 우리는 수평(수직).
//     → 기울어진 선에서 수평·수직 치수를 내려면 AutoCAD 는 수직 띠 밖(멀리 비스듬히)까지 가야 한다. 우리는 DIMLINEAR 처럼
//       상자 위로 곧장 올리면 수평이 된다. 정렬은 상자 안과 모서리 띠 안에서 여전히 고를 수 있다.
//  B. 띠 밖의 모서리: AutoCAD 는 늘 수직, 우리는 더 많이 벗어난 쪽(위로 많이 가면 수평). 커서 방향과 결과가 맞는다.
//  D. 상자의 왼·오른쪽 변을 그대로 위아래로 늘인 선 위(경계값): AutoCAD 는 X 범위를 열린 구간으로 봐 수직, 우리는 상자 변을 상자에 넣어 수평.
//     커서가 위·아래로만 벗어난 것이므로 수평이 맞다.
//  C. 축에 나란한 선: AutoCAD 순서대로면 선 길이 범위 밖에서 길이 0 인 치수(수평선에 수직 치수)가 나온다. 우리는 선 방향을 지킨다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {linearMode} from './smart-dim.js';

const P=(x,y)=>({x,y});
/** AutoCAD 판정 순서를 그대로 따른 기준 구현(비교용). */
function acadLinearMode(a,b,p){
 const dx=b.x-a.x,dy=b.y-a.y;
 if(dx!==0&&dy!==0){const t=((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy);if(t>=0&&t<=1)return 'aligned';}
 const inY=Math.min(a.y,b.y)<=p.y&&p.y<Math.max(a.y,b.y),inX=Math.min(a.x,b.x)<p.x&&p.x<Math.max(a.x,b.x);
 return !inY&&inX?'horizontal':'vertical';
}
function regionOf(a,b,p){
 const loX=Math.min(a.x,b.x),hiX=Math.max(a.x,b.x),loY=Math.min(a.y,b.y),hiY=Math.max(a.y,b.y);
 const ex=p.x<loX?loX-p.x:p.x>hiX?p.x-hiX:0,ey=p.y<loY?loY-p.y:p.y>hiY?p.y-hiY:0;
 const dx=b.x-a.x,dy=b.y-a.y,t=((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy);
 return {ex,ey,inStrip:t>=0&&t<=1};
}

test('기울어진 선: AutoCAD 와 다른 곳은 A·B 두 영역과 D 경계선뿐이고, 나머지는 모두 같다',()=>{
 for(const [a,b] of [[P(0,0),P(4000,3000)],[P(0,0),P(100,50)],[P(1000,2000),P(-500,-700)],[P(0,0),P(10,-3000)]]){
  let same=0,regionA=0,regionB=0,edge=0;
  const span=Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y)),step=span/20;
  for(let i=-30;i<=50;i++)for(let j=-30;j<=50;j++){
   const p=P(Math.min(a.x,b.x)+i*step,Math.min(a.y,b.y)+j*step),ours=linearMode(a,b,p),acad=acadLinearMode(a,b,p);
   if(ours===acad){same++;continue;}
   const {ex,ey,inStrip}=regionOf(a,b,p),where=JSON.stringify({a,b,p,ours,acad});
   if((ex>0)!==(ey>0)&&inStrip){assert.equal(acad,'aligned',where);assert.equal(ours,ey>0?'horizontal':'vertical',where);regionA++;}
   else if(ex>0&&ey>0&&!inStrip){assert.equal(acad,'vertical',where);assert.equal(ours,'horizontal',where);assert.ok(ey>=ex,where);regionB++;}
   else if(ex===0&&ey>0&&(p.x===Math.min(a.x,b.x)||p.x===Math.max(a.x,b.x))){assert.equal(ours,'horizontal',where);assert.equal(acad,'vertical',where);edge++;}
   else assert.fail('설명되지 않는 차이 '+where);
  }
  assert.ok(same>0&&regionA>0,'두 판정이 같은 곳과 A 영역이 모두 격자에 들어 있다');
 }
});

test('같은 결과여야 하는 곳(경계값 포함): 상자 안·변 위·끝점·띠 경계·띠 밖 한 방향',()=>{
 const a=P(0,0),b=P(4000,3000);
 const cases=[
  [P(1000,2000),'aligned'],[P(2000,1500),'aligned'],[P(0,3000),'aligned'],[P(4000,0),'aligned'],   // 상자 안·모서리
  [P(2000,3000),'aligned'],[P(4000,1000),'aligned'],[P(0,0),'aligned'],[P(4000,3000),'aligned'],     // 변 위·끝점
  [P(-1000,4000),'aligned'],[P(-2400,3200),'aligned'],[P(4300,-300),'aligned'],                         // 모서리지만 띠 안(t=0 경계 포함)
  [P(6000,1500),'vertical'],[P(5000,3000),'vertical'],[P(-3000,0),'vertical'],                          // 옆으로만 · 띠 밖
  [P(2000,8000),'horizontal'],[P(1000,-4000),'horizontal'],                                             // 위·아래로만 · 띠 밖
 ];
 for(const [p,want] of cases){assert.equal(linearMode(a,b,p),want,JSON.stringify(p));assert.equal(acadLinearMode(a,b,p),want,'AutoCAD '+JSON.stringify(p));}
});

test('다른 결과 A·B·C 는 의도한 것(우리 쪽이 커서 방향과 맞는다)',()=>{
 const a=P(0,0),b=P(4000,3000);
 // A: 상자 위로 곧장 올림(띠 안) → 우리 수평, AutoCAD 정렬
 assert.equal(linearMode(a,b,P(2000,5000)),'horizontal');assert.equal(acadLinearMode(a,b,P(2000,5000)),'aligned');
 assert.equal(linearMode(a,b,P(-500,1500)),'vertical');assert.equal(acadLinearMode(a,b,P(-500,1500)),'aligned');
 // B: 끝 너머 모서리에서 위로 더 많이 → 우리 수평, AutoCAD 수직
 assert.equal(linearMode(a,b,P(6000,8000)),'horizontal');assert.equal(acadLinearMode(a,b,P(6000,8000)),'vertical');
 // C: 수평선의 길이 범위 밖 → 우리 수평(길이 3000), AutoCAD 순서면 수직(길이 0)
 assert.equal(linearMode(P(0,0),P(3000,0),P(5000,100)),'horizontal');assert.equal(acadLinearMode(P(0,0),P(3000,0),P(5000,100)),'vertical');
 assert.equal(linearMode(P(0,0),P(0,3000),P(100,5000)),'vertical');
});

test('거의 수평인 선의 허용치: 길이의 1e-9 이하로 기울면 수평선으로 본다',()=>{
 const b=P(3000,3000*1e-10),tilted=P(3000,3000*1e-6);
 assert.equal(linearMode(P(0,0),b,P(1500,-500)),'horizontal');
 assert.equal(linearMode(P(0,0),b,P(1500,1)),'horizontal','허용치 안이면 상자 안이어도 수평');
 assert.equal(linearMode(P(0,0),tilted,P(1500,0.001)),'aligned','허용치를 넘으면 기울어진 선 규칙(상자 안 → 정렬)');
});
