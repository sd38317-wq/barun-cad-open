// 도면 제목 + 축척 한 덩어리(훈민캐드 대조 기반 H49 · 훈민 TIT/TITLE, AutoCAD 주석 축척 제목 블록).
//  TITLE  위치 → 제목(예: 1층 평면도) → 축척(비우면 찍은 점이 든 도곽 축척, 도곽 밖이면 기본 축척) → 부제 형식
//         (SCALE 1:100 / S : 1/100) → (선택) 도면 번호 원 기호. 결과는 블록 하나({type:'block', name:'도면제목',
//         attributes:{title, scale, paperHeight}}): 제목 문자(용지 5mm) + 굵은 밑줄 + 가는 밑줄(이중 밑줄) +
//         제목 길이 바로 뒤의 축척 문자(용지 3mm). 넣은 뒤 +/− 크기 조정 창이 이어지고, "끝"을 고르면 확정한다.
//         넣기와 크기 조정 전체가 되돌리기 한 번(Ctrl+Z)이다 — 아래 installTitleTools 설명 참고.
// 기존 TIT(architectural-library.js, 밑줄+문자만, 축척 없음)·DAS(sheet-plot-tools.js, 축척 문자만 따로)는 그대로 두고,
// 둘을 합친 "축척 따라 크기가 정해지는 제목 블록"을 새로 만든다.
import * as G from './geometry.js';
import {isChecked} from './card-input.js';

export const TITLE_BLOCK_NAME = '도면제목';
/** 용지 mm 기준 크기. 모든 값은 paperHeight/5 비율로 함께 커지고 작아진다(제목 5mm 일 때의 값). */
export const TITLE_PAPER = Object.freeze({title: 5, scale: 3, baseline: 1.8, scaleGap: 4, tail: 1.5, thick: 0.6, thin: 1.2, bubble: 12, number: 4, numberTop: 3.5, numberBottom: 2.5, minLength: 20});
export const TITLE_STYLES = Object.freeze([['scale', 'SCALE 1:100'], ['slash', 'S : 1/100'], ['none', '축척 문자 없음']]);
export const TITLE_LIMITS = Object.freeze({minPaper: 0.5, maxPaper: 50, maxScale: 100000, maxTitle: 200});

// 한글·한자·전각 문자는 글자 높이만큼(1.0×h), 영문·숫자·기호는 0.6×h 로 폭을 어림한다(글꼴 없이 계산하는 추정치).
// ×(U+00D7)·화살표·수학 기호는 한글 글꼴(나눔고딕)에서 전각 폭으로 그려져 한글과 같이 센다(900×300 제목이 축척 문자와 겹치던 문제).
const WIDE = /[×ᄀ-ᇿ←-⯿⺀-鿿가-힯豈-﫿＀-￯]/u;
export function estimateTextWidth(text, height) {
 const h = Number(height) || 0;
 return Math.max(0, ...String(text ?? '').split('\n').map(line => [...line].reduce((w, ch) => w + (WIDE.test(ch) ? 1 : 0.6), 0) * h));
}

const trimNumber = (n) => String(Number(Number(n).toFixed(6)));

/** 축척 부제 문자. style: scale → "SCALE 1:100", slash → "S : 1/100", none → "". */
export function scaleLabel(style, denominator) {
 const n = Number(denominator);
 if (!(n > 0) || !Number.isFinite(n)) throw Error('축척 분모는 0보다 큰 수입니다.');
 if (style === 'none') return '';
 if (style === 'slash') return `S : 1/${trimNumber(n)}`;
 if (style === 'scale' || style == null) return `SCALE 1:${trimNumber(n)}`;
 throw Error('축척 표기 형식은 SCALE 1:100 · S : 1/100 · 없음 중 하나입니다.');
}

/** 점이 든 도곽(여럿이면 가장 작은 것). 없으면 null. */
export function sheetAt(sheets, point) {
 if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
 const inside = (sheets || []).filter(s => s?.bounds && Number(s.denominator) > 0 && point.x >= s.bounds.minX && point.x <= s.bounds.maxX && point.y >= s.bounds.minY && point.y <= s.bounds.maxY);
 const area = (s) => (s.bounds.maxX - s.bounds.minX) * (s.bounds.maxY - s.bounds.minY);
 return inside.sort((a, b) => area(a) - area(b))[0] || null;
}

/** 제목 축척 기본값: 찍은 점이 든 도곽의 축척 → 없으면 전체(기본) 축척. */
export function titleScaleAt(doc, point, fallback = 100) {
 const sheet = sheetAt(doc?.sheets, point);
 return sheet ? Number(sheet.denominator) : (Number(fallback) > 0 ? Number(fallback) : 100);
}

function readTitleInput({title, scale, paperHeight, style, number, position}) {
 const text = String(title ?? '').trim();
 if (!text) throw Error('도면 제목을 입력하세요.');
 if (text.length > TITLE_LIMITS.maxTitle) throw Error(`도면 제목은 ${TITLE_LIMITS.maxTitle}자까지입니다.`);
 const s = Number(scale), ph = Number(paperHeight);
 if (!(s > 0) || s > TITLE_LIMITS.maxScale) throw Error('축척은 0보다 크고 100,000 이하입니다.');
 if (!(ph >= TITLE_LIMITS.minPaper) || ph > TITLE_LIMITS.maxPaper) throw Error(`제목 글자 높이(용지)는 ${TITLE_LIMITS.minPaper}~${TITLE_LIMITS.maxPaper} mm 입니다.`);
 if (!TITLE_STYLES.some(([k]) => k === (style ?? 'scale'))) throw Error('축척 표기 형식은 SCALE 1:100 · S : 1/100 · 없음 중 하나입니다.');
 const at = position || {x: 0, y: 0};
 if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) throw Error('제목 위치가 올바르지 않습니다.');
 const mark = String(number ?? '').trim();
 if (mark.length > 20) throw Error('도면 번호는 20자까지입니다.');
 return {text, s, ph, style: style ?? 'scale', mark, at};
}

/** 도면 번호 원 기호(원 안 번호, "1/A-101" 처럼 / 로 나누면 위·아래 두 줄과 가로 구분선). 로컬 좌표. */
function numberBubble(mark, u, layer) {
 const r = TITLE_PAPER.bubble / 2 * u, c = {x: -r, y: -TITLE_PAPER.thin * u / 2};
 const out = [{type: 'circle', layer, center: c, radius: r}];
 const [top, bottom] = mark.split('/').map(s => s.trim());
 if (bottom) {
  out.push({type: 'line', layer, points: [{x: c.x - r, y: c.y}, {x: c.x + r, y: c.y}]});
  out.push({type: 'text', layer, position: {x: c.x, y: c.y + 1.2 * u}, text: top || '-', height: TITLE_PAPER.numberTop * u, align: 'center', titleRole: 'number'});
  out.push({type: 'text', layer, position: {x: c.x, y: c.y - 1.2 * u - TITLE_PAPER.numberBottom * u}, text: bottom, height: TITLE_PAPER.numberBottom * u, align: 'center', titleRole: 'sheet'});
 } else {
  const h = TITLE_PAPER.number * u;
  out.push({type: 'text', layer, position: {x: c.x, y: c.y - h * 0.42}, text: top, height: h, align: 'center', titleRole: 'number'});
 }
 return out;
}

/**
 * 도면 제목 블록(순수 함수). position 은 밑줄 왼쪽 끝(삽입점). 모든 크기는 "용지 mm × 축척 × (paperHeight/5)".
 * 반환: {type:'block', name:'도면제목', position, attributes:{title, scale, paperHeight, style, number}, entities}
 */
export function titleBlock({title, scale = 100, paperHeight = TITLE_PAPER.title, style = 'scale', number = '', position = {x: 0, y: 0}, layer = 'default'} = {}) {
 const {text, s, ph, style: st, mark, at} = readTitleInput({title, scale, paperHeight, style, number, position});
 const u = s * ph / TITLE_PAPER.title;                    // 용지 1mm(제목 5mm 기준) = 도면 u mm
 const titleH = TITLE_PAPER.title * u, subH = TITLE_PAPER.scale * u, base = TITLE_PAPER.baseline * u;
 const sub = scaleLabel(st, s);
 const titleW = estimateTextWidth(text, titleH), subX = titleW + TITLE_PAPER.scaleGap * u;
 const length = Math.max(TITLE_PAPER.minLength * u, (sub ? subX + estimateTextWidth(sub, subH) : titleW) + TITLE_PAPER.tail * u);
 const local = [
  {type: 'text', layer, position: {x: 0, y: base}, text, height: titleH, align: 'left', titleRole: 'title'},
  ...(sub ? [{type: 'text', layer, position: {x: subX, y: base}, text: sub, height: subH, align: 'left', titleRole: 'scale'}] : []),
  // 굵은 밑줄(폴리선 실폭, 출력 선굵기 0.5) + 가는 밑줄 = 이중 밑줄
  {type: 'polyline', layer, points: [{x: 0, y: 0}, {x: length, y: 0}], closed: false, constantWidth: TITLE_PAPER.thick * u, lineweight: 0.5, titleRole: 'underline'},
  {type: 'line', layer, points: [{x: 0, y: -TITLE_PAPER.thin * u}, {x: length, y: -TITLE_PAPER.thin * u}], lineweight: 0.18, titleRole: 'underline2'},
  ...(mark ? numberBubble(mark, u, layer) : []),
 ];
 return {
  type: 'block', name: TITLE_BLOCK_NAME, annotative: true, layer, position: {x: at.x, y: at.y},
  attributes: {title: text, scale: s, paperHeight: ph, style: st, number: mark},
  entities: local.map(e => G.translate(e, at.x, at.y)),
 };
}

/** 크기 조정 한 단계의 목표 용지 높이. 단계는 처음 크기(base)의 step% 만큼 더하거나 뺀다(+10% → −10% 하면 제자리). */
export function titleResizeStep(current, base, action, stepPercent = 10) {
 const cur = Number(current), b = Number(base), step = Number(stepPercent);
 if (!(cur > 0) || !(b > 0)) throw Error('지금 제목 크기를 읽을 수 없습니다.');
 if (action === 'reset') return b;
 if (!(step > 0) || step > 100) throw Error('한 번에 바꿀 비율은 0 초과 100% 이하입니다.');
 const delta = b * step / 100;
 const next = action === 'up' ? cur + delta : action === 'down' ? cur - delta : NaN;
 if (!Number.isFinite(next)) throw Error('크게 / 작게 / 처음 크기 / 끝 중에서 고르세요.');
 if (next < TITLE_LIMITS.minPaper - 1e-9) throw Error(`더 작게 할 수 없습니다(용지 ${TITLE_LIMITS.minPaper} mm 이상).`);
 if (next > TITLE_LIMITS.maxPaper + 1e-9) throw Error(`더 크게 할 수 없습니다(용지 ${TITLE_LIMITS.maxPaper} mm 이하).`);
 return Number(next.toFixed(6));
}

/** 놓인 제목 블록을 삽입점 기준으로 target 용지 높이까지 키우거나 줄이는 엔진 명령(batch 한 개). */
export function resizeTitleCommands(block, targetPaperHeight) {
 if (!block || block.type !== 'block' || !block.position) throw Error('크기를 바꿀 도면 제목 블록이 없습니다.');
 const current = Number(block.attributes?.paperHeight) || TITLE_PAPER.title, target = Number(targetPaperHeight);
 if (!(target > 0)) throw Error('제목 크기는 0보다 커야 합니다.');
 const factor = target / current;
 return [
  {type: 'scale', ids: [block.id], base: {x: block.position.x, y: block.position.y}, factor},
  {type: 'update', ids: [block.id], changes: {attributes: {...(block.attributes || {}), paperHeight: target}}},
 ];
}

/** pickPoint 미리보기 콜백: 앱은 (점 목록, 커서) 로, 시험은 (커서) 로 부를 수 있어 둘 다 받는다. */
export function cursorPreview(fn) {
 return (a, b) => {
  const cursor = Array.isArray(a) ? b : a;
  if (!cursor || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return [];
  try { return fn({x: cursor.x, y: cursor.y}) || []; } catch { return []; }
 };
}

const STORE_KEY = 'barun-title-tools';
const fmt = (n) => trimNumber(Number(n).toFixed(2));

/**
 * TITLE 명령. 되돌리기 묶음: 앱의 카드 폼 [적용]은 되돌리기 묶음(engine transaction)을 열고 onApply 가 끝날 때 닫는다.
 * 첫 폼의 onApply 는 크기 조정 창에서 "끝"(또는 Esc)을 고를 때까지 끝나지 않고 기다리므로, 그 사이 크기 조정 창의
 * [적용] 묶음은 바깥 묶음 안에 중첩되어(깊이만 늘었다 줄어듦) 넣기 + 모든 +/− 가 되돌리기 한 단계가 된다.
 * Esc 로 닫으면 앱이 묶음을 그 자리에서 닫아(지금 크기로 확정) 역시 한 단계다.
 */
export function installTitleTools(ctx) {
 const defaultScale = () => Number(ctx.getSettings?.()?.denominator) || 100;
 const remembered = () => { try { return JSON.parse(ctx.storage?.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; } };
 const remember = (v) => { try { ctx.storage?.setItem(STORE_KEY, JSON.stringify(v)); } catch {} };
 const titleLayer = () => {
  const id = ctx.ensureLayer('A-SYM', '#ffffff');
  const layer = ctx.layers?.().find(l => l.id === id);
  if (layer?.locked || layer?.visible === false) throw Error(`"${layer.name}" 레이어가 잠김/숨김이라 제목을 넣을 수 없습니다.`);
  return id;
 };

 function resizeLoop(id, base) {
  return new Promise(resolve => {
   let settled = false, lastAction = 'up';
   const finish = () => { if (!settled) { settled = true; resolve(); } };
   const ask = (step = 10) => {
    const block = ctx.entities().find(e => e.id === id);
    if (!block) return finish();
    const now = Number(block.attributes?.paperHeight) || base;
    ctx.form(`TITLE · 크기 조정 · 지금 용지 ${fmt(now)} mm (처음 ${fmt(base)} mm) · [끝] 을 골라 확정`, [
     {name: 'action', label: '조정', options: [['up', '+ 크게'], ['down', '− 작게'], ['reset', '처음 크기로'], ['done', '끝 (이 크기로 확정)']], value: lastAction},
     {name: 'step', label: '한 번에 바꿀 비율 % (처음 크기 기준)', type: 'number', value: step},
    ], (v) => {
     if (v.action === 'done') return finish();
     const stepPercent = Number(v.step);
     const current = ctx.entities().find(e => e.id === id);
     if (!current) return finish();
     const target = titleResizeStep(Number(current.attributes?.paperHeight) || base, base, v.action, stepPercent);
     if (Math.abs(target - (Number(current.attributes?.paperHeight) || base)) > 1e-9) ctx.execute({type: 'batch', commands: resizeTitleCommands(current, target)});
     ctx.refresh?.();
     lastAction = v.action;
     ask(v.action === 'reset' ? step : stepPercent);
    }, finish);
   };
   ask();
  });
 }

 return {
  TITLE() {
   const last = remembered();
   return ctx.form('도면 제목 · 축척 표기 한 덩어리 (TITLE)', [
    {name: 'title', label: '도면 제목', value: last.title || '1층 평면도'},
    {name: 'scale', label: `축척 1: (비우면 찍은 점이 든 도곽 축척, 도곽 밖이면 기본 1:${defaultScale()})`, type: 'number', value: ''},
    {name: 'style', label: '축척 표기', options: TITLE_STYLES, value: last.style || 'scale'},
    {name: 'number', label: '도면 번호 원 기호 (비우면 없음 · 1/A-101 처럼 / 로 위·아래)', value: last.number || ''},
    {name: 'paperHeight', label: '제목 글자 높이 (용지 mm · 축척 문자는 3/5 크기)', type: 'number', value: last.paperHeight || TITLE_PAPER.title},
    {name: 'resize', label: '넣은 뒤 +/− 크기 조정 창 띄우기', type: 'checkbox', value: last.resize !== false},
   ], async (v) => {
    const explicit = String(v.scale ?? '').trim() === '' ? null : Number(v.scale);
    if (explicit !== null && !(explicit > 0)) throw Error('축척은 0보다 커야 합니다. 도곽 축척을 쓰려면 비워 두세요.');
    const opts = {title: v.title, style: v.style, number: v.number, paperHeight: Number(v.paperHeight)};
    const scaleFor = (p) => explicit ?? titleScaleAt(ctx.doc?.(), p, defaultScale());
    titleBlock({...opts, scale: scaleFor(null)});           // 위치를 찍기 전에 입력부터 검사
    remember({title: String(v.title).trim(), style: v.style, number: String(v.number ?? '').trim(), paperHeight: Number(v.paperHeight), resize: isChecked(v.resize)});
    const at = await ctx.pickPoint({prompt: 'TITLE · 제목 밑줄의 왼쪽 끝(삽입점)을 지정하세요 · Esc 취소', preview: cursorPreview(c => titleBlock({...opts, scale: scaleFor(c), position: c}).entities)});
    if (!at) return;
    const scale = scaleFor(at);
    const block = titleBlock({...opts, scale, position: at, layer: titleLayer()});
    const ids = ctx.commit({entities: [block]}) || [];
    const id = ids[0];
    ctx.toast(`도면 제목 "${block.attributes.title}" · 1:${trimNumber(scale)}${sheetAt(ctx.doc?.()?.sheets, at) && explicit === null ? ' (도곽 축척)' : ''} · 용지 ${fmt(block.attributes.paperHeight)} mm.`);
    if (id && isChecked(v.resize)) await resizeLoop(id, block.attributes.paperHeight);
    const placed = id && ctx.entities().find(e => e.id === id);
    if (placed && isChecked(v.resize)) ctx.toast(`도면 제목 확정 · 용지 ${fmt(placed.attributes?.paperHeight)} mm. 넣기와 크기 조정을 Ctrl+Z 한 번에 되돌립니다.`);
   });
  },
 };
}
