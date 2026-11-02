import {materializeSharedDrawingReference} from './geometry.js';
// 실시도면 품질 자동 검사 — 사용자 체크리스트(건축 실시도면 품질 200, rules/knowledge/drawing-quality.json) 중
// 도면 한 벌(drawingSet)에서 기계로 잴 수 있는 항목을 잰다. 나머지는 '추가 확인', 이 세트에 없는 도면 종류는 '해당 없음'.
// 결과는 판정이지 보증이 아니다(체크리스트 머리말 그대로): 수치 기준은 시험 출력용 출발값.
import {standardLayerForName} from './layer-standards.js';
import {sheetGeometry, DEFAULT_SHEET_TEMPLATE} from './sheet-layout.js';

// 생성기와 검사기가 같은 가정 ID와 시트 안내를 사용한다.
export const drawingAssumptions = model => (model?.props?.planset?.assumed || model?.recognition?.assumed || []).map((a,i)=>a.id?a:{...a,id:'assumed-'+i});
export function drawingAssumptionNote(model) {
  const n=drawingAssumptions(model).length;
  return model?.source?.kind==='planset'||model?.props?.planset||n?'가정값 '+n+'개'+(n?' — 노란 표시 확인':''):null;
}

const OK = '적합', FIX = '수정 필요', ASK = '추가 확인', NA = '해당 없음';
// 이 세트(PLANSET: 평면·입면·단면·계단·개요·마감표·상세)에 없는 도면 종류
const NOT_PRODUCED = [[81, 90], [147, 147], [150, 160], [171, 179], [181, 184], [188, 188]];
const notProduced = (no) => NOT_PRODUCED.some(([a, b]) => no >= a && no <= b);
const wide = (ch) => ch.codePointAt(0) > 0x2e80;
const textWidth = (t, h) => [...String(t)].reduce((n, ch) => n + (wide(ch) ? 1.0 : 0.62), 0) * h;
const r2 = (v) => Math.round(v * 100) / 100;

// extra: {placed: 상세 묶음(번호·anchor·status), occt: 3D 결과({ignored}|{error}) 또는 null(3D 안 씀)}
export function checkDrawingQuality(doc, setId, quality, model = null, extra = {}) {
  const T = quality?.thresholds || {};
  const layers = new Map((doc.layers || []).map((l) => [l.id, l]));
  const allOwn = doc.entities.filter((e) => e.drawingSet?.id === setId);
  const own = allOwn.filter(e=>layers.get(e.layer)?.plot!==false);
  const sheets = (doc.sheets || []).filter((s) => s.drawingSet === setId && s.bounds);
  const lname = (e) => layers.get(e.layer)?.name || '';
  const lw = (e) => Number(e.lineweight ?? layers.get(e.layer)?.lineweight ?? 0.25);
  const at = (e) => e.position || e.center || e.points?.[0];
  const inside = (p, b) => p && p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
  const sheetOf = (p) => sheets.find((s) => inside(p, s.bounds));
  const denom = (e) => sheetOf(at(e))?.denominator || 100;
  const res = new Map(), put = (no, status, detail) => res.set(no, {status, detail});
  const texts = own.flatMap(e => e.sheetFrame && e.sharedBlock ? materializeSharedDrawingReference(doc, e).entities.map(child => ({...child, sheetId: e.sheetId, sheetDecoration: true})) : [e]).filter((e) => e.type === 'text' && e.text && e.position);
  const strokes = own.filter((e) => ['line', 'polyline', 'circle', 'arc', 'rectangle'].includes(e.type));
  const isAnno = (n) => /^[AS]-ANNO|^A-(?:TEXT|DIM|SYM|NOTE|GUIDE|ACCS|ASSUMED)(?:$|-)|^[AS]-GRID|PLOT|SHEET|TITLE/i.test(n);   // S- = 구조 레이어(2026-10-16)
  const layerLw = (name) => {const l = [...layers.values()].find((x) => x.name === name);return l ? Number(l.lineweight ?? 0.25) : null;};

  // 001 선 굵기 단계
  const tiers = [...new Set(strokes.map((e) => r2(lw(e))))].sort((a, b) => a - b), [tMin, tMax] = T.lineweightTiers || [4, 6];
  put(1, tiers.length >= tMin && tiers.length <= tMax ? OK : FIX, `쓰인 선 굵기 ${tiers.length}단계(${tiers.join('·')} mm), 기준 ${tMin}~${tMax}단계`);
  // 002 절단면 우선 강조 / 003 가까운·먼 면
  const cut = layerLw('A-WALL-CONC'), seen = layerLw('A-ELEV-VIEW');
  if (cut != null && seen != null) put(2, cut > seen ? OK : FIX, `절단(A-WALL-CONC) ${cut} mm · 보이는 선(A-ELEV-VIEW) ${seen} mm`);
  // 004 보조선 존재감
  const aux = ['A-DIM', 'A-HATCH', 'A-AREA-PATT', 'A-GRID'].map(layerLw).filter((v) => v != null);
  if (aux.length && cut != null) put(4, Math.max(...aux) < cut ? OK : FIX, `치수·해치·축선 최대 ${Math.max(...aux)} mm < 절단 ${cut} mm`);
  // 010 중복선
  const keyOf = (e) => {const [a, b] = e.points, k = (p) => `${Math.round(p.x)},${Math.round(p.y)}`, s = [k(a), k(b)].sort();return lname(e) + '|' + s.join('|');};
  const lines = own.filter((e) => e.type === 'line' && e.points?.length === 2), seenKeys = new Set();let dup = 0;
  for (const e of lines) {const k = keyOf(e);if (seenKeys.has(k)) dup++;else seenKeys.add(k);}
  put(10, dup ? FIX : OK, `같은 자리에 겹친 선 ${dup}개`);
  // 012 종이 기준 문자 크기 / 013 위계
  const dimTexts = own.filter((e) => e.type === 'dimension' && e.textHeight && e.points?.length).map((e) => ({e: {...e, text: '치수', position: e.points[0]}, mm: r2(e.textHeight * (e.scale || 1) / denom({position: e.points[0]}))}));
  // 기호 원 안 글(원에 맞춰 줄인 것, fittedToSymbol)은 한 벌 템플릿의 기호 규칙(textFit 최소 1.5 mm)이 따로 지킨다 — 크기·단계 셈에서 뺀다(2026-10-25)
  const paper = [...texts.filter((e) => !e.fittedToSymbol && (!isAnno(lname(e)) || /ANNO-TEXT|ANNO-SYMB|^A-TEXT$|^A-SYM$|GRID/.test(lname(e)))).map((e) => ({e, mm: r2(e.height / denom(e))})), ...dimTexts];
  const hard = paper.filter((p) => p.mm < (T.paperTextHard ?? 2.0)), soft = paper.filter((p) => p.mm >= (T.paperTextHard ?? 2.0) && p.mm < (T.paperTextMin ?? 2.5));
  put(12, hard.length ? FIX : soft.length ? ASK : OK, `종이 위 ${T.paperTextHard ?? 2.0}mm 미만 ${hard.length}개, ${T.paperTextMin ?? 2.5}mm 미만 ${soft.length}개` + (hard.length ? ` (예: "${String(hard[0].e.text).slice(0, 18)}" ${r2(hard[0].mm)}mm)` : ''));
  const levels = [...new Set(paper.map((p) => Math.round(p.mm * 2) / 2))];
  put(13, levels.length <= (T.paperTextLevels ?? 6) ? OK : FIX, `문자 크기 ${levels.length}단계(${levels.sort((a, b) => a - b).join('·')} mm)`);
  // 017 특수문자 깨짐
  const broken = texts.filter((e) => /�|\?\?/.test(e.text)).length;put(17, broken ? FIX : OK, `깨진 글자 ${broken}개`);
  // 024 충돌(글자·기호끼리)
  const boxes = [];
  for (const e of texts) {const w = textWidth(e.text, e.height), x0 = e.align === 'center' ? e.position.x - w / 2 : e.align === 'right' ? e.position.x - w : e.position.x;boxes.push({e, s: sheetOf(e.position), b: {minX: x0, maxX: x0 + w, minY: e.position.y, maxY: e.position.y + e.height}});}
  // 치수 숫자도 글자로 본다(치수선 가운데, 가로 치수는 선 위 / 세로 치수는 선 왼쪽에 세워 씀). 좁아서 옮겨 쓴 숫자(DTM)는 위치를 몰라 뺀다
  for (const d of own.filter((x) => x.type === 'dimension' && x.points?.length >= 3 && x.textHeight && (x.mode === 'horizontal' || x.mode === 'vertical'))) {
    const hz = d.mode === 'horizontal', [a, b, at] = d.points, h = d.textHeight * (d.scale || 1), len = Math.abs(hz ? b.x - a.x : b.y - a.y);
    const w = textWidth(String(Math.round(len)), h);if (w > len) continue;
    const m = hz ? (a.x + b.x) / 2 : (a.y + b.y) / 2, g = h * 0.3;
    boxes.push({e: {text: String(Math.round(len))}, s: sheetOf(at), b: hz ? {minX: m - w / 2, maxX: m + w / 2, minY: at.y + g, maxY: at.y + g + h} : {minX: at.x - g - h, maxX: at.x - g, minY: m - w / 2, maxY: m + w / 2}});
  }
  const symbols = own.filter((e) => e.type === 'circle' && e.radius >= 200 && /ANNO-SYMB|^A-SYM$|GRID/.test(lname(e)));
  for (const c of symbols) boxes.push({e: c, s: sheetOf(c.center), circle: true, b: {minX: c.center.x - c.radius, maxX: c.center.x + c.radius, minY: c.center.y - c.radius, maxY: c.center.y + c.radius}});
  const hit = (a, b) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
  const inCircle = (t, c) => {const p = {x: (t.b.minX + t.b.maxX) / 2, y: (t.b.minY + t.b.maxY) / 2};return Math.hypot(p.x - c.e.center.x, p.y - c.e.center.y) < c.e.radius;};
  let clashes = 0;const clashSamples = [], clashAll = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];if (a.s !== b.s || !hit(a.b, b.b)) continue;
    const c = a.circle ? a : b.circle ? b : null, o = c === a ? b : a;   // 원은 네모가 아니라 실제 원으로(모서리 빈 곳은 겹침 아님)
    if (c && !o.circle && Math.hypot(Math.max(o.b.minX - c.e.center.x, 0, c.e.center.x - o.b.maxX), Math.max(o.b.minY - c.e.center.y, 0, c.e.center.y - o.b.maxY)) >= c.e.radius) continue;
    if (a.circle && b.circle && Math.hypot(a.e.center.x - b.e.center.x, a.e.center.y - b.e.center.y) >= a.e.radius + b.e.radius) continue;
    if (a.circle && !b.circle && inCircle(b, a) || b.circle && !a.circle && inCircle(a, b)) continue;   // 기호 안 글자
    if (a.circle && b.circle && Math.hypot(a.e.center.x - b.e.center.x, a.e.center.y - b.e.center.y) < 5) continue;   // 같은 기호 이중 원
    clashes++;clashAll.push([a, b].map((x) => ({sheet: x.s?.number, text: x.circle ? `기호 r${x.e.radius}` : x.e.text, at: [Math.round(x.b.minX), Math.round(x.b.minY)]})));if (clashSamples.length < 3) clashSamples.push([a, b].map((x) => x.circle ? '기호' : `"${String(x.e.text).slice(0, 10)}"`).join('↔'));
  }
  put(24, clashes ? FIX : OK, `겹친 글자·기호 ${clashes}쌍` + (clashSamples.length ? ` (${clashSamples.join(', ')})` : ''));
  // 031 지시선 끝점(점이 실제 선에 닿는가)
  const geo = own.filter((e) => (e.type === 'line' || e.type === 'polyline') && !isAnno(lname(e)) && e.points?.length >= 2);
  const segs = geo.flatMap((e) => e.points.slice(1).map((p, i) => [e.points[i], p]).concat(e.closed ? [[e.points.at(-1), e.points[0]]] : []));
  const distSeg = (p, [a, b]) => {const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);};
  const dots = own.filter((e) => e.type === 'circle' && e.radius <= 40 && /ANNO|^A-(?:SYM|NOTE|TEXT)$/.test(lname(e)));
  // 면 재료(벽·바닥 단면, 외벽 해치) 지시선은 점이 면 안에 찍힌다 — 선 위가 아니어도 그 면(닫힌 선·해치) 안이면 맞음
  const faces = own.filter((e) => (e.type === 'hatch' || (e.type === 'polyline' && e.closed)) && !isAnno(lname(e)) && e.points?.length > 2);
  const inRing = (p, ring) => {let o = false;for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {const a = ring[i], b = ring[j];if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) o = !o;}return o;};
  const onFace = (p) => faces.some((f) => [f.points, ...(f.loops || [])].reduce((o, ring) => o !== inRing(p, ring), false));
  const snap = T.leaderSnap ?? 60, missed = dots.filter((d) => !segs.some((s) => distSeg(d.center, s) <= snap * (d.modelScale || 1)) && !onFace(d.center)).length;   // 상세 장에 키워 실은 그림(modelScale)은 허용 거리도 같은 배율
  put(31, dots.length ? (missed ? FIX : OK) : ASK, `지시선 끝점 ${dots.length}개 중 선에 안 닿은 것 ${missed}개(${snap} mm 이내)`);
  // 040 가정값은 노란 배경으로 표시하고 출력에서는 뺀다.
  const assumed=drawingAssumptions(model), note=drawingAssumptionNote(model);
  if(note){
    const marks=allOwn.filter(e=>e.assumptionId), ids=new Set(assumed.map(a=>a.id)), byId=new Map(allOwn.map(e=>[e.id,e]));
    const groups=new Map(), key=(id,sheetId)=>JSON.stringify([id,sheetId??null]);
    for(const e of marks){const k=key(e.assumptionId,e.sheetId), group=groups.get(k)||[];group.push(e);groups.set(k,group);}
    const targets=new Map(assumed.map(a=>[a.id,[]]));
    for(const e of allOwn)if(['text','dimension'].includes(e.type))for(const id of e.assumptionIds||[])targets.get(id)?.push(e);
    const missing=assumed.filter(a=>!targets.get(a.id).length||targets.get(a.id).some(e=>!groups.get(key(a.id,e.sheetId))?.some(mark=>mark.assumptionTargets?.includes(e.id)))).length;
    const bad=marks.filter(e=>!ids.has(e.assumptionId)||layers.get(e.layer)?.plot!==false||e.type!=='hatch'||e.color!=='#fff176'||groups.get(key(e.assumptionId,e.sheetId)).length!==1||!e.assumptionTargets?.length||e.assumptionTargets.some(id=>{const t=byId.get(id);return !t||!t.assumptionIds?.includes(e.assumptionId)||t.sheetId!==e.sheetId;})||(sheets.length&&!sheets.some(sh=>sh.id===e.sheetId))).length;
    const notes=sheets.filter(sh=>!texts.some(e=>e.sheetId===sh.id&&e.text===note)).length;
    put(40,missing||bad||notes?FIX:OK,'가정값 '+assumed.length+'개 · 노란 표시 누락 '+missing+'개 · 출력 설정 오류 '+bad+'개 · 안내 누락 '+notes+'장');
  }
  // 044 상세번호+시트번호
  // 상세 기호 원: 크기표 표시(paperSize detailCalloutDiameter, 2026-10-25) 또는 옛 반쪽 원 크기(splitRadius)
  const split = own.filter((e) => e.type === 'circle' && (e.paperSize === 'detailCalloutDiameter' && !e.sectionMark ||Math.abs(e.radius / denom(e) - (T.splitRadius ?? 520) / 100) < 0.02) && /ANNO-SYMB|^A-SYM$/.test(lname(e)));
  const inBubble = (c, re) => texts.some((t) => re.test(t.text) && Math.hypot(t.position.x - c.center.x, t.position.y - c.center.y) < c.radius);
  const later = split.filter((c) => inBubble(c, /^예정$/)).length, noSheet = split.filter((c) => !inBubble(c, /^A-\d{3}$/) && !inBubble(c, /^예정$/)).length;   // 아직 장이 없는 상세는 '예정'(체크리스트 040 미확정 표기)
  put(44, split.length ? (noSheet ? FIX : OK) : ASK, `상세 기호 ${split.length}개 중 실린 장 번호 없는 것 ${noSheet}개` + (later ? ` · 작성 예정 ${later}개` : ''));
  // 072 구체적인 도면명
  const generic = sheets.filter((s) => /^(부분 상세도|상세도|도면)$/.test(String(s.title || '').trim()));
  put(72, generic.length ? FIX : OK, `막연한 도면명 ${generic.length}장` + (generic.length ? ` (${generic.slice(0, 4).map((s) => s.number).join('·')})` : ''));
  // 074 뷰별 축척 표시
  const drawn = texts.filter((t) => !t.sheetDecoration);   // 표제란·도면 목록 글은 뷰 제목이 아니다
  const viewTitles = drawn.filter((t) => /(평면도|정면도|배면도|측면도|단면도|상세도)(\s|\(|$)/.test(t.text) && !/^A-/.test(t.text)).length, scales = drawn.filter((t) => /^축척 /.test(t.text)).length;
  put(74, scales >= viewTitles ? OK : FIX, `뷰 제목 ${viewTitles}개 · 축척 표기 ${scales}개`);
  // 076 단위·높이 기준 / 077 발행 목적
  put(76, texts.some((t) => /단위\s*[:：]?\s*mm/i.test(t.text)) && texts.some((t) => /GL/.test(t.text) && /FL/.test(t.text)) ? OK : FIX, '공통사항에 길이 단위(mm)와 FL·SL·GL 뜻 표기');
  put(77, texts.some((t) => /(검토용|입찰용|시공용|준공)/.test(t.text)) ? OK : FIX, '표제란에 발행 목적(검토용·시공용 등)');
  // 079 도면목록 = 실제 시트(번호마다 한 번)
  const listSheet = sheets.find((s) => s.number === 'A-001');
  if (listSheet) {
    const listed = texts.filter((t) => /^A-\d{3}$/.test(t.text) && inside(t.position, listSheet.bounds)).map((t) => t.text), counts = {};
    for (const n of listed) counts[n] = (counts[n] || 0) + 1;
    const nums = sheets.map((s) => s.number), missing = nums.filter((n) => !counts[n]), twice = Object.keys(counts).filter((n) => counts[n] > 1), extra = Object.keys(counts).filter((n) => !nums.includes(n));
    // 상세 줄도 '실린 장' 칸에 장 번호를 적고 표제란에도 A-001 이 있으므로 여러 번 나오는 것은 정상 — 빠진 장·없는 장만 본다
    void twice;put(79, missing.length || extra.length ? FIX : OK, `목록 누락 ${missing.length}·없는 장 ${extra.length}` + (missing.length ? ` (누락 ${missing.slice(0, 4).join('·')})` : ''));
  }
  // 093 실명 ↔ 마감표
  if (model) {
    const uses = [...new Set(model.elements.filter((e) => e.kind === 'space' && e.use).map((e) => e.use))], all = new Set(texts.map((t) => t.text));
    const lost = uses.filter((u) => !all.has(u));put(93, lost.length ? FIX : OK, `평면 실명 ${uses.length}개 중 표·도면에 없는 것 ${lost.length}개`);
  }
  // 185 의미가 드러나는 레이어(바른 레이어 표준)
  const used = [...new Set(own.map(lname))], unknown = used.filter((n) => !standardLayerForName(n) && !standardLayerForName(n.replace(/-C[0-9A-F]{6}(-\d+)?$/i, '')));   // 상세 그림의 색 갈래 레이어(A-WALL-CONC-C808080)는 그 표준 레이어
  put(185, unknown.length ? FIX : OK, `표준 밖 레이어 ${unknown.length}개` + (unknown.length ? ` (${unknown.slice(0, 4).join('·')})` : ''));
  // 200 납품 대조: 상세 기호의 장 번호가 실제 시트인가
  const sheetNums = new Set(sheets.map((s) => s.number)), refNums = texts.filter((t) => /^A-\d{3}$/.test(t.text) && !(listSheet && inside(t.position, listSheet.bounds))).map((t) => t.text);
  const dangling = refNums.filter((n) => !sheetNums.has(n));
  put(200, dangling.length ? FIX : res.get(79)?.status === FIX ? FIX : OK, `없는 장을 가리키는 번호 ${dangling.length}개, 목록 대조 ${res.get(79)?.status || '-'}`);

  // 021·022·030 치수 줄: 같은 장·같은 방향·겹치는 범위의 줄을 묶음(한 면의 치수 더미)으로 본다
  const dimRows = new Map();
  for (const e of own.filter((x) => x.type === 'dimension' && x.points?.length >= 3 && (x.mode === 'horizontal' || x.mode === 'vertical'))) {
    const hz = e.mode === 'horizontal', s = sheetOf(e.points[0]), line = Math.round(hz ? e.points[2].y : e.points[2].x), k = `${s?.number}|${e.mode}|${line}|${e.dimChain ?? e.id}`;   // 한 번에 이은 줄(dimChain)끼리, 낱개 치수는 따로
    const a = hz ? e.points[0].x : e.points[0].y, c = hz ? e.points[1].x : e.points[1].y;
    const row = dimRows.get(k) || dimRows.set(k, {sheet: s?.number, mode: e.mode, line, segs: []}).get(k);row.segs.push([Math.min(a, c), Math.max(a, c)]);
  }
  // 같은 높이에 나란히 놓인 다른 그림(입면 둘 등)의 줄은 1 m 넘게 떨어져 있으면 따로 본다
  const rowList = [];
  for (const row of dimRows.values()) {
    row.segs.sort((p, q) => p[0] - q[0]);let cur = null;
    for (const q of row.segs) {if (!cur || q[0] - Math.max(...cur.segs.map((x) => x[1])) > 1000) rowList.push(cur = {...row, segs: []});cur.segs.push(q);}
  }
  for (const row of rowList) {row.lo = row.segs[0][0];row.hi = Math.max(...row.segs.map((q) => q[1]));}
  const stacks = [];
  // 줄 간격은 종이 위 15 mm(paperSizes.dimensionGap) × 그 장 축척 — 예전 1500 고정은 1/100 까지만 맞아 1/120·1/150 평면 치수 줄이 한 묶음으로 안 잡혔다(2026-10-25)
  const reach = new Map(sheets.map((s) => [s.number, ((model?.standard?.paperSizes?.dimensionGap ?? 15) + 1) * (s.denominator || 100)]));
  for (const row of rowList.sort((p, q) => p.line - q.line)) {
    const st = stacks.find((x) => x.sheet === row.sheet && x.mode === row.mode && Math.abs(x.rows.at(-1).line - row.line) <= Math.max(1500, reach.get(row.sheet) || 0) && row.lo < x.rows.at(-1).hi && x.rows.at(-1).lo < row.hi);
    if (st) st.rows.push(row);else stacks.push({sheet: row.sheet, mode: row.mode, rows: [row]});
  }
  const gapRows = rowList.filter((row) => row.segs.some((q, i) => i && Math.abs(q[0] - row.segs[i - 1][1]) > 1)).length;   // 이어지지 않는 줄
  const multi = stacks.filter((x) => x.rows.length >= 2);
  const sumBad = multi.filter((x) => {const tot = x.rows.find((r) => r.segs.length === 1);return tot && x.rows.some((r) => r.segs.length > 1 && (Math.abs(r.lo - tot.lo) > 1 || Math.abs(r.hi - tot.hi) > 1) && r.lo >= tot.lo - 1 && r.hi <= tot.hi + 1 && Math.abs(r.segs.reduce((n, q) => n + q[1] - q[0], 0) - (r.hi - r.lo)) > 1);}).length;
  if (quality?.debug) extra.debugRows = rowList.filter((row) => row.segs.some((q, i) => i && Math.abs(q[0] - row.segs[i - 1][1]) > 1)).map((r) => [r.sheet, r.mode, r.line, r.segs.map((q) => q.map(Math.round))]);
  put(30, gapRows || sumBad ? FIX : multi.length ? OK : ASK, `치수 줄 ${rowList.length}개 중 끊긴 줄 ${gapRows}개, 합계가 전체와 다른 묶음 ${sumBad}개`);
  // 안→밖: 바깥(전체 한 칸) 쪽으로 갈수록 칸 수가 줄어야 한다
  const orderBad = multi.filter((x) => {const n = x.rows.map((r) => r.segs.length), io = n.at(-1) === 1 ? n : n[0] === 1 ? [...n].reverse() : null;return !io || io.some((v, i) => i && v > io[i - 1]);}).length;   // 전체(한 칸)가 맨 바깥, 안쪽일수록 칸이 많다
  const planSheets = new Set(sheets.filter((s) => /평면도/.test(s.title || '')).map((s) => s.number)), planStacks = multi.filter((x) => planSheets.has(x.sheet)), three = planStacks.filter((x) => x.rows.length >= 3).length;
  // 축선 줄이 전체 줄과 같으면 한 줄로 합친다(사용자 10/23) — 평면은 2줄 이상이면 적합
  put(21, orderBad ? FIX : planStacks.length ? OK : ASK,`치수 묶음 ${multi.length}개 중 순서 틀린 것 ${orderBad}개 · 평면 ${planStacks.length}면 중 개구부·축선·전체 3줄 ${three}면`);
  const spacingBad = multi.filter((x) => {const g = x.rows.slice(1).map((r, i) => r.line - x.rows[i].line);return g.some((v) => Math.abs(v - g[0]) > 1);}).length;
  put(22, spacingBad ? FIX : multi.length ? OK : ASK, `치수 줄 간격이 들쭉날쭉한 묶음 ${spacingBad}개 / ${multi.length}개`);
  // 061 시트 배치: 도면 내용이 도곽 그림 칸(여백·표제란 밖) 안에 있는가
  const tpl = doc.sheetTemplate || DEFAULT_SHEET_TEMPLATE, drawArea = (s) => {const g = sheetGeometry(tpl, s.paper), k = s.denominator || 100, x = s.bounds.minX, y = s.bounds.minY;return {minX: x + g.draw.minX * k, maxX: x + g.draw.maxX * k, minY: y + g.draw.minY * k, maxY: y + g.draw.maxY * k};};
  const ptsOf = (e) => e.type === 'circle' ? [{x: e.center.x - e.radius, y: e.center.y - e.radius}, {x: e.center.x + e.radius, y: e.center.y + e.radius}] : e.type === 'text' ? [e.position, {x: e.position.x + (e.align === 'center' ? 0.5 : e.align === 'right' ? 0 : 1) * textWidth(e.text, e.height), y: e.position.y + e.height}] : e.points || [];
  const content = own.filter((e) => !e.sheetDecoration && ['line', 'polyline', 'circle', 'text', 'dimension', 'hatch'].includes(e.type));
  let outside = 0;for (const e of content) {const ps = ptsOf(e), s = ps[0] && sheetOf(ps[0]);if (!s) {outside++;continue;}const d = drawArea(s);if (ps.some((p) => p.x < d.minX - 1 || p.x > d.maxX + 1 || p.y < d.minY - 1 || p.y > d.maxY + 1)) outside++;}
  put(61, outside ? FIX : OK, `그림 칸(여백·표제란 제외) 밖으로 나간 요소 ${outside}개 / ${content.length}개`);
  // 121 핵심 접합부: 창대·창 인방·벽 하부·난간벽(지붕 끝) 상세가 세트에 있는가(그려졌는가)
  const placed = extra.placed || [], need = [['창대', (d) => d.anchor?.where === 'sill'], ['창 인방', (d) => d.anchor?.where === 'head'], ['벽 하부', (d) => d.anchor?.where === 'bottom'], ['난간벽', (d) => /parapet|패러핏|파라펫|난간벽/i.test(`${d.anchor?.where} ${d.name}`)]];
  if (placed.length) {
    const have = need.map(([n, f]) => [n, placed.find(f)]), miss = have.filter(([, d]) => !d).map(([n]) => n), pend = have.filter(([, d]) => d && (d.pending || !d.entityIds?.length)).map(([n]) => n);
    put(121, miss.length ? FIX : pend.length ? ASK : OK, `핵심 접합부 ${need.length}종 중 빠짐 ${miss.length}${miss.length ? ` (${miss.join('·')})` : ''}, 그림 대기 ${pend.length}${pend.length ? ` (${pend.join('·')} — 로그인 후 표준 상세)` : ''}`);
  }
  // 106·125 상세 기준 규칙 2(닫힌 구성): 쓰인 벽·바닥·지붕 구성의 드러난 면(벽 = 맨 바깥·맨 안, 바닥·지붕 = 맨 위)에 단열·방수·방습층이 오면 구성 불완전
  if (extra.assemblies) {
    const forbid = new Set(extra.standard?.detailBasis?.rules?.find((r) => r.id === 'closed-assembly')?.exposedForbidden || ['insulation', 'waterproofing', 'vaporBarrier']);
    const open = [];
    for (const [k, a] of Object.entries(extra.assemblies.walls || {})) {const L = a?.layers || [];if (L.length && (forbid.has(L[0].material) || forbid.has(L.at(-1).material))) open.push(`벽 ${a.label || k}`);}
    for (const kind of ['floors', 'roofs']) for (const [k, a] of Object.entries(extra.assemblies[kind] || {})) {const L = a?.layers || [];if (L.length && forbid.has(L[0].material)) open.push(`${kind === 'roofs' ? '지붕' : '바닥'} ${a.label || k}`);}
    const used = Object.keys(extra.assemblies.walls || {}).length + Object.keys(extra.assemblies.floors || {}).length + Object.keys(extra.assemblies.roofs || {}).length;
    for (const no of [106, 125]) put(no, open.length ? FIX : OK, `쓰인 구성 ${used}개 중 드러난 단열·방수층(구성 불완전) ${open.length}개` + (open.length ? ` (${open.slice(0, 3).join('·')})` : ''));
  }
  // 180 2D·3D: 같은 설계 JSON 으로 3D(OCCT)를 만들어 단면·입면 윤곽을 받았는가
  // 실(space)은 부피가 아니고, 계단은 계단 단면도(2D 계산)로 따로 그리므로 3D 에서 빠져도 된다 — 그 밖의 부재가 빠지면 확인
  const lost = (extra.occt?.ignoredKinds || []).filter((k) => !['space', 'stair'].includes(k));
  if (extra.occt !== undefined) put(180, extra.occt === null ? ASK : extra.occt.error ? FIX : lost.length ? ASK : OK, extra.occt === null ? '3D 를 쓰지 않음(2D 만)' : extra.occt.error ? `3D 실패: ${extra.occt.error}` : `같은 설계 JSON(상세 기준 반영)으로 3D 생성 · 단면·입면 윤곽 사용` + (lost.length ? ` · 3D 에 없는 부재 ${lost.join('·')}` : ' · 실·계단 외 빠진 부재 없음'));
  // 192 종이 출력: 사람이 실제로 뽑아 봐야 한다 — 뽑을 장과 종이 위 최소값만 알려 준다
  put(192, ASK, `시트 ${sheets.length}장(${[...new Set(sheets.map((s) => s.paper))].join('·')}) · 종이 위 최소 글자 ${paper.length ? r2(Math.min(...paper.map((p) => p.mm))) : '-'} mm · 최소 선 ${tiers[0] ?? '-'} mm — 실제 용지로 출력해 확인`);

  const items = (quality?.items || []).map((i) => ({no: i.no, section: i.section, title: i.title, ...(res.get(i.no) || {status: notProduced(i.no) ? NA : ASK, detail: notProduced(i.no) ? '이 도면 세트에 없는 도면 종류' : '자동으로 잴 수 없음 — 검토자 확인'})}));
  const summary = Object.fromEntries([OK, FIX, ASK, NA].map((s) => [s, items.filter((i) => i.status === s).length]));
  return {...(quality?.debug ? {debug: {clashes: clashAll, rows: extra.debugRows, stacks: stacks.map((x) => [x.sheet, x.mode, x.rows.map((r) => r.segs.length)])}} : {}), items, summary, priority: (quality?.priority || []).map((no) => items.find((i) => i.no === no)).filter(Boolean)};
}
