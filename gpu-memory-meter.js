// GPU 메모리 계량(ACAD200 124).
// AutoCAD 는 "GPUPressure" 와 캐시 압박을 LOD 에 곱한다. 우리는 선 배치가 올린 바이트를 배치마다 기억해
// 합계를 낸다(배치를 만들고 지울 때만 더하고 뺀다: 프레임마다 훑지 않는다). 예산 대비 비율이 압박이다.
// 압박이 높으면 확대 정제(정점이 늘어나는 일)를 멈추고 문자 그리킹 기준을 올린다(gpu-lod-policy.js).
export const DEFAULT_GPU_BUDGET=1024*1024*1024;   // AutoCAD CACHEMAXTOTALSIZE 기본 1024MB 와 같은 크기

// 선 배치 하나가 올리는 바이트: 위치 float32×3, 인덱스 uint16, 점선이면 거리 float32.
export function lineUploadBytes(values,dashed){const vertices=values/3;return values*4+vertices*2+(dashed?vertices*4:0);}

export class GpuMemoryMeter {
  constructor(budget=DEFAULT_GPU_BUDGET){this.budget=budget;this.bytes=0;this.peak=0;}
  add(owner,bytes){if(!owner||!(bytes>0))return;owner.gpuBytes=(owner.gpuBytes||0)+bytes;this.bytes+=bytes;this.peak=Math.max(this.peak,this.bytes);}
  remove(owner){if(!owner?.gpuBytes)return;this.bytes=Math.max(0,this.bytes-owner.gpuBytes);owner.gpuBytes=0;}
  reset(){this.bytes=0;}
  get pressure(){return Math.max(0,Math.min(1,this.bytes/Math.max(1,this.budget)));}
}
