// 화면 품질 연결부(ACAD200 108·109·110·111·112·117·121·124). app.js 는 이 모듈의 함수 몇 개만 부른다.
// 프레임마다 하는 일: 숫자 몇 개(프레임 시간 기록, 전략 고르기). 도면 객체를 훑지 않는다.
import {FramePressure,selectLodStrategy,movingBlockPixels,combinedPressure,LOD_STRATEGIES} from './gpu-lod-policy.js';
import {ImposterBatch,beginImposters,endImposters} from './canvas-imposters.js';
import {regenInterrupt} from './regen-interrupt.js';
import {setTransparencyDisplay} from './gpu-transparency.js';

const readFlag=(key,fallback)=>{try{const v=globalThis.localStorage?.getItem(key);return v==null?fallback:v!=='off'&&v!=='0';}catch{return fallback;}};

export function createDisplayQuality({storageKey='barun.cad.textGreeking'}={}){
  const pressure=new FramePressure(),imposters=new ImposterBatch();
  // 설정으로 되돌리기: localStorage 'barun.cad.textGreeking' = 'off' 이면 작은 글자도 글자로 그린다.
  const greeking=readFlag(storageKey,true);
  let frameStart=0;
  return {
    pressure,imposters,regenInterrupt,
    attachInput(target){return regenInterrupt.attach(target);},
    // 프레임 시작: 대화형 여부와 문서의 투명도 표시 설정을 맞춘다.
    beginFrame({interactive=false,doc=null}={}){
      frameStart=performance.now();pressure.interactive=!!interactive;
      if(!interactive)pressure.reset();
      setTransparencyDisplay(doc?.transparencyDisplay!==false);
    },
    endFrame(){if(frameStart)pressure.record(performance.now()-frameStart);frameStart=0;},
    // GPU 렌더러에 넘길 이번 프레임의 LOD 전략.
    strategy({building=false,memoryPressure=0}={}){
      const s=selectLodStrategy({interactive:pressure.interactive,pressure:pressure.pressure,building,memoryPressure});
      return greeking?s:{...s,textGreekPx:0};
    },
    // 큰 도면 visible() 의 블록 접기 기준(px)과 캐시 키 단계.
    blockPixels(moving){return moving?movingBlockPixels(pressure.level):LOD_STRATEGIES.standard.blockPixels;},
    get lodBand(){return pressure.interactive?pressure.level:0;},
    // 캔버스 블록 상자 모음: 프레임의 객체 그리기 앞뒤로 부른다.
    beginObjects(ctx){beginImposters(ctx,imposters,combinedPressure(pressure.pressure,0));},
    endObjects(ctx){return endImposters(ctx);},
  };
}
