// 임포스터(ACAD200 110·111): 화면에서 아주 작은 블록은 모양 대신 외곽 상자로 그린다.
// 예전에는 상자마다 strokeRect 를 따로 불렀다(상자 수만큼 그리기 호출). AutoCAD 의 ImposterAgent 처럼
// 한 프레임의 상자를 모았다가 색·두께별로 경로 하나에 담아 한 번에 그린다.
// 판정은 gpu-lod-policy.js 의 lodLevel: 압박이 없으면 예전과 같다(3px 미만·접힌 블록 → 상자),
// 움직이는 중 화면이 느려 압박이 있으면 더 큰 블록도 상자로, 1px 미만은 생략한다.
import {lodLevel} from './gpu-lod-policy.js';

export class ImposterBatch {
  constructor(){this.groups=new Map();this.count=0;this.flushes=0;}
  add(color,lineWidth,x,y,w,h){
    const key=color+'\u0000'+lineWidth;let list=this.groups.get(key);
    if(!list)this.groups.set(key,list={color,lineWidth,rects:[]});
    list.rects.push(x,y,w,h);this.count++;
  }
  flush(ctx){
    if(!this.count)return 0;
    const drawn=this.count;
    for(const {color,lineWidth,rects} of this.groups.values()){
      ctx.save();ctx.strokeStyle=color;ctx.lineWidth=lineWidth;ctx.setLineDash?.([]);ctx.beginPath();
      for(let i=0;i<rects.length;i+=4)ctx.rect(rects[i],rects[i+1],rects[i+2],rects[i+3]);
      ctx.stroke();ctx.restore();
    }
    this.groups.clear();this.count=0;this.flushes++;
    return drawn;
  }
}
// 화면 그리기(paintFrame)가 프레임 동안 ctx 에 상자 모음과 LOD 압박(1=없음)을 걸어 둔다.
// ctx 객체에 속성을 붙이지 않고 표(WeakMap)에 둔다: 다른 그리기(내보내기·미리보기)의 ctx 는 영향이 없다.
const active=new WeakMap();
export function beginImposters(ctx,batch,factor=1){active.set(ctx,{batch,factor});return batch;}
export function endImposters(ctx){const state=active.get(ctx);active.delete(ctx);return state?state.batch.flush(ctx):0;}
export const imposterState=ctx=>active.get(ctx)||null;
// 자르기(clip) 블록 안에서는 상자를 모으지 않는다(자르기 밖에서 그려지면 안 되므로). 끝나면 되돌린다.
export function suspendImposters(ctx){const state=active.get(ctx)||null;if(state)active.delete(ctx);return state;}
export function resumeImposters(ctx,state){if(state)active.set(ctx,state);}
// view.js drawEntity 의 블록 판정. 'skip' | 'box' | 'draw'.
export function blockImposterDecision(pixelWidth,pixelHeight,{collapsed=false,factor=1}={}){
  const level=lodLevel(Math.max(pixelWidth,pixelHeight),factor);
  // 압박이 없으면 0px(점 크기) 블록도 예전처럼 1px 상자로 남긴다.
  if(level==='invisible')return factor>=1?'box':'skip';
  if(collapsed||level==='imposter')return 'box';
  return 'draw';
}
