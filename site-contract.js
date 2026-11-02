// 설계엔진 계약 1.0(contract) → CAD 도형. 수신 명세 2026-10-11(엔진 main ba8e35a): 숫자 계산은 엔진, CAD 는 그리기·편집 추적만.
// 좌표: 엔진은 EPSG:5187 절대 mm 정수. 받는 쪽이 주는 pointMm(mm 점)이 도면 자리로 옮긴다(attachSitePlan 의 원점·자리와 같게).
// 레이어 이름은 엔진이 맞추고 색·선은 CAD 표(SITE_PLAN_LAYERS)가 칠한다. 주차는 PKD, 승강로는 XD 와 같은 작도(architecturalDetail).
import {architecturalDetail} from './architectural-library.js';

export const isContract10 = (result) => result?.contract?.contract_version === '1.0';

/** 안 하나: planId(max_far·max_bcr·efficiency) 없으면 엔진이 고른 안. 성립 안 없으면 이유와 함께 거절, "1안과 같음"은 그 안으로. */
export function contractPlan(contract, planId) {
  const plans = contract.plans || [], plan = planId ? plans.find((p) => p.plan_id === planId) : contract.selected_plan;
  if (!plan) throw Error(`계획안 "${planId}" 이 엔진 결과에 없습니다.`);
  if (plan.available === false) throw Error(`${plan.label_ko || plan.plan_id}: 성립하는 안이 없습니다${plan.verdict?.note_ko ? ' — ' + plan.verdict.note_ko : ''}.`);
  const same = plan.shared_with?.length && !plan.objects?.length ? plans.find((p) => plan.shared_with.includes(p.plan_id) && p.objects?.length) : null;
  return same ? {...same, plan_id: plan.plan_id, label_ko: plan.label_ko, sameAs: same.plan_id} : plan;
}

/** [1,2,3] → "1~3F", [4] → "4F", [1,3] → "1·3F" */
export function floorsLabel(floors) {
  const f = [...new Set(floors || [])].sort((a, b) => a - b);
  if (!f.length) return '';
  return f.length > 1 && f.at(-1) - f[0] === f.length - 1 ? `${f[0]}~${f.at(-1)}F` : `${f.join('·')}F`;
}
const signedArea = (ring) => ring.reduce((n, p, i) => {const q = ring[(i + 1) % ring.length];return n + p[0] * q[1] - q[0] * p[1];}, 0) / 2;
const centroid = (ring) => [ring.reduce((n, p) => n + p[0], 0) / ring.length, ring.reduce((n, p) => n + p[1], 0) / ring.length];

/**
 * 안 하나를 그린다. add(entity, layerName) → 넣은 객체, layerId(layerName) → id.
 * 돌려줌: objects(object_id → 경계 객체), outlines([{floors, entity}]), parking([{row, block}]).
 */
export function drawContractPlan(plan, {pointMm, add, layerId, textHeight = 300}) {
  const objects = new Map(), outlines = [], parking = [];
  const ringOf = (o) => (o.geometry?.kind === 'polygon' && Array.isArray(o.geometry.ring) ? o.geometry.ring : null);
  const tag = (o) => ({contractObjectId: o.object_id, contractRole: o.role});
  const buildingGroups = plan.objects.filter((o) => o.role === 'building_outline').sort((a, b) => Math.min(...(a.floors || [a.floor])) - Math.min(...(b.floors || [b.floor])));
  for (const o of plan.objects) {
    const ring = ringOf(o);
    if (!ring || o.role === 'stall') continue;   // 칸은 주차 줄(PKD)로 그린다
    const points = ring.map(pointMm), base = {type: 'polyline', ...tag(o), closed: true, points};
    if (o.role === 'elevator') {   // 승강로: 사각형에 X — XD 작도. 시계 반대 방향으로 맞춰 첫 변이 폭
      const r = signedArea(ring) < 0 ? [...ring].reverse() : ring, [a, b, c] = r.map(pointMm);
      const width = Math.hypot(b.x - a.x, b.y - a.y), depth = Math.hypot(c.x - b.x, c.y - b.y);
      const block = architecturalDetail('XD', {width: Math.round(width), depth: Math.round(depth), x: a.x, y: a.y, rotation: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI}, layerId(o.layer));
      objects.set(o.object_id, add({...block, ...tag(o), entities: block.entities.map((e) => ({...e, layer: layerId(o.layer)}))}, o.layer));continue;
    }
    if (o.role === 'sunlight') {objects.set(o.object_id, add({...base, constantWidth: 50, color: '#ff0000', linetype: 'DASHED', sunlightLimit: true}, o.layer));continue;}
    const entity = add({...base}, o.layer);objects.set(o.object_id, entity);
    if (o.role === 'stair') add({type: 'hatch', ...tag(o), points, pattern: 'cross', solid: false, angle: 0, spacing: 300}, o.layer);
    if (o.role === 'building_outline') {
      // 층 묶음: 앞 두 묶음(1층·기준층)은 해치(방향을 달리해 구분), 셋백 층 묶음은 점선 — 모두 층 글자
      const i = buildingGroups.indexOf(o), floors = o.floors || [o.floor];
      outlines.push({floors, entity});
      if (i < 2) add({type: 'hatch', ...tag(o), points, pattern: 'ANSI31', solid: false, angle: i ? 135 : 45, spacing: 600}, 'A-HATCH');
      else entity.linetype = 'DASHED';
      const [cx, cy] = centroid(ring);
      add({type: 'text', ...tag(o), text: floorsLabel(floors), position: pointMm([cx, cy - (i * textHeight * 1.6)]), height: textHeight, align: 'center', font: 'malgun'}, 'A-TEXT');
    }
  }
  for (const row of plan.parking_rows || []) {   // 한 줄 = PKD 한 번. 진입 변 시작점·줄 방향 = PKD 첫 칸 모서리·x 축(깊이는 왼쪽)
    const p = pointMm(row.base_point_mm);
    const block = architecturalDetail('PKD', {width: row.width_mm, depth: row.depth_mm, count: row.count, parkingAngle: row.parking_angle_deg, startNumber: row.start_number, stopper: row.stopper ? 'yes' : 'no', x: p.x, y: p.y, rotation: row.direction_deg, textHeight}, layerId(row.layer));
    const entity = add({...block, contractObjectId: row.object_id, contractRole: 'parking_row', parkingType: row.parking_type, entities: block.entities.map((e) => ({...e, layer: layerId(row.layer)}))}, row.layer);
    parking.push({row, block: entity});
  }
  return {objects, outlines, parking};
}

/** PKD 블록 안 k 번째 칸 사각형(블록을 옮기면 같이 옮겨져 있다) */
export const parkingStall = (block, k) => block.entities.filter((e) => e.type === 'polyline' && e.closed)[k]?.points;
/** 엔진 drawing_data의 현장 주석을 그린다. 좌표는 EPSG:5187 절대 mm이며 pointMm가 원점을 뺀다. */
export function drawContractAnnotations(input,{pointMm,add,textHeight=300,existingEntities=[]}={}){
 const drawing=input.drawing_data||input.plan?.drawing_data||{},made=[],occupied=[];
 const valid=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
 const box=(p,label,height=textHeight,align='center')=>{const width=Math.max(height,String(label).length*height);return {minX:p.x-(align==='center'?width/2:0),maxX:p.x+(align==='center'?width/2:width),minY:p.y-height*.3,maxY:p.y+height*1.2};};
 const visit=es=>{for(const e of es){if(e.type==='text'&&e.position)occupied.push(box(e.position,e.text,e.height||textHeight,e.align));if(e.type==='block'&&e.entities)visit(e.entities);}};visit(existingEntities);
 const overlaps=b=>occupied.some(a=>b.minX<a.maxX+textHeight*.5&&b.maxX>a.minX-textHeight*.5&&b.minY<a.maxY+textHeight*.5&&b.maxY>a.minY-textHeight*.5);
 const emit=(e,layer)=>{if(e.type==='line'&&Math.hypot(e.points[0].x-e.points[1].x,e.points[0].y-e.points[1].y)<1e-6)return;const entity=add(e,layer);made.push(entity);return entity;};
 const label=(text,raw,role,layer='A-TEXT')=>{
  if(!valid(raw))return;const anchor=pointMm(raw);let p={x:anchor.x,y:anchor.y+textHeight*2};
  // 가져온 안의 주석만 배치한다. 기존 문자와 겹치면 바깥쪽 빈 줄로 옮긴다.
  for(let row=0;overlaps(box(p,text));row++)p={x:anchor.x,y:anchor.y+textHeight*(4+row*2)};
  occupied.push(box(p,text));emit({type:'line',points:[anchor,p],annotationRole:role},'A-DIM');
  emit({type:'text',text,position:p,height:textHeight,align:'center',font:'malgun',annotationRole:role},layer);
 };
 const site=input.plan?.objects?.find(o=>o.role==='site')?.geometry?.ring||input.parcelMm||[];
 const center=site.length?centroid(site):input.originMm;
 const samples=(drawing.elevation_points||[]).filter(s=>valid(s.point_mm));
 for(const s of samples)label((s.role==='road_contact'?'도로 ':'')+'EL '+(Number.isFinite(s.elevation_m)?s.elevation_m.toFixed(2):'미확인'),s.point_mm,'elevation','A-DIM');
 if(!samples.length)label('EL '+(Number.isFinite(drawing.terrain?.parcel?.mean_m)?drawing.terrain.parcel.mean_m.toFixed(2):'미확인'),center,'elevation','A-DIM');
 for(const c of drawing.clearances||[]){
  if(!valid(c.face_mid_mm)||!valid(c.q_mm))continue;
  emit({type:'line',points:[pointMm(c.face_mid_mm),pointMm(c.q_mm)],annotationRole:'boundary-clearance',clearanceEdge:c.edge_idx??c.edge},'A-DIM');
  const v=c.distance_m??c.distance,text=(c.edge_kind==='road'?'도로':'대지경계')+' 이격 '+(Number.isFinite(v)?v.toFixed(2)+'m':'미확인');
  label(text,[(c.face_mid_mm[0]+c.q_mm[0])/2,(c.face_mid_mm[1]+c.q_mm[1])/2],'boundary-clearance','A-DIM');
 }
 for(const [role,text] of [['main_entrance','주출입구'],['vehicle_entrance','차량 출입구']]){
  const entry=drawing[role],q=entry?.point_mm;if(!valid(q))continue;
  const raw=valid(entry.normal)?entry.normal:[0,1],len=Math.hypot(...raw)||1,n=raw.map(v=>v/len);
  emit({type:'polyline',closed:true,points:[q,[q[0]+n[0]*600-n[1]*300,q[1]+n[1]*600+n[0]*300],[q[0]+n[0]*600+n[1]*300,q[1]+n[1]*600-n[0]*300]].map(pointMm),annotationRole:role,contractRole:'entrance'},'A-SYM');label(text,q,role);
 }
 return {entities:made,count:made.length};
}

/** 건축개요 18줄 → [이름, 값] (값은 사람이 읽는 글. 엔진 숫자 그대로, 지어내지 않는다) */
export function contractOverviewRows(rows) {
  const num = (v, d = 2) => Number(v).toLocaleString('ko-KR', {maximumFractionDigits: d});
  const fmt = (r) => {
    const v = r.value, legal = r.legal_limit;
    if (v === null || v === undefined || v === '') return '미확인';
    if (r.key === 'road_access' && Array.isArray(v)) return v.map((x) => `${x.direction_label_ko || ''} ${num(x.width_m)}m`.trim()).join(' · ');
    if (r.key === 'building_scale' && typeof v === 'object') return `지상 ${v.above_ground_floors ?? '?'}층 · 지하 ${v.basement_floors ?? 0}층`;
    if (r.key === 'dwelling_units' && typeof v === 'object') return v.count == null ? '—' : `${v.count}세대`;
    if (r.key === 'floor_areas' && Array.isArray(v)) return v.map((f) => `${f.floor}층 ${f.use_label_ko || ''} ${num(f.area_m2)}㎡`).join(' / ');
    if (r.key === 'sunlight_setback' && Array.isArray(v)) return v.map((c) => `${c.passed === false ? '확인 필요' : '적합'} · ${c.label_ko}`).join(' / ');
    if (typeof v === 'number') {
      const unit = {m2: '㎡', percent: '%', m: 'm', vehicles: '대', units: '세대'}[r.unit] ?? (r.unit || '');
      const pyeong = r.area_pyeong != null ? ` (${num(r.area_pyeong)}평)` : '';
      return `${num(v)} ${unit}${pyeong}${legal != null ? ` / 법정 ${num(legal)} ${unit}` : ''}`.trim();
    }
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  };
  return rows.map((r) => [r.label_ko || r.key, fmt(r) + (r.note_ko ? ` (${r.note_ko})` : '')]);
}
