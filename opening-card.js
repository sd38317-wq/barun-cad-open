// 개구부 그리기 카드 WO. izzarder.com/428 의 설정(시작점에서 띄울 거리, 내부·외부 돌출, 두 점의 중간에 위치, 벽선 정리)을 옮겼다.
// 조작: 세 점(1 벽선 위 시작점, 2 같은 벽선 위 끝점, 3 반대쪽 벽선) → 벽선 절단 + 개구부 단면선.
import * as G from './geometry.js';
import {STD_LAYERS,builder,snapWallFrame,wallFrame,cutWallBand,capLines,entitiesSvg,openCardDialog,resolveLayers,toLocal} from './card-kit.js';

export const OPENING_STORAGE_KEY='barun-opening-card';
export const OPENING_FIELDS=[
 {key:'offset',label:'시작점에서 띄울 거리 (mm)',type:'number',def:0,min:0,step:10,group:'개구부',hint:'0 이면 첫째·둘째 점을 벽선 위 가장 가까운 점으로 씁니다.'},
 {key:'midMode',label:'두 점의 중간에 위치 (지정 크기)',type:'check',def:false,group:'개구부'},
 {key:'openWidth',label:'개구부 크기 (mm)',type:'number',def:1200,min:50,step:10,group:'개구부',when:v=>v.midMode},
 {key:'protrudeIn',label:'내부 돌출 (mm, 첫째 점 쪽)',type:'number',def:0,min:0,step:5,group:'입면선 돌출'},
 {key:'protrudeOut',label:'외부 돌출 (mm, 셋째 점 쪽)',type:'number',def:0,min:0,step:5,group:'입면선 돌출'},
 {key:'wallCap',label:'벽선 정리',type:'select',def:'first',options:[['first','첫번째 선을 따라 (한 선)'],['each','각각의 벽선으로']],group:'표현'},
];
export const OPENING_SHARED_FIELDS=[{key:'lineLayer',label:'개구부 선 켜',type:'layer',def:STD_LAYERS.wall,group:'켜 설정'}];

/** 개구부 구간. midMode 면 두 점 중간에 지정 크기, 아니면 첫째 점(+띄울 거리)부터 둘째 점까지. */
export function openingSpan(v,sEnd){
 if(v.midMode){const c=sEnd/2,w=v.openWidth;return [c-w/2,c+w/2];}
 const s0=v.offset;if(sEnd-s0<=1)throw Error('둘째 점은 첫째 점보다 개구부 폭만큼 앞에 찍으세요.');
 return [s0,sEnd];
}
export function buildOpening(f,v,shared,sEnd){
 const [s0,s1]=openingSpan(v,sEnd),b=builder(f,shared.lineLayer),t=f.t;
 const dLo=-v.protrudeIn,dHi=t+v.protrudeOut;
 if(v.protrudeIn>0){b.line(s0,dLo,s0,0);b.line(s1,dLo,s1,0);}
 if(v.protrudeOut>0){b.line(s0,t,s0,dHi);b.line(s1,t,s1,dHi);}
 return {entities:b.list,cut:[s0,s1],capPositions:[s0,s1],dLo:0,dHi:t};
}
export function openingPreviewSvg(v,shared,opts={}){
 const t=200,sEnd=v.midMode?v.openWidth*1.6:v.offset+1200,f=wallFrame({x:0,y:0},{x:1,y:0},{x:0,y:t}),o=buildOpening(f,v,shared,sEnd),ext=400;
 const wall=[[-ext,o.cut[0]],[o.cut[1],Math.max(sEnd,o.cut[1])+ext]].flatMap(([a,z])=>[{type:'line',points:[{x:a,y:0},{x:z,y:0}],cardLayer:'A-WALL'},{type:'line',points:[{x:a,y:t},{x:z,y:t}],cardLayer:'A-WALL'}]);
 const caps=capLines(f,o.capPositions,[{d:0,layer:'A-WALL'},{d:t,layer:'A-WALL'}],v.wallCap).map(e=>({...e,layer:undefined,cardLayer:shared.lineLayer}));
 const marks=[{type:'circle',center:{x:0,y:0},radius:25,previewColor:'#ff9f68'},{type:'circle',center:{x:sEnd,y:0},radius:25,previewColor:'#ff9f68'},{type:'circle',center:{x:sEnd/2,y:t},radius:25,previewColor:'#ff9f68'}];
 return entitiesSvg([...wall,...caps,...o.entities,...marks],{label:opts.compact?'':(v.midMode?`두 점 중간에 ${v.openWidth} 개구부`:`첫째 점 +${v.offset} 부터 둘째 점까지`)+' · 주황 점 = 찍는 위치 ①②③',...opts});
}

export function installOpeningCard(ctx){
 async function draw(v,shared){
  const previewOf=(points,cursor)=>{
   const pts=cursor?[...points,cursor]:points;if(pts.length<2)return [];
   try{
    const p3=pts[2]||G.add(pts[0],G.mul(G.normal(G.unit(G.sub(pts[1],pts[0]))),200));
    const f=wallFrame(pts[0],pts[1],p3),sEnd=toLocal(f,pts[1]).s,o=buildOpening(f,v,shared,sEnd);
    return [...o.entities,...capLines(f,o.capPositions,[{d:0},{d:f.t}],'first')].map(e=>({...e,previewColor:'#ff9f68'}));
   }catch{return [];}
  };
  const pts=(await ctx.pickPath({prompt:`개구부 · ① 벽선 위 시작점 ② 같은 벽선 위 끝점${v.midMode?'(중간에 '+v.openWidth+' 크기)':''} ③ 반대쪽 벽선 위 점 · Esc 중단`,preview:previewOf,minPoints:3,maxPoints:3}))?.points;
  if(!pts)return null;
  const f=snapWallFrame(ctx.entities(),pts[0],pts[1],pts[2],ctx.tolerance(),{layers:ctx.layers()});
  const sEnd=toLocal(f,pts[1]).s,o=buildOpening(f,v,shared,sEnd);
  const cut=cutWallBand(ctx.entities(),f,o.cut[0],o.cut[1],{layers:ctx.layers()});
  const caps=capLines(f,o.capPositions,cut.cuts,v.wallCap,{fallbackLayerName:shared.lineLayer});
  const entities=resolveLayers(ctx,[...o.entities,...cut.add,...caps]);
  const ids=ctx.commit({removeIds:cut.removeIds,entities});
  ctx.toast(`개구부 ${Math.round(o.cut[1]-o.cut[0])} mm · 벽선 ${cut.removeIds.length}개 절단 · Ctrl+Z 로 되돌리기`);
  return ids;
 }
 return {WO:()=>openCardDialog({ctx,title:'개구부 그리기 · WO',storageKey:OPENING_STORAGE_KEY,fields:OPENING_FIELDS,sharedFields:OPENING_SHARED_FIELDS,slots:3,fixedNames:['WO 개구부'],
  preview:(v,shared,o)=>openingPreviewSvg(v,shared,o),onGo:(v,shared)=>draw(v,shared),
  note:'기획·구조 도면의 개구부 표시. 벽선은 잘리고 중심선은 남습니다. 돌출 값을 넣으면 단면선이 벽면 밖으로 나옵니다.'})};
}
