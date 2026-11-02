import * as G from './geometry.js';
import {hatchFamilies,hatchSegments} from './hatch-patterns.js';

// 322. 해치는 "그려진 대로" 집는다(AutoCAD select18: 칠은 삼각형 안, 선은 선 근처).
//  · 칠한(단색) 해치: 안쪽 어디든 집힌다. 그 위 문자·선이 먼저 잡히도록 반 칸 뒤로 미룬다(예전과 같음).
//  · 무늬 해치: 경계선과 커서 둘레 상자 안의 무늬 선까지 거리로 집힌다(무늬 선은 커서 둘레 작은 상자 안의 것만 만든다).
//    무늬 빈칸은 모드에 따라
//      'weak'(기본)    : 둘레에 다른 객체가 하나도 없을 때만 해치가 집힌다 — 해치 아래 선·문자를 고르기 쉽고, 해치만 있으면 그대로 집힌다.
//      'drawn'(AutoCAD): 빈칸은 집히지 않는다 — 빈칸 클릭은 선택창이 된다.
//      'interior'(예전): 안쪽 전체가 반 칸 거리로 집힌다.
let hatchPickMode='weak';
export function setHatchPickMode(value){hatchPickMode=['weak','drawn','interior'].includes(value)?value:'weak';return hatchPickMode;}
/** 예전 이름(참/거짓). 참이면 'interior', 거짓이면 'weak'. */
export function setHatchPickInterior(value){return setHatchPickMode(value?'interior':'weak');}
const isSolidHatch=e=>!!e.solid||String(e.pattern||'').toLowerCase()==='solid';
function patternHatchDistance(entity,point,tolerance){
  const loops=[entity.points,...(Array.isArray(entity.loops)?entity.loops:[])].filter(loop=>Array.isArray(loop)&&loop.length>=3);
  let nearest=Infinity;
  for(const loop of loops)for(let i=0;i<loop.length;i++)nearest=Math.min(nearest,G.distanceToSegment(point,loop[i],loop[(i+1)%loop.length]));
  if(!(tolerance>0)||!Number.isFinite(tolerance))return nearest;
  const box={minX:point.x-tolerance,minY:point.y-tolerance,maxX:point.x+tolerance,maxY:point.y+tolerance};
  const {segments,dots,dense}=hatchSegments(hatchFamilies(entity),box,{maxSegments:400});
  if(dense)return 0;                       // 무늬가 집기 상자보다 촘촘하면 칠과 같다
  for(const [x1,y1,x2,y2] of segments)nearest=Math.min(nearest,G.distanceToSegment(point,{x:x1,y:y1},{x:x2,y:y2}));
  for(const [x,y] of dots)nearest=Math.min(nearest,Math.hypot(point.x-x,point.y-y));
  return nearest;
}
// 해치 안쪽을 찍으면 거리가 0 이라 그 위의 문자·선과 비기는데, 그때 그리는 순서로 해치가 먼저 잡혀
// 숫자를 더블클릭해도 해치 편집이 열렸다. 해치 안쪽은 반 칸 뒤로 미뤄 겹친 다른 객체가 먼저 잡히게 한다.
export function pickDistance(entity, point, tolerance, bound = tolerance) {
  const distance = G.entityDistance(entity, point, bound);
  if (entity.type !== 'hatch' || distance !== 0) return distance;
  if (hatchPickMode === 'interior' || isSolidHatch(entity)) return tolerance / 2;
  const drawn = patternHatchDistance(entity, point, tolerance);
  if (drawn === 0) return tolerance / 2;
  if (drawn < tolerance) return drawn;
  return hatchPickMode === 'drawn' ? Infinity : tolerance * 0.95;
}
export function pickDisplayEntity(candidates, point, tolerance, options = {}, isLocked = () => false) {
  let best = tolerance;
  let hit = null;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const entity = candidates[i];
    if (!options.locked && isLocked(entity)) continue;
    if (options.exclude?.includes(entity.id)) continue;
    const distance = pickDistance(entity, point, tolerance, best);
    if (distance < best) {
      best = distance; hit = entity;
      // Distances cannot be negative. Earlier candidates cannot beat zero,
      // and strict comparison already gives the last candidate a tied hit.
      if (distance === 0) break;
    }
  }
  return hit;
}
