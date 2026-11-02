import * as G from "./geometry.js";
import { hatchFamilies, hatchSegments, gpuHatchFamilies } from "./hatch-patterns.js";
import { fontFamilyFor } from "./text-fonts.js";
import { blockImposterDecision, imposterState, suspendImposters, resumeImposters } from "./canvas-imposters.js";
import { previewAffine, applyAffine } from "./preview-matrix.js";
import { displayAlpha } from "./gpu-transparency.js";

export const DRAWING_FONT_FAMILY = '"Barun Drawing Korean", "NanumGothic", sans-serif';

const canvasPalettes = {
  dark: {background:'#101820',grid:'#2b3a46',axis:'#334b51',muted:'#607e8c',selection:'#ffffff',draft:'#afe7d1',grip:'#0787ff',gripEdge:'#79baff',crossing:'#95f0ae',window:'#87bfe4',cursor:'#8facb9',snap:'#ffc788',measure:'#b3d6c9',hintBackground:'rgba(21,43,57,.15)',hintBorder:'rgba(103,135,152,.18)',hintText:'rgba(226,241,245,.85)'},
  ivory: {background:'#f8f5ef',grid:'#ded9d0',axis:'#d2cbc0',muted:'#847c72',selection:'#a55236',draft:'#876449',grip:'#a55236',gripEdge:'#f5e6d7',crossing:'#4c795b',window:'#557894',cursor:'#766d62',snap:'#ae5939',measure:'#746043',hintBackground:'rgba(237,229,216,.15)',hintBorder:'rgba(122,107,89,.18)',hintText:'rgba(61,55,47,.85)'},
};
export function getCanvasPalette(theme = typeof document === 'undefined' ? 'dark' : document.documentElement.dataset.theme) {
  return canvasPalettes[theme] || canvasPalettes.dark;
}
// Themes affect workspace chrome only; drawing colors are preserved exactly.
export function drawingDisplayColor(color, theme) {
  return color;
}

/** 화면 렌더링과 레이어 미리보기가 같은 선종류 간격을 사용한다. */
// Parsing a linetype name builds regexes and tables; a large import asks for
// the same few names hundreds of thousands of times. Callers get a copy.
const dashPatternCache=new Map();
export function linetypeDashPattern(value = 'CONTINUOUS', scale = 1) {
  const cacheKey=String(value)+'\u0000'+scale;let cached=dashPatternCache.get(cacheKey);
  if(!cached){cached=(linetypeSource==='lin'&&linDashPattern(value,scale,documentLinetypes))||parseLinetypeDashPattern(value,scale);if(dashPatternCache.size<4096)dashPatternCache.set(cacheKey,cached);}
  return cached.slice();
}
/* 화면 점선 길이 = (축척 1 화면 무늬)와 (AutoCAD 처럼 도면 길이 = 정의 mm × 선종류 축척) 중 긴 쪽.
   예전엔 화면 무늬에 LTSCALE 을 곱해서 DWG 의 LTSCALE 50~200 이 무늬를 수백 px 로 만들어 점선이 실선처럼 보였다.
   linetypeDashPattern(이름, s) 무늬 p 에 이 값을 곱하면 도면 단위 길이다(pxPerWorld = 화면 배율). */
export function dashWorldPerPattern(pxPerWorld, scale = 1) {
  const s=Math.max(.05,Math.min(100,Number(scale)||1));
  return Math.max(1/(pxPerWorld*s),1/LIN_SCREEN_PX);
}
export function screenDashPattern(value, scale, pxPerWorld) {
  const k=dashWorldPerPattern(pxPerWorld,scale)*pxPerWorld;
  return linetypeDashPattern(value,scale).map(v=>v*k);
}
/* ACAD200 720: 선종류 무늬를 acadiso.lin 정의 비율 그대로. 값은 mm(음수 = 빈칸, 0 = 점)이고 공개 형식의 숫자만 옮겼다.
   화면 무늬는 화면 픽셀 기준이라(확대해도 무늬 길이 일정) 1 mm 를 LIN_SCREEN_PX 픽셀로 그린다. 그래서 AutoCAD 와 같은 비율
   (DASHED 와 HIDDEN 이 2:1, ISO02 가 12:3)로 보이면서 화면에서 읽기 좋은 길이를 지킨다. */
export const LIN_DEFS=Object.freeze({
  CONTINUOUS:[],
  BORDER:[12.7,-6.35,12.7,-6.35,0,-6.35],BORDER2:[6.35,-3.175,6.35,-3.175,0,-3.175],BORDERX2:[25.4,-12.7,25.4,-12.7,0,-12.7],
  CENTER:[31.75,-6.35,6.35,-6.35],CENTER2:[19.05,-3.175,3.175,-3.175],CENTERX2:[63.5,-12.7,12.7,-12.7],
  DASHDOT:[12.7,-6.35,0,-6.35],DASHDOT2:[6.35,-3.175,0,-3.175],DASHDOTX2:[25.4,-12.7,0,-12.7],
  DASHED:[12.7,-6.35],DASHED2:[6.35,-3.175],DASHEDX2:[25.4,-12.7],
  DIVIDE:[12.7,-6.35,0,-6.35,0,-6.35],DIVIDE2:[6.35,-3.175,0,-3.175,0,-3.175],DIVIDEX2:[25.4,-12.7,0,-12.7,0,-12.7],
  DOT:[0,-6.35],DOT2:[0,-3.175],DOTX2:[0,-12.7],
  HIDDEN:[6.35,-3.175],HIDDEN2:[3.175,-1.5875],HIDDENX2:[12.7,-6.35],
  PHANTOM:[31.75,-6.35,6.35,-6.35,6.35,-6.35],PHANTOM2:[15.875,-3.175,3.175,-3.175,3.175,-3.175],PHANTOMX2:[63.5,-12.7,12.7,-12.7,12.7,-12.7],
  ACAD_ISO02W100:[12,-3],ACAD_ISO03W100:[12,-18],ACAD_ISO04W100:[24,-3,0,-3],ACAD_ISO05W100:[24,-3,0,-3,0,-3],
  ACAD_ISO06W100:[24,-3,0,-3,0,-3,0,-3],ACAD_ISO07W100:[0,-3],ACAD_ISO08W100:[24,-3,6,-3],ACAD_ISO09W100:[24,-3,6,-3,6,-3],
  ACAD_ISO10W100:[12,-3,0,-3],ACAD_ISO11W100:[12,-3,12,-3,0,-3],ACAD_ISO12W100:[12,-3,0,-3,0,-3],ACAD_ISO13W100:[12,-3,12,-3,0,-3,0,-3],
  ACAD_ISO14W100:[12,-3,0,-3,0,-3,0,-3],ACAD_ISO15W100:[12,-3,12,-3,0,-3,0,-3,0,-3],
});
export const LIN_SCREEN_PX=0.6;
let linetypeSource='legacy',documentLinetypes=null,linetypeGenerationValue=0;
/** 'lin' = .lin 정의 비율(앱 기본) · 'legacy' = 예전 화면용 어림(되돌리기 설정). 표준에 없는 이름은 도면에서 온 정의(DWG LTYPE 표)를 이름 짐작보다 먼저 쓴다. */
export function setLinetypePatternSource(source='lin',definitions=documentLinetypes){
  const next=source==='legacy'?'legacy':'lin',defs=definitions&&typeof definitions==='object'?definitions:null;
  if(next===linetypeSource&&defs===documentLinetypes)return false;
  linetypeSource=next;documentLinetypes=defs;dashPatternCache.clear();linetypeGenerationValue++;return true;
}
export const linetypeGeneration=()=>linetypeGenerationValue;
export const linetypePatternSource=()=>linetypeSource;
/** .lin 정의(또는 도면 정의)를 화면 대시 배열로: [대시, 빈칸, …] 모두 양수, 점(0)은 0.5px. 정의가 없으면 null. */
export function linDashPattern(name,scale=1,definitions=null){
  const key=String(name||'CONTINUOUS').toUpperCase();
  const own=definitions?.[key]?.pattern??definitions?.[key];
  // 표준 이름은 .lin 값 그대로(다른 프로그램이 만든 DXF 의 표준 이름 정의는 값이 제각각이다). 표준에 없는 이름만 도면에서 온 정의를 쓴다.
  const usable=Array.isArray(own)&&own.length%2===0&&own.length<=24&&own.every(Number.isFinite);
  // 단, 도면 정의가 표준값의 정확히 1/25.4(acad.lin 인치 정의)면 AutoCAD 처럼 도면 값 그대로 — 미터 도면에 인치 DASHED(0.5)가 들어간
  // 주동딱지 가구가 25배 긴 파선으로 띄엄띄엄 끊겨 보였다(2026-11-02).
  const std=LIN_DEFS[key],inch=std&&usable&&own.length===std.length&&std.some(Boolean)&&std.every((v,i)=>Math.abs(Math.abs(own[i])*25.4-Math.abs(v))<=Math.abs(v)*0.01);
  const def=inch?own:std||(usable?own:null);
  if(!def)return null;
  const factor=Math.max(.05,Math.min(100,Number(scale)||1));
  return def.map(v=>v===0?0.5:Math.max(.25,Math.abs(v)*LIN_SCREEN_PX*factor));
}
/* ACAD200 718: 선 굵기 화면 표시(LWDISPLAY). 끄면 모두 1px. 켜면 0.75mm 까지는 예전과 같은 굵기(×4, 1~3px),
   그 위는 예전처럼 3px 에 묶이지 않고 8px 까지 점점 굵어져 1.0·1.4·2.0mm 가 구별된다. 화면 확대와 무관한 픽셀이다. */
let lineweightDisplayOn=true;
export function setLineweightDisplay(on){const next=on!==false;if(next===lineweightDisplayOn)return false;lineweightDisplayOn=next;return true;}
export const lineweightDisplay=()=>lineweightDisplayOn;
export function screenLineweightPx(lw,display=lineweightDisplayOn){
  if(!display)return 1;
  const mm=Number(lw);if(!(mm>0))return 1;
  return mm<=.75?Math.max(1,mm*4):Math.min(8,3+(mm-.75)*2.5);
}
function parseLinetypeDashPattern(value = 'CONTINUOUS', scale = 1) {
  const type=String(value||'CONTINUOUS').toUpperCase();
  // 표준 이름은 무늬 가족 + 크기(2 = 절반, X2 = 두 배)로 읽는다. 예전 이름(CENTER·PHANTOM·DOT·DASHED·HIDDEN)의 화면 무늬는 그대로다.
  // 표준이 아닌 이름(가져온 DWG 의 사용자 정의)은 예전처럼 이름에 든 낱말로 짐작한다.
  const size=/X2$/.test(type)?2:/[^X]2$/.test(type)?.5:1,family=type.replace(/(X2|2)$/,'');
  const families={CENTER:[12,3,2,3],PHANTOM:[12,3,2,3,2,3],DOT:[1,4],DASHED:[7,5],HIDDEN:[7,5],DASHDOT:[7,4,1,4],DIVIDE:[7,3,1,3,1,3],BORDER:[7,3,7,3,1,3]};
  const iso=type.match(/^ACAD_ISO(\d\d)W100$/);   // acadiso.lin 의 ISO 선종류(02 파선 · 07 점선 · 04/08/10 일점쇄선 · 05/09/12 이점쇄선 …)
  const isoPattern=iso?({'02':[7,5],'03':[7,8],'07':[1,4],'04':[14,4,1,4],'08':[14,4,5,4],'10':[7,4,1,4],'05':[14,3,1,3,1,3],'09':[14,3,5,3,5,3],'12':[7,3,1,3,1,3],'11':[7,3,7,3,1,3],'13':[7,3,7,3,1,3,1,3],'06':[14,3,1,3,1,3,1,3],'14':[7,3,1,3,1,3,1,3],'15':[7,3,7,3,1,3,1,3,1,3]}[iso[1]]||[7,5]):null;
  const guess=isoPattern||type.includes('CENTER')?isoPattern||[12,4,2,4]
    :type.includes('PHANTOM')?[12,3,2,3,2,3]
      :type.includes('DASHDOT')?[7,4,1,4]
        :type.includes('DOT')?[1,4]
          :type.includes('DASH')||type.includes('HIDDEN')?[7,5]
            :[];
  const pattern=families[family]||guess,factor=Math.max(.05,Math.min(100,(Number(scale)||1)*(families[family]?size:1)));
  return pattern.map(value=>value*factor);
}

// Previews (MOVE/COPY/ROTATE drafts, rubber bands) are dashed in screen pixels.
// Scaled by the object's linetype scale (drawings carry 50-200), a copied
// line's preview became 600 px dashes with 500 px gaps: most of it vanished.
// 원점 표시(오토캐드 UCS 아이콘처럼): 화면 끝까지 긋던 X·Y 선 대신 원점에 작은 L자. 원점이 화면 밖·가장자리면 왼쪽 아래 구석(조작 안내 글 위).
// height 는 명령창에 가리지 않는 높이(fitHeight)를 받는다.
const UCS_ICON=36,UCS_MARGIN=28;
export function ucsIconSpot(origin,width,height){
 const inside=origin.x>=UCS_MARGIN&&origin.x<=width-UCS_ICON-UCS_MARGIN&&origin.y>=UCS_ICON+UCS_MARGIN&&origin.y<=height-UCS_MARGIN;
 return inside?{x:origin.x,y:origin.y,atOrigin:true}:{x:UCS_MARGIN,y:height-48,atOrigin:false};
}
export function drawUcsIcon(ctx,origin,width,height,color){
 const {x,y}=ucsIconSpot(origin,width,height),L=UCS_ICON,h=5;
 ctx.save();ctx.lineWidth=1.5;ctx.strokeStyle=color;ctx.fillStyle=color;ctx.setLineDash([]);ctx.beginPath();
 ctx.moveTo(x,y);ctx.lineTo(x+L,y);ctx.moveTo(x+L-h,y-h);ctx.lineTo(x+L,y);ctx.lineTo(x+L-h,y+h);
 ctx.moveTo(x,y);ctx.lineTo(x,y-L);ctx.moveTo(x-h,y-L+h);ctx.lineTo(x,y-L);ctx.lineTo(x+h,y-L+h);
 ctx.stroke();ctx.font='11px Segoe UI';ctx.fillText('X',x+L+4,y+4);ctx.fillText('Y',x-4,y-L-5);ctx.restore();
}
export const PREVIEW_DASH=Object.freeze([6,5]);
// 가리개(WIPEOUT·글자 배경)는 그 그림의 바탕색으로 칠한다. 바탕이 화면 테마와 다른 그림(상세 미리보기 검은 바탕)은 이걸로 바꾼다(검토 B4).
let maskBackground=null;
export function withMaskBackground(color,draw){const previous=maskBackground;maskBackground=color;try{return draw();}finally{maskBackground=previous;}}
export function drawEntity(
  ctx,
  e,
  screen,
  scale,
  color,
  width = 1.5,
  dashed = false,
  forceColor = false,
  drawBox = null,
  hatchRaster = null,
) {
  if(e.type==='image'){const corners=G.imageCorners(e);ctx.save();ctx.strokeStyle=color||'#7f8a96';ctx.lineWidth=width;ctx.beginPath();corners.forEach((p,i)=>{const q=screen(p);if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);});ctx.closePath();ctx.stroke();ctx.restore();return;}
  const instance=G.getDisplayInstance(e);
  if(instance){const localBox=drawBox?{minX:drawBox.minX-instance.dx,maxX:drawBox.maxX-instance.dx,minY:drawBox.minY-instance.dy,maxY:drawBox.maxY-instance.dy}:null;drawEntity(ctx,instance.source,p=>screen({x:p.x+instance.dx,y:p.y+instance.dy}),scale,color,width,dashed,forceColor,localBox,hatchRaster);return;}
  // The caller supplies a viewport expanded for stroke width. A straight
  // segment wholly beyond one side cannot contribute any pixels there.
  if(drawBox&&e.type==='line'&&!e.center&&!e.closed&&e.points?.length===2){
    const [a,b]=e.points;
    if(Math.max(a.x,b.x)<drawBox.minX||Math.min(a.x,b.x)>drawBox.maxX||Math.max(a.y,b.y)<drawBox.minY||Math.min(a.y,b.y)>drawBox.maxY)return;
  }
  // AutoCAD renders a zero-length LINE as a point. Keep the LINE entity so
  // selection/snap continue to use its endpoint, but give it a visible mark.
  if(e.type==='line'&&!e.center&&!e.closed&&e.points?.length===2){
    const [a,b]=e.points;
    if(a.x===b.x&&a.y===b.y){
      const p=screen(a);ctx.save();ctx.fillStyle=drawingDisplayColor(color);ctx.fillRect(p.x-1,p.y-1,2,2);ctx.restore();return;
    }
  }
  if(e.type==='preview-transform'){
    // ACAD200 123: one 2x3 matrix per preview (translate/rotate/scale/mirror alike;
    // SCALE previously drew its objects unscaled).
    const m=e.matrix||previewAffine(e.operation,e);
    drawEntity(ctx,e.source,point=>screen(applyAffine(m,point)),scale,color,width,dashed,forceColor,null,hatchRaster);
    return;
  }
  if(e.type==='block'){
    let blockBounds=e._renderBounds;if(!blockBounds){blockBounds=G.bounds(e.entities||[]);try{Object.defineProperty(e,'_renderBounds',{value:blockBounds,writable:true,configurable:true,enumerable:false});}catch{}}
    // ACAD200 110·111: tiny/collapsed blocks become boxes, collected per frame and
    // stroked together (canvas-imposters.js); under frame pressure sub-pixel ones are skipped.
    if(blockBounds&&!e.clip?.enabled){const pixelWidth=(blockBounds.maxX-blockBounds.minX)*scale,pixelHeight=(blockBounds.maxY-blockBounds.minY)*scale;const frame=imposterState(ctx),decision=blockImposterDecision(pixelWidth,pixelHeight,{collapsed:!!e._lodCollapsed,factor:frame?.factor??1});if(decision==='skip')return;if(decision==='box'){const a=screen({x:blockBounds.minX,y:blockBounds.maxY}),w=Math.max(1,pixelWidth),h=Math.max(1,pixelHeight),batch=frame?.batch;if(batch)batch.add(color,Math.min(1,width),a.x,a.y,w,h);else{ctx.strokeStyle=color;ctx.lineWidth=Math.min(1,width);ctx.strokeRect(a.x,a.y,w,h);}return;}}
    // Boxes collected for the frame are stroked outside any clip: a clipped block draws its own.
    const imposters=e.clip?.enabled?suspendImposters(ctx):null;
    ctx.save();if(e.clip?.enabled){ctx.beginPath();if(e.clip.inverted)ctx.rect(-1e9,-1e9,2e9,2e9);e.clip.points.forEach((point,i)=>{const p=screen(point);if(i)ctx.lineTo(p.x,p.y);else ctx.moveTo(p.x,p.y);});ctx.closePath();ctx.clip('evenodd');}
    // Preserve each line's separate stroke (including overlap antialiasing),
    // but retain Canvas state across adjacent simple lines. Other primitives
    // can change state, e.g. a collapsed nested block, so invalidate afterward.
    let strokeColor,strokeDash,strokeDashScale,strokeReady=false;
    for(const child of G.queryDrawingChildren(e,drawBox)){
      const childColor=forceColor?color:child._displayColor||child.color||color;
      if(child.type==='line'&&!child.center&&!child.closed&&child.points?.length===2){
        const resolved=drawingDisplayColor(childColor),factor=Math.max(.05,Math.min(100,Number(child._displayLinetypeScale??child.linetypeScale??1)||1));
        const dashKey=child._displayLinetype||child.linetype||'CONTINUOUS';
        if(!strokeReady){ctx.save();ctx.lineWidth=width;strokeReady=true;}
        if(strokeColor!==resolved){ctx.strokeStyle=resolved;strokeColor=resolved;}
        if(strokeDash!==dashKey||strokeDashScale!==factor){ctx.setLineDash(dashed?PREVIEW_DASH:screenDashPattern(child._displayLinetype||child.linetype,factor,scale));strokeDash=dashKey;strokeDashScale=factor;}
        const a=screen(child.points[0]),b=screen(child.points[1]);
        if(child.points[0].x===child.points[1].x&&child.points[0].y===child.points[1].y){
          ctx.fillStyle=resolved;ctx.fillRect(a.x-1,a.y-1,2,2);
        }else{ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
      }else {if(strokeReady)ctx.restore();drawEntity(ctx,child,screen,scale,childColor,width,dashed,forceColor,drawBox,hatchRaster);strokeReady=false;strokeColor=undefined;strokeDash=undefined;strokeDashScale=undefined;}
    }
    if(strokeReady)ctx.restore();
    ctx.restore();resumeImposters(ctx,imposters);return;
  }
  if (["dimension", "wall"].includes(e.type)) {
    for (const p of G.primitives(e))
      drawEntity(ctx, p, screen, scale, forceColor ? color : p.color || color, width, dashed, forceColor, null, hatchRaster);
    return;
  }
  ctx.save();
  // ACAD200 121: object transparency (0~90 %), same rule as the GPU and plot.
  if (e.transparency != null) { const alpha = displayAlpha(e.transparency); if (alpha < 1) ctx.globalAlpha *= alpha; }
  color = drawingDisplayColor(color);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = e.type==='polyline'&&e.constantWidth>0?Math.max(.5,e.constantWidth*scale):width;
  if (e.type === "point") {
    const p = screen(e.position);
    ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
    ctx.restore();
    return;
  }
  if (e.type === "ellipse") {
    const p = screen(e.center),
      major = G.len(e.majorAxis) * scale;
    ctx.beginPath();
    ctx.ellipse(
      p.x,
      p.y,
      major,
      major * e.ratio,
      (-G.angle(e.majorAxis) * Math.PI) / 180,
      -(e.startParam || 0),
      -(e.endParam ?? Math.PI * 2),
      true,
    );
    ctx.stroke();
    ctx.restore();
    return;
  }
  const linetypeScale = Math.max(.05, Math.min(100, Number(e._displayLinetypeScale ?? e.linetypeScale ?? 1) || 1));
  ctx.setLineDash(dashed?PREVIEW_DASH:screenDashPattern(e._displayLinetype || e.linetype,linetypeScale,scale));
  if (e.type === "text") {
    const p = screen(e.position);
    ctx.translate(p.x, p.y);
    ctx.rotate((-(e.rotation || 0) * Math.PI) / 180);
    ctx.scale(Math.max(.01,e.widthFactor||1),1);
    ctx.font = `${Math.max(0.1, e.height * scale * 1.15)}px ${fontFamilyFor(e)}`;   // 원래 글꼴(sourceFont)을 Windows 글꼴로 대응, 없으면 나눔고딕
    ctx.textAlign = e.align || "left";
    ctx.textBaseline = "alphabetic";
    const lines=e.text.split("\n");
    if(e.backgroundMask){const rawWidth=Math.round(Math.max(.65,...lines.map(line=>G.textUnits(e,line)))*1e9)/1e9*e.height*scale,padding=(e.maskPadding??e.height*.25)*scale,left=e.align==='center'?-rawWidth/2:e.align==='right'?-rawWidth:0,top=-e.height*scale*1.15,bottom=(lines.length-1)*e.height*scale*1.35+e.height*scale*.25;ctx.fillStyle=(maskBackground??getCanvasPalette().background);ctx.fillRect(left-padding,top-padding,rawWidth+padding*2,bottom-top+padding*2);ctx.fillStyle=color;}
    lines
      .forEach((line, i) => ctx.fillText(line, 0, i * e.height * scale * 1.35));
    ctx.restore();
    return;
  }
  ctx.beginPath();
  const path = (points) => {
    points.forEach((v, i) => {
      const p = screen(v);
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    });
    ctx.closePath();
  };
  if (e.center) {
    const p = screen(e.center);
    ctx.arc(
      p.x,
      p.y,
      e.radius * scale,
      e.type === "arc" ? (-e.startAngle * Math.PI) / 180 : 0,
      e.type === "arc" ? (-e.endAngle * Math.PI) / 180 : Math.PI * 2,
      e.type === "arc",
    );
  } else if (e.type === "hatch") {
    path(e.points);
    for (const loop of e.loops || []) path(loop);
    if (e.wipeout) {
      // 가리기(WIPEOUT, ACAD200-411): 바탕색으로 꽉 칠해 뒤에 그린 객체를 감춘다. 테두리는 frame 0 이면 숨김.
      const fill = ctx.fillStyle;
      ctx.fillStyle = (maskBackground??getCanvasPalette().background);
      ctx.fill("evenodd");
      ctx.fillStyle = fill;
      if (e.frame !== 0) ctx.stroke();
    } else if (e.solid) {
      const alpha = ctx.globalAlpha;
      ctx.globalAlpha = alpha * 0.22;
      ctx.fill("evenodd");
      ctx.globalAlpha = alpha;
      ctx.stroke();
    } else {
      ctx.save();
      ctx.clip("evenodd");
      /* 무늬는 hatch-patterns.js 의 무늬 줄(도면 좌표)을 화면에 보이는 영역만 선분으로 푼다 — 출력(plot.js·pdf_service.py)·DXF 와 같은 규칙.
         예전 해치(사선·교차선)도 같은 줄로 바꿔 읽는다. 화면에서 3px 보다 촘촘하면 선 대신 옅게 채운다(예전에도 3px 로 뭉쳐 보였다). */
      const b = G.bounds([e]), s0 = screen({ x: 0, y: 0 }), canvasEl = ctx.canvas || {},
        cw = canvasEl.clientWidth || canvasEl.width || 0, ch = canvasEl.clientHeight || canvasEl.height || 0;
      // 화면 영역만 풀려면 screen 이 확대·이동뿐이어야 한다. 회전·대칭 미리보기(preview-transform)는 screen 이 도면을 돌리므로 해치 전체를 푼다.
      const s1 = screen({ x: 1, y: 0 }), s2 = screen({ x: 0, y: 1 }), plain = Math.abs(s1.y - s0.y) < 1e-9 && Math.abs(s2.x - s0.x) < 1e-9 && Math.abs(s1.x - s0.x - scale) < 1e-6 * Math.max(1, scale) && Math.abs(s0.y - s2.y - scale) < 1e-6 * Math.max(1, scale);
      const viewBox = plain && cw && ch && scale > 0 ? { minX: (-s0.x) / scale, maxX: (cw - s0.x) / scale, minY: (s0.y - ch) / scale, maxY: s0.y / scale } : null;
      const box = viewBox ? { minX: Math.max(b.minX, viewBox.minX), minY: Math.max(b.minY, viewBox.minY), maxX: Math.min(b.maxX, viewBox.maxX), maxY: Math.min(b.maxY, viewBox.maxY) } : b;
      const { segments, dots, dense } = hatchSegments(hatchRaster ? gpuHatchFamilies(e) : hatchFamilies(e), box, { minSpacing: (hatchRaster?.minSpacing ?? 3) / Math.max(scale, 1e-12), maxSegments: 40000, gapTail: hatchRaster ? hatchRaster.halfWidth / Math.max(scale, 1e-12) : 0 });
      ctx.lineWidth = hatchRaster ? hatchRaster.halfWidth * 2 : Math.min(1, width);
      if (dense) {
        const alpha = ctx.globalAlpha;
        ctx.globalAlpha = alpha * 0.18;
        ctx.fill("evenodd");
        ctx.globalAlpha = alpha;
      } else {
        ctx.setLineDash([]);
        ctx.beginPath();
        for (const [x1, y1, x2, y2] of segments) { const p1 = screen({ x: x1, y: y1 }), p2 = screen({ x: x2, y: y2 }); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
        for (const [x, y] of dots) { const p = screen({ x, y }); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.8, p.y); }
        ctx.stroke();
      }
      ctx.restore();
      ctx.restore();
      return;
    }
    ctx.restore();
    return;
  } else {
    e.points.forEach((v, i) => {
      const p = screen(v);
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    });
    if (e.type === "rectangle" || e.closed) ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();
}
// 323. 선분과 상자가 만나는가(AutoCAD select18 area_test_polyline 의 HD_Clip 아웃코드 + 자르기).
// 두 끝이 같은 바깥쪽이면 바로 false — 긴 폴리선·작은 상자에서 거의 모든 선분이 여기서 끝난다.
const outcode = (p, b) => (p.x < b.minX ? 1 : 0) | (p.x > b.maxX ? 2 : 0) | (p.y < b.minY ? 4 : 0) | (p.y > b.maxY ? 8 : 0);
export function segmentHitsBox(a, c, b) {
  const ca = outcode(a, b), cc = outcode(c, b);
  if (!ca || !cc) return true;
  if (ca & cc) return false;
  let t0 = 0, t1 = 1;
  const dx = c.x - a.x, dy = c.y - a.y;
  const clip = (pp, q) => {
    if (pp === 0) return q >= 0;
    const r = q / pp;
    if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  return clip(-dx, a.x - b.minX) && clip(dx, b.maxX - a.x) && clip(-dy, a.y - b.minY) && clip(dy, b.maxY - a.y) && t0 <= t1;
}
export function crossing(e, b) {
  const inBox = (p) =>
    p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
  // Reuse the exact clipped primitive index also used for picking. A fill or
  // text containing the box remains a candidate because its bounds overlap.
  return G.someEntityPrimitive(e,b,p => {
    if (p.type === "ellipse") {
      return crossing({ type: "polyline", points: G.ellipsePoints(p, 256) }, b);
    }
    if (G.vertices(p).some(v=>inBox(v)&&G.visiblePoint(p,v))) return true;
    const box = G.rectangle({ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY });
    if (p.type === "text" && box.some((v) => G.inside(v, G.vertices(p))&&G.visiblePoint(p,v)))
      return true;
    if (p.type === "hatch" && box.some((v) => G.hatchContains(p, v)&&G.visiblePoint(p,v)))
      return true;
    const sides = G.segments({ points: box, closed: true });
    const entitySegments=p.type==='text'?G.segments({points:G.vertices(p),closed:true}):G.segments(p);
    // 잘라내기 마스크가 없으면 아웃코드로 거른 뒤 Liang–Barsky 한 번(선분 × 상자 4변 교점 계산을 하지 않는다).
    if (!p.clipMasks?.length) { for (const s of entitySegments) if (segmentHitsBox(s[0], s[1], b)) return true; }
    else for (const s of entitySegments)
      for (const edge of sides) {
        const h = G.lineIntersection(...s, ...edge);
        if (h && h.t >= 0 && h.t <= 1 && h.u >= 0 && h.u <= 1&&G.visiblePoint(p,h.point)) return true;
      }
    if (p.type === "circle" || p.type === "arc") {
      for (const [a, z] of sides) {
        const v = G.sub(z, a),
          q = G.sub(a, p.center),
          A = G.dot(v, v),
          B = 2 * G.dot(q, v),
          C = G.dot(q, q) - p.radius * p.radius,
          D = B * B - 4 * A * C;
        if (D >= 0)
          for (const t of [
            (-B - Math.sqrt(D)) / (2 * A),
            (-B + Math.sqrt(D)) / (2 * A),
          ])
            if (
              t >= 0 &&
              t <= 1 &&
              (p.type === "circle" ||
                G.angleOnArc(
                  G.angle(G.sub(G.add(a, G.mul(v, t)), p.center)),
                  p.startAngle,
                  p.endAngle,
                ))
            )
              return true;
      }
    }
    return false;
  });
}
