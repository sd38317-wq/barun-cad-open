import {parcelEntities} from './geometry.js';
import {createSiteContext,makeSiteContext,roadEvidenceFromContext} from './site-context.js';
// CAD mm (east/north) -> plan-suggest metres (x/z). Ring order is preserved.
export function preparePlanSite(entities, { origin, roadEdges = null, siteContext = null } = {}) {
  entities=parcelEntities(entities);
  const boundaries = entities.filter(e => e.parcelRole === 'site');
  const roads = entities.filter(e => e.parcelRole === 'road');
  const outer = boundaries.filter(e => e.attributes?.ring !== 'hole');
  if (!outer.length) throw Error('대지 외곽 경계가 필요합니다.');
  origin = origin ?? outer[0].points?.[0];
  if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) throw Error('변환 원점이 올바르지 않습니다.');
  const convert = e => {
    if (e.type !== 'polyline' || !e.closed || !Array.isArray(e.points)) throw Error('닫힌 필지 경계가 필요합니다.');
    const points = e.points.map(p => {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw Error('경계 좌표가 올바르지 않습니다.');
      return { x: (p.x - origin.x) / 1000, z: (p.y - origin.y) / 1000 };
    });
    if (points.length > 1 && points[0].x === points.at(-1).x && points[0].z === points.at(-1).z) points.pop();
    const area = points.reduce((sum,p,i) => {const q=points[(i+1)%points.length];return sum+p.x*q.z-q.x*p.z;},0);
    if (points.length < 3 || Math.abs(area) < 1e-10) throw Error('면적이 있는 필지 경계가 필요합니다.');
    return { entityId: e.id ?? null, pnu: e.attributes?.pnu ?? null, polygon: e.attributes?.polygon ?? null, kind: e.attributes?.ring ?? 'outer', points };
  };
  const rings = outer.map(convert);
  const holes = boundaries.filter(e => e.attributes?.ring === 'hole').map(convert);
  const roadGeometry = roads.map(convert);
  const explicitContext=siteContext;siteContext=siteContext??outer[0]?.attributes?.siteContext??createSiteContext(entities);
  if(roadEdges===null){roadEdges=explicitContext?roadEvidenceFromContext(explicitContext):outer.flatMap((e,ringIdx)=>{const pnu=e.attributes?.pnu,local=outer.filter(x=>x.attributes?.pnu===pnu).indexOf(e),context=e.attributes?.siteContext;return context?roadEvidenceFromContext(context).filter(edge=>edge.ringIdx===local).map(edge=>({...edge,ringIdx})):[];});if(!roadEdges.length)roadEdges=roadEvidenceFromContext(createSiteContext(entities));}
  const blockers = [];
  if (holes.length) blockers.push('기존 설계 검토는 대지 내부 구멍을 지원하지 않습니다.');
  if (!roadEdges.length) blockers.push('접도변을 확인해야 합니다.');
  const seen = new Set();
  const evidence = roadEdges.map(edge => {
    const { ringIdx, index, measuredWidthM = null, confirmedWidthM = null, legalStatus = 'unknown' } = edge;
    if (!Number.isInteger(ringIdx) || !rings[ringIdx] || !Number.isInteger(index) || index < 0 || index >= rings[ringIdx].points.length) throw Error('접도변 번호가 올바르지 않습니다.');
    const key = `${ringIdx}:${index}`;
    if (seen.has(key)) throw Error('접도변이 중복됐습니다.');
    seen.add(key);
    for (const width of [measuredWidthM,confirmedWidthM]) if (width !== null && (!Number.isFinite(width) || width <= 0)) throw Error('도로폭은 양수여야 합니다.');
    if (!['unknown','confirmed','not-road'].includes(legalStatus)) throw Error('도로 확인 상태가 올바르지 않습니다.');
    // 직접 입력한 폭은 추가 승인 없이 쓰되, 명시된 법적 지위는 보존한다.
    if (Object.hasOwn(edge,'legalStatus')&&legalStatus === 'unknown'&&confirmedWidthM!==null) blockers.push(`접도변 ${ringIdx+1}-${index+1}: 도로 법적 지위 확인 필요`);
    if (legalStatus === 'not-road') blockers.push(`접도변 ${ringIdx+1}-${index+1}: 도로 아님`);
    if (confirmedWidthM === null) blockers.push(`접도변 ${ringIdx+1}-${index+1}: 도로폭 확인 필요`);
    return {ringIdx,index,measuredWidthM,confirmedWidthM,legalStatus};
  });
  // The legacy primary edge belongs to ring 0; do not silently choose edge 0.
  const primary = evidence.find(e => e.ringIdx === 0);
  if (evidence.length && !primary) blockers.push('주 대지의 접도변을 지정해야 합니다.');
  const site = blockers.length ? null : {
    ring: rings[0].points, extraRings: rings.slice(1).map(r => r.points),
    roadEdgeIndex: primary.index, roadWidthM: primary.confirmedWidthM,
    roadEdges: evidence.map(e => ({ringIdx:e.ringIdx,index:e.index,widthM:e.confirmedWidthM})),
  };
  return { site, blockers, rings, holes, roadGeometry, roadEvidence: evidence,
    siteContext: siteContext ?? makeSiteContext({polygonAreaM2: Math.abs(rings.reduce((sum,r)=>sum+r.points.reduce((a,p,i)=>{const q=r.points[(i+1)%r.points.length];return a+p.x*q.z-q.x*p.z;},0),0))/2, road: evidence[0]}),
    transform: { originMm: {...origin}, scale: 0.001, axes: 'x=east,z=north' } };
}

export function planPointToCad(point, transform) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) throw Error('설계 좌표가 올바르지 않습니다.');
  return {x:point.x / transform.scale + transform.originMm.x,y:point.z / transform.scale + transform.originMm.y};
}
