// 창 그리기 카드 W1(고정창) · W2·W3(미서기창). izzarder.com/429·476 의 설정 항목을 옮겼다.
// 조작: 세 점(1 실내측 벽선 위 점, 2 같은 벽선 위 점, 3 반대쪽 벽선 위 점) → 벽선 절단 + 창 생성.
// W2 와 W3 는 같은 명령이지만 설정이 따로 저장된다(원문과 같음). 켜 설정은 공통.
import * as G from './geometry.js';
import {STD_LAYERS,builder,snapWallFrame,wallFrame,cutWallBand,capLines,entitiesSvg,openCardDialog,loadCardState,resolveLayers,normalizeValues,toWorld,linkCardOpening} from './card-kit.js';

export const WINDOW_STORAGE_KEY='barun-window-cards';
export const WINDOW_SLOTS=6;
export const WINDOW_FIXED_NAMES=['W1 고정창','W2 미서기창','W3 미서기창 (설정 2)'];

export const WINDOW_FIELDS=[
 {key:'uValue',label:'U-value (W/m²·K)',type:'number',def:null,min:0,step:0.001,group:'열성능'},
 {key:'airtightGrade',label:'기밀등급',type:'text',def:null,group:'열성능'},
 {key:'shgc',label:'SHGC',type:'number',def:null,min:0,step:0.001,group:'열성능'},
 {key:'runMode',label:'실행방식',type:'select',def:'dialog',options:[['dialog','대화상자 먼저'],['command','명령입력 먼저 (창 없이 바로 폭·점 입력)']],group:'실행방식'},
 {key:'kind',label:'창호형식',type:'select',def:'sliding',options:[['fixed','고정창'],['sliding','미서기창']],group:'창'},
 {key:'width',label:'창 폭 (mm)',type:'number',def:1800,min:100,step:10,group:'창'},
 {key:'offset',label:'시작점에서 띄울 거리 (mm)',type:'number',def:0,min:0,step:10,group:'창',hint:'0 이면 찍은 점을 벽선 위 가장 가까운 점으로 씁니다.'},
 {key:'sashType',label:'단창 / 이중창',type:'select',def:'single',options:[['single','단창'],['double','이중창']],group:'창',when:v=>v.kind==='sliding'},
 {key:'divisions',label:'창 나누기 (등분)',type:'number',def:2,min:1,max:12,step:1,group:'창'},
 {key:'detail',label:'상세',type:'select',def:'detail',options:[['simple','단순창'],['detail','상세창']],group:'상세와 위치',when:v=>v.kind==='sliding'},
 {key:'frameWidth',label:'창틀 폭 (mm)',type:'number',def:50,min:5,step:5,group:'상세와 위치'},
 {key:'depthMode',label:'창 두께',type:'select',def:'wall',options:[['wall','벽두께와 같게'],['custom','지정 두께']],group:'상세와 위치'},
 {key:'depth',label:'지정 두께 (mm)',type:'number',def:100,min:10,step:5,group:'상세와 위치',when:v=>v.depthMode==='custom'},
 {key:'protrude',label:'내부돌출 (mm, − 는 들어감)',type:'number',def:0,step:5,group:'상세와 위치',hint:'첫째 점을 찍은 실내측 벽선 밖으로 나오는 길이'},
 {key:'protrudeOut',label:'외부돌출 (mm, 셋째 점 쪽)',type:'number',def:0,min:0,step:5,group:'상세와 위치',hint:'창 두께가 반대쪽(외부) 벽선 밖으로 더 나오는 길이 (원문 [외부 돌출], 2026-09-21 보정)'},
 {key:'flipFrame',label:'창틀 반전 (열리는 유리틀 위아래 바꿈)',type:'check',def:false,group:'미서기 설정',when:v=>v.kind==='sliding'},
 {key:'fixOpen',label:'열리는 폭 고정',type:'check',def:false,group:'미서기 설정',when:v=>v.kind==='sliding'},
 {key:'fixedOpenWidth',label:'고정 폭 (mm, 첫째 점 쪽 창)',type:'number',def:600,min:50,step:10,group:'미서기 설정',when:v=>v.kind==='sliding'&&v.fixOpen},
 {key:'glass',label:'유리표현 (0 없음 · 1 단선 · n 두께)',type:'number',def:1,min:0,step:1,group:'표현'},
 {key:'wallCap',label:'벽선 정리',type:'select',def:'first',options:[['first','첫번째 선을 따라 (한 선)'],['each','각각의 벽선으로']],group:'표현'},
 {key:'gap',label:'골조와 창틀 사이 간격 (mm)',type:'number',def:0,min:0,step:5,group:'표현'},
];
export const WINDOW_SHARED_FIELDS=[
 {key:'frameLayer',label:'창틀 켜',type:'layer',def:STD_LAYERS.glaz,group:'켜 설정 (W1·W2·W3 공통)'},
 {key:'elevLayer',label:'창틀 입면선 켜',type:'layer',def:STD_LAYERS.glaz,group:'켜 설정 (W1·W2·W3 공통)'},
 {key:'wallElevLayer',label:'벽체 입면선 켜',type:'layer',def:STD_LAYERS.wall,group:'켜 설정 (W1·W2·W3 공통)'},
];
export const windowSlotDefaults=i=>i===0?{kind:'fixed',divisions:1}:{kind:'sliding',divisions:2};

/** 창 판(패널) 나누기. 첫째 점 쪽 판이 첫째다. */
export function windowPanels(v,inner){
 const n=Math.max(1,Math.round(v.divisions));
 if(v.kind==='sliding'&&v.fixOpen&&n>=2){const w1=Math.min(inner-50*(n-1),Math.max(50,v.fixedOpenWidth)),rest=(inner-w1)/(n-1);return [w1,...Array(n-1).fill(rest)];}
 return Array(n).fill(inner/n);
}
/** 창 기하. d=0 이 실내측(첫째 점) 벽선, d=t 가 반대쪽. */
export function buildWindow(f,v,shared){
 const g=v.gap,W=v.width,t=f.t,s0=v.offset,sF0=s0+g,sF1=sF0+W,cutEnd=s0+W+2*g,fw=v.frameWidth;
 const D=v.depthMode==='wall'?t:v.depth,dLo=(t-D)/2-v.protrude,dHi=dLo+D+Math.max(0,Number(v.protrudeOut)||0);
 const b=builder(f,shared.frameLayer);
 const L={frame:shared.frameLayer,elev:shared.elevLayer,wall:shared.wallElevLayer};
 // 창틀: 양끝 세로틀 + 위아래 입면선
 b.rect(sF0,dLo,sF0+fw,dHi,{layer:L.frame});b.rect(sF1-fw,dLo,sF1,dHi,{layer:L.frame});
 b.line(sF0+fw,dLo,sF1-fw,dLo,{layer:L.elev});b.line(sF0+fw,dHi,sF1-fw,dHi,{layer:L.elev});
 if(g>0){for(const d of [0,t]){b.line(s0,d,sF0,d,{layer:L.frame});b.line(sF1,d,cutEnd,d,{layer:L.frame});}}
 const inner=W-2*fw;if(inner<=0)throw Error('창 폭이 창틀 폭 두 배보다 커야 합니다.');
 const panels=windowPanels(v,inner);
 const glassAt=(sa,sb,d)=>{if(v.glass<=0)return;if(v.glass<=1)b.line(sa,d,sb,d,{layer:L.frame});else b.rect(sa,d-v.glass/2,sb,d+v.glass/2,{layer:L.frame});};
 if(v.kind==='fixed'){
  let s=sF0+fw;const dg=(dLo+dHi)/2;
  panels.forEach((pw,i)=>{const last=i===panels.length-1;if(i){b.rect(s-fw/2,dLo,s+fw/2,dHi,{layer:L.frame});glassAt(s+fw/2,s+pw-(last?0:fw/2),dg);}else glassAt(s,s+pw-(last?0:fw/2),dg);s+=pw;});
 }else{
  // 미서기: 판이 번갈아 안팎 궤도에 놓인다. 이중창은 궤도가 넷.
  const tracks=v.sashType==='double'?[.2,.4,.6,.8]:[.3,.7];
  const st=Math.min(fw,D*.18);// 유리틀 두께
  let s=sF0+fw;
  panels.forEach((pw,i)=>{
   const pair=v.sashType==='double'?[tracks[(i+(v.flipFrame?1:0))%2],tracks[2+(i+(v.flipFrame?1:0))%2]]:[tracks[(i+(v.flipFrame?1:0))%2]];
   const ov=panels.length>1?fw/2:0,sa=Math.max(sF0+fw,s-ov),sb=Math.min(sF1-fw,s+pw+ov);
   for(const tr of pair){const d=dLo+D*tr;if(v.detail==='detail'){b.rect(sa,d-st/2,sb,d+st/2,{layer:L.frame});if(v.glass>0)glassAt(sa+st,sb-st,d);}else{b.line(sa,d,sb,d,{layer:L.frame});if(v.glass>1)b.rect(sa,d-v.glass/2,sb,d+v.glass/2,{layer:L.frame});}}
   s+=pw;
  });
  // 벽체 입면선: 창 두께가 벽보다 얇거나 밀려 있으면 드러나는 벽면
  if(dLo>0.5)b.line(s0,0,cutEnd,0,{layer:L.wall});
  if(dHi<t-0.5)b.line(s0,t,cutEnd,t,{layer:L.wall});
 }
 const uValue=v.uValue==null||v.uValue===''?null:(Number.isFinite(Number(v.uValue))&&Number(v.uValue)>0?Number(v.uValue):null),shgc=v.shgc==null||v.shgc===''?null:(Number.isFinite(Number(v.shgc))&&Number(v.shgc)>=0?Number(v.shgc):null);
 return {entities:b.list.map(e=>({...e,uValue,airtightGrade:v.airtightGrade??null,shgc})),cut:[s0,cutEnd],capPositions:[s0,cutEnd],dLo,dHi};
}
export function windowPreviewSvg(v,shared,opts={}){
 const t=200,f=wallFrame({x:0,y:0},{x:1,y:0},{x:0,y:t}),win=buildWindow(f,v,shared),ext=Math.max(200,v.width*.25);
 const wall=[[-ext-v.offset,v.offset],[win.cut[1],win.cut[1]+ext]].flatMap(([a,z])=>[{type:'line',points:[{x:a,y:0},{x:z,y:0}],cardLayer:'A-WALL'},{type:'line',points:[{x:a,y:t},{x:z,y:t}],cardLayer:'A-WALL'}]);
 const caps=capLines(f,win.capPositions,[{d:0,layer:'A-WALL'},{d:t,layer:'A-WALL'}],v.wallCap,{dLo:Math.min(0,win.dLo),dHi:Math.max(t,win.dHi)}).map(e=>({...e,layer:undefined,cardLayer:'A-WALL'}));
 return entitiesSvg([...wall,...caps,...win.entities],{label:opts.compact?'':`창 폭 ${v.width} · ${v.kind==='fixed'?'고정창':(v.sashType==='double'?'이중 ':'')+'미서기창'} ${v.divisions}등분 · 아래가 실내(첫째 점)`,...opts});
}

export function installWindowCards(ctx){
 const slotOf=name=>({W1:0,W2:1,W3:2})[name]??0;
 async function draw(v,shared){
  const previewOf=(points,cursor)=>{
   const pts=cursor?[...points,cursor]:points;if(pts.length<2)return [];
   try{
    if(pts.length===2){const f=wallFrame(pts[0],pts[1],G.add(pts[0],G.normal(G.unit(G.sub(pts[1],pts[0])))));const end=v.offset+v.width+2*v.gap;return [{type:'line',points:[toWorld(f,v.offset,0),toWorld(f,end,0)],previewColor:'#6ec6ff'},{type:'line',points:[toWorld(f,v.offset,-60),toWorld(f,v.offset,60)]},{type:'line',points:[toWorld(f,end,-60),toWorld(f,end,60)]}];}
    const f=wallFrame(pts[0],pts[1],pts[2]);return buildWindow(f,v,shared).entities.map(e=>({...e,previewColor:'#6ec6ff'}));
   }catch{return [];}
  };
  const pts=(await ctx.pickPath({prompt:`창 [${v.name}] 폭 ${v.width} · ① 실내측 벽선 위 점 ② 같은 벽선 위 다른 점 ③ 반대쪽 벽선 위 점 · Esc 중단`,preview:previewOf,minPoints:3,maxPoints:3}))?.points;
  if(!pts)return null;
  const f=snapWallFrame(ctx.entities(),pts[0],pts[1],pts[2],ctx.tolerance(),{layers:ctx.layers()});
  const win=buildWindow(f,v,shared);
  const cut=cutWallBand(ctx.entities(),f,win.cut[0],win.cut[1],{layers:ctx.layers()});
  const caps=capLines(f,win.capPositions,cut.cuts,v.wallCap,{dLo:Math.min(0,win.dLo),dHi:Math.max(f.t,win.dHi),fallbackLayerName:shared.frameLayer});
  const drawn=resolveLayers(ctx,cut.walls.length?[...win.entities,...caps].map(e=>e.cardLayer?{...e,cardOpeningLayer:e.cardLayer}:e):[...win.entities,...cut.add,...caps]);
  const entities=cut.walls.length?[...linkCardOpening(cut.walls,f,win.cut,'WINDOW',v,shared,drawn,ctx.layers()),...cut.add]:drawn;
  const ids=ctx.commit({removeIds:cut.removeIds,entities,select:false});
  ctx.toast(`창 [${v.name}] 폭 ${v.width} · 벽선 ${cut.removeIds.length+cut.walls.length}개 절단 · Ctrl+Z 로 되돌리기`);
  return ids;
 }
 function open(name,{forceDialog=false}={}){
  const select=slotOf(name);
  const state=loadCardState(ctx.storage,WINDOW_STORAGE_KEY,{fields:WINDOW_FIELDS,sharedFields:WINDOW_SHARED_FIELDS,slots:WINDOW_SLOTS,fixedNames:WINDOW_FIXED_NAMES,slotDefaults:windowSlotDefaults});
  const preset=state.presets[select];
  if(!forceDialog&&preset.runMode==='command'){
   ctx.askNumber({title:`${preset.name} · 창 폭`,label:'창 폭 (mm) · Enter 로 진행',value:preset.width,settings:()=>open(name,{forceDialog:true})},async width=>{
    const v=normalizeValues(WINDOW_FIELDS,{...preset,width},preset.name);state.presets[select]=v;
    try{ctx.storage.setItem(WINDOW_STORAGE_KEY,JSON.stringify({presets:state.presets,shared:state.shared,selected:select}));}catch{}
    await draw(v,state.shared);
   });
   return;
  }
  openCardDialog({ctx,title:`창 그리기 · ${name} (W1 고정창 · W2/W3 미서기창)`,storageKey:WINDOW_STORAGE_KEY,fields:WINDOW_FIELDS,sharedFields:WINDOW_SHARED_FIELDS,slots:WINDOW_SLOTS,fixedNames:WINDOW_FIXED_NAMES,slotDefaults:windowSlotDefaults,select,
   preview:(v,shared,o)=>windowPreviewSvg(v,shared,o),
   validate:v=>{if(v.width<=2*v.frameWidth)throw Error('창 폭은 창틀 폭 두 배보다 커야 합니다.');},
   onGo:(v,shared)=>draw(v,shared),
   note:'세 점 순서: ① 실내측 벽선 위 점 → ② 같은 벽선 위 다른 점(창이 이어지는 방향) → ③ 반대쪽 벽선 위 점. 열리는 폭을 고정하면 첫째 점 쪽 창이 고정폭이 됩니다.'});
 }
 return {W1:()=>open('W1'),W2:()=>open('W2'),W3:()=>open('W3')};
}
