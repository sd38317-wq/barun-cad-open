// ACAD200 709·710·713·719 배치(종이공간)·뷰포트 축척·EXPORTLAYOUT·뷰포트 선종류 축척.
// AutoCAD: 배치마다 종이 뷰포트(0번) + 모형 뷰포트들이 있고, 배치마다 표시 목록을 캐시한다(LAYOUTREGENCTL=2).
//          뷰포트 축척은 "뷰 높이 = 종이 높이 / 축척" 으로 저장하고, VPMAX 는 뷰포트를 창 크기로 키우며 잠긴 레이어를 잠깐 풀었다 잠근다.
// 바른 CAD 가 더 나은 점(1단계):
//  - 지금의 모형 도곽 시트(doc.sheets)를 그대로 "뷰포트 하나짜리 배치" 로 승격한다 → 예전 도면·출력이 바뀌지 않는다.
//  - 배치 미리보기·내보내기는 뷰포트 범위 안 객체만(범위 상자로 먼저 거름) 자르고 옮긴다 → O(뷰포트 안 객체).
//  - VPMAX 는 뷰포트를 키우지 않고 모형 화면만 그 범위로 바꿨다가 VPMIN 에 되돌린다 → 레이어를 풀었다 잠그는 위험한 단계가 없다.
//  - 축척 잠금이면 축척·범위를 바꾸는 명령을 거절하고 한국어로 이유를 알려 준다.
import * as G from './geometry.js';
import {layersForViewport} from './viewport-layers.js';

export const PAPER_SIZES = Object.freeze({A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841]});
export const paperSize = (layout) => {
  const [w, h] = PAPER_SIZES[layout?.paper] || PAPER_SIZES.A3;
  return layout?.orientation === 'portrait' ? [h, w] : [w, h];
};
export const activeSpace = (doc) => (doc?.currentLayout && doc.currentLayout !== 'Model' ? 'paper' : 'model');

/** 모형 도곽 시트 → 배치(뷰포트 하나). 시트 범위가 종이보다 크면 뷰포트를 종이에 맞춰 줄인다(축척은 그대로). */
export function sheetToLayout(sheet) {
  if (!sheet?.bounds) throw Error('도곽 범위가 없는 시트입니다.');
  const layout = {id: 'layout-' + (sheet.id || sheet.number), name: String(sheet.number || sheet.title || '배치').trim() || '배치', paper: PAPER_SIZES[sheet.paper] ? sheet.paper : 'A3', orientation: sheet.orientation === 'portrait' ? 'portrait' : 'landscape', sheetId: sheet.id || null, entities: [], viewports: []};
  const [pw, ph] = paperSize(layout), b = sheet.bounds, s = 1 / (Number(sheet.denominator) || 100);
  const w = Math.min((b.maxX - b.minX) * s, pw), h = Math.min((b.maxY - b.minY) * s, ph);
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2, mw = w / s, mh = h / s;
  layout.viewports.push({id: layout.id + ':vp1', center: {x: pw / 2, y: ph / 2}, width: w, height: h, modelView: {minX: cx - mw / 2, minY: cy - mh / 2, maxX: cx + mw / 2, maxY: cy + mh / 2}, scale: s, locked: true, layerOverrides: {}});
  return layout;
}

/** 시트들로 배치 목록을 만든다. 이미 있는 배치(같은 시트에서 만든 것)는 덮어쓰지 않는다. */
export function layoutsFromSheets(doc) {
  const existing = Array.isArray(doc.layouts) ? doc.layouts.filter((l) => l && typeof l === 'object' && Array.isArray(l.viewports)) : [];
  const have = new Set(existing.map((l) => l.sheetId).filter(Boolean));
  const added = (doc.sheets || []).filter((s) => s?.bounds && !have.has(s.id)).map(sheetToLayout);
  return {layouts: [...existing, ...added], added: added.length};
}
export const paperLayouts = (doc) => (Array.isArray(doc?.layouts) ? doc.layouts.filter((l) => l && typeof l === 'object' && Array.isArray(l.viewports)) : []);

export function modelToPaper(vp) {
  const cx = (vp.modelView.minX + vp.modelView.maxX) / 2, cy = (vp.modelView.minY + vp.modelView.maxY) / 2;
  return (p) => ({x: vp.center.x + (p.x - cx) * vp.scale, y: vp.center.y + (p.y - cy) * vp.scale});
}

/** 710 뷰포트 축척. scale = 종이 mm / 모형 mm (1:100 → 0.01). 잠겼으면 거절. 중심은 그대로, 보이는 모형 범위만 바뀐다. */
export function setViewportScale(vp, scale) {
  if (!(Number.isFinite(scale) && scale > 0)) throw Error('뷰포트 축척은 양수입니다.');
  if (vp.locked) throw Error('축척이 잠긴 뷰포트입니다. 잠금을 먼저 푸세요.');
  const cx = (vp.modelView.minX + vp.modelView.maxX) / 2, cy = (vp.modelView.minY + vp.modelView.maxY) / 2;
  const w = vp.width / scale, h = vp.height / scale;
  return {...vp, scale, modelView: {minX: cx - w / 2, maxX: cx + w / 2, minY: cy - h / 2, maxY: cy + h / 2}};
}
/** 잠기지 않은 뷰포트의 모형 중심을 옮긴다(PAN). */
export function panViewport(vp, dx, dy) {
  if (vp.locked) throw Error('축척이 잠긴 뷰포트입니다. 잠금을 먼저 푸세요.');
  const m = vp.modelView;
  return {...vp, modelView: {minX: m.minX + dx, maxX: m.maxX + dx, minY: m.minY + dy, maxY: m.maxY + dy}};
}
export const setViewportLock = (vp, locked) => ({...vp, locked: !!locked});

export function updateLayoutViewport(doc, layoutId, vpId, fn) {
  let found = false;
  const layouts = paperLayouts(doc).map((layout) => layout.id !== layoutId ? layout : {...layout, viewports: layout.viewports.map((vp) => { if (vp.id !== vpId) return vp; found = true; return fn(vp); })});
  if (!found) throw Error('뷰포트를 찾지 못했습니다.');
  return layouts;
}

/* VPMAX/VPMIN: 화면 상태만 바꾼다(도면은 그대로). state = {view:{scale,origin}, maximized} */
export function maximizeViewport(state, vp) {
  if (!vp) throw Error('최대화할 뷰포트를 고르세요.');
  if (state.maximized) return state;
  return {...state, maximized: {vpId: vp.id, restore: state.view}, bounds: {...vp.modelView}};
}
export function minimizeViewport(state) {
  if (!state.maximized) return state;
  return {...state, view: state.maximized.restore, maximized: null, bounds: null};
}

/* 719 PSLTSCALE·MSLTSCALE: 뷰포트 안 선종류 축척. PSLTSCALE(기본 켬)이면 종이 위 무늬 길이가 뷰포트 축척과 무관하게 같다. */
export function effectiveLinetypeScale(e, parentStyle, doc, vp = null) {
  const base = (Number(e?.linetypeScale) || 1) * (parentStyle?.linetypeScale || (Number(doc?.linetypeScale) || 1));
  if (vp && doc?.psltscale !== false) return base / (vp.scale || 1);
  if (!vp && doc?.msltscale !== false && Number(doc?.annotationScale) > 0) return base * Number(doc.annotationScale);
  return base;
}

const boxOf = (e) => e._renderBounds || G.bounds([e]);
const overlaps = (a, b) => a && !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
const reId = (e, idFactory) => { const copy = {...e, id: idFactory()}; if (copy.entities) copy.entities = copy.entities.map((c) => reId(c, idFactory)); return copy; };

/** 뷰포트에 보이는 객체만 남긴다(꺼짐·동결·뷰포트 동결·외부참조 의존 레이어 제외). 블록 안 0번 레이어 객체는 블록을 따른다. */
function viewportVisible(entity, layers) {
  const shown = (l) => l && l.visible !== false && !l.frozen && !String(l.name).includes('|');
  const visit = (e, inBlock) => {
    if (e.hidden) return null;
    const l = layers.get(e.layer);
    if (!(inBlock && l?.name === '0') && !shown(l)) return null;
    let out = e;
    if (!e.color && l && l !== layers.originals?.get(e.layer)) {   // 뷰포트 재지정(색·선종류·굵기)은 ByLayer 객체에 실어 내보낸다
      const base = layers.originals.get(e.layer);
      const patch = {};
      if (l.color !== base?.color) patch.color = l.color;
      if (l.linetype !== base?.linetype && !e.linetype) patch.linetype = l.linetype;
      if (l.lineweight !== base?.lineweight && e.lineweight == null) patch.lineweight = l.lineweight;
      if (Object.keys(patch).length) out = {...e, ...patch};
    }
    if (!e.entities?.length) return out;
    const kids = e.entities.map((c) => visit(c, true)).filter(Boolean);
    return kids.length === e.entities.length && kids.every((k, i) => k === e.entities[i]) ? out : {...out, entities: kids};
  };
  return visit(entity, false);
}

/** 713 EXPORTLAYOUT: 배치를 종이 mm 좌표의 모형 도면으로 펼친다. 해치 축척·문자 높이도 뷰포트 축척만큼 줄인다. */
export function exportLayout(doc, layout, {idFactory = () => crypto.randomUUID(), frames = false} = {}) {
  if (!layout?.viewports) throw Error('내보낼 배치를 고르세요.');
  const out = (layout.entities || []).map((e) => reId(structuredClone(e), idFactory));
  const originals = new Map(doc.layers.map((l) => [l.id, l]));
  let scanned = 0;
  for (const vp of layout.viewports) {
    const layers = new Map(layersForViewport(doc, vp).map((l) => [l.id, l]));
    layers.originals = originals;
    const toPaper = modelToPaper(vp), view = vp.modelView;
    for (const e of doc.entities) {
      if (e.sheetDecoration || !overlaps(boxOf(e), view)) continue;
      scanned++;
      const shown = viewportVisible(e, layers);
      if (!shown) continue;
      for (const piece of G.clipToBounds(shown, view)) {
        const moved = G.transformEntity(piece, toPaper, {scale: vp.scale});
        if (moved.type === 'hatch' && Number.isFinite(piece.patternScale) && moved.patternScale === piece.patternScale) moved.patternScale = piece.patternScale * vp.scale;
        if (Number.isFinite(piece.linetypeScale) && doc.psltscale !== false) moved.linetypeScale = piece.linetypeScale;   // PSLTSCALE: 종이 위 무늬 길이 유지
        out.push(reId(moved, idFactory));
      }
    }
    if (frames) out.push({id: idFactory(), type: 'rectangle', layer: doc.layers[0]?.id, color: '#9aa4ad', points: G.rectangle({x: vp.center.x - vp.width / 2, y: vp.center.y - vp.height / 2}, {x: vp.center.x + vp.width / 2, y: vp.center.y + vp.height / 2})});
  }
  const {dxfPreservation, ...rest} = doc;
  return {document: {...rest, entities: out, sheets: [], layouts: [], currentLayout: 'Model', linetypeScale: doc.psltscale !== false ? 1 : doc.linetypeScale}, scanned, count: out.length};
}

/** 배치 미리보기 SVG: 종이 1:1(mm) 로 그린다. plotSVG 는 plot.js 의 것을 넘겨받는다(순환 의존 없음). */
export function layoutPreviewSVG(doc, layout, plotSVG, options = {}) {
  const [pw, ph] = paperSize(layout);
  const {document} = exportLayout(doc, layout, {frames: true, idFactory: (() => { let n = 0; return () => 'p' + (++n); })()});
  if (!document.entities.length) throw Error('배치에 보이는 객체가 없습니다.');
  return plotSVG(document, {paper: layout.paper || 'A3', orientation: layout.orientation || 'landscape', denominator: 1, window: {minX: 0, minY: 0, maxX: pw, maxY: ph}, margin: 0, center: false, colorMode: options.colorMode || 'auto', title: layout.name || '배치'});
}
