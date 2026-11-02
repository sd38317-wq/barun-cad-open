// 구조 검토(2026-10-24 대표 통과 시안 ⑪, 2026-10-26 구현). 실시 탭 카드와 명령 STRUCTUREREVIEW 로 연다.
// 예전에는 3~5층 구조 엔진·구조계산서·안전 확인서를 AI(MCP) 로만 부를 수 있었다. 같은 도구를 화면에서 바로 부른다.
// 판정은 '예비 검토'이고 확인서·계산서는 초안이다. 모르는 값은 비워 두면 엔진이 '자료 부족'으로 남긴다(기본값으로 확정하지 않는다).

import {bounds} from './geometry.js';

/** 형식 카드: [id, 이름, 엔진 system, 3~5층 엔진 structureType, 설명]. 1~2층 소규모 엔진은 RC 형식을 나누지 않는다. */
export const STRUCTURE_FORMS = Object.freeze([
 ['rc-wall', '벽식 (RC)', 'rc', 'rc-wall', '내력벽 · 슬래브 · 층간변위'],
 ['rc-moment', '라멘 (RC)', 'rc', 'rc-moment', '기둥 · 보 · 슬래브'],
 ['steel', '철골', 'steel', 'steel-moment', '부재 단면 · 가새 · 접합'],
 ['wood', '목구조', 'wood', null, '벽 · 장선 · 서까래 (3층 이하)'],
]);
/** 화면 카드: [누르면 고를 형식 id, 이름, 설명, 불이 켜질 형식 id들]. 1~2층은 엔진이 RC 를 나누지 않아 한 장으로(2026-10-27 대표 통과 시안), 3층부터 벽식·라멘 둘. */
export function structureFormCards(stories) {
 const cards = STRUCTURE_FORMS.map(([id, label, , , note]) => [id, label, note, [id]]);
 return Number(stories) >= 3 ? cards : [['rc-wall', '철근콘크리트 (RC)', '벽 · 기둥 · 보 · 슬래브 (1~2층은 벽식·라멘 같은 기준)', ['rc-wall', 'rc-moment']], ...cards.slice(2)];
}
export const STRUCTURE_USES = Object.freeze({house: '주택', retail: '근린생활시설', other: '그 밖의 용도'});
export const KIND_LABELS = Object.freeze({wall: '내력벽', column: '기둥', beam: '보', slab: '슬래브', footing: '기초', strip: '줄기초', mat: '전면기초', brace: '가새', purlin: '중도리',
 stairWall: '계단벽', flight: '계단', landing: '계단참', woodWall: '목조 벽', joists: '장선', ceilJoists: '천장 장선', rafters: '서까래', ridgeBoard: '마룻대', stripW: '줄기초', groundSlab: '바닥 슬래브', woodStair: '목조 계단', hardware: '철물'});

/** 엔진·서버 안내(AI 에게도 쓰는 말)를 화면 말로: 'mode=design' → [외곽만으로 구조 시안] 고르기, 긴 객체 ID 목록·'사용자에게' 빼기(2026-10-27). */
export function screenMessage(text) {
 return String(text ?? '')
  .replace(/\s*(?:으로 다시 부르세요|으로 부르세요)/g, '')
  .replace(/mode=design/g, '검토 방식에서 [외곽만으로 구조 시안]을 고르세요')
  .replace(/\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:,\s*)?)+\)/gi, '')
  .replace(/사용자에게 어느 벽인지 확인한 뒤/g, '어느 벽인지 정한 뒤')
  .replace(/위층이 1층과 같은 배치라고 사용자가 확인했으면 sameLayoutUpper=true 로, 아니면 층별 boxes 또는 floors를 지정하세요\./g, '층수 칸을 도면에서 읽은 층 수에 맞추거나 비워 두세요. 위층 평면이 도면에 없으면 검토 방식에서 [외곽만으로 구조 시안]을 고르세요.')
  .replace(/\s{2,}/g, ' ');
}
/** 도면 인식 개요 → 구조 검토 빈칸 기본값(지상 층수 1~5·층고·용도·대지 위치). 모르는 칸은 넣지 않는다. */
export function structureDefaults(ov) {
 const out = {}, n = Number(ov?.floorsAbove), h = Number(ov?.storyHeight), use = String(ov?.mainUse ?? '');
 if (Number.isInteger(n) && n >= 1 && n <= 5) out.stories = n;
 if (h >= 1500 && h <= 10000) out.storyHeight = h;
 if (use) out.use = /주택/.test(use) ? 'house' : /근린생활/.test(use) ? 'retail' : 'other';
 const where = String(ov?.address ?? '').trim(); if (where) out.location = where.slice(0, 200);   // 바람·눈 조건을 정하는 대지 위치
 return out;
}
/** 화면 값 → cad_structure_generate 인자. 외곽은 고른 닫힌 선(mm). 층고는 mm. */
export function structureArgs({form, outlineId, stories, storyHeight, use, mode = 'check', Fe, location, wind, snow, basement, siteSlope, landfill, roof, pitch, legalOk}) {
 const f = STRUCTURE_FORMS.find(x => x[0] === form);
 if (!f) throw Error('구조 형식을 고르세요.');
 if (!outlineId) throw Error('[도면에서 외곽 찍기]를 눌러 건물 외곽(닫힌 폴리선)을 찍으세요.');
 // 층수를 모르면(빈칸) 보내지 않는다 — 도면 그대로 검토는 엔진이 도면에서 읽은 층 수로, 외곽만 시안은 층수가 있어야 한다.
 const blank = stories === '' || stories == null, n = Number(stories);
 if (blank && mode === 'design') throw Error('외곽만으로 구조 시안은 층수가 필요합니다. 층수 칸에 지상 층수를 넣으세요.');
 if (!blank && (!Number.isInteger(n) || n < 1 || n > 5)) throw Error('층수는 1~5층입니다(이 엔진의 적용 범위).');
 if (f[0] === 'wood' && n > 3) throw Error('목구조는 3층까지 검토합니다.');
 const args = {system: f[2], mode, outline: {entityId: outlineId}, ...(blank ? {} : {stories: n})};
 if (n >= 3 && f[3]) args.structureType = f[3];
 const h = Number(storyHeight); if (Number.isFinite(h) && h > 0) args.storyHeight = h;
 if (STRUCTURE_USES[use]) args.use = use;
 const fe = Number(Fe); if (Fe !== '' && Fe != null && Number.isFinite(fe) && fe > 0) args.soil = {Fe: fe};
 if (location) args.location = String(location);
 // '확인할 것' 칸(2026-10-27 시안). 빈 값(모름)은 보내지 않아 엔진이 '자료 부족'으로 남긴다.
 if (wind) args.wind = wind;
 if (snow) args.snow = snow;
 if (basement === 'yes' || basement === 'no') args.basement = basement === 'yes';
 const slope = Number(siteSlope); if (siteSlope !== '' && siteSlope != null && Number.isFinite(slope) && slope >= 0) args.siteSlope = slope;
 if (landfill === 'yes' || landfill === 'no') args.soil = {...args.soil, landfill: landfill === 'yes'};
 if (f[2] !== 'rc' && roof) { args.roof = roof; const p = Number(pitch); if (roof === 'gable' && pitch !== '' && pitch != null && Number.isFinite(p)) args.pitch = p; }
 if (legalOk) args.legal = {excluded32_2_3to8Confirmed: true};
 return args;
}

const FIX_LABELS = {field: '현장 확인', layout: '도면에서 고치기', member: '부재 크기', calc: '구조계산'};
const SYSTEM_LABELS = {rc: '철근콘크리트', steel: '철골', wood: '목구조'}, MODE_LABELS = {check: '도면의 벽·기둥 그대로 검토', renovation: '증축·대수선 뒤 모습 검토', design: '외곽만으로 구조 시안'};
/** 확인할 것 한 줄 — 영문 코드(legal.… · input/field)와 값과 같은 기준 반복을 뺀다. */
export function checkText(c) {
 // 엔진 지원범위 밖 조합('steel × check')은 엔진 말 대신 고를 것을 알려 준다.
 const [system, mode] = String(c.value ?? '').split(' × ');
 if (SYSTEM_LABELS[system] && MODE_LABELS[mode]) return `${SYSTEM_LABELS[system]} 형식은 아직 [${MODE_LABELS[mode]}] 방식을 지원하지 않습니다 — 검토 방식에서 [외곽만으로 구조 시안]을 고르세요`;
 const value = c.value ?? '', required = String(c.required ?? '').replace(/^[a-z][\w.]*:\s*/i, '');
 return `${c.item}: ${value}${required && required !== value ? ' (기준 ' + required + ')' : ''}${FIX_LABELS[c.fix] ? ' — ' + FIX_LABELS[c.fix] : ''}`;
}

/** 구조도를 넣을 자리 — 도면 전체 오른쪽 10 m 밖(엔진 기본 '건물 오른쪽 10 m'는 한 벌 도면이면 옆 장에 겹친다). 빈 도면이면 엔진 기본. */
export function structureSheetOrigin(entities) {
 const b = entities?.length ? bounds(entities) : null;
 return b && Number.isFinite(b.maxX) ? {x: b.maxX + 10000, y: b.minY} : undefined;
}

// 상세 칸 이름 → 라이브러리에서 찾을 이름(sheet-templates.json structureDetails.pick 과 같은 짝). 철골만 — RC·목조 상세는 다음에.
const SLOT_QUERIES = {'주각 상세': '노출형 주각', '작은보-큰보 접합': '작은보-큰보 웨브 접합', '기둥-보 접합': '기둥-보 접합'};
/** 칸에 넣을 철골 상세 — 이름이 맞는 첫 것. 크기는 예시라 칸 아래 '치수는 구조계산서 확인'이 붙어 있다. */
export function slotDetail(slot, library, form) {
 const q = SLOT_QUERIES[slot];
 return form === 'steel' && q && library.find(d => d.group === 'steel' && d.name?.includes(q)) || null;
}

/** 부재 요약 → 표 줄(종류별로 묶어 대표 크기와 개수). */
export function memberRows(members = []) {
 const byKind = new Map();
 for (const m of members) { const k = m.kind || '?', g = byKind.get(k) || {kind: k, label: KIND_LABELS[k] || k, count: 0, sizes: []}; g.count += m.count || 1; if (m.size && !g.sizes.includes(m.size)) g.sizes.push(String(m.size)); byKind.set(k, g); }
 return [...byKind.values()];
}

export function installStructureReview(studio) {
 const {toast} = studio.context;
 const state = {form: 'rc-wall', outlineId: null, outlineArea: 0, stories: '', storyHeight: 3000, use: 'house', Fe: '', mode: 'check', result: null, busy: '', note: '', renovation: false,
  location: '', wind: '', snow: '', basement: '', siteSlope: '', landfill: '', roof: '', pitch: '', legalOk: false};
 const dialog = document.createElement('dialog'); dialog.id = 'structure-review'; dialog.className = 'structure-review';
 document.body.append(dialog); dialog.addEventListener('keydown', e => e.stopPropagation());
 const el = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) n[k] = v; else if (k === 'class') n.className = v; else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v); } n.append(...kids.filter(k => k != null && k !== false)); return n; };

 async function tool(name, args) {
  let r = await studio.api('mcp', {name, arguments: args});
  for (let i = 0; r?.status === 'running' && r.job_id && i < 60; i++) r = await studio.api('mcp', {name: 'cad_get_job', arguments: {job_id: r.job_id, wait_seconds: 10}});
  if (r?.status === 'completed' && r.result) r = r.result;
  if (r?.error) throw Error(r.error);
  return r;
 }
 async function busy(label, fn) { state.busy = label; state.note = ''; render(); try { state.note = await fn() || ''; } catch (e) { state.note = screenMessage(e.message || String(e)); } finally { state.busy = ''; render(); } }
 // 도면을 바꾸는 도구는 '어느 도면의 몇 번째 판'(target)을 받아야 한다 — AI 와 같은 규칙. 지금 화면 도면을 읽어 그 target 을 쓴다.
 const target = async () => { const d = await tool('cad_get_document', {mode: 'summary'}); if (!d?.target) throw Error('도면 연결 정보를 읽지 못했습니다. 잠시 뒤 다시 누르세요.'); return d.target; };

 // 외곽: 미리 고른 닫힌 선이 있으면 그것을, 없으면 창을 잠시 내리고 도면에서 바로 찍는다(10-27 대표: 선을 먼저 고르라는 건 말이 안 된다).
 async function pickOutline() {
  const closed = x => x && (x.type === 'rectangle' || x.type === 'polyline' && x.closed);
  const ids = [...(studio.context.selected?.() || [])];
  let e = studio.context.engine.doc.entities.find(x => ids.includes(x.id) && closed(x));
  if (!e) {
   dialog.close();
   try { e = await studio.context.pickEntity?.({prompt: '건물 외곽 닫힌 폴리선(또는 사각형)을 클릭하세요 · Esc 취소', types: ['rectangle', 'polyline']}); }
   finally { render(); if (!dialog.open) dialog.show(); }
   if (!e) return;
   if (!closed(e)) { toast('닫힌 폴리선(또는 사각형)을 클릭하세요.', true); return; }
  }
  state.outlineId = e.id; state.outlineArea = Math.abs((studio.context.polygonArea?.(e.points)) ?? 0); render();
 }
 const review = () => busy('구조를 계산하는 중…', async () => {
  const r = await tool('cad_structure_generate', structureArgs(state)); state.result = r;
  return r.verdict === '적합' ? '예비 검토가 끝났습니다.' : `예비 검토 결과: ${r.verdict}. 아래 '확인할 것'을 채우면 다시 검토합니다.`;
 });
 // 구조 장 상세 칸(템플릿 2026-10-27)에 맞는 라이브러리 상세를 칸 크기에 맞춰 넣는다. 맞는 상세가 없는 칸은 비워 둔다.
 async function fillDetailSlots(setId) {
  const slots = (studio.context.engine?.doc?.entities || []).filter(e => e.detailSlot && e.structureSet?.id === setId);
  if (!slots.length) return 0;
  const library = (await studio.api('detail-search', {action: 'catalog'}))?.library || [];
  let n = 0;
  for (const slot of slots) {
   const d = slotDetail(slot.detailSlot.name, library, state.form); if (!d) continue;
   // bounds 는 '상세에서 가져올 범위'(넣을 칸이 아님) — 첫 장면을 가져와 칸에 맞는 배율로 가운데 놓는다.
   const got = await studio.api('detail-search', {action: 'get', id: d.id, include_geometry: true}), sc = got?.detail?.scenes?.[0]?.bounds;
   if (!sc) continue;
   const [x0, y0, x1, y1] = sc, xs = slot.points.map(p => p.x), ys = slot.points.map(p => p.y);
   const sw = Math.max(...xs) - Math.min(...xs), sh = Math.max(...ys) - Math.min(...ys), scale = Math.min(sw * .9 / (x1 - x0), sh * .9 / (y1 - y0));
   const position = {x: Math.min(...xs) + (sw - (x1 - x0) * scale) / 2, y: Math.min(...ys) + (sh - (y1 - y0) * scale) / 2}, where = await target();
   await tool('cad_insert_detail', {id: d.id, source: 'library', bounds: {minX: x0, minY: y0, maxX: x1, maxY: y1}, position, scale, target: where, expectedRevision: where.revision});
   n++;
  }
  return n;
 }
 const drawSheets = () => busy('구조 평면도·일람표를 그리는 중…', async () => {
  const where = await target(), origin = structureSheetOrigin(studio.context.engine?.doc?.entities), r = await tool('cad_structure_drawings', {setId: state.result.setId, sheets: ['plan', 'foundation', 'schedule', 'notes'], ...(origin ? {origin} : {}), target: where, expectedRevision: where.revision});
  if (r?.approval_required) return '도면 기준 승인 전이라 그림 미리보기만 만들었습니다(도면에는 넣지 않음).';
  const filled = await fillDetailSlots(state.result.setId).catch(() => 0);
  return '구조 평면도·기초평면·일람표·주기를 도면 오른쪽 빈 곳에 넣었습니다' + (filled ? ` · 상세 칸 ${filled}곳에 바른 표준 철골 상세` : '') + '. Ctrl+Z 로 되돌립니다.';
 });
 const document_ = (name, format) => busy(name === 'cad_structure_calc_report' ? '구조계산서 초안을 만드는 중…' : '구조안전 확인서 초안을 만드는 중…', async () => {
  const r = await tool(name, {setId: state.result.setId, format});
  if (r?.missing?.length) return '채울 칸이 남았습니다: ' + r.missing.map(m => m.question || m.key).join(' · ');
  const path = r?.path || r?.file || r?.output;
  if (path) { studio.context.openPath?.(path); return '초안을 만들었습니다: ' + path; }
  return r?.message || '초안을 만들었습니다.';
 });

 function render() {
  const r = state.result, n = Number(state.stories), wood = state.form === 'wood';
  const forms = el('div', {class: 'sr-forms', role: 'radiogroup'}, ...structureFormCards(n).map(([id, label, note, lit]) => el('button', {type: 'button', role: 'radio', 'aria-checked': String(lit.includes(state.form)), class: lit.includes(state.form) ? 'on' : '', onclick: () => { state.form = id; render(); }}, el('strong', {}, label), el('small', {}, note))));
  const field = (label, input) => el('label', {}, el('span', {}, label), input);
  const numberInput = (key, attrs) => el('input', {type: 'number', value: state[key], ...attrs, onchange: e => { state[key] = e.target.value; render(); }});
  const inputs = el('div', {class: 'sr-inputs'},
   field('건물 외곽', el('span', {}, state.outlineId ? `고른 선 ✓` : '없음', ' ', el('button', {type: 'button', onclick: () => pickOutline().catch(err => toast(err.message || String(err), true))}, state.outlineId ? '다시 찍기' : '도면에서 외곽 찍기'))),
   field('층수', numberInput('stories', {min: '1', max: wood ? '3' : '5', step: '1', placeholder: '모르면 비움 (도면에서 읽음)'})),
   field('층고 mm', numberInput('storyHeight', {min: '1500', max: '10000', step: '100'})),
   field('용도', el('select', {onchange: e => { state.use = e.target.value; }}, ...Object.entries(STRUCTURE_USES).map(([k, v]) => el('option', {value: k, selected: state.use === k}, v)))),
   field('지반 지내력 kN/㎡', numberInput('Fe', {min: '0', step: '10', placeholder: '모르면 비움'})),
   field('검토 방식', el('select', {onchange: e => { state.mode = e.target.value; }}, el('option', {value: 'check', selected: state.mode === 'check'}, '도면의 벽·기둥 그대로 검토'), el('option', {value: 'design', selected: state.mode === 'design'}, '외곽만으로 구조 시안'))));
  // '확인할 것' 칸(2026-10-27 대표 승인 시안). '—' = 모름 → 보내지 않아 자료 부족으로 남는다.
  const pick = (key, options) => el('select', {onchange: e => { state[key] = e.target.value; render(); }}, ...[['', '— 모름'], ...options].map(([v, l]) => el('option', {value: v, selected: state[key] === v}, l)));
  const fill = () => el('div', {class: 'sr-fill'},
   field('대지 위치 (바람·눈 지역을 고를 때 참고)', el('input', {type: 'text', value: state.location, onchange: e => { state.location = e.target.value; }})),
   field('바람 지역 (기본풍속·지표면조도)', pick('wind', [['normal', '보통 (아래 바닷가·40 m/s 초과 지역 아님)'], ['D35', '35 m/s · 바닷가·평지(D)'], ['D40', '40 m/s · 바닷가·평지(D)'], ['D40+', '40 m/s 넘음 · 바닷가·평지(D)'], ['C40+', '40 m/s 넘음 · 시가지(C)']])),
   field('눈 지역', pick('snow', [['normal', '보통'], ['heavy', '울릉도·대관령 (많이 옴)'], ['east', '동해·속초·강릉']])),
   field('지하층', pick('basement', [['no', '없음'], ['yes', '있음']])),
   field('대지 고저차 m (1.5 m 이하여야 소규모 기준)', numberInput('siteSlope', {min: '0', step: '0.1', placeholder: '모르면 비움'})),
   field('매립지·연약지반', pick('landfill', [['no', '아님'], ['yes', '맞음']])),
   state.form === 'steel' || wood ? field('지붕 (경사 20° 넘으면 중도리 표 밖)', el('span', {}, pick('roof', [['gable', '박공'], ['flat', '평지붕']]), state.roof === 'gable' ? numberInput('pitch', {min: '0', max: '75', step: '1', placeholder: '경사 °'}) : null)) : null,
   el('label', {class: 'sr-legal'}, el('input', {type: 'checkbox', checked: state.legalOk, onchange: e => { state.legalOk = e.target.checked; }}), ' 시행령 제32조②3~8호(중요·보존·특수구조 등)에 해당하지 않음을 확인했습니다'));
  const scope = el('p', {class: 'sr-scope'}, n >= 3 ? '3~5층: 개략 구조 엔진(KDS 41) · 구조계산서 초안 대상' : n >= 1 ? '1~2층: 소규모건축구조기준(KDS 42) · 구조안전 확인서 초안 대상' : '층수: 도면에서 읽은 층 수로 검토합니다', state.renovation ? ' · 증축·대수선 뒤 모습으로 검토합니다' : '');
  let result = null;
  if (r) {
   const counts = r.counts || {}, rows = memberRows(r.members), checks = [...(r.ng || []), ...(r.hold || []), ...(r.unsupported || []), ...(r.scope || [])];
   result = el('div', {class: 'sr-result'},
    el('div', {class: 'sr-verdict'}, el('strong', {}, '예비 검토: ' + r.verdict), el('small', {}, ` 적합 ${counts.ok ?? 0} · 부적합 ${counts.ng ?? 0} · 자료 부족 ${counts.hold ?? 0}${counts.unsupported ? ' · 미지원 ' + counts.unsupported : ''}`)),
    el('table', {class: 'sr-members'}, el('tr', {}, el('th', {}, '부재'), el('th', {}, '개략 크기'), el('th', {}, '개수')), ...rows.map(g => el('tr', {}, el('td', {}, g.label), el('td', {}, g.sizes.slice(0, 3).join(' · ') || '—'), el('td', {}, String(g.count))))),
    checks.length ? el('details', {class: 'sr-checks', open: true}, el('summary', {}, `확인할 것 ${checks.length}개 — 아래 칸을 채우고 [다시 검토]`), fill(), el('ul', {}, ...checks.slice(0, 40).map(c => el('li', {class: c.st === 'ng' ? 'r' : 'y'}, checkText(c))))) : null);
  }
  // 엔진은 '적합'일 때만 도면을 넣고 확인서를 만든다(자료 부족·부적합이면 거절). 단추도 그때만 누를 수 있게 한다.
  const has = !!r?.setId, pass = r?.verdict === '적합', actions = el('div', {class: 'sr-actions'},
   el('button', {type: 'button', class: 'primary', disabled: !!state.busy, onclick: review}, r ? '다시 검토' : '예비 검토'),
   el('button', {type: 'button', disabled: !pass || !!state.busy, title: has && !pass ? '예비 검토가 적합일 때 그립니다' : '', onclick: drawSheets}, '구조 평면도·일람표 그리기'),
   n >= 3 ? el('button', {type: 'button', disabled: !has || !!state.busy, onclick: () => document_('cad_structure_calc_report', 'html')}, '구조계산서 초안')
    : el('button', {type: 'button', disabled: !r?.canCreateCertificate || !!state.busy, title: has && !r.canCreateCertificate ? '예비 검토가 적합일 때 만듭니다' : '', onclick: () => document_('cad_structure_certificate', 'html')}, '구조안전 확인서 초안'),
   el('button', {type: 'button', onclick: () => dialog.close()}, '닫기'),
   has && !pass ? el('small', {class: 'sr-hint'}, '구조 도면·확인서는 예비 검토가 적합일 때 만듭니다. \'확인할 것\'을 채워 다시 검토하세요.') : null);
  dialog.replaceChildren(...[el('h2', {}, '구조 검토'), forms, inputs, scope, state.busy ? el('p', {class: 'sr-busy'}, state.busy) : null, state.note ? el('p', {class: 'sr-note'}, state.note) : null, result, actions,
   el('p', {class: 'sr-foot'}, '예비 검토입니다. 확인서·계산서는 초안이며 작성자·서명은 비워 둡니다. 로그인한 바른 서버에서 계산합니다.')].filter(Boolean));
 }
 // 처음 열 때 한 번만 개요(도면 인식) 값으로 채운다 — 사용자가 고친 값은 덮지 않는다.
 let seeded = false;
 const open = (options = {}) => { if (!seeded) { seeded = true; Object.assign(state, structureDefaults(studio.context.engine?.doc?.reviewSettings?.permitBook?.overview)); } state.renovation = options.mode === 'renovation'; render(); document.body.append(dialog); if (!dialog.open) dialog.show(); };   // 맨 뒤로 옮겨 같은 층(z-index)인 증축 창보다 위에 보인다
 studio.handlers.STRUCTUREREVIEW = open;
 return {open};
}
