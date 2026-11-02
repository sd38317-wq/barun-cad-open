// 개체 투명도(ACAD200 121). 값은 속성 창과 같은 0~90(%) 이다. null/'ByLayer' 은 레이어 투명도(없으면 0).
// AutoCAD 는 표시 모드 2 = 알파 그대로, 3 = sqrt(알파), 그 외 불투명이다. 우리는 화면·GPU·출력이 같은 함수를 쓴다.
// TRANSPARENCYDISPLAY(표시 켜기/끄기)는 한 곳(setTransparencyDisplay)에서 바꾼다.
let display=true;
export function setTransparencyDisplay(on){display=!!on;return display;}
export const transparencyDisplay=()=>display;

export function transparencyPercent(value){
  if(value==null||value==='ByLayer'||value==='BYLAYER'||value==='ByBlock'||value==='BYBLOCK')return null;
  const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(90,n)):null;
}
// 객체 → 부모 블록(ByBlock) → 레이어 순서로 정한다.
export function resolveTransparency(entity,parent=null,layer=null){
  const own=entity?.transparency;
  if(own==='ByBlock'||own==='BYBLOCK')return transparencyPercent(parent)??0;
  return transparencyPercent(own)??transparencyPercent(layer?.transparency)??0;
}
export function displayAlpha(percent,{mode=2,on=display}={}){
  if(!on)return 1;
  const t=transparencyPercent(percent);if(!t)return 1;
  const a=1-t/100;
  return mode===3?Math.sqrt(a):mode===2?a:1;
}
// 알파를 배치 키에 넣을 때 쓰는 값(1/100 단위로 반올림해 배치 수가 늘지 않게).
export const alphaKey=alpha=>Math.round(alpha*100)/100;
