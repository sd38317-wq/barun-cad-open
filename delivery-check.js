// 납품 전 점검: 도면을 남에게 넘기기 전에 볼 것을 한 창에 모은다.
// 새 검사를 따로 짜지 않고 이미 있는 정리 도구(AUDIT·OVERKILL·GEOMETRYCLEANUP)를 그대로 부르고,
// 바른 CAD 기준 두 가지(A- 표준 레이어, A3 출력에서 읽히는 글자 크기)만 더한다. 고치기는 항목마다 되돌리기 한 단계.
import {planAudit,auditFixCommand,planOverkill,overkillCommand,planGeometryCleanup,geometryCleanupCommand} from './drawing-cleanup.js';
import {standardLayerForName} from './layer-standards.js';
import {coreExtents} from './extent-core.js';
import {structureDrawingEntities} from './structure-drawing.js';
import * as G from './geometry.js';

// 도면 기준(drawing-standard annotation.paper): 글자는 종이 위 2.5 mm 이상(체크리스트 012). 제목도 6 mm 대라 12 mm 넘으면 지나치게 큼.
export const PAPER_TEXT_MIN=2.5,PAPER_TEXT_MAX=12;
const EXEMPT_LAYERS=new Set(['0','defpoints']);
const TEXT_TYPES=new Set(['text','mtext']);

/** 점검 항목 목록. 항목 = {key, title, why, count, ids, fix:(()=>엔진 명령)|null}. count 0 이면 통과. */
export function planDeliveryCheck(doc,{lockedLayers=new Set(),denominator=100}={}){
  const entities=doc?.entities||[],items=[];
  const audit=planAudit(doc);
  items.push({key:'audit',title:'도면 데이터 오류',why:`없는 레이어 ${audit.report.missingLayer} · 잘못된 좌표 ${audit.report.badNumber} · 길이 0 선 ${audit.report.zeroLength} · 겹친 ID ${audit.report.duplicateIds}`,
    count:audit.problems,ids:[...audit.removeIds].map(e=>e.id).filter(Boolean),fix:audit.problems?()=>auditFixCommand(doc,audit):null});
  const overkill=planOverkill(doc,{lockedLayers});
  items.push({key:'overkill',title:'겹친 선·중복 객체',why:`똑같은 객체 ${overkill.duplicates} · 한 줄로 합칠 선 ${overkill.merged}`,
    count:overkill.duplicates+overkill.merged,ids:[...overkill.deleteIds,...overkill.updates.map(u=>u.id)],fix:overkill.total||overkill.updates.length?()=>overkillCommand(overkill):null});
  const geometry=planGeometryCleanup(doc,{lockedLayers}),c=geometry.counts;
  const issueIds=kinds=>[...new Set(geometry.issues.filter(x=>kinds.includes(x.kind)).flatMap(x=>x.ids))];
  const ends=c.gap+c.overshoot+c.undershoot;
  items.push({key:'ends',title:'안 맞은 선 끝',why:`틈 ${c.gap} · 넘침 ${c.overshoot} · 모자람 ${c.undershoot} (틈 1 mm · 넘침·모자람 5 mm 이내)`,
    count:ends,ids:issueIds(['gap','overshoot','undershoot']),fix:ends?()=>geometryCleanupCommand(geometry,doc,['gap','overshoot','undershoot']):null});
  items.push({key:'angle',title:'조금 기운 선',why:'수평·수직에서 0.5° 안쪽으로 비뚤어진 선 (고칠 때 닿은 선 끝도 함께)',
    count:c.angle,ids:issueIds(['angle']),fix:c.angle?()=>geometryCleanupCommand(geometry,doc,['gap','overshoot','undershoot','angle']):null});   // 따로 바로잡으면 붙여 둔 끝이 다시 벌어진다
  // 바른 기준 ①: 표준(A-…) 밖 레이어에 그린 객체. 어느 표준으로 옮길지는 사람이 정하므로 고르기만 한다.
  const layerName=new Map((doc?.layers||[]).map(l=>[l.id,l.name]));
  const offLayers=new Map(),offIds=[];
  for(const e of entities){const name=layerName.get(e.layer)??e.layer??'0';if(EXEMPT_LAYERS.has(String(name).toLowerCase())||standardLayerForName(name))continue;offIds.push(e.id);offLayers.set(name,(offLayers.get(name)||0)+1);}
  const names=[...offLayers.entries()].sort((a,b)=>b[1]-a[1]).map(([n])=>n);
  items.push({key:'layers',title:'표준 밖 레이어',why:names.length?`${names.slice(0,4).join(', ')}${names.length>4?` 외 ${names.length-4}개`:''} — 레이어 창에서 A- 표준으로 옮기세요`:'모두 A- 표준 레이어',
    count:offIds.length,ids:offIds,fix:null});
  // 바른 기준 ②: 소속 도곽 축척 우선, 도곽 밖은 생성 묶음 축척 → 요청한 출력 축척.
  const valid=s=>s.bounds&&Number.isFinite(Number(s.denominator))&&Number(s.denominator)>0;
  const sheets=(doc?.sheets||[]).filter(valid),structureSheets=[],scales=new Set(),small=[],large=[];
  for(const set of Object.values(doc?.structureSets||{})){
    // 이전 도면은 생성 응답에만 도곽이 있었다. 저장된 모델·배치로 같은 시트 범위를 읽는다.
    try{const rows=set.sheetRecords||(set.drawn&&set.model?structureDrawingEntities(set.model,{...set.drawn,setId:set.id}).sheets.map(s=>({...s,denominator:s.scale})):[]);structureSheets.push(...rows.filter(valid));}catch{}
  }
  const area=s=>(s.bounds.maxX-s.bounds.minX)*(s.bounds.maxY-s.bounds.minY);
  const sheetAt=(rows,p)=>rows.filter(s=>p&&p.x>=s.bounds.minX&&p.x<=s.bounds.maxX&&p.y>=s.bounds.minY&&p.y<=s.bounds.maxY).sort((a,b)=>area(a)-area(b))[0];
  for(const e of entities){
    if(!TEXT_TYPES.has(e.type)||!(e.height>0))continue;
    const p=e.position,sheet=(e.sheetId&&sheets.find(s=>s.id===e.sheetId))||sheetAt(sheets,p)||sheetAt(structureSheets,p);
    const scale=doc?.drawingSets?.[e.drawingSet?.id]?.options?.scale,k=Number(sheet?.denominator)||(/^1\/[1-9]\d*$/.test(scale)?Number(scale.split('/')[1]):denominator),mm=e.height/k;
    scales.add(k);if(mm<PAPER_TEXT_MIN*0.97)small.push(e.id);else if(mm>PAPER_TEXT_MAX)large.push(e.id);
  }
  const printed=[...scales].sort((a,b)=>a-b).map(k=>'1:'+k).join(' · ')||'1:'+denominator;
  items.push({key:'text',title:'출력 글자 크기',why:`${printed} 로 찍으면(소속 시트 우선 · 시트 밖 1:${denominator}) ${PAPER_TEXT_MIN} mm 보다 작은 글자 ${small.length} · ${PAPER_TEXT_MAX} mm 넘는 글자 ${large.length}`,
    count:small.length+large.length,ids:[...small,...large],fix:null});
  // 멀리 떨어진 객체(전체 보기에서 빼는 것과 같은 판단, extent-core.js): 지울지는 사람이 정한다.
  const far=coreExtents(entities.filter(e=>!e.construction),G.vertices);
  items.push({key:'far',title:'멀리 떨어진 객체',why:far.farCount?`본 도면에서 멀리 떨어진 객체 ${far.farCount}개 — 필요 없으면 지우세요(전체 보기에서는 빠져 있음)`:'없음',count:far.farCount,ids:far.far.map(e=>e.id).filter(Boolean),fix:null});
  return {items,denominator,problems:items.reduce((n,i)=>n+(i.count?1:0),0)};
}
