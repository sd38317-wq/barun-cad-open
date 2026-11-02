import * as G from "./geometry.js";
import {loadImageSource} from './image-underlay.js';
import {imageOpacity,imageUnderlaysFirst} from "./image-render.js";
import { hatchFamilies, hatchSegments } from "./hatch-patterns.js";
import { fontFamilyFor } from "./text-fonts.js";
import { displayAlpha } from "./gpu-transparency.js";
import { linetypeDashPattern } from "./view.js";
// 미리보기(SVG)와 PDF가 같은 CTB 규칙(펜 역조회→펜 스타일→grayscale)을 쓰도록 색 결정을 한 곳으로 모았다.
function plotPen(e,layer,colorMode,plotStyle){const original=e.color||layer?.color||'#000000',stb=plotStyle?.kind==='stb',aci=stb?null:e.aci??(!e.color?layer?.aci:null)??Object.keys(plotStyle?.palette||{}).find(i=>plotStyle.palette[i].toLowerCase()===original?.toLowerCase()),style=colorMode==='ctb'&&plotStyle?(stb?resolvePlotStyle(e,layer,plotStyle):(e.color?e.colorMode:layer?.colorMode)!=='truecolor'?plotStyle?.styles?.[aci]:null):null;let output=style?.color||original;if(style?.grayscale&&/^#[0-9a-f]{6}$/i.test(output)){const v=Math.round(parseInt(output.slice(1,3),16)*.2126+parseInt(output.slice(3,5),16)*.7152+parseInt(output.slice(5,7),16)*.0722);output='#'+v.toString(16).padStart(2,'0').repeat(3);}return {style,color:output};}
/* ACAD200 717 플롯 스타일 고르기: 색 기준(CTB)은 ACI 로, 이름 기준(STB)은 객체 → 레이어 → 'Normal' 순서로 스타일 이름을 찾는다.
   AutoCAD 와 같이 트루컬러 객체에는 CTB 를 쓰지 않는다. STB 는 색과 무관하므로 트루컬러여도 쓴다.
   더 나은 점: STB 이름을 대소문자 무시로 찾고, 없는 이름은 'Normal'(객체 그대로)로 떨어져 출력이 멈추지 않는다. */
export function resolvePlotStyle(e,layer,plotStyle){
 if(!plotStyle?.styles)return null;
 if(plotStyle.kind==='stb'){
  const own=e?.plotStyleName&&!/^bylayer$/i.test(e.plotStyleName)?(/^byblock$/i.test(e.plotStyleName)?e._parentPlotStyleName:e.plotStyleName):null;
  const name=own||layer?.plotStyleName||'Normal';
  const key=Object.keys(plotStyle.styles).find(k=>k.toLowerCase()===String(name).toLowerCase());
  return key?plotStyle.styles[key]:null;
 }
 if((e?.color?e.colorMode:layer?.colorMode)==='truecolor')return null;
 const aci=e?.aci??(!e?.color?layer?.aci:null)??(e?.colorMode==='byblock'?7:null);
 return aci==null?null:plotStyle.styles[aci]||plotStyle.styles[String(aci)]||null;
}
/** 출력 굵기: ByBlock(-2) 은 부모, ByLayer(-1·없음) 는 레이어, 스타일이 굵기를 정하면(>0) 그 값이 우선. */
export function plotLineweightOf(e,layer,style,parentLw){
 let lw=e?.lineweight;
 if(lw===-2||lw==='byblock')lw=parentLw;
 if(lw==null||lw===-1||lw==='bylayer')lw=layer?.lineweight;
 return style?.lineweight>0?style.lineweight:lw;
}
/* ACAD200 722 PDF 내보내기 선택: 책갈피(시트 번호·제목)·레이어 묶음(다음 단계 OCG)·래스터 해상도. 바른 CAD 문자는 TTF 실글자라 PDFSHX 없이도 검색된다. */
export const PDF_RASTER_DPI=Object.freeze([150,200,300,400,600]);
export function pdfExportOptions(raw={}){
 return {includeLayers:raw.includeLayers===true||raw.includeLayers==='on',bookmarks:raw.bookmarks!==false&&raw.bookmarks!=='off',hyperlinks:raw.hyperlinks===true||raw.hyperlinks==='on',rasterDpi:PDF_RASTER_DPI.includes(+raw.rasterDpi)?+raw.rasterDpi:300,textAsText:true};
}
export function pdfLayerGroups(visible,layers){
 const byId=new Map(layers.map(l=>[l.id,l])),groups=new Map();
 for(const e of visible){const name=byId.get(e.layer)?.name||'0';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(e);}
 return [...groups].map(([name,entities])=>({name,entities}));
}
/* ACAD200 723 플롯 스탬프: 출력할 때만 종이에 찍는 한 줄(도면 객체가 아니므로 도면은 바뀌지 않는다). AutoCAD 7개 필드 + 사용자 문구 2개. */
export const STAMP_FIELDS=Object.freeze(['drawing','sheet','datetime','user','device','paper','scale','udf1','udf2']);
export const STAMP_LABELS=Object.freeze({drawing:'도면 이름',sheet:'시트(번호·제목)',datetime:'날짜·시간',user:'사용자',device:'출력 장치',paper:'용지',scale:'축척',udf1:'사용자 문구 1',udf2:'사용자 문구 2'});
export function plotStampText(cfg,ctx={}){
 if(!cfg?.on)return null;
 const den=Number(ctx.denominator),scale=Number.isFinite(den)&&den>0?(den>=1?`1:${+den.toFixed(3)}`:`${+(1/den).toFixed(3)}:1`):'';
 const v={drawing:ctx.fileName,sheet:ctx.sheet?`${ctx.sheet.number||''} ${ctx.sheet.title||''}`.trim():'',datetime:(ctx.now||new Date()).toLocaleString('ko-KR'),user:ctx.userName,device:ctx.device,paper:ctx.paper,scale,udf1:cfg.udf1,udf2:cfg.udf2};
 const text=STAMP_FIELDS.filter(k=>cfg.fields?.includes(k)&&v[k]).map(k=>String(v[k]).replace(/[\r\n]+/g,' ')).join(' | ');
 return text?{text,corner:cfg.corner||'bottom-left',offset:{x:Number(cfg.offset?.x)||5,y:Number(cfg.offset?.y)||3},height:Number(cfg.height)||2.5}:null;
}
// CTB가 없을 때만 쓰는 출력 전용 보정이다. 도면의 실제 색상·레이어·선가중치는 바꾸지 않는다.
// 기본 목표 밝기 140(5.0.3 과 동일). "밝은 색 진하게" 옵션(darkenLightColors)을 켜면 120 으로 더 낮춰
// 노랑 #ffff00 → #818100, 연노랑 #ffd479 → #8f7744 처럼 흰 종이에서 연하게 찍히지 않는다. 기존 사용자 출력은 옵션을 켜지 않는 한 그대로다.
export const PLOT_INK_TARGETS={standard:{target:140,cap:190},dark:{target:120,cap:170}};
export function automaticPlotColor(color,{darkenLightColors=false}={}){
 if(!/^#[0-9a-f]{6}$/i.test(color||''))return '#000000';
 const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)),luminance=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
 if(luminance>245)return '#000000';
 if(luminance<=150)return color.toLowerCase();
 const {target,cap}=darkenLightColors?PLOT_INK_TARGETS.dark:PLOT_INK_TARGETS.standard;
 const factor=target/luminance,next=rgb.map(value=>Math.max(0,Math.min(cap,Math.round(value*factor))));
 return '#'+next.map(value=>value.toString(16).padStart(2,'0')).join('');
}
// "도면 색상" 모드는 기본적으로 색을 바꾸지 않는다. "밝은 색 진하게" 옵션을 켠 경우에만 밝기 200 이상을 150 으로 낮춘다(색상 유지).
export function legiblePlotColor(color){
 if(!/^#[0-9a-f]{6}$/i.test(color||''))return '#000000';
 const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)),luminance=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
 if(Math.min(...rgb)>240)return '#000000';
 if(luminance<=200)return color.toLowerCase();
 const factor=150/luminance,next=rgb.map(value=>Math.max(0,Math.min(255,Math.round(value*factor))));
 return '#'+next.map(value=>value.toString(16).padStart(2,'0')).join('');
}
// 용지 맞춤 판정 오차. 맞춤 축척은 w/(pw-2m) 로 계산되므로 다시 곱하면 420.00000000000006 > 420 같은 부동소수 오차가 난다.
export const FIT_TOLERANCE_MM=1e-6;
export const PLOT_STANDARD_SCALES=Object.freeze([1,2,5,10,20,50,60,80,100,200,250,300,500,600,1000,1200,1500,2000,2500,3000,5000]);
export function plotFitScale(width,height,pw,ph,margin=0,scales=null){
 const exact=Math.max(width/(pw-2*margin),height/(ph-2*margin),.001);
 const standards=[...new Set((scales||[]).map(Number).filter(n=>Number.isFinite(n)&&n>0))].sort((a,b)=>a-b);
 // 사용자 결정 2026-10-23: 분모의 절대 차이가 가장 가까운 표준 축척. 항상 작게 축소하면 요청한 214.44→200이 250이 된다. 동률만 큰 분모로 정한다.
 let denominator=standards.reduce((best,n)=>Math.abs(n-exact)<=Math.abs(best-exact)?n:best,standards[0]??exact);
 // 가까운 축척이 10% 넘게 잘리면(예: 390→300) 한 단계 큰 표준 축척으로.
 if(exact/denominator>1.1)denominator=standards.find(n=>n>=exact)??exact;
 const overflowPercent=Math.max(0,(exact/denominator-1)*100);
 return {denominator,overflowPercent,warning:overflowPercent>1e-6?`1:${denominator} 은 인쇄 가능 영역(여백 제외)보다 ${Math.max(.1,Math.ceil(overflowPercent*10)/10).toFixed(1)}% 큼 · 넘는 부분은 잘릴 수 있습니다.`:''};
}
/** 다중 플롯 한 장: 박스 모양대로 가로·세로를 고르고, 정한 축척이 여백 안에 들어가면 그 축척 그대로(fit off), 안 들어가면 용지에 맞춘다. */
export function multiPagePlotFit(bounds,paper,denominator,margin=0){
 const sizes={A0:[1189,841],A1:[841,594],A2:[594,420],A3:[420,297],A4:[297,210]},[long,short]=sizes[paper]||sizes.A3;
 const w=bounds.maxX-bounds.minX,h=bounds.maxY-bounds.minY,orientation=h>w?'portrait':'landscape';
 const [pw,ph]=orientation==='portrait'?[short,long]:[long,short];
 return {orientation,fit:fitsPaper(w,h,Number(denominator)||100,pw,ph,margin)?'off':'on'};
}
export function fitsPaper(width,height,denominator,paperWidth,paperHeight,margin=0){
 const usableW=paperWidth-margin*2,usableH=paperHeight-margin*2,tolerance=FIT_TOLERANCE_MM+Math.max(usableW,usableH)*1e-9;
 return width/denominator<=usableW+tolerance&&height/denominator<=usableH+tolerance;
}
export function automaticPlotLineweight(e,layer,role=e.type){
 if(Number.isFinite(e.lineweight)&&e.lineweight>0)return Math.max(.05,e.lineweight);
 const layerWeight=layer?.lineweight;
 // 0.25 mm는 새 레이어에 자동으로 붙는 기본값이므로 자동 모드에서는 객체 역할을 우선한다.
 if(Number.isFinite(layerWeight)&&layerWeight>0&&Math.abs(layerWeight-.25)>.0001)return Math.max(.05,layerWeight);
 const name=String(layer?.name||'').toLowerCase(),linetype=String(e.linetype||layer?.linetype||'').toUpperCase();
 if(role==='hatch'||name.includes('hatch')||name.includes('해치'))return .10;
 if(role==='dimension'||role==='text'||name.includes('dim')||name.includes('text')||name.includes('치수')||name.includes('문자'))return .18;
 if(role==='center'||role==='hidden'||linetype.includes('CENTER')||linetype.includes('HIDDEN')||name.includes('center')||name.includes('중심'))return .13;
 if(role==='wall'||name.includes('wall')||name.includes('벽')||name.includes('outline')||name.includes('외곽'))return .40;
 return Number.isFinite(layerWeight)&&layerWeight>0?Math.max(.05,layerWeight):.25;
}
// 출력 농도(훈민캐드 대조 기반 H24 · 훈민 CF/CR): 플롯 스타일 스크리닝(%) × 객체별 출력 농도(%). 블록·치수 안 객체는 바깥 농도를 물려받는다.
export const PLOT_DENSITIES=Object.freeze([100,80,60,40,20]);
// 한 번의 출력에서 해치 무늬로 그릴 선분·점 총량(pdf_service.HATCH_SEGMENT_BUDGET 과 같음).
export const PLOT_HATCH_BUDGET=400000;
// ACAD200 121: withTransparency(=AutoCAD 의 "투명도 출력", 기본 끔)이면 객체 투명도도 곱한다(화면·GPU 와 같은 함수).
export function plotOpacity(style,e={},inherited={},withTransparency=false){
 const clamp=v=>Math.max(0,Math.min(100,Number.isFinite(Number(v))?Number(v):100));
 const base=clamp(style?.screen??100)*clamp(e.plotDensity??inherited.plotDensity??100)/10000;
 return withTransparency?base*displayAlpha(e.transparency??inherited.transparency,{on:true}):base;
}
// 흑백 검토 강조: 상태 색 대신 선종류·굵기를 쓴다(표 문자는 기호·라벨 유지).
export function reviewPlotEntity(e,layer,colorMode){if(colorMode!=='mono'||e.layer!=='A-REVIEW'&&layer?.name!=='A-REVIEW'||!e.reviewStatus||['text','block'].includes(e.type))return e;const style=({revise:{linetype:'CONTINUOUS',lineweight:.5},need_input:{linetype:'DASHED',lineweight:.25},check_detail:{linetype:'CENTER',lineweight:.25},satisfied:{linetype:'CONTINUOUS',lineweight:.13}})[e.reviewStatus];if(!style)return e;return {...e,...style,...(e.type==='hatch'?{type:'polyline',closed:true}:{})};}
function outputInk(color,colorMode,{darkenLightColors=false}={}){
 if(colorMode==='mono')return '#000000';
 if(colorMode==='auto')return automaticPlotColor(color,{darkenLightColors});
 if(!/^#[0-9a-f]{6}$/i.test(color||''))return '#000000';
 const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
 if(Math.min(...rgb)>240)return '#000000';
 if(colorMode==='gray'){const v=Math.min(190,Math.round(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722));return '#'+v.toString(16).padStart(2,'0').repeat(3);}
 if(colorMode==='color'&&darkenLightColors)return legiblePlotColor(color);
 return color;
}
/* 창 출력은 창과 겹치는 최상위 객체만 펼친다. 대형 도면(블록 안 수십만 개)에서 출력 영역 밖 블록까지
   모두 풀었다가 버리던 것을 없앤다. 범위를 모르는 객체는 빼지 않는다(보수적으로 포함). */
export function plotCandidates(doc,window){
 if(!window)return doc.entities;
 const out=[];
 for(const e of doc.entities||[]){const b=e._renderBounds||G.bounds([e]);if(!b||!(b.maxX<window.minX||b.minX>window.maxX||b.maxY<window.minY||b.minY>window.maxY))out.push(e);}
 return out;
}
/** 선가중치 축척: 켜면 선 굵기를 출력 축척 1:100 기준으로 비례시킨다(1:50 이면 두 배, 1:200 이면 절반). */
export const plotLineweightFactor=(scaleLineweights,denominator)=>scaleLineweights?100/denominator:1;
/** 도면 창의 왼쪽 아래가 용지(mm, 위가 +y)의 어디에 놓이는가. 플롯의 중심이면 인쇄 영역 가운데, 아니면 인쇄 영역 왼쪽 아래 + 간격띄우기. */
export function plotPlacement({pw,ph,margin,w,h,denominator,center=true,offsetX=0,offsetY=0}){
 const ox=Number(offsetX)||0,oy=Number(offsetY)||0;
 return center?{x:margin+(pw-2*margin-w/denominator)/2,y:margin+(ph-2*margin-h/denominator)/2}:{x:margin+ox,y:margin+oy};
}
export function paperFitError(margin){return `선택한 용지와 축척에 도면이 들어가지 않습니다${margin>0?` (여백 ${margin} mm 제외)`:''}. 축척 분모를 키우거나 더 큰 용지를 선택하세요${margin>0?', 또는 여백을 줄이세요':''}.`;}
export function plotPDFJob(doc,options={}){
 let {colorMode='auto'}=options;const {paper='A3',orientation='landscape',margin=0,fit=false,lineweights=true,plotStyle=null,title='바른 CAD',darkenLightColors=false,center=true,offsetX=0,offsetY=0,mirror=false,scaleLineweights=false,plotTransparency=false}=options;
 if(colorMode==='ctb'&&!plotStyle)colorMode='auto';
 const sizes={A0:[1189,841],A1:[841,594],A2:[594,420],A3:[420,297],A4:[297,210]},size=orientation==='portrait'?[...(sizes[paper]||sizes.A3)].reverse():sizes[paper]||sizes.A3;
 let visible=G.visibleEntities(doc,{plot:true,entities:plotCandidates(doc,options.window)});const bounds=options.window||G.bounds(visible);if(options.window){validateWindow(options.window);/* 창 출력: 창과 겹치지 않는 객체는 PDF 로 보내지 않는다 */visible=visible.filter(e=>{const eb=G.bounds([e]);return eb&&!(eb.maxX<bounds.minX||eb.minX>bounds.maxX||eb.maxY<bounds.minY||eb.minY>bounds.maxY);});visible=[{type:'block',layer:doc.layers[0]?.id,clip:{enabled:true,points:G.rectangle({x:bounds.minX,y:bounds.minY},{x:bounds.maxX,y:bounds.maxY})},entities:visible}];}if(!bounds)throw Error('출력할 객체가 없습니다.');
 if(!Number.isFinite(margin)||margin<0||margin*2>=Math.min(size[0],size[1]))throw Error('용지 여백을 확인하세요.');
 const denominator=fit?plotFitScale(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY,size[0],size[1],margin,options.standardScales).denominator:Number(options.denominator??100);
 if(!Number.isFinite(denominator)||denominator<=0)throw Error('출력 축척은 양수입니다.');
 if(!(fit&&options.standardScales?.length)&&!fitsPaper(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY,denominator,size[0],size[1],margin))throw Error(paperFitError(margin));
 const layerById=new Map(doc.layers.map(l=>[l.id,l])),lwf=plotLineweightFactor(scaleLineweights,denominator);
 const visit=(e,inherited={})=>{const l=layerById.get(e.layer)||inherited;if(e.type==='block')return [{...e,...(l?.name?{pdfLayer:l.name}:{}),entities:e.entities.flatMap(c=>visit(c,{...l,color:e.color||l.color,lineweight:e.lineweight??l.lineweight,plotRole:e.plotRole||inherited.plotRole,plotDensity:e.plotDensity??inherited.plotDensity}))}];if(['dimension','wall'].includes(e.type))return G.primitives(e).flatMap(c=>visit(c,{...l,color:e.color||l.color,lineweight:e.lineweight??l.lineweight,plotRole:e.type,plotDensity:e.plotDensity??inherited.plotDensity}));e=reviewPlotEntity(e,l,colorMode);const {style,color:styled}=plotPen(e,l,colorMode,plotStyle),weight=style?.lineweight>0?style.lineweight:automaticPlotLineweight(e,l,e.plotRole||inherited.plotRole||e.type);return [{...e,color:outputInk(styled,colorMode,{darkenLightColors}),lineweight:(lineweights?weight:.18)*lwf,opacity:plotOpacity(style,e,inherited,plotTransparency),...(l?.name?{pdfLayer:l.name==='0'&&inherited.name?inherited.name:l.name}:{})}];};   // PDF 레이어(OCG) 이름: PDF 로 받은 사람이 다시 레이어로 나눠 읽는다
 return {action:'plot',...(fit&&options.standardScales?.length?{standardFit:true}:{}),...(options.stamp?{stamp:options.stamp}:{}),...(options.bookmark?{bookmark:String(options.bookmark).slice(0,120)}:{}),size,margin,denominator,bounds,center:center!==false,offsetX:Number(offsetX)||0,offsetY:Number(offsetY)||0,mirror:!!mirror,title:title+' · '+paper+' · 1:'+Number(denominator.toFixed(3)),entities:imageUnderlaysFirst(visible.flatMap(e=>visit(e)))};
}
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
export function plotSVG(
  doc,
  { paper = "A3", denominator = 100, title = "바른 CAD", orientation='landscape', fit=false, margin=0, colorMode='auto', lineweights=true, plotStyle=null, window=null, darkenLightColors=false, center=true, offsetX=0, offsetY=0, mirror=false, scaleLineweights=false, stamp=null, plotTransparency=false, standardScales=null } = {},
) {
  if(colorMode==='ctb'&&!plotStyle)colorMode='auto';
  const sizes = { A0:[1189,841], A1: [841,594], A2:[594,420], A4: [297, 210], A3: [420, 297] },
    [pw, ph] = orientation==='portrait' ? [...(sizes[paper] || sizes.A3)].reverse() : sizes[paper] || sizes.A3,
    es = G.visibleEntities(doc,{plot:true,entities:plotCandidates(doc,window)}),
    b = window||G.bounds(es);
  if(window)validateWindow(window);
  if (!b) throw Error("출력할 객체가 없습니다.");
  if (!Number.isFinite(margin)||margin<0||margin*2>=Math.min(pw,ph))throw Error('용지 여백을 확인하세요.');
  const fitScale=fit?plotFitScale(b.maxX-b.minX,b.maxY-b.minY,pw,ph,margin,standardScales):null;
  if (fit) denominator=fitScale.denominator;
  if (!Number.isFinite(denominator) || denominator <= 0)
    throw Error("출력 축척은 양수입니다.");
  const w = b.maxX - b.minX,
    h = b.maxY - b.minY;
  if (!(fit&&standardScales?.length)&&!fitsPaper(w, h, denominator, pw, ph, margin))
    throw Error(paperFitError(margin));
  const at = plotPlacement({pw,ph,margin,w,h,denominator,center,offsetX,offsetY}),
    tx = at.x - b.minX / denominator,
    ty = ph - at.y + b.minY / denominator,
    lwf = plotLineweightFactor(scaleLineweights,denominator);
  let counter = 0, hatchBudget = PLOT_HATCH_BUDGET;
  const definitions = [];
  const render = (e, inherited={}) => {
    const layer = doc.layers.find((l) => l.id === e.layer) || inherited;
    if(e.type==='block'){
      const content=e.entities.map(p=>render(p,{...layer,color:e.color||layer.color,lineweight:e.lineweight??layer.lineweight,plotRole:e.plotRole||inherited.plotRole,plotDensity:e.plotDensity??inherited.plotDensity})).join('');
      if(!e.clip?.enabled)return content;const id='xclip'+counter++;definitions.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path clip-rule="evenodd" d="${e.clip.inverted?'M -1000000000 -1000000000 H 1000000000 V 1000000000 H -1000000000 Z ':''}M ${e.clip.points.map(p=>p.x+','+-p.y).join(' L ')} Z"/></clipPath>`);return `<g clip-path="url(#${id})">${content}</g>`;
    }
    if (["dimension", "wall"].includes(e.type))
      return G.primitives(e).map(p=>render(p,{...layer,color:e.color||layer.color,lineweight:e.lineweight??layer.lineweight,plotRole:e.type,plotDensity:e.plotDensity??inherited.plotDensity})).join("");
    e=reviewPlotEntity(e,layer,colorMode);const {style,color:styled}=plotPen(e,layer,colorMode,plotStyle);
    const color=outputInk(styled,colorMode,{darkenLightColors}),
      stroke =
        (lineweights?(style?.lineweight>0?style.lineweight:automaticPlotLineweight(e,layer,e.plotRole||inherited.plotRole||e.type)):0.18) * denominator * lwf,
      // 흑백 검토 표시는 검토 상태 무늬를 먼저, 아니면 선종류 무늬.
      dash = (colorMode==='mono'&&e.reviewStatus&&{DASHED:[3,1.5],CENTER:[6,1.5,1,1.5]}[e.linetype]) || linetypeDashPattern(e.linetype || layer?.linetype, e.linetypeScale || layer?.linetypeScale || 1),
      dashAttr = dash.length ? ` stroke-dasharray="${dash.map(v => (Math.abs(v) * denominator).toFixed(3)).join(' ')}"` : '',
      a = `opacity="${plotOpacity(style,e,inherited,plotTransparency)}" stroke="${color}" stroke-width="${stroke}" fill="none"${dashAttr}`,
      p = (v) => `${v.x},${-v.y}`,
      poly = (points) => points.map(p).join(" ");
    if(e.type==='image'){
      const href=e.data||'/api/image?path='+encodeURIComponent(e.path).replaceAll("'",'%27');
      return `<image href="${escape(href)}" x="0" y="${-e.height}" width="${e.width}" height="${e.height}" preserveAspectRatio="none" opacity="${plotOpacity(style,e,inherited,plotTransparency)*imageOpacity(e.fade)}" transform="translate(${e.position.x} ${-e.position.y}) rotate(${-(e.rotation||0)})"/>`;
    }
    if (e.type === "point") return `<circle cx="${e.position.x}" cy="${-e.position.y}" r="${.25*denominator}" ${a}/>`;
    if (e.type === "line") return `<polyline points="${poly(e.points)}" ${a}/>`;
    if (["polyline", "rectangle"].includes(e.type))
      return `<${e.closed || e.type === "rectangle" ? "polygon" : "polyline"} points="${poly(e.points)}" ${a}/>`;
    if (e.type === "circle")
      return `<circle cx="${e.center.x}" cy="${-e.center.y}" r="${e.radius}" ${a}/>`;
    if (e.type === "ellipse") {
      const pts = G.ellipsePoints(e, 2),
        r = G.len(e.majorAxis),
        start = e.startParam || 0,
        end = e.endParam ?? Math.PI * 2,
        sweep = (((end - start) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (sweep < 1e-8)
        return `<ellipse cx="0" cy="0" rx="${r}" ry="${r * e.ratio}" transform="translate(${e.center.x},${-e.center.y}) rotate(${-G.angle(e.majorAxis)})" ${a}/>`;
      return `<path d="M${p(pts[0])} A${r},${r * e.ratio} ${-G.angle(e.majorAxis)} ${sweep > Math.PI ? 1 : 0} 0 ${p(pts.at(-1))}" ${a}/>`;
    }
    if (e.type === "arc") {
      const start = G.add(e.center, G.polar(e.radius, e.startAngle)),
        end = G.add(e.center, G.polar(e.radius, e.endAngle));
      return `<path d="M${p(start)} A${e.radius},${e.radius} 0 ${G.normalizeAngle(e.endAngle - e.startAngle) > 180 ? 1 : 0} 0 ${p(end)}" ${a}/>`;
    }
    if (e.type === "text"){
      const lines=e.text.split("\n"),rawWidth=Math.max(...lines.map(line=>line.length),1)*e.height*.65,padding=e.maskPadding??e.height*.25,left=e.align==='center'?-rawWidth/2:e.align==='right'?-rawWidth:0,top=-e.height*1.15,bottom=(lines.length-1)*e.height*1.35+e.height*.25,mask=e.backgroundMask?`<rect x="${left-padding}" y="${top-padding}" width="${rawWidth+padding*2}" height="${bottom-top+padding*2}" fill="#ffffff"/>`:'';
      return `<g transform="translate(${e.position.x},${-e.position.y}) rotate(${-(e.rotation || 0)}) scale(${e.widthFactor||1},1)">${mask}<text opacity="${plotOpacity(style,e,inherited,plotTransparency)}" fill="${color}" font-family="${escape(fontFamilyFor(e).replace(/"/g,"'"))}" font-size="${e.height*1.15}" text-anchor="${e.align === "center" ? "middle" : e.align === "right" ? "end" : "start"}">${lines.map((t,i)=>`<tspan x="0" y="${i*e.height*1.35}">${escape(t)}</tspan>`).join("")}</text></g>`;
    }
    if (e.type === "hatch") {
      const path = [e.points, ...(e.loops || [])]
        .map((loop) => "M" + loop.map(p).join(" L") + " Z")
        .join(" ");
      let fill = colorMode==='mono' ? "#d9d9d9" : color;
      // 가리기(WIPEOUT): 종이색(흰색)으로 덮는다. 테두리는 frame 1(보이고 출력)일 때만.
      if (e.wipeout) return `<path d="${path}" fill="#ffffff" fill-rule="evenodd"${e.frame === 1 ? ` stroke="${color}" stroke-width="${stroke}"` : ''}/>`;
      if (!e.solid) {
        /* 무늬는 화면(view.js)·DXF·PDF 와 같은 무늬 줄(hatch-patterns.js)을 선분으로 풀어 경계로 자른다. 예전 SVG <pattern> 은 사선·교차선만 그렸다. */
        const id = "h" + ++counter, opacity = plotOpacity(style,e,inherited,plotTransparency), n = v => +v.toFixed(3);
        // 출력 범위(창·도면 경계) 밖은 풀지 않고, 한 번의 출력 전체 선분 총량을 넘으면 옅은 채움으로(PDF·화면과 같은 규칙).
        const hb = G.bounds([e]), box = hb && {minX: Math.max(hb.minX, b.minX), minY: Math.max(hb.minY, b.minY), maxX: Math.min(hb.maxX, b.maxX), maxY: Math.min(hb.maxY, b.maxY)};
        if (!box || box.maxX <= box.minX || box.maxY <= box.minY) return '';
        const found = hatchSegments(hatchFamilies(e), box, { maxSegments: Math.max(1, Math.min(200000, hatchBudget)) });
        const { segments, dots } = found, dense = found.dense || segments.length + dots.length > hatchBudget;
        if (!dense) hatchBudget -= segments.length + dots.length;
        if (dense) return `<path opacity="${opacity}" d="${path}" fill="${fill}" fill-opacity="0.18" fill-rule="evenodd"/>`;
        definitions.push(`<clipPath id="${id}"><path d="${path}" clip-rule="evenodd"/></clipPath>`);
        const d = segments.map(([x1, y1, x2, y2]) => `M${n(x1)},${n(-y1)}L${n(x2)},${n(-y2)}`).join("") + dots.map(([x, y]) => `M${n(x)},${n(-y)}l${stroke},0`).join("");
        return `<g opacity="${opacity}" clip-path="url(#${id})"><path d="${d}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"/></g>`;
      }
      return `<path opacity="${plotOpacity(style,e,inherited,plotTransparency)}" d="${path}" fill="${fill}" fill-rule="evenodd"/>`;
    }
    return "";
  };
  let content = imageUnderlaysFirst(es).map(e=>render(e)).join("");
  let placed=`<g transform="translate(${tx} ${ty}) scale(${1 / denominator})">${content}</g>`;
  // 출력 영역 자르기는 용지 좌표(mm)로 한다. 도면 좌표(원거리 좌표 6,600만 mm 등)로 자르면
  // 브라우저가 32비트로 계산하다 전부 잘라 미리보기가 하얗게 비었다.
  if(window){definitions.push(`<clipPath id="plot-window"><rect x="${tx+b.minX/denominator}" y="${ty-b.maxY/denominator}" width="${w/denominator}" height="${h/denominator}"/></clipPath>`);placed=`<g clip-path="url(#plot-window)">${placed}</g>`;}
  if(mirror)placed=`<g transform="rotate(180 ${pw/2} ${ph/2})">${placed}</g>`;   // 대칭으로 플롯: 용지에서 180° 돌린다
  // ACAD200 723 플롯 스탬프(미리보기·프린터 출력도 PDF 와 같은 자리)
  if(stamp?.text){const h=Math.max(1,Math.min(10,Number(stamp.height)||2.5)),ox=Number(stamp.offset?.x)||0,oy=Number(stamp.offset?.y)||0,right=String(stamp.corner).endsWith('right'),top=String(stamp.corner).startsWith('top');placed+=`<text class="plot-stamp" x="${right?pw-ox:ox}" y="${top?oy+h:ph-oy}" font-size="${h}" font-family="NanumGothic, sans-serif" text-anchor="${right?'end':'start'}" fill="#000">${escape(stamp.text)}</text>`;}

  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${pw}mm" height="${ph}mm" viewBox="0 0 ${pw} ${ph}" data-plot-denominator="${denominator}" data-fit-warning="${escape(fitScale?.warning||'')}"><title>${escape(title)} · 1:${denominator}</title><defs>${definitions.join("")}</defs><rect width="${pw}" height="${ph}" fill="white"/>${placed}</svg>`;
}

function validateWindow(b){if(!['minX','minY','maxX','maxY'].every(k=>Number.isFinite(b[k]))||b.maxX<=b.minX||b.maxY<=b.minY)throw Error('출력 영역의 두 모서리를 확인하세요.');}

export async function embedPlotImages(svg,{read=path=>loadImageSource({path})}={}){
 const refs=[...new Set([...svg.matchAll(/href="\/api\/image\?path=([^"]*)"/g)].map(m=>m[1]))];
 for(const ref of refs){
  const source=await read(decodeURIComponent(ref));
  if(!/^data:image\/(png|jpeg|bmp);base64,[A-Za-z0-9+/]+=*$/.test(source.data||''))throw Error('Invalid plot image');
  svg=svg.replaceAll('href="/api/image?path='+ref+'"','href="'+source.data+'"');
 }
 return svg;
}
