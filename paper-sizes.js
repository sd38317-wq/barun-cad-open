// 종이 위 크기표(drawing-standard.json paperSizes) — 표기 크기의 단 하나의 기준(사장님 2026-10-25
// "비율을 딱 정해놓고 그거에 맞게 움직이게"). 도면 위 크기 = 표 값(종이 mm) × 축척 분모.
// 예전 키(annotation.textHeight·titleHeight·paper, plan.standardPlan.paper 의 글자·원 크기, grid.bubble, tags.radius,
// plan.title.bubbleRadius)는 JSON 에 따로 적지 않고 여기서 이 표로 채운다 — 두 곳에 적으면 언젠가 어긋난다.
const round = (v) => Math.round(v * 1000) / 1000;
// 글자 높이로 쓰는 키(이 값 × 분모가 아닌 글자는 검사에서 실패)
export const PAPER_TEXT_KEYS = ['text', 'dimensionText', 'roomName', 'gridText', 'detailCalloutText', 'titleText', 'titleNumberText', 'scaleText', 'leaderNoteText', 'tableTitleText'];
// 기호 원 지름 키(원 객체의 paperSize 표시가 이 키를 가리킨다)
export const PAPER_SYMBOL_KEYS = ['gridBubbleDiameter', 'openingTagDiameter', 'detailCalloutDiameter', 'titleBubbleDiameter'];
const DENOMINATORS = [1, 2, 5, 10, 20, 25, 30, 50, 60, 75, 80, 100, 120, 150, 200, 250, 300, 400, 500, 600, 1000];

export const denominatorOf = (scale) => (typeof scale === 'number' ? scale : Number(String(scale ?? '').split('/')[1])) || 100;
export function paperSizesOf(standard) {
  const P = standard?.paperSizes;
  if (!P || typeof P !== 'object') throw Error('도면 기준에 paperSizes(종이 위 크기표)가 없습니다 — rules/knowledge/drawing-standard.json');
  return P;
}
/** 표 값(종이 mm). 없는 키는 조용히 넘기지 않고 오류. */
export function paperValue(standard, key) {
  const v = paperSizesOf(standard)[key];
  if (!Number.isFinite(v) || v <= 0) throw Error('paperSizes.' + key + ' 값이 없습니다');
  return v;
}
/** 도면 위 크기(mm) = 표 값 × 축척 분모 */
export const paperMm = (standard, key, scale) => round(paperValue(standard, key) * denominatorOf(scale));
/** 글자 크기 단계 = 표의 글자 키 값들(작은 것부터) */
export const paperTextLevels = (standard) => [...new Set(PAPER_TEXT_KEYS.map((k) => paperSizesOf(standard)[k]).filter((v) => Number.isFinite(v) && v > 0))].sort((a, b) => a - b);

/** 예전 키를 크기표로 채운 기준 사본. paperSizes 가 없으면 그대로(옛 기준 파일). 여러 번 불러도 결과가 같다. */
export function applyPaperSizes(standard) {
  if (!standard?.paperSizes) return standard;
  const P = standard.paperSizes, s = {...standard};
  const A = s.annotation = {...(standard.annotation || {})};
  A.paper = {...(A.paper || {}), text: P.text, title: P.titleText, levels: paperTextLevels(standard)};
  A.textHeight = {...(A.textHeight || {})};A.titleHeight = {...(A.titleHeight || {})};
  for (const d of DENOMINATORS) {A.textHeight['1/' + d] = round(P.text * d);A.titleHeight['1/' + d] = round(P.titleText * d);}
  A.lineGap = round(P.noteLineGap / P.leaderNoteText);   // 줄 간격(글자 높이 배수) — noteLineGap 에서
  if (standard.plan) {
    const plan = s.plan = {...standard.plan};
    if (standard.plan.standardPlan) {
      const sp = plan.standardPlan = {...standard.plan.standardPlan};
      sp.paper = {...(sp.paper || {}), gridRadius: P.gridBubbleDiameter / 2, gridText: P.gridText, dimensionText: P.dimensionText, axisDimensionText: P.dimensionText,
        titleRadius: P.titleBubbleDiameter / 2, titleText: P.titleText, scaleText: P.scaleText, numberText: P.titleNumberText ?? P.titleText, noteText: P.text, noteLineGap: P.noteLineGap,
        ...Object.fromEntries([['dimensionOffset', 'dimensionOffset'], ['dimensionGap', 'dimensionGap'], ['arrow', 'dimensionArrow'], ['extensionOvershoot', 'dimensionExtensionOvershoot'], ['extensionOffset', 'dimensionExtensionOffset'], ['textGap', 'dimensionTextGap']].filter(([, key]) => Number.isFinite(P[key])).map(([name, key]) => [name, P[key]]))};
      // 번호 원 가장자리 = 맨 바깥 치수선 + gridBubbleGap. 축선 끝(축선 치수줄 + axisOverrun)에서 원까지 띄움으로 바꿔 둔다
      if (Number.isFinite(P.gridBubbleGap)) {const rows = (sp.dimensionRows || ['segments', 'axes', 'overall']).length, gap = sp.paper.dimensionGap ?? 0;
        sp.paper.bubbleGap = round(gap * Math.max(0, rows - 2) + P.gridBubbleGap - (sp.paper.axisOverrun ?? 0));}
      if (Number.isFinite(P.gridLineweight)) sp.layerDefinitions = {...(sp.layerDefinitions || {}), ...Object.fromEntries([standard.grid?.layer, standard.grid?.bubbleLayer].filter(Boolean).map((n) => [n, {...(sp.layerDefinitions?.[n] || {}), lineweight: P.gridLineweight}]))};
    }
    // 1/100 기준 도면 mm 로 적던 값(paperStandard 가 축척 비율로 늘이고 줄인다)
    plan.title = {...(plan.title || {}), bubbleRadius: round(P.titleBubbleDiameter / 2 * 100)};
  }
  if (standard.grid) s.grid = {...standard.grid, bubble: round(P.gridBubbleDiameter / 2 * 100)};
  if (standard.tags) s.tags = {...standard.tags, radius: round(P.openingTagDiameter / 2 * 100)};
  return s;
}

/* 마지막 검사(사장님 2026-10-25 "아예 강제해서 절대 못 하게"): 글자·치수 글자 높이는 표의 글자 값 × 그 그림의 축척 분모,
   paperSize 표시가 붙은 기호 원은 그 키의 지름 × 분모(허용 오차 1%). kAt(점) → 그 자리의 축척 분모(모르면 null = 검사 안 함). */
export function paperSizeViolations(entities, standard, kAt, {tolerance = 0.01} = {}) {
  const P = paperSizesOf(standard), levels = paperTextLevels(standard), bad = [];
  const near = (v, want) => Math.abs(v - want) <= Math.abs(want) * tolerance + 1e-6;
  for (const e of entities) {
    if (e.sheetDecoration || e.paperSizeExempt) continue;
    if (e.type === 'text' && e.fittedToSymbol) continue;   // 기호 원 안 글은 한 벌 템플릿(textFit)이 원에 맞춘 크기로 지킨다(2026-10-25)
    if (e.type === 'text' && e.height > 0 && e.position) {
      const k = kAt(e.position, e);if (!k) continue;
      const want = e.paperSize ? [P[e.paperSize]] : levels;
      if (!want.some((v) => near(e.height, v * k))) bad.push({id: e.id, type: 'text', text: String(e.text).slice(0, 20), height: e.height, paperMm: round(e.height / k), allowed: want, denominator: k, key: e.paperSize || null});
    } else if (e.type === 'dimension' && e.textHeight > 0 && e.points?.length) {
      const k = kAt(e.points[0], e);if (!k) continue;
      const h = e.textHeight * (e.scale || 1), key = e.detailDimension ? 'detailDimensionText' : 'dimensionText';
      if (!near(h, P[key] * k)) bad.push({id: e.id, type: 'dimension', height: round(h), paperMm: round(h / k), allowed: [P[key]], denominator: k, key});
    } else if (e.type === 'circle' && e.paperSize && e.center) {
      const k = kAt(e.center, e);if (!k) continue;
      if (!near(e.radius * 2, P[e.paperSize] * k)) bad.push({id: e.id, type: 'circle', diameter: round(e.radius * 2), paperMm: round(e.radius * 2 / k), allowed: [P[e.paperSize]], denominator: k, key: e.paperSize});
    }
  }
  return bad;
}
/* AI 가 직접 넣는 글자(cad_execute·cad_preview 의 add/addMany/batch, update 의 height): 그 자리 도곽(sheet)의 축척에서
   표의 글자 값 × 분모와 다르면 가장 가까운 표 값으로 맞추고 경고(code=paper_size). 도곽 밖이면 도면 묶음 축척, 그것도 없으면 그대로 두고 알린다.
   command 는 고쳐서(복사본) 돌려준다. */
export function snapAITextHeights(document, command, standard) {
  if (!standard?.paperSizes || !command) return {command, warnings: [], changed: []};
  const levels = paperTextLevels(standard), cmd = structuredClone(command), changed = [], unknown = [];
  const sheets = (document?.sheets || []).filter((s) => s.bounds && s.denominator);
  const setScales = [...new Set(Object.values(document?.drawingSets || {}).map((s) => s?.options?.scale || s?.scale).filter((v) => /^1\/\d+$/.test(String(v))).map(denominatorOf))];
  const kOf = (p) => {const s = p && sheets.find((q) => p.x >= q.bounds.minX && p.x <= q.bounds.maxX && p.y >= q.bounds.minY && p.y <= q.bounds.maxY);return s ? s.denominator : sheets.length === 1 ? sheets[0].denominator : setScales.length === 1 ? setScales[0] : null;};
  const fix = (holder, p, label) => {
    const h = Number(holder.height);if (!(h > 0)) return;
    const k = kOf(p);if (!k) {unknown.push(label);return;}
    if (levels.some((v) => Math.abs(h - v * k) <= v * k * 0.01)) return;
    const want = levels.reduce((a, b) => (Math.abs(b * k - h) < Math.abs(a * k - h) ? b : a));
    changed.push({text: String(holder.text ?? label).slice(0, 20), from: h, to: round(want * k), paperMm: want, denominator: k});holder.height = round(want * k);
  };
  const entity = (e) => {if (!e || typeof e !== 'object') return;if (e.type === 'text') fix(e, e.position, 'text');for (const key of ['entities', 'children']) for (const c of e[key] || []) entity(c);};
  const visit = (c) => {if (!c) return;if (c.type === 'add') entity(c.entity);if (c.type === 'addMany') (c.entities || []).forEach(entity);
    if (c.type === 'update' && c.changes && c.changes.height !== undefined) {const e = (document?.entities || []).find((q) => (c.ids || []).includes(q.id) && q.type === 'text');if (e) fix(c.changes, e.position, 'update');}
    if (c.type === 'batch') (c.commands || []).forEach(visit);};
  visit(cmd);
  const warnings = [];
  if (changed.length) warnings.push(`code=paper_size: 글자 높이 ${changed.length}개를 종이 위 크기표(paperSizes) 값으로 맞췄습니다 — ` + changed.slice(0, 4).map((c) => `"${c.text}" ${c.from}→${c.to}(종이 ${c.paperMm} mm, 1/${c.denominator})`).join(' · ') + '. 글자 크기는 표 값 × 도면 축척 분모로만 씁니다.');
  if (unknown.length) warnings.push(`code=paper_size: 축척을 모르는 자리의 글자 ${unknown.length}개는 높이를 확인하지 못했습니다(도곽 밖). 글자 크기는 paperSizes 값 × 축척 분모로 쓰세요.`);
  return {command: cmd, warnings, changed};
}
export function enforcePaperSizes(entities, standard, kAt, where = '도면') {
  if (!standard?.paperSizes) return [];
  const bad = paperSizeViolations(entities, standard, kAt);
  if (bad.length) {
    const error = Error(`${where}: 종이 위 크기표(paperSizes)와 다른 표기 ${bad.length}개 — ` + bad.slice(0, 6).map((b) => `${b.type} ${b.id}${b.text ? ' "' + b.text + '"' : ''} 종이 ${b.paperMm} mm(허용 ${b.allowed.join('/')} mm, 1/${b.denominator})`).join(' · '));
    error.code = 'paper_size';error.violations = bad;throw error;
  }
  return bad;
}
