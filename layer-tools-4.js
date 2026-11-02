// 4차 "부분" 재작업 — 켜(레이어) 명령 10개. 2차 검증 reports/2차_매핑검증_A_보고_20260921.md "8. 레이어" 절이
// "부분"으로 판정한 LLL·LO·LOO·LU·LAM·LC·LCO·LP·LRN·LRL 을 원문 그대로 다시 만든다. 원문:
//  LLL/LO/LOO/LU → izzarder.com/100 (켜 상태 조절 명령어 모음, 대화상자 없음)
//  LAM → izzarder.com/199, LC → izzarder.com/101, LCO → izzarder.com/437,
//  LP → izzarder.com/298, LRN → izzarder.com/406, LRL → izzarder.com/128
// 정리본 docs/izzarder-reference-20260921/references/08-layer.md 와 원문 페이지(WebFetch)를 함께 읽고 옮겼다.
// 대체하는 기존 명령(읽기만 하고 고치지 않음): FREEZE·LAYON·LAYUNLOCK(studio.js), LAYMERGE(workflows.js:46-54),
// PROPERTIES·LAYER(app.js:3904-4128, editProperties/editLayers). 기존 명령은 그대로 두고 바른 CAD 리습 이름은 통합 담당이
// 새 카드로 연결한다. 바른 CAD는 AutoCAD ACI 색번호가 아니라 항상 #RRGGBB 를 쓰므로 LP 의 "시작 색번호"는 아래
// LP_AUTO_PALETTE 배열의 인덱스로 옮겼다(보고서 참고).

import {isChecked} from './card-input.js';

/* ── 공통 ── */
const flag = isChecked; // 2026-09-24: 체크박스는 card-input isChecked(on·true·yes·1 = 켜짐)로 읽는다(LP·LRN 실행 불가 해결)
/** 선택창은 켜 개수만큼 체크박스를 늘어놓지 않는다(11절, 한 화면 원칙). 콤마·줄바꿈으로 구분한 켜 이름을
    이름(대소문자 구분 안 함)으로 찾아 id 로 바꾼다. 못 찾은 이름은 조용히 건너뛴다. */
export function resolveLayerNamesToIds(layers, text) {
  const names = String(text || '').split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  const byName = new Map(layers.map((l) => [l.name.toLowerCase(), l.id]));
  const ids = [];
  for (const n of names) { const id = byName.get(n.toLowerCase()); if (id && !ids.includes(id)) ids.push(id); }
  return ids;
}

/* ── LC/LCO 공통: 참조 켜로 바꿀 때 강제색·선종류까지 ByLayer 로 되돌릴지 ── */
export function layerChangeSet(layerId, resetOverrides) {
  return resetOverrides ? { layer: layerId, color: null, linetype: null } : { layer: layerId };
}

/* ── LAM(켜 합치기) · LP 의 "아래 켜로 통합" 절에서도 재사용 ──
   purge=true 면 engine 의 layer.merge(항상 블럭 내부까지 포함해 원본 켜를 지운다) 를 쓰고,
   purge=false 면 원본 켜는 남기고 최상위 객체만 layer 필드를 옮긴다(엔진에 "합치되 원본 유지" 명령이 없음 — 보고서 참고). */
export function planLayerMerge(layers, entities, sources, target, { keepColor = false, keepLinetype = false, purge = true } = {}) {
  if (!Array.isArray(sources) || !sources.length) throw Error('합쳐질 켜를 하나 이상 고르세요.');
  if (sources.includes(target)) throw Error('대상 켜는 합쳐질 켜 목록에 없어야 합니다.');
  const byId = new Map(layers.map((l) => [l.id, l]));
  const targetLayer = byId.get(target);
  if (!targetLayer) throw Error('대상 켜를 확인할 수 없습니다.');
  if (sources.some((id) => byId.get(id)?.name === '0')) throw Error('"0" 켜는 합쳐질 켜 목록에 넣을 수 없습니다.');
  const pool = entities.filter((e) => sources.includes(e.layer));
  const commands = [];
  if (!keepColor || !keepLinetype) {
    const changes = {};
    if (!keepColor) changes.color = null;
    if (!keepLinetype) changes.linetype = null;
    if (pool.length) commands.push({ type: 'update', ids: pool.map((e) => e.id), changes });
  }
  if (purge) commands.push({ type: 'layer.merge', sources, target });
  else if (pool.length) commands.push({ type: 'update', ids: pool.map((e) => e.id), changes: { layer: target } });
  return { commands, targetName: targetLayer.name, count: pool.length };
}

/* ── LP(켜 특성 변경) ── */
export const LP_AUTO_PALETTE = Object.freeze([
  '#ff5a5a', '#ffb454', '#ffe066', '#8ce99a', '#63e6be', '#66d9e8',
  '#74c0fc', '#91a7ff', '#b197fc', '#e599f7', '#f783ac', '#ced4da',
]);
export function assignDistinctColors(targetIds, startIndex = 0, palette = LP_AUTO_PALETTE) {
  const map = new Map();
  targetIds.forEach((id, i) => map.set(id, palette[(Math.max(0, startIndex | 0) + i) % palette.length]));
  return map;
}
/** props={off,frozen,locked,noplot,color,linetype} → 모든 targetIds 에 같은 changes 를 적용. */
export function computeLayerStateChanges(targetIds, props = {}) {
  const changes = { visible: !props.off, frozen: !!props.frozen, locked: !!props.locked, plot: !props.noplot };
  if (props.color) changes.color = props.color;
  if (props.linetype) changes.linetype = props.linetype;
  return targetIds.map((id) => ({ id, changes }));
}
/** To ByLayer(강제색/선종류를 지워 켜 값을 따르게)·From ByLayer(ByLayer 인 객체만 켜 값으로 강제) 두 방향.
    "이미 변경 제외"는 항상 켜진 것으로 단순화했다(보고서 참고: From ByLayer 는 원래 ByLayer 인 것만 건드린다). */
export function computeByLayerEntityChanges(entities, targetLayerIds, layersById, { mode, color = false, linetype = false } = {}) {
  const set = new Set(targetLayerIds);
  const out = [];
  for (const e of entities) {
    if (!set.has(e.layer)) continue;
    const changes = {};
    if (mode === 'toByLayer') {
      if (color && e.color != null) changes.color = null;
      if (linetype && e.linetype != null) changes.linetype = null;
    } else if (mode === 'fromByLayer') {
      const layer = layersById.get(e.layer);
      if (layer) {
        if (color && e.color == null) changes.color = layer.color;
        if (linetype && e.linetype == null) changes.linetype = layer.linetype;
      }
    }
    if (Object.keys(changes).length) out.push({ id: e.id, changes });
  }
  return out;
}

/* ── LRN(켜이름 변경) ── */
export function renameAdd(name, prefix = '', suffix = '') { return `${prefix || ''}${name}${suffix || ''}`; }
export function renameStrip(name, prefix = '', suffix = '') {
  let out = name;
  if (prefix && out.startsWith(prefix)) out = out.slice(prefix.length);
  if (suffix && out.endsWith(suffix)) out = out.slice(0, out.length - suffix.length);
  return out;
}
export function renamePartial(name, from, to = '') { return from ? name.split(from).join(to) : name; }
export function renameSerial(text, start, index) { return `${text}${(Number(start) || 0) + index}`; }
export function renameSpecialChars(name) { return name.replace(/[ !@#^]/g, '_'); }
/** LRN 의 5가지 [기능]이 저마다 다른 입력 두 개를 쓰므로(추가/빼기=앞·뒤, 부분변경=전·후, 일련번호=문자·시작번호),
    한 화면에 넣으려고 "값1,값2" 한 줄로 받는다(11절). */
export function parseLrnValue(str) {
  const parts = String(str || '').split(',').map((s) => s.trim());
  return { a: parts[0] || '', b: parts[1] || '' };
}

/* ── LRL(켜 이름 변경·목록) — 와일드카드 서브셋: * ? # (원문의 [..]·@·.·- 는 지원하지 않는다, 보고서 참고). ── */
export function wildcardToRegExp(pattern) {
  const alts = String(pattern || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (!alts.length) return null;
  const toRe = (p) => {
    let out = '';
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === '`' && i + 1 < p.length) { out += p[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
      if (c === '*') { out += '.*'; continue; }
      if (c === '?') { out += '.'; continue; }
      if (c === '#') { out += '\\d'; continue; }
      out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return `^${out}$`;
  };
  return new RegExp(alts.map(toRe).join('|'), 'i');
}
export function parseRenamePairs(str) {
  const out = [];
  for (let line of String(str || '').split(/\n+/)) {
    line = line.trim();
    if (!line) continue;
    const m = /^(.+?)\s*(?:->|=>|[:=\t])\s*(.+)$/.exec(line);
    if (!m) continue;
    const find = m[1].trim(), replace = m[2].trim();
    if (find) out.push({ find, replace });
  }
  return out;
}
/** 첫 번째로 맞는 쌍만 적용한다(원문: 목록에 매칭되는 모든 켜 이름이 일괄 변경). '0'·Defpoints 는 대상에서 뺀다. */
export function applyRenameList(layerNames, pairs) {
  const result = new Map();
  for (const name of layerNames) {
    if (name === '0' || name === 'Defpoints') continue;
    for (const { find, replace } of pairs) {
      const re = wildcardToRegExp(find);
      if (re && re.test(name)) { result.set(name, replace); break; }
    }
  }
  return result;
}

/* ── 카드 진입점 ── */
export function installLayerTools4(ctx) {
  return ({ /* 비평 11: 오류 처리는 app.js runCardCommand(보고·되돌리기 묶음) 한 곳에서 한다 — 모듈 안의 두 번째 감싸기는 뺐다. */
    /* LLL — 선택 객체가 속한 켜를 얼림(izzarder.com/100). 기존 FREEZE는 선택과 무관하게 "현재 켜"만 얼려 판정이 "부분"이었다. */
    LLL() {
      const sel = ctx.selected();
      if (!sel.length) throw Error('얼릴 켜를 얻으려면 먼저 객체를 선택하세요.');
      const ids = [...new Set(sel.map((e) => e.layer))];
      ctx.execute({ type: 'batch', commands: ids.map((id) => ({ type: 'layer.update', id, changes: { frozen: true } })) });
      ctx.setSelected([]);
      ctx.refresh();
      ctx.toast(`LLL · 선택 객체가 속한 켜 ${ids.length}개를 얼렸습니다.`);
    },
    /* LO — 꺼진 켜를 모두 켠다. 얼림 상태는 건드리지 않는다(izzarder.com/100). 기존 LAYON은 항상 동결도 함께 풀어 LOO 역할까지 겸했다. */
    LO() {
      const ids = ctx.layers().filter((l) => !l.visible).map((l) => l.id);
      if (!ids.length) return ctx.toast('꺼진 켜가 없습니다.');
      ctx.execute({ type: 'batch', commands: ids.map((id) => ({ type: 'layer.update', id, changes: { visible: true } })) });
      ctx.refresh();
      ctx.toast(`LO · 꺼진 켜 ${ids.length}개를 켰습니다. (얼림 상태는 바꾸지 않습니다)`);
    },
    /* LOO — 얼린 켜를 모두 녹인다. 켜짐/꺼짐은 건드리지 않는다(izzarder.com/100). */
    LOO() {
      const ids = ctx.layers().filter((l) => l.frozen).map((l) => l.id);
      if (!ids.length) return ctx.toast('얼린 켜가 없습니다.');
      ctx.execute({ type: 'batch', commands: ids.map((id) => ({ type: 'layer.update', id, changes: { frozen: false } })) });
      ctx.refresh();
      ctx.toast(`LOO · 얼린 켜 ${ids.length}개를 녹였습니다. (켜짐/꺼짐 상태는 바꾸지 않습니다)`);
    },
    /* LU — 선택 객체가 속한 켜만 잠금 해제(izzarder.com/100). 기존 LAYUNLOCK은 선택과 무관하게 잠긴 켜 전체를 풀어 LUK와 같았다. */
    LU() {
      const sel = ctx.selected();
      if (!sel.length) throw Error('잠금을 풀 켜를 얻으려면 먼저 객체를 선택하세요.');
      const byId = new Map(ctx.layers().map((l) => [l.id, l]));
      const ids = [...new Set(sel.map((e) => e.layer))].filter((id) => byId.get(id)?.locked);
      if (!ids.length) return ctx.toast('선택한 객체가 속한 켜 중 잠긴 켜가 없습니다.');
      ctx.execute({ type: 'batch', commands: ids.map((id) => ({ type: 'layer.update', id, changes: { locked: false } })) });
      ctx.refresh();
      ctx.toast(`LU · 선택 객체가 속한 켜 ${ids.length}개의 잠금을 풀었습니다. (다른 켜는 그대로 잠겨 있습니다)`);
    },
    /* LAM — 켜 합치기(izzarder.com/199). 원문은 좌우 2단 리스트박스지만, 켜 개수만큼 체크박스를 늘어놓으면
       한 화면(11절)을 넘기므로 "합쳐질 켜"는 이름을 콤마로 적는 방식으로 옮겼다. "블럭 속 객체도 적용" 체크박스는
       만들지 않았다: purge 경로는 engine의 layer.merge가 항상 블럭 내부까지 옮기고(끌 방법이 없다), purge를 끄면
       ctx.entities()가 최상위 객체만 줘서 애초에 블럭 내부에 닿지 않는다 — 어느 쪽도 사용자가 끄고 켤 수 없어
       가짜 체크박스를 넣지 않았다(보고서 참고). */
    LAM() {
      const layers = ctx.layers();
      if (layers.length < 2) throw Error('합칠 켜가 2개 이상 있어야 합니다.');
      const fields = [
        { name: 'sources', label: '합쳐질 켜 이름(콤마구분)', type: 'text', value: '' },
        { name: 'target', label: '대상 켜(합쳐지는 곳)', type: 'select', options: layers.map((l) => [l.id, l.name]), value: layers[layers.length - 1].id },
        { name: 'keepColor', label: '강제색 유지하고 켜만 합치기', type: 'checkbox', value: false },
        { name: 'keepLinetype', label: '강제선종류 유지하고 켜만 합치기', type: 'checkbox', value: false },
        { name: 'purge', label: '합친 후 기존 켜 제거', type: 'checkbox', value: true },
      ];
      ctx.form('켜 합치기 (LAM)', fields, (values) => {
        const sources = resolveLayerNamesToIds(layers, values.sources);
        const { commands, targetName, count } = planLayerMerge(layers, ctx.entities(), sources, values.target, {
          keepColor: flag(values.keepColor), keepLinetype: flag(values.keepLinetype), purge: flag(values.purge),
        });
        if (!commands.length) return ctx.toast('합칠 객체나 켜가 없습니다.');
        ctx.execute({ type: 'batch', commands });
        ctx.refresh();
        ctx.toast(`LAM · 켜 ${sources.length}개를 "${targetName}" 켜로 합쳤습니다(객체 ${count}개).${flag(values.purge) ? ' 기존 켜는 지웠습니다.' : ' 기존 켜는 남겨두었습니다.'}`);
      });
    },
    /* LC — 기준객체 참조 켜변경(izzarder.com/101). 화면에서 기준 객체를 선택하거나(Esc 하면) [A] 대신 목록에서 고르고,
       이후 선택하는 객체마다 그 켜로 바꾸며 Esc 로 끝낸다. LC는 대상 객체의 강제색·선종류도 ByLayer로 되돌린다
       (izzarder.com/437 이 "LC는 켜를 바꾸며 대상 켜 속성을 물려받는다"고 LCO와 대비해 설명한다). */
    async LC() {
      const ref = await ctx.pickEntity({ prompt: 'LC · 참조 켜를 가져올 기준 객체를 선택하세요 (취소하면 목록에서 고릅니다)' });
      if (ref) { await runChangeLayerLoop(ctx, ref.layer, true, 'LC'); return; }
      const layers = ctx.layers();
      if (!layers.length) throw Error('켜가 없습니다.');
      ctx.form('LC · 참조 켜를 목록에서 고르기 ([A])', [
        { name: 'layer', label: '켜', type: 'select', options: layers.map((l) => [l.id, l.name]), value: layers[0].id },
      ], async (v) => {
        try { await runChangeLayerLoop(ctx, v.layer, true, 'LC'); }
        catch (e) { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); }
      });
    },
    /* LCO — 켜 변경(선종류와 선색 유지, izzarder.com/437). LC와 조작은 같지만 강제색·선종류는 그대로 둔다. */
    async LCO() {
      const ref = await ctx.pickEntity({ prompt: 'LCO · 참조 켜를 가져올 기준 객체를 선택하세요 (취소하면 목록에서 고릅니다)' });
      if (ref) { await runChangeLayerLoop(ctx, ref.layer, false, 'LCO'); return; }
      const layers = ctx.layers();
      if (!layers.length) throw Error('켜가 없습니다.');
      ctx.form('LCO · 참조 켜를 목록에서 고르기 ([A])', [
        { name: 'layer', label: '켜', type: 'select', options: layers.map((l) => [l.id, l.name]), value: layers[0].id },
      ], async (v) => {
        try { await runChangeLayerLoop(ctx, v.layer, false, 'LCO'); }
        catch (e) { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); }
      });
    },
    /* LP — 켜 특성 변경(izzarder.com/298). [적용 켜] 선택켜/목록켜/모든켜, [켜의 특성], To/From ByLayer,
       자동 색 배정, 아래 켜로 통합까지 옮겼다. 한 화면(11절)에 넣으려고 켜 개수만큼 체크박스 대신 이름 목록
       텍스트를 쓰고, To/From 각각의 색·선 체크박스 2개씩(4개)을 "색/선 처리" 체크박스 2개로 합쳤으며(방식은
       위 [mode] 라디오가 정한다), 자동 배정 체크박스+번호를 "빈칸=사용 안 함"인 숫자 필드 하나로, 통합 체크박스+
       대상 켜를 "사용 안 함" 옵션이 있는 select 하나로 합쳤다. "블럭 내부 객체 제외"는 만들지 않았다
       (ctx.entities()가 애초에 블럭 내부에 닿지 않아 항상 제외된 것과 같다). "ByBlock 색 별도 지정"·
       "이미 변경 제외" 토글은 생략했다(항상 켜진 것으로 단순화, 보고서 참고). */
    LP() {
      const layers = ctx.layers();
      if (!layers.length) throw Error('켜가 없습니다.');
      const fields = [
        { name: 'scope', label: '적용 켜', type: 'select', options: [['selected', '선택켜(지금 선택된 객체의 켜)'], ['list', '목록켜(아래 이름)'], ['all', '모든켜']], value: 'list' },
        { name: 'listNames', label: '목록켜 이름(콤마구분, 적용 켜=목록켜일 때만 사용)', type: 'text', value: '' },
        { name: 'applyProps', label: '켜 특성 적용', type: 'checkbox', value: true },
        { name: 'off', label: '꺼짐', type: 'checkbox', value: false },
        { name: 'frozen', label: '동결', type: 'checkbox', value: false },
        { name: 'locked', label: '잠김', type: 'checkbox', value: false },
        { name: 'noplot', label: '출력안함', type: 'checkbox', value: false },
        { name: 'color', label: '켜 색 #RRGGBB (빈칸=변경안함)', type: 'text', value: '' },
        { name: 'linetype', label: '켜 선종류', type: 'select', options: [['', '변경안함'], ['CONTINUOUS', 'CONTINUOUS'], ['DASHED', 'DASHED'], ['CENTER', 'CENTER'], ['HIDDEN', 'HIDDEN']], value: '' },
        { name: 'mode', label: '방식', type: 'select', options: [['toByLayer', 'To ByLayer(객체 강제속성→켜값)'], ['fromByLayer', 'From ByLayer(켜값→객체 강제속성)']], value: 'toByLayer' },
        { name: 'fixColor', label: '색도 위 방식대로 처리', type: 'checkbox', value: false },
        { name: 'fixLinetype', label: '선종류도 위 방식대로 처리', type: 'checkbox', value: false },
        { name: 'autoColorStart', label: '켜별 자동 색 배정 시작번호(빈칸=사용 안 함, 0부터)', type: 'text', value: '' },
        { name: 'mergeTarget', label: '적용 후 아래 켜로 통합(사용 안 함=그대로)', type: 'select', options: [['', '사용 안 함'], ...layers.map((l) => [l.id, l.name])], value: '' },
        { name: 'mergePurge', label: '통합 후 기존 켜 제거(퍼지)', type: 'checkbox', value: true },
      ];
      ctx.form('켜 특성 변경 (LP)', fields, (values) => {
        let targetIds;
        if (values.scope === 'selected') {
          const sel = ctx.selected();
          if (!sel.length) throw Error('선택켜를 쓰려면 먼저 객체를 선택하세요.');
          targetIds = [...new Set(sel.map((e) => e.layer))];
        } else if (values.scope === 'all') targetIds = layers.map((l) => l.id);
        else targetIds = resolveLayerNamesToIds(layers, values.listNames);
        if (!targetIds.length) throw Error('적용할 켜를 고르세요.');
        const commands = [];
        if (flag(values.applyProps)) {
          const props = { off: flag(values.off), frozen: flag(values.frozen), locked: flag(values.locked), noplot: flag(values.noplot) };
          if (values.color) {
            if (!/^#[0-9a-fA-F]{6}$/.test(values.color)) throw Error('켜 색은 #RRGGBB 형식으로 입력하세요.');
            props.color = values.color;
          }
          if (values.linetype) props.linetype = values.linetype;
          for (const c of computeLayerStateChanges(targetIds, props)) commands.push({ type: 'layer.update', id: c.id, changes: c.changes });
        }
        if (values.autoColorStart !== '') {
          const start = Number(values.autoColorStart);
          if (!Number.isFinite(start) || start < 0) throw Error('자동 배정 시작번호는 0 이상 숫자입니다.');
          const colorMap = assignDistinctColors(targetIds, start);
          for (const id of targetIds) commands.push({ type: 'layer.update', id, changes: { color: colorMap.get(id) } });
        }
        if (flag(values.fixColor) || flag(values.fixLinetype)) {
          const layersById = new Map(layers.map((l) => [l.id, l]));
          for (const c of computeByLayerEntityChanges(ctx.entities(), targetIds, layersById, { mode: values.mode, color: flag(values.fixColor), linetype: flag(values.fixLinetype) }))
            commands.push({ type: 'update', ids: [c.id], changes: c.changes });
        }
        if (values.mergeTarget) {
          const mergeSources = targetIds.filter((id) => id !== values.mergeTarget);
          if (mergeSources.length) {
            const plan = planLayerMerge(layers, ctx.entities(), mergeSources, values.mergeTarget, { keepColor: true, keepLinetype: true, purge: flag(values.mergePurge) });
            commands.push(...plan.commands);
          }
        }
        if (!commands.length) return ctx.toast('바뀐 것이 없습니다.');
        ctx.execute({ type: 'batch', commands });
        ctx.refresh();
        ctx.toast(`LP · 켜 ${targetIds.length}개의 특성을 바꿨습니다.`);
      });
    },
    /* LRN — 켜이름 변경(izzarder.com/406). [적용 켜] 목록켜/모든켜, [기능] 추가/빼기/부분변경/일련번호/특수문자→_.
       한 화면(11절)에 넣으려고 켜 개수만큼 체크박스 대신 이름 목록 텍스트를 쓰고, 기능마다 다른 입력 두 개
       (추가·빼기=앞/뒤, 부분변경=전/후, 일련번호=문자/시작번호)를 "값1,값2" 필드 하나로 합쳤다. */
    LRN() {
      const layers = ctx.layers();
      if (!layers.length) throw Error('켜가 없습니다.');
      const fields = [
        { name: 'scope', label: '적용 켜', type: 'select', options: [['list', '목록켜(아래 이름)'], ['all', '모든켜']], value: 'list' },
        { name: 'listNames', label: '목록켜 이름(콤마구분, 적용 켜=목록켜일 때만 사용)', type: 'text', value: '' },
        { name: 'func', label: '기능', type: 'select', options: [['add', '추가'], ['strip', '빼기'], ['partial', '부분변경'], ['serial', '일련번호'], ['special', '특수문자를 _로 변경']], value: 'add' },
        { name: 'value', label: '값1,값2 (추가/빼기=앞,뒤 · 부분변경=전,후 · 일련번호=문자,시작번호 · 특수문자 변경은 비워둠)', type: 'text', value: '' },
      ];
      ctx.form('켜이름 변경 (LRN)', fields, (values) => {
        const listIds = resolveLayerNamesToIds(layers, values.listNames);
        const targets = values.scope === 'all' ? layers.filter((l) => l.name !== '0') : layers.filter((l) => listIds.includes(l.id));
        if (!targets.length) throw Error('이름을 바꿀 켜를 고르세요.');
        const { a, b } = parseLrnValue(values.value);
        const existingNames = new Set(layers.map((l) => l.name.toLowerCase()));
        const commands = []; let skipped = 0;
        targets.forEach((l, i) => {
          let name;
          if (values.func === 'add') name = renameAdd(l.name, a, b);
          else if (values.func === 'strip') name = renameStrip(l.name, a, b);
          else if (values.func === 'partial') { if (!a) throw Error('부분변경은 "전" 문자열을 값1에 입력하세요.'); name = renamePartial(l.name, a, b); }
          else if (values.func === 'serial') { if (!a) throw Error('일련번호는 문자를 값1에 입력하세요.'); name = renameSerial(a, Number(b) || 1, i); }
          else name = renameSpecialChars(l.name);
          if (!name || name === l.name) return;
          if (l.name === '0') return;
          if (existingNames.has(name.toLowerCase()) && name.toLowerCase() !== l.name.toLowerCase()) { skipped++; return; }
          existingNames.delete(l.name.toLowerCase()); existingNames.add(name.toLowerCase());
          commands.push({ type: 'layer.update', id: l.id, changes: { name } });
        });
        if (!commands.length) return ctx.toast('바뀐 이름이 없습니다.' + (skipped ? ` (이미 있는 이름과 겹쳐 ${skipped}개는 건너뜀 · LAM으로 합치세요)` : ''));
        ctx.execute({ type: 'batch', commands });
        ctx.refresh();
        ctx.toast(`LRN · 켜 ${commands.length}개의 이름을 바꿨습니다.${skipped ? ` · 이름이 겹친 ${skipped}개는 건너뛰었습니다.` : ''}`);
      });
    },
    /* LRL — 켜 이름 변경(목록, izzarder.com/128). "찾을이름 -> 바꿀이름" 쌍을 여러 줄 등록해 일괄 변경한다.
       와일드카드는 * ? # 만 지원한다(원문의 [..]·@·.·- 문자집합은 생략, 보고서 참고). */
    LRL() {
      const layers = ctx.layers();
      if (!layers.length) throw Error('켜가 없습니다.');
      ctx.form('켜 이름 변경(목록) (LRL)', [
        { name: 'pairs', label: '한 줄에 "찾을이름 -> 바꿀이름" (와일드카드 * ? # 지원, 대소문자 구분 안 함)', type: 'textarea', value: '' },
      ], (values) => {
        const pairs = parseRenamePairs(values.pairs);
        if (!pairs.length) throw Error('한 줄에 "찾을이름 -> 바꿀이름" 형식으로 하나 이상 입력하세요.');
        const map = applyRenameList(layers.map((l) => l.name), pairs);
        const existingNames = new Set(layers.map((l) => l.name.toLowerCase()));
        const commands = []; let skipped = 0;
        for (const l of layers) {
          const newName = map.get(l.name);
          if (!newName || newName === l.name) continue;
          if (existingNames.has(newName.toLowerCase()) && newName.toLowerCase() !== l.name.toLowerCase()) { skipped++; continue; }
          existingNames.delete(l.name.toLowerCase()); existingNames.add(newName.toLowerCase());
          commands.push({ type: 'layer.update', id: l.id, changes: { name: newName } });
        }
        if (!commands.length) return ctx.toast('일치하는 켜가 없습니다.' + (skipped ? ` (이름이 겹쳐 ${skipped}개 건너뜀)` : ''));
        ctx.execute({ type: 'batch', commands });
        ctx.refresh();
        ctx.toast(`LRL · 켜 ${commands.length}개의 이름을 목록에 따라 바꿨습니다.${skipped ? ` · 겹쳐서 건너뛴 것 ${skipped}개.` : ''}`);
      });
    },
  });
}

/* LC/LCO 가 공유하는 반복 루프: 참조 켜가 정해지면 대상 객체를 계속 선택해 그 켜로 바꾸고 Esc 로 끝낸다. */
async function runChangeLayerLoop(ctx, layerId, resetOverrides, cmdLabel) {
  const layer = ctx.layers().find((l) => l.id === layerId);
  if (!layer) throw Error('참조 켜를 확인할 수 없습니다.');
  let n = 0;
  for (;;) {
    const t = await ctx.pickEntity({ prompt: `"${layer.name}" 켜로 바꿀 객체를 선택 · Esc 로 끝내기${n ? ' · 지금까지 ' + n + '개' : ''} (${cmdLabel})` });
    if (!t) break;
    ctx.execute({ type: 'update', ids: [t.id], changes: layerChangeSet(layerId, resetOverrides) });
    ctx.refresh();
    n++;
  }
  if (n) ctx.toast(`${cmdLabel} · 객체 ${n}개의 켜를 "${layer.name}"(으)로 바꿨습니다.`);
  else ctx.toast(`${cmdLabel} · 바꾼 객체가 없습니다.`);
}
