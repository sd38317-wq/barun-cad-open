// 504 TEXT 자리맞추기 15종(L C R A M F TL TC TR ML MC MR BL BC BR)과 맞춤점.
//
// AutoCAD 는 맞춤점(11)과 수평·수직 모드(72/73)를 저장하고 시작점(10)을 글꼴로 다시 계산한다.
// 바른 CAD 화면은 position(기준선 위 점) + align(left/center/right)만으로 그리므로, 맞춤 정보(justify·alignPoint)를
// 따로 저장하고 position 은 그 맞춤점에서 계산한 결과로 둔다 → 그리기 경로는 그대로이고(비용 0),
// 높이·회전·내용을 바꿔도 reanchorJustifiedText 로 맞춤점이 고정된다. DXF 로 쓸 때 72/73/11 을 그대로 돌려준다.
import * as G from './geometry.js';

/** 자리맞추기 이름 → [수평(화면 align), 수직, DXF 72, DXF 73]. */
export const TEXT_JUSTIFY = Object.freeze({
 L: ['left', 'baseline', 0, 0], C: ['center', 'baseline', 1, 0], R: ['right', 'baseline', 2, 0],
 A: ['center', 'baseline', 3, 0], M: ['center', 'middle', 4, 0], F: ['center', 'baseline', 5, 0],
 BL: ['left', 'bottom', 0, 1], BC: ['center', 'bottom', 1, 1], BR: ['right', 'bottom', 2, 1],
 ML: ['left', 'middle', 0, 2], MC: ['center', 'middle', 1, 2], MR: ['right', 'middle', 2, 2],
 TL: ['left', 'top', 0, 3], TC: ['center', 'top', 1, 3], TR: ['right', 'top', 2, 3],
});
/** 글자 아래 내림 높이(높이 배수). 아래(B*) 맞춤은 내림 끝이 맞춤점에 온다. */
export const TEXT_DESCENT = 0.25;
/** 맞춤점에서 기준선까지 내려가는 양(높이 배수, 위쪽 기준 아래로 +). */
const DROP = {baseline: 0, bottom: -TEXT_DESCENT, middle: 0.5, top: 1};

export const isFitJustify = key => key === 'A' || key === 'F';

/** DXF 72/73 → 자리맞추기 이름(모르는 값은 L). */
export function justifyFromDxf(halign = 0, valign = 0) {
 const h = Number(halign) || 0, v = Number(valign) || 0;
 if (h >= 3) return ['L', 'C', 'R', 'A', 'M', 'F'][h] || 'L';
 return Object.keys(TEXT_JUSTIFY).find(k => TEXT_JUSTIFY[k][2] === h && TEXT_JUSTIFY[k][3] === v && k !== 'M') || 'L';
}
/** 자리맞추기 이름 → {halign, valign}(DXF 72/73). */
export function justifyToDxf(key) {
 const j = TEXT_JUSTIFY[key] || TEXT_JUSTIFY.L;
 return {halign: j[2], valign: j[3]};
}

/** 한 줄 문자 폭(높이 1·폭 비율 1 기준). 화면 선택 상자(geometry.js)와 같은 어림을 써서 그린 것과 맞는다. */
const lineUnits = text => Math.max(...String(text ?? '').split('\n').map(G.textLineUnits), 0.65);

/**
 * 맞춤점·자리맞추기 → 화면 위치. 결과는 객체에 그대로 섞어 쓴다({position, align, justify, alignPoint, …}).
 * A(맞춤)·F(채움)는 second(두 번째 끝점)가 필요하다: A 는 폭에 맞게 높이를, F 는 높이를 두고 폭 비율을 정한다.
 */
export function justifiedText({point, second = null, height, rotation = 0, key = 'L', text = '', widthFactor = 1}) {
 const j = TEXT_JUSTIFY[key] ? key : 'L', [align, valign] = TEXT_JUSTIFY[j];
 if (isFitJustify(j)) {
  if (!second || G.dist(point, second) <= G.EPS) throw Error('맞춤·채움 문자는 서로 다른 두 끝점이 필요합니다.');
  const length = G.dist(point, second), units = lineUnits(text), angle = G.angle(G.sub(second, point));
  let h = height, wf = widthFactor || 1;
  if (j === 'A') h = length / (units * wf);
  else wf = length / (units * h);
  return {position: G.mul(G.add(point, second), 0.5), align: 'center', justify: j, alignPoint: {x: point.x, y: point.y}, fitTo: {x: second.x, y: second.y},
   height: h, widthFactor: wf, rotation: angle};
 }
 const drop = DROP[valign] * height;
 const position = drop ? G.add(point, G.polar(drop, (rotation || 0) - 90)) : {x: point.x, y: point.y};
 const out = {position, height, rotation: rotation || 0};
 if (align !== 'left') out.align = align;
 if (j !== 'L') { out.justify = j; out.alignPoint = {x: point.x, y: point.y}; }
 return out;
}

/**
 * 높이·회전·내용·폭 비율이 바뀐 맞춤 문자의 위치를 맞춤점에서 다시 계산한다(맞춤점 고정).
 * 맞춤 정보가 없는 문자(L·예전 문자)는 null — 고칠 것이 없다.
 */
export function reanchorJustifiedText(e) {
 if (e?.type !== 'text' || !e.justify || !e.alignPoint || !TEXT_JUSTIFY[e.justify]) return null;
 const next = justifiedText({point: e.alignPoint, second: e.fitTo, height: e.height, rotation: e.rotation, key: e.justify, text: e.text, widthFactor: e.widthFactor});
 const changes = {};
 for (const k of ['position', 'height', 'widthFactor', 'rotation', 'align']) {
  const a = next[k], b = e[k];
  if (a === undefined) continue;
  const same = typeof a === 'string' ? a === (b ?? 'left')
   : typeof a === 'object' ? Math.abs(a.x - b?.x) < 1e-9 && Math.abs(a.y - b?.y) < 1e-9
   : Math.abs(a - (b ?? (k === 'widthFactor' ? 1 : 0))) < 1e-9;
  if (!same) changes[k] = a;
 }
 return Object.keys(changes).length ? changes : null;
}

const ANCHOR_KEYS = ['height', 'text', 'widthFactor', 'rotation', 'justify', 'alignPoint', 'fitTo'];
const touchesAnchor = changes => !!changes && typeof changes === 'object' && (ANCHOR_KEYS.some(k => k in changes) || 'position' in changes || 'align' in changes);

/**
 * 속성 바꾸기 명령(update·updateMany)에 맞춤점 고정을 더한다. 바뀐 문자만 본다(O(바뀐 객체)).
 * - 높이·내용·회전·폭 비율을 바꾸면 위치를 맞춤점에서 다시 계산한다.
 * - 위치만 직접 옮기면 맞춤점도 같은 만큼 옮긴다(맞춤점이 예전 자리에 남아 문자를 끌어당기지 않게).
 * 맞춤 문자가 없으면 받은 명령을 그대로 돌려준다.
 * @param lookup ids → 객체 배열(엔진 색인)
 */
export function withJustifiedAnchors(command, lookup) {
 const updates = command?.type === 'update' && touchesAnchor(command.changes) ? (command.ids || []).map(id => ({id, changes: command.changes}))
  : command?.type === 'updateMany' && Array.isArray(command.updates) && command.updates.some(u => touchesAnchor(u?.changes)) ? command.updates : null;
 if (!updates?.length) return command;
 const targets = new Map((lookup(updates.map(u => u.id)) || []).filter(e => e?.type === 'text' && e.justify && e.alignPoint).map(e => [e.id, e]));
 if (!targets.size) return command;
 let touched = false;
 const next = updates.map(u => {
  const e = targets.get(u.id); if (!e || !touchesAnchor(u.changes)) return u;
  // 정렬을 직접 바꾸는 명령(TJ 등)은 사용자가 새 기준을 정한 것: 맞춤 정보를 내려놓고 그 결과를 그대로 둔다.
  if ('align' in u.changes && !('justify' in u.changes)) { touched = true; return {id: u.id, changes: {...u.changes, justify: null, alignPoint: null, fitTo: null}}; }
  const merged = {...e, ...u.changes};
  if ('position' in u.changes && !('alignPoint' in u.changes) && u.changes.position && e.position) {
   const dx = u.changes.position.x - e.position.x, dy = u.changes.position.y - e.position.y;
   if (Math.abs(dx) > 1e-12 || Math.abs(dy) > 1e-12) {
    touched = true;
    return {id: u.id, changes: {...u.changes, alignPoint: {x: e.alignPoint.x + dx, y: e.alignPoint.y + dy}, ...(e.fitTo ? {fitTo: {x: e.fitTo.x + dx, y: e.fitTo.y + dy}} : {})}};
   }
   return u;
  }
  const extra = reanchorJustifiedText(merged);
  if (!extra) return u;
  touched = true;
  return {id: u.id, changes: {...u.changes, ...extra}};
 });
 if (!touched) return command;
 const {ids: _ids, changes: _changes, ...rest} = command;
 return {...rest, type: 'updateMany', updates: next};
}

/** 프롬프트에 보일 선택지. */
export const JUSTIFY_PROMPT = 'L·C·R·A(맞춤)·F(채움)·M·TL·TC·TR·ML·MC·MR·BL·BC·BR';
