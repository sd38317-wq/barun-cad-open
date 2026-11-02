// 증축 · 대수선 검토(2026-10-24 대표 통과 시안 ⑫, 2026-10-26 구현). 실시 탭 카드와 명령 EXTENSIONREVIEW 로 연다.
// ① 기존 건물(건축물대장) ② 기존·증축·철거 구분(리노베이션 상태: 기존 회색 · 신설 파랑 · 철거 빨간 점선)
// ③ 면적 변화 → 건폐율·용적률 ④ 대수선 해당 여부 ⑤ 구조 안전 확인 → 구조 검토.
// 판정은 예비 판정이다. 법 원문(2026-10-26 대조): 건축법 시행령 제3조의2(대수선의 범위, 제7호는 2019.10.22. 삭제),
// 건축법 제14조제1항(건축신고) 제1·3·4호, 시행령 제11조제2항(주요구조부 해체 없는 대수선).
import * as G from './geometry.js';
import {statusCounts} from './renovation.js';

/** 대수선 항목: [id, 이름, 시행령 제3조의2 호, 수선만이면 제11조② 신고 대상인지]. */
export const MAJOR_REPAIR_ITEMS = Object.freeze([
 ['bearingWall', '내력벽 증설·해체, 벽면적 30㎡ 이상 수선·변경', 1, true],
 ['column', '기둥 증설·해체, 3개 이상 수선·변경', 2, true],
 ['beam', '보 증설·해체, 3개 이상 수선·변경', 3, true],
 ['roofTruss', '지붕틀 증설·해체, 3개 이상 수선·변경', 4, true],
 ['fireWall', '방화벽·방화구획 바닥·벽 증설·해체·수선·변경', 5, true],
 ['stair', '주계단·피난계단·특별피난계단 증설·해체·수선·변경', 6, true],
 ['partyWall', '다가구 가구 간 · 다세대 세대 간 경계벽 증설·해체·수선·변경', 8, false],
 ['finish', '외벽 마감재료 증설·해체, 벽면적 30㎡ 이상 수선·변경', 9, false],
]);
/** 항목마다 고르는 값: 없음 · 수선만 · 증설·해체(또는 변경). */
export const REPAIR_CHOICES = Object.freeze({none: '해당 없음', repair: '수선만', change: '증설·해체·변경'});
const STRUCTURAL = new Set(['bearingWall', 'column', 'beam', 'roofTruss']);

const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** 면적표: 기존 + 증축 − 철거. 건폐율·용적률은 대지면적이 있을 때만(용적률은 지하층·주차 면적 공제 전 값). */
export function extensionAreas({existing = {}, added = {}, removed = {}}, siteArea) {
 const total = k => num(existing[k]) + num(added[k]) - num(removed[k]);
 const arch = total('arch'), floor = total('floor'), site = num(siteArea);
 return {arch, floor, coverage: site ? arch / site * 100 : null, far: site ? floor / site * 100 : null,
  existingCoverage: site ? num(existing.arch) / site * 100 : null, existingFar: site ? num(existing.floor) / site * 100 : null};
}

/** 허가·신고 예비 판정. 증축은 법 제14조①1호, 대수선은 3호(연면적 200㎡ 미만·3층 미만)·4호(시행령 제11조② 수선만). */
export function permitKind({existingFloor = 0, addedFloor = 0, floors = 0, repairs = {}}) {
 const reasons = [], picked = MAJOR_REPAIR_ITEMS.filter(([id]) => repairs[id] && repairs[id] !== 'none');
 const added = num(addedFloor), total = num(existingFloor), storeys = num(floors);
 let report = true, any = false;
 if (added > 0) {
  any = true;
  const limit = storeys >= 3 ? Math.min(85, total * 0.1) : 85;
  if (added <= limit) reasons.push(`증축 바닥면적 ${round(added)}㎡ ≤ ${round(limit)}㎡ → 신고 가능(법 제14조①1호${storeys >= 3 ? ', 3층 이상은 연면적 1/10 이내' : ''})`);
  else { report = false; reasons.push(`증축 바닥면적 ${round(added)}㎡ > ${round(limit)}㎡ → 허가(법 제14조①1호 범위 밖)`); }
 }
 if (picked.length) {
  any = true;
  const small = total + added > 0 && total + added < 200 && storeys > 0 && storeys < 3;
  const repairOnly = picked.every(([id, , , eligible]) => eligible && repairs[id] === 'repair');
  if (small) reasons.push(`대수선: 연면적 ${round(total + added)}㎡ < 200㎡ · ${storeys}층 → 신고 가능(법 제14조①3호)`);
  else if (repairOnly) reasons.push('대수선: 주요구조부 해체 없이 수선만 → 신고 가능(법 제14조①4호 · 시행령 제11조②)');
  else { report = false; reasons.push(`대수선(${picked.map(([, , no]) => '제3조의2 ' + no + '호').join(', ')}) → 허가`); }
 }
 if (!any) return {kind: '해당 없음', reasons: ['증축 면적과 대수선 항목이 없습니다.'], structural: false};
 const structural = added > 0 || picked.some(([id]) => STRUCTURAL.has(id) && repairs[id] === 'change');
 return {kind: report ? '신고' : '허가', reasons, structural};
}

/** 도면에 넣을 검토표 줄(글자). */
export function reviewTableRows({existing, added, removed, siteArea, areas, permit, repairs, limits = {}}) {
 const f = v => v == null ? '—' : round(v).toFixed(1);
 const rows = [['증축 · 대수선 검토표 (예비)', '', '', '', ''], ['', '기존', '증축', '철거', '합계'],
  ['건축면적(㎡)', f(num(existing.arch)), f(num(added.arch)), f(num(removed.arch)), f(areas.arch)],
  ['연면적(㎡)', f(num(existing.floor)), f(num(added.floor)), f(num(removed.floor)), f(areas.floor)]];
 if (num(siteArea)) {
  rows.push(['건폐율(%)', f(areas.existingCoverage), '', '', f(areas.coverage) + (limits.coverage ? ` / ${limits.coverage}` : '')]);
  rows.push(['용적률(%)', f(areas.existingFar), '', '', f(areas.far) + (limits.far ? ` / ${limits.far}` : '')]);
 }
 for (const [id, label, no] of MAJOR_REPAIR_ITEMS) if (repairs[id] && repairs[id] !== 'none') rows.push([`대수선 ${no}호`, label, '', '', REPAIR_CHOICES[repairs[id]]]);
 rows.push(['허가·신고', permit.kind, '', '', '예비 판정 — 관할 확인']);
 return rows;
}

const closedArea = e => (e.type === 'rectangle' || e.type === 'polyline' && e.closed) && Array.isArray(e.points) && e.points.length >= 3 ? Math.abs(G.polygonArea(e.points)) / 1e6 : 0;

export function installExtensionReview(studio) {
 const {engine, execute, toast} = studio.context;
 const state = {existing: {}, added: {}, removed: {}, floors: '', repairs: {}};
 const dialog = document.createElement('dialog'); dialog.id = 'extension-review'; dialog.className = 'extension-review';
 document.body.append(dialog); dialog.addEventListener('keydown', e => e.stopPropagation());
 const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) n[k] = v; else if (k === 'class') n.className = v; else n.setAttribute(k, v); } n.append(...kids.filter(k => k != null)); return n; };
 const site = () => engine.doc.siteAnalysis || {};
 const pnu = () => engine.doc.entities.find(e => e.parcelRole === 'site' && e.attributes?.pnu)?.attributes.pnu || '';
 const selectedArea = () => { const ids = new Set(studio.context.selected?.() || []); return engine.doc.entities.filter(e => ids.has(e.id)).reduce((s, e) => s + closedArea(e), 0); };
 let note = '';

 async function loadLedger() {
  const code = pnu(); if (!code) throw Error('대지를 먼저 불러오세요: 계획 탭 ①에서 주소로 대지를 담고 지적을 그리면 건축물대장을 읽을 수 있습니다.');
  const r = await studio.api('parcel', {action: 'ledger', pnu: code});
  if (!r.archAreaM2 && !r.totalAreaM2) throw Error(r.message || '건축물대장에 기존 건물 면적이 없습니다. 직접 넣어 주세요.');
  state.existing = {arch: r.archAreaM2 || '', floor: r.totalAreaM2 || ''}; if (r.groundFloors) state.floors = r.groundFloors;
  return `건축물대장: 건축면적 ${r.archAreaM2 ?? '—'}㎡ · 연면적 ${r.totalAreaM2 ?? '—'}㎡${r.groundFloors ? ` · 지상 ${r.groundFloors}층` : ''}`;
 }
 function insertTable(rows) {
  if (!engine.doc.layers.some(l => l.name === 'A-TEXT')) execute({type: 'layer.add', name: 'A-TEXT', color: '#ffffff', lineweight: .18});
  const layer = engine.doc.layers.find(l => l.name === 'A-TEXT').id, b = G.bounds(engine.doc.entities.filter(e => !e.hidden));
  const x0 = b ? b.maxX + 5000 : 0, y0 = b ? b.maxY : 0, h = 250, rowH = 600, widths = [3200, 7800, 1800, 1800, 3600];
  const xs = widths.reduce((a, w) => [...a, a[a.length - 1] + w], [x0]), entities = [];
  rows.forEach((row, i) => { const y = y0 - i * rowH; entities.push({type: 'line', points: [{x: x0, y}, {x: xs.at(-1), y}], layer});
   row.forEach((text, j) => { if (text) entities.push({type: 'text', text: String(text), position: {x: xs[j] + 120, y: y - rowH + 180}, height: i === 0 ? h * 1.4 : h, rotation: 0, layer}); }); });
  const bottom = y0 - rows.length * rowH; entities.push({type: 'line', points: [{x: x0, y: bottom}, {x: xs.at(-1), y: bottom}], layer});
  for (const x of xs) entities.push({type: 'line', points: [{x, y: y0 - rowH}, {x, y: bottom}], layer});
  execute({type: 'addMany', entities});
 }

 function render() {
  const s = site(), areas = extensionAreas(state, s.siteArea), permit = permitKind({existingFloor: state.existing.floor, addedFloor: state.added.floor, floors: state.floors, repairs: state.repairs});
  const counts = statusCounts(engine.doc);
  const input = (group, key) => el('input', {type: 'number', min: '0', step: '0.1', value: state[group][key] ?? '', oninput: e => { state[group][key] = e.target.value; }, onchange: () => render()});
  const measure = (group, key) => el('button', {type: 'button', title: '고른 닫힌 선(폴리선·사각형)의 면적 합', onclick: () => { const a = selectedArea(); if (!a) { toast('면적을 잴 닫힌 선을 먼저 고르세요.', true); return; } state[group][key] = round(a, 2); render(); }}, '재기');
  const cell = (group, key) => el('td', {}, input(group, key), measure(group, key));
  const table = el('table', {class: 'xr-table'}, el('tr', {}, el('th'), el('th', {}, '기존'), el('th', {}, '증축'), el('th', {}, '철거'), el('th', {}, '합계')));
  const totalCell = (v, limit) => el('td', {class: limit && v != null && v > limit ? 'r' : ''}, v == null ? '—' : round(v).toFixed(1) + (limit ? ` / ${limit}` : ''));
  table.append(el('tr', {}, el('th', {}, '건축면적 ㎡'), cell('existing', 'arch'), cell('added', 'arch'), cell('removed', 'arch'), totalCell(areas.arch)),
   el('tr', {}, el('th', {}, '연면적 ㎡'), cell('existing', 'floor'), cell('added', 'floor'), cell('removed', 'floor'), totalCell(areas.floor)));
  if (s.siteArea) table.append(el('tr', {}, el('th', {}, '건폐율 %'), el('td', {}, areas.existingCoverage == null ? '—' : round(areas.existingCoverage).toFixed(1)), el('td'), el('td'), totalCell(areas.coverage, s.coverageLimit)),
   el('tr', {}, el('th', {}, '용적률 %'), el('td', {}, areas.existingFar == null ? '—' : round(areas.existingFar).toFixed(1)), el('td'), el('td'), totalCell(areas.far, s.farLimit)));
  const repairs = el('div', {class: 'xr-repairs'}, ...MAJOR_REPAIR_ITEMS.map(([id, label, no]) => el('label', {}, el('span', {}, `${no}호 · ${label}`),
   (() => { const sel = el('select', {onchange: e => { state.repairs[id] = e.target.value; render(); }}, ...Object.entries(REPAIR_CHOICES).map(([k, v]) => { const o = el('option', {value: k}, v); if ((state.repairs[id] || 'none') === k) o.selected = true; return o; })); return sel; })())));
  const steps = el('ol', {class: 'xr-steps'},
   el('li', {}, el('b', {}, '기존 건물'), ' — 건축물대장 값 또는 직접 입력 ', el('button', {type: 'button', onclick: async () => { try { note = await loadLedger(); } catch (e) { note = e.message; } render(); }}, '건축물대장에서 불러오기')),
   el('li', {}, el('b', {}, '기존 · 증축 · 철거 구분'), ` — 지금 기존 ${counts.existing} · 신설 ${counts.new} · 철거 ${counts.demolish} `, el('button', {type: 'button', onclick: () => studio.handlers.RENOVATION?.()}, '객체에 표시하기'), el('small', {}, ' 기존 회색 · 증축 파랑 · 철거 빨간 점선')),
   el('li', {}, el('b', {}, '면적 변화'), ' — 건폐율·용적률 다시 검사', s.siteArea ? null : el('small', {class: 'y'}, ' (대지면적 기준이 없어 비율은 계산하지 않습니다 — 계획 탭 법규 검사에서 기준을 먼저 정하세요)')),
   el('li', {}, el('b', {}, '대수선 해당 여부'), ' — 건축법 시행령 제3조의2'),
   el('li', {}, el('b', {}, '구조 안전 확인'), permit.structural ? el('span', {}, ' — 증축·구조부재 변경이 있어 구조 검토가 필요합니다 ', el('button', {type: 'button', onclick: () => studio.handlers.STRUCTUREREVIEW?.({mode: 'renovation'})}, '구조 검토로')) : ' — 지금 고른 항목으로는 해당 없음'));
  const floors = el('label', {class: 'xr-floors'}, '지상 층수 ', el('input', {type: 'number', min: '1', step: '1', value: state.floors, oninput: e => { state.floors = e.target.value; }, onchange: () => render()}));
  const verdict = el('div', {class: 'xr-verdict'}, el('strong', {}, '허가 · 신고: ' + permit.kind), el('small', {}, ' 예비 판정 — 관할 확인'), el('ul', {}, ...permit.reasons.map(r => el('li', {}, r))));
  const actions = el('div', {class: 'xr-actions'},
   el('button', {type: 'button', class: 'primary', onclick: () => { try { insertTable(reviewTableRows({...state, siteArea: s.siteArea, areas, permit, limits: {coverage: s.coverageLimit, far: s.farLimit}})); toast('증축·대수선 검토표를 도면 오른쪽에 넣었습니다. Ctrl+Z 로 되돌립니다.'); } catch (e) { toast(e.message, true); } }}, '증축·대수선 검토표 넣기'),
   el('button', {type: 'button', onclick: () => dialog.close()}, '닫기'));
  dialog.replaceChildren(...[el('h2', {}, '증축 · 대수선 검토'), steps, note ? el('p', {class: 'xr-note'}, note) : null, floors, table, el('h3', {}, '대수선 체크'), repairs, verdict, actions].filter(Boolean));
 }
 const open = () => { render(); document.body.append(dialog); if (!dialog.open) dialog.show(); };   // 창을 띄운 채 도면에서 객체를 고르고 [재기]·[객체에 표시하기]를 쓴다
 studio.handlers.EXTENSIONREVIEW = open;
 return {open};
}
