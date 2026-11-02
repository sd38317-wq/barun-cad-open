// Shared pure validation/planning. The worker never receives the editor itself.
// CSS measurements can undershoot an integral backing size by float32 noise.
// THREE floors its drawing buffer but rounds its viewport, so that tiny error
// otherwise loses a full row/column. Genuine fractional dimensions stay exact.
export function alignRasterView(view){
 const d=view.pixelRatio||1;
 const align=value=>{
  const physical=value*d,target=Math.round(physical);
  if(!(value>0&&d>0)||!Number.isFinite(physical)||target<1||Math.abs(physical-target)>1e-4)return value;
  let logical=target/d;
  // Division/multiplication can still land one ULP below the integer.
  if(logical*d<target)logical+=Math.abs(logical)*Number.EPSILON;
  return logical;
 };
 const width=align(view.width),height=align(view.height);
 return width===view.width&&height===view.height?view:{...view,width,height};
}
export function viewOf(o){return alignRasterView({width:o.width,height:o.height,scale:o.scale,origin:{...o.origin},pixelRatio:o.pixelRatio||1,hiddenTextId:o.hiddenTextId??null});}
export function sameView(a,b){if(!a||!b)return false;a=alignRasterView(a);b=alignRasterView(b);return ['width','height','scale','pixelRatio','hiddenTextId'].every(k=>a[k]===b[k])&&a.origin.x===b.origin.x&&a.origin.y===b.origin.y;}
export function renderRegion(view,overscan=128){
 view=alignRasterView(view);
 const d=view.pixelRatio,integral=Math.abs(view.width*d-Math.round(view.width*d))<1e-7&&Math.abs(view.height*d-Math.round(view.height*d))<1e-7;
 const margin=integral?Math.round(overscan*d)/d:0;
 return alignRasterView({...view,width:view.width+2*margin,height:view.height+2*margin,origin:{x:view.origin.x+margin,y:view.origin.y+margin},margin});
}
export function cropRegion(frame,view){
 view=alignRasterView(view);
 const a=frame.view&&alignRasterView(frame.view),r=frame.region,d=view.pixelRatio;
 if(!a||['width','height','scale','pixelRatio','hiddenTextId'].some(k=>a[k]!==view[k]))return null;
 const dx=(view.origin.x-a.origin.x)*d,dy=(view.origin.y-a.origin.y)*d;
 if(Math.abs(dx-Math.round(dx))>1e-7||Math.abs(dy-Math.round(dy))>1e-7)return null;
 const x=r.margin*d-Math.round(dx),y=r.margin*d-Math.round(dy),w=Math.floor(view.width*d),h=Math.floor(view.height*d);
 if(x<0||y<0||x+w>frame.bitmap.width||y+h>frame.bitmap.height)return null;
 return {x,y,w,h};
}
export function planDocument(previous,revision,o){
 const doc=o.doc,edit=o.edit;
 if(previous===doc&&revision===o.revision)return null;
 // Bound main-thread work. All unchanged entity references remain in worker.
 // A DRAWORDER edit (ACAD200 120) reorders without removing or adding: send the full order.
 if(previous&&edit?.lightweight&&!edit.drawOrder&&edit.previousDoc===previous&&edit.previousRevision===revision&&
   previous.layers===doc.layers&&previous.sharedBlocks===doc.sharedBlocks&&previous.linetypeScale===doc.linetypeScale&&
   (edit.added?.length||0)+(edit.removed?.length||0)<=256){
  const wanted=new Set(edit.added||[]),added=[];
  if(wanted.size)for(let index=0;index<doc.entities.length;index++)if(wanted.has(doc.entities[index]))added.push({entity:doc.entities[index],index});
  if(added.length===wanted.size)return {kind:'delta',removed:(edit.removed||[]).map(e=>e.id),added};
 }
 return {kind:'full',doc:{entities:doc.entities,layers:doc.layers,sharedBlocks:doc.sharedBlocks,linetypeScale:doc.linetypeScale}};
}
export function applyDocument(previous,revision,update){
 if(update.kind==='full')return {doc:update.doc,edit:null};
 if(!previous)throw Error('GPU worker delta has no document');
 const ids=new Set(update.removed),removed=previous.entities.filter(e=>ids.has(e.id));
 if(removed.length!==ids.size)throw Error('GPU worker delta does not match document');
 const entities=previous.entities.filter(e=>!ids.has(e.id));
 for(const entry of [...update.added].sort((a,b)=>a.index-b.index))entities.splice(entry.index,0,entry.entity);
 return {doc:{...previous,entities},edit:{lightweight:true,previousDoc:previous,previousRevision:revision,removed,added:update.added.map(e=>e.entity)}};
}
