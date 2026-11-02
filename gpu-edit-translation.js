import { translate } from './geometry.js';

// Retained GPU geometry may move only after the complete source entity proves
// equivalent to an ordinary engine translation. Never infer this from matching
// bounds alone: changed text, block contents, hatch patterns or style must force
// the renderer's normal rebuild path.
const renderCaches=new Set(['_renderBounds','_visibleEntities','_lodCollapsed']);
const anchor=entity=>{
  for(const point of [entity?.position,entity?.center,entity?.points?.[0]])
    if(Number.isFinite(point?.x)&&Number.isFinite(point?.y))return point;
  for(const child of entity?.entities||[]){const point=anchor(child);if(point)return point;}
  return null;
};
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Number.EPSILON*8*Math.max(1,Math.abs(a),Math.abs(b));
const geometricNumber=/^(?:entities\.\d+\.)*(?:(?:position|center|textPosition|majorAxis|origin)\.[xy]|points\.\d+\.[xy]|loops\.\d+\.\d+\.[xy]|clip\.points\.\d+\.[xy]|patternLines\.\d+\.(?:(?:base|offset)\.[xy]|angle)|parameters\.(?:[xy]|rotation)|parameters\.path\.\d+\.[xy]|xref\.(?:[xy]|rotation)|rotation|axisAngle|startAngle|endAngle|angle)$/;
function equivalent(a,b,path='') {
  if(a===b)return true;
  if(typeof a!==typeof b||a===null||b===null)return false;
  if(typeof a==='number')return geometricNumber.test(path)&&near(a,b);
  if(typeof a!=='object')return false;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,i)=>equivalent(value,b[i],path+'.'+i));
  const ignored=a.type&&b.type?renderCaches:new Set();
  const ak=Object.keys(a).filter(k=>!ignored.has(k)),bk=Object.keys(b).filter(k=>!ignored.has(k));
  return ak.length===bk.length&&ak.every(k=>Object.hasOwn(b,k)&&equivalent(a[k],b[k],path?path+'.'+k:k));
}

export function detectGpuTranslations(removed,added) {
  if(!Array.isArray(removed)||!Array.isArray(added)||!removed.length||removed.length!==added.length)return null;
  const next=new Map(added.map(entity=>[entity?.id,entity]));
  if(next.size!==added.length)return null;
  const result=new Map();
  try {
    for(const before of removed){
      if(!before?.id||result.has(before.id))return null;
      const after=next.get(before.id);
      if(!after||before.type!==after.type)return null;
      const a=anchor(before),b=anchor(after);if(!a||!b)return null;
      const dx=b.x-a.x,dy=b.y-a.y;if(!Number.isFinite(dx)||!Number.isFinite(dy))return null;
      // The engine normalizes implicit geometry defaults while translating
      // (e.g. text rotation=0 and legacy hatch origin). Canonicalizing both sides
      // also permits the inverse swap on undo without weakening style checks.
      const expected=translate(translate(before,dx,dy),0,0),actual=translate(after,0,0);
      // Hatch pattern directions are computed by subtracting translated points.
      // Their roundoff cannot always be reversed bit-for-bit. In that case
      // prove the opposite direction (the original move for an undo) instead
      // of accepting a looser angular tolerance.
      if(!equivalent(expected,actual)&&!equivalent(translate(before,0,0),translate(translate(after,-dx,-dy),0,0)))return null;
      result.set(before.id,{dx,dy});
    }
    return result;
  } catch { return null; }
}
