// 특성 팔레트(AutoCAD Ctrl+1 · PROPERTIES). 창을 닫지 않고 옆에 붙여 둔 채 계속 그린다.
// 고른 객체가 바뀔 때만(잠깐 기다렸다 한 번) 다시 계산하고, 커서 이동·그리기에는 아무것도 하지 않는다.
// 항목 정의는 속성 편집 창과 같은 properties-palette.js 를 쓴다. 고치면 고른(걸러진) 객체 모두에 한 번에(되돌리기 한 번).
import {buildPropertyPalette} from './properties-palette.js';
import {parseColor, colorChanges, COLOR_NAMES,LINEWEIGHTS} from './cad-properties.js';
import {BYEOLPYO1} from './site-analysis.js';

export const DOCK_SCAN_CAP = 20000;      // 이보다 많이 고르면 공통 항목만, 첫 차이에서 멈추며 계산한다
export const MIXED_LABEL = '*다양함*';
export const NO_SELECTION_LABEL = '선택 안 함';

const TYPE_NAMES = {
 line: '선', polyline: '폴리선', rectangle: '직사각형', circle: '원', arc: '호', ellipse: '타원', spline: '스플라인',
 text: '문자', mtext: '여러 줄 문자', dimension: '치수', leader: '지시선', mleader: '다중 지시선', block: '블록', hatch: '해치',
 wall: '벽', point: '점', solid: '솔리드', image: '이미지', table: '표', wipeout: '가리기', xline: '무한선', ray: '광선',
};
export const typeName = (type) => TYPE_NAMES[type] || type || '기타';

/** 종류별 개수. 많은 순, 같으면 이름 순. */
export function countTypes(es) {
 const counts = new Map();
 for (const e of es) counts.set(e.type, (counts.get(e.type) || 0) + 1);
 return [...counts].map(([type, count]) => ({type, count})).sort((a, b) => b.count - a.count || String(a.type).localeCompare(String(b.type)));
}
export const summaryText = (counts) => (counts.length ? counts.map((c) => `${typeName(c.type)} ${c.count.toLocaleString('en-US')}`).join(', ') : NO_SELECTION_LABEL);
export function filterOptions(counts) {
 const total = counts.reduce((s, c) => s + c.count, 0);
 if (!total) return [['all', NO_SELECTION_LABEL]];
 return [['all', `전체 (${total.toLocaleString('en-US')})`], ...counts.map((c) => [c.type, `${typeName(c.type)} (${c.count.toLocaleString('en-US')})`])];
}
export const filterByType = (es, type) => (!type || type === 'all' ? es : es.filter((e) => e.type === type));

export const STYLE_FIELDS = Object.freeze(['layer', 'color', 'linetype', 'linetypeScale', 'lineweight', 'transparency']);

const round = (n, d) => String(Math.round(n * 10 ** d) / 10 ** d);
const colorOptions = () => [['BYLAYER', 'ByLayer'], ['BYBLOCK', 'ByBlock'], ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [String(n), `${n} ${COLOR_NAMES[n] || ''}`.trim()])];
const lineweightOptions = () => [['', 'ByLayer'], ...LINEWEIGHTS.map((w) => [String(w), `${w.toFixed(2)} mm`])];
const ensureOption = (options, value, label = value) => (value === '' || options.some(([v]) => v === value) ? options : [...options, [value, label]]);

/* 많이 고른 경우(공통 항목만). 값은 첫 객체와 다른 것이 나오면 바로 멈춘다. */
const FAST_DEFS = [
 {name: 'layer', label: '레이어', select: 'layers', text: (e) => e.layer, set: (v) => ({layer: v})},
 {name: 'color', label: '색', select: 'color', text: null, set: (v) => colorChanges(parseColor(v))},
 {name: 'linetype', label: '선종류', select: 'linetypes', text: (e) => (e.linetype ? String(e.linetype).toUpperCase() : 'BYLAYER'), set: (v) => ({linetype: v === 'BYLAYER' ? null : v})},
 {name: 'linetypeScale', label: '선종류 축척', text: (e) => round(e.linetypeScale ?? 1, 3), set: (v) => { const n = Number(String(v).trim()); if (!String(v).trim() || !(n > 0) || n > 10000) throw Error('선종류 축척은 0보다 크고 10,000 이하여야 합니다.'); return {linetypeScale: n}; }},
 {name: 'lineweight', label: '선굵기', select: 'lineweight', text: (e) => (e.lineweight == null ? '' : round(e.lineweight, 3)), set: (v) => { if (String(v).trim() === '') return {lineweight: null}; const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 2.11) throw Error('선굵기는 0~2.11 mm입니다.'); return {lineweight: n}; }},
];
/** 모두 같으면 그 값, 하나라도 다르면 mixed. 다른 값을 만나는 즉시 멈춘다. */
export function commonValue(es, text) {
 if (!es.length) return {value: '', mixed: false};
 const first = text(es[0]);
 for (let i = 1; i < es.length; i++) if (text(es[i]) !== first) return {value: '', mixed: true, scanned: i + 1};
 return {value: first, mixed: false, scanned: es.length};
}

function decorate(field, ctx) {
 const f = {...field};
 if (f.name === 'color') f.options = colorOptions();
 if (f.name === 'lineweight') { f.options = lineweightOptions(); delete f.type; }
 if (f.options) {
  f.options = f.options.filter(([v]) => !(f.mixed && v === '' && f.name !== 'lineweight'));   // 창의 '여러 값' 줄은 쓰지 않는다
  if (!f.mixed) f.options = ensureOption(f.options, f.value, f.name === 'layer' ? (ctx.layerName?.(f.value) || f.value) : f.value);
 }
 if (f.mixed) f.placeholder = MIXED_LABEL;
 return f;
}

// 계획 탭 [주변 건물·등고선 가져오기]로 넣은 건물: 가져올 때 받은 높이·층수·출처를 맨 위에 보기만(2026-10-27 시안 '특성 창 주변 건물 높이').
const isRealHeight = (e) => String(e.attributes?.heightSource || '').startsWith('건물 높이');   // 아니면 층수 × 3.3 m 추정(3D 회색)
const buildingHeight = (e) => Number(e.attributes?.heightM) || (e.model3d?.height || 0) / 1000;
/** 고른 것이 모두 주변 건물이면 '주변 건물' 칸(읽기 전용). 하나라도 다른 객체가 섞이면 없음. */
export function siteBuildingFields(es) {
 if (!es.length || es.some((e) => e.parcelRole !== 'building')) return [];
 const ro = (name, label, value) => ({name, label, value: String(value), readonly: true}), m = (v) => `${round(v, 1)} m`;
 if (es.length > 1) {
  const hs = es.map(buildingHeight).filter((h) => h > 0), real = es.filter(isRealHeight).length;
  return [{heading: '주변 건물'}, ro('siteBuildingHeight', '높이', hs.length ? `${m(Math.min(...hs))} ~ ${m(Math.max(...hs))} · ${es.length}동` : ''),
   ro('siteBuildingSource', '높이 출처', `실제 높이 ${real}동 · 층수로 추정 ${es.length - real}동`)];
 }
 const e = es[0], a = e.attributes || {}, real = isRealHeight(e), h = buildingHeight(e), use = BYEOLPYO1[parseInt(String(a.useCode || '').slice(0, 2), 10)] || a.useName;
 return [{heading: `주변 건물 · ${real ? '실제 높이' : '층수로 추정'}`},
  ro('siteBuildingHeight', '높이', h > 0 ? m(h) : ''),
  ro('siteBuildingSource', '높이 출처', real ? 'GIS 건물통합정보' : a.heightSource || '높이 자료 없음'),
  ...(a.floors ? [ro('siteBuildingFloors', '층수', `지상 ${a.floors}층`)] : []),
  ...(Number.isFinite(a.groundM) ? [ro('siteBuildingGround', '지반고', m(a.groundM))] : []),
  ...(a.name ? [ro('siteBuildingName', '건물 이름', a.name)] : []),
  ...(use ? [ro('siteBuildingUse', '용도', use)] : []),
  ...(a.approvalYear ? [ro('siteBuildingYear', '사용승인', `${a.approvalYear}년`)] : []),
  ...(a.totalAreaM2 ? [ro('siteBuildingArea', '연면적', `${a.totalAreaM2} ㎡`)] : [])];
}

/**
 * 팔레트 내용 만들기.
 * @param es  걸러진 선택 객체
 * @param ctx {layers, linetypes, colorText(e), layerName(id)}
 * @returns {mode:'empty'|'full'|'fast', fields, commands(name, raw) → 엔진 명령 목록}
 */
export function buildDockModel(es, ctx, {cap = DOCK_SCAN_CAP} = {}) {
 if (!es.length) return {mode: 'empty', fields: [], commands: () => []};
 if (es.length > cap) {
  const fields = [{heading: '일반'}];
  for (const d of FAST_DEFS) {
   const v = commonValue(es, d.text || ctx.colorText);
   const options = d.select === 'layers' ? ctx.layers : d.select === 'linetypes' ? ctx.linetypes : null;
   fields.push(decorate({name: d.name, label: d.label, value: v.value, mixed: v.mixed, options: options ? [...options] : undefined}, ctx));
  }
  const ids = es.map((e) => e.id);
  return {
   mode: 'fast', fields,
   commands(name, raw) { const d = FAST_DEFS.find((x) => x.name === name); if (!d) return []; return [{type: 'update', ids, changes: d.set(raw)}]; },
  };
 }
 const palette = buildPropertyPalette(es, ctx);
 const fields = [...siteBuildingFields(es), ...palette.fields.map((f) => (f.heading ? {heading: f.heading} : decorate(f, ctx)))];
 return {
  mode: 'full', fields,
  commands(name, raw) {
   const m = palette.meta.get(name);
   if (!m || m.def.readonly) return [];
   // 칸 하나만 고친다. '여러 값'에서 빈칸(ByLayer·자동)을 고른 것도 바꿈으로 친다.
   m.mixed = false; m.initial = undefined;
   const commands = palette.commands({[name]: raw});
   // 스타일만 바꾸면 객체마다 따로 적지 않고 한 줄로(엔진 가벼운 경로 그대로).
   const only = commands.length === 1 && commands[0].type === 'updateMany' && STYLE_FIELDS.includes(name) ? commands[0].updates : null;
   if (only && only.length && only.every((u) => JSON.stringify(u.changes) === JSON.stringify(only[0].changes))) return [{type: 'update', ids: only.map((u) => u.id), changes: only[0].changes}];
   return commands;
  },
 };
}

/** 아무것도 고르지 않았을 때: 지금 그리는 레이어와 현재 특성(CECOLOR·CELTYPE·CELWEIGHT). */
export function currentFields(current, ctx) {
 const c = current || {};
 const color = !c.color ? 'BYLAYER' : c.color.mode === 'byblock' ? 'BYBLOCK' : c.color.mode === 'aci' && c.color.aci ? String(c.color.aci) : (c.color.color || 'BYLAYER');
 return [
  {heading: '일반 · 이후 그릴 객체'},
  decorate({name: 'layer', label: '레이어', value: ctx.activeLayer, options: [...ctx.layers]}, ctx),
  decorate({name: 'color', label: '색', value: color}, ctx),
  decorate({name: 'linetype', label: '선종류', value: c.linetype ? String(c.linetype).toUpperCase() : 'BYLAYER', options: [...ctx.linetypes]}, ctx),
  decorate({name: 'linetypeScale', label: '선종류 축척', value: round(c.linetypeScale ?? 1, 3), type: 'number'}, ctx),
  decorate({name: 'lineweight', label: '선굵기', value: c.lineweight == null ? '' : round(c.lineweight, 3)}, ctx),
 ];
}

/* ───────────── 화면 ───────────── */
const el = (tag, props = {}, ...children) => { const n = document.createElement(tag); Object.assign(n, props); n.append(...children); return n; };
const WIDTH_KEY = 'barun-cad-properties-dock-width';

/**
 * @param host  붙일 곳(도면 영역)
 * @param api {
 *   selection() → 고른 객체 배열, revision() → 바뀌면 다시 계산할 열쇠(문자열),
 *   context() → ctx, current() → {current, activeLayer}, lockedLayer(id) → bool,
 *   execute(commands), applyCurrent(name, raw), openDetail(), error(message), focusCanvas()
 * }
 */
export function installPropertiesDock(host, api) {
 const root = el('aside', {id: 'properties-dock', className: 'properties-dock', hidden: true});
 root.setAttribute('aria-label', '특성');
 const closeButton = el('button', {type: 'button', className: 'pd-close', textContent: '×', title: '닫기 (Ctrl+1)'});
 closeButton.setAttribute('aria-label', '특성 닫기');
 const filter = el('select', {className: 'pd-filter', title: '종류별로 걸러 고치기'});
 filter.setAttribute('aria-label', '객체 종류');
 const detail = el('button', {type: 'button', className: 'pd-detail', textContent: '상세 편집', title: '속성 편집 창 열기(문·창·계단·단열재 등)'});
 const summary = el('p', {className: 'pd-summary'});
 const body = el('div', {className: 'pd-body'});
 const errorLine = el('p', {className: 'pd-error', role: 'alert'});
 const grip = el('div', {className: 'pd-resize', title: '폭 바꾸기'});
 grip.setAttribute('aria-hidden', 'true');
 root.append(grip, el('header', {className: 'pd-header'}, el('strong', {textContent: '특성'}), closeButton), el('div', {className: 'pd-row'}, filter, detail), summary, body, errorLine);
 host.append(root);
 // 도면 영역의 포인터·휠 처리(확대·선택)가 팔레트 안 조작을 가로채지 않게 한다.
 for (const type of ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick', 'contextmenu']) root.addEventListener(type, (e) => e.stopPropagation());
 try { const w = Number(localStorage.getItem(WIDTH_KEY)); if (w >= 220 && w <= 640) document.body.style.setProperty('--pd-width', w + 'px'); } catch {}

 let model = null, filterType = 'all', lastKey = null, timer = 0, pendingWhileEditing = false;
 // ACAD200 712 PROPOBJLIMIT: 전체 계산 상한을 사용자 설정으로(기본 20000 그대로).
 const dockCap = () => { const v = Number(api.cap?.()); return v > 0 ? v : DOCK_SCAN_CAP; };
 // 오른쪽 작업 막대(탭·대화 창)를 가리지 않게 그 왼쪽에 붙인다. 명령창은 CSS 가 팔레트 폭만큼 비켜 준다.
 const place = () => { if (root.hidden) return; const inset = Math.max(0, Math.round(api.rightInset?.() || 0)); document.body.style.setProperty('--pd-right', inset + 'px'); };
 const setOpen = (open) => {
  root.hidden = !open; host.classList.toggle('has-properties-dock', open); document.body.classList.toggle('properties-dock-open', open);
  place();
  if (open) { lastKey = null; renderNow(); } else { clearTimeout(timer); timer = 0; }
 };

 function control(f, mode) {
  if (f.readonly) return el('output', {className: 'pd-value' + (f.mixed ? ' is-mixed' : ''), textContent: f.mixed ? MIXED_LABEL : (f.value === '' ? '—' : f.value)});
  let input;
  if (f.options) {
   input = el('select');
   if (f.mixed) input.append(el('option', {value: '\u0000mixed', textContent: MIXED_LABEL}));
   for (const [v, label] of f.options) input.append(el('option', {value: v, textContent: label}));
   input.value = f.mixed ? '\u0000mixed' : f.value;
  } else if (f.type === 'textarea') {
   input = el('textarea', {rows: 2, value: f.value ?? ''});
  } else {
   input = el('input', {type: 'text', value: f.value ?? '', spellcheck: false, autocomplete: 'off'});
   if (f.type === 'number') input.inputMode = 'decimal';
  }
  if (f.placeholder) input.placeholder = f.placeholder;
  input.name = f.name; input.dataset.initial = input.value; input.dataset.mode = mode;
  input.setAttribute('aria-label', f.label);
  if (f.mixed) input.classList.add('is-mixed');
  if (f.name !== 'color' || f.mixed) return input;
  // 색: 목록(ByLayer·ByBlock·표준 9색) 옆에 트루컬러 고르기.
  const picker = el('input', {type: 'color', className: 'pd-color', title: '트루컬러'});
  picker.setAttribute('aria-label', '트루컬러 고르기');
  if (/^#[0-9a-f]{6}$/i.test(f.value)) picker.value = f.value;
  picker.addEventListener('change', () => { if (!input.querySelector(`option[value="${picker.value}"]`)) input.append(el('option', {value: picker.value, textContent: picker.value})); input.value = picker.value; commit(input); });
  return el('span', {className: 'pd-color-row'}, input, picker);
 }

 function renderNow() {
  timer = 0;
  if (root.hidden) return;
  const active = document.activeElement;
  // 칸을 고치는 중이면 다 고칠 때까지 기다린다(입력이 사라지지 않게).
  if (root.contains(active) && active.dataset?.initial !== undefined && active.value !== active.dataset.initial) { pendingWhileEditing = true; return; }
  pendingWhileEditing = false;
  const focusName = root.contains(active) ? active.name || null : null;
  lastKey = api.revision() + '|' + filterType;
  const all = api.selection();
  const counts = countTypes(all);
  if (filterType !== 'all' && !counts.some((c) => c.type === filterType)) filterType = 'all';
  filter.replaceChildren(...filterOptions(counts).map(([v, label]) => el('option', {value: v, textContent: label})));
  filter.value = filterType; filter.disabled = counts.length < 2;
  summary.textContent = summaryText(counts);
  detail.disabled = !all.length;
  const es = filterByType(all, filterType), ctx = api.context();
  errorLine.textContent = '';
  let fields;
  try {
   if (!es.length) { const now = api.current(); model = {mode: 'empty'}; fields = currentFields(now.current, {...ctx, activeLayer: now.activeLayer}); }
   else { model = buildDockModel(es, ctx, {cap: dockCap()}); fields = model.fields; model.es = es; }
  } catch (error) { model = null; fields = []; errorLine.textContent = String(error?.message || error); }
  if (model?.mode === 'fast') summary.textContent += ` · ${dockCap().toLocaleString('en-US')}개가 넘어 공통 항목만 보입니다(PROPOBJLIMIT)`;
  const rows = [];
  let section = null;
  for (const f of fields) {
   if (f.heading) { section = el('dl', {className: 'pd-section'}); rows.push(el('h3', {className: 'pd-heading', textContent: f.heading}), section); continue; }
   if (!section) { section = el('dl', {className: 'pd-section'}); rows.push(section); }
   const id = 'pd-field-' + f.name;
   const c = control(f, model?.mode || 'empty');
   (c.classList.contains('pd-color-row') ? c.querySelector('select') : c).id = id;
   section.append(el('dt', {}, el('label', {htmlFor: id, textContent: f.label})), el('dd', {}, c));
  }
  // ACAD200 712: 한 종류만 골랐고 상한(RIBBONCONTEXTSELLIM) 이하이면 그 종류에 맞는 명령 단추 줄. 이미 센 counts 를 쓴다(선택을 다시 훑지 않음).
  const tools = api.contextTools?.(counts, all.length) || [];
  if (tools.length) rows.unshift(el('div', {className: 'pd-context-tools', role: 'toolbar', ariaLabel: '선택 도구'}, ...tools.map(([name, label]) => { const b = el('button', {type: 'button', textContent: label, title: name}); b.onclick = () => api.runCommand?.(name); return b; })));
  body.replaceChildren(...rows);
  if (focusName) root.querySelector(`[name="${focusName}"]`)?.focus();
 }

 function commit(input) {
  const raw = input.value;
  if (raw === input.dataset.initial || raw === '\u0000mixed') return;
  errorLine.textContent = '';
  try {
   if (!model || model.mode === 'empty') {
    // 그사이 객체를 골랐는데 아직 다시 그리지 않았으면, 현재 특성 대신 고른 객체를 고친 꼴이 되지 않게 먼저 새로 보인다.
    if (api.selection().length) { input.value = input.dataset.initial; lastKey = null; renderNow(); return; }
    api.applyCurrent(input.name, raw);
   }
   else {
    const editable = model.es.filter((e) => !api.lockedLayer(e.layer));
    if (!editable.length) throw Error('고른 객체가 모두 잠긴 레이어에 있습니다.');
    const m = editable.length === model.es.length ? model : buildDockModel(editable, api.context());
    const commands = m.commands(input.name, raw);
    if (commands.length) api.execute(commands.length === 1 ? commands[0] : {type: 'batch', commands});
   }
   input.dataset.initial = raw;
  } catch (error) {
   errorLine.textContent = String(error?.message || error);
   input.value = input.dataset.initial;
   api.error?.(errorLine.textContent);
  }
  lastKey = null; schedule(0);
 }

 root.addEventListener('change', (e) => { if (e.target === filter) { filterType = filter.value; lastKey = null; renderNow(); return; } if (e.target.dataset?.initial !== undefined && !e.target.classList.contains('pd-color')) commit(e.target); });
 root.addEventListener('keydown', (e) => {
  const t = e.target;
  if (e.key !== 'Enter' || e.isComposing || t.dataset?.initial === undefined) return;
  if (t.tagName === 'TEXTAREA' && !(e.ctrlKey || e.metaKey)) return;   // 여러 줄 내용: Ctrl+Enter 로 확정
  e.preventDefault(); commit(t);
 });
 root.addEventListener('focusout', () => { if (pendingWhileEditing) setTimeout(() => { if (!root.contains(document.activeElement) || pendingWhileEditing) schedule(0); }, 0); });
 closeButton.onclick = () => { setOpen(false); api.focusCanvas?.(); };
 detail.onclick = () => api.openDetail();

 // 폭 조절(왼쪽 가장자리 끌기).
 grip.addEventListener('pointerdown', (e) => {
  e.preventDefault(); grip.setPointerCapture(e.pointerId);
  const startX = e.clientX, startW = root.getBoundingClientRect().width;
  const move = (ev) => document.body.style.setProperty('--pd-width', Math.max(220, Math.min(640, startW + startX - ev.clientX)) + 'px');
  const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); try { localStorage.setItem(WIDTH_KEY, String(Math.round(root.getBoundingClientRect().width))); } catch {} };
  grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up);
 });

 function schedule(delay = 90) {
  if (root.hidden) return;
  clearTimeout(timer);
  timer = setTimeout(renderNow, delay);
 }
 window.addEventListener('resize', place);
 return {
  element: root,
  place,
  get open() { return !root.hidden; },
  toggle(force) { setOpen(force === undefined ? root.hidden : !!force); return !root.hidden; },
  /** 고른 객체·도면이 바뀌었을 수 있을 때 부른다. 열쇠가 같으면 아무것도 하지 않는다. */
  notify(force = false) {
   if (root.hidden) return;
   if (!force && api.revision() + '|' + filterType === lastKey) return;
   schedule();
  },
  /** Esc: 고치던 칸이면 원래 값으로 되돌린다. 처리했으면 true. */
  escape(target) {
   if (!root.contains(target) || target.dataset?.initial === undefined) return false;
   if (target.value !== target.dataset.initial) { target.value = target.dataset.initial; errorLine.textContent = ''; if (pendingWhileEditing) schedule(0); return true; }
   api.focusCanvas?.();
   return true;
  },
 };
}
