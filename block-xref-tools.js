// 블럭 및 외부참조 미연결 13개(BLA는 목록에 두 번 있으나 하나). 바른 CAD 리습(izzarder.com) 정리본
// docs/izzarder-reference-20260921/references/15-block-xref.md 와 각 절 끝 원문(izzarder.com/NNN)을
// WebFetch로 직접 읽어 옮겼다: MFX/350 LII/246 REX/144 RBP/335 XRL/20 XRC/376 XRR/278 B2X/473 BAD/346
// BBL/603 BLA/450 CX/217 MFB/213.
//
// 바른 CAD의 외부참조 구조(중요, app.js를 읽고 확인했다): AutoCAD처럼 "블럭 정의 테이블 + 여러 INSERT"가
// 아니라, XREF로 붙인 도형이 entity.xref(폴더·파일·축척·상대경로)와 함께 type:'block' 엔티티 안에 절대좌표로
// 통째로 박힌다(file-workflows.js의 XREF/XREFSTYLE/XREFBIND 명령, xref.test.js로 검증됨). 결합(BIND)도
// XREFBIND가 xref:null로 바꾸기만 할 뿐 이름을 "이름$0$켜"처럼 병합하지 않는다 — AutoCAD의 $0$ 접두어 현상
// 자체가 바른 CAD에는 생기지 않는다(RBP가 "없음"인 이유). 여러 도면 파일을 동시에 열어 처리하는 ObjectDBX
// 같은 기능도 없고(MFX/MFB의 "여러 파일" 축은 없음), 카드에는 파일을 저장·재부착하는 권한도 없다(cardContext에
// api/output이 없음 — B2X/CX가 "없음"인 이유). 반대로 지시문이 "없음" 예시로 든 "외부참조 파일 다시 읽기"는
// 실제로는 이미 파일-워크플로 XREF 명령(action:'refresh')으로 구현·검증돼 있어(xref.test.js), REX/XRR은
// 그 실제 명령을 여는 실동작 카드로 만들었다(보고서 "정직한 한계" 참고 — 코드 확인이 지시문 예시보다 우선).
//
// 도면 안 블럭에 바로 적용되는 BBL·BLA·BAD·LII·MFB는 실제로 동작하게 만들었고, 순수 함수를 시험했다.
// engine.js의 block 엔티티는 자식(entity.entities)을 절대좌표로 그대로 담고(block.create가
// structuredClone만 하고 좌표를 옮기지 않는다), G.resize/G.rotate/G.translate가 xref·sharedBlock
// 메타데이터까지 재귀적으로 다뤄준다는 것을 geometry.js transformEntity에서 확인하고 그대로 썼다.
import * as G from './geometry.js';
import {STD_LAYERS} from './card-kit.js';

/* ── 켜(레이어) 와일드카드 (XRC "적용/제외 켜") ── */
export function layerWildcardMatch(pattern, name) {
 const list = String(pattern || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
 if (!list.length) return false;
 return list.some(pat => new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i').test(name));
}

/* ── XRC: 외부참조 색 일괄변경. 재귀적으로 자식까지 색을 바꾸고, 켜 제외/포함 와일드카드와
   "꺼지거나 얼려진 켜 제외"를 반영한다. update 명령에 바로 쓸 {id,changes} 목록을 돌려준다. ── */
export function xrefRestylePlan(entities, layerById, opts = {}) {
 const { color, includeLayers = '', excludeLayers = '', excludeHidden = false } = opts;
 if (!color || !/^#[0-9a-f]{6}$/i.test(color)) throw Error('변경색은 #RRGGBB 형식입니다.');
 const targets = (entities || []).filter(e => e.xref);
 if (!targets.length) throw Error('색을 바꿀 외부참조가 없습니다.');
 const passesLayer = name => {
  if (excludeLayers && layerWildcardMatch(excludeLayers, name)) return false;
  if (includeLayers && !layerWildcardMatch(includeLayers, name)) return false;
  return true;
 };
 const recolor = list => list.map(e => {
  const layer = layerById.get(e.layer);
  const skip = (excludeHidden && layer && (layer.visible === false || layer.frozen)) || !passesLayer(layer?.name || '');
  const next = { ...e };
  if (!skip) next.color = color;
  if (Array.isArray(e.entities)) next.entities = recolor(e.entities);
  return next;
 });
 return targets.map(e => {
  const [restyled] = recolor([e]);
  const { id, type, ...changes } = restyled;
  return { id: e.id, changes };
 });
}

/* ── XRL: 현재 도면의 외부참조 목록(이름/경로/상태). "여러 파일" 축은 지원하지 않는다. ── */
export function xrefRows(entities) {
 return (entities || []).filter(e => e.xref).map(e => ({
  name: e.name,
  folder: e.xref.folder || '',
  file: e.xref.name || '',
  relative: !!e.xref.relative,
  hidden: !!e.hidden,
  status: e.hidden ? '숨김' : '표시',
 }));
}

/* ── LII: 고른 객체(블록·외부참조·일반 객체) 정보. pickEntity는 최상위 객체만 돌려줘(서브엔티티
   선택 없음) 블록 속 한 낱개 객체가 아니라 고른 최상위 객체 자체의 정보를 보여준다. ── */
function countAllInner(list) { let n = 0; for (const e of list || []) { n++; if (Array.isArray(e.entities)) n += countAllInner(e.entities); } return n; }
export function describeEntity(entity, layers) {
 if (!entity) throw Error('정보를 볼 객체를 선택하세요.');
 const layer = (layers || []).find(l => l.id === entity.layer);
 const info = {
  kind: entity.type,
  blockName: entity.type === 'block' ? entity.name : null,
  xrefPath: entity.xref ? (entity.xref.relative ? '[프로젝트 기준] ' : '') + (entity.xref.folder || '') + '/' + (entity.xref.name || '') : null,
  innerCount: Array.isArray(entity.entities) ? countAllInner(entity.entities) : null,
  layerName: layer?.name || entity.layer || '',
  color: entity.color || 'ByLayer',
  layerColor: layer?.color || null,
  linetype: entity.linetype || 'ByLayer',
  layerLinetype: layer?.linetype || null,
  // 선가중치(H19 · AutoCAD LIST): 객체 값이 없으면 ByLayer 와 레이어 값
  lineweight: Number.isFinite(entity.lineweight) ? entity.lineweight : 'ByLayer',
  layerLineweight: Number.isFinite(layer?.lineweight) ? layer.lineweight : null,
  plotDensity: Number.isFinite(entity.plotDensity) ? entity.plotDensity : null,
 };
 if (entity.type === 'line' && entity.points?.length >= 2) { info.start = entity.points[0]; info.end = entity.points.at(-1); }
 if ((entity.type === 'circle' || entity.type === 'arc') && entity.center) { info.center = entity.center; info.radius = entity.radius; }
 if (entity.type === 'text') { info.text = entity.text; info.textHeight = entity.height; }
 return info;
}
const fmtPoint = p => '(' + p.x.toFixed(1) + ',' + p.y.toFixed(1) + ')';
function formatInfo(info) {
 const parts = [
  info.kind + (info.blockName ? ' "' + info.blockName + '"' : ''),
  '켜 ' + info.layerName,
  '색 ' + info.color + (info.layerColor ? '(켜색 ' + info.layerColor + ')' : ''),
  '선종류 ' + info.linetype + (info.layerLinetype ? '(켜선종류 ' + info.layerLinetype + ')' : ''),
  '선가중치 ' + (typeof info.lineweight === 'number' ? info.lineweight.toFixed(2) + 'mm' : info.lineweight) + (info.layerLineweight != null ? '(켜 ' + info.layerLineweight.toFixed(2) + 'mm)' : ''),
 ];
 if (info.plotDensity != null) parts.push('출력 농도 ' + info.plotDensity + '%');
 if (info.xrefPath) parts.push('경로 ' + info.xrefPath);
 if (info.innerCount != null) parts.push('내부 객체 ' + info.innerCount + '개');
 if (info.start) parts.push('시작점 ' + fmtPoint(info.start) + ' 끝점 ' + fmtPoint(info.end));
 if (info.center) parts.push('중심 ' + fmtPoint(info.center) + ' 반지름 ' + Number(info.radius).toFixed(1));
 if (info.text != null) parts.push('문자 "' + info.text + '"');
 return parts.join(' · ');
}

/* ── 같은 이름의 블록 인스턴스 찾기(BLA·MFB 공용). 외부참조·표(table) 블록은 뺀다. ── */
export function matchingBlockIds(entities, name) {
 if (!name) throw Error('블록 이름이 없습니다.');
 return (entities || []).filter(e => e.type === 'block' && !e.table && !e.xref && e.name === name).map(e => e.id);
}

/* ── BLA: 블록 내부 객체 켜 변경(컨테이너 자신의 켜는 그대로, 자식만 재귀적으로 바꾼다). ── */
export function recolorBlockInterior(entity, layerId) {
 if (entity?.type !== 'block') throw Error('블록만 켜를 바꿀 수 있습니다.');
 if (entity.xref) throw Error('외부참조는 원본 보호를 위해 켜를 바꿀 수 없습니다.');
 if (!layerId) throw Error('바꿀 켜를 고르세요.');
 const recur = list => (list || []).map(e => {
  const next = { ...e, layer: layerId };
  if (Array.isArray(e.entities)) next.entities = recur(e.entities);
  return next;
 });
 return { ...entity, entities: recur(entity.entities || []) };
}

/* ── 블록 기준점(BBL 삽입점·MFB 크기변경 기준): position이 있으면 그 값, 없으면 범위 중심. ── */
export function blockCenter(entity) {
 if (entity?.type !== 'block') throw Error('블록만 선택할 수 있습니다.');
 if (entity.position) return { x: entity.position.x, y: entity.position.y };
 const b = G.bounds([entity]);
 if (!b) throw Error('블록 범위를 계산할 수 없습니다(내부가 비어 있습니다 · 공유 블록이면 먼저 독립시키세요).');
 return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}
export const blockAnchor = blockCenter;

/* ── MFB "크기 배수 변경": 블록 기준점을 중심으로 G.resize(사내부·xref·sharedBlock 메타데이터까지 처리됨). ── */
export function scaleBlockEntity(entity, factor) {
 if (entity?.type !== 'block') throw Error('블록만 축척을 바꿀 수 있습니다.');
 return G.resize(entity, blockCenter(entity), factor);
}

/* ── BBL: 삽입점 순서 정하기. auto는 왼쪽아래부터 최근접 이웃으로 잇는다(완전한 TSP 최적해는 아님). ── */
export function orderAnchors(points, mode = 'auto') {
 if (!Array.isArray(points) || points.length < 2) throw Error('블록을 2개 이상 선택하세요.');
 const tagged = points.map((p, i) => ({ p, i }));
 if (mode === 'x') return tagged.slice().sort((a, b) => a.p.x - b.p.x || a.p.y - b.p.y).map(o => o.p);
 if (mode === 'y') return tagged.slice().sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x).map(o => o.p);
 if (mode !== 'auto') throw Error('알 수 없는 연결 방식입니다.');
 const remain = tagged.slice().sort((a, b) => a.p.x - b.p.x || a.p.y - b.p.y);
 const order = [remain.shift().p];
 while (remain.length) {
  let bi = 0, bd = Infinity;
  remain.forEach((o, i) => { const d = G.dist(order.at(-1), o.p); if (d < bd) { bd = d; bi = i; } });
  order.push(remain.splice(bi, 1)[0].p);
 }
 return order;
}
export function connectorPolyline(points, layer) {
 if (!Array.isArray(points) || points.length < 2) throw Error('이을 점이 2개 이상 필요합니다.');
 return { type: 'polyline', layer, closed: false, points: points.map(p => ({ x: p.x, y: p.y })) };
}

/* ── BAD: 선택 객체를 블록 정의(entities) 안에 그대로 포함시킨다. 자식이 절대좌표로 저장되는
   구조라(engine.js block.create 확인) 좌표 변환 없이 그대로 옮겨 붙이면 된다. ── */
function stripIds(e) {
 const c = structuredClone(e); delete c.id;
 if (Array.isArray(c.entities)) c.entities = c.entities.map(stripIds);
 return c;
}
export function mergeEntitiesIntoBlock(block, extras) {
 if (block?.type !== 'block') throw Error('블록 하나를 선택하세요.');
 if (block.xref) throw Error('외부참조는 원본 보호를 위해 직접 편집할 수 없습니다. XREF 관리자에서 결합한 뒤 REFEDIT 하세요.');
 if (!Array.isArray(extras) || !extras.length) throw Error('블록에 포함시킬 객체를 먼저 선택하세요.');
 if (extras.some(e => e.id === block.id)) throw Error('대상 블록 자신은 포함시킬 수 없습니다.');
 const clone = structuredClone(block);
 clone.entities = [...(clone.entities || []), ...extras.map(stripIds)];
 return clone;
}

/* ── 카드 진입점. ── */
export function installBlockXrefTools(ctx) {
 const guard = fn => async (...args) => { try { await fn(...args); } catch (e) { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); } };
 async function pickMany(prompt, { types = null } = {}) {
  const pre = ctx.selected().filter(e => !types || types.includes(e.type));
  if (pre.length) return pre;
  const list = [];
  for (;;) {
   const e = await ctx.pickEntity({ prompt: `${prompt} · Esc: 선택 마침${list.length ? ' · 지금까지 ' + list.length + '개' : ''}`, types });
   if (!e) break;
   list.push(e);
  }
  return list;
 }

 async function lii() {
  const e = await ctx.pickEntity({ prompt: '정보를 볼 객체를 클릭하세요(블록·외부참조·일반 객체 모두 가능) · Esc 취소' });
  if (!e) return;
  ctx.log('LII · ' + formatInfo(describeEntity(e, ctx.layers())));
  ctx.toast('LII · 명령창에서 객체 정보를 확인하세요.');
 }

 function xrl() {
  const rows = xrefRows(ctx.entities());
  if (!rows.length) throw Error('현재 도면에 외부참조가 없습니다.');
  for (const r of rows) ctx.log('XRL · ' + r.name + ' · ' + (r.relative ? '[프로젝트 기준] ' : '') + r.folder + '/' + r.file + ' · ' + r.status);
  ctx.toast('XRL · 외부참조 ' + rows.length + '개 목록을 명령창에 표시했습니다(현재 도면만 · 여러 파일 일괄 목록은 지원하지 않음).');
 }

 function xrc() {
  const layerById = new Map(ctx.layers().map(l => [l.id, l]));
  const all = ctx.entities().filter(e => e.xref);
  if (!all.length) throw Error('도면에 외부참조가 없습니다.');
  const selectedXrefs = ctx.selected().filter(e => e.xref);
  ctx.form('XRC · 외부참조 색 일괄변경', [
   { name: 'scope', label: '대상', value: selectedXrefs.length ? 'selected' : 'all', options: [['selected', '선택한 외부참조 (' + selectedXrefs.length + '개)'], ['all', '도면의 모든 외부참조 (' + all.length + '개)']] },
   { name: 'color', label: '변경색 (#RRGGBB)', value: '#808080' },
   { name: 'excludeHidden', label: '꺼지거나 얼려진 켜', value: 'include', options: [['include', '포함'], ['exclude', '제외']] },
   { name: 'includeLayers', label: '적용 켜(와일드카드, 콤마로 여러 개 · 비우면 전체)', value: '' },
   { name: 'excludeLayers', label: '제외 켜(와일드카드)', value: '' },
  ], values => {
   const pool = values.scope === 'selected' && selectedXrefs.length ? selectedXrefs : all;
   const plan = xrefRestylePlan(pool, layerById, { color: values.color, includeLayers: values.includeLayers, excludeLayers: values.excludeLayers, excludeHidden: values.excludeHidden === 'exclude' });
   ctx.execute({ type: 'batch', commands: plan.map(p => ({ type: 'update', ids: [p.id], changes: p.changes })) });
   ctx.refresh();
   ctx.toast('XRC · 외부참조 ' + plan.length + '개의 색을 ' + values.color + '로 바꿨습니다. 되돌리려면 Ctrl+Z를 쓰세요(색 복구 이력은 따로 저장하지 않습니다).');
  });
 }

 function rex() {
  if (!ctx.entities().some(e => e.xref)) throw Error('현재 도면에 외부참조가 없습니다.');
  ctx.run('XREF');
  ctx.toast('REX · 외부참조 관리자를 열었습니다. "선택 참조 갱신"으로 원본을 다시 읽으세요.');
 }

 function xrr() {
  if (!ctx.entities().some(e => e.xref)) throw Error('현재 도면에 외부참조가 없습니다.');
  ctx.run('XREF');
  ctx.toast('XRR · 켜 설정 초기화는 다시 읽기와 결과가 같습니다(원문도 그렇게 설명). 외부참조 관리자에서 "선택 참조 갱신"을 쓰세요.');
 }

 async function bad() {
  let target = ctx.selected().find(e => e.type === 'block' && !e.table);
  let extras = target ? ctx.selected().filter(e => e !== target) : [];
  if (!target || !extras.length) {
   extras = await pickMany('블록에 포함시킬 객체를 차례로 클릭하세요');
   if (!extras.length) throw Error('포함시킬 객체를 선택하지 않았습니다.');
   target = await ctx.pickEntity({ prompt: '포함시킬 대상 블록을 클릭하세요', types: ['block'] });
   if (!target) throw Error('대상 블록을 선택하지 않았습니다.');
  }
  if (target.sharedBlock) { ctx.execute({ type: 'shared.materialize', ids: [target.id] }); target = ctx.entities().find(e => e.id === target.id); }
  const merged = mergeEntitiesIntoBlock(target, extras);
  const { id, type, ...changes } = merged;
  ctx.execute({ type: 'batch', commands: [{ type: 'update', ids: [target.id], changes }, { type: 'delete', ids: extras.map(e => e.id) }] });
  ctx.setSelected([target.id]); ctx.refresh();
  ctx.toast('BAD · 객체 ' + extras.length + '개를 블록 "' + (target.name || '') + '"에 포함시켰습니다.');
 }

 async function bbl() {
  const pre = ctx.selected().filter(e => e.type === 'block');
  const list = pre.length >= 2 ? pre : await pickMany('이을 블록을 차례로 클릭하세요', { types: ['block'] });
  if (list.length < 2) throw Error('블록을 2개 이상 선택하세요(현재 ' + list.length + '개).');
  // 삽입점(position)은 공유 블록에도 있어 materialize 없이 읽는다 → 되돌리기 한 단계(2026-09-24 검토 F11).
  const points = list.map(e => blockAnchor(e));
  ctx.form('BBL · 블록 삽입점 잇기', [
   { name: 'mode', label: '연결 방식', value: 'auto', options: [['auto', '자동(최근접 경로)'], ['x', 'X좌표 순'], ['y', 'Y좌표 순']] },
  ], values => {
   const ordered = orderAnchors(points, values.mode);
   const layer = ctx.ensureLayer(STD_LAYERS.symb, '#ff9f68');
   ctx.commit({ entities: [connectorPolyline(ordered, layer)] });
   ctx.toast('BBL · 블록 ' + list.length + '개의 삽입점을 이었습니다.');
  });
 }

 function bla() {
  const target = ctx.selected().find(e => e.type === 'block' && !e.table);
  if (!target) throw Error('켜를 바꿀 블록을 먼저 선택하세요.');
  if (target.xref) throw Error('외부참조는 켜를 직접 바꿀 수 없습니다. XREF 관리자를 쓰세요.');
  const layers = ctx.layers();
  const sameName = matchingBlockIds(ctx.entities(), target.name);
  ctx.form('BLA · 블록 내부 모든 켜 변경', [
   { name: 'layer', label: '바꿀 켜', value: target.layer, options: layers.map(l => [l.id, l.name]) },
   { name: 'scope', label: '적용 범위', value: 'all', options: [['all', '같은 이름 블록 전체 (' + sameName.length + '개)'], ['one', '선택한 블록만']] },
  ], values => {
   const ids = values.scope === 'all' ? sameName : [target.id];
   if (!ids.length) throw Error('적용할 블록이 없습니다.');
   // 압축 공유 블록이 섞여 있을 때만 먼저 풀어낸다(그때만 되돌리기 2단계). 보통은 batch 하나 → 되돌리기 한 단계(검토 F11).
   const sharedIds = ids.filter(id => ctx.entities().find(x => x.id === id)?.sharedBlock);
   if (sharedIds.length) ctx.execute({ type: 'shared.materialize', ids: sharedIds });
   const fresh = ctx.entities();
   ctx.execute({ type: 'batch', commands: ids.map(id => {
    const e = fresh.find(x => x.id === id);
    const { id: _id, type: _type, ...changes } = recolorBlockInterior(e, values.layer);
    return { type: 'update', ids: [id], changes };
   }) });
   ctx.refresh();
   ctx.toast('BLA · 블록 ' + ids.length + '개의 내부 켜를 바꿨습니다.');
  });
 }

 function mfb() {
  const target = ctx.selected().find(e => e.type === 'block' && !e.table);
  if (!target) throw Error('상태를 바꿀 블록 하나를 먼저 선택하세요(같은 이름의 모든 인스턴스에 적용합니다).');
  if (target.xref) throw Error('외부참조는 상태를 바꿀 수 없습니다. XREF 관리자를 쓰세요.');
  const ids = matchingBlockIds(ctx.entities(), target.name);
  if (!ids.length) throw Error('같은 이름의 블록을 찾을 수 없습니다.');
  ctx.form('MFB · 블록 상태 변경 · 같은 이름 ' + ids.length + '개(현재 도면 전체 · 여러 파일 일괄은 지원하지 않음)', [
   { name: 'action', label: '작업', value: 'layer', options: [['layer', '겉 켜 변경'], ['scale', '크기 배수 변경'], ['delete', '모두 삭제']] },
   { name: 'layer', label: '바꿀 겉 켜(작업=겉 켜 변경)', value: target.layer, options: ctx.layers().map(l => [l.id, l.name]) },
   { name: 'factor', label: '배수(작업=크기 배수 변경)', type: 'number', value: 1 },
  ], values => {
   if (values.action === 'delete') {
    ctx.execute({ type: 'delete', ids });
    ctx.refresh();
    ctx.toast('MFB · 블록 ' + ids.length + '개를 삭제했습니다.');
    return;
   }
   // 겉 켜 변경·크기 배수는 공유 블록 메타데이터에도 그대로 적용되므로(G.resize) materialize 없이 batch 하나 → 되돌리기 한 단계(검토 F11).
   const fresh = ctx.entities();
   if (values.action === 'layer') {
    ctx.execute({ type: 'batch', commands: ids.map(id => ({ type: 'update', ids: [id], changes: { layer: values.layer } })) });
    ctx.toast('MFB · 블록 ' + ids.length + '개의 겉 켜를 바꿨습니다.');
   } else if (values.action === 'scale') {
    const factor = Number(values.factor);
    if (!Number.isFinite(factor) || factor <= 0) throw Error('배수는 0보다 큰 숫자여야 합니다.');
    ctx.execute({ type: 'batch', commands: ids.map(id => {
     const e = fresh.find(x => x.id === id);
     const { id: _id, type: _type, ...changes } = scaleBlockEntity(e, factor);
     return { type: 'update', ids: [id], changes };
    }) });
    ctx.toast('MFB · 블록 ' + ids.length + '개의 크기를 ' + factor + '배 했습니다.');
   } else throw Error('작업을 고르세요.');
   ctx.refresh();
  });
 }

 return {
  LII: guard(lii),
  REX: guard(rex),
  XRL: guard(xrl),
  XRC: guard(xrc),
  XRR: guard(xrr),
  BAD: guard(bad),
  BBL: guard(bbl),
  BLA: guard(bla),
  MFB: guard(mfb),
 };
}
