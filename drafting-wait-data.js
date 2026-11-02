import {planReveal} from './ai-draw-reveal.js';
import {bounds} from './geometry.js';

function visibleBounds(entity) {
  let box=bounds([entity]);
  if(!box)return null;
  for(const mask of entity.clipMasks || [])if(!mask.inverted){
    const crop=bounds([{type:'polyline',points:mask.points}]);
    if(crop)box={minX:Math.max(box.minX,crop.minX),minY:Math.max(box.minY,crop.minY),
      maxX:Math.min(box.maxX,crop.maxX),maxY:Math.min(box.maxY,crop.maxY)};
  }
  return box.minX<=box.maxX&&box.minY<=box.maxY?box:null;
}

// Uses display copies, including resolved INSERT transforms; never edits the CAD document.
export function drawingData(entities, {title = '단면·상세', scale = null} = {}) {
  const plan = planReveal(entities);
  if (plan.immediate || !plan.clusters.length) throw Error('제도 공개 한도 초과');
  const keys = {base:'struct',structure:'struct',layers:'finish',hatch:'hatch',dims:'dims',leaders:'notes',text:'notes',title:'title'};
  const details = plan.clusters.map((cluster, i) => {
    const groups = ['struct','finish','hatch','dims','notes','title'].map(key => ({key,label:key,items:[]}));
    const boxes=[];
    for (const stage of cluster.stages) for (const entity of stage.items) {
      const box=visibleBounds(entity);if(!box)continue;boxes.push(box);
      // Native geometry goes to the same CAD renderer, not a lossy demo conversion.
      const p = (entity.points || [entity.position || entity.center || {x:0,y:0}]).map(p => [p.x,p.y]);
      groups.find(g => g.key === keys[stage.key]).items.push({native:entity,type:entity.type,p,
        role:entity.detailRole,s:String(entity.text || ''),h:entity.height || 1});
    }
    if(!boxes.length)return null;
    return {title,part:`${title} ${i+1}`,bounds:{minX:Math.min(...boxes.map(b=>b.minX)),minY:Math.min(...boxes.map(b=>b.minY)),
      maxX:Math.max(...boxes.map(b=>b.maxX)),maxY:Math.max(...boxes.map(b=>b.maxY))},groups,layers:[]};
  }).filter(Boolean);
  if(!details.length)throw Error('공개할 도형 없음');
  const boxes = details.map(d => d.bounds);
  return {details,scale:scale || '미지정',sheet:{minX:Math.min(...boxes.map(b=>b.minX)),minY:Math.min(...boxes.map(b=>b.minY)),
    maxX:Math.max(...boxes.map(b=>b.maxX)),maxY:Math.max(...boxes.map(b=>b.maxY))}};
}

export function isDraftingResult(doc, entities) {
  return entities.some(e => e.detail || e.detailRole ||
    ['details','section','set','all'].includes(doc.drawingSets?.[e.drawingSet?.id]?.kind));
}
