import {standardLayerForName} from './layer-standards.js';
// 기둥 그리기 카드 COL(xiDrawColumn). izzarder.com/189 의 대화상자를 그대로 옮겼다.
// 원문 항목: 종류(철근콘크리트·철골·철골철근콘크리트), 콘크리트기둥 모양(사각·원형), 켜설정(기둥켜·철골켜),
// 콘크리트크기(가로·세로), 편심(가로·세로), 철골크기(가로·세로·Web·Flg·자동), 철골회전각도(각도고정·화면에서 지정·회전각도).
import * as G from './geometry.js';
import {entitiesSvg,openCardDialog,resolveLayers} from './card-kit.js';

export const COLUMN_STORAGE_KEY='barun-column-card';
// 원문 켜 이름 COLUMN_C(콘크리트 기둥)·COLUMN_S(철골)를 바른 CAD 켜 표준의 A-COL 로 옮긴다.
export const COLUMN_LAYERS=Object.freeze({conc:'A-COL',steel:'A-COL'});
export const COLUMN_PREVIEW_COLORS=Object.freeze(Object.fromEntries(["A-COL"].map(name=>[name,standardLayerForName(name).color])));
export const COLUMN_KIND_LABEL=Object.freeze({rc:'철근콘크리트',steel:'철골',src:'철골철근콘크리트'});

/* ── 철골 단면. 원문 대화상자는 가로·세로·Web·Flg 네 값으로 H 형강 하나를 그린다(원문 그림의 여섯 형태 참고). ──
   [자동] 체크는 원문에 계산식이 없어, KS D 3502 표준 H형강 표에서 가로·세로에 가장 가까운 규격의 Web·Flg 를 쓴다. */
export const H_SECTIONS=Object.freeze([
 {h:100,b:100,web:6,flange:8},{h:125,b:125,web:6.5,flange:9},{h:150,b:150,web:7,flange:10},
 {h:175,b:175,web:7.5,flange:11},{h:200,b:200,web:8,flange:12},{h:250,b:250,web:9,flange:14},
 {h:300,b:300,web:10,flange:15},{h:350,b:350,web:12,flange:19},{h:400,b:400,web:13,flange:21},
 {h:150,b:75,web:5,flange:7},{h:200,b:100,web:5.5,flange:8},{h:250,b:125,web:6,flange:9},
 {h:300,b:150,web:6.5,flange:9},{h:350,b:175,web:7,flange:11},{h:400,b:200,web:8,flange:13},
 {h:450,b:200,web:9,flange:14},{h:500,b:200,web:10,flange:16},{h:600,b:200,web:11,flange:17},
 {h:700,b:300,web:13,flange:24},{h:800,b:300,web:14,flange:26},{h:900,b:300,web:16,flange:28},
]);
export function autoSteelThickness(width,depth){
 let best=H_SECTIONS[0],bd=Infinity;
 for(const s of H_SECTIONS){const d=Math.hypot(s.b-width,s.h-depth);if(d<bd){bd=d;best=s;}}
 return {web:best.web,flange:best.flange,h:best.h,b:best.b};
}
const label=(d,w,web,flange)=>`H-${d}×${w}×${web}×${flange}`;
export function steelSize(v){
 const w=Number(v.steelWidth),d=Number(v.steelDepth);
 if(v.autoSize){const a=autoSteelThickness(w,d);return {w,d,web:a.web,flange:a.flange,section:label(d,w,a.web,a.flange),auto:true};}
 return {w,d,web:Number(v.web),flange:Number(v.flange),section:label(d,w,v.web,v.flange),auto:false};
}
/** H 형강 단면 윤곽 12점(가운데가 원점, 플랜지는 위·아래 수평, 웨브는 수직). w = 가로(플랜지 폭), d = 세로(전체 춤). */
export function hSectionPoints(w,d,web,flange){
 if(!(w>0)||!(d>0))throw Error('철골 크기(가로·세로)는 0보다 커야 합니다.');
 if(!(web>0)||web>=w)throw Error(`Web 두께는 0보다 크고 철골 가로(${w})보다 작아야 합니다.`);
 if(!(flange>0)||flange*2>=d)throw Error(`Flg 두께는 0보다 크고 철골 세로(${d})의 절반보다 작아야 합니다.`);
 const hw=w/2,hd=d/2,tw=web/2,ti=hd-flange;
 return [[-hw,-hd],[hw,-hd],[hw,-ti],[tw,-ti],[tw,ti],[hw,ti],[hw,hd],[-hw,hd],[-hw,ti],[-tw,ti],[-tw,-ti],[-hw,-ti]];
}
/** 원문의 [철골회전각도] 그룹. 철골에만 걸린다(콘크리트 단면은 언제나 축에 나란하다). */
export function columnRotation(v,screenAngle=null){
 if(v.kind==='rc')return 0;
 if(v.angleMode==='screen')return Number.isFinite(screenAngle)?G.normalizeAngle(screenAngle):0;
 return G.normalizeAngle(Number(v.rotation)||0);
}
/** 삽입점 → 편심만큼 옮긴 기둥 중심 */
export const columnCenter=(v,insert)=>G.add(insert,{x:Number(v.eccX)||0,y:Number(v.eccY)||0});

/** 기둥 단면 객체. 켜는 이름(cardLayer)으로만 적고 실제 id 는 커밋할 때 바꾼다. */
export function columnGeometry(v,shared={},insert={x:0,y:0},screenAngle=null){
 const center=columnCenter(v,insert),rot=columnRotation(v,screenAngle),out=[];
 const concLayer=shared.concLayer||COLUMN_LAYERS.conc,steelLayer=shared.steelLayer||COLUMN_LAYERS.steel;
 if(v.kind!=='steel'){
  const w=Number(v.concWidth);if(!(w>0))throw Error('콘크리트 가로는 0보다 커야 합니다.');
  if(v.shape==='circle')out.push({type:'circle',center:{x:center.x,y:center.y},radius:w/2,cardLayer:concLayer});
  else{
   const d=Number(v.concDepth);if(!(d>0))throw Error('콘크리트 세로는 0보다 커야 합니다.');
   const hw=w/2,hd=d/2;
   out.push({type:'polyline',closed:true,cardLayer:concLayer,points:[[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]].map(([x,y])=>({x:center.x+x,y:center.y+y}))});
  }
 }
 if(v.kind!=='rc'){
  const s=steelSize(v),c=Math.cos(rot*Math.PI/180),n=Math.sin(rot*Math.PI/180);
  out.push({type:'polyline',closed:true,cardLayer:steelLayer,points:hSectionPoints(s.w,s.d,s.web,s.flange).map(([x,y])=>({x:center.x+x*c-y*n,y:center.y+x*n+y*c}))});
 }
 return {entities:out,center,rotation:rot};
}
export function columnSummary(v){
 const parts=[];
 if(v.kind!=='steel')parts.push(v.shape==='circle'?`⌀${v.concWidth}`:`${v.concWidth}×${v.concDepth}`);
 if(v.kind!=='rc')parts.push(steelSize(v).section+(v.autoSize?'(자동)':''));
 if(Number(v.eccX)||Number(v.eccY))parts.push(`편심 ${Number(v.eccX)||0},${Number(v.eccY)||0}`);
 return parts.join(' · ');
}

export const COLUMN_FIELDS=[
 /* 종류·모양은 왼쪽 칸(RC 사각·RC 원형·철골·SRC)이 정하므로 오른쪽에 다시 묻지 않는다(hidden, 2026-09-21 사용자 지적). */
 {key:'kind',label:'종류',type:'select',def:'rc',options:[['rc','철근콘크리트'],['steel','철골'],['src','철골철근콘크리트']],group:'종류',hidden:true},
 {key:'shape',label:'콘크리트기둥 모양',type:'select',def:'rect',options:[['rect','사각'],['circle','원형']],group:'종류',when:v=>v.kind!=='steel',hidden:true},
 {key:'concWidth',label:'가로 (mm)',type:'number',def:600,min:1,step:10,group:'콘크리트크기',when:v=>v.kind!=='steel',hint:'원형은 이 값을 지름으로 씁니다'},
 {key:'concDepth',label:'세로 (mm)',type:'number',def:600,min:1,step:10,group:'콘크리트크기',when:v=>v.kind!=='steel'&&v.shape!=='circle'},
 {key:'eccX',label:'가로 (mm)',type:'number',def:0,step:10,group:'편심',hint:'중심에서 벗어난 기둥의 벗어난 길이'},
 {key:'eccY',label:'세로 (mm)',type:'number',def:0,step:10,group:'편심'},
 {key:'steelWidth',label:'가로 (mm)',type:'number',def:300,min:1,step:10,group:'철골크기',when:v=>v.kind!=='rc'},
 {key:'steelDepth',label:'세로 (mm)',type:'number',def:300,min:1,step:10,group:'철골크기',when:v=>v.kind!=='rc'},
 {key:'web',label:'Web (mm)',type:'number',def:5,min:0.1,step:0.5,group:'철골크기',when:v=>v.kind!=='rc'&&!v.autoSize},
 {key:'flange',label:'Flg (mm)',type:'number',def:9,min:0.1,step:0.5,group:'철골크기',when:v=>v.kind!=='rc'&&!v.autoSize},
 {key:'autoSize',label:'자동',type:'check',def:false,group:'철골크기',when:v=>v.kind!=='rc',hint:'원문에 계산식이 없어 KS 표준 H형강 표에서 가장 가까운 규격의 Web·Flg 를 씁니다'},
 {key:'angleMode',label:'철골회전각도',type:'select',def:'fixed',options:[['fixed','각도고정'],['screen','화면에서 지정']],group:'철골회전각도',when:v=>v.kind!=='rc'},
 {key:'rotation',label:'회전각도 (도)',type:'number',def:0,step:5,group:'철골회전각도',when:v=>v.kind!=='rc'&&v.angleMode==='fixed'},
];
export const COLUMN_SHARED_FIELDS=[
 {key:'concLayer',label:'기둥켜',type:'layer',def:COLUMN_LAYERS.conc,group:'켜설정'},
 {key:'steelLayer',label:'철골켜',type:'layer',def:COLUMN_LAYERS.steel,group:'켜설정'},
];
/** 원문 그림의 여섯 형태(사각·원형 × RC·철골·SRC)를 칸 네 개로 나눠 둔다. */
export const columnSlotDefaults=i=>[
 {name:'RC 사각 600×600',kind:'rc',shape:'rect'},
 {name:'RC 원형 ⌀600',kind:'rc',shape:'circle'},
 {name:'철골 H-300×300',kind:'steel'},
 {name:'SRC 사각 600×600',kind:'src',shape:'rect'},
][i]||{};

export function columnPreviewSvg(v,shared,opts={}){
 const es=columnGeometry(v,shared,{x:0,y:0}).entities;
 const r=Math.max(Number(v.concWidth)||0,Number(v.steelWidth)||0,1)*0.035;
 const marks=[{type:'circle',center:{x:0,y:0},radius:r,previewColor:'#ff9f68'}];
 if(Number(v.eccX)||Number(v.eccY))marks.push({type:'line',points:[{x:0,y:0},{x:Number(v.eccX)||0,y:Number(v.eccY)||0}],previewColor:'#ff9f68'});
 return entitiesSvg([...es,...marks],{label:opts.compact?'':`${COLUMN_KIND_LABEL[v.kind]} ${columnSummary(v)} · 주황 점 = 삽입점`,colorOf:e=>COLUMN_PREVIEW_COLORS[e.cardLayer],...opts});
}

export function installColumnCard(ctx){
 async function draw(v,shared){
  const byScreen=v.kind!=='rc'&&v.angleMode==='screen';
  const previewOf=(points,cursor)=>{
   const insert=points[0]||cursor;if(!insert)return [];
   const a=byScreen&&points[0]&&cursor?G.angle(G.sub(cursor,columnCenter(v,insert))):null;
   try{return columnGeometry(v,shared,insert,a).entities.map(e=>({...e,previewColor:COLUMN_PREVIEW_COLORS[e.cardLayer]}));}catch{return [];}
  };
  const prompt=byScreen
   ?`기둥 ${COLUMN_KIND_LABEL[v.kind]} ${columnSummary(v)} · ① 삽입점 ② 철골 회전각도 방향 · Esc 중단`
   :`기둥 ${COLUMN_KIND_LABEL[v.kind]} ${columnSummary(v)} · 삽입점 · Esc 중단`;
  const path=await ctx.pickPath({prompt,preview:previewOf,minPoints:byScreen?2:1,maxPoints:byScreen?2:1});
  if(!path)return null;
  const insert=path.points[0];
  const angle=byScreen?G.angle(G.sub(path.points[1],columnCenter(v,insert))):null;
  const r=columnGeometry(v,shared,insert,angle);
  const ids=ctx.commit({removeIds:[],entities:resolveLayers(ctx,r.entities,name=>COLUMN_PREVIEW_COLORS[name])});
  ctx.toast(`${COLUMN_KIND_LABEL[v.kind]} 기둥 ${columnSummary(v)}${r.rotation?` · 철골 ${Math.round(r.rotation)}도`:''} · Ctrl+Z 로 되돌리기`);
  return ids;
 }
 return {COL:()=>openCardDialog({ctx,title:'기둥 그리기 · COL',storageKey:COLUMN_STORAGE_KEY,fields:COLUMN_FIELDS,sharedFields:COLUMN_SHARED_FIELDS,slots:4,slotDefaults:columnSlotDefaults,
  preview:(v,s,o)=>columnPreviewSvg(v,s,o),validate:(v,s)=>{columnGeometry(v,s);},onGo:async(v,s)=>{do{if(!await draw(v,s))break;}while(ctx.scripted?.hasPathInput?.());},
  note:'종류·크기·편심을 정하고 [그리기 시작] → 삽입점을 찍으면 기둥 단면을 그립니다. 편심은 중심에서 벗어난 기둥의 벗어난 길이입니다. 원문 대화상자의 켜 [L] 단추는 켜 칸의 목록으로, 그 옆 [cl] 체크는 뜻을 읽어낼 수 없어 옮기지 않았습니다.'})};
}
