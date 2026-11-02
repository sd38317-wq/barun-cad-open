import {CanvasMipCache,rasterLevel} from './raster-mip-cache.js';

export const imageOpacity=fade=>1-Math.max(0,Math.min(100,Number.isFinite(fade)?fade:50))/100;
export function isDarkBackground(background){
 const rgb=/^#([0-9a-f]{6})$/i.exec(background)?.[1];
 return !!rgb&&(.2126*parseInt(rgb.slice(0,2),16)+.7152*parseInt(rgb.slice(2,4),16)+.0722*parseInt(rgb.slice(4,6),16)<128);
}
// Unmix the white paper matte into ink + alpha; invert only ink on dark CAD backgrounds.
export function keyImagePaper(pixels,dark=false){
 for(let i=0;i<pixels.length;i+=4){
  const paper=Math.min(pixels[i],pixels[i+1],pixels[i+2]),ink=255-paper;
  pixels[i+3]=Math.round(pixels[i+3]*ink/255);
  for(let c=0;c<3;c++){const color=ink?(pixels[i+c]-paper)*255/ink:0;pixels[i+c]=dark?255-color:color;}
 }
 return pixels;
}

// Split block trees too, retaining their clipping and inherited plot styles.
export function imageUnderlaysFirst(entities){
 const pass=(items,images)=>items.flatMap(e=>{
  if(e.type==='block'){const children=pass(e.entities||[],images);return children.length?[{...e,entities:children}]:[];}
  return (e.type==='image')===images?[e]:[];
 });
 return [...pass(entities,true),...pass(entities,false)];
}

/** Shared canvas underpass: composited before both GPU and Canvas line renderers. */
export function createImageRenderer({onReady=()=>{},createImage=()=>new Image(),createCanvas=()=>document.createElement('canvas'),maxSources=12}={}){
 const sources=new Map(),ink=new WeakMap(),mips=new CanvasMipCache({onReady,createCanvas});
 const acquire=e=>{
  const key=e.data||e.path;if(!key)return null;
  let item=sources.get(key);
  if(!item){
   item={image:createImage(),ready:false};sources.set(key,item);
   item.image.onload=()=>{item.ready=true;onReady();};item.image.onerror=()=>{item.failed=true;onReady();};
   item.image.src=e.data||'/api/image?path='+encodeURIComponent(e.path);
  }else{sources.delete(key);sources.set(key,item);}
  return item.ready?item.image:null;
 };
 return {
  draw(ctx,entities,screen,scale,{width=Infinity,height=Infinity,background='#101820'}={}){
   mips.incrementAge();const active=new Set();
   for(const e of entities){
    if(e.type!=='image')continue;
    const r=(e.rotation||0)*Math.PI/180,c=Math.cos(r),s=Math.sin(r),p=e.position;
    const a=screen(p),b=screen({x:p.x+e.width*c,y:p.y+e.width*s}),d=screen({x:p.x-e.height*s,y:p.y+e.height*c});
    const corners=[a,b,d,{x:b.x+d.x-a.x,y:b.y+d.y-a.y}];
    if(corners.every(p=>p.x<0)||corners.every(p=>p.x>width)||corners.every(p=>p.y<0)||corners.every(p=>p.y>height))continue;
    active.add(e.data||e.path);const image=acquire(e);if(!image)continue;
    const level=rasterLevel(Math.max(image.naturalWidth||image.width,image.naturalHeight||image.height),Math.max(e.width,e.height)*scale);
    const mip=mips.acquire(e.data||e.path,image,level);if(level>0&&!mip)continue;
    const source=mip?.canvas||image;
    const dark=isDarkBackground(background);let variants=ink.get(source);if(!variants){variants=[];ink.set(source,variants);}
    let bitmap=variants[+dark];if(!bitmap){
     bitmap=createCanvas();bitmap.width=source.naturalWidth||source.width;bitmap.height=source.naturalHeight||source.height;
     const pixels=bitmap.getContext('2d',{willReadFrequently:true});pixels.drawImage(source,0,0);
     const data=pixels.getImageData(0,0,bitmap.width,bitmap.height);keyImagePaper(data.data,dark);pixels.putImageData(data,0,0);variants[+dark]=bitmap;
    }
    // Browser pixels start at the top-left; d is the drawing's top-left corner.
    ctx.save();ctx.globalAlpha*=imageOpacity(e.fade);
    ctx.transform((b.x-a.x)/e.width,(b.y-a.y)/e.width,(a.x-d.x)/e.height,(a.y-d.y)/e.height,d.x,d.y);
    ctx.drawImage(bitmap,0,0,e.width,e.height);ctx.restore();
   }
   // Keep all sources used by this frame pinned, even when more than the idle budget.
   for(const [key] of sources){if(sources.size<=Math.max(maxSources,active.size))break;if(!active.has(key))sources.delete(key);}
  },
  clear(){sources.clear();mips.clear();},
  get sourceCount(){return sources.size;},mips,
 };
}
