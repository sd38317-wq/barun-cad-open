// 주차장 구획 그리기 카드 PK. izzarder.com/232 의 구획 종류(일반·경형·확장형·평행·장애인 3.3/3.5)와 정렬 기준을 옮겼다.
// 조작: 세 점(1 시작점, 2 끝점, 3 구획이 놓이는 방향) → 구획선 생성.
import * as G from './geometry.js';
import {STD_LAYERS,builder,wallFrame,toWorld,entitiesSvg,openCardDialog,resolveLayers} from './card-kit.js';

export const PARKING_STORAGE_KEY='barun-parking-card';
export const PARKING_TYPES=Object.freeze({
 normal:{label:'일반형 2.5 × 5.0',w:2500,d:5000},
 normalOld:{label:'일반형(구) 2.3 × 5.0',w:2300,d:5000},
 compact:{label:'경형 2.0 × 3.6',w:2000,d:3600},
 extended:{label:'확장형 2.6 × 5.2',w:2600,d:5200,mark:true},
 parallel:{label:'평행주차 일반 2.0 × 6.0',w:2000,d:6000,parallel:true},
 parallelCompact:{label:'평행주차 경형 1.7 × 4.5',w:1700,d:4500,parallel:true},
 disabled33:{label:'장애인 3.3 × 5.0',w:3300,d:5000,disabled:true},
 disabled35:{label:'장애인 3.5 × 5.0',w:3500,d:5000,disabled:true},
 custom:{label:'사용자 크기',w:0,d:0},
});
export const PARKING_FIELDS=[
 {key:'type',label:'구획 종류',type:'select',def:'normal',options:Object.entries(PARKING_TYPES).map(([k,t])=>[k,t.label]),group:'구획'},
 {key:'customWidth',label:'사용자 폭 (mm)',type:'number',def:2500,min:500,step:10,group:'구획',when:v=>v.type==='custom'},
 {key:'customDepth',label:'사용자 길이 (mm)',type:'number',def:5000,min:500,step:10,group:'구획',when:v=>v.type==='custom'},
 {key:'count',label:'구획 수 (0 = 두 점 사이에 들어가는 만큼)',type:'number',def:0,min:0,max:500,step:1,group:'구획'},
 {key:'align',label:'정렬 기준',type:'select',def:'start',options:[['start','시작점'],['center','중간'],['end','끝점']],group:'구획',hint:'두 점 사이 길이가 구획 폭의 배수가 아닐 때 남는 길이를 어디에 둘지'},
 {key:'style',label:'표시 스타일',type:'select',def:'simple',options:[['simple','단순 선'],['double','이중선'],['diagonal','대각선 빗금']],group:'표현'},
 {key:'doubleGap',label:'이중선 간격 (mm)',type:'number',def:50,min:5,step:5,group:'표현',when:v=>v.style==='double'},
 {key:'backLine',label:'뒤쪽 선 그리기',type:'check',def:true,group:'표현'},
 {key:'extendedMark',label:'확장형 앞 원 표시',type:'check',def:true,group:'표현',when:v=>v.type==='extended'},
 {key:'carSymbol',label:'차량 표현',type:'select',def:'none',options:[['none','없음'],['outline','단순 윤곽'],['block','도면의 블럭 삽입']],group:'표현',hint:'원문의 사용자 블럭 2개는 도면에 있는 블럭을 이름으로 골라 칸마다 다르게 둘 수 있습니다(2026-09-21 보정)'},
 {key:'blockName',label:'블럭 이름',type:'text',def:'',group:'표현',when:v=>v.carSymbol==='block'},
 {key:'blockScale',label:'블럭 축척',type:'number',def:1,min:0.01,step:0.1,group:'표현',when:v=>v.carSymbol==='block'},
 {key:'numbering',label:'구획 번호',type:'check',def:false,group:'번호'},
 {key:'startNumber',label:'시작 번호',type:'number',def:1,min:0,step:1,group:'번호',when:v=>v.numbering},
 {key:'textSize',label:'번호 크기 (mm)',type:'number',def:250,min:20,step:10,group:'번호',when:v=>v.numbering},
];
export const PARKING_SHARED_FIELDS=[
 {key:'parkLayer',label:'주차구획 켜',type:'layer',def:STD_LAYERS.park,group:'켜 설정'},
 {key:'textLayer',label:'번호 켜',type:'layer',def:STD_LAYERS.text,group:'켜 설정'},
 {key:'markLayer',label:'확장형 표시 켜 (출력 제외는 켜에서 설정)',type:'layer',def:STD_LAYERS.symb,group:'켜 설정'},
];
export function stallSize(v){const t=PARKING_TYPES[v.type]||PARKING_TYPES.normal;return t.w?{w:t.w,d:t.d,...t}:{...t,w:v.customWidth,d:v.customDepth};}
/** 시작점~끝점 길이 L 에 놓이는 구획 시작 위치들 */
export function stallStarts(v,L){
 const {w}=stallSize(v);const N=v.count>0?Math.round(v.count):Math.floor(L/w+1e-6);
 if(N<1)throw Error(`두 점 사이(${Math.round(L)} mm)가 구획 폭 ${w} 보다 짧습니다.`);
 const rest=L-N*w,base=v.align==='start'?0:v.align==='end'?rest:rest/2;
 return Array.from({length:N},(_,i)=>base+i*w);
}
/** 구획 기하. f: s 는 시작→끝, d 는 셋째 점 쪽(구획 길이 방향). */
/** blocks: 도면의 블럭 정의 목록(ctx.blocks()). null 이면(미리보기) 블럭 대신 윤곽을 그린다. */
export function buildParking(f,L,v,shared,blocks=null){
 const {w,d,disabled,mark,parallel}=stallSize(v),b=builder(f,shared.parkLayer),starts=stallStarts(v,L);
 const car=v.carSymbol===true?'outline':v.carSymbol||'none';
 let def=null;if(car==='block'&&blocks){const name=String(v.blockName||'').trim();def=blocks.find(x=>x.name===name)||null;if(!def)throw Error(`도면에 "${name||'(빈 이름)'}" 블럭이 없습니다.${blocks.length?' 있는 블럭: '+blocks.map(x=>x.name).slice(0,12).join(', '):' 먼저 블럭을 만들거나 가져오세요.'}`);}
 const drawOutline=car==='outline'||(car==='block'&&!def);
 const first=starts[0],last=starts.at(-1)+w;
 for(const s of [...starts,last]){b.line(s,0,s,d);if(v.style==='double'){const g=v.doubleGap;if(s>first)b.line(s-g,0,s-g,d);if(s<last)b.line(s+g,0,s+g,d);}}
 if(v.backLine){b.line(first,d,last,d);if(v.style==='double')b.line(first,d-v.doubleGap,last,d-v.doubleGap);}
 if(v.style==='diagonal')for(const s of starts)b.line(s,0,s+w,d);
 starts.forEach((s,i)=>{
  const c=s+w/2;
  if(disabled){// 장애인 표지(단순 픽토그램): 바퀴 원 + 앉은 사람
   const first=b.list.length;const k=Math.min(w,d)*.11;b.circle(c-k*.2,d*.36,k*1.2);b.circle(c-k*.9,d*.72,k*.42);b.poly([[c-k*.9,d*.72-k*.42],[c-k*.9,d*.36+k*.4],[c+k*.6,d*.36+k*.4],[c+k*.6,d*.36-k*.6]],false);b.line(c+k*.6,d*.36+k*.4,c+k*1.3,d*.36-k*.2);
   b.list[first].reviewInput={disabledParking:true};
  }
  if(mark&&v.extendedMark)b.circle(c,d*.1,w*.12,{layer:shared.markLayer});
  if(def){const k=Math.max(0.01,Number(v.blockScale)||1),cw=toWorld(f,c,d/2),ang=f.angle+(parallel?90:0);b.list.push({type:'block',name:def.name,cardLayer:shared.parkLayer,entities:def.entities.map(e=>G.translate(G.rotate(G.resize(e,{x:0,y:0},k),{x:0,y:0},ang),cw.x,cw.y))});}
  if(drawOutline){const cw=parallel?d*.75:w*.7,cl=parallel?w*.72:d*.8;const hw=cw/2,hl=cl/2,cs=c,cd=d/2,r=Math.min(hw,hl)*.25;
   const pts=parallel?[[cs-hl+r,cd-hw],[cs+hl-r,cd-hw],[cs+hl,cd-hw+r],[cs+hl,cd+hw-r],[cs+hl-r,cd+hw],[cs-hl+r,cd+hw],[cs-hl,cd+hw-r],[cs-hl,cd-hw+r]]:[[cs-hw+r,cd-hl],[cs+hw-r,cd-hl],[cs+hw,cd-hl+r],[cs+hw,cd+hl-r],[cs+hw-r,cd+hl],[cs-hw+r,cd+hl],[cs-hw,cd+hl-r],[cs-hw,cd-hl+r]];
   b.poly(pts,true);if(!parallel){b.line(cs-hw*.8,cd+hl*.35,cs+hw*.8,cd+hl*.35);b.line(cs-hw*.8,cd-hl*.35,cs+hw*.8,cd-hl*.35);}else{b.line(cs+hl*.35,cd-hw*.8,cs+hl*.35,cd+hw*.8);b.line(cs-hl*.35,cd-hw*.8,cs-hl*.35,cd+hw*.8);}}
  if(v.numbering)b.text(c,d*.5,v.startNumber+i,v.textSize,{layer:shared.textLayer});
 });
 return {entities:b.list,count:starts.length,w,d};
}
export function parkingPreviewSvg(v,shared,opts={}){
 const {w}=stallSize(v),L=w*4+300,f=wallFrame({x:0,y:0},{x:1,y:0},{x:0,y:1}),r=buildParking(f,L,{...v,count:Math.min(v.count||4,4)},shared);
 const marks=[{type:'circle',center:{x:0,y:0},radius:w*.05,previewColor:'#ff9f68'},{type:'circle',center:{x:L,y:0},radius:w*.05,previewColor:'#ff9f68'},{type:'circle',center:{x:L/2,y:r.d*1.15},radius:w*.05,previewColor:'#ff9f68'}];
 return entitiesSvg([...r.entities,...marks],{label:opts.compact?'':`${stallSize(v).label} · 주황 점 = ①시작 ②끝 ③방향`,...opts});
}

export function installParkingCard(ctx){
 async function draw(v,shared){
  const previewOf=(points,cursor)=>{const pts=cursor?[...points,cursor]:points;if(pts.length<2)return [];try{const p3=pts[2]||G.add(pts[0],G.mul(G.normal(G.unit(G.sub(pts[1],pts[0]))),100));const f=wallFrame(pts[0],pts[1],p3);return buildParking(f,G.dist(pts[0],pts[1]),v,shared).entities.map(e=>({...e,previewColor:'#b5e48c'}));}catch{return [];}};
  const pts=(await ctx.pickPath({prompt:`주차구획 ${stallSize(v).label} · ① 시작점 ② 끝점 ③ 구획이 놓이는 방향 · Esc 중단`,preview:previewOf,minPoints:3,maxPoints:3}))?.points;
  if(!pts)return null;
  const f=wallFrame(pts[0],pts[1],pts[2]),r=buildParking(f,G.dist(pts[0],pts[1]),v,shared,ctx.blocks?ctx.blocks():[]);
  const ids=ctx.commit({removeIds:[],entities:resolveLayers(ctx,r.entities)});
  ctx.toast(`주차구획 ${r.count}대 (${r.w} × ${r.d}) · Ctrl+Z 로 되돌리기`);
  return ids;
 }
 return {PK:()=>openCardDialog({ctx,title:'주차장 구획 그리기 · PK',storageKey:PARKING_STORAGE_KEY,fields:PARKING_FIELDS,sharedFields:PARKING_SHARED_FIELDS,slots:4,fixedNames:['PK 기본'],preview:(v,s,o)=>parkingPreviewSvg(v,s,o),onGo:(v,s)=>draw(v,s),
  note:'시작점과 끝점을 찍고 구획이 놓이는 방향을 찍으면 구획선을 자동으로 그립니다. 차량 표현을 [도면의 블럭 삽입]으로 두면 그 이름의 블럭을 칸마다 넣습니다.'})};
}
