// ACAD200 영역 3 묶음: app.js 는 이 모듈 하나만 들여와(import * as IA) 상태 묶음(createInputAssist)을 만든다.
// 판단 로직은 각 모듈(input-manager·selection-assist·grip-tools·snap-assist·input-prefs)에 있고 각각 시험이 있다.
export * from './input-manager.js';
export * from './selection-assist.js';
export * from './grip-tools.js';
export * from './snap-assist.js';
export * from './input-prefs.js';
import {InputPointManager,InputQueue} from './input-manager.js';
import {HoverPreview,SelectionSteps,WindowPreview} from './selection-assist.js';
import {GripIndex,HotGrips} from './grip-tools.js';
import {SnapCycle,ObjectTracking} from './snap-assist.js';
import {loadInputPrefs,saveInputPrefs,normalizeInputPrefs} from './input-prefs.js';
import {setHatchPickInterior,setHatchPickMode} from './display-picking.js';
export {setHatchPickInterior,setHatchPickMode};

/** app.js 한 곳에서 쓰는 입력 보조 상태. storage 는 localStorage(없어도 동작). */
export function createInputAssist({storage=null,onPrefsChange=null}={}){
  const assist={
    prefs:loadInputPrefs(storage),
    hover:new HoverPreview(),
    steps:new SelectionSteps(),
    windowPreview:new WindowPreview(),
    gripIndex:new GripIndex(),
    hotGrips:new HotGrips(),
    hoverGrip:null,
    snapCycle:new SnapCycle(),
    tracking:new ObjectTracking(),
    inputPoints:new InputPointManager(),
    queue:new InputQueue(),
    lastPointerType:'mouse',
    rightDown:null,
    setPrefs(next){
      assist.prefs=normalizeInputPrefs(next);saveInputPrefs(storage,assist.prefs);
      apply();
      onPrefsChange?.(assist.prefs);return assist.prefs;
    },
  };
  const apply=()=>{assist.windowPreview.limit=assist.prefs.windowPreviewLimit;assist.tracking.pauseMs=assist.prefs.trackPauseMs;setHatchPickMode(assist.prefs.hatchPickMode);};
  apply();
  return assist;
}
