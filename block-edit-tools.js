import {standardLayerForName} from './layer-standards.js';
// 3차 병렬 작업(2026-09-21): 블럭 관련 10개 + 파일접근 3개(없음) + 기타 2개.
// 바른 CAD 리습(izzarder.com) 정리본 docs/izzarder-reference-20260921/references/
//   15-block-xref.md(BCC/197 BCO/277 BNM/586 BRM/129 BRN/343 EAR/54 XCX/472 Q1/166 QWB/238),
//   17-plot-save.md(IB/175), 18-etc.md(CV/307), 01-setup.md(STT/194 OL/109 xiSetup/299)
// 를 먼저 읽고, 각 절 끝 원문(izzarder.com/NNN)을 WebFetch로 13개 전부 직접 다시 읽어 대조했다(정리본
// "제작 방법"은 추정이라 근거로 삼지 않고, 대화상자 항목·조작 순서만 원문 기준으로 옮겼다). M2B(다중삽입된
// 블럭을 일반블럭으로 변경)만 정리본·izzarder.com 검색(WebSearch) 모두에서 원문 게시글을 찾지 못해, 카탈로그
// 라벨("다중삽입된 블럭을 일반블럭으로 변경 — 여전히 블럭 상태 유지")과 바른 CAD 엔진 구조로 최선 추정 구현했다.
//
// 검증 보고서(reports/2차_매핑검증_B_보고_20260921.md)가 이미 밝힌 대로 이 15개는 전부 기존 바른 CAD 리습 이름
// 매핑(BCC→LAYER, BCO→EXPLODE 등)이 "이름만" 같고 동작이 다르거나 없다. 이 모듈은 그 매핑을 대신해 실제
// 바른 CAD 리습 조작감에 맞는 카드를 만든다.
//
// 바른 CAD 블록 구조(engine.js 확인, block-tools.js·block-xref-tools.js 서술과 동일): 블록의 자식은
// entity.entities 에 절대좌표로 그대로 담긴다(block.create 는 structuredClone 만 하고 좌표를 옮기지 않는다).
// AutoCAD처럼 모든 인스턴스가 하나의 정의를 실시간 공유하지 않고(각 인스턴스가 독립 사본), "압축 공유 블록"
// (entity.sharedBlock)만 성능 최적화용 진짜 공유 구조다 — M2B 는 이 구조를 "다중삽입"에 대응시켰다.
// nentsel 같은 블록 속 낱개 서브객체 선택이 없어(pickEntity 는 항상 최상위 객체만 반환), BCO·BRM 은 블록
// 내부를 번호 매긴 목록으로 명령창에 띄우고 번호로 고르는 방식으로 만들었다(기존 REFEDIT 블록 편집창의
// 인덱스 방식과 같은 절충).
//
// cardContext 에는 파일·폴더 접근(api/output)이 전혀 없다(문서에도 명시). Q1(블럭 창고: 폴더 썸네일 탐색),
// QWB(WBLOCK: 새 dwg 저장), IB(여러 외부 파일을 모아 삽입), OL(폴더의 dwg 목록 열기)은 전부 파일 시스템을
// 다루므로 "없음" 카드로 정직하게 남긴다. xiSetup(설치 수준 전역 환경설정)도 카드 하나가 다룰 범위가 아니다.
import * as G from './geometry.js';
import { normalizeDimStyles } from './dimension-style.js';
import {STD_LAYERS} from './card-kit.js';
import {isChecked} from './card-input.js';

/* ── 켜 이름 와일드카드(BCC 제외 켜). block-xref-tools.js 의 layerWildcardMatch 와 같은 로직이지만
   규칙(4절)상 자기 모듈끼리도 서로 import 하지 않으므로 작게 다시 둔다. ── */
export function layerWildcardMatch(pattern, name) {
 const list = String(pattern || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
 if (!list.length) return false;
 return list.some(pat => new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i').test(name));
}

/* ── 같은 이름의 블록 인스턴스 찾기(BRM 적용범위 전체·BRN 적용범위 전체 공용). 표·외부참조는 뺀다. ── */
export function matchingBlockIds(entities, name) {
 if (!name) throw Error('블록 이름이 없습니다.');
 return (entities || []).filter(e => e.type === 'block' && !e.table && !e.xref && e.name === name).map(e => e.id);
}

/* ── 블록 기준점(BNM 이름표 위치): position 이 있으면 그 값, 없으면 범위 중심. ── */
export function blockAnchor(entity) {
 if (entity?.type !== 'block') throw Error('블록만 선택할 수 있습니다.');
 if (entity.position) return { x: entity.position.x, y: entity.position.y };
 const b = G.bounds([entity]);
 if (!b) throw Error('블록 범위를 계산할 수 없습니다(내부가 비어 있습니다 · 공유 블록이면 먼저 독립시키세요).');
 return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/* ── BCO·BRM 공용: 블록 내부를 재귀적으로 번호 매긴 평평한 목록으로 만든다(깊이 제한 6단계).
   pickEntity 가 서브객체를 못 짚어주므로, 명령창에 번호를 띄우고 번호로 고르는 방식의 바탕이 된다. ── */
export function flattenBlockChildren(block, { maxDepth = 6 } = {}) {
 if (block?.type !== 'block') throw Error('블록을 선택하세요.');
 const rows = [];
 const walk = (list, path, depth) => {
  (list || []).forEach((e, i) => {
   const p = [...path, i];
   rows.push({ path: p, depth, entity: e });
   if (depth < maxDepth && Array.isArray(e.entities)) walk(e.entities, p, depth + 1);
  });
 };
 walk(block.entities, [], 0);
 return rows;
}
export function describeChildRow(row) {
 const e = row.entity;
 const label = e.type + (e.name ? ' "' + e.name + '"' : '') + (e.text != null ? ' "' + e.text + '"' : '');
 return '  '.repeat(row.depth) + label;
}
function getChildAt(list, path) {
 let cur = list, node = null;
 for (const i of path) { node = cur?.[i]; if (!node) throw Error('명령창 번호에 해당하는 객체를 찾을 수 없습니다.'); cur = node.entities; }
 return node;
}

/* ── BCO: 내부 객체를 위치 유지한 채 밖으로 "복사"해 꺼낸다(원본 블록 정의는 그대로 유지 — 과제 지시와
   xiBlkCopyDefinition 이라는 원문 명령 실제이름 모두 복사 쪽을 가리켜, 삭제가 아닌 복사로 판단했다).
   자식 좌표가 이미 절대좌표이므로 변환 없이 그대로 클론하면 된다. ── */
export function extractChildAtPath(block, path) {
 if (block?.type !== 'block') throw Error('블록을 선택하세요.');
 if (!Array.isArray(path) || !path.length) throw Error('꺼낼 항목을 고르세요.');
 const node = getChildAt(block.entities, path);
 const clone = structuredClone(node);
 delete clone.id;
 return clone;
}

/* ── BRM: 경로 목록으로 내부 객체를 지운다. 제거 순서에 상관없이 정확히 동작하도록, 인덱스가 아니라
   "경로 문자열 집합"으로 걸러내며 재구성한다(먼저 지운 형제 때문에 남은 경로의 인덱스가 밀리는 문제 방지). ── */
export function removeChildrenAtPaths(block, paths) {
 if (block?.type !== 'block') throw Error('블록을 선택하세요.');
 if (!Array.isArray(paths) || !paths.length) throw Error('지울 항목을 선택하세요.');
 const targets = new Set(paths.map(p => p.join('.')));
 const rebuild = (list, prefix) => (list || [])
  .map((e, i) => ({ e, key: prefix ? prefix + '.' + i : String(i) }))
  .filter(({ key }) => !targets.has(key))
  .map(({ e, key }) => Array.isArray(e.entities) ? { ...e, entities: rebuild(e.entities, key) } : e);
 const entities = rebuild(block.entities, '');
 if (!entities.length) throw Error('블록 내부가 모두 지워집니다. 하나 이상은 남겨야 합니다.');
 return { ...block, entities };
}

/* ── BCC: 블록 내부(재귀적으로 모든 하위 객체)의 켜·색을 조건에 맞게 바꾼다.
   원문의 "치수·지시선도 포함"·"내부블럭 폭파 후 변경"·"특정 객체 삭제"·"솔리드 제외"·선변경·선종류축척은
   뺐다(보고서 "아직 없는 것" 참고). 켜·색 변경과 "내부의 블럭 객체만 적용"·제외 켜·꺼짐/얼림 제외만 옮겼다. ── */
export function restyleBlockInterior(block, layerById, opts = {}) {
 if (block?.type !== 'block') throw Error('블록만 켜·색을 바꿀 수 있습니다.');
 if (block.xref) throw Error('외부참조는 원본 보호를 위해 켜·색을 바꿀 수 없습니다. XREF 관리자를 쓰세요.');
 const { layer = null, color = null, excludeLayers = '', excludeHidden = false, innerBlocksOnly = false } = opts;
 if (!layer && !color) throw Error('바꿀 항목(켜 또는 색)을 하나 이상 선택하세요.');
 if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw Error('변경색은 #RRGGBB 형식입니다.');
 const shouldApply = e => {
  const lyr = layerById.get(e.layer);
  if (excludeHidden && lyr && (lyr.visible === false || lyr.frozen)) return false;
  if (excludeLayers && layerWildcardMatch(excludeLayers, lyr?.name || '')) return false;
  if (innerBlocksOnly && e.type !== 'block') return false;
  return true;
 };
 const visit = list => (list || []).map(e => {
  const next = shouldApply(e) ? { ...e, ...(layer ? { layer } : {}), ...(color ? { color } : {}) } : { ...e };
  if (Array.isArray(e.entities)) next.entities = visit(e.entities);
  return next;
 });
 return { ...block, entities: visit(block.entities) };
}

/* ── BRN: 블록 이름 바꾸기(간편모드). ── */
export function renameBlockName(block, newName) {
 if (block?.type !== 'block') throw Error('블록만 이름을 바꿀 수 있습니다.');
 const name = String(newName || '').trim();
 if (!name) throw Error('새 이름을 입력하세요.');
 return { ...block, name };
}
/* ── BRN 전체모드: 접두어+바탕이름+일련번호+접미어 조합으로 count 개의 이름을 만든다. ── */
export function buildSerialNames(base, { prefix = '', suffix = '', numbered = false, start = 1, digits = 3 } = {}, count) {
 const b = String(base || '').trim();
 if (!b) throw Error('바탕 이름을 입력하세요.');
 if (!Number.isInteger(count) || count < 1) throw Error('적용할 블록이 없습니다.');
 const list = [];
 for (let i = 0; i < count; i++) {
  const seq = numbered ? String(Math.max(1, Number(start) || 1) + i).padStart(Math.max(1, Number(digits) || 1), '0') : '';
  list.push(String(prefix || '') + b + seq + String(suffix || ''));
 }
 return list;
}

/* ── BNM: 선택한 블록마다 삽입점 옆에 이름 문자를 만든다. ── */
export function blockNameMarkTexts(list, { layer, size = 3, gap = 3, position = 'below' } = {}) {
 if (!Array.isArray(list) || !list.length) throw Error('이름표를 붙일 블록을 선택하세요.');
 if (!layer) throw Error('켜를 지정하세요.');
 if (!(size > 0) || !(gap >= 0)) throw Error('문자 크기·간격은 양수여야 합니다.');
 const sign = position === 'above' ? 1 : -1;
 return list.map(e => {
  const p = blockAnchor(e);
  return { type: 'text', layer, text: e.name || '(이름 없음)', position: { x: p.x, y: p.y + sign * gap }, height: size };
 });
}

/* ── M2B: "다중삽입"에 대응하는 유일한 엔진 구조는 압축 공유 블록(entity.sharedBlock)뿐이다(원문 게시글을
   찾지 못해 카탈로그 라벨과 엔진 구조로 추정 구현 — 보고서 참고). 공유를 풀어도 여전히 블록(type:'block')
   이라 "여전히 블럭 상태 유지"라는 원문 라벨과 들어맞는다. ── */
export function sharedBlockEntities(entities) {
 return (entities || []).filter(e => e.type === 'block' && e.sharedBlock);
}

/* ── XCX: XCLIP 경계 안쪽(Window)/걸치는(Crossing) 자식만 남겨 실제 최상위 객체로 만든다.
   원문의 "각 객체 절단 방식"(선을 실제로 자르는 TRIM)은 만들지 못했고(geometry.js 에 임의 다각형 대 임의
   객체의 절단 함수가 없음), "블럭 삽입 방식"(경계 안쪽 객체만 골라 즉시 폭파)만 구현했다 — 원문에도 이
   모드가 기본값이다. G.clipContains 가 clip.inverted 를 이미 반영해준다. ── */
function boundsCorners(b) { return [{ x: b.minX, y: b.minY }, { x: b.minX, y: b.maxY }, { x: b.maxX, y: b.minY }, { x: b.maxX, y: b.maxY }]; }
export function entityWithinClip(entity, clip, mode = 'crossing') {
 const b = G.bounds([entity]);
 if (!b) return false;
 const flags = boundsCorners(b).map(p => G.clipContains(clip, p));
 return mode === 'window' ? flags.every(Boolean) : flags.some(Boolean);
}
export function xclipExtractPlan(block, mode = 'crossing') {
 if (block?.type !== 'block') throw Error('블록만 대상으로 할 수 있습니다.');
 if (!block.clip || !block.clip.enabled) throw Error('XCLIP으로 자른 블록이 아닙니다. 먼저 XCLIP으로 경계를 지정하세요.');
 const kept = (block.entities || [])
  .filter(e => entityWithinClip(e, block.clip, mode))
  .map(e => { const c = structuredClone(e); delete c.id; if (!c.layer) c.layer = block.layer; return c; });
 if (!kept.length) throw Error('경계 안에 남는 객체가 없습니다.');
 return { kept, droppedCount: (block.entities || []).length - kept.length };
}

/* ── CV: 원문 표(izzarder.com/307)대로 객체 타입별 반영 항목이 다르다. 카드가 바꿀 수 있는 "현재값"은
   ctx.setActiveLayer(현재 켜) 하나뿐이다(TextStyle·DimStyle·FilletRad·Thickness·HPName·HPScale 은
   cardContext 에 저장소나 setter 가 없음). 해치는 원문 표에도 켜가 반영 대상이 아니라 layer 를 비워 둔다. ── */
export function currentValueFromEntity(entity) {
 if (!entity) throw Error('참조할 객체를 선택하세요.');
 const UNSUPPORTED = {
  text: ['TextStyle', 'TextSize'],
  dimension: ['DimStyle', 'TextStyle'],
  circle: ['FilletRad'],
  arc: ['FilletRad'],
  polyline: ['Thickness'],
  hatch: ['HPName', 'HPScale'],
 };
 return { layer: entity.type === 'hatch' ? null : entity.layer, unsupported: UNSUPPORTED[entity.type] || [] };
}

/* ── STT: "켜 생성" 그룹만 실동작으로 옮긴다(축척 반영·참조파일에서 문자/치수/표 모양 가져오기·도곽블럭
   삽입은 카드에 파일 접근·도면 축척 설정 권한이 없어 만들 수 없음 — 보고서 참고). 원문 예시 행(CEN/DIM/
   DIMLD/H/HAT, 5개)의 자리에 카드 규칙 6절 표준 켜 이름을 대응시켰다. ── */
export function standardLayerPreset() {
 return ['A-WALL-C','A-DIM','A-TEXT','A-SYM','A-HATCH'].map(name=>({...standardLayerForName(name)}));
}

/* ── 카드 진입점. ── */
export function installBlockEditTools(ctx) {
 const guard = fn => async (...args) => { try { await fn(...args); } catch (e) { console.error('[card]', e); ctx.toast(ctx.userErrorMessage(e), true); } };
 async function pickBlock(prompt) {
  let target = ctx.selected().find(e => e.type === 'block' && !e.table);
  if (!target) target = await ctx.pickEntity({ prompt: prompt + ' · Esc 취소', types: ['block'] });
  if (!target) return null;
  if (target.table) throw Error('표(TABLE) 블록은 대상이 아닙니다.');
  if (target.sharedBlock) { ctx.execute({ type: 'shared.materialize', ids: [target.id] }); target = ctx.entities().find(e => e.id === target.id); }
  return target;
 }

 async function bcc() {
  const target = await pickBlock('켜·색을 바꿀 블록을 클릭하세요');
  if (!target) return;
  if (target.xref) throw Error('외부참조는 원본 보호를 위해 켜·색을 바꿀 수 없습니다. XREF 관리자를 쓰세요.');
  const layers = ctx.layers(), layerById = new Map(layers.map(l => [l.id, l]));
  ctx.form('BCC · 블럭 내부 객체 색,켜변경', [
   { name: 'layerOn', label: '켜 변경', type: 'checkbox', value: 'on' },
   { name: 'layer', label: '바꿀 켜', value: target.layer, options: layers.map(l => [l.id, l.name]) },
   { name: 'includeOuter', label: '겉 켜도 함께 변경', type: 'checkbox', value: '' },
   { name: 'colorOn', label: '색 변경', type: 'checkbox', value: '' },
   { name: 'color', label: '변경색 (#RRGGBB)', value: '#ff0000' },
   { name: 'innerBlocksOnly', label: '블럭 내부의 블럭 객체만 적용', type: 'checkbox', value: '' },
   { name: 'excludeHidden', label: '꺼지거나 얼려진 켜 제외', type: 'checkbox', value: '' },
   { name: 'excludeLayers', label: '제외 켜(와일드카드, 콤마로 여러 개)', value: '' },
  ], values => {
   const opts = {
    layer: values.layerOn === 'on' ? values.layer : null,
    color: values.colorOn === 'on' ? values.color : null,
    excludeLayers: values.excludeLayers,
    excludeHidden: values.excludeHidden === 'on',
    innerBlocksOnly: values.innerBlocksOnly === 'on',
   };
   const updated = restyleBlockInterior(target, layerById, opts);
   const { id, type, ...changes } = updated;
   if (values.includeOuter === 'on' && opts.layer) changes.layer = opts.layer;
   ctx.execute({ type: 'update', ids: [target.id], changes });
   ctx.refresh();
   ctx.toast('BCC · 블록 "' + (target.name || '') + '" 내부 객체의 켜·색을 바꿨습니다.');
  });
 }

 async function bco() {
  const target = await pickBlock('내부 객체를 꺼낼 블록을 클릭하세요');
  if (!target) return;
  const rows = flattenBlockChildren(target);
  if (!rows.length) throw Error('블록 내부가 비어 있습니다.');
  rows.forEach((row, i) => ctx.log('BCO · ' + (i + 1) + ') ' + describeChildRow(row)));
  ctx.form('BCO · 블럭내부 객체 꺼내기 · 명령창의 번호를 참고하세요', [
   { name: 'index', label: '꺼낼 번호(명령창 목록)', type: 'number', value: 1 },
  ], values => {
   const i = Number(values.index);
   if (!Number.isInteger(i) || i < 1 || i > rows.length) throw Error('명령창에 나온 번호 중 하나를 입력하세요.');
   const clone = extractChildAtPath(target, rows[i - 1].path);
   if (!clone.layer) clone.layer = target.layer;
   ctx.execute({ type: 'addMany', entities: [clone] });
   ctx.refresh();
   ctx.toast('BCO · "' + describeChildRow(rows[i - 1]).trim() + '"을(를) 블록 밖으로 복사했습니다(원본 블록 정의는 그대로입니다).');
  });
 }

 function bnm() {
  const list = ctx.selected().filter(e => e.type === 'block' && !e.table);
  if (!list.length) throw Error('이름을 표시할 블록을 먼저 선택하세요.');
  ctx.form('BNM · 블럭이름 쓰기', [
   { name: 'position', label: '문자 위치', value: 'below', options: [['below', '삽입점 아래'], ['above', '삽입점 위']] },
   { name: 'size', label: '문자 크기', type: 'number', value: 3 },
   { name: 'gap', label: '문자 간격', type: 'number', value: 3 },
  ], values => {
   const layer = ctx.ensureLayer(STD_LAYERS.symb, '#ff9f68');
   const texts = blockNameMarkTexts(list, { layer, size: Number(values.size), gap: Number(values.gap), position: values.position });
   ctx.execute({ type: 'addMany', entities: texts });
   ctx.refresh();
   ctx.toast('BNM · 블록 ' + list.length + '개에 이름표를 붙였습니다(원문 기본값 Defpoints 대신, 표준 켜 규칙에 따라 A-SYM에 넣었습니다).');
  });
 }

 async function brm() {
  const target = await pickBlock('내부 객체를 지울 블록을 클릭하세요');
  if (!target) return;
  if (target.xref) throw Error('외부참조는 내부 객체를 지울 수 없습니다.');
  const rows = flattenBlockChildren(target);
  if (!rows.length) throw Error('블록 내부가 비어 있습니다.');
  const sameName = matchingBlockIds(ctx.entities(), target.name);
  rows.forEach((row, i) => ctx.log('BRM · ' + (i + 1) + ') ' + describeChildRow(row)));
  ctx.form('BRM · 블럭 내부 객체 삭제 · 명령창의 번호를 참고하세요("내부블럭(B)"은 위 목록에서 block 항목만 골라 입력하면 됩니다)', [
   { name: 'indexes', label: '지울 번호(콤마로 여러 개)', value: '' },
   { name: 'scope', label: '적용 범위', value: sameName.length > 1 ? 'all' : 'one', options: [['all', '같은 이름 블록 전체 (' + sameName.length + '개, 구조가 같은 것만)'], ['one', '선택한 블록만']] },
  ], values => {
   const nums = String(values.indexes).split(/[,\s]+/).filter(Boolean).map(Number);
   if (!nums.length) throw Error('지울 번호를 입력하세요.');
   for (const n of nums) if (!Number.isInteger(n) || n < 1 || n > rows.length) throw Error('명령창 번호를 확인하세요(' + n + ').');
   const paths = nums.map(n => rows[n - 1].path);
   const ids = values.scope === 'all' ? sameName : [target.id];
   const fresh = ctx.entities();
   let skipped = 0;
   const commands = [];
   for (const id of ids) {
    const e = fresh.find(x => x.id === id);
    if (!e) { skipped++; continue; }
    const eRows = flattenBlockChildren(e);
    if (eRows.length !== rows.length) { skipped++; continue; }
    const { id: _id, type: _type, ...changes } = removeChildrenAtPaths(e, paths);
    commands.push({ type: 'update', ids: [id], changes });
   }
   if (!commands.length) throw Error('삭제를 적용할 블록이 없습니다(구조가 달라 건너뛰었습니다).');
   ctx.execute({ type: 'batch', commands });
   ctx.refresh();
   ctx.toast('BRM · 블록 ' + commands.length + '개에서 내부 객체 ' + paths.length + '개를 지웠습니다.' + (skipped ? ' (구조가 달라 ' + skipped + '개는 건너뜀)' : ''));
  });
 }

 async function brn() {
  const target = await pickBlock('이름을 바꿀 블록을 클릭하세요');
  if (!target) return;
  const sameName = matchingBlockIds(ctx.entities(), target.name);
  ctx.form('BRN · 블럭 이름 변경하기', [
   { name: 'mode', label: '모드', value: 'simple', options: [['simple', '간편모드(이름 한 칸)'], ['full', '전체모드(접두/접미/일련번호)']] },
   { name: 'name', label: '새 이름(간편모드) · 전체모드에서는 바탕 이름', value: target.name || '' },
   { name: 'prefix', label: '접두어(전체모드)', value: '' },
   { name: 'suffix', label: '접미어(전체모드)', value: '' },
   { name: 'numbered', label: '일련번호 넣기(전체모드)', type: 'checkbox', value: '' },
   { name: 'start', label: '시작 번호(전체모드)', type: 'number', value: 1 },
   { name: 'digits', label: '번호 자리수(전체모드)', type: 'number', value: 3 },
   { name: 'scope', label: '적용 범위', value: 'one', options: [['one', '선택한 블록만'], ['all', '같은 이름 전체 (' + sameName.length + '개)']] },
  ], values => {
   const ids = values.scope === 'all' ? sameName : [target.id];
   if (!ids.length) throw Error('적용할 블록이 없습니다.');
   const fresh = ctx.entities();
   let commands;
   if (values.mode === 'simple') {
    const { id, type, ...changes } = renameBlockName(target, values.name);
    commands = ids.map(bid => ({ type: 'update', ids: [bid], changes }));
   } else {
    const names = buildSerialNames(values.name || target.name, { prefix: values.prefix, suffix: values.suffix, numbered: values.numbered === 'on', start: Number(values.start), digits: Number(values.digits) }, ids.length);
    commands = ids.map((bid, i) => {
     const e = fresh.find(x => x.id === bid);
     const { id, type, ...changes } = renameBlockName(e, names[i]);
     return { type: 'update', ids: [bid], changes };
    });
   }
   ctx.execute({ type: 'batch', commands });
   ctx.refresh();
   ctx.toast('BRN · 블록 ' + ids.length + '개의 이름을 바꿨습니다.');
  });
 }

 async function ear() {
  const target = await pickBlock('폭파할 속성블럭을 클릭하세요');
  if (!target) return;
  ctx.execute({ type: 'explode', ids: [target.id] });
  ctx.refresh();
  ctx.toast('EAR · 블록을 폭파했습니다. 바른 CAD는 블록 속 문자가 항상 화면에 보이는 실제 값 그대로 저장돼 있어(속성정의·기본값을 따로 두는 구조가 없음) 일반 폭파로도 문자 내용이 그대로 유지됩니다.');
 }

 function m2b() {
  const selected = ctx.selected().filter(e => e.type === 'block');
  if (!selected.length) throw Error('일반 블록으로 바꿀 블록을 먼저 선택하세요.');
  const ids = sharedBlockEntities(selected).map(e => e.id);
  if (!ids.length) { ctx.toast('M2B · 선택한 블록은 이미 독립된 일반 블록입니다(바른 CAD에는 MINSERT 같은 다중삽입 개체가 따로 없고, "압축 공유 블록"만 이와 비슷한 성능 최적화 구조입니다).'); return; }
  ctx.execute({ type: 'shared.materialize', ids });
  ctx.refresh();
  ctx.toast('M2B · 압축 공유 블록 ' + ids.length + '개를 독립된 일반 블록으로 바꿨습니다(여전히 블록 상태 유지).');
 }

 async function xcx() {
  const target = await pickBlock('XCLIP된 블록을 클릭하세요');
  if (!target) return;
  if (!target.clip || !target.clip.enabled) throw Error('XCLIP으로 자른 블록이 아닙니다. 먼저 XCLIP으로 경계를 지정하세요.');
  if (target.xref) throw Error('외부참조는 먼저 XREF 관리자에서 결합(Bind)한 뒤 실행하세요(원문의 "외부참조 결합 방법"에 해당).');
  ctx.form('XCX · Xclip 폭파 후 정리 · "블럭 삽입 방식"만 지원', [
   { name: 'mode', label: '작동방식', value: 'crossing', options: [['crossing', '걸치는 객체 포함(Crossing)'], ['window', '완전히 안쪽 객체만(Window)']] },
  ], values => {
   const plan = xclipExtractPlan(target, values.mode);
   ctx.execute({ type: 'batch', commands: [{ type: 'delete', ids: [target.id] }, { type: 'addMany', entities: plan.kept }] });
   ctx.refresh();
   ctx.toast('XCX · 경계 안쪽 객체 ' + plan.kept.length + '개를 실제 객체로 전환했습니다(경계 밖 ' + plan.droppedCount + '개 제거). 선을 실제로 자르는 "각 객체 절단 방식"은 지원하지 않고, 객체 단위 포함/제외만 지원합니다.');
  });
 }

 async function cv() {
  const e = await ctx.pickEntity({ prompt: '현재값으로 반영할 객체를 클릭하세요 · Esc 취소' });
  if (!e) return;
  const info = currentValueFromEntity(e);
  let msg;
  if (info.layer) {
   ctx.setActiveLayer(info.layer);
   const name = ctx.layers().find(l => l.id === info.layer)?.name || info.layer;
   msg = 'CV · 현재 켜를 "' + name + '"로 맞췄습니다.';
  } else {
   msg = 'CV · 이 객체 타입은 원문 표에도 켜가 반영 대상이 아니라 켜는 바꾸지 않았습니다.';
  }
  if (info.unsupported.length) msg += ' (' + info.unsupported.join('/') + '는 cardContext에 "현재값" 저장소가 없어 반영하지 못했습니다.)';
  ctx.toast(msg);
 }

 /* STT(izzarder.com/194) 도면 초기설정. 2026-09-24 검토 F13: 예전에는 표준 켜 5개만 만들고 나머지는 "없다"고 안내했다.
    원문 대화상자의 네 그룹을 바른 CAD 문서 구조 안에서 실제로 적용한다.
    [도면/도곽 축척] 1/n → 선축척(doc.linetypeScale)·치수축척(현재 치수모양 STANDARD 의 문자높이·화살표·간격을 1/100 기준값 × n/100 으로)
    [문자/치수/표 모양] 기준 파일에서 가져오기 → STL 카드(다른 도면에서 가져오기)로 잇는다
    [도곽블럭] 도곽 지정 → 기존 SHEET 명령(도곽 지정 대화상자)을 이어서 연다
    [켜 생성] 표준 켜 5개(A-WALL-C CENTER 등) */
 /* 축척 반영 계획(검토자 지적 2·3 반영). 치수모양은 문자높이·화살표 등 "값"은 그대로 두고 scale(=n/100)만 바꾼다 —
    geometry.js dimensionParts 가 textHeight×scale 로 그리므로 값까지 곱하면 제곱이 된다. 선축척은 view.js 가 화면 픽셀 파선에 곱하고
    100 에서 잘라내므로(view.js:94) 큰 값은 파선이 실선처럼 보인다 → 기본 끔·안내. */
 function sttScalePlan(doc, denominator, { lineScale = false, dimScale = false } = {}) {
  const changes = {};
  if (lineScale) changes.linetypeScale = denominator;
  if (dimScale) {
   const normalized = normalizeDimStyles(doc || {});
   const current = normalized.currentDimStyle || 'STANDARD';
   changes.dimStyles = { ...normalized.dimStyles, [current]: { ...normalized.dimStyles[current], scale: denominator / 100 } };
   changes.currentDimStyle = current;
  }
  return changes;
 }
 function currentDocument() {
  try { const d = typeof ctx.document === 'function' ? ctx.document() : globalThis.window?.cad?.getDocument?.(); if (d) return d; } catch { /* 문서 접근 없음 */ }
  return { dimStyles: {}, currentDimStyle: 'STANDARD', linetypeScale: 1 };
 }
 async function stt() {
  const existing = new Set(ctx.layers().map(l => l.name));
  const preset = standardLayerPreset().filter(p => !existing.has(p.name));
  const doc = currentDocument();
  const nowDim = normalizeDimStyles(doc), nowStyle = nowDim.dimStyles[nowDim.currentDimStyle] || {}, nowLt = Number(doc.linetypeScale) || 1;
  const v = await new Promise(resolve => ctx.form('STT · 도면 초기설정 (izzarder.com/194)', [
   { name: 'denominator', label: '[도면/도곽 축척] 1 / ', type: 'number', value: 100 },
   { name: 'lineScale', label: `선축척에 반영 (현재 ${nowLt} → 입력한 분모 · 화면 파선 간격이 그만큼 커져 크게 잡으면 실선처럼 보입니다 · 기본 끔)`, type: 'checkbox', value: '' },
   { name: 'dimScale', label: `치수축척에 반영 (치수모양 "${nowDim.currentDimStyle}" 의 배율 ${nowStyle.scale ?? 1} → 분모/100 · 문자높이 ${nowStyle.textHeight ?? 150} 등 값은 그대로 · 기본 끔)`, type: 'checkbox', value: '' },
   { name: 'steal', label: '[문자/치수/표 모양] 기준 파일에서 가져오기 (STL 카드로 이어서 파일 선택)', type: 'checkbox', value: '' },
   { name: 'sheet', label: '[도곽블럭]', value: 'none', options: [['none', '삽입 안함'], ['sheet', '도곽 지정 대화상자 열기(SHEET · A0~A4 선택)']] },
   { name: 'layers', label: `[켜 생성] 표준 켜 만들기 (없는 켜 ${preset.length}개)`, type: 'checkbox', value: preset.length ? 'on' : '' },
  ], async values => { resolve(values); }));
  const denominator = Number(v.denominator);
  if (!Number.isFinite(denominator) || denominator <= 0) throw Error('축척 분모는 0보다 큰 숫자로 입력하세요(예: 100).');
  if (denominator > 100000) throw Error('축척 분모는 100,000 이하로 입력하세요.');
  const done = [];
  const lineScale = isChecked(v.lineScale), dimScale = isChecked(v.dimScale); // 화면 'on' · AI 연결 true 둘 다
  if (lineScale || dimScale) {
   const changes = sttScalePlan(doc, denominator, { lineScale, dimScale });
   ctx.execute({ type: 'document.update', changes });
   if (lineScale) done.push(`선축척 ${nowLt} → ${denominator}`);
   if (dimScale) done.push(`치수축척 배율 ${nowStyle.scale ?? 1} → ${denominator / 100}`);
  }
  if (isChecked(v.layers) && preset.length) {
   ctx.execute({ type: 'batch', commands: preset.map(p => ({ type: 'layer.add', name: p.name, color: p.color })) });
   const byName = new Map(ctx.layers().map(l => [l.name, l.id]));
   const withLinetype = preset.filter(p => p.linetype && p.linetype !== 'CONTINUOUS' && byName.has(p.name));
   if (withLinetype.length) ctx.execute({ type: 'batch', commands: withLinetype.map(p => ({ type: 'layer.update', id: byName.get(p.name), changes: { linetype: p.linetype } })) });
   done.push(`표준 켜 ${preset.length}개`);
  } else if (v.layers === 'on') done.push('표준 켜는 이미 모두 있음');
  ctx.refresh();
  // ctx.run 은 기다려 주지 않으므로(app.js run) 이어지는 명령은 하나만 연다(검토자 지적 12).
  const next = v.steal === 'on' ? 'STL' : v.sheet === 'sheet' ? 'SHEET' : null;
  const both = v.steal === 'on' && v.sheet === 'sheet';
  ctx.toast(`STT · ${done.length ? done.join(' · ') : '바꾼 설정 없음'}${next === 'STL' ? ' · 이어서 기준 파일을 고릅니다(STL)' : ''}${next === 'SHEET' ? ' · 이어서 도곽 지정(SHEET)을 엽니다' : ''}${both ? ' · STL 을 마친 뒤 SHEET 를 직접 실행하세요' : ''}`);
  if (next) await ctx.run(next);
 }

 return {
  BCC: guard(bcc),
  BCO: guard(bco),
  BNM: guard(bnm),
  BRM: guard(brm),
  BRN: guard(brn),
  EAR: guard(ear),
  M2B: guard(m2b),
  XCX: guard(xcx),
  CV: guard(cv),
  STT: guard(stt),
 };
}
