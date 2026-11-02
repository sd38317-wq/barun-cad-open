import * as G from './geometry.js';
import {drawEntity,getCanvasPalette} from './view.js';

// Command-only result view. The drawing renderer and its retained scene stay untouched.
export function dimensionBreakPreviewScene(doc,changes) {
 const ids=new Set(changes.map(e=>e.id)),bounds=G.bounds(changes);
 if(!bounds)throw Error('치수 끊기 미리보기의 범위를 확인하세요.');
 const span=Math.max(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY,1),padding=span*.12;
 const box={minX:bounds.minX-padding,minY:bounds.minY-padding,maxX:bounds.maxX+padding,maxY:bounds.maxY+padding};
 const surrounding=G.visibleEntities(doc,{entities:doc.entities.filter(e=>!ids.has(e.id)),viewBox:box});
 return {box,surrounding,changes};
}
export function renderDimensionBreakPreview(canvas,doc,changes,{paint=drawEntity,palette=getCanvasPalette()}={}) {
 const scene=dimensionBreakPreviewScene(doc,changes),ctx=canvas.getContext('2d');
 const width=canvas.width,height=canvas.height,box=scene.box;
 const fitScale=Math.min(width/(box.maxX-box.minX),height/(box.maxY-box.minY));
 const initial={x:(box.minX+box.maxX)/2,y:(box.minY+box.maxY)/2,scale:fitScale};
 const view={...initial},screen=p=>({x:width/2+(p.x-view.x)*view.scale,y:height/2-(p.y-view.y)*view.scale});
 const draw=()=>{
  ctx.clearRect(0,0,width,height);ctx.fillStyle=palette.background;ctx.fillRect(0,0,width,height);
  const viewport={minX:view.x-width/(2*view.scale),maxX:view.x+width/(2*view.scale),minY:view.y-height/(2*view.scale),maxY:view.y+height/(2*view.scale)};
  for(const e of scene.surrounding)paint(ctx,e,screen,view.scale,e._displayColor||e.color||palette.muted,1,false,false,viewport);
  for(const e of scene.changes)paint(ctx,e,screen,view.scale,'#9dcbe0',1.4,false,true,viewport);
 };
 const reset=()=>{Object.assign(view,initial);draw();};
 const coordinates=event=>{const r=canvas.getBoundingClientRect();return {x:(event.clientX-r.left)*width/r.width,y:(event.clientY-r.top)*height/r.height};};
 canvas.addEventListener('wheel',event=>{
  event.preventDefault();const p=coordinates(event),factor=event.deltaY<0?1.25:.8,newScale=Math.max(fitScale/4,Math.min(fitScale*1024,view.scale*factor));
  view.x+=(p.x-width/2)*(1/view.scale-1/newScale);view.y-=(p.y-height/2)*(1/view.scale-1/newScale);view.scale=newScale;draw();
 },{passive:false});
 let drag=null;
 canvas.addEventListener('pointerdown',event=>{if(event.button!==0)return;drag={...coordinates(event),id:event.pointerId};canvas.setPointerCapture?.(event.pointerId);});
 canvas.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;const p=coordinates(event);view.x-=(p.x-drag.x)/view.scale;view.y+=(p.y-drag.y)/view.scale;drag={...p,id:drag.id};draw();});
 const release=event=>{if(drag?.id===event.pointerId)drag=null;};
 canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);canvas.addEventListener('lostpointercapture',release);
 draw();return {scene,view,reset};
}
