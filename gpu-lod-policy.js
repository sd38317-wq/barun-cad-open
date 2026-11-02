// 화면 품질 정책(ACAD200 108·109·110·112·124).
// AutoCAD 는 프레임마다 압박(FramePressure)을 읽어 세 LOD 전략 중 하나를 고른다.
// 여기서는 같은 생각을 "값이 정해진 작은 표 + 순수 함수"로 둔다. 매 프레임 하는 일은
// 숫자 몇 개 계산뿐이고 도면 객체를 훑지 않는다. 압박 단계는 0/1/2 세 칸으로만
// 바꿔(양자화) 캐시 키가 프레임마다 흔들리지 않게 한다.

// 108. 최근 프레임 시간으로 만든 압박. 움직이는 중(대화형)일 때만 압박이 생긴다.
export class FramePressure {
  constructor({desiredFps=30,window=8}={}){this.desiredMs=1000/desiredFps;this.window=window;this.samples=[];this.interactive=false;}
  record(ms){
    if(!(ms>=0)||!Number.isFinite(ms))return;
    this.samples.push(ms);if(this.samples.length>this.window)this.samples.shift();
  }
  get averageMs(){let sum=0;for(const ms of this.samples)sum+=ms;return this.samples.length?sum/this.samples.length:0;}
  // 0 = 목표 fps 안, 1 = 목표 시간의 두 배 이상 걸림.
  get pressure(){return this.interactive?Math.max(0,Math.min(1,this.averageMs/this.desiredMs-1)):0;}
  // 캐시 키용 단계: 0(여유), 1(조금 느림), 2(많이 느림).
  get level(){const p=this.pressure;return p>=.75?2:p>=.25?1:0;}
  reset(){this.samples=[];}
}

// 109. 세 전략. standard 는 지금까지의 값 그대로라 정지 화면은 예전과 똑같다.
// optimized(움직이는 중)는 품질 작업을 미루고, progressive(장면을 짓는 중·GPU 메모리 압박)는
// 품질 작업을 작게 나눠 한다. 숫자는 ms·px.
export const LOD_STRATEGIES=Object.freeze({
  standard:Object.freeze({name:'standard',blockPixels:36,refineMs:8,textMs:8,textGreekPx:3}),
  optimized:Object.freeze({name:'optimized',blockPixels:96,refineMs:0,textMs:0,textGreekPx:6}),
  // 그리킹 기준은 standard 와 같게: 장면을 다 지어 전략이 바뀔 때 글자 묶음을 다시 만들고 정지 화면을 다시 그리지 않게.
  progressive:Object.freeze({name:'progressive',blockPixels:48,refineMs:4,textMs:8,textGreekPx:3}),
});
export function selectLodStrategy({interactive=false,pressure=0,building=false,memoryPressure=0}={}){
  if(interactive)return LOD_STRATEGIES.optimized;
  if(building||pressure>0||memoryPressure>=.8)return LOD_STRATEGIES.progressive;
  return LOD_STRATEGIES.standard;
}
// 움직이는 중 블록 접기 기준(px). 압박 단계마다 한 칸씩 키운다(96 → 144 → 192).
export const movingBlockPixels=level=>96*(1+Math.max(0,Math.min(2,level|0))/2);

// 110. 픽셀 기반 LOD 단계. 기준값은 AutoCAD 기본(1/3/6/10px)과 같다.
export const LOD_THRESHOLDS=Object.freeze({invisible:1,imposter:3,lowRes:6,midRes:10});
// AutoCAD 의 CombinedPressure: (1-시간압박×가중)×(1-캐시압박×가중). 1 이면 압박 없음.
export function combinedPressure(time=0,cache=0,{timeWeight=1,cacheWeight=1}={}){
  const clamp=v=>Math.max(0,Math.min(1,Number(v)||0));
  return (1-clamp(time)*timeWeight)*(1-clamp(cache)*cacheWeight);
}
// boundsPx: 화면에서의 큰 변 길이(px). factor: combinedPressure 값(1=압박 없음).
// AutoCAD 와 달리 압박이 없을 때(factor>=1)는 1px 미만도 지우지 않고 점 상자로 남긴다:
// 정지 화면에서 작은 블록이 사라지면 사용자가 도면이 빠졌다고 오해한다.
export function lodLevel(boundsPx,factor=1){
  if(!(boundsPx>0))return 'invisible';
  const f=Math.max(0,Math.min(1,Number.isFinite(factor)?factor:1));
  const px=2**Math.max(-16,Math.min(15.99999,Math.log2(boundsPx)*f));
  if(px<LOD_THRESHOLDS.invisible)return f>=1?'imposter':'invisible';
  if(px<LOD_THRESHOLDS.imposter)return 'imposter';
  if(px<LOD_THRESHOLDS.lowRes)return 'low';
  if(px<LOD_THRESHOLDS.midRes)return 'mid';
  return 'full';
}

// 112. 그리킹 기준(px): 이보다 작은 글자는 글자 대신 옅은 사각형으로 그린다. 0 이면 끔.
export function textGreekPixels(strategy=LOD_STRATEGIES.standard,memoryPressure=0){
  const base=Math.max(0,Number(strategy?.textGreekPx)||0);
  return memoryPressure>=.8?Math.max(base,6):base;
}
