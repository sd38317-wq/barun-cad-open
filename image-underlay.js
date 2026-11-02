import {UNDERLAY_LAYER} from './underlay.js';

let transport=null;
// Workers ask their owning screen to read local files; engine tokens stay on the screen.
export function setImageTransport(fn){transport=fn;}

const positive=(n,label)=>{if(!Number.isFinite(n)||n<=0)throw Error(label+' must be positive');return n;};
const point=p=>{if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))throw Error('Invalid point');return p;};
export function pixelToDrawing(entity,p){
  const r=(entity.rotation||0)*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
  const x=p[0]*entity.width/entity.pixelWidth,y=(entity.pixelHeight-p[1])*entity.height/entity.pixelHeight;
  return {x:entity.position.x+x*c-y*s,y:entity.position.y+x*s+y*c};
}
export function alignImage(pixelWidth,pixelHeight,align){
  positive(pixelWidth,'pixelWidth');positive(pixelHeight,'pixelHeight');
  const pair=v=>Array.isArray(v)&&v.length===2&&v.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite));
  if(!pair(align?.imagePoints)||!pair(align?.drawingPoints))throw Error('Alignment needs two image and drawing points');
  const [a,b]=align.imagePoints,[u,v]=align.drawingPoints;
  if([a,b].some(p=>p[0]<0||p[0]>pixelWidth||p[1]<0||p[1]>pixelHeight))throw Error('Image point is outside the image');
  const dx=b[0]-a[0],dy=a[1]-b[1],tx=v[0]-u[0],ty=v[1]-u[1];
  const k=positive(Math.hypot(tx,ty),'Drawing reference length')/positive(Math.hypot(dx,dy),'Image reference length');
  const r=Math.atan2(ty,tx)-Math.atan2(dy,dx),c=Math.cos(r),s=Math.sin(r),x=a[0]*k,y=(pixelHeight-a[1])*k;
  return {position:{x:u[0]-x*c+y*s,y:u[1]-x*s-y*c},width:pixelWidth*k,height:pixelHeight*k,rotation:r*180/Math.PI};
}
export function imageEntity(args,source){
  const pixelWidth=positive(source.pixelWidth,'pixelWidth'),pixelHeight=positive(source.pixelHeight,'pixelHeight');
  const width=args.align?pixelWidth:args.width??pixelWidth*positive(args.pxToMm,'pxToMm');
  positive(width,'width');
  const fade=args.fade??50,rotation=args.rotation??0;
  if(!Number.isFinite(fade)||fade<0||fade>90||!Number.isFinite(rotation))throw Error('Invalid fade or rotation');
  const placement=args.align?alignImage(pixelWidth,pixelHeight,args.align):{position:{...point(args.position)},width,height:width*pixelHeight/pixelWidth,rotation};
  return {type:'image',...(source.path||args.path?{path:source.path||args.path}:{}),data:source.data,pixelWidth,pixelHeight,fade,...placement};
}
export async function loadImageSource(args,{api}={}){
  if(args.data){
    if(!/^data:image\/(png|jpeg|bmp);base64,/i.test(args.data)||args.data.length>70_000_000)throw Error('Invalid raster data URL');
    if(typeof Image==='undefined')return {data:args.data,pixelWidth:args.pixelWidth,pixelHeight:args.pixelHeight};
    const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Cannot decode image'));image.src=args.data;});
    if(image.naturalWidth*image.naturalHeight>25_000_000)throw Error('Image is too large');
    return {data:args.data,path:args.path,pixelWidth:image.naturalWidth,pixelHeight:image.naturalHeight};
  }
  if(transport)return transport({path:args.path});
  if(api)return api('image-read',{path:args.path});
  const status=await fetch('/api/status',{cache:'no-store'});if(!status.ok)throw Error('CAD engine is unavailable');
  const {engineToken}=await import('./studio.js'),token=await engineToken(await status.json(),globalThis.window?.cadDesktop);
  const response=await fetch('/api/image-read',{method:'POST',headers:{'Content-Type':'application/json','X-CAD-Token':token},body:JSON.stringify({path:args.path})});
  const source=await response.json();if(!response.ok||source.error)throw Error(source.error||'Cannot read image');return source;
}
export function commitImage(ctx,entity){
  const doc=ctx.doc(),old=doc.layers.find(l=>l.name===UNDERLAY_LAYER.name),layer=old?.id||crypto.randomUUID();
  if(old&&(old.locked||old.visible===false||old.frozen))throw Error('밑그림 레이어의 잠금·숨김을 해제하세요.');
  const commands=old?[]:[{type:'layer.add',id:layer,...UNDERLAY_LAYER}];
  ctx.execute({type:'batch',commands:[...commands,{type:'layer.update',id:layer,changes:{plot:false}},{type:'addMany',entities:[{...entity,layer}]}]});
  ctx.refresh?.();return {added:1,id:ctx.doc().entities.at(-1).id,position:entity.position,width:entity.width,height:entity.height,rotation:entity.rotation};
}
export async function insertImage(engine,args){
  const before=engine.doc,source=await loadImageSource(args),entity=imageEntity(args,source);
  if(engine.doc!==before)throw Error('도면이 변경되어 이미지 삽입을 취소했습니다.');
  commitImage({doc:()=>engine.doc,execute:c=>engine.execute(c)},entity);
  return {added:1,id:engine.doc.entities.at(-1).id,width:entity.width,height:entity.height,position:entity.position,rotation:entity.rotation};
}
