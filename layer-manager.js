// 레이어 관리자(AutoCAD LAYER 특성 관리자) — ACAD200 701·702·706·707 로 app.js 에서 옮겨 키웠다.
// 701: 투명도·설명 열, 객체 수는 블록 정의 안까지, 0개 레이어는 흐리게(지울 수 있음).
// 702: 왼쪽 필터 목록(자동 필터 + 저장한 속성/그룹 필터). 지금 검색어를 속성 필터로, 고른 줄을 그룹 필터로 저장.
// 706: '객체째 삭제'(LAYDEL) — 몇 개가 지워지는지 먼저 알려 주고 되돌리기 한 번.
// 707: 확인 전 새 레이어가 있으면 '확인함' 단추.
// 열 때 한 번만 도면을 훑어 객체 수를 센다(O(도면) 1회). 표를 고칠 때는 다시 세지 않는다(레이어 표 변경은 객체 수를 바꾸지 않음).
import {AUTO_FILTERS, filterLayers, layerFilterList, layerUsageCounts, upsertLayerFilter, removeLayerFilter} from './layer-filters.js';
import {reconcileCommands, unreconciledLayers} from './layer-reconcile.js';
import {countLayerDelete} from './engine.js';

export const LAYER_MANAGER_COLUMNS = Object.freeze(['현재', '이름', '켜기', '동결', '잠금', '색', '선종류', '굵기', '투명도', '인쇄', '설명', '객체']);
export const layerManagerHeader = () => '<thead><tr>' + LAYER_MANAGER_COLUMNS.map((c) => `<th>${c}</th>`).join('') + '</tr></thead>';
export const clampTransparency = (value) => Math.max(0, Math.min(90, Math.round(Number(value) || 0)));

/** 표에 보일 레이어: 필터 → 이름 검색. */
export function visibleManagerLayers(doc, {filterId = 'all', search = '', counts = new Map()} = {}) {
  const needle = String(search || '').toLowerCase();
  return filterLayers(doc, filterId, {counts}).filter((l) => !needle || l.name.toLowerCase().includes(needle) || String(l.description || '').toLowerCase().includes(needle));
}

/** 관리자 레이어 고치기 명령: 여러 줄을 한 batch(되돌리기 한 번). 현재 레이어 동결은 거절. */
export function layerUpdateBatch(doc, ids, changes, activeLayer) {
  const list = [...ids].filter((id) => doc.layers.some((l) => l.id === id));
  if (changes.frozen && list.includes(activeLayer)) throw Error('현재 레이어는 동결할 수 없습니다.');
  if (changes.transparency !== undefined) changes = {...changes, transparency: clampTransparency(changes.transparency)};
  if (changes.description !== undefined) changes = {...changes, description: String(changes.description).trim().slice(0, 255)};
  return {type: 'batch', commands: list.map((id) => ({type: 'layer.update', id, changes}))};
}

export function openLayerManagerDialog(ctx, state = {}) {
  const {engine, execute, refresh, safe, toast, canvas} = ctx;
  let dialog = state.dialog;
  if (dialog?.open) dialog.close();
  dialog = dialog || document.createElement('dialog');
  dialog.className = 'layer-manager'; dialog.setAttribute('aria-label', '레이어 관리자');
  if (!dialog.isConnected) document.body.append(dialog);
  state.dialog = dialog;
  let chosenIds = new Set([ctx.activeLayer()]), filter = '', anchor = null, filterId = state.filterId || 'all', pendingDelete = null, filterName = '';
  const LINETYPES = ['CONTINUOUS', 'DASHED', 'HIDDEN', 'CENTER', 'PHANTOM', 'DOT', 'DASHDOT', 'BORDER', 'DIVIDE'];
  const WEIGHTS = [0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6, 0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2, 2.11];
  let count = layerUsageCounts(engine.doc);
  const recount = () => { count = layerUsageCounts(engine.doc); };
  const update = (ids, changes) => safe(() => { execute(layerUpdateBatch(engine.doc, ids, changes, ctx.activeLayer())); refresh(); draw(); });
  const targets = (l) => (chosenIds.has(l.id) ? chosenIds : new Set([l.id]));
  const cell = (tag, props = {}) => Object.assign(document.createElement(tag), props);
  const button = (text, onclick, title = '') => { const b = cell('button', {type: 'button', textContent: text, title}); b.onclick = onclick; return b; };
  function draw() {
    dialog.replaceChildren();
    const head = cell('div', {className: 'lm-head'});
    head.append(cell('h2', {textContent: '레이어 관리자'}));
    const search = cell('input', {type: 'search', placeholder: '레이어 이름·설명 찾기 (와일드카드는 필터 저장)', value: filter});
    search.oninput = () => { filter = search.value; draw(); const s = dialog.querySelector('input[type=search]'); s.focus(); s.setSelectionRange(filter.length, filter.length); };
    const add = button('새 레이어', () => safe(() => { let n = 1; while (engine.doc.layers.some((l) => l.name === `레이어${n}`)) n++; execute({type: 'layer.add', name: `레이어${n}`}); const created = engine.doc.layers.at(-1); chosenIds = new Set([created.id]); refresh(); draw(); }));
    const remove = button('삭제', () => safe(() => { const ids = [...chosenIds].filter((id) => id !== ctx.activeLayer()); if (!ids.length) throw Error('현재 레이어는 삭제할 수 없습니다.'); execute({type: 'batch', commands: ids.map((id) => ({type: 'layer.delete', id}))}); chosenIds = new Set([ctx.activeLayer()]); refresh(); draw(); }), '객체가 없는 레이어만 지웁니다');
    // 706: 먼저 몇 개가 지워지는지 창 안에 보여 주고, 한 번 더 눌러야 지운다(창을 겹쳐 띄우지 않는다).
    const removeWith = button('객체째 삭제', () => safe(() => {
      const ids = new Set([...chosenIds].filter((id) => id !== ctx.activeLayer()));
      if (!ids.size) throw Error('현재 레이어는 삭제할 수 없습니다. 다른 레이어를 현재로 바꾼 뒤 지우세요.');
      pendingDelete = {ids, n: countLayerDelete(engine.doc, ids), names: engine.doc.layers.filter((l) => ids.has(l.id)).map((l) => l.name)};
      draw();
    }), 'LAYDEL · 레이어와 그 객체를 함께 지웁니다');
    const current = button('현재로', () => { const id = [...chosenIds][0]; const l = engine.doc.layers.find((x) => x.id === id); if (!l) return; if (l.frozen) return toast('동결된 레이어는 현재 레이어로 할 수 없습니다.', true); ctx.setActiveLayer(id); refresh(); draw(); });
    const close = button('닫기', () => dialog.close());
    head.append(search, add, remove, removeWith, current);
    const pending = unreconciledLayers(engine.doc);
    if (pending.length) head.append(button(`새 레이어 확인함 (${pending.length})`, () => safe(() => { const ids = [...chosenIds].filter((id) => pending.some((l) => l.id === id)); execute({type: 'batch', commands: reconcileCommands(engine.doc, ids.length ? ids : null)}); refresh(); draw(); }), '고른 줄(없으면 모두)을 확인된 레이어로 표시합니다'));
    head.append(close);
    dialog.append(head);
    if (pendingDelete) {
      const {ids, n, names} = pendingDelete, bar = cell('div', {className: 'lm-confirm'}); bar.setAttribute('role', 'alert');
      bar.append(cell('span', {textContent: `레이어 ${names.join(', ')} 와 객체 ${n.top.toLocaleString('ko-KR')}개 · 블록 안 객체 ${n.nested.toLocaleString('ko-KR')}개(블록 정의 ${n.blocks}개)를 지웁니다. Ctrl+Z 한 번으로 되돌립니다.`}),
        button('지우기', () => safe(() => { pendingDelete = null; execute({type: 'layer.deleteWithEntities', ids: [...ids]}); chosenIds = new Set([ctx.activeLayer()]); recount(); refresh(); draw(); toast(`레이어 ${ids.size}개와 객체 ${(n.top + n.nested).toLocaleString('ko-KR')}개를 지웠습니다. Ctrl+Z 로 되돌립니다.`); })),
        button('취소', () => { pendingDelete = null; draw(); }));
      dialog.append(bar);
    }
    const bodyWrap = cell('div', {className: 'lm-body'});
    // 702 필터 목록
    const side = cell('nav', {className: 'lm-filters'}); side.setAttribute('aria-label', '레이어 필터');
    for (const f of layerFilterList(engine.doc, {counts: count})) {
      const b = cell('button', {type: 'button', className: 'lm-filter' + (f.id === filterId ? ' is-active' : ''), textContent: `${f.name} · ${f.count}`});
      b.setAttribute('aria-pressed', String(f.id === filterId));
      b.onclick = () => { filterId = f.id; state.filterId = f.id; draw(); };
      side.append(b);
    }
    const nameInput = cell('input', {className: 'lm-filter-name', placeholder: '새 필터 이름(비우면 자동)', value: filterName, maxLength: 60});
    nameInput.setAttribute('aria-label', '저장할 필터 이름'); nameInput.oninput = () => { filterName = nameInput.value; };
    const askName = (fallback) => { const v = (filterName || '').trim() || fallback; filterName = ''; return v; };
    const saveRule = button('검색어를 필터로', () => safe(() => {
      const pattern = filter.trim();
      if (!pattern) throw Error('검색칸에 이름 패턴(예: A-WALL*, *벽*, ~*임시*)을 넣으세요.');
      const name = askName(pattern);
      execute({type: 'document.update', changes: {layerFilters: upsertLayerFilter(engine.doc, {name: name.trim(), kind: 'property', rule: {name: /[*?#,~]/.test(pattern) ? pattern : `*${pattern}*`}})}});
      filterId = engine.doc.layerFilters.find((f) => f.name === name.trim())?.id || filterId; filter = ''; draw();
    }), '이름 패턴 필터(와일드카드 * ? #, 쉼표로 여러 개, ~ 는 제외)');
    const saveGroup = button('고른 줄을 그룹으로', () => safe(() => {
      if (!chosenIds.size) throw Error('그룹에 넣을 레이어 줄을 고르세요.');
      const name = askName('그룹' + ((engine.doc.layerFilters || []).length + 1));
      execute({type: 'document.update', changes: {layerFilters: upsertLayerFilter(engine.doc, {name: name.trim(), kind: 'group', ids: [...chosenIds]})}});
      filterId = engine.doc.layerFilters.find((f) => f.name === name.trim())?.id || filterId; draw();
    }));
    const dropFilter = button('필터 지우기', () => safe(() => { if (AUTO_FILTERS.some((f) => f.id === filterId)) throw Error('자동 필터는 지울 수 없습니다.'); execute({type: 'document.update', changes: {layerFilters: removeLayerFilter(engine.doc, filterId)}}); filterId = 'all'; draw(); }));
    side.append(nameInput, saveRule, saveGroup, dropFilter);
    const table = cell('table', {className: 'lm-table'});
    table.innerHTML = layerManagerHeader();
    const body = cell('tbody'), layers = visibleManagerLayers(engine.doc, {filterId, search: filter, counts: count});
    const toggle = (l, key, on, label) => { const b = cell('button', {type: 'button', className: 'lm-toggle', textContent: label(on)}); b.setAttribute('aria-pressed', String(on)); b.onclick = (e) => { e.stopPropagation(); update(targets(l), {[key]: !on}); }; return b; };
    for (const l of layers) {
      const tr = cell('tr'); if (chosenIds.has(l.id)) tr.classList.add('chosen');
      const used = count.get(l.id) || 0;
      if (!used) { tr.classList.add('lm-unused'); tr.title = '객체가 없는 레이어 · 지울 수 있습니다'; }
      if (l.reconciled === false) tr.classList.add('lm-unreconciled');
      tr.onclick = (e) => { if (e.shiftKey && anchor) { const ids = layers.map((x) => x.id), a = ids.indexOf(anchor), b = ids.indexOf(l.id); chosenIds = new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1)); } else if (e.ctrlKey || e.metaKey) { chosenIds.has(l.id) ? chosenIds.delete(l.id) : chosenIds.add(l.id); anchor = l.id; } else { chosenIds = new Set([l.id]); anchor = l.id; } draw(); };
      tr.ondblclick = () => current.onclick();
      const stop = (input) => { input.onclick = (e) => e.stopPropagation(); return input; };
      const name = stop(cell('input', {value: l.name, className: 'lm-name'})); name.onchange = () => { const v = name.value.trim(); if (!v || v === l.name) { name.value = l.name; return; } if (engine.doc.layers.some((x) => x.name === v && x.id !== l.id)) { toast('같은 이름의 레이어가 있습니다.', true); name.value = l.name; return; } update(new Set([l.id]), {name: v}); };
      const color = stop(cell('input', {type: 'color', value: /^#[0-9a-f]{6}$/i.test(l.color || '') ? l.color : '#ffffff'})); color.onchange = () => update(targets(l), {color: color.value});
      const lt = stop(cell('select')); for (const t of [...new Set([...LINETYPES, (l.linetype || 'CONTINUOUS').toUpperCase()])]) lt.append(new Option(t, t, false, (l.linetype || 'CONTINUOUS').toUpperCase() === t)); lt.onchange = () => update(targets(l), {linetype: lt.value});
      const lw = stop(cell('select')); const w = Number(l.lineweight ?? 0.25); for (const v of [...new Set([...WEIGHTS, w])].sort((a, b) => a - b)) lw.append(new Option(v.toFixed(2) + ' mm', v, false, Math.abs(v - w) < 1e-9)); lw.onchange = () => update(targets(l), {lineweight: Number(lw.value)});
      const transp = stop(cell('input', {type: 'number', min: 0, max: 90, step: 5, value: l.transparency ?? 0, className: 'lm-transp'})); transp.setAttribute('aria-label', l.name + ' 투명도 0~90'); transp.onchange = () => update(targets(l), {transparency: clampTransparency(transp.value)});
      const desc = stop(cell('input', {value: l.description || '', className: 'lm-desc', maxLength: 255, placeholder: '설명'})); desc.setAttribute('aria-label', l.name + ' 설명'); desc.onchange = () => update(new Set([l.id]), {description: desc.value});
      const cells = [cell('td', {textContent: l.id === ctx.activeLayer() ? '✔' : ''}), ...Array.from({length: 10}, () => cell('td')), cell('td', {textContent: used.toLocaleString('ko-KR'), className: 'lm-count'})];
      cells[1].append(name);
      cells[2].append(toggle(l, 'visible', l.visible !== false, (on) => (on ? '켜짐' : '꺼짐')));
      cells[3].append(toggle(l, 'frozen', !!l.frozen, (on) => (on ? '동결' : '—')));
      cells[4].append(toggle(l, 'locked', !!l.locked, (on) => (on ? '잠김' : '—')));
      cells[5].append(color); cells[6].append(lt); cells[7].append(lw); cells[8].append(transp);
      cells[9].append(toggle(l, 'plot', l.plot !== false, (on) => (on ? '인쇄' : '안 함')));
      cells[10].append(desc);
      tr.append(...cells); body.append(tr);
    }
    table.append(body);
    bodyWrap.append(side, table);
    dialog.append(bodyWrap);
    const unused = engine.doc.layers.filter((l) => !count.get(l.id) && l.name !== '0').length;
    dialog.append(cell('p', {className: 'lm-foot', textContent: `레이어 ${engine.doc.layers.length}개 · 표시 ${layers.length}개 · 안 쓰는 레이어 ${unused}개(흐리게) · 객체 수는 블록 안까지 셉니다 · Ctrl·Shift 로 여러 줄을 고르고 토글을 누르면 모두 바뀝니다 · 더블클릭 = 현재 레이어`}));
  }
  draw();
  if (!dialog.open) dialog.showModal();
  dialog.onclose = () => canvas?.focus?.();
  return dialog;
}
