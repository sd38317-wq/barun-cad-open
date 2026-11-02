// 다중 지시선 + 재료 목록(훈민캐드 대조 기반 H58 · 훈민 NT, AutoCAD MLEADER).
//  MLEADER      화살표 끝 → 꺾이는 점(몇 개든, Enter·우클릭으로 끝) → 재료 [목록에서 고르기 / 직접 입력]. 여러 재료는 줄로 쌓는다.
//  MLEADERLIST  자주 쓰는 재료 목록 편집(추가·삭제·순서·정렬·기본 목록 되돌리기). 저장소 키 'barun-mleader-materials'.
// 결과는 LEADER(workflows.js)와 같은 {type:'block',name:'지시선',entities:[지시선, 화살표, 문자]} 구성이다.
// 첫 객체가 화살표 끝에서 시작하는 폴리선이라 ANNOSCALE 이 화살표 끝을 제자리로 두고 크기를 바꾼다.
// 문자 높이·화살표·착지선(수평 꺾임)은 "용지 mm × 축척" 이라 어느 축척에서도 출력 크기가 같다.
import * as G from './geometry.js';
import {isChecked, boundedNumber} from './card-input.js';
import {STD_LAYERS} from './card-kit.js';
import {dimensionPreview} from './dimension-preview.js';
import {registerManualLabels} from './commands.js';

export const MATERIALS_KEY = 'barun-mleader-materials';
export const OPTIONS_KEY = 'barun-mleader-options';
export const MAX_MATERIALS = 100, MAX_MATERIAL_LENGTH = 80, MAX_NOTE_LINES = 12, MAX_LEADER_POINTS = 30;
export const LINE_SPACING = 1.35;   // 여러 줄 문자 줄 간격(geometry.js·plot.js 와 같은 값)
const HEAD_HALF = 1 / 6;            // 채운·닫힌 화살표 폭 = 길이의 1/3 (AutoCAD 닫힌 화살표 비율)
const GAP = 0.4;                    // 착지선과 문자 사이 = 문자 높이 × 0.4
const CURRENT = '__current__';

export const DEFAULT_MATERIALS = Object.freeze([
 'THK24 복층유리', 'THK12 석고보드 2겹', 'THK9.5 석고보드 위 수성페인트', 'THK9.5 석고보드 위 THK6 흡음텍스',
 '비드법 단열재 가등급 THK100', '압출법 단열재 특호 THK50', 'THK200 콘크리트', 'THK60 무근 콘크리트',
 'THK40 경량기포 콘크리트', 'THK40 시멘트 몰탈 (난방배관)', 'THK10 타일 붙이기', 'THK24 방수몰탈',
 '우레탄 도막방수 THK3', 'THK30 화강석 버너구이', 'THK7.5 강마루', 'THK3 데코타일',
 'THK3 알루미늄 복합패널', 'PE 필름 2겹 깔기',
]);
export const ARROW_OPTIONS = [['filled', '채운 화살표'], ['closed', '속 빈 화살표 (닫힌 삼각형)'], ['open', '열린 화살표 (V)'], ['dot', '채운 점'], ['none', '없음']];
export const ATTACH_OPTIONS = [['above', '착지선 위에 (밑줄형 · 여러 줄은 위로 쌓음)'], ['middle', '착지선 끝 옆 (가운데 맞춤)']];

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** 한 줄에 한 재료. 공백 정리·빈 줄과 중복 제거. 너무 길거나 많으면 막는다. */
export function parseMaterialText(text) {
 const out = [];
 for (const raw of String(text ?? '').split(/\r?\n/)) {
  const item = clean(raw);
  if (!item || out.includes(item)) continue;
  if (item.length > MAX_MATERIAL_LENGTH) throw Error(`"${item.slice(0, 20)}…" 이(가) 너무 깁니다. 한 줄은 ${MAX_MATERIAL_LENGTH}자까지입니다.`);
  out.push(item);
 }
 if (out.length > MAX_MATERIALS) throw Error(`재료 목록은 ${MAX_MATERIALS}개까지입니다.`);
 return out;
}

/** 저장된 목록. 없거나 깨졌거나 비었으면 기본 목록. */
export function loadMaterials(storage) {
 let raw = null;
 try { raw = storage?.getItem(MATERIALS_KEY) ?? null; } catch {}
 if (raw != null) try {
  const list = JSON.parse(raw);
  if (Array.isArray(list)) {
   const items = [...new Set(list.filter(s => typeof s === 'string').map(clean).filter(s => s && s.length <= MAX_MATERIAL_LENGTH))].slice(0, MAX_MATERIALS);
   if (items.length) return items;
  }
 } catch {}
 return [...DEFAULT_MATERIALS];
}

export function saveMaterials(storage, list) {
 const items = parseMaterialText((list || []).join('\n'));
 if (!items.length) throw Error('재료를 하나 이상 남기세요. 처음 목록이 필요하면 [기본 목록으로 되돌리기]를 고르세요.');
 try { storage.setItem(MATERIALS_KEY, JSON.stringify(items)); } catch { throw Error('재료 목록을 저장하지 못했습니다(저장소를 쓸 수 없음).'); }
 return items;
}

/** 목록 끝에 없는 것만 덧붙인다. */
export function addMaterials(list, items) {
 const out = [...list];
 for (const m of items.map(clean)) if (m && !out.includes(m)) out.push(m);
 return out;
}

// 한글·한자·전각은 넓게, 나머지는 geometry.js 문자 경계와 같은 0.65. 밑줄형 착지선 길이를 정하는 데 쓴다.
const WIDE = /[ᄀ-ᇿ⺀-鿿가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
export function estimateTextWidth(text, height) {
 let widest = 0;
 for (const line of String(text ?? '').split('\n')) { let w = 0; for (const ch of line) w += WIDE.test(ch) ? 1.1 : 0.65; widest = Math.max(widest, w); }
 return widest * height;
}

/** 문자가 놓일 쪽: 마지막 점에서 뒤로 가며 처음 x 가 달라지는 점의 반대쪽. 끝까지 같으면 오른쪽(+1). */
export function leaderSide(points) {
 const last = points.at(-1);
 for (let i = points.length - 2; i >= 0; i--) { const dx = last.x - points[i].x; if (Math.abs(dx) > 1e-9) return dx > 0 ? 1 : -1; }
 return 1;
}

/** 화살표 머리(tip 에서 toward 쪽으로 size 길이). filled=닫힌 삼각형+채움, closed=닫힌 삼각형, open=V, dot=채운 점. */
export function arrowHead(tip, toward, size, kind = 'filled') {
 if (kind === 'none') return [];
 if (!ARROW_OPTIONS.some(([k]) => k === kind)) throw Error(`화살표 모양 "${kind}" 을(를) 알 수 없습니다.`);
 if (!(size > 0) || !Number.isFinite(size)) throw Error('화살표 크기는 0보다 커야 합니다.');
 const u = G.unit(G.sub(toward, tip)), n = G.normal(u), at = (along, across) => G.add(tip, G.add(G.mul(u, along), G.mul(n, across)));
 if (kind === 'dot') {
  const r = size / 4;
  return [{type: 'circle', center: {...tip}, radius: r}, {type: 'hatch', points: Array.from({length: 24}, (_, i) => G.add(tip, G.polar(r, i * 15))), pattern: 'solid', solid: true}];
 }
 if (kind === 'open') return [{type: 'polyline', closed: false, points: [at(size, size * 0.3), {...tip}, at(size, -size * 0.3)]}];
 const tri = () => [{...tip}, at(size, size * HEAD_HALF), at(size, -size * HEAD_HALF)];
 return kind === 'filled' ? [{type: 'polyline', closed: true, points: tri()}, {type: 'hatch', points: tri(), pattern: 'solid', solid: true}] : [{type: 'polyline', closed: true, points: tri()}];
}

/**
 * 다중 지시선 블록(레이어 없음). points[0] = 화살표 끝, 이어서 꺾이는 점들. lines = 위에서 아래로 쌓을 재료.
 * attach: 'above'(착지선이 문자 밑줄이 되고 여러 줄은 위로 쌓음) | 'middle'(착지선 끝 옆, 문자 묶음 가운데를 착지선에).
 * 크기는 모두 용지 mm 이고 scale 을 곱해 도면 단위로 쓴다.
 */
export function buildMultiLeader(points, lines, {scale = 100, textPaper = 2.5, arrow = 'filled', arrowPaper = 2.5, landingPaper = 4, attach = 'above', style = null, overrides = null} = {}) {
 if (!(scale > 0) || !Number.isFinite(scale)) throw Error('축척은 0보다 커야 합니다.');
 if (!(textPaper > 0) || !Number.isFinite(textPaper)) throw Error('문자 높이는 0보다 커야 합니다.');
 if (!(landingPaper >= 0) || !Number.isFinite(landingPaper)) throw Error('착지선 길이는 0 이상입니다.');
 if (!ATTACH_OPTIONS.some(([k]) => k === attach)) throw Error(`문자 위치 "${attach}" 을(를) 알 수 없습니다.`);
 const pts = [];
 for (const p of points || []) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw Error('지시선 점 좌표가 올바르지 않습니다.');
  if (!pts.length || G.dist(pts.at(-1), p) > G.EPS) pts.push({x: p.x, y: p.y});
 }
 if (pts.length < 2) throw Error('지시선은 화살표 끝과 다음 점, 서로 다른 두 점 이상이 필요합니다.');
 if (pts.length > MAX_LEADER_POINTS) throw Error(`지시선 점은 ${MAX_LEADER_POINTS}개까지입니다.`);
 const notes = (lines || []).map(clean).filter(Boolean);
 if (!notes.length) throw Error('재료(지시 내용)를 하나 이상 고르거나 입력하세요.');
 if (notes.length > MAX_NOTE_LINES) throw Error(`재료는 ${MAX_NOTE_LINES}줄까지 쌓을 수 있습니다.`);
 const th = textPaper * scale, gap = th * GAP, side = leaderSide(pts), end = pts.at(-1), rows = notes.length, text = notes.join('\n');
 const head = arrowHead(pts[0], pts[1], arrowPaper * scale, arrow);
 let shoulder, position;
 if (attach === 'above') {
  shoulder = Math.max(landingPaper * scale, estimateTextWidth(text, th) + gap * 2);
  position = {x: end.x + side * gap, y: end.y + gap + (rows - 1) * LINE_SPACING * th};
 } else {
  shoulder = landingPaper * scale;
  position = {x: end.x + side * (shoulder + gap), y: end.y - th / 2 + (rows - 1) * LINE_SPACING * th / 2};
 }
 const path = shoulder > G.EPS ? [...pts, {x: end.x + side * shoulder, y: end.y}] : pts;
 const block = {type: 'block', name: '지시선', mleader: true, entities: [
  {type: 'polyline', closed: false, points: path},
  ...head,
  {type: 'text', position, text, height: th, align: side > 0 ? 'left' : 'right', rotation: 0, leader: true},
 ]};
 // 519: 스타일 이름과 재정의만 남긴다(값 전체를 블록마다 복사하지 않는다).
 if (style) { block.mleaderStyle = String(style); if (overrides && Object.keys(overrides).length) block.mleaderOverrides = {...overrides}; }
 return block;
}

/* ══════════ 519 다중 지시선 스타일 · 정렬 · 모으기 ══════════
   AutoCAD: 도면 사전 ACAD_MLEADERSTYLE 에 Standard·주석 스타일, 지시선은 스타일 참조 + 재정의. MLEADERALIGN 은 간격/분배/평행,
   MLEADERCOLLECT 는 블록 내용 지시선을 하나로 모은다.
   우리: 기본 스타일 2개(Standard, 한국 건축 재료 지시용 '건축 재료')는 코드에 두고, 도면이 고친 것만 도면에 둔다
   (projectSettings.mleaderStyles — engine document.update 가 받는 칸. doc.mleaderStyles 가 있으면 그것도 읽는다).
   정렬·모으기는 화살 끝과 화살촉을 그대로 두고 착지점·문자만 옮긴다 — 블록을 다시 만들지 않아 LSE 로 바꾼 화살촉도 남는다.
   모으기는 재료 줄을 한 지시선에 쌓아(중복 줄은 한 번) 재료 목록 지시선을 한 번에 정리한다. */
export const DEFAULT_MLEADER_STYLE = '건축 재료';
export const BUILTIN_MLEADER_STYLES = Object.freeze({
 // AutoCAD acadiso Standard 와 비슷하게: 문자를 착지선 끝 옆 가운데에. textPaper null = 도면 설정의 용지 문자 높이를 따름.
 Standard: Object.freeze({label: 'Standard (착지선 끝 옆 가운데)', arrow: 'filled', arrowPaper: 4, textPaper: null, landingPaper: 8, attach: 'middle'}),
 // 한국 건축 도면의 재료 지시: 착지선이 문자 밑줄이 되고 여러 재료를 위로 쌓는다(지금까지 MLEADER 기본값과 같다).
 [DEFAULT_MLEADER_STYLE]: Object.freeze({label: '건축 재료 (밑줄형 · 여러 줄 위로 쌓기)', arrow: 'filled', arrowPaper: 2.5, textPaper: null, landingPaper: 4, attach: 'above'}),
});
const STYLE_KEYS = ['arrow', 'arrowPaper', 'textPaper', 'landingPaper', 'attach'];

/** 도면에서 쓸 수 있는 스타일 표(기본 + 도면에 저장된 것). 도면 것이 같은 이름의 기본을 덮는다. */
export function mleaderStyleTable(doc) {
 const own = {...(doc?.mleaderStyles && typeof doc.mleaderStyles === 'object' ? doc.mleaderStyles : {}), ...(doc?.projectSettings?.mleaderStyles && typeof doc.projectSettings.mleaderStyles === 'object' ? doc.projectSettings.mleaderStyles : {})};
 const out = {...BUILTIN_MLEADER_STYLES};
 for (const [name, s] of Object.entries(own)) if (s && typeof s === 'object') out[name] = {...(BUILTIN_MLEADER_STYLES[name] || BUILTIN_MLEADER_STYLES[DEFAULT_MLEADER_STYLE]), ...s};
 return out;
}
export function currentMleaderStyle(doc) {
 const name = doc?.projectSettings?.currentMleaderStyle;
 return name && mleaderStyleTable(doc)[name] ? name : DEFAULT_MLEADER_STYLE;
}
/** 스타일 값 + 기본 용지 문자 높이 → 실제 옵션. */
export function resolveMleaderStyle(style, paperTextHeight = 2.5) {
 const s = style || BUILTIN_MLEADER_STYLES[DEFAULT_MLEADER_STYLE];
 return {arrow: s.arrow, arrowPaper: s.arrowPaper, textPaper: Number(s.textPaper) > 0 ? Number(s.textPaper) : (Number(paperTextHeight) > 0 ? Number(paperTextHeight) : 2.5), landingPaper: s.landingPaper, attach: s.attach};
}
/** 스타일과 다른 값만(재정의). */
export function mleaderOverrides(resolved, options) {
 const out = {};
 for (const k of STYLE_KEYS) if (options[k] !== undefined && options[k] !== resolved[k]) out[k] = options[k];
 return out;
}
/** 스타일 하나 검사(MLEADERSTYLE 저장 전). */
export function validateMleaderStyle(s) {
 if (!ARROW_OPTIONS.some(([k]) => k === s.arrow)) throw Error(`화살표 "${s.arrow}" 을(를) 알 수 없습니다.`);
 if (!ATTACH_OPTIONS.some(([k]) => k === s.attach)) throw Error(`문자 위치 "${s.attach}" 을(를) 알 수 없습니다.`);
 if (!(Number(s.arrowPaper) > 0 && Number(s.arrowPaper) <= 100)) throw Error('화살표 크기는 0보다 크고 100 이하입니다.');
 if (s.textPaper !== null && !(Number(s.textPaper) > 0 && Number(s.textPaper) <= 100)) throw Error('문자 높이는 0보다 크고 100 이하입니다(비우면 도면 설정을 따름).');
 if (!(Number(s.landingPaper) >= 0 && Number(s.landingPaper) <= 500)) throw Error('착지선 길이는 0~500 입니다.');
 return {arrow: s.arrow, arrowPaper: Number(s.arrowPaper), textPaper: s.textPaper === null ? null : Number(s.textPaper), landingPaper: Number(s.landingPaper), attach: s.attach, ...(s.label ? {label: String(s.label)} : {})};
}

/** 다중 지시선 블록이면 그 구성(경로·문자·화살촉·착지점)을 읽는다. 아니면 null. */
export function readMultiLeader(block) {
 if (!block || block.type !== 'block' || !Array.isArray(block.entities) || block.table) return null;
 if (!block.mleader && block.name !== '지시선') return null;
 const pathIndex = block.entities.findIndex(e => e?.type === 'polyline' && !e.closed && Array.isArray(e.points) && e.points.length >= 2);
 const textIndex = block.entities.findIndex(e => e?.type === 'text' && typeof e.text === 'string');
 if (pathIndex < 0 || textIndex < 0) return null;
 const path = block.entities[pathIndex], text = block.entities[textIndex], pts = path.points;
 const last = pts.at(-1), prev = pts.at(-2);
 // 착지선(수평 꺾임)은 마지막 선분이 수평이고 점이 셋 이상일 때. 착지점 = 착지선이 시작하는 점(문자가 매달리는 곳).
 const shoulder = pts.length >= 3 && Math.abs(last.y - prev.y) <= Math.max(G.EPS, Math.abs(last.x - prev.x) * 1e-9);
 const landingIndex = shoulder ? pts.length - 2 : pts.length - 1;
 const th = Number(text.height) > 0 ? Number(text.height) : 1, rows = text.text.split('\n').length;
 const lastBaseline = text.position.y - (rows - 1) * LINE_SPACING * th;
 return {block, pathIndex, textIndex, path, text, points: pts, tip: pts[0], landing: pts[landingIndex], landingIndex, end: last, shoulder,
  lines: text.text.split('\n'), th, rows, side: text.align === 'right' ? -1 : last.x < prev.x ? -1 : 1, attach: lastBaseline > pts[landingIndex].y ? 'above' : 'middle'};
}

/** 화살 끝은 두고 나머지 꺾임점·착지선·문자를 shift 만큼 옮긴다. 첫 선분 방향이 바뀌면 화살촉을 화살 끝 둘레로 돌린다. */
function shiftLeader(info, shift) {
 const pts = info.points.map((p, i) => i === 0 ? {...p} : {x: p.x + shift.x, y: p.y + shift.y});
 const turn = G.angle(G.sub(pts[1], pts[0])) - G.angle(G.sub(info.points[1], info.points[0]));
 const entities = info.block.entities.map((e, i) => {
  if (i === info.pathIndex) return {...e, points: pts};
  if (i === info.textIndex) return {...e, position: {x: e.position.x + shift.x, y: e.position.y + shift.y}};
  return Math.abs(turn) > 1e-9 ? G.rotate(e, info.tip, turn) : e;
 });
 return entities;
}

/**
 * MLEADERALIGN. leaders = 지시선 블록들.
 *  spacing   : origin(없으면 첫 착지점)에서 direction 쪽으로 spacing 간격씩 착지점을 한 줄로.
 *  distribute: origin~end 사이에 착지점을 고르게.
 *  parallel  : 첫 지시선(reference)의 첫 선분과 평행하게 — 각 지시선은 착지점 높이를 지키고 가로만 옮긴다.
 * 결과 = updateMany 의 updates([{id, changes:{entities}}]). 움직이지 않는 지시선은 빠진다.
 */
export function alignMultiLeaders(leaders, {mode = 'spacing', origin = null, direction = {x: 0, y: -1}, spacing = 0, end = null, reference = null} = {}) {
 const infos = leaders.map(readMultiLeader).filter(Boolean);
 if (infos.length < 2) throw Error('정렬할 다중 지시선을 2개 이상 고르세요.');
 const updates = [];
 const push = (info, shift) => { if (Math.hypot(shift.x, shift.y) > G.EPS) updates.push({id: info.block.id, changes: {entities: shiftLeader(info, shift)}}); };
 if (mode === 'parallel') {
  const ref = infos.find(i => i.block.id === reference) || infos[0];
  const u = G.unit(G.sub(ref.points[1], ref.tip));
  for (const info of infos) {
   if (info === ref) continue;
   const p1 = info.points[1], d = G.sub(p1, info.tip);
   let t = Math.abs(u.y) > 1e-6 ? d.y / u.y : d.x / u.x;
   if (!(t > G.EPS)) t = Math.hypot(d.x, d.y);   // 반대쪽으로 뒤집히면 길이를 지켜 같은 방향으로
   push(info, G.sub(G.add(info.tip, G.mul(u, t)), p1));
  }
  return updates;
 }
 let u = G.unit(direction);
 let start = origin, gap = Number(spacing);
 const order = infos.map(info => ({info, s: G.dot(info.landing, u)})).sort((a, b) => a.s - b.s);
 const ref = mode === 'spacing' ? order.findIndex(o => o.info.block.id === reference) : -1;
 if (ref > 0) { order.unshift(...order.splice(ref, 1)); start = order[0].info.landing; }   // 기준 지시선은 그 자리, 나머지가 줄을 선다
 if (mode === 'distribute') {
  if (!origin || !end) throw Error('고르게 놓을 시작점과 끝점이 필요합니다.');
  const span = G.sub(end, origin);
  if (Math.hypot(span.x, span.y) < G.EPS) throw Error('시작점과 끝점이 같습니다.');
  u = G.unit(span); gap = Math.hypot(span.x, span.y) / (infos.length - 1);
  order.sort((a, b) => G.dot(a.info.landing, u) - G.dot(b.info.landing, u));
 } else {
  if (!(gap > 0)) gap = Math.max(...infos.map(i => (i.rows * LINE_SPACING + 1) * i.th));   // 자동: 가장 큰 문자 묶음 + 한 줄
  start = start || order[0].info.landing;
 }
 order.forEach(({info}, k) => push(info, G.sub(G.add(start, G.mul(u, k * gap)), info.landing)));
 return updates;
}

/**
 * MLEADERCOLLECT. 첫 지시선(base)에 나머지 지시선의 재료 줄을 이어 쌓고(같은 줄은 한 번) 나머지는 지운다.
 * 결과 = {update:{id, changes:{entities}}, remove:[ids], lines}.
 */
export function collectMultiLeaders(base, others) {
 const info = readMultiLeader(base);
 if (!info) throw Error('모을 기준이 다중 지시선이 아닙니다.');
 const rest = (others || []).filter(o => o?.id !== base.id).map(readMultiLeader).filter(Boolean);
 if (!rest.length) throw Error('모을 다중 지시선을 2개 이상 고르세요.');
 const lines = [];
 for (const l of [info, ...rest.sort((a, b) => b.landing.y - a.landing.y)]) for (const line of l.lines) { const s = clean(line); if (s && !lines.includes(s)) lines.push(s); }
 if (lines.length > MAX_NOTE_LINES) throw Error(`모으면 재료가 ${lines.length}줄이 됩니다. 한 지시선은 ${MAX_NOTE_LINES}줄까지입니다.`);
 const th = info.th, gap = th * GAP, rows = lines.length, text = lines.join('\n');
 const entities = info.block.entities.map(e => e);
 const pts = info.points.map(p => ({...p}));
 let position;
 if (info.attach === 'above') {
  const width = estimateTextWidth(text, th) + gap * 2, now = info.shoulder ? Math.abs(info.end.x - info.landing.x) : 0;
  if (info.shoulder) pts[pts.length - 1] = {x: info.landing.x + info.side * Math.max(now, width), y: info.landing.y};
  else pts.push({x: info.landing.x + info.side * width, y: info.landing.y});
  position = {x: info.text.position.x, y: info.landing.y + gap + (rows - 1) * LINE_SPACING * th};
 } else position = {x: info.text.position.x, y: info.end.y - th / 2 + (rows - 1) * LINE_SPACING * th / 2};
 entities[info.pathIndex] = {...info.path, points: pts};
 entities[info.textIndex] = {...info.text, text, position};
 return {update: {id: base.id, changes: {entities}}, remove: rest.map(r => r.block.id), lines};
}

/** 스타일을 바꾼 뒤 그 스타일을 쓰는 지시선 다시 그리기(같은 축척·같은 점·같은 재료). */
export function restyleMultiLeader(block, oldStyle, newStyle, paperTextHeight = 2.5) {
 const info = readMultiLeader(block);
 if (!info) return null;
 const ov = block.mleaderOverrides || {};
 const before = {...resolveMleaderStyle(oldStyle, paperTextHeight), ...ov}, after = {...resolveMleaderStyle(newStyle, paperTextHeight), ...ov};
 const scale = info.th / before.textPaper;
 const userPoints = info.shoulder ? info.points.slice(0, -1) : info.points;
 const rebuilt = buildMultiLeader(userPoints, info.lines, {...after, scale, style: block.mleaderStyle, overrides: ov});
 const withLayer = e => ({...e, layer: block.layer, ...(e.entities ? {entities: e.entities.map(withLayer)} : {})});
 return {id: block.id, changes: {entities: rebuilt.entities.map(withLayer)}};
}

const withLayer = (e, layer) => ({...e, layer, ...(e.entities ? {entities: e.entities.map(c => withLayer(c, layer))} : {})});

export function installMleaderTools(ctx) {
 // 명령 목록(commands.js COMMANDS)에 오르기 전에도 이름·한글로 칠 수 있게(이미 있는 이름이면 그쪽이 먼저).
 registerManualLabels([['MLEADERALIGN', 'MLEADERALIGN'], ['지시선정렬', 'MLEADERALIGN'], ['MLEADERCOLLECT', 'MLEADERCOLLECT'], ['지시선모으기', 'MLEADERCOLLECT'], ['MLEADERSTYLE', 'MLEADERSTYLE'], ['지시선스타일', 'MLEADERSTYLE']]);
 const defaultScale = () => Number(ctx.getSettings?.()?.denominator) || 100;
 const doc = () => (typeof ctx.doc === 'function' ? ctx.doc() : null);
 const paperText = () => Number(ctx.getSettings?.()?.paperTextHeight) || 2.5;
 // 고른 순서대로의 다중 지시선(잠긴 레이어 것은 빼고 센다).
 const pickedLeaders = () => {
  const order = new Map((ctx.selectedIds?.() || []).map((id, i) => [id, i]));
  const layers = new Map((ctx.layers?.() || []).map(l => [l.id, l]));
  const all = (ctx.selected?.() || []).filter(e => readMultiLeader(e)).sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
  const leaders = all.filter(e => !layers.get(e.layer)?.locked);
  return {leaders, locked: all.length - leaders.length};
 };
 const options = () => {
  let s = {};
  try { s = JSON.parse(ctx.storage?.getItem(OPTIONS_KEY) || '{}') || {}; } catch {}
  const pos = (v, d, zero = false) => Number.isFinite(v) && (zero ? v >= 0 : v > 0) ? v : d;
  // 519: 기본값은 스타일에서, 지난번에 고친 값(같은 스타일일 때)이 그 위에. 스타일을 바꾸면 그 스타일 값으로 돌아간다.
  const styles = mleaderStyleTable(doc()), style = styles[s.style] ? s.style : currentMleaderStyle(doc());
  const base = resolveMleaderStyle(styles[style], paperText()), mine = s.style === undefined || s.style === style;
  return {
   style, textPaper: mine ? pos(s.textPaper, base.textPaper) : base.textPaper, arrowPaper: mine ? pos(s.arrowPaper, base.arrowPaper) : base.arrowPaper, landingPaper: mine ? pos(s.landingPaper, base.landingPaper, true) : base.landingPaper,
   arrow: mine && ARROW_OPTIONS.some(([k]) => k === s.arrow) ? s.arrow : base.arrow, attach: mine && ATTACH_OPTIONS.some(([k]) => k === s.attach) ? s.attach : base.attach,
   layer: s.layer === STD_LAYERS.text ? s.layer : CURRENT, picks: Array.isArray(s.picks) ? s.picks : null,
  };
 };
 const targetLayer = (choice) => {
  const id = choice === STD_LAYERS.text ? ctx.ensureLayer(STD_LAYERS.text, '#ffffff') : (ctx.activeLayer?.() ?? 'default');
  const layer = ctx.layers().find(l => l.id === id);
  if (!layer) throw Error('그릴 레이어를 찾을 수 없습니다.');
  if (layer.locked || layer.visible === false || layer.frozen) throw Error(`"${layer.name}" 레이어가 잠김/숨김 상태라 그릴 수 없습니다. 다른 레이어를 고르세요.`);
  return id;
 };

 const listForm = (after) => {
  const list = loadMaterials(ctx.storage);
  return ctx.form(`지시선 재료 목록 · ${list.length}개 · 한 줄에 한 재료`, [
   {name: 'items', label: '재료 목록 (새 줄 = 추가 · 줄 지우기 = 삭제 · 줄 옮기기 = 순서 변경)', type: 'textarea', value: list.join('\n')},
   {name: 'action', label: '작업', options: [['save', '이대로 저장'], ['sort', '가나다순으로 정렬해 저장'], ['reset', '기본 목록으로 되돌리기']], value: 'save'},
  ], (v) => {
   let next = v.action === 'reset' ? [...DEFAULT_MATERIALS] : parseMaterialText(v.items);
   if (v.action === 'sort') next = [...next].sort((a, b) => a.localeCompare(b, 'ko'));
   next = saveMaterials(ctx.storage, next);
   ctx.toast(v.action === 'reset' ? `재료 목록을 기본 ${next.length}개로 되돌렸습니다.` : `재료 목록 ${next.length}개를 저장했습니다.`);
   if (after) return after();
  });
 };

 const materialForm = (points) => {
  const list = loadMaterials(ctx.storage), o = options();
  const choices = [['', '— 고르지 않음 —'], ...list.map(m => [m, m])];
  const pick = (i) => list.includes(o.picks?.[i]) ? o.picks[i] : (i === 0 && !o.picks ? list[0] : '');
  return ctx.form(`다중 지시선 · 점 ${points.length}개 · 재료 고르기`, [
   {name: 'm1', label: '재료 1 (목록)', options: choices, value: pick(0)},
   {name: 'm2', label: '재료 2 (아래 줄)', options: choices, value: pick(1)},
   {name: 'm3', label: '재료 3', options: choices, value: pick(2)},
   {name: 'm4', label: '재료 4', options: choices, value: pick(3)},
   {name: 'custom', label: '직접 입력 (한 줄에 한 재료 · 목록 재료 아래로 이어짐)', type: 'textarea', value: ''},
   {name: 'remember', label: '직접 입력한 재료를 목록 끝에 추가', type: 'checkbox', value: false},
   {name: 'editList', label: '그리지 않고 재료 목록부터 편집 (추가·삭제·순서) 후 이 창으로 돌아오기', type: 'checkbox', value: false},
   {name: 'scale', label: '축척 1:', type: 'number', value: defaultScale()},
   {name: 'style', label: '스타일 (바꾸면 아래 값 대신 그 스타일 값으로 그림)', options: Object.entries(mleaderStyleTable(doc())).map(([k, s]) => [k, s.label || k]), value: o.style},
   {name: 'textPaper', label: '문자 높이 (용지 mm)', type: 'number', value: o.textPaper},
   {name: 'attach', label: '문자 위치', options: ATTACH_OPTIONS, value: o.attach},
   {name: 'landingPaper', label: '착지선(수평 꺾임) 최소 길이 (용지 mm · 0 = 없음)', type: 'number', value: o.landingPaper},
   {name: 'arrow', label: '화살표', options: ARROW_OPTIONS, value: o.arrow},
   {name: 'arrowPaper', label: '화살표 크기 (용지 mm)', type: 'number', value: o.arrowPaper},
   {name: 'layer', label: '레이어', options: [[CURRENT, '현재 레이어'], [STD_LAYERS.text, `${STD_LAYERS.text} (주석 문자)`]], value: o.layer},
  ], async (v) => {
   if (isChecked(v.editList)) return listForm(() => materialForm(points));
   const scale = boundedNumber(v.scale, {min: 0, exclusiveMin: true, max: 100000, label: '축척'});
   const styles = mleaderStyleTable(doc()), styleName = styles[v.style] ? v.style : o.style, switched = styleName !== o.style;
   const base = resolveMleaderStyle(styles[styleName], paperText());
   let textPaper, landingPaper, arrowPaper, arrow, attach;
   if (switched) ({textPaper, landingPaper, arrowPaper, arrow, attach} = base);
   else {
    textPaper = boundedNumber(v.textPaper, {min: 0, exclusiveMin: true, max: 100, label: '문자 높이'});
    landingPaper = boundedNumber(v.landingPaper, {min: 0, max: 500, label: '착지선 길이'});
    arrow = v.arrow; attach = v.attach;
    arrowPaper = arrow === 'none' ? base.arrowPaper : boundedNumber(v.arrowPaper, {min: 0, exclusiveMin: true, max: 100, label: '화살표 크기'});
   }
   const overrides = mleaderOverrides(base, {textPaper, arrowPaper, landingPaper, arrow, attach});
   const picks = ['m1', 'm2', 'm3', 'm4'].map(k => clean(v[k]));
   const custom = parseMaterialText(v.custom);
   const lines = [...new Set([...picks.filter(Boolean), ...custom])];
   const make = cursor => buildMultiLeader(cursor ? [...points.slice(0,-1),cursor] : points, lines, {scale,textPaper,arrow,arrowPaper,landingPaper,attach,style:styleName,overrides});
   let block=make(null);
   if(typeof ctx.pickPoint==='function'){
    const placed=await ctx.pickPoint({prompt:'MLEADER · 문자/착지선 위치 지정 · Esc 취소',preview:dimensionPreview(make)});
    if(!placed)return;
    block=make(placed);
   }
   const layer = targetLayer(v.layer);
   let note = '';
   const ids = ctx.execute({type: 'addMany', entities: [withLayer(block, layer)]});
   if (Array.isArray(ids)) ctx.setSelected?.(ids);
   try { ctx.storage?.setItem(OPTIONS_KEY, JSON.stringify({style: styleName, textPaper, arrowPaper: arrow === 'none' ? o.arrowPaper : arrowPaper, landingPaper, arrow, attach, layer: v.layer, picks})); } catch {}
   if (switched) note += ` · 스타일 "${styleName}" 값으로 그림`;
   if (isChecked(v.remember) && custom.length) {
    try { const saved = saveMaterials(ctx.storage, addMaterials(list, custom)); note = ` · 목록 ${saved.length}개로 저장`; }
    catch (e) { note = ` · 목록에는 추가하지 못함(${e.message})`; }
   }
   ctx.toast(`다중 지시선 · 점 ${points.length}개 · 재료 ${lines.length}줄 · 문자 ${(textPaper * scale).toLocaleString('ko-KR')} mm (용지 ${textPaper} mm × 1:${scale})${note}. Ctrl+Z 로 되돌립니다.`);
  });
 };

 return {
  async MLEADER() {
   const o = options(), list = loadMaterials(ctx.storage);
   const sample = (o.picks || [list[0]]).filter(m => list.includes(m));
   const preview = dimensionPreview((cursor, points) => {
    const pts = [...points, cursor];
    if (pts.length < 2) return [];
    return buildMultiLeader(pts, sample.length ? sample : ['재료'], {...o, scale: defaultScale()}).entities;
   });
   const path = await ctx.pickPath({prompt: 'MLEADER · 화살표 끝 → 꺾이는 점을 차례로 · Enter·우클릭 완료 · U 한 점 취소 · Esc 취소', preview, minPoints: 2, maxPoints: MAX_LEADER_POINTS});
   if (!path?.points) return;
   return materialForm(path.points);
  },

  MLEADERLIST() { return listForm(null); },

  // 519 MLEADERALIGN: 고른 지시선의 착지점·문자만 옮기고 화살 끝은 그대로. 기준 = 처음 고른 지시선.
  MLEADERALIGN() {
   const {leaders, locked} = pickedLeaders();
   if (leaders.length < 2) throw Error(`정렬할 다중 지시선을 2개 이상 먼저 선택하세요.${locked ? ` (잠긴 레이어 ${locked}개 제외)` : ''}`);
   return ctx.form(`다중 지시선 정렬 · ${leaders.length}개 · 화살 끝은 그대로`, [
    {name: 'mode', label: '정렬 방식', options: [['spacing', '간격 지정 · 처음 고른 지시선부터 한 줄로'], ['distribute', '두 점 사이에 고르게'], ['parallel', '처음 고른 지시선과 평행하게']], value: 'spacing'},
    {name: 'spacing', label: '간격 (도면 mm · 0 = 문자 묶음 높이로 자동)', type: 'number', value: 0},
   ], async v => {
    const spacing = boundedNumber(v.spacing, {min: 0, max: 1e7, label: '간격'});
    const ref = leaders[0], refLanding = readMultiLeader(ref).landing;
    let opts = {mode: v.mode, reference: ref.id, spacing};
    if (v.mode === 'spacing') {
     const toward = await ctx.pickPoint({prompt: 'MLEADERALIGN · 정렬할 방향의 점 (처음 고른 지시선의 착지점에서 이쪽으로) · Esc 취소'});
     if (!toward) return;
     if (G.dist(toward, refLanding) < G.EPS) throw Error('방향 점이 착지점과 같습니다. 다른 점을 고르세요.');
     opts = {...opts, origin: refLanding, direction: G.sub(toward, refLanding)};
    } else if (v.mode === 'distribute') {
     const a = await ctx.pickPoint({prompt: 'MLEADERALIGN · 첫 착지점 위치 · Esc 취소'});
     if (!a) return;
     const b = await ctx.pickPoint({prompt: 'MLEADERALIGN · 마지막 착지점 위치 · Esc 취소'});
     if (!b) return;
     opts = {...opts, origin: a, end: b};
    }
    const updates = alignMultiLeaders(leaders, opts);
    if (!updates.length) { ctx.toast('MLEADERALIGN · 이미 정렬되어 있어 옮길 지시선이 없습니다.'); return; }
    ctx.execute({type: 'updateMany', updates});
    ctx.toast(`MLEADERALIGN · 지시선 ${updates.length}개의 착지점·문자를 옮겼습니다(화살 끝 그대로)${locked ? ` · 잠긴 레이어 ${locked}개는 건너뜀` : ''} · Ctrl+Z 로 되돌리기`);
   });
  },

  // 519 MLEADERCOLLECT: 처음 고른 지시선에 나머지 재료 줄을 쌓고 나머지 지시선은 지운다(되돌리기 한 번).
  MLEADERCOLLECT() {
   const {leaders, locked} = pickedLeaders();
   if (leaders.length < 2) throw Error(`모을 다중 지시선을 2개 이상 먼저 선택하세요. 처음 고른 지시선에 모입니다.${locked ? ` (잠긴 레이어 ${locked}개 제외)` : ''}`);
   const r = collectMultiLeaders(leaders[0], leaders.slice(1));
   ctx.execute({type: 'batch', commands: [{type: 'updateMany', updates: [r.update]}, {type: 'delete', ids: r.remove}]});
   ctx.setSelected?.([leaders[0].id]);
   ctx.toast(`MLEADERCOLLECT · 지시선 ${leaders.length}개를 하나로 모았습니다 · 재료 ${r.lines.length}줄${locked ? ` · 잠긴 레이어 ${locked}개는 건너뜀` : ''} · Ctrl+Z 로 되돌리기`);
   return r;
  },

  // 519 MLEADERSTYLE: 현재 스타일 고르기 · 스타일 값 저장(도면에) · 그 스타일을 쓰는 지시선 다시 그리기.
  MLEADERSTYLE() {
   const d = doc();
   if (!d) throw Error('도면 정보를 읽을 수 없어 스타일을 바꿀 수 없습니다.');
   const styles = mleaderStyleTable(d), current = currentMleaderStyle(d), s = styles[current];
   return ctx.form(`다중 지시선 스타일 · 현재 "${current}"`, [
    {name: 'name', label: '스타일', options: [...Object.entries(styles).map(([k, st]) => [k, st.label || k]), ['__new__', '새 스타일 (아래 이름)']], value: current},
    {name: 'newName', label: '새 스타일 이름', value: ''},
    {name: 'action', label: '작업', options: [['current', '현재 스타일로만 (값은 그대로)'], ['save', '아래 값을 이 스타일에 저장하고 현재 스타일로']], value: 'current'},
    {name: 'textPaper', label: '문자 높이 (용지 mm · 0 = 도면 설정 따름)', type: 'number', value: s.textPaper ?? 0},
    {name: 'attach', label: '문자 위치', options: ATTACH_OPTIONS, value: s.attach},
    {name: 'landingPaper', label: '착지선 길이 (용지 mm)', type: 'number', value: s.landingPaper},
    {name: 'arrow', label: '화살표', options: ARROW_OPTIONS, value: s.arrow},
    {name: 'arrowPaper', label: '화살표 크기 (용지 mm)', type: 'number', value: s.arrowPaper},
    {name: 'restyle', label: '이 스타일을 쓰는 지시선도 새 값으로 다시 그리기', type: 'checkbox', value: true},
   ], v => {
    const name = v.name === '__new__' ? clean(v.newName) : v.name;
    if (!name) throw Error('새 스타일 이름을 넣으세요.');
    if (name.length > 40) throw Error('스타일 이름은 40자까지입니다.');
    if (v.name !== '__new__' && !styles[name]) throw Error(`스타일 "${name}" 이(가) 없습니다.`);
    const ps = d.projectSettings && typeof d.projectSettings === 'object' ? d.projectSettings : {};
    const commands = [];
    let restyled = 0, lockedCount = 0;
    if (v.action === 'save' || v.name === '__new__') {
     const tp = Number(v.textPaper);
     const next = validateMleaderStyle({label: BUILTIN_MLEADER_STYLES[name]?.label || name, arrow: v.arrow, arrowPaper: v.arrow === 'none' ? (Number(v.arrowPaper) > 0 ? v.arrowPaper : s.arrowPaper) : v.arrowPaper, textPaper: tp > 0 ? tp : (tp === 0 || String(v.textPaper ?? '').trim() === '' ? null : tp), landingPaper: v.landingPaper, attach: v.attach});
     commands.push({type: 'document.update', changes: {projectSettings: {...ps, mleaderStyles: {...(ps.mleaderStyles || {}), [name]: next}, currentMleaderStyle: name}}});
     if (isChecked(v.restyle) && styles[name]) {
      const layers = new Map((ctx.layers?.() || []).map(l => [l.id, l])), updates = [];
      for (const e of ctx.entities?.() || []) {
       if (e?.type !== 'block' || e.mleaderStyle !== name) continue;
       if (layers.get(e.layer)?.locked) { lockedCount++; continue; }
       const u = restyleMultiLeader(e, styles[name], next, paperText());
       if (u) updates.push(u);
      }
      if (updates.length) { commands.push({type: 'updateMany', updates}); restyled = updates.length; }
     }
    } else commands.push({type: 'document.update', changes: {projectSettings: {...ps, currentMleaderStyle: name}}});
    ctx.execute({type: 'batch', commands});
    try { const saved = JSON.parse(ctx.storage?.getItem(OPTIONS_KEY) || '{}') || {}; ctx.storage?.setItem(OPTIONS_KEY, JSON.stringify({layer: saved.layer, picks: saved.picks, style: name})); } catch {}
    ctx.toast(`MLEADERSTYLE · 현재 스타일 "${name}"${v.action === 'save' || v.name === '__new__' ? ' · 값 저장' : ''}${restyled ? ` · 지시선 ${restyled}개 다시 그림` : ''}${lockedCount ? ` · 잠긴 레이어 ${lockedCount}개는 건너뜀` : ''} · Ctrl+Z 로 되돌리기`);
   });
  },
 };
}
