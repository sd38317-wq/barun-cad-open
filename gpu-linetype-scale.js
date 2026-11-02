// LTSCALE 바꾸기를 재구성 없이(ACAD200 119).
// AutoCAD 는 선종류를 따로 재생성 요청으로 보낸다. 우리 점선은 셰이더가 경로 거리로 그리고, 무늬 길이는
// 재질 유니폼(pattern·patternLength)에 있다. 도면 LTSCALE 이 s1 → s2 로 바뀌면 점선 배치마다 새 무늬를
// 계산해(linetypeDashPattern) 예전 무늬와 비례하면 유니폼만 그 비율로 바꾼다. 정점·거리 버퍼는 그대로다.
// 비례가 깨지면(축척 한도 0.05~100 에 걸림) null: 예전처럼 전체 재구성.
import {linetypeDashPattern} from './view.js';

// 배치 하나의 새 무늬와 비율. batch 는 addSegments 가 기억한 linetype·linetypeScale 을 가진다.
export function dashRescale(batch,ratio){
  if(!batch.dash?.length)return {ratio:1,dash:batch.dash};
  if(batch.linetype===undefined||!(batch.linetypeScale>0))return null;
  const dash=linetypeDashPattern(batch.linetype,batch.linetypeScale*ratio);
  if(dash.length!==batch.dash.length||!(batch.dash[0]>0))return null;
  const k=dash[0]/batch.dash[0];
  if(!(k>0)||!Number.isFinite(k))return null;
  for(let i=0;i<dash.length;i++)if(Math.abs(dash[i]-batch.dash[i]*k)>1e-9*Math.max(1,dash[i]))return null;
  return {ratio:k,dash};
}
// 셰이더 재질의 무늬 유니폼을 k 배로. 같은 재질을 다른 비율로 두 번 바꾸지 않게 호출자가 묶는다.
export function scalePatternUniforms(material,k){
  const u=material?.uniforms;if(!u?.pattern||!u?.patternLength)return false;
  const value=u.pattern.value;
  u.pattern.value=Array.isArray(value)?value.map(v=>v*k):ArrayBuffer.isView(value)?value.map(v=>v*k):value;
  u.patternLength.value*=k;material.needsUpdate=false;
  return true;
}
// app.js execute() 용: 도면 LTSCALE 만 바뀐(명령 또는 되돌리기) 경우. 화면 캐시는 다시 만들고(delta=null:
// 캔버스는 객체별 _displayLinetypeScale 을 다시 계산), GPU 에는 같은 객체 그대로인 빈 편집을 준다.
export function linetypeScaleGpuEdit({before,after,beforeDoc,afterDoc,pending=null,previousDoc,previousRevision}){
  if(!beforeDoc||!afterDoc||(Number(beforeDoc.linetypeScale)||1)===(Number(afterDoc.linetypeScale)||1))return null;
  if(before?.length!==after?.length)return null;
  for(let i=0;i<before.length;i++)if(before[i]!==after[i])return {gpuEdit:null};
  return {gpuEdit:pending?.lightweight?null:{previousDoc,previousRevision,lightweight:true,removed:[],added:[]}};
}
