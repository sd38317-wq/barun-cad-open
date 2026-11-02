// Heavy drawings reuse the viewport query only while the exact zoom is stable.
// A 40 px pan bucket stays safely inside the 80 px query padding used by app.js.
export function visibilityCacheKeys({heavy,scale,viewMoving,a,b,width,height,lodBand=0}){
 if(!heavy)return {scaleKey:0,viewportKey:''};
 const safeScale=Math.max(Number(scale)||0,1e-12),panStep=40/safeScale;
 const centerX=(a.x+b.x)/2,centerY=(a.y+b.y)/2;
 return {
  // ACAD200 108: the moving-frame block size grows with frame pressure (lodBand 0..2).
  scaleKey:`${safeScale.toPrecision(12)}:${viewMoving?1:0}${lodBand?':'+lodBand:''}`,
  viewportKey:`${Math.floor(centerX/panStep)}:${Math.floor(centerY/panStep)}:${Math.round(width)}:${Math.round(height)}`,
 };
}

// The caller supplies a proven copy-on-write delta (or an exhaustive reference
// diff of immutable history snapshots). Keep expanded shared blocks untouched
// when a small scoped edit cannot alter their display properties.
// A layer table change is part of such a delta when every object whose display
// reads a changed layer is among the removed/added objects (usesLayers:
// geometry.js entityUsesLayers, changedLayers: changedDisplayLayers).
export function retainedLayersCompatible(previousDoc,doc,added,{changedLayers,usesLayers}){
 if(previousDoc.layers===doc.layers)return true;
 if(typeof changedLayers!=='function'||typeof usesLayers!=='function')return JSON.stringify(previousDoc.layers)===JSON.stringify(doc.layers);
 const changed=changedLayers(previousDoc.layers,doc.layers);if(!changed.size)return true;
 const fresh=new Set(added);
 for(const entity of doc.entities)if(!fresh.has(entity)&&usesLayers(doc.sharedBlocks,entity,changed))return false;
 return true;
}
export function retainVisibleEntities(previousDoc,doc,cached,removed,added,resolveAdded,layerTools={}){
 // Moved or restyled shared references resolve to lazy instances, so a large
 // delta (a whole-drawing MOVE) costs its top-level objects, not its primitives.
 if(previousDoc.entities.length>50000||doc.entities.length>50000||removed.length+added.length>20000)return null;
 for(const key of new Set([...Object.keys(previousDoc),...Object.keys(doc)])){
  if(key==='entities')continue;
  if(key==='layers'){if(!retainedLayersCompatible(previousDoc,doc,added,layerTools))return null;}
  // Block definitions are not displayed (references carry their own children).
  else if(key!=='blocks'&&previousDoc[key]!==doc[key])return null;
 }
 const byId=new Map(cached.map(e=>[e.id,e]));
 const fresh=resolveAdded(added,byId);
 for(const e of removed)byId.delete(e.id);
 for(const e of fresh)byId.set(e.id,e);
 const result=[];
 for(const e of doc.entities){const resolved=byId.get(e.id);if(resolved)result.push(resolved);}
 return result;
}
