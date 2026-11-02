// 곡선 분할의 "유효 배율 범위"(ACAD200 114·115).
// AutoCAD 는 테셀레이션마다 편차 범위를 기억해 범위 안이면 다시 나누지 않는다.
// 우리는 이미 확대 쪽(settledScale)을 기억한다. 여기서는 축소 쪽을 더한다: 크게 확대해 촘촘히 나눈
// 곡선을 많이 축소하면(1/16 아래) 분할 수를 줄여 정점 메모리를 돌려받는다. 화면 픽셀은 그대로라
// 서두르지 않는다: 분할이 4배 넘게 줄고, 지금 분할이 64 이상일 때만.
import {gpuCurveSegments} from './gpu-scene.js';

export const COARSEN_RATIO=16,COARSEN_MIN_SEGMENTS=64,COARSEN_GAIN=4;
export function needsCoarserCurve(detail,qualityScale){
  const curve=detail?.item?.curve;if(!curve)return false;
  const built=detail.builtScale??detail.scale;
  if(!(qualityScale>0)||!(built>0)||qualityScale>=built/COARSEN_RATIO)return false;
  const have=gpuCurveSegments(curve,built);
  if(have<COARSEN_MIN_SEGMENTS)return false;
  // 정제는 qualityScale*2 로 다시 만든다(refineUnit). 그 분할과 비교한다.
  return gpuCurveSegments(curve,qualityScale*2)*COARSEN_GAIN<=have;
}
// 114. VIEWRES: AutoCAD 는 편차 = (100/VIEWRES)×기본 허용치. 기본 VIEWRES 1000 → 0.25px(지금 값과 같음).
// 압박(0~1)이 있으면 최대 4배까지 거칠게(분할 수를 줄여) 그린다.
export function curvePixelTolerance(viewres=1000,pressure=0){
  const v=Number(viewres);const res=Number.isFinite(v)&&v>0?Math.max(1,Math.min(20000,v)):1000;
  return .25*1000/res*(1+3*Math.max(0,Math.min(1,Number(pressure)||0)));
}
// 같은 분할을 얻는 "품질 배율": 허용치 tol 로 배율 s 를 쓰는 것 = 허용치 0.25 로 배율 s×0.25/tol.
export const toleranceScale=(scale,pixelTolerance=.25)=>scale*.25/Math.max(1e-6,pixelTolerance);
